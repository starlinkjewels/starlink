import { useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { toast } from "sonner";
import { Box, Download, FileText, Film, ImageIcon, Loader2, MessageSquareWarning, Send, Trash2, Upload } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { SectionTitle } from "@/components/SectionTitle";
import { CellTag } from "@/components/DataTable";
import { ActionSheet } from "@/components/ActionSheet";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { zoomable } from "@/components/ImageViewer";
import { useDb } from "@/hooks/useDb";
import { useAuth } from "@/lib/auth";
import { fmtDate, todayLocal, type CadJobFile } from "@/lib/db";
import { briefRows, isOpenJob } from "@/lib/designers";
import { uploadFile } from "@/lib/storage";
import { confirmBox } from "@/lib/confirm";
import { DESIGNER_SIDE_STATUS, DESIGNER_SIDE_TONE, addDesignFiles, removeDesignFile, submitDesign } from "@/lib/designerWork";

const MAX_MB = 500;
const KIND_ICON = { image: ImageIcon, model: Box, video: Film, file: FileText } as const;
const size = (n?: number) => (n == null ? "" : n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

/**
 * One design, as its designer sees it: the brief (never the client or a
 * price), the reference pictures, their files and what happened. They add
 * files (to their own folder, put on the design by the server), take out
 * their own while it is open, and hand it in for approval.
 */
export function DesignerJobPage() {
  const { jobId } = useParams();
  const db = useDb();
  const { user } = useAuth();
  const job = (db.cadJobs ?? []).find(j => j.id === jobId);
  const designer = (db.designers ?? []).find(d => d.id === user?.designerId);
  const pick = useRef<HTMLInputElement>(null);
  const [up, setUp] = useState<{ name: string; pct: number; n: number; of: number } | null>(null);
  const [handing, setHanding] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState(false);

  if (!job) {
    return <div className="card-luxe p-10 text-center text-sm text-muted-foreground">This design is not here — it may have been taken back. <Link to="/" className="text-primary underline">My designs</Link></div>;
  }
  const open = isOpenJob(job);
  const canWork = open && designer?.active !== false;
  const files = job.files ?? [];
  const images = files.filter(f => f.kind === "image").map(f => f.url);
  const refs = job.brief.references ?? [];
  const lastChange = [...(job.history ?? [])].reverse().find(h => h.text.startsWith("Changes asked"));
  const late = open && job.status !== "submitted" && !!job.dueDate && job.dueDate < todayLocal();

  const addFiles = async (list: FileList | File[] | null) => {
    const chosen = Array.from(list ?? []);
    if (!chosen.length || !canWork || !user?.designerId) return;
    const big = chosen.find(f => f.size > MAX_MB * 1048576);
    if (big) { toast.error(`${big.name} is over ${MAX_MB} MB`); return; }
    if (chosen.length > 20) { toast.error("Add up to 20 files at a time"); return; }
    const done: { name: string; url: string; mime?: string }[] = [];
    try {
      for (let i = 0; i < chosen.length; i++) {
        const f = chosen[i];
        setUp({ name: f.name, pct: 0, n: i + 1, of: chosen.length });
        const url = await uploadFile(f, `cad/by/${user.designerId}/${job.id}`, pct => setUp(u => (u ? { ...u, pct } : u)));
        done.push({ name: f.name, url, mime: f.type || undefined });
      }
      await addDesignFiles(job.id, done);
      toast.success(`${done.length} file${done.length === 1 ? "" : "s"} added`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Not added — try again");
    } finally { setUp(null); if (pick.current) pick.current.value = ""; }
  };

  const remove = async (f: CadJobFile) => {
    if (!(await confirmBox(`Take ${f.name} out of this design?`, { danger: true, confirmText: "Take out" }))) return;
    try { await removeDesignFile(job.id, f.id); toast.success("Taken out"); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Not taken out — try again"); }
  };

  const handIn = async () => {
    setBusy(true);
    try { await submitDesign(job.id, note.trim() || undefined); toast.success("Handed in — the office is told"); setHanding(false); setNote(""); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Not handed in — try again"); }
    finally { setBusy(false); }
  };

  const mayHandIn = canWork && job.status !== "submitted";
  return (
    <div className="space-y-5">
      <PageHeader back={{ label: "My designs", to: "/" }} title={job.orderNumber}
        subtitle={[job.brief.piece, job.dueDate && `due ${fmtDate(job.dueDate)}${late ? " — late" : ""}`].filter(Boolean).join(" · ")}
        primary={mayHandIn ? { label: "Hand in for approval", icon: Send, onClick: () => { if (!files.length) { toast.error("Add the design files first"); return; } setHanding(true); } } : null}
        actions={<CellTag tone={DESIGNER_SIDE_TONE[job.status]}>{DESIGNER_SIDE_STATUS[job.status]}</CellTag>} />

      {job.status === "changes" && lastChange && (
        <div className="flex gap-3 rounded-xl border border-destructive/25 bg-destructive/5 px-4 py-3">
          <MessageSquareWarning className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
          <div className="min-w-0 text-sm">
            <p className="font-medium text-foreground">Changes asked · {fmtDate(lastChange.at)}</p>
            <p className="text-foreground/85 whitespace-pre-wrap break-words">{lastChange.text.replace(/^Changes asked\s*—\s*/, "")}</p>
          </div>
        </div>
      )}
      {job.status === "submitted" && <p className="rounded-xl border border-border/70 bg-secondary/50 px-4 py-3 text-sm text-muted-foreground">Handed in — waiting for the office to approve or ask for changes. You can still add files.</p>}
      {job.status === "approved" && <p className="rounded-xl border border-success/30 bg-success/5 px-4 py-3 text-sm text-success">Approved{job.approvedAt ? ` on ${fmtDate(job.approvedAt)}` : ""} — thank you.</p>}
      {job.status === "cancelled" && <p className="rounded-xl border border-border/70 bg-secondary/50 px-4 py-3 text-sm text-muted-foreground">This design was taken back — nothing more to do on it.</p>}

      <div className="grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-5 items-start">
        <section className="card-luxe p-5 space-y-4 min-w-0">
          <SectionTitle title="The brief" sub="What to design" />
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
            {briefRows(job.brief).filter(([, v]) => !!v).map(([k, v]) => (
              <div key={k} className={k === "Instructions" ? "col-span-2 min-w-0" : "min-w-0"}>
                <dt className="text-xs text-muted-foreground">{k}</dt>
                <dd className="mt-0.5 text-[15px] text-foreground whitespace-pre-wrap break-words">{v}</dd>
              </div>
            ))}
          </dl>
          {refs.length > 0 && (
            <div>
              <p className="text-xs text-muted-foreground mb-2">Reference pictures — tap to open large</p>
              <div className="flex flex-wrap gap-2">
                {refs.map(src => (
                  <img key={src} src={src} alt="Reference" {...zoomable(src, refs)} loading="lazy"
                    className="h-24 w-24 rounded-lg object-contain bg-white ring-1 ring-border/70 cursor-zoom-in" />
                ))}
              </div>
            </div>
          )}
        </section>

        <section className="card-luxe p-5 space-y-4 min-w-0"
          onDragOver={e => { if (canWork) { e.preventDefault(); setDrag(true); } }} onDragLeave={() => setDrag(false)}
          onDrop={e => { e.preventDefault(); setDrag(false); void addFiles(e.dataTransfer.files); }}>
          <div className="flex items-start justify-between gap-3">
            <SectionTitle title="Your files" sub={files.length ? `${files.length} file${files.length === 1 ? "" : "s"}` : "Pictures, the 3D model (.3dm), a video…"} />
            {canWork && (
              <Button type="button" size="sm" variant="outline" className="rounded-lg gap-1.5 shrink-0" disabled={!!up} onClick={() => pick.current?.click()}>
                <Upload className="h-3.5 w-3.5" />Add files
              </Button>
            )}
            <input ref={pick} type="file" multiple hidden onChange={e => void addFiles(e.target.files)} />
          </div>
          {up && (
            <div className="rounded-lg border border-border/70 px-3 py-2 text-xs">
              <p className="flex items-center gap-1.5 text-foreground truncate"><Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" />{up.of > 1 ? `${up.n} of ${up.of} · ` : ""}{up.name}</p>
              <span className="block mt-1.5 h-1 rounded-full bg-secondary overflow-hidden"><span className="block h-full bg-primary transition-[width]" style={{ width: `${up.pct}%` }} /></span>
            </div>
          )}
          {canWork && !files.length && !up && (
            <button type="button" onClick={() => pick.current?.click()}
              className={`w-full rounded-xl border-2 border-dashed px-4 py-8 text-center text-sm transition-colors ${drag ? "border-primary bg-primary/5" : "border-border hover:border-primary/40"}`}>
              <Upload className="mx-auto h-6 w-6 text-muted-foreground mb-2" />
              Drop your files here, or tap to choose
            </button>
          )}
          {files.length > 0 && (
            <ul className="divide-y divide-border/60">
              {files.map(f => {
                const Icon = KIND_ICON[f.kind] ?? FileText;
                const mine = f.uploadedBy === user?.id;
                return (
                  <li key={f.id} className="flex items-center gap-3 py-2.5 min-w-0">
                    {f.kind === "image"
                      ? <img src={f.url} alt="" {...zoomable(f.url, images)} loading="lazy" className="h-12 w-12 rounded-lg object-contain bg-white ring-1 ring-border/70 cursor-zoom-in shrink-0" />
                      : <span className="h-12 w-12 rounded-lg bg-secondary grid place-items-center shrink-0"><Icon className="h-5 w-5 text-muted-foreground" /></span>}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-foreground truncate" title={f.name}>{f.name}</p>
                      <p className="text-xs text-muted-foreground truncate">{[size(f.size), mine ? "you" : f.uploadedByName ?? "the office", fmtDate(f.uploadedAt)].filter(Boolean).join(" · ")}</p>
                    </div>
                    <a href={f.url} target="_blank" rel="noreferrer" download={f.name} aria-label={`Download ${f.name}`} title="Download"
                      className="h-8 w-8 grid place-items-center rounded-lg text-muted-foreground hover:bg-secondary hover:text-foreground shrink-0"><Download className="h-4 w-4" /></a>
                    {canWork && mine && !f.onOrder && (
                      <button type="button" onClick={() => void remove(f)} aria-label={`Take out ${f.name}`} title="Take out"
                        className="h-8 w-8 grid place-items-center rounded-lg text-muted-foreground hover:bg-destructive/10 hover:text-destructive shrink-0"><Trash2 className="h-4 w-4" /></button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>

      {(job.history ?? []).length > 0 && (
        <section className="card-luxe p-5">
          <SectionTitle title="What happened" className="mb-3" />
          <ol className="space-y-2.5">
            {[...(job.history ?? [])].reverse().map((h, i) => (
              <li key={i} className="flex gap-3 text-sm min-w-0">
                <span className="text-xs text-muted-foreground tabular-nums whitespace-nowrap w-24 shrink-0 pt-0.5">{fmtDate(h.at)}</span>
                <span className="min-w-0 break-words text-foreground/90">{h.text}{h.byName ? <span className="text-muted-foreground"> — {h.by === user?.id ? "you" : h.byName}</span> : null}</span>
              </li>
            ))}
          </ol>
        </section>
      )}

      <ActionSheet open={handing} onOpenChange={setHanding} title="Hand in for approval" icon={Send}
        description={`${job.orderNumber} — with ${files.length} file${files.length === 1 ? "" : "s"}. The office is told and will approve it or ask for changes.`}
        footer={
          <div className="flex items-center justify-end gap-2 w-full">
            <Button type="button" variant="outline" className="rounded-xl" onClick={() => setHanding(false)}>Cancel</Button>
            <Button type="button" className="rounded-xl gap-2" disabled={busy} onClick={() => void handIn()}>{busy && <Loader2 className="h-4 w-4 animate-spin" />}Hand in</Button>
          </div>
        }>
        <label className="block text-xs text-muted-foreground mb-1" htmlFor="handin-note">A note for the office · optional</label>
        <Textarea id="handin-note" value={note} onChange={e => setNote(e.target.value)} rows={4} maxLength={500} placeholder="What changed, anything to check…" className="rounded-xl" />
      </ActionSheet>
    </div>
  );
}
