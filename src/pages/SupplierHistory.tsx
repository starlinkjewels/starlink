import { BuyMaterialForm } from "@/components/BuyMaterialForm";
import { CustomFieldsView } from "@/components/CustomFields";
import { Undo2, Printer, ClipboardList, Truck } from "lucide-react";
import { PoSheet, PurchaseOrdersPanel } from "@/components/PurchaseOrders";
import { LandedCostSheet } from "@/components/LandedCostSheet";
import { landedExtraInr, landedKindLabel, takesLanded } from "@/lib/landedCost";
import { PurchaseReturnSheet, printDebitNote } from "@/components/PurchaseReturnSheet";
import { PartyMemos } from "@/components/MemoSheets";
import { brokerSuppliers } from "@/lib/brokers";
import { useCan, useHas, useMayExport } from "@/hooks/useCan";
import type { MoreAction } from "@/components/MoreMenu";
import { PageHeader, TabBar } from "@/components/PageHeader";
import { usePageTab } from "@/hooks/usePageTab";
import { SectionTitle } from "@/components/SectionTitle";
import { AddNewItem, useAddNew } from "@/components/create/QuickCreate";
import { bagNoOfPurchase } from "@/lib/diamondBags";
import { diamondSpec, isOtherMaterial, isReadyPiece, materialName, materialUnit, purchaseQty, purchaseText, readyPieceSpec } from "@/lib/materials";
import { gstTag, gstText, preGstInr, purchaseGstInr, pctText } from "@/lib/purchaseGst";
import { useEffect, useState } from "react";
import { useParams, Link, useNavigate, useSearchParams } from "react-router-dom";
import { supplierBillsDue } from "@/lib/supplierDue";
import { collectionLoaded, updateDb, uid, fmtDate, todayLocal, stampFor, KARAT_PURITY, hasOpeningBalance, openingDebitAmt, openingCreditAmt, type Purchase, type LedgerDir, type Supplier } from "@/lib/db";
import { OpeningBalanceFields } from "@/components/OpeningBalanceFields";
import { useDb } from "@/hooks/useDb";
import { useAuth } from "@/lib/auth";
import {
  supplierAccount, groupPaymentsAsMade, purchasePaid, purchasePending, fmtMoneyInr, lockerBalance, fmtLockerAmount,
} from "@/lib/manufacturing";
import {
  canVoidPurchase, canEditPurchase, editPurchase, voidPurchase as voidPurchaseCascade,
  purchaseLabel, voidImpact, purchaseEditScope, type PurchaseEdit,
} from "@/lib/purchaseVoid";
import { listEntries, type MoneyEntry } from "@/lib/moneyEntries";
import { MoneyEntryEditor, confirmDeleteEntry, entryRowActions } from "@/components/MoneyEntryEditor";
import { SupplierEditDialog } from "@/components/SupplierEditDialog";
import { SellToSupplierSheet } from "@/components/SellToSupplierSheet";
import { SupplierGoldPanel, type GoldMode } from "@/components/SupplierGoldPanel";
import { fmtG, goldAccountReady, hasGoldAccount, owedIn, supplierGoldOwed } from "@/lib/supplierGold";
import { saleLineCost, saleUndoBlocker, saleUndoImpact, undoSupplierSale } from "@/lib/supplierSales";
import { saleBrokerageWePay } from "@/lib/brokers";
import { supplierDeleteGuard, deleteRefusal } from "@/lib/partyGuards";
import { needsAccess } from "@/lib/actionHints";
import { EditPurchaseDialog } from "@/components/EditPurchaseDialog";
import { ActionSheet } from "@/components/ActionSheet";
import { StatStrip } from "@/components/TableToolbar";
import { joinDots } from "@/components/party/joinDots";
import { lastPayLocker, rememberPayLocker } from "@/components/party/payLocker";
import { useRupeePay } from "@/components/RupeePay";
import { writeSupplierPayment } from "@/lib/partyPayments";
import { Button } from "@/components/ui/button";
import { AsyncButton } from "@/components/AsyncButton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Plus, CreditCard, Wallet, ShoppingBag, BookOpen,
  Download, Trash2, Pencil, ArrowDownCircle, ExternalLink, Lock,
  Handshake, Tag, Coins, ArrowUpCircle, FileText,
} from "lucide-react";
import { toast } from "sonner";
import { downloadCsv, downloadLedgerPdf, fmtInrPlain } from "@/lib/ledgerExport";
import { StatementLedger, type StatementRow } from "@/components/StatementLedger";
import { DataTable, CellMain, CellTag, CellAmount, CellDate, type DataColumn } from "@/components/DataTable";
import { ExportDialog, inDateRange } from "@/components/ExportDialog";
import { confirmBox } from "@/lib/confirm";
import { fmtCcy } from "@/lib/currency";
import { companiesOf, companyById, hasCompanies } from "@/lib/companies";
import { filled, lockerLabel, noteText, recorded, userName, type Detail } from "@/components/rowDetails";
import { cutPeriod } from "@/lib/periodStatement";
import { openMin } from "@/lib/openMin";



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
  const has = useHas();
  // What their access allows here (an admin: everything). Purchases, selling to
  // the supplier and gold loans are switches; paying is Payments → Add; the
  // supplier itself, Suppliers → Edit / Delete.
  const mayPurchase = has("suppliers.purchase"), maySell = has("suppliers.sell"), mayGold = has("suppliers.gold");
  const mayEdit = can("suppliers", "edit"), mayDelete = can("suppliers", "delete"), mayPay = can("payments", "add");
  // What we owe them, and what a purchase cost: figure switches (fig.payables, fig.costs) — an admin always.
  const showOwed = has("fig.payables"), showCosts = has("fig.costs");
  // Correcting the profile, a purchase or a payment from here: each opens in a
  // panel over the page.
  const [editingSupplier, setEditingSupplier] = useState<Supplier | null>(null);
  const [editingEntry, setEditingEntry] = useState<MoneyEntry | null>(null);

  const supplier = db.suppliers.find(s => s.id === id);
  // One list at a time (hooks/usePageTab.ts) — before the early return below, so it runs on every draw.
  const [tabWant, setTab] = usePageTab("supplier", ["purchases", "statement", "gold"] as const, "purchases");
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
  // Of those, goods sent back on debit notes (lib/purchaseReturns.ts) — on the account the same way, said apart.
  const returnedInr = Math.round(sales.filter(x => x.returnOf).reduce((t, x) => t + x.totalInr, 0) * 100) / 100;
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
  // New purchase opens the purchase form (components/BuyMaterialForm), this supplier already chosen —
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
  // Any account: from one in another currency (a dollar account) the rate turns
  // the amount into the rupees on their books (components/RupeePay.tsx).
  const payLockers = db.lockers.filter(l => l.active !== false);
  const fx = useRupeePay(payLockerId, Number(payAmount) || 0, `${supplier.name}'s`, () => setPayAmount(""));
  // Opens on the account this person last paid from, unless one is already picked.
  const openPay = () => {
    if (!payLockerId) { const last = lastPayLocker(user?.id); if (payLockers.some(l => l.id === last)) setPayLockerId(last); }
    setShowPayForm(true);
  };
  // Came from Suppliers → To pay (?pay=<bill>): the Pay panel opens, set to that bill and what is owed on it.
  const [sp, setSp] = useSearchParams();
  const payAsk = sp.get("pay");
  useEffect(() => {
    if (payAsk === null || !mayPay) return;
    const bill = payAsk ? db.purchases.find(x => x.id === payAsk && x.supplierId === id) : undefined;
    if (bill) { setPayTargetPurchase(bill.id); setPayAmount(String(Math.round(purchasePending(bill) * 100) / 100)); }
    openPay();
    setSp(prev => { const n = new URLSearchParams(prev); n.delete("pay"); return n; }, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [payAsk, mayPay]);

  const recordPayment = async () => {
    const amt = Number(payAmount);
    if (!amt || amt <= 0) { toast.error("Enter a valid amount"); return; }
    if (!payLockerId) { toast.error("Choose which locker this payment came from"); return; }
    if (!payDate) { toast.error("Choose the date"); return; }
    if (payDate > todayLocal()) { toast.error("A payment can't be dated after today"); return; }
    if (fx.problem) { toast.error(fx.problem); return; }
    // Overpayment allowed — the excess beyond what's owed is parked on the newest
    // purchase (shows as Overpaid), never silently lost.
    const payLocker = db.lockers.find(l => l.id === payLockerId);
    if (payLocker && amt > lockerBalance(payLocker, db.lockerTransactions) &&
        !(await confirmBox(`This payment of ${fmtLockerAmount(amt, payLocker.currency)} is more than ${payLocker.name}'s balance of ${fmtLockerAmount(lockerBalance(payLocker, db.lockerTransactions), payLocker.currency)}. The locker will go negative — continue only if a deposit is still missing.`))) return;
    // The picked day (at the time of entry), on the payment and its account
    // entry alike — what was "now" before a date could be chosen.
    const now = stampFor(payDate);

    // The same write as every other supplier payment (lib/partyPayments.ts) — a
    // dollar account's rupees at the rate given (fx).
    updateDb(d => writeSupplierPayment(d, {
      supplierId: id!, lockerId: payLockerId, amount: amt, target: payTargetPurchase,
      note: payNote, userId: user!.id, at: now, ...fx.args,
    }));
    rememberPayLocker(user?.id, payLockerId);
    toast.success(`Payment recorded · ${fx.text}`);
    setPayAmount(""); setPayNote(""); setPayTargetPurchase("__fifo"); setPayDate(todayLocal()); setShowPayForm(false);
  };

  // ── Receive money FROM the supplier (refund / return credit) ──
  const [showReceiveForm, setShowReceiveForm] = useState(false);
  const [showSell, setShowSell] = useState(false);
  // A purchase's landed cost (components/LandedCostSheet): which purchase's bill is open.
  const [landedFor, setLandedFor] = useState<string | null>(null);
  // Purchase orders to this supplier (components/PurchaseOrders): a new one, or their list.
  const [poOpen, setPoOpen] = useState<"new" | "list" | null>(null);
  // Goods back to them on a debit note (lib/purchaseReturns.ts) — "" = choose the lines; an id = that bill line.
  const [returning, setReturning] = useState<string | null>(null);
  // Gold taken from them on loan (lib/supplierGold.ts) — its forms open from the ⋯.
  const [goldMode, setGoldMode] = useState<GoldMode>(null);
  // Worked out from the stock lines and the bills (both loaded for this page, pageData.ts).
  const goldReady = goldAccountReady();
  const goldOwed = supplierGoldOwed(db, supplier).owed;
  // A return or a bill comes off one company's gold owed: offered while any company owes some.
  const goldOwedSomewhere = companiesOf(db.settings).some(c => owedIn(db, supplier, c.id) > 0.0005);
  const NO_GOLD_OWED = !goldReady ? "Still loading" : "No gold is owed to them";
  const goldShown = goldReady && hasGoldAccount(db, supplier);
  // The tab shown: the gold account only once there is one.
  const tab = tabWant === "gold" && !goldShown ? "purchases" : tabWant;
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
  const ADMIN_ONLY = "Your access does not include purchases";
  const purchaseActions = (p: Purchase): MoreAction[] => {
    const o = p.orderId ? db.orders.find(x => x.id === p.orderId) : undefined;
    const edit = canEditPurchase(db, p);
    const scope = purchaseEditScope(db, p);
    const voidable = canVoidPurchase(db, p);
    return [
      { label: "View order", icon: ExternalLink, show: !!o,
        hint: can("orders") ? `Bought for ${o?.orderNumber}` : needsAccess("orders", "view"),
        disabled: !can("orders"), onSelect: () => navigate(`/orders/${o!.id}`) },
      { label: "Edit", icon: Pencil, onSelect: () => openEditPurchase(p), disabled: !mayPurchase || !edit.ok,
        // Open, but only the rate: say so before the panel does.
        hint: !mayPurchase ? ADMIN_ONLY : !edit.ok ? edit.reason : !scope.quantity ? scope.reason : undefined },
      // Freight, insurance, duty, lab fees on its bill — into the goods' cost (components/LandedCostSheet).
      { label: "Landed cost", icon: Truck, onSelect: () => setLandedFor(p.id), show: takesLanded(p) && showCosts,
        hint: landedExtraInr(p) > 0 ? `${fmtMoneyInr(landedExtraInr(p))} on this line — freight, duty, fees` : mayPurchase ? "Freight, insurance, duty, lab fees — into the cost" : "See what it cost to get here" },
      { label: "Return goods", icon: Undo2, onSelect: () => setReturning(p.id), show: p.purpose === "stock" && !p.fromGoldLoan,
        disabled: !mayPurchase, hint: !mayPurchase ? ADMIN_ONLY : "Back to them on a debit note — out of stock, off what we owe" },
      { label: voidingId === p.id ? "Voiding…" : "Void", icon: Trash2, danger: true,
        disabled: !mayPurchase || voidingId === p.id || !voidable.ok, onSelect: () => voidPurchase(p),
        hint: !mayPurchase ? ADMIN_ONLY : voidable.ok ? "Reverses due, stock and factory issue" : voidable.reason },
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
      // A debit note: printed, or cancelled — the goods back in stock, the bill as it was.
      if (sale.returnOf) {
        return [
          { label: "Print debit note", icon: Printer, onSelect: () => printDebitNote(db, sale) },
          { label: "Cancel debit note", icon: Trash2, danger: true, disabled: !mayPurchase || !!block, hint: !mayPurchase ? ADMIN_ONLY : block ?? "The goods back in stock; the value back on what we owe",
            onSelect: async () => {
              if (!(await confirmBox([`Cancel debit note ${sale.returnOf!.noteNo}?`, ...saleUndoImpact(db, sale)], { danger: true, confirmText: "Cancel debit note" }))) return;
              try { await undoSupplierSale(db, sale, user!); toast.success(`Debit note ${sale.returnOf!.noteNo} cancelled — back in stock`); }
              catch (e) { toast.error(e instanceof Error ? e.message : "It couldn't be cancelled"); }
            } },
        ];
      }
      return [
        { label: "Edit", icon: Lock, disabled: true, hint: "Delete it and record it again", onSelect: () => {} },
        { label: "Delete sale", icon: Trash2, danger: true, disabled: !maySell || !!block, hint: !maySell ? "Your access does not include selling to suppliers" : block ?? "Back into stock; its money removed",
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
    // A bill made from gold taken on loan: its fine grams, billed at a rate.
    if (p.fromGoldLoan) return "Gold taken on loan, billed · 24K fine";
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
    // Ready-made jewellery: the piece as bought (it went onto Ready Stock, lib/materials.ts).
    if (isReadyPiece(p)) return ["Ready jewellery", readyPieceSpec(p.piece)].filter(Boolean).join(" · ");
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
        particulars: [purchaseDesc(p), gstTag(p)].filter(Boolean).join(" · "),
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
      rows.push({ id: sale.id, date: sale.createdAt, particulars: sale.returnOf
          ? `Returned to them — debit note ${sale.returnOf.noteNo}: ${sale.lines.map(l => l.label).join(", ")}${sale.returnOf.reason ? ` · ${sale.returnOf.reason}` : ""}`
          : `Sold to them — ${sale.lines.map(l => l.label).join(", ")}${sale.notes ? ` · ${sale.notes}` : ""}`,
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
      ["Date", "Bill No", "Order No", "Particulars", "Weight", "Rate (INR)", "GST (INR)", "Bill Amount (INR)", "Paid (INR)", "Balance (INR)"],
      (() => {
        // A period opens with the balance brought forward (lib/periodStatement.ts).
        const per = cutPeriod(statementAsc, from, to);
        return [
          ...(per.broughtForward !== null ? [[fmtDate(from!.toISOString()), "", "", "Opening balance — brought forward", "", "", "", "", "", per.broughtForward]] : []),
          ...per.rows.map(r => {
            // A purchase's GST, inside its bill amount (lib/purchaseGst.ts).
            const pur = r.kind === "Purchase" ? purchases.find(x => x.id === r.id) : undefined;
            return [
              r.id === "opening" ? "Opening" : fmtDate(r.date),
              r.invoiceNo ?? "", r.orderNo ?? "", r.particulars,
              r.qty ? `${r.qty}${r.unit ?? ""}` : "",
              r.rate ?? "", pur && purchaseGstInr(pur) ? purchaseGstInr(pur) : "", r.debit || "", r.credit || "", r.balance,
            ];
          }),
        ];
      })(),
    );
  };

  const exportPdf = (from: Date | null, to: Date | null) => {
    // A period: brought forward, the period's entries and totals, its closing balance.
    const per = cutPeriod(statementAsc, from, to);
    const perBills = per.rows.reduce((t, r) => t + r.debit, 0), perPaid = per.rows.reduce((t, r) => t + r.credit, 0);
    const periodOn = !!(from || to);
    downloadLedgerPdf({
      title: "Supplier Account Statement",
      subjectLines: [
        `Supplier: ${supplier.name}`,
        supplier.contactPerson ? `Contact: ${supplier.contactPerson}` : "",
        periodOn ? `Period: ${from ? fmtDate(from.toISOString()) : "start"} – ${to ? fmtDate(to.toISOString()) : "today"}` : "",
        `Report Generated: ${new Date().toLocaleDateString("en-IN", { month: "long", day: "numeric", year: "numeric" })}`,
      ].filter(Boolean),
      summary: periodOn ? [
        ...(per.broughtForward !== null ? [{ label: "Opening balance (brought forward)", value: fmtInrPlain(per.broughtForward) }] : []),
        { label: "Bills in the period", value: fmtInrPlain(perBills) },
        { label: "Paid in the period", value: fmtInrPlain(perPaid) },
        { label: "Closing balance", value: fmtInrPlain(per.closing) },
      ] : [
        { label: "Total Purchased", value: fmtInrPlain(account.totalPurchased) },
        // The GST inside those purchases (In bill).
        ...(purchases.some(x => purchaseGstInr(x) > 0) ? [{ label: "GST in bills", value: fmtInrPlain(purchases.reduce((t, x) => t + purchaseGstInr(x), 0)) }] : []),
        { label: "Total Paid", value: fmtInrPlain(account.totalPaid) },
        { label: "Balance Owed", value: fmtInrPlain(account.balanceOwed) },
        // The figure the table below actually closes on: what is owed after any
        // refunds received and any purchase that was overpaid.
        { label: "Closing Balance", value: fmtInrPlain(account.net) },
        { label: "Overpaid", value: fmtInrPlain(account.overpaid) },
        ...(account.sold - returnedInr > 0.5 ? [{ label: "Sold to them", value: fmtInrPlain(account.sold - returnedInr) }] : []),
        ...(returnedInr > 0 ? [{ label: "Returned (debit notes)", value: fmtInrPlain(returnedInr) }] : []),
        // The gold account is apart from the money: its own download below.
        ...(goldShown ? [{ label: "Gold owed (fine)", value: fmtG(goldOwed) }] : []),
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
      rows: [
        ...(per.broughtForward !== null ? [[fmtDate(from!.toISOString()), "", "", "Opening balance — brought forward", "", "", "", "", fmtInrPlain(per.broughtForward).replace("Rs. ", "")]] : []),
        ...per.rows.map(r => [
        r.id === "opening" ? "Opening" : fmtDate(r.date),
        fit(r.invoiceNo ?? "", 22),
        fit(r.orderNo ?? "", 28),
        fit(r.particulars, 64),
        r.qty ? `${r.qty}${r.unit ?? ""}` : "",
        r.rate ? fmtInrPlain(r.rate).replace("Rs. ", "") : "",
        r.debit ? fmtInrPlain(r.debit).replace("Rs. ", "") : "",
        r.credit ? fmtInrPlain(r.credit).replace("Rs. ", "") : "",
        fmtInrPlain(r.balance).replace("Rs. ", ""),
      ])],
      // A totals line so the columns prove themselves: bills less payments is
      // the balance the last row closes on — the period's own, for a period.
      totalsRow: periodOn
        ? ["", "", "", "Totals for the period", "", "",
          fmtInrPlain(perBills).replace("Rs. ", ""),
          fmtInrPlain(perPaid).replace("Rs. ", ""),
          fmtInrPlain(per.closing).replace("Rs. ", "")]
        : ["", "", "", "Totals", "", "",
          fmtInrPlain(account.totalPurchased).replace("Rs. ", ""),
          fmtInrPlain(account.totalPaid + account.received).replace("Rs. ", ""),
          fmtInrPlain(account.net).replace("Rs. ", "")],
      filename: `Supplier-${supplier.name.replace(/\s+/g, "_")}`,
    });
  };

  // Their gold account on its own page — in grams, oldest first, as a statement is read.
  const exportGoldPdf = (from: Date | null, to: Date | null) => {
    const gold = supplierGoldOwed(db, supplier);
    const n = (g: number) => (g ? (Math.round(g * 1000) / 1000).toLocaleString("en-IN", { maximumFractionDigits: 3 }) : "");
    downloadLedgerPdf({
      title: "Supplier Gold Account",
      subjectLines: [
        `Supplier: ${supplier.name}`,
        "In grams. Owed in fine (24K) gold.",
        `Report Generated: ${new Date().toLocaleDateString("en-IN", { month: "long", day: "numeric", year: "numeric" })}`,
      ],
      summary: [
        { label: "Gold owed (fine)", value: fmtG(gold.owed) },
        { label: "Taken on loan (fine)", value: fmtG(gold.taken) },
        { label: "Returned (fine)", value: fmtG(gold.returned) },
        ...(gold.billed > 0 ? [{ label: "Turned into bills (fine)", value: fmtG(gold.billed) }] : []),
        ...(gold.opening > 0 ? [{ label: "Opening (fine)", value: fmtG(gold.opening) }] : []),
      ],
      landscape: true,
      columns: [
        { header: "Date", x: 14 },
        { header: "Particulars", x: 40 },
        { header: "In (g)", x: 168 },
        { header: "Purity", x: 192 },
        { header: "Out (g)", x: 220 },
        { header: "Fine (g)", x: 246 },
        { header: "Balance", x: 270 },
      ],
      align: ["left", "left", "right", "left", "right", "right", "right"],
      // A period opens with the gold brought forward (lib/periodStatement.ts).
      rows: (() => {
        const per = cutPeriod(gold.rows.map(r => ({ ...r, date: r.at, pinned: r.kind === "opening" })), from, to);
        return [
          ...(per.broughtForward !== null ? [[fmtDate(from!.toISOString()), "Gold owed — brought forward", "", "", "", "", n(per.broughtForward) || "0"]] : []),
          ...per.rows.map(r => [
        r.kind === "opening" ? "Opening" : fmtDate(r.at),
        // The PDF's font has no rupee sign.
        fit(r.particulars.replace(/₹/g, "Rs. "), 120),
        n(r.inGrams), r.kind === "opening" ? "" : r.purity, n(r.outGrams),
        `${r.fine > 0 ? "+" : "-"}${n(Math.abs(r.fine))}`, n(r.balance) || "0",
          ]),
        ];
      })(),
      filename: `Supplier-${supplier.name.replace(/\s+/g, "_")}-Gold`,
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
  // Each unpaid bill's due day and lateness, as Suppliers → To pay works it out.
  const dueOf = new Map(supplierBillsDue(db, supplier).filter(b => b.purchase).map(b => [b.purchase!.id, b]));
  const purchaseColumns: DataColumn<Purchase>[] = [
    { key: "date", header: "Date", always: true, kind: "date", sortValue: p => +new Date(p.createdAt), csv: p => fmtDate(p.createdAt),
      cell: p => <CellDate>{fmtDate(p.createdAt)}</CellDate> },
    { key: "purchase", header: "Purchase", always: true, sortValue: p => purchaseTitle(p), csv: p => purchaseTitle(p),
      cell: p => <CellMain title={purchaseTitle(p)} sub={[purchaseSub(p), p.currency === "USD" ? `$${p.totalUsd} @ ₹${p.exchangeRate}/$` : undefined].filter(Boolean).join(" · ") || undefined} /> },
    // In bill (GST) or not — older purchases say nothing.
    { key: "gst", header: "GST", align: "right", kind: "number", sortValue: p => (p.gstBill === undefined ? null : purchaseGstInr(p)),
      csv: p => (p.gstBill === true ? purchaseGstInr(p) : p.gstBill === false ? "No bill" : ""),
      cell: p => (p.gstBill === true ? <span className="tabular-nums whitespace-nowrap" title={gstText(p)}>{fmtMoneyInr(purchaseGstInr(p))} <span className="text-[10px] text-muted-foreground">{pctText(p.gstPct)}%</span></span>
        : p.gstBill === false ? <CellTag>No bill</CellTag> : <span className="text-muted-foreground/50">—</span>) },
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
    // Due by their credit days (lib/supplierDue.ts) — only once they have credit days.
    ...(supplier.creditDays != null ? [{ key: "due", header: "Due", kind: "date" as const,
      sortValue: (p: Purchase) => +new Date(dueOf.get(p.id)?.dueAt ?? p.invoiceDate ?? p.createdAt),
      csv: (p: Purchase) => (dueOf.get(p.id)?.dueAt ? fmtDate(dueOf.get(p.id)!.dueAt!) : ""),
      cell: (p: Purchase) => {
        const b = dueOf.get(p.id);
        if (!b?.dueAt) return <span className="text-muted-foreground/50">—</span>;
        return (
          <span className="text-xs whitespace-nowrap">
            <span className={b.late > 0 ? "text-destructive font-semibold" : ""}>{fmtDate(b.dueAt)}</span>
            <span className={`block text-[10px] ${b.late > 0 ? "text-destructive" : "text-muted-foreground"}`}>{b.late > 0 ? `${b.late} d late` : b.left === 0 ? "due today" : `in ${b.left} d`}</span>
          </span>
        );
      } }] : []),
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
    if (isReadyPiece(p)) return p.piece?.ratePerPiece ? `${fmtCcy(p.piece.ratePerPiece, cur)}/pc` : "";
    return p.other?.ratePerUnit ? `${fmtCcy(p.other.ratePerUnit, cur)}/${materialUnit(db.settings, p.material)}` : "";
  };
  const purchaseDetails = (p: Purchase): Detail[] => {
    const packets = (db.diamondPackets ?? []).filter(x => x.purchaseId === p.id);
    const pays = [...(p.payments ?? [])].sort((a, b) => +new Date(a.createdAt) - +new Date(b.createdAt));
    return filled([
      { label: "Description", value: purchaseDesc(p) },
      showCosts && { label: "Rate", value: purchaseRate(p) },
      !!p.discountPct && { label: p.discountPct > 0 ? "Discount" : "Added on", value: `${Math.abs(p.discountPct)}%` },
      // Freight, duty, fees spread onto this line (lib/landedCost.ts) — in its cost, not the supplier's bill.
      showCosts && landedExtraInr(p) > 0 && { label: "Landed cost", value: `${fmtMoneyInr(landedExtraInr(p))} — ${(p.landedCosts ?? []).map(c => landedKindLabel(c.kind)).join(", ")}` },
      !!p.roundOffInr && { label: "Rounded off", value: `${p.roundOffInr > 0 ? "+" : "−"}${fmtMoneyInr(Math.abs(p.roundOffInr))}` },
      p.gstBill !== undefined && { label: "GST", value: p.gstBill ? `${pctText(p.gstPct)}% · ${fmtMoneyInr(purchaseGstInr(p))} on ${fmtMoneyInr(preGstInr(p))}` : "No bill — no GST" },
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
    if (p) return filled([
      p.gstBill !== undefined && { label: "GST", value: p.gstBill ? `${pctText(p.gstPct)}% · ${fmtMoneyInr(purchaseGstInr(p))} on ${fmtMoneyInr(preGstInr(p))}` : "No bill — no GST" },
      { label: "Notes", value: noteText(p.notes) }, { label: "Recorded", value: recorded(db, p.createdAt, p.createdBy) },
    ]);
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
        has("fig.profit") && { label: "Cost to us", value: cost == null ? "Not known for every line" : `${fmtMoneyInr(cost)} · profit ${fmtMoneyInr(sale.totalInr - cost - saleBrokerageWePay(sale))}` },
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
        primary={mayPurchase ? { label: "New purchase", icon: Plus, onClick: () => setShowPurchaseForm(true) } : null}
        secondary={mayPay ? { label: "Pay", icon: CreditCard, onClick: openPay } : null}
        menu={[
          // Set once, when moving from an old system — so out of sight until then.
          { label: "Opening balance", icon: BookOpen, hint: "Not set — what was owed before the app", onSelect: openOpening, show: mayEdit && !openingSet },
          // What we ask them for before the goods come — received into a bill when they do.
          { label: "New purchase order", icon: ClipboardList, hint: "Ask them for goods — send it on WhatsApp", onSelect: () => setPoOpen("new"), show: mayPurchase },
          { label: "Purchase orders", icon: ClipboardList, hint: "What we asked them for, what came, what is late", onSelect: () => setPoOpen("list") },
          { label: "Sell to them", icon: Tag, hint: "Diamonds, gold, a piece — off what we owe", onSelect: () => setShowSell(true), show: maySell },
          { label: "Return goods", icon: Undo2, hint: "Back to them on a debit note, against the bill", onSelect: () => setReturning(""), show: mayPurchase },
          // Gold borrowed from them: into our stock, owed back in gold (or turned into a bill).
          { label: "Gold on loan", icon: Coins, hint: "Take their gold into our stock", onSelect: () => setGoldMode("take"), show: mayGold },
          { label: "Return gold", icon: ArrowUpCircle, onSelect: () => setGoldMode("return"), show: mayGold, disabled: !goldReady || !goldOwedSomewhere,
            hint: goldReady && goldOwedSomewhere ? `Out of stock · ${Math.round(goldOwed * 1000) / 1000} g fine owed` : NO_GOLD_OWED },
          { label: "Gold to a bill", icon: FileText, onSelect: () => setGoldMode("bill"), show: mayGold, disabled: !goldReady || !goldOwedSomewhere,
            hint: goldReady && goldOwedSomewhere ? "Pay for gold owed in money, at a rate" : NO_GOLD_OWED },
          { label: "Opening gold", icon: BookOpen, hint: "Gold owed before the app", onSelect: () => setGoldMode("opening"), show: mayGold && !((supplier.openingGoldFine ?? 0) > 0) },
          { label: "Receive money", icon: ArrowDownCircle, hint: "A refund from them", onSelect: () => setShowReceiveForm(true), show: maySell },
          { label: "Export statement", icon: Download, hint: "PDF or Excel", onSelect: () => setShowExport(true), show: mayExport },
          { label: "Edit details", icon: Pencil, onSelect: () => setEditingSupplier(supplier), disabled: !mayEdit,
            hint: mayEdit ? "Name, contact, GSTIN, address" : "Your access does not include changing suppliers" },
          { label: "Delete supplier", icon: Trash2, danger: true, onSelect: deleteSupplier, disabled: !mayDelete || !deleteGuard.ok,
            hint: !mayDelete ? "Your access does not include deleting suppliers" : deleteGuard.reason },
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
      {/* The business's own fields (lib/customFields.ts). */}
      <CustomFieldsView target="suppliers" recId={supplier.id} className="card-luxe p-4" />
      {/* What they hold of ours on memo — on approval (lib/memos.ts). */}
      <PartyMemos party={{ kind: "supplier", id: supplier.id }} />
      <StatStrip items={[
        ...(!showOwed ? [] : [account.net < 0
          ? { label: "They owe us", value: fmtMoneyInr(-account.net), icon: ArrowDownCircle, tone: "in" as const, sub: "After refunds and overpaid bills" }
          : { label: "We owe", value: account.net > 0 ? fmtMoneyInr(account.net) : "✓ Settled", icon: Wallet, tone: account.net > 0 ? "out" as const : "in" as const,
              sub: account.net > 0 ? "After advances and refunds" : "Nothing owed" }]),
        { label: "Paid", value: fmtMoneyInr(account.totalPaid), icon: CreditCard, tone: "in", sub: "Bills and advances" },
        { label: "Purchased", value: fmtMoneyInr(account.totalPurchased), icon: ShoppingBag, sub: `${purchases.length} purchase${purchases.length === 1 ? "" : "s"}` },
        ...(account.received > 0 ? [{ label: "Refunds received", value: fmtMoneyInr(account.received), icon: ArrowDownCircle }] : []),
        ...(account.sold - returnedInr > 0.5 ? [{ label: "Sold to them", value: fmtMoneyInr(account.sold - returnedInr), icon: Tag }] : []),
        ...(returnedInr > 0 ? [{ label: "Returned", value: fmtMoneyInr(returnedInr), icon: Undo2, sub: `${sales.filter(x => x.returnOf).length} debit note${sales.filter(x => x.returnOf).length === 1 ? "" : "s"}` }] : []),
        // Gold taken from them on loan — only when they have a gold account (its lines are below).
        ...(goldShown && showOwed ? [{ label: "Gold owed", value: Math.abs(goldOwed) > 0.0005 ? `${fmtG(goldOwed)} fine` : "✓ Returned", icon: Coins,
          tone: goldOwed > 0.0005 ? "out" as const : "in" as const, sub: goldOwed > 0.0005 ? "24K gold to give back" : "Nothing owed in gold" }] : []),
      ]} />
      <ExportDialog open={showExport} onClose={() => setShowExport(false)} title={`${supplier.name} ledger`} options={[
        { label: "Account Statement — PDF", sublabel: "Purchases, payments & receipts", kind: "pdf", run: exportPdf },
        { label: "Account Statement — Excel", sublabel: "Purchases, payments & receipts", kind: "excel", run: exportCsv },
        ...(goldShown ? [{ label: "Gold Account — PDF", sublabel: "Gold on loan, returned and billed, in grams", kind: "pdf" as const, run: exportGoldPdf }] : []),
      ]} />

      {/* Opening balance (migration) — admin only; once set it stays in view,
          until then it waits in the ⋯. */}
      {mayEdit && (openingSet || obOpen) && (
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

      {/* One list at a time (hooks/usePageTab.ts) — a long one never hides another under it. */}
      <TabBar label="Supplier" value={tab} onChange={setTab} tabs={[
        { key: "purchases" as const, label: "Purchases", icon: ShoppingBag, count: purchases.length },
        { key: "statement" as const, label: "Account statement", icon: BookOpen, count: statement.length },
        ...(goldShown ? [{ key: "gold" as const, label: "Gold account", icon: Coins }] : []),
      ]} />
      {tab === "purchases" && (<>
      {/* Purchase history */}
      <div className="card-luxe overflow-hidden">
        {/* How many is the table's own count. */}
        <SectionTitle title="Purchase History" className="px-5 py-4 border-b border-border/60" />
        <div className="p-3 sm:p-4">
          <DataTable
            id="supplier-purchases"
            noun="purchase"
            rows={purchases}
            columns={showOwed ? purchaseColumns : purchaseColumns.filter(c => c.key !== "pending")}
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
            emptyAction={!purchases.length && mayPurchase ? { label: "Record a purchase", onClick: () => setShowPurchaseForm(true) } : undefined}
          />
        </div>
      </div>
      </>)}
      {tab === "statement" && (<>
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
        // The running balance is what we owe them: only with fig.payables — and the
        // statement download, which is built round it, likewise.
        hideBalance={!has("fig.payables")}
        onExport={has("fig.payables") ? () => setShowExport(true) : undefined}
      />
      </>)}
      {/* Their gold account — gold taken on loan, given back or billed, in grams. Shown once there is any. */}
      <SupplierGoldPanel supplier={supplier} isAdmin={mayGold} mode={goldMode} onMode={setGoldMode} hideCard={tab !== "gold"} />


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
      {landedFor && <LandedCostSheet purchaseId={landedFor} onClose={() => setLandedFor(null)} mayChange={mayPurchase}
        describe={pid => { const x = purchases.find(q => q.id === pid); return x ? `${purchaseTitle(x)} — ${purchaseDesc(x)}` : "—"; }} />}
      {poOpen === "new" && <PoSheet open onOpenChange={v => { if (!v) setPoOpen(null); }} supplierId={id!} />}
      {poOpen === "list" && (
        <ActionSheet open onOpenChange={o => { if (!o) setPoOpen(null); }} size="xl" icon={ClipboardList} title={`Purchase orders — ${supplier.name}`}
          description="What we asked them for, what came, what is still awaited">
          <PurchaseOrdersPanel supplierId={id!} />
        </ActionSheet>
      )}
      {returning != null && <PurchaseReturnSheet supplierId={id!} purchaseId={returning || undefined} onClose={() => setReturning(null)} />}

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
              <p className="font-display text-lg font-bold text-brand-dark leading-tight">{fx.text}</p>
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
              <Label className="text-xs">Amount ({fx.foreign ? fx.cur : "₹"})</Label>
              <Input type="number" min={1} value={payAmount} onChange={e => setPayAmount(e.target.value)} autoFocus className="rounded-xl h-10 mt-1" placeholder="0" aria-label="Amount" />
            </div>
            <div>
              <Label className="text-xs">Date</Label>
              <Input type="date" min={openMin()} value={payDate} max={todayLocal()} onChange={e => setPayDate(e.target.value)} className="rounded-xl h-10 mt-1" aria-label="Date" />
            </div>
          </div>
          {/* What is pending for what it is against: the one bill picked, or the
              whole account (oldest first). An advance has no "full". */}
          {(() => {
            const bill = pendingPurchases.find(p => p.id === payTargetPurchase);
            const full = bill ? purchasePending(bill) : payTargetPurchase === "__fifo" ? account.net : 0;
            // From a dollar account: the full rupees in dollars, once the rate is in.
            const inCur = fx.foreign ? (fx.rate > 0 ? Math.round(full / fx.rate * 100) / 100 : 0) : full;
            if (!(full > 0) || !(inCur > 0) || Number(payAmount) === inCur) return null;
            return (
              <button type="button" onClick={() => setPayAmount(String(inCur))}
                className="-mt-1 inline-flex items-center h-7 px-2.5 rounded-full border border-primary/30 bg-primary/5 text-xs font-medium text-primary hover:bg-primary/10">
                Full amount · {fmtMoneyInr(full)}{fx.foreign ? ` = ${fmtCcy(inCur, fx.cur)}` : ""}
              </button>
            );
          })()}
          <div>
            <Label className="text-xs">From account</Label>
            <Select value={payLockerId} onValueChange={addNew("locker", setPayLockerId)}>
              <SelectTrigger className="h-10 rounded-xl mt-1" aria-label="From account"><SelectValue placeholder="Choose an account" /></SelectTrigger>
              <SelectContent>{payLockers.map(l => <SelectItem key={l.id} value={l.id}>{l.name}{(l.currency || "INR") !== "INR" ? ` (${l.currency})` : ""}</SelectItem>)}<AddNewItem kind="locker" /></SelectContent>
            </Select>
          </div>
          {fx.box}
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
