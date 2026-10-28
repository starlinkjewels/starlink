// Loose diamonds in stock, by LOT: shape + sieve + mm + colour + clarity — how
// a diamond office keeps its parcels ("Round · +6.5-7 · 1.3 mm · G-H · VS").
// Counted in carats and in pieces. Each lot is one bag (lib/diamondBags.ts).
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

/** `size` is the sieve size ("+6.5-7"); `mm` the millimetre size ("1.3 mm"). Older
 *  lots kept a millimetre size in `size` — read through `lotParts`, it is the mm. */
export interface LotSpec { shape: string; size?: string; mm?: string; color?: string; clarity?: string;
  /** Natural, CVD, HPHT… — a lot holds one type of stone. Older lots have none. */
  type?: string }

export const LOT_SEP = " · ";

/** A millimetre size? ("1.3 mm", "0.85mm") */
export function isMm(v?: string | null): boolean {
  return !!v && /^\s*\d+(?:\.\d+)?\s*mm\s*$/i.test(v);
}

/** "1.30" / "1.3mm" / "1.30 mm" → "1.3 mm" — the way the lists write it, so one size is one lot. */
export function normalizeMm(v?: string | null): string | undefined {
  const t = (v ?? "").trim();
  if (!t) return undefined;
  const m = t.match(/^(\d+(?:\.\d+)?)\s*(?:mm)?$/i);
  return m ? `${mmText(Number(m[1]))} mm` : t;
}

/** 1 → "1.0", 1.3 → "1.3", 1.15 → "1.15" (as the size lists have always written them). */
function mmText(n: number): string {
  return n.toFixed(2).replace(/0$/, "");
}

/** The parts of a lot, tidied: a millimetre size kept as `size` (older lots) is the mm.
 *  Every word is kept exactly as written — a lot's label must never change, or an
 *  older purchase would no longer find the stock it brought in. */
export function tidySpec(s: Partial<LotSpec>): LotSpec {
  let size = s.size?.trim() || undefined;
  let mm = s.mm?.trim() || undefined;
  if (size && isMm(size) && !mm) { mm = size; size = undefined; }
  return { shape: s.shape?.trim() || "Round", type: s.type?.trim() || undefined, size, mm, color: s.color?.trim() || undefined, clarity: s.clarity?.trim() || undefined };
}

/** "Round · CVD · +6.5-7 · 1.3 mm · G-H · VS" — just "Round" when nothing else is known.
 *  The type right after the shape; sieve before mm, as a lot entered with only one
 *  of them has always been written. A lot without a type is written as it always was. */
export function lotKey(s: Partial<LotSpec>): string {
  const t = tidySpec(s);
  return [t.shape, t.type, t.size, t.mm, t.color, t.clarity].filter(Boolean).join(LOT_SEP);
}

/** The shape alone — the first part of a lot. */
export function lotShape(key: string): string {
  return String(key).split(LOT_SEP)[0];
}

const SIZE_RE = /^(\+|-)|mm$|\bct\b|^\d+\/\d+|pointer/i;
/** The stone types a lot label can carry right after its shape. */
const TYPE_RE = /^(natural|cvd|hpht|lab[\s-]?(grown|created)|lgd|lab|moissanite|synthetic|treated|untreated|heated|unheated)$/i;
const COLOR_RE = /^[D-Z](\s*-\s*[D-Z])?\+?$|brown|white|yellow|fancy|\b(TTLB|TLB|LB)\b/i;
/** The business's own type words (Settings → Dropdown lists), so "Lab Grown (CVD)" reads as a type too. */
const knownTypes = new Set<string>();
export function knowStoneTypes(list: string[]): void {
  for (const t of list) if (t.trim()) knownTypes.add(t.trim().toLowerCase());
}
const isType = (part: string) => TYPE_RE.test(part.trim()) || knownTypes.has(part.trim().toLowerCase());

/** A lot's parts, read from its movement when kept there, else from its label. */
export function lotParts(key: string, kept?: Partial<LotSpec>): LotSpec {
  if (kept?.shape) return tidySpec(kept);
  const [shape, ...rest] = String(key).split(LOT_SEP);
  const out: LotSpec = { shape };
  if (rest.length && isType(rest[0])) out.type = rest.shift();
  for (const part of rest) {
    if (!out.mm && isMm(part)) out.mm = part;
    else if (!out.size && SIZE_RE.test(part)) out.size = part;
    else if (!out.color && COLOR_RE.test(part)) out.color = part;
    else if (!out.clarity) out.clarity = part;
  }
  return out;
}

/** The lot as people read it: "Round · 1.3 mm · G-H · VS", or "Round · size not recorded". */
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

/** Millimetre sizes, 0.7 mm to 3.3 mm in steps of 0.05. */
export const DEFAULT_DIAMOND_MM: string[] = Array.from({ length: 53 }, (_, i) => `${mmText(0.7 + i * 0.05)} mm`);

/** Order sizes as sizes: 0.9 mm before 1.15 mm, +2-2.5 before +10-10.5. */
export function sizeOrder(a?: string, b?: string): number {
  return (a ?? "").localeCompare(b ?? "", undefined, { numeric: true });
}

/** Sieve sizes, as melee is sorted in Surat, then millimetre sizes (an older list
 *  held both; the mm ones now show under MM). */
export const DEFAULT_DIAMOND_SIZES = [
  "+0000-000", "+000-00", "+00-0", "+0-1", "+1-1.5", "+1.5-2", "+2-2.5", "+2.5-3", "+3-3.5", "+3.5-4", "+4-4.5",
  "+4.5-5", "+5-5.5", "+5.5-6", "+6-6.5", "+6.5-7", "+7-7.5", "+7.5-8", "+8-8.5", "+8.5-9", "+9-9.5", "+9.5-10",
  "+10-10.5", "+10.5-11", "+11-11.5", "+11.5-12", "+12-12.5", "+12.5-13", "+13-13.5", "+13.5-14", "+14-14.5"
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

/** For dropdowns: the business's sieve sizes (no mm) and its mm sizes (its mm list
 *  plus any mm an older size list held), each in size order. */
export function sieveChoices(sizes: string[]): string[] {
  return sizes.filter(v => !isMm(v));
}
export function mmChoices(mmList: string[], sizes: string[]): string[] {
  return [...new Set([...mmList, ...sizes.filter(isMm)])].sort((a, b) => parseFloat(a) - parseFloat(b));
}
