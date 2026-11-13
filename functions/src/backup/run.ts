/**
 * Backups every 6 hours, each one checked — the server's own job, so it runs
 * whether or not anyone opens the app.
 *
 *  • backupEvery6h (00:00, 06:00, 12:00, 18:00 India time): every collection of
 *    the database (and the campaigns' recipient lists) into one file in Storage,
 *    backups/server/ — the admin-only folder (storage.rules). Format: backup/format.ts.
 *  • The restore test, straight after: the file is read back from Storage, every
 *    line parsed, each collection's count and fingerprint compared with what was
 *    written, and the counts with the live database. Anything wrong alerts every
 *    partner at once (Software health).
 *  • Kept: every backup for 7 days, then the first of each day for 30 days; older
 *    ones are deleted — only files in backups/server/, nothing else in Storage.
 *  • backupNow: the same, on an admin's press (Settings → Data & Backup).
 * Each run is one record in `backupRuns` (admins read; only the server writes).
 */
import { onSchedule } from "firebase-functions/v2/scheduler";
import { onCall, HttpsError, type CallableRequest } from "firebase-functions/v2/https";
import { createGzip, createGunzip } from "node:zlib";
import { createInterface } from "node:readline";
import { pipeline } from "node:stream/promises";
import { FieldPath, type CollectionReference, type QueryDocumentSnapshot } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { app, db } from "../lib/firestoreAdmin";
import { REGION } from "../region";
import { SMTP_PASSWORD } from "../mail";
import { OWNER_EMAILS } from "../summaries";
import { raise, whoIs } from "../health/core";
import { FOLDER, Hashes, enc, fileName, parseName, type BackupKind, type End, type Head } from "./format";

export const RUNS = "backupRuns";
/** Never backed up: the server's passing counters, who is online and typing, and the runs themselves. */
export const SKIP = new Set(["healthCounters", "presence", "typing", RUNS]);
/** Lists kept under each record of a collection: campaigns/{id}/recipients. */
const SUBS: [string, string][] = [["campaigns", "recipients"]];
const PAGE = 500;
const DAY = 86_400_000;

export interface BackupRun {
  id: string;
  path: string;
  at: string;
  kind: BackupKind;
  by?: string;
  byName?: string;
  records: number;
  collections: Record<string, number>;
  bytes: number;
  ms: number;
  verified: { at: string; ok: boolean; problems: string[]; notes: string[] };
}

const bucket = () => getStorage(app).bucket();
const runId = (path: string) => path.slice(FOLDER.length).replace(/\.ndjson\.gz$/, "");

/** Write one backup file. */
async function writeBackup(kind: BackupKind, by?: string): Promise<{ path: string; at: string; counts: Record<string, number>; hashes: Record<string, string>; records: number }> {
  const at = new Date().toISOString();
  const path = fileName(at, kind);
  const gz = createGzip();
  const done = pipeline(gz, bucket().file(path).createWriteStream({ resumable: false, contentType: "application/gzip", metadata: { metadata: { kind, at } } }));
  const write = (s: string) => new Promise<void>(res => { if (gz.write(`${s}\n`)) res(); else gz.once("drain", () => res()); });
  const counts: Record<string, number> = {};
  const hashes = new Hashes();
  let records = 0;
  await write(JSON.stringify({ t: "head", v: 1, at, kind, db: "diamondflow", ...(by ? { by } : {}) } satisfies Head));

  const dump = async (ref: CollectionReference, name: string) => {
    counts[name] = counts[name] ?? 0;
    let last: QueryDocumentSnapshot | undefined;
    for (;;) {
      let q = ref.orderBy(FieldPath.documentId()).limit(PAGE);
      if (last) q = q.startAfter(last);
      const s = await q.get();
      for (const d of s.docs) {
        const line = JSON.stringify({ t: "doc", c: name, id: d.id, d: enc(d.data()) });
        hashes.add(name, line);
        counts[name]++;
        records++;
        await write(line);
      }
      if (s.size < PAGE) break;
      last = s.docs[s.size - 1];
    }
  };

  const cols = (await db.listCollections()).map(c => c.id).filter(id => !SKIP.has(id)).sort();
  for (const c of cols) await dump(db.collection(c), c);
  for (const [parent, sub] of SUBS) {
    if (!cols.includes(parent)) continue;
    const parents = await db.collection(parent).select().get();
    for (const p of parents.docs) {
      const name = `${parent}/${p.id}/${sub}`;
      await dump(p.ref.collection(sub), name);
      if (!counts[name]) delete counts[name]; // no list under this one
    }
  }
  const end: End = { t: "end", counts, hashes: hashes.done(), records };
  await write(JSON.stringify(end));
  gz.end();
  await done;
  return { path, at, counts, hashes: end.hashes, records };
}

