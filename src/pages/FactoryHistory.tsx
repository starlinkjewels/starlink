import { LotPicker, lotStockText } from "@/components/LotFields";
import { lotBalances, lotLabel, lotParts } from "@/lib/diamondLots";
import { bagNoOf } from "@/lib/diamondBags";
import { purchaseBucket } from "@/lib/materials";
import { useCan, useMayExport } from "@/hooks/useCan";
import { MoreMenu, type MoreAction } from "@/components/MoreMenu";
import { PageHeader } from "@/components/PageHeader";
import { SectionTitle } from "@/components/SectionTitle";
import { StatStrip } from "@/components/TableToolbar";
import { IssuanceEditSheet } from "@/components/IssuanceEditSheet";
import { FactoryEditDialog } from "@/components/FactoryEditDialog";
import { canEditIssuance, canCancelIssuance, deleteIssuance, issuanceVoidImpact, isPoolDraw } from "@/lib/issuanceEdit";
import { factoryDeleteGuard, deleteRefusal } from "@/lib/partyGuards";
import { needsAccess } from "@/lib/actionHints";
import { AddNewItem, useAddNew } from "@/components/create/QuickCreate";
import { useOtherMaterials, GradeInput } from "@/components/MaterialFields";
import { CompanyFilter, CompanyPicker, CompanyBadge, useMultiCo, useDefaultCompany } from "@/components/CompanyFields";
import { FactoryPoolTransferDialog } from "@/components/FactoryPoolTransfer";
import { companyOf, coField, workCompanyOf, companyById } from "@/lib/companies";
import { isOtherMaterial, materialName, materialUnit, type MaterialKey } from "@/lib/materials";
import { otherFlow, factoryOtherBalances } from "@/lib/pure/accounts";
import { useMemo, useState, type ReactNode } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { collectionLoaded, updateDb, uid, fmtDate, DIAMOND_SHAPES, toPureGold, pureFromPurity, hasOpeningBalance, openingDebitAmt, openingCreditAmt, type MaterialIssuance, type LedgerDir, type Factory } from "@/lib/db";
import { OpeningBalanceFields } from "@/components/OpeningBalanceFields";
import { useDb } from "@/hooks/useDb";
import { useAuth } from "@/lib/auth";
import {
  factoryAccount, issuancePaid, issuancePending, issuanceUsed, issuanceWastage, fmtMoneyInr,
  factoryPoolBalance, estimatedPureGoldNeeded, orderMaterialRequirements, factoryFineGoldBalance, lockerBalance, fmtLockerAmount,
  groupPaymentsAsMade, diamondFlow,
} from "@/lib/manufacturing";
import { decreaseStockSelfHealing, increaseStock } from "@/lib/stock";
import { ActionSheet } from "@/components/ActionSheet";
import { Button } from "@/components/ui/button";
import { AsyncButton } from "@/components/AsyncButton";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Phone, MapPin, Wallet, Plus, CreditCard, CheckCircle2, Coins, Gem,
  Download, FileText, FileSpreadsheet, Undo2, AlertCircle, Truck, ArrowDownCircle, ArrowUpCircle, ArrowRightLeft, Archive,
  Pencil, Trash2, ExternalLink, Lock, RotateCcw, Package, Receipt,
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
import { confirmBox } from "@/lib/confirm";

/** An action on an issuance card: a light text button, icon and word. */
const ISSUE_ACTION = "inline-flex items-center gap-1.5 h-9 px-2.5 rounded-lg text-sm font-medium text-primary hover:bg-primary/[0.07] transition-colors";

const GOLD_PURITIES = ["9K", "14K", "18K", "22K", "24K"];

type IssuanceAction = "piece" | "charge" | "pay" | "return" | "close" | null;

/** A panel's footer: what it comes to on the left, Cancel and the save on the right. */
function PanelFooter({ label, value, sub, children }: { label?: string; value?: ReactNode; sub?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 flex-wrap">
      {label != null && (
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground">{label}</p>
          <p className="text-lg font-semibold text-foreground tabular-nums leading-tight whitespace-nowrap">{value}</p>
          {sub && <p className="text-[11px] text-muted-foreground">{sub}</p>}
        </div>
      )}
      <div className="flex gap-2.5 ml-auto">{children}</div>
    </div>
  );
}

/**
 * The page waits for its record before drawing anything that holds state. The
 * data behind the first screen arrives a moment after the page opens, and a
 * page that returned early on its first draw and then ran all its hooks on the
 * next crashed (React #310) whenever it was opened or refreshed directly.
 */
export function FactoryHistoryPage() {
  const { id } = useParams();
  const db = useDb();
  if (!(db.factories.some(f => f.id === id))) {
    return (
      <div className="text-center py-20 text-muted-foreground">
        {collectionLoaded("factories") ? "Factory not found." : "Loading…"}{" "}
        <Link to="/factories" className="inline-block py-2.5 -my-2.5 text-primary underline">Back</Link>
      </div>
    );
  }
  // Keyed by the record, so moving straight to another one starts it afresh.
  return <FactoryHistoryPageBody key={id} />;
}

