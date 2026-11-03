// Etsy's own rules, apart from the database and the network — tested on their
// own (scripts/test-logic.cjs): the sign-in-with-Etsy proof (PKCE), Etsy's
// webhook signature (the Standard Webhooks scheme), an Etsy order (a receipt
// and its transactions) in the shape the shared order rules read
// (shared/logic.ts — the same mapping as the Shopify stores), and the
// carrier name Etsy knows.
import { createHash, createHmac, randomBytes, timingSafeEqual } from "crypto";
import type { ShopLine, ShopOrder } from "./shared/logic";

/* ─────────────── Sign in with Etsy (OAuth 2.0 + PKCE, S256) ─────────────── */

const b64url = (b: Buffer) => b.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
/** A one-time verifier (43–128 of A-Z a-z 0-9 . _ ~ -) and its S256 challenge. */
export function pkce(): { verifier: string; challenge: string } {
  const verifier = b64url(randomBytes(48)); // 64 characters, all allowed
  return { verifier, challenge: b64url(createHash("sha256").update(verifier).digest()) };
}
export const challengeOf = (verifier: string) => b64url(createHash("sha256").update(verifier).digest());

export const SCOPES = ["transactions_r", "transactions_w", "listings_r", "shops_r"];

export function authorizeUrl(keystring: string, redirectUri: string, state: string, challenge: string): string {
  const u = new URL("https://www.etsy.com/oauth/connect");
  u.searchParams.set("response_type", "code");
  u.searchParams.set("client_id", keystring);
  u.searchParams.set("redirect_uri", redirectUri);
  u.searchParams.set("scope", SCOPES.join(" "));
  u.searchParams.set("state", state);
  u.searchParams.set("code_challenge", challenge);
  u.searchParams.set("code_challenge_method", "S256");
  return u.toString();
}

/** The Etsy user an access token belongs to — its numeric prefix ("12345678.abc…"). */
export const userOfToken = (token: string) => (/^(\d+)\./.exec(token)?.[1] ?? "");

/* ─────────────── Etsy's webhook signature ─────────────── */

/**
 * Really from Etsy: `webhook-signature` holds one or more "v1,<base64>" — the
 * HMAC-SHA256, keyed with the base64 secret (after "whsec_"), of
 * "<webhook-id>.<webhook-timestamp>.<raw body>". A timestamp more than five
 * minutes off is refused (a replay).
 */
export function etsySigned(rawBody: Buffer, h: { id?: string; timestamp?: string; signature?: string }, secret: string, now = Date.now()): boolean {
  if (!h.id || !h.timestamp || !h.signature || !secret) return false;
  const ts = Number(h.timestamp);
  if (!Number.isFinite(ts) || Math.abs(now / 1000 - ts) > 300) return false;
  let key: Buffer;
  try { key = Buffer.from(secret.replace(/^whsec_/, ""), "base64"); } catch { return false; }
  if (!key.length) return false;
  const want = createHmac("sha256", key).update(`${h.id}.${h.timestamp}.`).update(rawBody).digest();
  return h.signature.split(" ").some(part => {
    const sig = part.includes(",") ? part.split(",")[1] : part;
    let got: Buffer;
    try { got = Buffer.from(sig, "base64"); } catch { return false; }
    return got.length === want.length && timingSafeEqual(got, want);
  });
}

/** The receipt a webhook's resource_url names — only one of THIS shop's. */
export function receiptOfResource(url: string | undefined, shopId: string): string | null {
  const m = String(url ?? "").match(/\/shops\/(\d+)\/receipts\/(\d+)/);
  return m && m[1] === String(shopId) ? m[2] : null;
}

/* ─────────────── An Etsy order, in the shared shape ─────────────── */

export interface EtsyMoney { amount: number; divisor: number; currency_code: string }
export interface EtsyVariation { property_id?: number; formatted_name?: string; formatted_value?: string }
export interface EtsyTransaction {
  transaction_id: number; listing_id?: number; listing_image_id?: number | null; title?: string; sku?: string | null; quantity: number;
  price?: EtsyMoney; variations?: EtsyVariation[]; is_digital?: boolean; shipped_timestamp?: number | null;
}
export interface EtsyReceipt {
  receipt_id: number; status?: string; is_paid?: boolean; is_shipped?: boolean;
  create_timestamp?: number; created_timestamp?: number; update_timestamp?: number; updated_timestamp?: number;
  name?: string; first_line?: string | null; second_line?: string | null; city?: string | null; state?: string | null; zip?: string | null;
  country_iso?: string | null; message_from_buyer?: string | null; is_gift?: boolean; gift_message?: string | null;
  grandtotal?: EtsyMoney; shipments?: { tracking_code?: string | null }[]; transactions?: EtsyTransaction[];
}

