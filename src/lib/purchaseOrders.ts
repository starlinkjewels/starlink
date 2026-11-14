// Purchase orders — what we asked a supplier for, before the goods come (the standard
// purchase order → goods receipt step). A PO is a request: it moves no stock and no money.
// Receiving opens the Buy form filled in from its lines; the bill that is saved is the
// goods receipt and the supplier's bill at once (stock and the supplier's account move
// there, as for any purchase), and each of its lines is noted against the PO line.
//
// What has come is worked out from the receipts whose bill is still on file — a bill voided
// later drops out by itself, and its line is open again. A line short of what was ordered
// stays open until it comes, or the PO is closed short (with why). A PO past its expected
// day alerts whoever made it and the admins once for that day.
import type { DB, MemoLine, PoReceipt, PurchaseCurrency, PurchaseOrder, User } from "./db";
import { assertFresh, loadDb, uid, updateDb } from "./db";
import { reserveSequence, highestSuffix } from "./counters";
import { fmtCcy } from "./currency";
import { downloadLedgerPdf } from "./ledgerExport";
import { companyById } from "./companies";

const EPS = 1e-6;
const r3 = (n: number) => Math.round(n * 1000) / 1000;
const day = (iso?: string) => (iso ? new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "");
/** "1.5 ct", "10 g", "2 pcs". */
export const qtyUnit = (q: number, unit: string) => `${r3(q)}${unit === "pcs" ? ` pc${q === 1 ? "" : "s"}` : unit ? ` ${unit}` : ""}`;

/* ── Numbers ── */
export async function reservePoNumber(pos: { no: string }[]): Promise<string> {
  const floor = highestSuffix(pos.map(p => p.no), 0) + 1;
  const seq = await reserveSequence("poNo", floor);
  return `PO-${String(seq).padStart(4, "0")}`;
}

/* ── What has come ── */
/** Receipts whose bill is still on file (a voided bill drops out); one with no bill counts. */
export function liveReceipts(db: Pick<DB, "purchases">, po: PurchaseOrder): PoReceipt[] {
  const bills = new Set((db.purchases ?? []).map(p => p.id));
  return (po.receipts ?? []).filter(r => !r.purchaseId || bills.has(r.purchaseId));
}
export function lineReceived(db: Pick<DB, "purchases">, po: PurchaseOrder, lineId: string): number {
  return r3(liveReceipts(db, po).filter(r => r.lineId === lineId).reduce((t, r) => t + r.qty, 0));
}
/** Still to come on a line (0 once it has all come, or the PO is closed / cancelled). */
export function lineOpenQty(db: Pick<DB, "purchases">, po: PurchaseOrder, l: MemoLine): number {
  if (po.status !== "open") return 0;
  return Math.max(0, r3(l.qty - lineReceived(db, po, l.id)));
}

export type PoState = "open" | "part" | "received" | "short" | "cancelled";
export const PO_STATE_LABEL: Record<PoState, string> = {
  open: "Ordered", part: "Part received", received: "Received", short: "Closed short", cancelled: "Cancelled",
};
export function poState(db: Pick<DB, "purchases">, po: PurchaseOrder): PoState {
  if (po.status === "cancelled") return "cancelled";
  const got = po.lines.map(l => lineReceived(db, po, l.id));
  const all = po.lines.every((l, i) => got[i] >= l.qty - EPS);
  if (all) return "received";
  if (po.status === "closed") return "short";
  return got.some(g => g > EPS) ? "part" : "open";
}
/** Whole days past its expected day, while goods are still awaited (0 = not late). */
export function poOverdueDays(db: Pick<DB, "purchases">, po: PurchaseOrder, now = Date.now()): number {
  const st = poState(db, po);
  if (!po.expectedAt || (st !== "open" && st !== "part")) return 0;
  const due = new Date(po.expectedAt); due.setHours(23, 59, 59, 999);
  return now > +due ? Math.floor((now - +due) / 86_400_000) + 1 : 0;
}
/** The value of what was ordered (in the PO's currency). */
export const poValue = (po: PurchaseOrder) => Math.round(po.lines.reduce((t, l) => t + (l.amount || 0), 0) * 100) / 100;

