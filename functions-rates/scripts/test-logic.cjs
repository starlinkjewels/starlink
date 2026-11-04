// The rate rules (src/lib/pure/liveRates.ts), checked without a database or the network: npm test.
const R = require("../lib/shared/liveRates.js");
let pass = 0, fail = 0;
const ok = (c, m, x = "") => { c ? pass++ : fail++; console.log((c ? "  ok   " : "  FAIL ") + m, x); };
const S = R.cleanSettings({});
const NOW = new Date("2026-11-04T06:00:00Z"); // 11:30 IST, a Wednesday — market open

// ── Reading the sources
const RONAK = "\t341\tGold Spot\t3946.15\t3946.15\t0.00\t0.00\tTODAY\r\n\t342\tSilver Spot\t49.41\t49.41\t50.23\t48.98\tTODAY\r\n\t343\tINR\t94.674\t94.674\t94.749\t94.499\tTODAY\r\n\t344\tGold Costing\t139654\t139654\t0\t139800\tTODAY\r\n\t347\tGold Mumbai RTGS rate 995 T+1\t138404\t138404\t138550\t137930\tTODAY\r\n\t350\tGold Mumbai RTGS rate 999 T+1\t139304\t139304\t139450\t138830\tTODAY\r\n\t352\tSilver Mumbai 999 RTGS.\t177763\t177763\t178900\t176622\tTODAY\r\n\t571\tGOLD 999 WITH GST\t139304\t143483\t143634\t142995\tTODAY";
const r = R.parseRonak(RONAK);
ok(r.goldUsdOz === 3946.15 && r.usdInr === 94.674 && r.gold999Inr10g === 139304 && r.gold995Inr10g === 138404 && r.silverInrKg === 177763 && r.silverUsdOz === 49.41, "the dealer's board read by row id", JSON.stringify(r));
ok(!("withGst" in r), "the 'with GST' rows are never the base");
let t; try { R.parseRonak("Not Found"); } catch (e) { t = e.message; }
ok(/Not Found/.test(t ?? ""), "'Not Found' with status 200: no reading");
const zero = R.parseRonak(RONAK.replace("139304\t139304", "0\t0"));
ok(zero.gold999Inr10g === undefined && zero.goldUsdOz === 3946.15, "a 0 is no value (that row only)");
ok(R.parseGoldApi({ currency: "USD", price: 3943.6, updatedAt: new Date().toISOString() }, "goldUsdOz").goldUsdOz === 3943.6, "world spot read");
t = undefined; try { R.parseGoldApi({ currency: "USD", price: 3943.6, updatedAt: "2026-01-01T00:00:00Z" }, "goldUsdOz"); } catch (e) { t = e.message; }
ok(/ago/.test(t ?? ""), "a spot price hours old: refused");
const fx = R.parseFx({ result: "success", rates: { INR: 94.83, EUR: 0.89, GBP: 0.74 } });
ok(fx.usdInr === 94.83 && fx.fx.AED === 3.6725 && fx.fx.EUR === 0.89, "daily $ rates (AED by its peg)");
ok(R.parseIbja('<span id="GoldRatesCompare999">13758</span><span id="GoldRatesCompare995">13703</span>').gold999Inr10g === 137580, "IBJA ₹/g read as ₹/10 g");

