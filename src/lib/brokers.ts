// Brokers (dalals) and their brokerage — one place for every figure, so the
// broker's account, a purchase's cost and the reports all read it the same way.
//
// A purchase may carry a broker and its share of the bill's brokerage. Who pays
// decides everything:
//   "us"       — we owe the broker that amount, and it is part of what the
//                material cost us (landedInr), so an order's cost and the stock's
//                cost per ct/g include it.
//   "supplier" — recorded on the bill for reference; nothing is owed and no
//                cost changes.
// The supplier's own bill (totalInr) and the supplier's due never change.
import type { Broker, DB, Purchase } from "./db";
import { openingCreditAmt, openingDebitAmt } from "./pure/basics";

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Brokerage on this purchase that we pay (0 when there is none, or the supplier pays). */
export function brokerageWePay(p: Pick<Purchase, "brokerId" | "brokerageInr" | "brokeragePaidBy">): number {
  return p.brokerId && p.brokeragePaidBy === "us" ? Math.max(0, p.brokerageInr || 0) : 0;
}

/** What the material cost us: the supplier's bill plus the brokerage we pay on it. */
export function landedInr(p: Pick<Purchase, "totalInr" | "brokerId" | "brokerageInr" | "brokeragePaidBy">): number {
  return (p.totalInr || 0) + brokerageWePay(p);
}

/** Payments made to a broker (account entries tagged to them). */
export function brokerPayments(db: Pick<DB, "lockerTransactions">, brokerId: string) {
  return (db.lockerTransactions ?? []).filter(t => t.refType === "brokerPayment" && t.refId === brokerId && t.type === "expense");
}

export interface BrokerAccount {
  /** Brokerage we pay, on every bill they brought. */
  brokerage: number;
  /** Brokerage the suppliers paid — for reference. */
  bySupplier: number;
  paid: number;
  /** Signed opening: + we owed them, − they owed us. */
  opening: number;
  /** What we still owe (negative = paid ahead). */
  due: number;
  bills: number;
}

export function brokerAccount(db: Pick<DB, "purchases" | "lockerTransactions">, broker: Broker): BrokerAccount {
  const ps = (db.purchases ?? []).filter(p => p.brokerId === broker.id);
  const brokerage = r2(ps.reduce((s, p) => s + brokerageWePay(p), 0));
  const bySupplier = r2(ps.filter(p => p.brokeragePaidBy === "supplier").reduce((s, p) => s + (p.brokerageInr || 0), 0));
  const paid = r2(brokerPayments(db, broker.id).reduce((s, t) => s + (t.amountInr || 0), 0));
  const opening = r2(openingCreditAmt(broker) - openingDebitAmt(broker));
  const bills = new Set(ps.map(p => `${p.supplierId}|${p.invoiceNumber?.trim() || p.createdAt}`)).size;
  return { brokerage, bySupplier, paid, opening, due: r2(opening + brokerage - paid), bills };
}

/** A bill's brokerage spread over its lines, in proportion to each line's
 *  amount — so a line removed later takes its own share with it. */
export function splitBrokerage(lineTotals: number[], amount: number): number[] {
  const total = lineTotals.reduce((s, x) => s + Math.max(0, x), 0);
  if (!(amount > 0) || !(total > 0)) return lineTotals.map(() => 0);
  const out = lineTotals.map(x => r2((Math.max(0, x) / total) * amount));
  // The odd paisa lands on the largest line, so the shares add up exactly.
  const diff = r2(amount - out.reduce((s, x) => s + x, 0));
  if (diff) { const i = lineTotals.indexOf(Math.max(...lineTotals)); out[i] = r2(out[i] + diff); }
  return out;
}

/** The brokerage fields for one bill, as a form holds them. */
export interface BillBrokerage {
  brokerId: string;
  /** % of the bill, as typed. */
  pct: string;
  /** ₹ amount, as typed — empty means "work it out from the %". */
  amount: string;
  paidBy: "us" | "supplier";
}
export const emptyBillBrokerage = (): BillBrokerage => ({ brokerId: "", pct: "", amount: "", paidBy: "us" });

/** The bill's brokerage in ₹: the amount typed, or the % of the bill. */
export function billBrokerageInr(b: BillBrokerage, billTotalInr: number): number {
  if (!b.brokerId) return 0;
  if (b.amount.trim() !== "") return Math.max(0, r2(Number(b.amount) || 0));
  const pct = Number(b.pct) || 0;
  return pct > 0 ? r2((billTotalInr * pct) / 100) : 0;
}

/** Why a bill's brokerage can't be saved — or nothing. */
export function billBrokerageProblem(b: BillBrokerage): string | null {
  if (!b.brokerId) return null;
  const pct = b.pct.trim() === "" ? 0 : Number(b.pct);
  if (!Number.isFinite(pct) || pct < 0 || pct > 20) return "Brokerage % should be between 0 and 20";
  if (b.amount.trim() !== "" && !(Number(b.amount) >= 0)) return "Enter a valid brokerage amount";
  return null;
}

/** Each line's brokerage fields, ready to put on its Purchase. */
export function brokerageForLines(b: BillBrokerage, lineTotals: number[]): Pick<Purchase, "brokerId" | "brokeragePct" | "brokerageInr" | "brokeragePaidBy">[] {
  if (!b.brokerId) return lineTotals.map(() => ({}));
  const billTotal = lineTotals.reduce((s, x) => s + x, 0);
  const shares = splitBrokerage(lineTotals, billBrokerageInr(b, billTotal));
  const pct = Number(b.pct) || undefined;
  return shares.map(share => ({ brokerId: b.brokerId, brokeragePct: pct, brokerageInr: share, brokeragePaidBy: b.paidBy }));
}

/** May this broker be deleted? Not once anything refers to them. */
export function brokerDeleteWhy(db: Pick<DB, "purchases" | "lockerTransactions">, broker: Broker): string | undefined {
  const bills = (db.purchases ?? []).filter(p => p.brokerId === broker.id).length;
  const pays = brokerPayments(db, broker.id).length;
  if (bills || pays) return `On ${bills} purchase line${bills === 1 ? "" : "s"} and ${pays} payment${pays === 1 ? "" : "s"} — switch them off instead`;
  return undefined;
}
