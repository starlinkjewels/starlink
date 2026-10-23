// Manufacturing & Accounts ledger math — Locker, Supplier/Purchase, Factory/
// MaterialIssuance. Mirrors the existing client-billing pattern in src/lib/db.ts
// (totalAdvance/orderTotal/balanceDue/clientAccount/settleClientAccount)
// exactly, but for a SEPARATE, INR-denominated ledger (sourcing/manufacturing
// cost side), never mixed with the USD client-billing figures.
//
// Stock levels are NOT here — see src/lib/stock.ts, which needs a genuinely
// different, transactional write path for correctness (this file only
// contains pure, side-effect-free summary/allocator functions).
// The account calculations live in src/lib/pure so the server works every total
// out with exactly this code. Re-exported: nothing that imports them from here changes.
import { fmtCcy } from "@/lib/currency";
import {
  purchasePaid, issuancePaid, issuancePending, issuanceUsed, diamondFlow, otherFlow,
  factoryFineGoldBalance, factoryAccount, factoryOtherBalances, supplierAccount, lockerBalance,
  factoryPoolBalance, factoryPoolBuckets,
} from "./pure/accounts";
import { purchaseQty } from "./materials";
import { metalHasKarats } from "./metals";
export {
  purchasePaid, issuancePaid, issuancePending, issuanceUsed, diamondFlow, otherFlow,
  factoryFineGoldBalance, factoryAccount, factoryOtherBalances, supplierAccount, lockerBalance,
  factoryPoolBalance, factoryPoolBuckets,
};
/** Whose stock a movement moved: unset is the first company. */
const moveCompany = (m: Pick<StockMovement, "companyId">) => m.companyId || "main";
const r0 = (n: number) => Math.round(n);
import {
  uid,
  fmtMoney,
  toPureGold,
  pureFromPurity,
  openingDebitAmt,
  openingCreditAmt,
  type OpeningBalanceInfo,
  type Purchase,
  type SupplierReceipt,
  type SupplierPayment,
  type FactoryPayment,
  type MaterialIssuance,
  type Locker,
  type LockerTransaction,
  type Order,
  type Factory,
  type Supplier,
  type StockMovement,
  type DiamondSale,
  type Client,
  isDiamondOnlyOrder,
} from "./db";


/** Format a Locker/LockerTransaction amount in its own currency (undefined = INR) —
 *  any currency: ₹1,23,456 · $1,234.56 · A$980 · €1,200. */
export function fmtLockerAmount(n: number, currency?: string): string {
  return fmtCcy(n, currency);
}

// This module only tracks gold (by karat purity) and diamond — a metal with no
// karats (platinum, silver, titanium, or any the business marks so) never
// needs gold issued to proceed.

export function orderMaterialRequirements(order: Pick<Order, "metal" | "diamondWeight" | "noDiamond">): {
  needsGold: boolean;
  needsDiamond: boolean;
} {
  return {
    needsGold: metalHasKarats(order.metal),
    // A diamond-only order is FOR the stones, so it needs them whatever the
    // estimated weight says — an estimate of 0 ct is missing, not "no diamond".
    //
    // `noDiamond` is someone saying the finished piece has none: a plain gold
    // band, or an estimate that asked for stones the piece did not use. Without
    // it the only way past Final Approval was the admin override, which records
    // nothing about why.
    needsDiamond: !order.noDiamond && (order.diamondWeight > 0 || isDiamondOnlyOrder(order)),
  };
}

/**
 * Gates "Final Approval" on the order Timeline: gold/diamond must have been
 * issued to a factory for THIS order before the piece can be signed off —
 * only for whichever materials the order actually calls for.
 */
export function manufacturingReadiness(
  order: Pick<Order, "id" | "metal" | "diamondWeight" | "materialSourcing" | "assignedFactoryId">,
  issuances: MaterialIssuance[],
): { ready: boolean; missing: ("gold" | "diamond")[] } {
  // Sold straight out of finished-goods inventory — nothing to issue to a
  // factory, the piece already exists.
  if (order.materialSourcing === "readyStock") return { ready: true, missing: [] };
  const { needsGold, needsDiamond } = orderMaterialRequirements(order);
  const orderIssuances = issuances.filter(i => i.orderId === order.id);
  const missing: ("gold" | "diamond")[] = [];
  // Gold is held (reserved) at the assigned factory and drawn down when the
  // finished piece is received (net weight → pure gold), NOT issued per order —
  // so "gold ready" simply means a factory has been assigned to make the piece.
  if (needsGold && !order.assignedFactoryId) missing.push("gold");
  if (needsDiamond && !orderIssuances.some(i => i.material === "diamond")) missing.push("diamond");
  return { ready: missing.length === 0, missing };
}

