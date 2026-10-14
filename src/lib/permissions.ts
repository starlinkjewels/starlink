import { MODULES, type ModuleKey } from "./modules";

/**
 * Who may do what — roles for staff, section by section.
 *
 * A role is a named set of permissions: for each section of the app, whether
 * its holder may see it, and whether they may add, edit, delete or export in
 * it. Each employee holds one role. An admin holds them all, always.
 *
 * Shipping this must change nobody's access. An employee with no role is given
 * Standard staff, which is exactly what every employee could do before roles
 * existed — so on the day roles arrive nothing moves until an admin decides it
 * should, one employee at a time.
 *
 * Clients are outside this entirely: their portal is decided by what is theirs,
 * not by a role.
 */

export type PermAction = "view" | "add" | "edit" | "delete" | "export";
export const PERM_ACTIONS: PermAction[] = ["view", "add", "edit", "delete", "export"];
export const ACTION_LABEL: Record<PermAction, string> = {
  view: "View", add: "Add", edit: "Edit", delete: "Delete", export: "Export",
};

export type PermSet = Partial<Record<PermAction, boolean>>;
export type PermMatrix = Partial<Record<ModuleKey, PermSet>>;

/**
 * Whose work a role reaches.
 *  • own — the orders assigned to them, and every order of a client they are
 *          the account manager of. What every employee saw before roles; right
 *          for sales, who should see their own customers and no one else's.
 *  • all — every order and every client: production, quality, accounts, a
 *          manager — anyone whose job is the whole order book.
 * The sections and actions (the matrix) still decide what they may DO there.
 */
export type RoleReach = "own" | "all";
export const REACH_LABEL: Record<RoleReach, string> = {
  own: "Their own orders & clients",
  all: "Every order & client",
};

export interface StaffRole {
  id: string;
  name: string;
  description?: string;
  perms: PermMatrix;
  /** Unset means "own" — exactly what every role reached before this existed. */
  reach?: RoleReach;
  /** Shipped with the app and not editable — Standard staff. */
  builtIn?: boolean;
  createdAt: string;
  updatedAt?: string;
}

/** Sections that belong to an admin whatever a role says: who works here and
 *  what they may do, the settings of the business, and the record of what
 *  everyone has done. A role that could grant these could grant itself more. */
export const ADMIN_ONLY_MODULES: ModuleKey[] = ["employees", "settings", "activity"];

/**
 * The actions that mean something in each section. A box for something a
 * section does not do would be a switch wired to nothing: orders are never
 * deleted — they are cancelled or rejected — and the dashboard is only looked at.
 * Suppliers, factories, stock and gift cards are changed only by admins (the
 * money and the metal), so an employee's role can only show or export them.
 */
export const MODULE_ACTIONS: Record<ModuleKey, PermAction[]> = {
  dashboard: ["view"],
  catalog: ["view", "add", "edit", "delete", "export"],
  productPhotos: ["view", "add", "edit", "delete", "export"],
  orders: ["view", "add", "edit", "export"],
  clients: ["view", "add", "edit", "delete", "export"],
  invoices: ["view", "add", "edit", "delete", "export"],
  readyStock: ["view", "add", "edit", "delete", "export"],
  giftCards: ["view", "export"],
  suppliers: ["view", "export"],
  factories: ["view", "export"],
  stock: ["view", "export"],
  buyAssign: ["view", "add", "edit", "delete"],
  payments: ["view", "add", "edit", "delete", "export"],
  passbook: ["view", "export"],
  locker: ["view", "add", "edit", "delete", "export"],
  expenses: ["view", "add", "edit", "delete", "export"],
  messages: ["view", "add"],
  reports: ["view", "export"],
  employees: [], settings: [], activity: [],
};

/** Open to every employee whatever their role: the page everyone lands on
 *  after signing in. A role that hid it would sign people in to "no access". */
export const ALWAYS_OPEN_MODULES: ModuleKey[] = ["dashboard"];

/** The sections a role can grant, in sidebar order. */
export const ROLE_MODULES = MODULES.filter(m => !ADMIN_ONLY_MODULES.includes(m.key) && !ALWAYS_OPEN_MODULES.includes(m.key));

/** Everything a section allows. */
export function fullSet(m: ModuleKey): PermSet {
  return Object.fromEntries(MODULE_ACTIONS[m].map(a => [a, true])) as PermSet;
}

/** Standard staff — exactly what an employee could do before roles existed. */
export const STANDARD_STAFF: StaffRole = {
  id: "builtin_standard",
  name: "Standard staff",
  description: "Everything an employee could do before roles — every section except Employees, Settings and Activity.",
  builtIn: true,
  createdAt: "2026-10-11T00:00:00.000Z",
  perms: Object.fromEntries(ROLE_MODULES.map(m => [m.key, fullSet(m.key)])) as PermMatrix,
  reach: "own",
};

