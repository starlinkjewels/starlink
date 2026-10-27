// Product PDFs for clients — Ready Stock pieces or the pieces made on orders.
//
// Two layouts, both built in the browser:
//   • Product pages — one A4 page a piece: the company at the top, the photo
//     large with the rest beside it, the details as a spec list, the price,
//     and links to the video and to the piece online.
//   • Line sheet — many pieces to a landscape page, a photo on every row, the
//     columns a buyer reads (design, karat, weights, stones, price, video).
//
// Photos are read from storage (which has to allow this site to read them).
// One that can't be read leaves a marked empty box rather than failing the PDF.
import { jsPDF } from "jspdf";
import { fmtMoney, type ShareBrand, type SharePiece } from "./db";

interface Img { data: string; w: number; h: number }

/** The photo's bytes. Read fresh from the network, never from the browser's
 *  cache: a page that showed the photo first (as an <img>) leaves a cached copy
 *  without the cross-site permission, and reading that one is refused — the
 *  PDF then had empty boxes. Starlink's storage won't let a browser read them
 *  at all, so those come through this site (api/img.ts, on Vercel). */
async function photoBlob(url: string): Promise<Blob | null> {
  const viaSite = async () => {
    try {
      const res = await fetch(`/api/img?u=${encodeURIComponent(url)}`);
      if (res.ok && /^image\//.test(res.headers.get("content-type") ?? "")) return await res.blob();
    } catch { /* not available here */ }
    return null;
  };
  const starlink = /^https:\/\/firebasestorage\.googleapis\.com\/v0\/b\/starlinkjewels109\./.test(url);
  if (starlink) { const b = await viaSite(); if (b) return b; }
  for (const cache of ["reload", "no-store"] as RequestCache[]) {
    try {
      const res = await fetch(url, { mode: "cors", cache });
      if (res.ok) return await res.blob();
    } catch { /* refused — try the next way */ }
  }
  return null;
}

/** A photo, shrunk to at most `max` px on its long side, as a JPEG. */
export async function loadImg(url: string, max = 1600): Promise<Img | null> {
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
    return { data: c.toDataURL("image/jpeg", 0.9), w, h };
  } catch { return null; }
}

type RGB = [number, number, number];
const INK: RGB = [17, 24, 39];
const MUTED: RGB = [107, 114, 128];
const LINE: RGB = [229, 231, 235];
const GOLD: RGB = [166, 124, 62];
const CREAM: RGB = [248, 246, 241];

/** Draw an image inside a box, whole (never cropped), centred. */
function fitImage(doc: jsPDF, img: Img | null, x: number, y: number, w: number, h: number, label?: string, bg: RGB = [255, 255, 255]) {
  doc.setDrawColor(...LINE); doc.setFillColor(...bg);
  doc.roundedRect(x, y, w, h, 2, 2, "FD");
  if (img) {
    const pad = Math.min(4, w * 0.04);
    const k = Math.min((w - pad * 2) / img.w, (h - pad * 2) / img.h);
    const iw = img.w * k, ih = img.h * k;
    doc.addImage(img.data, "JPEG", x + (w - iw) / 2, y + (h - ih) / 2, iw, ih, undefined, "FAST");
  } else {
    doc.setFont("helvetica", "normal"); doc.setFontSize(7); doc.setTextColor(...MUTED);
    doc.text(w < 40 ? "No photo" : "Photo not available", x + w / 2, y + h / 2, { align: "center" });
  }
  if (label) {
    doc.setFont("helvetica", "bold"); doc.setFontSize(6.5);
    const lw = doc.getTextWidth(label) + 5;
    doc.setFillColor(...INK); doc.roundedRect(x + 2.5, y + 2.5, lw, 5, 1.2, 1.2, "F");
    doc.setTextColor(255, 255, 255); doc.text(label, x + 5, y + 6);
    doc.setFont("helvetica", "normal");
  }
}

