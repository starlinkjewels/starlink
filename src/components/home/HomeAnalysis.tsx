import { DataTable } from "@/components/DataTable";
import { hasSwitch } from "@/lib/access";
// The new look's Home, part two: the business's analysis, in a proper order —
// Sales & profit · Money · Production · Team — under ONE period control that
// every chart follows. Figures are the app's own (lib/analytics.ts — the same
// as Reports, Cost & Profit and the factory accounts).
//
// Charts follow the data-viz method: one blue for a single series, blue +
// orange for two (colours validated for colour-blind readers on the light and
// dark cards), one y-axis only, thin marks with rounded ends, hairline grid,
// a legend for two series, a hover card on every chart, and a Table switch on
// each so every value can be read exactly.
import { startTransition, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { BarChart3, Table2 } from "lucide-react";
import type { DB, Order } from "@/lib/db";
import {
  clientTable, factoryTable, kpis, lateOpen, monthly, payables, pctChange, presetPeriod, previousPeriod, receivables, salesBy, teamTable, type Period,
} from "@/lib/analytics";
import { ChartTip, PeriodPicker, inr, num, pct, usd } from "@/components/reports/ui";

/** The chart colours (studio.css --viz-*): validated pairs, light and dark. */
const V1 = "var(--viz-1)", V2 = "var(--viz-2)";
const AGE = ["var(--viz-age-1)", "var(--viz-age-2)", "var(--viz-age-3)", "var(--viz-age-4)"];
const AXIS = { fontSize: 11, fill: "var(--color-muted-foreground)" } as const;

/** One analysis card: its title and what it shows, a Chart/Table switch, the chart or its table. */
function ChartCard({ title, sub, legend, table, children, className = "" }: {
  title: string; sub?: string; legend?: { label: string; color: string }[];
  table?: { head: string[]; rows: (string | number)[][] }; children: ReactNode; className?: string;
}) {
  const [asTable, setAsTable] = useState(false);
  return (
    <section className={`home-card p-4 sm:p-5 min-w-0 ${className}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-[15px] font-semibold text-foreground">{title}</h3>
          {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
        </div>
        {table && (
          <div className="flex shrink-0 rounded-lg bg-secondary p-0.5" role="group" aria-label={`${title}: show as`}>
            {([["chart", BarChart3], ["table", Table2]] as const).map(([k, I]) => (
              <button key={k} type="button" aria-pressed={(k === "table") === asTable} aria-label={k === "chart" ? "Chart" : "Table"} title={k === "chart" ? "Chart" : "Table"}
                onClick={() => setAsTable(k === "table")}
                className={`h-7 w-8 grid place-items-center rounded-md transition-colors ${(k === "table") === asTable ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>
                <I className="h-3.5 w-3.5" />
              </button>
            ))}
          </div>
        )}
      </div>
      {legend && legend.length > 1 && !asTable && (
        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          {legend.map(l => <span key={l.label} className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-[3px]" style={{ background: l.color }} />{l.label}</span>)}
        </div>
      )}
      <div className="mt-3">
        {asTable && table ? (
          <div className="max-h-72 overflow-auto rounded-lg border border-border/70">
            <table className="w-full text-xs tabular-nums">
              <thead className="sticky top-0 bg-secondary/90 backdrop-blur"><tr>{table.head.map((h, i) => <th key={h} className={`px-3 py-2 font-medium text-muted-foreground ${i ? "text-right" : "text-left"}`}>{h}</th>)}</tr></thead>
              <tbody className="divide-y divide-border/60">{table.rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j} className={`px-3 py-2 ${j ? "text-right" : "text-left text-foreground"}`}>{c}</td>)}</tr>)}</tbody>
            </table>
          </div>
        ) : children}
      </div>
    </section>
  );
}

/** A figure for the period, against the one before. */
function Figure({ label, value, change, upIsGood = true, sub }: { label: string; value: string; change?: number | null; upIsGood?: boolean; sub?: string }) {
  const flat = change == null || Math.abs(change) < 0.5, up = (change ?? 0) > 0;
  const good = flat ? null : upIsGood ? up : !up;
  return (
    <div className="home-tile">
      <p className="text-[13px] font-medium text-muted-foreground">{label}</p>
      <p className="mt-2 text-[1.45rem] sm:text-[1.6rem] font-semibold leading-none tracking-[-0.03em] text-foreground whitespace-nowrap">{value}</p>
      <p className="mt-2 text-xs text-muted-foreground truncate">
        {!flat && <span className={`font-semibold ${good ? "text-success" : "text-destructive"}`}>{up ? "↑" : "↓"} {Math.abs(Math.round(change!))}%</span>}
        {!flat && sub ? " · " : ""}{sub ?? (typeof change === "number" && flat ? "same as before" : "")}
      </p>
    </div>
  );
}

