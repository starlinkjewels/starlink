import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { termsLabel } from "@/lib/paymentTerms";

/**
 * A client's payment terms and credit limit — the same two boxes on Create and Edit client
 * (lib/paymentTerms.ts). Blank terms = the Settings default; blank limit = no limit.
 */
export function PaymentTermsFields({ terms, limit, onTerms, onLimit, defaultDays }: {
  terms: number | undefined; limit: number | undefined;
  onTerms: (v: number | undefined) => void; onLimit: (v: number | undefined) => void;
  /** Settings → Invoice & Bill → default payment terms, when set. */
  defaultDays: number | undefined;
}) {
  const num = (s: string) => (s.trim() === "" ? undefined : Number(s));
  return (
    <div className="grid grid-cols-2 gap-3">
      <div>
        <Label className="text-xs" htmlFor="client-terms">Payment terms (days)</Label>
        <Input id="client-terms" type="number" inputMode="numeric" min={0} max={365} step={1}
          value={terms ?? ""} onChange={e => onTerms(num(e.target.value))} className="rounded-xl mt-1"
          placeholder={defaultDays != null ? `${defaultDays} (default)` : "No terms"} />
        <p className="text-[11px] text-muted-foreground mt-1">
          {terms != null && Number.isFinite(terms) ? `${termsLabel(terms)} — each invoice is due ${terms === 0 ? "the day it is raised" : `${terms} days after it`}.`
            : defaultDays != null ? `Blank = the default, ${termsLabel(defaultDays)} (Settings → Invoice & Bill).` : "Blank = no due dates. 30 = Net 30, 0 = due on receipt."}
        </p>
      </div>
      <div>
        <Label className="text-xs" htmlFor="client-limit">Credit limit ($)</Label>
        <Input id="client-limit" type="number" inputMode="decimal" min={0} step="any"
          value={limit ?? ""} onChange={e => onLimit(num(e.target.value))} className="rounded-xl mt-1" placeholder="No limit" />
        <p className="text-[11px] text-muted-foreground mt-1">New orders and dispatches ask first once they owe more. Never shown to the client.</p>
      </div>
    </div>
  );
}
