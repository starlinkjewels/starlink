// GENERATED from src/lib/pure/campaignEmail.ts by functions-campaigns/scripts/sync-shared.cjs - do not edit here.
// An email campaign's design, and the email it makes — the ONE drawing of it:
// the campaign editor's laptop and phone previews, the test email and every
// email sent are all this function's output (functions-campaigns copies this
// file), so what is previewed is exactly what arrives.
//
// The design is a short list of blocks (heading, text, image, button, product
// cards, an offer, a divider, a gap) and a theme — never free HTML. The AI
// writes blocks too, so nothing it writes can carry a script, a form or a
// tracker, and every email is drawn the way email programs read it: one
// 600-px column of tables, its styles written on each element, images from
// https addresses with their sizes and alt text, a hidden preview line, and
// on a phone the cards one under the other. Every word is escaped; links are
// http(s), mailto or tel only; colours are #hex only.
//
// Plain functions, no imports.

export type CampaignBlock =
  | { id: string; type: "heading"; text: string; size?: "lg" | "md"; align?: Align }
  | { id: string; type: "text"; text: string; align?: Align }
  | { id: string; type: "image"; src: string; alt?: string; href?: string; width?: number }
  | { id: string; type: "button"; label: string; href: string; align?: Align }
  | { id: string; type: "products"; columns?: 2 | 3; items: ProductCard[] }
  | { id: string; type: "offer"; title: string; text?: string; code?: string }
  | { id: string; type: "divider" }
  | { id: string; type: "spacer"; size?: number };
export type Align = "left" | "center";
export interface ProductCard { src?: string; alt?: string; title: string; sub?: string; href?: string }

export interface CampaignTheme {
  /** Buttons, the offer box, links — the brand's colour. */
  brand: string;
  /** Behind the email. */
  page: string;
  /** Headings and words. */
  ink: string;
  /** Web-safe family: every email program has it. */
  font: "sans" | "serif";
  /** The logo above everything, and where. */
  header: Align;
}
export interface CampaignDesign {
  v: 1;
  theme: CampaignTheme;
  blocks: CampaignBlock[];
}

/** What surrounds the design: the sender, and (per email) the person and their links. */
export interface RenderCtx {
  brandName: string;
  /** An https address of the logo (a data: picture is blocked by most email programs). */
  logoUrl?: string;
  logoWidth?: number;
  /** The footer: who sends it and where they are (shown on every email). */
  address?: string;
  contact?: string;
  /** Why they get it — "You're receiving this as a client of Starlink Jewels." */
  reason?: string;
  /** The person's own one-click unsubscribe (clients); none → no link (e.g. a test). */
  unsubscribeUrl?: string;
  /** Merge fields: {{first_name}}, {{name}}, {{company}} — with a fallback: {{first_name|there}}. */
  vars?: Record<string, string | undefined>;
  /** The line beside the subject in the inbox. */
  preheader?: string;
  subject: string;
  /** A strip above everything — a test email says so. */
  banner?: string;
}

export const MERGE_FIELDS = [
  { key: "first_name", label: "First name", example: "Ravi" },
  { key: "name", label: "Full name", example: "Ravi Mehta" },
  { key: "company", label: "Company", example: "Mehta Jewellers" },
] as const;

export const DEFAULT_THEME: CampaignTheme = { brand: "#1B2A4A", page: "#F4F5F7", ink: "#1F2937", font: "sans", header: "center" };

/** Gmail cuts an email off ("[Message clipped]") past about 102 KB of HTML. */
export const GMAIL_CLIP_BYTES = 102 * 1024;

/* ─────────────── Making a design safe ─────────────── */

const HEX = /^#[0-9a-f]{6}$/i;
const hex = (v: unknown, d: string) => (typeof v === "string" && HEX.test(v.trim()) ? v.trim() : d);
const str = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").slice(0, max) : "");
const align = (v: unknown): Align => (v === "left" ? "left" : "center");

