// Reading a design sheet's printed spec table from its OCR text — the rules,
// apart from the OCR itself (functions-specs runs tesseract; this file is
// shared so the app shows the same names). Works on any of the sheet layouts
// (SHAPE / SIEVE / MM / PTS / QTY / WEIGHT; Sieve Size / Weight (Carat) / DIA
// (mm) / PCs / Total Weight; DIA WT/PC / DIA PCS / DIA WT …) without trusting
// the column order: in each stone row the numbers that fit
//     pieces × weight per stone = row weight
// are those three — the rest is the stone's size and sieve. Gold weights by
// karat, the totals, sizes in mm and the ring size are read the same way, and
// every reading is checked (rows add up to the total, gold weights rise from
// silver to platinum). Anything that doesn't fit is said, for a person to check.
//
// Since version 6 the stones come first from the table reader (tableRead.ts) — each table's
// columns found by their headings and their words' places, any designer's layout — with
// these word rules beside it; the reading whose rows add up to the sheet's own totals is kept.
//
// Plain functions; the table reader beside it is the only import.
import { readStoneLines, readStoneTables, tablesText, type TTable } from "./tableRead";

export const PARSER_VERSION = 6;

/** What the server read off a sheet (functions-specs/src/ocr.ts): its words, and since OCR 2 its tables and lines with places. */
export interface SheetText { page: string; table?: string; grids?: TTable[]; lines?: TTable; /** the picture's width (the lines are on an enlarged copy) */ w?: number }

export interface StoneRow { shape?: string; sieve?: string; size?: string; pcs: number; perStone: number; total: number }
export interface Specs {
  v: number;
  status: "ok" | "review" | "noTable";
  designNo?: string;
  designNoSource?: "folder" | "file" | "ocr";
  /** The design number printed in the table, when it disagrees with the folder's / file's. */
  designNoPrinted?: string;
  stones: StoneRow[];
  stoneTotals?: { pcs: number; ct: number };
  /** Grams of metal by karat: "10K", "14K", "18K", "22K", "PLT", "SILVER". */
  metal: Record<string, number>;
  metalTone?: string;
  dimsMm: number[];
  ringSize?: string;
  subCategory?: string;
  castingPcs?: string;
  reasons: string[];
  /** Worth knowing, not wrong: a stone the sheet gives no weight for, say. */
  notes?: string[];
  /** The sheet's own code beside the metal (SR, SD …). */
  code?: string;
}

const SHAPES: Record<string, string> = {
  RND: "Round", ROUND: "Round", RD: "Round", BR: "Round", EMR: "Emerald", EM: "Emerald", EMERALD: "Emerald", PRS: "Princess", PR: "Princess", PRINCESS: "Princess",
  OVL: "Oval", OV: "Oval", OVAL: "Oval", PEAR: "Pear", PER: "Pear", PS: "Pear", MQ: "Marquise", MAR: "Marquise", MARQUISE: "Marquise", CUS: "Cushion", CU: "Cushion", CUSHION: "Cushion",
  RAD: "Radiant", RADIANT: "Radiant", HRT: "Heart", HEART: "Heart", ASH: "Asscher", ASSCHER: "Asscher", BAG: "Baguette", BAGUETTE: "Baguette", TBAG: "Tapered baguette", TPR: "Tapered baguette",
  TRI: "Trillion", TRILLION: "Trillion", HALFMOON: "Half moon", HM: "Half moon", OEC: "Old European", ROSE: "Rose cut",
};
const KARATS = new Set([9, 10, 14, 18, 22, 24]);

const n = (s: string) => { const v = Number(s.replace(/,/g, ".").replace(/^\./, "0.")); return Number.isFinite(v) ? v : NaN; };
const r3 = (x: number) => Math.round(x * 1000) / 1000;

