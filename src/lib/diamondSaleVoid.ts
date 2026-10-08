import { updateDb, type DB, type DiamondSale } from "@/lib/db";
import { increaseStock } from "@/lib/stock";
import { fmtMoneyInr } from "@/lib/manufacturing";

/**
 * Undoing a diamond sold straight out of stock.
 *
 * A sale touches three things: the stone leaves (pooled stock for a loose one,
 * the packet's own status for a certified one), the sale is recorded, and the
 * money lands in an account. Entered against the wrong buyer or at the wrong
 * rate, there was no way back at all — the only option was to leave it wrong.
 * All three are reversed together here, or none of them.
 */
export function canVoidSale(db: DB, sale: DiamondSale): { ok: boolean; reason?: string } {
  if (sale.kind === "certified") {
    const packet = (db.diamondPackets ?? []).find(p => p.id === sale.packetId);
    if (!packet) return { ok: false, reason: "That certified stone is no longer on file." };
    // Sold then issued to an order: putting it back in stock would contradict
    // the order that is holding it.
    if (packet.status === "issued" || packet.status === "used") {
      return { ok: false, reason: "That stone has since been issued to an order — remove it from the order first." };
    }
  }
  return { ok: true };
}

/** What reversing it changes, spelled out before it is confirmed. */
export function saleVoidImpact(db: DB, sale: DiamondSale): string[] {
  const out: string[] = [];
  out.push(sale.kind === "certified"
    ? `• the certified stone goes back into stock`
    : `• ${sale.carat}ct ${sale.shape} goes back into stock`);
  const buyer = sale.clientId
    ? (db.clients.find(c => c.id === sale.clientId)?.companyName ?? "the client")
    : (sale.buyerName ?? "the buyer");
  out.push(`• the sale to ${buyer} is removed`);
  if (sale.lockerId) {
    const locker = db.lockers.find(l => l.id === sale.lockerId);
    out.push(`• ${locker?.name ?? "the account"} goes down by ${fmtMoneyInr(sale.totalInr)}`);
  }
  out.push("• nothing else changes");
  return out;
}

export async function voidDiamondSale(db: DB, sale: DiamondSale, userId: string): Promise<void> {
  const check = canVoidSale(db, sale);
  if (!check.ok) throw new Error(check.reason);

  // Pooled stock first: if this fails the sale is left intact rather than
  // removed with the stone never coming back.
  if (sale.kind === "loose") {
    await increaseStock({
      material: "diamond", purityOrQuality: sale.shape, quantity: sale.carat,
      refType: "manual", refId: sale.id, createdBy: userId,
      note: "Sale cancelled — returned to stock",
    });
  }

  updateDb(d => {
    if (sale.kind === "certified") {
      const p = (d.diamondPackets ?? []).find(x => x.id === sale.packetId);
      if (p && p.status === "sold") { p.status = "in_stock"; p.orderId = undefined; }
    }
    d.diamondSales = (d.diamondSales ?? []).filter(s => s.id !== sale.id);
    // The money it brought in. Matched on the account, the amount and the
    // moment, the same way every other paired movement is found.
    if (sale.lockerId) {
      const at = +new Date(sale.createdAt);
      const idx = (d.lockerTransactions ?? []).findIndex(t =>
        t.lockerId === sale.lockerId && t.type === "income"
        && Math.abs(t.amountInr - (sale.totalUsd ?? sale.totalInr)) < 0.01
        && Math.abs(+new Date(t.createdAt) - at) < 2000);
      if (idx >= 0) d.lockerTransactions.splice(idx, 1);
    }
  });
}
