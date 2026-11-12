// GENERATED from src/lib/pure/writePolicy.ts by functions/scripts/sync-shared.cjs - do not edit here.
/**
 * Who may write what — the one rulebook for employees' writes, collection by
 * collection. Read in two places, so they can never disagree:
 *
 *   • the app, before every save (db.ts persist → writeRefusal): a save that
 *     would write something the person's access does not cover is refused WHOLE,
 *     with the reason — never sent to fail silently in the database;
 *   • the database rules (firestore.rules, the generated `policy()` block —
 *     scripts/gen-write-policy.ts writes it from this file).
 *
 * Each entry lists, per operation, the GRANTS any one of which is enough — a
 * section's action ("payments.add") or a finer switch ("orders.cancel",
 * lib/accessFeatures.ts). "*staff" means any employee. An empty list means an
 * admin only. A person's grants are compiled from their access (permissions.ts
 * compileGrants) into their sign-in record, which only an admin may write.
 *
 * The lists were worked out from every code path that writes each collection
 * (2026-11-08 survey) and are deliberately INCLUSIVE: a grant that leads to a
 * write anywhere — as a side effect too (cancelling an order returns its
 * material: stock movements) — is listed. Too narrow would stop real work;
 * too wide only leaves what the screens already hold.
 *
 * Collections not listed keep their own rules (orders and the client portal's
 * records, messages, notifications, counters, tasks, settings, the admin's).
 */

export type Op = "create" | "update" | "delete";
export type Policy = Record<string, Record<Op, string[]>>;

/** Everything that moves material: issues, stock, purchases, bags — and the side effects of each. */
const MFG = [
  "orders.edit", "orders.production", "orders.finalApproval", "orders.approve", "orders.cancel", "orders.delete",
  "orders.melt", "orders.fixPurchase", "orders.toReadyStock",
  "factories.issue", "factories.companies",
  "buyAssign.add", "buyAssign.edit", "buyAssign.delete", "buyAssign.assign", "buyAssign.sell", "buyAssign.changeAssign",
  "suppliers.purchase", "suppliers.sell", "suppliers.gold",
  "stock.add", "stock.edit", "stock.delete", "stock.companies", "stock.memo",
  "payments.add", "payments.edit", "payments.delete",
  "invoices.returns",
];

export const WRITE_POLICY: Policy = {
  // ── The parties ──
  suppliers: { create: ["suppliers.add"], update: ["suppliers.edit", "suppliers.gold"], delete: ["suppliers.delete"] },
  brokers: { create: ["suppliers.add"], update: ["suppliers.edit"], delete: ["suppliers.delete"] },
  designers: { create: ["designers.add"], update: ["designers.edit"], delete: ["designers.delete"] },
  factories: { create: ["factories.add"], update: ["factories.edit"], delete: ["factories.delete"] },
  lockers: { create: ["locker.add"], update: ["locker.edit"], delete: ["locker.delete"] },
  // A client's record carries their credit, gift card and material ledger — changed by many
  // working actions — so any employee may update it; adding and removing one are guarded.
  clients: { create: ["clients.add"], update: ["*staff"], delete: ["clients.delete"] },

  // ── Billing ──
  invoices: {
    create: ["invoices.add"],
    // Printing a bill refreshes its amount and paid; payments move what is paid.
    update: ["invoices.add", "invoices.edit", "orders.export", "payments.add", "payments.edit", "payments.delete", "invoices.delete"],
    delete: ["invoices.delete"],
  },
  giftCards: {
    create: ["clients.giftCards", "orders.dispatch"],
    update: ["clients.giftCards", "giftCards.cancel", "invoices.returns", "orders.dispatch", "orders.cancel"],
    delete: [],
  },

  // ── Money ──
  lockerTransactions: {
    create: ["payments.add", "payments.edit", "payments.broker", "locker.add", "locker.edit", "expenses.add", "buyAssign.sell", "suppliers.sell", "suppliers.purchase", "orders.dispatch"],
    update: ["payments.add", "payments.edit", "locker.edit", "expenses.edit"],
    delete: ["payments.delete", "payments.edit", "expenses.delete", "suppliers.sell", "suppliers.purchase", "buyAssign.delete"],
  },
  expenses: {
    create: ["expenses.add", "payments.add", "orders.dispatch"],
    update: ["expenses.edit", "payments.edit"],
    delete: ["expenses.delete", "payments.delete"],
  },
  clientReceipts: {
    create: ["payments.add", "payments.edit", "locker.edit"],
    update: ["payments.edit", "payments.delete", "invoices.delete"],
    delete: ["payments.delete", "payments.edit"],
  },
  supplierReceipts: { create: ["payments.add", "suppliers.sell", "buyAssign.sell", "suppliers.purchase"], update: ["payments.edit"], delete: ["payments.delete", "suppliers.sell", "suppliers.purchase"] },
  supplierPayments: { create: ["payments.add", "payments.edit"], update: ["payments.edit"], delete: ["payments.delete", "payments.edit"] },
  factoryPayments: { create: ["payments.add", "payments.edit"], update: ["payments.edit"], delete: ["payments.delete", "payments.edit"] },

  // ── Sales out of stock ──
  // A memo sold to its holder makes the sale (lib/memos.ts) — so Memo may create one.
  // + suppliers.purchase: a purchase return (lib/purchaseReturns.ts) is recorded here too.
  supplierSales: { create: ["suppliers.sell", "buyAssign.sell", "stock.memo", "suppliers.purchase"], update: ["suppliers.sell", "buyAssign.sell", "suppliers.purchase"], delete: ["suppliers.sell", "buyAssign.sell", "suppliers.purchase"] },
  memos: { create: ["stock.memo"], update: ["stock.memo"], delete: ["stock.memo"] },
  diamondSales: { create: ["buyAssign.sell", "stock.memo"], update: ["payments.add", "payments.delete", "buyAssign.delete"], delete: ["buyAssign.delete"] },

  // ── Material, stock and manufacturing ──
  purchases: {
    create: ["suppliers.purchase", "buyAssign.add", "orders.production", "suppliers.gold", "stock.add"],
    update: MFG,
    delete: ["orders.fixPurchase", "suppliers.purchase", "buyAssign.delete", "buyAssign.edit", "stock.delete", "stock.edit"],
  },
  materialIssuances: { create: MFG, update: MFG, delete: MFG },
  diamondPackets: { create: MFG, update: MFG, delete: MFG },
  stockMovements: { create: MFG, update: MFG, delete: MFG },
  // Kept by the app on every stock write (and rebuilt from history when off).
  stockLevels: { create: MFG, update: MFG, delete: [] },
  diamondBags: { create: MFG, update: MFG, delete: [] },
  cadJobs: { create: ["orders.design", "orders.edit"], update: ["orders.design", "orders.edit"], delete: [] },

  // ── Ready Stock: its staff side (a client's order changes a piece too — its own rule) ──
  readyStock: {
    create: ["readyStock.add", "readyStock.edit", "buyAssign.add", "suppliers.purchase", "orders.production", "orders.toReadyStock", "invoices.returns"],
    update: ["*staff"],
    delete: ["readyStock.delete", "invoices.returns", "orders.fixPurchase", "suppliers.purchase", "buyAssign.delete", "stock.delete"],
  },

  // ── The catalogue ──
  catalogFolders: { create: ["catalog.add"], update: ["catalog.edit", "catalog.move"], delete: ["catalog.delete"] },
  // A design's readings are checked from the catalogue's viewer by any employee.
  catalogItems: { create: ["catalog.add"], update: ["*staff"], delete: ["catalog.delete"] },
  // Old Design Studio records — only an admin's tools write them now.
  productPhotoFolders: { create: [], update: [], delete: [] },
  productPhotoItems: { create: [], update: [], delete: [] },
};

