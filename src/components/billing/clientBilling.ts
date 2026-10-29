import {
  balanceDue, clientAccount, invoiceOrderIds, openingDebitAmt, orderTotal,
  type DB, type Invoice, type OpeningBalanceInfo, type Order,
} from "@/lib/db";
import { needsInvoice } from "@/components/InvoiceBadge";
import { invoiceBlocker } from "@/lib/invoiceBatch";

/**
 * What a client owes, said the way the Invoices page says it.
 *
 * clientAccount() counts every order's balance, including work still at the
 * bench that has never been billed — so a client could read "$3,325 owed" on
 * the Clients list while Invoices and their own statement said $0 due. Both
 * were right; they were counting different things. This splits the one figure
 * in two, with no new money rule: the same per-order balanceDue(), sorted by
 * whether an invoice carries the order.
 *
 *   dueNow    — on an invoice and unpaid (+ any balance brought forward): what
 *               the invoices and the Invoice Statement say is due.
 *   notBilled — the rest: orders not invoiced yet.
 *
 * dueNow + notBilled is always clientAccount().outstanding, to the cent.
 */
export function splitClientAccount(orders: Order[], creditBalance: number, opening: OpeningBalanceInfo | undefined, invoiced: Set<string>) {
  const acc = clientAccount(orders, creditBalance, opening);
  let onInvoices = 0;
  for (const o of orders) if (invoiced.has(o.id)) onInvoices += balanceDue(o);
  const dueNow = Math.round((onInvoices + openingDebitAmt(opening)) * 100) / 100;
  const notBilled = Math.round(Math.max(0, acc.outstanding - dueNow) * 100) / 100;
  return { ...acc, dueNow, notBilled };
}

/** Every order some invoice carries — the same test as findInvoiceForOrder(),
 *  worked out once for a whole list instead of once per order. */
export function invoicedOrderIds(invoices: Invoice[] | undefined): Set<string> {
  const ids = new Set<string>();
  for (const inv of invoices ?? []) for (const id of invoiceOrderIds(inv)) ids.add(id);
  return ids;
}

/**
 * A client's shipped orders with no invoice yet — the Orders page's "Not
 * invoiced" list (needsInvoice and no invoice), for one client.
 *
 * `ready` can go on an invoice now (invoiceBlocker says nothing against it, the
 * very rule Create invoice ticks by); `noPrice` has shipped but carries no
 * price, so it has to be priced first. Anything else (every piece already sent
 * back) has nothing to bill and is left out, so a reminder can always clear.
 */
export function readyToBill(db: DB, clientId: string, invoiced = invoicedOrderIds(db.invoices)) {
  const ready: Order[] = [], noPrice: Order[] = [];
  for (const o of db.orders) {
    if (o.clientId !== clientId || o.deletedAt || !needsInvoice(o) || invoiced.has(o.id)) continue;
    const why = invoiceBlocker(db, o);
    if (why === null) ready.push(o);
    else if (!(o.amount > 0)) noPrice.push(o);
  }
  const total = Math.round(ready.reduce((s, o) => s + orderTotal(o), 0) * 100) / 100;
  return { ready, noPrice, total };
}

/** Days since a date, whole days ("23 d" on an unpaid invoice). */
export function daysSince(iso: string, now = Date.now()): number {
  return Math.max(0, Math.floor((now - +new Date(iso)) / 86_400_000));
}
