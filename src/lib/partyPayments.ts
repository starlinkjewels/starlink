// How money with each kind of party is written — one place, used by the
// Payments page's forms and the Locker's "Record entry", so the two can never
// book the same payment differently. Each runs inside updateDb, on the
// records it is given, and moves the party's books and the account together.
//
// Client receipts are not here: they are numbered and have their own engine
// (lib/receipts.ts createReceipt). Refunds are in lib/clientRefunds.ts.
import { uid, fmtMoney, type DB, type Expense } from "./db";
import { allocateSupplierPaymentFIFO, allocateFactoryChargePaymentFIFO } from "./manufacturing";
import { ccy, rateFields, roundCcy } from "./currency";

const r2 = (n: number) => Math.round(n * 100) / 100;

/** What every payment carries: the account, the amount (in its currency), who and when. */
export interface MoneyArgs { lockerId: string; amount: number; note?: string; userId: string; at: string }

/**
 * Pay a supplier from a rupee account: against one bill, oldest bills first, or
 * as an advance. Overpaying is allowed — the excess sits on the newest bill (or,
 * with no bills at all, as an advance), never lost.
 */
export function writeSupplierPayment(d: DB, a: MoneyArgs & { supplierId: string; target: "__fifo" | "__advance" | string }): void {
  const s = d.suppliers.find(x => x.id === a.supplierId);
  if (!s) return;
  const note = a.note?.trim() || undefined;
  const { lockerId, amount: amt, userId, at: now, supplierId, target } = a;
  const supplierPurchases = d.purchases.filter(p => p.supplierId === supplierId);
  // The bill it settles, when one is named and is theirs.
  let billId: string | undefined;
  const asAdvance = (sum: number) => {
    if (!d.supplierPayments) d.supplierPayments = [];
    d.supplierPayments.push({ id: uid("spay_"), supplierId, amountInr: sum, lockerId, recordedBy: userId, createdAt: now, note });
  };
  if (target === "__advance") {
    asAdvance(amt);
  } else if (target === "__fifo") {
    const leftover = allocateSupplierPaymentFIFO(supplierPurchases, amt, lockerId, userId, now, note);
    if (leftover > 0) {
      const newest = [...supplierPurchases].sort((x, y) => +new Date(y.createdAt) - +new Date(x.createdAt))[0];
      if (newest) {
        if (!newest.payments) newest.payments = [];
        newest.payments.push({ id: uid("ppay_"), amountInr: leftover, lockerId, recordedBy: userId, createdAt: now, note });
      } else {
        // Nothing to settle — a supplier with no bills at all. Standing on
        // its own is the only place this money can go; it used to vanish.
        asAdvance(leftover);
      }
    }
  } else {
    // Only this supplier's bill: one that is another's (or gone) makes it an advance.
    const p = d.purchases.find(x => x.id === target && x.supplierId === supplierId);
    if (p) {
      if (!p.payments) p.payments = [];
      p.payments.push({ id: uid("ppay_"), amountInr: amt, lockerId, recordedBy: userId, createdAt: now, note });
      billId = p.id;
    } else {
      // The bill went while the form was open. The money still left the
      // account, so it is booked as an advance rather than discarded.
      asAdvance(amt);
    }
  }
  if (!d.lockerTransactions) d.lockerTransactions = [];
  d.lockerTransactions.push({
    id: uid("ltx_"), lockerId, type: "expense", amountInr: amt, currency: "INR",
    category: `Supplier Payment — ${s.name}`, refType: "purchase",
    refId: billId,
    note, recordedBy: userId, createdAt: now,
  });
}

/** Money back FROM a supplier (a refund, a return) into a rupee account. */
export function writeSupplierReceipt(d: DB, a: MoneyArgs & { supplierId: string }): void {
  const s = d.suppliers.find(x => x.id === a.supplierId);
  if (!s) return;
  const note = a.note?.trim() || undefined;
  if (!d.supplierReceipts) d.supplierReceipts = [];
  // The account movement is tagged with the receipt it belongs to, so
  // correcting it from the supplier tab moves both and the Locker tab
  // sends you there rather than letting the two drift apart.
  const receiptId = uid("srcpt_");
  d.supplierReceipts.push({ id: receiptId, supplierId: a.supplierId, amountInr: a.amount, lockerId: a.lockerId, recordedBy: a.userId, createdAt: a.at, note });
  if (!d.lockerTransactions) d.lockerTransactions = [];
  d.lockerTransactions.push({ id: uid("ltx_"), lockerId: a.lockerId, type: "income", amountInr: a.amount, currency: "INR", category: `Received from ${s.name}`, refType: "supplierReceipt", refId: a.supplierId, paymentId: receiptId, note, recordedBy: a.userId, createdAt: a.at });
}

