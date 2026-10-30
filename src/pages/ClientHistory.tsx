import { stageLabel } from "@/lib/stages";
import { isDiamondOnlyOrder, orderImage } from "@/lib/db";
import { looseLabel } from "@/lib/orderText";
import { ListCombo } from "@/components/ListCombo";
import { AddNewItem, useAddNew } from "@/components/create/QuickCreate";
import { choicesOf } from "@/lib/optionLists";
import { metalLabel } from "@/lib/metals";
import { MAIN_COMPANY_ID, companyById, companyIdOfClient, hasCompanies } from "@/lib/companies";
import { useCan, useMayExport } from "@/hooks/useCan";
import type { MoreAction } from "@/components/MoreMenu";
import { PageHeader } from "@/components/PageHeader";
import { SectionTitle } from "@/components/SectionTitle";
import { StatStrip, type TableFilter } from "@/components/TableToolbar";
import { advanceIds, receiptForAdvance } from "@/lib/receipts";
import { useEffect, useState } from "react";
import { useParams, Link, useNavigate, useSearchParams } from "react-router-dom";
import { invoicedOrderIds, readyToBill, splitClientAccount } from "@/components/billing/clientBilling";
import { collectionLoaded, worksOnClient, fmtMoney, fmtDate, totalAdvance, balanceDue, orderTotal, orderGrossTotal, updateDb, uid, settleClientAccount, applyCreditToBills, findInvoiceForOrder, invoiceOrderIds, hasOpeningBalance, openingDebitAmt, openingCreditAmt } from "@/lib/db";
import { useDb } from "@/hooks/useDb";
import { ClientInvoiceLedger, buildInvoiceBlocks, type InvoiceBlock, type InvoicePayment } from "@/components/ClientInvoiceLedger";
import { ClientEditDialog } from "@/components/ClientEditDialog";
import { ReceiptEditSheet, cancelReceiptFlow, loadReceipts, paymentLockReason } from "@/components/ReceiptEditSheet";
import { cancelCreditNoteFlow, creditNoteCancelBlocker } from "@/components/creditNoteCancel";
import { printNote, useMayReturn } from "@/components/SalesReturn";
import { clientDeleteBlocker, deleteClientFlow, toggleClientActive } from "@/lib/clientActions";
import { needsAccess } from "@/lib/actionHints";
import { StatusBadge } from "@/components/StatusBadge";
import { GiftCardAdminPanel } from "@/components/GiftCardAdminPanel";
import { ActionSheet } from "@/components/ActionSheet";
import { Button } from "@/components/ui/button";
import { AsyncButton } from "@/components/AsyncButton";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RateInput } from "@/components/CurrencyFields";
import { ccy, fmtCcy, roundCcy } from "@/lib/currency";
import { DataTable, CellAmount, CellDate, CellTag, type DataColumn } from "@/components/DataTable";
import { ClientMaterialCard } from "@/components/ClientMaterialCard";
import type { Order } from "@/lib/db";
import { filled, when, userName, refLink, noteText, refNo, type Detail } from "@/components/rowDetails";
import { pieceWeights } from "@/lib/weights";
import {
  Package, Gem, Mail, Phone, MapPin, Globe, Undo2,
  FileText, Clock, AlertCircle,
  Download, Hash, Wallet, Plus, CreditCard, DollarSign,
  Pencil, Trash2, Power, Eye, Printer, XCircle, Hourglass, ArrowRight,
} from "lucide-react";
import { motion } from "framer-motion";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth";
import { downloadCsv, downloadLedgerPdf, downloadLedgerPdfMulti, pdfThumbs } from "@/lib/ledgerExport";
import { ExportDialog, inDateRange } from "@/components/ExportDialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { FileSpreadsheet } from "lucide-react";
import { confirmBox } from "@/lib/confirm";
import { RefundClientSheet } from "@/components/RefundClientSheet";
import { clientRefunds, deleteClientRefund } from "@/lib/clientRefunds";
import { saleCcy, saleOwed, saleReceived, saleTotal } from "@/lib/diamondSalePay";
import { SalePaymentSheet } from "@/components/SalePaymentSheet";
import type { DiamondSale } from "@/lib/db";
import type { LockerTransaction } from "@/lib/db";
import { PhoneLink, EmailLink } from "@/components/ContactLink";
import { zoomable } from "@/components/ImageViewer";
import { orderPictures } from "@/lib/readyStockPhotos";

/**
 * The page waits for its record before drawing anything that holds state. The
 * data behind the first screen arrives a moment after the page opens, and a
 * page that returned early on its first draw and then ran all its hooks on the
 * next crashed (React #310) whenever it was opened or refreshed directly.
 */
export function ClientHistoryPage() {
  const { id } = useParams();
  const db = useDb();
  const { user } = useAuth();
  const client = db.clients.find(c => c.id === id);
  // Employees may only open clients within their work — same rule as the page itself.
  const forbidden = !!client && !!user && user.role === "employee" && !worksOnClient(db, user, client);
  if (!(!!client && !forbidden)) {
    return (
      <div className="text-center py-20 text-muted-foreground">
        {forbidden ? "You don't have access to this client." : collectionLoaded("clients") ? "Client not found." : "Loading…"}{" "}
        <Link to="/clients" className="inline-block py-2.5 -my-2.5 text-primary underline">Back</Link>
      </div>
    );
  }
  // Keyed by the record, so moving straight to another one starts it afresh.
  return <ClientHistoryPageBody key={id} />;
}

