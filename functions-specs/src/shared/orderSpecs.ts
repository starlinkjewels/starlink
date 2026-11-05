// GENERATED from src/lib/pure/orderSpecs.ts by functions-specs/scripts/sync-shared.cjs - do not edit here.
// An order's piece as a product (Design Studio → By Order): what the catalogue's
// product page reads off a design sheet — grams by karat and the stone rows —
// read off the order instead: the metal actually in the finished piece (Final
// Approval), else the order's estimate; the diamonds actually set (issued less
// returned, certified stones used), else the order's own diamond weight.
//
// Only what the piece IS. Nothing of what it cost, its labour, its client or the
// margin: the result goes on product pages, on links anyone can open, and to the
// server that prices them (functions-specs) — one file for all of them.
//
// Plain functions, no imports beyond types.

import type { Specs, StoneRow } from "./specParse";
import type { MetalKey } from "./pricing";

/** The fields of an order this reads — never its money, its client or its people. */
export interface OrderLike {
  id: string;
  orderNumber?: string;
  designNumber?: string;
  jewelleryType?: string;
  metal?: string;
  productKarats?: string;
  productSize?: string;
  diamondShape?: string;
  diamondWeight?: number;
  actualDiamondWeight?: number;
  actualDiamondPcs?: number;
  noDiamond?: boolean;
  estimatedNetWeight?: number;
  metalWeight?: number;
  actualNetWeight?: number;
  otherMetal?: string;
  otherMetalWeight?: number;
  otherMetals?: { metal: string; weight?: number }[];
}
/** The fields of a material issue this reads. */
export interface IssueLike {
  orderId?: string;
  material: string;
  quantityIssued: number;
  purityOrQuality?: string;
  diamondKind?: "loose" | "certified";
  diamondPacketIds?: string[];
  finishDisposition?: "used" | "returned";
  finishReturnedCt?: number;
  piecesIssued?: number;
  finishReturnedPcs?: number;
  finishedNetWeight?: number;
  finishedKarat?: string;
  source?: string;
  rework?: unknown;
  diamondSpec?: { mm?: string; size?: string };
}
export interface PacketLike { id: string; carat?: number; shape?: string }

/** The order's details as a design's: `checkedBy` marks them read by a person (never re-read), as a checked sheet. */
export type OrderSpecs = Specs & { checkedBy: string };

const r3 = (n: number) => Math.round(n * 1000) / 1000;
const KARATS: Record<string, MetalKey> = { 9: "9K", 10: "10K", 14: "14K", 18: "18K", 22: "22K" };

/** A metal's name as the product page's key: "14K" gold, Platinum, Silver — titanium and the like have none. */
export function metalKeyOf(metal: string | undefined, karat: string | undefined): MetalKey | undefined {
  const m = String(metal ?? "").toLowerCase();
  if (/platin/.test(m)) return "PLT";
  if (/silver|sterling|\b925\b/.test(m) && !/gold/.test(m)) return "SILVER";
  if (/gold/.test(m) || (!m && karat)) return KARATS[String(parseInt(String(karat ?? ""), 10))];
  return undefined;
}

/** "US 7" / "7 US" / "7" / "53" → as the sheet reader writes a ring size ("7 US", "53"). */
function ringSizeOf(size: string | undefined): string | undefined {
  const t = String(size ?? "").trim();
  if (!t) return undefined;
  const a = /^(US|UK|EU|IN)\s*(\d+(?:\.\d+)?)$/i.exec(t);
  if (a) return `${a[2]} ${a[1].toUpperCase()}`;
  return /^\d+(?:\.\d+)?(\s*(US|UK|EU|IN))?$/i.test(t) ? t.toUpperCase() : undefined;
}

/** A loose lot's label ("Round · CVD · +6.5-7 · 1.3 mm · G-H · VS"): its shape, sieve and mm. */
function lotOf(label: string | undefined): { shape: string; sieve?: string; mm?: string } {
  const [shape, ...rest] = String(label ?? "").split(" · ").map(s => s.trim());
  return {
    shape: shape || "Round",
    mm: rest.find(p => /^\d+(?:\.\d+)?\s*mm$/i.test(p)),
    sieve: rest.find(p => /^[+-]\d/.test(p)),
  };
}

/** The issue that carries the finished piece (Final Approval's record — lib/rework.ts finishRecordOf), not a repair's;
 *  an older piece received on its gold issue: that one. */
function finishOf(issues: IssueLike[]): IssueLike | undefined {
  const gold = issues.filter(i => !i.rework && i.material === "gold" && i.finishedNetWeight != null);
  return gold.find(i => i.source === "factoryPool") ?? gold[gold.length - 1];
}

/**
 * The piece's details: its main metal's grams (the karat it was made in; platinum;
 * silver), its ring size, and its stones — the way a design sheet gives them.
 * A second metal beside the main one (a gold part on a platinum ring) is not a
 * metal the piece can be chosen in, so it is not offered.
 */
