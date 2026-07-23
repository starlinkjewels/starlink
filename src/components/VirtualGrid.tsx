import { useRef, useState, useEffect, useMemo, type ReactNode } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";

// Matches the grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5
// breakpoints used elsewhere in Catalog, so virtualized and non-virtualized
// grids line up visually.
const BREAKPOINTS = [
  { minWidth: 1024, cols: 5 },
  { minWidth: 768, cols: 4 },
  { minWidth: 640, cols: 3 },
  { minWidth: 0, cols: 2 },
];

function columnsForWidth(w: number): number {
  return BREAKPOINTS.find((b) => w >= b.minWidth)!.cols;
}

function useResponsiveColumns(): number {
  const [cols, setCols] = useState(() =>
    columnsForWidth(typeof window === "undefined" ? 0 : window.innerWidth),
  );
  useEffect(() => {
    const onResize = () => setCols(columnsForWidth(window.innerWidth));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return cols;
}

function findScrollParent(el: HTMLElement | null): HTMLElement {
  let node = el?.parentElement ?? null;
  while (node) {
    if (/(auto|scroll)/.test(window.getComputedStyle(node).overflowY)) return node;
    node = node.parentElement;
  }
  return document.documentElement;
}

/**
 * Virtualized responsive grid — only renders rows near the viewport (plus a
 * small overscan buffer), so a folder with thousands of items doesn't turn
 * into thousands of live DOM nodes. Row height is dynamically measured
 * (`estimateRowHeight` is just an initial guess), so it adapts to whatever
 * `renderItem` actually renders at the current column width.
 */
export function VirtualGrid<T>({
  items,
  estimateRowHeight,
  gap = 16,
  renderItem,
  getKey,
}: {
  items: T[];
  estimateRowHeight: number;
  gap?: number;
  renderItem: (item: T, index: number) => ReactNode;
  getKey: (item: T) => string;
}) {
  const anchorRef = useRef<HTMLDivElement>(null);
  const [scrollEl, setScrollEl] = useState<HTMLElement | null>(null);
  const cols = useResponsiveColumns();

  useEffect(() => {
    setScrollEl(findScrollParent(anchorRef.current));
  }, []);

  const rows = useMemo(() => {
    const out: T[][] = [];
    for (let i = 0; i < items.length; i += cols) out.push(items.slice(i, i + cols));
    return out;
  }, [items, cols]);

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollEl,
    estimateSize: () => estimateRowHeight + gap,
    overscan: 4,
  });

  // First paint: we don't know the scroll container yet — render an empty
  // placeholder rather than flashing the full unvirtualized grid.
  if (!scrollEl) return <div ref={anchorRef} style={{ minHeight: estimateRowHeight }} />;

  const virtualRows = virtualizer.getVirtualItems();

  return (
    <div
      ref={anchorRef}
      style={{ position: "relative", height: virtualizer.getTotalSize(), width: "100%" }}
    >
      {virtualRows.map((vRow) => (
        <div
          key={vRow.key}
          ref={virtualizer.measureElement}
          data-index={vRow.index}
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: "100%",
            transform: `translateY(${vRow.start}px)`,
            paddingBottom: gap,
          }}
        >
          <div
            style={{ display: "grid", gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, gap }}
          >
            {rows[vRow.index].map((item, i) => (
              <div key={getKey(item)}>{renderItem(item, vRow.index * cols + i)}</div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
