import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { AlertTriangle, CheckCircle2, Copy, FlaskConical, History, Play, Power, Save, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth";
import { confirmBox } from "@/lib/confirm";
import { PageHeader } from "@/components/PageHeader";
import { Input } from "@/components/ui/input";
import { Canvas, type StepCount } from "@/components/autopilot/Canvas";
import { OnlyIfSheet, StepSheet, TriggerSheet } from "@/components/autopilot/Sheets";
import { AddStepDialog, TestSheet, VersionsSheet } from "@/components/autopilot/Extras";
import { usePipelineNames } from "@/components/autopilot/Pickers";
import { checkPipeline, eachStep, type Pipeline, type Step, type StepKind } from "@/lib/pure/pipelines";
import { TEMPLATES } from "@/lib/pipelines/templates";
import { isOrderTrigger, newStep, stepDef, triggerText } from "@/lib/pipelines/words";
import { cloneStep, duplicateStep, findStep, innerCount, insertStep, moveStep, replaceStep } from "@/lib/pipelines/tree";
import {
  deletePipeline, newPipelineId, runNow, savePipeline, setPipelineOn, subscribeJobs, subscribePipeline, subscribeRuns, type JobDoc, type RunDoc,
} from "@/lib/pipelines/client";

const BLANK = (): Pipeline => ({ id: newPipelineId(), name: "New pipeline", on: false, trigger: { kind: "order.placed" }, only: [], steps: [], version: 0 });
/** What a save changes — the rest (on, version, dates) is not "an edit". */
const shape = (p: Pipeline | null | undefined) => (p ? JSON.stringify([p.name, p.trigger, p.only, p.steps, !!p.stopWhenDelivered]) : "");
const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
const istDay = (iso: string) => new Date(iso).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });

/**
 * Autopilot → one pipeline, as a picture to build on. Changes stay a draft
 * until Save; a saved pipeline starts Off, and is switched on only when its
 * health check is clear. "Send a test to me" runs the draft on a real record,
 * reaching only you.
 */
