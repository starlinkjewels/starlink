import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  fmtMoney, fmtDate, orderTotal, orderGrossTotal, totalAdvance, balanceDue,
  invoiceOrderIds, type Order, type Invoice, type Client,
} from "@/lib/db";
import { Input } from "@/components/ui/input";
import { Search, Download, ChevronRight, FileText, Package } from "lucide-react";

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
    net: number;
    received: number;
    balance: number;
  }[];
  gross: number;
  gift: number;
  net: number;
  received: number;
  balance: number;
  /** Payments received against this invoice's orders, for the drill-down. */
  payments: { id: string; date: string; note: string; amount: number }[];
}

/** One line per piece, the way it reads on the invoice itself. */
function describe(o: Order): string {
  return [
    o.productKarats,
    o.productColor,
    o.jewelleryType,
    o.designNumber ? `#${o.designNumber}` : "",
    o.productSize ? `size ${o.productSize}` : "",
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
    net: orderTotal(o),
    received: totalAdvance(o),
    balance: balanceDue(o),
  });
  const sum = (items: InvoiceBlock["items"]) => ({
    gross: items.reduce((s, i) => s + i.gross, 0),
    gift: items.reduce((s, i) => s + i.gift, 0),
    net: items.reduce((s, i) => s + i.net, 0),
    received: items.reduce((s, i) => s + i.received, 0),
    balance: items.reduce((s, i) => s + i.balance, 0),
  });
  const paymentsOf = (os: Order[]) =>
    os.flatMap(o => (o.advances || []).map(a => ({
      id: a.id, date: a.createdAt, note: `${a.note || "Payment"} · ${o.orderNumber}`, amount: a.amount,
    }))).sort((a, b) => +new Date(a.date) - +new Date(b.date));

  for (const inv of invoices.filter(i => i.clientId === clientId)) {
    const os = invoiceOrderIds(inv)
      .map(id => mine.find(o => o.id === id))
      .filter((o): o is Order => !!o);
    const items = os.map(lineOf);
    blocks.push({
      id: inv.id, number: inv.number, date: inv.createdAt,
      items, ...sum(items), payments: paymentsOf(os),
    });
  }

  // Only invoices. Work that has not been billed is deliberately NOT here: this
  // is the statement a client is sent, and it shows what they were invoiced and
  // what they have paid against it, nothing else.

  return blocks.sort((a, b) => +new Date(a.date) - +new Date(b.date));
}