function ClientHistoryPageBody() {
  const mayExport = useMayExport();
  const mayExportInvoices = useMayExport("invoices");
  const mayReturn = useMayReturn();
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const can = useCan();
  const db = useDb();
  const addNew = useAddNew();
  // Before the early return below, so they run on every draw.
  const [editingClient, setEditingClient] = useState(false);
  const [editReceiptId, setEditReceiptId] = useState<string | null>(null);
  // Paying their held credit back (lib/clientRefunds.ts).
  const [refunding, setRefunding] = useState(false);
  // Taking money for a diamond sold to them on credit (lib/diamondSalePay.ts).
  const [paySale, setPaySale] = useState<DiamondSale | null>(null);
  // Arriving from the Clients list's ⋯ (Record payment, Send statement): the
  // page opens with that panel open. The ask is taken off the address once
  // read, so a refresh or Back doesn't open it again.
  const [sp, setSp] = useSearchParams();
  const askedPay = sp.get("pay") === "1";
  const askedStatement = sp.get("statement") === "1";
  useEffect(() => {
    if (!askedPay && !askedStatement) return;
    const next = new URLSearchParams(sp);
    next.delete("pay"); next.delete("statement");
    setSp(next, { replace: true });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const client = db.clients.find(c => c.id === id);

  // A client's statements carry the company that sells to them; the first

  // company's stay exactly as they always were.

  const statementCompany = client && hasCompanies(db.settings) && companyIdOfClient(client) !== MAIN_COMPANY_ID

    ? companyById(db.settings, companyIdOfClient(client)).name : undefined;
  // Employees may only open clients within their work — not the whole client
  // base, unless their role reaches every client.
  const forbidden = client && user!.role === "employee" && !worksOnClient(db, user!, client);
  if (!client || forbidden) {
    return (
      <div className="text-center py-20 text-muted-foreground">
        {forbidden ? "You don't have access to this client." : "Client not found."}{" "}
        <Link to="/clients" className="inline-block py-2.5 -my-2.5 text-primary underline">Back to Clients</Link>
      </div>
    );
  }

  // A deleted order (lib/orderAdmin.ts) is off every list, this one too.
  const allOrders = db.orders
    .filter(o => o.clientId === id && !o.deletedAt)
    .sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));

  // Rejected orders are cancelled work — they must NOT be billed or absorb
  // payments, so all money math runs on billable (non-rejected) orders only.
  const billableOrders = allOrders.filter(o => o.status !== "Rejected");

  // Display only — shows an order's invoice number in the table when it has one.
  const allInvoices = db.invoices.filter(inv => inv.clientId === id);


  // Summary stats — use the full bill (incl. shipping/cert) so "Total Value"
  // matches the Account Ledger's "Total Billed".
  const totalValue = billableOrders.reduce((s, o) => s + orderTotal(o), 0);
  // Paid / outstanding come from the ORDERS, never from invoice snapshots: an
  // order can be paid before it is billed, and an invoice raised by mistake can
  // be deleted from Settings — neither may move this statement by a cent.
  // A client reads their account by INVOICE, not by our internal order numbers.
  const invoiceBlocks = buildInvoiceBlocks(db.invoices ?? [], db.orders, id!);

  // Gross billed and gift-card credit, so the summary reconciles with the
  // statement columns line for line.
  const grossBilled = billableOrders.reduce((s, o) => s + orderGrossTotal(o), 0);
  const giftUsed = billableOrders.reduce((s, o) => s + (o.giftCardRedeemed || 0), 0);
  const pendingAmount = billableOrders.reduce((s, o) => s + balanceDue(o), 0);
  const paidAmount = totalValue - pendingAmount;
  const activeOrders = allOrders.filter(o => !["Delivered", "Rejected"].includes(o.status)).length;
  const deliveredOrders = allOrders.filter(o => o.status === "Delivered").length;

  const statusCounts: Record<string, number> = {};
  allOrders.forEach(o => { statusCounts[o.status] = (statusCounts[o.status] || 0) + 1; });

  // Filters
  const [statusFilter, setStatusFilter] = useState("all");

  const [showExport, setShowExport] = useState(() => askedStatement && mayExport);

  // ── Client account / payments ──
  const [payAmount, setPayAmount] = useState("");
  const [payMethod, setPayMethod] = useState("Cash");
  const [payRemark, setPayRemark] = useState("");
  const [payInvoiceId, setPayInvoiceId] = useState("");
  const [payLockerId, setPayLockerId] = useState("");
  // The locker's currency for $1 (₹ per $, A$ per $…).
  const [payExchangeRate, setPayExchangeRate] = useState<number | "">("");
  const [showPayForm, setShowPayForm] = useState(() => askedPay && can("payments", "add"));
  // Split as Invoices reads it: due now (on an invoice, unpaid) + on order (not
  // billed yet) = outstanding. Nothing about the account changes, only how it reads.
  const account = splitClientAccount(billableOrders, client?.creditBalance || 0, client, invoicedOrderIds(db.invoices));
  // Shipped work with no invoice — the Orders page's "Not invoiced", for them.
  const toBill = user!.role !== "client" ? readyToBill(db, id!) : { ready: [], noPrice: [], total: 0 };
  const payLocker = db.lockers.find(l => l.id === payLockerId);
  const payLockerCurrency = ccy(payLocker?.currency);
  // A client always pays in USD (that's what the order is billed in) — a
  // locker in any other currency needs converting for the deposit side.
  const payNeedsRate = !!payLocker && payLockerCurrency !== "USD";
  const payRate = Number(payExchangeRate);
  // A rate belongs to one currency: picking a locker in another starts it
  // afresh (from Settings) instead of carrying ₹83 into an AUD locker.
  const pickPayLocker = (v: string) => {
    const next = db.lockers.find(l => l.id === v);
    if (!next || ccy(next.currency) !== payLockerCurrency) setPayExchangeRate("");
    setPayLockerId(v);
  };

  // Which invoice this money is for. Left blank it is held as credit on the
  // client's account rather than being spread over their oldest bills.
  const openInvoicesForPay = (db.invoices ?? [])
    .filter(inv => inv.clientId === id)
    .map(inv => ({
      inv,
      bal: invoiceOrderIds(inv).reduce((s, oid) => {
        const o = db.orders.find(x => x.id === oid);
        return s + (o ? balanceDue(o) : 0);
      }, 0),
    }))
    .filter(x => x.bal > 0.009)
    .sort((a, b) => +new Date(b.inv.createdAt) - +new Date(a.inv.createdAt));

  const recordPayment = async () => {
    const amt = parseFloat(payAmount);
    if (!amt || amt <= 0) { toast.error("Enter a valid amount"); return; }
    if (!payLockerId) { toast.error("Choose which locker this was deposited into"); return; }
    if (payNeedsRate && (!payRate || payRate <= 0)) { toast.error("Enter the exchange rate before saving this payment"); return; }
    const depositAmt = payNeedsRate ? roundCcy(amt * payRate, payLockerCurrency) : amt;
    // Note recorded on each payment entry → shows in the Income Passbook.
    const note = payRemark.trim() ? `${payMethod} · ${payRemark.trim()}` : payMethod;
    // The advances this payment creates are noted so it can be given its
    // receipt number straight after — every payment is a numbered receipt.
    const txnId = uid("ltx_");
    const at = new Date().toISOString();
    let newAdvanceIds: string[] = [];
    updateDb(d => {
      const c = d.clients.find(x => x.id === id);
      if (!c) return;
      const now = at;
      const beforeIds = advanceIds(d, id!);
      // With an invoice named, settles that invoice (the client's held credit
      // with it); without one, all of it is held as their credit — nothing is
      // spread over the oldest bills (Apply credit does that, deliberately).
      settleClientAccount(d, id!, amt, user!.id, now, note, payInvoiceId || undefined);
      newAdvanceIds = [...advanceIds(d, id!)].filter(x => !beforeIds.has(x));
      // Cash-position tracking — separate from the USD billing allocation above:
      // this is ONE deposit event, so it's recorded once here rather than split
      // across whichever orders the FIFO allocation above happened to touch.
      if (payLockerId) {
        const locker = d.lockers.find(l => l.id === payLockerId);
        if (locker) {
          if (!d.lockerTransactions) d.lockerTransactions = [];
          d.lockerTransactions.push({
            id: txnId, lockerId: payLockerId, type: "income", amountInr: depositAmt,
            currency: ccy(locker.currency), category: `Client Payment — ${c.companyName}`,
            refType: "clientPayment", refId: c.id, note: note, recordedBy: user!.id, createdAt: now,
            exchangeRate: payNeedsRate ? payRate : undefined,
          });
        }
      }
      const clientUser = d.users.find(u => u.clientId === id);
      if (clientUser) d.notifications.unshift({
        id: uid("n_"), userId: clientUser.id,
        title: "Payment Received",
        // Says what happened: against the invoice named, or held as their credit.
        body: payInvoiceId
          ? `${fmtMoney(amt)} received via ${payMethod} against invoice ${d.invoices.find(i => i.id === payInvoiceId)?.number ?? ""}.`.replace(" .", ".")
          : `${fmtMoney(amt)} received via ${payMethod} — held as credit on your account.`,
        type: "info", read: false, createdAt: now,
      });
    });
    let receiptNo = "";
    if (newAdvanceIds.length || amt > 0) {
      try {
        const r = await receiptForAdvance({
          clientId: id!, advanceIds: newAdvanceIds, amountUsd: amt,
          date: at, method: payMethod, remarks: payRemark.trim() || undefined,
          lockerTxnId: payLockerId ? txnId : undefined, userId: user!.id,
        });
        receiptNo = ` · ${r.receiptNo}`;
      } catch {
        toast.error("Payment saved, but its receipt number could not be reserved");
      }
    }
    toast.success(`Payment recorded${receiptNo} (${payMethod}) — ${payInvoiceId ? "against the invoice; anything over is held as credit" : "held as credit"}`);
    setPayAmount(""); setPayRemark(""); setPayLockerId(""); setPayExchangeRate(""); setPayInvoiceId(""); setShowPayForm(false);
  };

  const applyCredit = () => {
    updateDb(d => {
      const c = d.clients.find(x => x.id === id);
      if (!c) return;
      const before = advanceIds(d, id!);
      // Deliberate: the only place credit is put against bills on its own
      // account, oldest invoice first, because somebody pressed the button.
      // Taking money in never does this by itself.
      applyCreditToBills(d, id!, user!.id, new Date().toISOString());
      // No new money came in — this is credit the client already had being put
      // against bills. Marking it keeps it off the list of payments waiting for
      // a receipt number, which would otherwise number the same money twice.
      for (const o of d.orders) {
        if (o.clientId !== id) continue;
        for (const a of o.advances ?? []) if (!before.has(a.id) && !a.receiptId) a.fromCredit = true;
      }
    });
    toast.success("Credit applied to oldest outstanding bills");
  };

  // ── Correcting the record ──
  // A payment is corrected or cancelled through its RECEIPT, which also holds
  // its locker deposit and any credit it left — never by removing advances on
  // their own (the old "reverse" matched advances by time and only cleared a
  // deposit filed under the client, so a payment taken on an order page kept
  // its deposit, and its receipt was never cancelled).
  const mayEditClient = can("clients", "edit");
  const mayDeleteClient = can("clients", "delete");
  const mayPayEdit = can("payments", "edit");
  const mayPayDelete = can("payments", "delete");
  const clientDeleteWhy = !mayDeleteClient ? needsAccess("clients", "delete") : clientDeleteBlocker(db, id!);

  const removeClient = async () => {
    if (await deleteClientFlow(id!)) navigate("/clients");
  };

  // ── Diamonds sold to them out of stock (Buy & Assign → Sell a diamond) ──
  const diamondSales = (db.diamondSales ?? []).filter(x => x.clientId === id);
  const owedByCcy = (["INR", "USD"] as const)
    .map(c => ({ c, v: diamondSales.filter(x => saleCcy(x) === c).reduce((t, x) => t + saleOwed(db.lockerTransactions, x), 0) }))
    .filter(x => x.v > 0.005).map(x => fmtCcy(x.v, x.c));
  const diamondSaleColumns: DataColumn<DiamondSale>[] = [
    { key: "date", header: "Date", kind: "date", sortValue: x => +new Date(x.createdAt), cell: x => <CellDate>{fmtDate(x.createdAt)}</CellDate> },
    { key: "stone", header: "Diamond", always: true, sortValue: x => x.carat,
      cell: x => <span className="text-sm">{x.carat}ct {x.kind === "certified" ? "certified " : ""}{x.shape}{x.notes ? <span className="block text-[11px] text-muted-foreground">{x.notes}</span> : null}</span> },
    { key: "total", header: "Sale", align: "right", kind: "number", sortValue: x => saleTotal(x), cell: x => <CellAmount>{fmtCcy(saleTotal(x), saleCcy(x))}</CellAmount> },
    // Paid at once into an account; on credit, what has come in. An older sale saved
    // with no account says nothing it can't show.
    { key: "received", header: "Received", align: "right", kind: "number", sortValue: x => (x.unpaid ? saleReceived(db.lockerTransactions, x) : x.lockerId ? saleTotal(x) : 0),
      cell: x => (x.unpaid || x.lockerId
        ? <CellAmount tone="in">{fmtCcy(x.unpaid ? saleReceived(db.lockerTransactions, x) : saleTotal(x), saleCcy(x))}</CellAmount>
        : <span className="text-[11px] text-muted-foreground">Not recorded</span>) },
    { key: "owed", header: "Owed", align: "right", kind: "number", sortValue: x => saleOwed(db.lockerTransactions, x),
      cell: x => (saleOwed(db.lockerTransactions, x) > 0 ? <CellAmount tone="out">{fmtCcy(saleOwed(db.lockerTransactions, x), saleCcy(x))}</CellAmount>
        : x.unpaid || x.lockerId ? <CellTag tone="green">Paid</CellTag> : <span className="text-muted-foreground/60">—</span>) },
  ];

  // ── Refunds: their held credit paid back ──
  const refunds = clientRefunds(db, id!);
  const refundedUsd = refunds.reduce((s, t) => s + (t.refundUsd || 0), 0);
  const refundColumns: DataColumn<LockerTransaction>[] = [
    { key: "date", header: "Date", kind: "date", sortValue: t => +new Date(t.createdAt), cell: t => <CellDate>{fmtDate(t.createdAt)}</CellDate> },
    { key: "account", header: "Paid from", always: true, sortValue: t => db.lockers.find(l => l.id === t.lockerId)?.name ?? "",
      cell: t => <span className="text-sm">{db.lockers.find(l => l.id === t.lockerId)?.name ?? "Account"}{t.note ? <span className="block text-[11px] text-muted-foreground">{t.note}</span> : null}</span> },
    { key: "usd", header: "Off their credit", align: "right", kind: "number", sortValue: t => t.refundUsd ?? 0, cell: t => <CellAmount tone="out">{fmtMoney(t.refundUsd || 0)}</CellAmount> },
    { key: "paid", header: "Paid out", align: "right", kind: "number", sortValue: t => t.amountInr, cell: t => <CellAmount>{fmtCcy(t.amountInr, t.currency)}</CellAmount> },
  ];
  const removeRefund = async (t: LockerTransaction) => {
    const acct = db.lockers.find(l => l.id === t.lockerId)?.name ?? "the account";
    const ok = await confirmBox([
      `Delete this refund of ${fmtMoney(t.refundUsd || 0)}?`, "",
      `• ${fmtMoney(t.refundUsd || 0)} goes back onto ${client?.companyName ?? "their"}'s credit`,
      `• ${acct} goes back up by ${fmtCcy(t.amountInr, t.currency)}`,
    ], { confirmText: "Delete refund" });
    if (!ok) return;
    if (deleteClientRefund(t.id)) toast.success("Refund deleted — the credit is back on their account");
    else toast.error("That refund is no longer there");
  };

  const receiptNo = (rid?: string) => (rid ? (db.clientReceipts ?? []).find(r => r.id === rid)?.receiptNo : undefined);
  const paymentActions = (p: InvoicePayment): MoreAction[] => {
    const lock = paymentLockReason(db, p);
    const rcpt = receiptNo(p.receiptId) ? `receipt ${receiptNo(p.receiptId)}` : "the receipt";
    return [
      { label: "Edit", icon: Pencil, disabled: !!lock || !mayPayEdit,
        hint: lock ?? (mayPayEdit ? `Correct ${rcpt}` : needsAccess("payments", "edit")),
        onSelect: async () => { await loadReceipts(); setEditReceiptId(p.receiptId!); } },
      { label: "Delete", icon: Trash2, danger: true, disabled: !!lock || !mayPayDelete,
        hint: lock ?? (mayPayDelete ? `Cancels ${rcpt} — bills, account, credit` : needsAccess("payments", "delete")),
        onSelect: () => cancelReceiptFlow(p.receiptId!, user!.id) },
    ];
  };
  const creditActions = (c: InvoiceBlock["credits"][number]): MoreAction[] => {
    const why = !mayReturn ? needsAccess("invoices", "edit") : creditNoteCancelBlocker(db, c.id);
    return [
      { label: "Print credit note", icon: Printer, onSelect: () => printNote(c.id), show: mayExportInvoices },
      { label: "Cancel return", icon: XCircle, danger: true, disabled: !!why,
        hint: why ?? "Pieces and credit go back", onSelect: () => cancelCreditNoteFlow(c.id, user!) },
    ];
  };
  const invoiceActions = (b: InvoiceBlock): MoreAction[] => [
    { label: "View invoice", icon: Eye, onSelect: () => navigate(`/invoices?q=${encodeURIComponent(b.number)}`),
      disabled: !can("invoices"), hint: can("invoices") ? "On the Invoices page" : needsAccess("invoices", "view") },
  ];


  /** Trim only when the text genuinely cannot fit the column (8.5pt Helvetica
   *  is about 1.6mm a character), so nothing is cut that would have fitted. */
  const fit = (s: string, mm: number) => {
    const max = Math.floor(mm / 1.6);
    return s.length <= max ? s : s.slice(0, max - 1) + "…";
  };



  /**
   * The statement a client is actually sent: invoice by invoice, with the pieces
   * on each invoice listed underneath it, then what was received against it.
   * Order-by-order is our internal view — a client does not recognise an order
   * number they were never given.
   */
  const exportInvoiceStatementCsv = (from: Date | null, to: Date | null) => {
    const blocks = invoiceBlocks.filter(b => inDateRange(b.date, from, to));
    const rows: (string | number)[][] = [];
    for (const b of blocks) {
      for (const i of b.items) {
        rows.push([b.number, fmtDate(b.date), i.orderNo, i.description, i.qty,
          i.gross, i.gift || "", i.returned || "", i.received || "", i.balance]);
      }
      for (const c of b.credits) {
        rows.push([b.number, fmtDate(c.date), "", `Credit note ${c.note}`, "", "", "", c.amount, "", ""]);
      }
      for (const p of b.payments) {
        rows.push([b.number, fmtDate(p.date), "", p.note, "", "", "", "", p.amount, ""]);
      }
      rows.push([b.number, "", "", "Invoice total", "", b.gross, b.gift || "", b.returned || "", b.received, b.balance]);
    }
    downloadCsv(
      `Client-Invoice-Statement-${client.companyName.replace(/\s+/g, "_")}`,
      ["Invoice", "Date", "Order", "Description / Particular", "Qty", "Billed", "Gift card", "Returned", "Received", "Balance"],
      rows,
    );
  };


  const exportInvoiceStatementPdf = (from: Date | null, to: Date | null) => {
    const blocks = invoiceBlocks.filter(b => inDateRange(b.date, from, to));
    const oD = openingDebitAmt(client), oC = openingCreditAmt(client);
    const T = blocks.reduce((t, b) => ({
      gross: t.gross + b.gross, gift: t.gift + b.gift, returned: t.returned + b.returned,
      received: t.received + b.received, balance: t.balance + b.balance,
    }), { gross: 0, gift: 0, returned: 0, received: 0, balance: 0 });
    const closing = oD - oC + T.balance;

    // One table per invoice: its pieces, then the payments received against it.
    const sections = blocks.map(b => ({
      heading: `Invoice ${b.number} · ${fmtDate(b.date)} · ${fmtMoney(b.gross)}${b.balance > 0.009 ? ` · ${fmtMoney(b.balance)} outstanding` : " · settled"}`,
      columns: [
        { header: "Order / Date", x: 14 },
        { header: "Description", x: 52 },
        { header: "Qty", x: 160 },
        { header: "Billed", x: 176 },
        { header: "Gift card", x: 202 },
        { header: "Returned", x: 224 },
        { header: "Received", x: 246 },
        { header: "Balance", x: 266 },
      ],
      align: ["left", "left", "right", "right", "right", "right", "right", "right"] as ("left" | "right")[],
      rows: [
        ...b.items.map(i => [
          i.orderNo, fit(i.description || "—", 104), String(i.qty),
          fmtMoney(i.gross), i.gift ? `-${fmtMoney(i.gift)}` : "",
          i.returned ? `-${fmtMoney(i.returned)}` : "",
          i.received ? fmtMoney(i.received) : "",
          i.balance > 0.009 ? fmtMoney(i.balance) : "Cleared",
        ]),
        ...b.credits.map(c => [
          fmtDate(c.date), fit(`Credit note ${c.note}`, 104), "", "", "", `-${fmtMoney(c.amount)}`, "", "",
        ]),
        ...b.payments.map(p => [
          fmtDate(p.date), fit(`Payment received — ${p.note}`, 104), "", "", "", "", fmtMoney(p.amount), "",
        ]),
      ],
      totalsRow: ["", "Invoice total", "", fmtMoney(b.gross), b.gift ? `-${fmtMoney(b.gift)}` : "",
        b.returned ? `-${fmtMoney(b.returned)}` : "",
        fmtMoney(b.received), b.balance > 0.009 ? fmtMoney(b.balance) : "Cleared"],
    }));

    downloadLedgerPdfMulti({
      company: statementCompany,
      title: "Client Account Statement",
      subjectLines: [
        client.companyName,
        [client.ownerName, client.country].filter(Boolean).join(" · "),
        [client.email, client.phone].filter(Boolean).join("   "),
        from || to ? `Period: ${from ? fmtDate(from.toISOString()) : "start"} → ${to ? fmtDate(to.toISOString()) : "today"}` : "Period: all time",
        `Report Generated: ${new Date().toLocaleDateString("en-IN", { month: "long", day: "numeric", year: "numeric" })}`,
      ].filter(Boolean),
      summary: [
        ...(oD || oC ? [{ label: "Balance brought forward", value: fmtMoney(oD - oC) }] : []),
        { label: "Total billed (gross)", value: fmtMoney(T.gross) },
        ...(T.gift > 0 ? [{ label: "Gift card used", value: fmtMoney(T.gift) }] : []),
        ...(T.returned > 0 ? [{ label: "Returned (credit notes)", value: fmtMoney(T.returned) }] : []),
        { label: "Received", value: fmtMoney(T.received) },
        { label: "Outstanding", value: fmtMoney(Math.max(0, closing)) },
        { label: "Invoices", value: String(blocks.length) },
      ],
      landscape: true,
      sections,
      filename: `Client-Statement-${client.companyName.replace(/\s+/g, "_")}`,
    });
  };




  // The status filter narrows the rows; the table's own search box does the rest.
  const filtered = allOrders.filter(o => statusFilter === "all" || o.status === statusFilter);
  // Behind the table's one Filters button; "All" is the page's own "all".
  const orderFilters: TableFilter[] = [
    { kind: "select", label: "Status", value: statusFilter === "all" ? "" : statusFilter, onChange: v => setStatusFilter(v || "all"),
      options: ["Waiting", "Approved", "In Production", "Ready", "Dispatched", "Delivered", "Rejected"].map(s => ({ value: s, label: s })), allLabel: "All Status" },
  ];

  const progressOf = (o: Order) => (o.timeline.length ? Math.round(o.timeline.filter(t => t.status === "done").length / o.timeline.length * 100) : 0);
  const orderColumns: DataColumn<Order>[] = [
    { key: "order", header: "Order #", always: true, sortValue: o => o.orderNumber,
      cell: o => {
        const progress = progressOf(o);
        // Each order's picture in the row, as on the Orders list — no opening them one by one to see what they are.
        const img = orderImage(o);
        return (
          <div className="flex items-center gap-3 min-w-0">
          <div className="h-11 w-11 rounded-lg overflow-hidden bg-white ring-1 ring-border/60 shrink-0 grid place-items-center">
            {img ? <img src={img} alt="" loading="lazy" {...zoomable(img, orderPictures(o))} className="w-full h-full object-contain cursor-zoom-in" />
              : isDiamondOnlyOrder(o) ? <Gem className="h-4 w-4 text-sky-500/50" /> : <Package className="h-4 w-4 text-primary/30" />}
          </div>
          <div className="min-w-0">
            <p className="font-mono text-xs font-semibold text-brand-dark whitespace-nowrap">{o.orderNumber}</p>
            <div className="mt-1 flex items-center gap-1.5">
              <div className="h-1 w-16 rounded-full bg-secondary overflow-hidden">
                <div className="h-full bg-gradient-to-r from-primary to-brand-light" style={{ width: `${progress}%` }} />
              </div>
              <span className="text-[10px] tabular-nums text-muted-foreground">{progress}%</span>
            </div>
          </div>
          </div>
        );
      } },
    { key: "item", header: "Item", sortValue: o => o.jewelleryType, cell: o => <span className="font-medium whitespace-nowrap">{o.jewelleryType}</span> },
    { key: "metal", header: "Metal", sortValue: o => o.metal, cell: o => <span className="text-muted-foreground whitespace-nowrap">{isDiamondOnlyOrder(o) ? looseLabel(o) : metalLabel(o.metal)}</span> },
    { key: "diamond", header: "Diamond", sortValue: o => o.diamondType, cell: o => <span className="text-muted-foreground whitespace-nowrap">{[o.diamondShape, o.diamondType].filter(Boolean).join(" ")}</span> },
    { key: "qty", header: "Qty", align: "right", kind: "number", sortValue: o => o.quantity, cell: o => <span className="tabular-nums">{o.quantity}</span> },
    { key: "priority", header: "Priority", sortValue: o => o.priority,
      cell: o => <span className={`text-xs font-medium whitespace-nowrap ${o.priority === "Urgent" ? "text-red-500" : o.priority === "High Priority" ? "text-orange-500" : "text-muted-foreground"}`}>{o.priority}</span> },
    { key: "status", header: "Status", sortValue: o => o.status, cell: o => <StatusBadge status={o.status} /> },
    { key: "bill", header: "Bill", align: "right", kind: "number", sortValue: o => orderTotal(o), cell: o => <CellAmount>{fmtMoney(orderTotal(o))}</CellAmount> },
    { key: "advance", header: "Advance", align: "right", kind: "number", sortValue: o => totalAdvance(o),
      cell: o => (totalAdvance(o) > 0 ? <CellAmount tone="in">{fmtMoney(totalAdvance(o))}</CellAmount> : <span className="text-muted-foreground text-xs">—</span>) },
    { key: "balance", header: "Balance", align: "right", kind: "number", sortValue: o => balanceDue(o),
      cell: o => (balanceDue(o) === 0 ? <span className="text-xs font-semibold text-success whitespace-nowrap">✓ Cleared</span> : <CellAmount tone="out">{fmtMoney(balanceDue(o))}</CellAmount>) },
    { key: "invoice", header: "Invoice", align: "center",
      sortValue: o => { const inv = findInvoiceForOrder(allInvoices, o.id); return inv ? (inv.paid ? "Paid" : "Unpaid") : ""; },
      cell: o => {
        const inv = findInvoiceForOrder(allInvoices, o.id);
        return inv ? <CellTag tone={inv.paid ? "green" : "red"}>{inv.paid ? "Paid" : "Unpaid"}</CellTag> : <span className="text-xs text-muted-foreground">—</span>;
      } },
    { key: "date", header: "Date", kind: "date", sortValue: o => +new Date(o.createdAt), csv: o => fmtDate(o.createdAt), cell: o => <CellDate>{fmtDate(o.createdAt)}</CellDate> },
  ];

  // What an opened order adds to its columns: the piece, where it is, how the
  // bill is made up and each payment on it. Weights from the order's own
  // figures (this page doesn't load the factory issues). Never a cost.
  const orderDetails = (o: Order): Detail[] => {
    const inv = findInvoiceForOrder(allInvoices, o.id);
    const st = o.timeline.find(t => t.status === "in_progress") ?? [...o.timeline].reverse().find(t => t.status === "done");
    const by = userName(db, st?.employeeId);
    const pw = pieceWeights(o);
    const weights = [pw.gross ? `Gross ${pw.gross} g` : "", pw.net ? `Net ${pw.net} g` : "", pw.diamondCt ? `${pw.diamondCt} ct` : ""].filter(Boolean).join(" · ");
    const returned = (o.returns ?? []).reduce((s, r) => s + r.creditUsd, 0);
    const parts = [
      `Value ${fmtMoney(o.amount)}`,
      (o.shippingCharge || 0) > 0 ? `shipping ${fmtMoney(o.shippingCharge)}` : "",
      (o.certificateFee || 0) > 0 ? `certificate ${fmtMoney(o.certificateFee || 0)}` : "",
      ...(o.otherCharges ?? []).map(c => `${c.name.toLowerCase()} ${fmtMoney(c.amountUsd)}`),
      (o.giftCardRedeemed || 0) > 0 ? `gift card −${fmtMoney(o.giftCardRedeemed || 0)}` : "",
      returned > 0 ? `returned −${fmtMoney(returned)}` : "",
    ].filter(Boolean);
    return filled([
      !!inv && { label: "Invoice", value: <>{refLink(`/invoices?q=${encodeURIComponent(inv.number)}`, inv.number, can("invoices"))} · {fmtDate(inv.createdAt)}</> },
      !!st && { label: "Stage", value: [stageLabel(st.step), st.date && when(st.date), by && `by ${by}`, st.remarks].filter(Boolean).join(" · ") },
      { label: "Placed", value: when(o.createdAt) },
      { label: "Due", value: o.expectedDelivery && fmtDate(o.expectedDelivery) },
      { label: "Piece", value: [o.productKarats, o.productColor, o.productSize && `size ${o.productSize}`, o.designNumber && `design ${o.designNumber}`].filter(Boolean).join(" · ") },
      { label: pw.estimated ? "Weights (estimated)" : "Weights", value: weights },
      { label: "Assigned to", value: userName(db, o.assignedEmployeeId) },
      !!o.courierName && { label: "Courier", value: (
        <>{o.courierName}{o.trackingNumber ? <> · {refNo(o.trackingNumber)}</> : null}{o.trackingLink ? <> · <a href={o.trackingLink} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline font-medium">Track</a></> : null}</>
      ) },
      !!o.dispatchedAt && { label: "Dispatched", value: fmtDate(o.dispatchedAt) },
      !!o.deliveredAt && { label: "Delivered", value: fmtDate(o.deliveredAt) },
      parts.length > 1 && { label: "Bill made up of", value: parts.join(" · ") },
      (o.advances ?? []).length > 0 && { label: "Payments", value: (
        <ul className="space-y-0.5">
          {(o.advances ?? []).map(a => <li key={a.id}>{fmtDate(a.createdAt)} · {fmtMoney(a.amount)}{a.fromCredit ? " · from credit" : ""}{a.note ? ` · ${a.note}` : ""}</li>)}
        </ul>
      ) },
      !!o.returns?.length && { label: "Returns", value: (
        <ul className="space-y-0.5">
          {(o.returns ?? []).map(r => <li key={r.id}>{r.creditNoteNo} · {fmtDate(r.at)} · {r.qty} pc{r.qty !== 1 ? "s" : ""} · −{fmtMoney(r.creditUsd)} · {r.status === "coming" ? "on its way back" : "received"}</li>)}
        </ul>
      ) },
      !!o.melted && { label: "Melted", value: `${fmtDate(o.melted.at)} by ${o.melted.byName}${o.melted.reason ? ` — ${o.melted.reason}` : ""}` },
      { label: "Instructions", value: noteText(o.instructions) },
    ]);
  };

  /**
   * Client order report. This was hand-drawn onto a jsPDF page and cut every
   * field to a fixed length — orderNumber.slice(-10) turned SLJ-2026-1025 into
   * "-2026-1025" and "In Production" into "In Productio". It now goes through
   * the same exporter as every other ledger: branded, landscape, paginated, and
   * wide enough that nothing is cut.
   */
  const downloadClientReport = async () => {
    const rows = allOrders
      .slice()
      .sort((a, b) => +new Date(a.createdAt) - +new Date(b.createdAt));
    const value = rows.reduce((s, o) => s + orderTotal(o), 0);
    const paid = rows.reduce((s, o) => s + totalAdvance(o), 0);
    // Each order's picture beside it, as on the page — fetched first, small.
    const wait = rows.length ? toast.loading("Preparing the report with photos…") : undefined;
    const images = await pdfThumbs(rows.map(o => orderImage(o)));
    if (wait !== undefined) toast.dismiss(wait);
    downloadLedgerPdf({
      company: statementCompany,
      title: "Client Order Report",
      subjectLines: [
        client.companyName,
        [client.ownerName, client.country].filter(Boolean).join(" · "),
        [client.email, client.phone].filter(Boolean).join("   "),
        client.gstVat ? `GST/VAT: ${client.gstVat}` : "",
        `Report Generated: ${new Date().toLocaleDateString("en-IN", { month: "long", day: "numeric", year: "numeric" })}`,
      ].filter(Boolean),
      summary: [
        { label: "Total Orders", value: String(rows.length) },
        { label: "Delivered / Active", value: `${deliveredOrders} / ${activeOrders}` },
        { label: "Total Order Value", value: fmtMoney(value) },
        { label: "Received", value: fmtMoney(paid) },
        { label: "Outstanding", value: fmtMoney(Math.max(0, value - paid)) },
      ],
      landscape: true,
      pictures: { header: "Photo", x: 14, images },
      columns: [
        { header: "Order #", x: 30 },
        { header: "Date", x: 64 },
        { header: "Item", x: 88 },
        { header: "Metal", x: 122 },
        { header: "Design #", x: 158 },
        { header: "Qty", x: 186 },
        { header: "Order Value", x: 200 },
        { header: "Received", x: 228 },
        { header: "Balance", x: 252 },
      ],
      align: ["left", "left", "left", "left", "left", "right", "right", "right", "right"],
      rows: rows.map(o => [
        o.orderNumber,
        fmtDate(o.createdAt),
        fit(o.jewelleryType, 22),
        fit(o.metal, 22),
        fit(o.designNumber || "", 16),
        String(o.quantity),
        fmtMoney(orderTotal(o)),
        totalAdvance(o) ? fmtMoney(totalAdvance(o)) : "",
        balanceDue(o) > 0 ? fmtMoney(balanceDue(o)) : "Cleared",
      ]),
      totalsRow: [
        "", "", "", "", "Totals", "",
        fmtMoney(value), fmtMoney(paid), fmtMoney(Math.max(0, value - paid)),
      ],
      filename: `ClientReport-${client.companyName.replace(/\s+/g, "_")}`,
    });
  };

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      {/* The name row: taking a payment is what people come here to do; the
          two downloads share one "Export" menu; the record itself and credit
          wait in the ⋯ — greyed with the reason when access doesn't reach
          them, or, for Delete, when anything is on record for them. */}
      <PageHeader
        back={{ label: "Back to Clients", to: "/clients" }}
        title={client.companyName}
        subtitle={[client.ownerName, `${allOrders.length} order${allOrders.length !== 1 ? "s" : ""}`, activeOrders ? `${activeOrders} active` : "", deliveredOrders ? `${deliveredOrders} delivered` : ""].filter(Boolean).join(" · ")}
        primary={can("payments", "add") ? { label: "Record Payment", icon: Plus, onClick: () => setShowPayForm(true) } : null}
        secondary={mayExport ? { label: "Export", icon: Download, items: [
          { label: "Export Report", icon: Package, hint: "Every order, as a PDF", onSelect: downloadClientReport },
          { label: "Export statement", icon: FileText, hint: "PDF or Excel, invoice by invoice", onSelect: () => setShowExport(true) },
        ] } : null}
        menu={[
          { label: "Create invoice", icon: FileText, onSelect: () => navigate(`/invoices?bill=${encodeURIComponent(client.id)}`),
            show: user!.role !== "client", disabled: !can("invoices", "add"),
            hint: !can("invoices", "add") ? needsAccess("invoices", "add")
              : toBill.ready.length ? `${toBill.ready.length} ready · ${fmtMoney(toBill.total)}` : "From their dispatched orders" },
          { label: "Apply credit", icon: CreditCard, hint: `Use ${fmtMoney(account.credit)} on what's owed`, onSelect: applyCredit,
            show: account.credit > 0 && account.outstanding > 0 && can("payments", "edit") },
          { label: "Refund credit", icon: Undo2, onSelect: () => setRefunding(true), show: can("payments", "add"),
            disabled: !((client.creditBalance || 0) > 0.005),
            hint: (client.creditBalance || 0) > 0.005 ? `Pay their ${fmtMoney(client.creditBalance || 0)} back to them` : "They hold no credit to refund" },
          { label: "Edit details", icon: Pencil, onSelect: () => setEditingClient(true), disabled: !mayEditClient,
            hint: mayEditClient ? "Name, contact, address, opening balance" : needsAccess("clients", "edit") },
          { label: client.status === "active" ? "Deactivate" : "Activate", icon: Power, onSelect: () => toggleClientActive(client.id), disabled: !mayEditClient,
            hint: !mayEditClient ? needsAccess("clients", "edit") : client.status === "active" ? "Stops sign-in; history stays" : "They can sign in again" },
          { label: "Delete client", icon: Trash2, danger: true, onSelect: removeClient, disabled: !!clientDeleteWhy, hint: clientDeleteWhy },
        ]}
      >
        <div className="mt-2"><StatusBadge status={client.status} /></div>
      </PageHeader>

      {/* Client Profile Card — who they are. */}
      {/* Long values are cut with "…" and given whole on hover, never broken
          mid-word; on a phone the email takes the whole row. */}
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="card-luxe p-5 sm:p-6">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm min-w-0">
          <div className="col-span-2 md:col-span-1 flex items-start gap-2 min-w-0">
            <Mail className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
            <div className="min-w-0"><p className="text-xs text-muted-foreground">Email</p><p className="font-medium truncate"><EmailLink email={client.email} /></p></div>
          </div>
          <div className="flex items-start gap-2">
            <Phone className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
            <div className="min-w-0"><p className="text-xs text-muted-foreground">Phone</p><p className="font-medium"><PhoneLink phone={client.phone} /></p></div>
          </div>
          <div className="flex items-start gap-2">
            <Globe className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
            <div><p className="text-xs text-muted-foreground">Country</p><p className="font-medium">{client.country || "—"}</p></div>
          </div>
          <div className="flex items-start gap-2">
            <Hash className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
            <div><p className="text-xs text-muted-foreground">GST / VAT</p><p className="font-medium">{client.gstVat || "—"}</p></div>
          </div>
          {client.address && (
            <div className="col-span-2 flex items-start gap-2 min-w-0">
              <MapPin className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
              <div className="min-w-0"><p className="text-xs text-muted-foreground">Billing address</p><p className="font-medium break-words">{client.address}</p></div>
            </div>
          )}
          {client.shippingAddress && (
            <div className="col-span-2 flex items-start gap-2 min-w-0">
              <MapPin className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
              <div className="min-w-0"><p className="text-xs text-muted-foreground">Shipping address</p><p className="font-medium break-words">{client.shippingAddress}</p></div>
            </div>
          )}
          <div className="flex items-start gap-2">
            <Clock className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
            <div><p className="text-xs text-muted-foreground">Client Since</p><p className="font-medium">{fmtDate(client.createdAt)}</p></div>
          </div>
          <div className="flex items-start gap-2 min-w-0">
            <FileText className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
            <div className="min-w-0"><p className="text-xs text-muted-foreground">Username</p><p className="font-medium font-mono text-xs truncate" title={client.username}>{client.username}</p></div>
          </div>
        </div>
      </motion.div>

      {/* Shipped work with no invoice yet — nothing else asks for it to be
          billed. Opens Invoices with this client's Create invoice open. */}
      {(toBill.ready.length > 0 || toBill.noPrice.length > 0) && (
        <div className="rounded-2xl border border-primary/30 bg-primary/5 px-4 sm:px-5 py-3 flex items-center gap-3 flex-wrap">
          <FileText className="h-5 w-5 text-primary shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-brand-dark">
              {toBill.ready.length > 0
                ? <>{toBill.ready.length} order{toBill.ready.length !== 1 ? "s" : ""} ready to bill · {fmtMoney(toBill.total)}</>
                : <>{toBill.noPrice.length} shipped order{toBill.noPrice.length !== 1 ? "s" : ""} not billed</>}
            </p>
            <p className="text-xs text-muted-foreground">
              {toBill.ready.length > 0 ? "Dispatched, not on an invoice yet" : "Needs a price before it can be billed"}
              {toBill.ready.length > 0 && toBill.noPrice.length > 0 && ` · ${toBill.noPrice.length} more need${toBill.noPrice.length === 1 ? "s" : ""} a price first`}
            </p>
          </div>
          {can("invoices", "add") && (
            <Button size="sm" onClick={() => navigate(`/invoices?bill=${encodeURIComponent(client.id)}`)} className="btn-hero rounded-xl gap-1.5 max-sm:w-full">
              {toBill.ready.length > 0 ? "Create invoice" : "Open"} <ArrowRight className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      )}

      {/* Where the account stands, once — split as Invoices reads it. Due now
          is what their invoices say is due (the Invoice Statement's figure);
          on order is work not billed yet. Together they are everything owed,
          which is order value less what was received. Credit stands on its own. */}
      <StatStrip items={[
        { label: "Due now", value: account.dueNow > 0 ? fmtMoney(account.dueNow) : "✓ Cleared", tone: account.dueNow > 0 ? "out" : "in", icon: AlertCircle,
          sub: openingDebitAmt(client) > 0 ? "Billed, unpaid · with balance brought forward" : "Billed, not paid" },
        { label: "On order, not billed", value: fmtMoney(account.notBilled), icon: Hourglass, sub: "Owed once invoiced" },
        { label: "Order value", value: fmtMoney(account.billed), icon: FileText,
          sub: `${fmtMoney(account.allocated)} received · ${fmtMoney(account.outstanding)} owed in all` },
        { label: "Credit (advance)", value: fmtMoney(account.credit), icon: Wallet,
          sub: refundedUsd > 0.005 ? `Held for them · ${fmtMoney(refundedUsd)} refunded` : "Held for them" },
      ]} />

      {/* Diamonds sold to them straight out of stock — paid at once, or on credit
          until their payments cover it (lib/diamondSalePay.ts). */}
      {diamondSales.length > 0 && (
        <div className="card-luxe overflow-hidden">
          <SectionTitle title="Diamond sales" className="px-5 py-4 border-b border-border/60"
            sub={owedByCcy.length ? `Still owed: ${owedByCcy.join(" + ")}` : "Sold from stock — all paid"} />
          <div className="p-3 sm:p-4">
            <DataTable id="client-diamond-sales" noun="sale" rows={diamondSales} rowKey={x => x.id} columns={diamondSaleColumns}
              defaultSort={{ key: "date", dir: "desc" }} details={false}
              rowActions={x => [
                { label: "Receive payment", icon: Wallet, show: !!x.unpaid, disabled: !can("payments", "add"),
                  hint: !can("payments", "add") ? needsAccess("payments", "add") : saleOwed(db.lockerTransactions, x) > 0 ? `${fmtCcy(saleOwed(db.lockerTransactions, x), saleCcy(x))} still owed` : "Paid in full — see the payments",
                  onSelect: () => setPaySale(x) },
                { label: "Open in Buy & Assign", icon: Eye, onSelect: () => navigate("/buy-assign"), hint: "Cancel or check the sale there" },
              ]} />
          </div>
        </div>
      )}

      {/* Credit paid back to them — each refund, and Delete puts the credit back. */}
      {refunds.length > 0 && (
        <div className="card-luxe overflow-hidden">
          <SectionTitle title="Refunds" sub="Credit paid back to them" className="px-5 py-4 border-b border-border/60" />
          <div className="p-3 sm:p-4">
            <DataTable id="client-refunds" noun="refund" rows={refunds} rowKey={t => t.id} columns={refundColumns}
              defaultSort={{ key: "date", dir: "desc" }} details={false}
              rowActions={t => [
                { label: "Delete refund", icon: Trash2, danger: true, disabled: !mayPayDelete,
                  hint: mayPayDelete ? "The credit goes back on their account" : needsAccess("payments", "delete"),
                  onSelect: () => { void removeRefund(t); } },
              ]}
              totals={{ usd: list => fmtMoney(list.reduce((s, t) => s + (t.refundUsd || 0), 0)) }} />
          </div>
        </div>
      )}
      <ExportDialog open={showExport} onClose={() => setShowExport(false)} title={`${client.companyName} statement`} options={[
        { label: "Invoice Statement — PDF", sublabel: "Invoice by invoice, with the pieces on each one", kind: "pdf", run: exportInvoiceStatementPdf },
        { label: "Invoice Statement — Excel", sublabel: "Invoice by invoice, with the pieces on each one", kind: "excel", run: exportInvoiceStatementCsv },
      ]} />

      {/* Their own gold and diamonds, held for them (lib/clientMaterial.ts). */}
      {user!.role !== "client" && <ClientMaterialCard clientId={id!} />}

      {/* ── Gift Card & Cashback (admin only) ── */}
      <GiftCardAdminPanel clientId={id!} />

      <ClientInvoiceLedger
        blocks={invoiceBlocks}
        client={client}
        openingDebit={openingDebitAmt(client)}
        openingCredit={openingCreditAmt(client)}
        onExport={() => setShowExport(true)}
        invoiceActions={invoiceActions}
        paymentActions={paymentActions}
        creditActions={creditActions}
      />
      <ClientEditDialog clientId={editingClient ? client.id : null} onClose={() => setEditingClient(false)} />
      <ReceiptEditSheet receiptId={editReceiptId} onClose={() => setEditReceiptId(null)} />
      {can("payments", "add") && <RefundClientSheet open={refunding} onOpenChange={setRefunding} clientId={client.id} />}
      <SalePaymentSheet sale={paySale} onClose={() => setPaySale(null)} />

      {/* Account Statement — same ledger as Stock and Locker: summary, filters,
          then every entry with a running balance. */}


      {/* Order History */}
      <div className="card-luxe overflow-hidden">
        {/* How many is the table's own count; the status filter shows as a chip. */}
        <SectionTitle title="Order History" className="px-5 py-4 border-b border-border/60" />

        <div className="p-3 sm:p-4">
          <DataTable
            id="client-orders"
            noun="order"
            rows={filtered}
            columns={orderColumns}
            rowKey={o => o.id}
            rowHref={o => `/orders/${o.id}`}
            details={orderDetails}
            defaultSort={{ key: "date", dir: "desc" }}
            pageSizes={[10, 25, 50]}
            searchText={o => [o.orderNumber, o.jewelleryType, o.metal, o.diamondType, o.priority, o.status, findInvoiceForOrder(allInvoices, o.id)?.number].filter(Boolean).join(" ")}
            searchPlaceholder="Search orders"
            exportName={`Client-${client.companyName.replace(/\s+/g, "_")}-Orders`}
            filters={orderFilters}
            onClearFilters={() => setStatusFilter("all")}
            resetKey={statusFilter}
            totals={{
              bill: list => fmtMoney(list.reduce((s, o) => s + orderTotal(o), 0)),
              advance: list => <span className="text-success">{fmtMoney(list.reduce((s, o) => s + totalAdvance(o), 0))}</span>,
              balance: list => { const bal = list.reduce((s, o) => s + balanceDue(o), 0); return <span className={bal > 0 ? "text-destructive" : "text-success"}>{fmtMoney(bal)}</span>; },
            }}
            emptyText={
              <span className="inline-flex flex-col items-center gap-1">
                <Package className="h-10 w-10 opacity-20" />
                <span className="font-medium">{allOrders.length === 0 ? "No orders yet" : "No orders match filters"}</span>
              </span>
            }
          />
        </div>
      </div>

      {/* Recording a payment is a panel, so the ledger and the order history
          behind stay where they were. Closing it keeps what was typed; Cancel
          clears the amount and remark, as the inline form did. */}
      {(() => {
        // No rate yet → nothing to show, rather than the dollar figure in another currency.
        const payDepositPreview = !payAmount ? null : !payNeedsRate ? Number(payAmount) : payRate > 0 ? Number(payAmount) * payRate : null;
        return (
          <ActionSheet
            open={showPayForm}
            onOpenChange={setShowPayForm}
            title="Record Client Payment"
            description={<>From {client.companyName} · pick an invoice to settle it, or it's held as credit{account.credit > 0 && <> · {fmtMoney(account.credit)} credit held</>}</>}
            icon={Wallet}
            footer={
              <div className="flex items-end justify-between gap-3 flex-wrap">
                {payAmount && payLockerId && (
                  <div className="min-w-0 flex-1 basis-56 space-y-1">
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Summary</p>
                    <div className="flex items-center justify-between gap-3 text-sm">
                      <span className="text-muted-foreground">Received</span>
                      <span className="font-medium text-foreground">{fmtMoney(Number(payAmount))}</span>
                    </div>
                    {/* Where it goes, as it will be saved: against the invoice chosen, else held as credit. */}
                    <div className="flex items-center justify-between gap-3 text-sm">
                      <span className="text-muted-foreground min-w-0 truncate">{payInvoiceId
                        ? `Against invoice ${openInvoicesForPay.find(x => x.inv.id === payInvoiceId)?.inv.number ?? ""}`
                        : "Held as credit"}</span>
                      <span className="font-semibold text-primary">{fmtMoney(Number(payAmount))}</span>
                    </div>
                    {!payInvoiceId && <p className="text-[11px] text-muted-foreground">Settles no bill yet — use “Apply credit” to put it on their bills.</p>}
                    {payDepositPreview != null && payLocker && (
                      <div className="flex items-center justify-between gap-3 text-sm">
                        <span className="text-muted-foreground min-w-0 truncate">Deposited to {payLocker.name}</span>
                        <span className="font-semibold text-foreground shrink-0">{fmtCcy(roundCcy(payDepositPreview, payLockerCurrency), payLockerCurrency)}</span>
                      </div>
                    )}
                  </div>
                )}
                <div className="flex gap-2.5 ml-auto">
                  <Button variant="outline" onClick={() => { setShowPayForm(false); setPayAmount(""); setPayRemark(""); }} className="rounded-xl h-10">Cancel</Button>
                  <AsyncButton onClick={recordPayment} className="btn-hero rounded-xl h-10">Save &amp; Allocate</AsyncButton>
                </div>
              </div>
            }
          >
            <div className="space-y-3">
              {/* Amount */}
              <div className="relative">
                <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  type="number" min="1" step="0.01" autoFocus
                  value={payAmount} onChange={e => setPayAmount(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && recordPayment()}
                  className="pl-9 rounded-xl h-10" placeholder="Amount received ($)" />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                {/* Which bill this is for — blank holds it as credit */}
                {openInvoicesForPay.length > 0 && (
                  <Select value={payInvoiceId || "credit"} onValueChange={v => setPayInvoiceId(v === "credit" ? "" : v)}>
                    <SelectTrigger className="h-10 rounded-xl">
                      <FileText className="h-4 w-4 mr-2 shrink-0 text-muted-foreground" /><SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="credit">No invoice — hold as credit</SelectItem>
                      {openInvoicesForPay.map(({ inv, bal }) => (
                        <SelectItem key={inv.id} value={inv.id}>
                          Invoice {inv.number} — {fmtMoney(bal)} pending
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
                {/* Method */}
                <ListCombo list="paymentMethods" value={payMethod} onChange={setPayMethod} optional={false} className="h-10 rounded-xl" ariaLabel="Payment method" />
              </div>
              {/* Remark */}
              <Input
                value={payRemark} onChange={e => setPayRemark(e.target.value)}
                onKeyDown={e => e.key === "Enter" && recordPayment()}
                className="rounded-xl h-10" placeholder="Remark / ref (optional)" />

              {db.lockers.filter(l => l.active !== false).length === 0 && (
                <p className="text-xs text-amber-600">
                  No lockers yet — <Link to="/locker" className="inline-block py-2.5 -my-2.5 underline font-medium">create one first</Link> before recording a payment.
                </p>
              )}
              <Select value={payLockerId} onValueChange={addNew("locker", pickPayLocker)}>
                <SelectTrigger className="h-10 rounded-xl"><SelectValue placeholder="Deposited to locker *" /></SelectTrigger>
                <SelectContent>
                  {db.lockers.filter(l => l.active !== false).map(l => <SelectItem key={l.id} value={l.id}>{l.name} ({ccy(l.currency)})</SelectItem>)}
                <AddNewItem kind="locker" /></SelectContent>
              </Select>

              {payNeedsRate && (
                <div className="p-3 rounded-xl bg-secondary space-y-2">
                  <RateInput id="client-pay-rate" from="USD" to={payLockerCurrency} value={payExchangeRate}
                    onChange={setPayExchangeRate} amount={Number(payAmount) || undefined} />
                  <p className="text-xs text-muted-foreground">This locker holds {payLockerCurrency}, not USD — the rate converts what lands in it.</p>
                </div>
              )}
            </div>
          </ActionSheet>
        );
      })()}
    </div>
  );
}
