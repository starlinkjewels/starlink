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
import { updateDb, loadDb, dayOf, type DB, type StockMovement } from "./db";
import { fmtQty, materialName, materialUnit, purchaseBucket } from "./materials";
import { fmtMoneyInr } from "./manufacturing";
import { adjustStockCounter } from "./stock";
import { lotKey, tidySpec, type LotSpec } from "./diamondLots";
import { addBags } from "./diamondBags";

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

/** Said when the entry moved on while the panel was open: the difference
 *  would be worked out from a figure that is no longer the one on file. */
export const OPENING_CHANGED = "This was changed by someone else — reopen and try again.";

/** Everything a correction is worked out from (the note aside — a remark
 *  changed meanwhile moves no stock). */
function openingBasis(m: StockMovement): string {
  return JSON.stringify([m.quantity, m.createdAt, m.material, m.purityOrQuality, coOf(m), m.type, m.refType ?? null, m.valueInr ?? 0]);
}

/** A correction or removal worked out against the entry on file. */
export interface OpeningPlan {
  id: string;
  basis: string;
  material: StockMovement["material"];
  companyId?: string;
  bucket: string;
  /** The corrected figure and moment; null when the entry is being removed. */
  next: { quantity: number; createdAt: string } | null;
  /** What the stock counter moves by. */
  delta: number;
}

/** The entry as it is on file, if it is still the one the panel opened. */
function liveOpening(live: DB, opened: StockMovement, gone: string): StockMovement | string {
  if (!isOpeningMovement(opened)) return "Only an opening-stock entry can be changed here.";
  const m = (live.stockMovements ?? []).find(x => x.id === opened.id);
  if (!m) return gone;
  if (!isOpeningMovement(m) || openingBasis(m) !== openingBasis(opened)) return OPENING_CHANGED;
  return m;
}

/** Work out a correction from the entry on file, or why it cannot be made.
 *  `opened` is the copy the panel opened with. Nothing is written. */
export function planOpeningEdit(live: DB, opened: StockMovement, edit: OpeningEdit): OpeningPlan | string {
  const m = liveOpening(live, opened, "This opening stock was removed by someone else — reopen and try again.");
  if (typeof m === "string") return m;
  const quantity = r3(edit.quantity);
  if (!(quantity > 0)) return "Enter the opening quantity.";
  const createdAt = onDay(edit.date, m.createdAt);
  const refused = openingRefusal(live, m, { quantity, createdAt });
  if (refused) return refused;
  return {
    id: m.id, basis: openingBasis(m), material: m.material, companyId: m.companyId, bucket: m.purityOrQuality,
    next: { quantity, createdAt }, delta: r3(quantity - m.quantity),
  };
}

/** Work out a removal from the entry on file, or why it cannot be made. */
export function planOpeningDelete(live: DB, opened: StockMovement): OpeningPlan | string {
  // Gone already: removing it again used to take its quantity off the
  // counter a second time.
  const m = liveOpening(live, opened, "This opening stock was already removed — nothing more to take off.");
  if (typeof m === "string") return m;
  const refused = openingRefusal(live, m, null);
  if (refused) return refused;
  return {
    id: m.id, basis: openingBasis(m), material: m.material, companyId: m.companyId, bucket: m.purityOrQuality,
    next: null, delta: -m.quantity,
  };
}

/** Where the app reads, saves and moves the counter; a check passes its own. */
export interface OpeningDeps {
  load?: () => DB;
  update?: (fn: (d: DB) => void) => unknown;
  adjust?: typeof adjustStockCounter;
}

/**
 * Move the counter and save the entry, in the order that can never leave the
 * counter showing stock the history does not have. A decrease is floor-checked
 * and may be refused, so it goes first — refused, nothing has changed — and is
 * given back if the entry turns out to have changed meanwhile. An increase
 * cannot be refused, so the entry is saved first: if the counter then fails to
 * follow, it is short rather than over, which the Stock page rebuilds from the
 * history (and a short counter heals itself at the next issue).
 */
async function carryOut(
  plan: OpeningPlan, replan: (d: DB) => OpeningPlan | string, write: (d: DB) => void,
  live: DB, deps: OpeningDeps,
): Promise<void> {
  const update = deps.update ?? updateDb;
  const adjust = deps.adjust ?? adjustStockCounter;
  const counter = (delta: number) => adjust({
    material: plan.material, companyId: plan.companyId, purityOrQuality: plan.bucket, delta,
  }, live.stockMovements ?? []);
  const unit = materialUnit(live.settings, plan.material);

  const out: { refused?: string } = {};
  const save = () => update(d => {
    const again = replan(d);
    if (typeof again === "string") { out.refused = again; return; }
    if (again.basis !== plan.basis || again.delta !== plan.delta) { out.refused = OPENING_CHANGED; return; }
    write(d);
  });

  if (plan.delta < 0) {
    await counter(plan.delta);
    save();
    if (out.refused) {
      try {
        await counter(-plan.delta);
      } catch {
        throw new Error(`${out.refused} The stock counter could not be given back the ${fmtQty(-plan.delta, unit)} ${plan.bucket} it was lowered by — use Recompute from history on the Stock page before trying again.`);
      }
      throw new Error(out.refused);
    }
    return;
  }

  save();
  if (out.refused) throw new Error(out.refused);
  if (plan.delta > 0) {
    try {
      await counter(plan.delta);
    } catch (e) {
      throw new Error(`Saved — but the stock counter did not go up by ${fmtQty(plan.delta, unit)} ${plan.bucket} (${e instanceof Error ? e.message : String(e)}). Use Recompute from history on the Stock page.`);
    }
  }
}

