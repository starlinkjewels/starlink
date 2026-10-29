import { PageHeader } from "@/components/PageHeader";
import { OpeningStock } from "@/pages/BuyAssign";
import { BuyMaterialForm } from "@/components/BuyMaterialForm";
import { useLoaded } from "@/hooks/useLoaded";
import { stockAverageRate } from "@/lib/orderCost";
import { lotBalances } from "@/lib/diamondLots";
import { useCan } from "@/hooks/useCan";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useDb } from "@/hooks/useDb";
import { loadDb, toPureGold } from "@/lib/db";
import { useAuth } from "@/lib/auth";
import { subscribeStockLevelsByCompany, recomputeStockFromHistory, type StockLevels } from "@/lib/stock";
import { deriveStockBalances, factoryAccount, factoryFineGoldBalance, factoryOtherBalances, fmtMoneyInr } from "@/lib/manufacturing";
import { Gem, Coins, BadgeCheck, RotateCcw, History, Layers, Link2, Plus, Boxes, type LucideIcon } from "lucide-react";
import { toast } from "sonner";
import { materialDefs, KIND_LABEL, fmtQty } from "@/lib/materials";
import { MaterialEditor } from "@/components/MaterialsSettings";
import { CompanyFilter, useMultiCo } from "@/components/CompanyFields";
import { StockTransferDialog } from "@/components/StockTransfer";
import { companiesOf, companyOf } from "@/lib/companies";
import { ArrowRightLeft } from "lucide-react";
import { useDataFresh } from "@/hooks/useDataFresh";

/**
 * One material's stock, in the app's one figure style: its name and how many
 * grades, the amount in tabular digits, and the way to its history — the whole
 * card opens it.
 */
function MaterialCard({ name, sub, value, lines = [], icon: Icon, to, dim }: {
  name: string; sub: string; value: string;
  /** Under the figure: what it is worth, and what is out at factories. */
  lines?: (string | null | undefined)[];
  icon: LucideIcon; to: string; dim?: boolean;
}) {
  const shown = lines.filter(Boolean);
  return (
    <Link to={to} className={`group h-full min-w-0 flex flex-col rounded-2xl border border-border/70 bg-white px-4 py-3.5 shadow-[0_1px_2px_rgb(15_23_42/0.04)] transition-shadow hover:shadow-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 ${dim ? "opacity-70" : ""}`}>
      {/* Two cards across a phone: the name and its line wrap rather than end in "…". */}
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-medium text-brand-dark leading-snug min-w-0 break-words">{name}</p>
        <Icon className="h-4 w-4 shrink-0 mt-0.5 text-muted-foreground/60" />
      </div>
      <p className="text-[11px] text-muted-foreground leading-snug line-clamp-2">{sub}</p>
      <p className="mt-2 text-[clamp(1.125rem,4.4vw,1.5rem)] font-semibold tracking-tight tabular-nums leading-tight text-brand-dark break-words">{value}</p>
      {shown.length > 0 && (
        <div className="mt-1 space-y-0.5">
          {shown.map(l => <p key={l} className="text-[11px] text-muted-foreground tabular-nums leading-snug">{l}</p>)}
        </div>
      )}
      <span className="mt-auto pt-3 inline-flex items-center gap-1.5 text-xs font-medium text-primary"><History className="h-3.5 w-3.5" />View History</span>
    </Link>
  );
}

