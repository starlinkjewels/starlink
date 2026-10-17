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
//
// What a receipt TOOK is read from the books, not assumed. Settling a payment
// against an invoice pools it with the credit the client already held, so the
// advances tagged to a receipt can add up to MORE than the receipt (it carried
// some of their credit onto the bills too) or LESS (the rest was left as
// credit). Taking a receipt back out therefore moves the client's credit by
// exactly the difference — what it borrowed goes back, what it left comes off —
// so their credit ends where it stood before the receipt was recorded.
import {
  loadDb, updateDb, updateDbAs, uid, settleClientAccount, balanceDue, dayOf, fmtMoney, invoiceOrderIds, collectionLoaded,
  type DB, type ClientReceipt, type Order, type AdvancePayment, type LockerTransaction,
} from "./db";
import { reserveReceiptNumber } from "./counters";
import { ccy, roundCcy, type CurrencyCode } from "./currency";
import { moveToDay } from "./moneyEntries";

const r2 = (n: number) => Math.round(n * 100) / 100;
/** Less than this is rounding, not money. */
const CENT = 0.005;
/** A deposit row written in the same save as its payment sits within this of it. */
const NEAR_MS = 5000;

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
 * The advances a receipt landed as, on its client's orders, in the order they
 * were filled: by when they were written, then down the invoice it was sent
 * for, then oldest order first. The last one is the most recent landing.
 */
function landings(d: DB, rec: ClientReceipt): { o: Order; a: AdvancePayment }[] {
  const inv = rec.invoiceId ? (d.invoices ?? []).find(i => i.id === rec.invoiceId) : undefined;
  const seq = inv ? invoiceOrderIds(inv) : [];
  const rank = (o: Order) => { const i = seq.indexOf(o.id); return i < 0 ? seq.length : i; };
  const t = (s?: string) => +new Date(s ?? "") || 0;
  const out: { o: Order; a: AdvancePayment }[] = [];
  for (const o of d.orders) {
    if (o.clientId !== rec.clientId) continue;
    for (const a of o.advances ?? []) if (a.receiptId === rec.id) out.push({ o, a });
  }
  return out.sort((x, y) => t(x.a.createdAt) - t(y.a.createdAt) || rank(x.o) - rank(y.o) || t(x.o.createdAt) - t(y.o.createdAt));
}

