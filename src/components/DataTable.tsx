import { Fragment, useEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown, Check, ChevronDown, FileSpreadsheet, Inbox, Search, SearchX, ChevronLeft, ChevronRight, Minus, Plus, X } from "lucide-react";
import { useStudio } from "@/lib/studio";
import { useMayExport } from "@/hooks/useCan";
import { useNavigate } from "react-router-dom";
import { downloadCsv } from "@/lib/ledgerExport";
import { MoreMenu, type MoreAction } from "@/components/MoreMenu";
import { ExportMenu, FilterChips, FiltersButton, ViewMenu, activeFilterCount, useNarrow, type Density, type TableExport, type TableFilter } from "@/components/TableToolbar";
import { FloatingScrollbar, useWideScroll } from "@/components/WideScroll";
import { useHeldHeader } from "@/components/TableBox";

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
  /** Left out while it is empty on every row (a voucher number no entry has
   *  yet) — only for a column whose cell shows nothing more than its value;
   *  never for one that also draws a warning or a note. */
  hideIfEmpty?: boolean;
  /** A date or an amount — reads "newest first" / "high → low" in the hint. */
  kind?: "date" | "number" | "text";
  className?: string;
}

type Sort = { key: string; dir: "asc" | "desc" } | null;
type Prefs = { sort?: Sort; hidden?: string[]; dense?: Density; pageSize?: number; layout?: "cards" | "table"; forced?: string[] };

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
  pageSizes = [25, 50, 100], maxHeight, footer, toolbarExtra, onRowClick, rowActions, onRowActionsOpen, selected, onSelectedChange,
  rowClassName, controls = "full", noun = "row", plural, searchPlaceholder = "Search this table", totals, totalsLabel = "Total", expand, rowHref, pinnedRows, pinnedAt = "bottom", resetKey, canClickRow, details,
  search, filters, onClearFilters, exports, exportScope, summary, loading, emptyAction,
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
  /** A row's ⋯ is being opened — for loading what its items need only then. */
  onRowActionsOpen?: (row: T) => void;
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
  /** The page's own search, when the page narrows the rows itself (a ledger
   *  that also works out balances) — shown in the table's toolbar. */
  search?: { value: string; onChange: (v: string) => void; placeholder?: string; ariaLabel?: string };
  /** What else narrows the rows: behind one Filters button, shown as chips. */
  filters?: TableFilter[];
  onClearFilters?: () => void;
  /** Downloads the page makes itself (a PDF); with exportName's Excel, one Export menu. */
  exports?: TableExport[];
  /** What the downloads hold, when it isn't "what the table shows" — a page
   *  whose own PDF leaves the search out says so here. */
  exportScope?: string;
  /** A line of figures between the toolbar and the table — opening, in, out. */
  summary?: ReactNode;
  /** The rows are still on their way: placeholder rows instead of "nothing here". */
  loading?: boolean;
  /** The next step when there is nothing yet ("Add a client") — offered in the empty list (new look). */
  emptyAction?: { label: string; onClick: () => void };
}) {
  const [prefs, setPrefs] = useState<Prefs>(() => read(id));
  const save = (p: Prefs) => { setPrefs(p); write(id, p); };
  const sort: Sort = prefs.sort === undefined ? defaultSort : prefs.sort;
  const hidden = new Set(prefs.hidden ?? columns.filter(c => c.hidden).map(c => c.key));
  const dense = prefs.dense ?? "normal";
  // Chosen for this table in its View menu: wins over the row spacing set for every table (Settings → Table Style).
  const padCls = prefs.dense ? `dt-pad-${prefs.dense}` : "";
  const pageSize = prefs.pageSize ?? pageSizes[0];
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [lastReset, setLastReset] = useState(resetKey);
  // How wide the table's box shows, so an opened row's details fit it even
  // when the table itself is wider and scrolls sideways.
  const boxRef = useRef<HTMLDivElement>(null);
  const [boxW, setBoxW] = useState<number>();
  // On a phone a list reads best as cards — what the row is, its few key
  // figures, ⋯ — not a table to slide sideways. View → Table brings it back.
  // A table set inside a page without its toolbar (an order's materials, a
  // piece's history) is cards on a phone too — it used to stay a wide table
  // that had to be slid sideways, with no View to change it.
  const narrow = useNarrow();
  const canCards = narrow && !footer;
  const cardMode = canCards && (prefs.layout ?? "cards") === "cards";
  // The new look (preview): a phone list of slim rows, and a next step in an empty list.
  const studio = useStudio();
  useEffect(() => {
    const el = boxRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => setBoxW(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, [cardMode]);
  if (resetKey !== lastReset) { setLastReset(resetKey); setPage(1); }
  const full = controls === "full";
  const mayExport = useMayExport();
  const [open, setOpen] = useState<Set<string>>(new Set());
  const toggleOpen = (k: string) => setOpen(prev => { const n = new Set(prev); if (!n.delete(k)) n.add(k); return n; });
  const ticking = !!selected && !!onSelectedChange;

  // A column with nothing in it on any row (a voucher number no entry has)
  // only takes room: it stays out until asked for in View.
  const emptyCols = useMemo(() => {
    const out = new Set<string>();
    if (rows.length < 2) return out;
    for (const c of columns.slice(1)) {
      if (!c.hideIfEmpty || c.always || (!c.sortValue && !c.csv)) continue;
      const nothing = rows.every(r => {
        const v = c.csv ? c.csv(r) : c.sortValue!(r);
        return v === null || v === undefined || v === "" || v === "—" || v === "–";
      });
      if (nothing) out.add(c.key);
    }
    return out;
  }, [rows, columns]);
  const forced = new Set(prefs.forced ?? []);
  const isShown = (k: string) => !hidden.has(k) && (!emptyCols.has(k) || forced.has(k));
  const shown = columns.filter(c => c.always || isShown(c.key));

  const filtered = useMemo(() => {
    const t = full && !search ? q.trim().toLowerCase() : "";
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
  }, [rows, q, full, !!search, sort?.key, sort?.dir, columns, searchText]); // eslint-disable-line react-hooks/exhaustive-deps

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
    if (emptyCols.has(k)) {
      // An empty column: shown only on request, and the request remembered.
      const f = new Set(forced), h = new Set(hidden);
      if (f.has(k) && !h.has(k)) f.delete(k); else { f.add(k); h.delete(k); }
      save({ ...prefs, forced: [...f], hidden: [...h] });
      return;
    }
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
  // No empty column of openers when no row in the table has anything to open.
  const opener = (!!expand && (!expand.can || rows.some(r => expand.can!(r)))) || auto;
  const canOpen = (r: T) => expand ? (expand.can ? expand.can(r) : true) : auto;
  // A blank value is left out of the details rather than shown as an empty heading.
  const blank = (c: DataColumn<T>, r: T) => {
    if (!c.sortValue && !c.csv) return false;
    const v = c.csv ? c.csv(r) : c.sortValue!(r);
    return v === null || v === undefined || v === "";
  };
  const autoDetails = (r: T) => {
    // A table's own extra field with a column's name is that column told more
    // fully (a date with its time), so it stands in for the column.
    const extra = typeof details === "function" ? details(r) : [];
    const told = new Set(extra.map(f => f.label));
    const fields = [
      ...columns.filter(c => c.header && !told.has(c.header) && !blank(c, r)).map(c => ({ label: c.header, value: c.cell(r) })),
      ...extra,
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
  // A table wider than its box scrolls sideways; what a row is (its first
  // column, and its tick) and what can be done to it (⋯) stay in view.
  const firstKey = shown[0]?.key;
  const stick = "sticky z-[1] dt-stick";
  const stickLeft = ticking ? "left-10 dt-stick-l" : "left-0 dt-stick-l";
  // The details toggle stays beside the ⋯ (which is 3rem wide), or at the edge without one.
  const openerPin = rowActions ? "right-12 dt-stick-r" : "right-0 dt-stick-r";
  const cols = shown.length + (ticking ? 1 : 0) + (rowActions ? 1 : 0) + (opener ? 1 : 0);
  const countText = `${filtered.length} ${filtered.length === 1 ? noun : plural ?? (noun.endsWith("s") ? noun : `${noun}s`)}`;

  const wide = useWideScroll(boxRef, cardMode);
  // The header row stays in view while a long list scrolls under it — fitting
  // or wider than the screen alike, inside its own box (see useHeldHeader). A
  // table given its own height (maxHeight) holds it with CSS in that box.
  useHeldHeader(boxRef, [cardMode], !maxHeight);
  const searchRef = useRef<HTMLInputElement>(null);
  // "/" jumps to the search, as in most apps — the first table on the page
  // that has one and is in view, and never while typing somewhere else.
  useEffect(() => {
    if (!full) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "/" || e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target as HTMLElement;
      if (t.closest("input,textarea,select,[contenteditable=true],[role=dialog],[role=menu]")) return;
      const el = searchRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      if (r.bottom < 0 || r.top > window.innerHeight || !r.width) return;
      e.preventDefault();
      el.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [full]);

  const qv = search ? search.value : q;
  const setQv = (v: string) => { if (search) search.onChange(v); else { setQ(v); setPage(1); } };
  const hasSearch = !!search || !!searchText;
  const nFilters = filters ? activeFilterCount(filters) : 0;
  const clearFilters = () => { onClearFilters?.(); };
  const allExports: TableExport[] = [
    ...(exports ?? []),
    ...(exportName ? [{ label: "Excel (.csv)", icon: FileSpreadsheet, hint: "Opens in Excel or Google Sheets", onSelect: exportCsv }] : []),
  ];
  const narrowed = !!qv || nFilters > 0;
  const listed = [...(pinnedAt === "top" && cur === 1 ? pinnedRows ?? [] : []), ...visible, ...(pinnedAt === "bottom" && cur === pages && !(!search && q) ? pinnedRows ?? [] : [])];

  return (
    <div className="space-y-2.5">
      {full && (
      <div className="flex flex-wrap items-center gap-2">
        {hasSearch && (
          <div className="relative flex-1 min-w-[12rem] sm:max-w-sm max-sm:basis-full">
            <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
            <input ref={searchRef} value={qv} onChange={e => setQv(e.target.value)} placeholder={search?.placeholder ?? searchPlaceholder} aria-label={search?.ariaLabel ?? search?.placeholder ?? searchPlaceholder}
              className="h-9 w-full rounded-xl border border-border bg-white pl-9 pr-8 text-sm placeholder:text-muted-foreground/80 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/40" />
            {qv
              ? <button type="button" onClick={() => setQv("")} aria-label="Clear search" className="absolute right-1.5 top-1/2 -translate-y-1/2 h-6 w-6 grid place-items-center rounded-md text-muted-foreground hover:bg-secondary hover:text-foreground"><X className="h-3.5 w-3.5" /></button>
              : <kbd className="max-sm:hidden absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px] font-medium text-muted-foreground/70 border border-border rounded px-1.5 leading-4 pointer-events-none">/</kbd>}
          </div>
        )}
        {filters && filters.length > 0 && <FiltersButton filters={filters} onClear={clearFilters} count={countText} />}
        {toolbarExtra}
        <div className="ml-auto flex items-center gap-2">
          <span className="text-xs text-muted-foreground tabular-nums whitespace-nowrap">{countText}{!search && q ? ` of ${rows.length}` : ""}{ticking && selected!.size ? ` · ${selected!.size} ticked` : ""}</span>
          {wide.over && (
            <span className="max-md:hidden inline-flex rounded-xl border border-border bg-white overflow-hidden" title="Wider than the screen — drag the table, Shift + scroll, or use these">
              <button type="button" onClick={() => wide.scrollBy(-1)} disabled={wide.start} aria-label="Scroll the table left" className="h-9 w-8 grid place-items-center text-brand-dark hover:bg-secondary/70 disabled:opacity-35"><ChevronLeft className="h-4 w-4" /></button>
              <button type="button" onClick={() => wide.scrollBy(1)} disabled={wide.end} aria-label="Scroll the table right" className="h-9 w-8 grid place-items-center text-brand-dark hover:bg-secondary/70 border-l border-border disabled:opacity-35"><ChevronRight className="h-4 w-4" /></button>
            </span>
          )}
          <ViewMenu density={dense} onDensity={d => save({ ...prefs, dense: d })} columns={columns}
            isShown={isShown} onToggle={toggleCol} onReset={() => save({ pageSize: prefs.pageSize })}
            layout={canCards ? { value: cardMode ? "cards" : "table", onChange: v => save({ ...prefs, layout: v }) } : undefined}
            sortBy={cardMode ? {
              options: shown.filter(c => c.sortValue && c.header).map(c => ({ key: c.key, header: c.header })),
              value: sort, onPick: k => { const c = columns.find(x => x.key === k); if (c) clickSort(c); },
            } : undefined} />
          {mayExport && <ExportMenu exports={allExports} disabled={!rows.length} scope={exportScope ?? `${countText}${narrowed ? ", as filtered" : ""}`} />}
        </div>
      </div>
      )}
      {full && filters && nFilters > 0 && <FilterChips filters={filters} onClear={clearFilters} />}
      {summary}

      {cardMode ? (
        <div className="space-y-2">
          {ticking && keysShown.length > 0 && (
            <div className="flex items-center gap-2 px-1">
              <Tick state={allState} onClick={toggleAll} label={allState === "on" ? "Untick all" : `Tick all ${keysShown.length}`} />
              <span className="text-xs text-muted-foreground">{allState === "on" ? "Untick all" : `Tick all ${keysShown.length}`}</span>
            </div>
          )}
          {studio && listed.length > 0 && (
            <div className="dt-list rounded-xl border border-border/70 bg-card overflow-hidden divide-y divide-border/60">
              {listed.map(r => {
                const k = rowKey(r);
                const pin = !!pinnedRows?.includes(r);
                const on = !pin && ticking && selected!.has(k);
                const opens = !pin && canOpen(r), isOpen = opens && open.has(k);
                const opensPage = !pin && pageable && (canClickRow ? canClickRow(r) : true);
                const [head, ...restCols] = shown;
                const filled = restCols.filter(c => c.header && (pin || !blank(c, r)))
                  .map(c => ({ ...c, v: c.cell(r) })).filter(x => x.v !== null && x.v !== undefined && x.v !== false && x.v !== "");
                // The row's figure on the right (its last amount column); up to three facts under the name.
                const trail = [...filled].reverse().find(c => c.align === "right");
                const meta = filled.filter(c => c !== trail).slice(0, pin ? 8 : 3);
                const tap = !pin && (opensPage || opens);
                return (
                  <div key={k} className={`dt-row-slim ${on ? "bg-primary/[0.04]" : ""} ${pin ? "bg-secondary/30 italic" : ""} ${rowClassName?.(r) ?? ""}`}>
                    <div onClick={tap ? rowClick(r) : undefined} className={`flex items-start gap-3 px-3.5 py-3 ${tap ? "cursor-pointer active:bg-secondary/50 transition-colors" : ""}`}>
                      {ticking && !pin && <span className="pt-0.5"><Tick state={on ? "on" : "off"} onClick={() => toggleRow(k)} label={on ? "Untick this row" : "Tick this row"} /></span>}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0 flex-1">{head ? head.cell(r) : null}</div>
                          {trail && <div className="shrink-0 text-right text-sm font-semibold text-foreground tabular-nums leading-snug">{trail.v}</div>}
                        </div>
                        {/* One line of facts; the last gives way. A row that only opens
                            in place shows a chevron — a tap anywhere on it does the same. */}
                        {(meta.length > 0 || (opens && !opensPage)) && (
                          <div className="mt-1 flex items-center gap-x-3 text-xs text-muted-foreground whitespace-nowrap overflow-hidden">
                            {meta.map((c, i) => (
                              <span key={c.key} className={`inline-flex items-baseline gap-1 ${i === meta.length - 1 ? "min-w-0 shrink" : "shrink-0"}`}>
                                <span className="shrink-0">{c.header}</span>
                                <span className="text-foreground/85 min-w-0 truncate">{c.v}</span>
                              </span>
                            ))}
                            {opens && !opensPage && (
                              <button type="button" onClick={e => { e.stopPropagation(); toggleOpen(k); }} aria-expanded={isOpen} aria-label={isOpen ? "Less" : "All details"}
                                className="ml-auto shrink-0 -my-2 h-8 w-8 grid place-items-center rounded-full text-muted-foreground active:bg-secondary">
                                <ChevronDown className={`h-4 w-4 transition-transform ${isOpen ? "rotate-180" : ""}`} />
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                      {rowActions && !pin && (
                        <div data-no-row className="-mr-1.5 -mt-1 shrink-0">
                          <MoreMenu size="sm" label="Row actions" actions={rowActions(r)} onOpen={onRowActionsOpen ? () => onRowActionsOpen(r) : undefined} />
                        </div>
                      )}
                    </div>
                    {isOpen && <div className="border-t border-border/60 bg-secondary/20 px-3.5 py-3">{expand ? expand.render(r) : autoDetails(r)}</div>}
                  </div>
                );
              })}
            </div>
          )}
          {!studio && listed.map(r => {
            const k = rowKey(r);
            const pin = !!pinnedRows?.includes(r);
            const on = !pin && ticking && selected!.has(k);
            const opens = !pin && canOpen(r), isOpen = opens && open.has(k);
            const opensPage = !pin && pageable && (canClickRow ? canClickRow(r) : true);
            const [head, ...restCols] = shown;
            // Its next few figures, the empty ones left out — the rest are a tap
            // away. A pinned line (an opening balance) shows whatever it holds.
            const filled = restCols.filter(c => c.header && (pin || !blank(c, r)))
              .map(c => ({ ...c, v: c.cell(r) })).filter(x => x.v !== null && x.v !== undefined && x.v !== false && x.v !== "");
            const pairs = pin ? filled : filled.slice(0, 4);
            return (
              <div key={k} className={`dt-card rounded-xl border bg-white overflow-hidden ${on ? "border-primary/40 bg-primary/[0.03]" : "border-border/60"} ${pin ? "bg-secondary/25 italic" : ""} ${rowClassName?.(r) ?? ""}`}>
                <div onClick={!pin && (opensPage || opens) ? rowClick(r) : undefined}
                  className={`px-3.5 py-3 ${!pin && (opensPage || opens) ? "cursor-pointer active:bg-secondary/40 transition-colors" : ""}`}>
                  <div className="flex items-start gap-2.5">
                    {ticking && !pin && <span className="pt-0.5"><Tick state={on ? "on" : "off"} onClick={() => toggleRow(k)} label={on ? "Untick this row" : "Tick this row"} /></span>}
                    <div className="min-w-0 flex-1">{head ? head.cell(r) : null}</div>
                    {rowActions && !pin && (
                      <div data-no-row className="-mr-1 -mt-0.5 shrink-0">
                        <MoreMenu size="sm" label="Row actions" actions={rowActions(r)} onOpen={onRowActionsOpen ? () => onRowActionsOpen(r) : undefined} />
                      </div>
                    )}
                  </div>
                  {pairs.length > 0 && (
                    <dl className="mt-2.5 grid grid-cols-2 gap-x-4 gap-y-2">
                      {pairs.map(c => (
                        <div key={c.key} className="min-w-0">
                          <dt className="text-xs text-muted-foreground truncate">{c.header}</dt>
                          <dd className="text-sm text-foreground mt-0.5 min-w-0 overflow-hidden">{c.v}</dd>
                        </div>
                      ))}
                    </dl>
                  )}
                  {opens && (
                    <button type="button" onClick={e => { e.stopPropagation(); toggleOpen(k); }} aria-expanded={isOpen}
                      className="mt-1 -mb-2 -ml-1 inline-flex items-center gap-1 min-h-10 px-1 text-xs font-medium text-primary">
                      {isOpen ? "Less" : "All details"}<ChevronDown className={`h-3.5 w-3.5 transition-transform ${isOpen ? "rotate-180" : ""}`} />
                    </button>
                  )}
                </div>
                {isOpen && <div className="border-t border-border/60 bg-secondary/20 px-3.5 py-3">{expand ? expand.render(r) : autoDetails(r)}</div>}
              </div>
            );
          })}
          {!visible.length && (
            loading
              ? [0, 1, 2].map(i => (
                <div key={i} className="rounded-xl border border-border/60 bg-white px-3.5 py-3 space-y-3" aria-hidden>
                  <div className="h-3.5 w-2/3 rounded bg-secondary animate-pulse" />
                  <div className="grid grid-cols-2 gap-3">
                    {[0, 1, 2, 3].map(j => <div key={j} className="space-y-1.5"><div className="h-2 w-12 rounded bg-secondary/80 animate-pulse" /><div className="h-3 w-20 rounded bg-secondary animate-pulse" /></div>)}
                  </div>
                </div>
              ))
              : <div className="rounded-xl border border-dashed border-border bg-white px-4 py-10 text-center">
                  <EmptyState narrowedOut={narrowed && rows.length > 0} text={emptyText} onClear={() => { setQv(""); clearFilters(); }} action={studio ? emptyAction : undefined} />
                </div>
          )}
          {totals && filtered.length > 0 && (
            <div className="rounded-xl border border-border/70 bg-secondary/30 px-3.5 py-3">
              <p className="text-xs font-semibold text-foreground">{totalsLabel}{filtered.length !== rows.length ? ` (${filtered.length})` : ""}</p>
              <dl className="mt-1.5 grid grid-cols-2 gap-x-4 gap-y-2">
                {shown.filter(c => totals[c.key]).map(c => (
                  <div key={c.key} className="min-w-0">
                    <dt className="text-xs text-muted-foreground truncate">{c.header}</dt>
                    <dd className="text-sm font-bold text-brand-dark tabular-nums mt-0.5">{totals[c.key]!(filtered)}</dd>
                  </div>
                ))}
              </dl>
            </div>
          )}
        </div>
      ) : (<>
      {/* relative: the hidden column labels are placed inside this box, so
          they can't widen the page past a phone's screen. */}
      <div ref={boxRef} className={`dt-box relative ${maxHeight || wide.over ? "overflow-x-auto" : "overflow-x-clip"} rounded-xl border border-border/60 bg-white ${wide.over ? "dt-over" : ""} ${wide.over && !wide.start ? "dt-scrolled" : ""} ${wide.over && !wide.end ? "dt-more" : ""}`} style={maxHeight ? { maxHeight, overflowY: "auto" } : undefined}>
        <table className="w-full text-sm">
          <thead className={`bg-secondary/40 ${maxHeight ? "sticky top-0 z-10" : ""}`}>
            <tr className="border-b border-border/60">
              {ticking && (
                <th className={`w-10 px-3 py-3 ${stick} left-0 dt-stick-head md:z-[3]`}>
                  {keysShown.length > 0 && <Tick state={allState} onClick={toggleAll} label={allState === "on" ? "Untick all" : `Tick all ${keysShown.length}`} />}
                </th>
              )}
              {shown.map(c => {
                const on = sort?.key === c.key;
                return (
                  <th key={c.key} title={hint(c)}
                    className={`ui-th px-3 py-3 text-[11px] font-bold uppercase tracking-wider whitespace-nowrap ${alignCls(c.align)} ${on ? "dt-sorted text-primary shadow-[inset_0_-2px_0_var(--color-primary)]" : "text-brand-dark/70"} ${c.sortValue ? "group/th cursor-pointer select-none hover:text-primary transition-colors" : ""} ${c.key === firstKey ? `${stick} ${stickLeft} md:z-[3]` : "md:z-[2]"} dt-stick-head`}
                    onClick={() => clickSort(c)} aria-sort={on ? (sort!.dir === "asc" ? "ascending" : "descending") : undefined}>
                    <span className={`inline-flex items-center gap-1 ${c.align === "right" ? "flex-row-reverse" : ""}`}>
                      {c.header}
                      {c.sortValue && (on
                        ? (sort!.dir === "asc" ? <ArrowUp className="h-3 w-3 text-primary" /> : <ArrowDown className="h-3 w-3 text-primary" />)
                        : <ArrowUpDown className="h-3 w-3 opacity-0 group-hover/th:opacity-50 transition-opacity" />)}
                    </span>
                  </th>
                );
              })}
              {opener && <th className={`w-10 px-2 py-3 ${stick} ${openerPin} dt-stick-head md:z-[3]`}><span className="sr-only">Details</span></th>}
              {rowActions && <th className={`w-12 px-2 py-3 ${stick} right-0 ${opener ? "" : "dt-stick-r"} dt-stick-head md:z-[3]`}><span className="sr-only">Actions</span></th>}
            </tr>
          </thead>
          <tbody>
            {listed.map(r => {
              const k = rowKey(r);
              const pin = !!pinnedRows?.includes(r);
              const on = !pin && ticking && selected!.has(k);
              const opens = !pin && canOpen(r), isOpen = opens && open.has(k);
              const opensPage = !pin && pageable && (canClickRow ? canClickRow(r) : true);
              return (
                <Fragment key={k}>
                <tr onClick={!pin && (opensPage || opens) ? rowClick(r) : undefined}
                  className={`dt-row group transition-colors ${pin ? "dt-pin bg-secondary/25 italic" : on ? "dt-on bg-primary/[0.05]" : "hover:bg-secondary/30"} ${!pin && (opensPage || opens) ? "cursor-pointer" : ""} ${isOpen ? "dt-open bg-secondary/30" : ""} ${rowClassName?.(r) ?? ""}`}>
                  {ticking && <td className={`w-10 px-3 ${PAD[dense]} ${padCls} ${stick} left-0`}>{!pin && <Tick state={on ? "on" : "off"} onClick={() => toggleRow(k)} label={on ? "Untick this row" : "Tick this row"} />}</td>}
                  {shown.map(c => (
                    <td key={c.key} className={`px-3 ${PAD[dense]} ${padCls} ${alignCls(c.align)} ${c.key === firstKey ? `${stick} ${stickLeft}` : ""} ${c.className ?? ""}`}>{c.cell(r)}</td>
                  ))}
                  {opener && (
                    <td className={`w-10 px-2 ${PAD[dense]} ${padCls} text-center ${stick} ${openerPin}`}>
                      {opens && (
                        <button type="button" onClick={e => { e.stopPropagation(); toggleOpen(k); }} aria-expanded={isOpen} aria-label={isOpen ? "Hide details" : "Show details"}
                          className="h-7 w-7 inline-grid place-items-center rounded-lg text-muted-foreground hover:bg-secondary hover:text-foreground">
                          <ChevronDown className={`h-4 w-4 transition-transform ${isOpen ? "rotate-180" : ""}`} />
                        </button>
                      )}
                    </td>
                  )}
                  {rowActions && (
                    <td className={`w-12 px-2 ${PAD[dense]} ${padCls} text-right ${stick} right-0 ${opener ? "" : "dt-stick-r"}`} data-no-row>
                      {!pin && <MoreMenu size="sm" label="Row actions" actions={rowActions(r)} onOpen={onRowActionsOpen ? () => onRowActionsOpen(r) : undefined} className="opacity-70 group-hover:opacity-100 focus-visible:opacity-100" />}
                    </td>
                  )}
                </tr>
                {isOpen && (
                  <tr className="bg-secondary/20">
                    {/* A wide table scrolls sideways; what opened stays in view, as wide
                        as the box shows, wherever the table is scrolled to. */}
                    <td colSpan={cols} className="p-0">
                      <div className="sticky left-0 px-3 sm:px-5 py-4" style={boxW ? { width: boxW } : undefined}>{expand ? expand.render(r) : autoDetails(r)}</div>
                    </td>
                  </tr>
                )}
                </Fragment>
              );
            })}
            {!visible.length && loading && [0, 1, 2, 3, 4].map(i => (
              <tr key={`sk${i}`} aria-hidden>
                {ticking && <td className="w-10 px-3 py-3"><div className="h-4 w-4 rounded bg-secondary animate-pulse" /></td>}
                {shown.map((c, j) => (
                  <td key={c.key} className={`px-3 py-3.5 ${alignCls(c.align)}`}>
                    <div className={`h-3 rounded bg-secondary animate-pulse inline-block ${c.align === "right" ? "ml-auto" : ""}`} style={{ width: `${45 + ((i * 37 + j * 23) % 45)}%` }} />
                  </td>
                ))}
                {opener && <td />}
                {rowActions && <td />}
              </tr>
            ))}
            {!visible.length && !loading && (
              <tr><td colSpan={cols} className="p-0">
                <div className="sticky left-0 px-4 py-12 text-center" style={boxW ? { width: boxW } : undefined}>
                  <EmptyState narrowedOut={narrowed && rows.length > 0} text={emptyText} onClear={() => { setQv(""); clearFilters(); }} action={studio ? emptyAction : undefined} />
                </div>
              </td></tr>
            )}
          </tbody>
          {footer && filtered.length > 0 && <tfoot className="border-t-2 border-border/70 bg-secondary/30">{footer(shown, filtered)}</tfoot>}
          {!footer && totals && filtered.length > 0 && (
            <tfoot className="border-t-2 border-border/70 bg-secondary/30">
              <tr>
                {ticking && <td className={`w-10 ${stick} left-0 dt-stick-foot`} />}
                {shown.map((c, i) => (
                  <td key={c.key} className={`px-3 py-2.5 ${alignCls(c.align)} font-bold text-brand-dark ${c.key === firstKey ? `${stick} ${stickLeft} dt-stick-foot` : ""}`}>
                    {totals[c.key] ? <span className="tabular-nums whitespace-nowrap">{totals[c.key]!(filtered)}</span>
                      : i === 0 ? <span className="text-xs uppercase tracking-wider">{totalsLabel}{filtered.length !== rows.length ? ` (${filtered.length})` : ""}</span> : null}
                  </td>
                ))}
                {opener && <td className={`${stick} ${openerPin} dt-stick-foot`} />}
                {rowActions && <td className={`${stick} right-0 ${opener ? "" : "dt-stick-r"} dt-stick-foot`} />}
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      <FloatingScrollbar boxRef={boxRef} over={wide.over} />
      </>)}

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

/** What an empty table says: nothing yet (the page's own words), or nothing
 *  left after the search and filters — with the way back. */
function EmptyState({ narrowedOut, text, onClear, action }: { narrowedOut: boolean; text: ReactNode; onClear: () => void; action?: { label: string; onClick: () => void } }) {
  // Nothing yet, and a clear next step: say so and offer it.
  const next = !narrowedOut && action
    ? <button type="button" onClick={action.onClick} className="btn-hero mt-4 h-10 px-4 rounded-lg text-sm font-semibold inline-flex items-center gap-1.5"><Plus className="h-4 w-4" />{action.label}</button>
    : null;
  if (!narrowedOut && typeof text !== "string") return <div className="text-sm text-muted-foreground">{text}{next && <div>{next}</div>}</div>;
  const Icon = narrowedOut ? SearchX : Inbox;
  return (
    <div className="flex flex-col items-center">
      <span className="h-11 w-11 rounded-2xl bg-secondary/80 grid place-items-center text-muted-foreground"><Icon className="h-5 w-5" /></span>
      <p className="mt-3 text-sm font-medium text-brand-dark">{narrowedOut ? "Nothing matches" : text}</p>
      {narrowedOut && <p className="mt-1 text-xs text-muted-foreground">Try fewer filters or another search.</p>}
      {narrowedOut && (
        <button type="button" onClick={onClear} className="mt-3 h-8 px-3 rounded-lg border border-border bg-white text-xs font-medium text-brand-dark hover:bg-secondary/70">Clear search and filters</button>
      )}
      {next}
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
