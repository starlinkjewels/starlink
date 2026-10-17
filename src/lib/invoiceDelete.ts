// Deleting an invoice raised by mistake.
//
// Only the bill goes: the orders, their payments, the client's ledger and every
// report read the ORDERS, never the invoice, so none of them moves. That is
// also why it is only allowed while nothing has happened on the bill — once
// its pieces have shipped, or money or a credit note has been put against it,
// the bill is part of the books and is corrected with a return / credit note
// (or by cancelling the receipt), never by making it disappear.
import { toast } from "sonner";
import {
  ensureCollections, loadDb, updateDbAs, fmtMoney, invoiceOrderIds, orderIsDispatched, totalAdvance,
  type DB, type Invoice, type Order,
} from "./db";
import { companyIdOfInvoice } from "./companies";
import { releaseInvoiceNumber } from "./counters";
import { confirmBox } from "./confirm";

/** Why this invoice can't be deleted; undefined when it can. */
export function invoiceDeleteBlocker(db: DB, inv: Invoice): string | undefined {
  const orders = invoiceOrderIds(inv).map(id => db.orders.find(o => o.id === id)).filter((o): o is Order => !!o);
  if (orders.some(orderIsDispatched)) return "Dispatched and billed — record a return / credit note instead";
  const notes = [...new Set(orders.flatMap(o => (o.returns ?? []).map(r => r.creditNoteNo)))];
  if (notes.length) return `Has credit note ${notes.join(", ")} — cancel the return first`;
  const paid = orders.reduce((s, o) => s + totalAdvance(o), 0);
  if (paid > 0.009) return `${fmtMoney(paid)} received against it — cancel those receipts first`;
  return undefined;
}

/**
 * Ask, then delete the invoice: the bill is removed, receipts that named it
 * stop pointing at it, and its number is handed back when it was the newest
 * (each company keeps its own series). Returns whether it was deleted.
 */
export async function deleteInvoiceFlow(invoiceId: string): Promise<boolean> {
  // Receipts that name the invoice are cleared with it — so they must be here.
  await ensureCollections(["clientReceipts"]);
  const db = loadDb();
  const inv = (db.invoices ?? []).find(i => i.id === invoiceId);
  if (!inv) { toast.error("That invoice is no longer there"); return false; }
  const why = invoiceDeleteBlocker(db, inv);
  if (why) { toast.error(why); return false; }
  const client = db.clients.find(c => c.id === inv.clientId)?.companyName ?? "the client";
  const named = (db.clientReceipts ?? []).filter(r => r.invoiceId === inv.id);
  const n = invoiceOrderIds(inv).length;
  const lines = [
    `• the bill to ${client} is removed — its ${n} order${n !== 1 ? "s" : ""}, the client's ledger and every report stay exactly as they are`,
    "• the orders can be invoiced again once they are dispatched",
  ];
  if (named.length) lines.push(`• receipt${named.length !== 1 ? "s" : ""} ${named.map(r => r.receiptNo).join(", ")} stop naming this invoice — the money stays where it is`);
  if (!(await confirmBox(`Delete invoice ${inv.number}?\n\n${lines.join("\n")}`))) return false;
  const companyId = companyIdOfInvoice(inv);
  let gone = false;
  updateDbAs({ summary: `Deleted invoice ${inv.number} — ${client}` }, d => {
    // Checked again on the live record: someone may have dispatched or taken
    // money on it while the question was open.
    const live = (d.invoices ?? []).find(i => i.id === invoiceId);
    if (!live || invoiceDeleteBlocker(d, live)) return;
    d.invoices = (d.invoices ?? []).filter(i => i.id !== invoiceId);
    for (const r of d.clientReceipts ?? []) if (r.invoiceId === invoiceId) delete r.invoiceId;
    gone = true;
  });
  if (!gone) { toast.error("Could not delete — the invoice changed meanwhile"); return false; }
  // If this was the newest number, hand it back so the next invoice takes it
  // instead of the book skipping one. Older numbers are left alone — their
  // hole can only be closed by renumbering (Settings).
  await releaseInvoiceNumber(inv.number, companyId);
  toast.success(`Invoice ${inv.number} deleted`);
  return true;
}
