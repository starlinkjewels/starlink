/**
 * Sales commission — what a salesperson earns on a sale: a share of its margin.
 *
 * The rules (admin only, in the admin store — never on the order or the
 * person's record, both of which clients and staff can read):
 *
 *  • The company's % — for every salesperson (lib/clientHandlers.ts salesStaff).
 *  • A person's own % — or "no commission" — in place of the company's, for
 *    anyone (an admin who sells too).
 *  • One order changed — someone else earns it, another %, or none.
 *
 * Every rule runs from a day ("from 1 April 2026: 8%"), so a change never
 * reaches back: each sale is paid at the % in force on the day it was sold.
 *
 * Who earns it: the employee the order is assigned to (who took it); else the
 * person handling the client. Earned on the margin — selling price less the
 * whole cost, freight included, at the rate of the day it was sold — never on
 * a loss. It is part of the order's cost (lib/orderCost.ts), so every profit
 * the app shows is after commission. Counted once the sale is shipped (the
 * Profit & Loss rule); a finished piece not shipped yet shows it as coming.
 *
 * This file is the rules and the arithmetic only — nothing here reads an
 * order's cost (that is lib/commissionLedger.ts), so the cost can use it.
 */
import { salesStaff } from "./clientHandlers";
import type { AdminRecord, DB, Order, User } from "./db";

export interface CommissionStep {
  /** The first day it applies, "YYYY-MM-DD". */
  from: string;
  /** % of the margin. A person's null: back to the company's %. 0: no commission. */
  pct: number | null;
}

export interface CommissionPlan {
  /** The company's % for its salespeople, by day. */
  company: CommissionStep[];
  /** A person's own % (or none), by day — in place of the company's. */
  staff: Record<string, CommissionStep[]>;
  setAt?: string;
  setBy?: string;
}

/** One order, changed by an admin. Each part left out stays as the rules say. */
export interface OrderCommissionSet {
  /** Who earns it instead; null — nobody (no commission on this order). */
  payeeId?: string | null;
  /** Another % for this order. */
  pct?: number | null;
  note?: string;
  at: string;
  by: string;
}

export const COMMISSION_ID = "commission";
export const orderCommissionId = (orderId: string) => `com_${orderId}`;

const r2 = (n: number) => Math.round(n * 100) / 100;
const day = (iso: string) => (iso || "").slice(0, 10);

/** The rules as they stand (none set: empty). */
export function commissionPlan(db: Pick<DB, "adminRecords">): CommissionPlan {
  const rec = (db.adminRecords ?? []).find(r => r.kind === "commission") as Extract<AdminRecord, { kind: "commission" }> | undefined;
  return { company: rec?.plan.company ?? [], staff: rec?.plan.staff ?? {}, setAt: rec?.plan.setAt, setBy: rec?.plan.setBy };
}

/** What an admin set on one order, if anything. */
export function orderCommissionSet(db: Pick<DB, "adminRecords">, orderId: string): OrderCommissionSet | undefined {
  const rec = (db.adminRecords ?? []).find(r => r.kind === "commissionOrder" && r.orderId === orderId) as Extract<AdminRecord, { kind: "commissionOrder" }> | undefined;
  return rec?.set;
}

/** The step in force on a day: the last one starting on or before it. */
export function stepOn(steps: CommissionStep[] | undefined, iso: string): CommissionStep | undefined {
  const d = day(iso);
  let pick: CommissionStep | undefined;
  for (const s of [...(steps ?? [])].sort((a, b) => a.from.localeCompare(b.from))) if (s.from <= d) pick = s;
  return pick;
}

/** Whether the company's % is theirs: a salesperson (as Handled by offers them). */
export function onCompanyRate(db: Pick<DB, "users">, u: User | undefined): boolean {
  return !!u && u.role === "employee" && salesStaff(db.users).some(x => x.id === u.id);
}

export type RateSource = "own" | "company" | "order";

/** A person's % on a day, and where it comes from — or null when they earn none. */
export function personRate(db: Pick<DB, "users" | "adminRecords">, userId: string, iso: string): { pct: number; source: RateSource } | null {
  const plan = commissionPlan(db);
  const own = stepOn(plan.staff[userId], iso);
  if (own && own.pct != null) return own.pct > 0 ? { pct: own.pct, source: "own" } : null;
  const u = db.users.find(x => x.id === userId);
  if (!onCompanyRate(db, u)) return null;
  const co = stepOn(plan.company, iso);
  return co && co.pct != null && co.pct > 0 ? { pct: co.pct, source: "company" } : null;
}

/** Who earns on an order, and why them. */
export function payeeOf(db: Pick<DB, "users" | "clients" | "adminRecords">, order: Pick<Order, "id" | "assignedEmployeeId" | "clientId">):
  { userId?: string; how: "order" | "assigned" | "handler" | "none" } {
  const set = orderCommissionSet(db, order.id);
  if (set && set.payeeId !== undefined) return set.payeeId ? { userId: set.payeeId, how: "order" } : { how: "none" };
  if (order.assignedEmployeeId && db.users.some(u => u.id === order.assignedEmployeeId)) return { userId: order.assignedEmployeeId, how: "assigned" };
  const handler = db.clients.find(c => c.id === order.clientId)?.accountManagerId;
  if (handler && db.users.some(u => u.id === handler)) return { userId: handler, how: "handler" };
  return { how: "none" };
}

