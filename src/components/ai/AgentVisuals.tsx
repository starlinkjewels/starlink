// The agent's face: a living orb in the business's own colour (it follows the
// brand — Settings → Brand), and a voice line under it. Both read the sound level
// straight from a ref every frame, so a call never re-renders the page to animate.
// "Calm motion" (Settings) and the system's reduce-motion setting keep them still.
import { useEffect, useRef, type MutableRefObject } from "react";
import type { CallPhase } from "@/lib/aiOffice/voiceCall";

export type OrbState = "idle" | "listening" | "hearing" | "thinking" | "speaking" | "paused";

export const orbStateOf = (p: CallPhase): OrbState =>
  p === "off" || p === "starting" ? "idle" : p;

/** The orb. `level`: 0…1, read every frame (the microphone while listening). */
export function AgentOrb({ size = 120, state = "idle", level, className = "" }: {
  size?: number; state?: OrbState; level?: MutableRefObject<number>; className?: string;
}) {
  const el = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!level) return;
    let raf = 0;
    const loop = () => {
      el.current?.style.setProperty("--lvl", String(state === "listening" ? level.current : 0));
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [level, state]);
  return (
    <div ref={el} className={`ai-orb ${className}`} data-state={state} style={{ width: size, height: size }} aria-hidden>
      <div className="ai-orb-glow" />
      <div className="ai-orb-core" />
      <div className="ai-orb-sheen" />
    </div>
  );
}

/** The voice line: a row of dots that rises with the voice — the owner's while
 *  listening, the agent's while she speaks — and lies flat while quiet. */
export function VoiceWave({ state, level, dots = 46, className = "" }: {
  state: OrbState; level: MutableRefObject<number>; dots?: number; className?: string;
}) {
  const svg = useRef<SVGSVGElement>(null);
  useEffect(() => {
    let raf = 0;
    const start = performance.now();
    const loop = (now: number) => {
      const t = (now - start) / 1000;
      const amp = state === "listening" ? level.current * 13
        : state === "speaking" ? 5 + Math.sin(t * 5.3) * 2.5 + Math.sin(t * 8.1) * 1.5
        : state === "thinking" || state === "hearing" ? 2.2 : 0;
      const circles = svg.current?.children;
      if (circles) {
        for (let i = 0; i < circles.length; i++) {
          // Strongest in the middle, still at the ends.
          const env = Math.sin(Math.PI * (i + 0.5) / circles.length);
          const wave = state === "thinking" || state === "hearing"
            ? Math.sin(t * 6 - i * 0.45)
            : Math.sin(t * 9 + i * 0.62) * 0.6 + Math.sin(t * 4.3 - i * 0.31) * 0.4;
          (circles[i] as SVGCircleElement).setAttribute("cy", String(16 + wave * amp * env));
        }
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [state, level]);
  const w = dots * 8;
  return (
    <svg ref={svg} viewBox={`0 0 ${w} 32`} className={`ai-wave text-primary ${className}`} aria-hidden>
      {Array.from({ length: dots }, (_, i) => <circle key={i} cx={i * 8 + 4} cy={16} r={1.6} fill="currentColor" opacity={state === "paused" ? 0.25 : 0.85} />)}
    </svg>
  );
}
