/**
 * Year closing — every balance as it stood at the end of a financial year, and
 * the Year book frozen from it when the year is closed (Settings → Year closing).
 *
 * Nothing here writes or changes a record. Balances in this app are worked out
 * from the records, never stored, so the new year's opening balance IS the old
 * year's closing balance with nothing carried by hand — the same way Tally
 * carries balances forward. What closing adds is (1) the figures as at the last
 * day, frozen, so the year can always be seen as it was closed, and (2) the lock
 * (lib/yearLock.ts) that keeps those records from changing afterwards.
 *
 * "As at a day" means: every entry dated on or before that day, through the very
 * same function the party's own page uses. A year can therefore be closed any
 * time after it ends — entries made since are simply not counted in it. Each
 * party's figure as at TODAY is checked against its card (`checks`), so a
 * difference between the two ways of counting can never hide.
 */
import {
  type DB, type Order, type Client, type Supplier, type Factory, type Broker, type Designer, type Locker,
  type OpeningBalanceInfo, type Purchase,
  clientAccount, orderGrossTotal, stockCostOf,
} from "./db";
import { supplierAccount, factoryAccount, factoryFineGoldBalance, factoryOtherBalances, lockerBalance } from "./pure/accounts";
import { toPureGold } from "./pure/basics";
import { buildFactoryStatement } from "./factoryStatement";
import { brokerAccount } from "./brokers";
import { designerAccount } from "./designers";
import { supplierGoldOwed } from "./supplierGold";
import { deriveStockBalances } from "./manufacturing";
import {
  profitReport, operatingExpenses, exchangeDifferenceTotal, recognisedSale, saleDate, stockAverageRate,
} from "./orderCost";
import { supplierSalesProfit } from "./supplierSales";
import { companiesOf } from "./companies";
import { materialDefs, materialName, materialUnit } from "./materials";
import { dayOf, type FiscalYear } from "./fiscalYear";
import { advanceOwed } from "./employeeAdvances";
import { memoOutAsAt } from "./memos";

/** Bumped when the book's shape changes, so an older book is read for what it holds. */
export const YEAR_BOOK_VERSION = 1;

const r2 = (n: number) => Math.round(n * 100) / 100;
const r3 = (n: number) => Math.round(n * 1000) / 1000;
/** On or before the day. An entry with no date counts as old (it was there before dates were kept). */
const by = (iso: string | undefined, day: string) => !iso || dayOf(iso) <= day;
/** The end of a day as an ISO moment, for the functions that take one. */
export const endOfDayIso = (day: string) => new Date(`${day}T23:59:59.999`).toISOString();

/** A party's opening balance counts from its own date (or the day the party was added). */
function openingAsAt<T extends OpeningBalanceInfo & { openingDate?: string; createdAt?: string }>(p: T, day: string): T {
  return by(p.openingDate || p.createdAt, day) ? p : { ...p, openingBalance: 0 };
}

/* ── Clients ───────────────────────────────────────────────────────────────
 * A client's account is worked out from their orders and their held credit,
 * and the held credit is one running figure with no dates of its own. So the
 * balance at the end of a year is TODAY's card figure less everything dated
 * after that day — orders placed, pieces returned, money received, refunds paid.
 * Exact as at today; the movements since are the dated ones the app keeps.
 */
export interface ClientMoves { billed: number; returned: number; received: number; refunded: number; opening: number }

function clientOrders(db: DB, clientId: string): Order[] {
  return db.orders.filter(o => o.clientId === clientId && !o.deletedAt && o.status !== "Rejected");
}

