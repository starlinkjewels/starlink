import { expensesInUsd, inrOn } from "@/lib/orderCost";
import { SectionTitle } from "@/components/SectionTitle";
import { PageHeader } from "@/components/PageHeader";
import { factoryFigures, supplierFigures, lockerFigure } from "@/lib/partyTotals";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useAuth } from "@/lib/auth";
import { loadDb, fmtMoney, fmtDate, currentUserOrders, orderTotal, balanceDue, totalAdvance, giftCardStats, keptValue } from "@/lib/db";
import { useDb } from "@/hooks/useDb";
import { motion } from "framer-motion";
import { Package, Clock, CheckCircle2, Users, Briefcase, DollarSign, Factory, PackageCheck, TrendingUp, ArrowRight, Truck, Wallet, TrendingDown, Receipt, BadgeCheck, ClipboardCheck, Coins, Gem, Gift, AlertCircle, type LucideIcon } from "lucide-react";
import { Link } from "react-router-dom";
import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, LineChart, Line, Tooltip, PieChart, Pie, Cell } from "recharts";
import { StatusBadge } from "@/components/StatusBadge";
import { PushPermissionBanner } from "@/components/PushPermissionBanner";
import type { Order } from "@/lib/db";
import { fmtMoneyInr } from "@/lib/manufacturing";
import { ccy, ccyOrder, fmtCcy, fmtCcyMix, fmtRate, rateText, sumByCcy, tableRate } from "@/lib/currency";
import { subscribeStockLevelsByCompany, sumStockLevels, type StockLevels } from "@/lib/stock";
import { companiesOf } from "@/lib/companies";

type Tone = "in" | "out" | "warn" | "muted";
const TONE: Record<Tone, string> = { in: "text-success", out: "text-destructive", warn: "text-amber-700", muted: "text-muted-foreground" };

/**
 * One figure on the dashboard, the same card for every one: a quiet label,
 * the figure in tabular digits sized to fit (never cut), colour on the figure
 * only. Opens what it counts when it has somewhere to go.
 */
function Kpi({ label, value, icon: Icon, tone, sub, to }: {
  label: string; value: ReactNode; icon?: LucideIcon; tone?: Tone; sub?: ReactNode; to?: string;
}) {
  const body = (
    <div className="@container h-full min-w-0 rounded-2xl border border-border/70 bg-white px-4 py-3.5 shadow-[0_1px_2px_rgb(15_23_42/0.04)]">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-medium text-muted-foreground truncate" title={label}>{label}</p>
        {Icon && <Icon className="h-4 w-4 shrink-0 text-muted-foreground/60" />}
      </div>
      <p className={`mt-1.5 text-[clamp(1rem,12cqi,1.5rem)] font-semibold tracking-tight tabular-nums leading-tight whitespace-nowrap ${tone ? TONE[tone] : "text-brand-dark"}`}>{value}</p>
      {sub && <p className="mt-0.5 text-[11px] text-muted-foreground truncate">{sub}</p>}
    </div>
  );
  return to
    ? <Link to={to} className="block h-full rounded-2xl transition-shadow hover:shadow-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30">{body}</Link>
    : body;
}

/** Most recent tracking step: whichever step is in progress, else the last completed one, else the first step. */
function lastTrackingStep(o: Order): string {
  const inProgress = o.timeline.find(t => t.status === "in_progress");
  if (inProgress) return inProgress.step;
  const done = o.timeline.filter(t => t.status === "done");
  if (done.length) return done[done.length - 1].step;
  return o.timeline[0]?.step ?? "";
}

