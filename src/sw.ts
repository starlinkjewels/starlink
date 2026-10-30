// Custom service worker — merges vite-plugin-pwa's offline/precache behavior
// (previously auto-generated via the `generateSW` strategy) with Firebase
// Cloud Messaging background push handling in ONE worker. Two separate
// service workers both trying to control the root scope would conflict, so
// FCM's background handler has to live in the same file as the PWA caching
// logic rather than in its own firebase-messaging-sw.js.
/// <reference lib="webworker" />
import { precacheAndRoute, createHandlerBoundToURL, cleanupOutdatedCaches } from "workbox-precaching";
import { registerRoute, NavigationRoute } from "workbox-routing";
import { CacheFirst, StaleWhileRevalidate } from "workbox-strategies";
import { ExpirationPlugin } from "workbox-expiration";
import { CacheableResponsePlugin } from "workbox-cacheable-response";
import { initializeApp } from "firebase/app";
import { getMessaging, onBackgroundMessage } from "firebase/messaging/sw";

declare let self: ServiceWorkerGlobalScope;

// A new version WAITS while the app is open: taking over at once dropped the old
// version's files from under the screen in use, so the next page it opened was
// missing and the app reloaded itself mid-work (a blink). It takes over when the
// person taps Update (lib/appUpdate.ts sends SKIP_WAITING), or by itself the next
// time the app is opened after being closed.
self.addEventListener("message", (event) => {
  if ((event.data as { type?: string } | undefined)?.type === "SKIP_WAITING") void self.skipWaiting();
});
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

// ── Precache (replaces generateSW's auto-precache of the build output) ──
cleanupOutdatedCaches();
precacheAndRoute(self.__WB_MANIFEST);

// ── SPA navigation fallback (replaces generateSW's navigateFallback) ──
registerRoute(new NavigationRoute(createHandlerBoundToURL("/index.html")));

// ── Firebase Storage images — CacheFirst, same rule as the old workbox.runtimeCaching config ──
registerRoute(
  ({ url }) => url.hostname.includes("firebasestorage") || url.hostname.endsWith(".firebasestorage.app"),
  new CacheFirst({
    cacheName: "sl-firebase-images",
    plugins: [
      new CacheableResponsePlugin({ statuses: [0, 200] }),
      new ExpirationPlugin({
        maxEntries: 600,
        maxAgeSeconds: 60 * 60 * 24 * 30, // 30 days
        purgeOnQuotaError: true,
      }),
    ],
  }),
);

// ── Google Fonts — the font chosen in Settings → Appearance, offline too:
// the small stylesheet refreshed in the background, the font files (which
// never change at a given address) kept for a year. ──
registerRoute(
  ({ url }) => url.origin === "https://fonts.googleapis.com",
  new StaleWhileRevalidate({
    cacheName: "sl-google-fonts-css",
    plugins: [new ExpirationPlugin({ maxEntries: 20, purgeOnQuotaError: true })],
  }),
);
registerRoute(
  ({ url }) => url.origin === "https://fonts.gstatic.com",
  new CacheFirst({
    cacheName: "sl-google-fonts",
    plugins: [
      new CacheableResponsePlugin({ statuses: [0, 200] }),
      new ExpirationPlugin({ maxEntries: 80, maxAgeSeconds: 60 * 60 * 24 * 365, purgeOnQuotaError: true }),
    ],
  }),
);

// ── Firebase Cloud Messaging — background push (tab/app not focused) ──
// Shree Suktam Diamond's own project — must match src/lib/firebase.ts.
const firebaseConfig = {
  apiKey: "AIzaSyA1Dz2AQD64atmV4WP20rBvNL6IH3tNG4A",
  authDomain: "diamondflow-35f6e.firebaseapp.com",
  projectId: "diamondflow-35f6e",
  storageBucket: "diamondflow-35f6e.firebasestorage.app",
  messagingSenderId: "619733591596",
  appId: "1:619733591596:web:d8564b89b8bf8b795e1389",
};
const firebaseApp = initializeApp(firebaseConfig);
const messaging = getMessaging(firebaseApp);

onBackgroundMessage(messaging, payload => {
  // A push that carries its own notification is shown by Firebase itself;
  // showing it here as well put every alert on the screen twice.
  if (payload.notification) return;
  const title = payload.data?.title || "Shree Suktam Diamond";
  const body = payload.data?.body;
  self.registration.showNotification(title, {
    body,
    tag: payload.data?.id,
    icon: "/icon.png",
    data: { link: payload.fcmOptions?.link || payload.data?.link || "/notifications" },
  });
});

self.addEventListener("notificationclick", (event: NotificationEvent) => {
  event.notification.close();
  const link = (event.notification.data?.link as string) || "/notifications";
  event.waitUntil(self.clients.openWindow(link));
});