/* ── Changes ── */
export interface PoInput {
  supplierId: string;
  companyId?: string;
  at: string;
  expectedAt?: string;
  currency: PurchaseCurrency;
  lines: Omit<MemoLine, "id">[];
  notes?: string;
}
export function poProblem(db: Pick<DB, "suppliers">, input: PoInput): string | null {
  if (!input.supplierId || !db.suppliers.some(s => s.id === input.supplierId)) return "Choose the supplier";
  if (!input.lines.length) return "Add what you are ordering";
  if (input.lines.some(l => !(l.qty > 0))) return "Each line needs a quantity";
  if (input.expectedAt && +new Date(input.expectedAt) < +new Date(input.at) - 86_400_000) return "The expected day can't be before the order day";
  return null;
}
const lineIds = (lines: Omit<MemoLine, "id">[], keep?: MemoLine[]): MemoLine[] =>
  lines.map((l, i) => ({ ...l, id: keep?.[i]?.id ?? uid("pol_") }));

export async function createPo(db: DB, input: PoInput, user: User): Promise<PurchaseOrder> {
  const why = poProblem(db, input);
  if (why) throw new Error(why);
  assertFresh();
  const no = await reservePoNumber(loadDb().purchaseOrders ?? []);
  const now = new Date().toISOString();
  const po: PurchaseOrder = {
    id: uid("po_"), no, supplierId: input.supplierId, ...(input.companyId && input.companyId !== "main" ? { companyId: input.companyId } : {}),
    at: input.at, ...(input.expectedAt ? { expectedAt: input.expectedAt } : {}), currency: input.currency,
    lines: lineIds(input.lines), ...(input.notes?.trim() ? { notes: input.notes.trim() } : {}),
    status: "open", receipts: [], createdBy: user.id, createdAt: now,
  };
  updateDb(d => { d.purchaseOrders = [po, ...(d.purchaseOrders ?? [])]; });
  return po;
}

