import { LooseLotFields } from "@/components/LotFields";
import { ListCombo } from "@/components/ListCombo";
import type { ListKey } from "@/lib/optionLists";
import { useState, type ReactNode } from "react";
import { Info, Lock, Pencil, Undo2 } from "lucide-react";
import { toast } from "sonner";
import {
  loadDb, updateDbAs, uid, findInvoiceForOrder, isDiamondOnlyOrder, fmtDate, dayOf, todayLocal,
  type Order,
} from "@/lib/db";
import { useDb } from "@/hooks/useDb";
import { useAuth } from "@/lib/auth";
import { useCan } from "@/hooks/useCan";
import { metalHasKarats, metalOptions } from "@/lib/metals";
import { netFromGross } from "@/lib/weights";
import { activeMaterials } from "@/lib/materials";
import { hasDiamonds } from "@/lib/orderText";
import { choicesOf, listOf } from "@/lib/optionLists";
import { orderEditAccess, orderSpecLocks } from "@/lib/orderGuards";
import { canCancelIssuance, deleteIssuance, issuanceVoidImpact } from "@/lib/issuanceEdit";
import { isMetalMaterial } from "@/lib/materials";
import { weightProblem } from "@/lib/weights";
import { confirmBox } from "@/lib/confirm";
import { ActionSheet } from "@/components/ActionSheet";
import { AsyncButton } from "@/components/AsyncButton";
import { WeightCheck } from "@/components/WeightCheck";
import { EngravingField, ENGRAVING_MAX } from "@/components/order/EngravingField";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

// The same choices New Order offers; a value an older order carries that is not
// among them stays pickable, so opening the panel never changes it by itself.
const KARATS = ["9K", "10K", "14K", "18K", "22K", "24K"];
const PRIORITY = ["Normal", "High Priority", "Urgent"];
const DIAMOND_ONLY = "Diamond Only";
const NO_METAL = "None (Diamond only)";
const NONE = "__none";
const SPECIAL = "Special Stamp: ";

type Form = {
  jewelleryType: string; metal: string; productKarats: string; productColor: string; productSize: string;
  quantity: string; diamondType: string; diamondShape: string; diamondWeight: string; estimatedGrossWeight: string; estimatedNetWeight: string;
  rhodium: string; stamping: string; stampingNote: string;
  /** Engraving: on ("1") or off (""), its words and letters. */
  engOn: string; engText: string; engFont: string;
  designNumber: string; priority: string; expectedDelivery: string; deliveryTime: string; contactPerson: string; instructions: string;
  /** The day the order was placed (yyyy-mm-dd) — moved back for an order entered late. */
  placedDate: string;
  // A loose order's stones — what they are, and their details.
  stoneName: string; stoneShape: string; stoneType: string; stoneMm: string; stoneSize: string; stoneColor: string; stoneClarity: string;
};

const numStr = (n?: number) => (n ? String(n) : "");

function formOf(o: Order): Form {
  const special = (o.stamping ?? "").startsWith(SPECIAL);
  return {
    jewelleryType: o.jewelleryType, metal: o.metal, productKarats: o.productKarats ?? "", productColor: o.productColor ?? "",
    productSize: o.productSize ?? "", quantity: String(o.quantity || 1), diamondType: o.diamondType, diamondShape: o.diamondShape ?? "",
    diamondWeight: numStr(o.diamondWeight), estimatedGrossWeight: numStr(o.estimatedGrossWeight), estimatedNetWeight: numStr(o.estimatedNetWeight),
    rhodium: o.rhodium ?? "", stamping: special ? "Special Stamp" : o.stamping ?? "", stampingNote: special ? o.stamping!.slice(SPECIAL.length) : "",
    engOn: o.engraving?.text ? "1" : "", engText: o.engraving?.text ?? "", engFont: o.engraving?.font ?? "block",
    designNumber: o.designNumber ?? "", priority: o.priority, expectedDelivery: (o.expectedDelivery ?? "").slice(0, 10),
    deliveryTime: o.deliveryTime ?? "", contactPerson: o.contactPerson ?? "", instructions: o.instructions ?? "",
    placedDate: dayOf(o.createdAt),
    stoneName: o.stoneSpec?.stone ?? "Diamond", stoneShape: o.stoneSpec?.shape ?? "", stoneType: o.stoneSpec?.type ?? "", stoneMm: o.stoneSpec?.mm ?? "", stoneSize: o.stoneSpec?.size ?? "",
    stoneColor: o.stoneSpec?.color ?? "", stoneClarity: o.stoneSpec?.clarity ?? "",
  };
}

