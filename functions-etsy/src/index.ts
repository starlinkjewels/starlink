// Etsy shops connected to our order board (Settings → Etsy).
//
//   etsyStart     an admin starts a connection: the shop's own app (its keystring
//                 and shared secret); answers with Etsy's approval link
//   etsyCallback  Etsy sends the shop owner back here once they approve — the
//                 one-time state is checked, the code exchanged (PKCE), the shop saved
//   etsyAdmin     an admin's shop tools: rules, preview on a real order, sync now,
//                 bring in one order, test, pause, disconnect, the webhook secret
//   etsyWebhook   Etsy's order messages (when the shop set them up) — signature
//                 checked, each kept once; the work is done by etsyInboxRun
//   etsySync      every 5 minutes: each shop's orders changed since the last check
//                 (whatever a message missed), and shipments not yet sent
//   etsyOnOrder   our order dispatched: its Etsy order queued for shipping
//   etsyJobRun    the shipment to Etsy — once every piece of the Etsy order is dispatched
import { onCall, onRequest, HttpsError } from "firebase-functions/v2/https";
import { onDocumentCreated, onDocumentUpdated, onDocumentWritten } from "firebase-functions/v2/firestore";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { randomBytes } from "crypto";
import { REGION, OWNER_EMAILS } from "./region";
import { db, etsy, EtsyError, open, SEAL_KEY, seal, shopOfTokens, tokenCall, VAULT, type Vault } from "./etsy";
import { authorizeUrl, etsySigned, pkce, receiptOfResource, type EtsyReceipt } from "./etsyLogic";
import { importProblem, mapLine, rulesOf, type StoreRules } from "./shared/logic";
import { changedSince, JOBS, MIRROR, ourLists, ourOrderId, processReceipt, readReceipt, shipReceipt, STORES, type StoreDoc } from "./orders";

const DATABASE = "diamondflow";
const secrets = [SEAL_KEY];
const INBOX = "etsyInbox";
const PENDING = "etsyPending";
const DAY = 86_400_000;

const fnUrl = (name: string) => {
  const project = process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT || "";
  if (process.env.FUNCTIONS_EMULATOR === "true") return `http://127.0.0.1:5001/${project}/${REGION}/${name}`;
  return `https://${REGION}-${project}.cloudfunctions.net/${name}`;
};
/** Where Etsy sends the shop owner back — the Redirect URI the shop's app must list, exactly. */
export const callbackUrl = () => fnUrl("etsyCallback");

async function requireAdmin(auth: { uid: string; token: { email?: string } } | undefined): Promise<string> {
  if (!auth?.uid) throw new HttpsError("unauthenticated", "Sign in first.");
  const email = String(auth.token?.email ?? "").toLowerCase();
  if (OWNER_EMAILS.includes(email)) return auth.uid;
  const idx = (await db.collection("userByAuth").doc(auth.uid).get()).data() as { role?: string; status?: string } | undefined;
  if (idx?.role === "admin" && idx?.status === "active") return auth.uid;
  throw new HttpsError("permission-denied", "Only an admin can manage Etsy shops.");
}
const fail = (e: unknown): never => {
  if (e instanceof HttpsError) throw e;
  throw new HttpsError("failed-precondition", e instanceof Error ? e.message : String(e));
};

