// LocalStorage-backed fake database for Starlink Jewels
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

const KEY = "starlink_db_v2";

function emptyDb(): DB {
  return { users: [], clients: [], orders: [], tasks: [], messages: [], notifications: [], invoices: [], expenses: [], catalogFolders: [], catalogItems: [], catalogFavorites: [], settings: { companyName: "Starlink Jewels", currency: "USD", language: "English", notifications: true, diamondRate: 3500, metalRate: 65, defaultShippingCharge: 0, invoiceAddress1: "55 JOHN ST", invoiceAddress2: "EAST RUTHERFORD", invoiceAddress3: "NEW JERSEY 07073", invoiceTel: "+91 83472 78188", invoicePrimary: "+1 201 554 4824", invoiceEmail: "Starlinkjewels@gmail.com", invoiceTerms: "COD" }, session: { userId: null } };
}

export function loadDb(): DB {
  if (typeof window === "undefined") return emptyDb();
  const raw = localStorage.getItem(KEY);
  if (!raw) {
    const seeded = seedDb();
    localStorage.setItem(KEY, JSON.stringify(seeded));
    return seeded;
  }
  try {
    const db = JSON.parse(raw) as DB;
    // backward-compat
    db.orders = db.orders.map(o => ({ shippingCharge: 0, advances: [], estimatedGrossWeight: undefined, estimatedNetWeight: undefined, ...o }));
    db.orders.forEach(insertDiamondPurchaseStep);
    if (!db.tasks) db.tasks = [];
    if (!db.expenses) db.expenses = [];
    // backward-compat: fill missing settings fields
    if (db.settings.diamondRate == null) db.settings.diamondRate = 3500;
    if (db.settings.metalRate == null) db.settings.metalRate = 65;
    if (db.settings.defaultShippingCharge == null) db.settings.defaultShippingCharge = 0;
    if (!db.catalogFolders) db.catalogFolders = [];
    if (!db.catalogItems) db.catalogItems = [];
    if (!db.catalogFavorites) db.catalogFavorites = [];
    return db;
  } catch { return emptyDb(); }
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

export function saveDb(db: DB) {
  localStorage.setItem(KEY, JSON.stringify(db));
  window.dispatchEvent(new Event("starlink-db-updated"));
}

export function updateDb(fn: (db: DB) => void) {
  const db = loadDb();
  fn(db);
  saveDb(db);
  return db;
}

export function uid(prefix = "") {
  return prefix + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

function seedDb(): DB {
  const db = emptyDb();

  // Only the admin account — all other data is entered by the user
  db.users.push({
    id: "u_admin", username: "admin", password: "admin123", role: "admin",
    name: "Rajesh Mehta", email: "admin@starlinkjewels.com", phone: "+91 98765 43210",
    status: "active", createdAt: new Date().toISOString(),
  });

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