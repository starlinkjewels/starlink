import { useState } from "react";
import { useAuth } from "@/lib/auth";
import { updateDb, uid, DIAMOND_SHAPES, toPureGold, type Purchase, type MaterialIssuance, type PurchaseCurrency } from "@/lib/db";
import { useDb } from "@/hooks/useDb";
import { increaseStock, decreaseStock, subscribeStockLevels, type StockLevels } from "@/lib/stock";
import { fmtMoneyInr, factoryFineGoldBalance } from "@/lib/manufacturing";
import { AsyncButton } from "@/components/AsyncButton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ShoppingCart, ArrowRightLeft, Coins, Gem, BadgeCheck } from "lucide-react";
import { toast } from "sonner";
import { useEffect } from "react";

const GOLD_PURITIES = ["9K", "10K", "14K", "18K", "22K", "24K"];
type Mode = "buy" | "assign";

/**
 * A simple staff-facing hub to (1) BUY gold / loose / certified diamond from any
 * supplier straight into company Stock (and onto the supplier's payable), and
 * (2) ASSIGN (transfer) stock gold to a factory's reserve. Deliberately additive
 * — reuses the same stock transactions + purchase model as the Supplier/Factory
 * pages, just gathered in one easy place.
 */
export function BuyAssignPage() {
  const [mode, setMode] = useState<Mode>("buy");
  return (
    <div className="max-w-3xl mx-auto space-y-5">
      <div>
        <h1 className="font-display text-2xl md:text-3xl text-brand-dark">Buy &amp; Assign</h1>
        <p className="text-sm text-muted-foreground mt-0.5">Buy material into stock, or hand gold to a factory — in one place</p>
      </div>

      <div className="grid grid-cols-2 gap-2">
        {([
          { m: "buy", label: "Buy Material", icon: ShoppingCart },
          { m: "assign", label: "Assign Gold to Factory", icon: ArrowRightLeft },
        ] as const).map(opt => (
          <button key={opt.m} onClick={() => setMode(opt.m)}
            className={`flex flex-col items-center gap-1.5 p-3 rounded-xl border transition-colors text-xs font-medium
              ${mode === opt.m ? "border-primary bg-primary/5 text-primary" : "border-border hover:border-primary/40 hover:bg-secondary/60"}`}>
            <opt.icon className="h-4 w-4" />
            {opt.label}
          </button>
        ))}
      </div>

      <div className="card-luxe p-6">
        {mode === "buy" ? <BuyMaterial /> : <AssignGold />}
      </div>
    </div>
  );
}

