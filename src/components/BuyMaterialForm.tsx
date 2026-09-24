import { useState } from "react";
import { useAuth } from "@/lib/auth";
import { useDb } from "@/hooks/useDb";
import {
  updateDb, uid, DIAMOND_SHAPES, nextDiamondStockNumber, todayLocal, stampFor,
  type Purchase, type PurchaseCurrency,
} from "@/lib/db";
import { increaseStock } from "@/lib/stock";
import { fmtMoneyInr } from "@/lib/manufacturing";
import { AsyncButton } from "@/components/AsyncButton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Coins, Gem, BadgeCheck, Plus, X } from "lucide-react";
import { toast } from "sonner";

const GOLD_PURITIES = ["9K", "10K", "14K", "18K", "22K", "24K"];
type BuyKind = "gold" | "loose" | "certified";

/** One line of a supplier's bill — a size, a rate and its own discount. */
interface Line {
  kind: BuyKind;
  purity: string;
  shape: string;
  qty: string;      // grams (gold) or carats (diamond)
  rate: string;     // per gram / per carat
  quality: string;
  pcs: string;
  discountPct: string;
  color: string; clarity: string; cut: string; polish: string; sym: string;
  fluor: string; measure: string; lab: string; certNo: string;
}

const emptyLine = (): Line => ({
  kind: "loose", purity: "22K", shape: "Round", qty: "", rate: "", quality: "", pcs: "", discountPct: "",
  color: "", clarity: "", cut: "", polish: "", sym: "", fluor: "", measure: "", lab: "", certNo: "",
});

/** Weight × rate, less this line's own discount. */
function lineBase(l: Line): number {
  const gross = (Number(l.qty) || 0) * (Number(l.rate) || 0);
  const d = Math.min(Math.max(Number(l.discountPct) || 0, 0), 100);
  return gross * (1 - d / 100);
}

/**
 * Buying material into stock, a whole bill at a time.
 *
 * A supplier's chitthi is one bill with a line per size — seven rounds at seven
 * rates, each less the same 6%, adding to one figure at the bottom. This used
 * to take one line per save, so a seven-line bill became seven unconnected
 * purchases and there was nothing to check the chitthi's total against. The
 * lines are still separate purchases, because stock is counted per size; what
 * is shared — supplier, date, bill number, currency and the rounding — is
 * entered once, and the lines saved together are one bill afterwards.
 */
