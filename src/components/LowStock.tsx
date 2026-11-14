// Low stock (lib/reorder.ts): the Stock page's list of lines below their reorder level, with
// Order more (a purchase order filled in for what is short), and the panel that sets a level.
import { useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, ClipboardList, Gauge } from "lucide-react";
import { useDb } from "@/hooks/useDb";
import { useHas } from "@/hooks/useCan";
import { useAuth } from "@/lib/auth";
import { lowStock, lineBalance, lineName, reorderLevelOf, reorderPoLine, setReorderLevel, type LowLine } from "@/lib/reorder";
import { fmtQty, materialUnit } from "@/lib/materials";
import { ActionSheet } from "@/components/ActionSheet";
import { PoSheet } from "@/components/PurchaseOrders";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/** Stock page: what is below its level, for the company being looked at. Nothing when nothing is. */
export function LowStockBox({ companyId }: { companyId: string }) {
  const db = useDb();
  const { user } = useAuth();
  const has = useHas();
  const mayOrder = has("suppliers.purchase");
  const isAdmin = user?.role === "admin";
  const low = lowStock(db, companyId);
  const [ordering, setOrdering] = useState<LowLine | null>(null);
  const [leveling, setLeveling] = useState<LowLine | null>(null);
  if (!low.length) return null;
  return (
    <div className="rounded-2xl border border-amber-300/70 bg-amber-50/60 p-4 space-y-2">
      <p className="flex items-center gap-2 text-sm font-semibold text-amber-900"><AlertTriangle className="h-4 w-4" /> Low stock — {low.length} line{low.length === 1 ? "" : "s"} below the level set</p>
      <ul className="divide-y divide-amber-200/70">
        {low.map(l => (
          <li key={`${l.level.material}|${l.level.bucket}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm">
            <span className="font-medium text-brand-dark min-w-[10rem] flex-1">{l.name}</span>
            <span className="tabular-nums text-amber-900">{fmtQty(l.onHand, l.unit)} left · level {fmtQty(l.level.min, l.unit)} · {fmtQty(l.short, l.unit)} short</span>
            <span className="flex gap-1.5">
              {mayOrder && <Button size="sm" onClick={() => setOrdering(l)} className="btn-hero h-8 rounded-lg gap-1.5"><ClipboardList className="h-3.5 w-3.5" /> Order more</Button>}
              {isAdmin && <Button size="sm" variant="outline" onClick={() => setLeveling(l)} className="h-8 rounded-lg">Level</Button>}
            </span>
          </li>
        ))}
      </ul>
      {ordering && <PoSheet open onOpenChange={v => { if (!v) setOrdering(null); }} companyId={companyId}
        initialLines={[reorderPoLine(db, ordering.level.material, ordering.level.bucket, ordering.short)]} />}
      {leveling && <ReorderLevelSheet material={leveling.level.material} bucket={leveling.level.bucket} companyId={companyId} onClose={() => setLeveling(null)} />}
    </div>
  );
}

/** Set or clear a line's reorder level (admins). */
export function ReorderLevelSheet({ material, bucket, companyId, onClose }: { material: string; bucket: string; companyId: string; onClose: () => void }) {
  const db = useDb();
  const unit = materialUnit(db.settings, material);
  const now = reorderLevelOf(db, material, bucket, companyId);
  const [min, setMin] = useState(now ? String(now.min) : "");
  const onHand = lineBalance(db, material, bucket, companyId);
  const save = (clear = false) => {
    const v = clear || min.trim() === "" ? null : Number(min);
    try {
      setReorderLevel(material, bucket, companyId, v);
      toast.success(v ? `Reorder level ${fmtQty(v, unit)} — ${lineName(db, material, bucket)}` : "Reorder level taken off");
      onClose();
    } catch (e) { toast.error(e instanceof Error ? e.message : "Couldn't save"); }
  };
  return (
    <ActionSheet open onOpenChange={o => { if (!o) onClose(); }} size="md" icon={Gauge} title={`Reorder level — ${lineName(db, material, bucket)}`}
      description={`${fmtQty(onHand, unit)} on hand${companyId && companyId !== "all" ? "" : " (every company together)"}. Below the level, it shows as low stock, with Order more.`}
      footer={<div className="flex justify-end gap-2">
        {now && <Button variant="outline" onClick={() => save(true)} className="rounded-xl">Take off</Button>}
        <Button variant="outline" onClick={onClose} className="rounded-xl">Cancel</Button>
        <Button onClick={() => save()} className="btn-hero rounded-xl px-6">Save</Button>
      </div>}>
      <div className="space-y-1.5">
        <Input type="number" inputMode="decimal" min={0} step="0.001" value={min} onChange={e => setMin(e.target.value)} className="rounded-xl h-10 w-40" aria-label={`Reorder level (${unit})`} placeholder={unit} />
        <p className="text-[11px] text-muted-foreground">When it is lower than this ({unit}), it is low.</p>
      </div>
    </ActionSheet>
  );
}
