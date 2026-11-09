// An employee's sales commission, on their page — ADMIN ONLY: their %, what
// they earned order by order, what was paid and what is owed (lib/commissionLedger.ts).
import { useMemo, useState } from "react";
import { Percent, Wallet, TrendingUp, Clock, HandCoins } from "lucide-react";
import { fmtDate, type User } from "@/lib/db";
import { useDb } from "@/hooks/useDb";
import { useAuth } from "@/lib/auth";
import { fmtMoneyInr } from "@/lib/manufacturing";
import { rateText, commissionPlan, onCompanyRate } from "@/lib/commission";
import { commissionRows, commissionAccount, commissionPayments, type CommissionRow } from "@/lib/commissionLedger";
import { CommissionRulesSheet, PayCommissionSheet, useCommissionData } from "@/components/CommissionSheets";
import { DataTable, CellMain, CellAmount, CellDate, CellTag, type DataColumn } from "@/components/DataTable";
import { SectionTitle } from "@/components/SectionTitle";
import { StatStrip } from "@/components/TableToolbar";
import { Button } from "@/components/ui/button";

export function CommissionPanel({ employee }: { employee: User }) {
  const db = useDb();
  const { user } = useAuth();
  const ready = useCommissionData();
  const [rules, setRules] = useState(false);
  const [paying, setPaying] = useState(false);
  const rows = useMemo(() => (ready ? commissionRows(db, employee.id) : []), [db, ready, employee.id]);
  const acc = useMemo(() => (ready ? commissionAccount(db, employee.id, rows) : null), [db, ready, employee.id, rows]);
  if (user?.role !== "admin") return null;
  const plan = commissionPlan(db);
  const paid = commissionPayments(db, employee.id);
  // Nothing to say about someone who never had a % and never earned or was paid any.
  if (ready && !rows.length && !paid.length && !plan.staff[employee.id]?.length && !onCompanyRate(db, employee)) return null;

  const year = String(new Date().getFullYear());
  const month = new Date().toISOString().slice(0, 7);
  const thisMonth = rows.filter(r => r.shipped && r.saleDay.slice(0, 7) === month).reduce((s, r) => s + r.line.inr, 0);
  const clientName = (id: string) => db.clients.find(c => c.id === id)?.companyName ?? "";
  const columns: DataColumn<CommissionRow>[] = [
    { key: "order", header: "Order", always: true, sortValue: r => r.order.orderNumber, csv: r => r.order.orderNumber,
      cell: r => <CellMain title={<span className="font-mono text-xs font-semibold">{r.order.orderNumber}</span>} sub={clientName(r.order.clientId) || r.order.jewelleryType} /> },
    { key: "sold", header: "Sold", kind: "date", sortValue: r => r.saleDay, csv: r => fmtDate(r.saleDay),
      cell: r => <CellDate>{r.shipped ? fmtDate(r.saleDay) : "Not shipped"}</CellDate> },
    { key: "selling", header: "Selling (₹)", align: "right", kind: "number", sortValue: r => r.sellingInr, csv: r => r.sellingInr,
      cell: r => <CellAmount>{fmtMoneyInr(r.sellingInr)}</CellAmount> },
    { key: "margin", header: "Margin (₹)", align: "right", kind: "number", sortValue: r => r.line.baseInr, csv: r => r.line.baseInr,
      cell: r => <CellAmount tone={r.line.baseInr < 0 ? "out" : undefined}>{fmtMoneyInr(r.line.baseInr)}</CellAmount> },
    { key: "pct", header: "%", align: "right", kind: "number", sortValue: r => r.line.pct, csv: r => r.line.pct,
      cell: r => <span className="tabular-nums whitespace-nowrap">{r.line.pct}%{r.line.source === "order" ? " *" : ""}</span> },
    { key: "commission", header: "Commission (₹)", align: "right", kind: "number", sortValue: r => r.line.inr, csv: r => r.line.inr,
      cell: r => <CellAmount tone={r.shipped && r.line.inr > 0 ? "in" : undefined}>{`${r.shipped && !r.complete ? "≤ " : ""}${fmtMoneyInr(r.line.inr)}`}</CellAmount> },
    { key: "state", header: "Status", sortValue: r => (r.shipped ? 1 : 0), csv: r => (r.shipped ? (r.complete ? "Earned" : "Earned — cost not all known") : "Coming"),
      cell: r => r.shipped ? <CellTag tone={r.complete ? "green" : "amber"}>{r.complete ? "Earned" : "Earned · ≤"}</CellTag> : <CellTag tone="blue">Coming</CellTag> },
  ];

  return (
    <div className="card-luxe overflow-hidden">
      <SectionTitle title="Sales commission" sub={rateText(db, employee.id)} className="px-5 py-4 border-b border-border/60"
        info={<>A share of the margin of each order they sold — selling price less its whole cost — never on a loss. Earned once the order is shipped; a return lowers it. Admins only.</>} />
      <div className="p-3 sm:p-4 space-y-3">
        <div className="flex justify-end gap-2 flex-wrap">
          <Button type="button" variant="outline" onClick={() => setRules(true)} className="rounded-xl h-9 gap-1.5"><Percent className="h-4 w-4" /> Change %</Button>
          <Button type="button" onClick={() => setPaying(true)} disabled={!acc} className="btn-hero rounded-xl h-9 gap-1.5"><Wallet className="h-4 w-4" /> Pay commission</Button>
        </div>
        {!ready || !acc ? (
          <p className="text-sm text-muted-foreground px-1 py-4">Working out the commission…</p>
        ) : (
          <>
            <StatStrip items={[
              { label: "Owed now", value: fmtMoneyInr(Math.max(0, acc.owedInr)), icon: HandCoins, tone: acc.owedInr > 0.005 ? "out" : undefined,
                sub: acc.owedInr < -0.005 ? `Paid ahead ${fmtMoneyInr(-acc.owedInr)}` : undefined },
              { label: "Earned", value: fmtMoneyInr(acc.earnedInr), icon: TrendingUp, tone: "in",
                sub: `${fmtMoneyInr(thisMonth)} this month${acc.partial ? ` · ${acc.partial} at most` : ""}` },
              { label: "Paid", value: fmtMoneyInr(acc.paidInr), icon: Wallet, sub: `${paid.length} payment${paid.length !== 1 ? "s" : ""}${acc.unvalued ? ` · ${acc.unvalued} with no rate` : ""}` },
              { label: "Coming", value: fmtMoneyInr(acc.comingInr), icon: Clock, sub: "Ready, not shipped yet" },
            ]} />
            {rows.length > 0 ? (
              <DataTable
                id="employee-commission"
                noun="order"
                rows={rows}
                columns={columns}
                rowKey={r => r.order.id}
                rowHref={r => `/orders/${r.order.id}`}
                defaultSort={{ key: "sold", dir: "desc" }}
                searchText={r => `${r.order.orderNumber} ${clientName(r.order.clientId)}`}
                searchPlaceholder="Search orders"
                exportName={`Commission-${employee.name.replace(/\s+/g, "_")}-${year}`}
                pageSizes={[10, 25, 50]}
              />
            ) : (
              <p className="text-sm text-muted-foreground px-1 py-3">No commission yet — it shows here once an order of theirs is ready.</p>
            )}
            <p className="text-[11px] text-muted-foreground px-1">* a % changed for that order. Payments are on their Salary &amp; Payments ledger, as Commission.</p>
          </>
        )}
      </div>
      {rules && <CommissionRulesSheet focusUserId={employee.id} onClose={() => setRules(false)} />}
      {paying && <PayCommissionSheet employeeId={employee.id} onClose={() => setPaying(false)} />}
    </div>
  );
}
