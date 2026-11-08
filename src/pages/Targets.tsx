// Targets — the company's sales target for the business year (April–March, or
// Diwali to Diwali), and how it is going: this month against its target, what
// is needed per day, the forecast, the catch-up plan for the months left, and
// why — set against last year. Admins only. The logic: lib/salesTargets.ts.
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { Target, CalendarDays, Flag, TrendingUp, TrendingDown, Pencil, Sparkles, AlertTriangle, CheckCircle2 } from "lucide-react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis, Legend } from "recharts";
import { useDb } from "@/hooks/useDb";
import { useAuth } from "@/lib/auth";
import { updateDbAs, fmtMoney, type AdminRecord } from "@/lib/db";
import { PageHeader } from "@/components/PageHeader";
import { SectionTitle } from "@/components/SectionTitle";
import { StatStrip } from "@/components/TableToolbar";
import { DataTable, CellTag, type DataColumn } from "@/components/DataTable";
import { ActionSheet } from "@/components/ActionSheet";
import { AsyncButton } from "@/components/AsyncButton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { dayOf, addDays } from "@/lib/fiscalYear";
import {
  currentYear, planFor, progress, drivers, lastYear, splitYear, monthName, fmtDay, nextDiwali, monthsDays, daysIn, DIWALI,
  PACE_LABEL, type Pace, type TargetPlan, type TargetMonth, type MonthRow,
} from "@/lib/salesTargets";

const usd = (n: number | null | undefined) => (n == null ? "—" : fmtMoney(Math.round(n)));
const pct = (r: number | null | undefined) => (r == null ? "—" : `${Math.round(r * 100)}%`);
const change = (now: number, before: number) => (before > 0 ? Math.round(((now - before) / before) * 1000) / 10 : null);
const TONE: Record<Pace, "green" | "blue" | "amber" | "red" | "neutral"> = { ahead: "green", on: "green", slight: "amber", behind: "amber", weak: "red", none: "neutral" };
/** The progress bar's colour by pace — kept apart from the theme colour. */
const BAR: Record<Pace, string> = { ahead: "bg-emerald-500", on: "bg-emerald-500", slight: "bg-yellow-500", behind: "bg-rose-400", weak: "bg-rose-600", none: "bg-slate-400" };

function PaceTag({ pace }: { pace: Pace }) {
  return <CellTag tone={TONE[pace]}>{PACE_LABEL[pace]}</CellTag>;
}

export function TargetsPage() {
  const db = useDb();
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const today = dayOf(new Date());
  const year = currentYear(db, today);
  const plan = planFor(db, year.from);
  const [editing, setEditing] = useState(false);
  const p = useMemo(() => (plan ? progress(db, plan, today) : null), [db, plan, today]);
  const why = useMemo(() => drivers(db, year.from, today), [db, year.from, today]);
  const custom = !!db.settings.fyCustomDates;

  if (!isAdmin) return <div className="text-center py-20 text-muted-foreground">Targets are for admins.</div>;

  const days = daysIn(year.from, year.to);
  const dayNo = today < year.from ? 0 : today > year.to ? days : daysIn(year.from, today);
  // Left = the days after today, to the year's last day (both ways of counting agree).
  const leftFrom = today < year.from ? year.from : addDays(today, 1);
  const left = leftFrom > year.to ? { months: 0, days: 0 } : monthsDays(leftFrom, addDays(year.to, 1));
  const leftDays = Math.max(0, days - dayNo);
  // The next Diwali from today (on own dates, the year's end).
  const diwali = custom ? year.to : DIWALI.find(d => d >= today);
  // On own dates the year may end on Diwali or on any day the business chose.
  const onDiwali = custom && DIWALI.includes(year.to);
  const inDays = diwali ? Math.max(0, daysIn(today, diwali) - 1) : 0;
  const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <PageHeader title="Targets" subtitle={`${!custom ? "Financial year" : onDiwali ? "Diwali year" : "Business year"} ${year.label}`}
        info="The company's sales target for the business year, and how it is going — sales dispatched (as Profit & Loss), with orders booked beside them."
        primary={{ label: plan ? "Edit target" : "Set target", icon: plan ? Pencil : Target, onClick: () => setEditing(true) }} />

      {/* The year, counted down. */}
      <StatStrip items={[
        { label: "Day of the year", value: `${dayNo} of ${days}`, icon: CalendarDays, sub: `${fmtDay(year.from)} – ${fmtDay(year.to)}` },
        { label: "Left in the year", value: `${plural(left.months, "month")} ${plural(left.days, "day")}`, icon: Flag, sub: `${plural(leftDays, "day")} after today` },
        diwali ? { label: !custom ? "Next Diwali" : onDiwali ? "Year ends on Diwali" : "Year ends on", value: fmtDay(diwali), icon: Sparkles, sub: inDays === 0 ? "Today" : inDays === 1 ? "Tomorrow" : `in ${inDays} days` }
          : { label: "Year ends", value: fmtDay(year.to), icon: Sparkles },
      ]} />

      {!plan || !p ? (
        <div className="card-luxe p-8 text-center space-y-3">
          <Target className="h-10 w-10 mx-auto text-primary/40" />
          <p className="font-display text-xl text-brand-dark">No target set for this year</p>
          <p className="text-sm text-muted-foreground max-w-lg mx-auto">Set the year's sales target — an amount, or last year plus a growth %. The app splits it into months by last year's pattern, then shows every day how far you are, what's needed per day and what next month must bring.</p>
          <Button onClick={() => setEditing(true)} className="rounded-xl h-10"><Target className="h-4 w-4 mr-2" />Set this year's target</Button>
        </div>
      ) : (
        <>
          <ThisMonth p={p} />
          <TheYear p={p} />
          <Months p={p} />
        </>
      )}
      <Why why={why} plan={plan} />
      {editing && <SetTargetSheet from={year.from} to={year.to} plan={plan} custom={custom} onClose={() => setEditing(false)} />}
    </div>
  );
}

