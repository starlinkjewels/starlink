import { EmployeeCreateDialog, emailTakenMessage } from "@/components/create/EmployeeCreateDialog";
import { EmployeeCompaniesControl } from "@/components/EmployeeCompanies";
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { updateDb, flush, loadDb, type User } from "@/lib/db";
import { RolesPanel, EmployeeAccessControls } from "@/components/RolesAccess";
import { AccessSummary } from "@/components/AccessManager";
import { DataTable, CellMain, CellTag, type DataColumn } from "@/components/DataTable";
import { hasCompanies } from "@/lib/companies";
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
import { Plus, Trash2, Search, ListTodo, Eye, Users, KeyRound, LogIn, Rows3, LayoutGrid, Power } from "lucide-react";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { usePagination } from "@/hooks/usePagination";
import { PaginationBar } from "@/components/PaginationBar";
import { confirmBox } from "@/lib/confirm";

const PAGE_SIZE = 9;

export function EmployeesPage() {
  const db = useDb();
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<"list" | "grid">(() => {
    try { return (localStorage.getItem("employees-view") as "list" | "grid") || "grid"; } catch { return "grid"; }
  });
  const saveView = (v: "list" | "grid") => { setView(v); try { localStorage.setItem("employees-view", v); } catch { /* ignore */ } };

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

  // ── List view: the shared table ──
  const roleLabel = (u: User) => (u.role === "admin" ? (isAdminEmail(u.email) ? "Owner" : "Admin · Partner") : (u.department || ""));
  const columns: DataColumn<User>[] = [
    { key: "name", header: "Name", always: true, sortValue: u => u.name, csv: u => u.name,
      cell: u => <CellMain title={u.name} sub={u.authUid || u.role === "admin" ? u.email : <span className="italic">Salary only — no login</span>} /> },
    { key: "role", header: "Role / department", sortValue: roleLabel,
      cell: u => u.role === "admin" ? <CellTag tone="amber">{roleLabel(u)}</CellTag>
        : u.department ? <CellTag tone="blue">{u.department}</CellTag> : <span className="text-muted-foreground/50">—</span> },
    // What their access lets them do, at a glance; it is changed from the row's
    // details (the arrow) or the grid card.
    { key: "access", header: "Access",
      cell: u => u.role === "admin" ? <span className="text-[11px] text-amber-700 font-medium whitespace-nowrap">Everything</span>
        : u.authUid ? <AccessSummary u={u} db={db} />
        : <span className="text-[11px] text-muted-foreground whitespace-nowrap">No login</span> },
    { key: "clients", header: "Clients", align: "right", kind: "number", sortValue: u => clientCount(u.id),
      cell: u => <span className="tabular-nums">{clientCount(u.id)}</span> },
    { key: "tasks", header: "Pending tasks", align: "right", kind: "number", sortValue: u => pendingCount(u.id),
      cell: u => {
        const n = pendingCount(u.id);
        return n > 0
          ? <span className="inline-flex items-center justify-center h-[18px] min-w-[18px] px-1 rounded-full bg-primary text-primary-foreground text-[10px] font-bold leading-none">{n}</span>
          : <span className="tabular-nums text-muted-foreground/60">0</span>;
      } },
    { key: "status", header: "Status", sortValue: u => u.status,
      cell: u => <CellTag tone={u.status === "active" ? "green" : "neutral"}>{u.status === "active" ? "Active" : "Inactive"}</CellTag> },
  ];
  // The card's role, admin and company controls, as they are, in a row's
  // details — each opens its own dialog or asks before it changes anything.
  // Shown where the card shows one of them.
  const multiCo = hasCompanies(db.settings);
  const hasControls = (u: User) => isAdminEmail(u.email) || u.role === "admin" || !!u.authUid || (multiCo && u.role === "employee");

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

      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input value={q} onChange={e => setQ(e.target.value)} placeholder="Search employees..." className="pl-9 h-11 rounded-xl" />
        </div>
        <div className="shrink-0 inline-flex items-center gap-0.5 p-0.5 rounded-lg bg-secondary border border-border/60">
          <button onClick={() => saveView("list")} aria-label="List view"
            className={`flex items-center gap-1 h-8 px-2 rounded-md text-xs font-medium transition-colors ${view === "list" ? "bg-white text-brand-dark shadow-soft" : "text-muted-foreground hover:text-foreground"}`}>
            <Rows3 className="h-3.5 w-3.5" /><span className="hidden sm:inline">List</span>
          </button>
          <button onClick={() => saveView("grid")} aria-label="Grid view"
            className={`flex items-center gap-1 h-8 px-2 rounded-md text-xs font-medium transition-colors ${view === "grid" ? "bg-white text-brand-dark shadow-soft" : "text-muted-foreground hover:text-foreground"}`}>
            <LayoutGrid className="h-3.5 w-3.5" /><span className="hidden sm:inline">Grid</span>
          </button>
        </div>
      </div>

      {/* ── List view — the shared table: sort by any heading, Excel, pages.
          The search above narrows it, as it does the grid. Admins stay first
          until a heading is clicked. ── */}
      {view === "list" && (
        <div className="card-luxe p-3 sm:p-4">
          <DataTable
            id="employees"
            noun="employee"
            rows={emps}
            columns={columns}
            rowKey={u => u.id}
            rowHref={u => `/employees/${u.id}`}
            exportName="Employees"
            expand={{
              can: hasControls,
              // Card-width, and without the gap the card puts above them.
              render: u => <div className="max-w-md [&>*:first-child]:mt-0"><EmployeeAccessControls u={u} /><EmployeeCompaniesControl u={u} /></div>,
            }}
            // The card's buttons. Owner/Admin: no deactivate / reset / delete
            // (avoid locking yourself out), as on the card.
            rowActions={u => {
              const pending = pendingCount(u.id);
              return [
                { label: "View", icon: Eye, onSelect: () => navigate(`/employees/${u.id}`) },
                { label: "Tasks", icon: ListTodo, hint: pending > 0 ? `${pending} pending` : undefined, onSelect: () => setTasksPanelUser(u.id) },
                { label: u.status === "active" ? "Deactivate" : "Activate", icon: Power, onSelect: () => toggle(u), show: u.role !== "admin" },
                { label: "Give login", icon: LogIn, hint: "Give them an email and password to sign in", onSelect: () => setLoginFor(u), show: u.role !== "admin" && !u.authUid },
                { label: "Send password reset", icon: KeyRound, onSelect: () => resetPw(u), show: u.role !== "admin" && !!u.authUid && !!u.email },
                { label: "Delete", icon: Trash2, hint: "Removes their access — their login stops working", danger: true, onSelect: () => del(u.id), show: u.role !== "admin" },
              ];
            }}
            emptyText="No employees found."
          />
        </div>
      )}

      {view === "grid" && (
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
      )}

      {/* The list pages itself; these pages are the grid's. */}
      {view === "grid" && (
        <PaginationBar
          page={page}
          totalPages={totalPages}
          onPageChange={setPage}
          label={total > 0 ? `Showing ${start + 1}–${end} of ${total} employees` : undefined}
        />
      )}

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
