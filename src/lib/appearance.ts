/**
 * How the whole app looks — chosen once in Settings → Appearance and applied
 * everywhere through attributes on <html> (the styles are in styles.css).
 * The defaults set nothing at all, so the app looks exactly as it was built
 * until an admin picks something else.
 */
export type UiLook = "classic" | "glass" | "flat" | "ivory";
export type UiAccent = "royal" | "sapphire" | "emerald" | "gold" | "ruby" | "graphite";
export type UiCorners = "sharp" | "default" | "round";
export type UiHeadings = "serif" | "sans";
export type UiMotion = "full" | "calm";
export type UiWidth = "fit" | "centered";
/** light: as built · dark · system: follows each device's own setting. */
export type UiTheme = "light" | "dark" | "system";

/* ── Fonts ─────────────────────────────────────────────────────────────────
 * The text font is everything you read; the heading font is page titles,
 * card titles and the big figures. Both come from Google Fonts, loaded only
 * when chosen — Inter and Cormorant Garamond, the fonts the app was built in,
 * are always there (index.html). `spec` is the css2 family parameter, with
 * only weights the family really has (Google refuses the request otherwise).
 */
export interface UiFontDef { key: string; name: string; spec: string | null; stack: string; hint: string }

const SANS = `ui-sans-serif, system-ui, sans-serif`;
const SERIF = `ui-serif, Georgia, serif`;
const w4 = "wght@400;500;600;700";
export const TEXT_FONTS = [
  { key: "inter", name: "Inter", spec: null, stack: `"Inter", ${SANS}`, hint: "As built — clear and neutral" },
  { key: "system", name: "Device font", spec: null, stack: `-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif`, hint: "Each phone's and computer's own — nothing to download" },
  { key: "jakarta", name: "Plus Jakarta Sans", spec: `Plus+Jakarta+Sans:${w4}`, stack: `"Plus Jakarta Sans", ${SANS}`, hint: "Friendly and modern" },
  { key: "manrope", name: "Manrope", spec: `Manrope:${w4}`, stack: `"Manrope", ${SANS}`, hint: "Geometric, tidy figures" },
  { key: "dmsans", name: "DM Sans", spec: `DM+Sans:${w4}`, stack: `"DM Sans", ${SANS}`, hint: "Soft and compact" },
  { key: "poppins", name: "Poppins", spec: `Poppins:${w4}`, stack: `"Poppins", ${SANS}`, hint: "Round and bold" },
  { key: "montserrat", name: "Montserrat", spec: `Montserrat:${w4}`, stack: `"Montserrat", ${SANS}`, hint: "Wide, fashion-house feel" },
  { key: "figtree", name: "Figtree", spec: `Figtree:${w4}`, stack: `"Figtree", ${SANS}`, hint: "Light and friendly" },
  { key: "outfit", name: "Outfit", spec: `Outfit:${w4}`, stack: `"Outfit", ${SANS}`, hint: "Clean geometric" },
  { key: "urbanist", name: "Urbanist", spec: `Urbanist:${w4}`, stack: `"Urbanist", ${SANS}`, hint: "Sleek and minimal" },
  { key: "raleway", name: "Raleway", spec: `Raleway:${w4}`, stack: `"Raleway", ${SANS}`, hint: "Elegant, thin strokes" },
  { key: "worksans", name: "Work Sans", spec: `Work+Sans:${w4}`, stack: `"Work Sans", ${SANS}`, hint: "Plain and sturdy" },
  { key: "ibmplex", name: "IBM Plex Sans", spec: `IBM+Plex+Sans:${w4}`, stack: `"IBM Plex Sans", ${SANS}`, hint: "Corporate and precise" },
  { key: "source", name: "Source Sans 3", spec: `Source+Sans+3:${w4}`, stack: `"Source Sans 3", ${SANS}`, hint: "Classic, very readable" },
  { key: "opensans", name: "Open Sans", spec: `Open+Sans:${w4}`, stack: `"Open Sans", ${SANS}`, hint: "Familiar and open" },
  { key: "roboto", name: "Roboto", spec: `Roboto:${w4}`, stack: `"Roboto", ${SANS}`, hint: "Android's own" },
  { key: "nunito", name: "Nunito Sans", spec: `Nunito+Sans:${w4}`, stack: `"Nunito Sans", ${SANS}`, hint: "Warm and rounded" },
  { key: "lato", name: "Lato", spec: `Lato:wght@400;700`, stack: `"Lato", ${SANS}`, hint: "Calm and serious" },
  { key: "lexend", name: "Lexend", spec: `Lexend:${w4}`, stack: `"Lexend", ${SANS}`, hint: "Made to be easy to read" },
  { key: "sora", name: "Sora", spec: `Sora:${w4}`, stack: `"Sora", ${SANS}`, hint: "Techy and crisp" },
] as const satisfies readonly UiFontDef[];
export type UiFont = (typeof TEXT_FONTS)[number]["key"];

