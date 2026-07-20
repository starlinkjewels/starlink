import { useState, useEffect, useMemo } from "react";
import { useAuth } from "@/lib/auth";
import { loadDb, saveDb, uid, fmtMoney, fmtDate } from "@/lib/db";
import type { Expense, ExpenseCategory } from "@/lib/db";
import { motion, AnimatePresence } from "framer-motion";
import {
  Plus, Receipt, X, Filter, Search, Wallet,
  TrendingUp, TrendingDown, Minus, ChevronDown,
} from "lucide-react";

const CATEGORIES: ExpenseCategory[] = ["Travel", "Food", "Tools", "Office", "Communication", "Other"];

const CATEGORY_STYLE: Record<ExpenseCategory, string> = {
  Travel:        "bg-blue-50 text-blue-700 ring-1 ring-blue-200",
  Food:          "bg-orange-50 text-orange-700 ring-1 ring-orange-200",
  Tools:         "bg-purple-50 text-purple-700 ring-1 ring-purple-200",
  Office:        "bg-slate-50 text-slate-700 ring-1 ring-slate-200",
  Communication: "bg-teal-50 text-teal-700 ring-1 ring-teal-200",
  Other:         "bg-gray-50 text-gray-600 ring-1 ring-gray-200",
};

const CATEGORY_BG: Record<ExpenseCategory, string> = {
  Travel:        "bg-blue-500/10 text-blue-600",
  Food:          "bg-orange-500/10 text-orange-600",
  Tools:         "bg-purple-500/10 text-purple-600",
  Office:        "bg-slate-500/10 text-slate-600",
  Communication: "bg-teal-500/10 text-teal-600",
  Other:         "bg-gray-500/10 text-gray-600",
};

const EMPTY_FORM = { title: "", amount: "", category: "Other" as ExpenseCategory, note: "", clientId: "" };

