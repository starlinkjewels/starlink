/**
 * Software health — what the app reports, and what an admin does about it.
 *
 * reportHealth: the app tells the server what it saw (wrong passwords on the
 * sign-in screen, a save the security rules refused, a screen that crashed, an
 * admin signing in on a device not seen before). Open to anyone — a wrong
 * password has no sign-in — so every report is checked, cut short, limited per
 * address, and only counted: an event is raised when a count crosses its line.
 *
 * healthAction: an admin's buttons in Settings → Software health — send a test
 * alert, switch an account off or (an owner) back on, mark an event handled.
 */
import { HttpsError, onCall, type CallableRequest } from "firebase-functions/v2/https";
import { FieldValue } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";
import { app, db } from "../lib/firestoreAdmin";
import { OWNER_EMAILS } from "../summaries";
import { SMTP_PASSWORD } from "../mail";
import { REGION } from "../region";
import { raise, bump, whoIs, h, alertPartners, EVENTS, STATE } from "./core";

const cut = (v: unknown, n: number) => String(v ?? "").replace(/[\u0000-\u001f]+/g, " ").trim().slice(0, n);
const ipOf = (req: CallableRequest) => cut(req.rawRequest?.headers?.["x-forwarded-for"] ?? req.rawRequest?.ip, 64).split(",")[0].trim();
const uaOf = (req: CallableRequest) => cut(req.rawRequest?.headers?.["user-agent"], 200);
/** A device, roughly: the browser and system without their version numbers. */
const deviceOf = (ua: string) => ua.replace(/[\d._]+/g, "").replace(/\s+/g, " ").trim().slice(0, 120);

async function adminCaller(req: CallableRequest): Promise<{ uid: string; owner: boolean; name?: string }> {
  const uid = req.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Sign in first.");
  const email = String(req.auth?.token?.email ?? "").toLowerCase();
  const owner = OWNER_EMAILS.diamondflow.includes(email);
  const idx = (await db.collection("userByAuth").doc(uid).get()).data() as { role?: string; status?: string } | undefined;
  if (!owner && !(idx?.role === "admin" && idx?.status === "active")) throw new HttpsError("permission-denied", "Only an admin can do this.");
  const who = await whoIs(uid);
  return { uid, owner, name: who?.name ?? email };
}

export const reportHealth = onCall<{ kind?: unknown; email?: unknown; what?: unknown; message?: unknown; page?: unknown }>(
  { region: REGION, secrets: [SMTP_PASSWORD], memory: "256MiB", maxInstances: 10, timeoutSeconds: 30 },
  async req => {
    const ip = ipOf(req), ua = uaOf(req);
    // At most 60 reports from one address in 10 minutes — the rest are dropped quietly.
    if ((await bump(`rl_${h(ip || "none")}`, 10)).n > 60) return { ok: true };
    const kind = cut(req.data?.kind, 20);
    const uid = req.auth?.uid;

    if (kind === "failedLogin") {
      const email = cut(req.data?.email, 120).toLowerCase();
      if (!email) return { ok: true };
      const byEmail = await bump(`fl_${h(email)}`, 15);
      const byIp = await bump(`flip_${h(ip || "none")}`, 15, 1, { member: h(email) });
      if (byEmail.n >= 5) {
        const ours = !(await db.collection("users").where("email", "==", email).limit(1).get()).empty;
        await raise({ kind: "failedLogins", severity: "critical", title: `Wrong passwords for ${email}`, detail: `${byEmail.n} wrong passwords for ${email}${ours ? " (one of your logins)" : ""} in 15 minutes — someone may be guessing it. If it is not them, change that password now.`, ip, ua }, email, 60);
      }
      if (byIp.n >= 15 || byIp.members >= 4) {
        await raise({ kind: "failedLogins", severity: "critical", title: "Many wrong passwords from one place", detail: `${byIp.n} wrong passwords for ${byIp.members} different logins from the same internet address in 15 minutes.`, ip, ua }, `ip_${ip}`, 60);
      }
      return { ok: true };
    }

    if (!uid) return { ok: true }; // everything else comes from someone signed in

    if (kind === "denied") {
      const what = cut(req.data?.what, 80);
      const c = await bump(`den_${uid}`, 10);
      if (c.n >= 3) {
        const who = await whoIs(uid);
        await raise({ kind: "blocked", severity: "warning", title: `The security rules refused ${who?.name ?? "someone"}'s changes`, detail: `${c.n} changes refused in 10 minutes (the latest: ${what || "a record"}). Usually an old version of the app (they should tap Update); if not, someone is trying to reach what their access does not allow.`, who, ip, ua }, uid, 60);
      }
      return { ok: true };
    }

    if (kind === "error") {
      const message = cut(req.data?.message, 300);
      const page = cut(req.data?.page, 80);
      if (!message) return { ok: true };
      const key = message.replace(/\d+/g, "#").slice(0, 160);
      const c = await bump(`err_${h(key)}`, 60, 1, { member: uid });
      const all = await bump("err_all", 60);
      if (c.n === 10 || c.members === 3) {
        await raise({ kind: "appError", severity: "warning", title: "A screen is failing", detail: `"${message}" — ${c.n} times for ${c.members} ${c.members === 1 ? "person" : "people"} in the last hour${page ? `, on ${page}` : ""}.` }, key, 360);
      }
      if (all.n === 50) {
        await raise({ kind: "appError", severity: "critical", title: "Many app errors in the last hour", detail: `${all.n} errors reported by the app in the last hour — something may be broken for everyone.` }, "all", 60);
      }
      return { ok: true };
    }

    if (kind === "signin") {
      // Admins and owners only: a sign-in on a device not seen before.
      const email = String(req.auth?.token?.email ?? "").toLowerCase();
      const owner = OWNER_EMAILS.diamondflow.includes(email);
      const idx = (await db.collection("userByAuth").doc(uid).get()).data() as { role?: string } | undefined;
      if (!owner && idx?.role !== "admin") return { ok: true };
      const dev = deviceOf(ua);
      if (!dev) return { ok: true };
      const ref = db.collection("healthDevices").doc(uid);
      const known = ((await ref.get()).data()?.devices ?? []) as { k: string }[];
      const k = h(dev);
      if (known.some(d => d.k === k)) {
        return { ok: true };
      }
      await ref.set({ devices: FieldValue.arrayUnion({ k, ua: ua.slice(0, 160), ip, firstAt: new Date().toISOString() }) }, { merge: true });
      // The first device ever seen for them is where they start, not news.
      if (known.length) {
        const who = await whoIs(uid);
        await raise({ kind: "newDevice", severity: "critical", title: `${who?.name ?? email} signed in on a new device`, detail: `${who?.name ?? email}${owner ? " (owner)" : " (admin)"} signed in on a device not seen before: ${ua.slice(0, 140)}. If this was not them, change their password at once.`, who, ip, ua }, `${uid}_${k}`, 525_600);
      }
      return { ok: true };
    }
    return { ok: true };
  },
);

