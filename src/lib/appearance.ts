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

export interface AppearanceUi {
  look: UiLook;
  accent: UiAccent;
  corners: UiCorners;
  headings: UiHeadings;
  motion: UiMotion;
  width: UiWidth;
  theme: UiTheme;
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

export const DEFAULT_APPEARANCE: AppearanceUi = { look: "classic", accent: "royal", corners: "default", headings: "serif", motion: "full", width: "fit", theme: "light" };

const pick = <T extends string>(v: unknown, ok: readonly T[], dflt: T): T => (ok.includes(v as T) ? (v as T) : dflt);

/** A stored setting, completed with the defaults — never trusted to be whole. */
export function appearanceOf(v: Partial<AppearanceUi> | undefined | null): AppearanceUi {
  return {
    look: pick(v?.look, UI_LOOKS.map(l => l.key), "classic"),
    accent: pick(v?.accent, UI_ACCENTS.map(a => a.key), "royal"),
    corners: pick(v?.corners, ["sharp", "default", "round"] as const, "default"),
    headings: pick(v?.headings, ["serif", "sans"] as const, "serif"),
    motion: pick(v?.motion, ["full", "calm"] as const, "full"),
    width: pick(v?.width, ["fit", "centered"] as const, "fit"),
    theme: pick(v?.theme, ["light", "dark", "system"] as const, "light"),
  };
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
