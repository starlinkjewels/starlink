import { ACTION_LABEL, type PermAction } from "./permissions";
import { moduleLabel, type ModuleKey } from "./modules";

/**
 * The line under a menu action someone's access doesn't reach. An action they
 * may not use is shown greyed with this, never left out — otherwise nobody can
 * tell "not allowed" from "not possible", or ask for the right access.
 *   needsAccess("clients", "delete") → "Needs Clients → Delete access"
 */
export function needsAccess(module: ModuleKey, action: PermAction): string {
  return `Needs ${moduleLabel(module)} → ${ACTION_LABEL[action]} access`;
}
