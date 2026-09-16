import { useMemo, useState } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { updateDb, uid, fmtDate, DIAMOND_SHAPES, toPureGold, pureFromPurity, hasOpeningBalance, openingDebitAmt, openingCreditAmt, type MaterialIssuance, type LedgerDir } from "@/lib/db";
import { OpeningBalanceFields } from "@/components/OpeningBalanceFields";
import { useDb } from "@/hooks/useDb";
import { useAuth } from "@/lib/auth";
import {
  factoryAccount, issuancePaid, issuancePending, issuanceUsed, issuanceWastage, fmtMoneyInr,
  factoryPoolBalance, estimatedPureGoldNeeded, orderMaterialRequirements, factoryFineGoldBalance, lockerBalance, fmtLockerAmount,
} from "@/lib/manufacturing";
import { decreaseStockSelfHealing, increaseStock } from "@/lib/stock";
import { Button } from "@/components/ui/button";
import { AsyncButton } from "@/components/AsyncButton";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  ArrowLeft, Factory as FactoryIcon, Phone, MapPin, Wallet, Plus, CreditCard, CheckCircle2, Coins, Gem,
  Download, FileText, FileSpreadsheet, Undo2, AlertCircle, Truck, ArrowDownCircle, ArrowUpCircle,
} from "lucide-react";
import { motion } from "framer-motion";
import { toast } from "sonner";
import { downloadCsv, downloadLedgerPdf, downloadLedgerPdfMulti, fmtInrPlain } from "@/lib/ledgerExport";
import { ExportDialog, inDateRange } from "@/components/ExportDialog";
import { FullLedgerTable, type MovementRow } from "@/components/FullLedgerTable";
import { FactoryOrderLedger, buildFactoryOrderRows } from "@/components/FactoryOrderLedger";
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
  const account = factoryAccount(issuances, factory);

  // ── Opening balance (migration) ──
  const [obOpen, setObOpen] = useState(false);
  const [ob, setOb] = useState({
    amount: factory.openingBalance != null ? String(factory.openingBalance) : "",
    dir: (factory.openingDir || "credit") as LedgerDir,
    date: factory.openingDate || "",
    fineGold: factory.openingFineGold != null ? String(factory.openingFineGold) : "",
    fineGoldDate: factory.openingFineGoldDate || "",
  });
  const saveOpening = () => {
    const amt = ob.amount === "" ? 0 : Number(ob.amount);
    const fg = ob.fineGold === "" ? 0 : Number(ob.fineGold);
    updateDb(d => {
      const fac = d.factories.find(x => x.id === id);
      if (!fac) return;
      fac.openingBalance = amt || undefined;
      fac.openingDir = amt ? ob.dir : undefined;
      fac.openingDate = amt ? (ob.date || undefined) : undefined;
      fac.openingFineGold = fg || undefined;
      fac.openingFineGoldDate = fg ? (ob.fineGoldDate || undefined) : undefined;
    });
    toast.success("Opening balance updated");
    setObOpen(false);
  };

  // ── Issue material ──
  // "bulkDelivery" = hand the factory raw material not tied to any order yet
  // (builds up its pool); "orderConsumption" = today's flow, earmarked to one
  // order, now also able to draw from that pool instead of a new delivery.
  const [showExport, setShowExport] = useState(false);
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
        await decreaseStockSelfHealing({
          material: issueMaterial, purityOrQuality, quantity: qty,
          type: "issuance_out", refType: "materialIssuance", refId: issuanceId, createdBy: user!.id,
          note: `Bulk delivery to ${factory.name}`,
        }, db.stockMovements);
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
        await decreaseStockSelfHealing({
          material: issueMaterial, purityOrQuality, quantity: qty,
          type: "issuance_out", refType: "materialIssuance", refId: issuanceId, createdBy: user!.id,
          note: `Used by ${factory.name} for order ${matchedOrder.orderNumber}`,
        }, db.stockMovements);
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
    const payLocker = db.lockers.find(l => l.id === payLockerId);
    if (payLocker && amt > lockerBalance(payLocker, db.lockerTransactions) &&
        !window.confirm(`This payment of ${fmtLockerAmount(amt, payLocker.currency)} is more than ${payLocker.name}'s balance of ${fmtLockerAmount(lockerBalance(payLocker, db.lockerTransactions), payLocker.currency)}. The locker will go negative — continue only if a deposit is still missing.`)) return;
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
    // A bulk delivery's own issuanceUsed is always 0 (orders draw against it
    // via separate factoryPool-sourced records, never its own finishedPieces)
    // — cap it at the true remaining pool balance instead, or this would let
    // you "return" material a different order already has committed.
    const maxReturnable = !issuance.orderId
      ? factoryPoolBalance(db.materialIssuances, issuance.factoryId, issuance.material, issuance.purityOrQuality)
      : Math.round((issuance.quantityIssued - issuanceUsed(issuance)) * 100) / 100;
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
    // A bulk delivery (no orderId) never gets its own finishedPieces — orders
    // draw against it as separate factoryPool-sourced records instead, so
    // issuanceWastage(issuance) here is always the FULL original delivery,
    // ignoring anything already drawn. The true leftover is whatever's still
    // undrawn in the pool right now — using the naive wastage would return
    // the whole original amount to stock even after part of it was already
    // legitimately committed to an order, conjuring phantom gold into Stock.
    const leftover = !issuance.orderId
      ? factoryPoolBalance(db.materialIssuances, issuance.factoryId, issuance.material, issuance.purityOrQuality)
      : Math.round(issuanceWastage(issuance) * 100) / 100;
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

  const orderRows = buildFactoryOrderRows(issuances, db.orders);

  /** Trim only when the text genuinely cannot fit (8.5pt Helvetica is about
   *  1.6mm a character), so nothing is cut that would have fitted. */
  const fit = (s: string, mm: number) => {
    const max = Math.floor(mm / 1.6);
    return s.length <= max ? s : s.slice(0, max - 1) + "…";
  };






  // Limit the export to a single order's issuances (matched on order number,
  // forgiving of the SLJ-… prefix), or all of them when no order is given.
  const issuancesForOrder = (orderNo?: string) => {
    if (!orderNo) return issuances;
    const q = orderNo.trim().toLowerCase();
    return issuances.filter(mi => (db.orders.find(o => o.id === mi.orderId)?.orderNumber ?? "").toLowerCase().includes(q));
  };

  const ordSuffix = (o?: string) => (o ? `-Order-${o.replace(/[^\w.-]+/g, "_")}` : "");



  // ── Combined: ONE two-sided Debit | Credit ledger (Gold + Diamond + Amount on
  //    each side, one row per transaction) — the format the client uses in their
  //    accounting software. Optionally limited to a single order. ──
  const rs = (n: number) => Math.round(n).toLocaleString("en-IN"); // plain INR (jsPDF can't render ₹)
  const q3 = (n: number) => Math.round(n * 1000) / 1000;

  type UniRow = { id: string; date: string; ref: string; particular: string; drGold: number; drSilver: number; drDia: number; drOther: number; drAmount: number; crGold: number; crSilver: number; crDia: number; crOther: number; crAmount: number; otherLabel?: string };
  // Debit  = value we GAVE the factory (gold/diamond issued) + money we PAID them.
  // Credit = value the factory RETURNED (finished gold, diamond used/returned) + charges they BILLED.
  const buildUnifiedLedger = (iss: MaterialIssuance[], includeOpening = false): UniRow[] => {
    const rows: UniRow[] = [];
    const zero = () => ({ drGold: 0, drSilver: 0, drDia: 0, drOther: 0, drAmount: 0, crGold: 0, crSilver: 0, crDia: 0, crOther: 0, crAmount: 0 });
    // Factory-wide opening balances brought forward: fine gold given (debit gold),
    // charges we owe (credit amount) / factory owes us (debit amount).
    if (includeOpening && (hasOpeningBalance(factory) || factory.openingFineGold)) {
      rows.push({ ...zero(), id: "opening", date: factory.openingDate || factory.openingFineGoldDate || factory.createdAt, ref: "", particular: "Opening balance (brought forward)", drGold: factory.openingFineGold || 0, crAmount: openingCreditAmt(factory), drAmount: openingDebitAmt(factory) });
    }
    for (const mi of iss) {
      const order = db.orders.find(o => o.id === mi.orderId);
      const ref = order?.orderNumber || (mi.source === "factoryPool" ? "Pool" : "");
      // Gold given to the factory (fine 24KT, matching the "Fine Gold at Factory" card).
      if (mi.material === "gold" && mi.source !== "factoryPool") {
        rows.push({ ...zero(), id: mi.id + "-gin", date: mi.issuedAt, ref, particular: `Gold issued — ${mi.quantityIssued}g ${mi.purityOrQuality}`, drGold: toPureGold(mi.quantityIssued, mi.purityOrQuality) });
      }
      // Finished piece returned by the factory (converted to fine 24KT).
      if (mi.material === "gold" && mi.finishedNetWeight != null) {
        const fine = mi.finishedPurity != null ? pureFromPurity(mi.finishedNetWeight, mi.finishedPurity) : toPureGold(mi.finishedNetWeight, mi.finishedKarat || "24K");
        rows.push({ ...zero(), id: mi.id + "-gout", date: mi.issuedAt, ref, particular: `Finished piece — net ${mi.finishedNetWeight}g`, crGold: fine });
        // A two-tone piece comes back with a second metal in it. Silver gets its
        // own column because it is the common one; anything else (platinum, etc.)
        // shares the Other Metal column and is named in the row.
        const om = (order?.otherMetal || "").trim();
        const omW = order?.otherMetalWeight || 0;
        if (om && omW > 0) {
          const isSilver = /silver/i.test(om);
          rows.push({ ...zero(), id: mi.id + "-om", date: mi.issuedAt, ref, particular: `${om} in finished piece — ${omW}g`, crSilver: isSilver ? omW : 0, crOther: isSilver ? 0 : omW, otherLabel: isSilver ? undefined : om });
        }
      }
      // Diamond issued in / used-in-piece + returned out.
      if (mi.material === "diamond") {
        rows.push({ ...zero(), id: mi.id + "-din", date: mi.issuedAt, ref, particular: `Diamond issued — ${mi.quantityIssued}ct ${mi.diamondKind === "certified" ? "certified" : mi.purityOrQuality}`, drDia: mi.quantityIssued });
        if (mi.status === "closed") {
          const returned = mi.diamondKind === "certified" ? (mi.finishDisposition === "returned" ? mi.quantityIssued : 0) : (mi.finishReturnedCt || 0);
          const used = Math.round((mi.quantityIssued - returned) * 1000) / 1000;
          if (used > 0) rows.push({ ...zero(), id: mi.id + "-dused", date: mi.issuedAt, ref, particular: `Diamond used in piece`, crDia: used });
          if (returned > 0) rows.push({ ...zero(), id: mi.id + "-dret", date: mi.issuedAt, ref, particular: `Diamond returned to stock`, crDia: returned });
        }
      }
      // Making charges billed (credit) and payments made (debit).
      if (mi.makingCharges.amountInr > 0) {
        const unit = mi.material === "gold" ? "g" : "ct";
        rows.push({ ...zero(), id: mi.id + "-chg", date: mi.issuedAt, ref, particular: `Making charges — ${mi.quantityIssued}${unit} ${mi.purityOrQuality}`, crAmount: mi.makingCharges.amountInr });
      }
      for (const pay of mi.makingCharges.payments || []) {
        rows.push({ ...zero(), id: pay.id, date: pay.createdAt, ref, particular: `Payment${pay.note ? ` — ${pay.note}` : ""}`, drAmount: pay.amountInr });
      }
    }
    return rows.sort((a, b) => (a.id === "opening" ? -1 : b.id === "opening" ? 1 : +new Date(a.date) - +new Date(b.date))); // chronological (oldest first), opening pinned
  };

  /**
   * Flatten the two-sided rows into one movement per line — material named, with
   * a running balance inside that material. The old debit/credit block layout
   * left a page of white space between two thin columns when a factory only
   * handles one material.
   */
  const flattenMovements = (rows: UniRow[]): MovementRow[] => {
    const parts: { key: string; label: string; dr: (r: UniRow) => number; cr: (r: UniRow) => number; money?: boolean }[] = [
      { key: "gold", label: "Gold (g fine)", dr: r => r.drGold, cr: r => r.crGold },
      { key: "silver", label: "Silver (g)", dr: r => r.drSilver, cr: r => r.crSilver },
      { key: "dia", label: "Diamond (ct)", dr: r => r.drDia, cr: r => r.crDia },
      { key: "other", label: "Other metal (g)", dr: r => r.drOther, cr: r => r.crOther },
      { key: "amount", label: "Amount (Rs)", dr: r => r.drAmount, cr: r => r.crAmount, money: true },
    ];
    const out: MovementRow[] = [];
    const running: Record<string, number> = {};
    for (const r of rows) {
      for (const p of parts) {
        const d = p.dr(r), c = p.cr(r);
        if (!d && !c) continue;
        // Money runs the other way round: a charge raises what we owe.
        const delta = p.money ? c - d : d - c;
        running[p.key] = Math.round(((running[p.key] || 0) + delta) * 1000) / 1000;
        out.push({
          id: `${r.id}-${p.key}`,
          date: r.date,
          ref: r.ref,
          particular: r.particular + (r.otherLabel ? ` (${r.otherLabel})` : ""),
          material: p.label,
          out: p.money ? c : d,
          in: p.money ? d : c,
          balance: running[p.key],
          money: p.money,
        });
      }
    }
    return out;
  };


  const uniTotals = (rows: UniRow[]) => rows.reduce(
    (t, r) => ({ drGold: t.drGold + r.drGold, drSilver: t.drSilver + r.drSilver, drDia: t.drDia + r.drDia, drOther: t.drOther + r.drOther, drAmount: t.drAmount + r.drAmount, crGold: t.crGold + r.crGold, crSilver: t.crSilver + r.crSilver, crDia: t.crDia + r.crDia, crOther: t.crOther + r.crOther, crAmount: t.crAmount + r.crAmount }),
    { drGold: 0, drSilver: 0, drDia: 0, drOther: 0, drAmount: 0, crGold: 0, crSilver: 0, crDia: 0, crOther: 0, crAmount: 0 },
  );

  /**
   * Which material columns this factory actually uses. A diamond-only factory
   * was printing eight permanently blank columns and squeezing the particulars
   * into nothing; dropping them gives the description the room it needs.
   */


  // ── Order-by-order downloads: the summary people actually read ──────────
  const orderRowsFor = (from: Date | null, to: Date | null, orderNo?: string) =>
    buildFactoryOrderRows(issuancesForOrder(orderNo), db.orders)
      .filter(r => inDateRange(r.date, from, to));



  const exportOrdersPdf = (from: Date | null, to: Date | null, orderNo?: string) => {
    const rows = orderRowsFor(from, to, orderNo);
    // Metal and diamond always print — a factory ledger without them is no use.
    const hasGold = true;
    const hasDia = true;
    const hasSilver = rows.some(r => r.silverIn);
    const hasOther = rows.some(r => r.otherIn);
    // Estimates print on their row but never count toward a balance — see the
    // same rule in FactoryOrderLedger.
    const T = rows.reduce((t, r) => ({
      goldOut: t.goldOut + (r.goldEstimated ? 0 : r.goldOut),
      goldIn: t.goldIn + r.goldIn,
      diaOut: t.diaOut + (r.diaEstimated ? 0 : r.diaOut),
      diaIn: t.diaIn + r.diaIn,
      labour: t.labour + r.labour, paid: t.paid + r.paid,
    }), { goldOut: 0, goldIn: 0, diaOut: 0, diaIn: 0, labour: 0, paid: 0 });

    // Columns are laid out by WIDTH and then fitted to the page. Adding them up
    // as fixed positions ran 322mm across a 269mm page, so Pending and Status
    // fell off the right-hand edge entirely.
    const want: { header: string; w: number; right?: boolean }[] = [
      { header: "Order", w: 30 },
      { header: "Date", w: 22 },
      { header: "Item", w: 40 },
      ...(hasGold ? [
        { header: "Gold out", w: 20, right: true },
        { header: "Gold back", w: 20, right: true },
        { header: "With fact.", w: 20, right: true },
      ] : []),
      ...(hasDia ? [
        { header: "Dia out", w: 18, right: true },
        { header: "Dia back", w: 18, right: true },
        { header: "Open ct", w: 18, right: true },
      ] : []),
      ...(hasSilver ? [{ header: "Silver g", w: 18, right: true }] : []),
      ...(hasOther ? [{ header: "Other g", w: 18, right: true }] : []),
      { header: "Labour", w: 22, right: true },
      { header: "Paid", w: 20, right: true },
      { header: "Pending", w: 22, right: true },
      { header: "Status", w: 24 },
    ];
    const AVAIL = 269; // 297mm landscape less the 14mm margins
    const total = want.reduce((s, c) => s + c.w, 0);
    const scale = total > AVAIL ? AVAIL / total : 1;
    let cx = 14;
    const columns = want.map(c => { const col = { header: c.header, x: cx }; cx += c.w * scale; return col; });
    const align: ("left" | "right")[] = want.map(c => (c.right ? "right" : "left"));
    downloadLedgerPdf({
      title: `Factory Ledger — ${factory.name}${orderNo ? ` · Order ${orderNo}` : ""}`,
      subjectLines: [
        factory.contactPerson ? `Contact: ${factory.contactPerson}` : "",
        from || to ? `Period: ${from ? fmtDate(from.toISOString()) : "start"} → ${to ? fmtDate(to.toISOString()) : "today"}` : "Period: all time",
        `Report Generated: ${new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}`,
      ].filter(Boolean),
      summary: [
        { label: "Gold still at factory", value: `${q3((factory.openingFineGold || 0) + T.goldOut - T.goldIn)} g fine` },
        { label: "Diamond not accounted", value: `${q3(T.diaOut - T.diaIn)} ct` },
        { label: "Labour billed", value: fmtInrPlain(T.labour) },
        { label: "Labour pending", value: fmtInrPlain(Math.max(0, T.labour - T.paid)) },
      ],
      landscape: true,
      columns,
      align,
      rows: rows.map(r => [
        r.orderNo, fmtDate(r.date), fit([r.jewellery, r.metalNote].filter(Boolean).join(" · "), 40 * scale),
        ...(hasGold ? [(r.goldEstimated ? "~" : "") + (q3(r.goldOut) || ""), q3(r.goldIn) || "", q3(r.goldOut - r.goldIn) || "0"] : []),
        ...(hasDia ? [r.diaOut ? (r.diaEstimated ? "~" : "") + r.diaOut.toFixed(2) : "", r.diaIn ? r.diaIn.toFixed(2) : "", (r.diaOut - r.diaIn).toFixed(2)] : []),
        ...(hasSilver ? [q3(r.silverIn) || ""] : []),
        ...(hasOther ? [q3(r.otherIn) || ""] : []),
        r.labour ? rs(r.labour) : "", r.paid ? rs(r.paid) : "",
        r.labour - r.paid > 0.5 ? rs(r.labour - r.paid) : "",
        r.open > 0 ? `${r.open} open` : "Done",
      ].map(String)),
      totalsRow: [
        "", "", "Totals",
        ...(hasGold ? [String(q3(T.goldOut)), String(q3(T.goldIn)), String(q3(T.goldOut - T.goldIn))] : []),
        ...(hasDia ? [T.diaOut.toFixed(2), T.diaIn.toFixed(2), (T.diaOut - T.diaIn).toFixed(2)] : []),
        ...(hasSilver ? [String(q3(rows.reduce((s, r) => s + r.silverIn, 0)))] : []),
        ...(hasOther ? [String(q3(rows.reduce((s, r) => s + r.otherIn, 0)))] : []),
        rs(T.labour), rs(T.paid), rs(Math.max(0, T.labour - T.paid)), "",
      ],
      filename: `Factory-${factory.name.replace(/\s+/g, "_")}${ordSuffix(orderNo)}-Orders`,
    });
  };

  const exportOrdersCsv = (from: Date | null, to: Date | null, orderNo?: string) => {
    const rows = orderRowsFor(from, to, orderNo);
    downloadCsv(
      `Factory-${factory.name.replace(/\s+/g, "_")}${ordSuffix(orderNo)}-Orders`,
      ["Order", "Date", "Item", "Gold issued (g fine)", "Gold returned (g fine)", "Gold with factory (g fine)",
       "Diamond issued (ct)", "Diamond accounted (ct)", "Diamond open (ct)", "Silver (g)", "Other metal (g)",
       "Labour billed (INR)", "Labour paid (INR)", "Labour pending (INR)", "Quoted (USD)", "Estimated?", "Status"],
      rows.map(r => [
        r.orderNo, fmtDate(r.date), r.jewellery,
        q3(r.goldOut), q3(r.goldIn), q3(r.goldOut - r.goldIn),
        q3(r.diaOut), q3(r.diaIn), q3(r.diaOut - r.diaIn),
        q3(r.silverIn), q3(r.otherIn),
        Math.round(r.labour), Math.round(r.paid), Math.round(Math.max(0, r.labour - r.paid)),
        Math.round(r.quotedUsd),
        r.goldEstimated || r.diaEstimated ? "estimate — not yet finally approved" : "",
        r.open > 0 ? `${r.open} still with factory` : "Done",
      ]),
    );
  };


  const exportCombinedPdf = (from: Date | null, to: Date | null, orderNo?: string) => {
    const iss = issuancesForOrder(orderNo);
    const acct = factoryAccount(iss, orderNo ? undefined : factory);
    const rows = flattenMovements(
      buildUnifiedLedger(iss, !orderNo).filter(r => inDateRange(r.date, from, to)),
    );
    // One flowing table: Date, Ref, Particular, Material, Out, In, Balance. The
    // old two-block layout left the middle of the page empty for a factory that
    // only handles one material.
    downloadLedgerPdf({
      title: `Factory Movement Sheet — ${factory.name}${orderNo ? ` · Order ${orderNo}` : ""}`,
      subjectLines: [
        factory.contactPerson ? `Contact: ${factory.contactPerson}` : "",
        from || to ? `Period: ${from ? fmtDate(from.toISOString()) : "start"} → ${to ? fmtDate(to.toISOString()) : "today"}` : "Period: all time",
        `Report Generated: ${new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}`,
      ].filter(Boolean),
      summary: [
        { label: "Charges Pending", value: fmtInrPlain(acct.chargesPending) },
      ],
      landscape: true,
      columns: [
        { header: "Date", x: 14 },
        { header: "Order / Ref", x: 42 },
        { header: "Particular", x: 84 },
        { header: "Material", x: 176 },
        { header: "Out", x: 218 },
        { header: "In", x: 242 },
        { header: "Balance", x: 262 },
      ],
      align: ["left", "left", "left", "left", "right", "right", "right"],
      rows: rows.map(r => [
        r.id.startsWith("opening") ? "Opening" : fmtDate(r.date),
        fit(r.ref || "", 40),
        fit(r.particular, 88),
        r.material,
        r.out ? (r.money ? rs(r.out) : String(q3(r.out))) : "",
        r.in ? (r.money ? rs(r.in) : String(q3(r.in))) : "",
        r.money ? rs(r.balance) : String(q3(r.balance)),
      ]),
      filename: `Factory-${factory.name.replace(/\s+/g, "_")}${ordSuffix(orderNo)}-Movements`,
    });
  };

  const exportCombinedCsv = (from: Date | null, to: Date | null, orderNo?: string) => {
    const iss = issuancesForOrder(orderNo);
    const rows = flattenMovements(
      buildUnifiedLedger(iss, !orderNo).filter(r => inDateRange(r.date, from, to)),
    );
    downloadCsv(
      `Factory-${factory.name.replace(/\s+/g, "_")}${ordSuffix(orderNo)}-Movements`,
      ["Date", "Order / Ref", "Particular", "Material", "Out", "In", "Balance"],
      rows.map(r => [
        r.id.startsWith("opening") ? "Opening" : fmtDate(r.date),
        r.ref, r.particular, r.material,
        r.out ? (r.money ? Math.round(r.out) : q3(r.out)) : "",
        r.in ? (r.money ? Math.round(r.in) : q3(r.in)) : "",
        r.money ? Math.round(r.balance) : q3(r.balance),
      ]),
    );
  };

  return (
    <div className="max-w-7xl mx-auto space-y-6">
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
            <Button variant="outline" onClick={() => setShowExport(true)} className="rounded-xl gap-2"><Download className="h-4 w-4" /> Export</Button>
            <ExportDialog open={showExport} onClose={() => setShowExport(false)} title={`${factory.name} ledger`}
              extraFilter={{ label: "Order number", placeholder: "e.g. SLJ-2026-1042 (optional)", hint: "Leave blank for the whole factory." }}
              options={[
                { label: "Factory Ledger — PDF", sublabel: "One table: gold, diamond, other metal and labour, order by order", kind: "pdf", run: exportOrdersPdf },
                { label: "Factory Ledger — Excel", sublabel: "One table: gold, diamond, other metal and labour, order by order", kind: "excel", run: exportOrdersCsv },
                { label: "Movement Sheet — PDF", sublabel: "Every issue and return line by line, if a figure needs checking", kind: "pdf", run: exportCombinedPdf },
                { label: "Movement Sheet — Excel", sublabel: "Every issue and return line by line, if a figure needs checking", kind: "excel", run: exportCombinedCsv },
              ]} />
            {user?.role === "admin" && (
              <Button onClick={() => setShowIssueForm(v => !v)} className="btn-hero rounded-xl gap-2">
                <Plus className="h-4 w-4" /> Issue Material
              </Button>
            )}
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/20 text-center"><p className="text-xs text-muted-foreground mb-1">Fine Gold at Factory (24KT)</p><p className="font-semibold text-sm text-amber-700">{factoryFineGoldBalance(db.materialIssuances, id!, factory.openingFineGold).toLocaleString()} g</p></div>
          <div className="p-3 rounded-xl bg-secondary text-center"><p className="text-xs text-muted-foreground mb-1">Diamond (net ±)</p><p className={`font-semibold text-sm ${account.diamondOutstanding < 0 ? "text-destructive" : ""}`}>{account.diamondOutstanding > 0 ? "+" : ""}{account.diamondOutstanding.toLocaleString()} ct</p></div>
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

        {/* Opening balance (migration) — admin only */}
        {user?.role === "admin" && (
          <div className="pt-2 border-t border-border/60">
            <button onClick={() => setObOpen(v => !v)} className="w-full flex items-center justify-between gap-3 text-left">
              <div>
                <p className="text-sm font-semibold text-brand-dark">Opening Balance</p>
                <p className="text-xs text-muted-foreground">
                  {hasOpeningBalance(factory) || factory.openingFineGold
                    ? [
                        hasOpeningBalance(factory) ? `${fmtMoneyInr(Math.abs(factory.openingBalance!))} ${factory.openingDir === "credit" ? "we owe" : "owed to us"}` : "",
                        factory.openingFineGold ? `${factory.openingFineGold}g fine gold` : "",
                      ].filter(Boolean).join(" · ")
                    : "Not set — add balances carried in from your previous system"}
                </p>
              </div>
              <span className="text-sm text-primary font-medium shrink-0">{obOpen ? "Close" : "Edit"}</span>
            </button>
            {obOpen && (
              <div className="mt-3 grid grid-cols-2 gap-3">
                <OpeningBalanceFields
                  amount={ob.amount}
                  dir={ob.dir}
                  date={ob.date}
                  onAmount={v => setOb({ ...ob, amount: v })}
                  onDir={v => setOb({ ...ob, dir: v })}
                  onDate={v => setOb({ ...ob, date: v })}
                  debitLabel="Factory owes us (Debit)"
                  creditLabel="We owe factory (Credit)"
                  title="Opening Making-Charge Balance"
                  hint="Unpaid labour / making charges with this factory when you started using this app (₹)."
                />
                <div className="col-span-2 rounded-xl border border-amber-500/30 bg-amber-500/5 p-3 space-y-2.5">
                  <p className="text-xs font-semibold text-amber-700">Opening Gold Stock (optional)</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    <div>
                      <label className="text-[11px] text-muted-foreground">Fine gold at factory (24KT grams)</label>
                      <Input type="number" min={0} step="0.001" value={ob.fineGold} onChange={e => setOb({ ...ob, fineGold: e.target.value })} placeholder="0.000" className="rounded-lg mt-1 h-9" />
                    </div>
                    <div>
                      <label className="text-[11px] text-muted-foreground">As of date</label>
                      <Input type="date" value={ob.fineGoldDate} onChange={e => setOb({ ...ob, fineGoldDate: e.target.value })} className="rounded-lg mt-1 h-9" />
                    </div>
                  </div>
                </div>
                <div className="col-span-2">
                  <AsyncButton onClick={saveOpening} className="btn-hero rounded-xl h-10">Save Opening Balance</AsyncButton>
                </div>
              </div>
            )}
          </div>
        )}

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
      {/* ONE ledger for this factory: gold given and used, diamond given and
          used, the other metals, and the labour billed, paid and pending — all
          on the same row as the order they belong to. It replaced a separate
          account statement, gold ledger, diamond ledger and movement sheet,
          which meant four tables to cross-reference for one job. */}
      <FactoryOrderLedger
        rows={orderRows}
        factoryName={factory.name}
        openingFineGold={factory.openingFineGold || 0}
        onExport={() => setShowExport(true)}
      />


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

              {user?.role === "admin" && (
              <div className="flex flex-wrap gap-2 mt-3">
                {mi.orderId && (
                  <>
                    {used < mi.quantityIssued - 0.001 && (
                      <Button size="sm" variant="outline" onClick={() => openAction(mi.id, "piece")} className="rounded-lg gap-1.5"><CheckCircle2 className="h-3.5 w-3.5" />Finished Piece</Button>
                    )}
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
              )}

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
