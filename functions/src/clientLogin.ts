import { HttpsError, onCall } from "firebase-functions/v2/https";
import { getAuth } from "firebase-admin/auth";
import { app, db } from "./lib/firestoreAdmin";
import { OWNER_EMAILS } from "./summaries";

/**
 * Change a CLIENT's sign-in email and/or password (Edit client → Login).
 *
 * A browser can't change another person's login — only the server can, with
 * the Admin SDK. So this one narrow door:
 *   • the caller must be an owner or an active admin (the role index the app keeps);
 *   • the login changed must be a client's — never a staff member's or an owner's;
 *   • a new password signs the client out everywhere, so it takes effect at once.
 * The app updates the client's own record (their email) itself, after this succeeds.
 */
const EMAIL_RE = /^[^\s@<>()",;:]+@[^\s@<>()",;:]+\.[^\s@<>()",;:]{2,}$/;

interface Req { authUid?: unknown; email?: unknown; password?: unknown }

export const setClientLogin = onCall<Req>(
  { region: "us-central1", memory: "256MiB", maxInstances: 5, timeoutSeconds: 30 },
  async req => {
    const uid = req.auth?.uid;
    if (!uid) throw new HttpsError("unauthenticated", "Sign in first.");
    const callerEmail = String(req.auth?.token?.email ?? "").toLowerCase();
    let admin = OWNER_EMAILS.diamondflow.includes(callerEmail);
    if (!admin) {
      const idx = (await db.collection("userByAuth").doc(uid).get()).data() as { role?: string; status?: string } | undefined;
      admin = idx?.role === "admin" && idx?.status === "active";
    }
    if (!admin) throw new HttpsError("permission-denied", "Only an admin can change a client's login.");

    const target = typeof req.data?.authUid === "string" ? req.data.authUid.trim() : "";
    const email = typeof req.data?.email === "string" ? req.data.email.trim().toLowerCase() : "";
    const password = typeof req.data?.password === "string" ? req.data.password : "";
    if (!target) throw new HttpsError("invalid-argument", "Which login is missing.");
    if (!email && !password) throw new HttpsError("invalid-argument", "Nothing to change.");
    if (email && !EMAIL_RE.test(email)) throw new HttpsError("invalid-argument", "That email address doesn't look right.");
    if (password && password.length < 6) throw new HttpsError("invalid-argument", "The password needs at least 6 characters.");

    // Only a client's login — the role index says whose it is.
    const who = (await db.collection("userByAuth").doc(target).get()).data() as { role?: string } | undefined;
    if (who?.role !== "client") throw new HttpsError("permission-denied", "Only a client's login can be changed here.");

    const auth = getAuth(app);
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
