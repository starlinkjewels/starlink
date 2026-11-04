// The Ready Stock API's own rules, apart from the database: what a product looks
// like to a client, what one key may see and at what price, and search, filters,
// sorting, pages, the filter counts and the fields asked for. Pure — tested on
// its own (scripts/test-logic.cjs).

/* ─────────────── What is read from the database ─────────────── */

/** A Ready Stock piece as stored (only the fields the API reads — never its cost, notes or history text). */
export interface StockDoc {
  id: string;
  name?: string;
  jewelleryType?: string;
  metal?: string;
  productKarats?: string;
  grossWeight?: number;
  netWeight?: number;
  diamondWeight?: number;
  diamondType?: string;
  price?: number;
  quantity?: number;
  images?: string[];
  video?: string;
  sku?: string;
  location?: string;
  companyId?: string;
  createdAt?: string;
  fromReturn?: { orderId?: string };
  /** The last line of its history — when it last changed. */
  updatedAt?: string;
}

/** The order a piece was built on (or sent back from): its design details only — never the client or the money. */
export interface OrderDesign {
  designNumber?: string;
  productSize?: string;
  productColor?: string;
  diamondShape?: string;
  actualDiamondPcs?: number;
  rhodium?: string;
  stamping?: string;
  otherMetal?: string;
  otherMetalWeight?: number;
  otherMetalPurity?: number;
  /** Every metal besides the gold, when more than one (the first is also otherMetal above). */
  otherMetals?: { metal: string; weight?: number; purity?: number }[];
  certificate?: boolean;
  cad3dmUrl?: string;
  productVideo?: string;
}

/** One key's choices (apiKeys/{id}). Empty lists = everything. */
export interface KeyRules {
  scope?: { types?: string[]; metals?: string[]; offices?: string[]; companies?: string[] };
  price?: { show?: boolean; markupPct?: number };
  /** Also give the design's 3D CAD file (our own design) — off unless the key says so. */
  share3d?: boolean;
}

/* ─────────────── A product, as a client sees it ─────────────── */

