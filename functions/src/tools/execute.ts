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
  // Exact total via Firestore's count() aggregation — cheap regardless of how
  // many thousand orders match, since it never fetches the actual documents.
  // Only computed for single-filter scopes; the employee "all my clients at
  // once" case below is a union of two query paths and isn't given an exact
  // total (the returned list itself is still accurate, just not a total count).
  let totalCount: number | undefined;

  if (caller.role === "client") {
    let q: Query = base.where("clientId", "==", caller.clientId);
    if (status) q = q.where("status", "==", status);
    totalCount = (await q.count().get()).data().count;
    add(await q.orderBy("createdAt", "desc").limit(limit).get());
  } else if (caller.role === "admin") {
    let q: Query = base;
    if (clientId) q = q.where("clientId", "==", clientId);
    if (status) q = q.where("status", "==", status);
    totalCount = (await q.count().get()).data().count;
    add(await q.orderBy("createdAt", "desc").limit(limit).get());
  } else if (clientId) {
    let q: Query = base.where("clientId", "==", clientId);
    if (status) q = q.where("status", "==", status);
    totalCount = (await q.count().get()).data().count;
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
  return {
    ...(totalCount !== undefined ? { total_matching: totalCount } : {}),
    orders: docs.slice(0, limit).map(orderSummary),
  };
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
  let totalCount = 0;

  if (caller.role === "client") {
    let q: Query = base.where("clientId", "==", caller.clientId);
    if (paid !== undefined) q = q.where("paid", "==", paid);
    totalCount = (await q.count().get()).data().count;
    add(await q.orderBy("createdAt", "desc").limit(limit).get());
  } else if (caller.role === "admin") {
    let q: Query = base;
    if (clientId) q = q.where("clientId", "==", clientId);
    if (paid !== undefined) q = q.where("paid", "==", paid);
    totalCount = (await q.count().get()).data().count;
    add(await q.orderBy("createdAt", "desc").limit(limit).get());
  } else if (clientId) {
    let q: Query = base.where("clientId", "==", clientId);
    if (paid !== undefined) q = q.where("paid", "==", paid);
    totalCount = (await q.count().get()).data().count;
    add(await q.orderBy("createdAt", "desc").limit(limit).get());
  } else {
    // Chunked only because "in" caps at 30 values — each chunk is a disjoint
    // slice of the same clientId set, so summing counts across chunks is
    // still an exact total (no overlap to double-count).
    const mine = await resolveEmployeeClientIds(caller.appId);
    for (const c of chunk([...mine], 30)) {
      if (!c.length) continue;
      let q: Query = base.where("clientId", "in", c);
      if (paid !== undefined) q = q.where("paid", "==", paid);
      totalCount += (await q.count().get()).data().count;
      add(await q.orderBy("createdAt", "desc").limit(limit).get());
    }
  }

  docs.sort((a, b) => String(b.get("createdAt") || "").localeCompare(String(a.get("createdAt") || "")));
  return { total_matching: totalCount, invoices: docs.slice(0, limit).map(invoiceSummary) };
}

