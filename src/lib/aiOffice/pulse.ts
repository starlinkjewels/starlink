// Client Pulse: each client's own rhythm, read from their orders and payments —
// no AI. How often they order (their usual gap), what they usually buy (item,
// metal, karat, price), whether their orders are getting smaller, what they have
// stopped buying, how fast they pay; when their next order is due and what it is
// likely to be; how much at risk they are and why; and the next thing to do.
// B2B clients drift away slowly — longer gaps, smaller orders, a category dropped,
// slower payment — so each of those is measured against the client's OWN past,
// never against other clients.
import { balanceDue, orderTotal, type DB, type Order } from "@/lib/db";
import { recognisedSale, saleDate } from "@/lib/orderCost";

export interface Pulse {
  clientId: string;
  name: string;
  handlerId?: string;
  orders: number;
  lastOrder: string | null;
  usualGapDays: number | null;
  daysSinceLast: number | null;
  /** When the next order would come at their usual pace (yyyy-mm-dd), and how many days past it they are (negative: not yet due). */
  nextDue: string | null;
  daysPastDue: number | null;
  /** What they usually buy (last 12 months, else all). */
  usual: { item?: string; metal?: string; karat?: string; typicalUsd: number | null };
  /** Their last 3 orders' median value against the 3–8 before, %. */
  sizeChangePct: number | null;
  /** Items they bought 2+ times in the year before the last 6 months, and not since. */
  dropped: string[];
  /** Median days from shipping to fully paid: their last 3 paid orders, and the ones before. */
  payDaysRecent: number | null;
  payDaysBefore: number | null;
  owedUsd: number;
  overdue60Usd: number;
  /** 0 (steady) – 100 (slipping away), and the reasons, with figures. */
  risk: number;
  reasons: string[];
  /** The next step, as a task. */
  nextStep: string;
  stage: "new" | "steady" | "due" | "late" | "slipping" | "growing";
}

