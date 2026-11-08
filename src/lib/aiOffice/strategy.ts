/**
 * The strategist — what a large company's strategy team works out, from this
 * business's own records, so the owner (and the agent) can see where growth
 * comes from and what to do this week. Read-only: nothing here writes.
 *
 *   growth plan    sales = active customers × orders per customer × average order,
 *                  the last 12 months against the 12 before — which lever moved,
 *                  and what each lever is worth in dollars.
 *   portfolio      every client placed by value and by THEIR OWN buying rhythm
 *                  (RFM adapted to B2B: recency is judged against how often that
 *                  client usually orders, not a fixed number of days):
 *                  Champions · Loyal · New · Promising · Need attention · At risk ·
 *                  Can't lose · Lost — each with its standard play.
 *   concentration  how much rests on a few clients (top 1 / 3 / 10 share).
 *   top moves      every finding turned into a step, ranked by the money it is
 *                  worth — the week's plan.
 *
 * Sales are dispatched sales, exactly as Reports → Profit & Loss (recognisedSale
 * at its sale date), in dollars as billed. A client's rhythm is the agent's own
 * (lib/aiOffice/pulse.ts).
 */
import { orderTotal, balanceDue, type DB, type Order } from "@/lib/db";
import { recognisedSale, saleDate } from "@/lib/orderCost";
import { clientPulse, type Pulse } from "./pulse";

const DAY = 86_400_000;
const r0 = (n: number) => Math.round(n);
const r1 = (n: number) => Math.round(n * 10) / 10;
const usd = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
const median = (xs: number[]) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b), m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

/* ── The window: the last 12 months and the 12 before ──────────────────── */
function windows(now: Date) {
  const t = +now;
  return { now: t, curFrom: t - 365 * DAY, prevFrom: t - 730 * DAY };
}
const soldAt = (o: Order) => +new Date(saleDate(o));
const sales = (db: Pick<DB, "orders">) => db.orders.filter(o => !o.deletedAt && recognisedSale(o) && !o.forReadyStock);

/* ── Growth plan ────────────────────────────────────────────────────────── */
export interface Levers { customers: number; ordersPerCustomer: number; avgOrder: number; sales: number }
export interface GrowthPlan {
  now: Levers; before: Levers;
  /** Each lever's change, % — and how much of the sales change it explains (shares add to 100). */
  change: { customers: number | null; ordersPerCustomer: number | null; avgOrder: number | null; sales: number | null };
  explains: { customers: number; ordersPerCustomer: number; avgOrder: number } | null;
  /** The weakest lever, in words. */
  weakest: "customers" | "ordersPerCustomer" | "avgOrder" | null;
  /** What each lever is worth, a year, at today's figures. */
  whatIf: { label: string; usd: number; how: string }[];
}

function leversOf(os: Order[]): Levers {
  const salesUsd = os.reduce((s, o) => s + orderTotal(o), 0);
  const customers = new Set(os.map(o => o.clientId)).size;
  return {
    customers, sales: r0(salesUsd),
    ordersPerCustomer: customers ? r1(os.length / customers) : 0,
    avgOrder: os.length ? r0(salesUsd / os.length) : 0,
  };
}
const pct = (a: number, b: number) => (b > 0 ? r1(((a - b) / b) * 100) : null);

