// Firebase-backed database for Shree Suktam Diamond (Diamond Flow).
//
// The whole app is written against a synchronous store (loadDb / saveDb /
// updateDb) plus a "starlink-db-updated" DOM event that triggers re-renders.
// To keep every page working unchanged, that synchronous API is preserved:
//   • loadDb()  returns an in-memory cache (populated at boot from Firestore).
//   • saveDb()/updateDb() mutate the cache, fire the event optimistically, and
//     asynchronously diff-sync the change to the "diamondflow" Firestore DB.
//   • onSnapshot listeners keep the cache in sync across devices in real time.
// Images/videos live in Firebase Storage; docs store only download URLs.
// The `session` (which user is logged in) stays in localStorage — it is
// per-device and must not be shared through Firestore.
import { fmtCcy, type CurrencyCode, type CurrencyRate, type FxQuote } from "@/lib/currency";
import {
  collection,
  doc,
  onSnapshot,
  setDoc,
  writeBatch,
  query,
  where,
  getDoc,
  getDocFromCache,
  getDocs,
  getCountFromServer,
  documentId,
  type Query,
  type DocumentData,
  type DocumentSnapshot,
} from "firebase/firestore";
import { LAZY_COLS } from "./pageData";
import { db as fsdb, auth as fbAuth, isAdminEmail } from "./firebase";
import { describeChanges, summarise, undoBlocker, type ActivityEntry, type ActivityKind } from "./activityFormat";
import { moduleForPath } from "./modules";
import { reachOf, type AccessDoc } from "./permissions";

export type Role = "admin" | "employee" | "client";

export interface User {
  id: string;
  username: string;
  password: string;
  role: Role;
  name: string;
  email: string;
  phone?: string;
  photo?: string;
  status: "active" | "inactive";
  department?: string;
  clientId?: string;
  /** The role an employee holds (StaffRole.id). Unset means Standard staff —
   *  exactly what every employee could do before roles. Ignored for admins. */
  roleId?: string;
  /** The companies an employee sells for — the ones they may put a new client
   *  under. Unset or empty = every company (all staff from before companies). */
  companyIds?: string[];
  createdAt: string;
  // Firebase Auth uid — set only on the admin profile (admins authenticate via
  // Firebase Authentication). Used to match the profile independently of email.
  authUid?: string;
  // Web push (FCM) registration tokens — one per browser/device this user has
  // granted notification permission on. The sendNotificationPush Cloud
  // Function (functions/src/notifications.ts) reads this to deliver a real
  // OS-level push whenever a Notification doc is created for this user.
  fcmTokens?: string[];
  // Heartbeat timestamp, refreshed every ~45s while this user has the app open
  // (see src/lib/presence.ts) — drives the online/offline + "last seen" display
  // on the Clients page. Not real socket presence, just recency of activity.
  lastActiveAt?: string;
  // Opening salary/payment already paid to this employee BEFORE the app (for a
  // running business being migrated). Added onto their "total paid to date" and
  // shown as the first line of their salary ledger, in its own currency.
  openingPaid?: number;
  openingPaidCurrency?: "INR" | "USD";
  openingPaidDate?: string;
}

export interface Client {
  id: string;
  companyName: string;
  ownerName: string;
  email: string;
  phone: string;
  country: string;
  zip?: string;
  gstVat: string;
  address: string;
  username: string;
  /** No longer saved — the login's password lives only in Firebase Auth.
   *  Older records had it in plain text; dropStoredClientPasswords() removes it. */
  password?: string;
  status: "active" | "inactive";
  accountManagerId?: string;
  /** Which of our companies sells to this client — its invoices, proformas and
   *  statements carry that company's name, logo, bank and number series. Unset
   *  = the first company (every client from before there was more than one). */
  companyId?: string;
  createdAt: string;
  // Overpayment carried forward as advance credit — auto-applied (oldest bill
  // first) whenever a payment is recorded or "Apply Credit" is used.
  creditBalance?: number;
  // Explicit per-client grant for the Product Photos page — unset/false means
  // that client can't see it (avoids exposing other clients' designs by default).
  productPhotoAccess?: boolean;
  // Gift Card & Cashback — OFF by default; turned on per client by an admin.
  // Gates the client "Giftcard" sidebar/page, welcome-card issuing, and cashback earning.
  giftCardEnabled?: boolean;
  cashbackPercent?: number; // optional per-client override of Settings.cashbackPercent
  giftMaxRedeemPercent?: number; // optional per-client override of the max % of an order a gift card may cover
  // Opening balance carried in from a previous system when this client was
  // added to a running business — see OpeningBalanceInfo. `debit` = client owes
  // us (adds to outstanding); `credit` = we owe them / they prepaid (adds to credit).
  openingBalance?: number;
  openingDir?: LedgerDir;
  openingDate?: string; // ISO — the "as of" date shown on the opening ledger line
}

/** Debit/Credit direction for a migration opening balance, from OUR books:
 *  "debit" = the counterparty owes us; "credit" = we owe them (their advance). */
export type LedgerDir = "debit" | "credit";

/** Opening balance an entity (client/supplier/factory) carried in from a
 *  previous system. Stored once at migration; folded into that entity's
 *  account summary AND shown as the first, dated line of its ledger. */
// Pure helpers, kept with the account calculations so the server can use the
// very same code (see src/lib/pure). Re-exported so nothing that imports them
// from here changes.
import type { MaterialDef, MaterialKey } from "./materials";
export type { MaterialDef, MaterialKey } from "./materials";
import { KARAT_PURITY, toPureGold, pureFromPurity, openingDebitAmt, openingCreditAmt, hasOpeningBalance } from "./pure/basics";
export { KARAT_PURITY, toPureGold, pureFromPurity, openingDebitAmt, openingCreditAmt, hasOpeningBalance };

export interface OpeningBalanceInfo {
  openingBalance?: number;
  openingDir?: LedgerDir;
  openingDate?: string;
}


// Streamlined production stages. "Certification" is only added for orders that
// are certified (see buildTimelineSteps). Names "CAD Designing", "Final Approval",
// "Dispatch" and "Delivered" are relied on by status/section logic — keep them.
export const TIMELINE_STEPS = [
  "Order Submitted",
  "Order Approved",
  "CAD Designing",
  "In Production",
  "Certification",
  "Final Approval",
  "Dispatch",
  "Delivered",
] as const;
// Loose on purpose: orders created before the list was shortened still hold older
// step names, so the field type isn't constrained to the current literal union.
export type TimelineStep = string;

/** Timeline steps for a NEW order — the "Certification" stage is included only
 *  when the order will be certified. */
// Standard gold purity by karat — used to convert a finished piece's net weight
// (in its karat) to pure/fine gold (24KT equivalent) when deducting from a
// factory's gold, per the client's spec. Keyed by the karat number so "18K",
// "18KT", "18kt" all resolve.
/**
 * The purity a factory actually works to, per karat (‰). Not the theoretical
 * figure — 14KT is 583‰ on paper but a factory casts and bills at 595. These
 * are the numbers the trade uses, offered as one-tap choices at Final Approval
 * so nobody retypes them; a factory that works to something else can still be
 * entered by hand.
 */
export const FACTORY_PURITY: Record<string, number> = {
  "9K": 390,
  "10K": 430,
  "14K": 595,
  "18K": 760,
};





/** 1 carat = 0.2 grams — for gross-weight (gold + diamond) maths. */
export const CARAT_TO_GRAM = 0.2;

/** The "metal" picked when the client is buying loose or certified stones and
 *  no jewellery is made. Nothing is designed, cast or set, so these orders have
 *  no production stages and never go to a factory — the diamond is bought (or
 *  already held) and dispatched. */
export const DIAMOND_ONLY_METAL = "None (Diamond only)";

export function isDiamondOnlyOrder(o: { metal: string }): boolean {
  return o.metal === DIAMOND_ONLY_METAL;
}

/** The picture that stands for an order: its CAD, else a photo of the finished
 *  piece, else a reference image. A diamond-only order never has a CAD, so its
 *  product photo or reference image is what shows. */
export function orderImage(o: { cadImage?: string; productPhotos?: string[]; images?: string[] }): string | undefined {
  return o.cadImage || o.productPhotos?.[0] || o.images?.[0] || undefined;
}

/** Stages that exist only because a piece is being MADE. A diamond-only order
 *  has none of them — there is nothing to design, produce or sign off. */
const PRODUCTION_ONLY_STEPS = new Set(["CAD Designing", "In Production", "Final Approval"]);

export function isProductionStep(step: string): boolean {
  return PRODUCTION_ONLY_STEPS.has(step);
}

/** Today, as the yyyy-mm-dd an <input type="date"> wants, in LOCAL time —
 *  toISOString() would hand back yesterday for anyone east of UTC late at night. */