export interface Product {
  id: string;
  sku: string | null;
  name: string;
  category: string | null;
  metal: string | null;
  karat: string | null;
  metalColor: string | null;
  grossWeightG: number | null;
  netWeightG: number | null;
  diamondCt: number | null;
  diamondType: string | null;
  diamondShape: string | null;
  diamondPieces: number | null;
  otherMetal: { name: string; weightG: number | null; purity: number | null } | null;
  /** Every metal besides the gold (two or more on a gold + platinum + silver piece); the first is otherMetal. */
  otherMetals: { name: string; weightG: number | null; purity: number | null }[];
  size: string | null;
  designNumber: string | null;
  rhodium: string | null;
  stamping: string | null;
  certified: boolean;
  price: number | null;
  currency: "USD";
  quantity: number;
  inStock: boolean;
  office: string | null;
  images: string[];
  image: string | null;
  video: { url: string; playable: string | null } | null;
  model3d: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const num = (v: unknown): number | null => (typeof v === "number" && isFinite(v) && v > 0 ? Math.round(v * 1000) / 1000 : null);
const money = (n: number) => Math.round(n * 100) / 100;
const lc = (s: string | null | undefined) => (s ?? "").trim().toLowerCase();

/** "main" is stored as no company at all. */
export const companyOf = (d: { companyId?: string }) => (d.companyId && d.companyId !== "main" ? d.companyId : "main");

/** The price this key shows: ours with its markup (up or down), or none when it shares no price. */
export function keyPrice(price: number | undefined, rules: KeyRules): number | null {
  if (rules.price?.show === false) return null;
  if (!(typeof price === "number" && price > 0)) return null;
  const pct = Number(rules.price?.markupPct) || 0;
  return money(price * (1 + pct / 100));
}

/**
 * One piece as a client sees it — every detail recorded on it, and from the
 * order it was built on (or came back from) its design details. Never its
 * cost, notes, history, who made it, the order's number or its client.
 */
export function toProduct(d: StockDoc, design: OrderDesign | undefined, rules: KeyRules, playable: (url: string) => string | null): Product {
  const o = design ?? {};
  const images = (d.images ?? []).filter(u => typeof u === "string" && /^https:\/\//.test(u));
  const videoUrl = str(d.video) ?? str(o.productVideo);
  const qty = Math.max(0, Math.round(Number(d.quantity) || 0));
  return {
    id: d.id,
    sku: str(d.sku) ?? str(o.designNumber),
    name: str(d.name) ?? "Jewellery",
    category: str(d.jewelleryType),
    metal: str(d.metal),
    karat: str(d.productKarats),
    metalColor: str(o.productColor),
    grossWeightG: num(d.grossWeight),
    netWeightG: num(d.netWeight),
    diamondCt: num(d.diamondWeight),
    diamondType: num(d.diamondWeight) ? str(d.diamondType) : null,
    diamondShape: num(d.diamondWeight) ? str(o.diamondShape) : null,
    diamondPieces: num(d.diamondWeight) && typeof o.actualDiamondPcs === "number" && o.actualDiamondPcs > 0 ? Math.round(o.actualDiamondPcs) : null,
    otherMetal: str(o.otherMetal) ? { name: str(o.otherMetal)!, weightG: num(o.otherMetalWeight), purity: num(o.otherMetalPurity) } : null,
    otherMetals: (Array.isArray(o.otherMetals) && o.otherMetals.length ? o.otherMetals.map(m => ({ name: str(m?.metal) ?? "", weightG: num(m?.weight), purity: num(m?.purity) }))
      : str(o.otherMetal) ? [{ name: str(o.otherMetal)!, weightG: num(o.otherMetalWeight), purity: num(o.otherMetalPurity) }] : []).filter(m => m.name),
    size: str(o.productSize),
    designNumber: str(o.designNumber),
    rhodium: str(o.rhodium),
    stamping: str(o.stamping),
    certified: o.certificate === true,
    price: keyPrice(d.price, rules),
    currency: "USD",
    quantity: qty,
    inStock: qty > 0,
    office: str(d.location),
    images,
    image: images[0] ?? null,
    video: videoUrl && /^https:\/\//.test(videoUrl) ? { url: videoUrl, playable: playable(videoUrl) } : null,
    model3d: rules.share3d === true && str(o.cad3dmUrl) && /^https:\/\//.test(o.cad3dmUrl!) ? o.cad3dmUrl! : null,
    createdAt: str(d.createdAt),
    updatedAt: str(d.updatedAt) ?? str(d.createdAt),
  };
}

/** Whether a key may see this piece at all (its categories, metals, offices, companies). */
export function inScope(d: StockDoc, rules: KeyRules): boolean {
  const s = rules.scope ?? {};
  const has = (list: string[] | undefined, v: string) => !list?.length || list.some(x => lc(x) === lc(v));
  return has(s.types, d.jewelleryType ?? "") && has(s.metals, d.metal ?? "") && has(s.offices, d.location ?? "") && has(s.companies, companyOf(d));
}

/* ─────────────── Search, filters, sorting, pages ─────────────── */

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}

/** Filters that take a list ("Ring,Pendant") — each matched without caring for case. */
const LIST_FILTERS = {
  category: (p: Product) => p.category,
  metal: (p: Product) => p.metal,
  karat: (p: Product) => p.karat,
  color: (p: Product) => p.metalColor,
  diamondType: (p: Product) => p.diamondType,
  shape: (p: Product) => p.diamondShape,
  office: (p: Product) => p.office,
  size: (p: Product) => p.size,
} as const;
type ListFilter = keyof typeof LIST_FILTERS;

/** Filters that take a range (min… / max…). */
const RANGES = {
  Price: (p: Product) => p.price,
  Gross: (p: Product) => p.grossWeightG,
  Net: (p: Product) => p.netWeightG,
  Ct: (p: Product) => p.diamondCt,
  Qty: (p: Product) => p.quantity,
} as const;
type RangeKey = keyof typeof RANGES;

/** Numbers low → high or high → low; a piece without the figure always last. */
const byNum = (get: (p: Product) => number | null, dir: 1 | -1) => (a: Product, b: Product) => {
  const x = get(a), y = get(b);
  if (x === null || y === null) return x === y ? 0 : x === null ? 1 : -1;
  return (x - y) * dir;
};

export const SORTS: Record<string, (a: Product, b: Product) => number> = {
  newest: (a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""),
  oldest: (a, b) => (a.createdAt ?? "").localeCompare(b.createdAt ?? ""),
  updated: (a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""),
  price_asc: byNum(p => p.price, 1),
  price_desc: byNum(p => p.price, -1),
  weight_asc: byNum(p => p.grossWeightG, 1),
  weight_desc: byNum(p => p.grossWeightG, -1),
  carat_asc: byNum(p => p.diamondCt, 1),
  carat_desc: byNum(p => p.diamondCt, -1),
  name_asc: (a, b) => a.name.localeCompare(b.name),
  name_desc: (a, b) => b.name.localeCompare(a.name),
  qty_desc: (a, b) => b.quantity - a.quantity,
};

export const MAX_LIMIT = 100;
export const DEFAULT_LIMIT = 24;

/** Every parameter the list understands (anything else is named back as ignored). */
export const KNOWN_PARAMS = new Set([
  "q", "search", ...Object.keys(LIST_FILTERS), ...Object.keys(RANGES).flatMap(k => [`min${k}`, `max${k}`]),
  "sku", "designNumber", "ids", "hasVideo", "hasImages", "hasModel3d", "certified", "includeSoldOut",
  "updatedSince", "createdSince", "sort", "page", "limit", "fields", "api_key", "key",
]);

export interface Query {
  q: string[];
  lists: Partial<Record<ListFilter, string[]>>;
  ranges: Partial<Record<RangeKey, { min?: number; max?: number }>>;
  sku?: string;
  designNumber?: string;
  ids?: string[];
  hasVideo?: boolean;
  hasImages?: boolean;
  hasModel3d?: boolean;
  certified?: boolean;
  includeSoldOut: boolean;
  updatedSince?: string;
  createdSince?: string;
  sort: string;
  page: number;
  limit: number;
  fields?: string[];
  ignored: string[];
}

const splitList = (v: string) => v.split(",").map(s => s.trim()).filter(Boolean);

function bool(name: string, v: string | undefined): boolean | undefined {
  if (v === undefined || v === "") return undefined;
  if (/^(1|true|yes)$/i.test(v)) return true;
  if (/^(0|false|no)$/i.test(v)) return false;
  throw new ApiError(400, "bad_parameter", `${name} must be true or false`);
}
function number(name: string, v: string | undefined): number | undefined {
  if (v === undefined || v === "") return undefined;
  const n = Number(v);
  if (!isFinite(n) || n < 0) throw new ApiError(400, "bad_parameter", `${name} must be a number of 0 or more`);
  return n;
}
function date(name: string, v: string | undefined): string | undefined {
  if (v === undefined || v === "") return undefined;
  const t = Date.parse(v);
  if (isNaN(t)) throw new ApiError(400, "bad_parameter", `${name} must be a date, e.g. 2026-11-03 or 2026-11-03T10:00:00Z`);
  return new Date(t).toISOString();
}

export const PRODUCT_FIELDS: (keyof Product)[] = [
  "id", "sku", "name", "category", "metal", "karat", "metalColor", "grossWeightG", "netWeightG", "diamondCt", "diamondType",
  "diamondShape", "diamondPieces", "otherMetal", "otherMetals", "size", "designNumber", "rhodium", "stamping", "certified", "price", "currency",
  "quantity", "inStock", "office", "images", "image", "video", "model3d", "createdAt", "updatedAt",
];

/** The list's parameters, checked — a wrong one is refused with what is wrong with it. */
export function parseQuery(params: Record<string, string | undefined>, priceShown: boolean): Query {
  const g = (k: string) => { const v = params[k]; return v === undefined ? undefined : String(v).slice(0, 500); };
  const qText = (g("q") ?? g("search") ?? "").toLowerCase();
  const lists: Query["lists"] = {};
  for (const k of Object.keys(LIST_FILTERS) as ListFilter[]) { const v = g(k); if (v) lists[k] = splitList(v).map(s => s.toLowerCase()); }
  const ranges: Query["ranges"] = {};
  for (const k of Object.keys(RANGES) as RangeKey[]) {
    const min = number(`min${k}`, g(`min${k}`)), max = number(`max${k}`, g(`max${k}`));
    if (min !== undefined || max !== undefined) {
      if (min !== undefined && max !== undefined && min > max) throw new ApiError(400, "bad_parameter", `min${k} is more than max${k}`);
      ranges[k] = { min, max };
    }
  }
  if (!priceShown && ranges.Price) throw new ApiError(400, "price_not_shared", "This key does not share prices, so it can't filter by price");
  const sort = g("sort") || "newest";
  if (!SORTS[sort]) throw new ApiError(400, "bad_parameter", `sort must be one of: ${Object.keys(SORTS).join(", ")}`);
  if (!priceShown && sort.startsWith("price")) throw new ApiError(400, "price_not_shared", "This key does not share prices, so it can't sort by price");
  const page = number("page", g("page")) ?? 1;
  const limit = number("limit", g("limit")) ?? DEFAULT_LIMIT;
  if (!Number.isInteger(page) || page < 1) throw new ApiError(400, "bad_parameter", "page must be 1 or more");
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) throw new ApiError(400, "bad_parameter", `limit must be from 1 to ${MAX_LIMIT}`);
  let fields: string[] | undefined;
  const f = g("fields");
  if (f) {
    fields = splitList(f);
    const bad = fields.filter(x => !PRODUCT_FIELDS.includes(x as keyof Product));
    if (bad.length) throw new ApiError(400, "bad_parameter", `Unknown field${bad.length > 1 ? "s" : ""}: ${bad.join(", ")}. Fields: ${PRODUCT_FIELDS.join(", ")}`);
  }
  const ids = g("ids") ? splitList(g("ids")!).slice(0, 200) : undefined;
  return {
    q: words(qText).slice(0, 10),
    lists, ranges,
    sku: g("sku")?.trim().toLowerCase() || undefined,
    designNumber: g("designNumber")?.trim().toLowerCase() || undefined,
    ids,
    hasVideo: bool("hasVideo", g("hasVideo")),
    hasImages: bool("hasImages", g("hasImages")),
    hasModel3d: bool("hasModel3d", g("hasModel3d")),
    certified: bool("certified", g("certified")),
    includeSoldOut: bool("includeSoldOut", g("includeSoldOut")) ?? false,
    updatedSince: date("updatedSince", g("updatedSince")),
    createdSince: date("createdSince", g("createdSince")),
    sort, page, limit, fields,
    ignored: Object.keys(params).filter(k => !KNOWN_PARAMS.has(k)),
  };
}