/** Field → how the activity line and the confirmation name it. */
const LABEL: Record<string, string> = {
  jewelleryType: "type", metal: "metal", productKarats: "karats", productColor: "colour", productSize: "size", stoneSpec: "stones",
  quantity: "quantity", diamondType: "diamond type", diamondShape: "diamond shape", diamondWeight: "est. diamonds", estimatedGrossWeight: "est. gross weight",
  estimatedNetWeight: "est. net weight", rhodium: "rhodium", stamping: "stamping", engraving: "engraving", designNumber: "design no.",
  priority: "priority", expectedDelivery: "due date", deliveryTime: "delivery time", contactPerson: "contact person", instructions: "instructions",
  createdAt: "order date",
};
/** What the printed invoice shows of an order — it reads them from the order itself. */
const ON_INVOICE = new Set(["jewelleryType", "metal", "productKarats", "productColor", "productSize", "quantity", "designNumber", "stoneSpec", "createdAt"]);

// Outside the panel, so typing in a field never remounts it (and loses focus).
function Note({ children, info }: { children: ReactNode; info?: boolean }) {
  const Icon = info ? Info : Lock;
  return <p className="flex items-start gap-1.5 rounded-lg bg-secondary/60 px-2.5 py-1.5 text-[11px] text-muted-foreground"><Icon className="h-3 w-3 mt-0.5 shrink-0" />{children}</p>;
}
function Field({ label, children, wide }: { label: string; children: ReactNode; wide?: boolean }) {
  return <div className={`space-y-1 ${wide ? "col-span-2" : ""}`}><Label className="text-xs">{label}</Label>{children}</div>;
}

/**
 * Correct an order's details after it was placed — what New Order captured
 * about the piece and its delivery. Never the price: that has its own editor
 * on the order page. What can no longer change (material already issued, the
 * piece already sent) is shown locked with the reason, not left out.
 */
