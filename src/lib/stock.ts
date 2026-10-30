// Stock (gold/diamond inventory) — deliberately NOT part of the shared db.ts
// sync engine. "Stock can't go below zero silently" is a concurrency-control
// problem (two staff issuing gold at the same instant must not both succeed
// against the same pool), which a diffed/last-write-wins array sync cannot
// guarantee — only an atomic read-check-write can. This is the one place in
// the app that needs a genuine Firestore transaction, so it gets its own
// direct-Firestore module, same reasoning as src/lib/catalogItems.ts being
// split out for its own different reason (pagination).
import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  runTransaction,
  increment,
  collection,
  onSnapshot,
  type Firestore,
} from "firebase/firestore";
import { db as fsdb } from "./firebase";
import { ensureCollections, loadDb, uid, type StockMovement, type MaterialKey } from "./db";
import { bagOf, ensureBag } from "./diamondBags";
import { lotParts } from "./diamondLots";
import { assertFresh } from "./db";

const STOCK_COL = "stockLevels";
const MAIN_DOC = "current";

/**
 * The running counter behind the floor check. One map per material — `gold`
 * (purity → g), `diamond` (shape → ct), and one per admin-defined material
 * under its own id (`mat_…`, grade → its unit) — so a ruby can never pass a
 * diamond's floor check, whatever it is called.
 */
export interface StockLevels {
  gold: Record<string, number>; // purity -> grams
  diamond: Record<string, number>; // quality bucket -> carats
  [material: `mat_${string}`]: Record<string, number>;
  updatedAt: string;
  version: number;
}

/** Each company holds its own stock: the first company's counter is
 *  stockLevels/current, as it always was; another's is stockLevels/co_<id>. */
function stockDocId(companyId?: string): string {
  return !companyId || companyId === "main" ? MAIN_DOC : `co_${companyId}`;
}

function stockRef(companyId?: string) {
  return doc(fsdb as Firestore, STOCK_COL, stockDocId(companyId));
}

/** A movement belongs to the company whose stock it moved; unset = the first company. */
function companyOf(m: Pick<StockMovement, "companyId">): string {
  return m.companyId || "main";
}

/** Real-time subscription — call the returned unsubscribe on unmount. */
export function subscribeStockLevels(onChange: (levels: StockLevels) => void, companyId?: string): () => void {
  return onSnapshot(
    stockRef(companyId),
    snap => {
      if (snap.exists()) onChange(snap.data() as StockLevels);
      else onChange({ gold: {}, diamond: {}, updatedAt: new Date().toISOString(), version: 0 });
    },
    // Stock levels are staff-only. Refused, there is simply nothing to show —
    // without this the refusal surfaced as an uncaught error on the console.
    err => console.warn("[stock] levels not available to this account:", err.code ?? err),
  );
}

/** Every company's counter at once, by company — call the returned unsubscribe on unmount. */
export function subscribeStockLevelsByCompany(companyIds: string[], onChange: (byCompany: Record<string, StockLevels>) => void): () => void {
  const got: Record<string, StockLevels> = {};
  const offs = companyIds.map(id => subscribeStockLevels(levels => { got[id] = levels; onChange({ ...got }); }, id));
  return () => offs.forEach(off => off());
}

/** Several counters added together — the whole business's stock. */
export function sumStockLevels(list: StockLevels[]): StockLevels {
  const out: Record<string, Record<string, number>> = { gold: {}, diamond: {} };
  for (const lv of list) {
    for (const [field, map] of Object.entries(lv as unknown as Record<string, unknown>)) {
      if (!map || typeof map !== "object") continue;
      const into = (out[field] ??= {});
      for (const [k, q] of Object.entries(map as Record<string, number>)) into[k] = (into[k] || 0) + (Number(q) || 0);
    }
  }
  return { ...out, updatedAt: new Date().toISOString(), version: 0 } as unknown as StockLevels;
}

export async function fetchStockLevels(companyId?: string): Promise<StockLevels> {
  const snap = await getDoc(stockRef(companyId));
  if (!snap.exists()) {
    const initial: StockLevels = { gold: {}, diamond: {}, updatedAt: new Date().toISOString(), version: 0 };
    await setDoc(stockRef(companyId), initial);
    return initial;
  }
  return snap.data() as StockLevels;
}

