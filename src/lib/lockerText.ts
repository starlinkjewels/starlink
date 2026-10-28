import type { DB, LockerTransaction } from "./db";

/** The orders, clients and receipts an account's lines name — looked up once, not per line. */
export interface LockerLookup {
  order: (id?: string) => { clientId: string; orderNumber: string } | undefined;
  receiptClient: (id?: string) => string | undefined;
  clientName: (id?: string) => string | undefined;
}

export function lockerLookup(db: Pick<DB, "orders" | "clients" | "clientReceipts">): LockerLookup {
  const orders = new Map(db.orders.map(o => [o.id, o]));
  const receipts = new Map((db.clientReceipts ?? []).map(r => [r.id, r.clientId]));
  const clients = new Map(db.clients.map(c => [c.id, c.companyName]));
  return {
    order: id => (id ? orders.get(id) : undefined),
    receiptClient: id => (id ? receipts.get(id) : undefined),
    clientName: id => (id ? clients.get(id) : undefined),
  };
}

/**
 * What an account entry says in a ledger. A client's payment taken on an order
 * was saved as "Client Payment — SLJ-2026-1066", so the ledger showed an order
 * number and every line had to be opened to see whose money it was. It now
 * reads "Client Payment — <client>", the order number kept beside it (`order`),
 * and `text` carries both for search and downloads.
 * Nothing saved is changed: the name is looked up as the line is shown.
 */
export function lockerEntryText(lk: LockerLookup, t: LockerTransaction): { title: string; order?: string; text: string } {
  const base = t.category || t.note || (t.type === "transfer_in" ? "Transfer in" : t.type === "transfer_out" ? "Transfer out" : t.type);
  if (!/^Client Payment\b/.test(t.category ?? "")) return { title: base, text: base };
  const order = lk.order(t.refId);
  const name = lk.clientName(order?.clientId ?? lk.receiptClient(t.receiptId));
  if (!name) return { title: base, text: base };
  const title = `Client Payment — ${name}`;
  return order ? { title, order: order.orderNumber, text: `${title} · ${order.orderNumber}` } : { title, text: title };
}
