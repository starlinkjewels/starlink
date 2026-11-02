/**
 * A filter that can hold more than one choice — two companies, three clients,
 * "In production" and "Ready" together — kept as ONE string, so every page's
 * filter state stays the plain string it always was (and "" / "all" still
 * mean "everything"):
 *
 *   ""  or "all"        → nothing chosen: every row
 *   "co_1"              → one choice (as before)
 *   '["co_1","co_2"]'   → several
 *
 * A page narrows with selHas(filter, row.value) instead of filter === row.value.
 */

/** The choices in a filter's value (none = every row). */
export function selList(v: string | undefined | null): string[] {
  if (!v || v === "all") return [];
  if (v.startsWith("[")) {
    try {
      const a: unknown = JSON.parse(v);
      if (Array.isArray(a)) return a.map(String).filter(Boolean);
    } catch { /* a single choice that happens to start with "[" */ }
  }
  return [v];
}

/** The value for these choices: "" for none, the choice itself for one. */
export function selJoin(list: string[]): string {
  const u = [...new Set(list.filter(Boolean))];
  return u.length === 0 ? "" : u.length === 1 ? u[0] : JSON.stringify(u);
}

/** Does a row with this value pass the filter? Nothing chosen passes everything. */
export function selHas(v: string | undefined | null, x: string | undefined | null): boolean {
  const l = selList(v);
  return !l.length || (x != null && l.includes(x));
}

/** Is anything chosen? */
export const selOn = (v: string | undefined | null): boolean => selList(v).length > 0;

/** The choices as words, for a chip, a heading or a file name: "Cash, Bank" or "3 chosen". */
export function selText(v: string | undefined | null, labelOf: (x: string) => string | undefined, all = "All", max = 2): string {
  const l = selList(v);
  if (!l.length) return all;
  if (l.length > max) return `${l.length} chosen`;
  return l.map(x => labelOf(x) ?? x).join(", ");
}
