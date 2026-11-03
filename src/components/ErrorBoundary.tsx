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

/** "/orders/abc · OrderDetail-x1y2.js:14 · in OrderPage" — short enough for a screenshot. */
function whereText(error: Error, componentStack?: string): string {
  const frame = (error?.stack ?? "").split(/\r?\n/).map(l => l.trim()).find(l => /^at /.test(l) && /\.(js|tsx?)/.test(l)) ?? "";
  const file = frame.match(/([\w.-]+\.(?:js|tsx?)(?::\d+)?)/)?.[1] ?? "";
  const comp = (componentStack ?? "").split(/\r?\n/).map(l => l.trim()).find(l => /^at [A-Z]/.test(l))?.replace(/^at /, "").split(" ")[0] ?? "";
  return [typeof window !== "undefined" ? window.location.pathname : "", file, comp && `in ${comp}`].filter(Boolean).join(" · ");
}
/** Everything about it, for "Copy details". */
function details(error: Error, componentStack?: string): string {
  return [String(error?.message ?? error), `Page: ${typeof window !== "undefined" ? window.location.href : ""}`, `When: ${new Date().toISOString()}`,
    "", "Stack:", error?.stack ?? "", "", "Screen:", componentStack ?? ""].join(String.fromCharCode(10)).slice(0, 8000);
}

export class ErrorBoundary extends Component<
  { children: ReactNode; resetKey?: string; fullScreen?: boolean },
  { error: Error | null; reloading: boolean; where?: string }
> {
  state = { error: null as Error | null, reloading: false, where: undefined as string | undefined };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Something saved by itself in the first second, from the saved copy: refused
    // before anything changed — draw the screen again once the server has answered.
    if (error?.name === "StaleDataError") { void whenFresh().then(() => this.setState({ error: null, reloading: false })); return; }
    console.error("[app] a screen failed to draw:", error, info.componentStack);
    this.setState({ where: info.componentStack ?? undefined });
    if (CHUNK_ERROR.test(String(error?.message ?? error)) && reloadOnceForNewBuild()) this.setState({ reloading: true });
  }

  componentDidUpdate(prev: { resetKey?: string }) {
    if (this.state.error && prev.resetKey !== this.props.resetKey) this.setState({ error: null, reloading: false, where: undefined });
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
            {/* Where it broke — the page, and the file it broke in — so a screenshot says exactly what to fix. */}
            <p className="mt-1 text-[10px] text-muted-foreground/70 break-words font-mono">{whereText(error, this.state.where)}</p>
            <button type="button" className="mt-2 text-[11px] font-medium text-primary hover:underline"
              onClick={() => { void navigator.clipboard?.writeText(details(error, this.state.where)).catch(() => undefined); }}>
              Copy details
            </button>
          </>
        )}
      </div>
    );
    return this.props.fullScreen
      ? <div className="min-h-screen grid place-items-center bg-background p-4">{box}</div>
      : <div className="mt-10 px-1">{box}</div>;
  }
}
