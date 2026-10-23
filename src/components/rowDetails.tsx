import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { fmtDate, fmtMoney, type DB, type LockerTransaction } from "@/lib/db";
import { ccy, fmtCcy, rateOf, rateText } from "@/lib/currency";
import { transferLegs } from "@/lib/moneyEntries";
import type { ModuleKey } from "@/lib/modules";

/**
 * The extra fields a table row shows when it is opened (DataTable `details`):
 * what the columns leave out — who recorded it and when, the full note, the
 * account it went through, the records it belongs to. Shared by the money
 * tables so a locker movement reads the same wherever it is opened.
 */
export type Detail = { label: string; value: ReactNode };

/** Whether the person may open a section — a link is only offered where it leads somewhere. */
export type CanView = (m: ModuleKey) => boolean;

/** Fields with something in them; blanks are left out rather than shown empty. */
export function filled(list: (Detail | false | null | undefined)[]): Detail[] {
  return list.filter((d): d is Detail => !!d && d.value !== undefined && d.value !== null && d.value !== "" && d.value !== false);
}

/** When it happened, to the minute: "Oct 16, 2026, 3:45 PM". A bare day
 *  ("2026-10-16", or midnight exactly as a day is stored) has no time to give. */
export function when(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(+d)) return "";
  if (iso.length <= 10 || /T00:00(:00(\.000)?)?Z$/.test(iso)) return fmtDate(iso);
  return `${fmtDate(iso)}, ${d.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" })}`;
}

export const userName = (db: Pick<DB, "users">, id?: string) => (id ? db.users.find(u => u.id === id)?.name : undefined) ?? "";

/** "Oct 16, 2026, 3:45 PM by Asha" — or just the time, when nobody is on record. */
export function recorded(db: Pick<DB, "users">, iso?: string, by?: string): string {
  const name = userName(db, by);
  return [when(iso), name && `by ${name}`].filter(Boolean).join(" ");
}

/** A link to the record's own page — or just its name, for someone who can't open that page. */
export function refLink(to: string, label: ReactNode, allowed = true): ReactNode {
  return allowed ? <Link to={to} className="text-primary hover:underline font-medium">{label}</Link> : label;
}

/** Several links in a row: "SL-0012, SL-0013". */
export function linkList(items: { key: string; node: ReactNode }[]): ReactNode {
  if (!items.length) return undefined;
  return <span className="inline-flex flex-wrap gap-x-2 gap-y-0.5">{items.map((x, i) => <span key={x.key}>{x.node}{i < items.length - 1 ? "," : ""}</span>)}</span>;
}

/** A note as it was typed, line breaks and all. */
export function noteText(s?: string): ReactNode {
  return s?.trim() ? <span className="whitespace-pre-wrap">{s.trim()}</span> : undefined;
}

/** A reference number: voucher, receipt, bill. */
export function refNo(s?: string): ReactNode {
  return s ? <span className="font-mono text-xs font-semibold">{s}</span> : undefined;
}

/** "HDFC Current · INR" */
export function lockerLabel(db: Pick<DB, "lockers">, id?: string): string {
  const l = id ? db.lockers.find(x => x.id === id) : undefined;
  return l ? `${l.name} · ${ccy(l.currency)}` : "";
}

/** Written in the same save as the movement — the payments behind one account line. */
const sameSave = (a: string, b: string) => Math.abs(+new Date(a) - +new Date(b)) < 1500;

/**
 * Everything a locker movement is linked to: the other side of a transfer and
 * the rate it moved at, the client a deposit came from and its receipt, the
 * supplier bills or factory jobs a payment settled, the expense it paid.
 * `voucher` / `category` / `note` / `account`: include those too, for a table
 * whose columns don't already show them.
 */
