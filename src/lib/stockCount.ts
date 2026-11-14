// A physical stock count (stock-take): count what is really there, then post the differences.
//
// Counting changes nothing — the count is kept (admin-only, adminRecords kind "stockCount") and
// can be picked up again. Posting is the admin's step: each line that differs needs a reason, and
// the difference against the book AT THAT MOMENT goes in as a stock movement (more found: in;
// less: out — refType "manual", note "Stock count SC-…"), a loose lot's stone count as a recount.
// Each posted line is marked on the count as it goes, so a failure part-way never posts a line twice.
import { ensureCollections, loadDb, uid, updateDb, type AdminRecord, type DB, type MaterialKey } from "./db";
import { deriveStockBalances } from "./manufacturing";
import { lotBalances, lotParts } from "./diamondLots";
import { decreaseStockSelfHealing, increaseStock, recountBag } from "./stock";

export interface StockCountLine {
  /** The bucket: a gold purity, a loose lot's key, a material's grade. */
  key: string;
  /** The book when the count was taken (for the record; posting re-reads it). */
  book: number;
  bookPcs?: number | null;
  /** What was counted; unset = not counted (left alone). */
  counted?: number;
  countedPcs?: number;
  reason?: string;
  /** Set when posted: the difference that went in, and its pieces. */
  posted?: { diff: number; pcsTo?: number; at: string };
}

export interface StockCount {
  id: string;
  no: string;
  material: string;
  /** Whose stock — "main" = the first company. */
  companyId: string;
  status: "counting" | "posted";
  lines: StockCountLine[];
  startedAt: string;
  byName: string;
  savedAt?: string;
  postedAt?: string;
  postedBy?: string;
}

type CountRecord = Extract<AdminRecord, { kind: "stockCount" }>;
const r3 = (n: number) => Math.round(n * 1000) / 1000;

export function stockCounts(db: Pick<DB, "adminRecords">): StockCount[] {
  return (db.adminRecords ?? []).filter((r): r is CountRecord => r.kind === "stockCount").map(r => r.count)
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}

/** The open count for this material and company, if one was started. */
export function openCount(db: Pick<DB, "adminRecords">, material: string, companyId: string): StockCount | undefined {
  return stockCounts(db).find(c => c.status === "counting" && c.material === material && c.companyId === companyId);
}

/** The book now: every bucket of this material and company with stock (and a loose lot's stones). */
export function bookLines(db: Pick<DB, "stockMovements">, material: string, companyId: string): StockCountLine[] {
  const bal = deriveStockBalances(db.stockMovements ?? [], material, companyId);
  const pcs = material === "diamond" ? new Map(lotBalances(db.stockMovements ?? [], companyId).map(l => [l.key, l.pcs])) : undefined;
  return Object.entries(bal).filter(([, q]) => Math.abs(q) > 0.0005)
    .map(([key, q]) => ({ key, book: r3(q), ...(pcs ? { bookPcs: pcs.get(key) ?? null } : {}) }))
    .sort((a, b) => a.key.localeCompare(b.key));
}

/** A new count's number: SC-0001, SC-0002… */
function nextNo(db: Pick<DB, "adminRecords">): string {
  const n = stockCounts(db).reduce((m, c) => Math.max(m, Number(c.no.replace(/\D/g, "")) || 0), 0) + 1;
  return `SC-${String(n).padStart(4, "0")}`;
}

/** Start a count (or the open one) with the book as it is now. */
export function startCount(material: string, companyId: string, byName: string): StockCount {
  const db = loadDb();
  const open = openCount(db, material, companyId);
  if (open) return open;
  const count: StockCount = {
    id: uid("sc_"), no: nextNo(db), material, companyId, status: "counting",
    lines: bookLines(db, material, companyId), startedAt: new Date().toISOString(), byName,
  };
  updateDb(d => { d.adminRecords = [...(d.adminRecords ?? []), { id: count.id, kind: "stockCount", count } as AdminRecord]; });
  return count;
}

/** Keep what was counted so far — nothing in stock changes. */
export function saveCount(count: StockCount): void {
  updateDb(d => {
    const r = (d.adminRecords ?? []).find(x => x.id === count.id) as CountRecord | undefined;
    if (!r || r.count.status !== "counting") return;
    r.count = { ...count, savedAt: new Date().toISOString() };
  });
}

