// Money in any currency: how each one is written, how one turns into another,
// and the rates that do it. Lockers (bank and cash accounts) can hold any
// currency; clients are billed in USD; the books are kept in rupees.
//
// Pure — no database, no Firebase — so the server's shared code and the
// tests can use it too.

/** An ISO 4217 code: "INR", "USD", "AUD", "EUR"… */
export type CurrencyCode = string;

export interface CurrencyInfo {
  code: CurrencyCode;
  name: string;
  /** Written before the figure. Letters get a space after them ("AED 1,250"). */
  symbol: string;
  /** Places after the point, when the amount has them. */
  decimals: number;
  /** Roughly what one unit is worth in rupees. Only ever used to decide which
   *  way round a rate reads ("1 AUD = ₹55", not "1 ₹ = 0.018 AUD") — never
   *  to work out an amount. */
  approxInr: number;
}

/** The currencies offered when a locker is made, most used first. */
export const CURRENCIES: CurrencyInfo[] = [
  { code: "INR", name: "Indian rupee", symbol: "₹", decimals: 0, approxInr: 1 },
  { code: "USD", name: "US dollar", symbol: "$", decimals: 2, approxInr: 84 },
  { code: "AUD", name: "Australian dollar", symbol: "A$", decimals: 2, approxInr: 55 },
  { code: "CAD", name: "Canadian dollar", symbol: "C$", decimals: 2, approxInr: 61 },
  { code: "EUR", name: "Euro", symbol: "€", decimals: 2, approxInr: 90 },
  { code: "GBP", name: "British pound", symbol: "£", decimals: 2, approxInr: 106 },
  { code: "AED", name: "UAE dirham", symbol: "AED ", decimals: 2, approxInr: 23 },
  { code: "HKD", name: "Hong Kong dollar", symbol: "HK$", decimals: 2, approxInr: 10.8 },
  { code: "SGD", name: "Singapore dollar", symbol: "S$", decimals: 2, approxInr: 63 },
  { code: "CHF", name: "Swiss franc", symbol: "CHF ", decimals: 2, approxInr: 95 },
  { code: "NZD", name: "New Zealand dollar", symbol: "NZ$", decimals: 2, approxInr: 50 },
  { code: "JPY", name: "Japanese yen", symbol: "¥", decimals: 0, approxInr: 0.56 },
  { code: "CNY", name: "Chinese yuan", symbol: "CN¥", decimals: 2, approxInr: 11.6 },
  { code: "THB", name: "Thai baht", symbol: "฿", decimals: 2, approxInr: 2.4 },
  { code: "MYR", name: "Malaysian ringgit", symbol: "RM ", decimals: 2, approxInr: 18 },
  { code: "SAR", name: "Saudi riyal", symbol: "SAR ", decimals: 2, approxInr: 22 },
  { code: "QAR", name: "Qatari riyal", symbol: "QAR ", decimals: 2, approxInr: 23 },
  { code: "KWD", name: "Kuwaiti dinar", symbol: "KWD ", decimals: 3, approxInr: 273 },
  { code: "BHD", name: "Bahraini dinar", symbol: "BHD ", decimals: 3, approxInr: 223 },
  { code: "OMR", name: "Omani rial", symbol: "OMR ", decimals: 3, approxInr: 218 },
  { code: "ILS", name: "Israeli shekel", symbol: "₪", decimals: 2, approxInr: 22 },
  { code: "ZAR", name: "South African rand", symbol: "R ", decimals: 2, approxInr: 4.6 },
  { code: "TRY", name: "Turkish lira", symbol: "₺", decimals: 2, approxInr: 2.6 },
  { code: "BDT", name: "Bangladeshi taka", symbol: "৳", decimals: 2, approxInr: 0.7 },
  { code: "LKR", name: "Sri Lankan rupee", symbol: "LKR ", decimals: 2, approxInr: 0.28 },
  { code: "NPR", name: "Nepalese rupee", symbol: "NPR ", decimals: 2, approxInr: 0.63 },
];

/** The code a record means: unset is rupees, as every record made before lockers held dollars. */
export function ccy(code?: string | null): CurrencyCode {
  const c = (code || "INR").trim().toUpperCase();
  return c || "INR";
}

/** What we know about a currency — or a plain stand-in for one we don't list. */
export function ccyInfo(code?: string | null): CurrencyInfo {
  const c = ccy(code);
  return CURRENCIES.find(x => x.code === c) ?? { code: c, name: c, symbol: `${c} `, decimals: 2, approxInr: 1 };
}

