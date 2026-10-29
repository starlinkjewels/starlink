import { useEffect, useRef, useState } from "react";
import { Check, CheckCheck, Download, FileText, Pause, Play, X } from "lucide-react";
import type { ChatAttachment, Message } from "@/lib/db";
import { tickOf } from "@/lib/chat";

/** ✓ sent · blue ✓✓ read. */
export function Ticks({ m, light }: { m: Message; light?: boolean }) {
  return tickOf(m) === "read"
    ? <CheckCheck className={`h-3.5 w-3.5 ${light ? "text-sky-300" : "text-sky-500"}`} aria-label="Read" />
    : <Check className="h-3.5 w-3.5" aria-label="Sent" />;
}

export const fmtSize = (n?: number) => (!n ? "" : n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

/** A photo full screen — tap outside or ✕ to close; the original can be saved. */
export function ImageViewer({ src, onClose }: { src: string | null; onClose: () => void }) {
  useEffect(() => {
    if (!src) return;
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [src, onClose]);
  if (!src) return null;
  return (
    <div className="fixed inset-0 z-[80] bg-black/90 flex flex-col" onClick={onClose} role="dialog" aria-label="Photo">
      <div className="flex justify-end gap-2 p-3 pt-[calc(0.75rem+env(safe-area-inset-top))]" onClick={e => e.stopPropagation()}>
        <a href={src} target="_blank" rel="noreferrer" download className="h-10 w-10 rounded-full bg-white/10 text-white grid place-items-center" aria-label="Save the photo"><Download className="h-5 w-5" /></a>
        <button type="button" onClick={onClose} className="h-10 w-10 rounded-full bg-white/10 text-white grid place-items-center" aria-label="Close"><X className="h-5 w-5" /></button>
      </div>
      <div className="flex-1 min-h-0 grid place-items-center p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
        <img src={src} alt="" className="max-h-full max-w-full object-contain" onClick={e => e.stopPropagation()} />
      </div>
    </div>
  );
}

/** A voice note: play / pause, how far along, how long. */
export function VoicePlayer({ a, mine }: { a: ChatAttachment; mine: boolean }) {
  const audio = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [at, setAt] = useState(0);
  const [failed, setFailed] = useState(false);
  const total = a.seconds ?? 0;
  const toggle = () => {
    const el = audio.current;
    if (!el) return;
    if (el.paused) void el.play().catch(() => setFailed(true)); else el.pause();
  };
  if (failed) {
    return (
      <a href={a.url} target="_blank" rel="noreferrer" className={`flex items-center gap-2 text-xs underline ${mine ? "text-white/90" : "text-primary"}`}>
        <Download className="h-3.5 w-3.5" /> Voice message ({mmss(total)}) — this browser can't play it here; open it
      </a>
    );
  }
  const pct = total ? Math.min(100, (at / total) * 100) : 0;
  return (
    <div className="flex items-center gap-2.5 min-w-[11rem] sm:min-w-[14rem]">
      <button type="button" onClick={toggle} aria-label={playing ? "Pause" : "Play the voice message"}
        className={`h-9 w-9 rounded-full grid place-items-center shrink-0 ${mine ? "bg-white/20 text-white" : "bg-primary/10 text-primary"}`}>
        {playing ? <Pause className="h-4 w-4 fill-current" /> : <Play className="h-4 w-4 fill-current ml-0.5" />}
      </button>
      <div className="flex-1 min-w-0">
        <div className={`h-1.5 rounded-full ${mine ? "bg-white/30" : "bg-primary/15"}`}>
          <div className={`h-full rounded-full ${mine ? "bg-white" : "bg-primary"}`} style={{ width: `${pct}%` }} />
        </div>
        <p className={`text-[10px] mt-1 tabular-nums ${mine ? "text-white/75" : "text-muted-foreground"}`}>{mmss(playing || at ? at : total)}</p>
      </div>
      <audio ref={audio} src={a.url} preload="none"
        onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)}
        onEnded={() => { setPlaying(false); setAt(0); }}
        onTimeUpdate={e => setAt(e.currentTarget.currentTime)} onError={() => setFailed(true)} />
    </div>
  );
}

/** A file: its name and size, opens in a new tab. */
export function FileCard({ a, mine }: { a: ChatAttachment; mine: boolean }) {
  const ext = (a.name?.split(".").pop() ?? "").toUpperCase().slice(0, 4);
  return (
    <a href={a.url} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()}
      className={`flex items-center gap-2.5 rounded-xl px-2.5 py-2 min-w-[12rem] max-w-[17rem] ${mine ? "bg-white/15 hover:bg-white/20" : "bg-background/70 hover:bg-background"}`}>
      <span className={`h-10 w-10 rounded-lg grid place-items-center shrink-0 ${mine ? "bg-white/20" : "bg-primary/10 text-primary"}`}>
        {ext ? <span className="text-[10px] font-bold">{ext}</span> : <FileText className="h-5 w-5" />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-xs font-medium truncate">{a.name || "File"}</span>
        <span className={`block text-[10px] ${mine ? "text-white/70" : "text-muted-foreground"}`}>{fmtSize(a.size)}{a.size ? " · " : ""}Open</span>
      </span>
    </a>
  );
}
