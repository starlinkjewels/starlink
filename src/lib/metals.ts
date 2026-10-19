// What the app needs to know about a piece's metal. The list itself is the
// business's own (Settings → Dropdown lists → Metals, lib/optionLists.ts).
import { DIAMOND_ONLY_METAL, type Settings } from "./db";
import { choicesOf, noKaratMetals } from "./optionLists";

/** What a metal is called on screen — orders made before say "Gold", which is yellow gold. */
export function metalLabel(m: string): string {
  return m === "Gold" ? "Yellow Gold" : m;
}

/**
 * Whether a piece in this metal has karats. Gold of any colour does — it is
 * bought, issued and charged by karat. A metal the business marks "no karats"
 * (platinum, silver, titanium by default) is that metal through and through.
 */
export function metalHasKarats(m: string, settings?: Settings): boolean {
  return m !== DIAMOND_ONLY_METAL && !noKaratMetals(settings).includes(m);
}

/** A metal that is not gold at all (its own weight, no karat, no gold to issue). */
export function isNonGoldMetal(m: string, settings?: Settings): boolean {
  return !!m && m !== DIAMOND_ONLY_METAL && !metalHasKarats(m, settings);
}

/** The colour a metal suggests for the piece: "White", "Rose" or "Yellow". */
export function metalColour(m: string): "White" | "Rose" | "Yellow" {
  const s = m.toLowerCase();
  return s.includes("white") ? "White" : s.includes("rose") ? "Rose" : "Yellow";
}

/** A metal dropdown's choices, without "None (Diamond only)". */
export function metalOptions(current?: string, settings?: Settings): string[] {
  return choicesOf("metals", current === DIAMOND_ONLY_METAL ? undefined : current, settings, { builtIn: false });
}
