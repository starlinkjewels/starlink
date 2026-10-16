import { AddNewItem, useAddNew } from "@/components/create/QuickCreate";
import { MAIN_COMPANY_ID, companyById, companyIdOfClient, hasCompanies } from "@/lib/companies";
import { useCan, useMayExport } from "@/hooks/useCan";
import { MoreMenu } from "@/components/MoreMenu";
import { advanceIds, receiptForAdvance } from "@/lib/receipts";
import { useState } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { collectionLoaded, worksOnClient, fmtMoney, fmtDate, totalAdvance, balanceDue, orderTotal, orderGrossTotal, updateDb, uid, settleClientAccount, applyCreditToBills, clientAccount, findInvoiceForOrder, invoiceOrderIds, hasOpeningBalance, openingDebitAmt, openingCreditAmt } from "@/lib/db";
import { useDb } from "@/hooks/useDb";
import { ClientInvoiceLedger, buildInvoiceBlocks } from "@/components/ClientInvoiceLedger";
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
import type { Order } from "@/lib/db";
import {
  ArrowLeft, Package, Mail, Phone, MapPin, Globe, Undo2,
  FileText, TrendingUp, Clock, CheckCircle2, AlertCircle,
  Download, Building2, Hash, Wallet, Plus, CreditCard, DollarSign,
} from "lucide-react";
import { motion } from "framer-motion";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth";
import { downloadCsv, downloadLedgerPdf, downloadLedgerPdfMulti } from "@/lib/ledgerExport";
import { ExportDialog, inDateRange } from "@/components/ExportDialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { FileSpreadsheet } from "lucide-react";
import { confirmBox } from "@/lib/confirm";
import { IfExport } from "@/components/IfExport";

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
        <Link to="/clients" className="text-primary underline">Back</Link>
      </div>
    );
  }
  // Keyed by the record, so moving straight to another one starts it afresh.
  return <ClientHistoryPageBody key={id} />;
}

