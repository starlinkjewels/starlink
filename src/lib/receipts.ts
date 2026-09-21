// Client receipts — one numbered entry per payment received, the way a receipt
// book works.
//
// A payment is not one row in the database: it settles several orders (as
// advances), lands in a locker (as a deposit) and may leave credit behind.
// Correcting one used to mean finding all of those by hand, so in practice it
// could not be corrected at all. Every piece a receipt creates now carries its
// `receiptId`, which is what makes editing and cancelling safe: the pieces are
// removed by that tag, never guessed at.
//
// Money is only ever moved, never invented — see settleClientAccount().
import {
  loadDb, updateDb, uid, settleClientAccount,
  type DB, type ClientReceipt, type Order,
} from "./db";
import { reserveReceiptNumber } from "./counters";

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Every receipt, newest first. */
export function listReceipts(db: DB, clientId?: string): ClientReceipt[] {
  return (db.clientReceipts ?? [])
    .filter(r => !clientId || r.clientId === clientId)
    .sort((a, b) => +new Date(b.date) - +new Date(a.date) || b.receiptNo.localeCompare(a.receiptNo));
}

/** What a receipt is currently settling, read live from the orders it landed on. */
export function receiptApplied(db: DB, receiptId: string): number {
  return r2(db.orders.reduce((s, o) =>
    s + (o.advances ?? []).reduce((t, a) => t + (a.receiptId === receiptId ? a.amount : 0), 0), 0));
}

/**
 * Strip a receipt's money back out of a client's account: its advances come off
 * the orders, and whatever it had left sitting as credit comes off too (never
 * below zero — a client's credit can't be pushed negative by a correction).
 * Call inside updateDb(). Leaves the receipt row itself alone.
 */
function unapply(d: DB, receipt: ClientReceipt): void {
  let removed = 0;
  for (const o of d.orders) {
    if (o.clientId !== receipt.clientId || !o.advances?.length) continue;
    const keep = o.advances.filter(a => {
      if (a.receiptId !== receipt.id) return true;
      removed = r2(removed + a.amount);
      return false;
    });
    o.advances = keep;
  }
  const client = d.clients.find(c => c.id === receipt.clientId);
  if (client) {
    // Anything of this receipt that never reached an order was carried as credit.
    const asCredit = Math.max(0, r2(receipt.amountUsd - removed));
    const left = r2((client.creditBalance || 0) - asCredit);
    client.creditBalance = left > 0 ? left : undefined;
  }
}

/** Ids of every advance a client has right now — the "before" picture. */
function advanceIds(d: DB, clientId: string): Set<string> {
  const ids = new Set<string>();
  for (const o of d.orders) {
    if (o.clientId !== clientId) continue;
    for (const a of o.advances ?? []) ids.add(a.id);
  }
  return ids;
}

/**
 * Tag the advances a settle run just created. Matched by id against the "before"
 * picture, NOT by "has no tag yet" — payments recorded before receipts existed
 * are untagged, and adopting those into a new receipt would mean deleting that
 * receipt took somebody else's money off the orders with it.
 */
function tagNewAdvances(d: DB, clientId: string, receiptId: string, before: Set<string>): void {
  for (const o of d.orders) {
    if (o.clientId !== clientId) continue;
    for (const a of o.advances ?? []) if (!before.has(a.id) && !a.receiptId) a.receiptId = receiptId;
  }
}

export interface ReceiptInput {
  clientId: string;
  amountUsd: number;
  date: string;              // ISO
  method: string;
  remarks?: string;
  lockerId?: string;
  lockerAmount?: number;
  lockerCurrency?: "INR" | "USD";
  exchangeRate?: number;
  invoiceId?: string;
  userId: string;
}

/**
 * Record money received. Reserves the receipt number FIRST (a database
 * transaction, so it is unique), then settles the client's bills with it and
 * writes the locker deposit — all tagged with the new receipt's id.
 */