/** A small outlined button that opens a link. */
function linkButton(doc: jsPDF, text: string, url: string, x: number, y: number, play = false): number {
  doc.setFont("helvetica", "bold"); doc.setFontSize(8);
  const w = doc.getTextWidth(text) + (play ? 13 : 9), h = 8;
  doc.setDrawColor(...GOLD); doc.setLineWidth(0.35); doc.roundedRect(x, y, w, h, 4, 4, "S"); doc.setLineWidth(0.2);
  let tx = x + 4.5;
  if (play) { doc.setFillColor(...GOLD); doc.triangle(x + 4.5, y + 2.4, x + 4.5, y + 5.6, x + 7.3, y + 4, "F"); tx = x + 9; }
  doc.setTextColor(...GOLD); doc.text(text, tx, y + 5.4);
  doc.link(x, y, w, h, { url });
  doc.setFont("helvetica", "normal");
  return w;
}

/** The company line at the top of every page. Returns where the page's content starts. */
function pageHead(doc: jsPDF, brand: ShareBrand, logo: Img | null, title: string, W: number, M: number): number {
  let hx = M;
  if (logo) {
    const lh = 11, lw = Math.min(42, (logo.w / logo.h) * lh);
    doc.addImage(logo.data, "JPEG", M, 11, lw, lh, undefined, "FAST");
    hx = M + lw + 4;
  }
  doc.setFont("times", "bold"); doc.setFontSize(14); doc.setTextColor(...INK);
  doc.text(brand.name, hx, 18.5);
  doc.setFont("helvetica", "normal"); doc.setFontSize(7.5); doc.setTextColor(...MUTED);
  doc.text(title.toUpperCase(), W - M, 15.5, { align: "right" });
  doc.text(new Date().toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" }), W - M, 20, { align: "right" });
  doc.setDrawColor(...GOLD); doc.setLineWidth(0.5); doc.line(M, 26, W - M, 26); doc.setLineWidth(0.2);
  return 33;
}

/** Contacts and the page number, on every page. */
function pageFoot(doc: jsPDF, brand: ShareBrand, W: number, H: number, M: number) {
  const pages = doc.getNumberOfPages();
  for (let n = 1; n <= pages; n++) {
    doc.setPage(n);
    doc.setDrawColor(...LINE); doc.line(M, H - 12, W - M, H - 12);
    doc.setFont("helvetica", "normal"); doc.setFontSize(7.5); doc.setTextColor(...MUTED);
    doc.text([brand.website, brand.email, brand.phone].filter(Boolean).join("     "), M, H - 7);
    doc.text(`${n} / ${pages}`, W - M, H - 7, { align: "right" });
  }
}

export function goldRows(p: SharePiece): [string, string][] {
  return ([
    ["Metal", p.metal],
    ["Karat", p.karat],
    ["Colour", p.colour],
    [p.weightsEstimated ? "Gross weight (est.)" : "Gross weight", p.grossG ? `${p.grossG} g` : undefined],
    [p.weightsEstimated ? "Net weight (est.)" : "Net weight", p.netG ? `${p.netG} g` : undefined],
  ] as [string, string | undefined][]).filter((r): r is [string, string] => !!r[1]);
}

export function diamondRows(p: SharePiece): [string, string][] {
  return ([
    ["Shape", p.diamondShape],
    ["Size", p.diamondSize],
    ["Type", p.diamondType],
    ["Weight", p.diamondCt ? `${p.diamondCt} ct` : undefined],
    ["Pieces", p.diamondPcs ? String(p.diamondPcs) : undefined],
    ["Colour · clarity", p.diamondQuality],
  ] as [string, string | undefined][]).filter((r): r is [string, string] => !!r[1]);
}

/** "18K White Gold" — the metal as one line: its own name when that says the colour, else the colour put in. */
export const metalLine = (p: Pick<SharePiece, "karat" | "colour" | "metal">) => {
  const metal = (p.metal ?? "").trim();
  const saysColour = /white|yellow|rose|pink|two.?tone|tri/i.test(metal);
  const named = !saysColour && p.colour && /^gold$/i.test(metal) ? `${p.colour} Gold` : metal;
  return [p.karat, named].filter(Boolean).join(" ");
};

/** A spec column: a small gold heading, then label — value lines on hairlines. Returns its height. */
function specList(doc: jsPDF, title: string, rows: [string, string][], x: number, y: number, w: number): number {
  doc.setFont("helvetica", "bold"); doc.setFontSize(7.5); doc.setTextColor(...GOLD);
  doc.text(title.toUpperCase(), x, y, { charSpace: 0.6 });
  let ry = y + 4;
  rows.forEach(([k, v]) => {
    doc.setDrawColor(...LINE); doc.line(x, ry, x + w, ry);
    doc.setFont("helvetica", "normal"); doc.setFontSize(9); doc.setTextColor(...MUTED);
    doc.text(k, x, ry + 5.6);
    doc.setFont("helvetica", "bold"); doc.setTextColor(...INK);
    doc.text(doc.splitTextToSize(v, w * 0.6)[0] ?? v, x + w, ry + 5.6, { align: "right" });
    ry += 8.2;
  });
  doc.setDrawColor(...LINE); doc.line(x, ry, x + w, ry);
  doc.setFont("helvetica", "normal");
  return ry - y;
}

/** Product pages: one A4 page a piece. Returns how many photos could not be read. */
export async function downloadPiecesPdf(pieces: SharePiece[], brand: ShareBrand, opts: { title: string; note?: string; filename?: string; links?: Record<string, string> }): Promise<number> {
  const doc = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });
  const W = 210, H = 297, M = 16;
  let missing = 0;
  const logo = brand.logo ? await loadImg(brand.logo, 600) : null;

  for (let n = 0; n < pieces.length; n++) {
    const p = pieces[n];
    if (n > 0) doc.addPage();
    let y = pageHead(doc, brand, logo, opts.title, W, M);

    // ── Photos: the first large on a soft ground, the rest (and the CAD) in a row under it ──
    const photos = await Promise.all(p.photos.slice(0, 5).map(u => loadImg(u)));
    const cad = p.cad ? await loadImg(p.cad) : null;
    missing += photos.filter(x => !x).length + (p.cad && !cad ? 1 : 0);
    const shots: { img: Img | null; label?: string }[] = [
      ...photos.map(img => ({ img })),
      ...(p.cad ? [{ img: cad, label: "CAD" }] : []),
    ];
    const heroH = !shots.length ? 34 : shots.length > 1 ? 112 : 128;
    if (shots.length) fitImage(doc, shots[0].img, M, y, W - 2 * M, heroH, shots[0].label, CREAM);
    else {
      doc.setDrawColor(...LINE); doc.setFillColor(...CREAM); doc.roundedRect(M, y, W - 2 * M, heroH, 2, 2, "FD");
      doc.setFont("helvetica", "normal"); doc.setFontSize(8); doc.setTextColor(...MUTED);
      doc.text("No photo of this piece yet", W / 2, y + heroH / 2 + 1, { align: "center" });
    }
    y += heroH + 3;
    const rest = shots.slice(1, 5);
    if (rest.length) {
      const gap = 3, tw = (W - 2 * M - gap * 3) / 4, th = 27;
      rest.forEach((s, i) => fitImage(doc, s.img, M + i * (tw + gap), y, tw, th, s.label, CREAM));
      y += th + 3;
    }

    // ── Name, kind, price ──
    y += 6;
    const priceW = p.price != null ? 48 : 0;
    doc.setFont("times", "bold"); doc.setFontSize(19); doc.setTextColor(...INK);
    const name = doc.splitTextToSize(p.name, W - 2 * M - priceW - 4).slice(0, 2) as string[];
    doc.text(name, M, y);
    if (p.price != null) {
      doc.setFont("helvetica", "normal"); doc.setFontSize(7); doc.setTextColor(...MUTED);
      doc.text("PRICE", W - M, y - 5.5, { align: "right" });
      doc.setFont("times", "bold"); doc.setFontSize(19); doc.setTextColor(...GOLD);
      doc.text(fmtMoney(p.price), W - M, y + 1, { align: "right" });
    }
    y += (name.length - 1) * 7.5 + 6;
    doc.setFont("helvetica", "normal"); doc.setFontSize(8); doc.setTextColor(...MUTED);
    doc.text([p.type, p.sku ? `Design ${p.sku}` : "", metalLine(p)].filter(Boolean).join("   ·   ").toUpperCase(), M, y, { charSpace: 0.35 });
    y += 9;

    // ── The details, two columns ──
    const g = goldRows(p), dRows = diamondRows(p);
    const cols = [g.length ? ["Metal & weight", g] : null, dRows.length ? ["Diamonds", dRows] : null].filter(Boolean) as [string, [string, string][]][];
    if (cols.length) {
      const cw = cols.length === 2 ? (W - 2 * M - 12) / 2 : W - 2 * M;
      const hs = cols.map(([t, rows], i) => specList(doc, t, rows, M + i * (cw + 12), y, cw));
      y += Math.max(...hs) + 8;
    }

    // ── Links: the video, the piece online ──
    const online = opts.links?.[p.id];
    if (p.video || online) {
      let lx = M;
      if (p.video) lx += linkButton(doc, "Watch the video", p.video, lx, y, true) + 4;
      if (online) linkButton(doc, "View online", online, lx, y);
      y += 13;
    }

    // ── A line for the client ──
    if (opts.note && y < H - 24) {
      doc.setFont("times", "italic"); doc.setFontSize(10); doc.setTextColor(...MUTED);
      doc.text(doc.splitTextToSize(opts.note, W - 2 * M).slice(0, 2), M, y + 2);
    }
  }
  pageFoot(doc, brand, W, H, M);
  const safe = (opts.filename || opts.title || "Products").replace(/[^\w.-]+/g, "_").slice(0, 60);
  doc.save(`${safe}.pdf`);
  return missing;
}

