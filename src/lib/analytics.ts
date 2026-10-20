import { companyOf } from "@/lib/companies";
import { orderTotal, balanceDue, toPureGold, pureFromPurity, type DB, type Order, type MaterialIssuance } from "./db";
import { recognisedSale, saleDate, profitReport, inrOn } from "./orderCost";
import { supplierAccount, factoryAccount } from "./manufacturing";

/**
 * The numbers behind the Reports page — worked out from the records the rest
 * of the app keeps, never stored, so they are always as current as the data.
 *
 * The rules, so every tab tells the same story:
 *   • A sale is a client order with a price that has been dispatched; it
 *     belongs to the day it left (the same rule as the profit report).
 *   • An order is "received" on the day it was placed; rejected ones are
 *     counted apart and nowhere else.
 *   • Money collected is what came in on receipts in the period — plus, for
 *     older payments entered before receipts existed, the payment itself.
 *     Credit moved from one bill to another is not new money.
 *   • Owed to us is what is still unpaid on shipped work, aged from the day
 *     it left. Owed by us is what suppliers and factories are still due.
 */

export interface Period { from: string; to: string } // yyyy-mm-dd; "" = open-ended

const pad = (n: number) => String(n).padStart(2, "0");
/** The local calendar day of a timestamp. */
export function localDay(iso: string): string {
  const d = new Date(iso);
  if (isNaN(+d)) return "";
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
const dayStr = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const monthKey = (iso: string) => localDay(iso).slice(0, 7);

export function inPeriod(p: Period, iso: string | undefined): boolean {
  if (!iso) return false;
  const k = localDay(iso);
  if (!k) return false;
  if (p.from && k < p.from) return false;
  if (p.to && k > p.to) return false;
  return true;
}

export type PresetKey =
  | "today" | "yesterday" | "thisWeek" | "lastWeek" | "last7" | "last30"
  | "thisMonth" | "lastMonth" | "thisQuarter" | "lastQuarter" | "thisFY" | "lastFY" | "thisYear" | "last12" | "all";
export const PRESETS: { key: PresetKey; label: string }[] = [
  { key: "today", label: "Today" },
  { key: "yesterday", label: "Yesterday" },
  { key: "thisWeek", label: "This week" },
  { key: "lastWeek", label: "Last week" },
  { key: "last7", label: "Last 7 days" },
  { key: "last30", label: "Last 30 days" },
  { key: "thisMonth", label: "This month" },
  { key: "lastMonth", label: "Last month" },
  { key: "thisQuarter", label: "This quarter" },
  { key: "lastQuarter", label: "Last quarter" },
  { key: "thisFY", label: "This FY" },
  { key: "lastFY", label: "Last FY" },
  { key: "thisYear", label: "This calendar year" },
  { key: "last12", label: "Last 12 months" },
  { key: "all", label: "All time" },
];

/** A preset as a date range. The financial year is India's: 1 April – 31 March. */
export function presetPeriod(key: PresetKey, now = new Date()): Period {
  const y = now.getFullYear(), m = now.getMonth();
  const range = (a: Date, b: Date) => ({ from: dayStr(a), to: dayStr(b) });
  const d = now.getDate();
  // Weeks run Monday to Sunday.
  const monday = new Date(y, m, d - ((now.getDay() + 6) % 7));
  switch (key) {
    case "today": return range(new Date(y, m, d), new Date(y, m, d));
    case "yesterday": return range(new Date(y, m, d - 1), new Date(y, m, d - 1));
    case "thisWeek": return range(monday, new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 6));
    case "lastWeek": return range(new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() - 7), new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() - 1));
    case "last7": return range(new Date(y, m, d - 6), new Date(y, m, d));
    case "last30": return range(new Date(y, m, d - 29), new Date(y, m, d));
    case "thisYear": return range(new Date(y, 0, 1), new Date(y, 11, 31));
    case "thisMonth": return range(new Date(y, m, 1), new Date(y, m + 1, 0));
    case "lastMonth": return range(new Date(y, m - 1, 1), new Date(y, m, 0));
    case "thisQuarter": { const q = Math.floor(m / 3) * 3; return range(new Date(y, q, 1), new Date(y, q + 3, 0)); }
    case "lastQuarter": { const q = Math.floor(m / 3) * 3 - 3; return range(new Date(y, q, 1), new Date(y, q + 3, 0)); }
    case "thisFY": { const fy = m >= 3 ? y : y - 1; return range(new Date(fy, 3, 1), new Date(fy + 1, 2, 31)); }
    case "lastFY": { const fy = (m >= 3 ? y : y - 1) - 1; return range(new Date(fy, 3, 1), new Date(fy + 1, 2, 31)); }
    case "last12": return range(new Date(y, m - 11, 1), new Date(y, m + 1, 0));
    default: return { from: "", to: "" };
  }
}