export function fmtMoneyInr(n: number): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(n);
}

// ── Purchases / Suppliers ──────────────────────────────────────────────────


export function purchasePending(p: Purchase): number {
  return Math.max(0, p.totalInr - purchasePaid(p));
}

/** Supplier account summary across all their purchases. */
/**
 * One payment, however many bills it settled.
 *
 * A payment entered once is stored as an allocation per bill, so a single
 * ₹2,41,200 handed over against six bills reads as six rows. The day book has
 * one line for it, and a statement that cannot be laid beside the day book is
 * no use for checking the day's cash. Parts written in the same save, into the
 * same account, are that one payment; the split stays inside the bills, where
 * the allocation belongs, and the bills are named instead.
 */
/**
 * What a line comes to after its percentage adjustment.
 *
 * Positive takes off (a 5% discount); negative adds on (1.5% GST, 1% for cash)
 * — which is why it is not clamped at zero. It used to be, so a supplier who
 * charges rather than discounts had nowhere to put it and the line read short.
 * Bounded at ±100 so a typo cannot wipe a bill out or double it twice over.
 */
export function applyDiscountPct(gross: number, pct: number | string | undefined): number {
  const d = Math.min(Math.max(Number(pct) || 0, -100), 100);
  return gross * (1 - d / 100);
}

/** "less 5%" or "plus 1.5%", however it was entered. */
export function discountLabel(pct: number): string {
  return pct > 0 ? `less ${pct}%` : `plus ${Math.abs(pct)}%`;
}

export function groupPaymentsAsMade<T extends { id: string; lockerId?: string; createdAt: string; amountInr: number; note?: string }>(
  legs: { pay: T; label?: string }[],
): { ids: string[]; labels: string[]; at: string; amountInr: number; note?: string; lockerId?: string }[] {
  const byKey = new Map<string, { ids: string[]; labels: string[]; at: string; amountInr: number; note?: string; lockerId?: string }>();
  for (const { pay, label } of legs) {
    const key = `${pay.lockerId ?? ""}|${pay.createdAt}`;
    const g = byKey.get(key);
    if (!g) {
      byKey.set(key, {
        ids: [pay.id], labels: label ? [label] : [], at: pay.createdAt,
        amountInr: pay.amountInr, note: pay.note, lockerId: pay.lockerId,
      });
    } else {
      g.ids.push(pay.id);
      if (label && !g.labels.includes(label)) g.labels.push(label);
      g.amountInr = Math.round((g.amountInr + pay.amountInr) * 100) / 100;
      if (!g.note && pay.note) g.note = pay.note;
    }
  }
  return [...byKey.values()];
}


/**
 * Secondary convenience for "paid the supplier a lump sum, unspecified which
 * invoices it covers" — the PRIMARY flow is pushing a payment directly onto
 * one Purchase (mirrors Order.advances), since a business paying its own
 * bills almost always knows which invoice it's settling.
 */
export function allocateSupplierPaymentFIFO(
  purchases: Purchase[],
  amount: number,
  lockerId: string,
  recordedBy: string,
  at: string,
  note?: string,
): number {
  let remaining = amount;
  const oldestFirst = [...purchases].sort(
    (a, b) => +new Date(a.invoiceDate || a.createdAt) - +new Date(b.invoiceDate || b.createdAt),
  );
  for (const p of oldestFirst) {
    if (remaining <= 0) break;
    const pending = purchasePending(p);
    if (pending <= 0) continue;
    const pay = Math.min(remaining, pending);
    if (!p.payments) p.payments = [];
    p.payments.push({ id: uid("ppay_"), amountInr: pay, lockerId, recordedBy, createdAt: at, note });
    remaining -= pay;
  }
  return r0(remaining); // leftover — surface to the user rather than silently discard
}

// ── Material Issuances / Factories ─────────────────────────────────────────





/** Only meaningful once `status === "closed"` — material not yet accounted for is still "in progress" until then. */
export function issuanceWastage(i: MaterialIssuance): number {
  return i.quantityIssued - issuanceUsed(i);
}



/**
 * The structured labour value (factory payable) from an issuance's labour
 * breakdown, the finished piece's net weight and the order's diamond carats.
 *
 * `netWeight` is the net weight of the PIECE — all of its metal, whatever that
 * metal is. Callers used to pass only the gold net weight, so on a platinum or
 * silver piece, which has none, labour per gram came to nothing: a rate of
 * ₹1,000/g on 7.214g of platinum added ₹0 to the bill.
 */
