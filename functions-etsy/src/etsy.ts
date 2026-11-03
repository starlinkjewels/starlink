// Talking to an Etsy shop: its app's secret and tokens kept encrypted
// (AES-256-GCM — the same key as the Shopify stores, SHOPIFY_KEY in Secret
// Manager), the hour-long access token renewed with the refresh token (one
// renewal at a time per shop — Etsy hands out a new refresh token each time),
// and Open API v3 calls with Etsy's rate limit respected.
import { createCipheriv, createDecipheriv, randomBytes } from "crypto";
import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { defineSecret } from "firebase-functions/params";
import { userOfToken } from "./etsyLogic";

export const app = initializeApp();
// The app's named database (src/lib/firebase.ts DATABASE_ID).
export const db = getFirestore(app, "diamondflow");

/** One key for every connected store's secrets (Shopify and Etsy alike). */
export const SEAL_KEY = defineSecret("SHOPIFY_KEY");

const keyBytes = () => {
  const k = Buffer.from(SEAL_KEY.value() || "", "base64");
  if (k.length !== 32) throw new Error("The integrations key (SHOPIFY_KEY) is not set");
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

// Local tests only (the functions emulator): a stand-in Etsy answers instead.
const TEST_BASE = process.env.FUNCTIONS_EMULATOR === "true" ? process.env.ETSY_TEST_BASE : undefined;
export const API = TEST_BASE ? `${TEST_BASE}/v3` : "https://api.etsy.com/v3";

export const VAULT = "etsyVault";

export interface Vault {
  keystring: string;
  /** seal()ed shared secret, access token and refresh token. */
  secret: string;
  access?: string;
  refresh?: string;
  accessExpiresAt?: number;
  /** seal()ed webhook signing secret (whsec_…), when the shop set one up. */
  webhookSecret?: string;
  /** A renewal under way (another call waits for it). */
  renewingUntil?: number;
}

export class EtsyError extends Error {
  constructor(message: string, public status = 0, public code = "") { super(message); }
}

/** Etsy's key header: the app's keystring and its shared secret (required since 2026-02-09). */
export const apiKey = (v: Pick<Vault, "keystring" | "secret">) => `${v.keystring}:${open(v.secret)}`;

/** A code or a refresh token, exchanged for tokens. */
export async function tokenCall(form: Record<string, string>): Promise<{ access: string; refresh: string; expiresAt: number }> {
  const res = await fetch(`${API}/public/oauth/token`, {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams(form).toString(), signal: AbortSignal.timeout(15_000),
  });
  const text = await res.text();
  let j: { access_token?: string; refresh_token?: string; expires_in?: number; error?: string; error_description?: string } = {};
  try { j = JSON.parse(text); } catch { /* not JSON */ }
  if (!res.ok || !j.access_token || !j.refresh_token) {
    const revoked = j.error === "invalid_grant";
    throw new EtsyError(revoked ? "The shop's approval was taken back or ran out — connect it again (Settings → Etsy)" : j.error_description || j.error || `Etsy answered ${res.status}`,
      res.status, revoked ? "revoked" : j.error ?? "token");
  }
  return { access: j.access_token, refresh: j.refresh_token, expiresAt: Date.now() + Math.max(60, (j.expires_in ?? 3600) - 120) * 1000 };
}

/** The shop's access token — renewed when it has under two minutes left, one renewal at a time. */
export async function accessFor(storeId: string): Promise<{ token: string; vault: Vault }> {
  const ref = db.collection(VAULT).doc(storeId);
  for (let attempt = 0; attempt < 20; attempt++) {
    const v = (await ref.get()).data() as Vault | undefined;
    if (!v?.refresh) throw new EtsyError("This shop is not connected", 0, "not_connected");
    if (v.access && (v.accessExpiresAt ?? 0) > Date.now()) return { token: open(v.access), vault: v };
    // Claim the renewal: only one call swaps the refresh token; the others wait and read the new one.
    // The claim (45 s) outlasts the token call's own limit (15 s), so two renewals never overlap,
    // and the refresh token sent is the one read inside the claim — never an older copy.
    const mine = await db.runTransaction(async tx => {
      const cur = (await tx.get(ref)).data() as Vault | undefined;
      if (!cur?.refresh) return null;
      if ((cur.renewingUntil ?? 0) > Date.now()) return null;
      if (cur.access && (cur.accessExpiresAt ?? 0) > Date.now()) return null;
      tx.update(ref, { renewingUntil: Date.now() + 45_000 });
      return cur;
    });
    if (!mine) { await new Promise(r => setTimeout(r, 1500)); continue; }
    try {
      const t = await tokenCall({ grant_type: "refresh_token", client_id: mine.keystring, refresh_token: open(mine.refresh!) });
      await ref.update({ access: seal(t.access), refresh: seal(t.refresh), accessExpiresAt: t.expiresAt, renewingUntil: 0 });
      return { token: t.access, vault: mine };
    } catch (e) {
      await ref.update({ renewingUntil: 0 }).catch(() => undefined);
      throw e;
    }
  }
  throw new EtsyError("Etsy is busy — try again in a moment");
}

/** One Open API call — waits and tries again when Etsy says to slow down (429) or stumbles (5xx), up to 5 times.
 *  A POST that stumbles is NOT sent again here (Etsy may have saved it — a second shipment
 *  would email the buyer twice): the shipping job tries again, and reads the order first. */
export async function etsy<T = Record<string, unknown>>(storeId: string, method: "GET" | "POST" | "PUT", path: string,
  body?: Record<string, unknown>): Promise<T> {
  let { token, vault } = await accessFor(storeId);
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${API}/application${path}`, {
      method, headers: { "x-api-key": apiKey(vault), Authorization: `Bearer ${token}`, Accept: "application/json",
        ...(body ? { "Content-Type": "application/json" } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(30_000),
    });
    if (res.status === 401 && attempt === 0) {
      await db.collection(VAULT).doc(storeId).update({ accessExpiresAt: 0 });
      ({ token, vault } = await accessFor(storeId));
      continue;
    }
    if ((res.status === 429 || (res.status >= 500 && method === "GET")) && attempt < 5) {
      const wait = Number(res.headers.get("retry-after")) || 2 ** attempt;
      await new Promise(r => setTimeout(r, Math.min(30, wait) * 1000));
      continue;
    }
    const text = await res.text();
    let j: unknown = null;
    try { j = text ? JSON.parse(text) : null; } catch { /* not JSON */ }
    if (!res.ok) {
      const msg = (j as { error?: string; error_description?: string } | null)?.error_description || (j as { error?: string } | null)?.error || `Etsy answered ${res.status}`;
      throw new EtsyError(msg, res.status);
    }
    return j as T;
  }
}

/** The shop behind fresh tokens: the token's owner, and the shop they own. */
export async function shopOfTokens(keystring: string, secret: string, access: string): Promise<{ shopId: string; name: string; currency: string; country?: string; url?: string }> {
  const userId = userOfToken(access);
  if (!userId) throw new EtsyError("Etsy's answer had no user in it");
  const res = await fetch(`${API}/application/users/${userId}/shops`, { headers: { "x-api-key": `${keystring}:${secret}`, Authorization: `Bearer ${access}`, Accept: "application/json" } });
  const j = await res.json().catch(() => null) as { shop_id?: number; shop_name?: string; currency_code?: string; shop_location_country_iso?: string; url?: string } | null;
  if (!res.ok || !j?.shop_id) throw new EtsyError(res.status === 404 ? "This Etsy account has no shop" : `Etsy answered ${res.status} for the shop`, res.status);
  return { shopId: String(j.shop_id), name: j.shop_name ?? `Etsy shop ${j.shop_id}`, currency: j.currency_code ?? "USD", country: j.shop_location_country_iso ?? undefined, url: j.url };
}
