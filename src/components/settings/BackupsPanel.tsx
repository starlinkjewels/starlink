// Settings → Data & Backup → Backups (admins): the server's backup every 6
// hours with its check, the older daily ones, Back up now — and the main
// admin's safe restore: pick what to bring back, see what will change, then
// put back only what is missing or different (never removing anything newer).
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Database, ShieldCheck, AlertTriangle, Clock, Download, History, Upload, RotateCcw } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { auth, isAdminEmail, ADMIN_EMAILS } from "@/lib/firebase";
import { fmtDate } from "@/lib/db";
import { confirmBox } from "@/lib/confirm";
import { listBackups, backupUrl, type BackupEntry } from "@/lib/backup";
import { backupNow, kindLabel, restorePlan, sizeText, subscribeRuns, uploadForRestore, type BackupRun, type RestorePlan, type RestoreScope } from "@/lib/serverBackups";
import { SectionTitle } from "@/components/SectionTitle";
import { StatStrip } from "@/components/TableToolbar";
import { DataTable, CellMain, CellTag, CellDate, type DataColumn } from "@/components/DataTable";
import { ActionSheet } from "@/components/ActionSheet";
import { AsyncButton } from "@/components/AsyncButton";
import { Field, Group, PanelActions, Segmented } from "@/components/BillLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { MoreAction } from "@/components/MoreMenu";

interface Row { path: string; at: string; kind: BackupRun["kind"] | "daily"; run?: BackupRun }

const ago = (iso: string) => {
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 60) return `${Math.max(0, m)} min ago`;
  if (m < 48 * 60) return `${Math.round(m / 60)} h ago`;
  return fmtDate(iso);
};
const timeText = (iso: string) => new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
/** The next 00:00 / 06:00 / 12:00 / 18:00, India time. */
const nextRun = () => {
  const ist = new Date(Date.now() + 5.5 * 3600_000);
  const h = ist.getUTCHours();
  const next = new Date(ist); next.setUTCHours(Math.floor(h / 6) * 6 + 6, 0, 0, 0);
  return new Date(next.getTime() - 5.5 * 3600_000).toISOString();
};

