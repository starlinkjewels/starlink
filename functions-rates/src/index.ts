// Live gold and dollar rates (Settings → Live rates).
//
//   ratesTick   each hour it looks whether a set time (Settings, a few a day) has
//               come: then each source is called on the server (never from a
//               browser), every reading checked (src/lib/pure/liveRates.ts judge),
//               the rates chosen and kept in history; admins told when a
//               source goes down, a backup is in use, a reading is held, or the
//               rates are pinned by hand
//   ratesAdmin  an admin's "check the sources now" (each source's own answer, side by side)
//
//   rates/current           what the app shows and prices from — every signed-in person reads it
//   rateSettings/main       the admin's settings (written by the app, admins only)
//   rateState/main          the server's own memory: recent readings, the dealer's usual premium, alerts sent
//   rateHistory/{day}       the day's open / high / low / close per rate, and /ticks/{HHmm} one reading a minute (admins)
//   rateEvents/{id}         a source down or back, a reading held, a status change (admins)
import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { REGION, OWNER_EMAILS } from "./region";
import {
  cleanSettings, dueSlot, FIELD_LABEL, FIELDS, judge, marketOpen, parseFx, parseGoldApi, parseIbja, parseRonak, shouldReprice, SOURCE_LABEL,
  type Field, type Judged, type PriceBase, type RateSettings, type Reading, type SourceId,
} from "./shared/liveRates";

// Local tests run against the emulators only — never the live database.
if (process.env.FUNCTIONS_EMULATOR === "true" && !process.env.FIRESTORE_EMULATOR_HOST) {
  throw new Error("functions-rates: run the Firestore emulator too — local runs must never reach the live database");
}
initializeApp();
const db = getFirestore("diamondflow");
db.settings({ ignoreUndefinedProperties: true });

const now = () => new Date().toISOString();
const istDay = (d = new Date()) => new Date(d.getTime() + 5.5 * 3600_000).toISOString().slice(0, 10);
const istHHmm = (d = new Date()) => new Date(d.getTime() + 5.5 * 3600_000).toISOString().slice(11, 16).replace(":", "");

/* ─────────────── Fetching ─────────────── */

interface SourceRun { ok: boolean; at: string; ms: number; error?: string; reading?: Reading }

