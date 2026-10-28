import { useState } from "react";
import { Link } from "react-router-dom";
import { Coins, Gem, PackageOpen, Trash2, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { SectionTitle } from "@/components/SectionTitle";
import { StatStrip } from "@/components/TableToolbar";
import { Button } from "@/components/ui/button";
import { DataTable, CellDate, CellTag, type DataColumn } from "@/components/DataTable";
import { ClientMaterialSheet } from "@/components/ClientMaterialSheet";
import { useDb } from "@/hooks/useDb";
import { useAuth } from "@/lib/auth";
import { updateDbAs, type ClientMaterialEntry } from "@/lib/db";
import { clientMaterialBalance, fmtCt, fmtFine } from "@/lib/clientMaterial";
import { confirmBox } from "@/lib/confirm";

/**
 * A client's own gold and diamonds held for them: what they gave, what went
 * into their pieces, what was handed back — and what is with us or at a
 * factory now. Their material, never our stock.
 */
export function ClientMaterialCard({ clientId }: { clientId: string }) {
  const db = useDb();
  const { user } = useAuth();
  const [sheet, setSheet] = useState<"receive" | "return" | null>(null);
  const client = db.clients.find(c => c.id === clientId);
  if (!client) return null;
  const ledger = client.materialLedger ?? [];
  const bal = clientMaterialBalance(db, client);
  const isStaff = user?.role !== "client";
  const orderNo = (id?: string) => (id ? db.orders.find(o => o.id === id)?.orderNumber : undefined);

  // A receipt or a hand-back entered by mistake — never one that would leave them below nothing.
  const remove = async (e: ClientMaterialEntry) => {
    const after = { ...client, materialLedger: ledger.filter(x => x.id !== e.id) };
    const b = clientMaterialBalance(db, after);
    // Not below nothing — and not below what has already gone to a factory.
    if (b.goldFine - b.goldAtFactory < -0.0005 || b.diaCt - b.diaAtFactory < -0.0005) {
      toast.error("Some of this has already gone to a factory or into their pieces — it can't be taken off");
      return;
    }
    if (!(await confirmBox(`Delete this entry?\n\n${e.kind === "in" ? "Received" : "Handed back"}: ${e.material === "gold" ? `${e.grams} g at ${e.purity}‰ (${e.fine} g fine)` : fmtCt(e.ct ?? 0, e.pcs)}.`))) return;
    updateDbAs({ summary: `${client.companyName}: deleted a client-material entry (${e.kind === "in" ? "received" : "handed back"} ${e.material})` }, d => {
      const c = d.clients.find(x => x.id === clientId);
      if (c) c.materialLedger = (c.materialLedger ?? []).filter(x => x.id !== e.id);
    });
    toast.success("Deleted");
  };

  const what = (e: ClientMaterialEntry) => e.material === "gold"
    ? (e.kind === "use" ? `${e.note ?? "Gold in the piece"}${e.shortfallFine ? ` · ${e.shortfallFine} g fine short (ours, billed)` : ""}` : `${e.grams} g at ${e.purity}‰`)
    : [fmtCt(e.ct ?? 0, e.pcs), e.shape, e.type, e.mm, e.size, [e.color, e.clarity].filter(Boolean).join(" "), e.certNo ? `${e.certLab ?? "Report"} ${e.certNo}` : ""].filter(Boolean).join(" · ");
  const columns: DataColumn<ClientMaterialEntry>[] = [
    { key: "date", header: "Date", kind: "date", sortValue: e => e.at, cell: e => <CellDate>{new Date(e.at).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}</CellDate> },
    { key: "kind", header: "", sortValue: e => e.kind, cell: e => e.kind === "in" ? <CellTag tone="green">Received</CellTag> : e.kind === "out" ? <CellTag tone="amber">Handed back</CellTag> : <CellTag tone="violet">Used</CellTag> },
    { key: "material", header: "Material", sortValue: e => e.material, cell: e => (
      <span className="inline-flex items-center gap-1.5 whitespace-nowrap">{e.material === "gold" ? <Coins className="h-3.5 w-3.5 text-amber-600" /> : <Gem className="h-3.5 w-3.5 text-sky-600" />}{e.material === "gold" ? "Gold" : "Diamonds"}</span>
    ) },
    { key: "detail", header: "Detail", sortValue: e => what(e), cell: e => (
      <span className="text-sm">
        {what(e)}
        {e.orderId && <> · {orderNo(e.orderId) ? <Link to={`/orders/${e.orderId}`} className="text-primary hover:underline">{orderNo(e.orderId)}</Link> : "an order"}</>}
        {e.note && e.kind !== "use" && <span className="text-muted-foreground"> · {e.note}</span>}
      </span>
    ) },
    { key: "fine", header: "Gold (fine)", align: "right", kind: "number", sortValue: e => (e.material === "gold" ? (e.kind === "in" ? 1 : -1) * (e.fine ?? 0) : null),
      cell: e => e.material === "gold" ? <span className={`tabular-nums ${e.kind === "in" ? "text-success" : ""}`}>{e.kind === "in" ? "+" : "−"}{e.fine ?? 0} g</span> : <span className="text-muted-foreground">—</span> },
    { key: "ct", header: "Diamonds", align: "right", kind: "number", sortValue: e => (e.material === "diamond" ? (e.kind === "in" ? 1 : -1) * (e.ct ?? 0) : null),
      cell: e => e.material === "diamond" ? <span className={`tabular-nums ${e.kind === "in" ? "text-success" : ""}`}>{e.kind === "in" ? "+" : "−"}{e.ct ?? 0} ct</span> : <span className="text-muted-foreground">—</span> },
    { key: "by", header: "By", hidden: true, sortValue: e => e.byName ?? "", cell: e => <span className="text-xs text-muted-foreground">{e.byName ?? "—"}</span> },
  ];

  return (
    <div className="card-luxe overflow-hidden">
      <SectionTitle icon={Coins} title="Client's own material" sub="Their gold and diamonds held for them — not our stock" className="px-5 py-4 border-b border-border/60"
        actions={isStaff ? (
          <>
            <Button size="sm" variant="outline" onClick={() => setSheet("return")} disabled={bal.goldInHand <= 0 && bal.diaInHand <= 0} className="h-9 rounded-xl gap-1.5"><Undo2 className="h-4 w-4" /><span className="max-sm:hidden">Hand back</span></Button>
            <Button size="sm" onClick={() => setSheet("receive")} className="btn-hero h-9 rounded-xl gap-1.5"><PackageOpen className="h-4 w-4" /> Receive</Button>
          </>
        ) : undefined} />
      <div className="p-3 sm:p-4 space-y-3">
        <StatStrip items={[
          { label: "Their gold", value: fmtFine(bal.goldFine), icon: Coins, sub: `${fmtFine(bal.goldInHand)} with us · ${fmtFine(bal.goldAtFactory)} at factories` },
          { label: "Their diamonds", value: fmtCt(bal.diaCt, bal.diaPcs || undefined), icon: Gem, sub: `${bal.diaInHand} ct with us · ${bal.diaAtFactory} ct at factories` },
        ]} />
        {ledger.length > 0 ? (
          <DataTable id="client-material" noun="movement" rows={ledger} rowKey={e => e.id} columns={columns} defaultSort={{ key: "date", dir: "desc" }} details={false}
            rowActions={isStaff ? e => [
              { label: "Delete", icon: Trash2, danger: true, show: e.kind !== "use", onSelect: () => { void remove(e); } },
              { label: "Used at Final Approval", icon: Coins, show: e.kind === "use", disabled: true, hint: "Changes when the order's Final Approval is saved again", onSelect: () => undefined },
            ] : undefined} />
        ) : (
          <p className="text-sm text-muted-foreground text-center py-4">Nothing of theirs yet. When they give you gold or diamonds for their pieces, press Receive.</p>
        )}
      </div>
      {sheet && <ClientMaterialSheet clientId={clientId} mode={sheet} onClose={() => setSheet(null)} />}
    </div>
  );
}
