import { useMemo } from "react";
import { Link } from "react-router-dom";
import { ResponsiveContainer, BarChart, Bar as RBar, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from "recharts";
import { Coins, Gem, Landmark, Factory, Scale, ShoppingCart, Truck } from "lucide-react";
import { toPureGold } from "@/lib/db";
import { inPeriod, payables, purchasesMonthly } from "@/lib/analytics";
import { fineGoldRate } from "@/lib/orderCost";
import { C, KpiCard, Panel, ChartTip, Bar, Empty, inr, num } from "./ui";
import type { ReportCtx } from "./context";

export function PurchasesTab({ ctx }: { ctx: ReportCtx }) {
  const { db, orders, period, version } = ctx;
  const data = useMemo(() => {
    const inP = (db.purchases ?? []).filter(p => inPeriod(period, p.invoiceDate || p.createdAt));
    const gold = inP.filter(p => p.material === "gold");
    const dia = inP.filter(p => p.material !== "gold");
    const bySupplier = new Map<string, number>();
    for (const p of inP) bySupplier.set(p.supplierId, (bySupplier.get(p.supplierId) ?? 0) + p.totalInr);
    return {
      goldInr: gold.reduce((s, p) => s + p.totalInr, 0),
      goldG: gold.reduce((s, p) => s + (p.gold?.weightGrams ?? 0), 0),
      goldFine: gold.reduce((s, p) => s + toPureGold(p.gold?.weightGrams ?? 0, p.gold?.purity ?? "24K"), 0),
      diaInr: dia.reduce((s, p) => s + p.totalInr, 0),
      diaCt: dia.reduce((s, p) => s + (p.diamond?.carat ?? 0), 0),
      pay: payables(db),
      fine: fineGoldRate(db, period.to ? `${period.to}T23:59:59` : new Date().toISOString()),
      months: purchasesMonthly(db, period, orders),
      suppliers: [...bySupplier.entries()].map(([id, v]) => ({ id, name: db.suppliers.find(s => s.id === id)?.name ?? "—", value: v })).sort((a, b) => b.value - a.value).slice(0, 8),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db, period.from, period.to, version]);
  const supMax = data.suppliers[0]?.value ?? 0;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <KpiCard icon={Coins} label="Gold bought" value={inr(data.goldInr, true)} sub={`${num(Math.round(data.goldG * 1000) / 1000, " g")} · ${num(Math.round(data.goldFine * 1000) / 1000, " g fine")}`} tone="gold" />
        <KpiCard icon={Gem} label="Diamonds bought" value={inr(data.diaInr, true)} sub={`${num(Math.round(data.diaCt * 100) / 100, " ct")}${data.diaCt ? ` · ${inr(data.diaInr / data.diaCt)}/ct avg` : ""}`} tone="sky" />
        <KpiCard icon={Scale} label="Fine gold cost" value={data.fine ? `${inr(data.fine.rate)}/g` : "—"} sub={data.fine ? "Average, 24KT — what pieces are costed at" : "No priced gold purchase yet"} tone="violet" />
        <KpiCard icon={Landmark} label="Owed to suppliers" value={inr(data.pay.suppliersInr, true)} sub="As of today" tone="rose" />
        <KpiCard icon={Factory} label="Owed to factories" value={inr(data.pay.factoriesInr, true)} sub="Labour, as of today" tone="rose" />
      </div>

      <div className="grid lg:grid-cols-3 gap-4">
        <Panel title="Material bought, month by month" subtitle="By supplier bill date" icon={ShoppingCart} className="lg:col-span-2">
          {data.months.some(m => m.goldInr || m.diamondInr) ? (
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.months} margin={{ top: 8, right: 8, left: -4, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="oklch(0.9 0.01 260)" />
                  <XAxis dataKey="label" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} />
                  <YAxis tick={{ fontSize: 10 }} tickLine={false} axisLine={false} tickFormatter={v => inr(v, true)} width={64} />
                  <Tooltip content={<ChartTip format={v => inr(v)} />} />
                  <Legend wrapperStyle={{ fontSize: 11 }} iconType="circle" />
                  <RBar dataKey="goldInr" name="Gold" stackId="a" fill={C.gold} maxBarSize={36} />
                  <RBar dataKey="diamondInr" name="Diamonds" stackId="a" fill={C.sky} radius={[6, 6, 0, 0]} maxBarSize={36} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : <Empty>Nothing bought in this period.</Empty>}
        </Panel>
        <Panel title="Top suppliers" subtitle="Bought in the period" icon={Truck}>
          {data.suppliers.length ? (
            <ul className="space-y-2.5 text-xs">
              {data.suppliers.map(s => (
                <li key={s.id} className="space-y-1">
                  <div className="flex justify-between gap-2"><Link to={`/suppliers/${s.id}`} className="truncate hover:text-primary">{s.name}</Link><span className="font-semibold shrink-0">{inr(s.value, true)}</span></div>
                  <Bar value={s.value} max={supMax} tone={C.violet} />
                </li>
              ))}
            </ul>
          ) : <Empty />}
        </Panel>
      </div>
    </div>
  );
}
