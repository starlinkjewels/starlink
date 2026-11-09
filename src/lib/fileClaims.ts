/**
 * The file rules (storage.rules) know who someone is from their sign-in token —
 * the "sl" claim the server keeps there from their sign-in record
 * (functions/src/fileClaims.ts): admin, employee or client, and active.
 *
 * A token picks up a new claim only when it is refreshed, so before anything is
 * uploaded the session makes sure its token has one: refreshed if the server
 * has stamped it since, else the server is asked to stamp it now. Never throws —
 * if the server can't be reached the upload goes as it would have anyway, and
 * the file rules say yes or no.
 *
 * An admin's session also stamps the whole team, once (settings.fileClaimsAt),
 * so everyone has theirs before the file rules count on them.
 */
import { getIdTokenResult } from "firebase/auth";
import { httpsCallable } from "firebase/functions";
import { auth, functions } from "./firebase";

let pending: Promise<void> | null = null;
/** The account whose token is known to carry its claim. */
let doneFor = "";
/** Asked the server and it failed — not again until then (ms). */
let retryAt = 0;

export function ensureFileClaims(): Promise<void> {
  const u = auth.currentUser;
  if (!u || doneFor === u.uid || Date.now() < retryAt) return Promise.resolve();
  if (pending) return pending;
  pending = (async () => {
    try {
      let t = await getIdTokenResult(u);
      // Stamped on the server since this token was made? A fresh one says.
      if (!t.claims.sl) t = await getIdTokenResult(u, true);
      if (!t.claims.sl) {
        await httpsCallable(functions, "syncFileClaims")({});
        t = await getIdTokenResult(u, true);
      }
      if (t.claims.sl) doneFor = u.uid;
      else retryAt = Date.now() + 5 * 60_000;
    } catch {
      retryAt = Date.now() + 5 * 60_000;
    } finally {
      pending = null;
    }
  })();
  return pending;
}

/** An admin's session: stamp the whole team once. True when it was done now. */
export async function stampTeamOnce(): Promise<{ total: number; set: number } | null> {
  try {
    const r = await httpsCallable<{ all: boolean }, { total: number; set: number; same: number; gone: number }>(functions, "syncFileClaims")({ all: true });
    return { total: r.data.total, set: r.data.set };
  } catch {
    return null;
  }
}