/** Serif families for headings — the boutique, engraved, editorial feel. */
export const HEADING_SERIFS = [
  { key: "cormorant", name: "Cormorant Garamond", spec: null, stack: `"Cormorant Garamond", ${SERIF}`, hint: "As built — fine and elegant" },
  { key: "playfair", name: "Playfair Display", spec: `Playfair+Display:${w4}`, stack: `"Playfair Display", ${SERIF}`, hint: "High-contrast, magazine" },
  { key: "bodoni", name: "Bodoni Moda", spec: `Bodoni+Moda:${w4}`, stack: `"Bodoni Moda", ${SERIF}`, hint: "Fashion and luxury" },
  { key: "cinzel", name: "Cinzel", spec: `Cinzel:${w4}`, stack: `"Cinzel", ${SERIF}`, hint: "Engraved capitals" },
  { key: "ebgaramond", name: "EB Garamond", spec: `EB+Garamond:${w4}`, stack: `"EB Garamond", ${SERIF}`, hint: "Old-world book" },
  { key: "lora", name: "Lora", spec: `Lora:${w4}`, stack: `"Lora", ${SERIF}`, hint: "Warm and balanced" },
  { key: "baskerville", name: "Libre Baskerville", spec: `Libre+Baskerville:wght@400;700`, stack: `"Libre Baskerville", ${SERIF}`, hint: "Classic and sturdy" },
  { key: "fraunces", name: "Fraunces", spec: `Fraunces:${w4}`, stack: `"Fraunces", ${SERIF}`, hint: "Soft, characterful" },
  { key: "crimson", name: "Crimson Pro", spec: `Crimson+Pro:${w4}`, stack: `"Crimson Pro", ${SERIF}`, hint: "Bookish and calm" },
  { key: "spectral", name: "Spectral", spec: `Spectral:${w4}`, stack: `"Spectral", ${SERIF}`, hint: "Refined for screens" },
] as const satisfies readonly UiFontDef[];
/** "same": headings in the text font. A sans key: headings in that sans. */
export type UiHeadingFont = "same" | (typeof HEADING_SERIFS)[number]["key"] | UiFont;
const fontDef = (key: string): UiFontDef | undefined =>
  (HEADING_SERIFS as readonly UiFontDef[]).find(f => f.key === key) ?? (TEXT_FONTS as readonly UiFontDef[]).find(f => f.key === key);
const isSerifHeading = (key: string) => (HEADING_SERIFS as readonly UiFontDef[]).some(f => f.key === key);

export interface AppearanceUi {
  look: UiLook;
  accent: UiAccent;
  corners: UiCorners;
  /** Kept in step with headingFont (serif or not), for the styles that key on it. */
  headings: UiHeadings;
  motion: UiMotion;
  width: UiWidth;
  theme: UiTheme;
  font: UiFont;
  headingFont: UiHeadingFont;
}

export const UI_LOOKS: { key: UiLook; name: string; hint: string }[] = [
  { key: "classic", name: "Classic", hint: "As the app is today" },
  { key: "glass", name: "Liquid Glass", hint: "Frosted floating bars and panels over calm cards — Apple's newest look" },
  { key: "flat", name: "Modern Flat", hint: "Crisp lines, no shadows — like Linear or Vercel" },
  { key: "ivory", name: "Luxe Ivory", hint: "Warm ivory and fine gold lines — a jewellery boutique feel" },
];

/** Each accent's colour, for the swatches (the real values are in styles.css). */
export const UI_ACCENTS: { key: UiAccent; name: string; swatch: string }[] = [
  { key: "royal", name: "Royal blue", swatch: "oklch(0.475 0.13 264)" },
  { key: "sapphire", name: "Sapphire", swatch: "oklch(0.5 0.14 235)" },
  { key: "emerald", name: "Emerald", swatch: "oklch(0.5 0.12 160)" },
  { key: "gold", name: "Gold", swatch: "oklch(0.52 0.1 72)" },
  { key: "ruby", name: "Ruby", swatch: "oklch(0.5 0.17 15)" },
  { key: "graphite", name: "Graphite", swatch: "oklch(0.36 0.02 260)" },
];

export const DEFAULT_APPEARANCE: AppearanceUi = { look: "classic", accent: "royal", corners: "default", headings: "serif", motion: "full", width: "fit", theme: "light", font: "inter", headingFont: "cormorant" };

const pick = <T extends string>(v: unknown, ok: readonly T[], dflt: T): T => (ok.includes(v as T) ? (v as T) : dflt);

