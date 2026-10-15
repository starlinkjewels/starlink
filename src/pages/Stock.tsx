import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useDb } from "@/hooks/useDb";
import { loadDb } from "@/lib/db";
import { useAuth } from "@/lib/auth";
import { subscribeStockLevelsByCompany, recomputeStockFromHistory, type StockLevels } from "@/lib/stock";
import { deriveStockBalances } from "@/lib/manufacturing";
import { Button } from "@/components/ui/button";
import { AsyncButton } from "@/components/AsyncButton";
import { Gem, Coins, BadgeCheck, RotateCcw, History, Layers, Link2, Plus } from "lucide-react";
import { toast } from "sonner";
import { materialDefs, KIND_LABEL, fmtQty } from "@/lib/materials";
import { MaterialEditor } from "@/components/MaterialsSettings";
import { CompanyFilter, useMultiCo } from "@/components/CompanyFields";
import { StockTransferDialog } from "@/components/StockTransfer";
import { companiesOf, companyOf } from "@/lib/companies";
import { ArrowRightLeft } from "lucide-react";

export function StockPage() {
  const { user } = useAuth();
  const db = useDb();
  // Each company holds its own stock, with its own counter behind the floor check.
  const [levelsBy, setLevelsBy] = useState<Record<string, StockLevels>>({});
  const [recomputing, setRecomputing] = useState(false);
  const [addingMaterial, setAddingMaterial] = useState(false);
  const [moving, setMoving] = useState(false);
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
  const inStockPackets = (db.diamondPackets ?? []).filter(p => p.status === "in_stock" && (view === "all" || companyOf(p) === view));
  // Every other material (Settings → Materials): offered ones, and any switched
  // off that still has stock or history.
  const others = materialDefs(db.settings)
    .map(m => {
      const bal = deriveStockBalances(db.stockMovements, m.id, view);
      return { m, bal, total: Object.values(bal).reduce((s, q) => s + q, 0), grades: Object.values(bal).filter(q => q !== 0).length, moved: (db.stockMovements ?? []).some(x => x.material === m.id) };
    })
    .filter(x => x.m.active !== false || x.moved);

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
  const driftKey = driftingCos.join(",");
  useEffect(() => {
    if (user?.role !== "admin" || !driftKey || healed.current) return;
    const t = setTimeout(() => {
      healed.current = true;
      // A company with no movements of its own yet has nothing to rebuild from — left alone.
      const movements = loadDb().stockMovements ?? [];
      Promise.all(driftKey.split(",").filter(id => movements.some(m => companyOf(m) === id))
        .map(id => recomputeStockFromHistory(movements, id))).catch(() => { /* manual button remains */ });
    }, 4000);
    return () => clearTimeout(t);
  }, [driftKey, user, db.stockMovements, levelsBy]);

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
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="font-display text-2xl md:text-3xl text-brand-dark">Stock</h1>
          <p className="text-sm text-muted-foreground">Gold, diamonds{others.length ? " and other materials" : ""} on hand</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <CompanyFilter value={co} onChange={pickCo} />
          {multiCo && user?.role === "admin" && (
            <Button variant="outline" onClick={() => setMoving(true)} className="rounded-xl gap-2"><ArrowRightLeft className="h-4 w-4" /> Move between companies</Button>
          )}
          {user?.role === "admin" && (
            <AsyncButton variant="outline" onClick={recompute} disabled={recomputing} className="rounded-xl gap-2">
              <RotateCcw className="h-4 w-4" /> Recompute from History
            </AsyncButton>
          )}
        </div>
      </div>
      {moving && <StockTransferDialog onClose={() => setMoving(false)} />}


      <div className="grid gap-4 md:grid-cols-3">
        <div className="card-luxe p-5 flex flex-col">
          <div className="flex items-center gap-3">
            <div className="h-12 w-12 rounded-2xl bg-amber-500/15 grid place-items-center shrink-0"><Coins className="h-5 w-5 text-amber-600" /></div>
            <div className="min-w-0">
              <p className="font-display text-lg text-brand-dark leading-tight">Gold Reserve</p>
              <p className="text-xs text-muted-foreground">{goldPurities} purit{goldPurities === 1 ? "y" : "ies"} in stock</p>
            </div>
          </div>
          <p className="text-2xl font-display font-bold text-brand-dark mt-4">{goldTotal.toLocaleString()} g</p>
          <p className="text-xs text-muted-foreground mt-0.5">Total across all purities</p>
          <div className="mt-4 pt-3 border-t border-border/50">
            <Button asChild variant="outline" size="sm" className="w-full rounded-xl gap-2 font-medium">
              <Link to={`/stock/gold${view !== "all" ? `?co=${view}` : ""}`}><History className="h-4 w-4 text-primary" />View History</Link>
            </Button>
          </div>
        </div>

        <div className="card-luxe p-5 flex flex-col">
          <div className="flex items-center gap-3">
            <div className="h-12 w-12 rounded-2xl bg-cyan-500/15 grid place-items-center shrink-0"><Gem className="h-5 w-5 text-cyan-600" /></div>
            <div className="min-w-0">
              <p className="font-display text-lg text-brand-dark leading-tight">Loose Diamonds</p>
              <p className="text-xs text-muted-foreground">{diamondShapes} shape{diamondShapes === 1 ? "" : "s"} in stock</p>
            </div>
          </div>
          <p className="text-2xl font-display font-bold text-brand-dark mt-4">{diamondTotal.toLocaleString()} ct</p>
          <p className="text-xs text-muted-foreground mt-0.5">Pooled by shape, total carats</p>
          <div className="mt-4 pt-3 border-t border-border/50">
            <Button asChild variant="outline" size="sm" className="w-full rounded-xl gap-2 font-medium">
              <Link to={`/stock/diamond${view !== "all" ? `?co=${view}` : ""}`}><History className="h-4 w-4 text-primary" />View History</Link>
            </Button>
          </div>
        </div>

        <div className="card-luxe p-5 flex flex-col">
          <div className="flex items-center gap-3">
            <div className="h-12 w-12 rounded-2xl bg-violet-500/15 grid place-items-center shrink-0"><BadgeCheck className="h-5 w-5 text-violet-600" /></div>
            <div className="min-w-0">
              <p className="font-display text-lg text-brand-dark leading-tight">Certified Diamonds</p>
              <p className="text-xs text-muted-foreground">Each with its own certificate</p>
            </div>
          </div>
          <p className="text-2xl font-display font-bold text-brand-dark mt-4">{inStockPackets.length}</p>
          <p className="text-xs text-muted-foreground mt-0.5">Packet{inStockPackets.length !== 1 ? "s" : ""} in stock</p>
          <div className="mt-4 pt-3 border-t border-border/50">
            <Button asChild variant="outline" size="sm" className="w-full rounded-xl gap-2 font-medium">
              <Link to={`/stock/certified${view !== "all" ? `?co=${view}` : ""}`}><History className="h-4 w-4 text-primary" />View History</Link>
            </Button>
          </div>
        </div>

        {others.map(({ m, total, grades }) => {
          const Icon = m.kind === "stone" ? Gem : m.kind === "finding" ? Link2 : Layers;
          return (
            <div key={m.id} className={`card-luxe p-5 flex flex-col ${m.active === false ? "opacity-70" : ""}`}>
              <div className="flex items-center gap-3">
                <div className="h-12 w-12 rounded-2xl bg-emerald-500/15 grid place-items-center shrink-0"><Icon className="h-5 w-5 text-emerald-600" /></div>
                <div className="min-w-0">
                  <p className="font-display text-lg text-brand-dark leading-tight truncate">{m.name}</p>
                  <p className="text-xs text-muted-foreground">{KIND_LABEL[m.kind]} · {grades} grade{grades === 1 ? "" : "s"} in stock</p>
                </div>
              </div>
              <p className="text-2xl font-display font-bold text-brand-dark mt-4">{fmtQty(total, m.unit)}</p>
              <p className="text-xs text-muted-foreground mt-0.5">Total across all grades</p>
              <div className="mt-4 pt-3 border-t border-border/50">
                <Button asChild variant="outline" size="sm" className="w-full rounded-xl gap-2 font-medium">
                  <Link to={`/stock/${m.id}${view !== "all" ? `?co=${view}` : ""}`}><History className="h-4 w-4 text-primary" />View History</Link>
                </Button>
              </div>
            </div>
          );
        })}

        {user?.role === "admin" && (
          <button type="button" onClick={() => setAddingMaterial(true)}
            className="rounded-2xl border-2 border-dashed border-border/80 p-5 flex flex-col items-center justify-center gap-2 text-center text-muted-foreground hover:border-primary/50 hover:text-primary transition-colors min-h-[180px]">
            <Plus className="h-6 w-6" />
            <span className="font-semibold text-sm">Add another material</span>
            <span className="text-xs max-w-[16rem]">Platinum, silver, gemstones, pearls, locks — anything a piece uses besides gold and diamonds</span>
          </button>
        )}
      </div>
      {addingMaterial && <MaterialEditor onClose={() => setAddingMaterial(false)} />}
    </div>
  );
}
