// Smart Pipelines in the app: reading and saving pipelines, reminders and
// questions straight to Firestore — on their own, outside the main sync
// (lib/db.ts), so nothing here can ever ride along with an order or a payment.
// The runs, steps and emails are the server's; the app only reads them.
import {
  collection, deleteDoc, doc, limit, onSnapshot, orderBy, query, setDoc, updateDoc, where, writeBatch, type Unsubscribe,
} from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db as fsdb, functions } from "@/lib/firebase";
import type { Effect, Pipeline, Problem, Run, TrailEntry } from "@/lib/pure/pipelines";

const COL = {
  pipelines: "pipelines", versions: "pipelineVersions", runs: "pipelineRuns", jobs: "pipelineJobs", mail: "pipelineMail",
  state: "pipelineState", asks: "pipelineAsks", marks: "pipelineMarks", reminders: "reminders",
} as const;

/** Firestore refuses `undefined`. */
const plain = <T,>(x: T): T => JSON.parse(JSON.stringify(x));
const warn = (what: string) => (e: unknown) => console.warn(`[autopilot] ${what}:`, (e as { code?: string })?.code ?? e);

export interface RunDoc extends Run { pipelineName: string; subjectId: string }
export interface JobDoc {
  id: string; runId: string; pipelineId: string; pipelineName: string; effect: Effect;
  status: "todo" | "doing" | "done" | "failed"; createdAt: string; doneAt?: string; note?: string; sentTo?: string[]; error?: string; test?: boolean;
}
export interface PipelineSettings { paused?: boolean; quiet?: { from: string; to: string } | null; dailyCap?: number; digestAt?: string; updatedAt?: string; updatedBy?: string }
export interface Reminder {
  id: string; userId: string; authUid?: string; title: string; text: string;
  /** When it pops up (and again after a snooze). */
  showAt: string;
  done: boolean; doneAt?: string;
  source: "autopilot" | "manual";
  repeat?: "none" | "daily" | "weekly";
  pipelineId?: string; pipelineName?: string; runId?: string;
  orderId?: string; orderNumber?: string; clientId?: string;
  createdAt: string; createdBy: string; createdByName?: string; test?: boolean;
}
export interface Ask {
  id: string; runId: string; pipelineId: string; pipelineName: string; stepId: string;
  userIds: string[]; question: string; giveUpAt: string; createdAt: string;
  answer: "yes" | "no" | null; answeredAt?: string; answeredBy?: string; answeredByName?: string;
  closedAt?: string; orderId?: string; orderNumber?: string; test?: boolean;
}
export interface PipelineVersion { id: string; pipelineId: string; version: number; pipeline: Pipeline; savedAt: string; savedBy: string; savedByName?: string }

/* ── Pipelines ── */

export function subscribePipelines(cb: (list: Pipeline[]) => void): Unsubscribe {
  return onSnapshot(collection(fsdb, COL.pipelines),
    s => cb(s.docs.map(d => ({ ...(d.data() as Pipeline), id: d.id })).sort((a, b) => a.name.localeCompare(b.name))),
    warn("pipelines"));
}
export function subscribePipeline(id: string, cb: (p: Pipeline | null) => void): Unsubscribe {
  return onSnapshot(doc(fsdb, COL.pipelines, id), s => cb(s.exists() ? ({ ...(s.data() as Pipeline), id: s.id }) : null), warn("pipeline"));
}

