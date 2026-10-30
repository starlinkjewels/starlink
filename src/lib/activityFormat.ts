import type { ModuleKey } from "@/lib/modules";
import { fmtCcy } from "./currency";

/**
 * Turning a save into an activity-log entry a person can read.
 *
 * Every change anybody makes goes through one place on its way to the server,
 * and that place knows, for every record touched, exactly what it was before
 * and what it is after. This file reads those before/after pairs and says what
 * happened in plain words — "Edited client GIVARA JEWELRY: phone, address" —
 * which section it belongs to, and whether it can be safely undone.
 *
 * Pure: nothing here reads or writes the database, so it can be checked on its
 * own and cannot affect a save.
 */

export interface LoggedChange {
  col: string;
  id: string;
  op: "add" | "edit" | "delete";
  /** The record as it was, and as it is now. Absent when too large to keep. */
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  /** Human name of the record — "SLJ-2026-1092", "GIVARA JEWELRY". */
  label: string;
  /** Fields that changed, for an edit. */
  fields?: string[];
}

export type ActivityKind = "change" | "export" | "print" | "signin" | "undo";

export interface ActivityEntry {
  id: string;
  at: string;
  actorUid: string;
  actorId: string;
  actorName: string;
  actorRole: string;
  kind: ActivityKind;
  module: ModuleKey | string;
  summary: string;
  changes?: LoggedChange[];
  undoable: boolean;
  undoBlocker?: string;
  /** Snapshots were dropped to fit; the entry still says what changed. */
  truncated?: boolean;
  undoneAt?: string;
  undoneBy?: string;
  undoneByName?: string;
  /** For an undo: the entry it reversed. */
  undoOf?: string;
  meta?: Record<string, unknown>;
}

/** Collections whose changes are not worth a line in the log: chat, alerts,
 *  favourites — every one of them would bury what matters. */
export const LOG_SKIP_COLS = new Set(["messages", "chats", "notifications", "catalogFavorites"]);

/** Fields that change on their own and say nothing about what a person did. */
const NOISE_FIELDS = new Set(["lastActiveAt", "fcmTokens", "updatedAt"]);

const COL_MODULE: Record<string, ModuleKey> = {
  orders: "orders", clients: "clients", users: "employees", invoices: "invoices",
  expenses: "expenses", lockers: "locker", lockerTransactions: "locker",
  suppliers: "suppliers", purchases: "suppliers", supplierReceipts: "suppliers", supplierPayments: "suppliers", brokers: "suppliers",
  factories: "factories", materialIssuances: "factories", factoryPayments: "factories",
  designers: "designers", cadJobs: "designers",
  stockMovements: "stock", diamondPackets: "stock", diamondSales: "stock", supplierSales: "suppliers", diamondBags: "stock",
  readyStock: "readyStock", giftCards: "giftCards", clientReceipts: "payments",
  catalogFolders: "catalog", catalogItems: "catalog", shares: "catalog",
  productPhotoFolders: "productPhotos", productPhotoItems: "productPhotos",
  tasks: "dashboard", meta: "settings", adminRecords: "settings",
};

const COL_NOUN: Record<string, string> = {
  orders: "order", clients: "client", users: "staff member", invoices: "invoice",
  expenses: "expense", lockers: "account", lockerTransactions: "account entry",
  suppliers: "supplier", purchases: "purchase", supplierReceipts: "money from supplier",
  supplierPayments: "supplier payment", brokers: "broker", factories: "factory", materialIssuances: "material issue",
  factoryPayments: "factory payment", designers: "designer", cadJobs: "design job", stockMovements: "stock movement", diamondPackets: "certified stone",
  diamondSales: "diamond sale", supplierSales: "sale to a supplier", diamondBags: "diamond bag", readyStock: "ready-stock item", giftCards: "gift card",
  clientReceipts: "receipt", catalogFolders: "catalog folder", catalogItems: "catalog item",
  shares: "share link", productPhotoFolders: "photo folder", productPhotoItems: "product photo",
  tasks: "task", meta: "settings", adminRecords: "admin figure",
};

/** Which record is the point of a save that touched several. A payment touches
 *  the order, the receipt and the account; the receipt is what a person did. */
const PRIORITY = [
  "orders", "clients", "users", "invoices", "clientReceipts", "purchases", "expenses",
  "suppliers", "brokers", "factories", "designers", "cadJobs", "readyStock", "diamondPackets", "materialIssuances", "giftCards",
  "supplierPayments", "factoryPayments", "supplierReceipts", "diamondSales", "supplierSales", "lockers",
  "catalogFolders", "catalogItems", "productPhotoFolders", "productPhotoItems", "shares",
  "tasks", "meta", "adminRecords", "lockerTransactions", "diamondBags", "stockMovements",
];

/** Records that follow from an action rather than stand for one. */
const BOOKKEEPING = new Set(["lockerTransactions", "stockMovements", "diamondBags", "meta", "adminRecords", "tasks"]);

