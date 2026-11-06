// The call with the agent — an immersive, dark voice screen in the business's own
// colour: the orb in the middle, Live and the time, the language, the words as they
// are said (hide them for just the orb), a keyboard for typing, the microphone on
// or off, and the red End. The call itself — hearing when the owner has finished,
// the answer, listening again — is run by the page (pages/AiOffice.tsx) with
// lib/aiOffice/voiceCall.ts.
import { useEffect, useRef, useState, type MutableRefObject, type ReactNode } from "react";
import { ChevronDown, Keyboard, Languages, MessageSquareText, Mic, MicOff, PhoneOff, SendHorizontal } from "lucide-react";
import { AgentOrb, VoiceWave, orbStateOf } from "@/components/ai/AgentVisuals";
import type { CallPhase } from "@/lib/aiOffice/voiceCall";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export interface CallLine { role: "user" | "assistant"; content: ReactNode; key: string }

const mmss = (s: number) => `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;

export function CallPanel({ name, phase, seconds, level, status, lines, langs, lang, onLang, onSend, onPause, onResume, onEnd, onTapOrb, micBlocked, starters = [], onMinimise }: {
  name: string;
  phase: CallPhase;
  seconds: number;
  level: MutableRefObject<number>;
  /** What is happening, in words ("Looking at payments…"). */
  status?: string;
  lines: CallLine[];
  langs: { v: string; l: string }[];
  lang: string;
  onLang: (v: string) => void;
  onSend: (text: string) => void;
  onPause: () => void;
  onResume: () => void;
  onEnd: () => void;
  /** Tapping the orb while she speaks stops her and listens. */
  onTapOrb: () => void;
  micBlocked?: boolean;
  /** Questions to tap before anything has been said. */
  starters?: string[];
  onMinimise?: () => void;
}) {
  const [showWords, setShowWords] = useState(true);
  const [typing, setTyping] = useState(false);
  const [text, setText] = useState("");
  const list = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLInputElement>(null);
  useEffect(() => { list.current?.scrollTo({ top: list.current.scrollHeight, behavior: "smooth" }); }, [lines.length, status, showWords]);
  useEffect(() => { if (typing) field.current?.focus(); }, [typing]);
  // The microphone blocked: typing is the way in.
  useEffect(() => { if (micBlocked) setTyping(true); }, [micBlocked]);
  const state = orbStateOf(phase);
  const paused = phase === "paused";
  const said = micBlocked ? "Microphone blocked — allow it in the browser, or type"
    : phase === "starting" ? "Connecting…"
    : phase === "listening" ? "Listening…"
    : phase === "hearing" ? "Got it…"
    : phase === "thinking" ? status || "Thinking…"
    : phase === "speaking" ? "Speaking — talk to interrupt"
    : phase === "paused" ? "Microphone off" : "";
  const send = (t: string) => { const q = t.trim(); if (q) { onSend(q); setText(""); } };
  const bigOrb = !showWords || lines.length === 0;

  return (
    <section className="ai-call" role="dialog" aria-label={`Call with ${name}`}>
      {/* Top: who, live, time, language, words on/off */}
      <header className="relative z-10 flex items-center gap-2.5 px-4 pt-[max(1rem,env(safe-area-inset-top))] pb-2">
        {onMinimise && (
          <button type="button" onClick={onMinimise} aria-label="Back to the page" className="ai-call-btn h-9 w-9 sm:hidden"><ChevronDown className="h-5 w-5" /></button>
        )}
        <AgentOrb size={34} state={state} />
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-white truncate leading-tight">{name}</p>
          <p className="mt-0.5 inline-flex items-center gap-1.5 text-[11px] font-medium text-white/75">
            <span className={`h-1.5 w-1.5 rounded-full ${paused ? "bg-white/50" : "bg-emerald-400 animate-pulse"}`} />{paused ? "On hold" : "Live"}
            <span className="font-mono tabular-nums text-white/60">{mmss(seconds)}</span>
          </p>
        </div>
        <Select value={lang} onValueChange={onLang}>
          <SelectTrigger aria-label="Language" className="ai-call-pill h-9 w-auto min-w-[92px] gap-1.5 rounded-full px-3 text-xs font-semibold text-white [&>svg]:text-white/70">
            <Languages className="h-3.5 w-3.5 shrink-0 opacity-80" /><SelectValue />
          </SelectTrigger>
          <SelectContent>{langs.map(x => <SelectItem key={x.v} value={x.v}>{x.l}</SelectItem>)}</SelectContent>
        </Select>
        <button type="button" onClick={() => setShowWords(w => !w)} aria-label={showWords ? "Hide the words" : "Show the words"} title={showWords ? "Hide the words" : "Show the words"}
          className={`ai-call-btn h-9 w-9 ${showWords ? "" : "opacity-60"}`}>
          <MessageSquareText className="h-4 w-4" />
        </button>
      </header>

      {/* The orb, what she's doing, the voice line */}
      <div className={`relative z-10 flex flex-col items-center justify-center px-6 transition-all duration-300 ${bigOrb ? "flex-1 py-6" : "pt-3 pb-4"}`}>
        <button type="button" onClick={onTapOrb} aria-label={phase === "speaking" ? "Stop her and speak" : name} className="rounded-full focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-white/30">
          <AgentOrb size={bigOrb ? 196 : 112} state={state} level={level} />
        </button>
        <p className="mt-5 h-5 text-sm font-medium tracking-wide text-white/85 text-center" aria-live="polite">{said}</p>
        <VoiceWave state={state} level={level} className="mt-3 max-w-[300px] !text-white/80" />
      </div>

      {/* The words */}
      {showWords && lines.length > 0 && (
        <div ref={list} className="relative z-10 flex-1 min-h-0 overflow-y-auto px-4 pb-2 space-y-2.5 [mask-image:linear-gradient(to_bottom,transparent,black_18px)]">
          {lines.map(m => m.role === "user"
            ? <div key={m.key} className="flex justify-end pt-1"><div className="max-w-[85%] rounded-2xl rounded-br-md bg-white text-slate-900 px-3.5 py-2 text-sm whitespace-pre-wrap shadow-sm">{m.content}</div></div>
            : <div key={m.key} className="ai-call-bubble max-w-[92%] rounded-2xl rounded-bl-md px-3.5 py-2.5 text-white">{m.content}</div>)}
        </div>
      )}
      {lines.length === 0 && starters.length > 0 && !micBlocked && (
        <div className="relative z-10 px-4 pb-3 flex flex-wrap justify-center gap-2">
          {starters.map(q => <button key={q} type="button" onClick={() => onSend(q)} className="ai-call-pill rounded-full px-3.5 py-2 text-xs font-medium text-white hover:bg-white/20">{q}</button>)}
        </div>
      )}

      {/* Typing, when wanted */}
      {typing && (
        <form className="relative z-10 px-4 pb-1" onSubmit={e => { e.preventDefault(); send(text); }}>
          <div className="ai-call-pill flex items-center gap-2 rounded-2xl pl-4 pr-1.5 py-1.5">
            <input ref={field} value={text} onChange={e => setText(e.target.value)} placeholder="Type a message" aria-label="Type a message"
              className="flex-1 min-w-0 bg-transparent text-sm text-white placeholder:text-white/60 outline-none py-1.5" />
            <button type="submit" disabled={!text.trim()} aria-label="Send" className="h-9 w-9 grid place-items-center rounded-xl bg-white text-slate-900 disabled:opacity-40"><SendHorizontal className="h-4 w-4" /></button>
          </div>
        </form>
      )}

      {/* Controls */}
      <footer className="relative z-10 flex items-center justify-center gap-6 px-4 pt-4 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
        <div className="flex flex-col items-center gap-1.5">
          <button type="button" onClick={() => setTyping(t => !t)} aria-label={typing ? "Hide the keyboard" : "Type instead"} aria-pressed={typing}
            className={`ai-call-btn h-14 w-14 ${typing ? "!bg-white !text-slate-900" : ""}`}><Keyboard className="h-5 w-5" /></button>
          <span className="text-[10px] font-medium text-white/60">Type</span>
        </div>
        <div className="flex flex-col items-center gap-1.5">
          <button type="button" onClick={onEnd} aria-label="End the call" className="h-16 w-16 grid place-items-center rounded-full bg-[#ef4444] text-white shadow-[0_10px_30px_-6px_rgba(239,68,68,0.65)] hover:bg-[#dc2626] active:scale-95 transition">
            <PhoneOff className="h-6 w-6" />
          </button>
          <span className="text-[10px] font-medium text-white/60">End</span>
        </div>
        <div className="flex flex-col items-center gap-1.5">
          <button type="button" onClick={paused ? onResume : onPause} disabled={micBlocked} aria-label={paused ? "Turn the microphone on" : "Pause — microphone off"}
            className={`ai-call-btn h-14 w-14 disabled:opacity-40 ${paused ? "!bg-white !text-slate-900" : ""}`}>
            {paused ? <MicOff className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
          </button>
          <span className="text-[10px] font-medium text-white/60">{paused ? "Muted" : "Mic"}</span>
        </div>
      </footer>
    </section>
  );
}
