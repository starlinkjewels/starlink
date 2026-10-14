/**
 * Melting a finished piece — one that came out wrong, or that the customer
 * turned down, and that is not going into Ready Stock.
 *
 * The piece stops existing; what was in it does not:
 *   • the metal goes back to a factory — at the piece's own karat, or refined
 *     to 24KT — as a delivery into that factory's pool, ready for its next job
 *     (or, if chosen, into our own stock);
 *   • the stones go back into stock: loose diamonds by their quality, certified
 *     packets back to "in stock";
 *   • the labour stays exactly where it is — the factory did the work and is
 *     owed for it, so its charge remains in the factory's ledger to be paid.
 * The order is closed (Rejected), and any advance the client paid moves to
 * their credit, as a cancel does.
 *
 * The gold is recorded the way any delivery to a factory's pool is (a
 * MaterialIssuance with no order), so the factory's fine-gold balance, its
 * pool and the totals the server keeps all count it with no new rule.
 */
import {
  findInvoiceForOrder, toPureGold, pureFromPurity, uid, isDiamondOnlyOrder,
  type DB, type Order, type MaterialIssuance, type OrderMelt,
} from "./db";
import { issuanceUsed } from "./manufacturing";

const r3 = (n: number) => Math.round(n * 1000) / 1000;

export type MeltGoldTo = "factory-karat" | "factory-24k" | "stock-karat";

/** A loose-diamond line coming back out of the piece. */
export interface MeltStone { issuanceId: string; quality: string; ct: number; pcs?: number }

export interface MeltPlan {
  /** Why it cannot be melted (shown as is); undefined when it can. */
  blocked?: string;
  /** A caution worth reading first, not a reason to stop. */
  warning?: string;
  net: number;               // gold net weight of the piece, grams
  karat: string;             // "14K"
  purity: number;            // ‰ actually measured, or the karat's
  fine: number;              // its pure (24KT) gold, grams
  factoryId?: string;        // the factory that made it
  labourInr: number;         // labour billed for the job — stays owed
  stones: MeltStone[];       // loose stones to put back in stock
  packetIds: string[];       // certified packets to put back in stock
  packetCt: number;
  otherMetal?: string;       // a second metal (platinum…) this does not handle
}

/** The record of the job: the gold "finishing" issue Final Approval writes — or,
 *  on older orders, the gold issue the finished piece was received against. */
function finishRecord(db: DB, o: Order): MaterialIssuance | undefined {
  const gold = (db.materialIssuances ?? []).filter(i => i.orderId === o.id && i.material === "gold" && i.finishedNetWeight != null);
  return gold.find(i => i.source === "factoryPool") ?? gold[0];
}

/** What melting this order's piece would give back — and whether it may be melted. */
export function meltPlan(db: DB, o: Order): MeltPlan {
  const fin = finishRecord(db, o);
  const net = r3(o.actualNetWeight ?? fin?.finishedNetWeight ?? 0);
  const karat = o.productKarats || fin?.finishedKarat || "18K";
  const purity = fin?.finishedPurity ?? Math.round(toPureGold(1000, karat));
  const fine = fin?.finishedPurity != null ? pureFromPurity(net, fin.finishedPurity) : toPureGold(net, karat);
  const labourInr = (db.materialIssuances ?? []).filter(i => i.orderId === o.id).reduce((s, i) => s + (i.makingCharges?.amountInr || 0), 0);
  const stones: MeltStone[] = [];
  let packetIds: string[] = [];
  for (const i of (db.materialIssuances ?? []).filter(x => x.orderId === o.id && x.material === "diamond")) {
    if (i.diamondKind === "certified") continue;
    const ct = r3(issuanceUsed(i));
    if (ct <= 0) continue;
    const pcs = i.piecesIssued != null ? Math.max(0, i.piecesIssued - (i.finishReturnedPcs ?? 0)) : undefined;
    stones.push({ issuanceId: i.id, quality: i.purityOrQuality, ct, pcs });
  }
  const packets = (db.diamondPackets ?? []).filter(p => p.orderId === o.id && p.status === "used");
  packetIds = packets.map(p => p.id);
  const packetCt = r3(packets.reduce((s, p) => s + (p.carat || 0), 0));
  const plan: MeltPlan = {
    net, karat, purity, fine, factoryId: fin?.factoryId ?? o.assignedFactoryId, labourInr: Math.round(labourInr),
    stones, packetIds, packetCt, otherMetal: o.otherMetal && (o.otherMetalWeight ?? 0) > 0 ? `${o.otherMetalWeight}g ${o.otherMetal}` : undefined,
  };
  const inv = findInvoiceForOrder(db.invoices ?? [], o.id);
  if (o.melted) plan.blocked = "This piece has already been melted.";
  else if (isDiamondOnlyOrder(o)) plan.blocked = "A diamond-only order has no piece to melt.";
  else if (o.materialSourcing === "readyStock") plan.blocked = "This was sold from Ready Stock — nothing was made for it.";
  else if (o.readyStockCreatedId) plan.blocked = "This piece is already in Ready Stock. Take it out of Ready Stock first.";
  else if (!fin && !(o.actualNetWeight || o.actualGrossWeight)) plan.blocked = "Record the factory's actual details (Final Approval) first — the melt gives back what the piece really holds.";
  else if (inv) plan.blocked = `This order is on invoice ${inv.number}. Take it off the invoice first.`;
  else if (net <= 0 && !stones.length && !packetIds.length) plan.blocked = "The piece has no gold or diamonds recorded.";
  if (!plan.blocked && ["Dispatched", "Delivered"].includes(o.status)) plan.warning = "This piece was sent out — make sure it has come back before melting it.";
  return plan;
}

