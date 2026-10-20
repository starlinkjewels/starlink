// The new look, as a preview — Settings → Appearance → "New look (preview)".
//
// Switched on per device (this browser only), so the owner and the team can
// try it on the real app and switch back at any moment; nothing changes for
// anyone who has not switched it on. It only sets `data-studio` on <html>:
// every style of the new look lives in studio.css under that attribute, and
// no data, saving or logic depends on it.
//
// While it is on, the older appearance choices that would fight it (other
// looks, fonts, heading styles, corner sizes, table styles) step aside; each
// business keeps its brand colour and light/dark.

import { useSyncExternalStore } from "react";

const KEY = "ui:studio";
const listeners = new Set<() => void>();

/** Is the new look switched on on this device? */
export function studioOn(): boolean {
  try { return localStorage.getItem(KEY) === "1"; } catch { return false; }
}

/** Put the new look's marker on the page (or take it off). */
export function applyStudio(root: HTMLElement = document.documentElement): void {
  if (studioOn()) root.setAttribute("data-studio", "");
  else root.removeAttribute("data-studio");
}

/** Switch the new look on or off on this device. The caller re-applies appearance and table style. */
export function setStudio(on: boolean): void {
  try { if (on) localStorage.setItem(KEY, "1"); else localStorage.removeItem(KEY); } catch { /* private window: this visit only */ }
  applyStudio();
  listeners.forEach(l => l());
}

/** Is the new look on? Redraws when it is switched — for the parts of the new look that are layout, not style. */
export function useStudio(): boolean {
  return useSyncExternalStore(cb => { listeners.add(cb); return () => listeners.delete(cb); }, studioOn, () => false);
}