export function Dashboard() {
  const { user } = useAuth();
  const db = useDb();
  const orders = useMemo(() => currentUserOrders(db, user!), [db, user]);

  const [stockLevels, setStockLevels] = useState<StockLevels | null>(null);
  // Stock levels are staff-only; a client's dashboard does not ask for them.
  const isStaffUser = user?.role === "admin" || user?.role === "employee";
  // Every company's stock together — each company keeps its own counter.
  const coIds = companiesOf(db.settings).map(c => c.id).join(",");
  useEffect(() => (isStaffUser ? subscribeStockLevelsByCompany(coIds.split(","), by => setStockLevels(sumStockLevels(Object.values(by)))) : undefined), [isStaffUser, coIds]);
  const ordersInProduction = db.orders.filter(o => o.status === "In Production").length;
  const goldReserveGrams = Object.values(stockLevels?.gold ?? {}).reduce((s, g) => s + g, 0);
  const diamondReserveCarats = Object.values(stockLevels?.diamond ?? {}).reduce((s, c) => s + c, 0);
  // Summed per-entity so each one's migration opening balance is included.
  // From the records when they are loaded, else the server's totals — the
  // Dashboard is light (pageData.ts) and does not download the books for these.
  const makingChargesPending = db.factories.reduce((s, f) => s + factoryFigures(db, f).chargesPending, 0);
  // The NET, floored at zero, which is what the Suppliers page totals. Using
  // balanceOwed counted every unpaid bill in full and ignored advances,
  // overpayments and refunds, so the two pages disagreed on the same figure.
  const supplierPaymentsPending = db.suppliers.reduce((s, sup) => s + Math.max(0, supplierFigures(db, sup).net), 0);

  // Cash Position & Profit — every payment in/out (client payments, supplier/
  // factory payments, expenses) that was tagged to a Locker rolls up here.
  // "Profit" = net flow only (income − expense; transfers cancel out across
  // the group), excluding each locker's opening balance (pre-existing capital,
  // not earned).
  const [inrPerUsd, setInrPerUsd] = useState("");
  const activeLockers = db.lockers.filter(l => l.active !== false);
  const usdLockers = activeLockers.filter(l => ccy(l.currency) === "USD");
  const inrLockers = activeLockers.filter(l => ccy(l.currency) === "INR");
  const usdProfit = usdLockers.reduce((s, l) => s + (lockerFigure(db, l) - (l.openingBalance || 0)), 0);
  const inrProfit = inrLockers.reduce((s, l) => s + (lockerFigure(db, l) - (l.openingBalance || 0)), 0);
  // Lockers in any other currency (AUD, EUR, AED…) — each currency its own
  // figure, in that currency; they used to be left out altogether.
  const otherLockers = activeLockers.filter(l => !["INR", "USD"].includes(ccy(l.currency)));
  const otherProfit = sumByCcy(otherLockers, l => lockerFigure(db, l) - (l.openingBalance || 0), l => l.currency);
  const otherCodes = [...otherProfit.keys()].sort(ccyOrder);
  // One combined figure: every currency into rupees at Settings → Exchange
  // rates. Dollars at the rate typed here when there is one, else that table's.
  const settingsUsd = tableRate(db.settings.currencyRates, "USD", "INR");
  const rate = Number(inrPerUsd) > 0 ? Number(inrPerUsd) : settingsUsd ?? 0;
  const otherInr = otherCodes.map(c => ({ c, perUnit: tableRate(db.settings.currencyRates, c, "INR") }));
  // A currency with nothing in it changes no total, so only one that holds
  // something and has no rate is named as left out.
  const leftOut = otherInr.filter(x => !x.perUnit && Math.abs(otherProfit.get(x.c) ?? 0) > 0.005).map(x => x.c);
  const otherAsInr = otherInr.reduce((s, x) => s + (x.perUnit ? (otherProfit.get(x.c) ?? 0) * x.perUnit : 0), 0);
  const combinedUsd = rate > 0 ? usdProfit + (inrProfit + otherAsInr) / rate : null;
  const combinedInr = rate > 0 ? usdProfit * rate + inrProfit + otherAsInr : null;

  const today = new Date().toDateString();
  const todayOrders = orders.filter(o => new Date(o.createdAt).toDateString() === today).length;
  const forApproval = orders.filter(o => o.status === "Waiting").length;
  const pending = orders.filter(o => o.status === "Waiting" || o.status === "Approved").length;
  const inProd = orders.filter(o => o.status === "In Production").length;
  const ready = orders.filter(o => o.status === "Ready" || o.status === "Dispatched").length;
  const completed = orders.filter(o => o.status === "Delivered").length;
  // Revenue = money actually collected to date (sum of all payments/advances),
  // not just the value of delivered orders — so collected advances show up too.
  const revenue = orders.reduce((s, o) => s + totalAdvance(o), 0);
  const gc = giftCardStats(db.giftCards ?? [], db.orders); // all-time gift-card totals (staff)

  const monthlyData = useMemo(() => {
    const months = Array.from({ length: 6 }, (_, i) => {
      const d = new Date(); d.setMonth(d.getMonth() - (5 - i));
      return { m: d.toLocaleDateString("en-IN", { month: "short" }).replace(/\bSept\b/, "Sep"), y: d.getFullYear(), month: d.getMonth() };
    });
    return months.map(({ m, y, month }) => ({
      name: m,
      orders: orders.filter(o => { const d = new Date(o.createdAt); return d.getMonth() === month && d.getFullYear() === y; }).length,
      revenue: orders.filter(o => { const d = new Date(o.createdAt); return d.getMonth() === month && d.getFullYear() === y; }).reduce((s, o) => s + keptValue(o), 0),
    }));
  }, [orders]);

  // Every order status shown (not just a few) so the chart reflects all orders.
  const statusData = [
    { name: "Waiting",       color: "oklch(0.78 0.16 70)" },
    { name: "Approved",      color: "oklch(0.58 0.035 78)" },
    { name: "In Production", color: "oklch(0.32 0.005 75)" },
    { name: "Ready",         color: "oklch(0.76 0.04 80)" },
    { name: "Dispatched",    color: "oklch(0.60 0.11 232)" },
    { name: "Delivered",     color: "oklch(0.72 0.17 148)" },
    { name: "Rejected",      color: "oklch(0.62 0.20 22)" },
  ].map(s => ({ ...s, value: orders.filter(o => o.status === s.name).length }));

  const client = user?.role === "client" ? db.clients.find(c => c.id === user.clientId) : null;
  const recent = [...orders].sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt)).slice(0, 6);

  // ── Expense stats ──
  const myExpenses = useMemo(
    () => (db.expenses ?? []).filter(e => e.employeeId === user?.id),
    [db.expenses, user?.id]
  );
  // Each currency apart for the tile; in dollars (at each day's rate) for the profit.
  const myExpenseMix = sumByCcy(myExpenses, e => e.amount, e => e.currency);
  const myExpenseUsd = expensesInUsd(db, myExpenses);

  // Employee: revenue = value of their delivered assigned orders
  const myRevenue = useMemo(() => {
    if (user?.role !== "employee") return 0;
    return db.orders
      .filter(o => o.assignedEmployeeId === user.id && o.status === "Delivered")
      .reduce((s, o) => s + keptValue(o), 0);
  }, [db.orders, user]);
  const myProfit = myRevenue - myExpenseUsd.usd;

  // Admin: certificate stats
  const certOrders = db.orders.filter(o => o.certificate === true);
  const certCount  = certOrders.length;
  const certIncome = certOrders.reduce((s, o) => s + (o.certificateFee || 0), 0);

  // Admin: total expenses across all staff, per-employee breakdown
  const allExpenses = db.expenses ?? [];
  const totalExpenseMix = sumByCcy(allExpenses, e => e.amount, e => e.currency);
  // Bars and order compare like with like: each person's spending in rupees at
  // each day's rate (an expense with no rate on file counts as nothing there,
  // though it still shows in that person's own figure).
  const inInr = (e: (typeof allExpenses)[number]) => e.amount * (inrOn(db, e.currency, e.createdAt) ?? 0);
  const totalExpensesInr = allExpenses.reduce((s, e) => s + inInr(e), 0);
  const staffExpenseSummary = useMemo(() => {
    const staff = db.users.filter(u => u.role === "admin" || u.role === "employee");
    return staff
      .map(u => {
        const mine = allExpenses.filter(e => e.employeeId === u.id);
        return { user: u, mix: sumByCcy(mine, e => e.amount, e => e.currency), inr: mine.reduce((s, e) => s + inInr(e), 0), count: mine.length };
      })
      .filter(s => s.count > 0)
      .sort((a, b) => b.inr - a.inr);
  }, [db.users, allExpenses]); // eslint-disable-line react-hooks/exhaustive-deps

  // 5th element = optional link target (clicking the card opens that filtered view).
  const stats: [string, string | number, LucideIcon, Tone | undefined, string?][] = user!.role === "admin"
    ? [
        ["Today's orders", todayOrders, Clock, undefined, "/orders"],
        ["For approval", forApproval, ClipboardCheck, "warn", "/orders?status=Waiting"],
        ["Pending", pending, Package, "warn", "/orders?status=Pending"],
        ["In production", inProd, Factory, undefined, "/orders?status=In%20Production"],
        ["Ready", ready, PackageCheck, undefined, "/orders?status=Ready"],
        ["Completed", completed, CheckCircle2, "in", "/orders?status=Delivered"],
        ["Revenue", fmtMoney(revenue), DollarSign, "in", "/reports"],
        ["Clients", db.clients.length, Users, undefined, "/clients"],
        ["Employees", db.users.filter(u => u.role === "employee").length, Briefcase, undefined, "/employees"],
      ]
    : user!.role === "employee"
    ? [
        ["Assigned", orders.length, Package, undefined, "/orders"],
        ["Pending", pending, Clock, "warn", "/orders?status=Pending"],
        ["In production", inProd, Factory, undefined, "/orders?status=In%20Production"],
        ["Completed", completed, CheckCircle2, "in", "/orders?status=Delivered"],
      ]
    : [
        ["Current orders", orders.filter(o => o.status !== "Delivered").length, Package, undefined, "/orders"],
        ["Completed", completed, CheckCircle2, "in", "/orders?status=Delivered"],
        ["Invoices", fmtMoney(orders.reduce((s, o) => s + orderTotal(o), 0)), DollarSign, undefined, "/invoices"],
        ["Pending payment", fmtMoney(orders.reduce((s, o) => s + balanceDue(o), 0)), TrendingUp, "warn", "/invoices"],
      ];

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <PushPermissionBanner />
      <PageHeader eyebrow={`Good day, ${client?.companyName || user?.name}`} title="Dashboard" />

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        {stats.map(([label, val, Icon, tone, to], i) => (
          <motion.div key={label} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04 }} className="h-full">
            <Kpi label={label} value={val} icon={Icon} tone={tone} to={to} />
          </motion.div>
        ))}
      </div>

      {/* Gift Cards — all-time totals (staff). Issued = Redeemed + Pending + Expired. */}
      {user!.role !== "client" && gc.count > 0 && (
        <div>
          <SectionTitle className="mb-3" icon={Gift} title="Gift Cards" sub="All time"
            actions={<Link to="/gift-cards" className="text-xs font-medium text-primary hover:underline inline-flex items-center gap-1">View all <ArrowRight className="h-3 w-3" /></Link>} />
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {([
              ["Issued", fmtMoney(gc.issued), Gift, undefined],
              ["Redeemed", fmtMoney(gc.used), CheckCircle2, "in"],
              ["Pending", fmtMoney(gc.pending), Clock, "warn"],
              ["Expired", fmtMoney(gc.expired), AlertCircle, "muted"],
            ] as [string, string, LucideIcon, Tone | undefined][]).map(([label, val, Icon, tone]) => (
              <Kpi key={label} label={label} value={val} icon={Icon} tone={tone} to="/gift-cards" />
            ))}
          </div>
        </div>
      )}

      {/* ── Employee: My Profit Panel ── */}
      {user!.role === "employee" && (
        <div className="card-luxe p-5">
          <SectionTitle className="mb-4" title="My Financial Summary"
            actions={<Link to="/expenses" className="text-sm text-primary flex items-center gap-1 hover:underline">Manage Expenses <ArrowRight className="h-3 w-3" /></Link>} />
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <Kpi label="Revenue" value={fmtMoney(myRevenue)} icon={TrendingUp} tone="in" sub="Delivered orders" />
            <Kpi label="Expenses" value={fmtCcyMix(myExpenseMix, "USD")} icon={TrendingDown} tone="out" sub={`${myExpenses.length} entries`} />
            <Kpi label="Net profit" value={`${myExpenseUsd.converted ? "≈ " : ""}${fmtMoney(myProfit)}`} icon={Wallet} tone={myProfit >= 0 ? "in" : "out"} sub="Revenue − expenses" />
          </div>
          {myExpenseUsd.left.size > 0 && <p className="text-[11px] text-amber-700 mt-2">{fmtCcyMix(myExpenseUsd.left)} not counted — no exchange rate on file</p>}
        </div>
      )}

      {/* ── Admin: Certificate Overview ── */}
      {user!.role === "admin" && (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}
          className="card-luxe p-5">
          <SectionTitle className="mb-4" icon={BadgeCheck} title="Certificate Summary" />
          <div className="grid grid-cols-2 gap-3">
            <Kpi label="Certificates" value={certCount} sub={`order${certCount !== 1 ? "s" : ""} issued`} />
            <Kpi label="Certificate income" value={fmtMoney(certIncome)} tone="in" sub={`$50 × ${certCount}`} />
          </div>
        </motion.div>
      )}

      {/* ── Admin: Manufacturing Overview ── */}
      {user!.role === "admin" && (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.12 }}
          className="card-luxe p-5">
          <SectionTitle className="mb-4" icon={Factory} title="Manufacturing Overview" sub="In INR" />
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
            <Kpi label="In production" value={ordersInProduction} icon={Package} sub="Orders" to="/orders?status=In%20Production" />
            <Kpi label="Gold reserve" value={`${goldReserveGrams.toLocaleString()} g`} icon={Coins} to="/stock" />
            <Kpi label="Diamond reserve" value={`${diamondReserveCarats.toLocaleString()} ct`} icon={Gem} to="/stock" />
            <Kpi label="Owed to factories" value={fmtMoneyInr(makingChargesPending)} icon={Factory} tone={makingChargesPending > 0 ? "out" : undefined} sub="Making charges" to="/factories" />
            <Kpi label="Owed to suppliers" value={fmtMoneyInr(supplierPaymentsPending)} icon={Wallet} tone={supplierPaymentsPending > 0 ? "out" : undefined} to="/suppliers" />
          </div>
        </motion.div>
      )}

      {/* ── Admin: Cash Position & Profit ── */}
      {user!.role === "admin" && (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.14 }}
          className="card-luxe p-5">
          <SectionTitle className="mb-4" icon={Wallet} title="Cash Position & Profit" sub="By currency"
            info="Income minus expense, from every payment tagged to a locker." />

          <div className="grid grid-cols-2 gap-3">
            <Kpi label="USD profit" value={fmtMoney(usdProfit)} tone={usdProfit >= 0 ? "in" : "out"} sub={`${usdLockers.length} locker${usdLockers.length !== 1 ? "s" : ""}`} to="/locker" />
            <Kpi label="INR profit" value={fmtMoneyInr(inrProfit)} tone={inrProfit >= 0 ? "in" : "out"} sub={`${inrLockers.length} locker${inrLockers.length !== 1 ? "s" : ""}`} to="/locker" />
            {otherCodes.map(c => {
              const v = otherProfit.get(c) ?? 0;
              const n = otherLockers.filter(l => ccy(l.currency) === c).length;
              return <Kpi key={c} label={`${c} profit`} value={fmtCcy(v, c)} tone={v >= 0 ? "in" : "out"} sub={`${n} locker${n !== 1 ? "s" : ""}`} to="/locker" />;
            })}
          </div>

          <div className="mt-4 pt-4 border-t border-border/60">
            <div className="flex items-center gap-2 flex-wrap">
              <label className="text-xs text-muted-foreground shrink-0">Consolidate at rate (₹ per $):</label>
              <input
                type="number" min={0} step="0.01" value={inrPerUsd} onChange={e => setInrPerUsd(e.target.value)}
                placeholder={settingsUsd ? fmtRate(settingsUsd) : "e.g. 83.5"} className="w-28 h-8 px-2.5 rounded-lg border border-border text-sm outline-none focus:border-primary"
              />
              {settingsUsd && !(Number(inrPerUsd) > 0) && (
                <span className="text-[11px] text-muted-foreground">Settings rate, until you type one</span>
              )}
            </div>
            {combinedUsd !== null && combinedInr !== null ? (
              <div className="grid grid-cols-2 gap-3 mt-3">
                <Kpi label="Total profit (USD)" value={fmtMoney(combinedUsd)} tone={combinedUsd >= 0 ? "in" : "out"} />
                <Kpi label="Total profit (INR)" value={fmtMoneyInr(combinedInr)} tone={combinedInr >= 0 ? "in" : "out"} />
                {otherCodes.length > 0 && (
                  <p className="col-span-2 text-[11px] text-muted-foreground">
                    {otherInr.filter(x => x.perUnit).length > 0 && (
                      <>Converted at {otherInr.filter(x => x.perUnit).map(x => rateText(x.c, "INR", x.perUnit!)).join(" · ")} (Settings → Exchange rates). </>
                    )}
                    {leftOut.length > 0 && (
                      <span className="text-warning">Left out — no rate in Settings → Exchange rates: {leftOut.map(c => `${c} ${fmtCcy(otherProfit.get(c) ?? 0, c)}`).join(", ")}.</span>
                    )}
                  </p>
                )}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground mt-2">Add today's exchange rate for one combined profit.</p>
            )}
          </div>
        </motion.div>
      )}

      {/* ── Admin: Expenses Overview ── */}
      {user!.role === "admin" && (
        <div className="card-luxe p-5">
          <SectionTitle className="mb-4" title="Staff Expenses"
            sub={<><span className="font-semibold text-destructive">{fmtCcyMix(totalExpenseMix)}</span> · {allExpenses.length} entries</>}
            actions={<Link to="/expenses?tab=passbook" className="text-sm text-primary flex items-center gap-1 hover:underline">Full Passbook <ArrowRight className="h-3 w-3" /></Link>} />
          {staffExpenseSummary.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 gap-2">
              <Receipt className="h-8 w-8 text-muted-foreground/30" />
              <p className="text-sm text-muted-foreground">No expenses recorded yet.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {staffExpenseSummary.map(({ user: u, mix, inr, count }) => {
                const pct = totalExpensesInr > 0 ? (inr / totalExpensesInr) * 100 : 0;
                const initials = u.name.split(" ").map((w: string) => w[0]).join("").slice(0, 2).toUpperCase();
                return (
                  <div key={u.id} className="flex items-center gap-3">
                    <div className="h-8 w-8 rounded-full bg-gradient-to-br from-primary to-brand-dark text-white text-xs font-bold grid place-items-center shrink-0">
                      {initials}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-sm font-medium text-foreground truncate">{u.name}</span>
                        <span className="text-sm font-bold text-destructive tabular-nums ml-2 text-right">{fmtCcyMix(mix)}</span>
                      </div>
                      <div className="h-1.5 w-full rounded-full bg-secondary overflow-hidden">
                        <div
                          className="h-full rounded-full bg-rose-400 transition-all duration-500"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <p className="text-[10px] text-muted-foreground mt-0.5">{count} {count === 1 ? "entry" : "entries"} · {pct.toFixed(0)}%</p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {user!.role === "admin" && (
        <div className="grid lg:grid-cols-3 gap-4">
          <div className="card-luxe p-5 lg:col-span-2">
            <SectionTitle className="mb-4" title="Monthly Orders" />
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={monthlyData}>
                <XAxis dataKey="name" tickLine={false} axisLine={false} className="text-xs" />
                <YAxis tickLine={false} axisLine={false} className="text-xs" />
                <Tooltip cursor={{ fill: "oklch(0.958 0.004 85 / 0.5)" }} contentStyle={{ borderRadius: 12, border: "1px solid oklch(0.915 0.004 85)" }} />
                <Bar dataKey="orders" fill="oklch(0.32 0.005 75)" radius={[8, 8, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="card-luxe p-5">
            <SectionTitle className="mb-4" title="Production Status" />
            <ResponsiveContainer width="100%" height={240}>
              <PieChart>
                <Pie data={statusData} innerRadius={50} outerRadius={90} dataKey="value">
                  {statusData.map((s, i) => <Cell key={i} fill={s.color} />)}
                </Pie>
                <Tooltip contentStyle={{ borderRadius: 12 }} />
              </PieChart>
            </ResponsiveContainer>
            <div className="grid grid-cols-2 gap-2 mt-2">
              {statusData.map(s => <div key={s.name} className="flex items-center gap-2 text-xs"><span className="h-2 w-2 rounded-full" style={{ background: s.color }} />{s.name}: {s.value}</div>)}
            </div>
          </div>
          <div className="card-luxe p-5 lg:col-span-3">
            <SectionTitle className="mb-4" title="Revenue Trend" />
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={monthlyData}>
                <XAxis dataKey="name" tickLine={false} axisLine={false} className="text-xs" />
                <YAxis tickLine={false} axisLine={false} className="text-xs" tickFormatter={v => `$${v/1000}k`} />
                <Tooltip formatter={(v: number) => fmtMoney(v)} contentStyle={{ borderRadius: 12 }} />
                <Line type="monotone" dataKey="revenue" stroke="oklch(0.32 0.005 75)" strokeWidth={3} dot={{ r: 4 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      <div className="card-luxe p-4 md:p-5">
        <SectionTitle className="mb-3" title="Recent Orders"
          actions={<Link to="/orders" className="text-sm text-primary flex items-center gap-1 hover:underline">View all <ArrowRight className="h-3 w-3" /></Link>} />
        <div className="space-y-1">
          {recent.length === 0 && <p className="text-sm text-muted-foreground text-center py-6">No orders yet.</p>}
          {recent.map(o => {
            const clientName = db.clients.find(c => c.id === o.clientId)?.companyName;
            const isActive = !["Delivered","Rejected"].includes(o.status);
            return (
              <Link key={o.id} to={`/orders/${o.id}`}
                className="flex items-start gap-3 p-3 rounded-xl hover:bg-secondary active:bg-secondary/70 transition">
                <div className="h-9 w-9 rounded-xl bg-gradient-to-br from-primary/10 to-brand-light/10 grid place-items-center shrink-0 mt-0.5">
                  <Package className="h-4 w-4 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  {/* Row 1: order# + status */}
                  <div className="flex items-start justify-between gap-2">
                    <p className="font-medium text-sm truncate">{o.orderNumber} · {o.jewelleryType}</p>
                    <StatusBadge status={o.status} />
                  </div>
                  {/* Row 2: client + date */}
                  <p className="text-xs text-muted-foreground truncate mt-0.5">
                    {clientName && <span>{clientName} · </span>}{fmtDate(o.createdAt)}
                    {o.designNumber ? ` · #${o.designNumber}` : ""}
                  </p>
                  {/* Row 3: amount + tracking step */}
                  <div className="flex items-center justify-between mt-1.5 gap-2">
                    <span className="text-sm font-semibold text-brand-dark">{fmtMoney(o.amount)}</span>
                    {isActive && (
                      <span className="flex items-center gap-1 text-[11px] font-medium text-primary">
                        <Truck className="h-3 w-3 shrink-0" />
                        <span className="truncate max-w-[120px]">{lastTrackingStep(o)}</span>
                      </span>
                    )}
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      </div>
    </div>
  );
}