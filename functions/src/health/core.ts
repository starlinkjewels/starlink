/**
 * Software health — the shared part: an event raised, the partners alerted.
 *
 * Everything the watchers find is one record in `securityEvents` (read by
 * admins in Settings → Software health; written only here, by the server).
 * The same thing found again within its window is counted on that record, not
 * raised again — so an attack is one alert, not a thousand.
 *
 *  • critical — every partner at once: an alert in the app (and so a push to
 *    their phone) and an email to each.
 *  • warning / info — in the morning summary (health/watchers.ts healthDigest).
 *
 * Partners: every active admin, and the owners by email.
 */
import { createHash, randomBytes } from "node:crypto";
import { FieldValue } from "firebase-admin/firestore";
import { db } from "../lib/firestoreAdmin";
import { OWNER_EMAILS } from "../summaries";
import { deliverMail, closeMail } from "../mail";
import { emailHtml, esc } from "../pipelines/email";
import { BRAND, APP_URL } from "../pipelines/config";

export type Severity = "critical" | "warning" | "info";
export type EventKind =
  | "unknownAccount" | "unknownSignin" | "massDelete" | "bulkChange" | "madeAdmin" | "accessChange" | "yearReopened"
  | "failedLogins" | "blocked" | "newDevice" | "appError" | "jobError" | "backupLate" | "test";

export interface HealthEvent {
  id: string;
  at: string;
  lastAt?: string;
  kind: EventKind;
  severity: Severity;
  title: string;
  detail: string;
  /** Who did it, when known. */
  who?: { uid?: string; appId?: string; name?: string; email?: string };
  ip?: string;
  ua?: string;
  /** Times it was found again within its window. */
  count: number;
  /** The account it is about (an unknown account) and whether it was switched off. */
  account?: { uid: string; email?: string; disabled?: boolean };
  notifiedAt?: string;
  handled?: { at: string; by: string; note?: string };
}

export const EVENTS = "securityEvents";
export const COUNTERS = "healthCounters";
export const STATE = "healthState";

export const h = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 16);
const nowIso = () => new Date().toISOString();
const bucket = (minutes: number, at = Date.now()) => Math.floor(at / (minutes * 60_000));

/**
 * Add to a counter for this window and say what it is now. Counters are the
 * server's own (never read or written by the app) and are small.
 */
export async function bump(name: string, windowMin: number, by = 1, extra?: { member?: string }): Promise<{ n: number; members: number }> {
  const ref = db.collection(COUNTERS).doc(`${name}_${bucket(windowMin)}`);
  const upd: Record<string, unknown> = { n: FieldValue.increment(by), at: nowIso(), expires: new Date(Date.now() + windowMin * 2 * 60_000).toISOString() };
  if (extra?.member) upd.members = FieldValue.arrayUnion(extra.member.slice(0, 64));
  await ref.set(upd, { merge: true });
  const d = (await ref.get()).data() ?? {};
  return { n: Number(d.n) || 0, members: Array.isArray(d.members) ? d.members.length : 0 };
}

/** The partners: every active admin (their app id and email), and the owners by email. */
export async function partners(): Promise<{ appIds: string[]; emails: string[] }> {
  const snap = await db.collection("users").where("role", "==", "admin").get();
  const appIds: string[] = [];
  const emails = new Set<string>(OWNER_EMAILS.diamondflow.map(e => e.toLowerCase()));
  for (const d of snap.docs) {
    const u = d.data() as { status?: string; email?: string };
    if (u.status === "inactive") continue;
    appIds.push(d.id);
    if (u.email && /@/.test(u.email)) emails.add(u.email.trim().toLowerCase());
  }
  return { appIds, emails: [...emails] };
}

const SEV_WORD: Record<Severity, string> = { critical: "Security alert", warning: "Needs a look", info: "For your information" };

