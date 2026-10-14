import { useState } from "react";
import { updateDb, uid, rolesStoreReady, currentUserOrders, currentUserClients, type User } from "@/lib/db";
import { useDb } from "@/hooks/useDb";
import { isAdminEmail } from "@/lib/firebase";
import {
  ACTION_LABEL, MODULE_ACTIONS, PERM_ACTIONS, ROLE_MODULES, ROLE_TEMPLATES, STANDARD_STAFF, REACH_LABEL,
  normalisePerms, roleOf, type PermAction, type PermMatrix, type StaffRole, type RoleReach,
} from "@/lib/permissions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ShieldCheck, Plus, Pencil, Trash2, Lock, Crown, Globe2, UserRound } from "lucide-react";
import { toast } from "sonner";
import { confirmBox } from "@/lib/confirm";

/**
 * Roles and admins — who may see and do what. ADMIN ONLY: rendered on the
 * Employees page, which only an admin can open.
 *
 * Nothing changes for anybody until an admin decides it should: an employee
 * without a role keeps Standard staff, which is what every employee could do
 * before roles existed.
 */

/** Until the security update is live, a role saved here would be kept on this
 *  device only and gone on reload — so nothing can be saved, and it says why. */
function NotLiveNote() {
  return (
    <p className="text-xs rounded-xl bg-amber-500/10 border border-amber-500/30 p-3 text-amber-800">
      Roles and extra admins switch on once the security update is deployed
      (<code className="text-[11px]">firebase deploy --only firestore</code>). Until then every employee keeps
      Standard staff access, exactly as today, and nothing here can be changed.
    </p>
  );
}

