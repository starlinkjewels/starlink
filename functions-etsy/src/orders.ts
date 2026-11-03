// An Etsy order brought in, and our shipment sent back.
//
// In: the order (a receipt) is always read from Etsy itself. Each of its items
// (transactions) still to be made becomes ONE of our orders
// (orders/ets_{storeId}_{transactionId}), at the first stage (Waiting), with
// its options, the buyer's personalisation and gift message, its photo and
// where it ships — read by the same rules as a Shopify store's
// (shared/logic.ts). The order and its number are made in one transaction:
// never brought in twice, no number lost or reused. Only paid orders placed
// since the shop was connected come in (or the days asked for, or one by its
// number). The server never writes to our order again; what changes on Etsy
// is kept on etsyOrders (admins) and shown on our order.
//
// Out: Etsy marks shipping per ORDER, not per item — so once every one of our
// orders for an Etsy order is dispatched, one shipment goes with the tracking
// (Etsy emails the buyer). Read first: an order already shipped on Etsy is
// never shipped twice. Nothing on Etsy is ever cancelled or refunded from here.
import { randomBytes } from "crypto";
import { db, etsy, EtsyError } from "./etsy";
import { etsyCarrier, moneyOf, toShopOrder, type EtsyReceipt, type EtsyTransaction } from "./etsyLogic";
import { importProblem, mapLine, newOrderSteps, rulesOf, yearNow, type ShopOrder, type StoreRules } from "./shared/logic";

export const STORES = "etsyStores";
export const MIRROR = "etsyOrders";
export const JOBS = "etsyJobs";

export interface StoreDoc {
  id: string;
  shopId: string;
  name: string;
  url?: string;
  country?: string;
  status: "connected" | "paused" | "disconnected" | "error";
  clientId: string;
  companyId?: string;
  handlerId?: string;
  rules?: StoreRules;
  currency?: string;
  connectedAt?: string;
  lastSyncAt?: string;
  /** More changed than one check reads: the next check starts exactly at lastSyncAt, past this many. */
  syncSkip?: number;
  lastEventAt?: string;
  lastError?: string;
}

export const ourOrderId = (storeId: string, transactionId: string) => `ets_${storeId}_${transactionId}`;
export const mirrorId = (storeId: string, receiptId: string) => `${storeId}_${receiptId}`;

/* ─────────────── Reading from Etsy ─────────────── */

const images = new Map<string, string | null>();
/** An item's photo: its listing's image (the one bought), largest Etsy gives. */
async function imageOf(storeId: string, t: EtsyTransaction): Promise<string | null> {
  if (!t.listing_id) return null;
  const key = `${t.listing_id}_${t.listing_image_id ?? ""}`;
  if (images.has(key)) return images.get(key)!;
  try {
    const img = t.listing_image_id
      ? await etsy<{ url_fullxfull?: string; url_570xN?: string }>(storeId, "GET", `/listings/${t.listing_id}/images/${t.listing_image_id}`)
      : (await etsy<{ results?: { url_fullxfull?: string; url_570xN?: string }[] }>(storeId, "GET", `/listings/${t.listing_id}/images`)).results?.[0];
    const url = img?.url_fullxfull ?? img?.url_570xN ?? null;
    images.set(key, url);
    return url;
  } catch { return null; }
}

export async function readReceipt(store: StoreDoc, receiptId: string): Promise<{ raw: EtsyReceipt; order: ShopOrder } | null> {
  let raw: EtsyReceipt;
  try { raw = await etsy<EtsyReceipt>(store.id, "GET", `/shops/${store.shopId}/receipts/${receiptId}`); }
  catch (e) { if (e instanceof EtsyError && e.status === 404) return null; throw e; }
  const pics = new Map<number, string | null>();
  for (const t of raw.transactions ?? []) pics.set(t.transaction_id, await imageOf(store.id, t));
  return { raw, order: toShopOrder(raw, t => pics.get(t.transaction_id) ?? null, store.currency) };
}

/** The shop's orders changed since a time, oldest change first — `skip` of them passed over
 *  (those already read at exactly that time, when more changed at once than one run reads). */
export async function changedSince(store: StoreDoc, sinceIso: string, max = 200, skip = 0): Promise<{ id: string; updatedAt: string }[]> {
  const out: { id: string; updatedAt: string }[] = [];
  const min = Math.floor(Date.parse(sinceIso) / 1000);
  for (let offset = skip; out.length < max; offset += 100) {
    const d = await etsy<{ results?: EtsyReceipt[] }>(store.id, "GET",
      `/shops/${store.shopId}/receipts?min_last_modified=${min}&sort_on=updated&sort_order=asc&limit=100&offset=${offset}`);
    const rows = d.results ?? [];
    out.push(...rows.map(r => ({ id: String(r.receipt_id), updatedAt: new Date(((r.update_timestamp ?? r.updated_timestamp ?? 0)) * 1000).toISOString() })));
    if (rows.length < 100) break;
  }
  return out.slice(0, max);
}

