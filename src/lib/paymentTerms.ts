// Payment terms, due dates, overdue and the credit limit — one place, used by every screen.
//
// Terms are opt-in: a client's own (Client.paymentTermsDays), else the default in
// Settings → Invoice & Bill (Settings.defaultPaymentTermsDays). With neither, an invoice
// has no due date and nothing is ever called overdue — exactly as before terms existed.
//
// An invoice's due date is stamped on it when it is raised (Invoice.dueAt), so changing a
// client's terms later never moves a bill already sent. An invoice raised before that has
// none of its own: it is due its own date + the client's terms as they are now.
//
// The credit limit (Client.creditLimitUsd, staff only — a client can't write their record)
// is checked against everything they owe in dollars, the same figure as the client page's
// "owed in all": every live order's balance + an opening debit, less the credit they hold.
import {
  balanceDue, clientAccount, invoiceOrderIds,
  type Client, type DB, type Invoice, type Order, type Settings,
} from "./db";

export const DAY_MS = 86_400_000;

/** A typed box → the number to keep: blank = unset, else a whole number of days 0–365 / dollars ≥ 0. */
export function termsProblem(terms: number | undefined, limit: number | undefined): string | null {
  if (terms != null && (!Number.isFinite(terms) || terms < 0 || terms > 365 || Math.round(terms) !== terms)) return "Payment terms: whole days, 0 to 365 (0 = due on receipt)";
  if (limit != null && (!Number.isFinite(limit) || limit < 0)) return "Credit limit: a dollar amount, 0 or more — or blank for no limit";
  return null;
}


/** A client's payment terms in days — their own, else the Settings default; undefined = none. */
export function termsDaysOf(
  client: Pick<Client, "paymentTermsDays"> | undefined,
  settings: Pick<Settings, "defaultPaymentTermsDays"> | undefined,
): number | undefined {
  const own = client?.paymentTermsDays;
  if (own != null && Number.isFinite(own) && own >= 0) return Math.round(own);
  const def = settings?.defaultPaymentTermsDays;
  return def != null && Number.isFinite(def) && def >= 0 ? Math.round(def) : undefined;
}

/** "Net 30", "Due on receipt" — or "" with no terms. */
export function termsLabel(days: number | undefined): string {
  return days == null ? "" : days === 0 ? "Due on receipt" : `Net ${days}`;
}

/** The day a bill raised on `at` falls due under `days` terms (its own calendar day + N). */
export function dueFrom(at: string, days: number): string {
  const d = new Date(at);
  d.setDate(d.getDate() + days);
  return d.toISOString();
}

/** When an invoice falls due: its own stamp, else its date + the client's terms now; undefined = no terms. */
export function invoiceDueAt(
  inv: Pick<Invoice, "createdAt" | "dueAt">,
  client: Pick<Client, "paymentTermsDays"> | undefined,
  settings: Pick<Settings, "defaultPaymentTermsDays"> | undefined,
): string | undefined {
  if (inv.dueAt) return inv.dueAt;
  const t = termsDaysOf(client, settings);
  return t == null ? undefined : dueFrom(inv.createdAt, t);
}

/** Whole days past the due day (due at the end of that day); 0 when not due yet or nothing owed. */
export function daysOverdue(dueAt: string | undefined, owed: number, now = Date.now()): number {
  if (!dueAt || !(owed > 0.005)) return 0;
  const end = new Date(dueAt);
  end.setHours(23, 59, 59, 999);
  return now > +end ? Math.ceil((now - +end) / DAY_MS) : 0;
}

/** Days until the due day (0 = due today); negative once overdue. */
export function daysToDue(dueAt: string, now = Date.now()): number {
  const end = new Date(dueAt);
  end.setHours(23, 59, 59, 999);
  return Math.floor((+end - now) / DAY_MS);
}

/** What is still owed on an invoice — its live orders' balances (a cancelled order owes nothing). */
export function invoiceOwed(orders: Order[] | Map<string, Order>, inv: Invoice): number {
  const byId = orders instanceof Map ? orders : new Map(orders.map(o => [o.id, o]));
  let owed = 0;
  for (const id of invoiceOrderIds(inv)) {
    const o = byId.get(id);
    if (o && o.status !== "Rejected" && !o.deletedAt) owed += balanceDue(o);
  }
  return Math.round(owed * 100) / 100;
}

export interface OverdueBill { id: string; number: string; owed: number; dueAt: string; days: number }
export interface ClientOverdue { bills: OverdueBill[]; amount: number; count: number; oldestDays: number }

