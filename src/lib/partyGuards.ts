// Whether a supplier or factory can be deleted, and why not.
//
// Deleting one with purchases, issues or payments against it would leave those
// records pointing at nobody — dues, stock trails and factory balances with no
// party to show them under. Those are deactivated instead, as a company with
// clients is (Settings → Companies).
//
// The supplier and factory LISTS are light pages (pageData.ts): they draw from
// the server's totals and do not download the books. So the guard counts the
// records when they are loaded, and otherwise reads the totals — any purchase
// or money at all means something is there. The delete itself always loads the
// records and counts them before anything is removed (confirmDeletable).
import {
  collectionsLoaded, ensureCollections, loadDb, openingCreditAmt,
  type DB, type Factory, type Supplier,
} from "./db";
import { TOTALS_COLS } from "./pageData";
import type { FactoryFigures, SupplierFigures } from "./partyTotals";

export interface DeleteGuard {
  ok: boolean;
  /** Why not, in the words the ⋯ menu shows under a greyed Delete. */
  reason?: string;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const has = (parts: string[]): DeleteGuard =>
  parts.length ? { ok: false, reason: `Has ${parts.join(" and ")} — deactivate instead` } : { ok: true };

/** A supplier with no purchases, payments or refunds may go. `figures`: the
 *  totals the list page already worked out, used when the records are not loaded. */
export function supplierDeleteGuard(db: DB, s: Supplier, figures?: SupplierFigures): DeleteGuard {
  if (collectionsLoaded(TOTALS_COLS.supplier)) {
    const purchases = (db.purchases ?? []).filter(p => p.supplierId === s.id).length;
    const payments = (db.supplierPayments ?? []).filter(p => p.supplierId === s.id).length
      + (db.supplierReceipts ?? []).filter(r => r.supplierId === s.id).length;
    return has([
      purchases ? plural(purchases, "purchase") : "",
      payments ? plural(payments, "payment") : "",
    ].filter(Boolean));
  }
  if (!figures) return { ok: true };
  // Purchased includes an opening balance, which is the supplier's own field
  // and goes with them; anything beyond it is a real purchase.
  const bought = figures.totalPurchased - openingCreditAmt(s) > 0.5;
  const paid = figures.totalPaid > 0.5 || figures.received > 0.5;
  return bought || paid ? { ok: false, reason: "Has purchases / payments — deactivate instead" } : { ok: true };
}

/** A factory with no material issued, no payments and no order assigned to it may go. */
export function factoryDeleteGuard(db: DB, f: Factory, figures?: FactoryFigures): DeleteGuard {
  // Orders are always loaded; an order tagged to this factory would point at nobody.
  const orders = db.orders.filter(o => o.assignedFactoryId === f.id).length;
  if (collectionsLoaded(TOTALS_COLS.factory)) {
    const issues = (db.materialIssuances ?? []).filter(i => i.factoryId === f.id).length;
    const payments = (db.factoryPayments ?? []).filter(p => p.factoryId === f.id).length;
    return has([
      issues ? plural(issues, "issue") : "",
      payments ? plural(payments, "payment") : "",
      orders ? plural(orders, "order assigned", "orders assigned") : "",
    ].filter(Boolean));
  }
  if (orders) return has([plural(orders, "order assigned", "orders assigned")]);
  if (!figures) return { ok: true };
  const charged = figures.chargesTotal - openingCreditAmt(f) > 0.5;
  const moved = figures.goldIssued > 0 || figures.diamondIssued > 0 || figures.goldUsed > 0 || figures.diamondUsed > 0;
  const paid = figures.chargesPaid > 0.5;
  return charged || moved || paid ? { ok: false, reason: "Has material issues / payments — deactivate instead" } : { ok: true };
}

/**
 * The check a delete makes before it asks: loads the records behind the totals
 * (a no-op where they are loaded already) and counts them exactly. Returns the
 * refusal, or undefined when it may go.
 */
export async function deleteRefusal(kind: "supplier", party: Supplier): Promise<string | undefined>;
export async function deleteRefusal(kind: "factory", party: Factory): Promise<string | undefined>;
export async function deleteRefusal(kind: "supplier" | "factory", party: Supplier | Factory): Promise<string | undefined> {
  await ensureCollections(TOTALS_COLS[kind]);
  const db = loadDb();
  const g = kind === "supplier" ? supplierDeleteGuard(db, party as Supplier) : factoryDeleteGuard(db, party as Factory);
  return g.ok ? undefined : g.reason;
}
