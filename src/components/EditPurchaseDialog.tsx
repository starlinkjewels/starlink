import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { AsyncButton } from "@/components/AsyncButton";
import { fmtMoneyInr, applyDiscountPct } from "@/lib/manufacturing";
import { useDb } from "@/hooks/useDb";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AddNewItem, useAddNew } from "@/components/create/QuickCreate";
import type { Purchase } from "@/lib/db";
import type { PurchaseEdit } from "@/lib/purchaseVoid";
import { toast } from "sonner";
import { BillBrokerFields } from "@/components/BillBrokerFields";
import { billBrokerageProblem, brokerageForLines, emptyBillBrokerage, type BillBrokerage } from "@/lib/brokers";
import { materialUnit, materialName, purchaseBucket, purchaseQty, purchaseRate, UNIT_LABEL } from "@/lib/materials";
import { loadDb } from "@/lib/db";
import { lotKey, lotParts } from "@/lib/diamondLots";
import { bagNoOf } from "@/lib/diamondBags";
import { refilePurchaseLot } from "@/lib/openingStock";
import { LooseLotFields, lotFromDraft, type LooseLotDraft } from "@/components/LotFields";
import { useAuth } from "@/lib/auth";

/**
 * Correct a purchase that was entered wrong (wrong carat, rate, invoice no.).
 * Saving carries the change through the supplier's due, the factory issue, the
 * certified packet and the stock trail — see editPurchase() in purchaseVoid.ts.
 */
