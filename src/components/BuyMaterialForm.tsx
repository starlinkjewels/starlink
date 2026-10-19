import { AddNewItem, useAddNew } from "@/components/create/QuickCreate";
import { useId, useState } from "react";
import { useAuth } from "@/lib/auth";
import { BillBrokerFields } from "@/components/BillBrokerFields";
import { ListSelect } from "@/components/LotFields";
import { lotKey, type LotSpec } from "@/lib/diamondLots";
import { billBrokerageProblem, brokerageForLines, emptyBillBrokerage, landedInr, type BillBrokerage } from "@/lib/brokers";
import { useDb } from "@/hooks/useDb";
import {
  updateDb, uid, DIAMOND_SHAPES, nextDiamondStockNumber, todayLocal, stampFor,
  type Purchase, type PurchaseCurrency,
} from "@/lib/db";
import { increaseStock } from "@/lib/stock";
import { fmtMoneyInr, applyDiscountPct, discountLabel } from "@/lib/manufacturing";
import { fmtCcy, ccySymbol } from "@/lib/currency";
import { AsyncButton } from "@/components/AsyncButton";
import { ActionSheet } from "@/components/ActionSheet";
import { MoreMenu } from "@/components/MoreMenu";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Coins, Gem, BadgeCheck, Plus, X, Layers, ShoppingCart, ChevronRight, type LucideIcon } from "lucide-react";
import { toast } from "sonner";
import { OtherMaterialSelect, GradeInput } from "@/components/MaterialFields";
import { materialDef, materialName, materialUnit, type MaterialKey, type MaterialUnit } from "@/lib/materials";
import { CompanyPicker, useDefaultCompany, useMultiCo } from "@/components/CompanyFields";
import { coField, companyById } from "@/lib/companies";
import { Field, Group, PanelActions, Stat, UnitInput } from "@/components/BillLayout";

const GOLD_PURITIES = ["9K", "10K", "14K", "18K", "22K", "24K"];
/** Gold, loose or certified diamonds, or any other material (Settings → Materials). */
type BuyKind = "gold" | "loose" | "certified" | "other";
/** Each kind of line: what it is called and its badge. */
const KIND: Record<BuyKind, { label: string; icon: LucideIcon }> = {
  gold: { label: "Gold", icon: Coins },
  loose: { label: "Loose diamond", icon: Gem },
  certified: { label: "Certified diamond", icon: BadgeCheck },
  other: { label: "Other material", icon: Layers },
};
const KIND_ORDER: BuyKind[] = ["gold", "loose", "certified", "other"];

/*
 * Every line, whatever it buys, is the same grid: what it is in the first
 * three columns, then quantity · rate · discount in the last three — so the
 * figures line up down the bill. Two to a row on a phone.
 */
const LINE_GRID = "grid grid-cols-2 gap-2.5 @md:grid-cols-3 @xl:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)_minmax(0,0.8fr)_minmax(0,1fr)_minmax(0,1.1fr)_minmax(0,0.75fr)]";

/** One line of a supplier's bill — a size, a rate and its own discount. */
interface Line {
  kind: BuyKind;
  purity: string;
  shape: string;
  /** Loose: the lot's size — sieve or mm (lib/diamondLots.ts); its colour and clarity are below. */
  size: string;
  qty: string;      // grams (gold) or carats (diamond)
  rate: string;     // per gram / per carat
  quality: string;
  pcs: string;
  discountPct: string;
  color: string; clarity: string; cut: string; polish: string; sym: string;
  fluor: string; measure: string; lab: string; certNo: string;
  /** kind "other": which material, and its grade. */
  materialId: string; grade: string;
}

const emptyLine = (): Line => ({
  kind: "loose", purity: "22K", shape: "Round", size: "", qty: "", rate: "", quality: "", pcs: "", discountPct: "",
  color: "", clarity: "", cut: "", polish: "", sym: "", fluor: "", measure: "", lab: "", certNo: "",
  materialId: "", grade: "",
});

/** A loose line's lot: shape · size · colour · clarity. */
const lotOfLine = (l: Line): LotSpec => ({ shape: l.shape || "Round", size: l.size || undefined, color: l.color.trim() || undefined, clarity: l.clarity.trim() || undefined });

