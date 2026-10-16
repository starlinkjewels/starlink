import { useMayExport } from "@/hooks/useCan";
import { MoreMenu } from "@/components/MoreMenu";
import { useState } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { loadDb, fmtMoney, fmtDate, fmtExpenseAmount, totalAdvance, balanceDue, employeePayments, employeePaymentTotals, keptValue, type Client, type Order } from "@/lib/db";
import { DataTable, CellMain, CellAmount, CellDate, type DataColumn } from "@/components/DataTable";
import { useDb } from "@/hooks/useDb";
import { StatusBadge } from "@/components/StatusBadge";
import { Button } from "@/components/ui/button";
import { TasksPanel } from "@/components/TasksPanel";
import {
  ArrowLeft, Mail, Phone, Building2, Users,
  CheckCircle2, Clock, ListTodo, Wallet, Receipt, FileSpreadsheet, FileText,
} from "lucide-react";
import { motion } from "framer-motion";
import { downloadCsv, downloadLedgerPdf } from "@/lib/ledgerExport";
import { ccy, ccyOrder, fmtCcyMix, fmtCcyPdf, sumByCcy } from "@/lib/currency";
import { StatementLedger, type StatementRow } from "@/components/StatementLedger";

export function EmployeeDetailPage() {
  const mayExport = useMayExport();
  const { id } = useParams();
  const navigate = useNavigate();
  const db = useDb();
  const [tasksOpen, setTasksOpen] = useState(false);

  // Salary is payable to any staff member — employees AND the admin/owner.
  const employee = db.users.find(u => u.id === id && (u.role === "employee" || u.role === "admin"));
  if (!employee) {
    return (
      <div className="text-center py-20 text-muted-foreground">
        Employee not found.{" "}
        <Link to="/employees" className="text-primary underline">Back to Employees</Link>
      </div>
    );
  }

  const clients = db.clients.filter(c => c.accountManagerId === employee.id);
  const clientIds = new Set(clients.map(c => c.id));
  const orders = db.orders
    .filter(o => clientIds.has(o.clientId))
    .sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));

  const activeOrders = orders.filter(o => !["Delivered", "Rejected"].includes(o.status)).length;
  const deliveredOrders = orders.filter(o => o.status === "Delivered").length;
  const totalValue = orders.reduce((s, o) => s + keptValue(o), 0);

  const tasks = (db.tasks ?? []).filter(t => t.assignedTo === employee.id);
  const pendingTasks = tasks.filter(t => !t.completed).length;
  const doneTasks = tasks.filter(t => t.completed).length;

  // ── Assigned Clients and Order Activity: the shared table ──
  const orderStats = new Map<string, { total: number; active: number }>();
  for (const o of orders) {
    const s = orderStats.get(o.clientId) ?? { total: 0, active: 0 };
    s.total++;
    if (!["Delivered", "Rejected"].includes(o.status)) s.active++;
    orderStats.set(o.clientId, s);
  }
  const statsOf = (clientId: string) => orderStats.get(clientId) ?? { total: 0, active: 0 };
  const clientColumns: DataColumn<Client>[] = [
    { key: "client", header: "Client", always: true, sortValue: c => c.companyName, csv: c => c.companyName,
      cell: c => <CellMain title={c.companyName} sub={c.ownerName || undefined} /> },
    { key: "orders", header: "Orders", align: "right", kind: "number", sortValue: c => statsOf(c.id).total,
      cell: c => <span className="tabular-nums">{statsOf(c.id).total}</span> },
    { key: "active", header: "Active", align: "right", kind: "number", sortValue: c => statsOf(c.id).active,
      cell: c => { const n = statsOf(c.id).active; return <span className={`tabular-nums ${n > 0 ? "font-medium text-primary" : "text-muted-foreground/60"}`}>{n}</span>; } },
  ];
  const clientName = (id: string) => clients.find(c => c.id === id)?.companyName ?? "";
  const orderColumns: DataColumn<Order>[] = [
    { key: "order", header: "Order", always: true, sortValue: o => o.orderNumber,
      cell: o => <CellMain title={<span className="font-mono text-xs font-semibold">{o.orderNumber}</span>} sub={o.jewelleryType} /> },
    { key: "client", header: "Client", sortValue: o => clientName(o.clientId),
      cell: o => <span className="block max-w-[180px] truncate">{clientName(o.clientId) || "—"}</span> },
    { key: "date", header: "Date", kind: "date", sortValue: o => o.createdAt, cell: o => <CellDate>{fmtDate(o.createdAt)}</CellDate> },
    // Green once it is paid in full.
    { key: "amount", header: "Amount", align: "right", kind: "number", sortValue: o => o.amount,
      cell: o => <CellAmount tone={balanceDue(o) === 0 && totalAdvance(o) > 0 ? "in" : undefined}>{fmtMoney(o.amount)}</CellAmount> },
    { key: "status", header: "Status", sortValue: o => o.status, cell: o => <StatusBadge status={o.status} /> },
  ];

  // Salary / wages / advances paid to this employee (expenses tagged to them).
  const salaryLedger = employeePayments(db.expenses, employee.id);
  const rawTotals = employeePaymentTotals(db.expenses, employee.id, new Date().getFullYear());
  // Opening amount already paid before the app (migration) — folded into totals
  // and shown as the ledger's first line.
  const opening = employee.openingPaid && employee.openingPaid > 0 ? employee.openingPaid : 0;
  const openingCur = ccy(employee.openingPaidCurrency);
  const openingInThisYear = opening > 0 && employee.openingPaidDate
    ? new Date(employee.openingPaidDate).getFullYear() === new Date().getFullYear()
    : false;

  // Downloadable salary ledger (opening row + each payment).
  const year = new Date().getFullYear();
  const salaryRows = [
    ...(opening > 0 ? [{ date: employee.openingPaidDate || employee.createdAt, particulars: "Opening (brought forward)", category: "Opening", amount: opening, currency: openingCur, thisYear: openingInThisYear }] : []),
    ...salaryLedger.map(e => ({ date: e.createdAt, particulars: e.title, category: e.category, amount: e.amount, currency: ccy(e.currency), thisYear: new Date(e.createdAt).getFullYear() === year })),
  ];
  // Paid from several accounts (rupees, dollars, AUD…), each currency is
  // totalled on its own — never added together. One currency, as nearly
  // always, reads as the single figure it always did.
  const salaryTotals = {
    total: sumByCcy(salaryRows, r => r.amount, r => r.currency),
    count: rawTotals.count + (opening > 0 ? 1 : 0),
    thisYear: sumByCcy(salaryRows.filter(r => r.thisYear), r => r.amount, r => r.currency),
  };
  const salaryCcys = [...new Set(salaryRows.map(r => r.currency))].sort(ccyOrder);
  // A nil total reads in the one currency paid in ("$0"), else in rupees.
  const nilCcy = salaryCcys.length === 1 ? salaryCcys[0] : "INR";
  // Salary rows as a proper statement: oldest first with a running total of
  // everything paid to this person, opening included — one statement per
  // currency, since a running total cannot add rupees to dollars.
  const statementIn = (code: string): StatementRow[] => {
    let running = 0;
    // The running total can only be worked out oldest-first; the list is read
    // newest-first, so it is reversed after the balances are in (see the
    // .reverse() at the end).
    return salaryRows
      .filter(r => r.currency === code)
      .sort((a, b) => +new Date(a.date) - +new Date(b.date))
      .map((r, i) => {
        running = Math.round((running + r.amount) * 100) / 100;
        return {
          id: `${r.date}-${i}`,
          date: r.date,
          particulars: r.particulars,
          kind: r.category,
          debit: r.amount,
          credit: 0,
          balance: running,
          pinned: r.category === "Opening",
        };
      })
      .reverse();
  };


  // jsPDF's built-in font can't render ₹ — fmtCcyPdf writes "Rs." (and the
  // code for any symbol it may not draw). Totals per currency: "Rs. 84,910 + AUD 1,200".
  const pdfMix = (m: Map<string, number>) => {
    const parts = [...m.entries()].filter(([, v]) => Math.abs(v) > 0.0001).sort(([a], [b]) => ccyOrder(a, b));
    return parts.length ? parts.map(([c, v]) => fmtCcyPdf(v, c)).join(" + ") : fmtCcyPdf(0, nilCcy);
  };
  const exportSalaryCsv = () => downloadCsv(
    `Salary-${employee.name.replace(/\s+/g, "_")}`,
    ["Date", "Particulars", "Category", "Amount", "Currency"],
    salaryRows.map(r => [fmtDate(r.date), r.particulars, r.category, Math.round(r.amount), r.currency]),
  );
  const exportSalaryPdf = () => downloadLedgerPdf({
    title: "Salary Ledger",
    subjectLines: [
      `Name: ${employee.name}`,
      employee.department ? `Department: ${employee.department}` : "",
      `Total paid to date: ${pdfMix(salaryTotals.total)}`,
      `Report Generated: ${new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}`,
    ].filter(Boolean),
    summary: [],
    columns: [{ header: "Date", x: 20 }, { header: "Particulars", x: 55 }, { header: "Category", x: 120 }, { header: "Amount", x: 175 }],
    align: ["left", "left", "left", "right"],
    rows: salaryRows.map(r => [fmtDate(r.date), r.particulars.slice(0, 34), r.category, fmtCcyPdf(r.amount, r.currency)]),
    totalsRow: ["", "", "Total", pdfMix(salaryTotals.total)],
    filename: `Salary-${employee.name.replace(/\s+/g, "_")}`,
  });

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <button onClick={() => navigate("/employees")} className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors">
        <ArrowLeft className="h-4 w-4" /> Back to Employees
      </button>

      {/* Employee Profile Card */}
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="card-luxe p-6">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="flex items-start gap-4">
            <div className="h-14 w-14 rounded-full bg-gradient-to-br from-primary to-brand-dark text-white font-semibold grid place-items-center shrink-0 text-xl">
              {employee.name.charAt(0)}
            </div>
            <div>
              <div className="flex items-center gap-3 flex-wrap">
                <h1 className="font-display text-2xl md:text-3xl text-brand-dark">{employee.name}</h1>
                <StatusBadge status={employee.status} />
              </div>
              <p className="text-muted-foreground mt-1">{employee.department || "—"}</p>
            </div>
          </div>
          <Button onClick={() => setTasksOpen(true)} className="btn-hero rounded-xl gap-2">
            <ListTodo className="h-4 w-4" /> Assign / View Tasks
          </Button>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-6 text-sm">
          <div className="flex items-start gap-2">
            <Mail className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
            <div><p className="text-xs text-muted-foreground">Email</p><p className="font-medium break-all">{employee.email || "—"}</p></div>
          </div>
          <div className="flex items-start gap-2">
            <Phone className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
            <div><p className="text-xs text-muted-foreground">Phone</p><p className="font-medium">{employee.phone || "—"}</p></div>
          </div>
          <div className="flex items-start gap-2">
            <Clock className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
            <div><p className="text-xs text-muted-foreground">Joined</p><p className="font-medium">{fmtDate(employee.createdAt)}</p></div>
          </div>
          <div className="flex items-start gap-2">
            <Building2 className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
            <div><p className="text-xs text-muted-foreground">Username</p><p className="font-medium font-mono text-xs">{employee.username}</p></div>
          </div>
        </div>
      </motion.div>

      {/* Summary Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: "Assigned Clients", value: clients.length, icon: Users, color: "text-primary", bg: "from-primary/10 to-brand-light/10" },
          { label: "Active Orders", value: activeOrders, icon: Clock, color: "text-warning-foreground", bg: "from-warning/10 to-orange-400/10" },
          { label: "Tasks Pending", value: pendingTasks, icon: ListTodo, color: "text-destructive", bg: "from-destructive/10 to-red-400/10" },
          { label: "Tasks Done", value: doneTasks, icon: CheckCircle2, color: "text-success", bg: "from-success/10 to-emerald-400/10" },
        ].map((s, i) => (
          <motion.div key={s.label} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}
            className={`card-luxe p-4 bg-gradient-to-br ${s.bg}`}>
            <div className={`h-9 w-9 rounded-xl bg-white/80 grid place-items-center mb-3 ${s.color}`}>
              <s.icon className="h-5 w-5" />
            </div>
            <p className="text-2xl font-display font-bold text-brand-dark">{s.value}</p>
            <p className="text-xs text-muted-foreground mt-1">{s.label}</p>
          </motion.div>
        ))}
      </div>

      {/* Salary & Payments ledger — total paid to this team member */}
      <div className="card-luxe overflow-hidden">
        <div className="px-5 py-4 border-b border-border/60 flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-emerald-500/10 grid place-items-center shrink-0">
              <Wallet className="h-5 w-5 text-emerald-600" />
            </div>
            <div>
              <h2 className="font-display text-xl text-brand-dark">Salary &amp; Payments</h2>
              <p className="text-xs text-muted-foreground mt-0.5">{salaryTotals.count} payment{salaryTotals.count !== 1 ? "s" : ""}{opening > 0 ? " (incl. opening)" : ""}</p>
            </div>
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            <div className="text-right">
              <p className="text-[11px] text-muted-foreground">This year</p>
              <p className="font-semibold text-sm text-brand-dark">{fmtCcyMix(salaryTotals.thisYear, nilCcy)}</p>
            </div>
            <div className="text-right pl-3 border-l border-border/60">
              <p className="text-[11px] text-muted-foreground">Total paid to date</p>
              <p className="font-display text-lg font-bold text-emerald-600">{fmtCcyMix(salaryTotals.total, nilCcy)}</p>
            </div>
            {(salaryLedger.length > 0 || opening > 0) && mayExport && (
              <div className="pl-3 border-l border-border/60">
                <MoreMenu size="sm" label="Download salary sheet" title="Salary sheet" actions={[
                  { label: "Download PDF", icon: FileText, onSelect: exportSalaryPdf },
                  { label: "Download Excel", icon: FileSpreadsheet, onSelect: exportSalaryCsv },
                ]} />
              </div>
            )}
          </div>
        </div>
        {salaryLedger.length === 0 && opening === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
            <Wallet className="h-10 w-10 mb-2 opacity-20" />
            <p className="text-sm">No salary or payments recorded yet.</p>
            <p className="text-xs mt-1">Record one from <span className="font-medium">Payments → Pay Expense</span> or the Expenses page, and tag it to this member.</p>
          </div>
        ) : (
          /* Same ledger shape as every other account: search, a date range, a
             type filter and a running total paid. One ledger per currency paid
             in — almost always just the one, exactly as before. */
          salaryCcys.map(code => {
            const rows = statementIn(code);
            const n = rows.length;
            const single = salaryCcys.length === 1;
            return (
              <StatementLedger
                key={code}
                title={single ? "Salary & Payments" : `Salary & Payments — ${code}`}
                caption={`${n} payment${n !== 1 ? "s" : ""}${single ? "" : ` in ${code}`}${opening > 0 && openingCur === code ? " (incl. opening)" : ""} · running total paid`}
                rows={rows}
                fmt={(v: number) => fmtExpenseAmount(v, code)}
                debitLabel="Paid"
                creditLabel=""
                summary={[
                  { label: "Paid this year", value: fmtExpenseAmount(salaryTotals.thisYear.get(code) ?? 0, code) },
                  { label: "Paid to date", value: fmtExpenseAmount(salaryTotals.total.get(code) ?? 0, code), tone: "in" },
                  { label: "Payments", value: String(n) },
                ]}
              />
            );
          })
        )}
      </div>


      {/* Task progress bar */}
      {tasks.length > 0 && (
        <div className="card-luxe p-5">
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm font-medium">Task Completion</p>
            <p className="text-xs text-muted-foreground">{doneTasks} of {tasks.length} done</p>
          </div>
          <div className="h-2 rounded-full bg-secondary overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-success to-emerald-400"
              style={{ width: `${tasks.length ? Math.round((doneTasks / tasks.length) * 100) : 0}%` }}
            />
          </div>
        </div>
      )}

      {/* Assigned Clients */}
      <div className="card-luxe overflow-hidden">
        <div className="px-5 py-4 border-b border-border/60">
          <h2 className="font-display text-xl text-brand-dark">Assigned Clients</h2>
          <p className="text-xs text-muted-foreground mt-0.5">{clients.length} client{clients.length !== 1 ? "s" : ""} · {orders.length} total orders · {fmtMoney(totalValue)}</p>
        </div>
        {clients.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-14 text-muted-foreground">
            <Users className="h-10 w-10 mb-2 opacity-20" />
            <p className="text-sm">No clients assigned to this employee yet.</p>
          </div>
        ) : (
          <div className="p-3 sm:p-4">
            <DataTable
              id="employee-clients"
              noun="client"
              rows={clients}
              columns={clientColumns}
              rowKey={c => c.id}
              rowHref={c => `/clients/${c.id}`}
              // Just the table for a handful; search, columns and Excel once it grows.
              controls={clients.length > 10 ? "full" : "none"}
              searchText={c => `${c.companyName} ${c.ownerName}`}
              searchPlaceholder="Search clients"
              exportName={`Clients-${employee.name.replace(/\s+/g, "_")}`}
              pageSizes={[10, 25, 50]}
            />
          </div>
        )}
      </div>

      {/* Recent orders across all assigned clients */}
      {orders.length > 0 && (
        <div className="card-luxe overflow-hidden">
          <div className="px-5 py-4 border-b border-border/60 flex items-center justify-between">
            <div>
              <h2 className="font-display text-xl text-brand-dark">Order Activity</h2>
              <p className="text-xs text-muted-foreground mt-0.5">{deliveredOrders} delivered · {activeOrders} active</p>
            </div>
          </div>
          <div className="p-3 sm:p-4">
            <DataTable
              id="employee-orders"
              noun="order"
              rows={orders.slice(0, 12)}
              columns={orderColumns}
              rowKey={o => o.id}
              defaultSort={{ key: "date", dir: "desc" }}
              rowHref={o => `/orders/${o.id}`}
              controls="none"
            />
          </div>
        </div>
      )}

      <TasksPanel userId={employee.id} open={tasksOpen} onClose={() => setTasksOpen(false)} asAdmin />
    </div>
  );
}
