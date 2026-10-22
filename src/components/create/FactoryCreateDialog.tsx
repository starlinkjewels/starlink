import { useState } from "react";
import { toast } from "sonner";
import { Factory as FactoryIcon } from "lucide-react";
import { updateDb, uid, type Factory } from "@/lib/db";
import { OpeningBalanceFields } from "@/components/OpeningBalanceFields";
import { ActionSheet } from "@/components/ActionSheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FactoryLabourFields, labourDraftOf, labourOf, type LabourDraft } from "@/components/FactoryLabourFields";

const EMPTY: Partial<Factory> = { name: "", contactPerson: "", phone: "", email: "", address: "" };

/**
 * The one Add Factory form — the Factories page's, also opened from "+ Add new
 * factory". A panel from the right, so whatever it was opened from stays put.
 */
export function FactoryCreateDialog({ open, onOpenChange, onCreated }: {
  open: boolean; onOpenChange: (v: boolean) => void; onCreated?: (id: string) => void;
}) {
  const [saving, setSaving] = useState(false);
  const [f, setF] = useState<Partial<Factory>>(EMPTY);
  const [labour, setLabour] = useState<LabourDraft>(labourDraftOf());

  const create = () => {
    if (!f.name?.trim()) { toast.error("Enter a factory name"); return; }
    if (f.email?.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(f.email.trim())) { toast.error("That email address doesn't look right"); return; }
    setSaving(true);
    try {
      const id = uid("fac_");
      updateDb(d => {
        if (!d.factories) d.factories = [];
        const rates = labourOf(labour);
        d.factories.unshift({ ...f, name: f.name!.trim(), email: f.email?.trim() || undefined, id, active: true, createdAt: new Date().toISOString(), ...(rates ? { labour: rates } : {}) } as Factory);
      });
      toast.success("Factory added");
      onOpenChange(false);
      setF(EMPTY);
      setLabour(labourDraftOf());
      onCreated?.(id);
    } finally { setSaving(false); }
  };

  return (
    <ActionSheet
      open={open}
      onOpenChange={onOpenChange}
      title="Add Factory"
      description="Their details, and labour or gold already with them"
      icon={FactoryIcon}
      size="md"
      footer={
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">New factory</p>
            <p className="text-sm font-semibold text-brand-dark truncate">{f.name?.trim() || "—"}</p>
          </div>
          <div className="flex gap-2 sm:shrink-0">
            <Button variant="outline" onClick={() => onOpenChange(false)} className="rounded-xl flex-1 sm:flex-none">Cancel</Button>
            <Button onClick={create} disabled={saving} className="btn-hero rounded-xl px-6 flex-1 sm:flex-none sm:min-w-40">{saving ? "Creating…" : "Create Factory"}</Button>
          </div>
        </div>
      }
    >
      <div className="grid grid-cols-2 gap-x-3 gap-y-4">
        {(["name", "contactPerson", "phone", "email", "address"] as const).map(k => (
          <div key={k} className={k === "address" || k === "name" ? "col-span-2" : ""}>
            <Label className="text-xs capitalize">{k === "contactPerson" ? "Contact Person / Karigar" : k.replace(/([A-Z])/g, " $1")}</Label>
            <Input type={k === "email" ? "email" : "text"} value={(f as Record<string, string>)[k] || ""} onChange={e => setF({ ...f, [k]: e.target.value })} className="rounded-xl mt-1" />
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
          hint="Unpaid making charges when you started using the app (₹)."
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
          <p className="text-[11px] text-muted-foreground">24KT gold already with them — added to their fine gold.</p>
        </div>
        <div className="col-span-2"><FactoryLabourFields value={labour} onChange={setLabour} idPrefix="fac-new-labour" /></div>
      </div>
    </ActionSheet>
  );
}
