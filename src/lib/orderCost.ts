import { orderTotal, dayOf, type DB, type Order, type Purchase } from "@/lib/db";

const fmtRate = (n: number, unit: string) =>
  `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 2 })}/${unit}`;

/**
 * What an order cost to make, against what it sold for. ADMIN ONLY.
 *
 * Everything here is worked out from records staff already keep — the bills
 * for material bought for the order, the certified stones issued to it, and
 * the factory's charge at Final Approval. Nothing is stored, so there is
 * nothing to migrate, it covers old orders as well as new ones, and correcting
 * a purchase or a labour entry corrects the profit with it.
 *
 * Where a piece of the cost is not known, it is listed as missing rather than
 * counted as zero. A profit worked out with the gold left out looks better
 * than it is, and is worse than no figure at all.
 */

/**
 * The day an order counts as sold: the day it left.
 *
 * Revenue is recognised when the goods pass to the buyer, and for a piece
 * shipped to a client that is the day the parcel goes. So this is both the day
 * the sale is converted at and the period it is reported in. An order not yet
 * dispatched has not been sold; for its own page, the day it was placed stands
 * in until it is.
 */
export function saleDate(o: Order): string {
  if (o.dispatchedAt) return o.dispatchedAt;
  const step = (o.timeline ?? []).find(t => t.step === "Dispatch" && t.status === "done");
  return step?.date ?? o.createdAt;
}

/** Revenue that has actually been earned: shipped client work with a price. */
export function recognisedSale(o: Order): boolean {
  return !o.forReadyStock && o.status !== "Rejected" && o.amount > 0
    && (o.status === "Dispatched" || o.status === "Delivered");
}

export interface FxRate {
  rate: number;
  /** "dated" — the rate in force that day. "earliest" — the day is before the
   *  first rate on file, so the first one stands in. "single" — no dated rates
   *  at all, only the one flat rate, applied to every order alike. */
  basis: "dated" | "earliest" | "single";
  from?: string;
}

/**
 * ₹ to the $ on a given day — the transaction-date rate, the way a sale in a
 * foreign currency is meant to be booked. Each dated rate holds from its date
 * until the next. Null when there is no rate at all, and then nothing is
 * converted rather than converted at a guess.
 */
export function rateOn(db: DB, iso: string): FxRate | null {
  const table = [...(db.settings.fxRates ?? [])]
    .filter(r => r.rate > 0 && !!r.from)
    .sort((a, b) => a.from.localeCompare(b.from));
  if (table.length) {
    const day = dayOf(iso);
    let pick: { from: string; rate: number } | null = null;
    for (const r of table) if (r.from <= day) pick = r;
    return pick
      ? { rate: pick.rate, basis: "dated", from: pick.from }
      : { rate: table[0].rate, basis: "earliest", from: table[0].from };
  }
  const single = db.settings.usdToInr ?? 0;
  return single > 0 ? { rate: single, basis: "single" } : null;
}

export interface CostLine {
  label: string;
  amountInr: number;
}

export interface MissingCost {
  label: string;
  /** Why it cannot be valued yet. */
  reason: string;
}

