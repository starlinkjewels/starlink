import { useMemo } from "react";
import { AlertTriangle, Eye, Filter, Info, Plus, Trash2, X, Zap } from "lucide-react";
import { useDb } from "@/hooks/useDb";
import { ActionSheet } from "@/components/ActionSheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  FIELDS, fieldDef, fill, type Ctx, type EmailBlock, type FieldKey, type ListSpec, type OrderLike, type Pipeline, type Problem, type Step, type Trigger, type TriggerKind,
} from "@/lib/pure/pipelines";
import { STEPS, TRIGGERS, WEEKDAYS, newTrigger, stepDef, triggerDef, isOrderTrigger } from "@/lib/pipelines/words";
import { ConditionsEditor, PlaceholderText, RecipientPicker, scopeOf, usePipelineNames } from "./Pickers";

const Field = ({ label, hint, children, htmlFor }: { label: string; hint?: string; children: React.ReactNode; htmlFor?: string }) => (
  <div className="space-y-1.5">
    <Label htmlFor={htmlFor} className="text-xs font-semibold text-brand-dark/80">{label}</Label>
    {children}
    {hint && <p className="text-[11px] text-muted-foreground leading-snug">{hint}</p>}
  </div>
);

function Problems({ list }: { list: Problem[] }) {
  if (!list.length) return null;
  return (
    <div className="rounded-xl border border-amber-300 bg-amber-50 px-3 py-2.5 text-[13px] text-amber-800 space-y-1">
      {list.map((p, i) => <p key={i} className="flex gap-2"><AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />{p.text}</p>)}
    </div>
  );
}

const Note = ({ children }: { children: React.ReactNode }) => (
  <div className="flex gap-2 rounded-xl bg-secondary/40 px-3 py-2.5 text-[13px] text-brand-dark/80 leading-relaxed"><Info className="h-4 w-4 shrink-0 mt-0.5 text-primary" /><div>{children}</div></div>
);

/** A real record of this business, to show how the words will read. */
export function useSampleCtx(t: Trigger): Ctx {
  const db = useDb();
  return useMemo(() => {
    const s = scopeOf(t);
    const o = [...db.orders].filter(x => !x.deletedAt).sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""))[0];
    const client = o ? db.clients.find(c => c.id === o.clientId) : db.clients[0];
    const factory = o?.assignedFactoryId ? db.factories?.find(f => f.id === o.assignedFactoryId) : undefined;
    const hid = o?.assignedEmployeeId ?? client?.accountManagerId;
    const handler = hid ? db.users.find(u => u.id === hid) : undefined;
    return {
      now: new Date().toISOString(), brandName: db.settings?.companyName || "",
      ...(s.order && o ? { order: o as unknown as OrderLike } : {}),
      ...(s.client && client ? { client } : {}),
      ...(s.order && factory ? { factory } : {}),
      ...(s.client && handler ? { handler } : {}),
      ...(s.each ? { each: { kind: s.each, id: "x", name: s.each === "factory" ? factory?.name ?? "Shreeji Jewels" : handler?.name ?? "Reshma" }, list: [] } : {}),
      ...(t.kind === "stock.low" ? { stock: { material: t.material ?? "", bucket: t.bucket ?? "", qty: Math.max(0, (t.below ?? 1) - 1), unit: t.material === "gold" ? "g" : "ct", label: t.bucket || (t.material === "gold" ? "Gold" : "Diamonds") } } : {}),
      ...(t.kind === "invoice.raised" ? { invoice: { number: "INV-0001" } } : {}),
    } as Ctx;
  }, [db.orders, db.clients, db.factories, db.users, db.settings, t]);
}

const BLOCKS: { b: EmailBlock; label: string; needsOrder?: boolean }[] = [
  { b: "order", label: "Order details", needsOrder: true },
  { b: "jobSheet", label: "Job sheet (for the factory / CAD)", needsOrder: true },
  { b: "money", label: "What's paid and owed", needsOrder: true },
  { b: "list", label: "A list of orders" },
];
const LISTS: { which: ListSpec["which"]; label: string }[] = [
  { which: "open", label: "Open orders" }, { which: "late", label: "Late orders" }, { which: "dueSoon", label: "Due soon" },
  { which: "unpaid", label: "Dispatched, still unpaid" }, { which: "newToday", label: "New today" },
];
const DELAYS = [{ v: 0, l: "Straight away" }, { v: 30, l: "After 30 minutes" }, { v: 60, l: "After 1 hour" }, { v: 240, l: "After 4 hours" }, { v: 1440, l: "After 1 day" }, { v: 2880, l: "After 2 days" }];