export function moduleOfCol(col: string, doc?: Record<string, unknown> | null): ModuleKey {
  if (col === "users" && doc && doc.role === "client") return "clients";
  return COL_MODULE[col] ?? "dashboard";
}

const s = (v: unknown) => (v == null ? "" : String(v));
const num = (v: unknown) => (typeof v === "number" ? v.toLocaleString("en-IN") : s(v));
/** An amount in the record's own currency (unset = rupees) — an account can hold any. */
const money = (v: unknown, code: unknown) => (typeof v === "number" ? fmtCcy(v, s(code) || undefined) : s(v));

/** The name a person would use for this record. */
export function docLabel(col: string, d: Record<string, unknown> | null | undefined, id: string): string {
  if (!d) return id;
  switch (col) {
    case "orders": return s(d.orderNumber) || id;
    case "clients": return s(d.companyName) || id;
    case "users": return `${s(d.name) || s(d.email) || id}${d.role ? ` (${s(d.role)})` : ""}`;
    case "invoices": return s(d.number) || id;
    case "expenses": return `${s(d.title)} · ${money(d.amount, d.currency)}`;
    case "lockers": case "suppliers": case "factories": return s(d.name) || id;
    case "lockerTransactions": return `${s(d.type)} ${money(d.amountInr, d.currency)}${d.category ? ` · ${s(d.category)}` : ""}`;
    case "purchases": {
      const g = d.gold as { weightGrams?: number; purity?: string } | undefined;
      const dm = d.diamond as { carat?: number; shape?: string } | undefined;
      const ot = d.other as { qty?: number; grade?: string } | undefined;
      const what = d.material === "gold" ? `${g?.weightGrams ?? ""}g ${g?.purity ?? ""}`
        : d.material === "diamond" ? `${dm?.carat ?? ""}ct ${dm?.shape ?? ""}`
        : `${ot?.qty ?? ""} ${ot?.grade ?? ""}`;
      return `${what.trim()} · ₹${num(d.totalInr)}${d.invoiceNumber ? ` · bill ${s(d.invoiceNumber)}` : ""}`;
    }
    case "materialIssuances": return d.material === "gold" || d.material === "diamond"
      ? `${s(d.material)} ${num(d.quantityIssued)}${d.material === "gold" ? "g" : "ct"} ${s(d.purityOrQuality)}`
      : `${num(d.quantityIssued)} ${s(d.purityOrQuality)}`;
    case "stockMovements": return d.pcsCount != null ? `Recount: ${num(d.pcsCount)} pcs · ${s(d.purityOrQuality)}`
      : d.refType === "bagMove" ? `${d.type === "purchase_in" ? "Into" : "Out of"} a bag: ${num(d.quantity)} ct ${s(d.purityOrQuality)}`
      : `${s(d.type)} ${num(d.quantity)} ${s(d.purityOrQuality)}`;
    case "diamondPackets": return s(d.stockNumber) || s(d.certificateNumber) || id;
    case "diamondSales": return `${num(d.carat)}ct ${s(d.shape)}`;
    case "supplierSales": return `₹${num(d.totalInr)} sale`;
    case "diamondBags": return s(d.no) ? `${s(d.no)} · ${s(d.key)}` : s(d.key) || id;
    case "readyStock": return s(d.sku) ? `${s(d.sku)} ${s(d.name)}` : s(d.name) || id;
    case "giftCards": return `$${num(d.amount)}`;
    case "clientReceipts": return `${s(d.receiptNo)} · $${num(d.amountUsd)}`;
    case "supplierPayments": case "factoryPayments": case "supplierReceipts": return `₹${num(d.amountInr ?? d.amount)}`;
    case "catalogFolders": case "catalogItems": case "productPhotoFolders": case "productPhotoItems":
      return s(d.name) || s(d.title) || id;
    case "tasks": return s(d.title) || id;
    case "meta": return "settings";
    case "adminRecords": return d.kind === "fx" ? "exchange rates" : d.kind === "stockCost" ? "a ready-stock cost" : id;
    default: return s(d.name) || s(d.title) || id;
  }
}

/** Order-independent text of a value, for telling whether two copies agree. */
export function stable(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v ?? null);
  if (Array.isArray(v)) return `[${v.map(stable).join(",")}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o).filter(k => o[k] !== undefined).sort().map(k => `${JSON.stringify(k)}:${stable(o[k])}`).join(",")}}`;
}

/** The fields that differ between two copies, leaving out the self-updating ones. */
export function changedFields(before: Record<string, unknown>, after: Record<string, unknown>): string[] {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  return [...keys].filter(k => !NOISE_FIELDS.has(k) && stable(before[k]) !== stable(after[k])).sort();
}

/** "courierName" → "courier name". */
export function fieldLabel(k: string): string {
  return k.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/_/g, " ").toLowerCase();
}

/**
 * Build the change list for one save. Records that changed only in their
 * self-updating fields are dropped, so a heartbeat never becomes an entry.
 */
