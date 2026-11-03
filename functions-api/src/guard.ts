// Keeping the API safe and counted: each key's limits (a minute and a day),
// a key called in a loop blocked for an hour — and paused after the third
// block in a day, until an admin turns it back on — with an alert to every
// admin; wrong keys slowed down; and every call counted for the health board
// (apiStats, by the hour) and written down for 30 days (apiCalls).
//
// Writes only to the API's own collections (apiQuota, apiStats, apiCalls,
// apiEvents, the key's own block fields on apiKeys) and the admins' alerts.
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { createHash, randomBytes } from "crypto";
import { db, patchKey, perDayOf, perMinuteOf, type ApiKey } from "./store";
import { dayOf, hourOf, mapKey, type Device } from "./logic";

export const BLOCK_MS = 60 * 60_000;
export const BLOCKS_TO_PAUSE = 3;
export const LOG_DAYS = 30;

export const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
export const requestId = () => randomBytes(6).toString("hex");

/* ─────────────── Wrong keys: slowed down, per address ─────────────── */

const BAD_WINDOW = 10 * 60_000, BAD_MAX = 30, BAD_LOCK = 15 * 60_000;
const bad = new Map<string, { n: number; since: number; lockedUntil?: number }>();

/** An address that sent too many wrong keys lately — refused for a while without reading anything. */
export function badLocked(ip: string): number | null {
  const b = bad.get(ip);
  return b?.lockedUntil && b.lockedUntil > Date.now() ? b.lockedUntil : null;
}
export function noteBadKey(ip: string): void {
  const now = Date.now();
  const b = bad.get(ip);
  const e = !b || now - b.since > BAD_WINDOW ? { n: 0, since: now } : b;
  e.n += 1;
  if (e.n >= BAD_MAX) e.lockedUntil = now + BAD_LOCK;
  bad.delete(ip); bad.set(ip, e); // newest last
  // Kept small: the oldest addresses go first (a Map keeps the order they came in).
  while (bad.size > 5000) bad.delete(bad.keys().next().value as string);
}

/* ─────────────── Limits ─────────────── */

export interface QuotaResult {
  ok: boolean;
  reason?: "minute" | "day";
  perMinute: number;
  perDay: number;
  minuteLeft: number;
  dayLeft: number;
  /** Seconds until the minute's count starts again. */
  resetIn: number;
  /** This call tipped the key into a block (called in a loop). */
  block?: boolean;
}

// What this instance alone has seen of a key this minute — a key far over its
// limit is refused here, without asking the database each time.
const local = new Map<string, { minute: number; n: number; over: number }>();
// A key whose day is used up, as this instance saw it — refused without asking again.
const dayDone = new Map<string, string>();

// A block asked for at most every 10 s per key here (blockKey itself skips a key already blocked).
const blockAsked = new Map<string, number>();
function blockDue(keyId: string): boolean {
  const t = blockAsked.get(keyId) ?? 0;
  if (Date.now() - t < 10_000) return false;
  blockAsked.set(keyId, Date.now());
  return true;
}

export interface Caller { ip: string; country: string; city: string; origin: string; device: Device }

/** Count the call against the key's minute and day — refused when either is used up. */
export async function takeQuota(key: ApiKey, who: Caller): Promise<QuotaResult> {
  const now = Date.now();
  const minute = Math.floor(now / 60_000), day = dayOf(now);
  const perMinute = perMinuteOf(key), perDay = perDayOf(key);
  const resetIn = 60 - Math.floor((now % 60_000) / 1000);
  if (dayDone.get(key.id) === day) return { ok: false, reason: "day", perMinute, perDay, minuteLeft: 0, dayLeft: 0, resetIn };
  const l = local.get(key.id);
  const mine = !l || l.minute !== minute ? { minute, n: 0, over: 0 } : l;
  mine.n += 1;
  local.set(key.id, mine);
  if (mine.n > perMinute) {
    mine.over += 1;
    return { ok: false, reason: "minute", perMinute, perDay, minuteLeft: 0, dayLeft: 0, resetIn, block: mine.over >= perMinute && blockDue(key.id) };
  }
  const ref = db.collection("apiQuota").doc(key.id);
  const r: QuotaResult = await db.runTransaction(async tx => {
    const q = (await tx.get(ref)).data() ?? {};
    const sameMinute = q.minute === minute, sameDay = q.day === day;
    const mCount = sameMinute ? Number(q.minuteCount) || 0 : 0;
    const mOver = sameMinute ? Number(q.minuteOver) || 0 : 0;
    const dCount = sameDay ? Number(q.dayCount) || 0 : 0;
    const last = { lastAt: new Date(now).toISOString(), lastIp: who.ip, lastCountry: who.country, lastCity: who.city, lastOrigin: who.origin, lastDevice: who.device.label };
    if (dCount >= perDay) {
      tx.set(ref, { keyId: key.id, minute, minuteCount: mCount, minuteOver: mOver, day, dayCount: dCount, ...last }, { merge: true });
      return { ok: false, reason: "day" as const, perMinute, perDay, minuteLeft: Math.max(0, perMinute - mCount), dayLeft: 0, resetIn };
    }
    if (mCount >= perMinute) {
      tx.set(ref, { keyId: key.id, minute, minuteCount: mCount, minuteOver: mOver + 1, day, dayCount: dCount, ...last }, { merge: true });
      return { ok: false, reason: "minute" as const, perMinute, perDay, minuteLeft: 0, dayLeft: Math.max(0, perDay - dCount), resetIn, block: mOver + 1 >= perMinute };
    }
    tx.set(ref, { keyId: key.id, minute, minuteCount: mCount + 1, minuteOver: mOver, day, dayCount: dCount + 1, total: FieldValue.increment(1), ...last }, { merge: true });
    return { ok: true, perMinute, perDay, minuteLeft: perMinute - mCount - 1, dayLeft: perDay - dCount - 1, resetIn };
  });
  // Outside the transaction, which may run more than once.
  if (r.block) r.block = blockDue(key.id);
  if (r.reason === "day" || (r.ok && r.dayLeft <= 0)) dayDone.set(key.id, day);
  return r;
}

