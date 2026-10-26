// A product sheet for Ready Stock pieces — one A4 page a piece: the company at
// the top, the photos and the CAD, gold and diamond details, the price when it
// is shown. The same figures as the share link; built in the browser.
//
// Photos are read from storage (which has to allow this site to read them —
// SS Diam's does). One that can't be read leaves a marked empty box rather
// than failing the sheet.
import { jsPDF } from "jspdf";
import { fmtMoney, type ShareBrand, type SharePiece } from "./db";

interface Img { data: string; w: number; h: number }

/** The photo's bytes. Starlink's storage won't let a browser read them, so
 *  those come through this site (api/img.ts, on Vercel) when a direct read
 *  is refused. SS Diam's storage allows the direct read. */
async function photoBlob(url: string): Promise<Blob | null> {
  try {
    const res = await fetch(url, { mode: "cors" });
    if (res.ok) return await res.blob();
  } catch { /* refused — try through the site */ }
  if (/^https:\/\/firebasestorage\.googleapis\.com\/v0\/b\/starlinkjewels109\./.test(url)) {
    try {
      const res = await fetch(`/api/img?u=${encodeURIComponent(url)}`);
      if (res.ok && /^image\//.test(res.headers.get("content-type") ?? "")) return await res.blob();
    } catch { /* not available here */ }
  }
  return null;
}

/** A photo, shrunk to at most `max` px on its long side, as a JPEG. */
export async function loadImg(url: string, max = 1400): Promise<Img | null> {
  try {
    const blob = await photoBlob(url);
    if (!blob) return null;
    const bmp = await createImageBitmap(blob);
    const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
    const w = Math.max(1, Math.round(bmp.width * k)), h = Math.max(1, Math.round(bmp.height * k));
    const c = document.createElement("canvas");
    c.width = w; c.height = h;
    const ctx = c.getContext("2d")!;
    ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, w, h);
    ctx.drawImage(bmp, 0, 0, w, h);
    return { data: c.toDataURL("image/jpeg", 0.86), w, h };
  } catch { return null; }
}

const INK: [number, number, number] = [15, 23, 42];
const MUTED: [number, number, number] = [100, 116, 139];
const LINE: [number, number, number] = [226, 232, 240];
const GOLD: [number, number, number] = [176, 141, 87];

/** Draw an image inside a box, whole (never cropped), centred, on white. */
function fitImage(doc: jsPDF, img: Img | null, x: number, y: number, w: number, h: number, label?: string) {
  doc.setDrawColor(...LINE); doc.setFillColor(255, 255, 255);
  doc.roundedRect(x, y, w, h, 2, 2, "FD");
  if (img) {
    const k = Math.min((w - 4) / img.w, (h - 4) / img.h);
    const iw = img.w * k, ih = img.h * k;
    doc.addImage(img.data, "JPEG", x + (w - iw) / 2, y + (h - ih) / 2, iw, ih, undefined, "FAST");
  } else {
    doc.setFontSize(7); doc.setTextColor(...MUTED);
    doc.text(w < 40 ? "No photo" : "Photo not available", x + w / 2, y + h / 2, { align: "center" });
  }
  if (label) {
    doc.setFillColor(...INK); doc.roundedRect(x + 2, y + 2, doc.getTextWidth(label) * 1.15 + 5, 5.2, 1.2, 1.2, "F");
    doc.setFontSize(7); doc.setTextColor(255, 255, 255); doc.setFont("helvetica", "bold");
    doc.text(label, x + 4.5, y + 5.7);
    doc.setFont("helvetica", "normal");
  }
}

/** A titled card of label → value lines. Returns its height. */
function card(doc: jsPDF, title: string, rows: [string, string][], x: number, y: number, w: number): number {
  const h = 11 + rows.length * 7 + 2;
  doc.setDrawColor(...LINE); doc.setFillColor(248, 250, 252);
  doc.roundedRect(x, y, w, h, 2.5, 2.5, "FD");
  doc.setFont("helvetica", "bold"); doc.setFontSize(9); doc.setTextColor(...GOLD);
  doc.text(title.toUpperCase(), x + 5, y + 7);
  doc.setFont("helvetica", "normal");
  rows.forEach(([k, v], i) => {
    const ry = y + 14 + i * 7;
    doc.setFontSize(9); doc.setTextColor(...MUTED); doc.text(k, x + 5, ry);
    doc.setTextColor(...INK); doc.setFont("helvetica", "bold");
    doc.text(doc.splitTextToSize(v, w * 0.55)[0] ?? v, x + w - 5, ry, { align: "right" });
    doc.setFont("helvetica", "normal");
  });
  return h;
}

