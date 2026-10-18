import { useMemo, useState, type ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { fmtDate } from "@/lib/db";
import { Download } from "lucide-react";
import { DataTable, CellMain, CellAmount, CellDate, type DataColumn } from "@/components/DataTable";
import { ledgerTable } from "@/components/LedgerFilters";
import { StatStrip } from "@/components/TableToolbar";
import { SectionTitle } from "@/components/SectionTitle";
import { filled, when, type Detail } from "@/components/rowDetails";
import type { MoreAction } from "@/components/MoreMenu";

export interface StatementRow {
  id: string;
  date: string;
  /** What happened, in words — "Purchase — 5g 22K gold (Inv 8821)". */
  particulars: string;
  /** The document it belongs to: order no., invoice no., stock no. */
  ref?: string;
  /** Kept apart from `ref` so a download can give each its own column instead
   *  of squeezing both into one and cutting the end off. */
  invoiceNo?: string;
  orderNo?: string;
  debit: number;
  credit: number;
  /** Running balance AFTER this row. Computed by the caller, which knows the
   *  opening balance and the order rows should be read in. */
  balance: number;
  /** Quantity and rate behind the amount — a purchase line carries its carats
   *  or grams and the per-unit rate, so a statement explains its own figures. */
  qty?: number;
  unit?: string;
  rate?: number;
  /** Groups the row for the type filter, e.g. "Purchase" / "Payment". */
  kind?: string;
  /** Pinned to the top and never filtered out — an opening balance. */
  pinned?: boolean;
}

export interface StatementSummary {
  label: string;
  value: string;
  tone?: "neutral" | "in" | "out" | "due";
  /** The picture beside the figure; one is chosen from the tone without it. */
  icon?: LucideIcon;
  /** A quiet line under the figure — "8 purchases", "after advances". */
  sub?: ReactNode;
}

// The statement's tones as the table's figures strip draws them: what is
// still due stands out in bold rather than in a colour of its own.
const TONE: Record<NonNullable<StatementSummary["tone"]>, "in" | "out" | "strong" | undefined> = {
  neutral: undefined,
  in: "in",
  out: "out",
  due: "strong",
};

/**
 * One account statement, everywhere: a supplier's dues, a factory's charges, a
 * client's billing, an employee's salary. The search, dates and type in the
 * table's own toolbar, the summary under it, then every entry with Debit /
 * Credit / a running balance — the same ledger people already read on the
 * Stock and Locker pages, instead of each page inventing its own flat list.
 *
 * Rows arrive with their balance already worked out: only the caller knows the
 * opening balance and which way round its figures run.
 */
export function StatementLedger({
  title,
  caption,
  rows,
  summary = [],
  debitLabel = "Debit",
  creditLabel = "Credit",
  fmt,
  onExport,
  pageSize,
  emptyText = "No entries yet.",
  rowAction,
  rowActions,
  details,
}: {
  title: string;
  caption?: string;
  rows: StatementRow[];
  summary?: StatementSummary[];
  debitLabel?: string;
  creditLabel?: string;
  /** How to print an amount — ₹, $, grams, carats. */
  fmt: (n: number) => string;
  onExport?: () => void;
  pageSize?: number;
  emptyText?: string;
  /** Optional control at the end of a row — reversing a payment, say. */
  rowAction?: (row: StatementRow) => ReactNode;
  /** The ⋯ menu at the end of a row — View / Edit / Delete on the record
   *  behind it, from the page that knows that record. Passed straight to the
   *  table; an opening balance (pinned) never gets one. */
  rowActions?: (row: StatementRow) => MoreAction[];
  /** More for an opened row, from the page that knows the record behind it —
   *  who recorded it, the account it went through, the full note. */
  details?: (row: StatementRow) => Detail[];
}) {
  const [q, setQ] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [kind, setKind] = useState("all");

  const kinds = useMemo(
    () => [...new Set(rows.map(r => r.kind).filter((k): k is string => !!k))].sort(),
    [rows],
  );

  const filtered = useMemo(() => {
    const ql = q.trim().toLowerCase();
    const fromD = from ? new Date(`${from}T00:00:00`) : null;
    const toD = to ? new Date(`${to}T23:59:59.999`) : null;
    return rows.filter(r => {
      if (r.pinned) return true; // an opening balance is context, never filtered away
      if (kind !== "all" && r.kind !== kind) return false;
      const d = new Date(r.date);
      if (fromD && d < fromD) return false;
      if (toD && d > toD) return false;
      if (!ql) return true;
      return r.particulars.toLowerCase().includes(ql) || (r.ref ?? "").toLowerCase().includes(ql);
    });
  }, [rows, q, from, to, kind]);

  const active = !!q.trim() || !!from || !!to || kind !== "all";
  const totalDebit = filtered.reduce((s, r) => s + r.debit, 0);
  const totalCredit = filtered.reduce((s, r) => s + r.credit, 0);
  // A salary ledger only ever pays out — an empty credit label drops the column
  // rather than printing a blank one next to every row.
  const showCredit = creditLabel !== "";

  // An opening balance is context, not an entry to sort: it rides at the end of
  // the newest-first list. With nothing else to show it is just the one row,
  // so the table doesn't also print "nothing here" beneath it.
  const entries = filtered.filter(r => !r.pinned);
  const pinned = filtered.filter(r => r.pinned);
  const onlyPinned = entries.length === 0 && pinned.length > 0;

  const refsOf = (r: StatementRow) => {
    // The order / invoice / reference, each once, and not again when the
    // particulars already name it ("Payment — 8821").
    const refs = [...new Set([r.ref, r.orderNo, r.invoiceNo].filter((x): x is string => !!x))]
      .filter(x => !r.particulars.includes(x));
    const qty = r.qty ? `${r.qty}${r.unit ?? ""}${r.rate ? ` @ ${fmt(r.rate)}` : ""}` : "";
    return [...refs, qty].filter(Boolean).join(" · ");
  };

  const columns: DataColumn<StatementRow>[] = [
    { key: "date", header: "Date", always: true, kind: "date", sortValue: r => +new Date(r.date),
      cell: r => <CellDate>{fmtDate(r.date)}</CellDate> },
    { key: "particulars", header: "Particulars", always: true, sortValue: r => r.particulars,
      cell: r => <CellMain title={r.particulars} sub={refsOf(r) || undefined} /> },
    { key: "debit", header: debitLabel, align: "right", kind: "number", sortValue: r => r.debit,
      cell: r => (r.debit > 0 ? <CellAmount tone="out">{fmt(r.debit)}</CellAmount> : null) },
    ...(showCredit ? [{ key: "credit", header: creditLabel, align: "right" as const, kind: "number" as const, sortValue: (r: StatementRow) => r.credit,
      // Plain: on a supplier's statement this is money we paid, not money received.
      cell: (r: StatementRow) => (r.credit > 0 ? <CellAmount>{fmt(r.credit)}</CellAmount> : null) }] : []),
    { key: "balance", header: "Balance", align: "right", kind: "number", sortValue: r => r.balance,
      cell: r => <CellAmount>{fmt(r.balance)}</CellAmount> },
    // rowAction hands back its own control (a button, say), not menu items,
    // so it gets a cell of its own rather than the ⋯ menu.
    ...(rowAction ? [{ key: "action", header: "Action", align: "right" as const, cell: (r: StatementRow) => rowAction(r) }] : []),
  ];

  return (
    <div className="card-luxe overflow-hidden">
      <div className="px-5 py-4 border-b border-border/60">
        <SectionTitle title={title} sub={caption ?? `${rows.length} entr${rows.length !== 1 ? "ies" : "y"}`} />
      </div>

      {/* Search, dates, type and the download sit in the table's own toolbar,
          the summary under it. A new filter (resetKey) starts it again from
          the first page. */}
      <div className="px-5 py-4">
        <DataTable
          {...ledgerTable({
            q, onQ: setQ, placeholder: "Search particulars or reference…",
            from, to, onFrom: setFrom, onTo: setTo,
            selects: kinds.length > 1 ? [{ label: "Type", allLabel: "All types", value: kind === "all" ? "" : kind,
              onChange: v => setKind(v || "all"), options: kinds.map(k => ({ value: k, label: k })) }] : [],
          })}
          // Clears the type too, even while its dropdown is hidden, as Reset did.
          onClearFilters={() => { setFrom(""); setTo(""); setKind("all"); }}
          exports={onExport ? [{ label: "PDF or Excel", icon: Download, hint: "Pick the dates, then the file", onSelect: onExport }] : undefined}
          summary={summary.length > 0
            ? <StatStrip items={summary.map(s => ({ label: s.label, value: s.value, tone: TONE[s.tone ?? "neutral"], icon: s.icon, sub: s.sub }))} />
            : undefined}
          resetKey={JSON.stringify([q.trim(), from, to, kind])}
          id={`statement-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}
          noun="transaction"
          rows={onlyPinned ? pinned : entries}
          pinnedRows={onlyPinned ? undefined : pinned}
          columns={columns}
          rowKey={r => r.id}
          rowActions={rowActions}
          defaultSort={{ key: "date", dir: "desc" }}
          pageSizes={pageSize ? [pageSize, pageSize * 2, pageSize * 4] : undefined}
          emptyText={active ? "Nothing in that range." : emptyText}
          // Opened: what the particulars squeeze into one grey line, each on its
          // own — the type, order, bill and reference, quantity and rate — the
          // time of day, and whatever the page adds.
          details={r => {
            const extra = details?.(r) ?? [];
            // The time of day, unless the page's own "Recorded" already gives it.
            const time = extra.some(d => d.label === "Recorded") ? fmtDate(r.date) : when(r.date);
            return [
              ...filled([
                { label: "Type", value: r.kind },
                { label: "Order", value: r.orderNo },
                { label: "Bill / invoice", value: r.invoiceNo },
                !!r.ref && r.ref !== r.orderNo && r.ref !== r.invoiceNo && { label: "Reference", value: r.ref },
                !!r.qty && { label: "Quantity", value: `${r.qty}${r.unit ?? ""}` },
                !!r.rate && { label: "Rate", value: `${fmt(r.rate)}${r.unit ? `/${r.unit}` : ""}` },
                time !== fmtDate(r.date) && { label: "Time", value: time },
              ]),
              ...extra,
            ];
          }}
          // Totals only for a filtered view — it answers "how much in August?"
          // without exporting first. Unfiltered, the tiles above already say it,
          // and a second, differently-made total beside them would only confuse.
          totals={active ? {
            debit: () => <span className="text-destructive">{fmt(totalDebit)}</span>,
            ...(showCredit ? { credit: () => <span>{fmt(totalCredit)}</span> } : {}),
          } : undefined}
        />
      </div>
    </div>
  );
}
