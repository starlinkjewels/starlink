import { loadDb, updateDb, uid, type DB } from "@/lib/db";

const PREFIX = "Supplier Payment — ";

/** A supplier payment that left an account but never reached the supplier's books. */
export interface OrphanSupplierPayment {
  txnId: string;
  supplierId: string;
  supplierName: string;
  lockerId: string;
  at: string;
  /** The part of the payment that was lost — usually the whole of it. */
  amountInr: number;
}

/**
 * Money paid to a supplier used to be written INSIDE the purchase it settled.
 * When the supplier had no purchases to settle — a first advance, or a supplier
 * you only ever lend to — there was nowhere to put it, so only the account
 * movement was written and the supplier's own books never saw the money. The
 * account showed it gone; the supplier showed ₹0 and "Settled".
 *
 * This finds those payments by comparing each "Supplier Payment" account entry
 * against what the supplier's books actually recorded at that same moment, and
 * reports whatever is short. Payments written the normal way match to the rupee
 * and are ignored.
 */
export function orphanSupplierPayments(db: DB): OrphanSupplierPayment[] {
  const out: OrphanSupplierPayment[] = [];
  for (const t of db.lockerTransactions ?? []) {
    if (t.type !== "expense" || !t.category?.startsWith(PREFIX)) continue;
    const name = t.category.slice(PREFIX.length).trim();
    // Renamed since? Then we cannot say whose payment this was — leave it alone
    // rather than post it to the wrong supplier.
    const supplier = db.suppliers.find(s => s.name.trim() === name);
    if (!supplier) continue;

    // Everything the supplier's books recorded in the same account at the same
    // moment. One payment can be split across several bills by FIFO, so this
    // sums them rather than looking for a single matching row.
    const sameMoment = (at: string) => Math.abs(+new Date(at) - +new Date(t.createdAt)) < 1500;
    let booked = 0;
    for (const p of db.purchases ?? []) {
      if (p.supplierId !== supplier.id) continue;
      for (const pay of p.payments ?? []) {
        if (pay.lockerId === t.lockerId && sameMoment(pay.createdAt)) booked += pay.amountInr;
      }
    }
    for (const a of db.supplierPayments ?? []) {
      if (a.supplierId !== supplier.id) continue;
      if (a.lockerId === t.lockerId && sameMoment(a.createdAt)) booked += a.amountInr;
    }

    const missing = Math.round((t.amountInr - booked) * 100) / 100;
    if (missing > 0.01) {
      out.push({
        txnId: t.id, supplierId: supplier.id, supplierName: supplier.name,
        lockerId: t.lockerId, at: t.createdAt, amountInr: missing,
      });
    }
  }
  return out.sort((a, b) => +new Date(a.at) - +new Date(b.at));
}

/**
 * Put each lost payment back on the supplier's books as an advance, dated and
 * sourced exactly as it was. Nothing moves in any account: the money already
 * left, and this only records where it went.
 */
export function repairSupplierPayments(userId: string): number {
  const orphans = orphanSupplierPayments(loadDb());
  if (!orphans.length) return 0;
  updateDb(d => {
    if (!d.supplierPayments) d.supplierPayments = [];
    for (const o of orphans) {
      d.supplierPayments.push({
        id: uid("spay_"),
        supplierId: o.supplierId,
        amountInr: o.amountInr,
        lockerId: o.lockerId,
        recordedBy: userId,
        createdAt: o.at,
        note: "Recovered — paid from the account but missing from the supplier's books",
      });
    }
  });
  return orphans.length;
}
