import { useCallback, useState } from "react";
import { useAuth } from "@/lib/auth";

const PREFIX = "sl-filter:";

function read(k: string): string | null {
  try { return localStorage.getItem(k); } catch { return null; }
}

/**
 * A table's filter that stays as it was left — going to another page and
 * coming back, or opening the app again tomorrow — until it is changed or
 * cleared. Kept in this browser, for the person signed in, one per page and
 * filter (`key`, e.g. "orders.company"). Setting it back to `fallback` (what
 * Clear does) forgets it.
 *
 * Used in place of useState for a filter: const [co, setCo] = useStickyFilter("orders.company", "all").
 */
export function useStickyFilter<T extends string = string>(key: string, fallback: NoInfer<T>): [T, (v: T) => void] {
  const { user } = useAuth();
  const k = `${PREFIX}${user?.id ?? "anon"}:${key}`;
  // Kept with the key it belongs to: a page that stays on screen while its key
  // changes (another person signed in, another record) reads the new one afresh,
  // never carrying the old value over or saving it under the new key.
  const [held, setHeld] = useState<{ k: string; v: T }>(() => ({ k, v: (read(k) as T | null) ?? fallback }));
  const value = held.k === k ? held.v : ((read(k) as T | null) ?? fallback);
  if (held.k !== k) setHeld({ k, v: value });
  const set = useCallback((v: T) => {
    setHeld({ k, v });
    try {
      if (v === fallback || v === "") localStorage.removeItem(k);
      else localStorage.setItem(k, v);
    } catch { /* private window or blocked site data — it just won't be remembered */ }
  }, [k, fallback]);
  return [value, set];
}
