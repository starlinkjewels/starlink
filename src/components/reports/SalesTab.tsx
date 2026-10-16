import { useMemo, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { ResponsiveContainer, ComposedChart, Bar as RBar, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, PieChart, Pie, Cell } from "recharts";
import { CalendarRange, Gem, Layers, TrendingDown, Users } from "lucide-react";
import { downloadCsv } from "@/lib/ledgerExport";
import { monthly, salesBy, soldIn, type MonthRow } from "@/lib/analytics";
import { profitReport, saleDate, type ProfitGroup, type ProfitRow } from "@/lib/orderCost";
import { DataTable, CellMain, CellAmount, type DataColumn } from "@/components/DataTable";
import { C, SERIES, Panel, ChartTip, Empty, Bar, ExportButton, usd, inr, pct } from "./ui";
import { filled, type Detail } from "@/components/rowDetails";
import { fmtDate } from "@/lib/db";
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
  // Totals of the months the table is showing — every month, as before.
  const totOf = (ms: MonthRow[]) => ms.reduce((t, m) => ({
    receivedCount: t.receivedCount + m.receivedCount, soldCount: t.soldCount + m.soldCount, salesUsd: t.salesUsd + m.salesUsd,
    collectedUsd: t.collectedUsd + m.collectedUsd, costUsd: t.costUsd + (m.costUsd ?? 0), profitUsd: t.profitUsd + (m.profitUsd ?? 0),
  }), { receivedCount: 0, soldCount: 0, salesUsd: 0, collectedUsd: 0, costUsd: 0, profitUsd: 0 });
  const marginOf = (ms: MonthRow[]) => { const t = totOf(ms); return t.salesUsd > 0 && withProfit ? Math.round((t.profitUsd / t.salesUsd) * 1000) / 10 : null; };
  let run = 0;
  const cumulative = new Map(data.months.map(m => { run += m.salesUsd; return [m.month, run]; }));
  const clientMax = data.byClient[0]?.value ?? 0;
  const metalTotal = data.byMetal.reduce((s, x) => s + x.value, 0);

  const exportMonths = () => downloadCsv(`Sales-by-month_${fileTag}.csv`,
    ["Month", "Orders in", "Shipped", "Sales ($)", "Collected ($)", ...(withProfit ? ["Cost ($)", "Profit ($)", "Margin %"] : []), "Cumulative sales ($)"],
    data.months.map(m => [m.label, m.receivedCount, m.soldCount, m.salesUsd, m.collectedUsd,
      ...(withProfit ? [m.costUsd ?? "", m.profitUsd ?? "", m.marginPct ?? ""] : []), Math.round((cumulative.get(m.month) ?? 0) * 100) / 100]));

  const clientName = (id: string) => db.clients.find(c => c.id === id)?.companyName ?? "";
  const n = (v: number) => <span className="tabular-nums">{v || "—"}</span>;
  const monthColumns: DataColumn<MonthRow>[] = [
    { key: "month", header: "Month", always: true, kind: "date", sortValue: m => m.month, cell: m => <CellMain title={m.label} /> },
    { key: "in", header: "Orders in", align: "right", kind: "number", sortValue: m => m.receivedCount, cell: m => n(m.receivedCount) },
    { key: "sold", header: "Shipped", align: "right", kind: "number", sortValue: m => m.soldCount, cell: m => n(m.soldCount) },
    { key: "sales", header: "Sales", align: "right", kind: "number", sortValue: m => m.salesUsd, cell: m => (m.salesUsd ? <CellAmount>{usd(m.salesUsd)}</CellAmount> : "—") },
    { key: "collected", header: "Collected", align: "right", kind: "number", sortValue: m => m.collectedUsd,
      cell: m => <span className="tabular-nums whitespace-nowrap">{m.collectedUsd ? usd(m.collectedUsd) : "—"}</span> },
    ...(withProfit ? [
      { key: "cost", header: "Cost", align: "right" as const, kind: "number" as const, sortValue: (m: MonthRow) => m.costUsd,
        cell: (m: MonthRow) => <span className="tabular-nums whitespace-nowrap">{m.costUsd ? usd(m.costUsd) : "—"}</span> },
      { key: "profit", header: "Profit", align: "right" as const, kind: "number" as const, sortValue: (m: MonthRow) => (m.soldCount ? m.profitUsd : null),
        cell: (m: MonthRow) => <CellAmount tone={(m.profitUsd ?? 0) < 0 ? "out" : "in"}>{m.profitUsd != null && m.soldCount ? usd(m.profitUsd) : "—"}</CellAmount> },
      { key: "margin", header: "Margin", align: "right" as const, kind: "number" as const, sortValue: (m: MonthRow) => (m.soldCount ? m.marginPct : null),
        cell: (m: MonthRow) => <span className="tabular-nums whitespace-nowrap">{m.soldCount ? pct(m.marginPct) : "—"}</span> },
    ] : []),
    { key: "running", header: "Running total", align: "right", kind: "number", sortValue: m => cumulative.get(m.month) ?? 0,
      cell: m => <span className="text-muted-foreground tabular-nums whitespace-nowrap">{usd(cumulative.get(m.month) ?? 0, true)}</span> },
  ];
  /** Profit by client and by item read the same; only the first column differs. */
  const groupColumns = (header: string, first: (g: ProfitGroup) => ReactNode): DataColumn<ProfitGroup>[] => [
    { key: "name", header, always: true, sortValue: g => g.key, cell: first },
    { key: "pcs", header: "Pcs", align: "right", kind: "number", sortValue: g => g.count, cell: g => <span className="tabular-nums">{g.count}</span> },
    { key: "sales", header: "Sales", align: "right", kind: "number", sortValue: g => g.sellingUsd, cell: g => <span className="tabular-nums whitespace-nowrap">{usd(g.sellingUsd)}</span> },
    { key: "profit", header: "Profit", align: "right", kind: "number", sortValue: g => g.profitUsd,
      cell: g => <CellAmount tone={(g.profitUsd ?? 0) < 0 ? "out" : "in"}>{usd(g.profitUsd)}</CellAmount> },
    { key: "margin", header: "Margin", align: "right", kind: "number", sortValue: g => g.marginPct, cell: g => <span className="tabular-nums">{pct(g.marginPct)}</span> },
  ];
  const lossColumns: DataColumn<ProfitRow>[] = [
    { key: "order", header: "Order", always: true, sortValue: r => r.order.orderNumber,
      cell: r => <Link to={`/orders/${r.order.id}`} className="font-mono text-primary hover:underline whitespace-nowrap">{r.order.orderNumber}</Link> },
    { key: "client", header: "Client", sortValue: r => clientName(r.order.clientId),
      cell: r => <span className="block truncate max-w-[180px]">{clientName(r.order.clientId) || "—"}</span> },
    { key: "sold", header: "Sold for", align: "right", kind: "number", sortValue: r => r.sellingUsd,
      cell: r => <span className="tabular-nums whitespace-nowrap">{usd(r.sellingUsd)}{r.sellingUsd <= 5 ? <span className="text-amber-600"> · price not set?</span> : null}</span> },
    { key: "cost", header: "Cost", align: "right", kind: "number", sortValue: r => r.costUsd, cell: r => <span className="tabular-nums whitespace-nowrap">{usd(r.costUsd)}</span> },
    // The biggest loss is the most negative figure, so it sorts low → high first.
    { key: "loss", header: "Loss", align: "right", kind: "number", sortFirst: "asc", sortValue: r => r.profitUsd, cell: r => <CellAmount tone="out">{usd(r.profitUsd)}</CellAmount> },
  ];

  // Opened rows: what each table's columns leave out.
  const monthDetails = (m: MonthRow): Detail[] => filled([
    m.receivedCount > 0 && { label: "Value of orders in", value: usd(m.receivedUsd) },
    m.soldCount > 0 && { label: "Average per piece shipped", value: usd(m.salesUsd / m.soldCount) },
  ]);
  const groupDetails = (showIncomplete: boolean) => (g: ProfitGroup): Detail[] => filled([
    { label: "Cost", value: g.costUsd != null ? usd(g.costUsd) : undefined },
    { label: "Cost in rupees", value: inr(g.costInr) },
    showIncomplete && g.incomplete > 0 && { label: "Not fully costed", value: <span className="text-amber-600">{g.incomplete} order{g.incomplete !== 1 ? "s" : ""}</span> },
  ]);
  const lossDetails = (r: ProfitRow): Detail[] => filled([
    { label: "Piece", value: [r.order.jewelleryType, r.order.metal, r.order.productKarats, `${r.order.quantity} pc${r.order.quantity !== 1 ? "s" : ""}`].filter(Boolean).join(" · ") },
    { label: "Sold on", value: fmtDate(saleDate(r.order)) },
    { label: "Margin", value: pct(r.marginPct) },
    { label: "Cost in rupees", value: inr(r.costInr) },
    !!r.fx && { label: "Rate used", value: `₹${r.fx.rate} to the $${r.fx.basis === "dated" ? "" : r.fx.basis === "earliest" ? " (the first rate on file)" : " (the one flat rate)"}` },
    r.missing.length > 0 && { label: "Cost not known yet", value: (
      <ul className="space-y-0.5">{r.missing.map((m, i) => <li key={i}>{m.label} — {m.reason}</li>)}</ul>
    ) },
  ]);

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
            <DataTable
              id="reports-sales-months"
              noun="month"
              rows={rows}
              columns={monthColumns}
              rowKey={m => m.month}
              details={monthDetails}
              defaultSort={{ key: "month", dir: "desc" }}
              totals={{
                in: ms => totOf(ms).receivedCount,
                sold: ms => totOf(ms).soldCount,
                sales: ms => usd(totOf(ms).salesUsd),
                collected: ms => usd(totOf(ms).collectedUsd),
                ...(withProfit ? {
                  cost: (ms: MonthRow[]) => usd(totOf(ms).costUsd),
                  profit: (ms: MonthRow[]) => usd(totOf(ms).profitUsd),
                  margin: (ms: MonthRow[]) => pct(marginOf(ms)),
                } : {}),
              }}
            />
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
            <DataTable
              id="reports-sales-profit-client"
              noun="client"
              rows={data.pr.byClient}
              columns={groupColumns("Client", g => (
                <CellMain className="max-w-[180px]" title={g.key}
                  sub={g.incomplete ? <span className="text-amber-600">{g.incomplete} not fully costed</span> : undefined} />
              ))}
              rowKey={g => g.key}
              details={groupDetails(false)}
              defaultSort={{ key: "sales", dir: "desc" }}
              searchText={g => g.key}
              searchPlaceholder="Search clients"
            />
          </Panel>
          <Panel title="Profit by item" subtitle="Which pieces earn the most" icon={Layers}>
            <DataTable
              id="reports-sales-profit-item"
              noun="item"
              rows={data.pr.byType}
              columns={groupColumns("Item", g => <CellMain title={g.key} />)}
              rowKey={g => g.key}
              details={groupDetails(true)}
              defaultSort={{ key: "sales", dir: "desc" }}
              searchText={g => g.key}
              searchPlaceholder="Search items"
            />
          </Panel>
          {data.pr.losses.length > 0 && (
            <Panel title={`Sold at a loss (${data.pr.losses.length})`} subtitle="Check the price or the cost on these first" icon={TrendingDown} className="lg:col-span-2">
              {/* Every loss, a page at a time — the worst first. */}
              <DataTable
                id="reports-sales-losses"
                noun="order"
                rows={data.pr.losses}
                columns={lossColumns}
                rowKey={r => r.order.id}
                rowHref={r => `/orders/${r.order.id}`}
                details={lossDetails}
                defaultSort={{ key: "loss", dir: "asc" }}
                searchText={r => `${r.order.orderNumber} ${clientName(r.order.clientId)}`}
                searchPlaceholder="Search orders"
              />
            </Panel>
          )}
        </div>
      )}
    </div>
  );
}