export async function createReceipt(input: ReceiptInput): Promise<ClientReceipt> {
  const receiptNo = await reserveReceiptNumber(loadDb().clientReceipts ?? []);
  const id = uid("rcpt_");
  const now = new Date().toISOString();
  const receipt: ClientReceipt = {
    id, receiptNo,
    clientId: input.clientId,
    date: input.date,
    amountUsd: r2(input.amountUsd),
    lockerId: input.lockerId,
    lockerAmount: input.lockerAmount,
    lockerCurrency: input.lockerCurrency,
    exchangeRate: input.exchangeRate,
    method: input.method,
    remarks: input.remarks,
    invoiceId: input.invoiceId,
    recordedBy: input.userId,
    createdAt: now,
  };
  updateDb(d => {
    if (!d.clientReceipts) d.clientReceipts = [];
    d.clientReceipts.push(receipt);
    const before = advanceIds(d, input.clientId);
    settleClientAccount(d, input.clientId, receipt.amountUsd, input.userId, input.date,
      input.remarks?.trim() || input.method, input.invoiceId);
    tagNewAdvances(d, input.clientId, id, before);
    if (input.lockerId) {
      const locker = d.lockers.find(l => l.id === input.lockerId);
      if (locker) {
        if (!d.lockerTransactions) d.lockerTransactions = [];
        d.lockerTransactions.push({
          id: uid("ltx_"), lockerId: input.lockerId, type: "income",
          amountInr: input.lockerAmount ?? receipt.amountUsd,
          currency: locker.currency || "INR",
          category: `Client Payment — ${d.clients.find(c => c.id === input.clientId)?.companyName ?? "Client"}`,
          refType: "clientPayment", refId: input.clientId, receiptId: id,
          note: input.remarks?.trim() || input.method,
          exchangeRate: input.exchangeRate,
          recordedBy: input.userId, createdAt: input.date,
        });
      }
    }
  });
  return receipt;
}

/**
 * Number a payment that was recorded straight onto one order — the advance
 * taken while raising the order, or a payment entered on the order page.
 *
 * Those two screens write the advance themselves, so they cannot go through
 * createReceipt() without re-running the allocation and moving money that is
 * already where it belongs. This gives that payment its receipt number and
 * tags the pieces it already created, so it reads like every other receipt and
 * can be corrected or cancelled the same way. Not one figure moves.
 */
export async function receiptForAdvance(args: {
  clientId: string;
  /** The advance rows this payment created — usually one. */
  advanceIds: string[];
  amountUsd: number;
  date: string;
  method: string;
  remarks?: string;
  /** The locker deposit it landed in, when there was one. */
  lockerTxnId?: string;
  userId: string;
}): Promise<ClientReceipt> {
  const receiptNo = await reserveReceiptNumber(loadDb().clientReceipts ?? []);
  const id = uid("rcpt_");
  const ids = new Set(args.advanceIds);
  let receipt!: ClientReceipt;
  updateDb(d => {
    const txn = args.lockerTxnId ? (d.lockerTransactions ?? []).find(t => t.id === args.lockerTxnId) : undefined;
    receipt = {
      id, receiptNo,
      clientId: args.clientId,
      date: args.date,
      amountUsd: r2(args.amountUsd),
      lockerId: txn?.lockerId,
      lockerAmount: txn?.amountInr,
      lockerCurrency: txn?.currency,
      exchangeRate: txn?.exchangeRate,
      method: args.method,
      remarks: args.remarks?.trim() || undefined,
      recordedBy: args.userId,
      createdAt: new Date().toISOString(),
    };
    if (!d.clientReceipts) d.clientReceipts = [];
    d.clientReceipts.push(receipt);
    for (const o of d.orders) {
      if (o.clientId !== args.clientId) continue;
      for (const a of o.advances ?? []) if (ids.has(a.id)) a.receiptId = id;
    }
    if (txn) txn.receiptId = id;
  });
  return receipt;
}

/**
 * Correct a receipt. The old allocation and deposit are taken back out first,
 * then the corrected figures are settled exactly as a new receipt would be —
 * so a changed amount can never leave half of the old one behind. The receipt
 * NUMBER never changes; a receipt that has been issued keeps its identity.
 */
