import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { AlarmClock, Bot, Clock, Copy, History, Mail, Pause, Play, Plus, Settings2, Timer, Trash2, Workflow, Zap } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth";
import { confirmBox } from "@/lib/confirm";
import { PageHeader, TabBar } from "@/components/PageHeader";
import { SectionTitle } from "@/components/SectionTitle";
import { StatStrip } from "@/components/TableToolbar";
import { DataTable, CellMain, CellTag, type DataColumn } from "@/components/DataTable";
import { AsyncButton } from "@/components/AsyncButton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { TemplateGallery } from "@/components/autopilot/Extras";
import { RemindersManager, fmtWhen } from "@/components/autopilot/Reminders";
import { checkPipeline, MINUTES_SAVED, type Pipeline, type Step, type TrailEntry } from "@/lib/pure/pipelines";
import { stepDef, triggerText } from "@/lib/pipelines/words";
import { cloneStep, findStep } from "@/lib/pipelines/tree";
import {
  DEFAULT_DAILY_CAP, deletePipeline, newPipelineId, savePipeline, saveSettings, setPipelineOn, subscribeJobs, subscribeMailToday, subscribePipelines,
  subscribeRuns, subscribeSettings, type JobDoc, type PipelineSettings, type RunDoc,
} from "@/lib/pipelines/client";

type Tab = "pipelines" | "reminders" | "history" | "settings";
const TABS: { key: Tab; label: string; icon: typeof Workflow }[] = [
  { key: "pipelines", label: "Pipelines", icon: Workflow }, { key: "reminders", label: "Reminders", icon: AlarmClock },
  { key: "history", label: "History", icon: History }, { key: "settings", label: "Settings", icon: Settings2 },
];
const istDay = (iso: string) => new Date(iso).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
const hm = (min: number) => (min >= 60 ? `${Math.floor(min / 60)}h ${min % 60 ? `${min % 60}m` : ""}`.trim() : `${min}m`);

const STATUS: Record<RunDoc["status"], { label: string; tone: "green" | "blue" | "amber" | "red" | "neutral" | "violet" }> = {
  done: { label: "Done", tone: "green" }, running: { label: "Running", tone: "blue" }, waiting: { label: "Waiting", tone: "blue" },
  asking: { label: "Asking", tone: "violet" }, stopped: { label: "Stopped", tone: "neutral" }, failed: { label: "Failed", tone: "red" },
};
const OUTCOME: Record<TrailEntry["outcome"], string> = {
  done: "Done", skipped: "Skipped", waiting: "Waiting", asked: "Asked", answered: "Answered", failed: "Failed", stopped: "Stopped", took: "Went",
};

/**
 * Autopilot — the business's own automations. Pipelines (each a picture of
 * when → only if → steps), the reminders they and people set, the history of
 * every run, and the switches that keep it safe: Pause all, quiet hours, a
 * daily email limit, the digest time.
 */
