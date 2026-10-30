// Back — the phone's Back (button or swipe) and the browser's back arrow — as
// people expect it of an app:
//
//  1. An open panel, dialog or menu closes first, and the page stays. Opening
//     one adds a step to the history; Back takes that step and closes it.
//     Closed any other way (✕, Cancel, Save), the step is taken back out.
//  2. Back to a page returns to where it was: the scroll (useScrollMemory) and
//     each table's page, search and opened rows (useEntryState).
//  3. A page opened anew starts at the top.
//
// What a page was showing is kept per VISIT — one per step in the history (see
// syncVisit) — in sessionStorage, so it lasts as long as the tab, and a page
// opened anew starts clean.
import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigationType } from "react-router-dom";

/* ── 1. Layers: Back closes the top one ─────────────────────────────────── */

const active = new Set<string>();
const LAYER = "slLayer";
/** When a layer's step was added — so two steps of one page can be told apart in order. */
const SEQ = "slSeq";

/** Where a step sits: the page's place in the history, then (a layer's step) when it was added. */
const posOf = (state: unknown) => {
  const st = (state && typeof state === "object" ? state : {}) as Record<string, unknown>;
  return { idx: Number(st.idx) || 0, seq: Number(st[SEQ]) || 0 };
};

const layerOf = (state: unknown): string | undefined =>
  state && typeof state === "object" ? (state as Record<string, unknown>)[LAYER] as string | undefined : undefined;

// The step a closed layer gave back, while the browser is still taking it (Back
// is answered a moment later). If a page or another layer stepped on in that
// moment, the Back lands on the closed layer's own step instead — one too far —
// and is put right straight away (forward), unseen by the layers and the page.
let pendingId: string | null = null;
/** The last step added (a page opened, a layer opened) while that Back was on its way. */
let pushedSince: { state: unknown; url?: string | URL | null } | null = null;
/** The Back being put right — the layers ignore it. */
let wrongPop: Event | null = null;
const correcting = (e: Event) => e === wrongPop;

// A step left behind by a layer that is no longer open (two closed at once, or a
// link inside a panel opened a page): stepping onto it shows nothing new, so it
// is passed over — one Back press never seems to do nothing.
if (typeof window !== "undefined") {
  // Count the steps added while a Back is on its way (react-router and the layers
  // all add theirs through history.pushState).
  const push = window.history.pushState.bind(window.history);
  // Where we are, to tell a Back from a Forward when a dead step is passed over.
  let lastPos = posOf(window.history.state);
  window.history.pushState = ((...args: Parameters<History["pushState"]>) => {
    if (pendingId) pushedSince = { state: args[0], url: args[2] };
    const r = push(...args);
    lastPos = posOf(args[0]);
    return r;
  }) as History["pushState"];

  window.addEventListener("popstate", e => {
    const id = layerOf(window.history.state);
    const cur = posOf(window.history.state);
    const forward = cur.idx > lastPos.idx || (cur.idx === lastPos.idx && cur.seq > lastPos.seq);
    lastPos = cur;
    if (pendingId) {
      const added = pushedSince;
      pendingId = null;
      pushedSince = null;
      // A page or a layer was opened while this Back was on its way, and the Back
      // took it away (the browser drops that step). Put it back and show it again:
      // the step is added once more, and the page (react-router) and the layers are
      // told, as for any move — this Back itself is ignored by the layers.
      if (added) {
        wrongPop = e;
        push(added.state, "", added.url);
        lastPos = posOf(added.state);
        window.dispatchEvent(new PopStateEvent("popstate", { state: added.state }));
        return;
      }
    }
    // Passed over in the direction of travel: Forward goes on forward, Back goes on back.
    if (id && !active.has(id)) { if (forward) window.history.forward(); else window.history.back(); }
  });
}

// A layer closed by its own buttons takes its step back out — on the next tick, not
// at once: a dialog that is taken down and put straight back up (it moved in the
// page, or React tried its effects twice) reuses that step instead. Going back
// at once would land after the new one had stepped on, and close it.
let releasing: { id: string; timer: number } | null = null;