const summarise = (bills: OverdueBill[]): ClientOverdue => {
  bills.sort((a, b) => b.days - a.days);
  return { bills, amount: Math.round(bills.reduce((s, b) => s + b.owed, 0) * 100) / 100, count: bills.length, oldestDays: bills[0]?.days ?? 0 };
};

/** Every client's overdue invoices in one pass (the Clients list) — only clients with any. */
export function overdueByClient(db: Pick<DB, "orders" | "invoices" | "clients" | "settings">, now = Date.now()): Map<string, ClientOverdue> {
  const byId = new Map(db.orders.map(o => [o.id, o]));
  const clients = new Map(db.clients.map(c => [c.id, c]));
  const found = new Map<string, OverdueBill[]>();
  for (const inv of db.invoices ?? []) {
    const dueAt = invoiceDueAt(inv, clients.get(inv.clientId), db.settings);
    if (!dueAt || daysToDue(dueAt, now) >= 0) continue;
    const owed = invoiceOwed(byId, inv);
    const days = daysOverdue(dueAt, owed, now);
    if (days > 0) found.set(inv.clientId, [...(found.get(inv.clientId) ?? []), { id: inv.id, number: inv.number, owed, dueAt, days }]);
  }
  return new Map([...found].map(([cid, bills]) => [cid, summarise(bills)]));
}

/** A client's invoices past their due day with money still owed — oldest first. */
export function clientOverdue(db: Pick<DB, "orders" | "invoices" | "clients" | "settings">, clientId: string, now = Date.now()): ClientOverdue {
  const client = db.clients.find(c => c.id === clientId);
  const mine = new Map(db.orders.filter(o => o.clientId === clientId).map(o => [o.id, o]));
  const bills: OverdueBill[] = [];
  for (const inv of db.invoices ?? []) {
    if (inv.clientId !== clientId) continue;
    const dueAt = invoiceDueAt(inv, client, db.settings);
    if (!dueAt) continue;
    const owed = invoiceOwed(mine, inv);
    const days = daysOverdue(dueAt, owed, now);
    if (days > 0) bills.push({ id: inv.id, number: inv.number, owed, dueAt, days });
  }
  return summarise(bills);
}

/** Everything a client owes in dollars, net of the credit they hold — the client page's "owed in all" less credit. */
export function clientOwedNet(db: Pick<DB, "orders" | "clients">, clientId: string): number {
  const client = db.clients.find(c => c.id === clientId);
  const orders = db.orders.filter(o => o.clientId === clientId && !o.deletedAt && o.status !== "Rejected" && !o.forReadyStock);
  const acc = clientAccount(orders, client?.creditBalance || 0, client);
  return Math.round(Math.max(0, acc.outstanding - acc.credit) * 100) / 100;
}

/**
 * Before taking on more for a client (a new order, a dispatch): whether they are over their
 * credit limit with it, and what is overdue. `adding` = what this step adds to what they owe
 * ($), 0 when it is already counted (an order already placed). `lines` = what to tell the user;
 * empty = nothing to say. Never blocks — the caller asks.
 */
export function creditCheck(db: Pick<DB, "orders" | "invoices" | "clients" | "settings">, clientId: string, adding = 0, now = Date.now()) {
  const client = db.clients.find(c => c.id === clientId);
  const limit = client?.creditLimitUsd && client.creditLimitUsd > 0 ? client.creditLimitUsd : undefined;
  const owed = clientOwedNet(db, clientId);
  const after = Math.round((owed + Math.max(0, adding)) * 100) / 100;
  const over = limit != null && after > limit + 0.005;
  const overdue = clientOverdue(db, clientId, now);
  const usd = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
  const lines: string[] = [];
  if (over) lines.push(`Over their credit limit: ${usd(after)} owed${adding > 0 ? " with this" : ""}, limit ${usd(limit!)}.`);
  if (overdue.count) lines.push(`${overdue.count} invoice${overdue.count === 1 ? "" : "s"} overdue — ${usd(overdue.amount)}, the oldest ${overdue.oldestDays} day${overdue.oldestDays === 1 ? "" : "s"} late (${overdue.bills.slice(0, 3).map(b => b.number).join(", ")}${overdue.count > 3 ? "…" : ""}).`);
  return { limit, owed, after, over, overdue, lines, left: limit != null ? Math.round((limit - owed) * 100) / 100 : undefined };
}
