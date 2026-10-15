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
 * out what was missing. A billed piece carries its invoice number in green; a
 * dispatched piece with none says so — in plain words, not a badge.
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
  // Plain words, not a badge: a quiet green invoice number (it opens the
  // invoice), or a quiet amber note when a dispatched piece has none.
  const text = size === "md" ? "text-sm" : "text-xs";
  const icon = size === "md" ? "h-3.5 w-3.5" : "h-3 w-3";
  if (!invoice && !dispatched) return null;
  if (!invoice) {
    return (
      <span title="Dispatched, but not on any invoice yet" className={`inline-flex items-center gap-1 font-normal text-amber-600 whitespace-nowrap ${text} ${className}`}>
        <FileText className={`${icon} shrink-0`} /> No invoice
      </span>
    );
  }
  return (
    <button
      type="button"
      title={`On invoice ${invoice.number} — open it`}
      onClick={e => { e.preventDefault(); e.stopPropagation(); onOpen(invoice.number); }}
      className={`inline-flex items-center gap-1 font-normal text-success hover:underline underline-offset-2 whitespace-nowrap min-w-0 ${text} ${className}`}
    >
      <FileText className={`${icon} shrink-0`} /><span className="truncate">INV {invoice.number}</span>
    </button>
  );
}
