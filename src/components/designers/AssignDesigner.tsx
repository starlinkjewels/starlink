import { useState } from "react";
import { toast } from "sonner";
import { PenTool } from "lucide-react";
import { updateDbAs, loadDb, type CadJob, type DB } from "@/lib/db";
import { useDb } from "@/hooks/useDb";
import { useAuth } from "@/lib/auth";
import { fmtMoneyInr } from "@/lib/manufacturing";
import { KIND_LABEL, activeDesigners, assignDesigner, briefRows, designerEmail, designerOf, isOpenJob, jobsOfOrder, type Who } from "@/lib/designers";
import { sendMail, designAssignedEmail } from "@/lib/email";
import { ActionSheet } from "@/components/ActionSheet";
import { AddNewItem, useAddNew } from "@/components/create/QuickCreate";
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
 * fields, the same in New Order and on the order page. "+ Add new designer"
 * opens the Designers form and chooses the one made.
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
  const list = activeDesigners(db);
  const chosen = designerOf(db, value.designerId);
  const open = (id: string) => (db.cadJobs ?? []).filter(j => j.designerId === id && isOpenJob(j)).length;
  const pick = (id: string) => {
    const x = designerOf(loadDb(), id);
    onChange({ ...value, designerId: id === "__none" ? "" : id, rate: x?.kind === "freelance" && x.ratePerDesign != null ? String(x.ratePerDesign) : "" });
  };
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2 sm:col-span-1">
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
        {value.designerId && (
          <div className="col-span-2 sm:col-span-1">
            <Label className="text-xs">Due date</Label>
            <Input type="date" value={value.dueDate} onChange={e => onChange({ ...value, dueDate: e.target.value })} className="h-10 rounded-xl mt-1" aria-label="Design due date" />
          </div>
        )}
        {chosen?.kind === "freelance" && (
          <div className="col-span-2 sm:col-span-1">
            <Label className="text-xs">Charge for this design (₹)</Label>
            <Input type="number" min={0} step="1" value={value.rate} onChange={e => onChange({ ...value, rate: e.target.value })} className="h-10 rounded-xl mt-1"
              placeholder={chosen.ratePerDesign != null ? String(chosen.ratePerDesign) : "e.g. 1500"} aria-label="Design charge" />
            <p className="text-[11px] text-muted-foreground mt-1">Owed once the design is approved — changeable then.</p>
          </div>
        )}
      </div>
      {chosen?.kind === "inhouse" && <p className="text-[11px] text-muted-foreground">Our own designer — no charge; their salary is paid in Employees.</p>}
      {!list.length && <p className="text-[11px] text-muted-foreground">No designers yet — add one with “Add new designer”.</p>}
      {value.designerId && !compact && (
        <div>
          <Label className="text-xs">Note for the designer</Label>
          <Textarea value={value.note} onChange={e => onChange({ ...value, note: e.target.value })} rows={2} className="rounded-xl mt-1" aria-label="Note for the designer"
            placeholder="Optional — anything beyond the order's details" />
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