/** A shop's rules as an admin typed them — the same fields as a Shopify store's. */
function cleanRules(r: unknown): StoreRules {
  const x = (r ?? {}) as Record<string, unknown>;
  const words = (v: unknown, max = 12) => (Array.isArray(v) ? v.map(s => String(s ?? "").trim().slice(0, 40)).filter(Boolean).slice(0, max) : undefined);
  const pairs = <K extends string>(v: unknown, k: K) => (Array.isArray(v)
    ? v.map(p => ({ word: String((p as Record<string, unknown>)?.word ?? "").trim().slice(0, 40), [k]: String((p as Record<string, unknown>)?.[k] ?? "").trim().slice(0, 60) }))
      .filter(p => p.word && (p as Record<string, string>)[k]).slice(0, 40)
    : undefined) as ({ word: string } & Record<K, string>)[] | undefined;
  const out: StoreRules = {
    importWhen: "paid", importTest: false,
    priceMode: x.priceMode === "percent" ? "percent" : "approval",
    pricePct: typeof x.pricePct === "number" && x.pricePct > 0 && x.pricePct <= 500 ? Math.round(x.pricePct * 100) / 100 : undefined,
    leadDays: typeof x.leadDays === "number" && x.leadDays >= 1 && x.leadDays <= 180 ? Math.round(x.leadDays) : 14,
    metalOptions: words(x.metalOptions), karatOptions: words(x.karatOptions), sizeOptions: words(x.sizeOptions), stoneOptions: words(x.stoneOptions),
    typeRules: pairs(x.typeRules, "type"), metalRules: pairs(x.metalRules, "metal"),
    defaultType: typeof x.defaultType === "string" ? x.defaultType.slice(0, 60) : undefined,
    defaultMetal: typeof x.defaultMetal === "string" ? x.defaultMetal.slice(0, 60) : undefined,
    stageTags: false, notifyCustomer: true,
  };
  return Object.fromEntries(Object.entries(out).filter(([, v]) => v !== undefined)) as StoreRules;
}

/* ─────────────── Connecting a shop ─────────────── */

interface StartReq { keystring?: string; secret?: string; clientId?: string; companyId?: string; handlerId?: string; name?: string; importDays?: number }

export const etsyStart = onCall<StartReq>({ region: REGION, secrets, memory: "256MiB", maxInstances: 5, timeoutSeconds: 30 }, async req => {
  const uid = await requireAdmin(req.auth as never);
  const keystring = String(req.data?.keystring ?? "").trim(), secret = String(req.data?.secret ?? "").trim();
  if (!/^[A-Za-z0-9]{12,64}$/.test(keystring) || secret.length < 6 || secret.length > 200) throw new HttpsError("invalid-argument", "Paste the app's Keystring and Shared secret (Etsy → Your account → Apps you've made)");
  const clientId = String(req.data?.clientId ?? "");
  if (!clientId || !(await db.collection("clients").doc(clientId).get()).exists) throw new HttpsError("invalid-argument", "Choose the client this shop's orders are for");
  const state = randomBytes(24).toString("hex");
  const { verifier, challenge } = pkce();
  await db.collection(PENDING).doc(state).set({
    keystring, secret: seal(secret), verifier: seal(verifier), clientId,
    ...(req.data?.companyId ? { companyId: String(req.data.companyId) } : {}), ...(req.data?.handlerId ? { handlerId: String(req.data.handlerId) } : {}),
    name: String(req.data?.name ?? "").trim().slice(0, 60), importDays: Math.min(60, Math.max(0, Math.round(Number(req.data?.importDays) || 0))),
    by: uid, at: new Date().toISOString(), expireAt: Timestamp.fromMillis(Date.now() + 2 * 3_600_000),
  });
  return { url: authorizeUrl(keystring, callbackUrl(), state, challenge), callbackUrl: callbackUrl(), expiresInHours: 2 };
});

/** Where the admin's settings say the Redirect URI is (to copy into the shop's app). */
export const etsyInfo = onCall({ region: REGION, memory: "256MiB", maxInstances: 5 }, async req => {
  await requireAdmin(req.auth as never);
  return { callbackUrl: callbackUrl(), webhookUrl: fnUrl("etsyWebhook") };
});

