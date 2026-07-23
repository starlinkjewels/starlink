import { HttpsError } from "firebase-functions/v2/https";
import { db } from "./firestoreAdmin";

export type Role = "admin" | "employee" | "client";

export interface Caller {
  uid: string;
  role: Role;
  clientId: string | null;
  appId: string;
}

interface IndexDoc {
  role: Role;
  clientId: string | null;
  appId: string;
  status: "active" | "inactive";
}

/**
 * Re-derive the caller's role/scope from Firestore ourselves — never trust
 * anything the client sends. Mirrors how `userByAuth/{uid}` is consulted by
 * firestore.rules and src/lib/db.ts's resolveScope().
 */
export async function resolveCaller(uid: string): Promise<Caller> {
  const snap = await db.collection("userByAuth").doc(uid).get();
  if (!snap.exists) throw new HttpsError("permission-denied", "This account has no access.");
  const data = snap.data() as IndexDoc;
  if (data.status !== "active") throw new HttpsError("permission-denied", "This account is inactive.");
  return { uid, role: data.role, clientId: data.clientId ?? null, appId: data.appId };
}

/**
 * An employee's MANAGED client ids — clients where Client.accountManagerId is
 * them. This is the boundary for whole-account visibility: client_name
 * resolution, list_clients, and account/invoice summaries all use this set.
 *
 * Deliberately does NOT include clientIds of orders merely assigned to them
 * (Order.assignedEmployeeId) — being assigned one order for a client managed
 * by someone else grants visibility into that ONE order (handled separately,
 * e.g. findOrder's own `assignedEmployeeId` check, and listOrders' own direct
 * query for assigned orders), not that client's entire order/invoice history.
 * Expanding this set to include assigned-order clients would leak the rest of
 * that client's account to an employee who isn't actually their manager —
 * exactly the kind of over-broad access this app's role model must avoid.
 */
export async function resolveEmployeeClientIds(appId: string): Promise<Set<string>> {
  const ids = new Set<string>();
  const managed = await db.collection("clients").where("accountManagerId", "==", appId).get();
  managed.forEach(d => ids.add(d.id));
  return ids;
}

/**
 * Resolve a free-text client name (supplied by the model, staff-only tool param)
 * to a clientId the caller is actually permitted to see. `clients` is a small,
 * bounded collection (real business relationships, not thousands), so a full
 * in-memory scan here is safe — unlike orders/invoices, which must always use
 * targeted queries.
 */
export async function resolveClientByName(name: string, caller: Caller): Promise<string | null> {
  const snap = await db.collection("clients").get();
  const needle = name.trim().toLowerCase();
  const match = snap.docs.find(d => ((d.get("companyName") as string) || "").toLowerCase().includes(needle));
  if (!match) return null;

  if (caller.role === "admin") return match.id;
  if (caller.role === "employee") {
    const allowed = await resolveEmployeeClientIds(caller.appId);
    return allowed.has(match.id) ? match.id : null;
  }
  return match.id === caller.clientId ? match.id : null;
}
