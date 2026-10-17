// Correcting or cancelling a payment from the order it was taken on.
//
// Every payment is a numbered receipt (lib/receipts.ts). Cancelling one goes
// through deleteReceipt() as everywhere else. Correcting one is done here, in
// place, for the common case — a payment taken on this order and landing only
// on it. In place, the money stays on this order, the deposit keeps its row and
// voucher, and the receipt keeps its number. Anything wider (a receipt that
// also paid other orders, left credit, or carried credit onto this bill) is
// corrected in Payments → Payments Received, which handles the whole receipt.
//
// The deposit is only ever corrected where it is. A payment whose account
// entry was written before deposits were tagged with their receipt is matched
// to it only when nothing else could be it (receiptDeposit); otherwise the
// correction is refused — writing a fresh entry would leave the money in the
// account twice.
import {
  loadDb, updateDbAs, uid, balanceDue, collectionLoaded, fmtMoney,
  type DB, type Order, type AdvancePayment, type ClientReceipt,
} from "./db";
import { ccy } from "./currency";
import { UNLINKED_DEPOSIT, depositExcess, depositRows, followDate, receiptDeposit } from "./receipts";

const r2 = (n: number) => Math.round(n * 100) / 100;
const list = (xs: string[]) => (xs.length <= 2 ? xs.join(", ") : `${xs.slice(0, 2).join(", ")} and ${xs.length - 2} more`);

/** The receipt a payment row came in on, read from the records as they are. */
function receiptOf(db: Pick<DB, "clientReceipts">, a: AdvancePayment): { rec?: ClientReceipt; why?: string } {
  if (a.fromCredit) return { why: "Moved from credit — undo it from the client's account" };
  if (!a.receiptId) return { why: "Recorded before receipts were numbered — there is no receipt to change" };
  const rec = (db.clientReceipts ?? []).find(r => r.id === a.receiptId);
  if (!rec) return { why: "Its receipt is missing — check Payments → Payments Received" };
  return { rec };
}

/** The receipt a payment row came in on, or why it has none to act on. */
export function paymentReceipt(db: Pick<DB, "clientReceipts">, a: AdvancePayment): { rec?: ClientReceipt; why?: string } {
  if (!a.fromCredit && a.receiptId && !collectionLoaded("clientReceipts")) return { why: "Still loading the receipts — try again in a moment" };
  return receiptOf(db, a);
}

/** An older payment whose account entry can't be told apart from its
 *  neighbours: nothing about it is corrected from the order page. */
export const UNLINKED_ON_ORDER = "This payment's account entry can't be told apart from another one (an older entry), so it isn't corrected here — its remark and mode can be corrected in Payments → Payments Received";

type EditDb = Pick<DB, "clientReceipts" | "orders" | "lockerTransactions">;

/** The checks that read only the records (nothing about what has loaded). */
function blockerFor(db: EditDb, order: Order, a: AdvancePayment, rec: ClientReceipt): string | undefined {
  if (rec.invoiceId) return `Receipt ${rec.receiptNo} was sent against an invoice — correct it in Payments → Payments Received`;
  const elsewhere = db.orders.filter(o => o.id !== order.id && (o.advances ?? []).some(x => x.receiptId === rec.id));
  if (elsewhere.length) return `Receipt ${rec.receiptNo} also paid ${list(elsewhere.map(o => o.orderNumber))} — correct it in Payments → Payments Received`;
  const here = (order.advances ?? []).filter(x => x.receiptId === rec.id);
  if (here.length !== 1) return `Receipt ${rec.receiptNo} is split over several lines here — correct it in Payments → Payments Received`;
  if (here[0].amount > rec.amountUsd + 0.005) return `Receipt ${rec.receiptNo} also carried credit the client already had onto this order — correct it in Payments → Payments Received`;
  if (Math.abs(rec.amountUsd - here[0].amount) > 0.005) return `Part of receipt ${rec.receiptNo} is held as the client's credit — correct it in Payments → Payments Received`;
  const dep = receiptDeposit(db, rec, { lockerId: a.lockerId, lockerAmount: a.lockerAmount, at: a.createdAt });
  if (!dep.row && dep.why) {
    return dep.why === UNLINKED_DEPOSIT ? UNLINKED_ON_ORDER : dep.why;
  }
  return undefined;
}

