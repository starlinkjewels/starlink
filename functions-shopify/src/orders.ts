// A Shopify order brought in, and our work sent back.
//
// In: the order is always read from Shopify itself (a message only says which
// order changed). Each of its lines still to be made becomes ONE of our orders
// (orders/shp_{storeId}_{lineId} — the store's id comes from its address, so
// connecting it again never brings a line in twice), at the first stage
// (Waiting, for approval). The order and its number are made in one
// transaction: a line can never come in twice, and no number is lost or reused.
// Only orders placed since the store was connected come in (or since the days
// asked for, or one asked for by its number).
// After that our order is ours: the server never writes to it again (devices
// save orders whole). What changes on Shopify — cancelled, edited — is kept on
// shopifyOrders (admins) and shown on our order for staff to act on.
//
// Out: our dispatch fulfils that line on Shopify with the tracking (what is left
// to fulfil is read first, so a retry never fulfils twice); a corrected tracking
// number updates it; our stage is shown as a tag. Nothing on Shopify is ever
// cancelled, refunded or deleted from here.
import { randomBytes } from "crypto";
import { db, gql, ShopifyError } from "./shopify";
import {
  importProblem, legacyOf, mapLine, newOrderSteps, rulesOf, shopifyCarrier, stageTag, STAGE_STATUSES, yearNow,
  type ShopLine, type ShopOrder, type StoreRules,
} from "./logic";

export const STORES = "shopifyStores";
export const MIRROR = "shopifyOrders";
export const JOBS = "shopifyJobs";

export interface StoreDoc {
  id: string;
  shop: string;
  name: string;
  status: "connected" | "paused" | "disconnected" | "error";
  clientId: string;          // OUR client this store's orders are for
  companyId?: string;
  handlerId?: string;        // who has its orders (else the client's account manager)
  rules?: StoreRules;
  currency?: string;
  connectedAt?: string;
  lastSyncAt?: string;
  lastEventAt?: string;
  lastError?: string;
}

/* ─────────────── Reading an order from Shopify ─────────────── */

const ORDER_FIELDS = `
  id legacyResourceId name createdAt updatedAt test cancelledAt
  displayFinancialStatus displayFulfillmentStatus note tags currencyCode
  customer { displayName }
  shippingAddress { name company address1 address2 city province zip country phone }
  lineItems(first: 100) { nodes {
    id title variantTitle sku quantity currentQuantity unfulfilledQuantity
    customAttributes { key value }
    originalUnitPriceSet { shopMoney { amount } }
    image { url }
    variant { selectedOptions { name value } image { url } }
    product { productType tags }
  } }`;

type GqlOrder = {
  id: string; legacyResourceId: string; name: string; createdAt: string; updatedAt: string; test: boolean; cancelledAt?: string | null;
  displayFinancialStatus?: string | null; displayFulfillmentStatus?: string | null; note?: string | null; tags?: string[]; currencyCode: string;
  customer?: { displayName?: string | null } | null;
  shippingAddress?: ShopOrder["shipTo"];
  lineItems: { nodes: {
    id: string; title: string; variantTitle?: string | null; sku?: string | null; quantity: number; currentQuantity?: number | null; unfulfilledQuantity?: number | null;
    customAttributes?: { key: string; value?: string | null }[]; originalUnitPriceSet?: { shopMoney?: { amount?: string } } | null;
    image?: { url?: string } | null; variant?: { selectedOptions?: { name: string; value: string }[]; image?: { url?: string } | null } | null;
    product?: { productType?: string | null; tags?: string[] } | null;
  }[] };
};

export function toShopOrder(o: GqlOrder): ShopOrder {
  return {
    id: o.id, legacyId: String(o.legacyResourceId ?? legacyOf(o.id)), name: o.name, createdAt: o.createdAt, updatedAt: o.updatedAt,
    test: !!o.test, cancelledAt: o.cancelledAt ?? null, financialStatus: o.displayFinancialStatus ?? null,
    fulfillmentStatus: o.displayFulfillmentStatus ?? null, note: o.note ?? null, tags: o.tags ?? [], currency: o.currencyCode,
    customer: o.customer ? { name: o.customer.displayName ?? null } : null,
    shipTo: o.shippingAddress ?? null,
    lines: (o.lineItems?.nodes ?? []).map((l): ShopLine => ({
      id: l.id, title: l.title, variantTitle: l.variantTitle ?? null, sku: l.sku ?? null, quantity: l.quantity,
      currentQuantity: typeof l.currentQuantity === "number" ? l.currentQuantity : l.quantity,
      ...(typeof l.unfulfilledQuantity === "number" ? { unfulfilled: l.unfulfilledQuantity } : {}),
      options: l.variant?.selectedOptions ?? [], properties: (l.customAttributes ?? []).map(a => ({ key: a.key, value: a.value ?? "" })),
      unitPrice: l.originalUnitPriceSet?.shopMoney?.amount ? Number(l.originalUnitPriceSet.shopMoney.amount) : undefined,
      image: l.image?.url ?? l.variant?.image?.url ?? null, productType: l.product?.productType ?? null, productTags: l.product?.tags ?? [],
    })),
  };
}

