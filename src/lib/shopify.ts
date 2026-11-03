// Shopify stores on our order board — the app's side (the server is functions-shopify/).
//
// Everything about a store is the server's to write: it holds the store app's
// keys (never sent to a device), checks them, brings orders in and sends our
// dispatches and stages back. Here: watching the stores and what Shopify says
// about an order, and asking the server to do things (shopifyConnect, shopifyAdmin).
import { useEffect, useState } from "react";
import { collection, doc, onSnapshot, query, where } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db as fsdb, functions } from "./firebase";

export interface StoreRules {
  importWhen?: "paid" | "any";
  importTest?: boolean;
  priceMode?: "approval" | "percent";
  pricePct?: number;
  leadDays?: number;
  metalOptions?: string[];
  karatOptions?: string[];
  sizeOptions?: string[];
  stoneOptions?: string[];
  typeRules?: { word: string; type: string }[];
  metalRules?: { word: string; metal: string }[];
  defaultType?: string;
  defaultMetal?: string;
  stageTags?: boolean;
  tagPrefix?: string;
  notifyCustomer?: boolean;
}

export interface ShopifyStore {
  id: string;
  shop: string;
  name: string;
  status: "connected" | "paused" | "disconnected" | "error";
  clientId: string;
  companyId?: string;
  handlerId?: string;
  rules?: StoreRules;
  currency?: string;
  connectedAt?: string;
  connectedBy?: string;
  lastSyncAt?: string;
  lastSyncCount?: number;
  lastEventAt?: string;
  lastError?: string;
}

/** What Shopify says about an order (shopifyOrders) — kept up to date by the server. */
export interface ShopifyMirror {
  id: string;
  storeId: string;
  storeName: string;
  shop: string;
  orderId: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  test?: boolean;
  cancelledAt?: string | null;
  financialStatus?: string | null;
  fulfillmentStatus?: string | null;
  currency: string;
  note?: string | null;
  tags?: string[];
  customer?: { name?: string | null } | null;
  shipTo?: { name?: string | null; company?: string | null; address1?: string | null; address2?: string | null; city?: string | null;
    province?: string | null; zip?: string | null; country?: string | null; phone?: string | null } | null;
  lines: { id: string; title: string; variant?: string | null; sku?: string | null; quantity: number; currentQuantity: number; unitPrice?: number | null; image?: string | null; orderId?: string }[];
  skipped?: string | null;
  issues?: string[];
  fulfilled?: Record<string, string>;
  syncedAt?: string;
}

export interface ShopifyJob { id: string; kind: "fulfil" | "tag"; orderId: string; storeId: string; stage?: string; status: "pending" | "retry" | "done" | "failed" | "skipped"; attempts?: number; error?: string; nextAt?: string; doneAt?: string; result?: string }

/** The defaults the server uses (functions-shopify/src/logic.ts DEFAULT_RULES), to show and edit. */
export const DEFAULT_RULES: Required<Omit<StoreRules, "pricePct" | "defaultType" | "defaultMetal">> = {
  importWhen: "paid", importTest: false, priceMode: "approval", leadDays: 14,
  metalOptions: ["Metal", "Material", "Metal Type", "Gold", "Metal Color", "Metal Colour"],
  karatOptions: ["Karat", "Purity", "Gold Karat", "Gold Purity", "Metal"],
  sizeOptions: ["Size", "Ring Size", "Length", "Chain Length"],
  stoneOptions: ["Diamond", "Stone", "Diamond Type", "Stone Type"],
  typeRules: [
    { word: "engagement", type: "Ring" }, { word: "band", type: "Ring" }, { word: "ring", type: "Ring" },
    { word: "pendant", type: "Pendant" }, { word: "necklace", type: "Necklace" }, { word: "chain", type: "Necklace" },
    { word: "bracelet", type: "Bracelet" }, { word: "bangle", type: "Bracelet" }, { word: "earring", type: "Earrings" },
    { word: "stud", type: "Earrings" }, { word: "hoop", type: "Earrings" },
  ],
  metalRules: [
    { word: "rose", metal: "Rose Gold" }, { word: "white gold", metal: "White Gold (Palladium Alloy)" }, { word: "white", metal: "White Gold (Palladium Alloy)" },
    { word: "yellow", metal: "Yellow Gold" }, { word: "platinum", metal: "Platinum" }, { word: "silver", metal: "Silver" },
    { word: "titanium", metal: "Titanium" }, { word: "gold", metal: "Yellow Gold" },
  ],
  stageTags: true, tagPrefix: "Starlink", notifyCustomer: true,
};
export const rulesOf = (r?: StoreRules) => ({ ...DEFAULT_RULES, ...(r ?? {}) });