export function todayLocal(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/**
 * The local calendar day an ISO stamp falls on, as <input type="date"> wants it.
 *
 * Slicing the first ten characters of the ISO string gives the UTC day, which
 * is yesterday for anyone east of UTC in the early hours — so a date entered
 * at 2am in India reads back a day earlier, and saving the form again moves it
 * back another day. The round trip has to go through local time, the same way
 * todayLocal does.
 */
export function dayOf(iso: string): string {
  const d = new Date(iso);
  if (isNaN(+d)) return "";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** The chosen day, carrying the current time of day so entries made on the same
 *  date still sort in the order they were recorded. */
export function stampFor(day: string): string {
  const now = new Date();
  if (!day) return now.toISOString();
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y, (m || 1) - 1, d || 1, now.getHours(), now.getMinutes(), now.getSeconds()).toISOString();
}

/**
 * `middle` is the admin's own order for the stages between approval and
 * dispatch (see stages.ts middleStages) — the built-in order when not given.
 * An admin's own stages are steps in making a piece, so a diamond-only order,
 * where nothing is made, skips them along with CAD, production and approval.
 */
export function buildTimelineSteps(hasCertificate: boolean, diamondOnly = false, middle?: string[]): string[] {
  const order = middle && middle.length
    ? ["Order Submitted", "Order Approved", ...middle, "Dispatch", "Delivered"]
    : (TIMELINE_STEPS as readonly string[]);
  const builtin = (s: string) => (TIMELINE_STEPS as readonly string[]).includes(s);
  return order.filter(
    (s) => (s !== "Certification" || hasCertificate) && !(diamondOnly && (isProductionStep(s) || !builtin(s))),
  );
}

// A Ready-Stock (in-house) order has no client, so it skips the client-approval
// and shipping stages — just design, produce, sign off what the factory actually
// used, then add the finished piece to stock.
//
// "Final Approval" is where a piece's real gold weight, purity and labour are
// recorded. A stock build had no such stage, so none of that could be entered
// and the finished piece reached stock carrying only the estimates it started
// with. A piece made for stock is made the same way as one made to order.
export const READY_STOCK_TIMELINE_STEPS = ["Order Submitted", "CAD Designing", "In Production", "Final Approval", "Ready for Stock"] as const;
/** A stock build follows the admin's middle stages too — minus Certification,
 *  which is for a client — and ends at Ready for Stock instead of shipping. */
export function buildReadyStockTimelineSteps(middle?: string[]): string[] {
  if (!middle || !middle.length) return [...READY_STOCK_TIMELINE_STEPS];
  return ["Order Submitted", ...middle.filter(s => s !== "Certification"), "Ready for Stock"];
}

// Selling an EXISTING finished piece from Ready Stock — the piece is already made,
// so there's no design/production: just confirm, dispatch, deliver.
export const READY_STOCK_SALE_TIMELINE_STEPS = ["Order Confirmed", "Dispatch", "Delivered"] as const;
export function buildReadyStockSaleTimelineSteps(): string[] {
  return [...READY_STOCK_SALE_TIMELINE_STEPS];
}

/** Order status derived purely from how many timeline steps are done — so a
 *  reverted (undone) stage downgrades the status correctly, not just upgrades. */
export function statusFromTimeline(timeline: Order["timeline"], forReadyStock = false, readyStockSale = false): Order["status"] {
  const total = timeline.length;
  const done = timeline.filter(t => t.status === "done").length;
  // In-house Ready-Stock builds have no client-approval/shipping stages: they just
  // stay "In Production" until the final step, then "Ready" (piece ready for stock).
  if (forReadyStock) return done >= total ? "Ready" : "In Production";
  const dispatchIdxA = timeline.findIndex(x => x.step === "Dispatch");
  // Ready-Stock SALE of an existing piece: Confirmed → (Ready) → Dispatch → Delivered.
  if (readyStockSale) {
    if (done >= total) return "Delivered";
    if (dispatchIdxA >= 0 && done >= dispatchIdxA + 1) return "Dispatched";
    return "Ready";
  }
  const finalApprovalIdx = timeline.findIndex(x => x.step === "Final Approval");
  const dispatchIdx = timeline.findIndex(x => x.step === "Dispatch");
  if (done >= total) return "Delivered";
  if (dispatchIdx >= 0 && done >= dispatchIdx + 1) return "Dispatched";
  if (finalApprovalIdx >= 0 && done >= finalApprovalIdx + 1) return "Ready";
  // A diamond-only order has no production stages at all, so counting steps
  // must never label it "In Production" — nothing is being made.
  if (done >= 3) return timeline.some(x => x.step === "In Production") ? "In Production" : "Ready";
  if (done >= 2) return "Approved";
  return "Waiting";
}

export interface TimelineEntry {
  step: TimelineStep;
  status: "pending" | "in_progress" | "done";
  date?: string;
  employeeId?: string;
  department?: string;
  remarks?: string;
  photo?: string;
}

export interface AdvancePayment {
  id: string;
  amount: number;
  note: string;
  recordedBy: string; // userId
  createdAt: string;
  // Optional — which Locker this payment was actually deposited into (and how
  // much landed there, in that locker's own currency). Lets client revenue
  // feed into the same cash-position/profit view as manufacturing costs,
  // without changing `amount` (always USD, drives orderTotal/balanceDue).
  lockerId?: string;
  lockerAmount?: number;
  /** The receipt this money came in on. One receipt can land on several orders,
   *  so this is what lets a receipt be edited or deleted as a single event. */
  receiptId?: string;
  /** Credit the client already had, moved onto a bill. It is not a fresh
   *  payment, so it has no receipt of its own and never needs one — the
   *  receipt that brought the money in still carries it. */
  fromCredit?: boolean;
}

// Manufacturing events shown alongside (but never mixed into) the fixed,
// index-based `timeline` array — see Order.manufacturingLog below.
export type ManufacturingLogEntryType =
  "material_purchased" | "factory_assigned" | "material_issued" | "material_returned" | "piece_finished" | "making_charge_added";

/**
 * A melted piece — what came out of it and where it went. Written once, by
 * lib/melt.ts; the order is closed (Rejected) at the same moment.
 */
export interface OrderMelt {
  at: string;
  by: string;
  byName: string;
  reason?: string;
  /** The metal: back to a factory (into its pool) or into our own stock. */
  gold?: { to: "factory" | "stock"; factoryId?: string; grams: number; purity: string; issuanceId?: string };
  /** Loose stones put back in stock. */
  diamonds: { quality: string; ct: number }[];
  /** Certified packets put back in stock. */
  packetIds: string[];
  /** Other materials in the piece (Settings → Materials), back in stock as they were. */
  others?: { material: MaterialKey; grade: string; qty: number }[];
  /** The job's labour — still owed to the factory, left in its ledger. */
  labourInr: number;
  /** Advance the client had paid, moved to their credit. */
  advanceToCredit?: number;
  /** The factory that melted it (when there was one), and its melting / refining charge, owed in its ledger. */
  meltedBy?: string;
  chargeInr?: number;
}

/**
 * Pieces of a sold order that the client sent back — a sales return, written
 * once by lib/salesReturn.ts. The sale itself is never edited: the credit
 * comes off what the client owes on this order (orderTotal), and the credit
 * note that carries it is printed against the original invoice. One credit
 * note can cover pieces from several orders (they share `noteId`).
 */
export interface OrderReturn {
  id: string;
  noteId: string;
  creditNoteNo: string;     // "CN-0001"
  invoiceId?: string;       // the invoice the pieces were billed on, when there was one
  at: string;
  by: string;
  byName: string;
  reason?: string;
  qty: number;              // pieces back (of order.quantity)
  valueUsd: number;         // their share of the order value
  giftBackUsd?: number;     // their share of a redeemed gift card — back on that card
  shippingBackUsd?: number; // shipping refunded with them
  certificateBackUsd?: number;
  feeUsd?: number;          // a return / restocking charge the client still pays
  cashbackBackUsd?: number; // cashback the pieces had earned, taken back off the unused card
  cashbackChargedUsd?: number; // …and the part the client had already spent, left on their bill
  /** What comes off the bill: value − giftBack + shippingBack + certificateBack − fee. */
  creditUsd: number;
  /** Money already paid on the order that the credit freed — moved to the client's credit. */
  toCreditUsd?: number;
  /** "coming" until the parcel reaches us; then the piece is in Ready Stock. */
  status: "coming" | "received";
  location?: string;        // where it comes back to (Ready Stock location)
  priceUsd?: number;        // selling price per piece for Ready Stock
  receivedAt?: string;
  receivedBy?: string;
  readyStockId?: string;    // the Ready Stock item it went into
}

export interface ManufacturingLogEntry {
  id: string;
  type: ManufacturingLogEntryType;
  at: string;
  employeeId?: string;
  factoryId?: string;
  material?: MaterialKey;
  amountMaterial?: number; // in the material's unit
  amountInr?: number;
  remarks?: string;
}

export interface Order {
  id: string;
  orderNumber: string;
  // Set only when a duplicate order number was repaired (Settings -> Data).
  // Keeps the original visible so old paperwork can still be traced.
  previousOrderNumber?: string;
  // Two-tone pieces — a SECOND metal used alongside the gold, captured at
  // Final Approval (e.g. platinum bezel on a gold ring, or gold + silver).
  otherMetal?: string;        // "Platinum" | "Silver" | "White Gold" | …
  otherMetalWeight?: number;  // grams
  otherMetalPurity?: number;  // ‰ (e.g. 950 for platinum) — optional
  clientId: string; // empty string when forReadyStock (in-house build, no client)
  forReadyStock?: boolean; // in-house order that becomes a Ready Stock item when finished
  readyStockCreatedId?: string; // ReadyStockItem.id created from this order (once "Add to Ready Stock" is done)
  /** The finished piece was melted (lib/melt.ts) — it no longer exists. */
  melted?: OrderMelt;
  /** The company the order is for, fixed when it is placed: the client's, or
   *  for an in-house build the one chosen. Unset (older orders) = the client's. */
  companyId?: string;
  /** Pieces the client sent back after the sale (lib/salesReturn.ts). */
  returns?: OrderReturn[];
  // Gift card redeemed onto this order (a discount — reduces orderTotal). The card's
  // remaining balance is DERIVED from all orders that reference it (never trusted from the card doc).
  giftCardId?: string;
  giftCardRedeemed?: number; // USD applied from the gift card to this order
  cashbackIssued?: boolean; // guard so cashback is granted at most once (on delivery)
  contactPerson: string;
  jewelleryType:
    "Ring" | "Ring + Band" | "Pendant" | "Necklace" | "Bracelet" | "Earrings" | "Custom" | "Diamond Only";
  metal: "Gold" | "White Gold" | "Rose Gold" | "Platinum" | "Silver" | "Two Tone Casting" | "None (Diamond only)";
  diamondType: "Natural" | "Lab Grown";
  quantity: number;
  diamondWeight: number; // estimated diamond weight (ct) — entered at order creation
  metalWeight: number;
  // Estimated weights — entered at order creation (piece not made yet)
  estimatedGrossWeight?: number; // grams
  estimatedNetWeight?: number; // grams
  estimatedMakingCharges?: number; // flat $ making charge quoted when the factory is assigned (before the piece is made)
  // Actual details — filled in after production / Final Approval by admin
  actualGrossWeight?: number; // grams
  actualNetWeight?: number; // grams
  actualDiamondWeight?: number; // carats
  /** Carats added or taken off at Final Approval so OUR total matches the
   *  factory’s scale (they bill handling on their figure). Kept separately so
   *  the difference is visible rather than buried in the total. */
  diamondWeightAdjust?: number;
  /** How many stones the factory’s bill counts. */
  actualDiamondPcs?: number;
  /** Marked when the finished piece has no diamond in it at all — a plain gold
   *  band, or an estimate that called for stones the piece did not end up
   *  using. Final Approval waits for a diamond to be sourced because the order
   *  asked for one; this is how someone says it no longer does, on the record,
   *  instead of forcing the stage through. */
  noDiamond?: boolean;
  /** The factory's OWN bill number for this piece. One of their bills covers
   *  several pieces, but each comes back on its own, so without this there is
   *  nothing tying our entries to the bill they are being checked against —
   *  and a single wrong entry could not be found at all. */
  factoryBillNo?: string;
  actualMetalRate?: number; // $ per gram
  actualDiamondRate?: number; // $ per carat
  actualMakingCharges?: number; // flat $ making charges
  images: string[]; // up to 3 reference images (base64)
  instructions: string;
  expectedDelivery: string;
  priority: "Normal" | "Urgent" | "High Priority";
  status:
    "Waiting" | "Approved" | "Rejected" | "In Production" | "Ready" | "Dispatched" | "Delivered";
  assignedEmployeeId?: string;
  estimatedDelivery?: string;
  amount: number;
  shippingCharge: number;
  advances: AdvancePayment[];
  timeline: TimelineEntry[];
  createdAt: string;
  // Product specifications
  designNumber?: string;
  productSize?: string;
  productColor?: string; // "Yellow" | "Rose" | "White"
  productKarats?: string; // "9K" | "10K" | "14K" | "18K" | "22K" | "24K"
  // Delivery preference
  deliveryTime?: string;
  // Finishing options
  rhodium?: string; // "No Rhodium" | "Diamond Part White" | "Full White" | "Other"
  stamping?: string; // "No Stamping" | "KT Stamping" | "Diamond Weight + KT Stamp" | "Other"
  // CAD design image (uploaded after CAD Approved step)
  cadImage?: string;
  // Optional 3D model file (.3dm) — when present, the order shows a "View 360°"
  // button that opens it in the Starlink360 web viewer (mobile + desktop).
  cad3dmUrl?: string;
  // Dispatch info
  courierName?: string;
  trackingNumber?: string;
  trackingLink?: string;
  /** The day the parcel actually left, which is not always the day somebody
   *  got round to entering it. ISO; absent on orders dispatched before this
   *  was recorded, where the timeline's own stamp is the only date there is. */
  dispatchedAt?: string;
  /** The day it reached the client, on the same footing as dispatchedAt. */
  deliveredAt?: string;
  // Finished-product photography (captured at/after dispatch, optional). Photos
  // + one short video of the actual piece; shown on the dedicated Product Photos
  // page (grouped by design number), not the shared Catalog. Storage download URLs.
  productPhotos?: string[];
  productVideo?: string;
  // Certificate
  certificate?: boolean;
  certificateFee?: number; // editable per order

  // Manufacturing sourcing (optional — defaults to today's fully-manual flow
  // if never set). See src/lib/manufacturing.ts / src/lib/stock.ts.
  // "readyStock" = sold directly from finished-goods inventory (see
  // ReadyStockItem below) — no factory material issuance ever applies to it.
  materialSourcing?: "stock" | "purchase" | "readyStock";
  linkedPurchaseIds?: string[]; // Purchase docs with purpose:"order", orderId: this order
  materialIssuanceIds?: string[]; // MaterialIssuance docs for this order — each carries its own
                                   // factoryId, so this alone already supports >1 factory per order
  manufacturingLog?: ManufacturingLogEntry[]; // append-only; never index-mutated like `timeline`
  readyStockItemId?: string; // set iff materialSourcing === "readyStock"
  assignedFactoryId?: string; // pure informational tag — "this factory will make
    // this order." Moves no material and never affects manufacturingReadiness;
    // only an actual MaterialIssuance for this order does that.
}

export interface Task {
  id: string;
  title: string;
  assignedTo: string; // userId (employee)
  assignedBy: string; // userId (admin)
  completed: boolean;
  completedAt?: string;
  createdAt: string;
}

export interface Message {
  id: string;
  orderId?: string;
  fromUserId: string;
  toUserId: string;
  text: string;
  createdAt: string;
  read: boolean;
}

export interface Notification {
  id: string;
  userId: string;
  title: string;
  body: string;
  type: string;
  read: boolean;
  createdAt: string;
}

export interface Invoice {
  id: string;
  // Legacy single-order link — kept for backward compatibility. New invoices set
  // `orderIds` (one or many); for those, `orderId` mirrors orderIds[0]. Always
  // read the orders via invoiceOrderIds() so both shapes work.
  orderId: string;
  orderIds?: string[]; // all orders billed on this invoice (dispatch-batch invoicing)
  clientId: string;
  number: string;
  /** The number this invoice carried before the book was renumbered. Kept so a
   *  client holding the old copy can still be matched — search finds either.
   *  Same idea as Order.previousOrderNumber. */
  previousNumber?: string;
  amount: number; // snapshot at creation; the UI always recomputes live from the orders
  paid: boolean;
  /** The company that issued it — fixed when it is raised, so moving the client
   *  to another company later never changes a bill already sent. Unset = the
   *  first company (every invoice from before there was more than one). */
  companyId?: string;
  createdAt: string;
}

/** A gift card / cashback credit granted to a client (USD). The remaining
 *  balance is DERIVED from the orders that redeem it — never stored/trusted on
 *  the card doc (clients can write their own orders but not gift-card docs). */
export interface GiftCard {
  id: string;
  clientId: string;
  amount: number;           // USD originally granted
  source: "gift" | "cashback"; // "gift" = admin-issued any time; "cashback" = auto on delivery. (Legacy cards may say "welcome".)
  note?: string;
  issuedBy: string;         // admin userId, or "system" for cashback
  createdAt: string;
  expiresAt: string;        // ISO — 30 days from issue
  revoked?: boolean;        // admin cancelled it
  sourceOrderId?: string;   // for cashback: the order that earned it
  /** Cashback taken back because pieces of the order that earned it were returned. */
  takenBackUsd?: number;
}

export const GIFT_CARD_EXPIRY_DAYS = 30;
export const GIFT_MAX_REDEEM_PCT = 0.25; // a card may cover at most 25% of one order

/** All order ids on an invoice, tolerant of the legacy single-`orderId` shape. */
export function invoiceOrderIds(inv: Invoice): string[] {
  if (inv.orderIds && inv.orderIds.length) return inv.orderIds;
  return inv.orderId ? [inv.orderId] : [];
}

/** The invoice (if any) that already bills a given order — matches either shape. */
export function findInvoiceForOrder(invoices: Invoice[], orderId: string): Invoice | undefined {
  return (invoices || []).find(i => invoiceOrderIds(i).includes(orderId));
}

/** True when an order is already on some invoice (so it drops out of selection). */
export function orderInvoiced(invoices: Invoice[], orderId: string): boolean {
  return !!findInvoiceForOrder(invoices, orderId);
}

/** Next sequential invoice number, zero-padded (e.g. "0046"). */
export function nextInvoiceNumber(d: DB): string {
  const max = (d.invoices || []).reduce((m, i) => Math.max(m, parseInt(i.number, 10) || 0), 0);
  return String(max + 1).padStart(4, "0");
}

/**
 * Next order number — `SLJ-<year>-<seq>`. The sequence is one past the HIGHEST
 * existing order number, NOT the order count, so deleting/rejecting an order can
 * never make the next order reuse a live number (the old `1000 + orders.length`
 * did exactly that — two orders ended up sharing SLJ-2026-1035). Call inside
 * updateDb() so it reads the freshest list.
 */
export function nextOrderNumber(orders: Order[]): string {
  let max = 1000;
  for (const o of orders) {
    // Sequence is the trailing digit group ("SLJ-2026-1035" → 1035).
    const parts = (o.orderNumber || "").split("-");
    const seq = parseInt(parts[parts.length - 1], 10);
    if (!isNaN(seq) && seq > max) max = seq;
  }
  return `SLJ-${new Date().getFullYear()}-${String(max + 1).padStart(4, "0")}`;
}

/** An order is DISPATCHED once its Dispatch step is done, or it has moved past
 *  dispatch. Nothing else counts, whatever a screen thinks. */
export function orderIsDispatched(o: Order): boolean {
  return o.status === "Dispatched" || o.status === "Delivered"
    || o.timeline.some(t => t.step === "Dispatch" && t.status === "done");
}

/**
 * Create ONE invoice covering the given orders (dispatch-batch invoicing).
 *
 * THE ONLY WAY AN INVOICE IS EVER CREATED. It refuses any order that is not
 * dispatched, not priced, rejected, or already invoiced — the guard lives here
 * rather than in a screen, because screens kept finding new ways around it: a
 * bill printed on demand minted one, and a "generate missing invoice numbers"
 * button in Settings minted one for every priced order whether it had shipped
 * or not. Returns null when nothing is eligible. Call inside updateDb().
 */
export function createInvoiceFromOrders(d: DB, clientId: string, orderIds: string[], at: string, number?: string): Invoice | null {
  if (!d.invoices) d.invoices = [];
  const eligible = orderIds.filter(oid => {
    const o = d.orders.find(x => x.id === oid);
    return o && o.clientId === clientId && o.amount > 0 && o.status !== "Rejected"
      && orderIsDispatched(o) && !orderInvoiced(d.invoices, oid) && keptQty(o) > 0;
  });
  if (!eligible.length) return null;
  const amount = eligible.reduce((s, oid) => {
    const o = d.orders.find(x => x.id === oid)!;
    return s + orderTotal(o);
  }, 0);
  const allCleared = eligible.every(oid => balanceDue(d.orders.find(x => x.id === oid)!) <= 0);
  // Issued by the company the client buys from, and fixed to it from now on.
  // The first company is left unset, so its invoices keep the shape they always had.
  const companyId = d.clients.find(c => c.id === clientId)?.companyId;
  const inv: Invoice = {
    id: uid("inv_"), orderId: eligible[0], orderIds: eligible, clientId,
    number: number || nextInvoiceNumber(d), amount, paid: allCleared, createdAt: at,
    ...(companyId && companyId !== "main" ? { companyId } : {}),
  };
  d.invoices.push(inv);
  return inv;
}

// Categories are user-managed from Settings (Settings.expenseCategories) —
// this is just the fallback list for a settings doc that predates that field.
export const DEFAULT_EXPENSE_CATEGORIES = ["Salary", "Travel", "Food", "Tools", "Office", "Communication", "Other"];

/** Fallback account categories for a settings doc written before the field
 *  existed — Settings is where they are actually managed. */
export const DEFAULT_LOCKER_CATEGORIES = [
  "Client Payment", "Supplier Payment", "Factory Making Charges", "Owner Deposit",
  "Owner Withdrawal", "Bank Charges", "Local Expense", "Transfer",
  // Money in that is not a client settling a bill: what the exchange rate
  // gained or lost, income from elsewhere, and freight billed on.
  "$ Difference", "Extra Income", "Shipping Service",
  "Other",
];
export type ExpenseCategory = string;

export interface Expense {
  id: string;
  title: string;
  amount: number;
  category: ExpenseCategory;
  note?: string;
  employeeId: string; // userId of admin or employee who added it
  clientId?: string; // optional: which client this expense relates to
  // optional: the team member this expense PAID (salary / wages / advance /
  // bonus). Drives the per-employee "salary paid to date" ledger. Distinct from
  // `employeeId` (who recorded it).
  paidToEmployeeId?: string;
  // Currency of `amount` — the currency of the account (Locker) it was paid
  // from — any currency. Older records have no currency; treat those as INR (the local books).
  currency?: CurrencyCode;
  createdAt: string;
  lockerId?: string; // optional — which Locker this was actually paid from
  /** The orders this expense was incurred FOR — freight and insurance on a
   *  shipment, a lab fee on a stone. Set, it is a direct cost of those orders
   *  (split across them by value) and is left out of overheads; unset, it is
   *  an ordinary running cost of the business. */
  orderIds?: string[];
  /** The courier and tracking number a shipping cost belongs to. */
  shipmentRef?: string;
}

/** Format an expense amount in its own account currency (₹ default for legacy). */
export function fmtExpenseAmount(amount: number, currency?: CurrencyCode): string {
  return fmtCcy(amount, currency);
}

export interface CatalogFolder {
  id: string;
  name: string;
  parentId?: string | null; // null / undefined = root
  createdBy: string; // userId
  createdAt: string;
  bannerItemId?: string; // explicitly chosen cover image — falls back to the first image found if unset
  bannerUrl?: string; // that item's image URL, denormalized here so folder cards render without an extra fetch
}

export type CatalogItemType = "image" | "video" | "file";

export interface CatalogItem {
  id: string;
  folderId: string;
  name: string;
  type: CatalogItemType;
  data: string; // Firebase Storage download URL
  mime?: string; // original content type — set for "file" items (pdf, xls, zip…)
  createdBy: string; // userId
  createdAt: string;
}

// Manually-organised Product Photos library — staff create category folders,
// then product-id folders inside them, and upload images/videos. Folders reuse
// the CatalogFolder shape (nestable via parentId) but live in their OWN synced
// array (db.productPhotoFolders) so they never mix with the design Catalog.
// Media lives in Firebase Storage; only the download URL is stored here.
export interface ProductPhotoItem {
  id: string;
  folderId: string; // a folder in db.productPhotoFolders
  name: string;
  type: "image" | "video";
  url: string; // Firebase Storage download URL
  createdBy: string; // userId
  createdAt: string;
}

// A public, no-login share of one Catalog / Product-Photos folder. A SNAPSHOT:
// the folder's media (name + Storage URL) is copied in at share time, so the
// share doc is fully self-contained and exposes nothing but the shared media
// (Storage download URLs are already public/tokenized). Read by anyone via the
// /s/:id route (see firestore.rules — shares are the one public-read collection).
/** One folder inside a shared subtree, so a public link can be browsed exactly
 *  like the folder it came from instead of dumping every file into one grid. */
export interface ShareFolder {
  id: string;
  name: string;
  parentId: string | null; // null = the shared folder itself (the root of the link)
}
export interface ShareItem {
  type: CatalogItemType; // "image" | "video"
  url: string;
  name: string;
  folder?: string;   // originating sub-folder name, for grouping/labels
  folderId?: string; // which ShareFolder it belongs to; absent = the root
}
export interface Share {
  id: string;
  kind: "catalog" | "productPhotos";
  sourceFolderId: string; // the folder this snapshot was taken from (to find/refresh)
  title: string; // folder name shown to the public viewer
  items: ShareItem[];
  count: number;
  folders?: ShareFolder[]; // the sub-folder tree, so the link is browsable
  /** Items are split across shares/{id}/items/{0..pageCount-1} when the folder
   *  is too big for one Firestore document. 0 / absent = all of them are in
   *  `items` above. */
  pageCount?: number;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  expiresAt?: string; // ISO; empty/absent = never expires. After this, the public link redirects to the main site.
}

/**
 * One of our companies — a separate business, often in another country, with
 * its own name, branding, bank and invoice number series. The first company is
 * not stored here: it is the business's own settings (company name, Invoice &
 * Bill details), so everything from before there was more than one company is
 * simply the first company's, with nothing to migrate. See companies.ts.
 */
export interface Company {
  id: string;
  name: string;
  /** Printed after the name where the bill is signed — INC, LLC, LTD, PVT LTD. */
  legalSuffix?: string;
  country?: string;
  /** For display on its documents — billing itself stays in dollars. */
  currency?: string;
  /** Before every invoice number of this company: "SJD" → SJD-0001. */
  invoicePrefix: string;
  logoUrl?: string;
  address1?: string; address2?: string; address3?: string;
  tel?: string; primary?: string; email?: string; website?: string;
  taxLabel?: string; taxId?: string;
  terms?: string;
  qr1?: string; qr2?: string; stamp?: string;
  bankImage1?: string; bankImage2?: string;
  /** Bank / wire details as text, printed when there are no bank images. */
  bankText?: string;
  active?: boolean;
  createdAt: string;
}

export interface Settings {
  companyName: string;
  currency: string;
  language: string;
  notifications: boolean;
  diamondRate: number; // $ per carat
  metalRate: number; // $ per gram
  /** ₹ to the $ — converts an order's rupee cost so it can be set against its
   *  dollar selling price. ADMIN ONLY, like everything profit touches. Unset
   *  means no profit is stated at all rather than one worked out at a guess. */
  usdToInr?: number;
  /** ₹ to the $ over time, each rate in force from its date until the next.
   *  A sale is converted at the rate on the day it was made, not today's — the
   *  transaction-date rate, which is how the books are meant to be kept. ADMIN
   *  ONLY. Supersedes usdToInr, which remains the fallback when this is empty. */
  fxRates?: { from: string; rate: number }[];
  /** Rupees for one unit of each other currency, by date — what transfers,
   *  receipts into foreign accounts and foreign expenses are suggested and
   *  converted at. Readable by staff (they enter those); the dollar rate for
   *  profit stays the admin's own table above. */
  currencyRates?: CurrencyRate[];
  defaultShippingCharge: number; // $ flat default per order
  /** The middle of the production timeline, in the admin's order — the
   *  built-in stages plus any of their own. The start (Submitted, Approved) and
   *  the end (Dispatch, Delivered) never move. Applies to orders created after
   *  it is saved; an order keeps the stages it was created with. See stages.ts. */
  timelineStages?: string[];
  cashbackPercent?: number; // % of order value granted as a gift card on delivery (only to gift-card-enabled clients)
  giftMaxRedeemPercent?: number; // default max % of an order a gift card may cover (per-client overridable); blank = 25
  /** Our offices where Ready Stock is kept, in order. Unset = US, Hong Kong, India, Other. */
  readyStockOffices?: string[];
  barcodeBandEnabled?: boolean; // show the "Print Band" (barcode jewellery tag) option on orders. undefined = on.
  barcodeBandShowPrice?: boolean; // print the price on the band. undefined = on.
  labelPresets?: LabelPreset[]; // admin-defined label sizes/styles for each label printer / stock
  /** Google OAuth client id for Drive backups. Kept here rather than in a build
   *  variable so an admin can paste it in and connect straight away — needing a
   *  redeploy to change a setting is not a setting. Not a secret: a web OAuth
   *  client id is public by design and is useless without the authorised origin
   *  that pins it to this app. */
  googleClientId?: string;
  /** Our other companies — the first company is these settings themselves. */
  companies?: Company[];
  /** Materials beyond gold and diamonds — platinum, silver, gemstones, findings
   *  (Settings → Materials; see lib/materials.ts). Names and units only — no
   *  cost lives here, since clients read these settings too. */
  materials?: MaterialDef[];
  /** How every table in the app looks — Settings → Table Style. See tableStyle.ts. */
  tableUi?: { style: string; density: string; zebra: boolean; hover: boolean; lines: boolean; sticky: boolean };
  /** Settings → Appearance: the look of the whole app (see lib/appearance.ts). Absent = Classic. */
  appearance?: { look: string; accent: string; corners: string; headings: string; motion: string; width?: string; theme?: string };
  /** The first company's extras, alongside its Invoice & Bill details. */
  companyLegalSuffix?: string; // printed after the name on invoices, e.g. "PVT LTD"
  companyLogoUrl?: string;     // default the Shree Suktam logo
  companyCountry?: string;
  invoiceTaxLabel?: string;
  invoiceTaxId?: string;
  invoiceBankText?: string;
  invoiceWebsite?: string;
  // Invoice branding
  invoiceAddress1?: string; // Street line
  invoiceAddress2?: string; // City / area
  invoiceAddress3?: string; // State + ZIP
  invoiceTel?: string; // Tel No
  invoicePrimary?: string; // Primary phone
  invoiceEmail?: string; // Email shown on bill
  invoiceTerms?: string; // e.g. "COD"
  invoiceQr1?: string; // base64 – first QR (Venmo / payment)
  invoiceQr2?: string; // base64 – second QR
  invoiceStamp?: string; // base64 – authorised stamp/seal
  // Bank/wire details — uploaded as images (client provides their own pre-made
  // table, e.g. "USA Wire Details" / "Hong Kong Wire Details") so it prints
  // pixel-exact instead of being recreated with HTML/CSS.
  bankDetailsImage1?: string; // base64
  bankDetailsImage2?: string; // base64
  // User-managed expense categories (Settings page) — falls back to
  // DEFAULT_EXPENSE_CATEGORIES when unset (a settings doc from before this existed).
  expenseCategories?: string[];
  /** Categories for money in and out of an account (Locker / Payments). Managed
   *  from Settings so every entry is filed under a name the books recognise,
   *  instead of free text that never groups or totals. */
  lockerCategories?: string[];
  // Monotonic counter behind nextDiamondStockNumber() — never reused even if
  // a packet is later deleted, unset = no certified packet has been numbered yet.
  nextDiamondStockNo?: number;
}

/** A saved label profile — the size & layout to print a barcode band at, so it
 *  matches a specific label printer / roll. Chosen when printing a band. */
export interface LabelPreset {
  id: string;
  name: string;           // e.g. "Jewellery tag", "Godex 50x30"
  style: "tag" | "label"; // which band layout to use
  widthMm: number;
  heightMm: number;
}

export interface CatalogFavorite {
  userId: string;
  itemId: string;
}

// ─────────────────────────────────────────────────────────────────────────
// Manufacturing & Accounts — Locker (bank/cash), Supplier & Purchases,
// Factory (manufacturing + making charges). All INR-denominated — a
// second, separate ledger from the USD client-billing system above.
// Stock levels are NOT here — see src/lib/stock.ts (needs a genuinely
// different, transactional write path for correctness, not the ARRAY_COLS
// full-sync engine this file uses for everything else).
// ─────────────────────────────────────────────────────────────────────────

export type LockerType = "bank" | "cash";

export interface Locker {
  id: string;
  name: string; // "HDFC Current A/c", "Cash Drawer"
  type: LockerType;
  /** Any ISO currency — "INR", "USD", "AUD", "EUR"… (lib/currency.ts). Unset = INR,
   *  as every locker built before lockers held other currencies. */
  currency?: CurrencyCode;
  accountNumberLast4?: string;
  openingBalance: number; // in `currency` — one-time scalar, like Client.creditBalance
  createdAt: string;
  active: boolean; // soft-disable only — never delete once it has transactions
}

export type LockerTxnType = "income" | "expense" | "transfer_in" | "transfer_out";

export interface LockerTransaction {
  id: string;
  lockerId: string;
  type: LockerTxnType;
  amountInr: number; // always positive; sign implied by `type`. Despite the
  // name (kept for backward compatibility with every transaction recorded
  // before Lockers could hold USD), this is "amount in the locker's own
  // currency" — see `currency` below, format with fmtLockerAmount().
  currency?: CurrencyCode; // the parent locker's currency; undefined = "INR"
  category?: string; // "Supplier Payment" | "Factory Making Charges" | "Owner Deposit" | "Local Expense" | ...
  refType?: "purchase" | "materialIssuance" | "manual" | "transfer" | "clientPayment" | "expense" | "supplierReceipt" | "diamondSale";
  refId?: string; // Purchase.id / MaterialIssuance.id / Order.id / Expense.id, when auto-generated by a payment entry
  pairedLockerId?: string; // transfer_in/transfer_out: the other side of the transfer
  // On a cross-currency transfer pair between rupees and dollars (same value on
  // both sides): "₹ per $1 USD", whichever side is USD (as Purchase.exchangeRate);
  // any other pair carries `fx` instead — read both with rateOf(). On a client
  // payment into a non-USD locker: that locker's currency per $1 (₹ per $ for a
  // rupee locker, A$ per $ for an Australian one), as ClientReceipt.exchangeRate.
  // Unset for same-currency movements — amountInr is literal.
  exchangeRate?: number;
  /** The rate a cross-currency transfer was made at, any two currencies:
   *  1 `from` = `rate` `to` (same on both legs). Rupees and dollars still carry
   *  exchangeRate as well; read either with rateOf() in lib/currency.ts. */
  fx?: FxQuote;
  note?: string;
  recordedBy: string; // userId
  createdAt: string;
  receiptId?: string; // the ClientReceipt this deposit belongs to
  /** The payment entry (supplier/factory payment, expense) this movement was
   *  created by, so correcting that entry can find and move this row with it. */
  paymentId?: string;
  /** Marked by staff as money that is not a client payment at all — capital
   *  put in, interest, profit from elsewhere. It stops being offered for
   *  matching to a client, which is why it can be turned back off. */
  notClientPayment?: boolean;
  /** Sequential voucher number ("V-0042") — what a person quotes when they refer
   *  to a cash entry. Reserved atomically, so two people banking at once cannot
   *  be handed the same one. */
  voucherNo?: string;
  /** Both legs of a locker-to-locker transfer carry the same id, so correcting
   *  one can move the other with it instead of leaving the pair disagreeing. */
  transferId?: string;
}

export interface Supplier {
  id: string;
  name: string;
  contactPerson?: string;
  phone?: string;
  email?: string;
  address?: string;
  gstin?: string;
  createdAt: string;
  active: boolean;
  // Opening balance carried in at migration. `credit` = we owe them (unpaid old
  // bills — the usual case); `debit` = they owe us (we hold their credit).
  openingBalance?: number;
  openingDir?: LedgerDir;
  openingDate?: string;
}

/** "gold", "diamond", or an admin-defined material's id (lib/materials.ts). */
export type PurchaseMaterial = MaterialKey;
export type PurchasePurpose = "order" | "stock";
export type PurchaseCurrency = "INR" | "USD";

export interface GoldPurchaseDetail {
  weightGrams: number;
  purity: string; // "9K" | "14K" | "18K" | "22K" | "24K" — matches Order.productKarats vocabulary
  ratePerGram: number; // in the purchase's billing currency
}

// Standard diamond shapes for the loose-stock "bag" and packet records.
export const DIAMOND_SHAPES = [
  "Round", "Oval", "Pear", "Princess", "Emerald", "Marquise",
  "Cushion", "Radiant", "Heart", "Asscher", "Baguette", "Mix", "Other",
] as const;

export interface DiamondPurchaseDetail {
  carat: number;
  pieces?: number; // how many STONES (loose parcels are counted as well as weighed)
  quality?: string; // clarity/color grade, free text
  ratePerCarat: number; // in the purchase's billing currency
  // "loose" → pooled into stock by shape; "certified" → each stone an individual
  // packet (see DiamondPacket). Older records without this are treated as loose.
  kind?: "loose" | "certified";
  shape?: string; // one of DIAMOND_SHAPES — the loose-stock bucket key
  certificateNumber?: string;
  certificateLab?: string; // GIA / IGI / etc.
}

/** A material other than gold or diamond (lib/materials.ts): how much, of
 *  which grade, at what rate per unit of the material's own unit. */
export interface OtherPurchaseDetail {
  qty: number;
  grade?: string;
  ratePerUnit: number; // in the purchase's billing currency
  pieces?: number;     // how many, when counted by weight (stones in a parcel)
}

/**
 * A single CERTIFIED diamond — tracked as its own packet (never pooled), because
 * each has a unique certificate. Loose diamonds instead live as a running carat
 * total per shape in stockLevels (src/lib/stock.ts).
 */
export interface DiamondPacket {
  id: string;
  /** The company this belongs to — each company holds its own stock. Unset = the first company. */
  companyId?: string;
  stockNumber?: string; // short sequential label ("DP-0007") assigned at creation — how staff find one specific stone among hundreds in stock, since shape/carat/cert alone isn't quick to scan or search
  shape: string;
  carat: number; // size / weight
  quality?: string;
  // Full grading details (from the certificate / report).
  color?: string;
  clarity?: string;
  cut?: string;
  polish?: string;
  symmetry?: string;
  fluorescence?: string; // "FL"
  measurement?: string;  // e.g. "6.5 x 6.5 x 4.0 mm"
  certificateNumber: string; // report number
  certificateLab?: string;
  ratePerCaratInr?: number; // cost basis (INR) for reference
  supplierId?: string;
  purchaseId?: string;
  status: "in_stock" | "issued" | "used" | "sold";
  orderId?: string; // set once issued/used against an order
  createdBy: string;
  createdAt: string;
}

/** A diamond (loose, pooled by shape/quality — or one specific certified
 *  packet) sold directly to a buyer, not incorporated into any jewellery
 *  order. Loose sales deduct stockLevels via decreaseStockSelfHealing, same
 *  as any other issuance; certified sales flip the packet's status to "sold"
 *  instead (it's never pooled). */
export interface DiamondSale {
  id: string;
  /** The company this belongs to — each company holds its own stock. Unset = the first company. */
  companyId?: string;
  kind: "loose" | "certified";
  shape: string; // bucket key (loose) or the packet's own shape (certified)
  quality?: string; // loose only, optional
  packetId?: string; // set iff kind === "certified"
  carat: number;
  ratePerCarat: number;
  currency: PurchaseCurrency;
  totalUsd?: number;
  exchangeRate?: number;
  totalInr: number;
  clientId?: string; // set iff sold to an existing client
  buyerName?: string; // free text — set iff no clientId
  lockerId?: string; // set iff sale proceeds were deposited into a Locker
  notes?: string;
  soldBy: string; // userId
  createdAt: string;
}

export interface PurchasePayment {
  id: string;
  amountInr: number;
  lockerId: string; // which Locker this payment came from
  recordedBy: string;
  createdAt: string;
  note?: string;
}


/**
 * ONE payment received from a client — the thing a receipt book records.
 *
 * The money itself lands on their orders as advances (a single payment can
 * settle several) and in a locker as a deposit. Those are the accounting
 * effects; THIS is the event, with its own receipt number, so it can be looked
 * up, corrected or cancelled as one entry instead of hunting down the pieces it
 * turned into. Every advance and locker row it created carries its `receiptId`.
 */
export interface ClientReceipt {
  id: string;
  receiptNo: string;      // sequential, reserved atomically — "0871"
  clientId: string;
  date: string;           // ISO — the date the money was received (editable)
  amountUsd: number;      // what it settles of their billing (orders are billed in USD)
  lockerId?: string;
  lockerAmount?: number;  // what landed in the locker, in the locker's own currency
  lockerCurrency?: CurrencyCode;
  /** The locker's currency for $1 (₹ per $ for a rupee locker, A$ per $ for an
   *  Australian one), when the locker isn't USD: lockerAmount = amountUsd × this. */
  exchangeRate?: number;
  method: string;         // Cash / Bank Transfer / UPI / Cheque …
  remarks?: string;
  invoiceId?: string;     // the invoice it was sent for, when one was named
  recordedBy: string;
  createdAt: string;
  updatedAt?: string;
}

/** Money RECEIVED FROM a supplier (a refund, a return credit, an overpayment
 *  given back) — the opposite direction of a payment. Reduces what we owe the
 *  supplier (and can push the account into "supplier owes us" territory). Not
 *  tied to a single purchase; it's a supplier-level credit. */
export interface SupplierReceipt {
  id: string;
  supplierId: string;
  amountInr: number;
  lockerId: string; // which Locker the money landed in
  recordedBy: string;
  createdAt: string;
  note?: string;
}

/**
 * Money paid to a supplier that is not settling any particular bill — an
 * advance, or a loan between two businesses that trade with each other.
 *
 * A payment normally lives inside the Purchase it settles, which works right up
 * until there is no purchase to put it in: a supplier you have only ever lent
 * money to has no bills at all. Those payments used to be dropped on the floor,
 * leaving the money gone from the account but absent from the supplier's books.
 * This is the mirror of SupplierReceipt, which already records money coming the
 * other way for the same reason.
 */
export interface SupplierPayment {
  id: string;
  supplierId: string;
  amountInr: number;
  lockerId: string; // which Locker the money came out of
  recordedBy: string;
  createdAt: string;
  note?: string;
}

/**
 * Money paid to a factory that settles no particular job — an advance against
 * work to come, or a loan. The mirror of SupplierPayment, and there for the
 * same reason: a making-charge payment normally lives inside the issuance it
 * pays for, which leaves nowhere to put one when there is no job yet.
 */
export interface FactoryPayment {
  id: string;
  factoryId: string;
  amountInr: number;
  lockerId: string; // which Locker the money came out of
  recordedBy: string;
  createdAt: string;
  note?: string;
}

export interface Purchase {
  id: string;
  supplierId: string;
  material: PurchaseMaterial;
  gold?: GoldPurchaseDetail; // present iff material === "gold"
  diamond?: DiamondPurchaseDetail; // present iff material === "diamond"
  other?: OtherPurchaseDetail; // present iff material is an admin-defined material
  /** The company this belongs to — each company holds its own stock. Unset = the first company. */
  companyId?: string;
  purpose: PurchasePurpose;
  orderId?: string; // required iff purpose === "order"

  currency: PurchaseCurrency;
  totalUsd?: number; // set iff currency === "USD" — raw supplier invoice amount
  exchangeRate?: number; // set iff currency === "USD" — manually entered USD→INR rate AT PURCHASE TIME
  totalInr: number; // ALWAYS present — the one canonical amount every ledger function sums

  payments: PurchasePayment[]; // mirrors Order.advances[] — paid/pending are derived, never stored
  /** The percentage adjustment already applied to this line. Positive is a
   *  discount ("less 5%"); NEGATIVE is a charge added on ("plus 1.5%") — the
   *  GST or cash handling a supplier adds when there is no discount at all.
   *  Stored for the record only; totalInr/totalUsd are the adjusted figures. */
  discountPct?: number;
  /** What was knocked off (or added) to make the bill a round figure — the few
   *  rupees nobody actually hands over. Already inside totalInr; kept separately
   *  so a statement can explain why the total is not weight × rate. Negative
   *  when the bill was rounded DOWN, which is the usual direction. */
  roundOffInr?: number;
  invoiceNumber?: string;
  invoiceDate?: string;
  notes?: string;
  createdBy: string;
  createdAt: string;
}

export interface Factory {
  id: string;
  name: string;
  contactPerson?: string;
  phone?: string;
  address?: string;
  createdAt: string;
  active: boolean;
  // Opening making-charge balance at migration. `credit` = we owe the factory
  // (unpaid old labour — usual case); `debit` = the factory owes us.
  openingBalance?: number;
  openingDir?: LedgerDir;
  openingDate?: string;
  // Fine (24KT) gold already sitting at the factory when it was added to a
  // running business — added straight onto factoryFineGoldBalance().
  openingFineGold?: number;
  openingFineGoldDate?: string;
}

// Finished jewelry already sitting in physical inventory — separate from the
// raw-material Stock (gold grams / diamond carats, src/lib/stock.ts). Readable
// by clients too (like the Catalog) so they can pick a piece to buy directly
// in New Order; only staff can add/edit/adjust it (see firestore.rules).
export interface ReadyStockItem {
  id: string;
  name: string;
  jewelleryType: Order["jewelleryType"];
  metal: Order["metal"];
  productKarats?: string;
  grossWeight?: number; // grams
  netWeight?: number; // grams
  diamondWeight?: number; // carats
  diamondType?: "Natural" | "Lab Grown";
  price: number; // USD — sale price, matches client billing currency
  cost?: number; // USD — internal cost basis (materials + making). ADMIN-ONLY: never shown to employees or clients. Drives profit/loss.
  quantity: number; // identical pieces available — "Sold Out" is quantity === 0, never a separate stored flag
  images: string[]; // Storage URLs, up to 4 — same upload pattern as Order.images
  video?: string; // optional single product video (Storage URL)
  sku?: string;
  location?: string; // where the piece physically is — US / Hong Kong / India / Other
  notes?: string;
  createdBy: string;
  createdAt: string;
  /** A piece a client sent back — its cost is that order's cost per piece. */
  fromReturn?: { orderId: string; returnId: string };
  /** The company this belongs to — each company holds its own stock. Unset = the first company. */
  companyId?: string;
  /** Some pieces of an item moved to another office became this item there:
   *  the item they came from, so later moves rejoin them (lib/offices.ts). */
  splitFrom?: string;
  /** What happened to this piece, oldest first — the last 200 (lib/readyStockHistory.ts).
   *  Every client can read Ready Stock, so no cost figure or client name is ever written here. */
  history?: ReadyStockEvent[];
}

export type ReadyStockEventKind =
  | "added" | "edited" | "price" | "qty" | "moved" | "split"
  | "sold" | "unsold" | "returned" | "returnCancelled" | "cost";

/** One line of a Ready Stock piece's history. */
export interface ReadyStockEvent {
  at: string;
  /** User id of whoever did it. */
  by: string;
  /** Their name then — kept for staff only, never a client's. */
  byName?: string;
  kind: ReadyStockEventKind;
  text: string;
  /** The order, return or other lot it was about. */
  ref?: { orderId?: string; returnId?: string; itemId?: string };
}

export const READY_STOCK_LOCATIONS = ["US", "Hong Kong", "India", "Other"] as const;

export interface FinishedPiece {
  id: string;
  quantityUsed: number; // actual gold(g)/diamond(ct) that ended up in the finished piece(s) from this issuance
  piecesCount?: number;
  recordedAt: string;
  recordedBy: string;
  notes?: string;
}

export interface FactoryChargePayment {
  id: string;
  amountInr: number;
  lockerId: string;
  recordedBy: string;
  createdAt: string;
  note?: string;
}

/** Gold OR diamond issued to a Factory. `orderId` unset = a bulk delivery to
 *  this factory's own pool, not yet tied to any specific order (the client
 *  hands a factory gold in irregular batches well before any order exists).
 *  `source` distinguishes material drawn from the shared Stock pool (deducts
 *  stockLevels, see src/lib/stock.ts) from material bought specifically for
 *  an order via a Purchase with purpose:"order" (never entered Stock, so
 *  issuing it must NOT touch stockLevels — tracked via `sourcePurchaseId`
 *  instead), from material drawn out of a factory's own accumulated pool
 *  (no new physical movement — see factoryPoolBalance in manufacturing.ts). */
export interface MaterialIssuance {
  id: string;
  factoryId: string;
  orderId?: string; // unset = bulk delivery to this factory's pool
  material: MaterialKey;
  purityOrQuality: string;
  quantityIssued: number; // in the material's unit: grams (gold), carats (diamond), or the material's own
  /** Whose material this is at the factory — each company's pool and fine gold
   *  are kept apart. Unset = the first company. */
  companyId?: string;
  /** "melt": gold from a melted piece handed back to the factory (lib/melt.ts) —
   *  a delivery into its pool like any other, but not out of our stock. */
  /** "transfer": a share of a factory's pool moved from one company to another. */
  source: "stock" | "purchase" | "factoryPool" | "melt" | "transfer";
  /** source "melt": the order whose piece was melted. */
  meltOf?: string;
  sourcePurchaseId?: string; // set iff source === "purchase"
  diamondKind?: "loose" | "certified"; // for diamond issuances
  diamondPacketIds?: string[]; // set iff diamondKind === "certified" — the specific packets issued
  issuedAt: string;
  issuedBy: string;
  status: "open" | "closed"; // "closed" = wastage finalized
  finishedPieces: FinishedPiece[];
  makingCharges: { amountInr: number; payments: FactoryChargePayment[] };
  notes?: string;

  // ── Finished piece received back ("RCV" step). Captured when the order's
  // Receive form is saved; gold issuances convert the net weight to pure (24KT)
  // gold to net off the factory's fine-gold balance (see factoryFineGoldBalance). ──
  finishedNetWeight?: number; // grams of the finished piece (gold issuances)
  finishedKarat?: string;     // its karat, e.g. "18K" — legacy / label
  finishedPurity?: number;    // actual purity entered at Final Approval (‰, e.g. 750) — drives the pure-gold conversion
  finishDisposition?: "used" | "returned"; // certified diamond issuances: chosen at Final Approval (so a later edit knows the current state)
  finishReturnedCt?: number; // loose diamond issuances: carats returned to stock at Final Approval (partial allowed; used = issued − this)
  piecesIssued?: number;     // loose diamond issuances: how many stones went out
  finishReturnedPcs?: number; // loose diamond issuances: how many stones came back at Final Approval
  finishReturnedQty?: number; // other-material issuances: how much came back at Final Approval (used = issued − this)
  // Structured labour that makes up makingCharges.amountInr (the factory payable):
  //   perGramRate × net weight + cadCharge + diamondCt × diamondHandlingRate
  //   + otherCharges + metalByFactoryGrams × metalByFactoryRate
  labour?: {
    perGramRate?: number;
    /** A floor on the MAKING charge, for a piece too light to be worth making
     *  at the per-gram rate (a factory's card typically sets one under 2g and a
     *  lower one under 1g). Entered per order, because every factory's minimum
     *  and every weight band is its own. Diamond handling, CAD, other charges
     *  and metal the factory supplied are added on top, unaffected. */
    minimumLabour?: number;
    diamondHandlingRate?: number;
    cadCharge?: number;
    otherCharges?: number;
    metalByFactoryGrams?: number; // metal the factory supplied itself
    metalByFactoryRate?: number;  // ₹ per gram for that metal
  };
}

export type StockMovementType = "purchase_in" | "issuance_out" | "order_direct_use" | "adjustment";

export interface StockMovement {
  id: string;
  material: MaterialKey;
  type: StockMovementType;
  /** The company whose stock moved — unset is the first company. */
  companyId?: string;
  purityOrQuality: string;
  quantity: number; // always positive; direction implied by `type`
  /** "transfer": moved between our companies (in at the sending company's average cost). */
  refType?: "purchase" | "materialIssuance" | "order" | "diamondSale" | "manual" | "opening" | "transfer";
  refId?: string;
  // Value of this movement in ₹ — set for an "opening" stock entry (migration
  // stock already owned). Lets the stock ledger show the opening amount without
  // any supplier purchase (so it never touches a supplier's dues). Purchases
  // still derive their value from the linked Purchase, not this field.
  valueInr?: number;
  createdBy: string;
  createdAt: string;
  note?: string;
}

export interface DB {
  users: User[];
  clients: Client[];
  orders: Order[];
  tasks: Task[];
  messages: Message[];
  notifications: Notification[];
  invoices: Invoice[];
  giftCards: GiftCard[];
  expenses: Expense[];
  settings: Settings;
  catalogFolders: CatalogFolder[];
  catalogItems: CatalogItem[];
  catalogFavorites: CatalogFavorite[];
  productPhotoFolders: CatalogFolder[];
  productPhotoItems: ProductPhotoItem[];
  shares: Share[];
  lockers: Locker[];
  lockerTransactions: LockerTransaction[];
  suppliers: Supplier[];
  purchases: Purchase[];
  supplierReceipts: SupplierReceipt[];
  supplierPayments: SupplierPayment[];
  factoryPayments: FactoryPayment[];
  clientReceipts: ClientReceipt[];
  factories: Factory[];
  materialIssuances: MaterialIssuance[];
  stockMovements: StockMovement[];
  readyStock: ReadyStockItem[];
  diamondPackets: DiamondPacket[];
  diamondSales: DiamondSale[];
  /** ADMIN ONLY — loaded for the admin alone and refused to everyone else by
   *  the security rules. See AdminRecord. */
  adminRecords: AdminRecord[];
  /** Staff roles — named sets of what a holder may see and do. */
  roles: AccessDoc[];
  session: { userId: string | null };
}

/**
 * Figures only the admin may see, kept where only the admin can read them.
 *
 * Hiding a number on screen is not the same as keeping it private: anything in
 * a document a user can read is one browser console away from them. A ready-
 * stock item's cost sat on the item, which every client can read to browse the
 * shop — so every client could read what each piece cost. These live in their
 * own collection, which the rules give to the admin and nobody else, and which
 * is not even requested for anyone else.
 *
 *  • "fx"        — the dated ₹-to-$ rates that turn rupee cost into profit.
 *  • "stockCost" — what one ready-stock piece cost, in dollars.
 */
export type AdminRecord =
  | { id: "fx"; kind: "fx"; rates: { from: string; rate: number }[]; flat?: number }
  | { id: string; kind: "stockCost"; itemId: string; cost: number };

const LEGACY_KEY = "starlink_db_v2"; // pre-Firebase localStorage blob (migrated on first run)

function defaultSettings(): Settings {
  return {
    companyName: "Shree Suktam Diamond",
    currency: "USD",
    language: "English",
    notifications: true,
    diamondRate: 3500,
    metalRate: 65,
    defaultShippingCharge: 0,
    // The address and phone lines are set in Settings → Company.
    invoiceAddress1: "",
    invoiceAddress2: "",
    invoiceAddress3: "",
    invoiceTel: "",
    invoicePrimary: "",
    invoiceEmail: "online@ssdiam.in",
    invoiceTerms: "COD",
  };
}

function emptyDb(): DB {
  return {
    users: [],
    clients: [],
    orders: [],
    tasks: [],
    messages: [],
    notifications: [],
    invoices: [],
    giftCards: [],
    expenses: [],
    catalogFolders: [],
    catalogItems: [],
    catalogFavorites: [],
    productPhotoFolders: [],
    productPhotoItems: [],
    shares: [],
    lockers: [],
    lockerTransactions: [],
    suppliers: [],
    purchases: [],
    supplierReceipts: [],
    supplierPayments: [],
    factoryPayments: [],
    clientReceipts: [],
    factories: [],
    materialIssuances: [],
    stockMovements: [],
    readyStock: [],
    diamondPackets: [],
    diamondSales: [],
    adminRecords: [],
    roles: [],
    settings: defaultSettings(),
    session: { userId: null },
  };
}

// In-memory cache — the single source the synchronous UI reads from.
const cache: DB = emptyDb();
// Mirror of what we last know is in Firestore, used to diff on write.
let remote: DB = emptyDb();

/** Normalise an order loaded from storage (backward-compat with older shapes). */
function normalizeOrder(o: Order): Order {
  const n: Order = { ...o };
  if (n.shippingCharge == null) n.shippingCharge = 0;
  if (!n.advances) n.advances = [];
  if (!n.timeline) n.timeline = [];
  insertDiamondPurchaseStep(n);
  return n;
}

/**
 * Synchronous read used throughout the app. Cache is filled by startDb() after sign-in.
 * Returns a fresh top-level object (sharing nested arrays/objects) so callers
 * that do `setState(loadDb())` on the update event get a new reference and
 * re-render, while in-place mutations via updateDb() stay visible.
 */
export function loadDb(): DB {
  const view = { ...cache };
  return lazyMode ? guarded(view) : view;
}

export function totalAdvance(order: Order): number {
  return (order.advances || []).reduce((s, a) => s + a.amount, 0);
}

/** Jewellery value + shipping + certificate fee, BEFORE any gift-card discount. */
export function orderGrossTotal(order: Order): number {
  return order.amount + (order.shippingCharge || 0) + (order.certificateFee || 0);
}

/** The amount the client owes in full — gross minus any redeemed gift card (a
 *  discount) and minus the credit for any pieces they sent back. */
export function orderTotal(order: Order): number {
  return Math.max(0, Math.round((orderGrossTotal(order) - (order.giftCardRedeemed || 0) - returnedCredit(order)) * 100) / 100);
}

// ── Sales returns (lib/salesReturn.ts writes them) ──
/** Pieces of this order sent back. */
export function returnedQty(o: Order): number {
  return (o.returns ?? []).reduce((s, r) => s + r.qty, 0);
}
/** Pieces the client still has. */
export function keptQty(o: Order): number {
  return Math.max(0, (o.quantity || 1) - returnedQty(o));
}
/** What the returns took off the bill. */
export function returnedCredit(o: Order): number {
  return Math.round((o.returns ?? []).reduce((s, r) => s + r.creditUsd, 0) * 100) / 100;
}
/** The order value of the pieces the client kept (order value less returned pieces). */
export function keptValue(o: Order): number {
  return Math.max(0, Math.round(((o.amount || 0) - (o.returns ?? []).reduce((s, r) => s + r.valueUsd, 0)) * 100) / 100);
}
/** Every piece came back. */
export function fullyReturned(o: Order): boolean {
  return (o.returns?.length ?? 0) > 0 && keptQty(o) === 0;
}

export function balanceDue(order: Order): number {
  // Round to cents so a sub-cent floating residue never shows as a stray "$0" due.
  return Math.max(0, Math.round((orderTotal(order) - totalAdvance(order)) * 100) / 100);
}

// ── Gift cards (USD). remaining is DERIVED from orders, never stored on the card. ──
const r2 = (n: number) => Math.round(n * 100) / 100;

/** USD still available on a card = granted − everything redeemed across live orders. */
export function giftCardRemaining(card: GiftCard, orders: Order[]): number {
  // A returned piece puts its share of the discount back on the card.
  const used = orders.reduce((s, o) =>
    (o.giftCardId === card.id && o.status !== "Rejected")
      ? s + (o.giftCardRedeemed || 0) - (o.returns ?? []).reduce((g, r) => g + (r.giftBackUsd || 0), 0) : s, 0);
  return r2(Math.max(0, card.amount - (card.takenBackUsd || 0) - used));
}

export function giftCardExpired(card: GiftCard): boolean {
  return !!card.expiresAt && Date.now() > Date.parse(card.expiresAt);
}

/** Active = not revoked, not expired, and still has balance. */
export function giftCardActive(card: GiftCard, orders: Order[]): boolean {
  return !card.revoked && !giftCardExpired(card) && giftCardRemaining(card, orders) > 0.005;
}

/** A client's usable gift cards, soonest-to-expire first (so it's spent first). */
export function activeGiftCardsFor(d: DB, clientId: string): GiftCard[] {
  return (d.giftCards ?? [])
    .filter(c => c.clientId === clientId && giftCardActive(c, d.orders))
    .sort((a, b) => +new Date(a.expiresAt) - +new Date(b.expiresAt));
}

/** Total usable gift-card balance for a client (USD). */
export function giftCardBalanceFor(d: DB, clientId: string): number {
  return r2(activeGiftCardsFor(d, clientId).reduce((s, c) => s + giftCardRemaining(c, d.orders), 0));
}

/** Most a card can take off THIS order: min(card remaining, pct of gross, gross).
 *  `pct` is a fraction (0..1); defaults to the built-in 25% if not supplied. */
export function maxGiftRedeem(order: Order, card: GiftCard, orders: Order[], pct: number = GIFT_MAX_REDEEM_PCT): number {
  const gross = orderGrossTotal(order);
  return r2(Math.max(0, Math.min(giftCardRemaining(card, orders), gross * pct, gross)));
}

/** Effective max-redeem FRACTION (0..1) for a client: per-client override, else
 *  the global Settings default, else the built-in 25%. Admin-managed. */
export function giftMaxRedeemPctFor(d: DB, client: Client | undefined): number {
  const raw = client?.giftMaxRedeemPercent ?? d.settings.giftMaxRedeemPercent ?? GIFT_MAX_REDEEM_PCT * 100;
  return Math.min(1, Math.max(0, raw / 100));
}

/** Issue a gift card to a client (call inside updateDb). Expiry = 30 days out. */
export function issueGiftCard(d: DB, args: {
  clientId: string; amount: number; source: GiftCard["source"]; issuedBy: string; note?: string; sourceOrderId?: string; at: string;
}): GiftCard {
  if (!d.giftCards) d.giftCards = [];
  const expiresAt = new Date(Date.parse(args.at) + GIFT_CARD_EXPIRY_DAYS * 86400000).toISOString();
  const card: GiftCard = {
    id: uid("gc_"), clientId: args.clientId, amount: r2(args.amount), source: args.source,
    note: args.note, issuedBy: args.issuedBy, createdAt: args.at, expiresAt,
    ...(args.sourceOrderId ? { sourceOrderId: args.sourceOrderId } : {}),
  };
  d.giftCards.push(card);
  return card;
}

export type GiftCardStatus = "active" | "used" | "expired" | "cancelled";
/** Lifecycle status of a card (remaining derived from orders). */
export function giftCardStatus(card: GiftCard, orders: Order[]): GiftCardStatus {
  if (card.revoked) return "cancelled";
  if (giftCardRemaining(card, orders) <= 0.005) return "used";
  if (giftCardExpired(card)) return "expired";
  return "active";
}

export interface GiftCardStats { issued: number; used: number; pending: number; expired: number; count: number }
/** Reconciling totals across a set of cards: issued = used + pending + expired.
 *  pending = remaining on still-usable cards; expired = remaining that lapsed unused. */
/** What a card is worth: granted, less cashback taken back when its order's pieces were returned. */
export function giftCardGranted(card: GiftCard): number {
  return r2(Math.max(0, card.amount - (card.takenBackUsd || 0)));
}

export function giftCardStats(cards: GiftCard[], orders: Order[]): GiftCardStats {
  let issued = 0, used = 0, pending = 0, expired = 0;
  for (const c of cards) {
    const remaining = giftCardRemaining(c, orders);
    issued = r2(issued + giftCardGranted(c));
    used = r2(used + (giftCardGranted(c) - remaining));
    if (!c.revoked && !giftCardExpired(c)) pending = r2(pending + remaining);
    else expired = r2(expired + remaining);
  }
  return { issued, used, pending, expired, count: cards.length };
}

/** Effective cashback % for a client (per-client override, else global setting). 0 when off. */
export function cashbackPercentFor(d: DB, client: Client | undefined): number {
  if (!client?.giftCardEnabled) return 0;
  const pct = client.cashbackPercent ?? d.settings.cashbackPercent ?? 0;
  return pct > 0 ? pct : 0;
}


/**
 * Fill the given orders IN THE ORDER GIVEN, each up to its balance, and return
 * whatever is left over.
 *
 * The order is the caller's decision and this never second-guesses it: the
 * orders on one invoice when money was sent for that invoice, oldest bill first
 * when somebody has asked for their credit to be spread. Nothing re-sorts by
 * date behind the caller's back any more.
 */
export function allocateInOrder(
  orders: Order[],
  amount: number,
  recordedBy: string,
  at: string,
  note = "Payment received",
  fromCredit = false,
): number {
  let remaining = amount;
  for (const o of orders) {
    if (remaining <= 0) break;
    const bal = balanceDue(o);
    if (bal <= 0) continue;
    const pay = Math.min(remaining, bal);
    if (!o.advances) o.advances = [];
    o.advances.push({ id: uid("adv_"), amount: pay, note, recordedBy, createdAt: at, fromCredit: fromCredit || undefined });
    remaining -= pay;
  }
  return Math.round(remaining * 100) / 100; // leftover → credit
}

/**
 * Enforce the invariant that an order's advances never exceed its total. Trims
 * the newest advance entries down and returns the reclaimed excess so the caller
 * can move it to client credit. (Guards against repricing an order below what was
 * already paid, or an over-sized single payment.)
 */
export function capOrderAdvances(o: Order): number {
  const r2 = (n: number) => Math.round(n * 100) / 100;
  let excess = r2(totalAdvance(o) - orderTotal(o));
  if (excess <= 0) return 0;
  const reclaimed = excess;
  const adv = o.advances || [];
  for (let i = adv.length - 1; i >= 0 && excess > 0.001; i--) {
    if (adv[i].amount <= excess + 0.001) {
      excess = r2(excess - adv[i].amount);
      adv.splice(i, 1);
    } else {
      adv[i].amount = r2(adv[i].amount - excess);
      excess = 0;
    }
  }
  return reclaimed;
}

/**
 * The order a client's money should settle their bills in.
 *
 * Invoice by invoice, oldest invoice first, then anything not yet invoiced —
 * because that is how the client thinks about it. `firstInvoiceId` jumps one
 * invoice to the front: the one this particular transfer was sent for.
 */
function billingOrder(d: DB, clientId: string, firstInvoiceId?: string): Order[] {
  const invoices = (d.invoices ?? [])
    .filter(i => i.clientId === clientId)
    .sort((a, b) => {
      if (a.id === firstInvoiceId) return -1;
      if (b.id === firstInvoiceId) return 1;
      return +new Date(a.createdAt) - +new Date(b.createdAt);
    });
  const out: Order[] = [];
  const seen = new Set<string>();
  for (const inv of invoices) {
    for (const oid of invoiceOrderIds(inv)) {
      if (seen.has(oid)) continue;
      const o = d.orders.find(x => x.id === oid);
      if (o && o.status !== "Rejected") { out.push(o); seen.add(oid); }
    }
  }
  // Orders that are not on any invoice yet come last — a client pays the bills
  // they have been sent, not work that has not been billed to them.
  const rest = d.orders
    .filter(o => o.clientId === clientId && o.status !== "Rejected" && !seen.has(o.id))
    .sort((a, b) => +new Date(a.createdAt) - +new Date(b.createdAt));
  return [...out, ...rest];
}

/** The orders billed on one invoice, skipping any since rejected. */
function invoiceOrders(d: DB, invoiceId: string): Order[] {
  const inv = (d.invoices ?? []).find(i => i.id === invoiceId);
  if (!inv) return [];
  return invoiceOrderIds(inv)
    .map(oid => d.orders.find(o => o.id === oid))
    .filter((o): o is Order => !!o && o.status !== "Rejected");
}

/**
 * Take money in on a client's account.
 *
 * A running account, not a reshuffle. Money goes against the invoice it was
 * sent for and nowhere else; what that invoice cannot absorb, and anything sent
 * without an invoice named, stays as credit until somebody decides where it
 * belongs. The client's balance is simply what they have been billed less what
 * they have paid — plus and minus, the way the books are kept by hand.
 *
 * It used to fill their bills oldest-invoice-first instead, which moved money
 * the moment more arrived: a payment sent for invoice 0021 landed on invoice
 * 0005, an invoice that read Paid yesterday read Pending today, and no
 * statement ever matched twice. Nothing is allocated on its own any more.
 * Putting held credit against bills is a deliberate act — see
 * applyCreditToBills, and the per-invoice version below.
 *
 * Over-payment sitting on an order is still reclaimed to credit, because an
 * order holding more than it is worth is not a balance anybody can read.
 * Writes the leftover back to the client record and returns it.
 */
export function settleClientAccount(
  d: DB,
  clientId: string,
  extra: number,
  recordedBy: string,
  at: string,
  note?: string,
  firstInvoiceId?: string,
): number {
  const client = d.clients.find(c => c.id === clientId);
  const orders = d.orders.filter(o => o.clientId === clientId && o.status !== "Rejected");
  let pool = (extra || 0) + (client?.creditBalance || 0);
  for (const o of orders) pool += capOrderAdvances(o);
  pool = Math.round(pool * 100) / 100;
  const leftover = firstInvoiceId
    ? allocateInOrder(invoiceOrders(d, firstInvoiceId), pool, recordedBy, at, note ?? "Payment received")
    : pool;
  if (client) client.creditBalance = leftover > 0 ? leftover : undefined;
  return leftover;
}

/**
 * Put a client's held credit against their bills, oldest invoice first.
 *
 * Deliberate, never automatic: this runs when somebody presses the button, not
 * when money happens to arrive. Returns how much was actually applied.
 */
export function applyCreditToBills(
  d: DB,
  clientId: string,
  recordedBy: string,
  at: string,
  note = "Credit applied",
  invoiceId?: string,
): number {
  const client = d.clients.find(c => c.id === clientId);
  const orders = d.orders.filter(o => o.clientId === clientId && o.status !== "Rejected");
  let pool = client?.creditBalance || 0;
  for (const o of orders) pool += capOrderAdvances(o);
  pool = Math.round(pool * 100) / 100;
  const targets = invoiceId ? invoiceOrders(d, invoiceId) : billingOrder(d, clientId);
  const leftover = allocateInOrder(targets, pool, recordedBy, at, note, true);
  if (client) client.creditBalance = leftover > 0 ? leftover : undefined;
  return Math.round((pool - leftover) * 100) / 100;
}


/**
 * Record a payment against ONE specific order (order-wise collection from the
 * invoice screen). Caps at the order's balance and pushes the excess to client
 * credit; optionally logs a Locker deposit (in the locker's own currency, via
 * `lockerAmount`). Mirrors the OrderDetail advance flow. Call inside updateDb().
 */
export function recordOrderPayment(
  d: DB,
  orderId: string,
  opts: { amount: number; recordedBy: string; at: string; note?: string; lockerId?: string; lockerAmount?: number; exchangeRate?: number; advanceId?: string; lockerTxnId?: string },
): { applied: number; toCredit: number; paidInFull: boolean } {
  const o = d.orders.find(x => x.id === orderId);
  if (!o) return { applied: 0, toCredit: 0, paidInFull: false };
  if (!o.advances) o.advances = [];
  const bal = balanceDue(o);
  const applied = Math.min(opts.amount, bal);
  const toCredit = Math.round((opts.amount - applied) * 100) / 100;
  let paidInFull = false;
  if (applied > 0) {
    paidInFull = totalAdvance(o) + applied >= orderTotal(o);
    const isFirst = o.advances.length === 0;
    const defaultNote = paidInFull ? "Final Payment" : isFirst ? "Advance payment" : "Payment received";
    o.advances.push({
      id: opts.advanceId ?? uid("adv_"), amount: applied, note: opts.note || defaultNote, recordedBy: opts.recordedBy, createdAt: opts.at,
      lockerId: opts.lockerId || undefined, lockerAmount: opts.lockerId ? opts.lockerAmount : undefined,
    });
    if (opts.lockerId) {
      const locker = d.lockers.find(l => l.id === opts.lockerId);
      if (locker) {
        if (!d.lockerTransactions) d.lockerTransactions = [];
        d.lockerTransactions.push({
          id: opts.lockerTxnId ?? uid("ltx_"), lockerId: opts.lockerId, type: "income", amountInr: Number(opts.lockerAmount || 0),
          currency: locker.currency || "INR", category: `Client Payment — ${o.orderNumber}`,
          refType: "clientPayment", refId: o.id, recordedBy: opts.recordedBy, createdAt: opts.at,
          exchangeRate: opts.exchangeRate,
        });
      }
    }
  }
  if (toCredit > 0) {
    const c = d.clients.find(x => x.id === o.clientId);
    if (c) c.creditBalance = Math.round(((c.creditBalance || 0) + toCredit) * 100) / 100;
  }
  return { applied, toCredit, paidInFull };
}

/** Client account summary across all their orders (+ carried-forward credit).
 *  `opening` folds in a migration opening balance so the list, detail card and
 *  ledger export all agree — debit adds to what's billed/outstanding, credit
 *  adds to their advance. */
export function clientAccount(orders: Order[], creditBalance = 0, opening?: OpeningBalanceInfo) {
  // Outstanding must be summed PER ORDER (capped at 0) — otherwise an order that
  // was overpaid would wrongly cancel out real balance still due on another order.
  let outstanding = 0,
    overpaid = 0;
  for (const o of orders) {
    outstanding += balanceDue(o);
    overpaid += Math.max(0, totalAdvance(o) - orderTotal(o));
  }
  const oDebit = openingDebitAmt(opening), oCredit = openingCreditAmt(opening);
  outstanding += oDebit;
  const billed = orders.reduce((s, o) => s + orderTotal(o), 0) + oDebit;
  const allocated = Math.round((billed - outstanding) * 100) / 100; // money applied to bills
  const credit = Math.round(((creditBalance || 0) + overpaid + oCredit) * 100) / 100;
  return { billed, allocated, outstanding, credit, received: allocated + credit };
}

/** Salary / wages / advances paid TO an employee — expenses tagged with
 *  `paidToEmployeeId`, newest first. Gives each employee a payment ledger. */
export function employeePayments(expenses: Expense[], employeeId: string): Expense[] {
  return expenses
    .filter(e => e.paidToEmployeeId === employeeId)
    .sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));
}