// ── Checking and choosing
const sources = { ronak: r, goldapi: { goldUsdOz: 3944.2, silverUsdOz: 49.4, platinumUsdOz: 1403 }, fxdaily: { usdInr: 94.83 } };
let j = R.judge({ sources, settings: S, now: NOW });
ok(j.status === "live" && j.chosen.gold999Inr10g.source === "ronak" && j.chosen.platinumUsdOz.source === "goldapi", "all live: the dealer first, platinum from world spot", j.status);
j = R.judge({ sources: { ...sources, ronak: null }, settings: S, now: NOW, premium: { gold: 1.16, gap995: 900 } });
ok(j.status === "fallback" && j.chosen.goldUsdOz.source === "goldapi" && j.chosen.usdInr.source === "fxdaily", "the dealer down: world spot and the daily $ rate", j.reasons[0]);
ok(j.chosen.gold999Inr10g.source === "derived" && Math.abs(j.chosen.gold999Inr10g.value - Math.round(3944.2 / R.OZ * 10 * 94.83 * 1.16)) <= 1, "…gold in ₹ worked out from spot × ₹/$ × the dealer's usual premium", String(j.chosen.gold999Inr10g.value));
ok(j.chosen.gold995Inr10g.value === j.chosen.gold999Inr10g.value - 900, "…995 from 999 less the usual gap");
// Jump guard
const last = { gold999Inr10g: { value: 139304, at: new Date(NOW.getTime() - 60_000).toISOString() } };
j = R.judge({ sources: { ...sources, ronak: { ...r, gold999Inr10g: 145000 } }, last, settings: S, now: NOW, premium: { gold: 1.16 } });
ok(j.held.some(h => h.field === "gold999Inr10g" && /jumped/.test(h.why)) && j.chosen.gold999Inr10g.source !== "ronak", "a 4% jump: held, never used", j.held.map(h => h.why).join(";"));
j = R.judge({ sources: { ...sources, ronak: { ...r, goldUsdOz: 4100 } }, last: { goldUsdOz: { value: 3946, at: new Date(NOW.getTime() - 60_000).toISOString() } }, settings: S, now: NOW });
ok(j.chosen.goldUsdOz.source === "goldapi", "the dealer's spot far from world spot: world spot used");
j = R.judge({ sources: { ...sources, ronak: { ...r, usdInr: 9.4674 } }, settings: S, now: NOW });
ok(j.held.some(h => h.field === "usdInr" && /range/.test(h.why)) && j.chosen.usdInr.source === "fxdaily", "a ₹/$ of 9.47 (a slipped decimal): outside its range, held");
j = R.judge({ sources: { ronak: r }, stale: ["ronak"], last: { goldUsdOz: { value: 3940, at: NOW.toISOString() }, usdInr: { value: 94.6, at: NOW.toISOString() }, gold999Inr10g: { value: 139000, at: NOW.toISOString() } }, settings: S, now: NOW });
ok(j.status === "stale" && j.chosen.gold999Inr10g.source === "last", "the dealer frozen in market hours and nothing else: the last good rates, marked stale", j.status);
const sunday = new Date("2026-11-08T06:00:00Z");
j = R.judge({ sources: { goldapi: sources.goldapi, fxdaily: sources.fxdaily }, settings: S, now: sunday, premium: { gold: 1.16 } });
ok(j.status === "closed", "Sunday: market closed — not an alarm", j.status);
// By hand
const pin = R.cleanSettings({ override: { gold999Inr10g: 140000, usdInr: 95, until: new Date(Date.now() + 3600_000).toISOString() } });
j = R.judge({ sources, settings: pin, now: NOW });
ok(j.status === "manual" && j.chosen.gold999Inr10g.value === 140000 && j.chosen.usdInr.value === 95 && j.chosen.goldUsdOz.source === "ronak", "a rate pinned by hand wins (the rest stay live)");
ok(!R.cleanSettings({ override: { gold999Inr10g: 140000, until: "2020-01-01T00:00:00Z" } }).override, "a pin past its time is gone (back to live by itself)");
const man = R.cleanSettings({ mode: "manual", manual: { goldUsdOz: 3900, usdInr: 94, gold999Inr10g: 138000 } });
j = R.judge({ sources, settings: man, now: NOW });
ok(man.mode === "manual" && j.status === "manual" && j.chosen.goldUsdOz.value === 3900 && j.chosen.gold999Inr10g.value === 138000 && !Object.values(j.chosen).some(c => c.source === "ronak" || c.source === "goldapi"), "manual mode: only the typed rates — live sources never used");
ok(R.cleanSettings({ mode: "manual", manual: {} }).mode === "live", "manual mode with no rates typed: stays live (never prices from nothing)");
ok(!("goldUsdOz" in (R.cleanSettings({ mode: "manual", manual: { goldUsdOz: 5, usdInr: 94 } }).manual ?? {})), "a typed rate outside its range is refused");

