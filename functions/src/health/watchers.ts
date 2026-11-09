/**
 * Software health — the watchers (health/core.ts raises and alerts).
 *
 *  • healthTick (every 15 minutes): accounts nobody gave — switched off at once
 *    if they appeared after this started (older ones listed for review, never
 *    touched); staff switched off in the app who can still sign in; server jobs
 *    failing; the last backup; when the rules were last changed.
 *  • healthOnDelete: records deleted by a signed-in account — many in a short
 *    time is a mass delete, even when done round the app.
 *  • healthOnActivity: each change the app logs — mass deletes (records marked
 *    deleted too), bulk changes, someone made an admin, access changed, a
 *    closed year reopened.
 *  • healthDigest (each morning): everything else of the last day, in one email.
 */
import { onSchedule } from "firebase-functions/v2/scheduler";
import { onDocumentCreated, onDocumentDeletedWithAuthContext } from "firebase-functions/v2/firestore";
import { getAuth, type UserRecord } from "firebase-admin/auth";
import { getStorage } from "firebase-admin/storage";
import { applicationDefault } from "firebase-admin/app";
import { app, db } from "../lib/firestoreAdmin";
import { OWNER_EMAILS } from "../summaries";
import { SMTP_PASSWORD, deliverMail, closeMail } from "../mail";
import { REGION } from "../region";
import { emailHtml, esc } from "../pipelines/email";
import { BRAND, APP_URL } from "../pipelines/config";
import { raise, bump, partners, whoIs, EVENTS, STATE, COUNTERS, type HealthEvent } from "./core";

const DATABASE = "diamondflow";
/** A new account must have its sign-in record within this long (the app writes it at once). */
const GRACE_MIN = process.env.FUNCTIONS_EMULATOR === "true" && process.env.HEALTH_GRACE_MIN ? Number(process.env.HEALTH_GRACE_MIN) : 15;
/** Hard deletes (or records marked deleted) by one account in 10 minutes. */
const MASS_DELETE = 20;
/** Changes by one account in 10 minutes. */
const BULK_CHANGE = 300;
/** Never counted: alerts, chat, favourites, the logs and the server's own. */
const QUIET_COLS = new Set(["notifications", "messages", "chats", "catalogFavorites", "activityLog", "outbox", EVENTS, COUNTERS, STATE, "healthDevices", "userByAuth", "presence", "typing"]);

const projectId = () => process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT || (JSON.parse(process.env.FIREBASE_CONFIG ?? "{}").projectId as string);
const isOwnerEmail = (email?: string) => !!email && OWNER_EMAILS.diamondflow.includes(email.toLowerCase());

