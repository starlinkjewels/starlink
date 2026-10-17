import { companyOf } from "@/lib/companies";
import { updateDb, type DB, type DiamondSale, type LockerTransaction } from "@/lib/db";
import { increaseStock } from "@/lib/stock";
import { fmtCcy } from "@/lib/currency";

/** What the sale put in its account: dollars for a sale in dollars, else
 *  rupees — the sale's currency, which is the account's too, since a sale can
 *  only be paid into an account holding it. */
const proceeds = (sale: DiamondSale) => sale.totalUsd ?? sale.totalInr;
const proceedsCcy = (sale: DiamondSale) => (sale.totalUsd != null ? "USD" : "INR");

/**
 * The account movement a sale paid into. Sales recorded from now on carry
 * refType "diamondSale" and the sale's id, so they are found exactly. Older
 * ones were written as plain "manual" entries with no link, and are matched
 * the way every other paired movement is: same account, money in, the same
 * amount, written within two seconds of the sale. Only a manual (or untagged)
 * row is ever taken that way — one since applied to a client's bills belongs
 * to that client now and is not this sale's to remove.
 */
export function saleTxn(txns: LockerTransaction[] | undefined, sale: DiamondSale): LockerTransaction | undefined {
  const list = txns ?? [];
  const tagged = list.find(t => t.refType === "diamondSale" && t.refId === sale.id);
  if (tagged || !sale.lockerId) return tagged;
  const at = +new Date(sale.createdAt);
  return list.find(t =>
    (t.refType === "manual" || !t.refType)
    && t.lockerId === sale.lockerId && t.type === "income"
    && Math.abs(t.amountInr - proceeds(sale)) < 0.01
    && Math.abs(+new Date(t.createdAt) - at) < 2000);
}

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
  const txn = saleTxn(db.lockerTransactions, sale);
  if (txn) {
    const locker = db.lockers.find(l => l.id === txn.lockerId);
    out.push(`• ${locker?.name ?? "the account"} goes down by ${fmtCcy(txn.amountInr, txn.currency ?? proceedsCcy(sale))}`);
  } else if (sale.lockerId) {
    // Said rather than assumed: nothing will come off the account.
    out.push("• no account entry was found for its money, so no account changes");
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
      material: "diamond", companyId: companyOf(sale), purityOrQuality: sale.shape, quantity: sale.carat,
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
    // The money it brought in — by its tag, or (an older sale) by the
    // account, the amount and the moment. See saleTxn.
    const txn = saleTxn(d.lockerTransactions, sale);
    if (txn) d.lockerTransactions = d.lockerTransactions.filter(t => t.id !== txn.id);
  });
}
