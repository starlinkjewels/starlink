// Purchase return — goods sent back to the supplier against their bills, on a
// debit note ("DN-0001").
//
// The goods leave stock and the value comes off what we owe the supplier — the
// same proven path as a sale to a supplier (lib/supplierSales.ts: checked stock
// out, the credit on their account here and on the server, undo), recorded with
// `returnOf` so it is never a sale: it is not in Profit & Loss's sales to
// suppliers, and every screen calls it a return.
//   • value — the bill line's own price for what goes back: its share of the
//     line, GST and discount included (changeable by hand);
//   • money — off their account, or a refund received now into an account;
//   • brokerage on the bill stays as it was (the broker earned it on the deal).
// Only goods bought into stock, and still there, can go back; a bill line can
// never be returned past what it was for.
import type { DB, Purchase, SupplierSale, SupplierSaleKind, User } from "./db";
import { recordSupplierSale, type SupplierSaleInput } from "./supplierSales";
import { deriveStockBalances } from "./manufacturing";
import { lotLabel } from "./diamondLots";
import { materialName, materialUnit } from "./materials";
import { reserveSequence, highestSuffix } from "./counters";
import { closedWhy } from "./yearLock";

const r2 = (n: number) => Math.round(n * 100) / 100;
const r3 = (n: number) => Math.round(n * 1000) / 1000;
type Who = Pick<User, "id" | "name" | "role">;

export interface ReturnableLine {
  purchase: Purchase;
  kind: SupplierSaleKind;
  material: string;
  /** Pooled goods: where they sit in stock (the lot, purity or grade). */
  bucket?: string;
  packetId?: string;
  readyStockItemId?: string;
  unit: string;
  label: string;
  /** On the bill; returned already; what can go back now (still on the bill AND in stock). */
  bought: number;
  returned: number;
  canReturn: number;
  /** Why none can go back, when canReturn is 0. */
  why?: string;
  /** The bill's price per unit, GST and discount included, ₹. */
  unitInr: number;
  /** Stones counted on the bill, for a loose line. */
  pieces?: number;
}

/** A debit note's lines already against this bill line. */
function returnedOf(db: Pick<DB, "supplierSales">, purchaseId: string): number {
  let q = 0;
  for (const s of db.supplierSales ?? []) if (s.returnOf) for (const l of s.lines) if (l.purchaseId === purchaseId) q += l.qty;
  return r3(q);
}

/** What one supplier's bills hold that can go back — newest bill first. */
export function returnableLines(db: DB, supplierId: string): ReturnableLine[] {
  const out: ReturnableLine[] = [];
  const moves = db.stockMovements ?? [];
  for (const p of [...(db.purchases ?? [])].filter(x => x.supplierId === supplierId).sort((a, b) => b.createdAt.localeCompare(a.createdAt))) {
    if (p.purpose !== "stock" || p.fromGoldLoan) continue;
    const co = p.companyId || "main";
    const returned = returnedOf(db, p.id);
    const bill = (q: number) => (q > 0 ? r2(p.totalInr / q) : 0);
    const into = moves.find(m => m.refType === "purchase" && m.refId === p.id && m.type === "purchase_in");
    if (p.material === "readyPiece" && p.piece) {
      const it = (db.readyStock ?? []).find(x => x.id === p.piece!.readyStockId);
      const left = Math.max(0, p.piece.qty - returned);
      const can = Math.min(left, it?.quantity ?? 0);
      out.push({ purchase: p, kind: "piece", material: "piece", readyStockItemId: p.piece.readyStockId, unit: "pcs", label: p.piece.name,
        bought: p.piece.qty, returned, canReturn: can, unitInr: bill(p.piece.qty),
        why: can > 0 ? undefined : left <= 0 ? "All returned already" : "Not on the shelf any more (sold or moved)" });
      continue;
    }
    if (p.material === "diamond" && p.diamond?.kind === "certified") {
      const pk = (db.diamondPackets ?? []).find(x => x.purchaseId === p.id);
      const back = returned > 0;
      const ok = !!pk && pk.status === "in_stock" && !back;
      out.push({ purchase: p, kind: "certified", material: "certified", packetId: pk?.id, unit: "ct",
        label: `${pk?.stockNumber ? `${pk.stockNumber} · ` : ""}${p.diamond.shape} ${p.diamond.carat}ct certified${p.diamond.certificateNumber ? ` (${p.diamond.certificateNumber})` : ""}`,
        bought: p.diamond.carat, returned, canReturn: ok ? p.diamond.carat : 0, unitInr: bill(p.diamond.carat),
        why: ok ? undefined : back ? "Returned already" : !pk ? "The stone is not on record" : "Not in stock any more (issued, sold or on memo)" });
      continue;
    }
    // Pooled: gold, loose diamonds, other materials — where the bill put them in stock.
    const material = p.material;
    const bought = p.gold?.weightGrams ?? p.diamond?.carat ?? p.other?.qty ?? 0;
    const bucket = into?.purityOrQuality ?? p.gold?.purity ?? p.other?.grade;
    if (!bucket || !(bought > 0)) continue;
    const inStock = deriveStockBalances(moves, material, co)[bucket] ?? 0;
    const left = Math.max(0, r3(bought - returned));
    const can = r3(Math.max(0, Math.min(left, inStock)));
    const kind: SupplierSaleKind = material === "gold" ? "gold" : material === "diamond" ? "diamond" : "material";
    const unit = kind === "gold" ? "g" : kind === "diamond" ? "ct" : materialUnit(db.settings, material);
    const label = kind === "gold" ? `${bucket} gold` : kind === "diamond" ? lotLabel(bucket) : `${materialName(db.settings, material)}${bucket !== "—" ? ` ${bucket.includes("·") ? lotLabel(bucket) : bucket}` : ""}`;
    out.push({ purchase: p, kind, material, bucket, unit, label, bought, returned, canReturn: can, unitInr: bill(bought),
      ...(p.diamond?.pieces ? { pieces: p.diamond.pieces } : {}),
      why: can > 0 ? undefined : left <= 0 ? "All returned already" : "None of it is in stock now (used or issued)" });
  }
  return out;
}