/** The stock material a line buys. */
const lineMaterial = (l: Line): MaterialKey => (l.kind === "gold" ? "gold" : l.kind === "other" ? (l.materialId as MaterialKey) : "diamond");

/** Weight × rate, less this line's own discount. */
function lineBase(l: Line): number {
  const gross = (Number(l.qty) || 0) * (Number(l.rate) || 0);
  return applyDiscountPct(gross, l.discountPct);
}

/** "Starlink Jewels' stock", "Paresh's account". */
const whose = (name: string) => (/s$/i.test(name) ? `${name}'` : `${name}'s`);

/** What a line measures in: grams, carats, or the other material's own unit. */
const lineUnit = (l: Line, settings: Parameters<typeof materialUnit>[0]): MaterialUnit =>
  (l.kind === "gold" ? "g" : l.kind === "other" ? materialUnit(settings, l.materialId) : "ct");

/**
 * Buying material into stock, a whole bill at a time — in a panel over the
 * page, so the history stays where it was.
 *
 * A supplier's chitthi is one bill with a line per size — seven rounds at seven
 * rates, each less the same 6%, adding to one figure at the bottom. This used
 * to take one line per save, so a seven-line bill became seven unconnected
 * purchases and there was nothing to check the chitthi's total against. The
 * lines are still separate purchases, because stock is counted per size; what
 * is shared — supplier, date, bill number, currency and the rounding — is
 * entered once, and the lines saved together are one bill afterwards.
 */
