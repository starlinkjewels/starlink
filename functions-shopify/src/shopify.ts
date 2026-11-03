// Talking to a store: its secret kept encrypted (AES-256-GCM, the key in Secret
// Manager — SHOPIFY_KEY), a fresh access token from the store's own app
// (client credentials grant — 24 hours, renewed before it runs out), and the
// Admin GraphQL API (version below) with Shopify's throttle respected.
import { createCipheriv, createDecipheriv, randomBytes } from "crypto";
import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { defineSecret } from "firebase-functions/params";

export const app = initializeApp();
// The app's named database (src/lib/firebase.ts DATABASE_ID).
export const db = getFirestore(app, "diamondflow");

export const SHOPIFY_KEY = defineSecret("SHOPIFY_KEY");
export const API_VERSION = "2026-10";

/* ─────────────── The store app's secret, encrypted ─────────────── */

const keyBytes = () => {
  const k = Buffer.from(SHOPIFY_KEY.value() || "", "base64");
  if (k.length !== 32) throw new Error("SHOPIFY_KEY is not set (32 bytes, base64)");
  return k;
};
export function seal(plain: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", keyBytes(), iv);
  const body = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return [iv.toString("base64"), c.getAuthTag().toString("base64"), body.toString("base64")].join(".");
}
export function open(sealed: string): string {
  const [iv, tag, body] = String(sealed ?? "").split(".");
  const d = createDecipheriv("aes-256-gcm", keyBytes(), Buffer.from(iv, "base64"));
  d.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([d.update(Buffer.from(body, "base64")), d.final()]).toString("utf8");
}

/* ─────────────── Where a store is ─────────────── */

// Local tests only (the functions emulator): a stand-in Shopify answers instead.
const TEST_BASE = process.env.FUNCTIONS_EMULATOR === "true" ? process.env.SHOPIFY_TEST_BASE : undefined;
const base = (shop: string) => (TEST_BASE ? `${TEST_BASE}/${shop}` : `https://${shop}`);

export interface Vault {
  shop: string;
  clientId: string;
  /** seal()ed client secret. */
  secret: string;
  /** seal()ed access token and when it runs out. */
  token?: string;
  tokenExpiresAt?: number;
}

export const VAULT = "shopifyVault";

export class ShopifyError extends Error {
  constructor(message: string, public status = 0, public code = "") { super(message); }
}

/** A token straight from the store's app (client credentials grant). */
export async function fetchToken(shop: string, clientId: string, clientSecret: string): Promise<{ token: string; expiresAt: number; scope: string }> {
  const res = await fetch(`${base(shop)}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams({ grant_type: "client_credentials", client_id: clientId, client_secret: clientSecret }).toString(),
  });
  const text = await res.text();
  let j: { access_token?: string; expires_in?: number; scope?: string; error?: string; error_description?: string } = {};
  try { j = JSON.parse(text); } catch { /* not JSON */ }
  if (!res.ok || !j.access_token) {
    const why = j.error === "shop_not_permitted"
      ? "This app belongs to another organization — create the app in this store's own Dev Dashboard"
      : j.error_description || j.error || `Shopify answered ${res.status}`;
    throw new ShopifyError(why, res.status, j.error ?? "token");
  }
  return { token: j.access_token, expiresAt: Date.now() + Math.max(60, (j.expires_in ?? 86399) - 120) * 1000, scope: j.scope ?? "" };
}

/** The store's token — renewed when it has less than two minutes left. */
export async function tokenFor(storeId: string): Promise<{ token: string; shop: string }> {
  const ref = db.collection(VAULT).doc(storeId);
  const v = (await ref.get()).data() as Vault | undefined;
  if (!v) throw new ShopifyError("This store is not connected", 0, "not_connected");
  if (v.token && (v.tokenExpiresAt ?? 0) > Date.now()) return { token: open(v.token), shop: v.shop };
  const t = await fetchToken(v.shop, v.clientId, open(v.secret));
  await ref.update({ token: seal(t.token), tokenExpiresAt: t.expiresAt });
  return { token: t.token, shop: v.shop };
}

/** The store app's own secret — what Shopify signs its messages with. */
export async function secretFor(storeId: string): Promise<string> {
  const v = (await db.collection(VAULT).doc(storeId).get()).data() as Vault | undefined;
  if (!v) throw new ShopifyError("This store is not connected", 0, "not_connected");
  return open(v.secret);
}

/* ─────────────── Admin GraphQL ─────────────── */

type GqlError = { message: string; extensions?: { code?: string } };

/** One Admin GraphQL call — waits and tries again when Shopify says to slow down (up to 5 times). */
export async function gql<T = Record<string, unknown>>(storeId: string, query: string, variables: Record<string, unknown> = {}): Promise<T> {
  let { token, shop } = await tokenFor(storeId);
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${base(shop)}/admin/api/${API_VERSION}/graphql.json`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token },
      body: JSON.stringify({ query, variables }),
    });
    if (res.status === 401 && attempt === 0) {
      // The token was refused: a fresh one, once.
      await db.collection(VAULT).doc(storeId).update({ tokenExpiresAt: 0 });
      ({ token, shop } = await tokenFor(storeId));
      continue;
    }
    if ((res.status === 429 || res.status >= 500) && attempt < 5) { await new Promise(r => setTimeout(r, 1000 * 2 ** attempt)); continue; }
    const text = await res.text();
    let j: { data?: T; errors?: GqlError[] | string } = {};
    try { j = JSON.parse(text); } catch { throw new ShopifyError(`Shopify answered ${res.status}`, res.status); }
    const errs = Array.isArray(j.errors) ? j.errors : j.errors ? [{ message: String(j.errors) }] : [];
    if (errs.some(e => e.extensions?.code === "THROTTLED") && attempt < 5) { await new Promise(r => setTimeout(r, 1000 * (attempt + 1))); continue; }
    if (!res.ok) throw new ShopifyError(errs[0]?.message || `Shopify answered ${res.status}`, res.status);
    // Fields Shopify holds back (protected customer data) come as errors beside the data: the data is still used.
    if (!j.data) throw new ShopifyError(errs.map(e => e.message).join("; ") || "No data from Shopify", res.status);
    return j.data;
  }
}
