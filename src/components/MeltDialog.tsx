import { companyOf, workCompanyOf } from "@/lib/companies";
import { listOf } from "@/lib/optionLists";
import { useMemo, useState } from "react";
import { Flame, AlertTriangle, Coins, Gem, Factory as FactoryIcon, Wallet, Warehouse, Sparkles, ArrowRight } from "lucide-react";
import { toast } from "sonner";
import { loadDb, updateDbAs, uid, fmtMoney, type Order } from "@/lib/db";
import { useDb } from "@/hooks/useDb";
import { useAuth } from "@/lib/auth";
import { increaseStock } from "@/lib/stock";
import { meltPlan, meltGoldLine, meltStones, applyMelt, type MeltTo, type MeltAs } from "@/lib/melt";
import { materialName, materialUnit } from "@/lib/materials";
import { Button } from "@/components/ui/button";
import { AsyncButton } from "@/components/AsyncButton";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

// Quick picks: Settings → Dropdown lists → Melt reasons.
const INHOUSE = "__inhouse";

/**
 * Melt a finished piece (lib/melt.ts). Two choices settle the metal — where it
 * goes (a factory's pool, or our own stock) and as what (the piece's karat as
 * melted, or refined to 24K) — so every case is covered: 14K to the factory,
 * 24K to the factory, 14K into stock, 24K into stock. Whoever melted it can be
 * owed a charge for it. The stones go back to stock; the job's labour stays
 * owed. A summary on the right says exactly what will happen before it does.
 */
