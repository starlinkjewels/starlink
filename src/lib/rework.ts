// Repairs (rework) and the order's own finish record — kept apart.
//
// Final Approval writes one "finishing" record per order: a closed gold issue
// with source "factoryPool" carrying the piece's net weight and labour. A repair
// also writes gold "factoryPool" issues (gold from the factory's holding, or a
// labour-only line) — and they are added to the FRONT of the list. Looking up
// "the order's factoryPool gold issue" therefore found the REPAIR first: editing
// the actual details after a repair wrote the whole piece's weight into the
// repair's record and dropped its labour, and the factory's gold fell by the
// piece's fine weight. Every lookup of the finish record goes through here.
import type { MaterialIssuance } from "./db";

/** An issue that belongs to a repair, rather than the piece's first making. */
export function isReworkIssue(mi: Pick<MaterialIssuance, "rework" | "source" | "notes">): boolean {
  return !!mi.rework || mi.source === "rework" || /^Rework —/.test(mi.notes ?? "");
}

/**
 * The order's finishing record. The real one first; failing that, a repair's
 * record that already carries the finish (its `labour` — written there by the
 * old lookup), since on those orders that record IS the finish now.
 */
export function finishRecordOf<T extends MaterialIssuance>(issuances: T[], orderId: string): T | undefined {
  const pool = issuances.filter(i => i.orderId === orderId && i.material === "gold" && i.source === "factoryPool");
  return pool.find(i => !isReworkIssue(i)) ?? pool.find(i => isReworkIssue(i) && !!i.labour);
}
