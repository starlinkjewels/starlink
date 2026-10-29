import { Component, type ErrorInfo, type ReactNode } from "react";
import { AlertTriangle, RotateCw } from "lucide-react";
import { flush, whenFresh } from "@/lib/db";

/**
 * A screen that breaks while drawing used to take the whole app with it — React
 * drops everything it rendered, and all that is left is an empty page with no
 * way back but closing the app. This catches it instead.
 *
 * - A page of an OLD build asking for a file the new deploy replaced: reload
 *   once, quietly (same guard as the vite:preloadError handler in main.tsx).
 * - Anything else: say so, offer Reload, and show the error's own words small
 *   underneath — a screenshot of that tells us exactly what broke.
 *
 * `resetKey` (the address) clears it, so moving to another page from the menu
 * works straight away.
 */
const CHUNK_ERROR = /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module|Loading chunk|ChunkLoadError|Unable to preload CSS/i;
const RELOAD_KEY = "sl-preload-reload-at";

function reloadOnceForNewBuild(): boolean {
  try {
    const last = Number(sessionStorage.getItem(RELOAD_KEY) || 0);
    if (Date.now() - last < 15000) return false;
    sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
  } catch { /* no storage — reload anyway */ }
  window.location.reload();
  return true;
}

/** Changes already made go up before the page is reloaded — or after 4s, whichever comes first. */
async function reload() {
  await Promise.race([flush(), new Promise(r => setTimeout(r, 4000))]);
  window.location.reload();
}

export class ErrorBoundary extends Component<
  { children: ReactNode; resetKey?: string; fullScreen?: boolean },
  { error: Error | null; reloading: boolean }
> {
  state = { error: null as Error | null, reloading: false };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Something saved by itself in the first second, from the saved copy: refused
    // before anything changed — draw the screen again once the server has answered.
    if (error?.name === "StaleDataError") { void whenFresh().then(() => this.setState({ error: null, reloading: false })); return; }
    console.error("[app] a screen failed to draw:", error, info.componentStack);
    if (CHUNK_ERROR.test(String(error?.message ?? error)) && reloadOnceForNewBuild()) this.setState({ reloading: true });
  }

  componentDidUpdate(prev: { resetKey?: string }) {
    if (this.state.error && prev.resetKey !== this.props.resetKey) this.setState({ error: null, reloading: false });
  }

  render() {
    const { error, reloading } = this.state;
    if (!error) return this.props.children;
    if (error.name === "StaleDataError") return <div className="py-24 text-center text-xs text-muted-foreground">Getting the latest…</div>;
    const box = (
      <div className="card-luxe max-w-lg w-full mx-auto p-8 text-center">
        <AlertTriangle className="h-8 w-8 text-amber-500 mx-auto mb-3" />
        <h2 className="font-display text-xl text-brand-dark">
          {reloading ? "Updating to the latest version…" : "This screen didn't load"}
        </h2>
        {!reloading && (
          <>
            <p className="text-sm text-muted-foreground mt-1">
              Anything already saved is safe. Reload to carry on — if it happens again, send us a screenshot of this box.
            </p>
            <button
              type="button"
              onClick={() => { this.setState({ reloading: true }); void reload(); }}
              className="mt-5 inline-flex items-center gap-2 rounded-xl bg-primary px-5 h-10 text-sm font-semibold text-primary-foreground hover:opacity-90"
            >
              <RotateCw className="h-4 w-4" /> Reload
            </button>
            <p className="mt-5 text-[11px] text-muted-foreground/80 break-words font-mono">
              {String(error?.message ?? error).slice(0, 300)}
            </p>
          </>
        )}
      </div>
    );
    return this.props.fullScreen
      ? <div className="min-h-screen grid place-items-center bg-background p-4">{box}</div>
      : <div className="mt-10 px-1">{box}</div>;
  }
}
