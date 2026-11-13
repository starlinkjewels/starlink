/**
 * Safe restore — the main admin brings back what a backup holds, without ever
 * losing anything newer.
 *
 *  • Scope: everything, one collection, or one record.
 *  • Plan first ("plan"): for each record of the backup in scope — missing now
 *    (will be added), different now (will be put back as it was in the backup),
 *    or the same. Records made since the backup are never touched or removed.
 *  • Then apply ("apply"): a fresh backup is taken first (so the restore itself
 *    can be undone from it), then only what is missing or different is written,
 *    in batches. Every partner is told (Software health).
 *
 * Reads a server backup (backup/format.ts) or an older one the app made (one
 * JSON snapshot: arrays per collection, `settings` → meta/settings), from the
 * admin-only backups/ folder. Only the main admin (an owner login) may restore.
 */
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { createGunzip } from "node:zlib";
import { createInterface } from "node:readline";
import { getStorage } from "firebase-admin/storage";
import { app, db } from "../lib/firestoreAdmin";
import { REGION } from "../region";
import { SMTP_PASSWORD } from "../mail";
import { raise } from "../health/core";
import { dec, enc, stable } from "./format";
import { adminCaller, runBackup, SKIP } from "./run";

/** Never written back: the server's own watch, the runs and live session bits. */
const NO_RESTORE = new Set([...SKIP, "securityEvents", "healthState", "healthDevices", "userByAuth"]);

type Scope = { kind: "all" } | { kind: "collection"; collection: string } | { kind: "doc"; collection: string; id: string };
interface Rec { c: string; id: string; d: Record<string, unknown> }
interface Tally { c: string; add: number; change: number; same: number }

/** Every record a backup holds, one by one. */
async function* readBackup(path: string): AsyncGenerator<Rec> {
  if (!path.startsWith("backups/")) throw new HttpsError("invalid-argument", "Not a backup.");
  const file = getStorage(app).bucket().file(path);
  const [exists] = await file.exists();
  if (!exists) throw new HttpsError("not-found", "That backup is no longer there.");
  if (path.endsWith(".ndjson.gz")) {
    const rl = createInterface({ input: file.createReadStream().pipe(createGunzip()), crlfDelay: Infinity });
    for await (const line of rl) {
      if (!line) continue;
      const o = JSON.parse(line) as { t: string; c: string; id: string; d: Record<string, unknown> };
      if (o.t === "doc") yield { c: o.c, id: o.id, d: o.d };
    }
    return;
  }
  // An older backup made by the app: the whole database as one JSON object.
  const [buf] = await file.download();
  const snap = JSON.parse(buf.toString("utf8")) as Record<string, unknown>;
  const known = new Set((await db.listCollections()).map(c => c.id));
  for (const [k, v] of Object.entries(snap)) {
    if (k === "settings" && v && typeof v === "object" && !Array.isArray(v)) { yield { c: "meta", id: "settings", d: v as Record<string, unknown> }; continue; }
    if (!Array.isArray(v) || !known.has(k)) continue;
    for (const x of v) if (x && typeof x === "object" && (x as { id?: unknown }).id != null) yield { c: k, id: String((x as { id: unknown }).id), d: x as Record<string, unknown> };
  }
}

const inScope = (s: Scope, r: Rec) => !NO_RESTORE.has(r.c.split("/")[0])
  && (s.kind === "all" || (s.kind === "collection" ? r.c === s.collection : r.c === s.collection && r.id === s.id));

/** Go through the backup in scope: what is missing, what differs — and, applying, write those. */
async function walk(path: string, scope: Scope, apply: boolean): Promise<{ tallies: Tally[]; samples: { c: string; id: string; what: "add" | "change" }[]; written: number }> {
  const tallies = new Map<string, Tally>();
  const samples: { c: string; id: string; what: "add" | "change" }[] = [];
  let written = 0;
  let chunk: Rec[] = [];
  const flush = async () => {
    if (!chunk.length) return;
    const live = await db.getAll(...chunk.map(r => db.doc(`${r.c}/${r.id}`)));
    let batch = db.batch(), inBatch = 0;
    chunk.forEach((r, i) => {
      const t = tallies.get(r.c) ?? { c: r.c, add: 0, change: 0, same: 0 };
      tallies.set(r.c, t);
      const now = live[i];
      const what = !now.exists ? "add" : stable(enc(now.data())) !== stable(r.d) ? "change" : "same";
      t[what]++;
      if (what === "same") return;
      if (samples.length < 60) samples.push({ c: r.c, id: r.id, what });
      if (apply) { batch.set(db.doc(`${r.c}/${r.id}`), dec(r.d) as Record<string, unknown>); inBatch++; }
    });
    if (apply && inBatch) { await batch.commit(); written += inBatch; batch = db.batch(); }
    chunk = [];
  };
  for await (const r of readBackup(path)) {
    if (!inScope(scope, r)) continue;
    chunk.push(r);
    if (chunk.length >= 300) await flush();
  }
  await flush();
  return { tallies: [...tallies.values()].sort((a, b) => a.c.localeCompare(b.c)), samples, written };
}

export const backupRestore = onCall<{ path?: unknown; scope?: unknown; mode?: unknown }>(
  { region: REGION, secrets: [SMTP_PASSWORD], memory: "1GiB", timeoutSeconds: 540, maxInstances: 1 },
  async req => {
    const me = await adminCaller(req);
    if (!me.owner) throw new HttpsError("permission-denied", "Only the main admin can restore a backup.");
    const path = String(req.data?.path ?? "");
    const raw = (req.data?.scope ?? {}) as { kind?: string; collection?: unknown; id?: unknown };
    const scope: Scope = raw.kind === "collection" && raw.collection ? { kind: "collection", collection: String(raw.collection) }
      : raw.kind === "doc" && raw.collection && raw.id ? { kind: "doc", collection: String(raw.collection), id: String(raw.id) }
      : { kind: "all" };
    const apply = req.data?.mode === "apply";
    if (scope.kind !== "all" && NO_RESTORE.has(scope.collection.split("/")[0])) throw new HttpsError("invalid-argument", "That isn't something a restore puts back.");

    // Applying: a backup of things as they are now, first — the restore can be undone from it.
    const before = apply ? await runBackup("before-restore", { uid: me.uid, name: me.name }) : null;
    const res = await walk(path, scope, apply);
    const add = res.tallies.reduce((t, x) => t + x.add, 0), change = res.tallies.reduce((t, x) => t + x.change, 0);
    if (apply && res.written) {
      const what = scope.kind === "all" ? "everything" : scope.kind === "collection" ? scope.collection : `${scope.collection}/${scope.id}`;
      await raise({
        kind: "backupRestored", severity: "critical", title: `A backup was restored (${what})`,
        detail: `${me.name ?? "The main admin"} restored ${what} from ${path.split("/").pop()}: ${add} added back, ${change} put back as they were. Nothing newer was removed. Before it, a backup was taken — ${before?.path.split("/").pop() ?? ""}.`,
        who: { uid: me.uid, name: me.name },
      }, `restore_${Date.now()}`, 1);
    }
    return { add, change, same: res.tallies.reduce((t, x) => t + x.same, 0), tallies: res.tallies, samples: res.samples, written: res.written, before: before?.path ?? null };
  },
);
