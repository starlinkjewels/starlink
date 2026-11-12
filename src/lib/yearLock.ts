/**
 * The closed-year lock. Once a financial year is closed (Settings → Year
 * closing), nothing DATED in it may be added, changed or deleted — by anyone,
 * admins included — until the main admin reopens the year. That is the standard
 * every accounting package keeps (a "lock date"): the figures a year was closed
 * on can never move afterwards.
 *
 * The lock goes by each entry's own date, not by the record it sits in. A
 * payment received today on an order placed in March is today's entry and is
 * allowed; the March payment on the same order is locked.
 *
 * For every kind of record, `lockedPart` is what of it belongs to the closed
 * year. A save may not change it, create one with it, or delete one holding it
 * (lib/db.ts persist checks every save this way, so no screen can get round it;
 * screens also say so before anyone starts — `closedWhy`).
 *
 * Only type imports from the app: lib/db.ts imports this file.
 */
import type { Settings } from "./db";
import { dayOf, fiscalYearOf, onOrBefore } from "./fiscalYear";

type Rec = Record<string, unknown>;
type Settingsish = Partial<Pick<Settings, "booksClosedTo" | "fyStartMonth" | "fyCustomDates" | "yearCloses">> | undefined | null;

/** The name of the closed year a day falls in — the year as it was closed
 *  (its own dates, a Diwali year say), else the financial year by month. */
export function closedYearKey(day: string, s: Settingsish): string {
  const e = (s?.yearCloses ?? []).find(x => x.status === "closed" && x.from <= day && day <= x.to);
  return e ? e.key : fiscalYearOf(day, s?.fyStartMonth || 4).key;
}

/** The last day of the last closed year, or undefined when no year is closed. */
export function closedTo(s: Settingsish): string | undefined {
  const v = s?.booksClosedTo;
  return typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined;
}

/** Whether a date falls in a closed year. */
export function isClosedDate(iso: string | Date | undefined | null, s: Settingsish): boolean {
  return onOrBefore(dayOf(iso ?? ""), closedTo(s));
}

/** A sale shipped in a closed year — what it sold for, and who took it (and so earned its
 *  sales commission, lib/commission.ts), stay as they were. The same test as the lock's. */
export function soldInClosedYear(o: { forReadyStock?: boolean; status?: string; amount?: number; dispatchedAt?: string; createdAt?: string; timeline?: { step: string; status: string; date?: string }[] }, s: Settingsish): boolean {
  const until = closedTo(s);
  if (!until) return false;
  const sold = !o.forReadyStock && o.status !== "Rejected" && num(o.amount) > 0 && (o.status === "Dispatched" || o.status === "Delivered");
  if (!sold) return false;
  const step = (o.timeline ?? []).find(t => t.step === "Dispatch" && t.status === "done");
  return dated(String(o.dispatchedAt || step?.date || o.createdAt || ""), until);
}

/** The words a screen shows when an entry is in a closed year, or null when it is not. */
export function closedWhy(iso: string | Date | undefined | null, s: Settingsish): string | null {
  if (!isClosedDate(iso, s)) return null;
  return `In the closed year ${closedYearKey(dayOf(iso ?? ""), s)} — the main admin can reopen it in Settings → Year closing`;
}

/** The first day a new entry may be dated (the day after the closed years), or undefined. */
export function firstOpenDay(s: Settingsish): string | undefined {
  const to = closedTo(s);
  if (!to) return undefined;
  const d = new Date(`${to}T00:00:00`);
  d.setDate(d.getDate() + 1);
  return dayOf(d);
}

/** Why an order cannot be deleted or moved to another client: it has entries in
 *  a closed year (a sale, a payment, a credit note). Null when it has none. */
export function orderClosedWhy(o: object, s: Settingsish): string | null {
  const until = closedTo(s);
  if (!until || !lockedPart("orders", o as Rec, until)) return null;
  return `It has entries in the closed year ${closedYearKey(until, s)} — the main admin can reopen it in Settings → Year closing`;
}

