import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Handshake, Pencil, Wallet, Truck, Receipt, Coins, ArrowDownRight } from "lucide-react";
import { fmtDate, type Purchase } from "@/lib/db";
import { useDb } from "@/hooks/useDb";
import { useAuth } from "@/lib/auth";
import { brokerAccount, brokerPassed, brokerPayments, brokerSuppliers, brokerageWePay } from "@/lib/brokers";
import { fmtMoneyInr, purchasePending, purchasePaid } from "@/lib/manufacturing";
import { purchaseText } from "@/lib/materials";
import { PageHeader, TabBar } from "@/components/PageHeader";
import { StatStrip } from "@/components/TableToolbar";
import { DataTable, CellMain, CellTag, CellAmount, CellDate, type DataColumn } from "@/components/DataTable";
import { BrokerCreateDialog } from "@/components/create/BrokerCreateDialog";
import { PayBrokerSheet } from "@/components/PayBrokerSheet";

type Tab = "bills" | "suppliers" | "money";

/**
 * One broker (dalal): the suppliers they deal with, every bill they brought —
 * what it came to, what is paid and what is pending — and the money: what we
 * gave them, what they passed on to suppliers, their brokerage, and what they
 * still hold. "Pay through broker" settles bills through them in one payment.
 */
export function BrokerHistoryPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const db = useDb();
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const [tab, setTab] = useState<Tab>("bills");
  const [paying, setPaying] = useState(false);
  const [editing, setEditing] = useState(false);
  const broker = (db.brokers ?? []).find(b => b.id === id);

  if (!broker) {
    return (
      <div className="text-center py-20 text-muted-foreground space-y-2">
        <p>That broker isn't here.</p>
        <Link to="/suppliers" className="text-primary underline">Back to Suppliers</Link>
      </div>
    );
  }

  const acc = brokerAccount(db, broker);
  const bills = (db.purchases ?? []).filter(p => p.brokerId === broker.id)
    .sort((a, b) => (b.invoiceDate || b.createdAt).localeCompare(a.invoiceDate || a.createdAt));
  const supplierName = (sid: string) => db.suppliers.find(s => s.id === sid)?.name ?? "Supplier";
  const supplierIds = brokerSuppliers(db, broker);

  // ── Bills they brought ──
  const billCols: DataColumn<Purchase>[] = [
    { key: "date", header: "Date", kind: "date", sortValue: p => +new Date(p.invoiceDate || p.createdAt), cell: p => <CellDate>{fmtDate(p.invoiceDate || p.createdAt)}</CellDate> },
    { key: "supplier", header: "Supplier", always: true, sortValue: p => supplierName(p.supplierId), csv: p => supplierName(p.supplierId),
      cell: p => <CellMain title={<Link to={`/suppliers/${p.supplierId}`} className="hover:underline">{supplierName(p.supplierId)}</Link>} sub={p.invoiceNumber ? `Bill ${p.invoiceNumber}` : "No bill no."} /> },
    { key: "item", header: "Item", sortValue: p => purchaseText(db.settings, p), cell: p => <span className="text-xs text-muted-foreground">{purchaseText(db.settings, p)}</span> },
    { key: "amount", header: "Bill", align: "right", kind: "number", sortValue: p => p.totalInr, cell: p => <CellAmount>{fmtMoneyInr(p.totalInr)}</CellAmount> },
    { key: "brokerage", header: "Brokerage", align: "right", kind: "number", sortValue: p => p.brokerageInr ?? 0,
      cell: p => <span className="tabular-nums whitespace-nowrap">{fmtMoneyInr(p.brokerageInr ?? 0)}{p.brokeragePaidBy === "supplier" && <span className="text-[10px] text-muted-foreground"> · supplier pays</span>}</span> },
    { key: "paid", header: "Paid", align: "right", kind: "number", sortValue: p => purchasePaid(p), cell: p => <CellAmount tone="in">{fmtMoneyInr(purchasePaid(p))}</CellAmount> },
    { key: "pending", header: "Pending", align: "right", kind: "number", sortValue: p => purchasePending(p),
      cell: p => (purchasePending(p) > 0.5 ? <CellAmount tone="out">{fmtMoneyInr(purchasePending(p))}</CellAmount> : <CellTag tone="green">Paid</CellTag>) },
  ];

  // ── Suppliers they deal with ──
  type SupRow = { id: string; bills: number; total: number; pending: number; set: boolean };
  const supRows: SupRow[] = supplierIds.map(sid => {
    const mine = bills.filter(p => p.supplierId === sid);
    return { id: sid, bills: mine.length, total: mine.reduce((s, p) => s + p.totalInr, 0), pending: mine.reduce((s, p) => s + purchasePending(p), 0), set: (broker.supplierIds ?? []).includes(sid) };
  });
  const supCols: DataColumn<SupRow>[] = [
    { key: "supplier", header: "Supplier", always: true, sortValue: r => supplierName(r.id),
      cell: r => <CellMain title={<Link to={`/suppliers/${r.id}`} className="hover:underline">{supplierName(r.id)}</Link>} sub={r.set ? "Their usual broker" : "From bills"} /> },
    { key: "bills", header: "Bills", align: "right", kind: "number", sortValue: r => r.bills, cell: r => <span className="tabular-nums">{r.bills}</span> },
    { key: "total", header: "Bought", align: "right", kind: "number", sortValue: r => r.total, cell: r => <CellAmount>{fmtMoneyInr(r.total)}</CellAmount> },
    { key: "pending", header: "Pending", align: "right", kind: "number", sortValue: r => r.pending,
      cell: r => (r.pending > 0.5 ? <CellAmount tone="out">{fmtMoneyInr(r.pending)}</CellAmount> : <CellTag tone="green">Settled</CellTag>) },
  ];

  // ── Money: given to them, and passed on to suppliers ──
  type MoneyRow = { id: string; at: string; kind: "given" | "passed"; amount: number; text: string; sub?: string };
  const money: MoneyRow[] = [
    ...brokerPayments(db, broker.id).map(t => ({
      id: t.id, at: t.createdAt, kind: "given" as const, amount: t.amountInr,
      text: `Given to ${broker.name}`, sub: [db.lockers.find(l => l.id === t.lockerId)?.name, t.note].filter(Boolean).join(" · ") || undefined,
    })),
    ...brokerPassed(db, broker.id).map(({ purchase, pay }) => ({
      id: pay.id, at: pay.createdAt, kind: "passed" as const, amount: pay.amountInr,
      text: `Passed to ${supplierName(purchase.supplierId)}`, sub: purchase.invoiceNumber ? `Bill ${purchase.invoiceNumber}` : undefined,
    })),
  ];
  const moneyCols: DataColumn<MoneyRow>[] = [
    { key: "date", header: "Date", kind: "date", sortValue: r => +new Date(r.at), cell: r => <CellDate>{fmtDate(r.at)}</CellDate> },
    { key: "what", header: "Movement", always: true, sortValue: r => r.text, cell: r => <CellMain title={r.text} sub={r.sub} /> },
    { key: "given", header: "Given", align: "right", kind: "number", sortValue: r => (r.kind === "given" ? r.amount : null),
      cell: r => (r.kind === "given" ? <CellAmount tone="out">{fmtMoneyInr(r.amount)}</CellAmount> : <span className="text-muted-foreground/50">—</span>) },
    { key: "passed", header: "Passed on", align: "right", kind: "number", sortValue: r => (r.kind === "passed" ? r.amount : null),
      cell: r => (r.kind === "passed" ? <CellAmount tone="in">{fmtMoneyInr(r.amount)}</CellAmount> : <span className="text-muted-foreground/50">—</span>) },
  ];

  const weOwe = Math.max(0, acc.due);

  return (
    <div className="space-y-5">
      <PageHeader
        back={{ label: "Brokers", onClick: () => navigate("/suppliers") }}
        title={broker.name}
        subtitle={[broker.phone, broker.brokeragePct != null ? `${broker.brokeragePct}% usual brokerage` : null, broker.active === false ? "switched off" : null].filter(Boolean).join(" · ") || "Broker"}
        primary={{ label: "Pay through broker", icon: Wallet, onClick: () => setPaying(true) }}
        secondary={isAdmin ? { label: "Edit", icon: Pencil, onClick: () => setEditing(true) } : null}
      />

      <StatStrip items={[
        { label: "Bills pending", value: fmtMoneyInr(acc.billsPending), icon: Receipt, tone: acc.billsPending > 0.5 ? "out" : undefined,
          sub: `${bills.filter(p => purchasePending(p) > 0.5).length} of ${bills.length} bill${bills.length === 1 ? "" : "s"}` },
        { label: "Brokerage owed", value: fmtMoneyInr(weOwe), icon: Coins, tone: weOwe > 0.5 ? "out" : undefined,
          sub: `${fmtMoneyInr(acc.brokerage)} in all${acc.bySupplier ? ` · ${fmtMoneyInr(acc.bySupplier)} paid by suppliers` : ""}` },
        { label: "Held by broker", value: fmtMoneyInr(acc.held), icon: Handshake,
          sub: acc.held > 0.5 ? "Given, not passed on yet" : `Given ${fmtMoneyInr(acc.paid)} · passed ${fmtMoneyInr(acc.passed)}` },
        { label: "To settle", value: fmtMoneyInr(acc.toPay), icon: ArrowDownRight, tone: acc.toPay > 0.5 ? "out" : undefined, sub: "Bills + brokerage − held" },
      ]} />

      <div className="space-y-3">
        <TabBar label="Broker" value={tab} onChange={setTab} tabs={[
          { key: "bills", label: "Bills", icon: Receipt, count: bills.length },
          { key: "suppliers", label: "Suppliers", icon: Truck, count: supRows.length },
          { key: "money", label: "Money", icon: Wallet, count: money.length },
        ]} />
        <div className="card-luxe p-3 sm:p-4">
          {tab === "bills" && (
            <DataTable id="broker-bills" noun="bill" rows={bills} rowKey={p => p.id} columns={billCols}
              defaultSort={{ key: "date", dir: "desc" }} searchText={p => [supplierName(p.supplierId), p.invoiceNumber].filter(Boolean).join(" ")}
              exportName={`Broker-${broker.name}-Bills`} rowHref={p => `/suppliers/${p.supplierId}`}
              totals={{
                amount: list => fmtMoneyInr(list.reduce((s, p) => s + p.totalInr, 0)),
                brokerage: list => fmtMoneyInr(list.reduce((s, p) => s + brokerageWePay(p), 0)),
                paid: list => <span className="text-success">{fmtMoneyInr(list.reduce((s, p) => s + purchasePaid(p), 0))}</span>,
                pending: list => <span className="text-destructive">{fmtMoneyInr(list.reduce((s, p) => s + purchasePending(p), 0))}</span>,
              }}
              emptyText="No bills brought by this broker yet — pick them as the broker on a purchase." />
          )}
          {tab === "suppliers" && (
            <DataTable id="broker-suppliers" noun="supplier" rows={supRows} rowKey={r => r.id} columns={supCols}
              defaultSort={{ key: "pending", dir: "desc" }} rowHref={r => `/suppliers/${r.id}`} details={false}
              emptyText={isAdmin ? "No suppliers yet — add the suppliers they deal with from Edit." : "No suppliers yet."} />
          )}
          {tab === "money" && (
            <DataTable id="broker-money" noun="movement" rows={money} rowKey={r => r.id} columns={moneyCols}
              defaultSort={{ key: "date", dir: "desc" }} details={false}
              totals={{
                given: list => fmtMoneyInr(list.filter(r => r.kind === "given").reduce((s, r) => s + r.amount, 0)),
                passed: list => fmtMoneyInr(list.filter(r => r.kind === "passed").reduce((s, r) => s + r.amount, 0)),
              }}
              emptyText="Nothing given to or passed on by this broker yet." />
          )}
        </div>
      </div>

      <PayBrokerSheet open={paying} onOpenChange={setPaying} brokerId={broker.id} />
      {isAdmin && <BrokerCreateDialog open={editing} onOpenChange={setEditing} broker={broker} />}
    </div>
  );
}
