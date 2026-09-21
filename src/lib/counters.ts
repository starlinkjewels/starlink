// Atomic sequence numbers (order no., invoice no., diamond stock no.).
//
// Deriving "next number" from the data in memory (max + 1) is NOT safe with
// more than one person working: two users creating an order in the same moment
// both read the same max and both mint the same number — which is exactly how
// duplicate order numbers reached production. The only correct answer is a
// counter incremented inside a Firestore TRANSACTION, so the database itself
// serialises the two requests and hands out different numbers.
//
// Same reasoning as src/lib/stock.ts: a diffed/last-write-wins array sync can
// never guarantee this, so these live in their own tiny direct-Firestore doc.
import { doc, runTransaction } from "firebase/firestore";
import { db as fsdb } from "./firebase";

const COL = "counters";

/**
 * Reserve the next value of a named sequence — atomic across every device.
 *
 * `floor` is the lowest value that is still safe to hand out (normally
 * "highest number already in the data" + 1). The result is always >= floor, so
 * the counter self-heals: a fresh account seeds correctly, and a restored
 * backup or a counter that somehow fell behind can never re-issue a number
 * that is already in use.
 */
export async function reserveSequence(name: string, floor: number): Promise<number> {
  const ref = doc(fsdb, COL, name);
  return runTransaction(fsdb, async (tx) => {
    const snap = await tx.get(ref);
    const stored = snap.exists() ? Number((snap.data() as { next?: number }).next) : NaN;
    const next = Math.max(Number.isFinite(stored) ? stored : 0, floor);
    tx.set(ref, { next: next + 1, updatedAt: new Date().toISOString() }, { merge: true });
    return next;
  });
}

/** Highest trailing number already used in a list ("SLJ-2026-1035" → 1035). */
export function highestSuffix(values: (string | undefined)[], base: number): number {
  let max = base;
  for (const v of values) {
    const parts = String(v ?? "").split("-");
    const n = parseInt(parts[parts.length - 1], 10);
    if (!isNaN(n) && n > max) max = n;
  }
  return max;
}

/**
 * Reserve a globally-unique order number. Await this BEFORE writing the order —
 * the number is claimed in the database, so a second person creating an order
 * at the same instant is handed the next one instead of a duplicate.
 */
export async function reserveOrderNumber(orders: { orderNumber?: string }[]): Promise<string> {
  const floor = highestSuffix(orders.map((o) => o.orderNumber), 1000) + 1;
  const seq = await reserveSequence("orderNumber", floor);
  return `SLJ-${new Date().getFullYear()}-${String(seq).padStart(4, "0")}`;
}

/** Reserve a globally-unique invoice number ("0042"). */
export async function reserveInvoiceNumber(invoices: { number?: string }[]): Promise<string> {
  const floor = highestSuffix(invoices.map((i) => i.number), 0) + 1;
  const seq = await reserveSequence("invoiceNumber", floor);
  return String(seq).padStart(4, "0");
}

/**
 * Reserve a globally-unique receipt number for money received from a client.
 * Awaited BEFORE the receipt is written, so two people banking a payment at the
 * same moment can never be handed the same number.
 */
export async function reserveReceiptNumber(receipts: { receiptNo?: string }[]): Promise<string> {
  const floor = highestSuffix(receipts.map((r) => r.receiptNo), 0) + 1;
  const seq = await reserveSequence("clientReceiptNo", floor);
  return String(seq).padStart(4, "0");
}


/** Reserve a voucher number for a cash entry — "V-0042". */
export async function reserveVoucherNumber(txns: { voucherNo?: string }[]): Promise<string> {
  const floor = highestSuffix(txns.map((t) => t.voucherNo), 0) + 1;
  const seq = await reserveSequence("voucherNo", floor);
  return `V-${String(seq).padStart(4, "0")}`;
}


/** Reserve a globally-unique certified-diamond stock number ("DP-0007"). */
export async function reserveDiamondStockNumber(packets: { stockNumber?: string }[]): Promise<string> {
  const floor = highestSuffix(packets.map((p) => p.stockNumber), 0) + 1;
  const seq = await reserveSequence("diamondStockNumber", floor);
  return `DP-${String(seq).padStart(4, "0")}`;
}
