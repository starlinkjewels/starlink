import { DataTable } from "@/components/DataTable";
import { filled, type Detail } from "@/components/rowDetails";
import { useMemo } from "react";
import { Link } from "react-router-dom";
import { ResponsiveContainer, BarChart, Bar as RBar, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from "recharts";
import { UserCog, Trophy } from "lucide-react";
import { downloadCsv } from "@/lib/ledgerExport";
import { teamTable, type TeamRow } from "@/lib/analytics";
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
  const active = rows.filter(r => (ctx.employeeId ? r.id === ctx.employeeId : (r.received || r.sold || r.collectedUsd || r.tasksDone || r.tasksOpen || r.open || r.expensesInr)));
  const maxSales = Math.max(0, ...active.map(r => r.salesUsd));
  const best = active.find(r => r.salesUsd > 0);

  // A person, opened: what the Expenses column leaves out, and how to reach them.
  const personDetails = (r: TeamRow): Detail[] => {
    const u = db.users.find(x => x.id === r.id);
    return filled([
      r.expensesUncounted > 0 && { label: "Expenses not counted", value: `${r.expensesUncounted} in a currency with no rate on file — add it in Settings → Exchange rates` },
      { label: "Department", value: u?.department },
      { label: "Email", value: u?.email },
      { label: "Phone", value: u?.phone },
    ]);
  };

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

      <Panel title="Sales and money collected, by person" subtitle="Their orders and clients" icon={UserCog}>
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
        ) : <Empty>Nothing in this period.</Empty>}
      </Panel>

      <Panel title="Team scorecard" subtitle="Results in the period · open work as of today" icon={UserCog} actions={<ExportButton onClick={exportTeam} />}>
        <DataTable
          id="reports-team"
          rows={active}
          rowKey={r => r.id}
          // A row is a person: it opens their page — the admin's alone, like the page.
          rowHref={ctx.isAdmin ? r => `/employees/${r.id}` : undefined}
          details={personDetails}
          defaultSort={{ key: "sales", dir: "desc" }}
          searchText={r => r.name}
          emptyText="No activity by anyone in this period."
          columns={[
            { key: "name", header: "Person", always: true, sortValue: r => r.name, cell: r => <><Link to={`/employees/${r.id}`} className="font-medium text-brand-dark hover:text-primary">{r.name}</Link><span className="block text-[10px] text-muted-foreground capitalize">{r.role}</span></> },
            { key: "clients", header: "Clients", align: "right", sortValue: r => r.clients, cell: r => r.clients || "—" },
            { key: "in", header: "Orders in", align: "right", sortValue: r => r.received, cell: r => r.received || "—" },
            { key: "sold", header: "Shipped", align: "right", sortValue: r => r.sold, cell: r => r.sold || "—" },
            { key: "sales", header: "Sales", sortValue: r => r.salesUsd, cell: r => (
              <div className="flex items-center gap-2 min-w-[150px]"><span className="font-semibold w-16 text-right shrink-0">{r.salesUsd ? usd(r.salesUsd, true) : "—"}</span><div className="flex-1"><Bar value={r.salesUsd} max={maxSales} /></div></div>
            ) },
            ...(withProfit ? [{ key: "profit", header: "Profit", align: "right" as const, sortValue: (r: TeamRow) => (r.sold ? r.profitUsd : null), cell: (r: TeamRow) => <span className={`font-semibold ${(r.profitUsd ?? 0) < 0 ? "text-destructive" : "text-success"}`}>{r.sold ? usd(r.profitUsd, true) : "—"}</span> }] : []),
            { key: "collected", header: "Collected", align: "right", sortValue: r => r.collectedUsd, cell: r => (r.collectedUsd ? usd(r.collectedUsd, true) : "—") },
            { key: "expenses", header: "Expenses", align: "right", sortValue: r => r.expensesInr, cell: r => (r.expensesInr ? inr(r.expensesInr, true) : "—") },
            { key: "open", header: "Open", align: "right", sortValue: r => r.open, cell: r => r.open || "—" },
            { key: "days", header: "Days to ship", align: "right", sortValue: r => r.avgCycleDays, cell: r => num(r.avgCycleDays, "d") },
            { key: "ontime", header: "On time", align: "right", sortValue: r => r.onTimePct, cell: r => pct(r.onTimePct) },
            { key: "tasks", header: "Tasks", align: "right", sortValue: r => r.tasksOpen, cell: r => <>{r.tasksDone}<span className="text-muted-foreground"> done · {r.tasksOpen} open</span></> },
          ]}
        />
        <p className="text-[11px] text-muted-foreground mt-3">
          Collected counts receipts each person recorded. An order counts for both the person it is assigned to and the client's account manager when they differ.
        </p>
      </Panel>
    </div>
  );
}