export function growthPlan(db: Pick<DB, "orders" | "clients">, portfolio: PortfolioRow[], now = new Date()): GrowthPlan {
  const w = windows(now);
  const all = sales(db);
  const cur = all.filter(o => soldAt(o) > w.curFrom && soldAt(o) <= w.now);
  const prev = all.filter(o => soldAt(o) > w.prevFrom && soldAt(o) <= w.curFrom);
  const n = leversOf(cur), b = leversOf(prev);
  const change = { customers: pct(n.customers, b.customers), ordersPerCustomer: pct(n.ordersPerCustomer, b.ordersPerCustomer), avgOrder: pct(n.avgOrder, b.avgOrder), sales: pct(n.sales, b.sales) };
  // Log shares: sales = C × F × A, so ln(S1/S0) = ln(C1/C0) + ln(F1/F0) + ln(A1/A0).
  let explains: GrowthPlan["explains"] = null;
  if (b.customers && b.ordersPerCustomer && b.avgOrder && n.customers && n.ordersPerCustomer && n.avgOrder) {
    const lc = Math.log(n.customers / b.customers), lf = Math.log(n.ordersPerCustomer / b.ordersPerCustomer), la = Math.log(n.avgOrder / b.avgOrder);
    const tot = Math.abs(lc) + Math.abs(lf) + Math.abs(la);
    if (tot > 0.0001) explains = { customers: r0((lc / tot) * 100), ordersPerCustomer: r0((lf / tot) * 100), avgOrder: r0((la / tot) * 100) };
  }
  const ch = [["customers", change.customers], ["ordersPerCustomer", change.ordersPerCustomer], ["avgOrder", change.avgOrder]] as const;
  const known = ch.filter(([, v]) => v != null) as unknown as [GrowthPlan["weakest"], number][];
  const weakest = known.length ? known.sort((a, b2) => a[1] - b2[1])[0][0] : null;

  // What each lever is worth, a year.
  const whatIf: GrowthPlan["whatIf"] = [];
  const loyal = portfolio.filter(p => p.segment === "champion" || p.segment === "loyal");
  if (loyal.length) {
    const v = loyal.reduce((s, p) => s + (p.typicalOrder ?? 0), 0);
    if (v > 0) whatIf.push({ label: "One more order a year from each Champion and Loyal client", usd: r0(v), how: `${loyal.length} clients × their usual order` });
  }
  const back = portfolio.filter(p => p.segment === "atRisk" || p.segment === "cantLose");
  if (back.length) {
    const v = back.reduce((s, p) => s + p.yearBefore, 0) * 0.5;
    if (v > 0) whatIf.push({ label: "Win back half of what At-risk and Can't-lose clients used to buy", usd: r0(v), how: `${back.length} clients, half their previous year's buying` });
  }
  if (n.sales > 0) whatIf.push({ label: "Average order 10% bigger (sets, heavier pieces, add-ons)", usd: r0(n.sales * 0.1), how: `10% of ${usd(n.sales)}` });
  const newOnes = portfolio.filter(p => p.firstOrderDays != null && p.firstOrderDays <= 365);
  const newValue = newOnes.length ? newOnes.reduce((s, p) => s + p.sales12, 0) / newOnes.length : n.customers ? n.sales / n.customers : 0;
  if (newValue > 0) whatIf.push({ label: "Two new clients a month at what a new client buys in a year", usd: r0(newValue * 24), how: `24 × ${usd(newValue)}` });
  whatIf.sort((a, c) => c.usd - a.usd);
  return { now: n, before: b, change, explains, weakest, whatIf };
}

/* ── Customer portfolio ─────────────────────────────────────────────────── */
export type Segment = "champion" | "loyal" | "new" | "promising" | "attention" | "atRisk" | "cantLose" | "lost";
export const SEGMENT: Record<Segment, { label: string; meaning: string; play: string; tone: "green" | "blue" | "amber" | "red" | "neutral" }> = {
  champion: { label: "Champions", meaning: "Your best: high value, buying on rhythm", play: "Treat as VIP — first look at every new collection, priority in production, ask for referrals", tone: "green" },
  loyal: { label: "Loyal", meaning: "Order regularly, mid value", play: "Grow the order: offer sets, heavier pieces, matching items", tone: "green" },
  new: { label: "New", meaning: "First order in the last 90 days", play: "Win the second order within 60 days — follow up, send designs like their first", tone: "blue" },
  promising: { label: "Promising", meaning: "One or two orders this year, still recent", play: "Nurture: regular new designs, a small first-repeat offer", tone: "blue" },
  attention: { label: "Need attention", meaning: "Due or a little late against their own rhythm", play: "Send new designs now, before they buy elsewhere", tone: "amber" },
  atRisk: { label: "At risk", meaning: "Well past their usual gap, or slipping (smaller orders, paying slower)", play: "Call the owner: ask why, show what's new, make an offer", tone: "red" },
  cantLose: { label: "Can't lose", meaning: "High value, but gone quiet", play: "The owner calls or visits this week — this is where the money is", tone: "red" },
  lost: { label: "Lost", meaning: "No order for a year or more", play: "One win-back offer; if no answer, let go and spend the time on others", tone: "neutral" },
};

export interface PortfolioRow {
  id: string; name: string; segment: Segment;
  /** Dispatched sales: last 12 months, the 12 before, all time. */
  sales12: number; yearBefore: number; lifetime: number;
  orders12: number;
  typicalOrder: number | null;
  daysSinceLast: number | null; usualGap: number | null; daysPastDue: number | null;
  firstOrderDays: number | null;
  risk: number; reasons: string[]; nextStep: string;
  owed: number;
}

