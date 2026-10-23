// Money paid BACK to a client: their held credit (an advance with nothing to
// go on, the money on a cancelled order, a return) handed back to them.
//
// One account entry (refType "clientRefund", refId = the client) that carries
// the dollars it took off their credit (`refundUsd`). Their credit comes down
// in the same save, and cancelling the entry (moneyEntries.ts) puts exactly
// that back — so the account and the client's credit can never disagree.
//
// Only credit HELD on their account is refundable. Money sitting on an order
// is the order's, and an opening credit carried over from the old books is not
// in creditBalance at all — neither is touched here.
import { uid, fmtMoney, updateDb, type DB, type LockerTransaction } from "./db";
import { ccy, roundCcy } from "./currency";

const r2 = (n: number) => Math.round(n * 100) / 100;

/** What can be refunded to a client now: the credit held on their account. */
export function refundable(db: Pick<DB, "clients">, clientId: string): number {
  return r2(Math.max(0, db.clients.find(c => c.id === clientId)?.creditBalance || 0));
}

/** A client's refunds, newest first. */
export function clientRefunds(db: Pick<DB, "lockerTransactions">, clientId: string): LockerTransaction[] {
  return (db.lockerTransactions ?? [])
    .filter(t => t.refType === "clientRefund" && t.refId === clientId && t.type === "expense")
    .sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));
}

export interface RefundInput {
  clientId: string;
  lockerId: string;
  /** Taken off their credit, in dollars (what clients are billed in). */
  amountUsd: number;
  /** The locker's currency for $1 — needed for any locker not in dollars. */
  rate?: number;
  note?: string;
  voucherNo?: string;
  userId: string;
  at: string;
  txnId?: string;
}

/** Why this refund cannot be saved, read on the records it will be saved on. */
export function refundProblem(d: DB, x: RefundInput): string | undefined {
  const c = d.clients.find(y => y.id === x.clientId);
  if (!c) return "Choose the client";
  const l = d.lockers.find(y => y.id === x.lockerId);
  if (!l) return "Choose the account it is paid from";
  if (!(x.amountUsd > 0)) return "Enter the amount";
  const held = refundable(d, x.clientId);
  if (x.amountUsd > held + 0.005) {
    return held > 0.005
      ? `${c.companyName} holds ${fmtMoney(held)} of credit — only that can be refunded`
      : `${c.companyName} holds no credit to refund`;
  }
  if (ccy(l.currency) !== "USD" && !(Number(x.rate) > 0)) return "Enter the exchange rate — the client's credit is in USD";
  return undefined;
}

/** Write the refund: their credit comes down, the account pays it out.
 *  Call inside updateDb, after refundProblem said nothing. */
export function writeClientRefund(d: DB, x: RefundInput): LockerTransaction | undefined {
  if (refundProblem(d, x)) return undefined;
  const c = d.clients.find(y => y.id === x.clientId)!;
  const l = d.lockers.find(y => y.id === x.lockerId)!;
  const cur = ccy(l.currency);
  const usd = r2(x.amountUsd);
  const left = r2((c.creditBalance || 0) - usd);
  c.creditBalance = left > 0.005 ? left : undefined;
  const t: LockerTransaction = {
    id: x.txnId ?? uid("ltx_"), lockerId: l.id, type: "expense",
    amountInr: cur === "USD" ? usd : roundCcy(usd * Number(x.rate), cur), currency: cur,
    category: `Refund to ${c.companyName}`, refType: "clientRefund", refId: c.id, refundUsd: usd,
    exchangeRate: cur === "USD" ? undefined : Number(x.rate),
    voucherNo: x.voucherNo, note: x.note?.trim() || undefined, recordedBy: x.userId, createdAt: x.at,
  };
  if (!d.lockerTransactions) d.lockerTransactions = [];
  d.lockerTransactions.push(t);
  return t;
}

/** Delete one refund from the client's page: the entry goes, the credit comes
 *  back. Returns false when it was already gone. */
export function deleteClientRefund(txnId: string): boolean {
  let done = false;
  updateDb(d => {
    const t = (d.lockerTransactions ?? []).find(x => x.id === txnId && x.refType === "clientRefund");
    if (!t) return;
    undoClientRefund(d, t);
    d.lockerTransactions = d.lockerTransactions.filter(x => x.id !== txnId);
    done = true;
  });
  return done;
}

/** Cancelling a refund: what it took off the client's credit goes back on.
 *  Call inside updateDb, beside removing the entry. */
export function undoClientRefund(d: DB, t: Pick<LockerTransaction, "refType" | "refId" | "refundUsd">): void {
  if (t.refType !== "clientRefund" || !t.refId || !(Number(t.refundUsd) > 0)) return;
  const c = d.clients.find(y => y.id === t.refId);
  if (c) c.creditBalance = r2((c.creditBalance || 0) + Number(t.refundUsd));
}