export function goldRows(p: SharePiece): [string, string][] {
  return ([
    ["Metal", p.metal],
    ["Karat", p.karat],
    ["Colour", p.colour],
    ["Gross weight", p.grossG ? `${p.grossG} g` : undefined],
    ["Net weight", p.netG ? `${p.netG} g` : undefined],
  ] as [string, string | undefined][]).filter((r): r is [string, string] => !!r[1]);
}

export function diamondRows(p: SharePiece): [string, string][] {
  return ([
    ["Shape", p.diamondShape],
    ["Type", p.diamondType],
    ["Weight", p.diamondCt ? `${p.diamondCt} ct` : undefined],
    ["Pieces", p.diamondPcs ? String(p.diamondPcs) : undefined],
    ["Colour · clarity", p.diamondQuality],
  ] as [string, string | undefined][]).filter((r): r is [string, string] => !!r[1]);
}

/** Build the sheet and save it. Returns how many photos could not be read. */
export async function downloadPiecesPdf(pieces: SharePiece[], brand: ShareBrand, opts: { title: string; note?: string; filename?: string }): Promise<number> {
  const doc = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });
  const W = 210, M = 14;
  let missing = 0;
  const logo = brand.logo ? await loadImg(brand.logo, 600) : null;
  const date = new Date().toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" });

  for (let n = 0; n < pieces.length; n++) {
    const p = pieces[n];
    if (n > 0) doc.addPage();

    // ── Company header ──
    let hx = M;
    if (logo) {
      const lh = 12, lw = Math.min(40, (logo.w / logo.h) * lh);
      doc.addImage(logo.data, "JPEG", M, 12, lw, lh, undefined, "FAST");
      hx = M + lw + 4;
    }
    doc.setFont("helvetica", "bold"); doc.setFontSize(13); doc.setTextColor(...INK);
    doc.text(brand.name, hx, 19.5);
    doc.setFont("helvetica", "normal"); doc.setFontSize(8); doc.setTextColor(...MUTED);
    doc.text(opts.title, W - M, 16.5, { align: "right" });
    doc.text(date, W - M, 21, { align: "right" });
    doc.setDrawColor(...GOLD); doc.setLineWidth(0.6); doc.line(M, 28, W - M, 28); doc.setLineWidth(0.2);

    // ── The piece ──
    doc.setFont("helvetica", "bold"); doc.setFontSize(17); doc.setTextColor(...INK);
    doc.text(doc.splitTextToSize(p.name, W - 2 * M)[0] ?? p.name, M, 39);
    doc.setFont("helvetica", "normal"); doc.setFontSize(9.5); doc.setTextColor(...MUTED);
    doc.text([p.type, p.sku ? `SKU ${p.sku}` : ""].filter(Boolean).join("   ·   "), M, 45);

    // ── Photos: the main one large, the rest and the CAD beside it ──
    const photos = await Promise.all(p.photos.slice(0, 4).map(u => loadImg(u)));
    const cad = p.cad ? await loadImg(p.cad) : null;
    missing += photos.filter(x => !x).length + (p.cad && !cad ? 1 : 0);
    const side: { img: Img | null; label?: string }[] = [
      ...photos.slice(1).map(img => ({ img })),
      ...(p.cad ? [{ img: cad, label: "CAD" }] : []),
    ].slice(0, 3);
    const top = 50, big = side.length ? 112 : W - 2 * M;
    const bigH = 112;
    if (photos.length || !p.cad) fitImage(doc, photos[0] ?? null, M, top, big, bigH);
    else fitImage(doc, cad, M, top, big, bigH, "CAD");
    if (side.length) {
      const sx = M + big + 4, sw = W - M - sx, gap = 3;
      const sh = (bigH - gap * (side.length - 1)) / side.length;
      side.forEach((s, i) => fitImage(doc, s.img, sx, top + i * (sh + gap), sw, sh, s.label));
    }

    // ── Gold and diamonds ──
    let y = top + bigH + 8;
    const g = goldRows(p), dRows = diamondRows(p);
    const cards = [g.length ? ["Gold", g] : null, dRows.length ? ["Diamonds", dRows] : null].filter(Boolean) as [string, [string, string][]][];
    if (cards.length) {
      const cw = cards.length === 2 ? (W - 2 * M - 6) / 2 : W - 2 * M;
      const hs = cards.map(([t, rows], i) => card(doc, t, rows, M + i * (cw + 6), y, cw));
      y += Math.max(...hs) + 8;
    }

    // ── Price ──
    if (p.price != null) {
      doc.setFillColor(...INK); doc.roundedRect(M, y, W - 2 * M, 16, 2.5, 2.5, "F");
      doc.setFontSize(10); doc.setTextColor(255, 255, 255); doc.text("Price", M + 6, y + 10);
      doc.setFont("helvetica", "bold"); doc.setFontSize(15);
      doc.text(fmtMoney(p.price), W - M - 6, y + 10.6, { align: "right" });
      doc.setFont("helvetica", "normal");
      y += 22;
    }

    // ── A line for the client ──
    if (opts.note && y < 262) {
      doc.setFontSize(9); doc.setTextColor(...MUTED);
      doc.text(doc.splitTextToSize(opts.note, W - 2 * M).slice(0, 3), M, y + 2);
    }

    // ── Footer ──
    doc.setDrawColor(...LINE); doc.line(M, 282, W - M, 282);
    doc.setFontSize(7.5); doc.setTextColor(...MUTED);
    doc.text([brand.website, brand.email, brand.phone].filter(Boolean).join("   ·   "), M, 287);
    doc.text(`${n + 1} / ${pieces.length}`, W - M, 287, { align: "right" });
  }
  const safe = (opts.filename || opts.title || "Ready-Stock").replace(/[^\w.-]+/g, "_").slice(0, 60);
  doc.save(`${safe}.pdf`);
  return missing;
}

