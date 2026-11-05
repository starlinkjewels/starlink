// Finding a design sheet's tables on its picture, and reading each one's words
// with where they sit — for the table reader (shared/tableRead.ts), which works
// out what each column is. Any designer's sheet: ruled tables of any size and
// count (a long one printed in two halves, the gold table apart from the
// stones', a gem's table beside the diamonds'); the text of a sheet with no
// table lines is kept too, line by line (ocr.ts), for the reader's row reading.
//
//   1. Lines: long thin runs of dark pixels; a vertical counts only from one
//      horizontal line to another (a letter never reaches). A table is a set of
//      lines that touch.
//   2. Each table is cut out, its lines painted white (no "|" or "1" from a
//      border), enlarged, and read word by word with each word's place; the
//      table's own lines give its rows (a band holding two lines of words is
//      split at the gap).
//   3. A number the first reading missed (a lone "3" in red, say) is read again
//      a whole column at a time — figures read far better in a strip of their
//      own — and put in its row by height.
//   4. Faint lines: when no stone table adds up at the usual darkness, the
//      lines are looked for again a shade lighter; the reading the figures
//      agree with is kept.
// The picture is read as ink — each pixel's darkest colour — so red or blue
// print stays dark while a pale cell fill stays pale.
import sharp from "sharp";
import { PSM } from "tesseract.js";
import { engine } from "./engine";
import { readStoneTables, type TTable } from "./shared/tableRead";

interface HSeg { y: number; x0: number; x1: number; t: number }
interface VLine { x: number; y0: number; y1: number }
interface Found { x0: number; y0: number; x1: number; y1: number; rows: { top: number; bot: number }[]; h: HSeg[]; v: VLine[] }
interface Pic { data: Buffer; W: number; H: number }

const r1 = (x: number) => Math.round(x * 10) / 10;

/** The picture as grey (for its lines) and as ink (for its words). */
async function pictures(buf: Buffer): Promise<{ grey: Pic; ink: Pic }> {
  const base = sharp(buf, { failOn: "none" }).rotate().flatten({ background: "#ffffff" });
  const g = await base.clone().grayscale().raw().toBuffer({ resolveWithObject: true });
  const c = await base.clone().removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const W = c.info.width, H = c.info.height, ch = c.info.channels;
  const ink = Buffer.alloc(W * H);
  for (let i = 0, j = 0; i < W * H; i++, j += ch) ink[i] = ch >= 3 ? Math.min(c.data[j], c.data[j + 1], c.data[j + 2]) : c.data[j];
  return { grey: { data: g.data, W: g.info.width, H: g.info.height }, ink: { data: ink, W, H } };
}

