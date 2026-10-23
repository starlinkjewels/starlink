// Shared CSV/PDF export for the manufacturing ledgers (Locker, Supplier,
// Factory) — same plain-text jsPDF layout style already used for
// ClientHistory/Reports (no autoTable dependency, manual column x positions).
import jsPDF from "jspdf";
import { logEvent } from "./db";
import { exportAllowed } from "./access";

/** jsPDF's built-in fonts can't render ₹ — plain-text amount for PDF cells only. */
export function fmtInrPlain(n: number): string {
  return "Rs. " + Math.round(n).toLocaleString("en-IN");
}

function csvCell(v: string | number): string {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Downloads a UTF-8 CSV (opens directly in Excel) — BOM prefix so ₹/special chars render correctly. */
export function downloadCsv(filename: string, headers: string[], rows: (string | number)[][]): void {
  if (!exportAllowed()) return;
  logEvent("export", `Downloaded ${filename.endsWith(".csv") ? filename : `${filename}.csv`} — ${rows.length} row${rows.length !== 1 ? "s" : ""}`, { file: filename, rows: rows.length });
  const lines = [headers.map(csvCell).join(","), ...rows.map(r => r.map(csvCell).join(","))];
  const blob = new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename.endsWith(".csv") ? filename : `${filename}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export interface PdfColumn {
  header: string;
  x: number;
}

/**
 * Generic ledger PDF — header block, subject lines, summary, then a table.
 * jsPDF's built-in fonts can't render ₹, so amounts passed in here should use
 * a plain-text prefix (e.g. "Rs. 1,25,000"), never the ₹ glyph.
 */
export function downloadLedgerPdf(opts: {
  title: string;
  subjectLines: string[];
  summary: { label: string; value: string }[];
  columns: PdfColumn[];
  rows: string[][];
  filename: string;
  /** Per-column text alignment (defaults to all "left"). Right-align money/qty. */
  align?: ("left" | "right")[];
  /** Optional bold totals row rendered under a rule at the bottom of the table. */
  totalsRow?: string[];
  /** Landscape A4 for wide tables (more room, no truncated particulars). */
  landscape?: boolean;
  /** Optional grouping band drawn ABOVE the column headers (e.g. DEBIT / CREDIT),
   *  each label centred between startX and endX (in the same mm units as columns). */
  groupHeaders?: { label: string; startX: number; endX: number }[];
  /** The company named at the top — a client's own statement carries the
   *  company that sells to them. Blank = the first company, as always. */
  company?: string;
  /** A small picture on each row (same order as `rows`; data URLs from pdfThumb, null = none),
   *  in a column of its own at `x`. Rows grow tall enough to show it. */
  pictures?: { header: string; x: number; images: (string | null | undefined)[] };
}): void {
  const doc = new jsPDF(opts.landscape ? { orientation: "landscape" } : undefined);
  const PAGE_W = opts.landscape ? 297 : 210;
  const PAGE_H = opts.landscape ? 210 : 297;
  const L = 14, R = PAGE_W - 14;
  const yBreak = PAGE_H - 17;   // start a new page below this
  const yFooter = PAGE_H - 6;   // footer baseline
  const cols = opts.columns;

  // For right-aligned columns, anchor text at the column's right edge (just
  // before the next column starts, or the page margin for the last one).
  const alignOf = (i: number): "left" | "right" => (opts.align?.[i] === "right" ? "right" : "left");
  // A row with more cells than columns used to crash the whole download
  // (reading .x of undefined). Extra cells are dropped instead.
  const anchorX = (i: number) => {
    const c = cols[i];
    if (!c) return null;
    return alignOf(i) === "right" ? (cols[i + 1] ? cols[i + 1].x - 3 : R) : c.x;
  };
  const cell = (text: string, i: number, yy: number) => { const x = anchorX(i); if (x != null) doc.text(text, x, yy, { align: alignOf(i) }); };

  const brand = () => { doc.setFillColor(47, 93, 170); doc.rect(0, 0, PAGE_W, 26, "F"); };
  const pageHeader = () => {
    brand();
    doc.setTextColor(255); doc.setFont("helvetica", "bold"); doc.setFontSize(16);
    doc.text((opts.company || "SHREE SUKTAM DIAMOND").toUpperCase(), L, 12);
    doc.setFont("helvetica", "normal"); doc.setFontSize(10);
    doc.text(opts.title, L, 20);
    doc.setTextColor(30);
  };

  const groupHeaders = opts.groupHeaders;
  const pics = opts.pictures;
  const tableHead = (y: number) => {
    if (groupHeaders?.length) {
      doc.setFillColor(214, 223, 240);
      doc.rect(L - 2, y - 4.6, R - L + 4, 6.4, "F");
      doc.setFont("helvetica", "bold"); doc.setFontSize(8); doc.setTextColor(35, 55, 95);
      for (const g of groupHeaders) doc.text(g.label, (g.startX + g.endX) / 2, y, { align: "center" });
      y += 6.6;
    }
    doc.setFillColor(234, 238, 246);
    doc.rect(L - 2, y - 4.6, R - L + 4, 7, "F");
    doc.setFont("helvetica", "bold"); doc.setFontSize(8.5); doc.setTextColor(35, 55, 95);
    cols.forEach((c, i) => cell(c.header, i, y));
    if (pics) doc.text(pics.header, pics.x, y);
    doc.setTextColor(45);
    return y + 6.5;
  };

  pageHeader();
  let y = 34;
  doc.setFont("helvetica", "normal"); doc.setFontSize(9); doc.setTextColor(95);
  for (const line of opts.subjectLines) { doc.text(line, L, y); y += 5; }
  doc.setTextColor(30);

  if (opts.summary.length) {
    y += 2;
    doc.setFont("helvetica", "bold"); doc.setFontSize(10); doc.text("Summary", L, y); y += 6;
    doc.setFont("helvetica", "normal"); doc.setFontSize(9.5);
    for (const s of opts.summary) { doc.text(`${s.label}:`, L, y); doc.setFont("helvetica", "bold"); doc.text(s.value, L + 42, y); doc.setFont("helvetica", "normal"); y += 5.5; }
    y += 2;
  }

  y = tableHead(y);

  doc.setFont("helvetica", "normal"); doc.setFontSize(8.5);
  let zebra = false;
  // With pictures, each row is as tall as its picture and the words sit in its middle.
  const PIC = 12;
  const rowH = pics ? PIC + 2.4 : 6.4;
  const textDy = pics ? (PIC / 2) - 2.2 : 0;
  opts.rows.forEach((row, ri) => {
    if (y + (pics ? PIC - 4 : 0) > yBreak) { doc.addPage(); pageHeader(); y = tableHead(34); doc.setFont("helvetica", "normal"); doc.setFontSize(8.5); zebra = false; }
    if (zebra) { doc.setFillColor(247, 249, 252); doc.rect(L - 2, y - 4.3, R - L + 4, rowH, "F"); }
    zebra = !zebra;
    doc.setTextColor(50);
    row.forEach((c, i) => cell(String(c ?? ""), i, y + textDy));
    const img = pics?.images[ri];
    if (pics && img) {
      try { doc.addImage(img, "JPEG", pics.x, y - 3.4, PIC, PIC); } catch { /* a picture that can't be drawn is left out */ }
    }
    y += rowH;
  });
  if (opts.rows.length === 0) { doc.setTextColor(120); doc.text("No records.", L, y + 2); doc.setTextColor(50); }

  if (opts.totalsRow) {
    doc.setDrawColor(150); doc.setLineWidth(0.3); doc.line(L - 2, y - 1.5, R + 2, y - 1.5);
    y += 3.5;
    doc.setFont("helvetica", "bold"); doc.setFontSize(9); doc.setTextColor(20);
    opts.totalsRow.forEach((c, i) => { if (c !== "") cell(String(c), i, y); });
  }

  // Footer with page numbers on every page.
  const pages = doc.getNumberOfPages();
  const stamp = `Generated: ${new Date().toLocaleString("en-IN", { month: "long", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" })}`;
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    doc.setFont("helvetica", "normal"); doc.setFontSize(8); doc.setTextColor(140);
    doc.text(stamp, L, yFooter);
    doc.text(`Page ${p} of ${pages}`, R, yFooter, { align: "right" });
  }

  if (!exportAllowed()) return;
  logEvent("export", `Downloaded ${opts.filename.endsWith(".pdf") ? opts.filename : `${opts.filename}.pdf`} — ${opts.title}`, { file: opts.filename, title: opts.title });
  doc.save(opts.filename.endsWith(".pdf") ? opts.filename : `${opts.filename}.pdf`);
}

export interface PdfSection {
  heading: string;
  columns: PdfColumn[];
  rows: string[][];
  align?: ("left" | "right")[];
  totalsRow?: string[];
}

/** Same styling as downloadLedgerPdf, but stacks SEVERAL tables (each with its
 *  own columns) into ONE document — e.g. a factory's Account Statement + Gold
 *  Ledger + Diamond Ledger in a single PDF. */
export function downloadLedgerPdfMulti(opts: {
  title: string;
  subjectLines: string[];
  summary: { label: string; value: string }[];
  sections: PdfSection[];
  filename: string;
  landscape?: boolean;
  /** See downloadLedgerPdf. */
  company?: string;
}): void {
  const doc = new jsPDF(opts.landscape ? { orientation: "landscape" } : undefined);
  const PAGE_W = opts.landscape ? 297 : 210;
  const PAGE_H = opts.landscape ? 210 : 297;
  const L = 14, R = PAGE_W - 14;
  const yBreak = PAGE_H - 17, yFooter = PAGE_H - 6;

  const pageHeader = () => {
    doc.setFillColor(47, 93, 170); doc.rect(0, 0, PAGE_W, 26, "F");
    doc.setTextColor(255); doc.setFont("helvetica", "bold"); doc.setFontSize(16);
    doc.text((opts.company || "SHREE SUKTAM DIAMOND").toUpperCase(), L, 12);
    doc.setFont("helvetica", "normal"); doc.setFontSize(10);
    doc.text(opts.title, L, 20);
    doc.setTextColor(30);
  };

  pageHeader();
  let y = 34;
  doc.setFont("helvetica", "normal"); doc.setFontSize(9); doc.setTextColor(95);
  for (const line of opts.subjectLines) { doc.text(line, L, y); y += 5; }
  doc.setTextColor(30);
  if (opts.summary.length) {
    y += 2;
    doc.setFont("helvetica", "bold"); doc.setFontSize(10); doc.text("Summary", L, y); y += 6;
    doc.setFont("helvetica", "normal"); doc.setFontSize(9.5);
    for (const s of opts.summary) { doc.text(`${s.label}:`, L, y); doc.setFont("helvetica", "bold"); doc.text(s.value, L + 55, y); doc.setFont("helvetica", "normal"); y += 5.5; }
  }

  for (const sec of opts.sections) {
    const cols = sec.columns;
    const alignOf = (i: number): "left" | "right" => (sec.align?.[i] === "right" ? "right" : "left");
    // A row with more cells than columns used to crash the whole download
    // (reading .x of undefined). Extra cells are skipped instead.
    const anchorX = (i: number): number | null => {
      const c = cols[i];
      if (!c) return null;
      return alignOf(i) === "right" ? (cols[i + 1] ? cols[i + 1].x - 3 : R) : c.x;
    };
    const cell = (text: string, i: number, yy: number) => { const x = anchorX(i); if (x != null) doc.text(text, x, yy, { align: alignOf(i) }); };
    const tableHead = (yy: number) => {
      doc.setFillColor(234, 238, 246);
      doc.rect(L - 2, yy - 4.6, R - L + 4, 7, "F");
      doc.setFont("helvetica", "bold"); doc.setFontSize(8.5); doc.setTextColor(35, 55, 95);
      cols.forEach((c, i) => cell(c.header, i, yy));
      doc.setTextColor(45);
      return yy + 6.5;
    };

    if (y > yBreak - 22) { doc.addPage(); pageHeader(); y = 34; }
    y += 3;
    doc.setFont("helvetica", "bold"); doc.setFontSize(11); doc.setTextColor(30); doc.text(sec.heading, L, y); y += 6;
    y = tableHead(y);
    doc.setFont("helvetica", "normal"); doc.setFontSize(8.5);
    let zebra = false;
    if (sec.rows.length === 0) { doc.setTextColor(120); doc.text("No records.", L, y + 1); y += 7; doc.setTextColor(45); }
    for (const row of sec.rows) {
      if (y > yBreak) { doc.addPage(); pageHeader(); y = tableHead(34); doc.setFont("helvetica", "normal"); doc.setFontSize(8.5); zebra = false; }
      if (zebra) { doc.setFillColor(247, 249, 252); doc.rect(L - 2, y - 4.3, R - L + 4, 6.4, "F"); }
      zebra = !zebra;
      doc.setTextColor(50);
      row.forEach((c, i) => cell(String(c ?? ""), i, y));
      y += 6.4;
    }
    if (sec.totalsRow) {
      doc.setDrawColor(150); doc.setLineWidth(0.3); doc.line(L - 2, y - 1.5, R + 2, y - 1.5);
      y += 3.5;
      doc.setFont("helvetica", "bold"); doc.setFontSize(9); doc.setTextColor(20);
      sec.totalsRow.forEach((c, i) => { if (c !== "") cell(String(c), i, y); });
      y += 5;
    }
    y += 5;
  }

  const pages = doc.getNumberOfPages();
  const stamp = `Generated: ${new Date().toLocaleString("en-IN", { month: "long", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" })}`;
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    doc.setFont("helvetica", "normal"); doc.setFontSize(8); doc.setTextColor(140);
    doc.text(stamp, L, yFooter);
    doc.text(`Page ${p} of ${pages}`, R, yFooter, { align: "right" });
  }
  if (!exportAllowed()) return;
  logEvent("export", `Downloaded ${opts.filename.endsWith(".pdf") ? opts.filename : `${opts.filename}.pdf`} — ${opts.title}`, { file: opts.filename, title: opts.title });
  doc.save(opts.filename.endsWith(".pdf") ? opts.filename : `${opts.filename}.pdf`);
}

/**
 * A picture made small for a PDF row: fetched, shrunk to `max` px on its long
 * side on a white ground, as a JPEG data URL. Null when it can't be had (no
 * picture, a broken link, the storage refusing) — the row then prints without it.
 */
export async function pdfThumb(url: string | undefined, max = 160): Promise<string | null> {
  if (!url) return null;
  try {
    const blob = url.startsWith("data:") ? await (await fetch(url)).blob() : await (await fetch(url, { mode: "cors" })).blob();
    const bmp = await createImageBitmap(blob);
    const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
    const w = Math.max(1, Math.round(bmp.width * scale)), h = Math.max(1, Math.round(bmp.height * scale));
    // Square, the picture centred in it — every row's picture the same size.
    const side = Math.max(w, h);
    const canvas = document.createElement("canvas");
    canvas.width = side; canvas.height = side;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, side, side);
    ctx.drawImage(bmp, (side - w) / 2, (side - h) / 2, w, h);
    bmp.close?.();
    return canvas.toDataURL("image/jpeg", 0.8);
  } catch {
    return null;
  }
}

/** Several at once, a few at a time — the order kept. */
export async function pdfThumbs(urls: (string | undefined)[], max = 160): Promise<(string | null)[]> {
  const out: (string | null)[] = new Array(urls.length).fill(null);
  let next = 0;
  const worker = async () => { while (next < urls.length) { const i = next++; out[i] = await pdfThumb(urls[i], max); } };
  await Promise.all(Array.from({ length: Math.min(6, urls.length) }, worker));
  return out;
}
