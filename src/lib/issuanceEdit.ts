// Correcting material taken from our own stock for an order.
//
// A purchase bought for an order could always be corrected or removed (see
// purchaseVoid.ts), but material drawn from stock could not: the wrong carat
// typed in stayed wrong, and the stones stayed out of stock. This is the same
// idea for the other source — with the stock movement, the certified packets
// and the order log all carried along.
//
// Two more kinds are handled here too, because the factory's page and Buy &
// Assign show them: a delivery into a factory's pool (stock, no order) and an
// order's draw FROM that pool (no stock moves at all). The pool is worked out
// from those records (factoryPoolBalance), so a correction to either must leave
// it holding at least what orders have already drawn.
//
// The stock counter is written straight to Firestore (lib/stock.ts) and each
// move commits on its own, before the record is saved. So everything that can
// refuse is checked first, against the record as it is NOW (not as it was
// when the panel opened); a move that can be refused (taking stock out) goes
// before one that cannot (putting it back); and if the record turns out to
// have changed by the time it is saved, the moves already made are undone.
import { companyOf } from "@/lib/companies";
import {
  updateDb, uid, loadDb, type DB, type MaterialIssuance, type MaterialKey, type StockMovement,
} from "@/lib/db";
import { factoryPoolBalance, issuancePaid } from "@/lib/manufacturing";
import { materialUnit } from "@/lib/materials";
import { increaseStock, decreaseStock, decreaseStockSelfHealing } from "@/lib/stock";

const r3 = (n: number) => Math.round(n * 1000) / 1000;
const EPS = 0.0005;

/** Material taken from our own stock — what the order page corrects. */
export function isStockIssuance(mi: MaterialIssuance): boolean {
  return mi.source === "stock";
}

/** Handed to a factory's pool with no order behind it (Buy & Assign → Assign,
 *  or a bulk delivery on the factory's page). */
export function isPoolDelivery(mi: MaterialIssuance): boolean {
  return mi.source === "stock" && !mi.orderId;
}

/** An order's material taken from the factory's own pool — nothing left stock. */
export function isPoolDraw(mi: MaterialIssuance): boolean {
  return mi.source === "factoryPool";
}

/** What the factory's pool of this grade holds now, for this company's share. */
function poolLeft(db: DB, mi: MaterialIssuance, bucket = mi.purityOrQuality): number {
  return factoryPoolBalance(db.materialIssuances ?? [], mi.factoryId, mi.material, bucket, companyOf(mi));
}

/**
 * Whether this can still be put right from here, and why not when it cannot.
 * Anything the factory has already closed, billed or been paid for has to be
 * unwound where that happened, not here.
 */
export function canEditIssuance(db: DB, mi: MaterialIssuance): { ok: boolean; reason?: string } {
  // Each source says where it IS corrected — "came from a purchase" was
  // given for every one of them, a melt and a company move included.
  if (mi.source === "purchase") {
    return { ok: false, reason: "This came from a purchase — correct the purchase on the supplier's page instead." };
  }
  if (mi.source === "melt") {
    return { ok: false, reason: "This came back from melting a finished piece — it is part of that melt on the order." };
  }
  if (mi.source === "transfer") {
    return { ok: false, reason: "This was moved here from another company's share — move it back with Move between companies on the factory's page." };
  }
  if (!isStockIssuance(mi) && !isPoolDraw(mi)) {
    return { ok: false, reason: "This can't be corrected from here." };
  }
  if (mi.status !== "open") {
    return { ok: false, reason: "The factory has already returned the finished piece against this." };
  }
  if (issuancePaid(mi) > 0) {
    return { ok: false, reason: "Making charges have already been paid on this — cancel the payment in Payments → Factory payments first." };
  }
  if (mi.finishDisposition || (mi.finishReturnedCt ?? 0) > 0) {
    return { ok: false, reason: "This was already settled at Final Approval." };
  }
  if (mi.diamondKind === "certified") {
    const packets = (db.diamondPackets ?? []).filter(p => mi.diamondPacketIds?.includes(p.id));
    if (packets.some(p => p.status === "used" || p.status === "sold")) {
      return { ok: false, reason: "One of these certified stones is already used or sold." };
    }
  }
  return { ok: true };
}

/**
 * Whether it can be cancelled outright. The same as correcting it, except a
 * pool delivery orders have since drawn from: taking all of it back would
 * leave those orders holding material the pool never had.
 */
