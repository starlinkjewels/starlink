import { toast } from "sonner";
import { updateDb, type DB, type User } from "./db";
import { isAdminEmail } from "./firebase";
import { confirmBox } from "./confirm";

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;

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
  const paid = (db.expenses ?? []).filter(e => e.paidToEmployeeId === u.id).length;
  if (paid) return `Has ${plural(paid, "salary payment")} — deactivate instead`;
  return undefined;
}

/** Ask, with what it changes, then delete. True once they are gone. */
export async function confirmDeleteEmployee(db: DB, u: User): Promise<boolean> {
  const block = employeeDeleteBlock(db, u);
  if (block) { toast.error(block); return false; }
  const tasks = (db.tasks ?? []).filter(t => t.assignedTo === u.id && !t.completed).length;
  const recorded = (db.expenses ?? []).filter(e => e.employeeId === u.id).length;
  const ok = await confirmBox([
    `Delete ${u.name}?`, "",
    `• ${u.name} is removed from the team`,
    ...(u.authUid ? ["• their login stops working"] : []),
    ...(tasks ? [`• ${plural(tasks, "open task")} assigned to them are left with nobody`] : []),
    ...(recorded ? [`• the ${plural(recorded, "expense")} they recorded stay, without their name`] : []),
    "• no orders, clients or salary payments are linked to them, so nothing else changes",
    "", "This cannot be undone — deactivating keeps their record instead.",
  ]);
  if (!ok) return false;
  updateDb(d => { d.users = d.users.filter(x => x.id !== u.id); });
  toast.success(`${u.name} deleted`);
  return true;
}
