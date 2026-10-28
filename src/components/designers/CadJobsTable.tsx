import { useState } from "react";
import { Link } from "react-router-dom";
import { FolderOpen } from "lucide-react";
import { fmtDate, type CadJob } from "@/lib/db";
import { useDb } from "@/hooks/useDb";
import { fmtMoneyInr } from "@/lib/manufacturing";
import { KIND_LABEL, STATUS_LABEL, STATUS_TONE, designerOf, isOpenJob, jobPayState } from "@/lib/designers";
import { DataTable, CellMain, CellTag, CellAmount, CellDate, type DataColumn } from "@/components/DataTable";
import { CadJobSheet } from "./CadJobSheet";

/**
 * Design jobs as one table — Design Studio (every designer) and a designer's
 * own page. A row opens the design's folder.
 */
export function CadJobsTable({ id, jobs, showDesigner, exportName, emptyText }: {
  id: string; jobs: CadJob[]; showDesigner?: boolean; exportName: string; emptyText: string;
}) {
  const db = useDb();
  const [open, setOpen] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  // What is still to pay on each approved freelance design (per designer, worked out once).
  const pay = new Map<string, { due: number; paid: number }>();
  for (const x of db.designers ?? []) if (x.kind === "freelance") for (const [k, v] of jobPayState(db, x)) pay.set(k, v);
  const today = new Date().toISOString().slice(0, 10);
  const late = (j: CadJob) => isOpenJob(j) && j.status !== "submitted" && !!j.dueDate && j.dueDate < today;
  const rows = jobs.filter(j => !status || (status === "open" ? isOpenJob(j) : status === "late" ? late(j) : j.status === status));
  const name = (j: CadJob) => designerOf(db, j.designerId)?.name ?? "Designer";

  const cols: DataColumn<CadJob>[] = [
    { key: "date", header: "Given", kind: "date", sortValue: j => +new Date(j.createdAt), csv: j => j.createdAt.slice(0, 10), cell: j => <CellDate>{fmtDate(j.createdAt)}</CellDate> },
    { key: "order", header: "Order", always: true, sortValue: j => j.orderNumber, csv: j => j.orderNumber,
      cell: j => <CellMain title={j.orderNumber} sub={[j.brief.piece, j.brief.designNo && `#${j.brief.designNo}`].filter(Boolean).join(" · ") || undefined} /> },
    ...(showDesigner ? [{ key: "designer", header: "Designer", sortValue: (j: CadJob) => name(j), csv: (j: CadJob) => name(j),
      cell: (j: CadJob) => {
        const x = designerOf(db, j.designerId);
        return x ? <CellMain title={<Link to={`/designers/${x.id}`} onClick={e => e.stopPropagation()} className="hover:underline">{x.name}</Link>} sub={KIND_LABEL[x.kind]} /> : <span>—</span>;
      } } as DataColumn<CadJob>] : []),
    { key: "status", header: "Status", sortValue: j => STATUS_LABEL[j.status], csv: j => STATUS_LABEL[j.status],
      cell: j => <span className="inline-flex items-center gap-1.5"><CellTag tone={STATUS_TONE[j.status]}>{STATUS_LABEL[j.status]}</CellTag>{late(j) && <CellTag tone="red">Late</CellTag>}</span> },
    { key: "due", header: "Due", kind: "date", sortValue: j => (j.dueDate ? +new Date(j.dueDate) : null), csv: j => j.dueDate ?? "",
      cell: j => (j.dueDate ? <CellDate>{fmtDate(j.dueDate)}</CellDate> : <span className="text-muted-foreground/50">—</span>) },
    { key: "files", header: "Files", align: "right", kind: "number", sortValue: j => j.files.length, csv: j => j.files.length,
      cell: j => <span className="tabular-nums">{j.files.length || "—"}</span> },
    { key: "charge", header: "Charge", align: "right", kind: "number", sortValue: j => j.chargeInr ?? j.rate ?? null, csv: j => j.chargeInr ?? "",
      cell: j => (j.status === "approved" ? (j.chargeInr ? <CellAmount>{fmtMoneyInr(j.chargeInr)}</CellAmount> : <span className="text-muted-foreground/60 text-xs">—</span>)
        : j.rate != null && j.status !== "cancelled" ? <span className="text-xs text-muted-foreground tabular-nums whitespace-nowrap">{fmtMoneyInr(j.rate)} agreed</span>
        : <span className="text-muted-foreground/50">—</span>) },
    { key: "topay", header: "To pay", align: "right", kind: "number", sortValue: j => pay.get(j.id)?.due ?? null, csv: j => pay.get(j.id)?.due ?? "",
      cell: j => {
        const p = pay.get(j.id);
        if (!p) return <span className="text-muted-foreground/50">—</span>;
        return p.due > 0.5 ? <CellAmount tone="out">{fmtMoneyInr(p.due)}</CellAmount> : <CellTag tone="green">Paid</CellTag>;
      } },
  ];

  return (
    <>
      <DataTable id={id} noun="design" rows={rows} rowKey={j => j.id} columns={cols}
        defaultSort={{ key: "date", dir: "desc" }}
        searchText={j => [j.orderNumber, j.brief.piece, j.brief.designNo, name(j), STATUS_LABEL[j.status]].filter(Boolean).join(" ")}
        searchPlaceholder="Search designs"
        filters={[{
          kind: "select", label: "Status", value: status, onChange: setStatus, allLabel: "All designs",
          options: [
            { value: "open", label: "In hand" }, { value: "late", label: "Late" },
            ...(["assigned", "working", "submitted", "changes", "approved", "cancelled"] as const).map(s => ({ value: s, label: STATUS_LABEL[s] })),
          ],
        }]}
        onClearFilters={() => setStatus("")}
        onRowClick={j => setOpen(j.id)}
        rowActions={j => [
          { label: "Open design", icon: FolderOpen, onSelect: () => setOpen(j.id) },
        ]}
        details={false}
        totals={{
          charge: list => fmtMoneyInr(list.reduce((s, j) => s + (j.status === "approved" ? j.chargeInr ?? 0 : 0), 0)),
          topay: list => <span className="text-destructive">{fmtMoneyInr(list.reduce((s, j) => s + (pay.get(j.id)?.due ?? 0), 0))}</span>,
        }}
        exportName={exportName}
        emptyText={emptyText} />
      {open && <CadJobSheet jobId={open} onClose={() => setOpen(null)} />}
    </>
  );
}
