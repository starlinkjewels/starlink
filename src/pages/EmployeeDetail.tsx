import { UserAvatar } from "@/components/UserAvatar";
import { stageLabel } from "@/lib/stages";
import { useMayExport } from "@/hooks/useCan";
import type { MoreAction } from "@/components/MoreMenu";
import { EmployeeEditDialog } from "@/components/EmployeeEditDialog";
import { ExpenseEditDialog, confirmDeleteExpense, useExpenseRights } from "@/components/ExpenseEditDialog";
import { confirmDeleteEmployee, employeeDeleteBlock } from "@/lib/employeeGuards";
import { useState } from "react";
import { OrderThumb } from "@/components/OrderThumb";
import { useParams, Link, useNavigate } from "react-router-dom";
import { loadDb, fmtMoney, fmtDate, fmtExpenseAmount, totalAdvance, balanceDue, orderTotal, findInvoiceForOrder, employeePayments, employeePaymentTotals, keptValue, type Client, type Order } from "@/lib/db";
import { filled, when, userName, refLink, refNo, type Detail } from "@/components/rowDetails";
import { DataTable, CellMain, CellAmount, CellDate, type DataColumn } from "@/components/DataTable";
import { useDb } from "@/hooks/useDb";
import { StatusBadge } from "@/components/StatusBadge";
import { PageHeader } from "@/components/PageHeader";
import { SectionTitle } from "@/components/SectionTitle";
import { StatStrip } from "@/components/TableToolbar";
import { TasksPanel } from "@/components/TasksPanel";
import {
  Mail, Phone, Building2, Users,
  CheckCircle2, Clock, ListTodo, Wallet, Receipt, FileSpreadsheet, FileText, Pencil, Trash2,
} from "lucide-react";
import { motion } from "framer-motion";
import { downloadCsv, downloadLedgerPdf } from "@/lib/ledgerExport";
import { ccy, ccyOrder, fmtCcyPdf, sumByCcy } from "@/lib/currency";
import { StatementLedger, type StatementRow } from "@/components/StatementLedger";