export function EditPurchaseDialog({ purchase, onClose, onSave, lockQuantity, lockNote }: {
  purchase: Purchase | null;
  onClose: () => void;
  onSave: (edit: PurchaseEdit) => Promise<void>;
  /** True once the material has been made into a finished piece — the weight is
   *  fixed from then on, but the rate can still be corrected. */
  lockQuantity?: boolean;
  lockNote?: string;
}) {
  const db = useDb();
  const addNew = useAddNew();
  const isGold = purchase?.material === "gold";
  const isCertified = purchase?.material === "diamond" && purchase?.diamond?.kind === "certified";
  const unit = materialUnit(db.settings, purchase?.material);

  const [supplierId, setSupplierId] = useState("");
  const [qty, setQty] = useState("");
  const [rate, setRate] = useState("");
  const [discount, setDiscount] = useState("");
  const [inv, setInv] = useState("");
  const [notes, setNotes] = useState("");
  const [quality, setQuality] = useState("");
  const [certNo, setCertNo] = useState("");
  const [lab, setLab] = useState("");
  const [saving, setSaving] = useState(false);
  const { user } = useAuth();
  // Loose diamonds: the bag (shape · mm · sieve · colour · clarity) and the pieces.
  const [lot, setLot] = useState<LooseLotDraft>({ shape: "Round", mm: "", size: "", color: "", clarity: "" });
  const [pcs, setPcs] = useState("");
  // The broker on this line (lib/brokers.ts).
  const [brokerage, setBrokerage] = useState<BillBrokerage>(emptyBillBrokerage());

  // Reload the form whenever a different purchase is opened.
  useEffect(() => {
    if (!purchase) return;
    setSupplierId(purchase.supplierId);
    setQty(String(purchaseQty(purchase)));
    setRate(String(purchaseRate(purchase)));
    setDiscount(purchase.discountPct ? String(purchase.discountPct) : "");
    setInv(purchase.invoiceNumber ?? "");
    setNotes(purchase.notes ?? "");
    setQuality(purchase.diamond?.quality ?? "");
    setCertNo(purchase.diamond?.certificateNumber ?? "");
    setLab(purchase.diamond?.certificateLab ?? "");
    if (purchase.material === "diamond" && purchase.diamond?.kind !== "certified") {
      const lp = lotParts(purchaseBucket(purchase), { shape: purchase.diamond?.shape ?? "", type: purchase.diamond?.type, size: purchase.diamond?.size, mm: purchase.diamond?.mm, color: purchase.diamond?.color, clarity: purchase.diamond?.clarity });
      setLot({ shape: lp.shape, type: lp.type ?? "", mm: lp.mm ?? "", size: lp.size ?? "", color: lp.color ?? "", clarity: lp.clarity ?? "" });
      setPcs(purchase.diamond?.pieces != null ? String(purchase.diamond.pieces) : "");
    }
    setBrokerage(purchase.brokerId ? {
      brokerId: purchase.brokerId, pct: purchase.brokeragePct != null ? String(purchase.brokeragePct) : "",
      amount: purchase.brokerageInr != null ? String(purchase.brokerageInr) : "", paidBy: purchase.brokeragePaidBy ?? "us",
    } : emptyBillBrokerage());
  }, [purchase]);

  if (!purchase) return null;

  const q = Number(qty) || 0;
  const r = Number(rate) || 0;
  // Keep the original billing currency. For a USD purchase the stored exchange
  // rate still applies, so ₹ = qty × rate × fx.
  const isUsd = purchase.currency === "USD";
  const fx = purchase.exchangeRate ?? 0;
  // A supplier discount ("less 5%") comes off before the currency conversion,
  // exactly as it does when the purchase is first recorded.
  const disc = Math.min(Math.max(Number(discount) || 0, -100), 100);
  const net = applyDiscountPct(q * r, disc);
  const totalUsd = isUsd ? Math.round(net * 100) / 100 : undefined;
  const totalInr = isUsd ? Math.round(net * fx) : Math.round(net);

  const loose = purchase.material === "diamond" && !isCertified;
  const forOrder = purchase.purpose === "order" || !!purchase.orderId;
  const oldKey = loose ? purchaseBucket(purchase) : "";
  const newKey = loose ? lotKey(lotFromDraft(lot)) : "";
  const lotChanged = loose && !forOrder && (newKey !== oldKey || pcs !== (purchase.diamond?.pieces != null ? String(purchase.diamond.pieces) : "")
    || JSON.stringify(lotFromDraft(lot)) !== JSON.stringify(lotParts(oldKey, { shape: purchase.diamond?.shape ?? "", type: purchase.diamond?.type, size: purchase.diamond?.size, mm: purchase.diamond?.mm, color: purchase.diamond?.color, clarity: purchase.diamond?.clarity })));

  const submit = async () => {
    const brokerProblem = billBrokerageProblem(brokerage);
    if (brokerProblem) { toast.error(brokerProblem); return; }
    setSaving(true);
    try {
      await onSave({
        supplierId,
        quantity: q,
        ratePerUnit: r,
        discountPct: disc,
        totalInr,
        totalUsd,
        exchangeRate: isUsd ? fx : undefined,
        invoiceNumber: inv,
        notes,
        // Loose: its colour and clarity read as its quality, as when it was bought.
        quality: purchase.material === "diamond" ? (loose ? [lot.color, lot.clarity].filter(Boolean).join(" ") || quality : quality) : undefined,
        certificateNumber: isCertified ? certNo : undefined,
        certificateLab: isCertified ? lab : undefined,
        brokerage: brokerage.brokerId ? brokerageForLines(brokerage, [totalInr])[0] : null,
      });
      // Then the bag, worked out from the purchase as it now stands.
      if (lotChanged) {
        const fresh = (loadDb().purchases ?? []).find(x => x.id === purchase.id);
        if (!fresh || Math.abs(purchaseQty(fresh) - q) > 0.0005) { toast.error("The other changes didn't save, so the stones weren't moved to another bag."); return; }
        try {
          await refilePurchaseLot(purchase.id, lotFromDraft(lot), Number(pcs) > 0 ? Number(pcs) : undefined, { userId: user?.id });
          if (newKey !== oldKey) toast.success(`Stones moved into ${bagNoOf(loadDb(), newKey) ?? "their bag"} · ${newKey}`);
        } catch (e) { toast.error(e instanceof Error ? e.message : "Couldn't move the stones to that bag."); return; }
      }
      onClose();
    } finally { setSaving(false); }
  };

  return (
    <Dialog open={!!purchase} onOpenChange={o => { if (!o) onClose(); }}>
      <DialogContent className="max-w-3xl rounded-2xl">
        <DialogHeader>
          <DialogTitle className="font-display text-xl">Correct this purchase</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground -mt-1">
          The change carries through to the supplier&rsquo;s dues, the material issued to the factory and the stock entry.
        </p>

        <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 mt-1">
          <div>
            <Label className="text-xs">{isGold ? "Weight (g)" : purchase.material === "diamond" ? "Carat (ct)" : `${materialName(db.settings, purchase.material)} (${UNIT_LABEL[unit]})`}</Label>
            <Input type="number" min={0} step="0.001" value={qty} onChange={e => setQty(e.target.value)} disabled={lockQuantity} className="rounded-xl h-10 mt-1 disabled:opacity-60" />
          </div>
          <div>
            <Label className="text-xs">Rate / {unit} ({purchase.currency})</Label>
            <Input type="number" min={0} step="0.01" value={rate} onChange={e => setRate(e.target.value)} className="rounded-xl h-10 mt-1" />
          </div>
          <div>
            <Label className="text-xs">Discount %</Label>
            <Input type="number" min={-100} max={100} step="0.01" value={discount} onChange={e => setDiscount(e.target.value)} className="rounded-xl h-10 mt-1" placeholder="0 — minus adds" />
          </div>
        </div>
        {lockQuantity && lockNote && (
          <p className="text-[11px] text-muted-foreground -mt-1">{lockNote}</p>
        )}

        {loose && (forOrder ? (
          <p className="text-xs text-muted-foreground rounded-xl border border-border/60 bg-secondary/30 px-3 py-2">
            Bought for an order: {oldKey}{purchase.diamond?.pieces ? ` · ${purchase.diamond.pieces} pcs` : ""} — its stones are corrected on the order.
          </p>
        ) : (
          <div className="space-y-2 rounded-xl border border-border/60 bg-secondary/30 p-3">
            <p className="text-xs font-semibold text-brand-dark">Bag · now {bagNoOf(db, oldKey) ?? "no bag no."} · {oldKey}</p>
            <LooseLotFields idPrefix="edit-pur" compact bagPicker={false} companyId={purchase.companyId || "main"} value={lot} onChange={p => setLot(l => ({ ...l, ...p }))} />
            <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
              <div>
                <Label htmlFor="edit-pur-pcs" className="text-xs">Pcs</Label>
                <Input id="edit-pur-pcs" type="number" min={0} step="1" value={pcs} onChange={e => setPcs(e.target.value)} className="rounded-xl h-10 mt-1" placeholder="Optional" />
              </div>
            </div>
            {newKey !== oldKey && <p className="text-[11px] font-medium text-primary">These stones move out of {oldKey} into {newKey} — only if none of them has gone out since.</p>}
          </div>
        ))}

        {isCertified && (
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Report / Certificate #</Label>
              <Input value={certNo} onChange={e => setCertNo(e.target.value)} className="rounded-xl h-10 mt-1" />
            </div>
            <div>
              <Label className="text-xs">Lab</Label>
              <Input value={lab} onChange={e => setLab(e.target.value)} className="rounded-xl h-10 mt-1" />
            </div>
          </div>
        )}

        {/* The wrong supplier is one click away in a long list. Correcting it
            here moves the due from one to the other; removing the purchase and
            entering it again would unwind the factory issue and the stock trail
            with it. */}
        <div>
          <Label className="text-xs">Supplier</Label>
          <Select value={supplierId} onValueChange={addNew("supplier", setSupplierId)}>
            <SelectTrigger className="h-10 rounded-xl mt-1"><SelectValue placeholder="Choose supplier" /></SelectTrigger>
            <SelectContent>
              {db.suppliers.filter(s => s.active !== false || s.id === purchase.supplierId)
                .sort((a, b) => a.name.localeCompare(b.name))
                .map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
              <AddNewItem kind="supplier" />
            </SelectContent>
          </Select>
          {supplierId !== purchase.supplierId && (
            <p className="text-[11px] text-warning mt-1">
              {fmtMoneyInr(purchase.totalInr)} moves off {db.suppliers.find(s => s.id === purchase.supplierId)?.name ?? "the old supplier"}
              {" "}and onto {db.suppliers.find(s => s.id === supplierId)?.name ?? "the new one"}.
            </p>
          )}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label className="text-xs">Invoice # (optional)</Label>
            <Input value={inv} onChange={e => setInv(e.target.value)} className="rounded-xl h-10 mt-1" />
          </div>
          <div>
            <Label className="text-xs">Note (optional)</Label>
            <Input value={notes} onChange={e => setNotes(e.target.value)} className="rounded-xl h-10 mt-1" />
          </div>
        </div>

        <BillBrokerFields value={brokerage} onChange={setBrokerage} billTotalInr={totalInr} />

        <div className="rounded-xl bg-secondary/60 border border-border/60 px-4 py-3 text-sm flex items-center justify-between">
          <span className="text-muted-foreground">New total</span>
          <span className="font-semibold text-brand-dark">
            {isUsd ? `$${(totalUsd ?? 0).toFixed(2)} · ` : ""}{fmtMoneyInr(totalInr)}
          </span>
        </div>
        {totalInr !== purchase.totalInr && (
          <p className="text-[11px] text-muted-foreground -mt-1">
            Was {fmtMoneyInr(purchase.totalInr)} — the supplier&rsquo;s balance moves by {fmtMoneyInr(Math.abs(totalInr - purchase.totalInr))}
            {totalInr > purchase.totalInr ? " up" : " down"}.
          </p>
        )}

        <div className="flex gap-2 mt-1">
          <Button variant="outline" onClick={onClose} className="rounded-xl flex-1">Cancel</Button>
          <AsyncButton onClick={submit} disabled={saving || q <= 0} className="btn-hero rounded-xl flex-1">
            {saving ? "Saving…" : "Save correction"}
          </AsyncButton>
        </div>
      </DialogContent>
    </Dialog>
  );
}
