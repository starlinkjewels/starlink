import { BuyMaterialForm } from "@/components/BuyMaterialForm";
import { brokerSuppliers } from "@/lib/brokers";
import { useCan, useMayExport } from "@/hooks/useCan";
import type { MoreAction } from "@/components/MoreMenu";
import { PageHeader } from "@/components/PageHeader";
import { SectionTitle } from "@/components/SectionTitle";
import { AddNewItem, useAddNew } from "@/components/create/QuickCreate";
import { bagNoOfPurchase } from "@/lib/diamondBags";
import { diamondSpec, isOtherMaterial, materialName, materialUnit, purchaseQty, purchaseText } from "@/lib/materials";
import { useState } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { collectionLoaded, updateDb, uid, fmtDate, todayLocal, stampFor, KARAT_PURITY, hasOpeningBalance, openingDebitAmt, openingCreditAmt, type Purchase, type LedgerDir, type Supplier } from "@/lib/db";
import { OpeningBalanceFields } from "@/components/OpeningBalanceFields";
import { useDb } from "@/hooks/useDb";
import { useAuth } from "@/lib/auth";
import {
  supplierAccount, groupPaymentsAsMade, purchasePaid, purchasePending, allocateSupplierPaymentFIFO, fmtMoneyInr, lockerBalance, fmtLockerAmount,
} from "@/lib/manufacturing";
import {
  canVoidPurchase, canEditPurchase, editPurchase, voidPurchase as voidPurchaseCascade,
  purchaseLabel, voidImpact, purchaseEditScope, type PurchaseEdit,
} from "@/lib/purchaseVoid";
import { listEntries, type MoneyEntry } from "@/lib/moneyEntries";
import { MoneyEntryEditor, confirmDeleteEntry, entryRowActions } from "@/components/MoneyEntryEditor";
import { SupplierEditDialog } from "@/components/SupplierEditDialog";
import { SellToSupplierSheet } from "@/components/SellToSupplierSheet";
import { saleLineCost, saleUndoBlocker, saleUndoImpact, undoSupplierSale } from "@/lib/supplierSales";
import { saleBrokerageWePay } from "@/lib/brokers";
import { supplierDeleteGuard, deleteRefusal } from "@/lib/partyGuards";
import { needsAccess } from "@/lib/actionHints";
import { EditPurchaseDialog } from "@/components/EditPurchaseDialog";
import { ActionSheet } from "@/components/ActionSheet";
import { StatStrip } from "@/components/TableToolbar";
import { joinDots } from "@/components/party/joinDots";
import { lastPayLocker, rememberPayLocker } from "@/components/party/payLocker";
import { Button } from "@/components/ui/button";
import { AsyncButton } from "@/components/AsyncButton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Plus, CreditCard, Wallet, ShoppingBag, BookOpen,
  Download, Trash2, Pencil, ArrowDownCircle, ExternalLink, Lock,
  Handshake, Tag,
} from "lucide-react";
import { toast } from "sonner";
import { downloadCsv, downloadLedgerPdf, fmtInrPlain } from "@/lib/ledgerExport";
import { StatementLedger, type StatementRow } from "@/components/StatementLedger";
import { DataTable, CellMain, CellTag, CellAmount, CellDate, type DataColumn } from "@/components/DataTable";
import { ExportDialog, inDateRange } from "@/components/ExportDialog";
import { confirmBox } from "@/lib/confirm";
import { fmtCcy } from "@/lib/currency";
import { companyById, hasCompanies } from "@/lib/companies";
import { filled, lockerLabel, noteText, recorded, userName, type Detail } from "@/components/rowDetails";



