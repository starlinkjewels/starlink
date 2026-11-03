// Email campaigns (Campaigns page). Admins only.
//
//   campaignAi       write (or change) the email with AI — blocks, never HTML
//   campaignTest     send the saved draft to up to 5 addresses, marked [TEST]; starting needs a test of exactly what is sent
//   campaignStart    freeze the email and the people it goes to (each address once, unsubscribed ones left out) — now or at a time
//   campaignControl  pause, resume, cancel, try failed again, delete, unsubscribe / re-subscribe an address
//   campaignRunNow   send the next few now (the same run as the minute's check)
//   campaignTick     every minute: sends what is due, one at a time, inside the day's budget
//   campaignUnsub    the link in every client's email: one click (RFC 8058) or a confirm page
import { onCall, onRequest, HttpsError } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { createHash } from "crypto";
import { FieldValue, type DocumentReference } from "firebase-admin/firestore";
import {
  CAMPAIGNS, cleanEmail, db, EMAIL_RE, emailKey, getSettings, isSuppressed, istDay, now, readUnsubToken, requireAdmin, STATE, SUPPRESS, suppress, VERSIONS,
  type Audience, type CampaignDoc, type CampaignSettings, type RecipientStatus,
} from "./core";
import { classify, closeTransport, sendTo, SMTP_PASSWORD, transport, type Person } from "./send";
import { AI_KEY, writeEmail, type WriteReq } from "./write";
import { cleanDesign, designProblems, designKey, renderCampaign } from "./shared/campaignEmail";
import { BRAND, DEFAULT_DAILY_BUDGET, MAX_DAILY_BUDGET, REGION, SMTP_USER } from "./region";

const SEND_GAP_MS = 2500;   // one email every 2.5 s — Gmail's comfortable pace for one mailbox
const RUN_MS = 35_000;      // a run's share of its minute (claims stop here; the last email still fits)
const LEASE_MS = 5 * 60_000;
const BATCH = 450;

const hashOf = (subject: string, preheader: string, design: unknown) => createHash("sha256").update(designKey(subject, preheader, design)).digest("hex").slice(0, 40);
const fail = (e: unknown): never => { if (e instanceof HttpsError) throw e; throw new HttpsError("failed-precondition", e instanceof Error ? e.message : String(e)); };
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
/** Midnight IST after now — when the day's budget starts again. */
const nextIstMidnight = () => { const d = istDay(); return new Date(Date.parse(`${d}T00:00:00+05:30`) + 86_400_000).toISOString(); };

async function loadCampaign(id: unknown): Promise<{ ref: DocumentReference; c: CampaignDoc }> {
  const cid = String(id ?? "");
  if (!/^[\w-]{1,60}$/.test(cid)) throw new HttpsError("invalid-argument", "No such campaign");
  const ref = db.collection(CAMPAIGNS).doc(cid);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError("not-found", "No such campaign");
  return { ref, c: { ...(snap.data() as CampaignDoc), id: cid } };
}

/* ─────────────── What the page shows about sending ─────────────── */

export const campaignInfo = onCall({ region: REGION, memory: "256MiB", maxInstances: 3 }, async req => {
  await requireAdmin(req.auth as never);
  const s = await getSettings();
  const day = (await db.collection(STATE).doc(`day_${istDay()}`).get()).data();
  const ai = (await db.collection(STATE).doc(`ai_${istDay()}`).get()).data();
  return {
    sender: SMTP_USER, fromName: s.fromName, dailyBudget: s.dailyBudget, defaultBudget: DEFAULT_DAILY_BUDGET, maxBudget: MAX_DAILY_BUDGET,
    sentToday: Number(day?.sent ?? 0), aiToday: Number(ai?.count ?? 0), logoUrl: s.logoUrl, resetsAt: nextIstMidnight(), hold: await currentHold(),
  };
});

/* ─────────────── AI ─────────────── */

export const campaignAi = onCall<WriteReq>({ region: REGION, secrets: [AI_KEY], memory: "256MiB", maxInstances: 3, timeoutSeconds: 120 }, async req => {
  await requireAdmin(req.auth as never);
  const s = await getSettings();
  return await writeEmail({ ...req.data, brandName: s.fromName || BRAND.name }).catch(fail);
});

/* ─────────────── Who it goes to ─────────────── */

interface Resolved { people: (Person & { ref: string })[]; skipped: { name: string; why: string }[] }

