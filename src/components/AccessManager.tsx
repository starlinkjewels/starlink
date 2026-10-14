import { useMemo, useState } from "react";
import { Clock, Globe2, UserRound, Plus, RotateCcw, ShieldCheck, Minus, History, Save } from "lucide-react";
import { toast } from "sonner";
import { updateDbAs, uid, currentUserOrders, currentUserClients, type DB, type User } from "@/lib/db";
import { useDb } from "@/hooks/useDb";
import { useAuth } from "@/lib/auth";
import {
  ACTION_LABEL, MODULE_ACTIONS, PERM_ACTIONS, ROLE_MODULES, STANDARD_STAFF, REACH_LABEL,
  roleOf, rolesOnly, accessOf, userAccessId, applyOwn, diffFromRole, countCells, tempState, normalisePerms,
  effectivePerms, reachOf,
  type PermAction, type PermMatrix, type RoleReach, type TempAccess, type UserAccess, type AccessDoc, type StaffRole,
} from "@/lib/permissions";
import type { ModuleKey } from "@/lib/modules";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

/**
 * Each person's access, set when they are added and changed at any time.
 *
 * The usual way of doing it (role-based access with exceptions): a role is
 * the starting point — the template for a job — and stays linked, so a change
 * to the role reaches everyone who holds it. On top of it, per person:
 *   • a box ticked that the role does not give is added for them;
 *   • a box cleared that the role gives is taken away from them;
 *   • temporary access is given with a reason and an end, and ends by itself.
 * Kept in the roles store (lib/permissions.ts, UserAccess), which only an
 * admin may write.
 */

/** What the editor holds while it is open. */
export interface AccessDraft {
  roleId: string;
  reach: RoleReach;
  perms: PermMatrix;
  temp: TempAccess[];
}

export function draftFor(docs: AccessDoc[], u: Pick<User, "id" | "roleId"> | null): AccessDraft {
  const role = roleOf({ role: "employee", roleId: u?.roleId }, docs);
  const ua = u ? accessOf(docs, u.id) : undefined;
  return { roleId: role.id, reach: ua?.reach ?? role.reach ?? "own", perms: applyOwn(role.perms, ua?.add, ua?.remove), temp: ua?.temp ?? [] };
}

/** Save a person's access: the role on their profile, the rest in their own record. Call inside updateDb(). */
export function writeAccess(d: DB, userId: string, draft: AccessDraft, by: { name: string }, at: string): void {
  const u = d.users.find(x => x.id === userId);
  if (!u) return;
  if (draft.roleId === STANDARD_STAFF.id) delete u.roleId; else u.roleId = draft.roleId;
  if (!d.roles) d.roles = [];
  const role = roleOf({ role: "employee", roleId: draft.roleId }, d.roles);
  const { add, remove } = diffFromRole(role.perms, draft.perms);
  const reach = draft.reach === (role.reach ?? "own") ? undefined : draft.reach;
  const ua = accessOf(d.roles, userId);
  const keep = countCells(add) > 0 || countCells(remove) > 0 || !!reach || draft.temp.length > 0;
  if (!keep) { if (ua) d.roles = d.roles.filter(x => x !== ua); return; }
  const rec: UserAccess = ua ?? { id: userAccessId(userId), kind: "userAccess", userId, name: "", createdAt: at };
  rec.name = `Access — ${u.name}`;
  rec.add = countCells(add) ? add : undefined;
  rec.remove = countCells(remove) ? remove : undefined;
  rec.reach = reach;
  rec.temp = draft.temp.length ? draft.temp : undefined;
  rec.updatedAt = at;
  rec.updatedBy = by.name;
  if (!ua) d.roles.push(rec);
}

const has = (m: PermMatrix, mod: ModuleKey, a: PermAction) => !!m[mod]?.[a];
function toggleCell(m: PermMatrix, mod: ModuleKey, a: PermAction): PermMatrix {
  const set = { ...(m[mod] ?? {}) };
  const turnOn = !set[a];
  if (a === "view" && !turnOn) return { ...m, [mod]: {} };   // no View → nothing in it
  set[a] = turnOn;
  if (turnOn && a !== "view") set.view = true;               // anything implies View
  return { ...m, [mod]: set };
}
const rowAll = (m: PermMatrix, mod: ModuleKey, turnOn: boolean): PermMatrix =>
  ({ ...m, [mod]: turnOn ? Object.fromEntries(MODULE_ACTIONS[mod].map(a => [a, true])) : {} });

