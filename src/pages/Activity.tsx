import { useEffect, useMemo, useState } from "react";
import type { DocumentData, QueryDocumentSnapshot } from "firebase/firestore";
import { fetchActivity, undoCheck, undoEntry } from "@/lib/activity";
import { fieldLabel, type ActivityEntry, type LoggedChange } from "@/lib/activityFormat";
import { MODULES, moduleLabel } from "@/lib/modules";
import { useDbVersion } from "@/hooks/useDb";
import { Button } from "@/components/ui/button";
import { DataTable, CellMain, CellTag, type DataColumn } from "@/components/DataTable";
import { PageHeader } from "@/components/PageHeader";
import type { TableFilter } from "@/components/TableToolbar";
import {
  RefreshCw, Undo2, Download, Printer, LogIn, Pencil, Plus, Trash2, Lock, Loader2,
} from "lucide-react";
import { toast } from "sonner";
import { confirmBox } from "@/lib/confirm";

/**
 * Everything anybody did, newest first. ADMIN ONLY (the route gates it).
 *
 * Each entry is written by the save itself, at the moment the data reached the
 * server, so nothing a person changes can be left out — and the log can be
 * added to, but never edited or deleted, by anyone.
 */

const KIND_LABEL: Record<string, string> = {
  change: "Changes", export: "Downloads", print: "Prints", signin: "Sign-ins", undo: "Undos",
};
const ROLE_LABEL: Record<string, string> = { owner: "Owner", admin: "Admin", employee: "Employee", client: "Client" };

/** A value as it can be shown in a line: short, and never a wall of JSON. */
function show(v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  if (Array.isArray(v)) return `${v.length} item${v.length !== 1 ? "s" : ""}`;
  if (typeof v === "object") {
    const t = JSON.stringify(v);
    return t.length > 70 ? t.slice(0, 67) + "…" : t;
  }
  const t = String(v);
  return t.length > 70 ? t.slice(0, 67) + "…" : t;
}

function KindIcon({ e }: { e: ActivityEntry }) {
  const cls = "h-4 w-4";
  if (e.kind === "export") return <Download className={`${cls} text-blue-600`} />;
  if (e.kind === "print") return <Printer className={`${cls} text-blue-600`} />;
  if (e.kind === "signin") return <LogIn className={`${cls} text-muted-foreground`} />;
  if (e.kind === "undo") return <Undo2 className={`${cls} text-amber-600`} />;
  const op = e.changes?.[0]?.op;
  if (e.summary.startsWith("Added")) return <Plus className={`${cls} text-success`} />;
  if (e.summary.startsWith("Deleted") || op === "delete") return <Trash2 className={`${cls} text-destructive`} />;
  return <Pencil className={`${cls} text-primary`} />;
}

