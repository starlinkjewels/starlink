/**
 * Sales targets — the company's year target, split into months, and how the
 * business is pacing against it, worked out the way sales teams do:
 *
 *   phasing        the year's target spread over its months by LAST year's
 *                  pattern (70% last year's share of each month, 30% its share
 *                  of the days, so a month that sold nothing last year still
 *                  gets a fair target); any month can be set by hand.
 *   expected       month target × days gone ÷ days in the month — where the
 *                  month should be by today if sales came in evenly.
 *   pace           sales so far ÷ expected. 100% or more is on track.
 *   needed / day   what is left of the month's target ÷ days left (today too).
 *   forecast       sales so far ÷ days gone × days in the month (the run rate),
 *                  and beside it what is already booked and due to ship.
 *   catch-up       what the year still needs, spread over the months left in
 *                  proportion to their targets: a short month raises the next
 *                  ones, a strong one lowers them; the year's target stays.
 *
 * "Sales" is sales dispatched — exactly Reports → Profit & Loss (recognisedSale
 * at its sale date). Orders booked (placed, not cancelled) are shown beside it
 * as the early signal. Both in dollars, as orders are billed.
 *
 * The year is the business's own (Settings → Year closing): April–March, a
 * month of its choosing, or its own dates — Diwali to Diwali.
 */
import { orderTotal, type DB, type Order, type AdminRecord } from "./db";
import { soldIn, receivedIn, type Period } from "./analytics";
import { recognisedSale } from "./orderCost";
import { addDays, dayOf, fiscalYearOf, ownYear, type FiscalYear } from "./fiscalYear";

const r2 = (n: number) => Math.round(n * 100) / 100;
const pad = (n: number) => String(n).padStart(2, "0");

export { DIWALI, nextDiwali } from "./fiscalYear";

export interface TargetMonth {
  /** "2026-04". */
  key: string;
  /** The part of the month inside the year (the first and last can be part months). */
  from: string;
  to: string;
  /** The target as set (split, or typed). */
  target: number;
  /** Typed by hand — kept when the year's target is split again. */
  manual?: boolean;
}

export interface TargetPlan {
  /** The year's first day and last day. */
  from: string;
  to: string;
  /** "2025-26", or the dates when the year is on own dates. */
  label: string;
  mode: "amount" | "growth";
  yearTarget: number;
  growthPct?: number;
  months: TargetMonth[];
  setAt: string;
  setBy: string;
}

export type TargetRecord = Extract<AdminRecord, { kind: "salesTarget" }>;

/* ── The year ───────────────────────────────────────────────────────────── */

/** The business year running now, as the targets read it. On own dates (Diwali
 *  to Diwali) it runs from the day after the last close to the next Diwali —
 *  or to the end a plan for it was set with. */
export function currentYear(db: Pick<DB, "settings" | "orders" | "adminRecords">, today = dayOf(new Date())): { from: string; to: string; label: string } {
  const s = db.settings;
  if (s.fyCustomDates) {
    // The one rule (lib/fiscalYear.ts ownYear): its start and end as set in
    // Settings → Year closing — Diwali by default, any day the business chooses.
    const { from } = ownYear(s, today);
    const { to } = ownYear(s, today, targetPlans(db).find(p => p.from === from)?.to);
    return { from, to, label: `${fmtDay(from)} – ${fmtDay(to)}` };
  }
  const fy: FiscalYear = fiscalYearOf(today, s.fyStartMonth || 4);
  return { from: fy.from, to: fy.to, label: fy.key };
}

/** The calendar months a year spans, each cut to the year. */
export function monthsOf(from: string, to: string): { key: string; from: string; to: string }[] {
  const out: { key: string; from: string; to: string }[] = [];
  let y = Number(from.slice(0, 4)), m = Number(from.slice(5, 7));
  for (let i = 0; i < 40; i++) {
    const first = `${y}-${pad(m)}-01`;
    const last = dayOf(new Date(y, m, 0));
    if (first > to) break;
    out.push({ key: `${y}-${pad(m)}`, from: first < from ? from : first, to: last > to ? to : last });
    m++; if (m > 12) { m = 1; y++; }
  }
  return out;
}