export function AutopilotPage() {
  const nav = useNavigate();
  const { user } = useAuth();
  const [sp, setSp] = useSearchParams();
  const tab = (TABS.some(t => t.key === sp.get("tab")) ? sp.get("tab") : "pipelines") as Tab;
  const setTab = (t: Tab) => setSp(t === "pipelines" ? {} : { tab: t }, { replace: true });

  const [pipelines, setPipelines] = useState<Pipeline[] | null>(null);
  const [runs, setRuns] = useState<RunDoc[]>([]);
  const [jobs, setJobs] = useState<JobDoc[]>([]);
  const [settings, setSettings] = useState<PipelineSettings>({});
  const [mailToday, setMailToday] = useState(0);
  const [gallery, setGallery] = useState(false);
  const [creatingReminder, setCreatingReminder] = useState(false);
  useEffect(() => subscribePipelines(setPipelines), []);
  useEffect(() => subscribeRuns(null, setRuns), []);
  useEffect(() => subscribeJobs(null, setJobs), []);
  useEffect(() => subscribeSettings(setSettings), []);
  useEffect(() => subscribeMailToday(setMailToday), []);

  const by = { id: user!.id, name: user!.name };
  const list = useMemo(() => pipelines ?? [], [pipelines]);
  const byId = useMemo(() => new Map(list.map(p => [p.id, p])), [list]);
  const today = istDay(new Date().toISOString());
  const month = today.slice(0, 7);
  const real = runs.filter(r => !r.test);
  const runsToday = real.filter(r => istDay(r.startedAt) === today).length;
  const savedMin = jobs.filter(j => j.status === "done" && !j.test && (j.doneAt ?? j.createdAt).slice(0, 7) === month)
    .reduce((s, j) => s + (MINUTES_SAVED[j.effect.type as Step["kind"]] ?? 0) * Math.max(1, j.sentTo?.length ?? 1), 0);
  const cap = settings.dailyCap || DEFAULT_DAILY_CAP;
  const on = list.filter(p => p.on).length;

  const toggle = async (p: Pipeline, v: boolean) => {
    if (v) {
      const probs = checkPipeline(p);
      if (probs.length) { toast.error(`Open it to fix first: ${probs[0].text}`); return; }
      if (!(await confirmBox([`Switch on "${p.name}"?`, triggerText(p.trigger)], { confirmText: "Switch on" }))) return;
    } else if (!(await confirmBox([`Switch off "${p.name}"?`, "Nothing new starts, and runs waiting in it stop."], { confirmText: "Switch off" }))) return;
    await setPipelineOn(p.id, v, by);
    toast.success(v ? "Switched on — it's live" : "Switched off");
  };
  const pause = async () => {
    const v = !settings.paused;
    if (!(await confirmBox(v ? ["Pause all of Autopilot?", "Nothing starts, no step runs and no email goes until you resume. Emails waiting are held, not lost."] : ["Resume Autopilot?", "Pipelines that are on start working again, and held emails go out."], { confirmText: v ? "Pause all" : "Resume" }))) return;
    await saveSettings({ paused: v }, by);
    toast.success(v ? "Autopilot paused" : "Autopilot running");
  };

  const pipeCols: DataColumn<Pipeline>[] = [
    { key: "name", header: "Pipeline", always: true, sortValue: p => p.name, cell: p => <CellMain title={p.name} sub={triggerText(p.trigger)} /> },
    { key: "on", header: "On", align: "center", sortValue: p => (p.on ? 1 : 0), cell: p => <Switch checked={p.on} onCheckedChange={v => void toggle(p, v).catch(e => toast.error(e instanceof Error ? e.message : "That didn't work"))} aria-label={p.on ? "Switch off" : "Switch on"} /> },
    { key: "steps", header: "Steps", align: "right", kind: "number", sortValue: p => p.steps.length, cell: p => p.steps.length },
    { key: "runs", header: "Recent runs", align: "right", kind: "number", sortValue: p => real.filter(r => r.pipelineId === p.id).length, cell: p => real.filter(r => r.pipelineId === p.id).length || "—" },
    { key: "last", header: "Last run", kind: "date", sortValue: p => real.find(r => r.pipelineId === p.id)?.updatedAt ?? "", cell: p => { const r = real.find(x => x.pipelineId === p.id); return r ? fmtWhen(r.updatedAt) : "—"; } },
    { key: "health", header: "Check", sortValue: p => checkPipeline(p).length, cell: p => { const n = checkPipeline(p).length; return n ? <CellTag tone="amber">{n} to fix</CellTag> : <CellTag tone="green">Clear</CellTag>; } },
  ];

  const jobsByRun = useMemo(() => { const m = new Map<string, JobDoc[]>(); for (const j of jobs) m.set(j.runId, [...(m.get(j.runId) ?? []), j]); return m; }, [jobs]);
  const stepName = (r: RunDoc, sid: string) => { const p = byId.get(r.pipelineId); const s = p ? findStep(p.steps, sid) : null; return s ? stepDef(s.kind).label : "A step"; };
  const runCols: DataColumn<RunDoc>[] = [
    { key: "when", header: "When", kind: "date", always: true, sortValue: r => r.updatedAt, cell: r => fmtWhen(r.updatedAt) },
    { key: "pipe", header: "Pipeline", sortValue: r => r.pipelineName, cell: r => <CellMain title={r.pipelineName} sub={r.test ? "Test" : undefined} /> },
    { key: "about", header: "About", sortValue: r => r.subject.label ?? "", cell: r => r.subject.kind === "order" && r.subjectId ? <Link to={`/orders/${r.subjectId}`} className="text-primary hover:underline">{r.subject.label}</Link> : r.subject.label ?? "—" },
    { key: "status", header: "Status", sortValue: r => r.status, cell: r => <CellTag tone={STATUS[r.status].tone}>{STATUS[r.status].label}</CellTag> },
    { key: "note", header: "Note", cell: r => <span className="text-muted-foreground">{r.reason ?? (r.wakeAt && r.status !== "done" ? `Next look ${fmtWhen(r.wakeAt)}` : "")}</span> },
    { key: "fails", header: "Failed steps", align: "right", hideIfEmpty: true, sortValue: r => (jobsByRun.get(r.id) ?? []).filter(j => j.status === "failed").length, cell: r => { const n = (jobsByRun.get(r.id) ?? []).filter(j => j.status === "failed").length; return n ? <CellTag tone="red">{n}</CellTag> : ""; } },
  ];

  return (
    <div className="space-y-5">
      <PageHeader title="Autopilot"
        subtitle={settings.paused ? "Paused — nothing runs" : `${on} on · ${runsToday} run${runsToday === 1 ? "" : "s"} today`}
        info="Pipelines do the everyday chasing for you: email the client, the factory or the CAD team, pop up a reminder, ask the owner, approve small orders. They never touch money, stock, prices or bills."
        primary={tab === "reminders" ? { label: "Remind me", icon: AlarmClock, onClick: () => setCreatingReminder(true) } : { label: "New pipeline", icon: Plus, onClick: () => setGallery(true) }}
        secondary={{ label: settings.paused ? "Resume" : "Pause all", icon: settings.paused ? Play : Pause, onClick: () => void pause().catch(e => toast.error(e instanceof Error ? e.message : "That didn't work")) }}
      />

      {settings.paused && (
        <div className="flex items-center gap-3 rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 text-[13px] text-amber-900">
          <Pause className="h-4 w-4 shrink-0" /><span className="flex-1">Autopilot is paused. Nothing starts and no email goes until you resume.</span>
        </div>
      )}

      <StatStrip items={[
        { label: "Pipelines on", value: `${on} of ${list.length}`, icon: Zap, tone: on ? "strong" : undefined },
        { label: "Runs today", value: String(runsToday), icon: Bot },
        { label: "Emails today", value: `${mailToday} / ${cap}`, icon: Mail, sub: "Daily limit" },
        { label: "Time saved this month", value: savedMin ? hm(savedMin) : "0m", icon: Timer, tone: savedMin ? "in" : undefined, sub: "Work done for you" },
      ]} />

      <TabBar tabs={TABS} value={tab} onChange={setTab} label="Autopilot" />

      {tab === "pipelines" && (
        <DataTable id="ap-pipelines" rows={list} columns={pipeCols} rowKey={p => p.id} noun="pipeline" plural="pipelines" loading={pipelines === null}
          rowHref={p => `/autopilot/${p.id}`} defaultSort={{ key: "name", dir: "asc" }} searchText={p => `${p.name} ${triggerText(p.trigger)}`}
          emptyText={<span>No pipelines yet. <button type="button" className="text-primary font-medium hover:underline" onClick={() => setGallery(true)}>Start from a ready-made one</button></span>}
          rowActions={p => [
            { label: "Open", icon: Workflow, onSelect: () => nav(`/autopilot/${p.id}`) },
            { label: "Copy", icon: Copy, onSelect: async () => { const c = await savePipeline({ ...p, id: newPipelineId(), name: `${p.name} (copy)`, on: false, version: 0, createdAt: undefined, steps: p.steps.map(cloneStep) }, by); toast.success("Copied — switched off"); nav(`/autopilot/${c.id}`); } },
            { label: "Delete", icon: Trash2, danger: true, onSelect: async () => { if (await confirmBox([`Delete "${p.name}"?`, "Runs waiting in it stop. Its history stays."], { danger: true, confirmText: "Delete" })) { await deletePipeline(p.id); toast.success("Deleted"); } } },
          ]} />
      )}

      {tab === "reminders" && <RemindersManager everyone creating={creatingReminder} onCreating={setCreatingReminder} />}

      {tab === "history" && (
        <DataTable id="ap-history" rows={runs} columns={runCols} rowKey={r => r.id} noun="run" plural="runs" defaultSort={{ key: "when", dir: "desc" }}
          searchText={r => `${r.pipelineName} ${r.subject.label ?? ""} ${r.status} ${r.reason ?? ""}`}
          emptyText="No runs yet — they show here as pipelines work"
          expand={{ render: r => (
            <ol className="space-y-1.5 py-1 text-[13px]">
              {r.trail.map((t, i) => {
                const j = (jobsByRun.get(r.id) ?? []).find(x => x.effect.stepId === t.stepId);
                return (
                  <li key={i} className="flex gap-2">
                    <span className="text-muted-foreground tabular-nums shrink-0 w-28">{fmtWhen(t.at)}</span>
                    <span className="min-w-0">
                      <b className="text-brand-dark">{stepName(r, t.stepId)}</b> — {OUTCOME[t.outcome]}{t.note ? `: ${t.note}` : ""}
                      {j?.sentTo?.length ? <span className="text-muted-foreground"> · to {j.sentTo.join(", ")}</span> : null}
                      {j?.note ? <span className="text-muted-foreground"> · {j.note}</span> : null}
                      {j?.status === "failed" ? <span className="text-destructive"> · failed: {j.error}</span> : null}
                    </span>
                  </li>
                );
              })}
              {r.reason && <li className="text-muted-foreground">{r.reason}</li>}
            </ol>
          ) }} />
      )}

      {tab === "settings" && <SettingsCard settings={settings} mailToday={mailToday} by={by} />}

      <TemplateGallery open={gallery} onClose={() => setGallery(false)} onPick={t => { setGallery(false); nav(t ? `/autopilot/new?template=${t.id}` : "/autopilot/new"); }} />
    </div>
  );
}

