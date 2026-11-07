/**
 * Employee advances (upad) — money given to a team member ahead of their pay,
 * which they owe back. Not a cost: it leaves the account but stays the
 * business's money until it is
 *   - repaid in cash (money back into an account),
 *   - cut from their salary (the full salary is the cost; only the rest is paid), or
 *   - written off (the main admin, with a reason — then it becomes a cost).
 *
 * How each is kept, so the books stay right everywhere with no new collection:
 *   given     an account entry out, refType "employeeAdvance", refId = the person.
 *             Never an Expense, so it is not in Expenses or Profit & Loss.
 *   repaid    an account entry in, refType "employeeRepay", refId = the person.
 *   cut       an Expense with NO account (no money moved), category as the
 *             salary's, `advanceRecovery` — part of their salary, a cost.
 *   written   an Expense with NO account, `advanceWriteOff` — a cost.
 *   opening   owed before the app: User.openingAdvance (its currency and date).
 *
 * What they owe is worked out from those, never stored. Each currency apart:
 * an advance from a dollar account is owed back in dollars.
 */
import { uid, type DB, type Expense, type LockerTransaction, type User } from "./db";
import { ccy, type CurrencyCode } from "./currency";
import { writeExpense } from "./partyPayments";

const r2 = (n: number) => Math.round(n * 100) / 100;

export type AdvanceKind = "opening" | "given" | "repaid" | "cut" | "writeoff";

export interface AdvanceRow {
  /** The account entry's id (given / repaid) or the expense's (cut / write-off). */
  id: string;
  kind: AdvanceKind;
  date: string;
  /** + raises what they owe (given, opening); − lowers it. */
  amount: number;
  currency: CurrencyCode;
  note?: string;
  lockerId?: string;
}

export const ADVANCE_LABEL: Record<AdvanceKind, string> = {
  opening: "Owed before the app (brought forward)",
  given: "Advance given",
  repaid: "Repaid in cash",
  cut: "Cut from salary",
  writeoff: "Written off",
};

export const isAdvanceTxn = (t: Pick<LockerTransaction, "refType">) => t.refType === "employeeAdvance" || t.refType === "employeeRepay";

/** Every line of a person's advance account, oldest first. */
export function advanceRows(db: Pick<DB, "lockerTransactions" | "expenses">, u: Pick<User, "id" | "openingAdvance" | "openingAdvanceCurrency" | "openingAdvanceDate" | "createdAt">): AdvanceRow[] {
  const rows: AdvanceRow[] = [];
  if ((u.openingAdvance ?? 0) > 0) {
    rows.push({ id: "__opening-advance", kind: "opening", date: u.openingAdvanceDate || u.createdAt, amount: u.openingAdvance!, currency: ccy(u.openingAdvanceCurrency) });
  }
  for (const t of db.lockerTransactions ?? []) {
    if (t.refId !== u.id || !isAdvanceTxn(t)) continue;
    const given = t.refType === "employeeAdvance";
    rows.push({ id: t.id, kind: given ? "given" : "repaid", date: t.createdAt, amount: given ? t.amountInr : -t.amountInr, currency: ccy(t.currency), note: t.note, lockerId: t.lockerId });
  }
  for (const e of db.expenses ?? []) {
    if (e.paidToEmployeeId !== u.id || !(e.advanceRecovery || e.advanceWriteOff)) continue;
    rows.push({ id: e.id, kind: e.advanceWriteOff ? "writeoff" : "cut", date: e.createdAt, amount: -e.amount, currency: ccy(e.currency), note: e.note ?? e.title });
  }
  return rows.sort((a, b) => (a.kind === "opening" ? -1 : b.kind === "opening" ? 1 : +new Date(a.date) - +new Date(b.date)));
}

/** What they owe now, by currency — only currencies with something owed (or over-repaid). */
export function advanceOwed(db: Pick<DB, "lockerTransactions" | "expenses">, u: Parameters<typeof advanceRows>[1], upTo?: string): Map<CurrencyCode, number> {
  const out = new Map<CurrencyCode, number>();
  for (const r of advanceRows(db, u)) {
    if (upTo && r.kind !== "opening" && r.date.slice(0, 10) > upTo) continue;
    out.set(r.currency, r2((out.get(r.currency) ?? 0) + r.amount));
  }
  for (const [k, v] of out) if (Math.abs(v) < 0.005) out.delete(k);
  return out;
}