/** Correct an opening-stock entry: its own row, and the stock counter by the
 *  difference — worked out from the entry on file, not the panel's copy. */
export async function editOpeningStock(db: DB, m: StockMovement, edit: OpeningEdit, deps: OpeningDeps = {}): Promise<void> {
  const live = (deps.load ?? loadDb)();
  const plan = planOpeningEdit(live, m, edit);
  if (typeof plan === "string") throw new Error(plan);
  const next = plan.next!;
  await carryOut(plan, d => planOpeningEdit(d, m, edit), d => {
    const row = (d.stockMovements ?? []).find(x => x.id === plan.id);
    if (!row) return;
    row.quantity = next.quantity;
    row.createdAt = next.createdAt;
    const value = Math.round(Number(edit.valueInr) || 0);
    if (value > 0) row.valueInr = value; else delete row.valueInr;
    const note = edit.note?.trim();
    if (note) row.note = note; else delete row.note;
  }, live, deps);
}

/** Remove an opening-stock entry: its row goes, and its quantity leaves the counter. */
export async function deleteOpeningStock(db: DB, m: StockMovement, deps: OpeningDeps = {}): Promise<void> {
  const live = (deps.load ?? loadDb)();
  const plan = planOpeningDelete(live, m);
  if (typeof plan === "string") throw new Error(plan);
  await carryOut(plan, d => planOpeningDelete(d, m), d => {
    d.stockMovements = (d.stockMovements ?? []).filter(x => x.id !== plan.id);
  }, live, deps);
}

/**
 * Move a loose-diamond opening entry into another bag — its shape, mm, sieve,
 * colour or clarity were entered wrong (or not at all) — and set its piece
 * count. The stones leave the old lot and join the new one; the old lot must
 * still hold them (nothing issued, used or sold out of it since), exactly as
 * removing the entry would require. Pieces alone change nothing else.
 */
export async function refileOpeningLot(opened: StockMovement, spec: LotSpec, pieces: number | undefined, deps: OpeningDeps & { userId?: string } = {}): Promise<void> {
  const live = (deps.load ?? loadDb)();
  const m = liveOpening(live, opened, "This opening stock was removed by someone else — reopen and try again.");
  if (typeof m === "string") throw new Error(m);
  if (m.material !== "diamond" || m.purityOrQuality === "Certified") throw new Error("Only loose diamonds are kept in bags.");
  const key = lotKey(spec);
  const parts = tidySpec(spec);
  const lotRow = Object.fromEntries(Object.entries(parts).filter(([, v]) => v)) as StockMovement["lot"];
  const pcs = pieces != null && pieces > 0 ? Math.round(pieces) : undefined;
  const update = deps.update ?? updateDb;

  // Same lot: only the parts kept on the row and the piece count — no stones move.
  if (key === m.purityOrQuality) {
    update(d => {
      const row = (d.stockMovements ?? []).find(x => x.id === m.id);
      if (!row) return;
      row.lot = lotRow;
      if (pcs) row.pieces = pcs; else delete row.pieces;
    });
    return;
  }

  // Into another bag: the old one must still hold these stones.
  const refused = openingRefusal(live, m, null);
  if (refused) throw new Error(refused.replace("Correct it down to what is left, or cancel those first.", "Only what is still in the bag can move to another one."));
  const adjust = deps.adjust ?? adjustStockCounter;
  const moves = live.stockMovements ?? [];
  // Out of the old bag first (floor-checked); if the entry moved on meanwhile, give it back.
  await adjust({ material: "diamond", companyId: m.companyId, purityOrQuality: m.purityOrQuality, delta: -m.quantity }, moves);
  let changed = false;
  update(d => {
    const row = (d.stockMovements ?? []).find(x => x.id === m.id);
    if (!row || openingBasis(row) !== openingBasis(m)) { changed = true; return; }
    row.purityOrQuality = key;
    row.lot = lotRow;
    if (pcs) row.pieces = pcs; else delete row.pieces;
    addBags(d, [key], deps.userId);
  });
  if (changed) {
    await adjust({ material: "diamond", companyId: m.companyId, purityOrQuality: m.purityOrQuality, delta: m.quantity }, moves);
    throw new Error(OPENING_CHANGED);
  }
  try {
    await adjust({ material: "diamond", companyId: m.companyId, purityOrQuality: key, delta: m.quantity }, moves);
  } catch (e) {
    throw new Error(`Moved — but the stock counter for the new bag did not go up (${e instanceof Error ? e.message : String(e)}). Use Recompute from history on the Stock page.`);
  }
}