/** The ruled tables on a picture: their lines, and their row bands. */
function findTables(p: Pic, dark: number): Found[] {
  const { data, W, H } = p;
  const D = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) D[i] = data[i] < dark ? 1 : 0;
  const minH = Math.max(18, Math.round(W * 0.02));
  const Hm = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {
    let x = 0;
    while (x < W) {
      if (!D[y * W + x]) { x++; continue; }
      let e = x; while (e < W && D[y * W + e]) e++;
      if (e - x >= minH) for (let k = x; k < e; k++) Hm[y * W + k] = 1;
      x = e;
    }
  }
  // Horizontal lines: bands at most 5 px thick (a filled cell is thicker, and is no line).
  const hseg: HSeg[] = [];
  const seen = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (!Hm[y * W + x] || seen[y * W + x]) continue;
    let e = x; while (e < W && Hm[y * W + e]) e++;
    let t = 1;
    while (y + t < H && t < 12) { let c = 0; for (let k = x; k < e; k++) c += Hm[(y + t) * W + k]; if (c < (e - x) * 0.6) break; t++; }
    for (let r = 0; r < t; r++) for (let k = x; k < e; k++) seen[(y + r) * W + k] = 1;
    if (t <= 5) hseg.push({ y: y + (t - 1) / 2, x0: x, x1: e - 1, t });
  }
  if (hseg.length > 4000) return []; // a drawing full of lines, not a table
  // Vertical lines: runs from one horizontal line to another.
  const nearH = (x: number, y: number) => hseg.some(s => Math.abs(s.y - y) <= 3 + s.t && x >= s.x0 - 3 && x <= s.x1 + 3);
  const vseg: VLine[] = [];
  for (let x = 0; x < W; x++) {
    let y = 0;
    while (y < H) {
      if (!D[y * W + x]) { y++; continue; }
      let e = y; while (e < H && D[e * W + x]) e++;
      if (e - y >= 8 && nearH(x, y) && nearH(x, e - 1)) vseg.push({ x, y0: y, y1: e - 1 });
      y = e;
    }
  }
  vseg.sort((a, b) => a.x - b.x || a.y0 - b.y0);
  const vlines: VLine[] = [];
  for (const v of vseg) {
    const m = vlines.find(l => Math.abs(l.x - v.x) <= 2 && v.y0 <= l.y1 + 2 && v.y1 >= l.y0 - 2);
    if (m) { m.x = (m.x + v.x) / 2; m.y0 = Math.min(m.y0, v.y0); m.y1 = Math.max(m.y1, v.y1); }
    else vlines.push({ ...v });
  }
  // Tables: lines that touch, grouped.
  type Item = ({ k: "h" } & HSeg) | ({ k: "v" } & VLine);
  const items: Item[] = [...hseg.map(s => ({ k: "h" as const, ...s })), ...vlines.map(v => ({ k: "v" as const, ...v }))];
  const parent = items.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const touch = (a: Item, b: Item): boolean => {
    if (a.k === "h" && b.k === "v") return b.x >= a.x0 - 3 && b.x <= a.x1 + 3 && a.y >= b.y0 - 4 && a.y <= b.y1 + 4;
    if (a.k === "v" && b.k === "h") return touch(b, a);
    if (a.k === "h" && b.k === "h") return Math.abs(a.y - b.y) <= 2 && a.x0 <= b.x1 + 3 && b.x0 <= a.x1 + 3;
    return false;
  };
  for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) if (touch(items[i], items[j])) parent[find(i)] = find(j);
  const groups = new Map<number, Item[]>();
  items.forEach((it, i) => { const r = find(i); if (!groups.has(r)) groups.set(r, []); groups.get(r)!.push(it); });
  const out: Found[] = [];
  for (const g of groups.values()) {
    const hs = g.filter((x): x is { k: "h" } & HSeg => x.k === "h"), vs = g.filter((x): x is { k: "v" } & VLine => x.k === "v");
    if (hs.length < 2 || vs.length < 2) continue;
    const x0 = Math.min(...hs.map(s => s.x0)), x1 = Math.max(...hs.map(s => s.x1));
    const y0 = Math.min(...hs.map(s => s.y)), y1 = Math.max(...hs.map(s => s.y));
    // Too small for a table: a dimension's box on the drawing.
    if (x1 - x0 < Math.max(180, W * 0.12) || y1 - y0 < 20) continue;
    const ys = [...new Set(hs.map(s => Math.round(s.y)))].sort((a, b) => a - b).reduce<number[]>((a, y) => (a.length && y - a[a.length - 1] <= 4 ? a : [...a, y]), []);
    const rows: Found["rows"] = [];
    for (let r = 0; r + 1 < ys.length; r++) if (ys[r + 1] - ys[r] >= 6) rows.push({ top: ys[r], bot: ys[r + 1] });
    out.push({ x0, y0, x1, y1, rows, h: hs, v: vs });
  }
  return out.sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0).slice(0, 12);
}

type OcrWord = { text: string; bbox: { x0: number; y0: number; x1: number; y1: number } };
const wordsOf = (r: { data: { blocks?: { paragraphs: { lines: { words: OcrWord[] }[] }[] }[] | null } }): OcrWord[] =>
  (r.data.blocks ?? []).flatMap(b => b.paragraphs.flatMap(p => p.lines.flatMap(l => l.words)));

/** The words in the strip just above a table (its title — PEAR, ROUND, GREEN STONE — in a band too small to be a table), read alone. */
async function readTitle(ink: Pic, t: Found): Promise<string | undefined> {
  const rowH = t.rows.length ? t.rows.map(r => r.bot - r.top).sort((a, b) => a - b)[Math.floor(t.rows.length / 2)] : 16;
  const left = Math.max(0, Math.floor(t.x0)), right = Math.min(ink.W - 1, Math.ceil(t.x1));
  const bot = Math.max(0, Math.floor(t.y0) - 2), top = Math.max(0, Math.floor(t.y0 - rowH * 1.05));
  const w = right - left + 1, h = bot - top + 1;
  if (w < 20 || h < 6) return undefined;
  const px = Buffer.alloc(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) px[y * w + x] = ink.data[(top + y) * ink.W + left + x] < 175 ? 0 : 255;
  // Nothing written there: nothing to read.
  let inked = 0; for (let i = 0; i < px.length; i++) if (!px[i]) inked++;
  if (inked < px.length * 0.01) return undefined;
  // The band's own border lines out.
  for (let y = 0; y < h; y++) { let c = 0; for (let x = 0; x < w; x++) c += px[y * w + x] ? 0 : 1; if (c > w * 0.5) for (let x = 0; x < w; x++) px[y * w + x] = 255; }
  for (let x = 0; x < w; x++) { let c = 0; for (let y = 0; y < h; y++) c += px[y * w + x] ? 0 : 1; if (c > h * 0.6) for (let y = 0; y < h; y++) px[y * w + x] = 255; }
  const k = Math.min(6, Math.max(2, 1600 / w));
  const img = await sharp(px, { raw: { width: w, height: h, channels: 1 } }).resize({ width: Math.round(w * k), kernel: "lanczos3" }).extend({ top: 20, bottom: 20, left: 20, right: 20, background: "#ffffff" }).png().toBuffer();
  const eng = await engine();
  await eng.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_LINE, tessedit_char_whitelist: "", user_defined_dpi: "300" });
  const txt = (await eng.recognize(img)).data.text.replace(/\s+/g, " ").trim();
  return txt && txt.length <= 40 ? txt : undefined;
}

