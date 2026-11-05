import { CARAT_TO_GRAM, loadDb, type MaterialIssuance, type Order, type Settings } from "./db";
import { isOtherMaterial, materialName, materialUnit } from "./materials";
import { isNonGoldMetal, metalFamily } from "./metals";
import { finishRecordOf, isReworkIssue } from "./rework";

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

/** Grams as the trade writes them: always three decimals — 1.250, 1.252, 0.164. */
export const fmtG = (x: number | string | undefined | null): string => n3(Number(x) || 0).toFixed(3);

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
 * The metal's weight from the scale: gross − the stones (1 ct = 0.2 g) − a
 * second metal on a two-tone piece. 2.30 g with 0.45 ct of stones is 2.21 g.
 */
export function netFromGross(grossG: number, stoneCt: number, otherMetalG = 0): number {
  return n3(Math.max(0, pos(grossG) - pos(stoneCt) * CARAT_TO_GRAM - pos(otherMetalG)));
}

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
    const parts = [net ? `net ${n3(net)} g` : "", other ? `second metal ${n3(other)} g` : "", ct ? `diamond ${n3(ct)} ct (${stonesG} g)` : ""].filter(Boolean);
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
  if (!gross || !net) return ct ? `Diamond ${n3(ct)} ct = ${fmtG(ct * CARAT_TO_GRAM)} g of the gross weight.` : null;
  const less = n3(gross - net - other);
  if (less < 0) return null;
  const stonesG = n3(ct * CARAT_TO_GRAM);
  const rest = n3(less - stonesG);
  let s = `Less weight (GW − NW${other ? " − second metal" : ""}) = ${fmtG(less)} g ≈ ${n3(less / CARAT_TO_GRAM)} ct`;
  if (ct) s += ` · diamond ${n3(ct)} ct = ${fmtG(stonesG)} g`;
  if (rest > TOLERANCE_G) s += ` · ${fmtG(rest)} g not accounted for (coloured stones, pearls, findings?)`;
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

export interface OtherMetal { metal: string; weight?: number; purity?: number }
/**
 * Every metal of a piece besides its gold: the list (gold + platinum + silver),
 * else the one "other metal" every order before the list had. The first is
 * always the one in otherMetal / otherMetalWeight / otherMetalPurity.
 */
export function otherMetalsOf(o: Pick<Order, "otherMetal" | "otherMetalWeight" | "otherMetalPurity" | "otherMetals">): OtherMetal[] {
  if (o.otherMetals?.length) return o.otherMetals.filter(m => m && m.metal?.trim());
  return o.otherMetal?.trim() ? [{ metal: o.otherMetal, ...(o.otherMetalWeight != null ? { weight: o.otherMetalWeight } : {}), ...(o.otherMetalPurity != null ? { purity: o.otherMetalPurity } : {}) }] : [];
}
/** The grams of the metals after the first (none on a piece with one other metal, or none). */
export const moreMetalsGrams = (o: Pick<Order, "otherMetal" | "otherMetalWeight" | "otherMetalPurity" | "otherMetals">) =>
  otherMetalsOf(o).slice(1).reduce((t, m) => t + pos(m.weight), 0);

/**
 * A platinum or silver piece whose own metal Final Approval recorded under
 * "other metal" (the scale's weight less the stones) — not a two-tone piece.
 */
export function isSelfMetal(o: Pick<Order, "metal" | "otherMetal" | "otherMetalWeight">): boolean {
  return pos(o.otherMetalWeight) > 0 && !!o.otherMetal?.trim() && !!o.metal
    && o.otherMetal.trim().toLowerCase() === o.metal.trim().toLowerCase();
}

/**
 * A material issued from stock that is the piece's OWN metal — platinum from stock for a platinum
 * piece. It is in that metal's weight (Final Approval leaves it on the scale), never a second metal.
 */
export function isOwnMetalStock(o: Pick<Order, "metal">, materialLabel: string): boolean {
  const fam = metalFamily(materialLabel);
  return !!fam && isNonGoldMetal(o.metal) && fam.toLowerCase() === metalFamily(o.metal).toLowerCase();
}

/**
 * Metal issued from stock for the piece (Settings → Materials, counted in grams — palladium, findings):
 * what went in, less what came back at Final Approval. Final Approval takes it off the scale before the
 * gold, so it is in neither the gold nor the other-metal rows — it is added here. The piece's own metal
 * from stock (platinum for a platinum piece) is not: it is already that metal's weight.
 */
export function stockMetalGrams(o: Pick<Order, "id" | "metal">, issuances: MaterialIssuance[] = [], settings: Pick<Settings, "materials"> = loadDb().settings): number {
  let g = 0;
  for (const i of issuances) {
    if (i.orderId !== o.id || !isOtherMaterial(i.material) || i.source === "melt" || isReworkIssue(i)) continue;
    if (materialUnit(settings, i.material) !== "g" || isOwnMetalStock(o, materialName(settings, i.material))) continue;
    g += Math.max(0, (i.quantityIssued || 0) - (i.finishReturnedQty || 0));
  }
  return n3(g);
}

/**
 * The weights of an order's piece, from the best figures there are:
 * actual details first, then the finished-piece net weight recorded with the
 * factory, then the estimates taken when the order was placed. Where no gross
 * was weighed, it is built as the approval screen builds it — metal plus the
 * diamonds' own weight — so it can never come out under the net.
 */
export function pieceWeights(o: Order, issuances: MaterialIssuance[] = [], settings?: Pick<Settings, "materials">): PieceWeights {
  // The piece's own finish — never a repair's record (lib/rework.ts), whose weight is only what the repair added.
  const golds = issuances.filter(i => i.orderId === o.id && i.material === "gold" && i.finishedNetWeight != null);
  const finish = finishRecordOf(golds, o.id) ?? golds.find(i => !isReworkIssue(i));
  const diamondCt = pos(o.actualDiamondWeight ?? o.diamondWeight);
  const actualNet = o.actualNetWeight ?? finish?.finishedNetWeight;
  // Weighed: metal from stock is in the piece too (as a second metal). Before that, the estimates alone.
  const weighed = o.actualGrossWeight != null || actualNet != null;
  const fromStock = weighed ? stockMetalGrams(o, issuances, settings) : 0;
  if (isSelfMetal(o)) {
    // A platinum or silver piece weighed at Final Approval: its metal is on
    // file under "other metal". That is the piece's metal, not a second one,
    // and the estimate (the same metal, guessed) no longer counts. A net on
    // file is gold beside it only when the scale has room for it — else it is
    // the same metal written down before it was weighed.
    // Any metal after it (a silver part on a titanium piece) is a second metal, as on a gold one.
    const metal = pos(o.otherMetalWeight), stonesG = diamondCt * CARAT_TO_GRAM, more = moreMetalsGrams(o) + fromStock;
    const onScale = pos(o.actualGrossWeight), typed = pos(actualNet);
    const gold = typed && (!onScale || typed + metal + more + stonesG <= onScale + TOLERANCE_G) ? typed : 0;
    const net = metal + gold;
    const gross = onScale || net + more + stonesG;
    return { gross: n3(gross), net: n3(net), other: n3(more), diamondCt: n3(diamondCt), estimated: false, problem: weightProblem({ gross, net, other: more, diamondCt }) };
  }
  // metalWeight: the old single "gold weight" estimate — metal only, so net.
  const net = pos(actualNet ?? (o.estimatedNetWeight || o.metalWeight));
  const other = pos(o.otherMetalWeight) + moreMetalsGrams(o) + fromStock;
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