async function getMany(col: string, ids: string[]): Promise<FirebaseFirestore.DocumentSnapshot[]> {
  const out: FirebaseFirestore.DocumentSnapshot[] = [];
  const uniq = [...new Set(ids.filter(i => typeof i === "string" && /^[\w-]{1,80}$/.test(i)))].slice(0, 10_000);
  for (let i = 0; i < uniq.length; i += 100) out.push(...(await db.getAll(...uniq.slice(i, i + 100).map(id => db.collection(col).doc(id)))));
  return out;
}
/** A record's addresses: one, or several written together ("a@x.com, b@y.com"). */
const addressesOf = (v: unknown) => String(v ?? "").split(/[,;\s]+/).map(cleanEmail).filter(Boolean);

export async function resolveAudience(a: Audience): Promise<Resolved> {
  const people: (Person & { ref: string })[] = [], skipped: { name: string; why: string }[] = [];
  const seen = new Set<string>();
  const add = (emails: string[], p: Omit<Person, "email">, ref: string, label: string) => {
    const good = emails.filter(e => EMAIL_RE.test(e));
    if (!emails.length) { skipped.push({ name: label, why: "No email" }); return; }
    if (!good.length) { skipped.push({ name: label, why: `Email isn't valid (${emails[0]})` }); return; }
    for (const e of good) {
      if (seen.has(e)) continue; // the same address twice: one email
      seen.add(e);
      people.push({ ...p, email: e, ref });
    }
  };
  const clients = a.allClients
    ? (await db.collection("clients").get()).docs.filter(d => d.data().status !== "inactive")
    : await getMany("clients", a.clientIds ?? []);
  for (const d of clients) {
    if (!d.exists) continue;
    const c = d.data() as { companyName?: string; ownerName?: string; email?: string; status?: string };
    add(addressesOf(c.email), { kind: "client", name: c.ownerName || c.companyName, company: c.companyName }, `client:${d.id}`, c.companyName || c.ownerName || "A client");
  }
  const users = a.allEmployees
    ? (await db.collection("users").where("role", "in", ["admin", "employee"]).get()).docs.filter(d => d.data().status !== "inactive")
    : (await getMany("users", a.userIds ?? [])).filter(d => ["admin", "employee"].includes(d.data()?.role));
  for (const d of users) {
    if (!d.exists) continue;
    const u = d.data() as { name?: string; email?: string };
    add(addressesOf(u.email), { kind: "employee", name: u.name }, `user:${d.id}`, u.name || "A team member");
  }
  return { people, skipped };
}

/* ─────────────── Test ─────────────── */

export const campaignTest = onCall<{ campaignId: string; to: string[]; asRef?: string }>(
  { region: REGION, secrets: [SMTP_PASSWORD], memory: "256MiB", maxInstances: 3, timeoutSeconds: 120 }, async req => {
    const me = await requireAdmin(req.auth as never);
    const { ref, c } = await loadCampaign(req.data?.campaignId);
    if (c.status !== "draft") throw new HttpsError("failed-precondition", "Only a draft is tested — this one has started");
    const to = [...new Set((Array.isArray(req.data?.to) ? req.data.to : []).map(cleanEmail).filter(Boolean))];
    if (!to.length || to.length > 5 || !to.every(e => EMAIL_RE.test(e))) throw new HttpsError("invalid-argument", "Up to 5 valid addresses for the test");
    const design = cleanDesign(c.design);
    const s = await getSettings();
    const stop = designProblems(design, c.subject, renderCampaign(design, { brandName: s.fromName, subject: c.subject })).filter(p => p.level === "stop");
    if (stop.length) throw new HttpsError("failed-precondition", stop.map(p => p.text).join(" · "));
    // Tests have their own small allowance (they use the same mailbox).
    const tref = db.collection(STATE).doc(`tests_${istDay()}`);
    await db.runTransaction(async tx => {
      const n = Number((await tx.get(tref)).data()?.count ?? 0);
      if (n + to.length > 40) throw new HttpsError("resource-exhausted", "Today's 40 test emails are used — try again tomorrow");
      tx.set(tref, { count: n + to.length }, { merge: true });
    });
    // Filled in as one real person sees it — the one chosen, or the admin.
    let as: Omit<Person, "email" | "kind"> & { kind: Person["kind"] } = { kind: "client", name: "Ravi Mehta", company: "Mehta Jewellers" };
    const asRef = String(req.data?.asRef ?? "");
    if (/^(client|user):[\w-]{1,80}$/.test(asRef)) {
      const [k, id] = asRef.split(":");
      const d = (await db.collection(k === "client" ? "clients" : "users").doc(id).get()).data();
      if (d) as = k === "client" ? { kind: "client", name: d.ownerName || d.companyName, company: d.companyName } : { kind: "employee", name: d.name };
    }
    const sent: string[] = [], failed: string[] = [];
    try {
      for (const e of to) {
        const r = await sendTo({ id: c.id, subject: c.subject, preheader: c.preheader ?? "", design }, s, { ...as, email: e }, { test: true });
        (r.ok ? sent : failed).push(r.ok ? e : `${e}: ${r.why}`);
      }
    } finally { closeTransport(); }
    if (sent.length) {
      await ref.update({ testedHash: hashOf(c.subject, c.preheader ?? "", design), lastTestAt: now(), lastTestTo: sent, lastTestBy: me.uid });
    }
    return { sent, failed };
  });

