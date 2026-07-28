import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useDb } from "@/hooks/useDb";
import { useAuth } from "@/lib/auth";
import { subscribeStockLevels, recomputeStockFromHistory, type StockLevels } from "@/lib/stock";
import { Button } from "@/components/ui/button";
import { AsyncButton } from "@/components/AsyncButton";
import { Gem, Coins, BadgeCheck, RotateCcw, History } from "lucide-react";
import { toast } from "sonner";

export function StockPage() {
  const { user } = useAuth();
  const db = useDb();
  const [levels, setLevels] = useState<StockLevels | null>(null);
  const [recomputing, setRecomputing] = useState(false);

  useEffect(() => subscribeStockLevels(setLevels), []);

  const goldTotal = Object.values(levels?.gold ?? {}).reduce((s, g) => s + g, 0);
  const diamondTotal = Object.values(levels?.diamond ?? {}).reduce((s, c) => s + c, 0);
  const goldPurities = Object.entries(levels?.gold ?? {}).filter(([, g]) => g !== 0).length;
  const diamondShapes = Object.entries(levels?.diamond ?? {}).filter(([, c]) => c !== 0).length;
  const inStockPackets = (db.diamondPackets ?? []).filter(p => p.status === "in_stock");

  const recompute = async () => {
    if (!confirm("Recompute current stock from the full movement history? Use this only if the balance looks wrong.")) return;
    setRecomputing(true);
    try {
      const fresh = await recomputeStockFromHistory(db.stockMovements);
      setLevels(fresh);
      toast.success("Stock recomputed from history");
    } catch {
      toast.error("Recompute failed");
    } finally { setRecomputing(false); }
  };

  return (
    <div className="max-w-6xl mx-auto space-y-5">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="font-display text-2xl md:text-3xl text-brand-dark">Stock</h1>
          <p className="text-sm text-muted-foreground">Gold &amp; diamond inventory on hand</p>
        </div>
        {user?.role === "admin" && (
          <AsyncButton variant="outline" onClick={recompute} disabled={recomputing} className="rounded-xl gap-2">
            <RotateCcw className="h-4 w-4" /> Recompute from History
          </AsyncButton>
        )}
      </div>

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
              <Link to="/stock/gold"><History className="h-4 w-4 text-primary" />View History</Link>
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
              <Link to="/stock/diamond"><History className="h-4 w-4 text-primary" />View History</Link>
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
              <Link to="/stock/certified"><History className="h-4 w-4 text-primary" />View History</Link>
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
