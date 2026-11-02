import { pbkdf2Sync, timingSafeEqual } from "crypto";

/**
 * The decision behind a Documents password link (docShare.ts), kept apart
 * from Firestore so it can be tested on its own: given the link's record as
 * stored, the password typed and the time now, open it or say why not — and
 * what to write back (opens counted, wrong tries counted, the lock).
 *
 * The password itself is never stored: the browser that made the link saved a
 * PBKDF2-SHA256 hash of it (src/lib/documentsModel.ts, hashSharePassword), and
 * the same sum is worked out here from what the visitor typed.
 */

/** Wrong passwords in a row before the link is locked… */
export const MAX_TRIES = 5;
/** …and for how long. */
export const LOCK_MINUTES = 15;

/** A link's record as read from docShares (anything could be in it — checked here). */
export interface StoredShare {
  active?: unknown;
  expiresAt?: unknown;
  hash?: unknown;
  salt?: unknown;
  iterations?: unknown;
  failed?: unknown;
  lockedUntil?: unknown;
  opens?: unknown;
}

/** What to write back to the link's record. `lockedUntil: null` = remove it. */
export interface ShareUpdate {
  failed: number;
  opens?: number;
  lastOpenedAt?: string;
  lockedUntil?: string | null;
}

export type OpenDecision =
  /** Right password: counted as opened. */
  | { result: "open"; update: ShareUpdate }
  /** Wrong password: counted; `locked` when this one used up the last try. */
  | { result: "wrong"; triesLeft: number; locked: boolean; update: ShareUpdate }
  /** Locked after too many wrong tries — `minutes` until it opens again. Nothing written. */
  | { result: "locked"; minutes: number }
  /** Past its end date. Nothing written. */
  | { result: "expired" }
  /** No such link, turned off, its document gone, or its record unreadable. Nothing written. */
  | { result: "unavailable" };

const HEX = /^[0-9a-f]+$/i;

/** A whole count, 0 or more; anything else counts as 0. */
const count = (v: unknown): number => (typeof v === "number" && Number.isInteger(v) && v > 0 ? v : 0);

/** A time as milliseconds, or NaN. */
const ms = (v: unknown): number => (typeof v === "string" && v ? Date.parse(v) : NaN);

/**
 * Decide one try at opening a link.
 * @param share  the link's record, or undefined when there is none
 * @param password  exactly what the visitor typed
 * @param now  the server's time
 * @param targetAvailable  false when the shared document/folder is gone or in the Trash
 */
export function decideOpen(share: StoredShare | undefined, password: string, now: Date, targetAvailable = true): OpenDecision {
  if (!share || share.active !== true || !targetAvailable) return { result: "unavailable" };

  // An end date that can't be read is taken as passed — never open by mistake.
  if (share.expiresAt != null) {
    const end = ms(share.expiresAt);
    if (!(end >= now.getTime())) return { result: "expired" };
  }

  const lockedTill = ms(share.lockedUntil);
  if (lockedTill > now.getTime()) {
    return { result: "locked", minutes: Math.max(1, Math.ceil((lockedTill - now.getTime()) / 60_000)) };
  }

  // The stored sum must look like the one the browser makes; a bad record
  // (or an absurd round count, which would tie the server up) opens nothing.
  const { hash, salt, iterations } = share;
  if (typeof hash !== "string" || hash.length !== 64 || !HEX.test(hash)) return { result: "unavailable" };
  if (typeof salt !== "string" || salt.length < 16 || salt.length > 128 || salt.length % 2 !== 0 || !HEX.test(salt)) return { result: "unavailable" };
  if (typeof iterations !== "number" || !Number.isInteger(iterations) || iterations < 1_000 || iterations > 2_000_000) return { result: "unavailable" };

  if (passwordMatches(password, hash, salt, iterations)) {
    const update: ShareUpdate = { failed: 0, opens: count(share.opens) + 1, lastOpenedAt: now.toISOString() };
    if (share.lockedUntil != null) update.lockedUntil = null; // an old lock, long over
    return { result: "open", update };
  }

  const failed = count(share.failed) + 1;
  if (failed >= MAX_TRIES) {
    return {
      result: "wrong", triesLeft: 0, locked: true,
      update: { failed: 0, lockedUntil: new Date(now.getTime() + LOCK_MINUTES * 60_000).toISOString() },
    };
  }
  return { result: "wrong", triesLeft: MAX_TRIES - failed, locked: false, update: { failed } };
}

/** The same sum the browser made (PBKDF2-SHA256, 32 bytes), compared in constant time. */
export function passwordMatches(password: string, hash: string, salt: string, iterations: number): boolean {
  const got = pbkdf2Sync(password, Buffer.from(salt, "hex"), iterations, 32, "sha256");
  const want = Buffer.from(hash, "hex");
  return want.length === got.length && timingSafeEqual(got, want);
}

const minutes = (n: number) => `${n} minute${n === 1 ? "" : "s"}`;

/** The error a visitor is shown for a decision that doesn't open the link (code = the HttpsError code). */
export function refusalOf(d: OpenDecision): { code: "not-found" | "failed-precondition" | "resource-exhausted" | "permission-denied"; message: string } | null {
  switch (d.result) {
    case "open": return null;
    case "unavailable": return { code: "not-found", message: "This link is not available" };
    case "expired": return { code: "failed-precondition", message: "This link has expired" };
    case "locked": return { code: "resource-exhausted", message: `Too many tries — try again in ${minutes(d.minutes)}` };
    case "wrong":
      return {
        code: "permission-denied",
        message: d.locked
          ? `Wrong password. Too many tries — try again in ${minutes(LOCK_MINUTES)}`
          : `Wrong password — ${d.triesLeft} ${d.triesLeft === 1 ? "try" : "tries"} left`,
      };
  }
}