function Section({ title, sub, children }: { title: string; sub: string; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <div className="flex items-end justify-between gap-3 border-b border-border/70 pb-2">
        <div><h2 className="text-lg font-semibold tracking-tight text-foreground">{title}</h2><p className="text-xs text-muted-foreground">{sub}</p></div>
      </div>
      {children}
    </section>
  );
}

const Empty = ({ children = "Nothing in this period." }: { children?: ReactNode }) => <div className="h-48 grid place-items-center text-sm text-muted-foreground">{children}</div>;
const compactUsd = (n: number) => usd(n, true);

/** Ranked bars in plain HTML: name, a thin bar, the figure — readable at any width. */
function Ranked({ rows, format, to }: { rows: { key: string; label: string; value: number; sub?: string }[]; format: (n: number) => string; to?: (key: string) => string }) {
  const max = Math.max(1, ...rows.map(r => r.value));
  if (!rows.length) return <Empty />;
  return (
    <ul className="space-y-2.5">
      {rows.map(r => {
        const body = (
          <>
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span className="min-w-0 truncate text-foreground">{r.label}{r.sub && <span className="text-xs text-muted-foreground"> · {r.sub}</span>}</span>
              <span className="shrink-0 font-semibold tabular-nums text-foreground">{format(r.value)}</span>
            </div>
            <div className="mt-1.5 h-1.5 rounded-full bg-secondary overflow-hidden"><div className="h-full rounded-full" style={{ width: r.value > 0 ? `${Math.max(2, (r.value / max) * 100)}%` : 0, background: V1 }} /></div>
          </>
        );
        return <li key={r.key}>{to ? <Link to={to(r.key)} className="block rounded-lg -mx-1.5 px-1.5 py-1 hover:bg-secondary/60 transition-colors">{body}</Link> : <div className="py-1">{body}</div>}</li>;
      })}
    </ul>
  );
}

/** The analysis, remembered for the same records and period — back on Home, nothing is worked out again. */
const cache = new Map<string, unknown>();

/**
 * Worked out only once it comes near the screen and the device is idle: the
 * Home opens and answers a tap at once; the analysis follows as you scroll.
 */
