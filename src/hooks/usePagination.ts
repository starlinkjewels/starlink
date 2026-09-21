import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";

/**
 * Paging that survives leaving the page and coming back.
 *
 * The page used to be plain component state, so opening an order from page 4 of
 * the list and pressing Back landed on page 1 — and the same anywhere else a row
 * leads somewhere. Keeping it in the address instead means the browser restores
 * it like any other part of the page, because that is exactly what Back does.
 *
 * The address is REPLACED rather than pushed, so Back leaves the list instead of
 * stepping through every page that was looked at on the way.
 *
 * `paramKey` names the query parameter; give one per list when a page shows two.
 */
export function usePagination<T>(items: T[], pageSize = 10, paramKey = "page") {
  const [params, setParams] = useSearchParams();
  const fromUrl = Math.max(1, Math.floor(Number(params.get(paramKey))) || 1);
  const [page, setPageState] = useState(fromUrl);

  const setPage = useCallback((n: number) => {
    const next = Math.max(1, Math.floor(n) || 1);
    setPageState(next);
    setParams(prev => {
      const q = new URLSearchParams(prev);
      if (next <= 1) q.delete(paramKey); else q.set(paramKey, String(next));
      return q;
    }, { replace: true });
  }, [setParams, paramKey]);

  // Follow the address when the browser moves through history.
  useEffect(() => { setPageState(fromUrl); }, [fromUrl]);

  // A changed search or filter is a different list, so go back to the top — but
  // not on the first render, which would throw away the page just restored.
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    setPage(1);
  }, [items.length, setPage]);

  const totalPages = Math.max(1, Math.ceil(items.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const start = (safePage - 1) * pageSize;
  const paged = items.slice(start, start + pageSize);

  return { paged, page: safePage, setPage, totalPages, total: items.length, start, end: Math.min(start + pageSize, items.length) };
}