async function get(url: string, as: "text" | "json", timeoutMs = 8000): Promise<{ body: unknown; ms: number }> {
  const t0 = Date.now();
  // Never with the certificate check off: a broken certificate is a source that's down.
  const res = await fetch(url, { headers: { Accept: as === "json" ? "application/json" : "text/plain, */*", "User-Agent": "rates-check/1.0" }, signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`answered ${res.status}`);
  const body = as === "json" ? await res.json() : await res.text();
  return { body, ms: Date.now() - t0 };
}
async function run(f: () => Promise<{ reading: Reading; ms: number }>): Promise<SourceRun> {
  const t0 = Date.now();
  try { const r = await f(); return { ok: true, at: now(), ms: r.ms, reading: r.reading }; }
  catch (e) {
    const err = e as { name?: string; message?: string; cause?: { code?: string } };
    const why = err.name === "TimeoutError" ? "no answer in 8 s" : err.cause?.code ? `${err.cause.code}` : err.message ?? String(e);
    return { ok: false, at: now(), ms: Date.now() - t0, error: why.slice(0, 160) };
  }
}

const ronak = (url: string) => run(async () => {
  const sep = url.includes("?") ? "&" : "?";
  const r = await get(`${url}${sep}_=${Date.now()}`, "text");
  return { reading: parseRonak(String(r.body)), ms: r.ms };
});
const goldApi = () => run(async () => {
  const t0 = Date.now();
  const [g, s, p] = await Promise.all(["XAU", "XAG", "XPT"].map(m => get(`https://api.gold-api.com/price/${m}`, "json").then(r => r.body).catch(() => null)));
  if (!g) throw new Error("no gold price");
  return { reading: { ...parseGoldApi(g, "goldUsdOz"), ...(s ? safe(() => parseGoldApi(s, "silverUsdOz")) : {}), ...(p ? safe(() => parseGoldApi(p, "platinumUsdOz")) : {}) }, ms: Date.now() - t0 };
});
const fxDaily = () => run(async () => {
  try { const r = await get("https://open.er-api.com/v6/latest/USD", "json"); return { reading: parseFx(r.body), ms: r.ms }; }
  catch { const r = await get("https://api.frankfurter.dev/v1/latest?base=USD&symbols=INR,EUR,GBP,HKD,SGD,AUD,CAD,JPY,CHF", "json"); return { reading: parseFx(r.body), ms: r.ms }; }
});
const ibja = () => run(async () => { const r = await get("https://ibjarates.com/", "text", 12000); return { reading: parseIbja(String(r.body)), ms: r.ms }; });
function safe<T>(f: () => T): T | Record<string, never> { try { return f(); } catch { return {}; } }

/* ─────────────── The server's memory ─────────────── */

interface State {
  last?: Partial<Record<Field, { value: number; at: string }>>;
  premium?: { gold?: number; gap995?: number; silver?: number };
  /** The dealer's values, and since when they haven't moved. */
  ronakSig?: { sig: string; since: string };
  daily?: { fx?: SourceRun; ibja?: SourceRun };
  sources?: Partial<Record<SourceId, { ok: boolean; at: string; error?: string }>>;
  alerts?: Record<string, string>;
  status?: Judged["status"];
  /** The last time the sources were called, whether it gave good rates, and the retries since. */
  lastFetchAt?: string;
  lastFetchOk?: boolean;
  retries?: number;
}

async function tell(title: string, body: string): Promise<void> {
  const admins = await db.collection("users").where("role", "==", "admin").get();
  const b = db.batch();
  for (const u of admins.docs.filter(d => d.data().status !== "inactive")) {
    const id = `n_rates_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    b.set(db.collection("notifications").doc(id), { id, userId: u.id, title, body, type: "rates", read: false, createdAt: now() });
  }
  await b.commit();
}

/* ─────────────── A check of the sources ─────────────── */

/**
 * Called each hour, it calls the sources only at the times set in Settings (a
 * few a day — not all day), or once an hour to try again after a check that
 * gave no good rates. "Refresh now" calls them at once (force).
 */
export async function tickOnce(force = false): Promise<{ status: Judged["status"]; repriced: boolean; skipped?: boolean }> {
  const s: RateSettings = cleanSettings((await db.collection("rateSettings").doc("main").get()).data());
  const stateRef = db.collection("rateState").doc("main");
  const st = ((await stateRef.get()).data() ?? {}) as State;
  const at = new Date();
  const retry = st.lastFetchOk === false && (st.retries ?? 0) < 6;
  if (!force && !retry && !dueSlot(s, st.lastFetchAt, at)) return { status: st.status ?? "stale", repriced: false, skipped: true };

  const [rk, ga, fx, ib] = await Promise.all([
    s.ronakOn && s.ronakUrl ? ronak(s.ronakUrl) : Promise.resolve(null),
    s.goldApiOn ? goldApi() : Promise.resolve(null),
    s.fxDailyOn ? fxDaily() : Promise.resolve(null),
    s.ibjaOn ? ibja() : Promise.resolve(null),
  ]);

  // Frozen: the dealer's numbers exactly as at the last check (an hour or more ago) while the market is open.
  let ronakSig = st.ronakSig;
  const stale: SourceId[] = [];
  if (rk?.ok && rk.reading) {
    const sig = [rk.reading.gold999Inr10g, rk.reading.goldUsdOz, rk.reading.usdInr].join("|");
    if (ronakSig?.sig !== sig) ronakSig = { sig, since: now() };
    else if (marketOpen(s, at) && Date.now() - Date.parse(ronakSig.since) > 60 * 60_000) stale.push("ronak");
  }
  const j = judge({
    sources: { ronak: rk?.ok ? rk.reading : null, goldapi: ga?.ok ? ga.reading : null, fxdaily: fx?.ok ? fx.reading : null, ibja: ib?.ok ? ib.reading : null },
    stale, last: st.last, premium: st.premium, settings: s, now: at,
  });

  // The dealer's usual premium over spot × ₹/$, learnt while both are live (slowly).
  const premium = { ...(st.premium ?? {}) };
  const c = j.chosen;
  if (c.gold999Inr10g?.source === "ronak" && c.goldUsdOz && c.usdInr && c.goldUsdOz.source !== "last" && c.usdInr.source !== "last") {
    const ratio = c.gold999Inr10g.value / ((c.goldUsdOz.value / 31.1034768) * 10 * c.usdInr.value);
    if (ratio > 1 && ratio < 1.4) premium.gold = premium.gold ? premium.gold * 0.9 + ratio * 0.1 : ratio;
    if (c.gold995Inr10g?.source === "ronak") { const gap = c.gold999Inr10g.value - c.gold995Inr10g.value; if (gap > 0 && gap < 5000) premium.gap995 = premium.gap995 ? premium.gap995 * 0.8 + gap * 0.2 : gap; }
    if (c.silverInrKg?.source === "ronak" && c.silverUsdOz) { const r = c.silverInrKg.value / ((c.silverUsdOz.value / 31.1034768) * 1000 * c.usdInr.value); if (r > 1 && r < 1.4) premium.silver = premium.silver ? premium.silver * 0.9 + r * 0.1 : r; }
  }

  // The last good value of each (a hand rate is not one — it isn't a market reading).
  const last = { ...(st.last ?? {}) };
  for (const f of FIELDS) {
    const ch = c[f];
    if (!ch || ch.source === "last" || ch.source === "manual") continue;
    last[f] = { value: ch.value, at: now() };
  }
  // A few checks a day: each checked reading is used as it is (a held one never is).
  const sm = (f: Field) => c[f]?.value;
  const cur = (await db.collection("rates").doc("current").get()).data() as { price?: Partial<PriceBase>; status?: string } | undefined;
  let repriced = false;
  let price = cur?.price as PriceBase | undefined;
  const g = sm("goldUsdOz"), fxv = sm("usdInr"), g999 = sm("gold999Inr10g");
  if (g && fxv && g999) {
    const next: PriceBase = {
      goldUsdOz: round(g, 2), usdInr: round(fxv, 4), gold999Inr10g: Math.round(g999), gold995Inr10g: sm("gold995Inr10g") ? Math.round(sm("gold995Inr10g")!) : undefined,
      silverUsdOz: sm("silverUsdOz") ? round(sm("silverUsdOz")!, 3) : undefined, silverInrKg: sm("silverInrKg") ? Math.round(sm("silverInrKg")!) : undefined,
      platinumUsdOz: sm("platinumUsdOz") ? round(sm("platinumUsdOz")!, 2) : undefined, at: now(),
    };
    // Never moved by a held, stale or missing reading: only from rates that were checked.
    // A hand rate (or switching to manual) reprices at once, whatever the step.
    const handNow = FIELDS.some(f => c[f]?.source === "manual" && cur?.price?.[f as keyof PriceBase] !== next[f as keyof PriceBase]);
    if (j.status !== "stale" && (handNow || shouldReprice(cur?.price, next, s.stepPct))) { price = next; repriced = true; }
  }

  const runs: Partial<Record<SourceId, SourceRun | null>> = { ronak: rk, goldapi: ga, fxdaily: fx, ibja: ib };
  const sources: State["sources"] = {};
  for (const [k, r] of Object.entries(runs) as [SourceId, SourceRun | null][]) if (r) sources[k] = { ok: r.ok, at: r.at, ...(r.error ? { error: r.error } : {}) };
  const live = Object.fromEntries(FIELDS.filter(f => c[f]).map(f => [f, { value: c[f]!.value, source: c[f]!.source, ...(c[f]!.why ? { why: c[f]!.why } : {}) }]));
  await db.collection("rates").doc("current").set({
    status: j.status, reasons: j.reasons.slice(0, 12), held: j.held.slice(0, 12), live, ...(price ? { price } : {}),
    fx: fx?.ok ? fx.reading?.fx ?? {} : (cur as { fx?: unknown } | undefined)?.fx ?? {},
    sources: Object.fromEntries(Object.entries(runs).filter(([, r]) => r).map(([k, r]) => [k, { ok: r!.ok, at: r!.at, ms: r!.ms, ...(r!.error ? { error: r!.error } : {}), ...(r!.reading ? { reading: stripFx(r!.reading) } : {}) }])),
    premium, marketOpen: marketOpen(s, at), asOf: now(), ...(j.status !== "stale" ? { lastGoodAt: now() } : {}),
  }, { merge: true });

  // History: each check, and the day's open / high / low / close.
  const day = istDay(at);
  const vals = Object.fromEntries(FIELDS.filter(f => c[f] && c[f]!.source !== "last").map(f => [f, c[f]!.value]));
  await db.collection("rateHistory").doc(day).collection("ticks").doc(istHHmm(at)).set({ ...vals, status: j.status, at: now() });
  await db.runTransaction(async tx => {
    const ref = db.collection("rateHistory").doc(day);
    const d = ((await tx.get(ref)).data() ?? {}) as Record<string, { o: number; h: number; l: number; c: number }>;
    const upd: Record<string, unknown> = { day, at: now() };
    for (const [f, v] of Object.entries(vals) as [Field, number][]) {
      const o = d[f];
      upd[f] = o ? { o: o.o, h: Math.max(o.h, v), l: Math.min(o.l, v), c: v } : { o: v, h: v, l: v, c: v };
    }
    tx.set(ref, upd, { merge: true });
  });

  // What changed, kept — and told to admins (once an hour per kind at most).
  const alerts = { ...(st.alerts ?? {}) };
  const events: { kind: string; text: string }[] = [];
  if (st.status && st.status !== j.status) events.push({ kind: `status_${j.status}`, text: `Rates now: ${statusWord(j.status)}. ${j.reasons[0] ?? ""}`.trim() });
  for (const [k, r] of Object.entries(runs) as [SourceId, SourceRun | null][]) {
    if (!r || k === "fxdaily" && r === st.daily?.fx || k === "ibja" && r === st.daily?.ibja) continue;
    const was = st.sources?.[k]?.ok;
    if (was !== false && !r.ok) events.push({ kind: `down_${k}`, text: `${SOURCE_LABEL[k]} isn't answering: ${r.error}` });
    if (was === false && r.ok) events.push({ kind: `up_${k}`, text: `${SOURCE_LABEL[k]} is answering again` });
  }
  for (const h of j.held) events.push({ kind: `held_${h.field}`, text: `${FIELD_LABEL[h.field]} ${h.value} from ${SOURCE_LABEL[h.source]} not used: ${h.why}` });
  for (const e of events) {
    const lastAt = alerts[e.kind];
    if (lastAt && Date.now() - Date.parse(lastAt) < 60 * 60_000) continue;
    alerts[e.kind] = now();
    await db.collection("rateEvents").add({ ...e, at: now(), status: j.status });
    if (s.alerts && !e.kind.startsWith("up_") && !(e.kind === "status_closed" || e.kind === "status_live")) await tell("Gold & $ rates", e.text).catch(() => undefined);
  }

  const good = j.status !== "stale";
  await stateRef.set({
    last, premium, lastFetchAt: now(), lastFetchOk: good, retries: good ? 0 : (st.retries ?? 0) + 1, ...(ronakSig ? { ronakSig } : {}), status: j.status, alerts, sources,
    daily: { ...(fx ? { fx } : {}), ...(ib ? { ibja: ib } : {}) },
  });
  return { status: j.status, repriced };
}

const round = (n: number, d: number) => Math.round(n * 10 ** d) / 10 ** d;
const stripFx = (r: Reading) => { const { fx: _fx, ...rest } = r; void _fx; return rest; };
const statusWord = (s: Judged["status"]) => ({ live: "live", fallback: "on backup sources", manual: "pinned by hand", stale: "no source answering (last good rates)", closed: "market closed" }[s]);

// Wakes once an hour (a moment's check, inside the free allowance); the sources are called only at the set times.
export const ratesTick = onSchedule({ schedule: "every 60 minutes", region: REGION, memory: "256MiB", timeoutSeconds: 60, retryCount: 0, maxInstances: 1 }, async () => {
  await tickOnce();
});

/* ─────────────── An admin's tools ─────────────── */

async function requireAdmin(auth: { uid: string; token: { email?: string } } | undefined): Promise<string> {
  if (!auth?.uid) throw new HttpsError("unauthenticated", "Sign in first.");
  if (OWNER_EMAILS.includes(String(auth.token?.email ?? "").toLowerCase())) return auth.uid;
  const idx = (await db.collection("userByAuth").doc(auth.uid).get()).data() as { role?: string; status?: string } | undefined;
  if (idx?.role === "admin" && idx?.status === "active") return auth.uid;
  throw new HttpsError("permission-denied", "Only an admin can do this.");
}

export const ratesAdmin = onCall<{ action: "check" | "refresh" }>({ region: REGION, memory: "256MiB", maxInstances: 2, timeoutSeconds: 60 }, async req => {
  await requireAdmin(req.auth as never);
  const s = cleanSettings((await db.collection("rateSettings").doc("main").get()).data());
  if (req.data?.action === "refresh") return await tickOnce(true);
  // Every source's own answer now, side by side (whatever is switched on or off).
  const [rk, ga, fx, ib] = await Promise.all([s.ronakUrl ? ronak(s.ronakUrl) : Promise.resolve(null), goldApi(), fxDaily(), ibja()]);
  return { ronak: rk, goldapi: ga, fxdaily: fx, ibja: ib, at: now() };
});