/** A sale that can carry commission at all: client work with a price, not cancelled or deleted. */
export function commissionable(o: Pick<Order, "forReadyStock" | "status" | "amount" | "deletedAt">): boolean {
  return !o.forReadyStock && !o.deletedAt && o.status !== "Rejected" && o.amount > 0;
}

export interface CommissionLine {
  payeeId: string;
  payeeName: string;
  pct: number;
  source: RateSource;
  /** Why this person: the order was changed, it is theirs, or they handle the client. */
  how: "order" | "assigned" | "handler";
  /** The margin it is worked on — selling less every other cost, ₹. */
  baseInr: number;
  /** The commission, ₹ — nothing on a loss. */
  inr: number;
}

/**
 * The commission on one order, from its selling price in rupees (at the rate
 * of its sale day) and every other cost. Null when nobody earns on it.
 */
export function commissionFor(db: Pick<DB, "users" | "clients" | "adminRecords">, order: Order, sellingInr: number, otherCostInr: number, saleIso: string): CommissionLine | null {
  if (!commissionable(order)) return null;
  const who = payeeOf(db, order);
  if (!who.userId || who.how === "none") return null;
  const set = orderCommissionSet(db, order.id);
  let pct: number, source: RateSource;
  if (set && set.pct != null) {
    if (!(set.pct > 0)) return null;
    pct = set.pct; source = "order";
  } else {
    const r = personRate(db, who.userId, saleIso);
    if (!r) return null;
    pct = r.pct; source = r.source;
  }
  const baseInr = r2(sellingInr - otherCostInr);
  const inr = baseInr > 0 ? r2(baseInr * pct / 100) : 0;
  const name = db.users.find(u => u.id === who.userId)?.name ?? "Former team member";
  return { payeeId: who.userId, payeeName: name, pct, source, how: who.how, baseInr, inr };
}

/* ── Saving the rules: checked first, never into a closed year ───────────── */

const pctOk = (p: number | null) => p === null || (Number.isFinite(p) && p >= 0 && p <= 100);

/** Steps that start in a closed year, as they stand — what a change must leave alone. */
function closedSteps(steps: CommissionStep[] | undefined, closedTo: string | undefined): string {
  if (!closedTo) return "[]";
  return JSON.stringify([...(steps ?? [])].filter(s => s.from <= closedTo).sort((a, b) => a.from.localeCompare(b.from)));
}

/** Why the new rules can't be saved, or nothing. */
export function planProblem(before: CommissionPlan, after: CommissionPlan, closedTo: string | undefined): string | undefined {
  const all = [...after.company, ...Object.values(after.staff).flat()];
  for (const s of all) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s.from)) return "Each % needs the day it starts.";
    if (!pctOk(s.pct)) return "A commission is a % of the margin — between 0 and 100.";
  }
  const dup = (steps: CommissionStep[]) => new Set(steps.map(s => s.from)).size !== steps.length;
  if (dup(after.company) || Object.values(after.staff).some(dup)) return "Two % start on the same day — keep one.";
  if (closedTo) {
    const people = new Set([...Object.keys(before.staff), ...Object.keys(after.staff)]);
    const moved = closedSteps(before.company, closedTo) !== closedSteps(after.company, closedTo)
      || [...people].some(id => closedSteps(before.staff[id], closedTo) !== closedSteps(after.staff[id], closedTo));
    if (moved) return `A % from a closed year can't be changed (closed up to ${closedTo}) — set the new one from a later day.`;
  }
  return undefined;
}

/** Save the rules (inside updateDb). */
export function writePlan(d: DB, plan: CommissionPlan, by: string): void {
  if (!d.adminRecords) d.adminRecords = [];
  const clean = (steps: CommissionStep[]) => [...steps].sort((a, b) => a.from.localeCompare(b.from));
  const staff: Record<string, CommissionStep[]> = {};
  for (const [id, steps] of Object.entries(plan.staff)) if (steps.length) staff[id] = clean(steps);
  const rec = { id: COMMISSION_ID, kind: "commission", plan: { company: clean(plan.company), staff, setAt: new Date().toISOString(), setBy: by } } as AdminRecord;
  const i = d.adminRecords.findIndex(r => r.kind === "commission");
  if (i >= 0) d.adminRecords[i] = rec; else d.adminRecords.push(rec);
}

/** Change one order's commission, or (null) put it back to the rules. Inside updateDb. */
export function writeOrderCommission(d: DB, orderId: string, set: OrderCommissionSet | null): void {
  if (!d.adminRecords) d.adminRecords = [];
  const id = orderCommissionId(orderId);
  d.adminRecords = d.adminRecords.filter(r => r.id !== id);
  if (set) d.adminRecords.push({ id, kind: "commissionOrder", orderId, set } as AdminRecord);
}

/** The person's rules, in words: "8% from 1 Apr 2026 (company)". */
export function rateText(db: Pick<DB, "users" | "adminRecords">, userId: string, iso = new Date().toISOString()): string {
  const r = personRate(db, userId, iso);
  if (!r) return "No commission";
  return `${r.pct}% of margin${r.source === "company" ? " (company %)" : ""}`;
}
