// Product pricing — the app's side. The rules (Settings → Product pricing) are
// staff-only: staff price a design on their own screen (lib/pure/pricing.ts, with
// today's per-gram rates); a client asks the server (functions-specs specsPrice)
// and gets their price alone, never the costs or the margin behind it.
import { useEffect, useMemo, useState } from "react";
import { doc, onSnapshot, setDoc } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db as fsdb, functions } from "./firebase";
import { useRates, useRateSettings } from "./liveRates";
import { karatRates, type KaratRate } from "./pure/liveRates";
import { cleanRules, type Ccy, type Choice, type DiamondQuality, type MetalKey, type PriceRules } from "./pure/pricing";
import type { StoneRow } from "./pure/specParse";

export function usePriceRules(on = true): PriceRules | undefined {
  const [r, set] = useState<PriceRules | undefined>(undefined);
  useEffect(() => {
    if (!on) return;
    return onSnapshot(doc(fsdb, "priceRules", "main"), d => set(cleanRules(d.data())), () => set(cleanRules({})));
  }, [on]);
  return r;
}
export async function savePriceRules(r: PriceRules, by: string): Promise<void> {
  await setDoc(doc(fsdb, "priceRules", "main"), JSON.parse(JSON.stringify({ ...cleanRules(r), updatedAt: new Date().toISOString(), updatedBy: by })));
}

/** Today's per-gram rates of every metal, and ₹ per $ — null until the rates have been read once. */
export function useMetalRates(): { karat: KaratRate[]; usdInr: number; at: string } | null | undefined {
  const rates = useRates();
  const settings = useRateSettings();
  return useMemo(() => {
    if (rates === undefined || settings === undefined) return undefined;
    if (!rates?.price) return null;
    return { karat: karatRates(rates.price, settings), usdInr: rates.price.usdInr, at: rates.price.at };
  }, [rates, settings]);
}

/** What the server tells a buyer about a design (functions-specs quote): never the costs behind the price. */
export type DesignQuote =
  | { ready: false; designNo: string }
  | {
      ready: true;
      designNo: string;
      options: { metals: MetalKey[]; colours: { id: string; label: string }[]; ringSizes: number[]; types: { id: string; label: string }[]; qualities: DiamondQuality[]; ccy: Ccy; hasStones: boolean; category: string | null; centre: { drawn: number; sizes: number[]; shape?: string; pcs: number } | null };
      choice: Choice | null;
      details: { stones: StoneRow[]; stoneTotals: { pcs: number; ct: number } | null; dimsMm: number[]; ringSize: string | null; grams: number; sheetUs: number | null };
      price: number | null;
      ccy?: Ccy;
      asOf?: string | null;
    };
export type ClientQuote = DesignQuote & { see: "price" | "details" };
/** A client's price for these options (or, for staff, a client's price as that client sees it). */
export const clientQuote = async (key: string, choice: Partial<Choice> = {}) =>
  (await httpsCallable<{ key: string; choice: Partial<Choice> }, ClientQuote>(functions, "specsPrice", { timeout: 30_000 })({ key, choice })).data;
/** A shared design's link: what the link lets anyone see (signed in or not). A category's link: its `product`-th piece. */
export const shareQuote = async (id: string, choice: Partial<Choice> = {}, product?: number) =>
  (await httpsCallable<{ id: string; choice: Partial<Choice>; product?: number }, DesignQuote>(functions, "specsShare", { timeout: 30_000 })({ id, choice, ...(product != null ? { product } : {}) })).data;
/** A client's own order's piece (Design Studio → By Order): their price, or details only — worked out on the server. */
export const orderQuote = async (orderId: string, choice: Partial<Choice> = {}) =>
  (await httpsCallable<{ orderId: string; choice: Partial<Choice> }, ClientQuote>(functions, "specsOrderPrice", { timeout: 30_000 })({ orderId, choice })).data;

export const money = (n: number, ccy: Ccy) =>
  ccy === "INR" ? `₹${Math.round(n).toLocaleString("en-IN")}` : `$${n.toLocaleString("en-US", { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 })}`;
