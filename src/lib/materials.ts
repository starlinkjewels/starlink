/**
 * The materials stock knows about.
 *
 * Gold (by purity, in grams) and diamonds (loose by shape in carats, and
 * certified stones one by one) are built in — their maths is their own: a
 * karat's fine gold, a carat's weight, a certificate. Every OTHER material a
 * piece can use — platinum, silver, rubies, pearls, locks, chains — is defined
 * by an admin in Settings → Materials: its name, what kind of thing it is,
 * the unit it is counted in, and the grades it comes in. It then works
 * everywhere gold and diamonds do — bought, held as opening stock, issued to a
 * factory or an order, used or returned at Final Approval, costed, reported.
 *
 * Its key is its id ("mat_…"), never its name: a gemstone called "Emerald"
 * must never share a bucket with emerald-cut diamonds, and renaming a
 * material must not split its history. Nothing here knows about karats — a
 * metal like platinum has a purity (‰) but no 24-karat fine conversion, so it
 * never goes down a gold path.
 */
import type { Settings, Purchase, DiamondPacket } from "./db";
import { lotKey } from "./diamondLots";

export type MaterialKind = "metal" | "stone" | "finding";
export type MaterialUnit = "g" | "ct" | "pcs";
/** "gold", "diamond", or an admin-defined material's id. */
export type MaterialKey = "gold" | "diamond" | `mat_${string}`;

export interface MaterialDef {
  id: `mat_${string}`;
  name: string;
  kind: MaterialKind;
  unit: MaterialUnit;
  /** What it comes in — "950", "925" for a metal; "Oval", "Round" for a stone; "Lobster lock" for a finding. */
  grades: string[];
  /** Switched off: kept for its history, not offered for new entries. */
  active?: boolean;
  createdAt: string;
}

export const KIND_LABEL: Record<MaterialKind, string> = { metal: "Metal", stone: "Stone", finding: "Finding" };
export const UNIT_LABEL: Record<MaterialUnit, string> = { g: "grams", ct: "carats", pcs: "pieces" };
/** What a kind is counted in, unless the admin says otherwise. */
export const KIND_UNIT: Record<MaterialKind, MaterialUnit> = { metal: "g", stone: "ct", finding: "pcs" };

export function isOtherMaterial(m: string | undefined): m is `mat_${string}` {
  return !!m && m.startsWith("mat_");
}

/** Every admin-defined material (active and not), in the order they were added. */
export function materialDefs(s: Pick<Settings, "materials"> | undefined): MaterialDef[] {
  return s?.materials ?? [];
}

/** Those offered for new entries. */
export function activeMaterials(s: Pick<Settings, "materials"> | undefined): MaterialDef[] {
  return materialDefs(s).filter(m => m.active !== false);
}

export function materialDef(s: Pick<Settings, "materials"> | undefined, key: string | undefined): MaterialDef | undefined {
  return isOtherMaterial(key) ? materialDefs(s).find(m => m.id === key) : undefined;
}

/** "Gold", "Diamond", or the material's own name. */
export function materialName(s: Pick<Settings, "materials"> | undefined, key: string | undefined): string {
  if (key === "gold") return "Gold";
  if (key === "diamond") return "Diamond";
  return materialDef(s, key)?.name ?? "Other material";
}

/** Gold, or a material of the metal kind (platinum, silver…) — not a stone or a finding. */
export function isMetalMaterial(s: Pick<Settings, "materials"> | undefined, key: string | undefined): boolean {
  return key === "gold" || (isOtherMaterial(key) && materialDef(s, key)?.kind === "metal");
}

/** The unit a material is counted in. */
export function materialUnit(s: Pick<Settings, "materials"> | undefined, key: string | undefined): MaterialUnit {
  if (key === "gold") return "g";
  if (key === "diamond") return "ct";
  return materialDef(s, key)?.unit ?? "pcs";
}

/** What a stock bucket of this material is called: purity, shape, or grade. */
export function bucketLabel(key: string | undefined): string {
  return key === "gold" ? "Purity" : key === "diamond" ? "Shape" : "Grade";
}

/** A quantity with its unit: "2.5 g", "0.42 ct", "12 pcs". */
export function fmtQty(n: number, unit: MaterialUnit): string {
  const v = unit === "pcs" ? Math.round(n) : Math.round(n * 1000) / 1000;
  return `${v.toLocaleString("en-IN")} ${unit}`;
}

/** Its weight in grams, for a piece's gross weight: metals as they are, stones at 0.2 g a carat, pieces unweighed. */
export function gramsOf(unit: MaterialUnit, qty: number): number {
  return unit === "g" ? qty : unit === "ct" ? qty * 0.2 : 0;
}

/* ── One answer for every purchase, whatever it bought ──
 * Each of these used to be written out as "gold grams, else diamond carats",
 * which handed 0 to anything else — and an edit then added the whole quantity
 * to stock a second time. */

