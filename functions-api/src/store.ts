// What the API reads, kept live in memory: the API keys, the Ready Stock, and
// the design details of the orders behind its pieces. Each is WATCHED
// (Firestore listeners), so after the first read only what changes is read
// again — a client's website calling all day costs the same reads as calling
// once, and a key paused or deleted stops within a second or two. Should a
// watch fail, plain reads take over (keys every 20 s, stock every 2 minutes)
// until it is started again.
//
// Only reads here; nothing is ever changed in Ready Stock, orders or Storage.
import { initializeApp } from "firebase-admin/app";
import { getFirestore, type DocumentData, type QuerySnapshot } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import type { OrderDesign, StockDoc } from "./logic";

// The app's named database (src/lib/firebase.ts DATABASE_ID).
export const app = initializeApp();
export const db = getFirestore(app, "diamondflow");

/* ─────────────── A collection kept live ─────────────── */

/**
 * A query watched while this instance runs. `rows()` waits for the first
 * answer; after an error it reads plainly (no more often than `pollMs`) and
 * watches again a minute later. A plain read every `safetyMs` as well, in case
 * a watch went quiet without saying so.
 */
function live(name: string, query: () => FirebaseFirestore.Query, pollMs: number, safetyMs: number, onChange?: () => void) {
  let snap: QuerySnapshot<DocumentData> | null = null;
  let at = 0;
  let version = 0;
  let watching = false;
  let first: Promise<void> | null = null;
  let polling: Promise<void> | null = null;
  const take = (s: QuerySnapshot<DocumentData>) => { snap = s; at = Date.now(); version += 1; onChange?.(); };
  const watch = () => {
    watching = true;
    first = new Promise<void>(resolve => {
      const stop = query().onSnapshot(s => { take(s); resolve(); }, err => {
        console.warn(`[api] ${name} watch stopped:`, err.message);
        watching = false; stop(); resolve();
        setTimeout(watch, 60_000);
      });
    });
  };
  const poll = async () => {
    polling ??= query().get().then(take).finally(() => { polling = null; });
    await polling;
  };
  return {
    async rows(): Promise<QuerySnapshot<DocumentData>> {
      if (!first) watch();
      await first;
      const age = Date.now() - at;
      if (!snap || (!watching && age > pollMs) || age > safetyMs) await poll();
      return snap!;
    },
    version: () => version,
  };
}

/* ─────────────── Keys ─────────────── */

export interface ApiKey {
  id: string;
  name: string;
  hash: string;
  prefix?: string;
  status?: "active" | "paused";
  pausedBy?: "admin" | "system";
  blockedUntil?: string;
  blocks?: { day: string; n: number };
  scope?: { types?: string[]; metals?: string[]; offices?: string[]; companies?: string[] };
  price?: { show?: boolean; markupPct?: number };
  share3d?: boolean;
  limits?: { perMinute?: number; perDay?: number };
  origins?: string[];
  deletedAt?: string;
}

export const DEFAULT_PER_MINUTE = 60;
export const DEFAULT_PER_DAY = 10_000;
// One key's counter is one record, changed on every call: kept to 2 a second.
export const MAX_PER_MINUTE = 120;
export const MAX_PER_DAY = 1_000_000;
export const perMinuteOf = (k: ApiKey) => Math.min(MAX_PER_MINUTE, Math.max(1, Math.round(Number(k.limits?.perMinute) || DEFAULT_PER_MINUTE)));
export const perDayOf = (k: ApiKey) => Math.min(MAX_PER_DAY, Math.max(1, Math.round(Number(k.limits?.perDay) || DEFAULT_PER_DAY)));

let keyMap = new Map<string, ApiKey>();
let keyVersion = -1;
/** What this instance itself set on a key (a block) — only until the watch brings anything newer
 *  (its own write among it), so an admin's unblock straight after is never held back. */
const patches = new Map<string, { patch: Partial<ApiKey>; version: number; until: number }>();
const keysLive = live("apiKeys", () => db.collection("apiKeys"), 20_000, 10 * 60_000);

/** The key with this hash — from the watched keys (a new one is there within a second or two). */
export async function keyByHash(hash: string): Promise<ApiKey | undefined> {
  const snap = await keysLive.rows();
  if (keyVersion !== keysLive.version()) {
    const next = new Map<string, ApiKey>();
    for (const d of snap.docs) {
      const k = { ...(d.data() as ApiKey), id: d.id };
      if (typeof k.hash === "string" && k.hash.length === 64) next.set(k.hash, k);
    }
    keyMap = next;
    keyVersion = keysLive.version();
  }
  const k = keyMap.get(hash);
  const p = patches.get(hash);
  if (k && p && p.version === keysLive.version() && p.until > Date.now()) return { ...k, ...p.patch };
  return k;
}

/** This instance's copy of a key changed by the server itself (blocked, paused) — before the watch brings it. */
export function patchKey(hash: string, patch: Partial<ApiKey>): void {
  patches.set(hash, { patch, version: keysLive.version(), until: Date.now() + 30_000 });
}

/* ─────────────── Ready Stock ─────────────── */

