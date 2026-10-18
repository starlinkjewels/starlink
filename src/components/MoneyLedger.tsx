import { useCan } from "@/hooks/useCan";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Eye, Pencil, Trash2 } from "lucide-react";
import { useDb } from "@/hooks/useDb";
import { useLoaded } from "@/hooks/useLoaded";
import { fmtDate } from "@/lib/db";
import { ccyOrder, fmtCcy, fmtCcyMix, fmtCcyPdf, sumByCcy, type CurrencyCode } from "@/lib/currency";
import { ENTRY_COLS, listEntries, type EntryKind, type MoneyEntry } from "@/lib/moneyEntries";
import { needsAccess } from "@/lib/actionHints";
import { DataTable, CellMain, CellAmount, CellDate, type DataColumn } from "@/components/DataTable";
import type { MoreAction } from "@/components/MoreMenu";
import { MoneyEntryEditor, confirmDeleteEntry, entryRowActions, oneLine } from "@/components/MoneyEntryEditor";
import { ExpenseEditDialog, confirmDeleteExpense, useExpenseRights } from "@/components/ExpenseEditDialog";
import { filled, linkList, lockerTxnDetails, recorded, refLink, type Detail } from "@/components/rowDetails";
import { downloadCsv, downloadLedgerPdf } from "@/lib/ledgerExport";
import { inDateRange, ledgerTable, rangeLabel } from "@/components/LedgerFilters";
import { StatStrip } from "@/components/TableToolbar";
import { SectionTitle } from "@/components/SectionTitle";

/** The section's heading — the tab's own name, in the same words. */
const HEADINGS: Record<EntryKind, string> = {
  supplier: "Supplier payments",
  factory: "Factory payments",
  expense: "Expenses",
  locker: "Account entries",
};

/** The PDF's title and the file name. */
const TITLES: Record<EntryKind, string> = {
  supplier: "Supplier Payments",
  factory: "Factory Payments",
  expense: "Expenses",
  locker: "Account Entries",
};

/** What the party column holds, per tab — so its filter is named for what it
 *  actually lists rather than a generic "Party". */
const PARTY_LABEL: Record<EntryKind, string> = {
  supplier: "Supplier",
  factory: "Factory",
  expense: "Expense",
  locker: "Category",
};

/** What one row is, for the table's count — "12 payments", "3 expenses". */
const NOUN: Record<EntryKind, string> = {
  supplier: "payment",
  factory: "payment",
  expense: "expense",
  locker: "transaction",
};

/** Totals in several currencies for a PDF, each kept apart — its font has no ₹. */
function fmtMixPdf(m: Map<CurrencyCode, number>): string {
  const parts = [...m.entries()].filter(([, v]) => Math.abs(v) > 0.0001).sort(([a], [b]) => ccyOrder(a, b));
  return parts.length ? parts.map(([c, v]) => fmtCcyPdf(v, c)).join(" + ") : fmtCcyPdf(0, "INR");
}

/**
 * One table for every kind of money that isn't a client receipt. Each row can be
 * corrected or cancelled, and both sides move together — the party's books and
 * the account it came out of. What each action changes is spelled out before it
 * is confirmed; see src/lib/moneyEntries.ts.
 */
