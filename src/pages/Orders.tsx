import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useAuth } from "@/lib/auth";
import { loadDb, fmtMoney, fmtDate, currentUserOrders } from "@/lib/db";
import { useDb } from "@/hooks/useDb";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/StatusBadge";
import { TrackingModal } from "@/components/TrackingModal";
import { Package, Plus, Search, Filter, Truck, ExternalLink, Rows3, LayoutGrid, Users, Factory as FactoryIcon, Coins, Gem } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { usePagination } from "@/hooks/usePagination";
import { PaginationBar } from "@/components/PaginationBar";
import type { Order } from "@/lib/db";

const PAGE_SIZE = 12;

function lastTrackingStep(o: Order): string {
  const inProgress = o.timeline.find(t => t.status === "in_progress");
  if (inProgress) return inProgress.step;
  const done = o.timeline.filter(t => t.status === "done");
  if (done.length) return done[done.length - 1].step;
  return o.timeline[0]?.step ?? "";
}

export function OrdersPage() {
  const { user } = useAuth();
  const db = useDb();
  const [sp] = useSearchParams();
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<string>(sp.get("status") ?? "all");
  const [clientFilter, setClientFilter] = useState<string>("all");
  const isStaff = user!.role !== "client";
  const [trackingOrder, setTrackingOrder] = useState<Order | null>(null);
  // List vs Grid (image) view — remembered per device.
  const [view, setView] = useState<"list" | "grid">(() => {
    try { return (localStorage.getItem("orders-view") as "list" | "grid") || "grid"; } catch { return "grid"; }
  });
  const saveView = (v: "list" | "grid") => {
    setView(v);
    try { localStorage.setItem("orders-view", v); } catch { /* ignore */ }
  };

  const orders = useMemo(() => {
    let list = currentUserOrders(db, user!);
    if (status === "Pending") list = list.filter(o => o.status === "Waiting" || o.status === "Approved");
    else if (status !== "all") list = list.filter(o => o.status === status);
    if (clientFilter !== "all") list = list.filter(o => o.clientId === clientFilter);
    if (q) list = list.filter(o =>
      o.orderNumber.toLowerCase().includes(q.toLowerCase()) ||
      o.jewelleryType.toLowerCase().includes(q.toLowerCase()) ||
      (o.designNumber ?? "").toLowerCase().includes(q.toLowerCase())
    );
    return list.sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));
  }, [db, user, q, status, clientFilter]);

  const { paged, page, setPage, totalPages, total, start, end } = usePagination(orders, PAGE_SIZE);

  return (
    <div className="max-w-7xl mx-auto space-y-4">

      {/* ── Page header ── */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="font-display text-2xl md:text-3xl text-brand-dark">Orders</h1>
          <p className="text-sm text-muted-foreground">{total} order{total !== 1 ? "s" : ""}</p>
        </div>
        {(user!.role === "client" || user!.role === "admin" || user!.role === "employee") && (
          <Button asChild className="btn-hero h-10 rounded-xl px-4 text-sm">
            <Link to="/orders/new"><Plus className="h-4 w-4 mr-1.5" />New Order</Link>
          </Button>
        )}
      </div>

      {/* ── Toolbar — one tidy row on desktop, wraps neatly on phone ── */}
      <div className="card-luxe p-2 flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[160px] sm:flex-none sm:w-72">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input value={q} onChange={e => setQ(e.target.value)} placeholder="Search orders…" className="pl-9 h-10 rounded-lg text-sm" />
        </div>

        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="flex-1 sm:flex-none sm:w-40 h-10 rounded-lg text-sm">
            <Filter className="h-3.5 w-3.5 mr-1.5 shrink-0" /><SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All status</SelectItem>
            <SelectItem value="Pending">Pending (Waiting + Approved)</SelectItem>
            {["Waiting","Approved","In Production","Ready","Dispatched","Delivered","Rejected"].map(s =>
              <SelectItem key={s} value={s}>{s}</SelectItem>)}
          </SelectContent>
        </Select>

        {isStaff && (
          <Select value={clientFilter} onValueChange={setClientFilter}>
            <SelectTrigger className="flex-1 sm:flex-none sm:w-52 h-10 rounded-lg text-sm">
              <Users className="h-3.5 w-3.5 mr-1.5 shrink-0" /><SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All clients</SelectItem>
              {[...db.clients].sort((a, b) => a.companyName.localeCompare(b.companyName)).map(c =>
                <SelectItem key={c.id} value={c.id}>{c.companyName}</SelectItem>)}
            </SelectContent>
          </Select>
        )}

        <div className="shrink-0 ml-auto inline-flex items-center gap-0.5 p-0.5 rounded-lg bg-secondary border border-border/60">
          <button onClick={() => saveView("list")} aria-label="List view"
            className={`flex items-center gap-1 h-8 px-2.5 rounded-md text-xs font-medium transition-colors ${view === "list" ? "bg-white text-brand-dark shadow-soft" : "text-muted-foreground hover:text-foreground"}`}>
            <Rows3 className="h-3.5 w-3.5" /><span className="hidden sm:inline">List</span>
          </button>
          <button onClick={() => saveView("grid")} aria-label="Grid view"
            className={`flex items-center gap-1 h-8 px-2.5 rounded-md text-xs font-medium transition-colors ${view === "grid" ? "bg-white text-brand-dark shadow-soft" : "text-muted-foreground hover:text-foreground"}`}>
            <LayoutGrid className="h-3.5 w-3.5" /><span className="hidden sm:inline">Grid</span>
          </button>
        </div>
      </div>

      {/* ── Empty state ── */}
      {total === 0 && (
        <div className="card-luxe p-12 text-center text-muted-foreground">
          <Package className="h-10 w-10 mx-auto mb-3 opacity-20" />
          <p>No orders match your filters.</p>
        </div>
      )}

      {/* ── Grid (image) view ── */}
      {view === "grid" && total > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {paged.map(o => {
            const client = db.clients.find(c => c.id === o.clientId);
            const done = o.timeline.filter(t => t.status === "done").length;
            const progress = Math.round(done / o.timeline.length * 100);
            const img = o.cadImage || o.images?.[0];
            return (
              <Link key={o.id} to={`/orders/${o.id}`} className="card-luxe card-hover overflow-hidden block">
                <div className={`relative aspect-square overflow-hidden ${img ? "bg-secondary animate-pulse" : "bg-secondary/50"}`}>
                  {img ? (
                    <img
                      src={img}
                      alt={o.orderNumber}
                      loading="lazy"
                      decoding="async"
                      onLoad={e => e.currentTarget.parentElement?.classList.remove("animate-pulse")}
                      onError={e => { e.currentTarget.parentElement?.classList.remove("animate-pulse"); e.currentTarget.style.display = "none"; }}
                      className="relative z-10 w-full h-full object-cover"
                    />
                  ) : (
                    <div className="w-full h-full grid place-items-center"><Package className="h-8 w-8 text-primary/30" /></div>
                  )}
                  <div className="absolute top-2 left-2 z-20"><StatusBadge status={o.status} /></div>
                </div>
                <div className="p-3">
                  <p className="font-semibold text-sm leading-tight truncate">{o.orderNumber}</p>
                  <p className="text-[11px] text-muted-foreground truncate mt-0.5">
                    {o.jewelleryType} · {o.metal}{o.productKarats ? ` ${o.productKarats}` : ""}{o.designNumber ? ` · #${o.designNumber}` : ""}
                  </p>
                  {user!.role !== "client" && (o.forReadyStock
                    ? <p className="text-[11px] font-medium text-primary truncate">🏭 Ready Stock</p>
                    : client && <p className="text-[11px] font-medium text-muted-foreground truncate">{client.companyName}</p>)}
                  <div className="mt-2 h-1.5 rounded-full bg-secondary overflow-hidden">
                    <div className="h-full bg-gradient-to-r from-primary to-brand-light" style={{ width: `${progress}%` }} />
                  </div>
                  <div className="flex items-center justify-between mt-1.5">
                    <span className="text-[11px] text-muted-foreground">{progress}%</span>
                    <span className="font-semibold text-sm">{fmtMoney(o.amount)}</span>
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      )}

      {/* ── List view (order cards) ── */}
      {view === "list" && total > 0 && (
      <div className="grid gap-3">
        {paged.map(o => {
          const client = db.clients.find(c => c.id === o.clientId);
          const done   = o.timeline.filter(t => t.status === "done").length;
          const progress = Math.round(done / o.timeline.length * 100);
          const isActive = !["Delivered","Rejected"].includes(o.status);
          const rowImg = o.cadImage || o.images?.[0];
          // Manufacturing summary (staff only) — which factory, how much gold/diamond issued.
          const orderIssuances = user!.role !== "client" ? db.materialIssuances.filter(i => i.orderId === o.id) : [];
          const factoryNames = [...new Set(orderIssuances.map(i => db.factories.find(f => f.id === i.factoryId)?.name).filter(Boolean))] as string[];
          const goldIssued = orderIssuances.filter(i => i.material === "gold").reduce((s, i) => s + i.quantityIssued, 0);
          const diaIssued = orderIssuances.filter(i => i.material === "diamond").reduce((s, i) => s + i.quantityIssued, 0);
          // Weights — prefer actual (post-production), then estimate, then the
          // finished-piece net weight recorded on the factory issuance.
          const finishIss = orderIssuances.find(i => i.material === "gold" && i.finishedNetWeight != null);
          const grossWt = o.actualGrossWeight ?? o.estimatedGrossWeight;
          const netWt = o.actualNetWeight ?? o.estimatedNetWeight ?? finishIss?.finishedNetWeight;
          const diaWt = o.actualDiamondWeight ?? o.diamondWeight;

          return (
            <Link
              key={o.id}
              to={`/orders/${o.id}`}
              className="card-luxe card-hover overflow-hidden flex items-stretch min-h-[128px]"
            >
              {/* ── Left: full-height product / CAD photo ── */}
              <div className="relative w-28 sm:w-36 shrink-0 bg-secondary self-stretch">
                {rowImg
                  ? <img src={rowImg} alt={o.orderNumber} loading="lazy" className="absolute inset-0 w-full h-full object-cover" />
                  : <div className="absolute inset-0 grid place-items-center text-muted-foreground/40"><Package className="h-9 w-9" /></div>}
              </div>

              {/* ── Right: order details ── */}
              <div className="flex-1 min-w-0 p-4 flex flex-col gap-2">
                {/* Header — order# + spec + status */}
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-semibold text-sm leading-tight truncate">{o.orderNumber}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {o.jewelleryType} · {o.metal}{o.productKarats ? ` ${o.productKarats}` : ""} · {o.diamondType} · {o.quantity} pc{o.quantity !== 1 ? "s" : ""}
                      {o.designNumber ? ` · #${o.designNumber}` : ""}
                    </p>
                  </div>
                  <StatusBadge status={o.status} />
                </div>

                {/* Weights — gross / net / diamond */}
                {(grossWt || netWt || diaWt) && (
                  <div className="flex flex-wrap items-center gap-1.5">
                    {grossWt ? <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-secondary text-foreground/70">Gross {grossWt}g</span> : null}
                    {netWt ? <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-secondary text-foreground/70">Net {netWt}g</span> : null}
                    {diaWt ? <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-secondary text-foreground/70">Dia {diaWt}ct</span> : null}
                  </div>
                )}

                {user!.role !== "client" && (o.forReadyStock
                  ? <p className="text-xs font-medium text-primary truncate">🏭 Ready Stock (in-house)</p>
                  : client && <p className="text-xs font-medium text-muted-foreground truncate">{client.companyName}</p>)}

                {/* Manufacturing chips — factory · gold used · diamond used (staff only) */}
                {(factoryNames.length > 0 || goldIssued > 0 || diaIssued > 0) && (
                  <div className="flex flex-wrap items-center gap-1.5">
                    {factoryNames.map(n => (
                      <span key={n} className="inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full bg-orange-500/10 text-orange-700">
                        <FactoryIcon className="h-2.5 w-2.5" />{n}
                      </span>
                    ))}
                    {goldIssued > 0 && (
                      <span className="inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-700">
                        <Coins className="h-2.5 w-2.5" />{goldIssued.toLocaleString()} g gold
                      </span>
                    )}
                    {diaIssued > 0 && (
                      <span className="inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full bg-sky-500/10 text-sky-700">
                        <Gem className="h-2.5 w-2.5" />{diaIssued.toLocaleString()} ct dia
                      </span>
                    )}
                  </div>
                )}

                {/* Progress + due + amount — pinned to the bottom */}
                <div className="mt-auto pt-1">
                  <div className="h-1.5 rounded-full bg-secondary overflow-hidden">
                    <div className="h-full bg-gradient-to-r from-primary to-brand-light transition-all duration-500" style={{ width: `${progress}%` }} />
                  </div>
                  <div className="mt-1.5 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-xs text-muted-foreground">{progress}% · Due {fmtDate(o.expectedDelivery)}</p>
                      {isActive && !o.courierName && (
                        <p className="text-[11px] font-medium text-primary flex items-center gap-1 mt-0.5">
                          <Truck className="h-3 w-3 shrink-0" /><span className="truncate">{lastTrackingStep(o)}</span>
                        </p>
                      )}
                    </div>
                    <span className="font-semibold text-sm shrink-0">{fmtMoney(o.amount)}</span>
                  </div>
                </div>

                {/* Courier + tracking */}
                {o.courierName && (
                  <div className="flex items-center justify-between gap-3 rounded-xl bg-secondary/60 border border-border/60 px-3 py-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <Truck className="h-3.5 w-3.5 text-primary shrink-0" />
                      <span className="text-xs font-semibold text-foreground capitalize">{o.courierName}</span>
                      {o.trackingNumber && <span className="text-xs font-mono text-muted-foreground truncate">{o.trackingNumber}</span>}
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      {o.trackingLink ? (
                        <a href={o.trackingLink} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()}
                          className="inline-flex items-center gap-1 text-xs font-semibold text-primary bg-primary/10 hover:bg-primary/20 rounded-lg px-2.5 py-1 transition-colors">
                          <ExternalLink className="h-3 w-3" /> Track
                        </a>
                      ) : (
                        <button onClick={e => { e.preventDefault(); e.stopPropagation(); setTrackingOrder(o); }}
                          className="inline-flex items-center gap-1 text-xs font-semibold text-primary bg-primary/10 hover:bg-primary/20 rounded-lg px-2.5 py-1 transition-colors">
                          <Truck className="h-3 w-3" /> Track
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </Link>
          );
        })}
      </div>
      )}

      <PaginationBar
        page={page}
        totalPages={totalPages}
        onPageChange={setPage}
        label={total > 0 ? `Showing ${start + 1}–${end} of ${total} orders` : undefined}
      />

      <TrackingModal order={trackingOrder} onClose={() => setTrackingOrder(null)} />
    </div>
  );
}
