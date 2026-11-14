import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { PackageMinus } from "lucide-react";
import { ActionSheet } from "@/components/ActionSheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { updateDb, type ReadyStockItem } from "@/lib/db";
import { useAuth } from "@/lib/auth";
import { QTY_REASONS, setQtyWithReason, whoOf, type QtyReason } from "@/lib/readyStockHistory";

/**
 * Ready Stock − / +: the count changed by hand, with its reason (a stock adjustment) — never in
 * one tap. Kept in the piece's history; the toast's Undo puts it back as its own line.
 * A sale goes through Sell (an order), never through here.
 */
export function QtyAdjustSheet({ item, delta, onClose, sellHref }: {
  item: ReadyStockItem | null;
  /** −1 or +1: what the tap asked for — the box starts there. */
  delta: number;
  onClose: () => void;
  /** Where Sell goes for this piece, when the person may sell. */
  sellHref?: string;
}) {
  const { user } = useAuth();
  const [qty, setQty] = useState("");
  const [reason, setReason] = useState<QtyReason | "">("");
  const [note, setNote] = useState("");
  useEffect(() => {
    if (!item) return;
    setQty(String(Math.max(0, item.quantity + delta)));
    setReason(""); setNote("");
  }, [item, delta]);
  if (!item) return null;
  const to = qty.trim() === "" ? NaN : Number(qty);

  const save = () => {
    if (!Number.isInteger(to) || to < 0) { toast.error("The count: a whole number, 0 or more"); return; }
    if (to === item.quantity) { toast.error(`It is ${item.quantity} already — nothing to change`); return; }
    if (!reason) { toast.error("Pick why the count changes"); return; }
    if (reason === "other" && !note.trim()) { toast.error("Other: say in a few words what happened"); return; }
    const who = whoOf(user);
    let was: number | null = null;
    updateDb(d => { was = setQtyWithReason(d, item.id, to, reason, note, who); });
    if (was == null) { onClose(); return; }
    const from = was as number;
    toast.success(`${item.name}: ${from} → ${to}`, {
      action: { label: "Undo", onClick: () => { updateDb(d => { setQtyWithReason(d, item.id, from, "undo", "", who); }); toast.success(`Back to ${from}`); } },
    });
    onClose();
  };

  return (
    <ActionSheet open onOpenChange={o => { if (!o) onClose(); }} size="md" icon={PackageMinus} title={`Change quantity — ${item.name}`}
      description={`Now ${item.quantity} on the shelf. Each change is kept in the piece's history with its reason.`}
      footer={<div className="flex justify-end gap-2"><Button variant="outline" onClick={onClose} className="rounded-xl">Cancel</Button><Button onClick={save} className="btn-hero rounded-xl px-6">Save</Button></div>}>
      <div className="space-y-4">
        <div>
          <Label htmlFor="rs-qty" className="text-xs">New quantity</Label>
          <Input id="rs-qty" type="number" inputMode="numeric" min={0} step={1} value={qty} onChange={e => setQty(e.target.value)} className="rounded-xl h-10 mt-1 w-32" />
        </div>
        <div>
          <p className="text-xs font-medium mb-1.5">Why</p>
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Why the count changes">
            {QTY_REASONS.map(r => (
              <button key={r.key} type="button" role="radio" aria-checked={reason === r.key} onClick={() => setReason(r.key)}
                className={`min-h-9 rounded-full border px-3 text-sm transition-colors ${reason === r.key ? "border-primary bg-primary/10 text-primary font-medium" : "border-border hover:bg-secondary"}`}>
                {r.label}
              </button>
            ))}
          </div>
        </div>
        <div>
          <Label htmlFor="rs-note" className="text-xs">Note <span className="font-normal text-muted-foreground">· {reason === "other" ? "needed" : "optional"}</span></Label>
          <Input id="rs-note" value={note} onChange={e => setNote(e.target.value)} maxLength={140} className="rounded-xl h-10 mt-1" placeholder="e.g. stone loose — sent for repair" />
          <p className="text-[11px] text-muted-foreground mt-1">Anyone who can see the piece can read it — no client names or costs.</p>
        </div>
        <p className="text-xs text-muted-foreground rounded-xl bg-secondary/40 px-3 py-2">
          Sold it? {sellHref ? <Link to={sellHref} onClick={onClose} className="font-medium text-primary hover:underline">Sell</Link> : "Use Sell"} instead — it makes the order, so the money and the piece's story stay right. Back from a client? Record the return on their order.
        </p>
      </div>
    </ActionSheet>
  );
}