/* ── Buy material → Stock + supplier payable ── */
type BuyKind = "gold" | "loose" | "certified";
function BuyMaterial() {
  const { user } = useAuth();
  const db = useDb();
  const [supplierId, setSupplierId] = useState("");
  const [kind, setKind] = useState<BuyKind>("gold");
  const [purity, setPurity] = useState("22K");
  const [shape, setShape] = useState("Round");
  const [qty, setQty] = useState("");          // grams (gold) or carats (diamond)
  const [rate, setRate] = useState("");         // per gram / per carat
  const [quality, setQuality] = useState("");
  const [currency, setCurrency] = useState<PurchaseCurrency>("INR");
  const [totalUsd, setTotalUsd] = useState("");
  const [xrate, setXrate] = useState("");
  // certified grading
  const [color, setColor] = useState(""); const [clarity, setClarity] = useState("");
  const [cut, setCut] = useState(""); const [polish, setPolish] = useState(""); const [sym, setSym] = useState("");
  const [fluor, setFluor] = useState(""); const [measure, setMeasure] = useState("");
  const [lab, setLab] = useState(""); const [certNo, setCertNo] = useState("");
  const [saving, setSaving] = useState(false);

  const suppliers = db.suppliers.filter(s => s.active !== false).sort((a, b) => a.name.localeCompare(b.name));
  const totalInr = currency === "USD"
    ? Math.round((Number(totalUsd) || 0) * (Number(xrate) || 0))
    : Math.round((Number(qty) || 0) * (Number(rate) || 0));

  const submit = async () => {
    if (!supplierId) { toast.error("Choose a supplier"); return; }
    const q = Number(qty);
    if (!q || q <= 0) { toast.error(`Enter the ${kind === "gold" ? "weight" : "carat"}`); return; }
    if (kind === "certified" && !certNo.trim()) { toast.error("Enter the report number"); return; }
    if (currency === "USD" && (!totalUsd || !xrate)) { toast.error("Enter the USD amount and exchange rate"); return; }
    if (totalInr <= 0) { toast.error("Total comes to ₹0 — check the rate"); return; }
    const supplier = db.suppliers.find(s => s.id === supplierId);
    const purchaseId = uid("pur_");
    const now = new Date().toISOString();
    setSaving(true);
    try {
      // Gold + loose pool into Stock; certified never pools (it's a packet).
      if (kind !== "certified") {
        await increaseStock({
          material: kind === "gold" ? "gold" : "diamond",
          purityOrQuality: kind === "gold" ? purity : shape,
          quantity: q, refType: "purchase", refId: purchaseId, createdBy: user!.id,
        });
      }
      updateDb(d => {
        if (!d.purchases) d.purchases = [];
        const purchase: Purchase = {
          id: purchaseId, supplierId, material: kind === "gold" ? "gold" : "diamond",
          gold: kind === "gold" ? { weightGrams: q, purity, ratePerGram: Number(rate) || 0 } : undefined,
          diamond: kind !== "gold" ? {
            carat: q, quality: quality.trim() || undefined, ratePerCarat: Number(rate) || 0,
            kind: kind === "certified" ? "certified" : "loose", shape,
            certificateNumber: kind === "certified" ? certNo.trim() : undefined,
            certificateLab: kind === "certified" ? (lab.trim() || undefined) : undefined,
          } : undefined,
          purpose: "stock", currency,
          totalUsd: currency === "USD" ? Number(totalUsd) : undefined,
          exchangeRate: currency === "USD" ? Number(xrate) : undefined,
          totalInr, payments: [], createdBy: user!.id, createdAt: now,
        };
        d.purchases.unshift(purchase);
        if (kind === "certified") {
          if (!d.diamondPackets) d.diamondPackets = [];
          d.diamondPackets.unshift({
            id: uid("dp_"), shape, carat: q, quality: quality.trim() || undefined,
            color: color.trim() || undefined, clarity: clarity.trim() || undefined,
            cut: cut.trim() || undefined, polish: polish.trim() || undefined, symmetry: sym.trim() || undefined,
            fluorescence: fluor.trim() || undefined, measurement: measure.trim() || undefined,
            certificateNumber: certNo.trim(), certificateLab: lab.trim() || undefined,
            ratePerCaratInr: q > 0 ? Math.round((totalInr / q) * 100) / 100 : undefined,
            supplierId, purchaseId, status: "in_stock", createdBy: user!.id, createdAt: now,
          });
        }
      });
      toast.success(`Bought ${q}${kind === "gold" ? "g" : "ct"} → stock · ${fmtMoneyInr(totalInr)} to ${supplier?.name || "supplier"}`);
      setQty(""); setRate(""); setQuality(""); setTotalUsd(""); setXrate("");
      setColor(""); setClarity(""); setCut(""); setPolish(""); setSym(""); setFluor(""); setMeasure(""); setLab(""); setCertNo("");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to buy");
    } finally { setSaving(false); }
  };

  return (
    <div className="space-y-3">
      <div>
        <Label className="text-xs">Supplier</Label>
        <Select value={supplierId} onValueChange={setSupplierId}>
          <SelectTrigger className="h-10 rounded-xl mt-1"><SelectValue placeholder="Choose supplier" /></SelectTrigger>
          <SelectContent>{suppliers.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}</SelectContent>
        </Select>
      </div>

      <div className="grid grid-cols-3 gap-1 p-1 bg-secondary rounded-xl">
        {([["gold","Gold",Coins],["loose","Loose Dia.",Gem],["certified","Certified",BadgeCheck]] as const).map(([k, lbl, Icon]) => (
          <button key={k} type="button" onClick={() => setKind(k)}
            className={`flex items-center justify-center gap-1.5 h-9 rounded-lg text-xs font-medium transition-colors ${kind === k ? "bg-white shadow-soft text-brand-dark" : "text-muted-foreground"}`}>
            <Icon className="h-3.5 w-3.5" /> {lbl}
          </button>
        ))}
      </div>

      {kind === "gold" ? (
        <div className="grid grid-cols-3 gap-2.5">
          <div><Label className="text-xs">Weight (g)</Label><Input type="number" min={0} step="0.01" value={qty} onChange={e => setQty(e.target.value)} className="rounded-xl h-10 mt-1" /></div>
          <div><Label className="text-xs">Purity</Label>
            <Select value={purity} onValueChange={setPurity}><SelectTrigger className="h-10 rounded-xl mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>{GOLD_PURITIES.map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}</SelectContent></Select></div>
          <div><Label className="text-xs">Rate / g ({currency})</Label><Input type="number" min={0} value={rate} onChange={e => setRate(e.target.value)} className="rounded-xl h-10 mt-1" /></div>
        </div>
      ) : (
        <div className="space-y-2.5">
          <div className="grid grid-cols-3 gap-2.5">
            <div><Label className="text-xs">Shape</Label>
              <Select value={shape} onValueChange={setShape}><SelectTrigger className="h-10 rounded-xl mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>{DIAMOND_SHAPES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent></Select></div>
            <div><Label className="text-xs">{kind === "certified" ? "Size (ct)" : "Carat"}</Label><Input type="number" min={0} step="0.01" value={qty} onChange={e => setQty(e.target.value)} className="rounded-xl h-10 mt-1" /></div>
            <div><Label className="text-xs">Rate / ct ({currency})</Label><Input type="number" min={0} value={rate} onChange={e => setRate(e.target.value)} className="rounded-xl h-10 mt-1" /></div>
          </div>
          {kind === "loose" ? (
            <Input value={quality} onChange={e => setQuality(e.target.value)} className="rounded-xl h-10" placeholder="Quality (optional)" />
          ) : (
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
        </div>
      )}

      <div className="grid grid-cols-3 gap-2.5">
        <Select value={currency} onValueChange={v => setCurrency(v as PurchaseCurrency)}>
          <SelectTrigger className="h-10 rounded-xl"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="INR">Billed in INR</SelectItem><SelectItem value="USD">Billed in USD</SelectItem></SelectContent>
        </Select>
        {currency === "USD" && (
          <>
            <Input type="number" min={0} value={totalUsd} onChange={e => setTotalUsd(e.target.value)} className="rounded-xl h-10" placeholder="Total ($)" />
            <Input type="number" min={0} step="0.01" value={xrate} onChange={e => setXrate(e.target.value)} className="rounded-xl h-10" placeholder="Rate ₹/$" />
          </>
        )}
      </div>

      <div className="flex items-center justify-between gap-2 pt-1">
        <span className="text-sm">Total: <span className="font-semibold text-brand-dark">{fmtMoneyInr(totalInr)}</span> <span className="text-xs text-muted-foreground">to supplier</span></span>
        <AsyncButton onClick={submit} disabled={saving} className="btn-hero rounded-xl h-10">{saving ? "Saving…" : "Buy → Stock"}</AsyncButton>
      </div>
    </div>
  );
}

/* ── Assign (transfer) stock gold → a factory's reserve ── */
function AssignGold() {
  const { user } = useAuth();
  const db = useDb();
  const [levels, setLevels] = useState<StockLevels | null>(null);
  const [factoryId, setFactoryId] = useState("");
  const [purity, setPurity] = useState("22K");
  const [grams, setGrams] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => subscribeStockLevels(setLevels), []);
  const factories = db.factories.filter(f => f.active !== false).sort((a, b) => a.name.localeCompare(b.name));
  const inStock = levels?.gold?.[purity] ?? 0;

  const submit = async () => {
    if (!factoryId) { toast.error("Choose a factory"); return; }
    const g = Number(grams);
    if (!g || g <= 0) { toast.error("Enter the grams"); return; }
    if (g > inStock) { toast.error(`Only ${inStock}g of ${purity} in stock`); return; }
    const factory = db.factories.find(f => f.id === factoryId);
    const issuanceId = uid("mi_");
    const now = new Date().toISOString();
    setSaving(true);
    try {
      await decreaseStock({
        material: "gold", purityOrQuality: purity, quantity: g,
        type: "issuance_out", refType: "materialIssuance", refId: issuanceId, createdBy: user!.id,
        note: `Assigned to ${factory?.name || "factory"}`,
      });
      updateDb(d => {
        if (!d.materialIssuances) d.materialIssuances = [];
        const mi: MaterialIssuance = {
          id: issuanceId, factoryId, orderId: undefined, material: "gold",
          purityOrQuality: purity, quantityIssued: g, source: "stock",
          issuedAt: now, issuedBy: user!.id, status: "open",
          finishedPieces: [], makingCharges: { amountInr: 0, payments: [] },
        };
        d.materialIssuances.unshift(mi);
      });
      toast.success(`${g}g ${purity} (${toPureGold(g, purity)}g fine) assigned to ${factory?.name || "factory"}`);
      setGrams("");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to assign");
    } finally { setSaving(false); }
  };

  return (
    <div className="space-y-3">
      <div>
        <Label className="text-xs">Factory</Label>
        <Select value={factoryId} onValueChange={setFactoryId}>
          <SelectTrigger className="h-10 rounded-xl mt-1"><SelectValue placeholder="Choose factory" /></SelectTrigger>
          <SelectContent>{factories.map(f => <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>)}</SelectContent>
        </Select>
        {factoryId && (
          <p className="text-xs text-muted-foreground mt-1">Currently holds <span className="font-semibold text-amber-700">{factoryFineGoldBalance(db.materialIssuances, factoryId)}g fine (24KT)</span></p>
        )}
      </div>
      <div className="grid grid-cols-2 gap-2.5">
        <div><Label className="text-xs">Purity</Label>
          <Select value={purity} onValueChange={setPurity}><SelectTrigger className="h-10 rounded-xl mt-1"><SelectValue /></SelectTrigger>
            <SelectContent>{GOLD_PURITIES.map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}</SelectContent></Select></div>
        <div><Label className="text-xs">Grams to assign</Label><Input type="number" min={0} step="0.01" value={grams} onChange={e => setGrams(e.target.value)} className="rounded-xl h-10 mt-1" /></div>
      </div>
      <p className="text-xs text-muted-foreground">In stock: <span className="font-semibold text-foreground">{inStock}g of {purity}</span>{Number(grams) > 0 ? ` · ${toPureGold(Number(grams), purity)}g fine gold` : ""}</p>
      <AsyncButton onClick={submit} disabled={saving} className="btn-hero rounded-xl h-10 w-full">{saving ? "Saving…" : "Assign to Factory"}</AsyncButton>
    </div>
  );
}
