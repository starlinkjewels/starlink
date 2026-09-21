// Correcting material taken from our own stock for an order.
//
// A purchase bought for an order could always be corrected or removed (see
// purchaseVoid.ts), but material drawn from stock could not: the wrong carat
// typed in stayed wrong, and the stones stayed out of stock. This is the same
// idea for the other source — with the stock movement, the certified packets
// and the order log all carried along.
import {
  updateDb, uid, type DB, type MaterialIssuance,
} from "@/lib/db";
import { issuancePaid } from "@/lib/manufacturing";
import { increaseStock, decreaseStockSelfHealing } from "@/lib/stock";

const r3 = (n: number) => Math.round(n * 1000) / 1000;

/** Material taken from our own stock — the only kind this file handles. */
export function isStockIssuance(mi: MaterialIssuance): boolean {
  return mi.source === "stock";
}

/**
 * Whether this can still be put right from here, and why not when it cannot.
 * Anything the factory has already closed, billed or been paid for has to be
 * unwound where that happened, not here.
 */
export function canEditIssuance(db: DB, mi: MaterialIssuance): { ok: boolean; reason?: string } {
  if (!isStockIssuance(mi)) {
    return { ok: false, reason: "This came from a purchase — correct the purchase instead." };
  }
  if (mi.status !== "open") {
    return { ok: false, reason: "The factory has already returned the finished piece against this." };
  }
  if (issuancePaid(mi) > 0) {
    return { ok: false, reason: "Making charges have already been paid on this — cancel the payment first." };
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

/** What cancelling this will change, spelled out before it is confirmed. */
export function issuanceVoidImpact(db: DB, mi: MaterialIssuance): string[] {
  const unit = mi.material === "gold" ? "g" : "ct";
  const out: string[] = [];
  if (mi.diamondKind === "certified") {
    const packets = (db.diamondPackets ?? []).filter(p => mi.diamondPacketIds?.includes(p.id));
    out.push(`• ${packets.length} certified stone${packets.length !== 1 ? "s" : ""} go back into stock`);
  } else {
    out.push(`• ${mi.quantityIssued}${unit} ${mi.purityOrQuality} goes back into stock`);
  }
  const factory = db.factories.find(f => f.id === mi.factoryId);
  if (mi.makingCharges.amountInr > 0) {
    out.push(`• ${factory?.name || "the factory"} is no longer charging for this`);
  }
  out.push("• nothing else changes — every other entry on this order stays as it is");
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

  // Pooled material only — a certified packet is one specific stone, so its
  // quantity is the stone's own weight and is not edited here.
  if (mi.diamondKind !== "certified") {
    if (newBucket !== oldBucket) {
      await increaseStock({
        material: mi.material, purityOrQuality: oldBucket, quantity: oldQty,
        refType: "manual", refId: mi.id, createdBy: userId,
        note: `Correction — ${oldBucket} returned`,
      });
      await decreaseStockSelfHealing({
        material: mi.material, purityOrQuality: newBucket, quantity: newQty,
        type: "issuance_out", refType: "materialIssuance", refId: mi.id, createdBy: userId,
        note: `Correction — ${newBucket} taken instead`,
      }, db.stockMovements);
    } else if (newQty > oldQty) {
      await decreaseStockSelfHealing({
        material: mi.material, purityOrQuality: newBucket, quantity: r3(newQty - oldQty),
        type: "issuance_out", refType: "materialIssuance", refId: mi.id, createdBy: userId,
        note: "Correction — more taken than first recorded",
      }, db.stockMovements);
    } else if (newQty < oldQty) {
      await increaseStock({
        material: mi.material, purityOrQuality: newBucket, quantity: r3(oldQty - newQty),
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
      // The "used" figure is what the issue recorded, so it moves with it.
      live.finishedPieces = [{
        id: live.finishedPieces?.[0]?.id ?? uid("fp_"),
        quantityUsed: newQty, piecesCount: 1,
        recordedAt: new Date().toISOString(), recordedBy: userId,
      }];
    }
    if (edit.chargeAmount != null) live.makingCharges.amountInr = Math.round(edit.chargeAmount * 100) / 100;
    if (edit.notes !== undefined) live.notes = edit.notes.trim() || undefined;

    const o = d.orders.find(x => x.id === live.orderId);
    if (o) {
      if (!o.manufacturingLog) o.manufacturingLog = [];
      const unit = live.material === "gold" ? "g" : "ct";
      o.manufacturingLog.push({
        id: uid("mlog_"), type: "material_issued", at: new Date().toISOString(), employeeId: userId,
        factoryId: live.factoryId, material: live.material, amountMaterial: live.quantityIssued,
        remarks: `Corrected: ${oldQty}${unit} ${oldBucket} to ${live.quantityIssued}${unit} ${live.purityOrQuality}`,
      });
    }
  });
}

/** Cancel a stock issuance: the material goes back, and the record goes. */
export async function deleteIssuance(db: DB, mi: MaterialIssuance, userId: string): Promise<void> {
  const check = canEditIssuance(db, mi);
  if (!check.ok) throw new Error(check.reason);

  if (mi.diamondKind !== "certified") {
    await increaseStock({
      material: mi.material, purityOrQuality: mi.purityOrQuality, quantity: mi.quantityIssued,
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
      const unit = live.material === "gold" ? "g" : "ct";
      o.manufacturingLog.push({
        id: uid("mlog_"), type: "material_issued", at: new Date().toISOString(), employeeId: userId,
        factoryId: live.factoryId, material: live.material, amountMaterial: live.quantityIssued,
        remarks: `Cancelled: ${live.quantityIssued}${unit} ${live.purityOrQuality} returned to stock`,
      });
    }
  });
}
