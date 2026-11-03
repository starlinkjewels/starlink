// The Ready Stock API — what a B2B client's website reads our pieces from.
//
//   GET /v1/products         every piece the key may see: search, filters, sorting, pages, fields
//   GET /v1/products/{id}    one piece (a sold-out one too, so a website can mark it sold)
//   GET /v1/filters          each filter's values with their counts, and the ranges — for a website's filter menu
//   GET /v1/ping             is the key working, and what is left of its limits
//   GET /v1                  what the API offers (no key)
//
// The key comes in X-API-Key (or "Authorization: Bearer …", or ?api_key=).
// Served at <app>/api/v1/… (Starlink: Vercel's rewrite; SS Diam: Firebase
// Hosting's), or straight at the function's own address.
import { onRequest } from "firebase-functions/v2/https";
import type { Request } from "firebase-functions/v2/https";
import type { Response } from "express";
import { createHash } from "crypto";
import { REGION } from "./region";
import { getStock, keyByHash, perDayOf, perMinuteOf, playableOf, type ApiKey } from "./store";
import {
  ApiError, clientIp, deviceOf, facets, hostOf, inScope, listProducts, originAllowed, parseQuery, pick, toProduct,
  type Product,
} from "./logic";
import { badLocked, blockKey, flushIfDue, noteBadKey, record, recordLater, requestId, sha256, takeQuota, type Call, type Caller } from "./guard";

/* ─────────────── Where the caller is ─────────────── */

// Worked out on our own server from the caller's address (GeoLite2 data in
// geoip-lite) — no address is sent anywhere. Loaded on the first call.
type Geo = { lookup(ip: string): { country?: string; city?: string; region?: string } | null };
let geo: Geo | null | undefined;
function placeOf(ip: string): { country: string; city: string } {
  if (geo === undefined) {
    try { geo = require("geoip-lite") as Geo; } catch (e) { console.warn("[api] no location data:", (e as Error).message); geo = null; }
  }
  const g = ip && geo ? geo.lookup(ip) : null;
  return { country: g?.country || "", city: g?.city || "" };
}

/* ─────────────── Answers ─────────────── */

const ROUTES = [
  { method: "GET", path: "/v1/products", about: "Pieces in stock — search (q), filters, sort, page, limit, fields" },
  { method: "GET", path: "/v1/products/{id}", about: "One piece" },
  { method: "GET", path: "/v1/filters", about: "Every filter's values with counts, and the price / weight / carat ranges" },
  { method: "GET", path: "/v1/ping", about: "Check your key and what is left of its limits" },
];

