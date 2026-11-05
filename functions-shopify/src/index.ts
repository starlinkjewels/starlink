// Shopify stores connected to our order board (Settings → Shopify).
//
//   shopifyConnect   an admin connects a store: its address and its own app's
//                    Client ID + secret (the store's Dev Dashboard app — client
//                    credentials grant); checked, then its order messages are set up
//   shopifyAdmin     an admin's store tools: save its rules, preview them on a real
//                    order, sync now, bring in one order, test, pause, disconnect
//   shopifyWebhook   the store's messages — signature checked, each kept once,
//                    answered at once; the work is done by shopifyInboxRun
//   shopifySync      every 15 minutes: every store's orders changed since the last
//                    check (anything a message missed), its messages put back if
//                    Shopify dropped them, and the sends to Shopify that failed retried
//   shopifyOnOrder   our order dispatched / its stage moved: queued for Shopify
//   shopifyJobRun    one send to Shopify (a fulfilment, a stage tag), retried on failure
import { onCall, onRequest, HttpsError } from "firebase-functions/v2/https";
import { onDocumentCreated, onDocumentUpdated, onDocumentWritten } from "firebase-functions/v2/firestore";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { REGION, OWNER_EMAILS } from "./region";
import { db, fetchToken, gql, seal, secretFor, SHOPIFY_KEY, ShopifyError, VAULT, type Vault } from "./shopify";
import { cleanShop, importProblem, mapLine, rulesOf, webhookSigned, legacyOf, shopSlug, type StoreRules } from "./logic";
import {
  changedSince, dropWebhooks, ensureWebhooks, fulfilLine, JOBS, MIRROR, ourLists, ourOrderId, processOrder, readOrder, STORES, tagStage, updateTracking,
  type StoreDoc,
} from "./orders";

const DATABASE = "diamondflow";
const secrets = [SHOPIFY_KEY];
const INBOX = "shopifyInbox";
const DAY = 86_400_000;

/** Where Shopify sends this store's messages — this project's own function address. */
function callbackUrl(): string {
  const project = process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT || "";
  if (process.env.FUNCTIONS_EMULATOR === "true") return `http://127.0.0.1:5001/${project}/${REGION}/shopifyWebhook`;
  return `https://${REGION}-${project}.cloudfunctions.net/shopifyWebhook`;
}

/** The scopes the store's app must have. */
const NEEDED = [
  { scope: "read_orders", alt: ["write_orders"], why: "read its orders" },
  { scope: "write_orders", alt: [], why: "show our stage as a tag" },
  { scope: "read_products", alt: ["write_products"], why: "read product types and options" },
  { scope: "write_merchant_managed_fulfillment_orders", alt: [], why: "mark orders fulfilled with tracking" },
];

async function requireAdmin(auth: { uid: string; token: { email?: string } } | undefined): Promise<string> {
  if (!auth?.uid) throw new HttpsError("unauthenticated", "Sign in first.");
  const email = String(auth.token?.email ?? "").toLowerCase();
  if (OWNER_EMAILS.includes(email)) return auth.uid;
  const idx = (await db.collection("userByAuth").doc(auth.uid).get()).data() as { role?: string; status?: string } | undefined;
  if (idx?.role === "admin" && idx?.status === "active") return auth.uid;
  throw new HttpsError("permission-denied", "Only an admin can manage Shopify stores.");
}

const fail = (e: unknown): never => {
  if (e instanceof HttpsError) throw e;
  throw new HttpsError("failed-precondition", e instanceof Error ? e.message : String(e));
};

