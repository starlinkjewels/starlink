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

/** A photo, shrunk to at most `max` px on its long side, as a JPEG. */
async function loadImg(url: string, max = 1400): Promise<Img | null> {
  try {
    const res = await fetch(url, { mode: "cors" });
    if (!res.ok) return null;
    const bmp = await createImageBitmap(await res.blob());
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
    doc.text("Photo not available", x + w / 2, y + h / 2, { align: "center" });
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