/** Throw the count away (it was never posted). */
export function discardCount(id: string): void {
  updateDb(d => {
    const r = (d.adminRecords ?? []).find(x => x.id === id) as CountRecord | undefined;
    if (!r || r.count.status !== "counting") return;
    d.adminRecords = (d.adminRecords ?? []).filter(x => x.id !== id);
  });
}

/** What posting would do: each counted line against the book NOW. */
export function postPlan(db: Pick<DB, "stockMovements">, count: StockCount) {
  const now = new Map(bookLines(db, count.material, count.companyId).map(l => [l.key, l]));
  return count.lines.filter(l => l.counted != null && !l.posted).map(l => {
    const bookNow = now.get(l.key)?.book ?? 0;
    const diff = r3((l.counted ?? 0) - bookNow);
    const pcsNow = now.get(l.key)?.bookPcs;
    const pcsTo = count.material === "diamond" && l.countedPcs != null && l.countedPcs !== pcsNow ? Math.round(l.countedPcs) : undefined;
    return { line: l, bookNow, diff, pcsTo, moved: Math.abs(diff) > 0.0005 || pcsTo != null };
  });
}

/** Lines that differ but have no reason yet — posting waits for them. */
export function missingReasons(db: Pick<DB, "stockMovements">, count: StockCount): string[] {
  return postPlan(db, count).filter(p => p.moved && !p.line.reason?.trim()).map(p => p.line.key);
}

/**
 * Post the differences (admin). Each line goes in on its own and is marked on the count as it goes;
 * the count is closed when every counted line is posted. Throws on the first line that fails — the
 * ones before it stay posted, and posting again carries on from there.
 */
export async function postCount(count: StockCount, by: { id: string; name: string }): Promise<number> {
  await ensureCollections(["stockMovements"]);
  const plan = postPlan(loadDb(), count);
  const why = plan.filter(p => p.moved && !p.line.reason?.trim()).map(p => p.line.key);
  if (why.length) throw new Error(`Give a reason for every difference first: ${why.slice(0, 3).join(", ")}${why.length > 3 ? "…" : ""}`);
  const co = count.companyId === "main" ? undefined : count.companyId;
  let n = 0;
  for (const p of plan) {
    const note = `Stock count ${count.no}: ${p.diff > 0 ? "found" : "short"} ${Math.abs(p.diff)} — ${p.line.reason?.trim() ?? ""}`.trim();
    const lot = count.material === "diamond" ? (() => { const s = lotParts(p.line.key); return s.shape ? s : undefined; })() : undefined;
    if (p.diff > 0.0005) {
      await increaseStock({ material: count.material as MaterialKey, companyId: co, purityOrQuality: p.line.key, quantity: p.diff, refType: "manual", refId: count.id, createdBy: by.id, note, ...(lot ? { lot } : {}) });
    } else if (p.diff < -0.0005) {
      await decreaseStockSelfHealing({ material: count.material as MaterialKey, companyId: co, purityOrQuality: p.line.key, quantity: -p.diff, type: "issuance_out", refType: "manual", refId: count.id, createdBy: by.id, note, ...(lot ? { lot } : {}) }, loadDb().stockMovements);
    }
    if (p.pcsTo != null) await recountBag({ companyId: co, key: p.line.key, pieces: p.pcsTo, was: p.line.bookPcs ?? null, createdBy: by.id, note: `Stock count ${count.no} — ${p.line.reason?.trim() ?? ""}` });
    if (p.moved) n++;
    // Marked at once: a failure on a later line never posts this one again.
    const at = new Date().toISOString();
    updateDb(d => {
      const r = (d.adminRecords ?? []).find(x => x.id === count.id) as CountRecord | undefined;
      const l = r?.count.lines.find(x => x.key === p.line.key);
      if (l) l.posted = { diff: p.diff, ...(p.pcsTo != null ? { pcsTo: p.pcsTo } : {}), at };
    });
  }
  updateDb(d => {
    const r = (d.adminRecords ?? []).find(x => x.id === count.id) as CountRecord | undefined;
    if (r) { r.count.status = "posted"; r.count.postedAt = new Date().toISOString(); r.count.postedBy = by.name; }
  });
  return n;
}
