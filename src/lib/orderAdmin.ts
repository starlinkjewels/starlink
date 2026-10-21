// Two admin corrections to an order placed by mistake: deleting it outright,
// and moving it to the right client. Both only while nothing hangs on the
// order yet — no money, no bill, no material — so no ledger, stock count or
// statement is left pointing at an order or a client that no longer fits.
// Anything else is said plainly, with what to undo first.
import { toast } from "sonner";
import { collectionsLoaded, findInvoiceForOrder, loadDb, updateDbAs, type DB, type Order, type User } from "./db";
import { confirmBox } from "./confirm";
import { CHECKING, STILL_LOADING, recordsReady } from "./actionHints";
import { coField, companyIdOfClient } from "./companies";

/** Everything the checks read beyond the orders the app opens with. */
export const ORDER_ADMIN_COLS = [
  "invoices", "materialIssuances", "purchases", "diamondPackets", "stockMovements", "expenses", "giftCards", "readyStock",
] as const;

/** What is attached to the order that money, stock or the books depend on — empty when nothing is. */
function attached(db: DB, o: Order): string[] {
  const out: string[] = [];
  if ((o.advances ?? []).length) out.push("a payment — delete it from the order's Payments first");
  const inv = findInvoiceForOrder(db.invoices ?? [], o.id);
  if (inv) out.push(`invoice ${inv.number} — delete the invoice first`);
  if ((db.materialIssuances ?? []).some(i => i.orderId === o.id) || (o.materialIssuanceIds ?? []).length) out.push("material issued for it — remove it from Manufacturing first");
  if ((db.purchases ?? []).some(p => p.orderId === o.id)) out.push("a purchase bought for it — void it on the supplier's page first");
  if ((db.diamondPackets ?? []).some(p => p.orderId === o.id)) out.push("certified stones on it — return them to stock first");
  if ((db.stockMovements ?? []).some(m => m.refType === "order" && m.refId === o.id)) out.push("stock moved for it");
  if ((db.expenses ?? []).some(e => e.orderIds?.includes(o.id))) out.push("an expense for it — remove the order from the expense first");
  if (o.giftCardId || o.giftCardRedeemed) out.push("a gift card used on it");
  if (o.cashbackIssued) out.push("cashback already given for it");
  if (o.returns?.length) out.push("a return");
  if (o.melted) out.push("it was melted");
  if (o.readyStockItemId || o.materialSourcing === "readyStock") out.push("it sold a Ready Stock piece — cancel it instead, so the piece goes back on the shelf");
  if (o.readyStockCreatedId) out.push("its piece is in Ready Stock");
  return out;
}

/** Why this order can't be deleted; undefined when it can. Admin only. */
export function orderDeleteBlocker(db: DB, user: Pick<User, "role"> | null | undefined, o: Order): string | undefined {
  if (user?.role !== "admin") return "Only the admin can delete an order";
  if (!collectionsLoaded(ORDER_ADMIN_COLS)) return CHECKING;
  const a = attached(db, o);
  return a.length ? `It has ${a[0]}` : undefined;
}

/** Delete an order with nothing attached — asked twice: once, then by typing its number. */
export async function deleteOrderFlow(orderId: string, user: Pick<User, "role">): Promise<boolean> {
  if (!(await recordsReady(ORDER_ADMIN_COLS))) { toast.error(STILL_LOADING); return false; }
  const o = loadDb().orders.find(x => x.id === orderId);
  if (!o) { toast.error("That order is no longer there"); return false; }
  const why = orderDeleteBlocker(loadDb(), user, o);
  if (why) { toast.error(why); return false; }
  if (!(await confirmBox(`Delete order ${o.orderNumber}?\n\nNothing is attached to it — no payment, invoice or material. It is removed for good; its number is not given out again.`))) return false;
  if (!(await confirmBox(`Last check — delete ${o.orderNumber} for good?\n\nThis cannot be undone.`, { typeToConfirm: o.orderNumber, confirmText: "Delete for good" }))) return false;
  let gone = false;
  updateDbAs({ summary: `Deleted order ${o.orderNumber}` }, d => {
    const live = d.orders.find(x => x.id === orderId);
    // Checked again on the live record: something may have been recorded meanwhile.
    if (!live || attached(d, live).length) return;
    d.orders = d.orders.filter(x => x.id !== orderId);
    gone = true;
  });
  if (!gone) { toast.error("Not deleted — something was recorded on it meanwhile"); return false; }
  toast.success(`Order ${o.orderNumber} deleted`);
  return true;
}

/** Why this order can't move to another client now; undefined when it can. */
export function clientChangeBlocker(db: DB, o: Order): string | undefined {
  if (!collectionsLoaded(ORDER_ADMIN_COLS)) return CHECKING;
  if ((o.advances ?? []).length) return "It has a payment from this client — delete it first, then record it under the right client";
  const inv = findInvoiceForOrder(db.invoices ?? [], o.id);
  if (inv) return `It is on invoice ${inv.number} — delete the invoice first`;
  if (o.giftCardId || o.giftCardRedeemed) return "This client's gift card is used on it";
  if (o.cashbackIssued) return "Cashback was already given to this client for it";
  if (o.returns?.length) return "It has a return";
  if (o.status === "Rejected") return "It is cancelled";
  return undefined;
}

/** Move the order to another client (a wrong pick on New Order). */
export function changeOrderClient(orderId: string, clientId: string): boolean {
  const db = loadDb();
  const o = db.orders.find(x => x.id === orderId);
  const to = db.clients.find(c => c.id === clientId);
  if (!o || !to) { toast.error("That order or client is no longer there"); return false; }
  if (o.clientId === clientId) return true;
  const why = clientChangeBlocker(db, o);
  if (why) { toast.error(why); return false; }
  const from = db.clients.find(c => c.id === o.clientId)?.companyName ?? "the old client";
  let done = false;
  updateDbAs({ summary: `Order ${o.orderNumber}: client ${from} → ${to.companyName}` }, d => {
    const live = d.orders.find(x => x.id === orderId);
    if (!live || clientChangeBlocker(d, live)) return;
    live.clientId = clientId;
    // Billed by the company that bills the new client (nothing is billed yet).
    delete live.companyId;
    Object.assign(live, coField(companyIdOfClient(to)));
    done = true;
  });
  if (!done) { toast.error("Not changed — something was recorded on it meanwhile"); return false; }
  toast.success(`${o.orderNumber} is now ${to.companyName}'s order`);
  return true;
}
