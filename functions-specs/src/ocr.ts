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
import path from "path";
import sharp from "sharp";
import ExcelJS from "exceljs";
import { createWorker, PSM, type Worker } from "tesseract.js";

/** Bumped when the reading itself changes (not the parser) — texts read before are read again. */
export const OCR_VERSION = 1;

export interface OcrText { page: string; table?: string; w: number; h: number; ms: number }

// One engine per server instance (a task at a time), started on the first picture.
let worker: Promise<Worker> | null = null;
function engine(): Promise<Worker> {
  if (!worker) {
    const langPath = path.join(path.dirname(require.resolve("@tesseract.js-data/eng/package.json")), "4.0.0_best_int");
    worker = createWorker("eng", 1, { langPath, gzip: true, cacheMethod: "none" }).catch(e => { worker = null; throw e; });
  }
  return worker;
}

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
  out.ms = Date.now() - t0;
  return out;
}

/** An Excel sheet as lines of text, each row's cells side by side — the same shape the parser reads from a picture. */
export async function readExcel(buf: Buffer): Promise<OcrText> {
  const t0 = Date.now();
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as unknown as ArrayBuffer);
  const lines: string[] = [];
  wb.eachSheet(ws => {
    ws.eachRow({ includeEmpty: false }, row => {
      const cells: string[] = [];
      row.eachCell({ includeEmpty: false }, c => {
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
        if (s.trim()) cells.push(s.trim());
      });
      if (cells.length) lines.push(cells.join("  "));
    });
  });
  return { page: lines.join("\n"), w: 0, h: 0, ms: Date.now() - t0 };
}

export async function stopEngine(): Promise<void> {
  if (worker) { const w = await worker.catch(() => null); worker = null; await w?.terminate(); }
}
