import { AddNewItem, useAddNew } from "@/components/create/QuickCreate";
import { StatStrip } from "@/components/TableToolbar";
import { useCan } from "@/hooks/useCan";
import { useState, type ReactNode } from "react";
import { useAuth } from "@/lib/auth";
import { StockActivityLedger, type LedgerTotals } from "@/components/StockActivityLedger";
import { LotPicker } from "@/components/LotFields";
import { lotParts, lotShape } from "@/lib/diamondLots";
import { BuyMaterialForm, OpeningStockForm } from "@/components/BuyMaterialForm";
import { updateDb, uid, toPureGold, todayLocal, stampFor, type MaterialIssuance, type PurchaseCurrency } from "@/lib/db";
import { useDb } from "@/hooks/useDb";
import { decreaseStockSelfHealing } from "@/lib/stock";
import { fmtMoneyInr, factoryFineGoldBalance, deriveStockBalances, lockerBalance } from "@/lib/manufacturing";
import { fmtCcy, ccySymbol } from "@/lib/currency";
import { AsyncButton } from "@/components/AsyncButton";
import { ActionSheet } from "@/components/ActionSheet";
import { PageHeader } from "@/components/PageHeader";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ShoppingCart, ArrowRightLeft, Coins, Gem, BadgeCheck, Tag, Boxes, Layers, Plus, Truck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useIsMobile } from "@/hooks/use-mobile";
import { toast } from "sonner";
import { OtherMaterialSelect, GradeInput } from "@/components/MaterialFields";
import { materialDef, materialName, materialUnit, fmtQty, type MaterialKey } from "@/lib/materials";
import { CompanyPicker, useDefaultCompany, useMultiCo } from "@/components/CompanyFields";
import { coField, companyOf } from "@/lib/companies";
import { Field, Group, PanelActions, Segmented, Stat, Stats, UnitInput } from "@/components/BillLayout";
import { SellToSupplierSheet } from "@/components/SellToSupplierSheet";

const GOLD_PURITIES = ["9K", "10K", "14K", "18K", "22K", "24K"];
type Mode = "buy" | "assign" | "sell" | "sellSupplier" | "opening";
/** Open and close one of the page's panels. */
type PanelProps = { open: boolean; onOpenChange: (open: boolean) => void };


/**
 * A simple staff-facing hub to (1) BUY gold / loose / certified diamond from any
 * supplier straight into company Stock (and onto the supplier's payable),
 * (2) ASSIGN (transfer) stock gold to a factory's reserve, and (3) SELL a
 * diamond straight out of stock to a buyer, with no jewellery order involved.
 * Deliberately additive — reuses the same stock transactions + purchase model
 * as the Supplier/Factory pages, just gathered in one easy place.
 *
 * The page is this month's figures and the history; each entry opens in a
 * panel over it, so the list stays where it was while one is made.
 */
