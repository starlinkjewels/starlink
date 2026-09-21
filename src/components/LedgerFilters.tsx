import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FileText, FileSpreadsheet, Search } from "lucide-react";

/** One dropdown in the bar — "Supplier", "Account", "Mode". "" means All. */
export interface LedgerSelect {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}

/** Is this row inside the chosen range? A blank end of the range is open. */
export function inDateRange(date: string, from: string, to: string): boolean {
  if (!from && !to) return true;
  const d = +new Date(date);
  if (from && d < +new Date(`${from}T00:00:00`)) return false;
  if (to && d > +new Date(`${to}T23:59:59.999`)) return false;
  return true;
}

/** "1 Aug 2026 – 31 Aug 2026", for the heading of a printed copy. */
export function rangeLabel(from: string, to: string): string {
  const f = (s: string) => new Date(`${s}T00:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  if (from && to) return `${f(from)} – ${f(to)}`;
  if (from) return `From ${f(from)}`;
  if (to) return `Up to ${f(to)}`;
  return "All dates";
}

/**
 * The filter bar every payments table shares: search, a date range, whatever
 * dropdowns the table needs, and the two downloads. The downloads sit here, next
 * to the filters, because they carry exactly what the filters left on screen —
 * a PDF or a spreadsheet of one supplier for one month is the whole point.
 */
export function LedgerFilters({
  q, onQ, placeholder,
  from, to, onFrom, onTo,
  selects = [],
  active, onReset,
  onPdf, onCsv,
}: {
  q: string;
  onQ: (v: string) => void;
  placeholder: string;
  from: string;
  to: string;
  onFrom: (v: string) => void;
  onTo: (v: string) => void;
  selects?: LedgerSelect[];
  active: boolean;
  onReset: () => void;
  onPdf: () => void;
  onCsv: () => void;
}) {
  return (
    <div className="flex items-center gap-2 flex-wrap mb-3">
      <div className="relative flex-1 min-w-[180px]">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
        <Input value={q} onChange={e => onQ(e.target.value)} placeholder={placeholder}
          className="rounded-xl h-9 pl-9" />
      </div>

      <Input type="date" value={from} onChange={e => onFrom(e.target.value)}
        className="rounded-xl h-9 w-auto" title="From date" />
      <span className="text-xs text-muted-foreground">to</span>
      <Input type="date" value={to} onChange={e => onTo(e.target.value)}
        className="rounded-xl h-9 w-auto" title="To date" />

      {selects.map(s => (
        <Select key={s.label} value={s.value || "__all"} onValueChange={v => s.onChange(v === "__all" ? "" : v)}>
          <SelectTrigger className="h-9 rounded-xl w-auto min-w-[130px] text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__all">All {s.label.toLowerCase()}</SelectItem>
            {s.options.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
          </SelectContent>
        </Select>
      ))}

      {active && (
        <button onClick={onReset} className="text-xs text-primary hover:underline shrink-0">Reset</button>
      )}

      <div className="flex items-center gap-2 shrink-0 ml-auto">
        <button onClick={onPdf}
          className="flex items-center gap-1.5 h-9 px-3 rounded-xl border border-border bg-white hover:bg-secondary text-xs font-medium text-brand-dark">
          <FileText className="h-4 w-4" /> PDF
        </button>
        <button onClick={onCsv}
          className="flex items-center gap-1.5 h-9 px-3 rounded-xl border border-border bg-white hover:bg-secondary text-xs font-medium text-brand-dark">
          <FileSpreadsheet className="h-4 w-4" /> Excel
        </button>
      </div>
    </div>
  );
}