/** Totals for an employee's payment ledger — grand total paid + count, and the
 *  amount paid in `year` (pass the current year in to keep this pure). */
export function employeePaymentTotals(expenses: Expense[], employeeId: string, year?: number) {
  const mine = expenses.filter(e => e.paidToEmployeeId === employeeId);
  let total = 0, thisYear = 0;
  for (const e of mine) {
    total += e.amount;
    if (year != null && new Date(e.createdAt).getFullYear() === year) thisYear += e.amount;
  }
  return { total: Math.round(total * 100) / 100, count: mine.length, thisYear: Math.round(thisYear * 100) / 100 };
}

/** Backward-compat: insert the "Diamond Purchase" step (added after "CAD Approved")
 *  into orders created before this step existed, without disturbing their progress. */
function insertDiamondPurchaseStep(o: Order) {
  if (o.timeline.some((t) => t.step === "Diamond Purchase")) return;
  const cadIdx = o.timeline.findIndex((t) => t.step === "CAD Approved");
  if (cadIdx === -1) return; // unexpected shape — leave as-is
  const cadDone = o.timeline[cadIdx].status === "done";
  o.timeline.splice(cadIdx + 1, 0, {
    step: "Diamond Purchase",
    status: cadDone ? "done" : "pending",
    date: cadDone ? o.timeline[cadIdx].date : undefined,
    remarks: cadDone ? "Backfilled" : undefined,
  });
}

