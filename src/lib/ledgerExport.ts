// Shared CSV/PDF export for the manufacturing ledgers (Locker, Supplier,
// Factory) — same plain-text jsPDF layout style already used for
// ClientHistory/Reports (no autoTable dependency, manual column x positions).
import jsPDF from "jspdf";

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
  const anchorX = (i: number) => (alignOf(i) === "right" ? (i < cols.length - 1 ? cols[i + 1].x - 3 : R) : cols[i].x);
  const cell = (text: string, i: number, y: number) => doc.text(text, anchorX(i), y, { align: alignOf(i) });

  const brand = () => { doc.setFillColor(47, 93, 170); doc.rect(0, 0, PAGE_W, 26, "F"); };
  const pageHeader = () => {
    brand();
    doc.setTextColor(255); doc.setFont("helvetica", "bold"); doc.setFontSize(16);
    doc.text("STARLINK JEWELS", L, 12);
    doc.setFont("helvetica", "normal"); doc.setFontSize(10);
    doc.text(opts.title, L, 20);
    doc.setTextColor(30);
  };

  const tableHead = (y: number) => {
    doc.setFillColor(234, 238, 246);
    doc.rect(L - 2, y - 4.6, R - L + 4, 7, "F");
    doc.setFont("helvetica", "bold"); doc.setFontSize(8.5); doc.setTextColor(35, 55, 95);
    cols.forEach((c, i) => cell(c.header, i, y));
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
  for (const row of opts.rows) {
    if (y > yBreak) { doc.addPage(); pageHeader(); y = tableHead(34); doc.setFont("helvetica", "normal"); doc.setFontSize(8.5); zebra = false; }
    if (zebra) { doc.setFillColor(247, 249, 252); doc.rect(L - 2, y - 4.3, R - L + 4, 6.4, "F"); }
    zebra = !zebra;
    doc.setTextColor(50);
    row.forEach((c, i) => cell(String(c ?? ""), i, y));
    y += 6.4;
  }
  if (opts.rows.length === 0) { doc.setTextColor(120); doc.text("No records.", L, y + 2); doc.setTextColor(50); }

  if (opts.totalsRow) {
    doc.setDrawColor(150); doc.setLineWidth(0.3); doc.line(L - 2, y - 1.5, R + 2, y - 1.5);
    y += 3.5;
    doc.setFont("helvetica", "bold"); doc.setFontSize(9); doc.setTextColor(20);
    opts.totalsRow.forEach((c, i) => { if (c !== "") cell(String(c), i, y); });
  }

  // Footer with page numbers on every page.
  const pages = doc.getNumberOfPages();
  const stamp = `Generated: ${new Date().toLocaleString("en-US", { month: "long", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" })}`;
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    doc.setFont("helvetica", "normal"); doc.setFontSize(8); doc.setTextColor(140);
    doc.text(stamp, L, yFooter);
    doc.text(`Page ${p} of ${pages}`, R, yFooter, { align: "right" });
  }

  doc.save(opts.filename.endsWith(".pdf") ? opts.filename : `${opts.filename}.pdf`);
}