const DAY = 86_400_000;
const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b), m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const top = (xs: (string | undefined)[]) => {
  const m = new Map<string, number>();
  for (const x of xs) if (x && x.trim()) m.set(x.trim(), (m.get(x.trim()) ?? 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
};
const usd = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
const ymd = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** When an order was fully paid: the advance that cleared it (null when still owed or never paid). */
function paidAt(o: Order): number | null {
  if (balanceDue(o) > 0.009 || !(o.advances?.length)) return null;
  return Math.max(...o.advances.map(a => +new Date(a.createdAt)).filter(Number.isFinite));
}

export function clientPulse(db: DB, clientId: string, now = new Date()): Pulse | null {
  const c = db.clients.find(x => x.id === clientId);
  if (!c) return null;
  const t = +now;
  const mine = db.orders.filter(o => o.clientId === c.id && !o.deletedAt && !o.forReadyStock && o.status !== "Rejected")
    .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
  const name = c.companyName || c.ownerName || "Client";
  const at = (o: Order) => +new Date(o.createdAt);
  const gaps = mine.slice(1).map((o, i) => (at(o) - at(mine[i])) / DAY).filter(g => g >= 0);
  const usualGap = mine.length >= 3 ? Math.round(median(gaps)!) : null;
  const last = mine[mine.length - 1];
  const since = last ? Math.floor((t - at(last)) / DAY) : null;
  const nextDueMs = last && usualGap ? at(last) + usualGap * DAY : null;
  const pastDue = nextDueMs ? Math.floor((t - nextDueMs) / DAY) : null;

  const year = mine.filter(o => t - at(o) <= 365 * DAY);
  const basis = year.length >= 2 ? year : mine;
  const values = mine.map(orderTotal).filter(v => v > 0);
  const recent3 = median(values.slice(-3)), before = median(values.slice(-8, -3));
  const sizeChange = recent3 != null && before != null && before > 0 && values.length >= 5 ? Math.round(((recent3 - before) / before) * 100) : null;

  // Items dropped: bought twice or more in the 6–18 months ago window, none in the last 6 months — while still ordering.
  const win = mine.filter(o => t - at(o) > 182 * DAY && t - at(o) <= 547 * DAY);
  const last6 = mine.filter(o => t - at(o) <= 182 * DAY);
  const count = (list: Order[], k: string) => list.filter(o => o.jewelleryType === k).length;
  const dropped = last6.length ? [...new Set(win.map(o => o.jewelleryType))].filter(k => k && count(win, k) >= 2 && count(last6, k) === 0) : [];

  // Payment speed: days from shipping to fully paid.
  const paid = mine.filter(recognisedSale).map(o => { const p = paidAt(o); return p ? Math.max(0, Math.round((p - +new Date(saleDate(o))) / DAY)) : null; }).filter((x): x is number => x != null);
  const payRecent = median(paid.slice(-3)), payBefore = median(paid.slice(-8, -3));

  const owed = mine.filter(o => recognisedSale(o) && balanceDue(o) > 0.009);
  const owedUsd = owed.reduce((s, o) => s + balanceDue(o), 0);
  const overdue60 = owed.filter(o => t - +new Date(saleDate(o)) > 60 * DAY).reduce((s, o) => s + balanceDue(o), 0);

  // Risk: each sign of drifting, weighed, with its reason in figures.
  let risk = 0;
  const reasons: string[] = [];
  if (usualGap && pastDue != null && pastDue > 0) {
    const r = Math.min(40, Math.round((pastDue / Math.max(usualGap, 7)) * 25));
    risk += r;
    if (r >= 8) reasons.push(`${pastDue} days past their usual ${usualGap}-day gap (last order ${since} days ago)`);
  }
  if (sizeChange != null && sizeChange <= -25) { risk += Math.min(20, Math.round(-sizeChange / 3)); reasons.push(`orders getting smaller: last 3 median ${usd(recent3!)} vs ${usd(before!)} before (${sizeChange}%)`); }
  if (dropped.length) { risk += Math.min(15, dropped.length * 8); reasons.push(`stopped buying ${dropped.join(", ")} (none in 6 months)`); }
  if (payRecent != null && payBefore != null && payRecent > payBefore + 10) { risk += 10; reasons.push(`paying slower: ${payRecent} days lately vs ${payBefore} before`); }
  if (overdue60 > 0.009) { risk += 15; reasons.push(`${usd(overdue60)} unpaid for over 60 days`); }
  risk = Math.min(100, risk);

  const usual = { item: top(basis.map(o => o.jewelleryType)), metal: top(basis.map(o => o.metal)), karat: top(basis.map(o => o.productKarats)), typicalUsd: median(values.slice(-5)) };
  const growing = sizeChange != null && sizeChange >= 30 && (pastDue ?? 0) <= 0;
  const stage: Pulse["stage"] = mine.length < 3 ? "new" : risk >= 45 ? "slipping" : pastDue != null && pastDue > Math.max(7, (usualGap ?? 0) * 0.25) ? "late" : pastDue != null && pastDue >= -7 ? "due" : growing ? "growing" : "steady";
  const what = [usual.karat, usual.metal && !/gold/i.test(usual.metal) ? usual.metal : null, usual.item].filter(Boolean).join(" ") || "their usual pieces";
  const nextStep =
    overdue60 > 0.009 ? `Collect the ${usd(overdue60)} overdue from ${name} before taking a new order`
    : stage === "slipping" ? `Call ${name}: ask why orders slowed${dropped.length ? ` and show new ${dropped[0]} designs` : ""}; offer ${what} around ${usual.typicalUsd ? usd(usual.typicalUsd) : "their usual price"}`
    : stage === "late" ? `Send ${name} new ${what} designs — their next order is ${pastDue} days overdue`
    : stage === "due" ? `${name}'s next order is due${nextDueMs ? ` around ${ymd(nextDueMs)}` : ""} — share new ${what} designs now`
    : stage === "growing" ? `Give ${name} priority: orders up ${sizeChange}% — offer a new collection or better terms`
    : stage === "new" ? `Follow up with ${name} after their first order${mine.length ? "s" : ""}: ask for the next design`
    : `Keep ${name} warm: share new ${what} designs`;
  return {
    clientId: c.id, name, handlerId: c.accountManagerId, orders: mine.length, lastOrder: last?.createdAt ?? null,
    usualGapDays: usualGap, daysSinceLast: since, nextDue: nextDueMs ? ymd(nextDueMs) : null, daysPastDue: pastDue,
    usual: { ...usual, typicalUsd: usual.typicalUsd != null ? Math.round(usual.typicalUsd) : null }, sizeChangePct: sizeChange, dropped,
    payDaysRecent: payRecent, payDaysBefore: payBefore, owedUsd: Math.round(owedUsd * 100) / 100, overdue60Usd: Math.round(overdue60 * 100) / 100,
    risk, reasons, nextStep, stage,
  };
}

/** Every active client with orders, most at risk (then most overdue) first. */
export function allPulses(db: DB, now = new Date()): Pulse[] {
  return db.clients.filter(c => c.status !== "inactive")
    .map(c => clientPulse(db, c.id, now)).filter((p): p is Pulse => !!p && p.orders > 0)
    .sort((a, b) => b.risk - a.risk || (b.daysPastDue ?? -1e9) - (a.daysPastDue ?? -1e9));
}
