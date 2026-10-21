import { LooseLotFields } from "@/components/LotFields";
import { ListCombo } from "@/components/ListCombo";
import type { ListKey } from "@/lib/optionLists";
import { useState, type ReactNode } from "react";
import { Lock, Pencil } from "lucide-react";
import { toast } from "sonner";
import {
  loadDb, updateDbAs, uid, findInvoiceForOrder, isDiamondOnlyOrder, fmtDate,
  type Order,
} from "@/lib/db";
import { useDb } from "@/hooks/useDb";
import { useAuth } from "@/lib/auth";
import { useCan } from "@/hooks/useCan";
import { metalHasKarats, metalOptions } from "@/lib/metals";
import { choicesOf, listOf } from "@/lib/optionLists";
import { orderEditAccess, orderSpecLocks } from "@/lib/orderGuards";
import { weightProblem } from "@/lib/weights";
import { confirmBox } from "@/lib/confirm";
import { ActionSheet } from "@/components/ActionSheet";
import { AsyncButton } from "@/components/AsyncButton";
import { WeightCheck } from "@/components/WeightCheck";
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
  quantity: string; diamondType: string; diamondWeight: string; estimatedGrossWeight: string; estimatedNetWeight: string;
  rhodium: string; stamping: string; stampingNote: string;
  designNumber: string; priority: string; expectedDelivery: string; deliveryTime: string; contactPerson: string; instructions: string;
  // A loose-diamond order's stones.
  stoneShape: string; stoneMm: string; stoneSize: string; stoneColor: string; stoneClarity: string;
};

const numStr = (n?: number) => (n ? String(n) : "");

function formOf(o: Order): Form {
  const special = (o.stamping ?? "").startsWith(SPECIAL);
  return {
    jewelleryType: o.jewelleryType, metal: o.metal, productKarats: o.productKarats ?? "", productColor: o.productColor ?? "",
    productSize: o.productSize ?? "", quantity: String(o.quantity || 1), diamondType: o.diamondType,
    diamondWeight: numStr(o.diamondWeight), estimatedGrossWeight: numStr(o.estimatedGrossWeight), estimatedNetWeight: numStr(o.estimatedNetWeight),
    rhodium: o.rhodium ?? "", stamping: special ? "Special Stamp" : o.stamping ?? "", stampingNote: special ? o.stamping!.slice(SPECIAL.length) : "",
    designNumber: o.designNumber ?? "", priority: o.priority, expectedDelivery: (o.expectedDelivery ?? "").slice(0, 10),
    deliveryTime: o.deliveryTime ?? "", contactPerson: o.contactPerson ?? "", instructions: o.instructions ?? "",
    stoneShape: o.stoneSpec?.shape ?? "", stoneMm: o.stoneSpec?.mm ?? "", stoneSize: o.stoneSpec?.size ?? "",
    stoneColor: o.stoneSpec?.color ?? "", stoneClarity: o.stoneSpec?.clarity ?? "",
  };
}

/** Field → how the activity line and the confirmation name it. */
const LABEL: Record<string, string> = {
  jewelleryType: "type", metal: "metal", productKarats: "karats", productColor: "colour", productSize: "size", stoneSpec: "stones",
  quantity: "quantity", diamondType: "diamond type", diamondWeight: "est. diamonds", estimatedGrossWeight: "est. gross weight",
  estimatedNetWeight: "est. net weight", rhodium: "rhodium", stamping: "stamping", designNumber: "design no.",
  priority: "priority", expectedDelivery: "due date", deliveryTime: "delivery time", contactPerson: "contact person", instructions: "instructions",
};
/** What the printed invoice shows of an order — it reads them from the order itself. */
const ON_INVOICE = new Set(["jewelleryType", "metal", "productKarats", "productColor", "productSize", "quantity", "designNumber", "stoneSpec"]);