/** Pay a factory's making charges from a rupee account: one job, oldest first, or an advance. */
export function writeFactoryPayment(d: DB, a: MoneyArgs & { factoryId: string; target: "__fifo" | "__advance" | string }): void {
  const f = d.factories.find(x => x.id === a.factoryId);
  if (!f) return;
  const note = a.note?.trim() || undefined;
  const { lockerId, amount: amt, userId, at: now, factoryId, target } = a;
  const factoryIssuances = d.materialIssuances.filter(i => i.factoryId === factoryId);
  // The job it pays, when one is named and is theirs ("__advance" kept as before).
  let jobRef: string | undefined = target === "__advance" ? target : undefined;
  const asAdvance = (sum: number) => {
    if (!d.factoryPayments) d.factoryPayments = [];
    d.factoryPayments.push({ id: uid("fadv_"), factoryId, amountInr: sum, lockerId, recordedBy: userId, createdAt: now, note });
  };
  if (target === "__advance") {
    asAdvance(amt);
  } else if (target === "__fifo") {
    const leftover = allocateFactoryChargePaymentFIFO(factoryIssuances, amt, lockerId, userId, now, note);
    if (leftover > 0) {
      // Park the excess on the newest issuance so Total Paid / Overpaid reflect it.
      const newest = [...factoryIssuances].sort((x, y) => +new Date(y.issuedAt) - +new Date(x.issuedAt))[0];
      if (newest) {
        if (!newest.makingCharges.payments) newest.makingCharges.payments = [];
        newest.makingCharges.payments.push({ id: uid("fpay_"), amountInr: leftover, lockerId, recordedBy: userId, createdAt: now, note });
      } else {
        // No job to settle at all — an advance to a factory that has not
        // started anything yet. It used to be discarded.
        asAdvance(leftover);
      }
    }
  } else {
    const mi = d.materialIssuances.find(x => x.id === target && x.factoryId === factoryId);
    if (mi) {
      if (!mi.makingCharges.payments) mi.makingCharges.payments = [];
      mi.makingCharges.payments.push({ id: uid("fpay_"), amountInr: amt, lockerId, recordedBy: userId, createdAt: now, note });
      jobRef = mi.id;
    } else {
      asAdvance(amt);
    }
  }
  if (!d.lockerTransactions) d.lockerTransactions = [];
  d.lockerTransactions.push({
    id: uid("ltx_"), lockerId, type: "expense", amountInr: amt, currency: "INR",
    category: `Making Charges — ${f.name}`, refType: "materialIssuance",
    refId: jobRef,
    note, recordedBy: userId, createdAt: now,
  });
}

/**
 * An expense paid from any account, in that account's currency — in Expenses
 * and Profit & Loss. With `paidToEmployeeId` it is pay to a team member (salary,
 * an advance, a bonus) and shows on their salary ledger.
 */
export function writeExpense(d: DB, a: MoneyArgs & { title: string; category: string; paidToEmployeeId?: string }): Expense | undefined {
  const l = d.lockers.find(x => x.id === a.lockerId);
  const expense: Expense = {
    id: uid("exp_"), title: a.title.trim(), amount: a.amount, category: a.category,
    note: a.note?.trim() || undefined, employeeId: a.userId,
    paidToEmployeeId: a.paidToEmployeeId || undefined,
    currency: ccy(l?.currency), createdAt: a.at, lockerId: a.lockerId,
  };
  d.expenses.push(expense);
  if (l) {
    if (!d.lockerTransactions) d.lockerTransactions = [];
    d.lockerTransactions.push({
      id: uid("ltx_"), lockerId: a.lockerId, type: "expense", amountInr: a.amount,
      currency: ccy(l.currency), category: `Expense — ${expense.title}`,
      refType: "expense", refId: expense.id, recordedBy: a.userId, createdAt: a.at,
    });
  }
  return expense;
}

/**
 * Pay THROUGH a broker (lib/brokers.ts): one account entry to the broker, and
 * on each bill he settles a supplier payment "via broker" with no account of
 * its own. With nothing given now (amount 0, no account) the bills are paid
 * out of what he already holds.
 */
export function writeBrokerPayment(d: DB, a: Omit<MoneyArgs, "lockerId"> & {
  brokerId: string; lockerId?: string; lines: { purchaseId: string; amount: number }[]; txnId?: string;
}): void {
  const broker = (d.brokers ?? []).find(b => b.id === a.brokerId);
  if (!broker) return;
  const note = a.note?.trim();
  const txnId = a.txnId ?? uid("ltx_");
  const lines = a.lines.filter(x => x.amount > 0);
  if (a.amount > 0 && a.lockerId) {
    if (!d.lockerTransactions) d.lockerTransactions = [];
    d.lockerTransactions.push({
      id: txnId, lockerId: a.lockerId, type: "expense", amountInr: a.amount, currency: "INR",
      category: `Paid to broker ${broker.name}${lines.length ? ` — ${lines.length} bill${lines.length === 1 ? "" : "s"}` : ""}`,
      refType: "brokerPayment", refId: broker.id,
      note: note || undefined, recordedBy: a.userId, createdAt: a.at,
    });
  }
  // Each bill he pays: a supplier payment through him — no account of its own.
  for (const x of lines) {
    const p = d.purchases.find(y => y.id === x.purchaseId);
    if (!p) continue;
    if (!p.payments) p.payments = [];
    p.payments.push({
      id: uid("ppay_"), amountInr: r2(x.amount), lockerId: "",
      viaBrokerId: broker.id, brokerPaymentId: a.amount > 0 && a.lockerId ? txnId : undefined,
      recordedBy: a.userId, createdAt: a.at, note: `Via broker ${broker.name}${note ? ` · ${note}` : ""}`,
    });
  }
}

