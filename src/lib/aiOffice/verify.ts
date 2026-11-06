// Proven numbers: every figure the AI writes is checked against the figures the
// app's own tools gave it for that answer. A figure found there (as given, or
// rounded) is ✓; one that isn't is marked on the screen — it may be the AI's own
// sum, or a slip — so nobody acts on a number the records don't hold without
// knowing it. Order numbers and dates are not figures.

export interface Proof { checked: number; matched: number; unmatched: string[] }

/** Every number in a tool's answer: its values, and numbers written inside its words. */
function numbersIn(json: string, out: number[]): void {
  let v: unknown;
  try { v = JSON.parse(json); } catch { v = json; }
  const walk = (x: unknown) => {
    if (typeof x === "number" && Number.isFinite(x)) out.push(x);
    else if (typeof x === "string") for (const m of x.replace(/\b[A-Z]{2,6}-\d{4}-\d{2,6}\b/g, " ").matchAll(/-?\d[\d,]*(?:\.\d+)?/g)) { const n = Number(m[0].replace(/,/g, "")); if (Number.isFinite(n)) out.push(n); }
    else if (Array.isArray(x)) x.forEach(walk);
    else if (x && typeof x === "object") Object.values(x).forEach(walk);
  };
  walk(v);
}

/** The figures written in the answer: money, weights, percentages, counts of 10 or more — as written. */
function figuresIn(text: string): { raw: string; n: number }[] {
  const clean = text
    .replace(/\b[A-Z]{2,6}-\d{4}-\d{2,6}\b/g, " ")          // order numbers
    .replace(/\b\d{4}-\d{2}-\d{2}\b/g, " ")                  // dates
    .replace(/\b(19|20)\d{2}\b/g, " ");                      // years
  const out: { raw: string; n: number }[] = [];
  for (const m of clean.matchAll(/([$₹])?\s?(-?\d[\d,]*(?:\.\d+)?)\s?(k|K|L|lakh|cr)?(\s?%)?/g)) {
    const raw = m[0].trim();
    let n = Number(m[2].replace(/,/g, ""));
    if (!Number.isFinite(n)) continue;
    const mult = m[3] === "k" || m[3] === "K" ? 1e3 : m[3] === "L" || m[3] === "lakh" ? 1e5 : m[3] === "cr" ? 1e7 : 1;
    n *= mult;
    // Small plain counts ("3 orders", "top 5") prove nothing either way.
    if (!m[1] && !m[4] && !m[2].includes(".") && mult === 1 && Math.abs(n) < 10) continue;
    out.push({ raw, n });
  }
  return out;
}

const close = (a: number, b: number) => {
  if (a === b) return true;
  const d = Math.abs(a - b);
  if (d <= Math.max(0.011, Math.abs(b) * 0.005)) return true;          // rounding to cents, or within 0.5%
  return Math.round(b) === Math.round(a) || Math.round(b * 10) / 10 === a || Math.abs(Math.abs(a) - Math.abs(b)) < 0.011;
};

/** Check an answer against the tool answers it was written from. */
export function proveNumbers(text: string, toolAnswers: string[]): Proof {
  const known: number[] = [];
  for (const t of toolAnswers) numbersIn(t, known);
  const figs = figuresIn(text);
  const unmatched: string[] = [];
  let matched = 0;
  for (const f of figs) {
    if (known.some(k => close(f.n, k) || close(-f.n, k))) matched++;
    else if (!unmatched.includes(f.raw)) unmatched.push(f.raw);
  }
  return { checked: figs.length, matched, unmatched };
}