/* ─────────────── Our side ─────────────── */

const DEFAULT_TYPES = ["Ring", "Ring + Band", "Pendant", "Necklace", "Bracelet", "Earrings", "Custom"];
const DEFAULT_METALS = ["Yellow Gold", "White Gold (Palladium Alloy)", "White Gold (Silver Alloy)", "Rose Gold", "Platinum", "Silver", "Titanium"];
const DEFAULT_NO_KARAT = ["Platinum", "Silver", "Titanium"];
export async function ourLists() {
  const s = (await db.collection("meta").doc("settings").get()).data() ?? {};
  const own = (k: string, dflt: string[]) => (Array.isArray(s.optionLists?.[k]) && s.optionLists[k].length ? s.optionLists[k] : dflt) as string[];
  return { types: own("jewelleryTypes", DEFAULT_TYPES), metals: own("metals", DEFAULT_METALS),
    noKarat: (Array.isArray(s.metalsWithoutKarats) ? s.metalsWithoutKarats : DEFAULT_NO_KARAT) as string[], timelineStages: s.timelineStages };
}

/** One past the highest number on the latest orders — the app's own floor (src/lib/counters.ts). */
async function numberFloor(): Promise<number> {
  const snap = await db.collection("orders").orderBy("orderNumber", "desc").limit(30).select("orderNumber").get();
  const suffix = (v: unknown) => parseInt(String(v ?? "").split("-").pop() ?? "", 10);
  return Math.max(1001, ...snap.docs.map(d => suffix(d.data().orderNumber)).filter(n => Number.isFinite(n)).map(n => n + 1));
}
async function claimNumber(tx: FirebaseFirestore.Transaction, floor: number): Promise<string> {
  const ref = db.collection("counters").doc("orderNumber");
  const stored = Number((await tx.get(ref)).data()?.next);
  const next = Math.max(Number.isFinite(stored) ? stored : 0, floor);
  tx.set(ref, { next: next + 1, updatedAt: new Date().toISOString() }, { merge: true });
  return `SLJ-${yearNow()}-${String(next).padStart(4, "0")}`;
}

export async function tell(userIds: (string | undefined)[], title: string, body: string): Promise<void> {
  const admins = await db.collection("users").where("role", "==", "admin").get();
  const ids = new Set<string>([...admins.docs.filter(u => u.data().status !== "inactive").map(u => u.id), ...userIds.filter((x): x is string => !!x)]);
  const batch = db.batch();
  const at = new Date().toISOString();
  for (const id of ids) {
    const nid = `n_ets_${randomBytes(6).toString("hex")}`;
    batch.set(db.collection("notifications").doc(nid), { id: nid, userId: id, title, body, type: "order", read: false, createdAt: at });
  }
  await batch.commit();
}

const shipOf = (a: ShopOrder["shipTo"]) => a ? Object.fromEntries(Object.entries(a).filter(([, v]) => v !== null && v !== undefined && v !== "")) : undefined;

/* ─────────────── Bringing an order in ─────────────── */

export interface Processed { created: string[]; skipped?: string; issues: string[] }

