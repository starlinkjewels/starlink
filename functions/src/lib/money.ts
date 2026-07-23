// Mirrors orderTotal()/totalAdvance()/balanceDue() in src/lib/db.ts — keep both
// in sync if the pricing formula ever changes.

export interface OrderMoneyFields {
  amount?: number;
  shippingCharge?: number;
  certificateFee?: number;
  advances?: Array<{ amount?: number }>;
}

export function orderTotal(o: OrderMoneyFields): number {
  return (o.amount || 0) + (o.shippingCharge || 0) + (o.certificateFee || 0);
}

export function totalAdvance(o: OrderMoneyFields): number {
  return (o.advances || []).reduce((s, a) => s + (a.amount || 0), 0);
}

export function balanceDue(o: OrderMoneyFields): number {
  return Math.max(0, orderTotal(o) - totalAdvance(o));
}
