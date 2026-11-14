import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { AlertCircle, CalendarClock, CreditCard } from "lucide-react";
import { useDb } from "@/hooks/useDb";
import { useLoaded } from "@/hooks/useLoaded";
import { fmtDate } from "@/lib/db";
import { fmtMoneyInr } from "@/lib/manufacturing";
import { TOTALS_COLS } from "@/lib/pageData";
import { billsToPay, supplierBillsDue, type BillDue } from "@/lib/supplierDue";
import { DataTable, CellAmount, CellDate, CellMain, type DataColumn } from "@/components/DataTable";
import { StatStrip } from "@/components/TableToolbar";
import { SubTabs } from "@/components/PageHeader";
import type { MoreAction } from "@/components/MoreMenu";

/**
 * Suppliers → To pay: the bills that fall due this week or are already late, most urgent first —
 * or every unpaid bill. Each by the supplier's credit days (lib/supplierDue.ts); Pay opens the
 * supplier's own Pay panel set to that bill.
 */
export function SuppliersToPay({ mayPay }: { mayPay: boolean }) {
  const db = useDb();
  const ready = useLoaded(TOTALS_COLS.supplier);
  const navigate = useNavigate();
  const [show, setShow] = useState<"week" | "all">("week");
  const rows = useMemo(() => {
    if (!ready) return [] as BillDue[];
    return show === "week" ? billsToPay(db) : db.suppliers.filter(s => s.active !== false).flatMap(s => supplierBillsDue(db, s));
  }, [db, ready, show]);
  const nameOf = (id: string) => db.suppliers.find(s => s.id === id)?.name ?? "Supplier";
  const late = rows.filter(r => r.late > 0);
  const lateAmt = late.reduce((t, r) => t + r.owed, 0);
  const weekAmt = rows.filter(r => r.late === 0 && r.dueAt).reduce((t, r) => t + r.owed, 0);
  const noDays = db.suppliers.filter(s => s.active !== false && s.creditDays == null).length;
  const pay = (r: BillDue) => navigate(`/suppliers/${r.supplierId}?pay=${encodeURIComponent(r.purchase?.id ?? "")}`);

  const columns: DataColumn<BillDue>[] = [
    { key: "supplier", header: "Supplier", always: true, sortValue: r => nameOf(r.supplierId), csv: r => nameOf(r.supplierId),
      cell: r => <Link to={`/suppliers/${r.supplierId}`} onClick={e => e.stopPropagation()} className="font-medium text-primary hover:underline">{nameOf(r.supplierId)}</Link> },
    { key: "bill", header: "Bill", sortValue: r => r.billNo, csv: r => r.billNo, cell: r => <CellMain title={r.billNo} sub={fmtDate(r.billAt)} /> },
    { key: "due", header: "Due", kind: "date", sortValue: r => (r.dueAt ? +new Date(r.dueAt) : null), csv: r => (r.dueAt ? fmtDate(r.dueAt) : ""),
      cell: r => !r.dueAt ? <span className="text-xs text-muted-foreground">No credit days</span> : (
        <span className="text-xs whitespace-nowrap">
          <CellDate>{fmtDate(r.dueAt)}</CellDate>
          <span className={`block text-[10px] ${r.late > 0 ? "text-destructive font-semibold" : "text-muted-foreground"}`}>
            {r.late > 0 ? `${r.late} day${r.late === 1 ? "" : "s"} late` : r.left === 0 ? "due today" : `in ${r.left} day${r.left === 1 ? "" : "s"}`}
          </span>
        </span>
      ) },
    { key: "owed", header: "To pay", align: "right", kind: "number", sortValue: r => r.owed, csv: r => r.owed,
      cell: r => <CellAmount tone={r.late > 0 ? "out" : undefined}>{fmtMoneyInr(r.owed)}</CellAmount> },
  ];
  const actions = (r: BillDue): MoreAction[] => [
    { label: "Pay", icon: CreditCard, disabled: !mayPay, hint: mayPay ? `On ${nameOf(r.supplierId)}'s page, set to this bill` : "Your access does not include paying", onSelect: () => pay(r) },
    { label: "Open supplier", icon: CalendarClock, onSelect: () => navigate(`/suppliers/${r.supplierId}`) },
  ];

  return (
    <div className="card-luxe p-3 sm:p-4 space-y-3">
      <SubTabs label="Bills" value={show} onChange={setShow} tabs={[{ key: "week", label: "Due this week & late" }, { key: "all", label: "Every unpaid bill" }]} />
      <DataTable
        id="suppliers-topay" noun="bill" rows={rows} rowKey={r => `${r.supplierId}-${r.purchase?.id ?? "opening"}`}
        columns={columns} rowActions={actions} onRowClick={r => navigate(`/suppliers/${r.supplierId}`)}
        searchText={r => `${nameOf(r.supplierId)} ${r.billNo}`} exportName="Suppliers-To-pay" pageSizes={[25, 50, 100]}
        defaultSort={null}
        summary={<StatStrip items={[
          { label: "Late", value: fmtMoneyInr(lateAmt), tone: lateAmt > 0 ? "out" : undefined, icon: AlertCircle, sub: `${late.length} bill${late.length === 1 ? "" : "s"} past their due day` },
          { label: show === "week" ? "Due this week" : "Not due yet", value: fmtMoneyInr(weekAmt), icon: CalendarClock, sub: show === "week" ? "In the next 7 days" : "By credit days" },
        ]} />}
        emptyText={!ready ? "Loading the bills…" : show === "week"
          ? noDays ? `Nothing due this week. ${noDays} supplier${noDays === 1 ? " has" : "s have"} no credit days — set them in Edit supplier to see their bills here.` : "Nothing due this week."
          : "No unpaid bills."} />
    </div>
  );
}
