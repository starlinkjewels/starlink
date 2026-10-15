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
import { MAIN_COMPANY_ID, companyById, formatInvoiceNumber, invoiceSequenceName, invoicesOfCompany } from "./companies";
import type { Invoice, Settings } from "./db";

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

/**
 * Point a sequence at a given next value — admin repair only.
 *
 * Used after renumbering, which rewrites the book but leaves the counter where
 * it was: invoices renumbered to 0001–0017 with the counter still on 22 would
 * put the very next invoice at 0022 and open a five-number hole on the spot.
 *
 * Lowering a counter is safe here only because every reserve takes the highest
 * number already in the data as its floor, so a counter set too low still can
 * never hand out a number that is in use.
 */
export async function resetSequence(name: string, next: number): Promise<void> {
  const ref = doc(fsdb, COL, name);
  await runTransaction(fsdb, async (tx) => {
    tx.set(ref, { next, updatedAt: new Date().toISOString() }, { merge: true });
  });
}

/**
 * Hand a reserved number back, so a sequence that was claimed and then not used
 * does not leave a hole.
 *
 * Only takes it back when the counter is still sitting exactly one past it —
 * that is, when nobody has been handed a number since. If somebody has, the
 * number is genuinely spent and rolling back would hand the same one out twice,
 * which is far worse than a gap. Safe to call on every failed write.
 */
export async function releaseSequence(name: string, value: number): Promise<void> {
  const ref = doc(fsdb, COL, name);
  await runTransaction(fsdb, async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists()) return;
    const stored = Number((snap.data() as { next?: number }).next);
    if (stored !== value + 1) return; // someone else moved on — leave it alone
    tx.set(ref, { next: value, updatedAt: new Date().toISOString() }, { merge: true });
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

/**
 * Reserve the next invoice number of a company. Each company keeps its own
 * series: the first company's run on exactly as they always have ("0042"),
 * every other company's carry its prefix and start at 1 ("SJD-0001"). Only the
 * company's own invoices set the floor, so one company's bills can never push
 * another's numbers forward.
 */
export async function reserveInvoiceNumber(
  invoices: Pick<Invoice, "number" | "companyId">[],
  settings?: Settings,
  companyId: string = MAIN_COMPANY_ID,
): Promise<string> {
  const own = invoicesOfCompany(invoices as Invoice[], companyId);
  const floor = highestSuffix(own.map((i) => i.number), 0) + 1;
  const seq = await reserveSequence(invoiceSequenceName(companyId), floor);
  if (companyId === MAIN_COMPANY_ID || !settings) return String(seq).padStart(4, "0");
  return formatInvoiceNumber(companyById(settings, companyId), seq);
}

/**
 * Give an invoice number back when the invoice was not written after all.
 *
 * The number is claimed before the write, so a write that then refuses — every
 * order already billed, nothing eligible left — used to burn the number and
 * leave a hole in the sequence for good. That is where 0009, 0010, 0014, 0015
 * and 0017 went.
 */
export async function releaseInvoiceNumber(number: string, companyId: string = MAIN_COMPANY_ID): Promise<void> {
  const parts = String(number).split("-");
  const n = parseInt(parts[parts.length - 1], 10);
  if (!Number.isFinite(n)) return;
  await releaseSequence(invoiceSequenceName(companyId), n);
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


/** Reserve a credit-note number for a sales return — "CN-0001". The floor is
 *  the highest number already on any order's returns. */
export async function reserveCreditNoteNumber(orders: { returns?: { creditNoteNo: string }[] }[]): Promise<string> {
  const floor = highestSuffix(orders.flatMap((o) => (o.returns ?? []).map((r) => r.creditNoteNo)), 0) + 1;
  const seq = await reserveSequence("creditNoteNo", floor);
  return `CN-${String(seq).padStart(4, "0")}`;
}

/** Hand a credit-note number back when the return it was reserved for was never written. */
export async function releaseCreditNoteNumber(no: string): Promise<void> {
  const n = parseInt(no.replace(/^CN-/, ""), 10);
  if (n > 0) await releaseSequence("creditNoteNo", n);
}

/** Reserve a globally-unique certified-diamond stock number ("DP-0007"). */
export async function reserveDiamondStockNumber(packets: { stockNumber?: string }[]): Promise<string> {
  const floor = highestSuffix(packets.map((p) => p.stockNumber), 0) + 1;
  const seq = await reserveSequence("diamondStockNumber", floor);
  return `DP-${String(seq).padStart(4, "0")}`;
}
