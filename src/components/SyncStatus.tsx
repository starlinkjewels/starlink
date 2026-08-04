import { useEffect, useRef, useState } from "react";
import { Loader2, CloudOff } from "lucide-react";
import { pendingWrites } from "@/lib/db";

/**
 * Global Firebase write indicator. Writes are optimistic (the UI updates
 * instantly, the commit runs in the background), so on a normal fast save NOTHING
 * is shown — no "Saved" pill flashing on every change. It only surfaces when a
 * save is genuinely slow (still pending after ~1s, e.g. a weak connection) or
 * when a save actually FAILS. Mounted once inside the authenticated app shell.
 */
type State = "idle" | "saving" | "error";

export function SyncStatus() {
  const [state, setState] = useState<State>("idle");
  const showTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    const onPending = (e: Event) => {
      const count = (e as CustomEvent<number>).detail ?? pendingWrites();
      clearTimeout(showTimer.current);
      clearTimeout(hideTimer.current);
      if (count > 0) {
        // Only reveal "Saving…" if the write is actually taking a moment — a quick
        // save that drains before this fires shows nothing at all.
        showTimer.current = setTimeout(() => setState(prev => (prev === "error" ? "error" : "saving")), 1000);
      } else {
        // Drained — hide immediately. No "Saved" confirmation.
        setState(prev => (prev === "error" ? "error" : "idle"));
      }
    };
    const onError = () => {
      clearTimeout(showTimer.current);
      clearTimeout(hideTimer.current);
      setState("error");
      hideTimer.current = setTimeout(() => setState(prev => (prev === "error" ? "idle" : prev)), 4000);
    };

    window.addEventListener("starlink-db-pending", onPending);
    window.addEventListener("starlink-db-error", onError);
    return () => {
      clearTimeout(showTimer.current);
      clearTimeout(hideTimer.current);
      window.removeEventListener("starlink-db-pending", onPending);
      window.removeEventListener("starlink-db-error", onError);
    };
  }, []);

  if (state === "idle") return null;

  const cfg = {
    saving: { icon: <Loader2 className="h-3.5 w-3.5 animate-spin" />, text: "Saving…", cls: "bg-foreground/85 text-background" },
    error:  { icon: <CloudOff className="h-3.5 w-3.5" />,             text: "Save failed — check your connection", cls: "bg-destructive text-white" },
  }[state];

  return (
    <div
      className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[60] pointer-events-none"
      role="status"
      aria-live="polite"
    >
      <div className={`flex items-center gap-2 rounded-full px-3.5 py-1.5 text-xs font-medium shadow-lg ${cfg.cls}`}>
        {cfg.icon}
        <span>{cfg.text}</span>
      </div>
    </div>
  );
}