export const healthAction = onCall<{ op?: unknown; uid?: unknown; eventId?: unknown; note?: unknown }>(
  { region: REGION, secrets: [SMTP_PASSWORD], memory: "256MiB", maxInstances: 3, timeoutSeconds: 60 },
  async req => {
    const me = await adminCaller(req);
    const op = cut(req.data?.op, 20);

    if (op === "test") {
      const r = await alertPartners({ kind: "test", severity: "critical", title: "Test alert", detail: `${me.name} sent a test from Settings → Software health. If you got this in the app and by email, alerts reach you.` });
      await db.collection(EVENTS).doc(`test_${Date.now()}`).set({ id: `test_${Date.now()}`, at: new Date().toISOString(), kind: "test", severity: "info", title: "Test alert sent", detail: `By ${me.name} — ${r.alerts} in-app alert${r.alerts === 1 ? "" : "s"}, ${r.emails} email${r.emails === 1 ? "" : "s"}.`, count: 1 });
      return r;
    }

    if (op === "handled") {
      const id = cut(req.data?.eventId, 120);
      if (!id) throw new HttpsError("invalid-argument", "Which event?");
      await db.collection(EVENTS).doc(id).update({ handled: { at: new Date().toISOString(), by: me.name, ...(cut(req.data?.note, 300) ? { note: cut(req.data?.note, 300) } : {}) } });
      return { ok: true };
    }

    if (op === "disable" || op === "enable") {
      const uid = cut(req.data?.uid, 128);
      if (!uid) throw new HttpsError("invalid-argument", "Which account?");
      const user = await getAuth(app).getUser(uid).catch(() => null);
      if (!user) throw new HttpsError("not-found", "That account is not there.");
      if (OWNER_EMAILS.diamondflow.includes((user.email ?? "").toLowerCase())) throw new HttpsError("permission-denied", "An owner's account can't be changed here.");
      const idx = (await db.collection("userByAuth").doc(uid).get()).exists;
      if (idx) throw new HttpsError("failed-precondition", "This account is one of your team or clients — change it from Employees or Clients.");
      if (op === "enable" && !me.owner) throw new HttpsError("permission-denied", "Only an owner can switch an unknown account back on.");
      await getAuth(app).updateUser(uid, { disabled: op === "disable" });
      if (op === "disable") await getAuth(app).revokeRefreshTokens(uid);
      // Switched back on by an owner: the watch leaves it alone from now on.
      await db.collection(STATE).doc("main").set({ allowed: op === "enable" ? FieldValue.arrayUnion(uid) : FieldValue.arrayRemove(uid) }, { merge: true });
      return { ok: true };
    }
    throw new HttpsError("invalid-argument", "Unknown action.");
  },
);
