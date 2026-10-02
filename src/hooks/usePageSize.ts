import { useEffect, useState } from "react";

const KEY = "rows-per-page";
/** Everything that reads the preference, so a change on one table reaches the
 *  bar that set it and the list it belongs to in the same tick. */
const listeners = new Set<(n: number | null) => void>();

function read(): number | null {
  try {
    const n = Number(localStorage.getItem(KEY));
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
  } catch {
    // Private windows and blocked site data both throw here. No preference is
    // a perfectly good answer — each table falls back to its own default.
    return null;
  }
}

/** Set how many rows a page holds, everywhere, and remember it. */
export function setPageSizePref(n: number): void {
  const next = Math.max(1, Math.floor(n) || 1);
  try { localStorage.setItem(KEY, String(next)); } catch { /* not worth failing over */ }
  for (const fn of listeners) fn(next);
}

/**
 * How many rows a page holds.
 *
 * One preference for every list rather than one per table: "50 per page" is a
 * thing someone decides once about how they like to read, not twenty separate
 * settings. A table that has never been told keeps its own sensible default —
 * nine supplier cards and twenty-five day-book lines are not the same page.
 *
 * It is shared through a tiny subscription rather than by prop-drilling, so the
 * control that changes it and the list that obeys it stay in step without every
 * one of the twenty tables having to pass it down.
 */
export function usePageSizePref(fallback: number): number {
  const [stored, setStored] = useState<number | null>(read);

  useEffect(() => {
    const fn = (n: number | null) => setStored(n);
    listeners.add(fn);
    // Another tab changing it counts too.
    const onStorage = (e: StorageEvent) => { if (e.key === KEY) setStored(read()); };
    window.addEventListener("storage", onStorage);
    return () => { listeners.delete(fn); window.removeEventListener("storage", onStorage); };
  }, []);

  return stored ?? fallback;
}
