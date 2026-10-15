import { useAuth } from "@/lib/auth";
import { useDb } from "@/hooks/useDb";
import { can, type PermAction } from "@/lib/permissions";
import { moduleForPath, type ModuleKey } from "@/lib/modules";
import { useLocation } from "react-router-dom";

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

/**
 * Whether this page may offer downloads and prints (PDF, Excel, bills, bands,
 * labels). An admin and a client always may — a client's portal is not decided
 * by access; an employee when their access gives Export in this section (the
 * page's own, unless one is named). Offering a button that would only refuse
 * is worse than not offering it, so every export button asks this first.
 */
export function useMayExport(module?: ModuleKey): boolean {
  const { user } = useAuth();
  const db = useDb();
  const loc = useLocation();
  if (!user || user.role !== "employee") return true;
  return can(user, db.roles ?? [], module ?? moduleForPath(loc.pathname), "export");
}