async function googleGet(url: string, body?: unknown): Promise<unknown> {
  const tok = await applicationDefault().getAccessToken();
  const r = await fetch(url, {
    method: body ? "POST" : "GET",
    headers: { authorization: `Bearer ${tok.access_token}`, ...(body ? { "content-type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) throw new Error(`${r.status} ${(await r.text()).slice(0, 200)}`);
  return r.json();
}

/* ── Every 15 minutes ───────────────────────────────────────────────────── */

export const healthTick = onSchedule(
  { region: REGION, schedule: "every 15 minutes", timeZone: "Asia/Kolkata", secrets: [SMTP_PASSWORD], memory: "256MiB", timeoutSeconds: 300, maxInstances: 1 },
  async () => {
    const stateRef = db.collection(STATE).doc("main");
    const state = (await stateRef.get()).data() ?? {};
    const now = Date.now();
    // The first run: what is there now is the starting point — reviewed, never switched off.
    const since: string = state.since ?? new Date(now).toISOString();
    const allowed = new Set<string>(Array.isArray(state.allowed) ? state.allowed : []);
    const out: Record<string, unknown> = { since, lastTickAt: new Date(now).toISOString() };

    // ── Accounts ──
    try {
      const idx = new Map<string, { role?: string; status?: string; appId?: string }>();
      for (const d of (await db.collection("userByAuth").get()).docs) idx.set(d.id, d.data());
      const users: UserRecord[] = [];
      let page: string | undefined;
      do { const r = await getAuth(app).listUsers(1000, page); users.push(...r.users); page = r.pageToken; } while (page);
      const unknownOld: unknown[] = [], switchedOff: unknown[] = [], inactiveCanSignIn: unknown[] = [];
      for (const u of users) {
        const rec = idx.get(u.uid);
        const created = new Date(u.metadata.creationTime).getTime();
        const lastIn = u.metadata.lastSignInTime ? new Date(u.metadata.lastSignInTime).getTime() : 0;
        if (rec) {
          if (rec.status !== "active" && !u.disabled) inactiveCanSignIn.push({ uid: u.uid, email: u.email ?? "", role: rec.role ?? "" });
          continue;
        }
        if (isOwnerEmail(u.email) || allowed.has(u.uid)) continue;
        const line = { uid: u.uid, email: u.email ?? "", created: u.metadata.creationTime, lastSignIn: u.metadata.lastSignInTime ?? null, disabled: !!u.disabled };
        if (created >= new Date(since).getTime()) {
          // New since this started, and no sign-in record after the grace: nobody here made it.
          if (now - created < GRACE_MIN * 60_000) continue;
          if (!u.disabled) {
            await getAuth(app).updateUser(u.uid, { disabled: true });
            await getAuth(app).revokeRefreshTokens(u.uid);
            line.disabled = true;
            await raise({
              kind: "unknownAccount", severity: "critical",
              title: "An unknown account was created — switched off",
              detail: `${u.email || "An account with no email"} was created ${new Date(created).toLocaleString("en-GB", { timeZone: "Asia/Kolkata" })} and is not one of your team or clients, so it was switched off at once. If it is someone you added, an owner can switch it back on in Settings → Software health.`,
              account: { uid: u.uid, email: u.email, disabled: true },
            }, u.uid, 525_600);
          }
          switchedOff.push(line);
        } else {
          unknownOld.push(line);
          // An old unknown account signing in now — told at once, left as it is for an owner to decide.
          if (lastIn > new Date(state.lastTickAt ?? since).getTime() && !u.disabled) {
            await raise({
              kind: "unknownSignin", severity: "critical",
              title: "An account that is not one of yours signed in",
              detail: `${u.email || "An account with no email"} signed in. It has no place in the app (no team or client record), so it can see nothing of the business data — but it should not be signing in. Switch it off in Settings → Software health unless you know it.`,
              account: { uid: u.uid, email: u.email, disabled: false },
            }, `${u.uid}_${u.metadata.lastSignInTime}`, 1440);
          }
        }
      }
      out.accounts = { total: users.length, unknownOld: unknownOld.slice(0, 50), switchedOff: switchedOff.slice(0, 50), inactiveCanSignIn: inactiveCanSignIn.slice(0, 50), checkedAt: new Date().toISOString() };
    } catch (e) {
      out.accounts = { error: String(e).slice(0, 200), checkedAt: new Date().toISOString() };
    }

    // ── Server jobs failing (their error logs since the last check) ──
    try {
      const from = new Date(Math.max(now - 3600_000, new Date(state.lastTickAt ?? now - 900_000).getTime())).toISOString();
      const r = await googleGet("https://logging.googleapis.com/v2/entries:list", {
        resourceNames: [`projects/${projectId()}`],
        filter: `resource.type="cloud_run_revision" AND severity>=ERROR AND timestamp>="${from}"`,
        orderBy: "timestamp desc", pageSize: 200,
      }) as { entries?: { resource?: { labels?: Record<string, string> }; textPayload?: string; jsonPayload?: { message?: string } }[] };
      const byJob = new Map<string, { n: number; msg: string }>();
      for (const e of r.entries ?? []) {
        const job = e.resource?.labels?.service_name ?? "unknown";
        const cur = byJob.get(job) ?? { n: 0, msg: String(e.textPayload ?? e.jsonPayload?.message ?? "").slice(0, 240) };
        cur.n++; byJob.set(job, cur);
      }
      for (const [job, x] of byJob) {
        await raise({ kind: "jobError", severity: "warning", title: `Server job failing: ${job}`, detail: `${x.n} error${x.n === 1 ? "" : "s"} since the last check. The latest: ${x.msg || "(no message)"}` }, job, 360);
      }
      out.jobs = { checkedAt: new Date().toISOString(), failing: Object.fromEntries([...byJob].map(([k, v]) => [k, v.n])) };
    } catch (e) {
      out.jobs = { checkedAt: new Date().toISOString(), error: String(e).slice(0, 200) };
    }

    // ── The last backup (the app's own, in Storage backups/) ──
    try {
      const [files] = await getStorage(app).bucket().getFiles({ prefix: "backups/", maxResults: 400 });
      const last = files.map(f => ({ name: f.name, at: String(f.metadata.timeCreated ?? "") })).sort((a, b) => b.at.localeCompare(a.at))[0];
      out.backup = { lastAt: last?.at ?? null, name: last?.name ?? null, count: files.length };
      const age = last?.at ? now - new Date(last.at).getTime() : Infinity;
      if (age > 48 * 3600_000) {
        await raise({ kind: "backupLate", severity: "warning", title: "No backup in the last 2 days", detail: last?.at ? `The last backup is from ${new Date(last.at).toLocaleString("en-GB", { timeZone: "Asia/Kolkata" })}. It is made when an admin opens the app; or take one in Settings → Data & Backup.` : "No backup found. Take one in Settings → Data & Backup." }, "backup", 1440);
      }
    } catch (e) {
      out.backup = { error: String(e).slice(0, 200) };
    }

    // ── When the security rules were last changed ──
    try {
      const r = await googleGet(`https://firebaserules.googleapis.com/v1/projects/${projectId()}/releases?pageSize=50`) as { releases?: { name: string; updateTime: string }[] };
      const rel = r.releases ?? [];
      const pick = (re: RegExp) => rel.filter(x => re.test(x.name)).map(x => x.updateTime).sort().pop() ?? null;
      out.rules = { database: pick(/cloud\.firestore\/diamondflow$/), files: pick(/firebase\.storage/) };
    } catch (e) {
      out.rules = { error: String(e).slice(0, 200) };
    }

    // ── The partners alerts go to ──
    try { const p = await partners(); out.partners = { alerts: p.appIds.length, emails: p.emails }; } catch { /* shown as unknown */ }

    await stateRef.set(out, { merge: true });
    // Old counters out.
    const old = await db.collection(COUNTERS).where("expires", "<", new Date(now).toISOString()).limit(400).get();
    if (!old.empty) { const b = db.batch(); old.docs.forEach(d => b.delete(d.ref)); await b.commit(); }
  },
);

/* ── Records deleted by a signed-in account ─────────────────────────────── */

export const healthOnDelete = onDocumentDeletedWithAuthContext(
  { region: REGION, document: "{col}/{id}", database: DATABASE, secrets: [SMTP_PASSWORD], memory: "256MiB", maxInstances: 5, timeoutSeconds: 60 },
  async ev => {
    if (QUIET_COLS.has(ev.params.col)) return;
    // The server's own work (a service account) or a system job (TTL) is not anyone deleting.
    if (ev.authType === "service_account" || ev.authType === "system" || !ev.authId) return;
    const c = await bump(`del_${ev.authId}`, 10);
    if (c.n !== MASS_DELETE && !(c.n > MASS_DELETE && c.n % 50 === 0)) return;
    const who = await whoIs(ev.authId);
    await raise({
      kind: "massDelete", severity: "critical",
      title: `${who?.name ?? "Someone"} deleted ${c.n}+ records in 10 minutes`,
      detail: `${c.n} records deleted by ${who?.name ?? "an account"}${who?.email ? ` (${who.email})` : ""} in the last 10 minutes — the latest in ${ev.params.col}. If this was not them, deactivate the account now (Employees) and restore from Activity or a backup.`,
      who,
    }, ev.authId, 10);
  },
);

/* ── Each change the app logs ───────────────────────────────────────────── */

type Change = { col: string; id: string; op: "add" | "edit" | "delete"; before?: Record<string, unknown> | null; after?: Record<string, unknown> | null; label?: string; fields?: string[] };

export const healthOnActivity = onDocumentCreated(
  { region: REGION, document: "activityLog/{id}", database: DATABASE, secrets: [SMTP_PASSWORD], memory: "256MiB", maxInstances: 5, timeoutSeconds: 60 },
  async ev => {
    const a = ev.data?.data() as { actorUid?: string; actorId?: string; actorName?: string; kind?: string; changes?: Change[]; summary?: string; undoOf?: string } | undefined;
    if (!a || a.kind !== "change" || !Array.isArray(a.changes)) return;
    const who: HealthEvent["who"] = { uid: a.actorUid, appId: a.actorId, name: a.actorName };
    const by = a.actorName ?? "Someone";
    const changes = a.changes.filter(c => !QUIET_COLS.has(c.col));

    // Many deleted — or marked deleted — by one person in a short time. (Hard deletes are
    // counted by healthOnDelete too; one alert either way: the same event, the same window.)
    const removed = changes.filter(c => c.op === "delete" || (c.op === "edit" && !!c.after?.deletedAt && !c.before?.deletedAt)).length;
    if (removed && a.actorUid) {
      const c = await bump(`actdel_${a.actorUid}`, 10, removed);
      if (c.n >= MASS_DELETE && c.n - removed < MASS_DELETE) {
        await raise({ kind: "massDelete", severity: "critical", title: `${by} deleted ${c.n}+ records in 10 minutes`, detail: `${c.n} records deleted or marked deleted by ${by} in the last 10 minutes (the latest: ${a.summary ?? ""}). If this was not them, deactivate the account now (Employees) and put things back from Activity.`, who }, a.actorUid, 10);
      }
    }
    if (changes.length && a.actorUid) {
      const c = await bump(`actchg_${a.actorUid}`, 10, changes.length);
      if (c.n >= BULK_CHANGE && c.n - changes.length < BULK_CHANGE) {
        await raise({ kind: "bulkChange", severity: "critical", title: `${by} changed ${c.n}+ records in 10 minutes`, detail: `An unusual number of changes by ${by} in the last 10 minutes (the latest: ${a.summary ?? ""}). If this was not them, deactivate the account now and check Activity.`, who }, a.actorUid, 10);
      }
    }

    for (const c of changes) {
      // Someone made an admin — or no longer one.
      if (c.col === "users") {
        const was = c.before?.role, now = c.after?.role;
        const name = String(c.after?.name ?? c.before?.name ?? c.label ?? "someone");
        if (now === "admin" && was !== "admin") {
          await raise({ kind: "madeAdmin", severity: "critical", title: `${name} was made an admin`, detail: `${by} gave ${name} full admin access. If nobody meant to, remove it now (Employees → ⋯ → Remove admin).`, who }, `${c.id}_admin`, 60);
        } else if (was === "admin" && now && now !== "admin") {
          await raise({ kind: "accessChange", severity: "warning", title: `${name} is no longer an admin`, detail: `${by} removed ${name}'s admin access.`, who }, `${c.id}_unadmin`, 60);
        } else if (c.op === "edit" && (c.fields ?? []).some(f => ["roleId", "access", "tempAccess"].includes(f))) {
          await raise({ kind: "accessChange", severity: "warning", title: `${name}'s access was changed`, detail: `${by} changed what ${name} may see and do.`, who }, `${c.id}_access`, 60);
        }
      }
      // The access templates themselves.
      if (c.col === "roles") {
        await raise({ kind: "accessChange", severity: "warning", title: `Access ${c.op === "add" ? "added" : c.op === "delete" ? "removed" : "changed"}: ${c.label ?? c.id}`, detail: `${by} ${c.op === "add" ? "added" : c.op === "delete" ? "removed" : "changed"} the access "${c.label ?? c.id}".`, who }, `${c.id}_${a.actorUid}`, 60);
      }
      // A closed year opened again.
      if (c.col === "meta" && c.id === "settings") {
        const was = String(c.before?.booksClosedTo ?? ""), now = String(c.after?.booksClosedTo ?? "");
        if (was && (!now || now < was)) {
          await raise({ kind: "yearReopened", severity: "warning", title: "A closed year was reopened", detail: `${by} reopened the books${now ? ` — now closed only to ${now}` : ""} (they were closed to ${was}).`, who }, `${was}_${now}`, 60);
        }
      }
    }
  },
);

/* ── Each morning: the rest of the last day, in one email ───────────────── */

export const healthDigest = onSchedule(
  { region: REGION, schedule: "0 8 * * *", timeZone: "Asia/Kolkata", secrets: [SMTP_PASSWORD], memory: "256MiB", timeoutSeconds: 300, maxInstances: 1 },
  async () => {
    const from = new Date(Date.now() - 24 * 3600_000).toISOString();
    const snap = await db.collection(EVENTS).where("at", ">=", from).get();
    const evs = snap.docs.map(d => d.data() as HealthEvent).filter(e => e.kind !== "test").sort((a, b) => b.at.localeCompare(a.at));
    const state = (await db.collection(STATE).doc("main").get()).data() ?? {};
    const problems: string[] = [];
    const tickAge = state.lastTickAt ? Date.now() - new Date(state.lastTickAt).getTime() : Infinity;
    if (tickAge > 2 * 3600_000) problems.push("The health check itself has not run for over 2 hours.");
    if (!evs.length && !problems.length) return; // a quiet day: no email
    const sev = { critical: "Serious", warning: "Needs a look", info: "Info" } as const;
    const rows = evs.slice(0, 60).map(e => `<tr><td style="padding:6px 10px 6px 0;color:${BRAND.muted};white-space:nowrap;vertical-align:top;">${esc(new Date(e.at).toLocaleString("en-GB", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }))}</td><td style="padding:6px 10px 6px 0;vertical-align:top;font-weight:600;color:${e.severity === "critical" ? "#B91C1C" : e.severity === "warning" ? "#92400E" : "#374151"};">${sev[e.severity]}</td><td style="padding:6px 0;color:#111827;">${esc(e.title)}${e.count > 1 ? ` <span style="color:${BRAND.muted};">×${e.count}</span>` : ""}${e.handled ? ` <span style="color:#15803D;">— handled</span>` : ""}</td></tr>`).join("");
    const body = `${problems.length ? `<p style="margin:14px 0 0;color:#B91C1C;font-weight:600;">${problems.map(esc).join("<br>")}</p>` : ""}${rows ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:14px 0 6px;width:100%;border-collapse:collapse;font-size:13px;">${rows}</table>` : ""}`;
    const subject = `${BRAND.name} — Daily health summary: ${evs.length} item${evs.length === 1 ? "" : "s"}`;
    const html = emailHtml({ subject, text: `What the app's health and security checks found in the last 24 hours. Serious ones were already sent the moment they happened.\n\nThe full list is in ${APP_URL.replace(/^https?:\/\//, "")} → Settings → Software health.`, body });
    const { emails } = await partners();
    for (const to of emails) { try { await deliverMail(to, subject, html); } catch (e) { console.error("[health] digest to", to, "failed:", e); } }
    await closeMail();
  },
);
