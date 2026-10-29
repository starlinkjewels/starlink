// Every payment that is NOT a client receipt, in one shape so one table can
// list them and one pair of functions can correct or cancel them.
//
// Each of these is really two things: the entry against the party (a payment on
// a purchase, on a factory's making charges, an expense record) and the matching
// movement in the account it came out of. Correcting one without the other is
// how a locker balance and a supplier's due drift apart, so both sides move
// together here or neither does.
//
// Client receipts are deliberately NOT here — they allocate across a client's
// orders and have their own engine (src/lib/receipts.ts).
import { loadDb, updateDb, uid, collectionsFresh, ensureCollections, fmtDate, fmtMoney, dayOf, type DB, type Expense, type LockerTransaction } from "./db";
import { ccy, fmtCcy, rateFields, rateOf, roundCcy, type CurrencyCode } from "./currency";
import type { LazyCol } from "./pageData";
import { undoClientRefund } from "./clientRefunds";

export type EntryKind = "supplier" | "factory" | "expense" | "locker";

/** Where an account movement was actually recorded, so a row that cannot be
 *  corrected here can say where it can be. "locked" on its own told nobody
 *  anything, and it was not obvious why one row had Edit and the next did not. */
const RECORDED_IN: Record<string, string> = {
  purchase: "Supplier Payments",
  supplierReceipt: "Supplier Payments",
  materialIssuance: "Factory Payments",
  expense: "Expenses",
  clientPayment: "Payments Received",
  diamondSale: "Buy & Assign",
};

/** The tab each kind of party entry is corrected in. */
const TAB: Record<Exclude<EntryKind, "locker">, string> = {
  supplier: "Supplier Payments",
  factory: "Factory Payments",
  expense: "Expenses",
};

/**
 * The on-demand records listEntries() reads for each kind. A page must have
 * them before it lists — read before they arrive, a supplier's payment would
 * look like nobody's, and its account row would be offered for editing on its
 * own. See src/hooks/useLoaded.ts.
 */
export const ENTRY_COLS: Record<EntryKind, (LazyCol | "expenses")[]> = {
  supplier: ["lockerTransactions", "purchases", "supplierReceipts", "supplierPayments"],
  factory: ["lockerTransactions", "materialIssuances", "factoryPayments"],
  // Expenses arrive at sign-in, but not in the first moment: read before they
  // have, every expense's account row would look like its expense was gone.
  expense: ["lockerTransactions", "expenses"],
  locker: ["lockerTransactions", "purchases", "supplierReceipts", "supplierPayments", "materialIssuances", "factoryPayments", "diamondSales", "expenses"],
};

export interface MoneyEntry {
  id: string;             // the payment/expense/transaction id
  kind: EntryKind;
  date: string;
  party: string;          // supplier / factory / expense title / locker category
  against?: string;       // which bill it settles — invoice #, order #, category
  amount: number;         // in `currency`
  currency: CurrencyCode;
  lockerId?: string;
  note?: string;
  direction: "in" | "out";
  /** False when this row can't be safely corrected from here, with the reason. */
  locked?: string;
  /** The tab that DOES own this row, when another one does. */
  lockedWhere?: string;
  /** What the menu says for a locked row, when "Edit in …" is not what is
   *  done there — a diamond sale is cancelled, not edited. */
  lockedLabel?: string;
  /** The supplier or factory, for a link to their page. */
  partyId?: string;
  /** The account movement(s) this entry was matched to when it was listed —
   *  corrected and cancelled together with it. Empty: none was found. */
  txnIds?: string[];
  /** What those movements add up to, when it is not `amount` — the bills and
   *  the account disagree, and both sides are shown before anything changes. */
  txnAmount?: number;
  /** Paid from an account, but no movement for it was found there. Corrected
   *  here it changes the party's books only; the account is left as it is. */
  noTxn?: boolean;
  /** An account row whose entry is gone (or no longer matches it): why it is
   *  corrected here, on its own, rather than from the tab that made it. */
  orphan?: string;
  /** An account row that is merely not linked to anything (an older row, or
   *  one shared by two entries) — its record may well still be on file. What
   *  the person is told, and must confirm, before it is deleted on its own. */
  unlinked?: string;
  /** Voucher number, for a cash entry that has one. */
  voucherNo?: string;
  /** True for a locker-to-locker transfer: editing it moves both legs. */
  transfer?: boolean;
  /** When one payment was split across several bills, the id of every part.
   *  The row is the payment as it was made; these are where it landed. */
  legIds?: string[];
  /** The bills that payment covered, for the dialog to spell out. */
  legLabels?: string[];
  /** A refund paid back to a client: who, and the dollars it took off their
   *  credit — put back when it is cancelled (lib/clientRefunds.ts). */
  refundTo?: string;
  refundUsd?: number;
}

/**
 * One payment, however many bills it settled.
 *
 * Paying ₹2,41,200 against six bills used to draw six rows, because the money
 * was stored as six allocations. Nobody hands over six amounts — the day book
 * has one line, and a ledger that cannot be laid beside the day book is no use
 * for checking the day's cash. Parts written in the same save, to the same
 * account, for the same party are that one payment; the split stays inside the
 * bills, where the allocation belongs, and is named in Against.
 */
type Leg = { key: string; at: string; lockerId?: string; note?: string; amount: number; id: string; label?: string; party: string; partyId: string };
type LegGroup = { ids: string[]; labels: string[]; at: string; lockerId?: string; note?: string; amount: number; party: string; partyId: string };

