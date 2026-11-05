// Reading a design sheet's stone table from its words AND their places — any
// designer's layout. The server finds each table on the picture (its ruled
// lines; or, with none, its rows of words — functions-specs/src/tables.ts) and
// gives every word with where it sits; an Excel sheet gives its cells. Here:
//
//   • the heading row is found by its words, in any wording and order —
//     Shape / Cut, Sieve, MM / DIA (mm) / Size, PTS / Weight (Carat) / Wt per pc,
//     PCS / QTY / Nos, Total Weight / Total Ct …; each column's span is where its
//     heading sits (the table's own lines when it has them);
//   • every word below goes to the column it sits under;
//   • when the headings leave it open which weight is a stone's own and which
//     the row's, the numbers decide: pieces × weight per stone = row weight;
//   • a row of words alone is a section (ROUND, CUSHION, DIAMOND, GREEN STONE)
//     naming the stones under it; TOTAL is the table's own total;
//   • a table with no heading row continues the one before it (a long table
//     printed in two halves side by side, or a part found as its own box);
//   • any number of tables on a sheet, each with its own total.
//
// Plain functions; nothing about any one business or designer.

export interface TWord { t: string; x0: number; x1: number; y0?: number; y1?: number }
export interface TRow { w: TWord[] }
export interface TTable { x0: number; x1: number; y0?: number; y1?: number; /** the table's vertical lines: where, and from what height to what height */ vl?: { x: number; y0: number; y1: number }[]; rows: TRow[];
  /** The words just above the table (its title: PEAR, ROUND, GREEN STONE), read on their own. */
  title?: string }

export interface GridStone { shape?: string; sieve?: string; size?: string; pcs: number; perStone: number; total: number }
export interface GridResult {
  rows: GridStone[];
  /** The tables' own TOTAL rows, added up; unset when no stone table had one. */
  totals?: { pcs: number; ct: number };
  /** Rows whose pieces × weight per stone made their own weight — how sure the reading is. */
  fits: number;
  notes: string[];
  /** Stone tables read (with a heading of their own, or continuing one). */
  tables: number;
  /** Cells that should hold a number but read empty — for the server to read again, one by one. */
  missing: MissingCell[];
  /** Stones a table lists by shape or size with neither their pieces nor their weight — for a person to see to. */
  listed: number;
}
export interface MissingCell { table: number; row: number; role: Role; x0: number; x1: number; y0: number; y1: number }

type Role = "shape" | "sieve" | "size" | "per" | "pcs" | "total";
interface Col { x0: number; x1: number; label: string; role?: Role; weight?: boolean }

/** Stone shapes, as sheets write them (full words, and the usual short forms). */
export const SHAPE_WORDS: Record<string, string> = {
  RND: "Round", ROUND: "Round", RD: "Round", BR: "Round", BRILLIANT: "Round", EMR: "Emerald", EM: "Emerald", EMERALD: "Emerald", EMD: "Emerald",
  PRS: "Princess", PR: "Princess", PRN: "Princess", PRINCESS: "Princess", OVL: "Oval", OV: "Oval", OVAL: "Oval", PEAR: "Pear", PER: "Pear", PS: "Pear", PRL: "Pear",
  MQ: "Marquise", MQS: "Marquise", MAR: "Marquise", MRQ: "Marquise", MARQUISE: "Marquise", MARQ: "Marquise", CUS: "Cushion", CU: "Cushion", CSN: "Cushion", CUSHION: "Cushion",
  RAD: "Radiant", RADIANT: "Radiant", HRT: "Heart", HT: "Heart", HEART: "Heart", ASH: "Asscher", ASSCHER: "Asscher",
  BAG: "Baguette", BGT: "Baguette", BAGUETTE: "Baguette", BAGG: "Baguette", TBAG: "Tapered baguette", TPR: "Tapered baguette", TAP: "Tapered baguette", TB: "Tapered baguette", TAPER: "Tapered baguette",
  TRI: "Trillion", TRL: "Trillion", TRILLION: "Trillion", TRILLIANT: "Trillion", HALFMOON: "Half moon", HM: "Half moon", OEC: "Old European", ROSE: "Rose cut",
  KITE: "Kite", HEX: "Hexagon", HEXAGON: "Hexagon", OCT: "Octagon", OCTAGON: "Octagon", SQ: "Square", SQUARE: "Square", TRAP: "Trapezoid", TRAPEZOID: "Trapezoid", TRAPEZE: "Trapezoid",
  SHIELD: "Shield", MOON: "Half moon", BULLET: "Bullet", CADILLAC: "Cadillac", LOZENGE: "Lozenge", BRIOLETTE: "Briolette", ROSECUT: "Rose cut", OLDMINE: "Old mine", OMC: "Old mine",
};
/** A stone that is not a diamond, by what the sheet calls it. */
const GEM_WORD = /\b(STONE|STONES|GEM|GEMS|COLOU?R|RUBY|EMERALD STONE|SAPPHIRE|TANZANITE|AMETHYST|TOPAZ|GARNET|PERIDOT|CITRINE|AQUAMARINE|OPAL|PEARL|ONYX|MOISSANITE|CZ)\b/;

