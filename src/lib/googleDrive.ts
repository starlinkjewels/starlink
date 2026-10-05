// Backing up to Google Drive.
//
// The daily snapshot already goes to Firebase Storage (see backup.ts), but that
// lives in the same Google project as the data it protects. This puts a second
// copy somewhere else entirely, which is the whole point of a backup.
//
// Browser-only, on purpose: an access token obtained here lasts about an hour
// and cannot be refreshed in the background, so the upload happens when an
// admin opens the app rather than on a server's clock. That matches how the
// Storage backup already works. Nothing here needs a backend or a paid plan.
//
// Scope is drive.file — the app can only ever see and touch files it created
// itself, never the rest of the account's Drive. That is also why Google's
// verification for it is light.
import { loadDb } from "./db";

const SCOPE = "https://www.googleapis.com/auth/drive.file";
const FOLDER_NAME = "Starlink Jewels Backups";
const GIS_SRC = "https://accounts.google.com/gsi/client";

const K_TOKEN = "starlink-gdrive-token";
const K_EMAIL = "starlink-gdrive-email";
const K_FOLDER = "starlink-gdrive-folder";
const K_LAST = "starlink-gdrive-last";
const K_EVERY = "starlink-gdrive-every";

export type Frequency = "off" | "daily" | "weekly" | "monthly" | "yearly";

const DAYS: Record<Exclude<Frequency, "off">, number> = {
  daily: 1, weekly: 7, monthly: 30, yearly: 365,
};

/**
 * The OAuth client id.
 *
 * Google will not let any app touch a Drive without one, and only the account
 * holder can create it — there is no way around that for us or for anyone
 * else. What we can do is not make it a build variable: it lives in settings so
 * an admin pastes it in once and connects there and then, instead of editing an
 * environment variable and waiting for a redeploy. The build variable still
 * works as a fallback for anyone who set it that way.
 */
export function driveClientId(): string {
  const fromSettings = (loadDb().settings.googleClientId ?? "").trim();
  if (fromSettings) return fromSettings;
  return ((import.meta.env?.VITE_GOOGLE_CLIENT_ID as string | undefined) ?? "").trim();
}

/** Where this app is being served from — the exact string Google wants under
 *  "Authorised JavaScript origins", so nobody has to guess it. */
export function driveOrigin(): string {
  return typeof window !== "undefined" ? window.location.origin : "";
}

export function driveConfigured(): boolean {
  return !!driveClientId();
}

const ls = {
  get(k: string): string | null { try { return localStorage.getItem(k); } catch { return null; } },
  set(k: string, v: string) { try { localStorage.setItem(k, v); } catch { /* private window */ } },
  del(k: string) { try { localStorage.removeItem(k); } catch { /* private window */ } },
};

interface StoredToken { token: string; expiresAt: number }

function readToken(): StoredToken | null {
  const raw = ls.get(K_TOKEN);
  if (!raw) return null;
  try {
    const t = JSON.parse(raw) as StoredToken;
    // A minute of headroom: a token about to expire mid-upload is no use.
    return t.token && t.expiresAt > Date.now() + 60_000 ? t : null;
  } catch { return null; }
}

export function driveStatus(): { connected: boolean; email: string | null; frequency: Frequency; lastAt: string | null } {
  return {
    connected: !!ls.get(K_EMAIL),
    email: ls.get(K_EMAIL),
    frequency: (ls.get(K_EVERY) as Frequency) || "daily",
    lastAt: ls.get(K_LAST),
  };
}

export function setDriveFrequency(f: Frequency): void {
  ls.set(K_EVERY, f);
}

