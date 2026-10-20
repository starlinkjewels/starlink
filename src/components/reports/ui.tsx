import { useState, type ReactNode } from "react";
import { ArrowDownRight, ArrowUpRight, CalendarDays, Check, ChevronDown, Minus, Download, type LucideIcon } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { SectionTitle } from "@/components/SectionTitle";
import { TableBox } from "@/components/TableBox";
import { dateRangeText } from "@/components/TableToolbar";
import { PRESETS, presetOf, presetPeriod, type Period } from "@/lib/analytics";

/** Chart colours, in the app's palette. */
export const C = {
  primary: "oklch(0.475 0.13 264)",
  primarySoft: "oklch(0.72 0.08 264)",
  gold: "oklch(0.74 0.13 80)",
  success: "oklch(0.6 0.14 152)",
  rose: "oklch(0.62 0.19 22)",
  sky: "oklch(0.66 0.12 230)",
  violet: "oklch(0.58 0.15 300)",
  slate: "oklch(0.6 0.02 260)",
  amber: "oklch(0.72 0.15 60)",
};
export const SERIES = [C.primary, C.gold, C.success, C.sky, C.violet, C.rose, C.amber, C.slate];

/** $ with no cents above a thousand, compact above a million. */
export function usd(n: number | null | undefined, compact = false): string {
  if (n == null || !isFinite(n)) return "—";
  const a = Math.abs(n), s = n < 0 ? "−" : "";
  if (compact && a >= 1e6) return `${s}$${(a / 1e6).toFixed(a >= 1e7 ? 1 : 2)}M`;
  if (compact && a >= 1e4) return `${s}$${(a / 1e3).toFixed(a >= 1e5 ? 0 : 1)}k`;
  return `${s}$${a.toLocaleString("en-US", { maximumFractionDigits: a >= 1000 ? 0 : 2 })}`;
}
/** ₹ the Indian way — lakh and crore when compact. */
export function inr(n: number | null | undefined, compact = false): string {
  if (n == null || !isFinite(n)) return "—";
  const a = Math.abs(n), s = n < 0 ? "−" : "";
  if (compact && a >= 1e7) return `${s}₹${(a / 1e7).toFixed(2)} Cr`;
  if (compact && a >= 1e5) return `${s}₹${(a / 1e5).toFixed(2)} L`;
  return `${s}₹${Math.round(a).toLocaleString("en-IN")}`;
}
export const pct = (n: number | null | undefined) => (n == null || !isFinite(n) ? "—" : `${n.toLocaleString("en-US", { maximumFractionDigits: 1 })}%`);
export const num = (n: number | null | undefined, unit = "") => (n == null || !isFinite(n) ? "—" : `${n.toLocaleString("en-US", { maximumFractionDigits: 1 })}${unit}`);

/** ▲ / ▼ against the previous period. `goodWhenDown` for costs and days. */
export function Delta({ value, goodWhenDown = false, label = "vs previous" }: { value: number | null | undefined; goodWhenDown?: boolean; label?: string }) {
  if (value === undefined) return null;
  // Nothing to compare with: the earlier period had none of it.
  if (value === null) return <span className="text-[10px] text-muted-foreground" title="The previous period had nothing to compare with">no data before</span>;
  const flat = Math.abs(value) < 0.05;
  const up = value > 0;
  const good = flat ? null : goodWhenDown ? !up : up;
  const Icon = flat ? Minus : up ? ArrowUpRight : ArrowDownRight;
  return (
    <span className={`inline-flex items-center gap-0.5 text-[10px] font-semibold ${good === null ? "text-muted-foreground" : good ? "text-success" : "text-destructive"}`}>
      <Icon className="h-3 w-3" />{flat ? "0%" : `${Math.abs(value).toLocaleString("en-US", { maximumFractionDigits: 1 })}%`}
      <span className="font-normal text-muted-foreground ml-0.5">{label}</span>
    </span>
  );
}

export function KpiCard({ icon: Icon, label, value, sub, delta, goodWhenDown, tone = "primary", hint }: {
  icon: LucideIcon; label: string; value: ReactNode; sub?: ReactNode; delta?: number | null; goodWhenDown?: boolean;
  tone?: "primary" | "gold" | "success" | "rose" | "sky" | "violet"; hint?: string;
}) {
  const tones: Record<string, string> = {
    primary: "bg-primary/10 text-primary", gold: "bg-amber-500/10 text-amber-600", success: "bg-success/10 text-success",
    rose: "bg-rose-500/10 text-rose-600", sky: "bg-sky-500/10 text-sky-600", violet: "bg-violet-500/10 text-violet-600",
  };
  return (
    <div className="ui-kpi card-luxe p-4 flex flex-col gap-2 min-w-0" title={hint}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] font-medium text-muted-foreground truncate">{label}</p>
        <span className={`ui-stat-icon h-8 w-8 rounded-xl grid place-items-center shrink-0 ${tones[tone]}`}><Icon className="h-4 w-4" /></span>
      </div>
      <p className="ui-stat-value font-display text-2xl text-brand-dark leading-none truncate">{value}</p>
      {/* Stacked on a phone, side by side when there is room. */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-0.5 sm:gap-2 min-h-[14px]">
        {sub ? <p className="text-[10px] text-muted-foreground leading-snug line-clamp-2 min-w-0">{sub}</p> : <span />}
        <span className="shrink-0"><Delta value={delta} goodWhenDown={goodWhenDown} /></span>
      </div>
    </div>
  );
}

