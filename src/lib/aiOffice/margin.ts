// Gold-rate margin guard: an order's price is fixed when it is taken, its gold
// isn't — what the gold in it is worth moves with the market until the piece is
// made and sent. For each open gold order: its fine gold (the estimate, or what
// went into it), our gold cost on the day it was taken (the stock's average — what
// prices are worked from) against today's market rate, what that difference
// comes to, and how much of the order's value it eats. No AI: the same figures
// every time, each with how it was worked out.
import { orderTotal, type DB, type Order } from "@/lib/db";
import { estimatedPureGoldNeeded } from "@/lib/manufacturing";
import { inrOn, stockFineGoldRate } from "@/lib/orderCost";
import { workCompanyOf } from "@/lib/companies";

export interface MarginHit {
  orderId: string;
  orderNumber: string;
  clientId: string;
  stage: string;
  /** Fine (24K) gold in it, g — estimated until Final Approval. */
  fineG: number;
  rateThenInr: number;
  rateNowInr: number;
  /** The gold's change in value, ₹ and in the order's $ (at today's ₹ per $). */
  changeInr: number;
  changeUsd: number;
  valueUsd: number;
  /** changeUsd as % of the order's value: what it takes off (or adds to) the margin. */
  pctOfValue: number;
}

const OPEN = ["Waiting", "Approved", "In Production", "Ready"];

/** Fine gold per gram in ₹ at today's market rate (24K, from the live rates), or null when there is none. */
export function liveFineInr(price?: { gold999Inr10g?: number } | null): number | null {
  const v = price?.gold999Inr10g;
  return v && v > 0 ? Math.round((v / 10 / 0.999) * 100) / 100 : null;
}

export function marginGuard(db: DB, fineNowInr: number | null, now = new Date()): { hits: MarginHit[]; note?: string } {
  if (!fineNowInr) return { hits: [], note: "Today's gold rate isn't in yet (Settings → Live rates) — the guard needs it." };
  const usdInr = inrOn(db, "USD", now.toISOString()) ?? 0;
  const hits: MarginHit[] = [];
  const open = db.orders.filter((o: Order) => !o.deletedAt && !o.forReadyStock && OPEN.includes(o.status) && o.amount > 0 && !!o.productKarats && /gold/i.test(o.metal ?? ""));
  for (const o of open) {
    const fine = estimatedPureGoldNeeded(o);
    if (!(fine > 0)) continue;
    const then = stockFineGoldRate(db, o.createdAt, workCompanyOf(db, o))?.rate;
    if (!then || !usdInr) continue;
    const changeInr = Math.round(fine * (fineNowInr - then));
    const changeUsd = Math.round((changeInr / usdInr) * 100) / 100;
    const value = orderTotal(o);
    hits.push({
      orderId: o.id, orderNumber: o.orderNumber, clientId: o.clientId, stage: o.status, fineG: Math.round(fine * 1000) / 1000,
      rateThenInr: Math.round(then), rateNowInr: Math.round(fineNowInr), changeInr, changeUsd, valueUsd: Math.round(value * 100) / 100,
      pctOfValue: value > 0 ? Math.round((changeUsd / value) * 1000) / 10 : 0,
    });
  }
  return { hits: hits.sort((a, b) => b.changeUsd - a.changeUsd) };
}