/** Editing one step, in the panel on the right. Changes show on the canvas as they are made. */
export function StepSheet({ step, trigger, problems, onChange, onDelete, onClose }: {
  step: Step | null; trigger: Trigger; problems: Problem[];
  onChange: (s: Step) => void; onDelete: () => void; onClose: () => void;
}) {
  const n = usePipelineNames();
  const sample = useSampleCtx(trigger);
  const scope = scopeOf(trigger);
  if (!step) return null;
  const d = stepDef(step.kind);
  const set = <S extends Step>(patch: Partial<S>) => onChange({ ...step, ...patch } as Step);
  const pickFields = FIELDS.filter(f => f.type === "pick" || f.type === "yesno").filter(f => scope.order || ["client", "company", "handler", "clientHasEmail", "handlerHasEmail"].includes(f.key));

  return (
    <ActionSheet open onOpenChange={o => { if (!o) onClose(); }} title={d.label} description={d.hint} icon={d.icon} size="lg"
      footer={
        <div className="flex items-center justify-between gap-2">
          <Button variant="ghost" onClick={onDelete} className="rounded-xl text-destructive hover:text-destructive hover:bg-destructive/10"><Trash2 className="h-4 w-4" /> Remove step</Button>
          <Button onClick={onClose} className="btn-hero rounded-xl px-8">Done</Button>
        </div>
      }>
      <div className="space-y-5">
        <Problems list={problems} />

        {step.kind === "email" && <>
          <Field label="To"><RecipientPicker value={step.to} onChange={to => set({ to })} trigger={trigger} /></Field>
          <Field label="Subject" htmlFor="ap-subject"><PlaceholderText id="ap-subject" value={step.subject} onChange={subject => set({ subject })} trigger={trigger} placeholder="Your order {order} is approved" /></Field>
          <Field label="Words" htmlFor="ap-text"><PlaceholderText id="ap-text" multiline value={step.text} onChange={text => set({ text })} trigger={trigger} placeholder={"Dear {clientOwner},\n…"} /></Field>
          <Field label="Add below the words">
            <div className="grid gap-1.5 sm:grid-cols-2">
              {BLOCKS.filter(b => !b.needsOrder || scope.order).map(b => {
                const on = (step.blocks ?? []).includes(b.b);
                return (
                  <label key={b.b} className={`flex items-center gap-2.5 h-11 px-3 rounded-xl border cursor-pointer text-[13px] ${on ? "border-primary/40 bg-primary/5" : "border-border bg-white"}`}>
                    <Switch checked={on} onCheckedChange={v => set({ blocks: v ? [...(step.blocks ?? []), b.b] : (step.blocks ?? []).filter(x => x !== b.b) })} />{b.label}
                  </label>
                );
              })}
            </div>
          </Field>
          {(step.blocks ?? []).includes("list") && (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Which orders" hint={scope.each ? "Only theirs" : "All of the business's"}>
                <Select value={step.list?.which ?? "open"} onValueChange={v => set({ list: { ...(step.list ?? {}), which: v as ListSpec["which"] } })}>
                  <SelectTrigger className="rounded-xl h-10"><SelectValue /></SelectTrigger>
                  <SelectContent>{LISTS.map(l => <SelectItem key={l.which} value={l.which}>{l.label}</SelectItem>)}</SelectContent>
                </Select>
              </Field>
              {step.list?.which === "dueSoon" && (
                <Field label="Due within (days)"><Input type="number" min={1} value={step.list.days ?? 7} onChange={e => set({ list: { ...step.list!, days: Number(e.target.value) || 7 } })} className="rounded-xl h-10" /></Field>
              )}
            </div>
          )}
          <Field label="Send" hint="Digest: everything for that person goes in one email at the day's digest time (Autopilot → Settings).">
            <div className="grid grid-cols-2 gap-1.5">
              {(["now", "digest"] as const).map(v => (
                <button key={v} type="button" onClick={() => set({ send: v })}
                  className={`h-10 rounded-xl border text-[13px] font-medium ${((step.send ?? "now") === v) ? "border-primary bg-primary/10 text-primary" : "border-border bg-white"}`}>
                  {v === "now" ? "Straight away" : "In the daily digest"}
                </button>
              ))}
            </div>
          </Field>
          <div className="rounded-2xl border border-border overflow-hidden">
            <div className="flex items-center gap-2 px-3.5 py-2 bg-secondary/40 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground"><Eye className="h-3.5 w-3.5" /> How it reads{sample.order ? ` — with ${sample.order.orderNumber}` : ""}</div>
            <div className="p-4 bg-white">
              <p className="font-semibold text-brand-dark">{fill(step.subject, sample) || <span className="text-muted-foreground">No subject</span>}</p>
              <p className="mt-2 text-sm text-brand-dark/80 whitespace-pre-line leading-relaxed">{fill(step.text, sample)}</p>
              {!!(step.blocks ?? []).length && <p className="mt-3 text-xs text-muted-foreground">+ {(step.blocks ?? []).map(b => BLOCKS.find(x => x.b === b)?.label).join(", ")}</p>}
            </div>
          </div>
        </>}

        {step.kind === "popup" && <>
          <Field label="Show to"><RecipientPicker internal value={step.to} onChange={to => set({ to })} trigger={trigger} /></Field>
          <Field label="Title" htmlFor="ap-ptitle"><PlaceholderText id="ap-ptitle" value={step.title} onChange={title => set({ title })} trigger={trigger} placeholder="{order} — call the client" /></Field>
          <Field label="Words" htmlFor="ap-ptext"><PlaceholderText id="ap-ptext" multiline value={step.text} onChange={text => set({ text })} trigger={trigger} /></Field>
          <Field label="When it pops up">
            <Select value={String(step.delayMinutes ?? 0)} onValueChange={v => set({ delayMinutes: Number(v) })}>
              <SelectTrigger className="rounded-xl h-10"><SelectValue /></SelectTrigger>
              <SelectContent>{DELAYS.map(x => <SelectItem key={x.v} value={String(x.v)}>{x.l}</SelectItem>)}</SelectContent>
            </Select>
          </Field>
          <Note>It stays on their screen until they tap <b>Done</b>, <b>Snooze</b> or <b>Open order</b>. They can see and change it under Reminders.</Note>
        </>}

        {step.kind === "alert" && <>
          <Field label="Tell"><RecipientPicker internal value={step.to} onChange={to => set({ to })} trigger={trigger} /></Field>
          <Field label="Words" htmlFor="ap-atext"><PlaceholderText id="ap-atext" multiline value={step.text} onChange={text => set({ text })} trigger={trigger} /></Field>
        </>}

        {step.kind === "task" && <>
          <Field label="Give it to"><RecipientPicker internal single value={[step.to]} onChange={to => set({ to: to[to.length - 1] ?? step.to })} trigger={trigger} /></Field>
          <Field label="Task" htmlFor="ap-ttitle"><PlaceholderText id="ap-ttitle" value={step.title} onChange={title => set({ title })} trigger={trigger} /></Field>
          <Field label="Due in (days)"><Input type="number" min={0} value={step.dueDays} onChange={e => set({ dueDays: Math.max(0, Number(e.target.value) || 0) })} className="rounded-xl h-10 w-32" /></Field>
        </>}

        {step.kind === "label" && <>
          <Field label="Label" hint="Shown on the order. A later check can ask “Has the label”."><Input value={step.label} onChange={e => set({ label: e.target.value })} placeholder="VIP" className="rounded-xl h-10" /></Field>
        </>}

        {step.kind === "wait" && (
          <Field label="Wait for">
            <div className="flex gap-2">
              <Input type="number" min={1} value={step.amount} onChange={e => set({ amount: Math.max(1, Number(e.target.value) || 1) })} className="rounded-xl h-10 w-28" />
              <Select value={step.unit} onValueChange={v => set({ unit: v as "minutes" | "hours" | "days" })}>
                <SelectTrigger className="rounded-xl h-10 w-40"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="minutes">minutes</SelectItem><SelectItem value="hours">hours</SelectItem><SelectItem value="days">days</SelectItem></SelectContent>
              </Select>
            </div>
          </Field>
        )}

        {(step.kind === "check" || step.kind === "split" || step.kind === "waitUntil") && <>
          <Field label={step.kind === "waitUntil" ? "Wait until" : step.kind === "split" ? "Yes when" : "Go on only if"}>
            <ConditionsEditor value={step.all} onChange={all => set({ all })} trigger={trigger} empty="Add what to check" />
          </Field>
          {step.kind === "waitUntil" && (
            <Field label="At most (days)" hint="Then it takes the No way."><Input type="number" min={1} value={step.maxDays} onChange={e => set({ maxDays: Math.max(1, Number(e.target.value) || 1) })} className="rounded-xl h-10 w-32" /></Field>
          )}
          {step.kind === "split" && <Note>Add steps on the <b>Yes</b> and <b>No</b> ways on the canvas. After either way, the steps after this one carry on.</Note>}
          {step.kind === "check" && <Note>If it doesn't hold, the run ends here — quietly.</Note>}
        </>}

        {step.kind === "switch" && <>
          <Field label="Go by">
            <Select value={step.field} onValueChange={v => set({ field: v as FieldKey, cases: [] })}>
              <SelectTrigger className="rounded-xl h-10"><SelectValue /></SelectTrigger>
              <SelectContent>{pickFields.map(f => <SelectItem key={f.key} value={f.key}>{f.label}</SelectItem>)}</SelectContent>
            </Select>
          </Field>
          <Field label="Ways" hint="Anything else takes the Other way.">
            <div className="space-y-2">
              {step.cases.map((c, i) => {
                const d2 = fieldDef(step.field)!;
                const opts = d2.type === "yesno" ? [{ value: "true", label: "Yes" }, { value: "false", label: "No" }] : n.options(d2.pick);
                return (
                  <div key={i} className="flex gap-2 items-center">
                    <Select value={c.value} onValueChange={v => set({ cases: step.cases.map((x, j) => (j === i ? { ...x, value: v } : x)) })}>
                      <SelectTrigger className="rounded-xl h-10"><SelectValue placeholder="Choose…" /></SelectTrigger>
                      <SelectContent>{opts.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
                    </Select>
                    <button type="button" aria-label="Remove this way" onClick={() => set({ cases: step.cases.filter((_, j) => j !== i) })}
                      className="h-10 w-10 shrink-0 grid place-items-center rounded-xl text-muted-foreground hover:text-destructive hover:bg-destructive/10"><X className="h-4 w-4" /></button>
                  </div>
                );
              })}
              <Button type="button" variant="outline" className="rounded-xl h-10" onClick={() => set({ cases: [...step.cases, { value: "", steps: [] }] })}><Plus className="h-4 w-4" /> Add a way</Button>
            </div>
          </Field>
        </>}

        {step.kind === "ask" && <>
          <Field label="Ask"><RecipientPicker internal single value={[step.to]} onChange={to => set({ to: to[to.length - 1] ?? step.to })} trigger={trigger} /></Field>
          <Field label="Question" htmlFor="ap-q"><PlaceholderText id="ap-q" value={step.question} onChange={question => set({ question })} trigger={trigger} placeholder="Approve {order} for {client} — {value}?" /></Field>
          <Field label="Wait for an answer at most (days)" hint="No answer by then counts as No."><Input type="number" min={1} value={step.maxDays} onChange={e => set({ maxDays: Math.max(1, Number(e.target.value) || 1) })} className="rounded-xl h-10 w-32" /></Field>
          <Note>It pops up on their screen with <b>Yes</b> and <b>No</b>. The first answer decides. Add steps on each way on the canvas.</Note>
        </>}

        {step.kind === "approve" && (
          <Note>Approves the order exactly as the <b>Approve</b> button does — only while it is <b>Waiting for approval</b>; the client is told in the app. If someone has already approved or cancelled it, nothing happens. It shows in Activity as “Autopilot”.</Note>
        )}

        {step.kind === "assign" && <>
          <Field label="Give it to">
            <div className="grid grid-cols-2 gap-1.5">
              {(["clientHandler", "person"] as const).map(v => (
                <button key={v} type="button" onClick={() => set({ who: v })}
                  className={`h-10 rounded-xl border text-[13px] font-medium ${step.who === v ? "border-primary bg-primary/10 text-primary" : "border-border bg-white"}`}>
                  {v === "clientHandler" ? "The client's handler" : "A chosen person"}
                </button>
              ))}
            </div>
          </Field>
          {step.who === "person" && (
            <Field label="Person">
              <Select value={step.userId ?? ""} onValueChange={v => set({ userId: v })}>
                <SelectTrigger className="rounded-xl h-10"><SelectValue placeholder="Choose…" /></SelectTrigger>
                <SelectContent>{n.staff.map(u => <SelectItem key={u.id} value={u.id}>{u.name}{u.department ? ` · ${u.department}` : ""}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
          )}
          <Note>Only an order nobody has yet. They are told in the app; it shows in Activity as “Autopilot”.</Note>
        </>}
      </div>
    </ActionSheet>
  );
}

/** "When": what starts it, and its numbers. */
export function TriggerSheet({ p, problems, onChange, onClose }: { p: Pipeline; problems: Problem[]; onChange: (p: Pipeline) => void; onClose: () => void }) {
  const n = usePipelineNames();
  const t = p.trigger;
  const d = triggerDef(t.kind);
  const set = (patch: Partial<Trigger>) => onChange({ ...p, trigger: { ...t, ...patch } });
  const pick = (k: TriggerKind) => onChange({ ...p, trigger: newTrigger(k, t) });
  const groups = [...new Set(TRIGGERS.map(x => x.group))];
  const orderRun = isOrderTrigger(t.kind);
  return (
    <ActionSheet open onOpenChange={o => { if (!o) onClose(); }} title="When it starts" description="Pick one" icon={Zap} size="lg"
      footer={<div className="flex justify-end"><Button onClick={onClose} className="btn-hero rounded-xl px-8">Done</Button></div>}>
      <div className="space-y-5">
        <Problems list={problems} />
        {groups.map(g => (
          <div key={g} className="space-y-1.5">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{g}</p>
            <div className="grid gap-1.5 sm:grid-cols-2">
              {TRIGGERS.filter(x => x.group === g).map(x => (
                <button key={x.kind} type="button" onClick={() => pick(x.kind)}
                  className={`min-h-10 px-3 py-2 rounded-xl border text-left text-[13px] font-medium transition-colors ${t.kind === x.kind ? "border-primary bg-primary/10 text-primary" : "border-border bg-white hover:border-primary/40"}`}>
                  {g === "An order" ? `…${x.label}` : x.label}
                </button>
              ))}
            </div>
          </div>
        ))}

        {!!d.needs?.length && (
          <div className="rounded-2xl border border-border p-4 space-y-4 bg-secondary/15">
            {d.needs.includes("stage") && (
              <Field label="Stage">
                <Select value={t.stage ?? ""} onValueChange={v => set({ stage: v })}>
                  <SelectTrigger className="rounded-xl h-10 bg-white"><SelectValue placeholder="Choose…" /></SelectTrigger>
                  <SelectContent>{n.options("stage").map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
                </Select>
              </Field>
            )}
            {d.needs.includes("days") && (
              <Field label="Days" hint={t.kind === "order.dueSoon" ? "How many days before the due date" : undefined}>
                <Input type="number" min={1} value={t.days ?? ""} onChange={e => set({ days: Number(e.target.value) || undefined })} className="rounded-xl h-10 w-32 bg-white" />
              </Field>
            )}
            {d.needs.includes("amount") && (
              <Field label="Amount ($)" hint="Still to pay on dispatched orders. Told at most once a month.">
                <Input type="number" min={1} value={t.amount ?? ""} onChange={e => set({ amount: Number(e.target.value) || undefined })} className="rounded-xl h-10 w-40 bg-white" />
              </Field>
            )}
            {d.needs.includes("stock") && (
              <div className="grid gap-3 sm:grid-cols-3">
                <Field label="Stock">
                  <Select value={t.material ?? "diamond"} onValueChange={v => set({ material: v })}>
                    <SelectTrigger className="rounded-xl h-10 bg-white"><SelectValue /></SelectTrigger>
                    <SelectContent><SelectItem value="diamond">Diamonds (ct)</SelectItem><SelectItem value="gold">Gold (g)</SelectItem></SelectContent>
                  </Select>
                </Field>
                <Field label="Only this lot / purity" hint="Empty = all of it"><Input value={t.bucket ?? ""} onChange={e => set({ bucket: e.target.value || undefined })} placeholder={t.material === "gold" ? "24K" : "Round 1.3 VS"} className="rounded-xl h-10 bg-white" /></Field>
                <Field label="Below"><Input type="number" min={0} value={t.below ?? ""} onChange={e => set({ below: Number(e.target.value) || undefined })} className="rounded-xl h-10 bg-white" /></Field>
              </div>
            )}
            {d.needs.includes("schedule") && (
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Every">
                  <Select value={t.every ?? "day"} onValueChange={v => set({ every: v as Trigger["every"] })}>
                    <SelectTrigger className="rounded-xl h-10 bg-white"><SelectValue /></SelectTrigger>
                    <SelectContent><SelectItem value="day">Day</SelectItem><SelectItem value="weekday">Working day (Mon–Sat)</SelectItem><SelectItem value="week">Week</SelectItem><SelectItem value="month">Month</SelectItem></SelectContent>
                  </Select>
                </Field>
                {t.every === "week" && (
                  <Field label="On">
                    <Select value={String(t.weekday ?? 1)} onValueChange={v => set({ weekday: Number(v) })}>
                      <SelectTrigger className="rounded-xl h-10 bg-white"><SelectValue /></SelectTrigger>
                      <SelectContent>{WEEKDAYS.map((w, i) => <SelectItem key={w} value={String(i)}>{w}</SelectItem>)}</SelectContent>
                    </Select>
                  </Field>
                )}
                {t.every === "month" && (
                  <Field label="On day"><Input type="number" min={1} max={28} value={t.monthDay ?? 1} onChange={e => set({ monthDay: Math.min(28, Math.max(1, Number(e.target.value) || 1)) })} className="rounded-xl h-10 w-28 bg-white" /></Field>
                )}
                <Field label="At (India time)"><Input type="time" value={t.at ?? "09:00"} onChange={e => set({ at: e.target.value })} className="rounded-xl h-10 w-40 bg-white" /></Field>
                <Field label="Run" hint="Once — or once for each, with their own list">
                  <Select value={t.forEach ?? "none"} onValueChange={v => set({ forEach: v as Trigger["forEach"] })}>
                    <SelectTrigger className="rounded-xl h-10 bg-white"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Once</SelectItem><SelectItem value="factory">For each factory</SelectItem><SelectItem value="salesperson">For each salesperson</SelectItem>
                      <SelectItem value="client">For each client</SelectItem><SelectItem value="admin">For each admin</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
              </div>
            )}
          </div>
        )}

        {orderRun && t.kind !== "order.delivered" && t.kind !== "order.cancelled" && (
          <label className="flex items-center justify-between gap-3 rounded-xl border border-border px-3.5 py-3 cursor-pointer">
            <span className="text-[13px]"><b>Stop when it's delivered</b><span className="block text-muted-foreground text-xs">A cancelled or deleted order always stops it.</span></span>
            <Switch checked={!!p.stopWhenDelivered} onCheckedChange={v => onChange({ ...p, stopWhenDelivered: v })} />
          </label>
        )}
      </div>
    </ActionSheet>
  );
}

/** "Only if": the checks every run must pass to start. */
export function OnlyIfSheet({ p, onChange, onClose }: { p: Pipeline; onChange: (p: Pipeline) => void; onClose: () => void }) {
  return (
    <ActionSheet open onOpenChange={o => { if (!o) onClose(); }} title="Only if" description="All must hold, or it doesn't start" icon={Filter} size="lg"
      footer={<div className="flex justify-end"><Button onClick={onClose} className="btn-hero rounded-xl px-8">Done</Button></div>}>
      <ConditionsEditor value={p.only} onChange={only => onChange({ ...p, only })} trigger={p.trigger} empty="No checks — every one starts it" />
    </ActionSheet>
  );
}


