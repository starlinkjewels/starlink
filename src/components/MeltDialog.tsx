import { useMemo, useState } from "react";
import { Flame, AlertTriangle, Coins, Gem, Factory as FactoryIcon, Wallet } from "lucide-react";
import { toast } from "sonner";
import { loadDb, updateDbAs, uid, fmtMoney, type Order } from "@/lib/db";
import { useDb } from "@/hooks/useDb";
import { useAuth } from "@/lib/auth";
import { increaseStock } from "@/lib/stock";
import { meltPlan, meltGoldLine, meltStones, applyMelt, type MeltGoldTo } from "@/lib/melt";
import { Button } from "@/components/ui/button";
import { AsyncButton } from "@/components/AsyncButton";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const REASONS = ["Came out wrong", "Customer rejected", "Design changed"];

/**
 * Melt a finished piece (lib/melt.ts): choose where the metal goes, confirm
 * the stones going back to stock, and see what stays owed — then melt.
 */
export function MeltDialog({ order, onClose }: { order: Order; onClose: () => void }) {
  const db = useDb();
  const { user } = useAuth();
  const plan = useMemo(() => meltPlan(db, order), [db, order]);
  const [goldTo, setGoldTo] = useState<MeltGoldTo>("factory-karat");
  const [factoryId, setFactoryId] = useState(plan.factoryId ?? "");
  const [grams, setGrams] = useState(String(plan.net || ""));
  const [stoneCt, setStoneCt] = useState<Record<string, string>>(() => Object.fromEntries(plan.stones.map(s => [s.issuanceId, String(s.ct)])));
  const [reason, setReason] = useState("");
  // One id for this melt: a retry after a dropped connection skips the stock
  // already put back instead of putting it back twice.
  const [meltId] = useState(() => uid("melt_"));
  const factories = db.factories.filter(f => f.active !== false || f.id === plan.factoryId);
  const factoryName = db.factories.find(f => f.id === (factoryId || plan.factoryId))?.name ?? "the factory";
  const client = db.clients.find(c => c.id === order.clientId);
  const paid = (order.advances || []).reduce((s, a) => s + a.amount, 0);

  const pick = (k: MeltGoldTo) => {
    setGoldTo(k);
    setGrams(String(k === "factory-24k" ? plan.fine : plan.net));
  };
  const choice = {
    goldTo, factoryId: goldTo === "stock-karat" ? undefined : factoryId, goldGrams: Number(grams) || 0,
    stoneCt: Object.fromEntries(Object.entries(stoneCt).map(([k, v]) => [k, Number(v) || 0])), reason,
  };
  const line = meltGoldLine(plan, choice);
  const stones = meltStones(plan, choice);
  const stoneTotal = Math.round(stones.reduce((s, x) => s + x.ct, 0) * 1000) / 1000;
  const expected = goldTo === "factory-24k" ? plan.fine : plan.net;
  const loss = Math.round((expected - line.grams) * 1000) / 1000;

  const melt = async () => {
    if (!user) return;
    if (goldTo !== "stock-karat" && line.grams > 0 && !factoryId) { toast.error("Choose the factory the gold goes to"); return; }
    if (line.grams > expected + 0.001) { toast.error(`More gold than the piece holds (${expected} g)`); return; }
    const at = new Date().toISOString();
    try {
      // Stock first, each move once (a retry skips what is already there).
      const done = new Set((loadDb().stockMovements ?? []).map(m => m.refId).filter(Boolean));
      for (const s of stones) {
        const ref = `${meltId}_d_${s.issuanceId}`;
        if (done.has(ref)) continue;
        await increaseStock({ material: "diamond", purityOrQuality: s.quality, quantity: s.ct, refType: "manual", refId: ref, createdBy: user.id, note: `Back from melted ${order.orderNumber}` });
      }
      if (goldTo === "stock-karat" && line.grams > 0 && !done.has(`${meltId}_g`)) {
        await increaseStock({ material: "gold", purityOrQuality: line.purity, quantity: line.grams, refType: "manual", refId: `${meltId}_g`, createdBy: user.id, note: `Melted ${order.orderNumber}` });
      }
      updateDbAs({ summary: `Melted ${order.orderNumber}` }, d => { applyMelt(d, order.id, plan, choice, { id: user.id, name: user.name }, at); });
      toast.success(`${order.orderNumber} melted — ${line.grams} g ${line.purity} ${goldTo === "stock-karat" ? "into stock" : `to ${factoryName}`}${stoneTotal || plan.packetIds.length ? ", stones back in stock" : ""}`);
      onClose();
    } catch (e) {
      toast.error(`${e instanceof Error ? e.message : "Could not finish the melt"} — press Melt again to finish; nothing is put back twice.`);
    }
  };

  const opt = (k: MeltGoldTo, title: string, sub: string) => (
    <button key={k} type="button" role="radio" aria-checked={goldTo === k} onClick={() => pick(k)}
      className={`text-left rounded-xl border p-2.5 transition-all ${goldTo === k ? "border-primary ring-2 ring-primary/25 bg-primary/5" : "border-border/70 hover:border-primary/40"}`}>
      <span className="block text-sm font-semibold text-brand-dark">{title}</span>
      <span className="block text-[11px] text-muted-foreground mt-0.5 leading-snug">{sub}</span>
    </button>
  );

  return (
    <Dialog open onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-lg rounded-2xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-display text-2xl flex items-center gap-2"><Flame className="h-5 w-5 text-destructive" /> Melt {order.orderNumber}</DialogTitle>
          {!plan.blocked && <DialogDescription className="text-xs">The piece will no longer exist and the order closes. The metal and stones come back; the factory's labour stays owed.</DialogDescription>}
        </DialogHeader>
        {plan.blocked ? (
          <p className="text-sm rounded-xl bg-secondary/70 p-3">{plan.blocked}</p>
        ) : (
          <div className="space-y-4 text-sm">
            {plan.warning && <p className="text-xs rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-800 p-2.5 flex gap-2"><AlertTriangle className="h-4 w-4 shrink-0" />{plan.warning}</p>}

            <div>
              <p className="text-xs text-muted-foreground mb-1">Why</p>
              <div className="flex flex-wrap gap-1.5">
                {REASONS.map(r => (
                  <button key={r} type="button" onClick={() => setReason(reason === r ? "" : r)}
                    className={`h-7 px-2.5 rounded-lg border text-xs ${reason === r ? "border-primary bg-primary/10 text-primary font-semibold" : "border-border hover:bg-secondary"}`}>{r}</button>
                ))}
              </div>
              <Input value={REASONS.includes(reason) ? "" : reason} onChange={e => setReason(e.target.value)} placeholder="or write the reason" className="mt-1.5 h-9 rounded-lg text-sm" />
            </div>

            <div className="rounded-xl border border-border/60 p-3 space-y-2.5">
              <p className="font-semibold text-brand-dark flex items-center gap-1.5"><Coins className="h-4 w-4 text-amber-600" /> Gold — {plan.net} g {plan.karat} <span className="text-xs font-normal text-muted-foreground">({plan.fine} g pure at {plan.purity}‰)</span></p>
              <div className="grid sm:grid-cols-3 gap-2" role="radiogroup" aria-label="Where the gold goes">
                {opt("factory-karat", `To factory as ${plan.karat}`, "The melted metal, as it is, into the factory's pool")}
                {opt("factory-24k", "To factory as 24K", "Refined to pure gold, into the factory's pool")}
                {opt("stock-karat", `To our stock as ${plan.karat}`, "Kept by us, in gold stock")}
              </div>
              <div className="grid grid-cols-2 gap-2">
                {goldTo !== "stock-karat" && (
                  <div>
                    <p className="text-xs text-muted-foreground mb-1">Factory</p>
                    <Select value={factoryId} onValueChange={setFactoryId}>
                      <SelectTrigger className="h-9 rounded-lg" aria-label="Factory"><SelectValue placeholder="Choose" /></SelectTrigger>
                      <SelectContent>{factories.map(f => <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                )}
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Grams that came back ({line.purity})</p>
                  <Input type="number" inputMode="decimal" step="0.001" min="0" value={grams} onChange={e => setGrams(e.target.value)} className="h-9 rounded-lg" aria-label="Grams that came back" />
                </div>
              </div>
              {loss > 0 && <p className="text-[11px] text-amber-700">{loss} g lost in melting.</p>}
              {plan.otherMetal && <p className="text-[11px] text-muted-foreground">The {plan.otherMetal} in the piece is not covered here — record it with the factory separately.</p>}
            </div>

            {(plan.stones.length > 0 || plan.packetIds.length > 0) && (
              <div className="rounded-xl border border-border/60 p-3 space-y-2">
                <p className="font-semibold text-brand-dark flex items-center gap-1.5"><Gem className="h-4 w-4 text-sky-600" /> Diamonds — back into stock</p>
                {plan.stones.map(s => (
                  <div key={s.issuanceId} className="flex items-center justify-between gap-2">
                    <span className="text-xs min-w-0 truncate">{s.quality}{s.pcs ? ` · ${s.pcs} pcs` : ""} <span className="text-muted-foreground">(set: {s.ct} ct)</span></span>
                    <Input type="number" inputMode="decimal" step="0.001" min="0" value={stoneCt[s.issuanceId] ?? ""} onChange={e => setStoneCt(p => ({ ...p, [s.issuanceId]: e.target.value }))}
                      className="h-8 w-24 rounded-lg text-xs" aria-label={`Carats back of ${s.quality}`} />
                  </div>
                ))}
                {plan.packetIds.length > 0 && <p className="text-xs">{plan.packetIds.length} certified packet{plan.packetIds.length !== 1 ? "s" : ""} ({plan.packetCt} ct) — back to "in stock"</p>}
                <p className="text-[11px] text-muted-foreground">Lower a figure for any stone that broke or was lost.</p>
              </div>
            )}

            <div className="rounded-xl bg-secondary/60 p-3 space-y-1.5 text-xs">
              <p className="flex items-center gap-1.5"><FactoryIcon className="h-3.5 w-3.5 text-primary" /> Labour <span className="font-semibold">₹{plan.labourInr.toLocaleString("en-IN")}</span> stays in {db.factories.find(f => f.id === plan.factoryId)?.name ?? "the factory"}'s ledger, to be paid.</p>
              {paid > 0 && <p className="flex items-center gap-1.5"><Wallet className="h-3.5 w-3.5 text-primary" /> The {fmtMoney(paid)} advance moves to {client?.companyName ?? "the client"}'s credit.</p>}
              <p>The order closes as Rejected and can't be re-opened. To make it again, place a new order.</p>
            </div>
          </div>
        )}
        <DialogFooter>
          {plan.blocked
            ? <Button variant="outline" onClick={onClose} className="rounded-xl">Close</Button>
            : <>
                <Button variant="outline" onClick={onClose} className="rounded-xl">Cancel</Button>
                <AsyncButton onClick={melt} className="rounded-xl bg-destructive text-white hover:bg-destructive/90 gap-1.5"><Flame className="h-4 w-4" /> Melt piece</AsyncButton>
              </>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