/**
 * Who may READ the money records — every account entry (cash, balances,
 * salaries), the expenses, and supplier and factory payments. Anyone else's
 * device never loads them and the database refuses them. Everything not listed
 * stays readable by any employee (their screens decide what is shown) — the
 * order, stock and purchase records are read by too many working screens to
 * be locked without restructuring them first.
 *
 * Inclusive like the write lists: every section whose pages use these records,
 * and every action whose safety checks look into them ("does anything still
 * point at this client?") — a check that can't see its records refuses, with
 * the reason, rather than answer from nothing.
 */
const MONEY_PAGES = ["payments.view", "locker.view", "passbook.view", "expenses.view", "reports.view", "dashboard.business"];
export const READ_POLICY: Record<string, string[]> = {
  lockerTransactions: [...MONEY_PAGES,
    "designers.view", "productPhotos.view",      // what each freelancer was paid, and is owed
    "buyAssign.view", "suppliers.view", "factories.view", // sales paid in, brokers, the parties' books
    "clients.delete", "orders.cancel"],           // their checks: refunds on record, undoing a sale
  expenses: [...MONEY_PAGES,
    "designers.view",                             // a designer's salary paid
    "clients.delete", "orders.delete", "orders.cancel"], // their checks: an expense naming it
  supplierPayments: [...MONEY_PAGES, "suppliers.view", "buyAssign.view"],
  supplierReceipts: [...MONEY_PAGES, "suppliers.view", "buyAssign.view"],
  factoryPayments: [...MONEY_PAGES, "factories.view"],
};
export const READ_LOCKED = Object.keys(READ_POLICY);
/** May someone with these grants read this collection? Not locked: yes. */
export function readAllowed(col: string, grants: ReadonlySet<string>): boolean {
  const need = READ_POLICY[col];
  return !need || need.some(g => grants.has(g));
}

/** What each collection holds, in words — for the reason a save is refused. */
export const POLICY_NOUN: Record<string, string> = {
  suppliers: "suppliers", brokers: "brokers", designers: "designers", factories: "factories", lockers: "accounts",
  clients: "clients", invoices: "invoices", giftCards: "gift cards",
  lockerTransactions: "account entries", expenses: "expenses", clientReceipts: "client receipts",
  supplierReceipts: "money from suppliers", supplierPayments: "supplier payments", factoryPayments: "factory payments",
  supplierSales: "sales to suppliers", diamondSales: "diamond sales", memos: "memos",
  purchases: "purchases", materialIssuances: "material given to factories", diamondPackets: "certified stones",
  stockMovements: "stock", stockLevels: "stock", diamondBags: "diamond bags", cadJobs: "design jobs",
  readyStock: "Ready Stock", catalogFolders: "catalogue folders", catalogItems: "catalogue designs",
  productPhotoFolders: "Design Studio folders", productPhotoItems: "Design Studio items",
};

/** The collections the rulebook covers. */
export const POLICY_COLS = Object.keys(WRITE_POLICY);

/**
 * May someone with these grants do this write? Collections the rulebook does
 * not cover are not decided here (their own rules apply): true.
 */
export function policyAllows(col: string, op: Op, grants: ReadonlySet<string>): boolean {
  const p = WRITE_POLICY[col];
  if (!p) return true;
  return p[op].some(g => grants.has(g));
}
