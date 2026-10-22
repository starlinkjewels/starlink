import { brokerageWePay, landedInr } from "./brokers";
import { ccy, ccyOrder, inrPerUnit, roundCcy, sumByCcy, type CurrencyCode } from "@/lib/currency";
import { orderTotal, returnedCredit, returnedQty, dayOf, fxTableOf, stockCostOf, toPureGold, pureFromPurity, isDiamondOnlyOrder, type DB, type Expense, type MaterialIssuance, type Order, type Purchase } from "@/lib/db";
import { freightRecorded } from "@/lib/dispatch";
import { purchaseQty, materialUnit, materialName, isOtherMaterial } from "@/lib/materials";
import { companyOf } from "@/lib/companies";
import { deriveStockBalances, estimatedPureGoldNeeded } from "./manufacturing";
import { metalHasKarats } from "./metals";

/** In one company's books — or every company's when none is given. */
const inCo = (r: { companyId?: string }, companyId?: string) => !companyId || companyId === "all" || companyOf(r) === companyId;

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
  const fx = fxTableOf(db);
  const table = [...fx.rates]
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
  const single = fx.flat ?? 0;
  return single > 0 ? { rate: single, basis: "single" } : null;
}

/**
 * Rupees for one unit of any currency on a day. Dollars from the admin's own
 * profit rates (above) when there are any; every other currency — and dollars
 * when those can't be read — from Settings → Exchange rates. Rupees are 1.
 * Undefined when nothing is on file: then nothing is converted at a guess.
 */
export function inrOn(db: DB, code: string | undefined, iso: string): number | undefined {
  const c = ccy(code);
  if (c === "INR") return 1;
  if (c === "USD") { const r = rateOn(db, iso); if (r) return r.rate; }
  return inrPerUnit(db.settings.currencyRates, c, iso);
}

export interface CostLine {
  label: string;
  amountInr: number;
  /** Not yet on record: the order's own estimate, until the real thing is. */
  estimate?: boolean;
}

export interface MissingCost {
  label: string;
  /** Why it cannot be valued yet. */
  reason: string;
}

export interface OrderCost {
  gold: CostLine[];
  diamond: CostLine[];
  /** Every other material in the piece — platinum, gemstones, findings (lib/materials.ts). */
  materials: CostLine[];
  labour: CostLine[];
  other: CostLine[];
  totalInr: number;
  /** What the pieces themselves cost — the total less freight and other order expenses. */
  pieceInr: number;
  missing: MissingCost[];
  /** True only when no part of the cost is unknown. */
  complete: boolean;
  /** Part of it is still an estimate (the gold, before any has gone out). */
  estimated?: boolean;
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const qtyOf = (p: Purchase) => purchaseQty(p);

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
export function stockAverageRate(db: DB, material: string, bucket: string, at: string, companyId?: string): number | null {
  // Each company holds its own stock, so its pool is valued from its own
  // arrivals; with nothing priced of its own yet, every company's together.
  if (companyId && companyId !== "all") return poolAverage(db, material, bucket, at, companyId) ?? poolAverage(db, material, bucket, at);
  return poolAverage(db, material, bucket, at);
}

function poolAverage(db: DB, material: string, bucket: string, at: string, companyId?: string): number | null {
  const purchases = new Map((db.purchases ?? []).map(p => [p.id, p]));
  const cutoff = +new Date(at);
  const moves = (db.stockMovements ?? [])
    .filter(m => m.material === material && m.purityOrQuality === bucket && +new Date(m.createdAt) <= cutoff
      // One company's pool; or all together, where a move between our companies is no arrival at all.
      && (companyId ? companyOf(m) === companyId : m.refType !== "transfer"))
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
      // What it cost us: the bill plus any brokerage we pay on it.
      if (p && pq > 0) rate = landedInr(p) / pq;
    } else if ((m.refType === "opening" || m.refType === "transfer") && m.valueInr != null && q > 0) {
      // Opening stock at the value it was entered with; stock moved in from
      // another of our companies at what it cost there.
      rate = m.valueInr / q;
    }