export async function readOrder(storeId: string, gid: string): Promise<ShopOrder | null> {
  const d = await gql<{ order: GqlOrder | null }>(storeId, `query Order($id: ID!) { order(id: $id) { ${ORDER_FIELDS} } }`, { id: gid });
  return d.order ? toShopOrder(d.order) : null;
}

/** The orders changed since a time, oldest change first — for the check that catches anything a message missed. */
export async function changedSince(storeId: string, sinceIso: string, max = 250): Promise<{ id: string; updatedAt: string }[]> {
  const out: { id: string; updatedAt: string }[] = [];
  let after: string | null = null;
  for (let page = 0; page < 10 && out.length < max; page++) {
    const d: { orders: { nodes: { id: string; updatedAt: string }[]; pageInfo: { hasNextPage: boolean; endCursor: string | null } } } = await gql(storeId,
      `query Changed($q: String!, $after: String) { orders(first: 50, after: $after, query: $q, sortKey: UPDATED_AT) { nodes { id updatedAt } pageInfo { hasNextPage endCursor } } }`,
      { q: `updated_at:>'${sinceIso}'`, after });
    out.push(...d.orders.nodes);
    if (!d.orders.pageInfo.hasNextPage) break;
    after = d.orders.pageInfo.endCursor;
  }
  return out.slice(0, max).sort((a, b) => (a.updatedAt ?? "").localeCompare(b.updatedAt ?? ""));
}

/* ─────────────── Our side: the business's lists and stages ─────────────── */

const DEFAULT_TYPES = ["Ring", "Ring + Band", "Pendant", "Necklace", "Bracelet", "Earrings", "Custom"];
const DEFAULT_METALS = ["Yellow Gold", "White Gold (Palladium Alloy)", "White Gold (Silver Alloy)", "Rose Gold", "Platinum", "Silver", "Titanium"];
const DEFAULT_NO_KARAT = ["Platinum", "Silver", "Titanium"];

export interface OurLists { types: string[]; metals: string[]; noKarat: string[]; timelineStages?: unknown }
export async function ourLists(): Promise<OurLists> {
  const s = (await db.collection("meta").doc("settings").get()).data() ?? {};
  const own = (k: string, dflt: string[]) => (Array.isArray(s.optionLists?.[k]) && s.optionLists[k].length ? s.optionLists[k] : dflt) as string[];
  return { types: own("jewelleryTypes", DEFAULT_TYPES), metals: own("metals", DEFAULT_METALS),
    noKarat: Array.isArray(s.metalsWithoutKarats) ? s.metalsWithoutKarats : DEFAULT_NO_KARAT, timelineStages: s.timelineStages };
}

const ymd = (t: number) => new Date(t).toISOString().slice(0, 10);
export const ourOrderId = (storeId: string, lineGid: string) => `shp_${storeId}_${legacyOf(lineGid)}`;
export const mirrorId = (storeId: string, orderGid: string) => `${storeId}_${legacyOf(orderGid)}`;

/**
 * The lowest number still safe to hand out: one past the highest on the latest
 * orders — the floor the app's own reserve applies (src/lib/counters.ts), so a
 * counter set back by an admin's repair never re-issues a number in use.
 */
async function numberFloor(): Promise<number> {
  const snap = await db.collection("orders").orderBy("orderNumber", "desc").limit(30).select("orderNumber").get();
  const suffix = (v: unknown) => parseInt(String(v ?? "").split("-").pop() ?? "", 10);
  return Math.max(1001, ...snap.docs.map(d => suffix(d.data().orderNumber)).filter(n => Number.isFinite(n)).map(n => n + 1));
}