/* ── This month ─────────────────────────────────────────────────────────── */
function ThisMonth({ p }: { p: NonNullable<ReturnType<typeof progress>> }) {
  const c = p.current;
  if (!c) return null;
  const r = c.row;
  const fill = r.catchUp > 0 ? Math.min(1, r.sales / r.catchUp) : 0;
  const mark = r.catchUp > 0 ? Math.min(1, c.expected / r.catchUp) : 0;
  const behind = c.gapToExpected < 0;
  const sentence = r.catchUp <= 0 ? "No target this month."
    : r.sales >= r.catchUp ? `This month's target is reached — ${usd(r.sales - r.catchUp)} over.`
    : behind ? `${usd(-c.gapToExpected)} behind where this month should be by today. To reach the target, sell ${usd(c.perDay)} a day for the ${c.daysLeft} day${c.daysLeft === 1 ? "" : "s"} left.`
    : `${usd(c.gapToExpected)} ahead of where this month should be by today. ${usd(c.toGo)} still to sell — ${usd(c.perDay)} a day.`;
  return (
    <section className="card-luxe p-5 sm:p-6 space-y-5">
      <SectionTitle icon={Target} title={monthName(r.key)} sub={`This month · day ${c.daysGone} of ${c.daysGone + c.daysLeft - 1}`}
        actions={<PaceTag pace={r.pace} />} />
      <div>
        <div className="flex items-baseline justify-between gap-3 flex-wrap">
          <p className="font-display text-3xl font-bold text-brand-dark tabular-nums">{usd(r.sales)} <span className="text-base font-normal text-muted-foreground">of {usd(r.catchUp)}</span></p>
          <p className="text-sm font-semibold tabular-nums">{pct(r.catchUp > 0 ? r.sales / r.catchUp : null)} of the month</p>
        </div>
        {/* The bar: sales so far; the tick is where the month should be by today. */}
        <div className="relative mt-3 h-3 rounded-full bg-secondary overflow-hidden" role="img" aria-label={`${pct(fill)} of the month's target; expected by today ${pct(mark)}`}>
          <div className={`h-full rounded-full ${BAR[r.pace]}`} style={{ width: `${fill * 100}%` }} />
          <div className="absolute top-[-3px] bottom-[-3px] w-0.5 bg-brand-dark" style={{ left: `${mark * 100}%` }} title="Where the month should be by today" />
        </div>
        <p className={`mt-3 text-sm flex gap-2 ${behind ? "text-rose-700" : "text-emerald-700"}`}>
          {behind ? <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" /> : <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0" />}<span>{sentence}</span>
        </p>
      </div>
      <StatStrip items={[
        { label: "Expected by today", value: usd(c.expected), sub: `Pace ${pct(c.ratio)}` },
        { label: "Needed per day", value: usd(c.perDay), sub: `${usd(c.toGo)} left · ${c.daysLeft} day${c.daysLeft === 1 ? "" : "s"}`, tone: "strong" },
        { label: "Month-end forecast", value: c.forecast == null ? "After day 3" : usd(c.forecast), sub: c.forecast == null ? "Too early to tell" : `At today's run rate · ${pct(r.catchUp > 0 ? c.forecast / r.catchUp : null)}` },
        { label: "Due to ship this month", value: usd(c.pipeline.value), sub: `${c.pipeline.count} order${c.pipeline.count === 1 ? "" : "s"} booked, not yet dispatched` },
        { label: "Orders booked", value: usd(r.booked), sub: `${r.bookedCount} this month · early signal`, tone: "in" },
      ]} />
      <div className="rounded-xl border border-border/70 bg-secondary/40 p-4 text-sm space-y-1">
        {r.catchUp !== r.target && (
          <p>This month's target was {usd(r.target)}; with the year's catch-up it is <b>{usd(r.catchUp)}</b> {r.catchUp > r.target ? "(earlier months fell short)" : "(earlier months did better)"}.</p>
        )}
        {c.nextNeeds && (
          <p>If {monthName(r.key)} ends at {usd(Math.max(c.forecast ?? 0, r.sales + c.pipeline.value))}, <b>{monthName(c.nextNeeds.key)}</b> will need <b>{usd(c.nextNeeds.amount)}</b> to keep the year on target.</p>
        )}
      </div>
    </section>
  );
}

