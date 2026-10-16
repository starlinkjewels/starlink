import { expensesInUsd } from "@/lib/orderCost";
import { DataTable, CellMain, CellTag, CellAmount, CellDate, type DataColumn } from "@/components/DataTable";
import { useCan } from "@/hooks/useCan";
import { ActionSheet } from "@/components/ActionSheet";
import { useState, useEffect, useMemo } from "react";
import { useAuth } from "@/lib/auth";
import { loadDb, updateDb, flush, uid, fmtMoney, fmtDate, fmtExpenseAmount, DEFAULT_EXPENSE_CATEGORIES, keptValue } from "@/lib/db";
import type { Expense, ExpenseCategory } from "@/lib/db";
import { ccy, ccySymbol, fmtCcyMix, sumByCcy } from "@/lib/currency";
import { motion } from "framer-motion";
import { toast } from "sonner";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Plus, Receipt, X, Filter, Search, Wallet,
  TrendingUp, TrendingDown, CalendarDays, Trash2,
} from "lucide-react";
import { confirmBox } from "@/lib/confirm";

const FALLBACK_CATEGORY_STYLE = "bg-gray-50 text-gray-600 ring-1 ring-gray-200";

const CATEGORY_STYLE: Record<ExpenseCategory, string> = {
  Travel:        "bg-blue-50 text-blue-700 ring-1 ring-blue-200",
  Food:          "bg-orange-50 text-orange-700 ring-1 ring-orange-200",
  Tools:         "bg-purple-50 text-purple-700 ring-1 ring-purple-200",
  Office:        "bg-slate-50 text-slate-700 ring-1 ring-slate-200",
  Communication: "bg-teal-50 text-teal-700 ring-1 ring-teal-200",
  Other:         "bg-gray-50 text-gray-600 ring-1 ring-gray-200",
};


const EMPTY_FORM = { title: "", amount: "", category: "Other" as ExpenseCategory, note: "", clientId: "", paidToEmployeeId: "" };