export function EmployeeDetailPage() {
  const mayExport = useMayExport();
  const { id } = useParams();
  const navigate = useNavigate();
  const db = useDb();
  const [tasksOpen, setTasksOpen] = useState(false);
  // Their details (and opening salary), and a salary payment — each in its panel.
  const [editingSelf, setEditingSelf] = useState(false);
  const [editingExpense, setEditingExpense] = useState<string | null>(null);
  const expenseRight = useExpenseRights();

  // Salary is payable to any staff member — employees AND the admin/owner.
  const employee = db.users.find(u => u.id === id && (u.role === "employee" || u.role === "admin"));
  if (!employee) {
    return (
      <div className="text-center py-20 text-muted-foreground">
        Employee not found.{" "}
        <Link to="/employees" className="inline-block py-2.5 -my-2.5 text-primary underline">Back to Employees</Link>
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
      cell: o => <div className="flex items-center gap-2.5 min-w-0"><OrderThumb o={o} size="sm" /><CellMain title={<span className="font-mono text-xs font-semibold">{o.orderNumber}</span>} sub={o.jewelleryType} /></div> },
    { key: "client", header: "Client", sortValue: o => clientName(o.clientId),
      cell: o => <span className="block max-w-[180px] truncate">{clientName(o.clientId) || "—"}</span> },
    { key: "date", header: "Date", kind: "date", sortValue: o => o.createdAt, cell: o => <CellDate>{fmtDate(o.createdAt)}</CellDate> },
    // Green once it is paid in full.
    { key: "amount", header: "Amount", align: "right", kind: "number", sortValue: o => o.amount,
      cell: o => <CellAmount tone={balanceDue(o) === 0 && totalAdvance(o) > 0 ? "in" : undefined}>{fmtMoney(o.amount)}</CellAmount> },
    { key: "status", header: "Status", sortValue: o => o.status, cell: o => <StatusBadge status={o.status} /> },
  ];

  // What an opened client adds: how to reach them, what they owe, their newest order.
  const clientDetails = (c: Client): Detail[] => {
    const mine = orders.filter(o => o.clientId === c.id);
    const owed = mine.filter(o => o.status !== "Rejected").reduce((s, o) => s + balanceDue(o), 0);
    const last = mine[0]; // newest first
    return filled([
      { label: "Email", value: c.email },
      { label: "Phone", value: c.phone },
      { label: "Country", value: c.country },
      { label: "Client since", value: fmtDate(c.createdAt) },
      c.status !== "active" && { label: "Status", value: "Inactive" },
      { label: "Outstanding", value: owed > 0 ? <span className="font-semibold text-destructive">{fmtMoney(owed)}</span> : "Cleared" },
      !!last && { label: "Last order", value: <>{refLink(`/orders/${last.id}`, last.orderNumber)} · {fmtDate(last.createdAt)} · {last.status}</> },
    ]);
  };
  // What an opened order adds: the piece, its stage, what is paid and its invoice.
  const orderDetails = (o: Order): Detail[] => {
    const st = o.timeline.find(t => t.status === "in_progress") ?? [...o.timeline].reverse().find(t => t.status === "done");
    const total = orderTotal(o), due = balanceDue(o);
    const inv = findInvoiceForOrder(db.invoices, o.id);
    return filled([
      { label: "Piece", value: [o.metal, o.productKarats, `${o.quantity} pc${o.quantity !== 1 ? "s" : ""}`, o.designNumber && `design ${o.designNumber}`].filter(Boolean).join(" · ") },
      !!st && { label: "Stage", value: [stageLabel(st.step), st.date && when(st.date)].filter(Boolean).join(" · ") },
      { label: "Placed", value: when(o.createdAt) },
      { label: "Due", value: o.expectedDelivery && fmtDate(o.expectedDelivery) },
      { label: "Assigned to", value: userName(db, o.assignedEmployeeId) },
      total > 0 && Math.abs(total - o.amount) > 0.005 && { label: "Order total", value: fmtMoney(total) },
      total > 0 && { label: "Paid", value: fmtMoney(totalAdvance(o)) },
      total > 0 && { label: "Balance due", value: due > 0 ? <span className="font-semibold text-destructive">{fmtMoney(due)}</span> : "Cleared" },
      !!inv && { label: "Invoice", value: refNo(inv.number) },
    ]);
  };

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
  // Each payment keeps its expense's id, so a row's ⋯ edits or deletes that
  // very expense; the opening line is the person's own figure.
  const OPENING_ID = "__opening";
  const salaryRows = [
    ...(opening > 0 ? [{ id: OPENING_ID, date: employee.openingPaidDate || employee.createdAt, particulars: "Opening (brought forward)", category: "Opening", amount: opening, currency: openingCur, thisYear: openingInThisYear }] : []),
    ...salaryLedger.map(e => ({ id: e.id, date: e.createdAt, particulars: e.title, category: e.category, amount: e.amount, currency: ccy(e.currency), thisYear: new Date(e.createdAt).getFullYear() === year })),
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
      .map(r => {
        running = Math.round((running + r.amount) * 100) / 100;
        return {
          // The opening line once per currency's statement — never twice in one.
          id: r.id === OPENING_ID ? `${OPENING_ID}-${code}` : r.id,
          date: r.date,
          particulars: r.particulars,
          kind: r.category,
          debit: r.amount,
          credit: 0,
          balance: running,
          pinned: r.id === OPENING_ID,
        };
      })
      .reverse();
  };

  /** A salary line's ⋯. A payment is an expense: edited in the expense panel
   *  (its account entry moves with it), deleted with what that changes —
   *  by the one rule for expenses everywhere. The opening line is this
   *  person's own figure, corrected with their details. */
  const salaryRowActions = (r: StatementRow): MoreAction[] => {
    if (r.id.startsWith(OPENING_ID)) {
      return [{ label: "Edit opening amount", icon: Pencil, hint: "Already paid before this app", onSelect: () => setEditingSelf(true) }];
    }
    const x = db.expenses.find(e => e.id === r.id);
    if (!x) return [];
    const editWhy = expenseRight(x, "edit"), delWhy = expenseRight(x, "delete");
    return [
      { label: "Edit", icon: Pencil, hint: editWhy ?? "Its account entry moves with it", disabled: !!editWhy, onSelect: () => setEditingExpense(x.id) },
      { label: "Delete", icon: Trash2, danger: true, hint: delWhy, disabled: !!delWhy, onSelect: () => confirmDeleteExpense(x) },
    ];
  };

  // The profile's ⋯: their details, and deleting them — greyed, saying why,
  // when the books still point at them.
  const delBlock = employeeDeleteBlock(db, employee);
  const profileActions: MoreAction[] = [
    { label: "Edit details", icon: Pencil, hint: "Name, phone, department, login, opening salary", onSelect: () => setEditingSelf(true) },
    { label: "Delete", icon: Trash2, danger: true, hint: delBlock ?? "Removes them and their login", disabled: !!delBlock,
      onSelect: async () => { if (await confirmDeleteEmployee(employee)) navigate("/employees"); } },
  ];


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
      `Report Generated: ${new Date().toLocaleDateString("en-IN", { month: "long", day: "numeric", year: "numeric" })}`,
    ].filter(Boolean),
    summary: [],
    columns: [{ header: "Date", x: 20 }, { header: "Particulars", x: 55 }, { header: "Category", x: 120 }, { header: "Amount", x: 175 }],
    align: ["left", "left", "left", "right"],
    rows: salaryRows.map(r => [fmtDate(r.date), r.particulars.slice(0, 34), r.category, fmtCcyPdf(r.amount, r.currency)]),
    totalsRow: ["", "", "Total", pdfMix(salaryTotals.total)],
    filename: `Salary-${employee.name.replace(/\s+/g, "_")}`,
  });

  // The salary sheet's downloads and the opening amount sit in the page's ⋯
  // with the rest — the opening line is pinned, and a pinned line has no ⋯ of
  // its own.
  const hasSalary = salaryLedger.length > 0 || opening > 0;
  const salaryMenu: MoreAction[] = [
    { label: opening > 0 ? "Edit opening amount" : "Add opening amount", icon: Wallet, hint: "Paid before this app", onSelect: () => setEditingSelf(true) },
    { label: "Salary sheet — PDF", icon: FileText, hint: "Every payment, with the total", onSelect: exportSalaryPdf, show: hasSalary && mayExport },
    { label: "Salary sheet — Excel", icon: FileSpreadsheet, hint: "Opens in Excel or Google Sheets", onSelect: exportSalaryCsv, show: hasSalary && mayExport },
  ];

  const taskBar = tasks.length ? Math.round((doneTasks / tasks.length) * 100) : 0;

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      {/* The name row and what can be done to them; their facts in the card below. */}
      <PageHeader
        back={{ label: "Back to Employees", to: "/employees" }}
        title={employee.name}
        subtitle={employee.department || undefined}
        primary={{ label: "Assign / View Tasks", icon: ListTodo, onClick: () => setTasksOpen(true) }}
        menu={[...profileActions, ...salaryMenu]}
      >
        <div className="mt-2"><StatusBadge status={employee.status} /></div>
      </PageHeader>

      {/* Employee Profile Card */}
      {/* On a phone the facts get the card's whole width (no avatar) and the
          email and username a row each; long values are cut with "…" and
          given whole on hover, never broken mid-word. */}
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="card-luxe p-5 sm:p-6 flex items-start gap-4">
        <div className="hidden sm:block shrink-0">
          <UserAvatar photo={employee.photo} name={employee.name} className="h-14 w-14 rounded-full font-semibold text-xl" />
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm flex-1 min-w-0">
          <div className="col-span-2 md:col-span-1 flex items-start gap-2 min-w-0">
            <Mail className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
            <div className="min-w-0"><p className="text-xs text-muted-foreground">Email</p><p className="font-medium truncate" title={employee.email || undefined}>{employee.email || "—"}</p></div>
          </div>
          <div className="flex items-start gap-2">
            <Phone className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
            <div><p className="text-xs text-muted-foreground">Phone</p><p className="font-medium">{employee.phone || "—"}</p></div>
          </div>
          <div className="flex items-start gap-2">
            <Clock className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
            <div><p className="text-xs text-muted-foreground">Joined</p><p className="font-medium">{fmtDate(employee.createdAt)}</p></div>
          </div>
          <div className="col-span-2 md:col-span-1 flex items-start gap-2 min-w-0">
            <Building2 className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
            <div className="min-w-0"><p className="text-xs text-muted-foreground">Username</p><p className="font-medium font-mono text-xs truncate" title={employee.username}>{employee.username}</p></div>
          </div>
        </div>
      </motion.div>

      {/* Their work at a glance; how far the tasks have got is under Tasks done. */}
      <StatStrip items={[
        { label: "Assigned clients", value: String(clients.length), icon: Users, sub: `${orders.length} order${orders.length !== 1 ? "s" : ""}` },
        { label: "Active orders", value: String(activeOrders), icon: Clock, sub: `${deliveredOrders} delivered` },
        { label: "Tasks pending", value: String(pendingTasks), icon: ListTodo, tone: pendingTasks > 0 ? "out" : undefined },
        { label: "Tasks done", value: String(doneTasks), icon: CheckCircle2, tone: "in", sub: tasks.length ? `${taskBar}% of ${tasks.length}` : undefined },
      ]} />

      {/* Salary & Payments: the ledgers carry their own totals and title. */}
      {!hasSalary ? (
        <div className="card-luxe overflow-hidden">
          <SectionTitle title="Salary & Payments" className="px-5 py-4 border-b border-border/60"
            info={<>Record one from <span className="font-medium">Payments → Pay Expense</span> or the Expenses page, tagged to this member.</>} />
          <div className="flex flex-col items-center justify-center py-12 text-muted-foreground px-5 text-center">
            <Wallet className="h-10 w-10 mb-2 opacity-20" />
            <p className="text-sm">No salary paid yet.</p>
            <button type="button" onClick={() => setEditingSelf(true)} className="mt-3 text-xs text-primary hover:underline font-medium">Add opening amount</button>
          </div>
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
              caption={`${n} payment${n !== 1 ? "s" : ""}${single ? "" : ` in ${code}`}${opening > 0 && openingCur === code ? " (incl. opening)" : ""}`}
              rows={rows}
              fmt={(v: number) => fmtExpenseAmount(v, code)}
              debitLabel="Paid"
              creditLabel=""
              // Edit / Delete the expense behind each payment.
              rowActions={salaryRowActions}
              summary={[
                { label: "Paid this year", value: fmtExpenseAmount(salaryTotals.thisYear.get(code) ?? 0, code) },
                { label: "Paid to date", value: fmtExpenseAmount(salaryTotals.total.get(code) ?? 0, code), tone: "in" },
                { label: "Payments", value: String(n) },
              ]}
            />
          );
        })
      )}

      {/* Assigned Clients — how many, and their orders, are the strip's above. */}
      <div className="card-luxe overflow-hidden">
        <SectionTitle title="Assigned Clients" sub={orders.length ? `${fmtMoney(totalValue)} in orders` : undefined} className="px-5 py-4 border-b border-border/60" />
        {clients.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-14 text-muted-foreground">
            <Users className="h-10 w-10 mb-2 opacity-20" />
            <p className="text-sm">No clients assigned yet.</p>
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
              details={clientDetails}
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
          {/* What the list holds; the counts are the strip's above. */}
          <SectionTitle title="Order Activity" sub={`Newest ${Math.min(12, orders.length)} of ${orders.length}`} className="px-5 py-4 border-b border-border/60" />
          <div className="p-3 sm:p-4">
            <DataTable
              id="employee-orders"
              noun="order"
              rows={orders.slice(0, 12)}
              columns={orderColumns}
              rowKey={o => o.id}
              defaultSort={{ key: "date", dir: "desc" }}
              rowHref={o => `/orders/${o.id}`}
              details={orderDetails}
              exportName={`Orders-${employee.name.replace(/\s+/g, "-")}`}
            />
          </div>
        </div>
      )}

      <TasksPanel userId={employee.id} open={tasksOpen} onClose={() => setTasksOpen(false)} asAdmin />
      <EmployeeEditDialog userId={editingSelf ? employee.id : null} onClose={() => setEditingSelf(false)} />
      <ExpenseEditDialog expenseId={editingExpense} onClose={() => setEditingExpense(null)} />
    </div>
  );
}
