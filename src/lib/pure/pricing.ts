// A catalogue design's price, from its sheet (grams by karat, stone rows), the
// options chosen on its product page (metal, colour, ring size, diamond type
// and quality, currency) and the business's pricing rules (Settings → Product
// pricing) — gold from the live rates (lib/pure/liveRates.ts), everything else
// from the rules. One file: the product page and, later, the server price the
// same way.
//
// Never a guess: a piece of the price that has no rule (a diamond quality with
// no price, a metal the sheet doesn't give and can't be worked out) is listed
// in `missing`, and the page shows "Price on request" instead of a wrong number.
//
// Plain functions, no imports beyond types.

import type { KaratRate } from "./liveRates";
import type { Specs, StoneRow } from "./specParse";

export type Ccy = "INR" | "USD";
/** An amount in the currency it was typed in. */
export interface Money { amount: number; ccy: Ccy }
/** The sheet's metal keys ("10K", "PLT", "SILVER") — the rates' are "10K", "PT950", "AG925". */
export type MetalKey = "9K" | "10K" | "14K" | "18K" | "22K" | "PLT" | "SILVER";
export const METALS: MetalKey[] = ["9K", "10K", "14K", "18K", "22K", "PLT", "SILVER"];
export const RATE_KEY: Record<MetalKey, string> = { "9K": "9K", "10K": "10K", "14K": "14K", "18K": "18K", "22K": "22K", PLT: "PT950", SILVER: "AG925" };
export const METAL_LABEL: Record<MetalKey, string> = { "9K": "9K gold", "10K": "10K gold", "14K": "14K gold", "18K": "18K gold", "22K": "22K gold", PLT: "Platinum", SILVER: "Silver" };
const family = (k: MetalKey): "gold" | "platinum" | "silver" => (k === "PLT" ? "platinum" : k === "SILVER" ? "silver" : "gold");

export interface DiamondQuality { id: string; label: string }
export interface PriceRules {
  /** Metals offered on the product page (each needs its grams on the sheet, or worked out from another). */
  metals: MetalKey[];
  /** Colours offered; a colour's own charge (white: rhodium) per piece. */
  colours: { id: string; label: string; charge?: Money }[];
  /** Metal lost in making, added to the weight charged (% by metal). */
  lossPct: { gold: number; platinum: number; silver: number };
  /** Grams for a metal the sheet doesn't give, from one it does: by density (g/cm³). Off: only the sheet's metals. */
  deriveMissing: boolean;
  density: Record<MetalKey, number>;
  ring: {
    /** The size the sheet's grams are for, when the sheet doesn't say (US). */
    baseUs: number;
    /** Each US size up or down changes the metal by this %. */
    pctPerSize: number;
    /** The US sizes offered. */
    sizes: number[];
  };
  /** Making charge by metal: per gram, never below the minimum (each in ₹ or $). */
  labour: Record<"gold" | "platinum" | "silver", { perGram: Money; minimum: Money }>;
  /** Setting each stone. */
  settingPerStone: Money;
  diamonds: {
    types: { id: string; label: string }[];
    qualities: DiamondQuality[];
    /** Size bands by carats per stone (upper bounds, rising): 0.009 → "up to 0.009 ct each". */
    bands: number[];
    /**
     * $ per carat: prices[type][quality][band's upper bound, as text] — kept by the band's
     * size, so adding or removing a band never moves a price to another size. A 0 or a
     * gap is "no price yet".
     */
    prices: Record<string, Record<string, Record<string, number>>>;
    /** Shapes other than round cost this % more (or less, below 0). */
    fancyPct: number;
  };
  /** Gemstones (shapes the sheet names as gems), $ per carat. */
  gemPerCt: number;
  /** A certificate for any one stone this big or bigger (ct), per stone. */
  certificate: { minCt: number; fee: Money };
  /** Per piece: hallmarking (India), packing. */
  extras: { label: string; fee: Money; india?: boolean }[];
  /** Profit on everything, %; rounded up to this step. */
  marginPct: number;
  roundTo: Record<Ccy, number>;
  /** GST on India prices, shown on its own. */
  gstPct: number;
  /** Clients: their own margin, currency, and what they see (price, or details only with "ask for a price"). */
  clients: Record<string, { see: "price" | "details"; marginPct?: number; ccy?: Ccy }>;
  /** A client with no line of their own. */
  clientDefault: "price" | "details";
  /** Design letters → category, for designs no folder names ("SRG" → "Ring"). */
  categoryByPrefix: Record<string, string>;
  /**
   * The centre stone — the biggest stone of a design (a few pieces at most, at
   * least `minCt` each) — in the size the buyer picks: one of `sizes`, or as drawn.
   */
  centre: { minCt: number; maxPcs: number; sizes: number[] };
}