/** The next order number, claimed in this transaction — the app's series (src/lib/counters.ts reserveOrderNumber). */
async function claimNumber(tx: FirebaseFirestore.Transaction, floor: number): Promise<string> {
  const ref = db.collection("counters").doc("orderNumber");
  const snap = await tx.get(ref);
  const stored = Number(snap.data()?.next);
  const next = Math.max(Number.isFinite(stored) ? stored : 0, floor);
  tx.set(ref, { next: next + 1, updatedAt: new Date().toISOString() }, { merge: true });
  return `SLJ-${yearNow()}-${String(next).padStart(4, "0")}`;
}

/** Alerts for every active admin and these people. */
async function tell(userIds: (string | undefined)[], title: string, body: string): Promise<void> {
  const admins = await db.collection("users").where("role", "==", "admin").get();
  const ids = new Set<string>([...admins.docs.filter(u => u.data().status !== "inactive").map(u => u.id), ...userIds.filter((x): x is string => !!x)]);
  const batch = db.batch();
  const at = new Date().toISOString();
  for (const id of ids) {
    const nid = `n_shp_${randomBytes(6).toString("hex")}`;
    batch.set(db.collection("notifications").doc(nid), { id: nid, userId: id, title, body, type: "order", read: false, createdAt: at });
  }
  await batch.commit();
}

/* ─────────────── Bringing an order in ─────────────── */

export interface Processed { created: string[]; skipped?: string; issues: string[] }

/** What our team should know about a Shopify order we brought in, as it is now. */
function issuesOf(o: ShopOrder, lineOrders: Map<string, string>): string[] {
  const out: string[] = [];
  if (o.cancelledAt && lineOrders.size) out.push(`Cancelled on Shopify ${o.cancelledAt.slice(0, 10)} — check our order before making more`);
  for (const l of o.lines) if (lineOrders.has(l.id) && l.currentQuantity === 0) out.push(`“${l.title}” was taken off the order on Shopify`);
  return out;
}

const shipOf = (a: ShopOrder["shipTo"]) => a ? Object.fromEntries(Object.entries(a).filter(([, v]) => v !== null && v !== undefined && v !== "")) : undefined;

/**
 * Bring one Shopify order in (or bring its changes up to date). Safe to run any
 * number of times for the same order: a line already on our board is left as it is.
 * `notBefore`: older orders stay out (default: when the store was connected); null: none.
 */
