import { useState } from "react";
import { toast } from "sonner";
import { Landmark } from "lucide-react";
import { updateDb, uid, type LockerType } from "@/lib/db";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ActionSheet } from "@/components/ActionSheet";
import { CurrencySelect } from "@/components/CurrencyFields";
import { ccySymbol, fmtCcy, type CurrencyCode } from "@/lib/currency";

type Form = { name: string; type: LockerType; currency: CurrencyCode; accountNumberLast4: string; openingBalance: string };
const EMPTY: Form = { name: "", type: "bank", currency: "INR", accountNumberLast4: "", openingBalance: "0" };

/**
 * The one Add Locker (bank / cash account) form — the Locker page's, also opened
 * from "+ Add new account". A panel from the right, so the page (or the form it
 * was opened from) stays where it was behind it.
 */
export function LockerCreateDialog({ open, onOpenChange, onCreated }: {
  open: boolean; onOpenChange: (v: boolean) => void; onCreated?: (id: string) => void;
}) {
  const [saving, setSaving] = useState(false);
  const [f, setF] = useState<Form>(EMPTY);

  const createLocker = () => {
    if (!f.name.trim()) { toast.error("Enter an account name"); return; }
    setSaving(true);
    try {
      const id = uid("lk_");
      updateDb(d => {
        if (!d.lockers) d.lockers = [];
        d.lockers.unshift({
          id, name: f.name.trim(), type: f.type, currency: f.currency,
          accountNumberLast4: f.accountNumberLast4.trim() || undefined,
          openingBalance: Math.max(0, Number(f.openingBalance) || 0),
          createdAt: new Date().toISOString(), active: true,
        });
      });
      toast.success("Locker created");
      onOpenChange(false);
      setF(EMPTY);
      onCreated?.(id);
    } finally { setSaving(false); }
  };

  return (
    <ActionSheet
      open={open}
      onOpenChange={onOpenChange}
      title="Add Locker"
      description="A bank account or cash box money is paid from and into."
      icon={Landmark}
      size="md"
      footer={
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          {/* What it opens with — the same figure the save writes (never below 0). */}
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Opens with</p>
            <p className="font-display text-xl font-bold text-brand-dark tabular-nums leading-tight truncate">
              {fmtCcy(Math.max(0, Number(f.openingBalance) || 0), f.currency)}
            </p>
          </div>
          <div className="flex gap-2 sm:shrink-0">
            <Button variant="outline" onClick={() => onOpenChange(false)} className="rounded-xl flex-1 sm:flex-none">Cancel</Button>
            <Button onClick={createLocker} disabled={saving} className="btn-hero rounded-xl px-6 flex-1 sm:flex-none">{saving ? "Creating…" : "Create Locker"}</Button>
          </div>
        </div>
      }
    >
      <div className="grid grid-cols-2 gap-x-3 gap-y-4 items-end">
        <div className="col-span-2">
          <Label className="text-xs">Account Name</Label>
          <Input value={f.name} onChange={e => setF({ ...f, name: e.target.value })} className="rounded-xl mt-1" placeholder="HDFC Current A/c" />
        </div>
        <div>
          <Label className="text-xs">Type</Label>
          <Select value={f.type} onValueChange={v => setF({ ...f, type: v as LockerType })}>
            <SelectTrigger className="rounded-xl mt-1"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="bank">Bank</SelectItem>
              <SelectItem value="cash">Cash</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs">Currency</Label>
          {/* Any currency the account is actually held in — AUD, EUR, AED… */}
          <CurrencySelect value={f.currency} onChange={v => setF({ ...f, currency: v })} className="rounded-xl mt-1" />
        </div>
        {f.type === "bank" && (
          <div>
            <Label className="text-xs">Account Number (last 4, optional)</Label>
            <Input value={f.accountNumberLast4} onChange={e => setF({ ...f, accountNumberLast4: e.target.value })} maxLength={4} className="rounded-xl mt-1" />
          </div>
        )}
        <div>
          <Label className="text-xs">Opening Balance ({ccySymbol(f.currency).trim()})</Label>
          <Input type="number" min={0} value={f.openingBalance} onChange={e => setF({ ...f, openingBalance: e.target.value })} className="rounded-xl mt-1" />
        </div>
      </div>
    </ActionSheet>
  );
}
