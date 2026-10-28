import type { Settings } from "./db";

/**
 * The order page's sections, in the order they have always been shown. The
 * admin puts them in their own order (Settings → Order page); the order's own
 * header — the piece at a glance — always stays at the top. A section a page
 * has nothing for (no CAD yet, a client's view) is simply not there, wherever
 * it sits in the list.
 */
export const ORDER_SECTIONS = [
  { key: "cad", label: "CAD design", note: "The design and the client's approval" },
  { key: "dispatch", label: "Dispatch information", note: "Courier, tracking and the day it left" },
  { key: "photos", label: "Product photography", note: "Photos and the video of the finished piece" },
  { key: "profit", label: "Cost & profit", note: "Admins only" },
  { key: "payments", label: "Payments", note: "What the client has paid and still owes" },
  { key: "timeline", label: "Production timeline", note: "The stages of the order" },
  { key: "manufacturing", label: "Manufacturing", note: "Materials bought and issued to the factory — staff only" },
  { key: "log", label: "Manufacturing log", note: "Everything that happened, in order — staff only" },
] as const;

export type OrderSectionKey = (typeof ORDER_SECTIONS)[number]["key"];
export const DEFAULT_ORDER_SECTIONS: OrderSectionKey[] = ORDER_SECTIONS.map(s => s.key);

/** The sections in the business's order: what was saved (sections it doesn't know are dropped),
 *  then any section added since, in its default place. */
export function orderSections(settings: Pick<Settings, "orderPageSections"> | undefined): OrderSectionKey[] {
  const known = new Set<string>(DEFAULT_ORDER_SECTIONS);
  const saved = [...new Set((settings?.orderPageSections ?? []).filter(k => known.has(k)))] as OrderSectionKey[];
  const out = [...saved];
  DEFAULT_ORDER_SECTIONS.forEach((k, i) => {
    if (out.includes(k)) return;
    // A section new since the list was saved goes after the one it follows by default.
    const before = DEFAULT_ORDER_SECTIONS.slice(0, i).reverse().find(b => out.includes(b));
    out.splice(before ? out.indexOf(before) + 1 : 0, 0, k);
  });
  return out;
}

/** Each section's place on the page (CSS order), for the page to lay them out by. */
export function orderSectionRank(settings: Pick<Settings, "orderPageSections"> | undefined): Record<OrderSectionKey, number> {
  return Object.fromEntries(orderSections(settings).map((k, i) => [k, i + 1])) as Record<OrderSectionKey, number>;
}
