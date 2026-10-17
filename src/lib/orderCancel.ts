// Closing an order that will not be made — Reject on the order page, or Cancel
// from the order page or the Orders list. Lifted out of the order page so the
// list cancels exactly the way the page does, not with a copy of its own.
import { loadDb, updateDb, uid, type User } from "./db";
import { increaseStock } from "./stock";
import { companyOf } from "./companies";
import { issuanceUsed } from "./manufacturing";
import { logItem, whoOf } from "./readyStockHistory";
import { cancelBlocker } from "./orderGuards";

type Who = Pick<User, "id" | "name" | "role">;

/**
 * Return any gold/diamond issued for the order back to stock, release undrawn
 * factory-pool draws, free certified packets, and close open issuances. Shared
 * by both Reject and Cancel so a rejected order never strands material. Any
 * advance already paid moves to the client's credit.
 */
export async function returnIssuedMaterials(orderId: string, user: Who): Promise<void> {
  const db = loadDb();
  const order = db.orders.find(o => o.id === orderId);
  if (!order) throw new Error("That order is not there any more");
  const openIssuances = db.materialIssuances.filter(i => i.orderId === order.id && i.status === "open");
  for (const mi of openIssuances) {
    if (mi.diamondKind === "certified") continue; // returned via its DiamondPacket below
    if (mi.source === "stock") {
      // Stock-sourced: return only the part not actually consumed into a piece.
      const used = (mi.finishedPieces || []).reduce((s, f) => s + f.quantityUsed, 0);
      const remaining = Math.round((mi.quantityIssued - used) * 100) / 100;
      if (remaining > 0) await increaseStock({ material: mi.material, companyId: companyOf(mi), purityOrQuality: mi.purityOrQuality, quantity: remaining, refType: "manual", createdBy: user.id, note: `Returned from cancelled order ${order.orderNumber}` });
    } else if (mi.source === "purchase") {
      // Bought new for THIS order and sent to the factory (never entered the
      // shared pool). On cancel the piece isn't being made, so the material
      // comes back from the factory into general Stock, available for reuse.
      // The supplier purchase itself stays — that money was really spent.
      if (mi.quantityIssued > 0) await increaseStock({ material: mi.material, companyId: companyOf(mi), purityOrQuality: mi.purityOrQuality, quantity: mi.quantityIssued, refType: "manual", createdBy: user.id, note: `Purchased for cancelled order ${order.orderNumber} — moved to stock` });
    }
  }
  const wasRejected = order.status === "Rejected";
  updateDb(d => {
    for (const mi of d.materialIssuances) {
      if (mi.orderId === order.id && mi.status === "open") {
        // Drop the returned material from the factory's DERIVED balance:
        //  • stock/pool → keep only what was genuinely consumed (remainder went back);
        //  • purchase → fully returned to Stock above, so zero it out.
        if (mi.source === "purchase") { mi.quantityIssued = 0; mi.finishedPieces = []; }
        else if (mi.source === "factoryPool" || mi.source === "stock") mi.quantityIssued = Math.round(issuanceUsed(mi) * 100) / 100;
        mi.status = "closed";
      }
    }
    for (const p of d.diamondPackets || []) {
      if (p.orderId === order.id) { p.status = "in_stock"; p.orderId = undefined; }
    }
    // A cancelled/rejected Ready-Stock SALE returns the finished piece to
    // inventory (creation decremented it by one). Guarded so it restores once.
    if (order.materialSourcing === "readyStock" && order.readyStockItemId && !wasRejected) {
      const item = d.readyStock?.find(x => x.id === order.readyStockItemId);
      if (item) {
        item.quantity += 1;
        logItem(item, { ...whoOf(user), kind: "unsold", text: `Order ${order.orderNumber} cancelled — back in stock · ${item.quantity - 1} → ${item.quantity}`, ref: { orderId: order.id } });
      }
    }
    // Any advance already paid on this order becomes client credit — usable on
    // their other orders, or refundable — never stranded on cancelled work.
    if (!wasRejected) {
      const o2 = d.orders.find(x => x.id === order.id);
      const paid = (o2?.advances || []).reduce((s, a) => s + a.amount, 0);
      if (o2 && paid > 0) {
        const c = d.clients.find(x => x.id === o2.clientId);
        if (c) c.creditBalance = Math.round(((c.creditBalance || 0) + paid) * 100) / 100;
        o2.advances = [];
      }
    }
  });
}

/** What cancelling will do, for the confirmation — the first line asks. */
export function cancelQuestion(orderNumber: string): string {
  return `Cancel order ${orderNumber}?\n\nAny issued material/diamonds return to stock, any advance paid moves to the client's credit, and it will no longer be billed. You can re-open it later.`;
}

/**
 * Cancel an order (admin) — returns any issued gold/diamond and certified
 * packets to stock, closes its issuances, and stops billing it (Rejected is
 * excluded from client totals). Re-openable afterwards. Checks the blockers
 * again at the moment it runs, so a list that was open a while can't cancel
 * something dispatched since.
 */
export async function cancelOrder(orderId: string, user: Who): Promise<void> {
  const fresh = loadDb();
  const o = fresh.orders.find(x => x.id === orderId);
  if (!o) throw new Error("That order is not there any more");
  const why = cancelBlocker(fresh, o);
  if (why) throw new Error(why);
  await returnIssuedMaterials(orderId, user); // return gold/diamond, free packets, close issuances
  const now = new Date().toISOString();
  updateDb(d => {
    const x = d.orders.find(y => y.id === orderId);
    if (!x) return;
    x.status = "Rejected";
    const clientUser = d.users.find(u => u.clientId === x.clientId);
    if (clientUser) d.notifications.unshift({
      id: uid("n_"), userId: clientUser.id, title: "Order Cancelled",
      body: `${x.orderNumber} has been cancelled.`, type: "order", read: false, createdAt: now,
    });
  });
}