export function OrderEditDialog({ order, onClose }: { order: Order; onClose: () => void }) {
  const db = useDb();
  const { user } = useAuth();
  const can = useCan();
  const [f, setF] = useState<Form>(() => formOf(order));
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF(p => ({ ...p, [k]: v }));

  const access = orderEditAccess(db, user, can, order);
  const locks = orderSpecLocks(db, order);
  const all = access ?? locks.all;
  const pieceLock = all ?? locks.piece;
  // Only the metal waits for its issue to be cancelled; type, karats, quantity
  // and diamond type change here, and what was issued stays issued.
  const doneLock = pieceLock ?? locks.finished;
  const metalLock = doneLock ?? locks.metal;
  const metalIssues = () => loadDb().materialIssuances.filter(i => i.orderId === order.id && (i.quantityIssued > 0 || i.status === "open") && isMetalMaterial(db.settings, i.material));
  const [cancelling, setCancelling] = useState(false);
  // The metal issue cancelled right here — the same as Cancel issue in Manufacturing.
  const cancelMetalIssue = async () => {
    const d0 = loadDb();
    const list = metalIssues();
    if (!list.length) return;
    for (const mi of list) { const c = canCancelIssuance(d0, mi); if (!c.ok) { toast.error(c.reason!); return; } }
    if (!(await confirmBox([
      `Cancel the metal issued for ${order.orderNumber}, so its metal can change?`,
      "",
      ...list.flatMap(mi => issuanceVoidImpact(d0, mi)),
      "",
      "This cannot be undone.",
    ].join("\n"), { confirmText: "Cancel the issue" }))) return;
    setCancelling(true);
    let done = 0;
    try {
      for (const mi of list) { await deleteIssuance(loadDb(), mi, user!.id); done++; }
      toast.success("Metal issue cancelled — the metal can change now");
    } catch (e) {
      const why = e instanceof Error ? e.message : "Couldn't cancel the issue.";
      toast.error(done ? `${done} of ${list.length} metal issues cancelled — the rest: ${why}` : why);
    } finally { setCancelling(false); }
  };
  const diamondOnly = isDiamondOnlyOrder(order);
  // Gems only (an emerald sale): no diamond type, no sieve.
  const gemOnly = diamondOnly && !hasDiamonds(f.stoneName || "Diamond");
  const inv = findInvoiceForOrder(db.invoices ?? [], order.id);

  const opts = (list: string[], cur: string) => (cur && !list.includes(cur) ? [...list, cur] : list);
  const typeOpts = opts(diamondOnly ? [DIAMOND_ONLY] : listOf("jewelleryTypes", db.settings), f.jewelleryType);
  const metalOpts = diamondOnly ? [NO_METAL] : metalOptions(f.metal, db.settings);

  const setMetal = (v: string) => setF(p => ({ ...p, metal: v, productKarats: metalHasKarats(v) ? p.productKarats : "" }));

  const save = async () => {
    // Read again at the moment of saving: material may have been issued, or
    // the piece sent, since the panel opened.
    const fresh = loadDb();
    const o = fresh.orders.find(x => x.id === order.id);
    if (!o) { toast.error("That order is not there any more"); return; }
    const nowLocks = orderSpecLocks(fresh, o);
    const block = orderEditAccess(fresh, user, can, o) ?? nowLocks.all;
    if (block) { toast.error(block); return; }

    // Only what was touched here counts as a change — an older order's odd
    // stored value (a stray space, karats on silver) is never "changed" just by
    // opening the panel, so a locked field can't refuse a save it wasn't part of.
    const start = formOf(order);
    const touched = (...ks: (keyof Form)[]) => ks.some(k => f[k] !== start[k]);
    const qty = Number(f.quantity);
    if (touched("quantity") && (!Number.isInteger(qty) || qty < 1)) { toast.error("Quantity must be a whole number, at least 1"); return; }
    if (touched("engOn", "engText") && f.engOn && !f.engText.trim()) { toast.error("Engraving: type the words — or remove the engraving."); return; }
    if (touched("stamping", "stampingNote") && f.stamping === "Special Stamp" && !f.stampingNote.trim()) { toast.error("Describe the special stamp"); return; }
    if (touched("expectedDelivery") && !f.expectedDelivery) { toast.error("Pick the due date"); return; }
    // The order date: a day, at the time of day it was first entered — never one still to come.
    let placedAt = o.createdAt;
    if (touched("placedDate")) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(f.placedDate)) { toast.error("Pick the order date"); return; }
      if (f.placedDate > todayLocal()) { toast.error("The order date can't be in the future"); return; }
      const [y, m, d] = f.placedDate.split("-").map(Number);
      const t = new Date(o.createdAt);
      t.setFullYear(y, m - 1, d);
      // Today, at a time of day still to come: now.
      placedAt = (t > new Date() ? new Date() : t).toISOString();
    }
    const num = (s: string) => { const n = Number(s); return s.trim() && isFinite(n) && n > 0 ? n : undefined; };
    if (!diamondOnly && touched("estimatedGrossWeight", "estimatedNetWeight", "diamondWeight")) {
      const wp = weightProblem({ gross: num(f.estimatedGrossWeight), net: num(f.estimatedNetWeight), diamondCt: num(f.diamondWeight) });
      if (wp) { toast.error(wp); return; }
    }
    const txt = (s: string) => s.trim() || undefined;
    const next: Partial<Order> = {
      jewelleryType: f.jewelleryType as Order["jewelleryType"],
      metal: f.metal as Order["metal"],
      productKarats: metalHasKarats(f.metal) ? txt(f.productKarats) : undefined,
      productColor: txt(f.productColor),
      productSize: txt(f.productSize),
      quantity: qty,
      diamondType: (gemOnly ? "" : f.diamondType) as Order["diamondType"],
      diamondShape: diamondOnly ? undefined : txt(f.diamondShape),
      diamondWeight: num(f.diamondWeight) ?? 0,
      estimatedGrossWeight: num(f.estimatedGrossWeight),
      estimatedNetWeight: num(f.estimatedNetWeight),
      rhodium: txt(f.rhodium),
      stamping: f.stamping === "Special Stamp" ? `${SPECIAL}${f.stampingNote.trim()}` : txt(f.stamping),
      engraving: f.engOn && f.engText.trim() ? { text: f.engText.trim().slice(0, ENGRAVING_MAX), font: f.engFont === "script" ? "script" : "block" } : undefined,
      designNumber: txt(f.designNumber),
      priority: f.priority as Order["priority"],
      expectedDelivery: f.expectedDelivery,
      deliveryTime: txt(f.deliveryTime),
      contactPerson: f.contactPerson.trim(),
      instructions: f.instructions.trim(),
      createdAt: placedAt,
      ...(diamondOnly ? { stoneSpec: Object.fromEntries(Object.entries({ stone: f.stoneName.trim() === "Diamond" ? "" : f.stoneName, shape: f.stoneShape, type: gemOnly ? f.stoneType : "", mm: f.stoneMm, size: f.stoneSize, color: f.stoneColor, clarity: f.stoneClarity })
        .map(([k, v]) => [k, v.trim()]).filter(([, v]) => v)) } : {}),
    };
    // Which form fields each stored field is made from.
    const FROM: Partial<Record<keyof Order, (keyof Form)[]>> = {
      productKarats: ["productKarats", "metal"], stamping: ["stamping", "stampingNote"], engraving: ["engOn", "engText", "engFont"], createdAt: ["placedDate"],
      stoneSpec: ["stoneName", "stoneShape", "stoneType", "stoneMm", "stoneSize", "stoneColor", "stoneClarity"],
    };
    const same = (a: unknown, b: unknown) => (a ?? "") === (b ?? "") || (typeof a === "number" && typeof b === "number" && Math.abs(a - b) < 1e-9)
      || (typeof a === "object" && typeof b === "object" && JSON.stringify(a ?? {}) === JSON.stringify(b ?? {}));
    const changed = (Object.keys(next) as (keyof Order)[]).filter(k =>
      touched(...(FROM[k] ?? [k as keyof Form]))
      && !same(next[k], k === "expectedDelivery" ? (o.expectedDelivery ?? "").slice(0, 10) : o[k]));
    if (!changed.length) { toast.message("Nothing changed"); onClose(); return; }

    // Whatever is locked now is refused, not quietly skipped.
    const PIECE = ["jewelleryType", "metal", "productKarats", "productColor", "productSize", "quantity", "diamondType", "diamondShape", "diamondWeight", "estimatedGrossWeight", "estimatedNetWeight", "rhodium", "stamping", "engraving"];
    const FINISHED = ["jewelleryType", "metal", "productKarats", "quantity", "diamondType"];
    const MATERIAL = ["metal"];
    const pieceNow = nowLocks.piece, doneNow = nowLocks.piece ?? nowLocks.finished, matNow = doneNow ?? nowLocks.metal;
    const hitPiece = pieceNow && changed.find(k => PIECE.includes(k));
    if (hitPiece) { toast.error(`The ${LABEL[hitPiece]} can't change: ${pieceNow}`); return; }
    const hitDone = doneNow && changed.find(k => FINISHED.includes(k));
    if (hitDone) { toast.error(`The ${LABEL[hitDone]} can't change: ${doneNow}`); return; }
    const hitMat = matNow && changed.find(k => MATERIAL.includes(k));
    if (hitMat) { toast.error(`The ${LABEL[hitMat]} can't change: ${matNow}`); return; }
    if (isDiamondOnlyOrder({ metal: next.metal! }) !== isDiamondOnlyOrder(o)) { toast.error(nowLocks.kind); return; }

    // The bill is printed from the order, so a change it shows reaches the bill too.
    const invNow = findInvoiceForOrder(fresh.invoices ?? [], o.id);
    const onBill = changed.filter(k => ON_INVOICE.has(k));
    if (invNow && onBill.length && !(await confirmBox(
      `Change the ${onBill.map(k => LABEL[k]).join(", ")} on invoice ${invNow.number}?\n\n` +
      `${o.orderNumber} is billed on invoice ${invNow.number}, which is printed from the order — every copy printed from now on shows the new ${onBill.map(k => LABEL[k]).join(", ")}. Copies already sent stay as they were.`,
      { confirmText: "Save" },
    ))) return;

    const dueMoved = changed.includes("expectedDelivery");
    updateDbAs({ summary: `Edited ${o.orderNumber}: ${changed.map(k => LABEL[k] ?? k).join(", ")}` }, d => {
      const x = d.orders.find(y => y.id === o.id);
      if (!x) return;
      // The day it was first submitted moves with the order date (the step said the old day).
      if (changed.includes("createdAt")) {
        const sub = x.timeline?.find(t => t.step === "Order Submitted");
        if (sub?.date && dayOf(sub.date) === dayOf(o.createdAt)) sub.date = next.createdAt;
      }
      for (const k of changed) (x as unknown as Record<string, unknown>)[k] = next[k];
      // A new due date is the one thing the client is waiting on — tell them.
      if (dueMoved && !x.forReadyStock) {
        const cu = d.users.find(u => u.clientId === x.clientId && u.role === "client");
        if (cu) d.notifications.unshift({ id: uid("n_"), userId: cu.id, title: "Delivery date updated", body: `${x.orderNumber} is now due ${fmtDate(x.expectedDelivery)}.`, type: "order", read: false, createdAt: new Date().toISOString() });
      }
    });
    toast.success(`${o.orderNumber} updated — ${changed.map(k => LABEL[k] ?? k).join(", ")}`);
    onClose();
  };

  const pick = (k: keyof Form, list: string[], disabled: string | undefined, placeholder = "Select…", onChange?: (v: string) => void) => (
    <Select value={f[k] || NONE} onValueChange={v => (onChange ?? (x => set(k, x)))(v === NONE ? "" : v)} disabled={!!disabled}>
      <SelectTrigger className="h-10 rounded-xl" title={disabled}><SelectValue placeholder={placeholder} /></SelectTrigger>
      <SelectContent>
        <SelectItem value={NONE}>—</SelectItem>
        {opts(list, f[k]).map(x => <SelectItem key={x} value={x}>{x}</SelectItem>)}
      </SelectContent>
    </Select>
  );

  // A business list: pick, or type a new word — used and remembered (ListCombo).
  // Net follows the gross and the diamonds, as on New Order.
  const setGross = (v: string) => setF(p => ({ ...p, estimatedGrossWeight: v, estimatedNetWeight: Number(v) > 0 ? String(netFromGross(Number(v), Number(p.diamondWeight))) : "" }));
  const setDiamondCt = (v: string) => setF(p => ({ ...p, diamondWeight: v, ...(Number(p.estimatedGrossWeight) > 0 ? { estimatedNetWeight: String(netFromGross(Number(p.estimatedGrossWeight), Number(v))) } : {}) }));
  const pickList = (k: keyof Form, list: ListKey, disabled: string | undefined) => (
    <div title={disabled}>
      <ListCombo list={list} value={f[k]} onChange={v => set(k, v)} disabled={!!disabled} placeholder="Select…" className="h-10 rounded-xl" />
    </div>
  );

  return (
    <ActionSheet open onOpenChange={o => { if (!o) onClose(); }} title={`Edit ${order.orderNumber}`} icon={Pencil} size="lg"
      description="The piece and its delivery, as New Order took them. The price has its own editor on the order page."
      footer={
        <div className="flex items-center justify-end gap-2">
          <Button variant="outline" onClick={onClose} className="rounded-xl">Cancel</Button>
          <AsyncButton onClick={save} disabled={!!all} className="btn-hero rounded-xl px-6">Save changes</AsyncButton>
        </div>
      }>
      <div className="space-y-6">
        {all && <Note>{all}</Note>}
        {!all && inv && <p className="text-[11px] text-muted-foreground">On invoice <span className="font-semibold text-brand-dark">{inv.number}</span> — it is printed from the order, so what it shows (type, metal, karats, colour, size, quantity, design no.) follows these details.</p>}

        <section className="space-y-3">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">The piece</p>
          {!all && pieceLock && <Note>{pieceLock}</Note>}
          {!pieceLock && locks.finished && <Note>Type, metal, karats, quantity and diamond type: {locks.finished}</Note>}
          {!doneLock && locks.material && (
            <Note info>Already issued for this order: {locks.material}. Change the type, karats or quantity here — then issue more, or return the extra, in Manufacturing.</Note>
          )}
          {!doneLock && locks.metal && (
            <div className="rounded-lg bg-secondary/60 px-2.5 py-2 space-y-2">
              <p className="flex items-start gap-1.5 text-[11px] text-muted-foreground"><Lock className="h-3 w-3 mt-0.5 shrink-0" />{locks.metal}.</p>
              {metalIssues().length > 0 && (
                <Button type="button" variant="outline" size="sm" onClick={cancelMetalIssue} disabled={cancelling} className="rounded-lg h-8 gap-1.5 w-full sm:w-auto">
                  <Undo2 className="h-3.5 w-3.5" /> Cancel the metal issue
                </Button>
              )}
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <Field label="Jewellery type">
              <Select value={f.jewelleryType} onValueChange={v => set("jewelleryType", v)} disabled={!!doneLock || diamondOnly}>
                <SelectTrigger className="h-10 rounded-xl" title={doneLock ?? (diamondOnly ? locks.kind : undefined)}><SelectValue /></SelectTrigger>
                <SelectContent>{typeOpts.map(x => <SelectItem key={x} value={x}>{x}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
            {/* A loose-diamond order has no metal — its stones are below. */}
            {!diamondOnly && (
              <Field label="Metal">
                <Select value={f.metal} onValueChange={setMetal} disabled={!!metalLock}>
                  <SelectTrigger className="h-10 rounded-xl" title={metalLock}><SelectValue /></SelectTrigger>
                  <SelectContent>{metalOpts.map(x => <SelectItem key={x} value={x}>{x}</SelectItem>)}</SelectContent>
                </Select>
              </Field>
            )}
            {diamondOnly && (
              <Field label="Stone">
                <ListCombo value={f.stoneName} onChange={v => set("stoneName", v || "Diamond")} optional={false} className="h-10 rounded-xl" ariaLabel="Stone"
                  choices={["Diamond", ...activeMaterials(db.settings).filter(m => m.kind === "stone").map(m => m.name)]} />
              </Field>
            )}
            {diamondOnly && (
              <div className="col-span-2">
                <LooseLotFields idPrefix="oe-stone" showBag={false} compact gem={gemOnly} showType={gemOnly}
                  value={{ shape: f.stoneShape, type: f.stoneType, mm: f.stoneMm, size: f.stoneSize, color: f.stoneColor, clarity: f.stoneClarity }}
                  onChange={patch => setF(p => ({ ...p,
                    ...(patch.shape !== undefined ? { stoneShape: patch.shape } : {}), ...(patch.type !== undefined ? { stoneType: patch.type } : {}), ...(patch.mm !== undefined ? { stoneMm: patch.mm } : {}),
                    ...(patch.size !== undefined ? { stoneSize: patch.size } : {}), ...(patch.color !== undefined ? { stoneColor: patch.color } : {}),
                    ...(patch.clarity !== undefined ? { stoneClarity: patch.clarity } : {}) }))} />
              </div>
            )}
            {!diamondOnly && (
              <>
                <Field label="Karats">
                  {metalHasKarats(f.metal)
                    ? pick("productKarats", KARATS, doneLock)
                    : <div className="h-10 rounded-xl px-3 flex items-center bg-secondary/60 text-xs text-muted-foreground">No karats for {f.metal}</div>}
                </Field>
                <Field label="Colour">{pickList("productColor", "colours", pieceLock)}</Field>
                <Field label="Product size" wide>
                  <Input value={f.productSize} onChange={e => set("productSize", e.target.value)} disabled={!!pieceLock} placeholder="e.g. Ring size 7, Bracelet 18cm" className="h-10 rounded-xl" />
                </Field>
              </>
            )}
            <Field label={diamondOnly ? "Stones (pcs)" : "Quantity"}>
              <Input type="number" min={1} step={1} value={f.quantity} onChange={e => set("quantity", e.target.value)} disabled={!!doneLock} title={doneLock} className="h-10 rounded-xl" />
            </Field>
            {!gemOnly && (
              <Field label="Diamond type">
                {pickList("diamondType", "diamondTypes", doneLock)}
              </Field>
            )}
            <Field label="Est. diamond weight (ct)">
              <Input type="number" min={0} step="0.01" value={f.diamondWeight} onChange={e => setDiamondCt(e.target.value)} disabled={!!pieceLock} className="h-10 rounded-xl" />
            </Field>
            {!diamondOnly && (
              <>
                <Field label="Diamond shape">{pickList("diamondShape", "diamondShapes", pieceLock)}</Field>
                <Field label="Est. gross weight (g)">
                  <Input type="number" min={0} step="0.001" value={f.estimatedGrossWeight} onChange={e => setGross(e.target.value)} disabled={!!pieceLock} className="h-10 rounded-xl" />
                </Field>
                {/* Net = gross − stones (1 ct = 0.2 g) — worked out once there is a gross. */}
                <Field label="Est. net weight (g) — auto">
                  <Input type="number" readOnly tabIndex={-1} value={f.estimatedNetWeight} placeholder="gross − diamonds" className="h-10 rounded-xl bg-secondary/60 text-muted-foreground cursor-default" aria-label="Est. net weight (worked out)" />
                </Field>
                <WeightCheck className="col-span-2 -mt-1" gross={Number(f.estimatedGrossWeight) || undefined} net={Number(f.estimatedNetWeight) || undefined} diamondCt={Number(f.diamondWeight) || undefined} />
                <Field label="Rhodium">{pickList("rhodium", "rhodium", pieceLock)}</Field>
                <Field label="Stamping">{pickList("stamping", "stamping", pieceLock)}</Field>
                {f.stamping === "Special Stamp" && (
                  <Field label="Special stamp" wide>
                    <Input value={f.stampingNote} onChange={e => set("stampingNote", e.target.value)} disabled={!!pieceLock} placeholder="Describe the stamp (logo, initials, text…)" className="h-10 rounded-xl" />
                  </Field>
                )}
                <div className="col-span-2">
                  <EngravingField disabled={!!pieceLock}
                    value={{ on: !!f.engOn, text: f.engText, font: f.engFont === "script" ? "script" : "block" }}
                    onChange={v => setF(p => ({ ...p, engOn: v.on ? "1" : "", engText: v.text, engFont: v.font }))} />
                </div>
              </>
            )}
            {diamondOnly && <p className="col-span-2 text-[11px] text-muted-foreground">{locks.kind}.</p>}
          </div>
        </section>

        <section className="space-y-3">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Order &amp; delivery</p>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Design number">
              <Input value={f.designNumber} onChange={e => set("designNumber", e.target.value)} disabled={!!all} placeholder="e.g. LR-1418" className="h-10 rounded-xl" />
            </Field>
            <Field label="Priority">
              <Select value={f.priority} onValueChange={v => set("priority", v)} disabled={!!all}>
                <SelectTrigger className="h-10 rounded-xl"><SelectValue /></SelectTrigger>
                <SelectContent>{opts(PRIORITY, f.priority).map(x => <SelectItem key={x} value={x}>{x}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
            <Field label="Order date">
              <Input type="date" value={f.placedDate} max={todayLocal()} onChange={e => set("placedDate", e.target.value)} disabled={!!all} className="h-10 rounded-xl" aria-label="Order date" />
            </Field>
            <Field label="Due date">
              <Input type="date" value={f.expectedDelivery} onChange={e => set("expectedDelivery", e.target.value)} disabled={!!all} className="h-10 rounded-xl" />
            </Field>
            <Field label="Preferred time">
              <Input type="time" value={f.deliveryTime} onChange={e => set("deliveryTime", e.target.value)} disabled={!!all} className="h-10 rounded-xl" />
            </Field>
            <Field label="Contact person" wide>
              <Input value={f.contactPerson} onChange={e => set("contactPerson", e.target.value)} disabled={!!all} className="h-10 rounded-xl" />
            </Field>
            <Field label="Special instructions" wide>
              <Textarea value={f.instructions} onChange={e => set("instructions", e.target.value)} disabled={!!all} rows={4} className="rounded-xl resize-none" placeholder="Design notes, stone preferences, reference details" />
            </Field>
          </div>
        </section>
      </div>
    </ActionSheet>
  );
}