/** An address a reader may open: http(s), mailto or tel — anything else is dropped. */
export function safeUrl(v: unknown): string {
  const s = str(v, 1000).trim();
  if (!s) return "";
  if (/^mailto:[^\s<>"']+$/i.test(s) || /^tel:[+\d\s()-]{3,30}$/i.test(s)) return s;
  try {
    const u = new URL(s);
    return u.protocol === "https:" || u.protocol === "http:" ? u.toString() : "";
  } catch { return ""; }
}
/** An image an email program will show: https only (http is blocked or warned about). */
export function safeImage(v: unknown): string {
  const u = safeUrl(v);
  return u.startsWith("https://") ? u : "";
}

let idSeq = 0;
const newId = () => `b${Date.now().toString(36)}${(idSeq++).toString(36)}`;

/** Any design (saved, typed, or written by the AI) as one that can be drawn: unknown parts dropped, sizes capped. */
export function cleanDesign(input: unknown): CampaignDesign {
  const d = (input ?? {}) as { theme?: Partial<CampaignTheme>; blocks?: unknown[] };
  const t = d.theme ?? {};
  const theme: CampaignTheme = {
    brand: hex(t.brand, DEFAULT_THEME.brand), page: hex(t.page, DEFAULT_THEME.page), ink: hex(t.ink, DEFAULT_THEME.ink),
    font: t.font === "serif" ? "serif" : "sans", header: align(t.header),
  };
  const blocks: CampaignBlock[] = [];
  for (const raw of (Array.isArray(d.blocks) ? d.blocks : []).slice(0, 60)) {
    const b = (raw ?? {}) as Record<string, unknown>;
    const id = typeof b.id === "string" && /^[\w-]{1,40}$/.test(b.id) ? b.id : newId();
    switch (b.type) {
      case "heading": { const text = str(b.text, 200).trim(); if (text) blocks.push({ id, type: "heading", text, size: b.size === "md" ? "md" : "lg", align: align(b.align) }); break; }
      case "text": { const text = str(b.text, 4000).trim(); if (text) blocks.push({ id, type: "text", text, align: b.align === "center" ? "center" : "left" }); break; }
      case "image": {
        const src = safeImage(b.src);
        const w = Number(b.width);
        blocks.push({ id, type: "image", src, alt: str(b.alt, 200), href: safeUrl(b.href) || undefined, width: [100, 80, 60, 40].includes(w) ? w : 100 });
        break;
      }
      case "button": { const label = str(b.label, 60).trim(); if (label) blocks.push({ id, type: "button", label, href: safeUrl(b.href), align: align(b.align) }); break; }
      case "products": {
        const items = (Array.isArray(b.items) ? b.items : []).slice(0, 12).map(x => {
          const p = (x ?? {}) as Record<string, unknown>;
          return { src: safeImage(p.src) || undefined, alt: str(p.alt, 200) || undefined, title: str(p.title, 80).trim(), sub: str(p.sub, 120).trim() || undefined, href: safeUrl(p.href) || undefined };
        }).filter(p => p.title || p.src);
        if (items.length) blocks.push({ id, type: "products", columns: b.columns === 3 ? 3 : 2, items });
        break;
      }
      case "offer": { const title = str(b.title, 80).trim(); if (title) blocks.push({ id, type: "offer", title, text: str(b.text, 300).trim() || undefined, code: str(b.code, 30).trim() || undefined }); break; }
      case "divider": blocks.push({ id, type: "divider" }); break;
      case "spacer": { const n = Number(b.size); blocks.push({ id, type: "spacer", size: Number.isFinite(n) ? Math.min(64, Math.max(8, Math.round(n))) : 24 }); break; }
    }
  }
  return { v: 1, theme, blocks };
}

/** Exactly what an email says — a test must have shown this before it can start (hashed on the server). */
export function designKey(subject: unknown, preheader: unknown, design: unknown): string {
  return JSON.stringify([String(subject ?? "").trim(), String(preheader ?? "").trim(), cleanDesign(design)]);
}

/* ─────────────── Words ─────────────── */

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
const attr = esc;

/** {{first_name}} / {{first_name|there}} → the person's own (escaped later with the rest). */
export function fillMerge(text: string, vars: Record<string, string | undefined> = {}): string {
  return text.replace(/\{\{\s*([a-z_]+)\s*(?:\|([^}]*))?\}\}/gi, (_, k: string, fb?: string) => {
    const v = vars[k.toLowerCase()]?.trim();
    return v || (fb ?? "").trim();
  });
}

/** A few marks in text: **bold**, *italic*, [words](https://…), and new lines — all else is plain words. */
function inline(text: string, linkColor: string): string {
  let out = esc(text);
  out = out.replace(/\[([^\]\n]{1,200})\]\(([^)\s]{1,1000})\)/g, (m, label: string, url: string) => {
    const u = safeUrl(url.replace(/&amp;/g, "&"));
    return u ? `<a href="${attr(u)}" style="color:${linkColor};text-decoration:underline;" target="_blank">${label}</a>` : label;
  });
  out = out.replace(/\*\*([^*\n]{1,400})\*\*/g, "<strong>$1</strong>").replace(/(^|[^*])\*([^*\n]{1,400})\*/g, "$1<em>$2</em>");
  return out.replace(/\r?\n/g, "<br>");
}
/** The same words as plain text, for the email's text part. */
function plain(text: string): string {
  return text.replace(/\[([^\]\n]+)\]\(([^)\s]+)\)/g, (_, l: string, u: string) => `${l} (${u})`).replace(/\*\*([^*]+)\*\*/g, "$1").replace(/\*([^*]+)\*/g, "$1");
}