// Firestore rejects `undefined` field values; drop them before writing.
function pruneUndefined<T extends Record<string, unknown>>(o: T): T {
  const out: Record<string, unknown> = {};
  for (const k in o) if (o[k] !== undefined) out[k] = o[k];
  return out as T;
}

/** A lot's parts without the empty ones — Firestore refuses an undefined field, nested ones too. */
function cleanLot(lot: StockMovement["lot"]): StockMovement["lot"] {
  if (!lot?.shape) return undefined;
  return pruneUndefined({ shape: lot.shape, variety: lot.variety || undefined, type: lot.type || undefined, size: lot.size || undefined, mm: lot.mm || undefined, color: lot.color || undefined, clarity: lot.clarity || undefined }) as StockMovement["lot"];
}

/** A loose-diamond movement's lot parts: as given, else read from its lot label — so
 *  every way stones come back (a return, a melt, a cancel, a correction) files them
 *  with their shape, mm, sieve, colour and clarity, not just a label. */
function lotOf(material: MaterialKey, key: string, lot: StockMovement["lot"]): StockMovement["lot"] {
  // A lot given with its type is as written; otherwise the lot's own parts, as first kept.
  if (material === "diamond" && !lot?.type && key && key !== "Certified" && key !== "unspecified") {
    const kept = (loadDb().stockMovements ?? []).find(m => m.material === "diamond" && m.purityOrQuality === key && m.lot?.shape)?.lot;
    if (kept) return cleanLot(kept);
  }
  if (lot?.shape) return cleanLot(lot);
  return material === "diamond" && key && key !== "Certified" && key !== "unspecified" ? cleanLot(lotParts(key)) : undefined;
}

async function addStockMovement(m: Omit<StockMovement, "id">): Promise<void> {
  const id = uid("sm_");
  await setDoc(doc(fsdb, "stockMovements", id), pruneUndefined({ ...m, lot: lotOf(m.material, m.purityOrQuality, m.lot), id }));
  // Loose stones into a lot: the lot gets its bag number if it has none yet.
  if (m.material === "diamond" && m.type === "purchase_in") ensureBag(m.purityOrQuality, m.createdBy);
}

/** Purchase → stock: a plain atomic increment is safe, since additions can never go negative. */
export async function increaseStock(args: {
  material: MaterialKey;
  /** Whose stock — unset is the first company. */
  companyId?: string;
  purityOrQuality: string;
  quantity: number;
  refType: "purchase" | "manual" | "opening" | "transfer" | "supplierSale" | "bagMove";
  refId?: string;
  valueInr?: number; // an "opening" entry's ₹ valuation, or a "transfer"'s / "bagMove"'s cost where it came from
  createdBy: string;
  note?: string;
  createdAt?: string; // as-of date (opening stock) — defaults to now
  /** Loose diamonds: the lot's parts and how many stones (lib/diamondLots.ts). */
  lot?: StockMovement["lot"];
  pieces?: number;
}): Promise<void> {
  // Never from the device's saved copy (see staleCols in lib/db.ts) — refused before anything is written.
  assertFresh();
  // Each material its own map, keyed by the material itself.
  const field = args.material;
  // setDoc+merge (not updateDoc) so the very first stock purchase on a fresh
  // tenant creates stockLevels/current instead of throwing "No document to update".
  // A nested map, not a "gold.14K" key: setDoc takes a dotted key literally, so
  // that wrote a separate field and the real figure never went up (the Stock
  // page's repair from history was what put it right).
  await setDoc(stockRef(args.companyId), {
    [field]: { [args.purityOrQuality]: increment(args.quantity) },
    updatedAt: new Date().toISOString(),
    version: increment(1),
  }, { merge: true });
  await addStockMovement({
    material: args.material,
    ...(args.companyId && args.companyId !== "main" ? { companyId: args.companyId } : {}),
    type: "purchase_in",
    purityOrQuality: args.purityOrQuality,
    quantity: args.quantity,
    refType: args.refType,
    refId: args.refId,
    valueInr: args.valueInr,
    lot: args.lot,
    pieces: args.pieces,
    createdBy: args.createdBy,
    createdAt: args.createdAt || new Date().toISOString(),
    note: args.note,
  });
}

