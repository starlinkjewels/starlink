// Whether a supplier or factory can be deleted, and why not.
//
// Deleting one with purchases, issues or payments against it would leave those
// records pointing at nobody — dues, stock trails and factory balances with no
// party to show them under. Those are deactivated instead, as a company with
// clients is (Settings → Companies).
//
// The supplier and factory LISTS are light pages (pageData.ts): they draw from
// the server's totals and do not download the books. So a list passes the
// figures it shows and its menu reads ONLY those (and the orders, which are
// always loaded) — the same words whether or not the books happen to be
// loaded, never a count of records that may not have arrived. A party's own
// page loads its books and counts them. The delete itself always loads the
// records and counts them before anything is removed (deleteRefusal), and
// counts again on the live records as it removes it.
import {
  collectionsLoaded, loadDb, openingCreditAmt,
  type DB, type Factory, type Supplier,
} from "./db";
import { TOTALS_COLS } from "./pageData";
import type { FactoryFigures, SupplierFigures } from "./partyTotals";
import { CHECKING, STILL_LOADING, recordsReady } from "./actionHints";

export interface DeleteGuard {
  ok: boolean;
  /** Why not, in the words the ⋯ menu shows under a greyed Delete. */
  reason?: string;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const has = (parts: string[]): DeleteGuard =>
  parts.length ? { ok: false, reason: `Has ${parts.join(" and ")} — deactivate instead` } : { ok: true };
const CHECKING_GUARD: DeleteGuard = { ok: false, reason: CHECKING };

/** A supplier with no purchases, payments or refunds may go. `figures`: the
 *  totals a list page shows — given, they are all the menu reads. */
export function supplierDeleteGuard(db: DB, s: Supplier, figures?: SupplierFigures): DeleteGuard {
  if (figures) {
    // Purchased includes an opening balance, which is the supplier's own field
    // and goes with them; anything beyond it is a real purchase.
    const bought = figures.totalPurchased - openingCreditAmt(s) > 0.5;
    const paid = figures.totalPaid > 0.5 || figures.received > 0.5;
    return bought || paid ? { ok: false, reason: "Has purchases / payments — deactivate instead" } : { ok: true };
  }
  if (!collectionsLoaded(TOTALS_COLS.supplier)) return CHECKING_GUARD;
  const purchases = (db.purchases ?? []).filter(p => p.supplierId === s.id).length;
  const payments = (db.supplierPayments ?? []).filter(p => p.supplierId === s.id).length
    + (db.supplierReceipts ?? []).filter(r => r.supplierId === s.id).length;
  return has([
    purchases ? plural(purchases, "purchase") : "",
    payments ? plural(payments, "payment") : "",
  ].filter(Boolean));
}

/** A factory with no material issued, no payments and no order assigned to it
 *  may go. `figures`: the totals a list page shows — given, they and the
 *  orders are all the menu reads. */
export function factoryDeleteGuard(db: DB, f: Factory, figures?: FactoryFigures): DeleteGuard {
  // Orders are always loaded; an order tagged to this factory would point at nobody.
  const orders = db.orders.filter(o => o.assignedFactoryId === f.id).length;
  const assigned = orders ? plural(orders, "order assigned", "orders assigned") : "";
  if (figures) {
    const charged = figures.chargesTotal - openingCreditAmt(f) > 0.5;
    const moved = figures.goldIssued > 0 || figures.diamondIssued > 0 || figures.goldUsed > 0 || figures.diamondUsed > 0;
    const paid = figures.chargesPaid > 0.5;
    return has([charged || moved || paid ? "material issues / payments" : "", assigned].filter(Boolean));
  }
  if (!collectionsLoaded(TOTALS_COLS.factory)) return CHECKING_GUARD;
  const issues = (db.materialIssuances ?? []).filter(i => i.factoryId === f.id).length;
  const payments = (db.factoryPayments ?? []).filter(p => p.factoryId === f.id).length;
  return has([
    issues ? plural(issues, "issue") : "",
    payments ? plural(payments, "payment") : "",
    assigned,
  ].filter(Boolean));
}

/**
 * The check a delete makes before it asks: loads the records behind the totals
 * (a no-op where they are loaded already) and counts them exactly. Returns the
 * refusal, or undefined when it may go — and refuses outright when the records
 * have still not arrived, rather than count what isn't there.
 */
export async function deleteRefusal(kind: "supplier", party: Supplier): Promise<string | undefined>;
export async function deleteRefusal(kind: "factory", party: Factory): Promise<string | undefined>;
export async function deleteRefusal(kind: "supplier" | "factory", party: Supplier | Factory): Promise<string | undefined> {
  if (!(await recordsReady(TOTALS_COLS[kind]))) return STILL_LOADING;
  const db = loadDb();
  const g = kind === "supplier" ? supplierDeleteGuard(db, party as Supplier) : factoryDeleteGuard(db, party as Factory);
  return g.ok ? undefined : g.reason;
}