/* ── What of each record belongs to the closed years ───────────────────── */

const dated = (iso: unknown, until: string) => typeof iso === "string" ? onOrBefore(dayOf(iso), until) : false;
/** Undated old entries (from before dates were kept) count as closed. */
const datedOrOld = (iso: unknown, until: string) => iso == null || iso === "" ? true : dated(iso, until);
const pick = (r: Rec, keys: string[]): Rec => {
  const o: Rec = {};
  for (const k of keys) if (r[k] !== undefined) o[k] = r[k];
  return o;
};
const omit = (r: Rec, keys: string[]): Rec => {
  const o: Rec = { ...r };
  for (const k of keys) delete o[k];
  return o;
};
const arr = (v: unknown): Rec[] => (Array.isArray(v) ? (v as Rec[]) : []);
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const empty = (o: Rec) => Object.keys(o).length === 0;

/** Plain dated entries: the whole entry is the closed year's when its date is. */
const PLAIN: Record<string, { date: (r: Rec) => unknown; free?: string[] }> = {
  // "Not a client payment" only stops an entry being offered for matching — it moves no money.
  lockerTransactions: { date: r => r.createdAt, free: ["notClientPayment"] },
  expenses: { date: r => r.createdAt },
  supplierReceipts: { date: r => r.createdAt },
  supplierPayments: { date: r => r.createdAt },
  factoryPayments: { date: r => r.createdAt },
  clientReceipts: { date: r => r.date || r.createdAt },
  stockMovements: { date: r => r.createdAt },
  // Set only while a delete is under way.
  supplierSales: { date: r => r.createdAt, free: ["deletingAt"] },
};

/** The opening-balance fields of a party, which belong to the day they are "as of". */
const OPENING = ["openingBalance", "openingDir", "openingDate", "openingFineGold", "openingFineGoldDate", "openingGoldFine", "openingGoldDate",
  // An employee's advance owed before the app (lib/employeeAdvances.ts).
  "openingAdvance", "openingAdvanceCurrency", "openingAdvanceDate"];
const PARTIES = new Set(["clients", "suppliers", "factories", "brokers", "designers", "users"]);

/** What an order holds of the closed years: payments and returns dated in them, and — for a
 *  sale made in them — what it was sold for, to whom, and that it was sold. */
function orderPart(o: Rec, until: string): Rec | null {
  const out: Rec = {};
  const adv = arr(o.advances).filter(a => datedOrOld(a.createdAt, until));
  if (adv.length) out.advances = adv;
  // A return's credit note is dated when it is raised. Its parcel arriving later
  // (received, into Ready Stock) is the new year's event, so those fields are free.
  const ret = arr(o.returns).filter(r => dated(r.at, until))
    .map(r => omit(r, ["status", "receivedAt", "receivedBy", "readyStockId", "location", "priceUsd"]));
  if (ret.length) out.returns = ret;
  const status = String(o.status ?? "");
  const sold = !o.forReadyStock && status !== "Rejected" && num(o.amount) > 0 && (status === "Dispatched" || status === "Delivered");
  if (sold) {
    const timeline = arr(o.timeline);
    const step = timeline.find(t => t.step === "Dispatch" && t.status === "done");
    const saleDay = String(o.dispatchedAt || step?.date || o.createdAt || "");
    if (dated(saleDay, until)) {
      const charges = arr(o.otherCharges).reduce((s, c) => s + num(c.amountUsd), 0);
      out.sale = {
        clientId: o.clientId ?? null, sold: true, deleted: !!o.deletedAt,
        gross: Math.round((num(o.amount) + num(o.shippingCharge) + num(o.certificateFee) + charges) * 100) / 100,
        giftCardRedeemed: num(o.giftCardRedeemed), quantity: num(o.quantity),
        // Who took it: who earned its sales commission (lib/commission.ts).
        assignedEmployeeId: o.assignedEmployeeId ?? null,
      };
    }
  }
  return empty(out) ? null : out;
}

