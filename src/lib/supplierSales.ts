// Selling TO a supplier — the mirror of buying from one.
//
// A business sometimes sells to one of its own suppliers: loose diamonds from a
// lot, a certified stone, gold, another material, a finished piece from Ready
// Stock. One sale, any number of lines. What it does, and only this:
//   • stock — each line leaves our stock exactly as a sale out of it always has
//     (a stock movement marked "Sold to <supplier>"; a certified stone is marked
//     sold; a Ready Stock piece's count comes down);
//   • the supplier's account — the total comes off what we owe them
//     (supplierAccount, here and on the server);
//   • money received for it now, if any — an ordinary SupplierReceipt tied to the
//     sale: into one of our accounts, or COLLECTED BY THE BROKER for us (no entry
//     of ours; the broker holds it until he hands it over — lib/brokers.ts);
//   • brokerage, when a broker brought the deal — owed to him when we pay it (and
//     a cost of the sale), for reference when the supplier pays it;
//   • profit — each line keeps what it cost us at the moment it was sold, and the
//     Profit & Loss report shows the sales, their cost, brokerage and profit.
// Deleting a sale undoes all of it: every line back in stock, its money removed.
import type { DB, MaterialKey, SupplierSale, SupplierSaleLine, User } from "./db";
import { loadDb, updateDb, uid } from "./db";
import { doc, runTransaction } from "firebase/firestore";
import { db as fsdb } from "./firebase";
import { decreaseStockSelfHealing, increaseStock } from "./stock";
import { deriveStockBalances } from "./manufacturing";
import { stockAverageRate, rateOn } from "./orderCost";
import { stockCostOf } from "./db";
import { lotParts } from "./diamondLots";
import { logItem, whoOf } from "./readyStockHistory";
import { brokerAccount, saleBrokerageWePay } from "./brokers";

const r2 = (n: number) => Math.round(n * 100) / 100;
const companyOf = (s: { companyId?: string }) => s.companyId || "main";

/** A line's stock lives in the pooled stock (a lot, a purity, a grade) — not a stone or a piece of its own. */
export const pooled = (l: Pick<SupplierSaleLine, "kind">) => l.kind === "diamond" || l.kind === "gold" || l.kind === "material";

/**
 * What a line cost us, ₹, at `at` — the same figures an order's cost uses:
 * pooled stock at its running average, a certified stone at its own rate, a
 * Ready Stock piece at its cost ($, at that day's rate). Undefined when not known.
 */
export function lineCostInr(db: DB, line: Omit<SupplierSaleLine, "costInr">, companyId: string | undefined, at: string): number | undefined {
  if (pooled(line)) {
    const rate = stockAverageRate(db, line.material, line.bucket ?? "", at, companyId);
    return rate == null ? undefined : r2(rate * line.qty);
  }
  if (line.kind === "certified") {
    const p = (db.diamondPackets ?? []).find(x => x.id === line.packetId);
    return p?.ratePerCaratInr ? r2(p.ratePerCaratInr * p.carat) : undefined;
  }
  const item = (db.readyStock ?? []).find(x => x.id === line.readyStockItemId);
  const usd = item ? stockCostOf(db, item) : undefined;
  const fx = rateOn(db, at);
  return usd != null && fx ? r2(usd * fx.rate * line.qty) : undefined;
}

/** What a sold line cost us: as kept on it, or — a piece, whose cost only admins see — worked out now. */
export function saleLineCost(db: DB, sale: Pick<SupplierSale, "companyId" | "createdAt">, l: SupplierSaleLine): number | undefined {
  return l.costInr ?? (l.kind === "piece" ? lineCostInr(db, l, sale.companyId, sale.createdAt) : undefined);
}

/** Brokerage on a sale, ₹ — the amount typed, or the % of the total. */
export function saleBrokerage(totalInr: number, pct: number | undefined, amount: number | undefined): number {
  if (amount != null && amount > 0) return r2(amount);
  return pct && pct > 0 ? r2((totalInr * pct) / 100) : 0;
}

export interface SupplierSaleInput {
  companyId?: string;
  supplierId: string;
  /** Lines without their cost — worked out here. */
  lines: Omit<SupplierSaleLine, "costInr">[];
  brokerId?: string;
  brokeragePct?: number;
  brokerageInr?: number;
  brokeragePaidBy?: "us" | "supplier";
  /** Money received for it now: into an account of ours, or collected by the broker. */
  received?: { amountInr: number; lockerId?: string; byBroker?: boolean };
  notes?: string;
  /** The day it was sold (ISO). */
  at: string;
}

