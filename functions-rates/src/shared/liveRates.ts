// GENERATED from src/lib/pure/liveRates.ts by functions-rates/scripts/sync-shared.cjs - do not edit here.
// Live gold and dollar rates — the ONE set of rules for reading the sources,
// checking them and choosing between them, and for turning a rate into a rate
// per gram of each karat. The server (functions-rates, every minute) and the
// app's screens (Settings → Live rates, the catalogue's prices) use this same
// file, so a karat rate is worked out the same way everywhere.
//
// Plain functions, no imports.

/* ─────────────── What a source gives ─────────────── */

/** One reading: whatever a source has, in these units. */
export interface Reading {
  /** International spot, US$ per troy ounce. */
  goldUsdOz?: number;
  silverUsdOz?: number;
  platinumUsdOz?: number;
  /** ₹ per US$. */
  usdInr?: number;
  /** Mumbai bar rates, ₹ per 10 g, without GST. */
  gold999Inr10g?: number;
  gold995Inr10g?: number;
  /** ₹ per kg. */
  silverInrKg?: number;
  /** Other currencies, units per US$ (EUR, GBP, AED…). */
  fx?: Record<string, number>;
}
export type Field = Exclude<keyof Reading, "fx">;
export const FIELDS: Field[] = ["goldUsdOz", "silverUsdOz", "platinumUsdOz", "usdInr", "gold999Inr10g", "gold995Inr10g", "silverInrKg"];
export const FIELD_LABEL: Record<Field, string> = {
  goldUsdOz: "Gold spot ($/oz)", silverUsdOz: "Silver spot ($/oz)", platinumUsdOz: "Platinum spot ($/oz)", usdInr: "₹ per $",
  gold999Inr10g: "Gold 999 Mumbai (₹/10 g)", gold995Inr10g: "Gold 995 Mumbai (₹/10 g)", silverInrKg: "Silver Mumbai (₹/kg)",
};
/** Hard limits — a value outside is never used, whatever the source says. */
export const BANDS: Record<Field, [number, number]> = {
  goldUsdOz: [1000, 15000], silverUsdOz: [5, 500], platinumUsdOz: [300, 10000], usdInr: [50, 200],
  gold999Inr10g: [30000, 600000], gold995Inr10g: [30000, 600000], silverInrKg: [20000, 1500000],
};

export const OZ = 31.1034768;
const num = (s: unknown) => { const n = Number(String(s ?? "").replace(/,/g, "").trim()); return Number.isFinite(n) ? n : NaN; };
const pos = (n: number) => (Number.isFinite(n) && n > 0 ? n : undefined);

/**
 * The bullion dealer's rate board (VOTS "GetLiveRateByTemplateID"): tab-separated
 * rows — id, name, rate, rate (with GST on 570/571), high, low, "TODAY" — read by
 * ROW ID, never by position or name (names carry stray dots). An unknown template
 * answers "Not Found" with status 200: that, a missing row, or a zero, is no reading.
 */
export const RONAK_ROWS = { goldUsdOz: 341, silverUsdOz: 342, usdInr: 343, gold995Inr10g: 347, gold999Inr10g: 350, silverInrKg: 352 } as const;
export function parseRonak(text: string): Reading {
  if (!text || /not\s*found/i.test(text.slice(0, 200))) throw new Error("The feed answered “Not Found” (its template changed?)");
  const rows = new Map<number, number>();
  for (const line of text.split(/\r?\n/)) {
    const c = line.split("\t").map(s => s.trim()).filter((s, i, a) => !(i === 0 && s === "" && a.length > 2));
    const id = Number(c[0]);
    if (Number.isInteger(id) && c.length >= 3) rows.set(id, num(c[2]));
  }
  const out: Reading = {};
  for (const [f, id] of Object.entries(RONAK_ROWS) as [Field, number][]) { const v = pos(rows.get(id) ?? NaN); if (v) out[f] = v; }
  if (!out.goldUsdOz && !out.gold999Inr10g) throw new Error("No gold rows in the feed");
  return out;
}

