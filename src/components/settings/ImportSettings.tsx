// Settings → Import from Excel (admins): the template, a file checked row by
// row before anything is saved, the import, and every past import with its
// Undo. The work itself: lib/excelImport.ts.
import { useRef, useState } from "react";
import { toast } from "sonner";
import { Download, FileSpreadsheet, Upload, Undo2, CheckCircle2, AlertTriangle, CircleSlash, Info } from "lucide-react";
import { useDb } from "@/hooks/useDb";
import { useAuth } from "@/lib/auth";
import { fmtDate, todayLocal, loadDb } from "@/lib/db";
import { confirmBox } from "@/lib/confirm";
import { openMin } from "@/lib/openMin";
import { closedWhy } from "@/lib/yearLock";
import {
  downloadImportTemplate, readImportFile, runImport, prepareUndo, undoImport, importRecords, stillIn, shownStatus, countsText,
  KINDS, type ImportPlan, type PlanRow, type ImportRecord, type ImportKind,
} from "@/lib/excelImport";
import { SectionTitle } from "@/components/SectionTitle";
import { StatStrip } from "@/components/TableToolbar";
import { DataTable, CellMain, CellTag, CellDate, type DataColumn } from "@/components/DataTable";
import { AsyncButton } from "@/components/AsyncButton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { MoreAction } from "@/components/MoreMenu";

const SHEET: Record<ImportKind, string> = { clients: "Clients", suppliers: "Suppliers", loose: "Loose stones", certified: "Certified stones", ready: "Ready Stock" };
const RESULT: Record<PlanRow["status"], { label: string; tone: "green" | "neutral" | "red" }> = {
  ok: { label: "Will import", tone: "green" }, skip: { label: "Skipped — already here", tone: "neutral" }, error: { label: "Needs fixing", tone: "red" },
};
const STATUS: Record<ImportRecord["batch"]["status"], { label: string; tone: "green" | "neutral" | "red" | "amber" }> = {
  running: { label: "Saving…", tone: "amber" }, done: { label: "Imported", tone: "green" }, stopped: { label: "Stopped part-way", tone: "red" },
  undone: { label: "Undone", tone: "neutral" }, partlyUndone: { label: "Partly undone", tone: "amber" },
};

