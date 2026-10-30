import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { PenTool, Pencil, Wallet, FolderOpen, CheckCircle2, CalendarDays, IndianRupee, Receipt } from "lucide-react";
import { fmtDate, currentUserOrders, type LockerTransaction } from "@/lib/db";
import { useDb } from "@/hooks/useDb";
import { useAuth } from "@/lib/auth";
import { useCan } from "@/hooks/useCan";
import { fmtMoneyInr } from "@/lib/manufacturing";
import { fmtCcyMix, sumByCcy, ccy } from "@/lib/currency";
import { monthLabel } from "@/lib/analytics";
import { KIND_LABEL, designerAccount, designerEmail, designerMonths, designerPayments, isOpenJob, jobsOfDesigner } from "@/lib/designers";
import { PageHeader, TabBar } from "@/components/PageHeader";
import { StatStrip } from "@/components/TableToolbar";
import { DataTable, CellMain, CellAmount, CellDate, type DataColumn } from "@/components/DataTable";
import { DesignerCreateDialog } from "@/components/create/DesignerCreateDialog";
import { PayDesignerSheet } from "@/components/PayDesignerSheet";
import { CadJobsTable } from "@/components/designers/CadJobsTable";

type Tab = "designs" | "months" | "payments";

/**
 * One CAD designer: every design given to them and where it stands, month by
 * month what they did (and, for a freelancer, what it came to and what was
 * paid; for our own, the salary paid in Employees), and every payment.
 */