export function ExpensesPage() {
  const { user } = useAuth();
  const [db, setDb] = useState(() => loadDb());
  const [tab, setTab] = useState<"mine" | "passbook">("mine");
  const [showAdd, setShowAdd] = useState(false);
  // "My Expenses" tab employee filter (admin only) — defaults to own id
  const [mineFilter, setMineFilter] = useState<string>("self");
  const [mineClientFilter, setMineClientFilter] = useState<string>("all");
  const [filterEmployee, setFilterEmployee] = useState("all");
  const [filterCategory, setFilterCategory] = useState("all");
  const [search, setSearch] = useState("");
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // Live sync with localStorage
  useEffect(() => {
    const refresh = () => setDb(loadDb());
    window.addEventListener("starlink-db-updated", refresh);
    return () => window.removeEventListener("starlink-db-updated", refresh);
  }, []);

  const isAdmin = user?.role === "admin";
  const isEmployee = user?.role === "employee";

  // All admin + employee users for the passbook filter
  const staffUsers = useMemo(
    () => db.users.filter(u => u.role === "admin" || u.role === "employee"),
    [db.users]
  );

  // "My Expenses" tab list — for employee always own; for admin respects mineFilter + mineClientFilter
  const myExpenses = useMemo(() => {
    let list = [...db.expenses];
    if (isAdmin) {
      if (mineFilter === "self") list = list.filter(e => e.employeeId === user?.id);
      else if (mineFilter !== "all") list = list.filter(e => e.employeeId === mineFilter);
      // "all" → no employee filter
      if (mineClientFilter !== "all") list = list.filter(e => e.clientId === mineClientFilter);
    } else {
      list = list.filter(e => e.employeeId === user?.id);
    }
    return list.sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));
  }, [db.expenses, user?.id, isAdmin, mineFilter, mineClientFilter]);

  // Passbook (admin only) with filters applied
  const passbookExpenses = useMemo(() => {
    let list = [...db.expenses];
    if (filterEmployee !== "all") list = list.filter(e => e.employeeId === filterEmployee);
    if (filterCategory !== "all") list = list.filter(e => e.category === filterCategory);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        e => e.title.toLowerCase().includes(q) || (e.note ?? "").toLowerCase().includes(q)
      );
    }
    return list.sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));
  }, [db.expenses, filterEmployee, filterCategory, search]);

  const myTotal = myExpenses.reduce((s, e) => s + e.amount, 0);
  const passbookTotal = passbookExpenses.reduce((s, e) => s + e.amount, 0);

  // Employee profit stats
  const myRevenue = useMemo(() => {
    if (!isEmployee) return 0;
    return db.orders
      .filter(o => o.assignedEmployeeId === user!.id && o.status === "Delivered")
      .reduce((s, o) => s + o.amount, 0);
  }, [db.orders, user, isEmployee]);

  // Per-employee summary for admin passbook cards
  const employeeSummary = useMemo(
    () =>
      staffUsers.map(u => ({
        user: u,
        total: db.expenses.filter(e => e.employeeId === u.id).reduce((s, e) => s + e.amount, 0),
        count: db.expenses.filter(e => e.employeeId === u.id).length,
      })).filter(s => s.count > 0),
    [db.expenses, staffUsers]
  );

  function handleAdd() {
    setError("");
    if (!form.title.trim()) { setError("Title is required."); return; }
    const amount = parseFloat(form.amount);
    if (!amount || isNaN(amount) || amount <= 0) { setError("Enter a valid amount."); return; }

    setSaving(true);
    const expense: Expense = {
      id: uid("exp_"),
      title: form.title.trim(),
      amount,
      category: form.category,
      note: form.note.trim() || undefined,
      employeeId: user!.id,
      clientId: form.clientId || undefined,
      createdAt: new Date().toISOString(),
    };
    const fresh = loadDb();
    fresh.expenses = [...fresh.expenses, expense];
    saveDb(fresh);
    setDb(fresh);
    setForm(EMPTY_FORM);
    setShowAdd(false);
    setSaving(false);
  }

  function handleDelete(id: string) {
    const fresh = loadDb();
    fresh.expenses = fresh.expenses.filter(e => e.id !== id);
    saveDb(fresh);
    setDb(fresh);
  }

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      {/* ── Page header ── */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl md:text-3xl text-brand-dark leading-tight">Expenses</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {isAdmin
              ? "Record your expenses and review all staff entries in the passbook."
              : "Log your expenses and track your net profit."}
          </p>
        </div>
        <button
          onClick={() => setShowAdd(true)}
          className="btn-hero flex items-center gap-2 px-4 h-10 rounded-xl text-sm font-semibold shrink-0"
        >
          <Plus className="h-4 w-4" />
          Add Expense
        </button>
      </div>

      {/* ── Employee profit summary ── */}
      {isEmployee && (
        <div className="grid grid-cols-3 gap-3">
          <motion.div
            initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0 }}
            className="card-luxe p-4"
          >
            <div className="flex items-center gap-2 mb-2">
              <div className="h-7 w-7 rounded-lg bg-emerald-500/10 grid place-items-center">
                <TrendingUp className="h-3.5 w-3.5 text-emerald-600" />
              </div>
              <p className="text-xs text-muted-foreground font-medium">Revenue</p>
            </div>
            <p className="text-xl font-bold text-brand-dark">{fmtMoney(myRevenue)}</p>
            <p className="text-[11px] text-muted-foreground mt-0.5">From delivered orders</p>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}
            className="card-luxe p-4"
          >
            <div className="flex items-center gap-2 mb-2">
              <div className="h-7 w-7 rounded-lg bg-destructive/10 grid place-items-center">
                <TrendingDown className="h-3.5 w-3.5 text-destructive" />
              </div>
              <p className="text-xs text-muted-foreground font-medium">Expenses</p>
            </div>
            <p className="text-xl font-bold text-destructive">{fmtMoney(myTotal)}</p>
            <p className="text-[11px] text-muted-foreground mt-0.5">{myExpenses.length} entries</p>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}
            className="card-luxe p-4"
          >
            <div className="flex items-center gap-2 mb-2">
              <div className={`h-7 w-7 rounded-lg grid place-items-center ${myRevenue - myTotal >= 0 ? "bg-emerald-500/10" : "bg-destructive/10"}`}>
                <Wallet className={`h-3.5 w-3.5 ${myRevenue - myTotal >= 0 ? "text-emerald-600" : "text-destructive"}`} />
              </div>
              <p className="text-xs text-muted-foreground font-medium">Net Profit</p>
            </div>
            <p className={`text-xl font-bold ${myRevenue - myTotal >= 0 ? "text-emerald-600" : "text-destructive"}`}>
              {fmtMoney(myRevenue - myTotal)}
            </p>
            <p className="text-[11px] text-muted-foreground mt-0.5">Revenue − Expenses</p>
          </motion.div>
        </div>
      )}

      {/* ── Admin tab switcher ── */}
      {isAdmin && (
        <div className="flex gap-1 p-1 bg-secondary rounded-xl w-fit">
          {(["mine", "passbook"] as const).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-5 py-2 rounded-lg text-sm font-medium transition-all ${
                tab === t
                  ? "bg-white shadow-soft text-brand-dark"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {t === "mine" ? "My Expenses" : "All Passbook"}
            </button>
          ))}
        </div>
      )}

      {/* ── My Expenses list ── */}
      {(isEmployee || (isAdmin && tab === "mine")) && (
        <div className="space-y-3">
          {/* Admin: employee + client filter row */}
          {isAdmin && (
            <div className="flex items-center gap-2 flex-wrap">
              {/* Employee picker */}
              <div className="flex items-center gap-2 bg-white border border-border/80 rounded-xl px-3 h-9 text-sm">
                <Filter className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                <select
                  value={mineFilter}
                  onChange={e => { setMineFilter(e.target.value); setMineClientFilter("all"); }}
                  className="bg-transparent border-none outline-none text-sm text-foreground"
                >
                  <option value="self">My Expenses</option>
                  <option value="all">All Employees</option>
                  {staffUsers
                    .filter(u => u.id !== user!.id)
                    .map(u => (
                      <option key={u.id} value={u.id}>
                        {u.name} ({u.role})
                      </option>
                    ))}
                </select>
              </div>

              {/* Client picker — only when viewing all or a specific employee */}
              {mineFilter !== "self" && (
                <div className="flex items-center gap-2 bg-white border border-border/80 rounded-xl px-3 h-9 text-sm">
                  <select
                    value={mineClientFilter}
                    onChange={e => setMineClientFilter(e.target.value)}
                    className="bg-transparent border-none outline-none text-sm text-foreground"
                  >
                    <option value="all">All Clients</option>
                    {db.clients.map(c => (
                      <option key={c.id} value={c.id}>{c.companyName}</option>
                    ))}
                  </select>
                </div>
              )}

              {/* Reset link */}
              {(mineFilter !== "self" || mineClientFilter !== "all") && (
                <button
                  onClick={() => { setMineFilter("self"); setMineClientFilter("all"); }}
                  className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                  <X className="h-3 w-3" /> Reset
                </button>
              )}
            </div>
          )}

          <ExpenseList
            expenses={myExpenses}
            total={myTotal}
            showEmployee={isAdmin && mineFilter !== "self"}
            users={db.users}
            clients={db.clients}
            onDelete={handleDelete}
            currentUserId={user!.id}
          />
        </div>
      )}

      {/* ── Admin passbook ── */}
      {isAdmin && tab === "passbook" && (
        <div className="space-y-4">
          {/* Employee summary cards */}
          {filterEmployee === "all" && employeeSummary.length > 0 && (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
              {employeeSummary.map(({ user: u, total, count }) => (
                <motion.button
                  key={u.id}
                  initial={{ opacity: 0, scale: 0.97 }}
                  animate={{ opacity: 1, scale: 1 }}
                  onClick={() => setFilterEmployee(u.id)}
                  className="card-luxe p-4 text-left hover:border-primary/30 hover:shadow-md transition-all active:scale-[0.98]"
                >
                  <div className="h-9 w-9 rounded-full bg-gradient-to-br from-primary to-brand-dark text-white text-xs font-bold grid place-items-center mb-2.5">
                    {u.name.split(" ").map((w: string) => w[0]).join("").slice(0, 2).toUpperCase()}
                  </div>
                  <p className="text-xs font-semibold text-foreground truncate">{u.name}</p>
                  <p className="text-[10px] text-muted-foreground capitalize mb-1.5">{u.role}</p>
                  <p className="text-base font-bold text-destructive">{fmtMoney(total)}</p>
                  <p className="text-[11px] text-muted-foreground">{count} {count === 1 ? "entry" : "entries"}</p>
                </motion.button>
              ))}
            </div>
          )}

          {/* Filters bar */}
          <div className="flex flex-wrap gap-2">
            {/* Employee filter */}
            <div className="relative flex items-center gap-2 bg-white border border-border/80 rounded-xl px-3 h-9 text-sm min-w-[160px]">
              <Filter className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              <select
                value={filterEmployee}
                onChange={e => setFilterEmployee(e.target.value)}
                className="bg-transparent border-none outline-none text-sm flex-1 text-foreground"
              >
                <option value="all">All Staff</option>
                {staffUsers.map(u => (
                  <option key={u.id} value={u.id}>{u.name} ({u.role})</option>
                ))}
              </select>
              {filterEmployee !== "all" && (
                <button
                  onClick={() => setFilterEmployee("all")}
                  className="text-muted-foreground hover:text-foreground transition-colors shrink-0"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>

            {/* Category filter */}
            <div className="flex items-center gap-2 bg-white border border-border/80 rounded-xl px-3 h-9 text-sm">
              <select
                value={filterCategory}
                onChange={e => setFilterCategory(e.target.value)}
                className="bg-transparent border-none outline-none text-sm text-foreground"
              >
                <option value="all">All Categories</option>
                {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>

            {/* Search */}
            <div className="flex items-center gap-2 bg-white border border-border/80 rounded-xl px-3 h-9 flex-1 min-w-[150px]">
              <Search className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search by title or note…"
                className="bg-transparent border-none outline-none text-sm flex-1 text-foreground placeholder:text-muted-foreground"
              />
              {search && (
                <button onClick={() => setSearch("")} className="text-muted-foreground hover:text-foreground shrink-0">
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          </div>

          {/* Passbook list */}
          <ExpenseList
            expenses={passbookExpenses}
            total={passbookTotal}
            showEmployee={true}
            users={db.users}
            clients={db.clients}
            onDelete={handleDelete}
            currentUserId={user!.id}
          />
        </div>
      )}

      {/* ── Add Expense Sheet ── */}
      <AnimatePresence>
        {showAdd && (
          <>
            <motion.div
              key="exp-backdrop"
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm"
              onClick={() => { setShowAdd(false); setError(""); setForm(EMPTY_FORM); }}
            />
            <motion.div
              key="exp-sheet"
              initial={{ opacity: 0, y: 48, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 48, scale: 0.97 }}
              transition={{ type: "spring", damping: 28, stiffness: 300 }}
              className="fixed bottom-0 inset-x-0 md:inset-auto md:top-1/2 md:left-1/2 md:-translate-x-1/2 md:-translate-y-1/2 z-50 md:w-[460px] bg-white rounded-t-3xl md:rounded-2xl shadow-2xl overflow-hidden"
              style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
            >
              {/* Sheet handle (mobile) */}
              <div className="flex justify-center pt-3 pb-0 md:hidden">
                <div className="h-1 w-10 rounded-full bg-border" />
              </div>

              {/* Header */}
              <div className="px-5 py-4 border-b border-border/60 flex items-center justify-between">
                <div>
                  <h2 className="font-display text-lg text-brand-dark">Add Expense</h2>
                  <p className="text-xs text-muted-foreground mt-0.5">Recording as {user?.name}</p>
                </div>
                <button
                  onClick={() => { setShowAdd(false); setError(""); setForm(EMPTY_FORM); }}
                  className="h-8 w-8 rounded-xl bg-secondary grid place-items-center text-muted-foreground hover:text-foreground transition-colors"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              {/* Form */}
              <div className="p-5 space-y-4">
                {error && (
                  <div className="flex items-center gap-2 bg-destructive/10 text-destructive text-sm rounded-xl px-3 py-2.5">
                    <X className="h-4 w-4 shrink-0" />
                    {error}
                  </div>
                )}

                {/* Title */}
                <div>
                  <label className="text-sm font-medium text-foreground mb-1.5 block">
                    Title <span className="text-destructive">*</span>
                  </label>
                  <input
                    value={form.title}
                    onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                    placeholder="e.g. Client visit travel, Office supplies…"
                    className="w-full px-3 h-10 rounded-xl border border-border bg-secondary/40 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/15 transition"
                  />
                </div>

                {/* Amount + Category */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-sm font-medium text-foreground mb-1.5 block">
                      Amount <span className="text-destructive">*</span>
                    </label>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm font-medium">$</span>
                      <input
                        type="number"
                        value={form.amount}
                        onChange={e => setForm(f => ({ ...f, amount: e.target.value }))}
                        placeholder="0.00"
                        min="0"
                        step="0.01"
                        className="w-full pl-7 pr-3 h-10 rounded-xl border border-border bg-secondary/40 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/15 transition"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="text-sm font-medium text-foreground mb-1.5 block">Category</label>
                    <div className="relative">
                      <select
                        value={form.category}
                        onChange={e => setForm(f => ({ ...f, category: e.target.value as ExpenseCategory }))}
                        className="w-full px-3 h-10 rounded-xl border border-border bg-secondary/40 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/15 transition appearance-none pr-8"
                      >
                        {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                      </select>
                      <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
                    </div>
                  </div>
                </div>

                {/* Related Client */}
                <div>
                  <label className="text-sm font-medium text-foreground mb-1.5 block">
                    Related Client <span className="text-muted-foreground font-normal">(optional)</span>
                  </label>
                  <div className="relative">
                    <select
                      value={form.clientId}
                      onChange={e => setForm(f => ({ ...f, clientId: e.target.value }))}
                      className="w-full px-3 h-10 rounded-xl border border-border bg-secondary/40 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/15 transition appearance-none pr-8"
                    >
                      <option value="">No client</option>
                      {db.clients.map(c => (
                        <option key={c.id} value={c.id}>{c.companyName}</option>
                      ))}
                    </select>
                    <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
                  </div>
                </div>

                {/* Note */}
                <div>
                  <label className="text-sm font-medium text-foreground mb-1.5 block">
                    Note <span className="text-muted-foreground font-normal">(optional)</span>
                  </label>
                  <textarea
                    value={form.note}
                    onChange={e => setForm(f => ({ ...f, note: e.target.value }))}
                    placeholder="Any additional details…"
                    rows={2}
                    className="w-full px-3 py-2.5 rounded-xl border border-border bg-secondary/40 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/15 transition resize-none"
                  />
                </div>

                {/* Category preview pill */}
                <div className="flex items-center gap-2">
                  <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${CATEGORY_STYLE[form.category]}`}>
                    {form.category}
                  </span>
                  <span className="text-xs text-muted-foreground">will be tagged as this category</span>
                </div>

                <button
                  onClick={handleAdd}
                  disabled={saving}
                  className="w-full btn-hero h-11 rounded-xl text-sm font-semibold disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {saving ? "Saving…" : "Record Expense"}
                </button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}

/* ─── Expense List Component ─────────────────────────────────────────────── */

interface ExpenseListProps {
  expenses: Expense[];
  total: number;
  showEmployee: boolean;
  users: any[];
  clients: any[];
  onDelete: (id: string) => void;
  currentUserId: string;
}

function ExpenseList({ expenses, total, showEmployee, users, clients, onDelete, currentUserId }: ExpenseListProps) {
  return (
    <div className="card-luxe overflow-hidden">
      {/* Summary bar */}
      <div className="px-4 py-3 border-b border-border/60 bg-secondary/30 flex items-center justify-between">
        <span className="text-sm text-muted-foreground">
          {expenses.length} {expenses.length === 1 ? "expense" : "expenses"}
        </span>
        <div className="flex items-center gap-1.5">
          <TrendingDown className="h-3.5 w-3.5 text-destructive" />
          <span className="font-bold text-destructive text-sm">{fmtMoney(total)}</span>
        </div>
      </div>

      {/* Empty state */}
      {expenses.length === 0 && (
        <div className="py-14 text-center">
          <div className="h-14 w-14 rounded-2xl bg-secondary mx-auto grid place-items-center mb-3">
            <Receipt className="h-7 w-7 text-muted-foreground/40" />
          </div>
          <p className="text-sm font-medium text-muted-foreground">No expenses found</p>
          <p className="text-xs text-muted-foreground/60 mt-1">Add your first expense using the button above.</p>
        </div>
      )}

      {/* List */}
      <div className="divide-y divide-border/40">
        {expenses.map((exp, i) => {
          const addedBy = users.find(u => u.id === exp.employeeId);
          const relatedClient = exp.clientId ? clients.find(c => c.id === exp.clientId) : null;
          const canDelete = exp.employeeId === currentUserId;
          return (
            <motion.div
              key={exp.id}
              initial={{ opacity: 0, x: -6 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: Math.min(i * 0.03, 0.3) }}
              className="flex items-start gap-3 px-4 py-3.5 hover:bg-secondary/20 transition-colors group"
            >
              {/* Icon */}
              <div className={`h-9 w-9 rounded-xl grid place-items-center shrink-0 mt-0.5 ${CATEGORY_BG[exp.category as ExpenseCategory] ?? "bg-gray-100 text-gray-600"}`}>
                <Receipt className="h-4 w-4" />
              </div>

              {/* Content */}
              <div className="flex-1 min-w-0">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm font-semibold text-foreground truncate">{exp.title}</p>
                  <span className="font-bold text-sm text-destructive shrink-0 tabular-nums">
                    {fmtMoney(exp.amount)}
                  </span>
                </div>

                <div className="flex items-center gap-2 mt-1 flex-wrap">
                  <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${CATEGORY_STYLE[exp.category as ExpenseCategory] ?? ""}`}>
                    {exp.category}
                  </span>
                  {showEmployee && addedBy && (
                    <span className="text-[11px] text-muted-foreground font-medium">{addedBy.name}</span>
                  )}
                  {relatedClient && (
                    <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-violet-50 text-violet-700 ring-1 ring-violet-200">
                      {relatedClient.companyName}
                    </span>
                  )}
                  <span className="text-[11px] text-muted-foreground">{fmtDate(exp.createdAt)}</span>
                </div>

                {exp.note && (
                  <p className="text-xs text-muted-foreground mt-1 truncate">{exp.note}</p>
                )}
              </div>

              {/* Delete (own entries only) */}
              {canDelete && (
                <button
                  onClick={() => onDelete(exp.id)}
                  title="Delete"
                  className="opacity-0 group-hover:opacity-100 focus:opacity-100 h-7 w-7 rounded-lg bg-destructive/10 grid place-items-center text-destructive hover:bg-destructive/20 transition-all shrink-0 mt-0.5"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}