/** Which preset a range is, if any — so the matching button shows as chosen. */
export function presetOf(p: Period, now = new Date()): PresetKey | null {
  for (const { key } of PRESETS) {
    const q = presetPeriod(key, now);
    if (q.from === p.from && q.to === p.to) return key;
  }
  return null;
}

/** The same length of time just before — what "vs previous" compares with. Null for an open range. */
export function previousPeriod(p: Period): Period | null {
  if (!p.from || !p.to) return null;
  const a = new Date(p.from + "T00:00:00"), b = new Date(p.to + "T00:00:00");
  const days = Math.round((+b - +a) / 86_400_000) + 1;
  // A whole calendar month compares with the whole month before it.
  if (a.getDate() === 1 && new Date(b.getFullYear(), b.getMonth(), b.getDate() + 1).getDate() === 1) {
    const months = (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth()) + 1;
    return { from: dayStr(new Date(a.getFullYear(), a.getMonth() - months, 1)), to: dayStr(new Date(a.getFullYear(), a.getMonth(), 0)) };
  }
  return { from: dayStr(new Date(a.getFullYear(), a.getMonth(), a.getDate() - days)), to: dayStr(new Date(a.getFullYear(), a.getMonth(), a.getDate() - 1)) };
}

export function periodLabel(p: Period): string {
  const f = (s: string) => new Date(s + "T00:00:00").toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }).replace(/\bSept\b/, "Sep");
  if (!p.from && !p.to) return "All time";
  if (p.from && p.to) return `${f(p.from)} – ${f(p.to)}`;
  return p.from ? `From ${f(p.from)}` : `Up to ${f(p.to)}`;
}

/** The months a period spans, oldest first — open ends run to the first order and to now. Capped at 36. */
export function monthsOf(p: Period, orders: Order[], now = new Date()): string[] {
  const first = p.from || (orders.length ? localDay(orders.reduce((m, o) => (o.createdAt < m ? o.createdAt : m), orders[0].createdAt)) : dayStr(now));
  const last = p.to && p.to < dayStr(now) ? p.to : dayStr(now);
  const out: string[] = [];
  let y = +first.slice(0, 4), m = +first.slice(5, 7) - 1;
  const ly = +last.slice(0, 4), lm = +last.slice(5, 7) - 1;
  while ((y < ly || (y === ly && m <= lm)) && out.length < 400) {
    out.push(`${y}-${pad(m + 1)}`);
    m++; if (m > 11) { m = 0; y++; }
  }
  return out.slice(-36);
}

export function monthLabel(key: string): string {
  const [y, m] = key.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("en-IN", { month: "short", year: "2-digit" }).replace(/\bSept\b/, "Sep");
}

const r2 = (n: number) => Math.round(n * 100) / 100;
export const pctChange = (now: number, before: number): number | null =>
  before === 0 ? (now === 0 ? 0 : null) : Math.round(((now - before) / Math.abs(before)) * 1000) / 10;

/** Orders sold (dispatched) in the period. */
export function soldIn(orders: Order[], p: Period): Order[] {
  return orders.filter(o => recognisedSale(o) && inPeriod(p, saleDate(o)));
}
/** Client orders placed in the period (rejected ones included — callers split them). */
export function receivedIn(orders: Order[], p: Period): Order[] {
  return orders.filter(o => !o.forReadyStock && inPeriod(p, o.createdAt));
}