export function DesignerHistoryPage() {
  const { id } = useParams<{ id: string }>();
  const db = useDb();
  const { user } = useAuth();
  const can = useCan();
  const isAdmin = user?.role === "admin";
  const [tab, setTab] = useState<Tab>("designs");
  const [editing, setEditing] = useState(false);
  const [paying, setPaying] = useState(false);
  const designer = (db.designers ?? []).find(x => x.id === id);

  if (!designer) {
    return (
      <div className="text-center py-20 text-muted-foreground space-y-2">
        <p>That designer isn't here.</p>
        <Link to="/designers" className="text-primary underline">Back to Designers</Link>
      </div>
    );
  }

  const freelance = designer.kind === "freelance";
  // An employee sees the designs of the orders within their work, as on Orders.
  const mine = user?.role === "employee" ? new Set(currentUserOrders(db, user).map(o => o.id)) : null;
  const jobs = jobsOfDesigner(db, designer.id).filter(j => !mine || mine.has(j.orderId));
  const acc = freelance ? designerAccount(db, designer) : null;
  const payments = freelance ? designerPayments(db, designer.id) : [];
  const month = new Date().toISOString().slice(0, 7);
  const today = new Date().toISOString().slice(0, 10);
  const inHand = jobs.filter(isOpenJob);
  const late = inHand.filter(j => j.status !== "submitted" && j.dueDate && j.dueDate < today).length;
  const mayPay = isAdmin || can("payments", "add");

  // Our own designer's salary is paid in Employees — shown here by month, never entered here.
  const salary = !freelance && designer.userId ? (db.expenses ?? []).filter(e => e.paidToEmployeeId === designer.userId) : [];

  // ── Month by month ──
  type MonthRow = { month: string; given: number; designs: number; charged: number; paid: number; salary: string };
  const m = designerMonths(db, designer);
  const given = new Map<string, number>();
  for (const j of jobs) given.set(j.createdAt.slice(0, 7), (given.get(j.createdAt.slice(0, 7)) ?? 0) + 1);
  const salaryBy = new Map<string, typeof salary>();
  for (const e of salary) { const k = e.createdAt.slice(0, 7); salaryBy.set(k, [...(salaryBy.get(k) ?? []), e]); }
  const monthKeys = [...new Set([...m.keys(), ...given.keys(), ...salaryBy.keys()])].sort().reverse();
  const months: MonthRow[] = monthKeys.map(k => ({
    month: k, given: given.get(k) ?? 0, designs: m.get(k)?.designs ?? 0, charged: m.get(k)?.charged ?? 0, paid: m.get(k)?.paid ?? 0,
    salary: salaryBy.get(k)?.length ? fmtCcyMix(sumByCcy(salaryBy.get(k)!, e => e.amount, e => ccy(e.currency))) : "",
  }));
  const monthCols: DataColumn<MonthRow>[] = [
    { key: "month", header: "Month", always: true, sortValue: r => r.month, csv: r => monthLabel(r.month), cell: r => <span className="font-medium">{monthLabel(r.month)}</span> },
    { key: "given", header: "Given", align: "right", kind: "number", sortValue: r => r.given, cell: r => <span className="tabular-nums">{r.given || "—"}</span> },
    { key: "designs", header: "Approved", align: "right", kind: "number", sortValue: r => r.designs, cell: r => <span className="tabular-nums">{r.designs || "—"}</span> },
    ...(freelance ? [
      { key: "charged", header: "Came to", align: "right", kind: "number", sortValue: (r: MonthRow) => r.charged, csv: (r: MonthRow) => r.charged,
        cell: (r: MonthRow) => (r.charged ? <CellAmount>{fmtMoneyInr(r.charged)}</CellAmount> : <span className="text-muted-foreground/50">—</span>) },
      { key: "paid", header: "Paid", align: "right", kind: "number", sortValue: (r: MonthRow) => r.paid, csv: (r: MonthRow) => r.paid,
        cell: (r: MonthRow) => (r.paid ? <CellAmount tone="in">{fmtMoneyInr(r.paid)}</CellAmount> : <span className="text-muted-foreground/50">—</span>) },
    ] as DataColumn<MonthRow>[] : [
      { key: "salary", header: "Salary paid", align: "right", sortValue: (r: MonthRow) => r.salary, csv: (r: MonthRow) => r.salary,
        cell: (r: MonthRow) => (r.salary ? <span className="tabular-nums whitespace-nowrap">{r.salary}</span> : <span className="text-muted-foreground/50">—</span>) },
    ] as DataColumn<MonthRow>[]),
  ];

  // ── Payments (freelancers) ──
  const jobOf = (t: LockerTransaction) => (t.cadJobId ? (db.cadJobs ?? []).find(j => j.id === t.cadJobId) : undefined);
  const payCols: DataColumn<LockerTransaction>[] = [
    { key: "date", header: "Date", kind: "date", sortValue: t => +new Date(t.createdAt), csv: t => t.createdAt.slice(0, 10), cell: t => <CellDate>{fmtDate(t.createdAt)}</CellDate> },
    { key: "from", header: "From", always: true, sortValue: t => db.lockers.find(l => l.id === t.lockerId)?.name ?? "", csv: t => db.lockers.find(l => l.id === t.lockerId)?.name ?? "",
      cell: t => <CellMain title={db.lockers.find(l => l.id === t.lockerId)?.name ?? "Account"} sub={t.note} /> },
    { key: "against", header: "Against", sortValue: t => jobOf(t)?.orderNumber ?? "", csv: t => jobOf(t)?.orderNumber ?? "Oldest first",
      cell: t => <span className="text-xs text-muted-foreground">{jobOf(t)?.orderNumber ?? "Oldest first"}</span> },
    { key: "amount", header: "Amount", align: "right", kind: "number", sortValue: t => t.amountInr, csv: t => t.amountInr, cell: t => <CellAmount tone="out">{fmtMoneyInr(t.amountInr)}</CellAmount> },
  ];

  const contact = [designerEmail(db, designer), designer.phone].filter(Boolean).join(" · ");
  return (
    <div className="space-y-5">
      <PageHeader
        back={{ label: "Designers", to: "/designers" }}
        title={designer.name}
        subtitle={[KIND_LABEL[designer.kind], freelance && designer.ratePerDesign != null ? `${fmtMoneyInr(designer.ratePerDesign)} a design` : null, contact || null, designer.active === false ? "switched off" : null].filter(Boolean).join(" · ")}
        primary={freelance && mayPay ? { label: "Pay", icon: Wallet, onClick: () => setPaying(true) } : null}
        secondary={isAdmin ? { label: "Edit", icon: Pencil, onClick: () => setEditing(true) } : null}
      />

      <StatStrip items={[
        { label: "In hand", value: String(inHand.length), icon: FolderOpen, tone: late ? "out" as const : undefined,
          sub: late ? `${late} late` : `${inHand.filter(j => j.status === "submitted").length} waiting for approval` },
        { label: "Approved this month", value: String(m.get(month)?.designs ?? 0), icon: CalendarDays, sub: `${jobs.filter(j => j.status === "approved").length} in all` },
        ...(acc ? [
          { label: "Came to", value: fmtMoneyInr(acc.charged), icon: Receipt, sub: `${acc.designs} approved design${acc.designs === 1 ? "" : "s"}${acc.opening ? ` · ${fmtMoneyInr(Math.abs(acc.opening))} from before` : ""}` },
          acc.advance > 0.5
            ? { label: "Paid ahead", value: fmtMoneyInr(acc.advance), icon: IndianRupee, sub: `Paid ${fmtMoneyInr(acc.paid)} in all` }
            : { label: "To pay", value: fmtMoneyInr(acc.due), icon: IndianRupee, tone: acc.due > 0.5 ? "out" as const : undefined, sub: `Paid ${fmtMoneyInr(acc.paid)} in all` },
        ] : [
          { label: "Salary", value: "Employees", icon: CheckCircle2, sub: "Paid with the team's salaries" },
        ]),
      ]} />

      <div className="space-y-3">
        <TabBar label="Designer" value={tab} onChange={setTab} tabs={[
          { key: "designs", label: "Designs", icon: PenTool, count: jobs.length },
          { key: "months", label: "Month by month", icon: CalendarDays, count: months.length },
          ...(freelance ? [{ key: "payments" as const, label: "Payments", icon: Wallet, count: payments.length }] : []),
        ]} />
        <div className="card-luxe p-3 sm:p-4">
          {tab === "designs" && (
            <CadJobsTable id="designer-jobs" jobs={jobs} exportName={`Designer-${designer.name}-Designs`}
              emptyText="No designs given yet — give one from an order's CAD Design card." />
          )}
          {tab === "months" && (
            <DataTable id="designer-months" noun="month" rows={months} rowKey={r => r.month} columns={monthCols}
              defaultSort={{ key: "month", dir: "desc" }} details={false} exportName={`Designer-${designer.name}-Months`}
              totals={{
                given: list => String(list.reduce((s, r) => s + r.given, 0)),
                designs: list => String(list.reduce((s, r) => s + r.designs, 0)),
                ...(freelance ? {
                  charged: (list: MonthRow[]) => fmtMoneyInr(list.reduce((s, r) => s + r.charged, 0)),
                  paid: (list: MonthRow[]) => <span className="text-success">{fmtMoneyInr(list.reduce((s, r) => s + r.paid, 0))}</span>,
                } : {}),
              }}
              summary={!freelance ? <p className="text-xs text-muted-foreground px-1">Salary is what Employees shows as paid to {designer.name} each month.</p> : undefined}
              emptyText="Nothing yet." />
          )}
          {tab === "payments" && (
            <DataTable id="designer-payments" noun="payment" rows={payments} rowKey={t => t.id} columns={payCols}
              defaultSort={{ key: "date", dir: "desc" }} details={false} exportName={`Designer-${designer.name}-Payments`}
              totals={{ amount: list => fmtMoneyInr(list.reduce((s, t) => s + t.amountInr, 0)) }}
              summary={<p className="text-xs text-muted-foreground px-1">A payment is an entry in its account — correct or delete it in the Locker.</p>}
              emptyText="No payments yet." />
          )}
        </div>
      </div>

      {isAdmin && <DesignerCreateDialog open={editing} onOpenChange={setEditing} designer={designer} />}
      {paying && <PayDesignerSheet designerId={designer.id} onClose={() => setPaying(false)} />}
    </div>
  );
}