/* ─────────────── Start ─────────────── */

export const campaignStart = onCall<{ campaignId: string; scheduleAt?: string }>(
  { region: REGION, memory: "512MiB", maxInstances: 2, timeoutSeconds: 300 }, async req => {
    const me = await requireAdmin(req.auth as never);
    const { ref, c } = await loadCampaign(req.data?.campaignId);
    const design = cleanDesign(c.design);
    const s = await getSettings();
    const stop = designProblems(design, c.subject, renderCampaign(design, { brandName: s.fromName, subject: c.subject })).filter(p => p.level === "stop");
    if (stop.length) throw new HttpsError("failed-precondition", stop.map(p => p.text).join(" · "));
    const hash = hashOf(c.subject, c.preheader ?? "", design);
    let when: string | undefined;
    if (req.data?.scheduleAt) {
      const t = Date.parse(req.data.scheduleAt);
      if (!Number.isFinite(t) || t < Date.now() - 60_000 || t > Date.now() + 60 * 86_400_000) throw new HttpsError("invalid-argument", "Choose a time in the next 60 days");
      if (t > Date.now() + 60_000) when = new Date(t).toISOString();
    }
    // Claimed once: a second press (or a second admin) finds it already starting.
    const attempt = now();
    await db.runTransaction(async tx => {
      const cur = (await tx.get(ref)).data() as CampaignDoc;
      const stuck = cur.status === ("starting" as never) && Date.parse(cur.startedAt ?? "") < Date.now() - 10 * 60_000;
      if (cur.status !== "draft" && !stuck) throw new HttpsError("failed-precondition", "This campaign has already started");
      if (cur.testedHash !== hash) throw new HttpsError("failed-precondition", "Send yourself a test of this exact email first (it changed since the last test)");
      tx.update(ref, { status: "starting", startedAt: attempt, startedBy: me.uid });
    });
    try {
      // A start that stopped part-way before: its list is made again from scratch.
      await clearRecipients(ref);
      const { people, skipped } = await resolveAudience(c.audience ?? {});
      if (!people.length) throw new HttpsError("failed-precondition", "Nobody to send to — choose clients or team members with an email");
      // Unsubscribed (or bounced) addresses: listed, never sent.
      const supp = new Set<string>();
      const keys = people.map(p => emailKey(p.email));
      for (let i = 0; i < keys.length; i += 100) for (const d of await db.getAll(...keys.slice(i, i + 100).map(k => db.collection(SUPPRESS).doc(k)))) if (d.exists) supp.add(d.id);
      let queued = 0, off = 0;
      for (let i = 0; i < people.length; i += BATCH) {
        const b = db.batch();
        for (const p of people.slice(i, i + BATCH)) {
          const k = emailKey(p.email);
          const out = supp.has(k) && p.kind === "client";
          out ? off++ : queued++;
          b.set(ref.collection("recipients").doc(k), {
            email: p.email, name: p.name ?? null, company: p.company ?? null, kind: p.kind, ref: p.ref,
            status: (out ? "skipped" : "queued") as RecipientStatus, ...(out ? { why: "Unsubscribed earlier" } : {}), attempts: 0, at: now(),
          });
        }
        await b.commit();
      }
      // The settings as they are now (an empty one left out — the database takes no "undefined").
      const frozen = { subject: c.subject, preheader: c.preheader ?? "", design, settings: JSON.parse(JSON.stringify(s)) as CampaignSettings };
      // Out of "starting" only if it is still THIS start (never over a cancel, nor another start).
      await db.runTransaction(async tx => {
        const cur = (await tx.get(ref)).data() as CampaignDoc;
        if (cur.status !== ("starting" as never) || cur.startedAt !== attempt) throw new HttpsError("aborted", "It was changed while starting — open it again");
        tx.update(ref, {
          status: when ? "scheduled" : "sending", ...(when ? { scheduleAt: when } : { scheduleAt: FieldValue.delete() }), frozen,
          counts: { total: people.length, queued, sent: 0, failed: 0, skipped: off, unsure: 0, unsubscribed: 0 },
          skippedList: skipped.slice(0, 300), skippedCount: skipped.length, updatedAt: now(),
        });
      });
      return { queued, skipped: off + skipped.length, scheduled: !!when };
    } catch (e) {
      // Nothing went out: back to a draft — but only while it is still this start's own
      // "starting" (a start that did go through is never undone here).
      const mine = await db.runTransaction(async tx => {
        const cur = (await tx.get(ref)).data() as CampaignDoc | undefined;
        if (cur?.status !== ("starting" as never) || cur.startedAt !== attempt) return false;
        tx.update(ref, { status: "draft", startedAt: FieldValue.delete(), startedBy: FieldValue.delete() });
        return true;
      }).catch(() => false);
      if (mine) await clearRecipients(ref);
      return fail(e);
    }
  });