export const ccySymbol = (code?: string | null) => ccyInfo(code).symbol;
export const isKnownCurrency = (code: string) => CURRENCIES.some(c => c.code === ccy(code));

/** The figure alone, grouped the currency's way (lakhs for rupees), with
 *  decimals only when the amount has them. */
export function fmtCcyNumber(n: number, code?: string | null): string {
  const info = ccyInfo(code);
  const scale = 10 ** info.decimals;
  const fraction = info.decimals > 0 && Math.round(Math.abs(n) * scale) % scale !== 0;
  return Math.abs(n).toLocaleString(info.code === "INR" ? "en-IN" : "en-US", {
    minimumFractionDigits: fraction ? info.decimals : 0,
    maximumFractionDigits: fraction ? info.decimals : 0,
  });
}

/** An amount in its currency: ₹1,23,456 · $1,234.56 · A$980 · AED 1,250. */
export function fmtCcy(n: number, code?: string | null): string {
  return `${n < 0 ? "-" : ""}${ccySymbol(code)}${fmtCcyNumber(n, code)}`;
}

/** The same, for a PDF: its font has no ₹, so rupees are "Rs.", and a symbol it
 *  may not draw is replaced by the code. */
export function fmtCcyPdf(n: number, code?: string | null): string {
  const c = ccy(code);
  const sign = n < 0 ? "-" : "";
  if (c === "INR") return `${sign}Rs. ${fmtCcyNumber(n, c)}`;
  if (c === "USD") return `${sign}$${fmtCcyNumber(n, c)}`;
  return `${sign}${c} ${fmtCcyNumber(n, c)}`;
}

/** Rounded the way the currency is counted (paise are not kept; cents are). */
export function roundCcy(n: number, code?: string | null): number {
  const s = 10 ** Math.max(2, ccyInfo(code).decimals);
  return Math.round(n * s) / s;
}

/** Amounts in several currencies, each kept apart: never add rupees to dollars. */
export function sumByCcy<T>(rows: T[], amount: (r: T) => number, code: (r: T) => string | undefined | null): Map<CurrencyCode, number> {
  const m = new Map<CurrencyCode, number>();
  for (const r of rows) { const c = ccy(code(r)); m.set(c, (m.get(c) ?? 0) + (amount(r) || 0)); }
  return m;
}

/** Rupees first, then dollars, then the rest A to Z. */
export function ccyOrder(a: string, b: string): number {
  const rank = (c: string) => (c === "INR" ? 0 : c === "USD" ? 1 : 2);
  return rank(a) - rank(b) || a.localeCompare(b);
}

/** Several currencies in one line: "₹84,910 + A$1,200". Empty → "₹0". */
export function fmtCcyMix(m: Map<CurrencyCode, number>, fallback: CurrencyCode = "INR"): string {
  const parts = [...m.entries()].filter(([, v]) => Math.abs(v) > 0.0001).sort(([a], [b]) => ccyOrder(a, b));
  if (!parts.length) return fmtCcy(0, fallback);
  return parts.map(([c, v]) => fmtCcy(v, c)).join(" + ");
}

/* ── Rates ──────────────────────────────────────────────────────────────────
   One way of writing a rate everywhere: `rate` = how many `to` one `from` buys.
   "1 AUD = 55.2 INR" is { from: "AUD", to: "INR", rate: 55.2 }. */

export interface FxQuote { from: CurrencyCode; to: CurrencyCode; rate: number }

/** The amount `amount` of `from` becomes in `to`. */
export function convertCcy(amount: number, rate: number): number {
  return amount * rate;
}

/**
 * The rate a recorded movement was made at, as "1 from = ? to". New records
 * carry `fx`; those from before every currency was possible carry only
 * `exchangeRate`, always rupees per dollar whichever way the money went.
 */
export function rateOf(t: { fx?: FxQuote; exchangeRate?: number }, from: string, to: string): number | undefined {
  const f = ccy(from), tt = ccy(to);
  if (f === tt) return 1;
  if (t.fx && t.fx.rate > 0) {
    if (ccy(t.fx.from) === f && ccy(t.fx.to) === tt) return t.fx.rate;
    if (ccy(t.fx.from) === tt && ccy(t.fx.to) === f) return 1 / t.fx.rate;
  }
  if (t.exchangeRate && t.exchangeRate > 0) {
    if (f === "USD" && tt === "INR") return t.exchangeRate;
    if (f === "INR" && tt === "USD") return 1 / t.exchangeRate;
  }
  return undefined;
}

