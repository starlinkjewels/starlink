import { toast } from "sonner";
import { ACTION_LABEL, type PermAction } from "./permissions";
import { moduleLabel, type ModuleKey } from "./modules";
import { anyHidden, collectionsFresh, collectionsReady } from "./db";

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

/** A check that needs money records the person's access doesn't show (writePolicy.ts READ_POLICY):
 *  it can't be answered from nothing, so it refuses — and says the real reason. */
export const HIDDEN_RECORDS = "Needs records your access doesn't show — ask an admin";

/** Under a Delete / Cancel whose check is still waiting on its records — or can never see them. */
export function checkingFor(cols: readonly string[]): string {
  return anyHidden(cols) ? HIDDEN_RECORDS : CHECKING;
}

/**
 * The refusal when those records still haven't arrived by the time it runs.
 * A live binding: recordsReady() sets it to HIDDEN_RECORDS when the records
 * are ones the person can't read (never arriving), so every caller's
 * toast.error(STILL_LOADING) says the real reason without changing each one.
 */
export let STILL_LOADING = "Still loading — try again in a moment";
const LOADING_TEXT = STILL_LOADING;

/**
 * collectionsReady() for a click: while the records a delete or cancel checks
 * are still arriving, says so on screen — the wait can run to seconds, and a
 * button that seems to do nothing gets clicked again. True once all are here.
 */
export async function recordsReady(cols: readonly string[]): Promise<boolean> {
  STILL_LOADING = anyHidden(cols) ? HIDDEN_RECORDS : LOADING_TEXT;
  if (collectionsFresh(cols)) return true;
  if (anyHidden(cols)) return false;
  const t = toast.loading("Checking what's on record…");
  try {
    return await collectionsReady(cols);
  } finally {
    toast.dismiss(t);
  }
}
