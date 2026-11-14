// Landed cost — what it took to get a purchase into our hands besides the supplier's bill:
// freight / courier, insurance, customs duty, lab or certification fees. The trade (and
// inventory accounting) puts these into the goods' cost, so every gram or carat in stock
// carries them: a charge on a bill is spread over its material lines by their value
// (Purchase.landedCosts, each line's share) and lib/brokers.ts landedInr adds it — so the
// stock average, the fine-gold rate, an order's cost and a certified stone's rate all
// include it, through the one function they already read.
//
// The money: paid from one of our accounts, it is an account entry of its own (refType
// "landedCost") — cash out, never an expense, so the P&L counts it once (in the goods'
// cost), not twice. Owed to someone else, or paid outside the app: cost only.
// The supplier's own bill and account never change. Ready-made pieces keep their cost on
// the piece (admin-only), so they are not part of a landed cost here.
import type { DB, LandedCostKind, Purchase, User } from "./db";
import { loadDb, uid, updateDb } from "./db";
import { closedWhy } from "./yearLock";

export const LANDED_KINDS: { key: LandedCostKind; label: string }[] = [
  { key: "freight", label: "Freight / courier" },
  { key: "insurance", label: "Insurance" },
  { key: "duty", label: "Customs duty" },
  { key: "lab", label: "Lab / certification fee" },
  { key: "other", label: "Other" },
];
export const landedKindLabel = (k: LandedCostKind) => LANDED_KINDS.find(x => x.key === k)?.label ?? "Other";
const r2 = (n: number) => Math.round(n * 100) / 100;

/** This line's share of every landed cost on it, ₹. */
export const landedExtraInr = (p: Pick<Purchase, "landedCosts">) => r2((p.landedCosts ?? []).reduce((t, c) => t + (c.inr || 0), 0));

/** The bill a purchase line is on: its supplier's lines saved together (one Buy form save). */
export function billLines(db: Pick<DB, "purchases">, p: Purchase): Purchase[] {
  return (db.purchases ?? []).filter(x => x.supplierId === p.supplierId && x.createdAt === p.createdAt && (x.invoiceNumber ?? "") === (p.invoiceNumber ?? ""));
}
/** Lines a landed cost can go on: material (not a ready-made piece), not borrowed gold made into a bill. */
export const takesLanded = (p: Purchase) => p.material !== "readyPiece" && !p.fromGoldLoan;

/** One charge on a bill, line by line (each charge has one id across its lines). */
export interface BillCharge { id: string; kind: LandedCostKind; inr: number; note?: string; at: string; lockerId?: string; lockerTxnId?: string; lines: { purchaseId: string; inr: number }[] }
export function billCharges(lines: Purchase[]): BillCharge[] {
  const m = new Map<string, BillCharge>();
  for (const p of lines) for (const c of p.landedCosts ?? []) {
    const b = m.get(c.chargeId) ?? { id: c.chargeId, kind: c.kind, inr: 0, note: c.note, at: c.at, lockerId: c.lockerId, lockerTxnId: c.lockerTxnId, lines: [] };
    b.inr = r2(b.inr + c.inr);
    b.lines.push({ purchaseId: p.id, inr: c.inr });
    m.set(c.chargeId, b);
  }
  return [...m.values()].sort((a, b) => a.at.localeCompare(b.at));
}

export interface LandedInput { kind: LandedCostKind; inr: number; note?: string; at: string; lockerId?: string }

/** Why a landed cost can't be added to these lines now; null when it can. */
export function landedProblem(db: DB, lines: Purchase[], input: LandedInput): string | null {
  if (!lines.length) return "Pick the lines it is for";
  if (lines.some(p => !takesLanded(p))) return "A ready-made piece's cost is set on the piece in Ready Stock";
  for (const p of lines) { const closed = closedWhy(p.createdAt, db.settings); if (closed) return closed; }
  if (!(input.inr > 0)) return "Enter the amount, ₹";
  if (input.kind === "other" && !input.note?.trim()) return "Other: say what it was for";
  if (input.lockerId) {
    const l = db.lockers.find(x => x.id === input.lockerId);
    if (!l) return "Choose the account it was paid from";
    if ((l.currency ?? "INR") !== "INR") return "Pay it from a rupee account — or leave the account blank and record the payment where it was made";
  }
  return null;
}

