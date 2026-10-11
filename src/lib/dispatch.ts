import {
  stampFor, uid, isDiamondOnlyOrder, isProductionStep, statusFromTimeline,
  orderTotal, balanceDue, cashbackPercentFor, issueGiftCard, fmtMoney,
  type DB, type Order,
} from "@/lib/db";

/**
 * Sending finished pieces out.
 *
 * A shipment is rarely one piece. Five or six go in the same parcel under one
 * courier and one tracking number, but dispatch could only ever be entered one
 * order at a time: find the order, open it, type the same courier and the same
 * tracking number again, repeat. The details were also stamped with the moment
 * they were typed, so an entry made two days after the parcel left recorded the
 * wrong day and nothing could correct it.
 *
 * The rules for sending one piece and for sending six are the same rules, so
 * they live here and both screens call them: no price, no dispatch; an unpaid
 * balance is shown and has to be accepted; a stage that is not reached yet is
 * not jumped over.
 */
export interface DispatchDetails {
  courierName: string;
  trackingNumber: string;
  trackingLink?: string;
  /** The day the parcel actually left — yyyy-mm-dd, not necessarily today. */
  day: string;
}

export function dispatchStepIndex(o: Order): number {
  return o.timeline.findIndex(t => t.step === "Dispatch");
}

/** Already gone — the stage is closed. Its details can still be corrected. */
export function isDispatched(o: Order): boolean {
  const i = dispatchStepIndex(o);
  return i >= 0 && o.timeline[i].status === "done";
}

/**
 * Why this order cannot be dispatched, or nothing if it can.
 *
 * An unpaid balance is deliberately NOT a blocker: it is a warning the sender
 * accepts, the same as the prompt on the single-order screen.
 */
export function dispatchBlocker(o: Order): string | null {
  const idx = dispatchStepIndex(o);
  if (idx < 0) return "No dispatch stage — this is an in-house stock build.";
  if (o.status === "Rejected") return "Order is rejected.";
  if (!isDispatched(o)) {
    // Every stage before this one has to be closed. A diamond-only order
    // carries no production stages at all (older ones still hold them, hidden),
    // so those never count against it.
    const open = o.timeline
      .slice(0, idx)
      .filter(t => t.status !== "done" && !(isDiamondOnlyOrder(o) && isProductionStep(t.step)))
      .map(t => t.step);
    if (open.length) return `Earlier stage${open.length > 1 ? "s" : ""} still open — ${open.join(", ")}.`;
    if (orderTotal(o) <= 0) return "No price set on this order.";
  }
  return null;
}

/**
 * Whether this person may dispatch this order at all.
 *
 * The same rule the single-order screen enforces: an admin may move any order,
 * an employee only the ones assigned to them or belonging to a client they
 * manage. Dispatching several at once must not become a way around it.
 */
export function dispatchPermission(db: DB, user: { id: string; role: string }, o: Order): string | null {
  if (user.role === "admin") return null;
  if (user.role !== "employee") return "You cannot dispatch orders.";
  const client = db.clients.find(c => c.id === o.clientId);
  if (o.assignedEmployeeId === user.id || client?.accountManagerId === user.id) return null;
  return "Not assigned to you — ask the admin or the account manager.";
}

/** What is still owed on it — shown before dispatching, never a blocker. */
export function dispatchUnpaid(o: Order): number {
  return Math.round(balanceDue(o) * 100) / 100;
}

export interface DispatchPlan {
  /** Will be marked dispatched now. */
  go: Order[];
  /** Already dispatched — only the courier details and date are corrected. */
  update: Order[];
  /** Left alone, with the reason. */
  skip: { order: Order; reason: string }[];
  /** Of those going out, the ones with money still owed. */
  unpaid: { order: Order; due: number }[];
}

/** Sort the selection into what will happen to each piece, before anything does. */
export function planDispatch(orders: Order[], db: DB, user: { id: string; role: string }): DispatchPlan {
  const plan: DispatchPlan = { go: [], update: [], skip: [], unpaid: [] };
  for (const o of orders) {
    const reason = dispatchPermission(db, user, o) ?? dispatchBlocker(o);
    if (reason) { plan.skip.push({ order: o, reason }); continue; }
    if (isDispatched(o)) { plan.update.push(o); continue; }
    plan.go.push(o);
    const due = dispatchUnpaid(o);
    if (due > 0) plan.unpaid.push({ order: o, due });
  }
  return plan;
}

/**
 * Write the dispatch onto one order. Called inside an `updateDb` draft, once
 * per order, so a parcel of six is one save rather than six.
 *
 * Returns what it did, so the caller can email only the orders that actually
 * went out and not the ones whose tracking number was merely corrected.
 */
