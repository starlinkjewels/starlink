// Low stock — the reorder point. An admin sets, on a line of stock (a gold purity, a loose
// lot, a material's grade), how low it may go before more is ordered; below it, the line is
// "low" on the Stock screens and Order more opens a purchase order filled in for it
// (components/PurchaseOrders). The balance is the movement ledger's, as every stock screen's.
// A level belongs to one company's stock, or (no company) to every company's together.
import type { DB, MemoLine, ReorderLevel } from "./db";
import { updateDb } from "./db";
import { deriveStockBalances } from "./manufacturing";
import { lotBalances, lotLabel, lotParts } from "./diamondLots";
import { materialDef, materialName, materialUnit, type MaterialUnit } from "./materials";

const r3 = (n: number) => Math.round(n * 1000) / 1000;
const coKey = (c?: string) => (!c || c === "all" ? "" : c);

/** The level set on a line for the company being looked at ("all" = every company together). */
export function reorderLevelOf(db: Pick<DB, "settings">, material: string, bucket: string, companyId?: string): ReorderLevel | undefined {
  return (db.settings.reorderLevels ?? []).find(l => l.material === material && l.bucket === bucket && coKey(l.companyId) === coKey(companyId));
}
/** Set (min > 0) or clear (0 / blank) a line's level. */
export function setReorderLevel(material: string, bucket: string, companyId: string | undefined, min: number | null): void {
  if (min != null && (!Number.isFinite(min) || min < 0)) throw new Error("The level: 0 or more");
  updateDb(d => {
    const rest = (d.settings.reorderLevels ?? []).filter(l => !(l.material === material && l.bucket === bucket && coKey(l.companyId) === coKey(companyId)));
    d.settings.reorderLevels = min && min > 0
      ? [...rest, { material, bucket, min: r3(min), ...(coKey(companyId) ? { companyId } : {}) }]
      : rest;
    if (!d.settings.reorderLevels.length) delete d.settings.reorderLevels;
  });
}

/** What a line of stock holds now — the ledger, one company or all together. */
export function lineBalance(db: Pick<DB, "stockMovements" | "settings">, material: string, bucket: string, companyId?: string): number {
  const co = coKey(companyId) || "all";
  // Loose diamonds by lot (their keys gather a lot's parts); gold and every other material by its own key.
  if (material === "diamond") return r3(lotBalances(db.stockMovements ?? [], co).find(l => l.key === bucket)?.ct ?? 0);
  return r3(deriveStockBalances(db.stockMovements ?? [], material, co === "all" ? undefined : co)[bucket] ?? 0);
}

export interface LowLine { level: ReorderLevel; onHand: number; short: number; name: string; unit: MaterialUnit }
/** Lines below their level, for the company being looked at — the furthest below first. */
export function lowStock(db: Pick<DB, "stockMovements" | "settings">, companyId?: string): LowLine[] {
  return (db.settings.reorderLevels ?? [])
    .filter(l => coKey(l.companyId) === coKey(companyId))
    .map(level => {
      const onHand = lineBalance(db, level.material, level.bucket, companyId);
      return { level, onHand, short: r3(level.min - onHand), name: lineName(db, level.material, level.bucket), unit: materialUnit(db.settings, level.material) };
    })
    .filter(x => x.onHand < x.level.min - 1e-9)
    .sort((a, b) => b.short / b.level.min - a.short / a.level.min);
}

export function lineName(db: Pick<DB, "settings">, material: string, bucket: string): string {
  if (material === "gold") return `${bucket} gold`;
  if (material === "diamond") return lotLabel(bucket);
  const def = materialDef(db.settings, material);
  return `${materialName(db.settings, material)} ${def?.kind === "stone" ? lotLabel(bucket) : bucket}`.trim();
}

/** A low line as a purchase-order line (no rate yet) — Order more fills the PO with it. */
export function reorderPoLine(db: Pick<DB, "settings">, material: string, bucket: string, qty: number): MemoLine {
  const unit = materialUnit(db.settings, material);
  const base = { id: "", qty: r3(qty), unit, amount: 0, bucket, label: lineName(db, material, bucket) };
  if (material === "gold") return { ...base, kind: "gold", material: "gold", spec: { purity: bucket } };
  if (material === "diamond") return { ...base, kind: "diamond", material: "diamond", spec: lotParts(bucket) };
  const gem = materialDef(db.settings, material)?.kind === "stone";
  return { ...base, kind: "material", material, spec: { materialId: material, ...(gem ? lotParts(bucket) : { grade: bucket }) } };
}