export async function reserveDebitNoteNumber(sales: Pick<SupplierSale, "returnOf">[]): Promise<string> {
  const floor = highestSuffix(sales.map(s => s.returnOf?.noteNo), 0) + 1;
  const seq = await reserveSequence("debitNoteNo", floor);
  return `DN-${String(seq).padStart(4, "0")}`;
}

export interface ReturnPick { purchaseId: string; qty: number; amountInr: number; pieces?: number }
export interface PurchaseReturnInput {
  supplierId: string;
  picks: ReturnPick[];
  at: string;
  reason?: string;
  /** A refund received now, into one of our accounts. */
  refund?: { amountInr: number; lockerId: string };
}

/** Why it can't go back like this — or null. */
export function returnProblem(db: DB, s: PurchaseReturnInput): string | null {
  if (!s.picks.length) return "Tick what goes back";
  const lines = returnableLines(db, s.supplierId);
  const cos = new Set<string>();
  for (const x of s.picks) {
    const l = lines.find(y => y.purchase.id === x.purchaseId);
    if (!l) return "That bill line can't be returned";
    if (!(x.qty > 0)) return `Enter how much goes back — ${l.label}`;
    if (x.qty > l.canReturn + 1e-6) return `Only ${r3(l.canReturn)} ${l.unit} of ${l.label} can go back${l.why ? ` — ${l.why.toLowerCase()}` : ""}`;
    if (l.kind === "piece" && !Number.isInteger(x.qty)) return `Whole pieces only — ${l.label}`;
    if (!(x.amountInr > 0)) return `Enter the value — ${l.label}`;
    cos.add(l.purchase.companyId || "main");
  }
  if (cos.size > 1) return "These bills belong to different companies — return each company's goods on its own debit note";
  if (s.refund) {
    const total = r2(s.picks.reduce((t, x) => t + x.amountInr, 0));
    if (!(s.refund.amountInr > 0)) return "Enter the refund";
    if (s.refund.amountInr > total + 0.5) return "More refunded than the goods come to — record the rest as a receipt";
    if (!s.refund.lockerId) return "Choose the account the refund went into";
  }
  return closedWhy(s.at, db.settings);
}

/** Send goods back on a debit note. Returns the record it made (a SupplierSale with `returnOf`). */
export async function recordPurchaseReturn(db: DB, s: PurchaseReturnInput, user: Who): Promise<SupplierSale> {
  const problem = returnProblem(db, s);
  if (problem) throw new Error(problem);
  const lines = returnableLines(db, s.supplierId);
  const noteNo = await reserveDebitNoteNumber(db.supplierSales ?? []);
  const picked = s.picks.map(x => ({ x, l: lines.find(y => y.purchase.id === x.purchaseId)! }));
  const companyId = picked[0].l.purchase.companyId;
  const input: SupplierSaleInput = {
    companyId, supplierId: s.supplierId, at: s.at,
    notes: `Debit note ${noteNo}${s.reason?.trim() ? ` — ${s.reason.trim()}` : ""}`,
    returnOf: { noteNo, purchaseIds: [...new Set(picked.map(p => p.l.purchase.id))], ...(s.reason?.trim() ? { reason: s.reason.trim() } : {}) },
    lines: picked.map(({ x, l }) => {
      const part = l.bought > 0 ? x.qty / l.bought : 1;
      const pcs = x.pieces ?? (l.pieces && Math.abs(part - 1) < 1e-6 ? l.pieces : undefined);
      return {
        kind: l.kind, material: l.material, ...(l.bucket ? { bucket: l.bucket } : {}), ...(pcs ? { pieces: pcs } : {}),
        ...(l.packetId ? { packetId: l.packetId } : {}), ...(l.readyStockItemId ? { readyStockItemId: l.readyStockItemId } : {}),
        purchaseId: l.purchase.id, qty: x.qty, unit: l.unit,
        label: `${l.label}${l.purchase.invoiceNumber ? ` — bill ${l.purchase.invoiceNumber}` : ""}`,
        amountInr: r2(x.amountInr), ...(x.qty > 0 ? { rateInr: r2(x.amountInr / x.qty) } : {}),
      };
    }),
    ...(s.refund ? { received: { amountInr: s.refund.amountInr, lockerId: s.refund.lockerId } } : {}),
  };
  return recordSupplierSale(db, input, user);
}

/** Returned so far against one bill, ₹ — for the bill's own line in a statement. */
export function billReturnedInr(db: Pick<DB, "supplierSales">, purchaseId: string): number {
  let v = 0;
  for (const s of db.supplierSales ?? []) if (s.returnOf) for (const l of s.lines) if (l.purchaseId === purchaseId) v += l.amountInr;
  return r2(v);
}

/** The debit notes against one bill. */
export function billReturns(db: Pick<DB, "supplierSales">, purchaseId: string): SupplierSale[] {
  return (db.supplierSales ?? []).filter(s => s.returnOf?.purchaseIds.includes(purchaseId));
}

export const isReturn = (s: Pick<SupplierSale, "returnOf">) => !!s.returnOf;