export function ImportSettings() {
  const db = useDb();
  const { user } = useAuth();
  const fileRef = useRef<HTMLInputElement>(null);
  const [asOf, setAsOf] = useState(todayLocal());
  const [file, setFile] = useState<File | null>(null);
  const [plan, setPlan] = useState<ImportPlan | null>(null);
  const [reading, setReading] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number; what: string } | null>(null);

  const read = async (f: File | null, day = asOf) => {
    if (!f) return;
    setFile(f); setReading(true);
    try { setPlan(await readImportFile(f, loadDb(), day)); }
    catch (e) { toast.error(e instanceof Error ? e.message : "The file couldn't be read"); setPlan(null); }
    finally { setReading(false); }
  };
  const reset = () => { setPlan(null); setFile(null); if (fileRef.current) fileRef.current.value = ""; };

  const rows = plan?.rows ?? [];
  const ok = rows.filter(r => r.status === "ok"), skip = rows.filter(r => r.status === "skip"), bad = rows.filter(r => r.status === "error");
  const byKind = (list: PlanRow[]) => { const c: Partial<Record<ImportKind, number>> = {}; for (const r of list) c[r.kind] = (c[r.kind] ?? 0) + 1; return c; };
  const hasStones = ok.some(r => r.kind === "loose" || r.kind === "certified");
  const dayClosed = closedWhy(asOf, db.settings);

  const doImport = async () => {
    if (!plan || !user) return;
    const lines = [
      `Import ${ok.length} record${ok.length === 1 ? "" : "s"} from ${plan.file}?`, "",
      `• ${countsText(byKind(ok))}`,
      ...(hasStones ? [`• stones into stock as opening stock, as of ${fmtDate(asOf)} — no supplier, no dues`] : []),
      ...(skip.length ? [`• ${skip.length} already here — skipped`] : []),
      ...(bad.length ? [`• ${bad.length} that need fixing are left out — fix them and import those rows on their own`] : []),
      "• Undo takes the whole import out again, except anything used since",
    ];
    if (!(await confirmBox(lines, { confirmText: "Import" }))) return;
    setProgress({ done: 0, total: ok.length, what: "Importing" });
    try {
      const res = await runImport(plan, asOf, user, (done, total) => setProgress({ done, total, what: "Importing" }));
      const got = countsText(res.counts);
      if (res.problem) toast.error(`Stopped part-way — ${got} imported. ${res.problem}. Undo it below, fix the file and import again.`, { duration: 12000 });
      else toast.success(`Imported — ${got}${res.skippedNow ? ` · ${res.skippedNow} added by someone meanwhile, skipped` : ""}`);
      reset();
    } catch (e) { toast.error(e instanceof Error ? e.message : "The import didn't run"); }
    finally { setProgress(null); }
  };

  const undo = async (r: ImportRecord) => {
    if (!user) return;
    const p = await prepareUndo(r.id);
    if (!p) return;
    const out = p.remove.length + p.moves.length;
    if (!out) { toast.error(p.keep.length ? `Nothing can come out — everything has been used since (${p.keep[0].why})` : "Nothing from this import is left"); return; }
    const lines = [
      `Undo the import of ${r.batch.file}?`, "",
      `• ${out} record${out === 1 ? "" : "s"} it brought in come${out === 1 ? "s" : ""} out — ${countsText(undoCounts(p))}`,
      ...(p.moves.length ? ["• the stones leave stock, and their opening value the stock ledger"] : []),
      ...(p.keep.length ? [`• ${p.keep.length} stay${p.keep.length === 1 ? "s" : ""} — used since:`, ...p.keep.slice(0, 8).map(k => `   ${k.what} — ${k.why}`), ...(p.keep.length > 8 ? [`   …and ${p.keep.length - 8} more`] : [])] : []),
      "This cannot be undone.",
    ];
    if (!(await confirmBox(lines, { danger: true, confirmText: "Undo import" }))) return;
    setProgress({ done: 0, total: out, what: "Taking out" });
    try {
      const res = await undoImport(r.id, user, (done, total) => setProgress({ done, total, what: "Taking out" }));
      if (res.kept.length) toast.success(`${res.removed} taken out · ${res.kept.length} kept — used since`, { duration: 9000 });
      else toast.success(`Import undone — ${res.removed} record${res.removed === 1 ? "" : "s"} taken out`);
    } catch (e) { toast.error(e instanceof Error ? e.message : "The undo didn't finish"); }
    finally { setProgress(null); }
  };

  const previewCols: DataColumn<PlanRow>[] = [
    { key: "sheet", header: "Sheet", sortValue: r => KINDS.indexOf(r.kind), csv: r => SHEET[r.kind], cell: r => <span className="text-xs text-muted-foreground">{SHEET[r.kind]}</span> },
    { key: "row", header: "Row", sortValue: r => r.row, csv: r => String(r.row), cell: r => <span className="tabular-nums text-xs">{r.row}</span> },
    { key: "what", header: "Record", always: true, sortValue: r => r.label, csv: r => r.label, cell: r => <CellMain title={r.label} sub={r.why} /> },
    { key: "result", header: "Result", sortValue: r => (r.status === "error" ? 0 : r.status === "skip" ? 1 : 2), csv: r => `${RESULT[r.status].label}${r.why ? ` — ${r.why}` : ""}`,
      cell: r => <CellTag tone={RESULT[r.status].tone}>{RESULT[r.status].label}</CellTag> },
  ];

  const past = importRecords(db);
  const pastCols: DataColumn<ImportRecord>[] = [
    { key: "at", header: "When", kind: "date", sortValue: r => r.batch.at, csv: r => r.batch.at, cell: r => <CellDate>{fmtDate(r.batch.at)}</CellDate> },
    { key: "file", header: "File", always: true, sortValue: r => r.batch.file, csv: r => r.batch.file,
      cell: r => <CellMain title={r.batch.file} sub={`${countsText(r.batch.counts)}${r.batch.skipped ? ` · ${r.batch.skipped} skipped` : ""}${r.batch.problem ? ` · ${r.batch.problem}` : ""}`} /> },
    { key: "by", header: "By", sortValue: r => r.batch.byName ?? "", csv: r => r.batch.byName ?? "", cell: r => <span className="text-xs text-muted-foreground">{r.batch.byName ?? "—"}</span> },
    { key: "in", header: "Still in", sortValue: r => stillIn(db, r), csv: r => String(stillIn(db, r)), cell: r => <span className="tabular-nums text-sm">{stillIn(db, r)}</span> },
    { key: "status", header: "Status", sortValue: r => shownStatus(r.batch), csv: r => STATUS[shownStatus(r.batch)].label,
      cell: r => <CellTag tone={STATUS[shownStatus(r.batch)].tone}>{STATUS[shownStatus(r.batch)].label}</CellTag> },
  ];
  const pastActions = (r: ImportRecord): MoreAction[] => [
    { label: "Undo the whole import", icon: Undo2, danger: true, disabled: !!progress || stillIn(db, r) === 0,
      hint: stillIn(db, r) === 0 ? "Nothing from it is left" : "Everything it brought in comes out — except anything used since", onSelect: () => void undo(r) },
    ...(r.batch.undo?.kept.length ? [{ label: `What stayed (${r.batch.undo.kept.length})`, icon: Info, onSelect: () => void confirmBox([`Kept from ${r.batch.file} — used since`, "", ...r.batch.undo!.kept.slice(0, 30).map(k => `• ${k.what} — ${k.why}`)], { confirmText: "OK" }) }] : []),
  ];

  return (
    <div className="space-y-6">
      <SectionTitle title="Import from Excel" sub="Clients, suppliers, stones and Ready Stock — from one workbook"
        info={<>Every row is checked before anything is saved. A record already here (the same name, email or phone; the same certificate or design #) is skipped and listed. Stones go in as opening stock — no supplier, no dues. Undo takes a whole import out again, except what has been used since.</>} />

      <div className="grid gap-3 lg:grid-cols-2">
        <div className="rounded-xl border border-border/70 p-4 space-y-2">
          <p className="text-sm font-semibold text-brand-dark flex items-center gap-2"><FileSpreadsheet className="h-4 w-4" /> 1. The template</p>
          <p className="text-xs text-muted-foreground">A sheet for each: Clients, Suppliers, Loose stones, Certified stones, Ready Stock — with your own dropdown lists, offices and companies. Fill only the sheets you need.</p>
          <Button type="button" variant="outline" className="rounded-xl h-9 gap-1.5" onClick={() => void downloadImportTemplate(loadDb()).catch(() => toast.error("The template couldn't be made"))}>
            <Download className="h-4 w-4" /> Download template
          </Button>
        </div>
        <div className="rounded-xl border border-border/70 p-4 space-y-2">
          <p className="text-sm font-semibold text-brand-dark flex items-center gap-2"><Upload className="h-4 w-4" /> 2. Your file</p>
          <div className="flex flex-wrap items-end gap-3">
            <label className="text-xs text-muted-foreground">
              <span className="block mb-1">Excel file (.xlsx)</span>
              <input ref={fileRef} type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" disabled={!!progress}
                onChange={e => void read(e.target.files?.[0] ?? null)} className="block text-xs file:mr-2 file:rounded-lg file:border file:border-border file:bg-secondary file:px-3 file:py-1.5" aria-label="Excel file" />
            </label>
            <label className="text-xs text-muted-foreground">
              <span className="block mb-1">Stones into stock as of</span>
              <Input type="date" min={openMin()} value={asOf} disabled={!!progress} onChange={e => { setAsOf(e.target.value); if (file) void read(file, e.target.value); }} className="rounded-xl h-9 w-40" aria-label="Stones into stock as of" />
            </label>
          </div>
          {dayClosed && <p className="text-xs text-destructive">{dayClosed}</p>}
        </div>
      </div>

      {reading && <p className="text-sm text-muted-foreground">Reading {file?.name}…</p>}

      {plan && !reading && (
        <section className="space-y-3">
          {plan.blocked && <p className="rounded-xl border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive flex gap-2"><AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />{plan.blocked}</p>}
          {!plan.blocked && (
            <StatStrip items={[
              { label: "Will import", value: String(ok.length), icon: CheckCircle2, tone: ok.length ? "in" : undefined, sub: countsText(byKind(ok)) },
              { label: "Already here — skipped", value: String(skip.length), icon: CircleSlash, sub: skip.length ? countsText(byKind(skip)) : "none" },
              { label: "Need fixing", value: String(bad.length), icon: AlertTriangle, tone: bad.length ? "out" : undefined, sub: bad.length ? "left out — see below" : "none" },
            ]} />
          )}
          {(plan.unknownSheets.length > 0 || plan.sheets.some(s => s.ignored.length)) && (
            <div className="text-xs text-muted-foreground space-y-0.5">
              {plan.unknownSheets.length > 0 && <p>Not read: sheet{plan.unknownSheets.length === 1 ? "" : "s"} {plan.unknownSheets.map(s => `“${s}”`).join(", ")} — not one of the template's.</p>}
              {plan.sheets.filter(s => s.ignored.length).map(s => <p key={s.kind}>{SHEET[s.kind]}: column{s.ignored.length === 1 ? "" : "s"} {s.ignored.map(c => `“${c}”`).join(", ")} not known — left out.</p>)}
            </div>
          )}
          {rows.length > 0 && (
            <DataTable id="import-preview" noun="row" rows={rows} columns={previewCols} rowKey={r => `${r.kind}:${r.row}`}
              defaultSort={{ key: "result", dir: "asc" }} searchText={r => `${r.label} ${r.why ?? ""} ${SHEET[r.kind]}`} searchPlaceholder="Search rows"
              exportName="Import-check" pageSizes={[25, 50, 100]} />
          )}
          <div className="flex flex-wrap items-center justify-end gap-2">
            {progress && <span className="text-sm text-muted-foreground mr-auto">{progress.what}… {progress.done} of {progress.total} — keep this page open</span>}
            <Button type="button" variant="outline" className="rounded-xl h-10" onClick={reset} disabled={!!progress}>Choose another file</Button>
            <AsyncButton onClick={doImport} disabled={!!plan.blocked || !ok.length || !!progress || (hasStones && !!dayClosed)} className="btn-hero rounded-xl h-10 min-w-48">
              Import {ok.length} record{ok.length === 1 ? "" : "s"}
            </AsyncButton>
          </div>
        </section>
      )}

      {!plan && progress && <p className="text-sm text-muted-foreground">{progress.what}… {progress.done} of {progress.total} — keep this page open</p>}

      <section className="space-y-2">
        <p className="text-sm font-semibold text-brand-dark">Imports</p>
        {past.length === 0 ? (
          <p className="text-sm text-muted-foreground">None yet.</p>
        ) : (
          <DataTable id="imports" noun="import" rows={past} columns={pastCols} rowKey={r => r.id} rowActions={pastActions}
            defaultSort={{ key: "at", dir: "desc" }} searchText={r => `${r.batch.file} ${r.batch.byName ?? ""}`} searchPlaceholder="Search imports"
            exportName="Imports" pageSizes={[10, 25, 50]} />
        )}
      </section>
    </div>
  );
}

function undoCounts(p: { remove: { kind: ImportKind }[]; moves: unknown[] }): Partial<Record<ImportKind, number>> {
  const c: Partial<Record<ImportKind, number>> = {};
  for (const r of p.remove) c[r.kind] = (c[r.kind] ?? 0) + 1;
  if (p.moves.length) c.loose = p.moves.length;
  return c;
}