export function MeltDialog({ order, onClose }: { order: Order; onClose: () => void }) {
  const db = useDb();
  const { user } = useAuth();
  const plan = useMemo(() => meltPlan(db, order), [db, order]);
  const [to, setTo] = useState<MeltTo>("factory");
  const [as, setAs] = useState<MeltAs>("karat");
  const [factoryId, setFactoryId] = useState(plan.factoryId ?? "");
  const [meltedBy, setMeltedBy] = useState(plan.factoryId ?? INHOUSE);
  const [charge, setCharge] = useState("");
  const [grams, setGrams] = useState(String(plan.net || ""));
  const [stoneCt, setStoneCt] = useState<Record<string, string>>(() => Object.fromEntries(plan.stones.map(s => [s.issuanceId, String(s.ct)])));
  const [reason, setReason] = useState("");
  // One id for this melt: a retry after a dropped connection skips the stock
  // already put back instead of putting it back twice.
  const [meltId] = useState(() => uid("melt_"));
  const factories = db.factories.filter(f => f.active !== false || f.id === plan.factoryId);
  const nameOf = (id?: string) => db.factories.find(f => f.id === id)?.name ?? "the factory";
  const client = db.clients.find(c => c.id === order.clientId);
  const paid = (order.advances || []).reduce((s, a) => s + a.amount, 0);

  const pickAs = (k: MeltAs) => { setAs(k); setGrams(String(k === "24k" ? plan.fine : plan.net)); };
  const choice = {
    to, as, factoryId: to === "factory" ? factoryId : undefined,
    meltedBy: to === "factory" ? factoryId : meltedBy === INHOUSE ? undefined : meltedBy,
    chargeInr: Number(charge) || 0, goldGrams: Number(grams) || 0,
    stoneCt: Object.fromEntries(Object.entries(stoneCt).map(([k, v]) => [k, Number(v) || 0])), reason,
  };
  const line = meltGoldLine(plan, choice);
  const stones = meltStones(plan, choice);
  const stoneTotal = Math.round(stones.reduce((s, x) => s + x.ct, 0) * 1000) / 1000;
  const expected = as === "24k" ? plan.fine : plan.net;
  const loss = Math.round((expected - line.grams) * 1000) / 1000;
  const chargeTo = choice.meltedBy;

  /** Whose stock a stone or material goes back to: the company it was issued from. */
  const coOfIssue = (issuanceId: string) => companyOf(db.materialIssuances.find(i => i.id === issuanceId));
  const melt = async () => {
    if (!user) return;
    if (to === "factory" && line.grams > 0 && !factoryId) { toast.error("Choose the factory the gold goes to"); return; }
    if (line.grams > expected + 0.001) { toast.error(`More gold than the piece holds (${expected} g)`); return; }
    if ((Number(charge) || 0) > 0 && !chargeTo) { toast.error("Choose which factory melted it — the charge is owed to them"); return; }
    const at = new Date().toISOString();
    try {
      // Stock first, each move once (a retry skips what is already there).
      const done = new Set((loadDb().stockMovements ?? []).map(m => m.refId).filter(Boolean));
      for (const s of stones) {
        const ref = `${meltId}_d_${s.issuanceId}`;
        if (done.has(ref)) continue;
        await increaseStock({ material: "diamond", companyId: coOfIssue(s.issuanceId), purityOrQuality: s.quality, quantity: s.ct, refType: "manual", refId: ref, createdBy: user.id, note: `Back from melted ${order.orderNumber}` });
      }
      // Any other material in the piece — back into its own stock, once.
      for (const x of plan.others) {
        const ref = `${meltId}_x_${x.issuanceId}`;
        if (done.has(ref)) continue;
        await increaseStock({ material: x.material, companyId: coOfIssue(x.issuanceId), purityOrQuality: x.grade, quantity: x.qty, refType: "manual", refId: ref, createdBy: user.id, note: `Back from melted ${order.orderNumber}` });
      }
      if (to === "stock" && line.grams > 0 && !done.has(`${meltId}_g`)) {
        await increaseStock({ material: "gold", companyId: workCompanyOf(db, order), purityOrQuality: line.purity, quantity: line.grams, refType: "manual", refId: `${meltId}_g`, createdBy: user.id, note: `Melted ${order.orderNumber}${as === "24k" ? " — refined to 24K" : ""}` });
      }
      updateDbAs({ summary: `Melted ${order.orderNumber}` }, d => { applyMelt(d, order.id, plan, choice, { id: user.id, name: user.name }, at); });
      toast.success(`${order.orderNumber} melted — ${line.grams} g ${line.purity} ${to === "stock" ? "into our stock" : `to ${nameOf(factoryId)}`}${stoneTotal || plan.packetIds.length ? ", stones back in stock" : ""}`);
      onClose();
    } catch (e) {
      toast.error(`${e instanceof Error ? e.message : "Could not finish the melt"} — press Melt again to finish; nothing is put back twice.`);
    }
  };

  const choiceCard = <T extends string>(cur: T, k: T, set: (v: T) => void, icon: React.ReactNode, title: string, sub: string) => (
    <button key={k} type="button" role="radio" aria-checked={cur === k} onClick={() => set(k)}
      className={`text-left rounded-xl border p-3 transition-all ${cur === k ? "border-primary ring-2 ring-primary/25 bg-primary/5" : "border-border/70 hover:border-primary/40 bg-card"}`}>
      <span className="flex items-center gap-1.5 text-sm font-semibold text-brand-dark">{icon}{title}</span>
      <span className="block text-[11px] text-muted-foreground mt-1 leading-snug">{sub}</span>
    </button>
  );

  return (
    <Dialog open onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-5xl rounded-2xl">
        <DialogHeader>
          <DialogTitle className="font-display text-2xl flex items-center gap-2"><Flame className="h-5 w-5 text-destructive" /> Melt {order.orderNumber}</DialogTitle>
          {!plan.blocked && <DialogDescription className="text-xs">The piece will no longer exist and the order closes. The metal and stones come back; the factory's labour stays owed.</DialogDescription>}
        </DialogHeader>
        {plan.blocked ? (
          <p className="text-sm rounded-xl bg-secondary/70 p-3">{plan.blocked}</p>
        ) : (
          <div className="grid lg:grid-cols-[1.25fr_1fr] gap-5 text-sm">
            {/* ── Left: the choices ── */}
            <div className="space-y-4 min-w-0">
              {plan.warning && <p className="text-xs rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-800 p-2.5 flex gap-2"><AlertTriangle className="h-4 w-4 shrink-0" />{plan.warning}</p>}
              <div>
                <p className="text-xs font-semibold text-muted-foreground mb-1.5">Why</p>
                <div className="flex flex-wrap gap-1.5">
                  {listOf("meltReasons").map(r => (
                    <button key={r} type="button" onClick={() => setReason(reason === r ? "" : r)}
                      className={`h-8 px-3 rounded-lg border text-xs ${reason === r ? "border-primary bg-primary/10 text-primary font-semibold" : "border-border hover:bg-secondary"}`}>{r}</button>
                  ))}
                </div>
                <Input value={listOf("meltReasons").includes(reason) ? "" : reason} onChange={e => setReason(e.target.value)} placeholder="or write the reason" className="mt-2 h-9 rounded-lg text-sm" />
              </div>

              <div className="rounded-2xl border border-border/60 p-4 space-y-3">
                <p className="font-semibold text-brand-dark flex items-center gap-1.5"><Coins className="h-4 w-4 text-amber-600" /> Gold in the piece — {plan.net} g {plan.karat} <span className="text-xs font-normal text-muted-foreground">({plan.fine} g pure at {plan.purity}‰)</span></p>
                <div>
                  <p className="text-xs text-muted-foreground mb-1.5">Where it goes</p>
                  <div className="grid sm:grid-cols-2 gap-2" role="radiogroup" aria-label="Where the gold goes">
                    {choiceCard(to, "factory", setTo, <FactoryIcon className="h-4 w-4 text-primary" />, "Into a factory's pool", "The factory keeps it, ready for its next job")}
                    {choiceCard(to, "stock", setTo, <Warehouse className="h-4 w-4 text-primary" />, "Into our own stock", "We keep it, in gold stock")}
                  </div>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground mb-1.5">As what</p>
                  <div className="grid sm:grid-cols-2 gap-2" role="radiogroup" aria-label="As what">
                    {choiceCard(as, "karat", pickAs, <Coins className="h-4 w-4 text-amber-600" />, `${plan.karat}, as melted`, `${plan.net} g of ${plan.karat}`)}
                    {choiceCard(as, "24k", pickAs, <Sparkles className="h-4 w-4 text-amber-600" />, "24K, refined", `${plan.fine} g of pure gold`)}
                  </div>
                </div>
                <div className="grid sm:grid-cols-2 gap-3">
                  {to === "factory" ? (
                    <div>
                      <p className="text-xs text-muted-foreground mb-1">Factory</p>
                      <Select value={factoryId} onValueChange={setFactoryId}>
                        <SelectTrigger className="h-10 rounded-xl" aria-label="Factory"><SelectValue placeholder="Choose" /></SelectTrigger>
                        <SelectContent>{factories.map(f => <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>)}</SelectContent>
                      </Select>
                    </div>
                  ) : (
                    <div>
                      <p className="text-xs text-muted-foreground mb-1">Melted by</p>
                      <Select value={meltedBy} onValueChange={setMeltedBy}>
                        <SelectTrigger className="h-10 rounded-xl" aria-label="Melted by"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value={INHOUSE}>Ourselves, in-house</SelectItem>
                          {factories.map(f => <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                  <div>
                    <p className="text-xs text-muted-foreground mb-1">Grams that came back ({line.purity})</p>
                    <Input type="number" inputMode="decimal" step="0.001" min="0" value={grams} onChange={e => setGrams(e.target.value)} className="h-10 rounded-xl" aria-label="Grams that came back" />
                  </div>
                </div>
                {loss > 0 && <p className="text-[11px] text-amber-700">{loss} g lost in melting{as === "24k" ? " and refining" : ""}.</p>}
                {chargeTo && (
                  <div className="max-w-xs">
                    <p className="text-xs text-muted-foreground mb-1">Melting{as === "24k" ? " / refining" : ""} charge, ₹ (optional)</p>
                    <Input type="number" inputMode="decimal" min="0" value={charge} onChange={e => setCharge(e.target.value)} placeholder="0" className="h-10 rounded-xl" aria-label="Melting charge" />
                  </div>
                )}
                {plan.otherMetal && <p className="text-[11px] text-muted-foreground">The {plan.otherMetal} in the piece is not covered here — record it with the factory separately.</p>}
              </div>

              {(plan.stones.length > 0 || plan.packetIds.length > 0) && (
                <div className="rounded-2xl border border-border/60 p-4 space-y-2">
                  <p className="font-semibold text-brand-dark flex items-center gap-1.5"><Gem className="h-4 w-4 text-sky-600" /> Diamonds — back into stock</p>
                  {plan.stones.map(s => (
                    <div key={s.issuanceId} className="flex items-center justify-between gap-2">
                      <span className="text-xs min-w-0 truncate">{s.quality}{s.pcs ? ` · ${s.pcs} pcs` : ""} <span className="text-muted-foreground">(set: {s.ct} ct)</span></span>
                      <Input type="number" inputMode="decimal" step="0.001" min="0" value={stoneCt[s.issuanceId] ?? ""} onChange={e => setStoneCt(p => ({ ...p, [s.issuanceId]: e.target.value }))}
                        className="h-9 w-28 rounded-lg text-xs" aria-label={`Carats back of ${s.quality}`} />
                    </div>
                  ))}
                  {plan.packetIds.length > 0 && <p className="text-xs">{plan.packetIds.length} certified packet{plan.packetIds.length !== 1 ? "s" : ""} ({plan.packetCt} ct) — back to "in stock"</p>}
                  <p className="text-[11px] text-muted-foreground">Lower a figure for any stone that broke or was lost.</p>
                </div>
              )}

              {plan.others.length > 0 && (
                <div className="rounded-2xl border border-border/60 p-4 space-y-1.5">
                  <p className="font-semibold text-brand-dark flex items-center gap-1.5"><Gem className="h-4 w-4 text-emerald-600" /> Other materials — back into stock</p>
                  {plan.others.map(x => (
                    <p key={x.issuanceId} className="text-xs">{x.qty} {materialUnit(db.settings, x.material)} {x.grade} {materialName(db.settings, x.material)}</p>
                  ))}
                </div>
              )}
            </div>

            {/* ── Right: exactly what will happen ── */}
            <div className="min-w-0">
              <div className="lg:sticky lg:top-0 rounded-2xl bg-secondary/50 border border-border/60 p-4 space-y-3">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">What happens</p>
                <div className="rounded-xl bg-card ring-1 ring-border/60 p-3 flex items-center gap-2.5">
                  <Coins className="h-5 w-5 text-amber-600 shrink-0" />
                  <div className="min-w-0 text-xs">
                    <p className="font-semibold text-brand-dark text-sm">{line.grams} g {line.purity}</p>
                    <p className="text-muted-foreground flex items-center gap-1 flex-wrap">{plan.karat} piece <ArrowRight className="h-3 w-3" /> {to === "stock" ? "our gold stock" : `${nameOf(factoryId)}'s pool`}{as === "24k" ? " · refined" : ""}</p>
                  </div>
                </div>
                {plan.others.length > 0 && (
                  <div className="rounded-xl bg-card ring-1 ring-border/60 p-3 flex items-center gap-2.5 text-xs">
                    <Gem className="h-5 w-5 text-emerald-600 shrink-0" />
                    <p>{plan.others.map(x => `${x.qty} ${materialUnit(db.settings, x.material)} ${materialName(db.settings, x.material)}`).join(", ")} <span className="text-muted-foreground">back into stock</span></p>
                  </div>
                )}
                {(stoneTotal > 0 || plan.packetIds.length > 0) && (
                  <div className="rounded-xl bg-card ring-1 ring-border/60 p-3 flex items-center gap-2.5 text-xs">
                    <Gem className="h-5 w-5 text-sky-600 shrink-0" />
                    <p><span className="font-semibold text-brand-dark text-sm">{stoneTotal} ct</span> loose{plan.packetIds.length ? ` + ${plan.packetIds.length} packet${plan.packetIds.length !== 1 ? "s" : ""}` : ""} <span className="text-muted-foreground">back into diamond stock</span></p>
                  </div>
                )}
                <div className="rounded-xl bg-card ring-1 ring-border/60 p-3 space-y-1.5 text-xs">
                  <p className="flex items-center gap-1.5"><FactoryIcon className="h-3.5 w-3.5 text-primary" /> Job labour <span className="font-semibold">₹{plan.labourInr.toLocaleString("en-IN")}</span> stays owed to {nameOf(plan.factoryId)}</p>
                  {(Number(charge) || 0) > 0 && chargeTo && <p className="flex items-center gap-1.5"><Flame className="h-3.5 w-3.5 text-destructive" /> Melting charge <span className="font-semibold">₹{(Number(charge) || 0).toLocaleString("en-IN")}</span> owed to {nameOf(chargeTo)}</p>}
                  {paid > 0 && <p className="flex items-center gap-1.5"><Wallet className="h-3.5 w-3.5 text-primary" /> {fmtMoney(paid)} advance moves to {client?.companyName ?? "the client"}'s credit</p>}
                </div>
                <p className="text-[11px] text-muted-foreground">The order closes as Rejected and can't be re-opened. To make it again, place a new order.</p>
              </div>
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
