// How an order is described in a line — the lists, the board, invoices, the
// order's own title. A loose order is described by its stones (what they are,
// carats, shape, grade), never by a metal it doesn't have — and gems are called
// gems: an emerald sale never reads "diamonds".
import { isDiamondOnlyOrder, type Order } from "./db";
import { metalLabel } from "./metals";

type O = Pick<Order, "metal" | "jewelleryType" | "productKarats" | "diamondWeight" | "diamondType" | "actualDiamondWeight" | "quantity" | "stoneSpec">;

/** What a loose order's stones are: "Diamond", "Emerald", "Emerald + Diamond". */
export function stoneOf(o: Pick<Order, "stoneSpec">): string {
  return o.stoneSpec?.stone?.trim() || "Diamond";
}

/** Whether a loose order's stones are (or include) diamonds — the diamond type and sieve apply. */
export const hasDiamonds = (stone: string) => /\bdiamonds?\b/i.test(stone);

/** "Loose diamonds", "Loose Emerald", "Loose Emerald + Diamond" — where a list says what the order is. */
export function looseLabel(o: Pick<Order, "stoneSpec">): string {
  const s = stoneOf(o);
  return s === "Diamond" ? "Loose diamonds" : `Loose ${s}`;
}

/** "1.22 ct · HPHT · Round 1.3 mm · F VS · 12 stones" — the stones of a loose order. */
export function stonesLine(o: O): string {
  const ct = o.actualDiamondWeight || o.diamondWeight;
  const s = o.stoneSpec ?? {};
  const grade = [s.color, s.clarity].filter(Boolean).join(" ");
  const shape = [s.shape, s.mm || s.size].filter(Boolean).join(" ");
  return [ct ? `${ct} ct` : "", hasDiamonds(stoneOf(o)) ? o.diamondType : "", shape, grade, o.quantity > 1 ? `${o.quantity} stones` : ""].filter(Boolean).join(" · ");
}

/** "Ring · Yellow Gold 14K", "Loose diamonds · 1.22 ct · HPHT · Round", or "Loose Emerald · 3.2 ct · Oval". */
export function pieceLine(o: O, karats = true): string {
  if (isDiamondOnlyOrder(o)) return [looseLabel(o), stonesLine(o)].filter(Boolean).join(" · ");
  return `${o.jewelleryType} · ${metalLabel(o.metal)}${karats && o.productKarats ? ` ${o.productKarats}` : ""}`;
}

/** The order's title: "Ring in Yellow Gold", "HPHT diamonds · 1.22 ct", or "Emerald · 3.2 ct". */
export function orderTitle(o: O): string {
  if (!isDiamondOnlyOrder(o)) return `${o.jewelleryType} in ${metalLabel(o.metal)}`;
  const ct = o.actualDiamondWeight || o.diamondWeight;
  const s = stoneOf(o);
  const what = s !== "Diamond" ? s : o.diamondType ? `${o.diamondType} diamonds` : "Loose diamonds";
  return `${what}${ct ? ` · ${ct} ct` : ""}`;
}