export const DEFAULT_RULES: PriceRules = {
  metals: ["10K", "14K", "18K", "PLT"],
  colours: [{ id: "Y", label: "Yellow" }, { id: "W", label: "White" }, { id: "R", label: "Rose" }],
  lossPct: { gold: 0, platinum: 0, silver: 0 },
  deriveMissing: true,
  // g/cm³ (typical alloys): 9K 11.2, 10K 11.6, 14K 13.1, 18K 15.6, 22K 17.8, Pt950 21.4, Ag925 10.4.
  density: { "9K": 11.2, "10K": 11.6, "14K": 13.1, "18K": 15.6, "22K": 17.8, PLT: 21.4, SILVER: 10.4 },
  ring: { baseUs: 7, pctPerSize: 2.5, sizes: [3, 3.5, 4, 4.5, 5, 5.5, 6, 6.5, 7, 7.5, 8, 8.5, 9, 9.5, 10, 10.5, 11, 11.5, 12, 12.5, 13] },
  labour: {
    gold: { perGram: { amount: 0, ccy: "INR" }, minimum: { amount: 0, ccy: "INR" } },
    platinum: { perGram: { amount: 0, ccy: "INR" }, minimum: { amount: 0, ccy: "INR" } },
    silver: { perGram: { amount: 0, ccy: "INR" }, minimum: { amount: 0, ccy: "INR" } },
  },
  settingPerStone: { amount: 0, ccy: "INR" },
  diamonds: {
    types: [{ id: "natural", label: "Natural" }, { id: "lab", label: "Lab-grown" }],
    qualities: [{ id: "EF-VVS", label: "EF · VVS" }, { id: "FG-VS", label: "FG · VS" }, { id: "GH-SI", label: "GH · SI" }],
    bands: [0.009, 0.03, 0.07, 0.14, 0.22, 0.29, 0.39, 0.49, 0.69, 0.89, 0.99, 1.49, 1.99, 2.99, 99],
    prices: {},
    fancyPct: 0,
  },
  gemPerCt: 0,
  certificate: { minCt: 0.5, fee: { amount: 0, ccy: "USD" } },
  extras: [],
  marginPct: 0,
  roundTo: { INR: 100, USD: 5 },
  gstPct: 3,
  clients: {},
  clientDefault: "details",
  categoryByPrefix: {},
  centre: { minCt: 0.3, maxPcs: 2, sizes: [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3, 3.5, 4, 5] },
};

/** A size band's key in the price grid: its upper bound ("0.03"). */
export const bandKey = (upTo: number) => String(Math.round(upTo * 1e4) / 1e4);
/** The grid as kept: by band size; an old grid by band position is read by the bands of its time. */
function cleanGrid(x: unknown, bands: number[]): PriceRules["diamonds"]["prices"] {
  const out: PriceRules["diamonds"]["prices"] = {};
  if (!x || typeof x !== "object") return out;
  for (const [t, qs] of Object.entries(x as Record<string, unknown>)) {
    if (!qs || typeof qs !== "object") continue;
    out[t] = {};
    for (const [q, row] of Object.entries(qs as Record<string, unknown>)) {
      const cells: Record<string, number> = {};
      if (Array.isArray(row)) row.forEach((v, i) => { const n = Number(v); if (bands[i] !== undefined && n > 0) cells[bandKey(bands[i])] = n; });
      else if (row && typeof row === "object") for (const [k, v] of Object.entries(row)) { const n = Number(v); if (n > 0 && Number(k) > 0) cells[bandKey(Number(k))] = n; }
      out[t][q] = cells;
    }
  }
  return out;
}