/** While `open`, Back closes it (calls onClose) instead of leaving the page. */
export function useBackToClose(open: boolean | undefined, onClose: (() => void) | undefined): void {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    if (!open || !closeRef.current) return;
    const id = Math.random().toString(36).slice(2, 10);
    active.add(id);
    try {
      if (releasing && layerOf(window.history.state) === releasing.id) {
        // The step a layer has just let go of is still on top: take it over.
        window.clearTimeout(releasing.timer);
        releasing = null;
        window.history.replaceState({ ...(window.history.state ?? {}), [LAYER]: id }, "");
      } else {
        // The same page and address, one step on — react-router's own fields (its key
        // and index) are kept, so to the router this is still the same page.
        window.history.pushState({ ...(window.history.state ?? {}), [LAYER]: id, [SEQ]: Date.now() }, "");
      }
    } catch { /* history unavailable */ }
    let poppedHere = false;
    const onPop = (e: Event) => {
      // A Back being put right (see pendingId): not meant for anyone.
      if (correcting(e)) return;
      // Still on this layer's step (a layer above it was closed): stay open.
      if (layerOf(window.history.state) === id) return;
      poppedHere = true;
      active.delete(id);
      closeRef.current?.();
    };
    window.addEventListener("popstate", onPop);
    return () => {
      window.removeEventListener("popstate", onPop);
      active.delete(id);
      // Closed by its own buttons: take its step back out — only when it is still the
      // top one (a link inside it may have opened a page since; that step stays).
      if (!poppedHere && layerOf(window.history.state) === id) {
        if (releasing) window.clearTimeout(releasing.timer);
        const timer = window.setTimeout(() => {
          if (releasing?.id !== id) return;
          releasing = null;
          if (layerOf(window.history.state) === id && !active.has(id)) {
            pendingId = id;
            pushedSince = null;
            try { window.history.back(); } catch { pendingId = null; }
          }
        }, 0);
        releasing = { id, timer };
      }
    };
  }, [open]);
}

/* ── 2. Visits: one per history entry ──────────────────────────────────── */

const store = {
  get<T>(k: string): T | undefined {
    try { const v = sessionStorage.getItem(k); return v == null ? undefined : (JSON.parse(v) as T); } catch { return undefined; }
  },
  set(k: string, v: unknown) {
    try { sessionStorage.setItem(k, JSON.stringify(v)); } catch { /* private window, full */ }
  },
};

// What a page showed is kept per VISIT — one per step in the history — not per
// router key: a list that tidies its address as it loads (its page number, a
// filter) replaces the entry and gets a new key, but it is the same visit.
// A visit is named by its position in the history (history.state.idx): a new
// page there (PUSH) is a new visit; Back/forward (POP) finds the one it was.
const VISITS = "sl-visits";
let lastLocKey: string | null = null;
let visit = "";
const idxNow = () => ((typeof window !== "undefined" ? window.history.state : null) as { idx?: number } | null)?.idx ?? 0;
const mainEl = () => (typeof document !== "undefined" ? document.querySelector<HTMLElement>("main.app-main") : null);

/**
 * Called by the app frame as it draws each location, before the page under it:
 * notes the scroll of the page being left, then names the visit now on screen.
 */
export function syncVisit(locKey: string, navType: string): string {
  if (locKey === lastLocKey) return visit;
  // The page being left is still on screen: keep its scroll exactly as it is now.
  const leaving = mainEl();
  if (visit && leaving) store.set(`sl-scroll:${visit}`, leaving.scrollTop);
  lastLocKey = locKey;
  const idx = idxNow();
  const v = store.get<string[]>(VISITS) ?? [];
  if (navType === "PUSH" || !v[idx]) {
    v[idx] = Math.random().toString(36).slice(2, 10);
    v.length = idx + 1; // the steps ahead are gone
    store.set(VISITS, v);
    prune(new Set(v));
  }
  visit = v[idx];
  return visit;
}
export const currentVisit = () => visit;

/** What was kept for visits no longer in the history goes — the tab's storage never fills up. */
function prune(keep: Set<string>): void {
  try {
    const gone: string[] = [];
    for (let i = 0; i < sessionStorage.length; i++) {
      const k = sessionStorage.key(i) ?? "";
      const m = /^sl-(?:entry|scroll):([^:]+)/.exec(k);
      if (m && !keep.has(m[1])) gone.push(k);
    }
    for (const k of gone) sessionStorage.removeItem(k);
  } catch { /* storage unavailable */ }
}

