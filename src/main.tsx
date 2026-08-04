import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { App } from "./App";
import { AuthProvider } from "./lib/auth";
import { Toaster } from "@/components/ui/sonner";
import "./styles.css";

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

// AuthProvider owns the boot sequence: it shows a splash until Firebase Auth
// resolves, loads Firestore data only after sign-in, and renders the app.
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={qc}>
      <BrowserRouter>
        <AuthProvider>
          <App />
          <Toaster position="top-center" richColors />
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>
);
