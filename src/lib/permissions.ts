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
  /** The person's app id (User.id) — their own access record is keyed by it. */
  id?: string;
  role: "admin" | "employee" | "client";
  roleId?: string;
}

/* ── Each person's own access, on top of their role ──────────────────────
 * The usual way (role-based access with exceptions): a role is the template
 * for a job and stays linked, so changing a role changes everyone who holds
 * it; a person's own record says only what differs for them —
 *   • add     — given on top of the role, for good;
 *   • remove  — taken away from what the role gives;
 *   • temp    — given for a while, with a reason: it starts now or on a date
 *               and ends by itself at `until`. Kept afterwards as history,
 *               never deleted — so who had what, and when, can be looked up.
 * The record lives in the roles store, which only an admin may write: nobody
 * can give themselves more. */
export interface TempAccess {
  id: string;
  perms: PermMatrix;
  /** Also every order and client, for the time. */
  reach?: "all";
  from?: string;
  until: string;
  reason?: string;
  by: string;
  byName: string;
  at: string;
  /** Ended early, by hand. */
  endedAt?: string;
  endedByName?: string;
}
export interface UserAccess {
  id: string;
  kind: "userAccess";
  userId: string;
  /** "Access — Ravi": how the record reads in the activity log. */
  name: string;
  reach?: RoleReach;
  add?: PermMatrix;
  remove?: PermMatrix;
  temp?: TempAccess[];
  createdAt: string;
  updatedAt?: string;
  updatedBy?: string;
}
/** What the roles store holds: the roles, and each person's own access. */
export type AccessDoc = StaffRole | UserAccess;
export const isUserAccess = (d: AccessDoc): d is UserAccess => (d as UserAccess).kind === "userAccess";
export const rolesOnly = (docs: AccessDoc[]): StaffRole[] => docs.filter((d): d is StaffRole => !isUserAccess(d));
export const userAccessId = (userId: string) => `ua_${userId}`;
export function accessOf(docs: AccessDoc[], userId?: string): UserAccess | undefined {
  if (!userId) return undefined;
  return docs.find((d): d is UserAccess => isUserAccess(d) && d.userId === userId);
}

export type TempState = "upcoming" | "active" | "ended";
export function tempState(t: TempAccess, now = Date.now()): TempState {
  if (t.endedAt || now >= +new Date(t.until)) return "ended";
  if (t.from && now < +new Date(t.from)) return "upcoming";
  return "active";
}
export function activeTemp(ua: UserAccess | undefined, now = Date.now()): TempAccess[] {
  return (ua?.temp ?? []).filter(t => tempState(t, now) === "active");
}

const on = (m: PermMatrix | undefined, mod: ModuleKey, a: PermAction) => !!m?.[mod]?.[a];

/** The role an employee holds — Standard staff when none is set, or when the
 *  one they held has since been deleted. */
export function roleOf(user: PermUser, docs: AccessDoc[]): StaffRole {
  return (user.roleId && rolesOnly(docs).find(r => r.id === user.roleId)) || STANDARD_STAFF;
}

/** The role with a person's own changes applied: (role − removed) + added. */
export function applyOwn(role: PermMatrix, add?: PermMatrix, remove?: PermMatrix, extra: PermMatrix[] = []): PermMatrix {
  const out: PermMatrix = {};
  for (const m of ROLE_MODULES) {
    const set: PermSet = {};
    for (const a of MODULE_ACTIONS[m.key]) {
      // Taking View away takes the role's whole section, whatever else it gave.
      let yes = on(role, m.key, a) && on(role, m.key, "view") && !on(remove, m.key, "view");
      if (on(remove, m.key, a)) yes = false;
      if (on(add, m.key, a)) yes = true;
      if (extra.some(x => on(x, m.key, a))) yes = true;
      if (yes) set[a] = true;
    }
    // Anything in a section means they may see it.
    if (Object.keys(set).length) out[m.key] = { ...set, view: true };
  }
  return out;
}

/**
 * What this person may do right now: (their role − what was taken away) +
 * what was added + any temporary access running now. A temporary grant is a
 * later, deliberate decision, so it applies even to something taken away.
 */
export function effectivePerms(user: PermUser, docs: AccessDoc[], now = Date.now()): PermMatrix {
  const ua = accessOf(docs, user.id);
  return applyOwn(roleOf(user, docs).perms, ua?.add, ua?.remove, activeTemp(ua, now).map(t => t.perms));
}

/** Whose work this person reaches — an admin everything; an employee as their
 *  own access, then their role, says ("own" when nothing does), widened while
 *  a temporary grant of every order runs; a client only their own. */
export function reachOf(user: PermUser | null | undefined, docs: AccessDoc[], now = Date.now()): RoleReach {
  if (!user) return "own";
  if (user.role === "admin") return "all";
  if (user.role !== "employee") return "own";
  const ua = accessOf(docs, user.id);
  if (activeTemp(ua, now).some(t => t.reach === "all")) return "all";
  return ua?.reach ?? roleOf(user, docs).reach ?? "own";
}

/**
 * The one question every screen asks. An admin may always; a client never
 * through this (their portal decides); an employee as their access says —
 * and nothing in a section they may not see.
 */
export function can(user: PermUser | null | undefined, docs: AccessDoc[], module: ModuleKey, action: PermAction, now = Date.now()): boolean {
  if (!user) return false;
  if (user.role === "admin") return true;
  if (user.role !== "employee") return false;
  if (ADMIN_ONLY_MODULES.includes(module)) return false;
  if (ALWAYS_OPEN_MODULES.includes(module)) return action === "view";
  if (!MODULE_ACTIONS[module].includes(action)) return false;
  const set = effectivePerms(user, docs, now)[module];
  if (!set?.view) return false; // nothing in a section you cannot see
  return !!set[action];
}

/** When this person's access next changes by itself — a temporary grant
 *  starting or ending — so the screen can be redrawn at that moment. */
export function nextAccessChange(user: PermUser | null | undefined, docs: AccessDoc[], now = Date.now()): number | null {
  if (!user || user.role !== "employee") return null;
  const times = (accessOf(docs, user.id)?.temp ?? []).filter(t => !t.endedAt)
    .flatMap(t => [t.from ? +new Date(t.from) : NaN, +new Date(t.until)]).filter(x => x > now);
  return times.length ? Math.min(...times) : null;
}

/** What chosen permissions differ by from the role, cell by cell — the
 *  record to keep. The same as the role → nothing is kept. */
export function diffFromRole(role: PermMatrix, chosen: PermMatrix): { add: PermMatrix; remove: PermMatrix } {
  const add: PermMatrix = {}, remove: PermMatrix = {};
  for (const m of ROLE_MODULES) for (const a of MODULE_ACTIONS[m.key]) {
    const had = on(role, m.key, a) && on(role, m.key, "view"), has = on(chosen, m.key, a);
    if (has && !had) add[m.key] = { ...(add[m.key] ?? {}), [a]: true };
    if (had && !has) remove[m.key] = { ...(remove[m.key] ?? {}), [a]: true };
  }
  return { add, remove };
}
export const countCells = (p: PermMatrix | undefined) => Object.values(p ?? {}).reduce((s, set) => s + Object.values(set ?? {}).filter(Boolean).length, 0);

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