export const daysIn = (from: string, to: string) => Math.round((+new Date(`${to}T12:00:00`) - +new Date(`${from}T12:00:00`)) / 86_400_000) + 1;
export const fmtDay = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
export const monthName = (key: string) => new Date(`${key}-01T12:00:00`).toLocaleDateString("en-GB", { month: "short", year: "numeric" });
/** The same day a year earlier (29 Feb → 28 Feb). */
const yearBack = (d: string) => { const y = Number(d.slice(0, 4)) - 1; const md = d.slice(5) === "02-29" ? "02-28" : d.slice(5); return `${y}-${md}`; };

/** "12 months 18 days" between two days (inclusive of the first, exclusive of the last). */
export function monthsDays(from: string, to: string): { months: number; days: number } {
  const a = new Date(`${from}T12:00:00`), b = new Date(`${to}T12:00:00`);
  const plus = (n: number) => { const x = new Date(a); x.setMonth(a.getMonth() + n); return x; };
  let months = (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth());
  if (plus(months) > b) months--;
  const days = Math.round((+b - +plus(months)) / 86_400_000);
  return { months: Math.max(0, months), days: Math.max(0, days) };
}

/* ── Sales ──────────────────────────────────────────────────────────────── */

const live = (db: Pick<DB, "orders">) => db.orders.filter(o => !o.deletedAt);
/** Sales dispatched in a span — exactly as Reports → Profit & Loss counts them. */
export function salesIn(db: Pick<DB, "orders">, from: string, to: string): number {
  return r2(soldIn(live(db), { from, to } as Period).reduce((s, o) => s + orderTotal(o), 0));
}
/** Orders booked in a span (placed, not cancelled) — the early signal. */
export function bookedIn(db: Pick<DB, "orders">, from: string, to: string): { value: number; count: number } {
  const os = receivedIn(live(db), { from, to } as Period).filter(o => o.status !== "Rejected");
  return { value: r2(os.reduce((s, o) => s + orderTotal(o), 0)), count: os.length };
}
/** Booked, not yet dispatched, and due by a day — what is likely to ship. */
export function pipelineDue(db: Pick<DB, "orders">, by: string): { value: number; count: number } {
  const os = live(db).filter(o => !o.forReadyStock && o.status !== "Rejected" && !recognisedSale(o) && o.amount > 0
    && !!o.expectedDelivery && o.expectedDelivery.slice(0, 10) <= by);
  return { value: r2(os.reduce((s, o) => s + orderTotal(o), 0)), count: os.length };
}

/* ── Setting the target ─────────────────────────────────────────────────── */

/** Last year's sales over the same span, and each month's share of it. */
export function lastYear(db: Pick<DB, "orders">, from: string, to: string) {
  const months = monthsOf(from, to).map(m => ({ key: m.key, sales: salesIn(db, yearBack(m.from), yearBack(m.to)) }));
  return { total: r2(months.reduce((s, m) => s + m.sales, 0)), months };
}

/**
 * Split a year's target into its months. Months typed by hand keep their figure;
 * the rest share what is left by last year's pattern (70%) and their days (30%).
 * Whole dollars; the last split month takes the rounding.
 */