/** How much a purchase bought, in its material's unit. */
export function purchaseQty(p: Pick<Purchase, "material" | "gold" | "diamond" | "other">): number {
  if (p.material === "gold") return p.gold?.weightGrams ?? 0;
  if (p.material === "diamond") return p.diamond?.carat ?? 0;
  return p.other?.qty ?? 0;
}

/** Its rate per unit, in the purchase's own currency. */
export function purchaseRate(p: Pick<Purchase, "material" | "gold" | "diamond" | "other">): number {
  if (p.material === "gold") return p.gold?.ratePerGram ?? 0;
  if (p.material === "diamond") return p.diamond?.ratePerCarat ?? 0;
  return p.other?.ratePerUnit ?? 0;
}

/** The stock bucket it lands in: a purity, a loose diamond's lot (or "Certified"), or a grade.
 *  A loose lot with only a shape is the shape, as it always was (lib/diamondLots.ts). */
export function purchaseBucket(p: Pick<Purchase, "material" | "gold" | "diamond" | "other">): string {
  if (p.material === "gold") return p.gold?.purity ?? "";
  if (p.material === "diamond") return p.diamond?.kind === "certified" ? "Certified"
    : !p.diamond?.shape ? "unspecified"
    : lotKey({ shape: p.diamond.shape, type: p.diamond.type, size: p.diamond.size, mm: p.diamond.mm, color: p.diamond.color, clarity: p.diamond.clarity });
  return p.other?.grade || "—";
}

/** "2.5 g 950 Platinum", "0.42 ct Round diamond", "12 pcs Lobster lock". */
export function purchaseText(s: Pick<Settings, "materials"> | undefined, p: Pick<Purchase, "material" | "gold" | "diamond" | "other">): string {
  const unit = materialUnit(s, p.material);
  if (p.material === "gold") return `${fmtQty(purchaseQty(p), unit)} ${p.gold?.purity ?? ""} gold`;
  if (p.material === "diamond") {
    const spec = diamondSpec(p.diamond);
    return `${fmtQty(purchaseQty(p), unit)} ${p.diamond?.kind === "certified" ? "certified diamond" : "diamond"}${spec ? ` · ${spec}` : ""}`;
  }
  return `${fmtQty(purchaseQty(p), unit)} ${p.other?.grade ? `${p.other.grade} ` : ""}${materialName(s, p.material)}`;
}

/**
 * A diamond's own details, in one line, the way a diamond office reads them:
 * loose "Round · +6.5-7 · G-H · VS · 12 pcs", certified
 * "Oval · F · VS1 · IGI 52184". A certified stone's colour and clarity are kept
 * on its packet, so pass the packet when there is one. Older entries show what
 * they have (a free-text quality, a shape alone).
 */
export function diamondSpec(
  d: Partial<NonNullable<Purchase["diamond"]>> | undefined,
  pk?: Pick<DiamondPacket, "color" | "clarity" | "quality" | "certificateNumber" | "certificateLab" | "stockNumber"> | null,
): string {
  if (!d && !pk) return "";
  const color = d?.color || pk?.color, clarity = d?.clarity || pk?.clarity;
  const quality = !color && !clarity ? (d?.quality || pk?.quality) : undefined;
  const certNo = d?.certificateNumber || pk?.certificateNumber, lab = d?.certificateLab || pk?.certificateLab;
  return [
    d?.shape, d?.type, d?.mm, d?.size, color, clarity, quality,
    d?.pieces ? `${d.pieces} pcs` : undefined,
    certNo ? `${lab || "Report"} ${certNo}` : undefined,
  ].map(x => (typeof x === "string" ? x.trim() : x)).filter(Boolean).join(" · ");
}

/** The bill's rate per unit in rupees (₹/g, ₹/ct, ₹/pc…), before any discount. */
export function purchaseUnitInr(p: Pick<Purchase, "material" | "gold" | "diamond" | "other" | "currency" | "exchangeRate">): number | undefined {
  const r = purchaseRate(p) * (p.currency === "USD" ? Number(p.exchangeRate) || 0 : 1);
  return r > 0 ? Math.round(r * 100) / 100 : undefined;
}

/** A new material's id. */
export function newMaterialId(name: string): `mat_${string}` {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "").slice(0, 12) || "item";
  return `mat_${slug}${Math.random().toString(36).slice(2, 6)}`;
}

/** Why a material as entered cannot be saved; null when it can. */
export function materialProblem(m: Pick<MaterialDef, "id" | "name" | "grades">, all: MaterialDef[]): string | null {
  const name = m.name.trim();
  if (!name) return "Give it a name.";
  if (/^(gold|diamonds?)$/i.test(name)) return "Gold and diamonds are built in — this is for everything else.";
  if (all.some(x => x.id !== m.id && x.name.trim().toLowerCase() === name.toLowerCase())) return `There is already a material called ${name}.`;
  if (new Set(m.grades.map(g => g.trim().toLowerCase())).size !== m.grades.length) return "A grade is listed twice.";
  return null;
}
