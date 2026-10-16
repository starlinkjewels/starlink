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
import { loadDb, updateDb, uid, type DB, type Expense, type LockerTransaction } from "./db";
import { ccy, fmtCcy, rateFields, rateOf, roundCcy, type CurrencyCode } from "./currency";

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
  /** Voucher number, for a cash entry that has one. */
  voucherNo?: string;
  /** True for a locker-to-locker transfer: editing it moves both legs. */
  transfer?: boolean;
  /** When one payment was split across several bills, the id of every part.
   *  The row is the payment as it was made; these are where it landed. */
  legIds?: string[];
  /** The bills that payment covered, for the dialog to spell out. */
  legLabels?: string[];
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
function groupLegs<T>(
  legs: { key: string; at: string; lockerId?: string; note?: string; amount: number; id: string; label?: string; party: string }[],
): { ids: string[]; labels: string[]; at: string; lockerId?: string; note?: string; amount: number; party: string }[] {
  const byKey = new Map<string, { ids: string[]; labels: string[]; at: string; lockerId?: string; note?: string; amount: number; party: string }>();
  for (const l of legs) {
    const g = byKey.get(l.key);
    if (!g) {
      byKey.set(l.key, {
        ids: [l.id], labels: l.label ? [l.label] : [], at: l.at,
        lockerId: l.lockerId, note: l.note, amount: l.amount, party: l.party,
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

/** The account movement that belongs to one entry. Newer rows carry `paymentId`;
 *  older ones are matched on account + amount + the second they were written. */
function pairedTxn(db: DB, entryId: string, at: string, lockerId?: string, amount?: number) {
  const txns = db.lockerTransactions ?? [];
  return txns.find(t => t.paymentId === entryId)
    ?? txns.find(t =>
      !t.paymentId && t.lockerId === lockerId && Math.abs(t.amountInr - (amount ?? 0)) < 0.01
      && Math.abs(+new Date(t.createdAt) - +new Date(at)) < 1500);
}

export function listEntries(db: DB, kind: EntryKind): MoneyEntry[] {
  const out: MoneyEntry[] = [];

  if (kind === "supplier") {
    const legs = [];
    for (const p of db.purchases ?? []) {
      const supplier = db.suppliers.find(s => s.id === p.supplierId);
      for (const pay of p.payments ?? []) {
        legs.push({
          key: `${p.supplierId}|${pay.lockerId ?? ""}|${pay.createdAt}`,
          id: pay.id, at: pay.createdAt, lockerId: pay.lockerId, note: pay.note,
          amount: pay.amountInr, party: supplier?.name ?? "Supplier",
          label: p.invoiceNumber || `Purchase ${p.id.slice(-6)}`,
        });
      }
    }
    for (const g of groupLegs(legs)) {
      out.push({
        id: g.ids[0], kind, date: g.at, party: g.party,
        against: g.labels.length > 1 ? `Invoices ${g.labels.join(", ")}` : `Invoice ${g.labels[0] ?? ""}`.trim(),
        amount: g.amount, currency: "INR",
        lockerId: g.lockerId, note: g.note, direction: "out",
        legIds: g.ids.length > 1 ? g.ids : undefined,
        legLabels: g.ids.length > 1 ? g.labels : undefined,
      });
    }
    for (const r of db.supplierReceipts ?? []) {
      const supplier = db.suppliers.find(s => s.id === r.supplierId);
      out.push({
        id: r.id, kind, date: r.createdAt,
        party: supplier?.name ?? "Supplier", against: "Refund / return",
        amount: r.amountInr, currency: "INR",
        lockerId: r.lockerId, note: r.note, direction: "in",
      });
    }
    // Advances and loans — paid to the supplier against no particular bill.
    for (const a of db.supplierPayments ?? []) {
      const supplier = db.suppliers.find(s => s.id === a.supplierId);
      out.push({
        id: a.id, kind, date: a.createdAt,
        party: supplier?.name ?? "Supplier", against: "Advance / loan",
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
        party: factory?.name ?? "Factory", against: "Advance / loan",
        amount: a.amountInr, currency: "INR",
        lockerId: a.lockerId, note: a.note, direction: "out",
      });
    }
    const legs = [];
    for (const mi of db.materialIssuances ?? []) {
      const factory = db.factories.find(f => f.id === mi.factoryId);
      const order = db.orders.find(o => o.id === mi.orderId);
      for (const pay of mi.makingCharges?.payments ?? []) {
        legs.push({
          key: `${mi.factoryId}|${pay.lockerId ?? ""}|${pay.createdAt}`,
          id: pay.id, at: pay.createdAt, lockerId: pay.lockerId, note: pay.note,
          amount: pay.amountInr, party: factory?.name ?? "Factory",
          label: order?.orderNumber,
        });
      }
    }
    for (const g of groupLegs(legs)) {
      out.push({
        id: g.ids[0], kind, date: g.at, party: g.party,
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

  if (kind === "locker") {
    // Money received from a supplier only started tagging its account movement
    // recently. Older ones were written as plain manual entries, so this finds
    // them the same way pairedTxn does — otherwise they stay editable here,
    // and editing here would change the account without changing the supplier.
    const receiptTxnIds = new Set<string>();
    for (const r of db.supplierReceipts ?? []) {
      const t = pairedTxn(db, r.id, r.createdAt, r.lockerId, r.amountInr);
      if (t) receiptTxnIds.add(t.id);
    }
    for (const t of db.lockerTransactions ?? []) {
      // An entry created BY another record (a supplier payment, an expense) is
      // corrected where it was recorded — editing the movement alone would leave
      // the bill it paid untouched. A transfer is different: both legs are ours,
      // so it is edited here and both move together.
      const isLegacyReceipt = receiptTxnIds.has(t.id);
      const fromElsewhere = isLegacyReceipt
        || (t.refType && t.refType !== "manual" && t.refType !== "transfer");
      const where = isLegacyReceipt ? RECORDED_IN.supplierReceipt : (t.refType ? RECORDED_IN[t.refType] : undefined);
      out.push({
        id: t.id, kind, date: t.createdAt,
        party: db.lockers.find(l => l.id === t.lockerId)?.name ?? "Account",
        against: t.category ?? t.type,
        amount: t.amountInr, currency: ccy(t.currency),
        lockerId: t.lockerId, note: t.note,
        direction: t.type === "income" || t.type === "transfer_in" ? "in" : "out",
        voucherNo: t.voucherNo,
        transfer: !!t.pairedLockerId,
        locked: fromElsewhere
          ? `This is the account side of an entry recorded in ${where ?? "another tab"}. Correcting it there moves both; correcting it here would leave the two disagreeing.`
          : undefined,
        lockedWhere: fromElsewhere ? where : undefined,
      });
    }
  }

  // A payment made "oldest bill first" can be split across several bills while
  // the account shows ONE movement for the lot. There is no way to correct one
  // of those halves without either leaving the account wrong or removing a
  // movement that belongs to the others, so those rows are read-only and say so.
  for (const e of out) {
    // A locker row IS the movement, so it never has a separate one to find.
    if (e.kind === "locker" || e.locked || !e.lockerId) continue;
    if (!pairedTxn(db, e.id, e.date, e.lockerId, e.amount)) {
      e.locked = "Paid across several bills in one go — correct it from the account ledger";
    }
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
  const txn = pairedTxn(d, entry.id, entry.date, entry.lockerId, entry.amount);
  // Never create one here. An entry with no movement of its own shares a
  // combined one, and adding a second would count the same money twice —
  // listEntries() locks those rows so this cannot be reached for them.
  if (!txn) return;

  const live = (d.lockerTransactions ?? []).find(t => t.id === txn.id);
  if (!live) return;
  if (patch.amount !== undefined) live.amountInr = roundCcy(patch.amount, entry.currency);
  if (patch.date !== undefined) live.createdAt = patch.date;
  if (patch.note !== undefined) live.note = patch.note || undefined;
  if (patch.lockerId !== undefined) {
    live.lockerId = patch.lockerId;
    live.currency = lockerCcy(d, patch.lockerId);
  }
  live.paymentId = entry.id; // adopt a legacy row so the next edit matches exactly
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
function editRefusal(d: DB, entry: MoneyEntry, patch: EntryPatch): string | undefined {
  if (entry.kind === "locker") {
    const legs = transferLegs(d, entry.id);
    if (legs) {
      const plan = planTransfer(d, legs.out, legs.inn, patch);
      return typeof plan === "string" ? plan : undefined;
    }
  }
  return moveRefusal(d, entry, patch.lockerId);
}


function dropTxn(d: DB, entry: MoneyEntry) {
  const txn = pairedTxn(d, entry.id, entry.date, entry.lockerId, entry.amount);
  if (txn) d.lockerTransactions = (d.lockerTransactions ?? []).filter(t => t.id !== txn.id);
}

/** Correct one entry — the party's books and the account move together.
 *  Returns why it was refused (nothing is written then), or undefined once saved. */
export function editEntry(entry: MoneyEntry, patch: EntryPatch): string | undefined {
  const refused = editRefusal(loadDb(), entry, patch);
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
  if (entry.kind === "locker") {
    out.push(entry.transfer
      ? "• both sides of the transfer are removed — the money goes back to the account it left"
      : "• the entry is removed from the account ledger");
  }
  if (lockerName) {
    out.push(entry.direction === "out"
      ? `• ${lockerName} goes back up by ${money}`
      : `• ${lockerName} goes down by ${money}`);
  }
  out.push("• nothing else changes — every other payment stays exactly as it is");
  return out;
}

/** Cancel one entry: the party's books and the account both come back. */
export function deleteEntry(entry: MoneyEntry): void {
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
      const drop = new Set([entry.id, ...(other ? [other.id] : [])]);
      d.lockerTransactions = (d.lockerTransactions ?? []).filter(x => !drop.has(x.id));
    }
  });
}
