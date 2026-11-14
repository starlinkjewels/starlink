import { GOLD_KARATS } from "@/lib/pure/basics";
import { LotPicker } from "@/components/LotFields";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Pencil } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { useDb } from "@/hooks/useDb";
import { hasSwitch } from "@/lib/access";
import { DIAMOND_SHAPES, type MaterialIssuance } from "@/lib/db";
import { editIssuance, isPoolDelivery, isPoolDraw } from "@/lib/issuanceEdit";
import { factoryPoolBalance } from "@/lib/manufacturing";
import { companyById, companyOf, hasCompanies } from "@/lib/companies";
import { isOtherMaterial, materialName, materialUnit } from "@/lib/materials";
import { ActionSheet } from "@/components/ActionSheet";
import { AsyncButton } from "@/components/AsyncButton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

// The one karat list (lib/pure/basics.ts GOLD_KARATS) — every gold dropdown offers the same.
const GOLD_PURITIES = GOLD_KARATS;

/** What an issue asked besides its weight and grade, as typed in the edit forms. */
export interface IssueExtraDraft { pcs: string; rate: string }
export const issueExtraDraft = (mi: MaterialIssuance): IssueExtraDraft => ({
  pcs: mi.piecesIssued != null ? String(mi.piecesIssued) : "",
  rate: mi.diamondSpec?.ratePerCaratInr ? String(mi.diamondSpec.ratePerCaratInr) : mi.diamondSpec?.amountInr && mi.quantityIssued > 0 ? String(Math.round(mi.diamondSpec.amountInr / mi.quantityIssued * 100) / 100) : "",
});
const looseOf = (mi: MaterialIssuance | null) => mi?.material === "diamond" && mi.diamondKind !== "certified";
/** Only what changed is sent — a field left as it was changes nothing. */
export function issueExtraEdit(mi: MaterialIssuance, x: IssueExtraDraft, qtyChanged: boolean): { pieces?: number | null; diamondRate?: number | null } {
  if (!looseOf(mi)) return {};
  const was = issueExtraDraft(mi);
  return {
    ...(x.pcs !== was.pcs ? { pieces: Number(x.pcs) > 0 ? Number(x.pcs) : null } : {}),
    // The amount is rate × carats, so a weight change re-works it too.
    ...(x.rate !== was.rate || (qtyChanged && Number(x.rate) > 0) ? { diamondRate: Number(x.rate) > 0 ? Number(x.rate) : null } : {}),
  };
}

/**
 * Everything else the issue forms asked (order page, factory page, Buy & Assign):
 * loose stones' count and the price a carat typed for them; and, fixed with the
 * reason, the factory and the company it went to.
 */
export function IssueExtraFields({ mi, value, onChange, qty }: { mi: MaterialIssuance | null; value: IssueExtraDraft; onChange: (x: IssueExtraDraft) => void; qty: number }) {
  const db = useDb();
  if (!mi) return null;
  const loose = looseOf(mi);
  const factory = db.factories.find(x => x.id === mi.factoryId)?.name ?? "—";
  const multi = hasCompanies(db.settings);
  return (
    <div className="space-y-2">
      {loose && (
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label htmlFor="issue-pcs" className="text-xs">Pcs</Label>
            <Input id="issue-pcs" type="number" min={0} step="1" value={value.pcs} onChange={e => onChange({ ...value, pcs: e.target.value })} className="rounded-xl h-10 mt-1" placeholder="Optional" />
          </div>
          {mi.orderId && (
            <div>
              <Label htmlFor="issue-rate" className="text-xs">Rate / ct (₹)</Label>
              <Input id="issue-rate" type="number" min={0} step="0.01" value={value.rate} onChange={e => onChange({ ...value, rate: e.target.value })} className="rounded-xl h-10 mt-1" placeholder="Stock average" />
              {Number(value.rate) > 0 && qty > 0 && <p className="text-[11px] text-muted-foreground mt-1">Amount ₹{(Math.round(Number(value.rate) * qty * 100) / 100).toLocaleString("en-IN")} — the order's cost uses it.</p>}
            </div>
          )}
        </div>
      )}
      <p className="text-[11px] text-muted-foreground">
        Factory: <span className="font-medium text-foreground">{factory}</span>{multi ? <> · Company: <span className="font-medium text-foreground">{companyById(db.settings, companyOf(mi)).name}</span></> : null} — to give it to another {multi ? "factory or company" : "factory"}, cancel this issue and issue it again.
      </p>
    </div>
  );
}

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
  const [extra, setExtra] = useState<IssueExtraDraft>({ pcs: "", rate: "" });
  useEffect(() => {
    if (!issuance) return;
    setExtra(issueExtraDraft(issuance));
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
    // Opened from the factory's page (factories.issue) and Buy & Assign
    // (buyAssign.changeAssign); checked again here.
    if (!(user?.role === "admin" || hasSwitch("factories.issue") || hasSwitch("buyAssign.changeAssign"))) { toast.error("Your access does not include changing what was issued to a factory"); return; }
    const qty = Number(f.qty);
    if (!certified && (!qty || qty <= 0)) { toast.error(`Enter the ${unit === "g" ? "weight" : "quantity"}`); return; }
    try {
      await editIssuance(db, mi, {
        quantity: certified ? undefined : qty,
        purityOrQuality: f.bucket,
        chargeAmount: charged ? (f.charge === "" ? undefined : Number(f.charge) || 0) : undefined,
        notes: f.notes,
        ...issueExtraEdit(mi, extra, !certified && Math.abs(qty - mi.quantityIssued) > 0.0005),
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
              mi?.material === "diamond" ? (
                // Loose: a lot in stock — or the one it already came from.
                <LotPicker value={f.bucket} onChange={v => setF({ ...f, bucket: v })} companyId={mi.companyId || "main"} className="h-10 rounded-xl mt-1" />
              ) : (
              <Select value={f.bucket} onValueChange={v => setF({ ...f, bucket: v })}>
                <SelectTrigger className="h-10 rounded-xl mt-1" aria-label="Purity"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {[...new Set([...GOLD_PURITIES, mi?.purityOrQuality ?? ""])].filter(Boolean)
                    .map(x => <SelectItem key={x} value={x}>{x}</SelectItem>)}
                </SelectContent>
              </Select>
              )
            )}
          </div>
        </div>
        {pool != null && (
          <p className="text-[11px] text-muted-foreground">
            {factory}'s pool of {mi?.purityOrQuality} holds {pool}{unit} now.
            {mi && isPoolDelivery(mi) ? " This can come down by at most that — what orders have already drawn can't be taken back here." : " A bigger draw needs that much in the pool."}
          </p>
        )}
        <IssueExtraFields mi={mi} value={extra} onChange={setExtra} qty={Number(f.qty) || 0} />
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