export async function processOrder(storeId: string, gid: string, opts: { notBefore?: string | null } = {}): Promise<Processed> {
  const storeSnap = await db.collection(STORES).doc(storeId).get();
  const store = storeSnap.exists ? ({ ...(storeSnap.data() as StoreDoc), id: storeId }) : null;
  if (!store || store.status === "disconnected") return { created: [], skipped: "Store not connected", issues: [] };
  const o = await readOrder(storeId, gid);
  if (!o) return { created: [], skipped: "Not found on Shopify", issues: [] };
  const rules = rulesOf(store.rules);
  const mref = db.collection(MIRROR).doc(mirrorId(storeId, o.id));
  const prev = (await mref.get()).data() as { lines?: { id: string; orderId?: string }[]; cancelNoticed?: boolean } | undefined;
  const lists = await ourLists();
  const client = store.clientId ? (await db.collection("clients").doc(store.clientId).get()).data() : undefined;
  const problem = importProblem(o, rules, opts.notBefore === undefined ? store.connectedAt ?? null : opts.notBefore);
  const created: string[] = [];
  const lineOrders = new Map<string, string>((prev?.lines ?? []).filter(l => l.orderId).map(l => [l.id, l.orderId!]));
  // Lines brought in before (by an earlier run of this, or a message at the same moment).
  for (const l of o.lines) {
    if (lineOrders.has(l.id)) continue;
    if ((await db.collection("orders").doc(ourOrderId(storeId, l.id)).get()).exists) lineOrders.set(l.id, ourOrderId(storeId, l.id));
  }

  if (!problem && store.status === "connected" && client) {
    let floor: number | null = null;
    for (const l of o.lines) {
      // Nothing left to make: taken off the order, or shipped already on Shopify.
      if (l.currentQuantity <= 0 || l.unfulfilled === 0) continue;
      if (lineOrders.has(l.id)) continue;
      const id = ourOrderId(storeId, l.id);
      const m = mapLine(l, o, rules, lists.types, lists.metals, lists.noKarat);
      const at = new Date().toISOString();
      const steps = newOrderSteps(lists.timelineStages, false);
      const handler = store.handlerId || client.accountManagerId || undefined;
      floor ??= await numberFloor();
      const shipTo = shipOf(o.shipTo);
      const made = await db.runTransaction(async tx => {
        const ref = db.collection("orders").doc(id);
        if ((await tx.get(ref)).exists) return null; // brought in already (another message, the check)
        const orderNumber = await claimNumber(tx, floor!);
        const doc: Record<string, unknown> = {
          id, orderNumber, clientId: store.clientId,
          ...(store.companyId && store.companyId !== "main" ? { companyId: store.companyId } : {}),
          ...(handler ? { assignedEmployeeId: handler } : {}),
          contactPerson: `Shopify ${o.name}${o.customer?.name ? ` · ${o.customer.name}` : ""}`,
          jewelleryType: m.jewelleryType, metal: m.metal, diamondType: m.diamondType,
          quantity: Math.max(1, Math.min(m.quantity, l.unfulfilled ?? m.quantity)), diamondWeight: 0, metalWeight: 0,
          images: l.image ? [l.image] : [],
          ...(m.designNumber ? { designNumber: m.designNumber } : {}),
          ...(m.productSize ? { productSize: m.productSize } : {}),
          ...(m.productColor ? { productColor: m.productColor } : {}),
          ...(m.productKarats ? { productKarats: m.productKarats } : {}),
          certificate: false, certificateFee: 0,
          instructions: m.instructions,
          expectedDelivery: ymd(Date.now() + rules.leadDays * 86_400_000),
          priority: o.tags.some(t => /rush|urgent/i.test(t)) ? "High Priority" : "Normal",
          status: "Waiting", amount: m.amount, shippingCharge: 0, advances: [],
          timeline: steps.map((s, i) => ({ step: s, status: i === 0 ? "done" : "pending", ...(i === 0 ? { date: at } : {}) })),
          createdAt: at,
          shopify: {
            storeId, shop: store.shop, storeName: store.name, orderId: o.legacyId, orderGid: o.id, orderName: o.name,
            lineId: legacyOf(l.id), lineGid: l.id, title: l.title, ...(l.variantTitle ? { variant: l.variantTitle } : {}),
            ...(l.sku ? { sku: l.sku } : {}), ...(typeof l.unitPrice === "number" ? { unitPrice: l.unitPrice } : {}), currency: o.currency,
            ...(m.review.length ? { review: m.review } : {}), importedAt: at,
            // Where it ships, as Shopify had it when it came in — on the order, so whoever handles it sees it.
            ...(shipTo ? { shipTo } : {}), ...(o.customer?.name ? { customer: o.customer.name } : {}),
          },
        };
        tx.create(ref, doc);
        return orderNumber;
      });
      lineOrders.set(l.id, id);
      if (made) created.push(made);
    }
  }

  // What Shopify says now — never put back by an older read that finished later.
  const issues = issuesOf(o, lineOrders);
  const imported = lineOrders.size > 0;
  let noticeCancel = false;
  await db.runTransaction(async tx => {
    const cur = (await tx.get(mref)).data() as { updatedAt?: string; lines?: { id: string; orderId?: string }[]; cancelNoticed?: boolean } | undefined;
    for (const l of cur?.lines ?? []) if (l.orderId && !lineOrders.has(l.id)) lineOrders.set(l.id, l.orderId);
    const lines = o.lines.map(l => ({ id: l.id, title: l.title, variant: l.variantTitle ?? null, sku: l.sku ?? null, quantity: l.quantity,
      currentQuantity: l.currentQuantity, unitPrice: l.unitPrice ?? null, image: l.image ?? null, ...(lineOrders.get(l.id) ? { orderId: lineOrders.get(l.id) } : {}) }));
    if (cur?.updatedAt && cur.updatedAt > o.updatedAt) {
      // A newer copy is there: only the lines we brought in are added to it.
      tx.set(mref, { lines: (cur.lines ?? []).map(l => ({ ...l, ...(lineOrders.get(l.id) ? { orderId: lineOrders.get(l.id) } : {}) })) }, { merge: true });
      return;
    }
    noticeCancel = !!o.cancelledAt && imported && !cur?.cancelNoticed;
    tx.set(mref, {
      storeId, shop: store.shop, storeName: store.name, orderId: o.legacyId, orderGid: o.id, name: o.name,
      createdAt: o.createdAt, updatedAt: o.updatedAt, test: o.test, cancelledAt: o.cancelledAt ?? null,
      financialStatus: o.financialStatus ?? null, fulfillmentStatus: o.fulfillmentStatus ?? null, currency: o.currency,
      note: o.note ?? null, tags: o.tags,
      // The customer and where it ships: kept only for an order we brought in.
      customer: imported ? o.customer ?? null : null, shipTo: imported ? o.shipTo ?? null : null,
      lines, skipped: problem && !imported ? problem : null, issues, syncedAt: new Date().toISOString(),
      ...(noticeCancel ? { cancelNoticed: true } : {}),
    }, { merge: true });
  });

  if (created.length) {
    await tell([store.handlerId, client?.accountManagerId], `New Shopify order ${o.name}`,
      `${store.name}: ${created.length} piece${created.length !== 1 ? "s" : ""} on our board — ${created.join(", ")}. Waiting for approval.`);
  }
  if (noticeCancel) {
    await tell([store.handlerId, client?.accountManagerId], `Shopify order ${o.name} cancelled`,
      `${store.name} cancelled ${o.name} on Shopify. Our orders for it are unchanged — check them before making more.`);
  }
  await db.collection(STORES).doc(storeId).update({ lastEventAt: new Date().toISOString() }).catch(() => undefined);
  return { created, skipped: problem ?? undefined, issues };
}

