/**
 * Which records each page needs — so the heavy ones (the books behind every
 * account: purchases, factory issues, account entries, stock movements…) are
 * downloaded when a page that uses them opens, not at every sign-in.
 *
 * One rule keeps every figure exact: a page is LIGHT only when everything it
 * shows can be read from the server's totals (see partyTotals.ts). Every other
 * page waits for the records it reads before it draws. Those lists (PAGE,
 * below) were worked out from each page's code and everything it imports —
 * every helper it calls and every dialog it can open, saves included — not
 * guessed. A page not listed there waits for all of them, exactly as the app
 * always worked.
 *
 * A page that turns out to read a collection it did not ask for still gets it
 * (db.ts loads it on first read) and says so in the console — the demo tests
 * watch for that warning. When a page starts reading a new collection, add it
 * to that page's list here.
 */

/** Records loaded on demand for staff. Clients never load any of these. */
export const LAZY_COLS = [
  "materialIssuances", "purchases", "lockerTransactions", "stockMovements",
  "supplierReceipts", "supplierPayments", "factoryPayments",
  "clientReceipts", "diamondPackets", "diamondSales", "supplierSales",
  // The catalog and product photos — only their two pages use them.
  "catalogFolders", "catalogFavorites", "productPhotoFolders", "productPhotoItems", "shares",
] as const;
export type LazyCol = (typeof LAZY_COLS)[number];

/** The collections behind each kind of server total. */
export const TOTALS_COLS = {
  factory: ["materialIssuances", "factoryPayments"],
  supplier: ["purchases", "supplierReceipts", "supplierPayments", "supplierSales"],
  locker: ["lockerTransactions"],
} as const satisfies Record<string, readonly LazyCol[]>;
export type TotalsKind = keyof typeof TOTALS_COLS;

/** Light pages, and the server totals each one shows. */
const LIGHT: Record<string, TotalsKind[]> = {
  "/": ["factory", "supplier", "locker"],   // Dashboard: charges pending, supplier dues, cash position
  "/factories": ["factory"],                // the factory list's cards
  "/suppliers": ["supplier"],               // the supplier list's cards
};

/** What an order's cost is worked out from (lib/orderCost.ts, costDataReady). */
/** What working out an order's cost reads (lib/orderCost.ts). */
export const COST: LazyCol[] = ["purchases", "materialIssuances", "diamondPackets", "stockMovements", "clientReceipts"];
const PHOTOS: LazyCol[] = ["catalogFolders", "productPhotoFolders", "productPhotoItems", "shares"];

/**
 * Every other page and the on-demand records it reads. ":id" stands for the
 * last part of the address (an order, a client, a stock section…).
 *
 * Deliberately missing, so they wait for everything: Settings (backup, merging
 * accounts — they walk every collection), Activity (undo checks the record
 * being put back), Reports (reads all of it anyway).
 */
const PAGE: Record<string, readonly LazyCol[]> = {
  "/orders": [...COST, "lockerTransactions"],
  // The production plan reads stock (bags, gold, every material, certified stones), the
  // factories' gold accounts and the costs — all here before the page draws.
  "/orders/new": [...COST, "clientReceipts", "lockerTransactions", "stockMovements", "diamondPackets", "materialIssuances", "purchases"],
  "/orders/:id": [...COST, "lockerTransactions"],
  "/invoices": ["purchases", "materialIssuances", "diamondPackets", "clientReceipts", "lockerTransactions"],
  // diamondSales: an account entry a diamond sale paid in is corrected with
  // the sale, not alone — the day book and Account entries read that (ENTRY_COLS).
  "/payments": ["clientReceipts", "lockerTransactions", "purchases", "materialIssuances", "supplierReceipts", "supplierPayments", "factoryPayments", "diamondSales", "supplierSales"],
  "/clients": [],
  "/clients/:id": ["clientReceipts", "lockerTransactions", "diamondSales", "diamondPackets"],
  "/suppliers/:id": ["purchases", "materialIssuances", "diamondPackets", "stockMovements", "lockerTransactions", "supplierReceipts", "supplierPayments", "supplierSales"],
  "/factories/:id": ["purchases", "materialIssuances", "diamondPackets", "stockMovements", "lockerTransactions", "factoryPayments"],
  // + materialIssuances: its Opening stock form (Buy & Assign's) records opening gold at a factory.
  "/stock": ["diamondPackets", "stockMovements", "materialIssuances"],
  "/stock/:id": ["purchases", "materialIssuances", "diamondPackets", "stockMovements", "diamondSales", "supplierSales"],
  "/buy-assign": ["purchases", "materialIssuances", "diamondPackets", "stockMovements", "diamondSales", "supplierSales", "lockerTransactions", "supplierReceipts", "supplierPayments"],
  "/locker": ["clientReceipts", "lockerTransactions"],
  "/expenses": ["lockerTransactions"],
  "/income": ["lockerTransactions"],
  "/ready-stock": [],
  "/ready-stock/:id": [],
  "/gift-cards": [],
  "/giftcard": [],
  "/catalog": [...PHOTOS, "catalogFavorites"],
  // + lockerTransactions: a freelancer's design shows what is still to pay on it.
  "/product-photos": [...PHOTOS, "lockerTransactions"],
  // What each freelancer was paid is in the account entries.
  "/designers": ["lockerTransactions"],
  "/designers/:id": ["lockerTransactions"],
  "/messages": [],
  "/notifications": [],
  "/search": [],
  "/employees": [],
  // Pay salary checks the account's balance before it pays.
  "/employees/:id": ["lockerTransactions"],
  "/profile": [],
  "/ai": [],
};

/** The page an address opens: "/orders/SLJ-0042" → "/orders/:id". */
function routeOf(pathname: string): string {
  const p = pathname.replace(/\/+$/, "") || "/";
  if (p in PAGE || p in LIGHT) return p;
  const parts = p.split("/");
  if (parts.length === 3) {
    const k = `/${parts[1]}/:id`;
    if (k in PAGE) return k;
  }
  return p;
}

/** A page that can draw from the server's totals alone (when they cover it). */
export function isLightPage(pathname: string): boolean {
  return routeOf(pathname) in LIGHT;
}

/**
 * The on-demand records a page must have before it draws. A light page needs
 * none while the server's totals cover it; when they do not (a party added
 * seconds ago, totals not running on this database), it loads the records
 * behind them and works the figures out itself.
 */
export function pageNeeds(pathname: string, covered: (kind: TotalsKind) => boolean): readonly LazyCol[] {
  const r = routeOf(pathname);
  const kinds = LIGHT[r];
  if (kinds) return kinds.filter(k => !covered(k)).flatMap(k => TOTALS_COLS[k]);
  return PAGE[r] ?? LAZY_COLS;
}
