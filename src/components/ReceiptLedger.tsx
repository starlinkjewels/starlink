import { useCan } from "@/hooks/useCan";
import { listOf } from "@/lib/optionLists";
import { useState } from "react";
import { Pencil, Trash2 } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { useDb } from "@/hooks/useDb";
import { fmtMoney, fmtDate, type ClientReceipt } from "@/lib/db";
import { ccy, fmtCcy, fmtCcyPdf, fmtRate, rateText } from "@/lib/currency";
import { listReceipts, receiptApplied, receiptCancelBlocker } from "@/lib/receipts";
import { ReceiptEditSheet, cancelReceiptFlow } from "@/components/ReceiptEditSheet";
import { needsAccess } from "@/lib/actionHints";
import { DataTable, CellAmount, CellDate, type DataColumn } from "@/components/DataTable";
import { filled, linkList, recorded, refLink, refNo, when, type Detail } from "@/components/rowDetails";
import { downloadCsv, downloadLedgerPdf } from "@/lib/ledgerExport";
import { inDateRange, ledgerTable, rangeLabel } from "@/components/LedgerFilters";
import { StatStrip } from "@/components/TableToolbar";
import { SectionTitle } from "@/components/SectionTitle";
import { oneLine } from "@/components/MoneyEntryEditor";

// The filter offers the business's payment methods (Settings → Dropdown lists).

/**
 * Every payment received, as a numbered receipt book: what came in, from whom,
 * into which account, and what it was. Each row can be corrected or cancelled —
 * a payment entered wrong used to be permanent, because the money it turned
 * into (advances on several orders, a locker deposit, leftover credit) had to
 * be hunted down by hand. See src/lib/receipts.ts for what each action moves.
 */
