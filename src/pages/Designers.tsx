import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Plus, PenTool, Pencil, Power, Trash2, Wallet, Eye, FolderOpen, CheckCircle2, IndianRupee } from "lucide-react";
import { updateDbAs, loadDb, type Designer } from "@/lib/db";
import { recordsReady, STILL_LOADING } from "@/lib/actionHints";
import { useDb } from "@/hooks/useDb";
import { useAuth } from "@/lib/auth";
import { useCan } from "@/hooks/useCan";
import { fmtMoneyInr } from "@/lib/manufacturing";
import { confirmBox } from "@/lib/confirm";
import { KIND_LABEL, designerAccount, designerDeleteWhy, designerEmail, isOpenJob, jobsOfDesigner } from "@/lib/designers";
import { PageHeader } from "@/components/PageHeader";
import { StatStrip } from "@/components/TableToolbar";
import { DataTable, CellMain, CellTag, CellAmount, type DataColumn } from "@/components/DataTable";
import { type MoreAction } from "@/components/MoreMenu";
import { DesignerCreateDialog } from "@/components/create/DesignerCreateDialog";
import { PayDesignerSheet } from "@/components/PayDesignerSheet";

/**
 * Designers — the CAD designers we give work to: our own (in-house, on salary)
 * and freelancers (paid per design). What each has in hand and has done, and
 * what we owe the freelancers.
 */