export interface MeltChoice {
  goldTo: MeltGoldTo;
  /** The factory the metal goes to (factory options). */
  factoryId?: string;
  /** Grams that actually came back (after any melting loss). */
  goldGrams: number;
  /** Carats back per loose line (issuanceId → ct). Unlisted = all of it. */
  stoneCt?: Record<string, number>;
  reason?: string;
}

/** The metal as it is recorded: its purity label and grams. */
export function meltGoldLine(plan: MeltPlan, c: MeltChoice): { purity: string; grams: number } {
  return { purity: c.goldTo === "factory-24k" ? "24K" : plan.karat, grams: r3(Math.max(0, c.goldGrams)) };
}

/** The loose stones as they go back to stock, after any the user marked lost. */
export function meltStones(plan: MeltPlan, c: MeltChoice): MeltStone[] {
  return plan.stones
    .map(s => ({ ...s, ct: r3(Math.min(s.ct, Math.max(0, c.stoneCt?.[s.issuanceId] ?? s.ct))) }))
    .filter(s => s.ct > 0);
}

/**
 * The records — call inside updateDb(), after the stock moves have been made
 * (see the order screen). Writes the gold delivery to the factory, frees the
 * packets, closes the order and moves its advance to the client's credit.
 */
export function applyMelt(d: DB, orderId: string, plan: MeltPlan, c: MeltChoice, by: { id: string; name: string }, at: string): OrderMelt | null {
  const o = d.orders.find(x => x.id === orderId);
  if (!o || o.melted) return null;
  const gold = meltGoldLine(plan, c);
  let goldRec: OrderMelt["gold"];
  if (gold.grams > 0 && c.goldTo !== "stock-karat" && c.factoryId) {
    const mi: MaterialIssuance = {
      id: uid("mi_"), factoryId: c.factoryId, material: "gold", purityOrQuality: gold.purity,
      quantityIssued: gold.grams, source: "melt", meltOf: o.id, issuedAt: at, issuedBy: by.id, status: "open",
      finishedPieces: [], makingCharges: { amountInr: 0, payments: [] },
      notes: `Melted ${o.orderNumber}${c.reason ? ` — ${c.reason}` : ""}`,
    };
    if (!d.materialIssuances) d.materialIssuances = [];
    d.materialIssuances.unshift(mi);
    goldRec = { to: "factory", factoryId: c.factoryId, grams: gold.grams, purity: gold.purity, issuanceId: mi.id };
  } else if (gold.grams > 0 && c.goldTo === "stock-karat") {
    goldRec = { to: "stock", grams: gold.grams, purity: gold.purity };
  }
  for (const p of d.diamondPackets ?? []) {
    if (plan.packetIds.includes(p.id)) { p.status = "in_stock"; p.orderId = undefined; }
  }
  // The advance the client paid is theirs — on their credit, as a cancel does.
  const paid = (o.advances || []).reduce((s, a) => s + a.amount, 0);
  if (paid > 0) {
    const cl = d.clients.find(x => x.id === o.clientId);
    if (cl) cl.creditBalance = Math.round(((cl.creditBalance || 0) + paid) * 100) / 100;
    o.advances = [];
  }
  const rec: OrderMelt = {
    at, by: by.id, byName: by.name, reason: c.reason?.trim() || undefined,
    gold: goldRec, diamonds: meltStones(plan, c).map(s => ({ quality: s.quality, ct: s.ct })),
    packetIds: plan.packetIds, labourInr: plan.labourInr, advanceToCredit: paid > 0 ? paid : undefined,
  };
  o.melted = rec;
  o.status = "Rejected";
  if (!o.manufacturingLog) o.manufacturingLog = [];
  o.manufacturingLog.push({
    id: uid("mlog_"), type: "material_returned", at, employeeId: by.id, factoryId: goldRec?.factoryId, material: "gold", amountMaterial: gold.grams,
    remarks: `Piece melted${c.reason ? ` (${c.reason})` : ""} — ${gold.grams}g ${gold.purity} ${goldRec?.to === "factory" ? "to the factory" : goldRec?.to === "stock" ? "to stock" : "not kept"}; ${rec.diamonds.reduce((s, x) => s + x.ct, 0).toFixed(3)} ct loose + ${plan.packetIds.length} packet(s) back in stock; labour ₹${plan.labourInr.toLocaleString("en-IN")} stays owed`,
  });
  return rec;
}