export function RolesPanel() {
  const db = useDb();
  const live = rolesStoreReady();
  const roles = db.roles ?? [];
  const [editing, setEditing] = useState<StaffRole | null>(null);
  const holders = (id: string) => db.users.filter(u => u.role === "employee" && (u.roleId ?? STANDARD_STAFF.id) === id);

  const remove = async (r: StaffRole) => {
    const who = holders(r.id);
    if (!(await confirmBox(
      `Delete the role "${r.name}"?\n\n`
      + (who.length ? `${who.length} employee${who.length !== 1 ? "s" : ""} hold it (${who.map(u => u.name).join(", ")}). They go back to Standard staff.` : "Nobody holds it."),
    ))) return;
    updateDb(d => {
      d.roles = (d.roles ?? []).filter(x => x.id !== r.id);
      for (const u of d.users) if (u.roleId === r.id) delete u.roleId;
    });
    toast.success(`Role "${r.name}" deleted`);
  };

  const all = [STANDARD_STAFF, ...roles];
  return (
    <div className="card-luxe p-5 space-y-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-primary/10 grid place-items-center"><ShieldCheck className="h-5 w-5 text-primary" /></div>
          <div>
            <h3 className="font-display text-lg text-brand-dark">Roles &amp; access</h3>
            <p className="text-xs text-muted-foreground">What each employee may see and do, section by section. Admins can do everything.</p>
          </div>
        </div>
        <Button size="sm" disabled={!live} onClick={() => setEditing({ id: "", name: "", perms: {}, createdAt: "" })} className="btn-hero rounded-xl gap-1.5">
          <Plus className="h-4 w-4" /> New role
        </Button>
      </div>
      {!live && <NotLiveNote />}
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {all.map(r => {
          const n = holders(r.id).length;
          const sections = Object.keys(r.perms).length;
          return (
            <div key={r.id} className="rounded-xl border border-border/70 p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-semibold text-sm text-brand-dark flex items-center gap-1.5">
                    {r.name} {r.builtIn && <Lock className="h-3 w-3 text-muted-foreground" />}
                  </p>
                  <p className="text-[11px] text-muted-foreground">{sections} section{sections !== 1 ? "s" : ""} · {n} employee{n !== 1 ? "s" : ""}</p>
                  <ReachChip reach={r.reach ?? "own"} />
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button onClick={() => setEditing(r)} className="h-7 w-7 grid place-items-center rounded-lg hover:bg-secondary" title={r.builtIn ? "View" : "Edit"}>
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                  {!r.builtIn && live && (
                    <button onClick={() => remove(r)} className="h-7 w-7 grid place-items-center rounded-lg hover:bg-destructive/10 text-destructive" title="Delete">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              </div>
              {r.description && <p className="text-[11px] text-muted-foreground mt-1 line-clamp-2">{r.description}</p>}
            </div>
          );
        })}
      </div>
      {editing && <RoleEditor role={editing} readOnly={!!editing.builtIn || !live} onClose={() => setEditing(null)} />}
    </div>
  );
}

function ReachChip({ reach }: { reach: RoleReach }) {
  return reach === "all"
    ? <span className="inline-flex items-center gap-1 mt-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-md bg-primary/10 text-primary"><Globe2 className="h-3 w-3" /> {REACH_LABEL.all}</span>
    : <span className="inline-flex items-center gap-1 mt-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-md bg-secondary text-muted-foreground"><UserRound className="h-3 w-3" /> {REACH_LABEL.own}</span>;
}

function RoleEditor({ role, readOnly, onClose }: { role: StaffRole; readOnly: boolean; onClose: () => void }) {
  const isNew = !role.id;
  const [name, setName] = useState(role.name);
  const [description, setDescription] = useState(role.description ?? "");
  const [perms, setPerms] = useState<PermMatrix>(role.perms);
  const [reach, setReach] = useState<RoleReach>(role.reach ?? "own");

  const has = (m: string, a: PermAction) => !!perms[m as keyof PermMatrix]?.[a];
  const toggle = (m: string, a: PermAction) => {
    if (readOnly) return;
    setPerms(prev => {
      const key = m as keyof PermMatrix;
      const set = { ...(prev[key] ?? {}) };
      const on = !set[a];
      if (a === "view" && !on) return { ...prev, [key]: {} };          // no View → nothing in it
      set[a] = on;
      if (on && a !== "view") set.view = true;                         // anything implies View
      return { ...prev, [key]: set };
    });
  };
  const rowAll = (m: string, on: boolean) => {
    if (readOnly) return;
    const key = m as keyof PermMatrix;
    setPerms(prev => ({ ...prev, [key]: on ? Object.fromEntries(MODULE_ACTIONS[key].map(a => [a, true])) : {} }));
  };
  const useTemplate = (i: number) => {
    const t = ROLE_TEMPLATES[i];
    setPerms(t.perms);
    setReach(t.reach);
    if (!name.trim()) setName(t.name);
    if (!description.trim()) setDescription(t.description);
  };

  const save = () => {
    if (!name.trim()) { toast.error("Give the role a name"); return; }
    const clean = normalisePerms(perms);
    const now = new Date().toISOString();
    updateDb(d => {
      if (!d.roles) d.roles = [];
      if (isNew) d.roles.push({ id: uid("role_"), name: name.trim(), description: description.trim() || undefined, perms: clean, reach, createdAt: now });
      else {
        const r = d.roles.find(x => x.id === role.id);
        if (r) { r.name = name.trim(); r.description = description.trim() || undefined; r.perms = clean; r.reach = reach; r.updatedAt = now; }
      }
    });
    toast.success(isNew ? `Role "${name.trim()}" created` : "Role saved — it applies straight away");
    onClose();
  };

  return (
    <Dialog open onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-3xl rounded-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-display text-2xl">{isNew ? "New role" : readOnly ? role.name : `Edit ${role.name}`}</DialogTitle>
        </DialogHeader>
        {role.builtIn && (
          <p className="text-xs text-muted-foreground -mt-2">
            Built in and fixed: what every employee could do before roles. Anyone without a role holds it.
          </p>
        )}
        {!readOnly && (
          <div className="grid sm:grid-cols-2 gap-3">
            <div><Label className="text-xs">Name</Label><Input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Accounts" className="rounded-xl mt-1" /></div>
            <div><Label className="text-xs">What it is for</Label><Input value={description} onChange={e => setDescription(e.target.value)} placeholder="optional" className="rounded-xl mt-1" /></div>
          </div>
        )}
        {isNew && (
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="text-muted-foreground">Start from:</span>
            {ROLE_TEMPLATES.map((t, i) => (
              <button key={t.name} onClick={() => useTemplate(i)} className="h-7 px-2.5 rounded-lg border border-border hover:bg-secondary">{t.name}</button>
            ))}
          </div>
        )}
        <div className="rounded-xl border border-border/60 p-3 space-y-2">
          <p className="text-sm font-semibold text-brand-dark">Whose orders and clients</p>
          <div className="grid sm:grid-cols-2 gap-2" role="radiogroup" aria-label="Whose orders and clients">
            {(["own", "all"] as RoleReach[]).map(k => (
              <button key={k} type="button" role="radio" aria-checked={reach === k} disabled={readOnly} onClick={() => setReach(k)}
                className={`text-left rounded-xl border p-3 transition-all disabled:cursor-default ${reach === k ? "border-primary ring-2 ring-primary/25 bg-primary/5" : "border-border/70 hover:border-primary/40"}`}>
                <span className="flex items-center gap-1.5 text-sm font-semibold text-brand-dark">
                  {k === "all" ? <Globe2 className="h-4 w-4 text-primary" /> : <UserRound className="h-4 w-4 text-primary" />} {REACH_LABEL[k]}
                </span>
                <span className="block text-[11px] text-muted-foreground mt-1 leading-snug">
                  {k === "own"
                    ? "Orders assigned to them, and every order of a client they are the account manager of. For sales."
                    : "Every order and every client, whoever they belong to. For production, quality, accounts or a manager."}
                </span>
              </button>
            ))}
          </div>
          <p className="text-[11px] text-muted-foreground">The ticks below decide what they may do with them — for example, see every order and only Edit (move stages, record details), without adding new ones.</p>
        </div>
        <div className="overflow-x-auto rounded-xl border border-border/60">
          <table className="w-full text-sm">
            <thead className="bg-secondary/50">
              <tr>
                <th className="text-left px-3 py-2 text-xs font-semibold text-muted-foreground">Section</th>
                {PERM_ACTIONS.map(a => <th key={a} className="px-2 py-2 text-xs font-semibold text-muted-foreground text-center">{ACTION_LABEL[a]}</th>)}
                {!readOnly && <th className="px-2 py-2 text-xs font-semibold text-muted-foreground text-center">All</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-border/40">
              {ROLE_MODULES.map(m => {
                const offered = MODULE_ACTIONS[m.key];
                const full = offered.every(a => has(m.key, a));
                return (
                  <tr key={m.key}>
                    <td className="px-3 py-1.5 font-medium text-brand-dark">{m.label}</td>
                    {PERM_ACTIONS.map(a => (
                      <td key={a} className="px-2 py-1.5 text-center">
                        {offered.includes(a)
                          ? <input type="checkbox" checked={has(m.key, a)} disabled={readOnly} onChange={() => toggle(m.key, a)} className="h-4 w-4 accent-primary" aria-label={`${m.label} ${ACTION_LABEL[a]}`} />
                          : <span className="text-muted-foreground/40">—</span>}
                      </td>
                    ))}
                    {!readOnly && (
                      <td className="px-2 py-1.5 text-center">
                        <input type="checkbox" checked={full} onChange={() => rowAll(m.key, !full)} className="h-4 w-4 accent-primary" aria-label={`${m.label} all`} />
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="text-[11px] text-muted-foreground">
          Employees, Settings and Activity belong to admins and are never part of a role. The dashboard is open to everyone.
          A dash means the section has no such action — orders, for one, are never deleted.
          Suppliers, factories, stock and gift cards are changed only by admins, so a role can show or export them but
          not change them. Cost price, profit and other employees' expenses stay with admins too.
        </p>
        <div className="flex gap-2 justify-end">
          <Button variant="outline" onClick={onClose} className="rounded-xl">{readOnly ? "Close" : "Cancel"}</Button>
          {!readOnly && <Button onClick={save} className="btn-hero rounded-xl">{isNew ? "Create role" : "Save role"}</Button>}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * On an employee's card: which role they hold, and whether they are an admin.
 * An owner (one of the founding admin emails) has neither control — nothing in
 * the app can demote them, so the business can never be locked out.
 */
export function EmployeeAccessControls({ u }: { u: User }) {
  const db = useDb();
  const live = rolesStoreReady();
  const owner = isAdminEmail(u.email);

  if (owner) {
    return (
      <p className="text-[11px] text-amber-700 flex items-center gap-1 mt-3">
        <Crown className="h-3 w-3" /> Owner — permanent admin, cannot be changed
      </p>
    );
  }

  const setRole = (roleId: string) => {
    updateDb(d => {
      const x = d.users.find(y => y.id === u.id);
      if (!x) return;
      if (roleId === STANDARD_STAFF.id) delete x.roleId; else x.roleId = roleId;
    });
    toast.success(`${u.name} now has ${roleId === STANDARD_STAFF.id ? STANDARD_STAFF.name : (db.roles ?? []).find(r => r.id === roleId)?.name ?? "that role"}`);
  };
  const setAdmin = async (on: boolean) => {
    if (!(await confirmBox(on
      ? `Make ${u.name} an admin?\n\nThey will be able to do everything — including managing employees, roles, settings and other admins. Owners stay owners.`
      : `Remove ${u.name} as an admin?\n\nThey become an employee with Standard staff access, which you can then narrow with a role.`))) return;
    updateDb(d => {
      const x = d.users.find(y => y.id === u.id);
      if (!x) return;
      x.role = on ? "admin" : "employee";
      if (on) delete x.roleId;
    });
    toast.success(on ? `${u.name} is now an admin` : `${u.name} is no longer an admin`);
  };

  if (u.role === "admin") {
    return (
      <div className="flex items-center justify-between gap-2 mt-3">
        <span className="text-[11px] text-amber-700 font-medium flex items-center gap-1"><ShieldCheck className="h-3 w-3" /> Admin — can do everything</span>
        {live && <button onClick={() => setAdmin(false)} className="text-[11px] text-destructive hover:underline">Remove admin</button>}
      </div>
    );
  }
  // An employee without a login cannot sign in, so a role would do nothing.
  if (!u.authUid) return null;
  const current = roleOf({ role: "employee", roleId: u.roleId }, db.roles ?? []);
  const sees = (current.reach ?? "own") === "all"
    ? null
    : { orders: currentUserOrders(db, u).length, clients: currentUserClients(db, u).length };
  return (
    <div className="mt-3 space-y-1">
    <div className="flex items-center gap-2">
      <select
        value={current.id}
        disabled={!live}
        onChange={e => setRole(e.target.value)}
        className="flex-1 h-8 rounded-lg border border-input bg-background px-2 text-xs disabled:opacity-60"
        aria-label={`Role for ${u.name}`}
      >
        {[STANDARD_STAFF, ...(db.roles ?? [])].map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
      </select>
      {live && <button onClick={() => setAdmin(true)} className="text-[11px] text-primary hover:underline whitespace-nowrap">Make admin</button>}
    </div>
    {sees === null
      ? <p className="text-[11px] text-muted-foreground">Sees every order and client</p>
      : sees.orders === 0 && sees.clients === 0
      ? <p className="text-[11px] text-amber-700">Sees no orders yet — assign orders or clients to them, or give a role that sees every order</p>
      : <p className="text-[11px] text-muted-foreground">Sees their own: {sees.orders} order{sees.orders !== 1 ? "s" : ""} · {sees.clients} client{sees.clients !== 1 ? "s" : ""}</p>}
    </div>
  );
}
