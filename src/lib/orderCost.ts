import { orderTotal, type DB, type Order, type Purchase } from "@/lib/db";

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

export function orderCost(db: DB, order: Order): OrderCost {
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
  const rate = db.settings.usdToInr ?? 0;
  if (!(rate > 0)) return { cost, sellingUsd, costUsd: null, profitUsd: null, marginPct: null };
  const costUsd = r2(cost.totalInr / rate);
  const profitUsd = r2(sellingUsd - costUsd);
  const marginPct = sellingUsd > 0 ? Math.round((profitUsd / sellingUsd) * 1000) / 10 : null;
  return { cost, sellingUsd, costUsd, profitUsd, marginPct };
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

function summarise(key: string, rows: ProfitRow[], rate: number): ProfitGroup {
  const sellingUsd = r2(rows.reduce((s, r) => s + r.sellingUsd, 0));
  const costInr = r2(rows.reduce((s, r) => s + r.costInr, 0));
  const costUsd = rate > 0 ? r2(costInr / rate) : null;
  const profitUsd = costUsd === null ? null : r2(sellingUsd - costUsd);
  const marginPct = profitUsd === null || sellingUsd <= 0 ? null : Math.round((profitUsd / sellingUsd) * 1000) / 10;
  return { key, count: rows.length, sellingUsd, costInr, costUsd, profitUsd, marginPct, incomplete: rows.filter(r => !r.complete).length };
}

function groupBy(rows: ProfitRow[], keyOf: (r: ProfitRow) => string, rate: number): ProfitGroup[] {
  const map = new Map<string, ProfitRow[]>();
  for (const r of rows) {
    const k = keyOf(r);
    const list = map.get(k) ?? [];
    list.push(r);
    map.set(k, list);
  }
  return [...map.entries()].map(([k, rs]) => summarise(k, rs, rate));
}

/**
 * Profit for a set of orders, totalled and broken down by client, by month
 * and by kind of piece. Group totals are summed in rupees and converted once,
 * rather than adding up figures already rounded to the cent.
 */
export function profitReport(db: DB, orders: Order[]) {
  const rate = db.settings.usdToInr ?? 0;
  const rows: ProfitRow[] = orders.map(o => {
    const p = orderProfit(db, o);
    return {
      order: o, sellingUsd: p.sellingUsd, costInr: p.cost.totalInr, costUsd: p.costUsd,
      profitUsd: p.profitUsd, marginPct: p.marginPct, complete: p.cost.complete, missing: p.cost.missing,
    };
  });
  const clientName = (id: string) => db.clients.find(c => c.id === id)?.companyName ?? "Unknown";
  const monthOf = (iso: string) => {
    const d = new Date(iso);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  };
  const bySelling = (a: ProfitGroup, b: ProfitGroup) => b.sellingUsd - a.sellingUsd;
  return {
    rate,
    rows: [...rows].sort((a, b) => +new Date(b.order.createdAt) - +new Date(a.order.createdAt)),
    totals: summarise("All", rows, rate),
    byClient: groupBy(rows, r => clientName(r.order.clientId), rate).sort(bySelling),
    // Newest month first, the way every other ledger in the app reads.
    byMonth: groupBy(rows, r => monthOf(r.order.createdAt), rate).sort((a, b) => b.key.localeCompare(a.key)),
    byType: groupBy(rows, r => r.order.jewelleryType, rate).sort(bySelling),
    /** Sold for less than they cost — the ones worth looking at first. */
    losses: rows.filter(r => r.profitUsd !== null && r.profitUsd < 0).sort((a, b) => a.profitUsd! - b.profitUsd!),
  };
}