export function BuyMaterialForm() {
  const { user } = useAuth();
  const db = useDb();
  const [supplierId, setSupplierId] = useState("");
  const [date, setDate] = useState(todayLocal());
  const [billNo, setBillNo] = useState("");
  const [currency, setCurrency] = useState<PurchaseCurrency>("INR");
  const [xrate, setXrate] = useState("");
  const [roundOff, setRoundOff] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<Line[]>([{ ...emptyLine(), kind: "gold" }]);
  const [saving, setSaving] = useState(false);

  const suppliers = db.suppliers.filter(s => s.active !== false).sort((a, b) => a.name.localeCompare(b.name));
  const set = (i: number, patch: Partial<Line>) => setLines(ls => ls.map((l, n) => (n === i ? { ...l, ...patch } : l)));
  const addLine = () => setLines(ls => [...ls, { ...emptyLine(), kind: ls[ls.length - 1]?.kind ?? "gold" }]);
  const removeLine = (i: number) => setLines(ls => (ls.length > 1 ? ls.filter((_, n) => n !== i) : ls));

  const lineInr = (l: Line) => (currency === "USD"
    ? Math.round(lineBase(l) * (Number(xrate) || 0))
    : Math.round(lineBase(l)));
  const linesTotalInr = lines.reduce((s, l) => s + lineInr(l), 0);
  const roundOffInr = Math.round(Number(roundOff) || 0);
  const billTotalInr = linesTotalInr + roundOffInr;

  const reset = () => {
    setLines([{ ...emptyLine(), kind: "gold" }]);
    setBillNo(""); setXrate(""); setRoundOff(""); setNotes("");
  };

  const submit = async () => {
    if (!supplierId) { toast.error("Choose a supplier"); return; }
    if (currency === "USD" && !xrate) { toast.error("Enter the exchange rate"); return; }
    for (const [i, l] of lines.entries()) {
      const q = Number(l.qty);
      if (!q || q <= 0) { toast.error(`Item ${i + 1}: enter the ${l.kind === "gold" ? "weight" : "carat"}`); return; }
      if (l.kind === "certified" && !l.certNo.trim()) { toast.error(`Item ${i + 1}: enter the report number`); return; }
      if (lineInr(l) <= 0) { toast.error(`Item ${i + 1}: comes to ₹0 — check the rate`); return; }
    }
    const supplier = db.suppliers.find(s => s.id === supplierId);
    const now = stampFor(date);
    const ids = lines.map(() => uid("pur_"));
    setSaving(true);
    try {
      // Gold and loose pool into Stock; a certified stone never pools — it
      // becomes its own packet below.
      for (const [i, l] of lines.entries()) {
        if (l.kind === "certified") continue;
        await increaseStock({
          material: l.kind === "gold" ? "gold" : "diamond",
          purityOrQuality: l.kind === "gold" ? l.purity : l.shape,
          quantity: Number(l.qty), refType: "purchase", refId: ids[i], createdBy: user!.id,
        });
      }
      updateDb(d => {
        if (!d.purchases) d.purchases = [];
        lines.forEach((l, i) => {
          const q = Number(l.qty);
          const disc = Math.min(Math.max(Number(l.discountPct) || 0, 0), 100);
          const isGold = l.kind === "gold";
          const total = lineInr(l) + (i === 0 ? roundOffInr : 0);
          const purchase: Purchase = {
            id: ids[i], supplierId, material: isGold ? "gold" : "diamond",
            gold: isGold ? { weightGrams: q, purity: l.purity, ratePerGram: Number(l.rate) || 0 } : undefined,
            diamond: !isGold ? {
              carat: q, quality: l.quality.trim() || undefined, ratePerCarat: Number(l.rate) || 0,
              pieces: l.kind === "loose" && Number(l.pcs) > 0 ? Math.round(Number(l.pcs)) : undefined,
              kind: l.kind === "certified" ? "certified" : "loose", shape: l.shape,
              certificateNumber: l.kind === "certified" ? l.certNo.trim() : undefined,
              certificateLab: l.kind === "certified" ? (l.lab.trim() || undefined) : undefined,
            } : undefined,
            purpose: "stock", currency,
            totalUsd: currency === "USD" ? Math.round(lineBase(l) * 100) / 100 : undefined,
            exchangeRate: currency === "USD" ? Number(xrate) : undefined,
            totalInr: total, payments: [],
            discountPct: disc > 0 ? disc : undefined,
            // The bill is rounded once, so it rides on its first line.
            roundOffInr: i === 0 && roundOffInr !== 0 ? roundOffInr : undefined,
            invoiceNumber: billNo.trim() || undefined,
            notes: notes.trim() || undefined,
            createdBy: user!.id, createdAt: now,
          };
          d.purchases.unshift(purchase);
          if (l.kind === "certified") {
            if (!d.diamondPackets) d.diamondPackets = [];
            d.diamondPackets.unshift({
              id: uid("dp_"), stockNumber: nextDiamondStockNumber(d), shape: l.shape, carat: q,
              quality: l.quality.trim() || undefined,
              color: l.color.trim() || undefined, clarity: l.clarity.trim() || undefined,
              cut: l.cut.trim() || undefined, polish: l.polish.trim() || undefined,
              symmetry: l.sym.trim() || undefined, fluorescence: l.fluor.trim() || undefined,
              measurement: l.measure.trim() || undefined,
              certificateNumber: l.certNo.trim(), certificateLab: l.lab.trim() || undefined,
              ratePerCaratInr: q > 0 ? Math.round((total / q) * 100) / 100 : undefined,
              supplierId, purchaseId: ids[i], status: "in_stock",
              createdBy: user!.id, createdAt: now,
            });
          }
        });
      });
      toast.success(`${lines.length > 1 ? `${lines.length} items` : "Item"} bought → stock · ${fmtMoneyInr(billTotalInr)} to ${supplier?.name || "supplier"}`);
      reset();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to buy");
    } finally { setSaving(false); }
  };

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
        <div className="sm:col-span-2">
          <Label className="text-xs">Supplier</Label>
          <Select value={supplierId} onValueChange={setSupplierId}>
            <SelectTrigger className="h-10 rounded-xl mt-1"><SelectValue placeholder="Choose supplier" /></SelectTrigger>
            <SelectContent>{suppliers.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs">Date</Label>
          <Input type="date" value={date} onChange={e => setDate(e.target.value)} className="rounded-xl h-10 mt-1" />
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
        <div>
          <Label className="text-xs">Bill no.</Label>
          <Input value={billNo} onChange={e => setBillNo(e.target.value)} className="rounded-xl h-10 mt-1" placeholder="The supplier's bill number" />
        </div>
        <div>
          <Label className="text-xs">Remark</Label>
          <Input value={notes} onChange={e => setNotes(e.target.value)} className="rounded-xl h-10 mt-1" placeholder="Optional" />
        </div>
      </div>

      {lines.map((l, i) => (
        <div key={i} className="rounded-xl border border-border/60 p-3 space-y-2.5 relative">
          {lines.length > 1 && (
            <>
              <p className="text-xs font-medium text-muted-foreground">Item {i + 1}</p>
              <button type="button" onClick={() => removeLine(i)}
                className="absolute top-2 right-2 h-6 w-6 rounded-lg grid place-items-center text-muted-foreground hover:text-destructive hover:bg-destructive/10">
                <X className="h-3.5 w-3.5" />
              </button>
            </>
          )}

          <div className="grid grid-cols-3 gap-1 p-1 bg-secondary rounded-xl">
            {([["gold", "Gold", Coins], ["loose", "Loose Dia.", Gem], ["certified", "Certified", BadgeCheck]] as const).map(([k, lbl, Icon]) => (
              <button key={k} type="button" onClick={() => set(i, { kind: k })}
                className={`flex items-center justify-center gap-1.5 h-9 rounded-lg text-xs font-medium transition-colors ${l.kind === k ? "bg-white shadow-soft text-brand-dark" : "text-muted-foreground"}`}>
                <Icon className="h-3.5 w-3.5" /> {lbl}
              </button>
            ))}
          </div>

          {l.kind === "gold" ? (
            <div className="grid grid-cols-3 gap-2.5">
              <div><Label className="text-xs">Weight (g)</Label><Input type="number" min={0} step="0.001" value={l.qty} onChange={e => set(i, { qty: e.target.value })} className="rounded-xl h-10 mt-1" /></div>
              <div><Label className="text-xs">Purity</Label>
                <Select value={l.purity} onValueChange={v => set(i, { purity: v })}><SelectTrigger className="h-10 rounded-xl mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>{GOLD_PURITIES.map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}</SelectContent></Select></div>
              <div><Label className="text-xs">Rate / g ({currency})</Label><Input type="number" min={0} value={l.rate} onChange={e => set(i, { rate: e.target.value })} className="rounded-xl h-10 mt-1" /></div>
            </div>
          ) : (
            <div className="space-y-2.5">
              <div className="grid grid-cols-3 gap-2.5">
                <div><Label className="text-xs">Shape</Label>
                  <Select value={l.shape} onValueChange={v => set(i, { shape: v })}><SelectTrigger className="h-10 rounded-xl mt-1"><SelectValue /></SelectTrigger>
                    <SelectContent>{DIAMOND_SHAPES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent></Select></div>
                <div><Label className="text-xs">{l.kind === "certified" ? "Size (ct)" : "Carat"}</Label><Input type="number" min={0} step="0.01" value={l.qty} onChange={e => set(i, { qty: e.target.value })} className="rounded-xl h-10 mt-1" /></div>
                <div><Label className="text-xs">Rate / ct ({currency})</Label><Input type="number" min={0} value={l.rate} onChange={e => set(i, { rate: e.target.value })} className="rounded-xl h-10 mt-1" /></div>
              </div>
              {l.kind === "loose" ? (
                <div className="grid grid-cols-2 gap-2.5">
                  <Input value={l.quality} onChange={e => set(i, { quality: e.target.value })} className="rounded-xl h-10" placeholder="Quality (optional)" />
                  <Input type="number" min={0} step="1" value={l.pcs} onChange={e => set(i, { pcs: e.target.value })} className="rounded-xl h-10" placeholder="Pcs (how many stones)" />
                </div>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                  <Input value={l.color} onChange={e => set(i, { color: e.target.value })} className="rounded-xl h-10" placeholder="Color" />
                  <Input value={l.clarity} onChange={e => set(i, { clarity: e.target.value })} className="rounded-xl h-10" placeholder="Clarity" />
                  <Input value={l.cut} onChange={e => set(i, { cut: e.target.value })} className="rounded-xl h-10" placeholder="Cut" />
                  <Input value={l.polish} onChange={e => set(i, { polish: e.target.value })} className="rounded-xl h-10" placeholder="Polish" />
                  <Input value={l.sym} onChange={e => set(i, { sym: e.target.value })} className="rounded-xl h-10" placeholder="Symmetry" />
                  <Input value={l.fluor} onChange={e => set(i, { fluor: e.target.value })} className="rounded-xl h-10" placeholder="Fluorescence" />
                  <Input value={l.measure} onChange={e => set(i, { measure: e.target.value })} className="rounded-xl h-10 sm:col-span-2" placeholder="Measurement" />
                  <Input value={l.lab} onChange={e => set(i, { lab: e.target.value })} className="rounded-xl h-10" placeholder="Lab (GIA/IGI)" />
                  <Input value={l.certNo} onChange={e => set(i, { certNo: e.target.value })} className="rounded-xl h-10 sm:col-span-3" placeholder="Report number *" />
                </div>
              )}
            </div>
          )}

          <div className="flex items-end justify-between gap-2.5 flex-wrap">
            <div className="w-32">
              <Label className="text-xs">Discount %</Label>
              <Input type="number" min={0} max={100} step="0.01" value={l.discountPct} onChange={e => set(i, { discountPct: e.target.value })} className="rounded-xl h-10 mt-1" placeholder="0" />
            </div>
            <p className="text-xs text-muted-foreground pb-2.5">
              {Number(l.discountPct) > 0 && <span className="mr-1">less {Number(l.discountPct)}% ·</span>}
              Item total: <span className="font-semibold text-foreground">{fmtMoneyInr(lineInr(l))}</span>
            </p>
          </div>
        </div>
      ))}

      <Button type="button" variant="outline" onClick={addLine} className="rounded-xl gap-2 w-full">
        <Plus className="h-4 w-4" /> Add Another Item (different size / quality)
      </Button>

      <div className="grid grid-cols-3 gap-2.5">
        <Select value={currency} onValueChange={v => setCurrency(v as PurchaseCurrency)}>
          <SelectTrigger className="h-10 rounded-xl"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="INR">Billed in INR</SelectItem><SelectItem value="USD">Billed in USD</SelectItem></SelectContent>
        </Select>
        {currency === "USD" && (
          <>
            <div className="rounded-xl h-10 px-3 flex items-center bg-secondary/60 text-sm text-muted-foreground">
              Total: <span className="font-semibold text-foreground ml-1">${lines.reduce((s, l) => s + lineBase(l), 0).toFixed(2)}</span>
            </div>
            <Input type="number" min={0} step="0.01" value={xrate} onChange={e => setXrate(e.target.value)} className="rounded-xl h-10" placeholder="Rate ₹/$" />
          </>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 items-end">
        <div>
          <Label className="text-xs">Round off ₹</Label>
          <Input type="number" step="1" value={roundOff} onChange={e => setRoundOff(e.target.value)} className="rounded-xl h-10 mt-1" placeholder="e.g. -3" />
        </div>
        {linesTotalInr > 0 && roundOffInr === 0 && linesTotalInr % 10 !== 0 && (
          <button type="button" onClick={() => setRoundOff(String(-(linesTotalInr % 10)))}
            className="text-xs text-primary hover:underline text-left h-10 flex items-end pb-2.5">
            Round {fmtMoneyInr(linesTotalInr)} down to {fmtMoneyInr(linesTotalInr - (linesTotalInr % 10))}
          </button>
        )}
      </div>

      <div className="flex items-center justify-between gap-2 p-3 rounded-xl bg-primary/5 border border-primary/20 flex-wrap">
        <span className="text-sm text-muted-foreground">
          Bill total ({lines.length} item{lines.length !== 1 ? "s" : ""})
          {roundOffInr !== 0 && <span className="block text-xs">{fmtMoneyInr(linesTotalInr)} {roundOffInr < 0 ? "less" : "plus"} {fmtMoneyInr(Math.abs(roundOffInr))} rounding</span>}
        </span>
        <span className="font-display text-lg font-bold text-brand-dark">{fmtMoneyInr(billTotalInr)}</span>
      </div>

      <AsyncButton onClick={submit} disabled={saving} className="btn-hero rounded-xl h-10 w-full">
        {saving ? "Saving…" : lines.length > 1 ? `Buy ${lines.length} Items → Stock` : "Buy → Stock"}
      </AsyncButton>
    </div>
  );
}
