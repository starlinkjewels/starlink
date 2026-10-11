import { useMemo } from "react";
import { Link } from "react-router-dom";
import { ResponsiveContainer, ComposedChart, Bar as RBar, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, PieChart, Pie, Cell } from "recharts";
import { CalendarRange, Gem, Layers, TrendingDown, Users } from "lucide-react";
import { downloadCsv } from "@/lib/ledgerExport";
import { monthly, salesBy, soldIn } from "@/lib/analytics";
import { profitReport } from "@/lib/orderCost";
import { C, SERIES, Panel, ChartTip, Empty, Bar, ExportButton, Table, usd, pct, num } from "./ui";
import type { ReportCtx } from "./context";

export function SalesTab({ ctx }: { ctx: ReportCtx }) {
  const { db, orders, period, withProfit, clientIds, version, fileTag } = ctx;
  const data = useMemo(() => {
    const months = monthly(db, orders, period, withProfit, clientIds);
    const sold = soldIn(orders, period);
    const pr = withProfit && sold.length ? profitReport(db, sold) : null;
    return {
      months, pr,
      byMetal: salesBy(orders, period, o => o.metal),
      byType: salesBy(orders, period, o => o.jewelleryType),
      byClient: salesBy(orders, period, o => db.clients.find(c => c.id === o.clientId)?.companyName ?? "—").slice(0, 10),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db, orders, period.from, period.to, withProfit, version]);

  const rows = [...data.months].reverse();
  const tot = data.months.reduce((t, m) => ({
    receivedCount: t.receivedCount + m.receivedCount, soldCount: t.soldCount + m.soldCount, salesUsd: t.salesUsd + m.salesUsd,
    collectedUsd: t.collectedUsd + m.collectedUsd, costUsd: t.costUsd + (m.costUsd ?? 0), profitUsd: t.profitUsd + (m.profitUsd ?? 0),
  }), { receivedCount: 0, soldCount: 0, salesUsd: 0, collectedUsd: 0, costUsd: 0, profitUsd: 0 });
  const totMargin = tot.salesUsd > 0 && withProfit ? Math.round((tot.profitUsd / tot.salesUsd) * 1000) / 10 : null;
  let run = 0;
  const cumulative = new Map(data.months.map(m => { run += m.salesUsd; return [m.month, run]; }));
  const clientMax = data.byClient[0]?.value ?? 0;
  const metalTotal = data.byMetal.reduce((s, x) => s + x.value, 0);

  const exportMonths = () => downloadCsv(`Sales-by-month_${fileTag}.csv`,
    ["Month", "Orders in", "Shipped", "Sales ($)", "Collected ($)", ...(withProfit ? ["Cost ($)", "Profit ($)", "Margin %"] : []), "Cumulative sales ($)"],
    data.months.map(m => [m.label, m.receivedCount, m.soldCount, m.salesUsd, m.collectedUsd,
      ...(withProfit ? [m.costUsd ?? "", m.profitUsd ?? "", m.marginPct ?? ""] : []), Math.round((cumulative.get(m.month) ?? 0) * 100) / 100]));

  return (
    <div className="space-y-4">
      <Panel title="Month by month" subtitle="Sales by the month shipped · orders by the month placed · money by the day received" icon={CalendarRange}
        actions={<ExportButton onClick={exportMonths} />}>
        {data.months.some(m => m.salesUsd || m.receivedCount) ? (
          <>
            <div className="h-64 mb-4">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={data.months} margin={{ top: 8, right: 4, left: -8, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="oklch(0.9 0.01 260)" />
                  <XAxis dataKey="label" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} />
                  <YAxis yAxisId="l" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} tickFormatter={v => usd(v, true)} width={56} />
                  {withProfit && <YAxis yAxisId="r" orientation="right" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} tickFormatter={v => `${v}%`} width={36} />}
                  <Tooltip content={<ChartTip format={(v, n) => (n === "Margin" ? pct(v) : usd(v))} />} />
                  <Legend wrapperStyle={{ fontSize: 11 }} iconType="circle" />
                  <RBar yAxisId="l" dataKey="salesUsd" name="Sales" fill={C.primary} radius={[6, 6, 0, 0]} maxBarSize={30} />
                  <RBar yAxisId="l" dataKey="collectedUsd" name="Collected" fill={C.gold} radius={[6, 6, 0, 0]} maxBarSize={30} />
                  {withProfit && <Line yAxisId="r" dataKey="marginPct" name="Margin" stroke={C.success} strokeWidth={2.5} dot={{ r: 3 }} connectNulls />}
                </ComposedChart>
              </ResponsiveContainer>
            </div>
            <Table minWidth={withProfit ? 860 : 620} head={
              <tr className="border-b border-border/60">
                <th className="text-left py-2 pr-2">Month</th><th className="text-right px-2">Orders in</th><th className="text-right px-2">Shipped</th>
                <th className="text-right px-2">Sales</th><th className="text-right px-2">Collected</th>
                {withProfit && <><th className="text-right px-2">Cost</th><th className="text-right px-2">Profit</th><th className="text-right px-2">Margin</th></>}
                <th className="text-right pl-2">Running total</th>
              </tr>}>
              {rows.map(m => (
                <tr key={m.month} className="hover:bg-secondary/40">
                  <td className="py-2 pr-2 font-medium text-brand-dark">{m.label}</td>
                  <td className="text-right px-2">{m.receivedCount || "—"}</td>
                  <td className="text-right px-2">{m.soldCount || "—"}</td>
                  <td className="text-right px-2 font-semibold">{m.salesUsd ? usd(m.salesUsd) : "—"}</td>
                  <td className="text-right px-2">{m.collectedUsd ? usd(m.collectedUsd) : "—"}</td>
                  {withProfit && <>
                    <td className="text-right px-2">{m.costUsd ? usd(m.costUsd) : "—"}</td>
                    <td className={`text-right px-2 font-semibold ${(m.profitUsd ?? 0) < 0 ? "text-destructive" : "text-success"}`}>{m.profitUsd != null && m.soldCount ? usd(m.profitUsd) : "—"}</td>
                    <td className="text-right px-2">{m.soldCount ? pct(m.marginPct) : "—"}</td>
                  </>}
                  <td className="text-right pl-2 text-muted-foreground">{usd(cumulative.get(m.month) ?? 0, true)}</td>
                </tr>
              ))}
              <tr className="font-semibold bg-secondary/40">
                <td className="py-2 pr-2">Total</td><td className="text-right px-2">{tot.receivedCount}</td><td className="text-right px-2">{tot.soldCount}</td>
                <td className="text-right px-2">{usd(tot.salesUsd)}</td><td className="text-right px-2">{usd(tot.collectedUsd)}</td>
                {withProfit && <><td className="text-right px-2">{usd(tot.costUsd)}</td><td className="text-right px-2">{usd(tot.profitUsd)}</td><td className="text-right px-2">{pct(totMargin)}</td></>}
                <td className="text-right pl-2" />
              </tr>
            </Table>
          </>
        ) : <Empty />}
      </Panel>

      <div className="grid lg:grid-cols-3 gap-4">
        <Panel title="By metal" subtitle="Share of sales" icon={Gem}>
          {data.byMetal.length ? (
            <>
              <div className="h-44">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={data.byMetal} dataKey="value" nameKey="key" innerRadius={40} outerRadius={68} paddingAngle={2} stroke="none">
                      {data.byMetal.map((_, i) => <Cell key={i} fill={SERIES[i % SERIES.length]} />)}
                    </Pie>
                    <Tooltip content={<ChartTip format={v => usd(v)} />} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <ul className="space-y-1 text-xs">
                {data.byMetal.map((s, i) => (
                  <li key={s.key} className="flex items-center gap-2">
                    <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ background: SERIES[i % SERIES.length] }} />
                    <span className="truncate">{s.key}</span><span className="text-muted-foreground">({s.count})</span>
                    <span className="ml-auto font-semibold">{usd(s.value, true)} · {pct(metalTotal ? Math.round((s.value / metalTotal) * 1000) / 10 : 0)}</span>
                  </li>
                ))}
              </ul>
            </>
          ) : <Empty />}
        </Panel>

        <Panel title="By item" subtitle="Pieces and sales" icon={Layers}>
          {data.byType.length ? (
            <ul className="space-y-2.5 text-xs">
              {data.byType.map(s => (
                <li key={s.key} className="space-y-1">
                  <div className="flex justify-between gap-2"><span>{s.key} <span className="text-muted-foreground">· {s.count} pcs · avg {usd(s.value / s.count)}</span></span><span className="font-semibold">{usd(s.value, true)}</span></div>
                  <Bar value={s.value} max={data.byType[0].value} tone={C.gold} />
                </li>
              ))}
            </ul>
          ) : <Empty />}
        </Panel>

        <Panel title="Top 10 clients" subtitle="By sales" icon={Users}>
          {data.byClient.length ? (
            <ul className="space-y-2.5 text-xs">
              {data.byClient.map(s => (
                <li key={s.key} className="space-y-1">
                  <div className="flex justify-between gap-2"><span className="truncate">{s.key} <span className="text-muted-foreground">· {s.count}</span></span><span className="font-semibold shrink-0">{usd(s.value, true)}</span></div>
                  <Bar value={s.value} max={clientMax} />
                </li>
              ))}
            </ul>
          ) : <Empty />}
        </Panel>
      </div>

      {withProfit && data.pr && (
        <div className="grid lg:grid-cols-2 gap-4">
          <Panel title="Profit by client" subtitle="Margin on pieces shipped in the period" icon={Users}>
            <Table minWidth={460} head={<tr className="border-b border-border/60"><th className="text-left py-2">Client</th><th className="text-right px-2">Pcs</th><th className="text-right px-2">Sales</th><th className="text-right px-2">Profit</th><th className="text-right pl-2">Margin</th></tr>}>
              {data.pr.byClient.map(g => (
                <tr key={g.key}>
                  <td className="py-1.5 truncate max-w-[180px]">{g.key}{g.incomplete ? <span className="text-amber-600"> · {g.incomplete} not fully costed</span> : null}</td>
                  <td className="text-right px-2">{g.count}</td><td className="text-right px-2">{usd(g.sellingUsd)}</td>
                  <td className={`text-right px-2 font-semibold ${(g.profitUsd ?? 0) < 0 ? "text-destructive" : "text-success"}`}>{usd(g.profitUsd)}</td>
                  <td className="text-right pl-2">{pct(g.marginPct)}</td>
                </tr>
              ))}
            </Table>
          </Panel>
          <Panel title="Profit by item" subtitle="Which pieces earn the most" icon={Layers}>
            <Table minWidth={420} head={<tr className="border-b border-border/60"><th className="text-left py-2">Item</th><th className="text-right px-2">Pcs</th><th className="text-right px-2">Sales</th><th className="text-right px-2">Profit</th><th className="text-right pl-2">Margin</th></tr>}>
              {data.pr.byType.map(g => (
                <tr key={g.key}>
                  <td className="py-1.5">{g.key}</td><td className="text-right px-2">{g.count}</td><td className="text-right px-2">{usd(g.sellingUsd)}</td>
                  <td className={`text-right px-2 font-semibold ${(g.profitUsd ?? 0) < 0 ? "text-destructive" : "text-success"}`}>{usd(g.profitUsd)}</td>
                  <td className="text-right pl-2">{pct(g.marginPct)}</td>
                </tr>
              ))}
            </Table>
          </Panel>
          {data.pr.losses.length > 0 && (
            <Panel title={`Sold at a loss (${data.pr.losses.length})`} subtitle="Check the price or the cost on these first" icon={TrendingDown} className="lg:col-span-2">
              <Table minWidth={560} head={<tr className="border-b border-border/60"><th className="text-left py-2">Order</th><th className="text-left px-2">Client</th><th className="text-right px-2">Sold for</th><th className="text-right px-2">Cost</th><th className="text-right pl-2">Loss</th></tr>}>
                {data.pr.losses.slice(0, 25).map(r => (
                  <tr key={r.order.id}>
                    <td className="py-1.5"><Link to={`/orders/${r.order.id}`} className="font-mono text-primary hover:underline">{r.order.orderNumber}</Link></td>
                    <td className="px-2 truncate max-w-[180px]">{db.clients.find(c => c.id === r.order.clientId)?.companyName ?? "—"}</td>
                    <td className="text-right px-2">{usd(r.sellingUsd)}{r.sellingUsd <= 5 ? <span className="text-amber-600"> · price not set?</span> : null}</td>
                    <td className="text-right px-2">{usd(r.costUsd)}</td>
                    <td className="text-right pl-2 font-semibold text-destructive">{usd(r.profitUsd)}</td>
                  </tr>
                ))}
              </Table>
              {data.pr.losses.length > 25 && <p className="text-[11px] text-muted-foreground mt-2">{num(data.pr.losses.length - 25)} more in the Profit &amp; Loss export below.</p>}
            </Panel>
          )}
        </div>
      )}
    </div>
  );
}
