// The two chat sounds — a soft "sent" and a "message in" — made in the browser
// (no sound file to download, nothing stored). Off for this device when its
// person turns them off in Messages.

const OFF_KEY = "sl-chat-sound-off";
let ctx: AudioContext | null = null;
// The sound engine sleeps between sounds: a running one keeps the phone's audio
// hardware on all the time (an iPhone's battery goes on it), just to be ready.
let sleepTimer = 0;
const sleepSoon = (ms = 1500) => { window.clearTimeout(sleepTimer); sleepTimer = window.setTimeout(() => { void ctx?.suspend().catch(() => undefined); }, ms); };

/** Browsers start sound only after a tap: the first tap anywhere wakes it. */
if (typeof window !== "undefined") {
  const wake = () => {
    try {
      ctx ??= new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
      // Unlocked by this tap (browsers ask for one), then straight back to sleep.
      void ctx.resume().then(() => sleepSoon(300), () => undefined);
    } catch { /* no sound on this device */ }
  };
  window.addEventListener("pointerdown", wake, { once: true, capture: true });
  window.addEventListener("keydown", wake, { once: true, capture: true });
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") void ctx?.suspend().catch(() => undefined); });
}

export function chatSoundOn(): boolean {
  try { return localStorage.getItem(OFF_KEY) !== "1"; } catch { return true; }
}
export function setChatSound(on: boolean): void {
  try { if (on) localStorage.removeItem(OFF_KEY); else localStorage.setItem(OFF_KEY, "1"); } catch { /* private mode */ }
}

function tone(notes: { f: number; at: number; len: number }[], volume: number): void {
  if (!ctx || !chatSoundOn()) return;
  const c = ctx;
  // Awake just for this sound.
  void c.resume().then(() => { play(c); sleepSoon(); }, () => undefined);
  function play(ctx: AudioContext) {
    try {
      const t0 = ctx.currentTime;
      for (const n of notes) {
        const o = ctx.createOscillator(), g = ctx.createGain();
        o.type = "sine";
        o.frequency.value = n.f;
        g.gain.setValueAtTime(0, t0 + n.at);
        g.gain.linearRampToValueAtTime(volume, t0 + n.at + 0.012);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + n.at + n.len);
        o.connect(g).connect(ctx.destination);
        o.start(t0 + n.at);
        o.stop(t0 + n.at + n.len + 0.02);
      }
    } catch { /* no sound on this device */ }
  }
}

/** A short rising "pop" as a message goes. */
export const playSent = () => tone([{ f: 660, at: 0, len: 0.09 }, { f: 990, at: 0.05, len: 0.12 }], 0.08);
/** Two soft notes as a message comes in. */
export const playIncoming = () => tone([{ f: 880, at: 0, len: 0.16 }, { f: 1175, at: 0.13, len: 0.24 }], 0.12);
/** Quieter: a message into the conversation already open on screen. */
export const playInChat = () => tone([{ f: 1046, at: 0, len: 0.12 }], 0.06);
