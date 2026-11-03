// The Ready Stock API's documentation, for a client's developer — one key's
// own copy (its address, limits, what it shows, its price rule, its websites;
// the key itself only when it has just been made) or the general one.
// Written once as sections, then given as a web page (.html), a PDF and an
// OpenAPI file (.json, for Postman / Swagger / any API tool).
import { brandName } from "./brand";
import { BLOCK_HOURS, BLOCKS_TO_PAUSE, DEFAULT_PER_DAY, DEFAULT_PER_MINUTE, maskedKey, type ApiKeyDoc } from "./apiKeysModel";

export interface DocsFor {
  base: string;
  key?: ApiKeyDoc;
  /** The key itself — only right after it is made or replaced. */
  secret?: string;
  /** Company id → name, for a key limited to some companies. */
  companyName?: (id: string) => string;
}

type Block =
  | { p: string }
  | { code: string; lang?: string }
  | { table: { head: string[]; rows: string[][] } }
  | { list: string[] }
  | { note: string };
interface Section { h: string; blocks: Block[] }

const PARAMS: [string, string, string][] = [
  ["q", "text", "Search — every word must start a word of the piece: name, SKU, design number, category, metal, karat, colour, stone, office, size"],
  ["category", "list", "Ring, Pendant, Earrings… — several with commas"],
  ["metal", "list", "Yellow Gold, White Gold, Platinum…"],
  ["karat", "list", "9K, 14K, 18K…"],
  ["color", "list", "Metal colour — Yellow, Rose, White"],
  ["diamondType", "list", "Natural, Lab Grown, CVD…"],
  ["shape", "list", "Main stone shape — Round, Oval, Pear…"],
  ["office", "list", "Where the piece is — US, Hong Kong, India…"],
  ["size", "list", "Ring size and similar"],
  ["minPrice / maxPrice", "number", "Price range (USD, your price)"],
  ["minGross / maxGross", "number", "Gross weight range (g)"],
  ["minNet / maxNet", "number", "Net weight range (g)"],
  ["minCt / maxCt", "number", "Diamond weight range (ct)"],
  ["minQty / maxQty", "number", "Pieces available"],
  ["sku / designNumber", "text", "Exactly this SKU / design number"],
  ["ids", "list", "Only these product ids (up to 200) — e.g. to refresh a cart"],
  ["hasVideo / hasImages / hasModel3d / certified", "true/false", "With (or without) a video, photos, a 3D model, a certificate"],
  ["includeSoldOut", "true/false", "Also pieces with none left (default: only in stock) — for keeping a copy in step"],
  ["updatedSince / createdSince", "date", "Changed / added since (ISO date or time, UTC)"],
  ["sort", "text", "newest (default), oldest, updated, price_asc, price_desc, weight_asc, weight_desc, carat_asc, carat_desc, name_asc, name_desc, qty_desc"],
  ["page", "number", "Page, from 1"],
  ["limit", "number", "Pieces a page, 1–100 (default 24)"],
  ["fields", "list", "Only these fields (id always) — e.g. fields=id,name,price,image"],
];

const FIELDS: [string, string, string][] = [
  ["id", "string", "Our id for the piece — stays the same"],
  ["sku", "string | null", "Its SKU (or design number)"],
  ["name", "string", "Its name"],
  ["category", "string | null", "Ring, Pendant, Earrings…"],
  ["metal / karat / metalColor", "string | null", "e.g. Yellow Gold · 18K · Yellow"],
  ["grossWeightG / netWeightG", "number | null", "Weights in grams"],
  ["diamondCt / diamondType / diamondShape / diamondPieces", "…", "Diamond weight (ct), Natural / Lab Grown…, main shape, number of stones"],
  ["otherMetal", "object | null", "A second metal: { name, weightG, purity }"],
  ["size / designNumber / rhodium / stamping", "string | null", "From the design"],
  ["certified", "boolean", "Comes with a certificate"],
  ["price / currency", "number | null · \"USD\"", "Your price (null when not shared)"],
  ["quantity / inStock", "number · boolean", "Pieces available"],
  ["office", "string | null", "Where the piece is kept"],
  ["images / image", "string[] · string | null", "Every photo (full size); image = the first"],
  ["video", "object | null", "{ url, playable } — playable is an MP4 copy every browser and phone plays (null until made; use url then)"],
  ["model3d", "string | null", "A 3D model file (.3dm), when there is one and it is shared with you"],
  ["createdAt / updatedAt", "string", "When it was added / last changed (ISO, UTC)"],
];

