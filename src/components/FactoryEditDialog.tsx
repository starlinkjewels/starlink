import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Factory as FactoryIcon } from "lucide-react";
import { updateDb, type Factory } from "@/lib/db";
import { ActionSheet } from "@/components/ActionSheet";
import { Button } from "@/components/ui/button";
import { AsyncButton } from "@/components/AsyncButton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const FIELDS = ["name", "contactPerson", "phone", "address"] as const;
type Field = (typeof FIELDS)[number];
type Form = Record<Field, string>;

const formOf = (f: Factory | null): Form => ({
  name: f?.name ?? "", contactPerson: f?.contactPerson ?? "", phone: f?.phone ?? "", address: f?.address ?? "",
});

/**
 * Correct a factory's details — the same fields, laid out the same way, as
 * Add Factory. Its opening balances have their own card on its page; its
 * issues and payments are not touched by this.
 */
export function FactoryEditDialog({ factory, onClose }: { factory: Factory | null; onClose: () => void }) {
  const [f, setF] = useState<Form>(formOf(factory));
  useEffect(() => { if (factory) setF(formOf(factory)); }, [factory]);

  const save = () => {
    if (!factory) return;
    if (!f.name.trim()) { toast.error("Enter a factory name"); return; }
    updateDb(d => {
      const x = d.factories.find(y => y.id === factory.id);
      if (!x) return;
      x.name = f.name.trim();
      for (const k of FIELDS) {
        if (k === "name") continue;
        const v = f[k].trim();
        if (v) x[k] = v; else delete x[k];
      }
    });
    toast.success("Factory updated");
    onClose();
  };

  return (
    <ActionSheet
      open={!!factory}
      onOpenChange={o => { if (!o) onClose(); }}
      title="Edit Factory"
      description="Name and contact details only"
      icon={FactoryIcon}
      size="md"
      footer={
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Factory</p>
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
        {FIELDS.map(k => (
          <div key={k} className={k === "address" || k === "name" ? "col-span-2" : ""}>
            <Label htmlFor={`fac-edit-${k}`} className="text-xs capitalize">{k === "contactPerson" ? "Contact Person / Karigar" : k.replace(/([A-Z])/g, " $1")}</Label>
            <Input id={`fac-edit-${k}`} value={f[k]} onChange={e => setF({ ...f, [k]: e.target.value })} className="rounded-xl mt-1" />
          </div>
        ))}
      </div>
    </ActionSheet>
  );
}
