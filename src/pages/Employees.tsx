import { EmployeeCreateDialog, emailTakenMessage } from "@/components/create/EmployeeCreateDialog";
import { EmployeeCompaniesControl } from "@/components/EmployeeCompanies";
import { useState, type MouseEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { updateDb, flush, loadDb, rolesStoreReady, type User } from "@/lib/db";
import { RolesPanel, EmployeeAccessControls, setAdminRole } from "@/components/RolesAccess";
import { AccessSummary, ManageAccessDialog } from "@/components/AccessManager";
import { DataTable, CellMain, CellTag, type DataColumn } from "@/components/DataTable";
import { MoreMenu, type MoreAction } from "@/components/MoreMenu";
import { hasCompanies } from "@/lib/companies";
import { useDb } from "@/hooks/useDb";
import { auth, isAdminEmail, createAuthUser } from "@/lib/firebase";
import { sendPasswordResetEmail } from "firebase/auth";
import { authErrorMessage } from "@/lib/authErrors";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { TasksPanel } from "@/components/TasksPanel";
import {
  Plus, Trash2, Search, ListTodo, Eye, Users, KeyRound, LogIn, Rows3, LayoutGrid, Power, ShieldCheck, ShieldOff, Crown, Building2, ArrowRight,
} from "lucide-react";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { usePagination } from "@/hooks/usePagination";
import { PaginationBar } from "@/components/PaginationBar";
import { confirmBox } from "@/lib/confirm";

const PAGE_SIZE = 12;

/** The quick filters over the team. */
type Filter = "all" | "admins" | "employees" | "salary" | "inactive";
const FILTERS: { key: Filter; label: string; hint?: string; test: (u: User) => boolean }[] = [
  { key: "all", label: "All", test: () => true },
  { key: "admins", label: "Admins", hint: "Owners and admin partners", test: u => u.role === "admin" },
  { key: "employees", label: "Employees", test: u => u.role === "employee" },
  { key: "salary", label: "Salary only", hint: "No login — paid and in the salary ledger only", test: u => u.role === "employee" && !u.authUid },
  { key: "inactive", label: "Inactive", test: u => u.status !== "active" },
];

/** A click inside a card that does its own thing (its menu, its link), so it
 *  must not also open the person's page. The menu is portalled, but React
 *  still bubbles its clicks up through the card. */
const OWN_CLICK = "button,a,input,label,[role=menu],[role=menuitem],[data-no-row]";

export function EmployeesPage() {
  const db = useDb();
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [open, setOpen] = useState(false);
  // The list is the default now; a remembered choice still wins.
  const [view, setView] = useState<"list" | "grid">(() => {
    try { return (localStorage.getItem("employees-view") as "list" | "grid") || "list"; } catch { return "list"; }
  });
  const saveView = (v: "list" | "grid") => { setView(v); try { localStorage.setItem("employees-view", v); } catch { /* ignore */ } };

  // Tasks panel state
  const [tasksPanelUser, setTasksPanelUser] = useState<string | null>(null);
  const [loginFor, setLoginFor] = useState<User | null>(null);
  // What the ⋯ menus open: someone's access, or the companies they sell for.
  const [managing, setManaging] = useState<User | null>(null);
  const [companiesFor, setCompaniesFor] = useState<string | null>(null);
  const rolesLive = rolesStoreReady();
  const multiCo = hasCompanies(db.settings);

  // Include the admin/owner too — salary can be paid to them, so their ledger
  // needs to be reachable from here. Admins are listed first.
  const team = db.users.filter(u => u.role === "employee" || u.role === "admin");
  const searched = team.filter(u =>
    u.name.toLowerCase().includes(q.toLowerCase()) ||
    u.email.toLowerCase().includes(q.toLowerCase())
  );
  const shownFilter = FILTERS.find(x => x.key === filter)!;
  const emps = searched
    .filter(shownFilter.test)
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

  /**
   * Everything that can be done to one person — the same in a card's ⋯ and a
   * row's ⋯, with the conditions the old card buttons had. Owner/Admin: no
   * deactivate / reset / delete (avoid locking yourself out); an owner cannot
   * be demoted. Access and admin are for someone who signs in.
   */
  const actionsFor = (u: User, withView: boolean): MoreAction[] => {
    const pending = pendingCount(u.id);
    const owner = isAdminEmail(u.email);
    const signsIn = u.role === "employee" && !!u.authUid && !owner;
    return [
      { label: "View", icon: Eye, onSelect: () => navigate(`/employees/${u.id}`), show: withView },
      { label: "Tasks", icon: ListTodo, hint: pending > 0 ? `${pending} pending` : undefined, onSelect: () => setTasksPanelUser(u.id) },
      { label: "Manage access", icon: ShieldCheck, hint: rolesLive ? "What they may see and do" : "Switches on once the security update is deployed",
        disabled: !rolesLive, onSelect: () => setManaging(u), show: signsIn },
      { label: "Make admin", icon: Crown, hint: "They can do everything — asks first", onSelect: () => setAdminRole(u, true), show: rolesLive && signsIn },
      { label: "Companies they sell for", icon: Building2, hint: u.companyIds?.length ? `${u.companyIds.length} ticked` : "Every company", onSelect: () => setCompaniesFor(u.id), show: multiCo && u.role === "employee" },
      { label: "Give login", icon: LogIn, hint: "Give them an email and password to sign in", onSelect: () => setLoginFor(u), show: u.role !== "admin" && !u.authUid },
      { label: "Send password reset", icon: KeyRound, onSelect: () => resetPw(u), show: u.role !== "admin" && !!u.authUid && !!u.email },
      { label: u.status === "active" ? "Deactivate" : "Activate", icon: Power, onSelect: () => toggle(u), show: u.role !== "admin" },
      { label: "Remove admin", icon: ShieldOff, hint: "They become an employee with Standard staff access", danger: true, onSelect: () => setAdminRole(u, false), show: rolesLive && u.role === "admin" && !owner },
      { label: "Delete", icon: Trash2, hint: "Removes their access — their login stops working", danger: true, onSelect: () => del(u.id), show: u.role !== "admin" },
    ];
  };

  // ── The same labels in the table and on the cards ──
  const roleLabel = (u: User) => (u.role === "admin" ? (isAdminEmail(u.email) ? "Owner" : "Admin · Partner") : (u.department || ""));
  const roleTag = (u: User) => u.role === "admin"
    ? <CellTag tone="amber">{isAdminEmail(u.email) && <Crown className="h-3 w-3 mr-1" />}{roleLabel(u)}</CellTag>
    : u.department ? <CellTag tone="blue">{u.department}</CellTag> : <CellTag>Employee</CellTag>;
  const statusTag = (u: User) => <CellTag tone={u.status === "active" ? "green" : "neutral"}>{u.status === "active" ? "Active" : "Inactive"}</CellTag>;
  const loginLine = (u: User) => (u.authUid || u.role === "admin" ? u.email : <span className="italic">Salary only — no login</span>);
  const pendingPill = (n: number) => n > 0
    ? <span className="inline-flex items-center justify-center h-[18px] min-w-[18px] px-1 rounded-full bg-primary text-primary-foreground text-[10px] font-bold leading-none">{n}</span>
    : <span className="tabular-nums text-muted-foreground/60">0</span>;

  // ── List view: the shared table ──
  const columns: DataColumn<User>[] = [
    { key: "name", header: "Name", always: true, sortValue: u => u.name, csv: u => u.name,
      cell: u => <CellMain title={u.name} sub={loginLine(u)} /> },
    { key: "role", header: "Role / department", sortValue: roleLabel,
      cell: u => u.role === "admin" ? roleTag(u)
        : u.department ? <CellTag tone="blue">{u.department}</CellTag> : <span className="text-muted-foreground/50">—</span> },
    // What their access lets them do, at a glance; it is changed from the row's
    // ⋯ (Manage access) or its details (the arrow).
    { key: "access", header: "Access",
      cell: u => u.role === "admin" ? <span className="text-[11px] text-amber-700 font-medium whitespace-nowrap">Everything</span>
        : u.authUid ? <AccessSummary u={u} db={db} />
        : <span className="text-[11px] text-muted-foreground whitespace-nowrap">No login</span> },
    { key: "clients", header: "Clients", align: "right", kind: "number", sortValue: u => clientCount(u.id),
      cell: u => <span className="tabular-nums">{clientCount(u.id)}</span> },
    { key: "tasks", header: "Pending tasks", align: "right", kind: "number", sortValue: u => pendingCount(u.id),
      cell: u => pendingPill(pendingCount(u.id)) },
    { key: "status", header: "Status", sortValue: u => u.status, cell: statusTag },
  ];
  // The role, admin and company controls, as they are, in a row's details —
  // each opens its own dialog or asks before it changes anything.
  const hasControls = (u: User) => isAdminEmail(u.email) || u.role === "admin" || !!u.authUid || (multiCo && u.role === "employee");

  // ── The figures across the whole team (not the search or the filter) ──
  const active = team.filter(u => u.status === "active").length;
  const withLogin = team.filter(u => u.role === "admin" || !!u.authUid).length;
  const admins = team.filter(u => u.role === "admin").length;
  const owners = team.filter(u => u.role === "admin" && isAdminEmail(u.email)).length;
  const pendingAll = team.reduce((s, u) => s + pendingCount(u.id), 0);
  const withPending = team.filter(u => pendingCount(u.id) > 0).length;
  const tiles = [
    { label: "Team members", value: team.length, sub: `${active} active${team.length - active ? ` · ${team.length - active} inactive` : ""}`, icon: Users, color: "text-primary", bg: "bg-primary/10" },
    { label: "With a login", value: withLogin, sub: `${team.length - withLogin} salary only`, icon: LogIn, color: "text-success", bg: "bg-success/10" },
    { label: "Admins & partners", value: admins, sub: `${owners} owner${owners !== 1 ? "s" : ""}`, icon: ShieldCheck, color: "text-amber-600", bg: "bg-amber-500/10" },
    { label: "Pending tasks", value: pendingAll, sub: pendingAll ? `with ${withPending} ${withPending === 1 ? "person" : "people"}` : "All caught up", icon: ListTodo, color: "text-destructive", bg: "bg-destructive/10" },
  ];

  const emptyText = filter !== "all" || q ? "No one matches — try another filter or search." : "No employees yet — add your first team member.";

  // A card opens the person's page, as a row does (Ctrl/⌘-click: a new tab).
  const openCard = (u: User) => (e: MouseEvent) => {
    if ((e.target as HTMLElement).closest(OWN_CLICK)) return;
    const href = `/employees/${u.id}`;
    if (e.ctrlKey || e.metaKey) window.open(href, "_blank", "noopener");
    else navigate(href);
  };
  const companiesUser = companiesFor ? db.users.find(x => x.id === companiesFor) : undefined;

  return (
    <div className="max-w-7xl mx-auto space-y-5">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          <h1 className="font-display text-2xl md:text-3xl text-brand-dark">Employees</h1>
          <p className="text-sm text-muted-foreground">
            {team.length} team member{team.length !== 1 ? "s" : ""} · {withLogin} can sign in · {admins} admin{admins !== 1 ? "s" : ""}
          </p>
        </div>
        <Button onClick={() => setOpen(true)} className="btn-hero h-11 rounded-xl"><Plus className="h-4 w-4 mr-2" />New Employee</Button>
        <EmployeeCreateDialog open={open} onOpenChange={setOpen} />
      </div>

      {/* Summary tiles, as on the other pages */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {tiles.map(s => (
          <div key={s.label} className="card-luxe p-4 min-w-0">
            <div className={`h-8 w-8 rounded-lg ${s.bg} grid place-items-center mb-3`}>
              <s.icon className={`h-4 w-4 ${s.color}`} />
            </div>
            <p className="text-lg font-display font-bold text-brand-dark tabular-nums truncate">{s.value}</p>
            <p className="text-xs text-muted-foreground mt-0.5 truncate">{s.label}</p>
            <p className="text-[11px] text-muted-foreground/80 mt-0.5 truncate">{s.sub}</p>
          </div>
        ))}
      </div>

      <RolesPanel />

      {/* Quick filters, then the search and the list / grid switch. */}
      <div className="flex flex-col lg:flex-row lg:items-center gap-2.5">
        <div role="tablist" aria-label="Show" className="flex gap-1.5 overflow-x-auto no-scrollbar min-w-0">
          {FILTERS.map(x => {
            const n = searched.filter(x.test).length;
            const on = filter === x.key;
            return (
              <button key={x.key} type="button" role="tab" aria-selected={on} title={x.hint} onClick={() => setFilter(x.key)}
                className={`shrink-0 inline-flex items-center gap-2 h-9 px-3 rounded-lg border text-sm font-medium transition-colors ${on ? "bg-primary text-primary-foreground border-primary shadow-soft" : "bg-white border-border/70 text-muted-foreground hover:bg-secondary hover:text-foreground"}`}>
                {x.label}
                <span className={`min-w-5 h-5 px-1.5 rounded-full text-[11px] font-semibold grid place-items-center tabular-nums ${on ? "bg-white/20" : "bg-secondary"}`}>{n}</span>
              </button>
            );
          })}
        </div>
        <div className="flex items-center gap-2 lg:ml-auto">
          <div className="relative flex-1 lg:w-72 lg:flex-none">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input value={q} onChange={e => setQ(e.target.value)} placeholder="Search name or email…" aria-label="Search employees" className="pl-9 h-10 rounded-xl bg-white" />
          </div>
          <div className="shrink-0 inline-flex items-center gap-0.5 p-0.5 rounded-lg bg-secondary border border-border/60">
            <button onClick={() => saveView("list")} aria-label="List view" aria-pressed={view === "list"}
              className={`flex items-center gap-1 h-8 px-2 rounded-md text-xs font-medium transition-colors ${view === "list" ? "bg-white text-brand-dark shadow-soft" : "text-muted-foreground hover:text-foreground"}`}>
              <Rows3 className="h-3.5 w-3.5" /><span className="hidden sm:inline">List</span>
            </button>
            <button onClick={() => saveView("grid")} aria-label="Grid view" aria-pressed={view === "grid"}
              className={`flex items-center gap-1 h-8 px-2 rounded-md text-xs font-medium transition-colors ${view === "grid" ? "bg-white text-brand-dark shadow-soft" : "text-muted-foreground hover:text-foreground"}`}>
              <LayoutGrid className="h-3.5 w-3.5" /><span className="hidden sm:inline">Grid</span>
            </button>
          </div>
        </div>
      </div>

      {/* ── List view — the shared table: sort by any heading, Excel, pages.
          The filters and search above narrow it, as they do the grid. Admins
          stay first until a heading is clicked. ── */}
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
            resetKey={`${filter}|${q}`}
            expand={{
              can: hasControls,
              // Card-width, and without the gap the card puts above them.
              render: u => <div className="max-w-md [&>*:first-child]:mt-0"><EmployeeAccessControls u={u} /><EmployeeCompaniesControl u={u} /></div>,
            }}
            rowActions={u => actionsFor(u, true)}
            emptyText={emptyText}
          />
        </div>
      )}

      {view === "grid" && (
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-auto-cards">
        {paged.map(u => {
          const pending = pendingCount(u.id);
          const clients = clientCount(u.id);
          const initials = u.name.split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase();
          return (
            <div key={u.id} onClick={openCard(u)} className="card-luxe card-hover p-4 sm:p-5 flex flex-col min-w-0 cursor-pointer">
              {/* Who: avatar, name, how they sign in — and the one menu. */}
              <div className="flex items-start gap-3">
                <div className={`h-11 w-11 shrink-0 rounded-xl bg-gradient-to-br from-primary to-brand-dark text-white font-semibold grid place-items-center text-sm shadow-sm ${u.status === "active" ? "" : "opacity-50 grayscale"}`}>
                  {initials || u.name.charAt(0)}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-[15px] text-brand-dark leading-tight truncate">{u.name}</p>
                  <p className="text-xs text-muted-foreground truncate mt-1">{loginLine(u)}</p>
                </div>
                <MoreMenu size="sm" label={`Actions for ${u.name}`} actions={actionsFor(u, false)} />
              </div>

              <div className="flex flex-wrap items-center gap-1.5 mt-3">
                {roleTag(u)}
                {statusTag(u)}
              </div>

              {/* Their numbers, and the one main action. */}
              <div className="mt-auto pt-4">
                <div className="flex items-center gap-4 pt-3 border-t border-border/60 text-xs text-muted-foreground">
                  <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                    <Users className="h-3.5 w-3.5" /><span className="font-medium text-foreground/80 tabular-nums">{clients}</span> client{clients !== 1 ? "s" : ""}
                  </span>
                  <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                    <ListTodo className="h-3.5 w-3.5" />{pendingPill(pending)} pending
                  </span>
                  <Button asChild size="sm" variant="outline" className="ml-auto h-8 rounded-lg gap-1 shrink-0">
                    <Link to={`/employees/${u.id}`}>View <ArrowRight className="h-3.5 w-3.5" /></Link>
                  </Button>
                </div>
              </div>
            </div>
          );
        })}
        {total === 0 && (
          <div className="col-span-full card-luxe p-12 text-center text-muted-foreground">{emptyText}</div>
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
      {managing && <ManageAccessDialog u={managing} onClose={() => setManaging(null)} />}
      {companiesUser && <CompaniesDialog u={companiesUser} onClose={() => setCompaniesFor(null)} />}

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
 * The companies someone sells for, from a card's ⋯ — the same control the
 * card used to show inline (and a list row's details still do): each tick is
 * saved as it is made.
 */
function CompaniesDialog({ u, onClose }: { u: User; onClose: () => void }) {
  return (
    <Dialog open onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-md rounded-2xl">
        <DialogHeader>
          <DialogTitle className="font-display text-xl">Companies — {u.name}</DialogTitle>
          <DialogDescription className="text-xs">Which of our companies they sell for. Each tick is saved straight away.</DialogDescription>
        </DialogHeader>
        {/* Without the line and gap it has on a card. */}
        <div className="[&>div]:mt-0 [&>div]:pt-0 [&>div]:border-t-0"><EmployeeCompaniesControl u={u} /></div>
        <DialogFooter>
          <Button onClick={onClose} className="btn-hero rounded-xl px-6">Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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
