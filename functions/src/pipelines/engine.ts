/**
 * Smart Pipelines — the server side. The rules themselves (what an event is,
 * whether a filter holds, where a run goes next) are in ../shared/pipelines,
 * the same file the app uses; this file reads the records those rules need,
 * keeps the runs, and does what the runs ask for.
 *
 * What keeps it safe on a business with real data:
 *   • Never twice. A run's id comes from the pipeline, the record and the
 *     event, and is created only if it does not exist — so the same approval,
 *     seen twice, starts one run. Each step a run takes becomes a job whose id
 *     is the run and the step, done at most once; an email is claimed before
 *     it is sent and never sent again.
 *   • Its own records only. It writes pipelineRuns, pipelineJobs, pipelineMail,
 *     pipelineAsks, pipelineMarks, reminders, notifications and tasks. The one
 *     exception is an order's approval and its salesperson, each done in a
 *     transaction exactly as the app's own button does it, only when the order
 *     still allows it, and written to the activity log as "Autopilot".
 *     No payment, stock, price, invoice or dispatch is ever touched.
 *   • A test reaches only the tester: their own email, their own popup;
 *     approving, assigning, tasks, labels and questions are described, not done.
 *   • Pause all stops everything at once; quiet hours hold email; a daily cap
 *     keeps the mailbox under its limit.
 */
import { createHash } from "crypto";
import { FieldValue } from "firebase-admin/firestore";
import { db } from "../lib/firestoreAdmin";
import { closeMail, deliverMail } from "../mail";
import { BRAND, DEFAULT_DAILY_CAP } from "./config";
import { blocksHtml, emailHtml, esc } from "./email";
import {
  advance, afterQuiet, allHold, approveOrderTimeline, balanceOf, checkPipeline, eachStep, eventMatches, fieldValue, fmtDay,
  isClosed, isDelivered, isDispatched, localParts, orderEvents, scheduleDue, stageSince, stepAt,
  type ClientLike, type Ctx, type Effect, type FactoryLike, type ListSpec, type OrderLike, type PersonLike, type Pipeline,
  type Problem, type Recipient, type Run, type RunStatus, type TimelineStepLike, type Trigger, type TrailEntry,
} from "../shared/pipelines";

export const C = {
  pipelines: "pipelines", versions: "pipelineVersions", runs: "pipelineRuns", jobs: "pipelineJobs", mail: "pipelineMail",
  state: "pipelineState", asks: "pipelineAsks", marks: "pipelineMarks", reminders: "reminders",
} as const;

const DAY = 864e5;
const ACTIVE = new Set<RunStatus>(["running", "waiting", "asking"]);
const nowIso = () => new Date().toISOString();
/** Firestore refuses `undefined`; a run is plain data, so a JSON round trip drops it. */
const plain = <T>(x: T): T => JSON.parse(JSON.stringify(x));
export const hash = (s: string) => createHash("sha1").update(s).digest("hex").slice(0, 24);
const errText = (e: unknown) => String((e as Error)?.message ?? e).slice(0, 500);

/* ════════════════════════════ What is stored ════════════════════════════ */

/** A run, as kept — the rules' Run plus what the server needs to pick it up again. */
export interface RunDoc extends Run {
  pipelineName: string;
  /** The record's id, for "every run about this order". */
  subjectId: string;
  each?: Ctx["each"];
  stock?: Ctx["stock"];
  invoice?: Ctx["invoice"];
  clientBalance?: number;
  listSpec?: ListSpec;
  testerUid?: string; testerAppId?: string; testerEmail?: string;
}
export interface JobDoc {
  id: string; runId: string; pipelineId: string; pipelineName: string; version: number;
  effect: Effect; status: "todo" | "doing" | "done" | "failed"; createdAt: string; test?: boolean;
  note?: string; sentTo?: string[]; error?: string;
  /** Approve / assign: when to look again that the change is still there, and what it should be. */
  verifyAt?: string; expect?: { status?: "approved"; assignedEmployeeId?: string };
  busyTries?: number;
}

/** The order was saved moments ago — try the step again later rather than change it under someone. */
class Busy extends Error {}
interface MailDoc {
  id: string; to: string; subject: string; html?: string; section?: string;
  status: "queued" | "sending" | "sent" | "failed" | "digest" | "digested";
  sendAt?: string; createdAt: string; runId?: string; pipelineId?: string; pipelineName?: string; stepId?: string; test?: boolean;
}
export interface PipelineSettings {
  paused?: boolean;
  /** Email due in these hours (India time) waits until they end. */
  quiet?: { from: string; to: string } | null;
  dailyCap?: number;
  /** When the daily digest goes out, "18:00". */
  digestAt?: string;
}

/* ════════════════════════════ Reading ════════════════════════════ */

async function one<T>(col: string, id: string | undefined): Promise<T | undefined> {
  if (!id) return undefined;
  const s = await db.collection(col).doc(id).get();
  return s.exists ? ({ ...(s.data() as object), id: s.id } as T) : undefined;
}

export async function loadSettings(): Promise<PipelineSettings> {
  return ((await db.collection(C.state).doc("settings").get()).data() ?? {}) as PipelineSettings;
}

/** Our own people (admins and employees), kept for a minute. */
let peopleMemo: { at: number; list: PersonLike[] } | null = null;
export async function people(): Promise<PersonLike[]> {
  if (peopleMemo && Date.now() - peopleMemo.at < 60_000) return peopleMemo.list;
  const snap = await db.collection("users").where("role", "in", ["admin", "employee"]).get();
  const list = snap.docs.map(d => ({ ...(d.data() as PersonLike), id: (d.data().id as string) || d.id }));
  peopleMemo = { at: Date.now(), list };
  return list;
}
const active = (u: PersonLike) => u.status !== "inactive";
/** Mirrors salesStaff() in lib/clientHandlers.ts: the Sales department, or every employee when nobody is marked. */
function salesStaff(ppl: PersonLike[]): PersonLike[] {
  const emps = ppl.filter(u => u.role === "employee");
  const sales = emps.filter(u => /sales/i.test(u.department ?? ""));
  return (sales.length ? sales : emps).filter(active);
}

/** Pipelines switched on — read fresh every time, so one switched on a moment ago is never missed. */
export async function livePipelines(): Promise<Pipeline[]> {
  const snap = await db.collection(C.pipelines).where("on", "==", true).get();
  return snap.docs.map(d => ({ ...(d.data() as Pipeline), id: d.id }));
}

/** The pipeline a run follows — the version it started on — or why it can't go on. */
async function pipelineForRun(run: RunDoc): Promise<Pipeline | string> {
  const p = await one<Pipeline>(C.pipelines, run.pipelineId);
  if (!p) return "The pipeline was deleted";
  if (!p.on && !run.test) return "The pipeline was switched off";
  if (p.version === run.version) return p;
  const v = await db.collection(C.versions).doc(`${run.pipelineId}_v${run.version}`).get();
  const old = v.data()?.pipeline as Pipeline | undefined;
  return old ? { ...old, id: run.pipelineId, on: true } : "The pipeline was changed while this run waited";
}

const handlerFor = (o: OrderLike | undefined, cl: ClientLike | undefined, ppl: PersonLike[]) =>
  (o?.assignedEmployeeId ? ppl.find(u => u.id === o.assignedEmployeeId) : undefined)
  ?? (cl?.accountManagerId ? ppl.find(u => u.id === cl.accountManagerId) : undefined);

/**
 * An order nobody has saved for this long is "settled": approve and assign wait
 * for it, because a screen saves an order whole from its own copy, and a save
 * still on its way would undo a change made under it.
 */
export const SETTLE_MS = 2 * 6e4;
const settled = (savedAt: string | undefined, now: string) => (savedAt ? +new Date(now) - +new Date(savedAt) >= SETTLE_MS : undefined);

/** An order, with when it was last saved (Firestore's own time). */
async function orderDoc(id: string | undefined): Promise<{ o: OrderLike; savedAt: string } | undefined> {
  if (!id) return undefined;
  const s = await db.collection("orders").doc(id).get();
  return s.exists ? { o: { ...(s.data() as OrderLike), id: s.id }, savedAt: s.updateTime!.toDate().toISOString() } : undefined;
}

