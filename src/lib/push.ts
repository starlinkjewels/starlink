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
    updateDb(d => {
      const u = d.users.find(x => x.id === userId);
      if (!u) return;
      if (!u.fcmTokens) u.fcmTokens = [];
      if (!u.fcmTokens.includes(token)) u.fcmTokens.push(token);
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
    toast(title, { description: body });
  });
}
