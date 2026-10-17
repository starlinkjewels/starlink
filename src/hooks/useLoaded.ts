import { useEffect, useState } from "react";
import { collectionsLoaded, ensureCollections } from "@/lib/db";
import { useDb } from "@/hooks/useDb";
import type { LazyCol } from "@/lib/pageData";

/**
 * Whether these on-demand records have arrived — asking for them if not.
 *
 * A page lists only the records it shows (src/lib/pageData.ts). Correcting a
 * payment also reads the records behind it — the bill it settled, the sale it
 * came from — and an action that ran before those arrived would see a payment
 * that belongs to nobody. So an action that needs them waits for this, and the
 * page asks for them by name rather than by reading them early.
 */
export function useLoaded(cols: readonly LazyCol[]): boolean {
  useDb(); // re-read whenever the store changes, a collection arriving included
  const [, bump] = useState(0);
  const ready = collectionsLoaded(cols);
  const key = cols.join("|");
  useEffect(() => {
    if (ready) return;
    let live = true;
    void ensureCollections(cols).then(() => { if (live) bump(n => n + 1); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, ready]);
  return ready;
}
