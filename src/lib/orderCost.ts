import { orderTotal, type DB, type Order, type Purchase } from "@/lib/db";

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
    // factory. The pool has no single price per gram yet, so it is not guessed.
    out.missing.push({
      label: `${used}${unit} ${mi.purityOrQuality}`,
      reason: mi.source === "factoryPool" ? "taken from gold held at the factory — not valued yet" : "issued from stock — not valued yet",
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
