import { useEffect, useRef, useState, type VideoHTMLAttributes } from "react";
import { Download, Maximize2, Pause, Play, Volume2, VolumeX, AlertTriangle, Loader2 } from "lucide-react";
import { usePlayableSrc } from "@/lib/webVideo";

/**
 * A product video shown the way shop pages show them now: it plays by itself
 * (muted, on a loop, in the page) while it is on screen, over the piece's photo
 * until the first frame arrives — nothing to press. Tap to pause or play; sound,
 * full screen (with the usual controls) and download in the corner; a thin bar
 * shows how far it has played.
 *
 * It plays the copy made to play everywhere (H.264 MP4, lib/webVideo.ts) when
 * there is one, else the original. If neither plays here it says so plainly,
 * with the download — and `onUnplayable` asks for the copy to be made.
 */
export function ProductVideo({ src: original, poster, onDownload, onUnplayable, className = "", maxH = "max-h-[28rem]" }: {
  src: string; poster?: string; onDownload?: () => void; className?: string;
  /** How tall it may grow (a Tailwind max-height class). */
  maxH?: string;
  /** Neither the copy nor the original plays in this browser. */
  onUnplayable?: () => void;
}) {
  const playable = usePlayableSrc(original);
  const src = playable.src;
  const ref = useRef<HTMLVideoElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<"loading" | "playing" | "paused" | "error">("loading");
  const [muted, setMuted] = useState(true);
  const [progress, setProgress] = useState(0);
  // Paused by a tap: it stays paused, even when scrolled away and back.
  const userPaused = useRef(false);

  // A new video starts afresh — not a switch from the copy to the original, and not
  // the first showing (an error can arrive before this would run: Firefox refuses
  // an HEVC file, and a missing copy, at once).
  const shownFor = useRef(original);
  useEffect(() => {
    if (shownFor.current === original) return;
    shownFor.current = original;
    setState("loading"); setProgress(0); userPaused.current = false;
  }, [original]);
  // The muted property itself — React leaves it as it first was.
  useEffect(() => { if (ref.current) ref.current.muted = muted; }, [muted]);

  // Plays only while it is on screen — a page of them never plays them all at once.
  useEffect(() => {
    const v = ref.current;
    if (!v || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([e]) => {
      if (e.isIntersecting) { if (!userPaused.current) v.play().catch(() => { /* waits for a tap */ }); }
      else v.pause();
    }, { threshold: 0.35 });
    io.observe(v);
    return () => io.disconnect();
  }, [src]);

  // Full screen brings the usual controls (seek, volume); back in the page, the clean frame.
  useEffect(() => {
    const onFs = () => { const v = ref.current; if (v) v.controls = document.fullscreenElement === v; };
    document.addEventListener("fullscreenchange", onFs);
    return () => document.removeEventListener("fullscreenchange", onFs);
  }, []);

  const toggle = () => {
    const v = ref.current;
    if (!v || state === "error") return;
    if (v.paused) { userPaused.current = false; v.play().catch(() => {}); }
    else { userPaused.current = true; v.pause(); }
  };
  // The copy isn't there (yet) or won't play: the original; nothing left: say so.
  const fail = () => {
    if (playable.failed()) { setState("loading"); return; }
    setState("error");
    onUnplayable?.();
  };
  // An error that came before React was listening (Firefox refuses a missing copy,
  // or an HEVC file, at once — and React drops events that early): look for it
  // once the video is on the page and after each switch, rather than wait on a spinner.
  useEffect(() => {
    if (ref.current?.error) fail();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src]);
  const btn = "h-8 w-8 rounded-full bg-black/55 hover:bg-black/75 text-white grid place-items-center backdrop-blur-sm transition-colors";

  return (
    <div ref={box} className={`group relative overflow-hidden rounded-2xl bg-black ${state === "error" ? "min-h-60" : ""} ${className}`}>
      <video
        ref={ref} src={src} poster={poster}
        autoPlay muted={muted} loop playsInline preload="auto"
        onPlaying={() => setState("playing")}
        onPause={() => setState(s => (s === "error" ? s : "paused"))}
        onLoadedData={e => { if (e.currentTarget.videoWidth === 0) fail(); }}
        onError={fail}
        onTimeUpdate={e => { const v = e.currentTarget; if (v.duration) setProgress(v.currentTime / v.duration); }}
        onClick={toggle}
        className={`block w-full ${maxH} mx-auto object-contain cursor-pointer ${state === "error" ? "opacity-0" : ""}`}
        aria-label="Product video"
      />

      {/* The first frame is on its way. */}
      {state === "loading" && (
        <div className="pointer-events-none absolute inset-0 grid place-items-center">
          <span className="h-11 w-11 rounded-full bg-black/45 grid place-items-center"><Loader2 className="h-5 w-5 text-white animate-spin" /></span>
        </div>
      )}

      {/* Paused by a tap: one big play in the middle. */}
      {state === "paused" && (
        <button type="button" onClick={toggle} aria-label="Play"
          className="absolute inset-0 grid place-items-center bg-black/10">
          <span className="h-14 w-14 rounded-full bg-white/90 text-black grid place-items-center shadow-lg"><Play className="h-6 w-6 ml-0.5" /></span>
        </button>
      )}

      {state === "error" ? (
        <div className="absolute inset-0 grid place-items-center p-4 text-center"
          style={poster ? { backgroundImage: `linear-gradient(rgba(0,0,0,.72), rgba(0,0,0,.72)), url("${poster}")`, backgroundSize: "cover", backgroundPosition: "center" } : undefined}>
          <div className="max-w-sm space-y-2 text-white">
            <AlertTriangle className="h-6 w-6 mx-auto text-amber-300" />
            <p className="text-sm font-semibold">This video can&rsquo;t play in this browser yet</p>
            <p className="text-xs text-white/75">A copy that plays on every browser and device is being made — open the page again in a minute. Or download it to watch now.</p>
            {onDownload && (
              <button type="button" onClick={onDownload} className="mt-1 inline-flex items-center gap-1.5 h-9 px-4 rounded-full bg-white text-black text-xs font-semibold">
                <Download className="h-3.5 w-3.5" /> Download
              </button>
            )}
          </div>
        </div>
      ) : (
        <>
          {/* Sound, full screen, download — in the corner, out of the way. */}
          <div className="absolute top-2.5 right-2.5 flex items-center gap-1.5 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:focus-within:opacity-100 transition-opacity">
            <button type="button" className={btn} onClick={() => setMuted(m => !m)} aria-label={muted ? "Sound on" : "Sound off"} title={muted ? "Sound on" : "Sound off"}>
              {muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
            </button>
            {state === "playing" && (
              <button type="button" className={btn} onClick={toggle} aria-label="Pause" title="Pause"><Pause className="h-4 w-4" /></button>
            )}
            <button type="button" className={btn} onClick={() => ref.current?.requestFullscreen?.().catch(() => {})} aria-label="Full screen" title="Full screen">
              <Maximize2 className="h-4 w-4" />
            </button>
            {onDownload && (
              <button type="button" className={btn} onClick={onDownload} aria-label="Download video" title="Download"><Download className="h-4 w-4" /></button>
            )}
          </div>
          {/* How far it has played. */}
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-1 bg-white/15">
            <div className="h-full bg-white/80 transition-[width] duration-200 ease-linear" style={{ width: `${Math.round(progress * 1000) / 10}%` }} />
          </div>
        </>
      )}
    </div>
  );
}

/**
 * A plain video (its own controls) that plays the copy made to play everywhere
 * when there is one, else the original — for the viewers that keep their own
 * look (Catalog, Product Photos, shared pages).
 */
export function WebVideo({ src, onUnplayable, onError, ...rest }: Omit<VideoHTMLAttributes<HTMLVideoElement>, "src"> & { src: string; onUnplayable?: () => void }) {
  const playable = usePlayableSrc(src);
  const ref = useRef<HTMLVideoElement>(null);
  const fail = () => { if (!playable.failed()) onUnplayable?.(); };
  // An error that came before React was listening (see ProductVideo).
  useEffect(() => {
    if (ref.current?.error) fail();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playable.src]);
  return <video ref={ref} {...rest} src={playable.src} onError={e => { onError?.(e); fail(); }} />;
}