export function portfolio(db: Pick<DB, "orders" | "clients" | "invoices">, now = new Date()): PortfolioRow[] {
  const w = windows(now);
  const all = sales(db);
  const rows: PortfolioRow[] = [];
  for (const c of db.clients) {
    if (c.status === "inactive") continue;
    const mine = db.orders.filter(o => o.clientId === c.id && !o.deletedAt && !o.forReadyStock && o.status !== "Rejected");
    if (!mine.length) continue;
    const p: Pulse | null = clientPulse(db as DB, c.id, now);
    const sold = all.filter(o => o.clientId === c.id);
    const s12 = sold.filter(o => soldAt(o) > w.curFrom).reduce((s, o) => s + orderTotal(o), 0);
    const s24 = sold.filter(o => soldAt(o) > w.prevFrom && soldAt(o) <= w.curFrom).reduce((s, o) => s + orderTotal(o), 0);
    const life = sold.reduce((s, o) => s + orderTotal(o), 0);
    const o12 = mine.filter(o => +new Date(o.createdAt) > w.curFrom).length;
    const first = Math.min(...mine.map(o => +new Date(o.createdAt)).filter(Number.isFinite));
    const owed = mine.filter(o => recognisedSale(o)).reduce((s, o) => s + balanceDue(o), 0);
    rows.push({
      id: c.id, name: c.companyName || c.ownerName || "Client", segment: "attention",
      sales12: r0(s12), yearBefore: r0(s24), lifetime: r0(life), orders12: o12,
      typicalOrder: p?.usual.typicalUsd ?? (median(mine.map(orderTotal).filter(v => v > 0)) ?? null),
      daysSinceLast: p?.daysSinceLast ?? null, usualGap: p?.usualGapDays ?? null, daysPastDue: p?.daysPastDue ?? null,
      firstOrderDays: Number.isFinite(first) ? Math.floor((w.now - first) / DAY) : null,
      risk: p?.risk ?? 0, reasons: p?.reasons ?? [], nextStep: p?.nextStep ?? "", owed: r0(owed),
    });
  }
  // Value ranks: the top fifth by the last two years' buying are the high-value clients.
  const byValue = [...rows].sort((a, b) => (b.sales12 + b.yearBefore) - (a.sales12 + a.yearBefore));
  const topCut = Math.max(1, Math.ceil(byValue.length / 5));
  const high = new Set(byValue.slice(0, topCut).filter(r => r.sales12 + r.yearBefore > 0).map(r => r.id));
  for (const r of rows) {
    const gap = r.usualGap ?? 60;
    const late = r.daysPastDue != null ? r.daysPastDue : r.daysSinceLast != null ? r.daysSinceLast - gap : 0;
    const quiet = r.daysSinceLast ?? 0;
    r.segment =
      quiet >= 365 ? (high.has(r.id) ? "cantLose" : "lost")
      : high.has(r.id) && (late > Math.max(30, gap * 0.5) || r.risk >= 45) ? "cantLose"
      : r.risk >= 45 || late > Math.max(30, gap) ? "atRisk"
      : r.firstOrderDays != null && r.firstOrderDays <= 90 ? "new"
      : high.has(r.id) && r.orders12 >= 3 ? "champion"
      : r.orders12 >= 3 ? "loyal"
      : r.orders12 >= 1 && quiet <= 90 ? "promising"
      : "attention";
  }
  return rows.sort((a, b) => b.sales12 + b.yearBefore - (a.sales12 + a.yearBefore));
}

/* ── Concentration ──────────────────────────────────────────────────────── */
export function concentration(rows: PortfolioRow[]) {
  const total = rows.reduce((s, r) => s + r.sales12, 0);
  const sorted = [...rows].sort((a, b) => b.sales12 - a.sales12);
  const share = (n: number) => (total > 0 ? r1((sorted.slice(0, n).reduce((s, r) => s + r.sales12, 0) / total) * 100) : 0);
  // 80/20: how many clients make 80% of sales.
  let acc = 0, n80 = 0;
  for (const r of sorted) { if (acc >= total * 0.8) break; acc += r.sales12; n80++; }
  return { total, top1: share(1), top3: share(3), top10: share(10), biggest: sorted[0]?.name ?? null, clientsFor80: total > 0 ? n80 : 0, buying: sorted.filter(r => r.sales12 > 0).length };
}

/* ── Top moves: everything ranked by what it is worth ──────────────────── */
export interface Move {
  key: string;
  title: string;
  why: string;
  /** What it is worth, roughly, in dollars (a year's buying at stake, money to collect, a lever's value). */
  usd: number;
  kind: "keep" | "winback" | "grow" | "collect" | "risk" | "lever";
  clientId?: string; clientName?: string;
  priority: "high" | "medium" | "low";
  dueInDays: number;
}