/** What moved on a client's account up to a day (no day: everything). */
export function clientMoves(db: DB, c: Client, day?: string): ClientMoves {
  const upTo = (iso: string | undefined) => (day ? by(iso, day) : true);
  let billed = 0, returned = 0, received = 0, refunded = 0;
  for (const o of clientOrders(db, c.id)) {
    if (upTo(o.createdAt)) billed += orderGrossTotal(o) - (o.giftCardRedeemed || 0);
    for (const r of o.returns ?? []) if (upTo(r.at)) returned += r.creditUsd;
  }
  // Money in, as Reports counts it: each receipt, and the payments taken on an
  // order before receipts existed. Credit moved onto a bill is not new money.
  for (const r of db.clientReceipts ?? []) if (r.clientId === c.id && upTo(r.date || r.createdAt)) received += r.amountUsd || 0;
  for (const o of db.orders) {
    if (o.clientId !== c.id) continue;
    for (const a of o.advances ?? []) if (!a.receiptId && !a.fromCredit && upTo(a.createdAt)) received += a.amount || 0;
  }
  for (const t of db.lockerTransactions ?? []) {
    if (t.refType === "clientRefund" && t.refId === c.id && upTo(t.createdAt)) refunded += t.refundUsd || 0;
  }
  const opening = (!day || by(c.openingDate || c.createdAt, day)) ? ((c.openingDir === "credit" ? -1 : 1) * Math.abs(c.openingBalance || 0)) : 0;
  return { billed: r2(billed), returned: r2(returned), received: r2(received), refunded: r2(refunded), opening: r2(opening) };
}
const movesNet = (m: ClientMoves) => r2(m.opening + m.billed - m.returned - m.received + m.refunded);

/** The client's card today: + they owe us, − we hold their money. */
export function clientNetToday(db: DB, c: Client): number {
  const a = clientAccount(clientOrders(db, c.id), c.creditBalance || 0, c);
  return r2(a.outstanding - a.credit);
}

export function clientNetAsAt(db: DB, c: Client, day: string): { net: number; today: number; unexplained: number } {
  const today = clientNetToday(db, c);
  const all = movesNet(clientMoves(db, c));
  const then = movesNet(clientMoves(db, c, day));
  // today − (everything since that day)
  return { net: r2(today - (all - then)), today, unexplained: r2(today - all) };
}

/* ── Suppliers: their own account function over the entries up to the day ── */
function purchasesAsAt(list: Purchase[], day: string): Purchase[] {
  return list.filter(p => by(p.createdAt, day)).map(p => ({ ...p, payments: (p.payments ?? []).filter(x => by(x.createdAt, day)) }));
}

export function supplierAsAt(db: DB, s: Supplier, day: string) {
  const own = <T extends { supplierId: string; createdAt: string }>(xs: T[] | undefined) => (xs ?? []).filter(x => x.supplierId === s.id && by(x.createdAt, day));
  const a = supplierAccount(
    purchasesAsAt(db.purchases.filter(p => p.supplierId === s.id), day),
    own(db.supplierReceipts), openingAsAt(s, day), own(db.supplierPayments), own(db.supplierSales),
  );
  const goldRows = supplierGoldOwed(db, s).rows.filter(r => by(r.at, day));
  return { net: a.net, goldFine: goldRows.length ? goldRows[goldRows.length - 1].balance : 0 };
}

/* ── Factories: their statement, read down to the day ───────────────────── */
export function factoryAsAt(db: DB, f: Factory, day: string) {
  const st = buildFactoryStatement({
    issuances: db.materialIssuances.filter(i => i.factoryId === f.id), orders: db.orders,
    advances: (db.factoryPayments ?? []).filter(x => x.factoryId === f.id), factoryId: f.id, opening: f,
    materialLabel: k => ({ name: materialName(db.settings, k), unit: materialUnit(db.settings, k) }),
  });
  const upTo = st.lines.filter(l => !l.date || dayOf(l.date) <= day);
  const last = upTo[upTo.length - 1];
  return {
    owed: last ? last.owed : 0, fineGold: last ? last.goldBal : 0, diamondCt: last ? last.diaBal : 0,
    other: last ? { ...last.otherBal } : {},
    /** The statement's last line agrees with the factory's card today. */
    statementOk: st.check.ok,
  };
}

/** The factory card's figures today, as its page shows them (for the check). */
function factoryToday(db: DB, f: Factory) {
  const iss = db.materialIssuances.filter(i => i.factoryId === f.id);
  const a = factoryAccount(iss, f, (db.factoryPayments ?? []).filter(x => x.factoryId === f.id));
  return { owed: r2(a.chargesPending - a.chargesOverpaid), fineGold: factoryFineGoldBalance(db.materialIssuances, f.id, f.openingFineGold), diamondCt: a.diamondOutstanding, other: factoryOtherBalances(iss, f.id) };
}

