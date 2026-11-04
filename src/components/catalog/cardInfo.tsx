// What a catalogue card says under its picture when the file belongs to a design
// with details: the design's number, its price (as the card shows it: the metal
// its sheet is drawn in, the first diamond quality — lib/pure/pricing.ts
// defaultChoice) and its metal, gold weight and carats — instead of the file's
// name. Read for the cards on screen only: their designs in one read, a client's
// prices in one call (functions-specs specsCards, the totals alone).
import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { collection, documentId, getDocs, query, where } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db as fsdb, functions } from "@/lib/firebase";
import type { CatalogItem } from "@/lib/db";
import type { CatalogDesign } from "@/lib/catalogSpecs";
import { money, useMetalRates, usePriceRules } from "@/lib/productPricing";
import { defaultChoice, gramsFor, METAL_LABEL, priceDesign, type Ccy } from "@/lib/pure/pricing";

export interface CardInfo { key: string; no: string; line: string; price?: string }
export const CardInfoContext = createContext<Record<string, CardInfo>>({});
/** A card's design line, when its file has one. */
export const useCardInfo = (item: CatalogItem): CardInfo | undefined => {
  const all = useContext(CardInfoContext);
  return item.design?.key && item.design.role !== "cad" && item.design.role !== "doc" ? all[item.design.key] : undefined;
};

// Designs read in this visit, kept two minutes — Back to a folder reads none again.
const kept = new Map<string, { d: CatalogDesign | null; at: number }>();
async function loadDesigns(keys: string[]): Promise<Record<string, CatalogDesign>> {
  const fresh = (k: string) => { const x = kept.get(k); return x && Date.now() - x.at < 120_000; };
  const need = keys.filter(k => !fresh(k));
  for (let i = 0; i < need.length; i += 30) {
    const part = need.slice(i, i + 30);
    const snap = await getDocs(query(collection(fsdb, "catalogDesigns"), where(documentId(), "in", part)));
    const got = new Map(snap.docs.map(d => [d.id, d.data() as CatalogDesign]));
    for (const k of part) kept.set(k, { d: got.get(k) ?? null, at: Date.now() });
  }
  return Object.fromEntries(keys.map(k => [k, kept.get(k)?.d]).filter((x): x is [string, CatalogDesign] => !!x[1]));
}

/** The card lines for these items (the page's loaded items). Staff price here; a client asks the server. */
export function useCardInfos(items: CatalogItem[], staff: boolean): Record<string, CardInfo> {
  const keys = useMemo(() => [...new Set(items.map(i => i.design?.key).filter((k): k is string => !!k))].sort(), [items]);
  const keyStr = keys.join("|");
  const [designs, setDesigns] = useState<Record<string, CatalogDesign>>({});
  const [clientPrices, setClientPrices] = useState<Record<string, { price: number; ccy: Ccy }>>({});
  const rules = usePriceRules(staff);
  const rates = useMetalRates();
  useEffect(() => {
    if (!keys.length) return;
    let alive = true;
    void loadDesigns(keys).then(d => { if (alive) setDesigns(x => ({ ...x, ...d })); }).catch(() => undefined);
    if (!staff) {
      const ready = keys.slice(0, 60);
      void httpsCallable<{ keys: string[] }, { see: string; prices: Record<string, { price: number; ccy: Ccy }> }>(functions, "specsCards", { timeout: 30_000 })({ keys: ready })
        .then(r => { if (alive) setClientPrices(x => ({ ...x, ...r.data.prices })); }).catch(() => undefined);
    }
    return () => { alive = false; };
  }, [keyStr, staff]); // eslint-disable-line react-hooks/exhaustive-deps

  return useMemo(() => {
    const out: Record<string, CardInfo> = {};
    for (const k of keys) {
      const d = designs[k];
      if (!d) continue;
      const s = d.status === "ok" ? d.specs : null;
      let line = "", price: string | undefined;
      if (s) {
        const choice = rules ? defaultChoice(s, rules, "USD") : null;
        const metal = choice?.metal ?? Object.keys(s.metal ?? {})[0];
        const g = metal ? (rules && choice ? gramsFor(s.metal ?? {}, choice.metal, rules).g : (s.metal ?? {})[metal]) : 0;
        const ct = s.stoneTotals?.ct ?? (s.stones ?? []).reduce((t, r) => t + r.total, 0);
        line = [metal ? (METAL_LABEL[metal as keyof typeof METAL_LABEL] ?? metal) : null, g ? `${+g.toFixed(2)} g` : null, ct ? `${+ct.toFixed(2)} ct` : null].filter(Boolean).join(" · ");
        if (staff && rules && choice) { const p = priceDesign(s, choice, rules, rates ?? null); if (!p.missing.length) price = money(p.price, p.ccy); }
        else if (!staff && clientPrices[k]) price = money(clientPrices[k].price, clientPrices[k].ccy);
      }
      out[k] = { key: k, no: d.designNo, line, ...(price ? { price } : {}) };
    }
    return out;
  }, [keys, designs, rules, rates, staff, clientPrices]);
}
