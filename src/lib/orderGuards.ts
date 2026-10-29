// What may still be done to an order, and why not when it can't. One place for
// the reasons, so the order page, the Orders list and its cards all say the
// same thing — and an action that isn't possible is shown greyed with its
// reason instead of disappearing.
import {
  collectionsFresh, findInvoiceForOrder, isDiamondOnlyOrder, orderIsDispatched, worksOnOrder,
  type DB, type Order, type User,
} from "./db";
import { CHECKING, needsAccess } from "./actionHints";

type Can = (module: "orders", action: "edit") => boolean;

/**
 * Why an order can't be cancelled now; undefined when it can.
 *
 * Cancelling puts issued material back in stock and moves the advance to the
 * client's credit — right for work that never left, wrong for goods already
 * sent or billed: those come back through a return (credit note), and a bill
 * is deleted or credited first, never stranded on a cancelled order.
 */
/** What cancelBlocker reads beyond the orders the app opens with. They arrive
 *  by themselves in the first seconds after sign-in and read as empty until
 *  then — an invoice not yet here would let a billed order be cancelled. */
export const CANCEL_REF_COLS = ["invoices", "readyStock"] as const;

export function cancelBlocker(db: DB, o: Order): string | undefined {
  if (o.melted) return "Melted — the piece no longer exists";
  if (o.status === "Rejected") return "Already cancelled — re-open it on the order page to change it";
  if (orderIsDispatched(o) || o.returns?.length) return "Already dispatched — use “Return pieces” instead (credit note, piece back into Ready Stock)";
  if (!collectionsFresh(CANCEL_REF_COLS)) return CHECKING;
  const inv = findInvoiceForOrder(db.invoices ?? [], o.id);
  if (inv) return `On invoice ${inv.number} — delete or credit the invoice first`;
  // An in-house build already in Ready Stock: cancelling would put its gold
  // back in stock while the finished piece sits on the shelf — counted twice.
  if (o.readyStockCreatedId) {
    const it = (db.readyStock ?? []).find(i => i.id === o.readyStockCreatedId);
    return `In Ready Stock${it ? ` as ${it.name}` : ""} — set that piece's quantity to 0 instead`;
  }
  return undefined;
}

/** Who may cancel: the admin only, as before. */
export function cancelAccess(user: Pick<User, "role"> | null | undefined): string | undefined {
  return user?.role === "admin" ? undefined : "Only the admin can cancel an order";
}

/**
 * Whether this person may change an order's details at all — the same rule as
 * moving its stages: the admin, or an employee whose work it is and whose role
 * lets them change orders.
 */
export function orderEditAccess(db: DB, user: User | null | undefined, can: Can, o: Order): string | undefined {
  if (!user) return "Sign in again";
  if (user.role === "admin") return undefined;
  if (user.role === "client") return "Only our team can change an order — send us a message";
  if (!can("orders", "edit")) return needsAccess("orders", "edit");
  if (!worksOnOrder(db, user, o)) return "Not one of your orders";
  return undefined;
}

/** What of an order's spec can't change now, and why (see OrderEditDialog). */
export interface SpecLocks {
  /** Nothing can be changed. */
  all?: string;
  /** The piece itself — type, metal, karats, colour, size, quantity, stones, weights, finishing. */
  piece?: string;
  /** Quantity, type, metal, karats and diamond type — material went out against them. */
  material?: string;
  /** Changing to or from a loose-diamond order: its stages were set for one or the other. */
  kind: string;
}

export function orderSpecLocks(db: DB, o: Order): SpecLocks {
  const kind = isDiamondOnlyOrder(o)
    ? "A loose-diamond order — its stages were set for that; place a new order for a made piece"
    : "Its stages were set for a made piece — place a new order for a loose diamond";
  if (o.melted) return { all: "Melted — the piece no longer exists", kind };
  if (o.status === "Rejected") return { all: "Cancelled — re-open it to change its details", kind };
  let piece: string | undefined;
  if (o.returns?.length) piece = `Pieces came back on credit note ${[...new Set(o.returns.map(r => r.creditNoteNo))].join(", ")} — the piece stays as it was sold`;
  else if (orderIsDispatched(o)) piece = "Dispatched — the piece stays as it was sent; record a return to change what was sold";
  else if (o.materialSourcing === "readyStock") piece = "Sold from Ready Stock — the piece's details come from it";
  else if (o.readyStockCreatedId) piece = "Already in Ready Stock — change the piece there";
  else if (o.forReadyStock && o.status === "Ready") piece = "Finished — the piece is waiting to go into Ready Stock";
  const issued = (db.materialIssuances ?? []).some(i => i.orderId === o.id && (i.quantityIssued > 0 || i.status === "open"));
  const bought = (db.purchases ?? []).some(p => p.orderId === o.id);
  const material = issued
    ? "Material is issued against it — cancel the issue first (Manufacturing, on the order page)"
    : bought ? "Material is bought for it — remove the purchase first (Manufacturing, on the order page)" : undefined;
  return { piece, material, kind };
}
