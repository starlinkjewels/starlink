import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Handshake } from "lucide-react";
import { updateDb, uid, type Broker } from "@/lib/db";
import { useDb } from "@/hooks/useDb";
import { OpeningBalanceFields } from "@/components/OpeningBalanceFields";
import { ActionSheet } from "@/components/ActionSheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Form = { name: string; phone: string; pct: string; notes: string; supplierIds: string[]; openingBalance?: number; openingDir?: Broker["openingDir"]; openingDate?: string };
const EMPTY: Form = { name: "", phone: "", pct: "", notes: "", supplierIds: [] };
const formOf = (b?: Broker): Form => b
  ? { name: b.name, phone: b.phone ?? "", pct: b.brokeragePct != null ? String(b.brokeragePct) : "", notes: b.notes ?? "", supplierIds: b.supplierIds ?? [], openingBalance: b.openingBalance, openingDir: b.openingDir, openingDate: b.openingDate }
  : EMPTY;

/**
 * Add or change a broker (dalal) — Suppliers → Brokers, and "+ Add new broker"
 * wherever a broker is picked on a purchase. Their usual brokerage % fills in
 * on a bill and can be changed there.
 */
export function BrokerCreateDialog({ open, onOpenChange, onCreated, broker }: {
  open: boolean; onOpenChange: (v: boolean) => void; onCreated?: (id: string) => void;
  /** Editing this broker; absent = a new one. */
  broker?: Broker;
}) {
  const db = useDb();
  const [saving, setSaving] = useState(false);
  const [f, setF] = useState<Form>(formOf(broker));
  const [supQ, setSupQ] = useState("");
  const suppliers = db.suppliers.filter(s => s.active !== false || f.supplierIds.includes(s.id)).sort((a, b) => a.name.localeCompare(b.name));
  const shownSuppliers = suppliers.filter(s => !supQ.trim() || s.name.toLowerCase().includes(supQ.trim().toLowerCase()));
  const toggleSupplier = (sid: string) => setF(x => ({ ...x, supplierIds: x.supplierIds.includes(sid) ? x.supplierIds.filter(i => i !== sid) : [...x.supplierIds, sid] }));
  useEffect(() => { if (open) setF(formOf(broker)); }, [open, broker]);

  const save = () => {
    const name = f.name.trim();
    if (!name) { toast.error("Enter the broker's name"); return; }
    const pct = f.pct.trim() === "" ? undefined : Number(f.pct);
    if (pct !== undefined && (!Number.isFinite(pct) || pct < 0 || pct > 20)) { toast.error("Brokerage % should be between 0 and 20"); return; }
    setSaving(true);
    try {
      const fields = {
        name, phone: f.phone.trim() || undefined, brokeragePct: pct, notes: f.notes.trim() || undefined,
        supplierIds: f.supplierIds.length ? f.supplierIds : undefined,
        openingBalance: f.openingBalance, openingDir: f.openingDir, openingDate: f.openingDate,
      };
      const id = broker?.id ?? uid("brk_");
      updateDb(d => {
        if (!d.brokers) d.brokers = [];
        const b = d.brokers.find(x => x.id === id);
        if (b) Object.assign(b, fields);
        else d.brokers.unshift({ ...fields, id, active: true, createdAt: new Date().toISOString() });
      });
      toast.success(broker ? "Broker updated" : "Broker added");
      onOpenChange(false);
      if (!broker) { setF(EMPTY); onCreated?.(id); }
    } finally { setSaving(false); }
  };

  return (
    <ActionSheet
      open={open}
      onOpenChange={onOpenChange}
      title={broker ? "Edit Broker" : "Add Broker"}
      description="Their usual brokerage and any opening balance"
      icon={Handshake}
      size="md"
      footer={
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{broker ? "Broker" : "New broker"}</p>
            <p className="text-sm font-semibold text-brand-dark truncate">{f.name.trim() || "—"}{f.pct.trim() ? ` · ${f.pct.trim()}%` : ""}</p>
          </div>
          <div className="flex gap-2 sm:shrink-0">
            <Button variant="outline" onClick={() => onOpenChange(false)} className="rounded-xl flex-1 sm:flex-none">Cancel</Button>
            <Button onClick={save} disabled={saving} className="btn-hero rounded-xl px-6 flex-1 sm:flex-none sm:min-w-40">{saving ? "Saving…" : broker ? "Save" : "Create Broker"}</Button>
          </div>
        </div>
      }
    >
      <div className="grid grid-cols-2 gap-x-3 gap-y-4">
        <div className="col-span-2">
          <Label htmlFor="brk-name" className="text-xs">Name</Label>
          <Input id="brk-name" value={f.name} onChange={e => setF({ ...f, name: e.target.value })} className="rounded-xl mt-1" autoFocus />
        </div>
        <div>
          <Label htmlFor="brk-phone" className="text-xs">Phone</Label>
          <Input id="brk-phone" value={f.phone} onChange={e => setF({ ...f, phone: e.target.value })} className="rounded-xl mt-1" inputMode="tel" />
        </div>
        <div>
          <Label htmlFor="brk-pct" className="text-xs">Usual brokerage (%)</Label>
          <Input id="brk-pct" type="number" min={0} max={20} step="0.01" value={f.pct} onChange={e => setF({ ...f, pct: e.target.value })} className="rounded-xl mt-1" placeholder="e.g. 1" />
        </div>
        <div className="col-span-2">
          <Label htmlFor="brk-notes" className="text-xs">Notes</Label>
          <Input id="brk-notes" value={f.notes} onChange={e => setF({ ...f, notes: e.target.value })} className="rounded-xl mt-1" placeholder="Optional" />
        </div>
        {/* The suppliers whose goods they bring — choosing one of these on a bill brings this broker in. */}
        <div className="col-span-2 space-y-2">
          <Label className="text-xs">Suppliers they deal with{f.supplierIds.length ? ` · ${f.supplierIds.length} chosen` : ""}</Label>
          {suppliers.length > 6 && <Input value={supQ} onChange={e => setSupQ(e.target.value)} className="rounded-xl h-9" placeholder="Search suppliers" />}
          <div className="rounded-xl border border-border/60 bg-white max-h-48 overflow-y-auto divide-y divide-border/40">
            {shownSuppliers.length === 0 && <p className="px-3 py-2.5 text-xs text-muted-foreground">{suppliers.length ? "No supplier matches." : "No suppliers yet."}</p>}
            {shownSuppliers.map(s => (
              <label key={s.id} className="flex items-center gap-2.5 px-3 py-2 text-sm cursor-pointer hover:bg-secondary/40">
                <input type="checkbox" checked={f.supplierIds.includes(s.id)} onChange={() => toggleSupplier(s.id)} className="h-4 w-4" />
                <span className="truncate">{s.name}</span>
              </label>
            ))}
          </div>
        </div>
        <OpeningBalanceFields
          amount={f.openingBalance != null ? String(f.openingBalance) : ""}
          dir={f.openingDir || "credit"}
          date={f.openingDate || ""}
          onAmount={v => setF({ ...f, openingBalance: v === "" ? undefined : Number(v) })}
          onDir={v => setF({ ...f, openingDir: v })}
          onDate={v => setF({ ...f, openingDate: v || undefined })}
          debitLabel="Broker owes us (Debit)"
          creditLabel="We owe broker (Credit)"
          hint="Brokerage owed either way when you started using the app (₹)."
        />
      </div>
    </ActionSheet>
  );
}
