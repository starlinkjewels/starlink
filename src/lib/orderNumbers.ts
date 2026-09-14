// Repairing duplicate order numbers.
//
// Before numbers were reserved atomically (src/lib/counters.ts), two people
// creating an order in the same moment could both mint the same number. That
// left real duplicates in production data. This module finds them and can
// renumber one safely.
//
// Renumbering is safe because an order's identity is its hidden `id`, never the
// printed number: invoices, purchases, factory issues and payments all link by
// id. The number is only a human label, so changing it breaks no links.
import { updateDb, type DB, type Order } from "./db";
import { reserveOrderNumber } from "./counters";

export interface DuplicateGroup {
  number: string;
  /** Oldest first — the first one keeps the number, the rest are the clashes. */
  orders: Order[];
}

/** Every order number used by more than one order, oldest-first within a group. */
export function duplicateOrderNumbers(orders: Order[]): DuplicateGroup[] {
  const byNumber = new Map<string, Order[]>();
  for (const o of orders) {
    const key = (o.orderNumber || "").trim();
    if (!key) continue;
    const list = byNumber.get(key);
    if (list) list.push(o);
    else byNumber.set(key, [o]);
  }
  const out: DuplicateGroup[] = [];
  for (const [number, list] of byNumber) {
    if (list.length < 2) continue;
    out.push({
      number,
      orders: [...list].sort((a, b) => +new Date(a.createdAt) - +new Date(b.createdAt)),
    });
  }
  return out.sort((a, b) => (a.number < b.number ? -1 : 1));
}

/**
 * Give one order a fresh, unique number. Reserves it through the same atomic
 * counter new orders use, so the replacement can never clash either. The old
 * number is kept on the order (previousOrderNumber) so earlier paperwork can
 * still be traced.
 */
export async function renumberOrder(db: DB, orderId: string): Promise<string> {
  const target = db.orders.find(o => o.id === orderId);
  if (!target) throw new Error("That order no longer exists.");
  const fresh = await reserveOrderNumber(db.orders);
  updateDb(d => {
    const o = d.orders.find(x => x.id === orderId);
    if (!o) return;
    if (!o.previousOrderNumber) o.previousOrderNumber = o.orderNumber;
    o.orderNumber = fresh;
  });
  return fresh;
}
