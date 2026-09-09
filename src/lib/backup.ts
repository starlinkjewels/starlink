// Automatic daily backups.
//
// A full JSON snapshot of the database is uploaded to Firebase Storage under
// `backups/` once a day (first admin session of the day does it), and the last
// 14 are kept. This is the safety net: even if something unexpected ever loses
// or corrupts data, there is always a recent restore point.
//
// Stored in Storage rather than Firestore because a whole-account snapshot
// easily exceeds Firestore's 1 MB per-document limit.
//
// ⚠️ Backups contain EVERYTHING, so `storage.rules` restricts `backups/` to the
// admin e-mails only — never leave it on the default "any signed-in user" rule.
import { ref, uploadString, getDownloadURL, listAll, deleteObject } from "firebase/storage";
import { storage } from "./firebase";
import { loadDb } from "./db";

const FOLDER = "backups";
const KEEP = 14; // retain this many daily snapshots
const LAST_KEY = "starlink-last-backup"; // local marker so we only try once a day

/** Local calendar day, e.g. "2026-09-09". */
function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export interface BackupEntry {
  name: string;
  path: string;
  date: string; // YYYY-MM-DD parsed out of the filename
}

/** Newest first. */
export async function listBackups(): Promise<BackupEntry[]> {
  const res = await listAll(ref(storage, FOLDER));
  return res.items
    .map((i) => ({
      name: i.name,
      path: i.fullPath,
      date: i.name.replace(/^backup-/, "").replace(/\.json$/, ""),
    }))
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
}

/** Snapshot the current database to Storage (one file per calendar day). */
export async function createBackup(): Promise<BackupEntry> {
  const day = today();
  const path = `${FOLDER}/backup-${day}.json`;
  await uploadString(ref(storage, path), JSON.stringify(loadDb()), "raw", {
    contentType: "application/json",
  });
  try {
    localStorage.setItem(LAST_KEY, day);
  } catch {
    /* private mode — just means we may retry later today */
  }
  return { name: `backup-${day}.json`, path, date: day };
}

/** A direct download link for one backup file. */
export function backupUrl(path: string): Promise<string> {
  return getDownloadURL(ref(storage, path));
}

/** Read one backup back as a parsed object. */
export async function fetchBackup(path: string): Promise<Record<string, unknown>> {
  const url = await getDownloadURL(ref(storage, path));
  const res = await fetch(url);
  if (!res.ok) throw new Error("Couldn't download that backup");
  return (await res.json()) as Record<string, unknown>;
}

/** Drop everything older than the newest KEEP snapshots. */
async function prune(): Promise<void> {
  const all = await listBackups();
  for (const b of all.slice(KEEP)) {
    try {
      await deleteObject(ref(storage, b.path));
    } catch {
      /* best effort */
    }
  }
}

/**
 * Run a backup if today's hasn't been taken yet. Safe to call on every admin
 * boot — it's a no-op the rest of the day. Never throws (a failed backup must
 * never block the app); returns true if a snapshot was written.
 */
export async function autoBackup(): Promise<boolean> {
  try {
    let last: string | null = null;
    try {
      last = localStorage.getItem(LAST_KEY);
    } catch {
      /* ignore */
    }
    const day = today();
    if (last === day) return false;
    // Don't re-upload if another device already made today's snapshot.
    const existing = await listBackups();
    if (existing.some((b) => b.date === day)) {
      try {
        localStorage.setItem(LAST_KEY, day);
      } catch {
        /* ignore */
      }
      return false;
    }
    await createBackup();
    await prune();
    return true;
  } catch (err) {
    console.error("[backup] automatic backup failed:", err);
    return false;
  }
}
