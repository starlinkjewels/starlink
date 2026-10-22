/**
 * Smart Pipelines — the functions. Each is small: it hands the change to the
 * engine (./engine.ts), which does the work. Deployed together by name:
 *   firebase deploy --only functions:pipelineOnOrder,functions:pipelineOnClient,functions:pipelineOnInvoice,functions:pipelineOnAnswer,functions:pipelineTick,functions:pipelineTest,functions:pipelineRunNow
 */
import { onDocumentCreated, onDocumentUpdated, onDocumentWritten } from "firebase-functions/v2/firestore";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { db } from "../lib/firestoreAdmin";
import { SMTP_PASSWORD } from "../mail";
import { OWNER_EMAILS } from "../summaries";
import { REGION } from "./config";
import { C, fireSchedule, livePipelines, onAnswer, onClientCreated, onInvoiceCreated, onOrderWrite, testPipeline, tick, world } from "./engine";
import type { ClientLike, OrderLike, Pipeline } from "../shared/pipelines";

const DATABASE = "diamondflow";
const base = { region: REGION, secrets: [SMTP_PASSWORD], memory: "256MiB" as const, minInstances: 0 };

export const pipelineOnOrder = onDocumentWritten({ ...base, document: "orders/{id}", database: DATABASE, maxInstances: 3, timeoutSeconds: 120 }, async ev => {
  const before = ev.data?.before.exists ? (ev.data.before.data() as OrderLike) : null;
  const after = ev.data?.after.exists ? (ev.data.after.data() as OrderLike) : null;
  await onOrderWrite(ev.params.id, before, after, ev.data?.after.exists ? ev.data.after.updateTime?.toDate().toISOString() : undefined);
});

export const pipelineOnClient = onDocumentCreated({ ...base, document: "clients/{id}", database: DATABASE, maxInstances: 2 }, async ev => {
  if (ev.data) await onClientCreated(ev.params.id, ev.data.data() as ClientLike);
});

export const pipelineOnInvoice = onDocumentCreated({ ...base, document: "invoices/{id}", database: DATABASE, maxInstances: 2 }, async ev => {
  if (ev.data) await onInvoiceCreated(ev.params.id, ev.data.data());
});

export const pipelineOnAnswer = onDocumentUpdated({ ...base, document: `${C.asks}/{id}`, database: DATABASE, maxInstances: 2 }, async ev => {
  const a = ev.data?.after.data();
  if (a?.answer && !a.handled) await onAnswer(ev.params.id);
});

export const pipelineTick = onSchedule({ ...base, schedule: "every 10 minutes", timeZone: "Asia/Kolkata", timeoutSeconds: 540, maxInstances: 1, memory: "512MiB" }, async () => {
  await tick();
});

/** An admin of this business — an owner by email, or a staff member made admin. Never what the browser says. */
async function adminCaller(auth: { uid: string; token: { email?: string } } | undefined): Promise<{ uid: string; appId: string; email?: string }> {
  if (!auth) throw new HttpsError("unauthenticated", "Sign in first.");
  const idx = (await db.collection("userByAuth").doc(auth.uid).get()).data() as { role?: string; status?: string; appId?: string } | undefined;
  const owner = !!auth.token.email && OWNER_EMAILS.diamondflow.includes(auth.token.email.toLowerCase());
  if (!owner && !(idx?.role === "admin" && idx.status === "active")) throw new HttpsError("permission-denied", "Only an admin can do this.");
  const appId = idx?.appId || auth.uid;
  const me = (await db.collection("users").doc(appId).get()).data() as { email?: string } | undefined;
  return { uid: auth.uid, appId, email: me?.email || auth.token.email };
}

/** "Send a test to me": run the pipeline on the editor's screen once, reaching only the admin who asked. */
export const pipelineTest = onCall<{ pipeline?: Pipeline; orderId?: string; clientId?: string; answer?: "yes" | "no" }>(
  { ...base, cors: true, maxInstances: 2, timeoutSeconds: 120 },
  async req => {
    const who = await adminCaller(req.auth);
    const p = req.data?.pipeline;
    if (!p || typeof p !== "object" || !p.trigger || !Array.isArray(p.steps) || !Array.isArray(p.only)) throw new HttpsError("invalid-argument", "Send the pipeline to test.");
    if (JSON.stringify(p).length > 200_000) throw new HttpsError("invalid-argument", "This pipeline is too large.");
    // At most 20 tests a day each, so a held-down button cannot flood the mailbox.
    const day = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
    const ref = db.collection(C.state).doc(`tests_${who.uid}_${day}`);
    const n = await db.runTransaction(async t => {
      const k = ((await t.get(ref)).data()?.count as number | undefined) ?? 0;
      if (k < 20) t.set(ref, { count: k + 1, day }, { merge: true });
      return k;
    });
    if (n >= 20) throw new HttpsError("resource-exhausted", "That's 20 tests today — try again tomorrow.");
    const answer = req.data.answer === "no" ? "no" : "yes";
    return testPipeline({ ...p, id: p.id || "draft", version: Number(p.version) || 1 }, who, { orderId: req.data.orderId, clientId: req.data.clientId, answer });
  },
);

/** "Run now": a scheduled pipeline that is switched on, run at once as if its time had come. */
export const pipelineRunNow = onCall<{ pipelineId?: string }>({ ...base, cors: true, maxInstances: 1, timeoutSeconds: 300 }, async req => {
  await adminCaller(req.auth);
  const p = (await livePipelines()).find(x => x.id === req.data?.pipelineId);
  if (!p) throw new HttpsError("failed-precondition", "Switch the pipeline on first.");
  if (p.trigger.kind !== "time.schedule") throw new HttpsError("failed-precondition", "Only a scheduled pipeline can be run now.");
  const key = `manual:${new Date().toISOString().slice(0, 16)}`;
  const r = await fireSchedule(p, await world(), key);
  // A big one goes on in the regular check — nobody is left out, nobody gets it twice.
  if (!r.complete) await db.collection(C.state).doc("clock").set({ pendingSchedules: { [p.id]: key } }, { merge: true });
  return { started: r.started, more: !r.complete };
});
