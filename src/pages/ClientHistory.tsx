import { useState } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { fmtMoney, fmtDate, totalAdvance, balanceDue, orderTotal, orderGrossTotal, updateDb, uid, settleClientAccount, clientAccount, findInvoiceForOrder, hasOpeningBalance, openingDebitAmt, openingCreditAmt } from "@/lib/db";
import { useDb } from "@/hooks/useDb";
import { StatementLedger, type StatementRow } from "@/components/StatementLedger";
import { ClientInvoiceLedger, buildInvoiceBlocks } from "@/components/ClientInvoiceLedger";
import { StatusBadge } from "@/components/StatusBadge";
import { GiftCardAdminPanel } from "@/components/GiftCardAdminPanel";
import { Button } from "@/components/ui/button";
import { AsyncButton } from "@/components/AsyncButton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { usePagination } from "@/hooks/usePagination";
import { PaginationBar } from "@/components/PaginationBar";
import {
  ArrowLeft, Package, Search, Mail, Phone, MapPin, Globe, Undo2,
  FileText, TrendingUp, Clock, CheckCircle2, AlertCircle,
  Download, ExternalLink, Building2, Hash, Wallet, Plus, CreditCard, DollarSign,
} from "lucide-react";
import { motion } from "framer-motion";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth";
import { downloadCsv, downloadLedgerPdf, downloadLedgerPdfMulti } from "@/lib/ledgerExport";
import { ExportDialog, inDateRange } from "@/components/ExportDialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { FileSpreadsheet } from "lucide-react";

