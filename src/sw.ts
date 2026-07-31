// Custom service worker — merges vite-plugin-pwa's offline/precache behavior
// (previously auto-generated via the `generateSW` strategy) with Firebase
// Cloud Messaging background push handling in ONE worker. Two separate
// service workers both trying to control the root scope would conflict, so
// FCM's background handler has to live in the same file as the PWA caching
// logic rather than in its own firebase-messaging-sw.js.
/// <reference lib="webworker" />
import { precacheAndRoute, createHandlerBoundToURL } from "workbox-precaching";
import { registerRoute, NavigationRoute } from "workbox-routing";
import { CacheFirst } from "workbox-strategies";
import { ExpirationPlugin } from "workbox-expiration";
import { CacheableResponsePlugin } from "workbox-cacheable-response";
import { initializeApp } from "firebase/app";
import { getMessaging, onBackgroundMessage } from "firebase/messaging/sw";

declare let self: ServiceWorkerGlobalScope;

self.skipWaiting();

// ── Precache (replaces generateSW's auto-precache of the build output) ──
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
  apiKey: "AIzaSyBse5vfsARbl8k6ub9Mir6qs-CsPdaNuGU",
  authDomain: "starlinkjewels109.firebaseapp.com",
  projectId: "starlinkjewels109",
  storageBucket: "starlinkjewels109.firebasestorage.app",
  messagingSenderId: "192385163202",
  appId: "1:192385163202:web:6499e21aa7c34cd9e7c05b",
};
const firebaseApp = initializeApp(firebaseConfig);
const messaging = getMessaging(firebaseApp);

onBackgroundMessage(messaging, payload => {
  const title = payload.notification?.title || "Starlink Jewels";
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