/* ── Brokers and designers: their account functions over the entries up to the day ── */
function cutForParties(db: DB, day: string) {
  return {
    purchases: purchasesAsAt(db.purchases, day),
    lockerTransactions: (db.lockerTransactions ?? []).filter(t => by(t.createdAt, day)),
    supplierSales: (db.supplierSales ?? []).filter(x => by(x.createdAt, day)),
    supplierReceipts: (db.supplierReceipts ?? []).filter(x => by(x.createdAt, day)),
    // A design is charged when it is approved: one approved after the day was not owed yet.
    cadJobs: (db.cadJobs ?? []).filter(j => j.status !== "approved" || by(j.approvedAt ?? j.createdAt, day)),
  };
}

/* ── Stock ──────────────────────────────────────────────────────────────── */
export interface StockLine { companyId: string; material: string; bucket: string; qty: number; unit: string; fine?: number; rateInr: number | null; valueInr: number | null }

export function stockAsAt(db: DB, day: string): StockLine[] {
  const moves = (db.stockMovements ?? []).filter(m => by(m.createdAt, day));
  const at = endOfDayIso(day);
  const mats = ["gold", "diamond", ...materialDefs(db.settings).map(m => m.id)];
  const out: StockLine[] = [];
  for (const co of companiesOf(db.settings)) {
    for (const material of mats) {
      const bal = deriveStockBalances(moves, material, co.id);
      for (const [bucket, qty] of Object.entries(bal)) {
        if (Math.abs(qty) < 0.0005) continue;
        const rate = stockAverageRate(db, material, bucket, at, co.id);
        out.push({
          companyId: co.id, material, bucket, qty: r3(qty),
          unit: material === "gold" ? "g" : material === "diamond" ? "ct" : materialUnit(db.settings, material),
          ...(material === "gold" ? { fine: toPureGold(qty, bucket) } : {}),
          rateInr: rate, valueInr: rate == null ? null : Math.round(rate * qty),
        });
      }
    }
  }
  return out;
}

/** Certified stones held on the day: entered by then, and not yet issued or sold by then. */
export function packetsAsAt(db: DB, day: string) {
  const gone = new Map<string, string>(); // packet → the day it left
  for (const i of db.materialIssuances) for (const id of i.diamondPacketIds ?? []) if (!gone.has(id) || i.issuedAt < gone.get(id)!) gone.set(id, i.issuedAt);
  for (const s of db.diamondSales ?? []) if (s.packetId && (!gone.has(s.packetId) || s.createdAt < gone.get(s.packetId)!)) gone.set(s.packetId, s.createdAt);
  // Out on memo now (lib/memos.ts): held in stock until the day it went — after that it is
  // counted with the goods out on memo (memoOutAsAt), not here.
  const memoDay = new Map<string, string>();
  for (const m of db.memos ?? []) if (m.dir === "out") for (const l of m.lines) if (l.packetId) memoDay.set(l.packetId, m.at);
  let count = 0, ct = 0, valueInr = 0, unpriced = 0, undated = 0;
  for (const p of db.diamondPackets ?? []) {
    if (!by(p.createdAt, day)) continue;
    const left = gone.get(p.id);
    let held: boolean;
    if (left) held = !by(left, day);
    else if (p.status === "in_stock") held = true;
    else if (p.status === "memo") held = !by(memoDay.get(p.id) ?? p.createdAt, day);
    else { undated++; held = false; } // left stock by a way that keeps no date
    if (!held) continue;
    count++; ct += p.carat || 0;
    if (p.ratePerCaratInr != null) valueInr += p.ratePerCaratInr * (p.carat || 0); else unpriced++;
  }
  return { count, ct: r3(ct), valueInr: Math.round(valueInr), unpriced, undated };
}