export function orderSpecs(order: OrderLike, issues: IssueLike[], packets: PacketLike[]): OrderSpecs {
  const own = issues.filter(i => i.orderId === order.id && !i.rework);
  const finish = finishOf(own);
  const metal: Record<string, number> = {};
  const main = String(order.metal ?? "");
  if (/gold/i.test(main)) {
    const key = metalKeyOf(main, finish?.finishedKarat || order.productKarats);
    const g = finish?.finishedNetWeight ?? order.actualNetWeight ?? order.estimatedNetWeight ?? order.metalWeight ?? 0;
    if (key && g > 0) metal[key] = r3(g);
  } else {
    const key = metalKeyOf(main, undefined);
    // A platinum or silver piece: its own metal's weight, as entered for it on the order (or at Final Approval).
    const list = [...(order.otherMetals ?? []), ...(order.otherMetal ? [{ metal: order.otherMetal, weight: order.otherMetalWeight }] : [])];
    const g = list.find(m => key && metalKeyOf(m.metal, undefined) === key && (m.weight ?? 0) > 0)?.weight
      ?? (order.estimatedNetWeight || order.metalWeight || 0);
    if (key && g > 0) metal[key] = r3(g);
  }

  // The stones actually in it: loose stones issued less those returned, certified stones used.
  const rows: StoneRow[] = [];
  const add = (r: StoneRow) => {
    const same = rows.find(x => x.shape === r.shape && x.sieve === r.sieve && x.size === r.size && (r.pcs === 0 || x.pcs === 0 ? false : Math.abs(x.perStone - r.perStone) < 0.0005));
    if (same) { same.pcs += r.pcs; same.total = r3(same.total + r.total); }
    else rows.push(r);
  };
  for (const i of own.filter(x => x.material === "diamond")) {
    if (i.diamondKind === "certified") {
      if (i.finishDisposition === "returned") continue;
      for (const id of i.diamondPacketIds ?? []) {
        const p = packets.find(x => x.id === id);
        if (p && (p.carat ?? 0) > 0) add({ shape: p.shape || "Round", pcs: 1, perStone: r3(p.carat!), total: r3(p.carat!) });
      }
      continue;
    }
    const ct = r3((i.quantityIssued || 0) - (i.finishReturnedCt || 0));
    if (!(ct > 0)) continue;
    const pcs = Math.max(0, Math.round((i.piecesIssued || 0) - (i.finishReturnedPcs || 0)));
    const lot = lotOf(i.purityOrQuality);
    add({ shape: lot.shape, ...(lot.sieve || i.diamondSpec?.size ? { sieve: lot.sieve || i.diamondSpec?.size } : {}), ...(lot.mm || i.diamondSpec?.mm ? { size: lot.mm || i.diamondSpec?.mm } : {}),
      pcs, perStone: pcs > 0 ? r3(ct / pcs) : 0, total: ct });
  }
  // One lot issued without its count (older issues): the factory bill's count of the piece's stones (Final Approval).
  if (rows.length === 1 && !(rows[0].pcs > 0) && (order.actualDiamondPcs ?? 0) > 0) {
    rows[0].pcs = order.actualDiamondPcs!;
    rows[0].perStone = r3(rows[0].total / rows[0].pcs);
  }
  // None issued (the client's own stones, say): the order's own diamond weight and count.
  if (!rows.length && !order.noDiamond) {
    const ct = order.actualDiamondWeight || order.diamondWeight || 0;
    const pcs = order.actualDiamondPcs || 0;
    if (ct > 0) rows.push({ shape: order.diamondShape || "Round", pcs, perStone: pcs > 0 ? r3(ct / pcs) : 0, total: r3(ct) });
  }
  const stoneTotals = rows.length ? { pcs: rows.reduce((t, r) => t + r.pcs, 0), ct: r3(rows.reduce((t, r) => t + r.total, 0)) } : undefined;
  const ring = /ring|band/i.test(order.jewelleryType ?? "") ? ringSizeOf(order.productSize) : undefined;
  return {
    v: 0, status: "ok", designNo: order.designNumber || order.orderNumber, stones: rows, ...(stoneTotals ? { stoneTotals } : {}),
    metal, dimsMm: [], ...(ring ? { ringSize: ring } : {}), reasons: [], checkedBy: "order",
  };
}

/** A product's details in a line, as a catalogue card says them: "14K gold · 3.6 g · 1.58 ct". */
export function specsLine(s: Pick<Specs, "metal" | "stoneTotals">, label: Record<MetalKey, string>): string {
  const [k, g] = Object.entries(s.metal ?? {}).find(([, v]) => v > 0) ?? [];
  return [k ? label[k as MetalKey] : null, g ? `${g} g` : null, s.stoneTotals?.ct ? `${s.stoneTotals.ct} ct` : null].filter(Boolean).join(" · ");
}
