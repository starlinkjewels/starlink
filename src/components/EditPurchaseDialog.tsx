import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { AsyncButton } from "@/components/AsyncButton";
import { fmtMoneyInr } from "@/lib/manufacturing";
import type { Purchase } from "@/lib/db";
import type { PurchaseEdit } from "@/lib/purchaseVoid";

/**
 * Correct a purchase that was entered wrong (wrong carat, rate, invoice no.).
 * Saving carries the change through the supplier's due, the factory issue, the
 * certified packet and the stock trail — see editPurchase() in purchaseVoid.ts.
 */
export function EditPurchaseDialog({ purchase, onClose, onSave }: {
  purchase: Purchase | null;
  onClose: () => void;
  onSave: (edit: PurchaseEdit) => Promise<void>;
}) {
  const isGold = purchase?.material === "gold";
  const isCertified = purchase?.material === "diamond" && purchase?.diamond?.kind === "certified";
  const unit = isGold ? "g" : "ct";

  const [qty, setQty] = useState("");
  const [rate, setRate] = useState("");
  const [inv, setInv] = useState("");
  const [notes, setNotes] = useState("");
  const [quality, setQuality] = useState("");
  const [certNo, setCertNo] = useState("");
  const [lab, setLab] = useState("");
  const [saving, setSaving] = useState(false);

  // Reload the form whenever a different purchase is opened.
  useEffect(() => {
    if (!purchase) return;
    setQty(String(purchase.material === "gold" ? purchase.gold?.weightGrams ?? 0 : purchase.diamond?.carat ?? 0));
    setRate(String(purchase.material === "gold" ? purchase.gold?.ratePerGram ?? 0 : purchase.diamond?.ratePerCarat ?? 0));
    setInv(purchase.invoiceNumber ?? "");
    setNotes(purchase.notes ?? "");
    setQuality(purchase.diamond?.quality ?? "");
    setCertNo(purchase.diamond?.certificateNumber ?? "");
    setLab(purchase.diamond?.certificateLab ?? "");
  }, [purchase]);

  if (!purchase) return null;

  const q = Number(qty) || 0;
  const r = Number(rate) || 0;
  // Keep the original billing currency. For a USD purchase the stored exchange
  // rate still applies, so ₹ = qty × rate × fx.
  const isUsd = purchase.currency === "USD";
  const fx = purchase.exchangeRate ?? 0;
  const totalUsd = isUsd ? Math.round(q * r * 100) / 100 : undefined;
  const totalInr = isUsd ? Math.round(q * r * fx) : Math.round(q * r);

  const submit = async () => {
    setSaving(true);
    try {
      await onSave({
        quantity: q,
        ratePerUnit: r,
        totalInr,
        totalUsd,
        exchangeRate: isUsd ? fx : undefined,
        invoiceNumber: inv,
        notes,
        quality: purchase.material === "diamond" ? quality : undefined,
        certificateNumber: isCertified ? certNo : undefined,
        certificateLab: isCertified ? lab : undefined,
      });
      onClose();
    } finally { setSaving(false); }
  };

  return (
    <Dialog open={!!purchase} onOpenChange={o => { if (!o) onClose(); }}>
      <DialogContent className="max-w-md rounded-2xl">
        <DialogHeader>
          <DialogTitle className="font-display text-xl">Correct this purchase</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground -mt-1">
          The change carries through to the supplier&rsquo;s dues, the material issued to the factory and the stock entry.
        </p>

        <div className="grid grid-cols-2 gap-3 mt-1">
          <div>
            <Label className="text-xs">{isGold ? "Weight (g)" : "Carat (ct)"}</Label>
            <Input type="number" min={0} step="0.001" value={qty} onChange={e => setQty(e.target.value)} className="rounded-xl h-10 mt-1" />
          </div>
          <div>
            <Label className="text-xs">Rate / {unit} ({purchase.currency})</Label>
            <Input type="number" min={0} step="0.01" value={rate} onChange={e => setRate(e.target.value)} className="rounded-xl h-10 mt-1" />
          </div>
        </div>

        {purchase.material === "diamond" && !isCertified && (
          <div>
            <Label className="text-xs">Quality (optional)</Label>
            <Input value={quality} onChange={e => setQuality(e.target.value)} className="rounded-xl h-10 mt-1" />
          </div>
        )}

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
