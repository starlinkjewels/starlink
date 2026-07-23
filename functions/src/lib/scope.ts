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
 * An employee's permitted client ids: clients they manage (Client.accountManagerId)
 * UNION clientIds of orders assigned directly to them (Order.assignedEmployeeId).
 * The union is required because Invoice has no assignedEmployeeId field — only
 * clientId — so invoice access must be expressed via this clientId set. Mirrors
 * currentUserOrders() in src/lib/db.ts.
 */
export async function resolveEmployeeClientIds(appId: string): Promise<Set<string>> {
  const ids = new Set<string>();
  const managed = await db.collection("clients").where("accountManagerId", "==", appId).get();
  managed.forEach(d => ids.add(d.id));
  const assigned = await db.collection("orders").where("assignedEmployeeId", "==", appId).limit(500).get();
  assigned.forEach(d => {
    const clientId = d.get("clientId");
    if (clientId) ids.add(clientId);
  });
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
