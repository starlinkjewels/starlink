/**
 * GST on a supplier's bill — "In bill".
 *
 * A purchase is either bought on a proper bill, with GST on it, or without one.
 * Ticked "In bill", each line of the bill carries its GST: the line's amount
 * after its discount × the bill's % (Settings → Pricing starts it at 1.5%).
 *
 * The GST is INSIDE the purchase's total (totalInr, and totalUsd on a dollar
 * bill): it is what the supplier is owed and what the material really cost us,
 * so the supplier's dues, payments, stock value and average cost, an order's
 * cost and profit all carry it with nothing else to change. The rate fields
 * (₹ a gram, a carat, a piece) stay the bill's own rate before GST.
 *
 * gstBill is true for a bill with GST, false for one ticked off (no bill), and
 * unset on everything entered before — those show nothing new.
 */
import type { Purchase, Settings } from "./db";
import { fmtMoneyInr } from "./manufacturing";

export const DEFAULT_PURCHASE_GST_PCT = 1.5;

type GstOf = Pick<Purchase, "gstBill" | "gstPct" | "gstInr">;

/** The % a new bill starts on: Settings → Pricing, else 1.5%. */
export function defaultPurchaseGstPct(s?: Pick<Settings, "purchaseGstPct"> | null): number {
  const v = s?.purchaseGstPct;
  return v != null && isFinite(v) && v >= 0 ? v : DEFAULT_PURCHASE_GST_PCT;
}

/** A % as typed, kept to two places and inside 0–100. */
export function cleanGstPct(v: number | string | undefined): number {
  const n = Number(v);
  return isFinite(n) ? Math.min(Math.max(Math.round(n * 100) / 100, 0), 100) : 0;
}

/**
 * One line's GST in ₹: its amount after discount × the %. To the rupee, as
 * every rupee figure on a purchase is — a few paise left on a bill would leave
 * it "pending ₹0" after the supplier is paid in full.
 */
export function gstOn(netInr: number, pct: number): number {
  return pct > 0 ? Math.round((netInr * pct) / 100) : 0;
}

/** A dollar line with its GST, to the cent. */
export function usdWithGst(netUsd: number, pct: number): number {
  return Math.round(netUsd * (1 + (pct > 0 ? pct : 0) / 100) * 100) / 100;
}

/** What a purchase of the bill records: GST on (with its % and this line's
 *  amount), or explicitly off. */
export function gstFields(on: boolean, pct: number, netInr: number): GstOf {
  return on ? { gstBill: true, gstPct: pct, gstInr: gstOn(netInr, pct) } : { gstBill: false };
}

/** The GST inside a purchase's total — 0 when there is none. */
export function purchaseGstInr(p: GstOf): number {
  return p.gstBill ? Math.max(0, p.gstInr ?? 0) : 0;
}

/** The purchase before GST: what the goods came to on the supplier's bill. */
export function preGstInr(p: GstOf & Pick<Purchase, "totalInr">): number {
  return (p.totalInr || 0) - purchaseGstInr(p);
}

/** "1.5" — a % without trailing zeros. */
export const pctText = (n: number | undefined) => String(Math.round((n ?? 0) * 100) / 100);

/** "GST 1.5%" on a bill with GST, "No bill" on one without; nothing on an older entry. */
export function gstTag(p: GstOf | null | undefined): string | undefined {
  if (!p) return undefined;
  if (p.gstBill === true) return `GST ${pctText(p.gstPct)}%`;
  if (p.gstBill === false) return "No bill";
  return undefined;
}

/** "GST 1.5% · ₹750" — the tag with its amount; "No bill"; nothing on an older entry. */
export function gstText(p: GstOf | null | undefined): string | undefined {
  if (!p) return undefined;
  if (p.gstBill === true) return `GST ${pctText(p.gstPct)}% · ${fmtMoneyInr(purchaseGstInr(p))}`;
  return gstTag(p);
}

/** Which way a purchase was bought, for a filter: "gst", "nobill", or "" (not known). */
export function gstKind(p: GstOf): "gst" | "nobill" | "" {
  return p.gstBill === true ? "gst" : p.gstBill === false ? "nobill" : "";
}