    if (rate === null) { bal += q; continue; } // unpriced: joins at the current average
    avg = avg === null || bal <= 0 ? rate : (avg * bal + rate * q) / (bal + q);
    bal += q;
  }
  return avg === null ? null : r2(avg);
}

/**
 * What a gram of FINE (24KT) gold has cost us, as it stood on a given day.
 *
 * Gold is bought in one purity (bars of 24K, or 22K, …) and comes back from the
 * factory in another (a 14K ring at 595‰), and the factory keeps our gold as a
 * fine-gold account between the two. So gold is valued the way that account is
 * kept: by its fine content. Every gold purchase with a price, whatever its
 * karat, adds its fine grams and its rupees; so does opening gold entered with
 * a value. The rate is rupees over fine grams — a weighted average.
 *
 * Only lots on or before the day count, so a piece is valued at what gold had
 * cost by the time it was made. If nothing had been bought by then, every lot
 * on file is used instead, and the basis says so. Null when no gold has ever
 * been bought with a price — then gold is reported as missing, never guessed.
 */
export function fineGoldRate(db: DB, at: string, companyId?: string): { rate: number; basis: string } | null {
  // One company's gold lots; with none of its own yet, every company's together.
  if (companyId && companyId !== "all") {
    const own = fineGoldLots(db, at, companyId);
    if (own) return own;
    const all = fineGoldLots(db, at);
    return all && { ...all, basis: `${all.basis}, across all our companies` };
  }
  return fineGoldLots(db, at);
}

/**
 * What a gram of fine gold is worth in the gold we hold now: every purity in
 * stock at its own running-average cost (stockAverageRate), added up and spread
 * over the fine gold it contains. This is what an order's gold will cost when it
 * is issued from stock — so an estimate made before any gold goes out is valued
 * at it. With no priced gold in stock, the average of the gold bought instead.
 */
export function stockFineGoldRate(db: DB, at: string, companyId?: string): { rate: number; basis: string } | null {
  const co = companyId && companyId !== "all" ? companyId : undefined;
  const value = (only?: string) => {
    let inr = 0, fine = 0;
    for (const [bucket, q] of Object.entries(deriveStockBalances(db.stockMovements ?? [], "gold", only))) {
      if (!(q > 0)) continue;
      const avg = stockAverageRate(db, "gold", bucket, at, only);
      const f = toPureGold(q, bucket);
      if (avg == null || !(f > 0)) continue;
      inr += q * avg; fine += f;
    }
    return fine > 0 ? { rate: r2(inr / fine), fine: r2(fine) } : null;
  };
  // One company's stock; with none of its own priced, every company's together.
  const own = value(co) ?? (co ? value() : null);
  if (own) return { rate: own.rate, basis: `average cost of the gold in stock, ${own.fine}g fine` };
  const bought = fineGoldRate(db, at, companyId);
  return bought && { ...bought, basis: `${bought.basis} — no priced gold in stock` };
}

function fineGoldLots(db: DB, at: string, companyId?: string): { rate: number; basis: string } | null {
  const lots: { at: number; fine: number; inr: number }[] = [];
  for (const p of db.purchases ?? []) {
    if (p.material !== "gold" || !p.gold || !(p.totalInr > 0) || !inCo(p, companyId)) continue;
    const fine = toPureGold(p.gold.weightGrams || 0, p.gold.purity);
    if (fine > 0) lots.push({ at: +new Date(p.createdAt), fine, inr: landedInr(p) });
  }
  for (const m of db.stockMovements ?? []) {
    // Opening stock — and, inside one company, gold moved in from another of ours at its cost there.
    const lot = m.refType === "opening" || (companyId && m.refType === "transfer" && m.type === "purchase_in");
    if (m.material !== "gold" || !lot || m.valueInr == null || !(m.valueInr > 0) || !inCo(m, companyId)) continue;
    const fine = toPureGold(Math.abs(m.quantity), m.purityOrQuality);
    if (fine > 0) lots.push({ at: +new Date(m.createdAt), fine, inr: m.valueInr });
  }
  if (!lots.length) return null;
  const cutoff = +new Date(at);
  const upTo = lots.filter(l => l.at <= cutoff);
  const use = upTo.length ? upTo : lots;
  const fine = use.reduce((s, l) => s + l.fine, 0);
  const inr = use.reduce((s, l) => s + l.inr, 0);
  if (!(fine > 0)) return null;
  const n = use.length;
  return {
    rate: r2(inr / fine),
    basis: upTo.length
      ? `average of ${n} gold lot${n !== 1 ? "s" : ""} bought by then`
      : `average of all ${n} gold lot${n !== 1 ? "s" : ""} on file — none bought by then`,
  };
}

