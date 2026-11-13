// The server's backups every 6 hours (functions/src/backup/) as the app sees
// them: each run and its check, Back up now, and the main admin's safe restore
// — plan first, then apply. Older daily backups the app made itself are in
// lib/backup.ts; the restore reads those too.
import { collection, getDocs, limit, onSnapshot, orderBy, query, type Unsubscribe } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { ref, uploadBytes } from "firebase/storage";
import { db as fsdb, functions, storage } from "./firebase";
import { ensureFileClaims } from "./fileClaims";

export interface BackupRun {
  id: string;
  path: string;
  at: string;
  kind: "auto" | "manual" | "before-restore";
  byName?: string;
  records: number;
  collections: Record<string, number>;
  bytes: number;
  ms: number;
  verified: { at: string; ok: boolean; problems: string[]; notes: string[] };
}

export type RestoreScope = { kind: "all" } | { kind: "collection"; collection: string } | { kind: "doc"; collection: string; id: string };
export interface RestorePlan {
  add: number; change: number; same: number; written: number; before: string | null;
  tallies: { c: string; add: number; change: number; same: number }[];
  samples: { c: string; id: string; what: "add" | "change" }[];
}

const LONG = { timeout: 540_000 };

export function subscribeRuns(cb: (list: BackupRun[]) => void, onError?: () => void): Unsubscribe {
  return onSnapshot(query(collection(fsdb, "backupRuns"), orderBy("at", "desc"), limit(120)),
    s => cb(s.docs.map(d => d.data() as BackupRun)), () => onError?.());
}

/** The newest server backup's time, or null (none yet — or not readable). */
export async function lastServerBackupAt(): Promise<string | null> {
  try {
    const s = await getDocs(query(collection(fsdb, "backupRuns"), orderBy("at", "desc"), limit(1)));
    return (s.docs[0]?.data().at as string | undefined) ?? null;
  } catch { return null; }
}

export async function backupNow(): Promise<{ records: number; ok: boolean; problems: string[] }> {
  const r = await httpsCallable<unknown, { records: number; ok: boolean; problems: string[] }>(functions, "backupNow", LONG)({});
  return r.data;
}

export async function restorePlan(path: string, scope: RestoreScope, apply: boolean): Promise<RestorePlan> {
  const r = await httpsCallable<unknown, RestorePlan>(functions, "backupRestore", LONG)({ path, scope, mode: apply ? "apply" : "plan" });
  return r.data;
}

/** A backup file from this computer, into the admin-only folder, so the server can restore from it. */
export async function uploadForRestore(file: File): Promise<string> {
  await ensureFileClaims();
  const safe = file.name.replace(/[^\w.-]+/g, "_").slice(-80);
  const path = `backups/uploads/${new Date().toISOString().replace(/[:.]/g, "-")}-${safe}`;
  await uploadBytes(ref(storage, path), file, { contentType: file.name.endsWith(".gz") ? "application/gzip" : "application/json" });
  return path;
}

export const kindLabel = (k: BackupRun["kind"] | "daily") => (k === "auto" ? "Every 6 hours" : k === "manual" ? "Taken by hand" : k === "before-restore" ? "Before a restore" : "Daily (app)");
export const sizeText = (b: number) => (b >= 1_048_576 ? `${(b / 1_048_576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);
