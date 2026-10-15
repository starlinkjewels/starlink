import { AddNewItem, useAddNew } from "@/components/create/QuickCreate";
import { useCan } from "@/hooks/useCan";
import { useState } from "react";
import { useAuth } from "@/lib/auth";
import { StockActivityLedger } from "@/components/StockActivityLedger";
import { BuyMaterialForm } from "@/components/BuyMaterialForm";
import { updateDb, uid, DIAMOND_SHAPES, toPureGold, nextDiamondStockNumber, todayLocal, stampFor, type Purchase, type MaterialIssuance, type PurchaseCurrency } from "@/lib/db";
import { useDb } from "@/hooks/useDb";
import { increaseStock, decreaseStockSelfHealing } from "@/lib/stock";
import { fmtMoneyInr, factoryFineGoldBalance, deriveStockBalances } from "@/lib/manufacturing";
import { AsyncButton } from "@/components/AsyncButton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ShoppingCart, ArrowRightLeft, Coins, Gem, BadgeCheck, Tag, Boxes, Layers } from "lucide-react";
import { toast } from "sonner";
import { OtherMaterialSelect, GradeInput } from "@/components/MaterialFields";
import { materialDef, materialName, materialUnit, fmtQty, type MaterialKey } from "@/lib/materials";

const GOLD_PURITIES = ["9K", "10K", "14K", "18K", "22K", "24K"];
type Mode = "buy" | "assign" | "sell" | "opening";

/**
 * A simple staff-facing hub to (1) BUY gold / loose / certified diamond from any
 * supplier straight into company Stock (and onto the supplier's payable),
 * (2) ASSIGN (transfer) stock gold to a factory's reserve, and (3) SELL a
 * diamond straight out of stock to a buyer, with no jewellery order involved.
 * Deliberately additive — reuses the same stock transactions + purchase model
 * as the Supplier/Factory pages, just gathered in one easy place.
 */
export function BuyAssignPage() {
  const [mode, setMode] = useState<Mode>("buy");
  const can = useCan();
  return (
    <div className="max-w-7xl mx-auto space-y-5">
      <div>
        <h1 className="font-display text-2xl md:text-3xl text-brand-dark">Buy &amp; Assign</h1>
        <p className="text-sm text-muted-foreground mt-0.5">Buy material into stock, hand gold or other metal to a factory, or sell a diamond directly</p>
      </div>

      <div className="grid grid-cols-4 gap-1.5 sm:gap-2">
        {([
          { m: "buy", label: "Buy Material", icon: ShoppingCart },
          { m: "opening", label: "Opening Stock", icon: Boxes },
          { m: "assign", label: "Assign to Factory", icon: ArrowRightLeft },
          { m: "sell", label: "Sell Diamond", icon: Tag },
        ] as const).map(opt => (
          <button key={opt.m} onClick={() => setMode(opt.m)}
            className={`flex flex-col items-center justify-center gap-1.5 px-1.5 py-2.5 sm:p-3 rounded-xl border transition-colors text-[11px] sm:text-xs font-medium leading-tight text-center
              ${mode === opt.m ? "border-primary bg-primary/5 text-primary" : "border-border hover:border-primary/40 hover:bg-secondary/60"}`}>
            <opt.icon className="h-4 w-4" />
            {opt.label}
          </button>
        ))}
      </div>

      {can("buyAssign", "add") ? (
        <div className="card-luxe p-5 sm:p-6">
          {mode === "buy" ? <BuyMaterialForm /> : mode === "opening" ? <OpeningStock /> : mode === "assign" ? <AssignGold /> : <SellDiamond />}
        </div>
      ) : (
        <div className="card-luxe p-4 text-sm text-muted-foreground">
          Your role lets you look at these entries but not record new ones.
        </div>
      )}

      {/* Everything the four tabs above have done, so a day's entries can be
          checked afterwards instead of disappearing into four different places. */}
      <StockActivityLedger />
    </div>
  );
}

/* ── Buy material → Stock + supplier payable ── */
type BuyKind = "gold" | "loose" | "certified" | "other";

