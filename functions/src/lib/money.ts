// Mirrors orderTotal()/totalAdvance()/balanceDue() in src/lib/db.ts — keep both
// in sync if the pricing formula ever changes.

export interface OrderMoneyFields {
  amount?: number;
  shippingCharge?: number;
  certificateFee?: number;
  giftCardRedeemed?: number;
  /** Pieces the client sent back — each credit comes off the bill. */
  returns?: Array<{ creditUsd?: number }>;
  advances?: Array<{ amount?: number }>;
}

export function orderTotal(o: OrderMoneyFields): number {
  const gross = (o.amount || 0) + (o.shippingCharge || 0) + (o.certificateFee || 0);
  const returned = (o.returns || []).reduce((s, r) => s + (r.creditUsd || 0), 0);
  return Math.max(0, Math.round((gross - (o.giftCardRedeemed || 0) - returned) * 100) / 100);
}

export function totalAdvance(o: OrderMoneyFields): number {
  return (o.advances || []).reduce((s, a) => s + (a.amount || 0), 0);
}

export function balanceDue(o: OrderMoneyFields): number {
  return Math.max(0, orderTotal(o) - totalAdvance(o));
}
