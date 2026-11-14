import { useNavigate } from "react-router-dom";
import { ExternalLink, Printer } from "lucide-react";
import { useDb } from "@/hooks/useDb";
import { fmtDate } from "@/lib/db";
import { atFactoryNow, printJobCard, type AtFactory } from "@/lib/factoryWip";
import { pieceLine } from "@/lib/orderText";
import { DataTable, CellDate, CellMain, CellTag, type DataColumn } from "@/components/DataTable";
import { StatStrip } from "@/components/TableToolbar";
import type { MoreAction } from "@/components/MoreMenu";

/**
 * Factory → At the factory now: the orders it is making that are not back yet (lib/factoryWip.ts) —
 * the stage, since when, how long, late against the delivery date, the material given — and the
 * job card to print for each.
 */
export function FactoryAtNow({ factoryId, rows }: { factoryId: string; rows: AtFactory[] }) {
  const db = useDb();
  const navigate = useNavigate();
  const late = rows.filter(r => r.late > 0).length;
  const columns: DataColumn<AtFactory>[] = [
    { key: "order", header: "Order", always: true, sortValue: r => r.order.orderNumber, csv: r => r.order.orderNumber,
      cell: r => <CellMain title={<span className="font-mono text-primary">{r.order.orderNumber}</span>} sub={pieceLine(r.order)} /> },
    { key: "stage", header: "Stage", sortValue: r => r.stage, csv: r => r.stage, cell: r => <CellTag tone="blue">{r.stage}</CellTag> },
    { key: "since", header: "With them since", kind: "date", sortValue: r => +new Date(r.since), csv: r => fmtDate(r.since), cell: r => <CellDate>{fmtDate(r.since)}</CellDate> },
    { key: "days", header: "Days", align: "right", kind: "number", sortValue: r => r.days, csv: r => r.days, cell: r => <span className="tabular-nums">{r.days}</span> },
    { key: "due", header: "Delivery", kind: "date", sortValue: r => (r.order.expectedDelivery ? +new Date(r.order.expectedDelivery) : null), csv: r => (r.order.expectedDelivery ? fmtDate(r.order.expectedDelivery) : ""),
      cell: r => (r.order.expectedDelivery
        ? <span className="text-xs whitespace-nowrap"><CellDate>{fmtDate(r.order.expectedDelivery)}</CellDate>{r.late > 0 && <span className="block text-[10px] font-semibold text-destructive">{r.late} day{r.late === 1 ? "" : "s"} late</span>}</span>
        : <span className="text-muted-foreground/50">—</span>) },
    { key: "material", header: "Material given (open)", sortValue: r => r.material, csv: r => r.material,
      cell: r => (r.material ? <span className="text-xs whitespace-nowrap">{r.material}</span> : <span className="text-xs text-muted-foreground">Nothing issued yet</span>) },
  ];
  const actions = (r: AtFactory): MoreAction[] => [
    { label: "Print job card", icon: Printer, hint: "What to make, the pictures and material — no client, no price", onSelect: () => printJobCard(db, r.order, factoryId) },
    { label: "Open order", icon: ExternalLink, onSelect: () => navigate(`/orders/${r.order.id}`) },
  ];
  return (
    <div className="card-luxe p-3 sm:p-4">
      <DataTable id="factory-at-now" noun="order" rows={rows} rowKey={r => r.order.id} columns={columns} rowActions={actions}
        onRowClick={r => navigate(`/orders/${r.order.id}`)} searchText={r => `${r.order.orderNumber} ${pieceLine(r.order)} ${r.stage}`}
        exportName="Factory-At-the-factory-now" pageSizes={[25, 50, 100]} defaultSort={null}
        summary={<StatStrip items={[
          { label: "At the factory", value: String(rows.length), sub: "orders not back yet" },
          { label: "Late", value: String(late), tone: late ? "out" : undefined, sub: "past their delivery date" },
        ]} />}
        emptyText="Nothing is at this factory now." />
    </div>
  );
}
