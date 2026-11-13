// The client's invoice statement as a PDF — the one their staff page downloads, and the one a
// client downloads from their own Home (the portal). Invoice by invoice, the pieces on each, then
// what was received against it; brought forward, overdue (lib/paymentTerms.ts), credit held and
// net due. What only staff may see (diamond sales on credit) is passed in as extra sections.
import type { InvoiceBlock } from "@/components/ClientInvoiceLedger";
import { downloadLedgerPdfMulti } from "./ledgerExport";
import { fmtDate, fmtMoney, openingCreditAmt, openingDebitAmt, type Client } from "./db";
import { daysOverdue } from "./paymentTerms";

type Section = Parameters<typeof downloadLedgerPdfMulti>[0]["sections"][number];
type SummaryLine = { label: string; value: string };

/** Trim only when the text genuinely cannot fit the column (8.5pt Helvetica is about 1.6mm a character). */
export const fitMm = (s: string, mm: number) => {
  const max = Math.floor(mm / 1.6);
  return s.length <= max ? s : s.slice(0, max - 1) + "…";
};

/** " · due 12 Dec 2026" / " · due 12 Dec 2026 — 5 days overdue" while owed; nothing without terms. */
export const dueNote = (b: { dueAt?: string; balance: number }) => {
  if (!b.dueAt || b.balance <= 0.009) return "";
  const late = daysOverdue(b.dueAt, b.balance);
  return ` · due ${fmtDate(b.dueAt)}${late > 0 ? ` — ${late} day${late === 1 ? "" : "s"} overdue` : ""}`;
};

/** Credit they hold — only on a statement up to today (the credit is today's). */
export const creditHeldFor = (client: Pick<Client, "creditBalance">, to: Date | null) =>
  (!to && (client.creditBalance || 0) > 0.009 ? Math.round((client.creditBalance || 0) * 100) / 100 : 0);

const inRange = (iso: string, from: Date | null, to: Date | null) => {
  const t = +new Date(iso);
  return (!from || t >= +from) && (!to || t <= +to);
};

export function downloadInvoiceStatementPdf(args: {
  client: Client;
  /** Every invoice of theirs (with its due day when they have terms), not only the period's. */
  allBlocks: InvoiceBlock[];
  from: Date | null;
  to: Date | null;
  /** The company that bills them, when it is not the first. */
  company?: string;
  /** Staff only: more tables after the invoices, and lines in the summary. */
  extraSections?: Section[];
  extraSummary?: SummaryLine[];
}) {
  const { client, allBlocks, from, to } = args;
  const blocks = allBlocks.filter(b => inRange(b.date, from, to));
  const oD = openingDebitAmt(client), oC = openingCreditAmt(client);
  const T = blocks.reduce((t, b) => ({
    gross: t.gross + b.gross, gift: t.gift + b.gift, returned: t.returned + b.returned,
    received: t.received + b.received, balance: t.balance + b.balance,
  }), { gross: 0, gift: 0, returned: 0, received: 0, balance: 0 });
  // Still owed on invoices before the period: brought forward with the opening,
  // or a year's statement would leave older unpaid bills out of what is owed.
  const before = from ? allBlocks.filter(b => +new Date(b.date) < +from).reduce((t, b) => t + b.balance, 0) : 0;
  const bf = oD - oC + before;
  const closing = bf + T.balance;
  const credit = creditHeldFor(client, to);

  // One table per invoice: its pieces, then the payments received against it.
  const sections: Section[] = blocks.map(b => ({
    heading: `Invoice ${b.number} · ${fmtDate(b.date)} · ${fmtMoney(b.gross)}${b.balance > 0.009 ? ` · ${fmtMoney(b.balance)} outstanding` : " · settled"}${dueNote(b)}`,
    columns: [
      { header: "Order / Date", x: 14 },
      { header: "Description", x: 52 },
      { header: "Qty", x: 160 },
      { header: "Billed", x: 176 },
      { header: "Gift card", x: 202 },
      { header: "Returned", x: 224 },
      { header: "Received", x: 246 },
      { header: "Balance", x: 266 },
    ],
    align: ["left", "left", "right", "right", "right", "right", "right", "right"] as ("left" | "right")[],
    rows: [
      ...b.items.map(i => [
        i.orderNo, fitMm(i.description || "—", 104), String(i.qty),
        fmtMoney(i.gross), i.gift ? `-${fmtMoney(i.gift)}` : "",
        i.returned ? `-${fmtMoney(i.returned)}` : "",
        i.received ? fmtMoney(i.received) : "",
        i.balance > 0.009 ? fmtMoney(i.balance) : "Cleared",
      ]),
      ...b.credits.map(c => [
        fmtDate(c.date), fitMm(`Credit note ${c.note}`, 104), "", "", "", `-${fmtMoney(c.amount)}`, "", "",
      ]),
      ...b.payments.map(p => [
        fmtDate(p.date), fitMm(`Payment received — ${p.note}`, 104), "", "", "", "", fmtMoney(p.amount), "",
      ]),
    ],
    totalsRow: ["", "Invoice total", "", fmtMoney(b.gross), b.gift ? `-${fmtMoney(b.gift)}` : "",
      b.returned ? `-${fmtMoney(b.returned)}` : "",
      fmtMoney(b.received), b.balance > 0.009 ? fmtMoney(b.balance) : "Cleared"],
  }));
  sections.push(...(args.extraSections ?? []));

  const late = blocks.filter(b => b.dueAt && daysOverdue(b.dueAt, b.balance) > 0);
  const lateAmt = late.reduce((t, b) => t + b.balance, 0);
  downloadLedgerPdfMulti({
    company: args.company,
    title: "Client Account Statement",
    subjectLines: [
      client.companyName,
      [client.ownerName, client.country].filter(Boolean).join(" · "),
      [client.email, client.phone].filter(Boolean).join("   "),
      from || to ? `Period: ${from ? fmtDate(from.toISOString()) : "start"} → ${to ? fmtDate(to.toISOString()) : "today"}` : "Period: all time",
      `Report Generated: ${new Date().toLocaleDateString("en-IN", { month: "long", day: "numeric", year: "numeric" })}`,
    ].filter(Boolean),
    summary: [
      ...(Math.abs(bf) > 0.009 ? [{ label: from ? `Brought forward to ${fmtDate(from.toISOString())}` : "Balance brought forward", value: fmtMoney(bf) }] : []),
      { label: "Total billed (gross)", value: fmtMoney(T.gross) },
      ...(T.gift > 0 ? [{ label: "Gift card used", value: fmtMoney(T.gift) }] : []),
      ...(T.returned > 0 ? [{ label: "Returned (credit notes)", value: fmtMoney(T.returned) }] : []),
      { label: "Received", value: fmtMoney(T.received) },
      { label: "Outstanding", value: fmtMoney(Math.max(0, closing)) },
      // Past their due day, of the invoices listed (lib/paymentTerms.ts).
      ...(lateAmt > 0.009 ? [{ label: "Overdue", value: `${fmtMoney(lateAmt)} · ${late.length} invoice${late.length === 1 ? "" : "s"}` }] : []),
      ...(credit > 0 ? [
        { label: "Credit held", value: `-${fmtMoney(credit)}` },
        { label: "Net due", value: fmtMoney(Math.max(0, Math.max(0, closing) - credit)) },
      ] : []),
      ...(args.extraSummary ?? []),
      { label: "Invoices", value: String(blocks.length) },
    ],
    landscape: true,
    sections,
    filename: `Client-Statement-${client.companyName.replace(/\s+/g, "_")}`,
  });
}
