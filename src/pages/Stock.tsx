import { PageHeader } from "@/components/PageHeader";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useDb } from "@/hooks/useDb";
import { loadDb } from "@/lib/db";
import { useAuth } from "@/lib/auth";
import { subscribeStockLevelsByCompany, recomputeStockFromHistory, type StockLevels } from "@/lib/stock";
import { deriveStockBalances } from "@/lib/manufacturing";
import { Gem, Coins, BadgeCheck, RotateCcw, History, Layers, Link2, Plus, type LucideIcon } from "lucide-react";
import { toast } from "sonner";
import { materialDefs, KIND_LABEL, fmtQty } from "@/lib/materials";
import { MaterialEditor } from "@/components/MaterialsSettings";
import { CompanyFilter, useMultiCo } from "@/components/CompanyFields";
import { StockTransferDialog } from "@/components/StockTransfer";
import { companiesOf, companyOf } from "@/lib/companies";
import { ArrowRightLeft } from "lucide-react";

/**
 * One material's stock, in the app's one figure style: its name and how many
 * grades, the amount in tabular digits, and the way to its history — the whole
 * card opens it.
 */
function MaterialCard({ name, sub, value, icon: Icon, to, dim }: {
  name: string; sub: string; value: string; icon: LucideIcon; to: string; dim?: boolean;
}) {
  return (
    <Link to={to} className={`group h-full min-w-0 flex flex-col rounded-2xl border border-border/70 bg-white px-4 py-3.5 shadow-[0_1px_2px_rgb(15_23_42/0.04)] transition-shadow hover:shadow-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 ${dim ? "opacity-70" : ""}`}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium text-brand-dark truncate">{name}</p>
        <Icon className="h-4 w-4 shrink-0 text-muted-foreground/60" />
      </div>
      <p className="text-[11px] text-muted-foreground truncate">{sub}</p>
      <p className="mt-2 text-[clamp(1.125rem,4.4vw,1.5rem)] font-semibold tracking-tight tabular-nums leading-tight text-brand-dark break-words">{value}</p>
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
      {/* Whose stock is a choice about the whole page, so it sits in the header. */}
      <PageHeader
        title="Stock"
        subtitle="On hand, by material"
        actions={<CompanyFilter value={co} onChange={pickCo} className="h-10 rounded-xl text-sm bg-white w-full sm:w-52" />}
        menuTitle="Stock"
        menu={[
          { label: "Move between companies", icon: ArrowRightLeft, hint: "From one company to another", onSelect: () => setMoving(true), show: multiCo && user?.role === "admin" },
          { label: recomputing ? "Recomputing…" : "Recompute from history", icon: RotateCcw, hint: "Rebuild counters from movements", onSelect: recompute, disabled: recomputing, show: user?.role === "admin" },
        ]}
      />
      {moving && <StockTransferDialog onClose={() => setMoving(false)} />}


      <div className="grid gap-3 grid-cols-2 lg:grid-cols-3">
        <MaterialCard name="Gold Reserve" icon={Coins} sub={`${goldPurities} purit${goldPurities === 1 ? "y" : "ies"} in stock`}
          value={`${goldTotal.toLocaleString()} g`} to={`/stock/gold${view !== "all" ? `?co=${view}` : ""}`} />
        <MaterialCard name="Loose Diamonds" icon={Gem} sub={`${diamondShapes} shape${diamondShapes === 1 ? "" : "s"} in stock`}
          value={`${diamondTotal.toLocaleString()} ct`} to={`/stock/diamond${view !== "all" ? `?co=${view}` : ""}`} />
        <MaterialCard name="Certified Diamonds" icon={BadgeCheck} sub="One certificate each"
          value={`${inStockPackets.length} packet${inStockPackets.length !== 1 ? "s" : ""}`} to={`/stock/certified${view !== "all" ? `?co=${view}` : ""}`} />
        {others.map(({ m, total, grades }) => (
          <MaterialCard key={m.id} name={m.name} icon={m.kind === "stone" ? Gem : m.kind === "finding" ? Link2 : Layers}
            sub={`${KIND_LABEL[m.kind]} · ${grades} grade${grades === 1 ? "" : "s"} in stock`} value={fmtQty(total, m.unit)}
            to={`/stock/${m.id}${view !== "all" ? `?co=${view}` : ""}`} dim={m.active === false} />
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
    </div>
  );
}
