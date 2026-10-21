/**
 * Who handles a client — the person named on it ("Handled by"). An admin can
 * handle clients too, not only an employee; a client nobody was given says so
 * plainly rather than "Admin".
 *
 * Only what is shown changes here. Who may open a client is decided elsewhere
 * (worksOnClient): an admin reaches every client whatever this says, and an
 * employee is given their clients exactly as before.
 */
import { collection, getDocs, limit, orderBy, query, startAfter, type DocumentData, type QueryConstraint, type QueryDocumentSnapshot, type QuerySnapshot } from "firebase/firestore";
import { db as fsdb } from "./firebase";
import type { Client, DB, User } from "./db";
import type { ActivityEntry } from "./activityFormat";

/** The people a client can be handed to: active admins first, then employees. The one it has now stays offered. */
export function handlerChoices(db: Pick<DB, "users">, current?: string): User[] {
  const rank = (u: User) => (u.role === "admin" ? 0 : 1);
  return db.users
    .filter(u => (u.role === "admin" || u.role === "employee") && (u.status !== "inactive" || u.id === current))
    .sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
}

/** The person handling this client, if one was named. */
export function handlerOf(db: Pick<DB, "users">, c: Pick<Client, "accountManagerId">): User | undefined {
  return c.accountManagerId ? db.users.find(u => u.id === c.accountManagerId) : undefined;
}

/** "Harshil Kumbhani", or "Not assigned". */
export function handlerName(db: Pick<DB, "users">, c: Pick<Client, "accountManagerId">): string {
  return handlerOf(db, c)?.name ?? "Not assigned";
}

/**
 * For every client nobody handles yet: the admin who added it, read from the
 * activity log (each save records who made it). Only admins are proposed —
 * an employee who adds a client is named on it already, when it is created —
 * so filling these in changes no one's access. Nothing is written here.
 */
export async function proposeHandlers(db: Pick<DB, "users" | "clients">): Promise<{ clientId: string; userId: string }[]> {
  const open = new Set(db.clients.filter(c => !c.accountManagerId).map(c => c.id));
  if (!open.size) return [];
  const admins = new Set(db.users.filter(u => u.role === "admin" && u.status !== "inactive").map(u => u.id));
  const addedBy = new Map<string, string>();
  let cursor: QueryDocumentSnapshot<DocumentData> | null = null;
  // Oldest first, so the first "added" wins; read in pages, the whole log.
  for (let page = 0; page < 200; page++) {
    const parts: QueryConstraint[] = [orderBy("at", "asc"), ...(cursor ? [startAfter(cursor)] : []), limit(500)];
    const snap: QuerySnapshot<DocumentData> = await getDocs(query(collection(fsdb, "activityLog"), ...parts));
    for (const d of snap.docs) {
      const e = d.data() as ActivityEntry;
      for (const c of e.changes ?? []) {
        if (c.col === "clients" && c.op === "add" && open.has(c.id) && !addedBy.has(c.id)) addedBy.set(c.id, e.actorId);
      }
    }
    if (snap.docs.length < 500) break;
    cursor = snap.docs[snap.docs.length - 1];
  }
  return [...addedBy].filter(([, uid]) => admins.has(uid)).map(([clientId, userId]) => ({ clientId, userId }));
}