/** Ready Stock pieces on the shelf on the day, at their cost (admin-only). */
export function readyStockAsAt(db: DB, day: string) {
  const soldAfter = new Map<string, number>(); // pieces taken off after the day (they were still there)
  const backAfter = new Map<string, number>(); // pieces put back after the day (they were not there)
  for (const o of db.orders) {
    if (o.readyStockItemId) {
      const q = o.readyStockQty || 1;
      if (!by(o.createdAt, day)) soldAfter.set(o.readyStockItemId, (soldAfter.get(o.readyStockItemId) || 0) + q);
      else if (o.readyStockBackAt && !by(o.readyStockBackAt, day)) backAfter.set(o.readyStockItemId, (backAfter.get(o.readyStockItemId) || 0) + q);
    }
    if (o.stockSale && !by(o.stockSale.soldAt, day)) soldAfter.set(o.stockSale.itemId, (soldAfter.get(o.stockSale.itemId) || 0) + o.stockSale.qty);
  }
  // Pieces out on memo (lib/memos.ts): off the shelf from the day they went, back on it the day they returned.
  for (const m of db.memos ?? []) {
    if (m.dir !== "out") continue;
    for (const l of m.lines) {
      if (!l.readyStockItemId) continue;
      if (!by(m.at, day)) soldAfter.set(l.readyStockItemId, (soldAfter.get(l.readyStockItemId) || 0) + l.qty);
      for (const e of m.events ?? []) if (!by(e.at, day)) for (const x of e.lines) if (x.lineId === l.id) backAfter.set(l.readyStockItemId, (backAfter.get(l.readyStockItemId) || 0) + x.qty);
    }
  }
  let pieces = 0, costUsd = 0, unpriced = 0, priceUsd = 0;
  for (const it of db.readyStock ?? []) {
    if (!by(it.createdAt, day)) continue;
    const q = Math.max(0, (it.quantity || 0) + (soldAfter.get(it.id) || 0) - (backAfter.get(it.id) || 0));
    if (!q) continue;
    pieces += q; priceUsd += (it.price || 0) * q;
    const c = stockCostOf(db, it);
    if (c == null) unpriced += q; else costUsd += c * q;
  }
  return { pieces, costUsd: r2(costUsd), priceUsd: r2(priceUsd), unpriced };
}

/* ── Profit & loss for the year — exactly Reports → Profit & Loss ────────── */
export function yearPnl(db: DB, fy: FiscalYear) {
  const inRange = (iso: string) => { const d = dayOf(iso); return d >= fy.from && d <= fy.to; };
  const orders = db.orders.filter(o => !o.deletedAt && recognisedSale(o) && inRange(saleDate(o)));
  const gross = profitReport(db, orders);
  const opex = operatingExpenses(db, inRange);
  const fx = exchangeDifferenceTotal(db, gross.rows.map(r => r.order));
  const supAll = supplierSalesProfit(db, inRange).rows;
  const counted = supAll.filter(r => r.profitUsd != null);
  const supProfitUsd = r2(supAll.reduce((t, r) => t + (r.profitUsd ?? 0), 0));
  const t = gross.totals;
  const netUsd = t.profitUsd !== null && opex.totalUsd !== null && fx.usd !== null ? r2(t.profitUsd + fx.usd + supProfitUsd - opex.totalUsd) : null;
  return {
    sold: orders.length,
    salesUsd: t.sellingUsd, salesInr: t.sellingInr, costInr: t.costInr, costUsd: t.costUsd,
    grossProfitUsd: t.profitUsd, grossMarginPct: t.marginPct, incomplete: t.incomplete,
    // Salespeople's commission — inside the cost above (lib/commission.ts).
    commissionUsd: t.commissionUsd, commissionInr: t.commissionInr,
    fxUsd: fx.usd, fxInr: fx.inr,
    supplierSales: { count: supAll.length, sellingInr: r2(counted.reduce((s, r) => s + r.sellingInr, 0)), profitInr: r2(counted.reduce((s, r) => s + (r.profitInr ?? 0), 0)), profitUsd: supProfitUsd, uncounted: supAll.length - counted.length },
    expenses: { usd: opex.totalUsd, inr: opex.totalInr, count: opex.count, byCategory: opex.byCategory, uncounted: opex.uncounted },
    netUsd,
    netMarginPct: netUsd !== null && t.sellingUsd > 0 ? Math.round((netUsd / t.sellingUsd) * 1000) / 10 : null,
  };
}

