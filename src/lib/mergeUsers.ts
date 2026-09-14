// Merging duplicate staff/user accounts.
//
// Before the admin bootstrap was e-mail-aware it could add a second (and third)
// "Administrator" row for the same person — same e-mail, different internal id.
// Simply deleting the extras would orphan everything attributed to them ("by
// Administrator" on a payment, an order's assigned employee, an expense, …), so
// a merge has to REPOINT every reference onto the surviving account first.
//
// References are found by field NAME rather than a hand-written list of paths,
// so a collection added later is covered automatically.
import { updateDb, type DB, type User } from "./db";

/** Every field in the data model that holds a User.id. */
const USER_REF_KEYS = new Set([
  "accountManagerId",
  "assignedEmployeeId",
  "employeeId",
  "paidToEmployeeId",
  "assignedTo",
  "createdBy",
  "recordedBy",
  "issuedBy",
  "fromUserId",
  "toUserId",
  "userId",
]);

export interface DuplicateUserGroup {
  email: string;
  /** Oldest first — the first is the natural survivor. */
  users: User[];
}

/** Accounts sharing one e-mail address (the duplicate signature). */
export function duplicateUsers(users: User[]): DuplicateUserGroup[] {
  const byEmail = new Map<string, User[]>();
  for (const u of users) {
    const key = (u.email ?? "").trim().toLowerCase();
    if (!key) continue; // no e-mail → can't be confident they're the same person
    const list = byEmail.get(key);
    if (list) list.push(u);
    else byEmail.set(key, [u]);
  }
  const out: DuplicateUserGroup[] = [];
  for (const [email, list] of byEmail) {
    if (list.length < 2) continue;
    out.push({
      email,
      users: [...list].sort((a, b) => +new Date(a.createdAt) - +new Date(b.createdAt)),
    });
  }
  return out.sort((a, b) => (a.email < b.email ? -1 : 1));
}

/** Recursively rewrite any user-id reference found under a known field name. */
function repoint(node: unknown, map: Map<string, string>): void {
  if (Array.isArray(node)) {
    for (const v of node) repoint(v, map);
    return;
  }
  if (!node || typeof node !== "object") return;
  const o = node as Record<string, unknown>;
  for (const k of Object.keys(o)) {
    const v = o[k];
    if (typeof v === "string") {
      if (USER_REF_KEYS.has(k)) {
        const to = map.get(v);
        if (to) o[k] = to;
      }
    } else {
      repoint(v, map);
    }
  }
}

/** How many references point at these accounts — shown before merging. */
export function countReferences(db: DB, ids: string[]): number {
  const map = new Map(ids.map(id => [id, "__COUNT__"]));
  let n = 0;
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) { for (const v of node) walk(v); return; }
    if (!node || typeof node !== "object") return;
    const o = node as Record<string, unknown>;
    for (const k of Object.keys(o)) {
      const v = o[k];
      if (typeof v === "string") { if (USER_REF_KEYS.has(k) && map.has(v)) n++; }
      else walk(v);
    }
  };
  for (const [col, val] of Object.entries(db)) {
    if (col === "users" || col === "session" || col === "settings") continue;
    walk(val);
  }
  return n;
}

/**
 * Fold `dropIds` into `keepId`: every reference to a dropped account is
 * repointed onto the survivor, then the duplicate rows are removed. Nothing is
 * lost — history stays attributed to the same person, under one account.
 */
export function mergeUsers(keepId: string, dropIds: string[]): void {
  const drops = dropIds.filter(id => id !== keepId);
  if (!drops.length) return;
  const map = new Map(drops.map(id => [id, keepId]));
  updateDb(d => {
    for (const col of Object.keys(d) as (keyof DB)[]) {
      if (col === "users" || col === "session" || col === "settings") continue;
      repoint(d[col], map);
    }
    // Keep the survivor; drop the rest.
    d.users = d.users.filter(u => !map.has(u.id));
  });
}
