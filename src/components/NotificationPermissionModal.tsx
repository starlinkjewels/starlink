import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Bell, X, Package, Truck, Wallet } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { requestPushPermission } from "@/lib/push";
import { toast } from "sonner";

const SNOOZE_KEY = "starlink_push_modal_snooze_until";
const SNOOZE_DAYS = 3;

/**
 * The polished, centered "ask" — shown on every fresh app open while permission
 * is still undecided, so it doesn't get lost the way a page-embedded banner can.
 * Dismissing it (X or "Maybe Later") snoozes it for a few days rather than
 * silencing it forever; PushPermissionBanner stays as the always-reachable
 * fallback on Dashboard/Notifications for whenever the user wants it instead.
 */
export function NotificationPermissionModal() {
  const { user } = useAuth();
  const [show, setShow] = useState(false);
  const [asking, setAsking] = useState(false);

  useEffect(() => {
    if (!user) return;
    if (typeof Notification === "undefined" || Notification.permission !== "default") return;
    const snoozeUntil = Number(localStorage.getItem(SNOOZE_KEY) || 0);
    if (Date.now() < snoozeUntil) return;
    // Small delay so it appears after the page has settled, not on top of the
    // very first paint.
    const t = setTimeout(() => setShow(true), 1200);
    return () => clearTimeout(t);
  }, [user]);

  const enable = async () => {
    setAsking(true);
    try {
      const result = await requestPushPermission(user!.id);
      if (result === "granted") toast.success("Notifications enabled");
      setShow(false);
    } finally { setAsking(false); }
  };

  const maybeLater = () => {
    localStorage.setItem(SNOOZE_KEY, String(Date.now() + SNOOZE_DAYS * 24 * 60 * 60 * 1000));
    setShow(false);
  };

  return (
    <AnimatePresence>
      {show && (
        <>
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-[70] bg-black/50 backdrop-blur-sm"
          />
          <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 pointer-events-none">
            <motion.div
              initial={{ opacity: 0, y: 24, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 24, scale: 0.96 }}
              transition={{ type: "spring", damping: 26, stiffness: 320 }}
              className="pointer-events-auto relative bg-white rounded-2xl shadow-2xl p-6 max-w-sm w-full max-h-[90vh] overflow-y-auto"
            >
              <button
                onClick={maybeLater}
                aria-label="Close"
                className="absolute top-4 right-4 h-8 w-8 rounded-xl bg-secondary grid place-items-center text-muted-foreground hover:text-foreground transition-colors"
              >
                <X className="h-4 w-4" />
              </button>

              <div className="h-14 w-14 rounded-2xl bg-primary/10 grid place-items-center mb-4">
                <Bell className="h-7 w-7 text-primary" />
              </div>

              <h3 className="font-display text-xl text-brand-dark mb-1.5">Stay on top of your orders</h3>
              <p className="text-sm text-muted-foreground mb-4">
                Turn on notifications to get instant alerts — even when the app is closed.
              </p>

              <div className="space-y-2.5 mb-5">
                <div className="flex items-center gap-2.5 text-sm text-foreground">
                  <div className="h-8 w-8 rounded-xl bg-blue-500/10 grid place-items-center shrink-0"><Package className="h-4 w-4 text-blue-600" /></div>
                  Order status updates
                </div>
                <div className="flex items-center gap-2.5 text-sm text-foreground">
                  <div className="h-8 w-8 rounded-xl bg-emerald-500/10 grid place-items-center shrink-0"><Truck className="h-4 w-4 text-emerald-600" /></div>
                  Dispatch &amp; delivery alerts
                </div>
                <div className="flex items-center gap-2.5 text-sm text-foreground">
                  <div className="h-8 w-8 rounded-xl bg-amber-500/10 grid place-items-center shrink-0"><Wallet className="h-4 w-4 text-amber-600" /></div>
                  Payment confirmations
                </div>
              </div>

              <div className="flex gap-2">
                <button
                  onClick={maybeLater}
                  className="flex-1 h-11 rounded-xl border border-border text-sm font-medium hover:bg-secondary transition-colors"
                >
                  Maybe Later
                </button>
                <button
                  onClick={enable} disabled={asking}
                  className="flex-1 h-11 rounded-xl btn-hero text-sm font-semibold disabled:opacity-60"
                >
                  {asking ? "Enabling…" : "Enable Notifications"}
                </button>
              </div>
            </motion.div>
          </div>
        </>
      )}
    </AnimatePresence>
  );
}
