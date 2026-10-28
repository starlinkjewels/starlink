import { useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import {
  fmtMoney, fmtDate, orderTotal, orderGrossTotal, totalAdvance, balanceDue, returnedCredit,
  invoiceOrderIds, type Order, type Invoice, type Client,
} from "@/lib/db";
import { Download, FileText, Package, Undo2, Gift } from "lucide-react";
import { StatStrip, type TableFilter } from "@/components/TableToolbar";
import { DataTable, CellAmount, CellDate, type DataColumn } from "@/components/DataTable";
import { type MoreAction } from "@/components/MoreMenu";
import { SectionTitle } from "@/components/SectionTitle";

export interface InvoiceBlock {
  id: string;
  /** The invoice number, e.g. "0001". */
  number: string;
  date: string;
  items: {
    orderId: string;
    orderNo: string;
    description: string;
    qty: number;
    gross: number;
    gift: number;
    /** Credit for pieces sent back (credit notes). */
    returned: number;
    net: number;
    received: number;
    balance: number;
  }[];
  gross: number;
  gift: number;
  returned: number;
  net: number;
  received: number;
  balance: number;
  /** Payments received against this invoice's orders, for the drill-down. */
  payments: InvoicePayment[];
  /** Credit notes for pieces sent back, for the drill-down. `id` is the note's id. */
  credits: { id: string; date: string; note: string; amount: number }[];
}

/** One payment line on an invoice: the advances of one receipt (or, before
 *  receipts were numbered, of one save) added back together. */
export interface InvoicePayment {
  id: string;
  date: string;
  note: string;
  amount: number;
  /** The receipt it came in on — what it is corrected or cancelled through. */
  receiptId?: string;
  /** Credit the client already had, moved onto these bills — not new money. */
  fromCredit?: boolean;
}

/** One line per piece, the way it reads on the invoice itself. */
function describe(o: Order): string {
  return [
    o.productKarats,
    o.productColor,
    o.jewelleryType,
    o.designNumber ? `#${o.designNumber}` : "",
    o.productSize || "",
    o.actualDiamondWeight ? `${o.actualDiamondWeight}ct` : (o.diamondWeight ? `${o.diamondWeight}ct est` : ""),
  ].filter(Boolean).join(" · ");
}

/**
 * A client's account the way a client reads it: INVOICE by invoice, with the
 * pieces on each invoice underneath it, then what was received against it and
 * what is still outstanding.
 *
 * Order by order was our internal view — a client does not recognise an order
 * number they were never sent, they recognise the invoice they were billed on.
 */
export function buildInvoiceBlocks(
  invoices: Invoice[],
  orders: Order[],
  clientId: string,
): InvoiceBlock[] {
  const mine = orders.filter(o => o.clientId === clientId && o.status !== "Rejected");
  const blocks: InvoiceBlock[] = [];

  const lineOf = (o: Order) => ({
    orderId: o.id,
    orderNo: o.orderNumber,
    description: describe(o),
    qty: o.quantity,
    gross: orderGrossTotal(o),
    gift: o.giftCardRedeemed || 0,
    returned: returnedCredit(o),
    net: orderTotal(o),
    received: totalAdvance(o),
    balance: balanceDue(o),
  });
  const sum = (items: InvoiceBlock["items"]) => ({
    gross: items.reduce((s, i) => s + i.gross, 0),
    gift: items.reduce((s, i) => s + i.gift, 0),
    returned: Math.round(items.reduce((s, i) => s + i.returned, 0) * 100) / 100,
    net: items.reduce((s, i) => s + i.net, 0),
    received: items.reduce((s, i) => s + i.received, 0),
    balance: items.reduce((s, i) => s + i.balance, 0),
  });
  // ONE line per payment, not one per order it touched. A single transfer is
  // spread across whichever orders it settles, so listing the advances raw
  // turned $7,820 received into nine "Bank Transfer" fragments. Advances from
  // the same receipt are added back together; older ones with no receipt are
  // grouped by the moment and note they were written with, which is what a
  // single save produced.
  const paymentsOf = (os: Order[]) => {
    const byReceipt = new Map<string, { id: string; date: string; note: string; amount: number; orders: Set<string>; receiptId?: string; fromCredit: boolean }>();
    for (const o of os) {
      for (const a of o.advances || []) {
        const key = a.receiptId || `${a.createdAt}|${a.note}|${a.recordedBy}`;
        const g = byReceipt.get(key);
        if (g) { g.amount = Math.round((g.amount + a.amount) * 100) / 100; g.orders.add(o.orderNumber); g.fromCredit = g.fromCredit && !!a.fromCredit; }
        else byReceipt.set(key, {
          id: key, date: a.createdAt, note: a.note || "Payment",
          amount: a.amount, orders: new Set([o.orderNumber]),
          receiptId: a.receiptId, fromCredit: !!a.fromCredit,
        });
      }
    }
    return [...byReceipt.values()]
      .map((g): InvoicePayment => ({
        id: g.id, date: g.date, amount: g.amount,
        note: g.orders.size > 1 ? `${g.note} · ${g.orders.size} orders` : `${g.note} · ${[...g.orders][0]}`,
        ...(g.receiptId ? { receiptId: g.receiptId } : {}),
        ...(g.fromCredit ? { fromCredit: true } : {}),
      }))
      .sort((a, b) => +new Date(a.date) - +new Date(b.date));
  };

  // One line per credit note, however many of the invoice's orders it covers.
  const creditsOf = (os: Order[]) => {
    const by = new Map<string, { id: string; date: string; no: string; qty: number; amount: number; toCredit: number }>();
    for (const o of os) for (const r of o.returns ?? []) {
      const g = by.get(r.noteId) ?? { id: r.noteId, date: r.at, no: r.creditNoteNo, qty: 0, amount: 0, toCredit: 0 };
      g.qty += r.qty; g.amount = Math.round((g.amount + r.creditUsd) * 100) / 100; g.toCredit = Math.round((g.toCredit + (r.toCreditUsd || 0)) * 100) / 100;
      by.set(r.noteId, g);
    }
    return [...by.values()].map(g => ({
      id: g.id, date: g.date, amount: g.amount,
      note: `${g.no} — ${g.qty} piece${g.qty !== 1 ? "s" : ""} returned${g.toCredit > 0 ? ` · ${fmtMoney(g.toCredit)} already paid held as credit` : ""}`,
    })).sort((a, b) => +new Date(a.date) - +new Date(b.date));
  };

  for (const inv of invoices.filter(i => i.clientId === clientId)) {
    const os = invoiceOrderIds(inv)
      .map(id => mine.find(o => o.id === id))
      .filter((o): o is Order => !!o);
    const items = os.map(lineOf);
    blocks.push({
      id: inv.id, number: inv.number, date: inv.createdAt,
      items, ...sum(items), payments: paymentsOf(os), credits: creditsOf(os),
    });
  }

  // Only invoices. Work that has not been billed is deliberately NOT here: this
  // is the statement a client is sent, and it shows what they were invoiced and
  // what they have paid against it, nothing else.

  // Newest invoice first, like every other list in the app.
  return blocks.sort((a, b) => +new Date(b.date) - +new Date(a.date));
}

export function ClientInvoiceLedger({
  blocks, client, openingDebit = 0, openingCredit = 0, onExport, invoiceActions, paymentActions, creditActions,
}: {
  blocks: InvoiceBlock[];
  client: Client;
  openingDebit?: number;
  openingCredit?: number;
  onExport?: () => void;
  /** What can be done to an invoice, a payment line or a credit note — a ⋯ at
   *  the end of its line. A payment is corrected or cancelled through its
   *  receipt; kept on the line itself, which is the only place it can be aimed
   *  at the right entry. */
  invoiceActions?: (b: InvoiceBlock) => MoreAction[];
  paymentActions?: (p: InvoicePayment, b: InvoiceBlock) => MoreAction[];
  creditActions?: (c: InvoiceBlock["credits"][number], b: InvoiceBlock) => MoreAction[];
}) {
  const [q, setQ] = useState("");
  const [only, setOnly] = useState<"all" | "due" | "paid">("all");

  const filtered = useMemo(() => {
    const ql = q.trim().toLowerCase();
    return blocks.filter(b => {
      if (only === "due" && b.balance <= 0.009) return false;
      if (only === "paid" && b.balance > 0.009) return false;
      if (!ql) return true;
      return b.number.toLowerCase().includes(ql)
        || b.items.some(i => i.orderNo.toLowerCase().includes(ql) || i.description.toLowerCase().includes(ql));
    });
  }, [blocks, q, only]);

  const T = filtered.reduce((t, b) => ({
    gross: t.gross + b.gross, gift: t.gift + b.gift, returned: t.returned + b.returned,
    received: t.received + b.received, balance: t.balance + b.balance,
  }), { gross: 0, gift: 0, returned: 0, received: 0, balance: 0 });
  const closing = openingDebit - openingCredit + T.balance;

  const filters: TableFilter[] = [{ kind: "select", label: "Status", allLabel: "All", value: only === "all" ? "" : only,
    onChange: v => setOnly((v || "all") as "all" | "due" | "paid"),
    options: [{ value: "due", label: "Outstanding" }, { value: "paid", label: "Settled" }] }];

  // The balance brought forward: a line of its own, kept at the top.
  const opening: InvoiceBlock | null = openingDebit > 0 || openingCredit > 0 ? {
    id: "__opening", number: "Balance brought forward", date: "", items: [],
    gross: openingDebit, gift: 0, returned: 0, net: openingDebit, received: openingCredit, balance: openingDebit - openingCredit,
    payments: [], credits: [],
  } : null;
  const isOpening = (b: InvoiceBlock) => b.id === "__opening";
  const minus = (n: number, cls: string) => (n ? <span className={`tabular-nums whitespace-nowrap ${cls}`}>−{fmtMoney(n)}</span> : null);

  const columns: DataColumn<InvoiceBlock>[] = [
    { key: "invoice", header: "Invoice", always: true, sortValue: b => b.number, csv: b => b.number,
      cell: b => isOpening(b)
        ? <span className="font-medium text-brand-dark">Balance brought forward</span>
        : <span className="inline-flex items-center gap-1.5 font-medium text-brand-dark whitespace-nowrap"><FileText className="h-3.5 w-3.5 text-primary" />{b.number}</span> },
    { key: "date", header: "Date", kind: "date", sortValue: b => b.date || null, csv: b => (b.date ? fmtDate(b.date) : ""),
      cell: b => (b.date ? <CellDate>{fmtDate(b.date)}</CellDate> : null) },
    { key: "pieces", header: "Pieces", sortValue: b => b.items.length, csv: b => String(b.items.length),
      cell: b => (isOpening(b) ? null : <span className="text-xs text-muted-foreground whitespace-nowrap">{b.items.length} piece{b.items.length !== 1 ? "s" : ""}</span>) },
    { key: "billed", header: "Billed", align: "right", kind: "number", sortValue: b => b.gross, csv: b => b.gross,
      cell: b => (b.gross ? <CellAmount>{fmtMoney(b.gross)}</CellAmount> : null) },
    { key: "gift", header: "Gift card", align: "right", kind: "number", sortValue: b => b.gift, csv: b => b.gift || "", hideIfEmpty: true,
      cell: b => minus(b.gift, "text-primary") },
    { key: "returned", header: "Returned", align: "right", kind: "number", sortValue: b => b.returned, csv: b => b.returned || "", hideIfEmpty: true,
      cell: b => minus(b.returned, "text-amber-800") },
    { key: "received", header: "Received", align: "right", kind: "number", sortValue: b => b.received, csv: b => b.received || "",
      cell: b => (b.received ? <CellAmount tone="in">{fmtMoney(b.received)}</CellAmount> : null) },
    { key: "balance", header: "Balance", align: "right", kind: "number", sortValue: b => b.balance, csv: b => b.balance,
      cell: b => (isOpening(b)
        ? <CellAmount>{fmtMoney(b.balance)}</CellAmount>
        : b.balance > 0.009 ? <CellAmount tone="out">{fmtMoney(b.balance)}</CellAmount> : <span className="text-success font-semibold whitespace-nowrap">Cleared</span>) },
  ];

  // An invoice opened: its pieces, then its credit notes and payments — each with its own ⋯.
  type Line = { id: string; kind: "piece" | "credit" | "payment"; what: ReactNode; detail: ReactNode;
    billed?: number; gift?: number; returned?: number; received?: number; balance?: number; actions?: MoreAction[] };
  const linesOf = (b: InvoiceBlock): Line[] => [
    ...b.items.map((i): Line => ({
      id: `p-${i.orderId}`, kind: "piece",
      what: <Link to={`/orders/${i.orderId}`} className="font-mono text-primary hover:underline whitespace-nowrap">{i.orderNo}</Link>,
      detail: <span className="inline-flex items-center gap-1.5"><Package className="h-3 w-3 shrink-0" />{i.description || "—"}{i.qty > 1 ? ` × ${i.qty}` : ""}</span>,
      billed: i.gross, gift: i.gift, returned: i.returned, received: i.received, balance: i.balance,
    })),
    ...b.credits.map((c): Line => ({
      id: `c-${c.id}`, kind: "credit", what: <span className="text-muted-foreground whitespace-nowrap">{fmtDate(c.date)}</span>,
      detail: <span className="inline-flex items-center gap-1.5"><Undo2 className="h-3 w-3 shrink-0 text-amber-700" />Credit note {c.note}</span>,
      returned: c.amount, actions: creditActions?.(c, b),
    })),
    ...b.payments.map((p): Line => ({
      id: `r-${p.id}`, kind: "payment", what: <span className="text-muted-foreground whitespace-nowrap">{fmtDate(p.date)}</span>,
      detail: <span>Payment received — {p.note}</span>,
      received: p.amount, actions: paymentActions?.(p, b),
    })),
  ];
  const lineCols: DataColumn<Line>[] = [
    { key: "what", header: "Order / date", always: true, cell: l => l.what },
    { key: "detail", header: "Detail", cell: l => <span className="text-xs text-muted-foreground">{l.detail}</span> },
    { key: "billed", header: "Billed", align: "right", cell: l => (l.billed ? <span className="tabular-nums whitespace-nowrap">{fmtMoney(l.billed)}</span> : null) },
    { key: "gift", header: "Gift card", align: "right", cell: l => (l.gift ? minus(l.gift, "text-primary") : null) },
    { key: "returned", header: "Returned", align: "right", cell: l => (l.returned ? minus(l.returned, "text-amber-800") : null) },
    { key: "received", header: "Received", align: "right", cell: l => (l.received ? <span className="tabular-nums whitespace-nowrap text-success font-medium">{fmtMoney(l.received)}</span> : null) },
    { key: "balance", header: "Balance", align: "right", cell: l => (l.kind === "piece" ? <span className="tabular-nums whitespace-nowrap">{(l.balance ?? 0) > 0.009 ? fmtMoney(l.balance!) : "—"}</span> : null) },
  ];

  return (
    <div className="card-luxe overflow-hidden">
      <div className="px-5 py-4 border-b border-border/60">
        <SectionTitle title="Invoice Statement" sub={client.companyName}
          info="Open an invoice for its pieces and payments. Only invoiced work is here — an order not billed yet isn't on the client's account." />
      </div>
      {/* The app's one table — the same toolbar (search, Filters, the count, the arrows,
          View, Export), table or cards, as every other list; an invoice opens into its lines. */}
      <div className="px-5 py-4">
        <DataTable
          id="client-invoice-statement"
          noun="invoice"
          rows={filtered}
          columns={columns}
          rowKey={b => b.id}
          search={{ value: q, onChange: setQ, placeholder: "Search invoice, order or item…", ariaLabel: "Search invoice, order or item" }}
          filters={filters}
          onClearFilters={() => setOnly("all")}
          exports={onExport ? [{ label: "PDF or Excel", icon: Download, hint: "The statement, invoice by invoice", onSelect: onExport }] : undefined}
          exportScope="Pick the invoices or dates, then the file"
          pinnedRows={opening ? [opening] : undefined}
          pinnedAt="top"
          rowActions={invoiceActions ? (b => (isOpening(b) ? [] : invoiceActions(b))) : undefined}
          expand={{
            can: b => !isOpening(b) && b.items.length + b.credits.length + b.payments.length > 0,
            render: b => (
              <DataTable id="client-invoice-lines" controls="none" noun="line" rows={linesOf(b)} columns={lineCols} rowKey={l => l.id}
                details={false} rowActions={l => l.actions ?? []} />
            ),
          }}
          details={false}
          totalsLabel="Totals"
          totals={{
            billed: () => <span>{fmtMoney(T.gross + openingDebit)}</span>,
            gift: () => (T.gift ? <span className="text-primary">−{fmtMoney(T.gift)}</span> : null),
            returned: () => (T.returned ? <span className="text-amber-800">−{fmtMoney(T.returned)}</span> : null),
            received: () => <span className="text-success">{fmtMoney(T.received + openingCredit)}</span>,
            balance: () => <span className={closing > 0.009 ? "text-destructive" : "text-success"}>{fmtMoney(Math.max(0, closing))}</span>,
          }}
          emptyText={blocks.length ? "No invoices match." : "No invoices yet."}
          summary={
            // The statement's own totals: invoices only. The page's figures above
            // also count orders not billed yet, so these are a different sum.
            <StatStrip items={[
              { label: "Invoiced", value: fmtMoney(T.gross), icon: FileText },
              ...(T.gift > 0.009 ? [{ label: "Gift card used", value: fmtMoney(T.gift), icon: Gift }] : []),
              ...(T.returned > 0 ? [{ label: "Returned", value: fmtMoney(T.returned), icon: Undo2 }] : []),
              { label: "Received on invoices", value: fmtMoney(T.received), tone: "in" as const },
              // Outstanding counts the balance brought forward, so no signs between them.
              { label: "Due on invoices", value: fmtMoney(Math.max(0, closing)), tone: closing > 0.009 ? "out" as const : "in" as const,
                sub: openingDebit > 0 || openingCredit > 0 ? "With the balance brought forward" : undefined },
            ]} note={q || only !== "all" ? "For the invoices shown" : "Invoices only — orders not billed yet are in the figures above"} />
          }
        />
      </div>
    </div>
  );
}