/* ── The Year book ──────────────────────────────────────────────────────── */
export interface PartyLine { id: string; name: string; companyId?: string }
export interface YearBook {
  v: number;
  key: string; from: string; to: string;
  builtAt: string;
  pnl: ReturnType<typeof yearPnl>;
  /** Our goods out on memo on the last day — still ours, beside the stock (absent in books closed before memos). */
  memoOut?: ReturnType<typeof memoOutAsAt>;
  /** USD: + they owe us, − we hold their money. */
  clients: (PartyLine & { net: number })[];
  /** ₹: + we owe them, − they hold ours. Gold: fine grams we owe in gold. */
  suppliers: (PartyLine & { net: number; goldFine: number })[];
  /** ₹ owed for labour; fine gold, carats and other materials they hold of ours. */
  factories: (PartyLine & { owed: number; fineGold: number; diamondCt: number; other: Record<string, number> })[];
  brokers: (PartyLine & { due: number })[];
  designers: (PartyLine & { due: number })[];
  lockers: (PartyLine & { currency: string; balance: number })[];
  /** Advances (upad) employees owe back, by currency. */
  employees: (PartyLine & { owed: Record<string, number> })[];
  stock: StockLine[];
  packets: ReturnType<typeof packetsAsAt>;
  readyStock: ReturnType<typeof readyStockAsAt>;
  /** Each kind of account checked as at today against its own card — and any difference. */
  checks: { area: string; ok: boolean; note: string }[];
}

const ccyOf = (l: Locker) => l.currency || "INR";
const nonZero = (n: number, eps = 0.005) => Math.abs(n) >= eps;

/**
 * Every balance as at the last day of the year. Reads only. Pass the whole
 * database — the caller makes sure every collection is loaded and fresh first
 * (ensureAllCollections + collectionsReady), or the figures would be short.
 */