export async function orderCtx(o: OrderLike, now: string, savedAt?: string): Promise<Ctx> {
  const [client, factory, ppl, marks] = await Promise.all([
    one<ClientLike>("clients", o.clientId), one<FactoryLike>("factories", o.assignedFactoryId), people(),
    one<{ labels?: string[] }>(C.marks, o.id),
  ]);
  return { now, order: o, client, factory, handler: handlerFor(o, client, ppl), labels: marks?.labels ?? [], brandName: BRAND.name, orderSettled: settled(savedAt, now) };
}

async function clientCtx(cl: ClientLike, now: string, extra: Partial<Ctx> = {}): Promise<Ctx> {
  return { now, client: cl, handler: handlerFor(undefined, cl, await people()), brandName: BRAND.name, ...extra };
}

/* ── Everything at once, for the regular checks and the scheduled lists ── */

export interface World {
  now: string; orders: OrderLike[]; clients: Map<string, ClientLike>; factories: Map<string, FactoryLike>;
  people: PersonLike[]; marks: Map<string, string[]>;
  /** When each order was last saved. */
  savedAt: Map<string, string>;
}
let worldMemo: { at: number; w: World } | null = null;
export async function world(now = nowIso()): Promise<World> {
  if (worldMemo && Date.now() - worldMemo.at < 60_000) return { ...worldMemo.w, now };
  const [o, c, f, m, ppl] = await Promise.all([
    db.collection("orders").get(), db.collection("clients").get(), db.collection("factories").get(), db.collection(C.marks).get(), people(),
  ]);
  const w: World = {
    now,
    orders: o.docs.map(d => ({ ...(d.data() as OrderLike), id: d.id })),
    clients: new Map(c.docs.map(d => [d.id, { ...(d.data() as ClientLike), id: d.id }])),
    factories: new Map(f.docs.map(d => [d.id, { ...(d.data() as FactoryLike), id: d.id }])),
    people: ppl,
    marks: new Map(m.docs.map(d => [d.id, (d.data().labels as string[]) ?? []])),
    savedAt: new Map(o.docs.map(d => [d.id, d.updateTime.toDate().toISOString()])),
  };
  worldMemo = { at: Date.now(), w };
  return w;
}
function worldCtx(w: World, o: OrderLike): Ctx {
  const client = w.clients.get(o.clientId);
  return {
    now: w.now, order: o, client, factory: o.assignedFactoryId ? w.factories.get(o.assignedFactoryId) : undefined,
    handler: handlerFor(o, client, w.people), labels: w.marks.get(o.id) ?? [], brandName: BRAND.name,
    orderSettled: settled(w.savedAt.get(o.id), w.now),
  };
}

/** The orders a list block shows: for one factory, salesperson or client (or all), the ones it asks for. */
export function listFor(w: World, each: Ctx["each"] | undefined, spec: ListSpec): OrderLike[] {
  let list = w.orders.filter(o => !isClosed(o));
  if (each?.kind === "factory") list = list.filter(o => o.assignedFactoryId === each.id);
  if (each?.kind === "salesperson") list = list.filter(o => o.assignedEmployeeId === each.id || w.clients.get(o.clientId)?.accountManagerId === each.id);
  if (each?.kind === "client") list = list.filter(o => o.clientId === each.id);
  const toDue = (o: OrderLike) => fieldValue("daysToDue", { now: w.now, order: o, brandName: "" }) as number | undefined;
  const today = localParts(w.now).date;
  switch (spec.which) {
    case "open": list = list.filter(o => !isDispatched(o)); break;
    case "late": list = list.filter(o => !isDispatched(o) && (toDue(o) ?? 0) < 0); break;
    case "dueSoon": list = list.filter(o => { const d = toDue(o); return !isDispatched(o) && d !== undefined && d >= 0 && d <= (spec.days ?? 7); }); break;
    case "unpaid": list = list.filter(o => isDispatched(o) && balanceOf(o) > 0); break;
    case "newToday": list = list.filter(o => !!o.createdAt && localParts(o.createdAt).date === today); break;
  }
  return list.sort((a, b) => (a.expectedDelivery ?? "9").localeCompare(b.expectedDelivery ?? "9"));
}

/** Who a schedule that runs "for each" runs for. */
function eachOf(w: World, kind: NonNullable<Trigger["forEach"]>): NonNullable<Ctx["each"]>[] {
  if (kind === "factory") return [...w.factories.values()].filter(f => f.active !== false).map(f => ({ kind: "factory", id: f.id, name: f.contactPerson || f.name, email: f.email }));
  if (kind === "salesperson") return salesStaff(w.people).map(u => ({ kind: "salesperson", id: u.id, name: u.name, email: u.email }));
  if (kind === "admin") return w.people.filter(u => u.role === "admin" && active(u)).map(u => ({ kind: "admin", id: u.id, name: u.name, email: u.email }));
  if (kind === "client") return [...w.clients.values()].filter(c => c.status !== "inactive").map(c => ({ kind: "client", id: c.id, name: c.ownerName || c.companyName, email: c.email }));
  return [];
}

/** The list a pipeline's emails ask for (the first one named), for {count}. */
function listSpecOf(p: Pipeline): ListSpec | undefined {
  let spec: ListSpec | undefined;
  eachStep(p.steps, s => { if (!spec && s.kind === "email" && (s.blocks ?? []).includes("list")) spec = s.list ?? { which: "open" }; });
  return spec;
}

/** Everything one stored run can see, read again now. */
async function ctxForRun(run: RunDoc, now = nowIso()): Promise<Ctx | undefined> {
  const s = run.subject;
  if (s.kind === "order") {
    const d = await orderDoc(s.id);
    if (!d) return undefined;
    const c = await orderCtx(d.o, now, d.savedAt);
    if (run.invoice) c.invoice = run.invoice;
    return c;
  }
  if (s.kind === "client") {
    const cl = await one<ClientLike>("clients", s.id);
    return cl ? clientCtx(cl, now, { clientBalance: run.clientBalance }) : undefined;
  }
  if (s.kind === "stock") return { now, stock: run.stock, brandName: BRAND.name };
  const c: Ctx = { now, each: run.each, brandName: BRAND.name };
  if (run.listSpec) c.list = listFor(await world(now), run.each, run.listSpec);
  return c;
}

/* ════════════════════════════ Who it goes to ════════════════════════════ */

