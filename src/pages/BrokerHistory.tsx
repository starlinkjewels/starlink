import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Handshake, Pencil, Wallet, Truck, Receipt, Coins, ArrowDownRight, Tag, ArrowDownCircle } from "lucide-react";
import { fmtDate, type Purchase, type SupplierSale } from "@/lib/db";
import { useDb } from "@/hooks/useDb";
import { useAuth } from "@/lib/auth";
import { brokerAccount, brokerCollected, brokerHandovers, brokerPassed, brokerPayments, brokerSuppliers, brokerageWePay, saleBrokerageWePay } from "@/lib/brokers";
import { fmtMoneyInr, purchasePending, purchasePaid } from "@/lib/manufacturing";
import { purchaseText } from "@/lib/materials";
import { PageHeader, TabBar } from "@/components/PageHeader";
import { StatStrip } from "@/components/TableToolbar";
import { DataTable, CellMain, CellTag, CellAmount, CellDate, type DataColumn } from "@/components/DataTable";
import { BrokerCreateDialog } from "@/components/create/BrokerCreateDialog";
import { PayBrokerSheet } from "@/components/PayBrokerSheet";
import { ReceiveFromBrokerSheet } from "@/components/ReceiveFromBrokerSheet";

type Tab = "bills" | "sales" | "suppliers" | "money";

/**
 * One broker (dalal): the suppliers they deal with, every bill they brought —
 * what it came to, what is paid and what is pending — and the money: what we
 * gave them, what they passed on to suppliers, their brokerage, and what they
 * still hold. "Pay through broker" settles bills through them in one payment.
 */
