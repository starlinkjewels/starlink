import { useState } from "react";
import { toast } from "sonner";
import { updateDb, uid, type Factory } from "@/lib/db";
import { OpeningBalanceFields } from "@/components/OpeningBalanceFields";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

const EMPTY: Partial<Factory> = { name: "", contactPerson: "", phone: "", address: "" };

/** The one Add Factory form — the Factories page's, also opened from "+ Add new factory". */
export function FactoryCreateDialog({ open, onOpenChange, onCreated }: {
  open: boolean; onOpenChange: (v: boolean) => void; onCreated?: (id: string) => void;
}) {
  const [saving, setSaving] = useState(false);
  const [f, setF] = useState<Partial<Factory>>(EMPTY);

  const create = () => {
    if (!f.name?.trim()) { toast.error("Enter a factory name"); return; }
    setSaving(true);
    try {
      const id = uid("fac_");
      updateDb(d => {
        if (!d.factories) d.factories = [];
        d.factories.unshift({ ...f, name: f.name!.trim(), id, active: true, createdAt: new Date().toISOString() } as Factory);
      });
      toast.success("Factory added");
      onOpenChange(false);
      setF(EMPTY);
      onCreated?.(id);
    } finally { setSaving(false); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl rounded-2xl">
        <DialogHeader><DialogTitle className="font-display text-2xl">Add Factory</DialogTitle></DialogHeader>
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 mt-2">
          {(["name", "contactPerson", "phone", "address"] as const).map(k => (
            <div key={k} className={k === "address" || k === "name" ? "col-span-2" : ""}>
              <Label className="text-xs capitalize">{k === "contactPerson" ? "Contact Person / Karigar" : k.replace(/([A-Z])/g, " $1")}</Label>
              <Input value={(f as Record<string, string>)[k] || ""} onChange={e => setF({ ...f, [k]: e.target.value })} className="rounded-xl mt-1" />
            </div>
          ))}
          <OpeningBalanceFields
            amount={f.openingBalance != null ? String(f.openingBalance) : ""}
            dir={f.openingDir || "credit"}
            date={f.openingDate || ""}
            onAmount={v => setF({ ...f, openingBalance: v === "" ? undefined : Number(v) })}
            onDir={v => setF({ ...f, openingDir: v })}
            onDate={v => setF({ ...f, openingDate: v || undefined })}
            debitLabel="Factory owes us (Debit)"
            creditLabel="We owe factory (Credit)"
            title="Opening Making-Charge Balance"
            hint="Unpaid labour / making charges with this factory when you started using this app (₹)."
          />
          <div className="col-span-2 rounded-xl border border-amber-500/30 bg-amber-500/5 p-3 space-y-2.5">
            <p className="text-xs font-semibold text-amber-700">Opening Gold Stock (optional)</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <div>
                <Label className="text-[11px]">Fine gold at factory (24KT grams)</Label>
                <Input type="number" min={0} step="0.001" value={f.openingFineGold != null ? String(f.openingFineGold) : ""}
                  onChange={e => setF({ ...f, openingFineGold: e.target.value === "" ? undefined : Number(e.target.value) })}
                  placeholder="0.000" className="rounded-lg mt-1 h-9" />
              </div>
              <div>
                <Label className="text-[11px]">As of date</Label>
                <Input type="date" value={f.openingFineGoldDate || ""}
                  onChange={e => setF({ ...f, openingFineGoldDate: e.target.value || undefined })}
                  className="rounded-lg mt-1 h-9" />
              </div>
            </div>
            <p className="text-[11px] text-muted-foreground">Pure (24KT) gold already lying with this factory. Added onto their Fine Gold balance.</p>
          </div>
        </div>
        <div className="flex justify-end"><Button onClick={create} disabled={saving} className="btn-hero rounded-xl max-sm:w-full sm:min-w-40">{saving ? "Creating…" : "Create Factory"}</Button></div>
      </DialogContent>
    </Dialog>
  );
}