/** Words, as search reads them: letters and digits ("LR-534" = "lr", "534"). */
const words = (s: string) => s.toLowerCase().split(/[^\p{L}\p{N}.]+/u).filter(Boolean);
/** The words a piece is found by. */
const haystack = (p: Product) => words([p.name, p.sku, p.designNumber, p.category, p.metal, p.karat, p.metalColor, p.diamondType, p.diamondShape, p.office, p.size, ...p.otherMetals.map(m => m.name)]
  .filter(Boolean).join(" "));

/** Does a piece pass the query — leaving out one list filter (for that filter's own counts). */
function passes(p: Product, q: Query, skip?: ListFilter): boolean {
  if (!q.includeSoldOut && !p.inStock) return false;
  if (q.ids && !q.ids.includes(p.id)) return false;
  // Every word asked for starts one of the piece's words ("ring" finds Rings, not Earrings).
  if (q.q.length) { const h = haystack(p); if (!q.q.every(w => h.some(x => x.startsWith(w)))) return false; }
  for (const k of Object.keys(q.lists) as ListFilter[]) {
    if (k === skip) continue;
    if (!q.lists[k]!.includes(lc(LIST_FILTERS[k](p)))) return false;
  }
  for (const k of Object.keys(q.ranges) as RangeKey[]) {
    const v = RANGES[k](p), r = q.ranges[k]!;
    if (v === null) return false;
    if (r.min !== undefined && v < r.min) return false;
    if (r.max !== undefined && v > r.max) return false;
  }
  if (q.sku && lc(p.sku) !== q.sku) return false;
  if (q.designNumber && lc(p.designNumber) !== q.designNumber) return false;
  if (q.hasVideo !== undefined && !!p.video !== q.hasVideo) return false;
  if (q.hasImages !== undefined && (p.images.length > 0) !== q.hasImages) return false;
  if (q.hasModel3d !== undefined && !!p.model3d !== q.hasModel3d) return false;
  if (q.certified !== undefined && p.certified !== q.certified) return false;
  if (q.updatedSince && (p.updatedAt ?? "") < q.updatedSince) return false;
  if (q.createdSince && (p.createdAt ?? "") < q.createdSince) return false;
  return true;
}