/* ─────────────── Blocking ─────────────── */

/**
 * The key was called in a loop: blocked for an hour — on the third block in a
 * day, paused until an admin turns it back on. Each admin gets an alert.
 */
export async function blockKey(key: ApiKey, who: Caller): Promise<void> {
  const ref = db.collection("apiKeys").doc(key.id);
  const now = Date.now(), day = dayOf(now);
  const done = await db.runTransaction(async tx => {
    const k = (await tx.get(ref)).data() as ApiKey | undefined;
    if (!k || k.deletedAt) return null;
    if (k.blockedUntil && Date.parse(k.blockedUntil) > now) return null; // another instance got there first
    const n = (k.blocks?.day === day ? k.blocks.n : 0) + 1;
    const blockedUntil = new Date(now + BLOCK_MS).toISOString();
    const pause = n >= BLOCKS_TO_PAUSE;
    tx.update(ref, {
      blockedUntil, blocks: { day, n },
      ...(pause ? { status: "paused", pausedBy: "system", pausedAt: new Date(now).toISOString(),
        pausedReason: `Blocked ${n} times today for calling in a loop` } : {}),
    });
    return { n, blockedUntil, pause };
  });
  if (!done) return;
  patchKey(key.hash, { blockedUntil: done.blockedUntil, blocks: { day, n: done.n }, ...(done.pause ? { status: "paused", pausedBy: "system" } : {}) });
  const where = [who.city, who.country].filter(Boolean).join(", ");
  const text = done.pause
    ? `"${key.name}" was called in a loop and blocked ${done.n} times today — it is paused until an admin turns it back on.`
    : `"${key.name}" was called too fast, in a loop — blocked for 1 hour (block ${done.n} of ${BLOCKS_TO_PAUSE} today).`;
  const at = new Date(now).toISOString();
  await db.collection("apiEvents").add({
    at, keyId: key.id, keyName: key.name, kind: done.pause ? "paused" : "blocked", text,
    ip: who.ip, where, origin: who.origin, device: who.device.label,
  });
  // An alert to every active admin (functions/src/notifications.ts sends the phone push).
  const admins = await db.collection("users").where("role", "==", "admin").get();
  const batch = db.batch();
  for (const u of admins.docs) {
    if (u.data().status === "inactive") continue;
    const id = `n_api_${randomBytes(6).toString("hex")}`;
    batch.set(db.collection("notifications").doc(id), {
      id, userId: u.id, read: false, createdAt: at, type: "system",
      title: done.pause ? "API key paused" : "API key blocked",
      body: `${text}${where ? ` Calls came from ${where}${who.origin ? ` (${who.origin})` : ""}.` : ""}`,
    });
  }
  await batch.commit();
}

/* ─────────────── Counting and the log ─────────────── */

export interface Call {
  keyId: string;          // "_invalid" for a wrong or missing key
  keyName?: string;
  path: string;           // "products", "product", "filters", "ping"
  query: string;
  status: number;
  ms: number;
  who: Caller;
  ua: string;
  referer: string;
  returned?: number;
  code?: string;
  requestId: string;
}

/** Calls refused before the database was asked — counted here, written together every half minute. */
const pending = new Map<string, Record<string, number>>();
let flushTimer: NodeJS.Timeout | null = null;