/** The restore test: read the file back and check it is whole and readable. */
export async function verifyBackup(path: string, wrote: { counts: Record<string, number>; hashes: Record<string, string> }): Promise<BackupRun["verified"]> {
  const problems: string[] = [], notes: string[] = [];
  const counts: Record<string, number> = {};
  const hashes = new Hashes();
  let head = false, end: End | null = null, n = 0;
  try {
    const rl = createInterface({ input: bucket().file(path).createReadStream().pipe(createGunzip()), crlfDelay: Infinity });
    for await (const line of rl) {
      if (!line) continue;
      n++;
      let o: { t?: string; c?: string };
      try { o = JSON.parse(line); } catch { problems.push(`Line ${n} can't be read`); break; }
      if (o.t === "head") head = true;
      else if (o.t === "doc" && o.c) { counts[o.c] = (counts[o.c] ?? 0) + 1; hashes.add(o.c, line); }
      else if (o.t === "end") end = o as End;
    }
  } catch (e) {
    problems.push(`The file can't be read back: ${String(e).slice(0, 160)}`);
  }
  if (!head) problems.push("The file has no start");
  if (!end) problems.push("The file ends early — it was cut off");
  const got = hashes.done();
  for (const [c, k] of Object.entries(wrote.counts)) {
    if ((counts[c] ?? 0) !== k) problems.push(`${c}: ${k} written, ${counts[c] ?? 0} read back`);
    else if (k > 0 && got[c] !== wrote.hashes[c]) problems.push(`${c}: read back differently from what was written`);
  }
  // And against the database now: a few records added or removed while it ran are normal.
  for (const [c, k] of Object.entries(wrote.counts)) {
    if (c.includes("/")) continue;
    try {
      const live = (await db.collection(c).count().get()).data().count;
      const diff = live - k;
      if (!diff) continue;
      const big = Math.abs(diff) > Math.max(5, Math.ceil(live * 0.02));
      (big ? problems : notes).push(`${c}: ${k} in the backup, ${live} in the database now`);
    } catch { /* counted from the file alone */ }
  }
  return { at: new Date().toISOString(), ok: problems.length === 0, problems, notes };
}

/** Keep every backup for 7 days, then the first of each day for 30 days. */
async function prune(): Promise<number> {
  const [files] = await bucket().getFiles({ prefix: FOLDER });
  const list = files.map(f => ({ f, p: parseName(f.name) })).filter(x => x.p).sort((a, b) => a.p!.at.localeCompare(b.p!.at));
  const now = Date.now();
  const dayKept = new Set<string>();
  let gone = 0;
  for (const { f, p } of list) {
    const age = now - new Date(p!.at).getTime();
    if (age <= 7 * DAY) continue;
    const day = new Date(new Date(p!.at).getTime() + 5.5 * 3600_000).toISOString().slice(0, 10); // India's day
    if (age <= 30 * DAY && !dayKept.has(day)) { dayKept.add(day); continue; }
    try {
      await f.delete();
      await db.collection(RUNS).doc(runId(f.name)).delete().catch(() => {});
      gone++;
    } catch { /* tried again next time */ }
  }
  return gone;
}

/** One backup, checked, recorded — and an alert if anything is wrong. */
export async function runBackup(kind: BackupKind, by?: { uid?: string; name?: string }): Promise<BackupRun> {
  const t0 = Date.now();
  const w = await writeBackup(kind, by?.uid);
  const verified = await verifyBackup(w.path, w);
  const [meta] = await bucket().file(w.path).getMetadata();
  const run: BackupRun = {
    id: runId(w.path), path: w.path, at: w.at, kind, ...(by?.uid ? { by: by.uid } : {}), ...(by?.name ? { byName: by.name } : {}),
    records: w.records, collections: w.counts, bytes: Number(meta.size ?? 0), ms: Date.now() - t0, verified,
  };
  await db.collection(RUNS).doc(run.id).set(JSON.parse(JSON.stringify(run)));
  if (!verified.ok) {
    await raise({ kind: "backupBad", severity: "critical", title: "A backup failed its check", detail: `The backup of ${new Date(w.at).toLocaleString("en-GB", { timeZone: "Asia/Kolkata" })} didn't read back whole: ${verified.problems.slice(0, 3).join("; ")}. The next one is in 6 hours — or take one now in Settings → Data & Backup.` }, "backupBad", 360);
  }
  if (kind === "auto") await prune();
  return run;
}

export const backupEvery6h = onSchedule(
  { region: REGION, schedule: "0 */6 * * *", timeZone: "Asia/Kolkata", secrets: [SMTP_PASSWORD], memory: "1GiB", timeoutSeconds: 540, maxInstances: 1 },
  async () => {
    try {
      await runBackup("auto");
    } catch (e) {
      console.error("[backup] failed:", e);
      await raise({ kind: "backupBad", severity: "critical", title: "The 6-hourly backup failed", detail: `It stopped with: ${String(e).slice(0, 240)}. Take one now in Settings → Data & Backup.` }, "backupFail", 360);
      throw e;
    }
  },
);

/** An admin, or an owner (the main admin). */
export async function adminCaller(req: CallableRequest): Promise<{ uid: string; owner: boolean; name?: string }> {
  const uid = req.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Sign in first.");
  const email = String(req.auth?.token?.email ?? "").toLowerCase();
  const owner = (OWNER_EMAILS.diamondflow as string[]).includes(email);
  const idx = (await db.collection("userByAuth").doc(uid).get()).data() as { role?: string; status?: string } | undefined;
  if (!owner && !(idx?.role === "admin" && idx?.status === "active")) throw new HttpsError("permission-denied", "Only an admin can do this.");
  const who = await whoIs(uid);
  return { uid, owner, name: who?.name ?? email };
}

export const backupNow = onCall(
  { region: REGION, secrets: [SMTP_PASSWORD], memory: "1GiB", timeoutSeconds: 540, maxInstances: 2 },
  async req => {
    const me = await adminCaller(req);
    const last = await db.collection(RUNS).orderBy("at", "desc").limit(1).get();
    const lastAt = last.docs[0]?.data().at as string | undefined;
    if (lastAt && Date.now() - new Date(lastAt).getTime() < 5 * 60_000) throw new HttpsError("failed-precondition", "A backup was taken in the last 5 minutes — that one is current.");
    const run = await runBackup("manual", { uid: me.uid, name: me.name });
    return { id: run.id, records: run.records, ok: run.verified.ok, problems: run.verified.problems };
  },
);
