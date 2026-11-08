import { toast } from "sonner";
import { loadDb } from "./db";
import { auth, isAdminEmail } from "./firebase";
import { can, hasFeature, limitsOf, type PermAction, type PermUser } from "./permissions";
import type { AccessLimits } from "./accessFeatures";
import { moduleForPath, type ModuleKey } from "./modules";

/**
 * Access checks for code that is not a component — the shared export and
 * print functions, chiefly. A component asks through useCan instead.
 */

/** The signed-in person, as the permission check needs them. */
export function currentPermUser(): PermUser | null {
  const fb = auth.currentUser;
  if (!fb) return null;
  if (isAdminEmail(fb.email)) return { role: "admin" };
  const u = loadDb().users.find(x => x.authUid === fb.uid);
  return u ? { id: u.id, role: u.role, roleId: u.roleId } : null;
}

/** Whether the signed-in person may do this in this section. */
export function allowed(module: ModuleKey, action: PermAction): boolean {
  return can(currentPermUser(), loadDb().roles ?? [], module, action);
}

/** Whether the signed-in person has one of the finer switches (lib/accessFeatures.ts). */
export function hasSwitch(key: string): boolean {
  return hasFeature(currentPermUser(), loadDb().roles ?? [], key);
}

/**
 * For the shared rules that take the person as an argument: undefined when
 * they may (an admin always; an employee with the switch), else the reason.
 * The switch is read for the signed-in person — whom these rules are always
 * asked about.
 */
export function switchWhy(user: { role: string } | null | undefined, key: string, what: string): string | undefined {
  if (user?.role === "admin") return undefined;
  if (user?.role === "employee" && hasSwitch(key)) return undefined;
  return `Your access does not include ${what}`;
}

/** The order steps the signed-in person may move — undefined: every step. */
export function myStepLimit(): string[] | undefined {
  const s = myLimits().stages;
  return s && s.length ? s : undefined;
}

/** The signed-in person's limits (none for an admin or a client). */
export function myLimits(): AccessLimits {
  return limitsOf(currentPermUser(), loadDb().roles ?? []);
}

/**
 * Whether a download or print may go ahead from the page it was started on.
 *
 * Every export in the app passes through here, so a role without Export in a
 * section downloads nothing from it, whichever button was pressed. Roles bind
 * employees only: an admin always may, and a client's portal is not decided by
 * roles at all, so neither is ever stopped here.
 */
export function exportAllowed(): boolean {
  const u = currentPermUser();
  if (!u || u.role !== "employee") return true;
  const module = moduleForPath(typeof window !== "undefined" ? window.location.pathname : "/");
  if (can(u, loadDb().roles ?? [], module, "export")) return true;
  toast.error("Your access does not include downloads from this section.");
  return false;
}
