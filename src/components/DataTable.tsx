import { Fragment, useMemo, useState, type MouseEvent, type ReactNode } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown, Check, ChevronDown, Columns3, Download, Search, ChevronLeft, ChevronRight, Minus, Rows3 } from "lucide-react";
import { useMayExport } from "@/hooks/useCan";
import { useNavigate } from "react-router-dom";
import { downloadCsv } from "@/lib/ledgerExport";
import {
  DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { MoreMenu, type MoreAction } from "@/components/MoreMenu";

/**
 * The app's one table: sort by any column, search, show or hide columns, row
 * spacing, Excel export and pages. Choices (sort, hidden columns, spacing,
 * rows per page) are remembered per table on this device. Every list of
 * records — expenses, payments, ledgers, people — is one of these, so they all
 * look and work the same.
 *
 * It shows rows; the page decides what a row opens (onRowClick), what can be
 * done to it (rowActions, a ⋯ at the end of the row) and whether rows can be
 * ticked (selected).
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
/** A click on something inside the row that does its own thing. */
const OWN_CLICK = "button,a,input,select,textarea,label,[role=menuitem],[role=checkbox],[data-no-row]";

/** The tick box, as the table draws it — also for a "select all" in its header. */
function Tick({ state, onClick, label }: { state: "on" | "off" | "some"; onClick: () => void; label: string }) {
  return (
    <button type="button" role="checkbox" aria-checked={state === "some" ? "mixed" : state === "on"} aria-label={label}
      onClick={e => { e.stopPropagation(); onClick(); }}
      className={`h-[18px] w-[18px] grid place-items-center rounded-[5px] border transition-colors ${state !== "off" ? "bg-primary border-primary text-white" : "bg-white border-border hover:border-primary text-transparent"}`}>
      {state === "some" ? <Minus className="h-3 w-3" /> : <Check className="h-3 w-3" />}
    </button>
  );
}

export function DataTable<T>({
  id, rows, columns, rowKey, defaultSort = null, searchText, exportName, emptyText = "Nothing to show.",
  pageSizes = [25, 50, 100], maxHeight, footer, toolbarExtra, onRowClick, rowActions, selected, onSelectedChange,
  rowClassName, controls = "full", noun = "row", plural, searchPlaceholder = "Search this table", totals, totalsLabel = "Total", expand, rowHref, pinnedRows, pinnedAt = "bottom", resetKey, canClickRow, details,
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
  emptyText?: ReactNode;
  pageSizes?: number[];
  /** Scroll inside the table, with the header held at the top. */
  maxHeight?: string;
  /** A totals row, below the rows (shown columns only). */
  footer?: (shown: DataColumn<T>[], rows: T[]) => ReactNode;
  /** The usual totals row: a figure under each column named here, worked
   *  out from the rows the search left; the label in the first column. */
  totals?: Partial<Record<string, (rows: T[]) => ReactNode>>;
  totalsLabel?: string;
  /** Rows that open to show more under them: what to show, and which rows have
   *  anything. Without onRowClick, a click on the row opens it too. */
  expand?: { render: (row: T) => ReactNode; can?: (row: T) => boolean };
  toolbarExtra?: ReactNode;
  /** Opens a row — the whole row is the button. */
  onRowClick?: (row: T) => void;
  /** The page a row opens (Ctrl/⌘-click: in a new tab). Instead of onRowClick. */
  rowHref?: (row: T) => string;
  /** Rows that are not records to sort or search — an opening balance, say.
   *  Shown on the last page (or the first, with pinnedAt "top"). */
  pinnedRows?: T[];
  pinnedAt?: "top" | "bottom";
  /** Changes when the page's own filters do: the table goes back to page 1
   *  (keeping its search, sort and open rows). */
  resetKey?: string | number;
  /** Which rows onRowClick / rowHref apply to; the rest don't look clickable. */
  canClickRow?: (row: T) => boolean;
  /** Every row opens to show all of itself under it — each column in full,
   *  hidden ones too, nothing cut off — plus these extra fields, for what the
   *  columns don't show (who recorded it, the full note, the time…). On by
   *  default; `false` turns it off. A table with its own `expand` shows that. */
  details?: false | ((row: T) => { label: string; value: ReactNode }[]);
  /** What can be done to a row: a ⋯ at its end. */
  rowActions?: (row: T) => MoreAction[];
  /** Tick boxes: the keys ticked, and what to do when they change. */
  selected?: Set<string>;
  onSelectedChange?: (next: Set<string>) => void;
  rowClassName?: (row: T) => string;
  /** "none": just the table — for a short list inside a card or dialog. */
  controls?: "full" | "none";
  /** What a row is, for the count: "expense" → "68 expenses". */
  noun?: string;
  /** When adding "s" is wrong: "factories", "entries". */
  plural?: string;
  searchPlaceholder?: string;
}) {
  const [prefs, setPrefs] = useState<Prefs>(() => read(id));
  const save = (p: Prefs) => { setPrefs(p); write(id, p); };
  const sort: Sort = prefs.sort === undefined ? defaultSort : prefs.sort;
  const hidden = new Set(prefs.hidden ?? columns.filter(c => c.hidden).map(c => c.key));
  const dense = prefs.dense ?? "normal";
  const pageSize = prefs.pageSize ?? pageSizes[0];
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [lastReset, setLastReset] = useState(resetKey);
  if (resetKey !== lastReset) { setLastReset(resetKey); setPage(1); }
  const full = controls === "full";
  const mayExport = useMayExport();
  const [open, setOpen] = useState<Set<string>>(new Set());
  const toggleOpen = (k: string) => setOpen(prev => { const n = new Set(prev); if (!n.delete(k)) n.add(k); return n; });
  const ticking = !!selected && !!onSelectedChange;

  const shown = columns.filter(c => c.always || !hidden.has(c.key));

  const filtered = useMemo(() => {
    const t = full ? q.trim().toLowerCase() : "";
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
  }, [rows, q, full, sort?.key, sort?.dir, columns, searchText]); // eslint-disable-line react-hooks/exhaustive-deps

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

  // Ticking: one row, or every row the search left (not just this page).
  const keysShown = filtered.map(rowKey);
  const tickedShown = ticking ? keysShown.filter(k => selected!.has(k)).length : 0;
  const allState: "on" | "off" | "some" = !tickedShown ? "off" : tickedShown === keysShown.length ? "on" : "some";
  const toggleRow = (k: string) => {
    const next = new Set(selected); if (!next.delete(k)) next.add(k); onSelectedChange!(next);
  };
  const toggleAll = () => {
    const next = new Set(selected);
    if (allState === "on") keysShown.forEach(k => next.delete(k)); else keysShown.forEach(k => next.add(k));
    onSelectedChange!(next);
  };
  const navigate = useNavigate();
  const auto = !expand && details !== false;
  const opener = !!expand || auto;
  const canOpen = (r: T) => expand ? (expand.can ? expand.can(r) : true) : auto;
  // A blank value is left out of the details rather than shown as an empty heading.
  const blank = (c: DataColumn<T>, r: T) => {
    if (!c.sortValue && !c.csv) return false;
    const v = c.csv ? c.csv(r) : c.sortValue!(r);
    return v === null || v === undefined || v === "";
  };
  const autoDetails = (r: T) => {
    const fields = [
      ...columns.filter(c => c.header && !blank(c, r)).map(c => ({ label: c.header, value: c.cell(r) })),
      ...(typeof details === "function" ? details(r) : []),
    ];
    return (
      <div className="dt-details grid gap-x-8 gap-y-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
        {fields.map((f, i) => (
          <div key={`${f.label}-${i}`} className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{f.label}</p>
            <div className="text-sm text-brand-dark mt-0.5 break-words">{f.value}</div>
          </div>
        ))}
      </div>
    );
  };
  const pageable = !!onRowClick || !!rowHref;
  const rowClick = (r: T) => (e: MouseEvent) => {
    if ((e.target as HTMLElement).closest(OWN_CLICK)) return;
    if (pageable && canClickRow && !canClickRow(r)) { if (canOpen(r)) toggleOpen(rowKey(r)); return; }
    if (rowHref) {
      const href = rowHref(r);
      if (e.ctrlKey || e.metaKey) window.open(href, "_blank", "noopener");
      else navigate(href);
    } else if (onRowClick) onRowClick(r);
    else if (canOpen(r)) toggleOpen(rowKey(r));
  };
  // On a phone the table scrolls sideways; what a row is stays in view.
  const firstKey = shown[0]?.key;
  const stick = "max-md:sticky max-md:z-[1] max-md:bg-white";
  const stickLeft = ticking ? "max-md:left-10" : "max-md:left-0";
  const cols = shown.length + (ticking ? 1 : 0) + (rowActions ? 1 : 0) + (opener ? 1 : 0);
  const countText = `${filtered.length} ${filtered.length === 1 ? noun : plural ?? (noun.endsWith("s") ? noun : `${noun}s`)}`;

  return (
    <div className="space-y-2">
      {full && (
      <div className="flex flex-wrap items-center gap-2">
        {searchText && (
          <div className="relative flex-1 min-w-[160px] max-w-xs">
            <Search className="h-3.5 w-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input value={q} onChange={e => { setQ(e.target.value); setPage(1); }} placeholder={searchPlaceholder} aria-label={searchPlaceholder}
              className="h-8 w-full rounded-lg border border-border bg-white pl-8 pr-2 text-xs focus:outline-none focus:ring-2 focus:ring-primary/30" />
          </div>
        )}
        <span className="text-[11px] text-muted-foreground">{countText}{q ? ` of ${rows.length}` : ""}{ticking && selected!.size ? ` · ${selected!.size} ticked` : ""}</span>
        {toolbarExtra}
        <div className="ml-auto flex items-center gap-1.5">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button type="button" className="h-8 px-2.5 inline-flex items-center gap-1.5 rounded-lg border border-border bg-white text-xs font-medium text-brand-dark hover:bg-secondary"><Rows3 className="h-3.5 w-3.5" /><span className="hidden sm:inline">Spacing</span></button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="rounded-xl">
              {(["compact", "normal", "spacious"] as const).map(d => (
                <DropdownMenuCheckboxItem key={d} checked={dense === d} onCheckedChange={() => save({ ...prefs, dense: d })} className="capitalize text-xs">{d}</DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button type="button" className="h-8 px-2.5 inline-flex items-center gap-1.5 rounded-lg border border-border bg-white text-xs font-medium text-brand-dark hover:bg-secondary"><Columns3 className="h-3.5 w-3.5" /><span className="hidden sm:inline">Columns</span></button>
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
          {exportName && mayExport && (
            <button type="button" onClick={exportCsv} className="h-8 px-2.5 inline-flex items-center gap-1.5 rounded-lg border border-border bg-white text-xs font-medium text-brand-dark hover:bg-secondary">
              <Download className="h-3.5 w-3.5" />Excel
            </button>
          )}
        </div>
      </div>
      )}

      {/* relative: the hidden column labels are placed inside this box, so
          they can't widen the page past a phone's screen. */}
      <div className="relative overflow-x-auto rounded-xl border border-border/60 bg-white" style={maxHeight ? { maxHeight, overflowY: "auto" } : undefined}>
        <table className="w-full text-sm">
          <thead className={`bg-secondary/40 ${maxHeight ? "sticky top-0 z-10" : ""}`}>
            <tr className="border-b border-border/60">
              {ticking && (
                <th className={`w-10 px-3 py-3 ${stick} max-md:left-0 max-md:bg-secondary`}>
                  {keysShown.length > 0 && <Tick state={allState} onClick={toggleAll} label={allState === "on" ? "Untick all" : `Tick all ${keysShown.length}`} />}
                </th>
              )}
              {shown.map(c => {
                const on = sort?.key === c.key;
                return (
                  <th key={c.key} title={hint(c)}
                    className={`px-3 py-3 text-[11px] font-bold uppercase tracking-wider whitespace-nowrap ${alignCls(c.align)} ${on ? "dt-sorted text-primary bg-primary/[0.06] shadow-[inset_0_-2px_0_var(--color-primary)]" : "text-brand-dark/70"} ${c.sortValue ? "cursor-pointer select-none hover:text-primary hover:bg-primary/[0.04] transition-colors" : ""} ${c.key === firstKey ? `${stick} ${stickLeft} max-md:bg-secondary` : ""}`}
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
              {opener && <th className="w-10 px-2 py-3"><span className="sr-only">Details</span></th>}
              {rowActions && <th className="w-12 px-2 py-3"><span className="sr-only">Actions</span></th>}
            </tr>
          </thead>
          <tbody>
            {[...(pinnedAt === "top" && cur === 1 ? pinnedRows ?? [] : []), ...visible, ...(pinnedAt === "bottom" && cur === pages && !q ? pinnedRows ?? [] : [])].map(r => {
              const k = rowKey(r);
              const pin = !!pinnedRows?.includes(r);
              const on = !pin && ticking && selected!.has(k);
              const opens = !pin && canOpen(r), isOpen = opens && open.has(k);
              const opensPage = !pin && pageable && (canClickRow ? canClickRow(r) : true);
              return (
                <Fragment key={k}>
                <tr onClick={!pin && (opensPage || opens) ? rowClick(r) : undefined}
                  className={`group transition-colors ${pin ? "bg-secondary/25 italic" : on ? "bg-primary/[0.05]" : "hover:bg-secondary/30"} ${!pin && (opensPage || opens) ? "cursor-pointer" : ""} ${isOpen ? "bg-secondary/30" : ""} ${rowClassName?.(r) ?? ""}`}>
                  {ticking && <td className={`w-10 px-3 ${PAD[dense]} ${stick} max-md:left-0`}>{!pin && <Tick state={on ? "on" : "off"} onClick={() => toggleRow(k)} label={on ? "Untick this row" : "Tick this row"} />}</td>}
                  {shown.map(c => (
                    <td key={c.key} className={`px-3 ${PAD[dense]} ${alignCls(c.align)} ${sort?.key === c.key ? "bg-primary/[0.03]" : ""} ${c.key === firstKey ? `${stick} ${stickLeft}` : ""} ${c.className ?? ""}`}>{c.cell(r)}</td>
                  ))}
                  {opener && (
                    <td className={`w-10 px-2 ${PAD[dense]} text-center`}>
                      {opens && (
                        <button type="button" onClick={e => { e.stopPropagation(); toggleOpen(k); }} aria-expanded={isOpen} aria-label={isOpen ? "Hide details" : "Show details"}
                          className="h-7 w-7 inline-grid place-items-center rounded-lg text-muted-foreground hover:bg-secondary hover:text-foreground">
                          <ChevronDown className={`h-4 w-4 transition-transform ${isOpen ? "rotate-180" : ""}`} />
                        </button>
                      )}
                    </td>
                  )}
                  {rowActions && (
                    <td className={`w-12 px-2 ${PAD[dense]} text-right`} data-no-row>
                      {!pin && <MoreMenu size="sm" label="Row actions" actions={rowActions(r)} className="opacity-70 group-hover:opacity-100 focus-visible:opacity-100" />}
                    </td>
                  )}
                </tr>
                {isOpen && (
                  <tr className="bg-secondary/20">
                    <td colSpan={cols} className="px-3 sm:px-5 py-4">{expand ? expand.render(r) : autoDetails(r)}</td>
                  </tr>
                )}
                </Fragment>
              );
            })}
            {!visible.length && (
              <tr><td colSpan={cols} className="px-3 py-12 text-center text-sm text-muted-foreground">{q ? "No row matches the search." : emptyText}</td></tr>
            )}
          </tbody>
          {footer && filtered.length > 0 && <tfoot className="border-t-2 border-border/70 bg-secondary/30">{footer(shown, filtered)}</tfoot>}
          {!footer && totals && filtered.length > 0 && (
            <tfoot className="border-t-2 border-border/70 bg-secondary/30">
              <tr>
                {ticking && <td className={`w-10 ${stick} max-md:left-0 max-md:bg-secondary`} />}
                {shown.map((c, i) => (
                  <td key={c.key} className={`px-3 py-2.5 ${alignCls(c.align)} font-bold text-brand-dark ${c.key === firstKey ? `${stick} ${stickLeft} max-md:bg-secondary` : ""}`}>
                    {totals[c.key] ? <span className="tabular-nums whitespace-nowrap">{totals[c.key]!(filtered)}</span>
                      : i === 0 ? <span className="text-xs uppercase tracking-wider">{totalsLabel}{filtered.length !== rows.length ? ` (${filtered.length})` : ""}</span> : null}
                  </td>
                ))}
                {opener && <td />}
                {rowActions && <td />}
              </tr>
            </tfoot>
          )}
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

/* ── Cells: the same look in every table ─────────────────────────────────── */

/** What a row is: a name in bold, a quieter line under it. */
export function CellMain({ title, sub, className = "" }: { title: ReactNode; sub?: ReactNode; className?: string }) {
  return (
    <div className={`min-w-0 ${className}`}>
      <p className="font-medium text-brand-dark leading-snug truncate max-w-[22rem]" title={typeof title === "string" ? title : undefined}>{title}</p>
      {sub && <p className="text-[11px] text-muted-foreground leading-snug truncate max-w-[22rem] mt-0.5" title={typeof sub === "string" ? sub : undefined}>{sub}</p>}
    </div>
  );
}

/** A small label in a cell: a category, a status, who it was paid to. */
export function CellTag({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "green" | "red" | "amber" | "blue" | "violet" }) {
  const t = {
    neutral: "bg-secondary text-foreground/75 ring-border/70",
    green: "bg-success/10 text-success ring-success/25",
    red: "bg-destructive/10 text-destructive ring-destructive/25",
    amber: "bg-amber-500/10 text-amber-800 ring-amber-500/25",
    blue: "bg-primary/10 text-primary ring-primary/25",
    violet: "bg-violet-500/10 text-violet-700 ring-violet-500/25",
  }[tone];
  return <span className={`inline-flex items-center whitespace-nowrap text-[11px] font-medium px-2 py-0.5 rounded-full ring-1 ${t}`}>{children}</span>;
}

/** An amount: figures lined up; red for money out, green for money in. */
export function CellAmount({ children, tone }: { children: ReactNode; tone?: "in" | "out" }) {
  return <span className={`tabular-nums whitespace-nowrap font-semibold ${tone === "out" ? "text-destructive" : tone === "in" ? "text-success" : "text-brand-dark"}`}>{children}</span>;
}

/** A date, never broken across lines. */
export function CellDate({ children }: { children: ReactNode }) {
  return <span className="whitespace-nowrap text-muted-foreground tabular-nums">{children}</span>;
}
