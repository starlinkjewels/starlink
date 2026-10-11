import { useEffect, useMemo, useRef, useState } from "react";
import { History, ChevronsDown } from "lucide-react";

const DAY = 86_400_000;

/**
 * A ledger or history shows its recent entries first and older ones as the
 * reader scrolls — the last `days` days (never fewer than the newest `minRows`
 * entries, so a quiet account does not look empty), then another `days` each
 * time the end of the list comes into view.
 *
 * Only what is SHOWN is windowed. Running balances and totals are worked out by
 * the caller from every entry, so they read exactly as before.
 *
 * While a search or date filter is on (`filtered`), every match counts: the
 * matches are shown `pageRows` at a time instead, still as the reader scrolls.
 */
export function useRecentWindow<T>(
  rows: T[],
  dateOf: (r: T) => string | number | Date | undefined,
  opts: { days?: number; minRows?: number; pageRows?: number; filtered?: boolean; resetKey?: unknown } = {},
) {
  const days = opts.days ?? 15;
  const minRows = opts.minRows ?? 20;
  const pageRows = opts.pageRows ?? 50;
  const filtered = !!opts.filtered;
  const [steps, setSteps] = useState(1);
  const [all, setAll] = useState(false);

  // A new filter starts from the top again.
  const resetSig = JSON.stringify(opts.resetKey ?? null) + String(filtered);
  useEffect(() => { setSteps(1); setAll(false); }, [resetSig]);

  const result = useMemo(() => {
    if (all) return { visible: rows, since: null as Date | null };
    if (filtered) return { visible: rows.slice(0, steps * pageRows), since: null };
    const t = (r: T) => { const d = dateOf(r); const n = d == null ? NaN : +new Date(d); return Number.isFinite(n) ? n : Infinity; };
    const times = rows.map(t);
    let cutoff = Date.now() - steps * days * DAY;
    // Never fewer than the newest minRows × steps entries.
    const want = minRows * steps;
    if (times.filter(x => x >= cutoff).length < want) {
      const sorted = [...times].sort((a, b) => b - a);
      cutoff = Math.min(cutoff, sorted[Math.min(want, sorted.length) - 1] ?? cutoff);
    }
    return { visible: rows.filter((_, i) => times[i] >= cutoff), since: new Date(cutoff) };
  }, [rows, steps, all, filtered, days, minRows, pageRows]); // eslint-disable-line react-hooks/exhaustive-deps

  const hasMore = result.visible.length < rows.length;
  const loadMore = () => setSteps(s => s + 1);
  const showAll = () => setAll(true);

  // The end of the list in view loads the next stretch.
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || !hasMore || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(es => { if (es.some(e => e.isIntersecting)) setSteps(s => s + 1); }, { rootMargin: "200px 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, [hasMore, result.visible.length]);

  return { visible: result.visible, total: rows.length, hasMore, since: result.since, filtered, loadMore, showAll, sentinelRef, days };
}

export type RecentWindow = ReturnType<typeof useRecentWindow<unknown>>;

/** The line under a windowed list: how much is shown, and the way to more. */
export function LoadOlder({ w, noun = "entries" }: { w: Pick<RecentWindow, "visible" | "total" | "hasMore" | "since" | "filtered" | "loadMore" | "showAll" | "sentinelRef" | "days">; noun?: string }) {
  if (w.total === 0) return null;
  const shown = w.visible.length;
  return (
    <div className="px-5 py-3 border-t border-border/50 flex items-center justify-between gap-3 flex-wrap text-xs text-muted-foreground">
      <div ref={w.sentinelRef} className="flex items-center gap-1.5">
        <History className="h-3.5 w-3.5" />
        {w.hasMore
          ? <span>{w.filtered ? `Showing ${shown} of ${w.total} matching ${noun}` : `Showing ${shown} of ${w.total} ${noun} — since ${w.since?.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}`}. Scroll for older.</span>
          : <span>All {w.total} {noun} shown.</span>}
      </div>
      {w.hasMore && (
        <div className="flex items-center gap-2">
          <button type="button" onClick={w.loadMore} className="inline-flex items-center gap-1 h-8 px-3 rounded-lg border border-border bg-white hover:bg-secondary text-brand-dark font-medium">
            <ChevronsDown className="h-3.5 w-3.5" /> {w.filtered ? "Show more" : `Older ${w.days} days`}
          </button>
          <button type="button" onClick={w.showAll} className="h-8 px-3 rounded-lg hover:bg-secondary text-primary font-medium">Show all</button>
        </div>
      )}
    </div>
  );
}