/** A store's rules as an admin typed them — only what is known, each within bounds. */
function cleanRules(r: unknown): StoreRules {
  const x = (r ?? {}) as Record<string, unknown>;
  const words = (v: unknown, max = 12) => (Array.isArray(v) ? v.map(s => String(s ?? "").trim().slice(0, 40)).filter(Boolean).slice(0, max) : undefined);
  const pairs = <K extends string>(v: unknown, k: K) => (Array.isArray(v)
    ? v.map(p => ({ word: String((p as Record<string, unknown>)?.word ?? "").trim().slice(0, 40), [k]: String((p as Record<string, unknown>)?.[k] ?? "").trim().slice(0, 60) }))
      .filter(p => p.word && (p as Record<string, string>)[k]).slice(0, 40)
    : undefined) as ({ word: string } & Record<K, string>)[] | undefined;
  const out: StoreRules = {
    importWhen: x.importWhen === "any" ? "any" : "paid",
    importTest: x.importTest === true,
    priceMode: x.priceMode === "percent" ? "percent" : "approval",
    pricePct: typeof x.pricePct === "number" && x.pricePct > 0 && x.pricePct <= 500 ? Math.round(x.pricePct * 100) / 100 : undefined,
    leadDays: typeof x.leadDays === "number" && x.leadDays >= 1 && x.leadDays <= 180 ? Math.round(x.leadDays) : 14,
    metalOptions: words(x.metalOptions), karatOptions: words(x.karatOptions), sizeOptions: words(x.sizeOptions), stoneOptions: words(x.stoneOptions),
    typeRules: pairs(x.typeRules, "type"), metalRules: pairs(x.metalRules, "metal"),
    defaultType: typeof x.defaultType === "string" ? x.defaultType.slice(0, 60) : undefined,
    defaultMetal: typeof x.defaultMetal === "string" ? x.defaultMetal.slice(0, 60) : undefined,
    stageTags: x.stageTags !== false, tagPrefix: typeof x.tagPrefix === "string" && x.tagPrefix.trim() ? x.tagPrefix.trim().slice(0, 30) : "Stage",
    notifyCustomer: x.notifyCustomer !== false,
  };
  return Object.fromEntries(Object.entries(out).filter(([, v]) => v !== undefined)) as StoreRules;
}

/** What the store's app can do, and what it is missing. */
async function checkStore(storeId: string): Promise<{ name: string; currency: string; domain: string; missing: string[] }> {
  const d = await gql<{ shop: { name: string; currencyCode: string; myshopifyDomain: string }; currentAppInstallation: { accessScopes: { handle: string }[] } }>(storeId,
    `query { shop { name currencyCode myshopifyDomain } currentAppInstallation { accessScopes { handle } } }`);
  const have = new Set(d.currentAppInstallation.accessScopes.map(s => s.handle));
  const missing = NEEDED.filter(n => !have.has(n.scope) && !n.alt.some(a => have.has(a))).map(n => `${n.scope} (to ${n.why})`);
  return { name: d.shop.name, currency: d.shop.currencyCode, domain: d.shop.myshopifyDomain, missing };
}

/* ─────────────── Connecting a store ─────────────── */

interface ConnectReq { shop?: string; appClientId?: string; appSecret?: string; name?: string; clientId?: string; companyId?: string; handlerId?: string; importDays?: number }