export function labourValue(labour: NonNullable<MaterialIssuance["labour"]> | undefined, netWeight: number, diamondCt: number): number {
  if (!labour) return 0;
  const v =
    makingCharge(labour, netWeight) +
    (labour.diamondHandlingRate || 0) * (diamondCt || 0) +
    (labour.cadCharge || 0) +
    (labour.otherCharges || 0) +
    (labour.metalByFactoryGrams || 0) * (labour.metalByFactoryRate || 0);
  return Math.round(v * 100) / 100;
}

/**
 * The making charge alone: the per-gram rate on the piece, or the minimum when
 * the piece is too light to reach it. A factory that charges ₹850/g will still
 * not make a 1.5g ring for ₹1,275, so its card sets a floor; the floor replaces
 * the per-gram figure rather than adding to it.
 */
export function makingCharge(labour: NonNullable<MaterialIssuance["labour"]> | undefined, netWeight: number): number {
  if (!labour) return 0;
  const perGram = (labour.perGramRate || 0) * (netWeight || 0);
  return Math.round(Math.max(perGram, labour.minimumLabour || 0) * 100) / 100;
}

/** True when the minimum is what is actually being charged, so the screen can
 *  say so instead of showing a total that does not match the rate times weight. */
export function minimumLabourApplies(labour: NonNullable<MaterialIssuance["labour"]> | undefined, netWeight: number): boolean {
  if (!labour?.minimumLabour) return false;
  return labour.minimumLabour > (labour.perGramRate || 0) * (netWeight || 0);
}


/** Karat string ("9K".."24K") -> fraction of pure (24K) gold, e.g. "18K" -> 0.75.
 *  Jewelers' standard back-of-envelope ratio — an ESTIMATE for low-stock
 *  warnings, never authoritative alloy/wastage accounting. Falls back to 1
 *  (no discount) for any unparseable/missing value so a bad karat string never
 *  produces a scary warning. */
export function karatRatio(purity: string | undefined): number {
  const n = purity ? parseInt(purity, 10) : NaN;
  if (!Number.isFinite(n) || n <= 0) return 1;
  return Math.min(1, n / 24);
}

/** Rough 24K-pure-gold-equivalent an order will need for its finished piece,
 *  given the karat it's cast in. ESTIMATE only (see karatRatio) — uses the
 *  best available weight guess before the piece physically exists. Caller
 *  should guard with orderMaterialRequirements(order).needsGold first
 *  (Platinum/Silver orders have no karat concept). */
export function estimatedPureGoldNeeded(
  order: Pick<Order, "productKarats" | "estimatedNetWeight" | "estimatedGrossWeight" | "metalWeight">,
): number {
  const weight = order.estimatedNetWeight || order.estimatedGrossWeight || order.metalWeight || 0;
  return Math.round(weight * karatRatio(order.productKarats) * 100) / 100;
}


export function allocateFactoryChargePaymentFIFO(
  issuances: MaterialIssuance[],
  amount: number,
  lockerId: string,
  recordedBy: string,
  at: string,
  note?: string,
): number {
  let remaining = amount;
  const oldestFirst = [...issuances].sort((a, b) => +new Date(a.issuedAt) - +new Date(b.issuedAt));
  for (const i of oldestFirst) {
    if (remaining <= 0) break;
    const pending = issuancePending(i);
    if (pending <= 0) continue;
    const pay = Math.min(remaining, pending);
    if (!i.makingCharges.payments) i.makingCharges.payments = [];
    i.makingCharges.payments.push({ id: uid("fpay_"), amountInr: pay, lockerId, recordedBy, createdAt: at, note });
    remaining -= pay;
  }
  return r0(remaining);
}

// ── Stock movement drill-down (Stock.tsx bucket history) ──────────────────

export interface StockMovementLink {
  label: string; // always present — resolved description, or the movement's own note as fallback
  invoiceNumber?: string; // supplier invoice # for a purchase_in movement, when recorded
  orderId?: string;
  factoryId?: string;
  supplierId?: string;
  clientId?: string;
}

interface StockLinkContext {
  purchases: Purchase[];
  issuances: MaterialIssuance[];
  orders: Order[];
  factories: Factory[];
  suppliers: Supplier[];
  diamondSales?: DiamondSale[];
  supplierSales?: { id: string; supplierId: string }[];
  clients?: Client[];
}

/** Resolve one StockMovement's refType/refId into a human label + link target
 *  for Stock.tsx's per-bucket history. Falls back to the movement's own note
 *  whenever the referenced record can't be found — e.g. a Purchase that
 *  SupplierHistory's voidPurchase deletes right after writing this exact
 *  movement (refId legitimately dangles; expected, not a bug). */
