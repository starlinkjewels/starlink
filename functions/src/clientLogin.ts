import { HttpsError, onCall } from "firebase-functions/v2/https";
import { getAuth } from "firebase-admin/auth";
import { app, db } from "./lib/firestoreAdmin";
import { OWNER_EMAILS } from "./summaries";

/**
 * Change a CLIENT's or an EMPLOYEE's sign-in email and/or password
 * (Edit client → Login; Employees → Edit details → Login) — or an ADMIN's
 * (a partner's), when the main owner login asks.
 *
 * A browser can't change another person's login — only the server can, with
 * the Admin SDK. So this one narrow door:
 *   • the caller must be an owner or an active admin (the role index the app keeps);
 *   • the login changed must be a client's or an employee's; an admin's only
 *     when the caller is an owner (recognised by email); never an owner's, and
 *     never to an owner's email (that would make them one);
 *   • a new password signs them out everywhere, so it takes effect at once.
 * The app updates the person's own record (their email) itself, after this succeeds.
 */
const EMAIL_RE = /^[^\s@<>()",;:]+@[^\s@<>()",;:]+\.[^\s@<>()",;:]{2,}$/;

interface Req { authUid?: unknown; email?: unknown; password?: unknown }

export const setClientLogin = onCall<Req>(
  { region: "us-central1", memory: "256MiB", maxInstances: 5, timeoutSeconds: 30 },
  async req => {
    const uid = req.auth?.uid;
    if (!uid) throw new HttpsError("unauthenticated", "Sign in first.");
    const callerEmail = String(req.auth?.token?.email ?? "").toLowerCase();
    const owner = OWNER_EMAILS.diamondflow.includes(callerEmail);
    let admin = owner;
    if (!admin) {
      const idx = (await db.collection("userByAuth").doc(uid).get()).data() as { role?: string; status?: string } | undefined;
      admin = idx?.role === "admin" && idx?.status === "active";
    }
    if (!admin) throw new HttpsError("permission-denied", "Only an admin can change someone's login.");

    const target = typeof req.data?.authUid === "string" ? req.data.authUid.trim() : "";
    const email = typeof req.data?.email === "string" ? req.data.email.trim().toLowerCase() : "";
    const password = typeof req.data?.password === "string" ? req.data.password : "";
    if (!target) throw new HttpsError("invalid-argument", "Which login is missing.");
    if (!email && !password) throw new HttpsError("invalid-argument", "Nothing to change.");
    if (email && !EMAIL_RE.test(email)) throw new HttpsError("invalid-argument", "That email address doesn't look right.");
    if (password && password.length < 6) throw new HttpsError("invalid-argument", "The password needs at least 6 characters.");

    // A client's or an employee's login — or an admin's, for an owner. The role index says whose it is.
    const who = (await db.collection("userByAuth").doc(target).get()).data() as { role?: string } | undefined;
    if (who?.role === "admin") {
      if (!owner) throw new HttpsError("permission-denied", "Only the main owner login can change an admin's login.");
      if (target === uid) throw new HttpsError("permission-denied", "Change your own password in My Profile.");
    } else if (who?.role !== "client" && who?.role !== "employee") {
      throw new HttpsError("permission-denied", "Only a client's, an employee's or (for the owner) an admin's login can be changed here.");
    }
    // An owner is recognised by email: giving anyone an owner's address would make them one.
    if (email && OWNER_EMAILS.diamondflow.includes(email)) throw new HttpsError("permission-denied", "That email belongs to an owner.");

    const auth = getAuth(app);
    // Never an owner's own account, whatever its role index says.
    const current = await auth.getUser(target).catch(() => null);
    if (current?.email && OWNER_EMAILS.diamondflow.includes(current.email.toLowerCase())) throw new HttpsError("permission-denied", "An owner's login can't be changed here.");
    try {
      await auth.updateUser(target, { ...(email ? { email } : {}), ...(password ? { password } : {}) });
      if (password) await auth.revokeRefreshTokens(target);
    } catch (e) {
      const code = (e as { code?: string }).code ?? "";
      if (code === "auth/email-already-exists") throw new HttpsError("already-exists", "That email is already used by another login.");
      if (code === "auth/user-not-found") throw new HttpsError("not-found", "That login no longer exists.");
      throw new HttpsError("internal", "The login couldn't be changed — try again.");
    }
    return { ok: true };
  },
);