const page = (title: string, body: string, ok: boolean) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f8fafc;font:16px/1.5 system-ui,sans-serif;color:#0f172a}main{max-width:460px;margin:24px;padding:32px;border-radius:18px;background:#fff;border:1px solid #e2e8f0;text-align:center}
h1{font-size:22px;margin:0 0 8px;color:${ok ? "#166534" : "#b91c1c"}}p{color:#475569;margin:6px 0}</style></head><body><main><h1>${title}</h1>${body}</main></body></html>`;
const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

export const etsyCallback = onRequest({ region: REGION, secrets, memory: "256MiB", maxInstances: 5, timeoutSeconds: 60, invoker: "public" }, async (req, res) => {
  res.set("Cache-Control", "no-store");
  res.set("Content-Type", "text/html; charset=utf-8");
  const state = String(req.query.state ?? ""), code = String(req.query.code ?? "");
  if (req.query.error) { res.status(400).send(page("Not connected", `<p>Etsy said: ${esc(String(req.query.error_description ?? req.query.error))}</p><p>Nothing was saved. Start again from Settings → Etsy.</p>`, false)); return; }
  if (!/^[a-f0-9]{48}$/.test(state) || !code || code.length > 1000) { res.status(400).send(page("Not connected", "<p>This link is not one of ours, or it is incomplete.</p>", false)); return; }
  // The one-time state: used once, within two hours, then gone.
  const pref = db.collection(PENDING).doc(state);
  const p = await db.runTransaction(async tx => {
    const d = (await tx.get(pref)).data();
    if (!d) return null;
    tx.delete(pref);
    return d as { keystring: string; secret: string; verifier: string; clientId: string; companyId?: string; handlerId?: string; name?: string; importDays?: number; by: string; expireAt: Timestamp };
  });
  if (!p || p.expireAt.toMillis() < Date.now()) { res.status(400).send(page("Link used or expired", "<p>Each approval link works once, for two hours. Make a new one in Settings → Etsy.</p>", false)); return; }
  try {
    const secret = open(p.secret);
    const t = await tokenCall({ grant_type: "authorization_code", client_id: p.keystring, code, code_verifier: open(p.verifier), redirect_uri: callbackUrl() });
    const shop = await shopOfTokens(p.keystring, secret, t.access);
    const storeId = `st_${shop.shopId}`;
    const sref = db.collection(STORES).doc(storeId);
    const prior = (await sref.get()).data() as StoreDoc | undefined;
    const at = new Date().toISOString();
    // Connected again with the same app: its webhook signing secret still holds (a new app has its own).
    const was = prior ? ((await db.collection(VAULT).doc(storeId).get()).data() as Vault | undefined) : undefined;
    const keepHook = was?.keystring === p.keystring ? was?.webhookSecret : undefined;
    const vault: Vault = { keystring: p.keystring, secret: p.secret, access: seal(t.access), refresh: seal(t.refresh), accessExpiresAt: t.expiresAt, webhookSecret: keepHook };
    await db.collection(VAULT).doc(storeId).set(Object.fromEntries(Object.entries(vault).filter(([, v]) => v !== undefined)));
    await sref.set({
      id: storeId, shopId: shop.shopId, name: p.name || shop.name, ...(shop.url ? { url: shop.url } : {}), ...(shop.country ? { country: shop.country } : {}),
      status: "connected", clientId: p.clientId, ...(p.companyId ? { companyId: p.companyId } : {}), ...(p.handlerId ? { handlerId: p.handlerId } : {}),
      rules: prior?.rules ? cleanRules(prior.rules) : cleanRules({}), currency: shop.currency, connectedBy: p.by, webhooks: !!keepHook,
      // Connected again after its approval ran out (or a new app): carries on from where it
      // stopped, so orders placed meanwhile still come in. After a Disconnect it starts afresh
      // (the days back chosen bring in what's wanted).
      ...(prior && prior.status !== "disconnected" && prior.connectedAt
        ? { connectedAt: prior.connectedAt, lastSyncAt: prior.lastSyncAt ?? prior.connectedAt, syncSkip: prior.syncSkip ?? 0 }
        : { connectedAt: at, lastSyncAt: at, syncSkip: 0 }),
      ...(prior ? { reconnectedAt: at } : {}),
    });
    if (prior) await retryShipments(storeId);
    if (p.importDays) await db.collection(INBOX).add({ storeId, kind: "backfill", since: new Date(Date.now() - p.importDays * DAY).toISOString(), at, expireAt: Timestamp.fromMillis(Date.now() + 30 * DAY) });
    res.status(200).send(page("Connected", `<p><b>${esc(p.name || shop.name)}</b> is connected to the order board.</p><p>Its new paid orders come in within a few minutes. You can close this tab.</p>`, true));
  } catch (e) {
    const why = e instanceof Error ? e.message : String(e);
    res.status(400).send(page("Not connected", `<p>${esc(why)}</p><p>Check that the shop's app lists this exact Redirect URI, then make a new link in Settings → Etsy.</p>`, false));
  }
});

/* ─────────────── An admin's shop tools ─────────────── */

interface AdminReq {
  action?: "save" | "preview" | "syncNow" | "importOrder" | "test" | "pause" | "resume" | "disconnect" | "webhookSecret" | "retryShipments";
  storeId?: string; name?: string; clientId?: string; companyId?: string | null; handlerId?: string | null; rules?: unknown;
  receipt?: string; days?: number; webhookSecret?: string;
}

export const etsyAdmin = onCall<AdminReq>({ region: REGION, secrets, memory: "256MiB", maxInstances: 5, timeoutSeconds: 300 }, async req => {
  const uid = await requireAdmin(req.auth as never);
  const storeId = String(req.data?.storeId ?? "");
  const ref = db.collection(STORES).doc(storeId);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError("not-found", "No such shop");
  const store = { ...(snap.data() as StoreDoc), id: storeId };
  const a = req.data?.action;
  try {
    if (a === "save") {
      const clientId = req.data?.clientId ? String(req.data.clientId) : store.clientId;
      if (!(await db.collection("clients").doc(clientId).get()).exists) throw new HttpsError("invalid-argument", "Choose the client this shop's orders are for");
      await ref.update({ name: String(req.data?.name ?? store.name).trim().slice(0, 60) || store.name, clientId,
        companyId: req.data?.companyId ? String(req.data.companyId) : FieldValue.delete(), handlerId: req.data?.handlerId ? String(req.data.handlerId) : FieldValue.delete(),
        rules: cleanRules(req.data?.rules), updatedAt: new Date().toISOString(), updatedBy: uid });
      return { ok: true };
    }
    if (a === "pause" || a === "resume") { await ref.update({ status: a === "pause" ? "paused" : "connected" }); return { ok: true }; }
    if (a === "retryShipments") return { ok: true, count: await retryShipments(storeId) };
    if (a === "disconnect") {
      await db.collection(VAULT).doc(storeId).delete();
      await ref.update({ status: "disconnected", disconnectedAt: new Date().toISOString(), disconnectedBy: uid });
      return { ok: true };
    }
    if (a === "webhookSecret") {
      const w = String(req.data?.webhookSecret ?? "").trim();
      if (w && !/^whsec_[A-Za-z0-9+/=]{16,200}$/.test(w)) throw new HttpsError("invalid-argument", "The signing secret starts with whsec_ (Etsy's webhook portal)");
      await db.collection(VAULT).doc(storeId).update({ webhookSecret: w ? seal(w) : FieldValue.delete() });
      await ref.update({ webhooks: !!w });
      return { ok: true, webhookUrl: fnUrl("etsyWebhook") };
    }
    if (a === "test") {
      const t0 = Date.now();
      const d = await etsy<{ shop_name?: string; currency_code?: string }>(storeId, "GET", `/shops/${store.shopId}`);
      await ref.update({ status: store.status === "error" ? "connected" : store.status, lastError: FieldValue.delete() });
      return { ok: true, ms: Date.now() - t0, name: d.shop_name, currency: d.currency_code };
    }
    if (a === "syncNow") {
      const since = new Date(Date.now() - Math.min(60, Math.max(1, Number(req.data?.days) || 1)) * DAY).toISOString();
      // Checking further back brings in the orders of those days too (as connecting with days back does).
      const r = await syncStore(store, since, false, since);
      // More than one read takes: the rest carries on in the background, in batches.
      if (r.more && r.through) await db.collection(INBOX).add({ storeId, kind: "backfill", since: r.through, skip: r.skip, from: since, at: new Date().toISOString(), expireAt: Timestamp.fromMillis(Date.now() + 30 * DAY) });
      return r;
    }
    if (a === "importOrder" || a === "preview") {
      const num = String(req.data?.receipt ?? "").replace(/^#/, "").trim();
      if (num && !/^\d{1,15}$/.test(num)) throw new HttpsError("invalid-argument", "An Etsy order number, like 1234567890");
      let receiptId = num;
      if (!receiptId) {
        if (a === "importOrder") throw new HttpsError("invalid-argument", "Enter the Etsy order number");
        const latest = await etsy<{ results?: EtsyReceipt[] }>(storeId, "GET", `/shops/${store.shopId}/receipts?limit=1&sort_on=created&sort_order=desc`);
        receiptId = String(latest.results?.[0]?.receipt_id ?? "");
        if (!receiptId) throw new HttpsError("not-found", "No orders on this shop yet");
      }
      if (a === "importOrder") return await processReceipt(storeId, receiptId, { notBefore: null });
      const got = await readReceipt(store, receiptId);
      if (!got) throw new HttpsError("not-found", `No order ${receiptId} on this shop`);
      const rules = req.data?.rules ? cleanRules(req.data.rules) : rulesOf(store.rules);
      const lists = await ourLists();
      const o = got.order;
      return {
        order: { name: o.name, createdAt: o.createdAt, financialStatus: o.financialStatus, currency: o.currency, test: false, cancelled: !!o.cancelledAt },
        problem: importProblem(o, rules, null),
        lines: o.lines.map(l => ({ title: l.title, variant: l.variantTitle, sku: l.sku, options: l.options, image: l.image, mapped: mapLine(l, o, rules, lists.types, lists.metals, lists.noKarat) })),
      };
    }
    throw new HttpsError("invalid-argument", "Unknown action");
  } catch (e) {
    if (e instanceof EtsyError && e.code === "revoked") await ref.update({ status: "error", lastError: e.message });
    return fail(e);
  }
});

/* ─────────────── Etsy's messages ─────────────── */

export const etsyWebhook = onRequest({ region: REGION, secrets, memory: "256MiB", maxInstances: 10, timeoutSeconds: 10, invoker: "public" }, async (req, res) => {
  if (req.method !== "POST") { res.status(405).end(); return; }
  let body: { event_type?: string; resource_url?: string; shop_id?: number | string } = {};
  try { body = JSON.parse(req.rawBody.toString("utf8")); } catch { res.status(400).end(); return; }
  const shopId = String(body.shop_id ?? "");
  if (!/^\d{1,15}$/.test(shopId)) { res.status(401).end(); return; }
  const storeId = `st_${shopId}`;
  const v = (await db.collection(VAULT).doc(storeId).get()).data() as Vault | undefined;
  const store = (await db.collection(STORES).doc(storeId).get()).data() as StoreDoc | undefined;
  if (!v?.webhookSecret || !store || store.status === "disconnected") { res.status(401).end(); return; }
  const hid = String(req.get("webhook-id") ?? "");
  if (!etsySigned(req.rawBody, { id: hid, timestamp: req.get("webhook-timestamp"), signature: req.get("webhook-signature") }, open(v.webhookSecret))) { res.status(401).end(); return; }
  const receiptId = receiptOfResource(body.resource_url, shopId);
  try {
    // Kept once (per shop): a delivery Etsy sends again finds its own record and stops here.
    await db.collection(INBOX).doc(`${storeId}_${hid}`.replace(/[/\s]/g, "_").slice(0, 200)).create({
      storeId, kind: String(body.event_type ?? "order"), receiptId, at: new Date().toISOString(), expireAt: Timestamp.fromMillis(Date.now() + 30 * DAY),
    });
  } catch (e) {
    if ((e as { code?: number }).code !== 6) { console.error("[etsy] inbox:", e); res.status(500).end(); return; }
  }
  res.status(200).send("ok");
});

export const etsyInboxRun = onDocumentCreated({ document: `${INBOX}/{id}`, database: DATABASE, region: REGION, secrets, memory: "256MiB", maxInstances: 5, timeoutSeconds: 300, retry: false }, async ev => {
  const m = ev.data?.data() as { storeId: string; kind: string; receiptId?: string | null; since?: string; from?: string; skip?: number } | undefined;
  if (!m) return;
  const ref = ev.data!.ref;
  try {
    if (m.kind === "backfill" && m.since) {
      const s = (await db.collection(STORES).doc(m.storeId).get()).data() as StoreDoc | undefined;
      const from = m.from ?? m.since;
      if (s) {
        // In batches of 60 (well inside the 5 minutes a run has), each starting where the last stopped.
        const r = await syncStore({ ...s, id: m.storeId }, m.since, false, from, m.skip ?? 0, 60);
        if (r.more && r.through) await db.collection(INBOX).add({ storeId: m.storeId, kind: "backfill", since: r.through, skip: r.skip, from, at: new Date().toISOString(), expireAt: Timestamp.fromMillis(Date.now() + 30 * DAY) });
      }
    } else if (m.receiptId) {
      await processReceipt(m.storeId, m.receiptId);
    }
    await ref.update({ doneAt: new Date().toISOString() });
  } catch (e) {
    await ref.update({ error: (e as Error).message?.slice(0, 500) ?? String(e) }).catch(() => undefined);
    await db.collection(STORES).doc(m.storeId).update({ lastError: (e as Error).message?.slice(0, 300) }).catch(() => undefined);
  }
});

/* ─────────────── The 5-minute check ─────────────── */

type Synced = { checked: number; created: string[]; more: boolean; through?: string; skip: number; failed: string[] };
const sec = (iso: string) => Math.floor(Date.parse(iso) / 1000);

/**
 * The shop's orders changed since `since` (past `skip` of those changed at exactly
 * that second), up to `max`. When there were more, `through` + `skip` say where the
 * next read starts — exactly there, never stepping back, so a burst of changes
 * (a bulk label run) can't hold the check in place.
 */
async function syncStore(store: StoreDoc, since: string, moveCursor = true, notBefore?: string, skip = 0, max = 200): Promise<Synced> {
  const changed = await changedSince(store, since, max, skip);
  const created: string[] = [], failed: string[] = [];
  for (const c of changed) {
    try { created.push(...(await processReceipt(store.id, c.id, notBefore ? { notBefore } : {})).created); }
    catch (e) {
      if (e instanceof EtsyError && e.code === "revoked") throw e;
      failed.push(`${c.id}: ${(e as Error).message?.slice(0, 120)}`);
    }
  }
  const more = changed.length >= max;
  const through = changed.length ? changed[changed.length - 1].updatedAt : undefined;
  const atEnd = through ? changed.filter(c => sec(c.updatedAt) === sec(through)).length : 0;
  const nextSkip = more && through ? (sec(through) === sec(since) ? skip : 0) + atEnd : 0;
  if (moveCursor) await db.collection(STORES).doc(store.id).update({
    lastSyncAt: more && through ? through : new Date(Date.now() - 60_000).toISOString(), syncSkip: nextSkip, lastSyncCount: changed.length,
    lastError: failed.length ? `Couldn't bring in ${failed.length} order${failed.length !== 1 ? "s" : ""}: ${failed.slice(0, 3).join("; ")}` : FieldValue.delete(),
  });
  return { checked: changed.length, created, more, through, skip: nextSkip, failed };
}

/** The shop's shipments that didn't go (Etsy said no, or the shop needed connecting again): tried again now. */
async function retryShipments(storeId: string): Promise<number> {
  const stuck = await db.collection(JOBS).where("storeId", "==", storeId).where("status", "in", ["failed", "retry"]).get();
  for (const j of stuck.docs) await j.ref.update({ status: "pending", attempts: 0, at: new Date().toISOString() });
  return stuck.size;
}

export const etsySync = onSchedule({ schedule: "every 5 minutes", region: REGION, secrets, memory: "256MiB", timeoutSeconds: 270, retryCount: 0 }, async () => {
  const stores = await db.collection(STORES).where("status", "in", ["connected", "error"]).get();
  for (const d of stores.docs) {
    const s = { ...(d.data() as StoreDoc), id: d.id };
    try {
      // Ten minutes back for anything Etsy saved late — unless the last check stopped part-way (it carries on exactly there).
      const from = s.lastSyncAt ?? s.connectedAt ?? new Date().toISOString();
      const since = s.syncSkip ? from : new Date(Date.parse(from) - 10 * 60_000).toISOString();
      await syncStore(s, since, true, undefined, s.syncSkip ?? 0);
      if (s.status === "error") await d.ref.update({ status: "connected" });
      // A dispatch whose news never reached the server: queued now.
      const shipped = await db.collection("orders").where("etsy.storeId", "==", s.id).where("dispatchedAt", ">=", new Date(Date.now() - 3 * DAY).toISOString()).select("etsy").get();
      for (const o of shipped.docs) {
        const rid = o.data().etsy?.receiptId;
        if (rid) await db.collection(JOBS).doc(`ship_${s.id}_${rid}`).create({ kind: "ship", storeId: s.id, receiptId: rid, orderId: o.id, status: "pending", attempts: 0, at: new Date().toISOString() }).catch(() => undefined);
      }
    } catch (e) {
      const revoked = e instanceof EtsyError && e.code === "revoked";
      await d.ref.update({ ...(revoked ? { status: "error" } : {}), lastError: (e as Error).message?.slice(0, 300) ?? String(e) }).catch(() => undefined);
    }
  }
  const due = await db.collection(JOBS).where("status", "==", "retry").where("nextAt", "<=", new Date().toISOString()).limit(100).get();
  for (const j of due.docs) await j.ref.update({ status: "pending" });
  // An Etsy order waiting for its other pieces: sent once every one of them is dispatched
  // (also when the last dispatch landed while the job was already running).
  const waiting = await db.collection(JOBS).where("status", "==", "waiting").limit(1000).get();
  for (const j of waiting.docs) {
    const { storeId, receiptId } = j.data() as { storeId: string; receiptId: string };
    const ours = (await db.collection("orders").where("etsy.receiptId", "==", receiptId).select("etsy", "status", "deletedAt").get()).docs
      .map(d => d.data()).filter(o => o.etsy?.storeId === storeId && !o.deletedAt && o.status !== "Rejected");
    if (ours.length && ours.every(o => o.status === "Dispatched" || o.status === "Delivered")) await j.ref.update({ status: "pending", at: new Date().toISOString() });
  }
});

/* ─────────────── Our shipment, back to Etsy ─────────────── */

type OrderLike = { status?: string; clientId?: string; etsy?: { storeId: string; receiptId: string; transactionId: string } };

export const etsyOnOrder = onDocumentUpdated({ document: "orders/{id}", database: DATABASE, region: REGION, memory: "256MiB", maxInstances: 5, retry: false }, async ev => {
  const before = ev.data?.before.data() as OrderLike | undefined, after = ev.data?.after.data() as OrderLike | undefined;
  if (!after?.etsy) return;
  const shipped = (o?: OrderLike) => o?.status === "Dispatched" || o?.status === "Delivered";
  if (shipped(before) || !shipped(after)) return;
  const ref = db.collection(JOBS).doc(`ship_${after.etsy.storeId}_${after.etsy.receiptId}`);
  await db.runTransaction(async tx => {
    const j = (await tx.get(ref)).data() as { status?: string } | undefined;
    // Waiting for the other pieces of this Etsy order: one more is dispatched — look again.
    if (!j) tx.create(ref, { kind: "ship", storeId: after.etsy!.storeId, receiptId: after.etsy!.receiptId, orderId: ev.params.id, status: "pending", attempts: 0, at: new Date().toISOString() });
    else if (j.status === "waiting") tx.update(ref, { status: "pending", orderId: ev.params.id, at: new Date().toISOString() });
  });
});

export const etsyJobRun = onDocumentWritten({ document: `${JOBS}/{id}`, database: DATABASE, region: REGION, secrets, memory: "256MiB", maxInstances: 5, timeoutSeconds: 120, retry: false }, async ev => {
  const j = ev.data?.after.data() as { kind: string; storeId: string; receiptId: string; orderId: string; status: string; attempts?: number } | undefined;
  const was = ev.data?.before.data() as { status?: string } | undefined;
  if (!j || j.status !== "pending" || was?.status === "pending") return;
  const ref = ev.data!.after.ref;
  const done = (status: string, result: string) => ref.update({ status, result, doneAt: new Date().toISOString(), error: FieldValue.delete() });
  const store = (await db.collection(STORES).doc(j.storeId).get()).data() as StoreDoc | undefined;
  const order = (await db.collection("orders").doc(j.orderId).get()).data() as OrderLike | undefined;
  if (!store || store.status === "disconnected" || !order?.etsy) { await done("skipped", "No such shop or order"); return; }
  // Only an order the server itself brought in from THIS shop (only the server, or an
  // admin, can write `etsy` on an order — firestore.rules). Not tied to the shop's client
  // of today: moving the shop to another client must not leave earlier orders unshipped.
  if (j.orderId !== ourOrderId(j.storeId, order.etsy.transactionId) || order.etsy.storeId !== j.storeId || order.etsy.receiptId !== j.receiptId) {
    await done("skipped", "Not this shop's order"); return;
  }
  if (store.status === "paused") { await ref.update({ status: "retry", nextAt: new Date(Date.now() + 30 * 60_000).toISOString(), error: "The shop is paused — sent when it is resumed" }); return; }
  try {
    const r = await shipReceipt({ ...store, id: j.storeId }, j.receiptId, true);
    if (r === "waiting") { await ref.update({ status: "waiting", result: "Waiting for the other pieces of this Etsy order to be dispatched", error: FieldValue.delete() }); return; }
    if (r === "shipped") await db.collection(MIRROR).doc(`${j.storeId}_${j.receiptId}`).set({ shippedByUs: new Date().toISOString() }, { merge: true });
    await done("done", r);
  } catch (e) {
    const attempts = (j.attempts ?? 0) + 1;
    // Only Etsy's own "this app may not" is final at once; anything else (the shop's approval
    // ran out, Etsy busy, a refused detail) is tried again — 12 times over about two days —
    // and an admin's Retry, or connecting the shop again, starts it over.
    const final = e instanceof EtsyError && e.code === "partner_only";
    const wait = Math.min(6 * 60, 2 ** attempts) * 60_000;
    await ref.update({ status: final || attempts >= 12 ? "failed" : "retry", attempts, nextAt: new Date(Date.now() + wait).toISOString(), error: (e as Error).message?.slice(0, 500) ?? String(e) });
  }
});