/** Why a PO's lines can't be changed now; null when they can (nothing has come yet). */
export function poEditBlocker(db: Pick<DB, "purchases">, po: PurchaseOrder): string | null {
  if (po.status === "cancelled") return "Cancelled — make a new purchase order";
  if (po.status === "closed") return "Closed — make a new purchase order";
  if (liveReceipts(db, po).length) return "Goods have come against it — change the expected day, or close it short";
  return null;
}
export function updatePo(id: string, input: PoInput): void {
  const why = poProblem(loadDb(), input);
  if (why) throw new Error(why);
  updateDb(d => {
    const po = (d.purchaseOrders ?? []).find(x => x.id === id);
    if (!po) throw new Error("That purchase order is not here any more");
    const block = poEditBlocker(d, po);
    if (block) throw new Error(block);
    po.supplierId = input.supplierId;
    if (input.companyId && input.companyId !== "main") po.companyId = input.companyId; else delete po.companyId;
    po.at = input.at;
    if (input.expectedAt) po.expectedAt = input.expectedAt; else delete po.expectedAt;
    po.currency = input.currency;
    po.lines = lineIds(input.lines, po.lines);
    if (input.notes?.trim()) po.notes = input.notes.trim(); else delete po.notes;
    delete po.overdueAlertedFor;
  });
}
/** A new expected day — kept in its history; the overdue alert is for the new day. */
export function setPoExpected(id: string, to: string | undefined, user: Pick<User, "id">): void {
  updateDb(d => {
    const po = (d.purchaseOrders ?? []).find(x => x.id === id);
    if (!po) throw new Error("That purchase order is not here any more");
    if (po.status !== "open") throw new Error("It is not open any more");
    po.dueChanges = [...(po.dueChanges ?? []), { at: new Date().toISOString(), ...(po.expectedAt ? { from: po.expectedAt } : {}), ...(to ? { to } : {}), by: user.id }];
    if (to) po.expectedAt = to; else delete po.expectedAt;
    delete po.overdueAlertedFor;
  });
}
/** Close short: what is still to come won't come. Only once something has come (else Cancel). */
export function closePoShort(id: string, note: string, user: Pick<User, "id">): void {
  if (!note.trim()) throw new Error("Say why it is closed short — e.g. the supplier can't send the rest");
  updateDb(d => {
    const po = (d.purchaseOrders ?? []).find(x => x.id === id);
    if (!po) throw new Error("That purchase order is not here any more");
    if (po.status !== "open") throw new Error("It is not open any more");
    if (!liveReceipts(d, po).length) throw new Error("Nothing has come against it — cancel it instead");
    Object.assign(po, { status: "closed", closedAt: new Date().toISOString(), closedNote: note.trim(), closedBy: user.id });
  });
}
/** Cancel before anything came — kept on the list with why. */
export function cancelPo(id: string, note: string, user: Pick<User, "id">): void {
  updateDb(d => {
    const po = (d.purchaseOrders ?? []).find(x => x.id === id);
    if (!po) throw new Error("That purchase order is not here any more");
    if (po.status !== "open") throw new Error("It is not open any more");
    if (liveReceipts(d, po).length) throw new Error("Goods have come against it — close it short instead");
    Object.assign(po, { status: "cancelled", closedAt: new Date().toISOString(), ...(note.trim() ? { closedNote: note.trim() } : {}), closedBy: user.id });
  });
}
/** Re-open a closed-short or cancelled PO (a mistake, or the supplier will send after all). */
export function reopenPo(id: string): void {
  updateDb(d => {
    const po = (d.purchaseOrders ?? []).find(x => x.id === id);
    if (!po) throw new Error("That purchase order is not here any more");
    if (po.status === "open") return;
    po.status = "open";
    delete po.closedAt; delete po.closedNote; delete po.closedBy; delete po.overdueAlertedFor;
  });
}
export function poDeleteBlocker(db: Pick<DB, "purchases">, po: PurchaseOrder): string | null {
  return liveReceipts(db, po).length ? "Goods have come against it — its bills name it; close it short instead" : null;
}
export function deletePo(id: string): void {
  updateDb(d => {
    const po = (d.purchaseOrders ?? []).find(x => x.id === id);
    if (!po) return;
    const why = poDeleteBlocker(d, po);
    if (why) throw new Error(why);
    d.purchaseOrders = (d.purchaseOrders ?? []).filter(x => x.id !== id);
  });
}

/**
 * The goods came: a purchase bill was saved from the PO (the Buy form, filled in from it).
 * Each picked line notes what came on which bill, and the bill names its PO and line.
 */
export function recordPoReceipt(id: string, picks: { lineId: string; qty: number }[], purchaseIds: string[], user: Pick<User, "id">): void {
  updateDb(d => {
    const po = (d.purchaseOrders ?? []).find(x => x.id === id);
    if (!po) throw new Error("That purchase order is not here any more");
    const at = new Date().toISOString();
    picks.forEach((p, i) => {
      if (!(p.qty > 0)) return;
      const purchaseId = purchaseIds[i];
      po.receipts = [...(po.receipts ?? []), { id: uid("por_"), at, lineId: p.lineId, qty: r3(p.qty), ...(purchaseId ? { purchaseId } : {}), by: user.id }];
      const bill = purchaseId ? d.purchases.find(x => x.id === purchaseId) : undefined;
      if (bill) { bill.poId = po.id; bill.poLineId = p.lineId; }
    });
    delete po.overdueAlertedFor;
  });
}

