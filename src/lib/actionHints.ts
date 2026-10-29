import { toast } from "sonner";
import { ACTION_LABEL, type PermAction } from "./permissions";
import { moduleLabel, type ModuleKey } from "./modules";
import { collectionsFresh, collectionsReady } from "./db";

/**
 * The line under a menu action someone's access doesn't reach. An action they
 * may not use is shown greyed with this, never left out — otherwise nobody can
 * tell "not allowed" from "not possible", or ask for the right access.
 *   needsAccess("clients", "delete") → "Needs Clients → Delete access"
 */
export function needsAccess(module: ModuleKey, action: PermAction): string {
  return `Needs ${moduleLabel(module)} → ${ACTION_LABEL[action]} access`;
}

/**
 * Under a Delete / Cancel whose check reads records that are still arriving
 * after sign-in: greyed with this until they are here. Read early, they are
 * empty, and "nothing points at it" would be a guess.
 */
export const CHECKING = "Checking…";

/** The refusal when those records still haven't arrived by the time it runs. */
export const STILL_LOADING = "Still loading — try again in a moment";

/**
 * collectionsReady() for a click: while the records a delete or cancel checks
 * are still arriving, says so on screen — the wait can run to seconds, and a
 * button that seems to do nothing gets clicked again. True once all are here.
 */
export async function recordsReady(cols: readonly string[]): Promise<boolean> {
  if (collectionsFresh(cols)) return true;
  const t = toast.loading("Checking what's on record…");
  try {
    return await collectionsReady(cols);
  } finally {
    toast.dismiss(t);
  }
}
