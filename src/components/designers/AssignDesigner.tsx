import { useState } from "react";
import { toast } from "sonner";
import { PenTool, UserPlus, Plus, Clock, CheckCircle2 } from "lucide-react";
import { updateDbAs, loadDb, type CadJob, type DB } from "@/lib/db";
import { useDb } from "@/hooks/useDb";
import { useAuth } from "@/lib/auth";
import { fmtMoneyInr } from "@/lib/manufacturing";
import { KIND_LABEL, activeDesigners, assignDesigner, briefRows, designerEmail, designerOf, isOpenJob, jobsOfOrder, type Who } from "@/lib/designers";
import { sendMail, designAssignedEmail } from "@/lib/email";
import { ActionSheet } from "@/components/ActionSheet";
import { AddNewItem, ADD_NEW, useAddNew, useMayCreate } from "@/components/create/QuickCreate";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

/** What is chosen when giving a design: who, for how much (a freelancer), by when, and a word for them. */
export interface DesignerChoice { designerId: string; rate: string; dueDate: string; note: string }
export const NO_DESIGNER: DesignerChoice = { designerId: "", rate: "", dueDate: "", note: "" };

/**
 * Give the order's design to the designer chosen, then email them the brief.
 * The one way it is done — from New Order and from the order page. Returns the
 * new job, or why it couldn't be done (nothing is written then).
 */
export function assignAndTell(orderId: string, c: DesignerChoice, by: Who): CadJob | string {
  const rate = c.rate.trim() === "" ? undefined : Number(c.rate);
  if (rate !== undefined && !(rate >= 0)) return "Enter a charge of 0 or more";
  let out: CadJob | string = "Not saved";
  const order = loadDb().orders.find(o => o.id === orderId);
  updateDbAs({ summary: `${order?.orderNumber ?? "Order"}: design given to ${designerOf(loadDb(), c.designerId)?.name ?? "a designer"}` }, d => {
    // A refusal changes nothing (every check comes first), so nothing is written.
    out = assignDesigner(d, { orderId, designerId: c.designerId, rate, dueDate: c.dueDate || undefined, note: c.note, by });
  });
  const job = out as CadJob | string;
  if (typeof job !== "string") mailAssigned(loadDb(), job);
  return job;
}

/** The new-design email to the designer (in-house: their own email, else the employee's). */
export function mailAssigned(db: DB, job: CadJob) {
  const designer = designerOf(db, job.designerId);
  const to = designer ? designerEmail(db, designer) : undefined;
  if (!designer || !to) return;
  const m = designAssignedEmail({ designerName: designer.name, orderNumber: job.orderNumber, brief: briefRows(job.brief), dueDate: job.dueDate });
  void sendMail(to, m.subject, m.html);
}

/**
 * The designer, their charge (a freelancer) and the due date — one set of
 * fields, the same in New Order and on the order page. The designers show as
 * cards to tap (name, ours or freelance, charge, what they have in hand); with
 * many, a dropdown. "+ Add designer" opens the Designers form and chooses the
 * one made — and with none yet, that is what the box offers.
 */
