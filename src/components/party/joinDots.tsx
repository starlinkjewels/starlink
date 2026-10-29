import { Fragment, type ReactNode } from "react";

/**
 * A party's contact as one line under its name — "Ramesh · 98200 12345 ·
 * Zaveri Bazaar" — leaving out what was never entered. Nothing at all gives
 * no line.
 */
export function joinDots(parts: ReactNode[]): ReactNode | undefined {
  const kept = parts.filter(p => p !== undefined && p !== null && p !== false && p !== "");
  if (!kept.length) return undefined;
  return kept.map((p, i) => <Fragment key={i}>{i > 0 && " · "}{p}</Fragment>);
}