/**
 * What a factory issue holds of the closed years.
 *
 * Work runs across the year end: gold issued in March is often finished in May,
 * and finishing it (Final Approval, a cancel, the leftover settled) rewrites the
 * issue's quantity and pieces as part of that May event. So the lock holds what
 * the issue WAS — where it went, what material, from where, on which day — and
 * the money paid on it in the closed year; and once its final figures were
 * settled in the closed year, those too. Changing the quantity of a closed-year
 * issue on purpose (Edit issue) is refused on that screen (lib/issuanceEdit.ts).
 */
function issuancePart(i: Rec, until: string): Rec | null {
  const out: Rec = {};
  const pieces = arr(i.finishedPieces);
  const mc = (i.makingCharges ?? {}) as Rec;
  const pays = arr(mc.payments).filter(p => datedOrOld(p.createdAt, until));
  if (pays.length) out.payments = pays;
  if (dated(i.issuedAt, until)) {
    out.issue = pick(i, ["factoryId", "orderId", "material", "purityOrQuality", "source", "companyId", "diamondPacketIds", "issuedAt", "sourcePurchaseId"]);
    // Its final figures belong to the closed year when it was closed there: the
    // day it was closed — or, closed before that day was kept, its last piece
    // back (else the issue day).
    const lastBack = pieces.map(p => String(p.recordedAt ?? "")).sort().pop();
    const closedOn = (i.closedAt as string | undefined) || lastBack || (i.issuedAt as string | undefined);
    if (i.status === "closed" && dated(closedOn, until)) {
      out.final = {
        ...pick(i, ["status", "quantityIssued", "finishedNetWeight", "clientGoldNet", "finishedKarat", "finishedPurity", "finishDisposition", "finishReturnedCt", "finishReturnedPcs", "finishReturnedQty", "labour", "finishedPieces"]),
        charges: num(mc.amountInr),
      };
    }
  }
  return empty(out) ? null : out;
}

/**
 * The part of a record that belongs to the closed years — what a save must leave
 * exactly as it is. Null when nothing of it does.
 */
export function lockedPart(col: string, r: Rec | null | undefined, until: string | undefined): Rec | null {
  if (!r || !until) return null;
  const plain = PLAIN[col];
  if (plain) return dated(plain.date(r), until) ? omit(r, plain.free ?? []) : null;
  switch (col) {
    case "purchases": {
      const pays = arr(r.payments).filter(p => datedOrOld(p.createdAt, until));
      if (dated(r.createdAt, until)) return { ...omit(r, ["payments"]), payments: pays };
      return pays.length ? { payments: pays } : null;
    }
    case "diamondSales": {
      const pays = arr(r.payments).filter(p => datedOrOld(p.createdAt, until));
      if (dated(r.createdAt, until)) return { ...omit(r, ["payments"]), payments: pays };
      return pays.length ? { payments: pays } : null;
    }
    case "invoices":
      // `paid` is a stored hint the screens never trust (they work it out from the orders).
      return dated(r.createdAt, until) ? pick(r, ["orderId", "orderIds", "clientId", "number", "amount", "companyId", "createdAt"]) : null;
    case "orders": return orderPart(r, until);
    case "materialIssuances": return issuancePart(r, until);
    case "cadJobs":
      return r.status === "approved" && dated(r.approvedAt ?? r.createdAt, until) && num(r.chargeInr) > 0
        ? pick(r, ["designerId", "status", "chargeInr", "approvedAt", "companyId"]) : null;
    case "diamondPackets":
      return dated(r.createdAt, until) ? pick(r, ["carat", "ratePerCaratInr", "purchaseId", "companyId", "createdAt"]) : null;
    case "lockers":
      return dated(r.createdAt, until) ? pick(r, ["openingBalance", "currency", "createdAt"]) : null;
    case "memos": {
      // A memo (lib/memos.ts): what went out in a closed year, and what came back or
      // was sold in one, stay as they were. Goods still out can come back in the new year.
      const evs = arr(r.events).filter(e => dated(e.at, until));
      if (dated(r.at, until)) return { ...pick(r, ["no", "dir", "party", "at", "currency", "companyId", "lines"]), events: evs };
      return evs.length ? { events: evs } : null;
    }
    case "adminRecords": {
      // Sales commission rates (lib/commission.ts): a % that starts in a closed
      // year paid that year's sales — it stays as it was. A new % starts later.
      if (r.kind !== "commission") return null;
      const plan = (r.plan ?? {}) as Rec;
      const closedSteps = (steps: unknown) => arr(steps).filter(st => dated(st.from, until))
        .map(st => ({ from: st.from, pct: st.pct ?? null })).sort((a, b) => String(a.from).localeCompare(String(b.from)));
      const company = closedSteps(plan.company);
      const staff: Rec = {};
      for (const id of Object.keys((plan.staff ?? {}) as Rec).sort()) {
        const k = closedSteps(((plan.staff ?? {}) as Rec)[id]);
        if (k.length) staff[id] = k;
      }
      return company.length || !empty(staff) ? { company, staff } : null;
    }
    default:
      if (PARTIES.has(col)) {
        const o = pick(r, OPENING);
        if (empty(o)) return null;
        return datedOrOld(r.openingDate || r.openingGoldDate || r.openingFineGoldDate || r.openingAdvanceDate || r.createdAt, until) ? o : null;
      }
      return null;
  }
}

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** The year-closing fields of the settings — only the main admin may change them. */
const CLOSE_FIELDS = ["booksClosedTo", "fyStartMonth", "fyCustomDates", "yearCloses"] as const;