export function editReceipt(receiptId: string, patch: Partial<ReceiptInput> & { userId: string }): void {
  updateDb(d => {
    const rec = (d.clientReceipts ?? []).find(r => r.id === receiptId);
    if (!rec) return;
    unapply(d, rec);
    d.lockerTransactions = (d.lockerTransactions ?? []).filter(t => t.receiptId !== receiptId);
    const before = advanceIds(d, patch.clientId ?? rec.clientId);

    rec.clientId = patch.clientId ?? rec.clientId;
    rec.amountUsd = r2(patch.amountUsd ?? rec.amountUsd);
    rec.date = patch.date ?? rec.date;
    rec.method = patch.method ?? rec.method;
    rec.remarks = patch.remarks !== undefined ? (patch.remarks.trim() || undefined) : rec.remarks;
    rec.lockerId = patch.lockerId !== undefined ? patch.lockerId : rec.lockerId;
    rec.lockerAmount = patch.lockerAmount !== undefined ? patch.lockerAmount : rec.lockerAmount;
    rec.lockerCurrency = patch.lockerCurrency !== undefined ? patch.lockerCurrency : rec.lockerCurrency;
    rec.exchangeRate = patch.exchangeRate !== undefined ? patch.exchangeRate : rec.exchangeRate;
    rec.invoiceId = patch.invoiceId !== undefined ? (patch.invoiceId || undefined) : rec.invoiceId;
    rec.updatedAt = new Date().toISOString();

    settleClientAccount(d, rec.clientId, rec.amountUsd, patch.userId, rec.date,
      rec.remarks || rec.method, rec.invoiceId);
    tagNewAdvances(d, rec.clientId, rec.id, before);
    if (rec.lockerId) {
      const locker = d.lockers.find(l => l.id === rec.lockerId);
      if (locker) {
        d.lockerTransactions.push({
          id: uid("ltx_"), lockerId: rec.lockerId, type: "income",
          amountInr: rec.lockerAmount ?? rec.amountUsd,
          currency: locker.currency || "INR",
          category: `Client Payment — ${d.clients.find(c => c.id === rec.clientId)?.companyName ?? "Client"}`,
          refType: "clientPayment", refId: rec.clientId, receiptId: rec.id,
          note: rec.remarks || rec.method,
          exchangeRate: rec.exchangeRate,
          recordedBy: patch.userId, createdAt: rec.date,
        });
      }
    }
  });
}

/** What cancelling a receipt will change, in plain words, for the confirmation. */
export function deleteImpact(db: DB, receiptId: string): string[] {
  const rec = (db.clientReceipts ?? []).find(r => r.id === receiptId);
  if (!rec) return [];
  const client = db.clients.find(c => c.id === rec.clientId);
  const applied = receiptApplied(db, receiptId);
  const out = [
    `• $${applied.toLocaleString()} comes back off ${client?.companyName ?? "the client"}'s orders — those bills will show as unpaid again`,
  ];
  if (rec.amountUsd > applied) {
    out.push(`• $${r2(rec.amountUsd - applied).toLocaleString()} of unused credit is removed from their account`);
  }
  if (rec.lockerId) {
    const locker = db.lockers.find(l => l.id === rec.lockerId);
    out.push(`• the deposit is removed from ${locker?.name ?? "the locker"} — its balance drops by that much`);
  }
  out.push("• nothing else changes — their other receipts and every other client stay exactly as they are");
  return out;
}

/**
 * Cancel a receipt: the money comes back off the orders, out of the locker and
 * off any unused credit, and the entry is removed. Used when a payment was
 * recorded that never actually happened (wrong client, entered twice).
 */
