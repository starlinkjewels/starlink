// A diamond sold out of stock whose money did not come in at once ("Not
// received yet"): what the buyer still owes, and the payments that settle it.
//
// Kept on the sale itself — never on the client's orders or receipts — so a
// client's invoices, receipts and credit work exactly as before. Each payment
// is one account entry tagged to the sale (refType "diamondSale", refId the
// sale), so cancelling the sale (diamondSaleVoid.ts) takes all of them out with
// it, and Payments → Account entries sends a correction back to the sale.
import { uid, updateDb, type DB, type DiamondSale, type LockerTransaction } from "./db";
import { ccy, fmtCcy, roundCcy } from "./currency";

/** The sale's currency and total in it: dollars for a sale in dollars, else rupees. */
export const saleCcy = (s: DiamondSale) => (s.totalUsd != null ? "USD" : "INR");
export const saleTotal = (s: DiamondSale) => s.totalUsd ?? s.totalInr;

/**
 * The payments on an unpaid sale, read from the account entries tagged to it —
 * the money as it actually sits in the accounts. (The sale's own `payments`
 * list is a note beside them: two people saving at once could leave it a row
 * short, never the accounts.)
 */
export function salePaymentRows(txns: LockerTransaction[] | undefined, s: DiamondSale): LockerTransaction[] {
  if (!s.unpaid) return [];
  return (txns ?? []).filter(t => t.refType === "diamondSale" && t.refId === s.id && t.type === "income")
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

/** Received so far against an unpaid sale. */
export function saleReceived(txns: LockerTransaction[] | undefined, s: DiamondSale): number {
  return roundCcy(salePaymentRows(txns, s).reduce((t, r) => t + r.amountInr, 0), saleCcy(s));
}

/** Still owed — only ever for a sale saved as not received yet. */
export function saleOwed(txns: LockerTransaction[] | undefined, s: DiamondSale): number {
  if (!s.unpaid) return 0;
  return Math.max(0, roundCcy(saleTotal(s) - saleReceived(txns, s), saleCcy(s)));
}

/** Who bought it, in words. */
export function saleBuyer(db: Pick<DB, "clients">, s: DiamondSale): string {
  return s.clientId ? (db.clients.find(c => c.id === s.clientId)?.companyName ?? "the client") : (s.buyerName || "the buyer");
}

export interface SalePaymentInput { saleId: string; amount: number; lockerId: string; at: string; note?: string; userId: string }

/** Why this payment can't be taken, read on the records it is saved on. */
export function salePaymentProblem(d: DB, x: SalePaymentInput): string | undefined {
  const s = (d.diamondSales ?? []).find(y => y.id === x.saleId);
  if (!s) return "That sale is no longer on file";
  if (!s.unpaid) return "This sale was paid when it was made";
  const owed = saleOwed(d.lockerTransactions, s);
  if (owed <= 0) return "Nothing is owed on this sale";
  // Checked as it will be saved: an amount that rounds to nothing is not a payment.
  if (!(roundCcy(x.amount, saleCcy(s)) > 0)) return "Enter the amount";
  if (x.amount > owed + 0.005) return `Only ${fmtCcy(owed, saleCcy(s))} is owed on this sale`;
  const l = d.lockers.find(y => y.id === x.lockerId);
  if (!l) return "Choose the account the money went into";
  if (ccy(l.currency) !== saleCcy(s)) return `This sale is in ${saleCcy(s)} — choose a ${saleCcy(s)} account`;
  return undefined;
}

/** Take a payment against an unpaid sale: on the sale, and into the account. Returns the problem, if any. */
export function receiveSalePayment(x: SalePaymentInput): string | undefined {
  let problem: string | undefined;
  updateDb(d => {
    problem = salePaymentProblem(d, x);
    if (problem) return;
    const s = d.diamondSales.find(y => y.id === x.saleId)!;
    const cur = saleCcy(s);
    const amount = roundCcy(x.amount, cur);
    const txnId = uid("ltx_");
    if (!s.payments) s.payments = [];
    s.payments.push({ id: uid("dsp_"), amount, lockerId: x.lockerId, lockerTxnId: txnId, note: x.note?.trim() || undefined, recordedBy: x.userId, createdAt: x.at });
    if (!d.lockerTransactions) d.lockerTransactions = [];
    d.lockerTransactions.push({
      id: txnId, lockerId: x.lockerId, type: "income", amountInr: amount, currency: cur,
      // The sale's own money, tied to it — never offered for a client's bills.
      category: "Diamond Sale payment", refType: "diamondSale", refId: s.id, notClientPayment: true,
      note: `${s.carat}ct ${s.kind === "certified" ? "certified " : ""}${s.shape} — from ${saleBuyer(d, s)}${x.note?.trim() ? ` · ${x.note.trim()}` : ""}`,
      recordedBy: x.userId, createdAt: x.at,
    });
  });
  return problem;
}

/** Take one payment back off a sale: its account entry goes (the money leaves
 *  the account), and its note on the sale with it. */
export function removeSalePayment(saleId: string, txnId: string): boolean {
  let done = false;
  updateDb(d => {
    const s = (d.diamondSales ?? []).find(y => y.id === saleId);
    const row = (d.lockerTransactions ?? []).find(t => t.id === txnId && t.refType === "diamondSale" && t.refId === saleId);
    if (!s || !s.unpaid || !row) return;
    d.lockerTransactions = d.lockerTransactions.filter(t => t.id !== txnId);
    if (s.payments?.some(p => p.lockerTxnId === txnId)) s.payments = s.payments.filter(p => p.lockerTxnId !== txnId);
    done = true;
  });
  return done;
}