/**
 * Like useState, but remembered for this visit of this page: Back to the page
 * brings the value back; opening the page anew starts from `initial`.
 * `name` tells apart several on one page (a table's id).
 */
export function useEntryState<T>(name: string, initial: T): [T, (v: T | ((prev: T) => T)) => void] {
  useLocation(); // drawn again on every move, so the visit below is current
  const k = `sl-entry:${currentVisit()}:${name}`;
  const [value, setValue] = useState<T>(() => store.get<T>(k) ?? initial);
  const kRef = useRef(k);
  // A different visit under the same component (Back/forward between two visits of one page).
  useEffect(() => {
    if (kRef.current === k) return;
    kRef.current = k;
    setValue(store.get<T>(k) ?? initial);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [k]);
  // Kept under the visit this render belongs to (a reset during the first render of
  // a new visit must not land on the visit before it).
  const set = (v: T | ((prev: T) => T)) => setValue(prev => {
    const next = typeof v === "function" ? (v as (p: T) => T)(prev) : v;
    store.set(k, next);
    return next;
  });
  return [value, set];
}

/* ── 3. The scroll, per visit ───────────────────────────────────────────── */

/**
 * The app's pages scroll inside <main> (the frame itself never scrolls), so the
 * browser can't put the scroll back on Back — this does. Back or forward to a
 * page: its scroll comes back, waiting for its rows to arrive (up to a few
 * seconds) and giving up the moment the person scrolls. A page opened anew:
 * the top.
 */
export function useScrollMemory(): void {
  const loc = useLocation();
  const navType = useNavigationType();
  const v = syncVisit(loc.key, navType);

  // Remember the scroll as it changes too (for a reload, or a tab put away).
  useEffect(() => {
    let t = 0;
    const onScroll = (e: Event) => {
      const el = e.target;
      if (!(el instanceof HTMLElement) || el !== mainEl()) return;
      window.clearTimeout(t);
      const at = visit, top = el.scrollTop;
      t = window.setTimeout(() => { if (at === visit) store.set(`sl-scroll:${at}`, top); }, 120);
    };
    document.addEventListener("scroll", onScroll, true);
    return () => { document.removeEventListener("scroll", onScroll, true); window.clearTimeout(t); };
  }, []);

  useEffect(() => {
    const main = mainEl();
    if (!main) return;
    if (navType !== "POP") {
      // Opened anew (a link, a row, a menu): the top.
      main.scrollTop = 0;
      return;
    }
    const want = store.get<number>(`sl-scroll:${v}`) ?? 0;
    if (!want) { main.scrollTop = 0; return; }
    let stop = false;
    const quit = () => { stop = true; };
    main.addEventListener("wheel", quit, { passive: true, once: true });
    main.addEventListener("touchstart", quit, { passive: true, once: true });
    const started = Date.now();
    const tryNow = () => {
      if (stop) return;
      const m = mainEl();
      if (!m) return;
      if (m.scrollHeight - m.clientHeight >= want - 2) { m.scrollTop = want; if (Date.now() - started < 600) requestAnimationFrame(tryNow); return; }
      // Not long enough yet — its rows are still on their way.
      if (Date.now() - started < 4000) requestAnimationFrame(tryNow);
    };
    requestAnimationFrame(tryNow);
    return () => { stop = true; main.removeEventListener("wheel", quit); main.removeEventListener("touchstart", quit); };
    // Only when the visit changes — closing a panel (a step back to the same page) moves nothing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [v]);
}

/* ── The page before this one, for the in-app back arrow ────────────────── */

const TRAIL = "sl-trail";
/** Note the page at this history position (AppLayout, on every move). */
export function noteTrail(idx: number, path: string): void {
  const t = store.get<string[]>(TRAIL) ?? [];
  t[idx] = path;
  t.length = idx + 1;
  store.set(TRAIL, t);
}
/** The path of the page one step back, when it is one of ours. */
export function previousPath(): string | undefined {
  const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0;
  if (idx <= 0) return undefined;
  return (store.get<string[]>(TRAIL) ?? [])[idx - 1];
}
