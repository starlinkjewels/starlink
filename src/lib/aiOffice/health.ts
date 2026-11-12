/**
 * The strategist, part two — the money machine behind the sales, as a large
 * company's finance and planning teams read it, from this business's own books.
 * Read-only: nothing here writes.
 *
 *   cash cycle      DSO (days to get paid) + DIO (days stock waits) − DPO (days we
 *                   take to pay) = the days a dollar is tied up; the cash in
 *                   clients, stock and factories less what we owe; what 10 days
 *                   on each is worth.
 *   stock health    Ready Stock by how long it has waited (0–90 · 91–180 · 181–365 ·
 *                   a year+ = dead), months of shelf; gold and diamonds as months of
 *                   cover at the last year's use; lots nobody has touched in a year.
 *   product mix     each kind of piece by growth × margin → Grow · Protect · Fix the
 *                   price · Rethink.
 *   season playbook the business's own busy and quiet months (a seasonal index from
 *                   its sales), the festivals and selling seasons ahead (India,
 *                   export, Chinese New Year — weighted by where its clients are),
 *                   and the dates to show designs and take orders by, from its own
 *                   making time.
 *
 * The cash cycle, materials and product mix read the books (purchases, issues,
 * stock, payments): BOOKS, loaded when the Strategy tab opens. Ready Stock and
 * the seasons read only orders and Ready Stock, so Home can show them at once.
 * Sales are dispatched sales, as Reports → Profit & Loss; costs as Cost & Profit.
 */
import { orderTotal, stockCostOf, collectionsLoaded, type DB, type Order } from "@/lib/db";
import { recognisedSale, saleDate, profitReport, rateOn, stockFineGoldRate } from "@/lib/orderCost";
import { receivables, payables, cycleDays, monthLabel } from "@/lib/analytics";
import { stockAsAt, packetsAsAt, readyStockAsAt } from "@/lib/yearEnd";
import { factoryFineGoldBalance } from "@/lib/pure/accounts";
import { toPureGold } from "@/lib/pure/basics";
import { COST, type LazyCol } from "@/lib/pageData";
import { DIWALI } from "@/lib/fiscalYear";
import { topMoves, type Move } from "./strategy";

/** The books the cash cycle, materials and product mix read. */
export const BOOKS: LazyCol[] = [...COST, "diamondSales", "supplierReceipts", "supplierPayments", "supplierSales", "factoryPayments", "memos"];

