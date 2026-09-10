// Removing a purchase — the ONE complete unwind.
//
// A purchase is never just a purchase. Depending on where it was recorded it
// also creates: pooled Stock, a paired stock-movement trail, a certified
// DiamondPacket, an auto MaterialIssuance to the factory, order links and a
// manufacturing-log line — and it sits on the supplier's payable. Removing a
// duplicate therefore has to reverse ALL of it, or the factory's gold balance,
// the supplier's dues, the stock ledger and the profit/statement reports drift
// apart.
//
// This module is the single source of truth for that unwind, used by both the
// Order page and the Supplier ledger, so the two can never disagree.
//
// It is deliberately CONSERVATIVE: it refuses (with a plain-language reason)
// whenever the purchase can't be cleanly reversed — money already paid, making
// charges already paid, the factory already finished the piece, or a certified
// stone already used/sold. Those must be undone at the source first.
import { updateDb, uid, type DB, type Purchase } from "./db";
import { purchasePaid, issuancePaid, fmtMoneyInr } from "./manufacturing";
import { decreaseStockSelfHealing } from "./stock";

/** Human description of what was bought, for confirmations and the audit line. */
export function purchaseLabel(p: Purchase): string {
  return p.material === "gold"
    ? `${p.gold?.weightGrams ?? 0}g ${p.gold?.purity ?? ""} gold`
    : `${p.diamond?.carat ?? 0}ct ${p.diamond?.kind === "certified" ? "certified " : ""}diamond${p.diamond?.quality ? ` (${p.diamond.quality})` : ""}`;
}

/** Quantity in the purchase's own unit (grams / carats). */
function qtyOf(p: Purchase): number {
  return p.material === "gold" ? (p.gold?.weightGrams ?? 0) : (p.diamond?.carat ?? 0);
}

/** The pooled-stock bucket this purchase would have landed in. */
function bucketOf(p: Purchase): string {
  if (p.material === "gold") return p.gold?.purity ?? "";
  return p.diamond?.kind === "certified" ? "Certified" : (p.diamond?.shape ?? "unspecified");
}

/** True when this purchase actually increased the shared pooled stock. */
function pooledStock(p: Purchase): boolean {
  return p.purpose === "stock" && !(p.material === "diamond" && p.diamond?.kind === "certified");
}

/**
 * Can this purchase be removed cleanly? Returns a reason when it can't, so the
 * UI can tell the user exactly what to undo first instead of failing silently.
 */
export function canVoidPurchase(db: DB, p: Purchase): { ok: boolean; reason?: string } {
  if (purchasePaid(p) > 0) {
    return { ok: false, reason: "A payment has already been made against this purchase. Reverse that payment from the Locker first, then remove it." };
  }
  const issuances = (db.materialIssuances ?? []).filter(i => i.source === "purchase" && i.sourcePurchaseId === p.id);
  for (const i of issuances) {
    if (issuancePaid(i) > 0) {
      return { ok: false, reason: "Making charges have already been paid to the factory for this material. Reverse that payment first." };
    }
    if (i.status === "closed" || i.finishedNetWeight != null) {
      return { ok: false, reason: "The factory has already returned the finished piece made from this material, so it can't be removed. Use Rework/Return instead." };
    }
  }
  const packets = (db.diamondPackets ?? []).filter(pk => pk.purchaseId === p.id);
  if (packets.some(pk => pk.status === "used" || pk.status === "sold")) {
    return { ok: false, reason: "A certified diamond from this purchase is already used in a piece or sold. It can't be removed." };
  }
  return { ok: true };
}

/**
 * Plain-language list of everything this removal will change — shown in the
 * confirmation so nobody has to take it on trust. Everything here is keyed to
 * this one purchase; an identical twin (the whole point of a duplicate) is
 * untouched until it is removed in its own right.
 */
export function voidImpact(db: DB, p: Purchase): string[] {
  const out: string[] = [];
  const unit = p.material === "gold" ? "g" : "ct";
  const sup = db.suppliers.find(s => s.id === p.supplierId);
  out.push(`• ${fmtMoneyInr(p.totalInr)} comes off ${sup?.name || "the supplier"}’s dues`);
  for (const i of (db.materialIssuances ?? []).filter(i => i.source === "purchase" && i.sourcePurchaseId === p.id)) {
    const fac = db.factories.find(f => f.id === i.factoryId);
    out.push(`• ${i.quantityIssued}${i.material === "gold" ? "g" : "ct"} taken back off ${fac?.name || "the factory"}’s hands`);
    if (i.makingCharges.amountInr > 0) {
      out.push(`• the ${fmtMoneyInr(i.makingCharges.amountInr)} making charge on that factory issue is removed too`);
    }
  }
  const packets = (db.diamondPackets ?? []).filter(pk => pk.purchaseId === p.id);
  if (packets.length) out.push(`• ${packets.length} certified stone record${packets.length !== 1 ? "s" : ""} removed`);
  if (pooledStock(p) && qtyOf(p) > 0) out.push(`• ${qtyOf(p)}${unit} taken back out of Stock`);
  out.push("• nothing else changes — the client’s order value, their payments and every other purchase stay exactly as they are");
  return out;
}