/** A design number from a folder or file name: "SLR-000944A", "SRG0034 B.jpg" → SRG0034, "LP-0883". */
export function designFromName(name: string | undefined): string | undefined {
  const base = String(name ?? "").replace(/\.[a-z0-9]{2,4}$/i, "").toUpperCase();
  const m = /\b([A-Z]{1,5})[-_ ]?(\d{2,7})([A-Z]{0,3})\b/.exec(base.replace(/[@()]/g, " "));
  if (!m) return undefined;
  // Keep the business's own form ("SLR-000944A", "SRG0034"): the dash only where it was written.
  const dash = new RegExp(`${m[1]}-${m[2]}`).test(base) ? "-" : "";
  return `${m[1]}${dash}${m[2]}${m[3]}`;
}
/** The same design, allowing the usual OCR slips (O↔0, I/L↔1, one letter more or less): "SNLO194" = "SNL0194". */
const norm = (s: string) => s.replace(/[^A-Z0-9]/g, "").replace(/O/g, "0").replace(/[IL]/g, "1");
export function sameDesign(a?: string, b?: string): boolean {
  if (!a || !b) return false;
  const x = norm(a), y = norm(b);
  if (x === y) return true;
  if (Math.abs(x.length - y.length) > 1) return false;
  // One letter different / extra / missing.
  let i = 0, j = 0, diff = 0;
  while (i < x.length && j < y.length) {
    if (x[i] === y[j]) { i++; j++; continue; }
    if (++diff > 1) return false;
    if (x.length > y.length) i++; else if (y.length > x.length) j++; else { i++; j++; }
  }
  return diff + (x.length - i) + (y.length - j) <= 1;
}