/* ─────────────── Drawing it ─────────────── */

const FONTS = {
  sans: "Arial, 'Helvetica Neue', Helvetica, sans-serif",
  serif: "Georgia, 'Times New Roman', Times, serif",
};
const W = 600, PAD = 32;

export interface Rendered { html: string; text: string; bytes: number; clipped: boolean; images: number; missingAlt: number; emptyLinks: number }

export function renderCampaign(designIn: CampaignDesign | unknown, ctx: RenderCtx): Rendered {
  const d = cleanDesign(designIn);
  const t = d.theme;
  const font = FONTS[t.font];
  // A person's own details are words only: brackets and stars in a name can't make a link or bold.
  const vars = Object.fromEntries(Object.entries(ctx.vars ?? {}).map(([k, v]) => [k, v?.replace(/[[\]*]/g, "")]));
  const fill = (s: string) => fillMerge(s, vars);
  const inner = W - PAD * 2;
  let images = 0, missingAlt = 0, emptyLinks = 0;
  const textOut: string[] = [];

  const row = (cell: string, pad = `0 ${PAD}px`) => `<tr><td class="px" style="padding:${pad};">${cell}</td></tr>`;
  const img = (src: string, alt: string, width: number, href?: string, radius = 8) => {
    images++;
    if (!alt.trim()) missingAlt++;
    const tag = `<img src="${attr(src)}" width="${width}" alt="${attr(alt)}" style="display:block;width:100%;max-width:${width}px;height:auto;border:0;outline:none;text-decoration:none;border-radius:${radius}px;">`;
    return href ? `<a href="${attr(href)}" target="_blank" style="text-decoration:none;">${tag}</a>` : tag;
  };

  const parts: string[] = [];
  for (const b of d.blocks) {
    switch (b.type) {
      case "heading": {
        const txt = fill(b.text);
        const size = b.size === "md" ? 20 : 26;
        parts.push(row(`<h${b.size === "md" ? 2 : 1} style="margin:0;font-family:${font};font-size:${size}px;line-height:1.3;font-weight:700;color:${t.ink};text-align:${b.align};">${inline(txt, t.brand)}</h${b.size === "md" ? 2 : 1}>`, `8px ${PAD}px 8px`));
        textOut.push(plain(txt).toUpperCase());
        break;
      }
      case "text": {
        const txt = fill(b.text);
        parts.push(row(`<p style="margin:0;font-family:${font};font-size:16px;line-height:1.6;color:${t.ink};text-align:${b.align};">${inline(txt, t.brand)}</p>`, `8px ${PAD}px`));
        textOut.push(plain(txt));
        break;
      }
      case "image": {
        if (!b.src) break;
        const w = Math.round((inner * (b.width ?? 100)) / 100);
        parts.push(row(`<table role="presentation" align="center" cellpadding="0" cellspacing="0" border="0" style="margin:0 auto;"><tr><td>${img(b.src, fill(b.alt ?? ""), w, b.href)}</td></tr></table>`, `12px ${PAD}px`));
        if (b.alt) textOut.push(`[${fill(b.alt)}]`);
        break;
      }
      case "button": {
        if (!b.href) emptyLinks++;
        const href = b.href || "#";
        const label = esc(fill(b.label));
        // A "bulletproof" button: a coloured cell with a link in it — no picture, works in Outlook too.
        parts.push(row(`<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="${b.align}" style="margin:${b.align === "center" ? "0 auto" : "0"};"><tr>
<td align="center" bgcolor="${t.brand}" style="border-radius:8px;background:${t.brand};">
<a href="${attr(href)}" target="_blank" style="display:inline-block;padding:14px 28px;font-family:${font};font-size:16px;font-weight:700;line-height:1.2;color:#ffffff;text-decoration:none;border-radius:8px;">${label}</a>
</td></tr></table>`, `16px ${PAD}px`));
        textOut.push(`${fill(b.label)}: ${b.href}`);
        break;
      }
      case "products": {
        const cols = b.columns ?? 2;
        const gap = 16;
        const cw = Math.floor((inner - gap * (cols - 1)) / cols);
        const cells = b.items.map(p => {
          const pic = p.src ? img(p.src, fill(p.alt ?? p.title), cw, p.href) : "";
          const title = p.title ? `<p style="margin:10px 0 0;font-family:${font};font-size:15px;line-height:1.35;font-weight:700;color:${t.ink};">${p.href ? `<a href="${attr(p.href)}" target="_blank" style="color:${t.ink};text-decoration:none;">${esc(fill(p.title))}</a>` : esc(fill(p.title))}</p>` : "";
          const sub = p.sub ? `<p style="margin:4px 0 0;font-family:${font};font-size:13px;line-height:1.4;color:#6B7280;">${esc(fill(p.sub))}</p>` : "";
          textOut.push(`- ${fill(p.title)}${p.sub ? ` — ${fill(p.sub)}` : ""}${p.href ? ` (${p.href})` : ""}`);
          return `${pic}${title}${sub}`;
        });
        // Rows of `cols` cards; on a phone each card takes the whole width (the "stack" class).
        const rows: string[] = [];
        for (let i = 0; i < cells.length; i += cols) {
          const tds = Array.from({ length: cols }, (_, j) => {
            const c = cells[i + j];
            const pad = j < cols - 1 ? `padding:0 ${gap}px ${gap}px 0;` : `padding:0 0 ${gap}px 0;`;
            return `<td class="stack" width="${cw + (j < cols - 1 ? gap : 0)}" valign="top" style="${pad}width:${cw + (j < cols - 1 ? gap : 0)}px;">${c ?? "&nbsp;"}</td>`;
          }).join("");
          rows.push(`<tr>${tds}</tr>`);
        }
        parts.push(row(`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${rows.join("")}</table>`, `12px ${PAD}px 0`));
        break;
      }
      case "offer": {
        parts.push(row(`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:2px dashed ${t.brand};border-radius:12px;">
<tr><td align="center" style="padding:20px 16px;font-family:${font};">
<p style="margin:0;font-size:22px;line-height:1.3;font-weight:700;color:${t.brand};">${esc(fill(b.title))}</p>
${b.text ? `<p style="margin:8px 0 0;font-size:15px;line-height:1.5;color:${t.ink};">${inline(fill(b.text), t.brand)}</p>` : ""}
${b.code ? `<p style="margin:12px 0 0;font-size:14px;color:#6B7280;">Use code <span style="display:inline-block;margin-left:4px;padding:6px 12px;border-radius:6px;background:${t.page};font-family:'Courier New',Courier,monospace;font-size:16px;font-weight:700;letter-spacing:2px;color:${t.ink};">${esc(b.code)}</span></p>` : ""}
</td></tr></table>`, `16px ${PAD}px`));
        textOut.push(`*** ${fill(b.title)} ***${b.text ? ` ${plain(fill(b.text))}` : ""}${b.code ? ` — code ${b.code}` : ""}`);
        break;
      }
      case "divider":
        parts.push(row(`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td style="border-top:1px solid #E5E7EB;font-size:0;line-height:0;height:1px;">&nbsp;</td></tr></table>`, `16px ${PAD}px`));
        textOut.push("—");
        break;
      case "spacer":
        parts.push(`<tr><td style="height:${b.size ?? 24}px;font-size:0;line-height:0;">&nbsp;</td></tr>`);
        break;
    }
  }

  const logo = ctx.logoUrl && safeImage(ctx.logoUrl)
    ? `<img src="${attr(safeImage(ctx.logoUrl))}" width="${ctx.logoWidth ?? 160}" alt="${attr(ctx.brandName)}" style="display:${t.header === "center" ? "block;margin:0 auto" : "block"};width:${ctx.logoWidth ?? 160}px;max-width:100%;height:auto;border:0;">`
    : `<span style="font-family:${font};font-size:22px;font-weight:700;color:${t.ink};">${esc(ctx.brandName)}</span>`;

  const foot = [
    `<strong style="color:${t.ink};">${esc(ctx.brandName)}</strong>`,
    ctx.address ? esc(ctx.address).replace(/\r?\n/g, "<br>") : "",
    ctx.contact ? esc(ctx.contact) : "",
    ctx.reason ? esc(ctx.reason) : "",
    ctx.unsubscribeUrl ? `<a href="${attr(ctx.unsubscribeUrl)}" target="_blank" style="color:#6B7280;text-decoration:underline;">Unsubscribe</a> from these emails` : "",
  ].filter(Boolean).join("<br>");

  const pre = fill(ctx.preheader ?? "").trim();
  // Spacers after the preview line, so the inbox doesn't fill the rest with the email's first words.
  const preHtml = pre ? `<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:${t.page};opacity:0;">${esc(pre)}${"&#8199;&#65279;&#847; ".repeat(40)}</div>` : "";
  const subject = esc(fill(ctx.subject));

  const html = `<!doctype html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<meta name="format-detection" content="telephone=no,date=no,address=no,email=no,url=no">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${subject}</title>
<!--[if mso]><noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript><![endif]-->
<style>
  body{margin:0!important;padding:0!important;width:100%!important;}
  img{-ms-interpolation-mode:bicubic;}
  a[x-apple-data-detectors]{color:inherit!important;text-decoration:none!important;}
  @media only screen and (max-width:620px){
    .wrap{width:100%!important;}
    .px{padding-left:20px!important;padding-right:20px!important;}
    .stack{display:block!important;width:100%!important;max-width:100%!important;padding-right:0!important;box-sizing:border-box;}
    h1{font-size:23px!important;}
  }
</style>
</head>
<body style="margin:0;padding:0;background:${t.page};">
${preHtml}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${t.page};">
<tr><td align="center" style="padding:24px 12px;">
<!--[if mso]><table role="presentation" width="${W}" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->
${ctx.banner ? `<table role="presentation" class="wrap" width="${W}" cellpadding="0" cellspacing="0" border="0" style="width:${W}px;max-width:${W}px;"><tr><td align="center" style="padding:10px 16px;margin-bottom:8px;border-radius:10px;background:#FEF3C7;font-family:${font};font-size:13px;font-weight:700;color:#92400E;">${esc(ctx.banner)}</td></tr><tr><td style="height:10px;font-size:0;line-height:0;">&nbsp;</td></tr></table>` : ""}
<table role="presentation" class="wrap" width="${W}" cellpadding="0" cellspacing="0" border="0" style="width:${W}px;max-width:${W}px;background:#ffffff;border-radius:16px;">
<tr><td class="px" align="${t.header}" style="padding:28px ${PAD}px 16px;">${logo}</td></tr>
${parts.join("\n")}
<tr><td style="height:24px;font-size:0;line-height:0;">&nbsp;</td></tr>
</table>
<table role="presentation" class="wrap" width="${W}" cellpadding="0" cellspacing="0" border="0" style="width:${W}px;max-width:${W}px;">
<tr><td class="px" align="center" style="padding:20px ${PAD}px 8px;font-family:${font};font-size:12px;line-height:1.6;color:#6B7280;">${foot}</td></tr>
</table>
<!--[if mso]></td></tr></table><![endif]-->
</td></tr>
</table>
</body>
</html>`;

  const text = [
    pre, "", ...textOut, "", "—", ctx.brandName, ctx.address ?? "", ctx.contact ?? "", ctx.reason ?? "",
    ctx.unsubscribeUrl ? `Unsubscribe: ${ctx.unsubscribeUrl}` : "",
  ].filter((l, i, a) => !(l === "" && a[i - 1] === "")).join("\n").trim();

  const bytes = new TextEncoder().encode(html).length;
  return { html, text, bytes, clipped: bytes > GMAIL_CLIP_BYTES, images, missingAlt, emptyLinks };
}

