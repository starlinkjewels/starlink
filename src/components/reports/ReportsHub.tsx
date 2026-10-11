import { companiesOf, companyById, companyIdOfClient, hasCompanies } from "@/lib/companies";
import { useMemo, useState } from "react";
import { Building2, BarChart3, CalendarDays, Factory, LayoutDashboard, ListOrdered, ShoppingCart, TrendingUp, Users, UserCog, X } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { useDb, useDbVersion } from "@/hooks/useDb";
import { currentUserOrders, costDataReady } from "@/lib/db";
import { PRESETS, presetPeriod, presetOf, previousPeriod, periodLabel, type Period, type PresetKey } from "@/lib/analytics";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ReportSections } from "./ReportSections";
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
  const emp = isAdmin && employeeId !== "all" ? db.users.find(u => u.id === employeeId) : undefined;
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
  const orders = useMemo(
    () => allOrders.filter(o => (clientId === "all" || o.clientId === clientId) && (!empScope || empScope(o))
      && (companyId === "all" || coClients.has(o.clientId))),
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
    version,
    fileTag: [period.from || "start", period.to || "today"].join("_to_")
      + (clientId !== "all" ? `_${(db.clients.find(c => c.id === clientId)?.companyName ?? "client").replace(/\W+/g, "-")}` : "")
      + (emp ? `_${emp.name.replace(/\W+/g, "-")}` : ""),
  };
  const preset = presetOf(period);
  const combinedScope = empScope || companyId !== "all"
    ? (o: { assignedEmployeeId?: string; clientId: string }) => (!empScope || empScope(o)) && (companyId === "all" || coClients.has(o.clientId))
    : undefined;
  const clients = [...db.clients]
    .filter(c => companyId === "all" || coClients.has(c.id))
    .filter(c => !emp || empClients.has(c.id) || allOrders.some(o => o.clientId === c.id && empScope?.(o)))
    .sort((a, b) => a.companyName.localeCompare(b.companyName));
  const staff = db.users.filter(u => (u.role === "employee" || u.role === "admin") && u.status !== "inactive").sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div className="max-w-7xl mx-auto space-y-4">
      <div>
        <h1 className="font-display text-2xl sm:text-3xl text-brand-dark leading-tight">Reports &amp; Analytics</h1>
        <p className="text-xs sm:text-sm text-muted-foreground mt-0.5">
          {periodLabel(period)}{ctx.prev ? ` · compared with ${periodLabel(ctx.prev)}` : ""}
          {clientId !== "all" ? ` · ${db.clients.find(c => c.id === clientId)?.companyName}` : ""}
          {emp ? ` · ${emp.name}'s work` : ""}
          {companyId !== "all" ? ` · ${companyById(db.settings, companyId).name}` : ""}
        </p>
      </div>

      {/* One filter for every tab */}
      <div className="card-luxe p-3 sm:p-4 space-y-3 sm:sticky sm:top-0 z-20">
        <div className="flex flex-wrap items-center gap-2">
          <div className="w-full sm:w-48">
            <Select value={preset ?? "custom"} onValueChange={v => { if (v !== "custom") setPeriod(presetPeriod(v as PresetKey)); }}>
              <SelectTrigger className="h-9 rounded-lg text-xs font-medium" aria-label="Period"><CalendarDays className="h-4 w-4 text-primary shrink-0 mr-1" /><SelectValue /></SelectTrigger>
              <SelectContent className="max-h-80">
                {PRESETS.map(p => <SelectItem key={p.key} value={p.key}>{p.label}</SelectItem>)}
                <SelectItem value="custom" disabled={preset !== null}>Custom range</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-1.5">
            <input type="date" value={period.from} max={period.to || undefined} onChange={e => setPeriod({ ...period, from: e.target.value })}
              aria-label="From date" className="h-9 rounded-lg border border-border bg-white px-2 text-xs focus:outline-none focus:ring-2 focus:ring-primary/30" />
            <span className="text-muted-foreground text-xs">to</span>
            <input type="date" value={period.to} min={period.from || undefined} onChange={e => setPeriod({ ...period, to: e.target.value })}
              aria-label="To date" className="h-9 rounded-lg border border-border bg-white px-2 text-xs focus:outline-none focus:ring-2 focus:ring-primary/30" />
          </div>
          {multiCo && (
            <div className="w-full sm:w-48 sm:ml-auto">
              <Select value={companyId} onValueChange={setCompanyId}>
                <SelectTrigger className="h-9 rounded-lg text-xs" aria-label="Company"><Building2 className="h-4 w-4 text-primary shrink-0 mr-1" /><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All companies</SelectItem>
                  {companiesOf(db.settings).map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}
          {isAdmin && (
            <div className={`w-full sm:w-52 ${multiCo ? "" : "sm:ml-auto"} flex items-center gap-1.5`}>
              <Select value={employeeId} onValueChange={setEmployeeId}>
                <SelectTrigger className="h-9 rounded-lg text-xs" aria-label="Employee"><UserCog className="h-4 w-4 text-primary shrink-0 mr-1" /><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Whole team</SelectItem>
                  {staff.map(u => <SelectItem key={u.id} value={u.id}>{u.name}{u.role === "admin" ? " (admin)" : ""}</SelectItem>)}
                </SelectContent>
              </Select>
              {employeeId !== "all" && (
                <button type="button" onClick={() => setEmployeeId("all")} title="Whole team" className="h-9 w-9 grid place-items-center rounded-lg border border-border bg-white text-muted-foreground hover:text-destructive shrink-0">
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          )}
          <div className={`w-full sm:w-56 ${isAdmin ? "" : "sm:ml-auto"} flex items-center gap-1.5`}>
            <Select value={clientId} onValueChange={setClientId}>
              <SelectTrigger className="h-9 rounded-lg text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All clients</SelectItem>
                {clients.map(c => <SelectItem key={c.id} value={c.id}>{c.companyName}</SelectItem>)}
              </SelectContent>
            </Select>
            {clientId !== "all" && (
              <button type="button" onClick={() => setClientId("all")} title="All clients" className="h-9 w-9 grid place-items-center rounded-lg border border-border bg-white text-muted-foreground hover:text-destructive shrink-0">
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 overflow-x-auto -mx-1 px-1 pb-1">
        {tabs.map(t => {
          const on = t.key === activeTab;
          return (
            <button key={t.key} type="button" onClick={() => setTab(t.key)}
              className={`inline-flex items-center gap-1.5 h-9 px-3.5 rounded-xl text-xs sm:text-sm font-medium whitespace-nowrap transition-colors shrink-0 ${on ? "bg-primary text-white shadow-sm" : "text-muted-foreground hover:bg-secondary/70 hover:text-foreground"}`}>
              <t.icon className="h-4 w-4" />{t.label}
            </button>
          );
        })}
      </div>

      {activeTab === "overview" && <OverviewTab ctx={ctx} goTo={setTab} />}
      {activeTab === "sales" && (
        <>
          <SalesTab ctx={ctx} />
          {emp && isAdmin && (
            <p className="text-[11px] text-muted-foreground px-1">
              The company Profit &amp; Loss — running costs, exchange differences, net profit — is for the whole business, so it is not shown for one person. Their profit by client and by item is above.
            </p>
          )}
          <ReportSections embedded show={emp ? ["sales"] : ["sales", "profit"]} period={period} clientId={clientId === "all" ? undefined : clientId} scope={combinedScope} scopeKey={`${emp?.id ?? ""}|${companyId}`} />
        </>
      )}
      {activeTab === "clients" && <ClientsTab ctx={ctx} />}
      {activeTab === "team" && isAdmin && <TeamTab ctx={ctx} />}
      {activeTab === "production" && (
        <>
          <ProductionTab ctx={ctx} />
          <ReportSections embedded show={["speed", "stages"]} period={period} clientId={clientId === "all" ? undefined : clientId} scope={combinedScope} scopeKey={`${emp?.id ?? ""}|${companyId}`} />
        </>
      )}
      {activeTab === "purchases" && (
        <>
          <PurchasesTab ctx={ctx} />
          <ReportSections embedded show={["purchases", "payments"]} period={period} clientId={clientId === "all" ? undefined : clientId} scope={combinedScope} scopeKey={`${emp?.id ?? ""}|${companyId}`} />
        </>
      )}
      {activeTab === "orders" && (
        <ReportSections embedded show={["orders"]} period={period} clientId={clientId === "all" ? undefined : clientId} scope={combinedScope} scopeKey={`${emp?.id ?? ""}|${companyId}`} />
      )}
    </div>
  );
}
