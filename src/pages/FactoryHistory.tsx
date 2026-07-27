import { useState } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { updateDb, uid, fmtDate, type GoldIssuance } from "@/lib/db";
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
  ArrowLeft, Factory as FactoryIcon, Phone, MapPin, Wallet, Plus, CreditCard, CheckCircle2, Coins,
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

  const issuances = db.goldIssuances
    .filter(i => i.factoryId === id)
    .sort((a, b) => +new Date(b.issuedAt) - +new Date(a.issuedAt));
  const account = factoryAccount(issuances);

  // ── Issue gold ──
  const [showIssueForm, setShowIssueForm] = useState(false);
  const [issueOrderNumber, setIssueOrderNumber] = useState("");
  const [issuePurity, setIssuePurity] = useState("22K");
  const [issueWeight, setIssueWeight] = useState("");
  const [issueNotes, setIssueNotes] = useState("");
  const [issuing, setIssuing] = useState(false);

  const issueGold = async () => {
    const weight = Number(issueWeight);
    if (!weight || weight <= 0) { toast.error("Enter the gold weight to issue"); return; }
    const order = db.orders.find(o => o.orderNumber.trim().toLowerCase() === issueOrderNumber.trim().toLowerCase());
    if (!order) { toast.error(`No order found matching "${issueOrderNumber}"`); return; }

    const issuanceId = uid("gi_");
    const now = new Date().toISOString();
    setIssuing(true);
    try {
      // Transactional stock deduct FIRST — throws if insufficient, before any
      // issuance/order record is written, so nothing gets recorded that the
      // stock couldn't actually back.
      await decreaseStock({
        material: "gold", purityOrQuality: issuePurity, quantity: weight,
        type: "issuance_out", refType: "goldIssuance", refId: issuanceId, createdBy: user!.id,
        note: `Issued to ${factory.name} for order ${order.orderNumber}`,
      });
      updateDb(d => {
        if (!d.goldIssuances) d.goldIssuances = [];
        const issuance: GoldIssuance = {
          id: issuanceId, factoryId: id!, orderId: order.id, purity: issuePurity,
          weightIssuedGrams: weight, issuedAt: now, issuedBy: user!.id, status: "open",
          finishedPieces: [], makingCharges: { amountInr: 0, payments: [] },
          notes: issueNotes.trim() || undefined,
        };
        d.goldIssuances.unshift(issuance);
        const o = d.orders.find(o => o.id === order.id);
        if (o) {
          if (!o.goldIssuanceIds) o.goldIssuanceIds = [];
          o.goldIssuanceIds.push(issuanceId);
          if (!o.manufacturingLog) o.manufacturingLog = [];
          o.manufacturingLog.push({
            id: uid("mlog_"), type: "gold_issued", at: now, employeeId: user!.id, factoryId: id,
            amountGold: weight, remarks: `${weight}g ${issuePurity} gold issued to ${factory.name}`,
          });
        }
      });
      toast.success(`${weight}g ${issuePurity} gold issued to ${factory.name}`);
      setShowIssueForm(false);
      setIssueOrderNumber(""); setIssueWeight(""); setIssueNotes("");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to issue gold");
    } finally { setIssuing(false); }
  };

  // ── Per-issuance actions ──
  const [activeIssuance, setActiveIssuance] = useState<{ id: string; action: IssuanceAction }>({ id: "", action: null });
  const [pieceWeight, setPieceWeight] = useState("");
  const [pieceCount, setPieceCount] = useState("1");
  const [chargeAmount, setChargeAmount] = useState("");
  const [payAmount, setPayAmount] = useState("");
  const [payLockerId, setPayLockerId] = useState("");

  const openAction = (issuanceId: string, action: IssuanceAction) => {
    setActiveIssuance({ id: issuanceId, action });
    setPieceWeight(""); setPieceCount("1"); setChargeAmount(""); setPayAmount(""); setPayLockerId("");
  };

  const recordPiece = (issuance: GoldIssuance) => {
    const w = Number(pieceWeight);
    if (!w || w <= 0) { toast.error("Enter the gold weight used"); return; }
    const now = new Date().toISOString();
    updateDb(d => {
      const gi = d.goldIssuances.find(x => x.id === issuance.id);
      if (!gi) return;
      if (!gi.finishedPieces) gi.finishedPieces = [];
      gi.finishedPieces.push({ id: uid("fp_"), weightUsedGrams: w, piecesCount: Number(pieceCount) || 1, recordedAt: now, recordedBy: user!.id });
      const o = d.orders.find(o => o.id === issuance.orderId);
      if (o) {
        if (!o.manufacturingLog) o.manufacturingLog = [];
        o.manufacturingLog.push({ id: uid("mlog_"), type: "piece_finished", at: now, employeeId: user!.id, factoryId: id, amountGold: w, remarks: `${w}g used in finished piece(s)` });
      }
    });
    toast.success("Finished piece recorded");
    setActiveIssuance({ id: "", action: null });
  };

  const setCharge = (issuance: GoldIssuance) => {
    const amt = Number(chargeAmount);
    if (!amt || amt <= 0) { toast.error("Enter the making charge amount"); return; }
    const now = new Date().toISOString();
    updateDb(d => {
      const gi = d.goldIssuances.find(x => x.id === issuance.id);
      if (!gi) return;
      gi.makingCharges.amountInr = amt;
      const o = d.orders.find(o => o.id === issuance.orderId);
      if (o) {
        if (!o.manufacturingLog) o.manufacturingLog = [];
        o.manufacturingLog.push({ id: uid("mlog_"), type: "making_charge_added", at: now, employeeId: user!.id, factoryId: id, amountInr: amt, remarks: `Making charge ${fmtMoneyInr(amt)} added` });
      }
    });
    toast.success("Making charge set");
    setActiveIssuance({ id: "", action: null });
  };

  const payCharge = (issuance: GoldIssuance) => {
    const amt = Number(payAmount);
    if (!amt || amt <= 0) { toast.error("Enter a valid amount"); return; }
    if (!payLockerId) { toast.error("Choose which locker this payment came from"); return; }
    const now = new Date().toISOString();
    updateDb(d => {
      const gi = d.goldIssuances.find(x => x.id === issuance.id);
      if (!gi) return;
      if (!gi.makingCharges.payments) gi.makingCharges.payments = [];
      gi.makingCharges.payments.push({ id: uid("fpay_"), amountInr: amt, lockerId: payLockerId, recordedBy: user!.id, createdAt: now });
      if (!d.lockerTransactions) d.lockerTransactions = [];
      d.lockerTransactions.push({
        id: uid("ltx_"), lockerId: payLockerId, type: "expense", amountInr: amt,
        category: `Making Charges — ${factory.name}`, refType: "goldIssuance", refId: issuance.id,
        recordedBy: user!.id, createdAt: now,
      });
    });
    toast.success("Payment recorded");
    setActiveIssuance({ id: "", action: null });
  };

  const closeIssuance = (issuance: GoldIssuance) => {
    updateDb(d => { const gi = d.goldIssuances.find(x => x.id === issuance.id); if (gi) gi.status = "closed"; });
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
              <p className="text-xs text-muted-foreground">Gold in grams, charges in INR</p>
            </div>
          </div>
          <Button onClick={() => setShowIssueForm(v => !v)} className="btn-hero rounded-xl gap-2">
            <Plus className="h-4 w-4" /> Issue Gold
          </Button>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="p-3 rounded-xl bg-secondary text-center"><p className="text-xs text-muted-foreground mb-1">Gold Issued</p><p className="font-semibold text-sm">{account.goldIssued.toLocaleString()} g</p></div>
          <div className="p-3 rounded-xl bg-secondary text-center"><p className="text-xs text-muted-foreground mb-1">Gold Used</p><p className="font-semibold text-sm">{account.goldUsed.toLocaleString()} g</p></div>
          <div className="p-3 rounded-xl bg-primary/5 border border-primary/20 text-center"><p className="text-xs text-muted-foreground mb-1">Gold Outstanding</p><p className="font-semibold text-sm text-primary">{account.goldOutstanding.toLocaleString()} g</p></div>
          <div className={`p-3 rounded-xl text-center border ${account.chargesPending > 0 ? "bg-destructive/5 border-destructive/20" : "bg-success/8 border-success/20"}`}>
            <p className="text-xs text-muted-foreground mb-1">Charges Pending</p>
            <p className={`font-semibold text-sm ${account.chargesPending > 0 ? "text-destructive" : "text-success"}`}>{account.chargesPending > 0 ? fmtMoneyInr(account.chargesPending) : "✓ Cleared"}</p>
          </div>
        </div>

        {showIssueForm && (
          <div className="pt-2 border-t border-border/60 space-y-2.5">
            <p className="text-sm font-medium text-brand-dark">Issue Gold</p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
              <Input value={issueOrderNumber} onChange={e => setIssueOrderNumber(e.target.value)} className="rounded-xl h-10" placeholder="Order number" />
              <Select value={issuePurity} onValueChange={setIssuePurity}>
                <SelectTrigger className="h-10 rounded-xl"><SelectValue /></SelectTrigger>
                <SelectContent>{GOLD_PURITIES.map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}</SelectContent>
              </Select>
              <Input type="number" min={0} value={issueWeight} onChange={e => setIssueWeight(e.target.value)} className="rounded-xl h-10" placeholder="Weight (g)" />
            </div>
            <Input value={issueNotes} onChange={e => setIssueNotes(e.target.value)} className="rounded-xl h-10" placeholder="Notes (optional)" />
            <div className="flex gap-2.5">
              <AsyncButton onClick={issueGold} disabled={issuing} className="btn-hero rounded-xl h-10">{issuing ? "Issuing…" : "Issue Gold"}</AsyncButton>
              <Button variant="outline" onClick={() => setShowIssueForm(false)} className="rounded-xl h-10">Cancel</Button>
            </div>
          </div>
        )}
      </div>

      <div className="space-y-3">
        <h2 className="font-display text-xl text-brand-dark px-1">Gold Issuances</h2>
        {issuances.map(gi => {
          const order = db.orders.find(o => o.id === gi.orderId);
          const used = issuanceUsed(gi);
          const wastage = issuanceWastage(gi);
          const paid = issuancePaid(gi);
          const pending = issuancePending(gi);
          const isActive = activeIssuance.id === gi.id;

          return (
            <div key={gi.id} className="card-luxe p-4">
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div>
                  <p className="font-semibold text-sm">
                    {order ? <Link to={`/orders/${order.id}`} className="text-primary hover:underline">{order.orderNumber}</Link> : "Unknown order"}
                    <span className="ml-2 text-xs font-medium px-2 py-0.5 rounded-full bg-secondary text-muted-foreground">{gi.status === "open" ? "In progress" : "Closed"}</span>
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {gi.weightIssuedGrams}g {gi.purity} issued {fmtDate(gi.issuedAt)} · {used}g used
                    {gi.status === "closed" && wastage !== 0 ? ` · ${wastage}g wastage` : ""}
                  </p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-sm font-semibold">{gi.makingCharges.amountInr > 0 ? fmtMoneyInr(gi.makingCharges.amountInr) : "No charge set"}</p>
                  {gi.makingCharges.amountInr > 0 && (
                    <p className={`text-xs font-medium ${pending > 0 ? "text-destructive" : "text-success"}`}>{pending > 0 ? `${fmtMoneyInr(pending)} pending` : "Paid"}</p>
                  )}
                </div>
              </div>

              <div className="flex flex-wrap gap-2 mt-3">
                <Button size="sm" variant="outline" onClick={() => openAction(gi.id, "piece")} className="rounded-lg gap-1.5"><CheckCircle2 className="h-3.5 w-3.5" />Finished Piece</Button>
                <Button size="sm" variant="outline" onClick={() => openAction(gi.id, "charge")} className="rounded-lg gap-1.5"><Coins className="h-3.5 w-3.5" />Set Charge</Button>
                {gi.makingCharges.amountInr > 0 && pending > 0 && (
                  <Button size="sm" variant="outline" onClick={() => openAction(gi.id, "pay")} className="rounded-lg gap-1.5"><CreditCard className="h-3.5 w-3.5" />Pay</Button>
                )}
                {gi.status === "open" && (
                  <AsyncButton size="sm" variant="outline" onClick={() => closeIssuance(gi)} className="rounded-lg">Close Issuance</AsyncButton>
                )}
              </div>

              {isActive && activeIssuance.action === "piece" && (
                <div className="mt-3 pt-3 border-t border-border/60 grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                  <Input type="number" min={0} value={pieceWeight} onChange={e => setPieceWeight(e.target.value)} className="rounded-xl h-9" placeholder="Gold used (g)" />
                  <Input type="number" min={1} value={pieceCount} onChange={e => setPieceCount(e.target.value)} className="rounded-xl h-9" placeholder="Pieces count" />
                  <div className="flex gap-2">
                    <AsyncButton onClick={() => recordPiece(gi)} className="btn-hero rounded-xl h-9 flex-1">Save</AsyncButton>
                    <Button variant="outline" onClick={() => setActiveIssuance({ id: "", action: null })} className="rounded-xl h-9">Cancel</Button>
                  </div>
                </div>
              )}
              {isActive && activeIssuance.action === "charge" && (
                <div className="mt-3 pt-3 border-t border-border/60 grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <Input type="number" min={0} value={chargeAmount} onChange={e => setChargeAmount(e.target.value)} className="rounded-xl h-9" placeholder="Making charge (₹)" />
                  <div className="flex gap-2">
                    <AsyncButton onClick={() => setCharge(gi)} className="btn-hero rounded-xl h-9 flex-1">Save</AsyncButton>
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
                    <AsyncButton onClick={() => payCharge(gi)} className="btn-hero rounded-xl h-9 flex-1">Save</AsyncButton>
                    <Button variant="outline" onClick={() => setActiveIssuance({ id: "", action: null })} className="rounded-xl h-9">Cancel</Button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
        {issuances.length === 0 && <div className="card-luxe p-12 text-center text-muted-foreground">No gold issuances yet.</div>}
      </div>
    </div>
  );
}
