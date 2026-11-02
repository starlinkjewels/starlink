// Small previews of Catalog and Product Photos media, for the grids.
//
// A catalog photo is kept as it was picked — often several MB — so a folder (or
// a public share link) of them loaded slowly. Beside each one now sits a small
// copy: the longest side 480px, a JPEG of about 50 KB. For a video, it is a
// still taken from the video. The item keeps its address in `thumb`; the
// grid shows that, and the original is still what opens, downloads, goes in a
// zip or a PDF, and is shared.
//
// Storage only ever GAINS files here: a preview is a new file in a "thumbs"
// folder next to the original. An original is never changed, moved or removed.
import { doc, getDoc, updateDoc } from "firebase/firestore";
import { db as fsdb } from "./firebase";
import { uploadDataUrl, deleteByUrl } from "./storage";
import { webVideoUrl } from "./webVideo";
import { loadDb, updateDbAs, type Share } from "./db";

export const PREVIEW_PX = 480;
export const PREVIEW_QUALITY = 0.75;

/** Folder a preview goes in: a "thumbs" folder beside the original. */
const thumbsOf = (folder: string) => `${folder.replace(/\/+$/, "")}/thumbs`;

/** Drawn at most PREVIEW_PX on its long side, on white (a see-through PNG
 *  would turn black as a JPEG), as a JPEG data URL. */
function toJpeg(src: CanvasImageSource, w0: number, h0: number): string {
  if (!w0 || !h0) throw new Error("nothing to draw");
  const k = Math.min(1, PREVIEW_PX / Math.max(w0, h0));
  const w = Math.max(1, Math.round(w0 * k)), h = Math.max(1, Math.round(h0 * k));
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(src, 0, 0, w, h);
  return c.toDataURL("image/jpeg", PREVIEW_QUALITY);
}

/** Give up on something that never answers, rather than waiting for ever. */
function within<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("took too long")), ms);
    p.then(v => { clearTimeout(t); resolve(v); }, e => { clearTimeout(t); reject(e); });
  });
}

/** A picture's preview, from its bytes. Upright as it was taken (the browser
 *  turns a phone photo by its own note of which way up it is). */
async function imageStill(blob: Blob): Promise<string> {
  const url = URL.createObjectURL(blob);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error("not a picture this browser can open"));
      i.src = url;
    });
    return toJpeg(img, img.naturalWidth, img.naturalHeight);
  } finally { URL.revokeObjectURL(url); }
}

/** A still from a video, from its bytes: a moment in (half a second, or a
 *  tenth of a short clip), so it is not the black first frame. Gives up after
 *  `ms` — a phone that won't load a video it isn't playing must not hold up
 *  the upload — and lets the video go either way. */
async function videoStill(blob: Blob, ms: number): Promise<string> {
  const url = URL.createObjectURL(blob);
  const v = document.createElement("video");
  try {
    v.muted = true;
    v.playsInline = true;
    v.preload = "auto";
    await within(new Promise<void>((resolve, reject) => {
      v.onloadeddata = () => resolve();
      v.onerror = () => reject(new Error("a video this browser can't open"));
      v.src = url;
      v.load();
    }), ms);
    const d = Number.isFinite(v.duration) && v.duration > 0 ? v.duration : 0;
    const at = Math.min(0.5, d * 0.1);
    if (at > 0) {
      await within(new Promise<void>((resolve, reject) => {
        v.onseeked = () => resolve();
        v.onerror = () => reject(new Error("a video this browser can't open"));
        v.currentTime = at;
      }), ms);
    }
    return toJpeg(v, v.videoWidth, v.videoHeight);
  } finally {
    v.removeAttribute("src");
    try { v.load(); } catch { /* already let go */ }
    URL.revokeObjectURL(url);
  }
}

/** Kept as they are: a moving GIF and a drawing (SVG) would lose what they are. */
const AS_IS = /^image\/(gif|svg\+xml)$/;

/**
 * A new upload's preview: made from the picked file and put next to the
 * original (`folder` = the original's folder). Its address — or nothing when it
 * can't be made (a HEIC on a computer, a video this browser can't open). Never
 * throws, so an upload never fails over it.
 */
export async function makePreview(file: File, folder: string): Promise<string | undefined> {
  try {
    const isVideo = file.type.startsWith("video/");
    if (!isVideo && (!file.type.startsWith("image/") || AS_IS.test(file.type))) return undefined;
    const still = isVideo ? await videoStill(file, 15_000) : await within(imageStill(file), 30_000);
    return await uploadDataUrl(still, thumbsOf(folder));
  } catch (e) {
    console.warn("[preview] not made:", file.name, e instanceof Error ? e.message : e);
    return undefined;
  }
}

/* ─────────────── Previews for what is already there ─────────────── */

/** Starlink's storage lets no browser read it (no CORS rule, left alone on
 *  purpose), so its files come through this site (api/img.ts, on Vercel). */
const STARLINK = /^https:\/\/firebasestorage\.googleapis\.com\/v0\/b\/starlinkjewels109\./;

/** A stored file's bytes, read fresh (a copy the browser cached while showing
 *  it as an <img> carries no read permission — see lib/piecesPdf.ts). */
