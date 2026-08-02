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
import { uid, type StockMovement } from "./db";

const STOCK_COL = "stockLevels";
const STOCK_DOC = "current";

export interface StockLevels {
  gold: Record<string, number>; // purity -> grams
  diamond: Record<string, number>; // quality bucket -> carats
  updatedAt: string;
  version: number;
}

function stockRef() {
  return doc(fsdb as Firestore, STOCK_COL, STOCK_DOC);
}

/** Real-time subscription — call the returned unsubscribe on unmount. */
export function subscribeStockLevels(onChange: (levels: StockLevels) => void): () => void {
  return onSnapshot(stockRef(), snap => {
    if (snap.exists()) onChange(snap.data() as StockLevels);
    else onChange({ gold: {}, diamond: {}, updatedAt: new Date().toISOString(), version: 0 });
  });
}

export async function fetchStockLevels(): Promise<StockLevels> {
  const snap = await getDoc(stockRef());
  if (!snap.exists()) {
    const initial: StockLevels = { gold: {}, diamond: {}, updatedAt: new Date().toISOString(), version: 0 };
    await setDoc(stockRef(), initial);
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

async function addStockMovement(m: Omit<StockMovement, "id">): Promise<void> {
  const id = uid("sm_");
  await setDoc(doc(fsdb, "stockMovements", id), pruneUndefined({ ...m, id }));
}

/** Purchase → stock: a plain atomic increment is safe, since additions can never go negative. */
export async function increaseStock(args: {
  material: "gold" | "diamond";
  purityOrQuality: string;
  quantity: number;
  refType: "purchase" | "manual";
  refId?: string;
  createdBy: string;
  note?: string;
}): Promise<void> {
  const field = args.material === "gold" ? "gold" : "diamond";
  // setDoc+merge (not updateDoc) so the very first stock purchase on a fresh
  // tenant creates stockLevels/current instead of throwing "No document to update".
  await setDoc(stockRef(), {
    [`${field}.${args.purityOrQuality}`]: increment(args.quantity),
    updatedAt: new Date().toISOString(),
    version: increment(1),
  }, { merge: true });
  await addStockMovement({
    material: args.material,
    type: "purchase_in",
    purityOrQuality: args.purityOrQuality,
    quantity: args.quantity,
    refType: args.refType,
    refId: args.refId,
    createdBy: args.createdBy,
    createdAt: new Date().toISOString(),
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
  material: "gold" | "diamond";
  purityOrQuality: string;
  quantity: number;
  type: "issuance_out" | "order_direct_use";
  refType: "materialIssuance" | "order" | "purchase" | "diamondSale";
  refId?: string;
  createdBy: string;
  note?: string;
}): Promise<void> {
  const field = args.material === "gold" ? "gold" : "diamond";
  const movementId = uid("sm_");

  await runTransaction(fsdb, async (tx) => {
    const ref = stockRef();
    const snap = await tx.get(ref);
    const levels = (snap.exists() ? snap.data() : { gold: {}, diamond: {} }) as StockLevels;
    const have = (levels[field] as Record<string, number>)?.[args.purityOrQuality] || 0;
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
      type: args.type,
      purityOrQuality: args.purityOrQuality,
      quantity: args.quantity,
      refType: args.refType,
      refId: args.refId,
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
  material: "gold" | "diamond";
  purityOrQuality: string;
  quantity: number;
  purchaseId: string;
  orderId: string;
  createdBy: string;
}): Promise<void> {
  const now = new Date().toISOString();
  await Promise.all([
    addStockMovement({
      material: args.material, type: "purchase_in", purityOrQuality: args.purityOrQuality, quantity: args.quantity,
      refType: "purchase", refId: args.purchaseId, createdBy: args.createdBy, createdAt: now,
    }),
    addStockMovement({
      material: args.material, type: "order_direct_use", purityOrQuality: args.purityOrQuality, quantity: args.quantity,
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
  try {
    await decreaseStock(args);
  } catch (e) {
    if (e instanceof Error && e.message.startsWith("Insufficient")) {
      await recomputeStockFromHistory(movements);
      await decreaseStock(args);
    } else {
      throw e;
    }
  }
}

/**
 * Recompute stockLevels/current from the full stockMovements history and
 * overwrite it — a reconciliation escape hatch (like a bank statement
 * reconciliation) in case of any drift, never called automatically.
 */
export async function recomputeStockFromHistory(movements: StockMovement[]): Promise<StockLevels> {
  const gold: Record<string, number> = {};
  const diamond: Record<string, number> = {};
  for (const m of movements) {
    const bucket = m.material === "gold" ? gold : diamond;
    const sign = m.type === "purchase_in" ? 1 : m.type === "adjustment" ? Math.sign(m.quantity) : -1;
    bucket[m.purityOrQuality] = (bucket[m.purityOrQuality] || 0) + sign * Math.abs(m.quantity);
  }
  const levels: StockLevels = { gold, diamond, updatedAt: new Date().toISOString(), version: 0 };
  await setDoc(stockRef(), levels);
  return levels;
}
