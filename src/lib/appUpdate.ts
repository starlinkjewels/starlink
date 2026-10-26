// A tab left open keeps running the version it loaded, however many times the
// app is released after it — so someone could go a whole day on old code (an
// order placed that way sent no alerts). This looks for a new version every
// half hour and whenever the tab comes back, and when one has taken over says
// so, with a button to load it. Never on its own: a half-filled form stays.
import { toast } from "sonner";

const CHECK_EVERY_MS = 30 * 60e3;

export function watchForNewVersion(): void {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
  // Only a change from one version to another — not the first install.
  const hadController = !!navigator.serviceWorker.controller;
  let told = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (!hadController || told) return;
    told = true;
    toast("A new version of the app is ready", {
      description: "Update to get the latest — it takes a second.",
      duration: Infinity,
      action: { label: "Update", onClick: () => window.location.reload() },
    });
  });
  void navigator.serviceWorker.ready.then(reg => {
    const check = () => { reg.update().catch(() => { /* offline — next time */ }); };
    setInterval(check, CHECK_EVERY_MS);
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") check(); });
  }).catch(() => { /* no service worker here */ });
}
