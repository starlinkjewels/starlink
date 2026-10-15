import { useState } from "react";
import { toast } from "sonner";
import { ArrowRightLeft } from "lucide-react";
import { updateDbAs, type MaterialKey } from "@/lib/db";
import { useDb } from "@/hooks/useDb";
import { useAuth } from "@/lib/auth";
import { companiesOf, companyById, MAIN_COMPANY_ID } from "@/lib/companies";
import { factoryPoolBuckets } from "@/lib/manufacturing";
import { applyPoolTransfer, poolTransferBlocker } from "@/lib/companyTransfer";
import { activeMaterials, materialUnit, materialName, fmtQty } from "@/lib/materials";
import { Button } from "@/components/ui/button";
import { AsyncButton } from "@/components/AsyncButton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

/** Move one company's share of this factory's pool to another of our companies (lib/companyTransfer.ts). */
export function FactoryPoolTransferDialog({ factoryId, onClose }: { factoryId: string; onClose: () => void }) {
  const db = useDb();
  const { user } = useAuth();
  const cos = companiesOf(db.settings, true);
  const factory = db.factories.find(f => f.id === factoryId);
  const [from, setFrom] = useState(MAIN_COMPANY_ID);
  const [to, setTo] = useState(cos.find(c => c.id !== MAIN_COMPANY_ID)?.id ?? "");
  const [material, setMaterial] = useState<MaterialKey>("gold");
  const [bucket, setBucket] = useState("");
  const [qty, setQty] = useState("");
  const unit = materialUnit(db.settings, material);
  const buckets = factoryPoolBuckets(db.materialIssuances ?? [], factoryId, material, from);
  const have = buckets.find(b => b.purityOrQuality === bucket)?.balance ?? 0;
  const mats: { key: MaterialKey; name: string }[] = [{ key: "gold", name: "Gold" }, { key: "diamond", name: "Diamond" }, ...activeMaterials(db.settings).map(m => ({ key: m.id, name: m.name }))];

  const go = () => {
    if (!user) return;
    const a = { factoryId, material, bucket, quantity: Number(qty) || 0, from, to };
    if (!bucket) { toast.error("Choose what to move"); return; }
    const why = poolTransferBlocker(db, a);
    if (why) { toast.error(why); return; }
    const fromName = companyById(db.settings, from).name, toName = companyById(db.settings, to).name;
    updateDbAs({ summary: `Moved ${fmtQty(a.quantity, unit)} ${bucket} ${materialName(db.settings, material)} at ${factory?.name ?? "the factory"} from ${fromName} to ${toName}` }, d => {
      applyPoolTransfer(d, { ...a, by: user.id, at: new Date().toISOString(), note: `Moved from ${fromName} at the factory` });
    });
    toast.success(`${fmtQty(a.quantity, unit)} ${bucket} at ${factory?.name ?? "the factory"} is now ${toName}'s`);
    onClose();
  };

  const coSelect = (value: string, set: (v: string) => void, label: string) => (
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>
      <Select value={value} onValueChange={v => { set(v); setBucket(""); }}>
        <SelectTrigger className="h-10 rounded-xl" aria-label={label}><SelectValue placeholder="Choose" /></SelectTrigger>
        <SelectContent>{cos.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
      </Select>
    </div>
  );

  return (
    <Dialog open onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-2xl rounded-2xl">
        <DialogHeader>
          <DialogTitle className="font-display text-2xl flex items-center gap-2"><ArrowRightLeft className="h-5 w-5 text-primary" /> Move at {factory?.name ?? "the factory"}</DialogTitle>
          <DialogDescription className="text-xs">One company&rsquo;s share of the material this factory holds becomes another company&rsquo;s — for when one company&rsquo;s orders use what the other delivered. Nothing leaves the factory and no stock moves.</DialogDescription>
        </DialogHeader>
        <div className="grid sm:grid-cols-2 gap-3">
          {coSelect(from, setFrom, "From")}
          {coSelect(to, setTo, "To")}
          <div className="space-y-1">
            <Label className="text-xs">Material</Label>
            <Select value={material} onValueChange={v => { setMaterial(v as MaterialKey); setBucket(""); }}>
              <SelectTrigger className="h-10 rounded-xl" aria-label="Material"><SelectValue /></SelectTrigger>
              <SelectContent>{mats.map(m => <SelectItem key={m.key} value={m.key}>{m.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">{material === "gold" ? "Purity" : material === "diamond" ? "Shape" : "Grade"}</Label>
            <Select value={bucket} onValueChange={setBucket}>
              <SelectTrigger className="h-10 rounded-xl" aria-label="What"><SelectValue placeholder={buckets.length ? "Choose" : "Nothing in this pool"} /></SelectTrigger>
              <SelectContent>{buckets.map(b => <SelectItem key={b.purityOrQuality} value={b.purityOrQuality}>{b.purityOrQuality} · {fmtQty(b.balance, unit)}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1 sm:col-span-2">
            <Label className="text-xs" htmlFor="pt_qty">How much ({unit})</Label>
            <Input id="pt_qty" type="number" inputMode="decimal" min="0" step="0.001" value={qty} onChange={e => setQty(e.target.value)} className="h-10 rounded-xl" placeholder={bucket ? `up to ${fmtQty(have, unit)}` : "0"} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} className="rounded-xl">Cancel</Button>
          <AsyncButton onClick={go} className="btn-hero rounded-xl gap-1.5"><ArrowRightLeft className="h-4 w-4" /> Move</AsyncButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
