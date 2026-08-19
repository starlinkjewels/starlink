import { useState } from "react";
import { Link } from "react-router-dom";
import { loadDb, updateDb, uid, type User } from "@/lib/db";
import { useDb } from "@/hooks/useDb";
import { auth, createAuthUser } from "@/lib/firebase";
import { sendPasswordResetEmail } from "firebase/auth";
import { authErrorMessage } from "@/lib/authErrors";
import { Button } from "@/components/ui/button";
import { AsyncButton } from "@/components/AsyncButton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { StatusBadge } from "@/components/StatusBadge";
import { TasksPanel } from "@/components/TasksPanel";
import { Plus, Trash2, Search, ListTodo, Eye, Users, KeyRound } from "lucide-react";
import { toast } from "sonner";
import { usePagination } from "@/hooks/usePagination";
import { PaginationBar } from "@/components/PaginationBar";

const DEPTS = ["Sales","CAD","Design","Production","Diamond Setting","Polishing","QC","Packing","Dispatch","Accounts"];
const PAGE_SIZE = 9;

export function EmployeesPage() {
  const db = useDb();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [f, setF] = useState({ name: "", email: "", password: "", phone: "", department: "Sales" });
  // Opening salary already paid before the app (migration) — optional.
  const [openingPaid, setOpeningPaid] = useState("");
  const [openingCurrency, setOpeningCurrency] = useState<"INR" | "USD">("INR");
  const [openingDate, setOpeningDate] = useState("");

  // Tasks panel state
  const [tasksPanelUser, setTasksPanelUser] = useState<string | null>(null);

  // Include the admin/owner too — salary can be paid to them, so their ledger
  // needs to be reachable from here. Admins are listed first.
  const emps = db.users
    .filter(u => u.role === "employee" || u.role === "admin")
    .filter(u =>
      u.name.toLowerCase().includes(q.toLowerCase()) ||
      u.email.toLowerCase().includes(q.toLowerCase())
    )
    .sort((a, b) => (a.role === "admin" ? -1 : 0) - (b.role === "admin" ? -1 : 0));

  const { paged, page, setPage, totalPages, total, start, end } = usePagination(emps, PAGE_SIZE);

  const create = async () => {
    if (!f.name || !f.email || !f.password) { toast.error("Fill name, email and password"); return; }
    const email = f.email.trim().toLowerCase();
    if (loadDb().users.some(u => u.email.toLowerCase() === email)) { toast.error("That email is already in use"); return; }
    setSaving(true);
    try {
      // Create the Firebase Auth account (password lives in Auth, not Firestore).
      const authUid = await createAuthUser(email, f.password);
      const opAmt = Number(openingPaid);
      updateDb(d => d.users.push({
        id: uid("u_"), role: "employee", status: "active", createdAt: new Date().toISOString(),
        authUid, username: email, email, password: "",
        name: f.name, phone: f.phone, department: f.department,
        openingPaid: opAmt > 0 ? opAmt : undefined,
        openingPaidCurrency: opAmt > 0 ? openingCurrency : undefined,
        openingPaidDate: opAmt > 0 ? (openingDate || undefined) : undefined,
      } as User));
      toast.success("Employee created — they can sign in with their email & password");
      setOpen(false);
      setF({ name: "", email: "", password: "", phone: "", department: "Sales" });
      setOpeningPaid(""); setOpeningCurrency("INR"); setOpeningDate("");
    } catch (e) {
      toast.error(authErrorMessage(e));
    } finally { setSaving(false); }
  };

  const toggle = (u: User) => {
    updateDb(d => { const x = d.users.find(x => x.id === u.id)!; x.status = x.status === "active" ? "inactive" : "active"; });
    toast.success("Updated");
  };

  const resetPw = async (u: User) => {
    try { await sendPasswordResetEmail(auth, u.email); toast.success(`Password reset email sent to ${u.email}`); }
    catch (e) { toast.error(authErrorMessage(e)); }
  };

  const del = (id: string) => {
    if (!confirm("Remove this employee's access? Their login will stop working.")) return;
    updateDb(d => { d.users = d.users.filter(u => u.id !== id); });
    toast.success("Access removed");
  };

  /** Count pending tasks for an employee */
  const pendingCount = (userId: string) =>
    (db.tasks ?? []).filter(t => t.assignedTo === userId && !t.completed).length;

  /** Count clients assigned to an employee */
  const clientCount = (userId: string) =>
    db.clients.filter(c => c.accountManagerId === userId).length;

  return (
    <div className="max-w-7xl mx-auto space-y-5">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="font-display text-2xl md:text-3xl text-brand-dark">Employees</h1>
          <p className="text-sm text-muted-foreground">{total} team member{total !== 1 ? "s" : ""}</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button className="btn-hero h-11 rounded-xl"><Plus className="h-4 w-4 mr-2" />New Employee</Button>
          </DialogTrigger>
          <DialogContent className="max-w-md rounded-2xl">
            <DialogHeader><DialogTitle className="font-display text-2xl">Create Employee</DialogTitle></DialogHeader>
            <div className="space-y-3">
              {(["name","email","password","phone"] as const).map(k => (
                <div key={k}>
                  <Label className="text-xs capitalize">{k === "email" ? "Email (login ID)" : k}</Label>
                  <Input
                    type={k === "password" ? "password" : k === "email" ? "email" : "text"}
                    value={(f as Record<string,string>)[k]}
                    onChange={e => setF({ ...f, [k]: e.target.value })}
                    className="rounded-xl mt-1"
                  />
                </div>
              ))}
              <div>
                <Label className="text-xs">Department</Label>
                <Select value={f.department} onValueChange={v => setF({ ...f, department: v })}>
                  <SelectTrigger className="rounded-xl mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>{DEPTS.map(d => <SelectItem key={d} value={d}>{d}</SelectItem>)}</SelectContent>
                </Select>
              </div>

              {/* Opening salary already paid before the app (optional, migration) */}
              <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-3 space-y-2.5">
                <p className="text-xs font-semibold text-amber-700">Opening — already paid before this app (optional)</p>
                <div className="grid grid-cols-3 gap-2">
                  <div className="col-span-1">
                    <Label className="text-[11px]">Currency</Label>
                    <Select value={openingCurrency} onValueChange={v => setOpeningCurrency(v as "INR" | "USD")}>
                      <SelectTrigger className="rounded-lg mt-1 h-9"><SelectValue /></SelectTrigger>
                      <SelectContent><SelectItem value="INR">₹ INR</SelectItem><SelectItem value="USD">$ USD</SelectItem></SelectContent>
                    </Select>
                  </div>
                  <div className="col-span-2">
                    <Label className="text-[11px]">Amount</Label>
                    <Input type="number" min={0} step="0.01" value={openingPaid} onChange={e => setOpeningPaid(e.target.value)} placeholder="0.00" className="rounded-lg mt-1 h-9" />
                  </div>
                </div>
                <div>
                  <Label className="text-[11px]">As of date</Label>
                  <Input type="date" value={openingDate} onChange={e => setOpeningDate(e.target.value)} className="rounded-lg mt-1 h-9" />
                </div>
                <p className="text-[11px] text-muted-foreground">Salary/wages already paid to this person before you started using this app. Added to their total paid to date.</p>
              </div>

              <Button onClick={create} disabled={saving} className="btn-hero rounded-xl w-full">{saving ? "Creating…" : "Create"}</Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input value={q} onChange={e => setQ(e.target.value)} placeholder="Search employees..." className="pl-9 h-11 rounded-xl" />
      </div>

      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
        {paged.map(u => {
          const pending = pendingCount(u.id);
          const initials = u.name.split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase();
          return (
            <div key={u.id} className="card-luxe card-hover p-5">
              {/* Header */}
              <div className="flex items-start gap-3.5">
                <div className="relative shrink-0">
                  <div className="h-14 w-14 rounded-2xl bg-gradient-to-br from-primary to-brand-dark text-white font-semibold grid place-items-center text-lg shadow-md ring-2 ring-white/70">
                    {initials || u.name.charAt(0)}
                  </div>
                  <span className={`absolute -bottom-1 -right-1 h-4 w-4 rounded-full border-2 border-white ${u.status === "active" ? "bg-emerald-500" : "bg-muted-foreground/40"}`} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-2">
                    <p className="font-semibold text-[15px] leading-tight truncate">{u.name}</p>
                    <StatusBadge status={u.status} />
                  </div>
                  <p className="text-xs text-muted-foreground truncate mt-0.5">{u.email}</p>
                  <div className="flex items-center gap-2 mt-2.5">
                    <span className={`text-[11px] font-medium inline-flex items-center px-2 py-0.5 rounded-full ${u.role === "admin" ? "bg-amber-500/15 text-amber-700" : "bg-primary/10 text-primary"}`}>{u.role === "admin" ? "Owner / Admin" : (u.department || "—")}</span>
                    <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                      <Users className="h-3 w-3" /> {clientCount(u.id)} client{clientCount(u.id) !== 1 ? "s" : ""}
                    </span>
                  </div>
                </div>
              </div>

              <div className="h-px bg-border/60 my-4" />

              {/* Actions */}
              <div className="flex items-center gap-2">
                <Button asChild size="sm" className="btn-hero rounded-lg flex-1 gap-1.5">
                  <Link to={`/employees/${u.id}`}>
                    <Eye className="h-3.5 w-3.5" /> View
                  </Link>
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setTasksPanelUser(u.id)}
                  className="rounded-lg flex-1 gap-1.5 relative"
                >
                  <ListTodo className="h-3.5 w-3.5 text-primary" />
                  Tasks
                  {pending > 0 && (
                    <span className="ml-1 inline-flex items-center justify-center h-[18px] min-w-[18px] px-1 rounded-full bg-primary text-primary-foreground text-[10px] font-bold leading-none">
                      {pending}
                    </span>
                  )}
                </Button>
              </div>
              {/* Owner/Admin: no deactivate / reset / delete from here (avoid locking yourself out) */}
              {u.role !== "admin" && (
                <div className="flex items-center gap-2 mt-2">
                  <AsyncButton size="sm" variant="outline" onClick={() => toggle(u)} className="rounded-lg flex-1">
                    {u.status === "active" ? "Deactivate" : "Activate"}
                  </AsyncButton>
                  <AsyncButton size="sm" variant="outline" onClick={() => resetPw(u)} className="rounded-lg w-9 px-0" title="Send password reset email">
                    <KeyRound className="h-3.5 w-3.5" />
                  </AsyncButton>
                  <AsyncButton size="sm" variant="outline" onClick={() => del(u.id)} className="rounded-lg w-9 px-0 text-destructive hover:bg-destructive/10 hover:text-destructive" title="Remove access">
                    <Trash2 className="h-3.5 w-3.5" />
                  </AsyncButton>
                </div>
              )}
            </div>
          );
        })}
        {total === 0 && (
          <div className="col-span-full card-luxe p-12 text-center text-muted-foreground">No employees found.</div>
        )}
      </div>

      <PaginationBar
        page={page}
        totalPages={totalPages}
        onPageChange={setPage}
        label={total > 0 ? `Showing ${start + 1}–${end} of ${total} employees` : undefined}
      />

      {/* Tasks panel (admin assigning tasks to an employee) */}
      <TasksPanel
        userId={tasksPanelUser ?? ""}
        open={!!tasksPanelUser}
        onClose={() => setTasksPanelUser(null)}
        asAdmin
      />
    </div>
  );
}
