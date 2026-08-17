import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { LedgerDir } from "@/lib/db";

/** Shared "opening balance" block for the Client / Supplier / Factory forms —
 *  a one-time migration figure for a business already running before this app.
 *  Amount + Debit/Credit direction + an as-of date (shown as the first ledger
 *  line). Direction labels are entity-specific so staff can't mis-pick a side. */
export function OpeningBalanceFields({
  amount, dir, date, onAmount, onDir, onDate,
  debitLabel, creditLabel, hint, title = "Opening Balance",
}: {
  amount: string;
  dir: LedgerDir;
  date: string;
  onAmount: (v: string) => void;
  onDir: (v: LedgerDir) => void;
  onDate: (v: string) => void;
  debitLabel: string;
  creditLabel: string;
  hint?: string;
  title?: string;
}) {
  return (
    <div className="col-span-2 rounded-xl border border-amber-500/30 bg-amber-500/5 p-3 space-y-2.5">
      <div className="flex items-baseline gap-2 flex-wrap">
        <p className="text-xs font-semibold text-amber-700">{title} (optional)</p>
        <span className="text-[10px] text-muted-foreground">for a business already running before this app — leave 0 if none</span>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
        <div>
          <Label className="text-[11px]">Amount</Label>
          <Input type="number" min={0} step="0.01" value={amount} onChange={e => onAmount(e.target.value)} placeholder="0.00" className="rounded-lg mt-1 h-9" />
        </div>
        <div>
          <Label className="text-[11px]">Direction</Label>
          <Select value={dir} onValueChange={v => onDir(v as LedgerDir)}>
            <SelectTrigger className="rounded-lg mt-1 h-9"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="debit">{debitLabel}</SelectItem>
              <SelectItem value="credit">{creditLabel}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-[11px]">As of date</Label>
          <Input type="date" value={date} onChange={e => onDate(e.target.value)} className="rounded-lg mt-1 h-9" />
        </div>
      </div>
      {hint && <p className="text-[11px] text-muted-foreground leading-relaxed">{hint}</p>}
    </div>
  );
}