function cors(req: Request, res: Response): void {
  const origin = req.get("origin");
  res.set("Access-Control-Allow-Origin", origin || "*");
  res.set("Vary", "Origin, X-API-Key, Authorization");
  res.set("Access-Control-Allow-Headers", "X-API-Key, Authorization, Content-Type, If-None-Match");
  res.set("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
  res.set("Access-Control-Expose-Headers", "ETag, X-Request-Id, X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset, X-RateLimit-Daily-Limit, X-RateLimit-Daily-Remaining, Retry-After");
  res.set("Access-Control-Max-Age", "86400");
}

function send(req: Request, res: Response, status: number, body: unknown, etag?: string): void {
  res.status(status);
  res.set("Content-Type", "application/json; charset=utf-8");
  // Never kept by a shared cache: what a key sees is that key's own. An error never kept at all.
  res.set("Cache-Control", status === 200 ? "private, max-age=60" : "no-store");
  if (etag) res.set("ETag", etag);
  if (req.method === "HEAD") { res.end(); return; }
  res.send(JSON.stringify(body));
}

function fail(req: Request, res: Response, err: ApiError, rid: string): void {
  send(req, res, err.status, { error: { status: err.status, code: err.code, message: err.message, requestId: rid } });
}

/** The key the caller sent. */
function keyOf(req: Request): string {
  const h = req.get("x-api-key");
  if (h) return h.trim();
  const auth = req.get("authorization") ?? "";
  const m = auth.match(/^Bearer\s+(.+)$/i);
  if (m) return m[1].trim();
  const q = req.query.api_key ?? req.query.key;
  return typeof q === "string" ? q.trim() : "";
}

/** The route, without whatever the app's address puts in front ("/api", the function's name). */
function routeOf(path: string): string[] {
  const parts = path.split("/").filter(Boolean);
  const v = parts.indexOf("v1");
  return v >= 0 ? parts.slice(v) : parts.length ? ["?", ...parts] : [];
}

const flatParams = (q: Request["query"]) =>
  Object.fromEntries(Object.entries(q).map(([k, v]) => [k, Array.isArray(v) ? String(v[0] ?? "") : typeof v === "string" ? v : undefined]));

/**
 * A page's own address with a different page number — as the client called it:
 * the app's address (<app>/api/v1/…, through Vercel or Firebase Hosting), or
 * the function's own (…cloudfunctions.net/stockApi/v1/…).
 */
function pageLink(req: Request, route: string[], page: number): string {
  const fwd = req.get("x-forwarded-host")?.split(",")[0].trim();
  const host = req.get("host") ?? "";
  const base = fwd && !/cloudfunctions\.net|run\.app/.test(fwd) ? `https://${fwd}/api`
    : /cloudfunctions\.net$/.test(host) ? `https://${host}/stockApi`
    : `${req.protocol}://${host}${(req.originalUrl || req.url).split("?")[0].replace(/\/v1(\/.*)?$/, "")}`;
  const u = new URL(`${base}/${route.join("/")}`);
  for (const [k, v] of Object.entries(flatParams(req.query))) if (v !== undefined && k !== "api_key" && k !== "key") u.searchParams.set(k, v);
  u.searchParams.set("page", String(page));
  return u.toString();
}

/* ─────────────── The API ─────────────── */

export const stockApi = onRequest(
  {
    region: REGION,
    // The location data (country + city) takes ~150 MB; one instance serves many calls at once.
    memory: "512MiB",
    cpu: 1,
    concurrency: 80,
    // A hard ceiling on cost, whatever is thrown at it.
    maxInstances: 4,
    timeoutSeconds: 30,
    invoker: "public",
  },
  async (req, res) => {
    const started = Date.now();
    const rid = requestId();
    res.set("X-Request-Id", rid);
    cors(req, res);
    if (req.method === "OPTIONS") { res.status(204).end(); return; }
    if (req.method !== "GET" && req.method !== "HEAD") { fail(req, res, new ApiError(405, "method_not_allowed", "Only GET is offered"), rid); return; }

    const route = routeOf(req.path);
    // What the API offers — no key, nothing read, nothing written.
    if (route.length <= 1 && route[0] !== "?") {
      send(req, res, 200, { name: "Ready Stock API", version: "1", auth: "Send your key in the X-API-Key header", endpoints: ROUTES });
      return;
    }
    if (route[0] === "v1" && route[1] === "health" && route.length === 2) {
      send(req, res, 200, { ok: true, time: new Date().toISOString() });
      return;
    }

    // Through the app's own address (Vercel, Firebase Hosting) or straight at the function's.
    const fwdHost = req.get("x-forwarded-host")?.split(",")[0].trim() ?? "";
    const viaProxy = !!fwdHost && !/cloudfunctions\.net|run\.app/.test(fwdHost);
    const ip = clientIp(req.get("x-forwarded-for"), viaProxy, req.ip);
    const origin = hostOf(req.get("origin") || req.get("referer"));
    const ua = req.get("user-agent") ?? "";
    const where = placeOf(ip);
    const who: Caller = { ip, country: where.country, city: where.city, origin, device: deviceOf(ua) };
    const path = route[1] === "products" ? (route[2] ? "product" : "products") : route[1] ?? "?";
    // What was asked, as read — never the key, however it was written.
    const query = new URLSearchParams(Object.entries(flatParams(req.query))
      .filter((e): e is [string, string] => e[1] !== undefined && e[0] !== "api_key" && e[0] !== "key")).toString().slice(0, 300);
    const call = (keyId: string, status: number, extra: Partial<Call> = {}): Call => ({
      keyId, path, query, status, ms: Date.now() - started, who, ua, referer: req.get("referer") ?? "", requestId: rid, ...extra,
    });

    // 1 · The key
    const lockedUntil = badLocked(ip);
    if (lockedUntil) {
      res.set("Retry-After", String(Math.ceil((lockedUntil - Date.now()) / 1000)));
      recordLater(call("_invalid", 429));
      await flushIfDue();
      fail(req, res, new ApiError(429, "too_many_wrong_keys", "Too many wrong keys from this address — try again later"), rid);
      return;
    }
    const secret = keyOf(req);
    if (!secret || secret.length < 20 || secret.length > 200) {
      noteBadKey(ip);
      recordLater(call("_invalid", 401, { code: secret ? "invalid_key" : "missing_key" }));
      await flushIfDue();
      fail(req, res, new ApiError(401, secret ? "invalid_key" : "missing_key", secret ? "This API key is not valid" : "Send your API key in the X-API-Key header"), rid);
      return;
    }
    const hash = sha256(secret);
    let key: ApiKey | undefined;
    try { key = await keyByHash(hash); } catch (e) {
      console.error("[api] keys not read:", e);
      fail(req, res, new ApiError(503, "unavailable", "The API is busy — try again in a moment"), rid);
      return;
    }
    if (!key || key.deletedAt) {
      noteBadKey(ip);
      recordLater(call("_invalid", 401, { code: key ? "revoked_key" : "invalid_key" }));
      await flushIfDue();
      fail(req, res, new ApiError(401, key ? "revoked_key" : "invalid_key", key ? "This API key was deleted" : "This API key is not valid"), rid);
      return;
    }
    if (key.status === "paused") {
      recordLater(call(key.id, 403, { code: "key_paused" }));
      await flushIfDue();
      fail(req, res, new ApiError(403, "key_paused", key.pausedBy === "system"
        ? "This API key was paused after being called in a loop — ask us to turn it back on"
        : "This API key is paused — ask us to turn it back on"), rid);
      return;
    }
    const blocked = key.blockedUntil ? Date.parse(key.blockedUntil) : 0;
    if (blocked > Date.now()) {
      res.set("Retry-After", String(Math.ceil((blocked - Date.now()) / 1000)));
      recordLater(call(key.id, 429, { code: "key_blocked" }));
      await flushIfDue();
      fail(req, res, new ApiError(429, "key_blocked", `This API key was called too fast, in a loop, and is blocked until ${new Date(blocked).toISOString()}`), rid);
      return;
    }

    // 2 · Only from the websites it allows (when it names any) — before its limits,
    // so another website using a copied key can't use them up or get it blocked.
    if (!originAllowed(origin, key.origins)) {
      recordLater(call(key.id, 403, { code: "website_not_allowed", keyName: key.name }));
      await flushIfDue();
      fail(req, res, new ApiError(403, "website_not_allowed", `This API key may not be used from ${origin}`), rid);
      return;
    }

    // 3 · Its limits
    let quota;
    try { quota = await takeQuota(key, who); } catch (e) {
      console.error("[api] quota:", e);
      fail(req, res, new ApiError(503, "unavailable", "The API is busy — try again in a moment"), rid);
      return;
    }
    res.set("X-RateLimit-Limit", String(perMinuteOf(key)));
    res.set("X-RateLimit-Remaining", String(Math.max(0, quota.minuteLeft)));
    res.set("X-RateLimit-Reset", String(quota.resetIn));
    res.set("X-RateLimit-Daily-Limit", String(perDayOf(key)));
    res.set("X-RateLimit-Daily-Remaining", String(Math.max(0, quota.dayLeft)));
    if (!quota.ok) {
      if (quota.block) await blockKey(key, who).catch(e => console.error("[api] block:", e));
      const day = quota.reason === "day";
      const secs = day ? Math.ceil((Date.parse(new Date().toISOString().slice(0, 10)) + 86_400_000 - Date.now()) / 1000) : quota.resetIn;
      res.set("Retry-After", String(secs));
      recordLater(call(key.id, 429, { code: day ? "daily_limit" : "rate_limited", keyName: key.name }));
      await flushIfDue();
      fail(req, res, new ApiError(429, day ? "daily_limit" : "rate_limited", day
        ? `This key's ${perDayOf(key).toLocaleString("en-US")} calls for today are used — it starts again at 00:00 UTC`
        : `Too many calls — this key may make ${perMinuteOf(key)} a minute. Wait ${quota.resetIn} s. Calling on in a loop blocks the key for an hour.`), rid);
      return;
    }


    // 4 · The answer
    let status = 200, returned: number | undefined, code: string | undefined;
    let answer: () => void = () => undefined;
    try {
      const stock = await getStock();
      const rules = { scope: key.scope, price: key.price, share3d: key.share3d === true };
      const priceShown = key.price?.show !== false;
      const mine: Product[] = stock.items.filter(d => inScope(d, rules)).map(d => toProduct(d, stock.designs.get(d.id), rules, playableOf));
      let body: unknown;
      if (path === "ping") {
        body = { ok: true, key: key.name, limits: { perMinute: quota.perMinute, perDay: quota.perDay, minuteLeft: quota.minuteLeft, dayLeft: quota.dayLeft },
          prices: priceShown ? "shown" : "hidden", pieces: mine.filter(p => p.inStock).length, time: new Date().toISOString() };
      } else if (path === "product") {
        if (route.length > 3) throw new ApiError(404, "not_found", "No such address — see GET /v1");
        const p = mine.find(x => x.id === route[2]);
        if (!p) throw new ApiError(404, "not_found", "No piece with that id");
        const params = flatParams(req.query);
        const fields = params.fields ? parseQuery({ fields: params.fields }, priceShown).fields : undefined;
        body = { data: pick(p, fields) };
        returned = 1;
      } else if (path === "products" && route.length === 2) {
        const q = parseQuery(flatParams(req.query), priceShown);
        const r = listProducts(mine, q);
        returned = r.data.length;
        body = { ...r, links: {
          self: pageLink(req, route, q.page), first: pageLink(req, route, 1), last: pageLink(req, route, r.meta.totalPages),
          next: r.meta.hasMore ? pageLink(req, route, q.page + 1) : null, prev: q.page > 1 ? pageLink(req, route, q.page - 1) : null,
        } };
      } else if (path === "filters" && route.length === 2) {
        const params = flatParams(req.query);
        delete params.page; delete params.limit; delete params.sort; delete params.fields;
        body = { data: facets(mine, parseQuery(params, priceShown)) };
      } else {
        throw new ApiError(404, "not_found", "No such address — see GET /v1");
      }
      // The same answer as last time: "Not Modified", nothing sent again.
      const etag = `"${createHash("sha1").update(JSON.stringify(body)).digest("base64url").slice(0, 27)}"`;
      if (req.get("if-none-match") === etag) { status = 304; answer = () => { res.status(304).set("ETag", etag).end(); }; }
      else answer = () => send(req, res, 200, { ...(body as object), generatedAt: new Date().toISOString() }, etag);
    } catch (e) {
      const err = e instanceof ApiError ? e : new ApiError(500, "server_error", "Something went wrong on our side — try again");
      if (!(e instanceof ApiError)) console.error("[api]", rid, e);
      status = err.status; code = err.code;
      answer = () => fail(req, res, err, rid);
    }
    // Written before the answer goes: once it has gone, the server may be slowed right down.
    await Promise.all([
      record(call(key.id, status, { keyName: key.name, returned, code })).catch(e => console.warn("[api] not recorded:", e?.message ?? e)),
      flushIfDue(),
    ]);
    answer();
  },
);