/** What they owe in one currency (0 when nothing). */
export function owedIn(db: Pick<DB, "lockerTransactions" | "expenses">, u: Parameters<typeof advanceRows>[1], currency: CurrencyCode): number {
  return advanceOwed(db, u).get(currency) ?? 0;
}

/**
 * Why changing (or, with `next` null, deleting) an advance line would leave the
 * books wrong, or nothing. Never below nothing owed — an advance given cannot
 * shrink under what has already come back against it — and an advance stays
 * in its currency (a rupee advance is owed back in rupees).
 */
export function advanceChangeProblem(
  d: Pick<DB, "lockerTransactions" | "expenses" | "users" | "lockers">,
  lineId: string,
  next: { amount?: number; lockerId?: string } | null,
): string | undefined {
  const t = (d.lockerTransactions ?? []).find(x => x.id === lineId && isAdvanceTxn(x));
  const e = t ? undefined : (d.expenses ?? []).find(x => x.id === lineId && (x.advanceRecovery || x.advanceWriteOff));
  if (!t && !e) return undefined;
  const who = d.users.find(u => u.id === (t ? t.refId : e!.paidToEmployeeId));
  if (!who) return undefined;
  const currency = ccy(t ? t.currency : e!.currency);
  if (t && next?.lockerId && next.lockerId !== t.lockerId) {
    const to = d.lockers.find(l => l.id === next.lockerId);
    if (to && ccy(to.currency) !== currency) return `This advance is in ${currency} — move it only to an account in ${currency}.`;
  }
  const rows = advanceRows(d, who).filter(r => r.currency === currency);
  let owed = 0;
  for (const r of rows) {
    if (r.id !== lineId) { owed += r.amount; continue; }
    if (!next) continue; // deleted
    const amt = next.amount ?? Math.abs(r.amount);
    owed += r.amount >= 0 ? amt : -amt;
  }
  if (owed < -0.005) {
    return next
      ? `That would take ${who.name}'s advance below nothing — more would have come back than was given. Change the repayment or cut first.`
      : `${who.name} has already repaid or had cut more than would be left given — delete those first.`;
  }
  return undefined;
}

/** Salary and pay lines on their salary ledger: everything paid to them except a write-off
 *  (that is the advance's, not pay). A cut from salary IS salary — its cash just wasn't handed over. */
export const isPayLine = (e: Pick<Expense, "advanceWriteOff">) => !e.advanceWriteOff;

const nameOf = (d: Pick<DB, "users">, id: string) => d.users.find(u => u.id === id)?.name ?? "employee";

/** Give an advance from an account. Inside updateDb. */
export function writeAdvance(d: DB, a: { employeeId: string; lockerId: string; amount: number; at: string; note?: string; userId: string }): LockerTransaction | undefined {
  const l = d.lockers.find(x => x.id === a.lockerId);
  if (!l || !(a.amount > 0)) return undefined;
  if (!d.lockerTransactions) d.lockerTransactions = [];
  const t: LockerTransaction = {
    id: uid("ltx_"), lockerId: l.id, type: "expense", amountInr: r2(a.amount), currency: ccy(l.currency),
    category: `Advance to ${nameOf(d, a.employeeId)}`, refType: "employeeAdvance", refId: a.employeeId,
    note: a.note?.trim() || undefined, recordedBy: a.userId, createdAt: a.at,
  };
  d.lockerTransactions.push(t);
  return t;
}

/** Money they hand back, into an account. Inside updateDb. */
export function writeRepayment(d: DB, a: { employeeId: string; lockerId: string; amount: number; at: string; note?: string; userId: string }): LockerTransaction | undefined {
  const l = d.lockers.find(x => x.id === a.lockerId);
  if (!l || !(a.amount > 0)) return undefined;
  if (!d.lockerTransactions) d.lockerTransactions = [];
  const t: LockerTransaction = {
    id: uid("ltx_"), lockerId: l.id, type: "income", amountInr: r2(a.amount), currency: ccy(l.currency),
    category: `Advance repaid by ${nameOf(d, a.employeeId)}`, refType: "employeeRepay", refId: a.employeeId,
    // Not a client's money — never offered for matching to a client's bill.
    notClientPayment: true,
    note: a.note?.trim() || undefined, recordedBy: a.userId, createdAt: a.at,
  };
  d.lockerTransactions.push(t);
  return t;
}

