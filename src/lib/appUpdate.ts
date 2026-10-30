// A new version of the app, released while it is open.
//
// It is found every half hour and whenever the app comes back to the screen,
// and it WAITS (src/sw.ts): taking over at once dropped the old version's
// files from under the screen in use, so the next page opened was missing and
// the app reloaded itself mid-work — a blink, and a half-filled form gone. Now
// the person is told, with an Update button; tapped, the new version takes over
// and the app loads it. Not tapped, it takes over by itself the next time the
// app is opened after being closed.
import { toast } from "sonner";

const CHECK_EVERY_MS = 30 * 60e3;

export function watchForNewVersion(): void {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
  // Only a change from one version to another — not the first install.
  const hadController = !!navigator.serviceWorker.controller;
  let reloading = false;
  // The new version has taken over because Update was tapped: load it.
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (!hadController || reloading) return;
    reloading = true;
    window.location.reload();
  });
  let told = false;
  const offer = (waiting: ServiceWorker) => {
    if (told || !navigator.serviceWorker.controller) return;
    told = true;
    toast("A new version of the app is ready", {
      description: "Tap Update to load it — it takes a second.",
      duration: Infinity,
      action: { label: "Update", onClick: () => waiting.postMessage({ type: "SKIP_WAITING" }) },
    });
  };
  void navigator.serviceWorker.ready.then(reg => {
    // One already waiting (found while the app was in the background).
    if (reg.waiting) offer(reg.waiting);
    reg.addEventListener("updatefound", () => {
      const next = reg.installing;
      next?.addEventListener("statechange", () => { if (next.state === "installed") offer(next); });
    });
    const check = () => { reg.update().catch(() => { /* offline — next time */ }); };
    setInterval(check, CHECK_EVERY_MS);
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") check(); });
  }).catch(() => { /* no service worker here */ });
}
