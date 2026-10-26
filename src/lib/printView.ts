// Bills, labels and other print pages, shown INSIDE the app.
//
// They used to open a new browser window. In the installed app (Mac, iPhone)
// that window has no way back — no tab bar, no close — so the only way out was
// to quit the app. Now the page shows over the app, full screen, with Print
// and Close at the top; Close (or Back, or Esc) returns to where you were.
//
// Plain DOM rather than React: the print helpers live in lib/ and are called
// from many screens.

const ROOT_ID = "sl-print-view";

/** The page's own "print as soon as it loads" — here Print is the button. */
function withoutAutoPrint(html: string): string {
  return html.replace(/<script>[^<]*window\.print\(\)[^<]*<\/script>/g, "");
}

/** Show a print page over the app. `autoPrint` opens the print dialog at once, as the old window did. */
export function showPrintPage(html: string, opts: { title?: string; autoPrint?: boolean } = {}): void {
  closePrintPage();
  const root = document.createElement("div");
  root.id = ROOT_ID;
  root.setAttribute("role", "dialog");
  root.setAttribute("aria-modal", "true");
  root.setAttribute("aria-label", opts.title || "Print preview");
  root.style.cssText = "position:fixed;inset:0;z-index:2147483000;display:flex;flex-direction:column;background:#f1f5f9;";

  const bar = document.createElement("div");
  bar.style.cssText = "flex:none;display:flex;align-items:center;gap:8px;padding:calc(env(safe-area-inset-top) + 8px) 12px 8px;background:#fff;border-bottom:1px solid #e2e8f0;box-shadow:0 1px 3px rgba(15,23,42,.06);font-family:Inter,system-ui,sans-serif;";
  const title = document.createElement("div");
  title.textContent = opts.title || "Print preview";
  title.style.cssText = "flex:1;min-width:0;font-size:15px;font-weight:600;color:#0f172a;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;";
  const btn = (label: string, primary: boolean) => {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = label;
    b.style.cssText = `height:40px;padding:0 18px;border-radius:12px;font-size:14px;font-weight:600;cursor:pointer;font-family:inherit;${primary
      ? "background:var(--color-primary,#1f4ea3);color:#fff;border:0;"
      : "background:#fff;color:#0f172a;border:1px solid #cbd5e1;"}`;
    return b;
  };
  const print = btn("Print", true);
  const close = btn("Close", false);
  close.setAttribute("aria-label", "Close the print preview");
  bar.append(title, print, close);

  const frame = document.createElement("iframe");
  frame.title = opts.title || "Print preview";
  frame.style.cssText = "flex:1;width:100%;border:0;background:#fff;";
  frame.srcdoc = withoutAutoPrint(html);

  root.append(bar, frame);
  document.body.appendChild(root);
  document.documentElement.style.overflow = "hidden";

  const doPrint = () => { try { frame.contentWindow?.focus(); frame.contentWindow?.print(); } catch { window.print(); } };
  print.onclick = doPrint;
  close.onclick = () => closePrintPage();
  if (opts.autoPrint) frame.addEventListener("load", () => setTimeout(doPrint, 250), { once: true });

  // Back (the phone's, the browser's) closes it rather than leaving the page.
  try { history.pushState({ slPrintView: true }, ""); } catch { /* ignore */ }
  const onPop = () => closePrintPage(true);
  const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") closePrintPage(); };
  window.addEventListener("popstate", onPop);
  window.addEventListener("keydown", onKey);
  (root as HTMLDivElement & { _cleanup?: () => void })._cleanup = () => {
    window.removeEventListener("popstate", onPop);
    window.removeEventListener("keydown", onKey);
  };
  close.focus();
}

/** Close the print page, if one is open. */
export function closePrintPage(fromBack = false): void {
  const root = document.getElementById(ROOT_ID) as (HTMLDivElement & { _cleanup?: () => void }) | null;
  if (!root) return;
  root._cleanup?.();
  root.remove();
  document.documentElement.style.overflow = "";
  // Closed with the button: take back the history step opening it added.
  if (!fromBack && history.state?.slPrintView) { try { history.back(); } catch { /* ignore */ } }
}

/** Running as the installed app (Mac, iPhone, Android home screen) — no tabs, no browser close. */
export function isInstalledApp(): boolean {
  try {
    return window.matchMedia("(display-mode: standalone)").matches
      || (navigator as Navigator & { standalone?: boolean }).standalone === true;
  } catch { return false; }
}