export function DesignerFields({ value, onChange, optional, compact }: {
  value: DesignerChoice; onChange: (v: DesignerChoice) => void;
  /** "No designer yet" can be chosen (New Order). */
  optional?: boolean;
  /** No note field (New Order — its own notes go into the brief). */
  compact?: boolean;
}) {
  const db = useDb();
  const addNew = useAddNew();
  const mayAdd = useMayCreate("designer");
  const list = activeDesigners(db);
  const chosen = designerOf(db, value.designerId);
  const open = (id: string) => (db.cadJobs ?? []).filter(j => j.designerId === id && isOpenJob(j)).length;
  const pick = (id: string) => {
    const x = designerOf(loadDb(), id);
    onChange({ ...value, designerId: id === "__none" ? "" : id, rate: x?.kind === "freelance" && x.ratePerDesign != null ? String(x.ratePerDesign) : "" });
  };
  const addDesigner = () => addNew("designer", pick)(ADD_NEW);
  const initials = (n: string) => n.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]!.toUpperCase()).join("");
  const card = (on: boolean) =>
    `relative flex items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors ${on ? "border-primary bg-primary/[0.06] ring-1 ring-primary/30" : "border-border bg-white hover:bg-secondary/60"}`;

  return (
    <div className="space-y-3">
      {list.length === 0 ? (
        // Nobody to give it to yet: say so, and offer the way to add one.
        <div className="flex flex-wrap items-center gap-3 rounded-xl border-2 border-dashed border-border px-4 py-3.5">
          <span className="h-10 w-10 shrink-0 rounded-full bg-primary/10 text-primary grid place-items-center"><UserPlus className="h-5 w-5" /></span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-brand-dark">No CAD designers yet</p>
            <p className="text-xs text-muted-foreground">{mayAdd ? "Add one of your own or a freelancer — they get the design by email." : "An admin adds designers on the Designers page."}</p>
          </div>
          {mayAdd && <Button type="button" variant="outline" className="h-9 rounded-xl gap-1.5" onClick={addDesigner}><Plus className="h-4 w-4" /> Add designer</Button>}
        </div>
      ) : list.length <= 8 ? (
        <div role="radiogroup" aria-label="Designer" className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {optional && (
            <button type="button" role="radio" aria-checked={!value.designerId} onClick={() => pick("__none")} className={card(!value.designerId)}>
              <span className="h-9 w-9 shrink-0 rounded-full bg-secondary text-muted-foreground grid place-items-center"><Clock className="h-4 w-4" /></span>
              <span className="min-w-0">
                <span className="block text-sm font-medium text-foreground">No designer yet</span>
                <span className="block text-[11px] text-muted-foreground">Give it later from the order</span>
              </span>
            </button>
          )}
          {list.map(x => {
            const on = value.designerId === x.id;
            const n = open(x.id);
            return (
              <button key={x.id} type="button" role="radio" aria-checked={on} onClick={() => pick(x.id)} className={card(on)} aria-label={`${x.name} · ${KIND_LABEL[x.kind]}`}>
                <span className={`h-9 w-9 shrink-0 rounded-full grid place-items-center text-xs font-bold ${x.kind === "inhouse" ? "bg-blue-500/10 text-blue-700" : "bg-violet-500/10 text-violet-700"}`}>{initials(x.name)}</span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold text-brand-dark truncate">{x.name}</span>
                  <span className="block text-[11px] leading-snug text-muted-foreground">
                    {KIND_LABEL[x.kind]} · {x.kind === "freelance" ? (x.ratePerDesign != null ? `${fmtMoneyInr(x.ratePerDesign)} a design` : "charge per design") : "salary"}
                    {n ? ` · ${n} in hand` : " · free now"}
                  </span>
                </span>
                {on && <CheckCircle2 className="h-4 w-4 shrink-0 text-primary" />}
              </button>
            );
          })}
          {mayAdd && (
            <button type="button" onClick={addDesigner} className="flex items-center justify-center gap-1.5 rounded-xl border-2 border-dashed border-border px-3 py-2.5 text-sm font-medium text-primary hover:bg-primary/[0.04]">
              <Plus className="h-4 w-4" /> Add designer
            </button>
          )}
        </div>
      ) : (
        <div>
          <Label className="text-xs">Designer</Label>
          <Select value={value.designerId || (optional ? "__none" : "")} onValueChange={addNew("designer", pick)}>
            <SelectTrigger className="h-10 rounded-xl mt-1" aria-label="Designer"><SelectValue placeholder="Choose the designer" /></SelectTrigger>
            <SelectContent>
              {optional && <SelectItem value="__none">No designer yet</SelectItem>}
              {list.map(x => (
                <SelectItem key={x.id} value={x.id}>
                  {x.name} · {KIND_LABEL[x.kind]}{open(x.id) ? ` · ${open(x.id)} in hand` : ""}
                </SelectItem>
              ))}
              <AddNewItem kind="designer" />
            </SelectContent>
          </Select>
        </div>
      )}

      {/* The chosen designer's terms, together. */}
      {chosen && (
        <div className="rounded-xl border border-border/70 bg-secondary/25 p-3 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2 sm:col-span-1">
              <Label className="text-xs">Due date</Label>
              <Input type="date" value={value.dueDate} onChange={e => onChange({ ...value, dueDate: e.target.value })} className="h-10 rounded-xl mt-1 bg-white" aria-label="Design due date" />
            </div>
            {chosen.kind === "freelance" ? (
              <div className="col-span-2 sm:col-span-1">
                <Label className="text-xs">Charge for this design (₹)</Label>
                <Input type="number" min={0} step="1" value={value.rate} onChange={e => onChange({ ...value, rate: e.target.value })} className="h-10 rounded-xl mt-1 bg-white"
                  placeholder={chosen.ratePerDesign != null ? String(chosen.ratePerDesign) : "e.g. 1500"} aria-label="Design charge" />
              </div>
            ) : (
              <p className="col-span-2 sm:col-span-1 self-end pb-2 text-[11px] text-muted-foreground">Our own designer — no charge; their salary is paid in Employees.</p>
            )}
          </div>
          {chosen.kind === "freelance" && <p className="text-[11px] text-muted-foreground -mt-1">Owed to {chosen.name} once the design is approved — changeable then.</p>}
          {!compact && (
            <div>
              <Label className="text-xs">Note for the designer</Label>
              <Textarea value={value.note} onChange={e => onChange({ ...value, note: e.target.value })} rows={2} className="rounded-xl mt-1 bg-white" aria-label="Note for the designer"
                placeholder="Optional — anything beyond the order's details" />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Give (or move) an order's design. The designer is told in the app and by
 * email; whoever had it is told it was taken back.
 */
export function AssignDesignerSheet({ orderId, onClose, onAssigned }: { orderId: string; onClose: () => void; onAssigned?: (jobId: string) => void }) {
  const db = useDb();
  const { user } = useAuth();
  const order = db.orders.find(o => o.id === orderId);
  const [c, setC] = useState<DesignerChoice>(NO_DESIGNER);
  const [saving, setSaving] = useState(false);
  if (!order) return null;
  const current = jobsOfOrder(db, order.id).find(isOpenJob);
  // A redesign after an approved, charged design: both charges stay in the order's cost.
  const charged = jobsOfOrder(db, order.id).filter(j => j.status === "approved").reduce((s, j) => s + (j.chargeInr ?? 0), 0);
  const currentName = current ? designerOf(db, current.designerId)?.name : undefined;
  const chosen = designerOf(db, c.designerId);

  const save = () => {
    if (!user) return;
    if (!c.designerId) { toast.error("Choose the designer"); return; }
    setSaving(true);
    try {
      const r = assignAndTell(order.id, c, { id: user.id, name: user.name });
      if (typeof r === "string") { toast.error(r); return; }
      const mailed = chosen && designerEmail(loadDb(), chosen);
      toast.success(`Given to ${chosen?.name ?? "the designer"}${mailed ? " — emailed" : ""}`);
      onClose();
      onAssigned?.(r.id);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't save");
    } finally { setSaving(false); }
  };

  return (
    <ActionSheet open onOpenChange={o => { if (!o) onClose(); }} size="md" icon={PenTool}
      title={current ? "Move the design" : "Give the design"} description={`${order.orderNumber} — to a CAD designer`}
      footer={
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm font-semibold text-brand-dark truncate min-w-0">
            {chosen ? `${chosen.name}${chosen.kind === "freelance" && c.rate.trim() ? ` · ${fmtMoneyInr(Number(c.rate) || 0)}` : ""}` : "—"}
          </p>
          <div className="flex gap-2 sm:shrink-0">
            <Button variant="outline" onClick={onClose} className="rounded-xl flex-1 sm:flex-none">Cancel</Button>
            <Button onClick={save} disabled={saving || !c.designerId} className="btn-hero rounded-xl px-6 flex-1 sm:flex-none">{saving ? "Saving…" : current ? "Move design" : "Give design"}</Button>
          </div>
        </div>
      }>
      <div className="space-y-4">
        {current && (
          <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            {currentName ?? "A designer"} has this design now — it is taken back from them (they are told), and its files stay in their design.
          </p>
        )}
        {!current && charged > 0 && (
          <p className="rounded-xl border border-border bg-secondary/40 px-3 py-2 text-xs text-muted-foreground">
            This order already has an approved design charged {fmtMoneyInr(charged)} — that stays; this is a new design with its own charge.
          </p>
        )}
        <DesignerFields value={c} onChange={setC} />
        <p className="text-[11px] text-muted-foreground">They get the order's details and reference pictures — never the client, prices or money.</p>
      </div>
    </ActionSheet>
  );
}
