import { useEffect, useState } from "react";
import { fmtDate } from "@/lib/db";
import { useDb } from "@/hooks/useDb";
import { useAuth } from "@/lib/auth";
import { subscribeStockLevels, recomputeStockFromHistory, type StockLevels } from "@/lib/stock";
import { AsyncButton } from "@/components/AsyncButton";
import { usePagination } from "@/hooks/usePagination";
import { PaginationBar } from "@/components/PaginationBar";
import { Gem, Coins, ArrowDownCircle, ArrowUpCircle, RotateCcw, BadgeCheck } from "lucide-react";
import { toast } from "sonner";

const PAGE_SIZE = 15;

const MOVEMENT_LABEL: Record<string, string> = {
  purchase_in: "Purchased",
  issuance_out: "Issued to factory",
  order_direct_use: "Used directly on order",
  adjustment: "Manual adjustment",
};

export function StockPage() {
  const { user } = useAuth();
  const db = useDb();
  const [levels, setLevels] = useState<StockLevels | null>(null);
  const [recomputing, setRecomputing] = useState(false);

  useEffect(() => subscribeStockLevels(setLevels), []);

  const movements = [...db.stockMovements].sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));
  const { paged, page, setPage, totalPages, start, end } = usePagination(movements, PAGE_SIZE);

  const goldEntries = Object.entries(levels?.gold ?? {}).filter(([, g]) => g !== 0);
  const diamondEntries = Object.entries(levels?.diamond ?? {}).filter(([, c]) => c !== 0);
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

      <div className="grid gap-4 md:grid-cols-2">
        <div className="card-luxe p-5">
          <div className="flex items-center gap-3 mb-4">
            <div className="h-10 w-10 rounded-xl bg-amber-500/10 grid place-items-center"><Coins className="h-5 w-5 text-amber-600" /></div>
            <h3 className="font-display text-lg text-brand-dark">Gold Reserve</h3>
          </div>
          {goldEntries.length === 0 ? (
            <p className="text-sm text-muted-foreground">No gold in stock.</p>
          ) : (
            <div className="space-y-2">
              {goldEntries.map(([purity, grams]) => (
                <div key={purity} className="flex items-center justify-between p-2.5 rounded-xl bg-secondary">
                  <span className="text-sm font-medium">{purity}</span>
                  <span className="text-sm font-semibold">{grams.toLocaleString()} g</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="card-luxe p-5">
          <div className="flex items-center gap-3 mb-4">
            <div className="h-10 w-10 rounded-xl bg-cyan-500/10 grid place-items-center"><Gem className="h-5 w-5 text-cyan-600" /></div>
            <div>
              <h3 className="font-display text-lg text-brand-dark">Loose Diamonds</h3>
              <p className="text-xs text-muted-foreground">Pooled by shape (running carats)</p>
            </div>
          </div>
          {diamondEntries.length === 0 ? (
            <p className="text-sm text-muted-foreground">No loose diamonds in stock.</p>
          ) : (
            <div className="space-y-2">
              {diamondEntries.map(([quality, carats]) => (
                <div key={quality} className="flex items-center justify-between p-2.5 rounded-xl bg-secondary">
                  <span className="text-sm font-medium">{quality}</span>
                  <span className="text-sm font-semibold">{carats.toLocaleString()} ct</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Certified diamonds — each its own packet */}
      <div className="card-luxe p-5">
        <div className="flex items-center gap-3 mb-4">
          <div className="h-10 w-10 rounded-xl bg-violet-500/10 grid place-items-center"><BadgeCheck className="h-5 w-5 text-violet-600" /></div>
          <div>
            <h3 className="font-display text-lg text-brand-dark">Certified Diamonds</h3>
            <p className="text-xs text-muted-foreground">{inStockPackets.length} packet{inStockPackets.length !== 1 ? "s" : ""} in stock · each with its own certificate</p>
          </div>
        </div>
        {inStockPackets.length === 0 ? (
          <p className="text-sm text-muted-foreground">No certified diamonds in stock.</p>
        ) : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {inStockPackets.map(p => (
              <div key={p.id} className="p-3 rounded-xl bg-secondary border border-border/40">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-semibold">{p.shape}</span>
                  <span className="text-sm font-semibold text-cyan-700">{p.carat} ct</span>
                </div>
                <p className="text-xs text-muted-foreground mt-0.5 truncate">
                  Cert {p.certificateNumber}{p.certificateLab ? ` · ${p.certificateLab}` : ""}{p.quality ? ` · ${p.quality}` : ""}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="card-luxe overflow-hidden">
        <div className="px-5 py-4 border-b border-border/60">
          <h2 className="font-display text-xl text-brand-dark">Movement History</h2>
          <p className="text-xs text-muted-foreground mt-0.5">{movements.length} movement{movements.length !== 1 ? "s" : ""}</p>
        </div>
        <div className="divide-y divide-border/40">
          {paged.map(m => (
            <div key={m.id} className="flex items-center gap-3 px-5 py-3">
              <div className={`h-8 w-8 rounded-lg grid place-items-center shrink-0 ${m.type === "purchase_in" ? "bg-success/10 text-success" : "bg-destructive/10 text-destructive"}`}>
                {m.type === "purchase_in" ? <ArrowDownCircle className="h-4 w-4" /> : <ArrowUpCircle className="h-4 w-4" />}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium">{MOVEMENT_LABEL[m.type] || m.type} — {m.material === "gold" ? "Gold" : "Diamond"} ({m.purityOrQuality})</p>
                <p className="text-xs text-muted-foreground">{fmtDate(m.createdAt)}{m.note ? ` · ${m.note}` : ""}</p>
              </div>
              <p className={`text-sm font-semibold shrink-0 ${m.type === "purchase_in" ? "text-success" : "text-destructive"}`}>
                {m.type === "purchase_in" ? "+" : "−"}{m.quantity} {m.material === "gold" ? "g" : "ct"}
              </p>
            </div>
          ))}
          {movements.length === 0 && <div className="px-5 py-12 text-center text-muted-foreground">No stock movements yet.</div>}
        </div>
        {totalPages > 1 && (
          <div className="px-5 border-t border-border/60">
            <PaginationBar page={page} totalPages={totalPages} onPageChange={setPage} label={`Showing ${start + 1}–${end} of ${movements.length}`} />
          </div>
        )}
      </div>
    </div>
  );
}
