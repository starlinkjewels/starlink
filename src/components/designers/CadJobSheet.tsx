import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import {
  PenTool, Upload, Box, FileText, Download, Trash2, CheckCircle2, MessageSquareWarning, Send, Ban, RotateCcw,
  RefreshCw, CalendarDays, History, Eye, X, Loader2,
} from "lucide-react";
import { updateDbAs, uid, fmtDate, worksOnOrder } from "@/lib/db";
import { useCan } from "@/hooks/useCan";
import { useDb } from "@/hooks/useDb";
import { useAuth } from "@/lib/auth";
import { uploadFile, deleteByUrl } from "@/lib/storage";
import { fmtMoneyInr } from "@/lib/manufacturing";
import { confirmBox } from "@/lib/confirm";
import { requestPlayable } from "@/lib/webVideo";
import { downloadAsZip, downloadFile } from "@/lib/zipDownload";
import {
  STATUS_LABEL, STATUS_TONE, KIND_LABEL, designableWhy, addJobFiles, approveJob, askChanges, briefRows, cancelJob, designerEmail, designerOf,
  fileKind, isOpenJob, refreshBrief, removeJobFile, reopenJob, submitJob, updateJobTerms, jobPayState,
} from "@/lib/designers";
import { sendMail, designChangesEmail, designApprovedEmail } from "@/lib/email";
import { ActionSheet } from "@/components/ActionSheet";
import { CellTag } from "@/components/DataTable";
import { MoreMenu, type MoreAction } from "@/components/MoreMenu";
import { WebVideo } from "@/components/ProductVideo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { CadJobFile } from "@/lib/db";

const MAX_MB = 300;
const viewerOf = (url: string) => `https://starlink360.vercel.app/?file=${encodeURIComponent(url)}&embed=true`;
const is3dm = (f: Pick<CadJobFile, "name">) => /\.3dm$/i.test(f.name);

/**
 * One design job, opened: its folder (photos, 3D models, videos, any file —
 * shown as they are, a .3dm in the 3D viewer), the brief, and what can be done
 * next: hand it in, ask for changes, approve (the chosen image and model become
 * the order's CAD, a freelancer's charge is booked), open it again, cancel.
 * The order page, Design Studio and the designer's page all open this one.
 */