export function canCancelIssuance(db: DB, mi: MaterialIssuance): { ok: boolean; reason?: string } {
  const check = canEditIssuance(db, mi);
  if (!check.ok) return check;
  if (isPoolDelivery(mi) && mi.diamondKind !== "certified") {
    const left = poolLeft(db, mi);
    if (left < mi.quantityIssued - EPS) {
      const unit = materialUnit(db.settings, mi.material);
      return { ok: false, reason: `Orders have already drawn from it — the factory's pool of ${mi.purityOrQuality} holds only ${left}${unit} now. Correct it down to that instead, or cancel those draws first.` };
    }
  }
  return { ok: true };
}

/** What cancelling this will change, spelled out before it is confirmed. */
export function issuanceVoidImpact(db: DB, mi: MaterialIssuance): string[] {
  const unit = materialUnit(loadDb().settings, mi.material);
  const factory = db.factories.find(f => f.id === mi.factoryId);
  const out: string[] = [];
  if (mi.diamondKind === "certified") {
    const packets = (db.diamondPackets ?? []).filter(p => mi.diamondPacketIds?.includes(p.id));
    out.push(`• ${packets.length} certified stone${packets.length !== 1 ? "s" : ""} go back into stock`);
  } else if (isPoolDraw(mi)) {
    out.push(`• ${mi.quantityIssued}${unit} ${mi.purityOrQuality} goes back into ${factory?.name || "the factory"}'s pool`);
  } else {
    out.push(`• ${mi.quantityIssued}${unit} ${mi.purityOrQuality} goes back into stock`);
    if (isPoolDelivery(mi)) out.push(`• ${factory?.name || "the factory"}'s pool goes down by the same`);
  }
  if (mi.makingCharges.amountInr > 0) {
    out.push(`• ${factory?.name || "the factory"} is no longer charging for this`);
  }
  out.push(mi.orderId
    ? "• nothing else changes — every other entry on this order stays as it is"
    : "• nothing else changes");
  return out;
}

export interface IssuanceEdit {
  quantity?: number;
  purityOrQuality?: string;
  chargeAmount?: number;
  notes?: string;
}

/** Said when the record moved on while the panel was open — the figures it
 *  shows are no longer the ones on file, so a change worked out from them
 *  would count the difference against the wrong starting point. */
export const CHANGED_ELSEWHERE = "This was changed by someone else — reopen and try again.";
const CANCELLED_ELSEWHERE = "This was cancelled by someone else — reopen to see it as it is now.";

/**
 * Everything a correction is worked out from. If any of it differs between
 * the copy the panel opened with and the record on file, the stock difference
 * worked out from the panel's copy is wrong (two people correcting the same
 * issue at once would each move stock from the same starting figure).
 */
function issuanceBasis(mi: MaterialIssuance): string {
  return JSON.stringify([
    mi.quantityIssued, mi.purityOrQuality, mi.material, mi.factoryId, companyOf(mi), mi.source,
    mi.orderId ?? null, mi.status, mi.diamondKind ?? null, [...(mi.diamondPacketIds ?? [])].sort(),
    mi.makingCharges?.amountInr ?? 0, issuancePaid(mi), mi.finishDisposition ?? null, mi.finishReturnedCt ?? 0,
  ]);
}

/** One move of the stock counter. "out" takes from stock and is floor-checked,
 *  so it can be refused; "in" puts back and cannot be. */
export interface StockStep {
  dir: "out" | "in";
  material: MaterialKey;
  companyId: string;
  bucket: string;
  qty: number;
  /** For saying what is left out of place, should an undo fail. */
  unit?: string;
  note: string;
  /** Undoing a move just made: taken back exactly as it was put, never
   *  "healed" from a history that may not hold that move yet. */
  undo?: boolean;
}

/** What moves stock. The app's is liveStockIO; a check can pass its own. */
export interface StockIO {
  take(s: StockStep): Promise<void>;
  put(s: StockStep): Promise<void>;
}

/** The real counter (lib/stock.ts), each move with its own history row. */
export function liveStockIO(refId: string, userId: string, movements: StockMovement[]): StockIO {
  return {
    take: s => {
      const args = {
        material: s.material, companyId: s.companyId, purityOrQuality: s.bucket, quantity: s.qty,
        type: "issuance_out" as const, refType: "materialIssuance" as const, refId, createdBy: userId, note: s.note,
      };
      return s.undo ? decreaseStock(args) : decreaseStockSelfHealing(args, movements);
    },
    put: s => increaseStock({
      material: s.material, companyId: s.companyId, purityOrQuality: s.bucket, quantity: s.qty,
      refType: "manual", refId, createdBy: userId, note: s.note,
    }),
  };
}

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * Undo moves already made, the last first. Undefined when every one was put
 * back; otherwise what is still out of place, for the person to put right.
 */