function FactoryHistoryPageBody() {
  const mayExport = useMayExport();
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const db = useDb();
  const addNew = useAddNew();
  const can = useCan();
  const isAdmin = user?.role === "admin";
  // Correcting the profile or one issue: each opens in a panel over the page.
  const [editingFactory, setEditingFactory] = useState<Factory | null>(null);
  const [editingIssuance, setEditingIssuance] = useState<MaterialIssuance | null>(null);

  const factory = db.factories.find(f => f.id === id);
  if (!factory) {
    return (
      <div className="text-center py-20 text-muted-foreground">
        Factory not found. <Link to="/factories" className="inline-block py-2.5 -my-2.5 text-primary underline">Back to Factories</Link>
      </div>
    );
  }

  // Each company's material at the factory is kept apart: the page shows one
  // company's share, or the whole factory.
  const multiCo = useMultiCo();
  const [coView, setCoView] = useState("all");
  const view = multiCo ? coView : "all";
  const issuances = db.materialIssuances
    .filter(i => i.factoryId === id && (view === "all" || companyOf(i) === view))
    .sort((a, b) => +new Date(b.issuedAt) - +new Date(a.issuedAt));
  // Advances and loans — paid to this factory but settling no particular job.
  // They, and the opening balance, date from before there was more than one
  // company: the first company's.
  const firstCo = view === "all" || view === "main";
  const advances = firstCo ? (db.factoryPayments ?? []).filter(x => x.factoryId === id) : [];
  const account = factoryAccount(issuances, firstCo ? factory : undefined, advances);
  const [movingPool, setMovingPool] = useState(false);

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
  const [issueMaterial, setIssueMaterial] = useState<MaterialKey>("gold");
  const [issueGrade, setIssueGrade] = useState("");
  // Whose material a bulk delivery is (an order's issue is always its order's company).
  const [issueCompany, setIssueCompany] = useState(useDefaultCompany());
  const otherMaterials = useOtherMaterials();
  /** "gold", "diamond" — or the other material's own name — for messages. */
  const matWord = (k: string) => (k === "gold" || k === "diamond" ? k : materialName(db.settings, k));
  const issueUnit = materialUnit(db.settings, issueMaterial);
  const [issuePurity, setIssuePurity] = useState("22K");
  // Loose diamonds: the stock LOT they leave (its bucket — lib/diamondLots.ts), and how many stones.
  const [issueQuality, setIssueQuality] = useState("");
  const [issuePcs, setIssuePcs] = useState("");
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
    setIssuePurity("22K"); setIssueQuality(""); setIssueFrom(""); setIssuePcs(""); setIssueGrade(""); setIssueQuantity(""); setIssueChargeAmount(""); setIssueNotes("");
  };

  const issueMaterialToFactory = async () => {
    const qty = Number(issueQuantity);
    if (!qty || qty <= 0) { toast.error(`Enter the ${matWord(issueMaterial)} quantity to issue`); return; }
    if (issueMaterial === "diamond" && !issueQuality.trim()) { toast.error("Choose the lot the stones come from"); return; }
    const purityOrQuality = issueMaterial === "gold" ? issuePurity : isOtherMaterial(issueMaterial) ? (issueGrade.trim() || "—") : (issueQuality.trim() || "unspecified");
    // Loose diamonds: the lot's parts and the stones counted, on the stock movement and the issue.
    const diaLot = issueMaterial === "diamond" ? { lot: lotParts(purityOrQuality), pieces: Number(issuePcs) > 0 ? Math.round(Number(issuePcs)) : undefined } : {};
    const issuanceId = uid("mi_");
    const now = new Date().toISOString();

    // Bulk delivery — hand the factory raw material, not tied to any order.
    // Always physically leaves shared Stock (there's nothing else it could
    // come from at this stage — no order to attach a Purchase to yet).
    if (issueMode === "bulkDelivery") {
      setIssuing(true);
      try {
        await decreaseStockSelfHealing({
          material: issueMaterial, companyId: issueCompany, purityOrQuality, quantity: qty,
          type: "issuance_out", refType: "materialIssuance", refId: issuanceId, createdBy: user!.id,
          note: `Bulk delivery to ${factory.name}`, ...diaLot,
        }, db.stockMovements);
        updateDb(d => {
          if (!d.materialIssuances) d.materialIssuances = [];
          d.materialIssuances.unshift({
            id: issuanceId, factoryId: id!, orderId: undefined, material: issueMaterial, ...coField(issueCompany),
            purityOrQuality, quantityIssued: qty, source: "stock",
            ...(diaLot.pieces ? { piecesIssued: diaLot.pieces } : {}),
            issuedAt: now, issuedBy: user!.id, status: "open",
            finishedPieces: [], makingCharges: { amountInr: 0, payments: [] },
            notes: issueNotes.trim() || undefined,
          });
        });
        toast.success(`${qty}${issueUnit} ${purityOrQuality} ${matWord(issueMaterial)} delivered to ${factory.name}'s pool`);
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
    // The order's company: its share of the pool, its stock.
    const orderCo = workCompanyOf(db, matchedOrder);
    const poolBalance = factoryPoolBalance(db.materialIssuances, id!, issueMaterial, purityOrQuality, orderCo);
    // A loose bag picked from a place says where it comes from; otherwise (gold,
    // another material) this factory's pool first, then the order's purchase, then stock.
    const picked = issueMaterial === "diamond" ? issueFrom : "";
    const eligiblePurchase = picked === "buy"
      ? eligiblePurchases.find(p => p.diamond?.kind !== "certified" && purchaseBucket(p) === purityOrQuality)
      : picked ? undefined : eligiblePurchases[0];
    if (picked === "pool" && poolBalance < qty) { toast.error(`${factory.name} holds only ${poolBalance} ct of this bag`); return; }
    if (picked === "buy" && !eligiblePurchase) { toast.error("That purchase is already used — choose again"); return; }
    const resolvedSource: "factoryPool" | "purchase" | "stock" =
      picked === "pool" ? "factoryPool" : picked === "buy" ? "purchase" : picked === "stock" ? "stock"
      : poolBalance >= qty ? "factoryPool" : eligiblePurchase ? "purchase" : "stock";

    setIssuing(true);
    try {
      // Only draws down shared Stock when sourced FROM stock — material bought
      // specifically for this order, or drawn from this factory's own pool,
      // never touches stockLevels (see MaterialIssuance.source in db.ts).
      if (resolvedSource === "stock") {
        await decreaseStockSelfHealing({
          material: issueMaterial, companyId: orderCo, purityOrQuality, quantity: qty,
          type: "issuance_out", refType: "materialIssuance", refId: issuanceId, createdBy: user!.id,
          note: `Used by ${factory.name} for order ${matchedOrder.orderNumber}`, ...diaLot,
        }, db.stockMovements);
      }
      updateDb(d => {
        if (!d.materialIssuances) d.materialIssuances = [];
        const issuance: MaterialIssuance = {
          id: issuanceId, factoryId: id!, orderId: matchedOrder.id, material: issueMaterial, ...coField(orderCo),
          purityOrQuality, quantityIssued: qty,
          ...(issueMaterial === "diamond" ? { diamondKind: "loose" as const } : {}),
          ...(diaLot.pieces ? { piecesIssued: diaLot.pieces } : {}),
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
            remarks: `${qty}${issueUnit} ${purityOrQuality} ${matWord(issueMaterial)} used at ${factory.name}${chargeAmount ? ` — making charge ${fmtMoneyInr(chargeAmount)}` : ""}`,
          });
        }
      });
      toast.success(`Recorded ${qty}${issueUnit} ${purityOrQuality} used${chargeAmount ? ` — ${fmtMoneyInr(chargeAmount)} charge` : ""}`);
      setShowIssueForm(false);
      resetIssueForm();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to save");
    } finally { setIssuing(false); }
  };

  // ── Per-issuance actions ──
  // "open" is kept apart from which issuance and action, so the panel still
  // shows its form while it slides away instead of emptying first.
  const [activeIssuance, setActiveIssuance] = useState<{ id: string; action: IssuanceAction; open: boolean }>({ id: "", action: null, open: false });
  const [pieceQty, setPieceQty] = useState("");
  const [pieceCount, setPieceCount] = useState("1");
  const [chargeAmount, setChargeAmount] = useState("");
  const [payAmount, setPayAmount] = useState("");
  const [payLockerId, setPayLockerId] = useState("");
  const [returnQty, setReturnQty] = useState("");
  const [returnNote, setReturnNote] = useState("");
  const [returnPcs, setReturnPcs] = useState("");
  // An order's loose stones: where the bag picked comes from — this factory's pool,
  // a purchase made for the order, or stock. The same bag can be in more than one.
  const [issueFrom, setIssueFrom] = useState<"" | "pool" | "buy" | "stock">("");
  const [returning, setReturning] = useState(false);
  const closeAction = () => setActiveIssuance(a => ({ ...a, open: false }));
  // Shown in the Pay panel's footer only; the save looks the locker up afresh.
  const payFromLocker = db.lockers.find(l => l.id === payLockerId);

  const openAction = (issuanceId: string, action: IssuanceAction) => {
    setActiveIssuance({ id: issuanceId, action, open: true });
    setPieceQty(""); setPieceCount("1"); setChargeAmount(""); setPayAmount(""); setPayLockerId("");
    setReturnQty(""); setReturnNote(""); setReturnPcs("");
  };

  const recordPiece = (issuance: MaterialIssuance) => {
    const w = Number(pieceQty);
    if (!w || w <= 0) { toast.error(`Enter the ${matWord(issuance.material)} quantity used`); return; }
    const u = materialUnit(db.settings, issuance.material);
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
          remarks: `${w}${materialUnit(db.settings, issuance.material)} used in finished piece(s)`,
        });
      }
    });
    toast.success("Finished piece recorded");
    closeAction();
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
    closeAction();
  };

  const payCharge = async (issuance: MaterialIssuance) => {
    const amt = Number(payAmount);
    if (!amt || amt <= 0) { toast.error("Enter a valid amount"); return; }
    if (!payLockerId) { toast.error("Choose which locker this payment came from"); return; }
    const payLocker = db.lockers.find(l => l.id === payLockerId);
    if (payLocker && amt > lockerBalance(payLocker, db.lockerTransactions) &&
        !(await confirmBox(`This payment of ${fmtLockerAmount(amt, payLocker.currency)} is more than ${payLocker.name}'s balance of ${fmtLockerAmount(lockerBalance(payLocker, db.lockerTransactions), payLocker.currency)}. The locker will go negative — continue only if a deposit is still missing.`))) return;
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
    closeAction();
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
        closeAction();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Failed to return packets");
      } finally { setReturning(false); }
      return;
    }

    const qty = Number(returnQty);
    const unit = materialUnit(db.settings, issuance.material);
    // A bulk delivery's own issuanceUsed is always 0 (orders draw against it
    // via separate factoryPool-sourced records, never its own finishedPieces)
    // — cap it at the true remaining pool balance instead, or this would let
    // you "return" material a different order already has committed.
    const maxReturnable = !issuance.orderId
      ? factoryPoolBalance(db.materialIssuances, issuance.factoryId, issuance.material, issuance.purityOrQuality, companyOf(issuance))
      : Math.round((issuance.quantityIssued - issuanceUsed(issuance)) * 100) / 100;
    if (!qty || qty <= 0) { toast.error(`Enter the ${matWord(issuance.material)} quantity to return`); return; }
    if (qty > maxReturnable) { toast.error(`Can't return more than the unused remainder (${maxReturnable}${unit})`); return; }
    const now = new Date().toISOString();
    setReturning(true);
    try {
      // Only material that CAME from stock goes back to stock. A purchase bought
      // for this order never entered stock, so returning it must not inflate the pool.
      if (issuance.source === "stock" || issuance.source === "melt") {
        await increaseStock({
          material: issuance.material, companyId: companyOf(issuance), purityOrQuality: issuance.purityOrQuality, quantity: qty,
          refType: "manual", createdBy: user!.id,
          // Loose stones go back into the bag they came out of, counted.
          ...(issuance.material === "diamond" && Number(returnPcs) > 0 ? { pieces: Math.round(Number(returnPcs)) } : {}),
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
            remarks: `${qty}${unit} ${matWord(issuance.material)} returned from ${factory.name}${returnNote.trim() ? ` — ${returnNote.trim()}` : ""}`,
          });
        }
      });
      toast.success(issuance.source === "stock" || issuance.source === "melt" ? `${qty}${unit} returned to stock`
        : issuance.source === "client" ? `${qty}${unit} returned — the client's own, held for them (not our stock)`
        : `${qty}${unit} returned (was bought for this order — not added to stock)`);
      closeAction();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to return material");
    } finally { setReturning(false); }
  };

  // Any unused material still sitting against an issuance being closed goes
  // back to Stock automatically — nothing is silently lost to "wastage" that
  // was actually just never consumed. Worked out in one place so the Close
  // panel, which says what will happen, and the close itself cannot disagree.
  const closePlan = (issuance: MaterialIssuance) => {
    // A bulk delivery (no orderId) never gets its own finishedPieces — orders
    // draw against it as separate factoryPool-sourced records instead, so
    // issuanceWastage(issuance) here is always the FULL original delivery,
    // ignoring anything already drawn. The true leftover is whatever's still
    // undrawn in the pool right now — using the naive wastage would return
    // the whole original amount to stock even after part of it was already
    // legitimately committed to an order, conjuring phantom gold into Stock.
    const leftover = !issuance.orderId
      ? factoryPoolBalance(db.materialIssuances, issuance.factoryId, issuance.material, issuance.purityOrQuality, companyOf(issuance))
      : Math.round(issuanceWastage(issuance) * 100) / 100;
    // Only stock-sourced, non-certified leftovers return to shared Stock.
    // Certified packets are discrete; purchase-sourced material was never
    // in stock. A factoryPool draw has nothing to return to Stock either —
    // shrinking its quantityIssued below (releasesToPool) gives the leftover
    // straight back to the factory's own pool instead.
    const returnsToStock = leftover > 0 && issuance.diamondKind !== "certified" && issuance.source === "stock";
    const releasesToPool = leftover > 0 && issuance.source === "factoryPool";
    return { leftover, returnsToStock, releasesToPool };
  };

  const closeIssuance = async (issuance: MaterialIssuance) => {
    const { leftover, returnsToStock, releasesToPool } = closePlan(issuance);
    const unit = materialUnit(db.settings, issuance.material);
    const now = new Date().toISOString();
    try {
      if (returnsToStock) {
        await increaseStock({
          material: issuance.material, companyId: companyOf(issuance), purityOrQuality: issuance.purityOrQuality, quantity: leftover,
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
      closeAction();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to close issuance");
    }
  };

  // ── Correcting or cancelling one issue ──
  // Everything that can be done to an issue is in its ⋯ menu; what can't be
  // done is greyed out with the reason — the purchase it came from, the payment
  // to cancel first — instead of hidden.
  const cancelIssuance = async (mi: MaterialIssuance) => {
    const unit = materialUnit(db.settings, mi.material);
    if (!(await confirmBox([
      `Cancel this issue of ${mi.quantityIssued}${unit} ${mi.purityOrQuality}?`,
      "",
      ...issuanceVoidImpact(db, mi),
      "",
      "This cannot be undone.",
    ].join("\n")))) return;
    try {
      await deleteIssuance(db, mi, user!.id);
      toast.success(isPoolDraw(mi) ? "Issue cancelled — back in the factory's pool" : "Issue cancelled — material returned to stock");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't cancel this.");
    }
  };

  const ADMIN_ONLY = "Only an admin can change what was issued to a factory";
  const issuanceActions = (mi: MaterialIssuance): MoreAction[] => {
    const order = db.orders.find(o => o.id === (mi.orderId ?? mi.meltOf));
    const purchase = mi.source === "purchase" ? db.purchases.find(p => p.id === mi.sourcePurchaseId) : undefined;
    const supplierName = purchase ? db.suppliers.find(s => s.id === purchase.supplierId)?.name : undefined;
    const edit = canEditIssuance(db, mi);
    const cancel = canCancelIssuance(db, mi);
    const certified = mi.diamondKind === "certified";
    return [
      // The day-to-day steps that are not the card's own buttons (the card shows
      // at most two: Finished piece, and Set charge — or Pay while some is owed).
      { label: "Set charge", icon: Coins, show: isAdmin && !!mi.orderId && mi.makingCharges.amountInr > 0 && issuancePending(mi) > 0,
        hint: "Change the making charge", onSelect: () => openAction(mi.id, "charge") },
      { label: "Return material", icon: Undo2, show: isAdmin && mi.status === "open",
        hint: "What the factory gives back unused", onSelect: () => openAction(mi.id, "return") },
      { label: "Close issuance", icon: Archive, show: isAdmin && mi.status === "open",
        hint: "Settle it — wastage is worked out", onSelect: () => openAction(mi.id, "close") },
      { label: "View order", icon: ExternalLink, show: !!order, disabled: !can("orders"),
        hint: can("orders") ? `${mi.source === "melt" ? "The melted piece" : "Order"} ${order?.orderNumber ?? ""}`.trim() : needsAccess("orders", "view"),
        onSelect: () => navigate(`/orders/${order!.id}`) },
      { label: "View purchase", icon: ExternalLink, show: !!purchase, disabled: !can("suppliers"),
        hint: can("suppliers") ? `On ${supplierName ?? "the supplier"}'s page${purchase?.invoiceNumber ? ` · bill ${purchase.invoiceNumber}` : ""}` : needsAccess("suppliers", "view"),
        onSelect: () => navigate(`/suppliers/${purchase!.supplierId}`) },
      { label: "Edit issuance", icon: Pencil, onSelect: () => setEditingIssuance(mi), disabled: !isAdmin || !edit.ok,
        hint: !isAdmin ? ADMIN_ONLY : !edit.ok ? edit.reason
          : certified ? "Charge and note only" : "Quantity, purity or shape, charge, note" },
      // Not offered as working actions, and said why: none of these left a
      // record that can be reversed exactly, so doing it here would guess.
      { label: "Edit finished pieces", icon: Lock, show: !!mi.orderId, disabled: true, onSelect: () => {},
        hint: mi.status === "closed"
          ? "Settled when it was closed"
          : "Use Edit issuance instead" },
      { label: "Re-open issuance", icon: RotateCcw, show: mi.status === "closed", disabled: true, onSelect: () => {},
        hint: "Can't be reversed exactly — issue again" },
      { label: "Undo a return", icon: Undo2, show: !(mi.source === "melt" && mi.quantityIssued === 0), disabled: true, onSelect: () => {},
        hint: "Can't be undone exactly — issue again" },
      { label: "Cancel issuance", icon: Trash2, danger: true, onSelect: () => cancelIssuance(mi), disabled: !isAdmin || !cancel.ok,
        hint: !isAdmin ? ADMIN_ONLY : !cancel.ok ? cancel.reason
          : isPoolDraw(mi) ? "It goes back into the factory's pool"
          : certified ? "The stones go back into stock" : "The material goes back into stock" },
    ];
  };

  // ── The factory itself ──
  const deleteGuard = factoryDeleteGuard(db, factory);
  const deleteFactory = async () => {
    const refused = await deleteRefusal("factory", factory);
    if (refused) { toast.error(refused); return; }
    if (!(await confirmBox(`Delete ${factory.name}?\n\nIt has no material issued, no payments and no order assigned, so no other record changes. This cannot be undone.`))) return;
    let gone = false;
    updateDb(d => {
      // Counted again on the live records, as the question may have sat open.
      const live = d.factories.find(x => x.id === factory.id);
      if (!live || !factoryDeleteGuard(d, live).ok) return;
      d.factories = d.factories.filter(x => x.id !== factory.id);
      gone = true;
    });
    if (!gone) { toast.error("Could not delete — something was recorded for it meanwhile"); return; }
    toast.success("Factory deleted");
    navigate("/factories");
  };

  const orderRows = buildFactoryOrderRows(issuances, db.orders, db.settings);

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

  type UniRow = { id: string; date: string; ref: string; particular: string; drGold: number; drSilver: number; drDia: number; drOther: number; drAmount: number; crGold: number; crSilver: number; crDia: number; crOther: number; crAmount: number; otherLabel?: string;
    /** A material other than gold or diamond (Settings → Materials), in its own unit. */
    mat?: { key: string; label: string; dr: number; cr: number } };
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
      const melted = mi.source === "melt" ? db.orders.find(o => o.id === mi.meltOf) : undefined;
      const ref = order?.orderNumber || melted?.orderNumber || (mi.source === "factoryPool" ? "Pool" : "");
      // Gold given to the factory (fine 24KT, matching the "Fine Gold at Factory" card).
      if (mi.material === "gold" && mi.source !== "factoryPool" && !(mi.source === "melt" && mi.quantityIssued === 0)) {
        rows.push({ ...zero(), id: mi.id + "-gin", date: mi.issuedAt, ref, particular: mi.source === "melt" ? `Melted piece back to the factory — ${mi.quantityIssued}g ${mi.purityOrQuality}`
          : mi.source === "client" ? `Client's gold — ${mi.quantityIssued}g ${mi.purityOrQuality}${mi.forOrderId ? ` for ${db.orders.find(o => o.id === mi.forOrderId)?.orderNumber ?? "an order"}` : ""}`
          : `Gold issued — ${mi.quantityIssued}g ${mi.purityOrQuality}`, drGold: toPureGold(mi.quantityIssued, mi.purityOrQuality) });
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
      // Counted by the same rule as the Factory Account card (diamondFlow): a
      // pool draw is not new stones, and a received piece's stones are
      // accounted for before the issue closes.
      if (mi.material === "diamond") {
        const flow = diamondFlow(mi);
        if (flow.out > 0) rows.push({ ...zero(), id: mi.id + "-din", date: mi.issuedAt, ref, particular: `Diamond issued — ${mi.quantityIssued}ct ${mi.diamondKind === "certified" ? "certified" : mi.purityOrQuality}${mi.piecesIssued ? ` · ${mi.piecesIssued} pcs` : ""}`, drDia: flow.out });
        if (mi.source === "factoryPool" || mi.status !== "closed") {
          if (flow.in > 0) rows.push({ ...zero(), id: mi.id + "-dused", date: mi.issuedAt, ref, particular: mi.source === "factoryPool" ? "Diamond from the factory's pool set in piece" : "Diamond set in received piece", crDia: flow.in });
        } else {
          const returned = mi.diamondKind === "certified" ? (mi.finishDisposition === "returned" ? mi.quantityIssued : 0) : (mi.finishReturnedCt || 0);
          const used = Math.round((mi.quantityIssued - returned) * 1000) / 1000;
          if (used > 0) rows.push({ ...zero(), id: mi.id + "-dused", date: mi.issuedAt, ref, particular: `Diamond used in piece`, crDia: used });
          if (returned > 0) rows.push({ ...zero(), id: mi.id + "-dret", date: mi.issuedAt, ref, particular: `Diamond returned to stock`, crDia: returned });
        }
      }
      // Any other material — given, then used in the piece or sent back, in its own unit.
      if (isOtherMaterial(mi.material)) {
        const flow = otherFlow(mi);
        const name = materialName(db.settings, mi.material), u = materialUnit(db.settings, mi.material);
        const label = `${name} (${u})`;
        if (flow.out > 0) rows.push({ ...zero(), id: mi.id + "-xin", date: mi.issuedAt, ref, particular: `${name} issued — ${mi.quantityIssued}${u} ${mi.purityOrQuality}`, mat: { key: mi.material, label, dr: flow.out, cr: 0 } });
        // What it has accounted for is what went into the piece plus what came back.
        const returned = Math.min(mi.finishReturnedQty || 0, flow.in);
        const used = Math.max(0, Math.round((flow.in - returned) * 1000) / 1000);
        if (used > 0) rows.push({ ...zero(), id: mi.id + "-xused", date: mi.issuedAt, ref, particular: `${name} used in piece`, mat: { key: mi.material, label, dr: 0, cr: used } });
        if (returned > 0) rows.push({ ...zero(), id: mi.id + "-xret", date: mi.issuedAt, ref, particular: `${name} returned to stock`, mat: { key: mi.material, label, dr: 0, cr: returned } });
      }
      // Making charges billed (credit) and payments made (debit).
      if (mi.makingCharges.amountInr > 0) {
        const unit = materialUnit(db.settings, mi.material);
        rows.push({ ...zero(), id: mi.id + "-chg", date: mi.issuedAt, ref, particular: mi.source === "melt" ? `Melting / refining charge` : `Making charges — ${mi.quantityIssued}${unit} ${mi.purityOrQuality}`, crAmount: mi.makingCharges.amountInr });
      }
    }
    // Payments are shown as they were made, not as they were split across jobs.
    for (const g of groupPaymentsAsMade(
      iss.flatMap(mi => (mi.makingCharges.payments || []).map(pay => ({
        pay, label: db.orders.find(o => o.id === mi.orderId)?.orderNumber,
      }))),
    )) {
      const jobs = g.labels.join(", ");
      rows.push({
        ...zero(), id: g.ids[0], date: g.at, ref: g.labels.length === 1 ? g.labels[0] ?? "" : jobs,
        particular: `Payment${jobs ? ` — ${jobs}` : ""}${g.note ? ` · ${g.note}` : ""}`,
        drAmount: g.amountInr,
      });
    }
    // Advances and loans — money out against no particular job. Without these
    // the statement would not add up to the balance shown above it.
    for (const a of advances) {
      rows.push({ ...zero(), id: a.id, date: a.createdAt, ref: "", particular: `Advance / loan paid${a.note ? ` — ${a.note}` : ""}`, drAmount: a.amountInr });
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
      if (r.mat && (r.mat.dr || r.mat.cr)) {
        running[r.mat.key] = Math.round(((running[r.mat.key] || 0) + r.mat.dr - r.mat.cr) * 1000) / 1000;
        out.push({ id: `${r.id}-${r.mat.key}`, date: r.date, ref: r.ref, particular: r.particular, material: r.mat.label, out: r.mat.dr, in: r.mat.cr, balance: running[r.mat.key] });
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
    buildFactoryOrderRows(issuancesForOrder(orderNo), db.orders, db.settings)
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
      { header: "Net wt / Design", w: 26, right: true },
      ...(hasGold ? [
        { header: "Gold given", w: 20, right: true },
        { header: "In piece", w: 20, right: true },
        { header: "Balance", w: 20, right: true },
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
        `Report Generated: ${new Date().toLocaleDateString("en-IN", { month: "long", day: "numeric", year: "numeric" })}`,
      ].filter(Boolean),
      summary: [
        { label: (factory.openingFineGold || 0) + T.goldOut - T.goldIn < 0 ? "Gold we owe the factory" : "Gold still at factory", value: `${q3(Math.abs((factory.openingFineGold || 0) + T.goldOut - T.goldIn))} g fine` },
        { label: "Diamond not accounted", value: `${q3(T.diaOut - T.diaIn)} ct` },
        { label: "Labour billed", value: fmtInrPlain(T.labour) },
        // The whole account (opening balance and advances in) when nothing is
        // filtered — the same figure the page shows. Filtered: these rows only.
        { label: from || to || orderNo ? "Pending on these rows" : "Labour pending", value: fmtInrPlain(from || to || orderNo ? Math.max(0, T.labour - T.paid) : account.chargesPending) },
      ],
      landscape: true,
      columns,
      align,
      rows: rows.map(r => [
        r.orderNo, fmtDate(r.date), fit([r.jewellery, r.metalNote].filter(Boolean).join(" · "), 40 * scale),
        fit([r.netWeight ? `${r.netEstimated ? "~" : ""}${r.netWeight.toFixed(3)}` : "", r.designNo ? `#${r.designNo}` : ""].filter(Boolean).join(" · "), 26 * scale),
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
        (() => { const t = rows.reduce((s, r) => s + (r.netEstimated ? 0 : r.netWeight), 0); return t ? t.toFixed(3) : ""; })(),
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
      ["Order", "Date", "Item", "Net weight (g)", "Design number", "Gold given by us (g fine)", "Gold in the piece (g fine)", "Gold balance (g fine)",
       "Diamond issued (ct)", "Diamond accounted (ct)", "Diamond open (ct)", "Silver (g)", "Other metal (g)",
       "Labour billed (INR)", "Labour paid (INR)", "Labour pending (INR)", "Quoted (USD)", "Estimated?", "Status"],
      rows.map(r => [
        r.orderNo, fmtDate(r.date), r.jewellery,
        r.netWeight ? `${r.netEstimated ? "~" : ""}${r.netWeight.toFixed(3)}` : "", r.designNo ?? "",
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
    // Advances settle the factory's account as a whole, not one order.
    const acct = factoryAccount(iss, orderNo ? undefined : factory, orderNo ? [] : advances);
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
        `Report Generated: ${new Date().toLocaleDateString("en-IN", { month: "long", day: "numeric", year: "numeric" })}`,
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
      {/* The name row: issuing material is what people come here to do; the
          company switch decides what the whole page shows; the rest waits in
          the ⋯. */}
      <PageHeader
        back={{ label: "Back to Factories", to: "/factories" }}
        title={factory.name}
        subtitle={factory.contactPerson || undefined}
        actions={<CompanyFilter value={coView} onChange={setCoView} className="h-10 rounded-xl text-sm w-40 sm:w-48 min-w-0" />}
        primary={user?.role === "admin" ? { label: "Issue Material", icon: Plus, onClick: () => setShowIssueForm(true) } : null}
        menu={[
          { label: "Move between companies", icon: ArrowRightLeft, hint: "Gold or diamonds, company to company", onSelect: () => setMovingPool(true), show: multiCo && user?.role === "admin" },
          { label: "Export ledger", icon: Download, hint: "Ledger or movement sheet", onSelect: () => setShowExport(true), show: mayExport },
          { label: "Edit details", icon: Pencil, onSelect: () => setEditingFactory(factory), disabled: !isAdmin,
            hint: isAdmin ? "Name, contact, phone, address" : "Only an admin can change factories" },
          { label: "Delete factory", icon: Trash2, danger: true, onSelect: deleteFactory, disabled: !isAdmin || !deleteGuard.ok,
            hint: !isAdmin ? "Only an admin can change factories" : deleteGuard.reason },
        ]}
      />

      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="card-luxe p-5 sm:p-6">
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm min-w-0">
          <div className="flex items-start gap-2 min-w-0"><Phone className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" /><div className="min-w-0"><p className="text-xs text-muted-foreground">Phone</p><p className="font-medium break-words">{factory.phone || "—"}</p></div></div>
          {factory.address && <div className="flex items-start gap-2 min-w-0"><MapPin className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" /><div className="min-w-0"><p className="text-xs text-muted-foreground">Address</p><p className="font-medium break-words">{factory.address}</p></div></div>}
        </div>
      </motion.div>
      <ExportDialog open={showExport} onClose={() => setShowExport(false)} title={`${factory.name} ledger`}
        extraFilter={{ label: "Order number", placeholder: "e.g. SLJ-2026-1042 (optional)", hint: "Leave blank for the whole factory." }}
        options={[
          { label: "Factory Ledger — PDF", sublabel: "Gold, diamond, metal and labour, by order", kind: "pdf", run: exportOrdersPdf },
          { label: "Factory Ledger — Excel", sublabel: "Gold, diamond, metal and labour, by order", kind: "excel", run: exportOrdersCsv },
          { label: "Movement Sheet — PDF", sublabel: "Every issue and return, line by line", kind: "pdf", run: exportCombinedPdf },
          { label: "Movement Sheet — Excel", sublabel: "Every issue and return, line by line", kind: "excel", run: exportCombinedCsv },
        ]} />

      {/* What is with the factory, then its labour account — the company
          picked in the header decides both. */}
      <div className="card-luxe p-5 space-y-3">
        <SectionTitle title="Factory Account" sub={view !== "all" ? companyById(db.settings, view).name : undefined} className="mb-1" />
        <StatStrip items={[
          { label: "Fine gold (24KT)", value: `${factoryFineGoldBalance(db.materialIssuances, id!, factory.openingFineGold, view).toLocaleString()} g`, icon: Coins, sub: "At the factory" },
          { label: "Diamond", value: `${account.diamondOutstanding > 0 ? "+" : ""}${account.diamondOutstanding.toLocaleString()} ct`, icon: Gem,
            tone: account.diamondOutstanding < 0 ? "out" : undefined, sub: "Net, given less used" },
          ...Object.entries(factoryOtherBalances(db.materialIssuances, id!, view)).map(([k, q]) => ({
            label: materialName(db.settings, k), value: `${q.toLocaleString()} ${materialUnit(db.settings, k)}`, icon: Package,
            tone: q < 0 ? "out" as const : undefined, sub: "At the factory" })),
        ]} />
        <StatStrip items={[
          { label: "Charges pending", value: account.chargesPending > 0 ? fmtMoneyInr(account.chargesPending) : "✓ Cleared",
            tone: account.chargesPending > 0 ? "out" : "in", icon: Coins, sub: "Still to pay" },
          { label: "Total charges", value: fmtMoneyInr(account.chargesTotal), icon: Receipt, sub: "Labour billed" },
          { label: "Charges paid", value: fmtMoneyInr(account.chargesPaid), tone: "in", icon: CreditCard },
          { label: "Charges overpaid", value: fmtMoneyInr(account.chargesOverpaid), icon: Wallet, sub: "Held by the factory" },
        ]} />
      </div>

      {/* Opening balance (migration) — admin only */}
      {user?.role === "admin" && (
        <div className="card-luxe p-5">
          <SectionTitle title="Opening Balance"
            sub={hasOpeningBalance(factory) || factory.openingFineGold
              ? [
                  hasOpeningBalance(factory) ? `${fmtMoneyInr(Math.abs(factory.openingBalance!))} ${factory.openingDir === "credit" ? "we owe" : "owed to us"}` : "",
                  factory.openingFineGold ? `${factory.openingFineGold}g fine gold` : "",
                ].filter(Boolean).join(" · ")
              : "Not set"}
            info="Balances carried in from your previous system."
            actions={<button type="button" onClick={() => setObOpen(v => !v)} aria-expanded={obOpen} className="text-sm text-primary font-medium hover:underline">{obOpen ? "Close" : "Edit"}</button>} />
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
              hint="Unpaid making charges when you started (₹)."
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
      {movingPool && <FactoryPoolTransferDialog factoryId={id!} onClose={() => setMovingPool(false)} />}
      <FactoryEditDialog factory={editingFactory} onClose={() => setEditingFactory(null)} />
      <IssuanceEditSheet issuance={editingIssuance} onClose={() => setEditingIssuance(null)} />
      {/* ONE ledger for this factory: gold given and used, diamond given and
          used, the other metals, and the labour billed, paid and pending — all
          on the same row as the order they belong to. It replaced a separate
          account statement, gold ledger, diamond ledger and movement sheet,
          which meant four tables to cross-reference for one job. */}
      <FactoryOrderLedger
        rows={orderRows}
        factoryName={factory.name}
        // The opening fine gold is the first company's (as on the account card
        // above — factoryFineGoldBalance): another company's view leaves it out.
        openingFineGold={firstCo ? factory.openingFineGold || 0 : 0}
        account={account}
        onExport={() => setShowExport(true)}
      />


      <div className="space-y-3">
        <SectionTitle title="Material Issuances" sub={issuances.length ? `${issuances.length} issue${issuances.length !== 1 ? "s" : ""}` : undefined} className="px-1" />
        {issuances.map(mi => {
          const order = db.orders.find(o => o.id === mi.orderId);
          const used = issuanceUsed(mi);
          const wastage = issuanceWastage(mi);
          const pending = issuancePending(mi);
          const unit = materialUnit(db.settings, mi.material);

          return (
            <div key={mi.id} className="card-luxe p-4">
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-x-2 gap-y-1.5 flex-wrap">
                    <p className="font-semibold text-[15px] min-w-0">
                      {mi.orderId ? (order ? <Link to={`/orders/${order.id}`} className="inline-block py-2.5 -my-2.5 text-primary hover:underline">{order.orderNumber}</Link> : "Unknown order") : mi.source === "melt" ? (
                        <span className="inline-flex items-center gap-1 text-muted-foreground">Melted {(() => { const mo = db.orders.find(o => o.id === mi.meltOf); return mo ? <Link to={`/orders/${mo.id}`} className="inline-block py-2.5 -my-2.5 text-primary hover:underline">{mo.orderNumber}</Link> : "piece"; })()} — {mi.quantityIssued > 0 ? "back in the factory's pool" : "melting charge"}</span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-muted-foreground"><Truck className="h-3.5 w-3.5" /> Bulk delivery (factory pool)</span>
                      )}
                    </p>
                    <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${mi.status === "open" ? "bg-violet-50 text-violet-800" : "bg-secondary text-muted-foreground"}`}>{mi.status === "open" ? "In progress" : "Closed"}</span>
                    {mi.source === "purchase" && <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-primary/10 text-primary">Direct purchase</span>}
                    {mi.source === "factoryPool" && <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-orange-500/10 text-orange-700">From factory pool</span>}
                    {mi.source === "transfer" && <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-primary/10 text-primary">Moved from another company</span>}
                    {mi.source === "client" && <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-700">Client's · {db.clients.find(c => c.id === mi.clientId)?.companyName ?? "client"}</span>}
                    {view === "all" && <CompanyBadge id={companyOf(mi)} />}
                  </div>
                  {mi.source === "melt" && mi.quantityIssued === 0 ? (
                    <p className="text-sm text-muted-foreground mt-1.5 flex items-start gap-1.5">
                      <Coins className="h-3.5 w-3.5 mt-[3px] shrink-0" /> Charge only, {fmtDate(mi.issuedAt)} — the gold did not stay with this factory
                    </p>
                  ) : (
                  <p className="text-sm text-muted-foreground mt-1.5 flex items-start gap-1.5">
                    {mi.material === "gold" ? <Coins className="h-3.5 w-3.5 mt-[3px] shrink-0" /> : <Gem className="h-3.5 w-3.5 mt-[3px] shrink-0" />}
                    <span>
                      {mi.quantityIssued}{unit} {mi.purityOrQuality}{isOtherMaterial(mi.material) ? ` ${materialName(db.settings, mi.material)}` : ""} issued {fmtDate(mi.issuedAt)} · {used}{unit} used
                      {mi.status === "closed" && wastage !== 0 ? (wastage > 0 ? ` · ${wastage}${unit} wastage` : ` · ${Math.abs(wastage)}${unit} over-used`) : ""}
                    </span>
                  </p>
                  )}
                </div>
                <MoreMenu size="sm" label="Issuance actions" title="This issue" actions={issuanceActions(mi)} className="-mr-1.5 -mt-1.5" />
              </div>

              {/* The making charge, and the next step — two light text buttons at
                  most; Return and Close are in the ⋯ menu. */}
              <div className="mt-3 pt-3 border-t border-border/60 flex items-center justify-between gap-x-4 gap-y-2 flex-wrap">
                <div className="min-w-0">
                  <p className="text-xs text-muted-foreground">Making charge</p>
                  <p className="mt-0.5 text-[15px] font-semibold tabular-nums whitespace-nowrap">
                    {mi.makingCharges.amountInr > 0 ? fmtMoneyInr(mi.makingCharges.amountInr) : <span className="font-medium text-muted-foreground">Not set</span>}
                    {mi.makingCharges.amountInr > 0 && (
                      <span className={`ml-2 text-xs font-medium ${pending > 0 ? "text-destructive" : "text-success"}`}>{pending > 0 ? `${fmtMoneyInr(pending)} pending` : "Paid"}</span>
                    )}
                  </p>
                </div>
                {user?.role === "admin" && (
                  <div className="flex flex-wrap items-center gap-1 -mr-2">
                    {mi.orderId && (
                      <>
                        {used < mi.quantityIssued - 0.001 && (
                          <button type="button" onClick={() => openAction(mi.id, "piece")} className={ISSUE_ACTION}><CheckCircle2 className="h-4 w-4" />Finished piece</button>
                        )}
                        {mi.makingCharges.amountInr > 0 && pending > 0
                          ? <button type="button" onClick={() => openAction(mi.id, "pay")} className={ISSUE_ACTION}><CreditCard className="h-4 w-4" />Pay</button>
                          : <button type="button" onClick={() => openAction(mi.id, "charge")} className={ISSUE_ACTION}><Coins className="h-4 w-4" />Set charge</button>}
                      </>
                    )}
                  </div>
                )}
              </div>
            </div>
          );
        })}
        {issuances.length === 0 && <div className="card-luxe p-12 text-center text-muted-foreground">No material issuances yet.</div>}
      </div>

      {/* Issuing material is a panel, so the account and the ledger behind stay
          where they were. Closing it keeps what was typed; Cancel clears it,
          exactly as the inline form did. */}
      <ActionSheet
        open={showIssueForm}
        onOpenChange={setShowIssueForm}
        title="Issue Material"
        description={<>To {factory.name} · for an order, or into its pool</>}
        icon={ArrowUpCircle}
        size="lg"
        footer={
          <PanelFooter
            label={issueMode === "bulkDelivery" ? "Delivering to the pool"
              : matchedOrder ? `Used for ${matchedOrder.orderNumber}`
              : issueOrderNumber.trim() ? "No order with that number yet" : "Used for an order"}
            value={Number(issueQuantity) > 0
              ? [`${Number(issueQuantity)}${issueUnit}`, issueMaterial === "gold" ? issuePurity : isOtherMaterial(issueMaterial) ? issueGrade.trim() : (issueQuality || "—"), matWord(issueMaterial)].filter(Boolean).join(" ")
              : "—"}
            sub={issueMode === "orderConsumption" && Number(issueChargeAmount) > 0 ? `Making charge ${fmtMoneyInr(Number(issueChargeAmount))}` : undefined}
          >
            <Button variant="outline" onClick={() => { setShowIssueForm(false); resetIssueForm(); }} className="rounded-xl h-10">Cancel</Button>
            <AsyncButton onClick={issueMaterialToFactory} disabled={issuing} className="btn-hero rounded-xl h-10">
              {issuing ? "Saving…" : issueMode === "bulkDelivery" ? "Record Delivery" : "Save Usage & Charge"}
            </AsyncButton>
          </PanelFooter>
        }
      >
        <div className="space-y-3">
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
              ? "Material for no order yet — it builds up their pool."
              : "What they used for one order, and the charge."}
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            {issueMode === "orderConsumption" && (
              <Input value={issueOrderNumber} onChange={e => setIssueOrderNumber(e.target.value)} autoFocus className="rounded-xl h-10" placeholder="Order number" />
            )}
            <Select value={issueMaterial} onValueChange={v => { setIssueMaterial(v as MaterialKey); setIssueGrade(""); }}>
              <SelectTrigger className="h-10 rounded-xl" aria-label="Material"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="gold">Gold</SelectItem><SelectItem value="diamond">Diamond</SelectItem>
                {otherMaterials.map(m => <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          {isOtherMaterial(issueMaterial) ? (
            <GradeInput material={issueMaterial} value={issueGrade} onChange={setIssueGrade} />
          ) : issueMaterial === "gold" ? (
            <Select value={issuePurity} onValueChange={setIssuePurity}>
              <SelectTrigger className="h-10 rounded-xl"><SelectValue /></SelectTrigger>
              <SelectContent>{GOLD_PURITIES.map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}</SelectContent>
            </Select>
          ) : (
            // A loose-diamond lot, and how many stones. A delivery comes out of stock;
            // an order's stones come from this factory's pool first, then a purchase
            // made for the order, then stock — so all three are offered for an order.
            <div className="grid grid-cols-[minmax(0,1fr)_6rem] gap-2">
              {issueMode === "bulkDelivery" || !matchedOrder ? (
                <LotPicker value={issueQuality} onChange={setIssueQuality} companyId={issueCompany} />
              ) : (() => {
                const co = workCompanyOf(db, matchedOrder);
                const poolKeys = [...new Set(db.materialIssuances.filter(i => i.factoryId === id && i.material === "diamond" && !i.orderId && i.diamondKind !== "certified").map(i => i.purityOrQuality))];
                const pool = poolKeys.map(k => ({ k, ct: factoryPoolBalance(db.materialIssuances, id!, "diamond", k, co) })).filter(x => x.ct > 0);
                const bought = eligiblePurchases.filter(p => p.diamond?.kind !== "certified").map(p => purchaseBucket(p));
                const stock = lotBalances(db.stockMovements ?? [], co).filter(l => l.ct > 0);
                // Each option carries where it comes from as well as the bag.
                const bagOf = (k: string) => (bagNoOf(db, k) ? `${bagNoOf(db, k)} · ` : "");
                const item = (from: "pool" | "buy" | "stock", k: string, text: string) => <SelectItem key={`${from}|${k}`} value={`${from}|${k}`}>{text}</SelectItem>;
                return (
                  <Select value={issueQuality ? `${issueFrom}|${issueQuality}` : ""}
                    onValueChange={v => { const at = v.indexOf("|"); setIssueFrom(v.slice(0, at) as "pool" | "buy" | "stock"); setIssueQuality(v.slice(at + 1)); }}>
                    <SelectTrigger className="h-10 rounded-xl"><SelectValue placeholder="Choose the lot" /></SelectTrigger>
                    <SelectContent className="max-h-80">
                      {pool.map(x => item("pool", x.k, `At ${factory.name}: ${bagOf(x.k)}${lotLabel(x.k)} — ${x.ct} ct`))}
                      {[...new Set(bought)].map(k => item("buy", k, `Bought for this order: ${bagOf(k)}${lotLabel(k)}`))}
                      {stock.map(l => item("stock", l.key, `In stock: ${bagOf(l.key)}${lotLabel(l.key)} — ${lotStockText(l, null)}`))}
                    </SelectContent>
                  </Select>
                );
              })()}
              <Input type="number" min={0} step="1" value={issuePcs} onChange={e => setIssuePcs(e.target.value)} className="h-10 rounded-xl" placeholder="Pcs" aria-label="Pieces" />
            </div>
          )}

          <Input
            type="number" min={0} value={issueQuantity} onChange={e => setIssueQuantity(e.target.value)}
            className="rounded-xl h-10" placeholder={issueMaterial === "gold" ? (issueMode === "bulkDelivery" ? "Weight (g)" : "Weight used (g)") : issueMaterial === "diamond" ? (issueMode === "bulkDelivery" ? "Carat" : "Carat used") : `${issueMode === "bulkDelivery" ? "Quantity" : "Quantity used"} (${issueUnit})`}
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
            <>
              <CompanyPicker value={issueCompany} onChange={setIssueCompany} label="Company — whose stock it leaves, whose share of the pool it joins" />
              <Input value={issueNotes} onChange={e => setIssueNotes(e.target.value)} className="rounded-xl h-10" placeholder="Notes (optional)" />
            </>
          )}
          {issueMode === "orderConsumption" && multiCo && matchedOrder && (
            <p className="text-[11px] text-muted-foreground">For {companyById(db.settings, workCompanyOf(db, matchedOrder)).name} — {matchedOrder.orderNumber}&rsquo;s company: its share of the pool, then its stock.</p>
          )}

          {issueMode === "orderConsumption" && issueMaterial === "gold" && matchedOrder && orderMaterialRequirements(matchedOrder).needsGold && (() => {
            const balance = factoryPoolBalance(db.materialIssuances, id!, "gold", issuePurity, workCompanyOf(db, matchedOrder));
            const estimate = estimatedPureGoldNeeded(matchedOrder);
            if (estimate <= 0 || balance >= estimate) return null;
            return (
              <div className="flex items-start gap-2 p-2.5 rounded-xl bg-destructive/5 text-destructive text-xs">
                <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                <span>This factory's pool only has {balance}g of {issuePurity} — {matchedOrder.orderNumber} ({matchedOrder.productKarats || "?"}) is estimated to need ~{estimate}g of pure gold. The rest will come from company stock.</span>
              </div>
            );
          })()}
        </div>
      </ActionSheet>

      {(() => {
        // One panel for the actions on an issuance card — finished piece, charge,
        // pay, return, close — titled for the job it belongs to. It reads the
        // issuance afresh, so it always works on what is saved now.
        const mi = db.materialIssuances.find(x => x.id === activeIssuance.id);
        const action = activeIssuance.action;
        if (!mi || !action) return null;
        const order = db.orders.find(o => o.id === mi.orderId);
        const unit = materialUnit(db.settings, mi.material);
        const used = issuanceUsed(mi);
        const pending = issuancePending(mi);
        const remainder = Math.round((mi.quantityIssued - used) * 100) / 100;
        const ref = mi.orderId ? (order?.orderNumber ?? "Unknown order")
          : mi.source === "melt" ? `Melted ${db.orders.find(o => o.id === mi.meltOf)?.orderNumber ?? "piece"}`
          : "Bulk delivery";
        const summary = `${mi.quantityIssued}${unit} ${mi.purityOrQuality}${isOtherMaterial(mi.material) ? ` ${materialName(db.settings, mi.material)}` : ""} issued ${fmtDate(mi.issuedAt)} · ${used}${unit} used`;
        const packets = (mi.diamondPacketIds || []).length;
        const head = {
          piece: { title: `Finished piece — ${ref}`, icon: CheckCircle2 },
          charge: { title: `Set making charge — ${ref}`, icon: Coins },
          pay: { title: `Pay making charge — ${ref}`, icon: CreditCard },
          return: { title: `Return material — ${ref}`, icon: Undo2 },
          close: { title: `Close issuance — ${ref}`, icon: Archive },
        }[action];
        const cancel = <Button variant="outline" onClick={closeAction} className="rounded-xl h-10">Cancel</Button>;

        let footer: ReactNode;
        let body: ReactNode;
        if (action === "piece") {
          footer = (
            <PanelFooter label="Still unused" value={`${remainder}${unit}`}>
              {cancel}
              <AsyncButton onClick={() => recordPiece(mi)} className="btn-hero rounded-xl h-10">Save</AsyncButton>
            </PanelFooter>
          );
          body = (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <Input type="number" min={0} value={pieceQty} onChange={e => setPieceQty(e.target.value)} autoFocus className="rounded-xl h-10" placeholder={`${materialName(db.settings, mi.material)} used (${unit})`} />
              <Input type="number" min={1} value={pieceCount} onChange={e => setPieceCount(e.target.value)} className="rounded-xl h-10" placeholder="Pieces count" />
            </div>
          );
        } else if (action === "charge") {
          footer = (
            <PanelFooter label="Making charge" value={fmtMoneyInr(Number(chargeAmount) || 0)}
              sub={mi.makingCharges.amountInr > 0 ? `Replaces ${fmtMoneyInr(mi.makingCharges.amountInr)}` : undefined}>
              {cancel}
              <AsyncButton onClick={() => setCharge(mi)} className="btn-hero rounded-xl h-10">Save</AsyncButton>
            </PanelFooter>
          );
          body = (
            <div className="space-y-2">
              <Input type="number" min={0} value={chargeAmount} onChange={e => setChargeAmount(e.target.value)} autoFocus className="rounded-xl h-10" placeholder="Making charge (₹)" />
              <p className="text-xs text-muted-foreground">The whole charge — it replaces any set before.</p>
            </div>
          );
        } else if (action === "pay") {
          footer = (
            <PanelFooter label="Paying" value={fmtMoneyInr(Number(payAmount) || 0)}
              sub={payFromLocker ? `${payFromLocker.name} holds ${fmtLockerAmount(lockerBalance(payFromLocker, db.lockerTransactions), payFromLocker.currency)}` : undefined}>
              {cancel}
              <AsyncButton onClick={() => payCharge(mi)} className="btn-hero rounded-xl h-10">Save</AsyncButton>
            </PanelFooter>
          );
          body = (
            <div className="space-y-3">
              {/* Colour on the figure only, a zero in grey — as every figure strip. */}
              <div className="grid grid-cols-3 rounded-xl border border-border/60 bg-white divide-x divide-border/60 text-center">
                <div className="p-2.5 min-w-0"><p className="text-[11px] text-muted-foreground">Charge</p><p className={`text-sm font-semibold tabular-nums whitespace-nowrap ${mi.makingCharges.amountInr ? "text-brand-dark" : "text-muted-foreground"}`}>{fmtMoneyInr(mi.makingCharges.amountInr)}</p></div>
                <div className="p-2.5 min-w-0"><p className="text-[11px] text-muted-foreground">Paid</p><p className={`text-sm font-semibold tabular-nums whitespace-nowrap ${issuancePaid(mi) ? "text-success" : "text-muted-foreground"}`}>{fmtMoneyInr(issuancePaid(mi))}</p></div>
                <div className="p-2.5 min-w-0"><p className="text-[11px] text-muted-foreground">Pending</p><p className={`text-sm font-semibold tabular-nums whitespace-nowrap ${pending ? "text-destructive" : "text-muted-foreground"}`}>{fmtMoneyInr(pending)}</p></div>
              </div>
              <Input type="number" min={1} value={payAmount} onChange={e => setPayAmount(e.target.value)} autoFocus className="rounded-xl h-10" placeholder="Amount (₹)" />
              <Select value={payLockerId} onValueChange={addNew("locker", setPayLockerId)}>
                <SelectTrigger className="h-10 rounded-xl"><SelectValue placeholder="From which locker?" /></SelectTrigger>
                <SelectContent>{db.lockers.filter(l => l.active !== false && (l.currency || "INR") === "INR").map(l => <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>)}<AddNewItem kind="locker" /></SelectContent>
              </Select>
            </div>
          );
        } else if (action === "return" && mi.diamondKind === "certified") {
          footer = (
            <PanelFooter label="Returning" value={`${packets} packet${packets !== 1 ? "s" : ""}`}>
              {cancel}
              <AsyncButton onClick={() => returnMaterial(mi)} disabled={returning} className="btn-hero rounded-xl h-10">{returning ? "Saving…" : "Return packets to stock"}</AsyncButton>
            </PanelFooter>
          );
          body = (
            <p className="text-sm text-muted-foreground">
              Puts these {packets} certified packet{packets !== 1 ? "s" : ""} back into stock.
            </p>
          );
        } else if (action === "return") {
          footer = (
            <PanelFooter label="Returning" value={`${Number(returnQty) || 0}${unit}`}>
              {cancel}
              <AsyncButton onClick={() => returnMaterial(mi)} disabled={returning} className="btn-hero rounded-xl h-10">{returning ? "Saving…" : "Save"}</AsyncButton>
            </PanelFooter>
          );
          body = (
            <div className="space-y-3">
              <p className="text-xs text-muted-foreground">
                Back to stock — a swapped stone or leftover gold. Unused: {remainder}{unit}
                {mi.material === "diamond" && mi.diamondKind !== "certified" && <> · into <span className="font-semibold text-primary">{bagNoOf(db, mi.purityOrQuality) ?? "its bag"}</span> ({lotLabel(mi.purityOrQuality)})</>}
              </p>
              <div className={`grid grid-cols-1 gap-2.5 ${mi.material === "diamond" ? "sm:grid-cols-3" : "sm:grid-cols-2"}`}>
                <Input type="number" min={0} value={returnQty} onChange={e => setReturnQty(e.target.value)} autoFocus className="rounded-xl h-10" placeholder={`Return qty (${unit})`} />
                {mi.material === "diamond" && (
                  <Input type="number" min={0} step="1" value={returnPcs} onChange={e => setReturnPcs(e.target.value)} className="rounded-xl h-10" placeholder="Pcs (optional)" aria-label="Pcs returned" />
                )}
                <Input value={returnNote} onChange={e => setReturnNote(e.target.value)} className="rounded-xl h-10" placeholder="Reason (e.g. diamond replaced)" />
              </div>
            </div>
          );
        } else {
          // Close: says what happens to what is left before anything moves.
          const plan = closePlan(mi);
          const certified = mi.diamondKind === "certified";
          const lines = [
            plan.returnsToStock ? `${plan.leftover}${unit} not used goes back to stock.` : "",
            plan.releasesToPool ? `${plan.leftover}${unit} not used is released back to ${factory.name}'s pool.` : "",
            certified && mi.diamondPacketIds ? `The ${packets} certified stone${packets !== 1 ? "s are" : " is"} marked as used in the finished piece.` : "",
            !certified && !plan.returnsToStock && !plan.releasesToPool && plan.leftover > 0 ? `${plan.leftover}${unit} not used is kept on this issuance as wastage — nothing goes back to stock.` : "",
            mi.orderId && plan.leftover < 0 ? `${Math.abs(plan.leftover)}${unit} more was used than issued — it shows as over-used.` : "",
          ].filter(Boolean);
          footer = (
            <PanelFooter>
              {cancel}
              <AsyncButton onClick={() => closeIssuance(mi)} className="btn-hero rounded-xl h-10">Close Issuance</AsyncButton>
            </PanelFooter>
          );
          body = (
            <div className="p-3 rounded-xl bg-secondary space-y-1.5 text-sm">
              {(lines.length ? lines : ["Everything issued is accounted for — nothing to return."]).map(l => <p key={l}>{l}</p>)}
            </div>
          );
        }

        return (
          <ActionSheet open={activeIssuance.open} onOpenChange={o => { if (!o) closeAction(); }}
            title={head.title} description={summary} icon={head.icon} footer={footer}>
            {body}
          </ActionSheet>
        );
      })()}
    </div>
  );
}