/**
 * Issue gold/diamonds out of stock (to a Factory, or directly to an order) —
 * MUST be a transaction with a floor check, since this is the actual race
 * condition to prevent. Throws if there isn't enough stock; the caller should
 * surface that error to the user rather than let it fail silently.
 */
export async function decreaseStock(args: {
  material: MaterialKey;
  /** Whose stock — unset is the first company. */
  companyId?: string;
  purityOrQuality: string;
  quantity: number;
  type: "issuance_out" | "order_direct_use";
  refType: "materialIssuance" | "order" | "purchase" | "diamondSale" | "supplierSale" | "transfer" | "bagMove";
  refId?: string;
  createdBy: string;
  note?: string;
  /** Loose diamonds: the lot's parts and how many stones (lib/diamondLots.ts). */
  lot?: StockMovement["lot"];
  pieces?: number;
}): Promise<void> {
  // Never from the device's saved copy (see staleCols in lib/db.ts) — refused before anything is written.
  assertFresh();
  const field = args.material;
  const movementId = uid("sm_");

  await runTransaction(fsdb, async (tx) => {
    const ref = stockRef(args.companyId);
    const snap = await tx.get(ref);
    const levels = (snap.exists() ? snap.data() : { gold: {}, diamond: {} }) as StockLevels;
    const have = ((levels as unknown as Record<string, Record<string, number> | undefined>)[field])?.[args.purityOrQuality] || 0;
    if (have < args.quantity) {
      throw new Error(
        `Insufficient ${args.purityOrQuality} ${args.material} stock: have ${have}, need ${args.quantity}.`,
      );
    }
    tx.set(
      ref,
      {
        [field]: { [args.purityOrQuality]: have - args.quantity },
        updatedAt: new Date().toISOString(),
        version: increment(1),
      },
      { merge: true },
    );
    tx.set(doc(collection(fsdb, "stockMovements"), movementId), pruneUndefined({
      id: movementId,
      material: args.material,
      companyId: args.companyId && args.companyId !== "main" ? args.companyId : undefined,
      type: args.type,
      purityOrQuality: args.purityOrQuality,
      quantity: args.quantity,
      refType: args.refType,
      refId: args.refId,
      lot: lotOf(args.material, args.purityOrQuality, args.lot),
      pieces: args.pieces,
      createdBy: args.createdBy,
      createdAt: new Date().toISOString(),
      note: args.note,
    }));
  });
}

/**
 * Material bought specifically for one order and sent straight to a factory
 * (see recordPurchaseForOrder in OrderDetail.tsx) never enters the shared
 * stockLevels pool by design — no other order could ever draw on it, so
 * pooling it would be a phantom detour. But that left it with no footprint
 * on the Stock report at all. This logs a purchase_in + order_direct_use pair
 * for the SAME quantity — netting to zero in deriveStockBalances (matching
 * the true zero effect on the shared pool) while giving both legs a row in
 * Stock's movement history, so "bought X, used X directly on this order" is
 * actually visible. Deliberately bypasses stockLevels/current entirely (no
 * increment then decrement) since the net effect is zero and skipping it
 * avoids any race with a concurrent shared-pool operation on the same bucket.
 * Certified diamonds are excluded by the caller — they're tracked individually
 * via DiamondPacket, never pooled, same as a Buy & Assign certified purchase.
 */
export async function logOrderDirectPurchase(args: {
  material: MaterialKey;
  companyId?: string;
  purityOrQuality: string;
  quantity: number;
  purchaseId: string;
  orderId: string;
  createdBy: string;
  /** The PURCHASE's own timestamp. Both legs must carry it: the "used" leg has
   *  no purchase id of its own, so editing or removing a purchase finds its
   *  partner by material, quantity and this instant. Minting a fresh one here
   *  put the two milliseconds apart, the match never succeeded, and removing a
   *  purchase deleted the "bought" leg while orphaning the "used" leg — which
   *  is a stock balance that falls by the whole quantity and stays there. */
  createdAt?: string;
  /** Loose diamonds: the lot's parts and how many stones (lib/diamondLots.ts). */
  lot?: StockMovement["lot"];
  pieces?: number;
}): Promise<void> {
  // Never from the device's saved copy (see staleCols in lib/db.ts) — refused before anything is written.
  assertFresh();
  const now = args.createdAt ?? new Date().toISOString();
  const co = args.companyId && args.companyId !== "main" ? { companyId: args.companyId } : {};
  await Promise.all([
    addStockMovement({
      material: args.material, ...co, type: "purchase_in", purityOrQuality: args.purityOrQuality, quantity: args.quantity,
      lot: args.lot, pieces: args.pieces,
      refType: "purchase", refId: args.purchaseId, createdBy: args.createdBy, createdAt: now,
    }),
    addStockMovement({
      material: args.material, ...co, type: "order_direct_use", purityOrQuality: args.purityOrQuality, quantity: args.quantity,
      lot: args.lot, pieces: args.pieces,
      refType: "order", refId: args.orderId, createdBy: args.createdBy, createdAt: now,
    }),
  ]);
}