export async function undoStockSteps(done: StockStep[], io: StockIO): Promise<string | undefined> {
  const stuck: string[] = [];
  for (const s of [...done].reverse()) {
    const back: StockStep = { ...s, dir: s.dir === "out" ? "in" : "out", undo: true, note: `Not saved — undone: ${s.note}` };
    try {
      await (back.dir === "out" ? io.take(back) : io.put(back));
    } catch {
      const what = `${s.qty}${s.unit ?? ""} ${s.bucket}`;
      stuck.push(s.dir === "out" ? `${what} taken out is still to go back in` : `${what} put back is still to come out again`);
    }
  }
  return stuck.length
    ? `Stock could not be put back as it was — ${stuck.join("; ")}. Check the Stock page before trying again.`
    : undefined;
}

/**
 * Make the moves in order. If one fails, those already made are undone, so a
 * refusal (not enough stock) leaves the counter exactly as it was.
 */
export async function runStockSteps(steps: StockStep[], io: StockIO): Promise<void> {
  const done: StockStep[] = [];
  for (const s of steps) {
    try {
      await (s.dir === "out" ? io.take(s) : io.put(s));
    } catch (e) {
      const left = await undoStockSteps(done, io);
      const why = errText(e);
      // A refused floor check writes nothing, so with every earlier move
      // undone there is nothing to tell but the reason.
      throw new Error(left ? `${why} ${left}` : why.startsWith("Insufficient") ? `${why} Nothing was changed.` : why);
    }
    done.push(s);
  }
}

/** A correction worked out against the record as it is on file. */
export interface IssuancePlan {
  id: string;
  basis: string;
  oldQty: number;
  oldBucket: string;
  newQty: number;
  newBucket: string;
  /** In the order they are made: anything that can be refused first. */
  steps: StockStep[];
}

/**
 * Work out a correction, or why it cannot be made. `opened` is the copy the
 * panel opened with; `live` is what is on file now. Nothing is written.
 */
export function planIssuanceEdit(live: DB, opened: MaterialIssuance, edit: IssuanceEdit): IssuancePlan | string {
  const mi = (live.materialIssuances ?? []).find(x => x.id === opened.id);
  if (!mi) return CANCELLED_ELSEWHERE;
  if (issuanceBasis(mi) !== issuanceBasis(opened)) return CHANGED_ELSEWHERE;
  const check = canEditIssuance(live, mi);
  if (!check.ok) return check.reason ?? "This can't be corrected from here.";

  const oldBucket = mi.purityOrQuality;
  const newBucket = edit.purityOrQuality?.trim() || oldBucket;
  const oldQty = mi.quantityIssued;
  const newQty = edit.quantity != null ? r3(edit.quantity) : oldQty;
  if (!(newQty > 0)) return "Enter how much was actually used.";
  const unit = materialUnit(live.settings, mi.material);

  if (mi.diamondKind !== "certified") {
    if (isPoolDelivery(mi)) {
      // Taking some of a delivery back (or all of it, to another grade) must
      // leave the pool what orders have already drawn from it.
      const out = newBucket !== oldBucket ? oldQty : Math.max(0, r3(oldQty - newQty));
      const left = poolLeft(live, mi);
      if (out > left + EPS) {
        return `Orders have already drawn from this — the factory's pool of ${oldBucket} holds only ${left}${unit}, so it can come down by at most that.`;
      }
    }
    if (isPoolDraw(mi)) {
      // A bigger draw, or one of another grade, needs that much in the pool.
      const need = newBucket !== oldBucket ? newQty : Math.max(0, r3(newQty - oldQty));
      const left = poolLeft(live, mi, newBucket);
      if (need > left + EPS) return `The factory's pool holds only ${left}${unit} of ${newBucket}.`;
    }
  }

  // Pooled stock only — a certified packet is one specific stone, so its
  // quantity is the stone's own weight and is not edited here; and a draw
  // from the factory's pool never touched stock.
  const steps: StockStep[] = [];
  if (mi.diamondKind !== "certified" && isStockIssuance(mi)) {
    const at = { material: mi.material, companyId: companyOf(mi), unit };
    if (newBucket !== oldBucket) {
      // The new grade comes out FIRST: it is the one move that can be refused
      // (not enough of it), and refused first, nothing has moved at all.
      // Putting the old grade back first used to commit before that refusal,
      // so the material counted both at the factory and back in stock — and
      // every retry put it back again.
      steps.push({ ...at, dir: "out", bucket: newBucket, qty: newQty, note: `Correction — ${newBucket} taken instead` });
      steps.push({ ...at, dir: "in", bucket: oldBucket, qty: oldQty, note: `Correction — ${oldBucket} returned` });
    } else if (newQty > oldQty) {
      steps.push({ ...at, dir: "out", bucket: newBucket, qty: r3(newQty - oldQty), note: "Correction — more taken than first recorded" });
    } else if (newQty < oldQty) {
      steps.push({ ...at, dir: "in", bucket: newBucket, qty: r3(oldQty - newQty), note: "Correction — less taken than first recorded" });
    }
  }
  return { id: mi.id, basis: issuanceBasis(mi), oldQty, oldBucket, newQty, newBucket, steps };
}

