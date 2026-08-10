// Firebase-backed database for Starlink Jewels / Diamond Flow.
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
import {
  collection,
  doc,
  onSnapshot,
  writeBatch,
  query,
  where,
  getDoc,
  documentId,
  type Query,
  type DocumentData,
} from "firebase/firestore";
import { db as fsdb } from "./firebase";

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
  password: string;
  status: "active" | "inactive";
  accountManagerId?: string;
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
export const KARAT_PURITY: Record<number, number> = {
  9: 0.375, 10: 0.417, 14: 0.585, 18: 0.75, 22: 0.916, 24: 1,
};

/** Grams of a given karat → grams of pure (24KT) gold. Unknown karat → treat as pure. */
export function toPureGold(grams: number, karat: string | number): number {
  const n = typeof karat === "number" ? karat : parseInt(String(karat), 10);
  const pct = KARAT_PURITY[n] ?? 1;
  return Math.round(grams * pct * 1000) / 1000;
}

/** Grams at an explicit purity (parts-per-1000, e.g. 750 for 18K, or 748 for a
 *  factory's measured touch) → pure (24KT) grams. Lets staff enter the real
 *  purity the factory reports instead of the textbook karat percentage. */
export function pureFromPurity(grams: number, purityPerMille: number): number {
  return Math.round(grams * (purityPerMille / 1000) * 1000) / 1000;
}

/** 1 carat = 0.2 grams — for gross-weight (gold + diamond) maths. */
export const CARAT_TO_GRAM = 0.2;

export function buildTimelineSteps(hasCertificate: boolean): string[] {
  return (TIMELINE_STEPS as readonly string[]).filter(
    (s) => s !== "Certification" || hasCertificate,
  );
}

// A Ready-Stock (in-house) order has no client, so it skips the client-approval
// and shipping stages — just design, produce, then add the finished piece to stock.
export const READY_STOCK_TIMELINE_STEPS = ["Order Submitted", "CAD Designing", "In Production", "Ready for Stock"] as const;
export function buildReadyStockTimelineSteps(): string[] {
  return [...READY_STOCK_TIMELINE_STEPS];
}

// Selling an EXISTING finished piece from Ready Stock — the piece is already made,
// so there's no design/production: just confirm, dispatch, deliver.
export const READY_STOCK_SALE_TIMELINE_STEPS = ["Order Confirmed", "Dispatch", "Delivered"] as const;
export function buildReadyStockSaleTimelineSteps(): string[] {
  return [...READY_STOCK_SALE_TIMELINE_STEPS];
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
}

// Manufacturing events shown alongside (but never mixed into) the fixed,
// index-based `timeline` array — see Order.manufacturingLog below.
export type ManufacturingLogEntryType =
  "material_purchased" | "factory_assigned" | "material_issued" | "material_returned" | "piece_finished" | "making_charge_added";

export interface ManufacturingLogEntry {
  id: string;
  type: ManufacturingLogEntryType;
  at: string;
  employeeId?: string;
  factoryId?: string;
  material?: "gold" | "diamond";
  amountMaterial?: number; // grams (gold) or carats (diamond)
  amountInr?: number;
  remarks?: string;
}

