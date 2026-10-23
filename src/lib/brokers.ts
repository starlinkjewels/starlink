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
//
// Paying THROUGH a broker (how a Surat broker works): we give the broker one
// amount; he passes it on to the suppliers whose bills he brought and keeps his
// brokerage. In the books: one account entry to the broker (lockerTransactions,
// refType "brokerPayment"), and on each bill he paid, a supplier payment marked
// `viaBrokerId` with no account of its own (lockerId "") — the supplier's due
// comes down there. What the broker still holds of ours is what we gave him
// less what he passed on and his brokerage.
//
// SELLING to a supplier through a broker (lib/supplierSales.ts) works the same
// way the other round: brokerage on the sale is owed to him when we pay it, and
// money he COLLECTS from the supplier for us (a SupplierReceipt with
// `viaBrokerId`, no account of ours) is ours in his hands — until he hands it
// over (an account entry from him, refType "brokerReceipt").
import type { Broker, DB, Purchase, SupplierSale } from "./db";
import { openingCreditAmt, openingDebitAmt } from "./pure/basics";
import { purchasePending } from "./manufacturing";

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Brokerage on this purchase that we pay (0 when there is none, or the supplier pays). */
export function brokerageWePay(p: Pick<Purchase, "brokerId" | "brokerageInr" | "brokeragePaidBy">): number {
  return p.brokerId && p.brokeragePaidBy === "us" ? Math.max(0, p.brokerageInr || 0) : 0;
}

/** What the material cost us: the supplier's bill plus the brokerage we pay on it. */
export function landedInr(p: Pick<Purchase, "totalInr" | "brokerId" | "brokerageInr" | "brokeragePaidBy">): number {
  return (p.totalInr || 0) + brokerageWePay(p);
}

/** Brokerage on a sale to a supplier that we pay (0 when none, or the supplier pays). */
export function saleBrokerageWePay(s: Pick<SupplierSale, "brokerId" | "brokerageInr" | "brokeragePaidBy">): number {
  return s.brokerId && s.brokeragePaidBy === "us" ? Math.max(0, s.brokerageInr || 0) : 0;
}

/** Money a broker collected from suppliers for us (their receipts marked viaBrokerId). */
export function brokerCollected(db: Partial<Pick<DB, "supplierReceipts">>, brokerId: string) {
  return (db.supplierReceipts ?? []).filter(r => r.viaBrokerId === brokerId);
}

/** Money a broker handed over to us (account entries from them). */
export function brokerHandovers(db: Pick<DB, "lockerTransactions">, brokerId: string) {
  return (db.lockerTransactions ?? []).filter(t => t.refType === "brokerReceipt" && t.refId === brokerId && t.type === "income");
}

/** Payments made to a broker (account entries tagged to them). */
export function brokerPayments(db: Pick<DB, "lockerTransactions">, brokerId: string) {
  return (db.lockerTransactions ?? []).filter(t => t.refType === "brokerPayment" && t.refId === brokerId && t.type === "expense");
}

export interface BrokerAccount {
  /** Brokerage we pay, on every bill they brought and every sale they brought. */
  brokerage: number;
  /** Of that, on sales to suppliers. */
  saleBrokerage: number;
  /** Money they collected from suppliers for us. */
  collected: number;
  /** Of what they collected, handed over to us. */
  handedOver: number;
  /** Brokerage the suppliers paid — for reference. */
  bySupplier: number;
  /** Money we gave the broker (account entries to them). */
  paid: number;
  /** Of that, what the broker passed on to suppliers (bills paid via them). */
  passed: number;
  /** Signed opening: + we owed them, − they owed us. */
  opening: number;
  /** Brokerage still owed to them (negative = they hold money of ours —
   *  given, not yet passed to a supplier or kept as brokerage). */
  due: number;
  /** What the broker holds of ours, not yet passed on (0 when nothing). */
  held: number;
  /** Suppliers' bills they brought that are still unpaid. */
  billsPending: number;
  /** Everything to settle through them: unpaid bills plus brokerage owed, less what they already hold. */
  toPay: number;
  bills: number;
}

/** Supplier payments made through this broker. */
export function brokerPassed(db: Pick<DB, "purchases">, brokerId: string) {
  return (db.purchases ?? []).flatMap(p => (p.payments ?? []).filter(x => x.viaBrokerId === brokerId).map(pay => ({ purchase: p, pay })));
}

