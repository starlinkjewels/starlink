import { useMemo, useState } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { updateDb, uid, fmtDate, DIAMOND_SHAPES, type MaterialIssuance } from "@/lib/db";
import { useDb } from "@/hooks/useDb";
import { useAuth } from "@/lib/auth";
import {
  factoryAccount, issuancePaid, issuancePending, issuanceUsed, issuanceWastage, fmtMoneyInr,
  factoryPoolBalance, estimatedPureGoldNeeded, orderMaterialRequirements,
} from "@/lib/manufacturing";
import { decreaseStock, increaseStock } from "@/lib/stock";
import { Button } from "@/components/ui/button";
import { AsyncButton } from "@/components/AsyncButton";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  ArrowLeft, Factory as FactoryIcon, Phone, MapPin, Wallet, Plus, CreditCard, CheckCircle2, Coins, Gem,
  Download, FileText, FileSpreadsheet, Undo2, AlertCircle, Truck,
} from "lucide-react";
import { motion } from "framer-motion";
import { toast } from "sonner";
import { downloadCsv, downloadLedgerPdf, fmtInrPlain } from "@/lib/ledgerExport";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const GOLD_PURITIES = ["9K", "14K", "18K", "22K", "24K"];

type IssuanceAction = "piece" | "charge" | "pay" | "return" | null;

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
  // "bulkDelivery" = hand the factory raw material not tied to any order yet
  // (builds up its pool); "orderConsumption" = today's flow, earmarked to one
  // order, now also able to draw from that pool instead of a new delivery.
  const [showIssueForm, setShowIssueForm] = useState(false);
  const [issueMode, setIssueMode] = useState<"bulkDelivery" | "orderConsumption">("orderConsumption");
  const [issueOrderNumber, setIssueOrderNumber] = useState("");
  const [issueMaterial, setIssueMaterial] = useState<"gold" | "diamond">("gold");
  const [issuePurity, setIssuePurity] = useState("22K");
  const [issueQuality, setIssueQuality] = useState("Round");
  const [issueQuantity, setIssueQuantity] = useState("");
  const [issueChargeAmount, setIssueChargeAmount] = useState("");
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
    setIssueOrderNumber("");
    setIssuePurity("22K"); setIssueQuality("Round"); setIssueQuantity(""); setIssueChargeAmount(""); setIssueNotes("");
  };

  const issueMaterialToFactory = async () => {
    const qty = Number(issueQuantity);
    if (!qty || qty <= 0) { toast.error(`Enter the ${issueMaterial} quantity to issue`); return; }
    const purityOrQuality = issueMaterial === "gold" ? issuePurity : (issueQuality.trim() || "unspecified");
    const issuanceId = uid("mi_");
    const now = new Date().toISOString();

    // Bulk delivery — hand the factory raw material, not tied to any order.
    // Always physically leaves shared Stock (there's nothing else it could
    // come from at this stage — no order to attach a Purchase to yet).
    if (issueMode === "bulkDelivery") {
      setIssuing(true);
      try {
        await decreaseStock({
          material: issueMaterial, purityOrQuality, quantity: qty,
          type: "issuance_out", refType: "materialIssuance", refId: issuanceId, createdBy: user!.id,
          note: `Bulk delivery to ${factory.name}`,
        });
        updateDb(d => {
          if (!d.materialIssuances) d.materialIssuances = [];
          d.materialIssuances.unshift({
            id: issuanceId, factoryId: id!, orderId: undefined, material: issueMaterial,
            purityOrQuality, quantityIssued: qty, source: "stock",
            issuedAt: now, issuedBy: user!.id, status: "open",
            finishedPieces: [], makingCharges: { amountInr: 0, payments: [] },
            notes: issueNotes.trim() || undefined,
          });
        });
        toast.success(`${qty}${issueMaterial === "gold" ? "g" : "ct"} ${purityOrQuality} ${issueMaterial} delivered to ${factory.name}'s pool`);
        setShowIssueForm(false);
        resetIssueForm();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Failed to record delivery");
      } finally { setIssuing(false); }
      return;
    }

    // Order Consumption — records usage + making charge for one specific
    // order in a single save. Where the material physically comes from is
    // resolved automatically: this factory's own pool first, then a purchase
    // bought specifically for this order, then shared company stock.
    if (!matchedOrder) { toast.error(`No order found matching "${issueOrderNumber}"`); return; }
    const chargeAmount = Number(issueChargeAmount) || 0;
    const poolBalance = factoryPoolBalance(db.materialIssuances, id!, issueMaterial, purityOrQuality);
    const eligiblePurchase = eligiblePurchases[0];
    const resolvedSource: "factoryPool" | "purchase" | "stock" =
      poolBalance >= qty ? "factoryPool" : eligiblePurchase ? "purchase" : "stock";

    setIssuing(true);
    try {
      // Only draws down shared Stock when sourced FROM stock — material bought
      // specifically for this order, or drawn from this factory's own pool,
      // never touches stockLevels (see MaterialIssuance.source in db.ts).
      if (resolvedSource === "stock") {
        await decreaseStock({
          material: issueMaterial, purityOrQuality, quantity: qty,
          type: "issuance_out", refType: "materialIssuance", refId: issuanceId, createdBy: user!.id,
          note: `Used by ${factory.name} for order ${matchedOrder.orderNumber}`,
        });
      }
      updateDb(d => {
        if (!d.materialIssuances) d.materialIssuances = [];
        const issuance: MaterialIssuance = {
          id: issuanceId, factoryId: id!, orderId: matchedOrder.id, material: issueMaterial,
          purityOrQuality, quantityIssued: qty,
          source: resolvedSource, sourcePurchaseId: resolvedSource === "purchase" ? eligiblePurchase!.id : undefined,
          issuedAt: now, issuedBy: user!.id, status: "open",
          finishedPieces: [{ id: uid("fp_"), quantityUsed: qty, piecesCount: 1, recordedAt: now, recordedBy: user!.id }],
          makingCharges: { amountInr: chargeAmount, payments: [] },
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
            material: issueMaterial, amountMaterial: qty, amountInr: chargeAmount || undefined,
            remarks: `${qty}${issueMaterial === "gold" ? "g" : "ct"} ${purityOrQuality} ${issueMaterial} used at ${factory.name}${chargeAmount ? ` — making charge ${fmtMoneyInr(chargeAmount)}` : ""}`,
          });
        }
      });
      toast.success(`Recorded ${qty}${issueMaterial === "gold" ? "g" : "ct"} ${purityOrQuality} used${chargeAmount ? ` — ${fmtMoneyInr(chargeAmount)} charge` : ""}`);
      setShowIssueForm(false);
      resetIssueForm();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to save");
    } finally { setIssuing(false); }
  };

  // ── Per-issuance actions ──
  const [activeIssuance, setActiveIssuance] = useState<{ id: string; action: IssuanceAction }>({ id: "", action: null });
  const [pieceQty, setPieceQty] = useState("");
  const [pieceCount, setPieceCount] = useState("1");
  const [chargeAmount, setChargeAmount] = useState("");
  const [payAmount, setPayAmount] = useState("");
  const [payLockerId, setPayLockerId] = useState("");
  const [returnQty, setReturnQty] = useState("");
  const [returnNote, setReturnNote] = useState("");
  const [returning, setReturning] = useState(false);

  const openAction = (issuanceId: string, action: IssuanceAction) => {
    setActiveIssuance({ id: issuanceId, action });
    setPieceQty(""); setPieceCount("1"); setChargeAmount(""); setPayAmount(""); setPayLockerId("");
    setReturnQty(""); setReturnNote("");
  };

  const recordPiece = (issuance: MaterialIssuance) => {
    const w = Number(pieceQty);
    if (!w || w <= 0) { toast.error(`Enter the ${issuance.material} quantity used`); return; }
    const u = issuance.material === "gold" ? "g" : "ct";
    const alreadyUsed = issuanceUsed(issuance);
    if (alreadyUsed + w > issuance.quantityIssued + 0.001) {
      toast.error(`Can't use more than issued — issued ${issuance.quantityIssued}${u}, already used ${alreadyUsed}${u}.`);
      return;
    }
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

  // Diamond replaced / gold under- or over-used — return the unused portion
  // straight to Stock so it's available for the next order (matches "manage
  // from our stock"), instead of an issuance's leftover just vanishing.
  const returnMaterial = async (issuance: MaterialIssuance) => {
    // Certified packets aren't a pooled carat total — "returning" puts the exact
    // stones back into stock (never touches the loose-by-shape pool).
    if (issuance.diamondKind === "certified") {
      const now = new Date().toISOString();
      const ids = issuance.diamondPacketIds || [];
      setReturning(true);
      try {
        updateDb(d => {
          for (const p of d.diamondPackets) if (ids.includes(p.id)) { p.status = "in_stock"; p.orderId = undefined; }
          d.materialIssuances = d.materialIssuances.filter(x => x.id !== issuance.id);
          const o = d.orders.find(o => o.id === issuance.orderId);
          if (o) {
            o.materialIssuanceIds = (o.materialIssuanceIds || []).filter(x => x !== issuance.id);
            if (!o.manufacturingLog) o.manufacturingLog = [];
            o.manufacturingLog.push({
              id: uid("mlog_"), type: "material_returned", at: now, employeeId: user!.id, factoryId: id,
              material: "diamond", amountMaterial: issuance.quantityIssued,
              remarks: `${ids.length} certified diamond${ids.length !== 1 ? "s" : ""} returned to stock from ${factory.name}`,
            });
          }
        });
        toast.success("Certified packets returned to stock");
        setActiveIssuance({ id: "", action: null });
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Failed to return packets");
      } finally { setReturning(false); }
      return;
    }

    const qty = Number(returnQty);
    const unit = issuance.material === "gold" ? "g" : "ct";
    const maxReturnable = Math.round((issuance.quantityIssued - issuanceUsed(issuance)) * 100) / 100;
    if (!qty || qty <= 0) { toast.error(`Enter the ${issuance.material} quantity to return`); return; }
    if (qty > maxReturnable) { toast.error(`Can't return more than the unused remainder (${maxReturnable}${unit})`); return; }
    const now = new Date().toISOString();
    setReturning(true);
    try {
      // Only material that CAME from stock goes back to stock. A purchase bought
      // for this order never entered stock, so returning it must not inflate the pool.
      if (issuance.source === "stock") {
        await increaseStock({
          material: issuance.material, purityOrQuality: issuance.purityOrQuality, quantity: qty,
          refType: "manual", createdBy: user!.id,
          note: `Returned from ${factory.name} issuance${returnNote.trim() ? ` — ${returnNote.trim()}` : ""}`,
        });
      }
      updateDb(d => {
        const mi = d.materialIssuances.find(x => x.id === issuance.id);
        if (!mi) return;
        mi.quantityIssued = Math.round((mi.quantityIssued - qty) * 100) / 100;
        const o = d.orders.find(o => o.id === issuance.orderId);
        if (o) {
          if (!o.manufacturingLog) o.manufacturingLog = [];
          o.manufacturingLog.push({
            id: uid("mlog_"), type: "material_returned", at: now, employeeId: user!.id, factoryId: id,
            material: issuance.material, amountMaterial: qty,
            remarks: `${qty}${unit} ${issuance.material} returned from ${factory.name}${returnNote.trim() ? ` — ${returnNote.trim()}` : ""}`,
          });
        }
      });
      toast.success(issuance.source === "stock" ? `${qty}${unit} returned to stock` : `${qty}${unit} returned (was bought for this order — not added to stock)`);
      setActiveIssuance({ id: "", action: null });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to return material");
    } finally { setReturning(false); }
  };

  // Any unused material still sitting against an issuance being closed goes
  // back to Stock automatically — nothing is silently lost to "wastage" that
  // was actually just never consumed.
  const closeIssuance = async (issuance: MaterialIssuance) => {
    const leftover = Math.round(issuanceWastage(issuance) * 100) / 100;
    const unit = issuance.material === "gold" ? "g" : "ct";
    const now = new Date().toISOString();
    try {
      // Only stock-sourced, non-certified leftovers return to shared Stock.
      // Certified packets are discrete; purchase-sourced material was never
      // in stock. A factoryPool draw has nothing to return to Stock either —
      // shrinking its quantityIssued below (releasesToPool) gives the leftover
      // straight back to the factory's own pool instead.
      const returnsToStock = leftover > 0 && issuance.diamondKind !== "certified" && issuance.source === "stock";
      const releasesToPool = leftover > 0 && issuance.source === "factoryPool";
      if (returnsToStock) {
        await increaseStock({
          material: issuance.material, purityOrQuality: issuance.purityOrQuality, quantity: leftover,
          refType: "manual", createdBy: user!.id,
          note: `Unused material returned on closing issuance for ${factory.name}`,
        });
      }
      updateDb(d => {
        const mi = d.materialIssuances.find(x => x.id === issuance.id);
        if (mi) {
          mi.status = "closed";
          // Whether the leftover went back to shared Stock or back to the
          // factory's own pool, it's no longer "at this factory" — shrink
          // quantityIssued either way, or factoryPoolBalance would keep
          // counting a bulk delivery's full amount as still delivered even
          // after it was fully returned.
          if (returnsToStock || releasesToPool) mi.quantityIssued = Math.round((mi.quantityIssued - leftover) * 100) / 100;
        }
        // Certified stones are now consumed into the finished piece → mark used.
        if (issuance.diamondKind === "certified" && issuance.diamondPacketIds) {
          for (const p of d.diamondPackets) if (issuance.diamondPacketIds.includes(p.id)) p.status = "used";
        }
        if (returnsToStock || releasesToPool) {
          const o = d.orders.find(o => o.id === issuance.orderId);
          if (o) {
            if (!o.manufacturingLog) o.manufacturingLog = [];
            o.manufacturingLog.push({
              id: uid("mlog_"), type: "material_returned", at: now, employeeId: user!.id, factoryId: id,
              material: issuance.material, amountMaterial: leftover,
              remarks: `${leftover}${unit} unused ${issuance.material} returned ${returnsToStock ? "to stock" : "to the factory's pool"} on closing issuance`,
            });
          }
        }
      });
      toast.success(
        returnsToStock ? `Issuance closed — ${leftover}${unit} returned to stock`
        : releasesToPool ? `Issuance closed — ${leftover}${unit} released back to the factory's pool`
        : "Issuance closed",
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to close issuance");
    }
  };

  // Full account statement — making charges (owed) and payments (paid) across
  // all issuances, chronological, with a running balance — the money ledger,
  // separate from the material (gold/diamond quantity) tracking above.
  const statement = (() => {
    const rows: { id: string; date: string; particulars: string; debit: number; credit: number }[] = [];
    for (const mi of issuances) {
      const order = db.orders.find(o => o.id === mi.orderId);
      const unit = mi.material === "gold" ? "g" : "ct";
      if (mi.makingCharges.amountInr > 0) {
        rows.push({
          id: mi.id, date: mi.issuedAt,
          particulars: `Making Charges — ${mi.quantityIssued}${unit} ${mi.purityOrQuality} (${order?.orderNumber || "order"})`,
          debit: mi.makingCharges.amountInr, credit: 0,
        });
      }
      for (const pay of mi.makingCharges.payments || []) {
        rows.push({ id: pay.id, date: pay.createdAt, particulars: `Payment${pay.note ? ` — ${pay.note}` : ""}`, debit: 0, credit: pay.amountInr });
      }
    }
    let running = 0;
    const withBalance = [...rows]
      .sort((a, b) => +new Date(a.date) - +new Date(b.date))
      .map(r => { running += r.debit - r.credit; return { ...r, balance: running }; });
    return withBalance.reverse();
  })();

  const exportCsv = () => {
    downloadCsv(
      `Factory-${factory.name.replace(/\s+/g, "_")}`,
      ["Date", "Particulars", "Charged (INR)", "Paid (INR)", "Balance (INR)"],
      statement.map(r => [fmtDate(r.date), r.particulars, r.debit || "", r.credit || "", r.balance]),
    );
  };

  const exportPdf = () => {
    downloadLedgerPdf({
      title: "Factory Account Statement",
      subjectLines: [
        `Factory: ${factory.name}`,
        factory.contactPerson ? `Contact: ${factory.contactPerson}` : "",
        `Report Generated: ${new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}`,
      ].filter(Boolean),
      summary: [
        { label: "Gold Outstanding", value: `${account.goldOutstanding.toLocaleString()} g` },
        { label: "Diamond Outstanding", value: `${account.diamondOutstanding.toLocaleString()} ct` },
        { label: "Charges Total", value: fmtInrPlain(account.chargesTotal) },
        { label: "Charges Paid", value: fmtInrPlain(account.chargesPaid) },
        { label: "Charges Pending", value: fmtInrPlain(account.chargesPending) },
        { label: "Charges Overpaid", value: fmtInrPlain(account.chargesOverpaid) },
      ],
      columns: [
        { header: "Date", x: 20 },
        { header: "Particulars", x: 50 },
        { header: "Charged", x: 122 },
        { header: "Paid", x: 148 },
        { header: "Balance", x: 170 },
      ],
      rows: statement.map(r => [
        fmtDate(r.date), r.particulars.slice(0, 28),
        r.debit ? fmtInrPlain(r.debit).replace("Rs. ", "") : "—",
        r.credit ? fmtInrPlain(r.credit).replace("Rs. ", "") : "—",
        fmtInrPlain(r.balance).replace("Rs. ", ""),
      ]),
      filename: `Factory-${factory.name.replace(/\s+/g, "_")}`,
    });
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
          <div className="flex items-center gap-2 flex-wrap">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" className="rounded-xl gap-2"><Download className="h-4 w-4" /> Export</Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={exportPdf}><FileText className="h-4 w-4 mr-2" /> Download PDF</DropdownMenuItem>
                <DropdownMenuItem onClick={exportCsv}><FileSpreadsheet className="h-4 w-4 mr-2" /> Download Excel (CSV)</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Button onClick={() => setShowIssueForm(v => !v)} className="btn-hero rounded-xl gap-2">
              <Plus className="h-4 w-4" /> Issue Material
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <div className="p-3 rounded-xl bg-secondary text-center"><p className="text-xs text-muted-foreground mb-1">Gold Outstanding</p><p className="font-semibold text-sm">{account.goldOutstanding.toLocaleString()} g</p></div>
          <div className="p-3 rounded-xl bg-secondary text-center"><p className="text-xs text-muted-foreground mb-1">Diamond Outstanding</p><p className="font-semibold text-sm">{account.diamondOutstanding.toLocaleString()} ct</p></div>
          <div className={`p-3 rounded-xl text-center border ${account.chargesPending > 0 ? "bg-destructive/5 border-destructive/20" : "bg-success/8 border-success/20"}`}>
            <p className="text-xs text-muted-foreground mb-1">Charges Pending</p>
            <p className={`font-semibold text-sm ${account.chargesPending > 0 ? "text-destructive" : "text-success"}`}>{account.chargesPending > 0 ? fmtMoneyInr(account.chargesPending) : "✓ Cleared"}</p>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <div className="p-3 rounded-xl bg-secondary text-center"><p className="text-xs text-muted-foreground mb-1">Total Charges</p><p className="font-semibold text-sm">{fmtMoneyInr(account.chargesTotal)}</p></div>
          <div className="p-3 rounded-xl bg-success/8 border border-success/20 text-center"><p className="text-xs text-muted-foreground mb-1">Charges Paid</p><p className="font-semibold text-sm text-success">{fmtMoneyInr(account.chargesPaid)}</p></div>
          <div className="p-3 rounded-xl bg-primary/5 border border-primary/20 text-center"><p className="text-xs text-muted-foreground mb-1">Charges Overpaid</p><p className="font-semibold text-sm text-primary">{fmtMoneyInr(account.chargesOverpaid)}</p></div>
        </div>

        {showIssueForm && (
          <div className="pt-2 border-t border-border/60 space-y-2.5">
            <div className="grid grid-cols-2 gap-1 p-1 bg-secondary rounded-xl">
              {(["orderConsumption", "bulkDelivery"] as const).map(m => (
                <button key={m} type="button" onClick={() => setIssueMode(m)}
                  className={`px-3 py-2 rounded-lg text-xs font-medium transition-all ${issueMode === m ? "bg-white shadow-soft text-brand-dark" : "text-muted-foreground hover:text-foreground"}`}>
                  {m === "orderConsumption" ? "Issue Against an Order" : "Bulk Delivery to Pool"}
                </button>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              {issueMode === "bulkDelivery"
                ? "Hand this factory raw material not tied to any order yet — builds up its pool for later orders to draw from."
                : "How much this factory used for one order, and their making charge — where it physically came from is figured out automatically."}
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {issueMode === "orderConsumption" && (
                <Input value={issueOrderNumber} onChange={e => setIssueOrderNumber(e.target.value)} className="rounded-xl h-10" placeholder="Order number" />
              )}
              <Select value={issueMaterial} onValueChange={v => setIssueMaterial(v as "gold" | "diamond")}>
                <SelectTrigger className="h-10 rounded-xl"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="gold">Gold</SelectItem><SelectItem value="diamond">Diamond</SelectItem></SelectContent>
              </Select>
            </div>

            {issueMaterial === "gold" ? (
              <Select value={issuePurity} onValueChange={setIssuePurity}>
                <SelectTrigger className="h-10 rounded-xl"><SelectValue /></SelectTrigger>
                <SelectContent>{GOLD_PURITIES.map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}</SelectContent>
              </Select>
            ) : (
              <Select value={issueQuality || "Round"} onValueChange={setIssueQuality}>
                <SelectTrigger className="h-10 rounded-xl"><SelectValue placeholder="Shape" /></SelectTrigger>
                <SelectContent>{DIAMOND_SHAPES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
              </Select>
            )}

            <Input
              type="number" min={0} value={issueQuantity} onChange={e => setIssueQuantity(e.target.value)}
              className="rounded-xl h-10" placeholder={issueMaterial === "gold" ? (issueMode === "bulkDelivery" ? "Weight (g)" : "Weight used (g)") : (issueMode === "bulkDelivery" ? "Carat" : "Carat used")}
            />

            {issueMode === "orderConsumption" && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <Input
                  type="number" min={0} value={issueChargeAmount} onChange={e => setIssueChargeAmount(e.target.value)}
                  className="rounded-xl h-10" placeholder="Making charge (₹, optional)"
                />
                <Input value={issueNotes} onChange={e => setIssueNotes(e.target.value)} className="rounded-xl h-10" placeholder="Notes (optional)" />
              </div>
            )}
            {issueMode === "bulkDelivery" && (
              <Input value={issueNotes} onChange={e => setIssueNotes(e.target.value)} className="rounded-xl h-10" placeholder="Notes (optional)" />
            )}

            {issueMode === "orderConsumption" && issueMaterial === "gold" && matchedOrder && orderMaterialRequirements(matchedOrder).needsGold && (() => {
              const balance = factoryPoolBalance(db.materialIssuances, id!, "gold", issuePurity);
              const estimate = estimatedPureGoldNeeded(matchedOrder);
              if (estimate <= 0 || balance >= estimate) return null;
              return (
                <div className="flex items-start gap-2 p-2.5 rounded-xl bg-destructive/5 text-destructive text-xs">
                  <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                  <span>This factory's pool only has {balance}g of {issuePurity} — {matchedOrder.orderNumber} ({matchedOrder.productKarats || "?"}) is estimated to need ~{estimate}g of pure gold. The rest will come from company stock.</span>
                </div>
              );
            })()}

            <div className="flex gap-2.5">
              <AsyncButton onClick={issueMaterialToFactory} disabled={issuing} className="btn-hero rounded-xl h-10">
                {issuing ? "Saving…" : issueMode === "bulkDelivery" ? "Record Delivery" : "Save Usage & Charge"}
              </AsyncButton>
              <Button variant="outline" onClick={() => { setShowIssueForm(false); resetIssueForm(); }} className="rounded-xl h-10">Cancel</Button>
            </div>
          </div>
        )}
      </div>

      {/* Account Statement — making charges and payments interleaved
          chronologically with a running balance, like a bank/vendor statement. */}
      <div className="card-luxe overflow-hidden">
        <div className="px-5 py-4 border-b border-border/60">
          <h2 className="font-display text-xl text-brand-dark">Account Statement</h2>
          <p className="text-xs text-muted-foreground mt-0.5">{statement.length} entr{statement.length !== 1 ? "ies" : "y"} · running balance in INR</p>
        </div>
        <div className="divide-y divide-border/40">
          {statement.map(r => (
            <div key={r.id} className="flex items-center gap-3 px-5 py-3">
              <div className={`h-8 w-8 rounded-lg grid place-items-center shrink-0 ${r.debit > 0 ? "bg-destructive/10 text-destructive" : "bg-success/10 text-success"}`}>
                {r.debit > 0 ? <Coins className="h-4 w-4" /> : <CreditCard className="h-4 w-4" />}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{r.particulars}</p>
                <p className="text-xs text-muted-foreground">{fmtDate(r.date)}</p>
              </div>
              <div className="text-right shrink-0">
                <p className={`text-sm font-semibold ${r.debit > 0 ? "text-destructive" : "text-success"}`}>
                  {r.debit > 0 ? `+${fmtMoneyInr(r.debit)}` : `−${fmtMoneyInr(r.credit)}`}
                </p>
                <p className="text-[11px] text-muted-foreground">Bal: {fmtMoneyInr(r.balance)}</p>
              </div>
            </div>
          ))}
          {statement.length === 0 && <div className="px-5 py-8 text-center text-sm text-muted-foreground">No entries yet.</div>}
        </div>
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
                    {mi.orderId ? (order ? <Link to={`/orders/${order.id}`} className="text-primary hover:underline">{order.orderNumber}</Link> : "Unknown order") : (
                      <span className="inline-flex items-center gap-1 text-muted-foreground"><Truck className="h-3.5 w-3.5" /> Bulk delivery (factory pool)</span>
                    )}
                    <span className="ml-2 text-xs font-medium px-2 py-0.5 rounded-full bg-secondary text-muted-foreground">{mi.status === "open" ? "In progress" : "Closed"}</span>
                    {mi.source === "purchase" && <span className="ml-1.5 text-xs font-medium px-2 py-0.5 rounded-full bg-primary/10 text-primary">Direct purchase</span>}
                    {mi.source === "factoryPool" && <span className="ml-1.5 text-xs font-medium px-2 py-0.5 rounded-full bg-orange-500/10 text-orange-700">From factory pool</span>}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
                    {mi.material === "gold" ? <Coins className="h-3 w-3" /> : <Gem className="h-3 w-3" />}
                    {mi.quantityIssued}{unit} {mi.purityOrQuality} issued {fmtDate(mi.issuedAt)} · {used}{unit} used
                    {mi.status === "closed" && wastage !== 0 ? (wastage > 0 ? ` · ${wastage}${unit} wastage` : ` · ${Math.abs(wastage)}${unit} over-used`) : ""}
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
                {mi.orderId && (
                  <>
                    <Button size="sm" variant="outline" onClick={() => openAction(mi.id, "piece")} className="rounded-lg gap-1.5"><CheckCircle2 className="h-3.5 w-3.5" />Finished Piece</Button>
                    <Button size="sm" variant="outline" onClick={() => openAction(mi.id, "charge")} className="rounded-lg gap-1.5"><Coins className="h-3.5 w-3.5" />Set Charge</Button>
                    {mi.makingCharges.amountInr > 0 && pending > 0 && (
                      <Button size="sm" variant="outline" onClick={() => openAction(mi.id, "pay")} className="rounded-lg gap-1.5"><CreditCard className="h-3.5 w-3.5" />Pay</Button>
                    )}
                  </>
                )}
                {mi.status === "open" && (
                  <Button size="sm" variant="outline" onClick={() => openAction(mi.id, "return")} className="rounded-lg gap-1.5"><Undo2 className="h-3.5 w-3.5" />Return</Button>
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
                    <SelectContent>{db.lockers.filter(l => l.active !== false && (l.currency || "INR") === "INR").map(l => <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>)}</SelectContent>
                  </Select>
                  <div className="flex gap-2">
                    <AsyncButton onClick={() => payCharge(mi)} className="btn-hero rounded-xl h-9 flex-1">Save</AsyncButton>
                    <Button variant="outline" onClick={() => setActiveIssuance({ id: "", action: null })} className="rounded-xl h-9">Cancel</Button>
                  </div>
                </div>
              )}
              {isActive && activeIssuance.action === "return" && (
                <div className="mt-3 pt-3 border-t border-border/60 space-y-2.5">
                  {mi.diamondKind === "certified" ? (
                    <>
                      <p className="text-xs text-muted-foreground">
                        Puts these {(mi.diamondPacketIds || []).length} certified packet{(mi.diamondPacketIds || []).length !== 1 ? "s" : ""} back into stock.
                      </p>
                      <div className="flex gap-2">
                        <AsyncButton onClick={() => returnMaterial(mi)} disabled={returning} className="btn-hero rounded-xl h-9">{returning ? "Saving…" : "Return packets to stock"}</AsyncButton>
                        <Button variant="outline" onClick={() => setActiveIssuance({ id: "", action: null })} className="rounded-xl h-9">Cancel</Button>
                      </div>
                    </>
                  ) : (
                    <>
                      <p className="text-xs text-muted-foreground">
                        Returns material to Stock — use for a diamond swap/replacement or leftover gold. Unused remainder: {Math.round((mi.quantityIssued - used) * 100) / 100}{unit}
                      </p>
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                        <Input type="number" min={0} value={returnQty} onChange={e => setReturnQty(e.target.value)} className="rounded-xl h-9" placeholder={`Return qty (${unit})`} />
                        <Input value={returnNote} onChange={e => setReturnNote(e.target.value)} className="rounded-xl h-9" placeholder="Reason (e.g. diamond replaced)" />
                        <div className="flex gap-2">
                          <AsyncButton onClick={() => returnMaterial(mi)} disabled={returning} className="btn-hero rounded-xl h-9 flex-1">{returning ? "Saving…" : "Save"}</AsyncButton>
                          <Button variant="outline" onClick={() => setActiveIssuance({ id: "", action: null })} className="rounded-xl h-9">Cancel</Button>
                        </div>
                      </div>
                    </>
                  )}
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
