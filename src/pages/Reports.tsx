import { useState, useMemo } from "react";
import { loadDb, fmtMoney, fmtDate, currentUserOrders } from "@/lib/db";
import type { Order } from "@/lib/db";
import { useAuth } from "@/lib/auth";
import {
  BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Tooltip,
} from "recharts";
import {
  Download, Package, Truck, CheckCircle2, DollarSign,
  Clock, TrendingUp, Users, X, BarChart3, Filter,
} from "lucide-react";
import jsPDF from "jspdf";

/* ── helpers ── */
function dispatchDays(o: Order): number | null {
  const step = o.timeline.find(t => t.step === "Dispatch" && t.status === "done");
  if (!step?.date) return null;
  return Math.max(0, Math.round(
    (new Date(step.date).getTime() - new Date(o.createdAt).getTime()) / 86_400_000
  ));
}

function SummaryCard({
  icon: Icon, label, value, sub, color = "primary",
}: {
  icon: any; label: string; value: string | number; sub?: string; color?: string;
}) {
  const colorMap: Record<string, string> = {
    primary: "bg-primary/10 text-primary",
    success: "bg-success/10 text-success",
    amber:   "bg-amber-500/10 text-amber-600",
    blue:    "bg-blue-500/10 text-blue-600",
    rose:    "bg-rose-500/10 text-rose-600",
  };
  return (
    <div className="card-luxe p-3.5 sm:p-5 flex items-center gap-3 sm:gap-4">
      <div className={`h-9 w-9 sm:h-12 sm:w-12 rounded-xl sm:rounded-2xl grid place-items-center shrink-0 ${colorMap[color] ?? colorMap.primary}`}>
        <Icon className="h-4.5 w-4.5 sm:h-6 sm:w-6 h-[18px] w-[18px] sm:h-6 sm:w-6" />
      </div>
      <div className="min-w-0">
        <p className="text-[10px] sm:text-xs text-muted-foreground">{label}</p>
        <p className="font-display text-lg sm:text-2xl text-brand-dark leading-tight">{value}</p>
        {sub && <p className="text-[10px] sm:text-xs text-muted-foreground mt-0.5 hidden sm:block">{sub}</p>}
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────── */
export function ReportsPage() {
  const { user } = useAuth();
  const isClient   = user?.role === "client";
  const isAdmin    = user?.role === "admin";
  const isEmployee = user?.role === "employee";
  const canSeeAll  = isAdmin || isEmployee;

  const db        = loadDb();
  const myOrders  = currentUserOrders(db, user!);
  const clients   = db.clients;

  /* ── filters (admin / employee) ── */
  const [clientFilter, setClientFilter] = useState("all");
  const [dateFrom,     setDateFrom]     = useState("");
  const [dateTo,       setDateTo]       = useState("");

  const clearFilters = () => {
    setClientFilter("all"); setDateFrom(""); setDateTo("");
  };
  const hasFilters = clientFilter !== "all" || !!dateFrom || !!dateTo;

  /* ── filtered data ── */
  const filtered = useMemo(() => {
    let list = [...myOrders];
    if (canSeeAll && clientFilter !== "all") {
      list = list.filter(o => o.clientId === clientFilter);
    }
    if (dateFrom) list = list.filter(o => o.createdAt >= dateFrom);
    if (dateTo)   list = list.filter(o => o.createdAt <= dateTo + "T23:59:59.999Z");
    return list;
  }, [myOrders, clientFilter, dateFrom, dateTo]);

  /* ── summary metrics ── */
  const total      = filtered.length;
  const delivered  = filtered.filter(o => o.status === "Delivered");
  const dispatched = filtered.filter(o => ["Dispatched","Delivered"].includes(o.status));
  const inProd     = filtered.filter(o => o.status === "In Production");
  const revenue    = delivered.reduce((s, o) => s + (o.amount || 0), 0);

  /* ── dispatch speed ── */
  const speedRows = filtered
    .map(o => { const d = dispatchDays(o); return d !== null ? { o, days: d } : null; })
    .filter(Boolean) as { o: Order; days: number }[];

  const avgDays = speedRows.length > 0
    ? (speedRows.reduce((s, r) => s + r.days, 0) / speedRows.length).toFixed(1)
    : null;

  const fast   = speedRows.filter(r => r.days <= 7).length;
  const normal = speedRows.filter(r => r.days > 7 && r.days <= 20).length;
  const slow   = speedRows.filter(r => r.days > 20).length;

  /* ── department chart ── */
  const DEPTS = ["Sales","CAD","Design","Production","Diamond Setting",
                 "Polishing","QC","Packing","Dispatch","Accounts"];
  const byDept = DEPTS.map(d => ({
    name: d.length > 8 ? d.slice(0, 8) + "…" : d,
    fullName: d,
    count: filtered.filter(o => o.timeline.some(t => t.department === d && t.status === "done")).length,
  }));

  /* ── client-wise breakdown (admin / employee, no client filter) ── */
  const byClient = useMemo(() => {
    if (!canSeeAll) return [];
    const map = new Map<string, {
      id: string; name: string; total: number;
      dispatched: number; delivered: number; revenue: number; avgDays: number | null;
    }>();
    filtered.forEach(o => {
      const c = clients.find(cl => cl.id === o.clientId);
      const name = c?.companyName || "Unknown";
      const prev = map.get(o.clientId) ?? { id: o.clientId, name, total: 0, dispatched: 0, delivered: 0, revenue: 0, avgDays: null };
      prev.total++;
      if (["Dispatched","Delivered"].includes(o.status)) prev.dispatched++;
      if (o.status === "Delivered") { prev.delivered++; prev.revenue += o.amount || 0; }
      map.set(o.clientId, prev);
    });
    // compute avgDays per client
    map.forEach((row) => {
      const rows = filtered
        .filter(o => o.clientId === row.id)
        .map(o => dispatchDays(o))
        .filter(d => d !== null) as number[];
      row.avgDays = rows.length > 0 ? Math.round(rows.reduce((a, b) => a + b, 0) / rows.length) : null;
    });
    return Array.from(map.values()).sort((a, b) => b.total - a.total);
  }, [filtered, clients]);

  /* ── status breakdown for client ── */
  const STATUS_LIST = ["Waiting","Approved","In Production","Ready","Dispatched","Delivered"] as const;
  const statusColors: Record<string, string> = {
    "Waiting": "bg-slate-100 text-slate-600",
    "Approved": "bg-blue-100 text-blue-700",
    "In Production": "bg-amber-100 text-amber-700",
    "Ready": "bg-purple-100 text-purple-700",
    "Dispatched": "bg-primary/10 text-primary",
    "Delivered": "bg-success/10 text-success",
  };

  /* ── PDF export ── */
  function exportPdf() {
    const doc = new jsPDF();
    doc.setFont("helvetica","bold"); doc.setFontSize(18);
    doc.text("Starlink Jewels — Business Report", 20, 22);
    doc.setFont("helvetica","normal"); doc.setFontSize(9);
    doc.text(`Generated: ${new Date().toLocaleString()}`, 20, 30);
    if (hasFilters) {
      const filterDesc = [
        clientFilter !== "all" && `Client: ${clients.find(c=>c.id===clientFilter)?.companyName}`,
        dateFrom && `From: ${dateFrom}`,
        dateTo   && `To: ${dateTo}`,
      ].filter(Boolean).join(" | ");
      doc.text(`Filters: ${filterDesc}`, 20, 36);
    }
    doc.setFont("helvetica","bold"); doc.setFontSize(12);
    doc.text("Summary", 20, 48);
    doc.setFont("helvetica","normal"); doc.setFontSize(10);
    let y = 56;
    const rows: [string,string][] = [
      ["Total Orders",    String(total)],
      ["Dispatched",      String(dispatched.length)],
      ["Delivered",       String(delivered.length)],
      ["In Production",   String(inProd.length)],
      ...(canSeeAll ? [["Total Revenue", fmtMoney(revenue)]] as [string,string][] : []),
      ...(avgDays ? [["Avg Dispatch Time", `${avgDays} days`]] as [string,string][] : []),
    ];
    rows.forEach(([k,v]) => { doc.text(`${k}:`, 25, y); doc.text(v, 110, y); y += 7; });
    if (byClient.length > 0) {
      y += 4; doc.setFont("helvetica","bold"); doc.setFontSize(12);
      doc.text("Client Breakdown", 20, y); y += 8;
      doc.setFont("helvetica","normal"); doc.setFontSize(9);
      byClient.forEach(cl => {
        doc.text(`${cl.name}`, 25, y);
        doc.text(`${cl.total} orders · ${cl.dispatched} dispatched · ${fmtMoney(cl.revenue)}`, 75, y);
        y += 6;
        if (y > 270) { doc.addPage(); y = 20; }
      });
    }
    doc.save("Starlink-Report.pdf");
  }

  /* ── render ── */
  return (
    <div className="max-w-6xl mx-auto space-y-4">

      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl sm:text-3xl text-brand-dark leading-tight">
            {isClient ? "My Reports" : "Reports"}
          </h1>
          <p className="text-xs sm:text-sm text-muted-foreground mt-0.5">
            {isClient
              ? "Overview of your orders and delivery performance"
              : `${total} order${total !== 1 ? "s" : ""}${hasFilters ? " (filtered)" : " · all time"}`}
          </p>
        </div>
        <button onClick={exportPdf}
          className="flex items-center gap-1.5 sm:gap-2 px-3 sm:px-4 h-9 sm:h-10 rounded-xl btn-hero text-xs sm:text-sm font-medium shrink-0">
          <Download className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
          <span className="hidden sm:inline">Download PDF</span>
          <span className="sm:hidden">PDF</span>
        </button>
      </div>

      {/* ── Filters (admin / employee) ── */}
      {canSeeAll && (
        <div className="card-luxe p-3 sm:p-4">
          <div className="flex items-center gap-2 mb-3">
            <Filter className="h-4 w-4 text-muted-foreground" />
            <p className="text-xs sm:text-sm font-semibold text-brand-dark tracking-wide uppercase">Filters</p>
            {hasFilters && (
              <button onClick={clearFilters}
                className="ml-auto flex items-center gap-1 text-xs text-muted-foreground hover:text-destructive transition-colors">
                <X className="h-3 w-3" /> Clear
              </button>
            )}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {/* Client */}
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground font-medium">Client</label>
              <select
                value={clientFilter}
                onChange={e => setClientFilter(e.target.value)}
                className="w-full h-10 rounded-xl border border-border bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
              >
                <option value="all">All Clients</option>
                {clients.map(c => (
                  <option key={c.id} value={c.id}>{c.companyName}</option>
                ))}
              </select>
            </div>
            {/* Date From */}
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground font-medium">From Date</label>
              <input
                type="date"
                value={dateFrom}
                onChange={e => setDateFrom(e.target.value)}
                className="w-full h-10 rounded-xl border border-border bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
            </div>
            {/* Date To */}
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground font-medium">To Date</label>
              <input
                type="date"
                value={dateTo}
                onChange={e => setDateTo(e.target.value)}
                className="w-full h-10 rounded-xl border border-border bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
            </div>
          </div>
          {/* Active filter chips */}
          {hasFilters && (
            <div className="flex flex-wrap gap-2 mt-3">
              {clientFilter !== "all" && (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-primary/10 text-primary text-xs font-medium">
                  <Users className="h-3 w-3" />
                  {clients.find(c => c.id === clientFilter)?.companyName}
                  <button onClick={() => setClientFilter("all")} className="ml-0.5 hover:text-destructive"><X className="h-2.5 w-2.5" /></button>
                </span>
              )}
              {dateFrom && (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-primary/10 text-primary text-xs font-medium">
                  From {dateFrom}
                  <button onClick={() => setDateFrom("")} className="ml-0.5 hover:text-destructive"><X className="h-2.5 w-2.5" /></button>
                </span>
              )}
              {dateTo && (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-primary/10 text-primary text-xs font-medium">
                  To {dateTo}
                  <button onClick={() => setDateTo("")} className="ml-0.5 hover:text-destructive"><X className="h-2.5 w-2.5" /></button>
                </span>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── Summary cards ── */}
      <div className={`grid gap-4 ${canSeeAll ? "grid-cols-2 lg:grid-cols-4" : "grid-cols-2"}`}>
        <SummaryCard icon={Package}      label="Total Orders"   value={total}              color="primary" />
        <SummaryCard icon={Truck}        label="Dispatched"     value={dispatched.length}  color="blue"
          sub={total > 0 ? `${Math.round(dispatched.length/total*100)}% of orders` : undefined} />
        <SummaryCard icon={CheckCircle2} label="Delivered"      value={delivered.length}   color="success" />
        {canSeeAll
          ? <SummaryCard icon={DollarSign}  label="Revenue"     value={fmtMoney(revenue)}  color="amber" sub="Delivered orders" />
          : <SummaryCard icon={TrendingUp}  label="In Production" value={inProd.length}    color="rose" />
        }
      </div>

      {/* ── Dispatch Speed Card ── */}
      <div className="card-luxe p-4 sm:p-5">
        <div className="flex items-center gap-3 mb-4">
          <div className="h-9 w-9 sm:h-10 sm:w-10 rounded-xl sm:rounded-2xl bg-blue-500/10 grid place-items-center shrink-0">
            <Clock className="h-4.5 w-4.5 sm:h-5 sm:w-5 h-[18px] w-[18px] text-blue-600" />
          </div>
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Dispatch Speed</p>
            <h3 className="font-semibold text-brand-dark text-sm sm:text-base leading-tight">Days from order to dispatch</h3>
          </div>
        </div>

        {speedRows.length === 0 ? (
          <div className="py-8 text-center">
            <Truck className="h-10 w-10 text-muted-foreground/20 mx-auto mb-2" />
            <p className="text-sm text-muted-foreground">No dispatched orders in this period</p>
          </div>
        ) : (
          <>
            {/* Big stat */}
            <div className="flex items-end gap-2 sm:gap-3 mb-5 flex-wrap">
              <div>
                <p className="font-display text-4xl sm:text-5xl text-brand-dark leading-none">{speedRows.length}</p>
                <p className="text-xs sm:text-sm text-muted-foreground mt-1">
                  order{speedRows.length !== 1 ? "s" : ""} dispatched
                </p>
              </div>
              <div className="pb-1 text-muted-foreground text-xl sm:text-2xl font-light">in avg</div>
              <div>
                <p className="font-display text-4xl sm:text-5xl text-primary leading-none">{avgDays}</p>
                <p className="text-xs sm:text-sm text-muted-foreground mt-1">days each</p>
              </div>
            </div>

            {/* Speed bands */}
            <div className="grid grid-cols-3 gap-2 sm:gap-3">
              {[
                { label: "Fast",   sub: "≤ 7 days",  count: fast,   color: "bg-success/10 border-success/30 text-success" },
                { label: "Normal", sub: "8–20 days",  count: normal, color: "bg-amber-50 border-amber-200 text-amber-700" },
                { label: "Slow",   sub: ">20 days",   count: slow,   color: "bg-rose-50 border-rose-200 text-rose-600" },
              ].map(b => (
                <div key={b.label} className={`rounded-xl border p-2.5 sm:p-3 text-center ${b.color}`}>
                  <p className="font-display text-xl sm:text-2xl">{b.count}</p>
                  <p className="text-[11px] sm:text-xs font-semibold mt-0.5">{b.label}</p>
                  <p className="text-[9px] sm:text-[10px] opacity-70">{b.sub}</p>
                </div>
              ))}
            </div>

            {/* Top slowest / fastest for admin */}
            {canSeeAll && speedRows.length > 0 && (
              <div className="mt-4 space-y-1.5">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Individual Order Breakdown</p>
                <div className="max-h-40 overflow-y-auto space-y-1.5 pr-1">
                  {[...speedRows].sort((a,b) => b.days - a.days).map(r => {
                    const c = clients.find(cl => cl.id === r.o.clientId);
                    return (
                      <div key={r.o.id} className="flex items-center justify-between gap-2 px-3 py-2 rounded-xl bg-secondary/60 text-sm">
                        <div className="min-w-0">
                          <span className="font-medium text-brand-dark">{r.o.orderNumber}</span>
                          <span className="text-muted-foreground text-xs ml-2">{c?.companyName}</span>
                        </div>
                        <span className={`shrink-0 px-2 py-0.5 rounded-full text-xs font-semibold
                          ${r.days <= 7 ? "bg-success/10 text-success" : r.days <= 20 ? "bg-amber-100 text-amber-700" : "bg-rose-100 text-rose-600"}`}>
                          {r.days}d
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* ── Orders by Department (admin / employee) ── */}
      {canSeeAll && (
        <div className="card-luxe p-4 sm:p-5">
          <div className="mb-4">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Analytics</p>
            <h3 className="font-semibold text-brand-dark text-sm sm:text-base">Orders by Department</h3>
          </div>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={byDept} margin={{ left: -16, right: 4, top: 4, bottom: 0 }}>
              <XAxis dataKey="name" tick={{ fontSize: 9 }} tickLine={false} axisLine={false} />
              <YAxis tick={{ fontSize: 9 }} allowDecimals={false} tickLine={false} axisLine={false} />
              <Tooltip
                formatter={(v: number, _: string, p: any) => [v, p.payload.fullName]}
                contentStyle={{ borderRadius: 12, border: "1px solid var(--border)", fontSize: 12 }}
              />
              <Bar dataKey="count" name="Orders" fill="oklch(0.475 0.13 264)" radius={[6,6,0,0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* ── Client-wise breakdown (admin / employee) ── */}
      {canSeeAll && byClient.length > 0 && (
        <div className="card-luxe p-4 sm:p-5">
          <div className="mb-4">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Breakdown</p>
            <h3 className="font-semibold text-brand-dark text-sm sm:text-base">
              {clientFilter === "all" ? "Client-wise Summary" : `Orders — ${clients.find(c=>c.id===clientFilter)?.companyName}`}
            </h3>
          </div>

          {/* Mobile cards */}
          <div className="sm:hidden space-y-2.5">
            {byClient.map(cl => (
              <div key={cl.id} className="rounded-xl bg-secondary/50 p-3 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <p className="font-semibold text-brand-dark text-sm truncate">{cl.name}</p>
                  <span className="text-xs text-muted-foreground shrink-0">{cl.total} order{cl.total !== 1 ? "s" : ""}</span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  <span className="px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 text-[11px] font-medium">{cl.dispatched} dispatched</span>
                  <span className="px-2 py-0.5 rounded-full bg-success/10 text-success text-[11px] font-medium">{cl.delivered} delivered</span>
                  {cl.avgDays !== null && (
                    <span className={`px-2 py-0.5 rounded-full text-[11px] font-medium
                      ${cl.avgDays <= 7 ? "bg-success/10 text-success" : cl.avgDays <= 20 ? "bg-amber-100 text-amber-700" : "bg-rose-100 text-rose-600"}`}>
                      {cl.avgDays}d avg
                    </span>
                  )}
                  <span className="px-2 py-0.5 rounded-full bg-primary/10 text-primary text-[11px] font-semibold">{fmtMoney(cl.revenue)}</span>
                </div>
              </div>
            ))}
          </div>

          {/* Desktop table */}
          <div className="hidden sm:block overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border/60">
                  {["Client","Orders","Dispatched","Delivered","Revenue","Avg Dispatch"].map(h => (
                    <th key={h} className="text-left text-xs font-semibold text-muted-foreground pb-2 pr-4 whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border/40">
                {byClient.map(cl => (
                  <tr key={cl.id} className="hover:bg-secondary/30 transition-colors">
                    <td className="py-2.5 pr-4 font-medium text-brand-dark whitespace-nowrap">{cl.name}</td>
                    <td className="py-2.5 pr-4">{cl.total}</td>
                    <td className="py-2.5 pr-4">
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 text-xs font-medium">{cl.dispatched}</span>
                    </td>
                    <td className="py-2.5 pr-4">
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-success/10 text-success text-xs font-medium">{cl.delivered}</span>
                    </td>
                    <td className="py-2.5 pr-4 font-semibold text-brand-dark">{fmtMoney(cl.revenue)}</td>
                    <td className="py-2.5">
                      {cl.avgDays !== null
                        ? <span className={`px-2 py-0.5 rounded-full text-xs font-medium
                            ${cl.avgDays <= 7 ? "bg-success/10 text-success" : cl.avgDays <= 20 ? "bg-amber-100 text-amber-700" : "bg-rose-100 text-rose-600"}`}>
                            {cl.avgDays} days
                          </span>
                        : <span className="text-muted-foreground text-xs">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Client-facing: status breakdown ── */}
      {isClient && (
        <>
          <div className="card-luxe p-4 sm:p-5">
            <div className="mb-4">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Overview</p>
              <h3 className="font-semibold text-brand-dark text-sm sm:text-base">Order Status Breakdown</h3>
            </div>
            <div className="space-y-2.5">
              {STATUS_LIST.map(s => {
                const cnt = filtered.filter(o => o.status === s).length;
                const pct = total > 0 ? (cnt / total) * 100 : 0;
                return (
                  <div key={s} className="flex items-center gap-2 sm:gap-3">
                    <div className="w-24 sm:w-28 shrink-0">
                      <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-semibold ${statusColors[s]}`}>{s}</span>
                    </div>
                    <div className="flex-1 h-2 rounded-full bg-secondary overflow-hidden">
                      <div className="h-full rounded-full bg-primary transition-all duration-500" style={{ width: `${pct}%` }} />
                    </div>
                    <span className="w-5 text-right text-xs font-semibold text-brand-dark shrink-0">{cnt}</span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* My recent orders */}
          {filtered.length > 0 && (
            <div className="card-luxe p-4 sm:p-5">
              <div className="mb-3">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">History</p>
                <h3 className="font-semibold text-brand-dark text-sm sm:text-base">My Orders</h3>
              </div>
              <div className="space-y-2">
                {filtered.slice(0,20).map(o => {
                  const d = dispatchDays(o);
                  return (
                    <div key={o.id} className="flex items-center justify-between gap-2 p-3 rounded-xl bg-secondary/40">
                      <div className="min-w-0">
                        <p className="font-semibold text-brand-dark text-sm leading-tight">{o.orderNumber}</p>
                        <p className="text-[11px] text-muted-foreground mt-0.5 truncate">{o.jewelleryType} · {fmtDate(o.createdAt)}</p>
                      </div>
                      <div className="flex flex-col items-end gap-1 shrink-0">
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${statusColors[o.status] ?? "bg-secondary text-foreground"}`}>
                          {o.status}
                        </span>
                        {d !== null && (
                          <span className="text-[10px] text-muted-foreground">{d}d dispatch</span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </>
      )}

      {/* Empty state */}
      {total === 0 && (
        <div className="card-luxe p-12 text-center">
          <Package className="h-12 w-12 text-muted-foreground/20 mx-auto mb-3" />
          <p className="font-semibold text-brand-dark">No orders found</p>
          <p className="text-sm text-muted-foreground mt-1">
            {hasFilters ? "Try adjusting the filters above." : "No data available yet."}
          </p>
        </div>
      )}

    </div>
  );
}