/** Saved rules made whole: whatever is missing or not a number takes its default. */
export function cleanRules(x: unknown): PriceRules {
  const r = (x ?? {}) as Partial<PriceRules>;
  const num = (v: unknown, d: number, lo = 0, hi = 1e9) => { const n = Number(v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };
  const money = (m: unknown, d: Money): Money => { const o = (m ?? {}) as Partial<Money>; return { amount: num(o.amount, d.amount), ccy: o.ccy === "USD" ? "USD" : o.ccy === "INR" ? "INR" : d.ccy }; };
  const D = DEFAULT_RULES;
  const lab = (k: "gold" | "platinum" | "silver") => ({ perGram: money(r.labour?.[k]?.perGram, D.labour[k].perGram), minimum: money(r.labour?.[k]?.minimum, D.labour[k].minimum) });
  const dia = r.diamonds ?? ({} as Partial<PriceRules["diamonds"]>);
  return {
    metals: Array.isArray(r.metals) ? r.metals.filter((m): m is MetalKey => METALS.includes(m as MetalKey)) : D.metals,
    colours: Array.isArray(r.colours) ? r.colours.filter(c => c && c.id && c.label).map(c => ({ id: String(c.id), label: String(c.label), ...(c.charge ? { charge: money(c.charge, { amount: 0, ccy: "INR" }) } : {}) })) : D.colours,
    lossPct: { gold: num(r.lossPct?.gold, 0, 0, 50), platinum: num(r.lossPct?.platinum, 0, 0, 50), silver: num(r.lossPct?.silver, 0, 0, 50) },
    deriveMissing: r.deriveMissing !== false,
    density: Object.fromEntries(METALS.map(k => [k, num(r.density?.[k], D.density[k], 1, 30)])) as Record<MetalKey, number>,
    ring: {
      baseUs: num(r.ring?.baseUs, D.ring.baseUs, 1, 16), pctPerSize: num(r.ring?.pctPerSize, D.ring.pctPerSize, 0, 20),
      sizes: Array.isArray(r.ring?.sizes) && r.ring!.sizes.length ? r.ring!.sizes.map(Number).filter(n => n > 0 && n < 20).sort((a, b) => a - b) : D.ring.sizes,
    },
    labour: { gold: lab("gold"), platinum: lab("platinum"), silver: lab("silver") },
    settingPerStone: money(r.settingPerStone, D.settingPerStone),
    diamonds: {
      types: Array.isArray(dia.types) && dia.types.length ? dia.types : D.diamonds.types,
      qualities: Array.isArray(dia.qualities) && dia.qualities.length ? dia.qualities : D.diamonds.qualities,
      bands: Array.isArray(dia.bands) && dia.bands.length ? dia.bands.map(Number).filter(n => n > 0).sort((a, b) => a - b) : D.diamonds.bands,
      prices: cleanGrid(dia.prices, Array.isArray(dia.bands) && dia.bands.length ? dia.bands.map(Number) : D.diamonds.bands),
      fancyPct: num(dia.fancyPct, 0, -90, 500),
    },
    gemPerCt: num(r.gemPerCt, 0),
    certificate: { minCt: num(r.certificate?.minCt, D.certificate.minCt, 0, 100), fee: money(r.certificate?.fee, D.certificate.fee) },
    extras: Array.isArray(r.extras) ? r.extras.filter(e => e && e.label).map(e => ({ label: String(e.label), fee: money(e.fee, { amount: 0, ccy: "INR" }), ...(e.india ? { india: true } : {}) })) : [],
    marginPct: num(r.marginPct, 0, -90, 1000),
    roundTo: { INR: num(r.roundTo?.INR, D.roundTo.INR, 0, 100000), USD: num(r.roundTo?.USD, D.roundTo.USD, 0, 10000) },
    gstPct: num(r.gstPct, D.gstPct, 0, 50),
    clients: Object.fromEntries(Object.entries(r.clients && typeof r.clients === "object" ? r.clients : {}).filter(([id, c]) => id && c && typeof c === "object").map(([id, c]) => [id, {
      see: c.see === "price" ? "price" as const : "details" as const,
      ...(c.marginPct !== undefined && Number.isFinite(Number(c.marginPct)) ? { marginPct: num(c.marginPct, 0, -90, 1000) } : {}),
      ...(c.ccy === "INR" || c.ccy === "USD" ? { ccy: c.ccy } : {}),
    }])),
    clientDefault: r.clientDefault === "price" ? "price" : "details",
    categoryByPrefix: r.categoryByPrefix && typeof r.categoryByPrefix === "object" ? r.categoryByPrefix : {},
    centre: {
      minCt: num(r.centre?.minCt, D.centre.minCt, 0.01, 50), maxPcs: Math.round(num(r.centre?.maxPcs, D.centre.maxPcs, 1, 10)),
      sizes: Array.isArray(r.centre?.sizes) ? [...new Set(r.centre!.sizes.map(Number).filter(n => n > 0 && n < 100))].sort((a, b) => a - b) : D.centre.sizes,
    },
  };
}

/* ── What a design is ── */

const CATEGORY_WORDS: [RegExp, string][] = [
  [/\bBANDS?\b/, "Band"], [/\bRINGS?\b/, "Ring"], [/\bBR[AE]?C?E?LE?T/, "Bracelet"], [/\bBANGLE/, "Bangle"],
  [/\bSTUD/, "Earring"], [/\bEAR\s?RINGS?\b|\bEARRING/, "Earring"], [/\bPEND[AE]NT/, "Pendant"], [/\bN[AE]CK?LACE|\bNECKLESS/, "Necklace"],
  [/\bNOSE\s?PIN/, "Nose pin"], [/\bCHAIN/, "Chain"], [/\bANKLET/, "Anklet"], [/\bBROOCH/, "Brooch"],
];
/** A design's kind of piece: from the nearest folder named as one ("Ring", "Nacklace"), else its letters (Settings), else unknown. */
export function categoryOf(folderNames: string[], designNo: string, rules: Pick<PriceRules, "categoryByPrefix">): string | undefined {
  for (const n of folderNames) { const u = ` ${n.toUpperCase()} `; for (const [re, c] of CATEGORY_WORDS) if (re.test(u)) return c; }
  const pre = /^([A-Z]{1,5})/.exec(designNo.toUpperCase())?.[1];
  return pre ? rules.categoryByPrefix[pre] : undefined;
}
export const takesRingSize = (category?: string) => category === "Ring" || category === "Band";

/** The ring size the sheet's grams are for (US): "6.75 US", or a size in mm round ("53" / "53 EU" — the inside circumference). */
export function sheetRingUs(specs: Partial<Pick<Specs, "ringSize">>): number | undefined {
  const m = /^(\d+(?:\.\d+)?)\s*(US|UK|IN|EU)?$/.exec(String(specs.ringSize ?? "").trim());
  if (!m) return undefined;
  const v = Number(m[1]);
  if (m[2] === "US" || (!m[2] && v < 16)) return v;
  if (m[2] === "EU" || (!m[2] && v >= 38 && v <= 80)) return usFromCircumference(v);
  return undefined;
}
/** US size from an inside circumference in mm (an EU size is the circumference), to the nearest quarter. */
export function usFromCircumference(mm: number): number {
  return Math.round(((mm / Math.PI - 11.63) / 0.8128) * 4) / 4;
}
/** UK letters by US size (the usual conversion chart). */
const UK: Record<string, string> = {
  "3": "F", "3.5": "G", "4": "H", "4.5": "I", "5": "J½", "5.5": "K½", "6": "L½", "6.5": "M½", "7": "N½", "7.5": "O½", "8": "P½", "8.5": "Q½",
  "9": "R½", "9.5": "S½", "10": "T½", "10.5": "U½", "11": "V½", "11.5": "W½", "12": "X½", "12.5": "Z", "13": "Z+1",
};
/** A ring size chart row for a US size: UK letter, EU (inside circumference, mm), inside diameter (mm). */
export function ringChart(us: number): { us: number; uk: string; eu: number; diameterMm: number } {
  const d = 11.63 + 0.8128 * us;
  return { us, uk: UK[String(us)] ?? "—", eu: Math.round(d * Math.PI * 10) / 10, diameterMm: Math.round(d * 100) / 100 };
}

/* ── The price ── */

export interface Choice {
  metal: MetalKey;
  colour?: string;
  ringUs?: number;
  diamondType: string;
  quality: string;
  ccy: Ccy;
  /** Whose price: their own margin. */
  clientId?: string;
  /** The centre stone in this size (ct each); unset: as drawn. */
  centreCt?: number;
}
export interface Line { key: string; label: string; detail?: string; amount: number }
export interface Priced {
  ccy: Ccy;
  grams: number;
  gramsFrom: "sheet" | "worked out" | "none";
  lines: Line[];
  cost: number;
  marginPct: number;
  price: number;
  gst: number;
  /** What has no rule yet: no price is shown while this is not empty. */
  missing: string[];
  stones: { pcs: number; ct: number };
}

const GEMS = /RUBY|EMERALD STONE|SAPPHIRE|TANZANITE|AMETHYST|TOPAZ|GARNET|PERIDOT|CITRINE|AQUAMARINE|OPAL|PEARL|ONYX|GEM/i;

/** The grams of a metal: the sheet's own, or worked out from the nearest one it gives (by density). */
export function gramsFor(metal: Record<string, number>, k: MetalKey, rules: Pick<PriceRules, "deriveMissing" | "density">): { g: number; from: Priced["gramsFrom"] } {
  if (metal[k] > 0) return { g: metal[k], from: "sheet" };
  if (!rules.deriveMissing) return { g: 0, from: "none" };
  const have = METALS.filter(m => metal[m] > 0);
  if (!have.length) return { g: 0, from: "none" };
  // Gold from gold first (the nearest karat), then any.
  const pick = have.sort((a, b) => (family(a) === family(k) ? 0 : 1) - (family(b) === family(k) ? 0 : 1) || Math.abs(rules.density[a] - rules.density[k]) - Math.abs(rules.density[b] - rules.density[k]))[0];
  return { g: Math.round((metal[pick] * rules.density[k] / rules.density[pick]) * 1000) / 1000, from: "worked out" };
}

export function priceDesign(specs: Partial<Pick<Specs, "metal" | "stones" | "ringSize" | "stoneTotals" | "reasons">> & { status?: string; checkedBy?: unknown }, choice: Choice, rules: PriceRules, rates: { karat: KaratRate[]; usdInr: number } | null): Priced {
  const ccy = choice.ccy;
  const missing: string[] = [];
  // Never a price without all the stones: the sheet's own stone total more than the rows read, or its stones
  // waiting for a person's check — "Price on request" until they are read (or checked).
  const readCt = (specs.stones ?? []).reduce((t, r) => t + (r.total || 0), 0), readPcs = (specs.stones ?? []).reduce((t, r) => t + (r.pcs || 0), 0);
  const listed = specs.stoneTotals;
  if (listed && ((listed.ct || 0) > readCt + Math.max(0.011, readCt * 0.02) || (listed.pcs || 0) > readPcs)) missing.push(`all the stones (the sheet lists ${listed.pcs} pcs, ${listed.ct} ct; ${readPcs} pcs, ${Math.round(readCt * 1000) / 1000} ct read)`);
  if (specs.status === "review" && !specs.checkedBy && (specs.reasons ?? []).some(r => /stone/i.test(r))) missing.push("the stones checked (Catalog → Please check)");
  const lines: Line[] = [];
  const fx = rates?.usdInr ?? 0;
  /** Any amount in the price's currency. */
  const conv = (m: Money): number => {
    if (m.ccy === ccy || !m.amount) return m.amount;
    if (!fx) { missing.push("the ₹ / $ rate"); return 0; }
    return m.ccy === "USD" ? m.amount * fx : m.amount / fx;
  };
  const add = (key: string, label: string, amount: number, detail?: string) => { if (amount) lines.push({ key, label, amount: Math.round(amount * 100) / 100, ...(detail ? { detail } : {}) }); };

  // Metal.
  const base = gramsFor(specs.metal ?? {}, choice.metal, rules);
  let grams = base.g;
  if (!grams) missing.push(`${METAL_LABEL[choice.metal]} weight`);
  const sheetUs = sheetRingUs(specs) ?? rules.ring.baseUs;
  if (grams && choice.ringUs && choice.ringUs !== sheetUs) grams = grams * (1 + (rules.ring.pctPerSize / 100) * (choice.ringUs - sheetUs));
  grams = Math.round(grams * 1000) / 1000;
  const fam = family(choice.metal);
  const rate = rates?.karat.find(r => r.key === RATE_KEY[choice.metal]);
  const perG = rate ? (ccy === "INR" ? rate.inrPerG : rate.usdPerG) : 0;
  if (!perG) missing.push(`today's ${METAL_LABEL[choice.metal]} rate`);
  const charged = grams * (1 + rules.lossPct[fam] / 100);
  const sym = ccy === "INR" ? "₹" : "$";
  add("metal", METAL_LABEL[choice.metal], charged * perG, `${grams} g${rules.lossPct[fam] ? ` + ${rules.lossPct[fam]}% loss` : ""} × ${sym}${perG.toLocaleString("en-IN")}/g`);

  // Making.
  const lab = rules.labour[fam];
  const making = Math.max(conv(lab.perGram) * grams, conv(lab.minimum));
  add("labour", "Making", making, lab.perGram.amount ? `${grams} g × ${lab.perGram.ccy === "INR" ? "₹" : "$"}${lab.perGram.amount}/g${lab.minimum.amount ? `, at least ${lab.minimum.ccy === "INR" ? "₹" : "$"}${lab.minimum.amount}` : ""}` : undefined);

  // Stones — the centre stone in the size chosen.
  const rows: StoneRow[] = withCentre(specs.stones ?? [], choice.centreCt, rules);
  let pcs = 0, ct = 0, dia = 0, gem = 0;
  const prices = rules.diamonds.prices[choice.diamondType]?.[choice.quality] ?? {};
  for (const r of rows) {
    pcs += r.pcs; ct += r.total;
    if (!r.total) { missing.push(`${r.shape ?? "Stone"} × ${r.pcs}: no weight on the sheet`); continue; }
    // A weight with neither a count nor a size each: how big each stone is can't be known — never taken as one stone.
    if (!(r.pcs > 0) && !(r.perStone > 0)) { missing.push(`how many ${r.shape ?? "stones"} (${r.total} ct)`); continue; }
    if (r.shape && GEMS.test(r.shape)) {
      if (!rules.gemPerCt) missing.push("a gemstone price");
      gem += r.total * conv({ amount: rules.gemPerCt, ccy: "USD" });
      continue;
    }
    const each = r.perStone || r.total / Math.max(1, r.pcs);
    const band = rules.diamonds.bands.findIndex(b => each <= b + 1e-9);
    const usdCt = band >= 0 ? prices[bandKey(rules.diamonds.bands[band])] ?? 0 : 0;
    if (!usdCt) { missing.push(`a diamond price for ${each} ct stones (${choice.quality})`); continue; }
    const fancy = r.shape && !/^round$/i.test(r.shape) ? 1 + rules.diamonds.fancyPct / 100 : 1;
    dia += r.total * conv({ amount: usdCt * fancy, ccy: "USD" });
  }
  ct = Math.round(ct * 1000) / 1000;
  const type = rules.diamonds.types.find(t => t.id === choice.diamondType)?.label ?? choice.diamondType;
  const quality = rules.diamonds.qualities.find(q => q.id === choice.quality)?.label ?? choice.quality;
  add("diamonds", "Diamonds", dia, `${type} · ${quality} · ${ct} ct`);
  add("gems", "Gemstones", gem);
  add("setting", "Setting", pcs * conv(rules.settingPerStone), pcs && rules.settingPerStone.amount ? `${pcs} stones` : undefined);
  const certs = rules.certificate.minCt > 0 && rules.certificate.fee.amount > 0
    ? rows.filter(r => (r.perStone || (r.pcs ? r.total / r.pcs : 0)) >= rules.certificate.minCt).reduce((t, r) => t + r.pcs, 0) : 0;
  add("certificate", "Certificate", certs * conv(rules.certificate.fee), certs ? `${certs} stone${certs === 1 ? "" : "s"}` : undefined);

  // Colour, extras.
  // A colour (and its charge — rhodium for white) is gold's only.
  const col = fam === "gold" ? rules.colours.find(c => c.id === choice.colour) : undefined;
  if (col?.charge?.amount) add("colour", `${col.label} finish`, conv(col.charge));
  for (const e of rules.extras) if (!e.india || ccy === "INR") add(`x:${e.label}`, e.label, conv(e.fee));

  const cost = Math.round(lines.reduce((t, l) => t + l.amount, 0) * 100) / 100;
  const client = choice.clientId ? rules.clients[choice.clientId] : undefined;
  const marginPct = client?.marginPct ?? rules.marginPct;
  const step = rules.roundTo[ccy] || 0;
  const raw = cost * (1 + marginPct / 100);
  const price = step > 0 ? Math.ceil(raw / step) * step : Math.round(raw * 100) / 100;
  const gst = ccy === "INR" ? Math.round(price * rules.gstPct) / 100 : 0;
  return { ccy, grams, gramsFrom: base.from, lines, cost, marginPct, price, gst, missing: [...new Set(missing)], stones: { pcs, ct } };
}

/** What a client sees: the price, or the details with "ask for a price". Staff always see everything. */
export function clientSees(rules: PriceRules, clientId?: string): "price" | "details" {
  return (clientId && rules.clients[clientId]?.see) || rules.clientDefault;
}

/**
 * A design's price as a catalogue card shows it: the metal its sheet is drawn in
 * (the first offered that the sheet itself gives, else one worked out), the first
 * diamond type and quality, the first colour, at the size it is drawn — in this currency.
 */
export function defaultChoice(specs: Partial<Pick<Specs, "metal">>, rules: PriceRules, ccy: Ccy, clientId?: string): Choice | null {
  const metal = specs.metal ?? {};
  const pick = rules.metals.find(m => metal[m] > 0) ?? rules.metals.find(m => gramsFor(metal, m, rules).g > 0);
  if (!pick) return null;
  return {
    metal: pick, colour: rules.colours[0]?.id, diamondType: rules.diamonds.types[0]?.id ?? "natural", quality: rules.diamonds.qualities[0]?.id ?? "",
    ccy, ...(clientId ? { clientId } : {}),
  };
}

/** The centre stone of a design: its biggest stone, of a few pieces at most and big enough to be one. */
export function centreOf(stones: StoneRow[], rules: Pick<PriceRules, "centre">): { index: number; row: StoneRow } | null {
  let best = -1;
  stones.forEach((r, i) => {
    const each = r.perStone || (r.pcs ? r.total / r.pcs : 0);
    if (r.pcs >= 1 && r.pcs <= rules.centre.maxPcs && each >= rules.centre.minCt && (best < 0 || each > (stones[best].perStone || 0))) best = i;
  });
  return best < 0 ? null : { index: best, row: stones[best] };
}
/** The stones with the centre stone in the size chosen (each of its pieces that size). */
export function withCentre(stones: StoneRow[], centreCt: number | undefined, rules: Pick<PriceRules, "centre">): StoneRow[] {
  if (!centreCt || !(centreCt > 0)) return stones;
  const c = centreOf(stones, rules);
  if (!c) return stones;
  return stones.map((r, i) => (i === c.index ? { ...r, perStone: centreCt, total: Math.round(centreCt * r.pcs * 1000) / 1000 } : r));
}
/** The sizes a centre stone is offered in: the rules' sizes, and the size drawn. */
export function centreSizes(stones: StoneRow[], rules: Pick<PriceRules, "centre">): { drawn: number; sizes: number[]; shape?: string; pcs: number } | null {
  const c = centreOf(stones, rules);
  if (!c || !rules.centre.sizes.length) return null;
  const drawn = c.row.perStone || Math.round((c.row.total / c.row.pcs) * 1000) / 1000;
  return { drawn, sizes: [...new Set([...rules.centre.sizes, drawn])].sort((a, b) => a - b), shape: c.row.shape, pcs: c.row.pcs };
}