function detailRows(e: Omit<HealthEvent, "id" | "at" | "count">): string {
  const rows: [string, string | undefined][] = [
    ["What", e.title],
    ["Details", e.detail],
    ["Who", e.who ? [e.who.name, e.who.email].filter(Boolean).join(" · ") || undefined : undefined],
    ["From", [e.ip, e.ua].filter(Boolean).join(" · ") || undefined],
    ["When", new Date().toLocaleString("en-GB", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" }) + " (India)"],
  ];
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:16px 0 6px;width:100%;border-collapse:collapse;font-size:14px;">${rows.filter(r => r[1]).map(([k, v]) =>
    `<tr><td style="padding:6px 12px 6px 0;color:${BRAND.muted};vertical-align:top;white-space:nowrap;">${esc(k)}</td><td style="padding:6px 0;color:#111827;">${esc(v)}</td></tr>`).join("")}</table>`;
}

/** Tell every partner now: an alert in the app (a push to their phone) and an email. */
export async function alertPartners(e: Omit<HealthEvent, "id" | "at" | "count">): Promise<{ alerts: number; emails: number }> {
  const { appIds, emails } = await partners();
  const at = nowIso();
  const batch = db.batch();
  for (const id of appIds) {
    const nid = `n_h${randomBytes(6).toString("hex")}`;
    batch.set(db.collection("notifications").doc(nid), {
      id: nid, userId: id, title: `${e.severity === "critical" ? "⚠ " : ""}${e.title}`, body: e.detail.slice(0, 300),
      type: "security", read: false, createdAt: at,
    });
  }
  if (appIds.length) await batch.commit();
  const subject = `${BRAND.name} — ${SEV_WORD[e.severity]}: ${e.title}`.slice(0, 180);
  const html = emailHtml({
    subject,
    text: `${e.detail}\n\nOpen ${APP_URL.replace(/^https?:\/\//, "")} → Settings → Software health to see it and what was done.`,
    body: detailRows(e),
  });
  let sent = 0;
  for (const to of emails) {
    try { await deliverMail(to, subject, html); sent++; } catch (err) { console.error("[health] mail to", to, "failed:", err); }
  }
  await closeMail();
  return { alerts: appIds.length, emails: sent };
}

/**
 * Raise an event — or, found again within `windowMin`, count it on the one
 * already raised. A critical one alerts the partners the first time only.
 */
export async function raise(e: Omit<HealthEvent, "id" | "at" | "count">, key: string, windowMin: number): Promise<{ id: string; fresh: boolean }> {
  const id = `${e.kind}_${h(key)}_${bucket(windowMin)}`;
  const ref = db.collection(EVENTS).doc(id);
  // No undefined anywhere, however deep (the database refuses it): a JSON round trip drops it.
  const rec = JSON.parse(JSON.stringify({ ...e, id, at: nowIso(), count: 1 })) as HealthEvent;
  try {
    await ref.create(rec);
  } catch (err) {
    if ((err as { code?: number }).code === 6) { // already there
      await ref.update({ count: FieldValue.increment(1), lastAt: nowIso() });
      return { id, fresh: false };
    }
    throw err;
  }
  if (e.severity === "critical") {
    try {
      const r = await alertPartners(e);
      await ref.update({ notifiedAt: nowIso(), notified: r });
    } catch (err) { console.error("[health] alerting failed:", err); }
  }
  return { id, fresh: true };
}

/** Who an account is in the app: its sign-in record, and its person's name and email. */
export async function whoIs(uid: string | undefined): Promise<HealthEvent["who"] | undefined> {
  if (!uid) return undefined;
  const idx = (await db.collection("userByAuth").doc(uid).get()).data() as { appId?: string; role?: string } | undefined;
  if (!idx?.appId) return { uid };
  const u = (await db.collection("users").doc(idx.appId).get()).data() as { name?: string; email?: string } | undefined;
  return { uid, appId: idx.appId, name: u?.name, email: u?.email };
}
