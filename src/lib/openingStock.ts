// Correcting or removing an opening-stock entry — material already owned when
// the app started (Buy & Assign → Opening stock). It has no supplier, no bill
// and no payment behind it, so it is the one stock movement corrected where it
// stands: its own row is rewritten and the stock counter moves by the
// difference (adjustStockCounter), floor-checked like any issue.
//
// The one thing that can make a correction wrong is stock already used: an
// opening of 10 g that orders have since drawn 8 g from cannot come down to
// 5 g without the history running below zero. That is refused, with how much
// can still come off.
import { updateDb, dayOf, type DB, type StockMovement } from "./db";
import { fmtQty, materialName, materialUnit } from "./materials";
import { fmtMoneyInr } from "./manufacturing";
import { adjustStockCounter } from "./stock";

const r3 = (n: number) => Math.round(n * 1000) / 1000;
const EPS = 0.0005;
const coOf = (m: Pick<StockMovement, "companyId">) => m.companyId || "main";

/** An opening-stock row — the only stock movement corrected on its own. */
export function isOpeningMovement(m: Pick<StockMovement, "refType" | "type">): boolean {
  return m.refType === "opening" && m.type === "purchase_in";
}

/** The same bucket of the same company's stock: what this row's balance is part of. */
function bucketMoves(db: DB, m: StockMovement): StockMovement[] {
  return (db.stockMovements ?? []).filter(x =>
    x.material === m.material && x.purityOrQuality === m.purityOrQuality && coOf(x) === coOf(m));
}

/** In time order, as the Stock page's ledger reads them: an IN before an OUT
 *  at the same moment, then by id — so the balances here are the ones shown. */
function chrono(list: StockMovement[]): StockMovement[] {
  const inRank = (x: StockMovement) => (x.type === "purchase_in" || (x.type === "adjustment" && x.quantity > 0) ? 0 : 1);
  return [...list].sort((a, b) =>
    (+new Date(a.createdAt) - +new Date(b.createdAt)) || (inRank(a) - inRank(b)) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}
const signOf = (x: StockMovement) => (x.type === "purchase_in" ? 1 : x.type === "adjustment" ? Math.sign(x.quantity) : -1);

/** The lowest the running balance ever goes (never above zero). */
function lowest(list: StockMovement[]): number {
  let bal = 0, low = 0;
  for (const x of chrono(list)) {
    bal = r3(bal + signOf(x) * Math.abs(x.quantity));
    low = Math.min(low, bal);
  }
  return low;
}

/**
 * How much of this opening figure can still come off: the lowest the stock
 * stood at from this entry onward. Whatever went below that was issued, used
 * or sold out of it.
 */
export function openingRoom(db: DB, m: StockMovement): number {
  let bal = 0, seen = false, low = Infinity;
  for (const x of chrono(bucketMoves(db, m))) {
    bal = r3(bal + signOf(x) * Math.abs(x.quantity));
    if (x.id === m.id) seen = true;
    if (seen) low = Math.min(low, bal);
  }
  return seen ? Math.max(0, r3(Math.min(low, m.quantity))) : 0;
}

/**
 * Why this change would be refused, or undefined when it is fine. `next` is
 * the corrected figure and moment; null is removing the entry altogether.
 * A change may not take the history below zero anywhere — nor, on older
 * records that already dip below, any further than it already goes.
 */
export function openingRefusal(db: DB, m: StockMovement, next: { quantity: number; createdAt: string } | null): string | undefined {
  const list = bucketMoves(db, m);
  const changed = next
    ? list.map(x => (x.id === m.id ? { ...x, quantity: next.quantity, createdAt: next.createdAt } : x))
    : list.filter(x => x.id !== m.id);
  const before = lowest(list), after = lowest(changed);
  if (after >= -EPS || after >= before - EPS) return undefined;
  const unit = materialUnit(db.settings, m.material);
  const room = openingRoom(db, m);
  if (!next) {
    return `Only ${fmtQty(room, unit)} of this is still in stock — the rest has since been issued, used or sold. Correct it down to what is left, or cancel those first.`;
  }
  if (next.quantity < m.quantity - EPS) {
    return `At most ${fmtQty(room, unit)} can come off — the rest has since been issued, used or sold. Cancel those first to take off more.`;
  }
  return "On that date the stock would run below zero — it was already being used before then. Keep an earlier date.";
}

/** What removing it changes, spelled out before it is confirmed. */
export function openingDeleteImpact(db: DB, m: StockMovement): string[] {
  const unit = materialUnit(db.settings, m.material);
  const name = m.material === "gold" || m.material === "diamond" ? m.material : materialName(db.settings, m.material);
  return [
    `• ${fmtQty(m.quantity, unit)} ${m.purityOrQuality} ${name} comes out of stock`,
    ...(m.valueInr ? [`• its ${fmtMoneyInr(m.valueInr)} opening value leaves the stock ledger`] : []),
    "• nothing else changes — opening stock has no supplier, bill or payment behind it",
  ];
}

/** The chosen day, keeping the time of day the entry already had so its place
 *  among the same day's entries does not move. */
function onDay(day: string, iso: string): string {
  if (!day || day === dayOf(iso)) return iso;
  const o = new Date(iso);
  const [y, mo, d] = day.split("-").map(Number);
  return new Date(y, (mo || 1) - 1, d || 1, o.getHours(), o.getMinutes(), o.getSeconds(), o.getMilliseconds()).toISOString();
}

export interface OpeningEdit {
  quantity: number;
  /** ₹ valuation; 0 or unset clears it. */
  valueInr?: number;
  /** yyyy-mm-dd, as a date input gives it. */
  date: string;
  note?: string;
}

/** Correct an opening-stock entry: its own row, and the stock counter by the difference. */
export async function editOpeningStock(db: DB, m: StockMovement, edit: OpeningEdit): Promise<void> {
  if (!isOpeningMovement(m)) throw new Error("Only an opening-stock entry can be corrected here.");
  const quantity = r3(edit.quantity);
  if (!(quantity > 0)) throw new Error("Enter the opening quantity.");
  const createdAt = onDay(edit.date, m.createdAt);
  const refused = openingRefusal(db, m, { quantity, createdAt });
  if (refused) throw new Error(refused);

  // The counter first: a decrease is floor-checked and may fail, and then
  // nothing else has changed.
  await adjustStockCounter({
    material: m.material, companyId: m.companyId, purityOrQuality: m.purityOrQuality, delta: r3(quantity - m.quantity),
  }, db.stockMovements);

  updateDb(d => {
    const live = (d.stockMovements ?? []).find(x => x.id === m.id);
    if (!live) return;
    live.quantity = quantity;
    live.createdAt = createdAt;
    const value = Math.round(Number(edit.valueInr) || 0);
    if (value > 0) live.valueInr = value; else delete live.valueInr;
    const note = edit.note?.trim();
    if (note) live.note = note; else delete live.note;
  });
}

/** Remove an opening-stock entry: its row goes, and its quantity leaves the counter. */
export async function deleteOpeningStock(db: DB, m: StockMovement): Promise<void> {
  if (!isOpeningMovement(m)) throw new Error("Only an opening-stock entry can be removed here.");
  const refused = openingRefusal(db, m, null);
  if (refused) throw new Error(refused);
  await adjustStockCounter({
    material: m.material, companyId: m.companyId, purityOrQuality: m.purityOrQuality, delta: -m.quantity,
  }, db.stockMovements);
  updateDb(d => {
    d.stockMovements = (d.stockMovements ?? []).filter(x => x.id !== m.id);
  });
}