/** Only the fields asked for (id always). */
export function pick(p: Product, fields?: string[]): Partial<Product> {
  if (!fields?.length) return p;
  const out: Record<string, unknown> = { id: p.id };
  for (const f of fields) out[f] = (p as unknown as Record<string, unknown>)[f];
  return out as Partial<Product>;
}

export interface ListResult {
  data: Partial<Product>[];
  meta: { page: number; limit: number; total: number; totalPages: number; hasMore: boolean; sort: string; currency: "USD"; ignoredParameters?: string[] };
}

export function listProducts(all: Product[], q: Query): ListResult {
  const rows = all.filter(p => passes(p, q)).sort((a, b) => SORTS[q.sort](a, b) || a.id.localeCompare(b.id));
  const total = rows.length, totalPages = Math.max(1, Math.ceil(total / q.limit));
  const slice = rows.slice((q.page - 1) * q.limit, q.page * q.limit);
  return {
    data: slice.map(p => pick(p, q.fields)),
    meta: { page: q.page, limit: q.limit, total, totalPages, hasMore: q.page < totalPages, sort: q.sort, currency: "USD",
      ...(q.ignored.length ? { ignoredParameters: q.ignored } : {}) },
  };
}

export interface Facets {
  total: number;
  categories: { value: string; count: number }[];
  metals: { value: string; count: number }[];
  karats: { value: string; count: number }[];
  colors: { value: string; count: number }[];
  diamondTypes: { value: string; count: number }[];
  shapes: { value: string; count: number }[];
  offices: { value: string; count: number }[];
  sizes: { value: string; count: number }[];
  price: { min: number; max: number } | null;
  grossWeightG: { min: number; max: number } | null;
  diamondCt: { min: number; max: number } | null;
}