export function BuyAssignPage() {
  const can = useCan();
  const may = can("buyAssign", "add");
  const [panel, setPanel] = useState<Mode | null>(null);
  const panelFor = (m: Mode): PanelProps => ({ open: panel === m, onOpenChange: o => setPanel(o ? m : null) });
  // The ledger's own total, shown as the fourth figure up top.
  const [ledgerTotals, setLedgerTotals] = useState<LedgerTotals | null>(null);
  // A phone has room for two named buttons: there Assign to factory waits in the ⋯.
  const phone = useIsMobile();
  return (
    <div className="max-w-7xl mx-auto space-y-5">
      <PageHeader
        title="Buy & Assign"
        subtitle="Material into stock, out to factories"
        primary={may ? { label: "New purchase", icon: Plus, onClick: () => setPanel("buy") } : null}
        // Selling out of stock, in sight: to one of our suppliers, or a diamond to a client or any buyer.
        secondary={may ? { label: "Sell", icon: Tag, items: [
          { label: "Sell to a supplier", icon: Truck, hint: "Diamonds, gold, a piece — off what we owe them", onSelect: () => setPanel("sellSupplier") },
          { label: "Sell a diamond", icon: Gem, hint: "To a client or any buyer — no order", onSelect: () => setPanel("sell") },
        ] } : null}
        actions={may && !phone ? (
          <Button variant="outline" onClick={() => setPanel("assign")} className="h-10 rounded-xl px-3.5 gap-2">
            <ArrowRightLeft className="h-4 w-4" />Assign to factory
          </Button>
        ) : undefined}
        menu={may ? [
          { label: "Assign to factory", icon: ArrowRightLeft, hint: "Stock gold or material to a factory", onSelect: () => setPanel("assign"), show: phone },
          { label: "Opening stock", icon: Boxes, hint: "From before the app — no dues", onSelect: () => setPanel("opening") },
        ] : undefined}
      >
        {!may && <p className="text-xs text-muted-foreground mt-1">View only — your role can't add entries.</p>}
      </PageHeader>

      <MonthFigures ledger={ledgerTotals} />

      {/* Everything the four entries have done, so a day's work can be checked
          afterwards instead of disappearing into four different places. */}
      <StockActivityLedger onTotals={setLedgerTotals} />

      {may && (
        <>
          <BuyMaterialForm {...panelFor("buy")} />
          <OpeningStock {...panelFor("opening")} />
          <AssignGold {...panelFor("assign")} />
          <SellDiamond {...panelFor("sell")} />
          <SellToSupplierSheet {...panelFor("sellSupplier")} />
        </>
      )}
    </div>
  );
}

/**
 * This month at a glance: what was bought, what went to factories, what was
 * sold — counted the way the history below counts them, so the two agree.
 */
function MonthFigures({ ledger }: { ledger: LedgerTotals | null }) {
  const db = useDb();
  const now = new Date();
  const month = now.toLocaleDateString("en-IN", { month: "long" });
  const inMonth = (iso?: string) => {
    if (!iso) return false;
    const d = new Date(iso);
    return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
  };
  const total = <T,>(xs: T[], f: (x: T) => number) => Math.round(xs.reduce((s, x) => s + (f(x) || 0), 0) * 1000) / 1000;

  // A bill is its lines saved together: one bill number, or one supplier at one moment.
  const bought = (db.purchases ?? []).filter(p => inMonth(p.createdAt));
  const bills = new Set(bought.map(p => (p.invoiceNumber?.trim() ? `${p.supplierId}|no:${p.invoiceNumber.trim()}` : `${p.supplierId}|at:${p.createdAt}`))).size;
  // Handed over from stock on this page — not material issued against an order.
  const issued = (db.materialIssuances ?? []).filter(i => !i.orderId && i.source === "stock" && inMonth(i.issuedAt));
  const gold = issued.filter(i => i.material === "gold");
  const goldG = total(gold, i => i.quantityIssued);
  const fineG = total(gold, i => toPureGold(i.quantityIssued, i.purityOrQuality));
  const diamondCt = total(issued.filter(i => i.material === "diamond"), i => i.quantityIssued);
  const others = issued.filter(i => i.material !== "gold" && i.material !== "diamond").length;
  const sold = (db.diamondSales ?? []).filter(s => inMonth(s.createdAt));
  // Sold to our suppliers this month (lib/supplierSales.ts) — and to how many.
  const toSuppliers = (db.supplierSales ?? []).filter(s => inMonth(s.createdAt) && !s.deletingAt);
  const supplierCount = new Set(toSuppliers.map(s => s.supplierId)).size;

  // The month's three figures, then the ledger's total below them — in the
  // app's one figure strip. The ledger's follows its filters, and says so.
  const all = ledger && ledger.totalIn > 0 ? ledger : null;
  return (
    <StatStrip items={[
      { label: `Bought in ${month}`, value: fmtMoneyInr(total(bought, p => p.totalInr)), icon: ShoppingCart, sub: `${bills} bill${bills !== 1 ? "s" : ""}` },
      {
        label: "Assigned to factories", icon: ArrowRightLeft,
        value: goldG > 0 || diamondCt === 0 ? `${fmtQty(goldG, "g")}` : fmtQty(diamondCt, "ct"),
        sub: [goldG > 0 || diamondCt === 0 ? `gold · ${fmtQty(fineG, "g")} fine` : "diamond",
          goldG > 0 && diamondCt > 0 ? `${fmtQty(diamondCt, "ct")} diamond` : "",
          others ? `${others} other` : ""].filter(Boolean).join(" · "),
      },
      { label: "Diamonds sold", value: fmtQty(total(sold, s => s.carat), "ct"), icon: Tag, sub: `${fmtMoneyInr(total(sold, s => s.totalInr))} · ${sold.length} sale${sold.length !== 1 ? "s" : ""}` },
      { label: `Sold to suppliers in ${month}`, value: fmtMoneyInr(total(toSuppliers, s => s.totalInr)), icon: Truck,
        sub: toSuppliers.length ? `${toSuppliers.length} sale${toSuppliers.length !== 1 ? "s" : ""} · ${supplierCount} supplier${supplierCount !== 1 ? "s" : ""}` : "none yet" },
      ...(all ? [{
        label: all.filtered ? "Bought in · filtered" : "Bought in · all time", icon: ShoppingCart,
        value: fmtMoneyInr(all.totalIn),
        sub: [`${all.nBought} ${all.nBought === 1 ? "entry" : "entries"}`,
          all.totalOut > 0 ? `sold ${fmtMoneyInr(all.totalOut)}` : ""].filter(Boolean).join(" · "),
      }] : []),
    ]} />
  );
}

/** A panel's footer: its figures over its buttons. */
function PanelFooter({ figures, onCancel, children }: { figures: ReactNode; onCancel: () => void; children: ReactNode }) {
  return (
    <div className="space-y-3">
      <Stats>{figures}</Stats>
      <PanelActions onCancel={onCancel}>{children}</PanelActions>
    </div>
  );
}

/* ── Buy material → Stock + supplier payable ── */
/** The certificate boxes of a certified stone. */
const SAVE = "btn-hero rounded-xl h-11 flex-1 sm:flex-none sm:min-w-48";

/* ── Opening Stock → seed material already owned (migration). No supplier, no
   payable — it just increases Stock and shows an "Opening Stock" line (with its
   ₹ value) in the stock ledger. ── */
/** Also on the Stock page (its "Opening stock" button) — the same form, the same records. */
export function OpeningStock({ open, onOpenChange }: PanelProps) {
  // The same line cards as a purchase (components/BuyMaterialForm → OpeningStockForm).
  return <OpeningStockForm open={open} onOpenChange={onOpenChange} />;
}

/* ── Assign (transfer) stock gold — or another material — → a factory's reserve ── */
function AssignGold({ open, onOpenChange }: PanelProps) {
  const { user } = useAuth();
  const db = useDb();
  const addNew = useAddNew();
  const multiCo = useMultiCo();
  const [factoryId, setFactoryId] = useState("");
  // Whose stock it leaves, and whose share of the factory's pool it joins.
  const [companyId, setCompanyId] = useState(useDefaultCompany());
  const [what, setWhat] = useState<"gold" | "other">("gold");
  const [materialId, setMaterialId] = useState("");
  const [grade, setGrade] = useState("");
  const [purity, setPurity] = useState("22K");
  const [grams, setGrams] = useState("");
  const [date, setDate] = useState(todayLocal());
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  const factories = db.factories.filter(f => f.active !== false).sort((a, b) => a.name.localeCompare(b.name));
  const material: MaterialKey = what === "gold" ? "gold" : (materialId as MaterialKey);
  const bucket = what === "gold" ? purity : (grade.trim() || "—");
  const unit = materialUnit(db.settings, material);
  const otherStock = what === "other" && materialId ? deriveStockBalances(db.stockMovements, materialId, companyId) : {};
  const inStock = what === "gold" ? (deriveStockBalances(db.stockMovements, "gold", companyId)[purity] ?? 0) : (otherStock[bucket] ?? 0);

  const submit = async () => {
    if (!factoryId) { toast.error("Choose a factory"); return; }
    if (what === "other" && !materialDef(db.settings, materialId)) { toast.error("Choose the material"); return; }
    const g = Number(grams);
    if (!g || g <= 0) { toast.error(`Enter the ${what === "gold" ? "grams" : "quantity"}`); return; }
    if (g > inStock) { toast.error(`Only ${fmtQty(inStock, unit)} of ${bucket} in stock`); return; }
    const factory = db.factories.find(f => f.id === factoryId);
    const issuanceId = uid("mi_");
    const now = stampFor(date);
    setSaving(true);
    try {
      await decreaseStockSelfHealing({
        material, companyId, purityOrQuality: bucket, quantity: g,
        type: "issuance_out", refType: "materialIssuance", refId: issuanceId, createdBy: user!.id,
        note: `Assigned to ${factory?.name || "factory"}`,
      }, db.stockMovements);
      updateDb(d => {
        if (!d.materialIssuances) d.materialIssuances = [];
        const mi: MaterialIssuance = {
          id: issuanceId, factoryId, orderId: undefined, material, ...coField(companyId),
          purityOrQuality: bucket, quantityIssued: g, source: "stock",
          issuedAt: now, issuedBy: user!.id, status: "open",
          finishedPieces: [], makingCharges: { amountInr: 0, payments: [] },
          notes: notes.trim() || undefined,
        };
        d.materialIssuances.unshift(mi);
      });
      toast.success(what === "gold"
        ? `${g}g ${purity} (${toPureGold(g, purity)}g fine) assigned to ${factory?.name || "factory"}`
        : `${fmtQty(g, unit)} ${bucket} ${materialName(db.settings, material)} assigned to ${factory?.name || "factory"}`);
      setGrams(""); setNotes("");
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to assign");
    } finally { setSaving(false); }
  };

  const assigning = Number(grams) || 0;
  const stockText = `${bucket}${what === "other" && materialId ? ` ${materialName(db.settings, material)}` : ""}`;

  return (
    <ActionSheet open={open} onOpenChange={onOpenChange} size="md" icon={ArrowRightLeft} title="Assign to factory"
      description="It leaves stock and joins the factory's pool."
      footer={(
        <PanelFooter onCancel={() => onOpenChange(false)} figures={<>
          <Stat label="Assigning" value={assigning > 0 ? fmtQty(assigning, unit) : "—"} sub={stockText} />
          {what === "gold" && <Stat label="Fine gold (24K)" value={assigning > 0 ? `${toPureGold(assigning, purity)} g` : "—"} />}
          <Stat label="Left in stock" value={assigning > inStock ? <span className="text-destructive">Not enough</span> : fmtQty(inStock - assigning, unit)}
            sub={`of ${fmtQty(inStock, unit)}`} />
        </>}>
          <AsyncButton onClick={submit} disabled={saving} className={SAVE}>{saving ? "Saving…" : "Assign to Factory"}</AsyncButton>
        </PanelFooter>
      )}>
      <div className="@container space-y-5">
        {/* Company first, then the factory: the factory's pool is kept per company. */}
        <Group>
          <div className="grid grid-cols-2 gap-3">
            {multiCo && (
              <div className="col-span-2 @md:col-span-1">
                <CompanyPicker value={companyId} onChange={setCompanyId} label="Company — whose stock it leaves" />
              </div>
            )}
            <Field label="Factory" className={multiCo ? "col-span-2 @md:col-span-1" : "col-span-2"}
              hint={factoryId && <>Currently holds <span className="font-semibold text-amber-700">{factoryFineGoldBalance(db.materialIssuances, factoryId, db.factories.find(f => f.id === factoryId)?.openingFineGold, companyId)}g fine (24KT)</span></>}>{id => (
              <Select value={factoryId} onValueChange={addNew("factory", setFactoryId)}>
                <SelectTrigger id={id} className="h-10 rounded-xl"><SelectValue placeholder="Choose factory" /></SelectTrigger>
                <SelectContent>{factories.map(f => <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>)}<AddNewItem kind="factory" /></SelectContent>
              </Select>
            )}</Field>
            <Field label="Date">{id => <Input id={id} type="date" value={date} onChange={e => setDate(e.target.value)} className="rounded-xl h-10" />}</Field>
            <Field label="Remark">{id => (
              <Input id={id} value={notes} onChange={e => setNotes(e.target.value)} className="rounded-xl h-10" placeholder="Optional" />
            )}</Field>
          </div>
        </Group>

        <Group title="Material">
          <Segmented className="mb-3 max-w-[20rem]" value={what} onChange={setWhat} options={[["gold", "Gold", Coins], ["other", "Other material", Layers]] as const} />
          <div className="grid grid-cols-2 gap-3">
            {what === "gold" ? (
              <Field label="Purity">{id => (
                <Select value={purity} onValueChange={setPurity}>
                  <SelectTrigger id={id} className="h-10 rounded-xl"><SelectValue /></SelectTrigger>
                  <SelectContent>{GOLD_PURITIES.map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}</SelectContent>
                </Select>
              )}</Field>
            ) : (
              <>
                <Field label="Material"><OtherMaterialSelect value={materialId} onChange={v => { setMaterialId(v); setGrade(""); }} /></Field>
                <Field label="Grade"><GradeInput material={materialId} value={grade} onChange={setGrade} /></Field>
              </>
            )}
            <Field label={what === "gold" ? "Grams to assign" : `Quantity to assign (${unit})`}
              hint={<>In stock: <span className="font-semibold text-foreground">{fmtQty(inStock, unit)} of {stockText}</span></>}>{id => (
              <UnitInput id={id} min={0} step="0.01" unit={unit} value={grams} onChange={e => setGrams(e.target.value)} />
            )}</Field>
          </div>
        </Group>
      </div>
    </ActionSheet>
  );
}

/* ── Sell a diamond straight out of stock — no jewellery order involved ── */
type SellKind = "loose" | "certified";
type BuyerMode = "client" | "other";
function SellDiamond({ open, onOpenChange }: PanelProps) {
  const { user } = useAuth();
  const db = useDb();
  const addNew = useAddNew();
  const multiCo = useMultiCo();
  const [companyId, setCompanyId] = useState(useDefaultCompany()); // whose stock it is sold from
  const [kind, setKind] = useState<SellKind>("loose");
  // Loose: the stock lot sold from (its bucket — "Round · +6.5-7 · G-H · VS", or just "Round") and how many stones.
  const [shape, setShape] = useState("");
  const [pcs, setPcs] = useState("");
  const [packetId, setPacketId] = useState("");
  const [carat, setCarat] = useState("");
  const [rate, setRate] = useState("");
  const [currency, setCurrency] = useState<PurchaseCurrency>("INR");
  const [xrate, setXrate] = useState("");
  const [buyerMode, setBuyerMode] = useState<BuyerMode>("client");
  const [clientId, setClientId] = useState("");
  const [buyerName, setBuyerName] = useState("");
  const [lockerId, setLockerId] = useState("");
  // Asked every time: was the money received now — and into which account? A
  // sale saved with no account appears in no account's history.
  const [paid, setPaid] = useState<"now" | "later">("now");
  const [notes, setNotes] = useState("");
  const [date, setDate] = useState(todayLocal());
  const [saving, setSaving] = useState(false);

  const clients = db.clients.slice().sort((a, b) => a.companyName.localeCompare(b.companyName));
  // Every account in the sale's currency that isn't switched off — older ones carry no "active" flag at all.
  const lockers = db.lockers.filter(l => l.active !== false && (l.currency || "INR") === currency);
  const inStockPackets = (db.diamondPackets ?? []).filter(p => p.status === "in_stock" && companyOf(p) === companyId).sort((a, b) => (a.stockNumber || "").localeCompare(b.stockNumber || ""));
  const selectedPacket = inStockPackets.find(p => p.id === packetId);
  const looseInStock = deriveStockBalances(db.stockMovements, "diamond", companyId)[shape] ?? 0;

  const effectiveCarat = kind === "certified" ? (selectedPacket?.carat ?? 0) : (Number(carat) || 0);
  const baseAmount = effectiveCarat * (Number(rate) || 0);
  const totalInr = currency === "USD" ? Math.round(baseAmount * (Number(xrate) || 0)) : Math.round(baseAmount);

  const submit = async () => {
    if (kind === "loose") {
      const c = Number(carat);
      if (!shape) { toast.error("Choose the lot to sell from"); return; }
      if (!c || c <= 0) { toast.error("Enter the carat"); return; }
      if (c > looseInStock) { toast.error(`Only ${looseInStock}ct of ${shape} in stock`); return; }
    } else if (!packetId) { toast.error("Choose a certified diamond"); return; }
    if (!rate || Number(rate) <= 0) { toast.error("Enter the rate"); return; }
    if (currency === "USD" && !xrate) { toast.error("Enter the exchange rate"); return; }
    if (buyerMode === "client" && !clientId) { toast.error("Choose a client"); return; }
    if (buyerMode === "other" && !buyerName.trim()) { toast.error("Enter the buyer's name"); return; }
    if (totalInr <= 0) { toast.error("Total comes to ₹0 — check the rate"); return; }
    if (paid === "now" && !lockerId) { toast.error("Choose the account the money went into"); return; }

    const saleId = uid("ds_");
    const now = stampFor(date);
    const client = buyerMode === "client" ? clients.find(c => c.id === clientId) : undefined;
    const buyerLabel = client?.companyName || buyerName.trim();
    const saleShape = kind === "certified" ? selectedPacket!.shape : lotShape(shape);
    const salePcs = kind === "loose" && Number(pcs) > 0 ? Math.round(Number(pcs)) : undefined;
    setSaving(true);
    try {
      if (kind === "loose") {
        await decreaseStockSelfHealing({
          material: "diamond", companyId, purityOrQuality: shape, quantity: effectiveCarat,
          type: "issuance_out", refType: "diamondSale", refId: saleId, createdBy: user!.id,
          note: `Sold to ${buyerLabel}`, lot: lotParts(shape), pieces: salePcs,
        }, db.stockMovements);
      }
      updateDb(d => {
        if (!d.diamondSales) d.diamondSales = [];
        d.diamondSales.unshift({
          id: saleId, kind, shape: saleShape, packetId: kind === "certified" ? packetId : undefined, ...coField(companyId),
          ...(kind === "loose" ? { bucket: shape, pieces: salePcs } : {}),
          carat: effectiveCarat, ratePerCarat: Number(rate), currency,
          totalUsd: currency === "USD" ? Math.round(baseAmount * 100) / 100 : undefined,
          exchangeRate: currency === "USD" ? Number(xrate) : undefined,
          totalInr,
          clientId: buyerMode === "client" ? clientId : undefined,
          buyerName: buyerMode === "other" ? buyerName.trim() : undefined,
          lockerId: paid === "now" ? lockerId || undefined : undefined,
          notes: notes.trim() || undefined,
          soldBy: user!.id, createdAt: now,
        });
        if (kind === "certified") {
          const p = d.diamondPackets.find(x => x.id === packetId);
          if (p) p.status = "sold";
        }
        if (paid === "now" && lockerId) {
          if (!d.lockerTransactions) d.lockerTransactions = [];
          d.lockerTransactions.push({
            id: uid("ltx_"), lockerId, type: "income",
            amountInr: currency === "USD" ? Math.round(baseAmount * 100) / 100 : totalInr,
            // Marked as the sale's own money, tied to it by id: written as a
            // plain "manual" entry it could be corrected alone in Payments →
            // Account entries, leaving the sale and the stone out of step. It is
            // also not a client paying a bill, so it is never offered for
            // applying to one — that would rewrite it as a client payment.
            currency, category: "Diamond Sale", refType: "diamondSale", refId: saleId, notClientPayment: true,
            note: `${effectiveCarat}ct ${kind === "certified" ? "certified " : ""}${saleShape} sold to ${buyerLabel}`,
            recordedBy: user!.id, createdAt: now,
          });
        }
      });
      toast.success(`Sold ${effectiveCarat}ct ${saleShape} to ${buyerLabel} — ${fmtMoneyInr(totalInr)}`);
      setCarat(""); setPcs(""); setRate(""); setXrate(""); setPacketId(""); setBuyerName(""); setClientId(""); setNotes(""); setLockerId(""); setPaid("now");
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to record sale");
    } finally { setSaving(false); }
  };

  const usd = currency === "USD";

  return (
    <ActionSheet open={open} onOpenChange={onOpenChange} size="md" icon={Tag} title="Sell a diamond"
      description="From stock to any buyer — no jewellery order."
      footer={(
        <PanelFooter onCancel={() => onOpenChange(false)} figures={<>
          <Stat label="Carat" value={effectiveCarat > 0 ? fmtQty(effectiveCarat, "ct") : "—"}
            sub={kind === "certified" ? (selectedPacket ? `${selectedPacket.stockNumber ? `${selectedPacket.stockNumber} · ` : ""}${selectedPacket.shape}` : "choose the stone") : shape} />
          <Stat label="Rate" value={Number(rate) > 0 ? `${fmtCcy(Number(rate), currency)} / ct` : "—"} />
          <Stat big label="Total" value={baseAmount <= 0 ? "—" : usd ? fmtCcy(Math.round(baseAmount * 100) / 100, "USD") : fmtMoneyInr(totalInr)}
            sub={usd ? (Number(xrate) > 0 ? `${fmtMoneyInr(totalInr)} at ₹${xrate} / $` : "enter the exchange rate") : undefined} />
        </>}>
          <AsyncButton onClick={submit} disabled={saving} className={SAVE}>{saving ? "Saving…" : "Record Sale"}</AsyncButton>
        </PanelFooter>
      )}>
      <div className="@container space-y-5">
        <Group>
          <div className="grid grid-cols-2 gap-3">
            {multiCo && (
              <div className="col-span-2 @md:col-span-1">
                <CompanyPicker value={companyId} onChange={v => { setCompanyId(v); setPacketId(""); }} label="Company — whose stock it is sold from" />
              </div>
            )}
            <Field label="Date" className={multiCo ? "col-span-2 @md:col-span-1" : ""}>{id => (
              <Input id={id} type="date" value={date} onChange={e => setDate(e.target.value)} className="rounded-xl h-10" />
            )}</Field>
            <Field label="Remark" className={multiCo ? "col-span-2" : ""}>{id => (
              <Input id={id} value={notes} onChange={e => setNotes(e.target.value)} className="rounded-xl h-10" placeholder="Optional" />
            )}</Field>
          </div>
        </Group>

        <Group title="Diamond">
          <Segmented className="mb-3 max-w-[20rem]" value={kind} onChange={k => { setKind(k); setPacketId(""); }}
            options={[["loose", "Loose", Gem], ["certified", "Certified", BadgeCheck]] as const} />
          <div className="grid grid-cols-2 gap-3">
            {kind === "loose" ? (
              <>
                <Field label="Lot" className="col-span-2">{id => (
                  <LotPicker id={id} value={shape} onChange={setShape} companyId={companyId} />
                )}</Field>
                <Field label="Carat to sell" hint={shape ? <>In stock: <span className="font-semibold text-foreground">{looseInStock}ct</span></> : undefined}>{id => (
                  <UnitInput id={id} min={0} step="0.01" unit="ct" value={carat} onChange={e => setCarat(e.target.value)} />
                )}</Field>
                <Field label="Pcs">{id => (
                  <UnitInput id={id} min={0} step="1" value={pcs} onChange={e => setPcs(e.target.value)} placeholder="Optional" />
                )}</Field>
              </>
            ) : (
              <Field label="Certified diamond" className="col-span-2" hint={inStockPackets.length === 0 ? "No certified diamonds in stock." : undefined}>{id => (
                <Select value={packetId} onValueChange={setPacketId}>
                  <SelectTrigger id={id} className="h-10 rounded-xl"><SelectValue placeholder="Choose a diamond in stock" /></SelectTrigger>
                  <SelectContent>
                    {inStockPackets.map(p => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.stockNumber ? `${p.stockNumber} · ` : ""}{p.shape} {p.carat}ct{p.certificateNumber ? ` · Report ${p.certificateNumber}` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}</Field>
            )}
            <Field label={`Rate / ct (${currency})`}>{id => (
              <UnitInput id={id} min={0} unit={`${ccySymbol(currency)}/ct`} value={rate} onChange={e => setRate(e.target.value)} />
            )}</Field>
            <Field label="Currency">{id => (
              <Select value={currency} onValueChange={v => setCurrency(v as PurchaseCurrency)}>
                <SelectTrigger id={id} className="h-10 rounded-xl"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="INR">INR</SelectItem><SelectItem value="USD">USD</SelectItem></SelectContent>
              </Select>
            )}</Field>
            {usd && (
              <Field label="Exchange rate (₹/$)">{id => (
                <UnitInput id={id} min={0} step="0.01" unit="₹/$" value={xrate} onChange={e => setXrate(e.target.value)} placeholder="Exchange rate (₹/$)" />
              )}</Field>
            )}
          </div>
        </Group>

        <Group title="Buyer & payment">
          <div className="space-y-3">
            <Field label="Buyer">
              <Segmented value={buyerMode} onChange={setBuyerMode} options={[["client", "Existing Client"], ["other", "Other / Walk-in"]] as const} />
            </Field>
            <Field label={buyerMode === "client" ? "Client" : "Buyer's name"}>{id => buyerMode === "client" ? (
              <Select value={clientId} onValueChange={addNew("client", setClientId)}>
                <SelectTrigger id={id} className="h-10 rounded-xl"><SelectValue placeholder="Choose client" /></SelectTrigger>
                <SelectContent>{clients.map(c => <SelectItem key={c.id} value={c.id}>{c.companyName}</SelectItem>)}<AddNewItem kind="client" /></SelectContent>
              </Select>
            ) : (
              <Input id={id} value={buyerName} onChange={e => setBuyerName(e.target.value)} className="rounded-xl h-10" placeholder="Buyer's name" />
            )}</Field>
            <Field label="Money">
              <Segmented value={paid} onChange={setPaid} options={[["now", "Received now"], ["later", "Not received yet"]] as const} />
            </Field>
            {paid === "now" ? (
              <Field label="Into account *"
                hint={lockers.length === 0 ? `No ${currency} account yet — add one with "+ Add new".` : "The sale shows in this account's history."}>{id => (
                <Select value={lockerId} onValueChange={addNew("locker", setLockerId)}>
                  <SelectTrigger id={id} className="h-10 rounded-xl"><SelectValue placeholder={`Choose the ${currency} account`} /></SelectTrigger>
                  <SelectContent>
                    {lockers.map(l => <SelectItem key={l.id} value={l.id}>{l.name}{l.type === "bank" && l.accountNumberLast4 ? ` ····${l.accountNumberLast4}` : ""} · {fmtCcy(lockerBalance(l, db.lockerTransactions), l.currency)}</SelectItem>)}
                  <AddNewItem kind="locker" /></SelectContent>
                </Select>
              )}</Field>
            ) : (
              <p className="text-xs rounded-xl border border-amber-200 bg-amber-50 text-amber-800 px-3 py-2.5">
                No account entry is made now. When the money comes, record it from the Locker (Record entry → Money in).
              </p>
            )}
          </div>
        </Group>
      </div>
    </ActionSheet>
  );
}
