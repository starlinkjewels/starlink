/**
 * Which records each page needs — so the heavy ones (the books behind every
 * account: purchases, factory issues, account entries, stock movements…) are
 * downloaded when a page that uses them opens, not at every sign-in.
 *
 * One rule keeps every figure exact: a page is LIGHT only when everything it
 * shows can be read from the server's totals (see partyTotals.ts). Any other
 * page waits for its records before it draws — every page not listed below
 * waits for all of them, exactly as the app always worked.
 *
 * A page that turns out to read a heavy collection it did not ask for still
 * gets it (db.ts loads it on first read) and says so in the console — the
 * demo tests watch for that warning.
 */

/** Records loaded on demand for staff. Clients never load any of these. */
export const LAZY_COLS = [
  "materialIssuances", "purchases", "lockerTransactions", "stockMovements",
  "supplierReceipts", "supplierPayments", "factoryPayments",
  "clientReceipts", "diamondPackets", "diamondSales",
] as const;
export type LazyCol = (typeof LAZY_COLS)[number];

/** The collections behind each kind of server total. */
export const TOTALS_COLS = {
  factory: ["materialIssuances", "factoryPayments"],
  supplier: ["purchases", "supplierReceipts", "supplierPayments"],
  locker: ["lockerTransactions"],
} as const satisfies Record<string, readonly LazyCol[]>;
export type TotalsKind = keyof typeof TOTALS_COLS;

/** Light pages, and the server totals each one shows. */
const LIGHT: Record<string, TotalsKind[]> = {
  "/": ["factory", "supplier", "locker"],   // Dashboard: charges pending, supplier dues, cash position
  "/factories": ["factory"],                // the factory list's cards
  "/suppliers": ["supplier"],               // the supplier list's cards
};

/** A page that can draw from the server's totals alone (when they cover it). */
export function isLightPage(pathname: string): boolean {
  return (pathname.replace(/\/+$/, "") || "/") in LIGHT;
}

/**
 * The heavy records a page must have before it draws. A light page needs none
 * while the server's totals cover it; when they do not (a party added seconds
 * ago, totals not running on this database), it loads the records behind them
 * and works the figures out itself.
 */
export function pageNeeds(pathname: string, covered: (kind: TotalsKind) => boolean): readonly LazyCol[] {
  const kinds = LIGHT[pathname.replace(/\/+$/, "") || "/"];
  if (!kinds) return LAZY_COLS;
  return kinds.filter(k => !covered(k)).flatMap(k => TOTALS_COLS[k]);
}
