import { Fragment, useMemo, useState } from "react";
import { Clock, Globe2, UserRound, Plus, RotateCcw, ShieldCheck, Minus, History, Save, ChevronRight } from "lucide-react";
import { FEATURES, FEATURE_BY_KEY, FIGURES, STD_FEATURES, featuresOf, hasLimits, type AccessLimits, type FeatureDef } from "@/lib/accessFeatures";
import { toast } from "sonner";
import { updateDbAs, uid, currentUserOrders, currentUserClients, type DB, type User } from "@/lib/db";
import { confirmBox } from "@/lib/confirm";
import { useDb } from "@/hooks/useDb";
import { useAuth } from "@/lib/auth";
import { TableBox } from "@/components/TableBox";
import {
  ACTION_LABEL, MODULE_ACTIONS, PERM_ACTIONS, ROLE_MODULES, STANDARD_STAFF, REACH_LABEL, ROLE_TEMPLATES,
  roleOf, rolesOnly, accessOf, userAccessId, applyOwn, diffFromRole, countCells, tempState, normalisePerms,
  effectivePerms, reachOf, chosenFeatures, effectiveFeatures,
  type PermAction, type PermMatrix, type RoleReach, type TempAccess, type UserAccess, type AccessDoc, type StaffRole,
} from "@/lib/permissions";
import type { ModuleKey } from "@/lib/modules";
import { fullStageOrder, stageLabel } from "@/lib/stages";
import { readyStockOffices } from "@/lib/offices";
import { tableRate } from "@/lib/currency";
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
  /** The finer switches ticked (accessFeatures.ts). */
  features: string[];
  limits: AccessLimits;
}

export function draftFor(docs: AccessDoc[], u: Pick<User, "id" | "roleId"> | null): AccessDraft {
  const role = roleOf({ role: "employee", roleId: u?.roleId }, docs);
  const ua = u ? accessOf(docs, u.id) : undefined;
  return {
    roleId: role.id, reach: ua?.reach ?? role.reach ?? "own", perms: applyOwn(role.perms, ua?.add, ua?.remove), temp: ua?.temp ?? [],
    features: [...chosenFeatures(ua, Date.now(), false)].filter(k => FEATURE_BY_KEY[k]),
    limits: ua?.limits ?? {},
  };
}

/** Limits as kept: empty lists and blank numbers mean no limit, and are not kept. */
function tidyLimits(l: AccessLimits): AccessLimits | undefined {
  const out: AccessLimits = {};
  if (l.stages?.length) out.stages = [...l.stages];
  if (l.offices?.length) out.offices = [...l.offices];
  if (l.backDays != null && Number.isFinite(l.backDays) && l.backDays >= 0) out.backDays = Math.floor(l.backDays);
  if (l.maxAmountUsd != null && Number.isFinite(l.maxAmountUsd) && l.maxAmountUsd > 0) out.maxAmountUsd = l.maxAmountUsd;
  return hasLimits(out) ? out : undefined;
}