async function storedBlob(url: string): Promise<Blob> {
  if (STARLINK.test(url)) {
    const res = await fetch(`/api/img?u=${encodeURIComponent(url)}`);
    if (res.ok) return res.blob();
    throw new Error(`couldn't read it (${res.status})`);
  }
  let last: unknown = null;
  for (const cache of ["reload", "no-store"] as RequestCache[]) {
    try {
      const res = await fetch(url, { mode: "cors", cache });
      if (res.ok) return await res.blob();
      last = new Error(`couldn't read it (${res.status})`);
    } catch (e) { last = e; }
  }
  throw last instanceof Error ? last : new Error("couldn't read it");
}

/** The original's own folder in storage ("catalog/cf_1"), read off its address. */
function folderOfUrl(url: string): string | null {
  const m = url.match(/\/o\/([^?#]+)/);
  if (!m) return null;
  try {
    const path = decodeURIComponent(m[1]);
    const cut = path.lastIndexOf("/");
    return cut > 0 ? path.slice(0, cut) : null;
  } catch { return null; }
}

/**
 * A preview for a file already stored: read the original (never written to),
 * make the small copy, upload it beside it, and return its address. A video
 * this browser can't open is tried once more from its web copy (lib/webVideo.ts),
 * if there is one. Throws when it can't be made — the caller counts it.
 */
export async function previewForStored(url: string, kind: "image" | "video", fallbackFolder: string): Promise<string> {
  let still: string;
  if (kind === "image") {
    still = await within(storedBlob(url).then(imageStill), 120_000);
  } else {
    try {
      still = await videoStill(await within(storedBlob(url), 180_000), 30_000);
    } catch (e) {
      const web = webVideoUrl(url);
      if (!web) throw e;
      still = await videoStill(await within(storedBlob(web), 180_000), 30_000);
    }
  }
  return uploadDataUrl(still, thumbsOf(folderOfUrl(url) ?? fallbackFolder));
}

/** A preview made for an item that was deleted meanwhile: not left behind
 *  (only ever a preview this run uploaded — never an original). */
export function dropPreview(thumb: string): void {
  void deleteByUrl(thumb);
}

/**
 * Links already shared get the previews too: each Catalog / Product Photos
 * share's items — the ones in the share itself and its extra pages
 * (shares/{id}/items/{n}, lib/share.ts) — gain `thumb` where the original
 * (matched by its address) has one now. Nothing else in a link changes.
 * Returns how many links gained any.
 */
export async function addPreviewsToShares(thumbs: Map<string, string>): Promise<number> {
  if (!thumbs.size) return 0;
  type Row = { url: string; thumb?: string };
  const wants = (it: Row) => !it.thumb && thumbs.has(it.url);
  const fill = (items: Row[] | undefined) => {
    let n = 0;
    for (const it of items ?? []) if (wants(it)) { it.thumb = thumbs.get(it.url); n++; }
    return n;
  };
  const isFolderShare = (s: Share) => s.kind === "catalog" || s.kind === "productPhotos";
  const shares = (loadDb().shares ?? []).filter(isFolderShare);
  const touched = new Set<string>();
  // The extra pages first — only their items field, one document at a time.
  for (const s of shares) {
    for (let n = 0; n < (s.pageCount ?? 0); n++) {
      const ref = doc(fsdb, "shares", s.id, "items", String(n));
      const snap = await getDoc(ref);
      if (!snap.exists()) continue;
      const items = (snap.data() as { items?: Row[] }).items ?? [];
      if (fill(items)) { await updateDoc(ref, { items }); touched.add(s.id); }
    }
  }
  // Then the items carried in each share itself, in one save — only if any needs it.
  const inline = shares.filter(s => (s.items ?? []).some(wants)).map(s => s.id);
  if (inline.length) {
    updateDbAs({ summary: `Photo previews added to ${inline.length} shared link${inline.length !== 1 ? "s" : ""}` }, d => {
      for (const s of d.shares ?? []) if (isFolderShare(s) && inline.includes(s.id)) fill(s.items);
    });
    inline.forEach(id => touched.add(id));
  }
  return touched.size;
}

/**
 * A photo for a spreadsheet (lib/xlsxExport.ts): read the same way as a preview
 * (Starlink's storage through /api/img), drawn at most `px` on its long side as
 * a JPEG — a workbook of full-size photos would be enormous. Undefined when it
 * can't be read; the sheet then simply has no picture there.
 */
export async function sheetPicture(url: string, px = 320): Promise<{ base64: string; w: number; h: number } | undefined> {
  try {
    const blob = await within(storedBlob(url), 20_000);
    const src = URL.createObjectURL(blob);
    try {
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const i = new Image();
        i.onload = () => resolve(i);
        i.onerror = () => reject(new Error("not a picture"));
        i.src = src;
      });
      const k = Math.min(1, px / Math.max(img.naturalWidth, img.naturalHeight));
      const w = Math.max(1, Math.round(img.naturalWidth * k)), h = Math.max(1, Math.round(img.naturalHeight * k));
      const c = document.createElement("canvas");
      c.width = w; c.height = h;
      const ctx = c.getContext("2d")!;
      ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, w, h);
      ctx.drawImage(img, 0, 0, w, h);
      return { base64: c.toDataURL("image/jpeg", 0.82).split(",")[1], w, h };
    } finally { URL.revokeObjectURL(src); }
  } catch { return undefined; }
}