export function disconnectDrive(): void {
  const t = readToken();
  // Best effort: tell Google to drop the grant as well as forgetting it here.
  if (t) void fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(t.token)}`, { method: "POST" }).catch(() => {});
  [K_TOKEN, K_EMAIL, K_FOLDER, K_LAST].forEach(ls.del);
}

/* ── Google Identity Services ─────────────────────────────────────────────── */

interface TokenResponse { access_token?: string; expires_in?: number; error?: string }
interface TokenClient { requestAccessToken: (o?: { prompt?: string }) => void }
interface GoogleGlobal {
  accounts: { oauth2: { initTokenClient: (c: {
    client_id: string; scope: string; prompt?: string;
    callback: (r: TokenResponse) => void;
    error_callback?: (e: unknown) => void;
  }) => TokenClient } };
}

let gisReady: Promise<void> | null = null;
function loadGis(): Promise<void> {
  if (gisReady) return gisReady;
  gisReady = new Promise<void>((resolve, reject) => {
    if ((window as unknown as { google?: GoogleGlobal }).google?.accounts?.oauth2) return resolve();
    const s = document.createElement("script");
    s.src = GIS_SRC;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("Could not reach Google — check the connection."));
    document.head.appendChild(s);
  });
  return gisReady;
}

/**
 * Ask Google for an access token.
 *
 * `interactive` false tries for one without showing anything, which works once
 * the account has already consented — that is what lets the scheduled backup
 * run quietly on app open. It fails quickly when consent is actually needed,
 * and the Settings page then asks for it properly.
 */
async function getToken(interactive: boolean): Promise<string> {
  const existing = readToken();
  if (existing) return existing.token;

  const clientId = driveClientId();
  if (!clientId) throw new Error("Google Drive isn't set up yet — no client id configured.");
  await loadGis();
  const google = (window as unknown as { google: GoogleGlobal }).google;

  return new Promise<string>((resolve, reject) => {
    const client = google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: SCOPE,
      callback: (res) => {
        if (!res.access_token) return reject(new Error(res.error || "Google did not return a token."));
        ls.set(K_TOKEN, JSON.stringify({
          token: res.access_token,
          expiresAt: Date.now() + (res.expires_in ?? 3600) * 1000,
        }));
        resolve(res.access_token);
      },
      error_callback: () => reject(new Error("Google sign-in was closed before it finished.")),
    });
    client.requestAccessToken({ prompt: interactive ? "consent" : "" });
  });
}

/** Whose account this is, for the Settings page to show. */
async function fetchEmail(token: string): Promise<string | null> {
  try {
    const r = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!r.ok) return null;
    return ((await r.json()) as { email?: string }).email ?? null;
  } catch { return null; }
}

/* ── Drive ────────────────────────────────────────────────────────────────── */

/** The backups folder, created once and remembered. */
async function folderId(token: string): Promise<string> {
  const saved = ls.get(K_FOLDER);
  if (saved) return saved;

  // drive.file only sees what this app made, so this finds our own folder and
  // nothing else in the account.
  const q = encodeURIComponent(
    `name='${FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' and trashed=false`,
  );
  const found = await fetch(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id)`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (found.ok) {
    const id = ((await found.json()) as { files?: { id: string }[] }).files?.[0]?.id;
    if (id) { ls.set(K_FOLDER, id); return id; }
  }

  const made = await fetch("https://www.googleapis.com/drive/v3/files?fields=id", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ name: FOLDER_NAME, mimeType: "application/vnd.google-apps.folder" }),
  });
  if (!made.ok) throw new Error(`Could not create the Drive folder (${made.status}).`);
  const id = ((await made.json()) as { id: string }).id;
  ls.set(K_FOLDER, id);
  return id;
}

export interface DriveBackup { id: string; name: string; createdTime: string; size: number }

export async function listDriveBackups(): Promise<DriveBackup[]> {
  const token = await getToken(false);
  const parent = await folderId(token);
  const q = encodeURIComponent(`'${parent}' in parents and trashed=false`);
  const r = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${q}&orderBy=createdTime desc&pageSize=50`
    + `&fields=files(id,name,createdTime,size)`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!r.ok) throw new Error(`Could not list the Drive backups (${r.status}).`);
  const files = ((await r.json()) as { files?: { id: string; name: string; createdTime: string; size?: string }[] }).files ?? [];
  return files.map((f) => ({ id: f.id, name: f.name, createdTime: f.createdTime, size: Number(f.size ?? 0) }));
}

/** Connect, or re-consent. Returns the account it landed on. */
export async function connectDrive(): Promise<string> {
  const token = await getToken(true);
  const email = await fetchEmail(token);
  ls.set(K_EMAIL, email ?? "Google account");
  await folderId(token); // create the folder now, so a failure shows at connect time
  return email ?? "Google account";
}

/** Upload one snapshot. Returns the file name written. */
export async function backupToDrive(interactive = false): Promise<string> {
  const token = await getToken(interactive);
  const parent = await folderId(token);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const name = `starlink-backup-${stamp}.json`;

  // Multipart: the metadata and the file in one request.
  const boundary = `sl${Math.random().toString(36).slice(2)}`;
  const body =
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n`
    + `${JSON.stringify({ name, parents: [parent] })}\r\n`
    + `--${boundary}\r\nContent-Type: application/json\r\n\r\n`
    + `${JSON.stringify(loadDb())}\r\n`
    + `--${boundary}--`;

  const r = await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": `multipart/related; boundary=${boundary}` },
    body,
  });
  if (!r.ok) throw new Error(`Drive refused the upload (${r.status}).`);
  ls.set(K_LAST, new Date().toISOString());
  return name;
}

/**
 * Run on app open: back up if one is due.
 *
 * Quiet by design — it never asks for consent and never shows an error. If the
 * token has lapsed the Settings page says so and asks for it there, where
 * someone is actually looking.
 */
export async function autoBackupToDrive(): Promise<boolean> {
  if (!driveConfigured()) return false;
  const { connected, frequency, lastAt } = driveStatus();
  if (!connected || frequency === "off") return false;

  const due = !lastAt
    || Date.now() - new Date(lastAt).getTime() >= DAYS[frequency] * 24 * 60 * 60 * 1000;
  if (!due) return false;

  try {
    await backupToDrive(false);
    return true;
  } catch {
    // Expired consent or no connection. Settings shows the state; nothing here
    // is worth interrupting someone's work for.
    return false;
  }
}