export function BackupsPanel() {
  const { user } = useAuth();
  const mainAdmin = isAdminEmail(auth.currentUser?.email) || isAdminEmail(user?.email);
  const [runs, setRuns] = useState<BackupRun[] | null>(null);
  const [denied, setDenied] = useState(false);
  const [daily, setDaily] = useState<BackupEntry[]>([]);
  const [restoring, setRestoring] = useState<Row | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => subscribeRuns(setRuns, () => setDenied(true)), []);
  useEffect(() => { listBackups().then(setDaily).catch(() => setDaily([])); }, []);

  const rows: Row[] = [
    ...(runs ?? []).map(r => ({ path: r.path, at: r.at, kind: r.kind, run: r })),
    // An older daily copy from the app: dated by its day only — the start of that day, as a moment like the rest.
    ...daily.map(b => ({ path: b.path, at: new Date(`${b.date}T00:00:00`).toISOString(), kind: "daily" as const })),
  ].sort((a, b) => b.at.localeCompare(a.at));
  const last = runs?.[0];

  const take = async () => {
    try {
      const r = await backupNow();
      if (r.ok) toast.success(`Backed up and checked — ${r.records.toLocaleString("en-IN")} records`);
      else toast.error(`Backed up, but the check found a problem: ${r.problems[0] ?? "see the list"}`);
    } catch (e) { toast.error((e as { message?: string })?.message?.replace(/^.*?:\s*/, "") || "The backup didn't run — try again"); }
  };
  const download = async (r: Row) => {
    try { window.open(await backupUrl(r.path), "_blank", "noopener"); }
    catch { toast.error("Couldn't open that backup"); }
  };
  const fromFile = async (f: File | undefined) => {
    if (!f) return;
    try {
      const path = await uploadForRestore(f);
      setRestoring({ path, at: new Date().toISOString(), kind: "daily" });
    } catch { toast.error("The file couldn't be uploaded for the restore"); }
    finally { if (fileRef.current) fileRef.current.value = ""; }
  };

  const columns: DataColumn<Row>[] = [
    { key: "at", header: "Taken", always: true, kind: "date", sortValue: r => r.at, csv: r => r.at,
      cell: r => <CellMain title={r.kind === "daily" ? fmtDate(r.at) : timeText(r.at)} sub={r.run?.byName ? `${kindLabel(r.kind)} · ${r.run.byName}` : kindLabel(r.kind)} /> },
    { key: "records", header: "Records", align: "right", kind: "number", sortValue: r => r.run?.records ?? null, csv: r => r.run?.records ?? "",
      cell: r => <span className="tabular-nums text-sm">{r.run ? r.run.records.toLocaleString("en-IN") : "—"}</span> },
    { key: "size", header: "Size", align: "right", kind: "number", sortValue: r => r.run?.bytes ?? null, csv: r => r.run?.bytes ?? "",
      cell: r => <span className="tabular-nums text-sm text-muted-foreground">{r.run ? sizeText(r.run.bytes) : "—"}</span> },
    { key: "check", header: "Check", sortValue: r => (r.run ? (r.run.verified.ok ? 1 : 0) : 2), csv: r => (r.run ? (r.run.verified.ok ? "Whole" : r.run.verified.problems.join("; ")) : ""),
      cell: r => !r.run ? <span className="text-xs text-muted-foreground">Not checked</span>
        : r.run.verified.ok ? <CellTag tone="green">Read back whole</CellTag>
        : <span title={r.run.verified.problems.join("\n")}><CellTag tone="red">Problem</CellTag></span> },
  ];
  const actions = (r: Row): MoreAction[] => [
    { label: "Download", icon: Download, onSelect: () => void download(r) },
    { label: "Compare & restore…", icon: History, disabled: !mainAdmin, hint: mainAdmin ? "See what is different, then put back only that" : `Only the main admin (${ADMIN_EMAILS[0]})`, onSelect: () => setRestoring(r) },
  ];

  if (denied) return <p className="text-sm text-muted-foreground">Backups every 6 hours start once their server part and rules are switched on.</p>;
  return (
    <section className="space-y-4">
      <SectionTitle icon={Database} title="Backups" sub="Every 6 hours by the server, each one read back and checked"
        info={<>A copy of every record is taken at 12 am, 6 am, 12 pm and 6 pm (India time) into the admin-only backups folder, then read back and checked: every collection there, every record readable, the counts matching the database. A failed check alerts every partner at once. Kept: every backup for 7 days, then one a day for 30 days.</>} />
      <StatStrip items={[
        { label: "Last backup", value: last ? ago(last.at) : "None yet", icon: Clock, tone: last && Date.now() - new Date(last.at).getTime() < 7 * 3600_000 ? "in" : "out", sub: last ? `${last.records.toLocaleString("en-IN")} records · ${sizeText(last.bytes)}` : "the first runs at the next 6-hour mark" },
        { label: "Its check", value: !last ? "—" : last.verified.ok ? "Read back whole" : "Problem", icon: last && !last.verified.ok ? AlertTriangle : ShieldCheck, tone: last ? (last.verified.ok ? "in" : "out") : undefined, sub: last ? (last.verified.ok ? (last.verified.notes[0] ?? "every record readable, counts match") : last.verified.problems[0]) : "" },
        { label: "Next", value: timeText(nextRun()), icon: RotateCcw, sub: `${(runs ?? []).length} kept on the server` },
      ]} />
      <div className="flex flex-wrap items-center gap-2 justify-end">
        {mainAdmin && (
          <>
            <input ref={fileRef} type="file" accept=".json,.gz,application/json,application/gzip" className="hidden" onChange={e => void fromFile(e.target.files?.[0])} aria-label="Backup file to restore from" />
            <Button type="button" variant="outline" className="rounded-xl h-9 gap-1.5" onClick={() => fileRef.current?.click()}><Upload className="h-4 w-4" /> Restore from a file…</Button>
          </>
        )}
        <AsyncButton onClick={take} className="btn-hero rounded-xl h-9 gap-1.5"><Database className="h-4 w-4" /> Back up now</AsyncButton>
      </div>
      {runs === null ? <p className="text-sm text-muted-foreground">Loading…</p> : (
        <DataTable id="backups" noun="backup" rows={rows} columns={columns} rowKey={r => r.path} rowActions={actions}
          defaultSort={{ key: "at", dir: "desc" }} exportName="Backups" pageSizes={[10, 25, 50]}
          details={r => (r.run ? [
            { label: "Collections", value: `${Object.keys(r.run.collections).length} — ${Object.entries(r.run.collections).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([c, n]) => `${c} ${n}`).join(", ")}…` },
            ...(r.run.verified.problems.length ? [{ label: "Problems", value: r.run.verified.problems.join("; ") }] : []),
            ...(r.run.verified.notes.length ? [{ label: "Notes", value: r.run.verified.notes.join("; ") }] : []),
            { label: "Took", value: `${Math.round(r.run.ms / 1000)} s` },
            { label: "File", value: <span className="font-mono text-xs break-all">{r.path}</span> },
          ] : [{ label: "File", value: <span className="font-mono text-xs break-all">{r.path}</span> }])} />
      )}
      {restoring && <RestoreSheet row={restoring} onClose={() => setRestoring(null)} />}
    </section>
  );
}

