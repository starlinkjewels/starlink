import { useState } from "react";
import { Coins } from "lucide-react";
import { toast } from "sonner";
import { ActionSheet } from "@/components/ActionSheet";
import { Button } from "@/components/ui/button";
import { AsyncButton } from "@/components/AsyncButton";
import { useAuth } from "@/lib/auth";
import { useDb } from "@/hooks/useDb";
import { updateDbAs, type Order } from "@/lib/db";
import { metalHasKarats as hasKarats } from "@/lib/metals";
import { estimatedPureGoldNeeded } from "@/lib/manufacturing";
import { clientMaterialBalance, deliveryFine, orderClientSends, orderUse } from "@/lib/clientMaterial";
import { ClientMaterialChoice, applyCmDraft, cmDraftProblem, emptyCm, type CmDraft } from "@/components/order/ClientMaterialChoice";

/**
 * Whose material this piece is made of — the same choice as on the order
 * form, for this one order: we give, or the client gives; and what the client
 * gives is received here now, taken from theirs already with us, or comes
 * later — and can go to the order's factory in the same step.
 */
export function ClientSuppliedSheet({ order, onClose }: { order: Order; onClose(): void }) {
  const { user } = useAuth();
  const db = useDb();
  const cs = order.clientSupplied ?? {};
  const client = db.clients.find(c => c.id === order.clientId);
  const bal = client ? clientMaterialBalance(db, client) : null;
  const sends = orderClientSends(db, order);
  const r3 = (n: number) => Math.round(n * 1000) / 1000;
  const sentGold = r3(sends.filter(i => i.material === "gold").reduce((t, i) => t + deliveryFine(i), 0));
  const sentDia = r3(sends.filter(i => i.material === "diamond").reduce((t, i) => t + i.quantityIssued, 0));
  const gotGold = r3((client?.materialLedger ?? []).filter(e => e.kind === "in" && e.orderId === order.id && e.material === "gold").reduce((t, e) => t + (e.fine ?? 0), 0));
  const gotDia = r3((client?.materialLedger ?? []).filter(e => e.kind === "in" && e.orderId === order.id && e.material === "diamond").reduce((t, e) => t + (e.ct ?? 0), 0));
  const line = (got: number, sent: number, unit: string) =>
    got || sent ? `Already on this order: ${[got && `received ${got} ${unit}`, sent && `at the factory ${sent} ${unit}`].filter(Boolean).join(" · ")}. Anything chosen below is added.` : undefined;

  // What is set already stays as it is ("Nothing more now"); a material switched on here starts as the form does.
  const [v, setV] = useState<CmDraft>(() => ({
    ...emptyCm(), gold: !!cs.gold, diamonds: !!cs.diamonds, lossPct: cs.goldLossPct != null ? String(cs.goldLossPct) : "",
    goldSrc: cs.gold ? "later" : "now", diaSrc: cs.diamonds ? "later" : "now", sendNow: true,
  }));
  const factory = db.factories.find(f => f.id === order.assignedFactoryId);
  const showGold = hasKarats(order.metal);
  const goldOn = v.gold && showGold, diaOn = v.diamonds;

  const save = async () => {
    // Taking a material off: not while some of theirs is on its way into this piece.
    if (cs.gold && !goldOn && (sentGold > 0 || orderUse(client, order.id, "gold"))) { toast.error("Their gold has gone to the factory for this order — undo that send first."); return; }
    if (cs.diamonds && !diaOn && (sentDia > 0 || orderUse(client, order.id, "diamond"))) { toast.error("Their diamonds have gone to the factory for this order — undo that send first."); return; }
    const problem = cmDraftProblem(v, { gold: goldOn, diamonds: diaOn }, bal, {
      goldNeedFine: estimatedPureGoldNeeded(order), wantCt: Number(order.diamondWeight) || 0, canSend: !!order.assignedFactoryId,
    });
    if (problem) { toast.error(problem); return; }
    const pct = Number(v.lossPct) || 0;
    let unsent = false;
    try {
      updateDbAs({ summary: `${order.orderNumber}: ${goldOn || diaOn ? `client gives ${[goldOn && "gold", diaOn && "diamonds"].filter(Boolean).join(" and ")}` : "all material ours"}` }, d => {
        const o = d.orders.find(x => x.id === order.id);
        if (!o) return;
        const before = o.clientSupplied;
        if (goldOn || diaOn) o.clientSupplied = { ...(goldOn ? { gold: true, ...(pct > 0 ? { goldLossPct: Math.min(25, pct) } : {}) } : {}), ...(diaOn ? { diamonds: true } : {}) };
        else delete o.clientSupplied;
        try {
          unsent = applyCmDraft(d, o.id, v, { gold: goldOn, diamonds: diaOn }, { id: user!.id, name: user!.name }).unsent;
        } catch (e) {
          // Nothing half-done: the flags go back as they were too.
          if (before) o.clientSupplied = before; else delete o.clientSupplied;
          throw e;
        }
      });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't save");
      return;
    }
    toast.success(unsent ? "Saved — not sent: choose the factory first" : "Saved");
    // Taken off with some of theirs received for it: that stays on their account.
    const left = [cs.gold && !goldOn && gotGold > 0 && `${gotGold} g fine gold`, cs.diamonds && !diaOn && gotDia > 0 && `${gotDia} ct diamonds`].filter(Boolean);
    if (left.length) toast.info(`${left.join(" and ")} of theirs stays on their account — hand it back from the client's page.`);
    onClose();
  };

  return (
    <ActionSheet open onOpenChange={o => { if (!o) onClose(); }} icon={Coins} size="lg" title="Client's own material"
      description={`${order.orderNumber} · who gives what for this piece — and what comes in now`}
      footer={<div className="flex justify-end gap-2"><Button variant="outline" onClick={onClose} className="rounded-xl">Cancel</Button><AsyncButton onClick={save} className="btn-hero rounded-xl px-6">Save</AsyncButton></div>}>
      {client ? (
        <ClientMaterialChoice
          value={v} onChange={setV} clientId={client.id} showGold={showGold}
          factoryName={factory?.name} goldNeedFine={estimatedPureGoldNeeded(order)} wantCt={Number(order.diamondWeight) || 0}
          laterLabel="Nothing more now"
          already={{ gold: line(gotGold, sentGold, "g fine"), diamonds: line(gotDia, sentDia, "ct") }} />
      ) : <p className="text-sm text-muted-foreground">This order has no client.</p>}
    </ActionSheet>
  );
}
