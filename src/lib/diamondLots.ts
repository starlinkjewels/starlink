// Loose diamonds in stock, by LOT: shape + size + colour + clarity — how a
// diamond office keeps its parcels ("Round · +6.5-7 · G-H · VS"). Counted in
// carats and in pieces.
//
// A lot is stored as the stock bucket itself (StockMovement.purityOrQuality),
// so every place that already counts, values, issues or returns stock by
// bucket works per lot unchanged: balances, the average cost per carat, the
// floor check, the movement history. A lot with only a shape is exactly the
// bucket stock has always had ("Round") — older stock reads as a lot whose
// size, colour and clarity were not recorded. Nothing old is rewritten.
//
// The parts are also kept separately on the movement (`lot`) so the Stock page
// can filter by them; an older movement's parts are read back from its label.
import type { StockMovement } from "./db";

export interface LotSpec { shape: string; size?: string; color?: string; clarity?: string }

export const LOT_SEP = " · ";

/** "Round · +6.5-7 · G-H · VS" — just "Round" when nothing else is known. */
export function lotKey(s: Partial<LotSpec>): string {
  return [s.shape?.trim() || "Round", s.size?.trim(), s.color?.trim(), s.clarity?.trim()].filter(Boolean).join(LOT_SEP);
}

/** The shape alone — the first part of a lot. */
export function lotShape(key: string): string {
  return String(key).split(LOT_SEP)[0];
}

const SIZE_RE = /^(\+|-)|mm$|\bct\b|^\d+\/\d+|pointer/i;
const COLOR_RE = /^[D-Z](\s*-\s*[D-Z])?\+?$|brown|white|yellow|fancy|\b(TTLB|TLB|LB)\b/i;

/** A lot's parts, read from its movement when kept there, else from its label. */
export function lotParts(key: string, kept?: Partial<LotSpec>): LotSpec {
  if (kept?.shape) return { shape: kept.shape, size: kept.size || undefined, color: kept.color || undefined, clarity: kept.clarity || undefined };
  const [shape, ...rest] = String(key).split(LOT_SEP);
  const out: LotSpec = { shape };
  for (const part of rest) {
    if (!out.size && SIZE_RE.test(part)) out.size = part;
    else if (!out.color && COLOR_RE.test(part)) out.color = part;
    else if (!out.clarity) out.clarity = part;
  }
  return out;
}

/** The lot as people read it: "Round · +6.5-7 · G-H · VS", or "Round · size not recorded". */
export function lotLabel(key: string): string {
  return key.includes(LOT_SEP) ? key : `${key}${LOT_SEP}size not recorded`;
}

/** Stones in each lot: carats and pieces, from the movements (one company, or "all"). */
export interface LotBalance { key: string; spec: LotSpec; ct: number; pcs: number | null }
export function lotBalances(movements: StockMovement[], companyId: string | "all" = "all"): LotBalance[] {
  const by = new Map<string, { ct: number; pcs: number; pcsKnown: boolean; kept?: Partial<LotSpec> }>();
  for (const m of movements) {
    if (m.material !== "diamond" || m.purityOrQuality === "Certified") continue;
    if (companyId !== "all" ? (m.companyId || "main") !== companyId : m.refType === "transfer") continue;
    const sign = m.type === "purchase_in" ? 1 : m.type === "adjustment" ? Math.sign(m.quantity || 1) : -1;
    const row = by.get(m.purityOrQuality) ?? { ct: 0, pcs: 0, pcsKnown: false };
    row.ct += sign * Math.abs(m.quantity);
    if (m.pieces != null) { row.pcs += sign * Math.abs(m.pieces); row.pcsKnown = true; }
    if (m.lot?.shape && !row.kept) row.kept = m.lot;
    by.set(m.purityOrQuality, row);
  }
  return [...by.entries()]
    .map(([key, r]) => ({ key, spec: lotParts(key, r.kept), ct: Math.round(r.ct * 1000) / 1000, pcs: r.pcsKnown ? Math.round(r.pcs) : null }))
    .filter(l => Math.abs(l.ct) > 0.0005);
}

/* ── The usual words, as Settings → Dropdown lists starts them ─────────── */

/** Sieve sizes, as melee is sorted in Surat, then millimetre sizes. */
export const DEFAULT_DIAMOND_SIZES = [
  "+0000-000", "+000-00", "+00-0", "+0-1", "+1-1.5", "+1.5-2", "+2-2.5", "+2.5-3", "+3-3.5", "+3.5-4", "+4-4.5",
  "+4.5-5", "+5-5.5", "+5.5-6", "+6-6.5", "+6.5-7", "+7-7.5", "+7.5-8", "+8-8.5", "+8.5-9", "+9-9.5", "+9.5-10",
  "+10-10.5", "+10.5-11", "+11-11.5", "+11.5-12", "+12-12.5", "+12.5-13", "+13-13.5", "+13.5-14", "+14-14.5",
  "0.8 mm", "0.9 mm", "1.0 mm", "1.1 mm", "1.15 mm", "1.2 mm", "1.25 mm", "1.3 mm", "1.35 mm", "1.4 mm", "1.45 mm",
  "1.5 mm", "1.6 mm", "1.7 mm", "1.8 mm", "1.9 mm", "2.0 mm", "2.1 mm", "2.2 mm", "2.3 mm", "2.4 mm", "2.5 mm",
  "2.6 mm", "2.7 mm", "2.8 mm", "2.9 mm", "3.0 mm", "3.1 mm", "3.2 mm", "3.3 mm",
];
export const DEFAULT_DIAMOND_COLORS = [
  "D", "E", "F", "G", "H", "I", "J", "K", "L", "M",
  "D-E", "E-F", "F-G", "G-H", "H-I", "I-J", "J-K", "K-L",
  "Top Light Brown (TLB)", "Light Brown (LB)", "Fancy Yellow",
];
export const DEFAULT_DIAMOND_CLARITIES = [
  "FL", "IF", "VVS1", "VVS2", "VS1", "VS2", "SI1", "SI2", "I1", "I2", "I3",
  "VVS", "VS", "SI", "VVS-VS", "VS-SI", "SI-I",
];
