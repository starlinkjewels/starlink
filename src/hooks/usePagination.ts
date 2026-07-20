import { useState, useEffect } from "react";

export function usePagination<T>(items: T[], pageSize = 10) {
  const [page, setPage] = useState(1);

  // Reset to page 1 whenever the source list changes (filter/search)
  useEffect(() => { setPage(1); }, [items.length]);

  const totalPages = Math.max(1, Math.ceil(items.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const start = (safePage - 1) * pageSize;
  const paged = items.slice(start, start + pageSize);

  return { paged, page: safePage, setPage, totalPages, total: items.length, start, end: Math.min(start + pageSize, items.length) };
}