export function describeChanges(raw: { col: string; id: string; before: Record<string, unknown> | null; after: Record<string, unknown> | null }[]): LoggedChange[] {
  const out: LoggedChange[] = [];
  for (const r of raw) {
    if (LOG_SKIP_COLS.has(r.col)) continue;
    const op: LoggedChange["op"] = !r.before ? "add" : !r.after ? "delete" : "edit";
    const fields = op === "edit" ? changedFields(r.before!, r.after!) : undefined;
    if (op === "edit" && !fields!.length) continue;
    out.push({ col: r.col, id: r.id, op, before: r.before, after: r.after, label: docLabel(r.col, r.after ?? r.before, r.id), fields });
  }
  return out;
}

const VERB = { add: "Added", edit: "Edited", delete: "Deleted" } as const;

/** One line for the whole save, led by the record that was the point of it. */
export function summarise(changes: LoggedChange[]): { summary: string; module: ModuleKey } {
  // Something created is usually what the person did — recording a payment
  // adds a receipt and, as a consequence, edits the order it pays. So an add
  // leads over edits it caused, unless what was added is only bookkeeping (an
  // account line, a stock movement) that never stands for the action itself.
  const rank = (c: LoggedChange) => {
    const i = PRIORITY.indexOf(c.col);
    const base = i < 0 ? 99 : i;
    return c.op === "add" && !BOOKKEEPING.has(c.col) ? base : 1000 + base;
  };
  const main = [...changes].sort((a, b) => rank(a) - rank(b))[0];
  const noun = COL_NOUN[main.col] ?? main.col;
  const what = main.col === "meta" ? "settings" : `${noun} ${main.label}`;
  const fields = main.fields?.length
    ? `: ${main.fields.slice(0, 4).map(fieldLabel).join(", ")}${main.fields.length > 4 ? ` +${main.fields.length - 4} more` : ""}`
    : "";
  const rest = changes.length - 1;
  return {
    summary: `${VERB[main.op]} ${what}${fields}${rest > 0 ? ` (and ${rest} related change${rest !== 1 ? "s" : ""})` : ""}`,
    module: moduleOfCol(main.col, main.after ?? main.before),
  };
}

/**
 * Why a save cannot be undone by putting its records back, or nothing if it can.
 *
 * Undo here means restoring each record exactly as it was. Some changes reach
 * further than their records, and putting the records back would leave the
 * rest behind — so for those the answer is no, and the reason says what to do.
 */
export function undoBlocker(changes: LoggedChange[], truncated: boolean): string | undefined {
  if (truncated) return "Too large to keep a full copy, so it cannot be put back automatically.";
  if (changes.length > 60) return "Too many records changed at once to undo as a single step.";
  // A melt put stones (and perhaps gold) back in stock, which an undo here
  // cannot take out again.
  if (changes.some(c => c.col === "orders" && c.after?.melted && !c.before?.melted)) {
    return "A melt put metal and stones back in stock. It cannot be undone from here.";
  }
  // A sales return reaches the client's credit, gift cards and Ready Stock;
  // receiving or cancelling one does too. Its own Cancel return undoes it whole.
  if (changes.some(c => c.col === "orders" && JSON.stringify(c.after?.returns ?? null) !== JSON.stringify(c.before?.returns ?? null))) {
    return "A return changed the client's bill, their credit and Ready Stock. Use \"Cancel return\" on the order instead.";
  }
  // A sale out of stock (to a supplier, or a diamond sold straight from stock) took its
  // stock out in a write of its own, which this entry does not hold: putting the records
  // back would bring the sale or its money back without the stock — or the other way round.
  if (changes.some(c => c.col === "supplierSales")) {
    return "A sale to a supplier moves stock and money together. Delete it, or record it again, on the supplier's page.";
  }
  if (changes.some(c => c.col === "diamondSales")) {
    return "A diamond sale moves the stone and its money together. Cancel it in Buy & Assign instead.";
  }
  // The client's own gold and diamonds: a receipt, a hand-back or a send.
  // Undone here, a send already used — or a receipt already sent on — would
  // leave their balance and the factory's gold out of step.
  if (changes.some(c =>
    (c.col === "clients" && JSON.stringify(c.after?.materialLedger ?? null) !== JSON.stringify(c.before?.materialLedger ?? null))
    || (c.col === "materialIssuances" && (c.after?.source === "client" || c.before?.source === "client")))) {
    return "The client's own material moved with this. Use Hand back on the client's page, or Undo on the order's send, instead.";
  }
  if (changes.some(c => c.col === "stockMovements")) {
    return "Stock levels moved with this. Reverse it with the record's own Remove or Cancel, which puts the stock back too.";
  }
  if (changes.some(c => c.col === "users" && c.after?.authUid && (c.op === "add" || !c.before?.authUid))) {
    return "A sign-in was created with this. Deactivate the person instead — a login cannot be removed from here.";
  }
  if (changes.some(c => (c.col === "orders" || c.col === "giftCards") && c.op === "add")) {
    return "Orders and gift cards are never deleted. Cancel, reject or revoke it instead.";
  }
  return undefined;
}