/** Why this payment can't be corrected from the order page; undefined when it can. */
export function orderPaymentEditBlocker(db: EditDb, order: Order, a: AdvancePayment): string | undefined {
  const { rec, why } = paymentReceipt(db, a);
  if (!rec) return why;
  if (!collectionLoaded("lockerTransactions")) return "Still loading the account entries — try again in a moment";
  return blockerFor(db, order, a, rec);
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
 * Make the correction (inside updateDb). Everything is checked first; a
 * refusal comes back as `why` with nothing touched. Never more onto the order
 * than its balance (counting this payment back out first); the rest goes to
 * the client's credit, exactly as when a payment is taken.
 */
export function applyOrderPaymentEdit(d: DB, orderId: string, advanceId: string, e: OrderPaymentEdit): { toCredit: number } | { why: string } {
  const o = d.orders.find(x => x.id === orderId);
  const a = o?.advances?.find(x => x.id === advanceId);
  if (!o || !a) return { why: "That payment is not there any more" };
  const { rec, why } = receiptOf(d, a);
  if (!rec) return { why: why! };
  const block = blockerFor(d, o, a, rec);
  if (block) return { why: block };
  if (!(e.amountUsd > 0)) return { why: "Enter the amount received" };
  if (isNaN(+new Date(e.date))) return { why: "Pick the day it came in" };
  const locker = e.lockerId ? d.lockers.find(l => l.id === e.lockerId) : undefined;
  if (e.lockerId && !locker) return { why: "That account is not there any more — pick another" };
  const lc = locker ? ccy(locker.currency) : undefined;
  const dep = receiptDeposit(d, rec, { lockerId: a.lockerId, lockerAmount: a.lockerAmount, at: a.createdAt });
  const txn = dep.row;
  // An older payment taken over this order's balance: its receipt is for what
  // went on the order, its deposit for all of it, the rest already on credit.
  // Raising it here would put that money on credit and in the account again —
  // Payments Received raises it by relabelling, moving nothing.
  const excess = depositExcess(d, rec, depositRows(dep));
  if (excess > 0 && e.amountUsd > rec.amountUsd + 0.005) {
    return { why: `Receipt ${rec.receiptNo}'s deposit already holds ${fmtMoney(excess)} more than it (paid over the balance, held as credit) — raise it in Payments → Payments Received` };
  }
  // What landed is its own figure in every currency — a wire fee can leave
  // less than was paid. Given, it is used. Not given, a dollar deposit stands
  // as it is and moves only by a change to the amount; it is never reset to
  // the amount (that would put money in the account that never arrived).
  const wasUsd = txn && ccy(txn.currency) === "USD" ? txn.amountInr : undefined;
  const deposited = !locker ? undefined
    : e.lockerAmount && e.lockerAmount > 0 ? e.lockerAmount
    : lc === "USD" ? r2((wasUsd ?? rec.amountUsd) + e.amountUsd - rec.amountUsd)
    : undefined;
  if (locker && !(deposited! > 0)) return { why: `Enter what actually landed in ${locker.name}` };

  const room = r2(balanceDue(o) + a.amount);
  const applied = r2(Math.min(e.amountUsd, room));
  const toCredit = r2(e.amountUsd - applied);
  const wasAt = a.createdAt;

  a.amount = applied;
  a.note = e.note;
  a.createdAt = e.date;
  a.lockerId = locker?.id;
  a.lockerAmount = locker ? deposited : undefined;
  if (toCredit > 0) {
    const c = d.clients.find(x => x.id === o.clientId);
    if (c) c.creditBalance = r2((c.creditBalance || 0) + toCredit);
  }

  rec.amountUsd = r2(e.amountUsd);
  rec.date = followDate(rec.date, wasAt, e.date);
  rec.method = e.note;
  rec.lockerId = locker?.id;
  rec.lockerAmount = locker ? deposited : undefined;
  rec.lockerCurrency = lc;
  rec.exchangeRate = locker && lc !== "USD" ? e.exchangeRate : undefined;
  rec.updatedAt = new Date().toISOString();

  // The deposit is corrected where it is, so it keeps its voucher number.
  if (locker) {
    if (txn) {
      if (dep.adopt) txn.receiptId = rec.id;
      txn.lockerId = locker.id;
      txn.amountInr = deposited!;
      if (ccy(txn.currency) !== lc) txn.currency = lc;
      txn.exchangeRate = lc !== "USD" ? e.exchangeRate : undefined;
      txn.createdAt = followDate(txn.createdAt, wasAt, e.date);
    } else {
      // Only when it had no deposit at all (blockerFor refuses an unlinked one).
      if (!d.lockerTransactions) d.lockerTransactions = [];
      d.lockerTransactions.push({
        id: uid("ltx_"), lockerId: locker.id, type: "income", amountInr: deposited!,
        currency: lc, category: `Client Payment — ${o.orderNumber}`, refType: "clientPayment", refId: o.id,
        receiptId: rec.id, exchangeRate: lc !== "USD" ? e.exchangeRate : undefined,
        recordedBy: e.userId, createdAt: e.date,
      });
    }
  } else if (txn) {
    d.lockerTransactions = (d.lockerTransactions ?? []).filter(t => t.id !== txn.id);
  }
  return { toCredit };
}

/**
 * Apply a correction worked out by the dialog. Returns what went over the
 * order's balance to the client's credit. Throws, having changed nothing, when
 * it can't be done — the message says why.
 */
export function editOrderPayment(orderId: string, advanceId: string, e: OrderPaymentEdit): number {
  const now = loadDb();
  const o0 = now.orders.find(x => x.id === orderId);
  const a0 = o0?.advances?.find(x => x.id === advanceId);
  if (!o0 || !a0) throw new Error("That payment is not there any more");
  // Checked before the save starts — a refusal must not leave a half-labelled save behind.
  const why = orderPaymentEditBlocker(now, o0, a0);
  if (why) throw new Error(why);
  const no = (now.clientReceipts ?? []).find(r => r.id === a0.receiptId)?.receiptNo ?? "";
  let res = { toCredit: 0 } as { toCredit: number } | { why: string };
  updateDbAs({ summary: `Corrected receipt ${no} on order ${o0.orderNumber} — $${e.amountUsd.toLocaleString()}` }, d => {
    res = applyOrderPaymentEdit(d, orderId, advanceId, e);
  });
  if ("why" in res) throw new Error(res.why);
  return res.toCredit;
}