/* ────────────────────────────────────────────────────────────────────────
 *  Firebase persistence layer
 * ──────────────────────────────────────────────────────────────────────── */

// Array-shaped collections stored as one Firestore document per item.
//
// catalogItems is deliberately NOT in this list — a folder can hold
// thousands of items, and this system works by diffing a FULL in-memory
// mirror against Firestore, deleting anything missing from memory. Only ever
// loading one page of items at a time would make that look like every
// un-loaded item was deleted. Catalog items are paginated and read/written
// directly via src/lib/catalogItems.ts instead — see that file's header.
type ArrayCol =
  | "users"
  | "clients"
  | "orders"
  | "tasks"
  | "messages"
  | "notifications"
  | "invoices"
  | "giftCards"
  | "expenses"
  | "catalogFolders"
  | "catalogFavorites"
  | "productPhotoFolders"
  | "productPhotoItems"
  | "shares"
  | "lockers"
  | "lockerTransactions"
  | "suppliers"
  | "purchases"
  | "supplierReceipts"
  | "supplierPayments"
  | "factoryPayments"
  | "clientReceipts"
  | "factories"
  | "materialIssuances"
  | "stockMovements"
  | "readyStock"
  | "diamondPackets"
  | "diamondSales"
  | "adminRecords"
  | "roles";