export function deleteReceipt(receiptId: string, userId: string): void {
  updateDb(d => {
    const rec = (d.clientReceipts ?? []).find(r => r.id === receiptId);
    if (!rec) return;
    unapply(d, rec);
    d.lockerTransactions = (d.lockerTransactions ?? []).filter(t => t.receiptId !== receiptId);
    d.clientReceipts = (d.clientReceipts ?? []).filter(r => r.id !== receiptId);
    // Re-spread what the client still has, so the remaining receipts settle
    // their bills in the right order again.
    settleClientAccount(d, rec.clientId, 0, userId, new Date().toISOString());
  });
}


// ── Repairing history ───────────────────────────────────────────────────────

export interface LegacyGroup {
  clientId: string;
  at: string;            // the exact timestamp the advances were written
  note: string;
  amount: number;
  orders: Order[];
  lockerTxnId?: string;
}

/**
 * Payments recorded before receipts existed are only advances on orders. One
 * payment wrote all of its advances inside a single save, so they share an
 * exact timestamp, note and recorder — that is what groups them back into the
 * payment they came from.
 */
export function legacyPayments(db: DB): LegacyGroup[] {
  const groups = new Map<string, LegacyGroup>();
  for (const o of db.orders) {
    for (const a of o.advances ?? []) {
      // Credit already receipted once and then moved onto a bill is not a
      // payment waiting for a number — offering it again would number the same
      // money twice.
      if (a.receiptId || a.fromCredit) continue;
      const key = `${o.clientId}|${a.createdAt}|${a.note}|${a.recordedBy}`;
      const g = groups.get(key);
      if (g) { g.amount = r2(g.amount + a.amount); if (!g.orders.includes(o)) g.orders.push(o); }
      else groups.set(key, { clientId: o.clientId, at: a.createdAt, note: a.note, amount: r2(a.amount), orders: [o] });
    }
  }
  const out = [...groups.values()];
  // Match each group to the locker deposit it was banked into, when there is one.
  for (const g of out) {
    const t = (db.lockerTransactions ?? []).find(x =>
      !x.receiptId && x.type === "income" && x.refType === "clientPayment" &&
      Math.abs(+new Date(x.createdAt) - +new Date(g.at)) < 1000);
    if (t) g.lockerTxnId = t.id;
  }
  return out.sort((a, b) => +new Date(a.at) - +new Date(b.at));
}

/**
 * Give every past payment a receipt number, oldest first, so the whole history
 * reads like the receipt book going forward.
 *
 * This is pure labelling: not one figure moves. The advances keep their amounts
 * and dates and are simply tagged with the receipt they belonged to, and an
 * existing locker deposit is linked rather than re-created.
 */
export async function backfillReceipts(userId: string): Promise<number> {
  const groups = legacyPayments(loadDb());
  if (!groups.length) return 0;
  // Numbers are reserved up front — one transaction each — before anything is
  // written, so a failure part-way cannot hand out a number twice.
  const numbers: string[] = [];
  for (let i = 0; i < groups.length; i++) {
    numbers.push(await reserveReceiptNumber(loadDb().clientReceipts ?? []));
    // Reserve against a growing list so successive calls can't repeat.
    const id = uid("rcpt_");
    const g = groups[i];
    updateDb(d => {
      if (!d.clientReceipts) d.clientReceipts = [];
      const txn = g.lockerTxnId ? (d.lockerTransactions ?? []).find(t => t.id === g.lockerTxnId) : undefined;
      d.clientReceipts.push({
        id, receiptNo: numbers[i],
        clientId: g.clientId,
        date: g.at,
        amountUsd: g.amount,
        lockerId: txn?.lockerId,
        lockerAmount: txn?.amountInr,
        lockerCurrency: txn?.currency,
        exchangeRate: txn?.exchangeRate,
        method: g.note || "Payment received",
        remarks: undefined,
        recordedBy: userId,
        createdAt: g.at,
      });
      for (const o of d.orders) {
        if (o.clientId !== g.clientId) continue;
        for (const a of o.advances ?? []) {
          if (!a.receiptId && a.createdAt === g.at && a.note === g.note) a.receiptId = id;
        }
      }
      if (txn) txn.receiptId = id;
    });
  }
  return groups.length;
}
