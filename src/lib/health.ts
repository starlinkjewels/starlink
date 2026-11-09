/**
 * Software health — what the app tells the server (functions/src/health/report.ts):
 * wrong passwords on the sign-in screen, saves the security rules refused,
 * screens that crashed, an admin signing in. The server counts them and alerts
 * every partner when a count crosses its line (Settings → Software health).
 *
 * Fire and forget: a report never holds anything up and never shows an error.
 * A session sends a few at most — never a flood.
 */
import { httpsCallable } from "firebase/functions";
import { functions } from "./firebase";

/** The local test setup (the dev server against the emulators) — there is no server to tell. */
const EMULATORS = !!import.meta.env?.DEV && import.meta.env?.VITE_EMULATORS === "1";

type Kind = "failedLogin" | "denied" | "error" | "signin";
let sent = 0;
const seen = new Set<string>();

export function reportHealth(kind: Kind, data: { email?: string; what?: string; message?: string; page?: string } = {}): void {
  // Locally there is no server to tell.
  if (EMULATORS) return;
  const key = `${kind}|${data.email ?? ""}|${data.what ?? ""}|${(data.message ?? "").slice(0, 80)}`;
  // A wrong password is worth every report (they are counted); the rest once each.
  if (kind !== "failedLogin" && seen.has(key)) return;
  if (sent >= 40) return;
  seen.add(key); sent++;
  try {
    void httpsCallable(functions, "reportHealth")({ kind, ...data }).catch(() => { /* never matters to the person */ });
  } catch { /* nothing */ }
}

/** Not the app breaking: a new version arriving, the network, the browser's own noise. */
const NOISE = /ResizeObserver loop|dynamically imported module|Loading chunk|Importing a module script failed|^Script error\.?$|Failed to fetch|NetworkError|Load failed|AbortError|The operation was aborted|permission-denied|Missing or insufficient permissions/i;
let errors = 0;

/** Screens that crash: the message and the page, a few per session. */
export function installErrorReporter(): void {
  if (typeof window === "undefined") return;
  const report = (message: string) => {
    const m = message.trim();
    if (!m || NOISE.test(m) || errors >= 8) return;
    errors++;
    reportHealth("error", { message: m.slice(0, 300), page: window.location.pathname.replace(/\/[A-Za-z0-9_-]{12,}/g, "/:id").slice(0, 80) });
  };
  window.addEventListener("error", e => report(e.message || String(e.error ?? "")));
  window.addEventListener("unhandledrejection", e => {
    const r = e.reason as { message?: string } | string | undefined;
    report(typeof r === "string" ? r : r?.message ?? "");
  });
}