const ARRAY_COLS: ArrayCol[] = [
  "users",
  "clients",
  "orders",
  "tasks",
  "messages",
  "notifications",
  "invoices",
  "giftCards",
  "expenses",
  "catalogFolders",
  "catalogFavorites",
  "productPhotoFolders",
  "productPhotoItems",
  "shares",
  "lockers",
  "lockerTransactions",
  "suppliers",
  "purchases",
  "supplierReceipts",
  "supplierPayments",
  "factoryPayments",
  "clientReceipts",
  "factories",
  "materialIssuances",
  "stockMovements",
  "readyStock",
  "diamondPackets",
  "diamondSales",
  "adminRecords",
  "roles",
];
const SETTINGS_COL = "meta";
const SETTINGS_DOC = "settings";
const INDEX_COL = "userByAuth"; // uid → role index the security rules read

// Minimal per-user record the security rules consult (keyed by Firebase Auth
// uid). Contains no secrets — role/status/link only.
interface IndexDoc {
  role: Role;
  clientId: string | null;
  appId: string; // the user's app id (User.id), for scoping references
  status: "active" | "inactive";
}
// Last-known Firestore state of the index (uid → serialised IndexDoc), for diffing.
const remoteIdx: Record<string, string> = {};
let idxSeeded = false; // remoteIdx baseline taken from the users collection at load

/** The index record for a user (stable key order — used for both write & diff). */
function indexOf(u: User): IndexDoc {
  return { role: u.role, clientId: u.clientId ?? null, appId: u.id, status: u.status };
}

/** Firestore document id for an item in a given collection. */
function docId(col: ArrayCol, item: Record<string, unknown>): string {
  if (col === "catalogFavorites") return `${item.userId}__${item.itemId}`;
  return String(item.id);
}

/** Strip `undefined` (Firestore rejects it) and clone deeply. */
function clean<T>(v: T): T {
  return JSON.parse(JSON.stringify(v ?? null));
}

function eq(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

// Per-collection in-flight write counter — while > 0 we ignore inbound
// snapshots for that collection so our optimistic update isn't clobbered by a
// stale server echo mid-write.
const writePending: Record<string, number> = {};

// A "client"-scoped session only ever mirrors ITS OWN messages (merged from two
// separate from/to queries — see subscribeAll), never the full collection. Diffing
// that partial mirror against remote would read every other conversation's messages
// as "deleted" and wipe them from Firestore for everyone. Track the scope so persist()
// can skip delete-detection for "messages" unless we truly hold the complete collection.
let messagesScopeIsFull = true;
// The signed-in client's app id (User.id) while in client scope, else null.
// Used to safely allow a client to delete ONLY their own sent messages.
let clientAppId: string | null = null;

let seeded = false; // becomes true once cache has been populated from Firestore
let persistQueue: Promise<void> = Promise.resolve();

/**
 * Doc ids the app EXPLICITLY removed (through updateDb/saveDb), per collection.
 * ONLY these may be deleted from Firestore.
 *
 * Why: persist() diffs the local cache against the `remote` mirror, and used to
 * treat "in remote but missing from cache" as a deletion. But the cache can go
 * transiently stale — an inbound listener skipped while a write is pending, a
 * Firestore eventual-consistency blip, a client's partial mirror — and that made
 * a real, freshly-created record look deleted. A concurrent save then wiped it
 * for good (this is what silently deleted a live order and a saved locker in
 * production). Deletions are now driven by explicit intent, never by absence.
 */
const intentDeletes: Partial<Record<ArrayCol, Set<string>>> = {};

/** Current doc ids in the cache, per collection. */
function idsByCol(): Partial<Record<ArrayCol, Set<string>>> {
  const out: Partial<Record<ArrayCol, Set<string>>> = {};
  for (const col of ARRAY_COLS) {
    const arr = (cache[col] as unknown as Record<string, unknown>[]) || [];
    out[col] = new Set(arr.map((i) => docId(col, i)));
  }
  return out;
}

/** Record every id that `before` held and the cache no longer does — i.e. the
 *  caller deliberately removed it, so it's safe to delete remotely. */
function markIntentionalRemovals(before: Partial<Record<ArrayCol, Set<string>>>) {
  for (const col of ARRAY_COLS) {
    const prev = before[col];
    if (!prev || prev.size === 0) continue;
    const arr = (cache[col] as unknown as Record<string, unknown>[]) || [];
    const now = new Set(arr.map((i) => docId(col, i)));
    for (const id of prev) {
      if (!now.has(id)) (intentDeletes[col] ??= new Set<string>()).add(id);
    }
  }
}

function emit() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event("starlink-db-updated"));
}

