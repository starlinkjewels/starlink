import { collectionsLoaded, type DB } from "./db";
import type { LazyCol } from "./pageData";

/** Everything that can name an account, on demand — loaded before a delete is
 *  allowed, so an account that some payment still names is never removed. */
export const LOCKER_REF_COLS: LazyCol[] = [
  "lockerTransactions", "clientReceipts", "purchases", "materialIssuances",
  "supplierReceipts", "supplierPayments", "factoryPayments", "diamondSales",
];

/**
 * How many records name this account — its own entries, the other side of a
 * transfer, and every payment, receipt, expense, sale or order advance that
 * says it went through it. Only collections already loaded are read (an early
 * read would load them with a warning); `complete` says whether that was all.
 */
export function lockerUsage(db: DB, id: string): { count: number; complete: boolean } {
  const has = (c: LazyCol) => collectionsLoaded([c]);
  let count = 0;
  if (has("lockerTransactions")) count += (db.lockerTransactions ?? []).filter(t => t.lockerId === id || t.pairedLockerId === id).length;
  if (has("clientReceipts")) count += (db.clientReceipts ?? []).filter(r => r.lockerId === id).length;
  if (has("purchases")) count += (db.purchases ?? []).reduce((s, p) => s + (p.payments ?? []).filter(x => x.lockerId === id).length, 0);
  if (has("materialIssuances")) count += (db.materialIssuances ?? []).reduce((s, mi) => s + (mi.makingCharges?.payments ?? []).filter(x => x.lockerId === id).length, 0);
  if (has("supplierReceipts")) count += (db.supplierReceipts ?? []).filter(r => r.lockerId === id).length;
  if (has("supplierPayments")) count += (db.supplierPayments ?? []).filter(r => r.lockerId === id).length;
  if (has("factoryPayments")) count += (db.factoryPayments ?? []).filter(r => r.lockerId === id).length;
  if (has("diamondSales")) count += (db.diamondSales ?? []).filter(s => s.lockerId === id).length;
  count += (db.expenses ?? []).filter(e => e.lockerId === id).length;
  count += db.orders.reduce((s, o) => s + (o.advances ?? []).filter(a => a.lockerId === id).length, 0);
  return { count, complete: LOCKER_REF_COLS.every(has) };
}

/** Why this account cannot be deleted, or nothing when it can. An account
 *  with history is deactivated instead: hidden from every picker, its
 *  entries and balance kept for the books. */
export function lockerDeleteBlock(db: DB, id: string): string | undefined {
  const { count } = lockerUsage(db, id);
  return count > 0 ? `Has ${count} entr${count === 1 ? "y" : "ies"} — deactivate instead` : undefined;
}
