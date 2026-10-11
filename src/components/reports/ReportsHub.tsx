import { useMemo, useState } from "react";
import { BarChart3, CalendarDays, Factory, LayoutDashboard, ListOrdered, ShoppingCart, TrendingUp, Users, UserCog, X } from "lucide-react";
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
  const orders = useMemo(() => (clientId === "all" ? allOrders : allOrders.filter(o => o.clientId === clientId)), [allOrders, clientId]);
  const ctx: ReportCtx = {
    db, orders, period, prev: previousPeriod(period),
    withProfit: isAdmin && costDataReady(), isAdmin,
    clientIds: clientId === "all" ? undefined : new Set([clientId]),
    version,
    fileTag: [period.from || "start", period.to || "today"].join("_to_") + (clientId !== "all" ? `_${(db.clients.find(c => c.id === clientId)?.companyName ?? "client").replace(/\W+/g, "-")}` : ""),
  };
  const preset = presetOf(period);
  const clients = [...db.clients].sort((a, b) => a.companyName.localeCompare(b.companyName));

  return (
    <div className="max-w-7xl mx-auto space-y-4">
      <div>
        <h1 className="font-display text-2xl sm:text-3xl text-brand-dark leading-tight">Reports &amp; Analytics</h1>
        <p className="text-xs sm:text-sm text-muted-foreground mt-0.5">
          {periodLabel(period)}{ctx.prev ? ` · compared with ${periodLabel(ctx.prev)}` : ""}
          {clientId !== "all" ? ` · ${db.clients.find(c => c.id === clientId)?.companyName}` : ""}
        </p>
      </div>

      {/* One filter for every tab */}
      <div className="card-luxe p-3 sm:p-4 space-y-3 sm:sticky sm:top-0 z-20">
        <div className="flex flex-wrap items-center gap-1.5">
          {PRESETS.map(p => (
            <button key={p.key} type="button" onClick={() => setPeriod(presetPeriod(p.key as PresetKey))}
              className={`h-8 px-3 rounded-lg text-xs font-medium border transition-colors ${preset === p.key ? "bg-primary text-white border-primary" : "bg-white border-border text-brand-dark hover:bg-secondary"}`}>
              {p.label}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1.5">
            <CalendarDays className="h-4 w-4 text-muted-foreground shrink-0" />
            <input type="date" value={period.from} max={period.to || undefined} onChange={e => setPeriod({ ...period, from: e.target.value })}
              aria-label="From date" className="h-9 rounded-lg border border-border bg-white px-2 text-xs focus:outline-none focus:ring-2 focus:ring-primary/30" />
            <span className="text-muted-foreground text-xs">to</span>
            <input type="date" value={period.to} min={period.from || undefined} onChange={e => setPeriod({ ...period, to: e.target.value })}
              aria-label="To date" className="h-9 rounded-lg border border-border bg-white px-2 text-xs focus:outline-none focus:ring-2 focus:ring-primary/30" />
          </div>
          <div className="w-full sm:w-56 sm:ml-auto flex items-center gap-1.5">
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
          <ReportSections embedded show={["sales", "profit"]} period={period} clientId={clientId === "all" ? undefined : clientId} />
        </>
      )}
      {activeTab === "clients" && <ClientsTab ctx={ctx} />}
      {activeTab === "team" && isAdmin && <TeamTab ctx={ctx} />}
      {activeTab === "production" && (
        <>
          <ProductionTab ctx={ctx} />
          <ReportSections embedded show={["speed", "stages"]} period={period} clientId={clientId === "all" ? undefined : clientId} />
        </>
      )}
      {activeTab === "purchases" && (
        <>
          <PurchasesTab ctx={ctx} />
          <ReportSections embedded show={["purchases", "payments"]} period={period} clientId={clientId === "all" ? undefined : clientId} />
        </>
      )}
      {activeTab === "orders" && (
        <ReportSections embedded show={["orders"]} period={period} clientId={clientId === "all" ? undefined : clientId} />
      )}
    </div>
  );
}
