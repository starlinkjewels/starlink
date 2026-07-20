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
  collection, doc, onSnapshot, writeBatch, query, where, getDoc, documentId,
  type Query, type DocumentData,
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
}

export const TIMELINE_STEPS = [
  "Order Submitted","Order Approved","CAD Designing","CAD Approved","Diamond Purchase","Wax Model",
  "Casting","Stone Selection","Diamond Setting","Polishing","Quality Check",
  "Hallmark","Final Approval","Packing","Dispatch","Delivered",
] as const;
export type TimelineStep = (typeof TIMELINE_STEPS)[number];

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
}

export interface Order {
  id: string;
  orderNumber: string;
  clientId: string;
  contactPerson: string;
  jewelleryType: "Ring" | "Pendant" | "Necklace" | "Bracelet" | "Earrings" | "Custom";
  metal: "Gold" | "White Gold" | "Rose Gold" | "Platinum" | "Silver";
  diamondType: "Natural" | "Lab Grown";
  quantity: number;
  diamondWeight: number;     // estimated diamond weight (ct) — entered at order creation
  metalWeight: number;
  // Estimated weights — entered at order creation (piece not made yet)
  estimatedGrossWeight?: number;  // grams
  estimatedNetWeight?: number;    // grams
  // Actual details — filled in after production / Final Approval by admin
  actualGrossWeight?: number;     // grams
  actualNetWeight?: number;       // grams
  actualDiamondWeight?: number;   // carats
  actualMetalRate?: number;       // $ per gram
  actualDiamondRate?: number;     // $ per carat
  actualMakingCharges?: number;   // flat $ making charges
  images: string[];          // up to 3 reference images (base64)
  instructions: string;
  expectedDelivery: string;
  priority: "Normal" | "Urgent" | "High Priority";
  status: "Waiting" | "Approved" | "Rejected" | "In Production" | "Ready" | "Dispatched" | "Delivered";
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
  productColor?: string;   // "Yellow" | "Rose" | "White"
  productKarats?: string;  // "14K" | "18K" | "22K" | "24K"
  // Delivery preference
  deliveryTime?: string;
  // Finishing options
  rhodium?: string;   // "No Rhodium" | "Diamond Part White" | "Full White" | "Other"
  stamping?: string;  // "No Stamping" | "KT Stamping" | "Diamond Weight + KT Stamp" | "Other"
  // CAD design image (uploaded after CAD Approved step)
  cadImage?: string;
  // Dispatch info
  courierName?: string;
  trackingNumber?: string;
  trackingLink?: string;
  // Certificate
  certificate?: boolean;
  certificateFee?: number;  // editable per order
}

export interface Task {
  id: string;
  title: string;
  assignedTo: string;   // userId (employee)
  assignedBy: string;   // userId (admin)
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
  orderId: string;
  clientId: string;
  number: string;
  amount: number;
  paid: boolean;
  createdAt: string;
}

export type ExpenseCategory = "Travel" | "Food" | "Tools" | "Office" | "Communication" | "Other";

export interface Expense {
  id: string;
  title: string;
  amount: number;
  category: ExpenseCategory;
  note?: string;
  employeeId: string; // userId of admin or employee who added it
  clientId?: string;  // optional: which client this expense relates to
  createdAt: string;
}