export const shopifyConnect = onCall<ConnectReq>({ region: REGION, secrets, memory: "256MiB", maxInstances: 5, timeoutSeconds: 120 }, async req => {
  const uid = await requireAdmin(req.auth as never);
  const shop = cleanShop(req.data?.shop ?? "");
  if (!shop) throw new HttpsError("invalid-argument", "Enter the store's address — like acme-jewels.myshopify.com");
  const appClientId = String(req.data?.appClientId ?? "").trim(), appSecret = String(req.data?.appSecret ?? "").trim();
  if (appClientId.length < 8 || appSecret.length < 8) throw new HttpsError("invalid-argument", "Paste the app's Client ID and Client secret (Dev Dashboard → the app → Settings)");
  const clientId = String(req.data?.clientId ?? "");
  if (!clientId || !(await db.collection("clients").doc(clientId).get()).exists) throw new HttpsError("invalid-argument", "Choose the client this store's orders are for");
  // One store, one record — named by its address: connected again, it is the same store,
  // so its lines keep the same orders (never brought in twice).
  const storeId = `st_${shopSlug(shop)}`;
  const sref = db.collection(STORES).doc(storeId);
  const prior = (await sref.get()).data() as StoreDoc | undefined;
  if (prior && prior.status !== "disconnected") throw new HttpsError("already-exists", "This store is already connected — open it to change it");
  // The keys work, and the app has what it needs — nothing is saved until they do.
  let t: Awaited<ReturnType<typeof fetchToken>>;
  try { t = await fetchToken(shop, appClientId, appSecret); } catch (e) { return fail(e); }
  const vault: Vault = { shop, clientId: appClientId, secret: seal(appSecret), token: seal(t.token), tokenExpiresAt: t.expiresAt };
  await db.collection(VAULT).doc(storeId).set(vault);
  let info;
  try { info = await checkStore(storeId); } catch (e) { await db.collection(VAULT).doc(storeId).delete(); fail(e); }
  if (info!.missing.length) {
    await db.collection(VAULT).doc(storeId).delete();
    throw new HttpsError("failed-precondition", `The store's app is missing access to: ${info!.missing.join(", ")}. Add these in the Dev Dashboard (Versions → Access scopes), release, then connect again.`);
  }
  const at = new Date().toISOString();
  const store: StoreDoc = {
    id: storeId, shop, name: String(req.data?.name ?? "").trim().slice(0, 60) || info!.name, status: "connected", clientId,
    ...(req.data?.companyId ? { companyId: String(req.data.companyId) } : {}), ...(req.data?.handlerId ? { handlerId: String(req.data.handlerId) } : {}),
    // Connected again: its rules as they were. New orders count from now — what was placed while it
    // was off comes in only when asked for (days back, or by its number); its lines brought in
    // before keep their orders (the same ids), so nothing comes in twice.
    rules: prior?.rules ? cleanRules(prior.rules) : cleanRules({}), currency: info!.currency, connectedAt: at, lastSyncAt: at,
  };
  // Claimed in a transaction: two admins connecting the same store at once make one store.
  try {
    await db.runTransaction(async tx => {
      const cur = (await tx.get(sref)).data() as StoreDoc | undefined;
      if (cur && cur.status !== "disconnected") throw new HttpsError("already-exists", "This store is already connected — open it to change it");
      tx.set(sref, { ...store, connectedBy: uid, ...(prior ? { reconnectedAt: at } : {}) });
    });
  } catch (e) { return fail(e); }
  try { await ensureWebhooks(storeId, callbackUrl()); }
  catch (e) { await db.collection(STORES).doc(storeId).update({ lastError: `Messages not set up: ${(e as Error).message}` }); }
  // Orders already on the store: brought in from this many days back, when asked.
  const days = Math.min(60, Math.max(0, Math.round(Number(req.data?.importDays) || 0)));
  if (days) await db.collection(INBOX).add({ storeId, kind: "backfill", since: new Date(Date.now() - days * DAY).toISOString(), at, expireAt: Timestamp.fromMillis(Date.now() + 30 * DAY) });
  return { storeId, name: store.name, currency: store.currency };
});

/* ─────────────── An admin's store tools ─────────────── */

interface AdminReq {
  action?: "save" | "preview" | "syncNow" | "importOrder" | "test" | "pause" | "resume" | "disconnect" | "credentials";
  storeId?: string; name?: string; clientId?: string; companyId?: string | null; handlerId?: string | null; rules?: unknown;
  orderName?: string; days?: number; appClientId?: string; appSecret?: string;
}

