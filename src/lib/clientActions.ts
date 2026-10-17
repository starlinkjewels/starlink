// What can be done to a client record as a whole: switch it on or off, and
// delete it — which is only for a client with nothing on record.
//
// Deleting a client removes them and their login. Anything that still points
// at them — an order, an invoice, a receipt, a gift card, an expense, money
// held for them — would be left naming nobody: statements, reports and the
// books would lose who it belonged to. So a client with any of that is
// deactivated instead (they can no longer sign in; their history stays).
import { toast } from "sonner";
import { collectionsLoaded, fmtMoney, hasOpeningBalance, loadDb, updateDbAs, type DB } from "./db";
import { confirmBox } from "./confirm";
import { CHECKING, STILL_LOADING, recordsReady } from "./actionHints";

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** What the check reads beyond the clients and orders the app opens with.
 *  These arrive by themselves in the first seconds after sign-in; until they
 *  have, they read as empty — so Delete waits ("Checking…"). */
const CLIENT_REF_COLS = ["invoices", "giftCards", "expenses"] as const;
/** …and the receipt book, loaded on demand: the delete loads it and counts it. */
const CLIENT_DELETE_COLS = [...CLIENT_REF_COLS, "clientReceipts"] as const;

/**
 * Why this client can't be deleted; undefined when nothing is on record for
 * them. Receipts are counted once the receipt book has loaded — the delete
 * itself always loads it and asks again (see deleteClientFlow).
 */
export function clientDeleteBlocker(db: DB, clientId: string): string | undefined {
  const c = db.clients.find(x => x.id === clientId);
  if (!c) return "That client is no longer there";
  if (!collectionsLoaded(CLIENT_REF_COLS)) return CHECKING;
  const orders = db.orders.filter(o => o.clientId === clientId).length;
  const invoices = (db.invoices ?? []).filter(i => i.clientId === clientId).length;
  const receipts = collectionsLoaded(["clientReceipts"]) ? (db.clientReceipts ?? []).filter(r => r.clientId === clientId).length : 0;
  const cards = (db.giftCards ?? []).filter(g => g.clientId === clientId).length;
  const expenses = (db.expenses ?? []).filter(e => e.clientId === clientId).length;
  const has = [
    orders && plural(orders, "order"),
    invoices && plural(invoices, "invoice"),
    receipts && plural(receipts, "receipt"),
    cards && plural(cards, "gift card"),
    expenses && plural(expenses, "expense"),
  ].filter(Boolean);
  if (has.length) return `Has ${has.join(" / ")} — deactivate instead`;
  if ((c.creditBalance || 0) > 0.009) return `Holds ${fmtMoney(c.creditBalance || 0)} of their credit — deactivate instead`;
  if (hasOpeningBalance(c)) return "Has an opening balance on their account — deactivate instead";
  return undefined;
}

/** Ask, then delete a client with nothing on record, and their login. */
export async function deleteClientFlow(clientId: string): Promise<boolean> {
  // Everything the check reads must be here — the receipt book is loaded on
  // demand, and the rest read as empty for the first seconds after sign-in —
  // so a client whose only record is a payment, a bill or a gift card is never
  // deleted out from under it.
  if (!(await recordsReady(CLIENT_DELETE_COLS))) { toast.error(STILL_LOADING); return false; }
  const db = loadDb();
  const c = db.clients.find(x => x.id === clientId);
  const why = clientDeleteBlocker(db, clientId);
  if (!c || why) { toast.error(why ?? "That client is no longer there"); return false; }
  const login = db.users.some(u => u.clientId === clientId);
  if (!(await confirmBox(
    `Delete client ${c.companyName}?\n\n`
    + "• nothing is on record for them — no orders, invoices, payments or gift cards\n"
    + (login ? "• their login is removed — they can no longer sign in\n" : "")
    + "This cannot be undone.",
  ))) return false;
  let gone = false;
  updateDbAs({ summary: `Deleted client ${c.companyName}` }, d => {
    // Checked again on the live record: an order may have been placed meanwhile.
    if (clientDeleteBlocker(d, clientId)) return;
    d.clients = d.clients.filter(x => x.id !== clientId);
    d.users = d.users.filter(u => u.clientId !== clientId);
    gone = true;
  });
  if (!gone) { toast.error("Could not delete — something was recorded for them meanwhile"); return false; }
  toast.success(`${c.companyName} deleted`);
  return true;
}

/** Switch a client (and their login) between active and inactive. */
export function toggleClientActive(clientId: string): void {
  const c = loadDb().clients.find(x => x.id === clientId);
  if (!c) return;
  const next = c.status === "active" ? "inactive" : "active";
  updateDbAs({ summary: `${next === "active" ? "Activated" : "Deactivated"} client ${c.companyName}` }, d => {
    const x = d.clients.find(y => y.id === clientId);
    if (!x) return;
    x.status = x.status === "active" ? "inactive" : "active";
    const u = d.users.find(y => y.clientId === clientId);
    if (u) u.status = x.status;
  });
  toast.success("Status updated");
}