/** Each currency's total kept apart — rupees, dollars and A$ are never added together. */
const totalsOf = (list: Expense[]) => sumByCcy(list, e => e.amount, e => e.currency);

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
  const [dateFrom, setDateFrom] = useState(""); // YYYY-MM-DD
  const [dateTo, setDateTo] = useState("");
  const [form, setForm] = useState(EMPTY_FORM);
  const [expLockerId, setExpLockerId] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const activeLockers = db.lockers.filter(l => l.active !== false);
  const expLocker = db.lockers.find(l => l.id === expLockerId);
  // The account's own currency, whichever it is — an AUD account's expense is A$.
  const expCurrency = ccy(expLocker?.currency);
  const expSymbol = ccySymbol(expCurrency).trim();
  // Configured list (Settings) for picking a category on a NEW expense —
  // vs. every category that ever appears on an existing expense, for the
  // filter dropdown, so a since-removed category stays filterable.
  const configuredCategories = db.settings.expenseCategories?.length ? db.settings.expenseCategories : DEFAULT_EXPENSE_CATEGORIES;
  const allCategoriesEverUsed = [...new Set([...configuredCategories, ...db.expenses.map(e => e.category)])];

  // Live sync with the Firebase-backed store
  useEffect(() => {
    const refresh = () => setDb(loadDb());
    window.addEventListener("starlink-db-updated", refresh);
    return () => window.removeEventListener("starlink-db-updated", refresh);
  }, []);

  const isAdmin = user?.role === "admin";
  const can = useCan();
  const isEmployee = user?.role === "employee";

  // Inclusive local-day range filter on an expense's date (blank = open-ended).
  const inDateRange = (iso: string) => {
    const t = +new Date(iso);
    if (dateFrom && t < +new Date(`${dateFrom}T00:00:00`)) return false;
    if (dateTo && t > +new Date(`${dateTo}T23:59:59`)) return false;
    return true;
  };
  const clearDates = () => { setDateFrom(""); setDateTo(""); };

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
    list = list.filter(e => inDateRange(e.createdAt));
    return list.sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db.expenses, user?.id, isAdmin, mineFilter, mineClientFilter, dateFrom, dateTo]);

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
    list = list.filter(e => inDateRange(e.createdAt));
    return list.sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db.expenses, filterEmployee, filterCategory, search, dateFrom, dateTo]);

  const myTotals = totalsOf(myExpenses);

  // Employee profit stats
  const myRevenue = useMemo(() => {
    if (!isEmployee) return 0;
    return db.orders
      .filter(o => o.assignedEmployeeId === user!.id && o.status === "Delivered")
      .reduce((s, o) => s + keptValue(o), 0);
  }, [db.orders, user, isEmployee]);
  // Revenue is in dollars; expenses are in whatever account paid them. Net
  // profit sets the two against each other in dollars, marked "≈" when any
  // expense had to be converted, and says what it could not convert.
  const myNet = useMemo(() => {
    if (!isEmployee) return null;
    const x = expensesInUsd(db, myExpenses);
    return { ...x, net: myRevenue - x.usd };
  }, [db, myExpenses, myRevenue, isEmployee]);

  // Per-employee summary for admin passbook cards
  const employeeSummary = useMemo(
    () =>
      staffUsers.map(u => {
        const theirs = db.expenses.filter(e => e.employeeId === u.id);
        return { user: u, totals: totalsOf(theirs), count: theirs.length };
      }).filter(s => s.count > 0),
    [db.expenses, staffUsers]
  );

  async function handleAdd() {
    setError("");
    // Account FIRST — it decides the currency the amount is entered in.
    if (!expLockerId) { setError("Choose the account this is paid from."); return; }
    const amount = parseFloat(form.amount);
    if (!amount || isNaN(amount) || amount <= 0) { setError("Enter a valid amount."); return; }
    if (!form.title.trim()) { setError("Title is required."); return; }
    // Employee is compulsory ONLY for a Salary expense.
    if (form.category === "Salary" && !form.paidToEmployeeId) { setError("Choose which team member this salary is for."); return; }

    setSaving(true);
    const now = new Date().toISOString();
    const fresh = loadDb();
    const locker = fresh.lockers.find(l => l.id === expLockerId);
    // Whatever the account holds — never folded into rupees because it isn't dollars.
    const currency = ccy(locker?.currency);
    const expense: Expense = {
      id: uid("exp_"),
      title: form.title.trim(),
      amount, // in the account's own currency
      category: form.category,
      note: form.note.trim() || undefined,
      employeeId: user!.id,
      clientId: form.clientId || undefined,
      // Only carry a payee for Salary expenses.
      paidToEmployeeId: form.category === "Salary" ? (form.paidToEmployeeId || undefined) : undefined,
      currency,
      createdAt: now,
      lockerId: expLockerId,
    };
    // Mutate the LIVE cache in place. Writing back a whole loadDb() copy would
    // revert every other collection to this moment and delete anything created
    // in between (that's how records were vanishing) — never do that.
    updateDb(d => {
      if (!d.expenses) d.expenses = [];
      d.expenses.push(expense);
      if (locker) {
        if (!d.lockerTransactions) d.lockerTransactions = [];
        d.lockerTransactions.push({
          id: uid("ltx_"), lockerId: expLockerId, type: "expense", amountInr: amount,
          currency: locker.currency || "INR", category: `Expense — ${form.title.trim()}`,
          refType: "expense", refId: expense.id, recordedBy: user!.id, createdAt: now,
        });
      }
    });
    setDb(loadDb());
    await flush(); // keep the button in "Saving…" until Firebase confirms
    setForm(EMPTY_FORM);
    setExpLockerId("");
    setShowAdd(false);
    setSaving(false);
  }

  async function handleDelete(id: string) {
    if (!(await confirmBox("Delete this expense? Its linked locker entry is also removed. This cannot be undone."))) return;
    // In-place on the live cache — only this expense + its locker line go.
    updateDb(d => {
      d.expenses = d.expenses.filter(e => e.id !== id);
      d.lockerTransactions = (d.lockerTransactions ?? []).filter(t => !(t.refType === "expense" && t.refId === id));
    });
    setDb(loadDb());
    toast.success("Expense deleted");
  }

  // Closing the form (Cancel, ✕, Esc or a click outside) clears what was typed —
  // the account stays chosen, as it always did.
  const closeAdd = () => { setShowAdd(false); setError(""); setForm(EMPTY_FORM); };
  // The footer's preview of the amount; the save still reads the field itself.
  const previewAmount = Number(form.amount) > 0 ? Number(form.amount) : 0;
  // The admin's open tab — for the count and total beside the switch.
  const tabList = tab === "mine" ? myExpenses : passbookExpenses;

  // Reusable date-range control (from → to) used on both the My Expenses and
  // Passbook filter bars.
  const dateFilter = (
    <div className="flex items-center gap-1.5 bg-white border border-border/80 rounded-xl px-2.5 h-9 text-sm">
      <CalendarDays className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
      <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} aria-label="From date"
        className="bg-transparent outline-none text-sm w-[115px] text-foreground" />
      <span className="text-muted-foreground text-xs">→</span>
      <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} aria-label="To date"
        className="bg-transparent outline-none text-sm w-[115px] text-foreground" />
      {(dateFrom || dateTo) && (
        <button onClick={clearDates} className="text-muted-foreground hover:text-foreground shrink-0" title="Clear dates"><X className="h-3.5 w-3.5" /></button>
      )}
    </div>
  );

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* ── Page header: what the page is, and its one action ── */}
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="font-display text-2xl md:text-3xl text-brand-dark leading-tight">Expenses</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {isAdmin
              ? "Record your expenses and review all staff entries in the passbook."
              : "Log your expenses and track your net profit."}
          </p>
        </div>
        {can("expenses", "add") && (
          <button
            onClick={() => setShowAdd(true)}
            className="btn-hero flex items-center gap-2 px-4 h-10 rounded-xl text-sm font-semibold shrink-0"
          >
            <Plus className="h-4 w-4" />
            Add Expense
          </button>
        )}
      </div>

      {/* ── Employee profit summary — two across on a phone (net profit under them), three on a laptop ── */}
      {isEmployee && (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <motion.div
            initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0 }}
            className="card-luxe p-4 min-w-0"
          >
            <div className="flex items-center gap-2 mb-2">
              <div className="h-7 w-7 rounded-lg bg-emerald-500/10 grid place-items-center shrink-0">
                <TrendingUp className="h-3.5 w-3.5 text-emerald-600" />
              </div>
              <p className="text-xs text-muted-foreground font-medium">Revenue</p>
            </div>
            <p className="text-lg sm:text-xl font-bold text-brand-dark tabular-nums break-words">{fmtMoney(myRevenue)}</p>
            <p className="text-[11px] text-muted-foreground mt-0.5">From delivered orders</p>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}
            className="card-luxe p-4 min-w-0"
          >
            <div className="flex items-center gap-2 mb-2">
              <div className="h-7 w-7 rounded-lg bg-destructive/10 grid place-items-center shrink-0">
                <TrendingDown className="h-3.5 w-3.5 text-destructive" />
              </div>
              <p className="text-xs text-muted-foreground font-medium">Expenses</p>
            </div>
            {/* Can read "₹84,910 + A$1,200" — allowed to wrap rather than push the page sideways. */}
            <p className="text-lg sm:text-xl font-bold text-destructive tabular-nums break-words">{fmtCcyMix(myTotals)}</p>
            <p className="text-[11px] text-muted-foreground mt-0.5">{myExpenses.length} entries</p>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}
            className="card-luxe p-4 min-w-0 col-span-2 sm:col-span-1"
          >
            <div className="flex items-center gap-2 mb-2">
              <div className={`h-7 w-7 rounded-lg grid place-items-center shrink-0 ${(myNet?.net ?? 0) >= 0 ? "bg-emerald-500/10" : "bg-destructive/10"}`}>
                <Wallet className={`h-3.5 w-3.5 ${(myNet?.net ?? 0) >= 0 ? "text-emerald-600" : "text-destructive"}`} />
              </div>
              <p className="text-xs text-muted-foreground font-medium">Net Profit</p>
            </div>
            <p className={`text-lg sm:text-xl font-bold tabular-nums break-words ${(myNet?.net ?? 0) >= 0 ? "text-emerald-600" : "text-destructive"}`}>
              {myNet?.converted ? "≈ " : ""}{fmtMoney(myNet?.net ?? 0)}
            </p>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              Revenue − Expenses{myNet?.converted ? ", in $ at each day's rate" : ""}
            </p>
            {myNet && myNet.left.size > 0 && (
              <p className="text-[11px] text-amber-700 mt-0.5">
                {fmtCcyMix(myNet.left)} not counted — no exchange rate on file
              </p>
            )}
          </motion.div>
        </div>
      )}

      {/* ── Admin tab switcher, with what the list below adds up to ── */}
      {isAdmin && (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          {/* Full width on a phone (two equal halves), its own size on a laptop. */}
          <div className="grid grid-cols-2 gap-1 p-1 bg-secondary rounded-xl sm:inline-grid sm:w-fit">
            {(["mine", "passbook"] as const).map(t => (
              <button
                key={t}
                onClick={() => setTab(t)}
                aria-pressed={tab === t}
                className={`px-5 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-all ${
                  tab === t
                    ? "bg-white shadow-soft text-brand-dark"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {t === "mine" ? "My Expenses" : "All Passbook"}
              </button>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            {tabList.length} {tabList.length === 1 ? "entry" : "entries"}
            {" · "}
            <span className="font-semibold text-destructive tabular-nums">{fmtCcyMix(totalsOf(tabList))}</span>
          </p>
        </div>
      )}

      {/* ── My Expenses list ── */}
      {(isEmployee || (isAdmin && tab === "mine")) && (
        <div className="space-y-3">
          {/* Filter row — date range for everyone, employee/client pickers for admin */}
          <div className="flex items-center gap-2 flex-wrap">
            {dateFilter}
            {isAdmin && (
              <>
              {/* Employee picker */}
              <div className="flex items-center gap-2 bg-white border border-border/80 rounded-xl pl-3 pr-1.5 h-9 text-sm">
                <Filter className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                <Select value={mineFilter} onValueChange={v => { setMineFilter(v); setMineClientFilter("all"); }}>
                  <SelectTrigger className="h-7 border-none bg-transparent shadow-none px-1.5 gap-1 focus:ring-0"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="self">My Expenses</SelectItem>
                    <SelectItem value="all">All Employees</SelectItem>
                    {staffUsers.filter(u => u.id !== user!.id).map(u => (
                      <SelectItem key={u.id} value={u.id}>{u.name} ({u.role})</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Client picker — only when viewing all or a specific employee */}
              {mineFilter !== "self" && (
                <div className="flex items-center gap-2 bg-white border border-border/80 rounded-xl pl-3 pr-1.5 h-9 text-sm">
                  <Select value={mineClientFilter} onValueChange={setMineClientFilter}>
                    <SelectTrigger className="h-7 border-none bg-transparent shadow-none px-1.5 gap-1 focus:ring-0"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Clients</SelectItem>
                      {db.clients.map(c => <SelectItem key={c.id} value={c.id}>{c.companyName}</SelectItem>)}
                    </SelectContent>
                  </Select>
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
              </>
            )}
          </div>

          <ExpenseList
            expenses={myExpenses}
            showEmployee={isAdmin && mineFilter !== "self"}
            users={db.users}
            clients={db.clients}
            onDelete={handleDelete}
            mayDelete={can("expenses", "delete")}
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
              {employeeSummary.map(({ user: u, totals, count }) => (
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
                  <p className="text-base font-bold text-destructive">{fmtCcyMix(totals)}</p>
                  <p className="text-[11px] text-muted-foreground">{count} {count === 1 ? "entry" : "entries"}</p>
                </motion.button>
              ))}
            </div>
          )}

          {/* Filters bar */}
          <div className="flex flex-wrap gap-2">
            {dateFilter}
            {/* Employee filter */}
            <div className="relative flex items-center gap-2 bg-white border border-border/80 rounded-xl pl-3 pr-1.5 h-9 text-sm min-w-[160px]">
              <Filter className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              <Select value={filterEmployee} onValueChange={setFilterEmployee}>
                <SelectTrigger className="h-7 border-none bg-transparent shadow-none px-1.5 gap-1 flex-1 focus:ring-0"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Staff</SelectItem>
                  {staffUsers.map(u => <SelectItem key={u.id} value={u.id}>{u.name} ({u.role})</SelectItem>)}
                </SelectContent>
              </Select>
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
            <div className="flex items-center gap-2 bg-white border border-border/80 rounded-xl pl-3 pr-1.5 h-9 text-sm">
              <Select value={filterCategory} onValueChange={setFilterCategory}>
                <SelectTrigger className="h-7 border-none bg-transparent shadow-none px-1.5 gap-1 focus:ring-0"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Categories</SelectItem>
                  {allCategoriesEverUsed.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
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
            showEmployee={true}
            users={db.users}
            clients={db.clients}
            onDelete={handleDelete}
            mayDelete={can("expenses", "delete")}
            currentUserId={user!.id}
          />
        </div>
      )}

      {/* ── Add Expense — a panel from the right, so the list behind stays where it was ── */}
      <ActionSheet
        open={showAdd}
        onOpenChange={v => { if (!v) closeAdd(); }}
        title="Add Expense"
        description={`Recording as ${user?.name ?? ""}`}
        icon={Receipt}
        size="md"
        footer={
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            {/* What will be recorded — in the paying account's own currency. */}
            <div className="min-w-0">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Expense</p>
              <p className="font-display text-2xl font-bold text-destructive tabular-nums leading-tight truncate">
                {expLocker ? fmtExpenseAmount(previewAmount, expCurrency) : "—"}
              </p>
              <div className="flex items-center gap-1.5 mt-0.5 min-w-0">
                <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full shrink-0 ${CATEGORY_STYLE[form.category] ?? FALLBACK_CATEGORY_STYLE}`}>
                  {form.category}
                </span>
                <span className="text-[11px] text-muted-foreground truncate">
                  {expLocker ? `from ${expLocker.name}` : "Choose the account it is paid from"}
                </span>
              </div>
            </div>
            <div className="flex gap-2 sm:shrink-0">
              <button onClick={closeAdd}
                className="flex-1 sm:flex-none h-10 px-4 rounded-xl border border-border bg-card text-sm font-medium hover:bg-secondary">Cancel</button>
              <button
                onClick={handleAdd}
                disabled={saving}
                className="btn-hero flex-1 sm:flex-none h-10 px-5 rounded-xl text-sm font-semibold disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {saving ? "Saving…" : "Record Expense"}
              </button>
            </div>
          </div>
        }
      >
        {/* One column on a phone; two on a laptop for the short pairs (amount + category). */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-3 gap-y-4">
          {error && (
            <div className="sm:col-span-2 flex items-center gap-2 bg-destructive/10 text-destructive text-sm rounded-xl px-3 py-2.5">
              <X className="h-4 w-4 shrink-0" />
              {error}
            </div>
          )}

          {/* 1. Pay from account — first; it sets the currency */}
          <div className="sm:col-span-2">
            <label className="text-sm font-medium text-foreground mb-1.5 block">Pay from Account <span className="text-destructive">*</span></label>
            {activeLockers.length === 0 && (
              <p className="text-xs text-amber-600 mb-1.5">
                No accounts yet — <a href="/locker" className="underline font-medium">create one first</a> before recording an expense.
              </p>
            )}
            <Select value={expLockerId} onValueChange={setExpLockerId}>
              <SelectTrigger className="h-10 rounded-xl bg-secondary/40"><SelectValue placeholder="Choose account" /></SelectTrigger>
              <SelectContent>
                {activeLockers.map(l => (
                  <SelectItem key={l.id} value={l.id}>{l.name} ({l.currency || "INR"})</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* 2. Amount — in the selected account's currency */}
          <div>
            <label className="text-sm font-medium text-foreground mb-1.5 block">Amount ({expCurrency}) <span className="text-destructive">*</span></label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm font-medium">{expSymbol}</span>
              <input
                type="number"
                value={form.amount}
                onChange={e => setForm(f => ({ ...f, amount: e.target.value }))}
                placeholder={expLockerId ? "0.00" : "Choose an account first"}
                disabled={!expLockerId}
                min="0"
                step="0.01"
                // Room for a longer symbol — A$, HK$, AED — not only ₹ and $.
                className={`w-full ${expSymbol.length > 1 ? "pl-12" : "pl-7"} pr-3 h-10 rounded-xl border border-border bg-secondary/40 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/15 transition disabled:opacity-60`}
              />
            </div>
          </div>

          {/* 3. Category */}
          <div>
            <label className="text-sm font-medium text-foreground mb-1.5 block">Category</label>
            <Select
              value={form.category}
              onValueChange={v => setForm(f => ({ ...f, category: v as ExpenseCategory, paidToEmployeeId: v === "Salary" ? f.paidToEmployeeId : "" }))}
            >
              <SelectTrigger className="h-10 rounded-xl bg-secondary/40"><SelectValue /></SelectTrigger>
              <SelectContent>{(configuredCategories.includes("Salary") ? configuredCategories : ["Salary", ...configuredCategories]).map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
            </Select>
          </div>

          {/* 4. Salary → team member — shown & COMPULSORY only for a Salary expense */}
          {form.category === "Salary" && (
            <div className="sm:col-span-2">
              <label className="text-sm font-medium text-foreground mb-1.5 block">Paid to Team Member <span className="text-destructive">*</span></label>
              <Select value={form.paidToEmployeeId || ""} onValueChange={v => setForm(f => ({ ...f, paidToEmployeeId: v }))}>
                <SelectTrigger className="h-10 rounded-xl bg-secondary/40"><SelectValue placeholder="Choose team member" /></SelectTrigger>
                <SelectContent>
                  {staffUsers.map(u => <SelectItem key={u.id} value={u.id}>{u.name} ({u.role})</SelectItem>)}
                </SelectContent>
              </Select>
              <p className="text-[11px] text-muted-foreground mt-1">Shows on this member's salary ledger (Employees → their page).</p>
            </div>
          )}

          {/* Title */}
          <div className="sm:col-span-2">
            <label className="text-sm font-medium text-foreground mb-1.5 block">
              Title <span className="text-destructive">*</span>
            </label>
            <input
              value={form.title}
              onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
              placeholder="e.g. August salary, Office rent, Travel…"
              className="w-full px-3 h-10 rounded-xl border border-border bg-secondary/40 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/15 transition"
            />
          </div>

          {/* 6. Related Client (optional) */}
          <div className="sm:col-span-2">
            <label className="text-sm font-medium text-foreground mb-1.5 block">
              Related Client <span className="text-muted-foreground font-normal">(optional)</span>
            </label>
            <Select value={form.clientId || "__none"} onValueChange={v => setForm(f => ({ ...f, clientId: v === "__none" ? "" : v }))}>
              <SelectTrigger className="h-10 rounded-xl bg-secondary/40"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__none">No client</SelectItem>
                {db.clients.map(c => <SelectItem key={c.id} value={c.id}>{c.companyName}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          {/* Note */}
          <div className="sm:col-span-2">
            <label className="text-sm font-medium text-foreground mb-1.5 block">
              Note <span className="text-muted-foreground font-normal">(optional)</span>
            </label>
            <textarea
              value={form.note}
              onChange={e => setForm(f => ({ ...f, note: e.target.value }))}
              placeholder="Any additional details…"
              rows={3}
              className="w-full px-3 py-2.5 rounded-xl border border-border bg-secondary/40 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/15 transition resize-none"
            />
          </div>
        </div>
      </ActionSheet>
    </div>
  );
}

/* ─── Expense List Component ─────────────────────────────────────────────── */

interface ExpenseListProps {
  expenses: Expense[];
  showEmployee: boolean;
  users: any[];
  clients: any[];
  onDelete: (id: string) => void;
  currentUserId: string;
  /** Whether this person's role lets them delete expenses at all. */
  mayDelete: boolean;
}

function ExpenseList({ expenses, showEmployee, users, clients, onDelete, currentUserId, mayDelete }: ExpenseListProps) {
  // A nil total reads in the list's one currency ("$0"), else in rupees.
  const codes = new Set(expenses.map(e => ccy(e.currency)));
  const nilCcy = codes.size === 1 ? [...codes][0] : "INR";
  const userName = (id?: string) => (id ? users.find(u => u.id === id)?.name : undefined) ?? "";
  const clientName = (id?: string) => (id ? clients.find(c => c.id === id)?.companyName : undefined) ?? "";
  const columns: DataColumn<Expense>[] = [
    { key: "title", header: "Expense", always: true, sortValue: e => e.title, csv: e => e.title,
      cell: e => <CellMain title={e.title} sub={e.note} /> },
    { key: "category", header: "Category", sortValue: e => e.category,
      cell: e => <span className={`inline-flex items-center whitespace-nowrap text-[11px] font-medium px-2 py-0.5 rounded-full ${CATEGORY_STYLE[e.category] ?? FALLBACK_CATEGORY_STYLE}`}>{e.category}</span> },
    { key: "date", header: "Date", kind: "date", sortValue: e => e.createdAt, csv: e => fmtDate(e.createdAt), cell: e => <CellDate>{fmtDate(e.createdAt)}</CellDate> },
    { key: "paidTo", header: "Paid to", sortValue: e => userName(e.paidToEmployeeId), cell: e => e.paidToEmployeeId ? <CellTag tone="green">{userName(e.paidToEmployeeId) || "—"}</CellTag> : <span className="text-muted-foreground/50">—</span> },
    { key: "client", header: "Client", sortValue: e => clientName(e.clientId), cell: e => e.clientId ? <CellTag tone="violet">{clientName(e.clientId) || "—"}</CellTag> : <span className="text-muted-foreground/50">—</span> },
    ...(showEmployee ? [{ key: "by", header: "Added by", sortValue: (e: Expense) => userName(e.employeeId), cell: (e: Expense) => <span className="whitespace-nowrap">{userName(e.employeeId) || "—"}</span> }] : []),
    // Which currency each amount is in — on screen when the list mixes them, and
    // in the Excel file, where the amount is a bare number.
    { key: "currency", header: "Currency", hidden: new Set(expenses.map(e => ccy(e.currency))).size < 2, sortValue: e => ccy(e.currency),
      cell: e => <span className="font-mono text-xs">{ccy(e.currency)}</span> },
    { key: "amount", header: "Amount", align: "right", kind: "number", sortValue: e => e.amount, csv: e => e.amount,
      cell: e => <CellAmount tone="out">{fmtExpenseAmount(e.amount, e.currency)}</CellAmount> },
  ];
  return (
    <div className="card-luxe p-3 sm:p-4">
      <DataTable
        id="expenses"
        noun="expense"
        rows={expenses}
        columns={columns}
        rowKey={e => e.id}
        defaultSort={{ key: "date", dir: "desc" }}
        searchText={e => [e.title, e.category, e.note, userName(e.paidToEmployeeId), clientName(e.clientId), userName(e.employeeId)].filter(Boolean).join(" ")}
        searchPlaceholder="Search expenses"
        exportName="Expenses"
        // A total per currency ("₹84,910 + A$1,200") — rupees and dollars never added.
        totals={{ amount: rows => <span className="text-destructive">{fmtCcyMix(totalsOf(rows), nilCcy)}</span> }}
        rowActions={e => [
          { label: "Delete", icon: Trash2, danger: true, onSelect: () => onDelete(e.id), show: mayDelete && e.employeeId === currentUserId },
        ]}
        emptyText={<span className="inline-flex flex-col items-center gap-1"><Receipt className="h-7 w-7 text-muted-foreground/40" /><span className="font-medium">No expenses found</span><span className="text-xs text-muted-foreground/70">Add your first expense using the button above.</span></span>}
      />
    </div>
  );
}
