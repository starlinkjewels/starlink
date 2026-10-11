import { useEffect, useMemo, useState } from "react";
import type { DocumentData, QueryDocumentSnapshot } from "firebase/firestore";
import { fetchActivity, undoCheck, undoEntry } from "@/lib/activity";
import { fieldLabel, type ActivityEntry, type LoggedChange } from "@/lib/activityFormat";
import { MODULES, moduleLabel } from "@/lib/modules";
import { useDbVersion } from "@/hooks/useDb";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  History, RefreshCw, Search, Undo2, ChevronDown, Download, Printer, LogIn, Pencil, Plus, Trash2, Lock, Loader2,
} from "lucide-react";
import { toast } from "sonner";

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
  const [open, setOpen] = useState<string | null>(null);
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
      setBlocked(prev => ({ ...prev, [e.id]: check }));
      setOpen(e.id);
      return;
    }
    if (!confirm(`Undo this?\n\n${e.summary}\n\nEvery record it changed goes back exactly as it was before. The undo is recorded too.`)) return;
    try {
      await undoEntry(e);
      toast.success("Undone");
      await load(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not undo");
    }
  };

  return (
    <div className="max-w-6xl mx-auto space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="h-11 w-11 rounded-2xl bg-primary/10 grid place-items-center"><History className="h-5 w-5 text-primary" /></div>
          <div>
            <h1 className="font-display text-2xl md:text-3xl text-brand-dark">Activity</h1>
            <p className="text-sm text-muted-foreground flex items-center gap-1">
              <Lock className="h-3 w-3" /> Every change, download, print and sign-in — by anyone. Nothing here can be edited or deleted.
            </p>
          </div>
        </div>
        <Button variant="outline" onClick={() => load(false)} disabled={loading} className="rounded-xl gap-2">
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Refresh
        </Button>
      </div>

      {refused ? (
        <div className="card-luxe p-6 text-sm">
          <p className="font-semibold text-brand-dark mb-1">The activity log is not switched on yet</p>
          <p className="text-muted-foreground">
            It starts recording once the security update is deployed (<code className="text-xs">firebase deploy --only firestore</code>).
            Until then nothing is written, and nothing about the app changes.
          </p>
        </div>
      ) : (
        <>
          {/* ── Filters ── */}
          <div className="card-luxe p-3 flex flex-wrap items-center gap-2">
            <div className="relative flex-1 min-w-[180px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input value={q} onChange={e => setQ(e.target.value)} placeholder="Search — client, order, person…" className="pl-9 h-10 rounded-lg" />
            </div>
            <Select value={who} onValueChange={setWho}>
              <SelectTrigger className="h-10 w-48 rounded-lg"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Everyone</SelectItem>
                {people.map(([id, name]) => <SelectItem key={id} value={id}>{name}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={mod} onValueChange={setMod}>
              <SelectTrigger className="h-10 w-40 rounded-lg"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All sections</SelectItem>
                {MODULES.map(m => <SelectItem key={m.key} value={m.key}>{m.label}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={kind} onValueChange={setKind}>
              <SelectTrigger className="h-10 w-36 rounded-lg"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Every kind</SelectItem>
                {Object.entries(KIND_LABEL).map(([k, l]) => <SelectItem key={k} value={k}>{l}</SelectItem>)}
              </SelectContent>
            </Select>
            <Input type="date" value={from} onChange={e => setFrom(e.target.value)} className="h-10 w-[9.5rem] rounded-lg" />
            <span className="text-xs text-muted-foreground">to</span>
            <Input type="date" value={to} onChange={e => setTo(e.target.value)} className="h-10 w-[9.5rem] rounded-lg" />
          </div>

          {/* ── The log ── */}
          <div className="card-luxe divide-y divide-border/50 overflow-hidden">
            {shown.length === 0 && !loading && (
              <div className="p-10 text-center text-sm text-muted-foreground">Nothing recorded for these filters.</div>
            )}
            {shown.map(e => {
              const isOpen = open === e.id;
              const b = blocked[e.id];
              return (
                <div key={e.id} className={e.undoneAt ? "bg-secondary/30" : ""}>
                  <div className="flex items-start gap-3 px-4 py-3">
                    <div className="mt-0.5 shrink-0"><KindIcon e={e} /></div>
                    <button onClick={() => setOpen(isOpen ? null : e.id)} className="flex-1 min-w-0 text-left">
                      <p className={`text-sm ${e.undoneAt ? "line-through text-muted-foreground" : "text-brand-dark"}`}>{e.summary}</p>
                      <p className="text-[11px] text-muted-foreground mt-0.5">
                        <span className="font-medium text-foreground/80">{e.actorName}</span>
                        <span> · {ROLE_LABEL[e.actorRole] ?? e.actorRole}</span>
                        <span> · {moduleLabel(e.module)}</span>
                        <span> · {new Date(e.at).toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}</span>
                        {e.undoneAt && <span className="text-amber-700"> · undone by {e.undoneByName}</span>}
                      </p>
                    </button>
                    <div className="flex items-center gap-1.5 shrink-0">
                      {e.kind !== "undo" && !e.undoneAt && e.undoable && (
                        <Button size="sm" variant="outline" onClick={() => tryUndo(e)} className="h-8 rounded-lg gap-1.5 text-xs">
                          <Undo2 className="h-3.5 w-3.5" /> Undo
                        </Button>
                      )}
                      {(e.changes?.length || e.meta) && (
                        <button onClick={() => setOpen(isOpen ? null : e.id)} className="h-8 w-8 grid place-items-center rounded-lg hover:bg-secondary" aria-label="Details">
                          <ChevronDown className={`h-4 w-4 transition-transform ${isOpen ? "rotate-180" : ""}`} />
                        </button>
                      )}
                    </div>
                  </div>
                  {isOpen && (
                    <div className="px-4 pb-3 pl-11 space-y-2">
                      {b && (
                        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-2.5 text-xs">
                          <p className="font-semibold text-destructive">{b.reason}</p>
                          {b.moved?.map(m => <p key={m} className="text-muted-foreground">• {m}</p>)}
                        </div>
                      )}
                      {!e.undoable && e.undoBlocker && e.kind === "change" && (
                        <p className="text-[11px] text-muted-foreground">Can&rsquo;t be undone automatically: {e.undoBlocker}</p>
                      )}
                      {e.truncated && <p className="text-[11px] text-amber-700">A very large change — the list of what changed is kept, the full copies are not.</p>}
                      {e.changes?.map(c => <ChangeDetail key={`${c.col}/${c.id}`} c={c} />)}
                      {e.meta && !e.changes?.length && (
                        <p className="text-xs text-muted-foreground">{Object.entries(e.meta).map(([k, v]) => `${fieldLabel(k)}: ${show(v)}`).join(" · ")}</p>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
            {loading && <div className="p-6 grid place-items-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>}
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