export function ClientHistoryPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const db = useDb();

  const client = db.clients.find(c => c.id === id);
  // Employees may only open clients assigned to them — not the whole client base.
  const forbidden = client && user!.role === "employee" && client.accountManagerId !== user!.id;
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
  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");

  const [showExport, setShowExport] = useState(false);

  // ── Client account / payments ──
  const [payAmount, setPayAmount] = useState("");
  const [payMethod, setPayMethod] = useState("Cash");
  const [payRemark, setPayRemark] = useState("");
  const [payLockerId, setPayLockerId] = useState("");
  const [payExchangeRate, setPayExchangeRate] = useState("");
  const [showPayForm, setShowPayForm] = useState(false);
  const account = clientAccount(billableOrders, client?.creditBalance || 0, client);
  const payLocker = db.lockers.find(l => l.id === payLockerId);
  const payLockerCurrency = payLocker?.currency || "INR";
  // A client always pays in USD (that's what the order is billed in) — only
  // an INR locker needs converting for the deposit side.
  const payNeedsRate = !!payLocker && payLockerCurrency !== "USD";
  const payRate = Number(payExchangeRate);

  const recordPayment = () => {
    const amt = parseFloat(payAmount);
    if (!amt || amt <= 0) { toast.error("Enter a valid amount"); return; }
    if (!payLockerId) { toast.error("Choose which locker this was deposited into"); return; }
    if (payNeedsRate && (!payRate || payRate <= 0)) { toast.error("Enter the exchange rate before saving this payment"); return; }
    const depositAmt = payNeedsRate ? Math.round(amt * payRate * 100) / 100 : amt;
    // Note recorded on each payment entry → shows in the Income Passbook.
    const note = payRemark.trim() ? `${payMethod} · ${payRemark.trim()}` : payMethod;
    updateDb(d => {
      const c = d.clients.find(x => x.id === id);
      if (!c) return;
      const clientOrders = d.orders.filter(o => o.clientId === id && o.status !== "Rejected");
      const now = new Date().toISOString();
      // Reclaim any over-payment, fold in existing credit + this amount, then
      // re-allocate oldest-bill-first — tagging entries with the payment method.
      settleClientAccount(d, id!, amt, user!.id, now, note);
      // Cash-position tracking — separate from the USD billing allocation above:
      // this is ONE deposit event, so it's recorded once here rather than split
      // across whichever orders the FIFO allocation above happened to touch.
      if (payLockerId) {
        const locker = d.lockers.find(l => l.id === payLockerId);
        if (locker) {
          if (!d.lockerTransactions) d.lockerTransactions = [];
          d.lockerTransactions.push({
            id: uid("ltx_"), lockerId: payLockerId, type: "income", amountInr: depositAmt,
            currency: locker.currency || "INR", category: `Client Payment — ${c.companyName}`,
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
    toast.success(`Payment recorded (${payMethod}) & allocated to oldest bills`);
    setPayAmount(""); setPayRemark(""); setPayLockerId(""); setPayExchangeRate(""); setShowPayForm(false);
  };

  const applyCredit = () => {
    updateDb(d => {
      const c = d.clients.find(x => x.id === id);
      if (!c) return;
      const clientOrders = d.orders.filter(o => o.clientId === id && o.status !== "Rejected");
      // Reclaim any per-order over-payment + stored credit, re-allocate oldest first.
      settleClientAccount(d, id!, 0, user!.id, new Date().toISOString());
    });
    toast.success("Credit applied to oldest outstanding bills");
  };

  // Reverse a wrongly-entered payment (admin). A payment is ONE deposit event:
  // its allocations across orders all carry the exact same timestamp, and it
  // wrote one matching locker income line. We only allow a clean reversal — when
  // the client isn't carrying credit — so we never have to guess how much of an
  // opaque credit balance came from this particular payment. If credit is being
  // held, we refuse and point the admin at Apply Credit / manual adjustment.
  const reversePayment = (paymentCreatedAt: string) => {
    if (user?.role !== "admin") { toast.error("Only an admin can reverse a payment."); return; }
    if ((client?.creditBalance || 0) > 0) {
      toast.error("This client is carrying credit on account, so a payment can't be cleanly reversed here. Clear the credit first, or adjust manually.");
      return;
    }
    const affected = billableOrders.flatMap(o => (o.advances || []).filter(a => a.createdAt === paymentCreatedAt));
    const total = affected.reduce((s, a) => s + a.amount, 0);
    if (affected.length === 0) { toast.error("Couldn't find this payment's allocations."); return; }
    if (!confirm(`Reverse this payment of ${fmtMoney(total)}? It will be removed from the ${affected.length} bill(s) it was applied to and from the locker. This can't be undone.`)) return;
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

  // Full account statement — every order billed and every payment received,
  // chronological, with a running balance — the "professional ledger" view,
  // separate from the Order History table below (which is order-by-order).
  const statement = (() => {
    const rows: StatementRow[] = [];
    // Opening balance carried in from a previous system — always the first line.
    if (hasOpeningBalance(client)) {
      rows.push({ id: "opening", date: client.openingDate || client.createdAt, particulars: "Opening Balance (brought forward)", debit: openingDebitAmt(client), credit: openingCreditAmt(client), balance: 0, kind: "Opening", pinned: true });
    }
    for (const o of billableOrders) {
      // Bill the GROSS value, then show any gift-card redemption as its own
      // discount line — so the ledger explains why the balance is lower.
      rows.push({ id: o.id, date: o.createdAt, particulars: `${o.jewelleryType}${o.designNumber ? ` · #${o.designNumber}` : ""}`, ref: o.orderNumber, debit: orderGrossTotal(o), credit: 0, balance: 0, kind: "Order billed" });
      if (o.giftCardRedeemed && o.giftCardRedeemed > 0) {
        rows.push({ id: o.id + "-gift", date: o.createdAt, particulars: "Gift card redeemed", ref: o.orderNumber, debit: 0, credit: o.giftCardRedeemed, balance: 0, kind: "Gift card" });
      }
      for (const adv of o.advances || []) {
        rows.push({ id: adv.id, date: adv.createdAt, particulars: adv.note || "Payment received", ref: o.orderNumber, debit: 0, credit: adv.amount, balance: 0, kind: "Payment" });
      }
    }
    let running = 0;
    const withBalance = [...rows]
      // Opening balance is pinned first regardless of its as-of date.
      .sort((a, b) => (a.id === "opening" ? -1 : b.id === "opening" ? 1 : +new Date(a.date) - +new Date(b.date)))
      .map(r => { running += r.debit - r.credit; return { ...r, balance: running }; });
    return withBalance.reverse();
  })();

  // A statement is READ oldest-first: every balance is the balance AFTER that
  // row, so printing newest-first ran the running total backwards and pushed
  // the opening line to the bottom. The screen shows newest first; downloads
  // must not.
  const statementAsc = [...statement].reverse();

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
  const exportInvoiceStatementPdf = (from: Date | null, to: Date | null) => {
    const blocks = invoiceBlocks.filter(b => b.unbilled || inDateRange(b.date, from, to));
    const oD = openingDebitAmt(client), oC = openingCreditAmt(client);
    const T = blocks.reduce((t, b) => ({
      gross: t.gross + b.gross, gift: t.gift + b.gift,
      received: t.received + b.received, balance: t.balance + b.balance,
    }), { gross: 0, gift: 0, received: 0, balance: 0 });
    const closing = oD - oC + T.balance;

    // One table per invoice: its pieces, then the payments received against it.
    const sections = blocks.map(b => ({
      heading: b.unbilled
        ? `Not yet invoiced — ${b.items.length} piece${b.items.length !== 1 ? "s" : ""}`
        : `Invoice ${b.number} · ${fmtDate(b.date)} · ${fmtMoney(b.gross)}${b.balance > 0.009 ? ` · ${fmtMoney(b.balance)} outstanding` : " · settled"}`,
      columns: [
        { header: "Order", x: 14 },
        { header: "Description", x: 46 },
        { header: "Qty", x: 150 },
        { header: "Billed", x: 176 },
        { header: "Gift card", x: 206 },
        { header: "Received", x: 236 },
        { header: "Balance", x: 262 },
      ],
      align: ["left", "left", "right", "right", "right", "right", "right"] as ("left" | "right")[],
      rows: [
        ...b.items.map(i => [
          i.orderNo, fit(i.description || "—", 100), String(i.qty),
          fmtMoney(i.gross), i.gift ? `-${fmtMoney(i.gift)}` : "",
          i.received ? fmtMoney(i.received) : "",
          i.balance > 0.009 ? fmtMoney(i.balance) : "Cleared",
        ]),
        ...b.payments.map(p => [
          fmtDate(p.date), fit(p.note, 100), "", "", "", fmtMoney(p.amount), "",
        ]),
      ],
      totalsRow: ["", "Invoice total", "", fmtMoney(b.gross), b.gift ? `-${fmtMoney(b.gift)}` : "",
        fmtMoney(b.received), b.balance > 0.009 ? fmtMoney(b.balance) : "Cleared"],
    }));

    downloadLedgerPdfMulti({
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
        { label: "Received", value: fmtMoney(T.received) },
        { label: "Outstanding", value: fmtMoney(Math.max(0, closing)) },
        { label: "Invoices", value: String(blocks.filter(b => !b.unbilled).length) },
      ],
      landscape: true,
      sections,
      filename: `Client-Statement-${client.companyName.replace(/\s+/g, "_")}`,
    });
  };


  const exportStatementCsv = (from: Date | null, to: Date | null) => {
    downloadCsv(
      `Client-Statement-${client.companyName.replace(/\s+/g, "_")}`,
      ["Date", "Order / Ref", "Particulars", "Type", "Billed (USD)", "Received (USD)", "Balance (USD)"],
      statementAsc.filter(r => inDateRange(r.date, from, to)).map(r => [
        r.id === "opening" ? "Opening" : fmtDate(r.date),
        r.ref ?? "", r.particulars, r.kind ?? "",
        r.debit || "", r.credit || "", r.balance,
      ]),
    );
  };

  const exportStatementPdf = (from: Date | null, to: Date | null) => {
    downloadLedgerPdf({
      title: "Client Account Statement",
      subjectLines: [
        `Client: ${client.companyName}`,
        `Owner: ${client.ownerName}`,
        `Report Generated: ${new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}`,
      ],
      summary: [
        // Same basis as the columns below: gross billed, the gift card as its own
        // line, then what was received. A summary on a different basis to the
        // table it heads is a reconciliation problem waiting to happen.
        { label: "Total Billed (gross)", value: fmtMoney(grossBilled) },
        ...(giftUsed > 0 ? [{ label: "Gift Card Used", value: fmtMoney(giftUsed) }] : []),
        { label: "Received", value: fmtMoney(paidAmount) },
        { label: "Outstanding", value: fmtMoney(account.outstanding) },
        { label: "Credit (Advance)", value: fmtMoney(account.credit) },
      ],
      landscape: true,
      columns: [
        { header: "Date", x: 14 },
        { header: "Order / Ref", x: 42 },
        { header: "Particulars", x: 88 },
        { header: "Type", x: 170 },
        { header: "Billed", x: 206 },
        { header: "Received", x: 236 },
        { header: "Balance", x: 264 },
      ],
      align: ["left", "left", "left", "left", "right", "right", "right"],
      rows: statementAsc.filter(r => inDateRange(r.date, from, to)).map(r => [
        r.id === "opening" ? "Opening" : fmtDate(r.date),
        fit(r.ref ?? "", 44),
        fit(r.particulars, 80),
        fit(r.kind ?? "", 34),
        r.debit ? fmtMoney(r.debit) : "",
        r.credit ? fmtMoney(r.credit) : "",
        fmtMoney(r.balance),
      ]),
      // Proves itself: billed less received is the balance the last row closes on.
      totalsRow: ["", "", "", "Totals",
        fmtMoney(grossBilled), fmtMoney(giftUsed + paidAmount), fmtMoney(account.outstanding)],
      filename: `Client-Statement-${client.companyName.replace(/\s+/g, "_")}`,
    });
  };

  const filtered = allOrders.filter(o => {
    const matchQ = !q || o.orderNumber.toLowerCase().includes(q.toLowerCase()) || o.jewelleryType.toLowerCase().includes(q.toLowerCase());
    const matchS = statusFilter === "all" || o.status === statusFilter;
    return matchQ && matchS;
  });

  const PAGE_SIZE = 10;
  const { paged, page, setPage, totalPages, start, end } = usePagination(filtered, PAGE_SIZE);

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
          <Button onClick={downloadClientReport} variant="outline" className="rounded-xl gap-2 w-full sm:w-auto shrink-0">
            <Download className="h-4 w-4" /> Export Report
          </Button>
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
          <div className="flex items-center gap-2 flex-wrap">
            <Button variant="outline" onClick={() => setShowExport(true)} className="rounded-xl gap-2"><Download className="h-4 w-4" /> Export</Button>
            <ExportDialog open={showExport} onClose={() => setShowExport(false)} title={`${client.companyName} statement`} options={[
              { label: "Invoice Statement — PDF", sublabel: "Invoice by invoice, with the pieces on each one", kind: "pdf", run: exportInvoiceStatementPdf },
              { label: "Account Statement — PDF", sublabel: "Bills & payments (USD)", kind: "pdf", run: exportStatementPdf },
              { label: "Account Statement — Excel", sublabel: "Bills & payments (USD)", kind: "excel", run: exportStatementCsv },
            ]} />
            {account.credit > 0 && account.outstanding > 0 && (
              <Button variant="outline" onClick={applyCredit} className="rounded-xl gap-2">
                <CreditCard className="h-4 w-4" /> Apply Credit
              </Button>
            )}
            <Button onClick={() => setShowPayForm(v => !v)} className="btn-hero rounded-xl gap-2">
              <Plus className="h-4 w-4" /> Record Payment
            </Button>
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

        {showPayForm && (() => {
          const payDepositPreview = payAmount && payNeedsRate && payRate > 0 ? Number(payAmount) * payRate : payAmount ? Number(payAmount) : null;
          return (
          <div className="pt-2 border-t border-border/60 space-y-2.5">
            <p className="text-sm font-medium text-brand-dark">Record Client Payment</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {/* Amount */}
              <div className="relative">
                <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  type="number" min="1" step="0.01" autoFocus
                  value={payAmount} onChange={e => setPayAmount(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && recordPayment()}
                  className="pl-9 rounded-xl h-10" placeholder="Amount received ($)" />
              </div>
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
            <Select value={payLockerId} onValueChange={setPayLockerId}>
              <SelectTrigger className="h-10 rounded-xl"><SelectValue placeholder="Deposited to locker *" /></SelectTrigger>
              <SelectContent>
                {db.lockers.filter(l => l.active !== false).map(l => <SelectItem key={l.id} value={l.id}>{l.name} ({l.currency || "INR"})</SelectItem>)}
              </SelectContent>
            </Select>

            {payNeedsRate && (
              <div className="p-3 rounded-xl bg-secondary space-y-2">
                <Label className="text-xs">Exchange Rate — 1 USD = ₹ <span className="text-destructive">*</span></Label>
                <Input type="number" min={0} step="0.01" value={payExchangeRate} onChange={e => setPayExchangeRate(e.target.value)} className="rounded-xl h-10 bg-white" placeholder="e.g. 83.50" />
                <p className="text-xs text-muted-foreground">This locker holds INR, not USD — enter today's rate to convert what lands in it.</p>
              </div>
            )}

            {payAmount && payLockerId && (
              <div className="p-4 rounded-xl border border-border/60 bg-secondary/30 space-y-1.5">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Summary</p>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Received</span>
                  <span className="font-medium text-foreground">{fmtMoney(Number(payAmount))}</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Applied to order</span>
                  <span className="font-semibold text-primary">{fmtMoney(Number(payAmount))}</span>
                </div>
                {payDepositPreview != null && payLocker && (
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">Deposited to {payLocker.name}</span>
                    <span className="font-semibold text-foreground">{payLockerCurrency === "USD" ? "$" : "₹"}{payDepositPreview.toFixed(2)}</span>
                  </div>
                )}
              </div>
            )}

            <div className="flex gap-2.5">
              <AsyncButton onClick={recordPayment} className="btn-hero rounded-xl h-10">Save &amp; Allocate</AsyncButton>
              <Button variant="outline" onClick={() => { setShowPayForm(false); setPayAmount(""); setPayRemark(""); }} className="rounded-xl h-10">Cancel</Button>
            </div>
            <p className="text-xs text-muted-foreground">
              {account.credit > 0 && <>Includes {fmtMoney(account.credit)} existing credit. </>}
              Clears the oldest pending bills first; any extra is kept as credit for future orders.
            </p>
          </div>
          );
        })()}
      </div>
      <ClientInvoiceLedger
        blocks={invoiceBlocks}
        client={client}
        openingDebit={openingDebitAmt(client)}
        openingCredit={openingCreditAmt(client)}
        onExport={() => setShowExport(true)}
      />

      {/* Account Statement — same ledger as Stock and Locker: summary, filters,
          then every entry with a running balance. */}
      <StatementLedger
        title="Account Statement"
        caption={`${statement.length} entr${statement.length !== 1 ? "ies" : "y"} · orders billed and payments received, running balance in USD`}
        rows={statement}
        fmt={fmtMoney}
        debitLabel="Billed"
        creditLabel="Received"
        onExport={() => setShowExport(true)}
        summary={[
          // These have to add up to the columns underneath: the Billed column
          // carries the GROSS value and a gift card shows as its own credit line,
          // so a card reading the net would never reconcile with the table.
          { label: "Total billed", value: fmtMoney(grossBilled), tone: "out" },
          ...(giftUsed > 0 ? [{ label: "Gift card used", value: fmtMoney(giftUsed), tone: "in" as const }] : []),
          { label: "Received", value: fmtMoney(paidAmount), tone: "in" },
          // account.outstanding carries the opening balance; pendingAmount does
          // not, so the card used to disagree with the closing balance of the
          // statement right underneath it whenever a client had an opening.
          { label: "Outstanding", value: fmtMoney(account.outstanding), tone: account.outstanding > 0 ? "due" : "in" },
          { label: "Orders", value: String(billableOrders.length) },
        ]}
        rowAction={r => (r.credit > 0 && !r.pinned && user?.role === "admin" ? (
          <button onClick={() => reversePayment(r.date)} title="Reverse this payment"
            className="shrink-0 text-muted-foreground hover:text-destructive p-1">
            <Undo2 className="h-4 w-4" />
          </button>
        ) : null)}
      />


      {/* Order History */}
      <div className="card-luxe overflow-hidden">
        <div className="px-5 py-4 border-b border-border/60 flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h2 className="font-display text-xl text-brand-dark">Order History</h2>
            <p className="text-xs text-muted-foreground mt-0.5">{filtered.length} of {allOrders.length} orders</p>
            {filtered.length > 0 && <p className="text-xs text-muted-foreground">Showing {start + 1}–{end}</p>}
          </div>
          <div className="flex gap-2 flex-wrap">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input value={q} onChange={e => setQ(e.target.value)} placeholder="Search…" className="pl-8 h-9 w-44 rounded-xl text-sm" />
            </div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-40 h-9 rounded-xl text-sm"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                {["Waiting","Approved","In Production","Ready","Dispatched","Delivered","Rejected"].map(s => (
                  <SelectItem key={s} value={s}>{s}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Desktop table */}
        <div className="hidden md:block overflow-x-auto">
          <table className="table-luxe w-full text-sm">
            <thead>
              <tr className="border-b border-border/60 bg-secondary/30">
                <th className="text-left px-5 py-3 text-xs font-semibold text-muted-foreground">Order #</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground">Item</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground">Metal</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground">Diamond</th>
                <th className="text-center px-4 py-3 text-xs font-semibold text-muted-foreground">Qty</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground">Priority</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground">Status</th>
                <th className="text-center px-4 py-3 text-xs font-semibold text-muted-foreground">Bill</th>
                <th className="text-center px-4 py-3 text-xs font-semibold text-muted-foreground">Advance</th>
                <th className="text-center px-4 py-3 text-xs font-semibold text-muted-foreground">Balance</th>
                <th className="text-center px-4 py-3 text-xs font-semibold text-muted-foreground">Invoice</th>
                <th className="text-center px-4 py-3 text-xs font-semibold text-muted-foreground">Date</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {paged.map((o, i) => {
                const invoice = findInvoiceForOrder(allInvoices, o.id);
                const progress = Math.round(o.timeline.filter(t => t.status === "done").length / o.timeline.length * 100);
                const adv = totalAdvance(o);
                const bal = balanceDue(o);
                return (
                  <motion.tr key={o.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: i * 0.02 }}
                    className="border-b border-border/40 hover:bg-secondary/20 transition-colors group">
                    <td className="px-5 py-3.5">
                      <p className="font-mono text-xs font-semibold text-brand-dark">{o.orderNumber}</p>
                      <div className="mt-1.5 h-1 w-20 rounded-full bg-secondary overflow-hidden">
                        <div className="h-full bg-gradient-to-r from-primary to-brand-light" style={{ width: `${progress}%` }} />
                      </div>
                      <p className="text-[10px] text-muted-foreground mt-0.5">{progress}%</p>
                    </td>
                    <td className="px-4 py-3.5 font-medium">{o.jewelleryType}</td>
                    <td className="px-4 py-3.5 text-muted-foreground">{o.metal}</td>
                    <td className="px-4 py-3.5 text-muted-foreground">{o.diamondType}</td>
                    <td className="px-4 py-3.5 text-center">{o.quantity}</td>
                    <td className="px-4 py-3.5">
                      <span className={`text-xs font-medium ${o.priority === "Urgent" ? "text-red-500" : o.priority === "High Priority" ? "text-orange-500" : "text-muted-foreground"}`}>
                        {o.priority}
                      </span>
                    </td>
                    <td className="px-4 py-3.5"><StatusBadge status={o.status} /></td>
                    <td className="px-4 py-3.5 text-center font-semibold">{fmtMoney(orderTotal(o))}</td>
                    <td className="px-4 py-3.5 text-center">
                      {adv > 0
                        ? <span className="text-success font-medium text-xs">{fmtMoney(adv)}</span>
                        : <span className="text-muted-foreground text-xs">—</span>}
                    </td>
                    <td className="px-4 py-3.5 text-center">
                      <span className={`text-xs font-semibold ${bal === 0 ? "text-success" : "text-destructive"}`}>
                        {bal === 0 ? "✓ Cleared" : fmtMoney(bal)}
                      </span>
                    </td>
                    <td className="px-4 py-3.5 text-center">
                      {invoice ? (
                        <span className={`text-xs font-medium px-2 py-0.5 rounded-full border ${invoice.paid ? "bg-success/10 text-success border-success/30" : "bg-destructive/10 text-destructive border-destructive/30"}`}>
                          {invoice.paid ? "Paid" : "Unpaid"}
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3.5 text-center text-xs text-muted-foreground whitespace-nowrap">{fmtDate(o.createdAt)}</td>
                    <td className="px-4 py-3.5">
                      <Link to={`/orders/${o.id}`}>
                        <Button size="sm" variant="ghost" className="h-7 w-7 p-0 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity">
                          <ExternalLink className="h-3.5 w-3.5" />
                        </Button>
                      </Link>
                    </td>
                  </motion.tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Mobile cards */}
        <div className="md:hidden divide-y divide-border/40">
          {paged.map(o => {
            const invoice = findInvoiceForOrder(allInvoices, o.id);
            const progress = Math.round(o.timeline.filter(t => t.status === "done").length / o.timeline.length * 100);
            const adv = totalAdvance(o);
            const bal = balanceDue(o);
            return (
              <Link key={o.id} to={`/orders/${o.id}`} className="flex items-start gap-3 p-4 hover:bg-secondary/20 transition-colors">
                <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-primary/15 to-brand-light/15 grid place-items-center shrink-0">
                  <Package className="h-5 w-5 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2">
                    <p className="font-semibold text-sm">{o.orderNumber}</p>
                    <StatusBadge status={o.status} />
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">{o.jewelleryType} · {o.metal} · {o.diamondType} · {o.quantity} pcs</p>
                  <div className="mt-2 h-1 rounded-full bg-secondary overflow-hidden">
                    <div className="h-full bg-gradient-to-r from-primary to-brand-light" style={{ width: `${progress}%` }} />
                  </div>
                  <div className="flex items-center justify-between mt-1.5 text-xs text-muted-foreground">
                    <span>{progress}% · {fmtDate(o.createdAt)}</span>
                    <div className="flex items-center gap-2">
                      {adv > 0 && <span className="text-success font-medium">Adv {fmtMoney(adv)}</span>}
                      {bal > 0
                        ? <span className="text-destructive font-semibold">Bal {fmtMoney(bal)}</span>
                        : adv > 0 ? <span className="text-success font-semibold">✓ Cleared</span> : null}
                      {invoice && (
                        <span className={`font-medium ${invoice.paid ? "text-success" : "text-destructive"}`}>
                          {invoice.paid ? "Paid" : "Unpaid"}
                        </span>
                      )}
                      <span className="font-semibold text-foreground">{fmtMoney(orderTotal(o))}</span>
                    </div>
                  </div>
                </div>
              </Link>
            );
          })}
        </div>

        {filtered.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
            <Package className="h-12 w-12 mb-3 opacity-20" />
            <p className="font-medium">{allOrders.length === 0 ? "No orders yet" : "No orders match filters"}</p>
          </div>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="px-5 border-t border-border/60">
            <PaginationBar
              page={page}
              totalPages={totalPages}
              onPageChange={setPage}
              label={`Showing ${start + 1}–${end} of ${filtered.length} orders`}
            />
          </div>
        )}

        {/* Table footer with totals */}
        {filtered.length > 0 && (
          <div className="px-5 py-3 bg-secondary/30 border-t border-border/60 flex items-center justify-between text-sm flex-wrap gap-3">
            <span className="text-muted-foreground">{filtered.length} order{filtered.length !== 1 ? "s" : ""}</span>
            <div className="flex items-center gap-3 flex-wrap">
              <span className="text-muted-foreground">Total <span className="font-semibold text-foreground">{fmtMoney(filtered.reduce((s, o) => s + orderTotal(o), 0))}</span></span>
              {filtered.some(o => (o.advances||[]).length > 0) && (
                <>
                  <span className="text-muted-foreground">Advance <span className="font-semibold text-success">{fmtMoney(filtered.reduce((s, o) => s + totalAdvance(o), 0))}</span></span>
                  <span className="text-muted-foreground">Balance <span className={`font-semibold ${filtered.reduce((s,o)=>s+balanceDue(o),0)>0?"text-destructive":"text-success"}`}>{fmtMoney(filtered.reduce((s, o) => s + balanceDue(o), 0))}</span></span>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