/**
 * The grid of sections × actions. With a role it shows where each tick comes
 * from: plain = from the role, green + = added for this person, red − = taken
 * away. Without one it is a plain picker (temporary access).
 */
export function PermGrid({ value, onChange, role, timed }: {
  value: PermMatrix;
  onChange: (m: PermMatrix) => void;
  role?: PermMatrix;
  /** Cells given by temporary access running now — marked with a clock. */
  timed?: PermMatrix;
}) {
  return (
    <div className="overflow-x-auto rounded-xl border border-border/60">
      <table className="w-full text-sm tbl-plain">
        <thead className="bg-secondary/50">
          <tr>
            <th className="text-left px-3 py-2 text-xs font-semibold text-muted-foreground">Section</th>
            {PERM_ACTIONS.map(a => <th key={a} className="px-1.5 py-2 text-xs font-semibold text-muted-foreground text-center">{ACTION_LABEL[a]}</th>)}
            <th className="px-1.5 py-2 text-xs font-semibold text-muted-foreground text-center">All</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border/40">
          {ROLE_MODULES.map(m => {
            const offered = MODULE_ACTIONS[m.key];
            const full = offered.every(a => has(value, m.key, a));
            return (
              <tr key={m.key}>
                <td className="px-3 py-1.5 font-medium text-brand-dark whitespace-nowrap">{m.label}</td>
                {PERM_ACTIONS.map(a => {
                  if (!offered.includes(a)) return <td key={a} className="px-1.5 py-1.5 text-center text-muted-foreground/40">—</td>;
                  const now = has(value, m.key, a);
                  const fromRole = role ? has(role, m.key, a) && has(role, m.key, "view") : now;
                  const added = !!role && now && !fromRole;
                  const removed = !!role && !now && fromRole;
                  const clock = !now && timed && has(timed, m.key, a);
                  return (
                    <td key={a} className="px-1.5 py-1 text-center">
                      <label title={added ? "Added for this person" : removed ? "Taken away from this person" : clock ? "Given for now — temporary access" : fromRole && role ? "From the role" : undefined}
                        className={`relative inline-grid place-items-center h-7 w-7 rounded-lg cursor-pointer ${added ? "bg-emerald-500/15 ring-1 ring-emerald-500/50" : removed ? "bg-destructive/10 ring-1 ring-destructive/40" : clock ? "bg-amber-500/15 ring-1 ring-amber-500/40" : ""}`}>
                        <input type="checkbox" checked={now} onChange={() => onChange(toggleCell(value, m.key, a))} className="h-4 w-4 accent-primary cursor-pointer" aria-label={`${m.label} ${ACTION_LABEL[a]}`} />
                        {added && <Plus className="absolute -top-1 -right-1 h-3 w-3 rounded-full bg-emerald-600 text-white p-[1px]" />}
                        {removed && <Minus className="absolute -top-1 -right-1 h-3 w-3 rounded-full bg-destructive text-white p-[1px]" />}
                        {clock && <Clock className="absolute -top-1 -right-1 h-3 w-3 rounded-full bg-amber-500 text-white p-[1px]" />}
                      </label>
                    </td>
                  );
                })}
                <td className="px-1.5 py-1 text-center">
                  <input type="checkbox" checked={full} onChange={() => onChange(rowAll(value, m.key, !full))} className="h-4 w-4 accent-primary cursor-pointer" aria-label={`${m.label} all`} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

const LEGEND = (
  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
    <span>Plain tick — from the role</span>
    <span className="inline-flex items-center gap-1"><span className="h-3 w-3 rounded bg-emerald-500/20 ring-1 ring-emerald-500/50" /> added for this person</span>
    <span className="inline-flex items-center gap-1"><span className="h-3 w-3 rounded bg-destructive/15 ring-1 ring-destructive/40" /> taken away</span>
    <span className="inline-flex items-center gap-1"><span className="h-3 w-3 rounded bg-amber-500/20 ring-1 ring-amber-500/40" /> temporary, running now</span>
  </div>
);

/* ── Temporary access ───────────────────────────────────────────────────── */

const DURATIONS: [string, number][] = [["1 day", 1], ["3 days", 3], ["1 week", 7], ["2 weeks", 14], ["30 days", 30], ["60 days", 60]];
const toLocalInput = (iso?: string) => {
  if (!iso) return "";
  const d = new Date(iso); const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};
const when = (iso: string) => new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" });
function left(iso: string, now: number): string {
  const ms = +new Date(iso) - now;
  const h = Math.round(ms / 3600e3);
  if (h < 1) return "less than an hour";
  if (h < 48) return `${h} hour${h !== 1 ? "s" : ""}`;
  const d = Math.round(h / 24);
  return `${d} day${d !== 1 ? "s" : ""}`;
}
/** "Orders: View, Edit · Payments: View" — what a grant gives, in words. */
export function permWords(p: PermMatrix, reach?: "all"): string {
  const parts = ROLE_MODULES.filter(m => p[m.key]?.view).map(m => `${m.label}: ${MODULE_ACTIONS[m.key].filter(a => p[m.key]?.[a]).map(a => ACTION_LABEL[a]).join(", ")}`);
  if (reach === "all") parts.unshift("Every order & client");
  return parts.join(" · ") || "Nothing";
}

function TempList({ temp, onEnd }: { temp: TempAccess[]; onEnd: (id: string) => void }) {
  const now = Date.now();
  const [showOld, setShowOld] = useState(false);
  const live = temp.filter(t => tempState(t, now) !== "ended");
  const old = temp.filter(t => tempState(t, now) === "ended").sort((a, b) => +new Date(b.endedAt ?? b.until) - +new Date(a.endedAt ?? a.until));
  return (
    <div className="space-y-2">
      {live.length === 0 && <p className="text-xs text-muted-foreground">No temporary access right now.</p>}
      {live.map(t => {
        const st = tempState(t, now);
        return (
          <div key={t.id} className={`rounded-xl border p-3 text-xs space-y-1 ${st === "active" ? "border-amber-500/40 bg-amber-500/5" : "border-primary/30 bg-primary/5"}`}>
            <div className="flex items-start justify-between gap-2">
              <p className="font-semibold text-brand-dark flex items-center gap-1.5"><Clock className="h-3.5 w-3.5 text-amber-600 shrink-0" />{permWords(t.perms, t.reach)}</p>
              <button type="button" onClick={() => onEnd(t.id)} className="shrink-0 text-destructive font-semibold hover:underline">{st === "active" ? "End now" : "Cancel"}</button>
            </div>
            <p className="text-muted-foreground">
              {st === "active" ? <>Active · ends {when(t.until)} <span className="font-medium text-amber-700">({left(t.until, now)} left)</span></> : <>Starts {when(t.from!)} · ends {when(t.until)}</>}
            </p>
            {t.reason && <p className="text-muted-foreground">Why: {t.reason} · given by {t.byName}</p>}
          </div>
        );
      })}
      {old.length > 0 && (
        <div>
          <button type="button" onClick={() => setShowOld(v => !v)} className="text-[11px] font-medium text-muted-foreground hover:text-foreground inline-flex items-center gap-1">
            <History className="h-3 w-3" /> {showOld ? "Hide" : "Show"} past temporary access ({old.length})
          </button>
          {showOld && (
            <div className="mt-1.5 space-y-1.5">
              {old.map(t => (
                <div key={t.id} className="rounded-lg bg-secondary/50 px-3 py-2 text-[11px] text-muted-foreground">
                  <span className="font-medium text-foreground/80">{permWords(t.perms, t.reach)}</span> — {t.endedAt ? `ended early ${when(t.endedAt)}${t.endedByName ? ` by ${t.endedByName}` : ""}` : `ended ${when(t.until)}`}{t.reason ? ` · ${t.reason}` : ""} · given by {t.byName}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function AddTemp({ onAdd, by }: { onAdd: (t: TempAccess) => void; by: { id: string; name: string } }) {
  const [open, setOpen] = useState(false);
  const [perms, setPerms] = useState<PermMatrix>({});
  const [reachAll, setReachAll] = useState(false);
  const [startLater, setStartLater] = useState(false);
  const [from, setFrom] = useState("");
  const [days, setDays] = useState<number | "custom">(7);
  const [until, setUntil] = useState("");
  const [reason, setReason] = useState("");
  if (!open) {
    return <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)} className="rounded-lg gap-1.5"><Plus className="h-3.5 w-3.5" /> Give temporary access</Button>;
  }
  const start = startLater && from ? new Date(from) : new Date();
  const end = days === "custom" ? (until ? new Date(until) : null) : new Date(+start + days * 86400e3);
  const add = () => {
    const p = normalisePerms(perms);
    if (!countCells(p) && !reachAll) { toast.error("Tick what they may do for the time, or every order"); return; }
    if (!end || +end <= +start) { toast.error("Choose when it ends — after it starts"); return; }
    if (!reason.trim()) { toast.error("Say why — it is kept with the access"); return; }
    onAdd({
      id: uid("ta_"), perms: p, reach: reachAll ? "all" : undefined, from: startLater && from ? start.toISOString() : undefined,
      until: end.toISOString(), reason: reason.trim(), by: by.id, byName: by.name, at: new Date().toISOString(),
    });
    setOpen(false); setPerms({}); setReachAll(false); setReason(""); setStartLater(false); setFrom(""); setDays(7); setUntil("");
  };
  return (
    <div className="rounded-xl border border-amber-500/40 bg-amber-500/5 p-3 space-y-3">
      <p className="text-sm font-semibold text-brand-dark flex items-center gap-1.5"><Clock className="h-4 w-4 text-amber-600" /> Temporary access</p>
      <PermGrid value={perms} onChange={setPerms} />
      <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={reachAll} onChange={e => setReachAll(e.target.checked)} className="h-4 w-4 accent-primary" /> Also every order &amp; client for the time</label>
      <div className="space-y-1.5">
        <p className="text-xs text-muted-foreground">For how long</p>
        <div className="flex flex-wrap gap-1.5">
          {DURATIONS.map(([l, n]) => (
            <button key={n} type="button" onClick={() => setDays(n)} className={`h-7 px-2.5 rounded-lg border text-xs ${days === n ? "border-primary bg-primary/10 text-primary font-semibold" : "border-border hover:bg-secondary"}`}>{l}</button>
          ))}
          <button type="button" onClick={() => setDays("custom")} className={`h-7 px-2.5 rounded-lg border text-xs ${days === "custom" ? "border-primary bg-primary/10 text-primary font-semibold" : "border-border hover:bg-secondary"}`}>Until a date…</button>
        </div>
        {days === "custom" && <Input type="datetime-local" value={until} onChange={e => setUntil(e.target.value)} className="h-9 rounded-lg max-w-xs" aria-label="Ends at" />}
        <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={startLater} onChange={e => setStartLater(e.target.checked)} className="h-4 w-4 accent-primary" /> Starts later</label>
        {startLater && <Input type="datetime-local" value={from} onChange={e => setFrom(e.target.value)} className="h-9 rounded-lg max-w-xs" aria-label="Starts at" />}
        {end && +end > +start && <p className="text-[11px] text-muted-foreground">From {startLater && from ? when(start.toISOString()) : "now"} until <span className="font-semibold text-foreground">{when(end.toISOString())}</span> — it ends by itself.</p>}
      </div>
      <div>
        <Label className="text-xs">Why</Label>
        <Input value={reason} onChange={e => setReason(e.target.value)} placeholder="e.g. covering for Ravi while he is away" className="h-9 rounded-lg mt-1" />
      </div>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)} className="rounded-lg">Cancel</Button>
        <Button type="button" size="sm" onClick={add} className="btn-hero rounded-lg">Add</Button>
      </div>
    </div>
  );
}

/* ── The whole editor: role, whose work, the grid, temporary access ──────── */

export function AccessFields({ draft, onChange, docs, by }: {
  draft: AccessDraft; onChange: (d: AccessDraft) => void; docs: AccessDoc[]; by: { id: string; name: string };
}) {
  const roles = [STANDARD_STAFF, ...rolesOnly(docs)];
  const role = roles.find(r => r.id === draft.roleId) ?? STANDARD_STAFF;
  const own = diffFromRole(role.perms, draft.perms);
  const changed = countCells(own.add) + countCells(own.remove);
  const timed = useMemo(() => {
    const now = Date.now();
    return applyOwn({}, undefined, undefined, draft.temp.filter(t => tempState(t, now) === "active").map(t => t.perms));
  }, [draft.temp]);
  const pickRole = (id: string) => {
    const next = roles.find(r => r.id === id) ?? STANDARD_STAFF;
    // This person's own changes stay, on top of the new role.
    onChange({ ...draft, roleId: next.id, perms: applyOwn(next.perms, own.add, own.remove), reach: draft.reach === (role.reach ?? "own") ? next.reach ?? "own" : draft.reach });
  };
  return (
    <div className="space-y-4">
      <div className="grid sm:grid-cols-2 gap-3 items-start">
        <div>
          <Label className="text-xs">Start from role</Label>
          <Select value={draft.roleId} onValueChange={pickRole}>
            <SelectTrigger className="h-10 rounded-xl mt-1" aria-label="Role"><SelectValue /></SelectTrigger>
            <SelectContent>{roles.map(r => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}</SelectContent>
          </Select>
          {role.description && <p className="text-[11px] text-muted-foreground mt-1">{role.description}</p>}
        </div>
        <div>
          <Label className="text-xs">Whose orders and clients</Label>
          <div className="grid grid-cols-2 gap-1.5 mt-1" role="radiogroup" aria-label="Whose orders and clients">
            {(["own", "all"] as RoleReach[]).map(k => (
              <button key={k} type="button" role="radio" aria-checked={draft.reach === k} onClick={() => onChange({ ...draft, reach: k })}
                className={`text-left rounded-xl border px-2.5 py-2 text-xs transition-all ${draft.reach === k ? "border-primary ring-2 ring-primary/25 bg-primary/5 font-semibold text-brand-dark" : "border-border/70 hover:border-primary/40"}`}>
                <span className="flex items-center gap-1.5">{k === "all" ? <Globe2 className="h-3.5 w-3.5 text-primary" /> : <UserRound className="h-3.5 w-3.5 text-primary" />}{k === "all" ? "Every order" : "Their own"}</span>
              </button>
            ))}
          </div>
          <p className="text-[11px] text-muted-foreground mt-1">
            {draft.reach === (role.reach ?? "own") ? `As the role (${REACH_LABEL[role.reach ?? "own"]})` : `Changed for this person — the role says ${REACH_LABEL[role.reach ?? "own"].toLowerCase()}`}
          </p>
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <p className="text-sm font-semibold text-brand-dark">What they may do</p>
          {changed > 0 && (
            <button type="button" onClick={() => onChange({ ...draft, perms: applyOwn(role.perms) })} className="text-xs text-primary hover:underline inline-flex items-center gap-1">
              <RotateCcw className="h-3 w-3" /> Back to the role ({changed} change{changed !== 1 ? "s" : ""})
            </button>
          )}
        </div>
        {LEGEND}
        <PermGrid value={draft.perms} onChange={p => onChange({ ...draft, perms: p })} role={role.perms} timed={timed} />
        <p className="text-[11px] text-muted-foreground">Employees, Settings and Activity belong to admins only. The dashboard is open to everyone. A dash means the section has no such action.</p>
      </div>

      <div className="space-y-2">
        <p className="text-sm font-semibold text-brand-dark flex items-center gap-1.5"><Clock className="h-4 w-4 text-amber-600" /> Temporary access</p>
        <p className="text-[11px] text-muted-foreground -mt-1">Extra access for a while — covering for someone, a month-end, a project. It ends by itself and stays in the history.</p>
        <TempList temp={draft.temp} onEnd={id => onChange({ ...draft, temp: draft.temp.map(t => t.id === id ? { ...t, endedAt: new Date().toISOString(), endedByName: by.name } : t) })} />
        <AddTemp by={by} onAdd={t => onChange({ ...draft, temp: [...draft.temp, t] })} />
      </div>
    </div>
  );
}

/** Employees page: one person's access, changed at any time. Admin only. */
export function ManageAccessDialog({ u, onClose }: { u: User; onClose: () => void }) {
  const db = useDb();
  const { user } = useAuth();
  const docs = db.roles ?? [];
  const [draft, setDraft] = useState<AccessDraft>(() => draftFor(docs, u));
  const [roleName, setRoleName] = useState<string | null>(null);
  const by = { id: user?.id ?? "", name: user?.name ?? "Admin" };
  const save = () => {
    updateDbAs({ summary: `Changed ${u.name}'s access` }, d => writeAccess(d, u.id, draft, by, new Date().toISOString()));
    toast.success(`${u.name}'s access is saved — it applies straight away`);
    onClose();
  };
  const saveAsRole = () => {
    const name = roleName ?? "";
    if (!name.trim()) { toast.error("Name the new role"); return; }
    const at = new Date().toISOString();
    const id = uid("role_");
    updateDbAs({ summary: `Made role "${name.trim()}" from ${u.name}'s access` }, d => {
      if (!d.roles) d.roles = [];
      d.roles.push({ id, name: name.trim(), perms: normalisePerms(draft.perms), reach: draft.reach, createdAt: at } as StaffRole);
      writeAccess(d, u.id, { ...draft, roleId: id }, by, at);
    });
    toast.success(`Role "${name.trim()}" created — give it to others with the same job`);
    onClose();
  };
  return (
    <Dialog open onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-3xl rounded-2xl">
        <DialogHeader>
          <DialogTitle className="font-display text-2xl flex items-center gap-2"><ShieldCheck className="h-5 w-5 text-primary" /> Access — {u.name}</DialogTitle>
          <DialogDescription className="text-xs">Their role is the starting point. Change anything for them alone, or give temporary access that ends by itself. Saved changes apply at once.</DialogDescription>
        </DialogHeader>
        <AccessFields draft={draft} onChange={setDraft} docs={docs} by={by} />
        {roleName !== null && (
          <div className="rounded-xl border border-primary/30 bg-primary/5 p-3 space-y-2">
            <p className="text-sm font-semibold text-brand-dark">Save as a new role</p>
            <p className="text-[11px] text-muted-foreground">The role gets exactly this person's access (not the temporary part), and they are moved onto it — then give it to others with the same job.</p>
            <div className="flex gap-2">
              <Input autoFocus value={roleName} onChange={e => setRoleName(e.target.value)} placeholder="Role name, e.g. Senior sales" className="h-9 rounded-lg" />
              <Button size="sm" onClick={saveAsRole} className="btn-hero rounded-lg h-9">Create role</Button>
              <Button size="sm" variant="ghost" onClick={() => setRoleName(null)} className="rounded-lg h-9">Cancel</Button>
            </div>
          </div>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={() => setRoleName(roleName === null ? "" : null)} className="rounded-xl mr-auto gap-1.5 text-primary max-sm:hidden" title="Turn this person's access into a role others can be given"><Plus className="h-4 w-4" /> Save as a new role</Button>
          <Button variant="outline" onClick={onClose} className="rounded-xl">Cancel</Button>
          <Button onClick={save} className="btn-hero rounded-xl px-5 gap-1.5"><Save className="h-4 w-4" /> Save access</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** One line on an employee's card: their role, what is changed for them, what is temporary, what they see. */
export function AccessSummary({ u, db }: { u: User; db: DB }) {
  const docs = db.roles ?? [];
  const role = roleOf(u, docs);
  const ua = accessOf(docs, u.id);
  const now = Date.now();
  const changes = countCells(ua?.add) + countCells(ua?.remove) + (ua?.reach ? 1 : 0);
  const live = (ua?.temp ?? []).filter(t => tempState(t, now) !== "ended");
  const reach = reachOf(u, docs, now);
  const sections = Object.keys(effectivePerms(u, docs, now)).length;
  const sees = reach === "all" ? null : { orders: currentUserOrders(db, u).length, clients: currentUserClients(db, u).length };
  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
        <span className="font-semibold px-2 py-0.5 rounded-md bg-primary/10 text-primary">{role.name}</span>
        {changes > 0 && <span className="font-medium px-2 py-0.5 rounded-md bg-emerald-500/10 text-emerald-700">{changes} change{changes !== 1 ? "s" : ""} for them</span>}
        {live.map(t => (
          <span key={t.id} title={permWords(t.perms, t.reach)} className="font-medium px-2 py-0.5 rounded-md bg-amber-500/15 text-amber-700 inline-flex items-center gap-1">
            <Clock className="h-3 w-3" />{tempState(t, now) === "upcoming" ? `from ${new Date(t.from!).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}` : `until ${new Date(t.until).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}`}
          </span>
        ))}
      </div>
      <p className="text-[11px] text-muted-foreground">
        {sections} section{sections !== 1 ? "s" : ""} ·{" "}
        {sees === null ? "every order and client" : sees.orders === 0 && sees.clients === 0
          ? <span className="text-amber-700">no orders yet — assign some, or allow every order</span>
          : `their own: ${sees.orders} order${sees.orders !== 1 ? "s" : ""}, ${sees.clients} client${sees.clients !== 1 ? "s" : ""}`}
      </p>
    </div>
  );
}
