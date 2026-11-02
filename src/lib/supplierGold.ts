// Gold taken from a supplier on loan — "uchinu" — and the supplier's gold
// account, kept in grams beside (never inside) their money account.
//
// The account is WORKED OUT, never stored on the supplier: each of its lines is
// already a record of its own, written once.
//   loanIn    — they lent us gold: a stock movement IN, refType "supplierLoan",
//               refId = the supplier. It goes into our gold stock.
//   returnOut — we gave gold back: a stock movement OUT, refType "supplierLoan",
//               out of our stock (floor-checked).
//   toBill    — gold owed paid for in money: a Purchase with fromGoldLoan, its
//               gold.weightGrams of fine (24K) gold at a rate. It moves no stock —
//               the gold is already in stock. Voiding the bill puts it back on
//               what is owed.
//   opening   — Supplier.openingGoldFine, owed before the app (the first company's).
// Owed to them, in fine grams = opening + loanIn − returnOut − toBill — per
// company, as the stock it came into and went out of is.
//
// A loan or a return is ONE write (lib/stock.ts: the counter and its line
// together), so nothing can be half saved, and no other save can wipe it out.
// Deleting one writes a line the other way that names it (reversesId,
// lib/stock.ts reverseMovement); the account leaves both out.
//
// Borrowed gold has no cost of ours: in the stock's average cost it joins at
// the average (lib/orderCost.ts poolAverage), never as zero-cost gold.
import { coField, companyById, hasCompanies } from "./companies";
import { collectionLoaded, loadDb, uid, updateDbAs, type DB, type Purchase, type StockMovement, type Supplier, type SupplierGoldEntry } from "./db";
import { deriveStockBalances, fmtMoneyInr } from "./manufacturing";
import { toPureGold } from "./pure/basics";
import { decreaseStockSelfHealing, increaseStock, reverseMovement } from "./stock";

const r3 = (n: number) => Math.round(n * 1000) / 1000;
const EPS = 0.0005;

/** The karats gold is bought and kept in — the same list the purchase form offers. */
export const GOLD_KARATS = ["9K", "10K", "14K", "18K", "22K", "24K"];

/** Fine (24K) grams in gold of a purity bucket ("22K" → × 0.916). */
export const goldFine = (grams: number, purity: string) => toPureGold(grams, purity);

/** "3.1 g". */
export const fmtG = (g: number) => `${r3(g).toLocaleString("en-IN", { maximumFractionDigits: 3 })} g`;

/** What the gold account is worked out from — both must have arrived before it means anything. */
export const GOLD_COLS = ["stockMovements", "purchases"] as const;
export const goldAccountReady = () => GOLD_COLS.every(c => collectionLoaded(c));

type GoldData = Pick<DB, "stockMovements" | "purchases">;

/** A gold-loan stock line (in or out, or one cancelling another). */
export const isLoanMove = (m: Pick<StockMovement, "refType" | "material">) => m.refType === "supplierLoan" && m.material === "gold";

/** "main" is stored as no company at all. */
const coOf = (companyId?: string) => (companyId && companyId !== "main" ? companyId : undefined);
const inCo = (companyId: string | undefined, want?: string) => !want || want === "all" || (companyId || "main") === want;

/**
 * Every line on a supplier's gold account, oldest first — the stock lines and
 * the bills; a line cancelled by another is left out with the one that cancelled it.
 */