/** Money that came in from clients in the period, in dollars. */
export function collectionsIn(db: DB, p: Period, clientIds?: Set<string>, recordedBy?: string): number {
  let usd = 0;
  for (const r of db.clientReceipts ?? []) {
    if (clientIds && !clientIds.has(r.clientId)) continue;
    if (recordedBy && r.recordedBy !== recordedBy) continue;
    if (inPeriod(p, r.date || r.createdAt)) usd += r.amountUsd || 0;
  }
  // Older payments taken on an order before receipts existed.
  for (const o of db.orders) {
    if (clientIds && !clientIds.has(o.clientId)) continue;
    for (const a of o.advances ?? []) {
      if (a.receiptId || a.fromCredit) continue;
      if (recordedBy && a.recordedBy !== recordedBy) continue;
      if (inPeriod(p, a.createdAt)) usd += a.amount || 0;
    }
  }
  return r2(usd);
}

export interface Ageing { current: number; d30: number; d60: number; d90: number; total: number }
/** What is still owed on shipped work, by how long since it left. "as of" defaults to today. */
export function receivables(orders: Order[], asOf = new Date()): Ageing {
  const a: Ageing = { current: 0, d30: 0, d60: 0, d90: 0, total: 0 };
  for (const o of orders) {
    if (!recognisedSale(o)) continue;
    const due = balanceDue(o);
    if (due <= 0.009) continue;
    const days = Math.floor((+asOf - +new Date(saleDate(o))) / 86_400_000);
    if (days <= 30) a.current += due; else if (days <= 60) a.d30 += due; else if (days <= 90) a.d60 += due; else a.d90 += due;
    a.total += due;
  }
  return { current: r2(a.current), d30: r2(a.d30), d60: r2(a.d60), d90: r2(a.d90), total: r2(a.total) };
}

/**
 * What suppliers and factories are still owed, in rupees — each account worked
 * out exactly as its own page does (bills, payments, advances, opening
 * balances), and only the accounts where we owe money added up.
 */
export function payables(db: DB): { suppliersInr: number; factoriesInr: number } {
  let suppliersInr = 0, factoriesInr = 0;
  for (const s of db.suppliers ?? []) {
    const a = supplierAccount(
      (db.purchases ?? []).filter(p => p.supplierId === s.id),
      (db.supplierReceipts ?? []).filter(r => r.supplierId === s.id),
      s,
      (db.supplierPayments ?? []).filter(x => x.supplierId === s.id),
    );
    suppliersInr += Math.max(0, a.net);
  }
  for (const f of db.factories ?? []) {
    const a = factoryAccount(
      (db.materialIssuances ?? []).filter(i => i.factoryId === f.id),
      f,
      (db.factoryPayments ?? []).filter(x => x.factoryId === f.id),
    );
    factoriesInr += Math.max(0, a.chargesPending);
  }
  return { suppliersInr: r2(suppliersInr), factoriesInr: r2(factoriesInr) };
}

/** Days from placing to dispatch, for orders that have left. */
export function cycleDays(o: Order): number | null {
  const sd = saleDate(o);
  if (!recognisedSale(o) || !sd) return null;
  return Math.max(0, Math.round((+new Date(sd) - +new Date(o.createdAt)) / 86_400_000));
}
export function onTime(o: Order): boolean | null {
  if (!recognisedSale(o) || !o.expectedDelivery) return null;
  return localDay(saleDate(o)) <= o.expectedDelivery.slice(0, 10);
}
const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b), mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : Math.round(((s[mid - 1] + s[mid]) / 2) * 10) / 10;
};
const mean = (xs: number[]) => (xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10 : null);

export interface Kpis {
  salesUsd: number; soldCount: number; avgOrderUsd: number | null;
  receivedCount: number; receivedUsd: number; rejectedCount: number;
  collectedUsd: number;
  /** Admin figures — null when not asked for, or not convertible. */
  costUsd: number | null; profitUsd: number | null; marginPct: number | null; incomplete: number;
  /** The same in rupees (each sale at its own day's rate, cost as paid) — admin only. */
  salesInr: number | null; costInr: number | null; profitInr: number | null;
  avgCycleDays: number | null; medianCycleDays: number | null; onTimePct: number | null;
}