/* ── Opening Stock → seed material already owned (migration). No supplier, no
   payable — it just increases Stock and shows an "Opening Stock" line (with its
   ₹ value) in the stock ledger. ── */
function OpeningStock() {
  const { user } = useAuth();
  const db = useDb();
  const [kind, setKind] = useState<BuyKind>("gold"); // gold | loose | certified | other
  const [materialId, setMaterialId] = useState("");
  const [grade, setGrade] = useState("");
  const [purity, setPurity] = useState("22K");
  const [shape, setShape] = useState("Round");
  const [qty, setQty] = useState("");     // grams (gold) / carats (diamond)
  const [value, setValue] = useState(""); // ₹ valuation (optional)
  const [asOf, setAsOf] = useState(todayLocal()); // as-of date, today unless changed
  const [note, setNote] = useState("");
  // certified grading
  const [quality, setQuality] = useState("");
  const [color, setColor] = useState(""); const [clarity, setClarity] = useState("");
  const [cut, setCut] = useState(""); const [polish, setPolish] = useState(""); const [sym, setSym] = useState("");
  const [fluor, setFluor] = useState(""); const [measure, setMeasure] = useState("");
  const [lab, setLab] = useState(""); const [certNo, setCertNo] = useState("");
  const [saving, setSaving] = useState(false);

  const resetGrading = () => { setQuality(""); setColor(""); setClarity(""); setCut(""); setPolish(""); setSym(""); setFluor(""); setMeasure(""); setLab(""); setCertNo(""); };

  const submit = async () => {
    const q = Number(qty);
    if (kind === "other" && !materialDef(db.settings, materialId)) { toast.error("Choose the material"); return; }
    if (!q || q <= 0) { toast.error(`Enter the opening ${kind === "gold" ? "weight (g)" : kind === "other" ? "quantity" : "carats"}`); return; }
    if (kind === "certified" && !certNo.trim()) { toast.error("Enter the report / certificate number"); return; }
    const val = Number(value) > 0 ? Math.round(Number(value)) : undefined;
    // Carries the time of day, so several opening entries on one date keep the
    // order they were typed in rather than all landing at midnight.
    const createdAt = stampFor(asOf);
    setSaving(true);
    try {
      if (kind === "certified") {
        // Certified stones are individual packets — never pooled into stockLevels.
        // Opening one just creates an in-stock packet, with NO supplier / purchase.
        updateDb(d => {
          if (!d.diamondPackets) d.diamondPackets = [];
          d.diamondPackets.unshift({
            id: uid("dp_"), stockNumber: nextDiamondStockNumber(d), shape, carat: q,
            quality: quality.trim() || undefined,
            color: color.trim() || undefined, clarity: clarity.trim() || undefined,
            cut: cut.trim() || undefined, polish: polish.trim() || undefined, symmetry: sym.trim() || undefined,
            fluorescence: fluor.trim() || undefined, measurement: measure.trim() || undefined,
            certificateNumber: certNo.trim(), certificateLab: lab.trim() || undefined,
            ratePerCaratInr: val && q > 0 ? Math.round((val / q) * 100) / 100 : undefined,
            status: "in_stock", createdBy: user!.id, createdAt,
          });
        });
        toast.success(`Opening certified diamond added: ${q}ct ${shape} (${certNo.trim()})`);
        setQty(""); setValue(""); setAsOf(""); setNote(""); resetGrading();
        return;
      }
      // Gold, loose diamond or another material pools into Stock.
      const material: MaterialKey = kind === "gold" ? "gold" : kind === "other" ? (materialId as MaterialKey) : "diamond";
      const bucket = kind === "gold" ? purity : kind === "other" ? (grade.trim() || "—") : shape;
      await increaseStock({
        material,
        purityOrQuality: bucket,
        quantity: q,
        refType: "opening",
        valueInr: val,
        createdBy: user!.id,
        createdAt: asOf ? createdAt : undefined,
        note: note.trim() || undefined,
      });
      toast.success(`Opening stock added: ${fmtQty(q, materialUnit(db.settings, material))} ${bucket}${kind === "other" ? ` ${materialName(db.settings, material)}` : ""}`);
      setQty(""); setValue(""); setAsOf(""); setNote("");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't add opening stock");
    } finally { setSaving(false); }
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground -mt-1">
        Stock you already own from before this app. It goes straight into Stock and shows in the ledger — <span className="font-medium text-foreground">no supplier and no dues (ughrani)</span>.
      </p>

      {/* Material kind — gold / loose diamond / certified diamond */}
      <div className="grid grid-cols-4 gap-1 p-1 bg-secondary rounded-xl">
        {([["gold", "Gold", Coins], ["loose", "Loose Dia.", Gem], ["certified", "Certified", BadgeCheck], ["other", "Other", Layers]] as const).map(([k, lbl, Icon]) => (
          <button key={k} type="button" onClick={() => setKind(k)}
            className={`flex items-center justify-center gap-1.5 h-9 rounded-lg text-xs font-medium transition-colors ${kind === k ? "bg-white shadow-soft text-brand-dark" : "text-muted-foreground"}`}>
            <Icon className="h-3.5 w-3.5" /> {lbl}
          </button>
        ))}
      </div>

      {/* Another material: which one, its grade, how much */}
      {kind === "other" ? (
      <div className="grid sm:grid-cols-3 gap-3">
        <div><Label className="text-xs">Material</Label><div className="mt-1"><OtherMaterialSelect value={materialId} onChange={v => { setMaterialId(v); setGrade(""); }} /></div></div>
        <div><Label className="text-xs">Grade</Label><div className="mt-1"><GradeInput material={materialId} value={grade} onChange={setGrade} /></div></div>
        <div>
          <Label className="text-xs">Opening quantity ({materialUnit(db.settings, materialId)}) <span className="text-destructive">*</span></Label>
          <Input type="number" min={0} step="0.001" value={qty} onChange={e => setQty(e.target.value)} className="rounded-xl h-10 mt-1" placeholder="0" />
        </div>
      </div>
      ) : (
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label className="text-xs">{kind === "gold" ? "Purity" : "Shape"}</Label>
          {kind === "gold" ? (
            <Select value={purity} onValueChange={setPurity}>
              <SelectTrigger className="h-10 rounded-xl mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>{GOLD_PURITIES.map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}</SelectContent>
            </Select>
          ) : (
            <Select value={shape} onValueChange={setShape}>
              <SelectTrigger className="h-10 rounded-xl mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>{DIAMOND_SHAPES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
            </Select>
          )}
        </div>
        <div>
          <Label className="text-xs">Opening {kind === "gold" ? "Weight (g)" : "Carats"} <span className="text-destructive">*</span></Label>
          <Input type="number" min={0} step="0.001" value={qty} onChange={e => setQty(e.target.value)} className="rounded-xl h-10 mt-1" placeholder="0" />
        </div>
      </div>
      )}

      {/* Certified grading */}
      {kind === "certified" && (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
          <Input value={color} onChange={e => setColor(e.target.value)} className="rounded-xl h-10" placeholder="Color" />
          <Input value={clarity} onChange={e => setClarity(e.target.value)} className="rounded-xl h-10" placeholder="Clarity" />
          <Input value={cut} onChange={e => setCut(e.target.value)} className="rounded-xl h-10" placeholder="Cut" />
          <Input value={polish} onChange={e => setPolish(e.target.value)} className="rounded-xl h-10" placeholder="Polish" />
          <Input value={sym} onChange={e => setSym(e.target.value)} className="rounded-xl h-10" placeholder="Symmetry" />
          <Input value={fluor} onChange={e => setFluor(e.target.value)} className="rounded-xl h-10" placeholder="Fluorescence" />
          <Input value={measure} onChange={e => setMeasure(e.target.value)} className="rounded-xl h-10 sm:col-span-2" placeholder="Measurement" />
          <Input value={lab} onChange={e => setLab(e.target.value)} className="rounded-xl h-10" placeholder="Lab (GIA/IGI)" />
          <Input value={certNo} onChange={e => setCertNo(e.target.value)} className="rounded-xl h-10 sm:col-span-3" placeholder="Report number *" />
        </div>
      )}

      {/* Value */}
      <div>
        <Label className="text-xs">Opening Value (₹, optional)</Label>
        <Input type="number" min={0} value={value} onChange={e => setValue(e.target.value)} className="rounded-xl h-10 mt-1" placeholder={kind === "certified" ? "Cost basis for this stone" : "Valuation for the ledger"} />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label className="text-xs">As of date (optional)</Label>
          <Input type="date" value={asOf} onChange={e => setAsOf(e.target.value)} className="rounded-xl h-10 mt-1" />
        </div>
        <div>
          <Label className="text-xs">Note (optional)</Label>
          <Input value={note} onChange={e => setNote(e.target.value)} className="rounded-xl h-10 mt-1" placeholder="e.g. carried forward" />
        </div>
      </div>

      <AsyncButton onClick={submit} disabled={saving} className="btn-hero rounded-xl h-10 w-full">{saving ? "Saving…" : "Add Opening Stock"}</AsyncButton>
    </div>
  );
}

