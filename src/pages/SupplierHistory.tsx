import { useCan, useMayExport } from "@/hooks/useCan";
import { MoreMenu, type MoreAction } from "@/components/MoreMenu";
import { AddNewItem, useAddNew } from "@/components/create/QuickCreate";
import { GradeInput, useOtherMaterials } from "@/components/MaterialFields";
import { CompanyPicker, useDefaultCompany } from "@/components/CompanyFields";
import { coField, workCompanyOf } from "@/lib/companies";
import { isOtherMaterial, materialDef, materialName, materialUnit, purchaseQty, purchaseText } from "@/lib/materials";
import { useState } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { collectionLoaded, updateDb, uid, fmtDate, DIAMOND_SHAPES, KARAT_PURITY, nextDiamondStockNumber, hasOpeningBalance, openingDebitAmt, openingCreditAmt, type Purchase, type PurchaseMaterial, type PurchaseCurrency, type LedgerDir, type Supplier } from "@/lib/db";
import { OpeningBalanceFields } from "@/components/OpeningBalanceFields";
import { useDb } from "@/hooks/useDb";
import { useAuth } from "@/lib/auth";
import {
  supplierAccount, groupPaymentsAsMade, purchasePaid, purchasePending, allocateSupplierPaymentFIFO, fmtMoneyInr, lockerBalance, fmtLockerAmount,
} from "@/lib/manufacturing";
import { increaseStock } from "@/lib/stock";
import {
  canVoidPurchase, canEditPurchase, editPurchase, voidPurchase as voidPurchaseCascade,
  purchaseLabel, voidImpact, purchaseEditScope, type PurchaseEdit,
} from "@/lib/purchaseVoid";
import { listEntries, type MoneyEntry } from "@/lib/moneyEntries";
import { MoneyEntryEditor, confirmDeleteEntry, entryRowActions } from "@/components/MoneyEntryEditor";
import { SupplierEditDialog } from "@/components/SupplierEditDialog";
import { supplierDeleteGuard, deleteRefusal } from "@/lib/partyGuards";
import { needsAccess } from "@/lib/actionHints";
import { EditPurchaseDialog } from "@/components/EditPurchaseDialog";
import { ActionSheet } from "@/components/ActionSheet";
import { Button } from "@/components/ui/button";
import { AsyncButton } from "@/components/AsyncButton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  ArrowLeft, Truck, Mail, Phone, MapPin, Hash, Wallet, Plus, CreditCard,
  Download, FileText, FileSpreadsheet, X, Trash2, Pencil, ArrowDownCircle, ExternalLink, Lock,
} from "lucide-react";
import { motion } from "framer-motion";
import { toast } from "sonner";
import { downloadCsv, downloadLedgerPdf, fmtInrPlain } from "@/lib/ledgerExport";
import { StatementLedger, type StatementRow } from "@/components/StatementLedger";
import { DataTable, CellMain, CellTag, CellAmount, CellDate, type DataColumn } from "@/components/DataTable";
import { ExportDialog, inDateRange } from "@/components/ExportDialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { confirmBox } from "@/lib/confirm";
import { fmtCcy } from "@/lib/currency";
import { companyById, hasCompanies } from "@/lib/companies";
import { filled, lockerLabel, noteText, recorded, userName, type Detail } from "@/components/rowDetails";

const GOLD_PURITIES = ["9K", "14K", "18K", "22K", "24K"];

// One line = one Purchase doc on save — a single supplier invoice often
// covers several sizes/qualities (e.g. two diamond parcels), so purchases are
// entered as a list rather than forcing one open/fill/save cycle per variety.
interface PurchaseLine {
  material: PurchaseMaterial;
  purpose: "order" | "stock";
  orderNumber: string;
  goldWeight: string;
  goldPurity: string;
  goldRate: string;
  diaCarat: string;
  diaPcs: string;
  diaQuality: string;
  diaRate: string;
  diaKind: "loose" | "certified";
  diaShape: string;
  diaCertNo: string;
  diaLab: string;
  diaColor: string;
  diaClarity: string;
  diaCut: string;
  diaPolish: string;
  diaSym: string;
  diaFluor: string;
  diaMeasure: string;
  /** A material other than gold or diamond (Settings → Materials). */
  otherQty: string;
  otherGrade: string;
  otherRate: string;
  currency: PurchaseCurrency;
  totalUsd: string;
  exchangeRate: string;
  invoiceNumber: string;
  notes: string;
}

function emptyPurchaseLine(): PurchaseLine {
  return {
    material: "gold", purpose: "stock", orderNumber: "",
    goldWeight: "", goldPurity: "22K", goldRate: "",
    diaCarat: "", diaPcs: "", diaQuality: "", diaRate: "",
    diaKind: "loose", diaShape: "Round", diaCertNo: "", diaLab: "",
    diaColor: "", diaClarity: "", diaCut: "", diaPolish: "", diaSym: "", diaFluor: "", diaMeasure: "",
    otherQty: "", otherGrade: "", otherRate: "",
    currency: "INR", totalUsd: "", exchangeRate: "",
    invoiceNumber: "", notes: "",
  };
}

function purchaseLineTotalInr(line: PurchaseLine): number {
  const computed = line.material === "gold"
    ? (Number(line.goldWeight) || 0) * (Number(line.goldRate) || 0)
    : isOtherMaterial(line.material)
    ? (Number(line.otherQty) || 0) * (Number(line.otherRate) || 0)
    : (Number(line.diaCarat) || 0) * (Number(line.diaRate) || 0);
  return line.currency === "USD"
    ? Math.round((Number(line.totalUsd) || 0) * (Number(line.exchangeRate) || 0))
    : Math.round(computed);
}

/**
 * The page waits for its record before drawing anything that holds state. The
 * data behind the first screen arrives a moment after the page opens, and a
 * page that returned early on its first draw and then ran all its hooks on the
 * next crashed (React #310) whenever it was opened or refreshed directly.
 */
export function SupplierHistoryPage() {
  const { id } = useParams();
  const db = useDb();
  if (!(db.suppliers.some(s => s.id === id))) {
    return (
      <div className="text-center py-20 text-muted-foreground">
        {collectionLoaded("suppliers") ? "Supplier not found." : "Loading…"}{" "}
        <Link to="/suppliers" className="text-primary underline">Back</Link>
      </div>
    );
  }
  // Keyed by the record, so moving straight to another one starts it afresh.
  return <SupplierHistoryPageBody key={id} />;
}