/**
 * Same as decreaseStock, but self-heals from cache drift: if the cached
 * counter has gone stale-low relative to the real movement history (e.g.
 * from data that predates full movement logging), a legitimate issue would
 * otherwise fail with a confusing "insufficient stock" error the user has no
 * way to act on, even though Stock's own ledger-derived display shows plenty
 * available. Resyncs the counter from history once and retries before
 * giving up for real — invisible in the common case where the counter was
 * already correct and the first attempt just succeeds.
 */
export async function decreaseStockSelfHealing(
  args: Parameters<typeof decreaseStock>[0],
  movements: StockMovement[],
): Promise<void> {
  // Never from the device's saved copy (see staleCols in lib/db.ts) — refused before anything is written.
  assertFresh();
  try {
    await decreaseStock(args);
  } catch (e) {
    if (e instanceof Error && e.message.startsWith("Insufficient")) {
      await recomputeStockFromHistory(movements, args.companyId);
      await decreaseStock(args);
    } else {
      throw e;
    }
  }
}

/**
 * Move one bucket's counter by a signed difference WITHOUT writing a movement.
 *
 * For a movement corrected in place (an opening-stock figure — see
 * lib/openingStock.ts): its own history row is rewritten, so a second row for
 * the difference would count the change twice. An increase is a plain atomic
 * increment, as increaseStock's; a decrease is floor-checked in a transaction,
 * as decreaseStock's, and resyncs a stale-low counter from the history once
 * before giving up, as decreaseStockSelfHealing does.
 */
export async function adjustStockCounter(args: {
  material: MaterialKey;
  companyId?: string;
  purityOrQuality: string;
  /** Positive adds, negative takes away. */
  delta: number;
}, movements: StockMovement[]): Promise<void> {
  // Never from the device's saved copy (see staleCols in lib/db.ts) — refused before anything is written.
  assertFresh();
  const field = args.material;
  const delta = Math.round(args.delta * 1000) / 1000;
  if (!delta) return;
  if (delta > 0) {
    await setDoc(stockRef(args.companyId), {
      [field]: { [args.purityOrQuality]: increment(delta) },
      updatedAt: new Date().toISOString(),
      version: increment(1),
    }, { merge: true });
    return;
  }
  const take = async () => runTransaction(fsdb, async (tx) => {
    const ref = stockRef(args.companyId);
    const snap = await tx.get(ref);
    const levels = (snap.exists() ? snap.data() : { gold: {}, diamond: {} }) as StockLevels;
    const have = ((levels as unknown as Record<string, Record<string, number> | undefined>)[field])?.[args.purityOrQuality] || 0;
    if (have < -delta) {
      throw new Error(`Insufficient ${args.purityOrQuality} ${args.material} stock: have ${have}, need ${-delta}.`);
    }
    tx.set(ref, {
      [field]: { [args.purityOrQuality]: Math.round((have + delta) * 1000) / 1000 },
      updatedAt: new Date().toISOString(),
      version: increment(1),
    }, { merge: true });
  });
  try {
    await take();
  } catch (e) {
    if (e instanceof Error && e.message.startsWith("Insufficient")) {
      await recomputeStockFromHistory(movements, args.companyId);
      await take();
    } else {
      throw e;
    }
  }
}

/**
 * Move stock from one of our companies to another: out of the sender's
 * counter (floor-checked, as any issue), into the receiver's, both legs
 * sharing one id. The receiving leg carries what it cost the sender, so the
 * receiver's own average cost is right from the first gram.
 */
