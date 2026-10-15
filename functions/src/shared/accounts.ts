// GENERATED from src/lib/pure/accounts.ts by functions/scripts/sync-shared.cjs - do not edit here.
/**
 * Account calculations — factory, supplier, locker — as pure functions: records
 * in, figures out, nothing else. The app (through lib/manufacturing.ts) and the
 * server (functions/, which keeps the stored totals) both use this file, so a
 * total kept on the server can never be worked out differently from the one on
 * screen.
 *
 * Only type imports from the app: this file must stay free of Firebase and of
 * app state, or the server cannot load it.
 */
import type {
  OpeningBalanceInfo, Purchase, SupplierReceipt, SupplierPayment, FactoryPayment,
  MaterialIssuance, Locker, LockerTransaction,
} from "./types";
import { toPureGold, pureFromPurity, openingDebitAmt, openingCreditAmt } from "./basics";

const r0 = (n: number) => Math.round(n);

/** One company's share, or (no company, or "all") every company's together.
 *  A record without a company is the first company's ("main"). */
function ofCompany(i: { companyId?: string }, companyId?: string): boolean {
  return !companyId || companyId === "all" || (i.companyId || "main") === companyId;
}

export function purchasePaid(p: Purchase): number {
  return (p.payments || []).reduce((s, x) => s + x.amountInr, 0);
}

export function issuancePaid(i: MaterialIssuance): number {
  return (i.makingCharges.payments || []).reduce((s, x) => s + x.amountInr, 0);
}

export function issuancePending(i: MaterialIssuance): number {
  return Math.max(0, i.makingCharges.amountInr - issuancePaid(i));
}

export function issuanceUsed(i: MaterialIssuance): number {
  return (i.finishedPieces || []).reduce((s, f) => s + f.quantityUsed, 0);
}

/**
 * A diamond issue's carats, as every factory figure counts them — the Factory
 * Account card, the factory's card on the list, and the Factory Ledger all use
 * this, so they can never quote two different "diamond at the factory" numbers.
 *
 *   out — carats that reached the factory. A draw from the factory's own pool
 *         adds nothing: those stones were counted when the pool was delivered.
 *   in  — carats the factory has accounted for. Once the issue is closed, all
 *         of it (set in the piece, returned to stock, or written off at Final
 *         Approval). Before that, what is set in a received piece plus what has
 *         come back. For a pool draw, only what was set in the piece (as the
 *         account always counted it) — the rest is still in the factory's pool.
 */
export function diamondFlow(i: MaterialIssuance): { out: number; in: number } {
  const pool = i.source === "factoryPool";
  const out = pool ? 0 : i.quantityIssued;
  const used = issuanceUsed(i);
  const returned = i.diamondKind === "certified"
    ? (i.finishDisposition === "returned" ? i.quantityIssued : 0)
    : (i.finishReturnedCt || 0);
  let accounted: number;
  if (pool) accounted = i.finishDisposition === "returned" ? 0 : used;
  else accounted = i.status === "closed" ? i.quantityIssued : Math.min(i.quantityIssued, used + returned);
  const r3 = (n: number) => Math.round(n * 1000) / 1000;
  return { out: r3(out), in: r3(Math.max(0, accounted)) };
}

/**
 * Any OTHER material at a factory (platinum, a gemstone, findings — anything
 * but gold or diamond), counted the way loose diamonds are: what reached the
 * factory, and what it has accounted for — used in a piece or sent back.
 */
export function otherFlow(i: MaterialIssuance): { out: number; in: number } {
  const pool = i.source === "factoryPool";
  const out = pool ? 0 : i.quantityIssued;
  const used = issuanceUsed(i);
  const returned = i.finishReturnedQty || 0;
  const accounted = pool ? used : i.status === "closed" ? i.quantityIssued : Math.min(i.quantityIssued, used + returned);
  const r3 = (n: number) => Math.round(n * 1000) / 1000;
  return { out: r3(out), in: r3(Math.max(0, accounted)) };
}

/** How much of each other material a factory still holds, by material key —
 *  only those it holds something of. */
export function factoryOtherBalances(issuances: MaterialIssuance[], factoryId: string, companyId?: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const i of issuances) {
    if (i.factoryId !== factoryId || i.material === "gold" || i.material === "diamond" || !ofCompany(i, companyId)) continue;
    const f = otherFlow(i);
    out[i.material] = (out[i.material] || 0) + f.out - f.in;
  }
  for (const k of Object.keys(out)) { out[k] = Math.round(out[k] * 1000) / 1000; if (Math.abs(out[k]) < 0.0005) delete out[k]; }
  return out;
}

/**
 * The factory's gold expressed in PURE / fine (24KT) grams — the client's
 * "factory gold stock". Gold ARRIVES as fine gold (each issuance's grams ×
 * its karat purity, for every gold issuance EXCEPT internal factoryPool draws,
 * which are just moving already-counted gold around within the factory) and
 * LEAVES as the pure-gold equivalent of each finished piece's net weight once
 * it's received back (finishedNetWeight × its karat). Balance = fine gold still
 * physically in the factory's hands. Derived, never stored (same trust level as
 * factoryPoolBalance above).
 */