export function HomeAnalysis(props: { db: DB; orders: Order[]; role: "admin" | "employee"; profit?: boolean }) {
  const [ready, setReady] = useState(false);
  const spot = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = spot.current;
    if (!el || ready) return;
    const w = window as unknown as { requestIdleCallback?: (f: () => void, o?: { timeout: number }) => number; setTimeout: (f: () => void, ms: number) => number };
    const idle = (fn: () => void) => (w.requestIdleCallback ? w.requestIdleCallback(fn, { timeout: 800 }) : w.setTimeout(fn, 120));
    const io = new IntersectionObserver(es => {
      if (es.some(e => e.isIntersecting)) { io.disconnect(); idle(() => startTransition(() => setReady(true))); }
    }, { rootMargin: "200px 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, [ready]);
  if (!ready) return <div ref={spot} className="min-h-[1600px]" aria-busy="true" aria-label="Analysis — loading" />;
  return <Analysis {...props} />;
}

function Analysis({ db, orders, role, profit }: { db: DB; orders: Order[]; role: "admin" | "employee"; profit?: boolean }) {
  const [period, setPeriod] = useState<Period>(() => presetPeriod("last12"));
  const admin = role === "admin";
  const live = useMemo(() => orders.filter(o => !o.deletedAt), [orders]);

  const a = useMemo(() => {
    const key = `${role}|${period.from}|${period.to}|${db.orders.length}|${live.length}`;
    const hit = cache.get(key) as ReturnType<typeof compute> | undefined;
    if (hit && cache.get(`${key}|db`) === db) return hit;
    const out = compute();
    cache.clear(); cache.set(key, out); cache.set(`${key}|db`, db);
    return out;
    function compute() {
    const prev = previousPeriod(period);
    // Profit only with the profit figure (fig.profit) — an admin always.
    const withProfit = admin && (role === "admin" && profit !== false);
    const k = kpis(db, live, period, withProfit), kp = prev ? kpis(db, live, prev, withProfit) : null;
    const months = monthly(db, live, period, withProfit);
    return {
      k, kp, months,
      byType: salesBy(live, period, o => o.jewelleryType || "Other").slice(0, 7),
      clients: admin ? clientTable(db, live, period, false).filter(c => c.salesUsd > 0).sort((x, y) => y.salesUsd - x.salesUsd).slice(0, 6) : [],
      owed: receivables(live),
      pay: admin ? payables(db) : null,
      factories: admin ? factoryTable(db, period) : [],
      team: admin ? teamTable(db, live, period, false).filter(t => t.received || t.sold).sort((x, y) => y.salesUsd - x.salesUsd) : [],
      late: lateOpen(live).length,
      open: live.filter(o => !["Delivered", "Rejected"].includes(o.status)).length,
    };
    }
  }, [db, live, period, admin, role, profit]);
  const { k, kp, months } = a;
  const ch = (now: number | null | undefined, before: number | null | undefined) => (kp && now != null && before != null ? pctChange(now, before) : null);
  const monthRows = months.map(m => ({ name: m.label, sales: m.salesUsd, profit: m.profitUsd ?? 0, collected: m.collectedUsd, received: m.receivedCount, shipped: m.soldCount }));
  const anySales = months.some(m => m.salesUsd > 0);
  const ageTotal = a.owed.total;
  const ages = [
    { label: "Under 30 days", value: a.owed.current }, { label: "30–60 days", value: a.owed.d30 },
    { label: "60–90 days", value: a.owed.d60 }, { label: "Over 90 days", value: a.owed.d90 },
  ];
  const grid = <CartesianGrid vertical={false} stroke="var(--color-border)" strokeOpacity={0.7} />;
  const tip = (format: (v: number) => string) => <Tooltip cursor={{ fill: "var(--color-foreground)", fillOpacity: 0.04 }} content={<ChartTip format={v => format(v)} />} />;

  return (
    <div className="space-y-8 pt-2">
      {/* One period for everything below. */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold tracking-tight text-foreground">Analysis</h2>
          <p className="text-xs text-muted-foreground">Every chart below follows this period{kp ? ", compared with the one before" : ""}.</p>
        </div>
        <PeriodPicker value={period} onChange={setPeriod} />
      </div>

      {admin && (
        <Section title="Sales & profit" sub="What was shipped, what it made, what sells and to whom.">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Figure label="Sales" value={usd(k.salesUsd)} change={ch(k.salesUsd, kp?.salesUsd)} sub={`${k.soldCount} order${k.soldCount === 1 ? "" : "s"}`} />
            <Figure label="Profit" value={k.profitUsd == null ? "—" : usd(k.profitUsd)} change={ch(k.profitUsd, kp?.profitUsd)} sub={k.incomplete ? `${k.incomplete} not fully costed` : undefined} />
            <Figure label="Margin" value={pct(k.marginPct)} sub={k.marginPct == null ? "no costed sales" : undefined} />
            <Figure label="Average order" value={k.avgOrderUsd == null ? "—" : usd(k.avgOrderUsd)} change={ch(k.avgOrderUsd, kp?.avgOrderUsd)} />
          </div>
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-3 [&>*]:min-w-0">
            <ChartCard className="lg:col-span-2" title="Sales and profit by month" sub="By the month each piece was shipped"
              legend={[{ label: "Sales", color: V1 }, { label: "Profit", color: V2 }]}
              table={{ head: ["Month", "Sales", "Profit"], rows: monthRows.map(m => [m.name, usd(m.sales), usd(m.profit)]) }}>
              {anySales ? (
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={monthRows} barGap={2} barCategoryGap="28%" margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                      {grid}
                      <XAxis dataKey="name" tick={AXIS} axisLine={false} tickLine={false} interval="preserveStartEnd" minTickGap={8} />
                      <YAxis tick={AXIS} axisLine={false} tickLine={false} width={60} tickFormatter={compactUsd} />
                      {tip(v => usd(v))}
                      <Bar dataKey="sales" name="Sales" fill={V1} radius={[4, 4, 0, 0]} maxBarSize={22} isAnimationActive={false} />
                      <Bar dataKey="profit" name="Profit" fill={V2} radius={[4, 4, 0, 0]} maxBarSize={22} isAnimationActive={false} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              ) : <Empty>No pieces shipped in this period.</Empty>}
            </ChartCard>
            <ChartCard title="What sells" sub="Sales by piece type"
              table={{ head: ["Piece", "Orders", "Sales"], rows: a.byType.map(s => [s.key, s.count, usd(s.value)]) }}>
              <Ranked rows={a.byType.map(s => ({ key: s.key, label: s.key, value: s.value, sub: `${s.count}` }))} format={compactUsd} />
            </ChartCard>
          </div>
          <ChartCard title="Top clients" sub="By sales in this period — tap one to open them"
            table={{ head: ["Client", "Orders", "Sales", "Collected", "Still owed"], rows: a.clients.map(c => [c.name, c.sold, usd(c.salesUsd), usd(c.collectedUsd), usd(c.outstandingUsd)]) }}>
            <Ranked rows={a.clients.map(c => ({ key: c.id, label: c.name, value: c.salesUsd, sub: c.outstandingUsd > 0.5 ? `owes ${usd(c.outstandingUsd, true)}` : undefined }))} format={compactUsd} to={id => `/clients/${id}`} />
          </ChartCard>
        </Section>
      )}

      {admin && (
        <Section title="Money" sub="What came in, what is owed to us and for how long, and what we owe.">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Figure label="Collected" value={usd(k.collectedUsd)} change={ch(k.collectedUsd, kp?.collectedUsd)} />
            <Figure label="Owed to us" value={usd(ageTotal)} upIsGood={false} sub={a.owed.d90 ? `${usd(a.owed.d90)} over 90 days` : "none over 90 days"} />
            {/* What we owe: only with fig.payables — an admin always. */}
            {hasSwitch("fig.payables") && <Figure label="We owe suppliers" value={inr(a.pay?.suppliersInr ?? 0, true)} sub="bills not yet paid" />}
            {hasSwitch("fig.payables") && <Figure label="We owe factories" value={inr(a.pay?.factoriesInr ?? 0, true)} sub="labour not yet paid" />}
          </div>
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-3 [&>*]:min-w-0">
            <ChartCard className="lg:col-span-2" title="Money collected by month" sub="Payments received from clients"
              table={{ head: ["Month", "Collected"], rows: monthRows.map(m => [m.name, usd(m.collected)]) }}>
              {months.some(m => m.collectedUsd > 0) ? (
                <div className="h-56">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={monthRows} barCategoryGap="32%" margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                      {grid}
                      <XAxis dataKey="name" tick={AXIS} axisLine={false} tickLine={false} interval="preserveStartEnd" minTickGap={8} />
                      <YAxis tick={AXIS} axisLine={false} tickLine={false} width={60} tickFormatter={compactUsd} />
                      {tip(v => usd(v))}
                      <Bar dataKey="collected" name="Collected" fill={V1} radius={[4, 4, 0, 0]} maxBarSize={26} isAnimationActive={false} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              ) : <Empty>Nothing collected in this period.</Empty>}
            </ChartCard>
            <ChartCard title="Owed to us, by age" sub="On pieces already shipped — oldest is riskiest"
              table={{ head: ["Age", "Owed"], rows: ages.map(x => [x.label, usd(x.value)]) }}>
              {ageTotal > 0.5 ? (
                <div>
                  <div className="flex h-9 w-full gap-[2px] overflow-hidden rounded-lg" role="img" aria-label={ages.map(x => `${x.label} ${usd(x.value)}`).join(", ")}>
                    {ages.map((x, i) => x.value > 0 && <div key={x.label} title={`${x.label}: ${usd(x.value)}`} style={{ flex: x.value, background: AGE[i] }} />)}
                  </div>
                  <ul className="mt-4 space-y-2">
                    {ages.map((x, i) => (
                      <li key={x.label} className="flex items-center justify-between text-sm">
                        <span className="inline-flex items-center gap-2 text-foreground/85"><span className="h-2.5 w-2.5 rounded-[3px]" style={{ background: AGE[i] }} />{x.label}</span>
                        <span className="font-semibold tabular-nums">{usd(x.value)} <span className="text-xs font-normal text-muted-foreground">{Math.round((x.value / ageTotal) * 100)}%</span></span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : <Empty>Nothing is owed to us.</Empty>}
            </ChartCard>
          </div>
        </Section>
      )}

      <Section title="Production" sub="Orders coming in and going out, how fast, and at which factory.">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <Figure label="On-time dispatch" value={pct(k.onTimePct)} change={ch(k.onTimePct, kp?.onTimePct)} sub="shipped by the promised date" />
          <Figure label="Order to dispatch" value={k.medianCycleDays == null ? "—" : `${num(k.medianCycleDays)} days`} change={ch(k.medianCycleDays, kp?.medianCycleDays)} upIsGood={false} sub="median" />
          <Figure label="Open orders" value={String(a.open)} sub={a.late ? `${a.late} late` : "none late"} />
          <Figure label="Orders received" value={String(k.receivedCount)} change={ch(k.receivedCount, kp?.receivedCount)} sub={usd(k.receivedUsd, true)} />
        </div>
        <ChartCard title="Orders in and shipped by month" sub="Received against shipped — a widening gap means work is piling up"
          legend={[{ label: "Received", color: V1 }, { label: "Shipped", color: V2 }]}
          table={{ head: ["Month", "Received", "Shipped"], rows: monthRows.map(m => [m.name, m.received, m.shipped]) }}>
          {months.some(m => m.receivedCount || m.soldCount) ? (
            <div className="h-60">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={monthRows} margin={{ top: 6, right: 8, left: -16, bottom: 0 }}>
                  {grid}
                  <XAxis dataKey="name" tick={AXIS} axisLine={false} tickLine={false} interval="preserveStartEnd" minTickGap={8} />
                  <YAxis tick={AXIS} axisLine={false} tickLine={false} width={40} allowDecimals={false} />
                  <Tooltip cursor={{ stroke: "var(--color-border)" }} content={<ChartTip format={v => String(v)} />} />
                  <Line type="monotone" dataKey="received" name="Received" stroke={V1} strokeWidth={2} dot={false} activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--color-card)" }} isAnimationActive={false} />
                  <Line type="monotone" dataKey="shipped" name="Shipped" stroke={V2} strokeWidth={2} dot={false} activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--color-card)" }} isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          ) : <Empty>No orders in this period.</Empty>}
        </ChartCard>
        {admin && hasSwitch("fig.costs") && a.factories.length > 0 && (
          <ChartCard title="Factories" sub="Pieces finished in this period, fine gold in them, labour and open jobs">
            {/* The app's one table — cards on a phone (it was a 640px-wide table to slide sideways); each opens its factory. */}
            <DataTable id="home-factories" noun="factory" plural="factories" rows={a.factories} rowKey={f => f.id} details={false} controls="none"
              rowHref={f => `/factories/${f.id}`} defaultSort={{ key: "pieces", dir: "desc" }}
              columns={[
                { key: "name", header: "Factory", always: true, sortValue: f => f.name, cell: f => <span className="font-medium text-foreground">{f.name}</span> },
                { key: "pieces", header: "Pieces", align: "right", kind: "number", sortValue: f => f.pieces, cell: f => <span className="tabular-nums">{f.pieces}</span> },
                { key: "fine", header: "Fine gold", align: "right", kind: "number", sortValue: f => f.fineGoldG, cell: f => <span className="tabular-nums">{num(f.fineGoldG)} g</span> },
                { key: "labour", header: "Labour", align: "right", kind: "number", sortValue: f => f.labourInr, cell: f => <span className="tabular-nums">{inr(f.labourInr, true)}</span> },
                { key: "unpaid", header: "Labour unpaid", align: "right", kind: "number", sortValue: f => f.labourPendingInr,
                  cell: f => <span className={`tabular-nums ${f.labourPendingInr > 0.5 ? "text-destructive font-medium" : ""}`}>{inr(f.labourPendingInr, true)}</span> },
                { key: "open", header: "Open jobs", align: "right", kind: "number", sortValue: f => f.openJobs, cell: f => <span className="tabular-nums">{f.openJobs}</span> },
                { key: "days", header: "Avg days", align: "right", kind: "number", sortValue: f => f.avgDays ?? -1, cell: f => <span className="tabular-nums">{f.avgDays == null ? "—" : num(f.avgDays)}</span> },
              ]} />
          </ChartCard>
        )}
      </Section>

      {admin && a.team.length > 0 && (
        <Section title="Team" sub="Each person's orders, sales and collections in this period.">
          <ChartCard title="By person" sub="Ranked by sales"
            table={{ head: ["Person", "Received", "Shipped", "Sales", "Collected", "On time"], rows: a.team.map(t => [t.name, t.received, t.sold, usd(t.salesUsd), usd(t.collectedUsd), pct(t.onTimePct)]) }}>
            <Ranked rows={a.team.map(t => ({ key: t.id, label: t.name, value: t.salesUsd, sub: `${t.sold} shipped${t.onTimePct != null ? ` · ${pct(t.onTimePct)} on time` : ""}` }))} format={compactUsd} />
          </ChartCard>
        </Section>
      )}
    </div>
  );
}
