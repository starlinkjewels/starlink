import { useMemo } from "react";
import { useAuth } from "@/lib/auth";
import { loadDb, fmtMoney, fmtDate, currentUserOrders, orderTotal, balanceDue } from "@/lib/db";
import { motion } from "framer-motion";
import { Package, Clock, CheckCircle2, Users, Briefcase, DollarSign, Factory, PackageCheck, TrendingUp, ArrowRight, Truck, Wallet, TrendingDown, Receipt, BadgeCheck } from "lucide-react";
import { Link } from "react-router-dom";
import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, LineChart, Line, Tooltip, PieChart, Pie, Cell } from "recharts";
import { StatCard } from "@/components/StatCard";
import { StatusBadge } from "@/components/StatusBadge";
import type { Order } from "@/lib/db";

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
  const db = loadDb();
  const orders = useMemo(() => currentUserOrders(db, user!), [db, user]);

  const today = new Date().toDateString();
  const todayOrders = orders.filter(o => new Date(o.createdAt).toDateString() === today).length;
  const pending = orders.filter(o => o.status === "Waiting" || o.status === "Approved").length;
  const inProd = orders.filter(o => o.status === "In Production").length;
  const ready = orders.filter(o => o.status === "Ready" || o.status === "Dispatched").length;
  const completed = orders.filter(o => o.status === "Delivered").length;
  const revenue = orders.filter(o => o.status === "Delivered").reduce((s, o) => s + o.amount, 0);

  const monthlyData = useMemo(() => {
    const months = Array.from({ length: 6 }, (_, i) => {
      const d = new Date(); d.setMonth(d.getMonth() - (5 - i));
      return { m: d.toLocaleDateString("en-US", { month: "short" }), y: d.getFullYear(), month: d.getMonth() };
    });
    return months.map(({ m, y, month }) => ({
      name: m,
      orders: orders.filter(o => { const d = new Date(o.createdAt); return d.getMonth() === month && d.getFullYear() === y; }).length,
      revenue: orders.filter(o => { const d = new Date(o.createdAt); return d.getMonth() === month && d.getFullYear() === y; }).reduce((s, o) => s + o.amount, 0),
    }));
  }, [orders]);

  const statusData = [
    { name: "Waiting", value: orders.filter(o => o.status === "Waiting").length, color: "oklch(0.78 0.16 70)" },
    { name: "In Production", value: inProd, color: "oklch(0.475 0.13 264)" },
    { name: "Ready", value: ready, color: "oklch(0.68 0.11 262)" },
    { name: "Delivered", value: completed, color: "oklch(0.72 0.17 148)" },
  ];

  const client = user?.role === "client" ? db.clients.find(c => c.id === user.clientId) : null;
  const recent = [...orders].sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt)).slice(0, 6);

  // ── Expense stats ──
  const myExpenses = useMemo(
    () => (db.expenses ?? []).filter(e => e.employeeId === user?.id),
    [db.expenses, user?.id]
  );
  const myExpenseTotal = myExpenses.reduce((s, e) => s + e.amount, 0);

  // Employee: revenue = value of their delivered assigned orders
  const myRevenue = useMemo(() => {
    if (user?.role !== "employee") return 0;
    return db.orders
      .filter(o => o.assignedEmployeeId === user.id && o.status === "Delivered")
      .reduce((s, o) => s + o.amount, 0);
  }, [db.orders, user]);
  const myProfit = myRevenue - myExpenseTotal;

  // Admin: certificate stats
  const certOrders = db.orders.filter(o => o.certificate === true);
  const certCount  = certOrders.length;
  const certIncome = certOrders.reduce((s, o) => s + (o.certificateFee || 0), 0);

  // Admin: total expenses across all staff, per-employee breakdown
  const allExpenses = db.expenses ?? [];
  const totalExpenses = allExpenses.reduce((s, e) => s + e.amount, 0);
  const staffExpenseSummary = useMemo(() => {
    const staff = db.users.filter(u => u.role === "admin" || u.role === "employee");
    return staff
      .map(u => ({
        user: u,
        total: allExpenses.filter(e => e.employeeId === u.id).reduce((s, e) => s + e.amount, 0),
        count: allExpenses.filter(e => e.employeeId === u.id).length,
      }))
      .filter(s => s.count > 0)
      .sort((a, b) => b.total - a.total);
  }, [db.users, allExpenses]);

  const stats: [string, string | number, any, string][] = user!.role === "admin"
    ? [
        ["Today's Orders", todayOrders, Clock, "text-primary"],
        ["Pending", pending, Package, "text-warning"],
        ["In Production", inProd, Factory, "text-primary"],
        ["Ready", ready, PackageCheck, "text-brand-light"],
        ["Completed", completed, CheckCircle2, "text-success"],
        ["Revenue", fmtMoney(revenue), DollarSign, "text-success"],
        ["Clients", db.clients.length, Users, "text-primary"],
        ["Employees", db.users.filter(u => u.role === "employee").length, Briefcase, "text-primary"],
      ]
    : user!.role === "employee"
    ? [
        ["Assigned", orders.length, Package, "text-primary"],
        ["Pending", pending, Clock, "text-warning"],
        ["In Production", inProd, Factory, "text-primary"],
        ["Completed", completed, CheckCircle2, "text-success"],
      ]
    : [
        ["Current Orders", orders.filter(o => o.status !== "Delivered").length, Package, "text-primary"],
        ["Completed", completed, CheckCircle2, "text-success"],
        ["Invoices", fmtMoney(orders.reduce((s, o) => s + orderTotal(o), 0)), DollarSign, "text-primary"],
        ["Pending Payment", fmtMoney(orders.reduce((s, o) => s + balanceDue(o), 0)), TrendingUp, "text-warning"],
      ];

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <div>
        <p className="text-sm text-muted-foreground">Good day,</p>
        <h1 className="font-display text-2xl md:text-4xl text-brand-dark leading-tight truncate">{client?.companyName || user?.name}</h1>
        <p className="text-sm text-muted-foreground mt-1">Here is what is happening today.</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4">
        {stats.map(([label, val, Icon, color], i) => (
          <motion.div key={label} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04 }}>
            <StatCard label={label} value={val} icon={Icon} colorClass={color} />
          </motion.div>
        ))}
      </div>

      {/* ── Employee: My Profit Panel ── */}
      {user!.role === "employee" && (
        <div className="card-luxe p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold">My Financial Summary</h3>
            <Link to="/expenses" className="text-sm text-primary flex items-center gap-1 hover:underline">
              Manage Expenses <ArrowRight className="h-3 w-3" />
            </Link>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="rounded-xl bg-emerald-50 border border-emerald-100 p-3.5">
              <div className="flex items-center gap-1.5 mb-1.5">
                <TrendingUp className="h-3.5 w-3.5 text-emerald-600" />
                <p className="text-xs font-medium text-emerald-700">Revenue</p>
              </div>
              <p className="text-lg font-bold text-emerald-700">{fmtMoney(myRevenue)}</p>
              <p className="text-[11px] text-emerald-600/70 mt-0.5">Delivered orders</p>
            </div>
            <div className="rounded-xl bg-rose-50 border border-rose-100 p-3.5">
              <div className="flex items-center gap-1.5 mb-1.5">
                <TrendingDown className="h-3.5 w-3.5 text-rose-600" />
                <p className="text-xs font-medium text-rose-700">Expenses</p>
              </div>
              <p className="text-lg font-bold text-rose-700">{fmtMoney(myExpenseTotal)}</p>
              <p className="text-[11px] text-rose-600/70 mt-0.5">{myExpenses.length} entries</p>
            </div>
            <div className={`rounded-xl border p-3.5 ${myProfit >= 0 ? "bg-emerald-50 border-emerald-100" : "bg-rose-50 border-rose-100"}`}>
              <div className="flex items-center gap-1.5 mb-1.5">
                <Wallet className={`h-3.5 w-3.5 ${myProfit >= 0 ? "text-emerald-600" : "text-rose-600"}`} />
                <p className={`text-xs font-medium ${myProfit >= 0 ? "text-emerald-700" : "text-rose-700"}`}>Net Profit</p>
              </div>
              <p className={`text-lg font-bold ${myProfit >= 0 ? "text-emerald-700" : "text-rose-700"}`}>{fmtMoney(myProfit)}</p>
              <p className={`text-[11px] mt-0.5 ${myProfit >= 0 ? "text-emerald-600/70" : "text-rose-600/70"}`}>Revenue − Expenses</p>
            </div>
          </div>
        </div>
      )}

      {/* ── Admin: Certificate Overview ── */}
      {user!.role === "admin" && (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}
          className="card-luxe p-5">
          <div className="flex items-center gap-3 mb-4">
            <div className="h-9 w-9 rounded-xl bg-amber-50 grid place-items-center shrink-0">
              <BadgeCheck className="h-5 w-5 text-amber-600" />
            </div>
            <div>
              <h3 className="font-semibold text-brand-dark">Certificate Summary</h3>
              <p className="text-xs text-muted-foreground">Orders with diamond / jewellery certificates</p>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-xl bg-amber-50 border border-amber-200 p-4 text-center">
              <p className="text-xs font-medium text-amber-700 uppercase tracking-wide mb-1">Total Certificates</p>
              <p className="text-3xl font-bold text-amber-800">{certCount}</p>
              <p className="text-[11px] text-amber-600/80 mt-1">order{certCount !== 1 ? "s" : ""} issued</p>
            </div>
            <div className="rounded-xl bg-amber-50 border border-amber-200 p-4 text-center">
              <p className="text-xs font-medium text-amber-700 uppercase tracking-wide mb-1">Certificate Income</p>
              <p className="text-3xl font-bold text-amber-800">{fmtMoney(certIncome)}</p>
              <p className="text-[11px] text-amber-600/80 mt-1">$50 × {certCount} certificate{certCount !== 1 ? "s" : ""}</p>
            </div>
          </div>
        </motion.div>
      )}

      {/* ── Admin: Expenses Overview ── */}
      {user!.role === "admin" && (
        <div className="card-luxe p-5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="font-semibold">Staff Expenses</h3>
              <p className="text-xs text-muted-foreground mt-0.5">Total: <span className="font-semibold text-destructive">{fmtMoney(totalExpenses)}</span> across {allExpenses.length} entries</p>
            </div>
            <Link to="/expenses?tab=passbook" className="text-sm text-primary flex items-center gap-1 hover:underline">
              Full Passbook <ArrowRight className="h-3 w-3" />
            </Link>
          </div>
          {staffExpenseSummary.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 gap-2">
              <Receipt className="h-8 w-8 text-muted-foreground/30" />
              <p className="text-sm text-muted-foreground">No expenses recorded yet.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {staffExpenseSummary.map(({ user: u, total, count }) => {
                const pct = totalExpenses > 0 ? (total / totalExpenses) * 100 : 0;
                const initials = u.name.split(" ").map((w: string) => w[0]).join("").slice(0, 2).toUpperCase();
                return (
                  <div key={u.id} className="flex items-center gap-3">
                    <div className="h-8 w-8 rounded-full bg-gradient-to-br from-primary to-brand-dark text-white text-xs font-bold grid place-items-center shrink-0">
                      {initials}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-sm font-medium text-foreground truncate">{u.name}</span>
                        <span className="text-sm font-bold text-destructive tabular-nums ml-2">{fmtMoney(total)}</span>
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
            <h3 className="font-semibold mb-4">Monthly Orders</h3>
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={monthlyData}>
                <XAxis dataKey="name" tickLine={false} axisLine={false} className="text-xs" />
                <YAxis tickLine={false} axisLine={false} className="text-xs" />
                <Tooltip cursor={{ fill: "oklch(0.955 0.015 250 / 0.5)" }} contentStyle={{ borderRadius: 12, border: "1px solid oklch(0.92 0.012 250)" }} />
                <Bar dataKey="orders" fill="oklch(0.475 0.13 264)" radius={[8, 8, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="card-luxe p-5">
            <h3 className="font-semibold mb-4">Production Status</h3>
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
            <h3 className="font-semibold mb-4">Revenue Trend</h3>
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={monthlyData}>
                <XAxis dataKey="name" tickLine={false} axisLine={false} className="text-xs" />
                <YAxis tickLine={false} axisLine={false} className="text-xs" tickFormatter={v => `$${v/1000}k`} />
                <Tooltip formatter={(v: number) => fmtMoney(v)} contentStyle={{ borderRadius: 12 }} />
                <Line type="monotone" dataKey="revenue" stroke="oklch(0.475 0.13 264)" strokeWidth={3} dot={{ r: 4 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      <div className="card-luxe p-4 md:p-5">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold">Recent Orders</h3>
          <Link to="/orders" className="text-sm text-primary flex items-center gap-1 hover:underline">View all <ArrowRight className="h-3 w-3" /></Link>
        </div>
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