import { useCallback, useEffect, useState, type RefObject } from "react";
import { createPortal } from "react-dom";

/**
 * A table wider than its box, made easy to move along:
 *  • its own scrollbar sits at the bottom of the table — off the screen on a
 *    long one — so a copy floats at the bottom of the screen while the table
 *    is in view (FloatingScrollbar);
 *  • with a mouse, grab the table and drag it sideways (a drag never counts
 *    as a click on the row it started on);
 *  • the edges say when there is more to either side.
 * Phones and tablets scroll with a finger already, so only the edges apply.
 */
export function useWideScroll(boxRef: RefObject<HTMLDivElement | null>, remount?: unknown) {
  const [s, setS] = useState({ over: false, start: true, end: true });
  const measure = useCallback(() => {
    const el = boxRef.current;
    if (!el) return;
    const over = el.scrollWidth > el.clientWidth + 1;
    const start = el.scrollLeft <= 1;
    const end = el.scrollLeft + el.clientWidth >= el.scrollWidth - 1;
    setS(p => (p.over === over && p.start === start && p.end === end ? p : { over, start, end }));
  }, [boxRef]);

  useEffect(() => {
    const el = boxRef.current;
    if (!el) { setS(p => (p.over ? { over: false, start: true, end: true } : p)); return; }
    measure();
    el.addEventListener("scroll", measure, { passive: true });
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    ro?.observe(el);
    if (el.firstElementChild) ro?.observe(el.firstElementChild);
    window.addEventListener("resize", measure);
    return () => { el.removeEventListener("scroll", measure); ro?.disconnect(); window.removeEventListener("resize", measure); };
    // `remount`: the box itself may come and go (a list switched to cards and back).
  }, [boxRef, measure, remount]);

  // Drag to scroll, mouse only. Starts as an ordinary press; only once it has
  // moved a few pixels sideways does it become a drag — and then the click
  // that ends it is swallowed, so the row under it doesn't open.
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    let x0 = 0, y0 = 0, left0 = 0, pressing = false, dragging = false, swallow = false;
    const down = (e: PointerEvent) => {
      if (e.pointerType !== "mouse" || e.button !== 0) return;
      if (el.scrollWidth <= el.clientWidth + 1) return;
      if ((e.target as HTMLElement).closest("input,textarea,select,[contenteditable],[role=menu],[data-no-drag]")) return;
      pressing = true; dragging = false; x0 = e.clientX; y0 = e.clientY; left0 = el.scrollLeft;
    };
    const move = (e: PointerEvent) => {
      if (!pressing) return;
      // The button let go somewhere we didn't hear about (a native drag of a
      // link or picture cancels the press): it is over.
      if (!(e.buttons & 1)) { up(); return; }
      const dx = e.clientX - x0;
      if (!dragging) {
        if (Math.abs(dx) < 6 || Math.abs(dx) < Math.abs(e.clientY - y0)) return;
        dragging = true;
        el.classList.add("dt-dragging");
        window.getSelection()?.removeAllRanges();
      }
      el.scrollLeft = left0 - dx;
      e.preventDefault();
    };
    const up = () => {
      if (dragging) { swallow = true; setTimeout(() => { swallow = false; }, 0); }
      pressing = false; dragging = false;
      el.classList.remove("dt-dragging");
    };
    const click = (e: MouseEvent) => { if (swallow) { e.stopPropagation(); e.preventDefault(); swallow = false; } };
    // A link or picture dragged natively ends the press without a pointerup.
    const cancel = () => { pressing = false; dragging = false; el.classList.remove("dt-dragging"); };
    el.addEventListener("pointerdown", down);
    window.addEventListener("pointermove", move, { passive: false });
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancel);
    el.addEventListener("dragstart", cancel);
    el.addEventListener("click", click, true);
    return () => {
      el.removeEventListener("pointerdown", down);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
      el.removeEventListener("dragstart", cancel);
      el.removeEventListener("click", click, true);
    };
  }, [boxRef, remount]);

  const scrollBy = (dir: -1 | 1) => {
    const el = boxRef.current;
    if (el) el.scrollBy({ left: dir * Math.max(200, el.clientWidth * 0.7), behavior: "smooth" });
  };
  return { ...s, scrollBy };
}