/* ── Assign (transfer) stock gold — or another material — → a factory's reserve ── */
function AssignGold() {
  const { user } = useAuth();
  const db = useDb();
  const addNew = useAddNew();
  const [factoryId, setFactoryId] = useState("");
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
  const otherStock = what === "other" && materialId ? deriveStockBalances(db.stockMovements, materialId) : {};
  const inStock = what === "gold" ? (deriveStockBalances(db.stockMovements, "gold")[purity] ?? 0) : (otherStock[bucket] ?? 0);

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
        material, purityOrQuality: bucket, quantity: g,
        type: "issuance_out", refType: "materialIssuance", refId: issuanceId, createdBy: user!.id,
        note: `Assigned to ${factory?.name || "factory"}`,
      }, db.stockMovements);
      updateDb(d => {
        if (!d.materialIssuances) d.materialIssuances = [];
        const mi: MaterialIssuance = {
          id: issuanceId, factoryId, orderId: undefined, material,
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
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to assign");
    } finally { setSaving(false); }
  };

  return (
    <div className="space-y-3">
      <div>
        <Label className="text-xs">Factory</Label>
        <Select value={factoryId} onValueChange={addNew("factory", setFactoryId)}>
          <SelectTrigger className="h-10 rounded-xl mt-1"><SelectValue placeholder="Choose factory" /></SelectTrigger>
          <SelectContent>{factories.map(f => <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>)}<AddNewItem kind="factory" /></SelectContent>
        </Select>
        {factoryId && (
          <p className="text-xs text-muted-foreground mt-1">Currently holds <span className="font-semibold text-amber-700">{factoryFineGoldBalance(db.materialIssuances, factoryId, db.factories.find(f => f.id === factoryId)?.openingFineGold)}g fine (24KT)</span></p>
        )}
      </div>
      <div className="grid grid-cols-2 gap-1 p-1 bg-secondary rounded-xl">
        {([["gold", "Gold", Coins], ["other", "Other material", Layers]] as const).map(([k, lbl, Icon]) => (
          <button key={k} type="button" onClick={() => setWhat(k)}
            className={`flex items-center justify-center gap-1.5 h-9 rounded-lg text-xs font-medium transition-colors ${what === k ? "bg-white shadow-soft text-brand-dark" : "text-muted-foreground"}`}>
            <Icon className="h-3.5 w-3.5" /> {lbl}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-2.5">
        {what === "gold" ? (
          <div><Label className="text-xs">Purity</Label>
            <Select value={purity} onValueChange={setPurity}><SelectTrigger className="h-10 rounded-xl mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>{GOLD_PURITIES.map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}</SelectContent></Select></div>
        ) : (
          <div className="grid grid-cols-2 gap-2.5">
            <div><Label className="text-xs">Material</Label><div className="mt-1"><OtherMaterialSelect value={materialId} onChange={v => { setMaterialId(v); setGrade(""); }} /></div></div>
            <div><Label className="text-xs">Grade</Label><div className="mt-1"><GradeInput material={materialId} value={grade} onChange={setGrade} /></div></div>
          </div>
        )}
        <div><Label className="text-xs">{what === "gold" ? "Grams to assign" : `Quantity to assign (${unit})`}</Label><Input type="number" min={0} step="0.01" value={grams} onChange={e => setGrams(e.target.value)} className="rounded-xl h-10 mt-1" /></div>
        <div><Label className="text-xs">Date</Label><Input type="date" value={date} onChange={e => setDate(e.target.value)} className="rounded-xl h-10 mt-1" /></div>
        <div><Label className="text-xs">Remark</Label><Input value={notes} onChange={e => setNotes(e.target.value)} className="rounded-xl h-10 mt-1" placeholder="Optional" /></div>
      </div>
      <p className="text-xs text-muted-foreground">In stock: <span className="font-semibold text-foreground">{fmtQty(inStock, unit)} of {bucket}{what === "other" && materialId ? ` ${materialName(db.settings, material)}` : ""}</span>{what === "gold" && Number(grams) > 0 ? ` · ${toPureGold(Number(grams), purity)}g fine gold` : ""}</p>
      <AsyncButton onClick={submit} disabled={saving} className="btn-hero rounded-xl h-10 w-full">{saving ? "Saving…" : "Assign to Factory"}</AsyncButton>
    </div>
  );
}

/* ── Sell a diamond straight out of stock — no jewellery order involved ── */
type SellKind = "loose" | "certified";
type BuyerMode = "client" | "other";
function SellDiamond() {
  const { user } = useAuth();
  const db = useDb();
  const addNew = useAddNew();
  const [kind, setKind] = useState<SellKind>("loose");
  const [shape, setShape] = useState("Round");
  const [packetId, setPacketId] = useState("");
  const [carat, setCarat] = useState("");
  const [rate, setRate] = useState("");
  const [currency, setCurrency] = useState<PurchaseCurrency>("INR");
  const [xrate, setXrate] = useState("");
  const [buyerMode, setBuyerMode] = useState<BuyerMode>("client");
  const [clientId, setClientId] = useState("");
  const [buyerName, setBuyerName] = useState("");
  const [lockerId, setLockerId] = useState("");
  const [notes, setNotes] = useState("");
  const [date, setDate] = useState(todayLocal());
  const [saving, setSaving] = useState(false);

  const clients = db.clients.slice().sort((a, b) => a.companyName.localeCompare(b.companyName));
  const lockers = db.lockers.filter(l => l.active && (l.currency || "INR") === currency);
  const inStockPackets = (db.diamondPackets ?? []).filter(p => p.status === "in_stock").sort((a, b) => (a.stockNumber || "").localeCompare(b.stockNumber || ""));
  const selectedPacket = inStockPackets.find(p => p.id === packetId);
  const looseInStock = deriveStockBalances(db.stockMovements, "diamond")[shape] ?? 0;

  const effectiveCarat = kind === "certified" ? (selectedPacket?.carat ?? 0) : (Number(carat) || 0);
  const baseAmount = effectiveCarat * (Number(rate) || 0);
  const totalInr = currency === "USD" ? Math.round(baseAmount * (Number(xrate) || 0)) : Math.round(baseAmount);

  const submit = async () => {
    if (kind === "loose") {
      const c = Number(carat);
      if (!c || c <= 0) { toast.error("Enter the carat"); return; }
      if (c > looseInStock) { toast.error(`Only ${looseInStock}ct of ${shape} in stock`); return; }
    } else if (!packetId) { toast.error("Choose a certified diamond"); return; }
    if (!rate || Number(rate) <= 0) { toast.error("Enter the rate"); return; }
    if (currency === "USD" && !xrate) { toast.error("Enter the exchange rate"); return; }
    if (buyerMode === "client" && !clientId) { toast.error("Choose a client"); return; }
    if (buyerMode === "other" && !buyerName.trim()) { toast.error("Enter the buyer's name"); return; }
    if (totalInr <= 0) { toast.error("Total comes to ₹0 — check the rate"); return; }

    const saleId = uid("ds_");
    const now = stampFor(date);
    const client = buyerMode === "client" ? clients.find(c => c.id === clientId) : undefined;
    const buyerLabel = client?.companyName || buyerName.trim();
    const saleShape = kind === "certified" ? selectedPacket!.shape : shape;
    setSaving(true);
    try {
      if (kind === "loose") {
        await decreaseStockSelfHealing({
          material: "diamond", purityOrQuality: shape, quantity: effectiveCarat,
          type: "issuance_out", refType: "diamondSale", refId: saleId, createdBy: user!.id,
          note: `Sold to ${buyerLabel}`,
        }, db.stockMovements);
      }
      updateDb(d => {
        if (!d.diamondSales) d.diamondSales = [];
        d.diamondSales.unshift({
          id: saleId, kind, shape: saleShape, packetId: kind === "certified" ? packetId : undefined,
          carat: effectiveCarat, ratePerCarat: Number(rate), currency,
          totalUsd: currency === "USD" ? Math.round(baseAmount * 100) / 100 : undefined,
          exchangeRate: currency === "USD" ? Number(xrate) : undefined,
          totalInr,
          clientId: buyerMode === "client" ? clientId : undefined,
          buyerName: buyerMode === "other" ? buyerName.trim() : undefined,
          lockerId: lockerId || undefined,
          notes: notes.trim() || undefined,
          soldBy: user!.id, createdAt: now,
        });
        if (kind === "certified") {
          const p = d.diamondPackets.find(x => x.id === packetId);
          if (p) p.status = "sold";
        }
        if (lockerId) {
          if (!d.lockerTransactions) d.lockerTransactions = [];
          d.lockerTransactions.push({
            id: uid("ltx_"), lockerId, type: "income",
            amountInr: currency === "USD" ? Math.round(baseAmount * 100) / 100 : totalInr,
            currency, category: "Diamond Sale", refType: "manual",
            note: `${effectiveCarat}ct ${kind === "certified" ? "certified " : ""}${saleShape} sold to ${buyerLabel}`,
            recordedBy: user!.id, createdAt: now,
          });
        }
      });
      toast.success(`Sold ${effectiveCarat}ct ${saleShape} to ${buyerLabel} — ${fmtMoneyInr(totalInr)}`);
      setCarat(""); setRate(""); setXrate(""); setPacketId(""); setBuyerName(""); setClientId(""); setNotes(""); setLockerId("");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to record sale");
    } finally { setSaving(false); }
  };

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-1 p-1 bg-secondary rounded-xl">
        {(["loose", "certified"] as const).map(k => (
          <button key={k} type="button" onClick={() => { setKind(k); setPacketId(""); }}
            className={`h-9 rounded-lg text-xs font-medium transition-colors ${kind === k ? "bg-white shadow-soft text-brand-dark" : "text-muted-foreground"}`}>
            {k === "loose" ? "Loose" : "Certified"}
          </button>
        ))}
      </div>

      {kind === "loose" ? (
        <div className="grid grid-cols-2 gap-2.5">
          <div><Label className="text-xs">Shape</Label>
            <Select value={shape} onValueChange={setShape}><SelectTrigger className="h-10 rounded-xl mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>{DIAMOND_SHAPES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent></Select></div>
          <div><Label className="text-xs">Carat to sell</Label><Input type="number" min={0} step="0.01" value={carat} onChange={e => setCarat(e.target.value)} className="rounded-xl h-10 mt-1" /></div>
        </div>
      ) : (
        <div>
          <Label className="text-xs">Certified diamond</Label>
          <Select value={packetId} onValueChange={setPacketId}>
            <SelectTrigger className="h-10 rounded-xl mt-1"><SelectValue placeholder="Choose a diamond in stock" /></SelectTrigger>
            <SelectContent>
              {inStockPackets.map(p => (
                <SelectItem key={p.id} value={p.id}>
                  {p.stockNumber ? `${p.stockNumber} · ` : ""}{p.shape} {p.carat}ct{p.certificateNumber ? ` · Report ${p.certificateNumber}` : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {inStockPackets.length === 0 && <p className="text-xs text-muted-foreground mt-1">No certified diamonds in stock.</p>}
        </div>
      )}

      {kind === "loose" && (
        <p className="text-xs text-muted-foreground">In stock: <span className="font-semibold text-foreground">{looseInStock}ct of {shape}</span></p>
      )}

      <div className="grid grid-cols-3 gap-2.5">
        <div className="col-span-2"><Label className="text-xs">Rate / ct ({currency})</Label><Input type="number" min={0} value={rate} onChange={e => setRate(e.target.value)} className="rounded-xl h-10 mt-1" /></div>
        <div><Label className="text-xs">Currency</Label>
          <Select value={currency} onValueChange={v => setCurrency(v as PurchaseCurrency)}>
            <SelectTrigger className="h-10 rounded-xl mt-1"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="INR">INR</SelectItem><SelectItem value="USD">USD</SelectItem></SelectContent>
          </Select>
        </div>
      </div>
      {currency === "USD" && (
        <div className="grid grid-cols-2 gap-2.5">
          <div className="rounded-xl h-10 px-3 flex items-center bg-secondary/60 text-sm text-muted-foreground">
            Total: <span className="font-semibold text-foreground ml-1">${baseAmount.toFixed(2)}</span>
          </div>
          <Input type="number" min={0} step="0.01" value={xrate} onChange={e => setXrate(e.target.value)} className="rounded-xl h-10" placeholder="Exchange rate (₹/$)" />
        </div>
      )}

      <div>
        <Label className="text-xs">Buyer</Label>
        <div className="grid grid-cols-2 gap-1 p-1 bg-secondary rounded-xl mt-1">
          {(["client", "other"] as const).map(b => (
            <button key={b} type="button" onClick={() => setBuyerMode(b)}
              className={`h-9 rounded-lg text-xs font-medium transition-colors ${buyerMode === b ? "bg-white shadow-soft text-brand-dark" : "text-muted-foreground"}`}>
              {b === "client" ? "Existing Client" : "Other / Walk-in"}
            </button>
          ))}
        </div>
        {buyerMode === "client" ? (
          <Select value={clientId} onValueChange={addNew("client", setClientId)}>
            <SelectTrigger className="h-10 rounded-xl mt-1"><SelectValue placeholder="Choose client" /></SelectTrigger>
            <SelectContent>{clients.map(c => <SelectItem key={c.id} value={c.id}>{c.companyName}</SelectItem>)}<AddNewItem kind="client" /></SelectContent>
          </Select>
        ) : (
          <Input value={buyerName} onChange={e => setBuyerName(e.target.value)} className="rounded-xl h-10 mt-1" placeholder="Buyer's name" />
        )}
      </div>

      <div>
        <Label className="text-xs">Deposit proceeds into (optional)</Label>
        <Select value={lockerId || "__none"} onValueChange={addNew("locker", v => setLockerId(v === "__none" ? "" : v))}>
          <SelectTrigger className="h-10 rounded-xl mt-1"><SelectValue placeholder="Don't record a cash movement" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__none">Don't record a cash movement</SelectItem>
            {lockers.map(l => <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>)}
          <AddNewItem kind="locker" /></SelectContent>
        </Select>
        {lockerId === "" && lockers.length === 0 && (
          <p className="text-xs text-muted-foreground mt-1">No active {currency} lockers — sale will still be recorded, just without a cash entry.</p>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
        <div className="sm:col-span-2">
          <Label className="text-xs">Remark</Label>
          <Input value={notes} onChange={e => setNotes(e.target.value)} className="rounded-xl h-10 mt-1" placeholder="Optional" />
        </div>
        <div>
          <Label className="text-xs">Date</Label>
          <Input type="date" value={date} onChange={e => setDate(e.target.value)} className="rounded-xl h-10 mt-1" />
        </div>
      </div>

      <div className="flex items-center justify-between gap-2 pt-1">
        <span className="text-sm">Total: <span className="font-semibold text-brand-dark">{fmtMoneyInr(totalInr)}</span></span>
        <AsyncButton onClick={submit} disabled={saving} className="btn-hero rounded-xl h-10">{saving ? "Saving…" : "Record Sale"}</AsyncButton>
      </div>
    </div>
  );
}