const DESIGN_FIELDS = ["designNumber", "productSize", "productColor", "diamondShape", "actualDiamondPcs", "rhodium", "stamping",
  "otherMetal", "otherMetalWeight", "otherMetalPurity", "otherMetals", "certificate", "cad3dmUrl", "productVideo"];

export interface Stock {
  items: StockDoc[];
  /** Ready Stock id → the design details of the order behind it. */
  designs: Map<string, OrderDesign>;
  at: number;
}

const pickDesign = (o: Record<string, unknown>): OrderDesign =>
  Object.fromEntries(DESIGN_FIELDS.filter(f => o[f] !== undefined && o[f] !== null).map(f => [f, o[f]])) as OrderDesign;

/** Only what the API reads off a piece — never its cost, notes or history's words. */
function stockDoc(id: string, x: Record<string, unknown>): StockDoc {
  const h = x.history as { at?: string }[] | undefined;
  const last = Array.isArray(h) && h.length ? h[h.length - 1]?.at : undefined;
  const pickd: Record<string, unknown> = {};
  for (const f of ["name", "jewelleryType", "metal", "productKarats", "grossWeight", "netWeight", "diamondWeight", "diamondType",
    "price", "quantity", "images", "video", "sku", "location", "companyId", "createdAt", "fromReturn"]) if (x[f] !== undefined) pickd[f] = x[f];
  return { ...(pickd as Omit<StockDoc, "id">), id, updatedAt: typeof last === "string" ? last : undefined };
}

const stockLive = live("readyStock", () => db.collection("readyStock"), 2 * 60_000, 30 * 60_000);
// Built in-house: the order names its piece.
const builtLive = live("built orders", () => db.collection("orders").where("readyStockCreatedId", ">", ""), 2 * 60_000, 30 * 60_000);
/** Sent back by a client: the piece names its order — read once each. */
const returned = new Map<string, OrderDesign | null>();

let built: { key: string; stock: Stock } | null = null;

export async function getStock(): Promise<Stock> {
  const [s, o] = await Promise.all([stockLive.rows(), builtLive.rows()]);
  const key = `${stockLive.version()}|${builtLive.version()}`;
  if (built?.key === key) return built.stock;
  const items = s.docs.map(d => stockDoc(d.id, d.data()));
  const designs = new Map<string, OrderDesign>();
  for (const d of o.docs) {
    const x = d.data();
    if (!x.deletedAt && typeof x.readyStockCreatedId === "string") designs.set(x.readyStockCreatedId, pickDesign(x));
  }
  const want = [...new Set(items.filter(i => i.fromReturn?.orderId && !designs.has(i.id)).map(i => i.fromReturn!.orderId!))].filter(id => !returned.has(id));
  for (let i = 0; i < want.length; i += 100) {
    const got = await db.getAll(...want.slice(i, i + 100).map(id => db.collection("orders").doc(id)), { fieldMask: DESIGN_FIELDS });
    for (const g of got) returned.set(g.id, g.exists ? pickDesign(g.data()!) : null);
  }
  for (const it of items) {
    const id = it.fromReturn?.orderId;
    const r = id ? returned.get(id) : undefined;
    if (r && !designs.has(it.id)) designs.set(it.id, r);
  }
  await checkPlayable(items.map(i => i.video).concat([...designs.values()].map(x => x.productVideo)));
  const stock = { items, designs, at: Date.now() };
  built = { key, stock };
  return stock;
}

/* ─────────────── Videos every device plays ─────────────── */

// Beside a stored video the server makes "<original>.web.mp4" (functions/src/videoWeb.ts,
// lib/webVideo.ts). Only offered once it is really there.
const WEB_SUFFIX = ".web.mp4";
const playable = new Map<string, { url: string | null; at: number }>();

function webUrl(src: string): { url: string; bucket: string; path: string } | null {
  const m = src.match(/^(https:\/\/[^/]+\/v0\/b\/([^/]+)\/o\/)([^?#]+)(\?[^#]*)?$/);
  if (!m) return null;
  let path: string;
  try { path = decodeURIComponent(m[3]); } catch { return null; }
  if (path.endsWith(WEB_SUFFIX)) return null;
  return { url: `${m[1]}${m[3]}${encodeURIComponent(WEB_SUFFIX)}${m[4] ?? ""}`, bucket: m[2], path: path + WEB_SUFFIX };
}

async function checkPlayable(urls: (string | undefined)[]): Promise<void> {
  const todo = [...new Set(urls.filter((u): u is string => !!u))].filter(u => {
    const c = playable.get(u);
    return !c || (!c.url && Date.now() - c.at > 10 * 60_000);
  });
  for (let i = 0; i < todo.length; i += 10) {
    await Promise.all(todo.slice(i, i + 10).map(async u => {
      const w = webUrl(u);
      if (!w) { playable.set(u, { url: null, at: Date.now() }); return; }
      try {
        const [there] = await getStorage(app).bucket(w.bucket).file(w.path).exists();
        playable.set(u, { url: there ? w.url : null, at: Date.now() });
      } catch { playable.set(u, { url: null, at: Date.now() }); }
    }));
  }
}

/** The copy every browser and device plays, when it has been made. */
export const playableOf = (url: string): string | null => playable.get(url)?.url ?? null;
