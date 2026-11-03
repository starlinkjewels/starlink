// Ready Stock API — the keys a B2B client's website reads our pieces with, and
// what the API counts about their calls. The API itself is functions-api/
// (its rules: functions-api/src/logic.ts, its limits: functions-api/src/guard.ts).
//
// Own collections, written straight to Firestore (not the synced store), read
// and written by admins only (firestore.rules):
//   apiKeys   — one per key: its name, what it shows, its price rule, limits,
//               websites; only a SHA-256 hash of the key, never the key itself
//   apiQuota  — per key, written by the API: this minute's and today's calls, the last call
//   apiStats  — per key per hour, written by the API: calls, errors, speed, and
//               by country, city, website, device, address, endpoint
//   apiCalls  — every call, kept 30 days (Firestore removes them: expireAt)
//   apiEvents — blocks and pauses (the API), and what admins did to the keys

export const API_KEYS = "apiKeys";
export const API_QUOTA = "apiQuota";
export const API_STATS = "apiStats";
export const API_CALLS = "apiCalls";
export const API_EVENTS = "apiEvents";

/** The invalid-key bucket in apiStats. */
export const INVALID_KEY_ID = "_invalid";

export const DEFAULT_PER_MINUTE = 60;
export const DEFAULT_PER_DAY = 10_000;
/** One key's counter is one record, changed on every call — kept to 2 a second (functions-api/src/store.ts). */
export const MAX_PER_MINUTE = 120;
export const MAX_PER_DAY = 1_000_000;
/** Blocked this long when called in a loop; paused at the third block in a day (functions-api/src/guard.ts). */
export const BLOCK_HOURS = 1;
export const BLOCKS_TO_PAUSE = 3;
export const LOG_DAYS = 30;

export interface ApiKeyScope {
  /** Jewellery types (Ring, Pendant…); empty = all. */
  types?: string[];
  metals?: string[];
  offices?: string[];
  /** Company ids ("main" = the first); empty = all. */
  companies?: string[];
}

export interface ApiKeyDoc {
  id: string;
  name: string;
  /** The client it was made for, when it was. */
  clientId?: string;
  clientName?: string;
  note?: string;
  /** SHA-256 (hex) of the key — the key itself is shown once and never kept. */
  hash: string;
  /** Its first characters and its last four — enough to tell keys apart. */
  prefix: string;
  last4: string;
  status: "active" | "paused";
  pausedBy?: "admin" | "system";
  pausedAt?: string;
  pausedReason?: string;
  /** Called in a loop: refused until then (written by the API). */
  blockedUntil?: string;
  blocks?: { day: string; n: number };
  scope: ApiKeyScope;
  price: { show: boolean; markupPct: number };
  /** Also give each design's 3D CAD file (.3dm) — off unless chosen: it is our own design. */
  share3d?: boolean;
  limits: { perMinute: number; perDay: number };
  /** Websites it may be used from in a browser ("shop.com", "*.shop.com"); empty = any. */
  origins: string[];
  createdAt: string;
  createdBy: string;
  createdByName?: string;
  updatedAt?: string;
  rotatedAt?: string;
  deletedAt?: string;
  deletedBy?: string;
}

export interface ApiQuotaDoc {
  keyId: string;
  minute?: number;
  minuteCount?: number;
  day?: string;
  dayCount?: number;
  total?: number;
  lastAt?: string;
  lastIp?: string;
  lastCountry?: string;
  lastCity?: string;
  lastOrigin?: string;
  lastDevice?: string;
}

/** One key's calls in one hour (UTC). Map keys have "." written as "·" (see dotted()). */
export interface ApiStatsDoc {
  id: string;
  keyId: string;
  hour: string;   // "2026-11-03T12"
  day: string;    // "2026-11-03"
  calls?: number;
  ok?: number;
  c4xx?: number;
  c5xx?: number;
  limited?: number;
  slow?: number;
  ms?: number;
  status?: Record<string, number>;
  paths?: Record<string, number>;
  countries?: Record<string, number>;
  cities?: Record<string, number>;
  origins?: Record<string, number>;
  devices?: Record<string, number>;
  kinds?: Record<string, number>;
  ips?: Record<string, number>;
}

export interface ApiCallDoc {
  id: string;
  keyId: string;
  keyName?: string;
  at: string;
  path: string;
  query: string;
  status: number;
  ms: number;
  ip: string;
  country: string;
  city: string;
  origin: string;
  referer?: string;
  ua?: string;
  device: string;
  kind: string;
  returned?: number;
  code?: string;
  requestId?: string;
}

export interface ApiEventDoc {
  id: string;
  at: string;
  keyId: string;
  keyName: string;
  kind: "blocked" | "paused" | "resumed" | "unblocked" | "created" | "edited" | "regenerated" | "deleted";
  text: string;
  by?: string;
  byName?: string;
  ip?: string;
  where?: string;
  origin?: string;
  device?: string;
}

/** A map key as the API wrote it, read back ("·" was a "."). */
export const dotted = (k: string) => k.replace(/·/g, ".");

const B62 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

/** A new key: "rsk_live_" and 40 random letters and digits (about 238 bits). */
export function newSecret(): string {
  const out: string[] = [];
  // Rejection sampling: every character equally likely.
  while (out.length < 40) {
    for (const b of crypto.getRandomValues(new Uint8Array(64))) {
      if (b < 248 && out.length < 40) out.push(B62[b % 62]);
    }
  }
  return `rsk_live_${out.join("")}`;
}

/** SHA-256 of a key, hex — what is stored, and what the API looks keys up by. */
export async function hashSecret(secret: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
  return [...new Uint8Array(d)].map(x => x.toString(16).padStart(2, "0")).join("");
}

/** "rsk_live_Ab3d…9xQz". */
export const maskedKey = (k: Pick<ApiKeyDoc, "prefix" | "last4">) => `${k.prefix}…${k.last4}`;

export type KeyState = "active" | "blocked" | "paused" | "deleted";
export function keyState(k: ApiKeyDoc, now = Date.now()): KeyState {
  if (k.deletedAt) return "deleted";
  if (k.status === "paused") return "paused";
  if (k.blockedUntil && Date.parse(k.blockedUntil) > now) return "blocked";
  return "active";
}

/** A list of websites as typed — one per line or by commas — cleaned to bare hosts ("shop.com", "*.shop.com"). */
export function cleanOrigins(text: string): { list: string[]; bad: string[] } {
  const list: string[] = [], bad: string[] = [];
  for (const raw of text.split(/[\n,]+/).map(s => s.trim()).filter(Boolean)) {
    const v = raw.toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/^www\./, "");
    if (/^(\*\.)?([a-z0-9-]+\.)*[a-z0-9-]+(:\d+)?$/.test(v)) { if (!list.includes(v)) list.push(v); } else bad.push(raw);
  }
  return { list, bad };
}
