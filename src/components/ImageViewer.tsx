import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, ExternalLink, X } from "lucide-react";
import { useBackToClose } from "@/hooks/useBackNav";

/** The attributes that make a small picture open large: `<img {...zoomable(src, all)} />`. */
export function zoomable(src: string | undefined, all?: string[]): Record<string, string> {
  if (!src) return {};
  const set = [...new Set(all ?? [])];
  return { "data-zoom": src, ...(set.length > 1 ? { "data-zoom-set": JSON.stringify(set) } : {}) };
}

/**
 * A picture opened large, from anywhere: any `<img data-zoom>` (a list's
 * thumbnail, a board card's picture) opens here on a click — the card or row
 * around it does not open as well. Shown as stored, at its full size: on a
 * phone it can be pinched to zoom. An order's other pictures are a swipe or an
 * arrow away. ✕, Esc, a tap outside or the phone's Back closes it.
 */
export function ImageViewer() {
  const [view, setView] = useState<{ list: string[]; i: number } | null>(null);

  useEffect(() => {
    // Caught on the way down, so the card's own click (open the order, start a drag) never runs.
    const onClick = (e: MouseEvent) => {
      const img = (e.target as Element | null)?.closest?.("img[data-zoom]") as HTMLImageElement | null;
      if (!img) return;
      // Not from inside an open dialog: it holds the page still (no clicks outside it), so a
      // tap meant for the picture could land on the dialog's own buttons underneath.
      if (img.closest('[role="dialog"], [role="alertdialog"]')) return;
      e.preventDefault();
      e.stopPropagation();
      const src = img.dataset.zoom || img.currentSrc || img.src;
      let list = [src];
      try {
        const set = JSON.parse(img.dataset.zoomSet || "[]");
        if (Array.isArray(set) && set.length) list = set.map(String);
      } catch { /* one picture */ }
      setView({ list, i: Math.max(0, list.indexOf(src)) });
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, []);

  useBackToClose(!!view, () => setView(null));

  const n = view?.list.length ?? 0;
  const go = (d: number) => setView(v => (v ? { ...v, i: (v.i + d + v.list.length) % v.list.length } : v));
  useEffect(() => {
    if (!view) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setView(null);
      else if (e.key === "ArrowRight" && n > 1) go(1);
      else if (e.key === "ArrowLeft" && n > 1) go(-1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [view, n]);

  // A swipe left or right moves between the pictures (one finger; two fingers zoom).
  const touch = useRef<{ x: number; y: number } | null>(null);
  if (!view) return null;
  const src = view.list[view.i];
  return (
    <div role="dialog" aria-modal="true" aria-label="Picture" className="fixed inset-0 z-[100] bg-black/90 flex flex-col"
      onClick={() => setView(null)}
      onTouchStart={e => { touch.current = e.touches.length === 1 ? { x: e.touches[0].clientX, y: e.touches[0].clientY } : null; }}
      onTouchEnd={e => {
        const t = touch.current; touch.current = null;
        if (!t || n < 2 || e.changedTouches.length !== 1) return;
        const dx = e.changedTouches[0].clientX - t.x, dy = e.changedTouches[0].clientY - t.y;
        if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) go(dx < 0 ? 1 : -1);
      }}>
      <div className="flex items-center justify-between gap-2 px-3 pt-[calc(env(safe-area-inset-top)+0.5rem)] pb-2 text-white/90 shrink-0" onClick={e => e.stopPropagation()}>
        <span className="text-sm tabular-nums px-2">{n > 1 ? `${view.i + 1} / ${n}` : ""}</span>
        <div className="flex items-center gap-1">
          <a href={src} target="_blank" rel="noreferrer" className="h-10 px-3 rounded-full inline-flex items-center gap-1.5 text-sm hover:bg-white/15">
            <ExternalLink className="h-4 w-4" /> Open original
          </a>
          <button type="button" onClick={() => setView(null)} aria-label="Close" className="h-10 w-10 rounded-full grid place-items-center hover:bg-white/15">
            <X className="h-5 w-5" />
          </button>
        </div>
      </div>
      <div className="relative flex-1 min-h-0 flex items-center justify-center px-2 pb-[calc(env(safe-area-inset-bottom)+0.75rem)]">
        <img key={src} src={src} alt="" decoding="async" onClick={e => e.stopPropagation()}
          className="max-w-full max-h-full object-contain select-none" style={{ touchAction: "pinch-zoom", imageRendering: "auto" }} />
        {n > 1 && (
          <>
            <button type="button" aria-label="Previous picture" onClick={e => { e.stopPropagation(); go(-1); }}
              className="absolute left-2 top-1/2 -translate-y-1/2 h-11 w-11 rounded-full bg-white/15 hover:bg-white/25 text-white grid place-items-center">
              <ChevronLeft className="h-6 w-6" />
            </button>
            <button type="button" aria-label="Next picture" onClick={e => { e.stopPropagation(); go(1); }}
              className="absolute right-2 top-1/2 -translate-y-1/2 h-11 w-11 rounded-full bg-white/15 hover:bg-white/25 text-white grid place-items-center">
              <ChevronRight className="h-6 w-6" />
            </button>
          </>
        )}
      </div>
    </div>
  );
}