export const shopifyAdmin = onCall<AdminReq>({ region: REGION, secrets, memory: "256MiB", maxInstances: 5, timeoutSeconds: 300 }, async req => {
  const uid = await requireAdmin(req.auth as never);
  const storeId = String(req.data?.storeId ?? "");
  const ref = db.collection(STORES).doc(storeId);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError("not-found", "No such store");
  const store = { ...(snap.data() as StoreDoc), id: storeId };
  const a = req.data?.action;
  try {
    if (a === "save") {
      const clientId = req.data?.clientId ? String(req.data.clientId) : store.clientId;
      if (!(await db.collection("clients").doc(clientId).get()).exists) throw new HttpsError("invalid-argument", "Choose the client this store's orders are for");
      await ref.update({
        name: String(req.data?.name ?? store.name).trim().slice(0, 60) || store.name, clientId,
        companyId: req.data?.companyId ? String(req.data.companyId) : FieldValue.delete(),
        handlerId: req.data?.handlerId ? String(req.data.handlerId) : FieldValue.delete(),
        rules: cleanRules(req.data?.rules), updatedAt: new Date().toISOString(), updatedBy: uid,
      });
      return { ok: true };
    }
    if (a === "pause" || a === "resume") { await ref.update({ status: a === "pause" ? "paused" : "connected" }); return { ok: true }; }
    if (a === "disconnect") {
      await dropWebhooks(storeId, callbackUrl()).catch(() => undefined);
      await db.collection(VAULT).doc(storeId).delete();
      await ref.update({ status: "disconnected", disconnectedAt: new Date().toISOString(), disconnectedBy: uid });
      return { ok: true };
    }
    if (a === "credentials") {
      const appClientId = String(req.data?.appClientId ?? "").trim(), appSecret = String(req.data?.appSecret ?? "").trim();
      const t = await fetchToken(store.shop, appClientId, appSecret);
      await db.collection(VAULT).doc(storeId).set({ shop: store.shop, clientId: appClientId, secret: seal(appSecret), token: seal(t.token), tokenExpiresAt: t.expiresAt });
      await ref.update({ status: store.status === "disconnected" || store.status === "error" ? "connected" : store.status, lastError: FieldValue.delete() });
      await ensureWebhooks(storeId, callbackUrl());
      return { ok: true };
    }
    if (a === "test") {
      const t0 = Date.now();
      const info = await checkStore(storeId);
      const added = await ensureWebhooks(storeId, callbackUrl());
      return { ok: true, ms: Date.now() - t0, ...info, webhooksAdded: added };
    }
    if (a === "syncNow") {
      const since = new Date(Date.now() - Math.min(60, Math.max(1, Number(req.data?.days) || 1)) * DAY).toISOString();
      // Checking further back brings in the orders of those days too (as connecting with days back does).
      return await syncStore(store, since, false, since);
    }
    if (a === "importOrder" || a === "preview") {
      const name = String(req.data?.orderName ?? "").trim();
      if (name && !/^#?[A-Za-z0-9-]{1,20}$/.test(name)) throw new HttpsError("invalid-argument", "An order number like #1001");
      if (a === "importOrder" && !name) throw new HttpsError("invalid-argument", "Enter the order's number, like #1001");
      const found = await gql<{ orders: { nodes: { id: string }[] } }>(storeId,
        `query Find($q: String!) { orders(first: 1, query: $q, sortKey: CREATED_AT, reverse: true) { nodes { id } } }`,
        { q: name ? `name:"${name.startsWith("#") ? name : `#${name}`}"` : "" });
      const gid = found.orders.nodes[0]?.id;
      if (!gid) throw new HttpsError("not-found", name ? `No order ${name} on this store` : "No orders on this store yet");
      // Asked for by its number: it comes in whenever it was placed.
      if (a === "importOrder") return await processOrder(storeId, gid, { notBefore: null });
      const o = await readOrder(storeId, gid);
      if (!o) throw new HttpsError("not-found", "Not found on Shopify");
      const rules = req.data?.rules ? cleanRules(req.data.rules) : rulesOf(store.rules);
      const lists = await ourLists();
      return {
        order: { name: o.name, createdAt: o.createdAt, financialStatus: o.financialStatus, currency: o.currency, test: o.test, cancelled: !!o.cancelledAt },
        problem: importProblem(o, rules),
        lines: o.lines.map(l => ({ title: l.title, variant: l.variantTitle, sku: l.sku, options: l.options, image: l.image,
          mapped: mapLine(l, o, rules, lists.types, lists.metals, lists.noKarat) })),
      };
    }
    throw new HttpsError("invalid-argument", "Unknown action");
  } catch (e) {
    if (e instanceof ShopifyError && e.code === "shop_not_permitted") await ref.update({ status: "error", lastError: e.message });
    return fail(e);
  }
});

/* ─────────────── The store's messages ─────────────── */

export const shopifyWebhook = onRequest({ region: REGION, secrets, memory: "256MiB", maxInstances: 10, timeoutSeconds: 10, invoker: "public" }, async (req, res) => {
  if (req.method !== "POST") { res.status(405).end(); return; }
  const shop = String(req.get("x-shopify-shop-domain") ?? "").toLowerCase();
  const topic = String(req.get("x-shopify-topic") ?? "");
  const webhookId = String(req.get("x-shopify-webhook-id") ?? "");
  const stores = cleanShop(shop) ? await db.collection(STORES).where("shop", "==", shop).get() : null;
  const live = stores?.docs.find(d => d.data().status !== "disconnected");
  if (!live) { res.status(401).end(); return; }
  // Really from this store's app: signed with its own secret, over the body exactly as sent.
  let secret = "";
  try { secret = await secretFor(live.id); } catch { res.status(401).end(); return; }
  if (!webhookSigned(req.rawBody, req.get("x-shopify-hmac-sha256"), secret)) { res.status(401).end(); return; }
  let body: { admin_graphql_api_id?: string; id?: number } = {};
  try { body = JSON.parse(req.rawBody.toString("utf8")); } catch { /* an empty body is fine for some topics */ }
  // Kept per store: one store's delivery id can never be taken for another's.
  const id = `${live.id}_${webhookId || `${topic}_${body.id ?? ""}_${req.get("x-shopify-triggered-at") ?? ""}`}`.replace(/[/\s]/g, "_").slice(0, 200);
  try {
    // Kept once: a delivery Shopify sends again finds its own record and stops here.
    await db.collection(INBOX).doc(id).create({
      storeId: live.id, kind: topic, orderGid: body.admin_graphql_api_id ?? (body.id ? `gid://shopify/Order/${body.id}` : null),
      at: new Date().toISOString(), triggeredAt: req.get("x-shopify-triggered-at") ?? null, expireAt: Timestamp.fromMillis(Date.now() + 30 * DAY),
    });
  } catch (e) {
    if ((e as { code?: number }).code !== 6) { console.error("[shopify] inbox:", e); res.status(500).end(); return; } // 6 = ALREADY_EXISTS
  }
  res.status(200).send("ok");
});

/** One message's work: the order read from Shopify and brought up to date. */
export const shopifyInboxRun = onDocumentCreated({ document: `${INBOX}/{id}`, database: DATABASE, region: REGION, secrets, memory: "256MiB", maxInstances: 5, timeoutSeconds: 300, retry: false }, async ev => {
  const m = ev.data?.data() as { storeId: string; kind: string; orderGid?: string | null; since?: string } | undefined;
  if (!m) return;
  const ref = ev.data!.ref;
  try {
    if (m.kind === "app/uninstalled") {
      await db.collection(STORES).doc(m.storeId).update({ status: "disconnected", lastError: "The app was removed on Shopify — connect the store again to carry on", disconnectedAt: new Date().toISOString() });
      await db.collection(VAULT).doc(m.storeId).delete().catch(() => undefined);
    } else if (m.kind === "backfill" && m.since) {
      const s = (await db.collection(STORES).doc(m.storeId).get()).data() as StoreDoc | undefined;
      const from = (m as { from?: string }).from ?? m.since;
      if (s) {
        const r = await syncStore({ ...s, id: m.storeId }, m.since, false, from);
        // A big store: the rest in another step, from where this one stopped.
        if (r.more && r.through) await db.collection(INBOX).add({ storeId: m.storeId, kind: "backfill", since: r.through, from, at: new Date().toISOString(), expireAt: Timestamp.fromMillis(Date.now() + 30 * DAY) });
      }
    } else if (m.orderGid) {
      await processOrder(m.storeId, m.orderGid);
    }
    await ref.update({ doneAt: new Date().toISOString() });
  } catch (e) {
    // Left for the 15-minute check, which reads every changed order again.
    await ref.update({ error: (e as Error).message?.slice(0, 500) ?? String(e) }).catch(() => undefined);
    await db.collection(STORES).doc(m.storeId).update({ lastError: (e as Error).message?.slice(0, 300) }).catch(() => undefined);
  }
});

/* ─────────────── The 15-minute check ─────────────── */

/**
 * The store's orders changed since `since`, oldest change first. The check's
 * place moves to the last order done — never past one not done — so a store
 * with many changes is caught up over several checks, and one order that keeps
 * failing is passed over (and said) rather than holding the store back.
 */
async function syncStore(store: StoreDoc, since: string, moveCursor = true, notBefore?: string): Promise<{ checked: number; created: string[]; more: boolean; through?: string; failed: string[] }> {
  const MAX = 200;
  const changed = await changedSince(store.id, since, MAX);
  const created: string[] = [], failed: string[] = [];
  let through: string | undefined;
  for (const c of changed) {
    try {
      const r = await processOrder(store.id, c.id, notBefore ? { notBefore } : {});
      created.push(...r.created);
    } catch (e) {
      failed.push(`${legacyOf(c.id)}: ${(e as Error).message?.slice(0, 120)}`);
    }
    through = c.updatedAt;
  }
  const more = changed.length >= MAX;
  if (moveCursor) {
    await db.collection(STORES).doc(store.id).update({
      // Caught up: from about now. More still to do: from the last one done.
      lastSyncAt: more && through ? through : new Date(Date.now() - 60_000).toISOString(), lastSyncCount: changed.length,
      lastError: failed.length ? `Couldn't bring in ${failed.length} order${failed.length !== 1 ? "s" : ""}: ${failed.slice(0, 3).join("; ")}` : FieldValue.delete(),
    });
  }
  return { checked: changed.length, created, more, through, failed };
}

export const shopifySync = onSchedule({ schedule: "every 15 minutes", region: REGION, secrets, memory: "256MiB", timeoutSeconds: 540, retryCount: 0 }, async () => {
  const stores = await db.collection(STORES).where("status", "in", ["connected", "error"]).get();
  for (const d of stores.docs) {
    const s = { ...(d.data() as StoreDoc), id: d.id };
    try {
      // From a little before the last check: an order saved as the check ran is never missed.
      const since = new Date(Date.parse(s.lastSyncAt ?? s.connectedAt ?? new Date().toISOString()) - 10 * 60_000).toISOString();
      await syncStore(s, since);
      await ensureWebhooks(s.id, callbackUrl());
      // A dispatch whose news never reached the server: queued now (the job is made once per order).
      const shipped = await db.collection("orders").where("shopify.storeId", "==", s.id)
        .where("dispatchedAt", ">=", new Date(Date.now() - 3 * DAY).toISOString()).select("status").get();
      for (const o of shipped.docs) {
        const st = o.data().status;
        if (st !== "Dispatched" && st !== "Delivered") continue;
        await db.collection(JOBS).doc(`fulfil_${o.id}`).create({ kind: "fulfil", orderId: o.id, storeId: s.id, status: "pending", attempts: 0, at: new Date().toISOString() }).catch(() => undefined);
      }
      if (s.status === "error") await d.ref.update({ status: "connected" });
    } catch (e) {
      await d.ref.update({ lastError: (e as Error).message?.slice(0, 300) ?? String(e) }).catch(() => undefined);
    }
  }
  // The sends to Shopify that failed: tried again, at most 12 times each.
  const due = await db.collection(JOBS).where("status", "==", "retry").where("nextAt", "<=", new Date().toISOString()).limit(100).get();
  for (const j of due.docs) await j.ref.update({ status: "pending" });
});

/* ─────────────── Our work, back to Shopify ─────────────── */

type OrderLike = { status?: string; dispatchedAt?: string; courierName?: string; trackingNumber?: string; trackingLink?: string; quantity?: number;
  shopify?: { storeId: string; orderGid: string; lineGid: string } };

export const shopifyOnOrder = onDocumentUpdated({ document: "orders/{id}", database: DATABASE, region: REGION, memory: "256MiB", maxInstances: 5, retry: false }, async ev => {
  const before = ev.data?.before.data() as OrderLike | undefined, after = ev.data?.after.data() as OrderLike | undefined;
  if (!after?.shopify) return;
  const id = ev.params.id;
  const at = new Date().toISOString();
  const shipped = (o?: OrderLike) => o?.status === "Dispatched" || o?.status === "Delivered";
  if (!shipped(before) && shipped(after)) {
    await db.collection(JOBS).doc(`fulfil_${id}`).create({ kind: "fulfil", orderId: id, storeId: after.shopify.storeId, status: "pending", attempts: 0, at })
      .catch(() => undefined); // already queued — once per order
  }
  // The tracking corrected after it was sent: Shopify's fulfilment updated.
  if (shipped(before) && shipped(after) && (before?.trackingNumber !== after.trackingNumber || before?.courierName !== after.courierName || before?.trackingLink !== after.trackingLink)) {
    await db.collection(JOBS).doc(`track_${id}`).set({ kind: "track", orderId: id, storeId: after.shopify.storeId, status: "pending", attempts: 0, at, stage: at });
  }
  if (before?.status !== after.status && after.status) {
    await db.collection(JOBS).doc(`tag_${id}`).set({ kind: "tag", orderId: id, storeId: after.shopify.storeId, stage: after.status, status: "pending", attempts: 0, at });
  }
});

export const shopifyJobRun = onDocumentWritten({ document: `${JOBS}/{id}`, database: DATABASE, region: REGION, secrets, memory: "256MiB", maxInstances: 5, timeoutSeconds: 120, retry: false }, async ev => {
  const j = ev.data?.after.data() as { kind: string; orderId: string; storeId: string; stage?: string; status: string; attempts?: number } | undefined;
  const was = ev.data?.before.data() as { status?: string } | undefined;
  const wasStage = (ev.data?.before.data() as { stage?: string } | undefined)?.stage;
  // Only a job just made pending — new, retried, or a tag for a newer stage — never our own updates to it.
  if (!j || j.status !== "pending" || (was?.status === "pending" && wasStage === j.stage)) return;
  const ref = ev.data!.after.ref;
  const order = (await db.collection("orders").doc(j.orderId).get()).data() as (OrderLike & { clientId?: string }) | undefined;
  const store = (await db.collection(STORES).doc(j.storeId).get()).data() as StoreDoc | undefined;
  const done = (status: string, result: string) => ref.update({ status, result, doneAt: new Date().toISOString(), error: FieldValue.delete() });
  if (!order?.shopify || !store || store.status === "disconnected") { await done("skipped", "No such order or store"); return; }
  // Only an order the server itself brought in from THIS store, for its client — never one a device could dress up.
  if (j.orderId !== ourOrderId(j.storeId, order.shopify.lineGid) || order.shopify.storeId !== j.storeId || order.clientId !== store.clientId) {
    await done("skipped", "Not this store's order"); return;
  }
  const rules = rulesOf(store.rules);
  const mirror = db.collection(MIRROR).doc(`${j.storeId}_${legacyOf(order.shopify.orderGid)}`);
  const track = { company: order.courierName, number: order.trackingNumber, url: order.trackingLink };
  // Paused: waits, without using up its tries — sent once the store is resumed.
  if (store.status === "paused") { await ref.update({ status: "retry", nextAt: new Date(Date.now() + 30 * 60_000).toISOString(), error: "The store is paused — sent when it is resumed" }); return; }
  try {
    if (j.kind === "fulfil") {
      const r = await fulfilLine(j.storeId, order.shopify.orderGid, order.shopify.lineGid, Math.max(1, order.quantity ?? 1), track, rules.notifyCustomer);
      if (r.result === "fulfilled") await mirror.set({ fulfilled: { [legacyOf(order.shopify.lineGid)]: new Date().toISOString() } }, { merge: true });
      await ref.update({ status: "done", result: r.result, fulfillmentIds: r.fulfillmentIds, doneAt: new Date().toISOString(), error: FieldValue.delete() });
      return;
    }
    if (j.kind === "track") {
      const f = (await db.collection(JOBS).doc(`fulfil_${j.orderId}`).get()).data() as { status?: string; fulfillmentIds?: string[] } | undefined;
      if (f?.status !== "done") { await done("skipped", "Not fulfilled yet — the fulfilment carries the tracking"); return; }
      if (!f.fulfillmentIds?.length) { await done("skipped", "Fulfilled on Shopify before — nothing of ours to correct"); return; }
      await updateTracking(j.storeId, f.fulfillmentIds, track, false);
      await done("done", "tracking updated");
      return;
    }
    if (j.kind === "tag") {
      if (!rules.stageTags) { await done("skipped", "Stage tags are off for this store"); return; }
      // The order's stage as it is now — two runs at once both end on the same tag.
      await tagStage(j.storeId, order.shopify.orderGid, rules.tagPrefix, order.status ?? j.stage ?? "");
      await done("done", "tagged");
      return;
    }
    await done("skipped", "Unknown job");
  } catch (e) {
    const attempts = (j.attempts ?? 0) + 1;
    const wait = Math.min(6 * 60, 2 ** attempts) * 60_000; // 2, 4, 8 … minutes, at most 6 hours
    await ref.update({ status: attempts >= 12 ? "failed" : "retry", attempts, nextAt: new Date(Date.now() + wait).toISOString(), error: (e as Error).message?.slice(0, 500) ?? String(e) });
  }
});