export function resolveStockMovementLink(m: StockMovement, ctx: StockLinkContext): StockMovementLink {
  if (m.refType === "materialIssuance" && m.refId) {
    const mi = ctx.issuances.find(i => i.id === m.refId);
    if (!mi) return { label: m.note || "Issued to factory (record not found)" };
    const factory = ctx.factories.find(f => f.id === mi.factoryId);
    if (mi.orderId) {
      const order = ctx.orders.find(o => o.id === mi.orderId);
      return { label: `Issued to order ${order?.orderNumber ?? "?"} · ${factory?.name ?? "factory"}`, orderId: mi.orderId, factoryId: mi.factoryId };
    }
    return { label: `Bulk delivery to ${factory?.name ?? "factory"}'s pool`, factoryId: mi.factoryId };
  }
  if (m.refType === "purchase" && m.refId) {
    const p = ctx.purchases.find(x => x.id === m.refId);
    if (!p) return { label: m.note || "Purchase (record no longer exists)" };
    const supplier = ctx.suppliers.find(s => s.id === p.supplierId);
    const inv = p.invoiceNumber?.trim();
    const label = m.type === "purchase_in"
      ? `Purchased from ${supplier?.name ?? "supplier"}${inv ? ` · Inv ${inv}` : ""}`
      : `Purchase void reversal — ${supplier?.name ?? "supplier"}${inv ? ` · Inv ${inv}` : ""}`;
    return { label, supplierId: p.supplierId, invoiceNumber: inv || undefined };
  }
  if (m.refType === "opening") {
    return { label: `Opening Stock (brought forward)${m.note ? ` — ${m.note}` : ""}` };
  }
  if (m.refType === "order" && m.refId) {
    const order = ctx.orders.find(o => o.id === m.refId);
    if (!order) return { label: m.note || "Used on order" };
    return { label: `Used directly on order ${order.orderNumber}`, orderId: order.id };
  }
  if (m.refType === "diamondSale" && m.refId) {
    const sale = ctx.diamondSales?.find(s => s.id === m.refId);
    if (!sale) return { label: m.note || "Diamond sale (record not found)" };
    if (sale.clientId) {
      const client = ctx.clients?.find(c => c.id === sale.clientId);
      return { label: `Sold to ${client?.companyName ?? "client"}`, clientId: sale.clientId };
    }
    return { label: `Sold to ${sale.buyerName || "buyer"}` };
  }
  // Sold to one of our suppliers (lib/supplierSales.ts) — and back again when that sale is deleted.
  if (m.refType === "supplierSale") {
    const sale = ctx.supplierSales?.find(s => s.id === m.refId);
    const supplierId = sale?.supplierId;
    const name = ctx.suppliers.find(s => s.id === supplierId)?.name;
    if (m.type === "purchase_in") return { label: `Sale to ${name ?? "a supplier"} deleted — back in stock`, ...(supplierId ? { supplierId } : {}) };
    return { label: name ? `Sold to ${name} (supplier)` : m.note || "Sold to a supplier", ...(supplierId ? { supplierId } : {}) };
  }
  return { label: m.note || "Manual adjustment" };
}

/**
 * Current stock balance PER bucket, derived straight from the movement ledger
 * (the auditable source of truth). Used for every on-screen balance so what a
 * user sees always reconciles with the history right beside it — the cached
 * stockLevels/current doc is only the transactional floor-check helper and can
 * drift; the ledger cannot lie. Same signs as recomputeStockFromHistory.
 */
export function deriveStockBalances(movements: StockMovement[], material: string, companyId?: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const m of movements) {
    if (m.material !== material) continue;
    // One company's stock, or (no company given) every company's together.
    if (companyId && companyId !== "all" && moveCompany(m) !== companyId) continue;
    const sign = m.type === "purchase_in" ? 1 : m.type === "adjustment" ? Math.sign(m.quantity) : -1;
    out[m.purityOrQuality] = Math.round(((out[m.purityOrQuality] || 0) + sign * Math.abs(m.quantity)) * 1000) / 1000;
  }
  return out;
}

/** Movements for one Stock bucket (material + purity/shape key), newest
 *  first, each enriched with its resolved link — drives Stock.tsx's
 *  per-bucket drill-down modal. */
export function stockBucketHistory(
  movements: StockMovement[],
  material: string,
  purityOrQuality: string | null,
  ctx: StockLinkContext,
  companyId?: string,
): (StockMovement & { link: StockMovementLink })[] {
  return movements
    .filter(m => m.material === material && (purityOrQuality === null || m.purityOrQuality === purityOrQuality)
      && (!companyId || companyId === "all" || moveCompany(m) === companyId))
    .sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt))
    .map(m => ({ ...m, link: resolveStockMovementLink(m, ctx) }));
}

