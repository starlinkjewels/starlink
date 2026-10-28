import { companiesOf, companyById, companyIdOfClient, companyOfOrder, hasCompanies } from "@/lib/companies";
import type { Order } from "@/lib/db";
import { useMemo, useState } from "react";
import { BarChart3, Factory, LayoutDashboard, ListOrdered, ShoppingCart, TrendingUp, Users, UserCog } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { useDb, useDbVersion } from "@/hooks/useDb";
import { currentUserOrders, costDataReady } from "@/lib/db";
import { reachOf } from "@/lib/permissions";
import { presetPeriod, previousPeriod, periodLabel, type Period } from "@/lib/analytics";
import { PageHeader, TabBar } from "@/components/PageHeader";
import { FilterChips, FiltersButton, type TableFilter } from "@/components/TableToolbar";
import { ReportSections } from "./ReportSections";
import { PeriodPicker } from "./ui";
import { OverviewTab } from "./OverviewTab";
import { SalesTab } from "./SalesTab";
import { ClientsTab } from "./ClientsTab";
import { TeamTab } from "./TeamTab";
import { ProductionTab } from "./ProductionTab";
import { PurchasesTab } from "./PurchasesTab";
import type { ReportCtx } from "./context";

type TabKey = "overview" | "sales" | "clients" | "team" | "production" | "purchases" | "orders";

const read = <T,>(k: string, fallback: T): T => {
  try { const v = localStorage.getItem(k); return v ? (JSON.parse(v) as T) : fallback; } catch { return fallback; }
};
const write = (k: string, v: unknown) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private window */ } };

/**
 * Reports & analytics for the team. One date range and one client filter at
 * the top drive every tab; each figure is compared with the same length of
 * time just before. Profit, cost and margin are the admin's alone.
 */
