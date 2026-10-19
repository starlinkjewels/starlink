import { useDb } from "@/hooks/useDb";
import { choicesOf, type ListKey } from "@/lib/optionLists";
import { lotBalances, lotLabel, type LotBalance } from "@/lib/diamondLots";
import { stockAverageRate } from "@/lib/orderCost";
import { fmtMoneyInr } from "@/lib/manufacturing";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const NONE = "__none";

/**
 * A dropdown fed by one of the business's lists (Settings → Dropdown lists) —
 * the diamond shapes, sizes, colours and clarities on every stock form. A
 * value a record already has stays offered. `optional` adds "—" (not recorded).
 */
export function ListSelect({ list, value, onChange, id, optional = true, placeholder = "—", className = "h-10 rounded-xl" }: {
  list: ListKey; value: string; onChange: (v: string) => void; id?: string;
  optional?: boolean; placeholder?: string; className?: string;
}) {
  const db = useDb();
  const options = choicesOf(list, value || undefined, db.settings);
  return (
    <Select value={value || (optional ? NONE : "")} onValueChange={v => onChange(v === NONE ? "" : v)}>
      <SelectTrigger id={id} className={className}><SelectValue placeholder={placeholder} /></SelectTrigger>
      <SelectContent className="max-h-72">
        {/* "—": not recorded. Short, so a narrow box never cuts it off. */}
        {optional && <SelectItem value={NONE}><span className="text-muted-foreground">—</span></SelectItem>}
        {options.map(o => <SelectItem key={o} value={o}>{o}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}

/** "2.35 ct · 120 pcs · ₹3,200/ct" — what a lot holds and what it cost. */
export function lotStockText(l: LotBalance, avg: number | null): string {
  return [`${l.ct} ct`, l.pcs != null ? `${l.pcs} pcs` : "", avg ? `${fmtMoneyInr(avg)}/ct` : ""].filter(Boolean).join(" · ");
}

/**
 * Pick a loose-diamond lot that is in stock — "Round · +6.5-7 · G-H · VS —
 * 2.35 ct · 120 pcs · ₹3,200/ct". Used wherever loose stones leave stock (an
 * order's Diamond from stock, Sell diamond), so they always come out of a lot
 * that holds them. Older stock with only a shape reads "size not recorded".
 */
export function LotPicker({ value, onChange, companyId, id, className = "h-10 rounded-xl" }: {
  value: string; onChange: (key: string, lot?: LotBalance) => void; companyId: string; id?: string; className?: string;
}) {
  const db = useDb();
  const lots = lotBalances(db.stockMovements ?? [], companyId).filter(l => l.ct > 0)
    .sort((a, b) => a.key.localeCompare(b.key));
  const now = new Date().toISOString();
  const avgOf = (k: string) => stockAverageRate(db, "diamond", k, now, companyId === "all" ? undefined : companyId);
  return (
    <Select value={value || ""} onValueChange={k => onChange(k, lots.find(l => l.key === k))}>
      <SelectTrigger id={id} className={className}><SelectValue placeholder={lots.length ? "Choose a lot in stock" : "No loose diamonds in stock"} /></SelectTrigger>
      <SelectContent className="max-h-80">
        {lots.map(l => (
          <SelectItem key={l.key} value={l.key}>
            <span className="font-medium">{lotLabel(l.key)}</span>
            <span className="text-muted-foreground"> — {lotStockText(l, avgOf(l.key))}</span>
          </SelectItem>
        ))}
        {value && !lots.some(l => l.key === value) && <SelectItem value={value}>{lotLabel(value)} — none in stock</SelectItem>}
      </SelectContent>
    </Select>
  );
}