export function kpis(db: DB, orders: Order[], p: Period, withProfit: boolean, clientIds?: Set<string>): Kpis {
  const sold = soldIn(orders, p);
  const salesUsd = r2(sold.reduce((s, o) => s + orderTotal(o), 0));
  const rec = receivedIn(orders, p);
  const live = rec.filter(o => o.status !== "Rejected");
  const pr = withProfit && sold.length ? profitReport(db, sold).totals : null;
  const cycles = sold.map(cycleDays).filter((x): x is number => x !== null);
  const ot = sold.map(onTime).filter((x): x is boolean => x !== null);
  return {
    salesUsd, soldCount: sold.length, avgOrderUsd: sold.length ? r2(salesUsd / sold.length) : null,
    receivedCount: live.length, receivedUsd: r2(live.reduce((s, o) => s + orderTotal(o), 0)), rejectedCount: rec.length - live.length,
    collectedUsd: collectionsIn(db, p, clientIds),
    costUsd: pr?.costUsd ?? null, profitUsd: pr?.profitUsd ?? null, marginPct: pr?.marginPct ?? null, incomplete: pr?.incomplete ?? 0,
    salesInr: pr?.sellingInr ?? null, costInr: pr ? pr.costInr : null, profitInr: pr?.profitInr ?? null,
    avgCycleDays: mean(cycles), medianCycleDays: median(cycles),
    onTimePct: ot.length ? Math.round((ot.filter(Boolean).length / ot.length) * 1000) / 10 : null,
  };
}

export interface MonthRow {
  month: string; label: string;
  salesUsd: number; soldCount: number; receivedCount: number; receivedUsd: number; collectedUsd: number;
  costUsd: number | null; profitUsd: number | null; marginPct: number | null;
  salesInr: number | null; costInr: number | null; profitInr: number | null;
}

/** Month by month across the period: sales, orders in, cash in — and, for the admin, cost and profit. */
export function monthly(db: DB, orders: Order[], p: Period, withProfit: boolean, clientIds?: Set<string>): MonthRow[] {
  return monthsOf(p, orders).map(month => {
    const [y, m] = month.split("-").map(Number);
    const mp: Period = { from: `${month}-01`, to: dayStr(new Date(y, m, 0)) };
    // Clip the month to the period, so a range starting mid-month adds up.
    const clip: Period = { from: p.from && p.from > mp.from ? p.from : mp.from, to: p.to && p.to < mp.to ? p.to : mp.to };
    const k = kpis(db, orders, clip, withProfit, clientIds);
    return {
      month, label: monthLabel(month),
      salesUsd: k.salesUsd, soldCount: k.soldCount, receivedCount: k.receivedCount, receivedUsd: k.receivedUsd,
      collectedUsd: k.collectedUsd, costUsd: k.costUsd, profitUsd: k.profitUsd, marginPct: k.marginPct,
      salesInr: k.salesInr, costInr: k.costInr, profitInr: k.profitInr,
    };
  });
}

export interface Slice { key: string; value: number; count: number }
/** Sales in the period split by something about the order — item, metal, client. */
export function salesBy(orders: Order[], p: Period, keyOf: (o: Order) => string): Slice[] {
  const m = new Map<string, Slice>();
  for (const o of soldIn(orders, p)) {
    const k = keyOf(o) || "—";
    const s = m.get(k) ?? { key: k, value: 0, count: 0 };
    s.value += orderTotal(o); s.count++;
    m.set(k, s);
  }
  return [...m.values()].map(s => ({ ...s, value: r2(s.value) })).sort((a, b) => b.value - a.value);
}

/** Orders still being worked on, by where they are. */
export function pipeline(orders: Order[]): Slice[] {
  const order = ["Waiting", "Approved", "In Production", "Ready", "Dispatched"];
  const m = new Map(order.map(k => [k, { key: k, value: 0, count: 0 }]));
  for (const o of orders) {
    if (o.forReadyStock) continue;
    const s = m.get(o.status);
    if (!s) continue;
    s.count++; s.value += orderTotal(o);
  }
  return [...m.values()].map(s => ({ ...s, value: r2(s.value) }));
}

/** Open orders past the date they were promised. */
export function lateOpen(orders: Order[], today = dayStr(new Date())): Order[] {
  return orders
    .filter(o => !o.forReadyStock && !["Dispatched", "Delivered", "Rejected"].includes(o.status) && o.expectedDelivery && o.expectedDelivery.slice(0, 10) < today)
    .sort((a, b) => a.expectedDelivery.localeCompare(b.expectedDelivery));
}