export async function processReceipt(storeId: string, receiptId: string, opts: { notBefore?: string | null } = {}): Promise<Processed> {
  const ss = await db.collection(STORES).doc(storeId).get();
  const store = ss.exists ? ({ ...(ss.data() as StoreDoc), id: storeId }) : null;
  if (!store || store.status === "disconnected") return { created: [], skipped: "Shop not connected", issues: [] };
  const got = await readReceipt(store, receiptId);
  if (!got) return { created: [], skipped: "Not found on Etsy", issues: [] };
  const o = got.order;
  const rules = rulesOf(store.rules);
  const mref = db.collection(MIRROR).doc(mirrorId(storeId, o.id));
  const prev = (await mref.get()).data() as { lines?: { id: string; orderId?: string }[] } | undefined;
  const lists = await ourLists();
  const client = store.clientId ? (await db.collection("clients").doc(store.clientId).get()).data() : undefined;
  const problem = importProblem(o, rules, opts.notBefore === undefined ? store.connectedAt ?? null : opts.notBefore);
  const created: string[] = [];
  const lineOrders = new Map<string, string>((prev?.lines ?? []).filter(l => l.orderId).map(l => [l.id, l.orderId!]));
  for (const l of o.lines) {
    if (!lineOrders.has(l.id) && (await db.collection("orders").doc(ourOrderId(storeId, l.id)).get()).exists) lineOrders.set(l.id, ourOrderId(storeId, l.id));
  }
  // "error" too: reading the order just worked, so the shop is fine again (the check
  // that finds this out moves on past these orders — they must not be passed over).
  if (!problem && (store.status === "connected" || store.status === "error") && client) {
    let floor: number | null = null;
    const shipTo = shipOf(o.shipTo);
    for (const l of o.lines) {
      if (l.currentQuantity <= 0 || l.unfulfilled === 0 || lineOrders.has(l.id)) continue;
      const id = ourOrderId(storeId, l.id);
      const m = mapLine(l, o, rules, lists.types, lists.metals, lists.noKarat);
      const at = new Date().toISOString();
      const steps = newOrderSteps(lists.timelineStages, false);
      const handler = store.handlerId || client.accountManagerId || undefined;
      floor ??= await numberFloor();
      const made = await db.runTransaction(async tx => {
        const ref = db.collection("orders").doc(id);
        if ((await tx.get(ref)).exists) return null;
        const orderNumber = await claimNumber(tx, floor!);
        tx.create(ref, {
          id, orderNumber, clientId: store.clientId,
          ...(store.companyId && store.companyId !== "main" ? { companyId: store.companyId } : {}),
          ...(handler ? { assignedEmployeeId: handler } : {}),
          contactPerson: `Etsy ${o.name}${o.customer?.name ? ` · ${o.customer.name}` : ""}`,
          jewelleryType: m.jewelleryType, metal: m.metal, diamondType: m.diamondType,
          quantity: Math.max(1, m.quantity), diamondWeight: 0, metalWeight: 0,
          images: l.image ? [l.image] : [],
          ...(m.designNumber ? { designNumber: m.designNumber } : {}),
          ...(m.productSize ? { productSize: m.productSize } : {}),
          ...(m.productColor ? { productColor: m.productColor } : {}),
          ...(m.productKarats ? { productKarats: m.productKarats } : {}),
          certificate: false, certificateFee: 0,
          instructions: m.instructions.replace(/^Shopify /, "Etsy "),
          expectedDelivery: new Date(Date.now() + rules.leadDays * 86_400_000).toISOString().slice(0, 10),
          priority: "Normal", status: "Waiting", amount: m.amount, shippingCharge: 0, advances: [],
          timeline: steps.map((s, i) => ({ step: s, status: i === 0 ? "done" : "pending", ...(i === 0 ? { date: at } : {}) })),
          createdAt: at,
          etsy: {
            storeId, shopId: store.shopId, storeName: store.name, receiptId: o.id, receiptName: o.name,
            transactionId: l.id, title: l.title, ...(l.variantTitle ? { variant: l.variantTitle } : {}), ...(l.sku ? { sku: l.sku } : {}),
            ...(typeof l.unitPrice === "number" ? { unitPrice: l.unitPrice } : {}), currency: o.currency,
            ...(m.review.length ? { review: m.review } : {}), importedAt: at,
            ...(shipTo ? { shipTo } : {}), ...(o.customer?.name ? { customer: o.customer.name } : {}),
          },
        });
        return orderNumber;
      });
      lineOrders.set(l.id, id);
      if (made) created.push(made);
    }
  }
  const imported = lineOrders.size > 0;
  const issues: string[] = [];
  if (o.cancelledAt && imported) issues.push(`${String(got.raw.status ?? "Cancelled")} on Etsy ${o.cancelledAt.slice(0, 10)} — check our order before making more`);
  if (imported && got.raw.status?.toLowerCase() === "partially refunded") issues.push("Partly refunded on Etsy — check which item");
  let noticeCancel = false;
  await db.runTransaction(async tx => {
    const cur = (await tx.get(mref)).data() as { updatedAt?: string; lines?: { id: string; orderId?: string }[]; cancelNoticed?: boolean } | undefined;
    for (const l of cur?.lines ?? []) if (l.orderId && !lineOrders.has(l.id)) lineOrders.set(l.id, l.orderId);
    const lines = o.lines.map(l => ({ id: l.id, title: l.title, variant: l.variantTitle ?? null, sku: l.sku ?? null, quantity: l.quantity,
      unitPrice: l.unitPrice ?? null, image: l.image ?? null, ...(lineOrders.get(l.id) ? { orderId: lineOrders.get(l.id) } : {}) }));
    if (cur?.updatedAt && cur.updatedAt > o.updatedAt) {
      tx.set(mref, { lines: (cur.lines ?? []).map(l => ({ ...l, ...(lineOrders.get(l.id) ? { orderId: lineOrders.get(l.id) } : {}) })) }, { merge: true });
      return;
    }
    noticeCancel = !!o.cancelledAt && imported && !cur?.cancelNoticed;
    tx.set(mref, {
      storeId, shopId: store.shopId, storeName: store.name, receiptId: o.id, name: o.name, createdAt: o.createdAt, updatedAt: o.updatedAt,
      status: got.raw.status ?? null, paid: !!got.raw.is_paid, shipped: !!got.raw.is_shipped, cancelledAt: o.cancelledAt ?? null,
      currency: o.currency, total: moneyOf(got.raw.grandtotal) ?? null, note: o.note ?? null,
      customer: imported ? o.customer ?? null : null, shipTo: imported ? o.shipTo ?? null : null,
      lines, skipped: problem && !imported ? problem : null, issues, syncedAt: new Date().toISOString(),
      ...(noticeCancel ? { cancelNoticed: true } : {}),
    }, { merge: true });
  });
  if (created.length) await tell([store.handlerId, client?.accountManagerId], `New Etsy order ${o.name}`,
    `${store.name}: ${created.length} piece${created.length !== 1 ? "s" : ""} on our board — ${created.join(", ")}. Waiting for approval.`);
  if (noticeCancel) await tell([store.handlerId, client?.accountManagerId], `Etsy order ${o.name} cancelled`,
    `${store.name} cancelled or refunded ${o.name} on Etsy. Our orders for it are unchanged — check them before making more.`);
  await db.collection(STORES).doc(storeId).update({ lastEventAt: new Date().toISOString() }).catch(() => undefined);
  return { created, skipped: problem ?? undefined, issues };
}