export function ReportsHub() {
  const { user } = useAuth();
  const db = useDb();
  const version = useDbVersion();
  const isAdmin = user?.role === "admin";

  const [period, setPeriodRaw] = useState<Period>(() => read("reports-period", presetPeriod("last12")));
  const [clientId, setClientId] = useState("all");
  // Employee-wise analysis — the admin's. An employee's own Reports already
  // cover only their own work, so they have nothing to choose here.
  const [employeeId, setEmployeeId] = useState("all");
  // Which of our companies — shown once there is more than one.
  const [companyId, setCompanyId] = useState("all");
  const multiCo = hasCompanies(db.settings);
  const coClients = useMemo(() => new Set(companyId === "all" ? [] : db.clients.filter(c => companyIdOfClient(c) === companyId).map(c => c.id)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [companyId, version]);
  // An employee who works on their own clients reports on just those: their
  // clients, their orders and the money from them — never the whole client list.
  const own = !!user && !isAdmin && user.role !== "client" && reachOf(user, db.roles ?? []) !== "all";
  const emp = isAdmin
    ? (employeeId !== "all" ? db.users.find(u => u.id === employeeId) : undefined)
    : own ? db.users.find(u => u.id === user!.id) ?? ({ id: user!.id, name: user!.name } as (typeof db.users)[number]) : undefined;
  const [tab, setTabRaw] = useState<TabKey>(() => read("reports-tab", "overview"));
  const setPeriod = (p: Period) => { setPeriodRaw(p); write("reports-period", p); };
  const setTab = (t: TabKey) => { setTabRaw(t); write("reports-tab", t); };

  const tabs: { key: TabKey; label: string; icon: typeof BarChart3; show: boolean }[] = [
    { key: "overview", label: "Overview", icon: LayoutDashboard, show: true },
    { key: "sales", label: isAdmin ? "Sales & Profit" : "Sales", icon: TrendingUp, show: true },
    { key: "clients", label: "Clients", icon: Users, show: true },
    { key: "team", label: "Team", icon: UserCog, show: isAdmin },
    { key: "production", label: "Production", icon: Factory, show: true },
    { key: "purchases", label: "Purchases & Payments", icon: ShoppingCart, show: true },
    { key: "orders", label: "Orders", icon: ListOrdered, show: true },
  ].filter(t => t.show) as never;
  const activeTab = tabs.some(t => t.key === tab) ? tab : "overview";

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const allOrders = useMemo(() => currentUserOrders(db, user!), [db, user, version]);
  // An employee's work: orders assigned to them, or for clients they manage —
  // the same rule as everywhere else in the app.
  const empClients = useMemo(() => new Set(emp ? db.clients.filter(c => c.accountManagerId === emp.id).map(c => c.id) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [emp?.id, version]);
  const empScope = emp ? (o: { assignedEmployeeId?: string; clientId: string }) => o.assignedEmployeeId === emp.id || empClients.has(o.clientId) : undefined;
  // An order is its company's — fixed when it was placed, in-house builds included.
  const orders = useMemo(
    () => allOrders.filter(o => (clientId === "all" || o.clientId === clientId) && (!empScope || empScope(o))
      && (companyId === "all" || companyOfOrder(db, o) === companyId)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [allOrders, clientId, emp?.id, empClients, companyId, coClients],
  );
  // Whose money counts: the chosen client, or every client this employee looks after.
  const scopeClients = useMemo(() => {
    if (clientId !== "all") return new Set([clientId]);
    if (!emp && companyId === "all") return undefined;
    let ids = emp ? new Set([...empClients, ...orders.map(o => o.clientId)]) : new Set(db.clients.map(c => c.id));
    if (companyId !== "all") ids = new Set([...ids].filter(id => coClients.has(id)));
    return ids;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId, emp?.id, empClients, orders, companyId, coClients]);
  const ctx: ReportCtx = {
    db, orders, period, prev: previousPeriod(period),
    withProfit: isAdmin && costDataReady(), isAdmin,
    clientIds: scopeClients,
    employeeId: emp?.id,
    companyId: companyId === "all" ? undefined : companyId,
    version,
    fileTag: [period.from || "start", period.to || "today"].join("_to_")
      + (clientId !== "all" ? `_${(db.clients.find(c => c.id === clientId)?.companyName ?? "client").replace(/\W+/g, "-")}` : "")
      + (emp && isAdmin ? `_${emp.name.replace(/\W+/g, "-")}` : ""),
  };
  const combinedScope = empScope || companyId !== "all"
    ? (o: Order) => (!empScope || empScope(o)) && (companyId === "all" || companyOfOrder(db, o) === companyId)
    : undefined;
  const clients = [...db.clients]
    .filter(c => companyId === "all" || coClients.has(c.id))
    .filter(c => !emp || empClients.has(c.id) || allOrders.some(o => o.clientId === c.id && empScope?.(o)))
    .sort((a, b) => a.companyName.localeCompare(b.companyName));
  const staff = db.users.filter(u => (u.role === "employee" || u.role === "admin") && u.status !== "inactive").sort((a, b) => a.name.localeCompare(b.name));
  // Company, person and client narrow every tab — behind one Filters button,
  // what is on shown as chips. The period stays in view: it is never "off".
  const clientOpts = clients.map(c => ({ value: c.id, label: c.companyName }));
  // A client chosen before the company or person changed still names itself.
  if (clientId !== "all" && !clientOpts.some(o => o.value === clientId)) clientOpts.push({ value: clientId, label: db.clients.find(c => c.id === clientId)?.companyName ?? "Client" });
  const filters: TableFilter[] = [
    ...(multiCo ? [{ kind: "select" as const, label: "Company", value: companyId === "all" ? "" : companyId, onChange: (v: string) => setCompanyId(v || "all"),
      allLabel: "All companies", options: companiesOf(db.settings).map(c => ({ value: c.id, label: c.name })) }] : []),
    ...(isAdmin ? [{ kind: "select" as const, label: "Employee", value: employeeId === "all" ? "" : employeeId, onChange: (v: string) => setEmployeeId(v || "all"),
      allLabel: "Whole team", options: staff.map(u => ({ value: u.id, label: `${u.name}${u.role === "admin" ? " (admin)" : ""}` })) }] : []),
    { kind: "select", label: "Client", value: clientId === "all" ? "" : clientId, onChange: v => setClientId(v || "all"), allLabel: "All clients", options: clientOpts },
  ];
  const clearFilters = () => { setCompanyId("all"); setEmployeeId("all"); setClientId("all"); };

  return (
    <div className="max-w-7xl mx-auto space-y-4">
      <PageHeader
        title="Reports & Analytics"
        subtitle={<>
          {periodLabel(period)}{ctx.prev ? ` · compared with ${periodLabel(ctx.prev)}` : ""}
          {clientId !== "all" ? ` · ${db.clients.find(c => c.id === clientId)?.companyName}` : ""}
          {emp && isAdmin ? ` · ${emp.name}'s work` : ""}
          {companyId !== "all" ? ` · ${companyById(db.settings, companyId).name}` : ""}
        </>}
      />

      {/* One filter row for every tab: the period (the same picker every report
          has), then Filters — one row on every screen. */}
      <div className="card-luxe p-2.5 sm:p-3 space-y-2.5 sm:sticky sm:top-0 z-20">
        <div className="flex items-center gap-2 min-w-0">
          <PeriodPicker value={period} onChange={setPeriod} />
          <FiltersButton filters={filters} onClear={clearFilters} />
        </div>
        <FilterChips filters={filters} onClear={clearFilters} />
      </div>

      <TabBar label="Reports" tabs={tabs} value={activeTab} onChange={setTab} />

      {activeTab === "overview" && <OverviewTab ctx={ctx} goTo={setTab} />}
      {activeTab === "sales" && (
        <>
          <SalesTab ctx={ctx} />
          {emp && isAdmin && (
            <p className="text-[11px] text-muted-foreground px-1">
              The company Profit &amp; Loss is for the whole business, so it isn&rsquo;t shown for one person.
            </p>
          )}
          <ReportSections embedded show={emp ? ["sales"] : ["sales", "profit"]} period={period} clientId={clientId === "all" ? undefined : clientId} scope={combinedScope} scopeKey={`${emp?.id ?? ""}|${companyId}`} companyId={companyId === "all" ? undefined : companyId} />
        </>
      )}
      {activeTab === "clients" && <ClientsTab ctx={ctx} />}
      {activeTab === "team" && isAdmin && <TeamTab ctx={ctx} />}
      {activeTab === "production" && (
        <>
          <ProductionTab ctx={ctx} />
          <ReportSections embedded show={["speed", "stages"]} period={period} clientId={clientId === "all" ? undefined : clientId} scope={combinedScope} scopeKey={`${emp?.id ?? ""}|${companyId}`} companyId={companyId === "all" ? undefined : companyId} />
        </>
      )}
      {activeTab === "purchases" && (
        <>
          <PurchasesTab ctx={ctx} />
          <ReportSections embedded show={["purchases", "payments"]} period={period} clientId={clientId === "all" ? undefined : clientId} scope={combinedScope} scopeKey={`${emp?.id ?? ""}|${companyId}`} companyId={companyId === "all" ? undefined : companyId} />
        </>
      )}
      {activeTab === "orders" && (
        <ReportSections embedded show={["orders"]} period={period} clientId={clientId === "all" ? undefined : clientId} scope={combinedScope} scopeKey={`${emp?.id ?? ""}|${companyId}`} companyId={companyId === "all" ? undefined : companyId} />
      )}
    </div>
  );
}
