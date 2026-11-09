import { onDocumentWritten } from "firebase-functions/v2/firestore";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { getAuth } from "firebase-admin/auth";
import { app, db } from "./lib/firestoreAdmin";
import { OWNER_EMAILS } from "./summaries";
import { REGION } from "./region";

/**
 * Who someone is, on their sign-in token — for the FILE rules (storage.rules).
 *
 * Storage rules can only read the "(default)" database, and this app keeps
 * everything in the named "diamondflow" one — so they cannot look up whether
 * a signed-in account is an admin, an employee or a client. What they CAN read
 * is the sign-in token. So each person's role and whether they are active —
 * as their sign-in record (userByAuth/{uid}, kept by the app, written only as
 * the database rules allow) says — are copied onto their token, under "sl":
 *
 *   { r: "admin" | "employee" | "client", st: "active" | "off", docs?: true }
 *
 * Kept up to date by itself: whenever a sign-in record is written (a login
 * given, a role changed, someone deactivated or removed). The app asks for
 * its own once if its token has none yet, and an admin's session stamps the
 * whole team once (syncFileClaims {all: true}). A token picks a change up
 * when it is next refreshed — the app refreshes it before every upload.
 *
 * Only "sl" is ever written; any other claim on an account is left as it is.
 */
export interface FileClaims { r: string; st: "active" | "off"; docs?: true }

/** The claims a sign-in record gives — none for no record. */
export function claimsOf(idx: { role?: unknown; status?: unknown; docs?: unknown } | null | undefined): FileClaims | null {
  if (!idx || typeof idx.role !== "string" || !["admin", "employee", "client"].includes(idx.role)) return null;
  const c: FileClaims = { r: idx.role, st: idx.status === "active" ? "active" : "off" };
  if (idx.role === "employee" && idx.docs === true) c.docs = true;
  return c;
}

/** Put the record's claims on the account. "same" when nothing changes, "gone" when there is no account. */
export async function stampClaims(uid: string, idx: Record<string, unknown> | null): Promise<"set" | "same" | "gone"> {
  const auth = getAuth(app);
  let user;
  try { user = await auth.getUser(uid); } catch { return "gone"; }
  const current: Record<string, unknown> = { ...(user.customClaims ?? {}) };
  const next = claimsOf(idx);
  if (JSON.stringify(current.sl ?? null) === JSON.stringify(next)) return "same";
  if (next) current.sl = next; else delete current.sl;
  await auth.setCustomUserClaims(uid, current);
  return "set";
}

/** A sign-in record written: its account's claims follow. */
export const fileClaimsOnIndex = onDocumentWritten(
  { region: REGION, document: "userByAuth/{uid}", database: "diamondflow", maxInstances: 5, timeoutSeconds: 60 },
  async ev => {
    const after = ev.data?.after.exists ? (ev.data.after.data() as Record<string, unknown>) : null;
    await stampClaims(ev.params.uid, after);
  },
);

/**
 * Your own claims, now ({}), or — an owner or an active admin — the whole team's
 * ({all: true}), once, so every account has them before the file rules count on them.
 */
export const syncFileClaims = onCall<{ all?: unknown }>(
  { region: REGION, memory: "256MiB", maxInstances: 5, timeoutSeconds: 300 },
  async req => {
    const uid = req.auth?.uid;
    if (!uid) throw new HttpsError("unauthenticated", "Sign in first.");
    const mine = (await db.collection("userByAuth").doc(uid).get()).data() as Record<string, unknown> | undefined;
    if (req.data?.all !== true) return { result: await stampClaims(uid, mine ?? null) };
    const email = String(req.auth?.token?.email ?? "").toLowerCase();
    const admin = OWNER_EMAILS.diamondflow.includes(email) || (mine?.role === "admin" && mine?.status === "active");
    if (!admin) throw new HttpsError("permission-denied", "Only an admin can do this for the whole team.");
    const snap = await db.collection("userByAuth").get();
    const out = { total: snap.size, set: 0, same: 0, gone: 0 };
    for (const d of snap.docs) out[await stampClaims(d.id, d.data())]++;
    return out;
  },
);