/* ─────────────── Our shipment, back to Etsy ─────────────── */

const carriers = new Map<string, { at: number; names: string[] }>();
async function carrierNames(store: StoreDoc): Promise<string[]> {
  const c = store.country || "US";
  const hit = carriers.get(c);
  if (hit && Date.now() - hit.at < 86_400_000) return hit.names;
  try {
    const d = await etsy<{ results?: { name?: string }[] }>(store.id, "GET", `/shipping-carriers?origin_country_iso=${encodeURIComponent(c)}`);
    const names = (d.results ?? []).map(r => r.name).filter((x): x is string => !!x);
    carriers.set(c, { at: Date.now(), names });
    return names;
  } catch { return []; }
}

type OurOrder = { id: string; status?: string; deletedAt?: string; dispatchedAt?: string; courierName?: string; trackingNumber?: string; trackingLink?: string; etsy?: { storeId: string; receiptId: string; transactionId: string } };

/**
 * Every live one of our orders for this Etsy order dispatched? Then one shipment
 * with the tracking — the last one sent; the others' numbers go in the note to
 * the buyer. "waiting" while some are still being made.
 */
export async function shipReceipt(store: StoreDoc, receiptId: string, notify: boolean): Promise<"shipped" | "already" | "waiting"> {
  const ours = (await db.collection("orders").where("etsy.receiptId", "==", receiptId).get()).docs
    .map(d => ({ ...(d.data() as OurOrder), id: d.id }))
    .filter(o => o.etsy?.storeId === store.id && !o.deletedAt && o.status !== "Rejected");
  if (!ours.length) return "already";
  if (!ours.every(o => o.status === "Dispatched" || o.status === "Delivered")) return "waiting";
  const r = await etsy<EtsyReceipt>(store.id, "GET", `/shops/${store.shopId}/receipts/${receiptId}`);
  if (r.is_shipped || (r.shipments ?? []).length) return "already";
  const sent = [...ours].sort((a, b) => (b.dispatchedAt ?? "").localeCompare(a.dispatchedAt ?? ""));
  const main = sent.find(o => o.trackingNumber?.trim()) ?? sent[0];
  const others = [...new Set(sent.map(o => o.trackingNumber?.trim()).filter((t): t is string => !!t && t !== main.trackingNumber?.trim()))];
  const body: Record<string, unknown> = { send_bcc: false };
  if (main.trackingNumber?.trim()) {
    body.tracking_code = main.trackingNumber.trim();
    body.carrier_name = etsyCarrier(main.courierName, await carrierNames(store));
  }
  if (others.length) body.note_to_buyer = `Your order comes in ${others.length + 1} parcels — also tracking ${others.join(", ")}.`.slice(0, 500);
  void notify; // Etsy always emails the buyer about a shipment
  try {
    await etsy(store.id, "POST", `/shops/${store.shopId}/receipts/${receiptId}/tracking`, body);
  } catch (e) {
    if (e instanceof EtsyError && e.status === 403) {
      throw new EtsyError("Etsy refused tracking from this app for this shop (its Preferred Partner rules in some regions). Mark it shipped in Etsy by hand — or connect the shop with an app the shop itself owns.", 403, "partner_only");
    }
    if (e instanceof EtsyError && e.status === 409) return "already";
    throw e;
  }
  return "shipped";
}