const DAY = 86_400_000;
const r0 = (n: number) => Math.round(n);
const r1 = (n: number) => Math.round(n * 10) / 10;
const r3 = (n: number) => Math.round(n * 1000) / 1000;
const usd = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
const pad = (n: number) => String(n).padStart(2, "0");
const dayStr = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const addDays = (day: string, n: number) => { const d = new Date(`${day}T12:00:00`); d.setDate(d.getDate() + n); return dayStr(d); };
const daysBetween = (a: string, b: string) => Math.round((+new Date(`${b}T12:00:00`) - +new Date(`${a}T12:00:00`)) / DAY);
const median = (xs: number[]) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b), m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const fmtDay = (day: string) => new Date(`${day}T12:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });

const live = (db: Pick<DB, "orders">) => db.orders.filter(o => !o.deletedAt);
/** Client sales (dispatched) in (from, to]. */
const soldBetween = (db: Pick<DB, "orders">, from: number, to: number) =>
  live(db).filter(o => !o.forReadyStock && recognisedSale(o) && +new Date(saleDate(o)) > from && +new Date(saleDate(o)) <= to);

/* ── Cash cycle ─────────────────────────────────────────────────────────── */
export interface CashCycle {
  /** ₹ to the $ used for the stock and what we owe (today's rate on file); null = none on file. */
  fx: number | null;
  salesUsd: number; cogsUsd: number | null;
  receivables: ReturnType<typeof receivables>;
  stock: { materialsUsd: number | null; certifiedUsd: number | null; goldAtFactoriesUsd: number | null; readyStockUsd: number; totalUsd: number | null; unpriced: number };
  payables: { suppliersUsd: number | null; factoriesUsd: number | null; totalUsd: number | null };
  dso: number | null; dio: number | null; dpo: number | null; ccc: number | null;
  /** In clients + stock − what we owe. */
  tiedUpUsd: number | null;
  /** What 10 days on each is worth, in cash freed. */
  per10: { collect: number | null; stock: number | null; pay: number | null };
}

function cashCycle(db: DB, now: Date, pr12: ReturnType<typeof profitReport>): CashCycle {
  const today = dayStr(now);
  const fx = rateOn(db, now.toISOString())?.rate ?? null;
  const toUsd = (inr: number) => (fx ? inr / fx : null);
  const salesUsd = pr12.totals.sellingUsd;
  const cogsUsd = pr12.totals.costUsd ?? (fx ? pr12.totals.costInr / fx : null);
  const rec = receivables(live(db).filter(o => !o.forReadyStock), now);

  const lines = stockAsAt(db, today);
  const materialsInr = lines.reduce((s, l) => s + (l.valueInr ?? 0), 0);
  const unpricedLines = lines.filter(l => l.valueInr == null && l.qty > 0).length;
  const packets = packetsAsAt(db, today);
  const shelf = readyStockAsAt(db, today);
  const fine = (db.factories ?? []).reduce((s, f) => s + Math.max(0, factoryFineGoldBalance(db.materialIssuances ?? [], f.id, f.openingFineGold)), 0);
  const fineRate = fine > 0 ? stockFineGoldRate(db, now.toISOString())?.rate ?? null : 0;
  const atFactoriesInr = fineRate == null ? null : fine * fineRate;
  const stock = {
    materialsUsd: toUsd(materialsInr), certifiedUsd: toUsd(packets.valueInr),
    goldAtFactoriesUsd: atFactoriesInr == null ? null : toUsd(atFactoriesInr),
    readyStockUsd: shelf.costUsd,
    totalUsd: fx && atFactoriesInr != null ? (materialsInr + packets.valueInr + atFactoriesInr) / fx + shelf.costUsd : null,
    unpriced: unpricedLines + packets.unpriced + shelf.unpriced,
  };
  const owe = payables(db);
  const pay = { suppliersUsd: toUsd(owe.suppliersInr), factoriesUsd: toUsd(owe.factoriesInr), totalUsd: toUsd(owe.suppliersInr + owe.factoriesInr) };

  const perDaySales = salesUsd / 365, perDayCogs = cogsUsd != null ? cogsUsd / 365 : null;
  const dso = perDaySales > 0 ? r0(rec.total / perDaySales) : null;
  const dio = perDayCogs && stock.totalUsd != null ? r0(stock.totalUsd / perDayCogs) : null;
  const dpo = perDayCogs && pay.totalUsd != null ? r0(pay.totalUsd / perDayCogs) : null;
  return {
    fx, salesUsd: r0(salesUsd), cogsUsd: cogsUsd == null ? null : r0(cogsUsd), receivables: rec,
    stock: { ...stock, materialsUsd: n0(stock.materialsUsd), certifiedUsd: n0(stock.certifiedUsd), goldAtFactoriesUsd: n0(stock.goldAtFactoriesUsd), readyStockUsd: r0(stock.readyStockUsd), totalUsd: n0(stock.totalUsd) },
    payables: { suppliersUsd: n0(pay.suppliersUsd), factoriesUsd: n0(pay.factoriesUsd), totalUsd: n0(pay.totalUsd) },
    dso, dio, dpo, ccc: dso != null && dio != null && dpo != null ? dso + dio - dpo : null,
    tiedUpUsd: stock.totalUsd != null && pay.totalUsd != null ? r0(rec.total + stock.totalUsd - pay.totalUsd) : null,
    per10: { collect: perDaySales > 0 ? r0(perDaySales * 10) : null, stock: perDayCogs ? r0(perDayCogs * 10) : null, pay: perDayCogs ? r0(perDayCogs * 10) : null },
  };
}
const n0 = (n: number | null) => (n == null ? null : r0(n));

/* ── Stock health: Ready Stock ──────────────────────────────────────────── */
export const SHELF_BUCKETS = [
  { key: "fresh", label: "0–90 days", max: 90 },
  { key: "aging", label: "91–180 days", max: 180 },
  { key: "old", label: "181–365 days", max: 365 },
  { key: "dead", label: "Over a year", max: Infinity },
] as const;
export interface ShelfPiece { id: string; name: string; sku?: string; item: string; qty: number; days: number; costUsd: number | null; priceUsd: number; location?: string }
export interface Shelf {
  buckets: { key: string; label: string; pieces: number; costUsd: number; priceUsd: number }[];
  pieces: number; costUsd: number; priceUsd: number; unpriced: number;
  /** Ready Stock pieces sold in the last 12 months, and how many months the shelf would last at that pace. */
  sold12: number; monthsOfShelf: number | null;
  oldest: ShelfPiece[]; dead: { pieces: number; costUsd: number; priceUsd: number };
}

export function shelfHealth(db: Pick<DB, "orders" | "readyStock" | "adminRecords">, now = new Date()): Shelf {
  const items = (db.readyStock ?? []);
  const byId = new Map(items.map(i => [i.id, i]));
  // A piece moved to another office became a new item: its age is the first one's.
  const bornOf = (id: string) => {
    let it = byId.get(id), at = it?.createdAt ?? "", hops = 0;
    while (it?.splitFrom && hops++ < 10) { it = byId.get(it.splitFrom); if (it?.createdAt && it.createdAt < at) at = it.createdAt; }
    return at;
  };
  const buckets = SHELF_BUCKETS.map(b => ({ key: b.key, label: b.label, pieces: 0, costUsd: 0, priceUsd: 0 }));
  const rows: ShelfPiece[] = [];
  let unpriced = 0;
  for (const it of items) {
    const q = it.quantity || 0;
    if (q <= 0) continue;
    const born = bornOf(it.id);
    const days = born ? Math.max(0, Math.floor((+now - +new Date(born)) / DAY)) : 0;
    const c = stockCostOf(db as DB, it);
    if (c == null) unpriced += q;
    const b = buckets[SHELF_BUCKETS.findIndex(x => days <= x.max)];
    b.pieces += q; b.costUsd += (c ?? 0) * q; b.priceUsd += (it.price || 0) * q;
    rows.push({ id: it.id, name: it.name, sku: it.sku, item: it.jewelleryType, qty: q, days, costUsd: c == null ? null : r0(c * q), priceUsd: r0((it.price || 0) * q), location: it.location });
  }
  const from = +now - 365 * DAY;
  let sold12 = 0;
  for (const o of live(db)) {
    if (o.readyStockItemId && o.status !== "Rejected" && +new Date(o.createdAt) > from && !o.readyStockBackAt) sold12 += o.readyStockQty || 1;
    if (o.stockSale && +new Date(o.stockSale.soldAt) > from) sold12 += o.stockSale.qty || 1;
  }
  const pieces = buckets.reduce((s, b) => s + b.pieces, 0);
  const dead = buckets[3];
  return {
    buckets: buckets.map(b => ({ ...b, costUsd: r0(b.costUsd), priceUsd: r0(b.priceUsd) })),
    pieces, costUsd: r0(buckets.reduce((s, b) => s + b.costUsd, 0)), priceUsd: r0(buckets.reduce((s, b) => s + b.priceUsd, 0)), unpriced,
    sold12, monthsOfShelf: sold12 > 0 ? r1(pieces / (sold12 / 12)) : null,
    oldest: rows.sort((a, b) => b.days - a.days).slice(0, 12),
    dead: { pieces: dead.pieces, costUsd: r0(dead.costUsd), priceUsd: r0(dead.priceUsd) },
  };
}

/* ── Stock health: gold, diamonds, slow lots ────────────────────────────── */
export interface Materials {
  gold: { fineG: number; usedFineG12: number; perMonthG: number; monthsCover: number | null; valueUsd: number | null };
  diamonds: { ct: number; usedCt12: number; perMonthCt: number; monthsCover: number | null; valueUsd: number | null };
  /** Stock nobody has used for a year (bought more than six months ago). */
  slow: { material: string; bucket: string; qty: number; unit: string; valueUsd: number | null; lastUsed: string | null }[];
  slowUsd: number;
}
/** A real use of stock: into a piece, to a factory, sold — not moved between bags or companies, not a purchase undone. */
const NOT_USE = new Set(["purchase", "transfer", "bagMove", "supplierLoan", "opening"]);

function materials(db: DB, now: Date, fx: number | null): Materials {
  const today = dayStr(now);
  const from = +now - 365 * DAY;
  const lines = stockAsAt(db, today);
  const moves = db.stockMovements ?? [];
  const reversed = new Set(moves.filter(m => m.reversesId).map(m => m.reversesId!));
  const isUse = (m: (typeof moves)[number]) => (m.type === "issuance_out" || m.type === "order_direct_use") && !NOT_USE.has(m.refType ?? "") && !m.reversesId && !reversed.has(m.id);
  let goldUse = 0, diaUse = 0;
  const lastUse = new Map<string, string>();
  const firstIn = new Map<string, string>();
  for (const m of moves) {
    const k = `${m.companyId ?? ""}|${m.material}|${m.purityOrQuality}`;
    if (isUse(m)) {
      if (!lastUse.has(k) || m.createdAt > lastUse.get(k)!) lastUse.set(k, m.createdAt);
      if (+new Date(m.createdAt) > from) {
        if (m.material === "gold") goldUse += toPureGold(m.quantity, m.purityOrQuality);
        else if (m.material === "diamond") diaUse += m.quantity;
      }
    } else if (m.type === "purchase_in" || m.refType === "opening") {
      if (!firstIn.has(k) || m.createdAt < firstIn.get(k)!) firstIn.set(k, m.createdAt);
    }
  }
  const gold = lines.filter(l => l.material === "gold" && l.qty > 0);
  const dia = lines.filter(l => l.material === "diamond" && l.qty > 0);
  const packets = packetsAsAt(db, today);
  const toUsd = (inr: number) => (fx ? r0(inr / fx) : null);
  const fineG = r3(gold.reduce((s, l) => s + (l.fine ?? 0), 0));
  const ct = r3(dia.reduce((s, l) => s + l.qty, 0) + packets.ct);
  const half = +now - 182 * DAY;
  const slow = lines
    .filter(l => l.qty > 0 && (l.valueInr ?? 0) > 0)
    .map(l => { const k = `${l.companyId === "main" ? "" : l.companyId}|${l.material}|${l.bucket}`; const k2 = `${l.companyId}|${l.material}|${l.bucket}`; return { l, last: lastUse.get(k) ?? lastUse.get(k2) ?? null, first: firstIn.get(k) ?? firstIn.get(k2) ?? null }; })
    .filter(x => (!x.last || +new Date(x.last) <= from) && (!x.first || +new Date(x.first) <= half))
    .map(x => ({ material: x.l.material, bucket: x.l.bucket, qty: x.l.qty, unit: x.l.unit, valueUsd: toUsd(x.l.valueInr ?? 0), lastUsed: x.last ? x.last.slice(0, 10) : null }))
    .sort((a, b) => (b.valueUsd ?? 0) - (a.valueUsd ?? 0));
  return {
    gold: { fineG, usedFineG12: r3(goldUse), perMonthG: r3(goldUse / 12), monthsCover: goldUse > 0 ? r1(fineG / (goldUse / 12)) : null, valueUsd: toUsd(gold.reduce((s, l) => s + (l.valueInr ?? 0), 0)) },
    diamonds: { ct, usedCt12: r3(diaUse), perMonthCt: r3(diaUse / 12), monthsCover: diaUse > 0 ? r1(ct / (diaUse / 12)) : null, valueUsd: toUsd(dia.reduce((s, l) => s + (l.valueInr ?? 0), 0) + packets.valueInr) },
    slow: slow.slice(0, 15), slowUsd: slow.reduce((s, x) => s + (x.valueUsd ?? 0), 0),
  };
}

/* ── Product mix ────────────────────────────────────────────────────────── */
export type MixPlace = "grow" | "protect" | "fix" | "rethink" | "unpriced";
export const MIX: Record<MixPlace, { label: string; meaning: string; play: string; tone: "green" | "blue" | "amber" | "red" | "neutral" }> = {
  grow: { label: "Grow", meaning: "Selling more, and earning above your average", play: "Put more in: new designs, Ready Stock, show it to every client first", tone: "green" },
  protect: { label: "Protect", meaning: "Earns well, but selling less than last year", play: "Refresh the designs and ask the clients who stopped why — this is good money slipping", tone: "blue" },
  fix: { label: "Fix the price", meaning: "Selling more, but earning below your average", play: "Raise the price or cut the making cost (labour rate, gold loss, stone cost) before pushing it more", tone: "amber" },
  rethink: { label: "Rethink", meaning: "Selling less and earning below your average", play: "Make it only to order — no Ready Stock, fewer designs; put the time into Grow", tone: "red" },
  unpriced: { label: "Not priced", meaning: "No cost known for these sales yet", play: "Finish the Final Approvals so their cost is known", tone: "neutral" },
};

export interface MixRow { item: string; sales12: number; yearBefore: number; growth: number | null; orders12: number; share: number; marginPct: number | null; place: MixPlace }
export interface ProductMix { rows: MixRow[]; avgMargin: number | null }

function productMix(db: DB, now: Date, pr12: ReturnType<typeof profitReport>): ProductMix {
  const prev = soldBetween(db, +now - 730 * DAY, +now - 365 * DAY);
  const before = new Map<string, number>();
  for (const o of prev) before.set(o.jewelleryType, (before.get(o.jewelleryType) ?? 0) + orderTotal(o));
  const known = (rs: typeof pr12.rows) => rs.filter(r => r.profitUsd != null && r.complete);
  const marginOf = (rs: typeof pr12.rows) => { const k = known(rs), s = k.reduce((a, r) => a + r.sellingUsd, 0); return s > 0 ? r1((k.reduce((a, r) => a + r.profitUsd!, 0) / s) * 100) : null; };
  const avgMargin = marginOf(pr12.rows);
  const groups = new Map<string, typeof pr12.rows>();
  for (const r of pr12.rows) { const k = r.order.jewelleryType || "—"; groups.set(k, [...(groups.get(k) ?? []), r]); }
  for (const k of before.keys()) if (!groups.has(k)) groups.set(k, []);
  const total = pr12.totals.sellingUsd;
  const rows: MixRow[] = [];
  for (const [item, rs] of groups) {
    const s12 = rs.reduce((a, r) => a + r.sellingUsd, 0), s0 = before.get(item) ?? 0;
    if (s12 + s0 <= 0) continue;
    const growth = s0 > 0 ? r1(((s12 - s0) / s0) * 100) : null;
    const m = marginOf(rs);
    const up = growth == null ? s12 > 0 : growth >= 0;
    const place: MixPlace = m == null || avgMargin == null ? (s12 > 0 ? "unpriced" : "rethink")
      : m >= avgMargin ? (up ? "grow" : "protect") : (up ? "fix" : "rethink");
    rows.push({ item, sales12: r0(s12), yearBefore: r0(s0), growth, orders12: rs.length, share: total > 0 ? r1((s12 / total) * 100) : 0, marginPct: m, place });
  }
  return { rows: rows.sort((a, b) => b.sales12 - a.sales12), avgMargin };
}

/* ── Season playbook ────────────────────────────────────────────────────── */
type Market = "india" | "export" | "china";
const DHANTERAS = ["2025-10-18", "2026-11-06", "2027-10-27", "2028-10-15", "2029-11-04", "2030-10-24"];
const AKSHAYA = ["2025-04-30", "2026-04-20", "2027-05-09", "2028-04-27", "2029-05-16", "2030-05-05"];
const CNY = ["2026-02-17", "2027-02-06", "2028-01-26", "2029-02-13", "2030-02-03", "2031-01-23"];
/** The nth weekday (0 = Sunday) of a month. */
const nthWeekday = (y: number, m: number, wd: number, n: number) => { const d = new Date(y, m - 1, 1, 12); d.setDate(1 + ((wd - d.getDay() + 7) % 7) + (n - 1) * 7); return dayStr(d); };

interface EventDef { key: string; name: string; market: Market; date: string; until?: string;
  /** Days before the date that shops start selling for it — the stock must be there by then. */
  sellFrom: number; why: string }
function eventsAround(year: number): EventDef[] {
  const y = String(year);
  const out: EventDef[] = [];
  const dh = DHANTERAS.find(d => d.startsWith(y)), dw = DIWALI.find(d => d.startsWith(y));
  if (dh) out.push({ key: `diwali-${y}`, name: "Dhanteras & Diwali", market: "india", date: dh, until: dw, sellFrom: 21, why: "The biggest gold and jewellery buying days in India" });
  const ak = AKSHAYA.find(d => d.startsWith(y));
  if (ak) out.push({ key: `akshaya-${y}`, name: "Akshaya Tritiya", market: "india", date: ak, sellFrom: 10, why: "An auspicious day to buy gold — a spring peak" });
  out.push({ key: `wed-w-${y}`, name: "Wedding season (winter)", market: "india", date: `${y}-11-15`, until: `${year + 1}-02-28`, sellFrom: 0, why: "Mid-November to February — bridal sets, heavier pieces (dates follow the muhurats)" });
  out.push({ key: `wed-s-${y}`, name: "Wedding season (summer)", market: "india", date: `${y}-04-15`, until: `${y}-06-15`, sellFrom: 0, why: "Mid-April to June — the second bridal season" });
  const bf = addDays(nthWeekday(year, 11, 4, 4), 1);
  out.push({ key: `holiday-${y}`, name: "Holiday season (Black Friday → Christmas)", market: "export", date: bf, until: `${y}-12-25`, sellFrom: 14, why: "The biggest selling weeks of the year for jewellers in the US and Europe" });
  out.push({ key: `val-${y}`, name: "Valentine's Day", market: "export", date: `${y}-02-14`, sellFrom: 21, why: "Hearts, pendants, studs, engagement — the second export peak" });
  out.push({ key: `mom-${y}`, name: "Mother's Day (US)", market: "export", date: nthWeekday(year, 5, 0, 2), sellFrom: 21, why: "Pendants, birthstones, names — a strong US gifting week" });
  const cn = CNY.find(d => d.startsWith(y));
  if (cn) out.push({ key: `cny-${y}`, name: "Chinese New Year", market: "china", date: cn, sellFrom: 21, why: "Gold gifting peak for Hong Kong, China and Singapore buyers" });
  return out;
}
const marketOf = (country: string | undefined): Market | null => {
  const c = (country ?? "").trim().toLowerCase();
  if (!c) return null;
  if (/\bindia\b|bharat/.test(c)) return "india";
  if (/hong ?kong|\bhk\b|china|taiwan|singapore|macau/.test(c)) return "china";
  return "export";
};

export interface SeasonMonth { key: string; label: string; salesIndex: number | null; bookingIndex: number | null; lastYearUsd: number; mood: "busy" | "quiet" | "normal" | null; events: string[] }
export interface SeasonEvent { key: string; name: string; market: Market; date: string; until?: string; why: string; share: number | null;
  showBy: string; ordersBy: string; inShopsBy: string; daysToShow: number;
  /** on = a season under way; late = too late to take orders for it; now = show designs now; soon = within 30 days. */
  status: "on" | "now" | "soon" | "later" | "late" }
export interface Season {
  /** Months of sales behind the index (12+ needed). */
  months: number; leadDays: number;
  /** Calendar month 1–12 → index (100 = an average month). */
  salesIndex: (number | null)[]; bookingIndex: (number | null)[];
  avgMonthUsd: number;
  peaks: string[]; quiet: string[];
  ahead: SeasonMonth[]; events: SeasonEvent[];
  marketShare: Record<Market, number> & { unknown: number };
}
const MONTH = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const ym = (iso: string) => { const d = new Date(iso); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`; };

