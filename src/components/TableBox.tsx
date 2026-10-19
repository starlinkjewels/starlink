import { useEffect, useRef, type DependencyList, type ReactNode, type RefObject } from "react";

/**
 * The header row of a long table stays in view while the page scrolls — on
 * every table, the same way.
 *
 * CSS `position: sticky` can't do it for a table wider than its box: the box
 * that scrolls sideways becomes the only thing the header can stick to, so it
 * scrolled away on exactly the widest tables, and stuck to the page on the
 * rest — two behaviours in one app. A second, inner scrollbar would fix the
 * header but makes two things to scroll. So the header is moved down with the
 * page instead, inside its own box: one page scroll, the box keeps its
 * rounded border, and a table that scrolls sideways keeps its header too.
 *
 * From a tablet up (a phone shows data tables as cards, and other tables as
 * short boxes it can swipe). The box gets `data-stuck` while the header is held,
 * for its shadow.
 */
export function useHeldHeader(boxRef: RefObject<HTMLElement | null>, deps: DependencyList = [], on = true) {
  useEffect(() => {
    const box = boxRef.current;
    if (!box || !on) return;
    const wide = window.matchMedia("(min-width: 768px)");
    // The page's own scrolling area (the layout's <main>), or the window.
    let scroller: HTMLElement | null = null;
    for (let el = box.parentElement; el; el = el.parentElement) {
      const oy = getComputedStyle(el).overflowY;
      if (oy === "auto" || oy === "scroll") { scroller = el; break; }
    }
    let frame = 0;
    let last = -1;
    let head: HTMLElement | null = null;
    const place = () => {
      frame = 0;
      head = box.querySelector<HTMLElement>(":scope > table > thead");
      if (!head) return;
      let off = 0;
      if (wide.matches) {
        const top = scroller ? scroller.getBoundingClientRect().top : 0;
        // Never past the box: a row's height stays under the header at the end.
        const room = box.clientHeight - head.offsetHeight - 44;
        off = Math.max(0, Math.min(top - box.getBoundingClientRect().top, room));
      }
      off = Math.round(off);
      if (off === last) return;
      last = off;
      head.style.transform = off ? `translateY(${off}px)` : "";
      if (off) box.setAttribute("data-stuck", ""); else box.removeAttribute("data-stuck");
    };
    const ask = () => { if (!frame) frame = requestAnimationFrame(place); };
    const target: HTMLElement | Window = scroller ?? window;
    target.addEventListener("scroll", ask, { passive: true });
    window.addEventListener("resize", ask);
    wide.addEventListener?.("change", ask);
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(ask) : null;
    ro?.observe(box);
    place();
    return () => {
      target.removeEventListener("scroll", ask);
      window.removeEventListener("resize", ask);
      wide.removeEventListener?.("change", ask);
      ro?.disconnect();
      if (frame) cancelAnimationFrame(frame);
      if (head) head.style.transform = "";
      box.removeAttribute("data-stuck");
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [on, ...deps]);
}

/**
 * The one box every hand-built table sits in — the same as a DataTable's: a
 * rounded border, a tinted header row in small capitals, rows that light up
 * under the pointer, figures in even-width digits, sideways scroll when wider
 * than the screen, and the header held in view (see useHeldHeader). The look
 * itself is in styles.css under `.tbl-box`, so Settings → Table Style still
 * applies on top.
 */
export function TableBox({ children, className = "", ownScroll = false }: {
  children: ReactNode; className?: string;
  /** Scrolls in a height of its own (in a dialog) — its header is held there by CSS. */
  ownScroll?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useHeldHeader(ref, [], !ownScroll);
  return (
    <div ref={ref} className={`dt-box tbl-box relative overflow-x-auto rounded-xl border border-border/60 bg-white ${className}`}>
      {children}
    </div>
  );
}
