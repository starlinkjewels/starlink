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
}): void {
  const doc = new jsPDF();
  doc.setFont("helvetica", "bold"); doc.setFontSize(18);
  doc.text("STARLINK JEWELS", 20, 20);
  doc.setFont("helvetica", "normal"); doc.setFontSize(11);
  doc.text(opts.title, 20, 28);
  doc.setLineWidth(0.4); doc.line(20, 33, 190, 33);

  let y = 42;
  doc.setFontSize(10);
  for (const line of opts.subjectLines) { doc.text(line, 20, y); y += 6; }

  if (opts.summary.length) {
    y += 3;
    doc.setFont("helvetica", "bold"); doc.setFontSize(11);
    doc.text("Summary", 20, y); y += 7;
    doc.setFont("helvetica", "normal"); doc.setFontSize(10);
    for (const s of opts.summary) { doc.text(`${s.label}: ${s.value}`, 20, y); y += 6; }
  }
  y += 4;
  doc.line(20, y, 190, y);
  y += 8;

  doc.setFont("helvetica", "bold"); doc.setFontSize(9);
  for (const c of opts.columns) doc.text(c.header, c.x, y);
  y += 3;
  doc.line(20, y, 190, y);
  y += 6;

  doc.setFont("helvetica", "normal"); doc.setFontSize(8.5);
  for (const row of opts.rows) {
    if (y > 275) { doc.addPage(); y = 20; }
    row.forEach((cell, i) => doc.text(cell, opts.columns[i].x, y));
    y += 7;
  }
  if (opts.rows.length === 0) { doc.text("No records.", 20, y); }

  doc.text(`Generated: ${new Date().toLocaleString("en-US", { month: "long", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" })}`, 20, 289);

  doc.save(opts.filename.endsWith(".pdf") ? opts.filename : `${opts.filename}.pdf`);
}
