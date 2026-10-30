import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Boxes, Pencil, Trash2 } from "lucide-react";
import { useDb } from "@/hooks/useDb";
import { loadDb } from "@/lib/db";
import { lotKey, lotParts } from "@/lib/diamondLots";
import { bagNoOf } from "@/lib/diamondBags";
import { LooseLotFields, lotFromDraft, type LooseLotDraft } from "@/components/LotFields";
import { useAuth } from "@/lib/auth";
import { dayOf, type DB, type StockMovement } from "@/lib/db";
import { fmtQty, materialName, materialUnit } from "@/lib/materials";
import { fmtMoneyInr } from "@/lib/manufacturing";
import {
  deleteOpeningStock, editOpeningStock, openingDeleteImpact, openingRefusal, openingRoom, refileOpeningLot,
} from "@/lib/openingStock";
import { confirmBox } from "@/lib/confirm";
import type { MoreAction } from "@/components/MoreMenu";
import { ActionSheet } from "@/components/ActionSheet";
import { AsyncButton } from "@/components/AsyncButton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const what = (db: DB, m: StockMovement) =>
  `${m.purityOrQuality}${m.material === "gold" || m.material === "diamond" ? ` ${m.material}` : ` ${materialName(db.settings, m.material)}`}`;

/** Ask, then remove an opening-stock entry (lib/openingStock.ts). */
export async function removeOpeningStock(db: DB, m: StockMovement): Promise<void> {
  const unit = materialUnit(db.settings, m.material);
  if (!(await confirmBox([
    `Remove this opening stock of ${fmtQty(m.quantity, unit)} ${what(db, m)}?`,
    "",
    ...openingDeleteImpact(db, m),
    "",
    "This cannot be undone.",
  ].join("\n")))) return;
  try {
    await deleteOpeningStock(db, m);
    toast.success("Opening stock removed — stock is down by the same");
  } catch (e) {
    toast.error(e instanceof Error ? e.message : "Couldn't remove this.");
  }
}

/**
 * The ⋯ actions on an opening-stock row, wherever it is listed (the Stock
 * page's movements, Buy & Assign's ledger). Remove is greyed out with how much
 * is still in stock when the rest has since been used.
 */
export function openingStockActions(db: DB, m: StockMovement, opts: {
  onEdit: () => void;
  /** Why the person may not, when they may not. */
  editDenied?: string;
  deleteDenied?: string;
}): MoreAction[] {
  const blocked = opts.deleteDenied ? undefined : openingRefusal(db, m, null);
  return [
    { label: "Edit opening stock", icon: Pencil, onSelect: opts.onEdit, disabled: !!opts.editDenied,
      hint: opts.editDenied ?? "Quantity, value, date and note" },
    { label: "Remove opening stock", icon: Trash2, danger: true, onSelect: () => removeOpeningStock(db, m),
      disabled: !!opts.deleteDenied || !!blocked,
      hint: opts.deleteDenied ?? blocked ?? "It comes out of stock; nothing else changes" },
  ];
}

/**
 * Correct an opening-stock entry: how much, what it was worth, as of when, and
 * its note. The stock counter moves by the difference; the entry's own line in
 * the ledger is corrected where it stands.
 */