export interface ClientRow {
  id: string; name: string;
  received: number; sold: number; salesUsd: number;
  profitUsd: number | null; marginPct: number | null;
  profitInr: number | null;
  collectedUsd: number; outstandingUsd: number; overdue90Usd: number;
  avgOrderUsd: number | null; lastOrder: string | null; daysSinceLast: number | null;
}

export function clientTable(db: DB, orders: Order[], p: Period, withProfit: boolean, now = new Date()): ClientRow[] {
  return db.clients.map(c => {
    const mine = orders.filter(o => o.clientId === c.id);
    const sold = soldIn(mine, p);
    const salesUsd = r2(sold.reduce((s, o) => s + orderTotal(o), 0));
    const pr = withProfit && sold.length ? profitReport(db, sold).totals : null;
    const age = receivables(mine, now);
    const last = mine.filter(o => o.status !== "Rejected").reduce<string | null>((m, o) => (!m || o.createdAt > m ? o.createdAt : m), null);
    return {
      id: c.id, name: c.companyName,
      received: receivedIn(mine, p).filter(o => o.status !== "Rejected").length,
      sold: sold.length, salesUsd,
      profitUsd: pr?.profitUsd ?? null, marginPct: pr?.marginPct ?? null, profitInr: pr?.profitInr ?? null,
      collectedUsd: collectionsIn(db, p, new Set([c.id])),
      outstandingUsd: age.total, overdue90Usd: age.d90,
      avgOrderUsd: sold.length ? r2(salesUsd / sold.length) : null,
      lastOrder: last, daysSinceLast: last ? Math.floor((+now - +new Date(last)) / 86_400_000) : null,
    };
  });
}

export interface TeamRow {
  id: string; name: string; role: string;
  clients: number; received: number; sold: number; salesUsd: number;
  profitUsd: number | null; profitInr: number | null; collectedUsd: number;
  expensesInr: number;
  /** Their expenses left out of expensesInr — in a currency with no rate on file. */
  expensesUncounted: number;
  tasksDone: number; tasksOpen: number;
  avgCycleDays: number | null; onTimePct: number | null; open: number;
}

/**
 * Each team member's work. An order is theirs when it is assigned to them or
 * belongs to a client they manage — the same rule that lets them move it.
 */
export function teamTable(db: DB, orders: Order[], p: Period, withProfit: boolean): TeamRow[] {
  const staff = db.users.filter(u => u.role === "employee" || u.role === "admin");
  return staff.map(u => {
    const managed = new Set(db.clients.filter(c => c.accountManagerId === u.id).map(c => c.id));
    const mine = orders.filter(o => o.assignedEmployeeId === u.id || managed.has(o.clientId));
    const sold = soldIn(mine, p);
    const pr = withProfit && sold.length ? profitReport(db, sold).totals : null;
    const cycles = sold.map(cycleDays).filter((x): x is number => x !== null);
    const ot = sold.map(onTime).filter((x): x is boolean => x !== null);
    let expensesInr = 0, expensesUncounted = 0;
    for (const e of db.expenses ?? []) {
      if (e.employeeId !== u.id || !inPeriod(p, e.createdAt)) continue;
      // In rupees at the rate on the day it was paid, whatever account it came
      // from. With no rate on file it is left out — never counted as rupees.
      const perUnit = inrOn(db, e.currency, e.createdAt);
      if (perUnit === undefined) { expensesUncounted++; continue; }
      expensesInr += e.amount * perUnit;
    }
    const tasks = (db.tasks ?? []).filter(t => t.assignedTo === u.id);
    return {
      id: u.id, name: u.name, role: u.role,
      clients: managed.size,
      received: receivedIn(mine, p).filter(o => o.status !== "Rejected").length,
      sold: sold.length, salesUsd: r2(sold.reduce((s, o) => s + orderTotal(o), 0)),
      profitUsd: pr?.profitUsd ?? null, profitInr: pr?.profitInr ?? null,
      collectedUsd: collectionsIn(db, p, undefined, u.id),
      expensesInr: r2(expensesInr), expensesUncounted,
      tasksDone: tasks.filter(t => t.completed && inPeriod(p, t.completedAt ?? t.createdAt)).length,
      tasksOpen: tasks.filter(t => !t.completed).length,
      avgCycleDays: mean(cycles), onTimePct: ot.length ? Math.round((ot.filter(Boolean).length / ot.length) * 1000) / 10 : null,
      open: mine.filter(o => !["Dispatched", "Delivered", "Rejected"].includes(o.status)).length,
    };
  });
}

