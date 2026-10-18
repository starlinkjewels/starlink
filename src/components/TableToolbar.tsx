import { useEffect, useState, type ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { ArrowDown, ArrowDownLeft, ArrowUp, ArrowUpRight, CalendarDays, Check, Info, ChevronDown, Columns3, Download, Layers, LayoutList, ListFilter, RotateCcw, Rows3, Scale, Table2, X } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Drawer, DrawerContent, DrawerDescription, DrawerTitle } from "@/components/ui/drawer";
import {
  DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { todayLocal } from "@/lib/db";

/**
 * The pieces of a table's one toolbar row (see DataTable): Filters — everything
 * that narrows the rows, behind one button, with what is on shown as chips —
 * View (row spacing, columns) and Export. A table never grows a second bar of
 * date boxes and dropdowns above it; that is what made every page look busy.
 */

/** Something that narrows a table's rows. "" / empty means not narrowed. */
export type TableFilter =
  | { kind: "date"; label?: string; from: string; to: string; onChange: (from: string, to: string) => void }
  | { kind: "select"; label: string; value: string; onChange: (v: string) => void; options: { value: string; label: string }[]; allLabel?: string };

/** One way to download what the table shows. */
export interface TableExport { label: string; icon?: LucideIcon; hint?: string; onSelect: () => void }

export type Density = "compact" | "normal" | "spacious";

const BTN = "h-9 px-3 inline-flex items-center gap-2 rounded-xl border border-border bg-white text-[13px] font-medium text-brand-dark hover:bg-secondary/70 transition-colors shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30";

/* ── Dates ─────────────────────────────────────────────────────────────── */

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** The ranges people actually ask for — the Indian financial year included. */
export const DATE_PRESETS: { key: string; label: string; range: () => [string, string] }[] = [
  { key: "today", label: "Today", range: () => [todayLocal(), todayLocal()] },
  { key: "yesterday", label: "Yesterday", range: () => { const d = new Date(); d.setDate(d.getDate() - 1); return [iso(d), iso(d)]; } },
  { key: "7d", label: "Last 7 days", range: () => { const d = new Date(); d.setDate(d.getDate() - 6); return [iso(d), todayLocal()]; } },
  { key: "30d", label: "Last 30 days", range: () => { const d = new Date(); d.setDate(d.getDate() - 29); return [iso(d), todayLocal()]; } },
  { key: "month", label: "This month", range: () => { const d = new Date(); return [iso(new Date(d.getFullYear(), d.getMonth(), 1)), todayLocal()]; } },
  { key: "lastmonth", label: "Last month", range: () => { const d = new Date(); return [iso(new Date(d.getFullYear(), d.getMonth() - 1, 1)), iso(new Date(d.getFullYear(), d.getMonth(), 0))]; } },
  { key: "year", label: "This year", range: () => { const d = new Date(); return [iso(new Date(d.getFullYear(), 0, 1)), todayLocal()]; } },
  { key: "fy", label: "This financial year", range: () => { const d = new Date(); const y = d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1; return [iso(new Date(y, 3, 1)), todayLocal()]; } },
  { key: "lastfy", label: "Last financial year", range: () => { const d = new Date(); const y = (d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1) - 1; return [iso(new Date(y, 3, 1)), iso(new Date(y + 1, 2, 31))]; } },
];

const short = (s: string) => new Date(`${s}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }).replace(/\bSept\b/, "Sep");

/** "This month", or "1 Oct 2026 – 17 Oct 2026" for a range of one's own. */
export function dateRangeText(from: string, to: string): string {
  if (!from && !to) return "Any date";
  const p = DATE_PRESETS.find(x => { const [f, t] = x.range(); return f === from && t === to; });
  if (p) return p.label;
  if (from && to) return from === to ? short(from) : `${short(from)} – ${short(to)}`;
  return from ? `From ${short(from)}` : `Up to ${short(to)}`;
}

const isOn = (f: TableFilter) => (f.kind === "date" ? !!(f.from || f.to) : !!f.value);

/** How many filters are narrowing the rows. */
export const activeFilterCount = (filters: TableFilter[]) => filters.filter(isOn).length;

/* ── Filters ───────────────────────────────────────────────────────────── */

/** A phone-width screen (under 640px). */
export function useNarrow(): boolean {
  const q = "(max-width: 639px)";
  const [narrow, setNarrow] = useState(() => typeof window !== "undefined" && window.matchMedia(q).matches);
  useEffect(() => {
    const m = window.matchMedia(q);
    const on = () => setNarrow(m.matches);
    m.addEventListener("change", on);
    return () => m.removeEventListener("change", on);
  }, []);
  return narrow;
}

function Pill({ on, onClick, children }: { on: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={on}
      className={`h-8 px-3 rounded-lg text-xs font-medium border transition-colors inline-flex items-center gap-1.5 ${on ? "bg-primary text-primary-foreground border-primary" : "bg-white border-border text-brand-dark hover:bg-secondary/70"}`}>
      {on && <Check className="h-3 w-3" />}{children}
    </button>
  );
}

function FilterFields({ filters }: { filters: TableFilter[] }) {
  return (
    <div className="space-y-5">
      {filters.map((f, i) => {
        if (f.kind === "date") {
          const preset = DATE_PRESETS.find(x => { const [a, b] = x.range(); return a === f.from && b === f.to; });
          return (
            <section key={`d${i}`} className="space-y-2.5">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{f.label ?? "Date"}</p>
              <div className="flex flex-wrap gap-1.5">
                <Pill on={!f.from && !f.to} onClick={() => f.onChange("", "")}>Any date</Pill>
                {DATE_PRESETS.map(p => (
                  <Pill key={p.key} on={preset?.key === p.key} onClick={() => { const [a, b] = p.range(); f.onChange(a, b); }}>{p.label}</Pill>
                ))}
              </div>
              <div className="grid grid-cols-2 gap-2">
                <label className="text-[11px] text-muted-foreground space-y-1">
                  <span>From</span>
                  <input type="date" value={f.from} max={f.to || undefined} onChange={e => f.onChange(e.target.value, f.to)}
                    className="w-full h-9 rounded-lg border border-border bg-white px-2.5 text-sm text-brand-dark focus:outline-none focus:ring-2 focus:ring-primary/30" />
                </label>
                <label className="text-[11px] text-muted-foreground space-y-1">
                  <span>To</span>
                  <input type="date" value={f.to} min={f.from || undefined} onChange={e => f.onChange(f.from, e.target.value)}
                    className="w-full h-9 rounded-lg border border-border bg-white px-2.5 text-sm text-brand-dark focus:outline-none focus:ring-2 focus:ring-primary/30" />
                </label>
              </div>
            </section>
          );
        }
        const all = f.allLabel ?? "All";
        return (
          <section key={`s${i}`} className="space-y-2.5">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{f.label}</p>
            {f.options.length <= 6 ? (
              <div className="flex flex-wrap gap-1.5">
                <Pill on={!f.value} onClick={() => f.onChange("")}>{all}</Pill>
                {f.options.map(o => <Pill key={o.value} on={f.value === o.value} onClick={() => f.onChange(o.value)}>{o.label}</Pill>)}
              </div>
            ) : (
              <Select value={f.value || "__all"} onValueChange={v => f.onChange(v === "__all" ? "" : v)}>
                <SelectTrigger className="h-9 rounded-lg text-sm"><SelectValue /></SelectTrigger>
                <SelectContent className="max-h-72">
                  <SelectItem value="__all">{all}</SelectItem>
                  {f.options.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                </SelectContent>
              </Select>
            )}
          </section>
        );
      })}
    </div>
  );
}

/**
 * One "Filters" button: a panel under it on a laptop, a sheet from the bottom
 * on a phone. The count on it says how many are narrowing the rows.
 */
export function FiltersButton({ filters, onClear, count }: { filters: TableFilter[]; onClear: () => void; count?: string }) {
  const narrow = useNarrow();
  const [open, setOpen] = useState(false);
  const n = activeFilterCount(filters);
  const trigger = (
    <button type="button" className={`${BTN} ${n ? "border-primary/40 bg-primary/[0.06] text-primary" : ""}`} aria-label={n ? `Filters, ${n} on` : "Filters"}>
      <ListFilter className="h-4 w-4" />
      <span>Filters</span>
      {n > 0 && <span className="h-5 min-w-5 px-1 grid place-items-center rounded-full bg-primary text-[11px] font-semibold text-primary-foreground tabular-nums">{n}</span>}
    </button>
  );
  const footer = (
    <div className="flex items-center justify-between gap-3">
      <button type="button" onClick={onClear} disabled={!n}
        className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground disabled:opacity-40">
        <RotateCcw className="h-3.5 w-3.5" />Clear all
      </button>
      <div className="flex items-center gap-3">
        {count && <span className="text-xs text-muted-foreground tabular-nums">{count}</span>}
        <button type="button" onClick={() => setOpen(false)} className="h-9 px-4 rounded-xl bg-primary text-primary-foreground text-sm font-medium hover:opacity-90">Done</button>
      </div>
    </div>
  );
  if (narrow) {
    return (
      <>
        <span onClick={() => setOpen(true)}>{trigger}</span>
        <Drawer open={open} onOpenChange={setOpen} shouldScaleBackground={false}>
          <DrawerContent className="max-h-[88dvh]">
            <div className="px-5 pt-2 pb-3 border-b border-border/60">
              <DrawerTitle className="font-display text-lg text-brand-dark">Filters</DrawerTitle>
              <DrawerDescription className="text-xs text-muted-foreground">Narrow what the table shows</DrawerDescription>
            </div>
            <div className="overflow-y-auto px-5 py-4"><FilterFields filters={filters} /></div>
            <div className="px-5 py-3 border-t border-border/60 pb-[max(0.75rem,env(safe-area-inset-bottom))]">{footer}</div>
          </DrawerContent>
        </Drawer>
      </>
    );
  }
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent align="start" side="bottom" avoidCollisions={false} collisionPadding={12}
        className="w-[26rem] max-w-[calc(100vw-2rem)] p-0 rounded-2xl flex flex-col max-h-[calc(var(--radix-popover-content-available-height)-12px)]">
        <div className="px-4 pt-4 pb-1 min-h-0 overflow-y-auto"><FilterFields filters={filters} /></div>
        <div className="px-4 py-3 mt-3 border-t border-border/60">{footer}</div>
      </PopoverContent>
    </Popover>
  );
}

/** What is narrowing the rows, each with its own ×, and Clear all. */
export function FilterChips({ filters, onClear }: { filters: TableFilter[]; onClear: () => void }) {
  const on = filters.filter(isOn);
  if (!on.length) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {on.map((f, i) => {
        const [name, value, clear] = f.kind === "date"
          ? [f.label ?? "Date", dateRangeText(f.from, f.to), () => f.onChange("", "")]
          : [f.label, f.options.find(o => o.value === f.value)?.label ?? f.value, () => f.onChange("")];
        return (
          <span key={i} className="inline-flex items-center gap-1 h-7 pl-2.5 pr-1 rounded-lg bg-primary/[0.07] text-xs text-brand-dark ring-1 ring-primary/15">
            {f.kind === "date" && <CalendarDays className="h-3.5 w-3.5 text-primary/70" />}
            <span className="text-muted-foreground">{name}:</span>
            <span className="font-medium">{value}</span>
            <button type="button" onClick={clear} aria-label={`Remove ${name} filter`}
              className="h-5 w-5 grid place-items-center rounded-md text-muted-foreground hover:bg-primary/10 hover:text-foreground">
              <X className="h-3 w-3" />
            </button>
          </span>
        );
      })}
      {on.length > 1 && (
        <button type="button" onClick={onClear} className="h-7 px-2 text-xs font-medium text-primary hover:underline">Clear all</button>
      )}
    </div>
  );
}

/* ── Figures over a table ──────────────────────────────────────────────── */

/** One figure in a StatStrip. */
export interface StatItem {
  label: string;
  value: ReactNode;
  /** in: money in (green), out: money out (red), strong: the result (a balance). */
  tone?: "in" | "out" | "strong";
  /** The picture beside it; one is chosen from the tone without it. */
  icon?: LucideIcon;
  /** A quiet line under the figure — "8 entries", "after advances". */
  sub?: ReactNode;
  /** In a running sum, the sign before this figure: Opening + In − Out = Closing. */
  op?: "+" | "−" | "=";
}

const STAT_TONE = {
  in: { chip: "bg-success/10 text-success", value: "text-success", icon: ArrowDownLeft },
  out: { chip: "bg-destructive/10 text-destructive", value: "text-destructive", icon: ArrowUpRight },
  strong: { chip: "bg-primary/10 text-primary", value: "text-brand-dark", icon: Scale },
  none: { chip: "bg-secondary text-brand-dark/70", value: "text-brand-dark", icon: Layers },
} as const;

/**
 * The few figures that sum up what a table shows — opening, in, out, closing.
 * A panel of equal columns that fills its width, each figure with its picture,
 * its name and the amount large enough to read at a glance; a running sum
 * shows its signs between them (Opening + In − Out = Closing). Two to a row
 * on a phone.
 */
export function StatStrip({ items, note }: { items: StatItem[]; note?: ReactNode }) {
  const n = Math.max(1, items.length);
  return (
    <div className="rounded-2xl border border-border/70 bg-white shadow-[0_1px_2px_rgb(15_23_42/0.04)] overflow-clip">
      <div className="grid grid-cols-2 sm:[grid-template-columns:repeat(var(--n),minmax(0,1fr))]" style={{ ["--n" as string]: n }}>
        {items.map((it, i) => {
          // Colour says money in, money owed: a figure of nothing says neither.
          const zero = typeof it.value === "string" && /^[^\d-]*0+(?:[.,]0+)?(?:\s*[^\d\s]*)?$/.test(it.value.trim());
          const t = STAT_TONE[zero ? "none" : it.tone ?? "none"];
          const Icon = it.icon ?? t.icon;
          return (
            <div key={it.label}
              className={`relative min-w-0 px-4 sm:px-5 py-3.5 sm:py-4 flex items-start gap-3
                ${i > 0 ? "sm:border-l sm:border-border/60" : ""}
                ${i % 2 === 1 ? "max-sm:border-l max-sm:border-border/60" : ""}
                ${i >= 2 ? "max-sm:border-t max-sm:border-border/60" : ""}`}>
              {it.op && i > 0 && (
                <span aria-hidden className="max-sm:hidden absolute -left-[11px] top-1/2 -translate-y-1/2 z-[1] h-[22px] w-[22px] grid place-items-center rounded-full bg-white border border-border text-[13px] font-semibold text-muted-foreground leading-none">{it.op}</span>
              )}
              <span className={`h-9 w-9 shrink-0 rounded-xl grid place-items-center ${t.chip}`}><Icon className="h-[18px] w-[18px]" /></span>
              <div className="min-w-0">
                <p className="text-xs font-medium text-muted-foreground truncate">{it.label}</p>
                <p className={`mt-0.5 text-lg sm:text-xl font-semibold tracking-tight tabular-nums leading-tight break-words ${zero ? "text-muted-foreground" : t.value}`}>{it.value}</p>
                {it.sub && <p className="mt-0.5 text-[11px] text-muted-foreground truncate">{it.sub}</p>}
              </div>
            </div>
          );
        })}
      </div>
      {note && (
        <div className="flex items-center gap-1.5 border-t border-border/60 bg-secondary/25 px-4 sm:px-5 py-2 text-[11px] text-muted-foreground">
          <Info className="h-3.5 w-3.5 shrink-0" />{note}
        </div>
      )}
    </div>
  );
}

/* ── View and Export ───────────────────────────────────────────────────── */

/** Row spacing and which columns show — one menu, not two buttons. */
export function ViewMenu({ density, onDensity, columns, isShown, onToggle, onReset, layout, sortBy }: {
  density: Density;
  onDensity: (d: Density) => void;
  columns: { key: string; header: string; always?: boolean }[];
  isShown: (key: string) => boolean;
  onToggle: (key: string) => void;
  onReset: () => void;
  /** On a phone: rows as cards, or the full table. */
  layout?: { value: "cards" | "table"; onChange: (v: "cards" | "table") => void };
  /** Cards have no column headers to click — they sort from here. */
  sortBy?: { options: { key: string; header: string }[]; value: { key: string; dir: "asc" | "desc" } | null; onPick: (key: string) => void };
}) {
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <button type="button" className={BTN} aria-label="View options" title="Row spacing and columns">
          <Columns3 className="h-4 w-4" /><span className="max-sm:hidden">View</span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" collisionPadding={12} className="w-60 max-h-[min(75vh,var(--radix-dropdown-menu-content-available-height))] overflow-y-auto rounded-xl p-1.5">
        {layout && (
          <>
            <DropdownMenuLabel className="text-[10px] uppercase tracking-wider text-muted-foreground">Show as</DropdownMenuLabel>
            <DropdownMenuRadioGroup value={layout.value} onValueChange={v => layout.onChange(v as "cards" | "table")}>
              <DropdownMenuRadioItem value="cards" className="text-sm rounded-lg gap-2"><LayoutList className="h-3.5 w-3.5 text-muted-foreground" />Cards</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="table" className="text-sm rounded-lg gap-2"><Table2 className="h-3.5 w-3.5 text-muted-foreground" />Table</DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
            <DropdownMenuSeparator />
          </>
        )}
        {sortBy && sortBy.options.length > 0 && (
          <>
            <DropdownMenuLabel className="text-[10px] uppercase tracking-wider text-muted-foreground">Sort by</DropdownMenuLabel>
            {sortBy.options.map(o => {
              const on = sortBy.value?.key === o.key;
              return (
                <DropdownMenuItem key={o.key} onSelect={e => { e.preventDefault(); sortBy.onPick(o.key); }} className="text-sm rounded-lg justify-between">
                  <span className={on ? "font-medium text-primary" : ""}>{o.header}</span>
                  {on && (sortBy.value!.dir === "asc" ? <ArrowUp className="h-3.5 w-3.5 text-primary" /> : <ArrowDown className="h-3.5 w-3.5 text-primary" />)}
                </DropdownMenuItem>
              );
            })}
            <DropdownMenuSeparator />
          </>
        )}
        {!(layout && layout.value === "cards") && (
          <>
            <DropdownMenuLabel className="text-[10px] uppercase tracking-wider text-muted-foreground flex items-center gap-1.5"><Rows3 className="h-3 w-3" />Row spacing</DropdownMenuLabel>
            <DropdownMenuRadioGroup value={density} onValueChange={v => onDensity(v as Density)}>
              <DropdownMenuRadioItem value="compact" className="text-sm rounded-lg">Compact</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="normal" className="text-sm rounded-lg">Comfortable</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="spacious" className="text-sm rounded-lg">Spacious</DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
            <DropdownMenuSeparator />
          </>
        )}
        <DropdownMenuLabel className="text-[10px] uppercase tracking-wider text-muted-foreground flex items-center gap-1.5"><Columns3 className="h-3 w-3" />Columns</DropdownMenuLabel>
        <div className="max-h-64 overflow-y-auto">
          {columns.filter(c => c.header).map(c => (
            <DropdownMenuCheckboxItem key={c.key} checked={c.always || isShown(c.key)} disabled={c.always}
              onCheckedChange={() => onToggle(c.key)} onSelect={e => e.preventDefault()} className="text-sm rounded-lg">{c.header}</DropdownMenuCheckboxItem>
          ))}
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={onReset} className="text-sm rounded-lg gap-2 text-muted-foreground"><RotateCcw className="h-3.5 w-3.5" />Reset view</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Every download of the table in one place, saying what it will hold. */
export function ExportMenu({ exports, scope, disabled }: { exports: TableExport[]; scope: string; disabled?: boolean }) {
  if (!exports.length) return null;
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild disabled={disabled}>
        <button type="button" className={`${BTN} disabled:opacity-45 disabled:pointer-events-none`} aria-label="Export" title={disabled ? "Nothing to download yet" : "Download what the table shows"}>
          <Download className="h-4 w-4" /><span className="max-sm:hidden">Export</span><ChevronDown className="h-3.5 w-3.5 opacity-60 max-sm:hidden" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64 rounded-xl p-1.5">
        <DropdownMenuLabel className="text-[11px] font-normal text-muted-foreground leading-snug">{scope}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {exports.map(x => (
          <DropdownMenuItem key={x.label} onSelect={() => setTimeout(x.onSelect, 0)} className="rounded-lg gap-2.5 py-2 cursor-pointer items-start">
            {x.icon && <x.icon className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />}
            <span className="min-w-0">
              <span className="block text-sm font-medium leading-snug">{x.label}</span>
              {x.hint && <span className="block text-[11px] text-muted-foreground leading-snug mt-0.5">{x.hint}</span>}
            </span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