/** A certified stone's rate follows its purchase's landed cost (lib/brokers.ts landedInr). */
function repriceStones(d: DB, p: Purchase, landed: (p: Purchase) => number): void {
  for (const pk of d.diamondPackets ?? []) {
    if (pk.purchaseId !== p.id || !(pk.carat > 0)) continue;
    pk.ratePerCaratInr = Math.round((landed(p) / pk.carat) * 100) / 100;
  }
}

/**
 * Add a landed cost to a bill's lines — spread by each line's value (equally when none has
 * a value), the last line taking the rounding. Paid from an account: that account's entry too.
 */
export async function addLandedCost(purchaseIds: string[], input: LandedInput, user: Pick<User, "id">): Promise<string> {
  const { landedInr } = await import("./brokers");
  const db0 = loadDb();
  const lines = purchaseIds.map(id => (db0.purchases ?? []).find(p => p.id === id)).filter((p): p is Purchase => !!p);
  const why = landedProblem(db0, lines, input);
  if (why) throw new Error(why);
  const chargeId = uid("lc_");
  const total = r2(input.inr);
  const values = lines.map(p => Math.max(0, p.totalInr || 0));
  const sum = values.reduce((t, v) => t + v, 0);
  const shares = lines.map((_, i) => (sum > 0 ? r2(total * values[i] / sum) : r2(total / lines.length)));
  shares[shares.length - 1] = r2(total - shares.slice(0, -1).reduce((t, v) => t + v, 0));
  updateDb(d => {
    let txnId: string | undefined;
    if (input.lockerId) {
      txnId = uid("lt_");
      const bill = lines[0];
      d.lockerTransactions = [{
        id: txnId, lockerId: input.lockerId, type: "expense", amountInr: total, currency: "INR", category: "Landed cost",
        refType: "landedCost", refId: bill.id, paymentId: chargeId,
        note: `${landedKindLabel(input.kind)} on ${bill.invoiceNumber ? `bill ${bill.invoiceNumber}` : "a purchase"} from ${d.suppliers.find(s => s.id === bill.supplierId)?.name ?? "a supplier"}${input.note?.trim() ? ` — ${input.note.trim()}` : ""}`,
        recordedBy: user.id, createdAt: input.at,
      }, ...(d.lockerTransactions ?? [])];
    }
    lines.forEach((l, i) => {
      const p = d.purchases.find(x => x.id === l.id);
      if (!p) return;
      p.landedCosts = [...(p.landedCosts ?? []), {
        chargeId, kind: input.kind, inr: shares[i], at: input.at, by: user.id,
        ...(input.note?.trim() ? { note: input.note.trim() } : {}),
        ...(input.lockerId ? { lockerId: input.lockerId, lockerTxnId: txnId } : {}),
      }];
      repriceStones(d, p, landedInr);
    });
  });
  return chargeId;
}

/** Take a landed cost off again — from every line it was spread on, with its account entry. */
export async function removeLandedCost(chargeId: string): Promise<void> {
  const { landedInr } = await import("./brokers");
  const db0 = loadDb();
  const lines = (db0.purchases ?? []).filter(p => (p.landedCosts ?? []).some(c => c.chargeId === chargeId));
  for (const p of lines) { const closed = closedWhy(p.createdAt, db0.settings); if (closed) throw new Error(closed); }
  updateDb(d => {
    let txnId: string | undefined;
    for (const l of lines) {
      const p = d.purchases.find(x => x.id === l.id);
      if (!p) continue;
      txnId = txnId ?? (p.landedCosts ?? []).find(c => c.chargeId === chargeId)?.lockerTxnId;
      p.landedCosts = (p.landedCosts ?? []).filter(c => c.chargeId !== chargeId);
      if (!p.landedCosts.length) delete p.landedCosts;
      repriceStones(d, p, landedInr);
    }
    if (txnId) d.lockerTransactions = (d.lockerTransactions ?? []).filter(t => t.id !== txnId);
  });
}
