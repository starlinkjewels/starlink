import { useState } from "react";
import { Link } from "react-router-dom";
import { PenTool, FolderOpen, ArrowRightLeft, Box, FileText, Film, UserPlus } from "lucide-react";
import { fmtDate, type Order } from "@/lib/db";
import { useDb } from "@/hooks/useDb";
import { KIND_LABEL, STATUS_LABEL, STATUS_TONE, designableWhy, designerOf, isOpenJob, jobsOfOrder } from "@/lib/designers";
import { CellTag } from "@/components/DataTable";
import { MoreMenu } from "@/components/MoreMenu";
import { Button } from "@/components/ui/button";
import { AssignDesignerSheet } from "./AssignDesigner";
import { CadJobSheet } from "./CadJobSheet";

/**
 * The order's CAD designer, inside its CAD Design card (staff only): who has
 * the design, where it stands, and the files as they come in — a tap opens
 * the design's folder. Approving there puts the chosen picture and 3D model
 * on this order.
 */
export function OrderDesignBlock({ order, canAssign }: { order: Order; canAssign: boolean }) {
  const db = useDb();
  const [assigning, setAssigning] = useState(false);
  const [openJob, setOpenJob] = useState<string | null>(null);
  const jobs = jobsOfOrder(db, order.id);
  const job = jobs.find(isOpenJob) ?? jobs.find(j => j.status === "approved");
  const earlier = jobs.filter(j => j !== job);
  const designer = job ? designerOf(db, job.designerId) : undefined;
  const why = designableWhy(order);
  if (why && !jobs.length) return null;

  const thumbs = (job?.files ?? []).slice(-6).reverse();
  return (
    <div className="rounded-xl border border-border/70 bg-secondary/20 p-3 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2.5 min-w-0">
          <span className="h-9 w-9 shrink-0 rounded-lg bg-primary/10 text-primary grid place-items-center"><PenTool className="h-4 w-4" /></span>
          <div className="min-w-0">
            {job && designer ? (
              <>
                <p className="text-sm font-semibold text-brand-dark truncate">
                  <Link to={`/designers/${designer.id}`} className="hover:underline">{designer.name}</Link>
                  <span className="font-normal text-muted-foreground"> · {KIND_LABEL[designer.kind]}</span>
                </p>
                <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                  <CellTag tone={STATUS_TONE[job.status]}>{STATUS_LABEL[job.status]}</CellTag>
                  {job.dueDate && isOpenJob(job) && <span>due {fmtDate(job.dueDate)}</span>}
                  <span>· {job.files.length} file{job.files.length === 1 ? "" : "s"}</span>
                </p>
              </>
            ) : (
              <>
                <p className="text-sm font-semibold text-brand-dark">No CAD designer yet</p>
                <p className="text-xs text-muted-foreground">Give the design to one of ours or a freelancer — their files show here.</p>
              </>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {job ? (
            <Button variant="outline" className="h-9 rounded-xl gap-1.5" onClick={() => setOpenJob(job.id)}>
              <FolderOpen className="h-4 w-4" /><span className="max-sm:hidden">Open design</span>
            </Button>
          ) : canAssign && !why ? (
            <Button variant="outline" className="h-9 rounded-xl gap-1.5" onClick={() => setAssigning(true)}>
              <UserPlus className="h-4 w-4" /> Give design
            </Button>
          ) : null}
          {(canAssign && !why && job) || earlier.length ? (
            <MoreMenu size="sm" label="More designer actions" actions={[
              { label: job && isOpenJob(job) ? "Move to another designer" : "Give a new design", icon: ArrowRightLeft, show: canAssign && !why, onSelect: () => setAssigning(true) },
              ...earlier.map(j => ({
                label: `${designerOf(db, j.designerId)?.name ?? "Designer"} — ${STATUS_LABEL[j.status].toLowerCase()}`,
                hint: fmtDate(j.createdAt), icon: FolderOpen, onSelect: () => setOpenJob(j.id),
              })),
            ]} />
          ) : null}
        </div>
      </div>

      {thumbs.length > 0 && (
        <button type="button" onClick={() => setOpenJob(job!.id)} className="flex gap-2 overflow-x-auto pb-0.5 w-full text-left" aria-label="Open the design's files">
          {thumbs.map(f => (
            <span key={f.id} className="h-16 w-16 shrink-0 rounded-lg overflow-hidden border border-border/70 bg-white grid place-items-center" title={f.name}>
              {f.kind === "image" ? <img src={f.url} alt={f.name} loading="lazy" className="h-full w-full object-cover" />
                : f.kind === "model" ? <Box className="h-6 w-6 text-primary" />
                : f.kind === "video" ? <Film className="h-6 w-6 text-primary" />
                : <FileText className="h-6 w-6 text-muted-foreground" />}
            </span>
          ))}
        </button>
      )}

      {assigning && <AssignDesignerSheet orderId={order.id} onClose={() => setAssigning(false)} />}
      {openJob && <CadJobSheet jobId={openJob} onClose={() => setOpenJob(null)} />}
    </div>
  );
}
