import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { App } from "./App";
import { AuthProvider } from "./lib/auth";
import { Toaster } from "@/components/ui/sonner";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import "./styles.css";
import "./studio.css";
import { applyRememberedAppearance } from "@/lib/appearance";
import { applyStudio } from "@/lib/studio";
import { applyBrand, getBrand, loadBrand } from "@/lib/brand";
import { watchForNewVersion } from "@/lib/appUpdate";
import { toast } from "sonner";

// Open in the look this device last showed, before any data arrives — no flash of the default.
// The new look (preview) first, so the appearance below knows whether to step aside.
applyStudio();
applyRememberedAppearance();
// The company's own brand: as this device remembers it at once, then as saved (readable before sign-in).
applyBrand(getBrand());
void loadBrand();

// A tab open since before the last release is told when the new one is ready.
watchForNewVersion();

// Scrolling the page over a number field that has the cursor in it would
// quietly change the amount (the browser's wheel step) — let go of the field
// instead, so the page scrolls and the figure stays as typed.
document.addEventListener("wheel", (e) => {
  const el = document.activeElement;
  if (el instanceof HTMLInputElement && el.type === "number" && e.target === el) el.blur();
}, { passive: true });

const qc = new QueryClient();

// Cross-deploy safety net. Pages are lazy-loaded, so a tab still running an
// OLD build can try to import a chunk hash that no longer exists after a new
// deploy — the server then returns index.html (MIME text/html) and the import
// fails ("Failed to fetch dynamically imported module"). Vite fires
// `vite:preloadError` for exactly this; refresh once to pull the new build.
// The 15s guard stops any reload loop if a refresh doesn't resolve it.
window.addEventListener("vite:preloadError", (e) => {
  e.preventDefault();
  const KEY = "sl-preload-reload-at";
  const now = Date.now();
  const last = Number(sessionStorage.getItem(KEY) || 0);
  if (now - last > 15000) {
    sessionStorage.setItem(KEY, String(now));
    window.location.reload();
  }
});

// A save tapped in the first second after opening, while the device's saved
// copy is still on screen, is refused before anything changes (see
// StaleDataError in lib/db.ts) — a short note instead of an error.
let staleNoteAt = 0;
const onStale = (err: unknown, e: Event) => {
  if ((err as Error | undefined)?.name !== "StaleDataError") return;
  e.preventDefault();
  const now = Date.now();
  if (now - staleNoteAt < 3000) return;
  staleNoteAt = now;
  toast("One moment — getting the latest. Try again.");
};
window.addEventListener("error", (e) => onStale(e.error, e));
window.addEventListener("unhandledrejection", (e) => onStale(e.reason, e));

// AuthProvider owns the boot sequence: it shows a splash until Firebase Auth
// resolves, loads Firestore data only after sign-in, and renders the app.
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={qc}>
      <BrowserRouter>
        <AuthProvider>
          {/* Last line of defence: never an empty page — see ErrorBoundary. */}
          <ErrorBoundary fullScreen>
            <App />
          </ErrorBoundary>
          <Toaster position="top-center" richColors />
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>
);