/**
 * What a website's filter menu needs: every value with how many pieces have
 * it, given the other filters chosen (a filter's own choices don't narrow its
 * own list), and the ranges.
 */
export function facets(all: Product[], q: Query): Facets {
  const count = (k: ListFilter) => {
    const m = new Map<string, { value: string; count: number }>();
    for (const p of all) {
      const v = LIST_FILTERS[k](p);
      if (!v || !passes(p, q, k)) continue;
      const key = v.toLowerCase();
      const e = m.get(key) ?? { value: v, count: 0 };
      e.count += 1; m.set(key, e);
    }
    return [...m.values()].sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
  };
  const rows = all.filter(p => passes(p, q));
  const range = (get: (p: Product) => number | null) => {
    const v = rows.map(get).filter((x): x is number => x !== null);
    return v.length ? { min: Math.min(...v), max: Math.max(...v) } : null;
  };
  return {
    total: rows.length,
    categories: count("category"), metals: count("metal"), karats: count("karat"), colors: count("color"),
    diamondTypes: count("diamondType"), shapes: count("shape"), offices: count("office"), sizes: count("size"),
    price: range(p => p.price), grossWeightG: range(p => p.grossWeightG), diamondCt: range(p => p.diamondCt),
  };
}

/* ─────────────── Who is calling ─────────────── */

/**
 * The caller's address. Google's front end ADDS the address it was reached
 * from to the end of X-Forwarded-For, after whatever the caller sent — so the
 * last entry is the one that can't be made up. Through our own address (Vercel
 * or Firebase Hosting, `viaProxy`), that last one is the proxy, and the one
 * before it is the client as the proxy saw it.
 */
export function clientIp(xff: string | string[] | undefined, viaProxy: boolean, fallback?: string): string {
  const list = (Array.isArray(xff) ? xff.join(",") : xff ?? "").split(",").map(x => x.trim()).filter(Boolean);
  const pickd = viaProxy && list.length >= 2 ? list[list.length - 2] : list[list.length - 1];
  const ip = (pickd || fallback || "").replace(/^::ffff:/, "");
  return /^[0-9a-f.:]{2,45}$/i.test(ip) ? ip : "";
}