export function factoryFineGoldBalance(issuances: MaterialIssuance[], factoryId: string, openingFineGold = 0, companyId?: string): number {
  let inFine = 0, outFine = 0;
  // The opening fine gold was entered before there was more than one company — the first company's.
  if (companyId && companyId !== "all" && companyId !== "main") openingFineGold = 0;
  for (const i of issuances) {
    if (i.factoryId !== factoryId || i.material !== "gold" || !ofCompany(i, companyId)) continue;
    if (i.source !== "factoryPool") inFine += toPureGold(i.quantityIssued, i.purityOrQuality);
    if (i.finishedNetWeight != null) {
      // Prefer the actual purity entered at Final Approval; fall back to karat.
      outFine += i.finishedPurity != null
        ? pureFromPurity(i.finishedNetWeight, i.finishedPurity)
        : i.finishedKarat ? toPureGold(i.finishedNetWeight, i.finishedKarat) : 0;
    }
  }
  // Fine gold physically at the factory at migration adds straight onto the balance.
  return Math.round((inFine - outFine + (openingFineGold || 0)) * 1000) / 1000;
}

/** Factory account summary across all their material issuances. Gold and
 *  diamond are tracked separately since their quantities are different units
 *  (grams vs carats) — making charges are combined (always INR). A
 *  source:"factoryPool" draw is NOT a new physical delivery (the material was
 *  already counted when it was bulk-delivered) — only its actual consumption
 *  (finishedPieces) counts toward goldUsed/diamondUsed, or goldOutstanding
 *  would double-count the moment any order draws from a factory's pool. */
export function factoryAccount(
  issuances: MaterialIssuance[],
  opening?: OpeningBalanceInfo,
  /** Payments that settle no particular job — advances and loans. */
  standalonePayments: FactoryPayment[] = [],
) {
  let goldIssued = 0,
    goldUsed = 0,
    diamondIssued = 0,
    diamondUsed = 0,
    chargesTotal = 0,
    chargesPaid = 0,
    chargesPending = 0,
    chargesOverpaid = 0;
  for (const i of issuances) {
    const isPoolDraw = i.source === "factoryPool";
    if (i.material === "gold") { if (!isPoolDraw) goldIssued += i.quantityIssued; goldUsed += issuanceUsed(i); }
    // Diamond only: another material is in its own unit and has its own
    // figures (factoryOtherBalances) — never added to the carats.
    else if (i.material === "diamond") { const f = diamondFlow(i); diamondIssued += f.out; diamondUsed += f.in; }
    chargesTotal += i.makingCharges.amountInr;
    const paid = issuancePaid(i);
    chargesPaid += paid;
    chargesPending += issuancePending(i);
    chargesOverpaid += Math.max(0, paid - i.makingCharges.amountInr);
  }
  // Opening making-charge balance from migration: credit = we owe the factory
  // (adds to what's due), debit = the factory owes us (offsets the pending, any
  // remainder shows as overpaid/credit in our favour).
  const oCredit = openingCreditAmt(opening), oDebit = openingDebitAmt(opening);
  chargesTotal += oCredit;
  chargesPending += oCredit;
  if (oDebit) {
    const applied = Math.min(oDebit, chargesPending);
    chargesPending -= applied;
    chargesOverpaid += oDebit - applied;
  }
  // An advance settles no one job, so it comes off what is still due; pay more
  // than is due and the rest stands as money the factory is holding for us.
  const advanced = standalonePayments.reduce((s, p) => s + p.amountInr, 0);
  if (advanced) {
    chargesPaid += advanced;
    const applied = Math.min(advanced, chargesPending);
    chargesPending -= applied;
    chargesOverpaid += advanced - applied;
  }
  return {
    goldIssued,
    goldUsed,
    goldOutstanding: goldIssued - goldUsed,
    diamondIssued: Math.round(diamondIssued * 1000) / 1000,
    /** Carats accounted for — set in pieces, returned, or settled at Final Approval. */
    diamondUsed: Math.round(diamondUsed * 1000) / 1000,
    diamondOutstanding: Math.round((diamondIssued - diamondUsed) * 1000) / 1000,
    chargesTotal: r0(chargesTotal),
    chargesPaid: r0(chargesPaid),
    chargesPending: r0(chargesPending),
    chargesOverpaid: r0(chargesOverpaid),
  };
}