export interface OrderCost {
  gold: CostLine[];
  diamond: CostLine[];
  labour: CostLine[];
  other: CostLine[];
  totalInr: number;
  missing: MissingCost[];
  /** True only when no part of the cost is unknown. */
  complete: boolean;
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const qtyOf = (p: Purchase) => (p.material === "gold" ? p.gold?.weightGrams ?? 0 : p.diamond?.carat ?? 0);

/**
 * What a gram (or carat) of pooled stock cost, as it stood on a given day.
 *
 * Stock is one pool per purity or shape: 50g of 14K bought at three different
 * prices, and 3.9g of it sent out to an order. Which gram went is unknowable,
 * so the pool is valued the way the trade values it — at its weighted average.
 *
 * A running average, not a plain one. Every priced arrival moves it by its
 * share of what is then in the pool; issues out of the pool do not move it at
 * all. So a cheap old lot that has already been used up stops dragging the
 * price down, which a simple average of every purchase ever made would not.
 *
 * Priced arrivals are the ones the stock ledger itself prices: a purchase at
 * its own bill's rate, and opening stock at the value it was entered with.
 * Material bought for one particular order is left out — it goes straight to
 * that order and never sits in the pool. An arrival with no price (a manual
 * top-up) adds to the pool at the current average.
 *
 * Null when nothing in the pool has ever had a price.
 */
export function stockAverageRate(db: DB, material: "gold" | "diamond", bucket: string, at: string): number | null {
  const purchases = new Map((db.purchases ?? []).map(p => [p.id, p]));
  const cutoff = +new Date(at);
  const moves = (db.stockMovements ?? [])
    .filter(m => m.material === material && m.purityOrQuality === bucket && +new Date(m.createdAt) <= cutoff)
    .sort((a, b) => +new Date(a.createdAt) - +new Date(b.createdAt));

  let bal = 0;
  let avg: number | null = null;
  for (const m of moves) {
    const q = Math.abs(m.quantity);
    if (m.type === "order_direct_use") continue;
    const incoming = m.type === "purchase_in" || (m.type === "adjustment" && m.quantity > 0);
    if (!incoming) { bal = Math.max(0, bal - q); continue; }

    let rate: number | null = null;
    if (m.refType === "purchase" && m.refId) {
      const p = purchases.get(m.refId);
      if (p?.orderId) continue; // bought for one order, never in the pool
      const pq = p ? qtyOf(p) : 0;
      if (p && pq > 0) rate = p.totalInr / pq;
    } else if (m.refType === "opening" && m.valueInr != null && q > 0) {
      rate = m.valueInr / q;
    }

    if (rate === null) { bal += q; continue; } // unpriced: joins at the current average
    avg = avg === null || bal <= 0 ? rate : (avg * bal + rate * q) / (bal + q);
    bal += q;
  }
  return avg === null ? null : r2(avg);
}

export function orderCost(db: DB, order: Order, depth = 0): OrderCost {
  const out: OrderCost = { gold: [], diamond: [], labour: [], other: [], totalInr: 0, missing: [], complete: true };
  const issuances = (db.materialIssuances ?? []).filter(i => i.orderId === order.id);
  const purchases = db.purchases ?? [];
  // Each bill is counted once, however many routes lead to it — a purchase
  // made for an order is usually also the source of the issuance that sent it
  // to the factory, and counting both would double the material cost.
  const counted = new Set<string>();

  for (const mi of issuances) {
    const unit = mi.material === "gold" ? "g" : "ct";
    const bucket = mi.material === "gold" ? out.gold : out.diamond;

    if (mi.material === "diamond" && mi.diamondKind === "certified") {
      // A certified stone carries its own cost. Valued stone by stone, and only
      // the ones that stayed in the piece — a stone sent back is in stock again.
      for (const pid of mi.diamondPacketIds ?? []) {
        const pk = (db.diamondPackets ?? []).find(x => x.id === pid);
        if (!pk) continue;
        if (pk.purchaseId) counted.add(pk.purchaseId);
        if (mi.finishDisposition === "returned") continue;
        if (!pk.ratePerCaratInr) {
          out.missing.push({ label: `${pk.shape} ${pk.carat}ct (${pk.certificateNumber})`, reason: "no purchase rate recorded on the stone" });
          continue;
        }
        bucket.push({ label: `${pk.shape} ${pk.carat}ct certified · ${pk.certificateNumber}`, amountInr: r2(pk.ratePerCaratInr * pk.carat) });
      }
      if (mi.sourcePurchaseId) counted.add(mi.sourcePurchaseId);
      continue;
    }

    // What actually went into the piece: loose stones sent back to stock at
    // Final Approval are not this order's cost.
    const returned = mi.material === "diamond" ? mi.finishReturnedCt ?? 0 : 0;
    const used = Math.max(0, r2(mi.quantityIssued - returned));
    if (used <= 0) continue;

    if (mi.source === "purchase" && mi.sourcePurchaseId) {
      const p = purchases.find(x => x.id === mi.sourcePurchaseId);
      counted.add(mi.sourcePurchaseId);
      const bought = p ? qtyOf(p) : 0;
      if (!p || bought <= 0) {
        out.missing.push({ label: `${used}${unit} ${mi.purityOrQuality}`, reason: "the purchase it came from is no longer on file" });
        continue;
      }
      // The bill's own rate, applied to what was used — a bill for more than
      // the piece took is not all this order's cost.
      bucket.push({
        label: `${used}${unit} ${mi.purityOrQuality} · bought for this order${p.invoiceNumber ? ` (bill ${p.invoiceNumber})` : ""}`,
        amountInr: r2((p.totalInr / bought) * used),
      });
      continue;
    }

    // Issued out of our own pooled stock, or out of gold already held at the
    // factory — which is our gold too, sent there earlier from the same pool.
    // Valued at the pool's average on the day it went out. If our stock of
    // that purity has never had a price on it, it is reported, not guessed.
    const avg = stockAverageRate(db, mi.material, mi.purityOrQuality, mi.issuedAt)
      ?? stockAverageRate(db, mi.material, mi.purityOrQuality, new Date().toISOString());
    const where = mi.source === "factoryPool" ? "from gold held at the factory" : "from stock";
    if (avg === null) {
      out.missing.push({
        label: `${used}${unit} ${mi.purityOrQuality}`,
        reason: `${where} — no ${mi.purityOrQuality} has ever been bought with a price to value it by`,
      });
      continue;
    }
    bucket.push({
      label: `${used}${unit} ${mi.purityOrQuality} · ${where}, at average cost ${fmtRate(avg, unit)}`,
      amountInr: r2(avg * used),
    });
  }

  // Material bought for this order that no issuance accounts for — bought and
  // paid for, whether or not it has gone to the factory yet.
  for (const p of purchases) {
    if (p.orderId !== order.id || counted.has(p.id)) continue;
    counted.add(p.id);
    const q = qtyOf(p);
    const unit = p.material === "gold" ? "g" : "ct";
    const what = p.material === "gold" ? p.gold?.purity ?? "" : p.diamond?.shape ?? "";
    (p.material === "gold" ? out.gold : out.diamond).push({
      label: `${q}${unit} ${what} · bought for this order${p.invoiceNumber ? ` (bill ${p.invoiceNumber})` : ""}`,
      amountInr: r2(p.totalInr),
    });
  }

  // Sold from ready stock: the piece was made earlier, on its own stock-build
  // order, and every rupee it cost was spent there. This order has no material
  // or factory records of its own, so without this it reads as costing nothing
  // and selling at a hundred per cent profit.
  if (order.materialSourcing === "readyStock" && order.readyStockItemId && depth === 0) {
    const item = (db.readyStock ?? []).find(i => i.id === order.readyStockItemId);
    const sold = order.quantity || 1;
    const name = item ? (item.sku ? `${item.sku} ${item.name}` : item.name) : "the stock piece";
    const build = item && db.orders.find(o => o.readyStockCreatedId === item.id && o.id !== order.id);
    const bc = build ? orderCost(db, build, depth + 1) : null;
    const rate = rateOn(db, saleDate(order))?.rate ?? 0;
    if (build && bc && bc.totalInr > 0) {
      // A build can make several identical pieces; this order carries its share.
      const pieces = build.quantity || 1;
      out.other.push({
        label: `${name} — made on ${build.orderNumber}${pieces > 1 ? `, ${sold} of ${pieces} pieces` : ""}`,
        amountInr: r2((bc.totalInr / pieces) * sold),
      });
      for (const m of bc.missing) out.missing.push({ label: m.label, reason: `on ${build.orderNumber}: ${m.reason}` });
    } else if (item?.cost != null && item.cost > 0) {
      // The cost typed on the stock item, in dollars like its price.
      if (rate > 0) {
        out.other.push({ label: `${name} — cost entered on the stock item ($${item.cost}${sold > 1 ? ` × ${sold}` : ""})`, amountInr: r2(item.cost * sold * rate) });
      } else {
        out.missing.push({ label: name, reason: "its cost is entered in dollars — set the exchange rate to count it" });
      }
    } else {
      out.missing.push({ label: name, reason: "sold from ready stock, and the piece has no cost recorded on its build or on the stock item" });
    }
  }

  // Costs incurred for this order, often together with others in the same
  // parcel — freight and insurance, most of all. A shared cost is split by
  // selling value, the usual basis for freight-out: a $3,000 ring carries more
  // of a parcel's insurance than a $300 band in the same box. An expense paid
  // in dollars is converted at the rate on the day it was paid.
  for (const e of db.expenses ?? []) {
    if (!e.orderIds?.includes(order.id)) continue;
    const peers = e.orderIds.map(id => db.orders.find(o => o.id === id)).filter((o): o is Order => !!o);
    const value = (o: Order) => Math.max(0, orderTotal(o));
    const pool = peers.reduce((s, o) => s + value(o), 0);
    const share = pool > 0 ? value(order) / pool : 1 / Math.max(peers.length, 1);
    let inr: number | null = e.amount;
    if (e.currency === "USD") {
      const fx = rateOn(db, e.createdAt);
      inr = fx ? e.amount * fx.rate : null;
    }
    if (inr === null) {
      out.missing.push({ label: e.title, reason: "paid in dollars — set the exchange rate to count it" });
      continue;
    }
    out.other.push({
      label: peers.length > 1 ? `${e.title} — ${Math.round(share * 100)}% of a ${peers.length}-order parcel` : e.title,
      amountInr: r2(inr * share),
    });
  }

  // The factory's bill — making, CAD, diamond setting, any metal the factory
  // supplied itself — exactly as it stands on the factory's ledger.
  for (const mi of issuances) {
    const charge = mi.makingCharges?.amountInr ?? 0;
    if (charge <= 0) continue;
    const f = db.factories.find(x => x.id === mi.factoryId);
    out.labour.push({ label: `${f?.name ?? "Factory"} — making & labour`, amountInr: r2(charge) });
  }

  const all = [...out.gold, ...out.diamond, ...out.labour, ...out.other];
  out.totalInr = r2(all.reduce((s, l) => s + l.amountInr, 0));
  out.complete = out.missing.length === 0;
  return out;
}

export interface OrderProfit {
  cost: OrderCost;
  /** The rate the cost was converted at, and why that one. */
  fx: FxRate | null;
  sellingUsd: number;
  /** Null when there is no exchange rate to convert the cost with. */
  costUsd: number | null;
  profitUsd: number | null;
  marginPct: number | null;
}

/**
 * Selling price against cost. Costs are kept in rupees and orders are sold in
 * dollars, so without a rate there is no honest profit to state — the figures
 * come back null rather than a number made up with a guessed rate.
 */
export function orderProfit(db: DB, order: Order): OrderProfit {
  const cost = orderCost(db, order);
  const sellingUsd = r2(orderTotal(order));
  // Converted at the rate on the day it was sold, not today's — an order
  // shipped in March is worth what the dollar fetched in March.
  const fx = rateOn(db, saleDate(order));
  if (!fx) return { cost, fx, sellingUsd, costUsd: null, profitUsd: null, marginPct: null };
  const costUsd = r2(cost.totalInr / fx.rate);
  const profitUsd = r2(sellingUsd - costUsd);
  const marginPct = sellingUsd > 0 ? Math.round((profitUsd / sellingUsd) * 1000) / 10 : null;
  return { cost, fx, sellingUsd, costUsd, profitUsd, marginPct };
}

/* ────────────────────────────────────────────────────────────────────────────
 * Profit across many orders — the report, and the admin's spreadsheet.
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * Finished client work: the factory has reported back, so its charge is in and
 * the cost is as known as it will get. An order still being made has no
 * factory charge yet, and its profit would read high — counting those would
 * flatter every total in the report.
 */
export function inProfitReport(o: Order): boolean {
  return !o.forReadyStock && o.status !== "Rejected" && o.amount > 0
    && (o.status === "Ready" || o.status === "Dispatched" || o.status === "Delivered");
}

export interface ProfitRow {
  order: Order;
  sellingUsd: number;
  costInr: number;
  costUsd: number | null;
  profitUsd: number | null;
  marginPct: number | null;
  complete: boolean;
  missing: MissingCost[];
  fx: FxRate | null;
}

export interface ProfitGroup {
  key: string;
  count: number;
  sellingUsd: number;
  costInr: number;
  costUsd: number | null;
  profitUsd: number | null;
  marginPct: number | null;
  /** Orders in the group whose cost is not fully known. */
  incomplete: number;
}

function summarise(key: string, rows: ProfitRow[]): ProfitGroup {
  const sellingUsd = r2(rows.reduce((s, r) => s + r.sellingUsd, 0));
  const costInr = r2(rows.reduce((s, r) => s + r.costInr, 0));
  // Each order was converted at the rate on its own sale day, so the dollars
  // are added up as they stand — a group cannot be converted again at one
  // rate without undoing that. With any order unconvertible, so is the group.
  const costUsd = rows.length && rows.every(r => r.costUsd !== null)
    ? r2(rows.reduce((s, r) => s + (r.costUsd as number), 0))
    : null;
  const profitUsd = costUsd === null ? null : r2(sellingUsd - costUsd);
  const marginPct = profitUsd === null || sellingUsd <= 0 ? null : Math.round((profitUsd / sellingUsd) * 1000) / 10;
  return { key, count: rows.length, sellingUsd, costInr, costUsd, profitUsd, marginPct, incomplete: rows.filter(r => !r.complete).length };
}

function groupBy(rows: ProfitRow[], keyOf: (r: ProfitRow) => string): ProfitGroup[] {
  const map = new Map<string, ProfitRow[]>();
  for (const r of rows) {
    const k = keyOf(r);
    const list = map.get(k) ?? [];
    list.push(r);
    map.set(k, list);
  }
  return [...map.entries()].map(([k, rs]) => summarise(k, rs));
}

/**
 * Gross profit for a set of orders, totalled and broken down by client, by
 * month and by kind of piece. Months are the month each order was SOLD in —
 * dispatched — which is the period its revenue belongs to.
 */
export function profitReport(db: DB, orders: Order[]) {
  const rows: ProfitRow[] = orders.map(o => {
    const p = orderProfit(db, o);
    return {
      order: o, sellingUsd: p.sellingUsd, costInr: p.cost.totalInr, costUsd: p.costUsd,
      profitUsd: p.profitUsd, marginPct: p.marginPct, complete: p.cost.complete, missing: p.cost.missing,
      fx: p.fx,
    };
  });
  const clientName = (id: string) => db.clients.find(c => c.id === id)?.companyName ?? "Unknown";
  const monthOf = (iso: string) => {
    const d = new Date(iso);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  };
  const bySelling = (a: ProfitGroup, b: ProfitGroup) => b.sellingUsd - a.sellingUsd;
  return {
    /** Any order converted at a stand-in rate rather than its own day's. */
    approximateRates: rows.filter(r => r.fx && r.fx.basis !== "dated").length,
    unconverted: rows.filter(r => !r.fx).length,
    rows: [...rows].sort((a, b) => +new Date(saleDate(b.order)) - +new Date(saleDate(a.order))),
    totals: summarise("All", rows),
    byClient: groupBy(rows, r => clientName(r.order.clientId)).sort(bySelling),
    // Newest month first, the way every other ledger in the app reads.
    byMonth: groupBy(rows, r => monthOf(saleDate(r.order))).sort((a, b) => b.key.localeCompare(a.key)),
    byType: groupBy(rows, r => r.order.jewelleryType).sort(bySelling),
    /** Sold for less than they cost — the ones worth looking at first. */
    losses: rows.filter(r => r.profitUsd !== null && r.profitUsd < 0).sort((a, b) => a.profitUsd! - b.profitUsd!),
  };
}

/**
 * The running costs of the business over a period — salaries, rent, travel,
 * everything not incurred for a particular order. Gross profit less these is
 * what the business actually made.
 *
 * An expense tied to orders is already inside those orders' cost, so it is
 * left out here; counting it twice would understate the profit by exactly the
 * freight bill. Rupee expenses are converted at the rate on the day they were
 * paid, the same way the sales were.
 */
export function operatingExpenses(db: DB, inPeriod: (iso: string) => boolean) {
  const rows = (db.expenses ?? []).filter(e => !(e.orderIds && e.orderIds.length) && inPeriod(e.createdAt));
  let usd = 0;
  let inr = 0;
  let convertible = true;
  const byCategory = new Map<string, number>();
  for (const e of rows) {
    let asUsd: number | null;
    if (e.currency === "USD") {
      asUsd = e.amount;
      const fx = rateOn(db, e.createdAt);
      inr += fx ? e.amount * fx.rate : 0;
    } else {
      inr += e.amount;
      const fx = rateOn(db, e.createdAt);
      asUsd = fx ? e.amount / fx.rate : null;
    }
    if (asUsd === null) { convertible = false; continue; }
    usd += asUsd;
    byCategory.set(e.category, (byCategory.get(e.category) ?? 0) + asUsd);
  }
  return {
    count: rows.length,
    totalInr: r2(inr),
    totalUsd: convertible ? r2(usd) : null,
    byCategory: [...byCategory.entries()].map(([k, v]) => ({ category: k, usd: r2(v) })).sort((a, b) => b.usd - a.usd),
  };
}