/** Starting points for a new role. Edited freely once created. */
export const ROLE_TEMPLATES: { name: string; description: string; perms: PermMatrix; reach: RoleReach }[] = [
  {
    name: "Sales",
    description: "Their own clients and orders, and the catalog; sees invoices and payments but does not touch money.",
    reach: "own",
    perms: {
      dashboard: { view: true }, catalog: fullSet("catalog"), productPhotos: fullSet("productPhotos"),
      orders: { view: true, add: true, edit: true, export: true }, clients: { view: true, add: true, edit: true, export: true },
      invoices: { view: true, export: true }, readyStock: { view: true, export: true },
      payments: { view: true }, messages: fullSet("messages"), reports: { view: true },
    },
  },
  {
    name: "Accounts",
    description: "Money in and out — payments, invoices, the locker, expenses; sees suppliers' and factories' books.",
    reach: "all",
    perms: {
      dashboard: { view: true }, orders: { view: true, export: true }, clients: { view: true, export: true },
      invoices: fullSet("invoices"), payments: fullSet("payments"), passbook: fullSet("passbook"),
      locker: fullSet("locker"), expenses: fullSet("expenses"),
      suppliers: fullSet("suppliers"), factories: fullSet("factories"),
      giftCards: { view: true }, reports: fullSet("reports"), messages: fullSet("messages"),
    },
  },
  {
    name: "Production",
    description: "Making the pieces — every order, factories, stock, buying material; no money and no clients' books.",
    reach: "all",
    perms: {
      dashboard: { view: true }, orders: { view: true, edit: true }, factories: { view: true },
      stock: { view: true }, buyAssign: fullSet("buyAssign"), suppliers: { view: true },
      readyStock: { view: true, add: true, edit: true }, catalog: { view: true }, productPhotos: { view: true, add: true, edit: true },
      messages: fullSet("messages"),
    },
  },
  {
    name: "Order updates",
    description: "Moves every order along — stages, factory details, dispatch; adds nothing, sees no money.",
    reach: "all",
    perms: { dashboard: { view: true }, orders: { view: true, edit: true }, readyStock: { view: true }, catalog: { view: true }, productPhotos: { view: true, add: true, edit: true }, messages: fullSet("messages") },
  },
  {
    name: "View only",
    description: "Can look at every order and section, change nothing and download nothing.",
    reach: "all",
    perms: Object.fromEntries(ROLE_MODULES.map(m => [m.key, { view: true }])) as PermMatrix,
  },
];

export interface PermUser {
  role: "admin" | "employee" | "client";
  roleId?: string;
}

/** The role an employee holds — Standard staff when none is set, or when the
 *  one they held has since been deleted. */
export function roleOf(user: PermUser, roles: StaffRole[]): StaffRole {
  return (user.roleId && roles.find(r => r.id === user.roleId)) || STANDARD_STAFF;
}

/** Whose work this person reaches — an admin everything; an employee as their
 *  role says ("own" when it says nothing); a client only their own. */
export function reachOf(user: PermUser | null | undefined, roles: StaffRole[]): RoleReach {
  if (!user) return "own";
  if (user.role === "admin") return "all";
  if (user.role !== "employee") return "own";
  return roleOf(user, roles).reach ?? "own";
}

/**
 * The one question every screen asks. An admin may always; a client never
 * through this (their portal decides); an employee as their role says — and
 * nothing in a section they may not see.
 */
export function can(user: PermUser | null | undefined, roles: StaffRole[], module: ModuleKey, action: PermAction): boolean {
  if (!user) return false;
  if (user.role === "admin") return true;
  if (user.role !== "employee") return false;
  if (ADMIN_ONLY_MODULES.includes(module)) return false;
  if (ALWAYS_OPEN_MODULES.includes(module)) return action === "view";
  if (!MODULE_ACTIONS[module].includes(action)) return false;
  const set = roleOf(user, roles).perms[module];
  if (!set?.view) return false; // nothing in a section you cannot see
  return !!set[action];
}

/** Tidy a matrix: drop actions a section does not have, and anything granted
 *  without View (which could never be used). */
export function normalisePerms(p: PermMatrix): PermMatrix {
  const out: PermMatrix = {};
  for (const m of ROLE_MODULES) {
    const set = p[m.key];
    if (!set?.view) continue;
    out[m.key] = Object.fromEntries(MODULE_ACTIONS[m.key].filter(a => set[a]).map(a => [a, true])) as PermSet;
  }
  return out;
}
