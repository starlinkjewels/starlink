import { useMemo, useState } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { updateDb, uid, fmtDate, type MaterialIssuance } from "@/lib/db";
import { useDb } from "@/hooks/useDb";
import { useAuth } from "@/lib/auth";
import {
  factoryAccount, issuancePaid, issuancePending, issuanceUsed, issuanceWastage, fmtMoneyInr,
} from "@/lib/manufacturing";
import { decreaseStock } from "@/lib/stock";
import { Button } from "@/components/ui/button";
import { AsyncButton } from "@/components/AsyncButton";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  ArrowLeft, Factory as FactoryIcon, Phone, MapPin, Wallet, Plus, CreditCard, CheckCircle2, Coins, Gem,
} from "lucide-react";
import { motion } from "framer-motion";
import { toast } from "sonner";

const GOLD_PURITIES = ["9K", "14K", "18K", "22K", "24K"];

type IssuanceAction = "piece" | "charge" | "pay" | null;

export function FactoryHistoryPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const db = useDb();

  const factory = db.factories.find(f => f.id === id);
  if (!factory) {
    return (
      <div className="text-center py-20 text-muted-foreground">
        Factory not found. <Link to="/factories" className="text-primary underline">Back to Factories</Link>
      </div>
    );
  }

  const issuances = db.materialIssuances
    .filter(i => i.factoryId === id)
    .sort((a, b) => +new Date(b.issuedAt) - +new Date(a.issuedAt));
  const account = factoryAccount(issuances);

  // ── Issue material ──
  const [showIssueForm, setShowIssueForm] = useState(false);
  const [issueOrderNumber, setIssueOrderNumber] = useState("");
  const [issueMaterial, setIssueMaterial] = useState<"gold" | "diamond">("gold");
  const [issueSource, setIssueSource] = useState<"stock" | "purchase">("stock");
  const [issuePurchaseId, setIssuePurchaseId] = useState("");
  const [issuePurity, setIssuePurity] = useState("22K");
  const [issueQuality, setIssueQuality] = useState("");
  const [issueQuantity, setIssueQuantity] = useState("");
  const [issueNotes, setIssueNotes] = useState("");
  const [issuing, setIssuing] = useState(false);

  const matchedOrder = useMemo(
    () => db.orders.find(o => o.orderNumber.trim().toLowerCase() === issueOrderNumber.trim().toLowerCase()),
    [db.orders, issueOrderNumber],
  );

  // Purchases bought specifically for this order, of the selected material,
  // not already drawn on by an earlier issuance — the "give straight to the
  // factory" path for material that was never added to shared Stock.
  const eligiblePurchases = useMemo(() => {
    if (!matchedOrder) return [];
    const alreadyUsed = new Set(db.materialIssuances.filter(i => i.source === "purchase").map(i => i.sourcePurchaseId));
    return db.purchases.filter(p =>
      p.purpose === "order" && p.orderId === matchedOrder.id && p.material === issueMaterial && !alreadyUsed.has(p.id),
    );
  }, [db.purchases, db.materialIssuances, matchedOrder, issueMaterial]);

  const resetIssueForm = () => {
    setIssueOrderNumber(""); setIssueSource("stock"); setIssuePurchaseId("");
    setIssuePurity("22K"); setIssueQuality(""); setIssueQuantity(""); setIssueNotes("");
  };

  const issueMaterialToFactory = async () => {
    const qty = Number(issueQuantity);
    if (!qty || qty <= 0) { toast.error(`Enter the ${issueMaterial} quantity to issue`); return; }
    if (!matchedOrder) { toast.error(`No order found matching "${issueOrderNumber}"`); return; }
    const purityOrQuality = issueMaterial === "gold" ? issuePurity : (issueQuality.trim() || "unspecified");
    if (issueSource === "purchase" && !issuePurchaseId) { toast.error("Choose which purchase this comes from"); return; }

    const issuanceId = uid("mi_");
    const now = new Date().toISOString();
    setIssuing(true);
    try {
      // Only draws down shared Stock when sourced FROM stock — material bought
      // specifically for this order was never added to Stock, so issuing it
      // must not touch stockLevels (see MaterialIssuance.source in db.ts).
      if (issueSource === "stock") {
        await decreaseStock({
          material: issueMaterial, purityOrQuality, quantity: qty,
          type: "issuance_out", refType: "materialIssuance", refId: issuanceId, createdBy: user!.id,
          note: `Issued to ${factory.name} for order ${matchedOrder.orderNumber}`,
        });
      }
      updateDb(d => {
        if (!d.materialIssuances) d.materialIssuances = [];
        const issuance: MaterialIssuance = {
          id: issuanceId, factoryId: id!, orderId: matchedOrder.id, material: issueMaterial,
          purityOrQuality, quantityIssued: qty,
          source: issueSource, sourcePurchaseId: issueSource === "purchase" ? issuePurchaseId : undefined,
          issuedAt: now, issuedBy: user!.id, status: "open",
          finishedPieces: [], makingCharges: { amountInr: 0, payments: [] },
          notes: issueNotes.trim() || undefined,
        };
        d.materialIssuances.unshift(issuance);
        const o = d.orders.find(o => o.id === matchedOrder.id);
        if (o) {
          if (!o.materialIssuanceIds) o.materialIssuanceIds = [];
          o.materialIssuanceIds.push(issuanceId);
          if (!o.manufacturingLog) o.manufacturingLog = [];
          o.manufacturingLog.push({
            id: uid("mlog_"), type: "material_issued", at: now, employeeId: user!.id, factoryId: id,
            material: issueMaterial, amountMaterial: qty,
            remarks: `${qty}${issueMaterial === "gold" ? "g" : "ct"} ${purityOrQuality} ${issueMaterial} issued to ${factory.name}${issueSource === "purchase" ? " (from a purchase made for this order)" : ""}`,
          });
        }
      });
      toast.success(`${qty}${issueMaterial === "gold" ? "g" : "ct"} ${purityOrQuality} ${issueMaterial} issued to ${factory.name}`);
      setShowIssueForm(false);
      resetIssueForm();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to issue material");
    } finally { setIssuing(false); }
  };

  // ── Per-issuance actions ──
  const [activeIssuance, setActiveIssuance] = useState<{ id: string; action: IssuanceAction }>({ id: "", action: null });
  const [pieceQty, setPieceQty] = useState("");
  const [pieceCount, setPieceCount] = useState("1");
  const [chargeAmount, setChargeAmount] = useState("");
  const [payAmount, setPayAmount] = useState("");
  const [payLockerId, setPayLockerId] = useState("");

  const openAction = (issuanceId: string, action: IssuanceAction) => {
    setActiveIssuance({ id: issuanceId, action });
    setPieceQty(""); setPieceCount("1"); setChargeAmount(""); setPayAmount(""); setPayLockerId("");
  };

  const recordPiece = (issuance: MaterialIssuance) => {
    const w = Number(pieceQty);
    if (!w || w <= 0) { toast.error(`Enter the ${issuance.material} quantity used`); return; }
    const now = new Date().toISOString();
    updateDb(d => {
      const mi = d.materialIssuances.find(x => x.id === issuance.id);
      if (!mi) return;
      if (!mi.finishedPieces) mi.finishedPieces = [];
      mi.finishedPieces.push({ id: uid("fp_"), quantityUsed: w, piecesCount: Number(pieceCount) || 1, recordedAt: now, recordedBy: user!.id });
      const o = d.orders.find(o => o.id === issuance.orderId);
      if (o) {
        if (!o.manufacturingLog) o.manufacturingLog = [];
        o.manufacturingLog.push({
          id: uid("mlog_"), type: "piece_finished", at: now, employeeId: user!.id, factoryId: id,
          material: issuance.material, amountMaterial: w,
          remarks: `${w}${issuance.material === "gold" ? "g" : "ct"} used in finished piece(s)`,
        });
      }
    });
    toast.success("Finished piece recorded");
    setActiveIssuance({ id: "", action: null });
  };

  const setCharge = (issuance: MaterialIssuance) => {
    const amt = Number(chargeAmount);
    if (!amt || amt <= 0) { toast.error("Enter the making charge amount"); return; }
    const now = new Date().toISOString();
    updateDb(d => {
      const mi = d.materialIssuances.find(x => x.id === issuance.id);
      if (!mi) return;
      mi.makingCharges.amountInr = amt;
      const o = d.orders.find(o => o.id === issuance.orderId);
      if (o) {
        if (!o.manufacturingLog) o.manufacturingLog = [];
        o.manufacturingLog.push({ id: uid("mlog_"), type: "making_charge_added", at: now, employeeId: user!.id, factoryId: id, amountInr: amt, remarks: `Making charge ${fmtMoneyInr(amt)} added` });
      }
    });
    toast.success("Making charge set");
    setActiveIssuance({ id: "", action: null });
  };

  const payCharge = (issuance: MaterialIssuance) => {
    const amt = Number(payAmount);
    if (!amt || amt <= 0) { toast.error("Enter a valid amount"); return; }
    if (!payLockerId) { toast.error("Choose which locker this payment came from"); return; }
    const now = new Date().toISOString();
    updateDb(d => {
      const mi = d.materialIssuances.find(x => x.id === issuance.id);
      if (!mi) return;
      if (!mi.makingCharges.payments) mi.makingCharges.payments = [];
      mi.makingCharges.payments.push({ id: uid("fpay_"), amountInr: amt, lockerId: payLockerId, recordedBy: user!.id, createdAt: now });
      if (!d.lockerTransactions) d.lockerTransactions = [];
      d.lockerTransactions.push({
        id: uid("ltx_"), lockerId: payLockerId, type: "expense", amountInr: amt,
        category: `Making Charges — ${factory.name}`, refType: "materialIssuance", refId: issuance.id,
        recordedBy: user!.id, createdAt: now,
      });
    });
    toast.success("Payment recorded");
    setActiveIssuance({ id: "", action: null });
  };

  const closeIssuance = (issuance: MaterialIssuance) => {
    updateDb(d => { const mi = d.materialIssuances.find(x => x.id === issuance.id); if (mi) mi.status = "closed"; });
    toast.success("Issuance closed");
  };

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <button onClick={() => navigate("/factories")} className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors">
        <ArrowLeft className="h-4 w-4" /> Back to Factories
      </button>

      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="card-luxe p-6">
        <div className="flex items-start gap-4 min-w-0">
          <div className="h-14 w-14 rounded-2xl bg-gradient-to-br from-orange-500/15 to-orange-400/15 grid place-items-center shrink-0">
            <FactoryIcon className="h-7 w-7 text-orange-600" />
          </div>
          <div className="min-w-0">
            <h1 className="font-display text-xl md:text-3xl text-brand-dark leading-tight break-words">{factory.name}</h1>
            <p className="text-muted-foreground mt-1 break-words">{factory.contactPerson}</p>
          </div>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mt-6 text-sm">
          <div className="flex items-start gap-2"><Phone className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" /><div><p className="text-xs text-muted-foreground">Phone</p><p className="font-medium">{factory.phone || "—"}</p></div></div>
          {factory.address && <div className="flex items-start gap-2 min-w-0"><MapPin className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" /><div className="min-w-0"><p className="text-xs text-muted-foreground">Address</p><p className="font-medium break-words">{factory.address}</p></div></div>}
        </div>
      </motion.div>

      <div className="card-luxe p-5 space-y-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-success/10 grid place-items-center shrink-0"><Wallet className="h-5 w-5 text-success" /></div>
            <div>
              <h3 className="font-display text-lg text-brand-dark">Factory Account</h3>
              <p className="text-xs text-muted-foreground">Gold in grams, diamonds in carats, charges in INR</p>
            </div>
          </div>
          <Button onClick={() => setShowIssueForm(v => !v)} className="btn-hero rounded-xl gap-2">
            <Plus className="h-4 w-4" /> Issue Material
          </Button>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <div className="p-3 rounded-xl bg-secondary text-center"><p className="text-xs text-muted-foreground mb-1">Gold Outstanding</p><p className="font-semibold text-sm">{account.goldOutstanding.toLocaleString()} g</p></div>
          <div className="p-3 rounded-xl bg-secondary text-center"><p className="text-xs text-muted-foreground mb-1">Diamond Outstanding</p><p className="font-semibold text-sm">{account.diamondOutstanding.toLocaleString()} ct</p></div>
          <div className={`p-3 rounded-xl text-center border ${account.chargesPending > 0 ? "bg-destructive/5 border-destructive/20" : "bg-success/8 border-success/20"}`}>
            <p className="text-xs text-muted-foreground mb-1">Charges Pending</p>
            <p className={`font-semibold text-sm ${account.chargesPending > 0 ? "text-destructive" : "text-success"}`}>{account.chargesPending > 0 ? fmtMoneyInr(account.chargesPending) : "✓ Cleared"}</p>
          </div>
        </div>

        {showIssueForm && (
          <div className="pt-2 border-t border-border/60 space-y-2.5">
            <p className="text-sm font-medium text-brand-dark">Issue Material</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <Input value={issueOrderNumber} onChange={e => setIssueOrderNumber(e.target.value)} className="rounded-xl h-10" placeholder="Order number" />
              <Select value={issueMaterial} onValueChange={v => { setIssueMaterial(v as "gold" | "diamond"); setIssueSource("stock"); setIssuePurchaseId(""); }}>
                <SelectTrigger className="h-10 rounded-xl"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="gold">Gold</SelectItem><SelectItem value="diamond">Diamond</SelectItem></SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <Select value={issueSource} onValueChange={v => { setIssueSource(v as "stock" | "purchase"); setIssuePurchaseId(""); }}>
                <SelectTrigger className="h-10 rounded-xl"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="stock">From Stock</SelectItem>
                  <SelectItem value="purchase" disabled={!matchedOrder || eligiblePurchases.length === 0}>
                    From a purchase made for this order {matchedOrder && eligiblePurchases.length === 0 ? "(none available)" : ""}
                  </SelectItem>
                </SelectContent>
              </Select>
              {issueSource === "purchase" ? (
                <Select value={issuePurchaseId} onValueChange={v => {
                  setIssuePurchaseId(v);
                  const p = eligiblePurchases.find(p => p.id === v);
                  if (p) {
                    if (p.material === "gold" && p.gold) { setIssuePurity(p.gold.purity); setIssueQuantity(String(p.gold.weightGrams)); }
                    if (p.material === "diamond" && p.diamond) { setIssueQuality(p.diamond.quality || ""); setIssueQuantity(String(p.diamond.carat)); }
                  }
                }}>
                  <SelectTrigger className="h-10 rounded-xl"><SelectValue placeholder="Choose purchase" /></SelectTrigger>
                  <SelectContent>
                    {eligiblePurchases.map(p => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.material === "gold" ? `${p.gold?.weightGrams}g ${p.gold?.purity}` : `${p.diamond?.carat}ct ${p.diamond?.quality || ""}`} — {fmtMoneyInr(p.totalInr)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : issueMaterial === "gold" ? (
                <Select value={issuePurity} onValueChange={setIssuePurity}>
                  <SelectTrigger className="h-10 rounded-xl"><SelectValue /></SelectTrigger>
                  <SelectContent>{GOLD_PURITIES.map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}</SelectContent>
                </Select>
              ) : (
                <Input value={issueQuality} onChange={e => setIssueQuality(e.target.value)} className="rounded-xl h-10" placeholder="Quality (optional)" />
              )}
            </div>

            <Input
              type="number" min={0} value={issueQuantity} onChange={e => setIssueQuantity(e.target.value)}
              className="rounded-xl h-10" placeholder={issueMaterial === "gold" ? "Weight (g)" : "Carat"}
              disabled={issueSource === "purchase" && !!issuePurchaseId}
            />
            <Input value={issueNotes} onChange={e => setIssueNotes(e.target.value)} className="rounded-xl h-10" placeholder="Notes (optional)" />

            <div className="flex gap-2.5">
              <AsyncButton onClick={issueMaterialToFactory} disabled={issuing} className="btn-hero rounded-xl h-10">{issuing ? "Issuing…" : "Issue Material"}</AsyncButton>
              <Button variant="outline" onClick={() => { setShowIssueForm(false); resetIssueForm(); }} className="rounded-xl h-10">Cancel</Button>
            </div>
          </div>
        )}
      </div>

      <div className="space-y-3">
        <h2 className="font-display text-xl text-brand-dark px-1">Material Issuances</h2>
        {issuances.map(mi => {
          const order = db.orders.find(o => o.id === mi.orderId);
          const used = issuanceUsed(mi);
          const wastage = issuanceWastage(mi);
          const pending = issuancePending(mi);
          const isActive = activeIssuance.id === mi.id;
          const unit = mi.material === "gold" ? "g" : "ct";

          return (
            <div key={mi.id} className="card-luxe p-4">
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div>
                  <p className="font-semibold text-sm">
                    {order ? <Link to={`/orders/${order.id}`} className="text-primary hover:underline">{order.orderNumber}</Link> : "Unknown order"}
                    <span className="ml-2 text-xs font-medium px-2 py-0.5 rounded-full bg-secondary text-muted-foreground">{mi.status === "open" ? "In progress" : "Closed"}</span>
                    {mi.source === "purchase" && <span className="ml-1.5 text-xs font-medium px-2 py-0.5 rounded-full bg-primary/10 text-primary">Direct purchase</span>}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
                    {mi.material === "gold" ? <Coins className="h-3 w-3" /> : <Gem className="h-3 w-3" />}
                    {mi.quantityIssued}{unit} {mi.purityOrQuality} issued {fmtDate(mi.issuedAt)} · {used}{unit} used
                    {mi.status === "closed" && wastage !== 0 ? ` · ${wastage}${unit} wastage` : ""}
                  </p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-sm font-semibold">{mi.makingCharges.amountInr > 0 ? fmtMoneyInr(mi.makingCharges.amountInr) : "No charge set"}</p>
                  {mi.makingCharges.amountInr > 0 && (
                    <p className={`text-xs font-medium ${pending > 0 ? "text-destructive" : "text-success"}`}>{pending > 0 ? `${fmtMoneyInr(pending)} pending` : "Paid"}</p>
                  )}
                </div>
              </div>

              <div className="flex flex-wrap gap-2 mt-3">
                <Button size="sm" variant="outline" onClick={() => openAction(mi.id, "piece")} className="rounded-lg gap-1.5"><CheckCircle2 className="h-3.5 w-3.5" />Finished Piece</Button>
                <Button size="sm" variant="outline" onClick={() => openAction(mi.id, "charge")} className="rounded-lg gap-1.5"><Coins className="h-3.5 w-3.5" />Set Charge</Button>
                {mi.makingCharges.amountInr > 0 && pending > 0 && (
                  <Button size="sm" variant="outline" onClick={() => openAction(mi.id, "pay")} className="rounded-lg gap-1.5"><CreditCard className="h-3.5 w-3.5" />Pay</Button>
                )}
                {mi.status === "open" && (
                  <AsyncButton size="sm" variant="outline" onClick={() => closeIssuance(mi)} className="rounded-lg">Close Issuance</AsyncButton>
                )}
              </div>

              {isActive && activeIssuance.action === "piece" && (
                <div className="mt-3 pt-3 border-t border-border/60 grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                  <Input type="number" min={0} value={pieceQty} onChange={e => setPieceQty(e.target.value)} className="rounded-xl h-9" placeholder={`${mi.material === "gold" ? "Gold" : "Diamond"} used (${unit})`} />
                  <Input type="number" min={1} value={pieceCount} onChange={e => setPieceCount(e.target.value)} className="rounded-xl h-9" placeholder="Pieces count" />
                  <div className="flex gap-2">
                    <AsyncButton onClick={() => recordPiece(mi)} className="btn-hero rounded-xl h-9 flex-1">Save</AsyncButton>
                    <Button variant="outline" onClick={() => setActiveIssuance({ id: "", action: null })} className="rounded-xl h-9">Cancel</Button>
                  </div>
                </div>
              )}
              {isActive && activeIssuance.action === "charge" && (
                <div className="mt-3 pt-3 border-t border-border/60 grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <Input type="number" min={0} value={chargeAmount} onChange={e => setChargeAmount(e.target.value)} className="rounded-xl h-9" placeholder="Making charge (₹)" />
                  <div className="flex gap-2">
                    <AsyncButton onClick={() => setCharge(mi)} className="btn-hero rounded-xl h-9 flex-1">Save</AsyncButton>
                    <Button variant="outline" onClick={() => setActiveIssuance({ id: "", action: null })} className="rounded-xl h-9">Cancel</Button>
                  </div>
                </div>
              )}
              {isActive && activeIssuance.action === "pay" && (
                <div className="mt-3 pt-3 border-t border-border/60 grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                  <Input type="number" min={1} value={payAmount} onChange={e => setPayAmount(e.target.value)} className="rounded-xl h-9" placeholder="Amount (₹)" />
                  <Select value={payLockerId} onValueChange={setPayLockerId}>
                    <SelectTrigger className="h-9 rounded-xl"><SelectValue placeholder="From which locker?" /></SelectTrigger>
                    <SelectContent>{db.lockers.filter(l => l.active !== false).map(l => <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>)}</SelectContent>
                  </Select>
                  <div className="flex gap-2">
                    <AsyncButton onClick={() => payCharge(mi)} className="btn-hero rounded-xl h-9 flex-1">Save</AsyncButton>
                    <Button variant="outline" onClick={() => setActiveIssuance({ id: "", action: null })} className="rounded-xl h-9">Cancel</Button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
        {issuances.length === 0 && <div className="card-luxe p-12 text-center text-muted-foreground">No material issuances yet.</div>}
      </div>
    </div>
  );
}