/** Write a correction already planned (and its stock already moved) into the
 *  record. Inside updateDb; nothing here can refuse. */
export function applyIssuanceEdit(d: DB, plan: IssuancePlan, edit: IssuanceEdit, userId: string): void {
  const live = (d.materialIssuances ?? []).find(x => x.id === plan.id);
  if (!live) return;
  if (live.diamondKind !== "certified") {
    live.quantityIssued = plan.newQty;
    live.purityOrQuality = plan.newBucket;
    // An order's issue records what it used, so that figure moves with it.
    // A pool delivery has no "used" of its own — orders draw against it as
    // separate records — and giving it one would count it as consumed.
    if (live.orderId) {
      live.finishedPieces = [{
        id: live.finishedPieces?.[0]?.id ?? uid("fp_"),
        quantityUsed: plan.newQty, piecesCount: 1,
        recordedAt: new Date().toISOString(), recordedBy: userId,
      }];
    }
  }
  if (edit.chargeAmount != null) live.makingCharges.amountInr = Math.round(edit.chargeAmount * 100) / 100;
  if (edit.notes !== undefined) live.notes = edit.notes.trim() || undefined;

  const o = d.orders.find(x => x.id === live.orderId);
  if (o) {
    if (!o.manufacturingLog) o.manufacturingLog = [];
    const unit = materialUnit(d.settings, live.material);
    o.manufacturingLog.push({
      id: uid("mlog_"), type: "material_issued", at: new Date().toISOString(), employeeId: userId,
      factoryId: live.factoryId, material: live.material, amountMaterial: live.quantityIssued,
      remarks: `Corrected: ${plan.oldQty}${unit} ${plan.oldBucket} to ${live.quantityIssued}${unit} ${live.purityOrQuality}`,
    });
  }
}

/** Where the app reads and saves; a check passes its own. */
export interface IssuanceDeps {
  load?: () => DB;
  update?: (fn: (d: DB) => void) => unknown;
  /** How stock moves — the real counter unless given. */
  io?: StockIO;
}

/**
 * Correct a stock issuance. Only the DIFFERENCE in quantity moves in stock, so
 * a correction from 0.2ct to 0.13ct puts 0.07ct back rather than re-running the
 * whole issue. Changing what was taken (a different shape or purity) returns
 * all of the old and draws all of the new, because they are different buckets.
 * A draw from a factory's pool moves no stock — the pool follows the record.
 *
 * `mi` is the copy the panel opened with; the difference is worked out from
 * the record on file, and refused if that is no longer the same. (`db` is the
 * page's copy, kept for the callers; nothing is worked out from it.)
 */