export function MoneyLedger({ kind }: { kind: EntryKind }) {
  const can = useCan();
  const db = useDb();
  const navigate = useNavigate();
  const expenseRight = useExpenseRights();
  const [q, setQ] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [party, setParty] = useState("");
  const [acct, setAcct] = useState("");
  const [dir, setDir] = useState("");
  // Correcting a payment or account entry (the shared panel), or an expense
  // (its own panel — every field, not only the money).
  const [editing, setEditing] = useState<MoneyEntry | null>(null);
  const [editingExpense, setEditingExpense] = useState<string | null>(null);

  // Each row is matched to the bill or sale behind it, which may still be on
  // its way — listed only once it is here, so no row is offered wrongly.
  const ready = useLoaded(ENTRY_COLS[kind]);
  const all = ready ? listEntries(db, kind) : [];
  // The party list is built from the entries themselves, so it only ever offers
  // names that will actually match something.
  const parties = [...new Set(all.map(e => e.party).filter(Boolean))].sort();

  const ql = q.trim().toLowerCase();
  const rows = all.filter(e => {
    if (!inDateRange(e.date, from, to)) return false;
    if (party && e.party !== party) return false;
    if (acct && (e.lockerId ?? "") !== acct) return false;
    if (dir && e.direction !== dir) return false;
    return !ql || e.party.toLowerCase().includes(ql)
      || (e.against ?? "").toLowerCase().includes(ql)
      || (e.voucherNo ?? "").toLowerCase().includes(ql)
      || (e.note ?? "").toLowerCase().includes(ql);
  });
  const filtered = !!(ql || from || to || party || acct || dir);

  // Each currency totalled on its own — rupees and dollars are never added up.
  const totalOut = sumByCcy(rows.filter(r => r.direction === "out"), r => r.amount, r => r.currency);
  const totalIn = sumByCcy(rows.filter(r => r.direction === "in"), r => r.amount, r => r.currency);
  const anyOf = (m: Map<CurrencyCode, number>) => [...m.values()].some(v => v > 0);
  const nOut = rows.filter(r => r.direction === "out").length, nIn = rows.length - nOut;
  const entries = (n: number) => `${n} ${n === 1 ? "entry" : "entries"}`;
  const showIn = anyOf(totalIn) || kind === "locker";

  // Both downloads carry exactly what is on screen — the same filter, the same
  // order — so a printed copy can be checked against the page it came from.
  const exportRows = () => rows.map((e, i) => [
    i + 1,
    e.voucherNo ?? "",
    fmtDate(e.date),
    e.party,
    e.against ?? "",
    e.direction === "out" ? e.amount : "",
    e.direction === "in" ? e.amount : "",
    e.currency,
    db.lockers.find(l => l.id === e.lockerId)?.name ?? "",
    e.note ?? "",
  ]);
  const HEAD = ["Sr", "Voucher", "Date", kind === "expense" ? "Expense" : "Party", "Against", "Out", "In", "Currency", "Account", "Remarks"];

  const exportCsv = () => downloadCsv(`${TITLES[kind].replace(/\s+/g, "-")}`, HEAD, exportRows());

  const exportPdf = () => downloadLedgerPdf({
    title: TITLES[kind],
    subjectLines: [
      `${rows.length} entr${rows.length !== 1 ? "ies" : "y"} · ${rangeLabel(from, to)}`,
      [party && `${PARTY_LABEL[kind]}: ${party}`,
        acct && `Account: ${db.lockers.find(l => l.id === acct)?.name ?? acct}`,
        dir && (dir === "out" ? "Money out only" : "Money in only"),
        ql && `Search: "${q.trim()}"`].filter(Boolean).join(" · ") || "All entries",
      `Report Generated: ${new Date().toLocaleDateString("en-IN", { month: "long", day: "numeric", year: "numeric" })}`,
    ],
    summary: [
      { label: "Total out", value: fmtMixPdf(totalOut) },
      { label: "Total in", value: fmtMixPdf(totalIn) },
    ],
    landscape: true,
    columns: [
      { header: "Sr", x: 14 }, { header: "Voucher", x: 26 }, { header: "Date", x: 52 },
      { header: kind === "expense" ? "Expense" : "Party", x: 80 }, { header: "Against", x: 130 },
      { header: "Out", x: 186 }, { header: "In", x: 214 }, { header: "Account", x: 238 },
      { header: "Remarks", x: 268 },
    ],
    align: ["left", "left", "left", "left", "left", "right", "right", "left", "left"],
    rows: rows.map((e, i) => [
      String(i + 1), e.voucherNo ?? "", fmtDate(e.date),
      (e.party || "").slice(0, 30), (e.against ?? "").slice(0, 32),
      e.direction === "out" ? fmtCcyPdf(e.amount, e.currency) : "",
      e.direction === "in" ? fmtCcyPdf(e.amount, e.currency) : "",
      (db.lockers.find(l => l.id === e.lockerId)?.name ?? "").slice(0, 16),
      (e.note ?? "").slice(0, 16),
    ]),
    filename: TITLES[kind].replace(/\s+/g, "-"),
  });


  /** View: the page of who (or what) the money was with — greyed, saying
   *  why, for someone whose access doesn't open that page. */
  const viewAction = (e: MoneyEntry): MoreAction | undefined => {
    const go = (label: string, to: string, module: Parameters<typeof can>[0]): MoreAction => ({
      label, icon: Eye, onSelect: () => navigate(to), disabled: !can(module), hint: can(module) ? undefined : needsAccess(module, "view"),
    });
    if (kind === "supplier" && e.partyId) return go(`View ${e.party}`, `/suppliers/${e.partyId}`, "suppliers");
    if (kind === "factory" && e.partyId) return go(`View ${e.party}`, `/factories/${e.partyId}`, "factories");
    if (kind === "expense") {
      const x = db.expenses.find(ex => ex.id === e.id);
      const paidTo = x?.paidToEmployeeId ? db.users.find(u => u.id === x.paidToEmployeeId) : undefined;
      if (paidTo) return go(`View ${paidTo.name}`, `/employees/${paidTo.id}`, "employees");
      const client = x?.clientId ? db.clients.find(c => c.id === x.clientId) : undefined;
      if (client) return go(`View ${client.companyName}`, `/clients/${client.id}`, "clients");
      return undefined;
    }
    if (kind === "locker" && e.lockerId) return go("View account", `/locker?account=${e.lockerId}`, "locker");
    return undefined;
  };

  /** A row's ⋯: View, then Edit / Delete — an expense by the one expense rule,
   *  everything else by Payments access; a row owned by another tab says where. */
  const rowActions = (e: MoneyEntry): MoreAction[] => {
    const view = viewAction(e);
    if (kind === "expense") {
      const x = db.expenses.find(ex => ex.id === e.id);
      const editWhy = x ? expenseRight(x, "edit") : "That expense is no longer on file";
      const delWhy = x ? expenseRight(x, "delete") : "That expense is no longer on file";
      return [
        ...(view ? [view] : []),
        { label: "Edit", icon: Pencil, onSelect: () => setEditingExpense(e.id), disabled: !!editWhy, hint: oneLine(editWhy) },
        { label: "Delete", icon: Trash2, danger: true, onSelect: () => { if (x) void confirmDeleteExpense(x); }, disabled: !!delWhy, hint: oneLine(delWhy) },
      ];
    }
    return [
      ...(view ? [view] : []),
      ...entryRowActions(e, {
        mayEdit: can("payments", "edit"), mayDelete: can("payments", "delete"),
        editNeeds: needsAccess("payments", "edit"), deleteNeeds: needsAccess("payments", "delete"),
        onEdit: setEditing,
        onDelete: x => { void confirmDeleteEntry(db, x); },
        go: navigate, mayOpen: m => can(m),
      }),
    ];
  };

  const lockerName = (id?: string) => (id ? db.lockers.find(l => l.id === id)?.name : undefined) ?? "";

  // An opened row: who recorded it and when, the page of the party it was
  // with, how one payment was split across bills, the orders it was for —
  // read from the record the row stands for.
  const orderLinks = (ids: (string | undefined)[]) => linkList([...new Set(ids.filter((x): x is string => !!x))].map(id => ({
    key: id, node: refLink(`/orders/${id}`, db.orders.find(o => o.id === id)?.orderNumber ?? "Order", can("orders")),
  })));
  const entryDetails = (e: MoneyEntry): Detail[] => {
    const ids = e.legIds ?? [e.id];
    // Corrected from another tab: say which, as the ⋯ menu does. A payment
    // and its account that disagree, or an account row on its own, say so.
    const where = e.lockedWhere ? { label: "Recorded in", value: e.lockedWhere }
      : e.locked ? { label: "Editing", value: e.locked }
      : e.orphan ? { label: "Editing", value: e.orphan }
      : e.noTxn ? { label: "In the account", value: `No movement found in ${lockerName(e.lockerId) || "its account"}` }
      : e.txnAmount !== undefined ? { label: "In the account", value: `${fmtCcy(e.txnAmount, e.currency)} — not ${fmtCcy(e.amount, e.currency)}` }
      : undefined;
    if (kind === "supplier") {
      const parts = (db.purchases ?? []).flatMap(p => (p.payments ?? []).filter(pay => ids.includes(pay.id)).map(pay => ({ p, pay })));
      const other = (db.supplierReceipts ?? []).find(r => r.id === e.id) ?? (db.supplierPayments ?? []).find(a => a.id === e.id);
      const supplierId = parts[0]?.p.supplierId ?? other?.supplierId;
      return filled([
        !!supplierId && can("suppliers") && { label: "Supplier page", value: refLink(`/suppliers/${supplierId}`, e.party || "Supplier") },
        parts.length > 1 && { label: "Split across", value: parts.map(x => `${x.p.invoiceNumber || "No bill no."} · ${fmtCcy(x.pay.amountInr, "INR")}`).join(", ") },
        { label: "For order", value: orderLinks(parts.map(x => x.p.orderId)) },
        { label: "Recorded", value: recorded(db, e.date, parts[0]?.pay.recordedBy ?? other?.recordedBy) },
        where,
      ]);
    }
    if (kind === "factory") {
      const parts = (db.materialIssuances ?? []).flatMap(mi => (mi.makingCharges?.payments ?? []).filter(pay => ids.includes(pay.id)).map(pay => ({ mi, pay })));
      const adv = (db.factoryPayments ?? []).find(a => a.id === e.id);
      const factoryId = parts[0]?.mi.factoryId ?? adv?.factoryId;
      return filled([
        !!factoryId && can("factories") && { label: "Factory page", value: refLink(`/factories/${factoryId}`, e.party || "Factory") },
        parts.length > 1 && { label: "Split across", value: parts.map(x => `${db.orders.find(o => o.id === x.mi.orderId)?.orderNumber ?? "Making charges"} · ${fmtCcy(x.pay.amountInr, "INR")}`).join(", ") },
        { label: parts.length > 1 ? "Orders" : "Order", value: orderLinks(parts.map(x => x.mi.orderId)) },
        { label: "Recorded", value: recorded(db, e.date, parts[0]?.pay.recordedBy ?? adv?.recordedBy) },
        where,
      ]);
    }
    if (kind === "expense") {
      const x = db.expenses.find(ex => ex.id === e.id);
      const client = x?.clientId ? db.clients.find(c => c.id === x.clientId) : undefined;
      return filled([
        !!client && { label: "Client", value: refLink(`/clients/${client.id}`, client.companyName, can("clients")) },
        { label: (x?.orderIds?.length ?? 0) > 1 ? "For orders" : "For order", value: orderLinks(x?.orderIds ?? []) },
        { label: "Shipment", value: x?.shipmentRef },
        { label: "Recorded", value: recorded(db, x?.createdAt ?? e.date, x?.employeeId) },
        where,
      ]);
    }
    // An account entry: the movement itself — voucher, remarks, account and
    // category already have their columns.
    const t = (db.lockerTransactions ?? []).find(x => x.id === e.id);
    return [...(t ? lockerTxnDetails(db, t, m => can(m)) : []), ...filled([where])];
  };

  const columns: DataColumn<MoneyEntry>[] = [
    { key: "party", header: kind === "expense" ? "Expense" : "Party", always: true, sortValue: e => e.party,
      cell: e => <CellMain title={e.party || "—"} className="max-w-[180px]" /> },
    { key: "date", header: "Date", kind: "date", sortValue: e => +new Date(e.date), csv: e => fmtDate(e.date),
      cell: e => <CellDate>{fmtDate(e.date)}</CellDate> },
    { key: "voucher", header: "Voucher", hideIfEmpty: true, sortValue: e => e.voucherNo ?? "",
      cell: e => <span className="font-mono text-[11px] text-muted-foreground whitespace-nowrap">{e.voucherNo ?? "—"}</span> },
    { key: "against", header: "Against", sortValue: e => e.against ?? "",
      cell: e => <span className="block text-xs text-muted-foreground max-w-[150px] truncate" title={e.against ?? ""}>{e.against ?? "—"}</span> },
    { key: "out", header: "Out", align: "right", kind: "number", sortValue: e => (e.direction === "out" ? e.amount : null),
      cell: e => (e.direction === "out" ? <CellAmount tone="out">{fmtCcy(e.amount, e.currency)}</CellAmount> : null) },
    { key: "in", header: "In", align: "right", kind: "number", sortValue: e => (e.direction === "in" ? e.amount : null),
      cell: e => (e.direction === "in" ? <CellAmount tone="in">{fmtCcy(e.amount, e.currency)}</CellAmount> : null) },
    { key: "account", header: "Account", sortValue: e => lockerName(e.lockerId),
      cell: e => <span className="block text-xs text-muted-foreground max-w-[120px] truncate">{lockerName(e.lockerId) || "—"}</span> },
    { key: "remarks", header: "Remarks", sortValue: e => e.note ?? "",
      cell: e => <span className="block text-xs text-muted-foreground max-w-[160px] truncate" title={e.note ?? ""}>{e.note ?? "—"}</span> },
  ];

  return (
    <div className="card-luxe p-5">
      <SectionTitle className="mb-4" title={HEADINGS[kind]} />

      {/* Search, filters and downloads sit in the table's own toolbar, the
          money out and in under it — each currency kept apart. A new filter
          (resetKey) starts it again from the first page. */}
      <DataTable
        summary={
          <StatStrip items={[
            // The count under each only when there are both — alone, it is the table's own count.
            { label: "Money out", value: fmtCcyMix(totalOut), tone: "out", sub: showIn ? entries(nOut) : undefined },
            // Money in only where it happens: refunds, deposits, transfers in.
            ...(showIn ? [{ label: "Money in", value: fmtCcyMix(totalIn), tone: "in" as const, sub: entries(nIn) }] : []),
          ]} note={filtered ? `For what the filters show${from || to ? ` · ${rangeLabel(from, to)}` : ""}` : undefined} />
        }
        {...ledgerTable({
          q, onQ: setQ, placeholder: "Search party, voucher, bill, remark…",
          from, to, onFrom: setFrom, onTo: setTo,
          selects: [
            { label: PARTY_LABEL[kind], value: party, onChange: setParty,
              options: parties.map(p => ({ value: p, label: p })) },
            { label: "Account", value: acct, onChange: setAcct,
              options: db.lockers.map(l => ({ value: l.id, label: l.name })) },
            { label: "Direction", value: dir, onChange: setDir,
              options: [{ value: "out", label: "Money out" }, { value: "in", label: "Money in" }] },
          ],
          onPdf: exportPdf, onCsv: exportCsv,
        })}
        resetKey={JSON.stringify([kind, ql, from, to, party, acct, dir])}
        id={`money-ledger-${kind}`}
        noun={NOUN[kind]}
        rows={rows}
        columns={columns}
        rowKey={e => e.id}
        defaultSort={{ key: "date", dir: "desc" }}
        loading={!ready}
        emptyText={filtered ? "Nothing matches these filters." : "No entries yet."}
        details={entryDetails}
        // View, Edit, Delete — greyed with the reason where they can't be used.
        rowActions={rowActions}
      />

      {/* The same correction panel as the Locker page and the day book. */}
      <MoneyEntryEditor entry={editing} onClose={() => setEditing(null)} mayDelete={can("payments", "delete")} />
      <ExpenseEditDialog expenseId={editingExpense} onClose={() => setEditingExpense(null)} />
    </div>
  );
}