/* ─────────────── Sending our work back ─────────────── */

type FO = { id: string; status: string; lineItems: { nodes: { id: string; remainingQuantity: number; lineItem: { id: string } }[] } };

/** Tracking as Shopify takes it: a number, the carrier as Shopify spells it, and a link only when it is a web address. */
function trackingOf(track: { company?: string; number?: string; url?: string }) {
  const number = track.number?.trim();
  if (!number) return undefined;
  const company = shopifyCarrier(track.company);
  const url = track.url && /^https?:\/\/[^\s]+$/i.test(track.url.trim()) ? track.url.trim() : undefined;
  return { number, ...(company ? { company } : {}), ...(url ? { url } : {}) };
}

/**
 * Our order was dispatched: fulfil its line on Shopify with the tracking.
 * Read first — what is left to fulfil — so running it again never fulfils twice.
 */
export async function fulfilLine(storeId: string, orderGid: string, lineGid: string, qty: number,
  track: { company?: string; number?: string; url?: string }, notify: boolean): Promise<{ result: "fulfilled" | "already"; fulfillmentIds: string[] }> {
  const d = await gql<{ order: { fulfillmentOrders: { nodes: FO[] } } | null }>(storeId,
    `query FO($id: ID!) { order(id: $id) { fulfillmentOrders(first: 20) { nodes { id status lineItems(first: 100) { nodes { id remainingQuantity lineItem { id } } } } } } }`,
    { id: orderGid });
  const all = d.order?.fulfillmentOrders.nodes ?? [];
  const has = (f: FO) => f.lineItems.nodes.some(n => n.lineItem.id === lineGid && n.remainingQuantity > 0);
  // Held or not yet due on Shopify: tried again later, never forced.
  const held = all.filter(f => has(f) && (f.status === "ON_HOLD" || f.status === "SCHEDULED"));
  const fos = all.filter(f => f.status === "OPEN" || f.status === "IN_PROGRESS");
  const parts: { fulfillmentOrderId: string; fulfillmentOrderLineItems: { id: string; quantity: number }[] }[] = [];
  let want = qty;
  for (const f of fos) {
    const items = f.lineItems.nodes.filter(n => n.lineItem.id === lineGid && n.remainingQuantity > 0);
    const lineItems = items.map(n => { const q = Math.min(n.remainingQuantity, want); want -= q; return { id: n.id, quantity: q }; }).filter(x => x.quantity > 0);
    if (lineItems.length) parts.push({ fulfillmentOrderId: f.id, fulfillmentOrderLineItems: lineItems });
    if (want <= 0) break;
  }
  if (!parts.length) {
    if (held.length) throw new ShopifyError(`On hold in Shopify (${held.map(f => f.status.toLowerCase()).join(", ")}) — sent once it is released`);
    return { result: "already", fulfillmentIds: [] };
  }
  const trackingInfo = trackingOf(track);
  const ids: string[] = [];
  // One fulfilment per fulfilment order (Shopify wants them from one location each).
  for (const p of parts) {
    const r = await gql<{ fulfillmentCreate: { fulfillment: { id: string } | null; userErrors: { message: string }[] } }>(storeId,
      `mutation Fulfil($f: FulfillmentInput!) { fulfillmentCreate(fulfillment: $f) { fulfillment { id } userErrors { message } } }`,
      { f: { lineItemsByFulfillmentOrder: [p], notifyCustomer: notify, ...(trackingInfo ? { trackingInfo } : {}) } });
    if (r.fulfillmentCreate.userErrors.length) throw new ShopifyError(r.fulfillmentCreate.userErrors.map(e => e.message).join("; "));
    if (r.fulfillmentCreate.fulfillment?.id) ids.push(r.fulfillmentCreate.fulfillment.id);
  }
  return { result: "fulfilled", fulfillmentIds: ids };
}