/**
 * Move a loose-diamond PURCHASE into another bag — its shape, mm, sieve, colour
 * or clarity were entered wrong — and set its piece count. Every stock entry the
 * purchase made (the purchase itself and any later corrections of it) moves
 * with it, and the purchase's own details change to match. The old bag must
 * still hold the stones: nothing issued, used or sold out of them since.
 *
 * Bought for an order, the stones never sat in stock — that purchase is
 * corrected on the order itself.
 */
export async function refilePurchaseLot(purchaseId: string, spec: LotSpec, pieces: number | undefined, deps: OpeningDeps & { userId?: string } = {}): Promise<void> {
  const live = (deps.load ?? loadDb)();
  const p = (live.purchases ?? []).find(x => x.id === purchaseId);
  if (!p) throw new Error("This purchase was removed by someone else.");
  if (p.material !== "diamond" || p.diamond?.kind === "certified") throw new Error("Only loose diamonds are kept in bags.");
  if (p.purpose === "order" || p.orderId) throw new Error("Bought for an order — correct its stones on the order.");
  const oldKey = purchaseBucket(p);
  const key = lotKey(spec);
  const parts = tidySpec(spec);
  const lotRow = Object.fromEntries(Object.entries(parts).filter(([, v]) => v)) as StockMovement["lot"];
  const pcs = pieces != null && pieces > 0 ? Math.round(pieces) : undefined;
  const update = deps.update ?? updateDb;
  const setDetails = (d: DB) => {
    const row = (d.purchases ?? []).find(x => x.id === p.id);
    if (!row?.diamond) return;
    row.diamond.shape = parts.shape;
    for (const k of ["size", "mm", "color", "clarity"] as const) { if (parts[k]) row.diamond[k] = parts[k]; else delete row.diamond[k]; }
    row.diamond.quality = [parts.color, parts.clarity].filter(Boolean).join(" ") || undefined;
    if (!row.diamond.quality) delete row.diamond.quality;
    if (pcs) row.diamond.pieces = pcs; else delete row.diamond.pieces;
  };
  const mine = (d: DB) => (d.stockMovements ?? []).filter(x => x.material === "diamond" && x.refId === p.id && x.refType === "purchase" && x.purityOrQuality === oldKey);
  const rows = mine(live);
  const co = rows[0]?.companyId ?? p.companyId;

  // Same bag: only the details and the count.
  if (key === oldKey) {
    update(d => {
      setDetails(d);
      for (const r of mine(d)) { r.lot = lotRow; if (r.type === "purchase_in") { if (pcs) r.pieces = pcs; else delete r.pieces; } }
    });
    return;
  }
  if (!rows.length) throw new Error("This purchase's stock entry isn't on file, so its stones can't be moved to another bag.");

  // The old bag without this purchase's stones must never have run below zero.
  const ids = new Set(rows.map(r => r.id));
  const sample = rows[0];
  const all = bucketMoves(live, sample);
  if (lowest(all.filter(x => !ids.has(x.id))) < Math.min(0, lowest(all)) - EPS) {
    throw new Error("Some of these stones have since been issued, used or sold out of their bag — cancel those first, then move the purchase.");
  }
  const net = r3(rows.reduce((t, x) => t + signOf(x) * Math.abs(x.quantity), 0));
  const adjust = deps.adjust ?? adjustStockCounter;
  const moves = live.stockMovements ?? [];
  if (net > 0) await adjust({ material: "diamond", companyId: co, purityOrQuality: oldKey, delta: -net }, moves);
  let changed = false;
  update(d => {
    const now = mine(d);
    if (now.length !== rows.length || r3(now.reduce((t, x) => t + signOf(x) * Math.abs(x.quantity), 0)) !== net) { changed = true; return; }
    for (const r of now) {
      r.purityOrQuality = key;
      r.lot = lotRow;
      if (r.type === "purchase_in") { if (pcs) r.pieces = pcs; else delete r.pieces; }
    }
    setDetails(d);
    addBags(d, [key], deps.userId);
  });
  if (changed) {
    if (net > 0) await adjust({ material: "diamond", companyId: co, purityOrQuality: oldKey, delta: net }, moves);
    throw new Error("This purchase was changed by someone else — reopen and try again.");
  }
  if (net > 0) {
    try {
      await adjust({ material: "diamond", companyId: co, purityOrQuality: key, delta: net }, moves);
    } catch (e) {
      throw new Error(`Moved — but the stock counter for the new bag did not go up (${e instanceof Error ? e.message : String(e)}). Use Recompute from history on the Stock page.`);
    }
  }
}
