import type { DB, Expense, User } from "./db";
import type { PermAction } from "./permissions";
import type { ModuleKey } from "./modules";

type Can = (module: ModuleKey, action?: PermAction) => boolean;

/**
 * Who may correct or delete an expense — one rule wherever an expense is
 * listed (Expenses, Payments → Expenses, an employee's salary ledger). The
 * Expenses page used to allow only your own, while Payments let anyone who
 * could delete payments delete anyone's; the same expense could be removable
 * in one tab and not the other.
 *
 *  • an admin — any expense;
 *  • your own — when your role may edit / delete expenses (as the Expenses
 *    page always required);
 *  • someone else's — only a role that manages payments (as Payments →
 *    Expenses always required); Expenses access alone never reached others'.
 *
 * Returns why not (shown under the greyed action), or nothing when allowed.
 */
export function expenseBlock(
  db: Pick<DB, "users">, me: Pick<User, "id" | "role"> | null | undefined, can: Can,
  e: Pick<Expense, "employeeId">, action: "edit" | "delete",
): string | undefined {
  if (!me) return "Sign in again to change this";
  if (me.role === "admin") return undefined;
  if (e.employeeId === me.id) return can("expenses", action) ? undefined : `Your access doesn't let you ${action} expenses`;
  if (can("payments", action)) return undefined;
  const by = db.users.find(u => u.id === e.employeeId)?.name ?? "someone else";
  return `Added by ${by} — only they or an admin can ${action}`;
}
