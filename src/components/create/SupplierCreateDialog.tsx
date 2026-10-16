import { useState } from "react";
import { toast } from "sonner";
import { Truck } from "lucide-react";
import { updateDb, uid, type Supplier } from "@/lib/db";
import { OpeningBalanceFields } from "@/components/OpeningBalanceFields";
import { ActionSheet } from "@/components/ActionSheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const EMPTY: Partial<Supplier> = { name: "", contactPerson: "", phone: "", email: "", address: "", gstin: "" };

/**
 * The one Add Supplier form — used on the Suppliers page and wherever a
 * supplier is picked ("+ Add new supplier"), so a supplier added from a
 * dropdown is exactly the supplier the Suppliers page would have made.
 * A panel from the right, so whatever it was opened from stays put behind it.
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
    <ActionSheet
      open={open}
      onOpenChange={onOpenChange}
      title="Add Supplier"
      description="Who you buy material from — their details and any balance carried over."
      icon={Truck}
      size="md"
      footer={
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">New supplier</p>
            <p className="text-sm font-semibold text-brand-dark truncate">{f.name?.trim() || "—"}</p>
          </div>
          <div className="flex gap-2 sm:shrink-0">
            <Button variant="outline" onClick={() => onOpenChange(false)} className="rounded-xl flex-1 sm:flex-none">Cancel</Button>
            <Button onClick={create} disabled={saving} className="btn-hero rounded-xl px-6 flex-1 sm:flex-none sm:min-w-40">{saving ? "Creating…" : "Create Supplier"}</Button>
          </div>
        </div>
      }
    >
      <div className="grid grid-cols-2 gap-x-3 gap-y-4">
        {/* GSTIN sits beside email so the two wide rows (name, address) leave no gaps. */}
        {(["name", "contactPerson", "phone", "email", "gstin", "address"] as const).map(k => (
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
    </ActionSheet>
  );
}
