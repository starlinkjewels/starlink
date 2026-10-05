import { useEffect } from "react";
import { touchPresence } from "./db";

const HEARTBEAT_MS = 5 * 60 * 1000;
/** Ignore a second beat within this window — focus and visibilitychange both
 *  fire when a phone comes back to the app, and a tab switch fires them again. */
const MIN_GAP_MS = 60 * 1000;

/**
 * Not real socket presence — just a recency heartbeat. Refreshes the current
 * user's User.lastActiveAt so the Clients page can show a "last seen" / online
 * indicator. See ONLINE_THRESHOLD_MS and timeAgo() in src/lib/db.ts for how
 * that is derived from this timestamp.
 *
 * It writes the single field straight to Firestore (see touchPresence) rather
 * than going through updateDb, which would diff the whole database to move one
 * timestamp and raise the global "Saving…" indicator for it. Every 5 minutes
 * rather than 45 seconds, and at most once a minute however many focus events
 * a phone sends: a "last seen" dot has never needed to be accurate to the
 * second, and this runs on every device all day.
 */
export function usePresenceHeartbeat(userId: string | undefined): void {
  useEffect(() => {
    if (!userId) return;
    let last = 0;
    const beat = () => {
      const now = Date.now();
      if (now - last < MIN_GAP_MS) return;
      last = now;
      void touchPresence(userId);
    };
    beat();
    const interval = setInterval(beat, HEARTBEAT_MS);
    const onVisible = () => { if (document.visibilityState === "visible") beat(); };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", beat);
    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", beat);
    };
  }, [userId]);
}
