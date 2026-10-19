import { useEffect, useState } from "react";
import { toast } from "sonner";
import { ExternalLink, Pencil, Power, Trash2, Wallet } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { updateDb, fmtDate, ensureCollections, collectionsLoaded, hasOpeningBalance, type Broker } from "@/lib/db";
import { useDb } from "@/hooks/useDb";
import { brokerAccount, brokerDeleteWhy, brokerPayments, brokerSuppliers } from "@/lib/brokers";
import { fmtMoneyInr } from "@/lib/manufacturing";
import { confirmBox } from "@/lib/confirm";
import { DataTable, CellMain, CellTag, CellAmount, type DataColumn } from "@/components/DataTable";
import type { MoreAction } from "@/components/MoreMenu";
import { filled, type Detail } from "@/components/rowDetails";
import { BrokerCreateDialog } from "@/components/create/BrokerCreateDialog";
import { PayBrokerSheet } from "@/components/PayBrokerSheet";

/** What the brokers' figures are read from — loaded when the tab opens. */
const NEEDS = ["purchases", "lockerTransactions"] as const;

/**
 * Suppliers → Brokers: each broker (dalal), their usual brokerage, and their
 * account — brokerage we pay on the bills they brought, what has been paid,
 * and what is still owed (lib/brokers.ts). Pay, edit, switch off or delete
 * from a row's ⋯.
 */