export function splitYear(db: Pick<DB, "orders">, from: string, to: string, yearTarget: number, keep: TargetMonth[] = []): TargetMonth[] {
  const ms = monthsOf(from, to);
  const ly = lastYear(db, from, to);
  const totalDays = daysIn(from, to);
  const fixed = new Map(keep.filter(k => k.manual).map(k => [k.key, k.target]));
  const fixedSum = [...fixed.values()].reduce((s, v) => s + v, 0);
  const free = ms.filter(m => !fixed.has(m.key));
  const freeDays = free.reduce((s, m) => s + daysIn(m.from, m.to), 0) || totalDays;
  const freeLy = free.reduce((s, m) => s + (ly.months.find(x => x.key === m.key)?.sales ?? 0), 0);
  const left = Math.max(0, yearTarget - fixedSum);
  const out: TargetMonth[] = [];
  let given = 0;
  free.forEach((m, i) => {
    const dayShare = daysIn(m.from, m.to) / freeDays;
    const lyShare = freeLy > 0 ? (ly.months.find(x => x.key === m.key)?.sales ?? 0) / freeLy : dayShare;
    const w = 0.7 * lyShare + 0.3 * dayShare;
    const t = i === free.length - 1 ? Math.max(0, Math.round(left - given)) : Math.round(left * w);
    given += t;
    out.push({ ...m, target: t });
  });
  for (const m of ms) if (fixed.has(m.key)) out.push({ ...m, target: fixed.get(m.key)!, manual: true });
  return out.sort((a, b) => a.key.localeCompare(b.key));
}

/* ── Stored plans (admin-only: adminRecords, kind "salesTarget") ─────────── */
export function targetPlans(db: Pick<DB, "adminRecords">): TargetPlan[] {
  return (db.adminRecords ?? []).filter((r): r is TargetRecord => r.kind === "salesTarget").map(r => r.plan);
}
export function planFor(db: Pick<DB, "adminRecords">, from: string): TargetPlan | undefined {
  return targetPlans(db).find(p => p.from === from);
}

/* ── How it is going ────────────────────────────────────────────────────── */

export type Pace = "ahead" | "on" | "slight" | "behind" | "weak" | "none";
export const PACE_LABEL: Record<Pace, string> = {
  ahead: "Ahead of target", on: "On track", slight: "Slightly behind", behind: "Behind", weak: "Weak — needs action", none: "No target",
};
export function paceOf(ratio: number | null): Pace {
  if (ratio == null || !Number.isFinite(ratio)) return "none";
  if (ratio >= 1.1) return "ahead";
  if (ratio >= 1) return "on";
  if (ratio >= 0.9) return "slight";
  if (ratio >= 0.75) return "behind";
  return "weak";
}

export interface MonthRow extends TargetMonth {
  /** The target after the catch-up: what this month needs for the year to land. */
  catchUp: number;
  sales: number;
  booked: number;
  bookedCount: number;
  /** Sales ÷ the target that applies (the catch-up target for this month on, the original for past ones). */
  achieved: number | null;
  lastYear: number;
  state: "past" | "current" | "future";
  pace: Pace;
}

export interface Progress {
  plan: TargetPlan;
  today: string;
  /** The year: days in it, day number today, days left, as months and days. */
  year: { days: number; day: number; left: number; leftMD: { months: number; days: number }; sales: number; expected: number; pace: Pace; ratio: number | null; booked: number;
    /** What the year still needs, and its sales per day from here. */
    toGo: number; perDay: number; lastYearToDate: number };
  months: MonthRow[];
  /** This month, in detail (none before the year starts or after it ends). */
  current?: {
    row: MonthRow; daysGone: number; daysLeft: number; expected: number; ratio: number | null; gapToExpected: number;
    toGo: number; perDay: number; forecast: number | null; pipeline: { value: number; count: number };
    /** If this month ends at the forecast (or what is due to ship), what next month will need. */
    nextNeeds: { key: string; amount: number } | null;
  };
}