async function clearRecipients(ref: DocumentReference): Promise<void> {
  for (;;) {
    const s = await ref.collection("recipients").limit(BATCH).get();
    if (s.empty) return;
    const b = db.batch();
    s.docs.forEach(d => b.delete(d.ref));
    await b.commit();
  }
}

/* ─────────────── Sending ─────────────── */

/** Exact counts from the recipients themselves (the running figures are increments). */
async function recount(ref: DocumentReference): Promise<Record<string, number>> {
  const col = ref.collection("recipients");
  const n = async (st: RecipientStatus) => (await col.where("status", "==", st).count().get()).data().count;
  const [queued, sent, failed, skipped, unsure, sending] = await Promise.all((["queued", "sent", "failed", "skipped", "unsure", "sending"] as RecipientStatus[]).map(n));
  const total = (await col.count().get()).data().count;
  const unsubscribed = (await col.where("unsubscribedAt", ">", "").count().get()).data().count;
  return { total, queued, sent, failed, skipped, unsure, sending, unsubscribed };
}

/** When the mailbox itself says stop (slow down, the day's limit, its password, a policy
 *  refusal): EVERY campaign waits — never just the one that heard it. */
const HOLD = () => db.collection(STATE).doc("hold");
async function holdAll(ms: number, why: string): Promise<void> {
  await HOLD().set({ until: new Date(Date.now() + ms).toISOString(), why, at: now() });
}
export async function currentHold(): Promise<{ until: string; why: string } | null> {
  const h = (await HOLD().get()).data() as { until?: string; why?: string } | undefined;
  return h?.until && Date.parse(h.until) > Date.now() ? { until: h.until, why: h.why ?? "" } : null;
}
/** A write after an email went: tried again a few times — the email itself is never sent again. */
async function bookkeep(f: () => Promise<unknown>): Promise<void> {
  for (let i = 0; ; i++) {
    try { await f(); return; } catch (e) { if (i >= 3) { console.error("[campaigns] write after send failed:", e); return; } await sleep(500 * (i + 1)); }
  }
}

/**
 * One run: the campaigns due, one email at a time, inside the day's budget.
 * Never two runs at once (a lock that outlives the function's own time limit),
 * never one email twice: a person is claimed (queued → sending, the budget
 * taken in the same step) before the email goes, and marked sent after. A
 * claim left behind by a run that stopped mid-way is never sent again by
 * itself — it is marked "unsure" for the admin to decide. When the mailbox
 * says stop, everything waits (holdAll).
 */
