/**
 * A company's own brand colour, turned into the whole palette the app uses —
 * buttons, links, the selected menu item, focus rings and tints — for light
 * and for dark. One colour in; every shade worked out, so any colour a company
 * picks looks right and stays readable.
 *
 * Readability: white text on a button must reach 4.5 : 1 (WCAG AA). A colour
 * too light for that (a pale gold, a yellow) is deepened just enough, keeping
 * its hue; `adjusted` says so, for Brand Studio to tell the admin.
 *
 * The maths is OKLCH (Björn Ottosson's OKLab), the same space the app's own
 * colours are written in, so shades step evenly to the eye.
 */

type Lch = { l: number; c: number; h: number };

const toLinear = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const toGamma = (v: number) => (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055);

function linearToOklch(r: number, g: number, b: number): Lch {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  const h = (Math.atan2(B, A) * 180) / Math.PI;
  return { l: L, c: Math.hypot(A, B), h: h < 0 ? h + 360 : h };
}

function oklchToLinear({ l: L, c, h }: Lch): [number, number, number] {
  const A = c * Math.cos((h * Math.PI) / 180);
  const B = c * Math.sin((h * Math.PI) / 180);
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

const inGamut = (rgb: number[]) => rgb.every(v => v >= -0.0005 && v <= 1.0005);

/** The same colour, its chroma eased down until a screen can show it. */
function toGamut(x: Lch): Lch {
  if (inGamut(oklchToLinear(x))) return x;
  let lo = 0, hi = x.c;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    if (inGamut(oklchToLinear({ ...x, c: mid }))) lo = mid; else hi = mid;
  }
  return { ...x, c: lo };
}

/** "#2d4a9c" → OKLCH, or null when it is not a colour. */
export function hexToOklch(hex: string): Lch | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const h = m[1].length === 3 ? m[1].split("").map(ch => ch + ch).join("") : m[1];
  const [r, g, b] = [0, 2, 4].map(i => toLinear(parseInt(h.slice(i, i + 2), 16) / 255));
  return linearToOklch(r, g, b);
}

export function oklchToHex(x: Lch): string {
  const rgb = oklchToLinear(toGamut(x));
  return "#" + rgb.map(v => Math.round(Math.min(1, Math.max(0, toGamma(Math.min(1, Math.max(0, v))))) * 255).toString(16).padStart(2, "0")).join("");
}

/** WCAG contrast of white text on this colour. */
export function whiteContrast(x: Lch): number {
  const [r, g, b] = oklchToLinear(toGamut(x)).map(v => Math.min(1, Math.max(0, v)));
  const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return 1.05 / (y + 0.05);
}

const css = (x: Lch) => { const g = toGamut(x); return `oklch(${g.l.toFixed(3)} ${g.c.toFixed(3)} ${g.h.toFixed(1)})`; };
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Deepen a colour just until white text on it is readable. */
function readable(x: Lch, maxL: number): Lch {
  let y = { ...x, l: Math.min(x.l, maxL) };
  while (whiteContrast(y) < 4.5 && y.l > 0.2) y = { ...y, l: y.l - 0.005 };
  return toGamut(y);
}

export interface BrandPalette {
  /** CSS variables for the light theme and for dark. */
  light: Record<string, string>;
  dark: Record<string, string>;
  /** The colour buttons use (light theme), as #hex. */
  used: string;
  /** True when the picked colour was deepened to keep text readable. */
  adjusted: boolean;
  /** White-on-button contrast, light theme (e.g. 5.2 for 5.2 : 1). */
  contrast: number;
}