/** One row of the Ready Stock list PDF. */
export interface StockRow {
  photo?: string; name: string; sku?: string; type: string; metal: string;
  grossG?: number; netG?: number; diamondCt?: number; qty: number; price: number;
}

/**
 * Ready Stock → Export → PDF: the list as a table, a photo on every row.
 * Landscape A4, the header row repeated on each page, totals at the top.
 */
export async function downloadStockListPdf(rows: StockRow[], brand: ShareBrand, opts: { title: string; subject: string; filename: string }): Promise<number> {
  const doc = new jsPDF({ unit: "mm", format: "a4", orientation: "landscape" });
  const W = 297, H = 210, M = 12;
  // Photos six at a time — a long list would otherwise ask for every one at once.
  const imgs: (Img | null)[] = new Array(rows.length).fill(null);
  for (let i = 0; i < rows.length; i += 6) {
    const got = await Promise.all(rows.slice(i, i + 6).map(r => (r.photo ? loadImg(r.photo, 360) : Promise.resolve(null))));
    got.forEach((g, k) => { imgs[i + k] = g; });
  }
  const missing = rows.filter((r, i) => r.photo && !imgs[i]).length;
  const logo = brand.logo ? await loadImg(brand.logo, 600) : null;
  const sum = (f: (r: StockRow) => number) => Math.round(rows.reduce((s, r) => s + f(r), 0) * 1000) / 1000;
  const cols: { h: string; x: number; right?: boolean }[] = [
    { h: "Photo", x: M }, { h: "Piece", x: M + 26 }, { h: "Item", x: 104 }, { h: "Metal", x: 132 },
    { h: "Gross", x: 186, right: true }, { h: "Net", x: 204, right: true }, { h: "Dia ct", x: 222, right: true },
    { h: "Qty", x: 236, right: true }, { h: "Price", x: 260, right: true }, { h: "Total", x: W - M, right: true },
  ];
  const ROW = 22;
  const head = (first: boolean) => {
    let hx = M;
    if (logo) { const lh = 10, lw = Math.min(34, (logo.w / logo.h) * lh); doc.addImage(logo.data, "JPEG", M, 10, lw, lh, undefined, "FAST"); hx = M + lw + 4; }
    doc.setFont("helvetica", "bold"); doc.setFontSize(12); doc.setTextColor(...INK); doc.text(brand.name, hx, 16.5);
    doc.setFont("helvetica", "normal"); doc.setFontSize(8); doc.setTextColor(...MUTED);
    doc.text(opts.title, W - M, 13.5, { align: "right" });
    doc.text(new Date().toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" }), W - M, 18, { align: "right" });
    doc.setDrawColor(...GOLD); doc.setLineWidth(0.6); doc.line(M, 23, W - M, 23); doc.setLineWidth(0.2);
    let y = 30;
    if (first) {
      doc.setFontSize(9); doc.setTextColor(...MUTED); doc.text(opts.subject, M, y);
      const tiles: [string, string][] = [
        ["Pieces", String(sum(r => r.qty))], ["Gross weight", `${sum(r => (r.grossG ?? 0) * r.qty)} g`],
        ["Diamond", `${sum(r => (r.diamondCt ?? 0) * r.qty)} ct`], ["Value", fmtMoney(sum(r => r.price * r.qty))],
      ];
      tiles.forEach(([k, v], i) => {
        const tx = M + i * 66, ty = y + 4;
        doc.setDrawColor(...LINE); doc.setFillColor(248, 250, 252); doc.roundedRect(tx, ty, 62, 14, 2, 2, "FD");
        doc.setFontSize(7.5); doc.setTextColor(...MUTED); doc.text(k.toUpperCase(), tx + 4, ty + 5);
        doc.setFont("helvetica", "bold"); doc.setFontSize(11); doc.setTextColor(...INK); doc.text(v, tx + 4, ty + 11); doc.setFont("helvetica", "normal");
      });
      y += 24;
    }
    doc.setFillColor(...INK); doc.rect(M, y, W - 2 * M, 8, "F");
    doc.setFont("helvetica", "bold"); doc.setFontSize(8); doc.setTextColor(255, 255, 255);
    cols.forEach(c => doc.text(c.h, c.right ? c.x - 1 : c.x + 1, y + 5.4, { align: c.right ? "right" : "left" }));
    doc.setFont("helvetica", "normal");
    return y + 8;
  };
  let y = head(true);
  rows.forEach((r, i) => {
    if (y + ROW > H - 12) { doc.addPage(); y = head(false); }
    if (i % 2 === 1) { doc.setFillColor(250, 251, 253); doc.rect(M, y, W - 2 * M, ROW, "F"); }
    fitImage(doc, imgs[i] ?? null, M + 1, y + 1.5, 22, ROW - 3);
    const mid = y + ROW / 2 + 1;
    doc.setFont("helvetica", "bold"); doc.setFontSize(9); doc.setTextColor(...INK);
    doc.text(doc.splitTextToSize(r.name, 50)[0] ?? r.name, M + 27, mid - 2);
    doc.setFont("helvetica", "normal"); doc.setFontSize(7.5); doc.setTextColor(...MUTED);
    if (r.sku) doc.text(`SKU ${r.sku}`, M + 27, mid + 2.5);
    doc.setFontSize(8.5); doc.setTextColor(...INK);
    const cell = (v: string, c: number) => doc.text(v, cols[c].right ? cols[c].x - 1 : cols[c].x + 1, mid, { align: cols[c].right ? "right" : "left" });
    cell(doc.splitTextToSize(r.type, 26)[0] ?? r.type, 2);
    cell(doc.splitTextToSize(r.metal, 50)[0] ?? r.metal, 3);
    cell(r.grossG ? `${r.grossG} g` : "—", 4); cell(r.netG ? `${r.netG} g` : "—", 5);
    cell(r.diamondCt ? String(r.diamondCt) : "—", 6); cell(String(r.qty), 7);
    cell(fmtMoney(r.price), 8);
    doc.setFont("helvetica", "bold"); cell(fmtMoney(Math.round(r.price * r.qty * 100) / 100), 9); doc.setFont("helvetica", "normal");
    doc.setDrawColor(...LINE); doc.line(M, y + ROW, W - M, y + ROW);
    y += ROW;
  });
  const pages = doc.getNumberOfPages();
  for (let n = 1; n <= pages; n++) {
    doc.setPage(n); doc.setFontSize(7.5); doc.setTextColor(...MUTED);
    doc.text([brand.website, brand.email, brand.phone].filter(Boolean).join("   ·   "), M, H - 6);
    doc.text(`${n} / ${pages}`, W - M, H - 6, { align: "right" });
  }
  doc.save(`${opts.filename.replace(/[^\w.-]+/g, "_").slice(0, 60) || "Ready-Stock"}.pdf`);
  return missing;
}
