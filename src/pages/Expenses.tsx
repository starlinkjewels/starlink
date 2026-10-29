import { expensesInUsd } from "@/lib/orderCost";
import { DataTable, CellMain, CellTag, CellAmount, CellDate, type DataColumn } from "@/components/DataTable";
import { useCan } from "@/hooks/useCan";
import { ActionSheet } from "@/components/ActionSheet";
import { useState, useEffect, useMemo } from "react";
import { useAuth } from "@/lib/auth";
import { loadDb, updateDb, flush, uid, fmtMoney, fmtDate, fmtExpenseAmount, DEFAULT_EXPENSE_CATEGORIES, keptValue, worksOnClientId } from "@/lib/db";
import type { DB, Expense, ExpenseCategory } from "@/lib/db";
import { ccy, ccySymbol, fmtCcyMix, sumByCcy } from "@/lib/currency";
import { motion } from "framer-motion";
import { toast } from "sonner";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AddNewItem, useAddNew } from "@/components/create/QuickCreate";
import {
  Plus, Receipt, X, Wallet,
  TrendingUp, TrendingDown, Trash2, Pencil,
} from "lucide-react";
import { filled, linkList, lockerLabel, noteText, recorded, refLink, when } from "@/components/rowDetails";
import { ExpenseEditDialog, confirmDeleteExpense, useExpenseRights } from "@/components/ExpenseEditDialog";
import { PageHeader, ScrollRow, TabBar } from "@/components/PageHeader";
import { StatStrip, type TableFilter } from "@/components/TableToolbar";
import { oneLine } from "@/components/MoneyEntryEditor";
import { useSearchParams } from "react-router-dom";

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
  const addNew = useAddNew();
  // An admin opens on every expense (the Dashboard links here with ?tab=all); "Mine" is a tab away.
  const [tabSp] = useSearchParams();
  const [tab, setTab] = useState<"mine" | "passbook">(() => (tabSp.get("tab") === "mine" ? "mine" : "passbook"));
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
  // The account last paid from (this person, this browser) — chosen already when it is still open.
  const [expLockerId, setExpLockerId] = useState(() => {
    try {
      const id = localStorage.getItem(`exp-locker:${user?.id ?? ""}`) ?? "";
      return loadDb().lockers.some(l => l.id === id && l.active !== false) ? id : "";
    } catch { return ""; }
  });
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
      // The one search box: everything the table shows about an expense —
      // what, category, note, who it was paid to, the client, who recorded it.
      const q = search.toLowerCase();
      const person = (id?: string) => (id ? db.users.find(u => u.id === id)?.name : undefined) ?? "";
      const client = (id?: string) => (id ? db.clients.find(c => c.id === id)?.companyName : undefined) ?? "";
      list = list.filter(e => [e.title, e.category, e.note, person(e.paidToEmployeeId), client(e.clientId), person(e.employeeId)]
        .some(t => (t ?? "").toLowerCase().includes(q)));
    }
    list = list.filter(e => inDateRange(e.createdAt));
    return list.sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db.expenses, db.users, db.clients, filterEmployee, filterCategory, search, dateFrom, dateTo]);

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
    // The account stays chosen — the next one is usually paid from the same — and is remembered.
    try { localStorage.setItem(`exp-locker:${user!.id}`, expLockerId); } catch { /* private window */ }
    setShowAdd(false);
    setSaving(false);
  }

  // One rule for who may edit or delete an expense, the same as Payments →
  // Expenses and an employee's salary ledger (src/lib/expenseRights.ts).
  const expenseRight = useExpenseRights();
  const [editingId, setEditingId] = useState<string | null>(null);

  async function handleDelete(id: string) {
    const e = db.expenses.find(x => x.id === id);
    if (!e) return;
    const why = expenseRight(e, "delete");
    if (why) { toast.error(why); return; }
    // Says what goes with it — its account entry, its line on a salary
    // ledger, its share of an order's cost — then removes it and its account
    // entry in one save, in place on the live cache.
    if (!(await confirmDeleteExpense(e))) return;
    setDb(loadDb());
  }

  // Closing the form (Cancel, ✕, Esc or a click outside) clears what was typed —
  // the account stays chosen, as it always did.
  const closeAdd = () => { setShowAdd(false); setError(""); setForm(EMPTY_FORM); };
  // The footer's preview of the amount; the save still reads the field itself.
  const previewAmount = Number(form.amount) > 0 ? Number(form.amount) : 0;

  // What narrows each tab's list, behind its table's one Filters button. The
  // dates are shared by both tabs, as they always were.
  const dateRange: TableFilter = { kind: "date", from: dateFrom, to: dateTo, onChange: (f, t) => { setDateFrom(f); setDateTo(t); } };
  const mineFilters: TableFilter[] = [dateRange];
  if (isAdmin) {
    // Not narrowed ("") is this tab's own default: just my expenses.
    mineFilters.push({
      kind: "select", label: "Employee", allLabel: "My Expenses", value: mineFilter === "self" ? "" : mineFilter,
      onChange: v => { setMineFilter(v || "self"); setMineClientFilter("all"); },
      options: [
        { value: "all", label: "All Employees" },
        ...staffUsers.filter(u => u.id !== user!.id).map(u => ({ value: u.id, label: `${u.name} (${u.role})` })),
      ],
    });
    // Client — only when viewing all or a specific employee.
    if (mineFilter !== "self") mineFilters.push({
      kind: "select", label: "Client", allLabel: "All Clients", value: mineClientFilter === "all" ? "" : mineClientFilter,
      onChange: v => setMineClientFilter(v || "all"),
      options: db.clients.map(c => ({ value: c.id, label: c.companyName })),
    });
  }
  const clearMine = () => { setDateFrom(""); setDateTo(""); setMineFilter("self"); setMineClientFilter("all"); };
  const passbookFilters: TableFilter[] = [
    dateRange,
    { kind: "select", label: "Staff", allLabel: "All Staff", value: filterEmployee === "all" ? "" : filterEmployee,
      onChange: v => setFilterEmployee(v || "all"),
      options: staffUsers.map(u => ({ value: u.id, label: `${u.name} (${u.role})` })) },
    { kind: "select", label: "Category", allLabel: "All Categories", value: filterCategory === "all" ? "" : filterCategory,
      onChange: v => setFilterCategory(v || "all"),
      options: allCategoriesEverUsed.map(c => ({ value: c, label: c })) },
  ];
  const clearPassbook = () => { setDateFrom(""); setDateTo(""); setFilterEmployee("all"); setFilterCategory("all"); };

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <PageHeader
        title="Expenses"
        primary={can("expenses", "add") ? { label: "Add Expense", icon: Plus, onClick: () => setShowAdd(true) } : null}
      />

      {/* ── Employee profit summary. The signs only when the three really add
          up: every expense in dollars, nothing converted or left out. ── */}
      {isEmployee && (() => {
        const sums = !!myNet && !myNet.converted && myNet.left.size === 0;
        const net = myNet?.net ?? 0;
        return (
          <StatStrip items={[
            { label: "Revenue", value: fmtMoney(myRevenue), icon: TrendingUp, sub: "Delivered orders" },
            // Can read "₹84,910 + A$1,200" — it wraps rather than being cut off.
            { label: "Expenses", value: <span className="whitespace-normal break-words">{fmtCcyMix(myTotals)}</span>, tone: "out", icon: TrendingDown, op: sums ? "−" : undefined },
            { label: "Net profit", value: `${myNet?.converted ? "≈ " : ""}${fmtMoney(net)}`, tone: "strong", icon: Wallet,
              op: sums ? "=" : undefined, sub: myNet?.converted ? "In $, at each day's rate" : undefined },
          ]} note={myNet && myNet.left.size > 0 ? `${fmtCcyMix(myNet.left)} not counted — no exchange rate on file` : undefined} />
        );
      })()}

      {/* ── Admin tabs. What the open list adds up to is under its table. ── */}
      {isAdmin && (
        <TabBar label="Expenses" value={tab} onChange={setTab}
          tabs={[{ key: "passbook", label: "All expenses" }, { key: "mine", label: "Mine" }]} />
      )}

      {/* ── My Expenses list — date range for everyone, employee/client for an admin, in its table's Filters ── */}
      {(isEmployee || (isAdmin && tab === "mine")) && (
        <ExpenseList
          expenses={myExpenses}
          onAdd={can("expenses", "add") ? () => setShowAdd(true) : undefined}
          showEmployee={isAdmin && mineFilter !== "self"}
          users={db.users}
          clients={db.clients}
          lockers={db.lockers}
          orders={db.orders}
          onDelete={handleDelete}
          onEdit={setEditingId}
          rights={expenseRight}
          filters={mineFilters}
          onClearFilters={clearMine}
          resetKey={JSON.stringify(["mine", dateFrom, dateTo, mineFilter, mineClientFilter])}
        />
      )}

      {/* ── Admin passbook ── */}
      {isAdmin && tab === "passbook" && (
        <div className="space-y-4">
          {/* Employee summary cards — a tap narrows the list to that person. On a
              phone the row scrolls sideways. */}
          {filterEmployee === "all" && employeeSummary.length > 0 && (
            <ScrollRow className="flex gap-3 p-0.5 sm:p-0 sm:grid sm:grid-cols-3 md:grid-cols-4 sm:overflow-visible">
              {employeeSummary.map(({ user: u, totals, count }) => (
                <motion.button
                  key={u.id}
                  initial={{ opacity: 0, scale: 0.97 }}
                  animate={{ opacity: 1, scale: 1 }}
                  onClick={() => setFilterEmployee(u.id)}
                  className="card-luxe p-4 text-left snap-start shrink-0 min-w-[10rem] sm:min-w-0 hover:border-primary/30 hover:shadow-md transition-all active:scale-[0.98]"
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
            </ScrollRow>
          )}

          {/* Passbook list — its search (title or note), dates, staff and
              category sit in the table's own toolbar. */}
          <ExpenseList
            expenses={passbookExpenses}
            showEmployee={true}
            users={db.users}
            clients={db.clients}
            lockers={db.lockers}
            orders={db.orders}
            onDelete={handleDelete}
            onEdit={setEditingId}
            rights={expenseRight}
            search={{ value: search, onChange: setSearch, placeholder: "Search expense, person or client…" }}
            filters={passbookFilters}
            onClearFilters={clearPassbook}
            resetKey={JSON.stringify(["passbook", dateFrom, dateTo, filterEmployee, filterCategory, search])}
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
                No accounts yet — <a href="/locker" className="underline font-medium">create one first</a>.
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
              <p className="text-[11px] text-muted-foreground mt-1">Shows on their salary ledger.</p>
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
            <Select value={form.clientId || "__none"} onValueChange={addNew("client", v => setForm(f => ({ ...f, clientId: v === "__none" ? "" : v })))}>
              <SelectTrigger className="h-10 rounded-xl bg-secondary/40"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__none">No client</SelectItem>
                {db.clients.filter(c => worksOnClientId(db, user, c.id) || c.id === form.clientId).map(c => <SelectItem key={c.id} value={c.id}>{c.companyName}</SelectItem>)}
                <AddNewItem kind="client" />
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

      {/* Edit Expense — the same side panel as Add, every field, its account entry in step. */}
      <ExpenseEditDialog expenseId={editingId} onClose={() => { setEditingId(null); setDb(loadDb()); }} />
    </div>
  );
}

/* ─── Expense List Component ─────────────────────────────────────────────── */

interface ExpenseListProps {
  expenses: Expense[];
  /** The next step in an empty list (new look): add an expense. */
  onAdd?: () => void;
  showEmployee: boolean;
  users: any[];
  clients: any[];
  /** For an opened row: the account it was paid from, the orders it was for. */
  lockers: DB["lockers"];
  orders: DB["orders"];
  onDelete: (id: string) => void;
  onEdit: (id: string) => void;
  /** Why this person may not edit / delete an expense — nothing when they may. */
  rights: (e: Expense, action: "edit" | "delete") => string | undefined;
  /** The page's own search, when the page narrows the list itself (the passbook). */
  search?: { value: string; onChange: (v: string) => void; placeholder?: string };
  /** What else narrows the list — the table's Filters button and chips. */
  filters?: TableFilter[];
  onClearFilters?: () => void;
  /** Changes with the page's filters, so the table starts again from page 1. */
  resetKey?: string;
}

function ExpenseList({ expenses, onAdd, showEmployee, users, clients, lockers, orders, onDelete, onEdit, rights, search, filters, onClearFilters, resetKey }: ExpenseListProps) {
  const can = useCan();
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
    // Not on a phone card: its amount already shows the currency ($38, ₹2,100).
    { key: "currency", header: "Currency", card: "hide", hidden: new Set(expenses.map(e => ccy(e.currency))).size < 2, sortValue: e => ccy(e.currency),
      cell: e => <span className="font-mono text-xs">{ccy(e.currency)}</span> },
    { key: "amount", card: "figure" as const, header: "Amount", align: "right", kind: "number", sortValue: e => e.amount, csv: e => e.amount,
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
        search={search}
        filters={filters}
        onClearFilters={onClearFilters}
        resetKey={resetKey}
        exportName="Expenses"
        // A total per currency ("₹84,910 + A$1,200") — rupees and dollars never added.
        totals={{ amount: rows => <span className="text-destructive">{fmtCcyMix(totalsOf(rows), nilCcy)}</span> }}
        // Your own, or anyone's for an admin / Expenses access — otherwise
        // greyed, naming who added it.
        rowActions={e => {
          const editWhy = rights(e, "edit"), delWhy = rights(e, "delete");
          return [
            { label: "Edit", icon: Pencil, onSelect: () => onEdit(e.id), disabled: !!editWhy, hint: oneLine(editWhy) ?? "With its account entry" },
            { label: "Delete", icon: Trash2, danger: true, onSelect: () => onDelete(e.id), disabled: !!delWhy, hint: oneLine(delWhy) },
          ];
        }}
        // Opened: the account it was paid from, who recorded it and when, the note
        // as typed, and the client and orders it was for.
        details={e => filled([
          { label: "Paid from", value: lockerLabel({ lockers }, e.lockerId) },
          { label: "Recorded", value: showEmployee ? when(e.createdAt) : recorded({ users }, e.createdAt, e.employeeId) },
          { label: "Note", value: noteText(e.note) },
          !!e.clientId && can("clients") && { label: "Client page", value: refLink(`/clients/${e.clientId}`, clientName(e.clientId) || "Client") },
          !!e.orderIds?.length && { label: e.orderIds.length > 1 ? "For orders" : "For order", value: linkList(e.orderIds.map(id => {
            const o = orders.find(x => x.id === id);
            return { key: id, node: refLink(`/orders/${id}`, o?.orderNumber ?? "Order", can("orders")) };
          })) },
          { label: "Shipment", value: e.shipmentRef },
        ])}
        emptyText="No expenses yet."
        emptyAction={!expenses.length && onAdd ? { label: "Add an expense", onClick: onAdd } : undefined}
      />
    </div>
  );
}
