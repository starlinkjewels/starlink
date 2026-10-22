import type { KeyboardEvent, ReactNode } from "react";
import { AlertTriangle, ArrowDown, ArrowUp, Check, Clock, Copy, Flag, Pencil, Plus, Trash2, X, type LucideIcon } from "lucide-react";
import { MoreMenu } from "@/components/MoreMenu";
import type { FieldKey, Pipeline, Problem, Step } from "@/lib/pure/pipelines";
import { fieldDef } from "@/lib/pure/pipelines";
import { FILTER_ICON, KIND_NAMES, SCHEDULE_ICON, TRIGGER_ICON, conditionText, stepDef, stepText, triggerText, type Names } from "@/lib/pipelines/words";
import { ROOT, waysOf } from "@/lib/pipelines/tree";

export interface StepCount { done: number; waiting: number; failed: number }

interface Props {
  p: Pipeline;
  counts: Map<string, StepCount>;
  started: { total: number; today: number };
  problems: Problem[];
  selected: string | null;
  names: Names;
  valueName: (field: FieldKey, v: string) => string;
  onOpenTrigger: () => void;
  onOpenOnly: () => void;
  onOpenStep: (id: string) => void;
  onAdd: (listKey: string, index: number) => void;
  onMove: (id: string, delta: -1 | 1) => void;
  onCopy: (id: string) => void;
  onRemove: (id: string) => void;
}

/**
 * The pipeline as a picture: When → Only if → each step, left to right (top to
 * bottom on a phone). A Yes/No, a question or many ways open into lanes; the
 * run carries on after them. Every box shows what it has done: ✓ done,
 * ◌ waiting there now, ✕ failed. Tap a box to change it; tap + to add a step.
 */
export function Canvas(props: Props) {
  const { p, started, problems } = props;
  const general = problems.filter(x => !x.stepId);
  const isSchedule = p.trigger.kind === "time.schedule";
  return (
    <div className="relative rounded-2xl border border-border/70 bg-[#F8FAFC] overflow-auto overscroll-x-contain">
      <div aria-hidden className="absolute inset-0 pointer-events-none [background-image:radial-gradient(#d9dee7_1px,transparent_1px)] [background-size:18px_18px] min-w-full" />
      <div className="relative p-4 sm:p-8 sm:w-max min-h-[340px]">
        <div className="flex flex-col sm:flex-row sm:items-start">
          <NodeCard icon={isSchedule ? SCHEDULE_ICON : TRIGGER_ICON} tone="bg-primary/10 text-primary ring-primary/25" eyebrow="When" title={triggerText(p.trigger)}
            text={started.total ? `${started.total} run${started.total === 1 ? "" : "s"} so far${started.today ? ` · ${started.today} today` : ""}` : "No runs yet"}
            problem={general.some(x => /stage|days|amount|stock|time/i.test(x.text))} onClick={props.onOpenTrigger} strong />
          <Link />
          <NodeCard icon={FILTER_ICON} tone="bg-orange-50 text-orange-600 ring-orange-200" eyebrow="Only if"
            title={p.only.length ? `${p.only.length} check${p.only.length === 1 ? "" : "s"}` : "Every one"}
            text={p.only.length ? p.only.map(c => conditionText(c, props.valueName)).join(" · ") : "No checks — every one starts it"}
            problem={general.some(x => /only works/.test(x.text))} onClick={props.onOpenOnly} />
          <Flow {...props} steps={p.steps} listKey={ROOT} root />
        </div>
      </div>
    </div>
  );
}

function Flow(props: Props & { steps: Step[]; listKey: string; root?: boolean }) {
  const { steps, listKey, root, onAdd } = props;
  if (!steps.length) {
    return (
      <>
        <Link />
        <button type="button" onClick={() => onAdd(listKey, 0)}
          className="shrink-0 w-full sm:w-[236px] h-[76px] rounded-2xl border-2 border-dashed border-slate-300 text-[13px] font-medium text-slate-500 hover:border-primary hover:text-primary hover:bg-primary/5 grid place-items-center">
          <span className="inline-flex items-center gap-1.5"><Plus className="h-4 w-4" />{root ? "Add the first step" : "Add a step"}</span>
        </button>
      </>
    );
  }
  return (
    <>
      {steps.map((s, i) => (
        <div key={s.id} className="contents">
          <Link onAdd={() => onAdd(listKey, i)} />
          <StepItem {...props} step={s} index={i} last={i === steps.length - 1} />
        </div>
      ))}
      <Link onAdd={() => onAdd(listKey, steps.length)} end={!root} />
      {root && <EndCap />}
    </>
  );
}

