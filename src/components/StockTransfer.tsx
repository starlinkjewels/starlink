import { useState } from "react";
import { toast } from "sonner";
import { ArrowRightLeft } from "lucide-react";
import { loadDb, ensureCollections } from "@/lib/db";
import { useDb } from "@/hooks/useDb";
import { useAuth } from "@/lib/auth";
import { companiesOf, companyById, MAIN_COMPANY_ID } from "@/lib/companies";
import { deriveStockBalances } from "@/lib/manufacturing";
import { stockAverageRate } from "@/lib/orderCost";
import { transferStock } from "@/lib/stock";
import { activeMaterials, materialUnit, materialName, fmtQty, type MaterialKey } from "@/lib/materials";
import { Button } from "@/components/ui/button";
import { AsyncButton } from "@/components/AsyncButton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

/**
 * Move stock from one of our companies to another — gold, loose diamonds or
 * any other material. It leaves the sender's stock and enters the receiver's,
 * at what it cost the sender, so both companies' books stay whole. (A
 * certified stone moves on its own page, stone by stone.)
 */
export function StockTransferDialog({ onClose }: { onClose: () => void }) {
  const db = useDb();
  const { user } = useAuth();
  const cos = companiesOf(db.settings, true);
  const [from, setFrom] = useState(MAIN_COMPANY_ID);
  const [to, setTo] = useState(cos.find(c => c.id !== MAIN_COMPANY_ID)?.id ?? "");
  const [material, setMaterial] = useState<MaterialKey>("gold");
  const [bucket, setBucket] = useState("");
  const [qty, setQty] = useState("");
  const [note, setNote] = useState("");
  const unit = materialUnit(db.settings, material);
  const balances = Object.entries(deriveStockBalances(db.stockMovements ?? [], material, from)).filter(([, q]) => q > 0);
  const have = balances.find(([k]) => k === bucket)?.[1] ?? 0;
  const mats: { key: MaterialKey; name: string }[] = [{ key: "gold", name: "Gold" }, { key: "diamond", name: "Loose diamond" }, ...activeMaterials(db.settings).map(m => ({ key: m.id, name: m.name }))];

  const go = async () => {
    if (!user) return;
    const q = Number(qty);
    if (from === to) { toast.error("Choose two different companies"); return; }
    if (!bucket) { toast.error("Choose what to move"); return; }
    if (!(q > 0)) { toast.error("Enter how much"); return; }
    if (q > have + 0.0005) { toast.error(`${companyById(db.settings, from).name} has only ${fmtQty(have, unit)} of ${bucket}`); return; }
    try {
      // What it cost the sender — so the receiver's average cost is right.
      await ensureCollections(["purchases", "stockMovements"]);
      const rate = stockAverageRate(loadDb(), material, bucket, new Date().toISOString(), from);
      await transferStock({
        material, purityOrQuality: bucket, quantity: q, fromCompany: from, toCompany: to,
        valueInr: rate != null ? Math.round(rate * q) : undefined, createdBy: user.id,
        note: note.trim() || `Moved ${fmtQty(q, unit)} ${bucket} ${materialName(db.settings, material)} from ${companyById(db.settings, from).name} to ${companyById(db.settings, to).name}`,
      });
      toast.success(`${fmtQty(q, unit)} ${bucket} moved to ${companyById(db.settings, to).name}`);
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not move the stock");
    }
  };

  const coSelect = (value: string, set: (v: string) => void, label: string) => (
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>
      <Select value={value} onValueChange={v => { set(v); setBucket(""); }}>
        <SelectTrigger className="h-10 rounded-xl" aria-label={label}><SelectValue placeholder="Choose" /></SelectTrigger>
        <SelectContent>{cos.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
      </Select>
    </div>
  );

  return (
    <Dialog open onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-2xl rounded-2xl">
        <DialogHeader>
          <DialogTitle className="font-display text-2xl flex items-center gap-2"><ArrowRightLeft className="h-5 w-5 text-primary" /> Move stock between companies</DialogTitle>
          <DialogDescription className="text-xs">It leaves one company&rsquo;s stock and enters the other&rsquo;s, at what it cost the first — so each company&rsquo;s stock and costing stay right.</DialogDescription>
        </DialogHeader>
        <div className="grid sm:grid-cols-2 gap-3">
          {coSelect(from, setFrom, "From")}
          {coSelect(to, setTo, "To")}
          <div className="space-y-1">
            <Label className="text-xs">Material</Label>
            <Select value={material} onValueChange={v => { setMaterial(v as MaterialKey); setBucket(""); }}>
              <SelectTrigger className="h-10 rounded-xl" aria-label="Material"><SelectValue /></SelectTrigger>
              <SelectContent>{mats.map(m => <SelectItem key={m.key} value={m.key}>{m.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">{material === "gold" ? "Purity" : material === "diamond" ? "Shape" : "Grade"}</Label>
            <Select value={bucket} onValueChange={setBucket}>
              <SelectTrigger className="h-10 rounded-xl" aria-label="What"><SelectValue placeholder={balances.length ? "Choose" : "Nothing in stock"} /></SelectTrigger>
              <SelectContent>{balances.map(([k, q]) => <SelectItem key={k} value={k}>{k} · {fmtQty(q, unit)}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs" htmlFor="tr_qty">How much ({unit})</Label>
            <Input id="tr_qty" type="number" inputMode="decimal" min="0" step="0.001" value={qty} onChange={e => setQty(e.target.value)} className="h-10 rounded-xl" placeholder={bucket ? `up to ${fmtQty(have, unit)}` : "0"} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs" htmlFor="tr_note">Note <span className="font-normal text-muted-foreground">(optional)</span></Label>
            <Input id="tr_note" value={note} onChange={e => setNote(e.target.value)} className="h-10 rounded-xl" placeholder="e.g. for the Dubai orders" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} className="rounded-xl">Cancel</Button>
          <AsyncButton onClick={go} className="btn-hero rounded-xl gap-1.5"><ArrowRightLeft className="h-4 w-4" /> Move</AsyncButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
