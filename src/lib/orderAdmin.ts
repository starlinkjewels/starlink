// Two admin corrections to an order placed by mistake: deleting it, and moving
// it to the right client.
//
// Delete: an order is never erased (orders are append-only in the save layer).
// One with nothing on it is closed and marked deleted. One with material,
// stones, a Ready Stock piece or payments on it is first undone exactly as
// Cancel undoes it (lib/orderCancel.ts — material and stones back to stock, the
// piece back on the shelf, money paid to the client's credit), then marked
// deleted. Either way it is off every list; its record stays, so the stock,
// payment and activity lines that name it still read right, and an admin can
// restore it. What
// can't be undone from here — a bill, a shipment, a melt, a gift card — is said
// plainly, with where to deal with it first.
//
// Change client: only while nothing hangs on the order yet — no money, no
// bill — so no statement is left pointing at the wrong client.
import { toast } from "sonner";
import { collectionsFresh, findInvoiceForOrder, flush, loadDb, updateDbAs, orderIsDispatched, fmtMoney, type DB, type Order, type User } from "./db";
import { cancelOrder, usedOnUndo } from "./orderCancel";
import { materialName, materialUnit } from "./materials";
import { lotLabel } from "./diamondLots";
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

/**
 * What a delete can't undo by itself — each dealt with in its own place first.
 * Everything else on the order (material, stones, a Ready Stock sale, money
 * paid) is undone by the delete, as Cancel does.
 */
function deleteStopper(db: DB, o: Order): string | undefined {
  if (o.deletedAt) return "Already deleted";
  if (o.melted) return "It was melted — the piece no longer exists";
  if (orderIsDispatched(o) || o.returns?.length) return "It was dispatched — use “Return pieces” instead (credit note, piece back into Ready Stock)";
  const inv = findInvoiceForOrder(db.invoices ?? [], o.id);
  if (inv) return `It is on invoice ${inv.number} — delete or credit the invoice first`;
  if (o.readyStockCreatedId) return "Its piece is in Ready Stock — set that piece's quantity to 0 first";
  if (o.giftCardId || o.giftCardRedeemed) return "A gift card was used on it — take the gift card off the order first";
  if (o.cashbackIssued) return "Cashback was already given for it";
  if ((db.expenses ?? []).some(e => e.orderIds?.includes(o.id))) return "An expense names it — remove the order from that expense first";
  return undefined;
}

/** Why this order can't be deleted; undefined when it can. Admin only. */
export function orderDeleteBlocker(db: DB, user: Pick<User, "role"> | null | undefined, o: Order): string | undefined {
  if (user?.role !== "admin") return "Only the admin can delete an order";
  if (!collectionsFresh(ORDER_ADMIN_COLS)) return CHECKING;
  return deleteStopper(db, o);
}

/** What the menu says Delete will do, in a few words. */
export function deleteHint(db: DB, o: Order): string {
  return attached(db, o).length
    ? "Undoes it as Cancel does, then takes it off every list — restorable"
    : "Nothing is attached to it — taken off every list (restorable, asked twice)";
}

const r3 = (n: number) => Math.round(n * 1000) / 1000;

/** What deleting this order will undo, line by line — for the question asked first. */
export function deleteEffects(db: DB, o: Order): string[] {
  if (o.status === "Rejected") return ["It is already cancelled — nothing is left to undo"];
  const out: string[] = [];
  for (const mi of (db.materialIssuances ?? []).filter(i => i.orderId === o.id && i.status === "open")) {
    if (mi.diamondKind === "certified") continue; // said with the stones, below
    const unit = materialUnit(db.settings, mi.material);
    const what = mi.material === "gold" ? `${mi.purityOrQuality} gold`
      : mi.material === "diamond" ? `diamonds (${lotLabel(mi.purityOrQuality)})`
      : `${mi.purityOrQuality} ${materialName(db.settings, mi.material)}`;
    // Exactly what the cancel will put back (usedOnUndo): all of it before Final Approval.
    const back = r3(mi.quantityIssued - usedOnUndo(o, mi));
    if (mi.source === "stock" && back > 0) out.push(`${back} ${unit} ${what} back to stock`);
    else if (mi.source === "purchase" && mi.quantityIssued > 0) out.push(`${r3(mi.quantityIssued)} ${unit} ${what} bought for it go into stock — the supplier's bill stays`);
    else if (mi.source === "factoryPool" && back > 0) out.push(`${back} ${unit} ${what} back to the factory's account`);
  }
  const packets = (db.diamondPackets ?? []).filter(p => p.orderId === o.id);
  if (packets.length) out.push(`${packets.length} certified stone${packets.length !== 1 ? "s" : ""} back to stock (${packets.map(p => p.stockNumber || p.certificateNumber).join(", ")})`);
  if (o.materialSourcing === "readyStock" && o.readyStockItemId) {
    const it = (db.readyStock ?? []).find(i => i.id === o.readyStockItemId);
    out.push(`The Ready Stock piece${it ? ` ${it.name}` : ""} goes back on the shelf`);
  }
  const paid = (o.advances ?? []).reduce((s, a) => s + a.amount, 0);
  if (paid > 0) {
    const c = db.clients.find(x => x.id === o.clientId);
    out.push(`${fmtMoney(paid)} paid becomes ${c?.companyName ?? "the client"}'s credit — usable on their other orders, or refundable`);
  }
  return out;
}