export interface Order {
  id: string;
  orderNumber: string;
  clientId: string; // empty string when forReadyStock (in-house build, no client)
  forReadyStock?: boolean; // in-house order that becomes a Ready Stock item when finished
  readyStockCreatedId?: string; // ReadyStockItem.id created from this order (once "Add to Ready Stock" is done)
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
  amount: number; // snapshot at creation; the UI always recomputes live from the orders
  paid: boolean;
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
 * Create ONE invoice covering the given orders (dispatch-batch invoicing). Skips
 * any order already invoiced, and any that isn't priced. Returns the new invoice,
 * or null if nothing eligible. Call inside updateDb().
 */
export function createInvoiceFromOrders(d: DB, clientId: string, orderIds: string[], at: string): Invoice | null {
  if (!d.invoices) d.invoices = [];
  const eligible = orderIds.filter(oid => {
    const o = d.orders.find(x => x.id === oid);
    return o && o.clientId === clientId && o.amount > 0 && o.status !== "Rejected" && !orderInvoiced(d.invoices, oid);
  });
  if (!eligible.length) return null;
  const amount = eligible.reduce((s, oid) => {
    const o = d.orders.find(x => x.id === oid)!;
    return s + orderTotal(o);
  }, 0);
  const allCleared = eligible.every(oid => balanceDue(d.orders.find(x => x.id === oid)!) <= 0);
  const inv: Invoice = {
    id: uid("inv_"), orderId: eligible[0], orderIds: eligible, clientId,
    number: nextInvoiceNumber(d), amount, paid: allCleared, createdAt: at,
  };
  d.invoices.push(inv);
  return inv;
}

// Categories are user-managed from Settings (Settings.expenseCategories) —
// this is just the fallback list for a settings doc that predates that field.
export const DEFAULT_EXPENSE_CATEGORIES = ["Travel", "Food", "Tools", "Office", "Communication", "Other"];
export type ExpenseCategory = string;

export interface Expense {
  id: string;
  title: string;
  amount: number;
  category: ExpenseCategory;
  note?: string;
  employeeId: string; // userId of admin or employee who added it
  clientId?: string; // optional: which client this expense relates to
  createdAt: string;
  lockerId?: string; // optional — which Locker this was actually paid from
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

export type CatalogItemType = "image" | "video";

export interface CatalogItem {
  id: string;
  folderId: string;
  name: string;
  type: CatalogItemType;
  data: string; // base64 data URL
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
  type: CatalogItemType; // "image" | "video"
  url: string; // Firebase Storage download URL
  createdBy: string; // userId
  createdAt: string;
}

// A public, no-login share of one Catalog / Product-Photos folder. A SNAPSHOT:
// the folder's media (name + Storage URL) is copied in at share time, so the
// share doc is fully self-contained and exposes nothing but the shared media
// (Storage download URLs are already public/tokenized). Read by anyone via the
// /s/:id route (see firestore.rules — shares are the one public-read collection).
export interface ShareItem {
  type: CatalogItemType; // "image" | "video"
  url: string;
  name: string;
  folder?: string; // originating sub-folder name, for grouping/labels
}
export interface Share {
  id: string;
  kind: "catalog" | "productPhotos";
  sourceFolderId: string; // the folder this snapshot was taken from (to find/refresh)
  title: string; // folder name shown to the public viewer
  items: ShareItem[];
  count: number;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  expiresAt?: string; // ISO; empty/absent = never expires. After this, the public link redirects to the main site.
}

export interface Settings {
  companyName: string;
  currency: string;
  language: string;
  notifications: boolean;
  diamondRate: number; // $ per carat
  metalRate: number; // $ per gram
  defaultShippingCharge: number; // $ flat default per order
  cashbackPercent?: number; // % of order value granted as a gift card on delivery (only to gift-card-enabled clients)
  giftMaxRedeemPercent?: number; // default max % of an order a gift card may cover (per-client overridable); blank = 25
  barcodeBandEnabled?: boolean; // show the "Print Band" (barcode jewellery tag) option on orders. undefined = on.
  barcodeBandShowPrice?: boolean; // print the price on the band. undefined = on.
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
  // Monotonic counter behind nextDiamondStockNumber() — never reused even if
  // a packet is later deleted, unset = no certified packet has been numbered yet.
  nextDiamondStockNo?: number;
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
  currency?: "INR" | "USD"; // undefined = "INR" (every locker built before this field existed)
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
  currency?: "INR" | "USD"; // undefined = "INR", matches the parent locker
  category?: string; // "Supplier Payment" | "Factory Making Charges" | "Owner Deposit" | "Local Expense" | ...
  refType?: "purchase" | "materialIssuance" | "manual" | "transfer" | "clientPayment" | "expense";
  refId?: string; // Purchase.id / MaterialIssuance.id / Order.id / Expense.id, when auto-generated by a payment entry
  pairedLockerId?: string; // transfer_in/transfer_out: the other side of the transfer
  // Set ONLY on a cross-currency transfer_out/transfer_in pair (same value on
  // both sides, for audit) — always expressed as "₹ per $1 USD", regardless of
  // which side is USD (same convention as Purchase.exchangeRate). Unset for
  // same-currency transfers — no conversion happens, amountInr is literal on
  // both sides exactly as before this field existed.
  exchangeRate?: number;
  note?: string;
  recordedBy: string; // userId
  createdAt: string;
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
}

export type PurchaseMaterial = "gold" | "diamond";
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
  "Cushion", "Radiant", "Heart", "Asscher", "Baguette", "Other",
] as const;

export interface DiamondPurchaseDetail {
  carat: number;
  quality?: string; // clarity/color grade, free text
  ratePerCarat: number; // in the purchase's billing currency
  // "loose" → pooled into stock by shape; "certified" → each stone an individual
  // packet (see DiamondPacket). Older records without this are treated as loose.
  kind?: "loose" | "certified";
  shape?: string; // one of DIAMOND_SHAPES — the loose-stock bucket key
  certificateNumber?: string;
  certificateLab?: string; // GIA / IGI / etc.
}

/**
 * A single CERTIFIED diamond — tracked as its own packet (never pooled), because
 * each has a unique certificate. Loose diamonds instead live as a running carat
 * total per shape in stockLevels (src/lib/stock.ts).
 */
export interface DiamondPacket {
  id: string;
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

export interface Purchase {
  id: string;
  supplierId: string;
  material: PurchaseMaterial;
  gold?: GoldPurchaseDetail; // present iff material === "gold"
  diamond?: DiamondPurchaseDetail; // present iff material === "diamond"
  purpose: PurchasePurpose;
  orderId?: string; // required iff purpose === "order"

