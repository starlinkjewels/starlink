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
  type Purchase,
  type MaterialIssuance,
  type Locker,
  type LockerTransaction,
  type Order,
} from "./db";

const r0 = (n: number) => Math.round(n);

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
  order: Pick<Order, "id" | "metal" | "diamondWeight">,
  issuances: MaterialIssuance[],
): { ready: boolean; missing: ("gold" | "diamond")[] } {
  const { needsGold, needsDiamond } = orderMaterialRequirements(order);
  const orderIssuances = issuances.filter(i => i.orderId === order.id);
  const missing: ("gold" | "diamond")[] = [];
  if (needsGold && !orderIssuances.some(i => i.material === "gold")) missing.push("gold");
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

/** Factory account summary across all their material issuances. Gold and
 *  diamond are tracked separately since their quantities are different units
 *  (grams vs carats) — making charges are combined (always INR). */
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
    if (i.material === "gold") { goldIssued += i.quantityIssued; goldUsed += issuanceUsed(i); }
    else { diamondIssued += i.quantityIssued; diamondUsed += issuanceUsed(i); }
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