const clean = (t: string) => t.replace(/[|[\]{}“”"'’`~_=™®©¥@]/g, "").trim();
/** A word as a number, mending the usual misreads (O→0, l/I→1, "," as the decimal point); NaN when it isn't one. */
export function num(t: string): number {
  let s = clean(t).replace(/^[([]|[)\]]$/g, "").replace(/(MM|CT|CTS|GM|GMS|G|PCS?)$/i, "");
  if (!/\d/.test(s)) return NaN;
  s = s.replace(/[Oo]/g, "0").replace(/[lI]/g, "1").replace(/,/g, ".").replace(/^\.(\d)/, "0.$1");
  if (!/^\d*\.?\d+$/.test(s)) return NaN;
  const v = Number(s);
  return Number.isFinite(v) ? v : NaN;
}
const isInt = (t: string) => { const v = num(t); return Number.isInteger(v) && !/\./.test(t); };
const up = (t: string) => clean(t).toUpperCase().replace(/[().:]/g, " ").replace(/\s+/g, " ").trim();
const mid = (w: TWord) => (w.x0 + w.x1) / 2;
const r3 = (x: number) => Math.round(x * 1000) / 1000;
/** The shape a word names (RND, ROUND, MQS …), else undefined. */
export const shapeOf = (t: string | undefined) => (t ? SHAPE_WORDS[up(t).replace(/[^A-Z]/g, "")] : undefined);

// ── Headings ──
const H = {
  shape: /^(SHAPE|SHAPES|CUT|SHP)$/,
  sieve: /^(SIEVE|SIEVES|SV)$/,
  size: /^(MM|SIZE|SIZES|DIA|DIAMETER|DIAM|MEASUREMENT|MEASUREMENTS|DIMENSION|DIMENSIONS|MEAS|LXW|L\*W|LENGTH|LEN|WIDTH|WID|DEPTH|HEIGHT|LXWXD)$/,
  per: /^(PTS|PT|POINTER|POINTERS|PER|EACH|AVG|AVERAGE|PC\/WT|WT\/PC|CT\/PC|PERSTONE)$/,
  weight: /^(WEIGHT|WT|WGT|WEIGTH|CARAT|CARATS|CT|CTS|CTW|CTWT)$/,
  pcs: /^(PCS|PC|PCS\.|QTY|QTY\.|QUANTITY|NOS|NO|PIECES|PIECE|COUNT|NUMBERS)$/,
  total: /^(TOTAL|TTL|TOT)$/,
};
const headWords = (ws: TWord[]) => ws.flatMap(w => up(w.t).split(/[\s/]+/)).filter(Boolean);
function headingScore(ws: TWord[]): number {
  const hw = headWords(ws);
  const kinds = new Set<string>();
  for (const x of hw) for (const [k, re] of Object.entries(H)) if (re.test(x)) kinds.add(k);
  // A heading row holds no figures ("TOTAL 3 PCS" names two kinds but is a total).
  const nums = ws.filter(w => Number.isFinite(num(w.t)) && !/^\(?MM\)?$/i.test(w.t)).length;
  // (Three kinds or more is a heading even with a stray figure — a filter arrow's box read as "1".)
  return nums > (kinds.size >= 3 ? 1 : 0) ? 0 : kinds.size;
}

/**
 * The ways the heading row's words could make columns — each tried, the figures below deciding:
 *   by the table's own lines through the heading (a heading misread still leaves its column);
 *   by the gaps between the heading's words (a table with faint or no lines);
 *   by the gaps, with a line between two headings taken as their border.
 */
function columnCandidates(head: TWord[], t: TTable): Col[][] {
  // A heading's words; a stray letter or two (a filter arrow's box read as "J", "v", "wv") is not one.
  const ws = [...head].filter(w => { const c = clean(w.t).replace(/[^A-Za-z().]/g, ""); return (/[A-Za-z]/.test(c) && (c.length > 2 || /^(PCS?|NO|CTS?|MM|WT|SV|QTY)$/i.test(c))) || /\(?mm\)?/i.test(w.t); }).sort((a, b) => a.x0 - b.x0);
  if (!ws.length) return [];
  const charW = ws.map(w => (w.x1 - w.x0) / Math.max(1, clean(w.t).length)).sort((a, b) => a - b)[Math.floor(ws.length / 2)] || 6;
  // The table's lines through the heading row that run on down through the rows (not a filter arrow's box).
  const ys = head.filter(w => w.y0 !== undefined && w.y1 !== undefined).map(w => (w.y0! + w.y1!) / 2);
  const hy = ys.length ? ys.reduce((a, b) => a + b, 0) / ys.length : undefined;
  const wh = head.filter(w => w.y0 !== undefined && w.y1 !== undefined).map(w => w.y1! - w.y0!).sort((a, b) => a - b);
  const minLen = Math.max(14, (wh[Math.floor(wh.length / 2)] ?? 8) * 2.2);
  const through = (long: boolean) => [...new Set((t.vl ?? []).filter(l => (!long || l.y1 - l.y0 >= minLen) && (hy === undefined || (l.y0 <= hy + 2 && l.y1 >= hy - 2))).map(l => Math.round(l.x)))]
    .filter(x => x > t.x0 + 2 && x < t.x1 - 2).sort((a, b) => a - b);
  const out: Col[][] = [];
  for (const lines of [through(true), through(false)]) {
    if (lines.length < 2) continue;
    const edges = [t.x0, ...lines, t.x1].sort((a, b) => a - b).filter((x, i, arr) => i === 0 || x - arr[i - 1] > 6);
    const spans: Col[] = [];
    for (let i = 0; i + 1 < edges.length; i++) spans.push({ x0: edges[i], x1: edges[i + 1], label: up(ws.filter(w => mid(w) >= edges[i] && mid(w) < edges[i + 1]).map(w => w.t).join(" ")) });
    out.push(nameColumns(spans));
  }
  const lines = through(true);
  for (const useLines of [false, true]) {
    const groups: TWord[][] = [];
    for (const w of ws) {
      const g = groups[groups.length - 1];
      const prev = g?.[g.length - 1];
      const lineBetween = useLines && prev && lines.some(x => x > prev.x1 - 1 && x < w.x0 + 1);
      if (!g || lineBetween || w.x0 - prev!.x1 > charW * 2.2) groups.push([w]); else g.push(w);
    }
    const cols: Col[] = groups.map(g => ({ x0: g[0].x0, x1: g[g.length - 1].x1, label: up(g.map(w => w.t).join(" ")) }));
    for (let i = 0; i < cols.length; i++) {
      const between = (a: number, b: number, first: boolean) => { const ln = useLines ? lines.filter(x => x >= a - 1 && x <= b + 1) : []; return ln.length ? (first ? ln[0] : ln[ln.length - 1]) : (a + b) / 2; };
      const L = i === 0 ? t.x0 : between(cols[i - 1].x1, cols[i].x0, true);
      const R = i === cols.length - 1 ? t.x1 : between(cols[i].x1, cols[i + 1].x0, false);
      cols[i] = { ...cols[i], x0: L, x1: R };
    }
    out.push(nameColumns(cols));
  }
  return out;
}

/** Each column's meaning by its heading. */
function nameColumns(cols: Col[]): Col[] {
  for (const c of cols) {
    const w = c.label.split(/[\s/]+/);
    const has = (re: RegExp) => w.some(x => re.test(x));
    if (has(H.sieve)) c.role = "sieve";
    else if (has(H.shape)) c.role = "shape";
    else if (has(H.pcs) && !has(H.weight)) c.role = "pcs";
    else if (has(H.per)) c.role = "per";
    else if (has(H.total) && has(H.weight)) c.role = "total";
    else if (has(H.weight)) c.weight = true;
    else if (has(H.size)) c.role = "size";
    else if (has(H.total)) c.weight = true;
  }
  // A weight with no word to say whose: the row's when the stone's own is named, else the stone's when the row's is.
  const W = cols.filter(c => c.weight && !c.role);
  const hasPer = cols.some(c => c.role === "per"), hasTot = cols.some(c => c.role === "total");
  if (W.length === 1) W[0].role = hasTot ? "per" : "total";
  else if (W.length >= 2) { W[0].role = hasPer ? "total" : "per"; W[W.length - 1].role = "total"; }
  return cols;
}

/** A row's words in each column (by where each word's middle sits). */
function cellsOf(row: TRow, cols: Col[]): string[] {
  const out = cols.map(() => [] as string[]);
  for (const w of [...row.w].sort((a, b) => a.x0 - b.x0)) {
    const m = mid(w);
    let i = cols.findIndex(c => m >= c.x0 && m < c.x1);
    if (i < 0) i = m < cols[0].x0 ? 0 : cols.length - 1;
    const t = clean(w.t);
    if (t && !/^[-—–=~v|J.]$/.test(t)) out[i].push(t);
  }
  return out.map(x => x.join(" "));
}

const sizeText = (s: string) => {
  // Two figures side by side are length × width ("5.80 4.00" → "5.80x4.00").
  const t = s.replace(/\s*mm\b\.?/gi, "").replace(/\s*[xX×*]\s*/g, "x").replace(/\s*-\s*/g, "-").trim().replace(/(\d)\s+(?=\d)/g, "$1x");
  return /\d/.test(t) ? t : undefined;
};
const sieveText = (s: string) => {
  const t = s.replace(/\s+/g, "").replace(/[Oo]/g, "0");
  return /^[+-]?\d[\d.]*([+-]\d[\d.]*)?$/.test(t) && t !== "0" ? t : /^\*{2,}$/.test(t) ? t : undefined;
};
const title = (s: string) => s.toLowerCase().replace(/\b\w/, c => c.toUpperCase());

/** One table read with one set of columns: its stones, its own total, how well its figures agree. */
interface Reading { rows: GridStone[]; fits: number; notes: string[]; total?: { pcs: number; ct: number }; missing: MissingCell[]; cols: Col[] }
function readWith(t: TTable, ti: number, cols: Col[], from: number, before: GridStone[] = [], carried?: { section?: string; gem?: string }): Reading | null {
  const role = (r: Role) => cols.findIndex(c => c.role === r);
  if (!cols.length || role("pcs") < 0 || (role("per") < 0 && role("total") < 0)) return null;
  const out: Reading = { rows: [], fits: 0, notes: [], missing: [], cols };
  let totPcs = 0, totCt = 0, anyTotal = false;
  let section: string | undefined = carried?.section;
  let gem: string | undefined = carried?.gem;
  // A title above the heading row (PEAR, CUSHION, GREEN STONE): the stones under it.
  for (let ri = 0; ri < from - 1; ri++) {
    const text = up(t.rows[ri].w.map(w => w.t).join(" "));
    if (!text || /\d/.test(text)) continue;
    const sh = text.split(" ").map(shapeOf).find(Boolean);
    if (GEM_WORD.test(text)) { gem = title(text); section = sh; } else if (sh) { section = sh; gem = undefined; }
  }
  // Every size column (DIA (mm); or Length, Width, Depth) — one size, "15.00x9.00".
  const sizeCols = cols.map((c, i) => (c.role === "size" ? i : -1)).filter(i => i >= 0);
  const rowsHere: GridStone[] = [];
  for (let ri = from; ri < t.rows.length; ri++) {
    const row = t.rows[ri];
    const text = up(row.w.map(w => w.t).join(" "));
    if (!text) continue;
    const cells = cellsOf(row, cols);
    // A section: words only (ROUND, CUSHION, DIAMOND, GREEN STONE) — the stones under it.
    if (!/\d/.test(text)) {
      if (headingScore(row.w) >= 2) continue;
      const sh = text.split(" ").map(shapeOf).find(Boolean);
      if (GEM_WORD.test(text)) { gem = title(text); section = sh; }
      else if (sh) { section = sh; gem = undefined; }
      else if (/DIAMOND/.test(text)) { section = undefined; gem = undefined; }
      continue;
    }
    const at = (r: Role) => (r === "size" ? sizeCols.map(i => cells[i]).filter(Boolean).join(" x ") : role(r) >= 0 ? cells[role(r)] : "");
    // The table's own total.
    if (/\bTOTAL\b/.test(text) || /^TOTAL/.test(text)) {
      // Pieces are a whole number, the carats a weight — a "6.06" is never a count.
      const pcsW = at("pcs").split(" ").find(x => isInt(x));
      const pcs = pcsW !== undefined ? num(pcsW) : NaN;
      const ctW = (at("total") || at("per")).split(" ").reverse().find(x => Number.isFinite(num(x)));
      const ct = ctW !== undefined ? num(ctW) : NaN;
      if (Number.isFinite(ct) || Number.isFinite(pcs)) { anyTotal = true; totPcs += Number.isFinite(pcs) ? pcs : 0; totCt += Number.isFinite(ct) ? ct : 0; }
      // Whichever figure of the total read empty: read again.
      const need = [...(!Number.isFinite(pcs) ? ["pcs" as const] : []), ...(!Number.isFinite(ct) ? ["total" as const] : [])];
      if (need.length) out.missing.push(...missingIn(t, ti, ri, cols, need));
      continue;
    }
    const pcsT = at("pcs").split(" ").find(x => isInt(x));
    const per = num(at("per").split(" ")[0] ?? "");
    const tot = num(at("total").split(" ").slice(-1)[0] ?? "");
    // Pieces unreadable but the row's two weights clear: the row's weight ÷ a stone's, when that is a whole number.
    const q = per > 0 && tot > 0 ? tot / per : NaN;
    const pcs = pcsT !== undefined ? num(pcsT) : q >= 1 && Math.abs(q - Math.round(q)) <= Math.max(0.15, Math.round(q) * 0.02) ? Math.round(q) : NaN;
    const shapeCell = at("shape");
    const shape = shapeOf(shapeCell.split(" ")[0]) ?? (shapeCell && !/\d/.test(shapeCell) ? title(shapeCell) : undefined) ?? section;
    // Cells that should hold a number and read empty: read again (the server, a column at a time).
    const need: Role[] = [];
    if (!Number.isFinite(pcs) && role("pcs") >= 0) need.push("pcs");
    if (!Number.isFinite(per) && role("per") >= 0) need.push("per");
    if (!Number.isFinite(tot) && role("total") >= 0) need.push("total");
    if (need.length) out.missing.push(...missingIn(t, ti, ri, cols, need));
    if (!(pcs >= 1 && pcs <= 5000)) continue;
    // A total whose word was misread ("0A" for TOTAL): no stone of its own (no shape, sieve, size or weight
    // per stone), and its pieces and weight are the rows above added up.
    // (A table continued in a box of its own: the rows of the box before count as above.)
    const stack = rowsHere.length ? rowsHere : before;
    const above = stack.reduce((a, x) => ({ pcs: a.pcs + x.pcs, ct: a.ct + x.total }), { pcs: 0, ct: 0 });
    if ((rowsHere.length > 1 || (stack.length > 0 && Number.isFinite(tot))) && !shapeCell && !sieveText(at("sieve")) && !sizeText(at("size")) && pcs === above.pcs
      && (!Number.isFinite(tot) || Math.abs(tot - above.ct) <= Math.max(0.011, above.ct * 0.03))) {
      anyTotal = true; totPcs += pcs; totCt += Number.isFinite(tot) ? tot : above.ct;
      continue;
    }
    let perStone = Number.isFinite(per) ? per : NaN, total = Number.isFinite(tot) ? tot : NaN;
    if (!Number.isFinite(perStone) && Number.isFinite(total)) perStone = total / pcs;
    if (!Number.isFinite(total) && Number.isFinite(perStone)) total = perStone * pcs;
    if (!Number.isFinite(perStone)) continue;
    rowsHere.push({
      ...(gem ? { shape: shape && shape !== gem ? `${shape} · ${gem}` : gem } : shape ? { shape } : {}),
      ...(sieveText(at("sieve")) ? { sieve: sieveText(at("sieve"))! } : {}),
      ...(sizeText(at("size")) ? { size: sizeText(at("size"))! } : {}),
      pcs, perStone: r3(perStone), total: r3(total),
    });
  }
  // The numbers decide which weight is whose when the headings got it the wrong way round.
  const fit = (a: GridStone) => Math.abs(a.pcs * a.perStone - a.total) <= Math.max(0.011, a.total * 0.03);
  const swapped = rowsHere.filter(x => x.perStone > 0 && Math.abs(x.pcs * x.total - x.perStone) <= Math.max(0.011, x.perStone * 0.03)).length;
  if (swapped > rowsHere.filter(fit).length) for (const x of rowsHere) [x.perStone, x.total] = [x.total, x.perStone];
  for (const x of rowsHere) {
    if (fit(x) && x.total > 0) out.fits++;
    if (!x.total) out.notes.push(`${x.shape ?? "Stone"} × ${x.pcs}: no weight on the sheet`);
    out.rows.push(x);
  }
  // A total whose pieces read empty while its carats are the rows' exactly: its pieces are the rows'.
  const sum = out.rows.reduce((a, x) => ({ pcs: a.pcs + x.pcs, ct: a.ct + x.total }), { pcs: 0, ct: 0 });
  if (anyTotal && !totPcs && totCt > 0 && Math.abs(totCt - sum.ct) <= Math.max(0.011, sum.ct * 0.02)) totPcs = sum.pcs;
  if (anyTotal) out.total = { pcs: totPcs, ct: r3(totCt) };
  return out;
}

/** How far a reading is to be believed: its rows adding up to its own total first, then rows that make their own weight. */
function score(r: Reading | { rows: GridStone[]; fits: number; total?: { pcs: number; ct: number }; missing?: MissingCell[] }): number {
  const pcs = r.rows.reduce((a, x) => a + x.pcs, 0), ct = r.rows.reduce((a, x) => a + x.total, 0);
  const own = r.total && r.rows.length && r.total.pcs === pcs && Math.abs(r.total.ct - ct) <= Math.max(0.011, ct * 0.02);
  return (own ? 1000 : 0) + r.fits * 10 + r.rows.length - (r.missing?.length ?? 0) * 0.5;
}

/**
 * The stone rows of every table on a sheet. `above`: the page's own lines of words, on the tables' scale —
 * a title just above a table (PEAR, Oval, ROUND, GREEN STONE in a merged cell too small to be a table) names its stones.
 */
export function readStoneTables(tables: TTable[], above: TRow[] = []): GridResult {
  const res: GridResult = { rows: [], fits: 0, notes: [], tables: 0, missing: [], listed: 0 };
  let totPcs = 0, totCt = 0, anyTotal = false;
  let prev: { cols: Col[]; t: TTable; rows: GridStone[] } | null = null;
  const take = (r: { rows: GridStone[]; fits: number; notes: string[]; total?: { pcs: number; ct: number }; missing?: MissingCell[] }) => {
    res.tables++; res.fits += r.fits; res.rows.push(...r.rows); res.notes.push(...r.notes); res.missing.push(...(r.missing ?? []));
    if (r.total) { anyTotal = true; totPcs += r.total.pcs; totCt += r.total.ct; }
  };
  // A title (PEAR, Oval, ROUND, GREEN STONE) in a box of its own, or at the foot of the gold's box: for the table after it.
  let carried: { section?: string; gem?: string } | undefined;
  const titleOf = (rows: TRow[]) => {
    let c: { section?: string; gem?: string } | undefined;
    for (const r of rows) {
      const text = up(r.w.map(w => w.t).join(" "));
      if (!text || /\d/.test(text) || headingScore(r.w) >= 2) continue;
      const sh = text.split(" ").map(shapeOf).find(Boolean);
      if (GEM_WORD.test(text)) c = { gem: title(text), section: sh }; else if (sh) c = { section: sh }; else if (/DIAMOND/.test(text)) c = {};
    }
    return c;
  };
  tables.forEach((t, ti) => {
    if (!t.rows.length) return;
    let carry = carried; carried = undefined;
    if (!carry && above.length && t.y0 !== undefined) {
      const hs = t.rows.flatMap(r => r.w.map(w => (w.y1 ?? 0) - (w.y0 ?? 0))).filter(h => h > 0).sort((a, b) => a - b);
      const rowH = hs[Math.floor(hs.length / 2)] ?? 12;
      const near = above.filter(r => {
        const ys = r.w.filter(w => w.y0 !== undefined && w.y1 !== undefined).map(w => (w.y0! + w.y1!) / 2);
        if (!ys.length) return false;
        const y = ys.reduce((a, b) => a + b, 0) / ys.length, x = r.w.reduce((a, w) => a + mid(w), 0) / r.w.length;
        return y < t.y0! + rowH * 0.5 && y > t.y0! - rowH * 3.5 && x > t.x0 && x < t.x1;
      });
      carry = titleOf(near);
    }
    // The title read on its own just above the table (the server reads that strip apart) — only a clean one:
    // at most three plain words, a shape named in full or by a code of three letters or more ("em" in noise is no Emerald).
    if (!carry && t.title) {
      const words = t.title.replace(/[^A-Za-z ]/g, " ").trim().split(/\s+/).filter(Boolean);
      if (words.length && words.length <= 3 && words.every(w => w.length >= 3) && words.join("").length >= t.title.replace(/\s/g, "").length * 0.8)
        carry = titleOf([{ w: [{ t: words.join(" "), x0: t.x0, x1: t.x1 }] }]);
    }
    // The heading row: the one naming the most kinds of column (at least two).
    let hi = -1, best = 1;
    t.rows.forEach((r, i) => { const s = headingScore(r.w); if (s > best) { best = s; hi = i; } });
    const tries: Reading[] = [];
    if (hi >= 0) {
      for (const cols of columnCandidates(t.rows[hi].w, t)) {
        inferRoles(cols, t.rows.slice(hi + 1));
        const r = readWith(t, ti, cols, hi + 1, [], carry);
        if (r) tries.push(r);
      }
    } else if (prev) {
      // No heading: the table before continues — under it (the same columns) or beside it (in proportion).
      const p: { cols: Col[]; t: TTable; rows: GridStone[] } = prev;
      const overlap = Math.min(t.x1, p.t.x1) - Math.max(t.x0, p.t.x0);
      const k = (t.x1 - t.x0) / Math.max(1, p.t.x1 - p.t.x0);
      const cols = overlap > 0.8 * Math.min(t.x1 - t.x0, p.t.x1 - p.t.x0) ? p.cols.map(c => ({ ...c }))
        : p.cols.map(c => ({ ...c, x0: t.x0 + (c.x0 - p.t.x0) * k, x1: t.x0 + (c.x1 - p.t.x0) * k }));
      const r = readWith(t, ti, cols, 0, p.rows, carry);
      if (r) tries.push(r);
    }
    const chosen = tries.sort((a, b) => score(b) - score(a))[0];
    // A heading of stones (shape, sizes) with no pieces or weight anywhere: its rows are stones the price can't see.
    if (hi >= 0 && !tries.length) {
      const named = nameColumns(columnCandidates(t.rows[hi].w, t)[0] ?? []);
      if (named.some(c => c.role === "shape") && named.some(c => c.role === "size"))
        res.listed += t.rows.slice(hi + 1).filter(r => r.w.some(w => shapeOf(w.t))).length;
    }
    // No heading (or none that reads): each row on its own terms (shape, size, pieces, weights) — kept when it reads better.
    const lines = hi < 0 || !chosen ? readStoneLines(t.rows.slice(hi + 1)) : null;
    // Read row by row, a table is only believed when its rows make the total printed in it.
    const linesAgree = !!lines?.totals && lines.rows.length > 0 && lines.totals.pcs === lines.rows.reduce((a, x) => a + x.pcs, 0)
      && Math.abs(lines.totals.ct - lines.rows.reduce((a, x) => a + x.total, 0)) <= Math.max(0.011, lines.totals.ct * 0.02);
    if (lines?.rows.length && linesAgree && (!chosen || score({ ...lines, total: lines.totals }) > score(chosen))) { take({ ...lines, total: lines.totals }); return; }
    if (!chosen || !chosen.rows.length && !chosen.total) { carried = titleOf(t.rows) ?? carry; return; }
    take(chosen);
    prev = { cols: chosen.cols, t, rows: chosen.rows };
  });
  if (anyTotal) res.totals = { pcs: totPcs, ct: r3(totCt) };
  return res;
}

/**
 * Columns the headings didn't name (misread, or none), named by their figures: whole numbers are pieces;
 * decimals are weights — the stone's own or the row's, by pieces × weight per stone = row weight.
 */
function inferRoles(cols: Col[], rows: TRow[]): void {
  const has = (r: Role) => cols.some(c => c.role === r);
  const data = rows.filter(r => /\d/.test(r.w.map(w => w.t).join(" ")) && !/TOTAL/i.test(r.w.map(w => w.t).join(" ")));
  if (!data.length) return;
  const cellsAll = data.map(r => cellsOf(r, cols));
  const kinds = cols.map((c, i) => {
    const vals = cellsAll.map(cs => cs[i]).filter(Boolean);
    const ints = vals.filter(v => isInt(v.split(" ")[0])).length, decs = vals.filter(v => /^\d*\.\d+$/.test(v.split(" ")[0].replace(/,/g, "."))).length;
    return { ints, decs, n: vals.length, sizey: vals.filter(v => /mm|x|×|\d-\d/i.test(v)).length };
  });
  const free = (i: number) => !cols[i].role && kinds[i].n > 0 && kinds[i].sizey < kinds[i].n / 2;
  if (!has("pcs")) {
    const i = cols.findIndex((_, k) => free(k) && kinds[k].ints >= kinds[k].n * 0.6);
    // None with figures: an unnamed, empty column (its heading and figures both unread) — read again as pieces.
    const e = i >= 0 ? i : cols.findIndex((c, k) => !c.role && !c.weight && !c.label && kinds[k].n === 0);
    if (e >= 0) cols[e].role = "pcs";
  }
  const decCols = cols.map((_, k) => k).filter(k => free(k) && kinds[k].decs >= kinds[k].n * 0.6);
  const pi = cols.findIndex(c => c.role === "pcs");
  if (pi < 0 || !decCols.length) return;
  const at = (cs: string[], k: number) => num((cs[k] ?? "").split(" ")[0] ?? "");
  const fitsAs = (perK: number, totK: number) => cellsAll.filter(cs => { const p = at(cs, pi), a = at(cs, perK), b = at(cs, totK); return p > 0 && a > 0 && b > 0 && Math.abs(p * a - b) <= Math.max(0.011, b * 0.03); }).length;
  const perK = cols.findIndex(c => c.role === "per"), totK = cols.findIndex(c => c.role === "total");
  if (perK < 0 && totK >= 0) { const k = decCols.sort((a, b) => fitsAs(b, totK) - fitsAs(a, totK))[0]; if (fitsAs(k, totK) > 0) cols[k].role = "per"; }
  else if (totK < 0 && perK >= 0) { const k = decCols.sort((a, b) => fitsAs(perK, b) - fitsAs(perK, a))[0]; cols[k].role = "total"; }
  else if (perK < 0 && totK < 0) {
    if (decCols.length >= 2) { let bp = decCols[0], bt = decCols[1], bf = -1; for (const a of decCols) for (const b of decCols) if (a !== b && fitsAs(a, b) > bf) { bf = fitsAs(a, b); bp = a; bt = b; } cols[bp].role = "per"; cols[bt].role = "total"; }
    else cols[decCols[0]].role = "total";
  }
}

/**
 * Rows with no heading over them — a table without one, or plain text on the sheet ("0.9 mm [14] [0.06]",
 * "OVAL 7.85 X 6.00 mm 1 PCS", "total :- [22 pcs] [0.11 ct]"): each line read on its own terms.
 */
export function readStoneLines(rows: TRow[]): { rows: GridStone[]; totals?: { pcs: number; ct: number }; fits: number; notes: string[] } {
  const out: GridStone[] = [], notes: string[] = [];
  let fits = 0, totals: { pcs: number; ct: number } | undefined, shape: string | undefined, totalNext = false;
  // In free text a shape is a word of three letters or more (RND, OVL, PEAR …) — "pr." in a note is not Princess.
  const shapeWord = (t: string) => (clean(t).replace(/[^A-Za-z]/g, "").length >= 3 ? shapeOf(t) : undefined);
  // Pieces of one line the reading split apart ("0.8 mm [2]" … "[0.01]"): joined again by their height on the page.
  const lines: TWord[][] = [];
  for (const r of rows) {
    const ws = [...r.w].sort((a, b) => a.x0 - b.x0);
    const last = lines[lines.length - 1];
    const cy = (w: TWord[]) => { const v = w.filter(x => x.y0 !== undefined && x.y1 !== undefined); return v.length ? v.reduce((a, x) => a + (x.y0! + x.y1!) / 2, 0) / v.length : NaN; };
    const hh = (w: TWord[]) => { const v = w.filter(x => x.y0 !== undefined && x.y1 !== undefined); return v.length ? v.reduce((a, x) => a + (x.y1! - x.y0!), 0) / v.length : NaN; };
    if (last && Math.abs(cy(last) - cy(ws)) < Math.max(4, hh(last) * 0.5) && ws[0].x0 >= last[last.length - 1].x1 - 2) last.push(...ws);
    else lines.push(ws);
  }
  for (const lw of lines) {
    const ws = lw.map(w => clean(w.t)).filter(Boolean);
    const T = ws.join(" ").replace(/\s*[xX×*]\s*(?=\d)/g, "x").replace(/(\d)\s*-\s*(\d)/g, "$1-$2");
    const U = T.toUpperCase();
    // Gold, not stones: "14 kt :- 1.97 gm", "18K 2.25", "Silver 6.19".
    if (/\b\d{1,2}\s?K(T)?\b|\bKT\b|\bGMS?\b|\bGRAMS?\b|\bGOLD\b|\bSILVER\b|\bPLATINUM\b|\bPLT\b/.test(U)) { totalNext = false; continue; }
    if (!/\d/.test(U)) {
      // "total" alone: the figures on the next line are the total.
      if (/^\W*(TOTAL|TTL)\W*$/.test(U)) { totalNext = true; continue; }
      const sh = U.split(/\s+/).map(shapeWord).find(Boolean); if (sh) shape = sh; continue;
    }
    const toks = T.split(/\s+/);
    const size = /(\d+(?:\.\d+)?(?:x\d*\.?\d+){1,2}|\d+(?:\.\d+)?-\d+(?:\.\d+)?)\s*(?:mm)?/i.exec(T)?.[1] ?? /(\d+(?:\.\d+)?)\s*mm\b/i.exec(T)?.[1];
    const used = new Set<string>(size ? size.split(/[x-]/) : []);
    // Pieces: a whole number in brackets, or with PCS / NOS after it, or standing alone.
    const pcsM = /\[(\d{1,4})\s*(?:PCS?|NOS)?\]|(\d{1,4})\s*(?:PCS?|NOS|PIECES?)\b/i.exec(T);
    const ints = toks.filter(t => /^\[?\d{1,4}\]?$/.test(t) && !used.has(t.replace(/[[\]]/g, "")));
    const pcs = pcsM ? Number(pcsM[1] ?? pcsM[2]) : ints.length === 1 ? Number(ints[0].replace(/[[\]]/g, "")) : NaN;
    // Weights: the decimals that are not the size — in brackets or with "ct" counting as the row's.
    const decs = [...T.matchAll(/\[?(\d*\.\d+)\]?\s*(CTS?|CT\.)?/gi)].map(m => ({ v: Number(m[1]), ct: !!m[2] || /^\[/.test(m[0]) })).filter(d => !used.has(String(d.v)) && !(size && size.includes(String(d.v))));
    const sh = shapeWord(toks[0]) ?? toks.map(shapeWord).find(Boolean);
    if (sh) shape = sh;
    if (/TOTAL|TTL/.test(U) || totalNext) {
      totalNext = false;
      const ct = decs.length ? decs[decs.length - 1].v : NaN;
      if (Number.isFinite(pcs) || Number.isFinite(ct)) totals = { pcs: Number.isFinite(pcs) ? pcs : 0, ct: Number.isFinite(ct) ? ct : 0 };
      continue;
    }
    if (!(pcs >= 1 && pcs <= 5000) || (!size && !sh && !decs.length)) continue;
    let per = NaN, tot = NaN;
    if (decs.length >= 2) {
      const [a, b] = decs.slice(-2);
      if (Math.abs(pcs * a.v - b.v) <= Math.max(0.011, b.v * 0.03)) { per = a.v; tot = b.v; }
      else if (Math.abs(pcs * b.v - a.v) <= Math.max(0.011, a.v * 0.03)) { per = b.v; tot = a.v; }
      else { per = a.v; tot = b.v; }
    } else if (decs.length === 1) { tot = decs[0].v; per = tot / pcs; }
    const s: GridStone = { ...(sh ?? shape ? { shape: sh ?? shape } : {}), ...(size ? { size } : {}), pcs, perStone: Number.isFinite(per) ? r3(per) : 0, total: Number.isFinite(tot) ? r3(tot) : 0 };
    if (s.total && Math.abs(s.pcs * s.perStone - s.total) <= Math.max(0.011, s.total * 0.03)) fits++;
    if (!s.total) notes.push(`${s.shape ?? "Stone"} × ${s.pcs}: no weight on the sheet`);
    out.push(s);
  }
  return { rows: out, totals, fits, notes };
}

/** Where a missing number's cell is: its column's span, the row's height. */
function missingIn(t: TTable, ti: number, ri: number, cols: Col[], roles: Role[]): MissingCell[] {
  const ys = t.rows[ri].w.filter(w => w.y0 !== undefined && w.y1 !== undefined);
  if (!ys.length) return [];
  const y0 = Math.min(...ys.map(w => w.y0!)), y1 = Math.max(...ys.map(w => w.y1!));
  return roles.map(r => cols.find(c => c.role === r)).filter((c): c is Col => !!c).map(c => ({ table: ti, row: ri, role: c.role!, x0: c.x0, x1: c.x1, y0, y1 }));
}

/** The tables as plain lines of text (each row's words in order) — for the word reader's gold, sizes and totals. */
export const tablesText = (tables: TTable[]) => tables.map(t => t.rows.map(r => [...r.w].sort((a, b) => a.x0 - b.x0).map(w => w.t).join("  ")).join("\n")).join("\n\n");