/** Everything a delete reads: what it checks, and what the cancel it runs puts back. */
const DELETE_COLS = [...ORDER_ADMIN_COLS, "materialIssuances", "diamondPackets"] as const;

/**
 * Delete an order — asked twice: what it will do, then by typing its number.
 *
 * An order is never erased from the database: the save layer keeps orders
 * append-only (lib/db.ts persist — a record missing from a stale screen must
 * never be taken as deleted; that once wiped a live order). Removing it from
 * the list only hid it until the next reload. So every delete is a mark:
 *   • nothing on it → it is closed (as cancelled) and marked deleted;
 *   • something on it → undone exactly as Cancel undoes it, then marked deleted.
 * Either way it is off every list, the board and search, and restorable.
 */
export async function deleteOrderFlow(orderId: string, user: Pick<User, "id" | "name" | "role">): Promise<boolean> {
  if (!(await recordsReady(DELETE_COLS))) { toast.error(STILL_LOADING); return false; }
  const db = loadDb();
  const o = db.orders.find(x => x.id === orderId);
  if (!o) { toast.error("That order is no longer there"); return false; }
  const why = orderDeleteBlocker(db, user, o);
  if (why) { toast.error(why); return false; }

  const clean = !attached(db, o).length;
  const effects = clean ? [] : deleteEffects(db, o);
  const restoreLine = "The admin can restore it (Orders → Filters → Deleted).";
  if (!(await confirmBox(clean
    ? `Delete order ${o.orderNumber}?\n\nNothing is attached to it — no payment, invoice or material. It is taken off every list, the board and search; its number is not given out again. ${restoreLine}`
    : `Delete order ${o.orderNumber}?\n\nIt has records on it, so first everything is undone — as Cancel does:\n${effects.map(e => `• ${e}`).join("\n")}\n\nThen it is taken off every list, the board and search. ${restoreLine}`))) return false;
  if (!(await confirmBox(`Last check — delete ${o.orderNumber}?`, { typeToConfirm: o.orderNumber, confirmText: clean ? "Delete" : "Undo and delete" }))) return false;

  const wasCancelled = o.status === "Rejected";
  if (!clean && !wasCancelled) {
    try { await cancelOrder(orderId, user); }
    catch (e) { toast.error(e instanceof Error ? `Not deleted — ${e.message}` : "Not deleted — the cancel did not go through"); return false; }
    // The cancel saved on its own first — so the activity log has it, and the
    // delete below, each under its own name (saved together, the delete's name was lost).
    await flush();
  }
  let done = false;
  updateDbAs({ summary: `Deleted order ${o.orderNumber}${clean ? " (nothing was attached)" : wasCancelled ? " (it was cancelled)" : ` — undone first: ${effects.join("; ")}`}` }, d => {
    const live = d.orders.find(x => x.id === orderId);
    if (!live || live.deletedAt) return;
    if (clean) {
      // Checked again on the live record: something may have been recorded meanwhile.
      if (attached(d, live).length) return;
      // Closed as a cancelled order, so every total that leaves cancelled work out leaves this out too.
      live.status = "Rejected";
    } else if (live.status !== "Rejected") return;
    live.deletedAt = new Date().toISOString();
    live.deletedBy = user.id;
    done = true;
  });
  if (!done) {
    toast.error(clean ? "Not deleted — something was recorded on it meanwhile. Try again: it will be undone first." : `${o.orderNumber} is cancelled but not deleted — try Delete again`);
    return false;
  }
  await flush();
  toast.success(`Order ${o.orderNumber} deleted`, { description: clean || wasCancelled ? undefined : "Everything on it was undone first, as a cancel." });
  return true;
}

/** Bring a deleted order back — as the cancelled order it is; re-open it on its page to carry on. */
export async function restoreOrderFlow(orderId: string, user: Pick<User, "role">): Promise<boolean> {
  if (user.role !== "admin") { toast.error("Only the admin can restore an order"); return false; }
  const o = loadDb().orders.find(x => x.id === orderId);
  if (!o?.deletedAt) { toast.error("That order is not deleted"); return false; }
  if (!(await confirmBox(`Restore order ${o.orderNumber}?\n\nIt comes back as a cancelled order. To carry on with it, re-open it on its page.`))) return false;
  updateDbAs({ summary: `Restored deleted order ${o.orderNumber}` }, d => {
    const live = d.orders.find(x => x.id === orderId);
    if (!live) return;
    delete live.deletedAt;
    delete live.deletedBy;
  });
  toast.success(`${o.orderNumber} restored — it is a cancelled order now`);
  return true;
}

/** Why this order can't move to another client now; undefined when it can. */
export function clientChangeBlocker(db: DB, o: Order): string | undefined {
  if (!collectionsFresh(ORDER_ADMIN_COLS)) return CHECKING;
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