export interface MaterialLedgerRow {
  id: string;
  createdAt: string;
  type: StockMovement["type"];
  purityOrQuality: string;
  note?: string;
  link: StockMovementLink;
  invoiceNumber?: string; // supplier invoice # for a purchase_in row
  inQty: number;   // grams (gold) / carats (diamond) coming IN (purchase / return)
  outQty: number;  // going OUT (issued to factory / used on order / sold)
  rateInr: number | null;   // ₹/unit — only for purchases (linked Purchase)
  amountInr: number | null; // ₹ for this movement — only for purchases
  balance: number; // running stock level of this material AFTER this movement
}

/** A full material ledger (gold or loose diamond): every movement — purchases IN,
 *  factory issues / order use / sales OUT, returns IN — newest first, each with a
 *  running stock balance and (for purchases) the rate & amount. This is the proper
 *  ledger shown on the Stock page and downloadable in Reports. */
export function materialLedger(
  movements: StockMovement[],
  material: string,
  ctx: StockLinkContext,
  companyId?: string,
): MaterialLedgerRow[] {
  const hist = stockBucketHistory(movements, material, null, ctx, companyId); // links resolved
  // Deterministic chronological order: a direct-order purchase writes an IN + OUT
  // pair with the SAME timestamp (logOrderDirectPurchase), so apply IN before OUT
  // at a tie (then by id) — the running balance is stable and its newest row
  // always matches deriveStockBalances (the Balances card).
  const inRank = (m: StockMovement) => (m.type === "purchase_in" || (m.type === "adjustment" && m.quantity > 0) ? 0 : 1);
  const chronoAsc = [...hist].sort((a, b) =>
    (+new Date(a.createdAt) - +new Date(b.createdAt)) || (inRank(a) - inRank(b)) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const balById = new Map<string, number>();
  let bal = 0;
  for (const m of chronoAsc) {
    const sign = m.type === "purchase_in" ? 1 : m.type === "adjustment" ? Math.sign(m.quantity || 1) : -1;
    bal = Math.round((bal + sign * Math.abs(m.quantity)) * 1000) / 1000;
    balById.set(m.id, bal);
  }
  const purchaseById = new Map(ctx.purchases.map(p => [p.id, p]));
  return [...chronoAsc].reverse().map(m => {
    let rateInr: number | null = null, amountInr: number | null = null;
    if (m.type === "purchase_in" && m.refType === "purchase" && m.refId) {
      const p = purchaseById.get(m.refId);
      if (p) {
        const pQty = purchaseQty(p);
        rateInr = pQty > 0 ? p.totalInr / pQty : 0;
        amountInr = rateInr * m.quantity;
      }
    } else if (m.refType === "opening" && m.valueInr != null) {
      // Opening stock carries its own ₹ valuation (no supplier purchase behind it).
      amountInr = m.valueInr;
      rateInr = m.quantity > 0 ? m.valueInr / m.quantity : null;
    }
    const isIn = m.type === "purchase_in" || (m.type === "adjustment" && m.quantity > 0);
    return {
      id: m.id, createdAt: m.createdAt, type: m.type, purityOrQuality: m.purityOrQuality, note: m.note, link: m.link,
      invoiceNumber: m.link.invoiceNumber,
      inQty: isIn ? Math.abs(m.quantity) : 0,
      outQty: isIn ? 0 : Math.abs(m.quantity),
      rateInr, amountInr,
      balance: balById.get(m.id) ?? 0,
    };
  });
}

// ── Lockers (bank/cash accounts) ───────────────────────────────────────────


/**
 * Record a payment OUT of a Locker for a Purchase/MaterialIssuance settlement,
 * in the same mutation as the payment itself — so the Locker balance and the
 * Supplier/Factory ledger can never drift apart. Call inside updateDb().
 */
export function recordLockerExpense(
  lockerTransactions: LockerTransaction[],
  args: {
    lockerId: string;
    amountInr: number;
    category: string;
    refType: "purchase" | "materialIssuance";
    refId: string;
    recordedBy: string;
    at: string;
    note?: string;
  },
): void {
  lockerTransactions.push({
    id: uid("ltx_"),
    lockerId: args.lockerId,
    type: "expense",
    amountInr: args.amountInr,
    category: args.category,
    refType: args.refType,
    refId: args.refId,
    recordedBy: args.recordedBy,
    createdAt: args.at,
    note: args.note,
  });
}
