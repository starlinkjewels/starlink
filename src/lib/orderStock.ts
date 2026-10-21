// Stock taken for an order — the one place that issues it, used by the order's
// own "From stock" panel and by New Order's production plan alike, so the two
// can never differ: the stock movement, the issuance, the certified stones,
// the order's manufacturing log.
//
// A piece's material goes to its factory. A loose-diamond order's stones are
// sold out of stock onto the order (no factory).
import { coField, companyById } from "./companies";
import { loadDb, uid, updateDb, isDiamondOnlyOrder, type DB, type MaterialIssuance, type Order } from "./db";
import { decreaseStockSelfHealing } from "./stock";
import { lotBalances, lotLabel, lotParts, type LotBalance } from "./diamondLots";
import { bagNoOf } from "./diamondBags";
import { deriveStockBalances, fmtMoneyInr } from "./manufacturing";
import { isOtherMaterial, materialName, materialUnit, type MaterialKey } from "./materials";
import { stockAverageRate } from "./orderCost";

/** One thing taken from stock for an order. */
export interface StockPick {
  id: string;
  material: MaterialKey;
  /** loose: a bag (key = lot key) · certified: chosen stones · bulk: gold by purity, another material by grade. */
  kind: "loose" | "certified" | "bulk";
  /** The lot key, the gold purity, or the material's grade. "" for certified. */
  key: string;
  /** Carats, grams or the material's unit. For certified: the stones' total. */
  qty: number;
  /** Loose stones: how many. */
  pcs?: number;
  /** Certified: the exact stones. */
  packetIds?: string[];
  /** Loose stones: the price per carat, when the person typed one (else the bag's average cost). */
  rateInr?: number;
  /** Loose stones: the amount typed for them all, instead of a price per carat. */
  amountInr?: number;
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const matWord = (db: Pick<DB, "settings">, k: string) => (k === "gold" || k === "diamond" ? k : materialName(db.settings, k));

/** How much of what a pick takes is in stock now (the company's own). */
export function pickAvailable(db: DB, p: Pick<StockPick, "material" | "kind" | "key" | "packetIds">, companyId: string): { qty: number; pcs?: number } {
  if (p.kind === "certified") {
    const ok = (db.diamondPackets ?? []).filter(x => p.packetIds?.includes(x.id) && x.status === "in_stock");
    return { qty: r2(ok.reduce((s, x) => s + x.carat, 0)), pcs: ok.length };
  }
  if (p.kind === "loose") {
    const lot = lotBalances(db.stockMovements ?? [], companyId).find(l => l.key === p.key);
    return { qty: lot?.ct ?? 0, pcs: lot?.pcs ?? undefined };
  }
  return { qty: deriveStockBalances(db.stockMovements ?? [], p.material, companyId)[p.key] ?? 0 };
}

/** What a pick costs us: the typed price, the stones' own cost, or the stock's average. Null when nothing prices it. */
export function pickCostInr(db: DB, p: StockPick, companyId: string): number | null {
  if (p.kind === "certified") {
    const stones = (db.diamondPackets ?? []).filter(x => p.packetIds?.includes(x.id));
    if (!stones.length || stones.some(x => !x.ratePerCaratInr)) return null;
    return r2(stones.reduce((s, x) => s + (x.ratePerCaratInr ?? 0) * x.carat, 0));
  }
  if (p.kind === "loose" && p.amountInr) return r2(p.amountInr);
  if (p.kind === "loose" && p.rateInr) return r2(p.rateInr * p.qty);
  const avg = stockAverageRate(db, p.material, p.key, new Date().toISOString(), companyId);
  return avg == null ? null : r2(avg * p.qty);
}

/** Why a set of picks can't be taken now; undefined when every one can. */
export function picksProblem(db: DB, picks: StockPick[], companyId: string): string | undefined {
  // The same bag picked twice counts once against what is there.
  const want = new Map<string, { qty: number; pcs: number; pick: StockPick }>();
  for (const p of picks) {
    // Certified stones are what is ticked — their carats are their own.
    if (p.kind === "certified") { if (!p.packetIds?.length) return "Choose the certified stones"; continue; }
    if (!(p.qty > 0)) return `${pickName(db, p)}: enter how much`;
    const k = `${p.material}|${p.kind}|${p.key}|${(p.packetIds ?? []).join(",")}`;
    const w = want.get(k) ?? { qty: 0, pcs: 0, pick: p };
    w.qty = r2(w.qty + p.qty); w.pcs += p.pcs ?? 0;
    want.set(k, w);
  }
  // Certified: each stone still in stock, and not ticked twice.
  const ticked = picks.flatMap(p => (p.kind === "certified" ? p.packetIds ?? [] : []));
  if (new Set(ticked).size !== ticked.length) return "The same certified stone is chosen twice";
  const gone = ticked.find(id => !(db.diamondPackets ?? []).some(x => x.id === id && x.status === "in_stock"));
  if (gone) return `Certified stone ${(db.diamondPackets ?? []).find(x => x.id === gone)?.stockNumber ?? ""} is no longer in stock`.trim();
  for (const { qty, pcs, pick } of want.values()) {
    const have = pickAvailable(db, pick, companyId);
    if (qty > have.qty + 1e-9) return `${pickName(db, pick)}: only ${have.qty}${unitOf(db, pick)} in stock`;
    if (pick.kind === "loose" && pcs > 0 && have.pcs != null && pcs > have.pcs) return `${pickName(db, pick)}: only ${have.pcs} pcs in the bag`;
  }
  return undefined;
}

export const unitOf = (db: Pick<DB, "settings">, p: Pick<StockPick, "material">) => materialUnit(db.settings, p.material);

/** "BAG-0007 · Round · 1.3 mm · G-H · VS", "18K gold", "2 certified stones", "950 Platinum". */
export function pickName(db: DB, p: StockPick): string {
  if (p.kind === "certified") return `${p.packetIds?.length ?? 0} certified stone${p.packetIds?.length === 1 ? "" : "s"}`;
  if (p.kind === "loose") return [bagNoOf(db, p.key), lotLabel(p.key)].filter(Boolean).join(" · ");
  return p.material === "gold" ? `${p.key} gold` : `${p.key === "—" ? "" : `${p.key} `}${materialName(db.settings, p.material)}`;
}

/**
 * Bags that suit a loose-diamond request, best first. Every given part of the
 * request (shape, mm, sieve, colour, clarity) that a bag matches scores; a bag
 * of another shape is left out when a shape was asked for. Only bags with stones in them.
 */
export function suggestLots(db: DB, want: { shape?: string; mm?: string; size?: string; color?: string; clarity?: string }, companyId: string):
  { lot: LotBalance; score: number; full: boolean; avg: number | null }[] {
  const norm = (s?: string) => (s ?? "").trim().toLowerCase();
  const asked = (["shape", "mm", "size", "color", "clarity"] as const).filter(k => norm(want[k]));
  const now = new Date().toISOString();
  return lotBalances(db.stockMovements ?? [], companyId)
    .filter(l => l.ct > 0)
    .map(l => {
      const spec = l.spec as unknown as Record<string, string | undefined>;
      const hits = asked.filter(k => norm(spec[k]) === norm(want[k]));
      return { lot: l, hits, score: hits.reduce((s, k) => s + (k === "shape" ? 4 : k === "mm" || k === "size" ? 3 : 2), 0) };
    })
    .filter(x => !asked.includes("shape") || x.hits.includes("shape"))
    .sort((a, b) => b.score - a.score || b.lot.ct - a.lot.ct)
    .map(x => ({ lot: x.lot, score: x.score, full: x.hits.length === asked.length, avg: stockAverageRate(db, "diamond", x.lot.key, now, companyId) }));
}

/**
 * Take one pick out of stock for an order: to its factory, or — a loose-
 * diamond order with no factory — sold onto the order. Writes the stock
 * movement, the issuance (and the certified stones' status), and the order's
 * log line, exactly as the order's own From stock panel always has.
 */
export async function issuePick(args: {
  order: Pick<Order, "id" | "orderNumber" | "metal">; factoryId: string; companyId: string; pick: StockPick;
  userId: string; chargeInr?: number; notes?: string;
}): Promise<void> {
  const { order, factoryId, companyId: workCo, pick, userId } = args;
  const db = loadDb();
  const soldStones = isDiamondOnlyOrder(order);
  if (!factoryId && !soldStones) throw new Error("Choose a factory");
  const factory = db.factories.find(f => f.id === factoryId);
  const chargeAmount = args.chargeInr ?? 0;
  const notes = args.notes?.trim() || undefined;
  const now = new Date().toISOString();
  const issuanceId = uid("mi_");

  // ── Certified stones: the exact ones, not a pooled carat ──
  if (pick.kind === "certified") {
    const packets = (db.diamondPackets ?? []).filter(p => pick.packetIds?.includes(p.id) && p.status === "in_stock");
    if (packets.length === 0) throw new Error("Select at least one certified packet");
    const totalCarat = r2(packets.reduce((s, p) => s + p.carat, 0));
    updateDb(d => {
      if (!d.materialIssuances) d.materialIssuances = [];
      d.materialIssuances.unshift({
        id: issuanceId, factoryId, orderId: order.id, material: "diamond", ...coField(workCo),
        purityOrQuality: "Certified", quantityIssued: totalCarat,
        source: "stock", diamondKind: "certified", diamondPacketIds: packets.map(p => p.id),
        issuedAt: now, issuedBy: userId, status: "open",
        finishedPieces: [{ id: uid("fp_"), quantityUsed: totalCarat, piecesCount: 1, recordedAt: now, recordedBy: userId }],
        makingCharges: { amountInr: chargeAmount, payments: [] },
        notes,
      });
      for (const p of d.diamondPackets) {
        if (pick.packetIds?.includes(p.id) && p.status === "in_stock") { p.status = "issued"; p.orderId = order.id; }
      }
      const o = d.orders.find(x => x.id === order.id);
      if (o) {
        if (!o.materialIssuanceIds) o.materialIssuanceIds = [];
        o.materialIssuanceIds.push(issuanceId);
        if (!o.manufacturingLog) o.manufacturingLog = [];
        o.manufacturingLog.push({
          id: uid("mlog_"), type: "material_issued", at: now, employeeId: userId, factoryId,
          material: "diamond", amountMaterial: totalCarat, amountInr: chargeAmount || undefined,
          remarks: `${packets.length} certified diamond${packets.length !== 1 ? "s" : ""} (${totalCarat}ct) ${factory || !soldStones ? `used at ${factory?.name || "factory"}` : "sold from stock"}${chargeAmount ? ` — making charge ${fmtMoneyInr(chargeAmount)}` : ""} — cert ${packets.map(p => p.certificateNumber).join(", ")}`,
        });
      }
    });
    return;
  }

  const qty = pick.qty;
  const material = pick.material;
  if (isOtherMaterial(material) && !(db.settings.materials ?? []).some(m => m.id === material)) throw new Error("Choose the material");
  if (!qty || qty <= 0) throw new Error(`Enter the ${matWord(db, material)} ${isOtherMaterial(material) ? "quantity" : "weight/carat"} used`);
  const looseDia = material === "diamond" && pick.kind === "loose";
  if (looseDia && !pick.key.trim()) throw new Error("Choose the lot the stones come from");
  const purityOrQuality = pick.key.trim() || (isOtherMaterial(material) ? "—" : "unspecified");
  const issuePcs = looseDia && (pick.pcs ?? 0) > 0 ? Math.round(pick.pcs!) : undefined;
  // Loose stones: their price when given (the amount typed, or ct × price/ct) — the bag's details are its own (its lot).
  const diaRate = looseDia ? pick.rateInr ?? 0 : 0;
  const diaAmount = looseDia && pick.amountInr != null ? pick.amountInr : diaRate > 0 ? r2(diaRate * qty) : 0;
  const diamondSpec = looseDia && (diaRate > 0 || diaAmount > 0) ? {
    ratePerCaratInr: diaRate > 0 ? diaRate : diaAmount > 0 && qty > 0 ? r2(diaAmount / qty) : undefined,
    amountInr: diaAmount > 0 ? diaAmount : undefined,
  } : undefined;

  await decreaseStockSelfHealing({
    material, companyId: workCo, purityOrQuality, quantity: qty,
    type: "issuance_out", refType: "materialIssuance", refId: issuanceId, createdBy: userId,
    note: soldStones && !factory ? `Sold on order ${order.orderNumber}` : `Used by ${factory?.name || "factory"} for order ${order.orderNumber}`,
    ...(looseDia ? { lot: lotParts(purityOrQuality), pieces: issuePcs } : {}),
  }, db.stockMovements);
  const unit = materialUnit(db.settings, material);
  updateDb(d => {
    if (!d.materialIssuances) d.materialIssuances = [];
    const issuance: MaterialIssuance = {
      id: issuanceId, factoryId, orderId: order.id, material, ...coField(workCo),
      purityOrQuality, quantityIssued: qty,
      ...(issuePcs ? { piecesIssued: issuePcs } : {}),
      source: "stock",
      issuedAt: now, issuedBy: userId, status: "open",
      finishedPieces: [{ id: uid("fp_"), quantityUsed: qty, piecesCount: 1, recordedAt: now, recordedBy: userId }],
      makingCharges: { amountInr: chargeAmount, payments: [] },
      notes,
      ...(diamondSpec ? { diamondSpec } : {}),
    };
    d.materialIssuances.unshift(issuance);
    const o = d.orders.find(x => x.id === order.id);
    if (o) {
      if (!o.materialIssuanceIds) o.materialIssuanceIds = [];
      o.materialIssuanceIds.push(issuanceId);
      if (!o.manufacturingLog) o.manufacturingLog = [];
      o.manufacturingLog.push({
        id: uid("mlog_"), type: "material_issued", at: now, employeeId: userId, factoryId,
        material, amountMaterial: qty, amountInr: chargeAmount || undefined,
        remarks: `${qty}${unit} ${looseDia && bagNoOf(db, purityOrQuality) ? `${bagNoOf(db, purityOrQuality)} · ` : ""}${purityOrQuality} ${matWord(db, material)}${diamondSpec?.amountInr ? ` (${fmtMoneyInr(diamondSpec.amountInr)})` : ""} ${factory || !soldStones ? `used at ${factory?.name || "factory"}` : "sold from stock"}${chargeAmount ? ` — making charge ${fmtMoneyInr(chargeAmount)}` : ""}`,
      });
    }
  });
}

/** "In stock (Shree Suktam Diamond): 4.2 ct" — the company named only when there are several. */
export function stockNote(db: DB, companyId: string, text: string, multi: boolean): string {
  return multi ? `In stock (${companyById(db.settings, companyId).name}): ${text}` : `In stock: ${text}`;
}