export interface CatalogFolder {
  id: string;
  name: string;
  parentId?: string | null; // null / undefined = root
  createdBy: string; // userId
  createdAt: string;
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

export interface Settings {
  companyName: string;
  currency: string;
  language: string;
  notifications: boolean;
  diamondRate: number;           // $ per carat
  metalRate: number;             // $ per gram
  defaultShippingCharge: number; // $ flat default per order
  // Invoice branding
  invoiceAddress1?: string;      // Street line
  invoiceAddress2?: string;      // City / area
  invoiceAddress3?: string;      // State + ZIP
  invoiceTel?: string;           // Tel No
  invoicePrimary?: string;       // Primary phone
  invoiceEmail?: string;         // Email shown on bill
  invoiceTerms?: string;         // e.g. "COD"
  invoiceQr1?: string;           // base64 – first QR (Venmo / payment)
  invoiceQr2?: string;           // base64 – second QR
  invoiceStamp?: string;         // base64 – authorised stamp/seal
}

export interface CatalogFavorite {
  userId: string;
  itemId: string;
}

export interface DB {
  users: User[];
  clients: Client[];
  orders: Order[];
  tasks: Task[];
  messages: Message[];
  notifications: Notification[];
  invoices: Invoice[];
  expenses: Expense[];
  settings: Settings;
  catalogFolders: CatalogFolder[];
  catalogItems: CatalogItem[];
  catalogFavorites: CatalogFavorite[];
  session: { userId: string | null };
}

const LEGACY_KEY = "starlink_db_v2";   // pre-Firebase localStorage blob (migrated on first run)

function defaultSettings(): Settings {
  return { companyName: "Starlink Jewels", currency: "USD", language: "English", notifications: true, diamondRate: 3500, metalRate: 65, defaultShippingCharge: 0, invoiceAddress1: "55 JOHN ST", invoiceAddress2: "EAST RUTHERFORD", invoiceAddress3: "NEW JERSEY 07073", invoiceTel: "+91 83472 78188", invoicePrimary: "+1 201 554 4824", invoiceEmail: "Starlinkjewels@gmail.com", invoiceTerms: "COD" };
}

function emptyDb(): DB {
  return { users: [], clients: [], orders: [], tasks: [], messages: [], notifications: [], invoices: [], expenses: [], catalogFolders: [], catalogItems: [], catalogFavorites: [], settings: defaultSettings(), session: { userId: null } };
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

/** Jewellery value + shipping + certificate fee — the amount the client owes in full */
export function orderTotal(order: Order): number {
  return order.amount + (order.shippingCharge || 0) + (order.certificateFee || 0);
}

export function balanceDue(order: Order): number {
  return Math.max(0, orderTotal(order) - totalAdvance(order));
}

/** Backward-compat: insert the "Diamond Purchase" step (added after "CAD Approved")
 *  into orders created before this step existed, without disturbing their progress. */
function insertDiamondPurchaseStep(o: Order) {
  if (o.timeline.some(t => t.step === "Diamond Purchase")) return;
  const cadIdx = o.timeline.findIndex(t => t.step === "CAD Approved");
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
type ArrayCol =
  | "users" | "clients" | "orders" | "tasks" | "messages" | "notifications"
  | "invoices" | "expenses" | "catalogFolders" | "catalogItems" | "catalogFavorites";
const ARRAY_COLS: ArrayCol[] = [
  "users", "clients", "orders", "tasks", "messages", "notifications",
  "invoices", "expenses", "catalogFolders", "catalogItems", "catalogFavorites",
];
const SETTINGS_COL = "meta";
const SETTINGS_DOC = "settings";
const INDEX_COL = "userByAuth"; // uid → role index the security rules read

// Minimal per-user record the security rules consult (keyed by Firebase Auth
// uid). Contains no secrets — role/status/link only.
interface IndexDoc {
  role: Role;
  clientId: string | null;
  appId: string;   // the user's app id (User.id), for scoping references
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

let seeded = false;      // becomes true once cache has been populated from Firestore
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
    const curMap = new Map(cur.map(i => [docId(col, i), i]));
    const prevMap = new Map(prev.map(i => [docId(col, i), i]));

    for (const [id, item] of curMap) {
      const before = prevMap.get(id);
      if (!before || !eq(before, item)) {
        batch.set(doc(fsdb, col, id), item);
        touched.add(col); ops++;
      }
    }
    for (const [id] of prevMap) {
      if (!curMap.has(id)) { batch.delete(doc(fsdb, col, id)); touched.add(col); ops++; }
    }
  }

  if (!eq(snap.settings, remote.settings)) {
    batch.set(doc(fsdb, SETTINGS_COL, SETTINGS_DOC), snap.settings as unknown as Record<string, unknown>);
    touched.add(SETTINGS_COL); ops++;
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
      idxWrites[auid] = data; ops++;
    }
  }
  for (const auid of Object.keys(remoteIdx)) {
    if (!desired[auid]) { batch.delete(doc(fsdb, INDEX_COL, auid)); idxDeletes.push(auid); ops++; }
  }

  if (ops === 0) return;
  touched.forEach(c => { writePending[c] = (writePending[c] || 0) + 1; });
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
    if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("starlink-db-error", { detail: err }));
  } finally {
    touched.forEach(c => { writePending[c] = Math.max(0, (writePending[c] || 1) - 1); });
    setPending(pendingCount - 1);
  }
}

