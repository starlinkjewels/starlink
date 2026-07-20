import {
  Pagination, PaginationContent, PaginationItem,
  PaginationLink, PaginationPrevious, PaginationNext, PaginationEllipsis,
} from "@/components/ui/pagination";

interface Props {
  page: number;
  totalPages: number;
  onPageChange: (p: number) => void;
  /** Shown left of the nav, e.g. "Showing 1–10 of 42" */
  label?: string;
  className?: string;
}

export function PaginationBar({ page, totalPages, onPageChange, label, className = "" }: Props) {
  if (totalPages <= 1) return null;

  /** Build the visible page numbers with ellipsis logic */
  const pages: (number | "…")[] = [];
  if (totalPages <= 7) {
    for (let i = 1; i <= totalPages; i++) pages.push(i);
  } else {
    pages.push(1);
    if (page > 3) pages.push("…");
    for (let i = Math.max(2, page - 1); i <= Math.min(totalPages - 1, page + 1); i++) pages.push(i);
    if (page < totalPages - 2) pages.push("…");
    pages.push(totalPages);
  }

  return (
    <div className={`flex items-center justify-between gap-4 flex-wrap py-3 px-1 ${className}`}>
      {/* left label */}
      {label && (
        <p className="text-sm text-muted-foreground shrink-0">{label}</p>
      )}

      {/* nav */}
      <Pagination className="w-auto mx-0">
        <PaginationContent className="gap-1">
          {/* Previous */}
          <PaginationItem>
            <PaginationPrevious
              href="#"
              onClick={e => { e.preventDefault(); if (page > 1) onPageChange(page - 1); }}
              className={`rounded-xl h-9 select-none ${page === 1 ? "pointer-events-none opacity-40" : "cursor-pointer hover:bg-secondary"}`}
            />
          </PaginationItem>

          {/* Page numbers */}
          {pages.map((p, i) =>
            p === "…" ? (
              <PaginationItem key={`ell-${i}`}>
                <PaginationEllipsis className="h-9 w-9" />
              </PaginationItem>
            ) : (
              <PaginationItem key={p}>
                <PaginationLink
                  href="#"
                  isActive={p === page}
                  onClick={e => { e.preventDefault(); onPageChange(p as number); }}
                  className={`h-9 w-9 rounded-xl cursor-pointer select-none font-medium transition-colors
                    ${p === page
                      ? "bg-brand-dark text-white border-brand-dark hover:bg-brand-dark/90"
                      : "hover:bg-secondary text-foreground"}`}
                >
                  {p}
                </PaginationLink>
              </PaginationItem>
            )
          )}

          {/* Next */}
          <PaginationItem>
            <PaginationNext
              href="#"
              onClick={e => { e.preventDefault(); if (page < totalPages) onPageChange(page + 1); }}
              className={`rounded-xl h-9 select-none ${page === totalPages ? "pointer-events-none opacity-40" : "cursor-pointer hover:bg-secondary"}`}
            />
          </PaginationItem>
        </PaginationContent>
      </Pagination>
    </div>
  );
}