export async function editIssuance(
  db: DB, mi: MaterialIssuance, edit: IssuanceEdit, userId: string, deps: IssuanceDeps = {},
): Promise<void> {
  const load = deps.load ?? loadDb;
  const update = deps.update ?? updateDb;
  const live = load();
  const plan = planIssuanceEdit(live, mi, edit);
  if (typeof plan === "string") throw new Error(plan);

  const io = deps.io ?? liveStockIO(mi.id, userId, live.stockMovements ?? []);
  // Any refusal here undoes what moved before it.
  await runStockSteps(plan.steps, io);

  // Saved only if the record is still the one the moves were worked out from.
  // One that changed while stock was moving is left as it is, and the moves
  // are undone — never thrown from inside the save.
  const out: { refused?: string } = {};
  update(d => {
    const again = planIssuanceEdit(d, mi, edit);
    if (typeof again === "string") { out.refused = again; return; }
    if (again.basis !== plan.basis || JSON.stringify(again.steps) !== JSON.stringify(plan.steps)) {
      out.refused = CHANGED_ELSEWHERE;
      return;
    }
    applyIssuanceEdit(d, again, edit, userId);
  });
  if (out.refused) {
    const left = await undoStockSteps(plan.steps, io);
    throw new Error(left ? `${out.refused} ${left}` : out.refused);
  }
}

/** A cancellation worked out against the record on file, or why it can't be. */
export function planIssuanceDelete(live: DB, opened: MaterialIssuance): { id: string; basis: string; steps: StockStep[] } | string {
  const mi = (live.materialIssuances ?? []).find(x => x.id === opened.id);
  // Gone already — cancelled twice (a second click, or two people at once)
  // used to put the material back into stock a second time.
  if (!mi) return "This was already cancelled — nothing more to put back.";
  if (issuanceBasis(mi) !== issuanceBasis(opened)) return CHANGED_ELSEWHERE;
  const check = canCancelIssuance(live, mi);
  if (!check.ok) return check.reason ?? "This can't be cancelled from here.";
  const steps: StockStep[] = mi.diamondKind !== "certified" && isStockIssuance(mi)
    ? [{
      dir: "in", material: mi.material, companyId: companyOf(mi), bucket: mi.purityOrQuality, qty: mi.quantityIssued,
      unit: materialUnit(live.settings, mi.material), note: "Issue cancelled — returned to stock",
    }]
    : [];
  return { id: mi.id, basis: issuanceBasis(mi), steps };
}

/** Remove the record of a cancellation already planned. Inside updateDb. */
export function applyIssuanceDelete(d: DB, id: string, userId: string): void {
  const live = (d.materialIssuances ?? []).find(x => x.id === id);
  if (!live) return;
  // Certified stones are individual, so they go back to stock by name.
  if (live.diamondKind === "certified") {
    for (const p of d.diamondPackets ?? []) {
      if (live.diamondPacketIds?.includes(p.id) && p.status === "issued") {
        p.status = "in_stock";
        p.orderId = undefined;
      }
    }
  }
  d.materialIssuances = (d.materialIssuances ?? []).filter(x => x.id !== live.id);
  const o = d.orders.find(x => x.id === live.orderId);
  if (o) {
    o.materialIssuanceIds = (o.materialIssuanceIds ?? []).filter(x => x !== live.id);
    if (!o.manufacturingLog) o.manufacturingLog = [];
    const unit = materialUnit(d.settings, live.material);
    o.manufacturingLog.push({
      id: uid("mlog_"), type: "material_issued", at: new Date().toISOString(), employeeId: userId,
      factoryId: live.factoryId, material: live.material, amountMaterial: live.quantityIssued,
      remarks: `Cancelled: ${live.quantityIssued}${unit} ${live.purityOrQuality} returned to ${isPoolDraw(live) ? "the factory's pool" : "stock"}`,
    });
  }
}

/** Cancel an issuance: the material goes back (to stock, or to the factory's
 *  pool for a draw from it), and the record goes. Checked against the record
 *  on file, as editIssuance is. */
export async function deleteIssuance(db: DB, mi: MaterialIssuance, userId: string, deps: IssuanceDeps = {}): Promise<void> {
  const load = deps.load ?? loadDb;
  const update = deps.update ?? updateDb;
  const live = load();
  const plan = planIssuanceDelete(live, mi);
  if (typeof plan === "string") throw new Error(plan);

  const io = deps.io ?? liveStockIO(mi.id, userId, live.stockMovements ?? []);
  await runStockSteps(plan.steps, io);

  const out: { refused?: string } = {};
  update(d => {
    const again = planIssuanceDelete(d, mi);
    if (typeof again === "string") { out.refused = again; return; }
    if (again.basis !== plan.basis) { out.refused = CHANGED_ELSEWHERE; return; }
    applyIssuanceDelete(d, again.id, userId);
  });
  if (out.refused) {
    const left = await undoStockSteps(plan.steps, io);
    throw new Error(left ? `${out.refused} ${left}` : out.refused);
  }
}
