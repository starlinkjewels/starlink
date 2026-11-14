// Slow-moving stock — how long goods have sat. The trade's ageing: past 90 days a piece or a
// line is slow; past 180, old. A Ready Stock piece counts from the day it came onto the shelf;
// a line of stock (a gold purity, a lot, a grade) from the last time any of it went out — or,
// never used, the first time it came in. Read-only: nothing is written.
import type { ReadyStockItem, StockMovement } from "./db";
import { companyOf } from "./companies";

export const SLOW_DAYS = 90;
export const OLD_DAYS = 180;
const DAY = 86_400_000;
export const daysSince = (iso: string | undefined, now = Date.now()) => (iso ? Math.max(0, Math.floor((now - +new Date(iso)) / DAY)) : 0);

/** How many days a piece has been on the shelf (0 when none is left). */
export function pieceAge(item: Pick<ReadyStockItem, "createdAt" | "quantity">, now = Date.now()): number {
  return item.quantity > 0 ? daysSince(item.createdAt, now) : 0;
}
export type AgeBand = "fresh" | "slow" | "old";
export const ageBand = (days: number): AgeBand => (days >= OLD_DAYS ? "old" : days >= SLOW_DAYS ? "slow" : "fresh");

/**
 * When a line of stock last moved out (to a factory, an order, a sale…), and when it first came in.
 * Out = anything that is not an arrival; a manual top-up or a count up is an arrival.
 */
export function lineLastMoves(movements: StockMovement[], material: string, keys: string[], companyId?: string): { lastOut?: string; firstIn?: string } {
  const set = new Set(keys);
  let lastOut: string | undefined, firstIn: string | undefined;
  for (const m of movements) {
    if (m.material !== material || !set.has(m.purityOrQuality)) continue;
    if (companyId && companyId !== "all" && companyOf(m) !== companyId) continue;
    const incoming = m.type === "purchase_in" || (m.type === "adjustment" && m.quantity > 0);
    if (incoming) { if (!firstIn || m.createdAt < firstIn) firstIn = m.createdAt; }
    else if (m.type !== "order_direct_use" && (!lastOut || m.createdAt > lastOut)) lastOut = m.createdAt;
  }
  return { lastOut, firstIn };
}
/** Days a line of stock has sat since it last moved out (or came in, never used). */
export function lineIdleDays(movements: StockMovement[], material: string, keys: string[], companyId?: string, now = Date.now()): number {
  const { lastOut, firstIn } = lineLastMoves(movements, material, keys, companyId);
  return daysSince(lastOut ?? firstIn, now);
}