export function applyDispatch(
  d: DB,
  orderId: string,
  det: DispatchDetails,
  by: { id: string; role: string; department?: string },
): "dispatched" | "updated" | "skipped" {
  const o = d.orders.find(x => x.id === orderId);
  if (!o) return "skipped";
  // Checked again at the moment of writing, not only when the list was drawn:
  // the rules are what decide, never the screen that called this.
  if (dispatchPermission(d, by, o)) return "skipped";
  if (dispatchBlocker(o)) return "skipped";

  const at = stampFor(det.day);
  const already = isDispatched(o);
  const idx = dispatchStepIndex(o);

  o.courierName = det.courierName.trim();
  o.trackingNumber = det.trackingNumber.trim();
  o.trackingLink = det.trackingLink?.trim() || undefined;
  o.dispatchedAt = at;

  if (already) {
    // Correcting a parcel already gone: the stage keeps its place in the
    // timeline but carries the day the goods really left.
    o.timeline[idx] = { ...o.timeline[idx], date: at };
    return "updated";
  }

  // Older diamond-only orders still hold the production stages they never had.
  // They are hidden on screen, so close them with the dispatch or the order can
  // never move past them — the same thing the single-order screen does.
  if (isDiamondOnlyOrder(o)) {
    for (let i = 0; i < idx; i++) {
      if (o.timeline[i].status !== "done" && isProductionStep(o.timeline[i].step)) {
        o.timeline[i] = { ...o.timeline[i], status: "done", date: at, remarks: "Not applicable — diamond only" };
      }
    }
  }

  o.timeline[idx] = {
    ...o.timeline[idx],
    status: "done",
    date: at,
    employeeId: by.id,
    department: by.department,
    remarks: "Completed",
  };
  if (idx + 1 < o.timeline.length && o.timeline[idx + 1].status === "pending") {
    o.timeline[idx + 1].status = "in_progress";
  }
  o.status = statusFromTimeline(o.timeline, o.forReadyStock, o.materialSourcing === "readyStock");

  const clientUser = d.users.find(u => u.clientId === o.clientId);
  if (clientUser) {
    d.notifications.unshift({
      id: uid("n_"),
      userId: clientUser.id,
      title: "Order Dispatched",
      body: `${o.orderNumber} dispatched via ${o.courierName} · Tracking: ${o.trackingNumber}`,
      type: "info",
      read: false,
      createdAt: new Date().toISOString(),
    });
  }
  return "dispatched";
}

/* ────────────────────────────────────────────────────────────────────────────
 * Arrival.
 *
 * The last stage, and the same problem as the first: a parcel of six arrives
 * together and was closed one order at a time, dated the day somebody got
 * round to it. Delivery also pays the client their cashback, so closing it in
 * bulk has to grant exactly what closing it singly grants — no more, and never
 * twice.
 * ──────────────────────────────────────────────────────────────────────────── */

export function deliveryStepIndex(o: Order): number {
  return o.timeline.findIndex(t => t.step === "Delivered");
}

export function isDelivered(o: Order): boolean {
  const i = deliveryStepIndex(o);
  return i >= 0 && o.timeline[i].status === "done";
}

/** Why this order cannot be marked delivered, or nothing if it can. */
export function deliveryBlocker(o: Order): string | null {
  const idx = deliveryStepIndex(o);
  if (idx < 0) return "No delivery stage — this is an in-house stock build.";
  if (o.status === "Rejected") return "Order is rejected.";
  if (!isDelivered(o)) {
    const open = o.timeline
      .slice(0, idx)
      .filter(t => t.status !== "done" && !(isDiamondOnlyOrder(o) && isProductionStep(t.step)))
      .map(t => t.step);
    // Dispatch is one of these, so nothing can arrive before it has left.
    if (open.length) return `Earlier stage${open.length > 1 ? "s" : ""} still open — ${open.join(", ")}.`;
  }
  return null;
}

/** Sort the selection into what will happen to each piece, before anything does. */
export function planDelivery(orders: Order[], db: DB, user: { id: string; role: string }): DispatchPlan {
  const plan: DispatchPlan = { go: [], update: [], skip: [], unpaid: [] };
  for (const o of orders) {
    const reason = dispatchPermission(db, user, o) ?? deliveryBlocker(o);
    if (reason) { plan.skip.push({ order: o, reason }); continue; }
    if (isDelivered(o)) { plan.update.push(o); continue; }
    plan.go.push(o);
    const due = dispatchUnpaid(o);
    if (due > 0) plan.unpaid.push({ order: o, due });
  }
  return plan;
}

/**
 * Close the delivery on one order. Called inside an `updateDb` draft.
 *
 * Mirrors what marking the stage complete on the order's own screen does,
 * including the cashback gift card, which is granted once and only to a
 * gift-card client on a real (non-stock) order.
 */
