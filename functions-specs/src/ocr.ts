// Reading the words off a picture or an Excel file — free, on our own server:
// tesseract (the open-source OCR engine) for pictures, ExcelJS for .xlsx. No
// paid AI service is called, ever. What the words MEAN is the shared parser's
// job (shared/specParse.ts).
//
// A picture is read twice:
//   1. the whole page, enlarged to 2400–3200 px, grey, contrast stretched, in
//      "sparse text" mode (a design sheet is a drawing with a table somewhere);
//   2. the table alone: the box around the table's own words (SHAPE, PCS,
//      TOTAL, 14K …) found in pass 1, cut out with room below for its last rows,
//      and enlarged again — small print reads far better that way.
// Both texts are kept; the parser picks the better reading.
//   3. (since OCR 2) every table on the sheet found by its lines and read word by
//      word with each word's place (tables.ts) — `grids`, for the table reader —
//      and the page's own lines of words (`lines`), for a sheet whose table has no lines.
// An Excel sheet gives its cells as they are (one table per worksheet).
import sharp from "sharp";
import ExcelJS from "exceljs";
import { PSM } from "tesseract.js";
import { engine, stopEngine } from "./engine";
import { pictureTables } from "./tables";
import type { TTable } from "./shared/tableRead";

/** Bumped when the reading itself changes (not the parser) — texts read before are read again. */
export const OCR_VERSION = 2;

export interface OcrText { page: string; table?: string; w: number; h: number; ms: number;
  /** The sheet's tables, each word with its place (OCR 2). */
  grids?: TTable[];
  /** The page's own lines of words, in order (OCR 2) — for a table with no lines. */
  lines?: TTable;
}
export { engine, stopEngine };

const ANCHOR = /^(SHAPE|SIEVE|PTS|QTY\.?|PCS|PCs|TOTAL|Total|WEIGHT|Weight|METAL|Metal|Casting|Sub\.?Ctg|DIA|GM|\d{1,2}K[Tt]?|Silver)$/;

export async function readPicture(buf: Buffer): Promise<OcrText> {
  const t0 = Date.now();
  const md = await sharp(buf, { failOn: "none" }).metadata();
  const W = Math.min(3200, Math.max(2400, md.width ?? 1200));
  const page = await sharp(buf, { failOn: "none" }).rotate().flatten({ background: "#ffffff" }).resize({ width: W }).grayscale().normalize().sharpen().png().toBuffer();
  const pm = await sharp(page).metadata();
  const w = await engine();
  await w.setParameters({ tessedit_pageseg_mode: PSM.SPARSE_TEXT, preserve_interword_spaces: "1", user_defined_dpi: "300" });
  const a = await w.recognize(page, {}, { text: true, blocks: true });
  const out: OcrText = { page: a.data.text, w: md.width ?? 0, h: md.height ?? 0, ms: 0 };

  const words = (a.data.blocks ?? []).flatMap(b => b.paragraphs.flatMap(p => p.lines.flatMap(l => l.words)));
  // The page's lines of words, as the engine found them (a table with no lines reads row by row from these).
  const plines = (a.data.blocks ?? []).flatMap(b => b.paragraphs.flatMap(p => p.lines))
    .map(l => ({ w: l.words.filter(x => x.text.trim()).map(x => ({ t: x.text.trim(), x0: x.bbox.x0, x1: x.bbox.x1, y0: x.bbox.y0, y1: x.bbox.y1 })) }))
    .filter(l => l.w.length);
  if (plines.length) out.lines = { x0: 0, x1: pm.width ?? 0, rows: plines.slice(0, 400) };
  const anch = words.filter(x => ANCHOR.test(x.text.trim()) && x.confidence > 30);
  if (anch.length >= 2 && pm.width && pm.height) {
    let x0 = Math.min(...anch.map(x => x.bbox.x0)), x1 = Math.max(...anch.map(x => x.bbox.x1));
    let y0 = Math.min(...anch.map(x => x.bbox.y0)), y1 = Math.max(...anch.map(x => x.bbox.y1));
    const padX = Math.max(80, (x1 - x0) * 0.25), padY = Math.max(60, (y1 - y0) * 0.35);
    // Below the last heading word there may be several rows still: room for them.
    const down = Math.max(padY, (y1 - y0) * 0.9);
    x0 = Math.max(0, Math.round(x0 - padX)); y0 = Math.max(0, Math.round(y0 - padY));
    x1 = Math.min(pm.width, Math.round(x1 + padX)); y1 = Math.min(pm.height, Math.round(y1 + down));
    if (x1 - x0 > 40 && y1 - y0 > 30) {
      const scale = Math.min(4, Math.max(1.5, 2600 / (x1 - x0)));
      const crop = await sharp(page).extract({ left: x0, top: y0, width: x1 - x0, height: y1 - y0 }).resize({ width: Math.round((x1 - x0) * scale) }).sharpen().png().toBuffer();
      out.table = (await w.recognize(crop)).data.text;
    }
  }
  // Every ruled table, read with its words' places.
  try { const g = await pictureTables(buf); if (g.length) out.grids = g; } catch { /* the words above still read */ }
  out.ms = Date.now() - t0;
  return out;
}

/** An Excel sheet as lines of text, each row's cells side by side — the same shape the parser reads from a picture. */
export async function readExcel(buf: Buffer): Promise<OcrText> {
  const t0 = Date.now();
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as unknown as ArrayBuffer);
  const lines: string[] = [];
  const grids: TTable[] = [];
  wb.eachSheet(ws => {
    // Each worksheet a table: its cells where they are (a column 100 wide, a row 20 high) and every column's line.
    const grid: TTable = { x0: 0, x1: (ws.columnCount + 1) * 100, rows: [], vl: Array.from({ length: ws.columnCount + 2 }, (_, i) => ({ x: i * 100 + 95, y0: 0, y1: (ws.rowCount + 2) * 20 })) };
    ws.eachRow({ includeEmpty: false }, (row, rn) => {
      const cells: string[] = [];
      const words: { t: string; x0: number; x1: number; y0: number; y1: number }[] = [];
      row.eachCell({ includeEmpty: false }, (c, cn) => {
        const v = c.value as unknown;
        let s = "";
        if (v == null) s = "";
        else if (typeof v === "object") {
          const o = v as { result?: unknown; richText?: { text: string }[]; text?: string; hyperlink?: string };
          s = o.richText ? o.richText.map(r => r.text).join("") : o.result !== undefined ? String(o.result ?? "") : o.text ?? "";
        } else s = String(v);
        // Numbers as the sheet shows them to a person (no 0.30000000000000004).
        if (typeof v === "number" || (typeof v === "object" && typeof (v as { result?: unknown }).result === "number")) {
          const num = Number(s); if (Number.isFinite(num)) s = String(Math.round(num * 1000) / 1000);
        }
        if (s.trim()) { cells.push(s.trim()); words.push({ t: s.trim(), x0: cn * 100, x1: cn * 100 + 90, y0: rn * 20, y1: rn * 20 + 15 }); }
      });
      if (cells.length) { lines.push(cells.join("  ")); grid.rows.push({ w: words }); }
    });
    if (grid.rows.length) grids.push(grid);
  });
  return { page: lines.join("\n"), w: 0, h: 0, ms: Date.now() - t0, ...(grids.length ? { grids } : {}) };
}