/** Money a broker hands over to us, into a rupee account (refType "brokerReceipt"). */
export function writeBrokerReceipt(d: DB, a: MoneyArgs & { brokerId: string }): void {
  const broker = (d.brokers ?? []).find(b => b.id === a.brokerId);
  if (!broker) return;
  if (!d.lockerTransactions) d.lockerTransactions = [];
  d.lockerTransactions.push({
    id: uid("ltx_"), lockerId: a.lockerId, type: "income", amountInr: a.amount, currency: "INR", category: `Received from ${broker.name} (broker)`,
    refType: "brokerReceipt", refId: broker.id, notClientPayment: true,
    note: a.note?.trim() || undefined, recordedBy: a.userId, createdAt: a.at,
  });
}

/** An entry in the account only — an owner's deposit or drawing, bank charges — under a category. */
export function writeAccountEntry(d: DB, a: MoneyArgs & { type: "income" | "expense"; category: string; voucherNo?: string }): boolean {
  const l = d.lockers.find(x => x.id === a.lockerId);
  if (!l) return false;
  if (!d.lockerTransactions) d.lockerTransactions = [];
  d.lockerTransactions.push({
    id: uid("ltx_"), lockerId: l.id, type: a.type, amountInr: a.amount, currency: ccy(l.currency),
    category: a.category || undefined, refType: "manual", voucherNo: a.voucherNo,
    note: a.note?.trim() || undefined, recordedBy: a.userId, createdAt: a.at,
  });
  return true;
}

/**
 * Move money between two of our accounts, any two currencies: `rate` is "1 of
 * the source's = rate of the destination's", so what arrives is amount × rate.
 * Both legs carry the same rate, voucher and transfer id.
 */
export function writeTransfer(d: DB, a: MoneyArgs & { toLockerId: string; rate?: number; voucherNo?: string }): boolean {
  const from = d.lockers.find(l => l.id === a.lockerId), to = d.lockers.find(l => l.id === a.toLockerId);
  if (!from || !to || from.id === to.id) return false;
  const cur = ccy(from.currency), toCcy = ccy(to.currency);
  const cross = cur !== toCcy;
  if (cross && !(Number(a.rate) > 0)) return false;
  const destAmount = cross ? roundCcy(a.amount * Number(a.rate), toCcy) : a.amount;
  const fx = cross ? rateFields(cur, toCcy, Number(a.rate)) : {};
  const xferId = uid("xfer_");
  const note = a.note?.trim() || undefined;
  if (!d.lockerTransactions) d.lockerTransactions = [];
  d.lockerTransactions.push({
    id: uid("ltx_"), lockerId: from.id, type: "transfer_out", amountInr: a.amount, currency: cur,
    category: "Transfer", refType: "transfer", transferId: xferId, voucherNo: a.voucherNo, pairedLockerId: to.id, note,
    ...fx, recordedBy: a.userId, createdAt: a.at,
  });
  d.lockerTransactions.push({
    id: uid("ltx_"), lockerId: to.id, type: "transfer_in", amountInr: destAmount, currency: toCcy,
    category: "Transfer", refType: "transfer", transferId: xferId, voucherNo: a.voucherNo, pairedLockerId: from.id, note,
    ...fx, recordedBy: a.userId, createdAt: a.at,
  });
  return true;
}

/** Tell a client (if they have a login) that their payment arrived. */
export function notifyClientPayment(d: DB, clientId: string, amountUsd: number, method: string, invoiceId: string | undefined, at: string): void {
  const clientUser = d.users.find(u => u.clientId === clientId);
  if (!clientUser) return;
  d.notifications.unshift({
    id: uid("n_"), userId: clientUser.id, title: "Payment Received",
    // Says what happened: against the invoice named, or held as their credit.
    body: invoiceId
      ? `${fmtMoney(amountUsd)} received via ${method} against invoice ${d.invoices.find(i => i.id === invoiceId)?.number ?? ""}.`.replace(" .", ".")
      : `${fmtMoney(amountUsd)} received via ${method} — held as credit on your account.`,
    type: "info", read: false, createdAt: at,
  });
}