export function topMoves(db: Pick<DB, "orders" | "clients" | "invoices">, now = new Date()): { moves: Move[]; portfolio: PortfolioRow[]; growth: GrowthPlan; concentration: ReturnType<typeof concentration> } {
  const pf = portfolio(db, now);
  const growth = growthPlan(db, pf, now);
  const conc = concentration(pf);
  const moves: Move[] = [];
  for (const r of pf) {
    const yearValue = Math.max(r.sales12, r.yearBefore);
    if (r.segment === "cantLose") moves.push({ key: `cl-${r.id}`, kind: "keep", clientId: r.id, clientName: r.name, priority: "high", dueInDays: 2, usd: yearValue,
      title: `Owner to call ${r.name} this week`, why: `${SEGMENT.cantLose.meaning}: ${usd(yearValue)} a year at stake${r.reasons[0] ? ` — ${r.reasons[0]}` : ""}` });
    else if (r.segment === "atRisk") moves.push({ key: `ar-${r.id}`, kind: "winback", clientId: r.id, clientName: r.name, priority: yearValue > 0 ? "high" : "medium", dueInDays: 3, usd: yearValue * 0.5,
      title: r.nextStep || `Call ${r.name} — find out why orders slowed`, why: `At risk: ${r.reasons.slice(0, 2).join("; ") || "well past their usual gap"} — ${usd(yearValue)} a year` });
    else if (r.segment === "attention" && r.typicalOrder) moves.push({ key: `at-${r.id}`, kind: "grow", clientId: r.id, clientName: r.name, priority: "medium", dueInDays: 5, usd: r.typicalOrder,
      title: r.nextStep || `Send ${r.name} new designs now`, why: `Next order due${r.daysPastDue != null && r.daysPastDue > 0 ? ` — ${r.daysPastDue} days past their usual gap` : ""}; their usual order ${usd(r.typicalOrder)}` });
    else if (r.segment === "new" && r.typicalOrder) moves.push({ key: `nw-${r.id}`, kind: "grow", clientId: r.id, clientName: r.name, priority: "medium", dueInDays: 7, usd: r.typicalOrder,
      title: `Win ${r.name}'s second order`, why: `New client — the second order within 60 days decides whether they stay; first order ${usd(r.typicalOrder)}` });
    if (r.owed > 0 && r.reasons.some(x => /unpaid for over 60 days/.test(x))) moves.push({ key: `co-${r.id}`, kind: "collect", clientId: r.id, clientName: r.name, priority: "high", dueInDays: 2, usd: r.owed,
      title: `Collect from ${r.name}`, why: `${usd(r.owed)} owed — part of it over 60 days` });
  }
  if (conc.top3 >= 50) moves.push({ key: "conc", kind: "risk", priority: "medium", dueInDays: 14, usd: r0(conc.total * 0.1),
    title: "Spread the risk: grow clients beyond the top 3", why: `The top 3 clients are ${conc.top3}% of sales (the biggest, ${conc.biggest}, ${conc.top1}%) — losing one would hurt; aim new-client and Loyal growth at bringing it under 50%` });
  const lever = growth.whatIf[0];
  if (lever) moves.push({ key: "lever", kind: "lever", priority: "medium", dueInDays: 14, usd: lever.usd, title: lever.label, why: `Worth about ${usd(lever.usd)} a year (${lever.how})` });
  moves.sort((a, b) => b.usd - a.usd);
  return { moves, portfolio: pf, growth, concentration: conc };
}

/** Questions the strategist can be asked — each sent to the agent with the facts above. */
export const STRATEGY_QUESTIONS: { label: string; q: string }[] = [
  { label: "90-day growth plan", q: "Make me a 90-day growth plan from the growth_strategy facts: the 3 biggest moves, who does what each week, and the numbers to watch." },
  { label: "Why are sales up or down?", q: "Using growth_strategy, explain what drove sales over the last 12 months against the 12 before — customers, orders per customer or order size — and what to fix first." },
  { label: "Which clients to focus on", q: "Using growth_strategy, which clients should we focus on this month and what should we say to each? Start with Can't lose and At risk." },
  { label: "Reduce dependence on big clients", q: "Using growth_strategy's concentration figures, how risky is our client concentration and how do we reduce it over the next 6 months?" },
  { label: "Hit this year's target", q: "Using growth_strategy and our sales target, what exactly do we need to do each month to reach the target?" },
];
