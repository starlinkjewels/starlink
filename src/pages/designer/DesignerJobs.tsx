import { useNavigate } from "react-router-dom";
import { ClipboardList, CheckCircle2, Hourglass, PenTool } from "lucide-react";
import { PageHeader, TabBar } from "@/components/PageHeader";
import { DataTable, CellMain, CellTag, CellDate, type DataColumn } from "@/components/DataTable";
import { StatStrip } from "@/components/TableToolbar";
import { useDb } from "@/hooks/useDb";
import { usePageTab } from "@/hooks/usePageTab";
import { fmtDate, todayLocal, type CadJob } from "@/lib/db";
import { DESIGNER_SIDE_STATUS, DESIGNER_SIDE_TONE } from "@/lib/designerWork";

/** To do: still theirs to work on. Handed in: waiting for our answer. Done: approved (or taken back). */
const GROUP: Record<CadJob["status"], "todo" | "waiting" | "done"> = {
  assigned: "todo", working: "todo", changes: "todo", submitted: "waiting", approved: "done", cancelled: "done",
};

/**
 * A designer's own login — the designs given to them, one list at a time:
 * To do · Handed in · Done. A row opens the design. Only their own jobs are
 * here at all (the database lets them read nothing else).
 */
export function DesignerJobsPage() {
  const db = useDb();
  const nav = useNavigate();
  const [tab, setTab] = usePageTab("designer-jobs", ["todo", "waiting", "done"] as const, "todo");
  const jobs = [...(db.cadJobs ?? [])].sort((a, b) => (b.updatedAt ?? b.createdAt).localeCompare(a.updatedAt ?? a.createdAt));
  const of = (g: "todo" | "waiting" | "done") => jobs.filter(j => GROUP[j.status] === g);
  const today = todayLocal();
  const late = of("todo").filter(j => j.dueDate && j.dueDate < today).length;
  const rows = of(tab);

  const columns: DataColumn<CadJob>[] = [
    { key: "design", header: "Design", always: true, sortValue: j => j.orderNumber,
      cell: j => <CellMain title={j.orderNumber} sub={[j.brief.piece, j.brief.designNo && `#${j.brief.designNo}`].filter(Boolean).join(" · ") || undefined} /> },
    { key: "status", header: "Status", card: "first", sortValue: j => DESIGNER_SIDE_STATUS[j.status],
      cell: j => <CellTag tone={DESIGNER_SIDE_TONE[j.status]}>{DESIGNER_SIDE_STATUS[j.status]}</CellTag> },
    { key: "due", header: "Due", sortValue: j => j.dueDate ?? "",
      cell: j => j.dueDate
        ? <span className={`whitespace-nowrap tabular-nums ${GROUP[j.status] === "todo" && j.dueDate < today ? "text-destructive font-medium" : "text-muted-foreground"}`}>{fmtDate(j.dueDate)}{GROUP[j.status] === "todo" && j.dueDate < today ? " · late" : ""}</span>
        : <span className="text-muted-foreground/60">—</span> },
    { key: "files", header: "Files", align: "right", sortValue: j => (j.files ?? []).length, cell: j => <span className="tabular-nums">{(j.files ?? []).length}</span> },
    { key: "updated", header: "Last change", sortValue: j => j.updatedAt ?? j.createdAt, cell: j => <CellDate>{fmtDate(j.updatedAt ?? j.createdAt)}</CellDate> },
  ];

  return (
    <div className="space-y-5">
      <PageHeader title="My designs" subtitle="The designs given to you — open one for its brief, pictures and your files" />
      <StatStrip items={[
        { label: "To do", value: String(of("todo").length), icon: PenTool, tone: late ? "out" : undefined, sub: late ? `${late} late` : undefined },
        { label: "Handed in", value: String(of("waiting").length), icon: Hourglass, sub: "Waiting for approval" },
        { label: "Approved", value: String(jobs.filter(j => j.status === "approved").length), icon: CheckCircle2 },
      ]} />
      <TabBar label="Designs" value={tab} onChange={setTab} tabs={[
        { key: "todo", label: "To do", icon: PenTool, count: of("todo").length },
        { key: "waiting", label: "Handed in", icon: Hourglass, count: of("waiting").length },
        { key: "done", label: "Done", icon: ClipboardList, count: of("done").length },
      ]} />
      <div className="card-luxe p-3 sm:p-4">
        <DataTable id={`designer-jobs-${tab}`} noun="design" rows={rows} columns={columns} rowKey={j => j.id}
          onRowClick={j => nav(`/design/${j.id}`)} details={false}
          defaultSort={tab === "todo" ? { key: "due", dir: "asc" } : { key: "updated", dir: "desc" }}
          searchText={j => [j.orderNumber, j.brief.piece, j.brief.designNo, j.brief.metal].filter(Boolean).join(" ")}
          searchPlaceholder="Search designs"
          emptyText={tab === "todo" ? "Nothing to do right now — new designs show here." : tab === "waiting" ? "Nothing waiting for approval." : "No finished designs yet."} />
      </div>
    </div>
  );
}
