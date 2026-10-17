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
import { companyOf } from "@/lib/companies";
import {
  updateDb, uid, loadDb, type DB, type MaterialIssuance,
} from "@/lib/db";
import { factoryPoolBalance, issuancePaid } from "@/lib/manufacturing";
import { materialUnit } from "@/lib/materials";
import { increaseStock, decreaseStockSelfHealing } from "@/lib/stock";

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

/**
 * Correct a stock issuance. Only the DIFFERENCE in quantity moves in stock, so
 * a correction from 0.2ct to 0.13ct puts 0.07ct back rather than re-running the
 * whole issue. Changing what was taken (a different shape or purity) returns
 * all of the old and draws all of the new, because they are different buckets.
 * A draw from a factory's pool moves no stock — the pool follows the record.
 */
export async function editIssuance(
  db: DB, mi: MaterialIssuance, edit: IssuanceEdit, userId: string,
): Promise<void> {
  const check = canEditIssuance(db, mi);
  if (!check.ok) throw new Error(check.reason);

  const oldBucket = mi.purityOrQuality;
  const newBucket = edit.purityOrQuality?.trim() || oldBucket;
  const oldQty = mi.quantityIssued;
  const newQty = edit.quantity != null ? r3(edit.quantity) : oldQty;
  if (newQty <= 0) throw new Error("Enter how much was actually used.");
  const unit = materialUnit(db.settings, mi.material);

  // The pool checks come before anything moves, so a refusal changes nothing.
  if (mi.diamondKind !== "certified") {
    if (isPoolDelivery(mi)) {
      // Taking some of a delivery back (or all of it, to another grade) must
      // leave the pool what orders have already drawn from it.
      const out = newBucket !== oldBucket ? oldQty : Math.max(0, r3(oldQty - newQty));
      const left = poolLeft(db, mi);
      if (out > left + EPS) {
        throw new Error(`Orders have already drawn from this — the factory's pool of ${oldBucket} holds only ${left}${unit}, so it can come down by at most that.`);
      }
    }
    if (isPoolDraw(mi)) {
      // A bigger draw, or one of another grade, needs that much in the pool.
      const need = newBucket !== oldBucket ? newQty : Math.max(0, r3(newQty - oldQty));
      const left = poolLeft(db, mi, newBucket);
      if (need > left + EPS) {
        throw new Error(`The factory's pool holds only ${left}${unit} of ${newBucket}.`);
      }
    }
  }

  // Pooled stock only — a certified packet is one specific stone, so its
  // quantity is the stone's own weight and is not edited here; and a draw
  // from the factory's pool never touched stock.
  if (mi.diamondKind !== "certified" && isStockIssuance(mi)) {
    if (newBucket !== oldBucket) {
      await increaseStock({
        material: mi.material, companyId: companyOf(mi), purityOrQuality: oldBucket, quantity: oldQty,
        refType: "manual", refId: mi.id, createdBy: userId,
        note: `Correction — ${oldBucket} returned`,
      });
      await decreaseStockSelfHealing({
        material: mi.material, companyId: companyOf(mi), purityOrQuality: newBucket, quantity: newQty,
        type: "issuance_out", refType: "materialIssuance", refId: mi.id, createdBy: userId,
        note: `Correction — ${newBucket} taken instead`,
      }, db.stockMovements);
    } else if (newQty > oldQty) {
      await decreaseStockSelfHealing({
        material: mi.material, companyId: companyOf(mi), purityOrQuality: newBucket, quantity: r3(newQty - oldQty),
        type: "issuance_out", refType: "materialIssuance", refId: mi.id, createdBy: userId,
        note: "Correction — more taken than first recorded",
      }, db.stockMovements);
    } else if (newQty < oldQty) {
      await increaseStock({
        material: mi.material, companyId: companyOf(mi), purityOrQuality: newBucket, quantity: r3(oldQty - newQty),
        refType: "manual", refId: mi.id, createdBy: userId,
        note: "Correction — less taken than first recorded",
      });
    }
  }

  updateDb(d => {
    const live = (d.materialIssuances ?? []).find(x => x.id === mi.id);
    if (!live) return;
    if (mi.diamondKind !== "certified") {
      live.quantityIssued = newQty;
      live.purityOrQuality = newBucket;
      // An order's issue records what it used, so that figure moves with it.
      // A pool delivery has no "used" of its own — orders draw against it as
      // separate records — and giving it one would count it as consumed.
      if (live.orderId) {
        live.finishedPieces = [{
          id: live.finishedPieces?.[0]?.id ?? uid("fp_"),
          quantityUsed: newQty, piecesCount: 1,
          recordedAt: new Date().toISOString(), recordedBy: userId,
        }];
      }
    }
    if (edit.chargeAmount != null) live.makingCharges.amountInr = Math.round(edit.chargeAmount * 100) / 100;
    if (edit.notes !== undefined) live.notes = edit.notes.trim() || undefined;

    const o = d.orders.find(x => x.id === live.orderId);
    if (o) {
      if (!o.manufacturingLog) o.manufacturingLog = [];
      const unit = materialUnit(loadDb().settings, live.material);
      o.manufacturingLog.push({
        id: uid("mlog_"), type: "material_issued", at: new Date().toISOString(), employeeId: userId,
        factoryId: live.factoryId, material: live.material, amountMaterial: live.quantityIssued,
        remarks: `Corrected: ${oldQty}${unit} ${oldBucket} to ${live.quantityIssued}${unit} ${live.purityOrQuality}`,
      });
    }
  });
}

/** Cancel an issuance: the material goes back (to stock, or to the factory's
 *  pool for a draw from it), and the record goes. */
export async function deleteIssuance(db: DB, mi: MaterialIssuance, userId: string): Promise<void> {
  const check = canCancelIssuance(db, mi);
  if (!check.ok) throw new Error(check.reason);

  if (mi.diamondKind !== "certified" && isStockIssuance(mi)) {
    await increaseStock({
      material: mi.material, companyId: companyOf(mi), purityOrQuality: mi.purityOrQuality, quantity: mi.quantityIssued,
      refType: "manual", refId: mi.id, createdBy: userId,
      note: "Issue cancelled — returned to stock",
    });
  }

  updateDb(d => {
    const live = (d.materialIssuances ?? []).find(x => x.id === mi.id);
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
      const unit = materialUnit(loadDb().settings, live.material);
      o.manufacturingLog.push({
        id: uid("mlog_"), type: "material_issued", at: new Date().toISOString(), employeeId: userId,
        factoryId: live.factoryId, material: live.material, amountMaterial: live.quantityIssued,
        remarks: `Cancelled: ${live.quantityIssued}${unit} ${live.purityOrQuality} returned to ${isPoolDraw(live) ? "the factory's pool" : "stock"}`,
      });
    }
  });
}
