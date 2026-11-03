// The campaigns' records and who may touch them.
//
//   campaigns/{id}                 the campaign: details, design, audience, status, counts
//   campaigns/{id}/recipients/{k}  one per address (k = a hash of it): its own status —
//                                  queued → sending → sent | failed | skipped | unsure
//   campaignVersions/{id}          earlier designs of a campaign, to go back to
//   campaignSuppress/{hash}        addresses that unsubscribed (or bounced): never sent to again
//   campaignSettings/main          the footer, reply-to, logo and the daily budget (admins)
//   campaignState/*                the server's own: today's count, the sending lock, the link key
import { createHash, createHmac, randomBytes, timingSafeEqual } from "crypto";
import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/v2/https";
import { APP_URL, BRAND, DEFAULT_DAILY_BUDGET, MAX_DAILY_BUDGET, OWNER_EMAILS } from "./region";

// Local tests write to an outbox instead of sending: never against the live database.
if (process.env.FUNCTIONS_EMULATOR === "true" && !process.env.FIRESTORE_EMULATOR_HOST) {
  throw new Error("functions-campaigns: run the Firestore emulator too — local runs must never reach the live database");
}
export const app = initializeApp();
export const db = getFirestore(app, "diamondflow");
// A field left empty is simply not written (never an error mid-way through a start or a send).
db.settings({ ignoreUndefinedProperties: true });
export const DATABASE = "diamondflow";

export const CAMPAIGNS = "campaigns";
export const VERSIONS = "campaignVersions";
export const SUPPRESS = "campaignSuppress";
export const SETTINGS = "campaignSettings";
export const STATE = "campaignState";

export type CampaignStatus = "draft" | "scheduled" | "sending" | "paused" | "done" | "cancelled";
export type RecipientStatus = "queued" | "sending" | "sent" | "failed" | "skipped" | "unsure";

export interface Audience {
  /** Every active client with an email, at the moment it starts. */
  allClients?: boolean;
  clientIds?: string[];
  /** Every active employee (and admin) with an email. */
  allEmployees?: boolean;
  userIds?: string[];
}

export interface CampaignDoc {
  id: string;
  name: string;
  subject: string;
  preheader?: string;
  design: unknown;
  audience: Audience;
  status: CampaignStatus;
  /** A hash of what a test showed (subject, preview line, design): starting needs a test of exactly this. */
  testedHash?: string;
  lastTestAt?: string;
  scheduleAt?: string;
  /** Frozen at Start — what every email of it is drawn from. */
  frozen?: { subject: string; preheader: string; design: unknown; settings: CampaignSettings };
  counts?: { total: number; queued: number; sent: number; failed: number; skipped: number; unsure: number };
  pauseReason?: string;
  resumeAt?: string;
  createdAt: string;
  createdBy: string;
  updatedAt?: string;
  startedAt?: string;
  startedBy?: string;
  finishedAt?: string;
}

export interface CampaignSettings {
  fromName: string;
  replyTo?: string;
  address?: string;
  contact?: string;
  logoUrl?: string;
  logoWidth?: number;
  dailyBudget: number;
}

export const now = () => new Date().toISOString();
/** The day in India — the budget's day starts at midnight IST. */
export const istDay = (d = new Date()) => new Date(d.getTime() + 5.5 * 3600_000).toISOString().slice(0, 10);
export const emailKey = (email: string) => createHash("sha256").update(email.trim().toLowerCase()).digest("hex").slice(0, 32);
export const EMAIL_RE = /^[^\s@<>()",;:]+@[^\s@<>()",;:]+\.[a-z]{2,}$/i;
export const cleanEmail = (v: unknown) => (typeof v === "string" ? v.trim().toLowerCase() : "");

