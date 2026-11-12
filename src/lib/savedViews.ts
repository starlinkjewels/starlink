// Saved views — a list's whole setup kept under a name and opened again in one
// click: its search, filters, date range, sort, the columns shown, row spacing,
// rows a page and table/cards. Every table that has the full toolbar
// (components/DataTable.tsx) offers them, so every list page does.
//
//   • Mine — anyone on the staff saves views for themselves; only they see them.
//   • The team's — an admin may share a view; everyone on the staff sees it.
//   • Opens with — each person may star one view per table: the page opens with
//     it when opened afresh (never on Back, never from a link that already says
//     what to show). "Plain list" always goes back to nothing narrowed.
//
// Kept on their own, outside the main sync (lib/db.ts) — like reminders — so a
// view is never part of a save of business records: `savedViews` (one doc a
// view; the rules let a person write only their own unshared ones, an admin
// any) and `viewDefaults/<appId>` (a person's starred views). Clients have none.
import { useSyncExternalStore } from "react";
import { collection, deleteDoc, doc, onSnapshot, query, setDoc, where, type Unsubscribe } from "firebase/firestore";
import { db as fsdb } from "./firebase";

export type Density = "compact" | "normal" | "spacious";
/** One filter's value, by its kind: a choice, a date range, or a from–to range. */
export interface FilterValue { v?: string; from?: string; to?: string; min?: string; max?: string }
export interface ViewState {
  search?: string;
  /** Keyed by the filter's name on its table (see filterKey). */
  filters?: Record<string, FilterValue>;
  sort?: { key: string; dir: "asc" | "desc" } | null;
  /** The columns hidden, and the columns there were — a column added since starts as it would. */
  hidden?: string[];
  seen?: string[];
  forced?: string[];
  dense?: Density;
  pageSize?: number;
  layout?: "cards" | "table";
  /** The page's own part — how it shows the list ({ layout: "grid" }). */
  page?: Record<string, string>;
}
export interface SavedView {
  id: string;
  /** The table it belongs to (DataTable's `id`). */
  table: string;
  name: string;
  ownerId: string;
  ownerName?: string;
  shared: boolean;
  state: ViewState;
  createdAt: string;
  updatedAt: string;
}

const COL = "savedViews";
const DEFAULTS = "viewDefaults";
/** Firestore refuses `undefined`. */
const plain = <T,>(x: T): T => JSON.parse(JSON.stringify(x));

/* ── The store: this person's views, the team's, and their stars ─────────── */

interface Snap { ready: boolean; denied: boolean; mine: SavedView[]; team: SavedView[]; defaults: Record<string, string> }
let snap: Snap = { ready: false, denied: false, mine: [], team: [], defaults: {} };
let who: string | null = null;
let offs: Unsubscribe[] = [];
const listeners = new Set<() => void>();
const emit = (next: Partial<Snap>) => { snap = { ...snap, ...next }; listeners.forEach(l => l()); };

/** Start (or switch) listening for this person — staff only; null stops. */
export function watchViews(appId: string | null): void {
  if (appId === who) return;
  offs.forEach(f => f()); offs = [];
  who = appId;
  snap = { ready: false, denied: false, mine: [], team: [], defaults: {} };
  listeners.forEach(l => l());
  if (!appId) return;
  let got = 0;
  const done = () => { if (++got >= 3) emit({ ready: true }); };
  const fail = (e: unknown) => {
    console.warn("[views] not available:", (e as { code?: string })?.code ?? e);
    emit({ denied: true, ready: true });
  };
  const sortByName = (a: SavedView, b: SavedView) => a.name.localeCompare(b.name);
  offs.push(onSnapshot(query(collection(fsdb, COL), where("ownerId", "==", appId)),
    s => { emit({ mine: s.docs.map(d => ({ ...(d.data() as SavedView), id: d.id })).filter(v => !v.shared).sort(sortByName) }); done(); }, fail));
  offs.push(onSnapshot(query(collection(fsdb, COL), where("shared", "==", true)),
    s => { emit({ team: s.docs.map(d => ({ ...(d.data() as SavedView), id: d.id })).sort(sortByName) }); done(); }, fail));
  offs.push(onSnapshot(doc(fsdb, DEFAULTS, appId),
    s => { emit({ defaults: ((s.data()?.defaults as Record<string, string> | undefined) ?? {}) }); done(); }, fail));
}

const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
/** The views of one table — this person's and the team's — and their star. */
export function useTableViews(table: string): { ready: boolean; denied: boolean; mine: SavedView[]; team: SavedView[]; defaultId?: string } {
  const s = useSyncExternalStore(subscribe, () => snap, () => snap);
  return {
    ready: s.ready, denied: s.denied,
    mine: s.mine.filter(v => v.table === table), team: s.team.filter(v => v.table === table),
    defaultId: s.defaults[table],
  };
}
export const viewsSnapshot = () => snap;

/* ── Saving ───────────────────────────────────────────────────────────────── */

export const newViewId = () => `vw_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

export async function saveView(v: SavedView): Promise<void> {
  await setDoc(doc(fsdb, COL, v.id), plain(v));
}
export async function deleteView(v: SavedView, appId: string): Promise<void> {
  await deleteDoc(doc(fsdb, COL, v.id));
  // Starred: the star goes too.
  if (appId && snap.defaults[v.table] === v.id) await setDefaultView(appId, v.table, null);
}
/** Star a view to open the table with (null: none). */
export async function setDefaultView(appId: string, table: string, viewId: string | null): Promise<void> {
  const defaults = { ...snap.defaults };
  if (viewId) defaults[table] = viewId; else delete defaults[table];
  await setDoc(doc(fsdb, DEFAULTS, appId), { defaults, updatedAt: new Date().toISOString() });
}

/* ── Comparing what is shown with a view ─────────────────────────────────── */

/** What decides what a view shows, as one string — two equal strings: the same view. */
export function viewKey(s: ViewState): string {
  const filters = Object.entries(s.filters ?? {})
    .map(([k, f]) => [k, [f.v ?? "", f.from ?? "", f.to ?? "", f.min ?? "", f.max ?? ""].join("~")] as const)
    .filter(([, v]) => v.replace(/~/g, "") !== "" && v !== "all~~~~")
    .sort(([a], [b]) => a.localeCompare(b));
  return JSON.stringify({
    q: (s.search ?? "").trim().toLowerCase(), f: filters, s: s.sort ? `${s.sort.key}:${s.sort.dir}` : "",
    h: [...(s.hidden ?? [])].sort(), l: s.layout ?? "", d: s.dense ?? "", p: s.pageSize ?? 0,
    g: Object.entries(s.page ?? {}).sort(([x], [y]) => x.localeCompare(y)),
  });
}