/** Persist the current cache to Firestore, writing only what changed vs `remote`. */
async function persist() {
  // Snapshot the state we are about to commit. Diffing and the post-commit
  // reconciliation both use this frozen copy, so a concurrent updateDb() during
  // the await can't make us mark an unwritten change as already-synced.
  const snap: DB = clean(cache);
  // Collected as plain descriptors so they can be committed in several batches
  // (Firestore allows at most 500 writes per batch).
  type Op =
    | { kind: "set"; col: string; id: string; data: Record<string, unknown> }
    | { kind: "del"; col: string; id: string };
  const opsList: Op[] = [];
  const touched = new Set<string>();
  const committedDeletes: { col: ArrayCol; id: string }[] = [];
  // Every record this save changes, as it was and as it will be — what the
  // activity log is written from, once the save has actually gone through.
  const logRaw: { col: string; id: string; before: Record<string, unknown> | null; after: Record<string, unknown> | null }[] = [];
  const ctx = pendingChangeContext;
  pendingChangeContext = null;

  for (const col of ARRAY_COLS) {
    // A collection the server refuses is not worth attempting again. A failed
    // write is never reconciled against the mirror, so the same documents are
    // regenerated on EVERY later save: one rejected collection made every save
    // for the rest of the session slow, pending and doomed, with a permanent
    // "Saving…" and no clue which collection. The data stays in the cache and
    // goes up on the next reload once the rules allow it.
    if (deniedCols.has(col)) continue;
    const cur = (snap[col] as unknown as Record<string, unknown>[]) || [];
    const prev = (remote[col] as unknown as Record<string, unknown>[]) || [];
    const curMap = new Map(cur.map((i) => [docId(col, i), i]));
    const prevMap = new Map(prev.map((i) => [docId(col, i), i]));

    // A doc that's present locally again is no longer a pending deletion (it
    // came back from a listener, or was re-created), so drop any stale intent.
    const pendingDel = intentDeletes[col];
    if (pendingDel) for (const id of curMap.keys()) pendingDel.delete(id);

    for (const [id, item] of curMap) {
      const before = prevMap.get(id);
      if (!before || !eq(before, item)) {
        opsList.push({ kind: "set", col, id, data: item });
        touched.add(col);
        logRaw.push({ col, id, before: (before as Record<string, unknown>) ?? null, after: item });
      }
    }
    for (const [id, prevItem] of prevMap) {
      if (curMap.has(id)) continue;
      // A client session only holds a PARTIAL mirror of "messages" (its own
      // threads). Never infer deletion of a message it doesn't own — otherwise a
      // partial mirror could wipe other conversations. A client may delete only
      // messages it sent; staff (full mirror) may delete any.
      if (
        col === "messages" &&
        !messagesScopeIsFull &&
        (prevItem as { fromUserId?: string }).fromUserId !== clientAppId
      )
        continue;
      // Orders and gift cards are APPEND-ONLY in the app — no screen ever deletes
      // an individual one (they're only status-changed/revoked, or wiped en-masse
      // by Settings → Clear Data). So a single doc "missing" from a transiently-
      // stale cache (a Firestore eventual-consistency / listener-skip artifact, or a
      // partial client mirror) must NEVER be inferred as a deletion — that is how a
      // freshly-created order could silently vanish. Only allow these deletions as
      // part of a full-collection clear (curMap empty).
      //
      // Invoices were on that list too, which meant Settings → "Delete an Invoice"
      // removed the bill on screen and the next snapshot brought it straight back.
      // They are no longer append-only: that screen is a deliberate delete path, and
      // the intentDeletes guard right below is what keeps it safe — only an id the
      // app itself removed is ever deleted, so a stale cache still cannot wipe one.
      if ((col === "orders" || col === "giftCards") && curMap.size > 0)
        continue;
      // THE key guard: only ever delete what the app explicitly removed (see
      // intentDeletes). A doc merely absent from a stale cache is left alone —
      // the next inbound snapshot restores it instead of it being wiped.
      if (!intentDeletes[col]?.has(id)) continue;
      opsList.push({ kind: "del", col, id });
      committedDeletes.push({ col, id });
      touched.add(col);
      logRaw.push({ col, id, before: prevItem as Record<string, unknown>, after: null });
    }
  }

  if (!eq(snap.settings, remote.settings)) {
    opsList.push({
      kind: "set",
      col: SETTINGS_COL,
      id: SETTINGS_DOC,
      data: snap.settings as unknown as Record<string, unknown>,
    });
    touched.add(SETTINGS_COL);
    logRaw.push({
      col: SETTINGS_COL, id: SETTINGS_DOC,
      before: (remote.settings as unknown as Record<string, unknown>) ?? null,
      after: snap.settings as unknown as Record<string, unknown>,
    });
  }

  // Maintain the userByAuth role index (keyed by Firebase Auth uid). The
  // security rules read these tiny docs to authorise requests. Derived
  // automatically from the users collection — never hand-edited.
  //
  // IMPORTANT: firestore.rules only lets a NON-admin write an index doc whose
  // role is "client" (and a client none at all). Any other index write returns
  // permission-denied, which used to fail the WHOLE batch — so an employee or
  // client lost the real data write riding along with it and saw "Couldn't save
  // your last change" over and over. Mirror the rule exactly here, and commit
  // whatever survives in its own batch so the index can never take data down.
  // An owner (by email) or an admin made in the app — the rules recognise both.
  const meNow = cache.users.find(u => u.authUid === fbAuth.currentUser?.uid);
  const amAdmin = isAdminEmail(fbAuth.currentUser?.email) || (meNow?.role === "admin" && meNow.status === "active");
  const amStaff = messagesScopeIsFull; // non-client scope == staff session
  const idxWrites: Record<string, IndexDoc> = {};
  const idxDeletes: string[] = [];
  const idxOps: typeof opsList = [];
  const desired: Record<string, IndexDoc> = {};
  for (const u of (snap.users || []) as User[]) {
    if (!u.authUid) continue;
    desired[u.authUid] = indexOf(u);
  }
  for (const [auid, data] of Object.entries(desired)) {
    if (remoteIdx[auid] === JSON.stringify(data)) continue;
    if (!(amAdmin || (amStaff && data.role === "client"))) continue; // not ours to write
    idxOps.push({
      kind: "set",
      col: INDEX_COL,
      id: auid,
      data: data as unknown as Record<string, unknown>,
    });
    idxWrites[auid] = data;
  }
  if (amAdmin || amStaff) {
    for (const auid of Object.keys(remoteIdx)) {
      if (!desired[auid]) {
        idxOps.push({ kind: "del", col: INDEX_COL, id: auid });
        idxDeletes.push(auid);
      }
    }
  }

  if (opsList.length === 0 && idxOps.length === 0) return;
  touched.forEach((c) => {
    writePending[c] = (writePending[c] || 0) + 1;
  });
  setPending(pendingCount + 1);
  try {
    // Firestore hard-limits a batch to 500 writes. A big save (first bulk sync,
    // a data restore, or just a busy account) used to exceed that and throw,
    // which surfaced to staff as "Couldn't save your last change". Commit in
    // chunks instead so any size of change goes through.
    const CHUNK = 450;
    for (let i = 0; i < opsList.length; i += CHUNK) {
      const batch = writeBatch(fsdb);
      for (const op of opsList.slice(i, i + CHUNK)) {
        if (op.kind === "set") batch.set(doc(fsdb, op.col, op.id), op.data);
        else batch.delete(doc(fsdb, op.col, op.id));
      }
      await batch.commit();
    }
    // The role index is bookkeeping, not user data. Commit it separately and
    // swallow any failure: if the rules reject it, the data above is already
    // safely written, and an admin session reconciles the index later.
    if (idxOps.length) {
      try {
        for (let i = 0; i < idxOps.length; i += CHUNK) {
          const ib = writeBatch(fsdb);
          for (const op of idxOps.slice(i, i + CHUNK)) {
            if (op.kind === "set") ib.set(doc(fsdb, op.col, op.id), op.data);
            else ib.delete(doc(fsdb, op.col, op.id));
          }
          await ib.commit();
        }
        for (const [auid, data] of Object.entries(idxWrites)) remoteIdx[auid] = JSON.stringify(data);
        for (const auid of idxDeletes) delete remoteIdx[auid];
      } catch (e) {
        console.warn("[db] role-index sync skipped (not permitted for this account):", e);
      }
    }
    // These deletions are done — stop tracking them.
    for (const { col, id } of committedDeletes) intentDeletes[col]?.delete(id);
    // Reconcile only the collections we wrote — leaves remote copies that
    // inbound listeners refreshed for other collections untouched.
    for (const c of touched) {
      if (c === SETTINGS_COL) remote.settings = snap.settings;
      else (remote[c as ArrayCol] as unknown) = snap[c as ArrayCol];
    }
    // Written, so it happened — now it goes in the activity log. Not awaited:
    // the log is a record of the save, never a reason for it to be slow.
    if (logRaw.length) void recordChanges(logRaw, ctx);
  } catch (err) {
    // A failed write is NOT reconciled above, so the same documents are
    // attempted again on the very next save — which is right for a dropped
    // connection and useless for a collection the rules do not allow. That
    // case retries forever, quietly, on every save for the life of the
    // session: the app feels slow and the only clue is a generic "Save
    // failed". Name the collection instead, once, so it can be fixed.
    const code = (err as { code?: string })?.code ?? "";
    console.error(`[db] Firestore write failed (${[...touched].join(", ")}):`, err);
    if (code === "permission-denied") {
      for (const c of touched) {
        deniedCols.add(c);
        if (deniedReported.has(c)) continue;
        deniedReported.add(c);
        console.error(
          `[db] "${c}" was rejected by the security rules, so it will not be attempted again this session. `
          + `Nothing is lost — it stays on this device and goes up once the rules allow it. `
          + `Run: firebase deploy --only firestore (a collection added in the app but missing from `
          + `firestore.rules does exactly this), then reload. Not --only firestore:rules: with the `
          + `named-database firebase.json that matches nothing and deploys nothing.`,
        );
      }
    }
    if (typeof window !== "undefined")
      window.dispatchEvent(new CustomEvent("starlink-db-error", { detail: err }));
  } finally {
    touched.forEach((c) => {
      writePending[c] = Math.max(0, (writePending[c] || 1) - 1);
    });
    setPending(pendingCount - 1);
  }
}

/**
 * Whether the admin-only records can actually be read and written — true once
 * the security rules for them are deployed and the admin's listener has had a
 * first answer. Until then everything stays where it always was, because a
 * write the rules refuse is kept only on this device and gone on reload.
 */
let adminStoreLive = false;
/** Whether roles can be saved — true once the rules for them are deployed. */
let rolesStoreLive = false;
export function rolesStoreReady(): boolean {
  return rolesStoreLive && !deniedCols.has("roles");
}

/** Whether this session is the admin's — decides which collections it waits on. */
let adminScope = false;

/** Collections that have given their first answer this session. */
const loadedCols = new Set<string>();

/**
 * Whether everything a cost is worked out from has arrived.
 *
 * Only the people, clients and orders hold the door when the app opens; the
 * rest stream in behind. Worked out in that gap, an order's cost came to
 * nothing for a second or two and its profit to the whole selling price — a
 * wrong figure, shown with confidence, to whoever glanced at it first. Profit
 * waits for this instead.
 */
export function costDataReady(): boolean {
  const need = ["purchases", "materialIssuances", "diamondPackets", "stockMovements", "expenses", "clientReceipts", "readyStock", "lockers"];
  if (adminScope) need.push("adminRecords");
  return need.every(c => loadedCols.has(c));
}

/** Whether one collection has given its first answer this session. */
export function collectionLoaded(col: string): boolean {
  return loadedCols.has(col);
}

export function adminStoreReady(): boolean {
  return adminStoreLive && !deniedCols.has("adminRecords");
}

/* ── Activity log ── */

/** Set by a caller that knows better what its save means — an undo, chiefly. */
export interface ChangeContext { kind?: ActivityKind; summary?: string; undoOf?: string }
let pendingChangeContext: ChangeContext | null = null;

/**
 * updateDb, with a note on what the save is. The note travels with the save
 * and labels its activity-log entry — so an undo is recorded as an undo, not
 * as an anonymous edit.
 */
export function updateDbAs(ctx: ChangeContext, fn: (db: DB) => void) {
  pendingChangeContext = ctx;
  return updateDb(fn);
}

/** Refused by the rules this session (not deployed yet): stop trying. */
let activityRefused = false;

/** Who is doing this, as the log should name them. */
function actor(): { actorUid: string; actorId: string; actorName: string; actorRole: string } | null {
  const fb = fbAuth.currentUser;
  if (!fb) return null;
  const u = cache.users.find(x => x.authUid === fb.uid);
  const owner = isAdminEmail(fb.email);
  return {
    actorUid: fb.uid,
    actorId: u?.id ?? fb.uid,
    actorName: u?.name || fb.displayName || fb.email || "Unknown",
    actorRole: owner ? "owner" : (u?.role ?? "staff"),
  };
}

function newActivityId(): string {
  return `act_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/** Append one entry. Never throws, and never retries once refused. */
async function writeActivity(entry: ActivityEntry): Promise<void> {
  if (activityRefused) return;
  try {
    await setDoc(doc(fsdb, "activityLog", entry.id), clean(entry) as unknown as Record<string, unknown>);
  } catch (e) {
    if ((e as { code?: string })?.code === "permission-denied") {
      activityRefused = true;
      console.warn("[activity] the log is not accepted yet — deploy the firestore rules to switch it on.");
    } else console.warn("[activity] entry not written:", e);
  }
}

/** A save, as an entry: what changed, before and after, and whether it can be put back. */
async function recordChanges(
  raw: { col: string; id: string; before: Record<string, unknown> | null; after: Record<string, unknown> | null }[],
  ctx: ChangeContext | null,
): Promise<void> {
  try {
    const who = actor();
    if (!who) return;
    // The log keeps full copies of what changed (for undo) and can never be
    // edited afterwards — so a password must never ride along in one.
    const noSecret = (x: Record<string, unknown> | null) => {
      if (!x || !("password" in x)) return x;
      const { password: _p, ...rest } = x;
      void _p;
      return rest;
    };
    raw = raw.map(r => ({ ...r, before: noSecret(r.before), after: noSecret(r.after) }));
    const changes = describeChanges(raw);
    if (!changes.length) return;
    const { summary, module } = summarise(changes);
    const entry: ActivityEntry = {
      id: newActivityId(), at: new Date().toISOString(), ...who,
      kind: ctx?.kind ?? "change", module, summary: ctx?.summary ?? summary,
      changes, undoable: false,
      ...(ctx?.undoOf ? { undoOf: ctx.undoOf } : {}),
    };
    // A Firestore document holds a megabyte. A save that large keeps its list
    // of what changed but not the full copies — and so cannot be undone.
    if (JSON.stringify(entry).length > 700_000) {
      entry.changes = changes.map(({ before: _b, after: _a, ...c }) => c);
      entry.truncated = true;
    }
    const blocker = ctx?.kind === "undo" ? "This was itself an undo." : undoBlocker(changes, !!entry.truncated);
    entry.undoable = !blocker;
    if (blocker) entry.undoBlocker = blocker;
    await writeActivity(entry);
  } catch (e) {
    console.warn("[activity] could not describe a save:", e);
  }
}

/**
 * Something that is not a change to a record but still worth knowing: a
 * ledger downloaded, an invoice printed, a sign-in. Named for the section the
 * person was in when they did it.
 */
export function logEvent(kind: Exclude<ActivityKind, "change" | "undo">, summary: string, meta?: Record<string, unknown>): void {
  const who = actor();
  if (!who) return;
  const module = typeof window !== "undefined" ? moduleForPath(window.location.pathname) : "dashboard";
  void writeActivity({
    id: newActivityId(), at: new Date().toISOString(), ...who,
    kind, module, summary, undoable: false, ...(meta ? { meta } : {}),
  });
}

/** Collections the rules refuse. Skipped for the rest of the session so one
 *  rejected collection cannot make every save slow and failing. Cleared by a
 *  reload, which is when a rules deploy takes effect anyway. */
const deniedCols = new Set<string>();

/* ── Heavy records loaded on demand (staff) — see lib/pageData.ts ──────────
 * Purchases, factory issues, account entries, stock movements and the like are
 * not downloaded at sign-in for staff: the page that needs them asks
 * (ensureCollections), and waits for them before it draws. Once loaded, a
 * collection stays live for the session like any other. Clients never load
 * these at all. */
const LAZY_SET = new Set<string>(LAZY_COLS);
let lazyMode = false;
const lazySpecs = new Map<string, { col: ArrayCol; q: Query<DocumentData> }>();
const lazyAttached = new Set<string>();
/** Asked for before the listeners could start; attached as soon as they can. */
const lazyWanted = new Set<string>();
let lazyAttach: ((col: string) => void) | null = null;
const loadWaiters = new Set<() => void>();
const lazyWarned = new Set<string>();

/** A heavy collection read before it was loaded: load it, and say so once. */
function lazyRead(col: string, duringSave: boolean) {
  if (!lazyWarned.has(col)) {
    lazyWarned.add(col);
    console.warn(`[db] "${col}" was read before it loaded${duringSave ? " (inside a save)" : ""} — loading it now. Add it to the page's needs in src/lib/pageData.ts.`);
  }
  void ensureCollections([col]);
}
function guarded<T extends object>(target: T, duringSave = false): T {
  return new Proxy(target, {
    get(t, p, r) {
      if (typeof p === "string" && lazyMode && LAZY_SET.has(p) && !loadedCols.has(p)) lazyRead(p, duringSave);
      return Reflect.get(t, p, r);
    },
  });
}

/**
 * Make sure these collections are loaded; resolves once each has given its
 * first answer. Anything not held back on demand is already on its way and is
 * simply waited for.
 */
export function ensureCollections(cols: readonly string[]): Promise<void> {
  for (const c of cols) if (!loadedCols.has(c) && LAZY_SET.has(c)) { if (lazyAttach) lazyAttach(c); else lazyWanted.add(c); }
  if (cols.every(c => loadedCols.has(c))) return Promise.resolve();
  return new Promise(res => {
    const check = () => { if (cols.every(c => loadedCols.has(c))) { loadWaiters.delete(check); res(); } };
    loadWaiters.add(check);
  });
}
/** Everything — before anything that must hold the whole database, a backup most of all. */
export function ensureAllCollections(): Promise<void> {
  return ensureCollections(lazyMode ? [...LAZY_COLS] : []);
}
/** Whether every one of these has loaded (synchronous; nothing is requested). */
export function collectionsLoaded(cols: readonly string[]): boolean {
  return cols.every(c => loadedCols.has(c));
}
/**
 * Before a delete or cancel asks "does anything still point at this?": a
 * collection that has not arrived reads as empty, and empty says "no". Asks
 * for these (loading any held back on demand), waits up to `ms`, and says
 * whether every one of them is here — when one is not, the caller refuses
 * ("Still loading — try again in a moment") rather than guess.
 */
export async function collectionsReady(cols: readonly string[], ms = 15000): Promise<boolean> {
  if (collectionsLoaded(cols)) return true;
  let timer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([
    ensureCollections(cols),
    new Promise<void>(res => { timer = setTimeout(res, ms); }),
  ]);
  if (timer) clearTimeout(timer);
  return collectionsLoaded(cols);
}

/* ── Totals kept by the server (functions/src/summaries.ts), read-only ── */
let summaryMap = new Map<string, Record<string, unknown>>();
let summariesOn = false;
/** The totals listener has answered at all — with data, or with a refusal. */
let summariesDone = false;
/** Whether it is known yet if the server's totals are there (see PageData in AppLayout). */
export function summariesSettled(): boolean { return summariesDone; }
/** One party's stored totals: "factory_<id>", "supplier_<id>", "locker_<id>". */
export function summaryOf(id: string): Record<string, unknown> | undefined { return summaryMap.get(id); }
/** True once the server's totals have answered this session. */
export function summariesLive(): boolean { return summariesOn; }

/* ── Start-up figures, for Settings → Data size & speed ── */
const startup = { openedMs: 0, loadedMs: 0, startedAt: 0 };
export function startupStats() { return { ...startup, lazy: lazyMode, loaded: [...loadedCols] }; }
/** How many records each collection holds on the server — counted there, nothing downloaded. */
export async function countRecords(): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  await Promise.all(ARRAY_COLS.map(async c => {
    try { out[c] = (await getCountFromServer(collection(fsdb, c))).data().count; } catch { /* not readable here */ }
  }));
  return out;
}
/** Collections already reported as rejected — one message each, not one per save. */
const deniedReported = new Set<string>();

// Number of Firestore write batches currently in flight — drives the global
// "Saving…" indicator so every action shows Firebase progress.
let pendingCount = 0;
function setPending(n: number) {
  pendingCount = Math.max(0, n);
  if (typeof window !== "undefined")
    window.dispatchEvent(new CustomEvent("starlink-db-pending", { detail: pendingCount }));
}
export function pendingWrites() {
  return pendingCount;
}

export function saveDb(db?: DB) {
  // Adopt the caller's object into the cache. Callers may pass a loadDb() copy
  // whose top-level arrays were reassigned (e.g. `fresh.expenses = [...]`), so
  // copy its fields in rather than assuming in-place mutation of the cache.
  // Anything the caller dropped is an INTENTIONAL delete — record it, so
  // persist() deletes only that and never a transiently-missing doc.
  const before = idsByCol();
  if (db && db !== cache) Object.assign(cache, db);
  markIntentionalRemovals(before);
  emit();
  // Chain persists so overlapping saves don't race; each recomputes the diff.
  persistQueue = persistQueue
    .then(persist)
    .catch((err) => console.error("[db] persist error", err));
}

/**
 * Stamp the signed-in user as recently active.
 *
 * This is bookkeeping for a "last seen" dot, and it used to go through
 * updateDb() like any real change: on every app open, every 45 seconds, and
 * every time the tab regained focus, it mutated the cache and queued a full
 * persist() — which serialises and diffs the ENTIRE database to work out that
 * one timestamp moved. On a phone with a few thousand documents that is a
 * noticeable freeze every time, and the write raised the global pending count,
 * so "Saving…" appeared on every single open and then again every 45 seconds.
 *
 * It writes the one field directly instead, keeps the local mirror in step so
 * the next real save still sees no change, and never touches the pending
 * counter — nobody needs a progress indicator for a heartbeat.
 */