export function BrokerHistoryPage() {
  const { id } = useParams<{ id: string }>();
  const db = useDb();
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const [tab, setTab] = useState<Tab>("bills");
  const [paying, setPaying] = useState(false);
  const [editing, setEditing] = useState(false);
  const [receiving, setReceiving] = useState(false);
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

  // ── Sales to suppliers they brought (lib/supplierSales.ts) ──
  const sales = (db.supplierSales ?? []).filter(x => x.brokerId === broker.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const collectedFor = (sale: SupplierSale) => (sale.receiptId ? brokerCollected(db, broker.id).find(r => r.id === sale.receiptId)?.amountInr ?? 0 : 0);
  const saleCols: DataColumn<SupplierSale>[] = [
    { key: "date", header: "Date", kind: "date", sortValue: x => +new Date(x.createdAt), cell: x => <CellDate>{fmtDate(x.createdAt)}</CellDate> },
    { key: "supplier", header: "Sold to", always: true, sortValue: x => supplierName(x.supplierId), csv: x => supplierName(x.supplierId),
      cell: x => <CellMain title={<Link to={`/suppliers/${x.supplierId}`} className="hover:underline">{supplierName(x.supplierId)}</Link>} sub={x.lines.map(l => l.label).join(", ")} /> },
    { key: "amount", header: "Sale", align: "right", kind: "number", sortValue: x => x.totalInr, cell: x => <CellAmount>{fmtMoneyInr(x.totalInr)}</CellAmount> },
    { key: "brokerage", header: "Brokerage", align: "right", kind: "number", sortValue: x => x.brokerageInr ?? 0,
      cell: x => <span className="tabular-nums whitespace-nowrap">{fmtMoneyInr(x.brokerageInr ?? 0)}{x.brokeragePaidBy === "supplier" && <span className="text-[10px] text-muted-foreground"> · supplier pays</span>}</span> },
    { key: "collected", header: "Collected for us", align: "right", kind: "number", sortValue: x => collectedFor(x),
      cell: x => (collectedFor(x) > 0 ? <CellAmount tone="in">{fmtMoneyInr(collectedFor(x))}</CellAmount> : <span className="text-muted-foreground/50">—</span>) },
  ];

  // ── Money: given to them, passed on to suppliers; collected for us, handed over ──
  type MoneyRow = { id: string; at: string; kind: "given" | "passed" | "collected" | "handed"; amount: number; text: string; sub?: string };
  const money: MoneyRow[] = [
    ...brokerPayments(db, broker.id).map(t => ({
      id: t.id, at: t.createdAt, kind: "given" as const, amount: t.amountInr,
      text: `Given to ${broker.name}`, sub: [db.lockers.find(l => l.id === t.lockerId)?.name, t.note].filter(Boolean).join(" · ") || undefined,
    })),
    ...brokerPassed(db, broker.id).map(({ purchase, pay }) => ({
      id: pay.id, at: pay.createdAt, kind: "passed" as const, amount: pay.amountInr,
      text: `Passed to ${supplierName(purchase.supplierId)}`, sub: purchase.invoiceNumber ? `Bill ${purchase.invoiceNumber}` : undefined,
    })),
    ...brokerCollected(db, broker.id).map(r => ({
      id: r.id, at: r.createdAt, kind: "collected" as const, amount: r.amountInr,
      text: `Collected from ${supplierName(r.supplierId)} for us`, sub: r.note,
    })),
    ...brokerHandovers(db, broker.id).map(t => ({
      id: t.id, at: t.createdAt, kind: "handed" as const, amount: t.amountInr,
      text: "Handed to us", sub: [db.lockers.find(l => l.id === t.lockerId)?.name, t.note].filter(Boolean).join(" · ") || undefined,
    })),
  ];
  const into = (r: MoneyRow) => r.kind === "given" || r.kind === "collected";
  const moneyCols: DataColumn<MoneyRow>[] = [
    { key: "date", header: "Date", kind: "date", sortValue: r => +new Date(r.at), cell: r => <CellDate>{fmtDate(r.at)}</CellDate> },
    { key: "what", header: "Movement", always: true, sortValue: r => r.text, cell: r => <CellMain title={r.text} sub={r.sub} /> },
    // Into their hands (given by us, collected for us) and out of them (passed to a supplier, handed to us).
    { key: "given", header: "Given / collected", align: "right", kind: "number", sortValue: r => (into(r) ? r.amount : null),
      cell: r => (into(r) ? <CellAmount tone="out">{fmtMoneyInr(r.amount)}</CellAmount> : <span className="text-muted-foreground/50">—</span>) },
    { key: "passed", header: "Passed on / handed over", align: "right", kind: "number", sortValue: r => (!into(r) ? r.amount : null),
      cell: r => (!into(r) ? <CellAmount tone="in">{fmtMoneyInr(r.amount)}</CellAmount> : <span className="text-muted-foreground/50">—</span>) },
  ];

  const weOwe = Math.max(0, acc.due);

  return (
    <div className="space-y-5">
      <PageHeader
        back={{ label: "Brokers", to: "/suppliers" }}
        title={broker.name}
        subtitle={[broker.phone, broker.brokeragePct != null ? `${broker.brokeragePct}% usual brokerage` : null, broker.active === false ? "switched off" : null].filter(Boolean).join(" · ") || "Broker"}
        primary={{ label: "Pay through broker", icon: Wallet, onClick: () => setPaying(true) }}
        secondary={isAdmin ? { label: "Edit", icon: Pencil, onClick: () => setEditing(true) } : null}
        menu={[
          { label: "Receive from broker", icon: ArrowDownCircle, hint: acc.held > 0.5 ? `They hold ${fmtMoneyInr(acc.held)} of ours` : "Money they collected for us", onSelect: () => setReceiving(true), show: isAdmin },
        ]}
      />

      <StatStrip items={[
        { label: "Bills pending", value: fmtMoneyInr(acc.billsPending), icon: Receipt, tone: acc.billsPending > 0.5 ? "out" : undefined,
          sub: `${bills.filter(p => purchasePending(p) > 0.5).length} of ${bills.length} bill${bills.length === 1 ? "" : "s"}` },
        { label: "Brokerage owed", value: fmtMoneyInr(weOwe), icon: Coins, tone: weOwe > 0.5 ? "out" : undefined,
          sub: `${fmtMoneyInr(acc.brokerage)} in all${acc.bySupplier ? ` · ${fmtMoneyInr(acc.bySupplier)} paid by suppliers` : ""}` },
        { label: "Held by broker", value: fmtMoneyInr(acc.held), icon: Handshake,
          sub: acc.held > 0.5 ? (acc.collected - acc.handedOver > 0.5 ? "Given or collected, not passed on yet" : "Given, not passed on yet") : `Given ${fmtMoneyInr(acc.paid)} · passed ${fmtMoneyInr(acc.passed)}` },
        { label: "To settle", value: fmtMoneyInr(acc.toPay), icon: ArrowDownRight, tone: acc.toPay > 0.5 ? "out" : undefined, sub: "Bills + brokerage − held" },
      ]} />

      <div className="space-y-3">
        <TabBar label="Broker" value={tab} onChange={setTab} tabs={[
          { key: "bills", label: "Bills", icon: Receipt, count: bills.length },
          ...(sales.length ? [{ key: "sales" as const, label: "Sales", icon: Tag, count: sales.length }] : []),
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
          {tab === "sales" && (
            <DataTable id="broker-sales" noun="sale" rows={sales} rowKey={x => x.id} columns={saleCols}
              defaultSort={{ key: "date", dir: "desc" }} searchText={x => [supplierName(x.supplierId), ...x.lines.map(l => l.label)].join(" ")}
              exportName={`Broker-${broker.name}-Sales`} rowHref={x => `/suppliers/${x.supplierId}`}
              totals={{
                amount: list => fmtMoneyInr(list.reduce((s, x) => s + x.totalInr, 0)),
                brokerage: list => fmtMoneyInr(list.reduce((s, x) => s + saleBrokerageWePay(x), 0)),
                collected: list => <span className="text-success">{fmtMoneyInr(list.reduce((s, x) => s + collectedFor(x), 0))}</span>,
              }}
              emptyText="No sales brought by this broker yet." />
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
                given: list => fmtMoneyInr(list.filter(into).reduce((s, r) => s + r.amount, 0)),
                passed: list => fmtMoneyInr(list.filter(r => !into(r)).reduce((s, r) => s + r.amount, 0)),
              }}
              emptyText="Nothing given to or passed on by this broker yet." />
          )}
        </div>
      </div>

      <PayBrokerSheet open={paying} onOpenChange={setPaying} brokerId={broker.id} />
      {isAdmin && <BrokerCreateDialog open={editing} onOpenChange={setEditing} broker={broker} />}
      {isAdmin && <ReceiveFromBrokerSheet open={receiving} onOpenChange={setReceiving} brokerId={broker.id} />}
    </div>
  );
}