/** A stored setting, completed with the defaults — never trusted to be whole. */
export function appearanceOf(v: Partial<AppearanceUi> | undefined | null): AppearanceUi {
  // Saved before fonts could be chosen: "Modern" headings meant the text font.
  const oldHeadings = pick(v?.headings, ["serif", "sans"] as const, "serif");
  const headingFont = pick<UiHeadingFont>(v?.headingFont, ["same", ...HEADING_SERIFS.map(f => f.key), ...TEXT_FONTS.map(f => f.key)],
    oldHeadings === "sans" ? "same" : "cormorant");
  return {
    look: pick(v?.look, UI_LOOKS.map(l => l.key), "classic"),
    accent: pick(v?.accent, UI_ACCENTS.map(a => a.key), "royal"),
    corners: pick(v?.corners, ["sharp", "default", "round"] as const, "default"),
    headings: isSerifHeading(headingFont) ? "serif" : "sans",
    motion: pick(v?.motion, ["full", "calm"] as const, "full"),
    width: pick(v?.width, ["fit", "centered"] as const, "fit"),
    theme: pick(v?.theme, ["light", "dark", "system"] as const, "light"),
    font: pick<UiFont>(v?.font, TEXT_FONTS.map(f => f.key), "inter"),
    headingFont,
  };
}

/** A font's stylesheet on the page — added, swapped or removed. */
function fontSheet(id: string, spec: string | null) {
  if (typeof document === "undefined") return;
  let el = document.getElementById(id) as HTMLLinkElement | null;
  if (!spec) { el?.remove(); return; }
  const href = `https://fonts.googleapis.com/css2?family=${spec}&display=swap`;
  if (el?.getAttribute("href") === href) return;
  if (!el) { el = document.createElement("link"); el.id = id; el.rel = "stylesheet"; document.head.appendChild(el); }
  el.href = href;
}

/** Every font's name drawn in itself, for the pickers — loaded the first time one opens. */
export function loadFontPreviews(): void {
  const specs = ([...TEXT_FONTS, ...HEADING_SERIFS] as readonly UiFontDef[]).map(f => f.spec).filter((s): s is string => !!s)
    .map(s => (s.includes("wght@400;700") ? s.replace("wght@400;700", "wght@700") : s.replace(/:wght@.*$/, ":wght@600")));
  fontSheet("ui-font-preview", specs.join("&family="));
}

function applyFonts(a: AppearanceUi, root: HTMLElement) {
  const text = fontDef(a.font) ?? TEXT_FONTS[0];
  const head = a.headingFont === "same" ? null : fontDef(a.headingFont) ?? null;
  // Text font: nothing set for Inter, the font the app was built in.
  if (a.font === "inter") { root.removeAttribute("data-font"); root.style.removeProperty("--ui-font-text"); }
  else { root.setAttribute("data-font", a.font); root.style.setProperty("--ui-font-text", text.stack); }
  // Heading font: nothing set for Cormorant (as built) or "same as text" (data-headings does that).
  if (!head || a.headingFont === "cormorant") { root.removeAttribute("data-head-font"); root.style.removeProperty("--ui-font-head"); }
  else { root.setAttribute("data-head-font", a.headingFont); root.style.setProperty("--ui-font-head", head.stack); }
  fontSheet("ui-font-text", text.spec);
  fontSheet("ui-font-head", head && head.spec !== text.spec ? head.spec : null);
}

export const isDefaultAppearance = (a: AppearanceUi) => JSON.stringify(a) === JSON.stringify(DEFAULT_APPEARANCE);

const CACHE_KEY = "ui:appearance";

/** Put a look on the page. Each default removes its attribute. */
export function applyAppearance(a: AppearanceUi, root: HTMLElement = document.documentElement): void {
  const set = (k: string, v: string | null) => (v === null ? root.removeAttribute(k) : root.setAttribute(k, v));
  set("data-ui", a.look === "classic" ? null : a.look);
  set("data-accent", a.accent === "royal" ? null : a.accent);
  set("data-corners", a.corners === "default" ? null : a.corners);
  set("data-headings", a.headings === "serif" ? null : a.headings);
  set("data-motion", a.motion === "full" ? null : a.motion);
  set("data-width", a.width === "fit" ? null : a.width);
  applyFonts(a, root);
  currentTheme = a.theme;
  applyTheme(root);
}

/** The theme in force, and the device's own preference while it is "system". */
let currentTheme: UiTheme = "light";
let watching = false;
function applyTheme(root: HTMLElement = document.documentElement) {
  const deviceDark = typeof matchMedia !== "undefined" && matchMedia("(prefers-color-scheme: dark)").matches;
  const dark = currentTheme === "dark" || (currentTheme === "system" && deviceDark);
  root.classList.toggle("dark", dark);
  // Follow the device as it changes (evening mode, a manual switch) — once.
  if (currentTheme === "system" && !watching && typeof matchMedia !== "undefined") {
    watching = true;
    matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => applyTheme());
  }
}

/** Remember the look on this device, so the next start (and the sign-in page) opens in it. */
export function rememberAppearance(a: AppearanceUi): void {
  try {
    if (isDefaultAppearance(a)) localStorage.removeItem(CACHE_KEY);
    else localStorage.setItem(CACHE_KEY, JSON.stringify(a));
  } catch { /* private mode — the look still applies once the data loads */ }
}

/** At start-up, before any data: the look this device last showed. */
export function applyRememberedAppearance(): void {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (raw) applyAppearance(appearanceOf(JSON.parse(raw)));
  } catch { /* nothing remembered */ }
}