export function StockPage() {
  const { user } = useAuth();
  const db = useDb();
  // Each company holds its own stock, with its own counter behind the floor check.
  const [levelsBy, setLevelsBy] = useState<Record<string, StockLevels>>({});
  const [recomputing, setRecomputing] = useState(false);
  const [addingMaterial, setAddingMaterial] = useState(false);
  const [moving, setMoving] = useState(false);
  const can = useCan();
  const mayAddStock = can("buyAssign", "add");
  const [opening, setOpening] = useState(false);
  const multiCo = useMultiCo();
  const [co, setCo] = useState<string>(() => { try { return localStorage.getItem("stock-company") || "all"; } catch { return "all"; } });
  const pickCo = (v: string) => { setCo(v); try { localStorage.setItem("stock-company", v); } catch { /* ignore */ } };
  const coIds = companiesOf(db.settings).map(c => c.id);
  const coKey = coIds.join(",");
  /** The company being looked at, or every company's stock together. */
  const view = multiCo ? co : "all";

  useEffect(() => subscribeStockLevelsByCompany(coKey.split(","), setLevelsBy), [coKey]);

  // Balances derived from the movement ledger (the true record) so every screen agrees.
  const goldBal = deriveStockBalances(db.stockMovements, "gold", view);
  const diamondBal = deriveStockBalances(db.stockMovements, "diamond", view);
  const goldTotal = Object.values(goldBal).reduce((s, g) => s + g, 0);
  const diamondTotal = Object.values(diamondBal).reduce((s, c) => s + c, 0);
  const goldPurities = Object.entries(goldBal).filter(([, g]) => g !== 0).length;
  const diamondShapes = Object.entries(diamondBal).filter(([, c]) => c !== 0).length;
  // Loose diamonds by lot (lib/diamondLots.ts): how many lots, and the stones counted in them.
  const lots = lotBalances(db.stockMovements ?? [], view).filter(l => l.ct > 0);
  const lotPcs = lots.reduce((t, l) => t + (l.pcs ?? 0), 0);
  const inStockPackets = (db.diamondPackets ?? []).filter(p => p.status === "in_stock" && (view === "all" || companyOf(p) === view));
  // Every other material (Settings → Materials): offered ones, and any switched
  // off that still has stock or history.
  const others = materialDefs(db.settings)
    .map(m => {
      const bal = deriveStockBalances(db.stockMovements, m.id, view);
      return { m, bal, total: Object.values(bal).reduce((s, q) => s + q, 0), grades: Object.values(bal).filter(q => q !== 0).length, moved: (db.stockMovements ?? []).some(x => x.material === m.id) };
    })
    .filter(x => x.m.active !== false || x.moved);

  // ── What it is worth, and what is out at factories ──
  // Valued as the lots table on each material's page values it: every grade at
  // its pool's average cost (lib/orderCost.ts stockAverageRate). That reads the
  // purchase bills, which this page does not otherwise download — so the
  // value appears once they are here. A grade never priced is counted, not guessed.
  const priced = useLoaded(["purchases"]);
  const nowIso = new Date().toISOString();
  const coArg = view === "all" ? undefined : view;
  const worth = (material: string, grades: [string, number][]): string | null => {
    if (!priced) return null;
    let value = 0, unpriced = 0;
    for (const [key, qty] of grades) {
      if (!(qty > 0.0005)) continue;
      const avg = stockAverageRate(db, material, key, nowIso, coArg);
      if (avg == null) unpriced++; else value += avg * qty;
    }
    if (!value && !unpriced) return null;
    return `Worth ≈ ${fmtMoneyInr(Math.round(value))}${unpriced ? ` · ${unpriced} not priced` : ""}`;
  };
  // Held by the factories for the company being looked at — the figures each factory's page shows.
  const atFactoriesGold = db.factories.reduce((t, f) => t + factoryFineGoldBalance(db.materialIssuances, f.id, f.openingFineGold, view), 0);
  const atFactoriesDia = db.factories.reduce((t, f) => t + factoryAccount(db.materialIssuances.filter(i => i.factoryId === f.id && (view === "all" || companyOf(i) === view))).diamondOutstanding, 0);
  const atFactoriesOther = (material: string) => db.factories.reduce((t, f) => t + (factoryOtherBalances(db.materialIssuances, f.id, view)[material] ?? 0), 0);
  const r3 = (n: number) => Math.round(n * 1000) / 1000;
  const atFactories = (n: number, unit: string) => (Math.abs(n) >= 0.0005 ? `At factories: ${r3(n).toLocaleString()} ${unit}` : null);
  // Gold leads with fine (24KT) grams — what it is worth and what a factory owes back.
  const goldFine = r3(Object.entries(goldBal).reduce((t, [k, g]) => t + toPureGold(g, k), 0));
  // A certified stone carries its own cost per carat.
  const packetsPriced = inStockPackets.filter(p => p.ratePerCaratInr != null);
  const packetsWorth = packetsPriced.length
    ? `Worth ≈ ${fmtMoneyInr(Math.round(packetsPriced.reduce((t, p) => t + (p.ratePerCaratInr ?? 0) * p.carat, 0)))}${packetsPriced.length < inStockPackets.length ? ` · ${inStockPackets.length - packetsPriced.length} not priced` : ""}`
    : null;
  // New purchase is Buy & Assign's own form; it reads the bills too, so it opens once they are here.
  const [buying, setBuying] = useState(false);

  // The cached counter (used by the floor-check when issuing) can drift from the
  // ledger. Displayed balances already come from the ledger; flag drift so an
  // admin can resync the counter so issuing stays accurate too.
  // Checked company by company: each counter against that company's own ledger.
  const cmp = (a: Record<string, number>, b: Record<string, number>) => {
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) if (Math.abs((a[k] || 0) - (b[k] || 0)) > 0.001) return true;
    return false;
  };
  const materialsAll = ["gold", "diamond", ...materialDefs(db.settings).map(m => m.id)];
  const driftingCos = coIds.filter(id => {
    const lv = levelsBy[id] as unknown as Record<string, Record<string, number> | undefined> | undefined;
    if (!lv) return false;
    return materialsAll.some(mat => cmp(deriveStockBalances(db.stockMovements, mat, id), lv[mat] || {}));
  });
  const cacheDrift = driftingCos.length > 0;

  // Auto-heal: when the cached counter drifts from the ledger, silently resync
  // it from history — no banner, no modal, no button to click. The displayed
  // balances already come from the ledger (correct); this just keeps the
  // internal issuing counter honest. Runs once per session; the manual button
  // below stays as an admin escape hatch. (deriveStockBalances only rounds to
  // 3dp vs recompute's raw sum, well inside the 0.001 drift tolerance, so one
  // pass always clears the drift — no thrash.)
  //
  // Only once the two have stopped changing: a counter moves a moment before
  // its movement reaches this screen, and rebuilding in that moment, from a
  // history one entry short, would take the very change just made back out.
  const healed = useRef(false);
  const fresh = useDataFresh();
  const driftKey = driftingCos.join(",");
  useEffect(() => {
    if (user?.role !== "admin" || !driftKey || healed.current || !fresh) return;
    const t = setTimeout(() => {
      healed.current = true;
      // A company with no movements of its own yet has nothing to rebuild from — left alone.
      const movements = loadDb().stockMovements ?? [];
      Promise.all(driftKey.split(",").filter(id => movements.some(m => companyOf(m) === id))
        .map(id => recomputeStockFromHistory(movements, id))).catch(() => { /* manual button remains */ });
    }, 4000);
    return () => clearTimeout(t);
  }, [driftKey, user, db.stockMovements, levelsBy, fresh]);

  const recompute = async () => {
    setRecomputing(true);
    try {
      for (const id of coIds) if (id === "main" || (db.stockMovements ?? []).some(m => companyOf(m) === id)) await recomputeStockFromHistory(db.stockMovements, id);
      toast.success("Stock recomputed from history");
    } catch {
      toast.error("Recompute failed");
    } finally { setRecomputing(false); }
  };

  return (
    <div className="max-w-7xl mx-auto space-y-5">
      {/* Whose stock is a choice about the whole page, so it sits in the header. */}
      <PageHeader
        title="Stock"
        subtitle="On hand, by material"
        // Buying is the everyday way stock comes in — the same form as Buy & Assign → New purchase.
        primary={mayAddStock ? { label: "New purchase", icon: Plus, onClick: () => setBuying(true) } : null}
        actions={<CompanyFilter value={co} onChange={pickCo} className="h-10 rounded-xl text-sm bg-white w-full sm:w-52" />}
        menuTitle="Stock"
        menu={[
          // Stock already on hand before the app — a one-time job, so it waits here.
          { label: "Opening stock", icon: Boxes, hint: "From before the app — no dues", onSelect: () => setOpening(true), show: mayAddStock },
          { label: "Move between companies", icon: ArrowRightLeft, hint: "From one company to another", onSelect: () => setMoving(true), show: multiCo && user?.role === "admin" },
          { label: recomputing ? "Recomputing…" : "Recompute from history", icon: RotateCcw, hint: "Rebuild counters from movements", onSelect: recompute, disabled: recomputing, show: user?.role === "admin" },
        ]}
      />
      {moving && <StockTransferDialog onClose={() => setMoving(false)} />}


      <div className="grid gap-3 grid-cols-2 lg:grid-cols-3">
        <MaterialCard name="Gold Reserve" icon={Coins} sub={`${goldTotal.toLocaleString()} g · ${goldPurities} purit${goldPurities === 1 ? "y" : "ies"} in stock`}
          value={`${goldFine.toLocaleString()} g fine`} to={`/stock/gold${view !== "all" ? `?co=${view}` : ""}`}
          lines={[worth("gold", Object.entries(goldBal)), atFactories(atFactoriesGold, "g fine")]} />
        <MaterialCard name="Loose Diamonds" icon={Gem} sub={`${lots.length || diamondShapes} lot${(lots.length || diamondShapes) === 1 ? "" : "s"} in stock${lotPcs ? ` · ${lotPcs.toLocaleString()} pcs` : ""}`}
          value={`${diamondTotal.toLocaleString()} ct`} to={`/stock/diamond${view !== "all" ? `?co=${view}` : ""}`}
          lines={[worth("diamond", lots.map(l => [l.key, l.ct] as [string, number])), atFactories(atFactoriesDia, "ct")]} />
        <MaterialCard name="Certified Diamonds" icon={BadgeCheck} sub="One certificate each"
          value={`${inStockPackets.length} packet${inStockPackets.length !== 1 ? "s" : ""}`} to={`/stock/certified${view !== "all" ? `?co=${view}` : ""}`}
          lines={[packetsWorth]} />
        {others.map(({ m, bal, total, grades }) => (
          <MaterialCard key={m.id} name={m.name} icon={m.kind === "stone" ? Gem : m.kind === "finding" ? Link2 : Layers}
            sub={`${KIND_LABEL[m.kind] ? `${KIND_LABEL[m.kind]} · ` : ""}${grades} grade${grades === 1 ? "" : "s"} in stock`} value={fmtQty(total, m.unit)}
            to={`/stock/${m.id}${view !== "all" ? `?co=${view}` : ""}`} dim={m.active === false}
            lines={[worth(m.id, Object.entries(bal)), atFactories(atFactoriesOther(m.id), m.unit)]} />
        ))}

        {user?.role === "admin" && (
          <button type="button" onClick={() => setAddingMaterial(true)}
            className="rounded-2xl border-2 border-dashed border-border/80 p-4 flex flex-col items-center justify-center gap-1.5 text-center text-muted-foreground hover:border-primary/50 hover:text-primary transition-colors min-h-[8.5rem]">
            <Plus className="h-6 w-6" />
            <span className="font-semibold text-sm">Add another material</span>
            <span className="text-xs max-w-[16rem]">Platinum, silver, gemstones, findings…</span>
          </button>
        )}
      </div>
      {addingMaterial && <MaterialEditor onClose={() => setAddingMaterial(false)} />}
      {mayAddStock && <OpeningStock open={opening} onOpenChange={setOpening} />}
      {mayAddStock && <BuyMaterialForm open={buying && priced} onOpenChange={setBuying} />}
    </div>
  );
}
