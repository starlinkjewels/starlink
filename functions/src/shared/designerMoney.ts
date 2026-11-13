// GENERATED from src/lib/pure/designerMoney.ts by functions/scripts/sync-shared.cjs - do not edit here.
/**
 * A freelance designer's account — charged when we approve a design, less what
 * we paid them. Pure: the staff pages (lib/designers.ts) and the designer's own
 * statement (functions designerWork, copied to functions/src/shared by
 * functions/scripts/sync-shared.cjs) work it out with exactly this code.
 *
 * Only the fields these sums read are named here, so the same code runs on the
 * app's full records and on the server's.
 */
import { openingCreditAmt, openingDebitAmt } from "./basics";

const r2 = (n: number) => Math.round(n * 100) / 100;

/** The parts of a design job the money reads. */
export interface DesignJobMoney { id: string; designerId: string; status: string; chargeInr?: number; approvedAt?: string; createdAt: string }
/** The parts of an account entry the money reads. */
export interface DesignerPayEntry { refType?: string; refId?: string; type: string; amountInr: number; partyAmountInr?: number; cadJobId?: string; createdAt: string }
/** The designer, for what was owed before the app. */
export interface DesignerOpening { id: string; openingBalance?: number; openingDir?: "debit" | "credit"; openingDate?: string }

/** What we paid a designer: account entries "designerPayment" to them. */
export function designerPayments<T extends DesignerPayEntry>(txs: readonly T[] | undefined, designerId: string): T[] {
  // In rupees, as their account is kept: one paid from another currency's account counts
  // the rupees it settled (partyAmountInr), not the dollars that left the account.
  return (txs ?? []).filter(t => t.refType === "designerPayment" && t.refId === designerId && t.type === "expense")
    .map(t => (t.partyAmountInr != null ? { ...t, amountInr: t.partyAmountInr } : t));
}

/** Their approved designs that carry a charge, oldest approved first. */
export function chargedJobs<J extends DesignJobMoney>(jobs: readonly J[] | undefined, designerId: string): J[] {
  return (jobs ?? []).filter(j => j.designerId === designerId && j.status === "approved" && (j.chargeInr ?? 0) > 0)
    .sort((a, b) => (a.approvedAt ?? a.createdAt).localeCompare(b.approvedAt ?? b.createdAt));
}

export interface DesignerAccount {
  /** Approved designs and their charges (with any owed from before the app). */
  designs: number; charged: number; opening: number;
  paid: number;
  /** Still to pay them. */
  due: number;
  /** Paid ahead of the work. */
  advance: number;
}

/** A freelancer's account: charged on approval, less what we paid. In-house designers have none (salary is paid as salary). */
export function designerAccount(jobs: readonly DesignJobMoney[] | undefined, txs: readonly DesignerPayEntry[] | undefined, designer: DesignerOpening): DesignerAccount {
  const charged = chargedJobs(jobs, designer.id);
  const charges = r2(charged.reduce((s, j) => s + (j.chargeInr ?? 0), 0));
  const opening = r2(openingCreditAmt(designer) - openingDebitAmt(designer));
  const paid = r2(designerPayments(txs, designer.id).reduce((s, t) => s + (t.amountInr || 0), 0));
  const net = r2(opening + charges - paid);
  return { designs: charged.length, charged: charges, opening, paid, due: Math.max(0, net), advance: Math.max(0, r2(-net)) };
}

/**
 * Each approved design's paid and still-due part. A payment made against one
 * design settles that one first; the rest — payments on account, overflow, an
 * advance from before the app — settles the oldest approved designs first
 * (after anything owed from before the app). Read-only: nothing is stored.
 */
export function jobPayState(jobs: readonly DesignJobMoney[] | undefined, txs: readonly DesignerPayEntry[] | undefined, designer: DesignerOpening): Map<string, { charge: number; paid: number; due: number }> {
  const charged = chargedJobs(jobs, designer.id);
  const out = new Map(charged.map(j => [j.id, { charge: j.chargeInr ?? 0, paid: 0, due: j.chargeInr ?? 0 }]));
  let pool = r2(openingDebitAmt(designer));
  let openingOwed = r2(openingCreditAmt(designer));
  for (const t of designerPayments(txs, designer.id)) {
    const row = t.cadJobId ? out.get(t.cadJobId) : undefined;
    if (row) {
      const take = Math.min(row.due, t.amountInr || 0);
      row.paid = r2(row.paid + take); row.due = r2(row.due - take);
      pool = r2(pool + (t.amountInr || 0) - take);
    } else pool = r2(pool + (t.amountInr || 0));
  }
  const first = Math.min(pool, openingOwed);
  pool = r2(pool - first); openingOwed = r2(openingOwed - first);
  for (const j of charged) {
    if (pool <= 0) break;
    const row = out.get(j.id)!;
    const take = Math.min(row.due, pool);
    row.paid = r2(row.paid + take); row.due = r2(row.due - take); pool = r2(pool - take);
  }
  return out;
}

/** A month's work and money, "2026-10" → designs approved, charged, paid. */
export function designerMonths(jobs: readonly DesignJobMoney[] | undefined, txs: readonly DesignerPayEntry[] | undefined, designer: DesignerOpening): Map<string, { designs: number; charged: number; paid: number }> {
  const m = new Map<string, { designs: number; charged: number; paid: number }>();
  const at = (k: string) => { let v = m.get(k); if (!v) m.set(k, v = { designs: 0, charged: 0, paid: 0 }); return v; };
  for (const j of jobs ?? []) if (j.designerId === designer.id && j.status === "approved" && j.approvedAt) {
    const v = at(j.approvedAt.slice(0, 7)); v.designs++; v.charged = r2(v.charged + (j.chargeInr ?? 0));
  }
  for (const t of designerPayments(txs, designer.id)) { const v = at(t.createdAt.slice(0, 7)); v.paid = r2(v.paid + (t.amountInr || 0)); }
  return m;
}
