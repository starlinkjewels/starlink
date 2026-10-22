import { useMemo, useRef, useState } from "react";
import { AtSign, Building2, Factory, Plus, ShieldCheck, Sparkles, User, UserRound, Users, X, type LucideIcon } from "lucide-react";
import { toast } from "sonner";
import { useDb } from "@/hooks/useDb";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FIELDS, PLACEHOLDERS, fieldDef, type Condition, type FieldDef, type FieldKey, type Recipient, type Trigger } from "@/lib/pure/pipelines";
import { KIND_NAMES, OPS, PRIORITIES, STATUSES, isClientTrigger, isOrderTrigger, opNeedsValue } from "@/lib/pipelines/words";
import { listOf } from "@/lib/optionLists";
import { companiesOf } from "@/lib/companies";
import { fullStageOrder, looseStages } from "@/lib/stages";

type Opt = { value: string; label: string };

/** Names for ids, and the choices each kind of field offers — from the business's own records. */
export function usePipelineNames() {
  const db = useDb();
  return useMemo(() => {
    const staff = db.users.filter(u => (u.role === "admin" || u.role === "employee") && u.status !== "inactive").sort((a, b) => a.name.localeCompare(b.name));
    const byName = (a: Opt, b: Opt) => a.label.localeCompare(b.label);
    const options = (pick?: FieldDef["pick"]): Opt[] => {
      switch (pick) {
        case "client": return db.clients.map(c => ({ value: c.id, label: c.companyName })).sort(byName);
        case "company": return companiesOf(db.settings).map(c => ({ value: c.id, label: c.name }));
        case "factory": return (db.factories ?? []).filter(f => f.active !== false).map(f => ({ value: f.id, label: f.name })).sort(byName);
        case "person": return staff.map(u => ({ value: u.id, label: u.name }));
        case "stage": return [...new Set([...fullStageOrder(db.settings), ...looseStages(db.settings)])].map(s => ({ value: s, label: s }));
        case "kind": return Object.entries(KIND_NAMES).map(([value, label]) => ({ value, label }));
        case "priority": return PRIORITIES.map(p => ({ value: p, label: p }));
        case "status": return STATUSES.map(s => ({ value: s, label: s === "Rejected" ? "Cancelled" : s }));
        case "jewelleryType": return listOf("jewelleryTypes", db.settings).map(s => ({ value: s, label: s }));
        case "metal": return listOf("metals", db.settings).map(s => ({ value: s, label: s }));
      }
      return [];
    };
    const person = (id: string) => db.users.find(u => u.id === id)?.name;
    const valueName = (field: FieldKey, v: string) => options(fieldDef(field)?.pick).find(o => o.value === v)?.label ?? v;
    return { staff, person, options, valueName, departments: listOf("departments", db.settings) };
  }, [db.users, db.clients, db.factories, db.settings]);
}

/** What a pipeline that starts like this can talk about. */
export function scopeOf(t: Trigger) {
  const order = isOrderTrigger(t.kind);
  const client = order || isClientTrigger(t.kind);
  const each = t.kind === "time.schedule" && !!t.forEach && t.forEach !== "none" ? t.forEach : null;
  return { order, client, each };
}

const CLIENT_FIELDS: FieldKey[] = ["client", "company", "country", "clientHasEmail", "handler", "handlerHasEmail"];
export const fieldsFor = (t: Trigger) => { const s = scopeOf(t); return s.order ? FIELDS : s.client ? FIELDS.filter(f => CLIENT_FIELDS.includes(f.key)) : []; };

/* ── Who ── */

function Chip({ on, icon: Icon, children, onClick, onRemove }: { on?: boolean; icon?: LucideIcon; children: React.ReactNode; onClick?: () => void; onRemove?: () => void }) {
  return (
    <span className={`inline-flex items-center gap-1.5 h-9 rounded-full border text-[13px] font-medium transition-colors select-none
      ${on ? "bg-primary/10 border-primary/40 text-primary" : "bg-white border-border text-brand-dark/80 hover:border-primary/40"} ${onRemove ? "pl-3 pr-1" : "px-3"}`}>
      <button type="button" onClick={onClick} className="inline-flex items-center gap-1.5 h-full" aria-pressed={on}>
        {Icon && <Icon className="h-3.5 w-3.5" />}{children}
      </button>
      {onRemove && <button type="button" onClick={onRemove} aria-label="Remove" className="h-7 w-7 grid place-items-center rounded-full hover:bg-primary/15"><X className="h-3.5 w-3.5" /></button>}
    </span>
  );
}

const EMAIL_OK = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/**
 * Who a step reaches. Tap to choose; a team, a person or any email address can
 * be added. `internal`: only our own people (popups, alerts, tasks, questions).
 * `single`: one choice (a task, a question).
 */
