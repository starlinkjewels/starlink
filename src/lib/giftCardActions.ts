// What can be done to a gift card once it is issued: only cancelling it.
//
// A card is money promised to a client, and orders may already have spent
// part of it — so it is never edited (the amount, the expiry) and never
// deleted. A wrong card is cancelled and, if need be, a right one issued.
import { toast } from "sonner";
import { fmtMoney, giftCardRemaining, giftCardStatus, loadDb, updateDbAs, type GiftCard, type Order } from "./db";
import { confirmBox } from "./confirm";

export const GIFT_CARD_NO_EDIT = "Gift cards can't be changed — cancel it and issue a new one";
export const GIFT_CARD_NO_DELETE = "Gift cards are never deleted — cancel instead";

/** Why this card can't be cancelled; undefined when it can. */
export function giftCardCancelBlocker(card: GiftCard, orders: Order[]): string | undefined {
  const st = giftCardStatus(card, orders);
  if (st === "cancelled") return "Already cancelled";
  if (st === "used") return "Already used — nothing left on it";
  if (st === "expired") return "Expired — it can't be used any more";
  return undefined;
}

/** Ask, then cancel the card: what is left on it can no longer be spent. */
export async function cancelGiftCardFlow(cardId: string): Promise<boolean> {
  const db = loadDb();
  const card = (db.giftCards ?? []).find(c => c.id === cardId);
  if (!card) { toast.error("That gift card is no longer there"); return false; }
  const why = giftCardCancelBlocker(card, db.orders);
  if (why) { toast.error(why); return false; }
  const left = giftCardRemaining(card, db.orders);
  const client = db.clients.find(c => c.id === card.clientId)?.companyName ?? "the client";
  if (!(await confirmBox(
    `Cancel this gift card? The client will no longer be able to use it.\n\n`
    + `• the ${fmtMoney(left)} left on it can't be spent by ${client} any more\n`
    + "• what was already used on orders stays on those orders",
  ))) return false;
  updateDbAs({ summary: `Cancelled a ${fmtMoney(card.amount)} gift card — ${client}` }, d => {
    const c = (d.giftCards ?? []).find(x => x.id === cardId);
    if (c) c.revoked = true;
  });
  toast.success("Gift card cancelled");
  return true;
}