export function progress(db: Pick<DB, "orders" | "settings" | "adminRecords">, plan: TargetPlan, today = dayOf(new Date())): Progress {
  const months = [...plan.months].sort((a, b) => a.key.localeCompare(b.key));
  const curIdx = months.findIndex(m => m.from <= today && today <= m.to);
  const startIdx = curIdx >= 0 ? curIdx : months.findIndex(m => m.from > today);
  // Sales before this month began — the catch-up is fixed for the month from there.
  const curFrom = curIdx >= 0 ? months[curIdx].from : today;
  const before = today < plan.from ? 0 : salesIn(db, plan.from, addDays(curFrom, -1) < plan.from ? plan.from : addDays(curFrom, -1));
  const beforeSales = today < plan.from || curFrom <= plan.from ? 0 : before;
  const rest = startIdx >= 0 ? months.slice(startIdx) : [];
  const restTarget = rest.reduce((s, m) => s + m.target, 0);
  const needFromHere = Math.max(0, plan.yearTarget - beforeSales);
  const rows: MonthRow[] = months.map((m, i) => {
    const state: MonthRow["state"] = m.to < today ? "past" : m.from > today ? "future" : "current";
    const catchUp = state === "past" ? m.target : restTarget > 0 ? Math.round(needFromHere * (m.target / restTarget)) : m.target;
    const upTo = state === "current" ? today : m.to;
    const sales = state === "future" ? 0 : salesIn(db, m.from, upTo);
    const b = state === "future" ? { value: 0, count: 0 } : bookedIn(db, m.from, upTo);
    const applies = state === "past" ? m.target : catchUp;
    let pace: Pace = "none";
    if (state === "past") pace = paceOf(applies > 0 ? sales / applies : null);
    if (state === "current") {
      const exp = applies * (daysIn(m.from, today) / daysIn(m.from, m.to));
      pace = paceOf(exp > 0 ? sales / exp : null);
    }
    void i;
    return { ...m, catchUp, sales, booked: b.value, bookedCount: b.count, achieved: applies > 0 && state !== "future" ? sales / applies : null,
      lastYear: salesIn(db, yearBack(m.from), yearBack(m.to)), state, pace };
  });

  // The year.
  const days = daysIn(plan.from, plan.to);
  const inYear = today >= plan.from && today <= plan.to;
  const day = today < plan.from ? 0 : today > plan.to ? days : daysIn(plan.from, today);
  const ySales = today < plan.from ? 0 : salesIn(db, plan.from, today > plan.to ? plan.to : today);
  const yExpected = rows.reduce((s, r) => s + (r.state === "past" ? r.target : r.state === "current" ? r.target * (daysIn(r.from, today) / daysIn(r.from, r.to)) : 0), 0);
  const yRatio = yExpected > 0 ? ySales / yExpected : null;
  const left = Math.max(0, days - day);
  const toGo = Math.max(0, r2(plan.yearTarget - ySales));
  const lyToDate = today < plan.from ? 0 : salesIn(db, yearBack(plan.from), yearBack(today > plan.to ? plan.to : today));

  let current: Progress["current"];
  if (inYear && curIdx >= 0) {
    const row = rows[curIdx];
    const daysGone = daysIn(row.from, today);
    const daysAll = daysIn(row.from, row.to);
    const daysLeft = daysAll - daysGone + 1; // today counts
    const expected = row.catchUp * (daysGone / daysAll);
    const ratio = expected > 0 ? row.sales / expected : null;
    const mToGo = Math.max(0, r2(row.catchUp - row.sales));
    // The run rate: only once a few days have gone, or a slow first morning reads as a crash.
    const forecast = daysGone >= 3 ? r2(row.sales / daysGone * daysAll) : null;
    const pipeline = pipelineDue(db, row.to);
    const next = rows[curIdx + 1];
    let nextNeeds: { key: string; amount: number } | null = null;
    if (next) {
      const landing = Math.max(forecast ?? 0, row.sales + pipeline.value);
      const after = rows.slice(curIdx + 1);
      const afterTarget = after.reduce((s, m) => s + m.target, 0);
      const need = Math.max(0, plan.yearTarget - (beforeSales + landing));
      nextNeeds = { key: next.key, amount: afterTarget > 0 ? Math.round(need * (next.target / afterTarget)) : Math.round(need) };
    }
    current = { row, daysGone, daysLeft, expected: r2(expected), ratio, gapToExpected: r2(row.sales - expected), toGo: mToGo,
      perDay: daysLeft > 0 ? r2(mToGo / daysLeft) : mToGo, forecast, pipeline, nextNeeds };
  }

  return {
    plan, today, months: rows, current,
    year: { days, day, left, leftMD: monthsDays(today < plan.from ? plan.from : today, addDays(plan.to, 1)), sales: ySales, expected: r2(yExpected),
      pace: paceOf(yRatio), ratio: yRatio, booked: today < plan.from ? 0 : bookedIn(db, plan.from, today > plan.to ? plan.to : today).value,
      toGo, perDay: left + (inYear ? 1 : 0) > 0 ? r2(toGo / (left + (inYear ? 1 : 0))) : toGo, lastYearToDate: lyToDate },
  };
}