export async function runBatch(maxMs = RUN_MS): Promise<{ sent: number; why?: string }> {
  const lock = db.collection(STATE).doc("lock");
  const me = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const got = await db.runTransaction(async tx => {
    const l = (await tx.get(lock)).data() as { until?: number } | undefined;
    if ((l?.until ?? 0) > Date.now()) return false;
    // Past the function's 60 s limit (and the mailbox's own time limits), so a run that
    // is cut off is never overlapped by the next one while its last email may be in flight.
    tx.set(lock, { until: Date.now() + 90_000, by: me });
    return true;
  });
  if (!got) return { sent: 0, why: "Another run is sending" };
  const t0 = Date.now();
  let sent = 0;
  try {
    // Scheduled ones whose time has come — only if still scheduled (never over a pause or cancel).
    for (const d of (await db.collection(CAMPAIGNS).where("status", "==", "scheduled").get()).docs) {
      if (Date.parse(d.data().scheduleAt ?? "") > Date.now()) continue;
      await db.runTransaction(async tx => {
        const cur = (await tx.get(d.ref)).data();
        if (cur?.status === "scheduled" && Date.parse(cur.scheduleAt ?? "") <= Date.now()) tx.update(d.ref, { status: "sending", scheduleAt: FieldValue.delete(), updatedAt: now() });
      });
    }
    const live = (await db.collection(CAMPAIGNS).where("status", "==", "sending").get()).docs
      .sort((a, b) => String(a.data().startedAt ?? "").localeCompare(String(b.data().startedAt ?? "")));
    if (!live.length) return { sent: 0 };
    const hold = await currentHold();
    if (hold) return { sent: 0, why: hold.why };
    const settings = await getSettings();
    const dayRef = db.collection(STATE).doc(`day_${istDay()}`);
    // The mailbox answers before anything is claimed — a wrong password or no connection holds everything, sends nothing.
    if (process.env.FUNCTIONS_EMULATOR !== "true") {
      try { await transport().verify(); }
      catch (e) {
        const out = classify(e);
        const why = "why" in out ? out.why : "The mailbox didn't answer";
        await holdAll(/password/.test(why) ? 30 * 60_000 : 10 * 60_000, why);
        return { sent: 0, why };
      }
    }
    let failsInRow = 0;

    for (const cd of live) {
      if (Date.now() - t0 >= maxMs) break;
      const ref = cd.ref;
      const c = { ...(cd.data() as CampaignDoc), id: cd.id };
      if (!c.frozen) continue;
      if (c.resumeAt && Date.parse(c.resumeAt) > Date.now()) continue;
      try {
        if (c.resumeAt) await ref.update({ resumeAt: FieldValue.delete(), pauseReason: FieldValue.delete() });
        // Claims left by a run that stopped mid-send: maybe sent — never again by themselves.
        for (const st of (await ref.collection("recipients").where("status", "==", "sending").get()).docs) {
          if (Date.parse(st.data().leaseAt ?? "") < Date.now() - LEASE_MS) {
            await st.ref.update({ status: "unsure", why: "The send stopped mid-way — it may have arrived" });
            await ref.update({ "counts.unsure": FieldValue.increment(1), "counts.queued": FieldValue.increment(-1) });
          }
        }
        const frozen = { id: c.id, subject: c.frozen.subject, preheader: c.frozen.preheader, design: c.frozen.design };
        const s: CampaignSettings = { ...c.frozen.settings, dailyBudget: settings.dailyBudget };
        let stopCampaign = false;
        while (!stopCampaign && Date.now() - t0 < maxMs) {
          const next = (await ref.collection("recipients").where("status", "==", "queued").limit(1).get()).docs[0];
          if (!next) break;
          // Claim it — and a place in today's budget — in one step; the campaign must still be sending.
          const claim = await db.runTransaction(async tx => {
            const [cs, rs, ds, hs] = await Promise.all([tx.get(ref), tx.get(next.ref), tx.get(dayRef), tx.get(HOLD())]);
            if (cs.data()?.status !== "sending") return "stopped" as const;
            if (Date.parse(hs.data()?.until ?? "") > Date.now()) return "held" as const;
            if (rs.data()?.status !== "queued") return "taken" as const;
            const used = Number(ds.data()?.sent ?? 0);
            if (used >= s.dailyBudget) return "budget" as const;
            tx.set(dayRef, { sent: used + 1, at: now() }, { merge: true });
            tx.update(next.ref, { status: "sending", leaseAt: now(), attempts: FieldValue.increment(1) });
            return "ok" as const;
          });
          if (claim === "stopped") break;
          if (claim === "held") return { sent, why: "held" };
          if (claim === "taken") continue;
          if (claim === "budget") {
            // Not a hold: the budget is read afresh at every claim, so raising it carries on at once.
            await ref.update({ pauseReason: `Today's ${s.dailyBudget} campaign emails are sent — it carries on after midnight (IST), or raise the budget in Settings` });
            return { sent, why: "budget" };
          }
          const r = next.data() as { email: string; name?: string; company?: string; kind: Person["kind"]; attempts?: number };
          const refund = () => dayRef.set({ sent: FieldValue.increment(-1) }, { merge: true });
          const giveBack = async (why: string) => { await next.ref.update({ status: "queued", why, leaseAt: FieldValue.delete() }); await refund(); };
          let out;
          try {
            if (r.kind === "client" && await isSuppressed(r.email)) {
              await next.ref.update({ status: "skipped", why: "Unsubscribed", leaseAt: FieldValue.delete() });
              await ref.update({ "counts.skipped": FieldValue.increment(1), "counts.queued": FieldValue.increment(-1) });
              await refund();
              continue;
            }
            // Anything that goes wrong before the email is handed over: nothing went — back in the queue.
            out = await sendTo(frozen, s, { email: r.email, name: r.name ?? undefined, company: r.company ?? undefined, kind: r.kind });
          } catch (e) {
            await giveBack(`Couldn't prepare it: ${(e as Error).message?.slice(0, 120)}`).catch(() => undefined);
            throw e;
          }
          if (out.ok) {
            failsInRow = 0;
            await bookkeep(() => next.ref.update({ status: "sent", sentAt: now(), messageId: out.messageId ?? null, leaseAt: FieldValue.delete(), why: FieldValue.delete() }));
            await bookkeep(() => ref.update({ "counts.sent": FieldValue.increment(1), "counts.queued": FieldValue.increment(-1), lastSentAt: now(), ...(c.pauseReason ? { pauseReason: FieldValue.delete() } : {}) }));
            c.pauseReason = undefined;
            sent++;
          } else if (out.retry) {
            // Nothing was sent: back in the queue, its budget given back.
            const tries = (r.attempts ?? 0) + 1;
            if (!out.pauseAll && tries >= 5) {
              await next.ref.update({ status: "failed", why: out.why, leaseAt: FieldValue.delete() });
              await ref.update({ "counts.failed": FieldValue.increment(1), "counts.queued": FieldValue.increment(-1) });
              await refund();
            } else await giveBack(out.why);
            if (out.pauseAll) {
              await holdAll(out.quota ? Date.parse(nextIstMidnight()) - Date.now() : /password/.test(out.why) ? 30 * 60_000 : 15 * 60_000, out.why);
              await ref.update({ pauseReason: out.why });
              return { sent, why: out.why };
            }
            stopCampaign = true;
          } else {
            const unsure = "unsure" in out && out.unsure;
            await bookkeep(() => next.ref.update({ status: unsure ? "unsure" : "failed", why: out.why, leaseAt: FieldValue.delete() }));
            await bookkeep(() => ref.update({ [`counts.${unsure ? "unsure" : "failed"}`]: FieldValue.increment(1), "counts.queued": FieldValue.increment(-1) }));
            if ("bounce" in out && out.bounce) await suppress(r.email, "bounced", c.id).catch(() => undefined);
            // Several refusals in a row that aren't about one address: the mailbox itself — everything waits.
            if (!("bounce" in out && out.bounce) && ++failsInRow >= 3) {
              await holdAll(60 * 60_000, `Gmail refused 3 emails in a row (${out.why}) — everything waits an hour`);
              return { sent, why: "failing" };
            }
          }
          await sleep(SEND_GAP_MS);
        }
        // All of it gone: done, with its exact figures — only if nobody changed it meanwhile.
        const left = await ref.collection("recipients").where("status", "in", ["queued", "sending"]).limit(1).get();
        if (left.empty) {
          const counts = await recount(ref);
          await db.runTransaction(async tx => {
            if ((await tx.get(ref)).data()?.status === "sending") tx.update(ref, { status: "done", finishedAt: now(), counts, resumeAt: FieldValue.delete(), pauseReason: FieldValue.delete() });
          });
        }
      } catch (e) {
        // One campaign's trouble never stops the others.
        console.error(`[campaigns] ${c.id}:`, e);
        await ref.update({ pauseReason: `Something went wrong — tried again in a minute (${(e as Error).message?.slice(0, 120)})` }).catch(() => undefined);
      }
    }
    return { sent };
  } finally {
    closeTransport();
    await db.runTransaction(async tx => { if ((await tx.get(lock)).data()?.by === me) tx.delete(lock); }).catch(() => undefined);
  }
}

