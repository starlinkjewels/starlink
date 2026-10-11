import { useState } from "react";
import { toast } from "sonner";
import { updateDb, uid, type Supplier } from "@/lib/db";
import { OpeningBalanceFields } from "@/components/OpeningBalanceFields";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

const EMPTY: Partial<Supplier> = { name: "", contactPerson: "", phone: "", email: "", address: "", gstin: "" };

/**
 * The one Add Supplier form — used on the Suppliers page and wherever a
 * supplier is picked ("+ Add new supplier"), so a supplier added from a
 * dropdown is exactly the supplier the Suppliers page would have made.
 */
export function SupplierCreateDialog({ open, onOpenChange, onCreated }: {
  open: boolean; onOpenChange: (v: boolean) => void; onCreated?: (id: string) => void;
}) {
  const [saving, setSaving] = useState(false);
  const [f, setF] = useState<Partial<Supplier>>(EMPTY);

  const create = () => {
    if (!f.name?.trim()) { toast.error("Enter a supplier name"); return; }
    setSaving(true);
    try {
      const id = uid("sup_");
      updateDb(d => {
        if (!d.suppliers) d.suppliers = [];
        d.suppliers.unshift({ ...f, name: f.name!.trim(), id, active: true, createdAt: new Date().toISOString() } as Supplier);
      });
      toast.success("Supplier added");
      onOpenChange(false);
      setF(EMPTY);
      onCreated?.(id);
    } finally { setSaving(false); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg rounded-2xl">
        <DialogHeader><DialogTitle className="font-display text-2xl">Add Supplier</DialogTitle></DialogHeader>
        <div className="grid grid-cols-2 gap-3 mt-2">
          {(["name", "contactPerson", "phone", "email", "address", "gstin"] as const).map(k => (
            <div key={k} className={k === "address" || k === "name" ? "col-span-2" : ""}>
              <Label className="text-xs capitalize">
                {k === "gstin" ? "GSTIN" : k === "contactPerson" ? "Contact Person" : k.replace(/([A-Z])/g, " $1")}
              </Label>
              <Input
                value={(f as Record<string, string>)[k] || ""}
                onChange={e => setF({ ...f, [k]: e.target.value })}
                className="rounded-xl mt-1"
              />
            </div>
          ))}
          <OpeningBalanceFields
            amount={f.openingBalance != null ? String(f.openingBalance) : ""}
            dir={f.openingDir || "credit"}
            date={f.openingDate || ""}
            onAmount={v => setF({ ...f, openingBalance: v === "" ? undefined : Number(v) })}
            onDir={v => setF({ ...f, openingDir: v })}
            onDate={v => setF({ ...f, openingDate: v || undefined })}
            debitLabel="Supplier owes us (Debit)"
            creditLabel="We owe supplier (Credit)"
            hint="Amount outstanding with this supplier when you started using this app (₹). Shown as the first line of their ledger."
          />
        </div>
        <Button onClick={create} disabled={saving} className="btn-hero rounded-xl mt-3">{saving ? "Creating…" : "Create Supplier"}</Button>
      </DialogContent>
    </Dialog>
  );
}
