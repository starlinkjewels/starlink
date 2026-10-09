import { orderIsDispatched, findInvoiceForOrder, orderTotal, type DB, type Order } from "@/lib/db";

/**
 * Billing several dispatched orders on one invoice, from wherever they were
 * picked.
 *
 * The Invoices page could already do this, but only its own way round: choose
 * the client, then hunt down their un-invoiced orders in a second list. Having
 * just ticked six pieces to dispatch them, the same six have to be found again
 * somewhere else to bill them.
 *
 * The rules do not change with the screen, so they live here. An invoice covers
 * one client, and `createInvoiceFromOrders` is still the only thing that mints
 * one — this only explains, per order, what that guard would do, so the refusal
 * never has to be a surprise.
 */
export interface InvoicePlan {
  /** Will go on the invoice. */
  go: Order[];
  /** Left out, with the reason. */
  skip: { order: Order; reason: string }[];
  /** The one client being billed, or null when the selection spans several. */
  clientId: string | null;
  /** What the invoice will come to. */
  total: number;
}

/** Why this order cannot be billed, or nothing if it can. */
export function invoiceBlocker(db: DB, o: Order): string | null {
  if (o.forReadyStock) return "In-house stock build — there is no client to bill.";
  if (o.status === "Rejected") return "Order is rejected.";
  // `amount`, not orderTotal: this is the very test createInvoiceFromOrders
  // applies, and a plan that promised an order the guard then dropped would
  // bill less than it showed.
  if (!(o.amount > 0)) return "No price set on this order.";
  // A bill for goods that have not shipped is the one mistake this guard
  // exists for, so it is named plainly rather than lumped in with the rest.
  if (!orderIsDispatched(o)) return "Not dispatched yet.";
  // Reads both invoice shapes — the single-order ones and the batched ones.
  const existing = findInvoiceForOrder(db.invoices ?? [], o.id);
  if (existing) return `Already on invoice ${existing.number}.`;
  return null;
}

/** Sort the selection into what will be billed and what will not, before it is. */
export function planInvoice(orders: Order[], db: DB): InvoicePlan {
  const plan: InvoicePlan = { go: [], skip: [], clientId: null, total: 0 };
  for (const o of orders) {
    const reason = invoiceBlocker(db, o);
    if (reason) plan.skip.push({ order: o, reason });
    else plan.go.push(o);
  }
  // Read off the billable orders only, so an in-house stock build caught up in
  // the selection cannot make a single client's orders look like several.
  const clients = new Set(plan.go.map(o => o.clientId).filter(Boolean));
  plan.clientId = clients.size === 1 ? [...clients][0] : null;
  // The invoice is raised for what createInvoiceFromOrders will sum.
  plan.total = Math.round(plan.go.reduce((s, o) => s + orderTotal(o), 0) * 100) / 100;
  return plan;
}
