import { toast } from "sonner";
import { loadDb } from "./db";
import { auth, isAdminEmail } from "./firebase";
import { can, type PermAction, type PermUser } from "./permissions";
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
