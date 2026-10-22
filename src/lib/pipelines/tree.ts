// Changing a pipeline's steps in the builder — insert, move, copy, remove —
// anywhere in its branches. Every change returns new arrays (React state).
// A list of steps is named by where it hangs: "root", or "<stepId>:<way>"
// ("s_ab12:yes", "s_cd34:c0", "s_cd34:other").
import { stepId, type Step } from "@/lib/pure/pipelines";

export const ROOT = "root";

/** A branching step's ways, in the order the canvas shows them. */
export function waysOf(s: Step): { way: string; steps: Step[] }[] {
  if (s.kind === "split" || s.kind === "waitUntil" || s.kind === "ask") return [{ way: "yes", steps: s.yes }, { way: "no", steps: s.no }];
  if (s.kind === "switch") return [...s.cases.map((c, i) => ({ way: `c${i}`, steps: c.steps })), { way: "other", steps: s.other }];
  return [];
}

function withWays(s: Step, f: (way: string, list: Step[]) => Step[]): Step {
  if (s.kind === "split" || s.kind === "waitUntil" || s.kind === "ask") return { ...s, yes: f("yes", s.yes), no: f("no", s.no) };
  if (s.kind === "switch") return { ...s, cases: s.cases.map((c, i) => ({ ...c, steps: f(`c${i}`, c.steps) })), other: f("other", s.other) };
  return s;
}

/** Change one list, wherever it is. */
export function mapList(steps: Step[], key: string, fn: (list: Step[]) => Step[], here = ROOT): Step[] {
  const list = here === key ? fn(steps) : steps;
  return list.map(s => withWays(s, (way, sub) => mapList(sub, key, fn, `${s.id}:${way}`)));
}

/** Put a step into a list at a position. */
export const insertStep = (steps: Step[], key: string, index: number, step: Step) =>
  mapList(steps, key, l => [...l.slice(0, index), step, ...l.slice(index)]);

/** Every list, with its key — to find where a step is. */
function eachList(steps: Step[], fn: (key: string, list: Step[]) => void, here = ROOT) {
  fn(here, steps);
  for (const s of steps) for (const w of waysOf(s)) eachList(w.steps, fn, `${s.id}:${w.way}`);
}
export function whereIs(steps: Step[], id: string): { key: string; index: number } | null {
  let out: { key: string; index: number } | null = null;
  eachList(steps, (key, list) => { const i = list.findIndex(s => s.id === id); if (i >= 0 && !out) out = { key, index: i }; });
  return out;
}
export function findStep(steps: Step[], id: string): Step | null {
  const w = whereIs(steps, id);
  if (!w) return null;
  let found: Step | null = null;
  eachList(steps, (key, list) => { if (key === w.key) found = list[w.index]; });
  return found;
}

/** Replace a step (or remove it, with null). */
export const replaceStep = (steps: Step[], id: string, next: Step | null): Step[] => {
  const w = whereIs(steps, id);
  if (!w) return steps;
  return mapList(steps, w.key, l => l.flatMap(s => (s.id === id ? (next ? [next] : []) : [s])));
};

/** One place earlier (-1) or later (+1) in its own list. */
export function moveStep(steps: Step[], id: string, delta: -1 | 1): Step[] {
  const w = whereIs(steps, id);
  if (!w) return steps;
  return mapList(steps, w.key, l => {
    const j = w.index + delta;
    if (j < 0 || j >= l.length) return l;
    const c = [...l];
    [c[w.index], c[j]] = [c[j], c[w.index]];
    return c;
  });
}

/** A copy with new ids all through (its branches too). */
export function cloneStep(s: Step): Step {
  return withWays({ ...JSON.parse(JSON.stringify(s)), id: stepId() } as Step, (_w, sub) => sub.map(cloneStep));
}
export function duplicateStep(steps: Step[], id: string): Step[] {
  const w = whereIs(steps, id);
  const s = findStep(steps, id);
  return w && s ? insertStep(steps, w.key, w.index + 1, cloneStep(s)) : steps;
}

/** How many steps hang inside a branching step. */
export function innerCount(s: Step): number {
  return waysOf(s).reduce((n, w) => n + w.steps.length + w.steps.reduce((m, x) => m + innerCount(x), 0), 0);
}
