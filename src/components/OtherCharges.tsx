import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ListCombo } from "@/components/ListCombo";
import { uid, type OrderCharge } from "@/lib/db";

/** A charge as a form holds it: the amount still as typed. */
export interface ChargeDraft { id: string; name: string; amount: string }

export const chargeDrafts = (list: OrderCharge[] | undefined): ChargeDraft[] =>
  (list ?? []).map(c => ({ id: c.id, name: c.name, amount: String(c.amountUsd) }));

/** What gets saved: named, with an amount — an empty row is left out. */
export function chargesOf(rows: ChargeDraft[]): OrderCharge[] {
  return rows
    .map(r => ({ id: r.id, name: r.name.trim(), amountUsd: Math.round((Number(r.amount) || 0) * 100) / 100 }))
    .filter(c => c.name && c.amountUsd > 0);
}

export const chargesSum = (rows: ChargeDraft[]) => chargesOf(rows).reduce((s, c) => s + c.amountUsd, 0);

/**
 * Named extra charges on an order — "Setting charge $40", "Engraving $15" —
 * each added to its total and printed on its own line on the invoice. Names
 * come from the business's list (Settings → Dropdown lists → Other charges),
 * or are typed and remembered there.
 */
export function OtherChargesEditor({ rows, onChange }: { rows: ChargeDraft[]; onChange: (rows: ChargeDraft[]) => void }) {
  const set = (id: string, patch: Partial<ChargeDraft>) => onChange(rows.map(r => (r.id === id ? { ...r, ...patch } : r)));
  return (
    <div className="space-y-2">
      {rows.map((r, i) => (
        <div key={r.id} className="grid grid-cols-[minmax(0,1fr)_7.5rem_auto] gap-2 items-center">
          <ListCombo list="chargeNames" value={r.name} onChange={v => set(r.id, { name: v })} optional={false}
            placeholder="Charge name" className="rounded-xl h-11" ariaLabel={`Charge ${i + 1} name`} />
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">$</span>
            <Input type="number" min={0} step="0.01" value={r.amount} onChange={e => set(r.id, { amount: e.target.value })}
              className="rounded-xl h-11 pl-7" placeholder="0" aria-label={`Charge ${i + 1} amount`} />
          </div>
          <button type="button" onClick={() => onChange(rows.filter(x => x.id !== r.id))} aria-label={`Remove charge ${i + 1}`}
            className="h-9 w-9 grid place-items-center rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10">
            <X className="h-4 w-4" />
          </button>
        </div>
      ))}
      <Button type="button" variant="outline" size="sm" className="rounded-lg gap-1.5"
        onClick={() => onChange([...rows, { id: uid("ch_"), name: "", amount: "" }])}>
        <Plus className="h-3.5 w-3.5" />{rows.length ? "Add another charge" : "Add a charge"}
      </Button>
    </div>
  );
}
