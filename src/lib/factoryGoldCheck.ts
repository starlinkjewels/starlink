// Factory gold — the agreed making wastage and the gold check (the trade's standard way to keep a
// job-work factory's gold honest).
//
// · Agreed wastage % (Factory.wastagePct): credited to the factory on each piece at Final Approval,
//   on the fine gold in it, and part of the piece's cost (lib/pure/accounts.ts finishWastageFine).
// · Gold check: now and then the factory's gold is counted (what they hold, in fine grams, by weighing
//   it or by their own statement) against our book (factoryFineGoldBalance). A shortfall is gold lost
//   beyond the agreed wastage; one above GOLD_CHECK_TOLERANCE_PCT of the gold given since the last
//   check is flagged. A check records and flags — it changes no balance.
import { loadDb, uid, updateDb, type DB, type Factory, type FactoryGoldCheck } from "./db";
import { factoryFineGoldBalance } from "./pure/accounts";
import { toPureGold } from "./pure/basics";

/** A shortfall above this % of the gold given since the last check is flagged (a well-run floor runs 0.3–0.5%). */
export const GOLD_CHECK_TOLERANCE_PCT = 0.5;
const r3 = (n: number) => Math.round(n * 1000) / 1000;

/** Why an agreed wastage % can't be kept; null when it can (blank = none). */
export function wastageProblem(v: number | undefined): string | null {
  if (v == null) return null;
  if (!Number.isFinite(v) || v < 0 || v > 20) return "Agreed wastage: a % from 0 to 20 (blank = none)";
  return null;
}

/** Fine gold given to the factory (not from its own pool) after `since` — what a shortfall is a % of. */
export function goldGivenSince(db: Pick<DB, "materialIssuances">, factoryId: string, since?: string): number {
  const from = since ? +new Date(since) : 0;
  return r3((db.materialIssuances ?? [])
    .filter(i => i.factoryId === factoryId && i.material === "gold" && i.source !== "factoryPool" && +new Date(i.issuedAt) > from)
    .reduce((t, i) => t + toPureGold(i.quantityIssued, i.purityOrQuality), 0));
}

/** How a check reads: short beyond the tolerance, short within it, square, or more than the book. */
export function goldCheckState(c: Pick<FactoryGoldCheck, "diff" | "givenSince">): "flag" | "short" | "ok" | "over" {
  if (c.diff > 0.0005) return "over";
  if (c.diff > -0.0005) return "ok";
  const pct = c.givenSince > 0 ? (-c.diff / c.givenSince) * 100 : Infinity;
  return pct > GOLD_CHECK_TOLERANCE_PCT ? "flag" : "short";
}

/** The shortfall as a % of the gold given since the last check (null when nothing was given). */
export function shortPct(c: Pick<FactoryGoldCheck, "diff" | "givenSince">): number | null {
  return c.givenSince > 0 ? Math.round((-c.diff / c.givenSince) * 10000) / 100 : null;
}

/** A check, as sent to the factory to confirm (WhatsApp) — the book, what they hold, the gap. Never a price. */
export function goldCheckText(c: FactoryGoldCheck, factoryName: string, from: string): string {
  const g = (n: number) => `${r3(n).toFixed(3)} g`;
  const day = new Date(c.at).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
  const gap = c.diff < -0.0005 ? `Short: ${g(-c.diff)}` : c.diff > 0.0005 ? `More than our book: ${g(c.diff)}` : "Square — nothing short";
  return [
    `Gold check — ${factoryName}, ${day}`,
    `Fine gold (24K) with you as per our book: ${g(c.book)}`,
    `Fine gold you hold: ${g(c.actual)}`,
    gap,
    "",
    `Please confirm. — ${from}`,
  ].join("\n");
}

/** Record a gold check: the book now, what the factory holds, the gap. Changes no balance. */
export function addGoldCheck(factory: Pick<Factory, "id" | "openingFineGold" | "goldChecks">, actual: number, note: string, byName: string): FactoryGoldCheck {
  if (!(actual >= 0) || !Number.isFinite(actual)) throw new Error("Enter the fine gold they hold — 0 or more grams");
  const db = loadDb();
  const book = factoryFineGoldBalance(db.materialIssuances ?? [], factory.id, factory.openingFineGold);
  const last = (factory.goldChecks ?? [])[(factory.goldChecks ?? []).length - 1];
  const check: FactoryGoldCheck = {
    id: uid("gc_"), at: new Date().toISOString(), book: r3(book), actual: r3(actual), diff: r3(actual - book),
    givenSince: goldGivenSince(db, factory.id, last?.at), ...(note.trim() ? { note: note.trim() } : {}), byName,
  };
  updateDb(d => {
    const f = d.factories.find(x => x.id === factory.id);
    if (f) f.goldChecks = [...(f.goldChecks ?? []), check];
  });
  return check;
}