export async function transferStock(args: {
  material: MaterialKey;
  purityOrQuality: string;
  quantity: number;
  fromCompany: string;
  toCompany: string;
  valueInr?: number;
  /** Loose stones: how many stones move with the carats. */
  pieces?: number;
  createdBy: string;
  note?: string;
}): Promise<string> {
  // Never from the device's saved copy (see staleCols in lib/db.ts) — refused before anything is written.
  assertFresh();
  if (args.fromCompany === args.toCompany) throw new Error("Choose two different companies.");
  const refId = uid("tr_");
  const what = `${args.quantity} ${args.purityOrQuality}`;
  // The sender's running count can lag its history (it said "0" with stones in the bag);
  // like every issue, it is put right from the history once before the move is refused.
  await ensureCollections(["stockMovements"]);
  await decreaseStockSelfHealing({
    material: args.material, companyId: args.fromCompany, purityOrQuality: args.purityOrQuality, quantity: args.quantity,
    type: "issuance_out", refType: "transfer", refId, createdBy: args.createdBy, note: args.note ?? `Moved ${what} to another company`,
    ...(args.pieces ? { pieces: args.pieces } : {}),
  }, loadDb().stockMovements ?? []);
  await increaseStock({
    material: args.material, companyId: args.toCompany, purityOrQuality: args.purityOrQuality, quantity: args.quantity,
    refType: "transfer", refId, valueInr: args.valueInr, createdBy: args.createdBy, note: args.note ?? `Moved in ${what} from another company`,
    ...(args.pieces ? { pieces: args.pieces } : {}),
  });
  return refId;
}

/**
 * Move loose stones from one bag into another (lib/diamondBags.ts) — out of the
 * first, floor-checked as any issue, into the second, both legs sharing one id.
 * The stones take the second bag's lot (its shape · mm · sieve · colour ·
 * clarity): mixing grades is the office's call. They go in at what they cost in
 * the first bag, so the second bag's average cost is right.
 */
export async function moveBetweenBags(args: {
  companyId?: string;
  from: string;
  to: string;
  /** The second bag's parts, when it is a new one. */
  toLot?: StockMovement["lot"];
  quantity: number;
  pieces?: number;
  valueInr?: number;
  createdBy: string;
  /** "BAG-0007" of each, for the two history lines. */
  fromNo?: string;
  toNo?: string;
  note?: string;
}): Promise<string> {
  // Never from the device's saved copy (see staleCols in lib/db.ts) — refused before anything is written.
  assertFresh();
  if (args.from === args.to) throw new Error("Choose a different bag to move the stones into.");
  const qty = Math.round(args.quantity * 1000) / 1000;
  if (!(qty > 0)) throw new Error("Enter how many carats to move.");
  const refId = uid("bm_");
  const extra = args.note?.trim() ? ` — ${args.note.trim()}` : "";
  const co = args.companyId && args.companyId !== "main" ? args.companyId : undefined;
  const at = new Date().toISOString();
  // A moment later, so the history reads out-then-in and both bags' lines sort the same way everywhere.
  const atIn = new Date(+new Date(at) + 1).toISOString();
  const outLot = lotOf("diamond", args.from, undefined);
  const inLot = lotOf("diamond", args.to, args.toLot);
  // Both bags are on the same counter (one company's stockLevels), so the move is
  // one transaction: both lines are written, or neither — stones can never leave
  // one bag without reaching the other.
  const move = () => runTransaction(fsdb, async (tx) => {
    const ref = stockRef(co);
    const snap = await tx.get(ref);
    const levels = (snap.exists() ? snap.data() : { gold: {}, diamond: {} }) as StockLevels;
    const have = levels.diamond?.[args.from] || 0;
    // Within half a thousandth: "All" moves the bag's balance as the history rounds it.
    if (have + 0.0005 < qty) throw new Error(`Insufficient ${args.from} diamond stock: have ${have}, need ${qty}.`);
    tx.set(ref, {
      diamond: { [args.from]: Math.max(0, Math.round((have - qty) * 1000) / 1000), [args.to]: increment(qty) },
      updatedAt: at,
      version: increment(1),
    }, { merge: true });
    const outId = uid("sm_"), inId = uid("sm_");
    tx.set(doc(collection(fsdb, "stockMovements"), outId), pruneUndefined({
      id: outId, material: "diamond", companyId: co, type: "issuance_out", purityOrQuality: args.from, quantity: qty,
      refType: "bagMove", refId, lot: outLot, pieces: args.pieces || undefined, createdBy: args.createdBy, createdAt: at,
      note: `Moved to ${args.toNo ? `${args.toNo} · ` : ""}${args.to}${extra}`,
    }));
    tx.set(doc(collection(fsdb, "stockMovements"), inId), pruneUndefined({
      id: inId, material: "diamond", companyId: co, type: "purchase_in", purityOrQuality: args.to, quantity: qty,
      refType: "bagMove", refId, valueInr: args.valueInr != null ? Math.round(args.valueInr * 100) / 100 : undefined,
      lot: inLot, pieces: args.pieces || undefined, createdBy: args.createdBy, createdAt: atIn,
      note: `Moved in from ${args.fromNo ? `${args.fromNo} · ` : ""}${args.from}${extra}`,
    }));
  });
  await ensureCollections(["stockMovements"]);
  try {
    await move();
  } catch (e) {
    // The counter can lag its history (it said "0" with stones in the bag): put it right once, as every issue does.
    if (e instanceof Error && e.message.startsWith("Insufficient")) {
      await recomputeStockFromHistory(loadDb().stockMovements ?? [], co);
      await move();
    } else throw e;
  }
  // The second bag gets its number if it is a new one (the form gives it one first, to name it).
  if (!bagOf(loadDb(), args.to)) ensureBag(args.to, args.createdBy);
  return refId;
}

