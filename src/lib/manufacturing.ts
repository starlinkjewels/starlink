// Manufacturing & Accounts ledger math — Locker, Supplier/Purchase, Factory/
// MaterialIssuance. Mirrors the existing client-billing pattern in src/lib/db.ts
// (totalAdvance/orderTotal/balanceDue/clientAccount/allocatePaymentFIFO)
// exactly, but for a SEPARATE, INR-denominated ledger (sourcing/manufacturing
// cost side), never mixed with the USD client-billing figures.
//
// Stock levels are NOT here — see src/lib/stock.ts, which needs a genuinely
// different, transactional write path for correctness (this file only
// contains pure, side-effect-free summary/allocator functions).
import {
  uid,
  fmtMoney,
  toPureGold,
  type Purchase,
  type MaterialIssuance,
  type Locker,
  type LockerTransaction,
  type Order,
  type Factory,
  type Supplier,
  type StockMovement,
} from "./db";

const r0 = (n: number) => Math.round(n);

/** Format a Locker/LockerTransaction amount in its own currency (undefined = INR). */
export function fmtLockerAmount(n: number, currency?: "INR" | "USD"): string {
  return currency === "USD" ? fmtMoney(n) : fmtMoneyInr(n);
}

// This module only tracks gold (by karat purity) and diamond — Platinum/Silver
// orders never need a factory material issuance to proceed.
const GOLDLESS_METALS = new Set(["Platinum", "Silver"]);

