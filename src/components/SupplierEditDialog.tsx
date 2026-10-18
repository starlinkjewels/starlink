import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Truck } from "lucide-react";
import { updateDb, type Supplier } from "@/lib/db";
import { ActionSheet } from "@/components/ActionSheet";
import { Button } from "@/components/ui/button";
import { AsyncButton } from "@/components/AsyncButton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const FIELDS = ["name", "contactPerson", "phone", "email", "gstin", "address"] as const;
type Field = (typeof FIELDS)[number];
type Form = Record<Field, string>;

const formOf = (s: Supplier | null): Form => ({
  name: s?.name ?? "", contactPerson: s?.contactPerson ?? "", phone: s?.phone ?? "",
  email: s?.email ?? "", gstin: s?.gstin ?? "", address: s?.address ?? "",
});

/**
 * Correct a supplier's details — the same fields, laid out the same way, as
 * Add Supplier. Their opening balance has its own card on their page and is
 * corrected there; their purchases and payments are not touched by this.
 */
export function SupplierEditDialog({ supplier, onClose }: { supplier: Supplier | null; onClose: () => void }) {
  const [f, setF] = useState<Form>(formOf(supplier));
  // A different supplier opened: start from what is saved for them.
  useEffect(() => { if (supplier) setF(formOf(supplier)); }, [supplier]);

  const save = () => {
    if (!supplier) return;
    if (!f.name.trim()) { toast.error("Enter a supplier name"); return; }
    updateDb(d => {
      const s = d.suppliers.find(x => x.id === supplier.id);
      if (!s) return;
      s.name = f.name.trim();
      // Cleared fields go, rather than staying as empty strings.
      for (const k of FIELDS) {
        if (k === "name") continue;
        const v = f[k].trim();
        if (v) s[k] = v; else delete s[k];
      }
    });
    toast.success("Supplier updated");
    onClose();
  };

  return (
    <ActionSheet
      open={!!supplier}
      onOpenChange={o => { if (!o) onClose(); }}
      title="Edit Supplier"
      description="Name and contact details only"
      icon={Truck}
      size="md"
      footer={
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Supplier</p>
            <p className="text-sm font-semibold text-brand-dark truncate">{f.name.trim() || "—"}</p>
          </div>
          <div className="flex gap-2 sm:shrink-0">
            <Button variant="outline" onClick={onClose} className="rounded-xl flex-1 sm:flex-none">Cancel</Button>
            <AsyncButton onClick={save} className="btn-hero rounded-xl px-6 flex-1 sm:flex-none sm:min-w-40">Save Changes</AsyncButton>
          </div>
        </div>
      }
    >
      <div className="grid grid-cols-2 gap-x-3 gap-y-4">
        {/* GSTIN sits beside email so the two wide rows (name, address) leave no gaps. */}
        {FIELDS.map(k => (
          <div key={k} className={k === "address" || k === "name" ? "col-span-2" : ""}>
            <Label htmlFor={`sup-edit-${k}`} className="text-xs capitalize">
              {k === "gstin" ? "GSTIN" : k === "contactPerson" ? "Contact Person" : k.replace(/([A-Z])/g, " $1")}
            </Label>
            <Input id={`sup-edit-${k}`} value={f[k]} onChange={e => setF({ ...f, [k]: e.target.value })} className="rounded-xl mt-1" />
          </div>
        ))}
      </div>
    </ActionSheet>
  );
}