/* ── The year ───────────────────────────────────────────────────────────── */
function TheYear({ p }: { p: NonNullable<ReturnType<typeof progress>> }) {
  const y = p.year;
  const vsLy = change(y.sales, y.lastYearToDate);
  // Cumulative target and sales, month by month.
  let ct = 0, cs = 0;
  const data = p.months.map(m => {
    ct += m.target;
    if (m.state !== "future") cs += m.sales;
    return { month: monthName(m.key), Target: Math.round(ct), Sales: m.state === "future" ? null : Math.round(cs) };
  });
  return (
    <section className="card-luxe p-5 sm:p-6 space-y-5">
      <SectionTitle icon={TrendingUp} title="The year" sub={`Target ${usd(p.plan.yearTarget)}`} actions={<PaceTag pace={y.pace} />} />
      <StatStrip items={[
        { label: "Sold so far", value: usd(y.sales), sub: `${pct(p.plan.yearTarget > 0 ? y.sales / p.plan.yearTarget : null)} of the year's target`, tone: "in" },
        { label: "Expected by today", value: usd(y.expected), sub: `Pace ${pct(y.ratio)}` },
        { label: "Still to sell", value: usd(y.toGo), sub: `${usd(y.perDay)} a day for ${y.left} day${y.left === 1 ? "" : "s"}`, tone: "strong" },
        { label: "Last year by now", value: usd(y.lastYearToDate), sub: vsLy == null ? "—" : `${vsLy >= 0 ? "+" : ""}${vsLy}% this year`, icon: vsLy != null && vsLy < 0 ? TrendingDown : TrendingUp },
        { label: "Orders booked", value: usd(y.booked), sub: "This year so far", tone: "in" },
      ]} />
      <div className="h-64" aria-label="Target and sales, added up month by month">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: 8 }}>
            <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="month" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
            <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} tickFormatter={v => `$${Math.round(v / 1000)}k`} width={48} />
            <Tooltip formatter={(v: number) => usd(v)} />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Line type="monotone" dataKey="Target" stroke="#9ca3af" strokeDasharray="5 4" strokeWidth={2} dot={false} isAnimationActive={false} />
            <Line type="monotone" dataKey="Sales" stroke="#2a78d6" strokeWidth={2} dot={{ r: 3 }} connectNulls={false} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}