const EMAIL_OK = /^[^\s@<>()",;:]+@[^\s@<>()",;:]+\.[^\s@<>()",;:]{2,}$/;

/** Email addresses for these recipients, once each. */
export function addressesFor(to: Recipient[], c: Ctx, ppl: PersonLike[]): { email: string; name: string }[] {
  const out = new Map<string, { email: string; name: string }>();
  const add = (email: string | undefined, name: string) => {
    const e = (email ?? "").trim();
    if (EMAIL_OK.test(e) && !out.has(e.toLowerCase())) out.set(e.toLowerCase(), { email: e, name });
  };
  for (const r of to) {
    if (r.kind === "client") add(c.client?.email, c.client?.companyName ?? "Client");
    if (r.kind === "factory") add(c.factory?.email, c.factory?.name ?? "Factory");
    if (r.kind === "each") add(c.each?.email, c.each?.name ?? "");
    if (r.kind === "address") add(r.email, r.email);
    for (const u of peopleFor([r], c, ppl)) add(u.email, u.name);
  }
  return [...out.values()];
}

/** Our own people for these recipients — popups, alerts, tasks and questions go only to them. */
export function peopleFor(to: Recipient[], c: Ctx, ppl: PersonLike[]): PersonLike[] {
  const out = new Map<string, PersonLike>();
  const add = (u: PersonLike | undefined) => { if (u && active(u)) out.set(u.id, u); };
  for (const r of to) {
    if (r.kind === "handler") add(c.handler && ppl.find(u => u.id === c.handler!.id));
    if (r.kind === "admins") ppl.filter(u => u.role === "admin").forEach(add);
    if (r.kind === "sales") salesStaff(ppl).forEach(add);
    if (r.kind === "person") add(ppl.find(u => u.id === r.userId));
    if (r.kind === "department") ppl.filter(u => u.role === "employee" && (u.department ?? "").trim().toLowerCase() === r.name.trim().toLowerCase()).forEach(add);
    if (r.kind === "each" && (c.each?.kind === "salesperson" || c.each?.kind === "admin")) add(ppl.find(u => u.id === c.each!.id));
  }
  return [...out.values()];
}

/** In words, who a step would reach — for the test and the history. */
function whoText(e: Effect, c: Ctx, ppl: PersonLike[]): string[] {
  if (e.type === "email") return addressesFor(e.to, c, ppl).map(r => `${r.name} <${r.email}>`);
  if (e.type === "popup" || e.type === "alert") return peopleFor(e.to, c, ppl).map(u => u.name);
  if (e.type === "task" || e.type === "ask") return peopleFor([e.to], c, ppl).map(u => u.name);
  return [];
}

/* ════════════════════════════ Moving a run ════════════════════════════ */

/** Starting a run — only if its "Only if" holds and this event has not started one already. */
export async function startRun(
  p: Pipeline, subject: Run["subject"], eventKey: string, c: Ctx, extra: Partial<RunDoc> = {},
): Promise<"started" | "exists" | "skipped"> {
  if (!allHold(p.only, c)) return "skipped";
  const key = `${subject.kind}:${subject.id ?? "-"}:${eventKey}`;
  const run: RunDoc = {
    id: `r_${hash(`${p.id}|${key}`)}`, pipelineId: p.id, pipelineName: p.name, version: p.version,
    subject, subjectId: subject.id ?? "", key, status: "running", cursor: ["0"],
    startedAt: c.now, updatedAt: c.now, trail: [], ...extra,
  };
  return (await moveRun(p, run.id, c, { initial: run })) ? "started" : "exists";
}

/** What a run looks like for the "did anything change?" test. */
const shape = (r: Run) => JSON.stringify([r.status, r.cursor, r.wakeAt, r.giveUpAt, r.trail.length, r.reason]);

/**
 * Move a run as far as it goes now — in a transaction, so two triggers at
 * once cannot both move it. The steps it reaches become jobs (each created
 * once), done after the run is saved.
 */
export async function moveRun(p: Pipeline, runId: string, c: Ctx, opts: { initial?: RunDoc; answer?: "yes" | "no" } = {}): Promise<boolean> {
  const ref = db.collection(C.runs).doc(runId);
  let jobIds: string[] = [];
  let moved = false;
  let was: RunStatus | undefined;
  let now: RunDoc | undefined;
  await db.runTransaction(async t => {
    jobIds = []; moved = false;
    const snap = await t.get(ref);
    let run: RunDoc;
    if (opts.initial) { if (snap.exists) return; run = opts.initial; }
    else { if (!snap.exists) return; run = snap.data() as RunDoc; if (!ACTIVE.has(run.status)) return; }
    was = run.status;
    const next = advance(p, run, c, opts.answer);
    // The run as advance() left it — a wait or question that is over must not keep its old alarm.
    const doc = { ...next.run } as RunDoc;
    if (!ACTIVE.has(doc.status)) { delete doc.wakeAt; delete doc.giveUpAt; }
    if (!opts.initial && !next.effects.length && shape(doc) === shape(run)) return; // nothing new: no write
    if (doc.trail.length > 300) doc.trail = doc.trail.slice(-300);
    const refs = next.effects.map(e => db.collection(C.jobs).doc(`${runId}_${e.stepId}`));
    const got = refs.length ? await t.getAll(...refs) : [];
    next.effects.forEach((e, i) => {
      if (got[i].exists) return;
      const job: JobDoc = { id: refs[i].id, runId, pipelineId: p.id, pipelineName: p.name, version: run.version, effect: e, status: "todo", createdAt: c.now, ...(run.test ? { test: true } : {}) };
      t.create(refs[i], plain(job));
      jobIds.push(refs[i].id);
    });
    t.set(ref, plain(doc));
    moved = true; now = doc;
  });
  for (const id of jobIds) await runJob(id, c).catch(e => console.error("[pipelines] job", id, e));
  if (moved && was === "asking" && now && now.status !== "asking") await closeAsks(runId);
  return moved;
}

/** Stop a run that cannot go on, saying why. */
export async function stopRun(runId: string, reason: string): Promise<void> {
  const ref = db.collection(C.runs).doc(runId);
  let wasAsking = false;
  await db.runTransaction(async t => {
    const r = (await t.get(ref)).data() as RunDoc | undefined;
    if (!r || !ACTIVE.has(r.status)) return;
    wasAsking = r.status === "asking";
    const trail: TrailEntry[] = [...r.trail, { stepId: "", at: nowIso(), outcome: "stopped", note: reason }];
    t.update(ref, { status: "stopped", reason, updatedAt: nowIso(), trail, wakeAt: FieldValue.delete(), giveUpAt: FieldValue.delete() });
  });
  if (wasAsking) await closeAsks(runId);
}

/** A question nobody needs to answer any more: taken off their screens. */
async function closeAsks(runId: string): Promise<void> {
  const s = await db.collection(C.asks).where("runId", "==", runId).get();
  const open = s.docs.filter(d => !d.data().answer && !d.data().closedAt);
  if (!open.length) return;
  const b = db.batch();
  for (const d of open) b.update(d.ref, { closedAt: nowIso(), handled: true });
  await b.commit();
}

/* ════════════════════════════ Doing a step ════════════════════════════ */

/** Do one job — claimed first, so it is done once even if two triggers reach it. */
export async function runJob(jobId: string, c?: Ctx): Promise<void> {
  const ref = db.collection(C.jobs).doc(jobId);
  const job = await db.runTransaction(async t => {
    const j = (await t.get(ref)).data() as JobDoc | undefined;
    if (!j || j.status !== "todo") return null;
    t.update(ref, { status: "doing", startedAt: nowIso() });
    return j;
  });
  if (!job) return;
  try {
    const run = (await db.collection(C.runs).doc(job.runId).get()).data() as RunDoc | undefined;
    if (!run) throw new Error("The run is gone");
    const ctx = c ?? (await ctxForRun(run));
    if (!ctx) throw new Error("The record it is about is gone");
    const res = await doEffect(job, run, ctx);
    await ref.update(plain({ status: "done", doneAt: nowIso(), ...res }));
  } catch (e) {
    // The order was being saved just then: put the step back; the regular check tries again.
    if (e instanceof Busy && (job.busyTries ?? 0) < 6) { await ref.update({ status: "todo", busyTries: (job.busyTries ?? 0) + 1 }); return; }
    console.error("[pipelines] step failed", jobId, e);
    await ref.update({ status: "failed", doneAt: nowIso(), error: errText(e) });
    // An approval or assignment that could not be done: a person must know (the run stops before its next steps).
    if (job.effect.type === "approve" || job.effect.type === "assign") {
      const what = job.effect.type === "approve" ? "approve" : "assign";
      await tellAdmins(`failed|${job.id}`, `Autopilot could not ${what} an order`, `"${job.pipelineName}" could not ${what} ${c?.order?.orderNumber ?? "an order"}: ${errText(e)}. Please do it by hand.`).catch(() => undefined);
    }
  }
}

const tester = (run: RunDoc, ppl: PersonLike[]): PersonLike[] => {
  if (!run.testerAppId) return [];
  return [ppl.find(u => u.id === run.testerAppId) ?? { id: run.testerAppId, name: "You", authUid: run.testerUid, email: run.testerEmail }];
};

/** The one place a pipeline acts. Each kind does only its own thing. */
async function doEffect(job: Pick<JobDoc, "id" | "runId" | "pipelineId" | "pipelineName" | "effect">, run: RunDoc, c: Ctx): Promise<Pick<JobDoc, "note" | "sentTo" | "verifyAt" | "expect">> {
  const e = job.effect;
  const test = !!run.test;
  const ppl = await people();
  const at = nowIso();
  const about = c.order ? { orderId: c.order.id, orderNumber: c.order.orderNumber } : c.client ? { clientId: c.client.id } : {};

  switch (e.type) {
    case "email": {
      const to = test ? (run.testerEmail ? [{ email: run.testerEmail, name: "You" }] : []) : addressesFor(e.to, c, ppl);
      if (!to.length) return { note: test ? "Your account has no email address to send the test to" : "Nobody to send to — no email address on file" };
      const withList = e.list && (run.subject.kind === "each" || run.subject.kind === "none") ? { ...c, list: listFor(await world(), run.each, e.list) } : c;
      const toFactory = e.to.some(r => r.kind === "factory" || (r.kind === "each" && c.each?.kind === "factory"));
      const body = blocksHtml(e.blocks, withList, toFactory);
      const settings = await loadSettings();
      const digest = e.send === "digest" && !test;
      const subject = `${test ? "[TEST] " : ""}${e.subject}`;
      const sendAt = test ? at : afterQuiet(at, settings.quiet ?? undefined);
      const b = db.batch();
      const ids = to.map((r, i) => {
        const id = `${job.id}_${i}`;
        const m: MailDoc = {
          id, to: r.email, subject, status: digest ? "digest" : "queued", ...(digest ? {} : { sendAt }), createdAt: at,
          runId: job.runId, pipelineId: job.pipelineId, pipelineName: job.pipelineName, stepId: e.stepId, ...(test ? { test: true } : {}),
        };
        if (digest) m.section = `<h2 style="margin:18px 0 6px;font-size:16px;color:${BRAND.ink};">${esc(e.subject)}</h2><p style="margin:0;font-size:14px;line-height:1.6;color:#374151;">${esc(e.text).replace(/\r?\n/g, "<br>")}</p>${body}`;
        else m.html = emailHtml({ subject, text: e.text, body, test });
        b.set(db.collection(C.mail).doc(id), plain(m));
        return id;
      });
      await b.commit();
      if (!digest) await sendMails(ids);
      return { sentTo: to.map(r => r.email), note: digest ? "Held for the daily digest" : sendAt > at ? "Held until quiet hours end" : undefined };
    }
    case "popup": {
      const who = test ? tester(run, ppl) : peopleFor(e.to, c, ppl);
      if (!who.length) return { note: "Nobody to show it to" };
      const b = db.batch();
      for (const u of who) {
        const id = `rm_${hash(`${job.id}|${u.id}`)}`;
        b.set(db.collection(C.reminders).doc(id), plain({
          id, userId: u.id, authUid: u.authUid ?? "", title: `${test ? "[TEST] " : ""}${e.title}`, text: e.text, showAt: test ? at : e.showAt,
          done: false, source: "autopilot", pipelineId: job.pipelineId, pipelineName: job.pipelineName, runId: job.runId, createdAt: at, createdBy: "autopilot",
          ...about, ...(test ? { test: true } : {}),
        }));
      }
      await b.commit();
      return { sentTo: who.map(u => u.name) };
    }
    case "alert": {
      const who = test ? tester(run, ppl) : peopleFor(e.to, c, ppl);
      if (!who.length) return { note: "Nobody to tell" };
      const b = db.batch();
      for (const u of who) {
        const id = `n_ap_${hash(`${job.id}|${u.id}`)}`;
        b.set(db.collection("notifications").doc(id), { id, userId: u.id, title: `${test ? "[TEST] " : ""}${job.pipelineName}`, body: e.text, type: "info", read: false, createdAt: at });
      }
      await b.commit();
      return { sentTo: who.map(u => u.name) };
    }
    case "task": {
      const who = peopleFor([e.to], c, ppl);
      if (test) return { note: `Test — a task would be given to ${who.map(u => u.name).join(", ") || "nobody (no one matches)"}` };
      if (!who.length) return { note: "Nobody to give the task to" };
      const b = db.batch();
      for (const u of who) {
        const id = `t_ap_${hash(`${job.id}|${u.id}`)}`;
        b.set(db.collection("tasks").doc(id), plain({ id, title: e.title, assignedTo: u.id, assignedBy: "autopilot", completed: false, createdAt: at, dueAt: e.dueAt, source: "autopilot", ...about }));
      }
      await b.commit();
      return { sentTo: who.map(u => u.name) };
    }
    case "label": {
      if (!c.order) return { note: "No order to label" };
      if (test) return { note: `Test — ${c.order.orderNumber} would get the label "${e.label}"` };
      await db.collection(C.marks).doc(c.order.id).set({ orderId: c.order.id, labels: FieldValue.arrayUnion(e.label), updatedAt: at }, { merge: true });
      return {};
    }
    case "ask": {
      const who = test ? tester(run, ppl) : peopleFor([e.to], c, ppl);
      if (!who.length) return { note: "Nobody to ask — the run takes the No way when its time is up" };
      await db.collection(C.asks).doc(job.id).set(plain({
        id: job.id, runId: job.runId, pipelineId: job.pipelineId, pipelineName: job.pipelineName, stepId: e.stepId,
        userIds: who.map(u => u.id), authUids: who.map(u => u.authUid).filter(Boolean), question: e.question,
        giveUpAt: e.giveUpAt, createdAt: at, answer: null, handled: false, ...about, ...(test ? { test: true } : {}),
      }));
      return { sentTo: who.map(u => u.name) };
    }
    case "approve": return test ? { note: c.order?.status === "Waiting" ? `Test — ${c.order.orderNumber} would be approved` : "Test — not waiting for approval, nothing would happen" } : approveOrder(c, job.pipelineName);
    case "assign": return test ? { note: "Test — the order would be given to its salesperson" } : assignOrder(c, e, job.pipelineName, ppl);
  }
}

/** The activity-log line for what Autopilot did to an order. */
function autopilotEntry(o: OrderLike, summary: string, before: Record<string, unknown>, after: Record<string, unknown>) {
  const at = nowIso();
  return plain({
    id: `act_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`, at,
    actorUid: "autopilot", actorId: "autopilot", actorName: "Autopilot", actorRole: "system",
    kind: "change", module: "orders", summary,
    changes: [{ col: "orders", id: o.id, op: "edit", before, after, label: o.orderNumber, fields: Object.keys(after) }],
    undoable: false, undoBlocker: "Done by Autopilot — change it on the order itself.",
  });
}

/** The Approve button, on the server: only an order still waiting, the client told in the app. */
/** In 15 minutes, look again that the change is still on the order. */
const verifyLater = () => new Date(Date.now() + 15 * 6e4).toISOString();

async function approveOrder(c: Ctx, pipelineName: string): Promise<Pick<JobDoc, "note" | "verifyAt" | "expect">> {
  if (!c.order) return { note: "No order to approve" };
  const ref = db.collection("orders").doc(c.order.id);
  const at = nowIso();
  const done = await db.runTransaction(async t => {
    const snap = await t.get(ref);
    const cur = snap.data() as (OrderLike & { timeline?: TimelineStepLike[] }) | undefined;
    if (!cur || cur.deletedAt) return null;
    if (Date.now() - +snap.updateTime!.toDate() < SETTLE_MS) throw new Busy("The order is being saved — trying again shortly");
    const next = plain({ status: cur.status, timeline: cur.timeline ?? [] });
    if (!approveOrderTimeline(next, at)) return null;
    t.update(ref, { status: next.status, timeline: next.timeline });
    const o = { ...cur, id: c.order!.id };
    t.set(db.collection("activityLog").doc(), autopilotEntry(o, `Autopilot approved ${cur.orderNumber} (pipeline "${pipelineName}")`,
      { status: cur.status, timeline: cur.timeline ?? [] }, next));
    return cur;
  });
  if (!done) return { note: "It was no longer waiting for approval — left as it was" };
  const cu = await db.collection("users").where("clientId", "==", done.clientId).limit(1).get();
  if (!cu.empty) {
    const id = `n_ap_${hash(`approve|${c.order.id}`)}`;
    await db.collection("notifications").doc(id).set({
      id, userId: (cu.docs[0].data().id as string) || cu.docs[0].id, title: "Order Approved",
      body: `${done.orderNumber} has been approved and is now in production.`, type: "order", read: false, createdAt: at,
    });
  }
  return { note: `Approved ${done.orderNumber}`, verifyAt: verifyLater(), expect: { status: "approved" } };
}

/** Give an order nobody has to a salesperson — the person told, as when an admin assigns it. */
async function assignOrder(c: Ctx, e: Extract<Effect, { type: "assign" }>, pipelineName: string, ppl: PersonLike[]): Promise<Pick<JobDoc, "note" | "verifyAt" | "expect">> {
  if (!c.order) return { note: "No order to assign" };
  const to = e.who === "person" ? ppl.find(u => u.id === e.userId) : c.client?.accountManagerId ? ppl.find(u => u.id === c.client!.accountManagerId) : undefined;
  // Orders are given to salespeople only — never to an admin, as the app's own order form does.
  if (!to || !active(to) || to.role !== "employee") return { note: e.who === "person" ? "That person is not an active employee" : "The client has no active employee handling it" };
  const ref = db.collection("orders").doc(c.order.id);
  const done = await db.runTransaction(async t => {
    const snap = await t.get(ref);
    const cur = snap.data() as OrderLike | undefined;
    if (!cur || cur.deletedAt || cur.assignedEmployeeId) return null;
    if (Date.now() - +snap.updateTime!.toDate() < SETTLE_MS) throw new Busy("The order is being saved — trying again shortly");
    t.update(ref, { assignedEmployeeId: to.id });
    t.set(db.collection("activityLog").doc(), autopilotEntry({ ...cur, id: c.order!.id }, `Autopilot gave ${cur.orderNumber} to ${to.name} (pipeline "${pipelineName}")`,
      { assignedEmployeeId: null }, { assignedEmployeeId: to.id }));
    return cur;
  });
  if (!done) return { note: "Someone already had it — left as it was" };
  const id = `n_ap_${hash(`assign|${c.order.id}|${to.id}`)}`;
  await db.collection("notifications").doc(id).set({ id, userId: to.id, title: "Order assigned to you", body: `${done.orderNumber} · by Autopilot`, type: "info", read: false, createdAt: nowIso() });
  return { note: `Given to ${to.name}`, verifyAt: verifyLater(), expect: { assignedEmployeeId: to.id } };
}

/* ════════════════════════════ Email: the queue, the cap, the digest ════════════════════════════ */

/** Midnight tomorrow, India time. */
const tomorrow = (iso: string) => new Date(+new Date(`${localParts(iso).date}T00:00:00+05:30`) + DAY).toISOString();

/**
 * Send the queued emails that are due (these, or every one waiting), within a
 * time budget — what is left goes on the next check. Only a waiting email has a
 * `sendAt`: it is removed once the email is claimed, so the ones already sent
 * never crowd the due ones out of the query.
 */
export async function sendMails(ids?: string[], budgetMs = 240_000): Promise<void> {
  const start = Date.now();
  const settings = await loadSettings();
  const cap = Math.max(1, Math.min(2000, Number(settings.dailyCap) || DEFAULT_DAILY_CAP));
  const list = ids ?? (await db.collection(C.mail).where("sendAt", "<=", nowIso()).orderBy("sendAt").limit(300).get()).docs.map(d => d.id);
  for (const id of list) {
    if (Date.now() - start > budgetMs) break;
    await sendOne(id, cap, !!settings.paused, settings.quiet ?? undefined).catch(e => console.error("[pipelines] mail", id, e));
  }
}

async function sendOne(id: string, cap: number, paused: boolean, quiet: PipelineSettings["quiet"] | undefined): Promise<void> {
  const ref = db.collection(C.mail).doc(id);
  const at = nowIso();
  const day = localParts(at).date;
  const counter = db.collection(C.state).doc(`mail_${day}`);
  const m = await db.runTransaction(async t => {
    const [s, k] = await t.getAll(ref, counter);
    const m = s.data() as MailDoc | undefined;
    // Not waiting any more, yet still carrying a time: tidied, so it never blocks the queue.
    if (m && m.status !== "queued" && m.sendAt) { t.update(ref, { sendAt: FieldValue.delete() }); return null; }
    if (!m || m.status !== "queued" || !m.sendAt || m.sendAt > at || !m.html) return null;
    if (paused && !m.test) return null;
    // Tests count too: the mailbox's limit is the mailbox's, whoever sends.
    if (((k.data()?.count as number | undefined) ?? 0) >= cap) {
      t.update(ref, { sendAt: afterQuiet(tomorrow(at), quiet ?? undefined), note: "Held — today's email limit was reached" });
      return null;
    }
    t.update(ref, { status: "sending", claimedAt: at, sendAt: FieldValue.delete() });
    t.set(counter, { day, count: FieldValue.increment(1) }, { merge: true });
    return m;
  });
  if (!m) return;
  try {
    await deliverMail(m.to, m.subject, m.html!);
    await ref.update({ status: "sent", sentAt: nowIso() });
  } catch (e) {
    await ref.update({ status: "failed", error: errText(e) });
  }
}

/** The day's held emails, one email per person — every update in it, in as many emails as it takes. */
export async function sendDigests(): Promise<void> {
  const at = nowIso();
  const snap = await db.collection(C.mail).where("status", "==", "digest").limit(3000).get();
  if (snap.empty) return;
  const byTo = new Map<string, typeof snap.docs>();
  for (const d of snap.docs) { const to = (d.data().to as string).toLowerCase(); byTo.set(to, [...(byTo.get(to) ?? []), d]); }
  const ids: string[] = [];
  const stamp = `${localParts(at).date}_${localParts(at).hm.replace(":", "")}`;
  for (const [to, all] of byTo) {
    const PART = 100;
    for (let part = 0; part * PART < all.length; part++) {
      const docs = all.slice(part * PART, (part + 1) * PART);
      const parts = Math.ceil(all.length / PART);
      // Its own id each time: a second digest on the same day never overwrites the first.
      const id = `dg_${stamp}_${hash(to)}_${part}`;
      const subject = `Your updates — ${fmtDay(at)}${parts > 1 ? ` (${part + 1} of ${parts})` : ""}`;
      const mail: MailDoc = {
        id, to: docs[0].data().to, subject, status: "queued", sendAt: at, createdAt: at,
        html: emailHtml({ subject, text: `Here ${all.length === 1 ? "is today's update" : `are today's ${all.length} updates`}, in one email.`, body: docs.map(d => d.data().section as string).join("") }),
      };
      // One batch: this email, and every update in it marked as sent in it.
      const b = db.batch();
      b.set(db.collection(C.mail).doc(id), plain(mail));
      for (const d of docs) b.update(d.ref, { status: "digested", digestId: id });
      await b.commit();
      ids.push(id);
    }
  }
  await sendMails(ids);
}

/* ════════════════════════════ What starts runs ════════════════════════════ */

/** Only a record made in the last day starts "new" runs — a backup restored later is not news. */
// A record with no date at all is old (an import, a restore), never news.
const fresh = (iso: string | undefined, now: string) => !!iso && +new Date(now) - +new Date(iso) < DAY;

/** An order was saved: start what its changes start, and look again at the runs already about it. */
export async function onOrderWrite(orderId: string, before: OrderLike | null, after: OrderLike | null, savedAt?: string): Promise<void> {
  if (!after) return;
  if ((await loadSettings()).paused) return;
  const now = nowIso();
  const o = { ...after, id: orderId };
  const events = orderEvents(before ? { ...before, id: orderId } : null, o).filter(e => before || fresh(o.createdAt, now));
  const live = (await livePipelines()).filter(p => p.trigger.kind.startsWith("order."));
  const starts = live.flatMap(p => events.filter(e => eventMatches(p.trigger, e)).map(e => ({ p, e })));
  const going = (await db.collection(C.runs).where("subjectId", "==", orderId).get()).docs
    .map(d => d.data() as RunDoc).filter(r => r.subject.kind === "order" && ACTIVE.has(r.status) && !r.test);
  if (!starts.length && !going.length) return;
  // Saved this moment: approve and assign wait until it has settled.
  const c = await orderCtx(o, now, savedAt ?? now);
  for (const { p, e } of starts) await startRun(p, { kind: "order", id: orderId, label: o.orderNumber }, e.key, c).catch(err => console.error("[pipelines] start", p.id, err));
  for (const r of going) {
    const p = await pipelineForRun(r);
    if (typeof p === "string") await stopRun(r.id, p);
    else await moveRun(p, r.id, c).catch(err => console.error("[pipelines] move", r.id, err));
  }
}

export async function onClientCreated(clientId: string, cl: ClientLike): Promise<void> {
  if ((await loadSettings()).paused) return;
  const now = nowIso();
  if (!fresh(cl.createdAt, now)) return;
  const live = (await livePipelines()).filter(p => p.trigger.kind === "client.created");
  if (!live.length) return;
  const c = await clientCtx({ ...cl, id: clientId }, now);
  for (const p of live) await startRun(p, { kind: "client", id: clientId, label: cl.companyName }, "created", c);
}

export async function onInvoiceCreated(invoiceId: string, inv: { orderId?: string; orderIds?: string[]; number?: string; amount?: number; createdAt?: string; date?: string }): Promise<void> {
  if ((await loadSettings()).paused) return;
  const now = nowIso();
  if (!fresh(inv.createdAt ?? inv.date, now)) return;
  const live = (await livePipelines()).filter(p => p.trigger.kind === "invoice.raised");
  if (!live.length) return;
  const o = await one<OrderLike>("orders", inv.orderIds?.[0] ?? inv.orderId);
  if (!o) return;
  const invoice = { number: inv.number ?? "", amount: inv.amount };
  const c = { ...(await orderCtx(o, now)), invoice };
  for (const p of live) await startRun(p, { kind: "order", id: o.id, label: o.orderNumber }, `invoice:${invoiceId}`, c, { invoice });
}

/** A person answered a question: the run takes their way. */
export async function onAnswer(askId: string): Promise<void> {
  if ((await loadSettings()).paused) return; // picked up by the regular check once switched back on
  const ref = db.collection(C.asks).doc(askId);
  const ask = await db.runTransaction(async t => {
    const a = (await t.get(ref)).data() as { runId: string; stepId: string; answer?: string; handled?: boolean } | undefined;
    if (!a || a.handled || (a.answer !== "yes" && a.answer !== "no")) return null;
    t.update(ref, { handled: true });
    return a;
  });
  if (!ask) return;
  const run = (await db.collection(C.runs).doc(ask.runId).get()).data() as RunDoc | undefined;
  if (!run || run.status !== "asking") return;
  const p = await pipelineForRun(run);
  if (typeof p === "string") { await stopRun(run.id, p); return; }
  if (stepAt(p.steps, run.cursor)?.id !== ask.stepId) return;
  const c = await ctxForRun(run);
  if (!c) { await stopRun(run.id, "The record it is about is gone"); return; }
  await moveRun(p, run.id, c, { answer: ask.answer as "yes" | "no" });
}

/* ════════════════════════════ The regular check (every 10 minutes) ════════════════════════════ */

const LIMIT_PER_TICK = 400;

export async function tick(): Promise<void> {
  const start = Date.now();
  const now = nowIso();
  const clockRef = db.collection(C.state).doc("clock");
  const clock = (await clockRef.get()).data() ?? {};
  const last: string = clock.lastTick ?? new Date(Date.now() - 10 * 6e4).toISOString();
  // The clock moves first: a check that fails halfway does not fire the day's schedules again (runs are keyed too).
  await clockRef.set({ lastTick: now }, { merge: true });
  const settings = await loadSettings();
  if (settings.paused) return;
  const live = await livePipelines();

  // 1. Answers given while paused.
  const asks = await db.collection(C.asks).where("handled", "==", false).limit(200).get();
  for (const d of asks.docs) if (d.data().answer) await onAnswer(d.id).catch(e => console.error("[pipelines] answer", d.id, e));

  // 2. Runs whose time has come: a wait over, a check due again, a question unanswered too long.
  //    (A run that has finished carries no alarm, so these are all still going.)
  const due = await db.collection(C.runs).where("wakeAt", "<=", now).orderBy("wakeAt").limit(LIMIT_PER_TICK).get();
  for (const d of due.docs) {
    const r = d.data() as RunDoc;
    if (!ACTIVE.has(r.status) || r.test) {
      // An alarm left on a finished run (or a test): taken off, so it never blocks the ones due.
      await d.ref.update({ wakeAt: FieldValue.delete(), giveUpAt: FieldValue.delete() }).catch(() => undefined);
      continue;
    }
    try {
      const p = await pipelineForRun(r);
      if (typeof p === "string") { await stopRun(r.id, p); continue; }
      const c = await ctxForRun(r, now);
      if (!c) { await stopRun(r.id, "The record it is about is gone"); continue; }
      await moveRun(p, r.id, c);
    } catch (e) { console.error("[pipelines] wake", r.id, e); }
  }

  // 3. Steps left undone (the function stopped before doing them, or the order was being
  //    saved): done now. One that started and never finished is not tried again — an
  //    email might have gone.
  const todo = await db.collection(C.jobs).where("status", "in", ["todo", "doing"]).limit(200).get();
  for (const d of todo.docs) {
    const j = d.data() as JobDoc & { startedAt?: string };
    const age = +new Date(now) - +new Date(j.startedAt ?? j.createdAt);
    if (j.status === "todo" && age > 2 * 6e4) await runJob(j.id).catch(e => console.error("[pipelines] retry", j.id, e));
    if (j.status === "doing" && age > 15 * 6e4) await d.ref.update({ status: "failed", error: "Interrupted — not tried again, so nothing is sent twice" });
  }

  // 4. Approvals and assignments, looked at again: still on the order?
  await verify(now).catch(e => console.error("[pipelines] verify", e));

  // 5. Schedules — those due now, and any a previous check had to leave half done.
  //    Each one's own entry is written on its own — never the whole list — so a
  //    "Run now" saved meanwhile is never wiped out.
  const pending: Record<string, string> = { ...(clock.pendingSchedules ?? {}) };
  const scheduled = live.filter(p => p.trigger.kind === "time.schedule");
  const entry = (id: string) => `pendingSchedules.${id}`;
  for (const p of scheduled) {
    const day = scheduleDue(p.trigger, last, now);
    if (day) { pending[p.id] = `sched:${day}`; await clockRef.update({ [entry(p.id)]: pending[p.id] }); }
  }
  for (const id of Object.keys(pending)) if (!scheduled.some(p => p.id === id)) { delete pending[id]; await clockRef.update({ [entry(id)]: FieldValue.delete() }); } // switched off since
  if (Object.keys(pending).length) {
    const w = await world(now);
    for (const p of scheduled) {
      if (!pending[p.id]) continue;
      const r = await fireSchedule(p, w, pending[p.id], start + 240_000).catch(e => { console.error("[pipelines] schedule", p.id, e); return { started: 0, complete: false }; });
      if (r.complete) await clockRef.update({ [entry(p.id)]: FieldValue.delete() });
    }
  }

  // 6. The digest — before the long hourly look, so it is never squeezed out.
  if (scheduleDue({ kind: "time.schedule", every: "day", at: settings.digestAt || "18:00" }, last, now)) await sendDigests().catch(e => console.error("[pipelines] digest", e));

  // 7. The hourly look for things that have become true by time passing — within the time left.
  if (now.slice(0, 13) !== last.slice(0, 13)) await scan(live, now, start + 400_000).catch(e => console.error("[pipelines] scan", e));

  // 8. Email held for quiet hours or the cap, or left over: as much as time allows (the check stops at 540 s).
  const left = 480_000 - (Date.now() - start);
  if (left > 5_000) await sendMails(undefined, left);
  await closeMail();
}

/** Tell every admin, once per key. */
async function tellAdmins(key: string, title: string, body: string): Promise<void> {
  const admins = (await people()).filter(u => u.role === "admin" && active(u));
  const b = db.batch();
  for (const u of admins) {
    const id = `n_ap_${hash(`${key}|${u.id}`)}`;
    b.set(db.collection("notifications").doc(id), { id, userId: u.id, title, body, type: "info", read: false, createdAt: nowIso() });
  }
  await b.commit();
}

/**
 * An approval or assignment, 15 minutes on: if a save from a screen has put the
 * order back, the step is marked failed and the admins are told — it is never
 * silently lost, and never fought over.
 */
async function verify(now: string): Promise<void> {
  const list = await db.collection(C.jobs).where("verifyAt", "<=", now).orderBy("verifyAt").limit(100).get();
  for (const d of list.docs) {
    const j = d.data() as JobDoc;
    const o = j.effect.type === "approve" || j.effect.type === "assign" ? (await orderDoc((await db.collection(C.runs).doc(j.runId).get()).data()?.subjectId))?.o : undefined;
    const kept = !o || !!o.deletedAt || o.status === "Rejected"
      || (j.expect?.status === "approved" ? o.status !== "Waiting" : o.assignedEmployeeId === j.expect?.assignedEmployeeId || !!o.assignedEmployeeId);
    if (kept) { await d.ref.update({ verifyAt: FieldValue.delete(), verifiedAt: now }); continue; }
    const what = j.effect.type === "approve" ? "approval" : "assignment";
    await d.ref.update({ verifyAt: FieldValue.delete(), status: "failed", error: `A later save from the app put the ${what} back — please do it by hand` });
    await tellAdmins(`undone|${j.id}`, `Autopilot: ${o!.orderNumber} needs you`, `Its ${what} by "${j.pipelineName}" was put back by a later save. Please ${j.effect.type === "approve" ? "approve" : "assign"} it by hand.`);
  }
}

/**
 * A scheduled pipeline: one run, or one for each factory / salesperson / client / admin.
 * Stops at the deadline and says so — the next check carries on where it left
 * off (each one's run is keyed, so nobody gets it twice).
 */
export async function fireSchedule(p: Pipeline, w: World, key: string, deadline = Date.now() + 240_000): Promise<{ started: number; complete: boolean }> {
  const spec = listSpecOf(p);
  const forEach = p.trigger.forEach && p.trigger.forEach !== "none" ? p.trigger.forEach : null;
  let n = 0;
  if (!forEach) {
    const c: Ctx = { now: w.now, brandName: BRAND.name, ...(spec ? { list: listFor(w, undefined, spec) } : {}) };
    if ((await startRun(p, { kind: "none", label: p.name }, key, c, spec ? { listSpec: spec } : {})) === "started") n++;
    return { started: n, complete: true };
  }
  for (const each of eachOf(w, forEach)) {
    if (Date.now() > deadline) return { started: n, complete: false };
    const list = spec ? listFor(w, each, spec) : undefined;
    if (spec && !list!.length) continue; // nothing to tell them today
    const c: Ctx = { now: w.now, each, brandName: BRAND.name, ...(list ? { list } : {}) };
    if ((await startRun(p, { kind: "each", id: `${each.kind}:${each.id}`, label: each.name }, key, c, { each, ...(spec ? { listSpec: spec } : {}) })) === "started") n++;
  }
  return { started: n, complete: true };
}

/** Month as "2026-10", for "at most once a month". */
const month = (iso: string) => localParts(iso).date.slice(0, 7);

async function scan(live: Pipeline[], now: string, deadline = Date.now() + 300_000): Promise<void> {
  const kinds = new Set(live.map(p => p.trigger.kind));
  const needWorld = ["order.stuck", "order.dueSoon", "order.overdue", "order.unpaidAfterDispatch", "client.idle", "client.balanceOver"].some(k => kinds.has(k as Trigger["kind"]));
  const w = needWorld ? await world(now) : null;
  let started = 0;
  const go = async (p: Pipeline, subject: Run["subject"], key: string, c: Ctx, extra: Partial<RunDoc> = {}) => {
    if (started >= LIMIT_PER_TICK || Date.now() > deadline) return; // the rest on the next hourly look
    if ((await startRun(p, subject, key, c, extra).catch(e => { console.error("[pipelines] scan start", p.id, e); return "skipped"; })) === "started") started++;
  };

  for (const p of live) {
    const t = p.trigger;
    const days = Number(t.days) || 0;
    // "From now on": only what became true after the pipeline was switched on —
    // switching on a payment chaser never sweeps up every old order at once.
    const since = p.onSince ?? p.updatedAt ?? "";
    const after = (iso: string | undefined, plusDays: number) => { if (!iso) return false; const d = new Date(iso); return !isNaN(+d) && new Date(+d + plusDays * DAY).toISOString() >= since; };
    const dueDay = (o: OrderLike) => (o.expectedDelivery ? `${o.expectedDelivery.slice(0, 10)}T23:59:59+05:30` : undefined);
    if (w && t.kind.startsWith("order.")) {
      for (const o of w.orders) {
        if (isClosed(o) || isDelivered(o)) continue;
        const c = worldCtx(w, o);
        const subject = { kind: "order" as const, id: o.id, label: o.orderNumber };
        const toDue = fieldValue("daysToDue", c) as number | undefined;
        if (t.kind === "order.stuck" && t.stage && fieldValue("stage", c) === t.stage && ((fieldValue("daysInStage", c) as number | undefined) ?? -1) >= days && after(stageSince(o), days))
          await go(p, subject, `stuck:${t.stage}:${stageKey(o)}`, c);
        if (t.kind === "order.dueSoon" && !isDispatched(o) && toDue !== undefined && toDue >= 0 && toDue <= days && after(dueDay(o), -days)) await go(p, subject, `due:${o.expectedDelivery}`, c);
        if (t.kind === "order.overdue" && !isDispatched(o) && toDue !== undefined && -toDue >= days && after(dueDay(o), days)) await go(p, subject, `overdue:${o.expectedDelivery}`, c);
        if (t.kind === "order.unpaidAfterDispatch" && isDispatched(o) && balanceOf(o) > 0 && ((fieldValue("daysSinceDispatch", c) as number | undefined) ?? -1) >= days && after(o.dispatchedAt, days)) await go(p, subject, `unpaid:${o.dispatchedAt}`, c);
      }
    }
    if (w && t.kind === "client.idle") {
      const lastOrder = new Map<string, string>();
      for (const o of w.orders) if (!o.deletedAt && o.createdAt && (lastOrder.get(o.clientId) ?? "") < o.createdAt) lastOrder.set(o.clientId, o.createdAt);
      for (const cl of w.clients.values()) {
        if (cl.status === "inactive") continue;
        const quietSince = lastOrder.get(cl.id) ?? cl.createdAt;
        if (!quietSince || (+new Date(now) - +new Date(quietSince)) / DAY < days || !after(quietSince, days)) continue;
        await go(p, { kind: "client", id: cl.id, label: cl.companyName }, `idle:${quietSince}`, { now, client: cl, handler: handlerFor(undefined, cl, w.people), brandName: BRAND.name });
      }
    }
    if (w && t.kind === "client.balanceOver") {
      const owed = new Map<string, number>();
      // The latest dispatch that left money owed: "from now on" — a balance built up before
      // it was switched on is not swept up; one a new dispatch takes over the line is.
      const lastOwedDispatch = new Map<string, string>();
      for (const o of w.orders) if (!isClosed(o) && isDispatched(o)) {
        owed.set(o.clientId, (owed.get(o.clientId) ?? 0) + balanceOf(o));
        if (balanceOf(o) > 0 && (o.dispatchedAt ?? "") > (lastOwedDispatch.get(o.clientId) ?? "")) lastOwedDispatch.set(o.clientId, o.dispatchedAt!);
      }
      for (const [id, amt] of owed) {
        const cl = w.clients.get(id);
        if (!cl || amt <= (Number(t.amount) || 0) || !after(lastOwedDispatch.get(id), 0)) continue;
        const clientBalance = Math.round(amt * 100) / 100;
        await go(p, { kind: "client", id, label: cl.companyName }, `over:${month(now)}`, { now, client: cl, handler: handlerFor(undefined, cl, w.people), clientBalance, brandName: BRAND.name }, { clientBalance });
      }
    }
    if (t.kind === "stock.low") await scanStock(p, now, go);
  }
}

/** The step an order is at, and since when — one "stuck" run per stay in a stage. */
const stageKey = (o: OrderLike) => {
  const tl = o.timeline ?? [];
  const i = tl.findIndex(s => s.status !== "done");
  return `${i}:${i > 0 ? tl[i - 1].date ?? "" : o.createdAt ?? ""}`;
};

/** Low stock: told once when it drops below, and again only after it has been back above. */
async function scanStock(p: Pipeline, now: string, go: (p: Pipeline, s: Run["subject"], key: string, c: Ctx, extra?: Partial<RunDoc>) => Promise<void>): Promise<void> {
  const t = p.trigger;
  if (!t.material || !(Number(t.below) > 0)) return;
  const levels = await db.collection("stockLevels").doc("current").get();
  const map = (levels.data()?.[t.material] ?? {}) as Record<string, number>;
  const qty = t.bucket ? map[t.bucket] ?? 0 : Object.values(map).reduce((s, v) => s + (Number(v) || 0), 0);
  const unit = t.material === "gold" ? "g" : t.material === "diamond" ? "ct" : "";
  const label = t.bucket ? `${t.bucket}${t.material === "gold" ? " gold" : ""}` : t.material === "gold" ? "Gold (all)" : t.material === "diamond" ? "Diamonds (all)" : t.material;
  const flagRef = db.collection(C.state).doc("lowStock");
  const flagKey = hash(`${p.id}|${t.material}|${t.bucket ?? ""}`);
  const flags = ((await flagRef.get()).data() ?? {}) as Record<string, string>;
  if (qty >= Number(t.below)) {
    if (flags[flagKey]) await flagRef.set({ [flagKey]: FieldValue.delete() }, { merge: true });
    return;
  }
  if (flags[flagKey]) return; // already told
  await flagRef.set({ [flagKey]: now }, { merge: true });
  const stock = { material: t.material, bucket: t.bucket ?? "", qty, unit, label };
  await go(p, { kind: "stock", id: `${t.material}:${t.bucket ?? ""}`, label }, `low:${now}`, { now, stock, brandName: BRAND.name }, { stock });
}

/* ════════════════════════════ Test, and Run now ════════════════════════════ */

export interface TestStep { stepId: string; type: Effect["type"] | "path"; wouldReach: string[]; note?: string; sentTo?: string[] }
export interface TestResult { problems: Problem[]; about?: string; onlyHolds?: boolean; trail: TrailEntry[]; steps: TestStep[] }

/**
 * Run a pipeline once, now, on a real record — reaching only the tester. Waits
 * are skipped, a "wait until" takes the way it would take today, and a
 * question takes the answer the tester chose.
 */
export async function testPipeline(p: Pipeline, who: { uid: string; appId: string; email?: string }, pick: { orderId?: string; clientId?: string; answer?: "yes" | "no" }): Promise<TestResult> {
  const problems = checkPipeline(p);
  if (problems.length) return { problems, trail: [], steps: [] };
  const now = nowIso();
  const t = p.trigger;
  let c: Ctx | undefined;
  let subject: Run["subject"] = { kind: "none", label: p.name };
  const extra: Partial<RunDoc> = {};
  if (t.kind.startsWith("order.") || t.kind === "invoice.raised") {
    let o = pick.orderId ? await one<OrderLike>("orders", pick.orderId) : undefined;
    if (o) c = await orderCtx(o, now);
    else if (!pick.orderId) {
      // None chosen: the newest order its "Only if" lets in — else simply the newest.
      const recent = (await db.collection("orders").orderBy("createdAt", "desc").limit(40).get()).docs
        .map(d => ({ ...(d.data() as OrderLike), id: d.id })).filter(x => !x.deletedAt);
      for (const x of recent) {
        const cx = await orderCtx(x, now);
        if (allHold(p.only, cx)) { o = x; c = cx; break; }
      }
      if (!o && recent[0]) { o = recent[0]; c = await orderCtx(o, now); }
    }
    if (!o || !c) return { problems: [{ text: "There is no order to test it on" }], trail: [], steps: [] };
    if (t.kind === "invoice.raised") c.invoice = { number: "INV-TEST" };
    subject = { kind: "order", id: o.id, label: o.orderNumber };
  } else if (t.kind.startsWith("client.")) {
    const cl = pick.clientId ? await one<ClientLike>("clients", pick.clientId)
      : await db.collection("clients").limit(1).get().then(s => (s.empty ? undefined : ({ ...(s.docs[0].data() as ClientLike), id: s.docs[0].id })));
    if (!cl) return { problems: [{ text: "There is no client to test it on" }], trail: [], steps: [] };
    c = await clientCtx(cl, now, { clientBalance: t.kind === "client.balanceOver" ? Number(t.amount) || 0 : undefined });
    subject = { kind: "client", id: cl.id, label: cl.companyName };
  } else if (t.kind === "stock.low") {
    c = { now, stock: { material: t.material ?? "", bucket: t.bucket ?? "", qty: Math.max(0, (Number(t.below) || 1) - 1), unit: t.material === "gold" ? "g" : "ct", label: t.bucket || t.material || "Stock" }, brandName: BRAND.name };
    subject = { kind: "stock", label: c.stock!.label };
  } else {
    const w = await world(now);
    const spec = listSpecOf(p);
    const forEach = t.forEach && t.forEach !== "none" ? t.forEach : null;
    const all = forEach ? eachOf(w, forEach) : [];
    const each = all.find(e => !spec || listFor(w, e, spec).length) ?? all[0];
    if (forEach && !each) return { problems: [{ text: `There is no ${forEach} to test it on` }], trail: [], steps: [] };
    c = { now, each, brandName: BRAND.name, ...(spec ? { list: listFor(w, each, spec) } : {}) };
    if (each) subject = { kind: "each", id: `${each.kind}:${each.id}`, label: each.name };
    if (spec) extra.listSpec = spec;
    if (each) extra.each = each;
  }
  const onlyHolds = allHold(p.only, c);
  let run: RunDoc = {
    id: `test_${hash(`${p.id}|${now}`)}`, pipelineId: p.id, pipelineName: p.name, version: p.version, subject, subjectId: subject.id ?? "",
    key: "test", status: "running", cursor: ["0"], startedAt: now, updatedAt: now, trail: [], test: true,
    testerUid: who.uid, testerAppId: who.appId, testerEmail: who.email, ...extra,
  };
  const ppl = await people();
  const steps: TestStep[] = [];
  for (let round = 0; round < 60; round++) {
    const next = advance(p, run, c, run.status === "asking" ? pick.answer ?? "yes" : undefined);
    run = { ...next.run } as RunDoc;
    // A test approves nothing: it carries on as if the approval had gone through.
    if (run.pending && c.order) {
      const step = stepAt(p.steps, run.cursor);
      c = { ...c, order: step?.kind === "assign" ? { ...c.order, assignedEmployeeId: "test" } : { ...c.order, status: "Approved" } };
    }
    for (const e of next.effects) {
      const wouldReach = whoText(e, c, ppl);
      if (e.type === "ask") { steps.push({ stepId: e.stepId, type: "ask", wouldReach, note: `Would ask: "${e.question}" — this test takes "${pick.answer ?? "yes"}"` }); continue; }
      const res = await doEffect({ id: `${run.id}_${e.stepId}`, runId: run.id, pipelineId: p.id, pipelineName: p.name, effect: e }, run, c)
        .catch(err => ({ note: `Failed: ${errText(err)}` }));
      steps.push({ stepId: e.stepId, type: e.type, wouldReach, note: res.note, sentTo: "sentTo" in res ? res.sentTo : undefined });
    }
    if (run.status === "waiting") { run = { ...run, wakeAt: now, ...(run.giveUpAt ? { giveUpAt: now } : {}) }; continue; }
    if (run.status === "asking") continue;
    break;
  }
  return { problems: [], about: subject.label, onlyHolds, trail: run.trail, steps };
}
