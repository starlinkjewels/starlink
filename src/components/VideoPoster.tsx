import { useEffect, useRef, useState } from "react";
import { Play, Video } from "lucide-react";

/**
 * A video's tile: a still from the video itself, with a play mark — instead of
 * a grey box with an icon. `poster`: a small saved still (a preview copy), shown
 * as a picture when there is one. Without it the browser draws the video's own
 * first moments — asked for only once the tile is on screen, and only the
 * start of the file (preload="metadata"), never the whole video.
 */
export function VideoPoster({ src, poster, alt = "", className = "", showPlay = true }: {
  src?: string; poster?: string; alt?: string; className?: string; showPlay?: boolean;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [near, setNear] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (poster || near) return;
    const el = box.current;
    if (!el || typeof IntersectionObserver === "undefined") { setNear(true); return; }
    const io = new IntersectionObserver(es => { if (es.some(e => e.isIntersecting)) { setNear(true); io.disconnect(); } }, { rootMargin: "200px" });
    io.observe(el);
    return () => io.disconnect();
  }, [poster, near]);
  return (
    <div ref={box} className={`relative w-full h-full bg-gradient-to-br from-slate-100 to-slate-200 overflow-hidden ${className}`}>
      {poster
        ? <img src={poster} alt={alt} loading="lazy" decoding="async" className="w-full h-full object-cover" />
        : near && src && !failed
          // "#t=0.1": Safari shows a frame only when asked for a moment past the start.
          ? <video src={`${src.split("#")[0]}#t=0.1`} preload="metadata" muted playsInline disablePictureInPicture
              onError={() => setFailed(true)} className="w-full h-full object-cover pointer-events-none" aria-label={alt} />
          : <div className="w-full h-full grid place-items-center"><Video className="h-10 w-10 text-slate-400" /></div>}
      {showPlay && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="h-12 w-12 rounded-full bg-black/40 flex items-center justify-center"><Play className="h-6 w-6 text-white ml-0.5" /></div>
        </div>
      )}
    </div>
  );
}