export async function requireAdmin(auth: { uid: string; token: { email?: string } } | undefined): Promise<{ uid: string; email: string }> {
  if (!auth?.uid) throw new HttpsError("unauthenticated", "Sign in first.");
  const email = String(auth.token?.email ?? "").toLowerCase();
  if (OWNER_EMAILS.includes(email)) return { uid: auth.uid, email };
  const idx = (await db.collection("userByAuth").doc(auth.uid).get()).data() as { role?: string; status?: string } | undefined;
  if (idx?.role === "admin" && idx?.status === "active") return { uid: auth.uid, email };
  throw new HttpsError("permission-denied", "Only an admin can manage campaigns.");
}

export async function getSettings(): Promise<CampaignSettings> {
  const s = ((await db.collection(SETTINGS).doc("main").get()).data() ?? {}) as Partial<CampaignSettings>;
  const budget = Math.round(Number(s.dailyBudget));
  return {
    fromName: String(s.fromName ?? "").trim().slice(0, 60) || BRAND.name,
    replyTo: EMAIL_RE.test(cleanEmail(s.replyTo)) ? cleanEmail(s.replyTo) : undefined,
    address: String(s.address ?? "").trim().slice(0, 300) || undefined,
    contact: String(s.contact ?? "").trim().slice(0, 200) || undefined,
    logoUrl: /^https:\/\/\S+$/.test(String(s.logoUrl ?? "")) ? String(s.logoUrl) : `${APP_URL}${BRAND.logo}`,
    logoWidth: Number(s.logoWidth) >= 60 && Number(s.logoWidth) <= 300 ? Math.round(Number(s.logoWidth)) : 170,
    dailyBudget: Number.isFinite(budget) && budget >= 1 ? Math.min(MAX_DAILY_BUDGET, budget) : DEFAULT_DAILY_BUDGET,
  };
}

/* ─────────────── The unsubscribe link ─────────────── */

/** The key the links are signed with — made once, kept where no device can read it. */
let keyCache: Buffer | null = null;
async function linkKey(): Promise<Buffer> {
  if (keyCache) return keyCache;
  const ref = db.collection(STATE).doc("linkKey");
  const k = await db.runTransaction(async tx => {
    const cur = (await tx.get(ref)).data()?.key as string | undefined;
    if (cur) return cur;
    const fresh = randomBytes(32).toString("base64");
    tx.set(ref, { key: fresh, at: now() });
    return fresh;
  });
  keyCache = Buffer.from(k, "base64");
  return keyCache;
}
const b64u = (b: Buffer) => b.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64u = (s: string) => Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64");

/** "<campaign>.<address, encoded>.<signature>" — only this server can make one. */
export async function unsubToken(campaignId: string, email: string): Promise<string> {
  const body = `${campaignId}.${b64u(Buffer.from(email.toLowerCase(), "utf8"))}`;
  const sig = b64u(createHmac("sha256", await linkKey()).update(body).digest()).slice(0, 32);
  return `${body}.${sig}`;
}
export async function readUnsubToken(t: string): Promise<{ campaignId: string; email: string } | null> {
  const m = /^([\w-]{1,60})\.([\w-]{4,400})\.([\w-]{32})$/.exec(String(t ?? ""));
  if (!m) return null;
  const want = Buffer.from(b64u(createHmac("sha256", await linkKey()).update(`${m[1]}.${m[2]}`).digest()).slice(0, 32));
  const got = Buffer.from(m[3]);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
  const email = unb64u(m[2]).toString("utf8");
  return EMAIL_RE.test(email) ? { campaignId: m[1], email } : null;
}

/** Off every list: never sent to again (written once; a second unsubscribe changes nothing). */
export async function suppress(email: string, reason: "unsubscribed" | "bounced" | "added", campaignId?: string, by?: string): Promise<void> {
  const ref = db.collection(SUPPRESS).doc(emailKey(email));
  await db.runTransaction(async tx => {
    if ((await tx.get(ref)).exists) return;
    tx.create(ref, { email: email.toLowerCase(), reason, at: now(), ...(campaignId ? { campaignId } : {}), ...(by ? { by } : {}) });
  });
}
export async function isSuppressed(email: string): Promise<boolean> {
  return (await db.collection(SUPPRESS).doc(emailKey(email)).get()).exists;
}