function ClientHistoryPageBody() {
  const mayExport = useMayExport();
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const can = useCan();
  const db = useDb();
  const addNew = useAddNew();

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
        <Link to="/clients" className="text-primary underline">Back to Clients</Link>
      </div>
    );
  }

  const allOrders = db.orders
    .filter(o => o.clientId === id)
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

  const [showExport, setShowExport] = useState(false);

  // ── Client account / payments ──
  const [payAmount, setPayAmount] = useState("");
  const [payMethod, setPayMethod] = useState("Cash");
  const [payRemark, setPayRemark] = useState("");
  const [payInvoiceId, setPayInvoiceId] = useState("");
  const [payLockerId, setPayLockerId] = useState("");
  // The locker's currency for $1 (₹ per $, A$ per $…).
  const [payExchangeRate, setPayExchangeRate] = useState<number | "">("");
  const [showPayForm, setShowPayForm] = useState(false);
  const account = clientAccount(billableOrders, client?.creditBalance || 0, client);
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
      // Reclaim any over-payment, fold in existing credit + this amount, then
      // re-allocate oldest-bill-first — tagging entries with the payment method.
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
        body: `${fmtMoney(amt)} received via ${payMethod} and applied to your oldest pending orders.`,
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
    toast.success(`Payment recorded${receiptNo} (${payMethod}) & allocated to oldest bills`);
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

  // Reverse a wrongly-entered payment (admin). A payment is ONE deposit event:
  // its allocations across orders all carry the exact same timestamp, and it
  // wrote one matching locker income line. We only allow a clean reversal — when
  // the client isn't carrying credit — so we never have to guess how much of an
  // opaque credit balance came from this particular payment. If credit is being
  // held, we refuse and point the admin at Apply Credit / manual adjustment.
  const reversePayment = async (paymentCreatedAt: string) => {
    if (user?.role !== "admin") { toast.error("Only an admin can reverse a payment."); return; }
    if ((client?.creditBalance || 0) > 0) {
      toast.error("This client is carrying credit on account, so a payment can't be cleanly reversed here. Clear the credit first, or adjust manually.");
      return;
    }
    const affected = billableOrders.flatMap(o => (o.advances || []).filter(a => a.createdAt === paymentCreatedAt));
    const total = affected.reduce((s, a) => s + a.amount, 0);
    if (affected.length === 0) { toast.error("Couldn't find this payment's allocations."); return; }
    if (!(await confirmBox(`Reverse this payment of ${fmtMoney(total)}? It will be removed from the ${affected.length} bill(s) it was applied to and from the locker. This can't be undone.`))) return;
    updateDb(d => {
      for (const o of d.orders.filter(o => o.clientId === id)) {
        if (o.advances) o.advances = o.advances.filter(a => a.createdAt !== paymentCreatedAt);
      }
      if (d.lockerTransactions) {
        d.lockerTransactions = d.lockerTransactions.filter(
          t => !(t.refType === "clientPayment" && t.refId === id && t.createdAt === paymentCreatedAt),
        );
      }
    });
    toast.success("Payment reversed");
  };



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
        `Report Generated: ${new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}`,
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

  const progressOf = (o: Order) => (o.timeline.length ? Math.round(o.timeline.filter(t => t.status === "done").length / o.timeline.length * 100) : 0);
  const orderColumns: DataColumn<Order>[] = [
    { key: "order", header: "Order #", always: true, sortValue: o => o.orderNumber,
      cell: o => {
        const progress = progressOf(o);
        return (
          <div className="min-w-0">
            <p className="font-mono text-xs font-semibold text-brand-dark whitespace-nowrap">{o.orderNumber}</p>
            <div className="mt-1 flex items-center gap-1.5">
              <div className="h-1 w-16 rounded-full bg-secondary overflow-hidden">
                <div className="h-full bg-gradient-to-r from-primary to-brand-light" style={{ width: `${progress}%` }} />
              </div>
              <span className="text-[10px] tabular-nums text-muted-foreground">{progress}%</span>
            </div>
          </div>
        );
      } },
    { key: "item", header: "Item", sortValue: o => o.jewelleryType, cell: o => <span className="font-medium whitespace-nowrap">{o.jewelleryType}</span> },
    { key: "metal", header: "Metal", sortValue: o => o.metal, cell: o => <span className="text-muted-foreground whitespace-nowrap">{o.metal}</span> },
    { key: "diamond", header: "Diamond", sortValue: o => o.diamondType, cell: o => <span className="text-muted-foreground whitespace-nowrap">{o.diamondType}</span> },
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

  /**
   * Client order report. This was hand-drawn onto a jsPDF page and cut every
   * field to a fixed length — orderNumber.slice(-10) turned SLJ-2026-1025 into
   * "-2026-1025" and "In Production" into "In Productio". It now goes through
   * the same exporter as every other ledger: branded, landscape, paginated, and
   * wide enough that nothing is cut.
   */
  const downloadClientReport = () => {
    const rows = allOrders
      .slice()
      .sort((a, b) => +new Date(a.createdAt) - +new Date(b.createdAt));
    const value = rows.reduce((s, o) => s + orderTotal(o), 0);
    const paid = rows.reduce((s, o) => s + totalAdvance(o), 0);
    downloadLedgerPdf({
      company: statementCompany,
      title: "Client Order Report",
      subjectLines: [
        client.companyName,
        [client.ownerName, client.country].filter(Boolean).join(" · "),
        [client.email, client.phone].filter(Boolean).join("   "),
        client.gstVat ? `GST/VAT: ${client.gstVat}` : "",
        `Report Generated: ${new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}`,
      ].filter(Boolean),
      summary: [
        { label: "Total Orders", value: String(rows.length) },
        { label: "Delivered / Active", value: `${deliveredOrders} / ${activeOrders}` },
        { label: "Total Order Value", value: fmtMoney(value) },
        { label: "Received", value: fmtMoney(paid) },
        { label: "Outstanding", value: fmtMoney(Math.max(0, value - paid)) },
      ],
      landscape: true,
      columns: [
        { header: "Order #", x: 14 },
        { header: "Date", x: 52 },
        { header: "Item", x: 80 },
        { header: "Metal", x: 118 },
        { header: "Design #", x: 156 },
        { header: "Qty", x: 186 },
        { header: "Order Value", x: 200 },
        { header: "Received", x: 228 },
        { header: "Balance", x: 252 },
      ],
      align: ["left", "left", "left", "left", "left", "right", "right", "right", "right"],
      rows: rows.map(o => [
        o.orderNumber,
        fmtDate(o.createdAt),
        fit(o.jewelleryType, 36),
        fit(o.metal, 36),
        fit(o.designNumber || "", 28),
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
      {/* Back */}
      <button onClick={() => navigate("/clients")} className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors">
        <ArrowLeft className="h-4 w-4" /> Back to Clients
      </button>

      {/* Client Profile Card */}
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="card-luxe p-6">
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
          <div className="flex items-start gap-4 min-w-0">
            <div className="h-14 w-14 rounded-2xl bg-gradient-to-br from-primary/15 to-brand-light/15 grid place-items-center shrink-0">
              <Building2 className="h-7 w-7 text-primary" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="font-display text-xl md:text-3xl text-brand-dark leading-tight break-words">{client.companyName}</h1>
                <StatusBadge status={client.status} />
              </div>
              <p className="text-muted-foreground mt-1 break-words">{client.ownerName}</p>
            </div>
          </div>
          <IfExport>
          <Button onClick={downloadClientReport} variant="outline" className="rounded-xl gap-2 w-full sm:w-auto shrink-0">
            <Download className="h-4 w-4" /> Export Report
          </Button>
          </IfExport>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-6 text-sm">
          <div className="flex items-start gap-2 min-w-0">
            <Mail className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
            <div className="min-w-0"><p className="text-xs text-muted-foreground">Email</p><p className="font-medium break-all">{client.email || "—"}</p></div>
          </div>
          <div className="flex items-start gap-2">
            <Phone className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
            <div><p className="text-xs text-muted-foreground">Phone</p><p className="font-medium">{client.phone || "—"}</p></div>
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
              <div className="min-w-0"><p className="text-xs text-muted-foreground">Address</p><p className="font-medium break-words">{client.address}</p></div>
            </div>
          )}
          <div className="flex items-start gap-2">
            <Clock className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
            <div><p className="text-xs text-muted-foreground">Client Since</p><p className="font-medium">{fmtDate(client.createdAt)}</p></div>
          </div>
          <div className="flex items-start gap-2 min-w-0">
            <FileText className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
            <div className="min-w-0"><p className="text-xs text-muted-foreground">Username</p><p className="font-medium font-mono text-xs break-all">{client.username}</p></div>
          </div>
        </div>
      </motion.div>

      {/* Summary Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: "Total Orders", value: allOrders.length, icon: Package, color: "text-primary", bg: "from-primary/10 to-brand-light/10" },
          { label: "Active Orders", value: activeOrders, icon: Clock, color: "text-warning-foreground", bg: "from-warning/10 to-orange-400/10" },
          { label: "Delivered", value: deliveredOrders, icon: CheckCircle2, color: "text-success", bg: "from-success/10 to-emerald-400/10" },
          { label: "Total Value", value: fmtMoney(totalValue), icon: TrendingUp, color: "text-brand-dark", bg: "from-brand-light/10 to-primary/10" },
        ].map((s, i) => (
          <motion.div key={s.label} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}
            className={`card-luxe p-4 bg-gradient-to-br ${s.bg}`}>
            <div className={`h-9 w-9 rounded-xl bg-white/80 grid place-items-center mb-3 ${s.color}`}>
              <s.icon className="h-5 w-5" />
            </div>
            <p className="text-2xl font-display font-bold text-brand-dark">{s.value}</p>
            <p className="text-xs text-muted-foreground mt-1">{s.label}</p>
          </motion.div>
        ))}
      </div>

      {/* ── Gift Card & Cashback (admin only) ── */}
      <GiftCardAdminPanel clientId={id!} />

      {/* ── Account Ledger (payments apply oldest-bill-first) ── */}
      <div className="card-luxe p-5 space-y-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-success/10 grid place-items-center shrink-0">
              <Wallet className="h-5 w-5 text-success" />
            </div>
            <div>
              <h3 className="font-display text-lg text-brand-dark">Account Ledger</h3>
              <p className="text-xs text-muted-foreground">Payments clear the oldest bill first; extra becomes credit</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <ExportDialog open={showExport} onClose={() => setShowExport(false)} title={`${client.companyName} statement`} options={[
              { label: "Invoice Statement — PDF", sublabel: "Invoice by invoice, with the pieces on each one", kind: "pdf", run: exportInvoiceStatementPdf },
              { label: "Invoice Statement — Excel", sublabel: "Invoice by invoice, with the pieces on each one", kind: "excel", run: exportInvoiceStatementCsv },
            ]} />
            {can("payments", "add") && (
              <Button onClick={() => setShowPayForm(true)} className="btn-hero rounded-xl gap-2">
                <Plus className="h-4 w-4" /> Record Payment
              </Button>
            )}
            <MoreMenu title="Account" actions={[
              { label: "Apply credit", icon: CreditCard, hint: `Use the ${fmtMoney(account.credit)} credit against what is owed`, onSelect: applyCredit,
                show: account.credit > 0 && account.outstanding > 0 && can("payments", "edit") },
              { label: "Export statement", icon: Download, hint: "PDF or Excel, invoice by invoice", onSelect: () => setShowExport(true), show: mayExport },
            ]} />
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="p-3 rounded-xl bg-secondary text-center">
            <p className="text-xs text-muted-foreground mb-1">Total Billed</p>
            <p className="font-semibold text-sm">{fmtMoney(account.billed)}</p>
          </div>
          <div className="p-3 rounded-xl bg-success/8 border border-success/20 text-center">
            <p className="text-xs text-muted-foreground mb-1">Received</p>
            <p className="font-semibold text-sm text-success">{fmtMoney(account.allocated)}</p>
          </div>
          <div className={`p-3 rounded-xl text-center border ${account.outstanding > 0 ? "bg-destructive/5 border-destructive/20" : "bg-success/8 border-success/20"}`}>
            <p className="text-xs text-muted-foreground mb-1">Outstanding</p>
            <p className={`font-semibold text-sm ${account.outstanding > 0 ? "text-destructive" : "text-success"}`}>
              {account.outstanding > 0 ? fmtMoney(account.outstanding) : "✓ Cleared"}
            </p>
          </div>
          <div className="p-3 rounded-xl bg-primary/5 border border-primary/20 text-center">
            <p className="text-xs text-muted-foreground mb-1">Credit (Advance)</p>
            <p className="font-semibold text-sm text-primary">{fmtMoney(account.credit)}</p>
          </div>
        </div>

      </div>
      <ClientInvoiceLedger
        blocks={invoiceBlocks}
        client={client}
        openingDebit={openingDebitAmt(client)}
        openingCredit={openingCreditAmt(client)}
        onExport={() => setShowExport(true)}
        onReversePayment={user?.role === "admin" ? reversePayment : undefined}
      />

      {/* Account Statement — same ledger as Stock and Locker: summary, filters,
          then every entry with a running balance. */}


      {/* Order History */}
      <div className="card-luxe overflow-hidden">
        <div className="px-5 py-4 border-b border-border/60 flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h2 className="font-display text-xl text-brand-dark">Order History</h2>
            <p className="text-xs text-muted-foreground mt-0.5">{filtered.length} of {allOrders.length} orders</p>
          </div>
        </div>

        <div className="p-3 sm:p-4">
          <DataTable
            id="client-orders"
            noun="order"
            rows={filtered}
            columns={orderColumns}
            rowKey={o => o.id}
            rowHref={o => `/orders/${o.id}`}
            defaultSort={{ key: "date", dir: "desc" }}
            pageSizes={[10, 25, 50]}
            searchText={o => [o.orderNumber, o.jewelleryType, o.metal, o.diamondType, o.priority, o.status, findInvoiceForOrder(allInvoices, o.id)?.number].filter(Boolean).join(" ")}
            searchPlaceholder="Search orders"
            exportName={`Client-${client.companyName.replace(/\s+/g, "_")}-Orders`}
            toolbarExtra={
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-40 h-8 rounded-lg text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Status</SelectItem>
                  {["Waiting","Approved","In Production","Ready","Dispatched","Delivered","Rejected"].map(s => (
                    <SelectItem key={s} value={s}>{s}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            }
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
            description={<>From {client.companyName}. {account.credit > 0 && <>Includes {fmtMoney(account.credit)} existing credit. </>}Clears the oldest pending bills first; any extra is kept as credit for future orders.</>}
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
                    <div className="flex items-center justify-between gap-3 text-sm">
                      <span className="text-muted-foreground">Applied to order</span>
                      <span className="font-semibold text-primary">{fmtMoney(Number(payAmount))}</span>
                    </div>
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
                <Select value={payMethod} onValueChange={setPayMethod}>
                  <SelectTrigger className="h-10 rounded-xl">
                    <CreditCard className="h-4 w-4 mr-2 shrink-0 text-muted-foreground" /><SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {["Cash", "Bank Transfer", "Venmo", "Zelle", "Cheque", "Card", "Other"].map(m =>
                      <SelectItem key={m} value={m}>{m}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              {/* Remark */}
              <Input
                value={payRemark} onChange={e => setPayRemark(e.target.value)}
                onKeyDown={e => e.key === "Enter" && recordPayment()}
                className="rounded-xl h-10" placeholder="Remark / ref (optional)" />

              {db.lockers.filter(l => l.active !== false).length === 0 && (
                <p className="text-xs text-amber-600">
                  No lockers yet — <Link to="/locker" className="underline font-medium">create one first</Link> before recording a payment.
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