export function buildYearBook(db: DB, fy: FiscalYear): YearBook {
  const day = fy.to;
  const today = dayOf(new Date());
  const checks: YearBook["checks"] = [];

  // Clients
  const clients: YearBook["clients"] = [];
  const clientOff: string[] = [];
  for (const c of db.clients) {
    const x = clientNetAsAt(db, c, day);
    if (nonZero(x.unexplained, 1)) clientOff.push(`${c.companyName} ${x.unexplained > 0 ? "+" : "−"}$${Math.abs(x.unexplained).toLocaleString("en-US")}`);
    if (!by(c.createdAt, day) && !nonZero(clientMoves(db, c, day).billed)) continue;
    if (nonZero(x.net)) clients.push({ id: c.id, name: c.companyName, ...(c.companyId ? { companyId: c.companyId } : {}), net: x.net });
  }
  checks.push({ area: "Clients", ok: clientOff.length === 0, note: clientOff.length
    ? `${clientOff.length} client${clientOff.length === 1 ? "'s card holds" : "s' cards hold"} money on no dated entry (an older correction): ${clientOff.slice(0, 4).join(" · ")}${clientOff.length > 4 ? " …" : ""}. It is counted as from before the year end — the year-end figure is today's card less everything dated since.`
    : "Every client's account agrees with its dated entries" });

  // Suppliers
  const suppliers: YearBook["suppliers"] = [];
  let supOff = 0;
  for (const s of db.suppliers) {
    const then = supplierAsAt(db, s, day);
    const now = supplierAsAt(db, s, today);
    const card = supplierAccount(db.purchases.filter(p => p.supplierId === s.id), (db.supplierReceipts ?? []).filter(r => r.supplierId === s.id), s,
      (db.supplierPayments ?? []).filter(x => x.supplierId === s.id), (db.supplierSales ?? []).filter(x => x.supplierId === s.id)).net;
    if (Math.abs(now.net - card) >= 1) supOff++;
    if (nonZero(then.net) || nonZero(then.goldFine, 0.0005)) suppliers.push({ id: s.id, name: s.name, net: then.net, goldFine: then.goldFine });
  }
  checks.push({ area: "Suppliers", ok: supOff === 0, note: supOff ? `${supOff} supplier${supOff === 1 ? "" : "s"}: today's figure from dated entries differs from the card` : "Every supplier agrees with its card" });

  // Factories
  const factories: YearBook["factories"] = [];
  let facOff = 0;
  for (const f of db.factories) {
    const then = factoryAsAt(db, f, day);
    const now = factoryAsAt(db, f, today);
    const card = factoryToday(db, f);
    if (!then.statementOk || Math.abs(now.owed - card.owed) >= 1 || Math.abs(now.fineGold - card.fineGold) >= 0.0015 || Math.abs(now.diamondCt - card.diamondCt) >= 0.0015) facOff++;
    if (nonZero(then.owed) || nonZero(then.fineGold, 0.0005) || nonZero(then.diamondCt, 0.0005) || Object.keys(then.other).length) {
      factories.push({ id: f.id, name: f.name, owed: then.owed, fineGold: then.fineGold, diamondCt: then.diamondCt, other: then.other });
    }
  }
  checks.push({ area: "Factories", ok: facOff === 0, note: facOff ? `${facOff} factor${facOff === 1 ? "y's" : "ies'"} statement differs from its card` : "Every factory's statement agrees with its card" });

  // Brokers and designers
  const cut = { ...db, ...cutForParties(db, day) } as DB;
  const brokers: YearBook["brokers"] = [];
  for (const b of db.brokers ?? []) {
    const a = brokerAccount(cut, openingAsAt(b, day) as Broker);
    if (nonZero(a.due)) brokers.push({ id: b.id, name: b.name, due: a.due });
  }
  const designers: YearBook["designers"] = [];
  for (const d of db.designers ?? []) {
    if (d.kind === "inhouse") continue; // paid as salary — no account
    const a = designerAccount(cut, openingAsAt(d, day) as Designer);
    const due = r2(a.due - a.advance);
    if (nonZero(due)) designers.push({ id: d.id, name: d.name, due });
  }

  // Employees' advances (upad) — money they owe back.
  const employees: YearBook["employees"] = [];
  for (const u of db.users) {
    if (u.role !== "employee" && u.role !== "admin") continue;
    const owed = Object.fromEntries([...advanceOwed(db, u, day)].filter(([, v]) => Math.abs(v) >= 0.005));
    if (Object.keys(owed).length) employees.push({ id: u.id, name: u.name, owed });
  }

  // Lockers
  const lockers: YearBook["lockers"] = [];
  for (const l of db.lockers) {
    if (!by(l.createdAt, day)) continue;
    const bal = lockerBalance(l, (db.lockerTransactions ?? []).filter(t => t.lockerId === l.id && by(t.createdAt, day)));
    lockers.push({ id: l.id, name: l.name, currency: ccyOf(l), balance: bal });
  }

  return {
    v: YEAR_BOOK_VERSION, key: fy.key, from: fy.from, to: fy.to, builtAt: new Date().toISOString(),
    pnl: yearPnl(db, fy),
    clients: clients.sort((a, b) => b.net - a.net),
    suppliers: suppliers.sort((a, b) => b.net - a.net),
    factories: factories.sort((a, b) => b.owed - a.owed),
    brokers, designers, lockers, employees,
    stock: stockAsAt(db, day),
    packets: packetsAsAt(db, day),
    memoOut: memoOutAsAt(db, day),
    readyStock: readyStockAsAt(db, day),
    checks,
  };
}

/* ── Before closing: what a careful accountant looks at first ────────────── */
export interface CloseCheck { level: "stop" | "warn" | "ok"; title: string; detail: string; link?: string }

/**
 * The standard pre-close review. "stop" means the year should not be closed
 * until it is fixed (it would freeze a wrong figure); "warn" is worth a look
 * but carries over safely into the new year.
 */