function StepItem(props: Props & { step: Step; index: number; last: boolean }) {
  const { step: s, counts, problems, selected, names, valueName, index, last } = props;
  const d = stepDef(s.kind);
  const c = counts.get(s.id);
  const mine = problems.filter(x => x.stepId === s.id);
  const ways = waysOf(s);
  const node = (
    <NodeCard icon={d.icon} tone={d.tone} eyebrow={d.group} title={d.label} text={stepText(s, names, valueName)}
      count={c} problem={!!mine.length} problemText={mine[0]?.text} selected={selected === s.id} onClick={() => props.onOpenStep(s.id)}
      menu={<MoreMenu size="sm" label={`Actions for ${d.label}`} actions={[
        { label: "Change", icon: Pencil, onSelect: () => props.onOpenStep(s.id) },
        { label: "Move earlier", icon: ArrowUp, onSelect: () => props.onMove(s.id, -1), disabled: index === 0 },
        { label: "Move later", icon: ArrowDown, onSelect: () => props.onMove(s.id, 1), disabled: last },
        { label: "Copy", icon: Copy, onSelect: () => props.onCopy(s.id) },
        { label: "Remove", icon: Trash2, onSelect: () => props.onRemove(s.id), danger: true },
      ]} />} />
  );
  if (!ways.length) return node;
  return (
    <div className="flex flex-col sm:flex-row sm:items-start shrink-0">
      {node}
      <Link />
      <div className="flex flex-col gap-3 sm:gap-6 border-l-2 border-dashed border-slate-300 pl-3 sm:pl-0 ml-3 sm:ml-0 py-1 sm:py-0">
        {ways.map(w => (
          <div key={w.way} className="flex flex-col sm:flex-row sm:items-start">
            <span aria-hidden className="hidden sm:block w-5 h-0.5 bg-slate-300 mt-[29px] shrink-0" />
            <WayPill s={s} way={w.way} valueName={valueName} />
            <Flow {...props} steps={w.steps} listKey={`${s.id}:${w.way}`} />
          </div>
        ))}
      </div>
    </div>
  );
}

function WayPill({ s, way, valueName }: { s: Step; way: string; valueName: (f: FieldKey, v: string) => string }) {
  let text = way === "yes" ? "Yes" : way === "no" ? "No" : "Other";
  let tone = way === "yes" ? "bg-emerald-50 text-emerald-700 ring-emerald-200" : way === "no" ? "bg-rose-50 text-rose-700 ring-rose-200" : "bg-slate-100 text-slate-600 ring-slate-200";
  if (s.kind === "waitUntil") text = way === "yes" ? "It happened" : "Time ran out";
  if (s.kind === "ask") text = way === "yes" ? "They said Yes" : "No / no answer";
  if (s.kind === "switch" && way.startsWith("c")) {
    const v = s.cases[Number(way.slice(1))]?.value ?? "";
    const f = fieldDef(s.field);
    text = !v ? "Choose…" : f?.type === "yesno" ? (v === "true" ? "Yes" : "No") : s.field === "kind" ? KIND_NAMES[v] ?? v : valueName(s.field, v);
    tone = "bg-sky-50 text-sky-700 ring-sky-200";
  }
  return (
    <span className={`self-start sm:mt-[17px] shrink-0 inline-flex items-center h-6 px-2.5 rounded-full text-[11px] font-semibold ring-1 max-w-[160px] truncate ${tone}`}>{text}</span>
  );
}

