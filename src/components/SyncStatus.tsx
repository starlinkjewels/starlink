import { useEffect, useState } from "react";
import { Loader2, Check, CloudOff } from "lucide-react";
import { pendingWrites } from "@/lib/db";

/**
 * Global Firebase write indicator. Because writes are optimistic (the UI updates
 * instantly, the commit runs in the background), this pill tells the user when a
 * change is actually being saved to Firebase, when it's saved, and if it failed.
 * Mounted once inside the authenticated app shell so it covers every action.
 */
type State = "idle" | "saving" | "saved" | "error";

export function SyncStatus() {
  const [state, setState] = useState<State>("idle");

  useEffect(() => {
    let hideTimer: ReturnType<typeof setTimeout> | undefined;

    const onPending = (e: Event) => {
      const count = (e as CustomEvent<number>).detail ?? pendingWrites();
      clearTimeout(hideTimer);
      if (count > 0) {
        setState("saving");
      } else {
        // Drained — briefly confirm, then hide (unless an error just fired).
        setState(prev => (prev === "error" ? "error" : "saved"));
        hideTimer = setTimeout(() => setState(prev => (prev === "saved" ? "idle" : prev)), 1500);
      }
    };
    const onError = () => {
      clearTimeout(hideTimer);
      setState("error");
      hideTimer = setTimeout(() => setState(prev => (prev === "error" ? "idle" : prev)), 4000);
    };

    window.addEventListener("starlink-db-pending", onPending);
    window.addEventListener("starlink-db-error", onError);
    return () => {
      clearTimeout(hideTimer);
      window.removeEventListener("starlink-db-pending", onPending);
      window.removeEventListener("starlink-db-error", onError);
    };
  }, []);

  if (state === "idle") return null;

  const cfg = {
    saving: { icon: <Loader2 className="h-3.5 w-3.5 animate-spin" />, text: "Saving…", cls: "bg-foreground/85 text-background" },
    saved:  { icon: <Check className="h-3.5 w-3.5" />,                text: "Saved",    cls: "bg-emerald-600 text-white" },
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
