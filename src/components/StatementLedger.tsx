import { useMemo, useState, type ReactNode } from "react";
import { fmtDate } from "@/lib/db";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Search, Download } from "lucide-react";
import { IfExport } from "@/components/IfExport";
import { DataTable, CellMain, CellAmount, CellDate, type DataColumn } from "@/components/DataTable";

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
}

const TONE: Record<NonNullable<StatementSummary["tone"]>, string> = {
  neutral: "bg-secondary/60 text-brand-dark",
  in: "bg-success/10 text-success",
  out: "bg-destructive/10 text-destructive",
  due: "bg-warning/10 text-warning",
};

/**
 * One account statement, everywhere: a supplier's dues, a factory's charges, a
 * client's billing, an employee's salary. Summary first, then the filters, then
 * every entry with Debit / Credit / a running balance — the same ledger people
 * already read on the Stock and Locker pages, instead of each page inventing
 * its own flat list.
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
      cell: (r: StatementRow) => (r.credit > 0 ? <CellAmount tone="in">{fmt(r.credit)}</CellAmount> : null) }] : []),
    { key: "balance", header: "Balance", align: "right", kind: "number", sortValue: r => r.balance,
      cell: r => <CellAmount>{fmt(r.balance)}</CellAmount> },
    // rowAction hands back its own control (a button, say), not menu items,
    // so it gets a cell of its own rather than the ⋯ menu.
    ...(rowAction ? [{ key: "action", header: "Action", align: "right" as const, cell: (r: StatementRow) => rowAction(r) }] : []),
  ];

  return (
    <div className="card-luxe overflow-hidden">
      <div className="px-5 py-4 border-b border-border/60 flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="font-display text-xl text-brand-dark">{title}</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            {caption ?? `${rows.length} entr${rows.length !== 1 ? "ies" : "y"}`}
          </p>
        </div>
        {onExport && (
          <IfExport>
          <button onClick={onExport}
            className="flex items-center gap-1.5 h-9 px-3 rounded-xl border border-border bg-white hover:bg-secondary text-xs font-medium text-brand-dark shrink-0">
            <Download className="h-4 w-4" /> Export
          </button>
          </IfExport>
        )}
      </div>

      {summary.length > 0 && (
        <div className="px-5 pt-4 grid grid-cols-2 lg:grid-cols-4 gap-2.5">
          {summary.map(s => (
            <div key={s.label} className={`rounded-xl p-3 text-center ${TONE[s.tone ?? "neutral"]}`}>
              <p className="text-[10px] uppercase tracking-wider opacity-70">{s.label}</p>
              <p className="text-base font-semibold mt-0.5">{s.value}</p>
            </div>
          ))}
        </div>
      )}

      <div className="px-5 py-3 flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[180px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input value={q} onChange={e => { setQ(e.target.value); }}
            placeholder="Search particulars or reference…" className="rounded-xl h-9 pl-9" />
        </div>
        <Input type="date" value={from} onChange={e => { setFrom(e.target.value); }}
          className="rounded-xl h-9 w-auto" />
        <span className="text-xs text-muted-foreground">to</span>
        <Input type="date" value={to} onChange={e => { setTo(e.target.value); }}
          className="rounded-xl h-9 w-auto" />
        {kinds.length > 1 && (
          <Select value={kind} onValueChange={v => { setKind(v); }}>
            <SelectTrigger className="h-9 rounded-xl w-auto min-w-[130px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All types</SelectItem>
              {kinds.map(k => <SelectItem key={k} value={k}>{k}</SelectItem>)}
            </SelectContent>
          </Select>
        )}
        {active && (
          <span className="text-[11px] text-muted-foreground">{filtered.length} of {rows.length} shown</span>
        )}
        {active && (
          <button onClick={() => { setQ(""); setFrom(""); setTo(""); setKind("all"); }}
            className="text-xs text-primary hover:underline">Reset</button>
        )}
      </div>

      <div className="px-5 pb-5">
        <DataTable
          id={`statement-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}
          noun="transaction"
          rows={onlyPinned ? pinned : entries}
          pinnedRows={onlyPinned ? undefined : pinned}
          columns={columns}
          rowKey={r => r.id}
          defaultSort={{ key: "date", dir: "desc" }}
          pageSizes={pageSize ? [pageSize, pageSize * 2, pageSize * 4] : undefined}
          emptyText={active ? "Nothing in that range." : emptyText}
          // Totals only for a filtered view — it answers "how much in August?"
          // without exporting first. Unfiltered, the tiles above already say it,
          // and a second, differently-made total beside them would only confuse.
          totals={active ? {
            debit: () => <span className="text-destructive">{fmt(totalDebit)}</span>,
            ...(showCredit ? { credit: () => <span className="text-success">{fmt(totalCredit)}</span> } : {}),
          } : undefined}
        />
      </div>
    </div>
  );
}