/** Ids of every advance a client has right now — the "before" picture. */
export function advanceIds(d: DB, clientId: string): Set<string> {
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

/** Why taking money back would leave bills paid with money that never came in. */
function creditUsedWhy(d: DB, rec: ClientReceipt, held: number, have: number): string {
  const name = d.clients.find(c => c.id === rec.clientId)?.companyName ?? "the client";
  return `Receipt ${rec.receiptNo} left ${fmtMoney(held)} on ${name}'s credit and only ${fmtMoney(have)} of their credit is still there — the rest has been used on bills since. Taking it back now would leave those bills paid with money that never came in.`;
}

/**
 * What a receipt's deposit holds beyond the receipt itself, in dollars. An
 * older payment taken over an order's balance (the order page, an invoice) was
 * numbered for what went on the order, while its deposit is all of it and the
 * rest went to the client's credit. Known for a dollar deposit, or one with
 * its rate on record; 0 when it can't be told, or is only a rate's rounding.
 *
 * Such a receipt isn't cancelled as it stands (whether that extra is the
 * client's credit can't be told for sure) — it is raised to its deposit first,
 * which only relabels: that money is already in the account and on credit.
 */
export function depositExcess(d: Pick<DB, "orders">, rec: ClientReceipt, rows: LockerTransaction[]): number {
  // Only one deposit, and only this client's: two rows on one receipt are old
  // duplicate data, and a row naming another client (an old repair linked
  // rows by the moment alone) is their money — neither is this extra.
  if (rows.length !== 1) return 0;
  const t0 = rows[0];
  const theirs = !!t0.refId && (t0.refId === rec.clientId || d.orders.some(o => o.id === t0.refId && o.clientId === rec.clientId));
  if (!theirs) return 0;
  let usd = 0;
  for (const t of rows) {
    if (ccy(t.currency) === "USD") { usd += t.amountInr; continue; }
    const rate = t.exchangeRate ?? rec.exchangeRate;
    if (!rate || !(rate > 0)) return 0;
    usd += t.amountInr / rate;
  }
  const over = r2(usd - rec.amountUsd);
  const allUsd = rows.every(t => ccy(t.currency) === "USD");
  return over > (allUsd ? CENT : Math.max(1, rec.amountUsd * 0.005)) ? over : 0;
}

/** Every row a receipt's deposit is: the one it names and any tagged, once each. */
export function depositRows(dep: Pick<ReceiptDeposit, "row" | "rows">): LockerTransaction[] {
  return [...new Map([...dep.rows, ...(dep.row ? [dep.row] : [])].map(t => [t.id, t])).values()];
}

/** Why a receipt whose deposit holds more than it can't be cancelled yet. */
function excessWhy(rec: ClientReceipt, excess: number): string {
  return `Receipt ${rec.receiptNo}'s deposit holds ${fmtMoney(excess)} more than the receipt — an older payment taken over a bill's balance, the rest put on the client's credit. Edit the receipt up by ${fmtMoney(excess)} first, so it covers its whole deposit (nothing else moves), then cancel it.`;
}

// ── The deposit a receipt landed as ─────────────────────────────────────────

export const UNLINKED_DEPOSIT = "This payment's account entry can't be told apart from another one (an older entry), so its amount, account and day stay as they are and it can't be cancelled — its remark and mode can still be corrected";

export interface ReceiptDeposit {
  /** The one deposit row: tagged with the receipt, or — on older data whose
   *  tag was never written — the one row that is unmistakably it. */
  row?: LockerTransaction;
  /** Every row tagged with the receipt (normally one). */
  rows: LockerTransaction[];
  /** `row` was found by matching, not by its tag: tag it when writing. */
  adopt?: boolean;
  /** Untagged client-payment entries for this client written alongside it. */
  nearby: number;
  /** Why the deposit can't be tied to the receipt for sure. Unset when it can,
   *  or when there plainly is none. */
  why?: string;
}

/**
 * Find a receipt's deposit row. Normally it carries the receipt's id. Older
 * rows may not, and then one is accepted only when nothing else could be it:
 * the same account, the same amount, written within seconds of the payment, a
 * client payment for this client and claimed by no other receipt. Anything
 * less certain is reported (`why`) instead of guessed — a wrong guess writes a
 * second deposit next to the real one, or moves somebody else's money.
 *
 * `hint` is what the payment row itself remembers (an order's advance names
 * its account and deposit); the receipt's own figures come first.
 */
export function receiptDeposit(
  db: Pick<DB, "lockerTransactions" | "orders">,
  rec: ClientReceipt,
  hint: { lockerId?: string; lockerAmount?: number; at?: string } = {},
): ReceiptDeposit {
  const txns = db.lockerTransactions ?? [];
  const rows = txns.filter(t => t.receiptId === rec.id);
  if (rows.length > 1) return { rows, nearby: 0, why: `Receipt ${rec.receiptNo} has ${rows.length} account entries — correct them in Payments → Account entries` };
  if (rows.length === 1) return { row: rows[0], rows, nearby: 0 };
  const lockerId = rec.lockerId ?? hint.lockerId;
  const amount = rec.lockerId ? rec.lockerAmount : (hint.lockerAmount ?? rec.lockerAmount);
  const theirs = new Set(db.orders.filter(o => o.clientId === rec.clientId).map(o => o.id));
  const times = [hint.at, rec.date].filter((s): s is string => !!s).map(s => +new Date(s));
  const nearby = txns.filter(t => !t.receiptId && t.type === "income" && t.refType === "clientPayment"
    && !!t.refId && (t.refId === rec.clientId || theirs.has(t.refId))
    && times.some(x => Math.abs(+new Date(t.createdAt) - x) <= NEAR_MS));
  const exact = lockerId && amount != null
    ? nearby.filter(t => t.lockerId === lockerId && Math.abs(t.amountInr - amount) < CENT)
    : [];
  if (exact.length === 1) return { row: exact[0], rows: [], adopt: true, nearby: nearby.length };
  return { rows: [], nearby: nearby.length, why: lockerId || nearby.length ? UNLINKED_DEPOSIT : undefined };
}

/** What a receipt's own advance remembers of its deposit — an order-page
 *  payment names its account and amount. Only when exactly one landing does. */
function depositHint(landed: { a: AdvancePayment }[]): { lockerId?: string; lockerAmount?: number; at?: string } {
  const named = landed.filter(x => x.a.lockerId);
  if (named.length !== 1) return {};
  const a = named[0].a;
  return { lockerId: a.lockerId, lockerAmount: a.lockerAmount, at: a.createdAt };
}

/** The same moment as `iso`, moved along with a payment whose date went from
 *  `from` to `to`: a stamp written with it takes the new one exactly; anything
 *  else keeps its time of day on the new day (the person's own day — dayOf). */
export function followDate(iso: string, from: string, to: string): string {
  if (from === to) return iso;
  if (iso === from) return to;
  const day = dayOf(to);
  if (!day || dayOf(iso) === day) return iso;
  return moveToDay(iso, day);
}

// How each screen writes a payment's note: the remark, or else the mode
// (Payments → Received); "mode · remark" (a client's page).
const shortNote = (method: string, remarks?: string) => remarks?.trim() || method;
const longNote = (method: string, remarks?: string) => (remarks?.trim() ? `${method} · ${remarks.trim()}` : method);
type NoteOf = { method: string; remarks?: string };
/** A note written from the receipt's mode and remark follows them; one typed separately stays. */
function followNote(n: string | undefined, was: NoteOf, now: NoteOf): string | undefined {
  if (n === undefined) return n;
  if (n === shortNote(was.method, was.remarks)) return shortNote(now.method, now.remarks);
  if (n === longNote(was.method, was.remarks)) return longNote(now.method, now.remarks);
  return n;
}

// ── Recording ───────────────────────────────────────────────────────────────

export interface ReceiptInput {
  clientId: string;
  amountUsd: number;
  date: string;              // ISO
  method: string;
  remarks?: string;
  lockerId?: string;
  /** What landed in the locker, in the locker's own currency. */
  lockerAmount?: number;
  lockerCurrency?: CurrencyCode;
  /** The locker's currency for $1 (₹83.5, A$1.52…) when the locker isn't USD:
   *  lockerAmount = amountUsd × this. */
  exchangeRate?: number;
  invoiceId?: string;
  userId: string;
}

/**
 * The writing half of createReceipt(): add the receipt, settle the client's
 * account with it, tag what that created, and write the deposit. Call inside
 * updateDb().
 */
export function recordReceipt(d: DB, receipt: ClientReceipt, input: ReceiptInput): void {
  if (!d.clientReceipts) d.clientReceipts = [];
  d.clientReceipts.push(receipt);
  const before = advanceIds(d, input.clientId);
  settleClientAccount(d, input.clientId, receipt.amountUsd, input.userId, input.date,
    input.remarks?.trim() || input.method, input.invoiceId);
  tagNewAdvances(d, input.clientId, receipt.id, before);
  if (input.lockerId) {
    const locker = d.lockers.find(l => l.id === input.lockerId);
    if (locker) {
      if (!d.lockerTransactions) d.lockerTransactions = [];
      d.lockerTransactions.push({
        id: uid("ltx_"), lockerId: input.lockerId, type: "income",
        amountInr: input.lockerAmount ?? receipt.amountUsd,
        currency: ccy(locker.currency),
        category: `Client Payment — ${d.clients.find(c => c.id === input.clientId)?.companyName ?? "Client"}`,
        refType: "clientPayment", refId: input.clientId, receiptId: receipt.id,
        note: input.remarks?.trim() || input.method,
        exchangeRate: input.exchangeRate,
        recordedBy: input.userId, createdAt: input.date,
      });
    }
  }
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
  // The receipt names the currency its deposit row is written in — the
  // locker's own — so the two can never disagree.
  const depositLocker = input.lockerId ? loadDb().lockers.find(l => l.id === input.lockerId) : undefined;
  const receipt: ClientReceipt = {
    id, receiptNo,
    clientId: input.clientId,
    date: input.date,
    amountUsd: r2(input.amountUsd),
    lockerId: input.lockerId,
    lockerAmount: input.lockerAmount,
    lockerCurrency: depositLocker ? ccy(depositLocker.currency) : input.lockerCurrency,
    exchangeRate: input.exchangeRate,
    method: input.method,
    remarks: input.remarks,
    invoiceId: input.invoiceId,
    recordedBy: input.userId,
    createdAt: now,
  };
  updateDb(d => recordReceipt(d, receipt, input));
  return receipt;
}

export interface AdvanceReceiptArgs {
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
}

/** The writing half of receiptForAdvance(). Call inside updateDb(). */
export function numberPayment(d: DB, id: string, receiptNo: string, args: AdvanceReceiptArgs, createdAt: string): ClientReceipt {
  const ids = new Set(args.advanceIds);
  const txn = args.lockerTxnId ? (d.lockerTransactions ?? []).find(t => t.id === args.lockerTxnId) : undefined;
  const receipt: ClientReceipt = {
    id, receiptNo,
    clientId: args.clientId,
    date: args.date,
    amountUsd: r2(args.amountUsd),
    lockerId: txn?.lockerId,
    lockerAmount: txn?.amountInr,
    // A row with no currency is a rupee row (made before lockers held others).
    lockerCurrency: txn ? ccy(txn.currency) : undefined,
    exchangeRate: txn?.exchangeRate,
    method: args.method,
    remarks: args.remarks?.trim() || undefined,
    recordedBy: args.userId,
    createdAt,
  };
  if (!d.clientReceipts) d.clientReceipts = [];
  d.clientReceipts.push(receipt);
  for (const o of d.orders) {
    if (o.clientId !== args.clientId) continue;
    for (const a of o.advances ?? []) if (ids.has(a.id)) a.receiptId = id;
  }
  if (txn) txn.receiptId = id;
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
export async function receiptForAdvance(args: AdvanceReceiptArgs): Promise<ClientReceipt> {
  const receiptNo = await reserveReceiptNumber(loadDb().clientReceipts ?? []);
  const id = uid("rcpt_");
  let receipt!: ClientReceipt;
  updateDb(d => { receipt = numberPayment(d, id, receiptNo, args, new Date().toISOString()); });
  return receipt;
}

// ── Correcting ──────────────────────────────────────────────────────────────

/** A correction to a receipt. Anything left out stays as it is. */
export interface ReceiptEdit {
  amountUsd?: number;
  date?: string;             // ISO
  method?: string;
  remarks?: string;
  /** The account it landed in. Leave the key out to keep it; present but empty
   *  ("", null or undefined) means No account — its deposit row goes. */
  lockerId?: string | null;
  /** What lands in that account, in its own currency. */
  lockerAmount?: number;
  lockerCurrency?: CurrencyCode;
  /** That account's currency for $1, when it isn't USD. */
  exchangeRate?: number;
  /** Not changeable: another client or invoice is another payment — cancel
   *  the receipt and record it again. Refused when it differs. */
  clientId?: string;
  invoiceId?: string;
  userId: string;
}

type Plan = { why: string } | { apply: () => void };

/**
 * Work out a correction completely before anything is written: every refusal
 * is found here, and only then does apply() change the records — so a refused
 * correction leaves nothing half done (in the cache or anywhere else).
 *
 * In place, never re-allocated:
 *  • date, mode, remarks — patched on the receipt, the advances it landed as
 *    and its deposit row (the same row, keeping its voucher);
 *  • a higher amount goes onto the SAME orders, in the order it filled them,
 *    up to what each still owes; only what is over goes to the client's credit;
 *  • a lower amount comes off the credit it left first, then off its most
 *    recent landing backwards;
 *  • another account: the same row moves (its currency's rate rules apply);
 *    No account removes the row.
 */
function planEdit(d: DB, receiptId: string, patch: ReceiptEdit): Plan {
  const rec = (d.clientReceipts ?? []).find(r => r.id === receiptId);
  if (!rec) return { why: "That receipt is no longer on record." };
  if (patch.clientId !== undefined && patch.clientId !== rec.clientId)
    return { why: `A receipt can't be moved to another client — cancel receipt ${rec.receiptNo} and record the payment again under the right one.` };
  if (patch.invoiceId !== undefined && (patch.invoiceId || undefined) !== rec.invoiceId)
    return { why: `The invoice a receipt was sent for can't be changed — cancel receipt ${rec.receiptNo} and record it again.` };
  const amount = r2(patch.amountUsd ?? rec.amountUsd);
  if (!(amount > 0)) return { why: "Enter a valid amount." };
  const date = patch.date || rec.date;
  if (isNaN(+new Date(date))) return { why: "Pick a valid date." };
  const method = patch.method?.trim() || rec.method;
  const remarks = patch.remarks !== undefined ? (patch.remarks.trim() || undefined) : rec.remarks;

  const client = d.clients.find(c => c.id === rec.clientId);
  const have = client?.creditBalance || 0;
  const landed = landings(d, rec);
  const applied = r2(landed.reduce((s, x) => s + x.a.amount, 0));
  const change = r2(amount - rec.amountUsd);
  // Found from the receipt's own figures only — they are what this screen
  // shows. An account named just by the advance (older data) is never acted
  // on here; it only stops a second deposit being written beside it.
  const dep = receiptDeposit(d, rec);
  // An older receipt for less than its deposit (the rest already on credit):
  // raising it up to the deposit only relabels — that money is in the account
  // and on credit already, so neither moves. Only a raise past it is new money.
  const relabel = change > 0 ? Math.min(change, depositExcess(d, rec, depositRows(dep))) : 0;
  const moved = r2(change - relabel);

  // ── The money ──
  const next = new Map<AdvancePayment, number>();
  let toCredit = 0;
  if (moved > 0) {
    let left = moved;
    const room = new Map<Order, number>();
    for (const { o, a } of landed) {
      if (left < CENT) break;
      if (o.status === "Rejected") continue;
      const free = room.has(o) ? room.get(o)! : balanceDue(o);
      const put = r2(Math.min(left, free));
      if (put < CENT) continue;
      next.set(a, r2((next.get(a) ?? a.amount) + put));
      room.set(o, r2(free - put));
      left = r2(left - put);
    }
    toCredit = left;
  } else if (change < 0) {
    let need = -change;
    // What it left as credit goes first — if it is still there.
    const held = Math.max(0, r2(rec.amountUsd - applied));
    const offCredit = r2(Math.min(need, held, have));
    toCredit = -offCredit;
    need = r2(need - offCredit);
    for (let i = landed.length - 1; i >= 0 && need >= CENT; i--) {
      const a = landed[i].a;
      const cut = r2(Math.min(need, a.amount));
      next.set(a, r2(a.amount - cut));
      need = r2(need - cut);
    }
    if (need >= CENT) {
      return { why: `Receipt ${rec.receiptNo} can come down by at most ${fmtMoney(r2(-change - need))} — ${fmtMoney(r2(held - have))} of the ${fmtMoney(held)} it left as credit has been used on bills since.` };
    }
  }

  // ── The deposit ──
  const hinted = depositHint(landed).lockerId;
  const row = dep.row;
  const curLocker = row ? row.lockerId : rec.lockerId;
  const curCcy = row ? ccy(row.currency) : ccy(rec.lockerCurrency ?? d.lockers.find(l => l.id === rec.lockerId)?.currency);
  const curAmount = row ? row.amountInr : rec.lockerAmount;
  const curRate = rec.exchangeRate ?? row?.exchangeRate;
  const lockerId = "lockerId" in patch ? (patch.lockerId || undefined) : curLocker;
  let target: { lockerId: string; ccy: CurrencyCode; amount: number; rate?: number } | undefined;
  if (lockerId) {
    const locker = d.lockers.find(l => l.id === lockerId);
    if (!locker) return { why: "That account is not there any more — pick another." };
    const lc = ccy(locker.currency);
    if (patch.lockerCurrency && ccy(patch.lockerCurrency) !== lc)
      return { why: `${locker.name} holds ${lc}, not ${ccy(patch.lockerCurrency)} — pick the account again.` };
    if (lc === "USD") {
      // What landed is its own figure — a wire fee can leave less than the
      // receipt says, and an older receipt can be for less than its deposit.
      // In a dollar account it stands as it is; a changed amount moves it by
      // the change, unless a figure is given for it.
      const givenLands = patch.lockerAmount && patch.lockerAmount > 0 ? r2(patch.lockerAmount) : undefined;
      const held = curLocker && curCcy === "USD" && curAmount != null ? curAmount : undefined;
      const lands = givenLands ?? (held != null ? r2(held + moved) : amount);
      if (lands < CENT) return { why: `What landed in ${locker.name} would come to ${fmtMoney(lands)} — check the amount.` };
      target = { lockerId, ccy: lc, amount: lands };
    } else {
      const sameCcy = !!curLocker && curCcy === lc;
      const landedAt = curAmount && rec.amountUsd > 0 ? curAmount / rec.amountUsd : undefined;
      const givenRate = patch.exchangeRate && patch.exchangeRate > 0 ? patch.exchangeRate : undefined;
      const givenLands = patch.lockerAmount && patch.lockerAmount > 0 ? patch.lockerAmount : undefined;
      const isCurRate = (x: number) => [curRate, landedAt].some(c => !!c && Math.abs(x - c) <= c * 1e-9);
      if (sameCcy && moved === 0 && curAmount
        && (givenRate ? isCurRate(givenRate) : !givenLands || Math.abs(givenLands - curAmount) < CENT)) {
        // Nothing about what landed changed (the same dollars at the same
        // rate): it stands to the paisa, never re-worked through rounding.
        target = { lockerId, ccy: lc, amount: curAmount, rate: curRate };
      } else {
        let rate = givenRate, lands = givenLands;
        if (!rate && !lands) {
          // Nothing typed for it. In the same currency, the rate it landed at;
          // in another there is no rate to go on.
          const was = curRate || landedAt;
          if (!sameCcy || !was) return { why: `${locker.name} is in ${lc} — enter the exchange rate for it.` };
          rate = was;
        }
        if (!lands) {
          // A deposit that is the receipt at its rate is re-worked at that
          // rate. One that holds more than the receipt (an older overpayment,
          // the rest of it the client's credit) moves by the change only, so
          // that extra is never re-priced away. A new rate prices it afresh.
          const matches = !curAmount || Math.abs(curAmount - rec.amountUsd * rate!) <= Math.max(1, rec.amountUsd * rate! * 0.002);
          lands = sameCcy && curAmount && isCurRate(rate!) && !matches
            ? roundCcy(curAmount + moved * rate!, lc)
            : roundCcy(amount * rate!, lc);
          if (lands < CENT) return { why: `What landed in ${locker.name} would come to nothing — check the amount.` };
        } else if (rate && Math.abs(lands - amount * rate) > Math.max(1, amount * rate * 0.002))
          return { why: `What lands in ${locker.name} doesn't match ${fmtMoney(amount)} at that rate — check the exchange rate.` };
        target = { lockerId, ccy: lc, amount: lands, rate };
      }
    }
  }
  const sameDeposit = target
    ? !!curLocker && target.lockerId === curLocker && target.ccy === curCcy && curAmount != null && Math.abs(target.amount - curAmount) < CENT
    : !curLocker;
  const touchesDeposit = !sameDeposit || (date !== rec.date && !!curLocker);
  if (touchesDeposit && !row) {
    // It names an account but its row can't be found for sure, or a row for
    // this client sits right beside it: writing would leave two deposits.
    if (dep.rows.length > 1 || curLocker || (target && (dep.nearby > 0 || hinted))) return { why: dep.why ?? UNLINKED_DEPOSIT };
  }

  return {
    apply: () => {
      // 1. The money, on the same orders.
      const emptied = new Set<AdvancePayment>();
      for (const [a, v] of next) { if (v < CENT) emptied.add(a); else a.amount = v; }
      if (emptied.size) {
        for (const { o } of landed) if (o.advances?.some(a => emptied.has(a))) o.advances = o.advances.filter(a => !emptied.has(a));
      }
      if (toCredit && client) {
        const c = r2(have + toCredit);
        client.creditBalance = c > 0 ? c : undefined;
      }
      // 2. What it says, and when.
      const was = { method: rec.method, remarks: rec.remarks };
      const now = { method, remarks };
      for (const { a } of landed) {
        if (emptied.has(a)) continue;
        a.note = followNote(a.note, was, now) ?? a.note;
        a.createdAt = followDate(a.createdAt, rec.date, date);
      }
      // 3. The deposit — the same row, so it keeps its voucher.
      if (row) {
        if (target) {
          if (dep.adopt) row.receiptId = rec.id;
          if (!sameDeposit) {
            row.lockerId = target.lockerId;
            row.amountInr = target.amount;
            if (ccy(row.currency) !== target.ccy) row.currency = target.ccy;
            row.exchangeRate = target.ccy === "USD" ? undefined : target.rate;
          }
          row.createdAt = followDate(row.createdAt, rec.date, date);
          row.note = followNote(row.note, was, now);
        } else {
          // No account: the deposit goes (intent-based — only this row).
          d.lockerTransactions = (d.lockerTransactions ?? []).filter(t => t.id !== row.id);
        }
      } else if (target && !sameDeposit) {
        // Only reached when it had no account and nothing unlinked sits beside
        // it (planned above) — a first deposit, not a second one.
        if (!d.lockerTransactions) d.lockerTransactions = [];
        d.lockerTransactions.push({
          id: uid("ltx_"), lockerId: target.lockerId, type: "income",
          amountInr: target.amount, currency: target.ccy,
          category: `Client Payment — ${client?.companyName ?? "Client"}`,
          refType: "clientPayment", refId: rec.clientId, receiptId: rec.id,
          note: shortNote(method, remarks),
          exchangeRate: target.ccy === "USD" ? undefined : target.rate,
          recordedBy: patch.userId, createdAt: date,
        });
      }
      // 4. The receipt itself — its number never changes.
      rec.amountUsd = amount;
      rec.date = date;
      rec.method = method;
      rec.remarks = remarks;
      if (!sameDeposit) {
        rec.lockerId = target?.lockerId;
        rec.lockerAmount = target?.amount;
        rec.lockerCurrency = target?.ccy;
        rec.exchangeRate = target && target.ccy !== "USD" ? target.rate : undefined;
      }
      rec.updatedAt = new Date().toISOString();
    },
  };
}

/** Why this correction can't be made; undefined when it can. Changes nothing. */
export function receiptEditBlocker(db: DB, receiptId: string, patch: ReceiptEdit): string | undefined {
  const plan = planEdit(db, receiptId, patch);
  return "why" in plan ? plan.why : undefined;
}

/** Make a correction (inside updateDb). Returns why it was refused — and then
 *  nothing has been touched — or undefined once it is made. */
export function applyReceiptEdit(d: DB, receiptId: string, patch: ReceiptEdit): string | undefined {
  const plan = planEdit(d, receiptId, patch);
  if ("why" in plan) return plan.why;
  plan.apply();
  return undefined;
}

function needLoaded(): void {
  if (!collectionLoaded("clientReceipts") || !collectionLoaded("lockerTransactions"))
    throw new Error("Still loading the receipts and account entries — try again in a moment.");
}

/**
 * Correct a receipt, in place (see planEdit): the money stays on the orders it
 * paid, the deposit keeps its row and voucher, and the receipt NUMBER never
 * changes. Throws, having changed nothing, when it can't be done — the
 * message says why.
 */
export function editReceipt(receiptId: string, patch: ReceiptEdit): void {
  needLoaded();
  const why = receiptEditBlocker(loadDb(), receiptId, patch);
  if (why) throw new Error(why);
  let refused: string | undefined;
  updateDbAs({ summary: `Corrected receipt ${receiptLabel(receiptId)}` }, d => { refused = applyReceiptEdit(d, receiptId, patch); });
  if (refused) throw new Error(refused);
}

/** "0871 — Acme Jewels, $1,200": how a receipt reads in the activity log. */
function receiptLabel(receiptId: string): string {
  const db = loadDb();
  const rec = (db.clientReceipts ?? []).find(r => r.id === receiptId);
  if (!rec) return "";
  const client = db.clients.find(c => c.id === rec.clientId)?.companyName ?? "client";
  return `${rec.receiptNo} — ${client}, $${rec.amountUsd.toLocaleString()}`;
}

// ── Cancelling ──────────────────────────────────────────────────────────────

/**
 * Take a receipt back out completely. Its advances come off the orders; the
 * client's credit moves by the difference between those and the receipt —
 * up by what it carried of their existing credit onto bills, down by what it
 * left as credit — so it ends where it stood before the receipt. Refused when
 * the credit it left has been spent since (the bills it paid would be left
 * paid with money that never came in), or when it names an account entry that
 * can't be told apart from its neighbours.
 */
function planCancel(d: DB, receiptId: string, userId: string, at: string): Plan {
  const rec = (d.clientReceipts ?? []).find(r => r.id === receiptId);
  if (!rec) return { why: "That receipt is no longer on record." };
  const landed = landings(d, rec);
  const applied = r2(landed.reduce((s, x) => s + x.a.amount, 0));
  const client = d.clients.find(c => c.id === rec.clientId);
  const have = client?.creditBalance || 0;
  // Its deposit goes with it: the tagged row, or the one older row that is
  // unmistakably it. One it names but can't be told apart from its neighbours
  // is refused, not guessed at.
  const hint = depositHint(landed);
  const dep = receiptDeposit(d, rec, hint);
  if (!dep.row && !dep.rows.length && (rec.lockerId ?? hint.lockerId) && dep.nearby > 0) return { why: UNLINKED_DEPOSIT };
  const dropRows = depositRows(dep);
  const drop = new Set(dropRows.map(t => t.id));
  // A deposit holding more than the receipt (an older overpayment): taking it
  // out would leave the client credit for money no longer in the account, and
  // taking that credit too would be a guess — raised first, it cancels whole.
  const excess = depositExcess(d, rec, dropRows);
  if (excess > 0) return { why: excessWhy(rec, excess) };
  const after = r2(have + applied - rec.amountUsd);
  if (after < -CENT) return { why: creditUsedWhy(d, rec, r2(rec.amountUsd - applied), have) };
  return {
    apply: () => {
      const gone = new Set(landed.map(x => x.a));
      for (const o of d.orders) {
        if (o.clientId === rec.clientId && o.advances?.some(a => gone.has(a))) o.advances = o.advances.filter(a => !gone.has(a));
      }
      if (client) client.creditBalance = after > 0 ? after : undefined;
      if (drop.size) d.lockerTransactions = (d.lockerTransactions ?? []).filter(t => !drop.has(t.id));
      d.clientReceipts = (d.clientReceipts ?? []).filter(r => r.id !== rec.id);
      // Trims any order now holding more than it is worth back to credit;
      // allocates nothing (no invoice named).
      settleClientAccount(d, rec.clientId, 0, userId, at);
    },
  };
}

/** Why a receipt can't be cancelled; undefined when it can. Changes nothing. */
export function receiptCancelBlocker(db: DB, receiptId: string): string | undefined {
  const plan = planCancel(db, receiptId, "", "");
  return "why" in plan ? plan.why : undefined;
}

/** Cancel a receipt (inside updateDb). Returns why it was refused — and then
 *  nothing has been touched — or undefined once it is done. */
export function cancelReceipt(d: DB, receiptId: string, userId: string, at: string): string | undefined {
  const plan = planCancel(d, receiptId, userId, at);
  if ("why" in plan) return plan.why;
  plan.apply();
  return undefined;
}

/** What cancelling a receipt will change, in plain words, for the confirmation. */
export function deleteImpact(db: DB, receiptId: string): string[] {
  const rec = (db.clientReceipts ?? []).find(r => r.id === receiptId);
  if (!rec) return [];
  const client = db.clients.find(c => c.id === rec.clientId);
  const landed = landings(db, rec);
  const applied = r2(landed.reduce((s, x) => s + x.a.amount, 0));
  const out: string[] = [];
  const why = receiptCancelBlocker(db, receiptId);
  if (why) out.push(`• It can't be cancelled as things stand: ${why}`);
  out.push(`• $${applied.toLocaleString()} comes back off ${client?.companyName ?? "the client"}'s orders — those bills will show as unpaid again`);
  const hint = depositHint(landed);
  const dep = receiptDeposit(db, rec, hint);
  const left = r2(rec.amountUsd - applied);
  if (left < -CENT) {
    out.push(`• $${(-left).toLocaleString()} of credit they already had, which this receipt carried onto those bills, goes back to their credit`);
  } else if (left > CENT) {
    out.push(`• $${left.toLocaleString()} of unused credit is removed from their account`);
  }
  const row = dep.row ?? dep.rows[0];
  if (row) {
    const locker = db.lockers.find(l => l.id === row.lockerId);
    out.push(`• the deposit is removed from ${locker?.name ?? "the locker"} — its balance drops by that much`);
  } else if (rec.lockerId ?? hint.lockerId) {
    const locker = db.lockers.find(l => l.id === (rec.lockerId ?? hint.lockerId));
    out.push(`• no account entry is linked to it, so nothing comes out of ${locker?.name ?? "the account"}`);
  }
  out.push("• nothing else changes — their other receipts and every other client stay exactly as they are");
  return out;
}

/**
 * Cancel a receipt: the money comes back off the orders, out of the locker and
 * off any unused credit, and the entry is removed. Used when a payment was
 * recorded that never actually happened (wrong client, entered twice). Throws,
 * having changed nothing, when it can't be done — the message says why.
 */
export function deleteReceipt(receiptId: string, userId: string): void {
  needLoaded();
  const why = receiptCancelBlocker(loadDb(), receiptId);
  if (why) throw new Error(why);
  let refused: string | undefined;
  updateDbAs({ summary: `Cancelled receipt ${receiptLabel(receiptId)}` }, d => {
    refused = cancelReceipt(d, receiptId, userId, new Date().toISOString());
  });
  if (refused) throw new Error(refused);
}


// ── Repairing history ───────────────────────────────────────────────────────

export interface LegacyGroup {
  clientId: string;
  at: string;            // the exact timestamp the advances were written
  note: string;
  recordedBy?: string;
  amount: number;
  orders: Order[];
  lockerTxnId?: string;
}

/** The advances one legacy payment wrote — the same test that grouped them. */
const ofGroup = (g: Pick<LegacyGroup, "clientId" | "at" | "note" | "recordedBy">, clientId: string, a: AdvancePayment) =>
  !a.receiptId && !a.fromCredit && clientId === g.clientId && a.createdAt === g.at && a.note === g.note && a.recordedBy === g.recordedBy;

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
      else groups.set(key, { clientId: o.clientId, at: a.createdAt, note: a.note, recordedBy: a.recordedBy, amount: r2(a.amount), orders: [o] });
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
 * The writing half of backfillReceipts() for one past payment (inside
 * updateDb). The receipt's amount is what it actually tags — read here, not
 * carried from when the list was made — so a receipt always equals its
 * advances and cancelling it later moves nobody's credit. Returns false (and
 * writes nothing) when the payment has been numbered meanwhile.
 */
export function numberLegacyPayment(d: DB, g: LegacyGroup, id: string, receiptNo: string, userId: string): boolean {
  const mine: AdvancePayment[] = [];
  for (const o of d.orders) for (const a of o.advances ?? []) if (ofGroup(g, o.clientId, a)) mine.push(a);
  const amount = r2(mine.reduce((s, a) => s + a.amount, 0));
  if (!mine.length || !(amount > 0)) return false;
  const txn = g.lockerTxnId ? (d.lockerTransactions ?? []).find(t => t.id === g.lockerTxnId && !t.receiptId) : undefined;
  if (!d.clientReceipts) d.clientReceipts = [];
  d.clientReceipts.push({
    id, receiptNo,
    clientId: g.clientId,
    date: g.at,
    amountUsd: amount,
    lockerId: txn?.lockerId,
    lockerAmount: txn?.amountInr,
    lockerCurrency: txn ? ccy(txn.currency) : undefined,
    exchangeRate: txn?.exchangeRate,
    method: g.note || "Payment received",
    remarks: undefined,
    recordedBy: userId,
    createdAt: g.at,
  });
  for (const a of mine) a.receiptId = id;
  if (txn) txn.receiptId = id;
  return true;
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
  // Each number is reserved (one transaction each) before its receipt is
  // written, so a failure part-way cannot hand out a number twice.
  let done = 0;
  for (const g of groups) {
    const receiptNo = await reserveReceiptNumber(loadDb().clientReceipts ?? []);
    const id = uid("rcpt_");
    let wrote = false;
    updateDb(d => { wrote = numberLegacyPayment(d, g, id, receiptNo, userId); });
    if (wrote) done++;
  }
  return done;
}
