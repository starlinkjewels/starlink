// Whether a Ready Stock lot may be deleted outright.
//
// A lot is a record other records point at: an order sold from it puts the
// piece back on cancel (and takes it again on re-open), a client's return
// points at the lot it went into (cancelling the return takes it back out —
// see cancelReturnBlocker), and an in-house build points at the lot it made.
// Deleting the lot broke every one of those silently. Such a lot is emptied
// (quantity 0) instead, which keeps the links and the history.
import type { DB, Order, ReadyStockItem } from "./db";

const list = (xs: string[]) => (xs.length <= 2 ? xs.join(", ") : `${xs.slice(0, 2).join(", ")} and ${xs.length - 2} more`);

/** Why this lot can't be deleted; undefined when nothing points at it. */
export function readyStockDeleteBlocker(db: Pick<DB, "orders">, item: ReadyStockItem): string | undefined {
  const sold = db.orders.filter(o => o.readyStockItemId === item.id);
  if (sold.length) return `Sold on order ${list(sold.map(o => o.orderNumber))} — set quantity to 0 instead`;
  const notes: string[] = [];
  for (const o of db.orders) for (const r of o.returns ?? []) if (r.readyStockId === item.id) notes.push(r.creditNoteNo);
  if (!notes.length && item.fromReturn) {
    const o: Order | undefined = db.orders.find(x => x.id === item.fromReturn!.orderId);
    const r = o?.returns?.find(x => x.id === item.fromReturn!.returnId);
    if (r) notes.push(r.creditNoteNo);
  }
  if (notes.length || item.fromReturn) return `Came back on credit note ${notes.length ? list([...new Set(notes)]) : "from a client"} — set quantity to 0 instead`;
  const built = db.orders.find(o => o.readyStockCreatedId === item.id);
  if (built) return `Built on order ${built.orderNumber} — set quantity to 0 instead`;
  return undefined;
}
