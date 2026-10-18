import { HttpsError, onCall } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import { FieldValue } from "firebase-admin/firestore";
import { createTransport } from "nodemailer";
import { db } from "./lib/firestoreAdmin";
import { OWNER_EMAILS } from "./summaries";

/**
 * The app's transactional email (src/lib/email.ts), sent from Shree Suktam
 * Diamond's own Google Workspace mailbox over Gmail SMTP — no other company's
 * mail service is involved.
 *
 * The mailbox's app password is a secret, never in the code:
 *   firebase functions:secrets:set SMTP_PASSWORD
 *
 * Who may send what:
 *   • staff (owners, active admins and employees) — any one address (their clients);
 *   • clients — only the company inbox (the "new order" and "client signed in" alerts).
 * so a signed-in account cannot use the mailbox to write to strangers.
 */
const SMTP_PASSWORD = defineSecret("SMTP_PASSWORD");
const SMTP_USER = "harshil@ssdiam.in";
const FROM = `"Shree Suktam Diamond" <${SMTP_USER}>`;
/** Keep in sync with MARKETING_EMAIL in src/lib/email.ts. */
const COMPANY_INBOX = "online@ssdiam.in";

const MAX_HTML = 200_000;
const MAX_SUBJECT = 300;
const DAILY_CAP = { staff: 400, client: 30 } as const;
const EMAIL_RE = /^[^\s@<>()",;:]+@[^\s@<>()",;:]+\.[^\s@<>()",;:]{2,}$/;

interface MailRequest { to?: unknown; subject?: unknown; html?: unknown; onceKey?: unknown }

export const sendMail = onCall<MailRequest>(
  { region: "asia-south1", secrets: [SMTP_PASSWORD], memory: "256MiB", maxInstances: 5, timeoutSeconds: 60 },
  async req => {
    const uid = req.auth?.uid;
    if (!uid) throw new HttpsError("unauthenticated", "Sign in first.");

    const to = typeof req.data?.to === "string" ? req.data.to.trim() : "";
    const subject = typeof req.data?.subject === "string" ? req.data.subject.trim() : "";
    const html = typeof req.data?.html === "string" ? req.data.html : "";
    if (!EMAIL_RE.test(to)) throw new HttpsError("invalid-argument", "One valid email address is needed.");
    if (!subject || subject.length > MAX_SUBJECT) throw new HttpsError("invalid-argument", "The subject is missing or too long.");
    if (!html || html.length > MAX_HTML) throw new HttpsError("invalid-argument", "The message is missing or too long.");

    // Who is asking: an owner by email, otherwise the role index the app keeps.
    const email = String(req.auth?.token?.email ?? "").toLowerCase();
    let kind: "staff" | "client";
    if (OWNER_EMAILS.diamondflow.includes(email)) {
      kind = "staff";
    } else {
      const idx = (await db.collection("userByAuth").doc(uid).get()).data() as { role?: string; status?: string } | undefined;
      if (!idx || idx.status !== "active") throw new HttpsError("permission-denied", "No access.");
      kind = idx.role === "admin" || idx.role === "employee" ? "staff" : "client";
    }
    if (kind === "client" && to.toLowerCase() !== COMPANY_INBOX) {
      throw new HttpsError("permission-denied", "Not allowed to send to that address.");
    }

    // A "once a day" email (the client-active alert) goes out once per login per
    // day — whichever of their devices asks first; the rest are skipped.
    const onceKey = typeof req.data?.onceKey === "string" && /^[a-z0-9-]{1,40}$/.test(req.data.onceKey) ? req.data.onceKey : null;
    const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
    const onceRef = onceKey ? db.collection("mailOnce").doc(`${uid}_${today}_${onceKey}`) : null;
    if (onceRef && (await onceRef.get()).exists) return { ok: true, skipped: true };

    // A daily cap per account, so a runaway screen or a misused login can't flood the mailbox.
    const day = new Date().toISOString().slice(0, 10);
    const usage = db.collection("mailUsage").doc(`${uid}_${day}`);
    await db.runTransaction(async t => {
      const n = ((await t.get(usage)).data()?.count as number | undefined) ?? 0;
      if (n >= DAILY_CAP[kind]) throw new HttpsError("resource-exhausted", "Today's email limit is reached.");
      t.set(usage, { uid, day, count: FieldValue.increment(1) }, { merge: true });
    });

    const transport = createTransport({
      host: "smtp.gmail.com",
      port: 465,
      secure: true,
      auth: { user: SMTP_USER, pass: SMTP_PASSWORD.value().replace(/\s+/g, "") },
    });
    try {
      await transport.sendMail({ from: FROM, to, subject, html });
      if (onceRef) await onceRef.set({ uid, day: today, key: onceKey, at: FieldValue.serverTimestamp() });
      return { ok: true };
    } catch (err) {
      console.error("[sendMail] SMTP send failed:", err);
      throw new HttpsError("internal", "The email could not be sent.");
    }
  },
);
