import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { fmtDate, updateDb, DIAMOND_SHAPES, type DiamondPacket } from "@/lib/db";
import { useDb } from "@/hooks/useDb";
import { useAuth } from "@/lib/auth";
import { subscribeStockLevels, recomputeStockFromHistory, type StockLevels } from "@/lib/stock";
import { stockBucketHistory } from "@/lib/manufacturing";
import { AsyncButton } from "@/components/AsyncButton";
import { usePagination } from "@/hooks/usePagination";
import { PaginationBar } from "@/components/PaginationBar";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Gem, Coins, ArrowDownCircle, ArrowUpCircle, RotateCcw, BadgeCheck, Pencil, Trash2, ChevronRight } from "lucide-react";
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
  const [editPacket, setEditPacket] = useState<DiamondPacket | null>(null);
  const [bucketDetail, setBucketDetail] = useState<{ material: "gold" | "diamond"; key: string } | null>(null);

  useEffect(() => subscribeStockLevels(setLevels), []);

  const savePacketEdit = () => {
    if (!editPacket) return;
    const p = editPacket;
    if (!p.shape) { toast.error("Choose a shape"); return; }
    if (!p.carat || p.carat <= 0) { toast.error("Enter a valid carat weight"); return; }
    if (!p.certificateNumber.trim()) { toast.error("Report number is required"); return; }
    updateDb(d => {
      const idx = (d.diamondPackets ?? []).findIndex(x => x.id === p.id);
      if (idx >= 0) {
        const clean = <T,>(v: T) => (typeof v === "string" && v.trim() === "" ? undefined : v);
        d.diamondPackets[idx] = {
          ...d.diamondPackets[idx],
          shape: p.shape,
          carat: p.carat,
          color: clean(p.color?.trim()),
          clarity: clean(p.clarity?.trim()),
          cut: clean(p.cut?.trim()),
          polish: clean(p.polish?.trim()),
          symmetry: clean(p.symmetry?.trim()),
          fluorescence: clean(p.fluorescence?.trim()),
          measurement: clean(p.measurement?.trim()),
          certificateNumber: p.certificateNumber.trim(),
          certificateLab: clean(p.certificateLab?.trim()),
        };
      }
    });
    toast.success("Certificate details updated");
    setEditPacket(null);
  };

  const deletePacket = (p: DiamondPacket) => {
    if (p.status !== "in_stock") {
      toast.error("This packet is already issued or used — cancel it from the order instead.");
      return;
    }
    if (!confirm(`Delete this ${p.shape} ${p.carat}ct packet (Report ${p.certificateNumber})? This can't be undone.`)) return;
    updateDb(d => {
      d.diamondPackets = (d.diamondPackets ?? []).filter(x => x.id !== p.id);
    });
    toast.success("Packet deleted");
  };

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
                <button
                  key={purity}
                  type="button"
                  onClick={() => setBucketDetail({ material: "gold", key: purity })}
                  className="flex items-center justify-between p-2.5 rounded-xl bg-secondary hover:bg-secondary/70 transition-colors text-left w-full"
                >
                  <span className="text-sm font-medium">{purity}</span>
                  <span className="flex items-center gap-1.5">
                    <span className="text-sm font-semibold">{grams.toLocaleString()} g</span>
                    <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                  </span>
                </button>
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
                <button
                  key={quality}
                  type="button"
                  onClick={() => setBucketDetail({ material: "diamond", key: quality })}
                  className="flex items-center justify-between p-2.5 rounded-xl bg-secondary hover:bg-secondary/70 transition-colors text-left w-full"
                >
                  <span className="text-sm font-medium">{quality}</span>
                  <span className="flex items-center gap-1.5">
                    <span className="text-sm font-semibold">{carats.toLocaleString()} ct</span>
                    <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                  </span>
                </button>
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
            {inStockPackets.map(p => {
              const grade = [p.color, p.clarity, [p.cut, p.polish, p.symmetry].filter(Boolean).join("/"), p.fluorescence]
                .filter(Boolean).join(" · ");
              return (
                <div key={p.id} className="p-3 rounded-xl bg-secondary border border-border/40">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-semibold">{p.shape}</span>
                    <span className="text-sm font-semibold text-cyan-700">{p.carat} ct</span>
                  </div>
                  {grade && <p className="text-xs text-foreground/70 mt-0.5 truncate">{grade}</p>}
                  {p.measurement && <p className="text-[11px] text-muted-foreground mt-0.5 truncate">{p.measurement}</p>}
                  <p className="text-[11px] text-muted-foreground mt-0.5 truncate">Report {p.certificateNumber}{p.certificateLab ? ` · ${p.certificateLab}` : ""}</p>
                  {user?.role === "admin" && (
                    <div className="flex items-center gap-2 mt-2 pt-2 border-t border-border/40">
                      <button onClick={() => setEditPacket({ ...p })} className="text-[11px] text-primary inline-flex items-center gap-1 hover:underline">
                        <Pencil className="h-3 w-3" /> Edit
                      </button>
                      <button onClick={() => deletePacket(p)} className="text-[11px] text-destructive inline-flex items-center gap-1 hover:underline">
                        <Trash2 className="h-3 w-3" /> Delete
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
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

      {/* Edit certified packet (admin) — fix a mistyped certificate/grade */}
      {editPacket && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" onClick={() => setEditPacket(null)}>
          <div className="card-luxe w-full max-w-lg p-5 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <h3 className="font-display text-lg text-brand-dark mb-1">Edit Certified Diamond</h3>
            <p className="text-xs text-muted-foreground mb-4">Correct the certificate or grading details for this packet.</p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Shape</Label>
                <Select value={editPacket.shape} onValueChange={v => setEditPacket({ ...editPacket, shape: v })}>
                  <SelectTrigger className="rounded-xl mt-1"><SelectValue placeholder="Shape" /></SelectTrigger>
                  <SelectContent>{DIAMOND_SHAPES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Carat</Label>
                <Input type="number" step="0.01" min={0} value={editPacket.carat} onChange={e => setEditPacket({ ...editPacket, carat: Number(e.target.value) })} className="rounded-xl mt-1" />
              </div>
              <div>
                <Label className="text-xs">Color</Label>
                <Input value={editPacket.color ?? ""} onChange={e => setEditPacket({ ...editPacket, color: e.target.value })} className="rounded-xl mt-1" />
              </div>
              <div>
                <Label className="text-xs">Clarity</Label>
                <Input value={editPacket.clarity ?? ""} onChange={e => setEditPacket({ ...editPacket, clarity: e.target.value })} className="rounded-xl mt-1" />
              </div>
              <div>
                <Label className="text-xs">Cut</Label>
                <Input value={editPacket.cut ?? ""} onChange={e => setEditPacket({ ...editPacket, cut: e.target.value })} className="rounded-xl mt-1" />
              </div>
              <div>
                <Label className="text-xs">Polish</Label>
                <Input value={editPacket.polish ?? ""} onChange={e => setEditPacket({ ...editPacket, polish: e.target.value })} className="rounded-xl mt-1" />
              </div>
              <div>
                <Label className="text-xs">Symmetry</Label>
                <Input value={editPacket.symmetry ?? ""} onChange={e => setEditPacket({ ...editPacket, symmetry: e.target.value })} className="rounded-xl mt-1" />
              </div>
              <div>
                <Label className="text-xs">Fluorescence</Label>
                <Input value={editPacket.fluorescence ?? ""} onChange={e => setEditPacket({ ...editPacket, fluorescence: e.target.value })} className="rounded-xl mt-1" />
              </div>
              <div className="col-span-2">
                <Label className="text-xs">Measurement</Label>
                <Input value={editPacket.measurement ?? ""} onChange={e => setEditPacket({ ...editPacket, measurement: e.target.value })} className="rounded-xl mt-1" placeholder="6.5 x 6.5 x 4.0 mm" />
              </div>
              <div>
                <Label className="text-xs">Report Number</Label>
                <Input value={editPacket.certificateNumber} onChange={e => setEditPacket({ ...editPacket, certificateNumber: e.target.value })} className="rounded-xl mt-1" />
              </div>
              <div>
                <Label className="text-xs">Lab</Label>
                <Input value={editPacket.certificateLab ?? ""} onChange={e => setEditPacket({ ...editPacket, certificateLab: e.target.value })} className="rounded-xl mt-1" placeholder="GIA / IGI" />
              </div>
            </div>
            <div className="flex gap-2 mt-5">
              <button onClick={() => setEditPacket(null)} className="flex-1 rounded-xl border border-border py-2 text-sm">Cancel</button>
              <button onClick={savePacketEdit} className="btn-hero flex-1 rounded-xl py-2 text-sm">Save Changes</button>
            </div>
          </div>
        </div>
      )}

      {/* Bucket drill-down — resolved usage/sale history for one gold purity or diamond quality bucket */}
      {bucketDetail && (() => {
        const bucketRows = stockBucketHistory(db.stockMovements, bucketDetail.material, bucketDetail.key, {
          purchases: db.purchases, issuances: db.materialIssuances, orders: db.orders, factories: db.factories, suppliers: db.suppliers,
        });
        return (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" onClick={() => setBucketDetail(null)}>
          <div className="card-luxe w-full max-w-lg p-5 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between gap-3 mb-1">
              <h3 className="font-display text-lg text-brand-dark">
                {bucketDetail.material === "gold" ? "Gold" : "Diamond"} — {bucketDetail.key}
              </h3>
              <span className="text-sm font-semibold shrink-0">
                {(levels?.[bucketDetail.material]?.[bucketDetail.key] ?? 0).toLocaleString()} {bucketDetail.material === "gold" ? "g" : "ct"}
              </span>
            </div>
            <p className="text-xs text-muted-foreground mb-4">Full movement history for this bucket</p>
            <div className="divide-y divide-border/40 max-h-[50vh] overflow-y-auto -mx-1">
              {bucketRows.map(m => (
                <div key={m.id} className="flex items-center gap-3 px-1 py-3">
                  <div className={`h-8 w-8 rounded-lg grid place-items-center shrink-0 ${m.type === "purchase_in" ? "bg-success/10 text-success" : "bg-destructive/10 text-destructive"}`}>
                    {m.type === "purchase_in" ? <ArrowDownCircle className="h-4 w-4" /> : <ArrowUpCircle className="h-4 w-4" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">
                      {m.link.orderId ? (
                        <Link to={`/orders/${m.link.orderId}`} className="hover:underline">{m.link.label}</Link>
                      ) : m.link.factoryId ? (
                        <Link to={`/factories/${m.link.factoryId}`} className="hover:underline">{m.link.label}</Link>
                      ) : m.link.supplierId ? (
                        <Link to={`/suppliers/${m.link.supplierId}`} className="hover:underline">{m.link.label}</Link>
                      ) : (
                        m.link.label
                      )}
                    </p>
                    <p className="text-xs text-muted-foreground">{fmtDate(m.createdAt)}{m.note ? ` · ${m.note}` : ""}</p>
                  </div>
                  <p className={`text-sm font-semibold shrink-0 ${m.type === "purchase_in" ? "text-success" : "text-destructive"}`}>
                    {m.type === "purchase_in" ? "+" : "−"}{m.quantity} {bucketDetail.material === "gold" ? "g" : "ct"}
                  </p>
                </div>
              ))}
              {bucketRows.length === 0 && <div className="py-8 text-center text-sm text-muted-foreground">No movements recorded for this bucket.</div>}
            </div>
            <button onClick={() => setBucketDetail(null)} className="w-full rounded-xl border border-border py-2 text-sm mt-4">Close</button>
          </div>
        </div>
        );
      })()}
    </div>
  );
}
