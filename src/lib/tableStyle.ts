/**
 * How every table in the app looks — chosen once in Settings → Table Style
 * and applied everywhere through attributes on <html> (the styles are in
 * styles.css). "Classic" sets nothing at all, so tables look exactly as they
 * were built.
 */
export type TableStyleKey = "classic" | "clean" | "minimal" | "grid" | "striped" | "bold" | "cards";
export type TableDensity = "default" | "compact" | "spacious";

export interface TableUi {
  style: TableStyleKey;
  density: TableDensity;
  zebra: boolean;
  hover: boolean;
  lines: boolean;
  sticky: boolean;
}

export const TABLE_STYLES: { key: TableStyleKey; name: string; hint: string; zebra: boolean; hover: boolean; lines: boolean }[] = [
  { key: "classic", name: "Classic", hint: "As every table is today", zebra: false, hover: false, lines: false },
  { key: "clean", name: "Clean", hint: "Light and airy, like Stripe's dashboard", zebra: false, hover: true, lines: false },
  { key: "minimal", name: "Minimal", hint: "No boxes — just rows, like Linear", zebra: false, hover: true, lines: false },
  { key: "grid", name: "Grid", hint: "Every cell boxed, like a spreadsheet or Airtable", zebra: false, hover: true, lines: true },
  { key: "striped", name: "Striped", hint: "Alternate rows tinted — easy to follow across", zebra: true, hover: true, lines: false },
  { key: "bold", name: "Bold header", hint: "A dark brand header row", zebra: false, hover: true, lines: false },
  { key: "cards", name: "Floating cards", hint: "Each row stands on its own as a card", zebra: false, hover: false, lines: false },
];

export const DEFAULT_TABLE_UI: TableUi = { style: "classic", density: "default", zebra: false, hover: false, lines: false, sticky: false };

/** A stored setting, completed with the defaults — never trusted to be whole. */
export function tableUiOf(v: Partial<TableUi> | undefined | null): TableUi {
  const style = TABLE_STYLES.some(s => s.key === v?.style) ? v!.style! : "classic";
  return {
    style,
    density: v?.density === "compact" || v?.density === "spacious" ? v.density : "default",
    zebra: !!v?.zebra, hover: !!v?.hover, lines: !!v?.lines, sticky: !!v?.sticky,
  };
}

/** Put a table style on the page. Classic clears everything. */
export function applyTableUi(ui: TableUi, root: HTMLElement = document.documentElement): void {
  const set = (k: string, v: string | null) => (v === null ? root.removeAttribute(k) : root.setAttribute(k, v));
  if (ui.style === "classic") {
    for (const k of ["data-tbl", "data-tbl-density", "data-tbl-zebra", "data-tbl-hover", "data-tbl-lines", "data-tbl-sticky"]) root.removeAttribute(k);
    return;
  }
  set("data-tbl", ui.style);
  set("data-tbl-density", ui.density === "default" ? null : ui.density);
  set("data-tbl-zebra", ui.zebra ? "on" : null);
  set("data-tbl-hover", ui.hover ? "on" : null);
  set("data-tbl-lines", ui.lines ? "on" : null);
  set("data-tbl-sticky", ui.sticky ? "on" : null);
}
