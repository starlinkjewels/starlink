import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ResponsiveContainer, BarChart, Bar as RBar, XAxis, YAxis, Tooltip, Cell } from "recharts";
import { Users, UserPlus, Repeat, HandCoins, AlertOctagon, Search, Table2, Hourglass } from "lucide-react";
import { downloadCsv } from "@/lib/ledgerExport";
import { clientTable, receivables, soldIn, localDay, type ClientRow } from "@/lib/analytics";
import { fmtDate } from "@/lib/db";
import { C, KpiCard, Panel, ChartTip, Bar, ExportButton, Table, Empty, usd, pct } from "./ui";
import type { ReportCtx } from "./context";

type SortKey = "sales" | "owed" | "margin" | "last" | "name";

export function ClientsTab({ ctx }: { ctx: ReportCtx }) {
  const { db, orders, period, withProfit, version, fileTag } = ctx;
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<SortKey>("sales");

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

  const ql = q.trim().toLowerCase();
  const sorters: Record<SortKey, (a: ClientRow, b: ClientRow) => number> = {
    sales: (a, b) => b.salesUsd - a.salesUsd || b.outstandingUsd - a.outstandingUsd,
    owed: (a, b) => b.outstandingUsd - a.outstandingUsd,
    margin: (a, b) => (b.marginPct ?? -1e9) - (a.marginPct ?? -1e9),
    last: (a, b) => (a.daysSinceLast ?? 1e9) - (b.daysSinceLast ?? 1e9),
    name: (a, b) => a.name.localeCompare(b.name),
  };
  const list = data.rows.filter(r => !ql || r.name.toLowerCase().includes(ql)).sort(sorters[sort]);
  const maxSales = Math.max(0, ...list.map(r => r.salesUsd));
  const ageing = [
    { key: "0–30 days", value: data.owed.current, tone: C.success },
    { key: "31–60 days", value: data.owed.d30, tone: C.gold },
    { key: "61–90 days", value: data.owed.d60, tone: C.amber },
    { key: "90+ days", value: data.owed.d90, tone: C.rose },
  ];

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
        <div className="flex flex-wrap items-center gap-2 mb-3">
          <div className="relative flex-1 min-w-[180px]">
            <Search className="h-3.5 w-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search clients" className="h-8 w-full rounded-lg border border-border bg-white pl-8 pr-2 text-xs focus:outline-none focus:ring-2 focus:ring-primary/30" />
          </div>
          <div className="inline-flex gap-0.5 p-0.5 rounded-lg bg-secondary text-[11px]">
            {([["sales", "Sales"], ["owed", "Owed"], ...(withProfit ? [["margin", "Margin"]] : []), ["last", "Recent"], ["name", "A–Z"]] as [SortKey, string][]).map(([k, l]) => (
              <button key={k} type="button" onClick={() => setSort(k)} className={`h-7 px-2.5 rounded-md font-medium ${sort === k ? "bg-white shadow-soft text-brand-dark" : "text-muted-foreground"}`}>{l}</button>
            ))}
          </div>
        </div>
        <Table minWidth={withProfit ? 900 : 760} head={
          <tr className="border-b border-border/60">
            <th className="text-left py-2">Client</th><th className="text-right px-2">In</th><th className="text-right px-2">Shipped</th>
            <th className="text-left px-2 w-40">Sales</th>
            {withProfit && <><th className="text-right px-2">Profit</th><th className="text-right px-2">Margin</th></>}
            <th className="text-right px-2">Collected</th><th className="text-right px-2">Owed</th><th className="text-right px-2">Avg order</th><th className="text-right pl-2">Last order</th>
          </tr>}>
          {list.map(r => (
            <tr key={r.id} className="hover:bg-secondary/40">
              <td className="py-2 max-w-[200px]"><Link to={`/clients/${r.id}`} className="font-medium text-brand-dark hover:text-primary truncate block">{r.name}</Link></td>
              <td className="text-right px-2">{r.received || "—"}</td>
              <td className="text-right px-2">{r.sold || "—"}</td>
              <td className="px-2"><div className="flex items-center gap-2"><span className="font-semibold w-16 text-right shrink-0">{r.salesUsd ? usd(r.salesUsd, true) : "—"}</span><div className="flex-1"><Bar value={r.salesUsd} max={maxSales} /></div></div></td>
              {withProfit && <>
                <td className={`text-right px-2 font-semibold ${(r.profitUsd ?? 0) < 0 ? "text-destructive" : "text-success"}`}>{r.sold ? usd(r.profitUsd, true) : "—"}</td>
                <td className="text-right px-2">{r.sold ? pct(r.marginPct) : "—"}</td>
              </>}
              <td className="text-right px-2">{r.collectedUsd ? usd(r.collectedUsd, true) : "—"}</td>
              <td className={`text-right px-2 ${r.overdue90Usd > 0 ? "text-destructive font-semibold" : ""}`} title={r.overdue90Usd ? `${usd(r.overdue90Usd)} over 90 days` : undefined}>{r.outstandingUsd ? usd(r.outstandingUsd, true) : "—"}</td>
              <td className="text-right px-2">{usd(r.avgOrderUsd, true)}</td>
              <td className={`text-right pl-2 ${(r.daysSinceLast ?? 0) > 60 ? "text-amber-600" : "text-muted-foreground"}`}>{r.lastOrder ? `${r.daysSinceLast}d ago` : "never"}</td>
            </tr>
          ))}
        </Table>
        {!list.length && <Empty>No client matches.</Empty>}
      </Panel>
    </div>
  );
}
