// Settings → Catalogue reading: each design sheet's table read by itself (on the
// server, free OCR — no paid AI) when a picture or Excel sheet is uploaded, the
// whole catalogue read once (start / pause, its progress), and how this business
// names its designs — learnt from its own folders and files, changeable here,
// with a preview of how the files would be grouped before anything is saved.
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ClipboardCheck, Loader2, Pause, Play, ScanText, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { SectionTitle } from "@/components/SectionTitle";
import { StatStrip } from "@/components/TableToolbar";
import { CellTag } from "@/components/DataTable";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useAuth } from "@/lib/auth";
import { timeAgo } from "@/lib/db";
import { learnCatalog, pauseReading, saveSpecsSettings, specsCounts, startReading, useSpecsSettings, useSpecsState, type Learnt, type SpecsCounts, type SpecsSettings } from "@/lib/catalogSpecs";

const words = (s: string) => s.split(/[,\s]+/).map(x => x.trim().toUpperCase()).filter(Boolean);
const n = (x?: number) => (x ?? 0).toLocaleString("en-IN");

export function CatalogReadingSettings() {
  const { user } = useAuth();
  const saved = useSpecsSettings();
  const state = useSpecsState();
  const [f, setF] = useState<SpecsSettings | null>(null);
  const [counts, setCounts] = useState<SpecsCounts | null>(null);
  const [busy, setBusy] = useState("");
  const [learnt, setLearnt] = useState<Learnt | null>(null);
  const v = f ?? saved;

  const recount = useCallback(async () => { try { setCounts(await specsCounts(state?.run)); } catch { /* counted again next time */ } }, [state?.run]);
  // The counts while it reads: every 10 s (each count is one read per thousand files).
  useEffect(() => {
    void recount();
    const busyNow = (state?.running && !state?.listedAt) || (counts?.queued ?? 0) > 0;
    if (!busyNow) return;
    const t = window.setInterval(() => void recount(), 10_000);
    return () => window.clearInterval(t);
  }, [recount, state?.running, counts?.queued]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!v) return <div className="card-luxe p-6"><p className="text-sm text-muted-foreground">Loading…</p></div>;
  const set = (p: Partial<SpecsSettings>) => setF({ ...v, ...p });
  const setRules = (p: Partial<SpecsSettings["rules"]>) => set({ rules: { ...v.rules, ...p } });
  const dirty = !!f && JSON.stringify(f) !== JSON.stringify(saved);

  const save = async () => {
    setBusy("save");
    try {
      await saveSpecsSettings(v, user!.id);
      setF(null);
      toast.success("Saved — files uploaded from now on follow these rules. Read the catalogue again to file the old ones by them.");
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(""); }
  };
  const run = async (what: "start" | "retry" | "pause") => {
    setBusy(what);
    try {
      if (what === "pause") { await pauseReading(); toast.success("Paused — files waiting stay waiting until you carry on"); }
      else { await startReading({ retryErrors: true }); toast.success("Reading the catalogue — files already read are skipped"); }
      void recount();
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(""); }
  };
  const learn = async () => {
    setBusy("learn");
    try { setLearnt(await learnCatalog(v.rules)); } catch (e) { toast.error((e as Error).message); } finally { setBusy(""); }
  };

  // Listed to the end and nothing left waiting: done (the run stays open so files still queued are read).
  const running = !!state?.running && !(state?.listedAt && counts && counts.queued === 0);
  const queuedRun = state?.queued ?? 0;
  const pct = running && queuedRun ? Math.min(100, Math.round(((counts?.doneThisRun ?? 0) / queuedRun) * 100)) : null;

  return (
    <div className="card-luxe p-6 space-y-7">
      <SectionTitle icon={ScanText} title="Catalogue reading" sub={running ? (state?.listedAt ? "Reading the catalogue" : "Looking through the catalogue") : counts ? `${n(counts.designs)} designs · ${n(counts.ok + counts.review)} sheets read` : "—"}
        info="Each design sheet's table — gold by karat, the stones, the sizes — is read on our own server (free OCR, no paid AI) when its picture or Excel file is uploaded, and every file is filed under its design: its sheet, its pictures, a 360° set, videos and CAD. A reading that doesn't add up is never guessed: it waits in Please check. A reading a person corrected or confirmed is never read over."
        actions={<Button asChild variant="outline" size="sm" className="gap-1.5"><Link to="/catalog/check"><ClipboardCheck className="h-4 w-4" />Please check{counts?.designsReview ? ` (${n(counts.designsReview)})` : ""}</Link></Button>} />

      {/* Progress */}
      <section className="space-y-3">
        <StatStrip items={[
          { label: "Designs", value: n(counts?.designs), sub: `${n(counts?.designsOk)} with details` },
          { label: "Sheets read", value: n((counts?.ok ?? 0) + (counts?.review ?? 0)), sub: `${n(counts?.checked)} checked by a person` },
          { label: "Please check", value: n(counts?.designsReview), sub: `${n(counts?.review)} sheets` },
          { label: "Waiting to be read", value: n(counts?.queued), sub: counts?.error ? `${n(counts.error)} couldn't be read` : "—" },
        ]} />
        <div className="rounded-xl border border-border px-4 py-3 space-y-2">
          <div className="flex flex-wrap items-center gap-2 justify-between">
            <div className="flex items-center gap-2 text-sm">
              <CellTag tone={running ? "blue" : state?.listedAt && state?.running ? "green" : "neutral"}>{running ? "Reading" : state?.running && state?.listedAt ? "Done" : state?.pausedAt ? "Paused" : "Idle"}</CellTag>
              <span className="text-muted-foreground text-xs">
                {running ? `${n(state?.scanned)} files looked at · ${n(queuedRun)} to read${state?.listedAt ? "" : " so far"}` : state?.startedAt ? `Last started ${timeAgo(state.startedAt).toLowerCase()}` : "Never read as a whole yet"}
              </span>
            </div>
            <div className="flex gap-2">
              {running
                ? <Button size="sm" variant="outline" className="gap-1.5" disabled={!!busy} onClick={() => run("pause")}><Pause className="h-4 w-4" />Pause</Button>
                : <Button size="sm" className="gap-1.5" disabled={!!busy} onClick={() => run("start")}>{busy === "start" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}{state?.startedAt ? "Read what's not read yet" : "Read the whole catalogue"}</Button>}
            </div>
          </div>
          {pct != null && (
            <div className="h-2 rounded-full bg-secondary overflow-hidden" aria-label={`${pct}% read`}><div className="h-full bg-primary transition-all" style={{ width: `${pct}%` }} /></div>
          )}
          <p className="text-[11px] text-muted-foreground">Ten files at a time, about 3 seconds each. Files already read, and the same picture uploaded twice, are not read again. It carries on with this page closed.</p>
        </div>
      </section>

      {/* Uploads */}
      <section className="space-y-3">
        <SectionTitle title="When files are uploaded" />
        <div className="space-y-2">
          {([
            ["auto", "Read sheets as soon as they are uploaded", "Thousands at once are fine: they wait in turn and are read ten at a time."],
            ["readPictures", "Read pictures", "Each picture is looked at for a spec table; a render with no table is simply a picture of the design."],
            ["readExcel", "Read Excel sheets (.xlsx)", "Read exactly, with no OCR — preferred over a picture of the same sheet."],
          ] as const).map(([k, label, hint]) => (
            <label key={k} className="flex items-start justify-between gap-3 rounded-xl border border-border px-4 py-3">
              <span className="min-w-0"><span className="text-sm font-medium block">{label}</span><span className="text-xs text-muted-foreground">{hint}</span></span>
              <Switch checked={v[k]} onCheckedChange={c => set({ [k]: c } as Partial<SpecsSettings>)} />
            </label>
          ))}
        </div>
      </section>

      {/* Design numbers */}
      <section className="space-y-3">
        <SectionTitle title="How your designs are named" sub="Learnt from your own folders and files"
          info="A file belongs to the nearest folder named as a design (SRG0034, SLR-000944A), else to the design in its own name (SRG0053@.jpg in New folder). A folder with no design number anywhere keeps its same-named files together (27.jpg with 27.3dm). Phone names (WhatsApp Image…, IMG_2034) are never designs." />
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label className="text-xs">The design number comes from</Label>
            <select className="mt-1 h-9 w-full rounded-lg border border-input bg-white px-2 text-sm" value={v.rules.designFrom ?? "auto"} onChange={e => setRules({ designFrom: e.target.value as "auto" | "folder" | "file" })}>
              <option value="auto">Its folder, else its file name (best for most)</option>
              <option value="folder">Folder names only</option>
              <option value="file">File names only</option>
            </select>
          </div>
          <div>
            <Label className="text-xs">Fewest digits in a design number</Label>
            <Input type="number" min={2} max={6} className="mt-1 h-9" value={v.rules.minDigits ?? 3} onChange={e => setRules({ minDigits: Number(e.target.value) || 3 })} />
          </div>
          <div className="sm:col-span-2">
            <Label className="text-xs">Only these letters start a design number (empty: any letters)</Label>
            <Input className="mt-1 h-9" placeholder="SRG, SLR, SBD …" value={(v.rules.prefixes ?? []).join(", ")} onChange={e => setRules({ prefixes: words(e.target.value) })} />
          </div>
          <div>
            <Label className="text-xs">Never a design (besides IMG, WhatsApp, SPEC …)</Label>
            <Input className="mt-1 h-9" placeholder="TEST, SAMPLE" value={(v.rules.notDesign ?? []).join(", ")} onChange={e => setRules({ notDesign: words(e.target.value) })} />
          </div>
          <div>
            <Label className="text-xs">View words after a name (besides REF, RENDER, DCC …)</Label>
            <Input className="mt-1 h-9" placeholder="FRONT, SIDE" value={(v.rules.viewWords ?? []).join(", ")} onChange={e => setRules({ viewWords: words(e.target.value) })} />
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" className="gap-1.5" disabled={!!busy} onClick={learn}>{busy === "learn" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}Learn from my catalogue & preview</Button>
          {dirty && <Button size="sm" disabled={!!busy} onClick={save}>{busy === "save" ? "Saving…" : "Save"}</Button>}
          {dirty && <Button size="sm" variant="ghost" onClick={() => { setF(null); setLearnt(null); }}>Undo</Button>}
        </div>
        {learnt && (
          <div className="rounded-xl border border-border p-4 space-y-3 text-sm">
            <p>With these rules: <b>{n(learnt.preview.designs)}</b> designs from {n(learnt.preview.files - learnt.preview.junk)} files in {n(learnt.preview.folders)} folders — {n(learnt.preview.folder)} files by their folder, {n(learnt.preview.file)} by their own name, {n(learnt.preview.group)} grouped by name in a folder with no design number{learnt.preview.junk ? `; ${n(learnt.preview.junk)} system files left out (Thumbs.db …)` : ""}.</p>
            {learnt.learnt.prefixes.length > 0 && (
              <div>
                <p className="text-xs text-muted-foreground mb-1.5">Your design numbers start with</p>
                <div className="flex flex-wrap gap-1.5">
                  {learnt.learnt.prefixes.slice(0, 40).map(p => <span key={p} className="rounded-full bg-secondary px-2 py-0.5 text-xs">{p} <span className="text-muted-foreground">{n(learnt.learnt.counts[p])}</span></span>)}
                </div>
                <Button size="sm" variant="link" className="px-0 h-auto mt-1" onClick={() => setRules({ prefixes: learnt.learnt.prefixes })}>Use only these letters</Button>
              </div>
            )}
            {learnt.preview.loose.length > 0 && (
              <details className="text-xs"><summary className="cursor-pointer text-muted-foreground">Files with no design number ({n(learnt.preview.group)})</summary>
                <ul className="mt-1 space-y-0.5 text-muted-foreground">{learnt.preview.loose.map(x => <li key={x} className="truncate">{x}</li>)}</ul>
              </details>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