export function seasonPlaybook(db: Pick<DB, "orders" | "clients">, now = new Date()): Season {
  const orders = live(db).filter(o => !o.forReadyStock);
  const thisMonth = ym(now.toISOString());
  const sales = new Map<string, number>(), booked = new Map<string, number>();
  for (const o of orders) {
    if (recognisedSale(o)) { const k = ym(saleDate(o)); if (k < thisMonth) sales.set(k, (sales.get(k) ?? 0) + orderTotal(o)); }
    if (o.status !== "Rejected") { const k = ym(o.createdAt); if (k < thisMonth) booked.set(k, (booked.get(k) ?? 0) + orderTotal(o)); }
  }
  // Every month from the first sale to last month counts, empty ones too.
  const keys = [...sales.keys(), ...booked.keys()].sort();
  const span: string[] = [];
  if (keys.length) {
    const [y0, m0] = keys[0].split("-").map(Number);
    for (let i = 0; span.length < 120; i++) {
      const d = new Date(y0, m0 - 1 + i, 1, 12);
      const k = `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
      if (k >= thisMonth) break;
      span.push(k);
    }
  }
  const indexOf = (src: Map<string, number>) => {
    if (span.length < 12) return Array(12).fill(null) as (number | null)[];
    const avg = MONTH.map((_, i) => { const ks = span.filter(k => Number(k.slice(5)) === i + 1); return ks.length ? ks.reduce((s, k) => s + (src.get(k) ?? 0), 0) / ks.length : 0; });
    const mean = avg.reduce((s, v) => s + v, 0) / 12;
    return avg.map(v => (mean > 0 ? r0((v / mean) * 100) : null));
  };
  const salesIndex = indexOf(sales), bookingIndex = indexOf(booked);
  const last12 = span.slice(-12);
  const avgMonthUsd = last12.length ? r0(last12.reduce((s, k) => s + (sales.get(k) ?? 0), 0) / last12.length) : 0;

  const yearAgo = +now - 365 * DAY;
  const cyc = orders.filter(o => recognisedSale(o) && +new Date(saleDate(o)) > yearAgo).map(cycleDays).filter((x): x is number => x != null);
  const leadDays = r0(median(cyc.length ? cyc : orders.map(cycleDays).filter((x): x is number => x != null)) ?? 30);

  // Where the clients are, by the last 12 months' sales.
  const share = { india: 0, export: 0, china: 0, unknown: 0 };
  const cOf = new Map(db.clients.map(c => [c.id, c]));
  let tot = 0;
  for (const o of orders) if (recognisedSale(o) && +new Date(saleDate(o)) > yearAgo) { const v = orderTotal(o); tot += v; const m = marketOf(cOf.get(o.clientId)?.country); share[m ?? "unknown"] += v; }
  const marketShare = { india: tot ? r0((share.india / tot) * 100) : 0, export: tot ? r0((share.export / tot) * 100) : 0, china: tot ? r0((share.china / tot) * 100) : 0, unknown: tot ? r0((share.unknown / tot) * 100) : 100 };
  const knownMostly = marketShare.unknown < 50;

  const today = dayStr(now);
  const until = addDays(today, 365);
  const events: SeasonEvent[] = [];
  for (const y of [now.getFullYear() - 1, now.getFullYear(), now.getFullYear() + 1]) for (const e of eventsAround(y)) {
    const end = e.until ?? e.date;
    if (end < today || e.date > until) continue;
    // Already started: only a season still running is shown (as on now).
    const running = e.date < today;
    if (running && !(e.until && daysBetween(e.date, e.until) > 20)) continue;
    const sh = knownMostly ? marketShare[e.market] : null;
    if (sh === 0) continue; // none of the clients buy for it
    let inShopsBy = addDays(e.date, -e.sellFrom);
    let ordersBy = addDays(inShopsBy, -(leadDays + 7));
    let showBy = addDays(ordersBy, -30);
    // A long season (weddings, the holidays) still sells in its later weeks: when its start is
    // missed — or it is under way — the pieces can still reach the shops with a month left to sell.
    const season = !!e.until && daysBetween(e.date, e.until) > 20;
    if (season && ordersBy < today) {
      const lastIn = addDays(e.until!, -30);
      const lastOrders = addDays(lastIn, -(leadDays + 7));
      if (lastOrders >= today) { ordersBy = lastOrders; inShopsBy = lastIn; showBy = today; }
    }
    const daysToShow = daysBetween(today, showBy);
    const status: SeasonEvent["status"] = ordersBy < today ? (running ? "on" : "late") : daysToShow <= 0 ? "now" : daysToShow <= 30 ? "soon" : "later";
    events.push({ key: e.key, name: e.name, market: e.market, date: e.date, until: e.until, why: e.why, share: sh, showBy, ordersBy, inShopsBy, daysToShow, status });
  }
  events.sort((a, b) => a.date.localeCompare(b.date));

  const ahead: SeasonMonth[] = [];
  for (let i = 0; i < 6; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1, 12);
    const key = `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
    const mi = d.getMonth();
    const si = salesIndex[mi];
    const ly = `${d.getFullYear() - 1}-${pad(mi + 1)}`;
    ahead.push({ key, label: monthLabel(key), salesIndex: si, bookingIndex: bookingIndex[mi], lastYearUsd: r0(sales.get(ly) ?? 0),
      mood: si == null ? null : si >= 115 ? "busy" : si <= 85 ? "quiet" : "normal",
      events: events.filter(e => e.date.slice(0, 7) === key || (e.until && e.date.slice(0, 7) < key && e.until.slice(0, 7) >= key)).map(e => e.name) });
  }
  const named = salesIndex.map((v, i) => ({ v, m: MONTH[i] })).filter(x => x.v != null) as { v: number; m: string }[];
  return {
    months: span.length, leadDays, salesIndex, bookingIndex, avgMonthUsd,
    peaks: named.filter(x => x.v >= 115).sort((a, b) => b.v - a.v).map(x => x.m),
    quiet: named.filter(x => x.v <= 85).sort((a, b) => a.v - b.v).map(x => x.m),
    ahead, events, marketShare,
  };
}

/* ── All of it, and the moves it makes ──────────────────────────────────── */
export interface Books { cash: CashCycle; materials: Materials; mix: ProductMix }
/** The parts that read the books — only once BOOKS have loaded. */
export function booksHealth(db: DB, now = new Date()): Books {
  const pr12 = profitReport(db, soldBetween(db, +now - 365 * DAY, +now));
  const cash = cashCycle(db, now, pr12);
  return { cash, materials: materials(db, now, cash.fx), mix: productMix(db, now, pr12) };
}

export function healthMoves(db: DB, now: Date, shelf: Shelf, season: Season, books: Books | null): Move[] {
  const moves: Move[] = [];
  if (shelf.dead.pieces > 0) {
    const v = shelf.dead.costUsd || shelf.dead.priceUsd;
    moves.push({ key: "shelf-dead", kind: "stock", priority: "medium", dueInDays: 14, usd: v,
      title: `Clear the ${shelf.dead.pieces} Ready Stock piece${shelf.dead.pieces === 1 ? "" : "s"} over a year on the shelf`,
      why: `${usd(v)} of cash sitting in them — offer them to clients at a price, put them in a campaign, or melt and reuse the gold` });
  }
  for (const e of season.events.filter(x => x.status === "now" || x.status === "soon").slice(0, 2)) {
    const month = new Date(`${e.date}T12:00:00`).getMonth();
    const idx = season.salesIndex[month];
    const v = r0(season.avgMonthUsd * ((idx ?? 100) / 100) * ((e.share ?? 100) / 100));
    if (v <= 0) continue;
    moves.push({ key: `season-${e.key}`, kind: "season", priority: e.status === "now" ? "high" : "medium", dueInDays: Math.max(1, Math.min(14, e.daysToShow)), usd: v,
      title: `Get ready for ${e.name}: ${e.status === "now" ? "show clients new designs now" : `show clients new designs by ${fmtDay(e.showBy)}`}`,
      why: `Orders must be in by ${fmtDay(e.ordersBy)} to reach the shops by ${fmtDay(e.inShopsBy)} (your pieces take about ${season.leadDays} days)${e.share != null ? ` — ${e.share}% of your sales are to clients who buy for it` : ""}` });
  }
  if (books) {
    const c = books.cash;
    if (c.dso != null && c.dso > 45 && c.per10.collect) {
      const v = Math.min(c.receivables.total, r0((c.dso - 30) * (c.salesUsd / 365)));
      moves.push({ key: "cash-dso", kind: "cash", priority: c.dso > 75 ? "high" : "medium", dueInDays: 7, usd: v,
        title: `Get paid faster: from ${c.dso} days to 30`, why: `Clients take ${c.dso} days to pay on average — 30 days would free about ${usd(v)} of cash (${usd(c.receivables.d90)} is over 90 days)` });
    }
    const m = books.materials;
    if (m.slowUsd > 0) moves.push({ key: "stock-slow", kind: "stock", priority: "low", dueInDays: 21, usd: r0(m.slowUsd),
      title: `Use or sell the ${m.slow.length} stock lot${m.slow.length === 1 ? "" : "s"} nobody has touched in a year`, why: `${usd(m.slowUsd)} of material waiting — plan it into orders, sell it to a supplier, or return it` });
    if (m.gold.monthsCover != null && m.gold.monthsCover > 6 && c.fx) {
      const extraG = (m.gold.monthsCover - 3) * m.gold.perMonthG;
      const v = m.gold.fineG > 0 && m.gold.valueUsd ? r0((extraG / m.gold.fineG) * m.gold.valueUsd) : 0;
      if (v > 0) moves.push({ key: "stock-gold", kind: "cash", priority: "low", dueInDays: 30, usd: v,
        title: `Buy less gold until the stock is down to 3 months`, why: `${m.gold.fineG} g fine in stock is ${m.gold.monthsCover} months of use (${m.gold.perMonthG} g a month) — the extra ties up about ${usd(v)}` });
    }
    const avg = books.mix.avgMargin;
    const fix = books.mix.rows.filter(r => r.place === "fix" && r.marginPct != null && avg != null).sort((a, b) => b.sales12 * (avg! - b.marginPct!) - a.sales12 * (avg! - a.marginPct!))[0];
    if (fix && avg != null) {
      const v = r0((fix.sales12 * (avg - fix.marginPct!)) / 100);
      if (v > 0) moves.push({ key: `mix-fix-${fix.item}`, kind: "mix", priority: "medium", dueInDays: 14, usd: v,
        title: `Fix the price of ${fix.item}`, why: `Selling more (${fix.growth == null ? "new" : `${fix.growth >= 0 ? "+" : ""}${fix.growth}%`}) but earning ${fix.marginPct}% against your ${avg}% — at your average it would make ${usd(v)} more a year` });
    }
    const prot = books.mix.rows.filter(r => r.place === "protect").sort((a, b) => (b.yearBefore - b.sales12) - (a.yearBefore - a.sales12))[0];
    if (prot && prot.yearBefore > prot.sales12) moves.push({ key: `mix-protect-${prot.item}`, kind: "mix", priority: "medium", dueInDays: 14, usd: r0(prot.yearBefore - prot.sales12),
      title: `Win back ${prot.item} sales — new designs, ask who stopped`, why: `It earns ${prot.marginPct}% (above your ${avg}%), but sold ${usd(prot.sales12)} against ${usd(prot.yearBefore)} the year before` });
  }
  return moves;
}

/** The week's moves from both parts — the books' only once they are here (Home never waits for them). */
export function allMoves(db: DB, now = new Date()) {
  const base = topMoves(db, now);
  const shelf = shelfHealth(db, now);
  const season = seasonPlaybook(db, now);
  const books = collectionsLoaded(BOOKS) ? booksHealth(db, now) : null;
  const moves = [...base.moves, ...healthMoves(db, now, shelf, season, books)].sort((a, b) => b.usd - a.usd);
  return { ...base, moves, shelf, season, books };
}

/** Questions for the strategist on these parts — each sent to the agent, which reads business_health. */
export const HEALTH_QUESTIONS: { label: string; q: string }[] = [
  { label: "Free up cash", q: "Using business_health's cash cycle, where is our cash tied up (clients, stock, factories) and what are the 3 quickest ways to free it in the next 60 days, with the amounts?" },
  { label: "What to do with old stock", q: "Using business_health's stock health, what should we do with the Ready Stock and material that has waited longest — sell, discount, use in orders or melt — piece by piece where it matters?" },
  { label: "Which products to push", q: "Using business_health's product mix, which kinds of pieces should we push, protect, re-price or stop, and why?" },
  { label: "Plan the next season", q: "Using business_health's season playbook, what must we do in the next 90 days to be ready for the coming festivals and busy months — dates for designs, orders and stock?" },
];
