// A voice CALL with the agent: the microphone stays open for the whole call and
// the app hears by itself when the owner starts and stops speaking (the level of
// the sound against the room's own noise) — no button to press. What was said
// goes to be heard (voice.ts hear), the answer is spoken, then it listens again.
// Speaking over the agent stops her and is heard at once ("barge in"); pause
// mutes the microphone; end closes it. Nothing is recorded or kept: each thing
// said is sent once to be heard, then dropped.
import { useCallback, useEffect, useRef, useState } from "react";

export type CallPhase = "off" | "starting" | "listening" | "hearing" | "thinking" | "speaking" | "paused";

const TICK = 50;            // ms between level readings
const START_MS = 160;       // this long above the speaking level = speech has started
const END_SILENCE_MS = 1100; // this long quiet after speech = they've finished
const MAX_UTTER_MS = 28_000; // one thing said is at most this long (the server takes about a minute)
const IDLE_RESTART_MS = 12_000; // waiting in silence: the recording starts afresh, so it never grows
const BARGE_MS = 340;       // speaking this long over the agent stops her

export function useVoiceCall(opts: {
  /** Something was said: the recording of it. */
  onUtterance: (blob: Blob) => void;
  /** The owner spoke over the agent — stop her. */
  onBargeIn: () => void;
}) {
  const [phase, setPhaseState] = useState<CallPhase>("off");
  const [seconds, setSeconds] = useState(0);
  /** 0…1, the loudness now — read by the orb and the wave every frame (no re-render). */
  const level = useRef(0);
  const phaseRef = useRef<CallPhase>("off");
  const cb = useRef(opts);
  cb.current = opts;

  const stream = useRef<MediaStream | null>(null);
  const ctx = useRef<AudioContext | null>(null);
  const analyser = useRef<AnalyserNode | null>(null);
  const buf = useRef<Float32Array | null>(null);
  const rec = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const ticker = useRef<number | null>(null);
  const clock = useRef<number | null>(null);
  const vad = useRef({ noise: 0.006, above: 0, speech: false, speechMs: 0, quiet: 0, recAt: 0, barge: 0 });

  const setPhase = (p: CallPhase) => { phaseRef.current = p; setPhaseState(p); };

  const mime = () => ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"]
    .find(t => typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported?.(t)) ?? "";

  /** A fresh recording, from now. `keep`: what came before is dropped. */
  const record = () => {
    const s = stream.current;
    if (!s) return;
    if (rec.current && rec.current.state !== "inactive") { rec.current.ondataavailable = null; rec.current.onstop = null; try { rec.current.stop(); } catch { /* already stopped */ } }
    const type = mime();
    const r = new MediaRecorder(s, type ? { mimeType: type } : undefined);
    chunks.current = [];
    r.ondataavailable = e => { if (e.data.size) chunks.current.push(e.data); };
    r.start(250);
    rec.current = r;
    vad.current.recAt = Date.now();
  };
  const dropRecording = () => {
    const r = rec.current;
    rec.current = null;
    if (r && r.state !== "inactive") { r.ondataavailable = null; r.onstop = null; try { r.stop(); } catch { /* already stopped */ } }
    chunks.current = [];
  };

  /** They stopped speaking: hand over what they said. */
  const finish = () => {
    const r = rec.current;
    const v = vad.current;
    const long = v.speechMs;
    v.speech = false; v.speechMs = 0; v.quiet = 0; v.above = 0;
    if (!r) return;
    setPhase("hearing");
    r.onstop = () => {
      const type = (r.mimeType || mime() || "audio/webm").split(";")[0];
      const blob = chunks.current.length ? new Blob(chunks.current, { type }) : null;
      chunks.current = [];
      rec.current = null;
      // A cough or a click isn't a question: listen on.
      if (!blob || blob.size < 1200 || long < 350) { listen(); return; }
      cb.current.onUtterance(blob);
    };
    try { r.stop(); } catch { listen(); }
  };

  const tick = () => {
    const a = analyser.current, b = buf.current;
    if (!a || !b) return;
    a.getFloatTimeDomainData(b as Float32Array<ArrayBuffer>);
    let sum = 0;
    for (let i = 0; i < b.length; i++) sum += b[i] * b[i];
    const rms = Math.sqrt(sum / b.length);
    const v = vad.current;
    const p = phaseRef.current;
    // The room's own noise, learnt while nobody is speaking.
    if (!v.speech && p !== "speaking") v.noise = Math.max(0.003, Math.min(0.05, v.noise * 0.96 + rms * 0.04));
    const startAt = Math.max(0.02, v.noise * 3.2);
    const quietAt = Math.max(0.013, v.noise * 2);
    level.current = p === "paused" ? 0 : Math.min(1, level.current * 0.55 + Math.min(1, rms / Math.max(0.08, startAt * 3)) * 0.45);

    if (p === "listening") {
      if (!v.speech) {
        v.above = rms > startAt ? v.above + TICK : Math.max(0, v.above - TICK / 2);
        if (v.above >= START_MS) { v.speech = true; v.speechMs = v.above; v.quiet = 0; }
        else if (Date.now() - v.recAt > IDLE_RESTART_MS) record();
      } else {
        v.speechMs += TICK;
        v.quiet = rms < quietAt ? v.quiet + TICK : 0;
        if (v.quiet >= END_SILENCE_MS || v.speechMs >= MAX_UTTER_MS) finish();
      }
    } else if (p === "speaking") {
      // Over the agent's own voice (the browser takes its echo out): only clear, held speech counts.
      v.barge = rms > Math.max(0.06, v.noise * 6) ? v.barge + TICK : Math.max(0, v.barge - TICK);
      if (v.barge >= BARGE_MS) {
        v.barge = 0;
        cb.current.onBargeIn();
        setPhase("listening");
        record();
        v.speech = true; v.speechMs = BARGE_MS; v.quiet = 0;
      }
    }
  };

  /** Listen (again): after an answer, or on resume. Nothing changes if already listening. */
  const listen = useCallback(() => {
    if (!stream.current) return;
    const p = phaseRef.current;
    if (p === "listening" || p === "paused" || p === "off") return;
    const v = vad.current;
    v.speech = false; v.speechMs = 0; v.quiet = 0; v.above = 0; v.barge = 0;
    setPhase("listening");
    record();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /** Working on it: "hearing", "thinking" or "speaking" — the microphone waits (only a barge-in counts). */
  const busy = useCallback((p: "hearing" | "thinking" | "speaking") => {
    if (phaseRef.current === "off" || phaseRef.current === "paused") return;
    if (rec.current) dropRecording();
    vad.current.barge = 0;
    setPhase(p);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const stopAll = () => {
    if (ticker.current) window.clearInterval(ticker.current);
    if (clock.current) window.clearInterval(clock.current);
    ticker.current = null; clock.current = null;
    dropRecording();
    stream.current?.getTracks().forEach(t => t.stop());
    stream.current = null;
    void ctx.current?.close().catch(() => {});
    ctx.current = null; analyser.current = null; buf.current = null;
    level.current = 0;
  };

  /** Open the microphone and start listening. Throws when the microphone isn't allowed. */
  const start = useCallback(async () => {
    if (phaseRef.current !== "off") return;
    setPhase("starting");
    setSeconds(0);
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      stream.current = s;
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const c = new AC();
      const an = c.createAnalyser();
      an.fftSize = 1024;
      c.createMediaStreamSource(s).connect(an);
      ctx.current = c; analyser.current = an; buf.current = new Float32Array(an.fftSize);
      vad.current = { noise: 0.006, above: 0, speech: false, speechMs: 0, quiet: 0, recAt: 0, barge: 0 };
      ticker.current = window.setInterval(tick, TICK);
      clock.current = window.setInterval(() => setSeconds(x => x + 1), 1000);
      setPhase("listening");
      record();
    } catch (e) {
      stopAll();
      setPhase("off");
      throw e;
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const pause = useCallback(() => {
    if (phaseRef.current === "off") return;
    dropRecording();
    vad.current.speech = false;
    setPhase("paused");
  }, []);
  const resume = useCallback(() => {
    if (phaseRef.current !== "paused") return;
    setPhase("hearing"); // so listen() takes it up
    listen();
  }, [listen]);

  const end = useCallback(() => { stopAll(); setPhase("off"); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => stopAll(), []); // eslint-disable-line react-hooks/exhaustive-deps

  const supported = typeof window !== "undefined" && !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== "undefined";
  return { phase, seconds, level, start, end, pause, resume, listen, busy, supported };
}