export function SupplierHistoryPage() {
  const { id } = useParams();
  const db = useDb();
  if (!(db.suppliers.some(s => s.id === id))) {
    return (
      <div className="text-center py-20 text-muted-foreground">
        {collectionLoaded("suppliers") ? "Supplier not found." : "Loading…"}{" "}
        <Link to="/suppliers" className="inline-block py-2.5 -my-2.5 text-primary underline">Back</Link>
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
        Supplier not found. <Link to="/suppliers" className="inline-block py-2.5 -my-2.5 text-primary underline">Back to Suppliers</Link>
      </div>
    );
  }

  const purchases = db.purchases
    .filter(p => p.supplierId === id)
    .sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));
  const receipts = (db.supplierReceipts ?? []).filter(r => r.supplierId === id);
  // Advances and loans — paid to this supplier but settling no particular bill.
  const advances = (db.supplierPayments ?? []).filter(x => x.supplierId === id);
  // Goods we sold them — come off what we owe (lib/supplierSales.ts).
  const sales = (db.supplierSales ?? []).filter(x => x.supplierId === id).sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));
  const account = supplierAccount(purchases, receipts, supplier, advances, sales);

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
  const openingSet = hasOpeningBalance(supplier);
  // Opened from the ⋯: the card appears under the figures, brought into view.
  const openOpening = () => {
    setObOpen(true);
    setTimeout(() => document.getElementById("opening-balance")?.scrollIntoView({ behavior: "smooth", block: "start" }), 60);
  };
  // Who to call, on one line under the name — the phone dials from a phone.
  const contactLine = joinDots([
    supplier.contactPerson,
    supplier.phone && <a key="tel" href={`tel:${supplier.phone.replace(/\s+/g, "")}`} className="text-primary hover:underline whitespace-nowrap">{supplier.phone}</a>,
    supplier.email && <a key="mail" href={`mailto:${supplier.email}`} className="hover:underline break-all">{supplier.email}</a>,
    supplier.gstin && `GSTIN ${supplier.gstin}`,
    supplier.address,
  ]);

  // ── Record purchase ──
  const [showExport, setShowExport] = useState(false);
  const [showPurchaseForm, setShowPurchaseForm] = useState(false);
  // Record Purchase opens New purchase (components/BuyMaterialForm), this supplier already chosen —
  // one purchase form everywhere: the same fields, broker, discount, date and "for an order".

  // ── Record payment ──
  const [showPayForm, setShowPayForm] = useState(false);
  const [payAmount, setPayAmount] = useState("");
  const [payLockerId, setPayLockerId] = useState("");
  const [payTargetPurchase, setPayTargetPurchase] = useState<string>("__fifo");
  const [payNote, setPayNote] = useState("");
  // The day the money went — today unless the payment is being entered late.
  const [payDate, setPayDate] = useState(todayLocal());
  // Shown in the panel's footer only; the save looks the locker up afresh.
  const payFromLocker = db.lockers.find(l => l.id === payLockerId);
  const payLockers = db.lockers.filter(l => l.active !== false && (l.currency || "INR") === "INR");
  // Opens on the account this person last paid from, unless one is already picked.
  const openPay = () => {
    if (!payLockerId) { const last = lastPayLocker(user?.id); if (payLockers.some(l => l.id === last)) setPayLockerId(last); }
    setShowPayForm(true);
  };

  const recordPayment = async () => {
    const amt = Number(payAmount);
    if (!amt || amt <= 0) { toast.error("Enter a valid amount"); return; }
    if (!payLockerId) { toast.error("Choose which locker this payment came from"); return; }
    if (!payDate) { toast.error("Choose the date"); return; }
    if (payDate > todayLocal()) { toast.error("A payment can't be dated after today"); return; }
    // Overpayment allowed — the excess beyond what's owed is parked on the newest
    // purchase (shows as Overpaid), never silently lost.
    const payLocker = db.lockers.find(l => l.id === payLockerId);
    if (payLocker && amt > lockerBalance(payLocker, db.lockerTransactions) &&
        !(await confirmBox(`This payment of ${fmtLockerAmount(amt, payLocker.currency)} is more than ${payLocker.name}'s balance of ${fmtLockerAmount(lockerBalance(payLocker, db.lockerTransactions), payLocker.currency)}. The locker will go negative — continue only if a deposit is still missing.`))) return;
    // The picked day (at the time of entry), on the payment and its account
    // entry alike — what was "now" before a date could be chosen.
    const now = stampFor(payDate);

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
    rememberPayLocker(user?.id, payLockerId);
    toast.success("Payment recorded");
    setPayAmount(""); setPayNote(""); setPayTargetPurchase("__fifo"); setPayDate(todayLocal()); setShowPayForm(false);
  };

  // ── Receive money FROM the supplier (refund / return credit) ──
  const [showReceiveForm, setShowReceiveForm] = useState(false);
  const [showSell, setShowSell] = useState(false);
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
        hint: !isAdmin ? ADMIN_ONLY : voidable.ok ? "Reverses due, stock and factory issue" : voidable.reason },
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
    if (r.kind === "Sale") {
      const sale = sales.find(x => x.id === r.id);
      if (!sale) return [];
      const block = saleUndoBlocker(db, sale);
      return [
        { label: "Edit", icon: Lock, disabled: true, hint: "Delete it and record it again", onSelect: () => {} },
        { label: "Delete sale", icon: Trash2, danger: true, disabled: !isAdmin || !!block, hint: !isAdmin ? "Admins only" : block ?? "Back into stock; its money removed",
          onSelect: async () => {
            if (!(await confirmBox([`Delete this sale to ${supplier.name}?`, ...saleUndoImpact(db, sale)], { danger: true, confirmText: "Delete sale" }))) return;
            try { await undoSupplierSale(db, sale, user!); toast.success("Sale deleted — back in stock"); }
            catch (e) { toast.error(e instanceof Error ? e.message : "The sale couldn't be deleted"); }
          } },
      ];
    }
    if (r.kind !== "Payment" && r.kind !== "Received" && r.kind !== "Advance") return [];
    // Money received for a sale belongs to the sale: corrected alone, the two would disagree.
    const forSale = r.kind === "Received" ? receipts.find(x => x.id === r.id)?.saleId : undefined;
    if (forSale) return [{ label: "Edit", icon: Lock, disabled: true, hint: "Part of a sale to them — delete the sale to change it", onSelect: () => {} }];
    const e = entryOf(r.id);
    if (!e) {
      const why = "Correct it in Payments → Supplier payments";
      return [{ label: "Edit", icon: Lock, disabled: true, hint: why, onSelect: () => {} }];
    }
    return entryRowActions(e, {
      mayEdit: can("payments", "edit"), mayDelete: can("payments", "delete"),
      editNeeds: needsAccess("payments", "edit"), deleteNeeds: needsAccess("payments", "delete"),
      onEdit: setEditingEntry, onDelete: x => { void confirmDeleteEntry(db, x); },
      go: navigate, mayOpen: m => can(m),
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
      ].filter(Boolean);
      return bits.join(" · ");
    }
    if (isOtherMaterial(p.material)) {
      return [materialName(db.settings, p.material), p.other?.grade && p.other.grade !== "—" ? p.other.grade : undefined,
        p.other?.pieces ? `${p.other.pieces} pcs` : undefined].filter(Boolean).join(" · ");
    }
    const d = p.diamond;
    const bits = [
      d?.kind === "certified" ? "Certified diamond" : "Loose diamond",
      // Shape · size · colour · clarity · pcs, or the stone's report.
      bagNoOfPurchase(db, p),
      diamondSpec(d, d?.kind === "certified" ? (db.diamondPackets ?? []).find(x => x.purchaseId === p.id) : undefined),
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
      const via = r.viaBrokerId ? (db.brokers ?? []).find(b => b.id === r.viaBrokerId)?.name ?? "the broker" : "";
      rows.push({ id: r.id, date: r.createdAt, particulars: `${via ? `Paid to ${via} for us` : "Received from supplier"}${r.note ? ` — ${r.note}` : ""}`, debit: r.amountInr, credit: 0, balance: 0, kind: "Received" });
    }
    // Goods we sold them: owed to us, so it comes off what we owe — a credit, as a payment is.
    for (const sale of sales) {
      rows.push({ id: sale.id, date: sale.createdAt, particulars: `Sold to them — ${sale.lines.map(l => l.label).join(", ")}${sale.notes ? ` · ${sale.notes}` : ""}`,
        qty: sale.lines.length === 1 ? sale.lines[0].qty : undefined, unit: sale.lines.length === 1 ? sale.lines[0].unit : undefined,
        rate: sale.lines.length === 1 ? sale.lines[0].rateInr : undefined,
        debit: 0, credit: sale.totalInr, balance: 0, kind: "Sale" });
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
      ["Date", "Bill No", "Order No", "Particulars", "Weight", "Rate (INR)", "Bill Amount (INR)", "Paid (INR)", "Balance (INR)"],
      statementAsc.filter(r => inDateRange(r.date, from, to)).map(r => [
        r.id === "opening" ? "Opening" : fmtDate(r.date),
        r.invoiceNo ?? "", r.orderNo ?? "", r.particulars,
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
        `Report Generated: ${new Date().toLocaleDateString("en-IN", { month: "long", day: "numeric", year: "numeric" })}`,
      ].filter(Boolean),
      summary: [
        { label: "Total Purchased", value: fmtInrPlain(account.totalPurchased) },
        { label: "Total Paid", value: fmtInrPlain(account.totalPaid) },
        { label: "Balance Owed", value: fmtInrPlain(account.balanceOwed) },
        // The figure the table below actually closes on: what is owed after any
        // refunds received and any purchase that was overpaid.
        { label: "Closing Balance", value: fmtInrPlain(account.net) },
        { label: "Overpaid", value: fmtInrPlain(account.overpaid) },
        ...(account.sold > 0 ? [{ label: "Sold to them", value: fmtInrPlain(account.sold) }] : []),
      ],
      // Landscape: a jeweller’s ledger line is the weight, the supplier’s invoice
      // number, the order it was for, the rate and the amount. None of that fits a
      // portrait page, which is why the particulars were being cut off mid-word.
      landscape: true,
      columns: [
        { header: "Date", x: 14 },
        { header: "Bill No", x: 38 },
        { header: "Order No", x: 62 },
        { header: "Particulars", x: 92 },
        { header: "Weight", x: 158 },
        { header: "Rate", x: 184 },
        { header: "Bill Amount", x: 210 },
        { header: "Paid", x: 240 },
        { header: "Balance", x: 264 },
      ],
      align: ["left", "left", "left", "left", "right", "right", "right", "right", "right"],
      rows: statementAsc.filter(r => inDateRange(r.date, from, to)).map(r => [
        r.id === "opening" ? "Opening" : fmtDate(r.date),
        fit(r.invoiceNo ?? "", 22),
        fit(r.orderNo ?? "", 28),
        fit(r.particulars, 64),
        r.qty ? `${r.qty}${r.unit ?? ""}` : "",
        r.rate ? fmtInrPlain(r.rate).replace("Rs. ", "") : "",
        r.debit ? fmtInrPlain(r.debit).replace("Rs. ", "") : "",
        r.credit ? fmtInrPlain(r.credit).replace("Rs. ", "") : "",
        fmtInrPlain(r.balance).replace("Rs. ", ""),
      ]),
      // A totals line so the columns prove themselves: bills less payments is
      // the balance the last row closes on.
      totalsRow: ["", "", "", "Totals", "", "",
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
    : p.material === "diamond" ? `${p.diamond?.carat}ct ${p.diamond?.kind === "certified" ? "certified" : "loose"} diamond`
    : purchaseText(db.settings, p);
  /** A diamond's lot or report under its title: "Round · +6.5-7 · G-H · VS · 12 pcs". */
  const purchaseSub = (p: Purchase) => p.material !== "diamond" ? undefined
    : [bagNoOfPurchase(db, p), diamondSpec(p.diamond, p.diamond?.kind === "certified" ? (db.diamondPackets ?? []).find(x => x.purchaseId === p.id) : undefined)].filter(Boolean).join(" · ") || undefined;
  const purchaseColumns: DataColumn<Purchase>[] = [
    { key: "date", header: "Date", always: true, kind: "date", sortValue: p => +new Date(p.createdAt), csv: p => fmtDate(p.createdAt),
      cell: p => <CellDate>{fmtDate(p.createdAt)}</CellDate> },
    { key: "purchase", header: "Purchase", always: true, sortValue: p => purchaseTitle(p), csv: p => purchaseTitle(p),
      cell: p => <CellMain title={purchaseTitle(p)} sub={[purchaseSub(p), p.currency === "USD" ? `$${p.totalUsd} @ ₹${p.exchangeRate}/$` : undefined].filter(Boolean).join(" · ") || undefined} /> },
    { key: "for", header: "For", sortValue: p => (p.purpose === "order" ? `Order ${orderOf(p)?.orderNumber ?? ""}` : "Stock"),
      csv: p => (p.purpose === "order" ? `Order ${orderOf(p)?.orderNumber ?? ""}`.trim() : "Stock"),
      cell: p => {
        if (p.purpose !== "order") return <CellTag>Stock</CellTag>;
        const o = orderOf(p);
        return o
          ? <Link to={`/orders/${o.id}`} className="inline-block py-2.5 -my-2.5 hover:opacity-80"><CellTag tone="blue">For Order {o.orderNumber}</CellTag></Link>
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
    const sale = sales.find(x => x.id === r.id);
    if (sale) {
      const broker = sale.brokerId ? (db.brokers ?? []).find(b => b.id === sale.brokerId) : undefined;
      const costs = sale.lines.map(l => saleLineCost(db, sale, l));
      const cost = costs.every(c => c != null) ? costs.reduce((t: number, c) => t + (c ?? 0), 0) : null;
      return filled([
        { label: "Sold", value: sale.lines.map(l => `${l.label} — ${fmtMoneyInr(l.amountInr)}`).join("; ") },
        broker && { label: "Broker", value: `${broker.name} · ${fmtMoneyInr(sale.brokerageInr ?? 0)} ${sale.brokeragePaidBy === "supplier" ? "(supplier pays)" : "(we pay)"}` },
        isAdmin && { label: "Cost to us", value: cost == null ? "Not known for every line" : `${fmtMoneyInr(cost)} · profit ${fmtMoneyInr(sale.totalInr - cost - saleBrokerageWePay(sale))}` },
        hasCompanies(db.settings) && { label: "Company", value: companyById(db.settings, sale.companyId).name },
        { label: "Note", value: noteText(sale.notes) },
        { label: "Recorded", value: recorded(db, sale.createdAt, sale.soldBy) },
      ]);
    }
    const other = receipts.find(x => x.id === r.id) ?? advances.find(x => x.id === r.id);
    if (other) return filled([
      { label: r.kind === "Received" ? "Into account" : "Paid from", value: "viaBrokerId" in other && other.viaBrokerId ? `Held by ${(db.brokers ?? []).find(b => b.id === other.viaBrokerId)?.name ?? "the broker"}` : lockerLabel(db, other.lockerId) },
      { label: "Note", value: noteText(other.note) },
      { label: "Recorded", value: recorded(db, other.createdAt, other.recordedBy) },
    ]);
    return [];
  };

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      {/* The name row and the money: a purchase is what people come here to
          record, a payment the next most; the rest waits in the ⋯. */}
      <PageHeader
        back={{ label: "Back to Suppliers", to: "/suppliers" }}
        title={supplier.name}
        subtitle={contactLine}
        primary={isAdmin ? { label: "Record Purchase", icon: Plus, onClick: () => setShowPurchaseForm(true) } : null}
        secondary={isAdmin ? { label: "Pay", icon: CreditCard, onClick: openPay } : null}
        menu={[
          // Set once, when moving from an old system — so out of sight until then.
          { label: "Opening balance", icon: BookOpen, hint: "Not set — what was owed before the app", onSelect: openOpening, show: isAdmin && !openingSet },
          { label: "Sell to them", icon: Tag, hint: "Diamonds, gold, a piece — off what we owe", onSelect: () => setShowSell(true), show: isAdmin },
          { label: "Receive money", icon: ArrowDownCircle, hint: "A refund from them", onSelect: () => setShowReceiveForm(true), show: user?.role === "admin" },
          { label: "Export statement", icon: Download, hint: "PDF or Excel", onSelect: () => setShowExport(true), show: mayExport },
          { label: "Edit details", icon: Pencil, onSelect: () => setEditingSupplier(supplier), disabled: !isAdmin,
            hint: isAdmin ? "Name, contact, GSTIN, address" : "Only an admin can change suppliers" },
          { label: "Delete supplier", icon: Trash2, danger: true, onSelect: deleteSupplier, disabled: !isAdmin || !deleteGuard.ok,
            hint: !isAdmin ? "Only an admin can change suppliers" : deleteGuard.reason },
        ]}
      >
        {/* The brokers who bring this supplier's goods — and what is still pending through each. */}
        {(() => {
          const linked = (db.brokers ?? []).filter(b => brokerSuppliers(db, b).includes(supplier.id));
          if (!linked.length) return null;
          return (
            <p className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
              <Handshake className="h-3.5 w-3.5" />
              {linked.map(b => {
                const pending = (db.purchases ?? []).filter(p => p.brokerId === b.id && p.supplierId === supplier.id).reduce((t, p) => t + purchasePending(p), 0);
                return (
                  <Link key={b.id} to={`/suppliers/brokers/${b.id}`} className="text-primary hover:underline">
                    Broker {b.name}{pending > 0.5 ? ` · ${fmtMoneyInr(pending)} pending through them` : ""}
                  </Link>
                );
              })}
            </p>
          );
        })()}
      </PageHeader>

      {/* Where the account stands, first: what we owe them (or they owe us),
          what was paid, what was bought — the statement's own figures. Who
          they are is the line under the name. */}
      <StatStrip items={[
        account.net < 0
          ? { label: "They owe us", value: fmtMoneyInr(-account.net), icon: ArrowDownCircle, tone: "in" as const, sub: "After refunds and overpaid bills" }
          : { label: "We owe", value: account.net > 0 ? fmtMoneyInr(account.net) : "✓ Settled", icon: Wallet, tone: account.net > 0 ? "out" as const : "in" as const,
              sub: account.net > 0 ? "After advances and refunds" : "Nothing owed" },
        { label: "Paid", value: fmtMoneyInr(account.totalPaid), icon: CreditCard, tone: "in", sub: "Bills and advances" },
        { label: "Purchased", value: fmtMoneyInr(account.totalPurchased), icon: ShoppingBag, sub: `${purchases.length} purchase${purchases.length === 1 ? "" : "s"}` },
        ...(account.received > 0 ? [{ label: "Refunds received", value: fmtMoneyInr(account.received), icon: ArrowDownCircle }] : []),
        ...(account.sold > 0 ? [{ label: "Sold to them", value: fmtMoneyInr(account.sold), icon: Tag }] : []),
      ]} />
      <ExportDialog open={showExport} onClose={() => setShowExport(false)} title={`${supplier.name} ledger`} options={[
        { label: "Account Statement — PDF", sublabel: "Purchases, payments & receipts", kind: "pdf", run: exportPdf },
        { label: "Account Statement — Excel", sublabel: "Purchases, payments & receipts", kind: "excel", run: exportCsv },
      ]} />

      {/* Opening balance (migration) — admin only; once set it stays in view,
          until then it waits in the ⋯. */}
      {isAdmin && (openingSet || obOpen) && (
        <div id="opening-balance" className="card-luxe p-5 scroll-mt-20">
          <SectionTitle title="Opening Balance"
            sub={hasOpeningBalance(supplier)
              ? `${fmtMoneyInr(Math.abs(supplier.openingBalance!))} · ${supplier.openingDir === "credit" ? "we owe supplier" : "supplier owes us"}${supplier.openingDate ? ` · as of ${fmtDate(supplier.openingDate)}` : ""}`
              : "Not set"}
            info="The balance carried in from your previous system."
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
                debitLabel="Supplier owes us (Debit)"
                creditLabel="We owe supplier (Credit)"
                hint="Owed either way when you started (₹)."
              />
              <div className="col-span-2">
                <AsyncButton onClick={saveOpening} className="btn-hero rounded-xl h-10">Save Opening Balance</AsyncButton>
              </div>
            </div>
          )}
        </div>
      )}
      {/* Account Statement — the same ledger people read on Stock and Locker:
          filters, then every entry with a running balance. Its figures (what
          was bought, paid and refunded, and where that leaves the account)
          are the strip under the header, so they are not said twice. */}
      <StatementLedger
        title="Account Statement"
        caption={`${statement.length} entr${statement.length !== 1 ? "ies" : "y"} · INR`}
        rows={statement}
        fmt={fmtMoneyInr}
        debitLabel="Bill"
        creditLabel="Paid"
        details={statementDetails}
        rowActions={statementActions}
        onExport={() => setShowExport(true)}
      />


      {/* Purchase history */}
      <div className="card-luxe overflow-hidden">
        {/* How many is the table's own count. */}
        <SectionTitle title="Purchase History" className="px-5 py-4 border-b border-border/60" />
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
            emptyAction={!purchases.length && isAdmin ? { label: "Record a purchase", onClick: () => setShowPurchaseForm(true) } : undefined}
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
      <SellToSupplierSheet open={showSell} onOpenChange={setShowSell} supplierId={id!} />

      {/* The three money actions slide in from the right, so the ledger and the
          statement behind stay where they were. Closing a panel keeps what was
          typed (a long bill isn't lost to a stray click); Cancel clears it,
          exactly as the inline forms did. */}
      <BuyMaterialForm open={showPurchaseForm} onOpenChange={setShowPurchaseForm} supplierId={id!} />

      <ActionSheet
        open={showPayForm}
        onOpenChange={setShowPayForm}
        title="Record Payment"
        description={<>To {supplier.name}{account.net > 0 ? <> · {fmtMoneyInr(account.net)} owed</> : null}</>}
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
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Amount (₹)</Label>
              <Input type="number" min={1} value={payAmount} onChange={e => setPayAmount(e.target.value)} autoFocus className="rounded-xl h-10 mt-1" placeholder="0" aria-label="Amount" />
            </div>
            <div>
              <Label className="text-xs">Date</Label>
              <Input type="date" value={payDate} max={todayLocal()} onChange={e => setPayDate(e.target.value)} className="rounded-xl h-10 mt-1" aria-label="Date" />
            </div>
          </div>
          {/* What is pending for what it is against: the one bill picked, or the
              whole account (oldest first). An advance has no "full". */}
          {(() => {
            const bill = pendingPurchases.find(p => p.id === payTargetPurchase);
            const full = bill ? purchasePending(bill) : payTargetPurchase === "__fifo" ? account.net : 0;
            if (!(full > 0) || Number(payAmount) === full) return null;
            return (
              <button type="button" onClick={() => setPayAmount(String(full))}
                className="-mt-1 inline-flex items-center h-7 px-2.5 rounded-full border border-primary/30 bg-primary/5 text-xs font-medium text-primary hover:bg-primary/10">
                Full amount · {fmtMoneyInr(full)}
              </button>
            );
          })()}
          <div>
            <Label className="text-xs">From account</Label>
            <Select value={payLockerId} onValueChange={addNew("locker", setPayLockerId)}>
              <SelectTrigger className="h-10 rounded-xl mt-1" aria-label="From account"><SelectValue placeholder="Choose a rupee account" /></SelectTrigger>
              <SelectContent>{payLockers.map(l => <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>)}<AddNewItem kind="locker" /></SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Against</Label>
            <Select value={payTargetPurchase} onValueChange={setPayTargetPurchase}>
              <SelectTrigger className="h-10 rounded-xl mt-1" aria-label="Against"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__fifo">Oldest pending first (unspecified)</SelectItem>
                <SelectItem value="__advance">Advance / loan — not against any bill</SelectItem>
                {pendingPurchases.map(p => (
                  <SelectItem key={p.id} value={p.id}>{p.invoiceNumber || p.id.slice(-6)} — pending {fmtMoneyInr(purchasePending(p))}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Note</Label>
            <Input value={payNote} onChange={e => setPayNote(e.target.value)} className="rounded-xl h-10 mt-1" placeholder="Optional — bank ref, cheque no." aria-label="Note" />
          </div>
        </div>
      </ActionSheet>

      <ActionSheet
        open={showReceiveForm}
        onOpenChange={setShowReceiveForm}
        title={`Receive from ${supplier.name}`}
        description="A refund — it lowers what you owe them"
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
