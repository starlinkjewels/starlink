import { useState } from "react";
import { toast } from "sonner";
import { updateDb, uid, type LockerType } from "@/lib/db";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type Form = { name: string; type: LockerType; currency: "INR" | "USD"; accountNumberLast4: string; openingBalance: string };
const EMPTY: Form = { name: "", type: "bank", currency: "INR", accountNumberLast4: "", openingBalance: "0" };

/** The one Add Locker (bank / cash account) form — the Locker page's, also opened from "+ Add new account". */
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
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl rounded-2xl">
        <DialogHeader><DialogTitle className="font-display text-2xl">Add Locker</DialogTitle></DialogHeader>
        <div className="dlg-cols mt-2">
          <div>
            <Label className="text-xs">Account Name</Label>
            <Input value={f.name} onChange={e => setF({ ...f, name: e.target.value })} className="rounded-xl mt-1" placeholder="HDFC Current A/c" />
          </div>
          <div className="grid grid-cols-2 gap-3">
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
              <Select value={f.currency} onValueChange={v => setF({ ...f, currency: v as "INR" | "USD" })}>
                <SelectTrigger className="rounded-xl mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="INR">INR (₹)</SelectItem>
                  <SelectItem value="USD">USD ($)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          {f.type === "bank" && (
            <div>
              <Label className="text-xs">Account Number (last 4, optional)</Label>
              <Input value={f.accountNumberLast4} onChange={e => setF({ ...f, accountNumberLast4: e.target.value })} maxLength={4} className="rounded-xl mt-1" />
            </div>
          )}
          <div>
            <Label className="text-xs">Opening Balance ({f.currency === "USD" ? "$" : "₹"})</Label>
            <Input type="number" min={0} value={f.openingBalance} onChange={e => setF({ ...f, openingBalance: e.target.value })} className="rounded-xl mt-1" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} className="rounded-xl">Cancel</Button>
          <Button onClick={createLocker} disabled={saving} className="btn-hero rounded-xl px-6">{saving ? "Creating…" : "Create Locker"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
