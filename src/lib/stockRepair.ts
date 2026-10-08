import { loadDb, updateDb, type DB, type StockMovement } from "@/lib/db";

/** A "used directly on order" row whose "bought" row is gone. */
export interface OrphanDirectUse {
  id: string;
  material: "gold" | "diamond";
  purityOrQuality: string;
  quantity: number;
  orderNumber: string;
  createdAt: string;
}

/**
 * Material bought for one order and sent straight to the factory is written as
 * a PAIR: "bought" in, "used directly on order" out, same quantity, netting to
 * zero against the shared pool.
 *
 * Removing or correcting such a purchase has to move both. It found the second
 * leg by matching the exact instant it was written — but that leg was stamped
 * with its own `new Date()`, milliseconds after the purchase, so the match
 * never succeeded. The "bought" leg was removed by purchase id as intended and
 * the "used" leg was left behind, with nothing to cancel it: the shape's
 * balance drops by the whole quantity and stays there. Order SLJ-2026-1032
 * read −10.95ct of Princess for exactly this reason.
 *
 * This finds those widowed rows — a direct-use row with no surviving purchase
 * of the same material, quantity and moment behind it — so they can be cleared.
 * The pairing itself is fixed at source; this is only for what was already
 * written.
 */
export function orphanDirectUses(db: DB): OrphanDirectUse[] {
  const purchases = db.purchases ?? [];
  const out: OrphanDirectUse[] = [];

  for (const m of db.stockMovements ?? []) {
    if (m.type !== "order_direct_use") continue;
    // Rework draws material from stock for real and is correctly one-sided.
    // Only the leg written beside a purchase has a partner to lose.
    if (m.refType !== "order" || m.note) continue;

    const at = +new Date(m.createdAt);
    const partner = purchases.some(p =>
      p.orderId === m.refId
      && p.material === m.material
      && Math.abs((p.material === "gold" ? (p.gold?.weightGrams ?? 0) : (p.diamond?.carat ?? 0)) - m.quantity) < 0.0001
      && Math.abs(+new Date(p.createdAt) - at) < 2000);
    if (partner) continue;

    // Belt and braces: a surviving "bought" row for the same order, material,
    // quantity and instant also counts as a partner, even if the purchase
    // document itself has gone.
    const boughtLeg = (db.stockMovements ?? []).some(x =>
      x.type === "purchase_in"
      && x.material === m.material
      && Math.abs(x.quantity - m.quantity) < 0.0001
      && Math.abs(+new Date(x.createdAt) - at) < 2000);
    if (boughtLeg) continue;

    out.push({
      id: m.id,
      material: m.material,
      purityOrQuality: m.purityOrQuality,
      quantity: m.quantity,
      orderNumber: db.orders.find(o => o.id === m.refId)?.orderNumber ?? "—",
      createdAt: m.createdAt,
    });
  }
  return out.sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));
}

/** What each shape or purity is short by, because of those rows alone. */
export function orphanImpact(rows: OrphanDirectUse[]): { key: string; qty: number; unit: "g" | "ct" }[] {
  const by = new Map<string, { key: string; qty: number; unit: "g" | "ct" }>();
  for (const r of rows) {
    const key = `${r.material}:${r.purityOrQuality}`;
    const cur = by.get(key) ?? { key: r.purityOrQuality, qty: 0, unit: r.material === "gold" ? "g" : "ct" };
    cur.qty = Math.round((cur.qty + r.quantity) * 1000) / 1000;
    by.set(key, cur);
  }
  return [...by.values()];
}

/**
 * Drop the widowed rows. Only the movement history changes: these rows record
 * material leaving a pool it was never added to, so removing them restores the
 * balance rather than altering it. No purchase, issuance, order or payment is
 * touched.
 */
export function repairOrphanDirectUses(): number {
  const rows = orphanDirectUses(loadDb());
  if (!rows.length) return 0;
  const ids = new Set(rows.map(r => r.id));
  updateDb(d => {
    d.stockMovements = (d.stockMovements ?? []).filter((m: StockMovement) => !ids.has(m.id));
  });
  return rows.length;
}