const ERRORS: [string, string, string][] = [
  ["400", "bad_parameter · price_not_shared", "A parameter is wrong — the message says which and why"],
  ["401", "missing_key · invalid_key · revoked_key", "No key, a wrong key, or a key that was deleted"],
  ["403", "key_paused · website_not_allowed", "The key is paused, or used from a website it does not allow"],
  ["404", "not_found", "No such product (or address)"],
  ["429", "rate_limited · daily_limit · key_blocked · too_many_wrong_keys", "Too many calls — wait the seconds in the Retry-After header"],
  ["5xx", "server_error · unavailable", "Our side — try again in a moment"],
];

function scopeText(k: ApiKeyDoc, companyName?: (id: string) => string): string[] {
  const s = k.scope ?? {};
  const out: string[] = [];
  if (s.types?.length) out.push(`Categories: ${s.types.join(", ")}`);
  if (s.metals?.length) out.push(`Metals: ${s.metals.join(", ")}`);
  if (s.offices?.length) out.push(`Offices: ${s.offices.join(", ")}`);
  if (s.companies?.length) out.push(`Companies: ${s.companies.map(c => companyName?.(c) ?? c).join(", ")}`);
  return out.length ? out : ["Every piece we have in stock"];
}

function sections(f: DocsFor): Section[] {
  const k = f.key;
  const keyText = f.secret ?? "YOUR_API_KEY";
  const perMinute = k?.limits.perMinute ?? DEFAULT_PER_MINUTE, perDay = k?.limits.perDay ?? DEFAULT_PER_DAY;
  const out: Section[] = [];
  out.push({ h: "Getting started", blocks: [
    { p: `This API gives your website our Ready Stock — every piece in stock with all its details, photos, video and price — always up to date. It is read-only: GET requests that return JSON.` },
    { table: { head: ["", ""], rows: [
      ["Address", f.base],
      ["Your key", f.secret ? f.secret : k ? `${maskedKey(k)} (given to you separately)` : "Given to you separately"],
      ["Send it in", "the X-API-Key header (or Authorization: Bearer <key>) — not in the address: addresses end up in logs"],
      ["Format", "JSON, UTF-8 · prices in US dollars"],
    ] } },
    ...(f.secret ? [{ note: "Keep this key secret, like a password. It is shown only now — we do not keep a copy. If it is lost or leaks, ask us for a new one; the old one stops at once." } as Block] : []),
    { code: `curl -H "X-API-Key: ${keyText}" "${f.base}/products?limit=12"`, lang: "bash" },
  ] });
  if (k) {
    out.push({ h: "Your key", blocks: [
      { table: { head: ["", ""], rows: [
        ["Name", k.name],
        ["Shows", scopeText(k, f.companyName).join(" · ")],
        ["Prices", k.price.show ? (k.price.markupPct ? `Our price ${k.price.markupPct > 0 ? "+" : ""}${k.price.markupPct}%` : "Our price") : "Not shared (price is null)"],
        ["Limits", `${perMinute} calls a minute · ${perDay.toLocaleString("en-US")} a day`],
        ["3D CAD files", k.share3d ? "Shared (model3d)" : "Not shared (model3d is null)"],
        ["Websites", k.origins.length ? `Only ${k.origins.join(", ")} (in a browser) — and any server` : "Any website or server"],
      ] } },
    ] });
  }
  out.push({ h: "Endpoints", blocks: [
    { table: { head: ["Method", "Address", "What it gives"], rows: [
      ["GET", "/products", "Pieces in stock — search, filters, sort, pages"],
      ["GET", "/products/{id}", "One piece (a sold-out one too, with inStock false)"],
      ["GET", "/filters", "Every filter's values with how many pieces have each, and the price / weight / carat ranges — for your filter menu"],
      ["GET", "/ping", "Is the key working, and what is left of its limits"],
    ] } },
  ] });
  out.push({ h: "GET /products — search, filters, sort, pages", blocks: [
    { p: "Every parameter is optional. Lists take several values with commas (category=Ring,Pendant). Text matches without caring for capitals." },
    { table: { head: ["Parameter", "Type", "What it does"], rows: PARAMS.map(r => [...r]) } },
    { code: `GET ${f.base}/products?q=solitaire&category=Ring&metal=Yellow%20Gold&minPrice=500&maxPrice=3000&sort=price_asc&page=1&limit=24`, lang: "http" },
    { p: "The answer: data (the pieces), meta (page, limit, total, totalPages, hasMore, sort) and links (self, first, last, next, prev — the same filters, another page)." },
    { code: `{
  "data": [
    {
      "id": "rs_8k2m1q",
      "sku": "LR-534",
      "name": "Marquise Solitaire Ring",
      "category": "Ring",
      "metal": "Yellow Gold", "karat": "18K", "metalColor": "Yellow",
      "grossWeightG": 4.21, "netWeightG": 3.95,
      "diamondCt": 1.01, "diamondType": "Natural", "diamondShape": "Marquise", "diamondPieces": 1,
      "otherMetal": null,
      "size": "7", "designNumber": "LR-534", "rhodium": "No Rhodium", "stamping": "KT Stamping",
      "certified": true,
      "price": 1250, "currency": "USD",
      "quantity": 1, "inStock": true, "office": "US",
      "images": ["https://…/photo1.jpg", "https://…/photo2.jpg"],
      "image": "https://…/photo1.jpg",
      "video": { "url": "https://…/video.mov", "playable": "https://…/video.mov.web.mp4" },
      "model3d": null,
      "createdAt": "2026-10-21T09:12:00.000Z", "updatedAt": "2026-11-02T14:30:00.000Z"
    }
  ],
  "meta": { "page": 1, "limit": 24, "total": 86, "totalPages": 4, "hasMore": true, "sort": "newest", "currency": "USD" },
  "links": { "self": "…page=1", "first": "…page=1", "last": "…page=4", "next": "…page=2", "prev": null },
  "generatedAt": "2026-11-03T10:00:00.000Z"
}`, lang: "json" },
  ] });
  out.push({ h: "A product's fields", blocks: [
    { p: "Every field is always there; one we have nothing for is null. Costs and our own notes are never shared." },
    { table: { head: ["Field", "Type", "Meaning"], rows: FIELDS.map(r => [...r]) } },
  ] });
  out.push({ h: "GET /filters — for your filter menu", blocks: [
    { p: "Takes the same filters as /products. For each filter it lists the values with how many pieces have each — counted as if that filter were not chosen, so a menu can show every option — and the min/max of price, gross weight and carats." },
    { code: `{ "data": { "total": 86,
  "categories": [{ "value": "Ring", "count": 41 }, { "value": "Earrings", "count": 22 }],
  "metals": [...], "karats": [...], "colors": [...], "diamondTypes": [...], "shapes": [...], "offices": [...], "sizes": [...],
  "price": { "min": 320, "max": 18500 }, "grossWeightG": { "min": 1.2, "max": 38.4 }, "diamondCt": { "min": 0.05, "max": 6.2 } } }`, lang: "json" },
  ] });
  out.push({ h: "Examples", blocks: [
    { p: "JavaScript (a browser or Node.js 18+)" },
    { code: `const res = await fetch("${f.base}/products?category=Ring&limit=24", {
  headers: { "X-API-Key": "${keyText}" },
});
if (!res.ok) throw new Error((await res.json()).error.message);
const { data, meta } = await res.json();
// data: the pieces · meta.hasMore: more pages`, lang: "javascript" },
    { p: "PHP" },
    { code: `$ch = curl_init("${f.base}/products?limit=24");
curl_setopt($ch, CURLOPT_HTTPHEADER, ["X-API-Key: ${keyText}"]);
curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
$result = json_decode(curl_exec($ch), true);
foreach ($result["data"] as $piece) { echo $piece["name"] . " — $" . $piece["price"] . "\\n"; }`, lang: "php" },
    { p: "Python" },
    { code: `import requests
r = requests.get("${f.base}/products", params={"q": "solitaire", "limit": 24},
                 headers={"X-API-Key": "${keyText}"})
r.raise_for_status()
for piece in r.json()["data"]:
    print(piece["name"], piece["price"])`, lang: "python" },
    { p: "Every page, one after another" },
    { code: `let url = "${f.base}/products?limit=100", all = [];
while (url) {
  const r = await (await fetch(url, { headers: { "X-API-Key": "${keyText}" } })).json();
  all.push(...r.data);
  url = r.links.next; // null on the last page
}`, lang: "javascript" },
  ] });
  out.push({ h: "Limits and good practice", blocks: [
    { table: { head: ["", ""], rows: [
      ["Per minute", `${perMinute} calls — X-RateLimit-Limit, X-RateLimit-Remaining and X-RateLimit-Reset (seconds) come with every answer`],
      ["Per day", `${perDay.toLocaleString("en-US")} calls (X-RateLimit-Daily-Limit / -Remaining), starting again at 00:00 UTC`],
      ["Over a limit", "429, with Retry-After (seconds) — wait that long"],
      ["Called in a loop", `A key that keeps calling after a 429 is blocked for ${BLOCK_HOURS} hour; blocked ${BLOCKS_TO_PAUSE} times in a day, it is paused until we turn it back on`],
    ] } },
    { list: [
      "Changes on our side show within seconds — still, keep a copy for a minute or two rather than calling on every page view.",
      "Send If-None-Match with the ETag of your last answer: when nothing changed you get 304 Not Modified (no body), which is quick.",
      "To keep your own copy in step: once a day take everything (includeSoldOut=true), then every 10–15 minutes ask for updatedSince=<your last time>.",
      "Use fields= to take only what a page shows — a smaller, faster answer.",
      "Show photos straight from the image addresses; they are full size.",
      "Call from your server when you can. If your website calls from the browser, the key can be seen there — ask us to allow only your website's address on it.",
    ] },
  ] });
  out.push({ h: "Errors", blocks: [
    { p: "Every error is JSON: { \"error\": { \"status\", \"code\", \"message\", \"requestId\" } }. Quote the requestId when you ask us about one." },
    { table: { head: ["Status", "Code", "Means"], rows: ERRORS.map(r => [...r]) } },
  ] });
  return out;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** The docs as one web page, styled, nothing to load. */
export function docsHtml(f: DocsFor): string {
  const brand = brandName();
  const title = `${brand} — Ready Stock API${f.key ? ` · ${f.key.name}` : ""}`;
  const body = sections(f).map(s => `<section><h2>${esc(s.h)}</h2>${s.blocks.map(b => {
    if ("p" in b) return `<p>${esc(b.p)}</p>`;
    if ("note" in b) return `<p class="note">${esc(b.note)}</p>`;
    if ("code" in b) return `<pre><code>${esc(b.code)}</code></pre>`;
    if ("list" in b) return `<ul>${b.list.map(x => `<li>${esc(x)}</li>`).join("")}</ul>`;
    const t = b.table;
    const head = t.head.some(Boolean) ? `<thead><tr>${t.head.map(x => `<th>${esc(x)}</th>`).join("")}</tr></thead>` : "";
    return `<div class="t"><table>${head}<tbody>${t.rows.map(r => `<tr>${r.map((c, i) => `<td${i === 0 ? ' class="k"' : ""}>${esc(c)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
  }).join("")}</section>`).join("");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title><style>
:root{--ink:#0f172a;--muted:#64748b;--line:#e2e8f0;--soft:#f8fafc;--brand:#2f3f8f}
*{box-sizing:border-box}body{margin:0;background:#fff;color:var(--ink);font:15px/1.6 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
main{max-width:920px;margin:0 auto;padding:40px 20px 80px}header{border-bottom:1px solid var(--line);padding-bottom:20px;margin-bottom:8px}
.eyebrow{color:var(--brand);font-weight:600;font-size:13px;letter-spacing:.06em;text-transform:uppercase}h1{font-size:30px;margin:6px 0 4px}
.sub{color:var(--muted);margin:0}h2{font-size:20px;margin:36px 0 12px;padding-top:8px}p{margin:10px 0}
pre{background:#0f172a;color:#e2e8f0;border-radius:12px;padding:14px 16px;overflow:auto;font:13px/1.55 ui-monospace,SFMono-Regular,Consolas,monospace}
.t{overflow:auto;border:1px solid var(--line);border-radius:12px}table{border-collapse:collapse;width:100%;font-size:14px}
th,td{text-align:left;padding:9px 12px;border-bottom:1px solid var(--line);vertical-align:top}th{background:var(--soft);font-weight:600}
tr:last-child td{border-bottom:0}td.k{font-family:ui-monospace,Consolas,monospace;font-size:13px;white-space:nowrap}
.note{background:#fff7ed;border:1px solid #fed7aa;border-radius:12px;padding:10px 14px}ul{padding-left:20px}li{margin:6px 0}
footer{margin-top:48px;color:var(--muted);font-size:13px;border-top:1px solid var(--line);padding-top:16px}
@media print{pre{white-space:pre-wrap}main{padding:0}}
</style></head><body><main><header><div class="eyebrow">${esc(brand)}</div><h1>Ready Stock API</h1>
<p class="sub">${f.key ? `For ${esc(f.key.name)} · ` : ""}Version 1 · ${esc(new Date().toISOString().slice(0, 10))}</p></header>
${body}<footer>${esc(brand)} · Ready Stock API v1 · ${esc(f.base)}</footer></main></body></html>`;
}

/** The docs as a PDF. */
export async function docsPdf(f: DocsFor): Promise<Blob> {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight(), M = 48, CW = W - 2 * M;
  let y = M;
  const brand = brandName();
  const room = (h: number) => { if (y + h > H - M) { doc.addPage(); y = M; } };
  const text = (s: string, size = 10, style: "normal" | "bold" = "normal", color: [number, number, number] = [15, 23, 42], font = "helvetica") => {
    doc.setFont(font, style); doc.setFontSize(size); doc.setTextColor(...color);
    for (const line of doc.splitTextToSize(s, CW) as string[]) { room(size * 1.45); doc.text(line, M, y + size); y += size * 1.45; }
  };
  // jsPDF's own fonts have no "—", "…", "→", "≤" — written plainly.
  const plain = (s: string) => s.replace(/[—–]/g, "-").replace(/…/g, "...").replace(/→/g, "->").replace(/·/g, "|").replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/−/g, "-");
  text(brand.toUpperCase(), 9, "bold", [47, 63, 143]);
  text("Ready Stock API", 22, "bold");
  text(plain(`${f.key ? `For ${f.key.name} | ` : ""}Version 1 | ${new Date().toISOString().slice(0, 10)}`), 10, "normal", [100, 116, 139]);
  y += 8;
  for (const s of sections(f)) {
    room(40); y += 14; text(plain(s.h), 14, "bold"); y += 2;
    for (const b of s.blocks) {
      if ("p" in b) { text(plain(b.p)); y += 4; }
      else if ("note" in b) { text(plain(b.note), 10, "bold", [154, 52, 18]); y += 4; }
      else if ("list" in b) { for (const x of b.list) text(plain(`•  ${x}`)); y += 4; }
      else if ("code" in b) {
        doc.setFont("courier", "normal"); doc.setFontSize(8.5);
        const lines = b.code.split("\n").flatMap(l => doc.splitTextToSize(plain(l) || " ", CW - 20) as string[]);
        let i = 0;
        while (i < lines.length) {
          room(30);
          const fit = Math.max(1, Math.floor((H - M - y - 16) / 11.5));
          const part = lines.slice(i, i + fit);
          const h = part.length * 11.5 + 14;
          doc.setFillColor(241, 245, 249); doc.roundedRect(M, y, CW, h, 6, 6, "F");
          doc.setTextColor(15, 23, 42);
          part.forEach((l, j) => doc.text(l, M + 10, y + 16 + j * 11.5));
          y += h + 6; i += part.length;
        }
      } else {
        const t = b.table;
        const cols = t.rows[0]?.length ?? 2;
        const widths = cols === 2 ? [CW * 0.28, CW * 0.72] : [CW * 0.27, CW * 0.2, CW * 0.53];
        const row = (cells: string[], bold: boolean) => {
          doc.setFont("helvetica", bold ? "bold" : "normal"); doc.setFontSize(9);
          const wrapped = cells.map((c, i) => doc.splitTextToSize(plain(c), widths[i] - 10) as string[]);
          const h = Math.max(...wrapped.map(w => w.length)) * 12 + 8;
          room(h);
          if (bold) { doc.setFillColor(248, 250, 252); doc.rect(M, y, CW, h, "F"); }
          let x = M;
          wrapped.forEach((w, i) => { doc.setTextColor(15, 23, 42); w.forEach((l, j) => doc.text(l, x + 5, y + 14 + j * 12)); x += widths[i]; });
          doc.setDrawColor(226, 232, 240); doc.line(M, y + h, M + CW, y + h);
          y += h;
        };
        if (t.head.some(Boolean)) row(t.head, true);
        t.rows.forEach(r => row(r, false));
        y += 8;
      }
    }
  }
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i); doc.setFont("helvetica", "normal"); doc.setFontSize(8); doc.setTextColor(100, 116, 139);
    doc.text(plain(`${brand} | Ready Stock API v1 | ${f.base}`), M, H - 24);
    doc.text(`${i} / ${pages}`, W - M, H - 24, { align: "right" });
  }
  return doc.output("blob");
}

