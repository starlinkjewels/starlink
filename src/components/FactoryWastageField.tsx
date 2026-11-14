import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * A factory's agreed making wastage % — the same box on Add and Edit factory (lib/factoryGoldCheck.ts).
 * Credited to the factory on each piece's fine gold at Final Approval, from the next approval on.
 */
export function FactoryWastageField({ value, onChange, id }: { value: string; onChange: (v: string) => void; id: string }) {
  return (
    <div>
      <Label htmlFor={id} className="text-xs">Agreed wastage on gold (%)</Label>
      <Input id={id} type="number" inputMode="decimal" min={0} max={20} step="0.01" value={value} onChange={e => onChange(e.target.value)}
        className="rounded-xl mt-1 w-40" placeholder="None" />
      <p className="text-[11px] text-muted-foreground mt-1">
        Credited to them on each piece's fine gold at Final Approval, and part of the piece's cost — e.g. 2–4% cast, 4–6% handmade.
        From the next approval on; pieces approved before keep what they had. Blank = none.
      </p>
    </div>
  );
}
