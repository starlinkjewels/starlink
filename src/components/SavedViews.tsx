// The Views button in a table's toolbar: open a saved view, save what is shown,
// star one to open the page with, share one with the team (admins), and go back
// to the plain list. The views themselves: lib/savedViews.ts.
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useLocation } from "react-router-dom";
import { toast } from "sonner";
import { Bookmark, BookmarkCheck, Check, RefreshCw, Star, Trash2, Users, RotateCcw, Plus, MoreHorizontal, Pencil } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useAuth } from "@/lib/auth";
import { useEntryState } from "@/hooks/useBackNav";
import { confirmBox } from "@/lib/confirm";
import {
  deleteView, newViewId, saveView, setDefaultView, useTableViews, viewKey, watchViews,
  type SavedView, type ViewState,
} from "@/lib/savedViews";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { TableFilter } from "@/components/TableToolbar";
import { Input } from "@/components/ui/input";

const BTN = "h-9 px-3 inline-flex items-center gap-2 rounded-xl border border-border bg-white text-[13px] font-medium text-brand-dark hover:bg-secondary/70 transition-colors shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30";
const ICON_BTN = "h-7 w-7 grid place-items-center rounded-lg text-muted-foreground hover:bg-secondary hover:text-foreground disabled:opacity-40 disabled:hover:bg-transparent";

/* ── What a view holds, from a table's filters and search ────────────────── */

/** Each filter's name on its table ("select:Status"); a second of the same name by its place. */
export function filterKeysOf(filters: TableFilter[] | undefined): string[] {
  return (filters ?? []).map((f, i, all) => {
    const base = `${f.kind}:${f.label ?? "Date"}`;
    const n = all.slice(0, i).filter(g => `${g.kind}:${g.label ?? "Date"}` === base).length;
    return n ? `${base}#${n}` : base;
  });
}
export function captureFilters(filters: TableFilter[] | undefined, search: string): Pick<ViewState, "search" | "filters"> {
  const keys = filterKeysOf(filters);
  return {
    ...(search.trim() ? { search } : {}),
    filters: Object.fromEntries((filters ?? []).map((f, i) => [keys[i],
      f.kind === "date" ? { from: f.from, to: f.to } : f.kind === "range" ? { min: f.min, max: f.max } : { v: f.value }])),
  };
}
/** Every filter as the view has it — one it doesn't name is cleared, so it shows exactly that. */
export function applyFilters(filters: TableFilter[] | undefined, v: ViewState, search: string, setSearch: (q: string) => void): void {
  const keys = filterKeysOf(filters);
  (filters ?? []).forEach((f, i) => {
    const s = v.filters?.[keys[i]];
    if (f.kind === "date") { if ((s?.from ?? "") !== f.from || (s?.to ?? "") !== f.to) f.onChange(s?.from ?? "", s?.to ?? ""); }
    else if (f.kind === "range") { if ((s?.min ?? "") !== f.min || (s?.max ?? "") !== f.max) f.onChange(s?.min ?? "", s?.max ?? ""); }
    else if ((s?.v ?? "") !== f.value) f.onChange(s?.v ?? "");
  });
  if ((v.search ?? "") !== search) setSearch(v.search ?? "");
}

/** The page's own part of a view — how it shows the list (list, grid, board…). */
export interface PageExtra { get: () => Record<string, string>; set: (v: Record<string, string>) => void }

/* The table's remembered choices (components/DataTable.tsx keeps them at "dt:<id>"),
   for when the page shows a grid and the table isn't on screen. */
type StoredPrefs = { sort?: ViewState["sort"]; hidden?: string[]; seen?: string[]; forced?: string[]; dense?: ViewState["dense"]; pageSize?: number; layout?: ViewState["layout"];
  widths?: Record<string, number>; order?: string[]; group?: string | null };