/**
 * Line sheet: the pieces as a table, a photo on every row — what a buyer
 * scans down. Landscape A4; the header row repeats on each page.
 */
export async function downloadLineSheetPdf(pieces: SharePiece[], brand: ShareBrand, opts: { title: string; note?: string; filename?: string; links?: Record<string, string> }): Promise<number> {
  const doc = new jsPDF({ unit: "mm", format: "a4", orientation: "landscape" });
  const W = 297, H = 210, M = 12;
  const imgs: (Img | null)[] = new Array(pieces.length).fill(null);
  for (let i = 0; i < pieces.length; i += 6) {
    const got = await Promise.all(pieces.slice(i, i + 6).map(p => (p.photos[0] || p.cad ? loadImg(p.photos[0] || p.cad!, 500) : Promise.resolve(null))));
    got.forEach((g, k) => { imgs[i + k] = g; });
  }
  const missing = pieces.filter((p, i) => (p.photos[0] || p.cad) && !imgs[i]).length;
  const logo = brand.logo ? await loadImg(brand.logo, 600) : null;
  const priced = pieces.some(p => p.price != null);
  const anyVideo = pieces.some(p => p.video || opts.links?.[p.id]);

  // Columns: widths in mm; the piece column takes what is left.
  type Col = { key: string; h: string; w: number; right?: boolean };
  const base: Col[] = [
    { key: "n", h: "#", w: 8 }, { key: "photo", h: "", w: 30 }, { key: "piece", h: "Design / piece", w: 0 },
    { key: "metal", h: "Metal", w: 30 }, { key: "gw", h: "GW (g)", w: 16, right: true }, { key: "nw", h: "NW (g)", w: 16, right: true },
    { key: "shape", h: "Shape", w: 20 }, { key: "size", h: "Size", w: 24 }, { key: "ct", h: "Ct", w: 14, right: true }, { key: "pcs", h: "Pcs", w: 11, right: true },
    ...(priced ? [{ key: "price", h: "Price", w: 22, right: true }] : []),
    ...(anyVideo ? [{ key: "video", h: "Links", w: 18 }] : []),
  ];
  const fixed = base.reduce((s, c) => s + c.w, 0);
  base.find(c => c.key === "piece")!.w = W - 2 * M - fixed;
  let cx = M; const X: Record<string, { x: number; w: number; right?: boolean }> = {};
  base.forEach(c => { X[c.key] = { x: cx, w: c.w, right: c.right }; cx += c.w; });

  const ROW = 27;
  const head = (first: boolean) => {
    let y = pageHead(doc, brand, logo, opts.title, W, M);
    if (first) {
      doc.setFont("times", "bold"); doc.setFontSize(17); doc.setTextColor(...INK);
      doc.text(opts.title, M, y + 3);
      doc.setFont("helvetica", "normal"); doc.setFontSize(8.5); doc.setTextColor(...MUTED);
      const ct = Math.round(pieces.reduce((s, p) => s + (p.diamondCt ?? 0), 0) * 100) / 100;
      doc.text([`${pieces.length} piece${pieces.length !== 1 ? "s" : ""}`, ct ? `${ct} ct diamonds in all` : "", opts.note ?? ""].filter(Boolean).join("   ·   "), M, y + 9);
      y += 15;
    }
    doc.setFillColor(...INK); doc.rect(M, y, W - 2 * M, 8, "F");
    doc.setFont("helvetica", "bold"); doc.setFontSize(7); doc.setTextColor(255, 255, 255);
    base.forEach(c => { const p = X[c.key]; doc.text(c.h.toUpperCase(), p.right ? p.x + p.w - 2 : p.x + 3, y + 5.2, { align: p.right ? "right" : "left" }); });
    doc.setFont("helvetica", "normal");
    return y + 8;
  };
  let y = head(true);
  pieces.forEach((p, i) => {
    if (y + ROW > H - 15) { doc.addPage(); y = head(false); }
    if (i % 2 === 1) { doc.setFillColor(...CREAM); doc.rect(M, y, W - 2 * M, ROW, "F"); }
    fitImage(doc, imgs[i] ?? null, X.photo.x + 1, y + 1.5, X.photo.w - 2, ROW - 3);
    const mid = y + ROW / 2 + 1.2;
    const cell = (key: string, v: string, bold = false) => {
      const c = X[key]; if (!c) return;
      doc.setFont("helvetica", bold ? "bold" : "normal"); doc.setFontSize(8.5); doc.setTextColor(...INK);
      const t = doc.splitTextToSize(v, c.w - 3)[0] ?? v;
      doc.text(t, c.right ? c.x + c.w - 2 : c.x + 3, mid, { align: c.right ? "right" : "left" });
    };
    doc.setFontSize(8); doc.setTextColor(...MUTED); doc.text(String(i + 1), X.n.x + 1.5, mid);
    // The piece: design number large, its name under it.
    doc.setFont("helvetica", "bold"); doc.setFontSize(9.5); doc.setTextColor(...INK);
    doc.text(doc.splitTextToSize(p.sku || p.type, X.piece.w - 3)[0] ?? "", X.piece.x + 1.5, mid - 2.5);
    doc.setFont("helvetica", "normal"); doc.setFontSize(7.5); doc.setTextColor(...MUTED);
    doc.text(doc.splitTextToSize(p.name, X.piece.w - 3).slice(0, 2), X.piece.x + 1.5, mid + 2);
    cell("metal", metalLine(p) || "—");
    const est = p.weightsEstimated ? "~" : "";
    cell("gw", p.grossG ? `${est}${p.grossG}` : "—"); cell("nw", p.netG ? `${est}${p.netG}` : "—");
    cell("shape", p.diamondShape ?? "—"); cell("size", p.diamondSize ?? "—");
    cell("ct", p.diamondCt ? String(p.diamondCt) : "—"); cell("pcs", p.diamondPcs ? String(p.diamondPcs) : "—");
    if (priced) {
      doc.setFont("times", "bold"); doc.setFontSize(11); doc.setTextColor(...GOLD);
      const c = X.price; doc.text(p.price != null ? fmtMoney(p.price) : "—", c.x + c.w - 2, mid, { align: "right" });
    }
    if (anyVideo) {
      const c = X.video; let ly = mid - (p.video && opts.links?.[p.id] ? 2.5 : 0);
      doc.setFont("helvetica", "bold"); doc.setFontSize(8); doc.setTextColor(...GOLD);
      const lnk = (t: string, url: string) => { doc.text(t, c.x + 1.5, ly); const tw = doc.getTextWidth(t); doc.setDrawColor(...GOLD); doc.line(c.x + 1.5, ly + 0.8, c.x + 1.5 + tw, ly + 0.8); doc.link(c.x + 1, ly - 3.5, tw + 1, 5, { url }); ly += 5; };
      if (p.video) lnk("Video", p.video);
      if (opts.links?.[p.id]) lnk("Online", opts.links[p.id]);
      if (!p.video && !opts.links?.[p.id]) { doc.setFont("helvetica", "normal"); doc.setTextColor(...MUTED); doc.text("—", c.x + 1.5, mid); }
    }
    doc.setFont("helvetica", "normal");
    doc.setDrawColor(...LINE); doc.line(M, y + ROW, W - M, y + ROW);
    y += ROW;
  });
  pageFoot(doc, brand, W, H, M);
  const safe = (opts.filename || opts.title || "Line-sheet").replace(/[^\w.-]+/g, "_").slice(0, 60);
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