export async function touchPresence(userId: string): Promise<void> {
  const at = new Date().toISOString();
  const u = cache.users.find((x) => x.id === userId);
  if (!u) return;
  u.lastActiveAt = at;
  // Keep `remote` in step, or the next genuine save would diff this timestamp
  // and write the whole user document again.
  const mirrored = (remote.users as User[] | undefined)?.find((x) => x.id === userId);
  if (mirrored) mirrored.lastActiveAt = at;
  try {
    await setDoc(doc(fsdb, "users", userId), { lastActiveAt: at }, { merge: true });
  } catch {
    // A heartbeat that fails is not worth telling anyone about.
  }
}

/**
 * Client records used to keep the login password in plain text: the Create
 * Client form saved its whole form. Sign-in never needed it — passwords live
 * in Firebase Auth — so it is no longer saved, and this takes it off records
 * saved before. Run for the admin once the clients are here; nothing to
 * remove, nothing written. Returns how many records it cleaned.
 */
export function dropStoredClientPasswords(): number {
  if (!loadedCols.has("clients")) return 0;
  const n = cache.clients.filter(c => Object.prototype.hasOwnProperty.call(c, "password")).length;
  if (!n) return 0;
  updateDbAs({ summary: `Removed stored login passwords from ${n} client record${n === 1 ? "" : "s"}` }, d => {
    for (const c of d.clients) delete c.password;
  });
  return n;
}

export function updateDb(fn: (db: DB) => void) {
  const before = idsByCol();
  fn(lazyMode ? guarded(cache, true) : cache);
  markIntentionalRemovals(before); // whatever the mutator removed is a real delete
  saveDb(cache);
  return cache;
}

/**
 * Resolve once all currently-queued Firestore writes have settled. Lets a
 * button stay in its "processing" state until the change is actually committed
 * to Firebase (writes are optimistic, so this is what "done" really means).
 */
export function flush(): Promise<void> {
  return persistQueue.then(
    () => {},
    () => {},
  );
}

export function uid(prefix = "") {
  return prefix + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

/** Assigns and returns the next sequential "DP-0007" style stock number for a
 *  new certified diamond packet, advancing Settings.nextDiamondStockNo. Never
 *  reused even if a packet is later deleted — a reliable way to find one
 *  specific stone among hundreds in stock. Call inside updateDb(). */
export function nextDiamondStockNumber(d: DB): string {
  const n = (d.settings.nextDiamondStockNo || 0) + 1;
  d.settings.nextDiamondStockNo = n;
  return `DP-${String(n).padStart(4, "0")}`;
}

/* ────────────────────────────────────────────────────────────────────────
 *  Data lifecycle — data is loaded ONLY after a user authenticates, because
 *  the security rules reject unauthenticated reads. startDb() is called from
 *  the auth layer once a Firebase user is present; stopDb() on sign-out.
 * ──────────────────────────────────────────────────────────────────────── */

let startPromise: Promise<void> | null = null;
let unsubscribers: Array<() => void> = [];

/**
 * Access scope for the signed-in user, derived from their userByAuth index:
 *  • "full"   — admin/employee (staff): subscribe to entire collections.
 *  • "client" — subscribe only to the client's own orders/invoices/messages/
 *               notifications/client-record (enforced identically by the rules).
 */
export type Scope =
  /** Staff. `admin` decides whether the admin-only records are requested at
   *  all — an employee never asks for them, so never sees them. */
  | { kind: "full"; admin?: boolean; /** The person's own app id (User.id), when their index has it. */ appId?: string }
  | { kind: "client"; appId: string; clientId: string };

/**
 * Watch the signed-in user's own role-index doc and invoke `onRevoked` the
 * moment they are deactivated (status != 'active') or removed (doc deleted).
 * The index doc stays readable by its owner even when inactive, so this keeps
 * working right up to sign-out. Returns an unsubscribe function.
 */
export function watchAccess(authUid: string, onRevoked: () => void): () => void {
  let firstFired = false;
  return onSnapshot(
    doc(fsdb, INDEX_COL, authUid),
    (snap) => {
      // Ignore the initial read; only react to a live change to inactive/deleted.
      if (!firstFired) {
        firstFired = true;
        return;
      }
      if (!snap.exists() || (snap.data() as IndexDoc).status !== "active") onRevoked();
    },
    () => {
      /* permission/network error — ignore */
    },
  );
}

/** Read the caller's role index to decide their data scope (before loading). */
const SCOPE_KEY = (uid: string) => `sl-scope:${uid}`;
/** The scope this account had last time, for opening offline. */
function rememberedScope(authUid: string): Scope | null {
  try { const r = localStorage.getItem(SCOPE_KEY(authUid)); return r ? (JSON.parse(r) as Scope) : null; } catch { return null; }
}
export async function resolveScope(authUid: string): Promise<Scope> {
  // Offline, asking the server would wait out its timeout before giving up —
  // read the saved copy of the index, or the scope remembered last time.
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    try {
      const c = await getDocFromCache(doc(fsdb, INDEX_COL, authUid));
      if (c.exists()) return scopeOfIndex(c.data() as IndexDoc);
    } catch { /* not in the saved copy */ }
    const r = rememberedScope(authUid);
    if (r) return r;
  }
  return resolveScopeOnline(authUid);
}
function scopeOfIndex(d: IndexDoc): Scope {
  if (d.role === "client" && d.clientId) return { kind: "client", appId: d.appId, clientId: d.clientId };
  if (d.role === "admin" && d.status === "active") return { kind: "full", admin: true, appId: d.appId || undefined };
  return { kind: "full", appId: d.appId || undefined };
}
async function resolveScopeOnline(authUid: string): Promise<Scope> {
  try {
    const s = await getDoc(doc(fsdb, INDEX_COL, authUid));
    if (s.exists()) {
      // Read from the account's own index — remembered for an offline start.
      // A fallback below is never remembered: a client must never be taken
      // for staff because one read failed.
      const scope = scopeOfIndex(s.data() as IndexDoc);
      try { localStorage.setItem(SCOPE_KEY(authUid), JSON.stringify(scope)); } catch { /* private mode */ }
      return scope;
    }
  } catch (e) {
    console.error("[db] resolveScope failed:", e);
  }
  return { kind: "full" }; // admin, employee, or admin-bootstrap (no index yet)
}

/**
 * Check the role index against the server, and write back anything missing.
 *
 * A new client or employee is written in two steps: their profile, then the
 * small index document the security rules read to recognise them. If the
 * second step never happens — the tab closed a moment too soon, the signal
 * dropped — they can sign in to nothing, and the login screen just says
 * "Invalid credentials". The next admin session was meant to put it right,
 * but it began by ASSUMING every account's index was already on the server,
 * so it never looked, and never did. A missed index stayed missing for good.
 *
 * The admin is the one account allowed to read the whole index, so the admin
 * session now reads it, replaces the assumption with what is really there,
 * and lets the ordinary save write back whatever is absent or out of date.
 * Only the index is touched; no record of anybody's is changed.
 */
async function reconcileRoleIndex(): Promise<void> {
  try {
    const snap = await getDocs(collection(fsdb, INDEX_COL));
    for (const k of Object.keys(remoteIdx)) delete remoteIdx[k];
    for (const d of snap.docs) {
      const v = d.data() as IndexDoc;
      remoteIdx[d.id] = JSON.stringify({ role: v.role, clientId: v.clientId ?? null, appId: v.appId ?? "", status: v.status });
    }
    idxSeeded = true;
    const missing = cache.users.filter(u => u.authUid && remoteIdx[u.authUid] !== JSON.stringify(indexOf(u)));
    if (missing.length) {
      console.info(`[db] role index: ${missing.length} account(s) missing or out of date on the server — writing them back`);
      updateDb(() => {}); // nothing changes in the data, so only the index is written
    }
  } catch (e) {
    console.warn("[db] role index could not be checked against the server:", e);
  }
}

/** Subscribe & load the cache from Firestore for the given scope. */
export function startDb(scope: Scope = { kind: "full" }): Promise<void> {
  if (startPromise) return startPromise;
  startPromise = (async () => {
    await subscribeAll(scope);
    if (scope.kind === "full" && scope.admin) await reconcileRoleIndex();
    // Legacy localStorage migration only runs for staff (admin) sessions.
    if (scope.kind === "full") {
      const legacy = readLegacy();
      if (legacy && legacy.users.length > 0) { await ensureAllCollections(); await migrateLegacy(legacy); }
    }
    seeded = true;
    emit();
  })();
  return startPromise;
}

/** Unsubscribe all listeners and clear the cache (on sign-out). */
export function stopDb() {
  subGeneration++;
  unsubscribers.forEach((u) => {
    try {
      u();
    } catch {
      /* ignore */
    }
  });
  unsubscribers = [];
  lazyAttach = null;
  lazySpecs.clear();
  lazyAttached.clear();
  lazyWanted.clear();
  loadWaiters.clear();
  summaryMap = new Map();
  summariesOn = false;
  summariesDone = false;
  Object.assign(cache, emptyDb());
  remote = emptyDb();
  for (const k of Object.keys(remoteIdx)) delete remoteIdx[k];
  idxSeeded = false;
  startPromise = null;
  seeded = false;
  messagesScopeIsFull = true;
  clientAppId = null;
  emit();
}

/** Apply a collection snapshot into the cache/remote mirror. */
function applyList(col: ArrayCol, docs: Record<string, unknown>[]) {
  let list = docs;
  if (col === "orders")
    list = list.map(
      (o) => normalizeOrder(o as unknown as Order) as unknown as Record<string, unknown>,
    );
  (cache[col] as unknown) = list;
  (remote[col] as unknown) = clean(list);
  if (col === "users" && !idxSeeded) {
    for (const u of cache.users) if (u.authUid) remoteIdx[u.authUid] = JSON.stringify(indexOf(u));
    idxSeeded = true;
  }
}

/**
 * With the device cache on (lib/firebase.ts), a listener first answers from
 * the copy saved on this device — which can be hours old. This app saves whole
 * records, so showing that copy and letting someone edit it could write stale
 * data over newer work. So the first answer taken is the SERVER's, exactly as
 * before the cache existed; the saved copy only means the server has less to
 * send. Once the server has answered, every later update is taken as it comes.
 *
 * Offline there is no server answer at all. Rather than never opening, the
 * saved copy is taken after OFFLINE_FALLBACK_MS — only while the device
 * reports itself offline; a slow connection keeps waiting for the server.
 */
const OFFLINE_FALLBACK_MS = 12_000;
function serverFirst<S extends { metadata: { fromCache: boolean } }>(label: string, onData: (s: S) => void): (s: S) => void {
  let live = false;
  let cached: S | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const arm = () => {
    timer = setTimeout(() => {
      timer = null;
      if (live || !cached) return;
      if (typeof navigator !== "undefined" && navigator.onLine === false) {
        console.warn(`[db] ${label}: offline — opening this device's saved copy until the server answers`);
        live = true;
        onData(cached);
      } else arm();
    }, OFFLINE_FALLBACK_MS);
  };
  return (snap) => {
    if (live) {
      // Asked for metadata changes (below) so the server's confirmation of an
      // unchanged copy arrives at all; past that first answer, an event that
      // changes no document says nothing new and is not worth a redraw.
      const q = snap as unknown as { docChanges?: () => unknown[] };
      if (typeof q.docChanges === "function" && q.docChanges().length === 0) return;
      onData(snap);
      return;
    }
    if (!snap.metadata.fromCache) {
      live = true;
      if (timer) { clearTimeout(timer); timer = null; }
      onData(snap);
      return;
    }
    cached = snap;
    // The device says it is offline: no server can answer, so waiting only
    // keeps the app on its splash screen. Use the saved copy now; the server's
    // answer replaces it the moment the connection is back.
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      console.warn(`[db] ${label}: offline — opening this device's saved copy until the server answers`);
      live = true;
      if (timer) { clearTimeout(timer); timer = null; }
      onData(snap);
      return;
    }
    if (!timer) arm();
  };
}

/** Listener options: the server's "your copy is current" must reach serverFirst(). */
const LISTEN = { includeMetadataChanges: true } as const;

/** Subscribe according to scope; resolves after each stream has fired once. */
/** Bumped on every sign-out, so listeners queued during a boot that has since
 *  been torn down never attach and leak. */
let subGeneration = 0;

function subscribeAll(scope: Scope): Promise<void> {
  const gen = ++subGeneration;
  const client = scope.kind === "client" ? scope : null;
  messagesScopeIsFull = !client;
  clientAppId = client ? client.appId : null;

  // Build the per-collection queries for this scope.
  const specs: { col: ArrayCol; q: Query<DocumentData> }[] = [];
  const amAdminScope = scope.kind === "full" && !!scope.admin;
  adminStoreLive = false;
  rolesStoreLive = false;
  adminScope = amAdminScope;
  loadedCols.clear();
  lazyMode = !client;
  lazySpecs.clear();
  lazyAttached.clear();
  lazyAttach = null;
  lazyWarned.clear();
  summaryMap = new Map();
  summariesOn = false;
  summariesDone = false;
  for (const col of ARRAY_COLS) {
    // Requested by the admin and nobody else. The rules would refuse it to
    // anyone else anyway; not asking at all means there is nothing to refuse.
    if (col === "adminRecords" && !amAdminScope) continue;
    if (client) {
      // Staff-only collections are never loaded for a client.
      if (
        col === "tasks" ||
        col === "expenses" ||
        col === "lockers" ||
        col === "lockerTransactions" ||
        col === "suppliers" ||
        col === "purchases" ||
        col === "supplierReceipts" ||
        col === "supplierPayments" ||
        col === "factoryPayments" ||
        col === "clientReceipts" ||
        col === "factories" ||
        col === "materialIssuances" ||
        col === "stockMovements" ||
        // Staff-only as well. Asked for anyway, the rules refused them on every
        // client sign-in — nothing leaked, but each refusal was a console error
        // and a round trip the client's first screen waited behind.
        col === "diamondPackets" ||
        col === "diamondSales" ||
        col === "roles"
      )
        continue;
      if (col === "messages") continue; // handled specially (two-sided)
      const c = collection(fsdb, col);
      if (col === "orders" || col === "invoices" || col === "giftCards")
        specs.push({ col, q: query(c, where("clientId", "==", client.clientId)) });
      else if (col === "notifications")
        specs.push({ col, q: query(c, where("userId", "==", client.appId)) });
      else if (col === "clients")
        specs.push({ col, q: query(c, where(documentId(), "==", client.clientId)) });
      else specs.push({ col, q: c }); // users, catalog* — shared / names
    } else if (col === "notifications" && scope.kind === "full" && scope.appId) {
      // Every screen shows only the signed-in person's own alerts, yet staff
      // downloaded everyone's — the largest collection of all. Only their own
      // now. Alerts for others are still created as before (new documents);
      // nothing is ever inferred deleted (deletes are intent-only).
      specs.push({ col, q: query(collection(fsdb, col), where("userId", "==", scope.appId)) });
    } else if (lazyMode && LAZY_SET.has(col)) {
      // Loaded when a page asks for it — see ensureCollections().
      lazySpecs.set(col, { col, q: collection(fsdb, col) });
    } else {
      specs.push({ col, q: collection(fsdb, col) });
    }
  }

  const names: string[] = specs.map((s) => s.col);
  if (client) names.push("messages");
  names.push(SETTINGS_COL);
  const pending = new Set<string>(names);

  /**
   * What the app genuinely cannot render without: who is signed in, and the
   * orders and clients the first screen is made of.
   *
   * It used to wait for ALL of them — every message, notification, stock
   * movement, purchase and issuance ever recorded — before painting a single
   * pixel. Several of those grow without limit and are never pruned, so the
   * wait got longer every week and was worst on a phone. The rest still load,
   * they just no longer hold the door: each one refreshes the screen as it
   * lands, which is what the listeners already do for every later change.
   */
  const corePending = new Set<string>(
    // The admin-only records are in it too, for the admin. They are a handful
    // of documents, and until they have answered nothing knows whether the
    // private store is live — so an admin who acted in the first second used
    // to save cost figures back where everyone could read them.
    // Roles too: the sidebar is drawn from them, and drawn without them an
    // employee would see sections they are about to lose.
    names.filter((n) => n === "users" || n === "clients" || n === "orders" || n === SETTINGS_COL || n === "adminRecords" || n === "roles"),
  );

  // How long the whole load actually takes, logged once everything is in.
  // Read it in the browser console as "[db] startup".
  const t0 = typeof performance !== "undefined" ? performance.now() : Date.now();
  startup.openedMs = 0; startup.loadedMs = 0; startup.startedAt = Date.now();
  const timing: { col: string; ms: number; docs: number }[] = [];
  const mark = (col: string, docs: number) => {
    const now = typeof performance !== "undefined" ? performance.now() : Date.now();
    timing.push({ col, ms: Math.round(now - t0), docs });
  };

  // Set once the core streams are up; called the moment they have all landed.
  let restAttach: (() => void) | null = null;

  return new Promise((resolve) => {
    let opened = false;
    const first = (name: string) => {
      pending.delete(name);
      corePending.delete(name);
      loadedCols.add(name);
      loadWaiters.forEach(w => w());
      // Open as soon as there is something to show. Everything else arrives
      // behind it and refreshes the screen as it does.
      if (!opened && corePending.size === 0) {
        opened = true;
        seeded = true;
        const ms = Math.round((typeof performance !== "undefined" ? performance.now() : Date.now()) - t0);
        startup.openedMs = ms;
        console.info(`[db] opened in ${ms}ms — ${pending.size} collection(s) now loading in the background${lazySpecs.size ? `, ${lazySpecs.size} when a page needs them` : ""}`);
        resolve();
        // Everything else starts only now, so it never competes with the three
        // streams the splash screen was waiting on.
        const go = restAttach;
        restAttach = null;
        if (go) setTimeout(() => { if (gen === subGeneration) go(); }, 0);
      }
      if (pending.size === 0) {
        const total = timing.length ? Math.max(...timing.map((t) => t.ms)) : 0;
        const docs = timing.reduce((s, t) => s + t.docs, 0);
        if (!startup.loadedMs) startup.loadedMs = total;
        const slowest = [...timing].sort((a, b) => b.ms - a.ms).slice(0, 6);
        const biggest = [...timing].sort((a, b) => b.docs - a.docs).slice(0, 6);
        console.info(
          `[db] startup: ${timing.length} collections, ${docs} documents, ${total}ms to finish loading`
          + `
      slowest: ${slowest.map((t) => `${t.col} ${t.ms}ms`).join(", ")}`
          + `
      biggest: ${biggest.map((t) => `${t.col} ${t.docs} docs`).join(", ")}`,
        );
        emit();
      }
    };

    const attach = ({ col, q }: { col: ArrayCol; q: Query<DocumentData> }) => {
      unsubscribers.push(
        onSnapshot(
          q,
          LISTEN,
          serverFirst(col, (snap) => {
            // The rules for the admin-only records are live: they can be
            // written there from now on rather than in the old places.
            if (col === "adminRecords") adminStoreLive = true;
            if (col === "roles") rolesStoreLive = true;
            if (writePending[col]) {
              first(col);
              return;
            }
            applyList(
              col,
              snap.docs.map((d) => d.data() as Record<string, unknown>),
            );
            if (pending.has(col)) mark(col, snap.docs.length);
            first(col);
            if (seeded) emit();
          }),
          (err) => {
            console.error(`[db] listener ${col} failed:`, err);
            if (col === "adminRecords") adminStoreLive = false;
            if (col === "roles") rolesStoreLive = false;
            first(col);
          },
        ),
      );
    };

    // Opening twenty-nine listen streams at once puts them all on one
    // connection, so the three the splash screen is actually waiting for queue
    // behind twenty-six nobody needs yet — on a phone that is most of the wait.
    // The core goes on first and has the connection to itself; the rest follow
    // once it has landed, and refresh the screen as they arrive.
    lazyAttach = (col: string) => {
      const sp = lazySpecs.get(col);
      if (!sp || lazyAttached.has(col) || gen !== subGeneration) return;
      lazyAttached.add(col);
      lazyWanted.delete(col);
      console.info(`[db] loading ${col} — a page needs it`);
      attach(sp);
    };
    for (const c of [...lazyWanted]) lazyAttach(c);

    // The server's totals, read-only, for staff — never written from here.
    const attachSummaries = () => {
      if (client) return;
      unsubscribers.push(onSnapshot(collection(fsdb, "summaries"), LISTEN, serverFirst("summaries", (snap) => {
        summaryMap = new Map(snap.docs.map(d => [d.id, d.data() as Record<string, unknown>]));
        summariesOn = true;
        summariesDone = true;
        if (seeded) emit();
      }), (err) => {
        console.warn("[db] server totals not available:", err?.message ?? err);
        summariesOn = false;
        summariesDone = true;
        emit();
      }));
    };

    const core = specs.filter((s) => corePending.has(s.col));
    const rest = specs.filter((s) => !corePending.has(s.col));
    core.forEach(attach);
    const attachRest = () => { rest.forEach(attach); attachSummaries(); };
    if (core.length === 0) attachRest();
    else restAttach = attachRest;

    // A client's messages are those they sent OR received — two queries merged
    // (Firestore can't OR across two fields in one query).
    if (client) {
      let fromMsgs: Record<string, unknown>[] = [];
      let toMsgs: Record<string, unknown>[] = [];
      let firedFrom = false,
        firedTo = false;
      const apply = () => {
        const map = new Map<string, Record<string, unknown>>();
        for (const m of [...fromMsgs, ...toMsgs]) map.set(String(m.id), m);
        applyList("messages", [...map.values()]);
        if (seeded) emit();
      };
      const doneMsg = () => {
        if (firedFrom && firedTo) first("messages");
      };
      const msgs = collection(fsdb, "messages");
      unsubscribers.push(
        onSnapshot(
          query(msgs, where("fromUserId", "==", client.appId)),
          LISTEN,
          serverFirst("messages(from)", (snap) => {
            if (!writePending["messages"]) {
              fromMsgs = snap.docs.map((d) => d.data() as Record<string, unknown>);
              apply();
            }
            firedFrom = true;
            doneMsg();
          }),
          (err) => {
            console.error("[db] listener messages(from) failed:", err);
            firedFrom = true;
            doneMsg();
          },
        ),
      );
      unsubscribers.push(
        onSnapshot(
          query(msgs, where("toUserId", "==", client.appId)),
          LISTEN,
          serverFirst("messages(to)", (snap) => {
            if (!writePending["messages"]) {
              toMsgs = snap.docs.map((d) => d.data() as Record<string, unknown>);
              apply();
            }
            firedTo = true;
            doneMsg();
          }),
          (err) => {
            console.error("[db] listener messages(to) failed:", err);
            firedTo = true;
            doneMsg();
          },
        ),
      );
    }

    unsubscribers.push(
      onSnapshot(
        doc(fsdb, SETTINGS_COL, SETTINGS_DOC),
        LISTEN,
        serverFirst<DocumentSnapshot<DocumentData>>("settings", (snap) => {
          if (writePending[SETTINGS_COL]) {
            first(SETTINGS_COL);
            return;
          }
          if (snap.exists()) {
            cache.settings = { ...defaultSettings(), ...(snap.data() as Settings) };
            remote.settings = clean(cache.settings);
          }
          first(SETTINGS_COL);
          if (seeded) emit();
        }),
        (err) => {
          console.error("[db] listener settings failed:", err);
          first(SETTINGS_COL);
        },
      ),
    );
  });
}