const readPrefs = (id: string): StoredPrefs => { try { return JSON.parse(localStorage.getItem(`dt:${id}`) || "{}"); } catch { return {}; } };
const writePrefs = (id: string, p: StoredPrefs) => { try { localStorage.setItem(`dt:${id}`, JSON.stringify(p)); } catch { /* private window */ } };
/** A view's columns, sort and layout — from the table's remembered choices. */
export function prefsPart(p: StoredPrefs): Partial<ViewState> {
  return {
    ...(p.sort !== undefined ? { sort: p.sort } : {}),
    ...(p.hidden ? { hidden: p.hidden, ...(p.seen ? { seen: p.seen } : {}) } : {}),
    ...(p.forced?.length ? { forced: p.forced } : {}),
    ...(p.dense ? { dense: p.dense } : {}),
    ...(p.pageSize ? { pageSize: p.pageSize } : {}),
    ...(p.layout ? { layout: p.layout } : {}),
    ...(p.widths && Object.keys(p.widths).length ? { widths: p.widths } : {}),
    ...(p.order?.length ? { order: p.order } : {}),
    ...(p.group ? { group: p.group } : {}),
  };
}
/** The table's remembered choices as a view sets them (its rows a page kept unless the view says). */
export function prefsFromView(v: ViewState, was: StoredPrefs): StoredPrefs {
  const pageSize = v.pageSize ?? was.pageSize;
  return {
    ...(v.sort !== undefined ? { sort: v.sort } : {}),
    ...(v.hidden ? { hidden: v.hidden, ...(v.seen ? { seen: v.seen } : {}) } : {}),
    ...(v.forced ? { forced: v.forced } : {}),
    ...(v.dense ? { dense: v.dense } : {}),
    ...(pageSize ? { pageSize } : {}),
    ...(v.layout ? { layout: v.layout } : {}),
    ...(v.widths ? { widths: v.widths } : {}),
    ...(v.order ? { order: v.order } : {}),
    ...(v.group ? { group: v.group } : {}),
  };
}

/**
 * Views on a page's own toolbar — a grid or a board, where the table isn't on
 * screen. The same views as the table's (`table` is its id): the filters and
 * search apply at once, the columns are kept for when the list is shown.
 */
export function PageViewsButton({ table, filters, search, extra }: {
  table: string; filters?: TableFilter[]; search: { value: string; onChange: (q: string) => void }; extra?: PageExtra;
}) {
  const on = useViewsOn();
  const capture = (): ViewState => ({ ...captureFilters(filters, search.value), ...prefsPart(readPrefs(table)), ...(extra ? { page: extra.get() } : {}) });
  const apply = (v: ViewState) => {
    writePrefs(table, prefsFromView(v, readPrefs(table)));
    applyFilters(filters, v, search.value, search.onChange);
    if (extra && v.page) extra.set(v.page);
  };
  useDefaultView(table, on, apply, capture);
  if (!on) return null;
  return <SavedViewsButton table={table} capture={capture} apply={apply} reset={() => apply({ ...(extra ? { page: extra.get() } : {}) })} />;
}

/** Staff only — a client has no saved views. */
export function useViewsOn(): boolean {
  const { user } = useAuth();
  const on = !!user && (user.role === "admin" || user.role === "employee");
  useEffect(() => { watchViews(on ? user!.id : null); }, [on, user]);
  return on;
}

/** What is shown, cut to what a view keeps: its search and filters always, the rest only where it has them. */
function sameShape(cur: ViewState, ref: ViewState): ViewState {
  const out: ViewState = { search: cur.search, filters: cur.filters };
  for (const k of ["sort", "hidden", "seen", "forced", "dense", "pageSize", "layout", "widths", "order", "group", "page"] as const) {
    if (ref[k] !== undefined) (out as Record<string, unknown>)[k] = cur[k];
  }
  return out;
}

/* ── Which view a list is showing (by id) — kept for this browser tab, so Back keeps it ── */
const ACTIVE = "views-active:";
const activeListeners = new Set<() => void>();
const readActive = (table: string): string | null => { try { return sessionStorage.getItem(ACTIVE + table); } catch { return null; } };
function setActive(table: string, id: string | null): void {
  try { if (id) sessionStorage.setItem(ACTIVE + table, id); else sessionStorage.removeItem(ACTIVE + table); } catch { /* private window */ }
  activeListeners.forEach(l => l());
}
function useActive(table: string): string | null {
  return useSyncExternalStore(l => { activeListeners.add(l); return () => { activeListeners.delete(l); }; }, () => readActive(table), () => null);
}

/**
 * Open the list with the view this person starred — whenever the page is opened afresh (from the
 * menu, a link with nothing of its own), once its views have come: never on Back (the list is as it
 * was left), never from a link that already says what to show, and never over something the person
 * has already changed since the page opened (however slow the views were to come).
 */
