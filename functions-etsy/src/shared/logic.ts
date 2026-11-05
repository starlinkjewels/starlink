// GENERATED from functions-shopify/src/logic.ts by scripts/sync-logic.cjs - do not edit here.
// Shopify ⇄ our orders — the rules, apart from the database and the network.
// Pure and tested on their own (scripts/test-logic.cjs): which store address is
// real, whether a message is really Shopify's, what a Shopify line becomes on
// our order (each store's own mapping), which Shopify orders are brought in,
// the stages a new order gets (the same rule as the app's), the tag our stage
// shows as on Shopify, and the carrier name Shopify knows.
import { createHmac, timingSafeEqual } from "crypto";

/* ─────────────── Who is calling ─────────────── */

/** A Shopify store's own address — "acme-jewels.myshopify.com", nothing else. */
export const SHOP_RE = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/;
export function cleanShop(input: string): string | null {
  const v = String(input ?? "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  const shop = v.includes(".") ? v : `${v}.myshopify.com`;
  return SHOP_RE.test(shop) ? shop : null;
}

/** "acme-jewels" — a store's lasting name, the same however often it is connected again. */
export const shopSlug = (shop: string) => shop.replace(/\.myshopify\.com$/, "").replace(/[^a-z0-9-]/g, "");

/** The year an order number carries — the business's own (India), not the server's. */
export const yearNow = (t = Date.now()) => Number(new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric" }).format(t));

/** Is this message really from Shopify — the raw body signed with the store app's secret (base64 HMAC-SHA256)? */
export function webhookSigned(rawBody: Buffer, header: string | undefined, secret: string): boolean {
  if (!header || !secret) return false;
  const want = createHmac("sha256", secret).update(rawBody).digest();
  let got: Buffer;
  try { got = Buffer.from(header, "base64"); } catch { return false; }
  return got.length === want.length && timingSafeEqual(got, want);
}

/* ─────────────── A Shopify order, as read ─────────────── */

export interface ShopLine {
  id: string;              // gid://shopify/LineItem/123
  title: string;
  variantTitle?: string | null;
  sku?: string | null;
  quantity: number;
  currentQuantity: number; // after edits / removals
  /** Still to be fulfilled on Shopify (0: shipped already — nothing for us to make). */
  unfulfilled?: number;
  options: { name: string; value: string }[];
  properties: { key: string; value: string }[];
  unitPrice?: number;      // shop currency
  image?: string | null;
  productType?: string | null;
  productTags?: string[];
}

export interface ShopOrder {
  id: string;              // gid://shopify/Order/123
  legacyId: string;        // "123"
  name: string;            // "#1001"
  createdAt: string;
  updatedAt: string;
  test: boolean;
  cancelledAt?: string | null;
  financialStatus?: string | null;   // PAID, PENDING, AUTHORIZED, PARTIALLY_PAID, REFUNDED, VOIDED…
  fulfillmentStatus?: string | null; // UNFULFILLED, FULFILLED, PARTIALLY_FULFILLED…
  note?: string | null;
  tags: string[];
  currency: string;
  customer?: { name?: string | null; email?: string | null; phone?: string | null } | null;
  shipTo?: { name?: string | null; company?: string | null; address1?: string | null; address2?: string | null; city?: string | null;
    province?: string | null; zip?: string | null; country?: string | null; phone?: string | null } | null;
  lines: ShopLine[];
}

/* ─────────────── Each store's own rules ─────────────── */

export interface StoreRules {
  /** Which orders come in: paid ones (default), or every order; test orders only when asked. */
  importWhen?: "paid" | "any";
  importTest?: boolean;
  /** Our order's price: left for the approval (default), or a share of the Shopify price (USD stores). */
  priceMode?: "approval" | "percent";
  pricePct?: number;
  /** Days from the order to the due date. */
  leadDays?: number;
  /** The product option names that hold each detail (as the store names them). */
  metalOptions?: string[];
  karatOptions?: string[];
  sizeOptions?: string[];
  stoneOptions?: string[];
  /** Words in the product type, tags or title → our jewellery type, first match wins. */
  typeRules?: { word: string; type: string }[];
  /** A metal option's value → our metal, first match wins (words, any case). */
  metalRules?: { word: string; metal: string }[];
  defaultType?: string;
  defaultMetal?: string;
  /** Our stage as a tag on the Shopify order ("Stage: In Production"). */
  stageTags?: boolean;
  tagPrefix?: string;
  /** Shopify tells the customer when we fulfil. */
  notifyCustomer?: boolean;
}

export const DEFAULT_RULES: Required<Omit<StoreRules, "pricePct" | "defaultType" | "defaultMetal">> & Pick<StoreRules, "pricePct" | "defaultType" | "defaultMetal"> = {
  importWhen: "paid",
  importTest: false,
  priceMode: "approval",
  pricePct: undefined,
  leadDays: 14,
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
  defaultType: undefined,
  defaultMetal: undefined,
  stageTags: true,
  tagPrefix: "Stage",
  notifyCustomer: true,
};

export const rulesOf = (r: StoreRules | undefined) => ({ ...DEFAULT_RULES, ...(r ?? {}) });

/**
 * Does this Shopify order come in? — and if not, why. `notBefore`: an order
 * placed before then (before the store was connected, or before the days asked
 * for) stays out, however it is touched later; null when it is asked for by name.
 */
export function importProblem(o: ShopOrder, r: StoreRules, notBefore?: string | null): string | null {
  const rules = rulesOf(r);
  if (notBefore && o.createdAt && o.createdAt < notBefore) return "Placed before the store was connected";
  if (o.test && !rules.importTest) return "A test order";
  if (o.cancelledAt) return "Cancelled on Shopify";
  if (rules.importWhen === "paid") {
    const fs = (o.financialStatus ?? "").toUpperCase();
    if (!["PAID", "PARTIALLY_PAID", "AUTHORIZED", "PARTIALLY_REFUNDED"].includes(fs)) return `Not paid yet (${fs.toLowerCase().replace(/_/g, " ") || "no payment"})`;
  }
  return null;
}

const lc = (s: string | null | undefined) => (s ?? "").trim().toLowerCase();
/** A word (or words) as a whole word, plural too: "ring" finds "Rings", never "Earrings". */
const hasWord = (text: string, word: string) => {
  const w = lc(word).replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
  return !!w && new RegExp(`(^|[^a-z0-9])${w}(s|es)?([^a-z0-9]|$)`, "i").test(text);
};
const optionValue = (line: ShopLine, names: string[]) => {
  const want = names.map(lc);
  return line.options.find(o => want.includes(lc(o.name)))?.value?.trim() || "";
};

/** What our order is told about a Shopify line — each detail with where it came from, and what still needs a person. */
export interface Mapped {
  jewelleryType: string;
  metal: string;
  productKarats?: string;
  productColor?: string;
  productSize?: string;
  diamondType: string;
  designNumber?: string;
  quantity: number;
  amount: number;
  instructions: string;
  /** The details our team must look at before approving (a guess, or nothing found). */
  review: string[];
}

/** "Yellow" / "Rose" / "White" from our metal (the order's colour). */
export function colourOf(metal: string): string | undefined {
  const m = lc(metal);
  if (m.includes("rose")) return "Rose";
  if (m.includes("white") || m.includes("platinum") || m.includes("silver")) return "White";
  if (m.includes("gold")) return "Yellow";
  return undefined;
}

/**
 * A Shopify line on our order. `ourTypes` / `ourMetals` are the business's
 * own lists (Settings → Dropdown lists): a value outside them is never used.
 */
export function mapLine(line: ShopLine, order: Pick<ShopOrder, "name" | "note" | "currency">, r: StoreRules,
  ourTypes: string[], ourMetals: string[], noKaratMetals: string[]): Mapped {
  const rules = rulesOf(r);
  const review: string[] = [];
  const inList = (v: string | undefined, list: string[]) => (v ? list.find(x => lc(x) === lc(v)) : undefined);
  // Type: the product's type, then its tags, then its title.
  const hay = [line.productType ?? "", ...(line.productTags ?? []), line.title].map(lc).join(" | ");
  const typeHit = rules.typeRules.find(t => t.word && hasWord(hay, t.word) && inList(t.type, ourTypes));
  let jewelleryType = typeHit ? inList(typeHit.type, ourTypes)! : (inList(rules.defaultType, ourTypes) ?? inList("Custom", ourTypes) ?? ourTypes[0] ?? "Custom");
  if (!typeHit) review.push("type");
  // Metal: the store's metal option, matched by its words; else the title.
  const metalText = optionValue(line, rules.metalOptions) || line.variantTitle || line.title;
  const metalHit = rules.metalRules.find(m => m.word && hasWord(lc(metalText), m.word) && inList(m.metal, ourMetals));
  const metal = metalHit ? inList(metalHit.metal, ourMetals)! : (inList(rules.defaultMetal, ourMetals) ?? ourMetals.find(m => !/^none/i.test(m)) ?? "Yellow Gold");
  if (!metalHit) review.push("metal");
  // Karat: "14K", "18 kt", "18kt Yellow Gold"…
  const karatText = [optionValue(line, rules.karatOptions), line.variantTitle ?? "", line.title].join(" ");
  const k = karatText.match(/\b(9|10|14|18|22|24)\s*(?:k|kt|karat|carat|ct)\b/i);
  const needsKarat = !noKaratMetals.map(lc).includes(lc(metal));
  const productKarats = needsKarat && k ? `${k[1]}K` : undefined;
  if (needsKarat && !productKarats) review.push("karat");
  const size = optionValue(line, rules.sizeOptions) || undefined;
  const stone = lc(optionValue(line, rules.stoneOptions) || line.variantTitle || line.title);
  const diamondType = /lab|cvd|hpht/.test(stone) ? "Lab Grown" : /natural|mined/.test(stone) ? "Natural" : "";
  const qty = Math.max(0, Math.round(line.currentQuantity ?? line.quantity));
  let amount = 0;
  if (rules.priceMode === "percent" && order.currency === "USD" && typeof line.unitPrice === "number" && (rules.pricePct ?? 0) > 0) {
    amount = Math.round(line.unitPrice * qty * (rules.pricePct! / 100) * 100) / 100;
  } else review.push("price");
  // What the customer wrote (engraving, notes) and the order's note go to the factory's instructions.
  const props = line.properties.filter(p => p.key && !p.key.startsWith("_") && p.value).map(p => `${p.key}: ${p.value}`);
  const instructions = [
    `Shopify ${order.name} — ${line.title}${line.variantTitle ? ` (${line.variantTitle})` : ""}`,
    ...props,
    ...(order.note?.trim() ? [`Order note: ${order.note.trim()}`] : []),
  ].join("\n").slice(0, 2000);
  return {
    jewelleryType, metal, productKarats, productColor: colourOf(metal), productSize: size, diamondType,
    designNumber: line.sku?.trim() || undefined, quantity: qty, amount, instructions, review,
  };
}

/* ─────────────── The stages a new order gets (as the app: lib/stages.ts middleStages + db.ts buildTimelineSteps) ─────────────── */

const HEAD = ["Order Submitted", "Order Approved"];
const TAIL = ["Dispatch", "Delivered"];
const BUILTIN_MIDDLE = ["CAD Designing", "In Production", "Certification", "Final Approval"];

/** The admin's middle stages when usable, else the built-in ones (the app's rule). */
export function middleStages(timelineStages: unknown): string[] {
  const set = Array.isArray(timelineStages) ? timelineStages.map(s => String(s ?? "").trim()) : [];
  const ok = set.length > 0
    && set.every(s => s && s.length <= 40)
    && new Set(set.map(lc)).size === set.length
    && !set.some(s => HEAD.includes(s) || TAIL.includes(s))
    && BUILTIN_MIDDLE.every(b => set.includes(b))
    && set.indexOf("CAD Designing") < set.indexOf("Final Approval")
    && set.indexOf("In Production") < set.indexOf("Final Approval");
  return ok ? set : [...BUILTIN_MIDDLE];
}

/** A new piece order's stages: Certification only when it is certified. */
export function newOrderSteps(timelineStages: unknown, certified = false): string[] {
  return [...HEAD, ...middleStages(timelineStages), ...TAIL].filter(s => s !== "Certification" || certified);
}

/* ─────────────── Back to Shopify ─────────────── */

/** Our stage as a Shopify tag — "Stage: In Production". */
export const stageTag = (prefix: string, status: string) => `${prefix || "Stage"}: ${status}`;
/** Every tag our stages can be, so the old one is taken off when the stage moves. */
export const STAGE_STATUSES = ["Waiting", "Approved", "In Production", "Ready", "Dispatched", "Delivered", "Rejected"];

const CARRIERS = ["UPS", "USPS", "FedEx", "DHL Express", "DHL eCommerce", "Canada Post", "Royal Mail", "Australia Post", "Purolator",
  "Blue Dart", "Delhivery", "DTDC", "Ecom Express", "India Post", "Xpressbees", "Shadowfax", "Ekart", "Aramex", "TNT", "GLS", "DPD",
  "Hongkong Post", "SF Express", "Japan Post", "Brinks", "Malca-Amit", "Ferrari Group"];
/** The courier as Shopify names it, when it is one of theirs (the exact spelling); else as typed. */
export function shopifyCarrier(name: string | undefined): string | undefined {
  const v = lc(name);
  if (!v) return undefined;
  const hit = CARRIERS.find(c => lc(c) === v) ?? CARRIERS.find(c => v.includes(lc(c)) || lc(c).includes(v))
    ?? (v.includes("dhl") ? "DHL Express" : v.includes("fedex") || v.includes("fed ex") ? "FedEx" : undefined);
  return hit ?? name!.trim();
}

/** "1234" from "gid://shopify/Order/1234". */
export const legacyOf = (gid: string) => String(gid ?? "").split("/").pop() ?? "";