/** Why a repayment, cut or write-off of `amount` can't be made, or nothing. It may not take more than they owe. */
export function recoveryProblem(db: Pick<DB, "lockerTransactions" | "expenses" | "users">, employeeId: string, currency: CurrencyCode, amount: number, editingId?: string): string | undefined {
  const u = db.users.find(x => x.id === employeeId);
  if (!u) return "That team member is not on file.";
  if (!(amount > 0)) return "Enter a valid amount.";
  // Editing a line: what they owe without it.
  const without = advanceRows(db, u).filter(r => r.id !== editingId && r.currency === currency).reduce((s, r) => s + r.amount, 0);
  const owed = r2(without);
  if (owed <= 0.005) return `${u.name} owes no advance in ${currency}.`;
  if (amount > owed + 0.005) return `${u.name} owes ${currency} ${owed.toLocaleString("en-IN")} of advance — that is the most that can come off.`;
  return undefined;
}

/**
 * Pay salary with part of it cut from their advance: the FULL salary is the
 * cost, only the rest leaves the account. Two lines on the salary ledger — the
 * cash paid, and the part cut (no account) — and the advance owed goes down
 * by the cut. Inside updateDb; check recoveryProblem first.
 */
export function writeSalaryWithCut(d: DB, a: { employeeId: string; lockerId: string; salary: number; cut: number; at: string; title: string; category: string; note?: string; userId: string }): void {
  const l = d.lockers.find(x => x.id === a.lockerId);
  const cash = r2(a.salary - a.cut);
  if (cash > 0) writeExpense(d, { lockerId: a.lockerId, amount: cash, title: a.title, category: a.category, note: a.note, userId: a.userId, at: a.at, paidToEmployeeId: a.employeeId });
  if (a.cut > 0) {
    d.expenses.push({
      id: uid("exp_"), title: `${a.title} — cut from advance`, amount: r2(a.cut), category: a.category,
      note: a.note?.trim() || undefined, employeeId: a.userId, paidToEmployeeId: a.employeeId,
      currency: ccy(l?.currency), createdAt: a.at, advanceRecovery: true,
    });
  }
}

/** Write what is left off (they left, it will not come back): a cost, the advance cleared. Inside updateDb. */
export function writeAdvanceWriteOff(d: DB, a: { employeeId: string; currency: CurrencyCode; amount: number; at: string; reason: string; userId: string }): void {
  d.expenses.push({
    id: uid("exp_"), title: `Advance written off — ${nameOf(d, a.employeeId)}`, amount: r2(a.amount), category: "Advance written off",
    note: a.reason.trim(), employeeId: a.userId, paidToEmployeeId: a.employeeId,
    currency: a.currency, createdAt: a.at, advanceWriteOff: true,
  });
}

/** The account entry an expense paid from an account made, or undefined. */
export function expenseTxn(d: Pick<DB, "lockerTransactions">, e: Pick<Expense, "id">): LockerTransaction | undefined {
  return (d.lockerTransactions ?? []).find(t => t.refType === "expense" && t.refId === e.id);
}

/** Why an old payment can't be moved to advances, or nothing. */
export function moveToAdvanceWhy(d: Pick<DB, "lockerTransactions">, e: Expense): string | undefined {
  if (!e.paidToEmployeeId) return "Not paid to a team member.";
  if (e.advanceRecovery || e.advanceWriteOff) return "Already part of the advance account.";
  if (!e.lockerId) return "Not paid from an account — nothing left the business to be owed back.";
  if (!expenseTxn(d, e)) return "Its account entry isn't found — correct it in Payments → Account entries first.";
  return undefined;
}

/**
 * An old payment that was really an advance (recorded as an expense before the
 * app kept advances): it becomes an advance they owe. The very same account
 * entry is kept — the money left on the same day, from the same account, for the
 * same amount — and only stops being an expense (out of Expenses and Profit &
 * Loss). Inside updateDb; check moveToAdvanceWhy first.
 */
export function moveToAdvance(d: DB, expenseId: string): boolean {
  const e = d.expenses.find(x => x.id === expenseId);
  if (!e || moveToAdvanceWhy(d, e)) return false;
  const t = expenseTxn(d, e)!;
  t.refType = "employeeAdvance";
  t.refId = e.paidToEmployeeId;
  t.category = `Advance to ${nameOf(d, e.paidToEmployeeId!)}`;
  if (!t.note && (e.note || e.title)) t.note = [e.title, e.note].filter(Boolean).join(" · ");
  d.expenses = d.expenses.filter(x => x.id !== e.id);
  return true;
}