export function ReceiptLedger() {
  const { user } = useAuth();
  const can = useCan();
  const db = useDb();
  const [q, setQ] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [clientId, setClientId] = useState("");
  const [acct, setAcct] = useState("");
  const [mode, setMode] = useState("");
  // The receipt open in the correction panel — the same panel, and the same
  // checks, as everywhere else a payment is corrected (ReceiptEditSheet).
  const [editId, setEditId] = useState<string | null>(null);

  const allReceipts = listReceipts(db);
  const ql = q.trim().toLowerCase();
  const rows = allReceipts.filter(r => {
    if (!inDateRange(r.date, from, to)) return false;
    if (clientId && r.clientId !== clientId) return false;
    if (acct && (r.lockerId ?? "") !== acct) return false;
    if (mode && r.method !== mode) return false;
    if (!ql) return true;
    const client = db.clients.find(c => c.id === r.clientId)?.companyName ?? "";
    return r.receiptNo.includes(ql)
      || client.toLowerCase().includes(ql)
      || (r.remarks ?? "").toLowerCase().includes(ql)
      || r.method.toLowerCase().includes(ql);
  });
  const filtered = !!(ql || from || to || clientId || acct || mode);
  const totalReceived = rows.reduce((s, r) => s + r.amountUsd, 0);
  // Only clients who actually have a receipt — a list of every client would be
  // mostly dead options.
  const payers = [...new Set(allReceipts.map(r => r.clientId))]
    .map(id => ({ value: id, label: db.clients.find(c => c.id === id)?.companyName ?? "Client" }))
    .sort((a, b) => a.label.localeCompare(b.label));

  // The currency a receipt's deposit is in. Older receipts may not name it;
  // their account does (unset is rupees).
  const depositCcy = (r: ClientReceipt) =>
    ccy(r.lockerCurrency ?? (r.lockerId ? db.lockers.find(l => l.id === r.lockerId)?.currency : undefined));
  // "1 USD = ₹83.5", "1 USD = A$1.52" — the rate is that currency for $1.
  const rateLabel = (r: ClientReceipt) => {
    if (!r.exchangeRate) return "";
    const c = depositCcy(r);
    return c === "USD" ? String(r.exchangeRate) : rateText("USD", c, r.exchangeRate);
  };
  // The PDF font draws neither ₹ nor A$, and the column is narrow: the figure
  // as it always was for rupees, with its code for any other currency.
  const rateLabelPdf = (r: ClientReceipt) => {
    if (!r.exchangeRate) return "";
    const c = depositCcy(r);
    return c === "INR" || c === "USD" ? String(r.exchangeRate) : `${c} ${fmtRate(r.exchangeRate)}`;
  };

  // What is on screen is what downloads — same search, same order.
  const exportCsv = () => downloadCsv(
    "Payments-Received",
    ["Sr", "Receipt", "Date", "Client", "Amount (USD)", "Rate", "Deposited", "Currency", "Account", "Mode", "Remarks", "Held as credit"],
    rows.map((r, i) => {
      const client = db.clients.find(c => c.id === r.clientId)?.companyName ?? "";
      const locker = db.lockers.find(l => l.id === r.lockerId)?.name ?? "";
      const asCredit = Math.round((r.amountUsd - receiptApplied(db, r.id)) * 100) / 100;
      // Rate stays a plain figure (the deposit currency for $1) for spreadsheets.
      return [i + 1, r.receiptNo, fmtDate(r.date), client, r.amountUsd, r.exchangeRate ?? "",
        r.lockerAmount ?? r.amountUsd, r.lockerId ? depositCcy(r) : (r.lockerCurrency ?? ""), locker, r.method, r.remarks ?? "",
        asCredit > 0.009 ? asCredit : ""];
    }),
  );

  const exportPdf = () => downloadLedgerPdf({
    title: "Payments Received",
    subjectLines: [
      `${rows.length} receipt${rows.length !== 1 ? "s" : ""} · ${rangeLabel(from, to)}`,
      [clientId && `Client: ${db.clients.find(c => c.id === clientId)?.companyName ?? ""}`,
        acct && `Account: ${db.lockers.find(l => l.id === acct)?.name ?? acct}`,
        mode && `Mode: ${mode}`,
        ql && `Search: "${q.trim()}"`].filter(Boolean).join(" · ") || "All receipts",
      `Report Generated: ${new Date().toLocaleDateString("en-IN", { month: "long", day: "numeric", year: "numeric" })}`,
    ],
    summary: [{ label: "Total received", value: fmtMoney(totalReceived) }],
    landscape: true,
    columns: [
      { header: "Sr", x: 14 }, { header: "Receipt", x: 26 }, { header: "Date", x: 52 },
      { header: "Client", x: 82 }, { header: "Amount", x: 150 }, { header: "Rate", x: 176 },
      { header: "Deposited", x: 200 }, { header: "Account", x: 230 }, { header: "Mode", x: 258 },
    ],
    align: ["left", "left", "left", "left", "right", "right", "right", "left", "left"],
    rows: rows.map((r, i) => [
      String(i + 1), r.receiptNo, fmtDate(r.date),
      (db.clients.find(c => c.id === r.clientId)?.companyName ?? "").slice(0, 40),
      fmtMoney(r.amountUsd), rateLabelPdf(r),
      r.lockerId ? fmtCcyPdf(r.lockerAmount ?? r.amountUsd, depositCcy(r)) : "",
      (db.lockers.find(l => l.id === r.lockerId)?.name ?? "").slice(0, 16),
      r.method.slice(0, 14),
    ]),
    filename: "Payments-Received",
  });


  const clientName = (id: string) => db.clients.find(c => c.id === id)?.companyName ?? "";
  const lockerName = (id?: string) => (id ? db.lockers.find(l => l.id === id)?.name : undefined) ?? "";
  // An opened receipt: where its money landed — the bills it settled, read live
  // from the orders, and what is still held as credit — the bill it was sent
  // for, its deposit's voucher, and who recorded (and last corrected) it.
  const receiptDetails = (r: ClientReceipt): Detail[] => {
    const landed = db.orders.flatMap(o => (o.advances ?? []).filter(a => a.receiptId === r.id).map(a => ({ o, a })));
    const asCredit = Math.round((r.amountUsd - receiptApplied(db, r.id)) * 100) / 100;
    const inv = r.invoiceId ? (db.invoices ?? []).find(i => i.id === r.invoiceId) : undefined;
    const deposit = (db.lockerTransactions ?? []).find(t => t.receiptId === r.id);
    return filled([
      can("clients") && { label: "Client page", value: refLink(`/clients/${r.clientId}`, clientName(r.clientId) || "Client") },
      landed.length > 0 && { label: "Applied to", value: linkList(landed.map(({ o, a }) => ({
        key: a.id, node: <>{refLink(`/orders/${o.id}`, o.orderNumber, can("orders"))} <span className="text-muted-foreground">{fmtMoney(a.amount)}</span></>,
      }))) },
      asCredit > 0.009 && { label: "Held as credit", value: fmtMoney(asCredit) },
      !!inv && { label: "Sent for invoice", value: refLink(`/invoices?q=${encodeURIComponent(inv.number)}`, inv.number, can("invoices")) },
      { label: "Voucher", value: refNo(deposit?.voucherNo) },
      { label: "Recorded", value: recorded(db, r.createdAt, r.recordedBy) },
      !!r.updatedAt && { label: "Last corrected", value: when(r.updatedAt) },
    ]);
  };

  const columns: DataColumn<ClientReceipt>[] = [
    { key: "receipt", header: "Receipt", always: true, sortValue: r => r.receiptNo,
      cell: r => <span className="font-mono font-medium whitespace-nowrap">{r.receiptNo}</span> },
    { key: "date", header: "Date", kind: "date", sortValue: r => +new Date(r.date), csv: r => fmtDate(r.date),
      cell: r => <CellDate>{fmtDate(r.date)}</CellDate> },
    { key: "client", header: "Client", sortValue: r => clientName(r.clientId),
      cell: r => <span className="block font-medium max-w-[160px] truncate">{clientName(r.clientId) || "—"}</span> },
    { key: "amount", header: "Amount", align: "right", kind: "number", sortValue: r => r.amountUsd,
      cell: r => <CellAmount tone="in">{fmtMoney(r.amountUsd)}</CellAmount> },
    { key: "rate", header: "Rate", align: "right", kind: "number", sortValue: r => r.exchangeRate,
      cell: r => <span className="text-xs text-muted-foreground tabular-nums whitespace-nowrap">{rateLabel(r) || "—"}</span> },
    { key: "deposited", header: "Deposited", align: "right", kind: "number", sortValue: r => (r.lockerId ? r.lockerAmount ?? r.amountUsd : null),
      cell: r => <span className="text-xs tabular-nums whitespace-nowrap">{r.lockerId ? fmtCcy(r.lockerAmount ?? r.amountUsd, depositCcy(r)) : "—"}</span> },
    { key: "account", header: "Account", sortValue: r => lockerName(r.lockerId),
      cell: r => <span className="block text-xs text-muted-foreground max-w-[120px] truncate">{lockerName(r.lockerId) || "—"}</span> },
    { key: "mode", header: "Mode", sortValue: r => r.method, cell: r => <span className="text-xs whitespace-nowrap">{r.method}</span> },
    { key: "remarks", header: "Remarks", sortValue: r => r.remarks ?? "",
      cell: r => {
        const asCredit = Math.round((r.amountUsd - receiptApplied(db, r.id)) * 100) / 100;
        return (
          <span className="block text-xs text-muted-foreground max-w-[170px] truncate">
            {r.remarks ?? "—"}
            {asCredit > 0.009 && <span className="ml-1 text-warning">· {fmtMoney(asCredit)} held as credit</span>}
          </span>
        );
      } },
  ];

  return (
    <div className="card-luxe p-5">
      <SectionTitle className="mb-4" title="Payments received" />

      {/* Search, filters and downloads sit in the table's own toolbar, the
          total under it. A new filter (resetKey) starts it again from the
          first page. */}
      <DataTable
        summary={
          <StatStrip items={[
            { label: "Received", value: fmtMoney(totalReceived), tone: "in", sub: "In US dollars" },
          ]} note={filtered ? `For what the filters show${from || to ? ` · ${rangeLabel(from, to)}` : ""}` : undefined} />
        }
        {...ledgerTable({
          q, onQ: setQ, placeholder: "Search receipt #, client, remark…",
          from, to, onFrom: setFrom, onTo: setTo,
          selects: [
            { label: "Client", value: clientId, onChange: setClientId, options: payers },
            { label: "Account", value: acct, onChange: setAcct,
              options: db.lockers.map(l => ({ value: l.id, label: l.name })) },
            { label: "Mode", value: mode, onChange: setMode,
              options: listOf("paymentMethods").map(m => ({ value: m, label: m })) },
          ],
          onPdf: exportPdf, onCsv: exportCsv,
        })}
        resetKey={JSON.stringify([ql, from, to, clientId, acct, mode])}
        id="receipt-ledger"
        noun="receipt"
        rows={rows}
        columns={columns}
        rowKey={r => r.id}
        defaultSort={{ key: "date", dir: "desc" }}
        emptyText={filtered ? "Nothing matches these filters." : "No payments recorded yet."}
        details={receiptDetails}
        rowActions={r => {
          const mayEdit = can("payments", "edit"), mayDelete = can("payments", "delete");
          // Said up front: a receipt whose credit has been spent since, or whose
          // account entry can't be told apart from its neighbours, isn't cancelled.
          const stuck = mayDelete ? receiptCancelBlocker(db, r.id) : undefined;
          return [
            { label: "Edit", icon: Pencil, onSelect: () => setEditId(r.id), disabled: !mayEdit,
              hint: mayEdit ? "Amount, date, account, mode" : needsAccess("payments", "edit") },
            { label: "Delete", icon: Trash2, danger: true, onSelect: () => cancelReceiptFlow(r.id, user!.id), disabled: !mayDelete || !!stuck,
              hint: !mayDelete ? needsAccess("payments", "delete") : oneLine(stuck) ?? "Off the bills, account and credit" },
          ];
        }}
      />

      <ReceiptEditSheet receiptId={editId} onClose={() => setEditId(null)} />
    </div>
  );
}