export function OpeningStockEditSheet({ movement, onClose }: { movement: StockMovement | null; onClose: () => void }) {
  const db = useDb();
  const { user } = useAuth();
  const [f, setF] = useState({ qty: "", value: "", date: "", note: "" });
  // Loose diamonds: the bag it is in (shape · mm · sieve · colour · clarity) and its pieces.
  const [lot, setLot] = useState<LooseLotDraft>({ shape: "Round", mm: "", size: "", color: "", clarity: "" });
  const [pcs, setPcs] = useState("");
  useEffect(() => {
    if (movement) {
      setF({
        qty: String(movement.quantity), value: movement.valueInr ? String(movement.valueInr) : "",
        date: dayOf(movement.createdAt), note: movement.note ?? "",
      });
      const p = lotParts(movement.purityOrQuality, movement.lot);
      setLot({ shape: p.shape, type: p.type ?? "", mm: p.mm ?? "", size: p.size ?? "", color: p.color ?? "", clarity: p.clarity ?? "" });
      setPcs(movement.pieces != null ? String(movement.pieces) : "");
    }
  }, [movement]);

  const m = movement;
  const unit = materialUnit(db.settings, m?.material);
  const room = m ? openingRoom(db, m) : 0;
  const loose = !!m && m.material === "diamond" && m.purityOrQuality !== "Certified";
  const newKey = lotKey(lotFromDraft(lot));
  const bagMoves = loose && newKey !== m!.purityOrQuality;
  const pcsNow = m?.pieces != null ? String(m.pieces) : "";

  const save = async () => {
    if (!m) return;
    // Offered to an admin only (the Stock page, Buy & Assign); checked again
    // here, as the rules don't.
    if (user?.role !== "admin") { toast.error("Only an admin can change stock"); return; }
    const qty = Number(f.qty);
    if (!qty || qty <= 0) { toast.error("Enter the opening quantity"); return; }
    const figuresChanged = qty !== m.quantity || (Number(f.value) || 0) !== (m.valueInr ?? 0) || f.date !== dayOf(m.createdAt) || f.note.trim() !== (m.note ?? "");
    const lotChanged = loose && (bagMoves || pcs !== pcsNow
      || JSON.stringify(lotFromDraft(lot)) !== JSON.stringify(lotParts(m.purityOrQuality, m.lot)));
    try {
      if (figuresChanged) await editOpeningStock(db, m, { quantity: qty, valueInr: Number(f.value) || 0, date: f.date, note: f.note });
      if (lotChanged) {
        // Worked out from the entry as it now stands (the figures may just have changed).
        const fresh = (loadDb().stockMovements ?? []).find(x => x.id === m.id) ?? m;
        await refileOpeningLot(fresh, lotFromDraft(lot), Number(pcs) > 0 ? Number(pcs) : undefined, { userId: user?.id });
      }
      toast.success(bagMoves ? `Moved into ${bagNoOf(loadDb(), newKey) ?? "its bag"} · ${newKey}` : "Opening stock corrected — stock moved by the difference");
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't correct this.");
    }
  };

  // Said before saving, the way the save would refuse.
  const qty = Number(f.qty) || 0;
  const tooLow = !!m && qty > 0 && qty < m.quantity && openingRefusal(db, m, { quantity: qty, createdAt: m.createdAt });

  return (
    <ActionSheet
      open={!!movement}
      onOpenChange={o => { if (!o) onClose(); }}
      title="Correct opening stock"
      description={m ? <>{what(db, m)} owned from before the app. No supplier and no dues — only stock and its ledger line change.</> : undefined}
      icon={Boxes}
      size="md"
      footer={
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground">Opening stock</p>
            <p className="font-display text-lg font-bold text-brand-dark leading-tight">{qty > 0 ? fmtQty(qty, unit) : "—"}</p>
            {m && qty > 0 && Math.abs(qty - m.quantity) > 0.0005 && (
              <p className="text-[11px] text-muted-foreground">Stock {qty > m.quantity ? "up" : "down"} by {fmtQty(Math.abs(qty - m.quantity), unit)}</p>
            )}
          </div>
          <div className="flex gap-2.5 ml-auto">
            <Button variant="outline" onClick={onClose} className="rounded-xl h-10">Cancel</Button>
            <AsyncButton onClick={save} disabled={!!tooLow} className="btn-hero rounded-xl h-10">Save Changes</AsyncButton>
          </div>
        </div>
      }
    >
      <div className="space-y-3">
        {loose && (
          <div className="space-y-2 rounded-xl border border-border/60 bg-secondary/30 p-3">
            <p className="text-xs font-semibold text-brand-dark">Bag · now {bagNoOf(db, m!.purityOrQuality) ?? "no bag no."} · {m!.purityOrQuality}</p>
            <LooseLotFields idPrefix="open-edit" compact bagPicker={false} companyId={m!.companyId || "main"} value={lot} onChange={p => setLot(l => ({ ...l, ...p }))} />
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="opening-pcs" className="text-xs">Pcs</Label>
                <Input id="opening-pcs" type="number" min={0} step="1" value={pcs} onChange={e => setPcs(e.target.value)} className="rounded-xl h-10 mt-1" placeholder="Optional" />
              </div>
            </div>
            {bagMoves && (
              <p className="text-[11px] text-primary font-medium">
                These {m!.quantity} ct move out of {m!.purityOrQuality} into {newKey}{room < m!.quantity - 0.0005 ? " — but only what is still in the bag can move" : ""}.
              </p>
            )}
          </div>
        )}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label htmlFor="opening-qty" className="text-xs">Quantity ({unit})</Label>
            <Input id="opening-qty" type="number" min={0} step="0.001" value={f.qty} onChange={e => setF({ ...f, qty: e.target.value })} className="rounded-xl h-10 mt-1" />
          </div>
          <div>
            <Label htmlFor="opening-value" className="text-xs">Value (₹, optional)</Label>
            <Input id="opening-value" type="number" min={0} value={f.value} onChange={e => setF({ ...f, value: e.target.value })} className="rounded-xl h-10 mt-1" placeholder="Valuation for the ledger" />
          </div>
          <div>
            <Label htmlFor="opening-date" className="text-xs">As of date</Label>
            <Input id="opening-date" type="date" value={f.date} onChange={e => setF({ ...f, date: e.target.value })} className="rounded-xl h-10 mt-1" />
          </div>
          <div>
            <Label htmlFor="opening-note" className="text-xs">Note</Label>
            <Input id="opening-note" value={f.note} onChange={e => setF({ ...f, note: e.target.value })} className="rounded-xl h-10 mt-1" placeholder="e.g. carried forward" />
          </div>
        </div>
        {m && room < m.quantity - 0.0005 && (
          <p className={`text-[11px] ${tooLow ? "text-destructive" : "text-muted-foreground"}`}>
            At most {fmtQty(room, unit)} can come off — the rest has since been issued, used or sold.
          </p>
        )}
        {Number(f.value) > 0 && qty > 0 && (
          <p className="text-[11px] text-muted-foreground">Works out to {fmtMoneyInr(Number(f.value) / qty)} per {unit}.</p>
        )}
      </div>
    </ActionSheet>
  );
}