// Outside the panel, so typing in a field never remounts it (and loses focus).
function Note({ children }: { children: ReactNode }) {
  return <p className="flex items-start gap-1.5 rounded-lg bg-secondary/60 px-2.5 py-1.5 text-[11px] text-muted-foreground"><Lock className="h-3 w-3 mt-0.5 shrink-0" />{children}</p>;
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
  const matLock = pieceLock ?? locks.material;
  const diamondOnly = isDiamondOnlyOrder(order);
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
    if (touched("stamping", "stampingNote") && f.stamping === "Special Stamp" && !f.stampingNote.trim()) { toast.error("Describe the special stamp"); return; }
    if (touched("expectedDelivery") && !f.expectedDelivery) { toast.error("Pick the due date"); return; }
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
      diamondType: f.diamondType as Order["diamondType"],
      diamondWeight: num(f.diamondWeight) ?? 0,
      estimatedGrossWeight: num(f.estimatedGrossWeight),
      estimatedNetWeight: num(f.estimatedNetWeight),
      rhodium: txt(f.rhodium),
      stamping: f.stamping === "Special Stamp" ? `${SPECIAL}${f.stampingNote.trim()}` : txt(f.stamping),
      designNumber: txt(f.designNumber),
      priority: f.priority as Order["priority"],
      expectedDelivery: f.expectedDelivery,
      deliveryTime: txt(f.deliveryTime),
      contactPerson: f.contactPerson.trim(),
      instructions: f.instructions.trim(),
      ...(diamondOnly ? { stoneSpec: Object.fromEntries(Object.entries({ shape: f.stoneShape, mm: f.stoneMm, size: f.stoneSize, color: f.stoneColor, clarity: f.stoneClarity })
        .map(([k, v]) => [k, v.trim()]).filter(([, v]) => v)) } : {}),
    };
    // Which form fields each stored field is made from.
    const FROM: Partial<Record<keyof Order, (keyof Form)[]>> = {
      productKarats: ["productKarats", "metal"], stamping: ["stamping", "stampingNote"],
      stoneSpec: ["stoneShape", "stoneMm", "stoneSize", "stoneColor", "stoneClarity"],
    };
    const same = (a: unknown, b: unknown) => (a ?? "") === (b ?? "") || (typeof a === "number" && typeof b === "number" && Math.abs(a - b) < 1e-9)
      || (typeof a === "object" && typeof b === "object" && JSON.stringify(a ?? {}) === JSON.stringify(b ?? {}));
    const changed = (Object.keys(next) as (keyof Order)[]).filter(k =>
      touched(...(FROM[k] ?? [k as keyof Form]))
      && !same(next[k], k === "expectedDelivery" ? (o.expectedDelivery ?? "").slice(0, 10) : o[k]));
    if (!changed.length) { toast.message("Nothing changed"); onClose(); return; }

    // Whatever is locked now is refused, not quietly skipped.
    const PIECE = ["jewelleryType", "metal", "productKarats", "productColor", "productSize", "quantity", "diamondType", "diamondWeight", "estimatedGrossWeight", "estimatedNetWeight", "rhodium", "stamping"];
    const MATERIAL = ["jewelleryType", "metal", "productKarats", "quantity", "diamondType"];
    const pieceNow = nowLocks.piece, matNow = nowLocks.piece ?? nowLocks.material;
    const hitPiece = pieceNow && changed.find(k => PIECE.includes(k));
    if (hitPiece) { toast.error(`The ${LABEL[hitPiece]} can't change: ${pieceNow}`); return; }
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
          {!pieceLock && locks.material && <Note>Quantity, type, metal, karats and diamond type: {locks.material}</Note>}
          <div className="grid grid-cols-2 gap-3">
            <Field label="Jewellery type">
              <Select value={f.jewelleryType} onValueChange={v => set("jewelleryType", v)} disabled={!!matLock || diamondOnly}>
                <SelectTrigger className="h-10 rounded-xl" title={matLock ?? (diamondOnly ? locks.kind : undefined)}><SelectValue /></SelectTrigger>
                <SelectContent>{typeOpts.map(x => <SelectItem key={x} value={x}>{x}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
            {/* A loose-diamond order has no metal — its stones are below. */}
            {!diamondOnly && (
              <Field label="Metal">
                <Select value={f.metal} onValueChange={setMetal} disabled={!!matLock}>
                  <SelectTrigger className="h-10 rounded-xl" title={matLock}><SelectValue /></SelectTrigger>
                  <SelectContent>{metalOpts.map(x => <SelectItem key={x} value={x}>{x}</SelectItem>)}</SelectContent>
                </Select>
              </Field>
            )}
            {diamondOnly && (
              <div className="col-span-2">
                <LooseLotFields idPrefix="oe-stone" showBag={false} compact
                  value={{ shape: f.stoneShape, mm: f.stoneMm, size: f.stoneSize, color: f.stoneColor, clarity: f.stoneClarity }}
                  onChange={patch => setF(p => ({ ...p,
                    ...(patch.shape !== undefined ? { stoneShape: patch.shape } : {}), ...(patch.mm !== undefined ? { stoneMm: patch.mm } : {}),
                    ...(patch.size !== undefined ? { stoneSize: patch.size } : {}), ...(patch.color !== undefined ? { stoneColor: patch.color } : {}),
                    ...(patch.clarity !== undefined ? { stoneClarity: patch.clarity } : {}) }))} />
              </div>
            )}
            {!diamondOnly && (
              <>
                <Field label="Karats">
                  {metalHasKarats(f.metal)
                    ? pick("productKarats", KARATS, matLock)
                    : <div className="h-10 rounded-xl px-3 flex items-center bg-secondary/60 text-xs text-muted-foreground">No karats for {f.metal}</div>}
                </Field>
                <Field label="Colour">{pickList("productColor", "colours", pieceLock)}</Field>
                <Field label="Product size" wide>
                  <Input value={f.productSize} onChange={e => set("productSize", e.target.value)} disabled={!!pieceLock} placeholder="e.g. Ring size 7, Bracelet 18cm" className="h-10 rounded-xl" />
                </Field>
              </>
            )}
            <Field label={diamondOnly ? "Stones (pcs)" : "Quantity"}>
              <Input type="number" min={1} step={1} value={f.quantity} onChange={e => set("quantity", e.target.value)} disabled={!!matLock} title={matLock} className="h-10 rounded-xl" />
            </Field>
            <Field label="Diamond type">
              {pickList("diamondType", "diamondTypes", matLock)}
            </Field>
            <Field label="Est. diamond weight (ct)">
              <Input type="number" min={0} step="0.01" value={f.diamondWeight} onChange={e => set("diamondWeight", e.target.value)} disabled={!!pieceLock} className="h-10 rounded-xl" />
            </Field>
            {!diamondOnly && (
              <>
                <Field label="Est. gross weight (g)">
                  <Input type="number" min={0} step="0.001" value={f.estimatedGrossWeight} onChange={e => set("estimatedGrossWeight", e.target.value)} disabled={!!pieceLock} className="h-10 rounded-xl" />
                </Field>
                <Field label="Est. net weight (g)">
                  <Input type="number" min={0} step="0.001" value={f.estimatedNetWeight} onChange={e => set("estimatedNetWeight", e.target.value)} disabled={!!pieceLock} className="h-10 rounded-xl" />
                </Field>
                <WeightCheck className="col-span-2 -mt-1" gross={Number(f.estimatedGrossWeight) || undefined} net={Number(f.estimatedNetWeight) || undefined} diamondCt={Number(f.diamondWeight) || undefined} />
                <Field label="Rhodium">{pickList("rhodium", "rhodium", pieceLock)}</Field>
                <Field label="Stamping">{pickList("stamping", "stamping", pieceLock)}</Field>
                {f.stamping === "Special Stamp" && (
                  <Field label="Special stamp" wide>
                    <Input value={f.stampingNote} onChange={e => set("stampingNote", e.target.value)} disabled={!!pieceLock} placeholder="Describe the stamp (logo, initials, text…)" className="h-10 rounded-xl" />
                  </Field>
                )}
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