export function AutopilotEditorPage() {
  const { id = "new" } = useParams();
  const [sp] = useSearchParams();
  const nav = useNavigate();
  const { user } = useAuth();
  const names = usePipelineNames();
  const isNew = id === "new";

  const [saved, setSaved] = useState<Pipeline | null | undefined>(isNew ? null : undefined);
  const [draft, setDraft] = useState<Pipeline | null>(() => {
    if (!isNew) return null;
    const t = TEMPLATES.find(x => x.id === sp.get("template"));
    return t ? { ...t.build(), id: newPipelineId(), version: 0, on: false } : BLANK();
  });
  const dirty = shape(draft) !== shape(saved);

  const savedRef = useRef<Pipeline | null>(null);
  useEffect(() => {
    if (isNew) return;
    return subscribePipeline(id, p => {
      const before = savedRef.current;
      savedRef.current = p;
      setSaved(p);
      // A save arrives (someone else's, or switched on/off): the screen follows it — unless it has changes of its own.
      setDraft(d => (!p ? d : !d || d.id !== p.id || shape(d) === shape(before) ? p : d));
    });
  }, [id, isNew]);

  const [runs, setRuns] = useState<RunDoc[]>([]);
  const [jobs, setJobs] = useState<JobDoc[]>([]);
  useEffect(() => (saved ? subscribeRuns(saved.id, setRuns) : undefined), [saved?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => (saved ? subscribeJobs(saved.id, setJobs) : undefined), [saved?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Leaving with unsaved changes: the browser asks first.
  useEffect(() => {
    if (!dirty) return;
    const h = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [dirty]);

  const [openStep, setOpenStep] = useState<string | null>(null);
  const [sheet, setSheet] = useState<"trigger" | "only" | "test" | "versions" | null>(null);
  const [adding, setAdding] = useState<{ key: string; index: number } | null>(null);

  const problems = useMemo(() => (draft ? checkPipeline(draft) : []), [draft]);

  /** What each box has done — from the runs of the pipeline (tests left out). */
  const { counts, started } = useMemo(() => {
    const m = new Map<string, StepCount>();
    const get = (sid: string) => { let c = m.get(sid); if (!c) { c = { done: 0, waiting: 0, failed: 0 }; m.set(sid, c); } return c; };
    let total = 0, todayN = 0;
    const d = today();
    for (const r of runs) {
      if (r.test) continue;
      total++; if (istDay(r.startedAt) === d) todayN++;
      const seen = new Set<string>();
      for (const t of r.trail) if ((t.outcome === "done" || t.outcome === "took" || t.outcome === "answered") && !seen.has(t.stepId)) { seen.add(t.stepId); get(t.stepId).done++; }
      if (r.status === "waiting" || r.status === "asking") {
        const at = [...r.trail].reverse().find(t => t.outcome === "waiting" || t.outcome === "asked");
        if (at) get(at.stepId).waiting++;
      }
    }
    for (const j of jobs) if (j.status === "failed" && !j.test) { const c = get(j.effect.stepId); c.failed++; c.done = Math.max(0, c.done - 1); }
    return { counts: m, started: { total, today: todayN } };
  }, [runs, jobs]);

  if (saved === undefined || !draft) return <div className="p-10 text-center text-muted-foreground">Loading…</div>;
  if (!isNew && saved === null) return <div className="p-10 text-center text-muted-foreground">This pipeline was deleted. <button className="text-primary underline" onClick={() => nav("/autopilot")}>Back to Autopilot</button></div>;

  const by = { id: user!.id, name: user!.name };
  const orderRun = isOrderTrigger(draft.trigger.kind);
  const editing = openStep ? findStep(draft.steps, openStep) : null;
  const setSteps = (steps: Step[]) => setDraft({ ...draft, steps });

  const save = async () => {
    if (!draft.name.trim()) { toast.error("Give it a name"); return; }
    if (saved?.on && problems.length) { toast.error("It's switched on — fix what the check found first, or switch it off"); return; }
    const p = await savePipeline({ ...draft, on: saved?.on ?? false, version: saved?.version ?? 0 }, by);
    savedRef.current = p; setSaved(p); setDraft(p);
    toast.success(p.on ? `Saved — version ${p.version} is live` : `Saved — version ${p.version}`);
    if (isNew) nav(`/autopilot/${p.id}`, { replace: true });
  };
  const toggle = async () => {
    if (!saved) return;
    if (saved.on) {
      if (!(await confirmBox([`Switch off "${saved.name}"?`, "Nothing new starts, and runs waiting in it stop."], { confirmText: "Switch off" }))) return;
      await setPipelineOn(saved.id, false, by);
      toast.success("Switched off");
      return;
    }
    if (problems.length) { toast.error(`Fix ${problems.length === 1 ? "this" : `these ${problems.length}`} first: ${problems[0].text}`); return; }
    const said: string[] = [];
    eachStep(saved.steps, s => { const d = stepDef(s.kind).label; if (!said.includes(d)) said.push(d); });
    if (!(await confirmBox([`Switch on "${saved.name}"?`, `From now on — ${triggerText(saved.trigger).toLowerCase()} — it will: ${said.join(", ")}.`, "Tip: send a test to yourself first."], { confirmText: "Switch on" }))) return;
    await setPipelineOn(saved.id, true, by);
    toast.success("Switched on — it's live");
  };
  const remove = async () => {
    if (!saved) { nav("/autopilot"); return; }
    if (!(await confirmBox([`Delete "${saved.name}"?`, "Runs waiting in it stop. Its history stays."], { danger: true, confirmText: "Delete" }))) return;
    await deletePipeline(saved.id);
    toast.success("Deleted");
    nav("/autopilot");
  };
  const copy = async () => {
    const p = await savePipeline({ ...draft, id: newPipelineId(), name: `${draft.name} (copy)`, on: false, version: 0, createdAt: undefined, steps: draft.steps.map(cloneStep) }, by);
    toast.success("Copied — switched off");
    nav(`/autopilot/${p.id}`);
  };
  const pickStep = (k: StepKind) => {
    if (!adding) return;
    const s = newStep(k, orderRun);
    setSteps(insertStep(draft.steps, adding.key, adding.index, s));
    setAdding(null);
    setOpenStep(s.id);
  };
  const removeStep = async (sid: string) => {
    const s = findStep(draft.steps, sid);
    if (s && innerCount(s) && !(await confirmBox(`Remove this step and the ${innerCount(s)} step${innerCount(s) === 1 ? "" : "s"} inside it?`, { danger: true, confirmText: "Remove" }))) return;
    setSteps(replaceStep(draft.steps, sid, null));
    if (openStep === sid) setOpenStep(null);
  };

  const status = !saved ? { text: "Not saved", tone: "bg-slate-100 text-slate-600" } : saved.on ? { text: "On · live", tone: "bg-emerald-100 text-emerald-800" } : { text: "Off", tone: "bg-slate-100 text-slate-600" };

  return (
    <div className="space-y-4">
      <PageHeader
        back={{ label: "Back to Autopilot", to: "/autopilot" }}
        title={draft.name || "New pipeline"}
        eyebrow={<span className={`inline-flex items-center gap-1.5 h-6 px-2 rounded-full text-[11px] font-semibold ${status.tone}`}>
          {saved?.on && <span className="relative flex h-2 w-2"><span className="absolute inline-flex h-full w-full rounded-full bg-emerald-500 opacity-60 animate-ping" /><span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-600" /></span>}
          {status.text}{dirty && saved ? " · changes not saved" : ""}</span>}
        primary={dirty || !saved
          ? { label: "Save", icon: Save, onClick: () => void save().catch(e => toast.error(e instanceof Error ? e.message : "Not saved")) }
          : { label: saved.on ? "Switch off" : "Switch on", icon: Power, onClick: () => void toggle().catch(e => toast.error(e instanceof Error ? e.message : "That didn't work")) }}
        secondary={{ label: "Test", icon: FlaskConical, onClick: () => setSheet("test") }}
        menu={[
          { label: "Versions", icon: History, onSelect: () => setSheet("versions"), show: !!saved },
          { label: "Run now", icon: Play, hint: "Runs the schedule at once", show: !!saved?.on && draft.trigger.kind === "time.schedule" && !dirty,
            onSelect: async () => { const n = await runNow(saved!.id); toast.success(n ? `Started ${n} run${n === 1 ? "" : "s"}` : "Nothing to do now — nothing new to send"); } },
          { label: "Copy", icon: Copy, onSelect: copy, show: !!saved },
          { label: saved ? "Delete" : "Throw away", icon: Trash2, danger: true, onSelect: remove },
        ]}
      />

      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        <div className="flex-1 min-w-0 max-w-xl">
          <label htmlFor="ap-name" className="sr-only">Name</label>
          <Input id="ap-name" value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} placeholder="Name it" className="rounded-xl h-11 text-[15px] font-semibold bg-white" />
        </div>
        {problems.length
          ? <span className="inline-flex items-center gap-1.5 h-9 px-3 rounded-xl bg-amber-50 text-amber-800 text-[13px] font-medium ring-1 ring-amber-200"><AlertTriangle className="h-4 w-4" />{problems.length} to fix before it can go on</span>
          : <span className="inline-flex items-center gap-1.5 h-9 px-3 rounded-xl bg-emerald-50 text-emerald-800 text-[13px] font-medium ring-1 ring-emerald-200"><CheckCircle2 className="h-4 w-4" />Health check clear</span>}
      </div>

      {!!problems.length && (
        <ul className="rounded-2xl border border-amber-200 bg-amber-50/60 px-4 py-3 text-[13px] text-amber-900 grid gap-1 sm:grid-cols-2">
          {problems.slice(0, 8).map((x, i) => (
            <li key={i}>
              {x.stepId
                ? <button type="button" className="text-left hover:underline" onClick={() => setOpenStep(x.stepId!)}>• {stepDef(findStep(draft.steps, x.stepId)?.kind ?? "email").label}: {x.text}</button>
                : <button type="button" className="text-left hover:underline" onClick={() => setSheet(/only works/.test(x.text) ? "only" : "trigger")}>• {x.text}</button>}
            </li>
          ))}
        </ul>
      )}

      <Canvas p={draft} counts={counts} started={started} problems={problems} selected={openStep} names={names} valueName={names.valueName}
        onOpenTrigger={() => setSheet("trigger")} onOpenOnly={() => setSheet("only")} onOpenStep={setOpenStep}
        onAdd={(key, index) => setAdding({ key, index })}
        onMove={(sid, d) => setSteps(moveStep(draft.steps, sid, d))}
        onCopy={sid => setSteps(duplicateStep(draft.steps, sid))}
        onRemove={sid => void removeStep(sid)} />

      <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
        <span><b className="text-emerald-700">✓</b> done</span><span><b className="text-sky-700">◷</b> waiting there now</span><span><b className="text-rose-700">✕</b> failed</span>
        <span>From the latest {Math.min(500, runs.length) || 0} runs · tests left out</span>
      </p>

      <AddStepDialog open={!!adding} onClose={() => setAdding(null)} onPick={pickStep} orderRun={orderRun} />
      {editing && <StepSheet step={editing} trigger={draft.trigger} problems={problems.filter(x => x.stepId === editing.id)}
        onChange={s => setSteps(replaceStep(draft.steps, s.id, s))} onDelete={() => void removeStep(editing.id)} onClose={() => setOpenStep(null)} />}
      {sheet === "trigger" && <TriggerSheet p={draft} problems={problems.filter(x => !x.stepId && !/only works/.test(x.text))} onChange={setDraft} onClose={() => setSheet(null)} />}
      {sheet === "only" && <OnlyIfSheet p={draft} onChange={setDraft} onClose={() => setSheet(null)} />}
      <TestSheet p={draft} open={sheet === "test"} onClose={() => setSheet(null)} />
      {saved && <VersionsSheet p={saved} open={sheet === "versions"} onClose={() => setSheet(null)}
        onRestore={v => { setDraft({ ...v.pipeline, id: saved.id, version: saved.version, on: saved.on, onSince: saved.onSince }); setSheet(null); toast.success(`Version ${v.version} brought back — Save to use it`); }} />}
    </div>
  );
}