function SettingsCard({ settings, mailToday, by }: { settings: PipelineSettings; mailToday: number; by: { id: string } }) {
  const [f, setF] = useState({ quietOn: false, from: "21:00", to: "08:00", cap: String(DEFAULT_DAILY_CAP), digestAt: "18:00" });
  const key = JSON.stringify([settings.quiet, settings.dailyCap, settings.digestAt]);
  useEffect(() => {
    setF({ quietOn: !!settings.quiet, from: settings.quiet?.from ?? "21:00", to: settings.quiet?.to ?? "08:00", cap: String(settings.dailyCap || DEFAULT_DAILY_CAP), digestAt: settings.digestAt || "18:00" });
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  const save = async () => {
    const cap = Math.round(Number(f.cap));
    if (!(cap >= 1 && cap <= 2000)) { toast.error("The daily limit is between 1 and 2000"); return; }
    if (f.quietOn && f.from === f.to) { toast.error("Quiet hours need a start and an end"); return; }
    await saveSettings({ quiet: f.quietOn ? { from: f.from, to: f.to } : null, dailyCap: cap, digestAt: f.digestAt || "18:00" }, by);
    toast.success("Saved");
  };
  return (
    <div className="rounded-2xl border border-border/70 bg-white p-5 space-y-6 max-w-3xl">
      <SectionTitle title="Email" sub={`${mailToday} sent today`} icon={Mail} />
      <label className="flex items-center justify-between gap-4 cursor-pointer">
        <span><span className="block text-sm font-semibold text-brand-dark">Quiet hours</span><span className="block text-xs text-muted-foreground">Email due then waits until they end (India time). Popups and alerts are not held.</span></span>
        <Switch checked={f.quietOn} onCheckedChange={v => setF({ ...f, quietOn: v })} />
      </label>
      {f.quietOn && (
        <div className="grid grid-cols-2 gap-3 max-w-sm">
          <div className="space-y-1.5"><Label htmlFor="ap-qf" className="text-xs">From</Label><Input id="ap-qf" type="time" value={f.from} onChange={e => setF({ ...f, from: e.target.value })} className="rounded-xl h-10" /></div>
          <div className="space-y-1.5"><Label htmlFor="ap-qt" className="text-xs">Until</Label><Input id="ap-qt" type="time" value={f.to} onChange={e => setF({ ...f, to: e.target.value })} className="rounded-xl h-10" /></div>
        </div>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="ap-cap" className="text-xs font-semibold">Most emails a day</Label>
          <Input id="ap-cap" type="number" min={1} max={2000} value={f.cap} onChange={e => setF({ ...f, cap: e.target.value })} className="rounded-xl h-10" />
          <p className="text-[11px] text-muted-foreground">Gmail allows about 500 a day — leave room for the app's own emails. Over it, email waits for tomorrow.</p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="ap-dg" className="text-xs font-semibold">Daily digest at</Label>
          <Input id="ap-dg" type="time" value={f.digestAt} onChange={e => setF({ ...f, digestAt: e.target.value })} className="rounded-xl h-10" />
          <p className="text-[11px] text-muted-foreground">Emails set to “In the daily digest” go out together, one per person.</p>
        </div>
      </div>
      <div className="flex items-center justify-between gap-3 border-t border-border/60 pt-4">
        <p className="text-xs text-muted-foreground inline-flex items-center gap-1.5"><Clock className="h-3.5 w-3.5" /> Autopilot looks every 10 minutes; order changes start at once.</p>
        <AsyncButton onClick={save} className="btn-hero rounded-xl px-6">Save</AsyncButton>
      </div>
    </div>
  );
}
