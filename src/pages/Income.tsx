import { useState, useMemo } from "react";
import { DataTable, CellTag, CellAmount, CellDate, type DataColumn } from "@/components/DataTable";
import { useAuth } from "@/lib/auth";
import { fmtMoney, fmtDate, orderTotal } from "@/lib/db";
import { useDb } from "@/hooks/useDb";
import { Link, useNavigate } from "react-router-dom";
import {
  CreditCard, Receipt, Trash2, Pencil, FileText, FileSpreadsheet, Eye,
} from "lucide-react";
import { downloadCsv, downloadLedgerPdf, fmtInrPlain } from "@/lib/ledgerExport";
import { ccy, ccyOrder, fmtCcy, fmtCcyPdf, type CurrencyCode } from "@/lib/currency";
import type { MoreAction } from "@/components/MoreMenu";
import { PageHeader, TabBar } from "@/components/PageHeader";
import { StatStrip, type TableFilter } from "@/components/TableToolbar";
import { ReceiptEditSheet, cancelReceiptFlow, loadReceipts, paymentLockReason } from "@/components/ReceiptEditSheet";
import { needsAccess } from "@/lib/actionHints";
import { useCan } from "@/hooks/useCan";
import { filled, linkList, lockerLabel, lockerTxnDetails, noteText, recorded, refLink, refNo, userName, when, type Detail } from "@/components/rowDetails";
import { oneLine } from "@/components/MoneyEntryEditor";

/* ─── Types ─────────────────────────────────────────────────── */
type PassbookRowType =
  "Advance" | "Payment" | "Final Payment" | "Expense" | "Supplier Payment" | "Factory Charges" | "Locker Income" | "Locker Expense" | "Transfer";

type PassbookRow = {
  id: string;
  date: string; // ISO string
  currency: CurrencyCode; // any — a locker can hold AUD, EUR…
  direction: "in" | "out";
  type: PassbookRowType;
  clientId?: string;
  party: string; // client / locker / "Staff Expense"
  description: string;
  link?: { label: string; to: string };
  amount: number;
  /** A client payment (Advance/Payment/Final Payment rows): the order it is on,
   *  and the receipt it came in on — what it is corrected or cancelled through. */
  editable?: { orderId: string; receiptId?: string; fromCredit?: boolean };
};

/* ─── Helpers ────────────────────────────────────────────────── */
function toDateStr(iso: string) {
  return iso.slice(0, 10); // "YYYY-MM-DD"
}

const TYPE_TONE: Record<PassbookRowType, "neutral" | "green" | "red" | "amber" | "blue" | "violet"> = {
  "Advance": "blue",
  "Payment": "blue",
  "Final Payment": "green",
  "Expense": "red",
  "Supplier Payment": "amber",
  "Factory Charges": "violet",
  "Locker Income": "green",
  "Locker Expense": "red",
  "Transfer": "neutral",
};