// How many different values one key's hour keeps in each breakdown (on this
// instance) — the rest are counted as "Other", so a record never grows past
// what the database allows, whatever is thrown at it.
const MAP_CAP = 150;
const seen = new Map<string, Set<string>>();
function capped(keyId: string, field: string, v: string): string {
  const k = `${keyId}|${hourOf(Date.now())}|${field}`;
  let set = seen.get(k);
  if (!set) {
    set = new Set();
    seen.set(k, set);
    if (seen.size > 2000) seen.delete(seen.keys().next().value as string);
  }
  if (set.has(v)) return v;
  if (set.size >= MAP_CAP) return "Other";
  set.add(v);
  return v;
}

function statsFields(c: Call, n = 1): Record<string, unknown> {
  const inc = (v = n) => FieldValue.increment(v);
  const s = String(c.status);
  const m = (field: string, v: string) => ({ [mapKey(capped(c.keyId, field, v))]: inc() });
  return {
    calls: inc(), ms: inc(c.ms * n),
    ...(c.status < 400 ? { ok: inc() } : c.status === 429 ? { limited: inc() } : c.status >= 500 ? { c5xx: inc() } : { c4xx: inc() }),
    ...(c.ms > 1000 ? { slow: inc() } : {}),
    status: m("status", s),
    paths: m("paths", c.path),
    countries: m("countries", c.who.country || "??"),
    cities: m("cities", `${c.who.country || "??"}|${c.who.city || "?"}`),
    origins: m("origins", c.who.origin || "(server)"),
    devices: m("devices", c.who.device.label),
    kinds: m("kinds", c.who.device.kind),
    // Addresses are in each call's own line (apiCalls), not here.
  };
}

function statsRef(keyId: string, t: number) {
  return db.collection("apiStats").doc(`${keyId}_${hourOf(t).replace(/[-T]/g, "")}`);
}
const statsBase = (keyId: string, t: number) => ({ keyId, hour: hourOf(t), day: dayOf(t) });

/** Count one call and write it down (kept 30 days). */
export async function record(c: Call): Promise<void> {
  const t = Date.now();
  const at = new Date(t);
  await Promise.all([
    statsRef(c.keyId, t).set({ ...statsBase(c.keyId, t), ...statsFields(c) }, { merge: true }),
    db.collection("apiCalls").add({
      keyId: c.keyId, ...(c.keyName ? { keyName: c.keyName } : {}), at: at.toISOString(), path: c.path, query: c.query.slice(0, 300),
      status: c.status, ms: c.ms, ip: c.who.ip, country: c.who.country, city: c.who.city, origin: c.who.origin,
      referer: c.referer.slice(0, 200), ua: c.ua.slice(0, 250), device: c.who.device.label, kind: c.who.device.kind,
      ...(c.returned !== undefined ? { returned: c.returned } : {}), ...(c.code ? { code: c.code } : {}), requestId: c.requestId,
      expireAt: Timestamp.fromMillis(t + LOG_DAYS * 86_400_000),
    }),
  ]);
}

let pendingSince = 0;
/** The counts held back, written once they have waited half a minute — on any call, as timers don't run between calls. */
export async function flushIfDue(): Promise<void> {
  if (pending.size && Date.now() - pendingSince > 30_000) await flush();
}

/** A refused call counted without a write of its own — many become one write. */
export function recordLater(c: Call): void {
  const k = JSON.stringify([c.keyId, c.status, c.path, c.who.country, c.who.city, c.who.origin, c.who.device.label, c.who.device.kind]);
  if (!pending.size) pendingSince = Date.now();
  if (pending.size >= 2000 && !pending.has(k)) return; // a flood of every kind at once: counted no further until written
  const e = pending.get(k) ?? { n: 0, ms: 0 };
  e.n += 1; e.ms += c.ms;
  pending.set(k, e);
  flushTimer ??= setTimeout(() => { flushTimer = null; void flush(); }, 30_000);
}

// Written before an instance is shut down, too.
process.once("SIGTERM", () => { void flush(); });

export async function flush(): Promise<void> {
  if (!pending.size) return;
  const all = [...pending.entries()];
  pending.clear();
  const t = Date.now();
  const batch = db.batch();
  for (const [k, e] of all.slice(0, 450)) {
    const [keyId, status, path, country, city, origin, label, kind] = JSON.parse(k) as [string, number, string, string, string, string, string, Device["kind"]];
    const c: Call = { keyId, path, query: "", status, ms: Math.round(e.ms / e.n), ua: "", referer: "", requestId: "",
      who: { ip: "", country, city, origin, device: { kind, label } } };
    batch.set(statsRef(keyId, t), { ...statsBase(keyId, t), ...statsFields(c, e.n) }, { merge: true });
  }
  await batch.commit().catch(e => console.warn("[api] stats not written:", e?.message ?? e));
}
