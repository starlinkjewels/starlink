import { DataTable } from "@/components/DataTable";
import { filled, userName, type Detail } from "@/components/rowDetails";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ResponsiveContainer, BarChart, Bar as RBar, XAxis, YAxis, Tooltip, Cell } from "recharts";
import { Users, UserPlus, Repeat, HandCoins, AlertOctagon, Search, Table2, Hourglass } from "lucide-react";
import { downloadCsv } from "@/lib/ledgerExport";
import { clientTable, receivables, soldIn, localDay, type ClientRow } from "@/lib/analytics";
import { fmtDate } from "@/lib/db";
import { C, KpiCard, Panel, ChartTip, Bar, ExportButton, Table, Empty, usd, pct } from "./ui";
import type { ReportCtx } from "./context";


export function ClientsTab({ ctx }: { ctx: ReportCtx }) {
  const { db, orders, period, withProfit, version, fileTag } = ctx;

  const data = useMemo(() => {
    const rows = clientTable(db, orders, period, withProfit).filter(r => !ctx.clientIds || ctx.clientIds.has(r.id));
    const owed = receivables(orders);
    // First-ever order inside the period = a new client.
    const firstOrder = new Map<string, string>();
    for (const o of orders) {
      if (o.status === "Rejected" || o.forReadyStock) continue;
      const f = firstOrder.get(o.clientId);
      if (!f || o.createdAt < f) firstOrder.set(o.clientId, o.createdAt);
    }
    const isNew = (id: string) => {
      const f = firstOrder.get(id);
      if (!f) return false;
      const k = localDay(f);
      return (!period.from || k >= period.from) && (!period.to || k <= period.to);
    };
    const soldBy = new Map<string, number>();
    for (const o of soldIn(orders, period)) soldBy.set(o.clientId, (soldBy.get(o.clientId) ?? 0) + 1);
    return {
      rows, owed,
      active: rows.filter(r => r.sold > 0).length,
      newClients: rows.filter(r => isNew(r.id)).length,
      repeat: [...soldBy.values()].filter(n => n > 1).length,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db, orders, period.from, period.to, withProfit, version]);

  // Sorting and searching are the table's own; the export takes every client by sales.
  const list = [...data.rows].sort((a, b) => b.salesUsd - a.salesUsd || b.outstandingUsd - a.outstandingUsd);
  const maxSales = Math.max(0, ...list.map(r => r.salesUsd));
  const ageing = [
    { key: "0–30 days", value: data.owed.current, tone: C.success },
    { key: "31–60 days", value: data.owed.d30, tone: C.gold },
    { key: "61–90 days", value: data.owed.d60, tone: C.amber },
    { key: "90+ days", value: data.owed.d90, tone: C.rose },
  ];

  // A client, opened: the day of their last order, exact figures where the
  // columns round, how to reach them — and, for the admin, who handles them.
  const clientDetails = (r: ClientRow): Detail[] => {
    const c = db.clients.find(x => x.id === r.id);
    return filled([
      !!r.lastOrder && { label: "Last order on", value: fmtDate(r.lastOrder) },
      // The columns read $12.3k from $10,000 up.
      Math.abs(r.salesUsd) >= 1e4 && { label: "Sales (exact)", value: usd(r.salesUsd) },
      Math.abs(r.outstandingUsd) >= 1e4 && { label: "Owed (exact)", value: usd(r.outstandingUsd) },
      ctx.isAdmin && !!c && { label: "Handled by", value: userName(db, c.accountManagerId) || "Admin" },
      { label: "Phone", value: c?.phone },
      { label: "Email", value: c?.email },
    ]);
  };

  const exportClients = () => downloadCsv(`Clients_${fileTag}.csv`,
    ["Client", "Orders in", "Shipped", "Sales ($)", ...(withProfit ? ["Profit ($)", "Margin %"] : []), "Collected ($)", "Owed now ($)", "Owed 90+ days ($)", "Average order ($)", "Last order", "Days since last order"],
    list.map(r => [r.name, r.received, r.sold, r.salesUsd, ...(withProfit ? [r.profitUsd ?? "", r.marginPct ?? ""] : []), r.collectedUsd, r.outstandingUsd, r.overdue90Usd,
      r.avgOrderUsd ?? "", r.lastOrder ? fmtDate(r.lastOrder) : "", r.daysSinceLast ?? ""]));

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <KpiCard icon={Users} label="Clients who bought" value={data.active} sub="Shipped to in the period" />
        <KpiCard icon={UserPlus} label="New clients" value={data.newClients} sub="First order in the period" tone="sky" />
        <KpiCard icon={Repeat} label="Bought more than once" value={data.repeat} sub={data.active ? `${pct(Math.round((data.repeat / data.active) * 1000) / 10)} of buyers` : "—"} tone="success" />
        <KpiCard icon={HandCoins} label="Owed to us" value={usd(data.owed.total, true)} sub="Unpaid on shipped work" tone="gold" />
        <KpiCard icon={AlertOctagon} label="Owed over 90 days" value={usd(data.owed.d90, true)} sub={data.owed.total ? `${pct(Math.round((data.owed.d90 / data.owed.total) * 1000) / 10)} of what is owed` : "—"} tone="rose" />
      </div>

      <Panel title="Money owed, by how long" subtitle="From the day each piece was shipped — as of today" icon={Hourglass}>
        {data.owed.total > 0 ? (
          <div className="h-40">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={ageing} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
                <XAxis dataKey="key" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                <YAxis tick={{ fontSize: 10 }} tickLine={false} axisLine={false} tickFormatter={v => usd(v, true)} width={56} />
                <Tooltip content={<ChartTip format={v => usd(v)} />} />
                <RBar dataKey="value" name="Owed" radius={[6, 6, 0, 0]} maxBarSize={60}>
                  {ageing.map(a => <Cell key={a.key} fill={a.tone} />)}
                </RBar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        ) : <Empty>Nothing is owed on shipped work.</Empty>}
      </Panel>

      <Panel title="Every client" subtitle="Sales and margin in the period · money owed and last order as of today" icon={Table2}
        actions={<ExportButton onClick={exportClients} />}>
        <DataTable
          id="reports-clients"
          rows={list}
          rowKey={r => r.id}
          details={clientDetails}
          defaultSort={{ key: "sales", dir: "desc" }}
          searchText={r => r.name}
          emptyText="No clients."
          columns={[
            { key: "name", header: "Client", always: true, sortValue: r => r.name, cell: r => <Link to={`/clients/${r.id}`} className="font-medium text-brand-dark hover:text-primary truncate block max-w-[200px]">{r.name}</Link> },
            { key: "in", header: "Orders in", align: "right", sortValue: r => r.received, cell: r => r.received || "—" },
            { key: "sold", header: "Shipped", align: "right", sortValue: r => r.sold, cell: r => r.sold || "—" },
            { key: "sales", header: "Sales", sortValue: r => r.salesUsd, cell: r => (
              <div className="flex items-center gap-2 min-w-[150px]"><span className="font-semibold w-16 text-right shrink-0">{r.salesUsd ? usd(r.salesUsd, true) : "—"}</span><div className="flex-1"><Bar value={r.salesUsd} max={maxSales} /></div></div>
            ) },
            ...(withProfit ? [
              { key: "profit", header: "Profit", align: "right" as const, sortValue: (r: ClientRow) => (r.sold ? r.profitUsd : null), cell: (r: ClientRow) => <span className={`font-semibold ${(r.profitUsd ?? 0) < 0 ? "text-destructive" : "text-success"}`}>{r.sold ? usd(r.profitUsd, true) : "—"}</span> },
              { key: "margin", header: "Margin", align: "right" as const, sortValue: (r: ClientRow) => (r.sold ? r.marginPct : null), cell: (r: ClientRow) => (r.sold ? pct(r.marginPct) : "—") },
            ] : []),
            { key: "collected", header: "Collected", align: "right", sortValue: r => r.collectedUsd, cell: r => (r.collectedUsd ? usd(r.collectedUsd, true) : "—") },
            { key: "owed", header: "Owed", align: "right", sortValue: r => r.outstandingUsd, cell: r => <span className={r.overdue90Usd > 0 ? "text-destructive font-semibold" : ""} title={r.overdue90Usd ? `${usd(r.overdue90Usd)} over 90 days` : undefined}>{r.outstandingUsd ? usd(r.outstandingUsd, true) : "—"}</span> },
            { key: "owed90", header: "Owed 90+ days", align: "right", hidden: true, sortValue: r => r.overdue90Usd, cell: r => (r.overdue90Usd ? usd(r.overdue90Usd, true) : "—") },
            { key: "avg", header: "Avg order", align: "right", sortValue: r => r.avgOrderUsd, cell: r => usd(r.avgOrderUsd, true) },
            { key: "last", header: "Last order", align: "right", sortFirst: "asc", sortValue: r => r.daysSinceLast, cell: r => <span className={(r.daysSinceLast ?? 0) > 60 ? "text-amber-600" : "text-muted-foreground"}>{r.lastOrder ? `${r.daysSinceLast}d ago` : "never"}</span> },
          ]}
        />
      </Panel>
    </div>
  );
}
