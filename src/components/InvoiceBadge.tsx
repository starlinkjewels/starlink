import { FileText } from "lucide-react";
import { orderIsDispatched, type Order } from "@/lib/db";

/** A piece that ought to be on an invoice by now: it has shipped, it belongs to
 *  a client, and it was not rejected. Anything else has nothing to bill yet. */
export function needsInvoice(o: Order): boolean {
  return orderIsDispatched(o) && !o.forReadyStock && o.status !== "Rejected";
}

/**
 * Whether this piece has been billed, said where its price is.
 *
 * Billing is done a parcel at a time, and an order left out of one simply
 * stopped being mentioned — it looked exactly like an order that had been
 * invoiced, and the only way to find it was to open the Invoices page and work
 * out what was missing. A billed piece carries its invoice number in red; a
 * dispatched piece with none says so.
 *
 * Only dispatched work is marked as missing one: a piece still in production
 * has nothing to be billed for yet, and flagging it would be noise on every
 * card in the list. `size="md"` is the order screen's, beside the order value.
 */
export function InvoiceBadge({ invoice, dispatched, onOpen, className = "", size = "sm" }: {
  invoice?: { number: string };
  dispatched: boolean;
  onOpen: (number: string) => void;
  className?: string;
  size?: "sm" | "md";
}) {
  const box = size === "md" ? "h-7 px-2.5 text-xs gap-1.5 rounded-lg" : "h-6 px-2 text-[11px] gap-1 rounded-md";
  const icon = size === "md" ? "h-3.5 w-3.5" : "h-3 w-3";
  if (!invoice && !dispatched) return null;
  if (!invoice) {
    return (
      <span title="Dispatched, but not on any invoice yet" className={`inline-flex items-center font-bold bg-amber-500/15 border border-amber-500/40 text-amber-700 whitespace-nowrap ${box} ${className}`}>
        <FileText className={`${icon} shrink-0`} /> NO INVOICE
      </span>
    );
  }
  return (
    <button
      type="button"
      title={`On invoice ${invoice.number} — open it`}
      onClick={e => { e.preventDefault(); e.stopPropagation(); onOpen(invoice.number); }}
      className={`inline-flex items-center font-bold bg-destructive border border-destructive text-white hover:bg-destructive/85 shadow-sm whitespace-nowrap min-w-0 ${box} ${className}`}
    >
      <FileText className={`${icon} shrink-0`} /><span className="opacity-80 font-semibold">INV</span><span className="truncate">{invoice.number}</span>
    </button>
  );
}