  currency: PurchaseCurrency;
  totalUsd?: number; // set iff currency === "USD" — raw supplier invoice amount
  exchangeRate?: number; // set iff currency === "USD" — manually entered USD→INR rate AT PURCHASE TIME
  totalInr: number; // ALWAYS present — the one canonical amount every ledger function sums

  payments: PurchasePayment[]; // mirrors Order.advances[] — paid/pending are derived, never stored
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
  images: string[]; // Storage URLs, up to 3 — same upload pattern as Order.images
  sku?: string;
  location?: string; // where the piece physically is — US / Hong Kong / India / Other
  notes?: string;
  createdBy: string;
  createdAt: string;
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
  material: "gold" | "diamond";
  purityOrQuality: string;
  quantityIssued: number; // grams (gold) or carats (diamond)
  source: "stock" | "purchase" | "factoryPool";
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
  // Structured labour that makes up makingCharges.amountInr (the factory payable):
  //   perGramRate × net weight + cadCharge + diamondCt × diamondHandlingRate
  //   + otherCharges + metalByFactoryGrams × metalByFactoryRate
  labour?: {
    perGramRate?: number;
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
  material: "gold" | "diamond";
  type: StockMovementType;
  purityOrQuality: string;
  quantity: number; // always positive; direction implied by `type`
  refType?: "purchase" | "materialIssuance" | "order" | "diamondSale" | "manual";
  refId?: string;
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
  factories: Factory[];
  materialIssuances: MaterialIssuance[];
  stockMovements: StockMovement[];
  readyStock: ReadyStockItem[];
  diamondPackets: DiamondPacket[];
  diamondSales: DiamondSale[];
  session: { userId: string | null };
}

const LEGACY_KEY = "starlink_db_v2"; // pre-Firebase localStorage blob (migrated on first run)

function defaultSettings(): Settings {
  return {
    companyName: "Starlink Jewels",
    currency: "USD",
    language: "English",
    notifications: true,
    diamondRate: 3500,
    metalRate: 65,
    defaultShippingCharge: 0,
    invoiceAddress1: "55 JOHN ST",
    invoiceAddress2: "EAST RUTHERFORD",
    invoiceAddress3: "NEW JERSEY 07073",
    invoiceTel: "+91 83472 78188",
    invoicePrimary: "+1 201 554 4824",
    invoiceEmail: "Starlinkjewels@gmail.com",
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
    factories: [],
    materialIssuances: [],
    stockMovements: [],
    readyStock: [],
    diamondPackets: [],
    diamondSales: [],
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
  return { ...cache };
}

export function totalAdvance(order: Order): number {
  return (order.advances || []).reduce((s, a) => s + a.amount, 0);
}

/** Jewellery value + shipping + certificate fee, BEFORE any gift-card discount. */
export function orderGrossTotal(order: Order): number {
  return order.amount + (order.shippingCharge || 0) + (order.certificateFee || 0);
}

/** The amount the client owes in full — gross minus any redeemed gift card (a discount). */
export function orderTotal(order: Order): number {
  return Math.max(0, Math.round((orderGrossTotal(order) - (order.giftCardRedeemed || 0)) * 100) / 100);
}

export function balanceDue(order: Order): number {
  // Round to cents so a sub-cent floating residue never shows as a stray "$0" due.
  return Math.max(0, Math.round((orderTotal(order) - totalAdvance(order)) * 100) / 100);
}

// ── Gift cards (USD). remaining is DERIVED from orders, never stored on the card. ──
const r2 = (n: number) => Math.round(n * 100) / 100;

/** USD still available on a card = granted − everything redeemed across live orders. */
export function giftCardRemaining(card: GiftCard, orders: Order[]): number {
  const used = orders.reduce((s, o) =>
    (o.giftCardId === card.id && o.status !== "Rejected") ? s + (o.giftCardRedeemed || 0) : s, 0);
  return r2(Math.max(0, card.amount - used));
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
export function giftCardStats(cards: GiftCard[], orders: Order[]): GiftCardStats {
  let issued = 0, used = 0, pending = 0, expired = 0;
  for (const c of cards) {
    const remaining = giftCardRemaining(c, orders);
    issued = r2(issued + c.amount);
    used = r2(used + (c.amount - remaining));
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
 * Auto-assign an invoice number to a priced order that doesn't have one yet.
 * Called wherever an order gets a price (creation, pricing, final approval),
 * so invoice numbers happen automatically — no manual "generate" step. The
 * number is the next sequential across all existing invoices, zero-padded.
 * No-op if the order isn't priced, is rejected, or already has an invoice.
 */
export function ensureInvoiceForOrder(d: DB, orderId: string): void {
  const o = d.orders.find(x => x.id === orderId);
  if (!o || o.amount <= 0 || o.status === "Rejected") return;
  if (!d.invoices) d.invoices = [];
  if (d.invoices.some(i => i.orderId === orderId)) return;
  const nextNum = d.invoices.reduce((m, i) => Math.max(m, parseInt(i.number, 10) || 0), 0) + 1;
  d.invoices.push({
    id: uid("inv_"),
    orderId,
    clientId: o.clientId,
    number: String(nextNum).padStart(4, "0"),
    amount: orderTotal(o),
    paid: balanceDue(o) <= 0,
    createdAt: o.createdAt,
  });
}

/**
 * Apply `amount` across the given orders, OLDEST bill first (FIFO), by pushing a
 * payment (advance) entry onto each order until its balance is cleared. Mutates
 * the passed order objects (call inside updateDb). Returns the unallocated
 * leftover — which the caller should carry forward as client credit.
 */
export function allocatePaymentFIFO(
  orders: Order[],
  amount: number,
  recordedBy: string,
  at: string,
  note = "Payment received",
): number {
  let remaining = amount;
  const oldestFirst = [...orders].sort((a, b) => +new Date(a.createdAt) - +new Date(b.createdAt));
  for (const o of oldestFirst) {
    if (remaining <= 0) break;
    const bal = balanceDue(o);
    if (bal <= 0) continue;
    const pay = Math.min(remaining, bal);
    if (!o.advances) o.advances = [];
    o.advances.push({ id: uid("adv_"), amount: pay, note, recordedBy, createdAt: at });
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
 * Reconcile a client's account: reclaim any per-order overpayment, add carried
 * credit and any `extra` new payment, then re-allocate oldest-bill-first.
 * Mutates the given orders; returns the leftover to store as client credit.
 */
export function reconcileClientAccount(
  orders: Order[],
  extra: number,
  creditBalance: number,
  recordedBy: string,
  at: string,
  note?: string,
): number {
  let pool = (extra || 0) + (creditBalance || 0);
  for (const o of orders) pool += capOrderAdvances(o);
  pool = Math.round(pool * 100) / 100;
  return allocatePaymentFIFO(orders, pool, recordedBy, at, note);
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
  opts: { amount: number; recordedBy: string; at: string; note?: string; lockerId?: string; lockerAmount?: number; exchangeRate?: number },
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
      id: uid("adv_"), amount: applied, note: opts.note || defaultNote, recordedBy: opts.recordedBy, createdAt: opts.at,
      lockerId: opts.lockerId || undefined, lockerAmount: opts.lockerId ? opts.lockerAmount : undefined,
    });
    if (opts.lockerId) {
      const locker = d.lockers.find(l => l.id === opts.lockerId);
      if (locker) {
        if (!d.lockerTransactions) d.lockerTransactions = [];
        d.lockerTransactions.push({
          id: uid("ltx_"), lockerId: opts.lockerId, type: "income", amountInr: Number(opts.lockerAmount || 0),
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

/** Client account summary across all their orders (+ carried-forward credit). */
export function clientAccount(orders: Order[], creditBalance = 0) {
  // Outstanding must be summed PER ORDER (capped at 0) — otherwise an order that
  // was overpaid would wrongly cancel out real balance still due on another order.
  let outstanding = 0,
    overpaid = 0;
  for (const o of orders) {
    outstanding += balanceDue(o);
    overpaid += Math.max(0, totalAdvance(o) - orderTotal(o));
  }
  const billed = orders.reduce((s, o) => s + orderTotal(o), 0);
  const allocated = Math.round((billed - outstanding) * 100) / 100; // money applied to bills
  const credit = Math.round(((creditBalance || 0) + overpaid) * 100) / 100;
  return { billed, allocated, outstanding, credit, received: allocated + credit };
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
  | "factories"
  | "materialIssuances"
  | "stockMovements"
  | "readyStock"
  | "diamondPackets"
  | "diamondSales";
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
  "factories",
  "materialIssuances",
  "stockMovements",
  "readyStock",
  "diamondPackets",
  "diamondSales",
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

function emit() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event("starlink-db-updated"));
}

/** Persist the current cache to Firestore, writing only what changed vs `remote`. */
async function persist() {
  // Snapshot the state we are about to commit. Diffing and the post-commit
  // reconciliation both use this frozen copy, so a concurrent updateDb() during
  // the await can't make us mark an unwritten change as already-synced.
  const snap: DB = clean(cache);
  const batch = writeBatch(fsdb);
  const touched = new Set<string>();
  let ops = 0;

  for (const col of ARRAY_COLS) {
    const cur = (snap[col] as unknown as Record<string, unknown>[]) || [];
    const prev = (remote[col] as unknown as Record<string, unknown>[]) || [];
    const curMap = new Map(cur.map((i) => [docId(col, i), i]));
    const prevMap = new Map(prev.map((i) => [docId(col, i), i]));

    for (const [id, item] of curMap) {
      const before = prevMap.get(id);
      if (!before || !eq(before, item)) {
        batch.set(doc(fsdb, col, id), item);
        touched.add(col);
        ops++;
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
      batch.delete(doc(fsdb, col, id));
      touched.add(col);
      ops++;
    }
  }

  if (!eq(snap.settings, remote.settings)) {
    batch.set(
      doc(fsdb, SETTINGS_COL, SETTINGS_DOC),
      snap.settings as unknown as Record<string, unknown>,
    );
    touched.add(SETTINGS_COL);
    ops++;
  }

  // Maintain the userByAuth role index (keyed by Firebase Auth uid). The
  // security rules read these tiny docs to authorise requests. Derived
  // automatically from the users collection — never hand-edited.
  const idxWrites: Record<string, IndexDoc> = {};
  const idxDeletes: string[] = [];
  const desired: Record<string, IndexDoc> = {};
  for (const u of (snap.users || []) as User[]) {
    if (!u.authUid) continue;
    desired[u.authUid] = indexOf(u);
  }
  for (const [auid, data] of Object.entries(desired)) {
    if (remoteIdx[auid] !== JSON.stringify(data)) {
      batch.set(doc(fsdb, INDEX_COL, auid), data as unknown as Record<string, unknown>);
      idxWrites[auid] = data;
      ops++;
    }
  }
  for (const auid of Object.keys(remoteIdx)) {
    if (!desired[auid]) {
      batch.delete(doc(fsdb, INDEX_COL, auid));
      idxDeletes.push(auid);
      ops++;
    }
  }

  if (ops === 0) return;
  touched.forEach((c) => {
    writePending[c] = (writePending[c] || 0) + 1;
  });
  setPending(pendingCount + 1);
  try {
    await batch.commit();
    for (const [auid, data] of Object.entries(idxWrites)) remoteIdx[auid] = JSON.stringify(data);
    for (const auid of idxDeletes) delete remoteIdx[auid];
    // Reconcile only the collections we wrote — leaves remote copies that
    // inbound listeners refreshed for other collections untouched.
    for (const c of touched) {
      if (c === SETTINGS_COL) remote.settings = snap.settings;
      else (remote[c as ArrayCol] as unknown) = snap[c as ArrayCol];
    }
  } catch (err) {
    console.error("[db] Firestore write failed:", err);
    if (typeof window !== "undefined")
      window.dispatchEvent(new CustomEvent("starlink-db-error", { detail: err }));
  } finally {
    touched.forEach((c) => {
      writePending[c] = Math.max(0, (writePending[c] || 1) - 1);
    });
    setPending(pendingCount - 1);
  }
}

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
  if (db && db !== cache) Object.assign(cache, db);
  emit();
  // Chain persists so overlapping saves don't race; each recomputes the diff.
  persistQueue = persistQueue
    .then(persist)
    .catch((err) => console.error("[db] persist error", err));
}

export function updateDb(fn: (db: DB) => void) {
  fn(cache);
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
export type Scope = { kind: "full" } | { kind: "client"; appId: string; clientId: string };

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
export async function resolveScope(authUid: string): Promise<Scope> {
  try {
    const s = await getDoc(doc(fsdb, INDEX_COL, authUid));
    if (s.exists()) {
      const d = s.data() as IndexDoc;
      if (d.role === "client" && d.clientId)
        return { kind: "client", appId: d.appId, clientId: d.clientId };
    }
  } catch (e) {
    console.error("[db] resolveScope failed:", e);
  }
  return { kind: "full" }; // admin, employee, or admin-bootstrap (no index yet)
}

/** Subscribe & load the cache from Firestore for the given scope. */
export function startDb(scope: Scope = { kind: "full" }): Promise<void> {
  if (startPromise) return startPromise;
  startPromise = (async () => {
    await subscribeAll(scope);
    // Legacy localStorage migration only runs for staff (admin) sessions.
    if (scope.kind === "full") {
      const legacy = readLegacy();
      if (legacy && legacy.users.length > 0) await migrateLegacy(legacy);
    }
    seeded = true;
    emit();
  })();
  return startPromise;
}

/** Unsubscribe all listeners and clear the cache (on sign-out). */
export function stopDb() {
  unsubscribers.forEach((u) => {
    try {
      u();
    } catch {
      /* ignore */
    }
  });
  unsubscribers = [];
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

/** Subscribe according to scope; resolves after each stream has fired once. */
function subscribeAll(scope: Scope): Promise<void> {
  const client = scope.kind === "client" ? scope : null;
  messagesScopeIsFull = !client;
  clientAppId = client ? client.appId : null;

  // Build the per-collection queries for this scope.
  const specs: { col: ArrayCol; q: Query<DocumentData> }[] = [];
  for (const col of ARRAY_COLS) {
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
        col === "factories" ||
        col === "materialIssuances" ||
        col === "stockMovements"
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
    } else {
      specs.push({ col, q: collection(fsdb, col) });
    }
  }

  const names: string[] = specs.map((s) => s.col);
  if (client) names.push("messages");
  names.push(SETTINGS_COL);
  const pending = new Set<string>(names);

  return new Promise((resolve) => {
    let done = false;
    const first = (name: string) => {
      pending.delete(name);
      if (!done && pending.size === 0) {
        done = true;
        resolve();
      }
    };

    for (const { col, q } of specs) {
      unsubscribers.push(
        onSnapshot(
          q,
          (snap) => {
            if (writePending[col]) {
              first(col);
              return;
            }
            applyList(
              col,
              snap.docs.map((d) => d.data() as Record<string, unknown>),
            );
            first(col);
            if (seeded) emit();
          },
          (err) => {
            console.error(`[db] listener ${col} failed:`, err);
            first(col);
          },
        ),
      );
    }

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
          (snap) => {
            if (!writePending["messages"]) {
              fromMsgs = snap.docs.map((d) => d.data() as Record<string, unknown>);
              apply();
            }
            firedFrom = true;
            doneMsg();
          },
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
          (snap) => {
            if (!writePending["messages"]) {
              toMsgs = snap.docs.map((d) => d.data() as Record<string, unknown>);
              apply();
            }
            firedTo = true;
            doneMsg();
          },
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
        (snap) => {
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
        },
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
export function currentUserOrders(db: DB, user: User): Order[] {
  if (user.role === "admin") return db.orders;
  if (user.role === "client") return db.orders.filter((o) => o.clientId === user.clientId);
  // Employee: orders assigned to them OR belonging to a client they manage.
  const myClientIds = new Set(
    db.clients.filter((c) => c.accountManagerId === user.id).map((c) => c.id),
  );
  return db.orders.filter((o) => o.assignedEmployeeId === user.id || myClientIds.has(o.clientId));
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
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
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
