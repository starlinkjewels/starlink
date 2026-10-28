import { fmtG } from "@/lib/weights";
import { useState } from "react";
import { Boxes, Check, Gem, Plus, ShoppingCart, Sparkles, Trash2, AlertTriangle, Pencil, Factory as FactoryIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { MoreMenu } from "@/components/MoreMenu";
import { LotPicker } from "@/components/LotFields";
import { AddNewItem } from "@/components/create/QuickCreate";
import { BuyMaterialForm, type PlannedBuy } from "@/components/BuyMaterialForm";
import { useDb } from "@/hooks/useDb";
import { uid, type Order } from "@/lib/db";
import { companyOf, hasCompanies } from "@/lib/companies";
import { lotLabel } from "@/lib/diamondLots";
import { bagNoOf } from "@/lib/diamondBags";
import { deriveStockBalances, estimatedPureGoldNeeded, factoryFineGoldBalance, fmtMoneyInr } from "@/lib/manufacturing";
import { materialDefs, materialName, materialUnit, type MaterialKey } from "@/lib/materials";
import { pickAvailable, pickCostInr, suggestLots, type StockPick } from "@/lib/orderStock";
import { hasDiamonds } from "@/lib/orderText";

export type OrderKind = "piece" | "loose" | "readyStock";

/** What the plan needs to know about the order being placed. */
export interface PlanOrder {
  kind: OrderKind;
  companyId: string;
  metal: string;
  metalHasKarats: boolean;
  productKarats: string;
  estimatedNetWeight: number;
  estimatedGrossWeight: number;
  diamondWeight: number;
  quantity: number;
  /** A loose order's stones; `stone` is what they are ("Diamond", "Emerald", "Emerald + Diamond"). */
  stoneSpec?: { stone?: string; shape?: string; type?: string; mm?: string; size?: string; color?: string; clarity?: string };
  /** Natural, CVD, HPHT… — lots of that type are suggested first. */
  diamondType?: string;
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const r3 = (n: number) => Math.round(n * 1000) / 1000;

/**
 * Production plan — decided while the order is placed, recorded with it:
 *   • the factory that makes it (a piece);
 *   • what comes FROM STOCK (bags, certified stones, gold, any other material),
 *     each against what is in stock now, and what it costs;
 *   • what is BOUGHT for it — one supplier bill, the same form as everywhere.
 * A loose-diamond order shows the bags that suit the request, best first.
 * Gold for a piece is normally the factory's own gold account (sent to them in
 * bulk) — shown against the estimate; it can also go from stock or be bought.
 */
export function ProductionPlan({ order, factoryId, onFactory, picks, onPicks, planned, onPlanned, stub, isAdmin, clientGives }: {
  order: PlanOrder;
  factoryId: string; onFactory: (id: string) => void;
  picks: StockPick[]; onPicks: (p: StockPick[]) => void;
  planned: PlannedBuy | null; onPlanned: (p: PlannedBuy | null) => void;
  /** Stands in for the order in the purchase form (its id is the one the order will get). */
  stub: Order;
  isAdmin: boolean;
  /** What the client gives for this piece — none of ours is planned for it. */
  clientGives?: { gold: boolean; diamonds: boolean };
}) {
  const db = useDb();
  const [buyOpen, setBuyOpen] = useState(false);
  const co = order.companyId;
  const multi = hasCompanies(db.settings);
  const piece = order.kind === "piece";
  const set = (id: string, patch: Partial<StockPick>) => onPicks(picks.map(p => (p.id === id ? { ...p, ...patch } : p)));
  const add = (p: Omit<StockPick, "id">) => onPicks([...picks, { ...p, id: uid("pk_") }]);
  const remove = (id: string) => onPicks(picks.filter(p => p.id !== id));

  // ── What is wanted, and what the plan covers ──
  // A loose order sells the stones it names: diamonds, the business's own gems, or both.
  const stone = order.stoneSpec?.stone?.trim() || "Diamond";
  const wantsDiamonds = !piece ? hasDiamonds(stone) : true;
  const stoneMats = piece ? [] : materialDefs(db.settings).filter(m => m.kind === "stone" && m.unit === "ct"
    && stone.split("+").some(w => w.trim().toLowerCase() === m.name.toLowerCase()));
  const counted = (id: string) => id === "diamond" || stoneMats.some(m => m.id === id);
  const wantCt = order.diamondWeight || 0;
  const plannedCt = r2(picks.filter(p => counted(p.material)).reduce((s, p) => s + (p.kind === "certified" ? pickAvailable(db, p, co).qty : p.qty || 0), 0)
    + (planned?.lines.filter(l => l.kind === "loose" || l.kind === "certified" || (l.materialId && counted(l.materialId))).reduce((s, l) => s + l.qty, 0) ?? 0));
  const goldNeed = piece && order.metalHasKarats ? estimatedPureGoldNeeded({ productKarats: order.productKarats, estimatedNetWeight: order.estimatedNetWeight, estimatedGrossWeight: order.estimatedGrossWeight, metalWeight: 0 }) : 0;
  const factory = db.factories.find(f => f.id === factoryId);
  const factoryFine = factory ? factoryFineGoldBalance(db.materialIssuances ?? [], factory.id, factory.openingFineGold, co) : 0;
  const goldPlanned = picks.some(p => p.material === "gold") || !!planned?.lines.some(l => l.kind === "gold");

  // ── Stock to choose from ──
  const goldBuckets = Object.entries(deriveStockBalances(db.stockMovements ?? [], "gold", co)).filter(([, q]) => q > 0);
  const others = materialDefs(db.settings).filter(m => m.active !== false);
  const certified = (db.diamondPackets ?? []).filter(p => p.status === "in_stock" && (!multi || companyOf(p) === co));
  const suggestions = order.kind === "loose" && wantsDiamonds ? suggestLots(db, { ...order.stoneSpec, type: order.diamondType || undefined }, co).slice(0, 6) : [];
  // A gem sale: that gem's stock, grade by grade.
  const gemStock = stoneMats.flatMap(m => Object.entries(deriveStockBalances(db.stockMovements ?? [], m.id, co))
    .filter(([, q]) => q > 0).map(([key, q]) => ({ m, key, q: r2(q) })));

  // What the client gives is theirs: ours of it is not offered (their centre stone
  // with our small diamonds is still possible from the order afterwards).
  const ourDia = !clientGives?.diamonds, ourGold = !clientGives?.gold;
  const addMenu = [
    { label: "Diamonds from a bag", icon: Gem, show: ourDia, onSelect: () => add({ material: "diamond", kind: "loose", key: "", qty: 0 }) },
    { label: "Certified stones", icon: Sparkles, show: ourDia, onSelect: () => add({ material: "diamond", kind: "certified", key: "", qty: 0, packetIds: [] }), disabled: !certified.length, hint: certified.length ? undefined : "None in stock" },
    { label: "Gold from stock", icon: Boxes, onSelect: () => add({ material: "gold", kind: "bulk", key: goldBuckets[0]?.[0] ?? "", qty: 0 }), show: piece && ourGold, disabled: !goldBuckets.length, hint: goldBuckets.length ? undefined : "No gold in stock" },
    // The business's own materials (gems, platinum, findings…): in a piece, or sold loose with the stones.
    ...others.map(m => ({ label: `${m.name} from stock`, icon: Boxes, onSelect: () => add({ material: m.id as MaterialKey, kind: "bulk" as const, key: "", qty: 0 }) })),
  ];

  const totalCost = picks.reduce((s, p) => s + (pickCostInr(db, p, co) ?? 0), 0) + (planned?.totalInr ?? 0);

  return (
    <div className="space-y-4">
      {/* Factory — a piece only; its material goes straight to it. */}
      {piece && (
        <div className="space-y-1.5">
          <p className="text-sm font-medium text-foreground flex items-center gap-1.5"><FactoryIcon className="h-4 w-4 text-muted-foreground" />Factory</p>
          <Select value={factoryId || "__none"} onValueChange={v => onFactory(v === "__none" ? "" : v)}>
            <SelectTrigger className="rounded-xl h-11" aria-label="Factory"><SelectValue placeholder="Not chosen yet" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__none">Not chosen yet</SelectItem>
              {db.factories.filter(f => f.active !== false).map(f => <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>)}
              <AddNewItem kind="factory" />
            </SelectContent>
          </Select>
          {(picks.length > 0 || planned) && !factoryId && <p className="text-xs text-amber-700">Choose the factory — the material goes straight to it.</p>}
        </div>
      )}

      {/* Gold: the factory's own account, against the estimate. */}
      {piece && order.metalHasKarats && clientGives?.gold && (
        <p className="rounded-xl border border-amber-500/30 bg-amber-500/[0.04] px-3.5 py-2.5 text-xs text-amber-800">Gold: the client's own — see Material above.</p>
      )}
      {piece && order.metalHasKarats && ourGold && (
        <div className="rounded-xl border border-border/70 px-3.5 py-3 text-sm space-y-1">
          <p className="font-medium text-foreground">Gold</p>
          <p className="text-xs text-muted-foreground">
            {goldNeed > 0 ? <>About <span className="font-medium text-foreground">{fmtG(goldNeed)} g fine</span> needed ({fmtG(order.estimatedNetWeight || order.estimatedGrossWeight)} g {order.productKarats}). </> : !order.productKarats && (order.estimatedNetWeight || order.estimatedGrossWeight) ? "Choose the karats to see the fine gold needed. " : "Add the estimated weight above to see what's needed. "}
            {goldPlanned ? "Planned below." : factory ? <>From {factory.name}&rsquo;s gold account — they hold <span className={`font-medium ${goldNeed > factoryFine ? "text-amber-700" : "text-foreground"}`}>{fmtG(factoryFine)} g fine</span>.</> : "Normally from the factory's own gold account."}
          </p>
          {!goldPlanned && factory && goldNeed > factoryFine && (
            <p className="text-xs text-amber-700 flex items-center gap-1"><AlertTriangle className="h-3.5 w-3.5" />Short by {fmtG(goldNeed - factoryFine)} g fine — send gold from stock or buy it below.</p>
          )}
        </div>
      )}

      {/* A gem sale: what of that gem is in stock — one tap takes it. */}
      {stoneMats.length > 0 && (
        <div className="space-y-2">
          <p className="text-sm font-medium text-foreground">{stoneMats.map(m => m.name).join(" and ")} in stock</p>
          {gemStock.length === 0 ? (
            <p className="text-xs text-muted-foreground">None in stock — buy below.</p>
          ) : (
            <div className="rounded-xl border border-border/70 divide-y divide-border/60 overflow-hidden">
              {gemStock.map(g => {
                const taken = picks.some(p => p.material === g.m.id && p.key === g.key);
                const need = Math.max(0, r2(wantCt - plannedCt));
                return (
                  <div key={`${g.m.id}|${g.key}`} className="flex items-center gap-3 px-3 py-2 text-sm">
                    <p className="min-w-0 flex-1 truncate">{g.key === "—" ? g.m.name : `${g.key} ${g.m.name}`} <span className="text-xs text-muted-foreground">· {g.q} {g.m.unit}</span></p>
                    <Button type="button" size="sm" variant={taken ? "secondary" : "outline"} disabled={taken} className="rounded-lg h-8 gap-1"
                      onClick={() => add({ material: g.m.id as MaterialKey, kind: "bulk", key: g.key, qty: r2(Math.min(g.q, need || g.q)) })}>
                      {taken ? <><Check className="h-3.5 w-3.5" />Added</> : <><Plus className="h-3.5 w-3.5" />Add</>}
                    </Button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Loose diamonds: the bags that suit the request. */}
      {order.kind === "loose" && wantsDiamonds && (
        <div className="space-y-2">
          <p className="text-sm font-medium text-foreground">Matching bags in stock</p>
          {suggestions.length === 0 ? (
            <p className="text-xs text-muted-foreground">No bag in stock matches — buy them below.</p>
          ) : (
            <div className="rounded-xl border border-border/70 divide-y divide-border/60 overflow-hidden">
              {suggestions.map(sg => {
                const taken = picks.some(p => p.kind === "loose" && p.key === sg.lot.key);
                const need = Math.max(0, r2(wantCt - plannedCt));
                return (
                  <div key={sg.lot.key} className="flex items-center gap-3 px-3 py-2 text-sm">
                    <div className="min-w-0 flex-1">
                      <p className="truncate"><span className="font-semibold text-primary">{bagNoOf(db, sg.lot.key) ?? "Bag"}</span> · {lotLabel(sg.lot.key)}</p>
                      <p className="text-xs text-muted-foreground">{sg.lot.ct} ct{sg.lot.pcs != null ? ` · ${sg.lot.pcs} pcs` : ""}{isAdmin && sg.avg ? ` · ${fmtMoneyInr(sg.avg)}/ct` : ""}{sg.full ? " · matches" : " · partly matches"}</p>
                    </div>
                    <Button type="button" size="sm" variant={taken ? "secondary" : "outline"} disabled={taken} className="rounded-lg h-8 gap-1"
                      onClick={() => add({ material: "diamond", kind: "loose", key: sg.lot.key, qty: r2(Math.min(sg.lot.ct, need || sg.lot.ct)) })}>
                      {taken ? <><Check className="h-3.5 w-3.5" />Added</> : <><Plus className="h-3.5 w-3.5" />Add</>}
                    </Button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* From stock: one row per thing taken. */}
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm font-medium text-foreground">From stock</p>
          <MoreMenu button={{ label: "Add from stock", icon: Plus }} actions={addMenu} label="Add from stock" />
        </div>
        {picks.length === 0 && <p className="text-xs text-muted-foreground">Nothing taken from stock.</p>}
        {picks.map(p => {
          const have = pickAvailable(db, p, co);
          const unit = materialUnit(db.settings, p.material);
          const cost = pickCostInr(db, p, co);
          const over = p.kind !== "certified" && p.qty > have.qty + 1e-9;
          return (
            <div key={p.id} className={`rounded-xl border px-3 py-2.5 space-y-2 ${over ? "border-destructive/50" : "border-border/70"}`}>
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  {p.kind === "loose" ? (
                    <LotPicker value={p.key} companyId={co} onChange={k => set(p.id, { key: k })} className="h-10 rounded-lg" />
                  ) : p.kind === "certified" ? (
                    <div className="max-h-40 overflow-y-auto rounded-lg border border-border/60 p-1.5 space-y-0.5">
                      {certified.map(pk => {
                        const on = !!p.packetIds?.includes(pk.id);
                        return (
                          <label key={pk.id} className={`flex items-center gap-2 px-2 py-1.5 rounded-md text-xs cursor-pointer ${on ? "bg-primary/10" : "hover:bg-secondary"}`}>
                            <input type="checkbox" checked={on} onChange={() => set(p.id, { packetIds: on ? p.packetIds!.filter(x => x !== pk.id) : [...(p.packetIds ?? []), pk.id] })} />
                            <span className="font-medium">{pk.stockNumber}</span> · {pk.shape} {pk.carat} ct {[pk.color, pk.clarity].filter(Boolean).join(" ")} · {pk.certificateLab ?? ""} {pk.certificateNumber}
                          </label>
                        );
                      })}
                    </div>
                  ) : p.material === "gold" ? (
                    <Select value={p.key} onValueChange={v => set(p.id, { key: v })}>
                      <SelectTrigger className="h-10 rounded-lg" aria-label="Gold purity"><SelectValue placeholder="Purity" /></SelectTrigger>
                      <SelectContent>{goldBuckets.map(([k, q]) => <SelectItem key={k} value={k}>{k} gold — {r2(q)} g in stock</SelectItem>)}</SelectContent>
                    </Select>
                  ) : (
                    <Select value={p.key} onValueChange={v => set(p.id, { key: v })}>
                      <SelectTrigger className="h-10 rounded-lg" aria-label={`${materialName(db.settings, p.material)} grade`}><SelectValue placeholder={`${materialName(db.settings, p.material)} — grade`} /></SelectTrigger>
                      <SelectContent>
                        {Object.entries(deriveStockBalances(db.stockMovements ?? [], p.material, co)).filter(([, q]) => q > 0)
                          .map(([k, q]) => <SelectItem key={k} value={k}>{k === "—" ? materialName(db.settings, p.material) : `${k} ${materialName(db.settings, p.material)}`} — {r2(q)} {unit}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  )}
                </div>
                <button type="button" onClick={() => remove(p.id)} aria-label="Remove" className="h-10 w-9 grid place-items-center rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 shrink-0">
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
              {p.kind !== "certified" && (
                <div className="flex flex-wrap items-center gap-2">
                  <div className="relative w-32">
                    <Input type="number" min={0} step="0.01" value={p.qty || ""} onChange={e => set(p.id, { qty: Number(e.target.value) || 0 })}
                      className="h-9 rounded-lg pr-9" placeholder="0" aria-label={`Quantity (${unit})`} />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">{unit}</span>
                  </div>
                  {p.kind === "loose" && (
                    <div className="relative w-28">
                      <Input type="number" min={0} step="1" value={p.pcs || ""} onChange={e => set(p.id, { pcs: Number(e.target.value) || undefined })}
                        className="h-9 rounded-lg pr-10" placeholder="0" aria-label="Pieces" />
                      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">pcs</span>
                    </div>
                  )}
                  <span className={`text-xs ${over ? "text-destructive font-medium" : "text-muted-foreground"}`}>
                    {p.key ? `${have.qty} ${unit}${have.pcs != null ? ` · ${have.pcs} pcs` : ""} in stock` : "Choose what"}
                  </span>
                  {isAdmin && p.key && <span className="text-xs text-muted-foreground ml-auto">{cost != null ? fmtMoneyInr(cost) : "no cost on record"}</span>}
                </div>
              )}
              {p.kind === "certified" && isAdmin && (p.packetIds?.length ?? 0) > 0 && (
                <p className="text-xs text-muted-foreground">{have.qty} ct · {cost != null ? fmtMoneyInr(cost) : "no cost on record"}</p>
              )}
            </div>
          );
        })}
      </div>

      {/* Bought for it: one supplier bill. */}
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm font-medium text-foreground">Buy new</p>
          {!planned && <Button type="button" variant="outline" size="sm" className="rounded-lg gap-1.5" onClick={() => setBuyOpen(true)}><ShoppingCart className="h-3.5 w-3.5" />Buy from a supplier</Button>}
        </div>
        {planned ? (
          <div className="rounded-xl border border-border/70 px-3.5 py-3 text-sm space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <p className="font-medium text-foreground truncate">{planned.supplierName}{planned.billNo ? ` · bill ${planned.billNo}` : ""}</p>
              <div className="flex items-center gap-1 shrink-0">
                <Button type="button" variant="ghost" size="sm" className="h-8 rounded-lg gap-1" onClick={() => setBuyOpen(true)}><Pencil className="h-3.5 w-3.5" />Change</Button>
                <Button type="button" variant="ghost" size="sm" className="h-8 rounded-lg gap-1 text-destructive" onClick={() => onPlanned(null)}><Trash2 className="h-3.5 w-3.5" />Remove</Button>
              </div>
            </div>
            <ul className="text-xs text-muted-foreground space-y-0.5">
              {planned.lines.map((l, i) => <li key={i} className="flex justify-between gap-3"><span className="truncate">{l.qty} {l.unit} · {l.text}</span>{isAdmin && <span className="tabular-nums">{fmtMoneyInr(l.inr)}</span>}</li>)}
            </ul>
            <p className="text-xs text-muted-foreground">Recorded on the supplier&rsquo;s account when the order is placed{piece ? " — straight to the factory" : ""}.</p>
          </div>
        ) : <p className="text-xs text-muted-foreground">Nothing bought for it.</p>}
        <BuyMaterialForm open={buyOpen} onOpenChange={setBuyOpen} plan={{ stub, onPlanned }} />
      </div>

      {/* Coverage — of our diamonds; the client's own are taken in above. */}
      {clientGives?.diamonds && piece && <p className="text-xs text-amber-800 flex items-center gap-1.5"><Gem className="h-3.5 w-3.5" />Diamonds: the client's own — see Material above.</p>}
      {ourDia && (wantCt > 0 || plannedCt > 0) && (
        <p className={`text-xs flex items-center gap-1.5 ${plannedCt >= wantCt && wantCt > 0 ? "text-success" : "text-muted-foreground"}`}>
          <Gem className="h-3.5 w-3.5" />{piece || stone === "Diamond" ? "Diamonds" : "Stones"} planned: {plannedCt} ct{wantCt ? ` of ${wantCt} ct` : ""}{plannedCt >= wantCt && wantCt > 0 ? " — covered" : ""}
        </p>
      )}
      {isAdmin && (picks.length > 0 || planned) && <p className="text-xs text-muted-foreground">Material planned: <span className="font-medium text-foreground">{fmtMoneyInr(r2(totalCost))}</span></p>}
    </div>
  );
}
