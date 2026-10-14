import { EmployeeCreateDialog, emailTakenMessage } from "@/components/create/EmployeeCreateDialog";
import { EmployeeCompaniesControl } from "@/components/EmployeeCompanies";
import { useState } from "react";
import { Link } from "react-router-dom";
import { updateDb, flush, loadDb, type User } from "@/lib/db";
import { RolesPanel, EmployeeAccessControls } from "@/components/RolesAccess";
import { useDb } from "@/hooks/useDb";
import { auth, isAdminEmail, createAuthUser } from "@/lib/firebase";
import { sendPasswordResetEmail } from "firebase/auth";
import { authErrorMessage } from "@/lib/authErrors";
import { Button } from "@/components/ui/button";
import { AsyncButton } from "@/components/AsyncButton";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { StatusBadge } from "@/components/StatusBadge";
import { TasksPanel } from "@/components/TasksPanel";
import { Plus, Trash2, Search, ListTodo, Eye, Users, KeyRound, LogIn } from "lucide-react";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { usePagination } from "@/hooks/usePagination";
import { PaginationBar } from "@/components/PaginationBar";
import { confirmBox } from "@/lib/confirm";

const PAGE_SIZE = 9;

export function EmployeesPage() {
  const db = useDb();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);

  // Tasks panel state
  const [tasksPanelUser, setTasksPanelUser] = useState<string | null>(null);
  const [loginFor, setLoginFor] = useState<User | null>(null);

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


  const toggle = (u: User) => {
    updateDb(d => { const x = d.users.find(x => x.id === u.id)!; x.status = x.status === "active" ? "inactive" : "active"; });
    toast.success("Updated");
  };

  const resetPw = async (u: User) => {
    try { await sendPasswordResetEmail(auth, u.email); toast.success(`Password reset email sent to ${u.email}`); }
    catch (e) { toast.error(authErrorMessage(e)); }
  };

  const del = async (id: string) => {
    if (!(await confirmBox("Remove this employee's access? Their login will stop working."))) return;
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
        <Button onClick={() => setOpen(true)} className="btn-hero h-11 rounded-xl"><Plus className="h-4 w-4 mr-2" />New Employee</Button>
        <EmployeeCreateDialog open={open} onOpenChange={setOpen} />
      </div>

      <RolesPanel />

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input value={q} onChange={e => setQ(e.target.value)} placeholder="Search employees..." className="pl-9 h-11 rounded-xl" />
      </div>

      <div className="grid gap-3 md:grid-cols-2 lg:grid-auto-cards">
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
                  <p className="text-xs text-muted-foreground truncate mt-0.5">
                    {u.authUid || u.role === "admin" ? u.email : <span className="italic">Salary only — no login</span>}
                  </p>
                  <div className="flex items-center gap-2 mt-2.5">
                    <span className={`text-[11px] font-medium inline-flex items-center px-2 py-0.5 rounded-full ${u.role === "admin" ? "bg-amber-500/15 text-amber-700" : "bg-primary/10 text-primary"}`}>{u.role === "admin" ? (isAdminEmail(u.email) ? "Owner" : "Admin · Partner") : (u.department || "—")}</span>
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
              {/* Role, and admin or not */}
              <EmployeeAccessControls u={u} />
              <EmployeeCompaniesControl u={u} />

              {/* Owner/Admin: no deactivate / reset / delete from here (avoid locking yourself out) */}
              {u.role !== "admin" && (
                <div className="flex items-center gap-2 mt-2">
                  <AsyncButton size="sm" variant="outline" onClick={() => toggle(u)} className="rounded-lg flex-1">
                    {u.status === "active" ? "Deactivate" : "Activate"}
                  </AsyncButton>
                  {/* No login, nothing to reset — but one can be given. */}
                  {!u.authUid && (
                    <Button size="sm" variant="outline" onClick={() => setLoginFor(u)} className="rounded-lg gap-1.5 text-primary" title="Give them an email and password to sign in">
                      <LogIn className="h-3.5 w-3.5" /> Give login
                    </Button>
                  )}
                  {!!u.authUid && !!u.email && (
                    <AsyncButton size="sm" variant="outline" onClick={() => resetPw(u)} className="rounded-lg w-9 px-0" title="Send password reset email">
                      <KeyRound className="h-3.5 w-3.5" />
                    </AsyncButton>
                  )}
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

      {loginFor && <GiveLoginDialog u={loginFor} onClose={() => setLoginFor(null)} />}

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

/**
 * A login for someone first added for salary only. Their record stays as it
 * is — history, salary ledger, everything — and gains an email and password.
 */
function GiveLoginDialog({ u, onClose }: { u: User; onClose: () => void }) {
  const [email, setEmail] = useState(u.email || "");
  const [password, setPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const save = async () => {
    const e = email.trim().toLowerCase();
    if (!e || !password) { toast.error("Enter an email and a password"); return; }
    if (isAdminEmail(e)) { toast.error("That is an owner's login — use this person's own email."); return; }
    const taken = emailTakenMessage(loadDb(), e, u.id);
    if (taken) { toast.error(taken, { duration: 9000 }); return; }
    setSaving(true);
    try {
      const authUid = await createAuthUser(e, password);
      updateDb(d => {
        const x = d.users.find(y => y.id === u.id);
        if (!x) return;
        x.authUid = authUid; x.email = e; x.username = e;
      });
      // The sign-in's permission record goes up with this save; wait for it.
      await flush();
      toast.success(`${u.name} can now sign in with ${e}`);
      onClose();
    } catch (err) {
      toast.error(authErrorMessage(err), { duration: 9000 });
    } finally { setSaving(false); }
  };
  return (
    <Dialog open onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-sm rounded-2xl">
        <DialogHeader><DialogTitle className="font-display text-xl">Give {u.name} a login</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div><Label className="text-xs">Email (login ID)</Label><Input type="email" value={email} onChange={x => setEmail(x.target.value)} className="rounded-xl mt-1" autoComplete="off" /></div>
          <div><Label className="text-xs">Password</Label><Input type="password" value={password} onChange={x => setPassword(x.target.value)} className="rounded-xl mt-1" autoComplete="new-password" /></div>
          <p className="text-[11px] text-muted-foreground">They keep everything already on their record. They sign in with Standard staff access until you choose a role on their card.</p>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose} className="rounded-xl">Cancel</Button>
          <Button onClick={save} disabled={saving} className="btn-hero rounded-xl">{saving ? "Creating…" : "Create login"}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
