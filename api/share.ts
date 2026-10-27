// A shared link's preview — what WhatsApp, Telegram, iMessage or an email show
// before anyone opens it (/s/:id, and /s/:id?p=<piece> for one piece).
//
// Those apps read the page's HTML and never run the app, so every link showed
// the portal's logo. Here the page is served with the share's own picture, name
// and a line about it in its <head>; the app then opens as it always does.
//
// The share is read from the database as anyone may read it (a share is
// public); the photo is offered small (Vercel resizes it), since WhatsApp skips
// a large one. Anything missing or unreadable: the page as it always was.
export const config = { runtime: "edge" };

const DB = "https://firestore.googleapis.com/v1/projects/starlinkjewels109/databases/diamondflow/documents";

type FsValue = { stringValue?: string; integerValue?: string; doubleValue?: number; booleanValue?: boolean; nullValue?: null;
  timestampValue?: string; arrayValue?: { values?: FsValue[] }; mapValue?: { fields?: Record<string, FsValue> } };
/** Firestore's REST value, as plain data. */
function plain(v: FsValue | undefined): unknown {
  if (!v) return undefined;
  if (v.stringValue !== undefined) return v.stringValue;
  if (v.integerValue !== undefined) return Number(v.integerValue);
  if (v.doubleValue !== undefined) return v.doubleValue;
  if (v.booleanValue !== undefined) return v.booleanValue;
  if (v.timestampValue !== undefined) return v.timestampValue;
  if (v.arrayValue) return (v.arrayValue.values ?? []).map(plain);
  if (v.mapValue) return Object.fromEntries(Object.entries(v.mapValue.fields ?? {}).map(([k, x]) => [k, plain(x)]));
  return undefined;
}

interface Piece { id: string; name: string; sku?: string; type?: string; metal?: string; karat?: string; diamondCt?: number; price?: number; photos?: string[]; cad?: string }
interface ShareDoc { title?: string; note?: string; kind?: string; pieces?: Piece[]; brand?: { name?: string }; showPrice?: boolean; expiresAt?: string; count?: number; items?: { url?: string; type?: string }[] }

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const money = (n: number) => `$${n.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;

export default async function handler(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const page = await fetch(new URL("/index.html", url.origin));
  let html = await page.text();
  const plainPage = () => new Response(html, { status: 200, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=0, must-revalidate" } });

  const id = url.searchParams.get("id") ?? "";
  if (!/^[\w-]{3,80}$/.test(id)) return plainPage();
  let share: ShareDoc | null = null;
  try {
    const r = await fetch(`${DB}/shares/${encodeURIComponent(id)}`);
    if (r.ok) share = plain({ mapValue: { fields: (await r.json()).fields } }) as ShareDoc;
  } catch { /* the page as it always was */ }
  if (!share || (share.expiresAt && share.expiresAt < new Date().toISOString())) return plainPage();

  const brand = share.brand?.name || "Starlink Jewels";
  const pieces = share.pieces ?? [];
  const one = pieces.find(p => p.id === url.searchParams.get("p")) ?? (pieces.length === 1 ? pieces[0] : undefined);
  // A photo — never a video, a 3D model or a document from a Catalog folder.
  const isPhoto = (u?: string) => !!u && /\.(jpe?g|png|webp|gif)(\?|$)/i.test(decodeURIComponent(u.split("?")[0]));
  const photo = one ? (one.photos?.[0] || one.cad) : (pieces.find(p => p.photos?.[0])?.photos?.[0] ?? share.items?.find(i => i.type === "image" || isPhoto(i.url))?.url);
  const title = one ? one.name : share.title || brand;
  const line = one
    ? [one.sku && `Design ${one.sku}`, [one.karat, one.metal].filter(Boolean).join(" "), one.diamondCt && `${one.diamondCt} ct`, share.showPrice && one.price != null && money(one.price)].filter(Boolean).join(" · ")
    : [pieces.length ? `${pieces.length} pieces` : `${share.count || share.items?.length || 0} items`, share.note].filter(Boolean).join(" · ");
  const image = photo ? `${url.origin}/_vercel/image?url=${encodeURIComponent(photo)}&w=640&q=75` : "";
  const link = `${url.origin}/s/${id}${one && pieces.length > 1 ? `?p=${encodeURIComponent(one.id)}` : ""}`;

  const tags = [
    `<meta property="og:type" content="${one ? "product" : "website"}" />`,
    `<meta property="og:site_name" content="${esc(brand)}" />`,
    `<meta property="og:title" content="${esc(title)}" />`,
    `<meta property="og:description" content="${esc(line || brand)}" />`,
    `<meta property="og:url" content="${esc(link)}" />`,
    ...(image ? [`<meta property="og:image" content="${esc(image)}" />`, `<meta property="og:image:width" content="640" />`, `<meta name="twitter:image" content="${esc(image)}" />`] : []),
    `<meta name="twitter:card" content="${image ? "summary_large_image" : "summary"}" />`,
    `<meta name="twitter:title" content="${esc(title)}" />`,
  ].join("\n    ");
  html = html
    .replace(/<title>[^<]*<\/title>/, `<title>${esc(title)} — ${esc(brand)}</title>`)
    .replace(/<meta name="description" content="[^"]*"\s*\/?>/, `<meta name="description" content="${esc(line || brand)}" />`)
    .replace("</head>", `    ${tags}\n  </head>`);
  return new Response(html, { status: 200, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=300" } });
}