export function BuyMaterialForm({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { user } = useAuth();
  const db = useDb();
  const addNew = useAddNew();
  const [supplierId, setSupplierId] = useState("");
  // Whose stock the bill goes into — each company holds its own.
  const defaultCompany = useDefaultCompany();
  const [companyId, setCompanyId] = useState(defaultCompany);
  const [date, setDate] = useState(todayLocal());
  const [billNo, setBillNo] = useState("");
  const [currency, setCurrency] = useState<PurchaseCurrency>("INR");
  const [xrate, setXrate] = useState("");
  const [roundOff, setRoundOff] = useState("");
  const [notes, setNotes] = useState("");
  // The broker who brought the bill, if any, and the brokerage (lib/brokers.ts).
  const [brokerage, setBrokerage] = useState<BillBrokerage>(emptyBillBrokerage());
  const [lines, setLines] = useState<Line[]>([{ ...emptyLine(), kind: "gold" }]);
  const [saving, setSaving] = useState(false);

  const suppliers = db.suppliers.filter(s => s.active !== false).sort((a, b) => a.name.localeCompare(b.name));
  const set = (i: number, patch: Partial<Line>) => setLines(ls => ls.map((l, n) => (n === i ? { ...l, ...patch } : l)));
  // A line is added as one material; another material of the same kind starts
  // on the material the last such line was.
  const addLine = (kind: BuyKind) => setLines(ls => [...ls, {
    ...emptyLine(), kind,
    materialId: kind === "other" ? ([...ls].reverse().find(l => l.kind === "other")?.materialId ?? "") : "",
  }]);
  const removeLine = (i: number) => setLines(ls => (ls.length > 1 ? ls.filter((_, n) => n !== i) : ls));

  const lineInr = (l: Line) => (currency === "USD"
    ? Math.round(lineBase(l) * (Number(xrate) || 0))
    : Math.round(lineBase(l)));
  const linesTotalInr = lines.reduce((s, l) => s + lineInr(l), 0);
  const roundOffInr = Math.round(Number(roundOff) || 0);
  const billTotalInr = linesTotalInr + roundOffInr;

  // The footer's figures, in the bill's currency. Display only: what is saved
  // is still each line's lineInr and the bill's billTotalInr.
  const multiCo = useMultiCo();
  const roundId = useId();
  const usd = currency === "USD";
  const fmtBill = (n: number) => (usd ? fmtCcy(Math.round(n * 100) / 100, "USD") : fmtMoneyInr(n));
  const gross = (l: Line) => (Number(l.qty) || 0) * (Number(l.rate) || 0);
  // In rupees each line is rounded as it is saved, so the subtotal is of rounded
  // lines too — subtotal less discount then comes to exactly the lines' total.
  const subtotal = lines.reduce((s, l) => s + (usd ? gross(l) : Math.round(gross(l))), 0);
  const netBill = usd ? lines.reduce((s, l) => s + lineBase(l), 0) : linesTotalInr;
  const discount = subtotal - netBill;
  const hasDiscount = Math.abs(discount) >= (usd ? 0.005 : 0.5);
  const chosenSupplier = db.suppliers.find(s => s.id === supplierId);
  const certifiedLines = lines.filter(l => l.kind === "certified").length;

  const reset = () => {
    setLines([{ ...emptyLine(), kind: "gold" }]);
    setBillNo(""); setXrate(""); setRoundOff(""); setNotes(""); setBrokerage(emptyBillBrokerage());
  };

  const submit = async () => {
    if (!supplierId) { toast.error("Choose a supplier"); return; }
    // The bill number is optional: not every purchase comes with one.
    const brokerProblem = billBrokerageProblem(brokerage);
    if (brokerProblem) { toast.error(brokerProblem); return; }
    if (currency === "USD" && !xrate) { toast.error("Enter the exchange rate"); return; }
    for (const [i, l] of lines.entries()) {
      const q = Number(l.qty);
      if (l.kind === "other" && !materialDef(db.settings, l.materialId)) { toast.error(`Item ${i + 1}: choose the material`); return; }
      if (!q || q <= 0) { toast.error(`Item ${i + 1}: enter the ${l.kind === "gold" ? "weight" : l.kind === "other" ? "quantity" : "carat"}`); return; }
      if (l.kind === "certified" && !l.certNo.trim()) { toast.error(`Item ${i + 1}: enter the report number`); return; }
      if (lineInr(l) <= 0) { toast.error(`Item ${i + 1}: comes to ₹0 — check the rate`); return; }
    }
    const supplier = db.suppliers.find(s => s.id === supplierId);
    const now = stampFor(date);
    const ids = lines.map(() => uid("pur_"));
    // The bill's brokerage, shared over its lines by amount (lib/brokers.ts).
    const brokerShares = brokerageForLines(brokerage, lines.map((l, i) => lineInr(l) + (i === 0 ? roundOffInr : 0)));
    setSaving(true);
    try {
      // Gold and loose pool into Stock; a certified stone never pools — it
      // becomes its own packet below.
      for (const [i, l] of lines.entries()) {
        if (l.kind === "certified") continue;
        // Loose stones go into their lot: shape · size · colour · clarity (lib/diamondLots.ts).
        const lot = l.kind === "loose" ? lotOfLine(l) : undefined;
        await increaseStock({
          material: lineMaterial(l), companyId,
          purityOrQuality: l.kind === "gold" ? l.purity : l.kind === "other" ? (l.grade.trim() || "—") : lotKey(lot!),
          quantity: Number(l.qty), refType: "purchase", refId: ids[i], createdBy: user!.id,
          lot, pieces: l.kind === "loose" && Number(l.pcs) > 0 ? Math.round(Number(l.pcs)) : undefined,
        });
      }
      updateDb(d => {
        if (!d.purchases) d.purchases = [];
        lines.forEach((l, i) => {
          const q = Number(l.qty);
          const disc = Math.min(Math.max(Number(l.discountPct) || 0, -100), 100);
          const isGold = l.kind === "gold";
          const isOther = l.kind === "other";
          const total = lineInr(l) + (i === 0 ? roundOffInr : 0);
          const purchase: Purchase = {
            id: ids[i], supplierId, material: lineMaterial(l), ...coField(companyId),
            gold: isGold ? { weightGrams: q, purity: l.purity, ratePerGram: Number(l.rate) || 0 } : undefined,
            other: isOther ? {
              qty: q, grade: l.grade.trim() || "—", ratePerUnit: Number(l.rate) || 0,
              pieces: Number(l.pcs) > 0 ? Math.round(Number(l.pcs)) : undefined,
            } : undefined,
            diamond: !isGold && !isOther ? {
              // Loose: its colour and clarity read as its quality, where older screens show one.
              carat: q, quality: (l.kind === "loose" ? [l.color, l.clarity].map(x => x.trim()).filter(Boolean).join(" ") : l.quality.trim()) || undefined, ratePerCarat: Number(l.rate) || 0,
              pieces: l.kind === "loose" && Number(l.pcs) > 0 ? Math.round(Number(l.pcs)) : undefined,
              kind: l.kind === "certified" ? "certified" : "loose", shape: l.shape,
              ...(l.kind === "loose" ? { size: l.size || undefined, color: l.color.trim() || undefined, clarity: l.clarity.trim() || undefined } : {}),
              certificateNumber: l.kind === "certified" ? l.certNo.trim() : undefined,
              certificateLab: l.kind === "certified" ? (l.lab.trim() || undefined) : undefined,
            } : undefined,
            purpose: "stock", currency,
            totalUsd: currency === "USD" ? Math.round(lineBase(l) * 100) / 100 : undefined,
            exchangeRate: currency === "USD" ? Number(xrate) : undefined,
            totalInr: total, payments: [],
            discountPct: disc !== 0 ? disc : undefined,
            // The bill is rounded once, so it rides on its first line.
            roundOffInr: i === 0 && roundOffInr !== 0 ? roundOffInr : undefined,
            invoiceNumber: billNo.trim() || undefined,
            ...brokerShares[i],
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
              // What the stone cost us: the bill line plus any brokerage we pay on it.
              ratePerCaratInr: q > 0 ? Math.round((landedInr(purchase) / q) * 100) / 100 : undefined,
              supplierId, purchaseId: ids[i], status: "in_stock", ...coField(companyId),
              createdBy: user!.id, createdAt: now,
            });
          }
        });
      });
      toast.success(`${lines.length > 1 ? `${lines.length} items` : "Item"} bought → ${companyId !== "main" ? `${companyById(db.settings, companyId).name}'s ` : ""}stock · ${fmtMoneyInr(billTotalInr)} to ${supplier?.name || "supplier"}`);
      reset();
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to buy");
    } finally { setSaving(false); }
  };

  const footer = (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div className="flex flex-wrap items-start gap-x-6 gap-y-3 min-w-0">
          <Stat label={`Subtotal · ${lines.length} item${lines.length !== 1 ? "s" : ""}`} value={fmtBill(subtotal)} />
          {hasDiscount && <Stat label={discount > 0 ? "Discount" : "Added"} value={`${discount > 0 ? "−" : "+"}${fmtBill(Math.abs(discount))}`} />}
          {usd && (
            <Stat label={Number(xrate) > 0 ? `In ₹ at ${xrate} / $` : "In ₹"}
              value={Number(xrate) > 0 ? fmtMoneyInr(linesTotalInr) : <span className="text-xs text-amber-700">Enter the rate ₹/$</span>} />
          )}
          <div>
            <Label htmlFor={roundId} className="block text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Round off ₹</Label>
            <div className="mt-0.5 flex items-center gap-2">
              <Input id={roundId} type="number" step="1" value={roundOff} onChange={e => setRoundOff(e.target.value)} className="h-8 w-24 rounded-lg text-right tabular-nums" placeholder="e.g. -3" />
              {linesTotalInr > 0 && roundOffInr === 0 && linesTotalInr % 10 !== 0 && (
                <button type="button" onClick={() => setRoundOff(String(-(linesTotalInr % 10)))}
                  title={`Round ${fmtMoneyInr(linesTotalInr)} down to ${fmtMoneyInr(linesTotalInr - (linesTotalInr % 10))}`}
                  className="text-xs text-primary hover:underline whitespace-nowrap">
                  Round to {fmtMoneyInr(linesTotalInr - (linesTotalInr % 10))}
                </button>
              )}
            </div>
          </div>
        </div>
        <div className="text-right ml-auto">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{usd ? "Total (USD)" : "Total"}</p>
          <p className="font-display text-2xl sm:text-3xl font-bold text-brand-dark tabular-nums leading-tight">{usd ? fmtBill(netBill) : fmtMoneyInr(billTotalInr)}</p>
          {usd && <p className="text-[11px] text-muted-foreground tabular-nums">{fmtMoneyInr(billTotalInr)} payable in ₹</p>}
        </div>
      </div>
      <PanelActions onCancel={() => onOpenChange(false)}
        note={chosenSupplier
          ? `${lines.length} purchase${lines.length !== 1 ? "s" : ""} onto ${whose(chosenSupplier.name)} account, into ${multiCo ? `${whose(companyById(db.settings, companyId).name)} ` : ""}stock${certifiedLines ? " — each certified stone as its own packet" : ""}.`
          : "Choose the supplier the bill is from."}>
        <AsyncButton onClick={submit} disabled={saving} className="btn-hero rounded-xl h-11 flex-1 sm:flex-none sm:min-w-52">
          {saving ? "Saving…" : lines.length > 1 ? `Buy ${lines.length} Items → Stock` : "Buy → Stock"}
        </AsyncButton>
      </PanelActions>
    </div>
  );

  return (
    <ActionSheet open={open} onOpenChange={onOpenChange} size="lg" icon={ShoppingCart} title="New purchase"
      description="A supplier's bill into stock: a line for each size, quality or material, and the total onto the supplier's account."
      footer={footer}>
      <div className="@container space-y-5">
        {/* The bill's head: who it is from, its number and date, the currency, whose stock. */}
        <Group title="Bill">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Supplier" required className="col-span-2 @md:col-span-1">{id => (
              <Select value={supplierId} onValueChange={addNew("supplier", setSupplierId)}>
                <SelectTrigger id={id} className="h-10 rounded-xl"><SelectValue placeholder="Choose supplier" /></SelectTrigger>
                <SelectContent>{suppliers.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}<AddNewItem kind="supplier" /></SelectContent>
              </Select>
            )}</Field>
            <Field label="Bill no.">{id => (
              <Input id={id} value={billNo} onChange={e => setBillNo(e.target.value)} className="rounded-xl h-10" placeholder="Optional" />
            )}</Field>
            <Field label="Date">{id => (
              <Input id={id} type="date" value={date} onChange={e => setDate(e.target.value)} className="rounded-xl h-10" />
            )}</Field>
            <Field label="Billed in" className="col-span-2 @md:col-span-1">{id => (
              <div className="flex gap-2">
                <Select value={currency} onValueChange={v => setCurrency(v as PurchaseCurrency)}>
                  <SelectTrigger id={id} className={`h-10 rounded-xl ${usd ? "w-[6.5rem] shrink-0" : ""}`}><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="INR">INR (₹)</SelectItem><SelectItem value="USD">USD ($)</SelectItem></SelectContent>
                </Select>
                {usd && (
                  <div className="flex-1 min-w-0">
                    <UnitInput min={0} step="0.01" value={xrate} onChange={e => setXrate(e.target.value)} unit="₹/$" placeholder="Rate" aria-label="Exchange rate, ₹ per $" />
                  </div>
                )}
              </div>
            )}</Field>
            {multiCo && (
              <div className="col-span-2 @md:col-span-1">
                <CompanyPicker value={companyId} onChange={setCompanyId} label="Company — whose stock this is" />
              </div>
            )}
            <Field label="Remark" className={multiCo ? "col-span-2 @md:col-span-1" : "col-span-2"}>{id => (
              <Input id={id} value={notes} onChange={e => setNotes(e.target.value)} className="rounded-xl h-10" placeholder="Optional" />
            )}</Field>
          </div>
          <BillBrokerFields value={brokerage} onChange={setBrokerage} billTotalInr={billTotalInr} className="mt-3" />
        </Group>

        <Group title="Items" aside={<span className="text-xs text-muted-foreground">{lines.length} line{lines.length !== 1 ? "s" : ""}</span>}>
          <div className="space-y-2.5">
            {lines.map((l, i) => (
              <LineCard key={i} line={l} n={i + 1} currency={currency} removable={lines.length > 1}
                onChange={patch => set(i, patch)} onRemove={() => removeLine(i)} base={lineBase(l)} inr={lineInr(l)} />
            ))}
          </div>
          {/* Each line is added as its material, so it only ever shows that material's fields. */}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted-foreground mr-1">Add a line:</span>
            {KIND_ORDER.map(k => {
              const Icon = KIND[k].icon;
              return (
                <Button key={k} type="button" variant="outline" size="sm" onClick={() => addLine(k)} className="h-8 rounded-lg gap-1.5 text-xs px-2.5">
                  <Plus className="h-3.5 w-3.5" /><Icon className="h-3.5 w-3.5 text-muted-foreground" />{KIND[k].label}
                </Button>
              );
            })}
          </div>
        </Group>
      </div>
    </ActionSheet>
  );
}