export const newPipelineId = () => `pl_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/**
 * Save — as a new version, kept for good, so a run that started on the old
 * steps finishes on them and any earlier version can be brought back.
 */
export async function savePipeline(p: Pipeline, by: { id: string; name: string }): Promise<Pipeline> {
  const at = new Date().toISOString();
  const next: Pipeline = { ...p, version: (p.version || 0) + 1, updatedAt: at, updatedBy: by.id, createdAt: p.createdAt ?? at };
  const b = writeBatch(fsdb);
  b.set(doc(fsdb, COL.pipelines, next.id), plain(next));
  b.set(doc(fsdb, COL.versions, `${next.id}_v${next.version}`), plain({ id: `${next.id}_v${next.version}`, pipelineId: next.id, version: next.version, pipeline: next, savedAt: at, savedBy: by.id, savedByName: by.name }));
  await b.commit();
  return next;
}
/** On or off — the steps stay as saved. */
export async function setPipelineOn(id: string, on: boolean, by: { id: string }): Promise<void> {
  await updateDoc(doc(fsdb, COL.pipelines, id), { on, updatedAt: new Date().toISOString(), updatedBy: by.id });
}
/** Delete the pipeline. Its runs stop by themselves; its history stays. */
export async function deletePipeline(id: string): Promise<void> {
  await deleteDoc(doc(fsdb, COL.pipelines, id));
}
export function subscribeVersions(pipelineId: string, cb: (list: PipelineVersion[]) => void): Unsubscribe {
  return onSnapshot(query(collection(fsdb, COL.versions), where("pipelineId", "==", pipelineId)),
    s => cb(s.docs.map(d => d.data() as PipelineVersion).sort((a, b) => b.version - a.version)), warn("versions"));
}

/* ── Runs, steps, email ── */

/** The runs of one pipeline (the latest 500), or of all (the latest 300). */
export function subscribeRuns(pipelineId: string | null, cb: (list: RunDoc[]) => void): Unsubscribe {
  const q = pipelineId
    ? query(collection(fsdb, COL.runs), where("pipelineId", "==", pipelineId), limit(500))
    : query(collection(fsdb, COL.runs), orderBy("updatedAt", "desc"), limit(300));
  return onSnapshot(q, s => cb(s.docs.map(d => d.data() as RunDoc).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))), warn("runs"));
}
export function subscribeJobs(pipelineId: string | null, cb: (list: JobDoc[]) => void): Unsubscribe {
  const q = pipelineId
    ? query(collection(fsdb, COL.jobs), where("pipelineId", "==", pipelineId), limit(1500))
    : query(collection(fsdb, COL.jobs), orderBy("createdAt", "desc"), limit(600));
  return onSnapshot(q, s => cb(s.docs.map(d => d.data() as JobDoc)), warn("steps"));
}
/** Emails sent today (India time), against the day's limit. */
export function subscribeMailToday(cb: (n: number) => void): Unsubscribe {
  const day = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
  return onSnapshot(doc(fsdb, COL.state, `mail_${day}`), s => cb((s.data()?.count as number | undefined) ?? 0), warn("mail count"));
}

/* ── Settings ── */

export const DEFAULT_DAILY_CAP = 300;
export function subscribeSettings(cb: (s: PipelineSettings) => void): Unsubscribe {
  return onSnapshot(doc(fsdb, COL.state, "settings"), s => cb((s.data() ?? {}) as PipelineSettings), warn("settings"));
}
export async function saveSettings(s: PipelineSettings, by: { id: string }): Promise<void> {
  await setDoc(doc(fsdb, COL.state, "settings"), plain({ ...s, updatedAt: new Date().toISOString(), updatedBy: by.id }), { merge: true });
}

/* ── Reminders ── */

export function subscribeReminders(userId: string | null, cb: (list: Reminder[]) => void): Unsubscribe {
  const q = userId ? query(collection(fsdb, COL.reminders), where("userId", "==", userId)) : query(collection(fsdb, COL.reminders), orderBy("showAt", "desc"), limit(500));
  return onSnapshot(q, s => cb(s.docs.map(d => ({ ...(d.data() as Reminder), id: d.id })).sort((a, b) => a.showAt.localeCompare(b.showAt))), warn("reminders"));
}
export const newReminderId = () => `rm_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
export async function saveReminder(r: Reminder): Promise<void> {
  await setDoc(doc(fsdb, COL.reminders, r.id), plain(r));
}
export async function deleteReminder(id: string): Promise<void> {
  await deleteDoc(doc(fsdb, COL.reminders, id));
}
/** Done — or, for one that repeats, on to its next time. */
export async function reminderDone(r: Reminder): Promise<void> {
  if (r.repeat === "daily" || r.repeat === "weekly") {
    const step = (r.repeat === "daily" ? 1 : 7) * 864e5;
    let next = +new Date(r.showAt);
    while (next <= Date.now()) next += step;
    await updateDoc(doc(fsdb, COL.reminders, r.id), { showAt: new Date(next).toISOString() });
    return;
  }
  await updateDoc(doc(fsdb, COL.reminders, r.id), { done: true, doneAt: new Date().toISOString() });
}
export async function snoozeReminder(id: string, until: string): Promise<void> {
  await updateDoc(doc(fsdb, COL.reminders, id), { showAt: until, done: false });
}

/* ── Questions ── */

export function subscribeMyAsks(appId: string, cb: (list: Ask[]) => void): Unsubscribe {
  return onSnapshot(query(collection(fsdb, COL.asks), where("userIds", "array-contains", appId)),
    s => cb(s.docs.map(d => ({ ...(d.data() as Ask), id: d.id })).filter(a => !a.answer && !a.closedAt)), warn("questions"));
}
export async function answerAsk(id: string, answer: "yes" | "no", by: { id: string; name: string }): Promise<void> {
  await updateDoc(doc(fsdb, COL.asks, id), { answer, answeredAt: new Date().toISOString(), answeredBy: by.id, answeredByName: by.name });
}

/* ── Labels ── */

export function subscribeMarks(orderId: string, cb: (labels: string[]) => void): Unsubscribe {
  return onSnapshot(doc(fsdb, COL.marks, orderId), s => cb((s.data()?.labels as string[] | undefined) ?? []), warn("labels"));
}

/* ── The server's buttons ── */

export interface TestStep { stepId: string; type: Effect["type"]; wouldReach: string[]; note?: string; sentTo?: string[] }
export interface TestResult { problems: Problem[]; about?: string; onlyHolds?: boolean; trail: TrailEntry[]; steps: TestStep[] }
const testFn = httpsCallable<{ pipeline: Pipeline; orderId?: string; clientId?: string; answer?: "yes" | "no" }, TestResult>(functions, "pipelineTest", { timeout: 120_000 });
const runNowFn = httpsCallable<{ pipelineId: string }, { started: number }>(functions, "pipelineRunNow", { timeout: 300_000 });
export async function testPipeline(p: Pipeline, pick: { orderId?: string; clientId?: string; answer?: "yes" | "no" }): Promise<TestResult> {
  return (await testFn({ pipeline: plain(p), ...pick })).data;
}
export async function runNow(pipelineId: string): Promise<number> {
  return (await runNowFn({ pipelineId })).data.started;
}
