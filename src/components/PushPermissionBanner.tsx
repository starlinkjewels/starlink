import { useState } from "react";
import { useAuth } from "@/lib/auth";
import { requestPushPermission } from "@/lib/push";
import { Bell, BellOff, X } from "lucide-react";
import { toast } from "sonner";

/** The × on the Dashboard's strip, remembered on this device. */
const HIDE_KEY = "push-banner-hidden";
const hiddenBefore = () => { try { return localStorage.getItem(HIDE_KEY) === "1"; } catch { return false; } };

/**
 * The actual "ask permission" trigger — browsers require a real click before
 * showing the native notification prompt, so its button IS the ask, not a
 * decoration. One slim line with an ×, so it never takes the top of a phone's
 * screen. Shown on the Dashboard (first thing after login), where the × is
 * remembered on this device, and on the Notifications page, which passes
 * `keepReachable`: there the × only hides it for this visit, so the ask can
 * always be found again.
 */
export function PushPermissionBanner({ keepReachable = false }: { keepReachable?: boolean }) {
  const { user } = useAuth();
  const [permission, setPermission] = useState<NotificationPermission | "unsupported">(
    typeof Notification === "undefined" ? "unsupported" : Notification.permission,
  );
  const [asking, setAsking] = useState(false);
  const [hidden, setHidden] = useState(() => !keepReachable && hiddenBefore());

  if (!user || permission === "granted" || permission === "unsupported" || hidden) return null;

  const enable = async () => {
    setAsking(true);
    try {
      const result = await requestPushPermission(user.id);
      if (result === "granted") { setPermission("granted"); toast.success("Notifications enabled"); }
      else if (result === "denied") setPermission("denied");
    } finally { setAsking(false); }
  };

  const dismiss = () => {
    setHidden(true);
    if (!keepReachable) { try { localStorage.setItem(HIDE_KEY, "1"); } catch { /* private window */ } }
  };
  // 32px to look at, 40px to tap.
  const close = (
    <button type="button" onClick={dismiss} aria-label="Dismiss" title="Dismiss"
      className="relative after:absolute after:-inset-1 h-8 w-8 shrink-0 grid place-items-center rounded-lg text-muted-foreground hover:bg-black/5 hover:text-foreground">
      <X className="h-4 w-4" />
    </button>
  );

  if (permission === "denied") {
    return (
      <div role="status" className="flex items-center gap-2.5 rounded-xl border border-amber-200 bg-amber-50 pl-3 pr-1 py-1 text-[13px] text-amber-800">
        <BellOff className="h-4 w-4 shrink-0 text-amber-600" />
        <p className="min-w-0 flex-1 leading-snug line-clamp-2">Notifications are blocked — allow them in your browser&rsquo;s site settings (the icon by the address bar).</p>
        {close}
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2.5 rounded-xl border border-primary/20 bg-primary/5 pl-3 pr-1 py-1 text-[13px]">
      <Bell className="h-4 w-4 shrink-0 text-primary" />
      <p className="min-w-0 flex-1 text-foreground leading-snug">Alerts even when the app is closed</p>
      <button type="button" onClick={enable} disabled={asking}
        className="btn-hero h-8 px-3 rounded-lg text-xs font-semibold shrink-0 disabled:opacity-60">
        {asking ? "Enabling…" : <><span className="sm:hidden">Turn on</span><span className="max-sm:hidden">Enable Notifications</span></>}
      </button>
      {close}
    </div>
  );
}