/** The tracking on fulfilments we made, corrected (a new number or carrier after dispatch). */
export async function updateTracking(storeId: string, fulfillmentIds: string[], track: { company?: string; number?: string; url?: string }, notify: boolean): Promise<void> {
  const trackingInfo = trackingOf(track);
  if (!trackingInfo) return;
  for (const id of fulfillmentIds) {
    const r = await gql<{ fulfillmentTrackingInfoUpdate: { userErrors: { message: string }[] } }>(storeId,
      `mutation Track($id: ID!, $t: FulfillmentTrackingInput!, $n: Boolean) { fulfillmentTrackingInfoUpdate(fulfillmentId: $id, trackingInfoInput: $t, notifyCustomer: $n) { userErrors { message } } }`,
      { id, t: trackingInfo, n: notify });
    if (r.fulfillmentTrackingInfoUpdate.userErrors.length) throw new ShopifyError(r.fulfillmentTrackingInfoUpdate.userErrors.map(e => e.message).join("; "));
  }
}

/** Our stage as a tag on the Shopify order — the old stage's tag taken off. */
export async function tagStage(storeId: string, orderGid: string, prefix: string, status: string): Promise<void> {
  const others = STAGE_STATUSES.filter(s => s !== status).map(s => stageTag(prefix, s));
  await gql(storeId, `mutation Off($id: ID!, $tags: [String!]!) { tagsRemove(id: $id, tags: $tags) { userErrors { message } } }`, { id: orderGid, tags: others });
  await gql(storeId, `mutation On($id: ID!, $tags: [String!]!) { tagsAdd(id: $id, tags: $tags) { userErrors { message } } }`, { id: orderGid, tags: [stageTag(prefix, status)] });
}

/* ─────────────── The store's messages ─────────────── */

export const TOPICS = ["ORDERS_CREATE", "ORDERS_UPDATED", "ORDERS_CANCELLED", "ORDERS_EDITED", "APP_UNINSTALLED"] as const;

/** Make sure the store sends us its order messages — added again when Shopify dropped one (it does after 8 failures). */
export async function ensureWebhooks(storeId: string, callbackUrl: string): Promise<string[]> {
  const have = await gql<{ webhookSubscriptions: { nodes: { id: string; topic: string; uri?: string | null }[] } }>(storeId,
    `query { webhookSubscriptions(first: 50) { nodes { id topic uri } } }`);
  const mine = have.webhookSubscriptions.nodes.filter(n => n.uri === callbackUrl);
  const added: string[] = [];
  for (const topic of TOPICS) {
    if (mine.some(n => n.topic === topic)) continue;
    const r = await gql<{ webhookSubscriptionCreate: { webhookSubscription: { id: string } | null; userErrors: { message: string }[] } }>(storeId,
      `mutation Add($topic: WebhookSubscriptionTopic!, $sub: WebhookSubscriptionInput!) { webhookSubscriptionCreate(topic: $topic, webhookSubscription: $sub) { webhookSubscription { id } userErrors { message } } }`,
      { topic, sub: { uri: callbackUrl } });
    if (r.webhookSubscriptionCreate.userErrors.length) throw new ShopifyError(`${topic}: ${r.webhookSubscriptionCreate.userErrors.map(e => e.message).join("; ")}`);
    added.push(topic);
  }
  return added;
}

/** Take our messages off the store (disconnecting). */
export async function dropWebhooks(storeId: string, callbackUrl: string): Promise<void> {
  const have = await gql<{ webhookSubscriptions: { nodes: { id: string; uri?: string | null }[] } }>(storeId, `query { webhookSubscriptions(first: 50) { nodes { id uri } } }`);
  for (const n of have.webhookSubscriptions.nodes.filter(x => x.uri === callbackUrl)) {
    await gql(storeId, `mutation Del($id: ID!) { webhookSubscriptionDelete(id: $id) { userErrors { message } } }`, { id: n.id });
  }
}

