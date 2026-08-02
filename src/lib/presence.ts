import { useEffect } from "react";
import { updateDb } from "./db";

const HEARTBEAT_MS = 45 * 1000;

/**
 * Not real socket presence — just a recency heartbeat. Refreshes the current
 * user's User.lastActiveAt every ~45s while the app is open (plus immediately
 * on mount and whenever the tab regains focus/visibility), so the Clients
 * page can show a "last seen" / online indicator. See ONLINE_THRESHOLD_MS and
 * timeAgo() in src/lib/db.ts for how that's derived from this timestamp.
 */
export function usePresenceHeartbeat(userId: string | undefined): void {
  useEffect(() => {
    if (!userId) return;
    const beat = () => updateDb(d => {
      const u = d.users.find(x => x.id === userId);
      if (u) u.lastActiveAt = new Date().toISOString();
    });
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