/** Tokens of the OCR text, with the usual misreads mended (O→0 in numbers, ",→." in decimals). */
function tokens(text: string): string[] {
  return text.replace(/HALF\s+MOON/gi, "HALFMOON").replace(/TAPERED\s+BAG(UETTE)?/gi, "TBAG").replace(/[|[\]{}“”"'’`~]/g, " ").replace(/(\d)\s*[xX×*]\s*(\d)/g, "$1x$2").replace(/(\d)\s*-\s*(\d)/g, "$1-$2")
    .split(/\s+/).map(t => t.replace(/^[^\w+.*-]+|[^\w.*%-]+$/g, "")).filter(Boolean)
    .map(t => (/^[\dOo.,]+$/.test(t) && /\d/.test(t) ? t.replace(/[Oo]/g, "0").replace(/,/g, ".") : t));
}
const isInt = (t: string) => /^\d{1,4}$/.test(t);
/** A stone's size among a row's words: "5.9X5.93", "1.40-1.45", "4.5MM", or a length and width ("10.75 5.03") / one diameter ("6.54"). */
function sizeOf(ws: string[]): string | undefined {
  const x = ws.find(t => /\d\s*x\s*\d|^\d+(\.\d+)?-\d+(\.\d+)?$|MM$/i.test(t) && !/^[+-]/.test(t));
  if (x) return x.replace(/MM$/i, "");
  const decs = ws.filter(t => /^\d{1,2}\.\d{1,2}$/.test(t) && Number(t) >= 0.5 && Number(t) <= 40);
  return decs.length >= 2 ? `${decs[0]}x${decs[1]}` : decs.length === 1 ? decs[0] : undefined;
}
const isDec = (t: string) => /^\d{0,3}\.\d{1,4}$/.test(t);

type Ctx = { folderName?: string; fileName?: string };
/** What one text says, before it is checked. */
interface Parts {
  printed?: string; designNo?: string; designNoSource?: Specs["designNoSource"]; fromFile?: string;
  anchors: number; hasGold: boolean; stoneCols: boolean; noStone: boolean;
  metal: Record<string, number>; tone?: string; code?: string;
  rows: StoneRow[]; notes: string[]; stoneTotals?: Specs["stoneTotals"]; diaCts?: string;
  dims: number[]; ring?: string; subCategory?: string; castingPcs?: string;
}

/** One text read and checked. */
export function parseSpecs(text: string, ctx: Ctx = {}): Specs {
  return finish(extract(text, ctx));
}

/**
 * A sheet read twice — the whole page, and its table cut out and enlarged — as
 * one reading: the stones from whichever read them (rows that make their own
 * total first), the gold from both (the one with more karats first, the other
 * filling gaps), the rest from the page; then checked as one. Either reading
 * alone can miss what the other caught (a row the cut-out left off, a karat
 * the page blurred).
 */
export function parseBoth(page: string, table: string | undefined, ctx: Ctx = {}): Specs {
  return parseSheet({ page, table }, ctx);
}

/**
 * A sheet as one reading from everything read off it: the stones from whichever reading's rows make
 * their own total (the table reader's first when they agree — it knows each column; else the word
 * rules' readings of the page and the enlarged table; else the page's lines read row by row), the
 * gold from all of them (the one with more karats first, the others filling gaps when they fit), the
 * rest from the page.
 */
export function parseSheet(t: SheetText, ctx: Ctx = {}): Specs {
  const a = extract(t.page, ctx);
  const b = t.table ? extract(t.table, ctx) : undefined;
  const c = t.grids?.length ? extract(tablesText(t.grids), ctx) : undefined;
  if (!b && !c && !t.lines) return finish(a);
  const near = (x: number, y: number) => Math.abs(x - y) <= Math.max(0.011, y * 0.02);
  const fits = (p: Parts, o: Parts) => {
    if (!p.rows.length) return 0;
    const pcs = p.rows.reduce((t, r) => t + r.pcs, 0), ct = r3(p.rows.reduce((t, r) => t + r.total, 0));
    const own = (!p.stoneTotals || (p.stoneTotals.pcs === pcs && near(p.stoneTotals.ct, ct))) && (!p.diaCts || near(n(p.diaCts), ct)
      // A table's border read as a leading "1" ("|0.54" → "10.54"): the same total.
      || (/^1\d*\.\d+$/.test(p.diaCts) && near(n(p.diaCts.slice(1)), ct)));
    // The other reading's total agreeing is a second witness.
    const other = (o.stoneTotals && o.stoneTotals.pcs === pcs && near(o.stoneTotals.ct, ct)) || (o.diaCts && near(n(o.diaCts), ct));
    return (own ? 1000 : 0) + (other ? 300 : 0) + p.rows.length;
  };
  const words = [a, ...(b ? [b] : []), ...(c ? [c] : [])];
  // The sheet's grand total ("Total Dia. Cts 0.54"), from whichever reading saw it — a witness for every reading.
  const diaCts = a.diaCts ?? b?.diaCts ?? c?.diaCts;
  const cands: { p: Parts; grid: boolean }[] = [{ p: a, grid: false }, ...(b ? [{ p: b, grid: false }] : [])];
  let listed = 0;
  if (t.grids?.length) {
    // The page's lines on the tables' scale (they were read off a copy enlarged to lines.x1 wide).
    const k = t.lines && t.w && t.lines.x1 ? t.w / t.lines.x1 : 1;
    const above = (t.lines?.rows ?? []).map(r => ({ w: r.w.map(w => ({ ...w, x0: w.x0 * k, x1: w.x1 * k, ...(w.y0 !== undefined ? { y0: w.y0 * k } : {}), ...(w.y1 !== undefined ? { y1: w.y1 * k } : {}) })) }));
    const g = readStoneTables(t.grids, above);
    listed = g.listed;
    if (g.rows.length) cands.push({ p: { ...a, rows: g.rows, notes: g.notes, stoneTotals: g.totals, diaCts }, grid: true });
  }
  if (t.lines?.rows.length) {
    // The page's lines read row by row — only when their rows make a total printed on the sheet: free text
    // holds sizes, gold and notes too, and a reading of it that nothing confirms is never taken.
    const l = readStoneLines(t.lines.rows);
    const lp: Parts = { ...a, rows: l.rows, notes: l.notes, stoneTotals: l.totals, diaCts };
    if (l.rows.length && (l.totals || diaCts) && (() => {
      const pcs = l.rows.reduce((u, r) => u + r.pcs, 0), ct = r3(l.rows.reduce((u, r) => u + r.total, 0));
      return (!!l.totals && l.totals.pcs === pcs && near(l.totals.ct, ct)) || (!!diaCts && near(n(diaCts), ct));
    })()) cands.push({ p: lp, grid: false });
  }
  // The stones' rows with their own totals (never a total borrowed from another reading); the others' totals a second witness.
  const others = (x: Parts) => cands.map(o => o.p).filter(o => o !== x);
  // A reading that truly matches a printed total beats one with no total to disagree with.
  const matches = (p: Parts) => {
    if (!p.rows.length) return false;
    const pcs = p.rows.reduce((u, r) => u + r.pcs, 0), ct = r3(p.rows.reduce((u, r) => u + r.total, 0));
    return (!!p.stoneTotals && p.stoneTotals.pcs === pcs && near(p.stoneTotals.ct, ct)) || (!!p.diaCts && near(n(p.diaCts), ct));
  };
  // Rows that make their own weight (a weight per stone × pieces = the row's): a row with no weight never outweighs one with.
  const weighed = (p: Parts) => p.rows.filter(r => r.total > 0 && r.perStone > 0 && Math.abs(r.pcs * r.perStone - r.total) <= Math.max(0.011, r.total * 0.03)).length;
  const score = (x: { p: Parts; grid: boolean }) => Math.max(0, ...others(x.p).map(o => fits(x.p, o)), fits(x.p, { ...x.p, stoneTotals: undefined, diaCts: undefined }))
    + (matches(x.p) ? 2000 : 0) + weighed(x.p) * 5 - x.p.rows.filter(r => !r.total).length * 5 + (x.grid ? 0.5 : 0);
  const S = cands.reduce((best, x) => (score(x) > score(best) ? x : best)).p;
  // The gold: the reading with more karats; a karat only another read is added when it fits
  // the rest (rising from silver to platinum, in the usual weight ratios) — never a stray number.
  const goldScore = (p: Parts) => (metalFits(p.metal) ? 100 : 0) + Object.keys(p.metal).length;
  const M = words.reduce((best, x) => (goldScore(x) > goldScore(best) ? x : best));
  const metal = { ...M.metal };
  for (const o of words) if (o !== M) for (const [k, g] of Object.entries(o.metal)) if (metal[k] === undefined && metalFits({ ...metal, [k]: g })) metal[k] = g;
  const first = <T,>(f: (p: Parts) => T | undefined) => words.map(f).find(v => v !== undefined && !(Array.isArray(v) && !v.length));
  const out = finish({
    ...a,
    printed: first(p => p.printed),
    anchors: Math.max(...words.map(p => p.anchors)), hasGold: words.some(p => p.hasGold), stoneCols: words.some(p => p.stoneCols) || cands.some(x => x.grid), noStone: words.some(p => p.noStone),
    metal, tone: first(p => p.tone), code: first(p => p.code),
    rows: S.rows, notes: S.notes, stoneTotals: S.stoneTotals, diaCts: S.diaCts ?? diaCts,
    dims: first(p => (p.dims.length ? p.dims : undefined)) ?? [], ring: first(p => p.ring), subCategory: first(p => p.subCategory), castingPcs: first(p => p.castingPcs),
  });
  // Stones listed with neither pieces nor weight (an Oval · 5.78 × 7.81 table): a person says what they are.
  if (listed) { out.reasons.push(`${listed} stone${listed === 1 ? " is" : "s are"} listed without pieces or weight`); if (out.status === "ok") out.status = "review"; }
  return out;
}

function extract(text: string, ctx: Ctx): Parts {
  const T = tokens(text);
  const U = T.map(t => t.toUpperCase());
  const flat = ` ${U.join(" ")} `;

  // ── Design number: the folder (one folder per design), else the file name; the printed one cross-checks.
  const fromFolder = designFromName(ctx.folderName);
  const fromFile = designFromName(ctx.fileName);
  const printed = U.map(t => designFromName(t)).find(d => d && /\d{3,}/.test(d) && !/^(MM|US|KT|GM|PCS?)/.test(d) && (!fromFolder || sameDesign(d, fromFolder) || sameDesign(d, fromFile) || /^[A-Z]{2,5}-?\d{3,7}/.test(d)));
  const designNo = fromFolder ?? fromFile ?? printed;
  const designNoSource = fromFolder ? "folder" : fromFile ? "file" : printed ? "ocr" : undefined;

  // ── Is there a spec table at all?
  const anchors = ["SHAPE", "SIEVE", "PTS", "QTY", "QTY.", "PCS", "TOTAL", "WEIGHT", "METAL", "CASTING", "DIA"].filter(a => U.includes(a)).length;
  const hasGold = /\b(9|10|14|18|22|24)\s?K(T)?\b/.test(flat);

  // ── Gold by karat: "10k 8.00", "14KT 2.21 GM", "10 KT 1.30 GM"; silver and platinum.
  const metal: Record<string, number> = {};
  for (let i = 0; i < U.length; i++) {
    let k: number | undefined, j = i;
    const m1 = /^(\d{1,2})K(T)?[:\-.]*$/.exec(U[i]);
    if (m1) k = Number(m1[1]);
    else if (/^\d{1,2}$/.test(U[i]) && /^KT?[:\-.]*$/.test(U[i + 1] ?? "")) { k = Number(U[i]); j = i + 1; }
    else if (/^(SILVER|SLV|925)$/.test(U[i])) k = -1;
    else if (/^(PLT|PT|PT950|PLATINUM|PLAT)$/.test(U[i])) k = -2;
    if (k === undefined) continue;
    if (k > 0 && !KARATS.has(k)) continue;
    // The grams: the next number within two words (skipping "GM", ":-", "-").
    for (let q = j + 1; q <= j + 3 && q < U.length; q++) {
      if (isDec(U[q]) || /^\d{1,3}$/.test(U[q]) && /^GM?S?$/.test(U[q + 1] ?? "")) {
        const g = n(U[q]);
        const key = k === -1 ? "SILVER" : k === -2 ? "PLT" : `${k}K`;
        if (g > 0 && g < 500 && metal[key] === undefined) metal[key] = g;
        break;
      }
      if (/^\d{1,2}K(T)?$/.test(U[q])) break; // another karat first: no grams for this one
    }
  }
  const tone = /\b(YG|WG|RG|PG|YELLOW|WHITE|ROSE)\b/.exec(flat)?.[1];
  const code = /\b(SR|SD|CZ)\b/.exec(flat)?.[1];

  // ── Stone rows: pieces × weight per stone = row weight.
  const rows: StoneRow[] = [];
  const used = new Set<number>();
  let shape: string | undefined;
  const shapeAt: (string | undefined)[] = [];
  for (let i = 0; i < U.length; i++) { const s = SHAPES[U[i].replace(/[^A-Z]/g, "")]; if (s && U[i].length <= 9) shape = s; shapeAt[i] = shape; }
  for (let i = 0; i < U.length; i++) {
    if (used.has(i)) continue;
    if (/^TOTAL/.test(U[i])) continue;
    // A window of the next few words; one integer (pieces) and two decimals that fit.
    const win: number[] = [];
    for (let q = i; q < Math.min(U.length, i + 9); q++) { if (/^TOTAL/.test(U[q])) break; if (!used.has(q)) win.push(q); }
    let best: { p: number; a: number; b: number; err: number } | undefined;
    for (const p of win) {
      if (!isInt(U[p])) continue;
      const pcs = Number(U[p]);
      if (!(pcs >= 1 && pcs <= 2000)) continue;
      for (const a of win) {
        if (a === p || !isDec(U[a])) continue;
        const per = n(U[a]);
        if (!(per > 0 && per < 30)) continue;
        // In every layout the stone's own weight comes before the pieces, and the row's weight after them.
        if (a > p) continue;
        for (const b of win) {
          if (b === p || b === a || !(isDec(U[b]) || isInt(U[b]))) continue;
          const tot = n(U[b]);
          if (!(tot > 0) || b < p) continue;
          const err = Math.abs(pcs * per - tot);
          const tol = Math.max(0.011, tot * 0.03);
          // The closest fit; of equal fits, the tightest (the three nearest each other).
          const span = b - a;
          if (err <= tol && (!best || err < best.err - 1e-9 || (Math.abs(err - best.err) < 1e-9 && span < best.b - best.a))) best = { p, a, b, err };
        }
      }
    }
    if (!best || best.p < i && best.a < i) continue;
    // A single stone (pcs 1, per = total) only counts with a size or sieve beside it — never a stray "1 1.00".
    const span = [best.p, best.a, best.b];
    const lo = Math.min(...span), hi = Math.max(...span);
    const around = U.slice(Math.max(0, lo - 3), hi + 1).filter((_, q) => !span.includes(Math.max(0, lo - 3) + q));
    const sieve = around.find(t => /^[+-][\d.+-]+$|^\*{2,}$/.test(t));
    const size = sizeOf(around);
    // A shape word just before the row (RND, OVL, HALFMOON …).
    const shapeNear = U.slice(Math.max(0, lo - 4), lo).some(t => SHAPES[t.replace(/[^A-Z]/g, "")] && t.length <= 9);
    if (Number(U[best.p]) === 1 && Math.abs(n(U[best.a]) - n(U[best.b])) < 0.001 && !size && !sieve && !shapeNear) continue;
    rows.push({ shape: shapeAt[lo], ...(sieve ? { sieve } : {}), ...(size ? { size } : {}), pcs: Number(U[best.p]), perStone: r3(n(U[best.a])), total: r3(n(U[best.b])) });
    for (let q = lo; q <= hi; q++) used.add(q);
  }
  // Rows the sheet gives no weight for (0.000, or a dash): a shape, a size, and how many — kept, and said.
  const notes: string[] = [];
  for (let i = 0; i < U.length; i++) {
    const sh = SHAPES[U[i].replace(/[^A-Z]/g, "")];
    if (!sh || used.has(i) || U[i].length > 9) continue;
    const seg: number[] = [];
    for (let q = i + 1; q < Math.min(U.length, i + 9); q++) {
      if (/^TOTAL/.test(U[q]) || (SHAPES[U[q].replace(/[^A-Z]/g, "")] && U[q].length <= 9)) break;
      if (!used.has(q)) seg.push(q);
    }
    const zeros = seg.filter(q => /^0?\.0+$|^0$|^-$/.test(U[q]));
    const pcsAt = seg.filter(q => /^[1-9]\d{0,3}$/.test(U[q]));
    if (zeros.length >= 1 && pcsAt.length === 1) {
      const size = sizeOf(seg.filter(q => !zeros.includes(q) && q !== pcsAt[0]).map(q => U[q]));
      if (!size) continue;
      rows.push({ shape: sh, size, pcs: Number(U[pcsAt[0]]), perStone: 0, total: 0 });
      notes.push(`${sh} × ${U[pcsAt[0]]}: no weight on the sheet`);
      for (const q of [i, ...seg]) used.add(q);
    }
  }
  // Totals: "Total 26 0.10", "TOTAL 18 0.22", "Total Dia. Cts 0.54".
  let stoneTotals: Specs["stoneTotals"];
  for (let i = 0; i < U.length; i++) {
    if (!/^TOTAL$/.test(U[i])) continue;
    const pcs = U.slice(i + 1, i + 4).find(isInt), ct = U.slice(i + 1, i + 5).find(isDec);
    if (pcs && ct) { const t = { pcs: Number(pcs), ct: n(ct) }; stoneTotals = stoneTotals ? { pcs: stoneTotals.pcs + t.pcs, ct: r3(stoneTotals.ct + t.ct) } : t; }
  }
  const diaCts = /TOTAL DIA\.? ?CTS?\s+(\d*\.\d+)/.exec(flat)?.[1];

  // ── Sizes and ring size.
  const dims: number[] = [];
  for (const m of flat.matchAll(/(\d{1,3}\.\d{1,2})\s?MM\b/g)) { const v = n(m[1]); if (v > 0.3 && v < 400 && !dims.includes(v)) dims.push(v); }
  const ring = /(?:SIZE|NO)[-\s.:]*(\d{1,2}(?:\.\d{1,2})?)\s*[-.]?\s*(US|UK|IN|EU)\b/.exec(flat) ?? /\((\d{1,2}(?:\.\d{1,2})?)\s*(US)\)/.exec(` ${String(ctx.fileName ?? "").toUpperCase()} `);
  // "SIZ - 53", "SIZE 54": a ring size in mm round (the inside circumference — EU sizes), never a "54 MM" length.
  // Whole numbers only, and never followed by a decimal or a unit ("SIZE 45.00 MM", "54.5MM", "45 CM" are lengths).
  const mmSize = /\bSIZE?\s*[-:.]?\s*(\d{2})\b(?![.,]?\d|\s*(?:MM|CM|INCH|IN\b|"))/.exec(flat)?.[1];
  const ringMm = mmSize && n(mmSize) >= 38 && n(mmSize) <= 80 ? n(mmSize) : undefined;
  const subCategory = /SUB\.?\s?CTG\s*[:\-]*\s*([A-Z]{2,10})/.exec(flat)?.[1];
  const castingPcs = /CASTING\s+PCS\s*[:\-]*\s*(\d+\s?[A-Z]{2,4})/.exec(flat)?.[1]?.replace(/\s/g, "");
  return {
    printed, designNo, designNoSource, fromFile, anchors, hasGold,
    stoneCols: anchors >= 3 && /SHAPE|SIEVE|PTS|PCS/.test(flat), noStone: /NO STONE|PLAIN/.test(flat),
    metal, tone, code, rows, notes, stoneTotals, diaCts, dims, ring: ring ? `${n(ring[1])} ${ring[2]}` : ringMm ? `${ringMm} EU` : undefined, subCategory, castingPcs,
  };
}

/** What is wrong with a set of metal weights: out of order (silver → platinum), or not in the usual ratios. */
function metalProblems(metal: Record<string, number>): string[] {
  const out: string[] = [];
  const order = ["SILVER", "9K", "10K", "14K", "18K", "22K", "PLT"].filter(k => metal[k] !== undefined).map(k => [k, metal[k]] as const);
  for (let i = 1; i < order.length; i++) if (order[i][1] < order[i - 1][1]) { out.push(`Gold weights out of order (${order[i - 1][0]} ${order[i - 1][1]} g > ${order[i][0]} ${order[i][1]} g)`); break; }
  // Metal density sanity: 18K vs 14K is about 1.19×; a misread digit shows here.
  if (metal["14K"] && metal["18K"]) { const r = metal["18K"] / metal["14K"]; if (r < 1.05 || r > 1.4) out.push(`18K ${metal["18K"]} g vs 14K ${metal["14K"]} g doesn't look right`); }
  if (metal["10K"] && metal["14K"]) { const r = metal["14K"] / metal["10K"]; if (r < 1.03 || r > 1.35) out.push(`14K ${metal["14K"]} g vs 10K ${metal["10K"]} g doesn't look right`); }
  return out;
}
const metalFits = (metal: Record<string, number>) => metalProblems(metal).length === 0;

/** The checks, and the reading as kept. */
function finish(p: Parts): Specs {
  const { printed, designNo, designNoSource, fromFile, anchors, hasGold, metal, rows, notes, stoneTotals, diaCts, dims } = p;
  const reasons: string[] = [];
  // ── Checks.
  if (printed && designNo && !sameDesign(printed, designNo) && !sameDesign(printed, fromFile)) reasons.push(`The sheet says ${printed}, the folder/file says ${designNo}`);
  const sumPcs = rows.reduce((t, r) => t + r.pcs, 0), sumCt = r3(rows.reduce((t, r) => t + r.total, 0));
  if (stoneTotals && rows.length) {
    if (stoneTotals.pcs !== sumPcs) reasons.push(`Stone rows add up to ${sumPcs} pcs, the total says ${stoneTotals.pcs}`);
    if (Math.abs(stoneTotals.ct - sumCt) > Math.max(0.011, sumCt * 0.02)) reasons.push(`Stone rows add up to ${sumCt} ct, the total says ${stoneTotals.ct}`);
  }
  // A table's border line read as a leading "1" ("|0.54" → "10.54"): the same total.
  const dia = diaCts ? (Math.abs(n(diaCts) - sumCt) > 0.011 && /^1\d*\.\d+$/.test(diaCts) && Math.abs(n(diaCts.slice(1)) - sumCt) <= 0.011 ? n(diaCts.slice(1)) : n(diaCts)) : undefined;
  if (dia !== undefined && rows.length && Math.abs(dia - sumCt) > Math.max(0.011, sumCt * 0.02)) reasons.push(`Total diamond carats ${dia}, rows add up to ${sumCt}`);
  if (stoneTotals && !rows.length) reasons.push("A stone total was read but not its rows");
  // Each row makes its own weight: pieces × weight per stone (the sheet's own rounding allowed).
  const odd = rows.find(r => r.perStone > 0 && r.total > 0 && Math.abs(r.pcs * r.perStone - r.total) > Math.max(0.011, r.total * 0.08) + r.pcs * 0.0005);
  if (odd) reasons.push(`A stone row doesn't add up: ${odd.pcs} × ${odd.perStone} ct ≠ ${odd.total} ct`);
  reasons.push(...metalProblems(metal));

  const table = anchors >= 2 || rows.length > 0 || Object.keys(metal).length > 0;
  let status: Specs["status"] = !table ? "noTable" : reasons.length ? "review" : "ok";
  if (table && !rows.length && !Object.keys(metal).length) { status = "review"; reasons.push("A table was seen but nothing could be read from it"); }
  else if (table && !rows.length && p.stoneCols && !p.noStone) { status = "review"; reasons.push("Stone columns were seen but no stone row could be read"); }
  else if (table && hasGold && !Object.keys(metal).length) { status = "review"; reasons.push("Gold karats were seen but no weights"); }
  const { tone, ring, subCategory, castingPcs, code } = p;
  return {
    v: PARSER_VERSION, status, ...(designNo ? { designNo, designNoSource } : {}), ...(printed && designNo && !sameDesign(printed, designNo) ? { designNoPrinted: printed } : {}),
    stones: rows, ...(stoneTotals ? { stoneTotals } : rows.length ? { stoneTotals: { pcs: sumPcs, ct: sumCt } } : {}), metal,
    ...(tone ? { metalTone: tone } : {}), dimsMm: dims.slice(0, 12), ...(ring ? { ringSize: ring } : {}),
    ...(subCategory ? { subCategory } : {}), ...(castingPcs ? { castingPcs } : {}), ...(code ? { code } : {}), reasons, ...(notes.length ? { notes } : {}),
  };
}

/** Of two readings of the same sheet (whole page, and the table enlarged), the one to keep. */
export function better(a: Specs, b: Specs): Specs {
  const score = (s: Specs) => (s.status === "ok" ? 1000 : s.status === "review" ? 500 : 0) - s.reasons.length * 50 + s.stones.length * 20 + Object.keys(s.metal).length * 10 + (s.stoneTotals ? 5 : 0);
  return score(b) > score(a) ? b : a;
}
