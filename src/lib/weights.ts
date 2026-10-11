import { CARAT_TO_GRAM, type MaterialIssuance, type Order } from "./db";

/**
 * Jewellery weights, the way the trade reads them.
 *
 *   Gross weight (GW) — the whole piece on the scale: metal + every stone.
 *   Net weight   (NW) — the metal only (here: the gold; a second metal on a
 *                       two-tone piece is kept on its own).
 *   Less weight       — GW − NW: what the stones weigh. A carat is 0.2 g, so
 *                       1 ct of diamond is 0.2 g of the gross.
 *
 * So net can never be more than gross, and gross can never be less than the
 * metal plus the diamonds in it. Every screen that takes these weights checks
 * them here, and every screen that shows them works them out here, so a card,
 * a band, an export and a stock item can never tell three different stories.
 */

const n3 = (x: number) => Math.round(x * 1000) / 1000;

/** A scale reads to 0.001 g and carats are rounded; anything inside this is the same weight. */
const TOLERANCE_G = 0.01;

export interface WeightInput {
  gross?: number;     // g
  net?: number;       // g — the gold
  other?: number;     // g — a second metal (two-tone)
  diamondCt?: number; // ct
}

const pos = (x: number | undefined) => (x != null && isFinite(x) && x > 0 ? x : 0);

/**
 * What is wrong with these weights, in words someone at the counter can act
 * on — or null when they hang together. Blank fields are not checked: a weight
 * nobody has entered yet is not a mistake.
 */
export function weightProblem(w: WeightInput): string | null {
  for (const [label, v] of [["Gross", w.gross], ["Net", w.net], ["Diamond", w.diamondCt], ["Second metal", w.other]] as const) {
    if (v != null && isFinite(v) && v < 0) return `${label} weight can't be negative.`;
  }
  const gross = pos(w.gross), net = pos(w.net), other = pos(w.other), ct = pos(w.diamondCt);
  if (!gross) return null;
  if (net > gross + TOLERANCE_G) {
    return `Net weight (${n3(net)} g) is more than gross weight (${n3(gross)} g). Gross is the whole piece and net is the metal only, so net can never be more than gross.`;
  }
  const stonesG = n3(ct * CARAT_TO_GRAM);
  const least = n3(net + other + stonesG);
  if (least > gross + TOLERANCE_G) {
    const parts = [net ? `net ${n3(net)} g` : "", other ? `second metal ${n3(other)} g` : "", ct ? `diamond ${n3(ct)} ct × 0.2 = ${stonesG} g` : ""].filter(Boolean);
    return `Gross weight (${n3(gross)} g) is less than what is in the piece: ${parts.join(" + ")} = ${least} g. Check the gross, the net or the diamond weight.`;
  }
  return null;
}

/**
 * The line shown under the weights while they are typed: the less weight and
 * what it comes to in carats, against the diamonds entered. Not an error —
 * the difference may be coloured stones, pearls or findings.
 */
export function weightSummary(w: WeightInput): string | null {
  const gross = pos(w.gross), net = pos(w.net), other = pos(w.other), ct = pos(w.diamondCt);
  if (!gross || !net) return ct ? `Diamond ${n3(ct)} ct = ${n3(ct * CARAT_TO_GRAM)} g of the gross weight.` : null;
  const less = n3(gross - net - other);
  if (less < 0) return null;
  const stonesG = n3(ct * CARAT_TO_GRAM);
  const rest = n3(less - stonesG);
  let s = `Less weight (GW − NW${other ? " − second metal" : ""}) = ${less} g ≈ ${n3(less / CARAT_TO_GRAM)} ct`;
  if (ct) s += ` · diamond ${n3(ct)} ct = ${stonesG} g`;
  if (rest > TOLERANCE_G) s += ` · ${rest} g not accounted for (coloured stones, pearls, findings?)`;
  return s + ".";
}

export interface PieceWeights {
  gross: number;
  net: number;
  other: number;
  diamondCt: number;
  /** Nothing actual has been recorded yet — these are the order's estimates. */
  estimated: boolean;
  /** The recorded figures contradict each other (net over gross, or gross under metal + stones). */
  problem: string | null;
}

/**
 * The weights of an order's piece, from the best figures there are:
 * actual details first, then the finished-piece net weight recorded with the
 * factory, then the estimates taken when the order was placed. Where no gross
 * was weighed, it is built as the approval screen builds it — metal plus the
 * diamonds' own weight — so it can never come out under the net.
 */
export function pieceWeights(o: Order, issuances: MaterialIssuance[] = []): PieceWeights {
  const finish = issuances.find(i => i.orderId === o.id && i.material === "gold" && i.finishedNetWeight != null);
  const diamondCt = pos(o.actualDiamondWeight ?? o.diamondWeight);
  const actualNet = o.actualNetWeight ?? finish?.finishedNetWeight;
  const net = pos(actualNet ?? o.estimatedNetWeight);
  const other = pos(o.otherMetalWeight);
  const built = net + other + diamondCt * CARAT_TO_GRAM;
  let gross: number;
  if (o.actualGrossWeight) gross = o.actualGrossWeight;
  else if (actualNet != null && built > 0) gross = built;
  else if (o.estimatedGrossWeight) gross = o.estimatedGrossWeight;
  else gross = net > 0 ? built : 0;
  const estimated = o.actualGrossWeight == null && actualNet == null && o.actualDiamondWeight == null;
  return {
    gross: n3(gross), net: n3(net), other: n3(other), diamondCt: n3(diamondCt), estimated,
    problem: weightProblem({ gross, net, other, diamondCt }),
  };
}