/* ── Month by month ─────────────────────────────────────────────────────── */
function Months({ p }: { p: NonNullable<ReturnType<typeof progress>> }) {
  const columns: DataColumn<MonthRow>[] = [
    { key: "month", header: "Month", always: true, sortValue: m => m.key, csv: m => monthName(m.key),
      cell: m => <span className={`font-medium whitespace-nowrap ${m.state === "current" ? "text-primary" : "text-brand-dark"}`}>{monthName(m.key)}{m.state === "current" ? " · now" : ""}</span> },
    { key: "target", header: "Target", align: "right", kind: "number", sortValue: m => m.target, csv: m => m.target, cell: m => usd(m.target) },
    { key: "catch", header: "Catch-up target", align: "right", kind: "number", sortValue: m => m.catchUp, csv: m => m.catchUp,
      cell: m => (m.state === "past" ? <span className="text-muted-foreground">—</span> : <span className={m.catchUp > m.target ? "text-amber-800 font-medium" : ""}>{usd(m.catchUp)}</span>) },
    { key: "sales", header: "Sales", align: "right", kind: "number", sortValue: m => m.sales, csv: m => m.sales, cell: m => (m.state === "future" ? "—" : usd(m.sales)) },
    { key: "pct", header: "Achieved", align: "right", kind: "number", sortValue: m => m.achieved, csv: m => (m.achieved == null ? "" : Math.round(m.achieved * 100)), cell: m => pct(m.achieved) },
    { key: "pace", header: "Status", sortValue: m => m.pace, csv: m => PACE_LABEL[m.pace], cell: m => (m.state === "future" ? <span className="text-muted-foreground text-xs">To come</span> : <PaceTag pace={m.pace} />) },
    { key: "booked", header: "Orders booked", align: "right", kind: "number", sortValue: m => m.booked, csv: m => m.booked, cell: m => (m.state === "future" ? "—" : usd(m.booked)) },
    { key: "ly", header: "Last year", align: "right", kind: "number", sortValue: m => m.lastYear, csv: m => m.lastYear, cell: m => usd(m.lastYear) },
  ];
  return (
    <section className="card-luxe p-5 sm:p-6">
      <SectionTitle title="Month by month" sub="A month that falls short raises the catch-up target of the months left; the year's target stays" />
      <div className="mt-3">
        <DataTable id="targets-months" noun="month" rows={p.months} columns={columns} rowKey={m => m.key} pageSizes={[13, 26]} exportName="Targets-month-by-month" />
      </div>
    </section>
  );
}