export function lockerTxnDetails(
  db: DB, t: LockerTransaction, can: CanView,
  opts: { voucher?: boolean; category?: boolean; note?: boolean; account?: boolean } = {},
): Detail[] {
  const own = ccy(t.currency ?? db.lockers.find(l => l.id === t.lockerId)?.currency);
  const out: (Detail | false | undefined)[] = [
    opts.account && { label: "Account", value: lockerLabel(db, t.lockerId) },
    opts.voucher && { label: "Voucher", value: refNo(t.voucherNo) },
    opts.category && { label: "Category", value: t.category },
    opts.note && { label: "Note", value: noteText(t.note) },
  ];

  if (t.type === "transfer_in" || t.type === "transfer_out") {
    const legs = transferLegs(db, t.id);
    const other = legs ? (t.type === "transfer_out" ? legs.inn : legs.out) : undefined;
    const otherId = other?.lockerId ?? t.pairedLockerId;
    const otherCcy = ccy(other?.currency ?? db.lockers.find(l => l.id === otherId)?.currency);
    const [from, to] = t.type === "transfer_out" ? [own, otherCcy] : [otherCcy, own];
    const r = from !== to ? rateOf(t, from, to) ?? (other ? rateOf(other, from, to) : undefined) : undefined;
    out.push(
      { label: t.type === "transfer_out" ? "Sent to" : "Came from", value: lockerLabel(db, otherId) },
      !!other && otherCcy !== own && { label: t.type === "transfer_out" ? "Arrived as" : "Left as", value: fmtCcy(other.amountInr, otherCcy) },
      !!r && { label: "Rate", value: rateText(from, to, r) },
    );
  }

  if (t.refType === "clientPayment" && t.refId) {
    // Written against the client, or (older rows, an order's own payment) the order.
    const order = db.orders.find(o => o.id === t.refId);
    const client = db.clients.find(c => c.id === (order ? order.clientId : t.refId));
    const rcpt = t.receiptId ? (db.clientReceipts ?? []).find(r => r.id === t.receiptId) : undefined;
    const r = own !== "USD" ? rateOf(t, "USD", own) ?? t.exchangeRate : undefined;
    out.push(
      !!client && { label: "Client", value: refLink(`/clients/${client.id}`, client.companyName, can("clients")) },
      !!order && { label: "Order", value: refLink(`/orders/${order.id}`, order.orderNumber, can("orders")) },
      !!rcpt && { label: "Receipt", value: refNo(rcpt.receiptNo) },
      !!rcpt && { label: "Method", value: rcpt.method },
      !!r && { label: "Rate", value: rateText("USD", own, r) },
      !!rcpt && own !== "USD" && { label: "Settles", value: fmtMoney(rcpt.amountUsd) },
    );
  }

  if (t.refType === "purchase") {
    // A payment can settle several bills at once ("oldest first"): every bill
    // part written in the same save, from the same account.
    const parts = (db.purchases ?? []).flatMap(p => (p.payments ?? [])
      .filter(pay => pay.lockerId === t.lockerId && sameSave(pay.createdAt, t.createdAt))
      .map(pay => ({ p, pay })));
    const direct = t.refId ? (db.purchases ?? []).find(p => p.id === t.refId) : undefined;
    const advance = (db.supplierPayments ?? []).find(a => a.lockerId === t.lockerId && sameSave(a.createdAt, t.createdAt));
    const supplierId = direct?.supplierId ?? parts[0]?.p.supplierId ?? advance?.supplierId;
    const supplier = supplierId ? db.suppliers.find(s => s.id === supplierId) : undefined;
    const bills = parts.length ? parts : direct ? [{ p: direct, pay: undefined }] : [];
    const forOrders = [...new Set(bills.map(b => b.p.orderId).filter((x): x is string => !!x))]
      .map(id => db.orders.find(o => o.id === id)).filter(o => !!o);
    out.push(
      !!supplier && { label: "Supplier", value: refLink(`/suppliers/${supplier.id}`, supplier.name, can("suppliers")) },
      bills.length > 0 && { label: bills.length > 1 ? "Bills settled" : "Bill", value: bills.map(b =>
        `${b.p.invoiceNumber || "No bill no."}${b.pay && bills.length > 1 ? ` · ${fmtCcy(b.pay.amountInr, "INR")}` : ""}`).join(", ") },
      !!advance && { label: "Advance", value: fmtCcy(advance.amountInr, "INR") },
      forOrders.length > 0 && { label: "For order", value: linkList(forOrders.map(o => ({ key: o!.id, node: refLink(`/orders/${o!.id}`, o!.orderNumber, can("orders")) }))) },
    );
  }

  if (t.refType === "materialIssuance") {
    const parts = (db.materialIssuances ?? []).flatMap(mi => (mi.makingCharges?.payments ?? [])
      .filter(pay => pay.lockerId === t.lockerId && sameSave(pay.createdAt, t.createdAt))
      .map(pay => ({ mi, pay })));
    const direct = t.refId ? (db.materialIssuances ?? []).find(mi => mi.id === t.refId) : undefined;
    const advance = (db.factoryPayments ?? []).find(a => a.lockerId === t.lockerId && sameSave(a.createdAt, t.createdAt));
    const factoryId = direct?.factoryId ?? parts[0]?.mi.factoryId ?? advance?.factoryId;
    const factory = factoryId ? db.factories.find(f => f.id === factoryId) : undefined;
    const jobs = parts.length ? parts.map(x => x.mi) : direct ? [direct] : [];
    const orders = [...new Set(jobs.map(mi => mi.orderId).filter((x): x is string => !!x))]
      .map(id => db.orders.find(o => o.id === id)).filter(o => !!o);
    out.push(
      !!factory && { label: "Factory", value: refLink(`/factories/${factory.id}`, factory.name, can("factories")) },
      orders.length > 0 && { label: orders.length > 1 ? "Orders" : "Order", value: linkList(orders.map(o => ({ key: o!.id, node: refLink(`/orders/${o!.id}`, o!.orderNumber, can("orders")) }))) },
      !!advance && { label: "Advance", value: fmtCcy(advance.amountInr, "INR") },
    );
  }

  if (t.refType === "expense" && t.refId) {
    const e = db.expenses.find(x => x.id === t.refId);
    const client = e?.clientId ? db.clients.find(c => c.id === e.clientId) : undefined;
    out.push(
      !!e && { label: "Expense", value: e.title },
      !!e && { label: "Expense category", value: e.category },
      !!e?.paidToEmployeeId && { label: "Paid to", value: userName(db, e.paidToEmployeeId) },
      !!client && { label: "Client", value: refLink(`/clients/${client.id}`, client.companyName, can("clients")) },
      !!e?.note && !opts.note && { label: "Expense note", value: noteText(e.note) },
    );
  }

  if (t.refType === "supplierReceipt" && t.refId) {
    const s = db.suppliers.find(x => x.id === t.refId);
    out.push(!!s && { label: "Supplier", value: refLink(`/suppliers/${s.id}`, s.name, can("suppliers")) });
  }

  if (t.refType === "clientRefund" && t.refId) {
    // Paid back out of the client's held credit (lib/clientRefunds.ts).
    const client = db.clients.find(c => c.id === t.refId);
    const r = own !== "USD" ? t.exchangeRate : undefined;
    out.push(
      !!client && { label: "Refunded to", value: refLink(`/clients/${client.id}`, client.companyName, can("clients")) },
      !!t.refundUsd && { label: "Off their credit", value: fmtMoney(t.refundUsd) },
      !!r && { label: "Rate", value: rateText("USD", own, r) },
    );
  }

  if ((t.refType === "brokerPayment" || t.refType === "brokerReceipt") && t.refId) {
    const b = (db.brokers ?? []).find(x => x.id === t.refId);
    out.push(!!b && { label: "Broker", value: refLink(`/suppliers/brokers/${b.id}`, b.name, can("suppliers")) });
  }

  out.push(
    t.notClientPayment && { label: "Marked", value: "Not a client payment" },
    { label: "Recorded", value: recorded(db, t.createdAt, t.recordedBy) },
  );
  return filled(out);
}
