import { onDocumentCreated } from "firebase-functions/v2/firestore";
import { getMessaging } from "firebase-admin/messaging";
import { db } from "./lib/firestoreAdmin";

/**
 * Fires whenever a Notification doc is created (src/pages/*.tsx across the
 * web app push these directly to the "notifications" collection) — delivers
 * a real OS-level push to every browser/device that user has granted
 * permission on (src/lib/push.ts registers the token onto their User doc).
 * No-ops for a user with no registered tokens (never asked, or unsupported
 * browser) — this is additive on top of the existing in-app notification
 * list, never required for it to keep working.
 */
export const sendNotificationPush = onDocumentCreated(
  {
    document: "notifications/{notifId}",
    database: "diamondflowdemo",
    region: "us-central1",
    memory: "256MiB",
    minInstances: 0,
    maxInstances: 3,
  },
  async event => {
    const notif = event.data?.data() as { userId?: string; title?: string; body?: string } | undefined;
    if (!notif?.userId || !notif.title) return;

    const userRef = db.collection("users").doc(notif.userId);
    const userDoc = await userRef.get();
    const tokens: string[] = userDoc.data()?.fcmTokens ?? [];
    if (!tokens.length) return;

    const resp = await getMessaging().sendEachForMulticast({
      tokens,
      notification: { title: notif.title, body: notif.body },
      webpush: {
        fcmOptions: { link: "/notifications" },
        notification: { icon: "/icon.png" },
      },
    });

    // Prune tokens FCM reports as unregistered (uninstalled/expired) so the
    // array doesn't grow stale forever.
    const bad = resp.responses
      .map((r, i) => (!r.success && r.error?.code === "messaging/registration-token-not-registered" ? tokens[i] : null))
      .filter((t): t is string => !!t);
    if (bad.length) await userRef.update({ fcmTokens: tokens.filter(t => !bad.includes(t)) });
  },
);
