/**
 * The sections of the app, as a person sees them in the sidebar.
 *
 * One list, used everywhere a section has to be named: which section an
 * activity-log entry belongs to, and — with roles — which sections a person may
 * see and what they may do in each. Kept in one place so the two can never
 * disagree about what a section is called or where it lives.
 */
export interface AppModule {
  key: ModuleKey;
  label: string;
  /** The page the section opens on. */
  path: string;
}

export type ModuleKey =
  | "dashboard" | "catalog" | "productPhotos" | "orders" | "clients" | "invoices"
  | "readyStock" | "giftCards" | "suppliers" | "factories" | "stock" | "buyAssign"
  | "payments" | "passbook" | "locker" | "expenses" | "messages" | "reports"
  | "employees" | "settings" | "activity";

export const MODULES: AppModule[] = [
  { key: "dashboard", label: "Dashboard", path: "/" },
  { key: "catalog", label: "Catalog", path: "/catalog" },
  { key: "productPhotos", label: "Product Photos", path: "/product-photos" },
  { key: "orders", label: "Orders", path: "/orders" },
  { key: "clients", label: "Clients", path: "/clients" },
  { key: "invoices", label: "Invoices", path: "/invoices" },
  { key: "readyStock", label: "Ready Stock", path: "/ready-stock" },
  { key: "giftCards", label: "Gift Cards", path: "/gift-cards" },
  { key: "suppliers", label: "Suppliers", path: "/suppliers" },
  { key: "factories", label: "Factories", path: "/factories" },
  { key: "stock", label: "Stock", path: "/stock" },
  { key: "buyAssign", label: "Buy & Assign", path: "/buy-assign" },
  { key: "payments", label: "Payments", path: "/payments" },
  { key: "passbook", label: "Passbook", path: "/income" },
  { key: "locker", label: "Locker", path: "/locker" },
  { key: "expenses", label: "Expenses", path: "/expenses" },
  { key: "messages", label: "Messages", path: "/messages" },
  { key: "reports", label: "Reports", path: "/reports" },
  { key: "employees", label: "Employees", path: "/employees" },
  { key: "settings", label: "Settings", path: "/settings" },
  { key: "activity", label: "Activity", path: "/activity" },
];

export function moduleLabel(key: string): string {
  return MODULES.find(m => m.key === key)?.label ?? key;
}

/** The section a page belongs to, from its address — "/suppliers/abc" is Suppliers. */
export function moduleForPath(pathname: string): ModuleKey {
  const first = "/" + (pathname.split("/").filter(Boolean)[0] ?? "");
  if (first === "/") return "dashboard";
  const exact = MODULES.find(m => m.path === first);
  if (exact) return exact.key;
  if (first === "/giftcard") return "giftCards";
  return "dashboard";
}
