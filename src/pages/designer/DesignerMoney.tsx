import { useEffect, useState } from "react";
import { CalendarDays, CheckCircle2, IndianRupee, Receipt, RefreshCw, Wallet } from "lucide-react";
import { PageHeader, TabBar } from "@/components/PageHeader";
import { DataTable, CellAmount, CellDate, CellMain, type DataColumn } from "@/components/DataTable";
import { StatStrip } from "@/components/TableToolbar";
import { Button } from "@/components/ui/button";
import { usePageTab } from "@/hooks/usePageTab";
import { fmtDate } from "@/lib/db";
import { fmtMoneyInr } from "@/lib/manufacturing";
import { myDesignerStatement, type DesignerStatement } from "@/lib/designerWork";

type Month = NonNullable<DesignerStatement["months"]>[number];
type Design = NonNullable<DesignerStatement["designs"]>[number];
type Pay = NonNullable<DesignerStatement["payments"]>[number];
const monthName = (k: string) => new Date(`${k}-01T00:00:00`).toLocaleDateString("en-IN", { month: "long", year: "numeric" });

/**
 * A freelance designer's own money: charged when we approve a design, what we
 * paid them, and what is owed now — month by month, design by design. Worked
 * out by the server (functions designerWork "statement") with the same sums as
 * the staff's designer page, from only their own records.
 */
export function DesignerMoneyPage() {
  const [data, setData] = useState<DesignerStatement | null>(null);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = usePageTab("designer-money", ["months", "designs", "payments"] as const, "months");
  const load = () => {
    setLoading(true); setErr("");
    myDesignerStatement().then(setData).catch(e => setErr(e instanceof Error ? e.message : "Couldn't load")).finally(() => setLoading(false));
  };
  useEffect(load, []);

  const monthCols: DataColumn<Month>[] = [
    { key: "month", header: "Month", always: true, sortValue: m => m.month, cell: m => <CellMain title={monthName(m.month)} /> },
    { key: "designs", header: "Designs approved", align: "right", sortValue: m => m.designs, cell: m => <span className="tabular-nums">{m.designs}</span> },
    { key: "charged", header: "Came to", align: "right", sortValue: m => m.charged, cell: m => <CellAmount>{fmtMoneyInr(m.charged)}</CellAmount> },
    { key: "paid", header: "Paid to you", align: "right", sortValue: m => m.paid, cell: m => <CellAmount tone="in">{fmtMoneyInr(m.paid)}</CellAmount> },
  ];
  const designCols: DataColumn<Design>[] = [
    { key: "design", header: "Design", always: true, sortValue: d => d.orderNumber, cell: d => <CellMain title={d.orderNumber} /> },
    { key: "approved", header: "Approved", sortValue: d => d.approvedAt ?? "", cell: d => <CellDate>{d.approvedAt ? fmtDate(d.approvedAt) : "—"}</CellDate> },
    { key: "charge", header: "Charge", align: "right", sortValue: d => d.charge, cell: d => <CellAmount>{fmtMoneyInr(d.charge)}</CellAmount> },
    { key: "paid", header: "Paid", align: "right", sortValue: d => d.paid, cell: d => <CellAmount tone="in">{fmtMoneyInr(d.paid)}</CellAmount> },
    { key: "due", header: "Still to come", align: "right", card: "figure", sortValue: d => d.due, cell: d => (d.due > 0.005 ? <CellAmount>{fmtMoneyInr(d.due)}</CellAmount> : <span className="text-xs text-success font-medium">Paid</span>) },
  ];
  const payCols: DataColumn<Pay>[] = [
    { key: "at", header: "Date", always: true, sortValue: p => p.at, cell: p => <CellMain title={fmtDate(p.at)} /> },
    { key: "for", header: "For", sortValue: p => p.orderNumber ?? "", cell: p => <span className="text-sm text-muted-foreground">{p.orderNumber ?? "Your oldest designs first"}</span> },
    { key: "amount", header: "Amount", align: "right", card: "figure", sortValue: p => p.amountInr, cell: p => <CellAmount tone="in">{fmtMoneyInr(p.amountInr)}</CellAmount> },
  ];

  const a = data?.account;
  return (
    <div className="space-y-5">
      <PageHeader title="My money" subtitle="Each design is charged when it is approved"
        actions={<Button type="button" variant="outline" size="sm" className="rounded-lg gap-1.5" disabled={loading} onClick={load}><RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />Refresh</Button>} />
      {err && <div className="card-luxe p-6 text-sm text-destructive">{err}</div>}
      {!err && loading && !data && <div className="py-16 text-center text-sm text-muted-foreground">Loading…</div>}
      {data?.kind === "inhouse" && <div className="card-luxe p-8 text-center text-sm text-muted-foreground">You are paid with the team's salaries — there is no per-design account.</div>}
      {data?.kind === "freelance" && a && (
        <>
          <StatStrip items={[
            a.advance > 0.005
              ? { label: "Paid ahead", value: fmtMoneyInr(a.advance), icon: IndianRupee, sub: "More than your designs came to so far" }
              : { label: "Owed to you", value: fmtMoneyInr(a.due), icon: IndianRupee, tone: a.due > 0.5 ? "strong" as const : undefined },
            { label: "Came to", value: fmtMoneyInr(a.charged), icon: Receipt, sub: `${a.designs} approved design${a.designs === 1 ? "" : "s"}${a.opening ? ` · ${fmtMoneyInr(Math.abs(a.opening))} from before` : ""}` },
            { label: "Paid to you", value: fmtMoneyInr(a.paid), icon: Wallet, tone: "in" },
          ]} />
          <TabBar label="Money" value={tab} onChange={setTab} tabs={[
            { key: "months", label: "Month by month", icon: CalendarDays, count: data.months?.length ?? 0 },
            { key: "designs", label: "Designs", icon: CheckCircle2, count: data.designs?.length ?? 0 },
            { key: "payments", label: "Payments", icon: Wallet, count: data.payments?.length ?? 0 },
          ]} />
          <div className="card-luxe p-3 sm:p-4">
            {tab === "months" && <DataTable id="designer-money-months" noun="month" rows={data.months ?? []} columns={monthCols} rowKey={m => m.month} details={false}
              defaultSort={{ key: "month", dir: "desc" }} emptyText="Nothing yet — approved designs and payments show here."
              totals={{ designs: l => l.reduce((s, m) => s + m.designs, 0), charged: l => fmtMoneyInr(l.reduce((s, m) => s + m.charged, 0)), paid: l => fmtMoneyInr(l.reduce((s, m) => s + m.paid, 0)) }} />}
            {tab === "designs" && <DataTable id="designer-money-designs" noun="design" rows={data.designs ?? []} columns={designCols} rowKey={d => d.id} details={false}
              defaultSort={{ key: "approved", dir: "desc" }} emptyText="No approved designs with a charge yet."
              totals={{ charge: l => fmtMoneyInr(l.reduce((s, d) => s + d.charge, 0)), paid: l => fmtMoneyInr(l.reduce((s, d) => s + d.paid, 0)), due: l => fmtMoneyInr(l.reduce((s, d) => s + d.due, 0)) }} />}
            {tab === "payments" && <DataTable id="designer-money-payments" noun="payment" rows={data.payments ?? []} columns={payCols} rowKey={p => p.id || `${p.at}|${p.amountInr}`} details={false}
              defaultSort={{ key: "at", dir: "desc" }} emptyText="No payments yet."
              totals={{ amount: l => fmtMoneyInr(l.reduce((s, p) => s + p.amountInr, 0)) }} />}
          </div>
        </>
      )}
    </div>
  );
}