export function RecipientPicker({ value, onChange, trigger, internal, single }: {
  value: Recipient[]; onChange: (v: Recipient[]) => void; trigger: Trigger; internal?: boolean; single?: boolean;
}) {
  const n = usePipelineNames();
  const s = scopeOf(trigger);
  const [email, setEmail] = useState("");
  const has = (k: Recipient["kind"]) => value.some(r => r.kind === k);
  const toggle = (r: Recipient) => {
    if (single) { onChange([r]); return; }
    onChange(has(r.kind) ? value.filter(x => x.kind !== r.kind) : [...value, r]);
  };
  const add = (r: Recipient) => {
    const same = value.some(x => JSON.stringify(x) === JSON.stringify(r));
    if (!same) onChange(single ? [r] : [...value, r]);
  };
  const eachInternal = s.each === "salesperson" || s.each === "admin";
  const basics: { r: Recipient; label: string; icon: LucideIcon; show: boolean }[] = [
    { r: { kind: "client" }, label: "The client", icon: Building2, show: s.client && !internal },
    { r: { kind: "factory" }, label: "The factory", icon: Factory, show: s.order && !internal },
    { r: { kind: "handler" }, label: "Who handles it", icon: UserRound, show: s.client },
    { r: { kind: "each" }, label: s.each === "factory" ? "That factory" : s.each === "client" ? "That client" : "That person", icon: Sparkles, show: !!s.each && (!internal || eachInternal) },
    { r: { kind: "admins" }, label: "All admins", icon: ShieldCheck, show: true },
    { r: { kind: "sales" }, label: "Sales team", icon: Users, show: true },
  ];
  const extras = value.filter(r => r.kind === "person" || r.kind === "department" || r.kind === "address");
  const addEmail = () => {
    const e = email.trim();
    if (!EMAIL_OK.test(e)) { toast.error("Type a full email address"); return; }
    add({ kind: "address", email: e }); setEmail("");
  };
  return (
    <div className="space-y-2.5">
      <div className="flex flex-wrap gap-1.5">
        {basics.filter(b => b.show).map(b => <Chip key={b.r.kind} on={has(b.r.kind)} icon={b.icon} onClick={() => toggle(b.r)}>{b.label}</Chip>)}
        {extras.map((r, i) => (
          <Chip key={i} on icon={r.kind === "address" ? AtSign : r.kind === "department" ? Users : User}
            onRemove={() => onChange(value.filter(x => x !== r))}>
            {r.kind === "person" ? n.person(r.userId) ?? "A person" : r.kind === "department" ? `${r.name} team` : r.kind === "address" ? r.email : ""}
          </Chip>
        ))}
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <Select value="" onValueChange={v => add({ kind: "department", name: v })}>
          <SelectTrigger className="rounded-xl h-10"><SelectValue placeholder="+ A team (CAD, QC…)" /></SelectTrigger>
          <SelectContent>{n.departments.map(d => <SelectItem key={d} value={d}>{d}</SelectItem>)}</SelectContent>
        </Select>
        <Select value="" onValueChange={v => add({ kind: "person", userId: v })}>
          <SelectTrigger className="rounded-xl h-10"><SelectValue placeholder="+ A person" /></SelectTrigger>
          <SelectContent>{n.staff.map(u => <SelectItem key={u.id} value={u.id}>{u.name}{u.department ? ` · ${u.department}` : ""}</SelectItem>)}</SelectContent>
        </Select>
      </div>
      {!internal && (
        <div className="flex gap-2">
          <Input value={email} onChange={e => setEmail(e.target.value)} onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); addEmail(); } }}
            placeholder="+ Any email address" type="email" className="rounded-xl h-10" />
          <Button type="button" variant="outline" onClick={addEmail} className="rounded-xl h-10 shrink-0"><Plus className="h-4 w-4" /> Add</Button>
        </div>
      )}
    </div>
  );
}

/* ── Only if ── */