export function supplierGoldEntries(d: GoldData, supplierId: string, companyId?: string): SupplierGoldEntry[] {
  const moves = (d.stockMovements ?? []).filter(m => isLoanMove(m) && m.refId === supplierId);
  const ids = new Set(moves.map(m => m.id));
  // A cancelling line and the one it cancels go together; one whose partner is
  // not on file stands on its own, so the account still follows the stock.
  const cancelled = new Set(moves.filter(m => m.reversesId && ids.has(m.reversesId)).map(m => m.reversesId!));
  const out: SupplierGoldEntry[] = [];
  for (const m of moves) {
    if (cancelled.has(m.id) || (m.reversesId && ids.has(m.reversesId))) continue;
    if (!inCo(m.companyId, companyId)) continue;
    const grams = r3(Math.abs(m.quantity));
    out.push({
      id: m.id, kind: m.type === "purchase_in" ? "loanIn" : "returnOut", grams, purity: m.purityOrQuality,
      fine: r3(m.fine ?? goldFine(grams, m.purityOrQuality)), ...coField(coOf(m.companyId)),
      at: m.createdAt, ...(m.note ? { note: m.note } : {}), by: m.createdBy, movementId: m.id,
    });
  }
  for (const p of d.purchases ?? []) {
    if (!p.fromGoldLoan || p.supplierId !== supplierId || !inCo(p.companyId, companyId)) continue;
    const fine = r3(p.gold?.weightGrams ?? 0);
    out.push({
      id: p.id, kind: "toBill", grams: fine, purity: "24K", fine, ...coField(coOf(p.companyId)),
      at: p.createdAt, by: p.createdBy, purchaseId: p.id, rateInr: p.gold?.ratePerGram,
    });
  }
  return out.sort((a, b) => (+new Date(a.at) - +new Date(b.at)) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

export interface SupplierGoldRow {
  id: string;
  at: string;
  kind: "opening" | SupplierGoldEntry["kind"];
  particulars: string;
  /** Grams in, as weighed (a loan) — or out (a return; a bill's fine grams). */
  inGrams: number;
  outGrams: number;
  purity: string;
  /** Fine grams, signed: + what we owe goes up, − it comes down. */
  fine: number;
  /** Fine grams owed after this line. */
  balance: number;
  entry?: SupplierGoldEntry;
}

export interface SupplierGoldAccount {
  /** Fine grams we owe them now (below zero only on records that went wrong — shown, never hidden). */
  owed: number;
  opening: number;
  taken: number;
  returned: number;
  billed: number;
  /** Oldest first, each with the balance after it. */
  rows: SupplierGoldRow[];
}

const entryWords = (e: SupplierGoldEntry): string => {
  if (e.kind === "loanIn") return `Gold taken on loan — ${fmtG(e.grams)} ${e.purity}`;
  if (e.kind === "returnOut") return `Gold returned — ${fmtG(e.grams)} ${e.purity}`;
  return `Turned into a bill — ${fmtG(e.fine)} fine${e.rateInr ? ` at ${fmtMoneyInr(e.rateInr)}/g` : ""}`;
};

type SupplierLike = Pick<Supplier, "id" | "openingGoldFine" | "openingGoldDate" | "createdAt">;

/**
 * The supplier's gold account: what we owe in fine grams, its parts, and every
 * line with a running balance. `companyId` keeps one company's lines only —
 * opening gold is the first company's ("main").
 */
export function supplierGoldOwed(d: GoldData, s: SupplierLike, companyId?: string): SupplierGoldAccount {
  const list = supplierGoldEntries(d, s.id, companyId);
  const opening = inCo(undefined, companyId) ? r3(Math.max(0, s.openingGoldFine ?? 0)) : 0;
  const rows: SupplierGoldRow[] = [];
  let bal = 0;
  if (opening > 0) {
    bal = opening;
    rows.push({ id: "opening", at: s.openingGoldDate || s.createdAt, kind: "opening", particulars: "Gold owed brought forward", inGrams: 0, outGrams: 0, purity: "24K", fine: opening, balance: bal });
  }
  let taken = 0, returned = 0, billed = 0;
  for (const e of list) {
    const fine = r3(e.fine || 0);
    const sign = e.kind === "loanIn" ? 1 : -1;
    if (e.kind === "loanIn") taken += fine; else if (e.kind === "returnOut") returned += fine; else billed += fine;
    bal = r3(bal + sign * fine);
    rows.push({
      id: e.id, at: e.at, kind: e.kind, particulars: `${entryWords(e)}${e.note ? ` · ${e.note}` : ""}`,
      inGrams: e.kind === "loanIn" ? e.grams : 0,
      outGrams: e.kind === "loanIn" ? 0 : (e.kind === "toBill" ? fine : e.grams),
      purity: e.purity, fine: r3(sign * fine), balance: bal, entry: e,
    });
  }
  return { owed: bal, opening, taken: r3(taken), returned: r3(returned), billed: r3(billed), rows };
}

/** Whether a supplier has a gold account to show — a line still standing, or opening gold.
 *  (Lines cancelled by others still name them in the stock history: partyGuards keeps such a supplier.) */
export function hasGoldAccount(d: GoldData, s: SupplierLike): boolean {
  return (s.openingGoldFine ?? 0) > 0 || supplierGoldEntries(d, s.id).length > 0;
}

/** Fine grams owed to suppliers for gold borrowed, all together — one company's, or every one's.
 *  Each supplier as their account stands, never floored: a figure below zero is shown, not hidden. */
export function goldOwedToSuppliers(d: GoldData & Pick<DB, "suppliers">, companyId?: string): number {
  return r3(d.suppliers.reduce((t, s) => t + (hasGoldAccount(d, s) ? supplierGoldOwed(d, s, companyId).owed : 0), 0));
}

export type Who = { id: string };

/** A date not after today — the form's yyyy-mm-dd already turned into an instant. */
function checkAt(at: string): string | null {
  const t = +new Date(at);
  if (!at || isNaN(t)) return "Choose the date";
  // The picked day keeps the time of entry, so a day ahead is the only way past now.
  if (t > Date.now() + 60_000) return "It can't be dated after today";
  return null;
}

export interface GoldMove {
  grams: number;
  purity: string;
  /** "main" or a company id — whose stock. */
  companyId?: string;
  at: string;
  note?: string;
}

/** Why a loan can't be taken as entered — or null. */
export function loanProblem(s: Supplier | undefined, m: GoldMove): string | null {
  if (!s) return "That supplier is not there any more";
  if (!(m.grams > 0)) return "Enter the grams";
  if (!m.purity) return "Choose the purity";
  return checkAt(m.at);
}

/** They lent us gold: into our stock, owed to them. One write — the stock line is the record. */
export async function takeGoldLoan(supplierId: string, m: GoldMove, who: Who): Promise<string> {
  const s = loadDb().suppliers.find(x => x.id === supplierId);
  const problem = loanProblem(s, m);
  if (problem) throw new Error(problem);
  const grams = r3(m.grams);
  return increaseStock({
    material: "gold", companyId: coOf(m.companyId), purityOrQuality: m.purity, quantity: grams,
    refType: "supplierLoan", refId: supplierId, fine: goldFine(grams, m.purity),
    createdBy: who.id, createdAt: m.at, note: m.note?.trim() || undefined,
  });
}

/** Gold in stock, by purity, for one company ("main" = the first). */
export const goldInStock = (d: Pick<DB, "stockMovements">, companyId?: string) =>
  deriveStockBalances(d.stockMovements ?? [], "gold", companyId || "main");

/** Fine gold owed to them in one company ("main" = the first) — what a return or a bill there may come to. */
export const owedIn = (d: GoldData, s: SupplierLike, companyId?: string) => supplierGoldOwed(d, s, companyId || "main").owed;

/** " in Shree Diamonds" — only where there are several companies. */
const coWords = (d: Pick<DB, "settings">, companyId?: string) =>
  hasCompanies(d.settings) ? ` in ${companyById(d.settings, companyId || "main").name}` : "";

const tooMuch = (owed: number, where: string) => owed > EPS
  ? `Only ${fmtG(owed)} fine is owed to them${where} — anything more would be a sale: use Sell to them`
  : `No gold is owed to them${where} — giving them gold would be a sale: use Sell to them`;

/**
 * Taking this out of one bucket of stock on that day: would the history run
 * below zero anywhere from then on (or lower than it already did)? A return
 * dated back must not be dated before the gold was there.
 */
function dipsBelow(d: Pick<DB, "stockMovements">, companyId: string | undefined, purity: string, grams: number, at: string): boolean {
  const co = companyId || "main";
  const list = (d.stockMovements ?? []).filter(x => x.material === "gold" && x.purityOrQuality === purity && (x.companyId || "main") === co)
    .map(x => ({ at: +new Date(x.createdAt), id: x.id, q: (x.type === "purchase_in" ? 1 : x.type === "adjustment" ? Math.sign(x.quantity) : -1) * Math.abs(x.quantity) }));
  const low = (l: typeof list) => {
    let bal = 0, lo = 0;
    for (const x of [...l].sort((a, b) => (a.at - b.at) || ((a.q > 0 ? 0 : 1) - (b.q > 0 ? 0 : 1)) || (a.id < b.id ? -1 : 1))) {
      bal = r3(bal + x.q); lo = Math.min(lo, bal);
    }
    return lo;
  };
  return low([...list, { at: +new Date(at), id: "~new", q: -grams }]) < Math.min(0, low(list)) - EPS;
}

/** Why a return can't be made as entered — or null. Checked against the gold owed IN the company it comes out of. */
export function returnProblem(d: GoldData & Pick<DB, "settings">, s: Supplier | undefined, m: GoldMove): string | null {
  if (!s) return "That supplier is not there any more";
  if (!(m.grams > 0)) return "Enter the grams";
  if (!m.purity) return "Choose the purity";
  const when = checkAt(m.at);
  if (when) return when;
  const owed = owedIn(d, s, m.companyId);
  if (goldFine(m.grams, m.purity) > owed + EPS) return tooMuch(owed, coWords(d, m.companyId));
  const have = goldInStock(d, m.companyId)[m.purity] ?? 0;
  if (r3(m.grams) > have + EPS) return `Only ${fmtG(Math.max(0, have))} of ${m.purity} gold is in stock${coWords(d, m.companyId)}`;
  if (dipsBelow(d, m.companyId, m.purity, r3(m.grams), m.at)) return `On that day there wasn't that much ${m.purity} gold in stock — date it later`;
  return null;
}

/** Changes to one supplier's gold on this device right now — a second click waits its turn. */
const busy = new Set<string>();

/** We gave gold back: out of our stock (floor-checked), off what we owe. One write — the stock line is the record. */
export async function returnGold(supplierId: string, m: GoldMove, who: Who): Promise<string> {
  if (busy.has(supplierId)) throw new Error("Already saving a change to their gold — a moment");
  const live = loadDb();
  const s = live.suppliers.find(x => x.id === supplierId);
  const problem = returnProblem(live, s, m);
  if (problem) throw new Error(problem);
  busy.add(supplierId);
  try {
    const grams = r3(m.grams);
    return await decreaseStockSelfHealing({
      material: "gold", companyId: coOf(m.companyId), purityOrQuality: m.purity, quantity: grams,
      type: "issuance_out", refType: "supplierLoan", refId: supplierId, fine: goldFine(grams, m.purity),
      createdBy: who.id, createdAt: m.at, note: m.note?.trim() || undefined,
    }, live.stockMovements ?? []);
  } finally {
    busy.delete(supplierId);
  }
}

export interface GoldBill {
  /** Fine (24K) grams of the gold owed that become the bill. */
  fine: number;
  /** ₹ a fine gram. */
  rateInr: number;
  /** "main" or a company id — whose bill (and whose gold owed it comes off). */
  companyId?: string;
  at: string;
  invoiceNumber?: string;
  note?: string;
}

/** Why gold can't be turned into a bill as entered — or null. Checked against the gold owed IN that company. */
export function billProblem(d: GoldData & Pick<DB, "settings">, s: Supplier | undefined, b: GoldBill): string | null {
  if (!s) return "That supplier is not there any more";
  if (!(b.fine > 0)) return "Enter the fine grams";
  if (!(b.rateInr > 0)) return "Enter the rate (₹ a gram)";
  const when = checkAt(b.at);
  if (when) return when;
  const owed = owedIn(d, s, b.companyId);
  const where = coWords(d, b.companyId);
  if (r3(b.fine) > owed + EPS) return owed > EPS ? `Only ${fmtG(owed)} fine is owed to them${where}` : `No gold is owed to them${where}`;
  return null;
}

export const billAmount = (fine: number, rateInr: number) => Math.round(r3(fine) * rateInr);

/**
 * Pay for borrowed gold in money: X fine grams owed become a rupee bill on
 * their account (a Purchase, fromGoldLoan) at the rate given. No stock moves —
 * the gold is already in stock. Voiding the bill puts the grams back on what
 * we owe (lib/purchaseVoid.ts).
 */
export function goldToBill(supplierId: string, b: GoldBill, who: Who): Purchase {
  const live = loadDb();
  const s = live.suppliers.find(x => x.id === supplierId);
  const problem = billProblem(live, s, b);
  if (problem) throw new Error(problem);
  const fine = r3(b.fine);
  const note = b.note?.trim();
  const totalInr = billAmount(fine, b.rateInr);
  const purchase: Purchase = {
    id: uid("pur_"), supplierId, material: "gold", gold: { weightGrams: fine, purity: "24K", ratePerGram: b.rateInr },
    ...coField(coOf(b.companyId)), purpose: "stock", currency: "INR", totalInr, payments: [],
    ...(b.invoiceNumber?.trim() ? { invoiceNumber: b.invoiceNumber.trim() } : {}),
    notes: `Gold taken on loan, billed — ${fmtG(fine)} fine${note ? ` · ${note}` : ""}`,
    fromGoldLoan: true, createdBy: who.id, createdAt: b.at,
  };
  let refused: string | null = null;
  updateDbAs({ summary: `Turned ${fmtG(fine)} fine gold owed to ${s!.name} into a bill of ${fmtMoneyInr(totalInr)}` }, d => {
    // Counted again on the latest records: another screen may have returned or billed meanwhile.
    const x = d.suppliers.find(y => y.id === supplierId);
    refused = billProblem(d, x, b);
    if (refused) return;
    if (!d.purchases) d.purchases = [];
    d.purchases.push(purchase);
  });
  if (refused) throw new Error(refused);
  return purchase;
}

/** Why this line can't be deleted — or null. */
export function goldEntryDeleteBlocker(d: GoldData & Pick<DB, "settings">, s: Supplier, e: SupplierGoldEntry): string | null {
  if (e.kind === "toBill") return "It is a bill — void the bill (Purchase History) and the gold goes back on what is owed";
  if (e.kind === "loanIn") {
    const owed = owedIn(d, s, e.companyId);
    if (owed - (e.fine || 0) < -EPS) return `Gold has been given back or billed against it${coWords(d, e.companyId)} — delete those first`;
    const have = goldInStock(d, e.companyId)[e.purity] ?? 0;
    if (have + EPS < e.grams) return `Only ${fmtG(Math.max(0, have))} of ${e.purity} gold is in stock — the rest has been used, so it can't come out again`;
  }
  return null;
}

/** In words, what deleting it does — for the confirm. */
export function goldEntryDeleteImpact(s: Supplier, e: SupplierGoldEntry): string[] {
  if (e.kind === "loanIn") return [`• ${fmtG(e.grams)} ${e.purity} comes out of stock`, `• ${fmtG(e.fine)} fine comes off what we owe ${s.name}`, "• both lines stay in the stock history, cancelling each other"];
  if (e.kind === "returnOut") return [`• ${fmtG(e.grams)} ${e.purity} goes back into stock`, `• ${fmtG(e.fine)} fine goes back on what we owe ${s.name}`, "• both lines stay in the stock history, cancelling each other"];
  return [];
}

/**
 * Delete a loan or a return entered by mistake: a stock line the other way that
 * names it — a loan's gold out of stock again (floor-checked), a return's back
 * in. One write, and never twice (lib/stock.ts reverseMovement). A bill is
 * voided instead.
 */
export async function deleteGoldEntry(supplierId: string, movementId: string, who: Who): Promise<void> {
  if (busy.has(supplierId)) throw new Error("Already saving a change to their gold — a moment");
  const live = loadDb();
  const s = live.suppliers.find(x => x.id === supplierId);
  const m = (live.stockMovements ?? []).find(x => x.id === movementId);
  const e = s ? supplierGoldEntries(live, supplierId).find(x => x.id === movementId) : undefined;
  if (!s || !m || !e || !isLoanMove(m) || m.refId !== supplierId) throw new Error("That line is already deleted");
  const why = goldEntryDeleteBlocker(live, s, e);
  if (why) throw new Error(why);
  busy.add(supplierId);
  try {
    await reverseMovement(m, who.id, e.kind === "loanIn" ? `Gold loan from ${s.name} deleted — taken back out of stock` : `Return to ${s.name} deleted — back in stock`);
  } finally {
    busy.delete(supplierId);
  }
}

/** Gold we already owed them when the app started, in fine grams (0 clears it) — the first company's. */
export function setOpeningGold(supplierId: string, fine: number, date: string | undefined): void {
  const f = r3(Number(fine) || 0);
  if (f < 0) throw new Error("Enter the fine grams owed — or 0 to clear it");
  const live = loadDb();
  const s = live.suppliers.find(x => x.id === supplierId);
  if (!s) throw new Error("That supplier is not there any more");
  let refused: string | null = null;
  updateDbAs({ summary: `Set the opening gold owed to ${s.name}: ${fmtG(f)} fine` }, d => {
    const x = d.suppliers.find(y => y.id === supplierId);
    if (!x) { refused = "That supplier is not there any more"; return; }
    // Never below what has already been given back or billed against it.
    const rest = owedIn(d, x, "main") - Math.max(0, x.openingGoldFine ?? 0);
    if (rest + f < -EPS) { refused = `${fmtG(-rest)} fine has already been given back or billed beyond the loans — the opening can't be less`; return; }
    if (f > 0) { x.openingGoldFine = f; if (date) x.openingGoldDate = date; else delete x.openingGoldDate; }
    else { delete x.openingGoldFine; delete x.openingGoldDate; }
  });
  if (refused) throw new Error(refused);
}