/** "shop.example.com" from an Origin or Referer — "" when none. */
export function hostOf(url: string | undefined): string {
  if (!url) return "";
  try { return new URL(url).host.toLowerCase().replace(/^www\./, ""); } catch { return ""; }
}

/** Is this website one the key allows? Entries: "example.com", "*.example.com", "https://shop.example.com". */
export function originAllowed(host: string, allowed: string[] | undefined): boolean {
  if (!allowed?.length || !host) return true;
  return allowed.some(raw => {
    const a = raw.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/^www\./, "");
    if (!a) return false;
    if (a.startsWith("*.")) { const base = a.slice(2); return host === base || host.endsWith(`.${base}`); }
    return host === a;
  });
}

export interface Device { kind: "Server" | "Bot" | "Mobile" | "Tablet" | "Desktop" | "Unknown"; label: string }

const SERVER_LIBS: [RegExp, string][] = [
  [/curl\//i, "curl"], [/wget\//i, "Wget"], [/postman/i, "Postman"], [/insomnia/i, "Insomnia"],
  [/python-requests|python-urllib|aiohttp|httpx/i, "Python"], [/axios/i, "Node.js (axios)"], [/node-fetch|undici|node\.js|^node\//i, "Node.js"],
  [/okhttp/i, "OkHttp (Android/Java)"], [/apache-httpclient|java\//i, "Java"], [/go-http-client/i, "Go"],
  [/guzzle|php/i, "PHP"], [/wordpress/i, "WordPress"], [/ruby/i, "Ruby"], [/dart/i, "Dart/Flutter"], [/\.net|httpclient/i, ".NET"],
  [/vercel|next\.js/i, "Vercel / Next.js"], [/shopify/i, "Shopify"], [/zapier/i, "Zapier"],
];

/** What called — a server program, a bot, or a browser on a phone, tablet or computer. */
export function deviceOf(ua: string | undefined): Device {
  const u = (ua ?? "").slice(0, 400);
  if (!u.trim()) return { kind: "Unknown", label: "Unknown" };
  if (/bot|crawler|spider|slurp|facebookexternalhit|whatsapp|preview|monitor/i.test(u)) {
    const m = u.match(/([A-Za-z]*bot|crawler|spider)/i);
    return { kind: "Bot", label: `Bot · ${m?.[1] ?? "crawler"}` };
  }
  for (const [re, name] of SERVER_LIBS) if (re.test(u) && !/mozilla\//i.test(u)) return { kind: "Server", label: `Server · ${name}` };
  if (!/mozilla\//i.test(u)) return { kind: "Server", label: `Server · ${u.split(/[\s/]/)[0].slice(0, 30) || "program"}` };
  const os = /windows/i.test(u) ? "Windows" : /iphone|ipad|ipod/i.test(u) ? "iOS" : /android/i.test(u) ? "Android"
    : /cros/i.test(u) ? "ChromeOS" : /mac os x|macintosh/i.test(u) ? "macOS" : /linux/i.test(u) ? "Linux" : "Other";
  const browser = /edg\//i.test(u) ? "Edge" : /opr\/|opera/i.test(u) ? "Opera" : /samsungbrowser/i.test(u) ? "Samsung Internet"
    : /firefox|fxios/i.test(u) ? "Firefox" : /chrome|crios/i.test(u) ? "Chrome" : /safari/i.test(u) ? "Safari" : "Browser";
  const kind: Device["kind"] = /ipad|tablet/i.test(u) || (/android/i.test(u) && !/mobile/i.test(u)) ? "Tablet"
    : /mobi|iphone|ipod/i.test(u) ? "Mobile" : "Desktop";
  return { kind, label: `${kind} · ${browser} · ${os}` };
}

/** A map key Firestore keeps as it is: no dots (a field path), never empty, not too long. */
export function mapKey(s: string): string {
  const v = (s || "(none)").replace(/\./g, String.fromCharCode(0xb7)).replace(/[`*[\]~/]/g, "_").slice(0, 120);
  return /^__.*__$/.test(v) ? `_${v}_` : v;
}

/** The UTC day and hour a time falls in: "2026-11-03", "2026-11-03T12". */
export function dayOf(t: number): string { return new Date(t).toISOString().slice(0, 10); }
export function hourOf(t: number): string { return new Date(t).toISOString().slice(0, 13); }