export const campaignTick = onSchedule({ schedule: "every 1 minutes", region: REGION, secrets: [SMTP_PASSWORD], memory: "256MiB", timeoutSeconds: 60, retryCount: 0, maxInstances: 1 }, async () => {
  await runBatch();
});

export const campaignRunNow = onCall({ region: REGION, secrets: [SMTP_PASSWORD], memory: "256MiB", maxInstances: 2, timeoutSeconds: 60 }, async req => {
  await requireAdmin(req.auth as never);
  return await runBatch(30_000);
});

/* ─────────────── Control ─────────────── */

type Action = "pause" | "resume" | "cancel" | "retryFailed" | "retryUnsure" | "delete" | "unsubscribe" | "resubscribe" | "recount" | "bounced" | "clearHold";

export const campaignControl = onCall<{ action: Action; campaignId?: string; email?: string }>(
  { region: REGION, memory: "256MiB", maxInstances: 3, timeoutSeconds: 300 }, async req => {
    const me = await requireAdmin(req.auth as never);
    const a = req.data?.action;
    if (a === "unsubscribe" || a === "resubscribe") {
      const e = cleanEmail(req.data?.email);
      if (!EMAIL_RE.test(e)) throw new HttpsError("invalid-argument", "A valid email");
      if (a === "unsubscribe") await suppress(e, "added", undefined, me.uid);
      else await db.collection(SUPPRESS).doc(emailKey(e)).delete();
      return { ok: true };
    }
    // The mailbox's wait, lifted by hand (the password was fixed, say). It comes back if Gmail says stop again.
    if (a === "clearHold") { await HOLD().delete(); return { ok: true }; }
    const { ref, c } = await loadCampaign(req.data?.campaignId);
    const set = async (from: string[], patch: Record<string, unknown>) => {
      await db.runTransaction(async tx => {
        const st = (await tx.get(ref)).data()?.status;
        if (!from.includes(st)) throw new HttpsError("failed-precondition", `It is ${st} now`);
        tx.update(ref, { ...patch, updatedAt: now(), [`lastBy`]: me.uid });
      });
    };
    if (a === "pause") { await set(["sending", "scheduled"], { status: "paused", pauseReason: "Paused by an admin", resumeAt: FieldValue.delete() }); return { ok: true }; }
    if (a === "resume") { await set(["paused"], { status: c.scheduleAt && Date.parse(c.scheduleAt) > Date.now() ? "scheduled" : "sending", pauseReason: FieldValue.delete(), resumeAt: FieldValue.delete() }); return { ok: true }; }
    if (a === "cancel") { await set(["sending", "scheduled", "paused"], { status: "cancelled", finishedAt: now(), resumeAt: FieldValue.delete() }); await ref.update({ counts: await recount(ref) }); return { ok: true }; }
    if (a === "recount") { if (c.status === "draft") return { ok: true }; await ref.update({ counts: await recount(ref) }); return { ok: true }; }
    // An email that came back later (Gmail reports most bounces by email, to the mailbox): this
    // address is kept off every list, and the person shown as not reached.
    if (a === "bounced") {
      const e = cleanEmail(req.data?.email);
      if (!EMAIL_RE.test(e)) throw new HttpsError("invalid-argument", "A valid email");
      await suppress(e, "bounced", c.id, me.uid);
      const r = ref.collection("recipients").doc(emailKey(e));
      if ((await r.get()).exists) await r.update({ status: "failed", why: "Bounced — marked by an admin", bouncedAt: now() });
      if (c.status !== "draft") await ref.update({ counts: await recount(ref) });
      return { ok: true };
    }
    if (a === "retryFailed" || a === "retryUnsure") {
      if (!["done", "sending", "paused"].includes(c.status) || (c as { deleting?: boolean }).deleting) throw new HttpsError("failed-precondition", `It is ${c.status} now`);
      const st: RecipientStatus = a === "retryFailed" ? "failed" : "unsure";
      const rows = (await ref.collection("recipients").where("status", "==", st).get()).docs;
      // Bounced and unsubscribed addresses stay off (read together, not one by one).
      const off = new Set<string>();
      for (let i = 0; i < rows.length; i += 100) for (const d of await db.getAll(...rows.slice(i, i + 100).map(r => db.collection(SUPPRESS).doc(r.id)))) if (d.exists) off.add(d.id);
      const take = rows.filter(d => !(d.data().kind === "client" && off.has(d.id)));
      // Only while nobody cancelled or deleted it meanwhile — then the rows go back in the queue.
      await db.runTransaction(async tx => {
        const cur = (await tx.get(ref)).data() as CampaignDoc & { deleting?: boolean };
        if (cur.status !== c.status || cur.deleting) throw new HttpsError("aborted", `It is ${cur.status} now — try again`);
        if (take.length) tx.update(ref, { status: c.status === "paused" ? "paused" : "sending", finishedAt: FieldValue.delete(), updatedAt: now() });
      });
      for (let i = 0; i < take.length; i += BATCH) {
        const b = db.batch();
        for (const d of take.slice(i, i + BATCH)) b.update(d.ref, { status: "queued", attempts: 0, why: FieldValue.delete() });
        await b.commit();
      }
      if (take.length) await ref.update({ counts: await recount(ref) });
      return { ok: true, count: take.length };
    }
    if (a === "delete") {
      // Marked first, in one step with the check — a retry or a resume started meanwhile is refused.
      await db.runTransaction(async tx => {
        const st = (await tx.get(ref)).data()?.status;
        if (["sending", "scheduled", "paused", "starting"].includes(st)) throw new HttpsError("failed-precondition", "Cancel it first — it is still going out");
        tx.update(ref, { deleting: true });
      });
      await clearRecipients(ref);
      for (;;) {
        const v = await db.collection(VERSIONS).where("campaignId", "==", c.id).limit(BATCH).get();
        if (v.empty) break;
        const b = db.batch(); v.docs.forEach(d => b.delete(d.ref)); await b.commit();
      }
      await ref.delete();
      return { ok: true };
    }
    throw new HttpsError("invalid-argument", "Unknown action");
  });

