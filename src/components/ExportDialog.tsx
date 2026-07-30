import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { X, Download, FileText, FileSpreadsheet } from "lucide-react";

export interface ExportOption {
  label: string;
  sublabel?: string;
  kind?: "pdf" | "excel";
  /** Runs the download for the chosen [from, to] range (null = open-ended). */
  run: (from: Date | null, to: Date | null) => void;
}

/**
 * A reusable "Export" popup — pick a date range (with quick presets) and choose
 * what to download. Every ledger/report opens this instead of downloading
 * straight away, so any export can be filtered to a period (e.g. a month) for
 * analysis.
 */
export function ExportDialog({ open, onClose, title, options }: {
  open: boolean;
  onClose: () => void;
  title?: string;
  options: ExportOption[];
}) {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  if (!open) return null;

  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const setPreset = (kind: "month" | "lastMonth" | "year" | "all") => {
    const now = new Date();
    if (kind === "all") { setFrom(""); setTo(""); return; }
    if (kind === "month") { setFrom(iso(new Date(now.getFullYear(), now.getMonth(), 1))); setTo(iso(new Date(now.getFullYear(), now.getMonth() + 1, 0))); }
    if (kind === "lastMonth") { setFrom(iso(new Date(now.getFullYear(), now.getMonth() - 1, 1))); setTo(iso(new Date(now.getFullYear(), now.getMonth(), 0))); }
    if (kind === "year") { setFrom(iso(new Date(now.getFullYear(), 0, 1))); setTo(iso(new Date(now.getFullYear(), 11, 31))); }
  };

  const fromDate = from ? new Date(from + "T00:00:00") : null;
  const toDate = to ? new Date(to + "T23:59:59.999") : null;
  const invalid = !!(fromDate && toDate && +fromDate > +toDate);

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" onClick={onClose}>
      <div className="card-luxe w-full max-w-md p-5" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-1">
          <h3 className="font-display text-lg text-brand-dark">Export{title ? ` — ${title}` : ""}</h3>
          <button onClick={onClose} className="h-8 w-8 grid place-items-center rounded-lg hover:bg-secondary" aria-label="Close"><X className="h-4 w-4" /></button>
        </div>
        <p className="text-xs text-muted-foreground mb-4">Choose a date range (optional), then what to download.</p>

        <div className="flex flex-wrap gap-1.5 mb-3">
          {([["month", "This month"], ["lastMonth", "Last month"], ["year", "This year"], ["all", "All time"]] as const).map(([k, l]) => (
            <button key={k} onClick={() => setPreset(k)} className="px-2.5 h-7 rounded-lg text-xs font-medium bg-secondary hover:bg-secondary/70 transition-colors">{l}</button>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-2.5 mb-1">
          <div><Label className="text-xs">From</Label><Input type="date" value={from} onChange={e => setFrom(e.target.value)} className="rounded-lg h-9 mt-1" /></div>
          <div><Label className="text-xs">To</Label><Input type="date" value={to} onChange={e => setTo(e.target.value)} className="rounded-lg h-9 mt-1" /></div>
        </div>
        <p className="text-[11px] text-muted-foreground mb-4">{from || to ? `Showing ${from || "start"} → ${to || "today"}` : "All dates included."}</p>
        {invalid && <p className="text-xs text-destructive mb-2">The “From” date is after the “To” date.</p>}

        <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">Download</p>
        <div className="space-y-1.5">
          {options.map((o, i) => (
            <button key={i} disabled={invalid} onClick={() => { o.run(fromDate, toDate); onClose(); }}
              className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl border border-border hover:bg-secondary/60 text-left transition-colors disabled:opacity-50">
              {o.kind === "pdf" ? <FileText className="h-4 w-4 text-red-500 shrink-0" /> : o.kind === "excel" ? <FileSpreadsheet className="h-4 w-4 text-green-600 shrink-0" /> : <Download className="h-4 w-4 text-primary shrink-0" />}
              <span className="flex-1 min-w-0"><span className="block text-sm font-medium">{o.label}</span>{o.sublabel && <span className="block text-[11px] text-muted-foreground">{o.sublabel}</span>}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

/** Inclusive date-range test for a row's ISO date string. */
export function inDateRange(dateStr: string, from: Date | null, to: Date | null): boolean {
  const t = +new Date(dateStr);
  return (!from || t >= +from) && (!to || t <= +to);
}
