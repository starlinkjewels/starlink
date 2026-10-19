import { Handshake } from "lucide-react";
import { useDb } from "@/hooks/useDb";
import { fmtMoneyInr } from "@/lib/manufacturing";
import { billBrokerageInr, type BillBrokerage } from "@/lib/brokers";
import { AddNewItem, useAddNew } from "@/components/create/QuickCreate";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const NONE = "__none";

/**
 * A bill's broker (optional): who brought it, the brokerage (% of the bill,
 * worked out to ₹ and changeable), and who pays it. The same on every purchase
 * form — Buy & Assign and an order's Buy — so the brokerage is recorded the
 * same way wherever a bill is entered.
 */
export function BillBrokerFields({ value, onChange, billTotalInr, className = "" }: {
  value: BillBrokerage; onChange: (v: BillBrokerage) => void; billTotalInr: number; className?: string;
}) {
  const db = useDb();
  const addNew = useAddNew();
  const brokers = (db.brokers ?? []).filter(b => b.active !== false || b.id === value.brokerId).sort((a, b) => a.name.localeCompare(b.name));
  const broker = brokers.find(b => b.id === value.brokerId);
  const inr = billBrokerageInr(value, billTotalInr);
  const pick = (id: string) => {
    if (id === NONE) { onChange({ ...value, brokerId: "", pct: "", amount: "" }); return; }
    const b = (db.brokers ?? []).find(x => x.id === id);
    onChange({ ...value, brokerId: id, pct: b?.brokeragePct != null ? String(b.brokeragePct) : "", amount: "" });
  };
  const seg = (on: boolean) => `h-9 flex-1 rounded-lg text-xs font-medium transition-colors ${on ? "bg-white shadow-soft text-brand-dark" : "text-muted-foreground hover:text-foreground"}`;

  return (
    <div className={`rounded-xl border border-border/60 bg-white p-3 space-y-2.5 ${className}`}>
      <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <Handshake className="h-3.5 w-3.5" /> Broker <span className="font-normal">· optional</span>
      </p>
      <div className={`grid gap-2.5 grid-cols-2 ${value.brokerId ? "sm:grid-cols-[minmax(0,1.4fr)_minmax(0,0.6fr)_minmax(0,0.9fr)]" : ""}`}>
        <Select value={value.brokerId || NONE} onValueChange={addNew("broker", pick)}>
          <SelectTrigger className="h-10 rounded-xl col-span-2 sm:col-span-1"><SelectValue placeholder="No broker" /></SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE}>No broker</SelectItem>
            {brokers.map(b => <SelectItem key={b.id} value={b.id}>{b.name}{b.brokeragePct != null ? ` · ${b.brokeragePct}%` : ""}</SelectItem>)}
            <AddNewItem kind="broker" />
          </SelectContent>
        </Select>
        {value.brokerId && (
          <>
            <label className="block min-w-0 space-y-1 text-[11px] font-medium text-muted-foreground"><span className="sr-only">Brokerage %</span>
              <div className="relative">
                <Input type="number" min={0} max={20} step="0.01" value={value.pct} aria-label="Brokerage %"
                  onChange={e => onChange({ ...value, pct: e.target.value, amount: "" })} className="rounded-xl h-10 pr-7" placeholder="0" />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">%</span>
              </div>
            </label>
            <label className="block min-w-0"><span className="sr-only">Brokerage amount (₹)</span>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">₹</span>
                <Input type="number" min={0} step="0.01" value={value.amount} aria-label="Brokerage amount"
                  onChange={e => onChange({ ...value, amount: e.target.value })}
                  className="rounded-xl h-10 pl-6" placeholder={inr ? String(inr) : "0"} />
              </div>
            </label>
          </>
        )}
      </div>
      {value.brokerId && (
        <>
          <div className="flex gap-1 p-1 bg-secondary rounded-xl" role="radiogroup" aria-label="Who pays the brokerage">
            <button type="button" role="radio" aria-checked={value.paidBy === "us"} onClick={() => onChange({ ...value, paidBy: "us" })} className={seg(value.paidBy === "us")}>We pay</button>
            <button type="button" role="radio" aria-checked={value.paidBy === "supplier"} onClick={() => onChange({ ...value, paidBy: "supplier" })} className={seg(value.paidBy === "supplier")}>Supplier pays</button>
          </div>
          <p className="text-[11px] text-muted-foreground">
            {value.paidBy === "us"
              ? <>Brokerage <span className="font-semibold text-foreground">{fmtMoneyInr(inr)}</span> owed to {broker?.name ?? "the broker"} — added to what this material cost. The supplier's bill stays the same.</>
              : <>Brokerage {fmtMoneyInr(inr)} paid by the supplier — written on the bill only; nothing owed by us.</>}
          </p>
        </>
      )}
    </div>
  );
}