/* ─────────────── Unsubscribe ─────────────── */

const page = (title: string, body: string) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${title}</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f6f6f4;font:16px/1.55 system-ui,-apple-system,Segoe UI,Arial,sans-serif;color:#1f2937}main{max-width:440px;margin:24px;padding:32px;border-radius:18px;background:#fff;border:1px solid #e5e7eb;text-align:center}
h1{font-size:21px;margin:0 0 10px}p{color:#4b5563;margin:6px 0}button{margin-top:18px;padding:12px 22px;border:0;border-radius:10px;background:#1f2937;color:#fff;font-size:15px;font-weight:600;cursor:pointer}</style></head><body><main>${body}</main></body></html>`;
const esc = (s: string) => s.replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]!));

export const campaignUnsub = onRequest({ region: REGION, memory: "256MiB", maxInstances: 5, timeoutSeconds: 30, invoker: "public" }, async (req, res) => {
  res.set("Cache-Control", "no-store");
  res.set("Content-Type", "text/html; charset=utf-8");
  const s = await getSettings();
  const who = esc(s.fromName || BRAND.name);
  const tok = await readUnsubToken(String(req.query.t ?? ""));
  if (!tok) { res.status(400).send(page("Link not valid", `<h1>This link isn't valid</h1><p>Reply to any of our emails with "unsubscribe" and we'll take you off.</p>`)); return; }
  if (req.method === "POST") {
    // One click from the mail program (RFC 8058), or the button below: off at once.
    await suppress(tok.email, "unsubscribed", tok.campaignId);
    const r = db.collection(CAMPAIGNS).doc(tok.campaignId).collection("recipients").doc(emailKey(tok.email));
    await db.runTransaction(async tx => {
      const d = await tx.get(r);
      if (d.exists && !d.data()?.unsubscribedAt) {
        tx.update(r, { unsubscribedAt: now() });
        tx.update(db.collection(CAMPAIGNS).doc(tok.campaignId), { "counts.unsubscribed": FieldValue.increment(1) });
      }
    }).catch(() => undefined);
    res.status(200).send(page("Unsubscribed", `<h1>You're unsubscribed</h1><p><b>${esc(tok.email)}</b> won't get emails like this from ${who} again.</p><p>Emails about your own orders still come.</p>`));
    return;
  }
  // A link opened (or checked by a mail scanner) only asks — it never unsubscribes by itself.
  const done = (await isSuppressed(tok.email))
    ? `<h1>Already unsubscribed</h1><p><b>${esc(tok.email)}</b> gets no emails like this from ${who}.</p>`
    : `<h1>Unsubscribe?</h1><p>Stop emails like this from ${who} to <b>${esc(tok.email)}</b>.</p><form method="post"><button type="submit">Unsubscribe</button></form><p style="font-size:13px;margin-top:16px">Emails about your own orders still come.</p>`;
  res.status(200).send(page("Unsubscribe", done));
});
