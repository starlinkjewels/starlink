/**
 * A factory's, supplier's or locker's figures for a page that shows them —
 * worked out from the records when they are loaded (instant, and exactly what
 * every page always showed), and read from the server's totals when they are
 * not. The server works its totals out with the same code (src/lib/pure), and
 * Settings → Server totals → Check proves the two agree figure for figure.
 *
 * Only a page that is light in pageData.ts ever reaches the server's figures,
 * and it is light only while those figures cover every party it shows
 * (totalsCovered) — otherwise it loads the records and works them out here.
 */
import { collectionsLoaded, summaryOf, summariesLive, type DB, type Factory, type Supplier, type Locker } from "./db";
import { factoryAccount, factoryFineGoldBalance, factoryPoolBuckets, supplierAccount, lockerBalance } from "./manufacturing";
import { TOTALS_COLS, type TotalsKind } from "./pageData";

/** The summary version that also carries a factory's pool stock. */
const POOL_VERSION = 2;

export type FactoryFigures = ReturnType<typeof factoryAccount> & { fineGold: number; goldPool: number; diaPool: number };
export type SupplierFigures = ReturnType<typeof supplierAccount>;

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);

/**
 * Whether a page can show this kind of figure without loading the records:
 * they are already loaded, or the server has a total for every one of them.
 * `withPool`: a factory's total must also carry its pool stock.
 */
export function totalsCovered(db: DB, kind: TotalsKind, withPool = false): boolean {
  if (collectionsLoaded(TOTALS_COLS[kind])) return true;
  if (!summariesLive()) return false;
  const parties: { id: string }[] = kind === "factory" ? db.factories : kind === "supplier" ? db.suppliers : db.lockers;
  return parties.every(p => {
    const s = summaryOf(`${kind}_${p.id}`);
    return !!s && (!withPool || num(s.v) >= POOL_VERSION);
  });
}

export function factoryFigures(db: DB, f: Factory): FactoryFigures {
  const s = collectionsLoaded(TOTALS_COLS.factory) ? undefined : summaryOf(`factory_${f.id}`);
  if (s) {
    return {
      goldIssued: num(s.goldIssued), goldUsed: num(s.goldUsed), goldOutstanding: num(s.goldOutstanding),
      diamondIssued: num(s.diamondIssued), diamondUsed: num(s.diamondUsed), diamondOutstanding: num(s.diamondOutstanding),
      chargesTotal: num(s.chargesTotal), chargesPaid: num(s.chargesPaid), chargesPending: num(s.chargesPending), chargesOverpaid: num(s.chargesOverpaid),
      fineGold: num(s.fineGold), goldPool: num(s.goldPool), diaPool: num(s.diaPool),
    };
  }
  const issuances = db.materialIssuances.filter(i => i.factoryId === f.id);
  return {
    ...factoryAccount(issuances, f, (db.factoryPayments ?? []).filter(x => x.factoryId === f.id)),
    fineGold: factoryFineGoldBalance(db.materialIssuances, f.id, f.openingFineGold),
    goldPool: factoryPoolBuckets(issuances, f.id, "gold").reduce((t, b) => t + b.balance, 0),
    diaPool: factoryPoolBuckets(issuances, f.id, "diamond").reduce((t, b) => t + b.balance, 0),
  };
}

export function supplierFigures(db: DB, sup: Supplier): SupplierFigures {
  const s = collectionsLoaded(TOTALS_COLS.supplier) ? undefined : summaryOf(`supplier_${sup.id}`);
  if (s) {
    return {
      totalPurchased: num(s.totalPurchased), totalPaid: num(s.totalPaid), balanceOwed: num(s.balanceOwed),
      overpaid: num(s.overpaid), received: num(s.received), advanced: num(s.advanced), net: num(s.net),
    };
  }
  return supplierAccount(
    db.purchases.filter(p => p.supplierId === sup.id),
    (db.supplierReceipts ?? []).filter(r => r.supplierId === sup.id),
    sup,
    (db.supplierPayments ?? []).filter(x => x.supplierId === sup.id),
  );
}

/** A locker's balance, in its own currency. */
export function lockerFigure(db: DB, l: Locker): number {
  const s = collectionsLoaded(TOTALS_COLS.locker) ? undefined : summaryOf(`locker_${l.id}`);
  if (s) return num(s.balance);
  return lockerBalance(l, db.lockerTransactions);
}
