import { useState } from "react";
import { useSearchParams } from "react-router-dom";

/**
 * The tab a page shows — one list at a time, the standard for a page with
 * several (tabs over data sets: Material Design; tabs used right: NN/g), so a
 * long list never hides another one under it.
 *
 *  • Opens on the page's main list (`main`), then on the one last chosen on
 *    this kind of page in this visit to the app (every client page opens where
 *    the last one was left).
 *  • Kept in the address (?tab=…, replaced — never added to the history), so
 *    Back from a record returns to the same tab, and a link can open one.
 *  • Only tabs that are there count (`keys`): one hidden for this person, or
 *    empty, falls back to the main one.
 *  • `param`: the address word — "tab" for the page's tabs; tabs inside a tab
 *    (SubTabs) take their own, so the two never step on each other.
 *  • `startOnMain`: a link that came for something on the main list (an
 *    invoice searched for, a stone looked up) opens on it, not on the tab last
 *    left — read once, when the page opens; a ?tab= in the link still wins.
 */
export function usePageTab<K extends string>(page: string, keys: readonly K[], main: K, param = "tab", startOnMain = false): [K, (k: K) => void] {
  const [sp, setSp] = useSearchParams();
  const memo = `sl-tab:${page}`;
  useState(() => {
    if (startOnMain && !sp.get(param)) { try { sessionStorage.setItem(memo, main); } catch { /* private window */ } }
    return true;
  });
  const remembered = (() => { try { return sessionStorage.getItem(memo) ?? ""; } catch { return ""; } })();
  const want = sp.get(param) ?? remembered;
  const value = (keys as readonly string[]).includes(want) ? (want as K) : (keys.includes(main) ? main : keys[0] ?? main);
  const set = (k: K) => {
    try { sessionStorage.setItem(memo, k); } catch { /* private window */ }
    setSp(prev => {
      const n = new URLSearchParams(prev);
      if (k === main) n.delete(param); else n.set(param, k);
      return n;
    }, { replace: true });
  };
  return [value, set];
}