async function getAccountSummary(args: Record<string, unknown>, caller: Caller) {
  const { clientId, denied } = await resolveScopedClientName(args, caller);
  if (denied) return { error: "not_authorized_for_this_client" };

  // Matches the app's own Invoices page exactly: totals are based only on
  // orders that have an invoice generated (not every order), computed from
  // the LIVE order data rather than the invoice's own amount/paid snapshot
  // (which can go stale after the order is edited post-invoicing). Invoices
  // have no assignedEmployeeId field, so employee scoping goes entirely
  // through their permitted clientId set.
  const base = db.collection("invoices");
  const invoiceDocs: QueryDocumentSnapshot[] = [];
  const seen = new Set<string>();
  const add = (snap: QuerySnapshot) =>
    snap.docs.forEach(dd => {
      if (!seen.has(dd.id)) { invoiceDocs.push(dd); seen.add(dd.id); }
    });

  if (caller.role === "client") {
    add(await base.where("clientId", "==", caller.clientId).orderBy("createdAt", "desc").limit(ACCOUNT_SUMMARY_CAP).get());
  } else if (caller.role === "admin") {
    let q: Query = base;
    if (clientId) q = q.where("clientId", "==", clientId);
    add(await q.orderBy("createdAt", "desc").limit(ACCOUNT_SUMMARY_CAP).get());
  } else if (clientId) {
    add(await base.where("clientId", "==", clientId).orderBy("createdAt", "desc").limit(ACCOUNT_SUMMARY_CAP).get());
  } else {
    const mine = await resolveEmployeeClientIds(caller.appId);
    for (const c of chunk([...mine], 30)) {
      if (!c.length) continue;
      add(await base.where("clientId", "in", c).orderBy("createdAt", "desc").limit(ACCOUNT_SUMMARY_CAP).get());
    }
  }

  const orderIds = [...new Set(invoiceDocs.map(d => d.get("orderId")).filter(Boolean))];
  const orderDocs = orderIds.length
    ? await db.getAll(...orderIds.map(id => db.collection("orders").doc(id)))
    : [];

  const round2 = (n: number) => Math.round(n * 100) / 100;
  let billed = 0, received = 0, outstanding = 0;
  const perClient = new Map<string, { billed: number; received: number; outstanding: number }>();
  for (const doc of orderDocs) {
    if (!doc.exists) continue;
    const d = doc.data()!;
    billed += orderTotal(d);
    received += totalAdvance(d);
    outstanding += balanceDue(d);

    const cid = d.clientId as string | undefined;
    if (cid) {
      const row = perClient.get(cid) ?? { billed: 0, received: 0, outstanding: 0 };
      row.billed += orderTotal(d);
      row.received += totalAdvance(d);
      row.outstanding += balanceDue(d);
      perClient.set(cid, row);
    }
  }

  // Per-client breakdown — only meaningful for staff looking at more than one
  // client at once (a single named client, or a client-role caller, is
  // already a one-client view). Answers "which clients owe how much" /
  // "client wise due balance" directly instead of just one grand total.
  let byClient: Array<{ client_name: string; billed: number; received: number; outstanding: number }> | undefined;
  if (caller.role !== "client" && !clientId && perClient.size > 0) {
    const clientDocs = await db.getAll(...[...perClient.keys()].map(id => db.collection("clients").doc(id)));
    const names = new Map(clientDocs.filter(d => d.exists).map(d => [d.id, d.get("companyName") as string]));
    byClient = [...perClient.entries()]
      .map(([cid, v]) => ({
        client_name: names.get(cid) ?? "Unknown client",
        billed: round2(v.billed),
        received: round2(v.received),
        outstanding: round2(v.outstanding),
      }))
      .sort((a, b) => b.outstanding - a.outstanding)
      .slice(0, 20);
  }

  return {
    invoices_counted: invoiceDocs.length,
    total_billed: round2(billed),
    total_received: round2(received),
    total_outstanding: round2(outstanding),
    truncated: invoiceDocs.length >= ACCOUNT_SUMMARY_CAP,
    ...(byClient ? { by_client_top20_by_outstanding: byClient } : {}),
  };
}

async function listClients(args: Record<string, unknown>, caller: Caller) {
  if (caller.role === "client") return { error: "unknown_or_unauthorized_tool" };
  const limit = Math.max(1, Math.min(200, typeof args.limit === "number" ? Math.round(args.limit) : 100));

  // Bounded collection (real business relationships, not thousands) — safe to
  // fetch in full and filter/slice in memory, same reasoning as
  // resolveClientByName().
  const snap = await db.collection("clients").get();
  let docs = snap.docs;
  if (caller.role === "employee") {
    const mine = await resolveEmployeeClientIds(caller.appId);
    docs = docs.filter(d => mine.has(d.id));
  }
  docs = docs.slice(0, limit);

  return {
    clients_counted: docs.length,
    clients: docs.map(d => ({ name: d.get("companyName"), status: d.get("status") })),
  };
}

const EXECUTORS: Record<ToolName, (args: Record<string, unknown>, caller: Caller) => Promise<Record<string, unknown>>> = {
  find_order: findOrder,
  list_orders: listOrders,
  list_invoices: listInvoices,
  get_account_summary: getAccountSummary,
  list_clients: listClients,
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
