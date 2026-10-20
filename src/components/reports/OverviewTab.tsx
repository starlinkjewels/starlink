import { useMemo } from "react";
import { Link } from "react-router-dom";
import {
  ResponsiveContainer, ComposedChart, Bar as RBar, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, AreaChart, Area, PieChart, Pie, Cell, BarChart,
} from "recharts";
import {
  DollarSign, ShoppingBag, TrendingUp, Wallet, HandCoins, Landmark, Timer, BadgeCheck, AlertTriangle, PieChart as PieIcon, Users, Workflow, Activity,
} from "lucide-react";
import { fmtDate } from "@/lib/db";
import {
  kpis, monthly, pctChange, pipeline, receivables, payables, salesBy, lateOpen, clientTable,
} from "@/lib/analytics";
import { C, SERIES, KpiCard, Panel, ChartTip, Empty, Bar, usd, inr, pct, num } from "./ui";
import type { ReportCtx } from "./context";

type TabKey = "overview" | "sales" | "clients" | "team" | "production" | "purchases" | "orders";

export function OverviewTab({ ctx, goTo }: { ctx: ReportCtx; goTo: (t: TabKey) => void }) {
  const { db, orders, period, prev, withProfit, clientIds, version } = ctx;
  const data = useMemo(() => {
    const k = kpis(db, orders, period, withProfit, clientIds);
    const kp = prev ? kpis(db, orders, prev, withProfit, clientIds) : null;
    return {
      k, kp,
      months: monthly(db, orders, period, withProfit, clientIds),
      pipe: pipeline(orders),
      owed: receivables(orders),
      pay: payables(db),
      byType: salesBy(orders, period, o => o.jewelleryType),
      top: clientTable(db, orders, period, false).filter(c => c.salesUsd > 0).sort((a, b) => b.salesUsd - a.salesUsd).slice(0, 6),
      late: lateOpen(orders),
      inactive: clientTable(db, orders, { from: "", to: "" }, false).filter(c => c.daysSinceLast !== null && c.daysSinceLast > 60).sort((a, b) => (b.daysSinceLast ?? 0) - (a.daysSinceLast ?? 0)),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db, orders, period.from, period.to, prev?.from, prev?.to, withProfit, version]);
  const { k, kp } = data;
  const d = (now: number | null, before: number | null | undefined) => (kp == null || now == null || before == null ? undefined : pctChange(now, before));
  const typeTotal = data.byType.reduce((s, x) => s + x.value, 0);
  const topMax = data.top[0]?.salesUsd ?? 0;

  return (
    <div className="space-y-4">
      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiCard icon={DollarSign} label="Sales (dispatched)" value={usd(k.salesUsd, true)} sub={`${k.soldCount} piece${k.soldCount !== 1 ? "s" : ""} shipped`} delta={d(k.salesUsd, kp?.salesUsd)} />
        <KpiCard icon={ShoppingBag} label="Orders received" value={num(k.receivedCount)} sub={`${usd(k.receivedUsd, true)} booked${k.rejectedCount ? ` · ${k.rejectedCount} rejected` : ""}`} delta={d(k.receivedCount, kp?.receivedCount)} tone="sky" />
        {withProfit ? (
          <KpiCard icon={TrendingUp} label="Gross profit" value={usd(k.profitUsd, true)} sub={`${k.profitInr != null ? `${inr(k.profitInr, true)} · ` : ""}Margin ${pct(k.marginPct)}${k.incomplete ? ` · ${k.incomplete} not fully costed` : ""}`}
            delta={d(k.profitUsd, kp?.profitUsd)} tone="success" hint="Sales less what the pieces cost — gold, diamonds, factory and freight." />
        ) : (
          <KpiCard icon={TrendingUp} label="Average order" value={usd(k.avgOrderUsd)} sub="Per piece shipped" delta={d(k.avgOrderUsd, kp?.avgOrderUsd)} tone="success" />
        )}
        <KpiCard icon={Wallet} label="Money collected" value={usd(k.collectedUsd, true)} sub="Received from clients" delta={d(k.collectedUsd, kp?.collectedUsd)} tone="gold" />
        <KpiCard icon={HandCoins} label="Owed to us" value={usd(data.owed.total, true)} sub={data.owed.d90 ? `${usd(data.owed.d90, true)} over 90 days` : "Nothing over 90 days"} tone="rose" hint="Unpaid on shipped work, as of today." />
        {ctx.employeeId ? (
          // What the business owes suppliers is nobody's own figure — for one
          // person, the work they have in hand stands in its place.
          <KpiCard icon={Landmark} label="Open orders" value={num(data.pipe.reduce((s, x) => s + x.count, 0))} sub={`${usd(data.pipe.reduce((s, x) => s + x.value, 0), true)} not yet delivered`} tone="violet" />
        ) : (
          <KpiCard icon={Landmark} label="We owe" value={inr(data.pay.suppliersInr + data.pay.factoriesInr, true)} sub={`Suppliers ${inr(data.pay.suppliersInr, true)} · factories ${inr(data.pay.factoriesInr, true)}`} tone="violet" hint="As of today." />
        )}
        <KpiCard icon={Timer} label="Order to dispatch" value={num(k.avgCycleDays, " days")} sub={k.medianCycleDays != null ? `Median ${num(k.medianCycleDays)} days` : "Average"} delta={d(k.avgCycleDays, kp?.avgCycleDays)} goodWhenDown tone="sky" />
        <KpiCard icon={BadgeCheck} label="On-time dispatch" value={pct(k.onTimePct)} sub="Shipped by the promised date" delta={d(k.onTimePct, kp?.onTimePct)} tone="success" />
      </div>

      {/* Trend */}
      <div className="grid lg:grid-cols-3 gap-4">
        <Panel title={withProfit ? "Sales, cost & profit — month by month" : "Sales — month by month"} subtitle="By month shipped" icon={Activity} className="lg:col-span-2">
          {data.months.some(m => m.salesUsd > 0) ? (
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={data.months} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="oklch(0.9 0.01 260)" />
                  <XAxis dataKey="label" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} />
                  <YAxis tick={{ fontSize: 10 }} tickLine={false} axisLine={false} tickFormatter={v => usd(v, true)} width={56} />
                  <Tooltip content={<ChartTip format={v => usd(v)} />} />
                  <Legend wrapperStyle={{ fontSize: 11 }} iconType="circle" />
                  <RBar dataKey="salesUsd" name="Sales" fill={C.primary} radius={[6, 6, 0, 0]} maxBarSize={34} />
                  {withProfit && <RBar dataKey="costUsd" name="Cost" fill={C.gold} radius={[6, 6, 0, 0]} maxBarSize={34} />}
                  {withProfit
                    ? <Line dataKey="profitUsd" name="Profit" stroke={C.success} strokeWidth={2.5} dot={{ r: 3 }} />
                    : <Line dataKey="collectedUsd" name="Collected" stroke={C.success} strokeWidth={2.5} dot={{ r: 3 }} />}
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          ) : <Empty>No pieces shipped in this period.</Empty>}
        </Panel>

        <Panel title="Orders in vs shipped" subtitle="Count per month" icon={Workflow}>
          {data.months.some(m => m.receivedCount || m.soldCount) ? (
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={data.months} margin={{ top: 8, right: 8, left: -24, bottom: 0 }}>
                  <defs>
                    <linearGradient id="gIn" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={C.sky} stopOpacity={0.35} /><stop offset="100%" stopColor={C.sky} stopOpacity={0} /></linearGradient>
                    <linearGradient id="gOut" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={C.primary} stopOpacity={0.35} /><stop offset="100%" stopColor={C.primary} stopOpacity={0} /></linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="oklch(0.9 0.01 260)" />
                  <XAxis dataKey="label" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 10 }} tickLine={false} axisLine={false} />
                  <Tooltip content={<ChartTip />} />
                  <Legend wrapperStyle={{ fontSize: 11 }} iconType="circle" />
                  <Area type="monotone" dataKey="receivedCount" name="Received" stroke={C.sky} fill="url(#gIn)" strokeWidth={2} />
                  <Area type="monotone" dataKey="soldCount" name="Shipped" stroke={C.primary} fill="url(#gOut)" strokeWidth={2} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          ) : <Empty />}
        </Panel>
      </div>

      <div className="grid lg:grid-cols-3 gap-4">
        <Panel title="Work in hand" subtitle="Open orders, right now" icon={Workflow}
          actions={<button type="button" onClick={() => goTo("production")} className="text-[11px] text-primary hover:underline">Production →</button>}>
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.pipe} layout="vertical" margin={{ top: 0, right: 24, left: 8, bottom: 0 }}>
                <XAxis type="number" hide allowDecimals={false} />
                <YAxis type="category" dataKey="key" tick={{ fontSize: 11 }} width={88} tickLine={false} axisLine={false} />
                <Tooltip content={<ChartTip format={(v, n) => (n === "Orders" ? String(v) : usd(v))} />} />
                <RBar dataKey="count" name="Orders" radius={[0, 6, 6, 0]} label={{ position: "right", fontSize: 11 }}>
                  {data.pipe.map((_, i) => <Cell key={i} fill={SERIES[i % SERIES.length]} />)}
                </RBar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <p className="text-[11px] text-muted-foreground">{usd(data.pipe.reduce((s, x) => s + x.value, 0), true)} of orders not yet delivered.</p>
        </Panel>

        <Panel title="Sales by item" subtitle="Share of sales" icon={PieIcon}>
          {data.byType.length ? (
            <div className="flex items-center gap-3">
              <div className="h-48 w-40 shrink-0">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={data.byType} dataKey="value" nameKey="key" innerRadius={42} outerRadius={70} paddingAngle={2} stroke="none">
                      {data.byType.map((_, i) => <Cell key={i} fill={SERIES[i % SERIES.length]} />)}
                    </Pie>
                    <Tooltip content={<ChartTip format={v => usd(v)} />} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <ul className="space-y-1.5 text-xs min-w-0 flex-1">
                {data.byType.slice(0, 7).map((s, i) => (
                  <li key={s.key} className="flex items-center gap-2 min-w-0">
                    <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ background: SERIES[i % SERIES.length] }} />
                    <span className="truncate">{s.key}</span>
                    <span className="ml-auto font-semibold text-brand-dark shrink-0">{pct(typeTotal ? Math.round((s.value / typeTotal) * 1000) / 10 : 0)}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : <Empty />}
        </Panel>

        <Panel title="Top clients" subtitle="By sales" icon={Users}
          actions={<button type="button" onClick={() => goTo("clients")} className="text-[11px] text-primary hover:underline">All clients →</button>}>
          {data.top.length ? (
            <ul className="space-y-3">
              {data.top.map(c => (
                <li key={c.id} className="space-y-1">
                  <div className="flex items-center justify-between gap-2 text-xs">
                    <Link to={`/clients/${c.id}`} className="truncate font-medium text-brand-dark hover:text-primary">{c.name}</Link>
                    <span className="font-semibold shrink-0">{usd(c.salesUsd, true)}</span>
                  </div>
                  <Bar value={c.salesUsd} max={topMax} />
                </li>
              ))}
            </ul>
          ) : <Empty />}
        </Panel>
      </div>

      {/* What needs looking at */}
      <Panel title="Needs attention" subtitle="Late · overdue · quiet clients" icon={AlertTriangle}>
        <div className="grid md:grid-cols-3 gap-4 text-xs">
          <div>
            <p className="font-semibold text-brand-dark mb-2">Late orders <span className="text-destructive">({data.late.length})</span></p>
            {data.late.length ? (
              <ul className="space-y-1.5">
                {data.late.slice(0, 6).map(o => (
                  <li key={o.id} className="flex items-center justify-between gap-2">
                    <Link to={`/orders/${o.id}`} className="font-mono text-primary hover:underline">{o.orderNumber}</Link>
                    <span className="text-destructive">due {fmtDate(o.expectedDelivery)}</span>
                  </li>
                ))}
                {data.late.length > 6 && <li className="text-muted-foreground">+{data.late.length - 6} more on the Production tab</li>}
              </ul>
            ) : <p className="text-muted-foreground">Nothing past its promised date.</p>}
          </div>
          <div>
            <p className="font-semibold text-brand-dark mb-2">Money owed, by age</p>
            {([["0–30 days", data.owed.current, C.success], ["31–60 days", data.owed.d30, C.gold], ["61–90 days", data.owed.d60, C.amber], ["Over 90 days", data.owed.d90, C.rose]] as const).map(([l, v, tone]) => (
              <div key={l} className="space-y-1 mb-2">
                <div className="flex justify-between"><span className="text-muted-foreground">{l}</span><span className="font-semibold">{usd(v)}</span></div>
                <Bar value={v} max={data.owed.total} tone={tone} />
              </div>
            ))}
          </div>
          <div>
            <p className="font-semibold text-brand-dark mb-2">No order in 60+ days <span className="text-muted-foreground">({data.inactive.length})</span></p>
            {data.inactive.length ? (
              <ul className="space-y-1.5">
                {data.inactive.slice(0, 6).map(c => (
                  <li key={c.id} className="flex items-center justify-between gap-2">
                    <Link to={`/clients/${c.id}`} className="truncate hover:text-primary">{c.name}</Link>
                    <span className="text-muted-foreground shrink-0">{c.daysSinceLast} days</span>
                  </li>
                ))}
              </ul>
            ) : <p className="text-muted-foreground">Every client has ordered in the last two months.</p>}
          </div>
        </div>
      </Panel>
    </div>
  );
}