/**
 * The table's sideways scrollbar, held at the bottom of the screen while the
 * table runs past it — so a long table can be moved sideways without first
 * scrolling down to its end. Hidden once the table's own bar is in view.
 * Drawn by hand (a track and a thumb), not the browser's own bar, so it shows
 * the same everywhere — a Mac hides its scrollbars until something scrolls.
 */
export function FloatingScrollbar({ boxRef, over }: { boxRef: RefObject<HTMLDivElement | null>; over: boolean }) {
  const [pos, setPos] = useState<{ left: number; width: number } | null>(null);
  const [thumb, setThumb] = useState({ x: 0, w: 0 });
  const fine = typeof window !== "undefined" && window.matchMedia("(pointer: fine)").matches;

  useEffect(() => {
    if (!over || !fine) { setPos(null); return; }
    let raf = 0;
    const place = () => {
      raf = 0;
      const el = boxRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const vh = window.innerHeight;
      // In view, but its own bottom edge (and scrollbar) below the screen.
      const show = r.top < vh - 80 && r.bottom > vh + 2;
      setPos(p => {
        const next = show ? { left: Math.round(r.left), width: Math.round(r.width) } : null;
        return p && next && p.left === next.left && p.width === next.width ? p : next;
      });
    };
    const ask = () => { if (!raf) raf = requestAnimationFrame(place); };
    place();
    window.addEventListener("scroll", ask, { passive: true, capture: true });
    window.addEventListener("resize", ask);
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(ask) : null;
    if (boxRef.current) { ro?.observe(boxRef.current); if (boxRef.current.firstElementChild) ro?.observe(boxRef.current.firstElementChild); }
    return () => { window.removeEventListener("scroll", ask, true); window.removeEventListener("resize", ask); ro?.disconnect(); if (raf) cancelAnimationFrame(raf); };
  }, [over, fine, boxRef]);

  // The thumb: as wide as the share of the table in view, where it is scrolled to.
  useEffect(() => {
    const el = boxRef.current;
    if (!pos || !el) return;
    const sync = () => {
      const track = pos.width - 8;
      const w = Math.max(40, Math.round(track * el.clientWidth / el.scrollWidth));
      const room = el.scrollWidth - el.clientWidth;
      const x = room > 0 ? Math.round((track - w) * el.scrollLeft / room) : 0;
      setThumb(t => (t.x === x && t.w === w ? t : { x, w }));
    };
    sync();
    el.addEventListener("scroll", sync, { passive: true });
    return () => el.removeEventListener("scroll", sync);
  }, [pos, boxRef]);

  if (!pos) return null;
  const drag = (e: React.PointerEvent<HTMLDivElement>) => {
    const el = boxRef.current;
    if (!el) return;
    e.preventDefault();
    const onThumb = (e.target as HTMLElement).dataset.thumb === "1";
    const track = pos.width - 8;
    const room = el.scrollWidth - el.clientWidth;
    const per = room / Math.max(1, track - thumb.w);
    if (!onThumb) {
      // A press on the track: jump there (centre the thumb on it).
      const at = e.clientX - pos.left - 4 - thumb.w / 2;
      el.scrollLeft = Math.max(0, Math.min(room, at * per));
    }
    const x0 = e.clientX, left0 = el.scrollLeft;
    const move = (m: PointerEvent) => { el.scrollLeft = Math.max(0, Math.min(room, left0 + (m.clientX - x0) * per)); };
    const up = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
  return createPortal(
    <div className="dt-floatbar fixed bottom-0 z-40 px-1 py-[3px]" style={{ left: pos.left, width: pos.width }}
      onPointerDown={drag} role="scrollbar" aria-orientation="horizontal" aria-label="Scroll the table sideways"
      aria-valuenow={Math.round(thumb.x)} aria-controls={boxRef.current?.id || undefined}>
      <div className="relative h-[10px] rounded-full bg-primary/[0.07]">
        <div data-thumb="1" className="dt-floatthumb absolute top-0 h-full rounded-full cursor-grab active:cursor-grabbing"
          style={{ left: thumb.x, width: thumb.w }} />
      </div>
    </div>,
    document.body,
  );
}
