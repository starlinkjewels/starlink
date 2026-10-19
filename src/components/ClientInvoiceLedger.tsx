import { useMemo, useState } from "react";
import { TableBox } from "@/components/TableBox";
import { Link } from "react-router-dom";
import {
  fmtMoney, fmtDate, orderTotal, orderGrossTotal, totalAdvance, balanceDue, returnedCredit,
  invoiceOrderIds, type Order, type Invoice, type Client,
} from "@/lib/db";
import { Search, Download, ChevronDown, FileText, Package, Undo2, X, Gift } from "lucide-react";
import { useMayExport } from "@/hooks/useCan";
import { ExportMenu, FilterChips, FiltersButton, StatStrip, type TableFilter } from "@/components/TableToolbar";
import { MoreMenu, type MoreAction } from "@/components/MoreMenu";
import { SectionTitle } from "@/components/SectionTitle";

// The shared DataTable's header and cell classes, so this table reads the same.
const TH = "px-3 py-3 text-[11px] font-bold uppercase tracking-wider whitespace-nowrap text-brand-dark/70";
const TD = "px-3 py-2.5 tabular-nums whitespace-nowrap";
/** A line under an opened invoice — a piece, a credit note, a payment. */
const SUB = "px-3 py-1.5 tabular-nums whitespace-nowrap";

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
  const acts = !!(invoiceActions || paymentActions || creditActions);
  const cols = acts ? 10 : 9;
  // The ⋯ cell. Clicks inside it (the menu too — React bubbles through its
  // portal) must not open or close the invoice row.
  const menuCell = (actions: MoreAction[] | undefined, title: string) => (acts ? (
    <td className="w-12 px-2 py-1.5 text-right" onClick={e => e.stopPropagation()}>
      {actions && <MoreMenu size="sm" label="Row actions" title={title} actions={actions} />}
    </td>
  ) : null);
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<Set<string>>(new Set());
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

  const mayExport = useMayExport();
  const filters: TableFilter[] = [{ kind: "select", label: "Status", allLabel: "All", value: only === "all" ? "" : only,
    onChange: v => setOnly((v || "all") as "all" | "due" | "paid"),
    options: [{ value: "due", label: "Outstanding" }, { value: "paid", label: "Settled" }] }];
  const countText = `${filtered.length} invoice${filtered.length === 1 ? "" : "s"}`;

  const toggle = (id: string) =>
    setOpen(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });

  return (
    <div className="card-luxe overflow-hidden">
      <div className="px-5 py-4 border-b border-border/60">
        <SectionTitle title="Invoice Statement" sub={client.companyName}
          info="Tap an invoice for its pieces and payments. Only invoiced work is here — an order not billed yet isn't on the client's account." />
      </div>

      {/* The same one-row toolbar as every table: search, Filters, the count,
          Export — and the statement's own totals in one quiet line under it. */}
      <div className="px-5 pt-4 space-y-2.5">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[12rem] sm:max-w-sm max-sm:basis-full">
            <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
            <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search invoice, order or item…" aria-label="Search invoice, order or item"
              className="h-9 w-full rounded-xl border border-border bg-white pl-9 pr-8 text-sm placeholder:text-muted-foreground/80 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/40" />
            {q && <button type="button" onClick={() => setQ("")} aria-label="Clear search" className="absolute right-1.5 top-1/2 -translate-y-1/2 h-6 w-6 grid place-items-center rounded-md text-muted-foreground hover:bg-secondary hover:text-foreground"><X className="h-3.5 w-3.5" /></button>}
          </div>
          <FiltersButton filters={filters} onClear={() => setOnly("all")} count={countText} />
          <div className="ml-auto flex items-center gap-2">
            <span className="text-xs text-muted-foreground tabular-nums whitespace-nowrap">{countText}</span>
            {onExport && mayExport && <ExportMenu scope="Pick the invoices or dates, then the file"
              exports={[{ label: "PDF or Excel", icon: Download, hint: "The statement, invoice by invoice", onSelect: onExport }]} />}
          </div>
        </div>
        <FilterChips filters={filters} onClear={() => setOnly("all")} />
        {/* The statement's own totals: invoices only. The page's figures above
            also count orders not billed yet, so these are a different sum. */}
        <StatStrip items={[
          { label: "Invoiced", value: fmtMoney(T.gross), icon: FileText },
          ...(T.gift > 0.009 ? [{ label: "Gift card used", value: fmtMoney(T.gift), icon: Gift }] : []),
          ...(T.returned > 0 ? [{ label: "Returned", value: fmtMoney(T.returned), icon: Undo2 }] : []),
          { label: "Received on invoices", value: fmtMoney(T.received), tone: "in" as const },
          // Outstanding counts the balance brought forward, so no signs between them.
          { label: "Due on invoices", value: fmtMoney(Math.max(0, closing)), tone: closing > 0.009 ? "out" as const : "in" as const,
            sub: openingDebit > 0 || openingCredit > 0 ? "With the balance brought forward" : undefined },
        ]} note={q || only !== "all" ? "For the invoices shown" : "Invoices only — orders not billed yet are in the figures above"} />
      </div>

      {/* Drawn like the app's shared DataTable — the same box, header and cell
          spacing — but kept as its own table: an invoice opens into its pieces,
          credit notes and payments, which are rows of this table, not a panel. */}
      <div className="px-5 pb-4">
      <TableBox>
        <table className="w-full text-sm min-w-[900px]">
          <thead className="bg-secondary/40">
            <tr className="border-b border-border/60">
              <th className="w-10 px-2 py-3"><span className="sr-only">Details</span></th>
              <th className={`${TH} text-left`}>Invoice</th>
              <th className={`${TH} text-left`}>Date</th>
              <th className={`${TH} text-left`}>Pieces</th>
              <th className={`${TH} text-right`}>Billed</th>
              <th className={`${TH} text-right`}>Gift card</th>
              <th className={`${TH} text-right`}>Returned</th>
              <th className={`${TH} text-right`}>Received</th>
              <th className={`${TH} text-right`}>Balance</th>
              {acts && <th className="w-12 px-2 py-3"><span className="sr-only">Actions</span></th>}
            </tr>
          </thead>
          <tbody>
            {openingDebit > 0 || openingCredit > 0 ? (
              <tr className="bg-amber-500/5">
                <td />
                <td className="px-3 py-2.5 font-medium" colSpan={3}>Balance brought forward</td>
                <td className={`${TD} text-right`}>{openingDebit ? fmtMoney(openingDebit) : ""}</td>
                <td />
                <td />
                <td className={`${TD} text-right text-success`}>{openingCredit ? fmtMoney(openingCredit) : ""}</td>
                <td className={`${TD} text-right font-semibold`}>{fmtMoney(openingDebit - openingCredit)}</td>
                {acts && <td />}
              </tr>
            ) : null}
            {filtered.length === 0 ? (
              <tr><td colSpan={cols} className="px-3 py-12 text-center text-sm text-muted-foreground">{blocks.length ? "No invoices match." : "No invoices yet."}</td></tr>
            ) : filtered.map(b => (
              <>
                <tr key={b.id} onClick={() => toggle(b.id)}
                  className={`transition-colors hover:bg-secondary/30 cursor-pointer ${open.has(b.id) ? "bg-secondary/30" : ""}`}>
                  <td className="w-10 px-2 py-2.5 text-center text-muted-foreground">
                    <ChevronDown className={`inline h-4 w-4 transition-transform ${open.has(b.id) ? "rotate-180" : ""}`} />
                  </td>
                  <td className="px-3 py-2.5 font-medium text-brand-dark whitespace-nowrap">
                    <span className="inline-flex items-center gap-1.5"><FileText className="h-3.5 w-3.5 text-primary" />{b.number}</span>
                  </td>
                  <td className="px-3 py-2.5 text-muted-foreground tabular-nums whitespace-nowrap">{fmtDate(b.date)}</td>
                  <td className="px-3 py-2.5 text-xs text-muted-foreground">{b.items.length} piece{b.items.length !== 1 ? "s" : ""}</td>
                  <td className={`${TD} text-right font-semibold text-brand-dark`}>{fmtMoney(b.gross)}</td>
                  <td className={`${TD} text-right text-primary`}>{b.gift ? `−${fmtMoney(b.gift)}` : ""}</td>
                  <td className={`${TD} text-right text-amber-800`}>{b.returned ? `−${fmtMoney(b.returned)}` : ""}</td>
                  <td className={`${TD} text-right text-success`}>{b.received ? fmtMoney(b.received) : ""}</td>
                  <td className={`${TD} text-right font-semibold ${b.balance > 0.009 ? "text-destructive" : "text-success"}`}>
                    {b.balance > 0.009 ? fmtMoney(b.balance) : "Cleared"}
                  </td>
                  {menuCell(invoiceActions?.(b), `Invoice ${b.number}`)}
                </tr>

                {open.has(b.id) && b.items.map(i => (
                  <tr key={`${b.id}-${i.orderId}`} className="bg-secondary/20 text-xs">
                    <td />
                    <td className="px-3 py-1.5 whitespace-nowrap">
                      <Link to={`/orders/${i.orderId}`} onClick={e => e.stopPropagation()}
                        className="font-mono text-primary hover:underline">{i.orderNo}</Link>
                    </td>
                    <td colSpan={2} className="px-3 py-1.5 text-muted-foreground">
                      <span className="inline-flex items-center gap-1.5"><Package className="h-3 w-3" />{i.description || "—"}</span>
                      {i.qty > 1 && <span className="ml-1.5">× {i.qty}</span>}
                    </td>
                    <td className={`${SUB} text-right`}>{fmtMoney(i.gross)}</td>
                    <td className={`${SUB} text-right text-primary`}>{i.gift ? `−${fmtMoney(i.gift)}` : ""}</td>
                    <td className={`${SUB} text-right text-amber-800`}>{i.returned ? `−${fmtMoney(i.returned)}` : ""}</td>
                    <td className={`${SUB} text-right text-success`}>{i.received ? fmtMoney(i.received) : ""}</td>
                    <td className={`${SUB} text-right`}>{i.balance > 0.009 ? fmtMoney(i.balance) : "—"}</td>
                    {acts && <td />}
                  </tr>
                ))}

                {open.has(b.id) && b.credits.map(c => (
                  <tr key={`${b.id}-${c.id}`} className="bg-amber-500/5 text-xs">
                    <td />
                    <td className="px-3 py-1.5 text-muted-foreground tabular-nums whitespace-nowrap">{fmtDate(c.date)}</td>
                    <td colSpan={4} className="px-3 py-1.5 text-muted-foreground"><span className="inline-flex items-center gap-1.5"><Undo2 className="h-3 w-3 text-amber-700" />Credit note {c.note}</span></td>
                    <td className={`${SUB} text-right text-amber-800 font-medium`}>−{fmtMoney(c.amount)}</td>
                    <td colSpan={2} />
                    {menuCell(creditActions?.(c, b), "Credit note")}
                  </tr>
                ))}

                {open.has(b.id) && b.payments.map(p => (
                  <tr key={`${b.id}-${p.id}`} className="bg-success/5 text-xs">
                    <td />
                    <td className="px-3 py-1.5 text-muted-foreground tabular-nums whitespace-nowrap">{fmtDate(p.date)}</td>
                    <td colSpan={5} className="px-3 py-1.5 text-muted-foreground">Payment received — {p.note}</td>
                    <td className={`${SUB} text-right text-success font-medium`}>{fmtMoney(p.amount)}</td>
                    <td />
                    {menuCell(paymentActions?.(p, b), "Payment")}
                  </tr>
                ))}
              </>
            ))}
          </tbody>
          <tfoot className="border-t-2 border-border/70 bg-secondary/30">
            <tr className="font-bold text-brand-dark">
              <td />
              <td className="px-3 py-2.5 text-xs uppercase tracking-wider" colSpan={3}>Totals</td>
              <td className={`${TD} text-right`}>{fmtMoney(T.gross + openingDebit)}</td>
              <td className={`${TD} text-right text-primary`}>{T.gift ? `−${fmtMoney(T.gift)}` : ""}</td>
              <td className={`${TD} text-right text-amber-800`}>{T.returned ? `−${fmtMoney(T.returned)}` : ""}</td>
              <td className={`${TD} text-right text-success`}>{fmtMoney(T.received + openingCredit)}</td>
              <td className={`${TD} text-right ${closing > 0.009 ? "text-destructive" : "text-success"}`}>
                {fmtMoney(Math.max(0, closing))}
              </td>
              {acts && <td />}
            </tr>
          </tfoot>
        </table>
      </TableBox>
      </div>
    </div>
  );
}