export function closeChecks(db: DB, fy: FiscalYear, book: YearBook): CloseCheck[] {
  const out: CloseCheck[] = [];
  const day = fy.to;
  const today = dayOf(new Date());
  if (today <= day) out.push({ level: "stop", title: "The year has not ended yet", detail: `It ends on ${day}. A year can be closed from the day after.` });

  // Stock below zero on the last day — a count that went wrong (Zoho refuses to lock with negative stock too).
  const neg = book.stock.filter(s => s.qty < -0.0005);
  if (neg.length) out.push({ level: "stop", title: `${neg.length} stock lot${neg.length === 1 ? "" : "s"} below zero on ${day}`, detail: neg.slice(0, 6).map(s => `${s.material === "gold" ? "Gold" : s.material === "diamond" ? "Diamond" : s.material} ${s.bucket}: ${s.qty} ${s.unit}`).join(" · ") + (neg.length > 6 ? " …" : "") + " — recount or correct these before closing.", link: "/stock" });

  // Accounts that do not agree with their own card today.
  for (const c of book.checks) if (!c.ok) out.push({ level: c.area === "Clients" ? "warn" : "stop", title: `${c.area}: figures to look at`, detail: c.note });

  // Locker balances below zero on the last day.
  const negL = book.lockers.filter(l => l.balance < -0.005);
  if (negL.length) out.push({ level: "warn", title: `${negL.length} account${negL.length === 1 ? "" : "s"} below zero on ${day}`, detail: negL.map(l => `${l.name}: ${l.balance.toLocaleString()} ${l.currency}`).join(" · ") + " — usually an entry missing or in the wrong account.", link: "/payments" });

  // Profit that could not be worked out in full.
  if (book.pnl.incomplete > 0) out.push({ level: "warn", title: `${book.pnl.incomplete} sale${book.pnl.incomplete === 1 ? "" : "s"} with part of the cost missing`, detail: "Their profit is counted on the cost that is known. Finish their Final Approval or costs to make the year's profit exact.", link: "/reports" });
  if (book.pnl.expenses.uncounted.length) out.push({ level: "warn", title: "Expenses in a currency with no rate", detail: book.pnl.expenses.uncounted.map(u => `${u.count} in ${u.currency}`).join(" · ") + " — add the rate in Settings → Exchange rates, or they stay out of the year's profit.", link: "/settings?tab=pricing" });

  // Work still open — carried into the new year as it is (standard; nothing to do).
  const openOrders = db.orders.filter(o => !o.deletedAt && by(o.createdAt, day) && !["Dispatched", "Delivered", "Rejected"].includes(o.status)).length;
  if (openOrders) out.push({ level: "ok", title: `${openOrders} order${openOrders === 1 ? "" : "s"} from the year still in the works`, detail: "They carry on into the new year as they are — their sale falls in the year they are dispatched." });
  const pendingReturns = db.orders.reduce((n, o) => n + (o.returns ?? []).filter(r => r.status === "coming" && by(r.at, day)).length, 0);
  if (pendingReturns) out.push({ level: "warn", title: `${pendingReturns} return${pendingReturns === 1 ? "" : "s"} still on the way back`, detail: "Their credit note is in the year; the pieces join Ready Stock when they arrive." });
  if (book.packets.undated) out.push({ level: "warn", title: `${book.packets.undated} certified stone${book.packets.undated === 1 ? "" : "s"} left stock with no date kept`, detail: "Counted as gone before the year ended." });
  if (book.readyStock.unpriced) out.push({ level: "warn", title: `${book.readyStock.unpriced} Ready Stock piece${book.readyStock.unpriced === 1 ? "" : "s"} with no cost`, detail: "Counted, not valued, in the closing stock.", link: "/ready-stock" });
  return out;
}

/** The parts the Year book is stored in (one admin record each). */
export function bookParts(book: YearBook): Record<string, unknown> {
  const { clients, suppliers, factories, brokers, designers, lockers, employees, stock, ...head } = book;
  return { head, parties: { clients, suppliers, factories, brokers, designers, lockers, employees }, stock: { stock } };
}
export function bookFromParts(parts: Record<string, unknown>): YearBook | null {
  const head = parts.head as Partial<YearBook> | undefined;
  if (!head) return null;
  const p = (parts.parties ?? {}) as Partial<YearBook>;
  const s = (parts.stock ?? {}) as Partial<YearBook>;
  return { ...(head as YearBook), clients: p.clients ?? [], suppliers: p.suppliers ?? [], factories: p.factories ?? [], brokers: p.brokers ?? [], designers: p.designers ?? [], lockers: p.lockers ?? [], employees: p.employees ?? [], stock: s.stock ?? [] };
}
