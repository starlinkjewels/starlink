// The agent's voice in the app: record what the owner says (the browser's own
// recorder), have it heard (functions aiVoice "listen" — the language is found
// by itself), and speak answers aloud in a natural woman's voice (aiVoice
// "speak"), a paragraph at a time so the first words come quickly.
import { useCallback, useEffect, useRef, useState } from "react";
import { httpsCallable } from "firebase/functions";
import { functions } from "@/lib/firebase";

const voiceCall = httpsCallable<
  { action: "listen" | "speak"; audio?: string; mime?: string; text?: string; language?: string; voice?: string; pace?: number },
  { text?: string; language?: string | null; audio?: string; format?: string }
>(functions, "aiVoice", { timeout: 60_000 });

/** The voices offered — natural Indian women's voices; the first is the default. */
export const VOICE_CHOICES = [
  { id: "priya", label: "Priya" }, { id: "neha", label: "Neha" }, { id: "ritu", label: "Ritu" }, { id: "kavya", label: "Kavya" }, { id: "shreya", label: "Shreya" },
];

/** The language to speak an answer in, from its own script: Gujarati, Devanagari (Hindi), else Indian English. */
export function speechLanguage(text: string, heard?: string | null): string {
  const gu = (text.match(/[઀-૿]/g) ?? []).length, dev = (text.match(/[ऀ-ॿ]/g) ?? []).length;
  if (gu > 8 && gu >= dev) return "gu-IN";
  if (dev > 8) return heard === "mr-IN" ? "mr-IN" : "hi-IN";
  return "en-IN";
}

/** An answer as it should be heard: no bold marks, bullets or headings — sentences. */
export function speakable(text: string): string {
  return text
    .replace(/\*\*/g, "")
    .replace(/^#{1,4}\s+/gm, "")
    .replace(/^\s*(?:[-•*]|\d+[.)])\s+/gm, "")
    .replace(/\n{2,}/g, ". ")
    .replace(/\n/g, ". ")
    .replace(/\.\s*\./g, ".")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/** Pieces of at most ~2,000 characters, cut at sentence ends. */
function pieces(text: string, max = 2000): string[] {
  const out: string[] = [];
  let cur = "";
  for (const s of text.split(/(?<=[.!?।])\s+/)) {
    if ((cur + " " + s).length > max && cur) { out.push(cur.trim()); cur = s; } else cur = cur ? `${cur} ${s}` : s;
  }
  if (cur.trim()) out.push(cur.trim());
  return out.flatMap(p => (p.length > max ? p.match(new RegExp(`.{1,${max}}`, "g")) ?? [] : [p]));
}

const toBase64 = (b: Blob) => new Promise<string>((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(String(r.result).split(",")[1] ?? "");
  r.onerror = () => reject(r.error);
  r.readAsDataURL(b);
});

/** What was said, heard by the server. */
export async function hear(blob: Blob): Promise<{ text: string; language: string | null }> {
  const res = (await voiceCall({ action: "listen", audio: await toBase64(blob), mime: blob.type || "audio/webm" })).data;
  return { text: String(res.text ?? "").trim(), language: res.language ?? null };
}

/** Speaks text aloud; stop() ends it at once. Resolves when it has finished (or was stopped). */
export function speak(text: string, opts: { voice: string; pace: number; language?: string; onStart?: () => void }): { done: Promise<void>; stop: () => void } {
  let stopped = false;
  let audio: HTMLAudioElement | null = null;
  const stop = () => { stopped = true; if (audio) { audio.pause(); audio.src = ""; } };
  const done = (async () => {
    const clean = speakable(text);
    const lang = opts.language ?? speechLanguage(clean);
    const parts = pieces(clean);
    // The next piece is fetched while this one plays.
    let next = parts.length ? voiceCall({ action: "speak", text: parts[0], language: lang, voice: opts.voice, pace: opts.pace }) : null;
    for (let i = 0; i < parts.length && !stopped; i++) {
      const res = (await next!).data;
      next = i + 1 < parts.length ? voiceCall({ action: "speak", text: parts[i + 1], language: lang, voice: opts.voice, pace: opts.pace }) : null;
      if (stopped || !res.audio) break;
      audio = new Audio(`data:audio/mpeg;base64,${res.audio}`);
      if (i === 0) opts.onStart?.();
      await new Promise<void>(resolve => { audio!.onended = () => resolve(); audio!.onerror = () => resolve(); void audio!.play().catch(() => resolve()); });
    }
  })();
  return { done, stop };
}

/** The microphone: start, stop → the recording. Stops by itself after `maxSeconds`. */
export function useRecorder(maxSeconds = 55) {
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const rec = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const resolver = useRef<((b: Blob | null) => void) | null>(null);
  const timer = useRef<number | null>(null);
  const cleanup = () => {
    if (timer.current) window.clearInterval(timer.current);
    timer.current = null;
    rec.current?.stream.getTracks().forEach(t => t.stop());
    rec.current = null;
    setRecording(false);
  };
  useEffect(() => () => cleanup(), []); // eslint-disable-line react-hooks/exhaustive-deps

  const start = useCallback(async (): Promise<void> => {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    const type = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"].find(t => typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported?.(t)) ?? "";
    const r = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
    chunks.current = [];
    r.ondataavailable = e => { if (e.data.size) chunks.current.push(e.data); };
    r.onstop = () => {
      const blob = chunks.current.length ? new Blob(chunks.current, { type: (r.mimeType || type || "audio/webm").split(";")[0] }) : null;
      cleanup();
      resolver.current?.(blob);
      resolver.current = null;
    };
    rec.current = r;
    r.start();
    setSeconds(0);
    setRecording(true);
    timer.current = window.setInterval(() => setSeconds(s => {
      if (s + 1 >= maxSeconds) rec.current?.stop();
      return s + 1;
    }), 1000);
  }, [maxSeconds]);

  /** Stop and hand back what was recorded (null when nothing was). */
  const stop = useCallback(() => new Promise<Blob | null>(resolve => {
    if (!rec.current) { resolve(null); return; }
    resolver.current = resolve;
    rec.current.stop();
  }), []);

  return { recording, seconds, start, stop, supported: typeof window !== "undefined" && !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== "undefined" };
}