export interface FactoryRow {
  id: string; name: string;
  pieces: number; fineGoldG: number; labourInr: number; labourPendingInr: number;
  openJobs: number; avgDays: number | null;
}

const fineOf = (mi: MaterialIssuance) => {
  const net = mi.finishedNetWeight ?? 0;
  return mi.finishedPurity != null ? pureFromPurity(net, mi.finishedPurity) : toPureGold(net, mi.finishedKarat || mi.purityOrQuality);
};

/** What each factory turned out in the period, the gold it used and what it charged. */
export function factoryTable(db: DB, p: Period, companyId?: string): FactoryRow[] {
  return db.factories.map(f => {
    // One company's work at the factory, when one is chosen.
    const iss = (db.materialIssuances ?? []).filter(i => i.factoryId === f.id && (!companyId || companyOf(i) === companyId));
    const finishes = iss.filter(i => i.material === "gold" && i.finishedNetWeight != null && inPeriod(p, i.finishedPieces?.[0]?.recordedAt ?? i.issuedAt));
    const orderIds = new Set(finishes.map(i => i.orderId).filter(Boolean) as string[]);
    const days: number[] = [];
    for (const id of orderIds) {
      const first = iss.filter(i => i.orderId === id).reduce<string | null>((m, i) => (!m || i.issuedAt < m ? i.issuedAt : m), null);
      const done = finishes.find(i => i.orderId === id);
      const at = done?.finishedPieces?.[0]?.recordedAt ?? done?.issuedAt;
      if (first && at) days.push(Math.max(0, Math.round((+new Date(at) - +new Date(first)) / 86_400_000)));
    }
    let labourInr = 0;
    for (const i of iss) {
      const charge = i.makingCharges?.amountInr ?? 0;
      if (charge > 0 && inPeriod(p, i.finishedPieces?.[0]?.recordedAt ?? i.issuedAt)) labourInr += charge;
    }
    // Owed today, the way the factory's own account reads it.
    const firstCo = !companyId || companyId === "main"; // the opening balance and advances are the first company's
    const labourPendingInr = Math.max(0, factoryAccount(iss, firstCo ? f : undefined, firstCo ? (db.factoryPayments ?? []).filter(x => x.factoryId === f.id) : []).chargesPending);
    const openOrders = new Set(iss.filter(i => i.status === "open" && i.orderId).map(i => i.orderId));
    return {
      id: f.id, name: f.name,
      pieces: orderIds.size,
      fineGoldG: Math.round(finishes.reduce((s, i) => s + fineOf(i), 0) * 1000) / 1000,
      labourInr: r2(labourInr), labourPendingInr: r2(labourPendingInr),
      openJobs: openOrders.size, avgDays: mean(days),
    };
  }).sort((a, b) => b.pieces - a.pieces || b.labourInr - a.labourInr);
}

/** Material bought, month by month, in rupees — gold, diamonds and everything else apart. */
export function purchasesMonthly(db: DB, p: Period, orders: Order[], companyId?: string): { month: string; label: string; goldInr: number; diamondInr: number; otherInr: number }[] {
  return monthsOf(p, orders).map(month => {
    let goldInr = 0, diamondInr = 0, otherInr = 0;
    for (const pu of db.purchases ?? []) {
      const at = pu.invoiceDate || pu.createdAt;
      if (monthKey(at) !== month || !inPeriod(p, at) || (companyId && companyOf(pu) !== companyId)) continue;
      if (pu.material === "gold") goldInr += pu.totalInr;
      else if (pu.material === "diamond") diamondInr += pu.totalInr;
      else otherInr += pu.totalInr; // platinum, gemstones, findings (Settings → Materials)
    }
    return { month, label: monthLabel(month), goldInr: r2(goldInr), diamondInr: r2(diamondInr), otherInr: r2(otherInr) };
  });
}