/** What to write on a record: the rate itself, and — for rupees and dollars —
 *  the old rupees-per-dollar figure too, which older screens still read. */
export function rateFields(from: string, to: string, rate: number): { fx?: FxQuote; exchangeRate?: number } {
  const f = ccy(from), tt = ccy(to);
  if (f === tt || !(rate > 0)) return {};
  const fx = { from: f, to: tt, rate };
  // The old figure is ₹ per $ whichever way the money went — turned round when
  // it went rupees to dollars, and tidied so 85 is not kept as 85.00000000000001.
  const tidy = (n: number) => Number(n.toFixed(6));
  if (f === "USD" && tt === "INR") return { fx, exchangeRate: tidy(rate) };
  if (f === "INR" && tt === "USD") return { fx, exchangeRate: tidy(1 / rate) };
  return { fx };
}

/** Which way round a rate reads best: the dearer currency as the "1". */
export function rateReadsFrom(from: string, to: string): boolean {
  return ccyInfo(from).approxInr >= ccyInfo(to).approxInr;
}

/** A rate written the way people say it: "1 AUD = ₹55.20", "1 USD = A$1.52". */
export function rateText(from: string, to: string, rate: number): string {
  if (!(rate > 0)) return "";
  const forward = rateReadsFrom(from, to);
  const [one, other, r] = forward ? [ccy(from), ccy(to), rate] : [ccy(to), ccy(from), 1 / rate];
  return `1 ${one} = ${ccySymbol(other)}${fmtRate(r)}`;
}

/** A rate's figure: enough places to be exact, no trailing noise. */
export function fmtRate(r: number): string {
  const places = r >= 100 ? 2 : r >= 1 ? 4 : 6;
  return Number(r.toFixed(places)).toLocaleString("en-US", { maximumFractionDigits: places });
}

/* ── The rate table: rupees for one unit of each currency, by date ───────── */

export interface CurrencyRate {
  code: CurrencyCode;
  /** In force from this day (YYYY-MM-DD) until the next row for the same code. */
  from: string;
  /** ₹ for one unit. */
  inr: number;
}

/** Rupees for one unit of `code` on a day: the row in force then, else the
 *  earliest there is; rupees are always 1; undefined when nothing is known. */
export function inrPerUnit(table: CurrencyRate[] | undefined, code: string, iso?: string): number | undefined {
  const c = ccy(code);
  if (c === "INR") return 1;
  const rows = (table ?? []).filter(r => ccy(r.code) === c && r.inr > 0).sort((a, b) => a.from.localeCompare(b.from));
  if (!rows.length) return undefined;
  const day = (iso ?? new Date().toISOString()).slice(0, 10);
  let pick = rows[0];
  for (const r of rows) if (r.from <= day) pick = r;
  return pick.inr;
}

/** "1 from = ? to" from the table, through rupees. */
export function tableRate(table: CurrencyRate[] | undefined, from: string, to: string, iso?: string): number | undefined {
  if (ccy(from) === ccy(to)) return 1;
  const a = inrPerUnit(table, from, iso), b = inrPerUnit(table, to, iso);
  return a && b ? a / b : undefined;
}

/** Put a day's rates into the table, replacing any row for the same code and day. */
export function withRates(table: CurrencyRate[] | undefined, day: string, rates: Record<string, number>): CurrencyRate[] {
  const out = (table ?? []).filter(r => !(r.from === day && ccy(r.code) in rates));
  for (const [code, inr] of Object.entries(rates)) if (ccy(code) !== "INR" && inr > 0) out.push({ code: ccy(code), from: day, inr: Number(inr.toFixed(6)) });
  return out.sort((a, b) => a.code.localeCompare(b.code) || a.from.localeCompare(b.from));
}

/** Today's market rates, in rupees per unit, for the codes asked. From a free
 *  public service; nothing about the business is sent, only that it wants the
 *  rupee's rates. */
export async function fetchLiveRates(codes: string[]): Promise<Record<string, number>> {
  const res = await fetch("https://open.er-api.com/v6/latest/INR");
  if (!res.ok) throw new Error("The rates service did not answer — try again, or type the rate.");
  const j = await res.json() as { result?: string; rates?: Record<string, number> };
  if (j.result !== "success" || !j.rates) throw new Error("The rates service did not answer — try again, or type the rate.");
  const out: Record<string, number> = {};
  for (const c of codes.map(ccy)) {
    if (c === "INR") continue;
    const perInr = j.rates[c];
    if (perInr > 0) out[c] = 1 / perInr;
  }
  return out;
}
