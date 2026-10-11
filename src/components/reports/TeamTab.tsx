import { useMemo } from "react";
import { Link } from "react-router-dom";
import { ResponsiveContainer, BarChart, Bar as RBar, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from "recharts";
import { UserCog, Trophy } from "lucide-react";
import { downloadCsv } from "@/lib/ledgerExport";
import { teamTable } from "@/lib/analytics";
import { C, Panel, ChartTip, Bar, ExportButton, Table, Empty, usd, inr, pct, num } from "./ui";
import type { ReportCtx } from "./context";

/**
 * Each team member's work in the period. An order is theirs when it is
 * assigned to them or belongs to a client they manage — the same rule that
 * lets them move it. Admin only.
 */
export function TeamTab({ ctx }: { ctx: ReportCtx }) {
  const { db, orders, period, withProfit, version, fileTag } = ctx;
  const rows = useMemo(
    () => teamTable(db, orders, period, withProfit).sort((a, b) => b.salesUsd - a.salesUsd || b.received - a.received),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [db, orders, period.from, period.to, withProfit, version],
  );
  const active = rows.filter(r => r.received || r.sold || r.collectedUsd || r.tasksDone || r.tasksOpen || r.open || r.expensesInr);
  const maxSales = Math.max(0, ...active.map(r => r.salesUsd));
  const best = active.find(r => r.salesUsd > 0);

  const exportTeam = () => downloadCsv(`Team_${fileTag}.csv`,
    ["Name", "Role", "Clients managed", "Orders in", "Shipped", "Sales ($)", ...(withProfit ? ["Profit ($)"] : []), "Collected ($)", "Expenses (₹)", "Open orders", "Avg days to dispatch", "On-time %", "Tasks done", "Tasks open"],
    active.map(r => [r.name, r.role, r.clients, r.received, r.sold, r.salesUsd, ...(withProfit ? [r.profitUsd ?? ""] : []), r.collectedUsd, r.expensesInr, r.open, r.avgCycleDays ?? "", r.onTimePct ?? "", r.tasksDone, r.tasksOpen]));

  return (
    <div className="space-y-4">
      {best && (
        <div className="card-luxe p-4 flex items-center gap-3 bg-gradient-to-r from-amber-500/10 to-transparent">
          <span className="h-10 w-10 rounded-2xl bg-amber-500/15 text-amber-600 grid place-items-center shrink-0"><Trophy className="h-5 w-5" /></span>
          <p className="text-sm text-brand-dark"><span className="font-semibold">{best.name}</span> shipped the most in this period — {usd(best.salesUsd)} across {best.sold} piece{best.sold !== 1 ? "s" : ""}.</p>
        </div>
      )}

      <Panel title="Sales and money collected, by person" subtitle="Orders assigned to them or for clients they manage" icon={UserCog}>
        {active.some(r => r.salesUsd || r.collectedUsd) ? (
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={active} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="oklch(0.9 0.01 260)" />
                <XAxis dataKey="name" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} interval={0} />
                <YAxis tick={{ fontSize: 10 }} tickLine={false} axisLine={false} tickFormatter={v => usd(v, true)} width={56} />
                <Tooltip content={<ChartTip format={v => usd(v)} />} />
                <Legend wrapperStyle={{ fontSize: 11 }} iconType="circle" />
                <RBar dataKey="salesUsd" name="Sales" fill={C.primary} radius={[6, 6, 0, 0]} maxBarSize={36} />
                <RBar dataKey="collectedUsd" name="Collected" fill={C.gold} radius={[6, 6, 0, 0]} maxBarSize={36} />
                {withProfit && <RBar dataKey="profitUsd" name="Profit" fill={C.success} radius={[6, 6, 0, 0]} maxBarSize={36} />}
              </BarChart>
            </ResponsiveContainer>
          </div>
        ) : <Empty>No sales or collections by anyone in this period.</Empty>}
      </Panel>

      <Panel title="Team scorecard" subtitle="In the period · open orders and tasks as of today" icon={UserCog} actions={<ExportButton onClick={exportTeam} />}>
        <Table minWidth={withProfit ? 1000 : 900} head={
          <tr className="border-b border-border/60">
            <th className="text-left py-2">Person</th><th className="text-right px-2">Clients</th><th className="text-right px-2">In</th><th className="text-right px-2">Shipped</th>
            <th className="text-left px-2 w-40">Sales</th>{withProfit && <th className="text-right px-2">Profit</th>}
            <th className="text-right px-2">Collected</th><th className="text-right px-2">Expenses</th><th className="text-right px-2">Open</th>
            <th className="text-right px-2">Days to ship</th><th className="text-right px-2">On time</th><th className="text-right pl-2">Tasks</th>
          </tr>}>
          {active.map(r => (
            <tr key={r.id} className="hover:bg-secondary/40">
              <td className="py-2"><Link to={`/employees/${r.id}`} className="font-medium text-brand-dark hover:text-primary">{r.name}</Link><span className="block text-[10px] text-muted-foreground capitalize">{r.role}</span></td>
              <td className="text-right px-2">{r.clients || "—"}</td>
              <td className="text-right px-2">{r.received || "—"}</td>
              <td className="text-right px-2">{r.sold || "—"}</td>
              <td className="px-2"><div className="flex items-center gap-2"><span className="font-semibold w-16 text-right shrink-0">{r.salesUsd ? usd(r.salesUsd, true) : "—"}</span><div className="flex-1"><Bar value={r.salesUsd} max={maxSales} /></div></div></td>
              {withProfit && <td className={`text-right px-2 font-semibold ${(r.profitUsd ?? 0) < 0 ? "text-destructive" : "text-success"}`}>{r.sold ? usd(r.profitUsd, true) : "—"}</td>}
              <td className="text-right px-2">{r.collectedUsd ? usd(r.collectedUsd, true) : "—"}</td>
              <td className="text-right px-2">{r.expensesInr ? inr(r.expensesInr, true) : "—"}</td>
              <td className="text-right px-2">{r.open || "—"}</td>
              <td className="text-right px-2">{num(r.avgCycleDays, "d")}</td>
              <td className="text-right px-2">{pct(r.onTimePct)}</td>
              <td className="text-right pl-2">{r.tasksDone}<span className="text-muted-foreground"> done · {r.tasksOpen} open</span></td>
            </tr>
          ))}
        </Table>
        {!active.length && <Empty>No activity by anyone in this period.</Empty>}
        <p className="text-[11px] text-muted-foreground mt-3">
          Collected counts receipts each person recorded. An order counts for both the person it is assigned to and the client's account manager when they differ.
        </p>
      </Panel>
    </div>
  );
}