/**
 * Remove a purchase and reverse every trace of it. Throws if the pooled stock
 * it added has already been consumed (floor-checked), leaving everything
 * untouched. Call canVoidPurchase() first for the friendly pre-checks.
 */
export async function voidPurchase(db: DB, p: Purchase, userId: string): Promise<void> {
  const qty = qtyOf(p);

  // 1. Pooled stock first — this is the only step that can legitimately fail
  //    (material already consumed). Doing it before any mutation means a
  //    failure leaves the whole record intact rather than half-removed.
  if (pooledStock(p) && qty > 0) {
    await decreaseStockSelfHealing({
      material: p.material,
      purityOrQuality: bucketOf(p),
      quantity: qty,
      type: "issuance_out",
      refType: "purchase",
      refId: p.id,
      createdBy: userId,
      note: `Removed purchase ${p.invoiceNumber || p.id.slice(-6)}`,
    }, db.stockMovements);
  }

  updateDb(d => {
    // 2. Stock-movement trail. Both the original "in" and the reversal we just
    //    wrote carry refId = purchase id, so dropping both leaves the ledger
    //    clean (as if the duplicate never happened) while the running balance
    //    stays correct — they cancelled each other out anyway.
    d.stockMovements = (d.stockMovements ?? []).filter(m => !(m.refType === "purchase" && m.refId === p.id));

    // Its paired "used directly on order" row (written at the same instant by
    // logOrderDirectPurchase). Remove exactly ONE — a genuine duplicate has an
    // identical twin that must survive until it is voided in its own right.
    if (p.orderId) {
      const idx = d.stockMovements.findIndex(m =>
        m.type === "order_direct_use" &&
        m.refType === "order" &&
        m.refId === p.orderId &&
        m.material === p.material &&
        m.createdAt === p.createdAt &&
        Math.abs(m.quantity - qty) < 0.0001);
      if (idx >= 0) d.stockMovements.splice(idx, 1);
    }

    // 3. The factory issuance auto-created from this purchase — without this the
    //    factory keeps showing the material as still in its hands.
    const killed = new Set(
      (d.materialIssuances ?? [])
        .filter(i => i.source === "purchase" && i.sourcePurchaseId === p.id)
        .map(i => i.id),
    );
    if (killed.size) d.materialIssuances = (d.materialIssuances ?? []).filter(i => !killed.has(i.id));

    // 4. Certified packets it created (confirmed not used/sold).
    d.diamondPackets = (d.diamondPackets ?? []).filter(pk => pk.purchaseId !== p.id);

    // 5. The purchase itself — clears it off the supplier's payable/statement.
    d.purchases = (d.purchases ?? []).filter(x => x.id !== p.id);

    // 6. Unlink from the order and leave an audit line behind.
    if (p.orderId) {
      const o = d.orders.find(x => x.id === p.orderId);
      if (o) {
        o.linkedPurchaseIds = (o.linkedPurchaseIds ?? []).filter(pid => pid !== p.id);
        o.materialIssuanceIds = (o.materialIssuanceIds ?? []).filter(iid => !killed.has(iid));
        // Drop ONE matching "material purchased" line (a duplicate pair shares
        // the same timestamp + amount, and only one is being removed here).
        const log = o.manufacturingLog ?? [];
        const li = log.findIndex(m => m.type === "material_purchased" && m.amountInr === p.totalInr && m.at === p.createdAt);
        if (li >= 0) log.splice(li, 1);
        log.push({
          id: uid("mlog_"),
          type: "material_returned",
          at: new Date().toISOString(),
          employeeId: userId,
          material: p.material,
          amountMaterial: qty,
          amountInr: p.totalInr,
          remarks: `Correction — removed duplicate purchase of ${purchaseLabel(p)} (${fmtMoneyInr(p.totalInr)}). Supplier due, factory issue and stock all reversed.`,
        });
        o.manufacturingLog = log;
      }
    }
  });
}