/** gold-api.com: { price, updatedAt } per metal. */
export function parseGoldApi(j: unknown, field: "goldUsdOz" | "silverUsdOz" | "platinumUsdOz"): Reading {
  const o = (j ?? {}) as { price?: unknown; currency?: unknown; updatedAt?: unknown };
  if (o.currency && o.currency !== "USD") throw new Error(`Not in US$ (${String(o.currency)})`);
  const v = pos(num(o.price));
  if (!v) throw new Error("No price in the answer");
  const age = Date.now() - Date.parse(String(o.updatedAt ?? ""));
  if (Number.isFinite(age) && age > 6 * 3600_000) throw new Error(`Last updated ${Math.round(age / 3600_000)} h ago`);
  return { [field]: v };
}

/** open.er-api.com /v6/latest/USD or Frankfurter /v1/latest?base=USD — units per US$. */
export function parseFx(j: unknown): Reading {
  const o = (j ?? {}) as { rates?: Record<string, unknown>; result?: string };
  if (o.result && o.result !== "success") throw new Error(`Answered ${o.result}`);
  const rates = o.rates ?? {};
  const inr = pos(num(rates.INR));
  if (!inr) throw new Error("No ₹ rate in the answer");
  const fx: Record<string, number> = {};
  for (const k of ["EUR", "GBP", "AED", "HKD", "SGD", "AUD", "CAD", "JPY", "CHF"]) { const v = pos(num(rates[k])); if (v) fx[k] = v; }
  if (!fx.AED) fx.AED = 3.6725; // pegged
  return { usdInr: inr, fx };
}

/** ibjarates.com — the official Indian benchmark, ₹ per GRAM (published twice a business day). */
export function parseIbja(html: string): Reading {
  const g = (id: string) => pos(num((new RegExp(`id="${id}"[^>]*>\\s*([\\d,.]+)`, "i").exec(html) ?? [])[1]));
  const r999 = g("GoldRatesCompare999"), r995 = g("GoldRatesCompare995");
  if (!r999) throw new Error("No 999 rate on the page");
  return { gold999Inr10g: r999 * 10, ...(r995 ? { gold995Inr10g: r995 * 10 } : {}) };
}

/* ─────────────── Settings ─────────────── */

export interface RateSettings {
  /** "live": from the sources (a hand rate may be pinned for a while); "manual": only the rates typed in Settings, until changed. */
  mode: "live" | "manual";
  /** The rates used in manual mode. */
  manual?: ManualRates;
  /** The dealer's feed address (empty = off). */
  ronakUrl: string;
  ronakOn: boolean;
  goldApiOn: boolean;
  fxDailyOn: boolean;
  ibjaOn: boolean;
  /** Which bar rate karat rates are made from: 999 × purity (the trade's way) or 995 ÷ 0.995 × purity (the bar factories buy). */
  base: "999" | "995";
  /** Purity of each metal, editable. */
  purity: Record<string, number>;
  /** Platinum in ₹: spot × ₹/$ × (1 + this %). */
  platinumInrPremiumPct: number;
  /** When the sources are called each day (India time) — a few times a day, not all day. */
  times: string[];
  /** A reading that moved more than this since the last good one is held, not used (unless a second source agrees). */
  jumpPct: number;
  /** Kept for older saved settings — no longer used. */
  staleMin: number;
  /** Catalogue prices change only when a rate moves at least this much (or once an hour). */
  stepPct: number;
  /** When the dealer's market is open (India time). */
  market: { days: number[]; open: string; close: string };
  /** Rates pinned by hand until a time — they win over every source. */
  override?: ManualRates & { until: string; note?: string; by?: string };
  alerts: boolean;
}
/** Rates typed by hand (any of them; the rest are worked out from these, or kept as they were). */
export interface ManualRates { goldUsdOz?: number; usdInr?: number; gold999Inr10g?: number; gold995Inr10g?: number; silverUsdOz?: number; silverInrKg?: number; platinumUsdOz?: number }
const cleanManual = (o: unknown): ManualRates => Object.fromEntries((FIELDS as string[]).map(k => [k, pos(num((o as Record<string, unknown> | undefined)?.[k]))])
  .filter(([k, v]) => v !== undefined && (v as number) >= BANDS[k as Field][0] && (v as number) <= BANDS[k as Field][1])) as ManualRates;
