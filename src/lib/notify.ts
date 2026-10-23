// In-app alerts for staff. Almost every alert used to go to a client; a team
// member heard about little but an order or a task handed to them, so their
// Alerts list (and the phone push that follows each alert — functions/src/
// notifications.ts) stayed empty. These put alerts in front of the people who
// have to act on them. Call inside updateDb().
import { uid, type DB } from "./db";

/** Every active admin. */
export function adminIds(d: Pick<DB, "users">): string[] {
  return d.users.filter(u => u.role === "admin" && u.status !== "inactive").map(u => u.id);
}

/**
 * One alert to each of these people — each once, never to whoever caused it
 * (`exceptId`), never to someone switched off.
 */
export function notifyUsers(
  d: DB,
  userIds: (string | undefined | null)[],
  n: { title: string; body: string; type: string; at?: string },
  exceptId?: string,
): void {
  const at = n.at ?? new Date().toISOString();
  const seen = new Set<string>();
  for (const id of userIds) {
    if (!id || id === exceptId || seen.has(id)) continue;
    seen.add(id);
    const u = d.users.find(x => x.id === id);
    if (!u || u.status === "inactive") continue;
    d.notifications.unshift({ id: uid("n_"), userId: id, title: n.title, body: n.body, type: n.type, read: false, createdAt: at });
  }
}
