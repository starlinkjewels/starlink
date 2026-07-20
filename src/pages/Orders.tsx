import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "@/lib/auth";
import { loadDb, fmtMoney, fmtDate, currentUserOrders } from "@/lib/db";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/StatusBadge";
import { TrackingModal } from "@/components/TrackingModal";
import { Package, Plus, Search, Filter, Truck, ExternalLink } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { usePagination } from "@/hooks/usePagination";
import { PaginationBar } from "@/components/PaginationBar";
import type { Order } from "@/lib/db";

const PAGE_SIZE = 10;

function lastTrackingStep(o: Order): string {
  const inProgress = o.timeline.find(t => t.status === "in_progress");
  if (inProgress) return inProgress.step;
  const done = o.timeline.filter(t => t.status === "done");
  if (done.length) return done[done.length - 1].step;
  return o.timeline[0]?.step ?? "";
}

export function OrdersPage() {
  const { user } = useAuth();
  const db = loadDb();
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<string>("all");
  const [trackingOrder, setTrackingOrder] = useState<Order | null>(null);

  const orders = useMemo(() => {
    let list = currentUserOrders(db, user!);
    if (status !== "all") list = list.filter(o => o.status === status);
    if (q) list = list.filter(o =>
      o.orderNumber.toLowerCase().includes(q.toLowerCase()) ||
      o.jewelleryType.toLowerCase().includes(q.toLowerCase())
    );
    return list.sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));
  }, [db, user, q, status]);

  const { paged, page, setPage, totalPages, total, start, end } = usePagination(orders, PAGE_SIZE);

  return (
    <div className="max-w-7xl mx-auto space-y-4">

      {/* ── Page header ── */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="font-display text-2xl md:text-3xl text-brand-dark">Orders</h1>
          <p className="text-sm text-muted-foreground">{total} order{total !== 1 ? "s" : ""}</p>
        </div>
        {(user!.role === "client" || user!.role === "admin") && (
          <Button asChild className="btn-hero h-10 rounded-xl px-4 text-sm">
            <Link to="/orders/new"><Plus className="h-4 w-4 mr-1.5" />New Order</Link>
          </Button>
        )}
      </div>

      {/* ── Search + filter ── */}
      <div className="card-luxe p-3 flex flex-col sm:flex-row gap-2.5">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input value={q} onChange={e => setQ(e.target.value)} placeholder="Search orders…" className="pl-9 h-10 rounded-xl" />
        </div>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="w-full sm:w-44 h-10 rounded-xl">
            <Filter className="h-3.5 w-3.5 mr-2 shrink-0" /><SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All status</SelectItem>
            {["Waiting","Approved","In Production","Ready","Dispatched","Delivered","Rejected"].map(s =>
              <SelectItem key={s} value={s}>{s}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {/* ── Order cards ── */}
      <div className="grid gap-3">
        {paged.map(o => {
          const client = db.clients.find(c => c.id === o.clientId);
          const done   = o.timeline.filter(t => t.status === "done").length;
          const progress = Math.round(done / o.timeline.length * 100);
          const isActive = !["Delivered","Rejected"].includes(o.status);
          const hasShipping = o.status === "Dispatched" || o.status === "Delivered";

          return (
            <Link
              key={o.id}
              to={`/orders/${o.id}`}
              className="card-luxe p-4 hover:shadow-luxe hover:-translate-y-0.5 transition-all block"
            >
              {/* ── Row 1: icon · order# · status ── */}
              <div className="flex items-start gap-3">
                <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-primary/15 to-brand-light/15 grid place-items-center shrink-0 mt-0.5">
                  <Package className="h-5 w-5 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2">
                    <p className="font-semibold text-sm leading-tight">{o.orderNumber}</p>
                    <StatusBadge status={o.status} />
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5 truncate">
                    {o.jewelleryType} · {o.metal} · {o.diamondType} · {o.quantity} pc{o.quantity !== 1 ? "s" : ""}
                    {o.designNumber ? ` · #${o.designNumber}` : ""}
                  </p>
                  {user!.role !== "client" && client && (
                    <p className="text-xs font-medium text-muted-foreground truncate mt-0.5">{client.companyName}</p>
                  )}
                </div>
              </div>

              {/* ── Progress bar ── */}
              <div className="mt-3 ml-[52px]">
                <div className="h-1.5 rounded-full bg-secondary overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-primary to-brand-light transition-all duration-500"
                    style={{ width: `${progress}%` }}
                  />
                </div>
              </div>

              {/* ── Row 2: progress % · due date · current step ── */}
              <div className="mt-2 ml-[52px] flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-xs text-muted-foreground">
                    {progress}% · Due {fmtDate(o.expectedDelivery)}
                  </p>
                  {isActive && !o.courierName && (
                    <p className="text-[11px] font-medium text-primary flex items-center gap-1 mt-0.5">
                      <Truck className="h-3 w-3 shrink-0" />
                      <span className="truncate">{lastTrackingStep(o)}</span>
                    </p>
                  )}
                </div>
                <span className="font-semibold text-sm shrink-0">{fmtMoney(o.amount)}</span>
              </div>

              {/* ── Row 3: courier + tracking — shown whenever dispatch info exists ── */}
              {o.courierName && (
                <div className="mt-2 ml-[52px]">
                  <div className="flex items-center justify-between gap-3 rounded-xl bg-secondary/60 border border-border/60 px-3 py-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <Truck className="h-3.5 w-3.5 text-primary shrink-0" />
                      <span className="text-xs font-semibold text-foreground capitalize">{o.courierName}</span>
                      {o.trackingNumber && (
                        <span className="text-xs font-mono text-muted-foreground truncate">{o.trackingNumber}</span>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      {o.trackingLink ? (
                        <a
                          href={o.trackingLink}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={e => e.stopPropagation()}
                          className="inline-flex items-center gap-1 text-xs font-semibold text-primary bg-primary/10 hover:bg-primary/20 rounded-lg px-2.5 py-1 transition-colors"
                        >
                          <ExternalLink className="h-3 w-3" /> Track
                        </a>
                      ) : (
                        <button
                          onClick={e => { e.preventDefault(); e.stopPropagation(); setTrackingOrder(o); }}
                          className="inline-flex items-center gap-1 text-xs font-semibold text-primary bg-primary/10 hover:bg-primary/20 rounded-lg px-2.5 py-1 transition-colors"
                        >
                          <Truck className="h-3 w-3" /> Track
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </Link>
          );
        })}

        {total === 0 && (
          <div className="card-luxe p-12 text-center text-muted-foreground">
            <Package className="h-10 w-10 mx-auto mb-3 opacity-20" />
            <p>No orders match your filters.</p>
          </div>
        )}
      </div>

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