/** The scopes the store's app needs (Dev Dashboard → Versions → Access scopes). */
export const NEEDED_SCOPES = ["read_orders", "write_orders", "read_products", "write_merchant_managed_fulfillment_orders"];

/* ─────────────── Watching ─────────────── */

export function useShopifyStores(): { rows: ShopifyStore[]; loading: boolean; error: string | null } {
  const [s, set] = useState<{ rows: ShopifyStore[]; loading: boolean; error: string | null }>({ rows: [], loading: true, error: null });
  useEffect(() => onSnapshot(collection(fsdb, "shopifyStores"),
    snap => set({ rows: snap.docs.map(d => ({ ...(d.data() as ShopifyStore), id: d.id })), loading: false, error: null }),
    err => set(x => ({ ...x, loading: false, error: err.code || err.message }))), []);
  return s;
}

/** What Shopify says about the order one of ours came from. */
export function useShopifyMirror(storeId?: string, orderId?: string): ShopifyMirror | null | undefined {
  const [m, set] = useState<ShopifyMirror | null | undefined>(undefined);
  useEffect(() => {
    if (!storeId || !orderId) { set(null); return; }
    return onSnapshot(doc(fsdb, "shopifyOrders", `${storeId}_${orderId}`),
      d => set(d.exists() ? ({ ...(d.data() as ShopifyMirror), id: d.id }) : null), () => set(null));
  }, [storeId, orderId]);
  return m;
}

/** What has been sent to Shopify for one of our orders (admins). */
export function useShopifyJobs(orderId?: string, enabled = true): ShopifyJob[] {
  const [rows, set] = useState<ShopifyJob[]>([]);
  useEffect(() => {
    if (!orderId || !enabled) return;
    return onSnapshot(query(collection(fsdb, "shopifyJobs"), where("orderId", "==", orderId)),
      snap => set(snap.docs.map(d => ({ ...(d.data() as ShopifyJob), id: d.id }))), () => set([]));
  }, [orderId, enabled]);
  return rows;
}

/** Every store's send problems (admins) — for the store's health. */
export function useShopifyJobProblems(enabled: boolean): ShopifyJob[] {
  const [rows, set] = useState<ShopifyJob[]>([]);
  useEffect(() => {
    if (!enabled) return;
    return onSnapshot(query(collection(fsdb, "shopifyJobs"), where("status", "in", ["retry", "failed"])),
      snap => set(snap.docs.map(d => ({ ...(d.data() as ShopifyJob), id: d.id }))), () => set([]));
  }, [enabled]);
  return rows;
}

/* ─────────────── Asking the server ─────────────── */

const callErr = (e: unknown) => new Error((e as { message?: string })?.message?.replace(/^(FirebaseError: )?/, "") || "Shopify didn't answer — try again");

export async function connectStore(input: { shop: string; appClientId: string; appSecret: string; name?: string; clientId: string; companyId?: string; handlerId?: string; importDays?: number }) {
  try { return (await httpsCallable<typeof input, { storeId: string; name: string; currency: string }>(functions, "shopifyConnect", { timeout: 120_000 })(input)).data; }
  catch (e) { throw callErr(e); }
}

export type AdminAction = "save" | "preview" | "syncNow" | "importOrder" | "test" | "pause" | "resume" | "disconnect" | "credentials";
export async function storeAction<T = Record<string, unknown>>(action: AdminAction, storeId: string, extra: Record<string, unknown> = {}): Promise<T> {
  try { return (await httpsCallable<Record<string, unknown>, T>(functions, "shopifyAdmin", { timeout: 300_000 })({ action, storeId, ...extra })).data; }
  catch (e) { throw callErr(e); }
}

/** The order in the store's own Shopify admin. */
export const shopifyAdminUrl = (shop: string, orderId: string) => `https://admin.shopify.com/store/${shop.replace(/\.myshopify\.com$/, "")}/orders/${orderId}`;

/** "Ravi Mehta, 12 Park St, Mumbai 400001, India · +91…" */
export function shipLine(a: ShopifyMirror["shipTo"]): string {
  if (!a) return "";
  return [[a.name, a.company].filter(Boolean).join(" · "), a.address1, a.address2, [a.city, a.province, a.zip].filter(Boolean).join(" "), a.country]
    .filter(Boolean).join(", ") + (a.phone ? ` · ${a.phone}` : "");
}
