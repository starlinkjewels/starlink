// GENERATED from src/lib/pure/basics.ts by functions/scripts/sync-shared.cjs - do not edit here.
/**
 * Pure helpers — no Firebase, no app state, nothing but arithmetic — shared by
 * the app and the server (functions/), so both work a figure out the same way.
 */
import type { OpeningBalanceInfo } from "./types";

export const KARAT_PURITY: Record<number, number> = {
  9: 0.375, 10: 0.417, 14: 0.585, 18: 0.75, 22: 0.916, 24: 1,
};

/** Grams of a given karat → grams of pure (24KT) gold. Unknown karat → treat as pure. */
export function toPureGold(grams: number, karat: string | number): number {
  const n = typeof karat === "number" ? karat : parseInt(String(karat), 10);
  const pct = KARAT_PURITY[n] ?? 1;
  return Math.round(grams * pct * 1000) / 1000;
}

/** Grams at an explicit purity (parts-per-1000, e.g. 750 for 18K, or 748 for a
 *  factory's measured touch) → pure (24KT) grams. Lets staff enter the real
 *  purity the factory reports instead of the textbook karat percentage. */
export function pureFromPurity(grams: number, purityPerMille: number): number {
  return Math.round(grams * (purityPerMille / 1000) * 1000) / 1000;
}

/** Opening amount the counterparty owes US (debit side), else 0. */
export function openingDebitAmt(e?: OpeningBalanceInfo): number {
  return e?.openingBalance && e.openingDir !== "credit" ? Math.abs(e.openingBalance) : 0;
}

/** Opening amount WE owe the counterparty (credit / their advance), else 0. */
export function openingCreditAmt(e?: OpeningBalanceInfo): number {
  return e?.openingBalance && e.openingDir === "credit" ? Math.abs(e.openingBalance) : 0;
}

/** True when a non-zero opening balance is set — used to decide whether to
 *  render the opening ledger line. */
export function hasOpeningBalance(e?: OpeningBalanceInfo): boolean {
  return !!e?.openingBalance && Math.abs(e.openingBalance) > 0;
}