export function useDefaultView(table: string, on: boolean, apply: (s: ViewState) => void, capture?: () => ViewState): void {
  const views = useTableViews(table);
  const loc = useLocation();
  const [done, setDone] = useEntryState(`dt:${table}:view-start`, false);
  const applyRef = useRef(apply);
  applyRef.current = apply;
  const captureRef = useRef(capture);
  captureRef.current = capture;
  // What the person had searched and filtered as the page opened — a change since then is theirs, and
  // wins. Only those: the table settles its own columns as it loads, which is no one's change.
  const typed = (s: ViewState) => viewKey({ search: s.search, filters: s.filters });
  const startKey = useRef<string | null>(null);
  if (startKey.current === null && capture) startKey.current = typed(capture());
  useEffect(() => {
    if (!on || done || !views.ready) return;
    setDone(true);
    if (views.denied || !views.defaultId) return;
    if (loc.search || (loc.state && Object.keys(loc.state as object).length)) return;
    if (captureRef.current && startKey.current !== null && typed(captureRef.current()) !== startKey.current) return;
    const v = [...views.mine, ...views.team].find(x => x.id === views.defaultId);
    if (v) { applyRef.current(v.state); setActive(table, v.id); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [on, done, views.ready, views.defaultId]);
}

/**
 * The Views button: a view keeps a list's search, filters, sort and columns under a name, to bring
 * them back in one click. The button names the view shown — "· edited" once something is changed,
 * with Save changes, Save as new view and Discard; each view's ⋯ says in words what it does.
 */
export function SavedViewsButton({ table, capture, apply, reset }: {
  table: string;
  /** What the table shows now. */
  capture: () => ViewState;
  apply: (s: ViewState) => void;
  /** The plain list: nothing narrowed, the table's own columns and sort. */
  reset: () => void;
}) {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const views = useTableViews(table);
  const activeId = useActive(table);
  const [open, setOpen] = useState(false);
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState("");
  const [share, setShare] = useState(false);
  const [star, setStar] = useState(false);
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const cur = capture();
  const all = [...views.mine, ...views.team];
  // Does what is shown match a view? Its search and filters always; the rest (sort, columns, rows…)
  // only what the view itself keeps — a setting it doesn't keep is no change to it.
  const same = (v: SavedView) => viewKey(v.state) === viewKey(sameShape(cur, v.state));
  // The view shown: the one last opened here — else (opened some other way) one that matches.
  const active = all.find(v => v.id === activeId) ?? all.find(same);
  const edited = !!active && !same(active);
  const mayChange = (v: SavedView) => isAdmin || (!v.shared && v.ownerId === user?.id);

  const run = async (what: () => Promise<void>, ok?: string) => {
    setBusy(true);
    try { await what(); if (ok) toast.success(ok); }
    catch (e) {
      const code = (e as { code?: string })?.code;
      toast.error(code === "permission-denied" ? "Saved views aren't switched on yet — the database rules for them still need to be deployed" : "Couldn't save the view — try again");
    } finally { setBusy(false); }
  };
  const pick = (v: SavedView) => { apply(v.state); setActive(table, v.id); setOpen(false); toast.success(`Showing “${v.name}”`); };
  const plainList = () => { reset(); setActive(table, null); setOpen(false); };
  const saveNew = () => {
    const n = name.trim();
    if (!n) { toast.error("Give the view a name"); return; }
    if (all.some(v => v.name.toLowerCase() === n.toLowerCase() && (v.shared === (isAdmin && share)) && mayChange(v))) { toast.error(`There is a view called “${n}” already — open it and use Save changes, or pick another name`); return; }
    const at = new Date().toISOString();
    const v: SavedView = { id: newViewId(), table, name: n.slice(0, 80), ownerId: user!.id, ...(user?.name ? { ownerName: user.name } : {}), shared: isAdmin && share, state: capture(), createdAt: at, updatedAt: at };
    void run(async () => {
      await saveView(v);
      if (star) await setDefaultView(user!.id, table, v.id);
      setActive(table, v.id);
      setNaming(false); setName(""); setShare(false); setStar(false); setOpen(false);
    }, `Saved “${v.name}”${v.shared ? " for the team" : ""} — open it again from Views`);
  };
  const update = (v: SavedView) => void run(async () => { await saveView({ ...v, state: capture(), updatedAt: new Date().toISOString() }); setActive(table, v.id); }, `“${v.name}” saved with what is shown now`);
  const rename = () => {
    if (!renaming) return;
    const v = all.find(x => x.id === renaming.id); const n = renaming.name.trim();
    if (!v || !n) { toast.error("Give the view a name"); return; }
    void run(async () => { await saveView({ ...v, name: n.slice(0, 80), updatedAt: new Date().toISOString() }); setRenaming(null); }, `Renamed “${n}”`);
  };
  const remove = async (v: SavedView) => {
    if (!(await confirmBox([`Delete the view “${v.name}”?`, "", v.shared ? "• it goes for everyone on the team" : "• only the view goes — nothing in the list changes"], { danger: true, confirmText: "Delete view" }))) return;
    void run(async () => { await deleteView(v, user!.id); if (activeId === v.id) setActive(table, null); }, "View deleted");
  };
  const toggleStar = (v: SavedView) => {
    const on = views.defaultId === v.id;
    void run(() => setDefaultView(user!.id, table, on ? null : v.id), on ? "The list opens plain again" : `The list opens with “${v.name}” from now on`);
  };

  const row = (v: SavedView) => {
    const isActive = active?.id === v.id;
    if (renaming?.id === v.id) return (
      <div key={v.id} className="flex items-center gap-1.5 px-1 py-1">
        <Input autoFocus value={renaming.name} onChange={e => setRenaming({ ...renaming, name: e.target.value })} onKeyDown={e => { if (e.key === "Enter") rename(); if (e.key === "Escape") setRenaming(null); }}
          className="h-8 rounded-lg text-sm" aria-label="New name" maxLength={80} />
        <button type="button" onClick={rename} disabled={busy} className="h-8 px-2.5 rounded-lg bg-primary text-primary-foreground text-xs font-semibold">Save</button>
      </div>
    );
    return (
      <div key={v.id} className={`flex items-center gap-1 rounded-lg pl-2 pr-1 ${isActive ? "bg-primary/[0.07]" : "hover:bg-secondary/60"}`}>
        <button type="button" onClick={() => pick(v)} className="flex-1 min-w-0 text-left py-2" title={v.shared && v.ownerName ? `Shared by ${v.ownerName}` : `Open “${v.name}”`}>
          <span className="flex items-center gap-1.5 text-sm text-foreground">
            {isActive ? <Check className="h-3.5 w-3.5 text-primary shrink-0" /> : <span className="w-3.5 shrink-0" />}
            <span className="truncate">{v.name}</span>
            {views.defaultId === v.id && <Star className="h-3 w-3 shrink-0 fill-amber-400 text-amber-500" aria-label="Opens with this" />}
            {isActive && edited && <span className="text-[10px] font-medium text-amber-700 shrink-0">edited</span>}
          </span>
        </button>
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger asChild>
            <button type="button" className={ICON_BTN} aria-label={`More for ${v.name}`} title="More"><MoreHorizontal className="h-4 w-4" /></button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-60 rounded-xl p-1.5">
            <DropdownMenuItem className="rounded-lg gap-2 cursor-pointer" onSelect={() => toggleStar(v)}>
              <Star className={`h-4 w-4 ${views.defaultId === v.id ? "fill-amber-400 text-amber-500" : "text-muted-foreground"}`} />
              {views.defaultId === v.id ? "Stop opening the list with it" : "Open the list with it"}
            </DropdownMenuItem>
            {mayChange(v) && <>
              <DropdownMenuItem className="rounded-lg gap-2 cursor-pointer" disabled={busy || same(v)} onSelect={() => update(v)}>
                <RefreshCw className="h-4 w-4 text-muted-foreground" />Update to what is shown
              </DropdownMenuItem>
              <DropdownMenuItem className="rounded-lg gap-2 cursor-pointer" onSelect={() => setTimeout(() => setRenaming({ id: v.id, name: v.name }), 0)}>
                <Pencil className="h-4 w-4 text-muted-foreground" />Rename
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem className="rounded-lg gap-2 cursor-pointer text-destructive focus:text-destructive" onSelect={() => void remove(v)}>
                <Trash2 className="h-4 w-4" />Delete
              </DropdownMenuItem>
            </>}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    );
  };

  return (
    <Popover open={open} onOpenChange={o => { setOpen(o); if (!o) { setNaming(false); setRenaming(null); } }}>
      <PopoverTrigger asChild>
        <button type="button" className={BTN} aria-label="Saved views" title={active ? `Showing the view “${active.name}”${edited ? " — changed since" : ""}` : "Saved views — keep this list's filters under a name"}>
          {active ? <BookmarkCheck className="h-4 w-4 text-primary" /> : <Bookmark className="h-4 w-4" />}
          <span className="max-w-[7rem] sm:max-w-[10rem] truncate">{active ? active.name : "Views"}</span>
          {edited && <span className="text-[10px] font-semibold text-amber-700" aria-label="changed">· edited</span>}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[22rem] max-w-[calc(100vw-1.5rem)] p-2 rounded-xl"
        // A view's own ⋯ menu opens in its own layer — choosing in it is not a click away from Views.
        onInteractOutside={e => { if ((e.target as HTMLElement | null)?.closest?.('[role="menu"]')) e.preventDefault(); }}>
        {views.denied ? (
          <p className="text-xs text-muted-foreground p-2">Saved views aren't switched on yet — the database rules for them still need to be deployed.</p>
        ) : !views.ready ? (
          <p className="text-xs text-muted-foreground p-2">Loading…</p>
        ) : (
          <div className="space-y-2">
            <p className="px-2 pt-1 text-[11px] leading-snug text-muted-foreground">A view keeps this list's search, filters, sort and columns under a name — one click brings them back.</p>
            {edited && active && (
              <div className="rounded-lg border border-amber-300/70 bg-amber-50 p-2 space-y-1.5">
                <p className="text-xs text-amber-900">You changed “{active.name}”.</p>
                <div className="flex flex-wrap gap-1.5">
                  {mayChange(active) && <button type="button" disabled={busy} onClick={() => { update(active); setOpen(false); }} className="h-8 px-2.5 rounded-lg bg-primary text-primary-foreground text-xs font-semibold">Save changes</button>}
                  <button type="button" onClick={() => { setNaming(true); setName(""); }} className="h-8 px-2.5 rounded-lg border border-border bg-white text-xs font-medium hover:bg-secondary">Save as new view</button>
                  <button type="button" onClick={() => pick(active)} className="h-8 px-2.5 rounded-lg text-xs font-medium text-muted-foreground hover:bg-secondary">Discard changes</button>
                </div>
              </div>
            )}
            <button type="button" onClick={plainList} className={`w-full flex items-center gap-2 rounded-lg px-2 py-2 text-sm ${!active ? "bg-primary/[0.07]" : "hover:bg-secondary/60"}`}>
              <RotateCcw className="h-3.5 w-3.5 text-muted-foreground" /> Plain list <span className="text-xs text-muted-foreground ml-auto">nothing narrowed</span>
            </button>
            {views.mine.length > 0 && (
              <div>
                <p className="px-2 pt-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">My views</p>
                {views.mine.map(row)}
              </div>
            )}
            {views.team.length > 0 && (
              <div>
                <p className="px-2 pt-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1"><Users className="h-3 w-3" /> The team's</p>
                {views.team.map(row)}
              </div>
            )}
            {!all.length && !naming && <p className="px-2 text-xs text-muted-foreground">No views here yet. Search, filter, sort or pick columns the way you want this list, then save it below — e.g. “Unpaid this month”.</p>}
            <div className="border-t border-border/60 pt-2">
              {naming ? (
                <div className="space-y-2 px-1">
                  <Input autoFocus value={name} onChange={e => setName(e.target.value)} onKeyDown={e => { if (e.key === "Enter") saveNew(); }} placeholder="Name it — e.g. Urgent this month" className="h-9 rounded-lg" aria-label="View name" maxLength={80} />
                  <label className="flex items-center gap-2 text-xs cursor-pointer"><input type="checkbox" checked={star} onChange={e => setStar(e.target.checked)} className="h-3.5 w-3.5 accent-[var(--primary)]" /> Open this list with it every time</label>
                  {isAdmin && <label className="flex items-center gap-2 text-xs cursor-pointer"><input type="checkbox" checked={share} onChange={e => setShare(e.target.checked)} className="h-3.5 w-3.5 accent-[var(--primary)]" /> Share with the team</label>}
                  <div className="flex gap-2">
                    <button type="button" onClick={() => setNaming(false)} className="flex-1 h-8 rounded-lg border border-border text-xs font-medium hover:bg-secondary">Cancel</button>
                    <button type="button" onClick={saveNew} disabled={busy} className="flex-1 h-8 rounded-lg bg-primary text-primary-foreground text-xs font-semibold disabled:opacity-60">Save view</button>
                  </div>
                </div>
              ) : (
                <button type="button" onClick={() => setNaming(true)}
                  className="w-full flex items-center gap-2 rounded-lg px-2 py-2 text-sm font-medium text-primary hover:bg-primary/[0.06]">
                  <Plus className="h-3.5 w-3.5" /> Save what is shown as a new view
                </button>
              )}
            </div>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