/** A list of checks — all must hold. */
export function ConditionsEditor({ value, onChange, trigger, empty = "No checks — it always goes on" }: {
  value: Condition[]; onChange: (v: Condition[]) => void; trigger: Trigger; empty?: string;
}) {
  const n = usePipelineNames();
  const fields = fieldsFor(trigger);
  if (!fields.length) return <p className="text-sm text-muted-foreground">Nothing to check on a pipeline that starts like this.</p>;
  const set = (i: number, c: Condition) => onChange(value.map((x, j) => (j === i ? c : x)));
  const firstOp = (f: FieldKey) => OPS[fieldDef(f)!.type][0].op;
  return (
    <div className="space-y-2">
      {!value.length && <p className="text-sm text-muted-foreground">{empty}</p>}
      {value.map((c, i) => {
        const d = fieldDef(c.field)!;
        const opts = d.type === "pick" ? n.options(d.pick) : [];
        return (
          <div key={i} className="rounded-xl border border-border/80 bg-secondary/20 p-2.5">
            <div className="flex items-center justify-between gap-2 mb-2">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{i ? "and" : "Check"}</span>
              <button type="button" onClick={() => onChange(value.filter((_, j) => j !== i))} aria-label="Remove this check"
                className="h-8 w-8 grid place-items-center rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10"><X className="h-4 w-4" /></button>
            </div>
            <div className="grid gap-2 sm:grid-cols-[1.3fr_1fr_1.3fr]">
              <Select value={c.field} onValueChange={v => set(i, { field: v as FieldKey, op: firstOp(v as FieldKey) })}>
                <SelectTrigger className="rounded-lg h-10 bg-white"><SelectValue /></SelectTrigger>
                <SelectContent>{fields.map(f => <SelectItem key={f.key} value={f.key}>{f.label}</SelectItem>)}</SelectContent>
              </Select>
              <Select value={c.op} onValueChange={v => set(i, { ...c, op: v as Condition["op"], ...(opNeedsValue(v as Condition["op"]) ? {} : { value: undefined }) })}>
                <SelectTrigger className="rounded-lg h-10 bg-white"><SelectValue /></SelectTrigger>
                <SelectContent>{OPS[d.type].map(o => <SelectItem key={o.op} value={o.op}>{o.label}</SelectItem>)}</SelectContent>
              </Select>
              {opNeedsValue(c.op) ? (
                d.type === "pick" ? (
                  <Select value={c.value === undefined ? "" : String(c.value)} onValueChange={v => set(i, { ...c, value: v })}>
                    <SelectTrigger className="rounded-lg h-10 bg-white"><SelectValue placeholder="Choose…" /></SelectTrigger>
                    <SelectContent>{opts.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
                  </Select>
                ) : (
                  <Input value={c.value === undefined ? "" : String(c.value)} inputMode={d.type === "number" ? "decimal" : undefined}
                    onChange={e => set(i, { ...c, value: d.type === "number" ? (e.target.value === "" ? undefined : Number(e.target.value)) : e.target.value })}
                    placeholder={d.type === "number" ? "0" : "Type…"} className="rounded-lg h-10 bg-white" />
                )
              ) : <div className="hidden sm:block" />}
            </div>
          </div>
        );
      })}
      <Button type="button" variant="outline" className="rounded-xl h-10" onClick={() => onChange([...value, { field: fields[0].key, op: firstOp(fields[0].key) }])}>
        <Plus className="h-4 w-4" /> Add a check
      </Button>
    </div>
  );
}

/* ── Words with {placeholders} ── */

const FOR_CLIENT = ["client", "clientOwner", "handler", "name", "company", "today"];
const FOR_EACH = ["name", "count", "company", "today"];
const FOR_STOCK = ["stock", "stockLeft", "company", "today"];
export function placeholdersFor(t: Trigger) {
  const s = scopeOf(t);
  const keys = s.order ? PLACEHOLDERS.map(p => p.key).filter(k => !["count", "stock", "stockLeft", "name"].includes(k) && (k !== "invoice" || t.kind === "invoice.raised"))
    : s.client ? FOR_CLIENT : t.kind === "stock.low" ? FOR_STOCK : FOR_EACH;
  return PLACEHOLDERS.filter(p => keys.includes(p.key));
}

/** A text box with the words it can fill in, one tap each. */
export function PlaceholderText({ value, onChange, trigger, multiline, placeholder, id }: {
  value: string; onChange: (v: string) => void; trigger: Trigger; multiline?: boolean; placeholder?: string; id?: string;
}) {
  const ref = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
  const put = (key: string) => {
    const el = ref.current;
    const at = el?.selectionStart ?? value.length, end = el?.selectionEnd ?? value.length;
    const next = `${value.slice(0, at)}{${key}}${value.slice(end)}`;
    onChange(next);
    requestAnimationFrame(() => { el?.focus(); const p = at + key.length + 2; el?.setSelectionRange(p, p); });
  };
  return (
    <div className="space-y-1.5">
      {multiline
        ? <Textarea id={id} ref={ref} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} rows={5} className="rounded-xl" />
        : <Input id={id} ref={ref} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} className="rounded-xl h-10" />}
      <div className="flex flex-wrap gap-1">
        {placeholdersFor(trigger).map(p => (
          <button key={p.key} type="button" onClick={() => put(p.key)} title={`Adds {${p.key}}`}
            className="h-7 px-2 rounded-md border border-dashed border-border text-[11px] text-muted-foreground hover:text-primary hover:border-primary/50 hover:bg-primary/5">
            + {p.label}
          </button>
        ))}
      </div>
    </div>
  );
}
