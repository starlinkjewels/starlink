import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { usePageSizePref } from "@/hooks/usePageSize";

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
export function usePagination<T>(items: T[], defaultPageSize = 10, paramKey = "page",
  /** The list's search and filters, as one string — when it changes, back to page 1. */
  resetKey = "") {
  // How many rows a page holds is the reader's choice, kept across visits. The
  // number passed in is only the fallback for someone who has never set one.
  const pageSize = usePageSizePref(defaultPageSize);
  const [params, setParams] = useSearchParams();
  const fromUrl = Math.max(1, Math.floor(Number(params.get(paramKey))) || 1);
  const [page, setPageState] = useState(fromUrl);

  // react-router returns a NEW setter on every render. Holding it in a ref keeps
  // it out of dependency arrays: an effect that depended on it re-ran on every
  // render, and the one below reset the page to 1 each time, so clicking a page
  // number appeared to do nothing at all.
  const setParamsRef = useRef(setParams);
  setParamsRef.current = setParams;

  const writeParam = useCallback((n: number) => {
    setParamsRef.current(prev => {
      const q = new URLSearchParams(prev);
      if (n <= 1) q.delete(paramKey); else q.set(paramKey, String(n));
      return q;
    }, { replace: true });
  }, [paramKey]);

  const setPage = useCallback((n: number) => {
    const next = Math.max(1, Math.floor(n) || 1);
    setPageState(next);
    writeParam(next);
  }, [writeParam]);

  // Follow the address when the browser moves through history.
  useEffect(() => { setPageState(fromUrl); }, [fromUrl]);

  // A changed search or filter is a different list, so go back to the top — but
  // only when the reader changed it (`resetKey`: the page's search and filters),
  // never because the records were still arriving. It used to watch the list's
  // length, and the list grows while a page loads — so coming Back to page 3 of
  // Orders snapped to page 1 the moment the rest of the orders landed. Changing
  // the rows per page reshuffles every page boundary, so it counts too. A page
  // past the end (fewer rows for now) is shown as the last one, not thrown away.
  // Compared with the last values seen rather than "skip the first run": React
  // runs effects twice when a page opens in development, and a skip-once flag
  // let the second run through — the same snap to page 1, just from elsewhere.
  const seen = useRef(`${pageSize}|${resetKey}`);
  useEffect(() => {
    const now = `${pageSize}|${resetKey}`;
    if (seen.current === now) return;
    seen.current = now;
    setPageState(1);
    writeParam(1);
  }, [resetKey, pageSize, writeParam]);

  const totalPages = Math.max(1, Math.ceil(items.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const start = (safePage - 1) * pageSize;
  const paged = items.slice(start, start + pageSize);

  return { paged, page: safePage, setPage, totalPages, total: items.length, start, end: Math.min(start + pageSize, items.length) };
}