/** Why a sale can't be recorded — or null. */
export function saleProblem(db: DB, s: SupplierSaleInput): string | null {
  if (!s.supplierId) return "Choose the supplier";
  if (!s.lines.length) return "Add what you sold";
  for (const l of s.lines) {
    if (!(l.qty > 0)) return `Enter how much — ${l.label || "a line"}`;
    if (!(l.amountInr > 0)) return `Enter the price — ${l.label || "a line"}`;
    if (l.kind === "certified") {
      const p = (db.diamondPackets ?? []).find(x => x.id === l.packetId);
      if (!p || p.status !== "in_stock") return "That certified diamond is not in stock any more";
    }
  }
  // A piece on two lines counts once with both quantities — never more than there are.
  const pieceQty = new Map<string, number>();
  for (const l of s.lines) if (l.kind === "piece") pieceQty.set(l.readyStockItemId ?? "", (pieceQty.get(l.readyStockItemId ?? "") ?? 0) + l.qty);
  for (const [itemId, qty] of pieceQty) {
    const it = (db.readyStock ?? []).find(x => x.id === itemId);
    if (!it || it.quantity < qty) return `Only ${it?.quantity ?? 0} of ${it?.name || "that piece"} in stock`;
  }
  // Enough in stock for every pooled line (two lines from one lot count together) — said plainly, before anything moves.
  const want = new Map<string, { qty: number; l: Omit<SupplierSaleLine, "costInr"> }>();
  for (const l of s.lines.filter(pooled)) {
    const k = `${l.material}|${l.bucket ?? ""}`;
    want.set(k, { qty: (want.get(k)?.qty ?? 0) + l.qty, l });
  }
  for (const { qty, l } of want.values()) {
    const have = deriveStockBalances(db.stockMovements ?? [], l.material, s.companyId || "main")[l.bucket ?? ""] ?? 0;
    if (qty > have + 1e-6) return `Only ${Math.round(have * 1000) / 1000}${l.unit === "pcs" ? " pcs" : l.unit} of ${l.kind === "gold" ? `${l.bucket} gold` : l.bucket} in stock`;
  }
  const packets = s.lines.filter(l => l.kind === "certified").map(l => l.packetId);
  if (new Set(packets).size !== packets.length) return "The same certified diamond is on two lines";
  const total = r2(s.lines.reduce((t, l) => t + l.amountInr, 0));
  if (s.brokerId && (s.brokerageInr ?? 0) > total) return "The brokerage is more than the sale";
  const rec = s.received;
  if (rec) {
    if (!(rec.amountInr > 0)) return "Enter the amount received";
    if (rec.amountInr > total + 0.5) return "More received than the sale comes to — record the rest as a receipt";
    if (rec.byBroker && !s.brokerId) return "Choose the broker who collected it";
    if (!rec.byBroker && !rec.lockerId) return "Choose the account the money went into";
  }
  return null;
}

/**
 * Record a sale to a supplier. The pooled stock comes out first, line by line,
 * each in its own checked transaction (it refuses to go below zero); if a later
 * line can't, the ones already taken are put back and nothing is saved. Then the
 * sale, the stones, the pieces and the money in one save.
 */
