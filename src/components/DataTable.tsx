import { useMemo, useState, type ReactNode } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown, Columns3, Download, Search, ChevronLeft, ChevronRight, Rows3 } from "lucide-react";
import { downloadCsv } from "@/lib/ledgerExport";
import {
  DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/**
 * A full data table: sort by any column, search, show or hide columns, row
 * spacing, Excel export and pages. Choices (sort, hidden columns, spacing,
 * rows per page) are remembered per table on this device.
 *
 * Read-only by design: it shows rows, the page decides what a row links to.
 */
export interface DataColumn<T> {
  key: string;
  header: string;
  cell: (row: T) => ReactNode;
  /** What the column sorts by; no sort without it. */
  sortValue?: (row: T) => string | number | null | undefined;
  /** What goes in the Excel file; the sort value, or nothing, without it. */
  csv?: (row: T) => string | number;
  align?: "left" | "right" | "center";
  /** Starts hidden (can be shown from Columns). */
  hidden?: boolean;
  /** Can't be hidden — the column that says what a row is. */
  always?: boolean;
  /** Which way the first click sorts. Amounts and dates start high → low
   *  (biggest, newest on top); text starts A → Z. Defaults by alignment. */
  sortFirst?: "asc" | "desc";
  /** A date or an amount — reads "newest first" / "high → low" in the hint. */
  kind?: "date" | "number" | "text";
  className?: string;
}

type Sort = { key: string; dir: "asc" | "desc" } | null;
type Prefs = { sort?: Sort; hidden?: string[]; dense?: "compact" | "normal" | "spacious"; pageSize?: number };

const read = (id: string): Prefs => { try { return JSON.parse(localStorage.getItem(`dt:${id}`) || "{}"); } catch { return {}; } };
const write = (id: string, p: Prefs) => { try { localStorage.setItem(`dt:${id}`, JSON.stringify(p)); } catch { /* private window */ } };

const PAD = { compact: "py-1.5", normal: "py-2.5", spacious: "py-3.5" } as const;

export function DataTable<T>({
  id, rows, columns, rowKey, defaultSort = null, searchText, exportName, emptyText = "Nothing to show.",
  pageSizes = [25, 50, 100], maxHeight, footer, toolbarExtra, onRowClick,
}: {
  /** Names this table's remembered choices — unique per table. */
  id: string;
  rows: T[];
  columns: DataColumn<T>[];
  rowKey: (row: T) => string;
  defaultSort?: Sort;
  /** Text a row is searched by; no search box without it. */
  searchText?: (row: T) => string;
  /** File name for the Excel download; no download without it. */
  exportName?: string;
  emptyText?: string;
  pageSizes?: number[];
  /** Scroll inside the table, with the header held at the top. */
  maxHeight?: string;
  /** A totals row, below the rows (shown columns only). */
  footer?: (shown: DataColumn<T>[], rows: T[]) => ReactNode;
  toolbarExtra?: ReactNode;
  /** Opens a row — the whole row is the button. */
  onRowClick?: (row: T) => void;
}) {
  const [prefs, setPrefs] = useState<Prefs>(() => read(id));
  const save = (p: Prefs) => { setPrefs(p); write(id, p); };
  const sort: Sort = prefs.sort === undefined ? defaultSort : prefs.sort;
  const hidden = new Set(prefs.hidden ?? columns.filter(c => c.hidden).map(c => c.key));
  const dense = prefs.dense ?? "normal";
  const pageSize = prefs.pageSize ?? pageSizes[0];
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);

  const shown = columns.filter(c => c.always || !hidden.has(c.key));

  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    let list = t && searchText ? rows.filter(r => searchText(r).toLowerCase().includes(t)) : rows.slice();
    const col = sort && columns.find(c => c.key === sort.key);
    if (col?.sortValue) {
      const dir = sort!.dir === "asc" ? 1 : -1;
      const val = col.sortValue;
      list = list
        .map((r, i) => ({ r, i, v: val(r) }))
        .sort((a, b) => {
          // Blanks always last, whichever way round.
          const an = a.v === null || a.v === undefined || a.v === "", bn = b.v === null || b.v === undefined || b.v === "";
          if (an || bn) return an === bn ? a.i - b.i : an ? 1 : -1;
          const c = typeof a.v === "number" && typeof b.v === "number" ? a.v - b.v : String(a.v).localeCompare(String(b.v), undefined, { numeric: true, sensitivity: "base" });
          return c === 0 ? a.i - b.i : c * dir;
        })
        .map(x => x.r);
    }
    return list;
  }, [rows, q, sort?.key, sort?.dir, columns, searchText]); // eslint-disable-line react-hooks/exhaustive-deps

  const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const cur = Math.min(page, pages);
  const visible = filtered.slice((cur - 1) * pageSize, cur * pageSize);

  // First click: the column's natural way (amounts and dates high → low).
  // Second: the other way. Third: back to the table's own order.
  const firstOf = (c: DataColumn<T>) => c.sortFirst ?? (c.align === "right" || c.kind === "number" || c.kind === "date" ? "desc" : "asc");
  const clickSort = (c: DataColumn<T>) => {
    if (!c.sortValue) return;
    const first = firstOf(c);
    const next: Sort = !sort || sort.key !== c.key ? { key: c.key, dir: first }
      : sort.dir === first ? { key: c.key, dir: first === "asc" ? "desc" : "asc" }
      : defaultSort;
    save({ ...prefs, sort: next });
  };
  const words = (c: DataColumn<T>, dir: "asc" | "desc") => {
    const k = c.kind ?? (c.align === "right" ? "number" : "text");
    if (k === "date") return dir === "desc" ? "newest first" : "oldest first";
    if (k === "number") return dir === "desc" ? "high to low" : "low to high";
    return dir === "asc" ? "A to Z" : "Z to A";
  };
  const hint = (c: DataColumn<T>) => {
    if (!c.sortValue) return undefined;
    const on = sort?.key === c.key;
    const first = firstOf(c);
    if (!on) return `Sort ${words(c, first)}`;
    return sort!.dir === first ? `Sorted ${words(c, first)} — click for ${words(c, first === "asc" ? "desc" : "asc")}` : `Sorted ${words(c, sort!.dir)} — click to reset`;
  };
  const toggleCol = (k: string) => {
    const h = new Set(hidden);
    if (h.has(k)) h.delete(k); else h.add(k);
    save({ ...prefs, hidden: [...h] });
  };
  const exportCsv = () => {
    if (!exportName) return;
    const cols = shown.filter(c => c.csv || c.sortValue);
    downloadCsv(`${exportName}.csv`, cols.map(c => c.header),
      filtered.map(r => cols.map(c => { const v = c.csv ? c.csv(r) : c.sortValue!(r); return v ?? ""; })));
  };
  const alignCls = (a?: string) => (a === "right" ? "text-right" : a === "center" ? "text-center" : "text-left");

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        {searchText && (
          <div className="relative flex-1 min-w-[160px] max-w-xs">
            <Search className="h-3.5 w-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input value={q} onChange={e => { setQ(e.target.value); setPage(1); }} placeholder="Search this table"
              className="h-8 w-full rounded-lg border border-border bg-white pl-8 pr-2 text-xs focus:outline-none focus:ring-2 focus:ring-primary/30" />
          </div>
        )}
        <span className="text-[11px] text-muted-foreground">{filtered.length} row{filtered.length !== 1 ? "s" : ""}{q ? ` of ${rows.length}` : ""}</span>
        {toolbarExtra}
        <div className="ml-auto flex items-center gap-1.5">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button type="button" className="h-8 px-2.5 inline-flex items-center gap-1.5 rounded-lg border border-border bg-white text-xs font-medium text-brand-dark hover:bg-secondary"><Rows3 className="h-3.5 w-3.5" />Spacing</button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="rounded-xl">
              {(["compact", "normal", "spacious"] as const).map(d => (
                <DropdownMenuCheckboxItem key={d} checked={dense === d} onCheckedChange={() => save({ ...prefs, dense: d })} className="capitalize text-xs">{d}</DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button type="button" className="h-8 px-2.5 inline-flex items-center gap-1.5 rounded-lg border border-border bg-white text-xs font-medium text-brand-dark hover:bg-secondary"><Columns3 className="h-3.5 w-3.5" />Columns</button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="rounded-xl w-52">
              <DropdownMenuLabel className="text-[10px] uppercase tracking-wider text-muted-foreground">Show columns</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {columns.map(c => (
                <DropdownMenuCheckboxItem key={c.key} checked={c.always || !hidden.has(c.key)} disabled={c.always}
                  onCheckedChange={() => toggleCol(c.key)} onSelect={e => e.preventDefault()} className="text-xs">{c.header}</DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          {exportName && (
            <button type="button" onClick={exportCsv} className="h-8 px-2.5 inline-flex items-center gap-1.5 rounded-lg border border-border bg-white text-xs font-medium text-brand-dark hover:bg-secondary">
              <Download className="h-3.5 w-3.5" />Excel
            </button>
          )}
        </div>
      </div>

      <div className="overflow-x-auto rounded-xl border border-border/60 bg-white" style={maxHeight ? { maxHeight, overflowY: "auto" } : undefined}>
        <table className="w-full text-sm">
          <thead className={maxHeight ? "sticky top-0 z-10 bg-white" : undefined}>
            <tr>
              {shown.map(c => {
                const on = sort?.key === c.key;
                return (
                  <th key={c.key} title={hint(c)}
                    className={`px-3 py-3 text-[11px] font-bold uppercase tracking-wider whitespace-nowrap ${alignCls(c.align)} ${on ? "dt-sorted text-primary bg-primary/[0.06] shadow-[inset_0_-2px_0_var(--color-primary)]" : "text-brand-dark/70"} ${c.sortValue ? "cursor-pointer select-none hover:text-primary hover:bg-primary/[0.04] transition-colors" : ""}`}
                    onClick={() => clickSort(c)} aria-sort={on ? (sort!.dir === "asc" ? "ascending" : "descending") : undefined}>
                    <span className={`inline-flex items-center gap-1 ${c.align === "right" ? "flex-row-reverse" : ""}`}>
                      {c.header}
                      {c.sortValue && (on
                        ? (sort!.dir === "asc" ? <ArrowUp className="h-3 w-3 text-primary" /> : <ArrowDown className="h-3 w-3 text-primary" />)
                        : <ArrowUpDown className="h-3 w-3 opacity-30" />)}
                    </span>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {visible.map(r => (
              <tr key={rowKey(r)} onClick={onRowClick ? () => onRowClick(r) : undefined}
                className={`hover:bg-secondary/30 transition-colors ${onRowClick ? "cursor-pointer" : ""}`}>
                {shown.map(c => <td key={c.key} className={`px-3 ${PAD[dense]} ${alignCls(c.align)} ${sort?.key === c.key ? "bg-primary/[0.03]" : ""} ${c.className ?? ""}`}>{c.cell(r)}</td>)}
              </tr>
            ))}
            {!visible.length && (
              <tr><td colSpan={shown.length} className="px-3 py-10 text-center text-xs text-muted-foreground">{q ? "No row matches the search." : emptyText}</td></tr>
            )}
          </tbody>
          {footer && filtered.length > 0 && <tfoot>{footer(shown, filtered)}</tfoot>}
        </table>
      </div>

      {filtered.length > pageSizes[0] && (
        <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted-foreground">
          <span>
            Rows per page{" "}
            <select value={pageSize} onChange={e => { save({ ...prefs, pageSize: Number(e.target.value) }); setPage(1); }}
              className="h-7 rounded-md border border-border bg-white px-1 text-[11px]">
              {pageSizes.map(n => <option key={n} value={n}>{n}</option>)}
            </select>
          </span>
          <span className="inline-flex items-center gap-1.5">
            {(cur - 1) * pageSize + 1}–{Math.min(cur * pageSize, filtered.length)} of {filtered.length}
            <button type="button" disabled={cur <= 1} onClick={() => setPage(cur - 1)} className="h-7 w-7 grid place-items-center rounded-md border border-border bg-white disabled:opacity-40" aria-label="Previous page"><ChevronLeft className="h-3.5 w-3.5" /></button>
            <button type="button" disabled={cur >= pages} onClick={() => setPage(cur + 1)} className="h-7 w-7 grid place-items-center rounded-md border border-border bg-white disabled:opacity-40" aria-label="Next page"><ChevronRight className="h-3.5 w-3.5" /></button>
          </span>
        </div>
      )}
    </div>
  );
}
