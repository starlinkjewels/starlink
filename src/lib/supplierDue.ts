// What we owe each supplier, bill by bill, and when it falls due — the "To pay" list.
//
// A supplier's credit days (Supplier.creditDays) make each bill due its date + those days. What
// is still owed on a bill is its total less the payments made against it; anything else that
// lowers what we owe them (a payment on account, money they gave back, goods we sold or returned
// to them) is taken off the oldest bills first — so the bills on the list always add up to the
// supplier page's own "we owe" figure (supplierFigures(...).net), never more.
// Without credit days a bill has no due day: it is listed as due (from its date) but never late.
import { openingCreditAmt, type DB, type Purchase, type Supplier } from "./db";
import { purchasePaid } from "./pure/accounts";
import { supplierFigures } from "./partyTotals";

const DAY = 86_400_000;
const r2 = (n: number) => Math.round(n * 100) / 100;

export interface BillDue {
  supplierId: string;
  /** The purchase; undefined for what is owed from before the app (opening balance). */
  purchase?: Purchase;
  billNo: string;
  billAt: string;
  /** Due day by the supplier's credit days; undefined without. */
  dueAt?: string;
  /** ₹ still owed on it. */
  owed: number;
  /** Whole days past the due day (0 = not late). */
  late: number;
  /** Days left to the due day (negative once late); undefined without a due day. */
  left?: number;
}

const dueFrom = (at: string, days: number) => { const d = new Date(at); d.setDate(d.getDate() + days); return d.toISOString(); };
const endOf = (iso: string) => { const d = new Date(iso); d.setHours(23, 59, 59, 999); return +d; };

/** One supplier's unpaid bills, oldest first, with what is owed on each and when it falls due. */
export function supplierBillsDue(db: DB, sup: Supplier, now = Date.now()): BillDue[] {
  const net = supplierFigures(db, sup).net;
  if (!(net > 0.5)) return [];
  const days = sup.creditDays != null && sup.creditDays >= 0 ? sup.creditDays : undefined;
  const lines: BillDue[] = [];
  const oCredit = openingCreditAmt(sup);
  if (oCredit > 0) lines.push({ supplierId: sup.id, billNo: "Opening balance", billAt: sup.openingDate || sup.createdAt, owed: oCredit, late: 0 });
  const bills = db.purchases.filter(p => p.supplierId === sup.id)
    .map(p => ({ p, at: p.invoiceDate || p.createdAt, owed: r2(Math.max(0, p.totalInr - purchasePaid(p))) }))
    .filter(x => x.owed > 0.5)
    .sort((a, b) => +new Date(a.at) - +new Date(b.at));
  for (const x of bills) lines.push({ supplierId: sup.id, purchase: x.p, billNo: x.p.invoiceNumber || "Bill", billAt: x.at, owed: x.owed, late: 0 });
  // What else we owe that is no bill (money they handed back to us, say): a line of its own, with no due day.
  const sum = r2(lines.reduce((t, l) => t + l.owed, 0));
  if (net - sum > 0.5) lines.push({ supplierId: sup.id, billNo: "Other balance (not a bill)", billAt: sup.createdAt, owed: r2(net - sum), late: 0 });
  // What else lowers what we owe comes off the oldest first.
  let off = r2(lines.reduce((t, l) => t + l.owed, 0) - net);
  for (const l of lines) {
    if (off <= 0.5) break;
    const take = Math.min(off, l.owed);
    l.owed = r2(l.owed - take);
    off = r2(off - take);
  }
  return lines.filter(l => l.owed > 0.5).map(l => {
    if (days == null || (!l.purchase && l.billNo !== "Opening balance")) return l;
    const dueAt = dueFrom(l.billAt, days);
    const left = Math.floor((endOf(dueAt) - now) / DAY);
    return { ...l, dueAt, left, late: left < 0 ? -left : 0 };
  });
}

/** Every supplier's bills that are late or fall due within `withinDays` (a week by default), most urgent first. */
export function billsToPay(db: DB, withinDays = 7, now = Date.now()): BillDue[] {
  return db.suppliers.filter(s => s.active !== false)
    .flatMap(s => supplierBillsDue(db, s, now))
    .filter(b => b.dueAt != null && (b.late > 0 || (b.left ?? 99) <= withinDays))
    .sort((a, b) => (a.left ?? 0) - (b.left ?? 0));
}
