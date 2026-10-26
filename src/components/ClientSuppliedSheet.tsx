import { useState } from "react";
import { Coins } from "lucide-react";
import { toast } from "sonner";
import { ActionSheet } from "@/components/ActionSheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { updateDbAs, type Order } from "@/lib/db";

/** Whose material this piece is made of: the client's gold, their diamonds, both — or ours. */
export function ClientSuppliedSheet({ order, onClose }: { order: Order; onClose(): void }) {
  const cs = order.clientSupplied ?? {};
  const [gold, setGold] = useState(!!cs.gold);
  const [diamonds, setDiamonds] = useState(!!cs.diamonds);
  const [loss, setLoss] = useState(cs.goldLossPct != null ? String(cs.goldLossPct) : "");
  const save = () => {
    const pct = Number(loss) || 0;
    if (pct < 0 || pct > 25) { toast.error("Gold loss is a percentage between 0 and 25"); return; }
    updateDbAs({ summary: `${order.orderNumber}: ${gold || diamonds ? `client gives ${[gold && "gold", diamonds && "diamonds"].filter(Boolean).join(" and ")}` : "all material ours"}` }, d => {
      const o = d.orders.find(x => x.id === order.id);
      if (!o) return;
      if (gold || diamonds) o.clientSupplied = { ...(gold ? { gold: true, goldLossPct: pct || undefined } : {}), ...(diamonds ? { diamonds: true } : {}) };
      else delete o.clientSupplied;
      if (o.clientSupplied?.goldLossPct === undefined && o.clientSupplied) delete o.clientSupplied.goldLossPct;
    });
    toast.success("Saved");
    onClose();
  };
  const row = (label: string, hint: string, on: boolean, set: (v: boolean) => void) => (
    <label className="flex items-center justify-between gap-3 rounded-xl border border-border/70 px-3 py-3 cursor-pointer">
      <span><span className="block text-sm font-medium text-brand-dark">{label}</span><span className="block text-[11px] text-muted-foreground">{hint}</span></span>
      <Switch checked={on} onCheckedChange={set} aria-label={label} />
    </label>
  );
  return (
    <ActionSheet open onOpenChange={o => { if (!o) onClose(); }} icon={Coins} title="Client's own material"
      description={`${order.orderNumber} · what the client gives us for this piece — the rest is ours`}
      footer={<div className="flex justify-end gap-2"><Button variant="outline" onClick={onClose} className="rounded-xl">Cancel</Button><Button onClick={save} className="btn-hero rounded-xl px-6">Save</Button></div>}>
      <div className="space-y-3">
        {row("The client gives the gold", "Their gold goes to the factory; the piece's gold comes off their gold balance", gold, setGold)}
        {gold && (
          <div className="space-y-1.5 pl-1">
            <Label htmlFor="cs-loss" className="text-xs">Gold loss agreed · %</Label>
            <Input id="cs-loss" type="number" min={0} max={25} step="0.1" value={loss} onChange={e => setLoss(e.target.value)} placeholder="e.g. 3" className="h-10 rounded-xl w-32" />
            <p className="text-[11px] text-muted-foreground">Taken from their gold on top of the gold in the piece. If their gold runs short, the rest is ours and is billed.</p>
          </div>
        )}
        {row("The client gives the diamonds", "Their stones, sent to the factory — no cost to us; we bill only setting and labour", diamonds, setDiamonds)}
        <p className="text-[11px] text-muted-foreground">Mixed is fine: their centre stone and our small diamonds — each line knows whose it is.</p>
      </div>
    </ActionSheet>
  );
}
