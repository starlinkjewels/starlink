/**
 * Sales commission, person by person — what each salesperson earned on the
 * orders sold, what was paid to them, and what is still owed (lib/commission.ts
 * has the rules and the arithmetic).
 *
 *  • Earned: each SHIPPED sale's commission (the Profit & Loss rule — the
 *    period it belongs to is the day it was dispatched).
 *  • Coming: finished pieces not shipped yet — counted once they go.
 *  • Paid: payments marked as commission (Expense.commission), in rupees: a
 *    rupee account's amount, or the rupees typed at the rate when paid from a
 *    dollar (or any other) account.
 *  • Owed = earned − paid. A sale returned after its commission was paid makes
 *    it smaller — even below nothing ("paid ahead"), which comes off what they
 *    earn next. Nothing is ever taken back by hand.
 *
 * All in rupees: the margin is worked out in rupees (each sale at its own
 * day's rate), and that is what the team is paid in.
 */
import { orderCost, inProfitReport, recognisedSale, saleDate, inrOn, rateOn } from "./orderCost";
import { orderTotal, type DB, type Expense, type Order } from "./db";
import type { CommissionLine } from "./commission";
import { writeExpense, payInRupees, type MoneyArgs } from "./partyPayments";
import { closedWhy } from "./yearLock";

const r2 = (n: number) => Math.round(n * 100) / 100;

export interface CommissionRow {
  order: Order;
  line: CommissionLine;
  /** The day it was sold (dispatched) — or, not shipped yet, the day it was ordered. */
  saleDay: string;
  /** Shipped: earned. Not yet: coming. */
  shipped: boolean;
  /** Every cost behind the margin is known (else the commission is at most this). */
  complete: boolean;
  /** Selling price, ₹ at the sale day's rate. */
  sellingInr: number;
}

/** Every order's commission, newest sale first — one person's when given. */
export function commissionRows(db: DB, userId?: string): CommissionRow[] {
  const out: CommissionRow[] = [];
  for (const o of db.orders) {
    if (o.deletedAt || !inProfitReport(o)) continue;
    const c = orderCost(db, o);
    const line = c.commission;
    if (!line || (userId && line.payeeId !== userId)) continue;
    const fx = rateOn(db, saleDate(o));
    out.push({
      order: o, line, saleDay: saleDate(o), shipped: recognisedSale(o), complete: c.complete,
      sellingInr: fx ? r2(orderTotal(o) * fx.rate) : 0,
    });
  }
  return out.sort((a, b) => b.saleDay.localeCompare(a.saleDay));
}

/** The rupees a commission payment settles; undefined when it can't be told (a currency with no rate). */
export function commissionPaidInr(db: DB, e: Expense): number | undefined {
  if (e.commissionInr != null) return e.commissionInr;
  const per = inrOn(db, e.currency, e.createdAt);
  return per === undefined ? undefined : r2(e.amount * per);
}

/** The commission paid to someone, oldest first. */
export function commissionPayments(db: DB, userId: string): Expense[] {
  return (db.expenses ?? []).filter(e => e.commission && e.paidToEmployeeId === userId)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export interface CommissionAccount {
  earnedInr: number;
  comingInr: number;
  paidInr: number;
  /** Earned less paid — below nothing when paid ahead. */
  owedInr: number;
  /** Payments whose rupees can't be told (no rate) — left out of `paidInr`, said so. */
  unvalued: number;
  /** Shipped sales whose cost isn't all known yet — their commission is at most what is shown. */
  partial: number;
}

/** One person's commission as it stands — from their rows (commissionRows(db, id)). */
export function commissionAccount(db: DB, userId: string, rows: CommissionRow[] = commissionRows(db, userId), inPeriod?: (iso: string) => boolean): CommissionAccount {
  const mine = rows.filter(r => r.line.payeeId === userId && (!inPeriod || inPeriod(r.saleDay)));
  const earned = mine.filter(r => r.shipped);
  let paidInr = 0, unvalued = 0;
  for (const e of commissionPayments(db, userId)) {
    if (inPeriod && !inPeriod(e.createdAt)) continue;
    const v = commissionPaidInr(db, e);
    if (v === undefined) unvalued++; else paidInr += v;
  }
  const earnedInr = r2(earned.reduce((s, r) => s + r.line.inr, 0));
  return {
    earnedInr,
    comingInr: r2(mine.filter(r => !r.shipped).reduce((s, r) => s + r.line.inr, 0)),
    paidInr: r2(paidInr),
    owedInr: r2(earnedInr - paidInr),
    unvalued,
    partial: earned.filter(r => !r.complete).length,
  };
}

/** Earned (shipped) commission by person, ₹ — for lists and reports. */
export function commissionByPerson(rows: CommissionRow[], inPeriod?: (iso: string) => boolean): Map<string, number> {
  const m = new Map<string, number>();
  for (const r of rows) {
    if (!r.shipped || (inPeriod && !inPeriod(r.saleDay))) continue;
    m.set(r.line.payeeId, r2((m.get(r.line.payeeId) ?? 0) + r.line.inr));
  }
  return m;
}

/** Why this commission payment can't be made, or nothing. */
export function commissionPayProblem(d: DB, a: { lockerId: string; amount: number; at: string; rate?: number }): string | undefined {
  const closed = closedWhy(a.at, d.settings);
  if (closed) return closed;
  if (!a.lockerId) return "Choose the account it is paid from.";
  if (!(a.amount > 0)) return "Enter the amount.";
  const l = d.lockers.find(x => x.id === a.lockerId);
  if (!l) return "That account is no longer there.";
  if (l.currency && l.currency !== "INR" && !(Number(a.rate) > 0)) return `Enter the rate — ₹ for 1 ${l.currency}`;
  return undefined;
}

/**
 * Pay commission (inside updateDb): an expense paid to them, marked as
 * commission — out of the account like any payment, on their pay ledger, but
 * never a running cost (it is inside the orders' cost already). From an
 * account in another currency, the rupees it settles go with it.
 */
export function writeCommissionPayment(d: DB, a: MoneyArgs & { payeeId: string; payeeName: string }): Expense | undefined {
  const { inr } = payInRupees(d, { lockerId: a.lockerId, amount: a.amount, rate: a.rate });
  const e = writeExpense(d, { ...a, title: `Sales commission — ${a.payeeName}`, category: "Commission", paidToEmployeeId: a.payeeId });
  if (!e) return undefined;
  e.commission = true;
  if (Math.abs(inr - a.amount) >= 0.005 || (d.lockers.find(x => x.id === a.lockerId)?.currency ?? "INR") !== "INR") e.commissionInr = inr;
  return e;
}