export async function recordSupplierSale(db: DB, s: SupplierSaleInput, user: Pick<User, "id" | "name" | "role">): Promise<SupplierSale> {
  const problem = saleProblem(db, s);
  if (problem) throw new Error(problem);
  const supplier = db.suppliers.find(x => x.id === s.supplierId);
  if (!supplier) throw new Error("That supplier is gone");
  const saleId = uid("ssale_");
  const note = `Sold to ${supplier.name}`;
  const companyId = s.companyId && s.companyId !== "main" ? s.companyId : undefined;
  // A piece's cost is admin-only (adminRecords) and a sale is read by all staff, so a
  // piece keeps no cost here — the admin-only profit report works it out (saleLineCost).
  const lines: SupplierSaleLine[] = s.lines.map(l => {
    // Valued from this company's own stock — the first company's is "main", never everyone's together.
    const cost = l.kind === "piece" ? undefined : lineCostInr(db, l, s.companyId || "main", s.at);
    return { ...l, ...(cost != null ? { costInr: cost } : {}) };
  });

  const taken: SupplierSaleLine[] = [];
  try {
    for (const l of lines.filter(pooled)) {
      await decreaseStockSelfHealing({
        material: l.material as MaterialKey, companyId, purityOrQuality: l.bucket ?? "", quantity: l.qty,
        type: "issuance_out", refType: "supplierSale", refId: saleId, createdBy: user.id, note,
        ...(l.kind === "diamond" ? { lot: lotParts(l.bucket ?? ""), pieces: l.pieces } : {}),
      }, db.stockMovements);
      taken.push(l);
    }
  } catch (e) {
    // Put back what already came out — the sale is not recorded at all. If even that
    // fails, say exactly what is missing rather than leave it silently gone.
    const notBack: string[] = [];
    for (const l of taken) {
      await increaseStock({
        material: l.material as MaterialKey, companyId, purityOrQuality: l.bucket ?? "", quantity: l.qty,
        refType: "supplierSale", refId: saleId, createdBy: user.id, note: "Sale not recorded — put back",
        ...(l.kind === "diamond" ? { lot: lotParts(l.bucket ?? ""), pieces: l.pieces } : {}),
      }).catch(() => { notBack.push(l.label); });
    }
    const why = e instanceof Error ? e.message : String(e);
    throw new Error(notBack.length ? `${why} — and ${notBack.join(", ")} could not be put back: check Stock` : why);
  }

  const totalInr = r2(lines.reduce((t, l) => t + l.amountInr, 0));
  const brokerageInr = s.brokerId ? saleBrokerage(totalInr, s.brokeragePct, s.brokerageInr) : 0;
  const receiptId = s.received ? uid("srcpt_") : undefined;
  const sale: SupplierSale = {
    id: saleId, ...(companyId ? { companyId } : {}), supplierId: s.supplierId, lines, totalInr,
    ...(s.brokerId ? { brokerId: s.brokerId, brokeragePct: s.brokeragePct || undefined, brokerageInr, brokeragePaidBy: s.brokeragePaidBy ?? "us" } : {}),
    ...(receiptId ? { receiptId } : {}),
    ...(s.notes?.trim() ? { notes: s.notes.trim() } : {}),
    soldBy: user.id, createdAt: s.at,
  };
  const what = lines.map(l => l.label).join(", ");
  updateDb(d => {
    if (!d.supplierSales) d.supplierSales = [];
    d.supplierSales.unshift(JSON.parse(JSON.stringify(sale)));
    for (const l of lines) {
      if (l.kind === "certified") {
        const p = (d.diamondPackets ?? []).find(x => x.id === l.packetId);
        if (p) p.status = "sold";
      }
      if (l.kind === "piece") {
        const item = (d.readyStock ?? []).find(x => x.id === l.readyStockItemId);
        if (item) {
          const had = item.quantity;
          item.quantity = Math.max(0, item.quantity - l.qty);
          // On the piece's own history: sold to a supplier — the piece's history is staff-facing for a supplier sale.
          logItem(item, { ...whoOf(user), at: s.at, kind: "sold", text: `Sold to a supplier · ${had} → ${item.quantity}` });
        }
      }
    }
    if (s.received && receiptId) {
      const rec = s.received;
      if (!d.supplierReceipts) d.supplierReceipts = [];
      d.supplierReceipts.push({
        id: receiptId, supplierId: s.supplierId, amountInr: r2(rec.amountInr),
        lockerId: rec.byBroker ? "" : rec.lockerId!, recordedBy: user.id, createdAt: s.at, saleId,
        ...(rec.byBroker ? { viaBrokerId: s.brokerId } : {}),
        note: `For goods sold to them: ${what}`.slice(0, 300),
      });
      if (!rec.byBroker) {
        if (!d.lockerTransactions) d.lockerTransactions = [];
        d.lockerTransactions.push({
          id: uid("ltx_"), lockerId: rec.lockerId!, type: "income", amountInr: r2(rec.amountInr),
          category: `Received from ${supplier.name}`, refType: "supplierReceipt", refId: s.supplierId, paymentId: receiptId,
          // The supplier's money for goods — never offered for applying to a client's bill.
          notClientPayment: true,
          note: `For goods sold to them: ${what}`.slice(0, 300), recordedBy: user.id, createdAt: s.at,
        });
      }
    }
  });
  return sale;
}