/** One table's words, with their places on the picture, in its own rows. */
async function readTable(ink: Pic, t: Found): Promise<TTable> {
  const { data, W, H } = ink;
  const pad = 3;
  const left = Math.max(0, Math.floor(t.x0) - pad), top = Math.max(0, Math.floor(t.y0) - pad);
  const width = Math.min(W, Math.ceil(t.x1) + pad + 1) - left, height = Math.min(H, Math.ceil(t.y1) + pad + 1) - top;
  const px = Buffer.alloc(width * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) px[y * width + x] = data[(top + y) * W + left + x];
  const erase = (x0: number, y0: number, x1: number, y1: number) => {
    for (let y = Math.max(0, y0); y <= Math.min(height - 1, y1); y++) for (let x = Math.max(0, x0); x <= Math.min(width - 1, x1); x++) px[y * width + x] = 255;
  };
  for (const h of t.h) erase(h.x0 - left - 1, Math.floor(h.y - top - h.t / 2) - 1, h.x1 - left + 1, Math.ceil(h.y - top + h.t / 2) + 1);
  for (const v of t.v) erase(Math.floor(v.x - left) - 2, v.y0 - top - 1, Math.ceil(v.x - left) + 2, v.y1 - top + 1);
  // A row band filled dark (white print on a navy heading): turned round, so its words read as print.
  for (const b of t.rows) {
    const y0 = Math.max(0, Math.round(b.top - top) + 2), y1 = Math.min(height - 1, Math.round(b.bot - top) - 2);
    if (y1 <= y0) continue;
    let sum = 0, n = 0;
    for (let y = y0; y <= y1; y++) for (let x = 0; x < width; x++) { sum += px[y * width + x]; n++; }
    if (n && sum / n < 110) for (let y = y0; y <= y1; y++) for (let x = 0; x < width; x++) px[y * width + x] = 255 - px[y * width + x];
  }
  const scale = Math.min(6, Math.max(2, 2400 / width));
  const img = await sharp(px, { raw: { width, height, channels: 1 } }).resize({ width: Math.round(width * scale), kernel: "lanczos3" }).normalize().sharpen().png().toBuffer();
  const w = await engine();
  await w.setParameters({ tessedit_pageseg_mode: PSM.SPARSE_TEXT, preserve_interword_spaces: "1", user_defined_dpi: "300", tessedit_char_whitelist: "" });
  const words = wordsOf(await w.recognize(img, {}, { blocks: true }))
    .map(x => ({ t: x.text.trim(), x0: left + x.bbox.x0 / scale, x1: left + x.bbox.x1 / scale, y0: top + x.bbox.y0 / scale, y1: top + x.bbox.y1 / scale }))
    .filter(x => x.t);
  // Rows: the table's own bands; a band holding two lines of words is split at the gap.
  const rows: (typeof words)[] = [];
  for (const b of t.rows) {
    const ws = words.filter(x => { const m = (x.y0 + x.y1) / 2; return m >= b.top && m < b.bot; }).sort((p, q) => (p.y0 + p.y1) - (q.y0 + q.y1));
    const hgt = ws.length ? ws.map(x => x.y1 - x.y0).sort((p, q) => p - q)[Math.floor(ws.length / 2)] : 0;
    let cur: typeof ws = [];
    for (const x of ws) {
      const mid = (x.y0 + x.y1) / 2;
      if (cur.length && mid - cur.reduce((s, c) => s + (c.y0 + c.y1) / 2, 0) / cur.length > hgt * 0.7) { rows.push(cur); cur = []; }
      cur.push(x);
    }
    if (cur.length) rows.push(cur);
  }
  const title = await readTitle(ink, t).catch(() => undefined);
  return {
    ...(title ? { title } : {}),
    x0: r1(t.x0), x1: r1(t.x1), y0: r1(t.y0), y1: r1(t.y1),
    vl: t.v.map(v => ({ x: r1(v.x), y0: v.y0, y1: v.y1 })),
    rows: rows.map(r => ({ w: r.sort((p, q) => p.x0 - q.x0).map(x => ({ t: x.t, x0: r1(x.x0), x1: r1(x.x1), y0: r1(x.y0), y1: r1(x.y1) })) })),
  };
}

