import { toast } from "sonner";
import { loadDb, updateDbAs, fmtMoney, type DB } from "@/lib/db";
import { cancelReturn, cancelReturnBlocker, creditNoteLines } from "@/lib/salesReturn";
import { confirmBox } from "@/lib/confirm";
import { cancelReturnFlow } from "@/components/SalesReturn";

const r2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Why a whole credit note can't be cancelled; undefined when it can. A note can
 * cover pieces of several orders on one invoice: it goes back as one, so every
 * line must be free to — and the credit they put on the client's account,
 * taken together, must still be there.
 */
export function creditNoteCancelBlocker(db: DB, noteId: string): string | undefined {
  const lines = creditNoteLines(db, noteId);
  if (!lines.length) return "That credit note is not there any more.";
  for (const { order, ret } of lines) {
    const why = cancelReturnBlocker(db, order.id, ret.id);
    if (why) return lines.length > 1 ? `${order.orderNumber}: ${why}` : why;
  }
  const toCredit = r2(lines.reduce((s, l) => s + (l.ret.toCreditUsd || 0), 0));
  const credit = db.clients.find(c => c.id === lines[0].order.clientId)?.creditBalance || 0;
  if (toCredit > 0 && credit + 0.005 < toCredit) return `The ${fmtMoney(toCredit)} this return put on the client's credit has already been used.`;
  return undefined;
}

/**
 * Cancel a return recorded by mistake — the whole credit note. One line: the
 * same flow as the order page's "Cancel return". Several orders: one question
 * covering all of them, then all lines go back together or none do.
 */
export async function cancelCreditNoteFlow(noteId: string, by: { id: string }): Promise<void> {
  const db = loadDb();
  const lines = creditNoteLines(db, noteId);
  if (lines.length === 1) { await cancelReturnFlow(lines[0].order, lines[0].ret, by); return; }
  const why = creditNoteCancelBlocker(db, noteId);
  if (why) { toast.error(why); return; }
  const no = lines[0].ret.creditNoteNo;
  const qty = lines.reduce((s, l) => s + l.ret.qty, 0);
  const credit = r2(lines.reduce((s, l) => s + l.ret.creditUsd, 0));
  const toCredit = r2(lines.reduce((s, l) => s + (l.ret.toCreditUsd || 0), 0));
  const msg = [
    `Cancel ${no}?`,
    `The ${qty} piece${qty !== 1 ? "s" : ""} on ${lines.map(l => l.order.orderNumber).join(", ")} count as the client's again and ${fmtMoney(credit)} goes back on their bills.`,
  ];
  if (lines.some(l => l.ret.status === "received")) msg.push("Pieces already received come out of Ready Stock.");
  if (toCredit > 0) msg.push(`${fmtMoney(toCredit)} moves from their credit back onto these orders.`);
  if (!(await confirmBox(msg, { title: "Cancel return", confirmText: "Cancel return", cancelText: "Keep it", danger: true }))) return;
  let ok = true;
  updateDbAs({ summary: `Cancelled return ${no} — ${lines.map(l => l.order.orderNumber).join(", ")}` }, d => {
    // Checked again on the live record, all lines first: nothing is written
    // unless every line can go back.
    if (creditNoteCancelBlocker(d, noteId)) { ok = false; return; }
    const at = new Date().toISOString();
    for (const l of creditNoteLines(d, noteId)) cancelReturn(d, l.order.id, l.ret.id, { by: by.id, at });
  });
  if (ok) toast.success(`${no} cancelled — the orders are as they were`);
  else toast.error("Could not cancel — it changed meanwhile");
}