/** The fine (24KT) grams in a finished piece's gold: its net weight at the
 *  purity the factory reported, or the karat's standard purity. */
function finishedFine(mi: MaterialIssuance): number {
  const net = mi.finishedNetWeight ?? 0;
  return mi.finishedPurity != null
    ? pureFromPurity(net, mi.finishedPurity)
    : toPureGold(net, mi.finishedKarat || mi.purityOrQuality);
}

export function orderCost(db: DB, order: Order, depth = 0): OrderCost {
  const out: OrderCost = { gold: [], diamond: [], materials: [], labour: [], other: [], totalInr: 0, pieceInr: 0, missing: [], complete: true };
  const issuances = (db.materialIssuances ?? []).filter(i => i.orderId === order.id);
  const purchases = db.purchases ?? [];
  // Each bill is counted once, however many routes lead to it — a purchase
  // made for an order is usually also the source of the issuance that sent it
  // to the factory, and counting both would double the material cost.
  const counted = new Set<string>();
  // Once a finished piece's gold is on record, that is what the order used.
  // Gold sent to the factory for it — from stock or bought for it — went into
  // the factory's fine-gold account; whatever the piece did not take stays
  // there and is charged to the piece that uses it. Charging both the gold
  // sent and the gold in the piece would count it twice.
  const goldFinished = issuances.some(i => i.material === "gold" && i.finishedNetWeight != null);

  for (const mi of issuances) {
    const unit = materialUnit(db.settings, mi.material);
    const bucket = mi.material === "gold" ? out.gold : mi.material === "diamond" ? out.diamond : out.materials;
    // A material other than gold or diamond is named with its grade: "2g 950 Platinum".
    const what = isOtherMaterial(mi.material) ? `${mi.purityOrQuality} ${materialName(db.settings, mi.material)}` : mi.purityOrQuality;

    if (mi.material === "gold" && mi.finishedNetWeight != null) {
      if (mi.sourcePurchaseId) counted.add(mi.sourcePurchaseId);
      const fine = finishedFine(mi);
      if (fine <= 0) continue;
      const when = mi.finishedPieces?.[0]?.recordedAt ?? mi.issuedAt;
      const fg = fineGoldRate(db, when, companyOf(mi));
      const purityTxt = mi.finishedPurity != null ? `${mi.finishedPurity}‰` : (mi.finishedKarat || mi.purityOrQuality);
      if (!fg) {
        out.missing.push({
          label: `${mi.finishedNetWeight}g ${purityTxt} (${fine}g fine)`,
          reason: "no gold purchase with a price is on file, so there is no average cost of fine gold to value it at",
        });
        continue;
      }
      bucket.push({
        label: `${mi.finishedNetWeight}g at ${purityTxt} = ${fine}g fine × ${fmtRate(fg.rate, "g fine")} (${fg.basis})`,
        amountInr: r2(fine * fg.rate),
      });
      continue;
    }
    if (mi.material === "gold" && goldFinished) {
      // Sent to the factory; the finished piece above is what it used.
      if (mi.sourcePurchaseId) counted.add(mi.sourcePurchaseId);
      continue;
    }

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

    // What actually went into the piece: loose stones (or any other material)
    // sent back to stock at Final Approval are not this order's cost.
    const returned = mi.material === "diamond" ? mi.finishReturnedCt ?? 0 : isOtherMaterial(mi.material) ? mi.finishReturnedQty ?? 0 : 0;
    const used = Math.max(0, r2(mi.quantityIssued - returned));
    if (used <= 0) continue;

    if (mi.source === "purchase" && mi.sourcePurchaseId) {
      const p = purchases.find(x => x.id === mi.sourcePurchaseId);
      counted.add(mi.sourcePurchaseId);
      const bought = p ? qtyOf(p) : 0;
      if (!p || bought <= 0) {
        out.missing.push({ label: `${used}${unit} ${what}`, reason: "the purchase it came from is no longer on file" });
        continue;
      }
      // The bill's own rate, applied to what was used — a bill for more than
      // the piece took is not all this order's cost.
      bucket.push({
        label: `${used}${unit} ${what} · bought for this order${p.invoiceNumber ? ` (bill ${p.invoiceNumber})` : ""}${brokerageWePay(p) > 0 ? " · incl. brokerage" : ""}`,
        amountInr: r2((landedInr(p) / bought) * used),
      });
      continue;
    }

    // Loose stones from stock with their price typed in when they went out:
    // that price, for what stayed in the piece — not the stock's average.
    const typed = mi.material === "diamond" ? mi.diamondSpec?.amountInr ?? 0 : 0;
    if (typed > 0 && mi.quantityIssued > 0) {
      const spec = mi.diamondSpec!;
      const desc = [spec.mm && `${spec.mm} mm`, spec.color, spec.clarity].filter(Boolean).join(" ");
      bucket.push({
        label: `${used}${unit} ${what}${desc ? ` ${desc}` : ""} · from stock, at the price entered${spec.ratePerCaratInr ? ` (${fmtRate(spec.ratePerCaratInr, unit)})` : ""}`,
        amountInr: r2((typed / mi.quantityIssued) * used),
      });
      continue;
    }

    // Issued out of our own pooled stock, or out of gold already held at the
    // factory — which is our gold too, sent there earlier from the same pool.
    // Valued at the pool's average on the day it went out. If our stock of
    // that purity has never had a price on it, it is reported, not guessed.
    // Valued in the books of the company whose material it was.
    const avg = stockAverageRate(db, mi.material, mi.purityOrQuality, mi.issuedAt, companyOf(mi))
      ?? stockAverageRate(db, mi.material, mi.purityOrQuality, new Date().toISOString(), companyOf(mi));
    const where = mi.source === "factoryPool" ? `from ${mi.material === "gold" ? "gold" : "material"} held at the factory` : "from stock";
    if (avg === null && mi.material === "gold") {
      // No purchase of this exact karat — value its fine content instead, at
      // what fine gold has cost. Provisional until the finished piece is in.
      const fine = toPureGold(used, mi.purityOrQuality);
      const fg = fineGoldRate(db, mi.issuedAt, companyOf(mi));
      if (fg && fine > 0) {
        bucket.push({
          label: `${used}g ${mi.purityOrQuality} ${where} = ${fine}g fine × ${fmtRate(fg.rate, "g fine")} (${fg.basis}) — until the finished weight is in`,
          amountInr: r2(fine * fg.rate),
        });
        continue;
      }
    }
    if (avg === null) {
      out.missing.push({
        label: `${used}${unit} ${what}`,
        reason: mi.material === "gold"
          ? `${where} — no gold purchase with a price is on file to value it by`
          : `${where} — no ${what} has ever been bought with a price to value it by`,
      });
      continue;
    }
    bucket.push({
      label: `${used}${unit} ${what} · ${where}, at average cost ${fmtRate(avg, unit)}`,
      amountInr: r2(avg * used),
    });
  }

  // Material bought for this order that no issuance accounts for — bought and
  // paid for, whether or not it has gone to the factory yet.
  for (const p of purchases) {
    if (p.orderId !== order.id || counted.has(p.id)) continue;
    counted.add(p.id);
    const q = qtyOf(p);
    const unit = materialUnit(db.settings, p.material);
    const what = p.material === "gold" ? p.gold?.purity ?? "" : p.material === "diamond" ? p.diamond?.shape ?? ""
      : `${p.other?.grade ? `${p.other.grade} ` : ""}${materialName(db.settings, p.material)}`;
    (p.material === "gold" ? out.gold : p.material === "diamond" ? out.diamond : out.materials).push({
      label: `${q}${unit} ${what} · bought for this order${p.invoiceNumber ? ` (bill ${p.invoiceNumber})` : ""}${brokerageWePay(p) > 0 ? " · incl. brokerage" : ""}`,
      amountInr: r2(landedInr(p)),
    });
  }

  // Before any gold has gone out for the piece, its gold is still a cost: the
  // order's estimate (its net weight at its karat, in fine gold) at what fine
  // gold in stock is worth now (stockFineGoldRate). Shown as an estimate, and replaced the moment real gold is
  // issued or bought for it — so a profit is never stated without the gold.
  const anyGold = issuances.some(i => i.material === "gold") || purchases.some(p => p.orderId === order.id && p.material === "gold");
  if (!anyGold && order.materialSourcing !== "readyStock" && !isDiamondOnlyOrder(order) && metalHasKarats(order.metal, db.settings)) {
    const w = order.estimatedNetWeight || order.estimatedGrossWeight || order.metalWeight || 0;
    if (w > 0 && !order.productKarats) {
      out.missing.push({ label: `Estimated gold ${w}g`, reason: "the order has no karat, so its fine gold can't be worked out" });
    } else if (w > 0) {
      const fine = estimatedPureGoldNeeded(order);
      const fg = stockFineGoldRate(db, new Date().toISOString(), companyOf(order));
      if (fg && fine > 0) {
        out.gold.push({
          label: `Estimate: ${w}g ${order.productKarats} = ${fine}g fine × ${fmtRate(fg.rate, "g fine")} (${fg.basis}) — until gold is issued`,
          amountInr: r2(fine * fg.rate), estimate: true,
        });
        out.estimated = true;
      } else if (fine > 0) {
        out.missing.push({ label: `Estimated gold ${w}g ${order.productKarats}`, reason: "no gold purchase with a price is on file to value it by" });
      }
    }
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
    // A piece a client sent back: it cost what its first order cost per piece.
    const back = item?.fromReturn ? db.orders.find(o => o.id === item.fromReturn!.orderId && o.id !== order.id) : undefined;
    const backCost = back ? orderCost(db, back, depth + 1) : null;
    if (back && backCost && backCost.pieceInr > 0) {
      const pieces = back.quantity || 1;
      out.other.push({ label: `${name} — returned from ${back.orderNumber}${pieces > 1 || sold > 1 ? `, ${sold} piece${sold !== 1 ? "s" : ""} at its cost per piece` : ""}`, amountInr: r2((backCost.pieceInr / pieces) * sold) });
      for (const m of backCost.missing) out.missing.push({ label: m.label, reason: `on ${back.orderNumber}: ${m.reason}` });
    } else if (build && bc && bc.totalInr > 0) {
      // A build can make several identical pieces; this order carries its share.
      const pieces = build.quantity || 1;
      out.other.push({
        label: `${name} — made on ${build.orderNumber}${pieces > 1 ? `, ${sold} of ${pieces} pieces` : ""}`,
        amountInr: r2((bc.totalInr / pieces) * sold),
      });
      for (const m of bc.missing) out.missing.push({ label: m.label, reason: `on ${build.orderNumber}: ${m.reason}` });
    } else if (item && (stockCostOf(db, item) ?? 0) > 0) {
      // The cost typed on the stock item, in dollars like its price.
      const unitCost = stockCostOf(db, item)!;
      if (rate > 0) {
        out.other.push({ label: `${name} — cost entered on the stock item ($${unitCost}${sold > 1 ? ` × ${sold}` : ""})`, amountInr: r2(unitCost * sold * rate) });
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
  // from a dollar (or any other foreign) account is converted at the rate on
  // the day it was paid.
  let expenseInr = 0;
  for (const e of db.expenses ?? []) {
    if (!e.orderIds?.includes(order.id)) continue;
    const peers = e.orderIds.map(id => db.orders.find(o => o.id === id)).filter((o): o is Order => !!o);
    // Split by what each order sold for — before any return, so a piece
    // sent back later does not push its freight onto the rest of the parcel.
    const value = (o: Order) => Math.max(0, orderTotal(o) + returnedCredit(o));
    const pool = peers.reduce((s, o) => s + value(o), 0);
    const share = pool > 0 ? value(order) / pool : 1 / Math.max(peers.length, 1);
    // Rupees as they are; any other currency at its rate that day. With no
    // rate on file it is listed as missing — never counted as if it were ₹.
    const perUnit = inrOn(db, e.currency, e.createdAt);
    if (perUnit === undefined) {
      const code = ccy(e.currency);
      out.missing.push({
        label: e.title,
        reason: code === "USD"
          ? "paid in dollars — set the exchange rate to count it"
          : `paid in ${code} — add a ${code} rate in Settings → Exchange rates to count it`,
      });
      continue;
    }
    const inr = e.amount * perUnit;
    out.other.push({
      label: peers.length > 1 ? `${e.title} — ${Math.round(share * 100)}% of a ${peers.length}-order parcel` : e.title,
      amountInr: r2(inr * share),
    });
    expenseInr += r2(inr * share);
  }

  // A shipped order with nothing on record for its shipping is not free to
  // send — the freight was simply never written down. Said so, rather than
  // counted as nothing, until it is entered or the parcel is marked as having
  // cost nothing. Orders shipped before freight was recorded at dispatch are
  // exactly these, and the profit on them reads as an upper bound until then.
  if (depth === 0 && recognisedSale(order) && !freightRecorded(db, order.id)) {
    out.missing.push({ label: "Freight & insurance", reason: "not recorded for this shipment — enter it, or mark the parcel as having none" });
  }

  // The factory's bill — making, CAD, diamond setting, any metal the factory
  // supplied itself — exactly as it stands on the factory's ledger.
  for (const mi of issuances) {
    const charge = mi.makingCharges?.amountInr ?? 0;
    if (charge <= 0) continue;
    const f = db.factories.find(x => x.id === mi.factoryId);
    out.labour.push({ label: `${f?.name ?? "Factory"} — making & labour`, amountInr: r2(charge) });
  }

  const all = [...out.gold, ...out.diamond, ...out.materials, ...out.labour, ...out.other];
  // The pieces themselves — everything but the freight and other costs of sending them.
  out.pieceInr = r2(all.reduce((s, l) => s + l.amountInr, 0) - expenseInr);
  // Pieces the client sent back carry their cost into Ready Stock; the freight stays spent.
  const back = returnedQty(order);
  if (depth === 0 && back > 0 && out.pieceInr > 0) {
    const of = order.quantity || 1;
    out.other.push({ label: `Returned by the client — ${back} of ${of} piece${of !== 1 ? "s" : ""}, cost moves to Ready Stock with ${back !== 1 ? "them" : "it"}`, amountInr: -r2(out.pieceInr * Math.min(back, of) / of) });
  }
  out.totalInr = r2([...out.gold, ...out.diamond, ...out.materials, ...out.labour, ...out.other].reduce((s, l) => s + l.amountInr, 0));
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
  /** Profit as a share of the selling price. */
  marginPct: number | null;
  /** Profit as a share of the cost — (profit ÷ cost) × 100. */
  markupPct: number | null;
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
  if (!fx) return { cost, fx, sellingUsd, costUsd: null, profitUsd: null, marginPct: null, markupPct: null };
  const costUsd = r2(cost.totalInr / fx.rate);
  const profitUsd = r2(sellingUsd - costUsd);
  const marginPct = sellingUsd > 0 ? Math.round((profitUsd / sellingUsd) * 1000) / 10 : null;
  const markupPct = costUsd > 0 ? markupOf(profitUsd, costUsd) : null;
  return { cost, fx, sellingUsd, costUsd, profitUsd, marginPct, markupPct };
}

/** Markup: (profit ÷ cost) × 100, one decimal — beside the margin (profit ÷ selling price) wherever both are known. */
export function markupOf(profit: number, cost: number): number | null {
  return cost > 0 ? Math.round((profit / cost) * 1000) / 10 : null;
}

/** The same markup from a margin, where only the margin is kept: m ÷ (100 − m). */
export function markupFromMargin(marginPct: number | null | undefined): number | null {
  if (marginPct == null || marginPct >= 100) return null;
  return Math.round((marginPct / (100 - marginPct)) * 1000) / 10;
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
  /** The same in rupees: each sale at its own day's rate, the cost as paid. Null when any sale has no rate. */
  sellingInr: number | null;
  profitInr: number | null;
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
  const sellingInr = rows.length && rows.every(r => r.fx) ? Math.round(rows.reduce((s, r) => s + r.sellingUsd * r.fx!.rate, 0)) : rows.length ? null : 0;
  const profitInr = sellingInr === null ? null : Math.round(sellingInr - costInr);
  return { key, count: rows.length, sellingUsd, costInr, costUsd, profitUsd, marginPct, sellingInr, profitInr, incomplete: rows.filter(r => !r.complete).length };
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
 * paid, the same way the sales were; one paid from an account in any other
 * currency is turned into rupees at that currency's rate first.
 *
 * An expense in a currency with no rate on file is left out of both totals
 * rather than guessed at — and listed in `uncounted`, so the report can say
 * "2 expenses in AUD not counted — add an AUD rate in Settings".
 */
export function operatingExpenses(db: DB, inPeriod: (iso: string) => boolean) {
  const rows = (db.expenses ?? []).filter(e => !(e.orderIds && e.orderIds.length) && inPeriod(e.createdAt));
  let usd = 0;
  let inr = 0;
  let convertible = true;
  const byCategory = new Map<string, number>();
  const uncounted = new Map<CurrencyCode, { count: number; amount: number }>();
  for (const e of rows) {
    const code = ccy(e.currency);
    let asUsd: number | null;
    if (code === "USD") {
      asUsd = e.amount;
      const fx = rateOn(db, e.createdAt);
      inr += fx ? e.amount * fx.rate : 0;
    } else {
      const perUnit = inrOn(db, code, e.createdAt); // 1 for rupees
      if (perUnit === undefined) {
        const u = uncounted.get(code) ?? { count: 0, amount: 0 };
        u.count++; u.amount += e.amount;
        uncounted.set(code, u);
        continue;
      }
      const asInr = e.amount * perUnit;
      inr += asInr;
      const fx = rateOn(db, e.createdAt);
      asUsd = fx ? asInr / fx.rate : null;
    }
    if (asUsd === null) { convertible = false; continue; }
    usd += asUsd;
    byCategory.set(e.category, (byCategory.get(e.category) ?? 0) + asUsd);
  }
  const left = [...uncounted.values()].reduce((s, u) => s + u.count, 0);
  return {
    /** Entries inside the totals — those in a currency with no rate are not. */
    count: rows.length - left,
    totalInr: r2(inr),
    totalUsd: convertible ? r2(usd) : null,
    byCategory: [...byCategory.entries()].map(([k, v]) => ({ category: k, usd: r2(v) })).sort((a, b) => b.usd - a.usd),
    /** Left out for want of a rate, by currency: what to add in Settings → Exchange rates. */
    uncounted: [...uncounted.entries()]
      .sort(([a], [b]) => ccyOrder(a, b))
      .map(([currency, u]) => ({ currency, count: u.count, amount: roundCcy(u.amount, currency) })),
  };
}

/* ────────────────────────────────────────────────────────────────────────────
 * Exchange difference on collections.
 *
 * A sale is booked at the rate on the day it left. The client then pays, and
 * the dollars are turned into rupees at whatever the bank gives that day. The
 * gap between the rupees actually received and the rupees the sale was booked
 * at is a real gain or loss of the business — the "exchange fluctuation" line
 * in an exporter's accounts — and it is nobody's margin on the piece. It sits
 * below gross profit, never inside it.
 * ──────────────────────────────────────────────────────────────────────────── */

export interface ExchangeDifference {
  /** Rupees received less rupees booked, over the payments that were converted. */
  inr: number;
  /** The same, at the sale's own booking rate. Null with no booking rate. */
  usd: number | null;
  /** Dollars that were converted into rupees, so carry a realised difference. */
  convertedUsd: number;
  /** Dollars banked in a foreign account (dollars, or any currency but
   *  rupees) — not turned into rupees yet, so nothing is realised on them
   *  until they are. */
  heldUsd: number;
  /** Dollars whose conversion rate is not on record (credit carried across,
   *  or a payment entered before rates were kept), left out either way. */
  unknownUsd: number;
}

/**
 * The rate a payment was actually converted at, or why there is none. A
 * payment comes in on a receipt, which carries the rate whenever the money
 * landed in a rupee account; an older payment taken against one order may
 * carry its own rupee amount instead.
 *
 * Only rupees received realise a difference. Money that landed in any other
 * account — dollars, or AUD, EUR… — is still held abroad: its receipt's rate
 * is that currency per dollar (A$1.5), not rupees, and nothing is realised in
 * rupees until it is converted.
 */
function realisedRate(db: DB, a: Order["advances"][number]): number | "held" | null {
  if (a.fromCredit) return null; // the rupees came in on an earlier receipt
  if (a.receiptId) {
    const r = (db.clientReceipts ?? []).find(x => x.id === a.receiptId);
    if (r) {
      const cur = ccy(r.lockerCurrency ?? (r.lockerId ? db.lockers.find(l => l.id === r.lockerId)?.currency : undefined));
      if (cur !== "INR") return "held";
      if (r.exchangeRate && r.exchangeRate > 0) return r.exchangeRate;
      if (r.lockerAmount && r.amountUsd > 0) return r.lockerAmount / r.amountUsd;
      return null;
    }
  }
  if (a.lockerId) {
    const cur = ccy(db.lockers.find(l => l.id === a.lockerId)?.currency);
    if (cur !== "INR") return "held";
    if (a.lockerAmount && a.amount > 0) return a.lockerAmount / a.amount;
  }
  return null;
}

export function exchangeDifference(db: DB, order: Order): ExchangeDifference | null {
  // No sale, no booking rate to measure against.
  if (!recognisedSale(order)) return null;
  const booked = rateOn(db, saleDate(order));
  const out: ExchangeDifference = { inr: 0, usd: null, convertedUsd: 0, heldUsd: 0, unknownUsd: 0 };
  for (const a of order.advances ?? []) {
    if (!(a.amount > 0)) continue;
    const rate = realisedRate(db, a);
    if (rate === "held") { out.heldUsd += a.amount; continue; }
    if (rate === null || !booked) { out.unknownUsd += a.amount; continue; }
    out.convertedUsd += a.amount;
    out.inr += a.amount * (rate - booked.rate);
  }
  out.inr = r2(out.inr);
  out.convertedUsd = r2(out.convertedUsd);
  out.heldUsd = r2(out.heldUsd);
  out.unknownUsd = r2(out.unknownUsd);
  out.usd = booked ? r2(out.inr / booked.rate) : null;
  return out;
}

/** Exchange difference across a set of sales — the line below gross profit. */
export function exchangeDifferenceTotal(db: DB, orders: Order[]) {
  let inr = 0, usd = 0, convertedUsd = 0, heldUsd = 0, unknownUsd = 0;
  let convertible = true;
  for (const o of orders) {
    const x = exchangeDifference(db, o);
    if (!x) continue;
    inr += x.inr;
    if (x.usd === null) convertible = false; else usd += x.usd;
    convertedUsd += x.convertedUsd; heldUsd += x.heldUsd; unknownUsd += x.unknownUsd;
  }
  return { inr: r2(inr), usd: convertible ? r2(usd) : null, convertedUsd: r2(convertedUsd), heldUsd: r2(heldUsd), unknownUsd: r2(unknownUsd) };
}

/**
 * Expenses in dollars, to set against revenue billed in dollars. Dollars as
 * they are; any other currency through rupees at the rate on the day it was
 * paid. One with no rate on file is left out and handed back apart, never
 * converted at a guess.
 */
export function expensesInUsd(db: DB, list: Expense[]): { usd: number; converted: boolean; left: Map<CurrencyCode, number> } {
  let usd = 0, converted = false;
  const left: Expense[] = [];
  for (const e of list) {
    const code = ccy(e.currency);
    if (code === "USD") { usd += e.amount; continue; }
    const perUnit = inrOn(db, code, e.createdAt);
    const perUsd = inrOn(db, "USD", e.createdAt);
    if (perUnit === undefined || !perUsd) { left.push(e); continue; }
    usd += (e.amount * perUnit) / perUsd;
    converted = true;
  }
  return { usd, converted, left: sumByCcy(left, e => e.amount, e => e.currency) };
}