export function applyDelivery(
  d: DB,
  orderId: string,
  day: string,
  by: { id: string; role: string; department?: string },
): "delivered" | "updated" | "skipped" {
  const o = d.orders.find(x => x.id === orderId);
  if (!o) return "skipped";
  if (dispatchPermission(d, by, o)) return "skipped";
  if (deliveryBlocker(o)) return "skipped";

  const at = stampFor(day);
  const idx = deliveryStepIndex(o);
  o.deliveredAt = at;

  if (isDelivered(o)) {
    // Correcting the day it arrived. The cashback, if any, was granted when the
    // stage first closed and is not granted again.
    o.timeline[idx] = { ...o.timeline[idx], date: at };
    return "updated";
  }

  o.timeline[idx] = {
    ...o.timeline[idx],
    status: "done",
    date: at,
    employeeId: by.id,
    department: by.department,
    remarks: "Completed",
  };
  o.status = statusFromTimeline(o.timeline, o.forReadyStock, o.materialSourcing === "readyStock");

  // Cashback: on delivery of a real (client) order, a % gift card towards the
  // next one — gift-card clients only, and once per order. The card is dated
  // NOW even when the delivery is back-dated: its thirty days are the client's
  // to spend from the moment it exists, not from a day already past.
  if (o.status === "Delivered" && !o.forReadyStock && !o.cashbackIssued) {
    const c = d.clients.find(x => x.id === o.clientId);
    const pct = cashbackPercentFor(d, c);
    const amt = Math.round(orderTotal(o) * pct) / 100; // pct is a percentage
    if (c && pct > 0 && amt > 0) {
      const now = new Date().toISOString();
      issueGiftCard(d, { clientId: o.clientId, amount: amt, source: "cashback", issuedBy: "system", sourceOrderId: o.id, at: now });
      o.cashbackIssued = true;
      const cu = d.users.find(u => u.clientId === o.clientId && u.role === "client");
      if (cu) {
        d.notifications.unshift({
          id: uid("n_"), userId: cu.id, title: "Cashback earned 🎁",
          body: `${fmtMoney(amt)} gift card for your next order (from ${o.orderNumber}). Valid 30 days.`,
          type: "info", read: false, createdAt: now,
        });
      }
    }
  }

  const clientUser = d.users.find(u => u.clientId === o.clientId);
  if (clientUser) {
    d.notifications.unshift({
      id: uid("n_"), userId: clientUser.id, title: "Order Delivered",
      body: `${o.orderNumber} has been marked delivered.`,
      type: "info", read: false, createdAt: new Date().toISOString(),
    });
  }
  return "delivered";
}

/* ────────────────────────────────────────────────────────────────────────────
 * What the shipment cost us.
 *
 * Freight and insurance are paid once per parcel, however many pieces are in
 * it. Recorded here as expenses tied to those orders: they appear in the
 * expense list and — when paid from an account — in that account's book like
 * any other expense, and each order's cost carries its share by value. One
 * entry, every place it belongs, nothing typed twice.
 * ──────────────────────────────────────────────────────────────────────────── */

export interface ShippingCost {
  freight: number;
  insurance: number;
  /** Currency the amounts are in — the paying account's, when one is chosen. */
  currency: "INR" | "USD";
  /** The account it was paid from. Left out when the courier bills later. */
  lockerId?: string;
}

export const EMPTY_SHIPPING_COST: ShippingCost = { freight: 0, insurance: 0, currency: "INR" };

/** Writes the freight and insurance for one parcel. Call inside updateDb. */
export function recordShippingCost(
  d: DB,
  orderIds: string[],
  cost: ShippingCost,
  shipment: { courierName: string; trackingNumber: string },
  by: { id: string },
  at: string,
): number {
  if (!orderIds.length) return 0;
  const locker = cost.lockerId ? d.lockers.find(l => l.id === cost.lockerId) : undefined;
  // Paid from an account, the amount is in that account's currency, full stop.
  const currency: "INR" | "USD" = locker ? ((locker.currency || "INR") === "USD" ? "USD" : "INR") : cost.currency;
  const ref = `${shipment.courierName.trim()} ${shipment.trackingNumber.trim()}`.trim();
  const numbers = orderIds.map(id => d.orders.find(o => o.id === id)?.orderNumber).filter(Boolean).join(", ");
  let written = 0;
  for (const [kind, amount] of [["Freight", cost.freight], ["Insurance", cost.insurance]] as const) {
    if (!(amount > 0)) continue;
    const id = uid("exp_");
    if (!d.expenses) d.expenses = [];
    d.expenses.push({
      id,
      title: `${kind} — ${ref}`,
      amount: Math.round(amount * 100) / 100,
      category: "Shipping",
      note: `Shipment of ${numbers}`,
      employeeId: by.id,
      currency,
      createdAt: at,
      lockerId: locker?.id,
      orderIds: [...orderIds],
      shipmentRef: ref,
    });
    if (locker) {
      if (!d.lockerTransactions) d.lockerTransactions = [];
      d.lockerTransactions.push({
        id: uid("ltx_"), lockerId: locker.id, type: "expense", amountInr: Math.round(amount * 100) / 100,
        currency: locker.currency || "INR", category: `Expense — ${kind} — ${ref}`,
        refType: "expense", refId: id, recordedBy: by.id, createdAt: at,
      });
    }
    written++;
  }
  return written;
}