export const moneyOf = (m?: EtsyMoney) => (m && m.divisor ? Math.round((m.amount / m.divisor) * 100) / 100 : undefined);
const iso = (s?: number) => (s ? new Date(s * 1000).toISOString() : "");
/** Etsy's personalisation answers are variations with property_id 54. */
const PERSONALISATION = 54;

/** A receipt as the shared rules read an order — paid / cancelled / shipped as Shopify says them. */
export function toShopOrder(r: EtsyReceipt, listingImage: (t: EtsyTransaction) => string | null, currency?: string): ShopOrder {
  const status = String(r.status ?? "").toLowerCase();
  const cancelled = status === "canceled" || status === "fully refunded";
  const created = iso(r.create_timestamp ?? r.created_timestamp);
  const lines: ShopLine[] = (r.transactions ?? []).filter(t => !t.is_digital).map(t => {
    const vars = t.variations ?? [];
    const shipped = !!t.shipped_timestamp || !!r.is_shipped;
    return {
      id: String(t.transaction_id), title: t.title ?? "Etsy item",
      variantTitle: vars.filter(v => v.property_id !== PERSONALISATION).map(v => v.formatted_value).filter(Boolean).join(" / ") || null,
      sku: t.sku || null, quantity: t.quantity, currentQuantity: cancelled ? 0 : t.quantity, unfulfilled: shipped ? 0 : t.quantity,
      options: vars.filter(v => v.property_id !== PERSONALISATION && v.formatted_name).map(v => ({ name: v.formatted_name!, value: v.formatted_value ?? "" })),
      properties: vars.filter(v => v.property_id === PERSONALISATION).map(v => ({ key: v.formatted_name || "Personalisation", value: v.formatted_value ?? "" })),
      unitPrice: moneyOf(t.price), image: listingImage(t), productType: null, productTags: [],
    };
  });
  const note = [r.message_from_buyer?.trim() && `Buyer: ${r.message_from_buyer.trim()}`, r.is_gift && (r.gift_message?.trim() ? `Gift — ${r.gift_message.trim()}` : "Gift")]
    .filter(Boolean).join(" · ") || null;
  return {
    id: String(r.receipt_id), legacyId: String(r.receipt_id), name: `#${r.receipt_id}`, createdAt: created,
    updatedAt: iso(r.update_timestamp ?? r.updated_timestamp) || created, test: false,
    cancelledAt: cancelled ? iso(r.update_timestamp ?? r.updated_timestamp) || created : null,
    financialStatus: r.is_paid ? "PAID" : status === "payment processing" ? "PENDING" : (status || "OPEN").toUpperCase(),
    fulfillmentStatus: r.is_shipped ? "FULFILLED" : "UNFULFILLED", note, tags: [],
    currency: r.grandtotal?.currency_code ?? currency ?? "USD",
    customer: r.name ? { name: r.name } : null,
    shipTo: r.first_line || r.city ? { name: r.name ?? null, address1: r.first_line ?? null, address2: r.second_line ?? null, city: r.city ?? null,
      province: r.state ?? null, zip: r.zip ?? null, country: r.country_iso ?? null } : null,
    lines,
  };
}

/* ─────────────── The carrier Etsy knows ─────────────── */

const lc = (s?: string | null) => (s ?? "").trim().toLowerCase().replace(/[^a-z0-9]/g, "");
/** Our courier as one of Etsy's carrier names (from getShippingCarriers) — "other" when none matches. */
export function etsyCarrier(ours: string | undefined, theirs: string[]): string {
  const v = lc(ours);
  if (!v) return "other";
  // Exact first; then a partial match only on names of 3+ letters, and only when it is the one such match.
  const named = theirs.filter(c => lc(c).length >= 3);
  const exact = named.find(c => lc(c) === v);
  if (exact) return exact;
  const part = v.length >= 3 ? named.filter(c => lc(c).includes(v) || v.includes(lc(c))) : [];
  return part.length === 1 ? part[0] : "other";
}
