// Browser push notifications via Firebase Cloud Messaging. The actual
// sending happens server-side (functions/src/notifications.ts, triggered
// whenever a Notification doc is created) — this file only handles asking
// for permission, registering this browser's FCM token, and showing an
// in-app toast for messages that arrive while the tab is focused (FCM never
// shows an OS notification for a foreground message, by design).
import { getToken, onMessage } from "firebase/messaging";
import { toast } from "sonner";
import { getMessagingIfSupported } from "./firebase";
import { updateDb } from "./db";

const VAPID_KEY = import.meta.env.VITE_FCM_VAPID_KEY as string | undefined;
/** The token this browser last registered. */
const TOKEN_KEY = "sl-fcm-token";

export type PushPermissionResult = "granted" | "denied" | "unsupported";

/**
 * Asks the browser for notification permission (must be called from a real
 * click — browsers block/flag auto-triggered prompts) and, if granted,
 * registers this browser's FCM token onto the given user's profile.
 */
export async function requestPushPermission(userId: string): Promise<PushPermissionResult> {
  if (typeof Notification === "undefined") return "unsupported";
  const messaging = await getMessagingIfSupported();
  if (!messaging) return "unsupported";
  if (!VAPID_KEY) {
    toast.error("Push notifications aren't configured yet (missing VAPID key) — ask an admin to finish setup.");
    return "unsupported";
  }

  const permission = await Notification.requestPermission();
  if (permission !== "granted") return permission === "denied" ? "denied" : "unsupported";

  try {
    const registration = await navigator.serviceWorker.ready;
    const token = await getToken(messaging, { vapidKey: VAPID_KEY, serviceWorkerRegistration: registration });
    if (!token) return "unsupported";
    // This browser's previous token goes when it gets a new one — they piled
    // up (ten for one person), and every one of them was sent each alert.
    let before: string | null = null;
    try { before = localStorage.getItem(TOKEN_KEY); localStorage.setItem(TOKEN_KEY, token); } catch { /* private mode */ }
    updateDb(d => {
      const u = d.users.find(x => x.id === userId);
      if (!u) return;
      const kept = (u.fcmTokens ?? []).filter(t => t !== before || t === token);
      if (!kept.includes(token)) kept.push(token);
      u.fcmTokens = kept;
    });
    return "granted";
  } catch (e) {
    console.error("[push] token registration failed:", e);
    toast.error("Couldn't finish setting up notifications — try again in a moment.");
    return "unsupported";
  }
}

/** Call once at app startup (after login) — surfaces a foreground push as an in-app toast. */
export async function initForegroundPush(): Promise<void> {
  const messaging = await getMessagingIfSupported();
  if (!messaging) return;
  onMessage(messaging, payload => {
    const title = payload.notification?.title || "Notification";
    const body = payload.notification?.body;
    // A chat message is announced by Messages itself (a tone and its own pop-up — see useChatAlerts).
    if (/^Message (from|in) /.test(title)) return;
    toast(title, { description: body });
  });
}
