import type { Query, QueryDocumentSnapshot, QuerySnapshot } from "firebase-admin/firestore";
import { db } from "../lib/firestoreAdmin";
import { balanceDue, orderTotal, totalAdvance } from "../lib/money";
import { resolveClientByName, resolveEmployeeClientIds, type Caller } from "../lib/scope";
import { TOOL_NAMES, type ToolName } from "./schema";

const MAX_LIMIT = 50;
const ACCOUNT_SUMMARY_CAP = 1000; // v1 cap for admin/global aggregates — see plan notes

function clampLimit(n: unknown, dflt = 20): number {
  const v = typeof n === "number" && Number.isFinite(n) ? n : dflt;
  return Math.max(1, Math.min(MAX_LIMIT, Math.round(v)));
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/** Resolve an optional client_name arg (staff-only) to a permitted clientId. */
async function resolveScopedClientName(
  args: Record<string, unknown>,
  caller: Caller,
): Promise<{ clientId?: string; denied?: boolean }> {
  const name = typeof args.client_name === "string" ? args.client_name : undefined;
  if (!name) return {};
  const resolved = await resolveClientByName(name, caller);
  if (!resolved) return { denied: true };
  return { clientId: resolved };
}

function orderSummary(doc: QueryDocumentSnapshot) {
  const d = doc.data();
  return {
    order_number: d.orderNumber,
    status: d.status,
    total_amount: orderTotal(d),
    balance_due: balanceDue(d),
    advance_paid: totalAdvance(d),
    expected_delivery: d.expectedDelivery ?? null,
    dispatch: d.courierName ? { courier: d.courierName, tracking_number: d.trackingNumber ?? null } : null,
    created_at: d.createdAt,
  };
}

function invoiceSummary(doc: QueryDocumentSnapshot) {
  const d = doc.data();
  return { invoice_number: d.number, amount: d.amount, paid: d.paid, created_at: d.createdAt };
}

async function findOrder(args: Record<string, unknown>, caller: Caller) {
  const orderNumber = typeof args.order_number === "string" ? args.order_number.trim() : "";
  if (!orderNumber) return { error: "order_number is required" };

  const snap = await db.collection("orders").where("orderNumber", "==", orderNumber).limit(1).get();
  if (snap.empty) return { error: "order_not_found" };
  const doc = snap.docs[0];
  const d = doc.data();

  let allowed: boolean;
  if (caller.role === "admin") allowed = true;
  else if (caller.role === "client") allowed = d.clientId === caller.clientId;
  else {
    const mine = await resolveEmployeeClientIds(caller.appId);
    allowed = d.assignedEmployeeId === caller.appId || mine.has(d.clientId);
  }
  // Never confirm existence of an out-of-scope order — same error either way.
  if (!allowed) return { error: "order_not_found" };

  return orderSummary(doc);
}

async function listOrders(args: Record<string, unknown>, caller: Caller) {
  const limit = clampLimit(args.limit);
  const status = typeof args.status === "string" ? args.status : undefined;
  const { clientId, denied } = await resolveScopedClientName(args, caller);
  if (denied) return { error: "not_authorized_for_this_client" };

  const base = db.collection("orders");
  const docs: QueryDocumentSnapshot[] = [];
  const seen = new Set<string>();
  const add = (snap: QuerySnapshot) =>
    snap.docs.forEach(dd => {
      if (!seen.has(dd.id)) { docs.push(dd); seen.add(dd.id); }
    });

  if (caller.role === "client") {
    let q: Query = base.where("clientId", "==", caller.clientId);
    if (status) q = q.where("status", "==", status);
    add(await q.orderBy("createdAt", "desc").limit(limit).get());
  } else if (caller.role === "admin") {
    let q: Query = base;
    if (clientId) q = q.where("clientId", "==", clientId);
    if (status) q = q.where("status", "==", status);
    add(await q.orderBy("createdAt", "desc").limit(limit).get());
  } else if (clientId) {
    let q: Query = base.where("clientId", "==", clientId);
    if (status) q = q.where("status", "==", status);
    add(await q.orderBy("createdAt", "desc").limit(limit).get());
  } else {
    // employee, no specific client named — their assigned orders + orders of clients they manage
    let q1: Query = base.where("assignedEmployeeId", "==", caller.appId);
    if (status) q1 = q1.where("status", "==", status);
    add(await q1.orderBy("createdAt", "desc").limit(limit).get());

    const mine = await resolveEmployeeClientIds(caller.appId);
    for (const c of chunk([...mine], 30)) {
      if (!c.length) continue;
      let q2: Query = base.where("clientId", "in", c);
      if (status) q2 = q2.where("status", "==", status);
      add(await q2.orderBy("createdAt", "desc").limit(limit).get());
    }
  }

  docs.sort((a, b) => String(b.get("createdAt") || "").localeCompare(String(a.get("createdAt") || "")));
  return { orders: docs.slice(0, limit).map(orderSummary) };
}

async function listInvoices(args: Record<string, unknown>, caller: Caller) {
  const limit = clampLimit(args.limit);
  const paid = typeof args.paid === "boolean" ? args.paid : undefined;
  const orderNumber = typeof args.order_number === "string" ? args.order_number.trim() : undefined;

  if (orderNumber) {
    const order = await findOrder({ order_number: orderNumber }, caller);
    if ("error" in order) return order;
    const orderDoc = await db.collection("orders").where("orderNumber", "==", orderNumber).limit(1).get();
    const snap = await db.collection("invoices").where("orderId", "==", orderDoc.docs[0].id).limit(limit).get();
    return { invoices: snap.docs.map(invoiceSummary) };
  }

  const { clientId, denied } = await resolveScopedClientName(args, caller);
  if (denied) return { error: "not_authorized_for_this_client" };

  const base = db.collection("invoices");
  const docs: QueryDocumentSnapshot[] = [];
  const seen = new Set<string>();
  const add = (snap: QuerySnapshot) =>
    snap.docs.forEach(dd => {
      if (!seen.has(dd.id)) { docs.push(dd); seen.add(dd.id); }
    });

  if (caller.role === "client") {
    let q: Query = base.where("clientId", "==", caller.clientId);
    if (paid !== undefined) q = q.where("paid", "==", paid);
    add(await q.orderBy("createdAt", "desc").limit(limit).get());
  } else if (caller.role === "admin") {
    let q: Query = base;
    if (clientId) q = q.where("clientId", "==", clientId);
    if (paid !== undefined) q = q.where("paid", "==", paid);
    add(await q.orderBy("createdAt", "desc").limit(limit).get());
  } else if (clientId) {
    let q: Query = base.where("clientId", "==", clientId);
    if (paid !== undefined) q = q.where("paid", "==", paid);
    add(await q.orderBy("createdAt", "desc").limit(limit).get());
  } else {
    const mine = await resolveEmployeeClientIds(caller.appId);
    for (const c of chunk([...mine], 30)) {
      if (!c.length) continue;
      let q: Query = base.where("clientId", "in", c);
      if (paid !== undefined) q = q.where("paid", "==", paid);
      add(await q.orderBy("createdAt", "desc").limit(limit).get());
    }
  }

  docs.sort((a, b) => String(b.get("createdAt") || "").localeCompare(String(a.get("createdAt") || "")));
  return { invoices: docs.slice(0, limit).map(invoiceSummary) };
}

async function getAccountSummary(args: Record<string, unknown>, caller: Caller) {
  const { clientId, denied } = await resolveScopedClientName(args, caller);
  if (denied) return { error: "not_authorized_for_this_client" };

  const base = db.collection("orders");
  const docs: QueryDocumentSnapshot[] = [];
  const seen = new Set<string>();
  const add = (snap: QuerySnapshot) =>
    snap.docs.forEach(dd => {
      if (!seen.has(dd.id)) { docs.push(dd); seen.add(dd.id); }
    });

  // Always ordered newest-first before the cap, so once a client/business
  // passes ACCOUNT_SUMMARY_CAP orders, the summary is deterministically the
  // most recent N rather than an arbitrary Firestore-returned subset.
  if (caller.role === "client") {
    add(await base.where("clientId", "==", caller.clientId).orderBy("createdAt", "desc").limit(ACCOUNT_SUMMARY_CAP).get());
  } else if (caller.role === "admin") {
    let q: Query = base;
    if (clientId) q = q.where("clientId", "==", clientId);
    add(await q.orderBy("createdAt", "desc").limit(ACCOUNT_SUMMARY_CAP).get());
  } else if (clientId) {
    add(await base.where("clientId", "==", clientId).orderBy("createdAt", "desc").limit(ACCOUNT_SUMMARY_CAP).get());
  } else {
    add(await base.where("assignedEmployeeId", "==", caller.appId).orderBy("createdAt", "desc").limit(ACCOUNT_SUMMARY_CAP).get());
    const mine = await resolveEmployeeClientIds(caller.appId);
    for (const c of chunk([...mine], 30)) {
      if (!c.length) continue;
      add(await base.where("clientId", "in", c).orderBy("createdAt", "desc").limit(ACCOUNT_SUMMARY_CAP).get());
    }
  }

  let billed = 0, received = 0, outstanding = 0;
  for (const doc of docs) {
    const d = doc.data();
    billed += orderTotal(d);
    received += totalAdvance(d);
    outstanding += balanceDue(d);
  }
  const round2 = (n: number) => Math.round(n * 100) / 100;
  return {
    orders_counted: docs.length,
    total_billed: round2(billed),
    total_received: round2(received),
    total_outstanding: round2(outstanding),
    truncated: docs.length >= ACCOUNT_SUMMARY_CAP,
  };
}

const EXECUTORS: Record<ToolName, (args: Record<string, unknown>, caller: Caller) => Promise<Record<string, unknown>>> = {
  find_order: findOrder,
  list_orders: listOrders,
  list_invoices: listInvoices,
  get_account_summary: getAccountSummary,
};

/**
 * Single entry point the callable's tool-calling loop uses. Any tool name
 * outside the caller's allowed set (hallucinated, or valid only for a
 * different role) is rejected here without executing anything.
 */
export async function executeTool(name: string, argsJson: string, caller: Caller): Promise<Record<string, unknown>> {
  if (!(TOOL_NAMES as readonly string[]).includes(name)) {
    return { error: "unknown_or_unauthorized_tool" };
  }

  let args: Record<string, unknown> = {};
  try {
    args = argsJson ? JSON.parse(argsJson) : {};
  } catch {
    return { error: "invalid_arguments" };
  }

  // Defense in depth: a client's tool schema never exposes client_name to the
  // model, but strip it anyway in case of a malformed/adversarial call.
  if (caller.role === "client") delete args.client_name;

  try {
    return await EXECUTORS[name as ToolName](args, caller);
  } catch (err) {
    console.error(`[starlinkAiChat] tool "${name}" failed:`, err);
    return { error: "lookup_failed" };
  }
}