export function CadJobSheet({ jobId, onClose }: { jobId: string; onClose: () => void }) {
  const db = useDb();
  const { user } = useAuth();
  const job = (db.cadJobs ?? []).find(j => j.id === jobId);
  const designer = job ? designerOf(db, job.designerId) : undefined;
  const order = job ? db.orders.find(o => o.id === job.orderId) : undefined;
  const can = useCan();
  const staff = user?.role === "admin" || user?.role === "employee";
  // Changing a design is changing the order: admin, or an employee who may edit this order.
  const mayAct = !!user && (user.role === "admin" || (user.role === "employee" && can("orders", "edit") && !!order && worksOnOrder(db, user, order)));
  const who = { id: user?.id ?? "", name: user?.name ?? "" };
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState<{ done: number; total: number; pct: number } | null>(null);
  const [mode, setMode] = useState<"" | "approve" | "changes" | "terms" | "reopen" | "cancel">("");
  const [note, setNote] = useState("");
  const [due, setDue] = useState("");
  const [charge, setCharge] = useState("");
  const [cadImage, setCadImage] = useState("");
  const [model, setModel] = useState("");
  const [viewing, setViewing] = useState<string | null>(null);

  if (!job) return null;
  const open = isOpenJob(job);
  const images = job.files.filter(f => f.kind === "image");
  // The order's 3D view (View 360°) reads a Rhino .3dm only.
  const models = job.files.filter(f => f.kind === "model" && is3dm(f));
  const freelance = designer?.kind === "freelance";
  const pay = freelance && designer && job.status === "approved" ? jobPayState(db, designer).get(job.id) : undefined;

  const run = (summary: string, fn: Parameters<typeof updateDbAs>[1], done?: string) => {
    let err: string | undefined;
    updateDbAs({ summary }, d => { const r = (fn as (d: typeof db) => unknown)(d); if (typeof r === "string") err = r; });
    if (err) { toast.error(err); return false; }
    if (done) toast.success(done);
    return true;
  };
  const mailTo = designer ? designerEmail(db, designer) : undefined;
  const mailInfo = () => ({ designerName: designer?.name ?? "", orderNumber: job.orderNumber, brief: briefRows(job.brief), dueDate: job.dueDate });

  const pickFiles = async (list: FileList | null) => {
    const files = Array.from(list ?? []);
    if (!files.length) return;
    const big = files.filter(f => f.size > MAX_MB * 1024 * 1024);
    if (big.length) { toast.error(`${big.map(f => f.name).join(", ")} — over ${MAX_MB} MB`); return; }
    setUploading({ done: 0, total: files.length, pct: 0 });
    const made: CadJobFile[] = [];
    try {
      for (const f of files) {
        const url = await uploadFile(f, `cad/${job.id}`, pct => setUploading(u => (u ? { ...u, pct } : u)));
        const kind = fileKind(f.name, f.type);
        made.push({ id: uid("cf_"), name: f.name, url, kind, size: f.size, uploadedBy: who.id, uploadedByName: who.name, uploadedAt: new Date().toISOString() });
        if (kind === "video") requestPlayable(url);
        setUploading(u => (u ? { ...u, done: u.done + 1, pct: 0 } : u));
      }
    } catch {
      toast.error("An upload failed — the files before it are kept");
    } finally {
      if (made.length) run(`Design ${job.orderNumber}: ${made.length} file${made.length === 1 ? "" : "s"} added`, d => addJobFiles(d, job.id, made, who, !staff), `${made.length} file${made.length === 1 ? "" : "s"} added`);
      setUploading(null);
    }
  };

  const removeFile = async (f: CadJobFile) => {
    if (!(await confirmBox(`Remove ${f.name} from this design?`, { danger: true, confirmText: "Remove" }))) return;
    let url: string | undefined;
    const ok = run(`Design ${job.orderNumber}: removed ${f.name}`, d => { const r = removeJobFile(d, job.id, f.id, who); if (r.error) return r.error; url = r.url; return undefined; });
    if (ok && url) void deleteByUrl(url);
  };

  const startApprove = () => {
    setMode("approve");
    setCharge(freelance ? String(job.rate ?? designer?.ratePerDesign ?? "") : "");
    // An order that already shows a CAD keeps it unless another is chosen.
    setCadImage(order?.cadImage ? "" : images[images.length - 1]?.url ?? "");
    setModel(order?.cad3dmUrl ? "" : models[0]?.url ?? "");
  };
  const doApprove = () => {
    const c = freelance ? Number(charge) : 0;
    if (freelance && (charge.trim() === "" || !(c >= 0))) { toast.error("Enter the charge for this design — 0 if there is none"); return; }
    const ok = run(`Design ${job.orderNumber} approved`, d => approveJob(d, job.id, { chargeInr: c, cadImageUrl: cadImage || undefined, modelUrl: model || undefined, by: who }), "Design approved");
    if (ok) {
      if (mailTo) { const m = designApprovedEmail({ ...mailInfo(), chargeText: freelance && c > 0 ? fmtMoneyInr(c) : undefined }); void sendMail(mailTo, m.subject, m.html); }
      setMode("");
    }
  };
  const doChanges = () => {
    if (!note.trim()) { toast.error("Say what to change"); return; }
    const ok = run(`Design ${job.orderNumber}: changes asked`, d => askChanges(d, job.id, note, who, due || undefined), "Changes asked — the designer is told");
    if (ok) {
      if (mailTo) { const m = designChangesEmail({ ...mailInfo(), note: note.trim(), dueDate: due || job.dueDate }); void sendMail(mailTo, m.subject, m.html); }
      setMode(""); setNote(""); setDue("");
    }
  };
  const doReopen = () => {
    const ok = run(`Design ${job.orderNumber} opened again`, d => reopenJob(d, job.id, note, who), "Opened again — the charge comes off until it is approved again");
    if (ok) {
      if (mailTo && note.trim()) { const m = designChangesEmail({ ...mailInfo(), note: note.trim() }); void sendMail(mailTo, m.subject, m.html); }
      setMode(""); setNote("");
    }
  };
  const doCancel = () => {
    if (run(`Design ${job.orderNumber} cancelled`, d => cancelJob(d, job.id, who, note), "Design cancelled")) { setMode(""); setNote(""); }
  };
  const doTerms = () => {
    const r = charge.trim() === "" ? undefined : Number(charge);
    if (r !== undefined && !(r >= 0)) { toast.error("Enter a charge of 0 or more"); return; }
    if (run(`Design ${job.orderNumber}: terms changed`, d => updateJobTerms(d, job.id, { rate: r, dueDate: due }, who), "Saved")) setMode("");
  };
  const downloadAll = async () => {
    if (!job.files.length) return;
    const t = toast.loading("Preparing the files…");
    const r = await downloadAsZip(job.files.map(f => ({ url: f.url, filename: f.name })), `Design-${job.orderNumber}`);
    if (!r.added) toast.error("Couldn't download the files", { id: t });
    else toast.success(`${r.added} file${r.added === 1 ? "" : "s"} downloaded${r.failed.length ? ` — ${r.failed.length} couldn't be fetched` : ""}`, { id: t });
  };

  const menu: MoreAction[] = [
    { label: "Download all files", icon: Download, disabled: !job.files.length, onSelect: () => void downloadAll() },
    { label: "Change charge or due date", icon: CalendarDays, show: mayAct && open, onSelect: () => { setMode("terms"); setCharge(job.rate != null ? String(job.rate) : ""); setDue(job.dueDate ?? ""); } },
    { label: "Bring the brief up to date", icon: RefreshCw, show: mayAct && open, hint: "Copy the order's details again", onSelect: () => run(`Design ${job.orderNumber}: brief refreshed`, d => refreshBrief(d, job.id, who), "Brief brought up to date") },
    { label: "Open again", icon: RotateCcw, show: mayAct && job.status === "approved", hint: "Ask for changes on an approved design", onSelect: () => { setMode("reopen"); setNote(""); } },
    { label: "Cancel this design", icon: Ban, danger: true, show: mayAct && open, onSelect: () => { setMode("cancel"); setNote(""); } },
  ];

  const tile = (f: CadJobFile) => (
    <div key={f.id} className="group relative rounded-xl border border-border/70 bg-white overflow-hidden">
      {f.kind === "image" ? (
        <a href={f.url} target="_blank" rel="noopener noreferrer" className="block aspect-square bg-secondary/40">
          <img src={f.url} alt={f.name} loading="lazy" className="h-full w-full object-cover" />
        </a>
      ) : f.kind === "video" ? (
        <div className="aspect-square bg-black"><WebVideo src={f.url} controls muted playsInline preload="metadata" className="h-full w-full object-contain" /></div>
      ) : (
        <button type="button" onClick={() => (is3dm(f) ? setViewing(f.url) : void downloadFile(f.url, f.name))}
          className="aspect-square w-full grid place-items-center bg-gradient-to-br from-primary/[0.06] to-secondary/60 text-primary">
          <span className="grid place-items-center gap-1.5">
            {f.kind === "model" ? <Box className="h-8 w-8" /> : <FileText className="h-8 w-8" />}
            <span className="text-[11px] font-semibold">{is3dm(f) ? "View 3D" : f.kind === "model" ? "3D file" : "File"}</span>
          </span>
        </button>
      )}
      <div className="flex items-center gap-1 px-2 py-1.5 border-t border-border/60">
        <p className="min-w-0 flex-1 truncate text-[11px] text-foreground" title={f.name}>{f.name}</p>
        {(order?.cadImage === f.url || order?.cad3dmUrl === f.url) && <span className="shrink-0 text-[9px] font-bold uppercase tracking-wide text-success">On order</span>}
        <MoreMenu size="sm" label={`${f.name} actions`} actions={[
          { label: is3dm(f) ? "View in 3D" : "Open", icon: Eye, onSelect: () => (is3dm(f) ? setViewing(f.url) : window.open(f.url, "_blank", "noopener")) },
          { label: "Download", icon: Download, onSelect: () => void downloadFile(f.url, f.name) },
          { label: "Remove", icon: Trash2, danger: true, show: mayAct, disabled: job.status === "cancelled", onSelect: () => void removeFile(f) },
        ]} />
      </div>
    </div>
  );

  const rows = briefRows(job.brief).filter(([, v]) => v);
  const facts: [string, React.ReactNode][] = [
    ["Designer", designer ? <Link to={`/designers/${designer.id}`} className="text-primary hover:underline">{designer.name} · {KIND_LABEL[designer.kind]}</Link> : "—"],
    ["Due", job.dueDate ? fmtDate(job.dueDate) : "—"],
    ...(freelance ? [["Charge", job.status === "approved" ? fmtMoneyInr(job.chargeInr ?? 0) + (pay ? (pay.due > 0.5 ? ` · ${fmtMoneyInr(pay.due)} to pay` : " · paid") : "") : job.rate != null ? `${fmtMoneyInr(job.rate)} agreed` : "—"] as [string, React.ReactNode]] : []),
  ];

  return (
    <ActionSheet open onOpenChange={o => { if (!o) onClose(); }} size="xl" icon={PenTool}
      title={`Design ${job.orderNumber}`} description={[job.brief.piece, job.brief.designNo && `#${job.brief.designNo}`].filter(Boolean).join(" · ") || "CAD design"}
      footer={
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <CellTag tone={STATUS_TONE[job.status]}>{STATUS_LABEL[job.status]}</CellTag>
            <span className="text-xs text-muted-foreground truncate">{job.files.length} file{job.files.length === 1 ? "" : "s"}</span>
          </div>
          <div className="flex items-center gap-2">
            <MoreMenu label="More design actions" actions={menu} />
            {mayAct && open && job.status !== "submitted" && (
              <Button variant="outline" className="rounded-xl h-10 gap-1.5" disabled={!job.files.length}
                title={job.files.length ? "Hand the design in for approval" : "Add the design files first"}
                onClick={() => run(`Design ${job.orderNumber} submitted`, d => submitJob(d, job.id, who), "Submitted for approval")}>
                <Send className="h-4 w-4" /> Submit
              </Button>
            )}
            {mayAct && open && <Button variant="outline" className="rounded-xl h-10 gap-1.5" onClick={() => { setMode("changes"); setNote(""); setDue(job.dueDate ?? ""); }}><MessageSquareWarning className="h-4 w-4" /> Ask changes</Button>}
            {mayAct && open && <Button className="btn-hero rounded-xl h-10 gap-1.5" disabled={!job.files.length} onClick={startApprove}><CheckCircle2 className="h-4 w-4" /> Approve</Button>}
          </div>
        </div>
      }>
      <div className="space-y-5">
        {/* Who, when, what it costs */}
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 rounded-xl border border-border/70 bg-secondary/20 p-3">
          {facts.map(([k, v]) => (
            <div key={k} className="min-w-0">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{k}</p>
              <p className="text-sm font-medium text-foreground truncate">{v}</p>
            </div>
          ))}
        </div>

        {/* The order went away under an open design */}
        {open && mayAct && order && designableWhy(order) && (
          <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            {designableWhy(order)} — cancel this design so the designer stops working on it.
          </p>
        )}

        {/* A decision being made */}
        {mode && (
          <div className="rounded-xl border border-primary/30 bg-primary/[0.04] p-3 space-y-3">
            {mode === "approve" && (<>
              <p className="text-sm font-semibold text-brand-dark">Approve this design</p>
              {images.length > 0 && (
                <div>
                  <Label className="text-xs">The order's CAD picture</Label>
                  <div className="mt-1 flex gap-2 overflow-x-auto pb-1">
                    {order?.cadImage && (
                      <button type="button" onClick={() => setCadImage("")} aria-pressed={cadImage === ""} title="Keep the order's current CAD picture"
                        className={`relative h-16 w-16 shrink-0 rounded-lg overflow-hidden border-2 ${cadImage === "" ? "border-primary" : "border-transparent opacity-70"}`}>
                        <img src={order.cadImage} alt="Current CAD" className="h-full w-full object-cover" />
                        <span className="absolute inset-x-0 bottom-0 bg-black/60 text-[9px] font-semibold text-white text-center">Keep</span>
                      </button>
                    )}
                    {images.map(f => (
                      <button key={f.id} type="button" onClick={() => setCadImage(f.url)} aria-pressed={cadImage === f.url}
                        className={`h-16 w-16 shrink-0 rounded-lg overflow-hidden border-2 ${cadImage === f.url ? "border-primary" : "border-transparent opacity-70"}`}>
                        <img src={f.url} alt={f.name} className="h-full w-full object-cover" />
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {models.length > 0 && (
                <div>
                  <Label className="text-xs">The order's 3D model</Label>
                  <select value={model} onChange={e => setModel(e.target.value)} className="mt-1 h-10 w-full rounded-xl border border-border bg-white px-3 text-sm" aria-label="3D model">
                    <option value="">{order?.cad3dmUrl ? "Keep the order's current model" : "None"}</option>
                    {models.map(f => <option key={f.id} value={f.url}>{f.name}</option>)}
                  </select>
                </div>
              )}
              {freelance && (
                <div className="max-w-xs">
                  <Label className="text-xs">Charge for this design (₹)</Label>
                  <Input type="number" min={0} step="1" value={charge} onChange={e => setCharge(e.target.value)} className="h-10 rounded-xl mt-1" aria-label="Charge" />
                  <p className="text-[11px] text-muted-foreground mt-1">Owed to {designer?.name} from today; it shows in the order's cost.</p>
                </div>
              )}
              <div className="flex justify-end gap-2">
                <Button variant="ghost" className="rounded-xl" onClick={() => setMode("")}>Back</Button>
                <Button className="btn-hero rounded-xl" onClick={doApprove}>Approve</Button>
              </div>
            </>)}
            {(mode === "changes" || mode === "reopen" || mode === "cancel") && (<>
              <p className="text-sm font-semibold text-brand-dark">{mode === "changes" ? "What should change?" : mode === "reopen" ? "Open the approved design again" : "Cancel this design"}</p>
              <Textarea value={note} onChange={e => setNote(e.target.value)} rows={3} className="rounded-xl" aria-label="Note"
                placeholder={mode === "changes" ? "e.g. Make the shank thinner; side stones 2.0 mm" : mode === "reopen" ? "What to change (the designer is told)" : "Why (optional — the designer is told)"} />
              {mode === "changes" && (
                <div className="max-w-xs">
                  <Label className="text-xs">New due date</Label>
                  <Input type="date" value={due} onChange={e => setDue(e.target.value)} className="h-10 rounded-xl mt-1" aria-label="Due date" />
                </div>
              )}
              {mode === "reopen" && freelance && <p className="text-[11px] text-muted-foreground">The charge for it comes off until it is approved again.</p>}
              <div className="flex justify-end gap-2">
                <Button variant="ghost" className="rounded-xl" onClick={() => setMode("")}>Back</Button>
                <Button className={mode === "cancel" ? "rounded-xl bg-destructive text-destructive-foreground hover:bg-destructive/90" : "btn-hero rounded-xl"}
                  onClick={mode === "changes" ? doChanges : mode === "reopen" ? doReopen : doCancel}>
                  {mode === "changes" ? "Ask for changes" : mode === "reopen" ? "Open again" : "Cancel design"}
                </Button>
              </div>
            </>)}
            {mode === "terms" && (<>
              <p className="text-sm font-semibold text-brand-dark">Charge and due date</p>
              <div className="grid grid-cols-2 gap-3 max-w-md">
                {freelance && (
                  <div>
                    <Label className="text-xs">Agreed charge (₹)</Label>
                    <Input type="number" min={0} step="1" value={charge} onChange={e => setCharge(e.target.value)} className="h-10 rounded-xl mt-1" aria-label="Agreed charge" />
                  </div>
                )}
                <div>
                  <Label className="text-xs">Due date</Label>
                  <Input type="date" value={due} onChange={e => setDue(e.target.value)} className="h-10 rounded-xl mt-1" aria-label="Due date" />
                </div>
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="ghost" className="rounded-xl" onClick={() => setMode("")}>Back</Button>
                <Button className="btn-hero rounded-xl" onClick={doTerms}>Save</Button>
              </div>
            </>)}
          </div>
        )}

        {/* The folder */}
        <section className="space-y-2.5">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-semibold text-brand-dark">Files</p>
            {mayAct && job.status !== "cancelled" && (
              <>
                <input ref={fileRef} type="file" multiple className="hidden" aria-label="Add design files" onChange={e => { void pickFiles(e.target.files); e.target.value = ""; }} />
                <Button variant="outline" size="sm" className="rounded-xl h-9 gap-1.5" disabled={!!uploading} onClick={() => fileRef.current?.click()}>
                  {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                  {uploading ? `Uploading ${uploading.done + 1} of ${uploading.total}${uploading.pct ? ` · ${uploading.pct}%` : ""}` : "Add files"}
                </Button>
              </>
            )}
          </div>
          {job.files.length ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2.5">{[...job.files].reverse().map(tile)}</div>
          ) : (
            <button type="button" disabled={!mayAct || job.status === "cancelled"} onClick={() => fileRef.current?.click()}
              className="w-full rounded-xl border-2 border-dashed border-border px-4 py-10 text-center text-sm text-muted-foreground hover:border-primary/40 hover:bg-primary/[0.03]">
              <Upload className="h-6 w-6 mx-auto mb-2 text-primary/70" />
              No files yet — the designer's renders, 3D models (.3dm) and videos go here, and show on the order.
            </button>
          )}
        </section>

        {/* The brief */}
        <section className="space-y-2">
          <p className="text-sm font-semibold text-brand-dark">Brief</p>
          <dl className="rounded-xl border border-border/70 divide-y divide-border/60">
            {rows.map(([k, v]) => (
              <div key={k} className="grid grid-cols-[8rem_1fr] gap-3 px-3 py-2">
                <dt className="text-xs text-muted-foreground">{k}</dt>
                <dd className="text-sm text-foreground whitespace-pre-line">{v}</dd>
              </div>
            ))}
            {!rows.length && <p className="px-3 py-3 text-sm text-muted-foreground">Nothing written yet.</p>}
          </dl>
          {(job.brief.references ?? []).length > 0 && (
            <div className="flex gap-2 overflow-x-auto pb-1">
              {job.brief.references!.map(u => (
                <a key={u} href={u} target="_blank" rel="noopener noreferrer" className="h-20 w-20 shrink-0 rounded-lg overflow-hidden border border-border/70">
                  <img src={u} alt="Reference" className="h-full w-full object-cover" loading="lazy" />
                </a>
              ))}
            </div>
          )}
          {order && staff && <Link to={`/orders/${order.id}`} className="inline-block text-xs text-primary hover:underline">Open order {order.orderNumber}</Link>}
        </section>

        {/* What happened */}
        <section className="space-y-2">
          <p className="text-sm font-semibold text-brand-dark inline-flex items-center gap-1.5"><History className="h-4 w-4 text-muted-foreground" /> History</p>
          <ol className="space-y-1.5">
            {[...job.history].reverse().map((h, i) => (
              <li key={i} className="flex gap-3 text-xs">
                <span className="w-28 shrink-0 text-muted-foreground tabular-nums">{fmtDate(h.at)}</span>
                <span className="min-w-0 text-foreground">{h.text}{h.byName ? <span className="text-muted-foreground"> · {h.byName}</span> : null}</span>
              </li>
            ))}
          </ol>
        </section>
      </div>

      {/* A .3dm in the 3D viewer, full screen */}
      {viewing && (
        <div className="fixed inset-0 z-[60] bg-black/75 flex flex-col p-2 sm:p-4" onClick={() => setViewing(null)}>
          <div className="flex items-center justify-between px-2 pb-2 shrink-0">
            <p className="text-white text-sm font-medium">3D view — {job.orderNumber}</p>
            <button onClick={() => setViewing(null)} className="h-9 w-9 rounded-full bg-white/20 hover:bg-white/30 text-white grid place-items-center" aria-label="Close"><X className="h-4 w-4" /></button>
          </div>
          <div className="flex-1 min-h-0 rounded-2xl overflow-hidden bg-white" onClick={e => e.stopPropagation()}>
            <iframe src={viewerOf(viewing)} title="3D model" className="w-full h-full border-0" allow="fullscreen" />
          </div>
        </div>
      )}
    </ActionSheet>
  );
}