/* ── Why: what moved the sales, and which customers ─────────────────────── */

export interface Drivers {
  now: { sales: number; orders: number; avg: number | null };
  last: { sales: number; orders: number; avg: number | null };
  /** Customers who bought less this year so far than last year by now. */
  down: { id: string; name: string; now: number; last: number }[];
  /** Customers who bought last year and have not ordered for 60 days or more. */
  quiet: { id: string; name: string; days: number; lastYear: number }[];
  /** The customers this year's sales came from. */
  top: { id: string; name: string; sales: number }[];
}

export function drivers(db: Pick<DB, "orders" | "clients">, from: string, today: string): Drivers {
  const lyFrom = yearBack(from), lyTo = yearBack(today);
  const sold = (a: string, b: string) => soldIn(live(db), { from: a, to: b } as Period);
  const nowOs = today < from ? [] : sold(from, today), lastOs = sold(lyFrom, lyTo);
  const sum = (os: Order[]) => r2(os.reduce((s, o) => s + orderTotal(o), 0));
  const byClient = (os: Order[]) => { const m = new Map<string, number>(); for (const o of os) m.set(o.clientId, r2((m.get(o.clientId) ?? 0) + orderTotal(o))); return m; };
  const nowBy = byClient(nowOs), lastBy = byClient(lastOs);
  const name = (id: string) => db.clients.find(c => c.id === id)?.companyName ?? "Client";
  const down = [...lastBy].map(([id, last]) => ({ id, name: name(id), now: nowBy.get(id) ?? 0, last }))
    .filter(x => x.last - x.now >= 1).sort((a, b) => (b.last - b.now) - (a.last - a.now)).slice(0, 8);
  const lastOrder = new Map<string, string>();
  for (const o of live(db)) if (o.status !== "Rejected" && !o.forReadyStock) { const d = o.createdAt; if (!lastOrder.has(o.clientId) || d > lastOrder.get(o.clientId)!) lastOrder.set(o.clientId, d); }
  const twelveBack = yearBack(today);
  const lyAll = byClient(sold(twelveBack, today));
  const quiet = [...lastOrder].map(([id, d]) => ({ id, name: name(id), days: Math.floor((+new Date(`${today}T12:00:00`) - +new Date(d)) / 86_400_000), lastYear: lyAll.get(id) ?? 0 }))
    .filter(x => x.days >= 60 && x.lastYear > 0).sort((a, b) => b.lastYear - a.lastYear).slice(0, 8);
  const top = [...nowBy].map(([id, sales]) => ({ id, name: name(id), sales })).sort((a, b) => b.sales - a.sales).slice(0, 8);
  const now = { sales: sum(nowOs), orders: nowOs.length, avg: nowOs.length ? r2(sum(nowOs) / nowOs.length) : null };
  const last = { sales: sum(lastOs), orders: lastOs.length, avg: lastOs.length ? r2(sum(lastOs) / lastOs.length) : null };
  return { now, last, down, quiet, top };
}



