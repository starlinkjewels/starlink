/**
 * A client's payment receipt, to hand over: a one-page PDF (the statements'
 * own layout — company, client, receipt no., what it settled) and a WhatsApp
 * message with the same facts. Offered wherever a receipt is listed (Payments →
 * Received, the client's statement, the Passbook, an order's payments) through
 * receiptActions(). Read-only: nothing is written.
 */
import { FileText, MessageCircle } from "lucide-react";
import { toast } from "sonner";
import type { MoreAction } from "@/components/MoreMenu";
import { downloadLedgerPdf } from "./ledgerExport";
import { ensureCollections, fmtDate, fmtMoney, loadDb, type DB } from "./db";
import { fmtCcy } from "./currency";
import { receiptApplied } from "./receipts";
import { MAIN_COMPANY_ID, companyById, companyIdOfClient, hasCompanies } from "./companies";

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Everything a receipt says, read live from the records. */
function receiptFacts(db: DB, receiptId: string) {
  const r = (db.clientReceipts ?? []).find(x => x.id === receiptId);
  if (!r) return null;
  const client = db.clients.find(c => c.id === r.clientId);
  // Where it went: the bills it settled, and what is still held for them as credit.
  const settled = db.orders.flatMap(o => (o.advances ?? []).filter(a => a.receiptId === r.id).map(a => ({ order: o.orderNumber, amount: a.amount })));
  const credit = r2(r.amountUsd - receiptApplied(db, r.id));
  // Every invoice it was sent for, in the order it paid them.
  const invoice = (r.invoiceIds?.length ? r.invoiceIds : r.invoiceId ? [r.invoiceId] : [])
    .map(iid => db.invoices.find(i => i.id === iid)?.number).filter(Boolean).join(", ") || undefined;
  const account = r.lockerId ? db.lockers.find(l => l.id === r.lockerId)?.name : undefined;
  const deposited = r.lockerId && r.lockerAmount != null && r.lockerCurrency && r.lockerCurrency !== "USD" ? fmtCcy(r.lockerAmount, r.lockerCurrency) : undefined;
  // The company that sells to them — as their statements say.
  const company = client && hasCompanies(db.settings) && companyIdOfClient(client) !== MAIN_COMPANY_ID ? companyById(db.settings, companyIdOfClient(client)).name : undefined;
  return { r, client, settled, credit, invoice, account, deposited, company };
}

/** The receipt as a one-page PDF, downloaded. */
export function downloadReceiptPdf(db: DB, receiptId: string): boolean {
  const f = receiptFacts(db, receiptId);
  if (!f) return false;
  const rows = [
    ...f.settled.map(s => [s.order, "Settled on the bill", fmtMoney(s.amount)]),
    ...(f.credit > 0.005 ? [["—", "Held as credit for the next bill", fmtMoney(f.credit)]] : []),
  ];
  downloadLedgerPdf({
    title: "Payment receipt",
    company: f.company,
    subjectLines: [
      `Receipt ${f.r.receiptNo} · ${fmtDate(f.r.date)}`,
      `Received from: ${f.client?.companyName ?? "—"}`,
      [`Mode: ${f.r.method}`, f.invoice && `For invoice ${f.invoice}`, f.deposited && `Deposited ${f.deposited}`,
        (f.r.bankChargesUsd ?? 0) > 0 && `Bank charges ${fmtMoney(f.r.bankChargesUsd!)} (credited to you in full)`].filter(Boolean).join(" · "),
      ...(f.r.remarks ? [`Note: ${f.r.remarks}`] : []),
    ],
    summary: [{ label: "Amount received", value: fmtMoney(f.r.amountUsd) }],
    columns: [{ header: "Order", x: 14 }, { header: "", x: 60 }, { header: "Amount", x: 196 }],
    align: ["left", "left", "right"],
    rows: rows.length ? rows : [["—", "Received", fmtMoney(f.r.amountUsd)]],
    totalsRow: ["", "Total", fmtMoney(f.r.amountUsd)],
    filename: `Receipt-${f.r.receiptNo}`,
  });
  return true;
}

/** The receipt as a WhatsApp message — to the client's own number when we have it. */
export function receiptWhatsAppUrl(db: DB, receiptId: string): string | null {
  const f = receiptFacts(db, receiptId);
  if (!f) return null;
  const lines = [
    `Payment receipt ${f.r.receiptNo}`,
    `Received ${fmtMoney(f.r.amountUsd)} on ${fmtDate(f.r.date)} from ${f.client?.companyName ?? "you"} — ${f.r.method}.`,
    ...(f.invoice ? [`For invoice ${f.invoice}.`] : []),
    ...f.settled.map(s => `• ${s.order}: ${fmtMoney(s.amount)}`),
    ...(f.credit > 0.005 ? [`• Held as credit: ${fmtMoney(f.credit)}`] : []),
    "Thank you.",
    ...(f.company ? [f.company] : []),
  ];
  const phone = (f.client?.phone ?? "").replace(/[^\d]/g, "");
  return `https://wa.me/${phone.length >= 8 ? phone : ""}?text=${encodeURIComponent(lines.join("\n"))}`;
}

/** Print / PDF and WhatsApp for one receipt — for any ⋯ that lists receipts. */
export function receiptShareActions(receiptId: string | undefined): MoreAction[] {
  if (!receiptId) return [];
  const ready = async () => { await ensureCollections(["clientReceipts", "lockerTransactions"]); return loadDb(); };
  return [
    { label: "Receipt — PDF", icon: FileText, hint: "To print or send — what it settled", onSelect: async () => { if (!downloadReceiptPdf(await ready(), receiptId)) toast.error("That receipt is not here any more"); } },
    { label: "Send on WhatsApp", icon: MessageCircle, hint: "The receipt as a message, to the client's number", onSelect: async () => {
      const url = receiptWhatsAppUrl(await ready(), receiptId);
      if (!url) { toast.error("That receipt is not here any more"); return; }
      window.open(url, "_blank", "noopener,noreferrer");
    } },
  ];
}
