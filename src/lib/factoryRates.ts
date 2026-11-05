// A factory's rate card: labour by metal and by item — ₹ a gram, and the
// minimum it charges a light piece (under so many grams) — each line its own.
// Final Approval starts from it (pages/OrderDetail); the factory's Add and Edit
// forms set it (components/FactoryLabourFields).
//
// A blank is looked for further down, in this order:
//   this metal · this item → this metal · all items → gold · this item → gold · all items
// so a factory that set gold only charges every metal as before, and one line
// ("Platinum · all items") covers every platinum item without its own.
import { DIAMOND_ONLY_METAL, type FactoryLabour, type LabourRate, type Settings } from "./db";
import { metalHasKarats } from "./metals";

/** Every gold — any colour, any karat — is on this card. */
export const GOLD_CARD = "Gold";

const key = (s?: string) => (s ?? "").trim().replace(/\s+/g, " ").toLowerCase();
export const sameName = (a?: string, b?: string) => key(a) === key(b);

/** The card a metal is charged from: gold of any colour on the gold card; platinum, silver… each its own. */
export function cardMetal(metal: string | undefined, settings?: Settings): string {
  const m = (metal ?? "").trim();
  if (!m || m === DIAMOND_ONLY_METAL || metalHasKarats(m, settings)) return GOLD_CARD;
  return m;
}

/** A factory's rate card: its lines — or, saved before the card, its old rates read as lines. */
export function rateCardOf(l?: FactoryLabour): LabourRate[] {
  if (!l) return [];
  if (l.rates) return l.rates;
  const out: LabourRate[] = [];
  if (l.minimum) out.push({ metal: GOLD_CARD, minimum: l.minimum, ...(l.minimumUnder ? { minimumUnder: l.minimumUnder } : {}) });
  for (const [item, perGram] of Object.entries(l.perGram ?? {})) if (perGram > 0) out.push({ metal: GOLD_CARD, item, perGram });
  for (const [metal, perGram] of Object.entries(l.perMetal ?? {})) if (perGram > 0) out.push({ metal, perGram });
  return out;
}

/** Which line a rate came from: a metal, and an item (unset = all items). */
export interface RateFrom { metal: string; item?: string }
export interface FactoryRate { perGram?: number; perGramFrom?: RateFrom; minimum?: number; minimumUnder?: number; minimumFrom?: RateFrom }

/**
 * The rate and the minimum on a card for a metal (already the card's: cardMetal)
 * and an item, each looked for down the order above. `from` skips that many
 * steps — 1: what a line inherits when it is left blank.
 */
export function rateIn(card: LabourRate[], metal: string, item: string | undefined, from = 0): FactoryRate {
  const it = (item ?? "").trim();
  const gold = sameName(metal, GOLD_CARD);
  const steps: [string, string][] = [
    ...(it ? [[metal, it] as [string, string]] : []), [metal, ""],
    ...(gold ? [] : [...(it ? [[GOLD_CARD, it] as [string, string]] : []), [GOLD_CARD, ""] as [string, string]]),
  ];
  const out: FactoryRate = {};
  for (const [m, i] of steps.slice(from)) {
    const r = card.find(x => sameName(x.metal, m) && (i ? sameName(x.item, i) : !(x.item ?? "").trim()));
    if (!r) continue;
    if (out.perGram == null && (r.perGram ?? 0) > 0) { out.perGram = r.perGram; out.perGramFrom = { metal: r.metal, ...(i ? { item: r.item } : {}) }; }
    if (out.minimum == null && (r.minimum ?? 0) > 0) {
      out.minimum = r.minimum; out.minimumFrom = { metal: r.metal, ...(i ? { item: r.item } : {}) };
      if ((r.minimumUnder ?? 0) > 0) out.minimumUnder = r.minimumUnder;
    }
  }
  return out;
}

/** A factory's rate and minimum for a piece's metal (any name — gold of any colour is gold) and item. */
export function factoryRate(l: FactoryLabour | undefined, metal: string | undefined, item: string | undefined, settings?: Settings): FactoryRate {
  return rateIn(rateCardOf(l), cardMetal(metal, settings), item);
}

/** "Platinum · Ring", "Gold · all items". */
export const fromLabel = (f: RateFrom) => `${f.metal} · ${f.item ?? "all items"}`;
