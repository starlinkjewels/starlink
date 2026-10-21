// The app's dropdown lists, kept in Settings → Dropdown lists so each business
// sets its own words. Every list starts as the default below; once edited, the
// business's own list is stored in settings.optionLists[key].
//
// A record keeps the word it was saved with: renaming or removing an option
// only changes what new entries can pick. An older record's word is still
// offered when that record is edited (choicesOf), so opening it changes nothing.
//
// Lists the app's logic runs on — gold karats, order status, priority — are
// deliberately not here.
import { loadDb, type Settings } from "./db";
import { DEFAULT_DIAMOND_CLARITIES, DEFAULT_DIAMOND_COLORS, DEFAULT_DIAMOND_MM, DEFAULT_DIAMOND_SIZES } from "./diamondLots";

export type ListKey =
  | "jewelleryTypes" | "metals" | "diamondTypes" | "colours" | "rhodium" | "stamping"
  | "paymentMethods" | "departments" | "meltReasons" | "returnReasons"
  | "diamondShapes" | "diamondSizes" | "diamondMm" | "diamondColors" | "diamondClarities"
  | "diamondFinish" | "diamondFluorescence" | "diamondLabs" | "chargeNames";

export interface ListDef {
  key: ListKey;
  group: "Orders" | "Diamonds" | "Payments" | "Team" | "Reasons";
  title: string;
  /** Where it shows — one short line. */
  hint: string;
  defaults: readonly string[];
  /** Always offered and not editable: the app does something particular with them. */
  builtIn?: readonly string[];
}

export const LIST_DEFS: readonly ListDef[] = [
  { key: "jewelleryTypes", group: "Orders", title: "Jewellery types", hint: "New order, order edit and Ready Stock",
    defaults: ["Ring", "Ring + Band", "Pendant", "Necklace", "Bracelet", "Earrings", "Custom"], builtIn: ["Diamond Only"] },
  { key: "metals", group: "Orders", title: "Metals", hint: "Each one with karats or without",
    defaults: ["Yellow Gold", "White Gold (Palladium Alloy)", "White Gold (Silver Alloy)", "Rose Gold", "Platinum", "Silver", "Titanium"],
    builtIn: ["None (Diamond only)"] }, // = DIAMOND_ONLY_METAL (spelled out: read while modules load)
  { key: "diamondTypes", group: "Orders", title: "Diamond types", hint: "New order, order edit and Ready Stock",
    defaults: ["Natural", "Lab Grown"] },
  { key: "colours", group: "Orders", title: "Colours", hint: "The piece's colour",
    defaults: ["Yellow", "Rose", "White"] },
  { key: "rhodium", group: "Orders", title: "Rhodium", hint: "Plating choices on an order",
    defaults: ["No Rhodium", "Diamond Part White", "Full White", "Two Tone Casting", "Other"] },
  { key: "stamping", group: "Orders", title: "Stamping", hint: "Stamp choices on an order",
    defaults: ["No Stamping", "KT Stamping", "Diamond Weight + KT Stamp"], builtIn: ["Special Stamp"] },
  { key: "chargeNames", group: "Orders", title: "Other charges", hint: "Extra charges added to an order's total",
    defaults: ["Setting charge", "Engraving", "Rush fee", "Insurance", "Packaging", "Hallmarking", "Polishing / repair"] },
  // Loose diamond lots in stock: shape · sieve · mm · colour · clarity (lib/diamondLots.ts),
  // and a certified stone's grading.
  { key: "diamondShapes", group: "Diamonds", title: "Shapes", hint: "Loose and certified stones",
    defaults: ["Round", "Oval", "Pear", "Princess", "Emerald", "Marquise", "Cushion", "Radiant", "Heart", "Asscher", "Baguette", "Mix", "Other"] },
  { key: "diamondMm", group: "Diamonds", title: "MM sizes", hint: "Millimetre sizes, for loose lots",
    defaults: DEFAULT_DIAMOND_MM },
  { key: "diamondSizes", group: "Diamonds", title: "Sieve sizes", hint: "Sieve sizes, for loose lots (mm ones here show under MM too)",
    defaults: DEFAULT_DIAMOND_SIZES },
  { key: "diamondColors", group: "Diamonds", title: "Colours", hint: "Single grades and ranges, for loose lots",
    defaults: DEFAULT_DIAMOND_COLORS },
  { key: "diamondClarities", group: "Diamonds", title: "Clarities", hint: "Single grades and groups, loose and certified",
    defaults: DEFAULT_DIAMOND_CLARITIES },
  { key: "diamondFinish", group: "Diamonds", title: "Cut · polish · symmetry", hint: "A certified stone's finish grades",
    defaults: ["EX", "VG", "G", "F", "P", "Ideal"] },
  { key: "diamondFluorescence", group: "Diamonds", title: "Fluorescence", hint: "A certified stone's fluorescence",
    defaults: ["None", "Faint", "Medium", "Strong", "Very Strong"] },
  { key: "diamondLabs", group: "Diamonds", title: "Labs", hint: "Who graded a certified stone",
    defaults: ["GIA", "IGI", "HRD", "GCAL", "SGL", "EGL"] },
  { key: "paymentMethods", group: "Payments", title: "Payment methods", hint: "How a client paid",
    defaults: ["Cash", "Bank Transfer", "UPI", "Venmo", "Zelle", "Cheque", "Card", "Other"] },
  { key: "departments", group: "Team", title: "Departments", hint: "A staff member's department",
    defaults: ["Sales", "CAD", "Design", "Production", "Diamond Setting", "Polishing", "QC", "Packing", "Dispatch", "Accounts"] },
  { key: "meltReasons", group: "Reasons", title: "Melt reasons", hint: "Quick picks when a piece is melted",
    defaults: ["Came out wrong", "Customer rejected", "Design changed"] },
  { key: "returnReasons", group: "Reasons", title: "Sales return reasons", hint: "Quick picks on a credit note",
    defaults: ["Customer didn't like it", "Wrong size", "Quality issue", "Not as ordered"] },
];

export function listDef(key: ListKey): ListDef {
  return LIST_DEFS.find(d => d.key === key)!;
}

/** The business's list (or the default), without the built-in options. */
export function listOf(key: ListKey, settings?: Settings): string[] {
  const own = (settings ?? loadDb().settings).optionLists?.[key];
  return Array.isArray(own) && own.length ? [...own] : [...listDef(key).defaults];
}

/** For a dropdown: the list, its built-in options, and the word a record already has. */
export function choicesOf(key: ListKey, current?: string | null, settings?: Settings, opts: { builtIn?: boolean } = {}): string[] {
  const out = listOf(key, settings);
  if (opts.builtIn !== false) for (const b of listDef(key).builtIn ?? []) if (!out.includes(b)) out.push(b);
  if (current && !out.includes(current)) out.push(current);
  return out;
}

/* ── Metals: with karats or without ─────────────────────────────────────── */

/** Without karats unless the business says otherwise — the piece IS that metal. */
export const DEFAULT_NO_KARAT_METALS = ["Platinum", "Silver", "Titanium"];

export function noKaratMetals(settings?: Settings): string[] {
  const own = (settings ?? loadDb().settings).metalsWithoutKarats;
  return Array.isArray(own) ? own : DEFAULT_NO_KARAT_METALS;
}
