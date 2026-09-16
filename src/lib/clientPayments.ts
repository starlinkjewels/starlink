// Money a client sent that never reached their orders.
//
// The Locker's "Record Transaction" writes a plain income row (refType
// "manual"): the cash lands in the locker and nothing else happens. Recorded
// that way, a client's payment shows in the locker ledger while their invoice
// still reads as pending — which is exactly how invoice 0001 ended up $5,300
// short after the client had transferred the full $7,820.
//
// This module is the single implementation of the repair, shared by the fix-up
// link on a locker row and the Settings panel that sweeps up every old one, so
// the two can never disagree.
import {
  loadDb, updateDb, totalAdvance, balanceDue, invoiceOrderIds,
  settleClientAccount,
  type DB, type LockerTransaction, type Order,
} from "./db";

/** Income rows that are not tagged as a client payment — the ones that may be
 *  sitting in a locker without ever having settled anybody's bill. */
export function unappliedIncome(db: DB): LockerTransaction[] {
  return (db.lockerTransactions ?? [])
    .filter(t => t.type === "income" && t.refType !== "clientPayment")
    .sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));
}

/** What an invoice still has outstanding, read live from its orders. */
export function invoiceBalance(db: DB, invoiceId: string): number {
  const inv = (db.invoices ?? []).find(i => i.id === invoiceId);
  if (!inv) return 0;
  return invoiceOrderIds(inv)
    .map(oid => db.orders.find(o => o.id === oid))
    .filter((o): o is Order => !!o && o.status !== "Rejected")
    .reduce((s, o) => s + balanceDue(o), 0);
}

/**
 * Apply an existing income row to a client's bills.
 *
 * The locker row is NOT duplicated and its amount is NOT changed — that cash
 * was always counted correctly. Only the missing allocation runs, and the row
 * is re-tagged so it can't be applied twice.
 *
 * `exchangeRate` is required when the locker is not in USD, because orders are
 * billed in USD and we need to know how much of the bill this actually settles.
 * Returns how much of the client's billing it cleared.
 */
export function applyIncomeToClient(args: {
  txnId: string;
  clientId: string;
  invoiceId?: string;
  exchangeRate?: number;
  userId: string;
}): { ok: true; settled: number; billed: number } | { ok: false; error: string } {
  const db = loadDb();
  const txn = (db.lockerTransactions ?? []).find(t => t.id === args.txnId);
  if (!txn) return { ok: false, error: "That locker entry couldn't be found." };
  if (txn.refType === "clientPayment") {
    return { ok: false, error: "This entry is already applied to a client's account." };
  }
  const client = db.clients.find(c => c.id === args.clientId);
  if (!client) return { ok: false, error: "Choose the client this money came from." };

  const isUsd = (txn.currency ?? "INR") === "USD";
  const rate = args.exchangeRate ?? 0;
  if (!isUsd && rate <= 0) {
    return { ok: false, error: "Enter the exchange rate — clients are billed in USD." };
  }
  const billed = isUsd ? txn.amountInr : Math.round((txn.amountInr / rate) * 100) / 100;
  if (billed <= 0) return { ok: false, error: "That entry has no amount to apply." };

  const advancesOf = (d: DB) =>
    d.orders.filter(o => o.clientId === client.id).reduce((s, o) => s + totalAdvance(o), 0);

  const now = new Date().toISOString();
  let settled = 0;
  updateDb(d => {
    const t = (d.lockerTransactions ?? []).find(x => x.id === args.txnId);
    const c = d.clients.find(x => x.id === args.clientId);
    if (!t || !c || t.refType === "clientPayment") return;
    const before = advancesOf(d);
    settleClientAccount(d, c.id, billed, args.userId, now, t.note, args.invoiceId);
    settled = Math.round((advancesOf(d) - before) * 100) / 100;
    t.refType = "clientPayment";
    t.refId = c.id;
    t.category = `Client Payment — ${c.companyName}`;
    if (!isUsd) t.exchangeRate = rate;
  });
  return { ok: true, settled, billed };
}