export const DEFAULT_PURITY: Record<string, number> = { "24K": 0.999, "22K": 0.916, "20K": 0.833, "18K": 0.75, "14K": 0.585, "10K": 0.417, "9K": 0.375, "PT950": 0.95, "AG925": 0.925 };
export const DEFAULT_SETTINGS: RateSettings = {
  mode: "live",
  ronakUrl: "https://ronakgold.noip.us:7666/VOTSBroadcastStreaming/Services/xml/GetLiveRateByTemplateID/goldbarmumbai",
  ronakOn: true, goldApiOn: true, fxDailyOn: true, ibjaOn: true, base: "999", purity: DEFAULT_PURITY, platinumInrPremiumPct: 0,
  times: ["10:00", "14:00", "18:00"], jumpPct: 3, staleMin: 10, stepPct: 0.25, market: { days: [1, 2, 3, 4, 5, 6], open: "09:00", close: "23:30" }, alerts: true,
};
const clampN = (v: unknown, lo: number, hi: number, d: number) => { const n = Number(v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };
export function cleanSettings(x: unknown): RateSettings {
  const s = (x ?? {}) as Partial<RateSettings>;
  const purity = { ...DEFAULT_PURITY };
  for (const [k, v] of Object.entries(s.purity ?? {})) if (/^[A-Z0-9]{2,8}$/.test(k)) { const n = Number(v); if (n > 0 && n <= 1) purity[k] = Math.round(n * 10000) / 10000; }
  const hhmm = (v: unknown, d: string) => (typeof v === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(v) ? v : d);
  const o = s.override;
  const until = o && Date.parse(o.until) > Date.now() ? o.until : undefined;
  const ov = until ? cleanManual(o) : {};
  const manual = cleanManual(s.manual);
  return {
    mode: s.mode === "manual" && Object.keys(manual).length ? "manual" : "live", ...(Object.keys(manual).length ? { manual } : {}),
    // https only (a stand-in on this computer, for local tests, may be http).
    ronakUrl: typeof s.ronakUrl === "string" && /^(https:\/\/[^\s]+|http:\/\/(127\.0\.0\.1|localhost)(:\d+)?\/[^\s]*)$/.test(s.ronakUrl.trim()) ? s.ronakUrl.trim() : s.ronakUrl === "" ? "" : DEFAULT_SETTINGS.ronakUrl,
    ronakOn: s.ronakOn !== false, goldApiOn: s.goldApiOn !== false, fxDailyOn: s.fxDailyOn !== false, ibjaOn: s.ibjaOn !== false,
    base: s.base === "995" ? "995" : "999", purity, platinumInrPremiumPct: clampN(s.platinumInrPremiumPct, 0, 50, 0),
    times: Array.isArray(s.times) ? [...new Set(s.times.filter(t => typeof t === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(t)))].sort().slice(0, 12) : DEFAULT_SETTINGS.times,
    jumpPct: clampN(s.jumpPct, 0.5, 20, 3), staleMin: clampN(s.staleMin, 2, 120, 10), stepPct: clampN(s.stepPct, 0, 5, 0.25),
    market: { days: Array.isArray(s.market?.days) ? s.market!.days.filter(d => Number.isInteger(d) && d >= 0 && d <= 6) : DEFAULT_SETTINGS.market.days, open: hhmm(s.market?.open, "09:00"), close: hhmm(s.market?.close, "23:30") },
    ...(until && Object.keys(ov).length ? { override: { ...ov, until, note: String(o!.note ?? "").slice(0, 120), by: o!.by } } : {}),
    alerts: s.alerts !== false,
  };
}

/** The set time (India time) that is due now and not yet fetched for — or null. */
export function dueSlot(s: RateSettings, lastFetchAt: string | undefined, at = new Date()): string | null {
  const ist = new Date(at.getTime() + 5.5 * 3600_000);
  const day = ist.toISOString().slice(0, 10);
  const mins = ist.getUTCHours() * 60 + ist.getUTCMinutes();
  let due: string | null = null;
  for (const t of s.times) { const [h, m] = t.split(":").map(Number); if (h * 60 + m <= mins) due = t; }
  if (!due) return null;
  // That time today, as a moment: due when the last fetch was before it.
  const [h, m] = due.split(":").map(Number);
  const slotAt = Date.parse(`${day}T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00+05:30`);
  return !lastFetchAt || Date.parse(lastFetchAt) < slotAt ? due : null;
}

/** Is the dealer's market open now (India time)? */
export function marketOpen(s: RateSettings, at = new Date()): boolean {
  const ist = new Date(at.getTime() + 5.5 * 3600_000);
  const mins = ist.getUTCHours() * 60 + ist.getUTCMinutes();
  const [oh, om] = s.market.open.split(":").map(Number), [ch, cm] = s.market.close.split(":").map(Number);
  return s.market.days.includes(ist.getUTCDay()) && mins >= oh * 60 + om && mins <= ch * 60 + cm;
}

/* ─────────────── Checking and choosing ─────────────── */

export type SourceId = "ronak" | "goldapi" | "fxdaily" | "ibja" | "derived" | "manual" | "last";
export const SOURCE_LABEL: Record<SourceId, string> = {
  ronak: "Ronak Gold (live)", goldapi: "World spot (gold-api.com)", fxdaily: "Daily $ rate (ExchangeRate-API / Frankfurter)",
  ibja: "IBJA (official daily)", derived: "Worked out from spot × ₹/$", manual: "Set by hand", last: "Last good rate",
};

export interface Chosen { value: number; source: SourceId; why?: string }
export interface Judged {
  chosen: Partial<Record<Field, Chosen>>;
  /** Readings not used, and why (a jump, out of range, disagreeing with another source). */
  held: { field: Field; source: SourceId; value: number; why: string }[];
  status: "live" | "fallback" | "manual" | "stale" | "closed";
  reasons: string[];
}

const pct = (a: number, b: number) => (Math.abs(a - b) / b) * 100;

/**
 * Every field from the first source that passes: inside its band, not a jump from
 * the last good value (unless another source agrees), and agreeing with a second
 * source where there is one. Missing gold-in-₹ is worked out from spot × ₹/$ ×
 * the dealer's usual premium (kept from times when both are live).
 */
export function judge(args: {
  sources: Partial<Record<SourceId, Reading | null>>;
  /** Sources stale (the same numbers as the last fetch, hours ago, while the market is open). */
  stale?: SourceId[];
  last?: Partial<Record<Field, { value: number; at: string }>>;
  premium?: { gold?: number; gap995?: number; silver?: number };
  settings: RateSettings;
  now?: Date;
}): Judged {
  const { sources, settings: s, last = {}, premium = {} } = args;
  const now = args.now ?? new Date();
  const stale = new Set(args.stale ?? []);
  const held: Judged["held"] = [];
  const reasons: string[] = [];
  const order: Record<Field, SourceId[]> = {
    goldUsdOz: ["ronak", "goldapi"], silverUsdOz: ["ronak", "goldapi"], platinumUsdOz: ["goldapi"],
    usdInr: ["ronak", "fxdaily"], gold999Inr10g: ["ronak", "ibja"], gold995Inr10g: ["ronak", "ibja"], silverInrKg: ["ronak"],
  };
  const chosen: Judged["chosen"] = {};
  // A second opinion for a field, if any other source has it.
  const other = (f: Field, not: SourceId) => order[f].filter(x => x !== not).map(x => sources[x]?.[f]).find(v => v !== undefined);
  // Manual mode: only the typed rates (live sources are shown beside them, never used).
  const manualMode = s.mode === "manual";
  const pinned: ManualRates = manualMode ? s.manual ?? {} : s.override ?? {};
  for (const f of FIELDS) {
    const ov = pinned[f];
    if (typeof ov === "number") { chosen[f] = { value: ov, source: "manual" }; continue; }
    if (manualMode) continue;
    for (const src of order[f]) {
      const v = sources[src]?.[f];
      if (v === undefined) continue;
      const [lo, hi] = BANDS[f];
      if (!(v >= lo && v <= hi)) { held.push({ field: f, source: src, value: v, why: "outside its normal range" }); continue; }
      if (stale.has(src)) { held.push({ field: f, source: src, value: v, why: "the same numbers as the last check, hours ago, while the market is open (frozen)" }); continue; }
      const prev = last[f];
      // Against the last good value (from up to two days ago): a big move needs a second source agreeing.
      const recent = prev && now.getTime() - Date.parse(prev.at) < 48 * 3600_000;
      const second = other(f, src);
      const agrees = second !== undefined && pct(v, second) <= 1;
      if (recent && pct(v, prev!.value) > s.jumpPct && !agrees) { held.push({ field: f, source: src, value: v, why: `jumped ${pct(v, prev!.value).toFixed(2)}% since the last good rate, and no second source agrees` }); continue; }
      // Live dealer vs world spot / daily $: far apart means one of them is wrong — the dealer is held.
      if (src === "ronak" && second !== undefined && (f === "goldUsdOz" || f === "silverUsdOz") && pct(v, second) > 2) { held.push({ field: f, source: src, value: v, why: `${pct(v, second).toFixed(1)}% away from world spot` }); continue; }
      if (src === "ronak" && f === "usdInr" && second !== undefined && pct(v, second) > 2.5) { held.push({ field: f, source: src, value: v, why: `${pct(v, second).toFixed(1)}% away from the daily $ rate` }); continue; }
      chosen[f] = { value: v, source: src };
      break;
    }
  }
  // Worked out when no source gave it: gold ₹ from spot × ₹/$ × the dealer's usual premium.
  const spot = chosen.goldUsdOz?.value, fx = chosen.usdInr?.value;
  if (!chosen.gold999Inr10g && spot && fx) {
    const v = (spot / OZ) * 10 * fx * (premium.gold && premium.gold > 1 && premium.gold < 1.4 ? premium.gold : 1.16);
    chosen.gold999Inr10g = { value: Math.round(v), source: "derived", why: `spot × ₹/$ × ${(premium.gold ?? 1.16).toFixed(3)} (the dealer's usual premium)` };
  }
  if (!chosen.gold995Inr10g && chosen.gold999Inr10g) {
    const gap = premium.gap995 && premium.gap995 > 0 && premium.gap995 < 5000 ? premium.gap995 : chosen.gold999Inr10g.value * (1 - 0.995 / 0.999);
    chosen.gold995Inr10g = { value: Math.round(chosen.gold999Inr10g.value - gap), source: "derived", why: "999 less the usual 995 gap" };
  }
  if (!chosen.silverInrKg && chosen.silverUsdOz && fx) {
    chosen.silverInrKg = { value: Math.round((chosen.silverUsdOz.value / OZ) * 1000 * fx * (premium.silver && premium.silver > 1 && premium.silver < 1.4 ? premium.silver : 1.1)), source: "derived" };
  }
  // Nothing at all: the last good value (shown as such).
  for (const f of FIELDS) if (!chosen[f] && last[f]) chosen[f] = { value: last[f]!.value, source: "last", why: `last good at ${last[f]!.at}` };

  const used = new Set(Object.values(chosen).map(c => c!.source));
  const open = marketOpen(s, now);
  let status: Judged["status"] = "live";
  if (manualMode) { status = "manual"; reasons.push("Manual rates (live sources switched off in Settings)"); }
  else if (used.has("manual")) { status = "manual"; reasons.push(`Pinned by hand until ${s.override!.until}`); }
  else if (used.has("last") || !chosen.goldUsdOz || !chosen.usdInr) { status = "stale"; reasons.push("No source answered — showing the last good rates"); }
  else if (!open && (stale.has("ronak") || !sources.ronak)) { status = "closed"; reasons.push("The market is closed — the last rates hold"); }
  // A backup only counts when it stands in for a rate the dealer gives (platinum is always world spot).
  else if (s.ronakOn && s.ronakUrl && (Object.keys(RONAK_ROWS) as Field[]).some(f => chosen[f] && chosen[f]!.source !== "ronak")) { status = "fallback"; reasons.push("Ronak isn't answering (or was held) — backup sources in use"); }
  for (const h of held) reasons.push(`${FIELD_LABEL[h.field]} from ${SOURCE_LABEL[h.source]} held: ${h.why}`);
  return { chosen, held, status, reasons };
}

/** The middle of a few recent readings — one odd tick never moves a price. */
export function median(xs: number[]): number | undefined {
  const a = xs.filter(n => Number.isFinite(n)).sort((x, y) => x - y);
  if (!a.length) return undefined;
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

/* ─────────────── Rates per gram ─────────────── */

/** What prices are made from: the smoothed rates (rates/current.price). */
export interface PriceBase { goldUsdOz: number; usdInr: number; gold999Inr10g: number; gold995Inr10g?: number; silverUsdOz?: number; silverInrKg?: number; platinumUsdOz?: number; at: string }

export interface KaratRate { key: string; purity: number; usdPerG: number; inrPerG: number }
/**
 * Per gram of each metal:
 *  - in US$ (export): world spot ÷ 31.1035 × purity — export gold pays no Indian duty;
 *  - in ₹ (India): the Mumbai bar rate ÷ 10 × purity (999 × purity, or 995 ÷ 0.995 × purity), GST added at billing.
 * Platinum and silver from their own rates.
 */
export function karatRates(p: PriceBase, s: Pick<RateSettings, "base" | "purity" | "platinumInrPremiumPct">): KaratRate[] {
  const inr24 = s.base === "995" && p.gold995Inr10g ? p.gold995Inr10g / 10 / 0.995 : p.gold999Inr10g / 10 / 0.999;
  const usd24 = p.goldUsdOz / OZ;
  const r2 = (n: number) => Math.round(n * 100) / 100;
  const out: KaratRate[] = [];
  for (const [key, purity] of Object.entries(s.purity)) {
    if (key.startsWith("PT")) {
      if (!p.platinumUsdOz) continue;
      const usd = (p.platinumUsdOz / OZ) * purity;
      out.push({ key, purity, usdPerG: r2(usd), inrPerG: r2(usd * p.usdInr * (1 + (s.platinumInrPremiumPct ?? 0) / 100)) });
    } else if (key.startsWith("AG")) {
      if (!p.silverUsdOz) continue;
      out.push({ key, purity, usdPerG: r2((p.silverUsdOz / OZ) * purity), inrPerG: r2(p.silverInrKg ? (p.silverInrKg / 1000) * purity : (p.silverUsdOz / OZ) * purity * p.usdInr) });
    } else {
      out.push({ key, purity, usdPerG: r2(usd24 * purity), inrPerG: r2(inr24 * purity) });
    }
  }
  return out;
}

/** Has a rate moved enough to reprice (the step), or is the price block old? */
export function shouldReprice(prev: Partial<PriceBase> | undefined, next: PriceBase, stepPct: number, maxAgeMin = 60): boolean {
  if (!prev?.goldUsdOz || !prev.usdInr || !prev.gold999Inr10g) return true;
  if (Date.now() - Date.parse(prev.at ?? "") > maxAgeMin * 60_000) return true;
  return (["goldUsdOz", "usdInr", "gold999Inr10g", "platinumUsdOz", "silverUsdOz"] as const)
    .some(k => prev[k] && next[k] && pct(next[k]!, prev[k]!) >= stepPct);
}