/** In words, what deleting a sale will do — for the confirm. */
export function saleUndoImpact(db: DB, sale: SupplierSale): string[] {
  const out = sale.lines.map(l => `• ${l.label} goes back into stock`);
  const rec = sale.receiptId ? (db.supplierReceipts ?? []).find(r => r.id === sale.receiptId) : undefined;
  if (rec) out.push(rec.viaBrokerId ? `• the ₹${rec.amountInr.toLocaleString("en-IN")} the broker collected for it is removed` : `• the ₹${rec.amountInr.toLocaleString("en-IN")} received for it comes out of the account`);
  out.push(`• ₹${sale.totalInr.toLocaleString("en-IN")} goes back onto what we owe the supplier`);
  if (sale.brokerId && saleBrokerageWePay(sale) > 0) out.push(`• its brokerage comes off what we owe the broker`);
  return out;
}

/** Why a sale can't be deleted — or null. */
export function saleUndoBlocker(db: DB, sale: SupplierSale): string | null {
  for (const l of sale.lines) {
    if (l.kind === "certified") {
      const p = (db.diamondPackets ?? []).find(x => x.id === l.packetId);
      if (p && p.status !== "sold") return "Its certified diamond has been used since — it can't go back";
    }
  }
  // Money the broker collected for it and has since handed over to us: deleting the sale
  // would leave the broker's account saying we owe him what he handed over.
  const rec = sale.receiptId ? (db.supplierReceipts ?? []).find(r => r.id === sale.receiptId) : undefined;
  const broker = rec?.viaBrokerId ? (db.brokers ?? []).find(b => b.id === rec.viaBrokerId) : undefined;
  // Refused only when the broker no longer holds enough of ours to cover it — else his
  // account would turn to us owing him.
  if (rec && broker) {
    const acc = brokerAccount(db, broker);
    if (acc.held < rec.amountInr - 0.5) return `${broker.name} has already passed this money on to us, so the sale can't be deleted while the money is in our account. If the deal is reversed, record the refund to the supplier on its own.`;
  }
  return null;
}

/** Sales being deleted on this device right now — a second click does nothing. */
const undoing = new Set<string>();

/** Delete a sale: every line back in stock, its money removed, the account as before. */
export async function undoSupplierSale(db: DB, sale: SupplierSale, user: Pick<User, "id" | "name" | "role">): Promise<void> {
  void db;
  if (undoing.has(sale.id)) throw new Error("Already being deleted");
  // As it is now — not as the screen last drew it (it may be gone already).
  const live = loadDb();
  if (!(live.supplierSales ?? []).some(x => x.id === sale.id)) throw new Error("That sale is already deleted");
  const block = saleUndoBlocker(live, sale);
  if (block) throw new Error(block);
  undoing.add(sale.id);
  try {
    // Claimed on the record itself, in a transaction: two people deleting it at the same
    // moment on two screens — only one goes on. A claim that stopped half-way lapses in 5 minutes.
    await runTransaction(fsdb, async tx => {
      const ref = doc(fsdb, "supplierSales", sale.id);
      const snap = await tx.get(ref);
      if (!snap.exists()) throw new Error("That sale is already deleted");
      const at = (snap.data() as { deletingAt?: string }).deletingAt;
      if (at && Date.now() - +new Date(at) < 5 * 6e4) throw new Error("Already being deleted — on this or another screen");
      tx.update(ref, { deletingAt: new Date().toISOString() });
    });
    // Pooled stock first: if that fails the sale is left as it was rather than removed with the stock never back.
    // Each line only once: a line already put back (an earlier try that stopped half-way) is not put back again.
    const keyOf = (material: string, bucket: string) => `${material}|${bucket}`;
    const backAlready = new Map<string, number>();
    for (const m of live.stockMovements ?? []) {
      if (m.refType === "supplierSale" && m.refId === sale.id && m.type === "purchase_in") {
        const k = keyOf(m.material, m.purityOrQuality);
        backAlready.set(k, (backAlready.get(k) ?? 0) + 1);
      }
    }
    const seen = new Map<string, number>();
    for (const l of sale.lines.filter(pooled)) {
      const k = keyOf(l.material, l.bucket ?? "");
      const nth = (seen.get(k) ?? 0) + 1;
      seen.set(k, nth);
      if ((backAlready.get(k) ?? 0) >= nth) continue;
      await increaseStock({
        material: l.material as MaterialKey, companyId: sale.companyId, purityOrQuality: l.bucket ?? "", quantity: l.qty,
        refType: "supplierSale", refId: sale.id, createdBy: user.id, note: "Sale to supplier deleted — back in stock",
        ...(l.kind === "diamond" ? { lot: lotParts(l.bucket ?? ""), pieces: l.pieces } : {}),
      });
    }
    removeSaleRecords(sale, user);
  } finally {
    undoing.delete(sale.id);
  }
}