// Number of Firestore write batches currently in flight — drives the global
// "Saving…" indicator so every action shows Firebase progress.
let pendingCount = 0;
function setPending(n: number) {
  pendingCount = Math.max(0, n);
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("starlink-db-pending", { detail: pendingCount }));
}
export function pendingWrites() { return pendingCount; }

export function saveDb(db?: DB) {
  // Adopt the caller's object into the cache. Callers may pass a loadDb() copy
  // whose top-level arrays were reassigned (e.g. `fresh.expenses = [...]`), so
  // copy its fields in rather than assuming in-place mutation of the cache.
  if (db && db !== cache) Object.assign(cache, db);
  emit();
  // Chain persists so overlapping saves don't race; each recomputes the diff.
  persistQueue = persistQueue.then(persist).catch(err => console.error("[db] persist error", err));
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
  return persistQueue.then(() => {}, () => {});
}

export function uid(prefix = "") {
  return prefix + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
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
  | { kind: "full" }
  | { kind: "client"; appId: string; clientId: string };

/**
 * Watch the signed-in user's own role-index doc and invoke `onRevoked` the
 * moment they are deactivated (status != 'active') or removed (doc deleted).
 * The index doc stays readable by its owner even when inactive, so this keeps
 * working right up to sign-out. Returns an unsubscribe function.
 */
export function watchAccess(authUid: string, onRevoked: () => void): () => void {
  let firstFired = false;
  return onSnapshot(doc(fsdb, INDEX_COL, authUid),
    snap => {
      // Ignore the initial read; only react to a live change to inactive/deleted.
      if (!firstFired) { firstFired = true; return; }
      if (!snap.exists() || (snap.data() as IndexDoc).status !== "active") onRevoked();
    },
    () => { /* permission/network error — ignore */ },
  );
}

/** Read the caller's role index to decide their data scope (before loading). */
export async function resolveScope(authUid: string): Promise<Scope> {
  try {
    const s = await getDoc(doc(fsdb, INDEX_COL, authUid));
    if (s.exists()) {
      const d = s.data() as IndexDoc;
      if (d.role === "client" && d.clientId) return { kind: "client", appId: d.appId, clientId: d.clientId };
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
  unsubscribers.forEach(u => { try { u(); } catch { /* ignore */ } });
  unsubscribers = [];
  Object.assign(cache, emptyDb());
  remote = emptyDb();
  for (const k of Object.keys(remoteIdx)) delete remoteIdx[k];
  idxSeeded = false;
  startPromise = null;
  seeded = false;
  emit();
}

/** Apply a collection snapshot into the cache/remote mirror. */
function applyList(col: ArrayCol, docs: Record<string, unknown>[]) {
  let list = docs;
  if (col === "orders") list = list.map(o => normalizeOrder(o as unknown as Order) as unknown as Record<string, unknown>);
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

  // Build the per-collection queries for this scope.
  const specs: { col: ArrayCol; q: Query<DocumentData> }[] = [];
  for (const col of ARRAY_COLS) {
    if (client) {
      // Staff-only collections are never loaded for a client.
      if (col === "tasks" || col === "expenses") continue;
      if (col === "messages") continue; // handled specially (two-sided)
      const c = collection(fsdb, col);
      if (col === "orders" || col === "invoices") specs.push({ col, q: query(c, where("clientId", "==", client.clientId)) });
      else if (col === "notifications") specs.push({ col, q: query(c, where("userId", "==", client.appId)) });
      else if (col === "clients") specs.push({ col, q: query(c, where(documentId(), "==", client.clientId)) });
      else specs.push({ col, q: c }); // users, catalog* — shared / names
    } else {
      specs.push({ col, q: collection(fsdb, col) });
    }
  }

  const names: string[] = specs.map(s => s.col);
  if (client) names.push("messages");
  names.push(SETTINGS_COL);
  const pending = new Set<string>(names);

  return new Promise(resolve => {
    let done = false;
    const first = (name: string) => {
      pending.delete(name);
      if (!done && pending.size === 0) { done = true; resolve(); }
    };

    for (const { col, q } of specs) {
      unsubscribers.push(onSnapshot(q,
        snap => {
          if (writePending[col]) { first(col); return; }
          applyList(col, snap.docs.map(d => d.data() as Record<string, unknown>));
          first(col);
          if (seeded) emit();
        },
        err => { console.error(`[db] listener ${col} failed:`, err); first(col); },
      ));
    }

    // A client's messages are those they sent OR received — two queries merged
    // (Firestore can't OR across two fields in one query).
    if (client) {
      let fromMsgs: Record<string, unknown>[] = [];
      let toMsgs: Record<string, unknown>[] = [];
      let firedFrom = false, firedTo = false;
      const apply = () => {
        const map = new Map<string, Record<string, unknown>>();
        for (const m of [...fromMsgs, ...toMsgs]) map.set(String(m.id), m);
        applyList("messages", [...map.values()]);
        if (seeded) emit();
      };
      const doneMsg = () => { if (firedFrom && firedTo) first("messages"); };
      const msgs = collection(fsdb, "messages");
      unsubscribers.push(onSnapshot(query(msgs, where("fromUserId", "==", client.appId)),
        snap => { if (!writePending["messages"]) { fromMsgs = snap.docs.map(d => d.data() as Record<string, unknown>); apply(); } firedFrom = true; doneMsg(); },
        err => { console.error("[db] listener messages(from) failed:", err); firedFrom = true; doneMsg(); },
      ));
      unsubscribers.push(onSnapshot(query(msgs, where("toUserId", "==", client.appId)),
        snap => { if (!writePending["messages"]) { toMsgs = snap.docs.map(d => d.data() as Record<string, unknown>); apply(); } firedTo = true; doneMsg(); },
        err => { console.error("[db] listener messages(to) failed:", err); firedTo = true; doneMsg(); },
      ));
    }

    unsubscribers.push(onSnapshot(doc(fsdb, SETTINGS_COL, SETTINGS_DOC),
      snap => {
        if (writePending[SETTINGS_COL]) { first(SETTINGS_COL); return; }
        if (snap.exists()) {
          cache.settings = { ...defaultSettings(), ...(snap.data() as Settings) };
          remote.settings = clean(cache.settings);
        }
        first(SETTINGS_COL);
        if (seeded) emit();
      },
      err => { console.error("[db] listener settings failed:", err); first(SETTINGS_COL); },
    ));
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
  } catch { return null; }
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
    const map = new Map(existing.map(x => [x.id, x]));
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
  cache.catalogItems = mergeById(cache.catalogItems, migrated.catalogItems || []);
  const favKey = (f: CatalogFavorite) => `${f.userId}__${f.itemId}`;
  const favSeen = new Set(cache.catalogFavorites.map(favKey));
  for (const f of migrated.catalogFavorites || []) if (!favSeen.has(favKey(f))) cache.catalogFavorites.push(f);
  await persist();
  try { localStorage.removeItem(LEGACY_KEY); } catch { /* ignore */ }
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
    if (o.images) o.images = await Promise.all(o.images.map(img => up(img, `orders/${o.id}`) as Promise<string>));
    o.cadImage = await up(o.cadImage, `orders/${o.id}/cad`);
    for (const t of o.timeline || []) t.photo = await up(t.photo, `orders/${o.id}/timeline`);
  }
  for (const it of db.catalogItems || []) it.data = (await up(it.data, `catalog/${it.folderId}`)) || it.data;
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
  if (user.role === "client") return db.orders.filter(o => o.clientId === user.clientId);
  return db.orders.filter(o => o.assignedEmployeeId === user.id);
}

export function fmtMoney(n: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);
}

export function fmtDate(iso?: string) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}