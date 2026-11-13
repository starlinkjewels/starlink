// Whether a Ready Stock lot may be deleted outright.
//
// A lot is a record other records point at: an order sold from it puts the
// piece back on cancel (and takes it again on re-open), a client's return
// points at the lot it went into (cancelling the return takes it back out —
// see cancelReturnBlocker), and an in-house build points at the lot it made.
// Deleting the lot broke every one of those silently. Such a lot is emptied
// (quantity 0) instead, which keeps the links and the history.
//
// Also: a piece out on memo (bringing it back or selling it on the memo needs
// the lot), one sold to a supplier (their sale names it), and one bought on a
// supplier's bill (the bill names it — removing the purchase takes the piece off).
import type { DB, Order, ReadyStockItem } from "./db";
import { memoHolding } from "./memos";

const list = (xs: string[]) => (xs.length <= 2 ? xs.join(", ") : `${xs.slice(0, 2).join(", ")} and ${xs.length - 2} more`);

type GuardDb = Pick<DB, "orders"> & Partial<Pick<DB, "memos" | "supplierSales" | "purchases" | "suppliers">>;

/**
 * Why this lot can't be deleted; undefined when nothing points at it.
 * `exceptPurchaseId`: the bill being removed itself (voiding a purchase takes its own piece off).
 */
export function readyStockDeleteBlocker(db: GuardDb, item: ReadyStockItem, opts: { exceptPurchaseId?: string } = {}): string | undefined {
  const sold = db.orders.filter(o => o.readyStockItemId === item.id || o.stockSale?.itemId === item.id);
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
  const memo = memoHolding({ memos: db.memos ?? [] }, { readyStockItemId: item.id });
  if (memo) return `Out on memo ${memo.no} — take it back on the memo first`;
  const supSale = (db.supplierSales ?? []).find(s => s.lines?.some(l => l.readyStockItemId === item.id));
  if (supSale) {
    const who = db.suppliers?.find(s => s.id === supSale.supplierId)?.name;
    return `${supSale.returnOf ? `Returned on debit note ${supSale.returnOf.noteNo}` : "Sold"} to ${who ?? "a supplier"} — set quantity to 0 instead`;
  }
  const bill = (db.purchases ?? []).find(p => p.piece?.readyStockId === item.id && p.id !== opts.exceptPurchaseId);
  if (bill) {
    const who = db.suppliers?.find(s => s.id === bill.supplierId)?.name;
    return `Bought on a bill${bill.invoiceNumber ? ` ${bill.invoiceNumber}` : ""}${who ? ` from ${who}` : ""} — remove that purchase instead, or set quantity to 0`;
  }
  return undefined;
}

/** What an empty lot is: still out on a memo, or sold out. */
export function readyStockOutLabel(db: Partial<Pick<DB, "memos">>, item: ReadyStockItem): string {
  if (item.quantity > 0) return "In stock";
  const memo = memoHolding({ memos: db.memos ?? [] }, { readyStockItemId: item.id });
  return memo ? `On memo ${memo.no}` : "Sold out";
}
