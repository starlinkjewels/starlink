import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useDb } from "@/hooks/useDb";
import { choicesOf } from "@/lib/optionLists";
import type { FactoryLabour } from "@/lib/db";

/** A factory's labour rates as a form holds them: every number still as typed. */
export interface LabourDraft { minimum: string; perGram: Record<string, string> }

export const labourDraftOf = (l?: FactoryLabour): LabourDraft => ({
  minimum: l?.minimum != null ? String(l.minimum) : "",
  perGram: Object.fromEntries(Object.entries(l?.perGram ?? {}).map(([k, v]) => [k, String(v)])),
});

/** What is saved: only the rates given; nothing at all when none is. */
export function labourOf(d: LabourDraft): FactoryLabour | undefined {
  const perGram = Object.fromEntries(Object.entries(d.perGram)
    .map(([k, v]) => [k, Math.round((Number(v) || 0) * 100) / 100] as const).filter(([, v]) => v > 0));
  const minimum = Math.round((Number(d.minimum) || 0) * 100) / 100;
  if (!minimum && !Object.keys(perGram).length) return undefined;
  return { ...(minimum > 0 ? { minimum } : {}), ...(Object.keys(perGram).length ? { perGram } : {}) };
}

/**
 * The factory's making charge, set once: ₹ a gram for each kind of piece, and
 * the least it charges for a light one. An order's Final Approval starts from
 * these — the order's factory, the order's jewellery type — and can be changed
 * there for that one piece. A type left blank (a custom piece) is entered on
 * the order.
 */
export function FactoryLabourFields({ value, onChange, idPrefix }: { value: LabourDraft; onChange: (v: LabourDraft) => void; idPrefix: string }) {
  const db = useDb();
  const types = choicesOf("jewelleryTypes", undefined, db.settings).filter(t => t !== "Diamond Only");
  const setRate = (t: string, v: string) => onChange({ ...value, perGram: { ...value.perGram, [t]: v } });
  return (
    <div className="rounded-xl border border-border/70 p-4 space-y-3">
      <div>
        <p className="text-sm font-semibold text-foreground">Labour rates</p>
        <p className="text-xs text-muted-foreground mt-0.5">Filled in on each order's Final Approval for this factory — still changeable there.</p>
      </div>
      <div>
        <Label htmlFor={`${idPrefix}-min`} className="text-xs">Minimum labour (₹)</Label>
        <Input id={`${idPrefix}-min`} type="number" min={0} step="0.01" inputMode="decimal" value={value.minimum}
          onChange={e => onChange({ ...value, minimum: e.target.value })} className="rounded-xl mt-1 sm:max-w-[14rem]" placeholder="e.g. 1350" />
        <p className="text-[11px] text-muted-foreground mt-1">A light piece is charged this when gram × rate comes to less — e.g. ₹1,350 covers pieces under 1.50 g at ₹900/g.</p>
      </div>
      <div>
        <p className="text-xs font-medium text-foreground mb-1.5">Labour per gram, by item (₹ / g)</p>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
          {types.map(t => (
            <div key={t}>
              <Label htmlFor={`${idPrefix}-r-${t}`} className="text-[11px] text-muted-foreground">{t}</Label>
              <Input id={`${idPrefix}-r-${t}`} type="number" min={0} step="0.01" inputMode="decimal" value={value.perGram[t] ?? ""}
                onChange={e => setRate(t, e.target.value)} className="rounded-lg h-9 mt-0.5" placeholder="₹ /g" aria-label={`${t} labour per gram`} />
            </div>
          ))}
        </div>
        <p className="text-[11px] text-muted-foreground mt-1.5">Leave a type blank to enter its rate on each order (a custom piece).</p>
      </div>
    </div>
  );
}

/** The rates an order starts from: its factory's, for its jewellery type. */
export function factoryRatesFor(labour: FactoryLabour | undefined, jewelleryType: string): { perGram?: number; minimum?: number } {
  const perGram = labour?.perGram?.[jewelleryType];
  return { ...(perGram ? { perGram } : {}), ...(labour?.minimum ? { minimum: labour.minimum } : {}) };
}