/** The main admin's safe restore: what to bring back, what will change, then only that. */
function RestoreSheet({ row, onClose }: { row: Row; onClose: () => void }) {
  const [mode, setMode] = useState<"all" | "collection" | "doc">("collection");
  const cols = row.run ? Object.keys(row.run.collections).sort() : [];
  const [collection, setCollection] = useState(cols.includes("orders") ? "orders" : cols[0] ?? "");
  const [id, setId] = useState("");
  const [plan, setPlan] = useState<RestorePlan | null>(null);
  const scope = (): RestoreScope | null => mode === "all" ? { kind: "all" } : !collection.trim() ? null
    : mode === "collection" ? { kind: "collection", collection: collection.trim() } : id.trim() ? { kind: "doc", collection: collection.trim(), id: id.trim() } : null;

  const look = async () => {
    const s = scope();
    if (!s) { toast.error(mode === "doc" ? "Enter the collection and the record's id" : "Choose the collection"); return; }
    try { setPlan(await restorePlan(row.path, s, false)); }
    catch (e) { toast.error((e as { message?: string })?.message?.replace(/^.*?:\s*/, "") || "Couldn't read that backup"); }
  };
  const apply = async () => {
    const s = scope();
    if (!s || !plan) return;
    if (!(await confirmBox([
      `Put back ${plan.add + plan.change} record${plan.add + plan.change === 1 ? "" : "s"} from the backup of ${timeText(row.at)}?`, "",
      `• ${plan.add} missing now — added back`,
      `• ${plan.change} different now — put back as they were then (changes made since to these are replaced)`,
      "• nothing newer is removed; a backup of everything as it is now is taken first, so this can be undone",
      "• every partner is told",
    ], { danger: true, confirmText: "Restore" }))) return;
    try {
      const r = await restorePlan(row.path, s, true);
      toast.success(`Restored — ${r.written} record${r.written === 1 ? "" : "s"} put back. A backup from just before is in the list.`, { duration: 10000 });
      onClose();
    } catch (e) { toast.error((e as { message?: string })?.message?.replace(/^.*?:\s*/, "") || "The restore didn't run"); }
  };

  return (
    <ActionSheet open onOpenChange={o => { if (!o) onClose(); }} size="lg" icon={History} title="Compare & restore"
      description={`From the backup of ${row.kind === "daily" ? fmtDate(row.at) : timeText(row.at)} — only what is missing or different comes back`}
      footer={<PanelActions onCancel={onClose}>
        {!plan ? <AsyncButton onClick={look} className="btn-hero rounded-xl h-11 flex-1 sm:flex-none sm:min-w-48">Show what will change</AsyncButton>
          : <AsyncButton onClick={apply} disabled={plan.add + plan.change === 0} className="btn-hero rounded-xl h-11 flex-1 sm:flex-none sm:min-w-48">Restore {plan.add + plan.change} record{plan.add + plan.change === 1 ? "" : "s"}</AsyncButton>}
      </PanelActions>}>
      <div className="space-y-5">
        <Group title="What to bring back">
          <div className="space-y-3">
            <Segmented value={mode} onChange={v => { setMode(v); setPlan(null); }} options={[["doc", "One record"], ["collection", "One collection"], ["all", "Everything"]] as const} />
            {mode !== "all" && (
              <div className="grid grid-cols-2 gap-3">
                <Field label="Collection">{fid => cols.length ? (
                  <Select value={collection} onValueChange={v => { setCollection(v); setPlan(null); }}>
                    <SelectTrigger id={fid} className="rounded-xl h-10" aria-label="Collection"><SelectValue /></SelectTrigger>
                    <SelectContent>{cols.map(c => <SelectItem key={c} value={c}>{c} · {row.run!.collections[c]}</SelectItem>)}</SelectContent>
                  </Select>
                ) : <Input id={fid} value={collection} onChange={e => { setCollection(e.target.value); setPlan(null); }} placeholder="e.g. orders" className="rounded-xl h-10" aria-label="Collection" />}</Field>
                {mode === "doc" && <Field label="Record id" hint="As in the record's link or the Activity log">{fid => <Input id={fid} value={id} onChange={e => { setId(e.target.value); setPlan(null); }} placeholder="e.g. o_ab12cd" className="rounded-xl h-10" aria-label="Record id" />}</Field>}
              </div>
            )}
            <p className="text-xs text-muted-foreground">Records made since this backup are never removed. Records that differ now are put back as they were then — so pick the smallest thing that brings back what was lost.</p>
          </div>
        </Group>
        {plan && (
          <Group title="What will change">
            <div className="space-y-3">
              <StatStrip items={[
                { label: "Missing now — added back", value: String(plan.add), tone: plan.add ? "in" : undefined },
                { label: "Different now — put back", value: String(plan.change), tone: plan.change ? "out" : undefined },
                { label: "The same — left alone", value: String(plan.same) },
              ]} />
              {plan.tallies.filter(t => t.add || t.change).length > 0 ? (
                <div className="rounded-xl border border-border/70 divide-y divide-border/60 text-sm">
                  {plan.tallies.filter(t => t.add || t.change).map(t => (
                    <div key={t.c} className="flex items-center justify-between gap-3 px-3 py-2">
                      <span className="font-medium text-brand-dark break-all">{t.c}</span>
                      <span className="text-xs text-muted-foreground whitespace-nowrap">{t.add ? `${t.add} added back` : ""}{t.add && t.change ? " · " : ""}{t.change ? `${t.change} put back` : ""}</span>
                    </div>
                  ))}
                </div>
              ) : <p className="text-sm text-muted-foreground">Nothing to put back — what is in the backup is all here, unchanged.</p>}
              {plan.samples.length > 0 && <p className="text-[11px] text-muted-foreground break-all">For example: {plan.samples.slice(0, 12).map(s => `${s.c}/${s.id} (${s.what === "add" ? "missing" : "different"})`).join(", ")}</p>}
            </div>
          </Group>
        )}
      </div>
    </ActionSheet>
  );
}