/** The sale's own records, put back as they were — after its pooled stock is back. */
function removeSaleRecords(sale: SupplierSale, user: Pick<User, "id" | "name" | "role">): void {
  updateDb(d => {
    // Gone already (deleted on another device meanwhile): nothing put back twice.
    if (!(d.supplierSales ?? []).some(x => x.id === sale.id)) return;
    for (const l of sale.lines) {
      if (l.kind === "certified") {
        const p = (d.diamondPackets ?? []).find(x => x.id === l.packetId);
        if (p && p.status === "sold") p.status = "in_stock";
      }
      if (l.kind === "piece") {
        const item = (d.readyStock ?? []).find(x => x.id === l.readyStockItemId);
        if (item) {
          const had = item.quantity;
          item.quantity = item.quantity + l.qty;
          logItem(item, { ...whoOf(user), kind: "unsold", text: `Sale to a supplier deleted · ${had} → ${item.quantity}` });
        }
      }
    }
    if (sale.receiptId) {
      d.supplierReceipts = (d.supplierReceipts ?? []).filter(r => r.id !== sale.receiptId);
      d.lockerTransactions = (d.lockerTransactions ?? []).filter(t => !(t.refType === "supplierReceipt" && t.paymentId === sale.receiptId));
    }
    d.supplierSales = (d.supplierSales ?? []).filter(x => x.id !== sale.id);
  });
}

/* ── Profit ── */

export interface SupplierSaleProfitRow {
  sale: SupplierSale;
  sellingInr: number;
  /** Cost of the lines, ₹ — null when any line's cost is not known. */
  costInr: number | null;
  /** Brokerage we pay on it, ₹. */
  brokerageInr: number;
  profitInr: number | null;
  /** In dollars, at the sale day's rate — null without a rate. */
  sellingUsd: number | null;
  profitUsd: number | null;
}

/** The sales to suppliers in a period, with their cost and profit — for Profit & Loss. */
export function supplierSalesProfit(db: DB, inRange: (iso: string) => boolean) {
  const rows: SupplierSaleProfitRow[] = (db.supplierSales ?? []).filter(s => inRange(s.createdAt)).map(sale => {
    const sellingInr = sale.totalInr;
    const costs = sale.lines.map(l => saleLineCost(db, sale, l));
    const costInr = costs.every(c => c != null) ? r2(costs.reduce((t: number, c) => t + (c ?? 0), 0)) : null;
    const brokerageInr = saleBrokerageWePay(sale);
    const profitInr = costInr == null ? null : r2(sellingInr - costInr - brokerageInr);
    const fx = rateOn(db, sale.createdAt);
    return {
      sale, sellingInr, costInr, brokerageInr, profitInr,
      sellingUsd: fx ? r2(sellingInr / fx.rate) : null,
      profitUsd: fx && profitInr != null ? r2(profitInr / fx.rate) : null,
    };
  }).sort((a, b) => b.sale.createdAt.localeCompare(a.sale.createdAt));
  const sum = (f: (r: SupplierSaleProfitRow) => number | null) => rows.some(r => f(r) == null) ? null : r2(rows.reduce((t, r) => t + (f(r) ?? 0), 0));
  return {
    rows,
    sellingInr: r2(rows.reduce((t, r) => t + r.sellingInr, 0)),
    costInr: sum(r => r.costInr),
    brokerageInr: r2(rows.reduce((t, r) => t + r.brokerageInr, 0)),
    profitInr: sum(r => r.profitInr),
    sellingUsd: sum(r => r.sellingUsd),
    profitUsd: sum(r => r.profitUsd),
  };
}

export { companyOf as saleCompanyOf };