function groupLegs(legs: Leg[]): LegGroup[] {
  const byKey = new Map<string, LegGroup>();
  for (const l of legs) {
    const g = byKey.get(l.key);
    if (!g) {
      byKey.set(l.key, {
        ids: [l.id], labels: l.label ? [l.label] : [], at: l.at,
        lockerId: l.lockerId, note: l.note, amount: l.amount, party: l.party, partyId: l.partyId,
      });
    } else {
      g.ids.push(l.id);
      if (l.label && !g.labels.includes(l.label)) g.labels.push(l.label);
      g.amount = Math.round((g.amount + l.amount) * 100) / 100;
      // A note typed once is attached to every part; keep the first non-empty.
      if (!g.note && l.note) g.note = l.note;
    }
  }
  return [...byKey.values()];
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/** The same moment moved to another day (as the person reads days — dayOf,
 *  their own clock, not UTC: slicing the stored timestamp gave the day before
 *  for anything entered in the small hours in India), time of day kept.
 *  Unchanged when the day is — so a row matched to its payment by the moment
 *  never drifts. */
export function moveToDay(iso: string, day: string): string {
  if (!day || day === dayOf(iso)) return iso;
  const [y, m, dd] = day.split("-").map(Number);
  const d = new Date(iso);
  if (isNaN(+d)) return new Date(y, (m || 1) - 1, dd || 1).toISOString();
  d.setFullYear(y, (m || 1) - 1, dd || 1);
  return d.toISOString();
}

/** Written in the same save: a payment and its account movement share the moment. */
const SAME_SAVE_MS = 1500;
const near = (a: string, b: string, ms = SAME_SAVE_MS) => Math.abs(+new Date(a) - +new Date(b)) < ms;

/** The account movement that belongs to one entry. Newer rows carry `paymentId`
 *  (an expense's, its `refId`); older ones are matched on account + amount +
 *  the second they were written. Used for an entry that was not listed. */
function pairedTxn(db: DB, entryId: string, at: string, lockerId?: string, amount?: number) {
  const txns = db.lockerTransactions ?? [];
  return txns.find(t => t.paymentId === entryId)
    ?? txns.find(t => t.refType === "expense" && t.refId === entryId)
    ?? txns.find(t =>
      !t.paymentId && t.lockerId === lockerId && Math.abs(t.amountInr - (amount ?? 0)) < 0.01
      && near(t.createdAt, at));
}

/** The account rows, looked up three ways, built once per listing. */
interface TxnIndex {
  byPayment: Map<string, LockerTransaction[]>;
  byExpense: Map<string, LockerTransaction[]>;
  byLocker: Map<string, LockerTransaction[]>;
}
function indexTxns(db: DB): TxnIndex {
  const idx: TxnIndex = { byPayment: new Map(), byExpense: new Map(), byLocker: new Map() };
  const add = (m: Map<string, LockerTransaction[]>, k: string, t: LockerTransaction) => {
    const l = m.get(k);
    if (l) l.push(t); else m.set(k, [t]);
  };
  for (const t of db.lockerTransactions ?? []) {
    if (t.paymentId) add(idx.byPayment, t.paymentId, t);
    if (t.refType === "expense" && t.refId) add(idx.byExpense, t.refId, t);
    add(idx.byLocker, t.lockerId, t);
  }
  return idx;
}

/** The kinds of account row each party's money is written as, so a match
 *  never borrows a row that belongs to another kind of entry. */
function rowTypesOf(e: MoneyEntry): (string | undefined)[] {
  if (e.kind === "supplier") return e.direction === "in" ? ["supplierReceipt", "manual", undefined] : ["purchase"];
  if (e.kind === "factory") return ["materialIssuance"];
  return ["expense"];
}

/**
 * Find each party entry's movement(s) in its account, and record what was
 * found on the entry itself (txnIds / txnAmount / noTxn), so correcting or
 * cancelling it moves exactly those rows and nothing else.
 *
 * First the sure matches: rows tagged with the entry's id, then — older rows —
 * the same account, amount and second. Then, for a supplier's or factory's
 * payment that still has none, the row of the right kind written in the same
 * save from the same account, even when the amounts no longer agree (a bill
 * part changed or removed elsewhere). That last step is what used to be
 * missing: the payment said "correct it from the account ledger", the account
 * ledger said "recorded in Supplier Payments", and nobody could touch either.
 * Now the payment owns its row — the amounts shown side by side — and stays
 * correctable; an account row that no payment claims is corrected on its own.
 * `claimed` collects every row matched, for the account ledger to read.
 */
function pairEntries(entries: MoneyEntry[], idx: TxnIndex, claimed: Set<string>, shared?: Map<string, MoneyEntry[]>) {
  const found = new Map<MoneyEntry, LockerTransaction[]>();
  const take = (e: MoneyEntry, ts: LockerTransaction[]) => { found.set(e, ts); for (const t of ts) claimed.add(t.id); };

  // 1 · Tagged with the payment's (or the expense's) own id.
  for (const e of entries) {
    const ids = e.legIds ?? [e.id];
    const tagged = [
      ...ids.flatMap(id => idx.byPayment.get(id) ?? []),
      ...(e.kind === "expense" ? idx.byExpense.get(e.id) ?? [] : []),
    ].filter((t, i, a) => a.indexOf(t) === i && !claimed.has(t.id));
    if (tagged.length) take(e, tagged);
  }
  // 2 · Older rows: the same account, amount and second.
  for (const e of entries) {
    if (!e.lockerId || found.has(e)) continue;
    // Never a transfer leg, a client's receipt or a sale's money — those are
    // other people's rows, whatever their amount.
    // A row typed for another kind of entry (a purchase's, an expense's) is
    // never borrowed either; an untyped or hand-typed one may be, as before.
    const types = rowTypesOf(e);
    const same = (idx.byLocker.get(e.lockerId) ?? []).filter(t =>
      !t.paymentId && !claimed.has(t.id) && !t.pairedLockerId
      && (types.includes(t.refType) || !t.refType || t.refType === "manual")
      && Math.abs(t.amountInr - e.amount) < 0.01 && near(t.createdAt, e.date));
    const t = same.find(x => types.includes(x.refType)) ?? same[0];
    if (t) take(e, [t]);
  }
  // 3 · A supplier's or factory's payment whose bills no longer add up to its
  //     movement: the movement of its kind from the same save. Never a
  //     hand-typed row on timing alone, and never a guess between two.
  const reach = new Map<MoneyEntry, LockerTransaction[]>();
  for (const e of entries) {
    if (!e.lockerId || found.has(e) || e.kind === "expense") continue;
    const types = rowTypesOf(e).filter(x => x && x !== "manual");
    let cands = (idx.byLocker.get(e.lockerId) ?? []).filter(t =>
      !t.paymentId && !claimed.has(t.id) && types.includes(t.refType) && near(t.createdAt, e.date));
    if (cands.length > 1) {
      const named = cands.filter(t => !!e.party && (t.category ?? "").includes(e.party));
      if (named.length) cands = named;
    }
    if (cands.length) reach.set(e, cands);
  }
  // Two entries that could each claim the same movement share it — a payment
  // on bills and the advance recovered beside it (lib/supplierRepair.ts) are
  // ONE account row: same party, same account, same moment. Whichever was
  // listed first used to take the whole row with no amount check, and
  // cancelling or correcting it moved the whole sum while the other entry
  // stayed. Neither claims it now: both are locked, saying why, and the row
  // is corrected (or cancelled) in the account ledger.
  const reachers = new Map<string, MoneyEntry[]>();
  for (const [e, cands] of reach) {
    for (const t of cands) {
      const l = reachers.get(t.id);
      if (l) l.push(e); else reachers.set(t.id, [e]);
    }
  }
  const contested = new Set<MoneyEntry>();
  for (const [id, es] of reachers) {
    if (es.length < 2) continue;
    for (const e of es) contested.add(e);
    shared?.set(id, es);
  }
  for (const [e, cands] of reach) {
    if (contested.has(e)) continue;
    const sum = r2(cands.reduce((s, t) => s + t.amountInr, 0));
    const pick = cands.length === 1 || (cands.length > 1 && Math.abs(sum - e.amount) < 0.01) ? cands : [];
    if (pick.length) take(e, pick);
  }
  for (const e of contested) {
    const others = [...new Set(reach.get(e)!.flatMap(t => reachers.get(t.id) ?? []))].filter(o => o !== e);
    e.locked = `Shares one account movement with another entry (${others.map(sharerLabel).join("; ")}) — cancel or correct both in Payments → Account entries.`;
    e.lockedLabel = "Correct in Account entries";
  }

  for (const e of entries) {
    const ts = found.get(e) ?? [];
    e.txnIds = ts.map(t => t.id);
    // A shared movement is not "no movement": it is there, and locked.
    if (!ts.length) { if (e.lockerId && !contested.has(e)) e.noTxn = true; continue; }
    const sum = r2(ts.reduce((s, t) => s + t.amountInr, 0));
    if (Math.abs(sum - e.amount) >= 0.01) e.txnAmount = sum;
  }
}

/** One entry, as the other side of a shared movement names it. */
function sharerLabel(e: MoneyEntry): string {
  return `${e.against ?? e.party} ${fmtCcy(e.amount, e.currency)}`;
}

/** Every entry of one party kind, as recorded — before any account matching. */
function partyEntries(db: DB, kind: Exclude<EntryKind, "locker">): MoneyEntry[] {
  const out: MoneyEntry[] = [];

  if (kind === "supplier") {
    const legs: Leg[] = [];
    for (const p of db.purchases ?? []) {
      const supplier = db.suppliers.find(s => s.id === p.supplierId);
      for (const pay of p.payments ?? []) {
        legs.push({
          key: `${p.supplierId}|${pay.lockerId ?? ""}|${pay.createdAt}`,
          id: pay.id, at: pay.createdAt, lockerId: pay.lockerId, note: pay.note,
          amount: pay.amountInr, party: supplier?.name ?? "Supplier", partyId: p.supplierId,
          label: p.invoiceNumber || `Purchase ${p.id.slice(-6)}`,
        });
      }
    }
    for (const g of groupLegs(legs)) {
      out.push({
        id: g.ids[0], kind, date: g.at, party: g.party, partyId: g.partyId,
        against: g.labels.length > 1 ? `Invoices ${g.labels.join(", ")}` : `Invoice ${g.labels[0] ?? ""}`.trim(),
        amount: g.amount, currency: "INR",
        lockerId: g.lockerId, note: g.note, direction: "out",
        legIds: g.ids.length > 1 ? g.ids : undefined,
        legLabels: g.ids.length > 1 ? g.labels : undefined,
      });
    }
    for (const r of db.supplierReceipts ?? []) {
      const supplier = db.suppliers.find(s => s.id === r.supplierId);
      const broker = r.viaBrokerId ? (db.brokers ?? []).find(b => b.id === r.viaBrokerId)?.name ?? "the broker" : "";
      out.push({
        id: r.id, kind, date: r.createdAt,
        party: supplier?.name ?? "Supplier", partyId: r.supplierId,
        against: r.saleId ? (broker ? `For goods sold · collected by ${broker}` : "For goods sold to them") : "Refund / return",
        amount: r.amountInr, currency: "INR",
        lockerId: r.lockerId, note: r.note, direction: "in",
        // Money for goods we sold them belongs to that sale (lib/supplierSales.ts): deleting the
        // sale removes it with the stock and the account; changed here alone, the two would disagree.
        ...(r.saleId ? {
          locked: "This is money for goods we sold them. Deleting the sale on their page puts the goods back and takes this out together; changing it here would leave the two disagreeing.",
          lockedWhere: "the supplier's page", lockedLabel: "Delete the sale on the supplier's page",
        } : {}),
      });
    }
    // Advances and loans — paid to the supplier against no particular bill.
    for (const a of db.supplierPayments ?? []) {
      const supplier = db.suppliers.find(s => s.id === a.supplierId);
      out.push({
        id: a.id, kind, date: a.createdAt,
        party: supplier?.name ?? "Supplier", partyId: a.supplierId, against: "Advance / loan",
        amount: a.amountInr, currency: "INR",
        lockerId: a.lockerId, note: a.note, direction: "out",
      });
    }
  }

  if (kind === "factory") {
    // Advances and loans — paid to the factory against no particular job.
    for (const a of db.factoryPayments ?? []) {
      const factory = db.factories.find(f => f.id === a.factoryId);
      out.push({
        id: a.id, kind, date: a.createdAt,
        party: factory?.name ?? "Factory", partyId: a.factoryId, against: "Advance / loan",
        amount: a.amountInr, currency: "INR",
        lockerId: a.lockerId, note: a.note, direction: "out",
      });
    }
    const legs: Leg[] = [];
    for (const mi of db.materialIssuances ?? []) {
      const factory = db.factories.find(f => f.id === mi.factoryId);
      const order = db.orders.find(o => o.id === mi.orderId);
      for (const pay of mi.makingCharges?.payments ?? []) {
        legs.push({
          key: `${mi.factoryId}|${pay.lockerId ?? ""}|${pay.createdAt}`,
          id: pay.id, at: pay.createdAt, lockerId: pay.lockerId, note: pay.note,
          amount: pay.amountInr, party: factory?.name ?? "Factory", partyId: mi.factoryId,
          label: order?.orderNumber,
        });
      }
    }
    for (const g of groupLegs(legs)) {
      out.push({
        id: g.ids[0], kind, date: g.at, party: g.party, partyId: g.partyId,
        against: g.labels.length ? `Order${g.labels.length > 1 ? "s" : ""} ${g.labels.join(", ")}` : "Making charges",
        amount: g.amount, currency: "INR",
        lockerId: g.lockerId, note: g.note, direction: "out",
        legIds: g.ids.length > 1 ? g.ids : undefined,
        legLabels: g.ids.length > 1 ? g.labels : undefined,
      });
    }
  }

  if (kind === "expense") {
    for (const e of db.expenses ?? []) {
      const paidTo = e.paidToEmployeeId ? db.users.find(u => u.id === e.paidToEmployeeId) : undefined;
      out.push({
        id: e.id, kind, date: e.createdAt,
        party: e.title,
        against: paidTo ? `${e.category} · ${paidTo.name}` : e.category,
        amount: e.amount, currency: ccy(e.currency),
        lockerId: e.lockerId, note: e.note, direction: "out",
      });
    }
  }
  return out;
}

/** An account row no entry claims, by what made it: is its record provably
 *  gone (it names one that is not on file), or is it merely not linked — an
 *  older row with nothing to match it by, whose record may well still be on
 *  file? Only the first may be called gone; saying so of the second invited
 *  deleting a movement whose payment still stands. Read once ENTRY_COLS.locker
 *  have loaded (expenses among them), so "not on file" is the truth. */
function unclaimedRow(db: DB, t: LockerTransaction): { gone: string } | { unlinked: string } {
  const has = (list: { id: string }[] | undefined, id?: string) => !!id && (list ?? []).some(x => x.id === id);
  const supplierPaymentOnFile = (id: string) =>
    (db.purchases ?? []).some(p => (p.payments ?? []).some(x => x.id === id)) || has(db.supplierPayments, id);
  const factoryPaymentOnFile = (id: string) =>
    (db.materialIssuances ?? []).some(mi => (mi.makingCharges?.payments ?? []).some(x => x.id === id)) || has(db.factoryPayments, id);
  switch (t.refType) {
    case "purchase":
      if (t.paymentId && !supplierPaymentOnFile(t.paymentId)) return { gone: "Its supplier payment is no longer on file" };
      if (t.refId && !has(db.purchases, t.refId)) return { gone: "The purchase it paid is no longer on file" };
      return { unlinked: "Not linked to a supplier payment (older entry) — check the supplier's ledger before changing it" };
    case "supplierReceipt":
      if (t.paymentId && !has(db.supplierReceipts, t.paymentId)) return { gone: "The money received from the supplier is no longer on file" };
      return { unlinked: "Not linked to money received from a supplier (older entry) — check the supplier's ledger before changing it" };
    case "materialIssuance":
      if (t.paymentId && !factoryPaymentOnFile(t.paymentId)) return { gone: "Its factory payment is no longer on file" };
      if (t.refId && !has(db.materialIssuances, t.refId)) return { gone: "The factory job it paid is no longer on file" };
      return { unlinked: "Not linked to a factory payment (older entry) — check the factory's ledger before changing it" };
    case "expense":
      if (t.refId && !has(db.expenses, t.refId)) return { gone: "Its expense is no longer on file" };
      return { unlinked: "Not linked to an expense (older entry) — check Expenses before changing it" };
    case "diamondSale":
      if (t.refId && !has(db.diamondSales, t.refId)) return { gone: "Its diamond sale is no longer on file" };
      return { unlinked: "Not linked to a diamond sale (older entry) — check Buy & Assign before changing it" };
    default:
      return { unlinked: "Not linked to any record (older entry) — check where it came from before changing it" };
  }
}

/**
 * The account ledger. A row made BY another record (a supplier payment, an
 * expense, a diamond sale, a client's receipt) is corrected where it was
 * recorded — editing the movement alone would leave the bill it paid
 * untouched. A transfer is different: both legs are ours, so it is edited here
 * and both move together. And a row whose record is gone belongs to nobody
 * else any more, so it is corrected here — on its own, and saying so.
 */
function lockerEntries(db: DB): MoneyEntry[] {
  const idx = indexTxns(db);
  // Which tab owns each row: the same matching the party ledgers use, so a
  // row is editable on exactly one side.
  const owner = new Map<string, string>();
  // Rows two entries could each claim, so neither does (pairEntries, step 3).
  const shared = new Map<string, MoneyEntry[]>();
  for (const k of ["supplier", "factory", "expense"] as const) {
    const claimed = new Set<string>();
    pairEntries(partyEntries(db, k), idx, claimed, shared);
    for (const id of claimed) if (!owner.has(id)) owner.set(id, TAB[k]);
  }

  // The money a diamond sale brought in. New rows say so (refType
  // "diamondSale", refId = the sale); older ones were written as plain manual
  // income and are found the way cancelling the sale finds them — the account,
  // the amount and the moment (src/lib/diamondSaleVoid.ts).
  const sales = db.diamondSales ?? [];
  const saleIds = new Set(sales.map(s => s.id));
  const saleRows = new Set<string>();
  const taggedSales = new Set<string>();
  for (const t of db.lockerTransactions ?? []) {
    if (t.refType === "diamondSale" && t.refId && saleIds.has(t.refId)) { saleRows.add(t.id); taggedSales.add(t.refId); }
  }
  for (const s of sales) {
    if (!s.lockerId || taggedSales.has(s.id)) continue;
    const money = s.totalUsd ?? s.totalInr;
    const t = (idx.byLocker.get(s.lockerId) ?? []).find(x =>
      x.type === "income" && !saleRows.has(x.id) && !owner.has(x.id) && (!x.refType || x.refType === "manual")
      && Math.abs(x.amountInr - money) < 0.01 && near(x.createdAt, s.createdAt, 2000));
    if (t) saleRows.add(t.id);
  }

  const out: MoneyEntry[] = [];
  for (const t of db.lockerTransactions ?? []) {
    const ref: string | undefined = t.refType;
    const where = owner.get(t.id);
    let locked: string | undefined, lockedWhere: string | undefined, lockedLabel: string | undefined, orphan: string | undefined;
    let unlinked: string | undefined;
    const sharers = where ? undefined : shared.get(t.id);
    if (saleRows.has(t.id) && (db.diamondSales ?? []).some(s => s.id === t.refId && s.unpaid)) {
      // A payment taken later on a diamond sold on credit (lib/diamondSalePay.ts).
      lockedWhere = RECORDED_IN.diamondSale;
      lockedLabel = "Remove it in the sale's Receive payment";
      locked = "This is a payment on a diamond sold on credit. Remove it from the sale (Buy & Assign → the sale's ⋯ → Receive payment, or the client's page) — that takes it out of the account and puts it back on what they owe.";
    } else if (saleRows.has(t.id)) {
      lockedWhere = RECORDED_IN.diamondSale;
      lockedLabel = "Cancel the sale in Buy & Assign";
      locked = "This is the money from a diamond sale. Cancelling the sale in Buy & Assign puts the stone back in stock and takes this out of the account together; changing it here would leave the two disagreeing.";
    } else if (ref === "clientPayment" || where) {
      lockedWhere = where ?? RECORDED_IN.clientPayment;
      locked = `This is the account side of an entry recorded in ${lockedWhere}. Correcting it there moves both; correcting it here would leave the two disagreeing.`;
    } else if (sharers) {
      // One movement for two entries (a payment and the advance recovered
      // beside it): neither may move it alone, so it is corrected here.
      unlinked = `One account movement shared by ${sharers.length} entries on ${sharers[0].party}'s books — ${sharers.map(sharerLabel).join("; ")}`;
      orphan = `${unlinked}. Corrected or cancelled here, it changes the account only. Once it is cancelled, each of those entries shows no account movement and can be cancelled on its own without moving the account again.`;
    // A brokerage payment is the record itself — the broker's due is read from
    // it (lib/brokers.ts) — so it is corrected here like any entry of our own.
    // So is money a broker handed over to us (what they collected from a supplier for us).
    } else if (ref && ref !== "manual" && ref !== "transfer" && ref !== "brokerPayment" && ref !== "brokerReceipt" && ref !== "designerPayment" && ref !== "clientRefund" && !t.pairedLockerId) {
      const why = unclaimedRow(db, t);
      if ("gone" in why) {
        orphan = `${why.gone}, so it is corrected here — that changes the account only.`;
      } else {
        unlinked = why.unlinked;
        orphan = `${why.unlinked}. Corrected here, it changes the account only.`;
      }
    }
    out.push({
      id: t.id, kind: "locker", date: t.createdAt,
      party: db.lockers.find(l => l.id === t.lockerId)?.name ?? "Account",
      against: t.category ?? t.type,
      amount: t.amountInr, currency: ccy(t.currency),
      lockerId: t.lockerId, note: t.note,
      direction: t.type === "income" || t.type === "transfer_in" ? "in" : "out",
      voucherNo: t.voucherNo,
      transfer: !!t.pairedLockerId,
      locked, lockedWhere, lockedLabel, orphan, unlinked,
      ...(ref === "clientRefund" ? {
        refundTo: db.clients.find(c => c.id === t.refId)?.companyName ?? "the client",
        refundUsd: t.refundUsd,
      } : {}),
    });
  }
  return out;
}

/** Every entry of one kind, newest first, each matched to its account
 *  movement. Read only once ENTRY_COLS[kind] have loaded. */
export function listEntries(db: DB, kind: EntryKind): MoneyEntry[] {
  let out: MoneyEntry[];
  if (kind === "locker") out = lockerEntries(db);
  else {
    out = partyEntries(db, kind);
    pairEntries(out, indexTxns(db), new Set());
  }
  return out.sort((a, b) => +new Date(b.date) - +new Date(a.date));
}

export interface EntryPatch {
  /** For a transfer: what left the FROM account, in its currency. */
  amount?: number;
  date?: string;
  note?: string;
  /** For a transfer: the account the money left, whichever of its two rows
   *  was opened. */
  lockerId?: string;
  userId: string;
  /** Transfers only: the account the money goes TO, and the rate when the two
   *  accounts are in different currencies — 1 FROM-currency = `exchangeRate`
   *  TO-currency. */
  toLockerId?: string;
  exchangeRate?: number;
}

/** The currency an account holds (unset = rupees, as every account made before
 *  accounts held anything else). */
const lockerCcy = (d: DB, id?: string) => ccy(d.lockers.find(l => l.id === id)?.currency);

/**
 * Moving an entry to an account in another currency, without converting it,
 * would read the same figure as another currency's money — ₹10,000 becoming
 * A$10,000. That is never a correction, so it is refused; money that really
 * changed currency is a transfer. Staying in the same account (or one in the
 * same currency) is fine.
 */
function moveRefusal(d: DB, entry: MoneyEntry, lockerId?: string): string | undefined {
  if (lockerId === undefined || lockerId === entry.lockerId) return undefined;
  const held = lockerCcy(d, lockerId), own = ccy(entry.currency);
  if (held === own) return undefined;
  return `That account holds ${held} — this entry is in ${own}. Pick an account in ${own}, or record a transfer.`;
}

/** Move the paired account movement along with the entry it belongs to.
 *  editEntry() has already refused a move to an account in another currency,
 *  so the amount means the same in the account it lands in. */
function syncTxn(d: DB, entry: MoneyEntry, patch: EntryPatch) {
  // Never create one here. An entry with no movement of its own (noTxn) has
  // nothing in the account to move, and adding one could count the same money
  // twice — the dialog says the account is left as it is.
  const rows = liveTxns(d, entry);
  for (const live of rows) {
    // One movement takes the new amount; several (an old payment written one
    // row per bill) cannot be split, and editRefusal() refuses that change.
    if (patch.amount !== undefined && rows.length === 1) live.amountInr = roundCcy(patch.amount, entry.currency);
    if (patch.date !== undefined) live.createdAt = patch.date;
    if (patch.note !== undefined) live.note = patch.note || undefined;
    if (patch.lockerId !== undefined) {
      live.lockerId = patch.lockerId;
      live.currency = lockerCcy(d, patch.lockerId);
    }
    live.paymentId = entry.id; // adopt a legacy row so the next edit matches exactly
  }
}

/** The live account rows an entry moves with: those it was matched to when it
 *  was listed, else (an entry built elsewhere) the one pairedTxn finds. */
function liveTxns(d: DB, entry: MoneyEntry): LockerTransaction[] {
  const all = d.lockerTransactions ?? [];
  if (entry.txnIds) return entry.txnIds.map(id => all.find(t => t.id === id)).filter((t): t is LockerTransaction => !!t);
  const t = pairedTxn(d, entry.id, entry.date, entry.lockerId, entry.amount);
  const live = t ? all.find(x => x.id === t.id) : undefined;
  return live ? [live] : [];
}

/**
 * The other leg of a transfer. Newer pairs share a transferId; older ones are
 * matched on being the opposite type, written at the same moment, and each
 * pointing at the other's account.
 */
function transferSibling(d: DB, t: LockerTransaction): LockerTransaction | undefined {
  const all = d.lockerTransactions ?? [];
  if (t.transferId) return all.find(x => x.id !== t.id && x.transferId === t.transferId);
  return all.find(x =>
    x.id !== t.id
    && x.pairedLockerId === t.lockerId
    && x.lockerId === t.pairedLockerId
    && Math.abs(+new Date(x.createdAt) - +new Date(t.createdAt)) < 2000
    && ((t.type === "transfer_out" && x.type === "transfer_in")
      || (t.type === "transfer_in" && x.type === "transfer_out")));
}

/** Both rows of a transfer, the money's way round — whichever of them `id` is.
 *  Undefined for anything that is not a transfer, or one whose other row is gone. */
export function transferLegs(db: DB, id: string): { out: LockerTransaction; inn: LockerTransaction } | undefined {
  const t = (db.lockerTransactions ?? []).find(x => x.id === id);
  const other = t?.pairedLockerId ? transferSibling(db, t) : undefined;
  if (!t || !other) return undefined;
  return t.type === "transfer_out" ? { out: t, inn: other } : { out: other, inn: t };
}

/** Money leaving one account and arriving in another has to stay equal after an
 *  edit. Given the FROM side's amount and the rate (1 from = rate to), work out
 *  what lands on the other side. */
function convertedAmount(amount: number, from: string, to: string, rate: number): number {
  return ccy(from) === ccy(to) ? roundCcy(amount, to) : roundCcy(amount * rate, to);
}

interface TransferPlan {
  fromId: string; toId: string;
  fromCcy: CurrencyCode; toCcy: CurrencyCode;
  sent: number; received: number;
  /** 1 from = rate to (1 when both accounts hold the same currency). */
  rate: number;
  /** The row whose recorded rate still stands — copied as it is rather than
   *  rewritten, so correcting a remark never changes how the rate was stored.
   *  Unset when the rate is written afresh (or cleared). */
  keepRateOf?: LockerTransaction;
}

/**
 * What a corrected transfer becomes, or why it cannot be saved. Any two
 * currencies: the FROM account's amount is what left it, and what arrives is
 * that amount at the rate — the one typed, else the one it was recorded at.
 */
function planTransfer(d: DB, out: LockerTransaction, inn: LockerTransaction, patch: EntryPatch): TransferPlan | string {
  const fromId = patch.lockerId ?? out.lockerId;
  const toId = patch.toLockerId ?? inn.lockerId;
  if (fromId === toId) return "A transfer needs two different accounts — choose the one the money went to.";
  const fromCcy = lockerCcy(d, fromId), toCcy = lockerCcy(d, toId);
  const sent = patch.amount !== undefined ? roundCcy(patch.amount, fromCcy) : out.amountInr;
  if (fromCcy === toCcy) return { fromId, toId, fromCcy, toCcy, sent, received: convertedAmount(sent, fromCcy, toCcy, 1), rate: 1 };

  const onOut = rateOf(out, fromCcy, toCcy);
  const recorded = onOut ?? rateOf(inn, fromCcy, toCcy);
  const typed = patch.exchangeRate && patch.exchangeRate > 0 ? patch.exchangeRate : undefined;
  // The dialog shows the recorded rate back (perhaps turned the other way
  // round), so a typed rate equal to it is the same rate, not a new one.
  const asRecorded = recorded !== undefined && (typed === undefined || Math.abs(typed - recorded) <= recorded * 1e-9);
  const rate = asRecorded ? recorded : typed;
  if (!rate) return `Enter the exchange rate — ${fromCcy} and ${toCcy} are different currencies.`;
  const sameWayRound = lockerCcy(d, out.lockerId) === fromCcy && lockerCcy(d, inn.lockerId) === toCcy;
  return {
    fromId, toId, fromCcy, toCcy, sent, rate,
    received: convertedAmount(sent, fromCcy, toCcy, rate),
    keepRateOf: asRecorded && sameWayRound ? (onOut !== undefined ? out : inn) : undefined,
  };
}

/** Why this correction cannot be saved, or nothing when it can. Checked before
 *  anything is written, so a refusal leaves every record exactly as it was. */
export function entryEditRefusal(d: DB, entry: MoneyEntry, patch: EntryPatch): string | undefined {
  if (entry.locked) return entry.locked;
  // Paid from no account: giving it one here would have the books say the
  // money left that account while the account never moved — syncTxn moves
  // the rows an entry already has, it never makes one.
  if (entry.kind !== "locker" && !entry.lockerId && patch.lockerId) {
    return entry.kind === "expense"
      ? "This expense was not paid from an account. If it was, delete it and record it again from that account."
      : "This payment was not made from an account — giving it one here would show money leaving an account that never moved. If it was paid from one, cancel it and record it again from that account.";
  }
  if (entry.kind === "locker") {
    // A refund's amount is also what came off the client's credit: changed
    // here, the two would disagree. Its date, note or account can be corrected.
    if (entry.refundTo && patch.amount !== undefined && Math.abs(patch.amount - entry.amount) >= 0.005) {
      return "This refund also took the client's credit down — to change the amount, delete it (their credit goes back) and record it again.";
    }
    const legs = transferLegs(d, entry.id);
    if (legs) {
      const plan = planTransfer(d, legs.out, legs.inn, patch);
      return typeof plan === "string" ? plan : undefined;
    }
  }
  // An old payment written as one account row per bill: the rows cannot be
  // told which of them took the difference.
  if (patch.amount !== undefined && Math.abs(patch.amount - entry.amount) >= 0.01 && (entry.txnIds?.length ?? 0) > 1) {
    return `This payment left the account as ${entry.txnIds!.length} movements, so its total cannot be changed here — cancel it and enter it again.`;
  }
  return moveRefusal(d, entry, patch.lockerId);
}


function dropTxn(d: DB, entry: MoneyEntry) {
  const drop = new Set(liveTxns(d, entry).map(t => t.id));
  if (drop.size) d.lockerTransactions = (d.lockerTransactions ?? []).filter(t => !drop.has(t.id));
}

/** Correct one entry — the party's books and the account move together.
 *  Returns why it was refused (nothing is written then), or undefined once saved. */
export function editEntry(entry: MoneyEntry, patch: EntryPatch): string | undefined {
  // The account rows are what move with it: not loaded, they would be missed.
  if (!collectionsFresh(ENTRY_COLS[entry.kind])) return "Still loading the account entries — try again in a moment.";
  // A payment whose account row shows a different amount: the amount moves
  // only when it was actually changed. Correcting a remark or a date must
  // never quietly rewrite what the account says.
  if (entry.txnAmount !== undefined && patch.amount !== undefined && Math.abs(patch.amount - entry.amount) < 0.005) {
    patch = { ...patch, amount: undefined };
  }
  const refused = entryEditRefusal(loadDb(), entry, patch);
  if (refused) return refused;
  updateDb(d => {
    if (entry.kind === "supplier") {
      // One payment split across several bills moves as one: the date, the
      // account and the remark belong to the payment, not to any one bill.
      const ids = entry.legIds ?? [entry.id];
      let touched = false;
      for (const p of d.purchases ?? []) {
        for (const pay of p.payments ?? []) {
          if (!ids.includes(pay.id)) continue;
          touched = true;
          // The total can only be changed on a payment that settled one bill —
          // otherwise there is no saying which bill got more or less. The
          // ledger disables the field and says to cancel and re-enter instead.
          if (patch.amount !== undefined && ids.length === 1) pay.amountInr = r2(patch.amount);
          if (patch.date !== undefined) pay.createdAt = patch.date;
          if (patch.note !== undefined) pay.note = patch.note || undefined;
          if (patch.lockerId !== undefined) pay.lockerId = patch.lockerId;
        }
      }
      if (touched) {
        syncTxn(d, entry, ids.length === 1 ? patch : { ...patch, amount: undefined });
        return;
      }
      const rec = (d.supplierReceipts ?? []).find(x => x.id === entry.id)
        ?? (d.supplierPayments ?? []).find(x => x.id === entry.id);
      if (rec) {
        if (patch.amount !== undefined) rec.amountInr = r2(patch.amount);
        if (patch.date !== undefined) rec.createdAt = patch.date;
        if (patch.note !== undefined) rec.note = patch.note || undefined;
        if (patch.lockerId !== undefined) rec.lockerId = patch.lockerId;
        syncTxn(d, entry, patch);
      }
      return;
    }

    if (entry.kind === "factory") {
      const ids = entry.legIds ?? [entry.id];
      let touched = false;
      for (const mi of d.materialIssuances ?? []) {
        for (const pay of mi.makingCharges?.payments ?? []) {
          if (!ids.includes(pay.id)) continue;
          touched = true;
          if (patch.amount !== undefined && ids.length === 1) pay.amountInr = r2(patch.amount);
          if (patch.date !== undefined) pay.createdAt = patch.date;
          if (patch.note !== undefined) pay.note = patch.note || undefined;
          if (patch.lockerId !== undefined) pay.lockerId = patch.lockerId;
        }
      }
      if (touched) {
        syncTxn(d, entry, ids.length === 1 ? patch : { ...patch, amount: undefined });
        return;
      }
      const adv = (d.factoryPayments ?? []).find(x => x.id === entry.id);
      if (adv) {
        if (patch.amount !== undefined) adv.amountInr = r2(patch.amount);
        if (patch.date !== undefined) adv.createdAt = patch.date;
        if (patch.note !== undefined) adv.note = patch.note || undefined;
        if (patch.lockerId !== undefined) adv.lockerId = patch.lockerId;
        syncTxn(d, entry, patch);
        return;
      }
      for (const mi of d.materialIssuances ?? []) {
        const pay = (mi.makingCharges?.payments ?? []).find(x => x.id === entry.id);
        if (pay) {
          if (patch.amount !== undefined) pay.amountInr = r2(patch.amount);
          if (patch.date !== undefined) pay.createdAt = patch.date;
          if (patch.note !== undefined) pay.note = patch.note || undefined;
          if (patch.lockerId !== undefined) pay.lockerId = patch.lockerId;
          syncTxn(d, entry, patch);
          return;
        }
      }
      return;
    }

    if (entry.kind === "expense") {
      const e = (d.expenses ?? []).find(x => x.id === entry.id) as Expense | undefined;
      if (!e) return;
      if (patch.amount !== undefined) e.amount = roundCcy(patch.amount, entry.currency);
      if (patch.date !== undefined) e.createdAt = patch.date;
      if (patch.note !== undefined) e.note = patch.note || undefined;
      if (patch.lockerId !== undefined) {
        e.lockerId = patch.lockerId;
        // The amount is always in the account's own currency. A move to an
        // account in another currency was refused above, so this keeps the
        // expense in step with its account, as it always has.
        e.currency = lockerCcy(d, patch.lockerId);
      }
      syncTxn(d, entry, patch);
      return;
    }

    if (entry.kind === "locker") {
      const t = (d.lockerTransactions ?? []).find(x => x.id === entry.id) as LockerTransaction | undefined;
      if (!t) return;
      const legs = transferLegs(d, t.id);
      const plan = legs ? planTransfer(d, legs.out, legs.inn, patch) : undefined;
      // Refused before the save started; never write half of it.
      if (typeof plan === "string") return;
      const other = legs ? (legs.out.id === t.id ? legs.inn : legs.out) : undefined;

      if (patch.date !== undefined) { t.createdAt = patch.date; if (other) other.createdAt = patch.date; }
      if (patch.note !== undefined) {
        t.note = patch.note || undefined;
        if (other) other.note = patch.note || undefined;
      }

      if (legs && plan && other) {
        // A transfer is one event in two rows. Whichever leg was opened, the
        // patch names the FROM and TO sides and both are rewritten, so the pair
        // can never be left saying different things — the reason these used to
        // be read-only. Any two currencies: what arrives is what left at the rate.
        const { out, inn } = legs;
        out.lockerId = plan.fromId; out.currency = plan.fromCcy; out.amountInr = plan.sent;
        out.pairedLockerId = plan.toId; out.refType = "transfer";
        inn.lockerId = plan.toId; inn.currency = plan.toCcy; inn.amountInr = plan.received;
        inn.pairedLockerId = plan.fromId; inn.refType = "transfer";
        // The same rate on both legs: kept as recorded, written afresh, or —
        // now that both accounts hold one currency — cleared.
        const rf = plan.keepRateOf
          ? { fx: plan.keepRateOf.fx, exchangeRate: plan.keepRateOf.exchangeRate }
          : rateFields(plan.fromCcy, plan.toCcy, plan.rate);
        out.fx = rf.fx ? { ...rf.fx } : undefined; out.exchangeRate = rf.exchangeRate;
        inn.fx = rf.fx ? { ...rf.fx } : undefined; inn.exchangeRate = rf.exchangeRate;
        // Tie the pair together so the next edit finds it by id, not by guesswork.
        const tid = t.transferId || other.transferId || uid("xfer_");
        t.transferId = tid; other.transferId = tid;
        return;
      }

      // A plain deposit or withdrawal. A move to an account in another
      // currency was refused above, so the amount keeps its meaning.
      if (patch.amount !== undefined) t.amountInr = roundCcy(patch.amount, entry.currency);
      if (patch.lockerId !== undefined) {
        t.lockerId = patch.lockerId;
        t.currency = lockerCcy(d, patch.lockerId);
      }
    }
  });
  return undefined;
}

/** In plain words, what cancelling this entry changes — shown before confirming. */
export function entryImpact(entry: MoneyEntry, lockerName?: string): string[] {
  const money = fmtCcy(entry.amount, entry.currency);
  const out: string[] = [];
  if (entry.unlinked) out.push(`• ${entry.unlinked}`);
  if (entry.kind === "supplier") {
    out.push(entry.direction === "out"
      ? `• ${money} goes back onto ${entry.party}'s dues — that bill will show as unpaid again`
      : `• ${money} is removed from what ${entry.party} refunded`);
  }
  if (entry.kind === "factory") out.push(`• ${money} goes back onto ${entry.party}'s making charges`);
  if (entry.legLabels?.length) {
    out.push(`• all ${entry.legLabels.length} parts of this payment go — ${entry.legLabels.join(", ")}`);
  }
  if (entry.kind === "expense") out.push(`• the expense is removed from the books and every expense report`);
  if (entry.kind === "locker" && entry.refundTo) {
    out.push(`• ${entry.refundUsd ? fmtMoney(entry.refundUsd) : money} goes back onto ${entry.refundTo}'s credit`);
  }
  if (entry.kind === "locker") {
    out.push(entry.transfer
      ? "• both sides of the transfer are removed — the money goes back to the account it left"
      : "• the entry is removed from the account ledger");
  }
  // What the account gives back is what the account shows for it — which is
  // not always what the bills add up to, and both are said when they differ.
  const acct = fmtCcy(entry.txnAmount ?? entry.amount, entry.currency);
  if (entry.noTxn) {
    out.push(`• no movement for it was found in ${lockerName ?? "its account"}, so no account balance changes`);
  } else if (lockerName) {
    out.push(entry.direction === "out"
      ? `• ${lockerName} goes back up by ${acct}`
      : `• ${lockerName} goes down by ${acct}`);
  }
  if (entry.txnAmount !== undefined) {
    out.push(`• the account showed ${acct} for this payment while it adds up to ${money} here — both come off`);
  }
  out.push("• nothing else changes — every other payment stays exactly as it is");
  return out;
}

/** The question asked before an entry is cancelled. An account row that is
 *  merely not linked says so first: its payment may still be on the books,
 *  and deleting the row alone would leave the two disagreeing. */
export function entryDeleteQuestion(entry: MoneyEntry, lockerName?: string): string {
  const head = entry.unlinked
    ? "Delete this account entry on its own? It changes the account only — whatever it paid may still be on the books, and the two would then disagree."
    : "Cancel this entry?";
  return `${head}\n\n${entryImpact(entry, lockerName).join("\n")}\n\nThis cannot be undone.`;
}

/** Cancel one entry: the party's books and the account both come back.
 *  Returns why it was refused (nothing is written then). An unlinked account
 *  row goes only once the person has confirmed entryDeleteQuestion. */
export function deleteEntry(entry: MoneyEntry, opts: { unlinkedConfirmed?: boolean } = {}): string | undefined {
  if (entry.locked) return entry.locked;
  if (entry.unlinked && !opts.unlinkedConfirmed) return `${entry.unlinked}. Confirm that before deleting it.`;
  if (!collectionsFresh(ENTRY_COLS[entry.kind])) return "Still loading the account entries — try again in a moment.";
  updateDb(d => {
    if (entry.kind === "supplier") {
      const ids = new Set(entry.legIds ?? [entry.id]);
      let touched = false;
      for (const p of d.purchases ?? []) {
        if ((p.payments ?? []).some(x => ids.has(x.id))) {
          p.payments = p.payments.filter(x => !ids.has(x.id));
          touched = true;
        }
      }
      if (touched) { dropTxn(d, entry); return; }
      if ((d.supplierReceipts ?? []).some(x => x.id === entry.id)) {
        d.supplierReceipts = d.supplierReceipts.filter(x => x.id !== entry.id);
        dropTxn(d, entry);
        return;
      }
      if ((d.supplierPayments ?? []).some(x => x.id === entry.id)) {
        d.supplierPayments = d.supplierPayments.filter(x => x.id !== entry.id);
        dropTxn(d, entry);
      }
      return;
    }
    if (entry.kind === "factory") {
      if ((d.factoryPayments ?? []).some(x => x.id === entry.id)) {
        d.factoryPayments = d.factoryPayments.filter(x => x.id !== entry.id);
        dropTxn(d, entry);
        return;
      }
      const ids = new Set(entry.legIds ?? [entry.id]);
      let touched = false;
      for (const mi of d.materialIssuances ?? []) {
        if ((mi.makingCharges?.payments ?? []).some(x => ids.has(x.id))) {
          mi.makingCharges.payments = mi.makingCharges.payments.filter(x => !ids.has(x.id));
          touched = true;
        }
      }
      if (touched) dropTxn(d, entry);
      return;
    }
    if (entry.kind === "expense") {
      d.expenses = (d.expenses ?? []).filter(x => x.id !== entry.id);
      dropTxn(d, entry);
      return;
    }
    if (entry.kind === "locker") {
      // Cancelling one leg of a transfer without the other would conjure money
      // into one account and out of nowhere in the other. Both go.
      const t = (d.lockerTransactions ?? []).find(x => x.id === entry.id);
      const other = t?.pairedLockerId ? transferSibling(d, t) : undefined;
      // A refund to a client: what it took off their credit goes back on.
      if (t) undoClientRefund(d, t);
      const drop = new Set([entry.id, ...(other ? [other.id] : [])]);
      d.lockerTransactions = (d.lockerTransactions ?? []).filter(x => !drop.has(x.id));
    }
  });
  return undefined;
}

/* ── Expenses: the whole record, with its account row in step ──────────────── */

/** Everything an expense says, as the edit panel sends it back. */
export interface ExpensePatch {
  title: string;
  category: string;
  /** In the expense's own currency — its account's. */
  amount: number;
  /** The full timestamp (the panel keeps the time of day when only the day changes). */
  date: string;
  note?: string;
  /** The team member it paid (salary, wages, an advance) — drives their salary ledger. */
  paidToEmployeeId?: string;
  clientId?: string;
  /** The orders it is a direct cost of (freight, insurance, a lab fee). */
  orderIds?: string[];
  shipmentRef?: string;
  /** The account it was paid from. One paid from an account stays paid from
   *  one; one that was not cannot gain one here (see expenseRefusal). */
  lockerId?: string;
}

/** An expense's own account rows: tagged with it (refType "expense", refId),
 *  else — an older one — the movement written with it. */
function expenseRows(d: DB, e: Expense): LockerTransaction[] {
  const all = d.lockerTransactions ?? [];
  const tagged = all.filter(t => t.refType === "expense" && t.refId === e.id);
  if (tagged.length || !e.lockerId) return tagged;
  const legacy = all.find(t => !t.paymentId && !t.refId && t.type === "expense" && t.lockerId === e.lockerId
    && Math.abs(t.amountInr - e.amount) < 0.01 && near(t.createdAt, e.createdAt));
  return legacy ? [legacy] : [];
}

/** Said when an expense names an account but no entry for it is found there. */
export const EXPENSE_UNLINKED = "This expense's account entry isn't linked — correct the account side in Payments → Account entries.";

/**
 * Why an expense's amount, date and account cannot be changed from its own
 * panel, or nothing when they can. It names an account, but its entry there
 * was not found (older data): changed, they would change on the expense alone
 * and the account would keep saying otherwise. Read with the account entries
 * loaded.
 */
export function expenseMoneyLock(d: DB, e: Expense): string | undefined {
  if (!e.lockerId || expenseRows(d, e).length) return undefined;
  return EXPENSE_UNLINKED;
}

/** Why this expense cannot be saved like this, or nothing when it can.
 *  Checked before anything is written. */
export function expenseRefusal(d: DB, e: Expense, p: ExpensePatch): string | undefined {
  if (!p.title.trim()) return "Enter a title.";
  if (!(p.amount >= 0) || (p.lockerId && !(p.amount > 0))) return "Enter a valid amount.";
  if (p.category === "Salary" && !p.paidToEmployeeId) return "Choose which team member this salary is for.";
  if (isNaN(+new Date(p.date))) return "Enter a valid date.";
  if (e.lockerId && !p.lockerId) return "This was paid from an account — choose the account it came out of.";
  // Adding an account would conjure a movement nobody recorded, or count one
  // twice if it was entered there by hand.
  if (!e.lockerId && p.lockerId) return "This expense was not paid from an account. If it was, delete it and record it again from that account.";
  const amountChanged = Math.abs(roundCcy(p.amount, ccy(e.currency)) - e.amount) >= 0.005;
  if (amountChanged || p.date !== e.createdAt || (p.lockerId || undefined) !== (e.lockerId || undefined)) {
    const lock = expenseMoneyLock(d, e);
    if (lock) return `${lock} Its title, category, notes and the rest can still be changed here.`;
    const rows = expenseRows(d, e).length;
    // Each row would be set to the whole new amount.
    if (amountChanged && rows > 1) return `This expense left the account as ${rows} movements, so its amount can't be changed here — correct them in Payments → Account entries.`;
  }
  if (p.lockerId && p.lockerId !== e.lockerId) {
    if (!d.lockers.some(l => l.id === p.lockerId)) return "That account is no longer on file.";
    const held = lockerCcy(d, p.lockerId), own = ccy(e.currency);
    if (held !== own) return `That account holds ${held} — this expense is in ${own}. Pick an account in ${own}, or record a transfer.`;
  }
  return undefined;
}

/**
 * Correct an expense — every field the Add Expense form has, plus the orders
 * and shipment it is a cost of — and its account row in the same save: the
 * amount, the date, the account and the words the account ledger shows.
 * Returns why it was refused (nothing is written then).
 */
export function editExpense(id: string, p: ExpensePatch): string | undefined {
  if (!collectionsFresh(["lockerTransactions"])) return "Still loading the account entries — try again in a moment.";
  const db = loadDb();
  const e = (db.expenses ?? []).find(x => x.id === id);
  if (!e) return "That expense is no longer on file.";
  const refused = expenseRefusal(db, e, p);
  if (refused) return refused;
  updateDb(d => {
    const x = (d.expenses ?? []).find(y => y.id === id);
    if (!x) return;
    // Found BEFORE anything changes: an older row is matched on the old
    // amount and moment.
    const rows = expenseRows(d, x);
    const currency = p.lockerId ? lockerCcy(d, p.lockerId) : ccy(x.currency);
    x.title = p.title.trim();
    x.category = p.category;
    x.amount = roundCcy(p.amount, currency);
    x.createdAt = p.date;
    x.note = p.note?.trim() || undefined;
    x.paidToEmployeeId = p.paidToEmployeeId || undefined;
    x.clientId = p.clientId || undefined;
    x.orderIds = p.orderIds?.length ? [...new Set(p.orderIds)] : undefined;
    x.shipmentRef = p.shipmentRef?.trim() || undefined;
    if (p.lockerId) { x.lockerId = p.lockerId; x.currency = currency; }
    for (const t of rows) {
      t.amountInr = x.amount;
      t.createdAt = x.createdAt;
      if (x.lockerId) { t.lockerId = x.lockerId; t.currency = currency; }
      // The words the account ledger shows for it, as every new one is written.
      t.category = `Expense — ${x.title}`;
      if (t.note) t.note = x.note;
      t.refType = "expense"; t.refId = x.id; // adopt an older row so the next edit finds it by id
    }
  });
  return undefined;
}

/** In plain words, what deleting this expense changes — shown before confirming. */
export function expenseImpact(db: DB, e: Expense): string[] {
  const out = ["• the expense is removed from the books and every expense report"];
  const locker = e.lockerId ? db.lockers.find(l => l.id === e.lockerId) : undefined;
  const money = fmtCcy(e.amount, e.currency);
  if (e.lockerId) {
    const rows = collectionsFresh(["lockerTransactions"]) ? expenseRows(db, e) : [];
    out.push(rows.length
      ? `• ${locker?.name ?? "its account"} goes back up by ${money} — its entry there goes too`
      : `• no entry for it was found in ${locker?.name ?? "its account"}, so no account balance changes`);
  }
  if (e.paidToEmployeeId) {
    const who = db.users.find(u => u.id === e.paidToEmployeeId)?.name ?? "the team member";
    out.push(`• it comes off ${who}'s salary ledger`);
  }
  if (e.orderIds?.length) {
    const nos = e.orderIds.map(id => db.orders.find(o => o.id === id)?.orderNumber).filter(Boolean);
    out.push(`• it no longer counts in the cost of ${nos.length ? nos.join(", ") : `${e.orderIds.length} order${e.orderIds.length !== 1 ? "s" : ""}`}`);
  }
  out.push(`• recorded ${fmtDate(e.createdAt)} — nothing else changes`);
  return out;
}

/** Delete an expense and its account row together. The account rows are
 *  loaded first: deleted without them, the account would keep the money out. */
export async function deleteExpense(id: string): Promise<void> {
  await ensureCollections(["lockerTransactions"]);
  updateDb(d => {
    const e = (d.expenses ?? []).find(x => x.id === id);
    if (!e) return;
    const rows = new Set(expenseRows(d, e).map(t => t.id));
    d.expenses = d.expenses.filter(x => x.id !== id);
    if (rows.size) d.lockerTransactions = (d.lockerTransactions ?? []).filter(t => !rows.has(t.id));
  });
}
