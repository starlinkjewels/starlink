// Etsy shops on our order board — the app's side (the server is functions-etsy/).
//
// Everything about a shop is the server's to write: it holds the shop app's
// secret and tokens (never sent to a device), brings orders in and sends our
// shipments back. Here: watching the shops and what Etsy says about an order,
// and asking the server to do things (etsyStart, etsyAdmin, etsyInfo).
import { useEffect, useState } from "react";
import { collection, doc, onSnapshot, query, where } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db as fsdb, functions } from "./firebase";
import type { StoreRules } from "./shopify";

export interface EtsyShop {
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
  webhooks?: boolean;
  connectedAt?: string;
  lastSyncAt?: string;
  lastSyncCount?: number;
  lastEventAt?: string;
  lastError?: string;
}

/** What Etsy says about an order (etsyOrders) — kept up to date by the server. */
export interface EtsyMirror {
  id: string;
  storeId: string;
  storeName: string;
  receiptId: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  status?: string | null;
  paid?: boolean;
  shipped?: boolean;
  shippedByUs?: string;
  cancelledAt?: string | null;
  currency: string;
  total?: number | null;
  note?: string | null;
  customer?: { name?: string | null } | null;
  shipTo?: { name?: string | null; address1?: string | null; address2?: string | null; city?: string | null; province?: string | null; zip?: string | null; country?: string | null } | null;
  lines: { id: string; title: string; variant?: string | null; sku?: string | null; quantity: number; unitPrice?: number | null; image?: string | null; orderId?: string }[];
  skipped?: string | null;
  issues?: string[];
}

export interface EtsyJob { id: string; kind: "ship"; orderId: string; storeId: string; receiptId: string; status: "pending" | "waiting" | "retry" | "done" | "failed" | "skipped"; attempts?: number; error?: string; nextAt?: string; doneAt?: string; result?: string }

/* ─────────────── Watching ─────────────── */

export function useEtsyShops(): { rows: EtsyShop[]; loading: boolean; error: string | null } {
  const [s, set] = useState<{ rows: EtsyShop[]; loading: boolean; error: string | null }>({ rows: [], loading: true, error: null });
  useEffect(() => onSnapshot(collection(fsdb, "etsyStores"),
    snap => set({ rows: snap.docs.map(d => ({ ...(d.data() as EtsyShop), id: d.id })), loading: false, error: null }),
    err => set(x => ({ ...x, loading: false, error: err.code || err.message }))), []);
  return s;
}

/** What Etsy says about the order one of ours came from. */
export function useEtsyMirror(storeId?: string, receiptId?: string): EtsyMirror | null | undefined {
  const [m, set] = useState<EtsyMirror | null | undefined>(undefined);
  useEffect(() => {
    if (!storeId || !receiptId) { set(null); return; }
    return onSnapshot(doc(fsdb, "etsyOrders", `${storeId}_${receiptId}`),
      d => set(d.exists() ? ({ ...(d.data() as EtsyMirror), id: d.id }) : null), () => set(null));
  }, [storeId, receiptId]);
  return m;
}

/** The shipment to Etsy for one Etsy order (admins). */
export function useEtsyShipJob(storeId?: string, receiptId?: string, enabled = true): EtsyJob | null {
  const [j, set] = useState<EtsyJob | null>(null);
  useEffect(() => {
    if (!storeId || !receiptId || !enabled) return;
    return onSnapshot(doc(fsdb, "etsyJobs", `ship_${storeId}_${receiptId}`),
      d => set(d.exists() ? ({ ...(d.data() as EtsyJob), id: d.id }) : null), () => set(null));
  }, [storeId, receiptId, enabled]);
  return j;
}

/** Every shop's shipments needing a look (admins). */
export function useEtsyJobProblems(enabled: boolean): EtsyJob[] {
  const [rows, set] = useState<EtsyJob[]>([]);
  useEffect(() => {
    if (!enabled) return;
    return onSnapshot(query(collection(fsdb, "etsyJobs"), where("status", "in", ["retry", "failed"])),
      snap => set(snap.docs.map(d => ({ ...(d.data() as EtsyJob), id: d.id }))), () => set([]));
  }, [enabled]);
  return rows;
}

/* ─────────────── Asking the server ─────────────── */

const callErr = (e: unknown) => new Error((e as { message?: string })?.message?.replace(/^(FirebaseError: )?/, "") || "Etsy didn't answer — try again");

/** The addresses the shop's app needs (its Redirect URI, and the webhook endpoint). */
export async function etsyInfo(): Promise<{ callbackUrl: string; webhookUrl: string }> {
  try { return (await httpsCallable<Record<string, never>, { callbackUrl: string; webhookUrl: string }>(functions, "etsyInfo")({})).data; }
  catch (e) { throw callErr(e); }
}

/** Step one of connecting: the shop owner's approval link (works once, for two hours). */
export async function startShop(input: { keystring: string; secret: string; name?: string; clientId: string; companyId?: string; handlerId?: string; importDays?: number }) {
  try { return (await httpsCallable<typeof input, { url: string; callbackUrl: string; expiresInHours: number }>(functions, "etsyStart", { timeout: 60_000 })(input)).data; }
  catch (e) { throw callErr(e); }
}

export type EtsyAction = "save" | "preview" | "syncNow" | "importOrder" | "test" | "pause" | "resume" | "disconnect" | "webhookSecret" | "retryShipments";
export async function shopAction<T = Record<string, unknown>>(action: EtsyAction, storeId: string, extra: Record<string, unknown> = {}): Promise<T> {
  try { return (await httpsCallable<Record<string, unknown>, T>(functions, "etsyAdmin", { timeout: 300_000 })({ action, storeId, ...extra })).data; }
  catch (e) { throw callErr(e); }
}

/** The order in the shop's own Etsy Shop Manager. */
export const etsyOrderUrl = (receiptId: string) => `https://www.etsy.com/your/orders/sold?order_id=${receiptId}`;
