import { useMemo } from "react";
import { Link } from "react-router-dom";
import { ResponsiveContainer, BarChart, Bar as RBar, XAxis, YAxis, CartesianGrid, Tooltip, Cell } from "recharts";
import { Factory, Hammer, AlarmClock, Timer, BadgeCheck, Coins, ClipboardList, Gauge } from "lucide-react";
import { downloadCsv } from "@/lib/ledgerExport";
import { fmtDate, type Order } from "@/lib/db";
import { kpis, lateOpen, factoryTable, soldIn, cycleDays, pctChange } from "@/lib/analytics";
import { DataTable, CellAmount } from "@/components/DataTable";
import { C, SERIES, KpiCard, Panel, ChartTip, ExportButton, Empty, inr, pct, num } from "./ui";
import type { ReportCtx } from "./context";

const BUCKETS: [string, number, number][] = [["0–7 d", 0, 7], ["8–14 d", 8, 14], ["15–21 d", 15, 21], ["22–30 d", 22, 30], ["31–45 d", 31, 45], ["45+ d", 46, Infinity]];

export function ProductionTab({ ctx }: { ctx: ReportCtx }) {
  const { db, orders, period, prev, clientIds, version, fileTag } = ctx;
  const data = useMemo(() => {
    const k = kpis(db, orders, period, false, clientIds);
    const kp = prev ? kpis(db, orders, prev, false, clientIds) : null;
    const days = soldIn(orders, period).map(cycleDays).filter((x): x is number => x !== null);
    const open = orders.filter(o => !o.forReadyStock && !["Dispatched", "Delivered", "Rejected"].includes(o.status));
    return {
      k, kp, open, late: lateOpen(orders),
      spread: BUCKETS.map(([key, a, b]) => ({ key, count: days.filter(d => d >= a && d <= b).length })),
      factories: factoryTable(db, period, ctx.companyId).filter(f => f.pieces || f.openJobs || f.labourPendingInr),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db, orders, period.from, period.to, prev?.from, prev?.to, version]);
  const { k, kp } = data;
  const d = (a: number | null, b: number | null | undefined) => (kp == null || a == null || b == null ? undefined : pctChange(a, b));
  const pieces = data.factories.reduce((s, f) => s + f.pieces, 0);
  const fine = Math.round(data.factories.reduce((s, f) => s + f.fineGoldG, 0) * 1000) / 1000;
  const today = new Date();
  const daysLate = (o: Order) => Math.floor((+today - +new Date(o.expectedDelivery)) / 86_400_000);
  const clientName = (id: string) => db.clients.find(c => c.id === id)?.companyName ?? "";

  const exportLate = () => downloadCsv(`Late-orders_${fileTag}.csv`, ["Order", "Client", "Item", "Status", "Promised", "Days late"],
    data.late.map(o => [o.orderNumber, db.clients.find(c => c.id === o.clientId)?.companyName ?? "", o.jewelleryType, o.status, fmtDate(o.expectedDelivery),
      Math.floor((+today - +new Date(o.expectedDelivery)) / 86_400_000)]));
  const exportFactories = () => downloadCsv(`Factories_${fileTag}.csv`, ["Factory", "Pieces finished", "Fine gold used (g)", "Labour billed (₹)", "Labour owed now (₹)", "Open jobs", "Avg days at factory"],
    data.factories.map(f => [f.name, f.pieces, f.fineGoldG, f.labourInr, f.labourPendingInr, f.openJobs, f.avgDays ?? ""]));

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-6 gap-3">
        <KpiCard icon={ClipboardList} label="Open orders" value={data.open.length} sub="Not yet shipped" />
        <KpiCard icon={AlarmClock} label="Late" value={data.late.length} sub="Past the promised date" tone="rose" />
        <KpiCard icon={Timer} label="Order to dispatch" value={num(k.avgCycleDays, " d")} sub={k.medianCycleDays != null ? `Median ${num(k.medianCycleDays)} d` : "Average"} delta={d(k.avgCycleDays, kp?.avgCycleDays)} goodWhenDown tone="sky" />
        <KpiCard icon={BadgeCheck} label="On time" value={pct(k.onTimePct)} sub="Shipped by the promised date" delta={d(k.onTimePct, kp?.onTimePct)} tone="success" />
        <KpiCard icon={Hammer} label="Pieces finished" value={pieces} sub="Final Approval in the period" tone="violet" />
        <KpiCard icon={Coins} label="Fine gold used" value={num(fine, " g")} sub="24KT, in finished pieces" tone="gold" />
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        <Panel title="How long orders take" subtitle="Days from order to dispatch, for pieces shipped in the period" icon={Gauge}>
          {data.spread.some(s => s.count) ? (
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.spread} margin={{ top: 8, right: 8, left: -24, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="oklch(0.9 0.01 260)" />
                  <XAxis dataKey="key" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 10 }} tickLine={false} axisLine={false} />
                  <Tooltip content={<ChartTip />} />
                  <RBar dataKey="count" name="Orders" radius={[6, 6, 0, 0]} maxBarSize={48}>
                    {data.spread.map((_, i) => <Cell key={i} fill={i < 2 ? C.success : i < 4 ? C.gold : C.rose} />)}
                  </RBar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : <Empty>No pieces shipped in this period.</Empty>}
        </Panel>

        <Panel title={`Late orders (${data.late.length})`} subtitle="Open work past the date promised to the client" icon={AlarmClock}
          actions={data.late.length ? <ExportButton onClick={exportLate} /> : undefined}>
          {data.late.length ? (
            <DataTable
              id="reports-late-orders"
              noun="order"
              rows={data.late}
              rowKey={o => o.id}
              rowHref={o => `/orders/${o.id}`}
              maxHeight="14rem"
              defaultSort={{ key: "late", dir: "desc" }}
              searchText={o => `${o.orderNumber} ${clientName(o.clientId)} ${o.status}`}
              searchPlaceholder="Search orders"
              columns={[
                { key: "order", header: "Order", always: true, sortValue: o => o.orderNumber,
                  cell: o => <Link to={`/orders/${o.id}`} className="font-mono text-primary hover:underline whitespace-nowrap">{o.orderNumber}</Link> },
                { key: "client", header: "Client", sortValue: o => clientName(o.clientId),
                  cell: o => <span className="block truncate max-w-[160px]">{clientName(o.clientId) || "—"}</span> },
                { key: "stage", header: "Stage", sortValue: o => o.status, cell: o => <span className="whitespace-nowrap">{o.status}</span> },
                { key: "late", header: "Late by", align: "right", kind: "number", sortValue: o => daysLate(o),
                  cell: o => <span className="font-semibold text-destructive tabular-nums whitespace-nowrap">{daysLate(o)} d</span> },
              ]}
            />
          ) : <Empty>Nothing is late.</Empty>}
        </Panel>
      </div>

      <Panel title="Factories" subtitle="Pieces and labour in the period · open jobs and labour owed as of today" icon={Factory}
        actions={data.factories.length ? <ExportButton onClick={exportFactories} /> : undefined}>
        {data.factories.length ? (
          <>
            <div className="h-48 mb-3">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.factories} margin={{ top: 8, right: 8, left: -24, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="oklch(0.9 0.01 260)" />
                  <XAxis dataKey="name" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} interval={0} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 10 }} tickLine={false} axisLine={false} />
                  <Tooltip content={<ChartTip />} />
                  <RBar dataKey="pieces" name="Pieces finished" radius={[6, 6, 0, 0]} maxBarSize={44}>
                    {data.factories.map((_, i) => <Cell key={i} fill={SERIES[i % SERIES.length]} />)}
                  </RBar>
                </BarChart>
              </ResponsiveContainer>
            </div>
            <DataTable
              id="reports-factories"
              noun="factory"
              rows={data.factories}
              rowKey={f => f.id}
              rowHref={f => `/factories/${f.id}`}
              defaultSort={{ key: "pieces", dir: "desc" }}
              searchText={f => f.name}
              searchPlaceholder="Search factories"
              columns={[
                { key: "factory", header: "Factory", always: true, sortValue: f => f.name,
                  cell: f => <Link to={`/factories/${f.id}`} className="font-medium text-brand-dark hover:text-primary whitespace-nowrap">{f.name}</Link> },
                { key: "pieces", header: "Pieces", align: "right", kind: "number", sortValue: f => f.pieces, cell: f => <span className="tabular-nums">{f.pieces || "—"}</span> },
                { key: "gold", header: "Fine gold used", align: "right", kind: "number", sortValue: f => f.fineGoldG,
                  cell: f => <span className="tabular-nums whitespace-nowrap">{f.fineGoldG ? `${f.fineGoldG} g` : "—"}</span> },
                { key: "billed", header: "Labour billed", align: "right", kind: "number", sortValue: f => f.labourInr,
                  cell: f => <span className="tabular-nums whitespace-nowrap">{f.labourInr ? inr(f.labourInr) : "—"}</span> },
                { key: "owed", header: "Labour owed now", align: "right", kind: "number", sortValue: f => f.labourPendingInr,
                  cell: f => (f.labourPendingInr ? <CellAmount tone="out">{inr(f.labourPendingInr)}</CellAmount> : <span className="text-muted-foreground">—</span>) },
                { key: "open", header: "Open jobs", align: "right", kind: "number", sortValue: f => f.openJobs, cell: f => <span className="tabular-nums">{f.openJobs || "—"}</span> },
                { key: "days", header: "Avg days", align: "right", kind: "number", sortValue: f => f.avgDays,
                  cell: f => <span className="tabular-nums whitespace-nowrap">{num(f.avgDays, " d")}</span> },
              ]}
            />
          </>
        ) : <Empty>No factory work in this period.</Empty>}
      </Panel>
    </div>
  );
}