export function BrokersPanel({ isAdmin, creating, onCreating }: {
  isAdmin: boolean; creating: boolean; onCreating: (v: boolean) => void;
}) {
  const db = useDb();
  const [q, setQ] = useState("");
  const [editing, setEditing] = useState<Broker | null>(null);
  const [paying, setPaying] = useState<Broker | null>(null);
  const navigate = useNavigate();
  useEffect(() => { void ensureCollections([...NEEDS]); }, []);
  const ready = collectionsLoaded([...NEEDS]);

  const brokers = (db.brokers ?? []).filter(b => !q.trim() || b.name.toLowerCase().includes(q.trim().toLowerCase()) || (b.phone ?? "").includes(q.trim()));
  const accounts = new Map((db.brokers ?? []).map(b => [b.id, brokerAccount(db, b)]));
  const acc = (b: Broker) => accounts.get(b.id)!;

  const toggle = (b: Broker) => {
    updateDb(d => { const x = d.brokers.find(x => x.id === b.id); if (x) x.active = x.active === false; });
    toast.success(b.active === false ? "Broker switched on" : "Broker switched off — kept on past bills");
  };
  const del = async (b: Broker) => {
    const why = brokerDeleteWhy(db, b);
    if (why) { toast.error(why); return; }
    if (!(await confirmBox(`Delete ${b.name}?\n\nNo purchase or payment refers to them. This cannot be undone.`))) return;
    updateDb(d => {
      const live = d.brokers.find(x => x.id === b.id);
      if (!live || brokerDeleteWhy(d, live)) return;
      d.brokers = d.brokers.filter(x => x.id !== b.id);
    });
    toast.success("Deleted");
  };

  const ADMIN_ONLY = "Only an admin can change brokers";
  const actions = (b: Broker): MoreAction[] => {
    const delWhy = ready ? brokerDeleteWhy(db, b) : "Still loading";
    return [
      { label: "Open broker", icon: ExternalLink, hint: "Bills, suppliers and money", onSelect: () => navigate(`/suppliers/brokers/${b.id}`) },
      { label: "Pay through broker", icon: Wallet, hint: acc(b).toPay > 0.5 ? `${fmtMoneyInr(acc(b).toPay)} to settle` : "Nothing to settle now", onSelect: () => setPaying(b) },
      { label: "Edit details", icon: Pencil, onSelect: () => setEditing(b), disabled: !isAdmin, hint: isAdmin ? "Name, phone, usual %" : ADMIN_ONLY },
      { label: b.active === false ? "Switch on" : "Switch off", icon: Power, onSelect: () => toggle(b), disabled: !isAdmin, hint: isAdmin ? "Kept on past bills either way" : ADMIN_ONLY },
      { label: "Delete broker", icon: Trash2, danger: true, onSelect: () => del(b), disabled: !isAdmin || !!delWhy, hint: !isAdmin ? ADMIN_ONLY : delWhy },
    ];
  };

  const columns: DataColumn<Broker>[] = [
    { key: "broker", header: "Broker", always: true, sortValue: b => b.name, csv: b => b.name,
      cell: b => <CellMain title={<>{b.name}{b.active === false && <span className="ml-2 align-middle"><CellTag>Off</CellTag></span>}</>}
        sub={[b.phone, b.brokeragePct != null ? `${b.brokeragePct}%` : null].filter(Boolean).join(" · ") || undefined} /> },
    { key: "suppliers", header: "Suppliers", align: "right", kind: "number", sortValue: b => brokerSuppliers(db, b).length,
      cell: b => <span className="tabular-nums">{brokerSuppliers(db, b).length}</span> },
    { key: "pending", header: "Bills pending", align: "right", kind: "number", sortValue: b => acc(b).billsPending,
      cell: b => (acc(b).billsPending > 0.5 ? <CellAmount tone="out">{fmtMoneyInr(acc(b).billsPending)}</CellAmount> : <span className="text-muted-foreground">—</span>) },
    { key: "brokerage", header: "Brokerage owed", align: "right", kind: "number", sortValue: b => Math.max(0, acc(b).due),
      cell: b => (acc(b).due > 0.5 ? <CellAmount tone="out">{fmtMoneyInr(acc(b).due)}</CellAmount> : <span className="text-muted-foreground">—</span>) },
    { key: "held", header: "Held by broker", align: "right", kind: "number", sortValue: b => acc(b).held,
      cell: b => (acc(b).held > 0.5 ? <span className="tabular-nums whitespace-nowrap font-semibold text-blue-600">{fmtMoneyInr(acc(b).held)}</span> : <span className="text-muted-foreground">—</span>) },
    { key: "due", header: "To settle", align: "right", kind: "number", sortValue: b => acc(b).toPay, csv: b => acc(b).toPay,
      cell: b => (acc(b).toPay > 0.5 ? <CellAmount tone="out">{fmtMoneyInr(acc(b).toPay)}</CellAmount> : <span className="text-xs font-semibold text-success whitespace-nowrap">✓ Settled</span>) },
  ];

  const totalDue = (db.brokers ?? []).reduce((s, b) => s + acc(b).toPay, 0);

  return (
    <div className="space-y-4">
      <div className="card-luxe p-3 sm:p-4">
        <DataTable
          id="brokers"
          noun="broker"
          search={{ value: q, onChange: setQ, placeholder: "Search brokers..." }}
          resetKey={q}
          rows={brokers}
          rowKey={b => b.id}
          columns={columns}
          rowActions={actions}
          rowHref={b => `/suppliers/brokers/${b.id}`}
          details={false}
          loading={!ready}
          defaultSort={{ key: "due", dir: "desc" }}
          exportName="Brokers"
          emptyText={isAdmin ? "No brokers yet — add one, then pick them on a purchase bill." : "No brokers yet — an admin adds them here."}
          summary={ready && totalDue > 0.5 ? (
            <p className="text-xs text-muted-foreground px-1">To settle through brokers (bills + brokerage): <span className="font-semibold text-destructive">{fmtMoneyInr(totalDue)}</span></p>
          ) : undefined}
        />
      </div>
      {isAdmin && <BrokerCreateDialog open={creating} onOpenChange={onCreating} />}
      <BrokerCreateDialog open={!!editing} onOpenChange={v => { if (!v) setEditing(null); }} broker={editing ?? undefined} />
      <PayBrokerSheet open={!!paying} onOpenChange={v => { if (!v) setPaying(null); }} brokerId={paying?.id} />
    </div>
  );
}
