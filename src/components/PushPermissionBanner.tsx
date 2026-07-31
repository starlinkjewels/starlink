import { useState } from "react";
import { useAuth } from "@/lib/auth";
import { requestPushPermission } from "@/lib/push";
import { Bell, BellOff } from "lucide-react";
import { toast } from "sonner";

/**
 * The actual "ask permission" trigger — browsers require a real click before
 * showing the native notification prompt, so this button IS the ask, not a
 * decoration. Shown on the Dashboard (first thing after login, so it gets
 * priority) and again on the Notifications page (so it's always reachable
 * later even if dismissed once by navigating away).
 */
export function PushPermissionBanner() {
  const { user } = useAuth();
  const [permission, setPermission] = useState<NotificationPermission | "unsupported">(
    typeof Notification === "undefined" ? "unsupported" : Notification.permission,
  );
  const [asking, setAsking] = useState(false);

  if (!user || permission === "granted" || permission === "unsupported") return null;

  const enable = async () => {
    setAsking(true);
    try {
      const result = await requestPushPermission(user.id);
      if (result === "granted") { setPermission("granted"); toast.success("Notifications enabled"); }
      else if (result === "denied") setPermission("denied");
    } finally { setAsking(false); }
  };

  if (permission === "denied") {
    return (
      <div className="card-luxe p-4 bg-amber-50 border border-amber-200 flex items-start gap-3">
        <BellOff className="h-5 w-5 shrink-0 mt-0.5 text-amber-600" />
        <p className="text-sm text-amber-800">
          Notifications are blocked for this site. To turn them back on, open your browser's site settings (the icon next to the address bar) and allow notifications.
        </p>
      </div>
    );
  }

  return (
    <div className="card-luxe p-4 bg-primary/5 border border-primary/20 flex items-center justify-between gap-3 flex-wrap">
      <div className="flex items-center gap-3 min-w-0">
        <Bell className="h-5 w-5 text-primary shrink-0" />
        <p className="text-sm text-foreground">Turn on notifications to get alerts even when the app is closed.</p>
      </div>
      <button
        onClick={enable} disabled={asking}
        className="btn-hero h-9 px-4 rounded-xl text-sm font-semibold shrink-0 disabled:opacity-60"
      >
        {asking ? "Enabling…" : "Enable Notifications"}
      </button>
    </div>
  );
}