export function orderMaterialRequirements(order: Pick<Order, "metal" | "diamondWeight">): {
  needsGold: boolean;
  needsDiamond: boolean;
} {
  return {
    needsGold: !GOLDLESS_METALS.has(order.metal),
    needsDiamond: order.diamondWeight > 0,
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

export function purchasePaid(p: Purchase): number {
  return (p.payments || []).reduce((s, x) => s + x.amountInr, 0);
}

export function purchasePending(p: Purchase): number {
  return Math.max(0, p.totalInr - purchasePaid(p));
}

/** Supplier account summary across all their purchases. */
export function supplierAccount(purchases: Purchase[]) {
  let totalPurchased = 0,
    totalPaid = 0,
    balanceOwed = 0,
    overpaid = 0;
  for (const p of purchases) {
    totalPurchased += p.totalInr;
    const paid = purchasePaid(p);
    totalPaid += paid;
    balanceOwed += Math.max(0, p.totalInr - paid);
    overpaid += Math.max(0, paid - p.totalInr);
  }
  return { totalPurchased: r0(totalPurchased), totalPaid: r0(totalPaid), balanceOwed: r0(balanceOwed), overpaid: r0(overpaid) };
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

export function issuancePaid(i: MaterialIssuance): number {
  return (i.makingCharges.payments || []).reduce((s, x) => s + x.amountInr, 0);
}

export function issuancePending(i: MaterialIssuance): number {
  return Math.max(0, i.makingCharges.amountInr - issuancePaid(i));
}

export function issuanceUsed(i: MaterialIssuance): number {
  return (i.finishedPieces || []).reduce((s, f) => s + f.quantityUsed, 0);
}

/** Only meaningful once `status === "closed"` — material not yet accounted for is still "in progress" until then. */
export function issuanceWastage(i: MaterialIssuance): number {
  return i.quantityIssued - issuanceUsed(i);
}

/**
 * How much of `material`+`purityOrQuality` is currently sitting at `factoryId`,
 * bulk-delivered but not yet drawn down for a specific order — the factory's
 * own accumulated pool. Both terms are derived, never stored:
 *   delivered = Σ quantityIssued of bulk deliveries (orderId unset) for this
 *               factory/material/purity
 *   drawn     = Σ quantityIssued of pool draws (orderId set, source
 *               "factoryPool") for this factory/material/purity
 * Floors at 0 defensively. This is a plain derived read over the app's normal
 * diffed in-memory sync — same trust level as clientAccount()/Order.advances,
 * NOT a Firestore transaction like src/lib/stock.ts's decreaseStock. Two staff
 * drawing from the same factory's pool at the exact same instant could both
 * pass this check (a deliberate, reviewed tradeoff — see manufacturingReadiness
 * comment style — rather than adding a second transactional subsystem for a
 * much lower-volume, single-factory-scoped number).
 */
export function factoryPoolBalance(
  issuances: MaterialIssuance[],
  factoryId: string,
  material: "gold" | "diamond",
  purityOrQuality: string,
): number {
  let delivered = 0, drawn = 0;
  for (const i of issuances) {
    if (i.factoryId !== factoryId || i.material !== material || i.purityOrQuality !== purityOrQuality) continue;
    if (!i.orderId) delivered += i.quantityIssued;
    else if (i.source === "factoryPool") drawn += i.quantityIssued;
  }
  return Math.max(0, Math.round((delivered - drawn) * 100) / 100);
}

/**
 * The factory's gold expressed in PURE / fine (24KT) grams — the client's
 * "factory gold stock". Gold ARRIVES as fine gold (each issuance's grams ×
 * its karat purity, for every gold issuance EXCEPT internal factoryPool draws,
 * which are just moving already-counted gold around within the factory) and
 * LEAVES as the pure-gold equivalent of each finished piece's net weight once
 * it's received back (finishedNetWeight × its karat). Balance = fine gold still
 * physically in the factory's hands. Derived, never stored (same trust level as
 * factoryPoolBalance above).
 */
export function factoryFineGoldBalance(issuances: MaterialIssuance[], factoryId: string): number {
  let inFine = 0, outFine = 0;
  for (const i of issuances) {
    if (i.factoryId !== factoryId || i.material !== "gold") continue;
    if (i.source !== "factoryPool") inFine += toPureGold(i.quantityIssued, i.purityOrQuality);
    if (i.finishedNetWeight && i.finishedKarat) outFine += toPureGold(i.finishedNetWeight, i.finishedKarat);
  }
  return Math.round((inFine - outFine) * 1000) / 1000;
}

/** Compute the structured labour value (factory payable) from an issuance's
 *  labour breakdown + its finished net weight + the order's diamond carats. */
export function labourValue(labour: NonNullable<MaterialIssuance["labour"]> | undefined, netWeight: number, diamondCt: number): number {
  if (!labour) return 0;
  const v =
    (labour.perGramRate || 0) * (netWeight || 0) +
    (labour.diamondHandlingRate || 0) * (diamondCt || 0) +
    (labour.cadCharge || 0) +
    (labour.otherCharges || 0) +
    (labour.metalByFactoryGrams || 0) * (labour.metalByFactoryRate || 0);
  return Math.round(v * 100) / 100;
}

/** Every purity/quality this factory currently holds a positive pool balance
 *  in, for `material` — drives the "draw from pool" picker. */
export function factoryPoolBuckets(
  issuances: MaterialIssuance[],
  factoryId: string,
  material: "gold" | "diamond",
): { purityOrQuality: string; balance: number }[] {
  const purities = new Set(
    issuances.filter(i => i.factoryId === factoryId && i.material === material && !i.orderId).map(i => i.purityOrQuality),
  );
  return [...purities]
    .map(purityOrQuality => ({ purityOrQuality, balance: factoryPoolBalance(issuances, factoryId, material, purityOrQuality) }))
    .filter(b => b.balance > 0);
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

/** Factory account summary across all their material issuances. Gold and
 *  diamond are tracked separately since their quantities are different units
 *  (grams vs carats) — making charges are combined (always INR). A
 *  source:"factoryPool" draw is NOT a new physical delivery (the material was
 *  already counted when it was bulk-delivered) — only its actual consumption
 *  (finishedPieces) counts toward goldUsed/diamondUsed, or goldOutstanding
 *  would double-count the moment any order draws from a factory's pool. */
export function factoryAccount(issuances: MaterialIssuance[]) {
  let goldIssued = 0,
    goldUsed = 0,
    diamondIssued = 0,
    diamondUsed = 0,
    chargesTotal = 0,
    chargesPaid = 0,
    chargesPending = 0,
    chargesOverpaid = 0;
  for (const i of issuances) {
    const isPoolDraw = i.source === "factoryPool";
    if (i.material === "gold") { if (!isPoolDraw) goldIssued += i.quantityIssued; goldUsed += issuanceUsed(i); }
    else { if (!isPoolDraw) diamondIssued += i.quantityIssued; diamondUsed += issuanceUsed(i); }
    chargesTotal += i.makingCharges.amountInr;
    const paid = issuancePaid(i);
    chargesPaid += paid;
    chargesPending += issuancePending(i);
    chargesOverpaid += Math.max(0, paid - i.makingCharges.amountInr);
  }
  return {
    goldIssued,
    goldUsed,
    goldOutstanding: goldIssued - goldUsed,
    diamondIssued,
    diamondUsed,
    diamondOutstanding: diamondIssued - diamondUsed,
    chargesTotal: r0(chargesTotal),
    chargesPaid: r0(chargesPaid),
    chargesPending: r0(chargesPending),
    chargesOverpaid: r0(chargesOverpaid),
  };
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
  orderId?: string;
  factoryId?: string;
  supplierId?: string;
}

interface StockLinkContext {
  purchases: Purchase[];
  issuances: MaterialIssuance[];
  orders: Order[];
  factories: Factory[];
  suppliers: Supplier[];
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
    const label = m.type === "purchase_in"
      ? `Purchased from ${supplier?.name ?? "supplier"}`
      : `Purchase void reversal — ${supplier?.name ?? "supplier"}`;
    return { label, supplierId: p.supplierId };
  }
  if (m.refType === "order" && m.refId) {
    const order = ctx.orders.find(o => o.id === m.refId);
    if (!order) return { label: m.note || "Used on order" };
    return { label: `Used directly on order ${order.orderNumber}`, orderId: order.id };
  }
  return { label: m.note || "Manual adjustment" };
}

/** Movements for one Stock bucket (material + purity/shape key), newest
 *  first, each enriched with its resolved link — drives Stock.tsx's
 *  per-bucket drill-down modal. */
export function stockBucketHistory(
  movements: StockMovement[],
  material: "gold" | "diamond",
  purityOrQuality: string | null,
  ctx: StockLinkContext,
): (StockMovement & { link: StockMovementLink })[] {
  return movements
    .filter(m => m.material === material && (purityOrQuality === null || m.purityOrQuality === purityOrQuality))
    .sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt))
    .map(m => ({ ...m, link: resolveStockMovementLink(m, ctx) }));
}

// ── Lockers (bank/cash accounts) ───────────────────────────────────────────

/** Running balance for one Locker — opening balance + income − expenses, netted with transfers. */
export function lockerBalance(locker: Locker, transactions: LockerTransaction[]): number {
  let bal = locker.openingBalance || 0;
  for (const t of transactions) {
    if (t.lockerId !== locker.id) continue;
    if (t.type === "income" || t.type === "transfer_in") bal += t.amountInr;
    else bal -= t.amountInr; // "expense" | "transfer_out"
  }
  return r0(bal);
}

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