function ChangeDetail({ c }: { c: LoggedChange }) {
  const opLabel = c.op === "add" ? "Added" : c.op === "delete" ? "Deleted" : "Edited";
  const tone = c.op === "add" ? "text-success" : c.op === "delete" ? "text-destructive" : "text-primary";
  return (
    <div className="rounded-lg border border-border/60 bg-white p-2.5 text-xs">
      <p><span className={`font-semibold ${tone}`}>{opLabel}</span> <span className="font-medium text-brand-dark">{c.label}</span>
        <span className="text-muted-foreground"> · {c.col === "meta" ? "settings" : c.col}</span></p>
      {c.op === "edit" && c.fields && c.before && c.after && (
        <table className="mt-1.5 w-full">
          <tbody>
            {c.fields.map(f => (
              <tr key={f} className="align-top">
                <td className="pr-3 py-0.5 text-muted-foreground whitespace-nowrap">{fieldLabel(f)}</td>
                <td className="pr-2 py-0.5 text-destructive/80 line-through break-all">{show(c.before![f])}</td>
                <td className="py-0.5 text-success break-all">{show(c.after![f])}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {c.op === "edit" && c.fields && !c.before && (
        <p className="text-muted-foreground mt-1">Changed: {c.fields.map(fieldLabel).join(", ")}</p>
      )}
    </div>
  );
}

export function ActivityPage() {
  useDbVersion(); // undo checks read the live data
  const [entries, setEntries] = useState<ActivityEntry[]>([]);
  const [cursor, setCursor] = useState<QueryDocumentSnapshot<DocumentData> | null>(null);
  const [loading, setLoading] = useState(true);
  const [refused, setRefused] = useState(false);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [who, setWho] = useState("all");
  const [mod, setMod] = useState("all");
  const [kind, setKind] = useState("all");
  const [q, setQ] = useState("");
  const [blocked, setBlocked] = useState<Record<string, { reason: string; moved?: string[] }>>({});

  const range = () => ({
    from: from ? new Date(from + "T00:00:00").toISOString() : undefined,
    to: to ? new Date(to + "T23:59:59.999").toISOString() : undefined,
  });

  const load = async (more = false) => {
    setLoading(true);
    try {
      const r = await fetchActivity({ ...range(), cursor: more ? cursor : null });
      setEntries(prev => (more ? [...prev, ...r.entries] : r.entries));
      setCursor(r.cursor);
      setRefused(false);
    } catch (e) {
      if ((e as { code?: string })?.code === "permission-denied") setRefused(true);
      else toast.error("Could not load the activity log");
    } finally {
      setLoading(false);
    }
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void load(false); }, [from, to]);

  const people = useMemo(() => {
    const m = new Map<string, string>();
    for (const e of entries) m.set(e.actorId, `${e.actorName} · ${ROLE_LABEL[e.actorRole] ?? e.actorRole}`);
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [entries]);

  const shown = entries.filter(e =>
    (who === "all" || e.actorId === who)
    && (mod === "all" || e.module === mod)
    && (kind === "all" || e.kind === kind)
    && (!q.trim() || `${e.summary} ${e.actorName}`.toLowerCase().includes(q.trim().toLowerCase())));

  const tryUndo = async (e: ActivityEntry) => {
    const check = undoCheck(e);
    if (!check.ok) {
      // Shown under the entry's summary, so the reason is in view at once.
      setBlocked(prev => ({ ...prev, [e.id]: check }));
      return;
    }
    if (!(await confirmBox(`Undo this?\n\n${e.summary}\n\nEvery record it changed goes back exactly as it was before. The undo is recorded too.`))) return;
    try {
      await undoEntry(e);
      toast.success("Undone");
      await load(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not undo");
    }
  };

  // What narrows the log, behind the table's one Filters button. "All" is the
  // page's own "all", so each filter reads exactly as it did. The dates also
  // decide what is fetched, as they always have.
  const filters: TableFilter[] = [
    { kind: "date", from, to, onChange: (f, t) => { setFrom(f); setTo(t); } },
    { kind: "select", label: "Person", value: who === "all" ? "" : who, onChange: v => setWho(v || "all"),
      options: people.map(([id, name]) => ({ value: id, label: name })), allLabel: "Everyone" },
    { kind: "select", label: "Section", value: mod === "all" ? "" : mod, onChange: v => setMod(v || "all"),
      options: MODULES.map(m => ({ value: m.key, label: m.label })), allLabel: "All sections" },
    { kind: "select", label: "Kind", value: kind === "all" ? "" : kind, onChange: v => setKind(v || "all"),
      options: Object.entries(KIND_LABEL).map(([k, l]) => ({ value: k, label: l })), allLabel: "Every kind" },
  ];
  const clearFilters = () => { setFrom(""); setTo(""); setWho("all"); setMod("all"); setKind("all"); };

  // The date and the time, each kept whole: where a phone has no room, the
  // time goes under the date instead of being cut off.
  const fmtAt = (iso: string) => {
    const d = new Date(iso);
    return (
      <span className="text-muted-foreground tabular-nums">
        <span className="whitespace-nowrap">{d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })},</span>{" "}
        <span className="whitespace-nowrap">{d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}</span>
      </span>
    );
  };
  const cantUndoNote = (e: ActivityEntry) => !e.undoable && !!e.undoBlocker && e.kind === "change";
  // Only rows with something to show open; the rest have no chevron.
  const hasDetail = (e: ActivityEntry) => !!(e.changes?.length || e.meta || e.truncated || cantUndoNote(e));
  // A summary is the whole story of a line, so it wraps rather than being cut off —
  // narrower on a phone, where this column stays in view.
  const wrap = "block whitespace-normal max-md:max-w-[14rem]";
  const columns: DataColumn<ActivityEntry>[] = [
    { key: "what", header: "What", always: true, sortValue: e => e.summary,
      cell: e => {
        const b = blocked[e.id];
        return (
          <div className="flex items-start gap-2.5">
            <div className="mt-0.5 shrink-0"><KindIcon e={e} /></div>
            <div className="min-w-0">
              <CellMain
                title={<span className={`${wrap} ${e.undoneAt ? "line-through text-muted-foreground" : ""}`}>{e.summary}</span>}
                sub={e.undoneAt ? <span className="text-amber-700">Undone by {e.undoneByName}</span> : undefined} />
              {b && (
                <div className={`${wrap} max-w-[22rem] mt-1.5 rounded-lg border border-destructive/30 bg-destructive/5 p-2.5 text-xs`}>
                  <p className="font-semibold text-destructive">{b.reason}</p>
                  {b.moved?.map(m => <p key={m} className="text-muted-foreground">• {m}</p>)}
                </div>
              )}
            </div>
          </div>
        );
      } },
    { key: "who", header: "Who", sortValue: e => e.actorName,
      cell: e => <CellMain title={e.actorName} sub={ROLE_LABEL[e.actorRole] ?? e.actorRole} /> },
    { key: "section", header: "Section", sortValue: e => moduleLabel(e.module), cell: e => <CellTag>{moduleLabel(e.module)}</CellTag> },
    { key: "when", header: "When", kind: "date", sortValue: e => e.at, cell: e => fmtAt(e.at) },
  ];

  return (
    <div className="max-w-6xl mx-auto space-y-4">
      {/* Refresh turns while the log loads, so it is drawn here rather than
          handed to the header as a plain button. On a phone it is just its
          icon, beside the title. */}
      <PageHeader
        title="Activity"
        subtitle={<><Lock className="h-3 w-3 inline -mt-0.5 mr-1" />A permanent record of everyone's work</>}
        info="Every change, download, print and sign-in, by anyone. Nothing here can be edited or deleted; an undo is recorded too."
        actions={
          <Button variant="outline" onClick={() => load(false)} disabled={loading} aria-label="Refresh" title="Refresh" className="h-10 rounded-xl px-3.5 gap-2 max-sm:w-10 max-sm:px-0">
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /><span className="max-sm:hidden">Refresh</span>
          </Button>
        }
      />

      {refused ? (
        <div className="card-luxe p-6 text-sm">
          <p className="font-semibold text-brand-dark mb-1">The activity log is not switched on yet</p>
          <p className="text-muted-foreground">It starts once the security update is deployed (<code className="text-xs">firebase deploy --only firestore</code>).</p>
        </div>
      ) : (
        <>
          {/* ── The log ── */}
          {/* The page narrows the rows itself; its search and filters sit in the
              table's toolbar. Keyed on them so a new view starts on page 1. A
              click on a row opens what it changed. */}
          <div className="card-luxe p-3 sm:p-4 space-y-2">
            <DataTable
              search={{ value: q, onChange: setQ, placeholder: "Search — client, order, person…" }}
              filters={filters}
              onClearFilters={clearFilters}
              resetKey={`${who}|${mod}|${kind}|${q}|${from}|${to}`}
              id="activity"
              noun="event"
              rows={shown}
              columns={columns}
              rowKey={e => e.id}
              defaultSort={{ key: "when", dir: "desc" }}
              rowClassName={e => (e.undoneAt ? "bg-secondary/30" : "")}
              expand={{
                can: hasDetail,
                render: e => (
                  <div className="space-y-2">
                    {cantUndoNote(e) && (
                      <p className="text-[11px] text-muted-foreground">Can&rsquo;t be undone automatically: {e.undoBlocker}</p>
                    )}
                    {e.truncated && <p className="text-[11px] text-amber-700">A very large change — only the list of what changed is kept.</p>}
                    {e.changes?.map(c => <ChangeDetail key={`${c.col}/${c.id}`} c={c} />)}
                    {e.meta && !e.changes?.length && (
                      <p className="text-xs text-muted-foreground">{Object.entries(e.meta).map(([k, v]) => `${fieldLabel(k)}: ${show(v)}`).join(" · ")}</p>
                    )}
                  </div>
                ),
              }}
              rowActions={e => {
                // Undo is always listed; when it can't be done, greyed with the
                // reason (the live check, so "changed since" shows before a click).
                const check = e.kind === "change" ? undoCheck(e) : null;
                const why = e.kind === "undo" ? "An undo can't be undone"
                  : e.kind !== "change" ? "Nothing was changed"
                  : check && !check.ok ? [check.reason, ...(check.moved ?? []).slice(0, 2)].join(" · ") : undefined;
                return [
                  { label: "Undo", icon: Undo2, hint: why ?? "Puts every record back as it was", disabled: !!why, onSelect: () => tryUndo(e) },
                  // The log is the record of what happened — never rewritten.
                  { label: "Edit", icon: Pencil, hint: "The log is permanent", disabled: true, onSelect: () => undefined },
                  { label: "Delete", icon: Trash2, danger: true, hint: "The log is permanent", disabled: true, onSelect: () => undefined },
                ];
              }}
              loading={loading}
              emptyText="Nothing recorded for these filters."
            />
            {loading && shown.length > 0 && <div className="p-4 grid place-items-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>}
          </div>

          {cursor && !loading && (
            <div className="text-center">
              <Button variant="outline" onClick={() => load(true)} className="rounded-xl">Load older</Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