/** A column cut out top to bottom, lines painted out, enlarged: its figures, with their heights on the picture. */
async function readStrip(ink: Pic, x0: number, x1: number, y0: number, y1: number): Promise<{ t: string; y0: number; y1: number }[]> {
  const { data, W, H } = ink;
  const left = Math.max(0, Math.floor(x0) + 2), right = Math.min(W - 1, Math.ceil(x1) - 2);
  const top = Math.max(0, Math.floor(y0)), bot = Math.min(H - 1, Math.ceil(y1));
  const w = right - left + 1, h = bot - top + 1;
  if (w < 4 || h < 4) return [];
  const px = Buffer.alloc(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) px[y * w + x] = data[(top + y) * W + left + x] < 175 ? 0 : 255;
  for (let y = 0; y < h; y++) { let c = 0; for (let x = 0; x < w; x++) c += px[y * w + x] ? 0 : 1; if (c > w * 0.6) for (let x = 0; x < w; x++) px[y * w + x] = 255; }
  for (let x = 0; x < w; x++) { let c = 0; for (let y = 0; y < h; y++) c += px[y * w + x] ? 0 : 1; if (c > h * 0.5) for (let y = 0; y < h; y++) px[y * w + x] = 255; }
  const k = 4, m = 30;
  const big = await sharp(px, { raw: { width: w, height: h, channels: 1 } }).resize({ width: w * k, kernel: "lanczos3" }).extend({ top: m, bottom: m, left: m, right: m, background: "#ffffff" }).threshold(160).png().toBuffer();
  const eng = await engine();
  await eng.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_BLOCK, tessedit_char_whitelist: "0123456789.,+-xX", user_defined_dpi: "300" });
  try {
    return wordsOf(await eng.recognize(big, {}, { blocks: true }))
      // Back to the picture: the strip was enlarged k times, with a margin of m.
      .map(x => ({ t: x.text.trim(), y0: top + (x.bbox.y0 - m) / k, y1: top + (x.bbox.y1 - m) / k }))
      .filter(x => x.t);
  } finally { await eng.setParameters({ tessedit_char_whitelist: "" }); }
}

/** The numbers the reader found missing, read a column at a time and put in their rows. */
async function fillMissing(ink: Pic, tables: TTable[]): Promise<void> {
  const g = readStoneTables(tables);
  if (!g.missing.length) return;
  const strips = new Map<string, typeof g.missing>();
  for (const m of g.missing) { const key = `${m.table}|${Math.round(m.x0)}|${Math.round(m.x1)}`; strips.set(key, [...(strips.get(key) ?? []), m]); }
  for (const ms of [...strips.values()].slice(0, 12)) {
    const t = tables[ms[0].table];
    const ys = t.rows.flatMap(r => r.w.flatMap(w => [w.y0, w.y1])).filter((v): v is number => typeof v === "number");
    if (!ys.length) continue;
    const words = await readStrip(ink, ms[0].x0, ms[0].x1, Math.min(...ys) - 2, Math.max(...ys) + 2);
    for (const m of ms) {
      const c = (m.y0 + m.y1) / 2, h = Math.max(4, m.y1 - m.y0);
      const hit = words.find(w => Math.abs((w.y0 + w.y1) / 2 - c) <= h * 0.6);
      if (hit && /\d/.test(hit.t)) t.rows[m.row].w.push({ t: hit.t, x0: r1((m.x0 + m.x1) / 2 - 2), x1: r1((m.x0 + m.x1) / 2 + 2), y0: m.y0, y1: m.y1 });
    }
  }
}

/** How far a set of tables is to be believed: stone rows that add up to their own totals first. */
function trust(tables: TTable[]): number {
  const g = readStoneTables(tables);
  const pcs = g.rows.reduce((a, x) => a + x.pcs, 0), ct = g.rows.reduce((a, x) => a + x.total, 0);
  const own = g.totals && g.rows.length && g.totals.pcs === pcs && Math.abs(g.totals.ct - ct) <= Math.max(0.011, ct * 0.02);
  return (own ? 1000 : 0) + g.fits * 10 + g.rows.length;
}

/** Every table on a sheet picture, read — the darkness tried again lighter when the first finds none that adds up. */
export async function pictureTables(buf: Buffer): Promise<TTable[]> {
  const { grey, ink } = await pictures(buf);
  let best: { tables: TTable[]; s: number } = { tables: [], s: -1 };
  for (const dark of [175, 205]) {
    const found = findTables(grey, dark);
    if (!found.length) continue;
    const tables: TTable[] = [];
    for (const f of found) tables.push(await readTable(ink, f));
    await fillMissing(ink, tables);
    const s = trust(tables);
    if (s > best.s) best = { tables, s };
    if (s >= 1000) break;
  }
  return best.tables.filter(t => t.rows.length);
}