/** The palette for one brand colour, or null when the colour can't be read. */
export function brandPalette(hex: string): BrandPalette | null {
  const pick = hexToOklch(hex);
  if (!pick) return null;
  const h = pick.h, c = pick.c;
  // A grey stays grey: no tint from a meaningless hue.
  const tint = c < 0.02 ? 0 : 1;
  const P = readable(pick, 0.75);
  const D = readable({ l: clamp(pick.l, 0.56, 0.66), c: Math.max(c, 0.03 * tint), h }, 0.66);
  const at = (l: number, cc: number): Lch => ({ l, c: cc * tint, h });

  const light: Record<string, string> = {
    "--primary": css(P), "--brand": css(P), "--sidebar-primary": css(P),
    "--primary-foreground": "oklch(0.99 0 0)", "--sidebar-primary-foreground": "oklch(0.99 0 0)",
    "--brand-dark": css(at(clamp(P.l - 0.12, 0.22, 0.4), P.c * 0.8)),
    "--brand-light": css(at(clamp(P.l + 0.22, 0.66, 0.8), P.c * 0.85)),
    "--accent": css(at(clamp(P.l + 0.22, 0.66, 0.8), P.c * 0.85)),
    "--ring": css(at(clamp(P.l + 0.1, 0.55, 0.7), P.c * 0.8)),
    "--sidebar-ring": css(at(clamp(P.l + 0.1, 0.55, 0.7), P.c * 0.8)),
  };
  const dark: Record<string, string> = {
    "--primary": css(D), "--brand": css(D), "--sidebar-primary": css(D),
    "--primary-foreground": "oklch(0.99 0 0)", "--sidebar-primary-foreground": "oklch(0.99 0 0)",
    "--brand-dark": css(at(0.44, D.c * 0.9)),
    "--brand-light": css(at(0.76, D.c * 0.75)),
    "--ring": css(at(0.64, D.c * 0.8)),
    "--sidebar-ring": css(at(0.64, D.c * 0.8)),
  };
  // The sign-in page and loading screen: the same deep grounds, in the brand's hue.
  const deep = (l: number, cc: number) => css(at(l, Math.min(c, cc)));
  light["--login-bg"] = `radial-gradient(circle at 20% 20%, ${deep(0.34, 0.12)} 0%, ${deep(0.18, 0.06)} 60%, ${deep(0.12, 0.04)} 100%)`;
  light["--splash-bg"] = `radial-gradient(circle at 30% 25%, ${deep(0.34, 0.12)} 0%, ${deep(0.16, 0.05)} 55%, ${deep(0.11, 0.03)} 100%)`;
  light["--login-glow"] = `radial-gradient(circle at 30% 40%, rgba(255,255,255,0.15), transparent 40%), radial-gradient(circle at 70% 60%, ${css(at(0.62, Math.min(c, 0.12))).replace(")", " / 0.3)")}, transparent 50%)`;
  return { light, dark, used: oklchToHex(P), adjusted: Math.abs(P.l - pick.l) > 0.004 || Math.abs(P.c - pick.c) > 0.004, contrast: whiteContrast(P) };
}

/**
 * The tinted greys of the current look (backgrounds of chips, the sidebar's
 * hover) in the brand's hue. Only for the current look: the new look keeps
 * its own warm neutrals whatever the brand colour.
 */
export function brandTints(hex: string): { light: Record<string, string>; dark: Record<string, string> } | null {
  const pick = hexToOklch(hex);
  if (!pick) return null;
  const tint = pick.c < 0.02 ? 0 : 1;
  const at = (l: number, cc: number): Lch => ({ l, c: Math.min(cc, pick.c) * tint, h: pick.h });
  return {
    light: {
      "--secondary": css(at(0.958, 0.018)), "--sidebar-accent": css(at(0.958, 0.018)),
      "--secondary-foreground": css(at(0.3, 0.08)), "--muted": css(at(0.958, 0.012)),
    },
    dark: {
      "--secondary": css(at(0.27, 0.035)), "--sidebar-accent": css(at(0.27, 0.035)),
      "--muted": css(at(0.27, 0.03)), "--accent": css(at(0.31, 0.05)),
    },
  };
}

/** The stylesheet that puts a brand colour on the whole app. */
export function brandColorCss(hex: string): string {
  const p = brandPalette(hex);
  const t = brandTints(hex);
  if (!p || !t) return "";
  const block = (sel: string, vars: Record<string, string>) => `${sel} { ${Object.entries(vars).map(([k, v]) => `${k}: ${v};`).join(" ")} }`;
  return [
    block(":root[data-brand-color]", p.light),
    block(":root[data-brand-color]:not([data-studio])", t.light),
    block(":root.dark[data-brand-color]", p.dark),
    block(":root.dark[data-brand-color]:not([data-studio])", t.dark),
  ].join("\n");
}

/** Ready-made brand colours — the app's own accents, and a few more. */
export const BRAND_PRESETS: { name: string; hex: string }[] = [
  { name: "Royal blue", hex: oklchToHex({ l: 0.475, c: 0.13, h: 264 }) },
  { name: "Sapphire", hex: oklchToHex({ l: 0.5, c: 0.14, h: 235 }) },
  { name: "Emerald", hex: oklchToHex({ l: 0.5, c: 0.12, h: 160 }) },
  { name: "Teal", hex: oklchToHex({ l: 0.5, c: 0.09, h: 195 }) },
  { name: "Gold", hex: oklchToHex({ l: 0.52, c: 0.1, h: 72 }) },
  { name: "Rose gold", hex: oklchToHex({ l: 0.52, c: 0.09, h: 30 }) },
  { name: "Ruby", hex: oklchToHex({ l: 0.5, c: 0.17, h: 15 }) },
  { name: "Plum", hex: oklchToHex({ l: 0.45, c: 0.12, h: 320 }) },
  { name: "Graphite", hex: oklchToHex({ l: 0.36, c: 0.02, h: 260 }) },
];
