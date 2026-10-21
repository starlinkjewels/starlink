// How an order is described in a line — the lists, the board, invoices, the
// order's own title. A loose-diamond order is described by its stones (carats,
// type, shape, grade), never by a metal it doesn't have.
import { isDiamondOnlyOrder, type Order } from "./db";
import { metalLabel } from "./metals";

type O = Pick<Order, "metal" | "jewelleryType" | "productKarats" | "diamondWeight" | "diamondType" | "actualDiamondWeight" | "quantity" | "stoneSpec">;

/** "1.22 ct · HPHT · Round 1.3 mm · F VS · 12 stones" — the stones of a loose-diamond order. */
export function stonesLine(o: O): string {
  const ct = o.actualDiamondWeight || o.diamondWeight;
  const s = o.stoneSpec ?? {};
  const grade = [s.color, s.clarity].filter(Boolean).join(" ");
  const shape = [s.shape, s.mm || s.size].filter(Boolean).join(" ");
  return [ct ? `${ct} ct` : "", o.diamondType, shape, grade, o.quantity > 1 ? `${o.quantity} stones` : ""].filter(Boolean).join(" · ");
}

/** "Ring · Yellow Gold 14K", or "Loose diamonds · 1.22 ct · HPHT · Round". */
export function pieceLine(o: O, karats = true): string {
  if (isDiamondOnlyOrder(o)) return ["Loose diamonds", stonesLine(o)].filter(Boolean).join(" · ");
  return `${o.jewelleryType} · ${metalLabel(o.metal)}${karats && o.productKarats ? ` ${o.productKarats}` : ""}`;
}

/** The order's title: "Ring in Yellow Gold", or "HPHT diamonds · 1.22 ct". */
export function orderTitle(o: O): string {
  if (!isDiamondOnlyOrder(o)) return `${o.jewelleryType} in ${metalLabel(o.metal)}`;
  const ct = o.actualDiamondWeight || o.diamondWeight;
  return `${o.diamondType ? `${o.diamondType} diamonds` : "Loose diamonds"}${ct ? ` · ${ct} ct` : ""}`;
}