/** Save a person's access in their own record. Call inside updateDb(). */
export function writeAccess(d: DB, userId: string, draft: AccessDraft, by: { name: string }, at: string): void {
  const u = d.users.find(x => x.id === userId);
  if (!u) return;
  // Access is the person's own: kept as how it differs from "everything"
  // (Standard staff), with no live link to a template.
  delete u.roleId;
  if (!d.roles) d.roles = [];
  const { add, remove } = diffFromRole(STANDARD_STAFF.perms, draft.perms);
  const reach = draft.reach === "own" ? undefined : draft.reach;
  const ua = accessOf(d.roles, userId);
  // The switches, as how they differ from Standard staff's — like the grid.
  const chosen = new Set(draft.features.filter(k => FEATURE_BY_KEY[k] && !FEATURE_BY_KEY[k].later));
  const featuresOn = FEATURES.filter(f => !f.std && chosen.has(f.key)).map(f => f.key);
  const featuresOff = FEATURES.filter(f => f.std && !chosen.has(f.key)).map(f => f.key);
  const limits = tidyLimits(draft.limits);
  const keep = countCells(add) > 0 || countCells(remove) > 0 || !!reach || draft.temp.length > 0
    || featuresOn.length > 0 || featuresOff.length > 0 || !!limits;
  if (!keep) { if (ua) d.roles = d.roles.filter(x => x !== ua); return; }
  const rec: UserAccess = ua ?? { id: userAccessId(userId), kind: "userAccess", userId, name: "", createdAt: at };
  rec.name = `Access — ${u.name}`;
  rec.add = countCells(add) ? add : undefined;
  rec.remove = countCells(remove) ? remove : undefined;
  rec.featuresOn = featuresOn.length ? featuresOn : undefined;
  rec.featuresOff = featuresOff.length ? featuresOff : undefined;
  rec.limits = limits;
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
 * A list of the finer switches (accessFeatures.ts): a box, what it lets them
 * do, a mark for the ones worth a second look, and the reason one can't be
 * ticked (its section's action is not given, or it is not grantable yet).
 */
function SwitchList({ defs, value, onChange, timed, blocked }: {
  defs: FeatureDef[];
  value: string[];
  onChange: (f: string[]) => void;
  timed?: string[];
  blocked?: (f: FeatureDef) => string | null | undefined;
}) {
  const flip = (k: string) => onChange(value.includes(k) ? value.filter(x => x !== k) : [...value, k]);
  return (
    <div className="grid sm:grid-cols-2 gap-x-4 gap-y-1.5">
      {defs.map(f => {
        const why = f.later ?? blocked?.(f) ?? null;
        const on = value.includes(f.key) && !f.later;
        const clock = !on && timed?.includes(f.key);
        return (
          <label key={f.key} title={why ?? f.help}
            className={`flex items-start gap-2 rounded-lg px-2 py-1.5 ${f.later ? "opacity-50 cursor-not-allowed" : "cursor-pointer hover:bg-secondary/60"} ${clock ? "bg-amber-500/10 ring-1 ring-amber-500/40" : ""}`}>
            <input type="checkbox" checked={on} disabled={!!f.later} onChange={() => flip(f.key)}
              className="h-4 w-4 mt-0.5 accent-primary shrink-0" aria-label={f.label} />
            <span className="min-w-0">
              <span className="text-xs font-medium text-brand-dark inline-flex items-center gap-1.5 flex-wrap">
                {f.label}
                {f.risky && <span className="text-[10px] font-semibold px-1.5 rounded bg-amber-500/15 text-amber-700">check before giving</span>}
                {clock && <Clock className="h-3 w-3 text-amber-600" />}
              </span>
              <span className="block text-[11px] text-muted-foreground leading-snug">{f.help}</span>
              {why && <span className={`block text-[11px] leading-snug ${f.later ? "text-muted-foreground" : on ? "text-amber-700" : "text-muted-foreground"}`}>{f.later ? why : on ? `${why} — ticked, but does nothing until then` : why}</span>}
            </span>
          </label>
        );
      })}
    </div>
  );
}

/**
 * The grid of sections × actions. With a role it shows where each tick comes
 * from: plain = from the role, green + = added for this person, red − = taken
 * away. Without one it is a plain picker (temporary access).
 */
export function PermGrid({ value, onChange, role, timed, scroll = false, features, onFeatures, timedFeatures }: {
  value: PermMatrix;
  onChange: (m: PermMatrix) => void;
  role?: PermMatrix;
  /** Cells given by temporary access running now — marked with a clock. */
  timed?: PermMatrix;
  /** Scrolls in its own box with the heading row held in view — for a long
   *  grid in a dialog. Off: the grid is as tall as its rows (as before). */
  scroll?: boolean;
  /** The finer switches (accessFeatures.ts), opened under each section's row. */
  features?: string[];
  onFeatures?: (f: string[]) => void;
  /** Switches given by temporary access running now. */
  timedFeatures?: string[];
}) {
  const [openRows, setOpenRows] = useState<Set<string>>(() => new Set());
  const toggleRow = (k: string) => setOpenRows(s => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  // The app's one table box; in a dialog it scrolls in its own height instead.
  return (
    <TableBox ownScroll={scroll} className={scroll ? "overflow-y-auto max-h-[min(22rem,55dvh)]" : ""}>
      <table className="w-full text-sm tbl-plain">
        {/* Held at the top it needs a solid colour, or the rows show through it. */}
        <thead className={scroll ? "sticky top-0 z-10 bg-[color-mix(in_oklab,var(--color-secondary)_50%,var(--color-card))] shadow-[0_1px_0_var(--color-border)]" : "bg-secondary/50"}>
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
            const subs = features ? featuresOf(m.key) : [];
            const subOn = subs.filter(f => features!.includes(f.key) && !f.later).length;
            const isOpen = openRows.has(m.key);
            return (
              <Fragment key={m.key}>
              <tr>
                <td className="px-3 py-1.5 font-medium text-brand-dark whitespace-nowrap">
                  {m.label}
                  {subs.length > 0 && (
                    <button type="button" onClick={() => toggleRow(m.key)} aria-expanded={isOpen}
                      className="ml-2 inline-flex items-center gap-0.5 text-[11px] font-medium text-primary hover:underline">
                      <ChevronRight className={`h-3 w-3 transition-transform ${isOpen ? "rotate-90" : ""}`} />
                      {subOn}/{subs.filter(f => !f.later).length} more
                    </button>
                  )}
                </td>
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
              {isOpen && subs.length > 0 && (
                <tr className="bg-secondary/30">
                  <td colSpan={PERM_ACTIONS.length + 2} className="px-3 py-2">
                    <SwitchList defs={subs} value={features!} onChange={onFeatures!} timed={timedFeatures}
                      blocked={f => f.needs && !has(value, m.key, f.needs) ? `Needs ${m.label} → ${ACTION_LABEL[f.needs]}` : null} />
                  </td>
                </tr>
              )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </TableBox>
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
const when = (iso: string) => new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" }).replace(/\bSept\b/, "Sep");
function left(iso: string, now: number): string {
  const ms = +new Date(iso) - now;
  const h = Math.round(ms / 3600e3);
  if (h < 1) return "less than an hour";
  if (h < 48) return `${h} hour${h !== 1 ? "s" : ""}`;
  const d = Math.round(h / 24);
  return `${d} day${d !== 1 ? "s" : ""}`;
}
/** "Orders: View, Edit · Payments: View" — what a grant gives, in words. */
export function permWords(p: PermMatrix, reach?: "all", features?: string[]): string {
  const parts = ROLE_MODULES.filter(m => p[m.key]?.view).map(m => `${m.label}: ${MODULE_ACTIONS[m.key].filter(a => p[m.key]?.[a]).map(a => ACTION_LABEL[a]).join(", ")}`);
  if (reach === "all") parts.unshift("Every order & client");
  for (const k of features ?? []) if (FEATURE_BY_KEY[k]) parts.push(FEATURE_BY_KEY[k].label);
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
              <p className="font-semibold text-brand-dark flex items-center gap-1.5"><Clock className="h-3.5 w-3.5 text-amber-600 shrink-0" />{permWords(t.perms, t.reach, t.features)}</p>
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
                  <span className="font-medium text-foreground/80">{permWords(t.perms, t.reach, t.features)}</span> — {t.endedAt ? `ended early ${when(t.endedAt)}${t.endedByName ? ` by ${t.endedByName}` : ""}` : `ended ${when(t.until)}`}{t.reason ? ` · ${t.reason}` : ""} · given by {t.byName}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function AddTemp({ onAdd, by, stacked = false }: {
  onAdd: (t: TempAccess) => void; by: { id: string; name: string };
  /** Under a section that is already headed "Temporary access": no second heading. */
  stacked?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [perms, setPerms] = useState<PermMatrix>({});
  const [feats, setFeats] = useState<string[]>([]);
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
    const f = feats.filter(k => FEATURE_BY_KEY[k] && !FEATURE_BY_KEY[k].later);
    if (!countCells(p) && !reachAll && !f.length) { toast.error("Tick what they may do for the time, or every order"); return; }
    if (!end || +end <= +start) { toast.error("Choose when it ends — after it starts"); return; }
    if (!reason.trim()) { toast.error("Say why — it is kept with the access"); return; }
    onAdd({
      id: uid("ta_"), perms: p, ...(f.length ? { features: f } : {}), reach: reachAll ? "all" : undefined, from: startLater && from ? start.toISOString() : undefined,
      until: end.toISOString(), reason: reason.trim(), by: by.id, byName: by.name, at: new Date().toISOString(),
    });
    setOpen(false); setPerms({}); setFeats([]); setReachAll(false); setReason(""); setStartLater(false); setFrom(""); setDays(7); setUntil("");
  };
  return (
    <div className="rounded-xl border border-amber-500/40 bg-amber-500/5 p-3 space-y-3">
      {!stacked && <p className="text-sm font-semibold text-brand-dark flex items-center gap-1.5"><Clock className="h-4 w-4 text-amber-600" /> Temporary access</p>}
      <PermGrid value={perms} onChange={setPerms} scroll={stacked} features={feats} onFeatures={setFeats} />
      <details className="rounded-lg border border-border/60 px-3 py-2">
        <summary className="text-xs font-medium cursor-pointer">Figures for the time</summary>
        <div className="pt-2"><SwitchList defs={[...featuresOf("dashboard"), ...FIGURES]} value={feats} onChange={setFeats} /></div>
      </details>
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

/** One-click starting points. A template only fills the boxes — nothing stays
 *  linked, so changing one person never changes another. */
export interface AccessTemplate { id: string; name: string; hint?: string; perms: PermMatrix; reach: RoleReach; custom?: boolean; features?: string[]; limits?: AccessLimits }
export function accessTemplates(docs: AccessDoc[]): AccessTemplate[] {
  return [
    { id: "t_all", name: "Everything", hint: "Every section except Employees, Settings and Activity — as every employee had before", perms: STANDARD_STAFF.perms, reach: "own" },
    ...ROLE_TEMPLATES.map(t => ({ id: `t_${t.name}`, name: t.name, hint: t.description, perms: normalisePerms(t.perms), reach: t.reach })),
    ...rolesOnly(docs).map(r => ({ id: r.id, name: r.name, hint: r.description, perms: r.perms, reach: r.reach ?? "own", custom: true, features: r.features, limits: r.limits })),
  ];
}

/** Two sets of switches are the same. */
const sameList = (a: string[], b: string[]) => a.length === b.length && a.every(k => b.includes(k));

/** The order steps and offices a limit can name, from the business's settings. */
function LimitsFields({ value, onChange, settings }: { value: AccessLimits; onChange: (l: AccessLimits) => void; settings: DB["settings"] }) {
  const steps = fullStageOrder(settings);
  const offices = readyStockOffices(settings);
  const flip = (list: string[] | undefined, k: string) => {
    const cur = list ?? [];
    const next = cur.includes(k) ? cur.filter(x => x !== k) : [...cur, k];
    return next.length ? next : undefined;
  };
  const chip = (on: boolean) => `h-7 px-2.5 rounded-lg border text-xs ${on ? "border-primary bg-primary/10 text-primary font-semibold" : "border-border hover:bg-secondary"}`;
  const num = (s: string) => (s.trim() === "" ? undefined : Math.max(0, Number(s)));
  return (
    <div className="grid md:grid-cols-2 gap-4">
      <div className="space-y-1.5">
        <Label className="text-xs">Order steps they may move</Label>
        <div className="flex flex-wrap gap-1.5">
          {steps.map(s => <button key={s} type="button" onClick={() => onChange({ ...value, stages: flip(value.stages, s) })} className={chip(!!value.stages?.includes(s))}>{stageLabel(s, settings)}</button>)}
        </div>
        <p className="text-[11px] text-muted-foreground">{value.stages?.length ? `Only these ${value.stages.length} step${value.stages.length !== 1 ? "s" : ""} — the rest they can see but not move.` : "None picked: every step their access allows."}</p>
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs">Ready Stock offices they may work in</Label>
        <div className="flex flex-wrap gap-1.5">
          {offices.length === 0 && <span className="text-[11px] text-muted-foreground">No offices set up.</span>}
          {offices.map(o => <button key={o} type="button" onClick={() => onChange({ ...value, offices: flip(value.offices, o) })} className={chip(!!value.offices?.includes(o))}>{o}</button>)}
        </div>
        <p className="text-[11px] text-muted-foreground">{value.offices?.length ? "Only pieces in these offices — the others are hidden from them." : "None picked: every office."}</p>
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs" htmlFor="lim-back">How far back they may enter or change records</Label>
        <div className="flex items-center gap-2">
          <Input id="lim-back" type="number" min={0} inputMode="numeric" value={value.backDays ?? ""} onChange={e => onChange({ ...value, backDays: num(e.target.value) })} placeholder="No limit" className="h-9 rounded-lg w-28" />
          <span className="text-xs text-muted-foreground">days</span>
        </div>
        <p className="text-[11px] text-muted-foreground">{value.backDays != null ? (value.backDays === 0 ? "Today only." : `Today and the ${value.backDays} day${value.backDays !== 1 ? "s" : ""} before.`) : "No limit (a closed year is locked for everyone anyway)."}</p>
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs" htmlFor="lim-amt">Largest money entry they may record</Label>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">$</span>
          <Input id="lim-amt" type="number" min={0} inputMode="decimal" value={value.maxAmountUsd ?? ""} onChange={e => onChange({ ...value, maxAmountUsd: num(e.target.value) || undefined })} placeholder="No limit" className="h-9 rounded-lg w-36" />
        </div>
        <p className="text-[11px] text-muted-foreground">{value.maxAmountUsd ? "Any payment, receipt, expense or transfer above this (in any currency, at the rate in Settings) is refused for them." : "No limit."}</p>
        {!!value.maxAmountUsd && tableRate(settings.currencyRates, "INR", "USD") == null && (
          <p className="text-[11px] font-medium text-amber-700">There is no $ rate in Settings → Pricing Rates yet — until there is, their rupee entries can't be checked and are refused.</p>
        )}
      </div>
    </div>
  );
}

export function AccessFields({ draft, onChange, docs, by, layout = "side", forUserId }: {
  draft: AccessDraft; onChange: (d: AccessDraft) => void; docs: AccessDoc[]; by: { id: string; name: string };
  /** Whose access this is — left out of "Copy from". */
  forUserId?: string;
  /** "side" (Manage access): temporary access in a column beside the grid on
   *  wide screens. "stacked" (Create employee): one under another, the grid full
   *  width in its own scroll box and temporary access below it — a side column
   *  in a narrower dialog squeezed its own grid until it was cut off. */
  layout?: "side" | "stacked";
}) {
  const stacked = layout === "stacked";
  const db = useDb();
  const templates = accessTemplates(docs);
  const timed = useMemo(() => {
    const now = Date.now();
    return applyOwn({}, undefined, undefined, draft.temp.filter(t => tempState(t, now) === "active").map(t => t.perms));
  }, [draft.temp]);
  const timedFeatures = useMemo(() => {
    const now = Date.now();
    return draft.temp.filter(t => tempState(t, now) === "active").flatMap(t => t.features ?? []);
  }, [draft.temp]);
  const same = (a: PermMatrix, b: PermMatrix) => countCells(diffFromRole(a, b).add) + countCells(diffFromRole(a, b).remove) === 0;
  const current = templates.find(t => same(t.perms, draft.perms) && t.reach === draft.reach && sameList(t.features ?? STD_FEATURES, draft.features));
  // Copy someone's access: another employee's whole access (not their temporary part).
  const others = db.users.filter(x => x.role === "employee" && x.status === "active" && x.id !== forUserId);
  const copyFrom = (id: string) => {
    const src = db.users.find(x => x.id === id);
    if (!src) return;
    const d = draftFor(docs, src);
    onChange({ ...draft, perms: d.perms, reach: d.reach, features: d.features, limits: d.limits });
    toast.success(`Filled in from ${src.name}'s access — change anything, then save`);
  };
  const homeAndFigures = [...featuresOf("dashboard"), ...FIGURES];
  const removeTemplate = async (t: AccessTemplate) => {
    if (!(await confirmBox(`Delete the template "${t.name}"?\n\nNobody loses anything: people who were given it keep exactly the access they have now.`))) return;
    const at = new Date().toISOString();
    updateDbAs({ summary: `Deleted access template "${t.name}"` }, d => {
      // Anyone still linked to it (from before access was per person) keeps
      // what it gives them, as their own.
      for (const u of d.users.filter(x => x.roleId === t.id)) writeAccess(d, u.id, draftFor(d.roles ?? [], u), by, at);
      d.roles = (d.roles ?? []).filter(x => x.id !== t.id);
    });
    toast.success(`Template "${t.name}" deleted`);
  };
  return (
    <div className={stacked ? "space-y-6" : "grid xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] gap-x-6 gap-y-4 items-start"}>
    <div className={stacked ? "space-y-6 min-w-0" : "space-y-4 min-w-0"}>
      <div className="space-y-1.5">
        <Label className="text-xs">Fill in from a template</Label>
        <div className="flex flex-wrap gap-1.5">
          {templates.map(t => (
            <span key={t.id} className="inline-flex">
              <button type="button" title={t.hint} onClick={() => onChange({ ...draft, perms: applyOwn(t.perms), reach: t.reach, features: [...(t.features ?? STD_FEATURES)], limits: t.limits ?? draft.limits })}
                className={`h-8 px-3 border text-xs font-medium transition-colors ${t.custom ? "rounded-l-lg" : "rounded-lg"} ${current?.id === t.id ? "border-primary bg-primary/10 text-primary font-semibold" : "border-border hover:bg-secondary"}`}>
                {t.name}
              </button>
              {t.custom && (
                <button type="button" onClick={() => removeTemplate(t)} title={`Delete the template "${t.name}"`} aria-label={`Delete template ${t.name}`}
                  className="h-8 px-1.5 rounded-r-lg border border-l-0 border-border text-muted-foreground hover:text-destructive hover:bg-destructive/10">×</button>
              )}
            </span>
          ))}
          <button type="button" onClick={() => onChange({ ...draft, perms: {}, features: [] })} className="h-8 px-3 rounded-lg border border-dashed border-border text-xs text-muted-foreground hover:bg-secondary">Clear all</button>
          {others.length > 0 && (
            <Select value="" onValueChange={copyFrom}>
              <SelectTrigger className="h-8 w-auto min-w-[10rem] rounded-lg text-xs" aria-label="Copy another person's access"><SelectValue placeholder="Copy from a person…" /></SelectTrigger>
              <SelectContent>
                {others.map(o => <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>)}
              </SelectContent>
            </Select>
          )}
        </div>
        <p className="text-[11px] text-muted-foreground">A template, or another person's access, only fills the boxes below — then change anything for this person. Nobody else is affected.</p>
      </div>

      <div>
        <Label className="text-xs">Whose orders and clients</Label>
        <div className="grid sm:grid-cols-2 gap-1.5 mt-1" role="radiogroup" aria-label="Whose orders and clients">
          {(["own", "all"] as RoleReach[]).map(k => (
            <button key={k} type="button" role="radio" aria-checked={draft.reach === k} onClick={() => onChange({ ...draft, reach: k })}
              className={`text-left rounded-xl border px-3 py-2 transition-all ${draft.reach === k ? "border-primary ring-2 ring-primary/25 bg-primary/5" : "border-border/70 hover:border-primary/40"}`}>
              <span className="flex items-center gap-1.5 text-xs font-semibold text-brand-dark">{k === "all" ? <Globe2 className="h-3.5 w-3.5 text-primary" /> : <UserRound className="h-3.5 w-3.5 text-primary" />}{REACH_LABEL[k]}</span>
              <span className="block text-[11px] text-muted-foreground mt-0.5">{k === "all" ? "Sees every order and client — but may only do what is ticked below." : "Orders assigned to them, and orders of clients they manage."}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-2">
        <p className="text-sm font-semibold text-brand-dark">What they may do</p>
        <p className="text-[11px] text-muted-foreground -mt-1">View lets them open a section and look. Add, Edit and Delete are the changes they may make there; Export, the downloads and prints. Nothing else is offered to them.</p>
        <PermGrid value={draft.perms} onChange={p => onChange({ ...draft, perms: p })} timed={timed} scroll={stacked}
          features={draft.features} onFeatures={f => onChange({ ...draft, features: f })} timedFeatures={timedFeatures} />
        <p className="text-[11px] text-muted-foreground">"more" opens a section's finer switches — approve, cancel, assign, pay… Employees, Settings and Activity belong to admins only. The dashboard is open to everyone. A dash means the section has no such action. <span className="inline-flex items-center gap-1"><span className="h-3 w-3 rounded bg-amber-500/20 ring-1 ring-amber-500/40" /> temporary access running now</span></p>
      </div>

      <div className="space-y-2">
        <p className="text-sm font-semibold text-brand-dark">Figures they may see</p>
        <p className="text-[11px] text-muted-foreground -mt-1">These follow them through every page — a figure switched off is hidden wherever it appears.</p>
        <SwitchList defs={homeAndFigures} value={draft.features} onChange={f => onChange({ ...draft, features: f })} timed={timedFeatures} />
      </div>

      <div className="space-y-2">
        <p className="text-sm font-semibold text-brand-dark">Limits</p>
        <p className="text-[11px] text-muted-foreground -mt-1">Where and how much — on top of what is ticked above. Left empty, there is no limit.</p>
        <LimitsFields value={draft.limits} onChange={l => onChange({ ...draft, limits: l })} settings={db.settings} />
      </div>

    </div>
      {stacked ? (
        // Below the grid, never beside it: a heading, and "Give temporary
        // access" opens the form (its Cancel folds it away again).
        <div className="space-y-3 min-w-0 border-t border-border/60 pt-5">
          <div>
            <p className="text-sm font-semibold text-brand-dark flex items-center gap-1.5"><Clock className="h-4 w-4 text-amber-600" /> Temporary access <span className="text-[11px] font-normal text-muted-foreground">— optional</span></p>
            <p className="text-[11px] text-muted-foreground mt-0.5">Extra access for a while — covering for someone, a month-end, a project. It ends by itself and stays in the history.</p>
          </div>
          {draft.temp.length > 0 && <TempList temp={draft.temp} onEnd={id => onChange({ ...draft, temp: draft.temp.map(t => t.id === id ? { ...t, endedAt: new Date().toISOString(), endedByName: by.name } : t) })} />}
          <AddTemp stacked by={by} onAdd={t => onChange({ ...draft, temp: [...draft.temp, t] })} />
        </div>
      ) : (
      <div className="space-y-2 min-w-0 xl:sticky xl:top-0 xl:rounded-2xl xl:border xl:border-border/60 xl:p-4">
        <p className="text-sm font-semibold text-brand-dark flex items-center gap-1.5"><Clock className="h-4 w-4 text-amber-600" /> Temporary access</p>
        <p className="text-[11px] text-muted-foreground -mt-1">Extra access for a while — covering for someone, a month-end, a project. It ends by itself and stays in the history.</p>
        <TempList temp={draft.temp} onEnd={id => onChange({ ...draft, temp: draft.temp.map(t => t.id === id ? { ...t, endedAt: new Date().toISOString(), endedByName: by.name } : t) })} />
        <AddTemp by={by} onAdd={t => onChange({ ...draft, temp: [...draft.temp, t] })} />
      </div>
      )}
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
  const [showing, setShowing] = useState<"set" | "preview">("set");
  const by = { id: user?.id ?? "", name: user?.name ?? "Admin" };
  const save = () => {
    updateDbAs({ summary: `Changed ${u.name}'s access` }, d => writeAccess(d, u.id, draft, by, new Date().toISOString()));
    toast.success(`${u.name}'s access is saved — it applies straight away`);
    onClose();
  };
  const saveAsRole = () => {
    const name = roleName ?? "";
    if (!name.trim()) { toast.error("Name the template"); return; }
    const at = new Date().toISOString();
    const id = uid("role_");
    updateDbAs({ summary: `Saved access template "${name.trim()}" from ${u.name}'s access` }, d => {
      if (!d.roles) d.roles = [];
      d.roles.push({ id, name: name.trim(), perms: normalisePerms(draft.perms), reach: draft.reach, features: draft.features.filter(k => FEATURE_BY_KEY[k] && !FEATURE_BY_KEY[k].later), ...(hasLimits(draft.limits) ? { limits: draft.limits } : {}), createdAt: at } as StaffRole);
    });
    toast.success(`Template "${name.trim()}" saved — it is offered when setting anyone's access`);
    setRoleName(null);
  };
  return (
    <Dialog open onOpenChange={v => !v && onClose()}>
      <DialogContent panel className="max-w-6xl rounded-2xl">
        <DialogHeader>
          <DialogTitle className="font-display text-2xl flex items-center gap-2"><ShieldCheck className="h-5 w-5 text-primary" /> Access — {u.name}</DialogTitle>
          <DialogDescription className="text-xs">Tick exactly what this person may see and do — a template fills it in one click. Give temporary access that ends by itself. Saved changes apply at once.</DialogDescription>
        </DialogHeader>
        <div className="flex gap-1.5" role="tablist" aria-label="Access">
          {([["set", "Set access"], ["preview", "What they can do"]] as const).map(([k, l]) => (
            <button key={k} type="button" role="tab" aria-selected={showing === k} onClick={() => setShowing(k)}
              className={`h-8 px-3 rounded-lg border text-xs font-medium ${showing === k ? "border-primary bg-primary/10 text-primary font-semibold" : "border-border hover:bg-secondary"}`}>{l}</button>
          ))}
        </div>
        {showing === "set"
          ? <AccessFields draft={draft} onChange={setDraft} docs={docs} by={by} forUserId={u.id} />
          : <AccessPreview draft={draft} settings={db.settings} />}
        {roleName !== null && (
          <div className="rounded-xl border border-primary/30 bg-primary/5 p-3 space-y-2">
            <p className="text-sm font-semibold text-brand-dark">Save as a template</p>
            <p className="text-[11px] text-muted-foreground">A one-click starting point with exactly this access (not the temporary part), for the next person in the same job.</p>
            <div className="flex gap-2">
              <Input autoFocus value={roleName} onChange={e => setRoleName(e.target.value)} placeholder="Template name, e.g. Senior sales" className="h-9 rounded-lg" />
              <Button size="sm" onClick={saveAsRole} className="btn-hero rounded-lg h-9">Save template</Button>
              <Button size="sm" variant="ghost" onClick={() => setRoleName(null)} className="rounded-lg h-9">Cancel</Button>
            </div>
          </div>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={() => setRoleName(roleName === null ? "" : null)} className="rounded-xl mr-auto gap-1.5 text-primary max-sm:hidden" title="Keep this access as a one-click template for others"><Plus className="h-4 w-4" /> Save as a template</Button>
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
  const mine = applyOwn(role.perms, ua?.add, ua?.remove);
  const myFeatures = [...chosenFeatures(ua, now, false)].filter(k => FEATURE_BY_KEY[k]);
  const tpl = accessTemplates(docs).find(t => countCells(diffFromRole(t.perms, mine).add) + countCells(diffFromRole(t.perms, mine).remove) === 0
    && t.reach === (ua?.reach ?? role.reach ?? "own") && sameList(t.features ?? STD_FEATURES, myFeatures) && !hasLimits(ua?.limits));
  const live = (ua?.temp ?? []).filter(t => tempState(t, now) !== "ended");
  const reach = reachOf(u, docs, now);
  const sections = Object.keys(effectivePerms(u, docs, now)).length;
  const sees = reach === "all" ? null : { orders: currentUserOrders(db, u).length, clients: currentUserClients(db, u).length };
  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
        <span className="font-semibold px-2 py-0.5 rounded-md bg-primary/10 text-primary">{tpl ? `${tpl.name} access` : "Custom access"}</span>
        {hasLimits(ua?.limits) && <span title={limitWords(ua!.limits!, db.settings).join(" · ")} className="font-medium px-2 py-0.5 rounded-md bg-secondary text-foreground/80">with limits</span>}
        {live.map(t => (
          <span key={t.id} title={permWords(t.perms, t.reach, t.features)} className="font-medium px-2 py-0.5 rounded-md bg-amber-500/15 text-amber-700 inline-flex items-center gap-1">
            <Clock className="h-3 w-3" />{tempState(t, now) === "upcoming" ? `from ${new Date(t.from!).toLocaleDateString("en-IN", { day: "numeric", month: "short" }).replace(/\bSept\b/, "Sep")}` : `until ${new Date(t.until).toLocaleDateString("en-IN", { day: "numeric", month: "short" }).replace(/\bSept\b/, "Sep")}`}
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

/* ── Seeing access in plain words ───────────────────────────────────────── */

/** What a set of boxes gives, worked out the way the app checks it (lib/permissions.ts). */
function effectiveOfDraft(draft: Pick<AccessDraft, "perms" | "features">) {
  const perms = normalisePerms(draft.perms);
  const allows = (m: ModuleKey | null, a: PermAction = "view") => m === null || m === "dashboard" || !!perms[m]?.[a];
  const on = FEATURES.filter(f => draft.features.includes(f.key) && !f.later && allows(f.module, f.needs ?? "view"));
  const idle = FEATURES.filter(f => draft.features.includes(f.key) && !f.later && !allows(f.module, f.needs ?? "view"));
  return { perms, on: new Set(on.map(f => f.key)), idle };
}

function limitWords(l: AccessLimits, settings: DB["settings"]): string[] {
  const out: string[] = [];
  if (l.stages?.length) out.push(`Moves only these order steps: ${l.stages.map(s => stageLabel(s, settings)).join(", ")}`);
  if (l.offices?.length) out.push(`Ready Stock only in: ${l.offices.join(", ")}`);
  if (l.backDays != null) out.push(l.backDays === 0 ? "Enters and changes today's records only" : `Enters and changes records of the last ${l.backDays} day${l.backDays !== 1 ? "s" : ""} only`);
  if (l.maxAmountUsd) out.push(`No single money entry above $${l.maxAmountUsd.toLocaleString("en-US")}`);
  return out;
}

/** The limits in a few words — for the report's narrow column. */
function limitShort(l: AccessLimits): string {
  return [
    l.offices?.length ? l.offices.join(", ") : "",
    l.stages?.length ? `${l.stages.length} step${l.stages.length !== 1 ? "s" : ""}` : "",
    l.backDays != null ? (l.backDays === 0 ? "today only" : `${l.backDays} days back`) : "",
    l.maxAmountUsd ? `up to $${l.maxAmountUsd.toLocaleString("en-US")}` : "",
  ].filter(Boolean).join(" · ");
}

/**
 * What this person will be able to do, in words — read before saving. The same
 * rules the app checks with: a switch whose section is not open does nothing,
 * and is said so.
 */
export function AccessPreview({ draft, settings }: { draft: AccessDraft; settings: DB["settings"] }) {
  const { perms, on, idle } = effectiveOfDraft(draft);
  const open = ROLE_MODULES.filter(m => perms[m.key]?.view);
  const closed = ROLE_MODULES.filter(m => !perms[m.key]?.view);
  const figures = [...featuresOf("dashboard"), ...FIGURES];
  const limits = limitWords(draft.limits, settings);
  return (
    <div className="space-y-4 text-sm">
      <p className="text-xs text-muted-foreground">Exactly what they will be able to do once saved — worked out the same way the app checks it.</p>
      <p><span className="font-semibold text-brand-dark">Whose work:</span> {draft.reach === "all" ? "every order and every client" : "the orders assigned to them, and the orders of clients they handle"}.</p>
      <div className="space-y-1.5">
        <p className="font-semibold text-brand-dark">They can open {open.length} section{open.length !== 1 ? "s" : ""} (and Home)</p>
        <ul className="space-y-1">
          {open.map(m => {
            const acts = MODULE_ACTIONS[m.key].filter(a => a !== "view" && perms[m.key]?.[a]).map(a => ACTION_LABEL[a].toLowerCase());
            const sws = featuresOf(m.key).filter(f => on.has(f.key)).map(f => f.label.toLowerCase());
            return (
              <li key={m.key} className="rounded-lg bg-secondary/40 px-3 py-1.5">
                <span className="font-medium">{m.label}</span>
                <span className="text-muted-foreground"> — look{acts.length ? `, ${acts.join(", ")}` : " only"}{sws.length ? ` · ${sws.join(" · ")}` : ""}</span>
              </li>
            );
          })}
        </ul>
        {closed.length > 0 && <p className="text-xs text-muted-foreground">Hidden from them: {closed.map(m => m.label).join(", ")} — and Employees, Settings, Activity, Targets, Autopilot, Campaigns and the business Agent, which are the admins'.</p>}
      </div>
      <div className="space-y-1">
        <p className="font-semibold text-brand-dark">Figures</p>
        <p className="text-xs"><span className="text-success font-medium">See: </span>{figures.filter(f => on.has(f.key)).map(f => f.label).join(", ") || "none of these"}</p>
        <p className="text-xs"><span className="text-destructive font-medium">Hidden: </span>{figures.filter(f => !on.has(f.key)).map(f => f.label + (f.later ? " (admins only for now)" : "")).join(", ") || "nothing"}</p>
      </div>
      <div className="space-y-1">
        <p className="font-semibold text-brand-dark">Limits</p>
        {limits.length ? <ul className="list-disc pl-5 text-xs space-y-0.5">{limits.map(l => <li key={l}>{l}</li>)}</ul> : <p className="text-xs text-muted-foreground">None.</p>}
      </div>
      {idle.length > 0 && (
        <p className="text-xs text-amber-700 rounded-lg bg-amber-500/10 px-3 py-2">
          Ticked but doing nothing — their section's action is not given: {idle.map(f => f.label).join(", ")}.
        </p>
      )}
    </div>
  );
}

/**
 * Who can do what — every employee with a login, the things worth knowing at a
 * glance: whose work they reach, money in and out, removing records, the
 * sensitive figures, limits and temporary access. What an access review reads.
 */
export function AccessReportDialog({ onClose, onManage }: { onClose: () => void; onManage?: (u: User) => void }) {
  const db = useDb();
  const docs = db.roles ?? [];
  const now = Date.now();
  const people = db.users.filter(u => u.role === "employee" && u.authUid && u.status !== "inactive").sort((a, b) => a.name.localeCompare(b.name));
  const DELETES: [ModuleKey, string][] = [["clients", "clients"], ["readyStock", "Ready Stock"], ["payments", "payments"], ["locker", "account entries"], ["expenses", "expenses"], ["suppliers", "suppliers"], ["factories", "factories"], ["stock", "stock"], ["buyAssign", "purchases"]];
  const yes = <span className="text-success font-semibold">Yes</span>;
  const no = <span className="text-muted-foreground/60">—</span>;
  const HEAD = ["Person", "Whose work", "Sections", "Takes or pays money", "Removes records", "Cancels / deletes orders", "Costs", "Salaries", "Balances", "Limits", "Temporary now"];
  return (
    <Dialog open onOpenChange={v => !v && onClose()}>
      <DialogContent panel className="max-w-6xl rounded-2xl">
        <DialogHeader>
          <DialogTitle className="font-display text-2xl flex items-center gap-2"><ShieldCheck className="h-5 w-5 text-primary" /> Who can do what</DialogTitle>
          <DialogDescription className="text-xs">Every employee with a login, as their access stands right now (temporary access included). Admins can do everything. Tap a person to change their access.</DialogDescription>
        </DialogHeader>
        <TableBox ownScroll className="overflow-auto max-h-[65dvh]">
          <table className="w-full text-xs tbl-plain">
            <thead className="sticky top-0 z-10 bg-[color-mix(in_oklab,var(--color-secondary)_50%,var(--color-card))]">
              <tr>{HEAD.map(h => <th key={h} className="text-left px-2.5 py-2 font-semibold text-muted-foreground whitespace-nowrap">{h}</th>)}</tr>
            </thead>
            <tbody className="divide-y divide-border/40">
              {people.map(u => {
                const pu = { id: u.id, role: u.role, roleId: u.roleId };
                const p = effectivePerms(pu, docs, now);
                const f = effectiveFeatures(pu, docs, now);
                const limits = accessOf(docs, u.id)?.limits ?? {};
                const lim = limitShort(limits);
                const dels = DELETES.filter(([m]) => !!p[m]?.delete).map(([, w]) => w);
                const live = (accessOf(docs, u.id)?.temp ?? []).filter(t => tempState(t, now) === "active");
                return (
                  <tr key={u.id} className={onManage ? "cursor-pointer hover:bg-secondary/40" : ""} onClick={() => onManage?.(u)}>
                    <td className="px-2.5 py-2 font-medium text-brand-dark whitespace-nowrap">{u.name}</td>
                    <td className="px-2.5 py-2 whitespace-nowrap">{reachOf(pu, docs, now) === "all" ? "Everyone's" : "Their own"}</td>
                    <td className="px-2.5 py-2 tabular-nums">{Object.keys(p).length}</td>
                    <td className="px-2.5 py-2">{p.payments?.add || p.locker?.add ? yes : no}</td>
                    <td className="px-2.5 py-2">{dels.length ? <span title={dels.join(", ")} className="text-amber-700 font-semibold">{dels.length} kind{dels.length !== 1 ? "s" : ""}</span> : no}</td>
                    <td className="px-2.5 py-2">{f.has("orders.cancel") || f.has("orders.delete") ? <span className="text-amber-700 font-semibold">{[f.has("orders.cancel") && "cancel", f.has("orders.delete") && "delete"].filter(Boolean).join(", ")}</span> : no}</td>
                    <td className="px-2.5 py-2">{f.has("fig.costs") ? yes : no}</td>
                    <td className="px-2.5 py-2">{f.has("fig.salaries") ? yes : no}</td>
                    <td className="px-2.5 py-2">{f.has("fig.balances") ? yes : no}</td>
                    <td className="px-2.5 py-2 whitespace-nowrap" title={limitWords(limits, db.settings).join(" · ")}>{lim || no}</td>
                    <td className="px-2.5 py-2">{live.length ? <span className="text-amber-700 font-semibold inline-flex items-center gap-1"><Clock className="h-3 w-3" />{live.length}</span> : no}</td>
                  </tr>
                );
              })}
              {people.length === 0 && <tr><td colSpan={HEAD.length} className="px-3 py-6 text-center text-muted-foreground">No employees with a login yet.</td></tr>}
            </tbody>
          </table>
        </TableBox>
        <DialogFooter><Button variant="outline" onClick={onClose} className="rounded-xl">Close</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
