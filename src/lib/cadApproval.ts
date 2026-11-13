// The client's approval of a CAD design — Approve, or Ask for changes — from their own order page.
//
// Each answer is kept on the order (Order.cadReviews, newest last) with the CAD image it was
// given on: a new image needs a new answer. The CAD stage waits for "approved" on the image on
// file; staff can record the approval for a client who gave it by phone or WhatsApp (onBehalf).
// With no CAD image uploaded there is nothing to approve, and the stage works as it always did.
import { adminIds, notifyUsers } from "./notify";
import type { CadReview, DB, Order } from "./db";

export type CadState = "none" | "waiting" | "approved" | "changes";

/** The answer given on the CAD image now on file, if any. */
export function cadReviewNow(o: Pick<Order, "cadImage" | "cadReviews">): CadReview | undefined {
  if (!o.cadImage) return undefined;
  const mine = (o.cadReviews ?? []).filter(r => !r.image || r.image === o.cadImage);
  return mine[mine.length - 1];
}

/** Where the design stands with the client. */
export function cadState(o: Pick<Order, "cadImage" | "cadReviews">): CadState {
  if (!o.cadImage) return "none";
  return cadReviewNow(o)?.status ?? "waiting";
}

/** Whether the CAD stage can be called done without asking: no image (nothing to approve) or approved. */
export function cadClear(o: Pick<Order, "cadImage" | "cadReviews">): boolean {
  const s = cadState(o);
  return s === "none" || s === "approved";
}

/**
 * Record the client's answer (inside updateDb). The people working on the order hear of it:
 * who it is assigned to, the client's handler, and the admins. Returns false when the image
 * changed meanwhile (the answer would be about a design no longer on file).
 */
export function recordCadReview(d: DB, orderId: string, answer: {
  status: CadReview["status"]; note?: string; image: string;
  by: { id: string; name: string }; onBehalf?: boolean;
}): boolean {
  const o = d.orders.find(x => x.id === orderId);
  if (!o || o.cadImage !== answer.image) return false;
  const at = new Date().toISOString();
  const review: CadReview = {
    status: answer.status, at, by: answer.by.id, byName: answer.by.name, image: answer.image,
    ...(answer.note?.trim() ? { note: answer.note.trim() } : {}), ...(answer.onBehalf ? { onBehalf: true } : {}),
  };
  o.cadReviews = [...(o.cadReviews ?? []), review];
  if (!answer.onBehalf) {
    const handler = d.clients.find(c => c.id === o.clientId)?.accountManagerId;
    notifyUsers(d, [o.assignedEmployeeId, handler, ...adminIds(d)], {
      title: answer.status === "approved" ? `CAD approved: ${o.orderNumber}` : `CAD changes asked: ${o.orderNumber}`,
      body: answer.status === "approved"
        ? `${answer.by.name} approved the design — the CAD stage can be completed.`
        : `${answer.by.name}: ${answer.note?.trim() || "asked for changes"}`,
      type: "order", at,
    }, answer.by.id);
  }
  return true;
}