/** The design's own checks before a test or a send — what a careful sender would catch. */
export function designProblems(d: CampaignDesign, subject: string, r: Rendered): { level: "stop" | "warn"; text: string }[] {
  const out: { level: "stop" | "warn"; text: string }[] = [];
  if (!subject.trim()) out.push({ level: "stop", text: "Add a subject" });
  if (!d.blocks.length) out.push({ level: "stop", text: "The email is empty — add a block or write it with AI" });
  if (d.blocks.some(b => b.type === "image" && !b.src)) out.push({ level: "stop", text: "An image block has no picture — choose one or remove the block" });
  if (r.emptyLinks) out.push({ level: "stop", text: `${r.emptyLinks} button${r.emptyLinks > 1 ? "s have" : " has"} no link` });
  if (r.clipped) out.push({ level: "warn", text: `The email is ${Math.round(r.bytes / 1024)} KB — Gmail cuts off emails past 102 KB. Use fewer blocks.` });
  if (r.missingAlt) out.push({ level: "warn", text: `${r.missingAlt} picture${r.missingAlt > 1 ? "s have" : " has"} no description (alt text) — shown when pictures are off, and read aloud` });
  if (subject.length > 90) out.push({ level: "warn", text: "The subject is long — phones show about 40–60 characters" });
  if (/\b(free|winner|guarantee|100%|act now|urgent)\b/i.test(subject) || /!!|\$\$|₹₹/.test(subject) || (subject.length > 8 && subject === subject.toUpperCase() && /[A-Z]/.test(subject)))
    out.push({ level: "warn", text: "The subject has words or capitals spam filters dislike" });
  const words = d.blocks.reduce((n, b) => n + (b.type === "text" || b.type === "heading" ? b.text.split(/\s+/).length : 0), 0);
  if (r.images >= 3 && words < 25) out.push({ level: "warn", text: "Mostly pictures and few words — spam filters and readers with pictures off like some text" });
  return out;
}
