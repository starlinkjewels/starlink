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
 * taken together, must still be there. Read-only and quick (it is asked while
 * menus are drawn); creditNoteCancelCheck() also rehearses the whole cancel.
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
 * Every line's cancel, run in turn on a deep copy of what cancelReturn reads
 * and writes (the orders, Ready Stock, the clients, the gift cards). Each line
 * is checked against the copy as the lines before it have left it — two lines
 * whose pieces went back into the same Ready Stock item can each pass alone
 * and still not both come out. Returns the first line that can't go back, or
 * undefined when all of them can. The real records are never touched.
 */
function rehearse(db: DB, noteId: string): string | undefined {
  try {
    const copy = JSON.parse(JSON.stringify({
      orders: db.orders, readyStock: db.readyStock ?? [], clients: db.clients, giftCards: db.giftCards ?? [],
    })) as DB;
    const lines = creditNoteLines(copy, noteId);
    if (!lines.length) return "That credit note is not there any more.";
    const at = new Date().toISOString();
    for (const { order, ret } of lines) {
      const why = cancelReturnBlocker(copy, order.id, ret.id);
      if (why) return lines.length > 1 ? `${order.orderNumber}: ${why}` : why;
      if (!cancelReturn(copy, order.id, ret.id, { by: "", at })) return `${order.orderNumber}: that return can't be taken back.`;
    }
    return undefined;
  } catch {
    return "Couldn't check this credit note — nothing was changed. Try again.";
  }
}

/** The full check before a credit note is cancelled: the quick one, then the
 *  rehearsal of every line together. Undefined when it can go back whole. */
export function creditNoteCancelCheck(db: DB, noteId: string): string | undefined {
  return creditNoteCancelBlocker(db, noteId) ?? rehearse(db, noteId);
}

/**
 * Cancel every line of a credit note (inside updateDb) — all of them or none:
 * the whole cancel is rehearsed on a copy first, and only when every line goes
 * back there are the real records changed. Returns why it was refused (nothing
 * touched), or undefined once done.
 */
export function cancelCreditNote(d: DB, noteId: string, w: { by: string; at: string }): string | undefined {
  const why = creditNoteCancelCheck(d, noteId);
  if (why) return why;
  // The rehearsal ran these same lines on the same data, so none can fail
  // here; if one ever did, say so rather than report the note cancelled.
  const stuck = creditNoteLines(d, noteId).filter(l => !cancelReturn(d, l.order.id, l.ret.id, w));
  if (stuck.length) {
    console.error("[creditNote] lines refused after a clean rehearsal", noteId, stuck.map(l => l.ret.id));
    return `${stuck.map(l => l.order.orderNumber).join(", ")} could not go back — check the credit note.`;
  }
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
  const why = creditNoteCancelCheck(db, noteId);
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
  let refused: string | undefined;
  updateDbAs({ summary: `Cancelled return ${no} — ${lines.map(l => l.order.orderNumber).join(", ")}` }, d => {
    // Checked again on the live record, every line together, before anything
    // is written: nothing is written unless every line can go back.
    refused = cancelCreditNote(d, noteId, { by: by.id, at: new Date().toISOString() });
  });
  if (!refused) toast.success(`${no} cancelled — the orders are as they were`);
  else toast.error(`Could not cancel — ${refused}`);
}