/** OpenAPI 3.0 — imports into Postman, Insomnia, Swagger and the rest. */
export function docsOpenApi(f: DocsFor): string {
  const str = { type: "string", nullable: true }, numb = { type: "number", nullable: true };
  const listParam = (name: string, d: string) => ({ name, in: "query", required: false, description: d, schema: { type: "string" } });
  const numParam = (name: string, d: string) => ({ name, in: "query", required: false, description: d, schema: { type: "number", minimum: 0 } });
  const boolParam = (name: string, d: string) => ({ name, in: "query", required: false, description: d, schema: { type: "boolean" } });
  const filters = [
    { name: "q", in: "query", description: "Search", schema: { type: "string" } },
    ...["category", "metal", "karat", "color", "diamondType", "shape", "office", "size"].map(n => listParam(n, "Comma-separated values")),
    ...["Price", "Gross", "Net", "Ct", "Qty"].flatMap(k => [numParam(`min${k}`, `Minimum ${k}`), numParam(`max${k}`, `Maximum ${k}`)]),
    listParam("sku", "Exact SKU"), listParam("designNumber", "Exact design number"), listParam("ids", "Comma-separated product ids (up to 200)"),
    boolParam("hasVideo", "With a video"), boolParam("hasImages", "With photos"), boolParam("hasModel3d", "With a 3D model"), boolParam("certified", "Certified"),
    boolParam("includeSoldOut", "Also pieces with none left"),
    { name: "updatedSince", in: "query", schema: { type: "string", format: "date-time" } },
    { name: "createdSince", in: "query", schema: { type: "string", format: "date-time" } },
  ];
  const errors = Object.fromEntries(["400", "401", "403", "404", "429"].map(s => [s, { description: ERRORS.find(e => e[0] === s)?.[2], content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } }]));
  const spec = {
    openapi: "3.0.3",
    info: { title: `${brandName()} — Ready Stock API`, version: "1.0.0", description: "Our Ready Stock pieces, with every detail, photos, video and price." },
    servers: [{ url: f.base }],
    security: [{ apiKey: [] }],
    components: {
      securitySchemes: { apiKey: { type: "apiKey", in: "header", name: "X-API-Key" } },
      schemas: {
        Product: { type: "object", properties: {
          id: { type: "string" }, sku: str, name: { type: "string" }, category: str, metal: str, karat: str, metalColor: str,
          grossWeightG: numb, netWeightG: numb, diamondCt: numb, diamondType: str, diamondShape: str, diamondPieces: { type: "integer", nullable: true },
          otherMetal: { type: "object", nullable: true, properties: { name: { type: "string" }, weightG: numb, purity: numb } },
          size: str, designNumber: str, rhodium: str, stamping: str, certified: { type: "boolean" },
          price: numb, currency: { type: "string", enum: ["USD"] }, quantity: { type: "integer" }, inStock: { type: "boolean" }, office: str,
          images: { type: "array", items: { type: "string", format: "uri" } }, image: { type: "string", format: "uri", nullable: true },
          video: { type: "object", nullable: true, properties: { url: { type: "string", format: "uri" }, playable: { type: "string", format: "uri", nullable: true } } },
          model3d: { type: "string", format: "uri", nullable: true }, createdAt: str, updatedAt: str,
        } },
        Error: { type: "object", properties: { error: { type: "object", properties: { status: { type: "integer" }, code: { type: "string" }, message: { type: "string" }, requestId: { type: "string" } } } } },
        Facet: { type: "array", items: { type: "object", properties: { value: { type: "string" }, count: { type: "integer" } } } },
      },
    },
    paths: {
      "/products": { get: {
        summary: "Pieces in stock", parameters: [...filters,
          { name: "sort", in: "query", schema: { type: "string", enum: ["newest", "oldest", "updated", "price_asc", "price_desc", "weight_asc", "weight_desc", "carat_asc", "carat_desc", "name_asc", "name_desc", "qty_desc"] } },
          { name: "page", in: "query", schema: { type: "integer", minimum: 1, default: 1 } },
          { name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 100, default: 24 } },
          { name: "fields", in: "query", description: "Comma-separated fields", schema: { type: "string" } }],
        responses: { 200: { description: "A page of pieces", content: { "application/json": { schema: { type: "object", properties: {
          data: { type: "array", items: { $ref: "#/components/schemas/Product" } },
          meta: { type: "object", properties: { page: { type: "integer" }, limit: { type: "integer" }, total: { type: "integer" }, totalPages: { type: "integer" }, hasMore: { type: "boolean" }, sort: { type: "string" }, currency: { type: "string" } } },
          links: { type: "object", properties: { self: { type: "string" }, first: { type: "string" }, last: { type: "string" }, next: { type: "string", nullable: true }, prev: { type: "string", nullable: true } } },
        } } } } }, 304: { description: "Not modified (If-None-Match)" }, ...errors },
      } },
      "/products/{id}": { get: { summary: "One piece", parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }, { name: "fields", in: "query", schema: { type: "string" } }],
        responses: { 200: { description: "The piece", content: { "application/json": { schema: { type: "object", properties: { data: { $ref: "#/components/schemas/Product" } } } } } }, ...errors } } },
      "/filters": { get: { summary: "Filter values with counts, and ranges", parameters: filters,
        responses: { 200: { description: "Facets", content: { "application/json": { schema: { type: "object", properties: { data: { type: "object", properties: {
          total: { type: "integer" }, categories: { $ref: "#/components/schemas/Facet" }, metals: { $ref: "#/components/schemas/Facet" }, karats: { $ref: "#/components/schemas/Facet" },
          colors: { $ref: "#/components/schemas/Facet" }, diamondTypes: { $ref: "#/components/schemas/Facet" }, shapes: { $ref: "#/components/schemas/Facet" },
          offices: { $ref: "#/components/schemas/Facet" }, sizes: { $ref: "#/components/schemas/Facet" },
        } } } } } } }, ...errors } } },
      "/ping": { get: { summary: "Check the key and its limits", responses: { 200: { description: "OK" }, ...errors } } },
    },
  };
  return JSON.stringify(spec, null, 2);
}

/** A file to the device. */
export function saveFile(name: string, data: Blob | string, type = "application/octet-stream"): void {
  const blob = typeof data === "string" ? new Blob([data], { type }) : data;
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

/** "Ready-Stock-API-Acme-Jewels". */
export const docsFileName = (k?: ApiKeyDoc) => `Ready-Stock-API${k ? `-${k.name.replace(/[^\w-]+/g, "_").slice(0, 40)}` : ""}`;
