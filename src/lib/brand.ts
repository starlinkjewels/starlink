/**
 * The company's own brand — logo, name, app icon and colour — set by an admin
 * in Settings → Brand Studio, and shown everywhere: the sign-in page, the
 * sidebar, the browser tab, shared galleries and printed invoices.
 *
 * It lives in ONE small public record, /brand/public, readable before anyone
 * signs in (the sign-in page needs it) and written only by an admin. It holds
 * nothing but what the sign-in page shows anyway. Images are stored inside it
 * as small pictures (never in file storage), resized on upload.
 *
 * Each device also remembers the last brand it saw, so the sign-in page opens
 * in the company's own look at once, before the record arrives.
 *
 * Nothing saved → the app's built-in logo and colours, exactly as before.
 */
import { useSyncExternalStore } from "react";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { db } from "./firebase";
import { brandColorCss } from "./brandColor";

export interface Brand {
  /** "Starlink Jewels" — the browser tab, the sign-in page, alt text. */
  name?: string;
  /** The logo for light backgrounds (a data: picture). */
  logo?: string;
  /** The logo for dark backgrounds — optional; the light one otherwise. */
  logoDark?: string;
  /** A square icon: the browser tab, the narrow sidebar. */
  mark?: string;
  /** The brand colour, "#2d4a9c". */
  color?: string;
  updatedAt?: string;
  updatedBy?: string;
}

/** This build's own logo and name — what shows until an admin saves a brand. */
export const BUILTIN = {
  name: "Starlink Jewels",
  /** The sign-in page's logo. */
  logo: "/starlink-logo.png",
  /** A wide version for the menu, invoices and galleries, if this build has one. */
  wide: undefined as string | undefined,
  /** A white version for the dark loading screen, if this build has one. */
  white: undefined as string | undefined,
  /** A square icon file, if this build has one (the full logo is cropped otherwise). */
  mark: undefined as string | undefined,
};

const KEY = "ui:brand";
const IMG = /^data:image\/(png|webp|jpeg);base64,[A-Za-z0-9+/=]+$/;
const REF = () => doc(db, "brand", "public");
/** The fields the record may hold (the security rules allow only these). */
const FIELDS = ["name", "logo", "logoDark", "mark", "color", "updatedAt", "updatedBy"] as const;

function clean(v: unknown): Brand {
  const o = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  const b: Brand = {};
  for (const k of FIELDS) if (typeof o[k] === "string" && o[k]) (b as Record<string, string>)[k] = o[k] as string;
  if (b.color && !/^#[0-9a-f]{6}$/i.test(b.color)) delete b.color;
  // Pictures are inline images only — never a link to somewhere else.
  for (const k of ["logo", "logoDark", "mark"] as const) if (b[k] && !IMG.test(b[k]!)) delete b[k];
  return b;
}

let current: Brand = (() => { try { return clean(JSON.parse(localStorage.getItem(KEY) || "{}")); } catch { return {}; } })();
const listeners = new Set<() => void>();

/** The brand in force (what was saved, or remembered on this device). */
export const getBrand = (): Brand => current;

/** The brand, kept up to date — for the logo, name and colour on screen. */
export function useBrand(): Brand {
  return useSyncExternalStore(cb => { listeners.add(cb); return () => listeners.delete(cb); }, () => current, () => current);
}

/** The company name to show: the brand's, else this build's. */
export const brandName = (b: Brand = current) => b.name?.trim() || BUILTIN.name;

/** Put a brand colour on the page — the whole palette, light and dark. "" takes it off. */
export function applyBrandColor(hex: string | undefined, root: HTMLElement = document.documentElement): void {
  let el = document.getElementById("brand-color") as HTMLStyleElement | null;
  const sheet = hex ? brandColorCss(hex) : "";
  if (!sheet) { el?.remove(); root.removeAttribute("data-brand-color"); return; }
  if (!el) { el = document.createElement("style"); el.id = "brand-color"; }
  // Last in <head>, after the app's own styles, so it wins over the built-in accents.
  document.head.appendChild(el);
  if (el.textContent !== sheet) el.textContent = sheet;
  root.setAttribute("data-brand-color", "");
}

function applyIcon(href: string) {
  for (const rel of ["icon", "apple-touch-icon"]) {
    const el = document.querySelector<HTMLLinkElement>(`link[rel="${rel}"]`);
    if (!el) continue;
    if (!el.dataset.builtin) el.dataset.builtin = el.getAttribute("href") ?? "";
    el.href = href || el.dataset.builtin;
  }
}

/** Put a brand on the page and remember it on this device. */
export function applyBrand(b: Brand): void {
  current = clean(b);
  try {
    if (Object.keys(current).length) localStorage.setItem(KEY, JSON.stringify(current)); else localStorage.removeItem(KEY);
  } catch { /* full or private: this visit only */ }
  applyBrandColor(current.color);
  applyIcon(current.mark ?? "");
  if (current.name) document.title = current.name;
  listeners.forEach(l => l());
}

/** Read the saved brand (works before sign-in). A failure keeps what this device remembers. */
export async function loadBrand(): Promise<void> {
  try {
    const snap = await getDoc(REF());
    applyBrand(snap.exists() ? snap.data() : {});
  } catch { /* offline, or the record isn't reachable yet: keep the remembered one */ }
}

/** Save the brand for everyone (admin only — the rules refuse anyone else). */
export async function saveBrand(b: Brand, by: string): Promise<void> {
  const next = clean({ ...b, updatedAt: new Date().toISOString(), updatedBy: by });
  await setDoc(REF(), next);
  applyBrand(next);
}

/**
 * A picture the admin chose, made small enough to keep in the record: fitted
 * inside maxW × maxH (never enlarged), transparent edges kept, as WebP (PNG
 * where the browser can't write WebP). Refuses anything that stays too big.
 */
export async function fitImage(file: File, maxW: number, maxH: number, maxChars = 280_000): Promise<string> {
  if (!/^image\/(png|jpe?g|webp|svg\+xml|gif)$/.test(file.type)) throw new Error("Choose a PNG, JPG, WebP or SVG picture.");
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((ok, fail) => {
      const i = new Image(); i.onload = () => ok(i); i.onerror = () => fail(new Error("That picture couldn't be opened.")); i.src = url;
    });
    const w0 = img.naturalWidth || maxW, h0 = img.naturalHeight || maxH;
    // SVGs scale cleanly: draw them at the full box. Pictures are never enlarged.
    const scale = file.type === "image/svg+xml" ? Math.min(maxW / w0, maxH / h0) : Math.min(1, maxW / w0, maxH / h0);
    const w = Math.max(1, Math.round(w0 * scale)), h = Math.max(1, Math.round(h0 * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("This browser can't prepare pictures.");
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img, 0, 0, w, h);
    for (const q of [0.92, 0.85, 0.75]) {
      let out = canvas.toDataURL("image/webp", q);
      if (!out.startsWith("data:image/webp")) out = canvas.toDataURL("image/png");
      if (out.length <= maxChars) return out;
    }
    throw new Error("That picture is too detailed — try a simpler or smaller one.");
  } finally {
    URL.revokeObjectURL(url);
  }
}
