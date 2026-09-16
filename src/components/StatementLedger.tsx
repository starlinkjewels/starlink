import { useMemo, useState, type ReactNode } from "react";
import { fmtDate } from "@/lib/db";
import { usePagination } from "@/hooks/usePagination";
import { PaginationBar } from "@/components/PaginationBar";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowDownCircle, ArrowUpCircle, Search, Download } from "lucide-react";

export interface StatementRow {
  id: string;
  date: string;
  /** What happened, in words — "Purchase — 5g 22K gold (Inv 8821)". */
  particulars: string;
  /** The document it belongs to: order no., invoice no., stock no. */
  ref?: string;
  debit: number;
  credit: number;
  /** Running balance AFTER this row. Computed by the caller, which knows the
   *  opening balance and the order rows should be read in. */
  balance: number;
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
  pageSize = 12,
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

  const { paged, page, setPage, totalPages, start, end } = usePagination(filtered, pageSize);
  const active = !!q.trim() || !!from || !!to || kind !== "all";
  const totalDebit = filtered.reduce((s, r) => s + r.debit, 0);
  const totalCredit = filtered.reduce((s, r) => s + r.credit, 0);
  // A salary ledger only ever pays out — an empty credit label drops the column
  // rather than printing a blank one next to every row.
  const showCredit = creditLabel !== "";

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
          <button onClick={onExport}
            className="flex items-center gap-1.5 h-9 px-3 rounded-xl border border-border bg-white hover:bg-secondary text-xs font-medium text-brand-dark shrink-0">
            <Download className="h-4 w-4" /> Export
          </button>
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
          <Input value={q} onChange={e => { setQ(e.target.value); setPage(1); }}
            placeholder="Search particulars or reference…" className="rounded-xl h-9 pl-9" />
        </div>
        <Input type="date" value={from} onChange={e => { setFrom(e.target.value); setPage(1); }}
          className="rounded-xl h-9 w-auto" />
        <span className="text-xs text-muted-foreground">to</span>
        <Input type="date" value={to} onChange={e => { setTo(e.target.value); setPage(1); }}
          className="rounded-xl h-9 w-auto" />
        {kinds.length > 1 && (
          <Select value={kind} onValueChange={v => { setKind(v); setPage(1); }}>
            <SelectTrigger className="h-9 rounded-xl w-auto min-w-[130px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All types</SelectItem>
              {kinds.map(k => <SelectItem key={k} value={k}>{k}</SelectItem>)}
            </SelectContent>
          </Select>
        )}
        {active && (
          <button onClick={() => { setQ(""); setFrom(""); setTo(""); setKind("all"); setPage(1); }}
            className="text-xs text-primary hover:underline">Reset</button>
        )}
      </div>

      {/* Totals for what is on screen — a filtered view answers "how much in
          August?" without exporting it first. */}
      {active && filtered.length > 0 && (
        <div className="px-5 pb-2 text-[11px] text-muted-foreground">
          {filtered.length} of {rows.length} shown ·
          <span className="text-destructive font-medium"> {debitLabel} {fmt(totalDebit)}</span>
          {showCredit && <span className="text-success font-medium"> · {creditLabel} {fmt(totalCredit)}</span>}
        </div>
      )}

      {paged.length > 0 && (
        <div className="hidden sm:flex items-center gap-3 px-5 pb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          <div className="h-8 w-8 shrink-0" />
          <div className="flex-1 min-w-0">Particulars</div>
          <div className="w-24 text-right shrink-0">{debitLabel}</div>
          {showCredit && <div className="w-24 text-right shrink-0">{creditLabel}</div>}
          <div className="w-24 text-right shrink-0">Balance</div>
        </div>
      )}

      <div className="divide-y divide-border/40">
        {paged.length === 0 ? (
          <div className="px-5 py-10 text-center text-sm text-muted-foreground">
            {active ? "Nothing in that range." : emptyText}
          </div>
        ) : paged.map(r => (
          <div key={r.id} className="flex items-center gap-3 px-5 py-3">
            <div className={`h-8 w-8 rounded-lg grid place-items-center shrink-0 ${
              r.debit > 0 ? "bg-destructive/10 text-destructive" : "bg-success/10 text-success"}`}>
              {r.debit > 0 ? <ArrowUpCircle className="h-4 w-4" /> : <ArrowDownCircle className="h-4 w-4" />}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">{r.particulars}</p>
              <p className="text-xs text-muted-foreground truncate">
                {fmtDate(r.date)}{r.ref ? ` · ${r.ref}` : ""}{r.kind ? ` · ${r.kind}` : ""}
              </p>
            </div>
            <div className="w-24 text-right shrink-0 hidden sm:block">
              {r.debit > 0 && <span className="text-sm font-semibold text-destructive">{fmt(r.debit)}</span>}
            </div>
            {showCredit && <div className="w-24 text-right shrink-0 hidden sm:block">
              {r.credit > 0 && <span className="text-sm font-semibold text-success">{fmt(r.credit)}</span>}
            </div>}
            <div className="w-24 text-right shrink-0">
              <p className="text-sm font-semibold text-foreground sm:hidden">
                <span className={r.debit > 0 ? "text-destructive" : "text-success"}>
                  {r.debit > 0 ? fmt(r.debit) : fmt(r.credit)}
                </span>
              </p>
              <p className="text-sm font-medium text-foreground hidden sm:block">{fmt(r.balance)}</p>
              <p className="text-[11px] text-muted-foreground sm:hidden">Bal {fmt(r.balance)}</p>
            </div>
            {rowAction?.(r)}
          </div>
        ))}
      </div>

      <div className="px-5">
        <PaginationBar page={page} totalPages={totalPages} onPageChange={setPage}
          label={filtered.length ? `Showing ${start + 1}–${end} of ${filtered.length}` : undefined} />
      </div>
    </div>
  );
}