/* ── Overdue ── */
export function alertOverduePos(d: DB, notify: (ids: (string | undefined)[], title: string, body: string) => void, now = Date.now()): number {
  let n = 0;
  for (const po of d.purchaseOrders ?? []) {
    if (!po.expectedAt || po.overdueAlertedFor === po.expectedAt) continue;
    const late = poOverdueDays(d, po, now);
    if (late < 1) continue;
    const who = d.suppliers.find(s => s.id === po.supplierId)?.name ?? "the supplier";
    notify([po.createdBy], `Purchase order ${po.no} is late`,
      `${who} — expected ${day(po.expectedAt)}, ${late} day${late === 1 ? "" : "s"} over. Chase them on WhatsApp from Suppliers → Purchase orders, change the expected day, or close it short.`);
    po.overdueAlertedFor = po.expectedAt;
    n++;
  }
  return n;
}

/* ── To the supplier ── */
/** The PO as a WhatsApp message to the supplier — what we want, how much, at what rate, by when. */
export function poText(db: Pick<DB, "settings" | "suppliers" | "purchases">, po: PurchaseOrder): string {
  const from = companyById(db.settings, po.companyId ?? "main").name;
  const supplier = db.suppliers.find(s => s.id === po.supplierId)?.name ?? "";
  const st = poState(db, po);
  const lines = po.lines.map(l => {
    const open = lineOpenQty(db, po, l);
    const part = st === "part" && open > EPS && open < l.qty - EPS ? ` — ${qtyUnit(open, l.unit)} still to come` : "";
    return `• ${l.label}: ${qtyUnit(l.qty, l.unit)}${l.rate ? ` @ ${fmtCcy(l.rate, po.currency)}/${l.unit}` : ""}${part}`;
  });
  return [
    `Purchase order ${po.no} from ${from}${supplier ? ` to ${supplier}` : ""}`,
    `Date: ${day(po.at)}${po.expectedAt ? ` · Please deliver by ${day(po.expectedAt)}` : ""}`,
    "",
    ...lines,
    ...(poValue(po) > 0 ? ["", `Total: ${fmtCcy(poValue(po), po.currency)}`] : []),
    ...(po.notes ? ["", po.notes] : []),
    "",
    "Please confirm.",
  ].join("\n");
}

/** The PO as a one-page PDF. */
export function downloadPoPdf(db: Pick<DB, "settings" | "suppliers" | "purchases">, po: PurchaseOrder): void {
  const supplier = db.suppliers.find(s => s.id === po.supplierId);
  const rows = po.lines.map(l => [l.label, qtyUnit(l.qty, l.unit), l.rate ? fmtCcy(l.rate, po.currency) : "—", l.amount ? fmtCcy(l.amount, po.currency) : "—", qtyUnit(lineReceived(db, po, l.id), l.unit)]);
  downloadLedgerPdf({
    title: "Purchase order",
    company: companyById(db.settings, po.companyId ?? "main").name,
    subjectLines: [
      `${po.no} · ${day(po.at)}${po.expectedAt ? ` · deliver by ${day(po.expectedAt)}` : ""}`,
      `To: ${supplier?.name ?? "—"}${supplier?.phone ? ` · ${supplier.phone}` : ""}`,
      `Status: ${PO_STATE_LABEL[poState(db, po)]}`,
      ...(po.notes ? [`Note: ${po.notes}`] : []),
    ],
    summary: [{ label: "Order value", value: poValue(po) > 0 ? fmtCcy(poValue(po), po.currency) : "—" }],
    columns: [{ header: "Item", x: 14 }, { header: "Quantity", x: 110 }, { header: "Rate", x: 140 }, { header: "Amount", x: 170 }, { header: "Received", x: 196 }],
    align: ["left", "right", "right", "right", "right"],
    rows,
    totalsRow: ["Total", "", "", poValue(po) > 0 ? fmtCcy(poValue(po), po.currency) : "", ""],
    filename: `PurchaseOrder-${po.no}`,
  });
}