/**
 * One line of the bill: its material as a badge, then only that material's
 * fields, in the same grid as every other line so the figures line up.
 */
function LineCard({ line: l, n, currency, removable, onChange, onRemove, base, inr }: {
  line: Line; n: number; currency: PurchaseCurrency; removable: boolean;
  onChange: (patch: Partial<Line>) => void; onRemove: () => void;
  /** This line in the bill's currency, after its discount — and in rupees, as saved. */
  base: number; inr: number;
}) {
  const db = useDb();
  // A certified stone's grading is optional, so it waits folded under a one-line summary.
  const [grading, setGrading] = useState(false);
  const unit = lineUnit(l, db.settings);
  const usd = currency === "USD";
  const disc = Number(l.discountPct) || 0;
  const Icon = KIND[l.kind].icon;
  const name = l.kind === "other" && l.materialId ? materialName(db.settings, l.materialId) : KIND[l.kind].label;
  const qtyLabel = l.kind === "gold" ? "Weight (g)" : l.kind === "loose" ? "Carat" : l.kind === "certified" ? "Size (ct)" : `Quantity (${unit})`;
  const qtyStep = l.kind === "gold" ? "0.001" : l.kind === "other" ? (unit === "pcs" ? "1" : "0.001") : "0.01";
  const sub = [disc !== 0 ? discountLabel(disc) : "", usd && inr > 0 ? fmtMoneyInr(inr) : ""].filter(Boolean).join(" · ");
  const gradingText = [l.color, l.clarity, l.cut, l.polish, l.sym, l.fluor, l.measure].map(s => s.trim()).filter(Boolean).join(" · ");
  const box = "h-9 rounded-xl bg-card";

  return (
    <div className="rounded-xl border border-border/60 bg-card p-3">
      <div className="flex items-center gap-2 mb-2.5 min-w-0">
        <span className="h-7 w-7 rounded-lg bg-primary/10 text-primary grid place-items-center shrink-0"><Icon className="h-3.5 w-3.5" /></span>
        <span className="text-sm font-medium text-foreground truncate">{name}</span>
        <span className="text-xs text-muted-foreground tabular-nums shrink-0">#{n}</span>
        <span className="ml-auto text-right shrink-0 pl-2">
          <span className="block text-sm font-semibold text-brand-dark tabular-nums leading-tight">{usd ? fmtCcy(Math.round(base * 100) / 100, "USD") : fmtMoneyInr(inr)}</span>
          {sub && <span className="block text-[10px] text-muted-foreground tabular-nums leading-tight">{sub}</span>}
        </span>
        <MoreMenu size="sm" label={`Line ${n}: change material`} title="Change this line to"
          className="border-transparent shadow-none text-muted-foreground"
          actions={KIND_ORDER.filter(k => k !== l.kind).map(k => ({ label: KIND[k].label, icon: KIND[k].icon, onSelect: () => onChange({ kind: k }) }))} />
        {removable && (
          <button type="button" onClick={onRemove} aria-label={`Remove item ${n}`} title="Remove this line"
            className="h-8 w-8 -mr-1 rounded-lg grid place-items-center shrink-0 text-muted-foreground hover:text-destructive hover:bg-destructive/10">
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      <div className={LINE_GRID}>
        {/* What it is — the first three columns. */}
        {l.kind === "gold" ? (
          <Field label="Purity">{id => (
            <Select value={l.purity} onValueChange={v => onChange({ purity: v })}>
              <SelectTrigger id={id} className="h-10 rounded-xl"><SelectValue /></SelectTrigger>
              <SelectContent>{GOLD_PURITIES.map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}</SelectContent>
            </Select>
          )}</Field>
        ) : l.kind === "other" ? (
          <>
            <Field label="Material"><OtherMaterialSelect value={l.materialId} onChange={v => onChange({ materialId: v, grade: "" })} /></Field>
            <Field label="Grade"><GradeInput material={l.materialId} value={l.grade} onChange={v => onChange({ grade: v })} /></Field>
            {unit !== "pcs"
              ? <Field label="Pcs">{id => <UnitInput id={id} min={0} step="1" value={l.pcs} onChange={e => onChange({ pcs: e.target.value })} placeholder="Optional" />}</Field>
              : <p className="self-end pb-1 text-[11px] leading-snug text-muted-foreground">{l.materialId ? `Counted in pieces — stock of ${materialName(db.settings, l.materialId)} per grade.` : ""}</p>}
          </>
        ) : (
          <>
            <Field label="Shape">{id => (
              <ListSelect id={id} list="diamondShapes" value={l.shape} onChange={v => onChange({ shape: v || "Round" })} optional={false} />
            )}</Field>
            {l.kind === "loose" ? (
              <>
                {/* The lot it goes into: shape · size · colour · clarity (lib/diamondLots.ts). */}
                <Field label="Size">{id => (
                  <ListSelect id={id} list="diamondSizes" value={l.size} onChange={v => onChange({ size: v })} />
                )}</Field>
                <Field label="Colour">{id => (
                  <ListSelect id={id} list="diamondColors" value={l.color} onChange={v => onChange({ color: v })} />
                )}</Field>
                <Field label="Clarity">{id => (
                  <ListSelect id={id} list="diamondClarities" value={l.clarity} onChange={v => onChange({ clarity: v })} />
                )}</Field>
                <Field label="Pcs">{id => (
                  <UnitInput id={id} min={0} step="1" value={l.pcs} onChange={e => onChange({ pcs: e.target.value })} placeholder="Optional" />
                )}</Field>
              </>
            ) : (
              <>
                <Field label="Report no." required>{id => (
                  <Input id={id} value={l.certNo} onChange={e => onChange({ certNo: e.target.value })} className="rounded-xl h-10" placeholder="Report number *" />
                )}</Field>
                <Field label="Lab">{id => (
                  <Input id={id} value={l.lab} onChange={e => onChange({ lab: e.target.value })} className="rounded-xl h-10" placeholder="GIA / IGI" />
                )}</Field>
              </>
            )}
          </>
        )}

        {/* How much, at what, less what — always the last three columns. */}
        <Field label={qtyLabel} className="@xl:col-start-4">{id => (
          <UnitInput id={id} min={0} step={qtyStep} unit={unit} value={l.qty} onChange={e => onChange({ qty: e.target.value })} />
        )}</Field>
        <Field label={`Rate / ${unit} (${currency})`}>{id => (
          <UnitInput id={id} min={0} unit={`${ccySymbol(currency)}/${unit}`} value={l.rate} onChange={e => onChange({ rate: e.target.value })} />
        )}</Field>
        <Field label="Discount %">{id => (
          <UnitInput id={id} min={-100} max={100} step="0.01" unit="%" value={l.discountPct} onChange={e => onChange({ discountPct: e.target.value })}
            placeholder="0" title="A minus figure adds instead — −2 adds 2%" />
        )}</Field>
      </div>

      {l.kind === "certified" && (
        <div className="mt-2.5 rounded-xl border border-border/50 bg-secondary/40">
          <button type="button" onClick={() => setGrading(o => !o)} aria-expanded={grading}
            className="w-full flex items-center gap-2 px-3 h-9 text-left min-w-0">
            <ChevronRight className={`h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform ${grading ? "rotate-90" : ""}`} />
            <span className="text-xs font-medium text-foreground shrink-0">Grading</span>
            <span className="text-xs text-muted-foreground truncate">{gradingText || "colour, clarity, cut, measurement — optional"}</span>
          </button>
          {grading && (
            <div className="grid grid-cols-2 @md:grid-cols-4 gap-2 px-3 pb-3">
              <ListSelect list="diamondColors" value={l.color} onChange={v => onChange({ color: v })} placeholder="Colour" className={box} />
              <ListSelect list="diamondClarities" value={l.clarity} onChange={v => onChange({ clarity: v })} placeholder="Clarity" className={box} />
              <Input value={l.cut} onChange={e => onChange({ cut: e.target.value })} className={box} placeholder="Cut" />
              <Input value={l.polish} onChange={e => onChange({ polish: e.target.value })} className={box} placeholder="Polish" />
              <Input value={l.sym} onChange={e => onChange({ sym: e.target.value })} className={box} placeholder="Symmetry" />
              <Input value={l.fluor} onChange={e => onChange({ fluor: e.target.value })} className={box} placeholder="Fluorescence" />
              <Input value={l.measure} onChange={e => onChange({ measure: e.target.value })} className={`${box} col-span-2`} placeholder="Measurement" />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