export function ClientInvoiceLedger({
  blocks, client, openingDebit = 0, openingCredit = 0, onExport, onReversePayment,
}: {
  blocks: InvoiceBlock[];
  client: Client;
  openingDebit?: number;
  openingCredit?: number;
  onExport?: () => void;
  /** Reverse a payment recorded in error. Kept on the payment row itself, which
   *  is the only place it can be aimed at the right entry. */
  onReversePayment?: (createdAt: string) => void;
}) {
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
    gross: t.gross + b.gross, gift: t.gift + b.gift,
    received: t.received + b.received, balance: t.balance + b.balance,
  }), { gross: 0, gift: 0, received: 0, balance: 0 });
  const closing = openingDebit - openingCredit + T.balance;

  const toggle = (id: string) =>
    setOpen(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });

  return (
    <div className="card-luxe overflow-hidden">
      <div className="px-5 py-4 border-b border-border/60 flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="font-display text-xl text-brand-dark">Invoice Statement</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            {client.companyName} · invoice by invoice, with the pieces on each one
          </p>
        </div>
        {onExport && (
          <button onClick={onExport}
            className="flex items-center gap-1.5 h-9 px-3 rounded-xl border border-border bg-white hover:bg-secondary text-xs font-medium text-brand-dark shrink-0">
            <Download className="h-4 w-4" /> Export
          </button>
        )}
      </div>

      <div className="px-5 pt-4 grid grid-cols-2 lg:grid-cols-4 gap-2.5">
        <div className="rounded-xl p-3 text-center bg-secondary/60 text-brand-dark">
          <p className="text-[10px] uppercase tracking-wider opacity-70">Billed</p>
          <p className="text-base font-semibold mt-0.5">{fmtMoney(T.gross)}</p>
        </div>
        <div className="rounded-xl p-3 text-center bg-primary/10 text-primary">
          <p className="text-[10px] uppercase tracking-wider opacity-80">Gift card used</p>
          <p className="text-base font-semibold mt-0.5">{fmtMoney(T.gift)}</p>
        </div>
        <div className="rounded-xl p-3 text-center bg-success/10 text-success">
          <p className="text-[10px] uppercase tracking-wider opacity-80">Received</p>
          <p className="text-base font-semibold mt-0.5">{fmtMoney(T.received)}</p>
        </div>
        <div className={`rounded-xl p-3 text-center ${closing > 0.009 ? "bg-destructive/10 text-destructive" : "bg-success/10 text-success"}`}>
          <p className="text-[10px] uppercase tracking-wider opacity-80">Outstanding</p>
          <p className="text-base font-semibold mt-0.5">{fmtMoney(Math.max(0, closing))}</p>
        </div>
      </div>

      <div className="px-5 py-3 flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[180px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input value={q} onChange={e => setQ(e.target.value)}
            placeholder="Search invoice, order or item…" className="rounded-xl h-9 pl-9" />
        </div>
        <div className="inline-flex rounded-lg bg-secondary p-0.5">
          {(["all", "due", "paid"] as const).map(k => (
            <button key={k} onClick={() => setOnly(k)}
              className={`px-3 h-8 rounded-md text-xs font-medium ${only === k ? "bg-white shadow-soft text-brand-dark" : "text-muted-foreground"}`}>
              {k === "all" ? "All" : k === "due" ? "Outstanding" : "Settled"}
            </button>
          ))}
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm min-w-[820px]">
          <thead className="bg-secondary/60 text-muted-foreground text-xs">
            <tr>
              <th className="px-4 py-2 text-left font-semibold w-8" />
              <th className="px-2 py-2 text-left font-semibold">Invoice</th>
              <th className="px-2 py-2 text-left font-semibold">Date</th>
              <th className="px-2 py-2 text-left font-semibold">Pieces</th>
              <th className="px-2 py-2 text-right font-semibold">Billed</th>
              <th className="px-2 py-2 text-right font-semibold">Gift card</th>
              <th className="px-2 py-2 text-right font-semibold">Received</th>
              <th className="px-4 py-2 text-right font-semibold">Balance</th>
            </tr>
          </thead>
          <tbody>
            {openingDebit > 0 || openingCredit > 0 ? (
              <tr className="border-t border-border/40 bg-amber-500/5">
                <td />
                <td className="px-2 py-2.5 font-medium" colSpan={3}>Balance brought forward</td>
                <td className="px-2 py-2.5 text-right">{openingDebit ? fmtMoney(openingDebit) : ""}</td>
                <td />
                <td className="px-2 py-2.5 text-right text-success">{openingCredit ? fmtMoney(openingCredit) : ""}</td>
                <td className="px-4 py-2.5 text-right font-semibold">{fmtMoney(openingDebit - openingCredit)}</td>
              </tr>
            ) : null}
            {filtered.length === 0 ? (
              <tr><td colSpan={8} className="px-5 py-10 text-center text-muted-foreground">Nothing to show.</td></tr>
            ) : filtered.map(b => (
              <>
                <tr key={b.id} onClick={() => toggle(b.id)}
                  className="border-t border-border/40 hover:bg-secondary/30 cursor-pointer">
                  <td className="px-4 py-2.5 text-muted-foreground">
                    <ChevronRight className={`h-4 w-4 transition-transform ${open.has(b.id) ? "rotate-90" : ""}`} />
                  </td>
                  <td className="px-2 py-2.5 font-medium whitespace-nowrap">
                    <span className="inline-flex items-center gap-1.5"><FileText className="h-3.5 w-3.5 text-primary" />{b.number}</span>
                  </td>
                  <td className="px-2 py-2.5 text-xs text-muted-foreground whitespace-nowrap">{fmtDate(b.date)}</td>
                  <td className="px-2 py-2.5 text-xs text-muted-foreground">{b.items.length} piece{b.items.length !== 1 ? "s" : ""}</td>
                  <td className="px-2 py-2.5 text-right font-medium">{fmtMoney(b.gross)}</td>
                  <td className="px-2 py-2.5 text-right text-primary">{b.gift ? `−${fmtMoney(b.gift)}` : ""}</td>
                  <td className="px-2 py-2.5 text-right text-success">{b.received ? fmtMoney(b.received) : ""}</td>
                  <td className={`px-4 py-2.5 text-right font-semibold ${b.balance > 0.009 ? "text-destructive" : "text-success"}`}>
                    {b.balance > 0.009 ? fmtMoney(b.balance) : "Cleared"}
                  </td>
                </tr>

                {open.has(b.id) && b.items.map(i => (
                  <tr key={`${b.id}-${i.orderId}`} className="bg-secondary/20 text-xs">
                    <td />
                    <td className="px-2 py-1.5 whitespace-nowrap">
                      <Link to={`/orders/${i.orderId}`} onClick={e => e.stopPropagation()}
                        className="font-mono text-primary hover:underline">{i.orderNo}</Link>
                    </td>
                    <td colSpan={2} className="px-2 py-1.5 text-muted-foreground">
                      <span className="inline-flex items-center gap-1.5"><Package className="h-3 w-3" />{i.description || "—"}</span>
                      {i.qty > 1 && <span className="ml-1.5">× {i.qty}</span>}
                    </td>
                    <td className="px-2 py-1.5 text-right">{fmtMoney(i.gross)}</td>
                    <td className="px-2 py-1.5 text-right text-primary">{i.gift ? `−${fmtMoney(i.gift)}` : ""}</td>
                    <td className="px-2 py-1.5 text-right text-success">{i.received ? fmtMoney(i.received) : ""}</td>
                    <td className="px-4 py-1.5 text-right">{i.balance > 0.009 ? fmtMoney(i.balance) : "—"}</td>
                  </tr>
                ))}

                {open.has(b.id) && b.payments.map(p => (
                  <tr key={`${b.id}-${p.id}`} className="bg-success/5 text-xs">
                    <td />
                    <td className="px-2 py-1.5 text-muted-foreground whitespace-nowrap">{fmtDate(p.date)}</td>
                    <td colSpan={4} className="px-2 py-1.5 text-muted-foreground">{p.note}</td>
                    <td className="px-2 py-1.5 text-right text-success font-medium">{fmtMoney(p.amount)}</td>
                    <td className="px-2 py-1.5 text-right">
                      {onReversePayment && (
                        <button onClick={e => { e.stopPropagation(); onReversePayment(p.date); }}
                          title="Reverse this payment"
                          className="text-[11px] text-muted-foreground hover:text-destructive hover:underline">
                          reverse
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </>
            ))}
          </tbody>
          <tfoot>
            <tr className="bg-secondary/60 font-semibold border-t-2 border-border">
              <td />
              <td className="px-2 py-2.5" colSpan={3}>Totals</td>
              <td className="px-2 py-2.5 text-right">{fmtMoney(T.gross + openingDebit)}</td>
              <td className="px-2 py-2.5 text-right text-primary">{T.gift ? `−${fmtMoney(T.gift)}` : ""}</td>
              <td className="px-2 py-2.5 text-right text-success">{fmtMoney(T.received + openingCredit)}</td>
              <td className={`px-4 py-2.5 text-right ${closing > 0.009 ? "text-destructive" : "text-success"}`}>
                {fmtMoney(Math.max(0, closing))}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
      <p className="px-5 py-2 text-[11px] text-muted-foreground border-t border-border/40">
        Tap an invoice to see the pieces on it and the payments received against it. Only invoiced work appears
        here — an order that has not been billed yet is not on the client’s account.
      </p>
    </div>
  );
}