/** Read the pre-Firebase localStorage blob, if any. */
function readLegacy(): DB | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(LEGACY_KEY);
    if (!raw) return null;
    const db = JSON.parse(raw) as DB;
    return db && Array.isArray(db.users) ? db : null;
  } catch {
    return null;
  }
}

/**
 * One-time migration of a pre-Firebase localStorage DB into Firestore
 * (uploading inline base64 media to Storage). Merges into whatever is already
 * in Firestore rather than overwriting. Legacy employee/client accounts keep
 * their stored password so the admin can later provision Auth accounts for them
 * from Settings → "Sync logins".
 */
async function migrateLegacy(legacy: DB) {
  console.info("[db] Migrating legacy localStorage data to Firestore…");
  const migrated = await uploadInlineMedia(legacy);
  const mergeById = <T extends { id: string }>(existing: T[], incoming: T[]): T[] => {
    const map = new Map(existing.map((x) => [x.id, x]));
    for (const x of incoming || []) if (!map.has(x.id)) map.set(x.id, x);
    return [...map.values()];
  };
  cache.users = mergeById(cache.users, migrated.users || []);
  cache.clients = mergeById(cache.clients, migrated.clients || []);
  cache.orders = mergeById(cache.orders, (migrated.orders || []).map(normalizeOrder));
  cache.tasks = mergeById(cache.tasks, migrated.tasks || []);
  cache.messages = mergeById(cache.messages, migrated.messages || []);
  cache.notifications = mergeById(cache.notifications, migrated.notifications || []);
  cache.invoices = mergeById(cache.invoices, migrated.invoices || []);
  cache.expenses = mergeById(cache.expenses, migrated.expenses || []);
  cache.catalogFolders = mergeById(cache.catalogFolders, migrated.catalogFolders || []);
  const favKey = (f: CatalogFavorite) => `${f.userId}__${f.itemId}`;
  const favSeen = new Set(cache.catalogFavorites.map(favKey));
  for (const f of migrated.catalogFavorites || [])
    if (!favSeen.has(favKey(f))) cache.catalogFavorites.push(f);
  await persist();
  // catalogItems is paginated and written directly (see src/lib/catalogItems.ts),
  // not through the diff-based persist() above — migrate it the same way.
  if ((migrated.catalogItems || []).length) {
    const { createCatalogItem } = await import("./catalogItems");
    for (const item of migrated.catalogItems) await createCatalogItem(item);
  }
  try {
    localStorage.removeItem(LEGACY_KEY);
  } catch {
    /* ignore */
  }
  console.info("[db] Migration complete.");
}

/**
 * Walk a DB replacing inline base64/data-URL media with Firebase Storage URLs.
 * Used once during legacy migration. Runtime uploads happen in the pages.
 */
async function uploadInlineMedia(db: DB): Promise<DB> {
  const { uploadDataUrl } = await import("./storage");
  const up = async (val?: string, folder = "misc") =>
    val && val.startsWith("data:") ? await uploadDataUrl(val, folder) : val;

  for (const o of db.orders || []) {
    if (o.images)
      o.images = await Promise.all(
        o.images.map((img) => up(img, `orders/${o.id}`) as Promise<string>),
      );
    o.cadImage = await up(o.cadImage, `orders/${o.id}/cad`);
    for (const t of o.timeline || []) t.photo = await up(t.photo, `orders/${o.id}/timeline`);
  }
  for (const it of db.catalogItems || [])
    it.data = (await up(it.data, `catalog/${it.folderId}`)) || it.data;
  for (const u of db.users || []) u.photo = await up(u.photo, `users/${u.id}`);
  if (db.settings) {
    db.settings.invoiceQr1 = await up(db.settings.invoiceQr1, "settings");
    db.settings.invoiceQr2 = await up(db.settings.invoiceQr2, "settings");
    db.settings.invoiceStamp = await up(db.settings.invoiceStamp, "settings");
  }
  return db;
}

// helpers
/* ── Whose work a person reaches (lib/permissions.ts, RoleReach) ──────────
 * An admin, or an employee whose role reaches every order: everything. Any
 * other employee: the orders assigned to them, and every order of a client
 * they are the account manager of. A client: their own. One rule, asked the
 * same way by every list, search and button — so a role that may update
 * "every order" really does see every order. */

/** Who is asking — the parts of a person these rules read. */
export type Worker = { id: string; role: Role; roleId?: string; clientId?: string };

/** Whether this order is within this person's work. */
export function worksOnOrder(db: DB, user: Worker, o: Pick<Order, "clientId" | "assignedEmployeeId">): boolean {
  if (user.role === "client") return o.clientId === user.clientId;
  if (reachOf(user, db.roles ?? []) === "all") return true;
  if (o.assignedEmployeeId === user.id) return true;
  return db.clients.find((c) => c.id === o.clientId)?.accountManagerId === user.id;
}

/** Whether this client is within this person's work. */
export function worksOnClient(db: DB, user: Worker, c: Pick<Client, "id" | "accountManagerId">): boolean {
  if (user.role === "client") return c.id === user.clientId;
  return reachOf(user, db.roles ?? []) === "all" || c.accountManagerId === user.id;
}

/** The clients within this person's work. */
export function currentUserClients(db: DB, user: Worker): Client[] {
  if (user.role !== "client" && reachOf(user, db.roles ?? []) === "all") return db.clients;
  return db.clients.filter((c) => worksOnClient(db, user, c));
}

export function currentUserOrders(db: DB, user: User): Order[] {
  if (user.role === "client") return db.orders.filter((o) => o.clientId === user.clientId);
  if (reachOf(user, db.roles ?? []) === "all") return db.orders;
  // Employee: orders assigned to them OR belonging to a client they manage.
  const myClientIds = new Set(
    db.clients.filter((c) => c.accountManagerId === user.id).map((c) => c.id),
  );
  return db.orders.filter((o) => o.assignedEmployeeId === user.id || myClientIds.has(o.clientId));
}

/**
 * Hand orders to someone else — or to nobody. Admin only (the screens offer it
 * to nobody else). The new holder is told; whoever manages the client keeps
 * seeing the order either way. Call inside updateDb(). Returns how many moved.
 */
export function assignOrders(d: DB, orderIds: string[], employeeId: string | null, by: { id: string; name: string }, at: string): number {
  const to = employeeId ? d.users.find((u) => u.id === employeeId) : undefined;
  if (employeeId && !to) return 0;
  const moved: Order[] = [];
  for (const id of orderIds) {
    const o = d.orders.find((x) => x.id === id);
    if (!o || (o.assignedEmployeeId ?? null) === employeeId) continue;
    if (employeeId) o.assignedEmployeeId = employeeId;
    else delete o.assignedEmployeeId;
    moved.push(o);
  }
  if (to && to.id !== by.id && moved.length) {
    d.notifications.unshift({
      id: uid("n_"), userId: to.id,
      title: moved.length === 1 ? "Order assigned to you" : `${moved.length} orders assigned to you`,
      body: `${moved.slice(0, 5).map((o) => o.orderNumber).join(", ")}${moved.length > 5 ? ` and ${moved.length - 5} more` : ""} · by ${by.name}`,
      type: "info", read: false, createdAt: at,
    });
  }
  return moved.length;
}

export function fmtMoney(n: number) {
  // Show cents only when the amount actually has them — whole amounts stay clean
  // ($1,500) while a $1,234.56 balance is no longer rounded to "$1,235".
  const hasCents = Math.round(n * 100) % 100 !== 0;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: hasCents ? 2 : 0,
    maximumFractionDigits: hasCents ? 2 : 0,
  }).format(n);
}

export function fmtDate(iso?: string) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-IN", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).replace(/\bSept\b/, "Sep");
}

// Heartbeat cadence (see src/lib/presence.ts) is ~45s — anything fresher than
// this is treated as "still here", with slack for a missed beat + network lag.
export const ONLINE_THRESHOLD_MS = 2 * 60 * 1000;

export function isOnline(lastActiveAt?: string): boolean {
  return !!lastActiveAt && Date.now() - new Date(lastActiveAt).getTime() < ONLINE_THRESHOLD_MS;
}

/** "Last seen" style relative time — "Just now" / "5m ago" / "3h ago" / "2d ago" / a date once it's old. */
export function timeAgo(iso?: string): string {
  if (!iso) return "Never";
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 45 * 1000) return "Just now";
  const min = Math.floor(ms / 60000);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d ago`;
  return fmtDate(iso);
}

/**
 * The MAIN diamond's shape for an order — the biggest stone actually on it.
 * Used for the invoice description ("14KT WG Round Ring US-7"). The order
 * itself doesn't carry a shape, so it is read from (in order of confidence)
 * the certified packets on the order, the loose diamond issued to the factory,
 * then any diamond bought for the order.
 */
export function mainDiamondShape(d: DB, orderId: string): string | undefined {
  let best: { shape: string; carat: number } | undefined;
  const take = (shape: string | undefined, carat: number) => {
    const s = (shape ?? "").trim();
    if (!s || s.toLowerCase() === "certified" || s.toLowerCase() === "unspecified") return;
    if (!best || carat > best.carat) best = { shape: s, carat };
  };
  for (const p of d.diamondPackets ?? []) {
    if (p.orderId === orderId && p.status !== "in_stock") take(p.shape, p.carat || 0);
  }
  if (!best) {
    for (const i of d.materialIssuances ?? []) {
      if (i.orderId === orderId && i.material === "diamond") take(i.purityOrQuality, i.quantityIssued || 0);
    }
  }
  if (!best) {
    for (const p of d.purchases ?? []) {
      if (p.orderId === orderId && p.material === "diamond") take(p.diamond?.shape, p.diamond?.carat || 0);
    }
  }
  return best?.shape;
}

/* ── Admin-only figures: where they are read from, and written to ─────────── */

/**
 * The dated exchange rates. From the admin-only record once the move has been
 * made; until then from the settings document, where they were first kept.
 */
export function fxTableOf(d: DB): { rates: { from: string; rate: number }[]; flat?: number } {
  const rec = (d.adminRecords ?? []).find(r => r.kind === "fx") as Extract<AdminRecord, { kind: "fx" }> | undefined;
  if (rec) return { rates: rec.rates ?? [], flat: rec.flat };
  return { rates: d.settings.fxRates ?? [], flat: d.settings.usdToInr };
}

/** What a ready-stock piece cost — the admin-only record first, the old field
 *  on the item until it has been moved. */
export function stockCostOf(d: DB, item: { id: string; cost?: number }): number | undefined {
  const rec = (d.adminRecords ?? []).find(r => r.kind === "stockCost" && r.itemId === item.id) as
    Extract<AdminRecord, { kind: "stockCost" }> | undefined;
  return rec ? rec.cost : item.cost;
}

/**
 * Save the rate table. Into the admin-only record when its rules are live;
 * otherwise into settings as before — a write the rules refuse would be kept
 * only on this device and lost on the next reload, which is worse than a rate
 * staff could have read.
 */
export function writeFxTable(d: DB, rates: { from: string; rate: number }[], flat?: number): "private" | "settings" {
  if (adminStoreReady()) {
    if (!d.adminRecords) d.adminRecords = [];
    const i = d.adminRecords.findIndex(r => r.kind === "fx");
    const rec: AdminRecord = { id: "fx", kind: "fx", rates, ...(flat ? { flat } : {}) };
    if (i >= 0) d.adminRecords[i] = rec; else d.adminRecords.push(rec);
    return "private";
  }
  d.settings = { ...d.settings, fxRates: rates };
  return "settings";
}

/** Save a ready-stock piece's cost, by the same rule. Undefined clears it. */
export function writeStockCost(d: DB, itemId: string, cost: number | undefined): "private" | "settings" {
  const item = d.readyStock.find(i => i.id === itemId);
  if (adminStoreReady()) {
    if (!d.adminRecords) d.adminRecords = [];
    d.adminRecords = d.adminRecords.filter(r => !(r.kind === "stockCost" && r.itemId === itemId));
    if (cost != null && cost > 0) d.adminRecords.push({ id: `rsc_${itemId}`, kind: "stockCost", itemId, cost });
    // Nothing left on the item for anyone else to read.
    if (item && item.cost !== undefined) delete item.cost;
    return "private";
  }
  if (item) item.cost = cost;
  return "settings";
}

/**
 * Everything still sitting where others can read it: ready-stock costs on the
 * items themselves, and the rates in settings. Counted, so the admin can see
 * whether the move is still owed.
 */
export function exposedAdminFigures(d: DB): { stockCosts: number; rates: boolean } {
  return {
    stockCosts: d.readyStock.filter(i => i.cost != null).length,
    rates: !!(d.settings.fxRates?.length || d.settings.usdToInr),
  };
}

/**
 * Copy every exposed figure into the admin-only records. Copying only — the
 * originals are removed by stripExposedAdminFigures, and only once this copy is
 * confirmed to have reached the server, so nothing can be lost in between.
 */
export function copyAdminFiguresToPrivate(d: DB): number {
  if (!d.adminRecords) d.adminRecords = [];
  let n = 0;
  if (!d.adminRecords.some(r => r.kind === "fx") && (d.settings.fxRates?.length || d.settings.usdToInr)) {
    d.adminRecords.push({ id: "fx", kind: "fx", rates: d.settings.fxRates ?? [], ...(d.settings.usdToInr ? { flat: d.settings.usdToInr } : {}) });
    n++;
  }
  for (const item of d.readyStock) {
    if (item.cost == null) continue;
    if (d.adminRecords.some(r => r.kind === "stockCost" && r.itemId === item.id)) continue;
    d.adminRecords.push({ id: `rsc_${item.id}`, kind: "stockCost", itemId: item.id, cost: item.cost });
    n++;
  }
  return n;
}

/** Remove the exposed originals — but only those whose private copy exists. */
export function stripExposedAdminFigures(d: DB): number {
  let n = 0;
  const priv = d.adminRecords ?? [];
  if (priv.some(r => r.kind === "fx") && (d.settings.fxRates || d.settings.usdToInr)) {
    const s = { ...d.settings };
    delete s.fxRates;
    delete s.usdToInr;
    d.settings = s;
    n++;
  }
  for (const item of d.readyStock) {
    if (item.cost == null) continue;
    if (!priv.some(r => r.kind === "stockCost" && r.itemId === item.id)) continue;
    delete item.cost;
    n++;
  }
  return n;
}

/** True when a collection's writes have been refused this session. */
export function collectionRefused(col: string): boolean {
  return deniedCols.has(col);
}
