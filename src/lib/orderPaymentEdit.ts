// Correcting or cancelling a payment from the order it was taken on.
//
// Every payment is a numbered receipt (lib/receipts.ts). Cancelling one goes
// through deleteReceipt() as everywhere else. Correcting one is done here, in
// place, for the common case — a payment taken on this order and landing only
// on it — because receipts.ts's editReceipt() re-runs the account-wide
// settlement, which without an invoice named parks the whole amount as client
// credit: the order would show unpaid again, and the deposit row would be
// re-made under a new voucher. In place, the money stays on this order, the
// deposit keeps its voucher, and the receipt keeps its number.
// Anything wider (a receipt that also paid other orders, or left credit) is
// corrected in Payments → Payments Received, which handles the whole receipt.
import {
  loadDb, updateDbAs, uid, balanceDue, collectionLoaded,
  type DB, type Order, type AdvancePayment, type ClientReceipt,
} from "./db";
import { ccy } from "./currency";

const r2 = (n: number) => Math.round(n * 100) / 100;
const list = (xs: string[]) => (xs.length <= 2 ? xs.join(", ") : `${xs.slice(0, 2).join(", ")} and ${xs.length - 2} more`);

/** The receipt a payment row came in on, or why it has none to act on. */
export function paymentReceipt(db: Pick<DB, "clientReceipts">, a: AdvancePayment): { rec?: ClientReceipt; why?: string } {
  if (a.fromCredit) return { why: "Moved from credit — undo it from the client's account" };
  if (!a.receiptId) return { why: "Recorded before receipts were numbered — there is no receipt to change" };
  if (!collectionLoaded("clientReceipts")) return { why: "Still loading the receipts — try again in a moment" };
  const rec = (db.clientReceipts ?? []).find(r => r.id === a.receiptId);
  if (!rec) return { why: "Its receipt is missing — check Payments → Payments Received" };
  return { rec };
}

/** Why this payment can't be corrected from the order page; undefined when it can. */
export function orderPaymentEditBlocker(db: Pick<DB, "clientReceipts" | "orders">, order: Order, a: AdvancePayment): string | undefined {
  const { rec, why } = paymentReceipt(db, a);
  if (!rec) return why;
  if (rec.invoiceId) return `Receipt ${rec.receiptNo} was sent against an invoice — correct it in Payments → Payments Received`;
  const elsewhere = db.orders.filter(o => o.id !== order.id && (o.advances ?? []).some(x => x.receiptId === rec.id));
  if (elsewhere.length) return `Receipt ${rec.receiptNo} also paid ${list(elsewhere.map(o => o.orderNumber))} — correct it in Payments → Payments Received`;
  const here = (order.advances ?? []).filter(x => x.receiptId === rec.id);
  if (here.length !== 1) return `Receipt ${rec.receiptNo} is split over several lines here — correct it in Payments → Payments Received`;
  if (Math.abs(rec.amountUsd - here[0].amount) > 0.005) return `Part of receipt ${rec.receiptNo} is held as the client's credit — correct it in Payments → Payments Received`;
  return undefined;
}

export interface OrderPaymentEdit {
  amountUsd: number;
  /** ISO — when the money came in. */
  date: string;
  note: string;
  lockerId?: string;
  /** What landed in the locker, in its own currency. */
  lockerAmount?: number;
  /** The locker's currency for $1, when it isn't USD. */
  exchangeRate?: number;
  userId: string;
}

/**
 * Apply a correction worked out by the dialog. Never more onto the order than
 * its balance (counting this payment back out first); the rest goes to the
 * client's credit, exactly as when a payment is taken. Returns that excess.
 */
export function editOrderPayment(orderId: string, advanceId: string, e: OrderPaymentEdit): number {
  let toCredit = 0;
  const now = loadDb();
  const o0 = now.orders.find(x => x.id === orderId);
  const a0 = o0?.advances?.find(x => x.id === advanceId);
  if (!o0 || !a0) throw new Error("That payment is not there any more");
  // Checked before the save starts — a refusal must not leave a half-labelled save behind.
  const why = orderPaymentEditBlocker(now, o0, a0);
  if (why) throw new Error(why);
  const no = (now.clientReceipts ?? []).find(r => r.id === a0.receiptId)?.receiptNo ?? "";
  updateDbAs({ summary: `Corrected receipt ${no} on order ${o0?.orderNumber ?? ""} — $${e.amountUsd.toLocaleString()}` }, d => {
    const o = d.orders.find(x => x.id === orderId);
    const a = o?.advances?.find(x => x.id === advanceId);
    const rec = a ? d.clientReceipts?.find(r => r.id === a.receiptId) : undefined;
    if (!o || !a || !rec) return;
    const room = r2(balanceDue(o) + a.amount);
    const applied = r2(Math.min(e.amountUsd, room));
    toCredit = r2(e.amountUsd - applied);
    const locker = e.lockerId ? d.lockers.find(l => l.id === e.lockerId) : undefined;
    const lc = locker ? ccy(locker.currency) : undefined;

    a.amount = applied;
    a.note = e.note;
    a.createdAt = e.date;
    a.lockerId = locker?.id;
    a.lockerAmount = locker ? e.lockerAmount : undefined;
    if (toCredit > 0) {
      const c = d.clients.find(x => x.id === o.clientId);
      if (c) c.creditBalance = r2((c.creditBalance || 0) + toCredit);
    }

    rec.amountUsd = r2(e.amountUsd);
    rec.date = e.date;
    rec.method = e.note;
    rec.lockerId = locker?.id;
    rec.lockerAmount = locker ? e.lockerAmount : undefined;
    rec.lockerCurrency = lc;
    rec.exchangeRate = locker && lc !== "USD" ? e.exchangeRate : undefined;
    rec.updatedAt = new Date().toISOString();

    // The deposit is corrected where it is, so it keeps its voucher number.
    if (!d.lockerTransactions) d.lockerTransactions = [];
    const txn = d.lockerTransactions.find(t => t.receiptId === rec.id);
    if (locker) {
      if (txn) {
        txn.lockerId = locker.id;
        txn.amountInr = e.lockerAmount ?? e.amountUsd;
        txn.currency = lc;
        txn.exchangeRate = lc !== "USD" ? e.exchangeRate : undefined;
        txn.createdAt = e.date;
      } else {
        d.lockerTransactions.push({
          id: uid("ltx_"), lockerId: locker.id, type: "income", amountInr: e.lockerAmount ?? e.amountUsd,
          currency: lc, category: `Client Payment — ${o.orderNumber}`, refType: "clientPayment", refId: o.id,
          receiptId: rec.id, exchangeRate: lc !== "USD" ? e.exchangeRate : undefined,
          recordedBy: e.userId, createdAt: e.date,
        });
      }
    } else if (txn) {
      d.lockerTransactions = d.lockerTransactions.filter(t => t.id !== txn.id);
    }
  });
  return toCredit;
}
