import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Pencil } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { useDb } from "@/hooks/useDb";
import { DIAMOND_SHAPES, type MaterialIssuance } from "@/lib/db";
import { editIssuance, isPoolDelivery, isPoolDraw } from "@/lib/issuanceEdit";
import { factoryPoolBalance } from "@/lib/manufacturing";
import { companyOf } from "@/lib/companies";
import { isOtherMaterial, materialName, materialUnit } from "@/lib/materials";
import { ActionSheet } from "@/components/ActionSheet";
import { AsyncButton } from "@/components/AsyncButton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const GOLD_PURITIES = ["9K", "10K", "14K", "18K", "22K", "24K"];

/**
 * Correct material issued to a factory — an order's issue, a bulk delivery or
 * an assignment into its pool, or an order's draw from that pool. Saved through
 * editIssuance (lib/issuanceEdit.ts): stock moves by the difference only, a
 * draw from the pool moves no stock, and a pool delivery cannot come down
 * below what orders have already drawn from it.
 */
export function IssuanceEditSheet({ issuance, onClose }: { issuance: MaterialIssuance | null; onClose: () => void }) {
  const { user } = useAuth();
  const db = useDb();
  const [f, setF] = useState({ qty: "", bucket: "", charge: "", notes: "" });
  useEffect(() => {
    if (!issuance) return;
    setF({
      qty: String(issuance.quantityIssued), bucket: issuance.purityOrQuality,
      charge: issuance.makingCharges.amountInr ? String(issuance.makingCharges.amountInr) : "",
      notes: issuance.notes ?? "",
    });
  }, [issuance]);

  const mi = issuance;
  const unit = materialUnit(db.settings, mi?.material);
  const certified = mi?.diamondKind === "certified";
  // Only a job for an order carries a making charge; a pool delivery has none.
  const charged = !!mi?.orderId;

  const save = async () => {
    if (!mi) return;
    // Every place this opens from offers it to an admin only (the factory's
    // page, Buy & Assign); checked again here, as the rules don't.
    if (user?.role !== "admin") { toast.error("Only an admin can change what was issued to a factory"); return; }
    const qty = Number(f.qty);
    if (!certified && (!qty || qty <= 0)) { toast.error(`Enter the ${unit === "g" ? "weight" : "quantity"}`); return; }
    try {
      await editIssuance(db, mi, {
        quantity: certified ? undefined : qty,
        purityOrQuality: f.bucket,
        chargeAmount: charged ? (f.charge === "" ? undefined : Number(f.charge) || 0) : undefined,
        notes: f.notes,
      }, user!.id);
      toast.success(isPoolDraw(mi) ? "Corrected — the factory's pool follows it" : "Corrected — stock moved by the difference");
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't correct this.");
    }
  };

  // What the pool holds, so a delivery's limit is visible before saving.
  const pool = mi && (isPoolDelivery(mi) || isPoolDraw(mi)) && !certified
    ? factoryPoolBalance(db.materialIssuances ?? [], mi.factoryId, mi.material, mi.purityOrQuality, companyOf(mi))
    : undefined;
  const factory = mi ? db.factories.find(x => x.id === mi.factoryId)?.name ?? "the factory" : "";

  return (
    <ActionSheet
      open={!!issuance}
      onOpenChange={o => { if (!o) onClose(); }}
      title={mi?.orderId ? "Correct this issue" : "Correct this assignment"}
      description={certified
        ? "These are specific certified stones, so the weight is the stones' own — only the charge and the note can change here. To swap the stones, cancel this and issue again."
        : mi && isPoolDraw(mi)
          ? `Drawn from ${factory}'s own pool — no stock moves; the pool goes up or down by the difference.`
          : "Stock moves by the difference only: correcting 0.2ct to 0.13ct puts 0.07ct back, it does not re-issue the lot."}
      icon={Pencil}
      size="md"
      footer={
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground">{factory}</p>
            <p className="font-display text-lg font-bold text-brand-dark leading-tight">
              {certified ? `${mi?.quantityIssued ?? 0}${unit}` : `${Number(f.qty) || 0}${unit}`} {f.bucket}
            </p>
          </div>
          <div className="flex gap-2.5 ml-auto">
            <Button variant="outline" onClick={onClose} className="rounded-xl h-10">Cancel</Button>
            <AsyncButton onClick={save} className="btn-hero rounded-xl h-10">Save Changes</AsyncButton>
          </div>
        </div>
      }
    >
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label htmlFor="issue-qty" className="text-xs">{mi?.material === "gold" ? "Weight (g)" : mi?.material === "diamond" ? "Carat (ct)" : `Quantity (${unit})`}</Label>
            <Input id="issue-qty" type="number" min={0} step="0.001" value={f.qty} disabled={certified}
              onChange={e => setF({ ...f, qty: e.target.value })} className="rounded-xl h-10 mt-1 disabled:opacity-60" />
          </div>
          <div>
            <Label className="text-xs">{mi?.material === "gold" ? "Purity" : mi?.material === "diamond" ? "Shape" : "Grade"}</Label>
            {isOtherMaterial(mi?.material) ? (
              // Its grade is its stock bucket — fixed, as on the order page.
              <div className="rounded-xl h-10 px-3 mt-1 flex items-center bg-secondary/60 text-sm text-muted-foreground">{mi?.purityOrQuality} · {materialName(db.settings, mi?.material)}</div>
            ) : certified ? (
              <div className="rounded-xl h-10 px-3 mt-1 flex items-center bg-secondary/60 text-sm text-muted-foreground">Certified</div>
            ) : (
              <Select value={f.bucket} onValueChange={v => setF({ ...f, bucket: v })}>
                <SelectTrigger className="h-10 rounded-xl mt-1" aria-label={mi?.material === "gold" ? "Purity" : "Shape"}><SelectValue /></SelectTrigger>
                <SelectContent>
                  {[...new Set([...(mi?.material === "gold" ? GOLD_PURITIES : DIAMOND_SHAPES), mi?.purityOrQuality ?? ""])].filter(Boolean)
                    .map(x => <SelectItem key={x} value={x}>{x}</SelectItem>)}
                </SelectContent>
              </Select>
            )}
          </div>
        </div>
        {pool != null && (
          <p className="text-[11px] text-muted-foreground">
            {factory}'s pool of {mi?.purityOrQuality} holds {pool}{unit} now.
            {mi && isPoolDelivery(mi) ? " This can come down by at most that — what orders have already drawn can't be taken back here." : " A bigger draw needs that much in the pool."}
          </p>
        )}
        {charged && (
          <div>
            <Label htmlFor="issue-charge" className="text-xs">Making charge (₹)</Label>
            <Input id="issue-charge" type="number" min={0} step="0.01" value={f.charge}
              onChange={e => setF({ ...f, charge: e.target.value })} className="rounded-xl h-10 mt-1" placeholder="0" />
          </div>
        )}
        <div>
          <Label htmlFor="issue-notes" className="text-xs">Notes</Label>
          <Input id="issue-notes" value={f.notes} onChange={e => setF({ ...f, notes: e.target.value })} className="rounded-xl h-10 mt-1" placeholder="Optional" />
        </div>
      </div>
    </ActionSheet>
  );
}