/**
 * A recount (stock-take) of one bag: how many stones are in it, counted. Moves
 * no stock — a 0 ct line in the bag's history that sets its count from here on
 * (lib/diamondLots.ts lotBalances).
 */
export async function recountBag(args: { companyId?: string; key: string; pieces: number; was?: number | null; createdBy: string; note?: string }): Promise<void> {
  // Never from the device's saved copy (see staleCols in lib/db.ts) — refused before anything is written.
  assertFresh();
  const pcs = Math.round(args.pieces);
  if (!(pcs >= 0)) throw new Error("Enter how many stones are in the bag.");
  await addStockMovement({
    material: "diamond",
    ...(args.companyId && args.companyId !== "main" ? { companyId: args.companyId } : {}),
    type: "adjustment", purityOrQuality: args.key, quantity: 0, pcsCount: pcs, refType: "manual",
    createdBy: args.createdBy, createdAt: new Date().toISOString(),
    note: `Recounted: ${pcs} pcs${args.was != null ? ` (was ${args.was})` : ""}${args.note?.trim() ? ` — ${args.note.trim()}` : ""}`,
  });
}

/**
 * Recompute stockLevels/current from the full stockMovements history and
 * overwrite it — a reconciliation escape hatch (like a bank statement
 * reconciliation) in case of any drift, never called automatically.
 */
export async function recomputeStockFromHistory(movements: StockMovement[], companyId?: string): Promise<StockLevels> {
  // Never from the device's saved copy (see staleCols in lib/db.ts) — refused before anything is written.
  assertFresh();
  // Safety: this OVERWRITES the whole stockLevels doc. If the caller hands us an
  // empty history (movements not loaded yet / a stale cache), rebuilding from it
  // would zero out real stock. Refuse and return what's stored instead.
  if (!movements || movements.length === 0) return fetchStockLevels(companyId);
  const co = companyId || "main";
  // Every material that has ever moved — gold, diamond, and each other one by
  // its id — so the rebuild never drops a map the history has.
  const maps: Record<string, Record<string, number>> = { gold: {}, diamond: {} };
  for (const m of movements) {
    if (companyOf(m) !== co) continue;
    const bucket = (maps[m.material] ??= {});
    const sign = m.type === "purchase_in" ? 1 : m.type === "adjustment" ? Math.sign(m.quantity) : -1;
    bucket[m.purityOrQuality] = (bucket[m.purityOrQuality] || 0) + sign * Math.abs(m.quantity);
  }
  const levels = { ...maps, updatedAt: new Date().toISOString(), version: 0 } as unknown as StockLevels;
  await setDoc(stockRef(companyId), levels);
  return levels;
}