export function brokerAccount(db: Pick<DB, "purchases" | "lockerTransactions"> & Partial<Pick<DB, "supplierSales" | "supplierReceipts">>, broker: Broker): BrokerAccount {
  const ps = (db.purchases ?? []).filter(p => p.brokerId === broker.id);
  const saleBrokerage = r2((db.supplierSales ?? []).filter(s => s.brokerId === broker.id).reduce((s, x) => s + saleBrokerageWePay(x), 0));
  const brokerage = r2(ps.reduce((s, p) => s + brokerageWePay(p), 0) + saleBrokerage);
  // Ours in their hands: what they collected for us, less what they handed over.
  const collected = r2(brokerCollected(db, broker.id).reduce((s, r) => s + (r.amountInr || 0), 0));
  const handedOver = r2(brokerHandovers(db, broker.id).reduce((s, t) => s + (t.amountInr || 0), 0));
  const bySupplier = r2(ps.filter(p => p.brokeragePaidBy === "supplier").reduce((s, p) => s + (p.brokerageInr || 0), 0));
  const paid = r2(brokerPayments(db, broker.id).reduce((s, t) => s + (t.amountInr || 0), 0));
  const passed = r2(brokerPassed(db, broker.id).reduce((s, x) => s + (x.pay.amountInr || 0), 0));
  const opening = r2(openingCreditAmt(broker) - openingDebitAmt(broker));
  const bills = new Set(ps.map(p => `${p.supplierId}|${p.invoiceNumber?.trim() || p.createdAt}`)).size;
  // + we owe them; − they hold money of ours (given and not yet passed on, or collected and not yet handed over).
  const due = r2(opening + brokerage + passed - paid - collected + handedOver);
  const billsPending = r2(ps.reduce((s, p) => s + purchasePending(p), 0));
  return {
    brokerage, saleBrokerage, collected, handedOver, bySupplier, paid, passed, opening, due,
    held: Math.max(0, r2(-due)), billsPending,
    toPay: Math.max(0, r2(billsPending + due)), bills,
  };
}

/** The suppliers a broker deals with: the ones set on them, and the ones on bills they brought. */
export function brokerSuppliers(db: Pick<DB, "purchases">, broker: Broker): string[] {
  return [...new Set([...(broker.supplierIds ?? []), ...(db.purchases ?? []).filter(p => p.brokerId === broker.id).map(p => p.supplierId)])];
}

/** The broker who usually brings this supplier's goods — set on a broker, or the last bill's. */
export function usualBrokerFor(db: Pick<DB, "purchases" | "brokers">, supplierId: string): string | undefined {
  if (!supplierId) return undefined;
  const active = (db.brokers ?? []).filter(b => b.active !== false);
  const set = active.find(b => (b.supplierIds ?? []).includes(supplierId));
  if (set) return set.id;
  const last = [...(db.purchases ?? [])].filter(p => p.supplierId === supplierId && p.brokerId && active.some(b => b.id === p.brokerId))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  return last?.brokerId;
}

/** The unpaid bills a broker brought, oldest first. */
export function brokerPendingBills(db: Pick<DB, "purchases">, brokerId: string): Purchase[] {
  return (db.purchases ?? []).filter(p => p.brokerId === brokerId && purchasePending(p) > 0.5)
    .sort((a, b) => (a.invoiceDate || a.createdAt).localeCompare(b.invoiceDate || b.createdAt));
}

/** An amount spread over bills, oldest first; what is left over comes back as `rest`. */
export function allocateOldestFirst(bills: Purchase[], amount: number): { alloc: Record<string, number>; rest: number } {
  const alloc: Record<string, number> = {};
  let left = r2(amount);
  for (const p of bills) {
    if (left <= 0) break;
    const take = Math.min(left, r2(purchasePending(p)));
    if (take > 0) { alloc[p.id] = take; left = r2(left - take); }
  }
  return { alloc, rest: left };
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
export function brokerDeleteWhy(db: Pick<DB, "purchases" | "lockerTransactions"> & Partial<Pick<DB, "supplierSales" | "supplierReceipts">>, broker: Broker): string | undefined {
  const bills = (db.purchases ?? []).filter(p => p.brokerId === broker.id).length;
  const pays = brokerPayments(db, broker.id).length;
  if (bills || pays) return `On ${bills} purchase line${bills === 1 ? "" : "s"} and ${pays} payment${pays === 1 ? "" : "s"} — switch them off instead`;
  // Sales they brought, money they collected for us or handed over: their account holds it — never deleted with them.
  const sales = (db.supplierSales ?? []).filter(s => s.brokerId === broker.id).length;
  const money = brokerCollected(db, broker.id).length + brokerHandovers(db, broker.id).length;
  if (sales || money) return `On ${sales} sale${sales === 1 ? "" : "s"} and ${money} money entr${money === 1 ? "y" : "ies"} — switch them off instead`;
  return undefined;
}