function SupplierHistoryPageBody() {
  const mayExport = useMayExport();
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const db = useDb();
  const addNew = useAddNew();
  const otherMaterials = useOtherMaterials();
  const can = useCan();
  const isAdmin = user?.role === "admin";
  // Correcting the profile, a purchase or a payment from here: each opens in a
  // panel over the page.
  const [editingSupplier, setEditingSupplier] = useState<Supplier | null>(null);
  const [editingEntry, setEditingEntry] = useState<MoneyEntry | null>(null);

  const supplier = db.suppliers.find(s => s.id === id);
  if (!supplier) {
    return (
      <div className="text-center py-20 text-muted-foreground">
        Supplier not found. <Link to="/suppliers" className="text-primary underline">Back to Suppliers</Link>
      </div>
    );
  }

  const purchases = db.purchases
    .filter(p => p.supplierId === id)
    .sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));
  const receipts = (db.supplierReceipts ?? []).filter(r => r.supplierId === id);
  // Advances and loans — paid to this supplier but settling no particular bill.
  const advances = (db.supplierPayments ?? []).filter(x => x.supplierId === id);
  const account = supplierAccount(purchases, receipts, supplier, advances);

  // ── Opening balance (migration) ──
  const [obOpen, setObOpen] = useState(false);
  const [ob, setOb] = useState({
    amount: supplier.openingBalance != null ? String(supplier.openingBalance) : "",
    dir: (supplier.openingDir || "credit") as LedgerDir,
    date: supplier.openingDate || "",
  });
  const saveOpening = () => {
    const amt = ob.amount === "" ? 0 : Number(ob.amount);
    updateDb(d => {
      const s = d.suppliers.find(x => x.id === id);
      if (!s) return;
      s.openingBalance = amt || undefined;
      s.openingDir = amt ? ob.dir : undefined;
      s.openingDate = amt ? (ob.date || undefined) : undefined;
    });
    toast.success("Opening balance updated");
    setObOpen(false);
  };

  // ── Record purchase ──
  const [showExport, setShowExport] = useState(false);
  const [showPurchaseForm, setShowPurchaseForm] = useState(false);
  const [purchaseLines, setPurchaseLines] = useState<PurchaseLine[]>([emptyPurchaseLine()]);
  const [recordingPurchase, setRecordingPurchase] = useState(false);

  const linesTotalInr = purchaseLines.reduce((s, l) => s + purchaseLineTotalInr(l), 0);
  // The odd rupees nobody hands over. One figure for the whole bill, because
  // that is what gets rounded — it rides on the first line so the supplier's
  // due matches the cash, and is stored there so a statement can explain it.
  const [roundOff, setRoundOff] = useState("");
  // A supplier's bill number belongs to the BILL, not to each size on it. It is
  // required because a purchase book is checked against it: without one there is
  // no telling which chitthis have been entered and which are still waiting.
  const [billNo, setBillNo] = useState("");
  // Whose stock the bill goes into; a line bought for an order goes to that order's company.
  const [billCompany, setBillCompany] = useState(useDefaultCompany());
  const roundOffInr = Math.round(Number(roundOff) || 0);
  const grandTotalInr = linesTotalInr + roundOffInr;

  const updatePurchaseLine = (idx: number, patch: Partial<PurchaseLine>) =>
    setPurchaseLines(prev => prev.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
  const addPurchaseLine = () => setPurchaseLines(prev => [...prev, emptyPurchaseLine()]);
  const removePurchaseLine = (idx: number) => setPurchaseLines(prev => (prev.length > 1 ? prev.filter((_, i) => i !== idx) : prev));

  const resetPurchaseForm = () => { setPurchaseLines([emptyPurchaseLine()]); setRoundOff(""); setBillNo(""); };

  const recordPurchase = async () => {
    if (!billNo.trim()) { toast.error("Enter the supplier's bill number"); return; }
    for (const line of purchaseLines) {
      if (line.material === "gold" && (!line.goldWeight || Number(line.goldWeight) <= 0)) { toast.error("Enter gold weight for every line"); return; }
      if (line.material === "diamond" && (!line.diaCarat || Number(line.diaCarat) <= 0)) { toast.error("Enter diamond carat for every line"); return; }
      if (line.material === "diamond" && line.diaKind === "certified" && !line.diaCertNo.trim()) { toast.error("Enter the certificate number for every certified diamond line"); return; }
      if (isOtherMaterial(line.material) && !materialDef(db.settings, line.material)) { toast.error("Choose the material for every line"); return; }
      if (isOtherMaterial(line.material) && (!line.otherQty || Number(line.otherQty) <= 0)) { toast.error(`Enter the ${materialName(db.settings, line.material)} quantity for every line`); return; }
      if (line.currency === "USD" && (!line.totalUsd || !line.exchangeRate)) { toast.error("Enter the USD amount and exchange rate for every USD line"); return; }
      if (line.purpose === "order" && !line.orderNumber.trim()) { toast.error("Enter the order number for every 'for a specific order' line"); return; }
      if (purchaseLineTotalInr(line) <= 0) { toast.error("A line's total comes to ₹0 — check its weight/rate fields"); return; }
    }

    // Resolve order links up front so a typo fails before any writes happen.
    const resolved: { line: PurchaseLine; linkedOrderId?: string }[] = [];
    for (const line of purchaseLines) {
      if (line.purpose === "order") {
        const order = db.orders.find(o => o.orderNumber.trim().toLowerCase() === line.orderNumber.trim().toLowerCase());
        if (!order) { toast.error(`No order found matching "${line.orderNumber}"`); return; }
        resolved.push({ line, linkedOrderId: order.id });
      } else {
        resolved.push({ line });
      }
    }

    const now = new Date().toISOString();
    const entries = resolved.map(({ line, linkedOrderId }) => {
      const order = linkedOrderId ? db.orders.find(o => o.id === linkedOrderId) : undefined;
      return { id: uid("pur_"), line, linkedOrderId, totalInr: purchaseLineTotalInr(line), companyId: order ? workCompanyOf(db, order) : billCompany };
    });
    if (roundOffInr !== 0 && entries.length > 0) entries[0].totalInr += roundOffInr;

    setRecordingPurchase(true);
    try {
      // Stock increases must succeed before the purchase records are written,
      // so we never end up with a purchase that silently failed to update stock.
      for (const entry of entries) {
        const line = entry.line;
        if (line.purpose !== "stock") continue;
        // Certified diamonds are NOT pooled into stock levels — each becomes its
        // own packet (created in the updateDb below). Loose diamonds pool by shape.
        if (line.material === "diamond" && line.diaKind === "certified") continue;
        await increaseStock({
          material: line.material, companyId: entry.companyId,
          purityOrQuality: line.material === "gold" ? line.goldPurity : isOtherMaterial(line.material) ? (line.otherGrade.trim() || "—") : line.diaShape,
          quantity: line.material === "gold" ? Number(line.goldWeight) : isOtherMaterial(line.material) ? Number(line.otherQty) : Number(line.diaCarat),
          refType: "purchase",
          refId: entry.id,
          createdBy: user!.id,
        });
      }
      updateDb(d => {
        if (!d.purchases) d.purchases = [];
        for (const entry of entries) {
          const { line, linkedOrderId, totalInr } = entry;
          const purchase: Purchase = {
            id: entry.id,
            supplierId: id!,
            material: line.material,
            ...coField(entry.companyId),
            gold: line.material === "gold" ? { weightGrams: Number(line.goldWeight), purity: line.goldPurity, ratePerGram: Number(line.goldRate) || 0 } : undefined,
            other: isOtherMaterial(line.material) ? { qty: Number(line.otherQty), grade: line.otherGrade.trim() || "—", ratePerUnit: Number(line.otherRate) || 0 } : undefined,
            diamond: line.material === "diamond" ? {
              carat: Number(line.diaCarat),
              quality: line.diaQuality || undefined,
              ratePerCarat: Number(line.diaRate) || 0,
              kind: line.diaKind,
              shape: line.diaShape,
              certificateNumber: line.diaKind === "certified" ? line.diaCertNo.trim() : undefined,
              certificateLab: line.diaKind === "certified" ? (line.diaLab.trim() || undefined) : undefined,
            } : undefined,
            purpose: line.purpose,
            orderId: linkedOrderId,
            currency: line.currency,
            totalUsd: line.currency === "USD" ? Number(line.totalUsd) : undefined,
            exchangeRate: line.currency === "USD" ? Number(line.exchangeRate) : undefined,
            totalInr,
            roundOffInr: roundOffInr !== 0 && entry.id === entries[0].id ? roundOffInr : undefined,
            payments: [],
            invoiceNumber: billNo.trim(),
            notes: line.notes.trim() || undefined,
            createdBy: user!.id,
            createdAt: now,
          };
          d.purchases.unshift(purchase);

          // Certified diamond → its own packet (never pooled). Goes to stock, or
          // straight onto the order if this purchase was for a specific order.
          if (line.material === "diamond" && line.diaKind === "certified") {
            if (!d.diamondPackets) d.diamondPackets = [];
            const carat = Number(line.diaCarat) || 0;
            d.diamondPackets.unshift({
              id: uid("dp_"),
              stockNumber: nextDiamondStockNumber(d),
              ...coField(entry.companyId),
              shape: line.diaShape,
              carat,
              quality: line.diaQuality || undefined,
              color: line.diaColor.trim() || undefined,
              clarity: line.diaClarity.trim() || undefined,
              cut: line.diaCut.trim() || undefined,
              polish: line.diaPolish.trim() || undefined,
              symmetry: line.diaSym.trim() || undefined,
              fluorescence: line.diaFluor.trim() || undefined,
              measurement: line.diaMeasure.trim() || undefined,
              certificateNumber: line.diaCertNo.trim(),
              certificateLab: line.diaLab.trim() || undefined,
              ratePerCaratInr: carat > 0 ? Math.round((totalInr / carat) * 100) / 100 : undefined,
              supplierId: id!,
              purchaseId: purchase.id,
              // Stays in stock (reserved to the order if linked) so it flows through
              // the normal issue-to-factory step instead of jumping straight to "used".
              status: "in_stock",
              orderId: linkedOrderId,
              createdBy: user!.id,
              createdAt: now,
            });
          }

          if (linkedOrderId) {
            const o = d.orders.find(o => o.id === linkedOrderId);
            if (o) {
              if (!o.linkedPurchaseIds) o.linkedPurchaseIds = [];
              o.linkedPurchaseIds.push(purchase.id);
              if (!o.manufacturingLog) o.manufacturingLog = [];
              const qty = line.material === "gold" ? Number(line.goldWeight) : isOtherMaterial(line.material) ? Number(line.otherQty) : Number(line.diaCarat);
              const label = line.material === "gold"
                ? `${qty}g ${line.goldPurity} gold`
                : isOtherMaterial(line.material)
                ? `${qty} ${materialUnit(db.settings, line.material)} ${line.otherGrade.trim() ? `${line.otherGrade.trim()} ` : ""}${materialName(db.settings, line.material)}`
                : `${qty}ct ${line.diaShape} diamond${line.diaKind === "certified" ? ` (Certified ${line.diaCertNo.trim()})` : line.diaQuality ? ` (${line.diaQuality})` : ""}`;
              o.manufacturingLog.push({
                id: uid("mlog_"), type: "material_purchased", at: now, employeeId: user!.id,
                material: line.material, amountMaterial: qty, amountInr: totalInr,
                remarks: `Purchased ${label} from ${supplier.name} for this order — ${fmtMoneyInr(totalInr)}`,
              });
            }
          }
        }
      });
      toast.success(`${entries.length > 1 ? `${entries.length} purchases` : "Purchase"} recorded — ${fmtMoneyInr(grandTotalInr)}`);
      setShowPurchaseForm(false);
      resetPurchaseForm();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to record purchase");
    } finally { setRecordingPurchase(false); }
  };

  // ── Record payment ──
  const [showPayForm, setShowPayForm] = useState(false);
  const [payAmount, setPayAmount] = useState("");
  const [payLockerId, setPayLockerId] = useState("");
  const [payTargetPurchase, setPayTargetPurchase] = useState<string>("__fifo");
  const [payNote, setPayNote] = useState("");
  // Shown in the panel's footer only; the save looks the locker up afresh.
  const payFromLocker = db.lockers.find(l => l.id === payLockerId);

  const recordPayment = async () => {
    const amt = Number(payAmount);
    if (!amt || amt <= 0) { toast.error("Enter a valid amount"); return; }
    if (!payLockerId) { toast.error("Choose which locker this payment came from"); return; }
    // Overpayment allowed — the excess beyond what's owed is parked on the newest
    // purchase (shows as Overpaid), never silently lost.
    const payLocker = db.lockers.find(l => l.id === payLockerId);
    if (payLocker && amt > lockerBalance(payLocker, db.lockerTransactions) &&
        !(await confirmBox(`This payment of ${fmtLockerAmount(amt, payLocker.currency)} is more than ${payLocker.name}'s balance of ${fmtLockerAmount(lockerBalance(payLocker, db.lockerTransactions), payLocker.currency)}. The locker will go negative — continue only if a deposit is still missing.`))) return;
    const now = new Date().toISOString();

    updateDb(d => {
      const supplierPurchases = d.purchases.filter(p => p.supplierId === id);
      const asAdvance = (sum: number) => {
        if (!d.supplierPayments) d.supplierPayments = [];
        d.supplierPayments.push({ id: uid("spay_"), supplierId: id!, amountInr: sum, lockerId: payLockerId, recordedBy: user!.id, createdAt: now, note: payNote.trim() || undefined });
      };
      if (payTargetPurchase === "__advance") {
        asAdvance(amt);
      } else if (payTargetPurchase === "__fifo") {
        const leftover = allocateSupplierPaymentFIFO(supplierPurchases, amt, payLockerId, user!.id, now, payNote.trim() || undefined);
        if (leftover > 0) {
          const newest = [...supplierPurchases].sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt))[0];
          if (newest) {
            if (!newest.payments) newest.payments = [];
            newest.payments.push({ id: uid("ppay_"), amountInr: leftover, lockerId: payLockerId, recordedBy: user!.id, createdAt: now, note: payNote.trim() || undefined });
          } else {
            // Nothing to settle — a supplier with no bills at all. Standing on
            // its own is the only place this money can go; it used to vanish.
            asAdvance(leftover);
          }
        }
      } else {
        const p = d.purchases.find(p => p.id === payTargetPurchase);
        if (p) {
          if (!p.payments) p.payments = [];
          p.payments.push({ id: uid("ppay_"), amountInr: amt, lockerId: payLockerId, recordedBy: user!.id, createdAt: now, note: payNote.trim() || undefined });
        } else {
          // The bill went while the form was open. The money still left the
          // account, so it is booked as an advance rather than discarded.
          asAdvance(amt);
        }
      }
      if (!d.lockerTransactions) d.lockerTransactions = [];
      d.lockerTransactions.push({
        id: uid("ltx_"), lockerId: payLockerId, type: "expense", amountInr: amt,
        category: `Supplier Payment — ${supplier.name}`, refType: "purchase",
        refId: payTargetPurchase === "__fifo" || payTargetPurchase === "__advance" ? undefined : payTargetPurchase,
        note: payNote.trim() || undefined, recordedBy: user!.id, createdAt: now,
      });
    });
    toast.success("Payment recorded");
    setPayAmount(""); setPayNote(""); setPayTargetPurchase("__fifo"); setShowPayForm(false);
  };

  // ── Receive money FROM the supplier (refund / return credit) ──
  const [showReceiveForm, setShowReceiveForm] = useState(false);
  const [rcvAmount, setRcvAmount] = useState("");
  const [rcvLockerId, setRcvLockerId] = useState("");
  const [rcvNote, setRcvNote] = useState("");

  const recordReceipt = () => {
    const amt = Number(rcvAmount);
    if (!amt || amt <= 0) { toast.error("Enter a valid amount"); return; }
    if (!rcvLockerId) { toast.error("Choose which locker the money went into"); return; }
    const now = new Date().toISOString();
    updateDb(d => {
      if (!d.supplierReceipts) d.supplierReceipts = [];
      const receiptId = uid("srcpt_");
      d.supplierReceipts.push({ id: receiptId, supplierId: id!, amountInr: amt, lockerId: rcvLockerId, recordedBy: user!.id, createdAt: now, note: rcvNote.trim() || undefined });
      if (!d.lockerTransactions) d.lockerTransactions = [];
      d.lockerTransactions.push({
        id: uid("ltx_"), lockerId: rcvLockerId, type: "income", amountInr: amt,
        category: `Received from ${supplier.name}`, refType: "supplierReceipt",
        refId: id!, paymentId: receiptId,
        note: rcvNote.trim() || undefined, recordedBy: user!.id, createdAt: now,
      });
    });
    toast.success("Receipt recorded");
    setRcvAmount(""); setRcvNote(""); setRcvLockerId(""); setShowReceiveForm(false);
  };

  // ── Void a purchase ──
  // Deliberately CONSERVATIVE: a void only proceeds when it can fully and safely
  // reverse itself. It refuses (with a clear reason) if any payment was recorded
  // (those may have been FIFO-allocated and can't be traced back cleanly — the
  // payment must be cancelled in Payments → Supplier payments first), if a
  // certified packet has already left stock, or if pooled stock has already been
  // consumed. This keeps production money/inventory from silently drifting.
  const [voidingId, setVoidingId] = useState<string | null>(null);
  const [editingPurchase, setEditingPurchase] = useState<Purchase | null>(null);

  const openEditPurchase = (p: Purchase) => {
    const check = canEditPurchase(db, p);
    if (!check.ok) { toast.error(check.reason!); return; }
    setEditingPurchase(p);
  };

  const saveEditPurchase = async (edit: PurchaseEdit) => {
    if (!editingPurchase) return;
    try {
      await editPurchase(db, editingPurchase, edit, user!.id);
      toast.success("Purchase corrected — supplier due, factory issue and stock updated");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't apply the correction.");
    }
  };

  const voidPurchase = async (p: Purchase) => {
    // Every unwind rule lives in src/lib/purchaseVoid.ts so the Order page and
    // this ledger can never disagree about what "removing a purchase" means.
    const check = canVoidPurchase(db, p);
    if (!check.ok) { toast.error(check.reason!); return; }
    if (!(await confirmBox(
      `Remove this purchase of ${purchaseLabel(p)} (${fmtMoneyInr(p.totalInr)})?

` +
      "What changes:\n" + voidImpact(db, p).join("\n") + "\n\nThis cannot be undone.",
    ))) return;
    setVoidingId(p.id);
    try {
      await voidPurchaseCascade(db, p, user!.id);
      toast.success("Purchase removed — supplier dues, stock and factory issue all reversed");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't reverse the stock for this purchase.");
    } finally { setVoidingId(null); }
  };

  const pendingPurchases = purchases.filter(p => purchasePending(p) > 0);

  // ── What can be done to each line ──
  // Every action is offered; one that can't be done is greyed out with the
  // reason underneath, rather than hidden or refused with a toast on click.
  const ADMIN_ONLY = "Only an admin can change a supplier's purchases";
  const purchaseActions = (p: Purchase): MoreAction[] => {
    const o = p.orderId ? db.orders.find(x => x.id === p.orderId) : undefined;
    const edit = canEditPurchase(db, p);
    const scope = purchaseEditScope(db, p);
    const voidable = canVoidPurchase(db, p);
    return [
      { label: "View order", icon: ExternalLink, show: !!o,
        hint: can("orders") ? `Bought for ${o?.orderNumber}` : needsAccess("orders", "view"),
        disabled: !can("orders"), onSelect: () => navigate(`/orders/${o!.id}`) },
      { label: "Edit", icon: Pencil, onSelect: () => openEditPurchase(p), disabled: !isAdmin || !edit.ok,
        // Open, but only the rate: say so before the panel does.
        hint: !isAdmin ? ADMIN_ONLY : !edit.ok ? edit.reason : !scope.quantity ? scope.reason : undefined },
      { label: voidingId === p.id ? "Voiding…" : "Void", icon: Trash2, danger: true,
        disabled: !isAdmin || voidingId === p.id || !voidable.ok, onSelect: () => voidPurchase(p),
        hint: !isAdmin ? ADMIN_ONLY : voidable.ok ? "Reverses the supplier due, stock and factory issue" : voidable.reason },
    ];
  };

  // A payment, refund or advance on the statement is corrected with the same
  // panel and menu as Payments → Supplier payments (MoneyEntryEditor), so the
  // bill and the account it went through move together. Worked out once, on
  // first use.
  let entryCache: MoneyEntry[] | undefined;
  const entryOf = (rowId: string) =>
    (entryCache ??= listEntries(db, "supplier")).find(e => e.id === rowId || e.legIds?.includes(rowId));
  const statementActions = (r: StatementRow): MoreAction[] => {
    if (r.kind === "Purchase") {
      const p = purchases.find(x => x.id === r.id);
      return p ? purchaseActions(p) : [];
    }
    if (r.kind !== "Payment" && r.kind !== "Received" && r.kind !== "Advance") return [];
    const e = entryOf(r.id);
    if (!e) {
      const why = "Correct it in Payments → Supplier payments";
      return [{ label: "Edit", icon: Lock, disabled: true, hint: why, onSelect: () => {} }];
    }
    return entryRowActions(e, {
      mayEdit: can("payments", "edit"), mayDelete: can("payments", "delete"),
      editNeeds: needsAccess("payments", "edit"), deleteNeeds: needsAccess("payments", "delete"),
      onEdit: setEditingEntry, onDelete: x => { void confirmDeleteEntry(db, x); },
    });
  };

  // ── The supplier themselves ──
  const deleteGuard = supplierDeleteGuard(db, supplier);
  const deleteSupplier = async () => {
    const refused = await deleteRefusal("supplier", supplier);
    if (refused) { toast.error(refused); return; }
    if (!(await confirmBox(`Delete ${supplier.name}?\n\nThey have no purchases, payments or refunds, so no other record changes. This cannot be undone.`))) return;
    let gone = false;
    updateDb(d => {
      // Counted again on the live records, as the question may have sat open.
      const live = d.suppliers.find(x => x.id === supplier.id);
      if (!live || !supplierDeleteGuard(d, live).ok) return;
      d.suppliers = d.suppliers.filter(x => x.id !== supplier.id);
      gone = true;
    });
    if (!gone) { toast.error("Could not delete — something was recorded for them meanwhile"); return; }
    toast.success("Supplier deleted");
    navigate("/suppliers");
  };

  /**
   * What was actually bought, in the words a jeweller uses. The weight has its
   * own column, so this is the description: shape, loose or certified, the
   * quality grade and the report number for a certified stone; karat, purity
   * and the supplier's own bill number for gold.
   */
  const purchaseDesc = (p: Purchase) => {
    if (p.material === "gold") {
      const g = p.gold;
      const bits = [
        g?.purity ? `${g.purity} gold` : "Gold",
        g?.purity && KARAT_PURITY[parseInt(g.purity, 10)]
          ? `${Math.round(KARAT_PURITY[parseInt(g.purity, 10)] * 1000)}‰`
          : undefined,
        p.invoiceNumber ? `Bill ${p.invoiceNumber}` : undefined,
      ].filter(Boolean);
      return bits.join(" · ");
    }
    if (isOtherMaterial(p.material)) {
      return [materialName(db.settings, p.material), p.other?.grade && p.other.grade !== "—" ? p.other.grade : undefined,
        p.other?.pieces ? `${p.other.pieces} pcs` : undefined, p.invoiceNumber ? `Bill ${p.invoiceNumber}` : undefined].filter(Boolean).join(" · ");
    }
    const d = p.diamond;
    const bits = [
      d?.shape || "Diamond",
      d?.kind === "certified" ? "certified" : "loose",
      d?.quality,
      d?.pieces ? `${d.pieces} pcs` : undefined,
      d?.certificateNumber ? `${d.certificateLab || "Cert"} ${d.certificateNumber}` : undefined,
      p.invoiceNumber ? `Bill ${p.invoiceNumber}` : undefined,
    ].filter(Boolean);
    return bits.join(" · ");
  };

  // Full account statement — every purchase (owed) and every payment (paid)
  // across all purchases, chronological, with a running balance. This is the
  // "professional ledger" view, not just a purchase-by-purchase list.
  const statement = (() => {
    const rows: StatementRow[] = [];
    // Opening balance carried in from a previous system — always the first line.
    // Opening balance. openingCreditAmt() is what WE owe them, which in this
    // statement is a DEBIT — it was going into the Paid column, so the running
    // balance started negative and never agreed with Balance Owed above.
    if (hasOpeningBalance(supplier)) {
      rows.push({
        id: "opening", date: supplier.openingDate || supplier.createdAt,
        particulars: "Balance brought forward",
        debit: openingCreditAmt(supplier), credit: openingDebitAmt(supplier),
        balance: 0, kind: "Opening", pinned: true,
      });
    }
    for (const p of purchases) {
      // Show the order number when this purchase was bought for a specific order.
      const orderNo = p.orderId ? db.orders.find(o => o.id === p.orderId)?.orderNumber : undefined;
      // Everything the purchase entry captured: the weight, the supplier’s invoice
      // number, the rate behind the amount and the order it was bought for.
      const qty = purchaseQty(p);
      const unit = materialUnit(db.settings, p.material);
      rows.push({
        id: p.id, date: p.createdAt,
        particulars: purchaseDesc(p),
        invoiceNo: p.invoiceNumber || undefined, orderNo,
        ref: orderNo,
        qty: qty || undefined, unit, rate: qty > 0 ? Math.round((p.totalInr / qty) * 100) / 100 : undefined,
        debit: p.totalInr, credit: 0, balance: 0, kind: "Purchase",
      });
    }
    // Payments are shown as they were made, not as they were split across bills.
    for (const g of groupPaymentsAsMade(
      purchases.flatMap(p => (p.payments || []).map(pay => ({ pay, label: p.invoiceNumber || undefined }))),
    )) {
      const bills = g.labels.join(", ");
      rows.push({
        id: g.ids[0], date: g.at,
        particulars: `Payment${bills ? ` — ${bills}` : ""}${g.note ? ` · ${g.note}` : ""}`,
        ref: g.labels[0], invoiceNo: g.labels.length === 1 ? g.labels[0] : undefined,
        debit: 0, credit: g.amountInr, balance: 0, kind: "Payment",
      });
    }
    // Money received back from the supplier is a DEBIT: it moves the account the
    // same way a bill does. It was sitting in the Paid column, so returning an
    // advance in full drove the balance twice as far the wrong way instead of
    // bringing it back to zero.
    for (const r of receipts) {
      rows.push({ id: r.id, date: r.createdAt, particulars: `Received from supplier${r.note ? ` — ${r.note}` : ""}`, debit: r.amountInr, credit: 0, balance: 0, kind: "Received" });
    }
    // Advances and loans — money out against no bill, so a credit like any
    // other payment. Without these the statement would not add up to the
    // balance shown above it.
    for (const a of advances) {
      rows.push({ id: a.id, date: a.createdAt, particulars: `Advance / loan paid${a.note ? ` — ${a.note}` : ""}`, debit: 0, credit: a.amountInr, balance: 0, kind: "Advance" });
    }
    let running = 0;
    const withBalance = [...rows]
      // Opening balance is pinned first regardless of its as-of date.
      .sort((a, b) => (a.id === "opening" ? -1 : b.id === "opening" ? 1 : +new Date(a.date) - +new Date(b.date)))
      .map(r => { running += r.debit - r.credit; return { ...r, balance: running }; });
    return withBalance.reverse(); // newest first, matching every other list on this page
  })();

  // A statement is READ oldest-first: every balance is the balance after that
  // row, so newest-first printed the running total backwards and put the
  // opening line at the bottom. The screen shows newest first; the download
  // must not.
  const statementAsc = [...statement].reverse();

  /** Trim only if the text genuinely cannot fit the column (8.5pt Helvetica is
   *  about 1.6mm per character), so nothing is cut that would have fitted. */
  const fit = (s: string, mm: number) => {
    const max = Math.floor(mm / 1.6);
    return s.length <= max ? s : s.slice(0, max - 1) + "…";
  };



  const exportCsv = (from: Date | null, to: Date | null) => {
    downloadCsv(
      `Supplier-${supplier.name.replace(/\s+/g, "_")}`,
      ["Date", "Order No", "Particulars", "Weight", "Rate (INR)", "Bill Amount (INR)", "Paid (INR)", "Balance (INR)"],
      statementAsc.filter(r => inDateRange(r.date, from, to)).map(r => [
        r.id === "opening" ? "Opening" : fmtDate(r.date),
        r.orderNo ?? "", r.particulars,
        r.qty ? `${r.qty}${r.unit ?? ""}` : "",
        r.rate ?? "", r.debit || "", r.credit || "", r.balance,
      ]),
    );
  };

  const exportPdf = (from: Date | null, to: Date | null) => {
    downloadLedgerPdf({
      title: "Supplier Account Statement",
      subjectLines: [
        `Supplier: ${supplier.name}`,
        supplier.contactPerson ? `Contact: ${supplier.contactPerson}` : "",
        `Report Generated: ${new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}`,
      ].filter(Boolean),
      summary: [
        { label: "Total Purchased", value: fmtInrPlain(account.totalPurchased) },
        { label: "Total Paid", value: fmtInrPlain(account.totalPaid) },
        { label: "Balance Owed", value: fmtInrPlain(account.balanceOwed) },
        // The figure the table below actually closes on: what is owed after any
        // refunds received and any purchase that was overpaid.
        { label: "Closing Balance", value: fmtInrPlain(account.net) },
        { label: "Overpaid", value: fmtInrPlain(account.overpaid) },
      ],
      // Landscape: a jeweller’s ledger line is the weight, the supplier’s invoice
      // number, the order it was for, the rate and the amount. None of that fits a
      // portrait page, which is why the particulars were being cut off mid-word.
      landscape: true,
      columns: [
        { header: "Date", x: 14 },
        { header: "Order No", x: 40 },
        { header: "Particulars", x: 78 },
        { header: "Weight", x: 158 },
        { header: "Rate", x: 184 },
        { header: "Bill Amount", x: 210 },
        { header: "Paid", x: 240 },
        { header: "Balance", x: 264 },
      ],
      align: ["left", "left", "left", "right", "right", "right", "right", "right"],
      rows: statementAsc.filter(r => inDateRange(r.date, from, to)).map(r => [
        r.id === "opening" ? "Opening" : fmtDate(r.date),
        fit(r.orderNo ?? "", 36),
        fit(r.particulars, 78),
        r.qty ? `${r.qty}${r.unit ?? ""}` : "",
        r.rate ? fmtInrPlain(r.rate).replace("Rs. ", "") : "",
        r.debit ? fmtInrPlain(r.debit).replace("Rs. ", "") : "",
        r.credit ? fmtInrPlain(r.credit).replace("Rs. ", "") : "",
        fmtInrPlain(r.balance).replace("Rs. ", ""),
      ]),
      // A totals line so the columns prove themselves: bills less payments is
      // the balance the last row closes on.
      totalsRow: ["", "", "Totals", "", "",
        fmtInrPlain(account.totalPurchased).replace("Rs. ", ""),
        fmtInrPlain(account.totalPaid + account.received).replace("Rs. ", ""),
        fmtInrPlain(account.net).replace("Rs. ", "")],
      filename: `Supplier-${supplier.name.replace(/\s+/g, "_")}`,
    });
  };

  // ── Purchase History table ──
  const orderOf = (p: Purchase) => (p.orderId ? db.orders.find(o => o.id === p.orderId) : undefined);
  const purchaseTitle = (p: Purchase) =>
    p.material === "gold" ? `${p.gold?.weightGrams}g ${p.gold?.purity} Gold`
    : p.material === "diamond" ? `${p.diamond?.carat}ct Diamond${p.diamond?.quality ? ` (${p.diamond.quality})` : ""}`
    : purchaseText(db.settings, p);
  const purchaseColumns: DataColumn<Purchase>[] = [
    { key: "date", header: "Date", always: true, kind: "date", sortValue: p => +new Date(p.createdAt), csv: p => fmtDate(p.createdAt),
      cell: p => <CellDate>{fmtDate(p.createdAt)}</CellDate> },
    { key: "purchase", header: "Purchase", always: true, sortValue: p => purchaseTitle(p), csv: p => purchaseTitle(p),
      cell: p => <CellMain title={purchaseTitle(p)} sub={p.currency === "USD" ? `$${p.totalUsd} @ ₹${p.exchangeRate}/$` : undefined} /> },
    { key: "for", header: "For", sortValue: p => (p.purpose === "order" ? `Order ${orderOf(p)?.orderNumber ?? ""}` : "Stock"),
      csv: p => (p.purpose === "order" ? `Order ${orderOf(p)?.orderNumber ?? ""}`.trim() : "Stock"),
      cell: p => {
        if (p.purpose !== "order") return <CellTag>Stock</CellTag>;
        const o = orderOf(p);
        return o
          ? <Link to={`/orders/${o.id}`} className="hover:opacity-80"><CellTag tone="blue">For Order {o.orderNumber}</CellTag></Link>
          : <CellTag tone="blue">For Order</CellTag>;
      } },
    { key: "invoice", header: "Invoice no.", sortValue: p => p.invoiceNumber, csv: p => p.invoiceNumber ?? "",
      cell: p => (p.invoiceNumber ? <span className="whitespace-nowrap">{p.invoiceNumber}</span> : <span className="text-muted-foreground/50">—</span>) },
    { key: "total", header: "Total", align: "right", kind: "number", sortValue: p => p.totalInr,
      cell: p => <CellAmount>{fmtMoneyInr(p.totalInr)}</CellAmount> },
    { key: "paid", header: "Paid", align: "right", kind: "number", sortValue: p => purchasePaid(p),
      cell: p => (purchasePaid(p) > 0 ? <CellAmount tone="in">{fmtMoneyInr(purchasePaid(p))}</CellAmount> : <span className="text-muted-foreground/50">—</span>) },
    { key: "pending", header: "Pending", align: "right", kind: "number", sortValue: p => purchasePending(p),
      cell: p => (purchasePending(p) > 0 ? <CellAmount tone="out">{fmtMoneyInr(purchasePending(p))}</CellAmount> : <CellTag tone="green">Paid</CellTag>) },
  ];

  // An opened purchase: the bill as entered — description, rate, discount and
  // rounding, the bill's date and notes, the company and the stones it brought
  // in — then each payment made against it, and who recorded it.
  const purchaseRate = (p: Purchase) => {
    const cur = p.currency === "USD" ? "USD" : "INR";
    if (p.material === "gold") return p.gold?.ratePerGram ? `${fmtCcy(p.gold.ratePerGram, cur)}/g` : "";
    if (p.material === "diamond") return p.diamond?.ratePerCarat ? `${fmtCcy(p.diamond.ratePerCarat, cur)}/ct` : "";
    return p.other?.ratePerUnit ? `${fmtCcy(p.other.ratePerUnit, cur)}/${materialUnit(db.settings, p.material)}` : "";
  };
  const purchaseDetails = (p: Purchase): Detail[] => {
    const packets = (db.diamondPackets ?? []).filter(x => x.purchaseId === p.id);
    const pays = [...(p.payments ?? [])].sort((a, b) => +new Date(a.createdAt) - +new Date(b.createdAt));
    return filled([
      { label: "Description", value: purchaseDesc(p) },
      { label: "Rate", value: purchaseRate(p) },
      !!p.discountPct && { label: p.discountPct > 0 ? "Discount" : "Added on", value: `${Math.abs(p.discountPct)}%` },
      !!p.roundOffInr && { label: "Rounded off", value: `${p.roundOffInr > 0 ? "+" : "−"}${fmtMoneyInr(Math.abs(p.roundOffInr))}` },
      !!p.invoiceDate && { label: "Bill date", value: fmtDate(p.invoiceDate) },
      { label: "Notes", value: noteText(p.notes) },
      hasCompanies(db.settings) && { label: "Company", value: companyById(db.settings, p.companyId).name },
      packets.length > 0 && { label: packets.length > 1 ? "Stones" : "Stone", value: packets.map(x => x.stockNumber || `${x.certificateLab || "Cert"} ${x.certificateNumber}`).join(", ") },
      pays.length > 0 && { label: pays.length > 1 ? `Payments (${pays.length})` : "Payment", value: (
        <ul className="space-y-0.5">
          {pays.map(pay => (
            <li key={pay.id}>
              <span className="font-medium tabular-nums">{fmtMoneyInr(pay.amountInr)}</span>
              <span className="text-muted-foreground"> · {fmtDate(pay.createdAt)}{lockerLabel(db, pay.lockerId) ? ` · ${lockerLabel(db, pay.lockerId)}` : ""}{pay.note ? ` · ${pay.note}` : ""}{userName(db, pay.recordedBy) ? ` · ${userName(db, pay.recordedBy)}` : ""}</span>
            </li>
          ))}
        </ul>
      ) },
      { label: "Recorded", value: recorded(db, p.createdAt, p.createdBy) },
    ]);
  };

  // An opened statement line: the account the money went through, its note as
  // typed, and who recorded it; a purchase, its notes.
  const statementDetails = (r: StatementRow): Detail[] => {
    const p = purchases.find(x => x.id === r.id);
    if (p) return filled([{ label: "Notes", value: noteText(p.notes) }, { label: "Recorded", value: recorded(db, p.createdAt, p.createdBy) }]);
    const pay = purchases.flatMap(x => x.payments ?? []).find(x => x.id === r.id);
    if (pay) {
      // One payment split across bills: what each bill got.
      const parts = purchases.flatMap(x => (x.payments ?? []).filter(y => (y.lockerId ?? "") === (pay.lockerId ?? "") && y.createdAt === pay.createdAt).map(y => ({ x, y })));
      return filled([
        { label: "Paid from", value: lockerLabel(db, pay.lockerId) },
        parts.length > 1 && { label: "Split across", value: parts.map(({ x, y }) => `${x.invoiceNumber || "No bill no."} · ${fmtMoneyInr(y.amountInr)}`).join(", ") },
        { label: "Note", value: noteText(pay.note) },
        { label: "Recorded", value: recorded(db, pay.createdAt, pay.recordedBy) },
      ]);
    }
    const other = receipts.find(x => x.id === r.id) ?? advances.find(x => x.id === r.id);
    if (other) return filled([
      { label: r.kind === "Received" ? "Into account" : "Paid from", value: lockerLabel(db, other.lockerId) },
      { label: "Note", value: noteText(other.note) },
      { label: "Recorded", value: recorded(db, other.createdAt, other.recordedBy) },
    ]);
    return [];
  };

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <button onClick={() => navigate("/suppliers")} className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors">
        <ArrowLeft className="h-4 w-4" /> Back to Suppliers
      </button>

      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="card-luxe p-6">
        <div className="flex items-start gap-4 min-w-0">
          <div className="h-14 w-14 rounded-2xl bg-gradient-to-br from-amber-500/15 to-amber-400/15 grid place-items-center shrink-0">
            <Truck className="h-7 w-7 text-amber-600" />
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="font-display text-xl md:text-3xl text-brand-dark leading-tight break-words">{supplier.name}</h1>
            <p className="text-muted-foreground mt-1 break-words">{supplier.contactPerson}</p>
          </div>
          {/* Its own label, apart from the account's "More actions" below. */}
          <MoreMenu label="Supplier actions" title="Supplier" actions={[
            { label: "Edit details", icon: Pencil, onSelect: () => setEditingSupplier(supplier), disabled: !isAdmin,
              hint: isAdmin ? "Name, contact, GSTIN, address" : "Only an admin can change suppliers" },
            { label: "Delete supplier", icon: Trash2, danger: true, onSelect: deleteSupplier, disabled: !isAdmin || !deleteGuard.ok,
              hint: !isAdmin ? "Only an admin can change suppliers" : deleteGuard.reason },
          ]} />
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-6 text-sm">
          <div className="flex items-start gap-2 min-w-0"><Mail className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" /><div className="min-w-0"><p className="text-xs text-muted-foreground">Email</p><p className="font-medium break-all">{supplier.email || "—"}</p></div></div>
          <div className="flex items-start gap-2"><Phone className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" /><div><p className="text-xs text-muted-foreground">Phone</p><p className="font-medium">{supplier.phone || "—"}</p></div></div>
          <div className="flex items-start gap-2"><Hash className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" /><div><p className="text-xs text-muted-foreground">GSTIN</p><p className="font-medium">{supplier.gstin || "—"}</p></div></div>
          {supplier.address && <div className="flex items-start gap-2 min-w-0"><MapPin className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" /><div className="min-w-0"><p className="text-xs text-muted-foreground">Address</p><p className="font-medium break-words">{supplier.address}</p></div></div>}
        </div>
      </motion.div>

      {/* Account Ledger */}
      <div className="card-luxe p-5 space-y-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-success/10 grid place-items-center shrink-0"><Wallet className="h-5 w-5 text-success" /></div>
            <div>
              <h3 className="font-display text-lg text-brand-dark">Account Ledger</h3>
              <p className="text-xs text-muted-foreground">All amounts in INR</p>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <ExportDialog open={showExport} onClose={() => setShowExport(false)} title={`${supplier.name} ledger`} options={[
              { label: "Account Statement — PDF", sublabel: "Purchases, payments & receipts", kind: "pdf", run: exportPdf },
              { label: "Account Statement — Excel", sublabel: "Purchases, payments & receipts", kind: "excel", run: exportCsv },
            ]} />
            {user?.role === "admin" && (
              <Button onClick={() => setShowPayForm(true)} variant="outline" className="rounded-xl gap-2">
                <CreditCard className="h-4 w-4" /> Pay
              </Button>
            )}
            {user?.role === "admin" && (
              <Button onClick={() => setShowPurchaseForm(true)} className="btn-hero rounded-xl gap-2">
                <Plus className="h-4 w-4" /> Record Purchase
              </Button>
            )}
            <MoreMenu title="Supplier account" actions={[
              { label: "Receive money", icon: ArrowDownCircle, hint: "A refund or money back from this supplier", onSelect: () => setShowReceiveForm(true), show: user?.role === "admin" },
              { label: "Export statement", icon: Download, hint: "Purchases, payments and receipts — PDF or Excel", onSelect: () => setShowExport(true), show: mayExport },
            ]} />
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="p-3 rounded-xl bg-secondary text-center"><p className="text-xs text-muted-foreground mb-1">Total Purchased</p><p className="font-semibold text-sm">{fmtMoneyInr(account.totalPurchased)}</p></div>
          <div className="p-3 rounded-xl bg-success/8 border border-success/20 text-center"><p className="text-xs text-muted-foreground mb-1">Total Paid</p><p className="font-semibold text-sm text-success">{fmtMoneyInr(account.totalPaid)}</p></div>
          <div className="p-3 rounded-xl bg-blue-500/8 border border-blue-500/20 text-center"><p className="text-xs text-muted-foreground mb-1">Received (refunds)</p><p className="font-semibold text-sm text-blue-600">{fmtMoneyInr(account.received)}</p></div>
          <div className={`p-3 rounded-xl text-center border ${account.net > 0 ? "bg-destructive/5 border-destructive/20" : account.net < 0 ? "bg-blue-500/8 border-blue-500/20" : "bg-success/8 border-success/20"}`}>
            <p className="text-xs text-muted-foreground mb-1">{account.net < 0 ? "Supplier owes you" : "Net balance"}</p>
            <p className={`font-semibold text-sm ${account.net > 0 ? "text-destructive" : account.net < 0 ? "text-blue-600" : "text-success"}`}>{account.net > 0 ? fmtMoneyInr(account.net) : account.net < 0 ? fmtMoneyInr(-account.net) : "✓ Settled"}</p>
          </div>
        </div>
      </div>

      {/* Opening balance (migration) — admin only */}
      {user?.role === "admin" && (
        <div className="card-luxe p-5">
          <button onClick={() => setObOpen(v => !v)} className="w-full flex items-center justify-between gap-3 text-left">
            <div>
              <h3 className="font-display text-lg text-brand-dark">Opening Balance</h3>
              <p className="text-xs text-muted-foreground">
                {hasOpeningBalance(supplier)
                  ? `${fmtMoneyInr(Math.abs(supplier.openingBalance!))} · ${supplier.openingDir === "credit" ? "we owe supplier" : "supplier owes us"}${supplier.openingDate ? ` · as of ${fmtDate(supplier.openingDate)}` : ""}`
                  : "Not set — add the balance carried in from your previous system"}
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
                debitLabel="Supplier owes us (Debit)"
                creditLabel="We owe supplier (Credit)"
                hint="Amount outstanding with this supplier when you started using this app (₹)."
              />
              <div className="col-span-2">
                <AsyncButton onClick={saveOpening} className="btn-hero rounded-xl h-10">Save Opening Balance</AsyncButton>
              </div>
            </div>
          )}
        </div>
      )}
      {/* Account Statement — the same ledger people read on Stock and Locker:
          summary, filters, then every entry with a running balance. */}
      <StatementLedger
        title="Account Statement"
        caption={`${statement.length} entr${statement.length !== 1 ? "ies" : "y"} · purchases and payments, running balance in INR`}
        rows={statement}
        fmt={fmtMoneyInr}
        debitLabel="Bill"
        creditLabel="Paid"
        details={statementDetails}
        rowActions={statementActions}
        onExport={() => setShowExport(true)}
        summary={[
          { label: "Total purchased", value: fmtMoneyInr(account.totalPurchased), tone: "out" },
          { label: "Total paid", value: fmtMoneyInr(account.totalPaid), tone: "in" },
          // net = what is owed AFTER refunds received and any overpayment, which
          // is exactly where the running balance below ends up.
          { label: "Outstanding", value: fmtMoneyInr(account.net), tone: account.net > 0 ? "due" : "in" },
          { label: "Purchases", value: String(purchases.length) },
        ]}
      />


      {/* Purchase history */}
      <div className="card-luxe overflow-hidden">
        <div className="px-5 py-4 border-b border-border/60">
          <h2 className="font-display text-xl text-brand-dark">Purchase History</h2>
          <p className="text-xs text-muted-foreground mt-0.5">{purchases.length} purchase{purchases.length !== 1 ? "s" : ""}</p>
        </div>
        <div className="p-3 sm:p-4">
          <DataTable
            id="supplier-purchases"
            noun="purchase"
            rows={purchases}
            columns={purchaseColumns}
            rowKey={p => p.id}
            defaultSort={{ key: "date", dir: "desc" }}
            searchText={p => [purchaseTitle(p), purchaseDesc(p), p.invoiceNumber, orderOf(p)?.orderNumber, p.purpose === "order" ? "order" : "stock", p.notes].filter(Boolean).join(" ")}
            searchPlaceholder="Search purchases"
            exportName={`Supplier-${supplier.name.replace(/\s+/g, "_")}-Purchases`}
            details={purchaseDetails}
            totals={{
              total: rows => fmtMoneyInr(rows.reduce((s, p) => s + p.totalInr, 0)),
              paid: rows => <span className="text-success">{fmtMoneyInr(rows.reduce((s, p) => s + purchasePaid(p), 0))}</span>,
              pending: rows => <span className="text-destructive">{fmtMoneyInr(rows.reduce((s, p) => s + purchasePending(p), 0))}</span>,
            }}
            // Correcting beats voiding and re-entering: a void unwinds the
            // factory issue, the stock trail and the certified packet with it.
            // Both are always offered, greyed with the reason when they can't
            // be done — a paid bill says to cancel the payment first.
            rowActions={purchaseActions}
            emptyText="No purchases recorded yet."
          />
        </div>
      </div>
      <EditPurchaseDialog
        purchase={editingPurchase}
        onClose={() => setEditingPurchase(null)}
        onSave={saveEditPurchase}
        // Material already made into a piece keeps its weight; the rate can still move.
        lockQuantity={!!editingPurchase && !purchaseEditScope(db, editingPurchase).quantity}
        lockNote={editingPurchase ? purchaseEditScope(db, editingPurchase).reason : undefined}
      />
      <MoneyEntryEditor entry={editingEntry} onClose={() => setEditingEntry(null)} mayDelete={can("payments", "delete")} />
      <SupplierEditDialog supplier={editingSupplier} onClose={() => setEditingSupplier(null)} />

      {/* The three money actions slide in from the right, so the ledger and the
          statement behind stay where they were. Closing a panel keeps what was
          typed (a long bill isn't lost to a stray click); Cancel clears it,
          exactly as the inline forms did. */}
      <ActionSheet
        open={showPurchaseForm}
        onOpenChange={setShowPurchaseForm}
        title="Record Purchase"
        description={<>From {supplier.name} — one bill, with a line for each size or quality on it.</>}
        icon={Truck}
        size="lg"
        footer={
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="min-w-0">
              <p className="text-xs text-muted-foreground">Grand Total (INR)</p>
              <p className="font-display text-lg font-bold text-brand-dark leading-tight">{fmtMoneyInr(grandTotalInr)}</p>
              {roundOffInr !== 0 && <p className="text-[11px] text-muted-foreground">{fmtMoneyInr(linesTotalInr)} {roundOffInr < 0 ? "less" : "plus"} {fmtMoneyInr(Math.abs(roundOffInr))} rounding</p>}
            </div>
            <div className="flex gap-2.5 ml-auto">
              <Button variant="outline" onClick={() => { setShowPurchaseForm(false); resetPurchaseForm(); }} className="rounded-xl h-10">Cancel</Button>
              <AsyncButton onClick={recordPurchase} disabled={recordingPurchase} className="btn-hero rounded-xl h-10">{recordingPurchase ? "Saving…" : purchaseLines.length > 1 ? `Save ${purchaseLines.length} Purchases` : "Save Purchase"}</AsyncButton>
            </div>
          </div>
        }
      >
        <div className="space-y-3">
          <CompanyPicker value={billCompany} onChange={setBillCompany} label="Company — whose stock this is" hint="A line bought for a particular order goes to that order's company." />
          <div>
            <Label className="text-xs">Bill no. <span className="text-destructive">*</span></Label>
            <Input value={billNo} onChange={e => setBillNo(e.target.value)} autoFocus
              className="rounded-xl h-10 mt-1" placeholder="The supplier's bill number — the whole bill, not each item" />
          </div>

          {purchaseLines.map((line, idx) => (
            <div key={idx} className="p-3 rounded-xl border border-border/60 space-y-2.5 relative">
              {purchaseLines.length > 1 && (
                <button type="button" onClick={() => removePurchaseLine(idx)} className="absolute top-2 right-2 h-6 w-6 rounded-lg grid place-items-center text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors">
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
              <p className="text-xs font-medium text-muted-foreground">Item {idx + 1}</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <Select value={line.material} onValueChange={v => updatePurchaseLine(idx, { material: v as PurchaseMaterial })}>
                  <SelectTrigger className="h-10 rounded-xl"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="gold">Gold</SelectItem><SelectItem value="diamond">Diamond</SelectItem>
                    {otherMaterials.map(m => <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Select value={line.purpose} onValueChange={v => updatePurchaseLine(idx, { purpose: v as "order" | "stock" })}>
                  <SelectTrigger className="h-10 rounded-xl"><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="stock">For General Stock</SelectItem><SelectItem value="order">For a Specific Order</SelectItem></SelectContent>
                </Select>
              </div>

              {line.purpose === "order" && (
                <Input value={line.orderNumber} onChange={e => updatePurchaseLine(idx, { orderNumber: e.target.value })} className="rounded-xl h-10" placeholder="Order number, e.g. SLJ-2026-1020" />
              )}

              {isOtherMaterial(line.material) ? (
                <div className="grid grid-cols-3 gap-2.5">
                  <GradeInput material={line.material} value={line.otherGrade} onChange={v => updatePurchaseLine(idx, { otherGrade: v })} />
                  <Input type="number" min={0} step="0.001" value={line.otherQty} onChange={e => updatePurchaseLine(idx, { otherQty: e.target.value })} className="rounded-xl h-10" placeholder={`Quantity (${materialUnit(db.settings, line.material)})`} />
                  <Input type="number" min={0} value={line.otherRate} onChange={e => updatePurchaseLine(idx, { otherRate: e.target.value })} className="rounded-xl h-10" placeholder={`Rate/${materialUnit(db.settings, line.material)} (${line.currency})`} />
                </div>
              ) : line.material === "gold" ? (
                <div className="grid grid-cols-3 gap-2.5">
                  <Input type="number" min={0} value={line.goldWeight} onChange={e => updatePurchaseLine(idx, { goldWeight: e.target.value })} className="rounded-xl h-10" placeholder="Weight (g)" />
                  <Select value={line.goldPurity} onValueChange={v => updatePurchaseLine(idx, { goldPurity: v })}>
                    <SelectTrigger className="h-10 rounded-xl"><SelectValue /></SelectTrigger>
                    <SelectContent>{GOLD_PURITIES.map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}</SelectContent>
                  </Select>
                  <Input type="number" min={0} value={line.goldRate} onChange={e => updatePurchaseLine(idx, { goldRate: e.target.value })} className="rounded-xl h-10" placeholder={`Rate/g (${line.currency})`} />
                </div>
              ) : (
                <div className="space-y-2.5">
                  <div className="grid grid-cols-2 gap-2.5">
                    <Select value={line.diaKind} onValueChange={v => updatePurchaseLine(idx, { diaKind: v as "loose" | "certified" })}>
                      <SelectTrigger className="h-10 rounded-xl"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="loose">Loose (by shape)</SelectItem>
                        <SelectItem value="certified">Certified (own packet)</SelectItem>
                      </SelectContent>
                    </Select>
                    <Select value={line.diaShape} onValueChange={v => updatePurchaseLine(idx, { diaShape: v })}>
                      <SelectTrigger className="h-10 rounded-xl"><SelectValue placeholder="Shape" /></SelectTrigger>
                      <SelectContent>{DIAMOND_SHAPES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  {/* Four across on a laptop, two by two on a phone — the old
                      three-column row squeezed quality and pieces into one cell. */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                    <Input type="number" min={0} step="0.01" value={line.diaCarat} onChange={e => updatePurchaseLine(idx, { diaCarat: e.target.value })} className="rounded-xl h-10" placeholder="Carat" />
                    <Input value={line.diaQuality} onChange={e => updatePurchaseLine(idx, { diaQuality: e.target.value })} className="rounded-xl h-10" placeholder="Quality (optional)" />
                    <Input type="number" min={0} step="1" value={line.diaPcs} onChange={e => updatePurchaseLine(idx, { diaPcs: e.target.value })} className="rounded-xl h-10" placeholder="Pcs (how many stones)" />
                    <Input type="number" min={0} value={line.diaRate} onChange={e => updatePurchaseLine(idx, { diaRate: e.target.value })} className="rounded-xl h-10" placeholder={`Rate/ct (${line.currency})`} />
                  </div>
                  {line.diaKind === "certified" && (
                    <>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                        <Input value={line.diaCertNo} onChange={e => updatePurchaseLine(idx, { diaCertNo: e.target.value })} className="rounded-xl h-10" placeholder="Report / Certificate #" />
                        <Input value={line.diaLab} onChange={e => updatePurchaseLine(idx, { diaLab: e.target.value })} className="rounded-xl h-10" placeholder="Lab — GIA / IGI (optional)" />
                      </div>
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                        <Input value={line.diaColor} onChange={e => updatePurchaseLine(idx, { diaColor: e.target.value })} className="rounded-xl h-10" placeholder="Color" />
                        <Input value={line.diaClarity} onChange={e => updatePurchaseLine(idx, { diaClarity: e.target.value })} className="rounded-xl h-10" placeholder="Clarity" />
                        <Input value={line.diaCut} onChange={e => updatePurchaseLine(idx, { diaCut: e.target.value })} className="rounded-xl h-10" placeholder="Cut" />
                        <Input value={line.diaFluor} onChange={e => updatePurchaseLine(idx, { diaFluor: e.target.value })} className="rounded-xl h-10" placeholder="FL (fluor.)" />
                      </div>
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                        <Input value={line.diaPolish} onChange={e => updatePurchaseLine(idx, { diaPolish: e.target.value })} className="rounded-xl h-10" placeholder="Polish" />
                        <Input value={line.diaSym} onChange={e => updatePurchaseLine(idx, { diaSym: e.target.value })} className="rounded-xl h-10" placeholder="Symmetry" />
                        <Input value={line.diaMeasure} onChange={e => updatePurchaseLine(idx, { diaMeasure: e.target.value })} className="rounded-xl h-10" placeholder="Measurement (mm)" />
                      </div>
                      <p className="text-[11px] text-muted-foreground">Each certified stone is one line = one packet. Add another line for another stone.</p>
                    </>
                  )}
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                <Select value={line.currency} onValueChange={v => updatePurchaseLine(idx, { currency: v as PurchaseCurrency })}>
                  <SelectTrigger className="h-10 rounded-xl"><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="INR">Billed in INR</SelectItem><SelectItem value="USD">Billed in USD</SelectItem></SelectContent>
                </Select>
                {line.currency === "USD" && (
                  <>
                    <Input type="number" min={0} value={line.totalUsd} onChange={e => updatePurchaseLine(idx, { totalUsd: e.target.value })} className="rounded-xl h-10" placeholder="Total ($)" />
                    <Input type="number" min={0} step="0.01" value={line.exchangeRate} onChange={e => updatePurchaseLine(idx, { exchangeRate: e.target.value })} className="rounded-xl h-10" placeholder="Exchange rate (₹/$)" />
                  </>
                )}
              </div>

              <Input value={line.notes} onChange={e => updatePurchaseLine(idx, { notes: e.target.value })} className="rounded-xl h-10" placeholder="Notes (optional)" />

              <p className="text-xs text-muted-foreground text-right">Line total: <span className="font-semibold text-foreground">{fmtMoneyInr(purchaseLineTotalInr(line))}</span></p>
            </div>
          ))}

          <Button type="button" variant="outline" onClick={addPurchaseLine} className="rounded-xl gap-2 w-full">
            <Plus className="h-4 w-4" /> Add Another Item (different size/quality)
          </Button>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 items-end">
            <div>
              <Label className="text-xs">Round off ₹</Label>
              <Input type="number" step="1" value={roundOff} onChange={e => setRoundOff(e.target.value)}
                className="rounded-xl h-10 mt-1" placeholder="e.g. -3" />
            </div>
            {linesTotalInr > 0 && roundOffInr === 0 && linesTotalInr % 10 !== 0 && (
              <button type="button" onClick={() => setRoundOff(String(-(linesTotalInr % 10)))}
                className="text-xs text-primary hover:underline text-left h-10 flex items-end pb-2.5">
                Round {fmtMoneyInr(linesTotalInr)} down to {fmtMoneyInr(linesTotalInr - (linesTotalInr % 10))}
              </button>
            )}
          </div>
        </div>
      </ActionSheet>

      <ActionSheet
        open={showPayForm}
        onOpenChange={setShowPayForm}
        title="Record Payment"
        description={<>To {supplier.name}{account.net > 0 ? <> — {fmtMoneyInr(account.net)} owed</> : null}. Against their oldest bills, one bill, or as an advance.</>}
        icon={CreditCard}
        footer={
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="min-w-0">
              <p className="text-xs text-muted-foreground">Paying</p>
              <p className="font-display text-lg font-bold text-brand-dark leading-tight">{fmtMoneyInr(Number(payAmount) || 0)}</p>
              {/* The locker's balance before the money leaves it — the save still
                  asks before letting it go negative. */}
              {payFromLocker && <p className="text-[11px] text-muted-foreground truncate">{payFromLocker.name} holds {fmtLockerAmount(lockerBalance(payFromLocker, db.lockerTransactions), payFromLocker.currency)}</p>}
            </div>
            <div className="flex gap-2.5 ml-auto">
              <Button variant="outline" onClick={() => setShowPayForm(false)} className="rounded-xl h-10">Cancel</Button>
              <AsyncButton onClick={recordPayment} className="btn-hero rounded-xl h-10">Save Payment</AsyncButton>
            </div>
          </div>
        }
      >
        <div className="space-y-3">
          <Input type="number" min={1} value={payAmount} onChange={e => setPayAmount(e.target.value)} autoFocus className="rounded-xl h-10" placeholder="Amount (₹)" />
          <Select value={payLockerId} onValueChange={addNew("locker", setPayLockerId)}>
            <SelectTrigger className="h-10 rounded-xl"><SelectValue placeholder="From which locker?" /></SelectTrigger>
            <SelectContent>{db.lockers.filter(l => l.active !== false && (l.currency || "INR") === "INR").map(l => <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>)}<AddNewItem kind="locker" /></SelectContent>
          </Select>
          <Select value={payTargetPurchase} onValueChange={setPayTargetPurchase}>
            <SelectTrigger className="h-10 rounded-xl"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__fifo">Oldest pending first (unspecified)</SelectItem>
              <SelectItem value="__advance">Advance / loan — not against any bill</SelectItem>
              {pendingPurchases.map(p => (
                <SelectItem key={p.id} value={p.id}>{p.invoiceNumber || p.id.slice(-6)} — pending {fmtMoneyInr(purchasePending(p))}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input value={payNote} onChange={e => setPayNote(e.target.value)} className="rounded-xl h-10" placeholder="Note (optional)" />
        </div>
      </ActionSheet>

      <ActionSheet
        open={showReceiveForm}
        onOpenChange={setShowReceiveForm}
        title={`Receive from ${supplier.name}`}
        description="Money the supplier gave back (refund / return credit). It goes into a locker and reduces what you owe them."
        icon={ArrowDownCircle}
        footer={
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="min-w-0">
              <p className="text-xs text-muted-foreground">Receiving</p>
              <p className="font-display text-lg font-bold text-brand-dark leading-tight">{fmtMoneyInr(Number(rcvAmount) || 0)}</p>
            </div>
            <div className="flex gap-2.5 ml-auto">
              <Button variant="outline" onClick={() => setShowReceiveForm(false)} className="rounded-xl h-10">Cancel</Button>
              <AsyncButton onClick={recordReceipt} className="btn-hero rounded-xl h-10">Save Receipt</AsyncButton>
            </div>
          </div>
        }
      >
        <div className="space-y-3">
          <Input type="number" min={1} value={rcvAmount} onChange={e => setRcvAmount(e.target.value)} autoFocus className="rounded-xl h-10" placeholder="Amount received (₹)" />
          <Select value={rcvLockerId} onValueChange={addNew("locker", setRcvLockerId)}>
            <SelectTrigger className="h-10 rounded-xl"><SelectValue placeholder="Into which locker?" /></SelectTrigger>
            <SelectContent>{db.lockers.filter(l => l.active !== false && (l.currency || "INR") === "INR").map(l => <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>)}<AddNewItem kind="locker" /></SelectContent>
          </Select>
          <Input value={rcvNote} onChange={e => setRcvNote(e.target.value)} className="rounded-xl h-10" placeholder="Note (e.g. refund for returned goods)" />
        </div>
      </ActionSheet>
    </div>
  );
}