/** The line between two boxes, with a + to put a step there. */
function Link({ onAdd, end }: { onAdd?: () => void; end?: boolean }) {
  return (
    <div className={`relative shrink-0 flex items-center justify-center h-9 sm:h-[60px] ${end ? "sm:w-10" : "sm:w-14"} sm:self-start`}>
      <span aria-hidden className={`absolute bg-slate-300 left-1/2 -translate-x-1/2 top-0 bottom-0 w-0.5 sm:translate-x-0 sm:left-0 sm:right-0 sm:top-1/2 sm:bottom-auto sm:h-0.5 sm:w-auto sm:-translate-y-1/2 ${end ? "sm:right-1/2" : ""}`} />
      {onAdd && (
        <button type="button" onClick={onAdd} aria-label="Add a step here" title="Add a step here"
          className="relative z-[1] h-7 w-7 rounded-full bg-white border border-slate-300 grid place-items-center text-slate-500 shadow-sm transition hover:text-primary hover:border-primary hover:scale-110 focus-visible:ring-2 focus-visible:ring-primary">
          <Plus className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}

function EndCap() {
  return (
    <span className="self-center sm:self-start sm:mt-[17px] shrink-0 inline-flex items-center gap-1.5 h-[26px] px-3 rounded-full bg-slate-800 text-white text-[11px] font-semibold">
      <Flag className="h-3 w-3" /> End
    </span>
  );
}

function Pill({ icon: Icon, n, tone, label }: { icon: LucideIcon; n: number; tone: string; label: string }) {
  return <span title={label} aria-label={`${n} ${label}`} className={`inline-flex items-center gap-1 h-6 px-2 rounded-md text-[11px] font-semibold tabular-nums ${tone}`}><Icon className="h-3 w-3" />{n}</span>;
}

function NodeCard({ icon: Icon, tone, eyebrow, title, text, count, problem, problemText, selected, onClick, menu, strong }: {
  icon: LucideIcon; tone: string; eyebrow: string; title: string; text: string; count?: StepCount; problem?: boolean; problemText?: string;
  selected?: boolean; onClick: () => void; menu?: ReactNode; strong?: boolean;
}) {
  const key = (e: KeyboardEvent) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick(); } };
  const any = !!count && (count.done || count.waiting || count.failed);
  return (
    <div role="button" tabIndex={0} onClick={onClick} onKeyDown={key} aria-label={`${eyebrow}: ${title}`}
      className={`group relative shrink-0 w-full sm:w-[236px] rounded-2xl border bg-white p-3 text-left cursor-pointer transition
        shadow-[0_1px_2px_rgb(15_23_42/0.06)] hover:shadow-[0_6px_16px_rgb(15_23_42/0.08)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary
        ${selected ? "border-primary ring-2 ring-primary/30" : problem ? "border-amber-400" : strong ? "border-primary/30" : "border-border hover:border-primary/40"}`}>
      <div className="flex items-center gap-2.5">
        <span className={`h-9 w-9 rounded-xl grid place-items-center ring-1 shrink-0 ${tone}`}><Icon className="h-[18px] w-[18px]" /></span>
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground leading-none">{eyebrow}</p>
          <p className="mt-1 text-[13px] font-semibold text-brand-dark leading-tight line-clamp-2 break-words">{title}</p>
        </div>
        {menu && <span className="shrink-0 -mr-1" onClick={e => e.stopPropagation()} onKeyDown={e => e.stopPropagation()}>{menu}</span>}
      </div>
      <p className="mt-2 text-xs text-muted-foreground leading-snug line-clamp-2 min-h-[2.2em] break-words">{text}</p>
      {(count || problem) && (
        <div className="mt-2.5 flex flex-wrap items-center gap-1">
          {problem && <span title={problemText} className="inline-flex items-center gap-1 h-6 px-2 rounded-md text-[11px] font-semibold bg-amber-100 text-amber-800"><AlertTriangle className="h-3 w-3" />Fix</span>}
          {count && (any ? <>
            {!!count.done && <Pill icon={Check} n={count.done} tone="bg-emerald-50 text-emerald-700" label="done" />}
            {!!count.waiting && <Pill icon={Clock} n={count.waiting} tone="bg-sky-50 text-sky-700" label="waiting here now" />}
            {!!count.failed && <Pill icon={X} n={count.failed} tone="bg-rose-50 text-rose-700" label="failed" />}
          </> : !problem && <span className="text-[11px] text-muted-foreground/80">Not run yet</span>)}
        </div>
      )}
    </div>
  );
}