/* ─── Page ───────────────────────────────────────────────────── */
export function IncomePage() {
  const { user } = useAuth();
  const db = useDb();
  const navigate = useNavigate();
  const isClient = user!.role === "client";
  const can = useCan();

  /* Filters */
  const [curTab, setCurTab] = useState<CurrencyCode>("USD");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo]     = useState("");
  const [clientFilter, setClientFilter] = useState("all");

  /* Correcting a client payment. It is corrected or cancelled through its
     RECEIPT (src/lib/receipts.ts), never by changing the advance on its own:
     the receipt also holds the locker deposit and any credit it left, and an
     advance edited here used to leave both behind. Supplier, factory, account
     and expense entries are corrected on their own pages — their rows say where. */
  const [editReceiptId, setEditReceiptId] = useState<string | null>(null);
  const mayPayEdit = !isClient && can("payments", "edit");
  const mayPayDelete = !isClient && can("payments", "delete");
  // Why a client payment row can't be corrected here; undefined when it can.
  const payLock = (r: PassbookRow) => (r.editable ? paymentLockReason(db, r.editable) : "Not a client payment");
  const openEdit = async (row: PassbookRow) => {
    if (!mayPayEdit || !row.editable?.receiptId || payLock(row)) return;
    // Receipts load on demand — this page doesn't list them.
    await loadReceipts();
    setEditReceiptId(row.editable.receiptId);
  };

  /** Where a row that isn't a client payment is corrected, by what it is. */
  const correctedIn = (r: PassbookRow): string =>
    r.type === "Expense" ? "Expenses"
    : r.type === "Supplier Payment" ? "Payments → Supplier payments"
    : r.type === "Factory Charges" ? "Payments → Factory payments"
    : "Payments → Account entries";

  /* Build the unified passbook — every payment in or out, anywhere in the
     app, so a real cash-basis view (and exact profit) is possible. */
  const allRows = useMemo<PassbookRow[]>(() => {
    const rows: PassbookRow[] = [];

    const orders = isClient ? db.orders.filter(o => o.clientId === user!.clientId) : db.orders;

    orders.forEach(order => {
      const client = db.clients.find(c => c.id === order.clientId);
      const clientName = client?.companyName ?? "Unknown Client";
      const total = orderTotal(order);
      const sorted = [...(order.advances ?? [])].sort((a, b) => +new Date(a.createdAt) - +new Date(b.createdAt));
      let cumulative = 0;
      sorted.forEach((adv, i) => {
        cumulative += adv.amount;
        const isFinal = cumulative >= total - 0.01;
        const type: PassbookRowType = isFinal ? "Final Payment" : i === 0 ? "Advance" : "Payment";
        rows.push({
          id: adv.id, date: adv.createdAt, currency: "USD", direction: "in", type,
          clientId: order.clientId, party: clientName,
          description: adv.note || "Payment received",
          link: { label: order.orderNumber, to: `/orders/${order.id}` },
          amount: adv.amount,
          editable: { orderId: order.id, receiptId: adv.receiptId, fromCredit: adv.fromCredit },
        });
      });
    });

    // Expenses and Locker transactions are internal business data — never
    // shown to a client viewing their own order/payment history.
    if (!isClient) {
      db.expenses.forEach(exp => {
        rows.push({
          id: exp.id, date: exp.createdAt, currency: ccy(exp.currency), direction: "out", type: "Expense",
          party: "Staff Expense", description: exp.title + (exp.note ? ` — ${exp.note}` : ""),
          link: { label: "Expenses", to: "/expenses" },
          amount: exp.amount,
        });
      });

      // Skip refType "clientPayment"/"expense" — those are just the Locker
      // mirror of the rows already added above; counting both would double them.
      (db.lockerTransactions ?? [])
        .filter(t => t.refType !== "clientPayment" && t.refType !== "expense")
        .forEach(t => {
          const locker = db.lockers.find(l => l.id === t.lockerId);
          const currency = ccy(t.currency);
          const direction: "in" | "out" = (t.type === "income" || t.type === "transfer_in") ? "in" : "out";
          const type: PassbookRowType =
            t.refType === "purchase" ? "Supplier Payment"
            : t.refType === "materialIssuance" ? "Factory Charges"
            : (t.type === "transfer_in" || t.type === "transfer_out") ? "Transfer"
            : direction === "in" ? "Locker Income" : "Locker Expense";
          rows.push({
            id: t.id, date: t.createdAt, currency, direction, type,
            party: locker?.name || "Locker", description: t.category || t.note || type,
            link: { label: "Locker", to: "/locker" },
            amount: t.amountInr,
          });
        });
    }

    return rows.sort((a, b) => +new Date(b.date) - +new Date(a.date));
  }, [db, user, isClient]);

  /* One tab per currency: client billing in dollars and the rupee books
     always, then one for each other currency an account holds (AUD, EUR…) —
     so no row falls between the tabs, and none is ever added to another
     currency's total. */
  const tabs = useMemo<CurrencyCode[]>(() => {
    const others = [...new Set(allRows.map(r => r.currency))].filter(c => c !== "USD" && c !== "INR").sort(ccyOrder);
    return ["USD", "INR", ...others];
  }, [allRows]);
  // A tab whose last row has gone falls back to client billing.
  const tab = tabs.includes(curTab) ? curTab : "USD";
  const tabLabel = (c: CurrencyCode) =>
    c === "USD" ? "Client Billing (USD)" : c === "INR" ? "Sourcing & Costs (INR)" : `${c} account`;

  const tabRows = useMemo(() => allRows.filter(r => r.currency === tab), [allRows, tab]);

  /* Apply filters */
  const filtered = useMemo(() => {
    return tabRows.filter(r => {
      const d = toDateStr(r.date);
      if (dateFrom && d < dateFrom) return false;
      if (dateTo   && d > dateTo)   return false;
      if (clientFilter !== "all" && r.clientId !== clientFilter) return false;
      return true;
    });
  }, [tabRows, dateFrom, dateTo, clientFilter]);

  // In the tab's own currency: $1,234.56 · ₹1,23,456 · A$980.
  const fmt = (n: number) => fmtCcy(n, tab);

  /* Summary totals */
  const totalIn = filtered.filter(r => r.direction === "in").reduce((s, r) => s + r.amount, 0);
  const totalOut = filtered.filter(r => r.direction === "out").reduce((s, r) => s + r.amount, 0);
  const net = totalIn - totalOut;
  const nIn = filtered.filter(r => r.direction === "in").length, nOut = filtered.length - nIn;

  /* Clients list for filter dropdown */
  const clients = isClient
    ? []
    : db.clients.slice().sort((a, b) => a.companyName.localeCompare(b.companyName));

  const hasActiveFilter = dateFrom || dateTo || clientFilter !== "all";
  const clearFilters = () => { setDateFrom(""); setDateTo(""); setClientFilter("all"); };

  // The dates, and (for staff) the client — behind the table's one Filters button.
  const filters: TableFilter[] = [
    { kind: "date", from: dateFrom, to: dateTo, onChange: (f, t) => { setDateFrom(f); setDateTo(t); } },
  ];
  if (!isClient) filters.push({
    kind: "select", label: "Client", allLabel: "All Clients", value: clientFilter === "all" ? "" : clientFilter,
    onChange: v => setClientFilter(v || "all"),
    options: clients.map(c => ({ value: c.id, label: c.companyName })),
  });

  /* The table — every filtered row, paged by the table itself; totals count them all. */
  const signed = (r: PassbookRow) => (r.direction === "in" ? r.amount : -r.amount);
  const columns: DataColumn<PassbookRow>[] = [
    { key: "date", header: "Date", always: true, kind: "date", sortValue: r => r.date,
      cell: r => <CellDate>{fmtDate(r.date)}</CellDate> },
    { key: "party", header: "Party", sortValue: r => r.party,
      cell: r => <span className="font-medium max-w-[160px] truncate block">{r.party}</span> },
    { key: "reference", header: "Reference", sortValue: r => r.link?.label ?? "",
      cell: r => (r.link ? <Link to={r.link.to} className="text-primary hover:underline font-mono text-xs font-semibold whitespace-nowrap">{r.link.label}</Link> : null) },
    { key: "type", header: "Type", sortValue: r => r.type,
      cell: r => (
        <CellTag tone={TYPE_TONE[r.type]}>
          <span className="inline-flex items-center gap-1">{r.direction === "in" ? <CreditCard className="h-3 w-3" /> : <Receipt className="h-3 w-3" />}{r.type}</span>
        </CellTag>
      ) },
    { key: "description", header: "Description", sortValue: r => r.description,
      cell: r => <span title={r.description} className="text-muted-foreground text-xs max-w-[200px] truncate block">{r.description}</span> },
    // Signed, so "high to low" puts the biggest money in first and the biggest out last.
    { key: "amount", header: "Amount", align: "right", kind: "number", sortValue: signed,
      cell: r => <CellAmount tone={r.direction}>{r.direction === "in" ? "+" : "−"}{fmt(r.amount)}</CellAmount> },
  ];

  // An opened row, read from the record behind it. A client sees only when
  // their payment was taken and whether it came from their credit — who took
  // it, the receipt and the account it went into are the business's own books.
  const rowDetails = (r: PassbookRow): Detail[] => {
    if (r.editable) {
      const adv = db.orders.find(o => o.id === r.editable!.orderId)?.advances?.find(a => a.id === r.id);
      if (!adv) return [];
      if (isClient) return filled([
        { label: "Recorded", value: when(adv.createdAt) },
        adv.fromCredit && { label: "Paid from", value: "Credit already on your account" },
      ]);
      const rcpt = adv.receiptId ? (db.clientReceipts ?? []).find(x => x.id === adv.receiptId) : undefined;
      const lockerCcy = ccy(db.lockers.find(l => l.id === adv.lockerId)?.currency);
      return filled([
        !!r.clientId && can("clients") && { label: "Client page", value: refLink(`/clients/${r.clientId}`, r.party) },
        { label: "Receipt", value: refNo(rcpt?.receiptNo) },
        !!rcpt && { label: "Method", value: rcpt.method },
        adv.fromCredit && { label: "Paid from", value: "Credit already on account" },
        { label: "Deposited to", value: lockerLabel(db, adv.lockerId) },
        !!adv.lockerId && adv.lockerAmount != null && lockerCcy !== "USD" && { label: "Landed as", value: fmtCcy(adv.lockerAmount, lockerCcy) },
        { label: "Recorded", value: recorded(db, adv.createdAt, adv.recordedBy) },
      ]);
    }
    if (isClient) return [];
    if (r.type === "Expense") {
      const e = db.expenses.find(x => x.id === r.id);
      if (!e) return [];
      const client = e.clientId ? db.clients.find(c => c.id === e.clientId) : undefined;
      return filled([
        { label: "Category", value: e.category },
        { label: "Note", value: noteText(e.note) },
        { label: "Paid from", value: lockerLabel(db, e.lockerId) },
        { label: "Paid to", value: userName(db, e.paidToEmployeeId) },
        !!client && { label: "Client", value: refLink(`/clients/${client.id}`, client.companyName, can("clients")) },
        !!e.orderIds?.length && { label: e.orderIds.length > 1 ? "For orders" : "For order", value: linkList(e.orderIds.map(id => ({
          key: id, node: refLink(`/orders/${id}`, db.orders.find(o => o.id === id)?.orderNumber ?? "Order", can("orders")),
        }))) },
        { label: "Recorded", value: recorded(db, e.createdAt, e.employeeId) },
      ]);
    }
    // A locker movement: the description is its category (else its note), the
    // party its account.
    const t = (db.lockerTransactions ?? []).find(x => x.id === r.id);
    return t ? lockerTxnDetails(db, t, m => can(m), { voucher: true, note: !!t.category }) : [];
  };

  // What can be done to a row. Every row has the same three, so nothing reads
  // as missing: a client payment is corrected or cancelled through its
  // receipt; anything else is greyed with where it is corrected instead.
  const rowActions = (r: PassbookRow): MoreAction[] => {
    if (r.editable) {
      const lock = payLock(r);
      return [
        { label: "View order", icon: Eye, onSelect: () => navigate(`/orders/${r.editable!.orderId}`),
          disabled: !can("orders"), hint: can("orders") ? r.link?.label : needsAccess("orders", "view") },
        { label: "Edit", icon: Pencil, onSelect: () => openEdit(r), disabled: !!lock || !mayPayEdit,
          hint: oneLine(lock) ?? (mayPayEdit ? "Amount, date, account, mode" : needsAccess("payments", "edit")) },
        { label: "Delete", icon: Trash2, danger: true, onSelect: () => cancelReceiptFlow(r.editable!.receiptId!, user!.id), disabled: !!lock || !mayPayDelete,
          hint: oneLine(lock) ?? (mayPayDelete ? "Off the bills, account and credit" : needsAccess("payments", "delete")) },
      ];
    }
    const where = correctedIn(r);
    return [
      { label: r.type === "Expense" ? "View in Expenses" : "View in Locker", icon: Eye, onSelect: () => navigate(r.link?.to ?? "/locker"),
        disabled: !can(r.type === "Expense" ? "expenses" : "locker"),
        hint: can(r.type === "Expense" ? "expenses" : "locker") ? undefined : needsAccess(r.type === "Expense" ? "expenses" : "locker", "view") },
      { label: "Edit", icon: Pencil, onSelect: () => {}, disabled: true, hint: `Edit in ${where}` },
      { label: "Delete", icon: Trash2, danger: true, onSelect: () => {}, disabled: true, hint: `Delete in ${where}` },
    ];
  };

  const exportCsv = () => {
    downloadCsv(
      `Passbook-${tab}`,
      ["Date", "Party", "Reference", "Type", "Description", `Money In (${tab})`, `Money Out (${tab})`],
      filtered.map(r => [
        fmtDate(r.date), r.party, r.link?.label || "", r.type, r.description,
        r.direction === "in" ? r.amount : "", r.direction === "out" ? r.amount : "",
      ]),
    );
  };

  // The PDF's font has no ₹: totals carry their currency, the narrow In/Out
  // columns only the figure. Dollars and rupees print exactly as they always
  // have; any other currency through fmtCcyPdf ("AUD 1,200").
  const pdfTotal = (n: number) =>
    tab === "USD" ? fmtMoney(n) : tab === "INR" ? fmtInrPlain(n) + " " + tab : fmtCcyPdf(n, tab);
  const pdfFigure = (n: number) =>
    tab === "USD" ? fmtMoney(n).replace("$", "") : tab === "INR" ? fmtInrPlain(n).replace("Rs. ", "") : fmtCcyPdf(n, tab).replace(`${tab} `, "");

  const exportPdf = () => {
    downloadLedgerPdf({
      title: `Passbook (${tab})`,
      subjectLines: [
        `Currency: ${tab}`,
        hasActiveFilter ? "Filters applied — see on-screen view for details" : "All entries",
        `Report Generated: ${new Date().toLocaleDateString("en-IN", { month: "long", day: "numeric", year: "numeric" })}`,
      ],
      summary: [
        { label: "Money In", value: pdfTotal(totalIn) },
        { label: "Money Out", value: pdfTotal(totalOut) },
        { label: "Net", value: pdfTotal(net) },
      ],
      columns: [
        { header: "Date", x: 20 },
        { header: "Party", x: 45 },
        { header: "Type", x: 90 },
        { header: "In", x: 135 },
        { header: "Out", x: 160 },
      ],
      rows: filtered.map(r => [
        fmtDate(r.date), r.party.slice(0, 20), r.type,
        r.direction === "in" ? pdfFigure(r.amount) : "—",
        r.direction === "out" ? pdfFigure(r.amount) : "—",
      ]),
      filename: `Passbook-${tab}`,
    });
  };

  return (
    <div className="max-w-7xl mx-auto space-y-5">
      <PageHeader title="Passbook" />

      {/* ── Currency tabs — never blend USD client billing with INR sourcing/cost, or either with any other account's currency ── */}
      {!isClient && (
        <TabBar label="Currency" value={tab} onChange={setCurTab} tabs={tabs.map(c => ({ key: c, label: tabLabel(c) }))} />
      )}

      {/* ── Table — the page title and the tab already say what it holds ── */}
      <div className="card-luxe overflow-hidden">
        {/* A client payment with a receipt opens its correction on a click; the
            rest open their details, and their ⋯ says where they are corrected.
            Keyed on the tab and filters so a new view starts from its newest entry.
            The downloads and the figures carry what the filters leave, as they
            always did — the search narrows only the table. */}
        <div className="p-3 sm:p-4">
          <DataTable
            filters={filters}
            onClearFilters={clearFilters}
            exports={[
              { label: "PDF", icon: FileText, hint: "With the totals", onSelect: exportPdf },
              { label: "Excel (.csv)", icon: FileSpreadsheet, hint: "Opens in Excel or Sheets", onSelect: exportCsv },
            ]}
            exportScope={`${filtered.length} ${filtered.length === 1 ? "entry" : "entries"} the filters leave (not the search)`}
            summary={
              // Money in − money out = net, for what the filters leave.
              <StatStrip items={[
                { label: "Money in", value: fmt(totalIn), tone: "in", sub: `${nIn} ${nIn === 1 ? "entry" : "entries"}` },
                { label: "Money out", value: fmt(totalOut), tone: "out", op: "−", sub: `${nOut} ${nOut === 1 ? "entry" : "entries"}` },
                // A result, not money received or owed: plain, its sign says which way.
                { label: "Net", value: fmt(net), tone: "strong", op: "=" },
              ]} />
            }
            resetKey={`${tab}|${dateFrom}|${dateTo}|${clientFilter}`}
            id="passbook"
            noun="transaction"
            rows={filtered}
            columns={columns}
            // A payment's id is only unique within its order — keyed with the order, so no two rows can share a key.
            rowKey={r => `${r.editable?.orderId ?? ""}|${r.id}`}
            defaultSort={{ key: "date", dir: "desc" }}
            searchText={r => [r.party, r.link?.label, r.type, r.description].filter(Boolean).join(" ")}
            searchPlaceholder="Search party, reference, description"
            totalsLabel="Net"
            totals={{ amount: rows => { const n = rows.reduce((s, r) => s + signed(r), 0); return <span>{fmt(n)}</span>; } }}
            onRowClick={mayPayEdit ? openEdit : undefined}
            canClickRow={r => !!r.editable && !payLock(r)}
            details={rowDetails}
            rowActions={isClient ? undefined : r => rowActions(r)}
            emptyText={
              <span className="inline-flex flex-col items-center gap-2">
                {hasActiveFilter ? "Nothing matches these filters." : "No transactions yet."}
                {hasActiveFilter && (
                  <button
                    onClick={clearFilters}
                    className="text-xs text-primary hover:underline"
                  >
                    Clear filters
                  </button>
                )}
              </span>
            }
          />
        </div>
      </div>

      {/* ── Correct a client receipt (side panel) ── */}
      <ReceiptEditSheet receiptId={editReceiptId} onClose={() => setEditReceiptId(null)} />
    </div>
  );
}