export function DesignersPage() {
  const db = useDb();
  const { user } = useAuth();
  const can = useCan();
  const navigate = useNavigate();
  const isAdmin = user?.role === "admin";
  const mayPay = isAdmin || can("payments", "add");
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Designer | null>(null);
  const [paying, setPaying] = useState<Designer | null>(null);

  const month = new Date().toISOString().slice(0, 7);
  const all = db.designers ?? [];
  const stats = new Map(all.map(x => {
    const jobs = jobsOfDesigner(db, x.id);
    return [x.id, {
      open: jobs.filter(isOpenJob).length,
      approved: jobs.filter(j => j.status === "approved").length,
      thisMonth: jobs.filter(j => j.status === "approved" && (j.approvedAt ?? "").startsWith(month)).length,
      acc: x.kind === "freelance" ? designerAccount(db, x) : null,
    }];
  }));
  const st = (x: Designer) => stats.get(x.id)!;
  const owed = all.reduce((s, x) => s + (st(x).acc?.due ?? 0), 0);

  const toggleActive = (x: Designer) => updateDbAs({ summary: `Designer ${x.name} ${x.active === false ? "switched on" : "switched off"}` }, d => {
    const y = (d.designers ?? []).find(z => z.id === x.id); if (y) y.active = y.active === false;
  });
  const remove = async (x: Designer) => {
    // Their designs and payments must have arrived — not loaded yet would read as "none".
    if (!(await recordsReady(["cadJobs", "lockerTransactions"]))) { toast.error(STILL_LOADING); return; }
    const why = designerDeleteWhy(loadDb(), x);
    if (why) { toast.error(why); return; }
    if (!(await confirmBox(`Delete ${x.name}?\n\nThey have no designs and no payments, so nothing else changes.`, { danger: true, confirmText: "Delete" }))) return;
    let refused: string | undefined;
    updateDbAs({ summary: `Designer ${x.name} deleted` }, d => {
      const y = (d.designers ?? []).find(z => z.id === x.id);
      refused = y ? designerDeleteWhy(d, y) : undefined;
      if (!refused) d.designers = (d.designers ?? []).filter(z => z.id !== x.id);
    });
    if (refused) toast.error(refused); else toast.success(`${x.name} deleted`);
  };
  const actionsFor = (x: Designer): MoreAction[] => [
    { label: "View", icon: Eye, onSelect: () => navigate(`/designers/${x.id}`) },
    { label: "Edit", icon: Pencil, disabled: !isAdmin, hint: isAdmin ? undefined : "Admin only", onSelect: () => setEditing(x) },
    { label: "Pay", icon: Wallet, show: x.kind === "freelance", disabled: !mayPay, hint: mayPay ? "From an account" : "You can't record payments", onSelect: () => setPaying(x) },
    { label: x.active === false ? "Switch on" : "Switch off", icon: Power, disabled: !isAdmin, hint: x.active === false ? "Can be given designs again" : "Kept with their history; not offered for new designs", onSelect: () => toggleActive(x) },
    { label: "Delete", icon: Trash2, danger: true, disabled: !isAdmin || !!designerDeleteWhy(db, x), hint: !isAdmin ? "Admin only" : designerDeleteWhy(db, x), onSelect: () => void remove(x) },
  ];

  const columns: DataColumn<Designer>[] = [
    { key: "name", header: "Designer", always: true, sortValue: x => x.name, csv: x => x.name,
      cell: x => <CellMain title={<>{x.name}{x.active === false && <span className="ml-2 align-middle"><CellTag>Off</CellTag></span>}</>} sub={designerEmail(db, x) || x.phone || undefined} /> },
    { key: "kind", header: "Kind", sortValue: x => x.kind, csv: x => KIND_LABEL[x.kind],
      cell: x => <CellTag tone={x.kind === "inhouse" ? "blue" : "violet"}>{KIND_LABEL[x.kind]}</CellTag> },
    { key: "rate", header: "Per design", align: "right", kind: "number", sortValue: x => x.ratePerDesign ?? null, csv: x => x.ratePerDesign ?? "",
      cell: x => (x.kind === "freelance" && x.ratePerDesign ? <span className="tabular-nums whitespace-nowrap">{fmtMoneyInr(x.ratePerDesign)}</span> : <span className="text-muted-foreground/60 text-xs">{x.kind === "inhouse" ? "Salary" : "—"}</span>) },
    { key: "open", header: "In hand", align: "right", kind: "number", sortValue: x => st(x).open, csv: x => st(x).open,
      cell: x => <span className="tabular-nums font-medium">{st(x).open || "—"}</span> },
    { key: "month", header: "Approved this month", align: "right", kind: "number", sortValue: x => st(x).thisMonth, csv: x => st(x).thisMonth,
      cell: x => <span className="tabular-nums">{st(x).thisMonth || "—"}</span> },
    { key: "approved", header: "Approved", align: "right", kind: "number", sortValue: x => st(x).approved, csv: x => st(x).approved,
      cell: x => <span className="tabular-nums">{st(x).approved || "—"}</span> },
    { key: "due", card: "figure" as const, header: "To pay", align: "right", kind: "number", sortValue: x => st(x).acc?.due ?? null, csv: x => st(x).acc?.due ?? "",
      cell: x => {
        const a = st(x).acc;
        if (!a) return <span className="text-muted-foreground/60 text-xs">—</span>;
        if (a.due > 0.5) return <CellAmount tone="out">{fmtMoneyInr(a.due)}</CellAmount>;
        if (a.advance > 0.5) return <span className="text-blue-600 text-xs font-medium whitespace-nowrap">+{fmtMoneyInr(a.advance)} ahead</span>;
        return <span className="text-success text-xs font-semibold">Clear</span>;
      } },
  ];

  return (
    <div className="space-y-5">
      <PageHeader title="Designers" subtitle="CAD designers — our own and freelancers"
        primary={isAdmin ? { label: "Add Designer", icon: Plus, onClick: () => setAdding(true) } : null} />
      <StatStrip items={[
        { label: "Designers", value: String(all.filter(x => x.active !== false).length), icon: PenTool,
          sub: `${all.filter(x => x.kind === "inhouse" && x.active !== false).length} in-house · ${all.filter(x => x.kind === "freelance" && x.active !== false).length} freelance` },
        { label: "Designs in hand", value: String((db.cadJobs ?? []).filter(isOpenJob).length), icon: FolderOpen,
          sub: `${(db.cadJobs ?? []).filter(j => j.status === "submitted").length} waiting for approval` },
        { label: "Approved this month", value: String((db.cadJobs ?? []).filter(j => j.status === "approved" && (j.approvedAt ?? "").startsWith(month)).length), icon: CheckCircle2 },
        { label: "To pay freelancers", value: fmtMoneyInr(owed), icon: IndianRupee, tone: owed > 0.5 ? "out" as const : undefined },
      ]} />
      <div className="card-luxe p-3 sm:p-4">
        <DataTable
          id="designers"
          noun="designer"
          rows={all}
          columns={columns}
          rowKey={x => x.id}
          searchText={x => [x.name, x.email, x.phone, KIND_LABEL[x.kind], x.notes].filter(Boolean).join(" ")}
          searchPlaceholder="Search designers"
          defaultSort={{ key: "open", dir: "desc" }}
          rowHref={x => `/designers/${x.id}`}
          details={false}
          rowActions={actionsFor}
          exportName="Designers"
          emptyText="No designers yet."
          emptyAction={isAdmin && !all.length ? { label: "Add a designer", onClick: () => setAdding(true) } : undefined}
        />
      </div>
      {isAdmin && <DesignerCreateDialog open={adding} onOpenChange={setAdding} onCreated={id => navigate(`/designers/${id}`)} />}
      {isAdmin && editing && <DesignerCreateDialog open onOpenChange={o => { if (!o) setEditing(null); }} designer={editing} />}
      {paying && <PayDesignerSheet designerId={paying.id} onClose={() => setPaying(null)} />}
    </div>
  );
}
