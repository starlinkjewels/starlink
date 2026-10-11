import { useAuth } from "@/lib/auth";
import { useDb } from "@/hooks/useDb";
import { can, type PermAction } from "@/lib/permissions";
import type { ModuleKey } from "@/lib/modules";

/**
 * Whether the signed-in person may do something in a section — for showing or
 * hiding a button. Re-reads on every change, so editing a role takes effect on
 * that employee's screen the moment it is saved.
 *
 *   const can = useCan();
 *   {can("clients", "delete") && <DeleteButton />}
 */
export function useCan(): (module: ModuleKey, action?: PermAction) => boolean {
  const { user } = useAuth();
  const db = useDb();
  return (module, action = "view") => can(user, db.roles ?? [], module, action);
}
