// Custom service worker — merges vite-plugin-pwa's offline/precache behavior
// (previously auto-generated via the `generateSW` strategy) with Firebase
// Cloud Messaging background push handling in ONE worker. Two separate
// service workers both trying to control the root scope would conflict, so
// FCM's background handler has to live in the same file as the PWA caching
// logic rather than in its own firebase-messaging-sw.js.
/// <reference lib="webworker" />
import { precacheAndRoute, createHandlerBoundToURL, cleanupOutdatedCaches } from "workbox-precaching";
import { registerRoute, NavigationRoute } from "workbox-routing";
import { CacheFirst } from "workbox-strategies";
import { ExpirationPlugin } from "workbox-expiration";
import { CacheableResponsePlugin } from "workbox-cacheable-response";
import { initializeApp } from "firebase/app";
import { getMessaging, onBackgroundMessage } from "firebase/messaging/sw";

declare let self: ServiceWorkerGlobalScope;

// A new deploy's worker activates immediately and takes control of open tabs,
// and old precaches are dropped — so after the vite:preloadError refresh in
// main.tsx, requests resolve against the fresh chunk hashes, not stale ones.
self.skipWaiting();
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

// ── Firebase Cloud Messaging — background push (tab/app not focused) ──
const firebaseConfig = {
  apiKey: "AIzaSyCOkXybrDQX9TLbHs9fyLvrKLt5XWAIgwI",
  authDomain: "flenix-jewels.firebaseapp.com",
  projectId: "flenix-jewels",
  storageBucket: "flenix-jewels.firebasestorage.app",
  messagingSenderId: "758181914278",
  appId: "1:758181914278:web:cb951281b928920a2cf667",
};
const firebaseApp = initializeApp(firebaseConfig);
const messaging = getMessaging(firebaseApp);

onBackgroundMessage(messaging, payload => {
  const title = payload.notification?.title || "Flenix Jewels";
  const body = payload.notification?.body;
  self.registration.showNotification(title, {
    body,
    icon: "/icon.png",
    data: { link: payload.fcmOptions?.link || payload.data?.link || "/notifications" },
  });
});

self.addEventListener("notificationclick", (event: NotificationEvent) => {
  event.notification.close();
  const link = (event.notification.data?.link as string) || "/notifications";
  event.waitUntil(self.clients.openWindow(link));
});