/* ── Why ────────────────────────────────────────────────────────────────── */
function Why({ why, plan }: { why: ReturnType<typeof drivers>; plan?: TargetPlan }) {
  const sCh = change(why.now.sales, why.last.sales), oCh = change(why.now.orders, why.last.orders), aCh = why.now.avg != null && why.last.avg != null ? change(why.now.avg, why.last.avg) : null;
  const tip = sCh == null ? "" : oCh != null && aCh != null
    ? oCh < 0 && aCh >= 0 ? "Fewer orders, not smaller ones — bring more customers back (see who's gone quiet)."
      : aCh < 0 && oCh >= 0 ? "As many orders, but smaller — offer bigger pieces or sets to regulars."
      : oCh < 0 && aCh < 0 ? "Fewer and smaller orders — start with the customers buying less than last year."
      : "More orders and bigger ones — keep it going." : "";
  const sub = <T,>(rows: T[], cols: DataColumn<T>[], id: string, key: (r: T) => string, href: (r: T) => string, empty: string) => (
    <DataTable id={id} noun="customer" rows={rows} columns={cols} rowKey={key} rowHref={href} controls="none" pageSizes={[8]} emptyText={empty} />
  );
  return (
    <section className="card-luxe p-5 sm:p-6 space-y-5">
      <SectionTitle title="What is driving it" sub="This year so far against the same days last year" />
      <StatStrip items={[
        { label: "Sales", value: usd(why.now.sales), sub: sCh == null ? `Last year ${usd(why.last.sales)}` : `${sCh >= 0 ? "+" : ""}${sCh}% · last year ${usd(why.last.sales)}`, tone: "in" },
        { label: "Orders sold", value: String(why.now.orders), sub: oCh == null ? `Last year ${why.last.orders}` : `${oCh >= 0 ? "+" : ""}${oCh}% · last year ${why.last.orders}` },
        { label: "Average order", value: usd(why.now.avg), sub: aCh == null ? `Last year ${usd(why.last.avg)}` : `${aCh >= 0 ? "+" : ""}${aCh}% · last year ${usd(why.last.avg)}` },
      ]} note={tip || undefined} />
      <div className="grid lg:grid-cols-3 gap-5 [&>*]:min-w-0">
        <div>
          <SectionTitle title="Buying less than last year" sub="By now last year against this year" />
          <div className="mt-2">{sub(why.down, [
            { key: "name", header: "Customer", always: true, cell: r => <span className="font-medium">{r.name}</span> },
            { key: "gap", header: "Down by", align: "right", sortValue: r => r.last - r.now, cell: r => <span className="text-amber-800 tabular-nums">{usd(r.last - r.now)}</span> },
          ], "targets-down", r => r.id, r => `/clients/${r.id}`, "No customer is behind last year.")}</div>
        </div>
        <div>
          <SectionTitle title="Gone quiet" sub="Bought in the last 12 months, no order for 60+ days" />
          <div className="mt-2">{sub(why.quiet, [
            { key: "name", header: "Customer", always: true, cell: r => <span className="font-medium">{r.name}</span> },
            { key: "days", header: "Days", align: "right", sortValue: r => r.days, cell: r => <span className="tabular-nums">{r.days}</span> },
            { key: "ly", header: "12 months", align: "right", sortValue: r => r.lastYear, cell: r => <span className="tabular-nums">{usd(r.lastYear)}</span> },
          ], "targets-quiet", r => r.id, r => `/clients/${r.id}`, "Every recent customer has ordered in the last 60 days.")}</div>
        </div>
        <div>
          <SectionTitle title="Where sales came from" sub="Top customers this year" />
          <div className="mt-2">{sub(why.top, [
            { key: "name", header: "Customer", always: true, cell: r => <span className="font-medium">{r.name}</span> },
            { key: "sales", header: "Sales", align: "right", sortValue: r => r.sales, cell: r => <span className="tabular-nums">{usd(r.sales)}</span> },
            { key: "share", header: "Share", align: "right", cell: r => <span className="tabular-nums text-muted-foreground">{pct(why.now.sales > 0 ? r.sales / why.now.sales : null)}</span> },
          ], "targets-top", r => r.id, r => `/clients/${r.id}`, "No sales yet this year.")}</div>
        </div>
      </div>
      {!plan && <p className="text-xs text-muted-foreground">Set a target above to see the month's pace and catch-up plan.</p>}
      <p className="text-[11px] text-muted-foreground">Sales are dispatched sales, as in <Link to="/reports" className="text-primary hover:underline">Reports</Link> → Profit &amp; Loss.</p>
    </section>
  );
}

/* ── Setting the target ─────────────────────────────────────────────────── */
function SetTargetSheet({ from, to: yearTo, plan, custom, onClose }: { from: string; to: string; plan?: TargetPlan; custom: boolean; onClose: () => void }) {
  const db = useDb();
  const { user } = useAuth();
  const [to, setTo] = useState(plan?.to ?? yearTo);
  const ly = useMemo(() => lastYear(db, from, to), [db, from, to]);
  const [mode, setMode] = useState<"amount" | "growth">(plan?.mode ?? (ly.total > 0 ? "growth" : "amount"));
  const [amount, setAmount] = useState(plan && plan.mode === "amount" ? String(plan.yearTarget) : "");
  const [growth, setGrowth] = useState(plan?.growthPct != null ? String(plan.growthPct) : "20");
  const yearTarget = mode === "growth" ? Math.round(ly.total * (1 + (Number(growth) || 0) / 100)) : Math.round(Number(amount) || 0);
  const [months, setMonths] = useState<TargetMonth[]>(() => plan?.months ?? []);
  const [touched, setTouched] = useState<Set<string>>(() => new Set((plan?.months ?? []).filter(m => m.manual).map(m => m.key)));
  // Re-split whenever the year's target or its end changes — months set by hand stay.
  const split = useMemo(() => splitYear(db, from, to, yearTarget, months.filter(m => touched.has(m.key)).map(m => ({ ...m, manual: true }))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [db, from, to, yearTarget, touched.size, JSON.stringify(months.filter(m => touched.has(m.key)).map(m => [m.key, m.target]))]);
  const sum = split.reduce((s, m) => s + m.target, 0);
  const setMonth = (key: string, v: string) => {
    const n = Math.max(0, Math.round(Number(v) || 0));
    setMonths([...split.filter(m => m.key !== key), { ...split.find(m => m.key === key)!, target: n, manual: true }]);
    setTouched(new Set([...touched, key]));
  };
  const save = async () => {
    if (!(yearTarget > 0)) { toast.error(mode === "growth" ? "Last year had no sales — enter the year's target as an amount" : "Enter the year's target"); return; }
    if (custom && !(to > from)) { toast.error("The year's last day must come after its first"); return; }
    const final: TargetPlan = {
      from, to, label: custom ? `${fmtDay(from)} – ${fmtDay(to)}` : `${from.slice(0, 4)}-${to.slice(2, 4)}`,
      mode, yearTarget: Math.max(yearTarget, sum), ...(mode === "growth" ? { growthPct: Number(growth) || 0 } : {}),
      months: split.map(m => ({ key: m.key, from: m.from, to: m.to, target: m.target, ...(touched.has(m.key) ? { manual: true } : {}) })),
      setAt: new Date().toISOString(), setBy: user?.name ?? "Admin",
    };
    updateDbAs({ summary: `Sales target ${final.label}: ${fmtMoney(final.yearTarget)}` }, d => {
      // On own dates the year's end is one setting (Settings → Year closing "This year ends on").
      if (custom) d.settings.fyOwnEnd = to;
      if (!d.adminRecords) d.adminRecords = [];
      const id = `target_${from}`;
      const rec = { id, kind: "salesTarget", plan: final } as AdminRecord;
      const i = d.adminRecords.findIndex(r => r.id === id);
      if (i >= 0) d.adminRecords[i] = rec; else d.adminRecords.push(rec);
    });
    toast.success(`Target set — ${fmtMoney(final.yearTarget)} for the year`);
    onClose();
  };
  const field = "h-10 rounded-xl mt-1";
  return (
    <ActionSheet open onOpenChange={o => { if (!o) onClose(); }} size="lg" icon={Target} title={plan ? "Edit the year's target" : "Set the year's target"}
      description={`${fmtDay(from)} – ${fmtDay(to)}`}
      footer={<div className="flex items-center justify-between gap-3 flex-wrap">
        <p className="text-sm">Year target <b>{fmtMoney(Math.max(yearTarget, sum))}</b>{sum > yearTarget ? " (months set by hand add up to more)" : ""}</p>
        <div className="flex gap-2"><Button variant="outline" onClick={onClose} className="rounded-xl h-10">Cancel</Button>
          <AsyncButton onClick={save} className="btn-hero rounded-xl h-10 px-6">Save target</AsyncButton></div>
      </div>}>
      <div className="space-y-5">
        {custom && (
          <div>
            <Label className="text-xs">The year ends on</Label>
            <Input type="date" min={addDays(from, 1)} value={to} onChange={e => e.target.value && setTo(e.target.value)} className={`${field} w-auto`} />
            <p className="text-[11px] text-muted-foreground mt-1">From {fmtDay(from)}{nextDiwali(from) ? ` · next Diwali ${fmtDay(nextDiwali(from)!)}` : ""} — or any day you close your books. The same as Settings → Year closing "This year ends on".</p>
          </div>
        )}
        <div>
          <Label className="text-xs">Target by</Label>
          <div className="mt-1 grid grid-cols-2 gap-2" role="radiogroup" aria-label="Target by">
            {([["growth", "Last year + growth %"], ["amount", "An amount"]] as const).map(([k, l]) => (
              <button key={k} type="button" role="radio" aria-checked={mode === k} onClick={() => setMode(k)}
                className={`h-10 rounded-xl border text-sm px-3 ${mode === k ? "border-primary bg-primary/[0.06] text-primary font-medium" : "border-border hover:bg-secondary/60"}`}>{l}</button>
            ))}
          </div>
        </div>
        {mode === "growth" ? (
          <div className="grid sm:grid-cols-2 gap-3 items-end">
            <div>
              <Label className="text-xs">Growth on last year (%)</Label>
              <Input type="number" step="1" value={growth} onChange={e => setGrowth(e.target.value)} className={field} aria-label="Growth %" />
            </div>
            <p className="text-sm text-muted-foreground pb-2.5">Last year, same days: <b className="text-brand-dark">{fmtMoney(ly.total)}</b> → target <b className="text-brand-dark">{fmtMoney(yearTarget)}</b></p>
          </div>
        ) : (
          <div className="grid sm:grid-cols-2 gap-3 items-end">
            <div>
              <Label className="text-xs">The year's sales target ($)</Label>
              <Input type="number" min={0} step="1000" value={amount} onChange={e => setAmount(e.target.value)} className={field} aria-label="Year target" />
            </div>
            <p className="text-sm text-muted-foreground pb-2.5">Last year, same days: <b className="text-brand-dark">{fmtMoney(ly.total)}</b>{ly.total > 0 && yearTarget > 0 ? ` (${yearTarget >= ly.total ? "+" : ""}${Math.round((yearTarget / ly.total - 1) * 100)}%)` : ""}</p>
          </div>
        )}
        <div>
          <SectionTitle title="Month by month" sub={ly.total > 0 ? "Split by last year's pattern — change any month; the rest share what is left" : "No sales last year to follow — split by days; change any month"} />
          <div className="mt-2 rounded-xl border border-border/70 divide-y divide-border/50">
            {split.map(m => {
              const lyM = ly.months.find(x => x.key === m.key)?.sales ?? 0;
              return (
                <div key={m.key} className="grid grid-cols-[6.5rem_minmax(0,1fr)_8rem] sm:grid-cols-[8rem_minmax(0,1fr)_10rem] items-center gap-3 px-3 py-2">
                  <span className="text-sm font-medium text-brand-dark">{monthName(m.key)}</span>
                  <span className="text-xs text-muted-foreground truncate">Last year {fmtMoney(lyM)}{touched.has(m.key) ? " · set by hand" : ""}</span>
                  <Input type="number" min={0} step="100" value={m.target} onChange={e => setMonth(m.key, e.target.value)} className="h-9 rounded-lg text-right" aria-label={`Target ${monthName(m.key)}`} />
                </div>
              );
            })}
          </div>
          {touched.size > 0 && <button type="button" onClick={() => { setTouched(new Set()); setMonths([]); }} className="mt-2 text-xs text-primary hover:underline">Split every month again by last year</button>}
        </div>
      </div>
    </ActionSheet>
  );
}

/** The Home card: this month against its target, for admins. */
export function TargetCard() {
  const db = useDb();
  const today = dayOf(new Date());
  const year = currentYear(db, today);
  const plan = planFor(db, year.from);
  const p = plan ? progress(db, plan, today) : null;
  const c = p?.current;
  if (!plan || !p) {
    return (
      <Link to="/targets" className="card-luxe p-4 flex items-center gap-3 hover:shadow-md transition-shadow">
        <Target className="h-5 w-5 text-primary shrink-0" />
        <span className="text-sm"><b className="text-brand-dark">Set this year's sales target</b> <span className="text-muted-foreground">— see each day how far you are and what is needed.</span></span>
      </Link>
    );
  }
  const fill = c && c.row.catchUp > 0 ? Math.min(1, c.row.sales / c.row.catchUp) : 0;
  const mark = c && c.row.catchUp > 0 ? Math.min(1, c.expected / c.row.catchUp) : 0;
  return (
    <Link to="/targets" className="card-luxe p-4 block hover:shadow-md transition-shadow space-y-2">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <span className="flex items-center gap-2 text-sm font-semibold text-brand-dark"><Target className="h-4 w-4 text-primary" />{c ? `${monthName(c.row.key)} target` : "Year target"}</span>
        <PaceTag pace={c ? c.row.pace : p.year.pace} />
      </div>
      {c ? (
        <>
          <p className="text-sm"><b className="tabular-nums">{usd(c.row.sales)}</b> <span className="text-muted-foreground">of {usd(c.row.catchUp)} · {pct(c.row.catchUp > 0 ? c.row.sales / c.row.catchUp : null)}</span></p>
          <div className="relative h-2 rounded-full bg-secondary overflow-hidden">
            <div className={`h-full rounded-full ${BAR[c.row.pace]}`} style={{ width: `${fill * 100}%` }} />
            <div className="absolute top-[-2px] bottom-[-2px] w-0.5 bg-brand-dark" style={{ left: `${mark * 100}%` }} />
          </div>
          <p className="text-[11px] text-muted-foreground">{usd(c.perDay)} a day needed · {c.daysLeft} day{c.daysLeft === 1 ? "" : "s"} left · year {pct(plan.yearTarget > 0 ? p.year.sales / plan.yearTarget : null)} · day {p.year.day} of {p.year.days}</p>
        </>
      ) : (
        <p className="text-sm">{usd(p.year.sales)} of {usd(plan.yearTarget)}</p>
      )}
    </Link>
  );
}
