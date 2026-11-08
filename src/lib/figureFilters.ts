import type { Expense, LockerTransaction } from "./db";
import { isAdvanceTxn } from "./employeeAdvances";

/**
 * "Other people's salaries and expenses" (access switch fig.salaries): what
 * belongs to someone else on the team. Without the switch, an employee's lists
 * of money keep only their own.
 *
 * An expense is someone's: a salary or payment to a person is theirs (paid
 * to); anything else, the one who recorded it. An advance (upad) given or
 * repaid is the employee's it names.
 */
export function othersExpense(e: Pick<Expense, "employeeId" | "paidToEmployeeId">, me: string | undefined): boolean {
  if (e.paidToEmployeeId) return e.paidToEmployeeId !== me;
  return e.employeeId !== me;
}

export function othersAdvance(t: Pick<LockerTransaction, "refType" | "refId">, me: string | undefined): boolean {
  return isAdvanceTxn(t) && t.refId !== me;
}

/** A row or heading of a download, with the columns at `drop` left out unless `on`. */
export function keepCols<T>(on: boolean, drop: number[], list: T[]): T[] {
  return on ? list : list.filter((_, i) => !drop.includes(i));
}
