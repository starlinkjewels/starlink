// The health board's figures, added up from the API's hourly counts (apiStats —
// see lib/apiKeysModel.ts): totals, calls over time, and the breakdowns by
// country, city, website, device, address, endpoint and key.
import { dotted, INVALID_KEY_ID, type ApiStatsDoc } from "./apiKeysModel";

export type Range = "24h" | "7d" | "30d";
export const RANGE_LABEL: Record<Range, string> = { "24h": "Last 24 hours", "7d": "Last 7 days", "30d": "Last 30 days" };

/** The first hour of a range, as the API writes hours ("2026-11-03T12", UTC). */
export function rangeStart(r: Range, now = Date.now()): string {
  const h = r === "24h" ? 23 : r === "7d" ? 7 * 24 - 1 : 30 * 24 - 1;
  return new Date(now - h * 3_600_000).toISOString().slice(0, 13);
}

export interface Totals { calls: number; ok: number; c4xx: number; c5xx: number; limited: number; slow: number; ms: number }
const zero = (): Totals => ({ calls: 0, ok: 0, c4xx: 0, c5xx: 0, limited: 0, slow: 0, ms: 0 });

export interface Board {
  totals: Totals;
  /** Wrong or missing keys (not in totals). */
  invalid: number;
  /** Calls over time: an hour each for 24 hours, a day each for longer. */
  /** avgMs is null in a bucket with no calls — a gap in the line, not a fall to 0. */
  series: { label: string; ok: number; limited: number; errors: number; avgMs: number | null }[];
  byKey: Map<string, Totals>;
  countries: [string, number][];
  cities: [string, number][];
  origins: [string, number][];
  devices: [string, number][];
  kinds: [string, number][];
  ips: [string, number][];
  paths: [string, number][];
  statuses: [string, number][];
}

const add = (a: Totals, s: ApiStatsDoc) => {
  a.calls += s.calls ?? 0; a.ok += s.ok ?? 0; a.c4xx += s.c4xx ?? 0; a.c5xx += s.c5xx ?? 0;
  a.limited += s.limited ?? 0; a.slow += s.slow ?? 0; a.ms += s.ms ?? 0;
};
const merge = (into: Map<string, number>, m: Record<string, number> | undefined) => {
  for (const [k, v] of Object.entries(m ?? {})) into.set(dotted(k), (into.get(dotted(k)) ?? 0) + (Number(v) || 0));
};
const ranked = (m: Map<string, number>) => [...m.entries()].filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]);

const HOUR_FMT = new Intl.DateTimeFormat(undefined, { hour: "numeric" });
const DAY_FMT = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short" });

/** Everything the board shows for a range — every key's, or only `keyId`'s. */
export function buildBoard(stats: ApiStatsDoc[], range: Range, keyId?: string, now = Date.now()): Board {
  const from = rangeStart(range, now);
  const rows = stats.filter(s => s.hour >= from && (keyId ? s.keyId === keyId : true));
  const real = rows.filter(s => s.keyId !== INVALID_KEY_ID);
  const totals = zero();
  const byKey = new Map<string, Totals>();
  const maps = { countries: new Map<string, number>(), cities: new Map<string, number>(), origins: new Map<string, number>(), devices: new Map<string, number>(),
    kinds: new Map<string, number>(), ips: new Map<string, number>(), paths: new Map<string, number>(), statuses: new Map<string, number>() };
  for (const s of real) {
    add(totals, s);
    const k = byKey.get(s.keyId) ?? zero(); add(k, s); byKey.set(s.keyId, k);
    merge(maps.countries, s.countries); merge(maps.cities, s.cities); merge(maps.origins, s.origins); merge(maps.devices, s.devices);
    merge(maps.kinds, s.kinds); merge(maps.ips, s.ips); merge(maps.paths, s.paths); merge(maps.statuses, s.status);
  }
  // Calls over time — every bucket, empty ones too, so the gaps show.
  const hourly = range === "24h";
  const buckets: { key: string; label: string }[] = [];
  if (hourly) {
    for (let i = 23; i >= 0; i--) { const t = now - i * 3_600_000; buckets.push({ key: new Date(t).toISOString().slice(0, 13), label: HOUR_FMT.format(t) }); }
  } else {
    const days = range === "7d" ? 7 : 30;
    for (let i = days - 1; i >= 0; i--) { const t = now - i * 86_400_000; buckets.push({ key: new Date(t).toISOString().slice(0, 10), label: DAY_FMT.format(t) }); }
  }
  const at = new Map(buckets.map(b => [b.key, { ...zero() }]));
  for (const s of real) { const b = at.get(hourly ? s.hour : s.day); if (b) add(b, s); }
  return {
    totals,
    invalid: keyId ? 0 : rows.filter(s => s.keyId === INVALID_KEY_ID).reduce((n, s) => n + (s.calls ?? 0), 0),
    series: buckets.map(b => { const t = at.get(b.key)!; return { label: b.label, ok: t.ok, limited: t.limited, errors: t.c4xx + t.c5xx, avgMs: t.calls ? Math.round(t.ms / t.calls) : null }; }),
    byKey,
    countries: ranked(maps.countries), cities: ranked(maps.cities), origins: ranked(maps.origins), devices: ranked(maps.devices),
    kinds: ranked(maps.kinds), ips: ranked(maps.ips), paths: ranked(maps.paths), statuses: ranked(maps.statuses),
  };
}

const REGION = typeof Intl !== "undefined" && "DisplayNames" in Intl ? new Intl.DisplayNames(undefined, { type: "region" }) : null;
/** "IN" → "India" ("??" → "Unknown"). */
export function countryName(code: string): string {
  if (!code || code === "??") return "Unknown";
  try { return REGION?.of(code.toUpperCase()) ?? code; } catch { return code; }
}
/** "IN|Surat" → "Surat, India". */
export function cityName(key: string): string {
  const [cc, city] = key.split("|");
  if (!city || city === "?") return `${countryName(cc)} (city unknown)`;
  return `${city}, ${countryName(cc)}`;
}
/** "IN" → 🇮🇳. */
export function flag(code: string): string {
  if (!/^[A-Za-z]{2}$/.test(code)) return "🌐";
  return String.fromCodePoint(...[...code.toUpperCase()].map(c => 0x1f1e6 + c.charCodeAt(0) - 65));
}

export const PATH_LABEL: Record<string, string> = { products: "GET /products", product: "GET /products/{id}", filters: "GET /filters", ping: "GET /ping" };

export const pct = (n: number, of: number) => (of ? `${Math.round((n / of) * 1000) / 10}%` : "—");