// ── A few checks a day, at the set times (India time)
ok(JSON.stringify(S.times) === JSON.stringify(["10:00", "14:00", "18:00"]), "default: 10:00, 14:00 and 18:00");
const at = iso => new Date(iso);
ok(R.dueSlot(S, undefined, at("2026-11-04T04:35:00Z")) === "10:00", "10:05 India time, nothing fetched yet: the 10:00 check is due");
ok(R.dueSlot(S, "2026-11-04T04:31:00Z", at("2026-11-04T06:00:00Z")) === null, "11:30 after the 10:00 check: nothing due (no calls in between)");
ok(R.dueSlot(S, "2026-11-04T04:31:00Z", at("2026-11-04T08:31:00Z")) === "14:00", "14:01: the 14:00 check is due");
ok(R.dueSlot(S, "2026-11-04T12:31:00Z", at("2026-11-05T02:00:00Z")) === null, "07:30 the next morning: nothing until 10:00");
ok(JSON.stringify(R.cleanSettings({ times: ["09:30", "bad", "17:00", "09:30"] }).times) === JSON.stringify(["09:30", "17:00"]), "set times cleaned (no repeats, no bad ones)");
j = R.judge({ sources: { ...sources, ronak: { ...r, gold999Inr10g: 145000 } }, last: { gold999Inr10g: { value: 139304, at: new Date(NOW.getTime() - 4 * 3600_000).toISOString() } }, settings: S, now: NOW, premium: { gold: 1.16 } });
ok(j.held.some(h => h.field === "gold999Inr10g"), "a 4% move since the last check (hours ago) with no second source agreeing: held");
j = R.judge({ sources: { ...sources, ronak: { ...r, gold999Inr10g: 141000 } }, last: { gold999Inr10g: { value: 139304, at: new Date(NOW.getTime() - 4 * 3600_000).toISOString() } }, settings: S, now: NOW });
ok(j.chosen.gold999Inr10g.source === "ronak" && j.chosen.gold999Inr10g.value === 141000, "a normal 1.2% move over the day: used");

// ── Per gram of each karat
const p = { goldUsdOz: 3946.15, usdInr: 94.674, gold999Inr10g: 139304, gold995Inr10g: 138404, platinumUsdOz: 1403, silverUsdOz: 49.41, silverInrKg: 177763, at: NOW.toISOString() };
const k = Object.fromEntries(R.karatRates(p, S).map(x => [x.key, x]));
ok(Math.abs(k["24K"].inrPerG - 13930.4) < 0.5 && Math.abs(k["18K"].inrPerG - 13944.34 * 0.75) < 1, "₹/g: 999 rate ÷ 10 (24K) and × purity (18K)", `${k["24K"].inrPerG} / ${k["18K"].inrPerG}`);
ok(Math.abs(k["14K"].usdPerG - (3946.15 / R.OZ) * 0.585) < 0.01, "$/g for export: world spot ÷ 31.1035 × purity (no Indian duty)", String(k["14K"].usdPerG));
ok(k["PT950"].usdPerG > 0 && k["AG925"].inrPerG > 0, "platinum and silver per gram too");
const k995 = Object.fromEntries(R.karatRates(p, { ...S, base: "995" }).map(x => [x.key, x]));
ok(Math.abs(k995["24K"].inrPerG - (138404 / 10 / 0.995) * 0.999) < 0.5 && Math.abs(k995["18K"].inrPerG - (138404 / 10 / 0.995) * 0.75) < 0.5, "995 base: 995 ÷ 0.995 × purity", String(k995["24K"].inrPerG));
ok(!R.shouldReprice({ ...p }, { ...p, gold999Inr10g: 139400 }, 0.25) && R.shouldReprice({ ...p }, { ...p, gold999Inr10g: 139800 }, 0.25), "prices move only when a rate moves ≥ 0.25%");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