const NOUN: Record<string, string> = {
  lockerTransactions: "account entry", expenses: "expense", supplierReceipts: "money received from a supplier",
  supplierPayments: "advance to a supplier", factoryPayments: "advance to a factory", clientReceipts: "client receipt",
  stockMovements: "stock entry", memos: "memo", supplierSales: "sale to a supplier", purchases: "purchase", diamondSales: "diamond sale",
  invoices: "invoice", orders: "order", materialIssuances: "factory issue", cadJobs: "design charge",
  diamondPackets: "certified stone", lockers: "account's opening balance", clients: "client's opening balance",
  suppliers: "supplier's opening balance", factories: "factory's opening balance", brokers: "broker's opening balance",
  designers: "designer's opening balance", users: "employee's opening advance", adminRecords: "commission %",
};

/**
 * Every change in a save that would touch a closed year — empty when the save
 * may go through. `until` is the lock in force on the server (not a local edit
 * of it); `mainAdmin` is whether the person saving is the main admin.
 */
export function lockBreaches(
  changes: { col: string; id: string; before: Rec | null; after: Rec | null }[],
  until: string | undefined,
  mainAdmin: boolean,
): string[] {
  const out: string[] = [];
  for (const c of changes) {
    if (c.col === "meta") {
      if (!mainAdmin && CLOSE_FIELDS.some(k => !same(c.before?.[k], c.after?.[k]))) out.push("Only the main admin can close or reopen a year");
      continue;
    }
    if (!until) continue;
    const a = lockedPart(c.col, c.before, until);
    const b = lockedPart(c.col, c.after, until);
    if (same(a, b)) continue;
    const noun = NOUN[c.col] ?? "record";
    const an = `${/^[aeiou]/i.test(noun) ? "an" : "a"} ${noun}`;
    out.push(!c.after ? `Deleting ${an} from a closed year` : !c.before ? `Adding ${an} dated in a closed year` : `Changing ${an} in a closed year`);
  }
  return [...new Set(out)];
}

/** The message shown when a save is refused. */
export function breachMessage(breaches: string[], s: Settingsish): string {
  const to = closedTo(s);
  const fy = to ? { key: closedYearKey(to, s) } : null;
  const first = breaches[0] ?? "Changing a closed year";
  if (first.startsWith("Only the main admin")) return `Not saved — ${first.toLowerCase()}.`;
  return `Not saved — ${first.charAt(0).toLowerCase()}${first.slice(1)}${fy ? ` (closed up to ${fy.key})` : ""}. The main admin can reopen the year in Settings → Year closing.`;
}
