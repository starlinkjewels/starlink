// The Views button in a table's toolbar: open a saved view, save what is shown,
// star one to open the page with, share one with the team (admins), and go back
// to the plain list. The views themselves: lib/savedViews.ts.
import { useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { toast } from "sonner";
import { Bookmark, BookmarkCheck, Check, RefreshCw, Star, Trash2, Users, RotateCcw, Plus } from "lucide-react";
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
  useDefaultView(table, on, apply);
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

/**
 * Open the table with the view this person starred — once, when the page is
 * opened afresh: never on Back (the table is as it was left), never from a link
 * that already says what to show, and only while it can still be the first
 * thing seen (not seconds later, over what someone has started doing).
 */
export function useDefaultView(table: string, on: boolean, apply: (s: ViewState) => void): void {
  const views = useTableViews(table);
  const loc = useLocation();
  const [done, setDone] = useEntryState(`dt:${table}:view-start`, false);
  const mountedAt = useRef(Date.now());
  const applyRef = useRef(apply);
  applyRef.current = apply;
  useEffect(() => {
    if (!on || done || !views.ready) return;
    setDone(true);
    if (views.denied || !views.defaultId) return;
    if (loc.search || (loc.state && Object.keys(loc.state as object).length)) return;
    if (Date.now() - mountedAt.current > 6000) return;
    const v = [...views.mine, ...views.team].find(x => x.id === views.defaultId);
    if (v) applyRef.current(v.state);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [on, done, views.ready, views.defaultId]);
}

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
  const [open, setOpen] = useState(false);
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState("");
  const [share, setShare] = useState(false);
  const [star, setStar] = useState(false);
  const [busy, setBusy] = useState(false);
  const now = viewKey(capture());
  const all = [...views.mine, ...views.team];
  const current = all.find(v => viewKey(v.state) === now);
  const mayChange = (v: SavedView) => isAdmin || (!v.shared && v.ownerId === user?.id);

  const run = async (what: () => Promise<void>, ok?: string) => {
    setBusy(true);
    try { await what(); if (ok) toast.success(ok); }
    catch (e) {
      const code = (e as { code?: string })?.code;
      toast.error(code === "permission-denied" ? "Saved views aren't switched on yet — the database rules for them still need to be deployed" : "Couldn't save the view — try again");
    } finally { setBusy(false); }
  };
  const pick = (v: SavedView) => { apply(v.state); setOpen(false); toast.success(`Showing “${v.name}”`); };
  const saveNew = () => {
    const n = name.trim();
    if (!n) { toast.error("Name the view"); return; }
    if (all.some(v => v.name.toLowerCase() === n.toLowerCase() && (v.shared === (isAdmin && share)) && mayChange(v))) { toast.error(`There is a view called ${n} already — pick it and Update it instead`); return; }
    const at = new Date().toISOString();
    const v: SavedView = { id: newViewId(), table, name: n.slice(0, 80), ownerId: user!.id, ...(user?.name ? { ownerName: user.name } : {}), shared: isAdmin && share, state: capture(), createdAt: at, updatedAt: at };
    void run(async () => {
      await saveView(v);
      if (star) await setDefaultView(user!.id, table, v.id);
      setNaming(false); setName(""); setShare(false); setStar(false); setOpen(false);
    }, `Saved “${v.name}”${v.shared ? " for the team" : ""}`);
  };
  const update = (v: SavedView) => void run(() => saveView({ ...v, state: capture(), updatedAt: new Date().toISOString() }), `“${v.name}” now shows this`);
  const remove = async (v: SavedView) => {
    if (!(await confirmBox([`Delete the view “${v.name}”?`, "", v.shared ? "• it goes for everyone on the team" : "• only the view goes — nothing in the list changes"], { danger: true, confirmText: "Delete view" }))) return;
    void run(() => deleteView(v, user!.id), "View deleted");
  };
  const toggleStar = (v: SavedView) => {
    const on = views.defaultId === v.id;
    void run(() => setDefaultView(user!.id, table, on ? null : v.id), on ? "The page opens as a plain list again" : `The page opens with “${v.name}”`);
  };

  const row = (v: SavedView) => (
    <div key={v.id} className={`group flex items-center gap-1 rounded-lg pl-2 pr-1 ${current?.id === v.id ? "bg-primary/[0.07]" : "hover:bg-secondary/60"}`}>
      <button type="button" onClick={() => pick(v)} className="flex-1 min-w-0 text-left py-1.5" title={v.shared && v.ownerName ? `Shared by ${v.ownerName}` : undefined}>
        <span className="flex items-center gap-1.5 text-sm text-foreground truncate">
          {current?.id === v.id ? <Check className="h-3.5 w-3.5 text-primary shrink-0" /> : <span className="w-3.5 shrink-0" />}
          <span className="truncate">{v.name}</span>
        </span>
      </button>
      <button type="button" className={ICON_BTN} disabled={busy} onClick={() => toggleStar(v)} aria-label={views.defaultId === v.id ? `Stop opening with ${v.name}` : `Open the page with ${v.name}`}
        title={views.defaultId === v.id ? "The page opens with this — click to stop" : "Open the page with this view"}>
        <Star className={`h-3.5 w-3.5 ${views.defaultId === v.id ? "fill-amber-400 text-amber-500" : ""}`} />
      </button>
      {mayChange(v) && <>
        <button type="button" className={ICON_BTN} disabled={busy || current?.id === v.id} onClick={() => update(v)} aria-label={`Update ${v.name} with what is shown`} title="Update it to what is shown now"><RefreshCw className="h-3.5 w-3.5" /></button>
        <button type="button" className={ICON_BTN} disabled={busy} onClick={() => void remove(v)} aria-label={`Delete ${v.name}`} title="Delete the view"><Trash2 className="h-3.5 w-3.5" /></button>
      </>}
    </div>
  );

  return (
    <Popover open={open} onOpenChange={o => { setOpen(o); if (!o) setNaming(false); }}>
      <PopoverTrigger asChild>
        <button type="button" className={BTN} aria-label="Saved views" title={current ? `Showing the view “${current.name}”` : "Saved views"}>
          {current ? <BookmarkCheck className="h-4 w-4 text-primary" /> : <Bookmark className="h-4 w-4" />}
          <span className="max-sm:hidden max-w-[10rem] truncate">{current ? current.name : "Views"}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-2 rounded-xl">
        {views.denied ? (
          <p className="text-xs text-muted-foreground p-2">Saved views aren't switched on yet — the database rules for them still need to be deployed.</p>
        ) : !views.ready ? (
          <p className="text-xs text-muted-foreground p-2">Loading…</p>
        ) : (
          <div className="space-y-2">
            <button type="button" onClick={() => { reset(); setOpen(false); }} className="w-full flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-secondary/60">
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
            {!all.length && !naming && <p className="px-2 text-xs text-muted-foreground">No saved views here yet. Set the search, filters and columns, then save them under a name.</p>}
            <div className="border-t border-border/60 pt-2">
              {naming ? (
                <div className="space-y-2 px-1">
                  <Input autoFocus value={name} onChange={e => setName(e.target.value)} onKeyDown={e => { if (e.key === "Enter") saveNew(); }} placeholder="e.g. Urgent this month" className="h-9 rounded-lg" aria-label="View name" maxLength={80} />
                  <label className="flex items-center gap-2 text-xs cursor-pointer"><input type="checkbox" checked={star} onChange={e => setStar(e.target.checked)} className="h-3.5 w-3.5 accent-[var(--primary)]" /> Open the page with it</label>
                  {isAdmin && <label className="flex items-center gap-2 text-xs cursor-pointer"><input type="checkbox" checked={share} onChange={e => setShare(e.target.checked)} className="h-3.5 w-3.5 accent-[var(--primary)]" /> Share with the team</label>}
                  <div className="flex gap-2">
                    <button type="button" onClick={() => setNaming(false)} className="flex-1 h-8 rounded-lg border border-border text-xs font-medium hover:bg-secondary">Cancel</button>
                    <button type="button" onClick={saveNew} disabled={busy} className="flex-1 h-8 rounded-lg bg-primary text-primary-foreground text-xs font-semibold disabled:opacity-60">Save view</button>
                  </div>
                </div>
              ) : (
                <button type="button" onClick={() => setNaming(true)} disabled={!!current} title={current ? `This is “${current.name}” already` : undefined}
                  className="w-full flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm font-medium text-primary hover:bg-primary/[0.06] disabled:opacity-50 disabled:hover:bg-transparent">
                  <Plus className="h-3.5 w-3.5" /> Save what is shown as a view
                </button>
              )}
            </div>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

