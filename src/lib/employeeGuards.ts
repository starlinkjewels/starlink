import { toast } from "sonner";
import { collectionsFresh, loadDb, updateDb, type DB, type User } from "./db";
import { isAdminEmail } from "./firebase";
import { confirmBox } from "./confirm";
import { CHECKING, STILL_LOADING, recordsReady } from "./actionHints";

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;

/** What the check reads beyond the people, clients and orders the app opens
 *  with. It arrives by itself in the first seconds after sign-in; until then
 *  it reads as empty — so Delete waits ("Checking…"). */
const EMPLOYEE_REF_COLS = ["expenses"] as const;
/** …and what the question names (their open tasks), so it says it right. */
const EMPLOYEE_DELETE_COLS = [...EMPLOYEE_REF_COLS, "tasks"] as const;

/**
 * Why this person cannot be deleted, or nothing when they can. Someone the
 * books still point at — orders or clients in their name, salary paid to them
 * — is deactivated instead: deleting them would leave those records naming
 * nobody, and their salary ledger with nowhere to be read.
 */
export function employeeDeleteBlock(db: DB, u: User): string | undefined {
  if (isAdminEmail(u.email)) return "An owner can't be deleted";
  if (u.role === "admin") return "Remove admin first";
  const orders = db.orders.filter(o => o.assignedEmployeeId === u.id).length;
  const clients = db.clients.filter(c => c.accountManagerId === u.id).length;
  const assigned = [orders && plural(orders, "order"), clients && plural(clients, "client")].filter(Boolean);
  if (assigned.length) return `Assigned to ${assigned.join(" / ")} — deactivate instead`;
  if (!collectionsFresh(EMPLOYEE_REF_COLS)) return CHECKING;
  const paid = (db.expenses ?? []).filter(e => e.paidToEmployeeId === u.id).length;
  if (paid) return `Has ${plural(paid, "salary payment")} — deactivate instead`;
  return undefined;
}

/** Ask, with what it changes, then delete. True once they are gone. */
export async function confirmDeleteEmployee(u: User): Promise<boolean> {
  // Everything the check reads must be here, or "no salary paid" is a guess.
  if (!(await recordsReady(EMPLOYEE_DELETE_COLS))) { toast.error(STILL_LOADING); return false; }
  const db = loadDb();
  const live = db.users.find(x => x.id === u.id);
  if (!live) { toast.error("They are no longer on the team"); return false; }
  const block = employeeDeleteBlock(db, live);
  if (block) { toast.error(block); return false; }
  const tasks = (db.tasks ?? []).filter(t => t.assignedTo === live.id && !t.completed).length;
  const recorded = (db.expenses ?? []).filter(e => e.employeeId === live.id).length;
  const ok = await confirmBox([
    `Delete ${live.name}?`, "",
    `• ${live.name} is removed from the team`,
    ...(live.authUid ? ["• their login stops working"] : []),
    ...(tasks ? [`• ${plural(tasks, "open task")} assigned to them are left with nobody`] : []),
    ...(recorded ? [`• the ${plural(recorded, "expense")} they recorded stay, without their name`] : []),
    "• no orders, clients or salary payments are linked to them, so nothing else changes",
    "", "This cannot be undone — deactivating keeps their record instead.",
  ]);
  if (!ok) return false;
  let gone = false;
  updateDb(d => {
    // Checked again on the live record: an order or a salary payment may have
    // been put in their name while the question was open.
    const x = d.users.find(y => y.id === live.id);
    if (!x || employeeDeleteBlock(d, x)) return;
    d.users = d.users.filter(y => y.id !== live.id);
    gone = true;
  });
  if (!gone) { toast.error("Could not delete — something was recorded for them meanwhile"); return false; }
  toast.success(`${live.name} deleted`);
  return true;
}
