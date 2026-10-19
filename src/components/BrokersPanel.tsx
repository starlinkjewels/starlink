import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Pencil, Power, Trash2, Wallet } from "lucide-react";
import { updateDb, fmtDate, ensureCollections, collectionsLoaded, hasOpeningBalance, type Broker } from "@/lib/db";
import { useDb } from "@/hooks/useDb";
import { brokerAccount, brokerDeleteWhy, brokerPayments } from "@/lib/brokers";
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
      { label: "Pay brokerage", icon: Wallet, hint: acc(b).due > 0.5 ? `${fmtMoneyInr(acc(b).due)} owed` : "Nothing owed now", onSelect: () => setPaying(b) },
      { label: "Edit details", icon: Pencil, onSelect: () => setEditing(b), disabled: !isAdmin, hint: isAdmin ? "Name, phone, usual %" : ADMIN_ONLY },
      { label: b.active === false ? "Switch on" : "Switch off", icon: Power, onSelect: () => toggle(b), disabled: !isAdmin, hint: isAdmin ? "Kept on past bills either way" : ADMIN_ONLY },
      { label: "Delete broker", icon: Trash2, danger: true, onSelect: () => del(b), disabled: !isAdmin || !!delWhy, hint: !isAdmin ? ADMIN_ONLY : delWhy },
    ];
  };

  const columns: DataColumn<Broker>[] = [
    { key: "broker", header: "Broker", always: true, sortValue: b => b.name, csv: b => b.name,
      cell: b => <CellMain title={<>{b.name}{b.active === false && <span className="ml-2 align-middle"><CellTag>Off</CellTag></span>}</>} sub={b.phone || undefined} /> },
    { key: "pct", header: "Usual %", align: "right", kind: "number", sortValue: b => b.brokeragePct ?? 0,
      cell: b => <span className="tabular-nums">{b.brokeragePct != null ? `${b.brokeragePct}%` : "—"}</span> },
    { key: "bills", header: "Bills", align: "right", kind: "number", sortValue: b => acc(b).bills,
      cell: b => <span className="tabular-nums">{acc(b).bills}</span> },
    { key: "brokerage", header: "Brokerage", align: "right", kind: "number", sortValue: b => acc(b).brokerage,
      cell: b => <CellAmount>{fmtMoneyInr(acc(b).brokerage)}</CellAmount> },
    { key: "paid", header: "Paid", align: "right", kind: "number", sortValue: b => acc(b).paid,
      cell: b => <CellAmount tone="in">{fmtMoneyInr(acc(b).paid)}</CellAmount> },
    { key: "due", header: "Due", align: "right", kind: "number", sortValue: b => acc(b).due, csv: b => acc(b).due,
      cell: b => {
        const due = acc(b).due;
        if (due > 0.5) return <div><CellAmount tone="out">{fmtMoneyInr(due)}</CellAmount><p className="text-[10px] text-muted-foreground whitespace-nowrap">you owe</p></div>;
        if (due < -0.5) return <div><span className="tabular-nums whitespace-nowrap font-semibold text-blue-600">+{fmtMoneyInr(-due)}</span><p className="text-[10px] text-muted-foreground whitespace-nowrap">paid ahead</p></div>;
        return <span className="text-xs font-semibold text-success whitespace-nowrap">✓ Settled</span>;
      } },
  ];

  // An opened row: the bills they brought and the payments made to them.
  const details = (b: Broker): Detail[] => {
    const a = acc(b);
    const lines = (db.purchases ?? []).filter(p => p.brokerId === b.id)
      .sort((x, y) => +new Date(y.createdAt) - +new Date(x.createdAt));
    const pays = brokerPayments(db, b.id).sort((x, y) => +new Date(y.createdAt) - +new Date(x.createdAt));
    const supplierName = (id: string) => db.suppliers.find(s => s.id === id)?.name ?? "supplier";
    return filled([
      a.bySupplier > 0 && { label: "Paid by suppliers (for reference)", value: fmtMoneyInr(a.bySupplier) },
      hasOpeningBalance(b) && { label: "Opening balance", value: `${fmtMoneyInr(b.openingBalance || 0)} ${b.openingDir === "debit" ? "debit (they owed us)" : "credit (we owed them)"}${b.openingDate ? ` · as of ${fmtDate(b.openingDate)}` : ""}` },
      lines.length > 0 && { label: `Bills (${lines.length} line${lines.length === 1 ? "" : "s"})`, value: (
        <ul className="space-y-0.5 text-xs">
          {lines.slice(0, 12).map(p => (
            <li key={p.id} className="tabular-nums">
              {fmtDate(p.createdAt)} · {supplierName(p.supplierId)}{p.invoiceNumber ? ` · bill ${p.invoiceNumber}` : ""} · {fmtMoneyInr(p.brokerageInr || 0)}
              <span className="text-muted-foreground">{p.brokeragePaidBy === "supplier" ? " · supplier pays" : ""}{p.brokeragePct ? ` · ${p.brokeragePct}%` : ""}</span>
            </li>
          ))}
          {lines.length > 12 && <li className="text-muted-foreground">and {lines.length - 12} more</li>}
        </ul>
      ) },
      pays.length > 0 && { label: `Payments (${pays.length})`, value: (
        <ul className="space-y-0.5 text-xs">
          {pays.slice(0, 12).map(t => (
            <li key={t.id} className="tabular-nums">{fmtDate(t.createdAt)} · {fmtMoneyInr(t.amountInr)} · {db.lockers.find(l => l.id === t.lockerId)?.name ?? "account"}{t.note ? ` · ${t.note}` : ""}</li>
          ))}
        </ul>
      ) },
      !!b.notes && { label: "Notes", value: b.notes },
      { label: "Broker since", value: fmtDate(b.createdAt) },
    ]);
  };

  const totalDue = (db.brokers ?? []).reduce((s, b) => s + Math.max(0, acc(b).due), 0);

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
          details={details}
          loading={!ready}
          defaultSort={{ key: "due", dir: "desc" }}
          exportName="Brokers"
          emptyText={isAdmin ? "No brokers yet — add one, then pick them on a purchase bill." : "No brokers yet — an admin adds them here."}
          summary={ready && totalDue > 0.5 ? (
            <p className="text-xs text-muted-foreground px-1">Brokerage owed to brokers: <span className="font-semibold text-destructive">{fmtMoneyInr(totalDue)}</span></p>
          ) : undefined}
        />
      </div>
      {isAdmin && <BrokerCreateDialog open={creating} onOpenChange={onCreating} />}
      <BrokerCreateDialog open={!!editing} onOpenChange={v => { if (!v) setEditing(null); }} broker={editing ?? undefined} />
      <PayBrokerSheet open={!!paying} onOpenChange={v => { if (!v) setPaying(null); }} brokerId={paying?.id} />
    </div>
  );
}