export function supplierAccount(
  purchases: Purchase[],
  receipts: SupplierReceipt[] = [],
  opening?: OpeningBalanceInfo,
  /** Payments that settle no particular bill — advances and loans. */
  standalonePayments: SupplierPayment[] = [],
) {
  let totalPurchased = 0,
    totalPaid = 0,
    balanceOwed = 0,
    overpaid = 0;
  for (const p of purchases) {
    totalPurchased += p.totalInr;
    const paid = purchasePaid(p);
    totalPaid += paid;
    balanceOwed += Math.max(0, p.totalInr - paid);
    overpaid += Math.max(0, paid - p.totalInr);
  }
  // Opening balance from migration: credit = we owe them (like an old unpaid
  // bill), debit = they owe us (offsets, same side as a refund received).
  const oCredit = openingCreditAmt(opening), oDebit = openingDebitAmt(opening);
  totalPurchased += oCredit;
  balanceOwed += oCredit;
  // Cash the supplier handed BACK to us. It is money moving the other way, so
  // it raises the net exactly as a payment out lowers it: pay an advance of
  // ₹2,00,000 and get all of it back and the account returns to zero.
  //
  // This used to be subtracted, and folded the opening debit in with it. The
  // two run in opposite directions — an opening debit is money the supplier
  // owes us, cash received is money they have handed over — so a returned
  // ₹2,00,000 was counted as a second ₹2,00,000 paid out, leaving an account
  // that should have been square reading −₹4,00,000.
  const received = receipts.reduce((s, r) => s + r.amountInr, 0);
  // An advance or loan settles no bill, so it cannot reduce any one purchase's
  // balance — it reduces the net position. Pay a supplier you owe nothing and
  // the net goes negative: they are now holding your money.
  const advanced = standalonePayments.reduce((s, p) => s + p.amountInr, 0);
  totalPaid += advanced;
  // Net position: > 0 we still owe them; < 0 they hold money of ours.
  //
  // Overpaying a bill leaves money with the supplier just as an advance does,
  // so it belongs in the net for the same reason. It was left out, which made
  // an overpayment invisible: pay ₹5,00,000 against ₹4,00,000 of bills and the
  // account still read square.
  const net = Math.round((balanceOwed - overpaid - oDebit + received - advanced) * 100) / 100;
  return {
    totalPurchased: r0(totalPurchased), totalPaid: r0(totalPaid), balanceOwed: r0(balanceOwed),
    overpaid: r0(overpaid), received: r0(received), advanced: r0(advanced), net: r0(net),
  };
}

/** Running balance for one Locker — opening balance + income − expenses, netted with transfers. */
export function lockerBalance(locker: Locker, transactions: LockerTransaction[]): number {
  let bal = locker.openingBalance || 0;
  for (const t of transactions) {
    if (t.lockerId !== locker.id) continue;
    if (t.type === "income" || t.type === "transfer_in") bal += t.amountInr;
    else bal -= t.amountInr; // "expense" | "transfer_out"
  }
  return r0(bal);
}

/**
 * How much of `material`+`purityOrQuality` is currently sitting at `factoryId`,
 * bulk-delivered but not yet drawn down for a specific order — the factory's
 * own accumulated pool. Both terms are derived, never stored:
 *   delivered = Σ quantityIssued of bulk deliveries (orderId unset) for this
 *               factory/material/purity
 *   drawn     = Σ quantityIssued of pool draws (orderId set, source
 *               "factoryPool") for this factory/material/purity
 * Floors at 0 defensively. This is a plain derived read over the app's normal
 * diffed in-memory sync — same trust level as clientAccount()/Order.advances,
 * NOT a Firestore transaction like src/lib/stock.ts's decreaseStock. Two staff
 * drawing from the same factory's pool at the exact same instant could both
 * pass this check (a deliberate, reviewed tradeoff — see manufacturingReadiness
 * comment style — rather than adding a second transactional subsystem for a
 * much lower-volume, single-factory-scoped number).
 */
export function factoryPoolBalance(
  issuances: MaterialIssuance[],
  factoryId: string,
  material: string,
  purityOrQuality: string,
  /** One company's share of the pool; unset = the whole pool. */
  companyId?: string,
): number {
  let delivered = 0, drawn = 0;
  for (const i of issuances) {
    if (i.factoryId !== factoryId || i.material !== material || i.purityOrQuality !== purityOrQuality || !ofCompany(i, companyId)) continue;
    if (!i.orderId) delivered += i.quantityIssued;
    // A draw marked "returned" at Final Approval didn't end up consuming pool
    // material after all — exclude it so the pool balance goes back up,
    // without needing to rewrite quantityIssued itself (re-edit safe).
    else if (i.source === "factoryPool" && i.finishDisposition !== "returned") drawn += i.quantityIssued;
  }
  return Math.max(0, Math.round((delivered - drawn) * 100) / 100);
}

/** Every purity/quality this factory currently holds a positive pool balance
 *  in, for `material` — drives the "draw from pool" picker. */
export function factoryPoolBuckets(
  issuances: MaterialIssuance[],
  factoryId: string,
  material: string,
  companyId?: string,
): { purityOrQuality: string; balance: number }[] {
  const purities = new Set(
    issuances.filter(i => i.factoryId === factoryId && i.material === material && !i.orderId && ofCompany(i, companyId)).map(i => i.purityOrQuality),
  );
  return [...purities]
    .map(purityOrQuality => ({ purityOrQuality, balance: factoryPoolBalance(issuances, factoryId, material, purityOrQuality, companyId) }))
    .filter(b => b.balance > 0);
}
