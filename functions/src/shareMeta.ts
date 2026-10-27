// A shared link's preview — what WhatsApp, Telegram, iMessage or an email show
// before anyone opens it (/s/:id, and /s/:id?p=<piece> for one piece).
//
// Those apps read the page's HTML and never run the app, so every link showed
// the app's logo. Hosting sends /s/** here (firebase.json): the page is served
// with the share's own picture, name and a line about it in its <head>, and the
// app then opens as it always does. The picture comes small from shareImage
// below — WhatsApp skips a large one. Anything missing: the page as it was.
import { onRequest } from "firebase-functions/v2/https";
import sharp from "sharp";
import { db } from "./lib/firestoreAdmin";

const REGION = "asia-south1";
const SITE = "https://ssdiam.web.app";
/** Only this app's own storage is ever fetched for a picture. */
const PHOTO_RE = /^https:\/\/firebasestorage\.googleapis\.com\/v0\/b\/diamondflow-35f6e\.firebasestorage\.app\/o\//;

interface Piece { id: string; name: string; sku?: string; metal?: string; karat?: string; diamondCt?: number; price?: number; photos?: string[]; cad?: string }
interface ShareDoc { title?: string; note?: string; pieces?: Piece[]; brand?: { name?: string }; showPrice?: boolean; expiresAt?: string; count?: number; items?: { url?: string; type?: string }[] }

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const money = (n: number) => `$${n.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;

export const shareMeta = onRequest({ region: REGION, invoker: "public", memory: "256MiB", maxInstances: 10, timeoutSeconds: 20 }, async (req, res) => {
  let html = await (await fetch(`${SITE}/index.html`)).text();
  const send = (cache: string) => { res.set("Cache-Control", cache); res.set("Content-Type", "text/html; charset=utf-8"); res.status(200).send(html); };
  const id = (req.path.match(/^\/s\/([\w-]{3,80})/) ?? [])[1];
  if (!id) return send("public, max-age=0, must-revalidate");
  let share: ShareDoc | undefined;
  try { share = (await db.collection("shares").doc(id).get()).data() as ShareDoc | undefined; } catch { /* the page as it was */ }
  if (!share || (share.expiresAt && share.expiresAt < new Date().toISOString())) return send("public, max-age=0, must-revalidate");

  const brand = share.brand?.name || "Shree Suktam Diamond";
  const pieces = share.pieces ?? [];
  const p = typeof req.query.p === "string" ? req.query.p : "";
  const one = pieces.find(x => x.id === p) ?? (pieces.length === 1 ? pieces[0] : undefined);
  const photo = one ? (one.photos?.[0] || one.cad) : (pieces.find(x => x.photos?.[0])?.photos?.[0] ?? share.items?.find(i => i.type !== "video")?.url);
  const title = one ? one.name : share.title || brand;
  const line = one
    ? [one.sku && `Design ${one.sku}`, [one.karat, one.metal].filter(Boolean).join(" "), one.diamondCt && `${one.diamondCt} ct`, share.showPrice && one.price != null && money(one.price)].filter(Boolean).join(" · ")
    : [`${pieces.length || share.count || 0} pieces`, share.note].filter(Boolean).join(" · ");
  const image = photo && PHOTO_RE.test(photo) ? `${SITE}/share-img?u=${encodeURIComponent(photo)}` : "";
  const link = `${SITE}/s/${id}${one && pieces.length > 1 ? `?p=${encodeURIComponent(one.id)}` : ""}`;
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
  send("public, max-age=300");
});

/** The share's picture, small (640px JPEG) — for a link preview. Only this app's own storage. */
export const shareImage = onRequest({ region: REGION, invoker: "public", memory: "512MiB", maxInstances: 10, timeoutSeconds: 30 }, async (req, res) => {
  const u = typeof req.query.u === "string" ? req.query.u : "";
  if (!PHOTO_RE.test(u)) { res.status(403).send("Not allowed"); return; }
  const r = await fetch(u);
  if (!r.ok || !/^image\//.test(r.headers.get("content-type") ?? "")) { res.status(404).send("Not found"); return; }
  const jpg = await sharp(Buffer.from(await r.arrayBuffer())).rotate().resize({ width: 640, height: 640, fit: "inside", withoutEnlargement: true })
    .flatten({ background: "#ffffff" }).jpeg({ quality: 78 }).toBuffer();
  res.set("Cache-Control", "public, max-age=86400");
  res.set("Content-Type", "image/jpeg");
  res.status(200).send(jpg);
});