export function Panel({ title, subtitle, info, icon, actions, children, className = "" }: {
  title: string; subtitle?: string; info?: ReactNode; icon?: LucideIcon; actions?: ReactNode; children: ReactNode; className?: string;
}) {
  return (
    <section className={`card-luxe p-4 sm:p-5 min-w-0 ${className}`}>
      <SectionTitle className="mb-4" title={title} sub={subtitle} info={info} icon={icon} actions={actions} />
      {children}
    </section>
  );
}

/**
 * The reports' one period control — the page's and every report's own: the
 * same presets as pills and a from–to range, behind one button that says
 * what is chosen. `allTime` offers the open range ("All time").
 */
export function PeriodPicker({ value, onChange, allTime = false, label = "Period" }: {
  value: Period; onChange: (p: Period) => void; allTime?: boolean; label?: string;
}) {
  const [open, setOpen] = useState(false);
  const key = presetOf(value);
  const text = !value.from && !value.to ? "All time" : key ? PRESETS.find(p => p.key === key)!.label : dateRangeText(value.from, value.to);
  const pill = (on: boolean, children: ReactNode, onClick: () => void, k: string) => (
    <button key={k} type="button" onClick={onClick} aria-pressed={on}
      className={`h-8 px-3 rounded-lg text-xs font-medium border transition-colors inline-flex items-center gap-1.5 ${on ? "bg-primary text-primary-foreground border-primary" : "bg-white border-border text-brand-dark hover:bg-secondary/70"}`}>
      {on && <Check className="h-3 w-3" />}{children}
    </button>
  );
  const box = "w-full h-9 rounded-lg border border-border bg-white px-2.5 text-sm text-brand-dark focus:outline-none focus:ring-2 focus:ring-primary/30";
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" aria-label={`${label}: ${text}`}
          className="h-9 px-3 inline-flex items-center gap-2 rounded-xl border border-border bg-white text-[13px] font-medium text-brand-dark hover:bg-secondary/70 transition-colors min-w-0 max-w-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30">
          <CalendarDays className="h-4 w-4 text-primary shrink-0" /><span className="truncate">{text}</span><ChevronDown className="h-3.5 w-3.5 opacity-60 shrink-0" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[26rem] max-w-[calc(100vw-2rem)] p-4 rounded-2xl space-y-3">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</p>
        <div className="flex flex-wrap gap-1.5">
          {allTime && pill(!value.from && !value.to, "All time", () => { onChange({ from: "", to: "" }); setOpen(false); }, "all")}
          {PRESETS.map(p => pill(key === p.key, p.label, () => { onChange(presetPeriod(p.key)); setOpen(false); }, p.key))}
        </div>
        <div className="grid grid-cols-2 gap-2">
          <label className="text-[11px] text-muted-foreground space-y-1">
            <span>From</span>
            <input type="date" aria-label="From date" value={value.from} max={value.to || undefined} onChange={e => onChange({ ...value, from: e.target.value })} className={box} />
          </label>
          <label className="text-[11px] text-muted-foreground space-y-1">
            <span>To</span>
            <input type="date" aria-label="To date" value={value.to} min={value.from || undefined} onChange={e => onChange({ ...value, to: e.target.value })} className={box} />
          </label>
        </div>
      </PopoverContent>
    </Popover>
  );
}

export function ExportButton({ onClick, label = "Excel" }: { onClick: () => void; label?: string }) {
  return (
    <button type="button" onClick={onClick}
      className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-lg border border-border bg-white text-xs font-medium text-brand-dark hover:bg-secondary transition-colors">
      <Download className="h-3.5 w-3.5" />{label}
    </button>
  );
}

export function Empty({ children = "Nothing in this period." }: { children?: ReactNode }) {
  return <div className="h-40 grid place-items-center text-xs text-muted-foreground text-center px-4">{children}</div>;
}

/** Recharts tooltip in the app's card style. */
export function ChartTip({ active, payload, label, format }: {
  active?: boolean; payload?: { name: string; value: number; color?: string; fill?: string; stroke?: string }[]; label?: string;
  format?: (v: number, name: string) => string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-xl border border-border/70 bg-white/95 backdrop-blur px-3 py-2 shadow-lg text-xs">
      {label && <p className="font-semibold text-brand-dark mb-1">{label}</p>}
      {payload.map(p => (
        <p key={p.name} className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full" style={{ background: p.color || p.fill || p.stroke }} />
          <span className="text-muted-foreground">{p.name}</span>
          <span className="ml-auto font-semibold text-brand-dark">{format ? format(p.value, p.name) : p.value}</span>
        </p>
      ))}
    </div>
  );
}

/** A thin horizontal bar for in-table comparisons. */
export function Bar({ value, max, tone = C.primary }: { value: number; max: number; tone?: string }) {
  const w = max > 0 ? Math.max(2, Math.round((Math.max(0, value) / max) * 100)) : 0;
  return <div className="h-1.5 rounded-full bg-secondary overflow-hidden"><div className="h-full rounded-full" style={{ width: `${w}%`, background: tone }} /></div>;
}

/** A report's table — in the app's one table box (see TableBox). */
export function Table({ head, children, minWidth = 640 }: { head: ReactNode; children: ReactNode; minWidth?: number }) {
  return (
    <TableBox>
      <table className="w-full text-xs" style={{ minWidth }}>
        <thead>{head}</thead>
        <tbody className="divide-y divide-border/50">{children}</tbody>
      </table>
    </TableBox>
  );
}
