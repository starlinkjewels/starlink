import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { useDb } from "@/hooks/useDb";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  CURRENCIES, ccy, ccyInfo, ccySymbol, fetchLiveRates, fmtCcy, fmtRate, rateReadsFrom, tableRate,
} from "@/lib/currency";

/** Pick a currency: the common ones first, each with its name. */
export function CurrencySelect({ value, onChange, className = "", disabled, label = "Currency" }: {
  value: string; onChange: (code: string) => void; className?: string; disabled?: boolean; label?: string;
}) {
  const v = ccy(value);
  const list = CURRENCIES.some(c => c.code === v) ? CURRENCIES : [...CURRENCIES, ccyInfo(v)];
  return (
    <Select value={v} onValueChange={onChange} disabled={disabled}>
      <SelectTrigger aria-label={label} className={className}><SelectValue /></SelectTrigger>
      <SelectContent className="max-h-80">
        {list.map(c => (
          <SelectItem key={c.code} value={c.code}>
            <span className="font-medium">{c.code}</span> <span className="text-muted-foreground">· {c.name} ({c.symbol.trim()})</span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** The rate from Settings → Exchange rates for "1 from = ? to", if both are there. */
export function useSuggestedRate(from: string, to: string, iso?: string): number | undefined {
  const db = useDb();
  return tableRate(db.settings.currencyRates, from, to, iso);
}

/**
 * The exchange rate for money going from one currency to another, entered the
 * way people say it — the dearer currency as the "1": "1 AUD = ₹ 55.20" for
 * either direction between rupees and Australian dollars.
 *
 * `value` is always "1 from = value to" whichever way it is shown. Starts from
 * the Settings rate when there is one; "Today's rate" asks the live market.
 */
export function RateInput({ from, to, value, onChange, id, className = "", amount, at }: {
  from: string; to: string;
  value: number | "";
  onChange: (rate: number | "") => void;
  id?: string; className?: string;
  /** Shows what the amount becomes. */
  amount?: number;
  /** The day the money moves — the Settings rate in force then. */
  at?: string;
}) {
  const [busy, setBusy] = useState(false);
  const f = ccy(from), t = ccy(to);
  const forward = rateReadsFrom(f, t);
  const [one, other] = forward ? [f, t] : [t, f];
  const show = (rate: number) => fmtRate(forward ? rate : 1 / rate).replace(/,/g, "");
  const [text, setText] = useState<string>(Number(value) > 0 ? show(Number(value)) : "");
  const suggested = useSuggestedRate(f, t, at);

  // Nothing entered yet: start from the Settings rate for these two.
  useEffect(() => {
    if (value === "" && suggested) onChange(suggested);
  }, [f, t, suggested]); // eslint-disable-line react-hooks/exhaustive-deps
  // A rate set from outside (that suggestion, a record being corrected) shows here;
  // what is being typed is left alone.
  useEffect(() => {
    const n = Number(text), typed = n > 0 ? (forward ? n : 1 / n) : undefined;
    if (value === "") { if (typed !== undefined) setText(""); return; }
    if (typed === undefined || Math.abs(typed - value) / value > 1e-6) setText(show(value));
  }, [value, f, t]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = (s: string) => {
    setText(s);
    const n = Number(s);
    onChange(n > 0 ? (forward ? n : 1 / n) : "");
  };
  const live = async () => {
    setBusy(true);
    try {
      const r = await fetchLiveRates([f, t]);
      const a = f === "INR" ? 1 : r[f], b = t === "INR" ? 1 : r[t];
      if (!a || !b) throw new Error(`No live rate for ${!a ? f : t} — type the rate.`);
      const rate = a / b;
      setText(show(rate));
      onChange(rate);
      toast.success(`Today's rate: 1 ${one} = ${ccySymbol(other)}${fmtRate(forward ? rate : 1 / rate)}`);
    } catch (e) { toast.error(e instanceof Error ? e.message : "No live rate — type the rate."); }
    setBusy(false);
  };
  const out = amount && Number(value) > 0 ? amount * Number(value) : undefined;
  const sym = ccySymbol(other).trim();
  return (
    <div className={className}>
      <Label className="text-xs" htmlFor={id}>Exchange rate</Label>
      <div className="mt-1 flex items-center gap-2">
        <span className="text-sm font-medium text-brand-dark whitespace-nowrap">1 {one} =</span>
        <div className="relative flex-1 min-w-0">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground pointer-events-none">{sym}</span>
          <Input id={id} type="number" min={0} step="any" inputMode="decimal" value={text} onChange={e => set(e.target.value)}
            className="rounded-xl" style={{ paddingLeft: `${Math.max(1.75, sym.length * 0.55 + 1.1)}rem` }} placeholder="0.00" aria-label={`1 ${one} in ${other}`} />
        </div>
        <button type="button" onClick={live} disabled={busy} title="Fill in today's market rate"
          className="shrink-0 inline-flex items-center gap-1.5 h-10 px-2.5 rounded-xl border border-border bg-white text-xs font-medium text-brand-dark hover:bg-secondary disabled:opacity-60">
          <RefreshCw className={`h-3.5 w-3.5 ${busy ? "animate-spin" : ""}`} />Today's rate
        </button>
      </div>
      {out !== undefined && (
        <p className="text-[11px] text-muted-foreground mt-1">{fmtCcy(amount!, f)} becomes <span className="font-semibold text-brand-dark">{fmtCcy(out, t)}</span></p>
      )}
    </div>
  );
}
