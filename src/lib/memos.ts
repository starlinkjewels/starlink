// Memo — goods on approval.
//
// MEMO OUT: our goods with a client, a dealer (a supplier) or a broker, who has
// not bought them. Loose diamonds from a bag, a certified stone, gold, another
// material (gems…), a Ready Stock piece — any number of lines on one slip
// ("MO-0001"). What it does, and only this:
//   • stock — each line leaves what is AVAILABLE, exactly as a sale out of stock
//     does (a stock movement marked "Out on memo"; a certified stone's status is
//     "memo"; a Ready Stock piece's count comes down) — so nothing on memo can be
//     sold or issued twice. It is still OURS: the Memo page and the Year book
//     count it as "out on memo" at what it cost.
//   • returned — the goods come back the same way they went: into the same bag,
//     the stone in stock again, the piece back on the shelf. A pooled line comes
//     back unpriced, so the bag's average cost is untouched.
//   • sold to whoever holds it — the goods come back and are sold in the same
//     step by the sale the app already has for that buyer, so their account,
//     Profit & Loss and every report read it like any other sale:
//       – a dealer: a sale to a supplier (lib/supplierSales.ts), off what we owe them;
//       – a client: a diamond sale on credit for stones (lib/diamondSalePay.ts);
//         a piece or other material goes back to stock to be billed on an order.
//   • cancelled — a slip with nothing returned or sold yet: everything back, the slip gone.
// No money moves on a memo itself.
import type { DB, DiamondSale, MaterialKey, Memo, MemoEvent, MemoLine, PurchaseCurrency, User } from "./db";
import { assertFresh, loadDb, updateDb, uid } from "./db";
import { doc, runTransaction } from "firebase/firestore";
import { db as fsdb } from "./firebase";
import { decreaseStockSelfHealing, increaseStock } from "./stock";
import { deriveStockBalances } from "./manufacturing";
import { lotParts, lotShape } from "./diamondLots";
import { logItem, whoOf } from "./readyStockHistory";
import { lineCostInr, pooled, recordSupplierSale } from "./supplierSales";
import { reserveSequence, highestSuffix } from "./counters";
import { closedWhy } from "./yearLock";

const r2 = (n: number) => Math.round(n * 100) / 100;
const r3 = (n: number) => Math.round(n * 1000) / 1000;
type Who = Pick<User, "id" | "name" | "role">;
export type MemoParty = Memo["party"];

/* ── Reading a memo ─────────────────────────────────────────────────────── */

/** Who holds the goods, by name. */
export function memoPartyName(db: Pick<DB, "clients" | "suppliers" | "brokers">, p: MemoParty): string {
  if (p.kind === "client") return db.clients.find(c => c.id === p.id)?.companyName ?? "A client";
  if (p.kind === "supplier") return db.suppliers.find(s => s.id === p.id)?.name ?? "A dealer";
  return (db.brokers ?? []).find(b => b.id === p.id)?.name ?? "A broker";
}
export const PARTY_WORD: Record<MemoParty["kind"], string> = { client: "Client", supplier: "Dealer", broker: "Broker" };

/** How much of a line came back or was sold so far. */
export function lineDone(memo: Pick<Memo, "events">, lineId: string): { returned: number; sold: number; pieces: number } {
  let returned = 0, sold = 0, pieces = 0;
  for (const e of memo.events ?? []) for (const l of e.lines) {
    if (l.lineId !== lineId) continue;
    // Memo in: "kept" (bought) stands where "sold" does for a memo out — gone from the slip for good.
    if (e.kind === "sold" || e.kind === "kept") sold += l.qty; else returned += l.qty;
    pieces += l.pieces ?? 0;
  }
  return { returned: r3(returned), sold: r3(sold), pieces };
}
/** What of a line is still out. */
export function lineOpen(memo: Pick<Memo, "events">, line: MemoLine): number {
  const d = lineDone(memo, line.id);
  return Math.max(0, r3(line.qty - d.returned - d.sold));
}
export function linePiecesOpen(memo: Pick<Memo, "events">, line: MemoLine): number | undefined {
  return line.pieces == null ? undefined : Math.max(0, line.pieces - lineDone(memo, line.id).pieces);
}
export type MemoState = "open" | "part" | "closed";
export function memoState(memo: Memo): MemoState {
  const open = memo.lines.filter(l => lineOpen(memo, l) > 1e-6).length;
  if (!open) return "closed";
  return (memo.events ?? []).length ? "part" : "open";
}
/** Days the goods have been out; and, with a due day passed, how many days over. */
export function memoAge(memo: Memo, now = Date.now()): { days: number; overdue: number } {
  const day = 86_400_000;
  const days = Math.max(0, Math.floor((now - +new Date(memo.at)) / day));
  const overdue = memo.dueAt && memoState(memo) !== "closed" ? Math.max(0, Math.floor((now - +new Date(memo.dueAt)) / day)) : 0;
  return { days, overdue };
}
/** The value still out, in the memo's currency (at the agreed prices). */
export function memoOpenValue(memo: Memo): number {
  return r2(memo.lines.reduce((t, l) => t + (l.qty > 0 ? l.amount * (lineOpen(memo, l) / l.qty) : 0), 0));
}
export function memoValue(memo: Memo): number {
  return r2(memo.lines.reduce((t, l) => t + l.amount, 0));
}
/* ── Due day: changed, alerted, reminded ─────────────────────────────────── */

/** Why a memo's due day can't be changed to `day` (YYYY-MM-DD, "" = no due day); null when it can. */
export function memoDueBlocker(memo: Memo, day: string): string | null {
  if (memoState(memo) === "closed") return "This memo is closed — everything came back or was settled";
  if (day && day < memo.at.slice(0, 10)) return memo.dir === "in" ? "The due day is before the day they came" : "The due day is before the day it went out";
  return null;
}

/**
 * Give a memo a new due day (the party asked for more time, or it was set wrong) — or none.
 * Kept in the memo's own history (dueChanges); the overdue alert comes again for the new day.
 */
export function setMemoDue(memoId: string, day: string, who: Who): void {
  assertFresh();
  const m0 = (loadDb().memos ?? []).find(m => m.id === memoId);
  if (!m0) throw new Error("That memo is no longer on record");
  const why = memoDueBlocker(m0, day);
  if (why) throw new Error(why);
  updateDb(d => {
    const m = (d.memos ?? []).find(x => x.id === memoId);
    if (!m) return;
    // The due day is a day: written as noon of it (stampFor), as the memo forms write it.
    const to = day ? new Date(`${day}T12:00:00`).toISOString() : undefined;
    if ((m.dueAt ?? "").slice(0, 10) === (to ?? "").slice(0, 10)) return;
    m.dueChanges = [...(m.dueChanges ?? []), { ...(m.dueAt ? { from: m.dueAt } : {}), ...(to ? { to } : {}), at: new Date().toISOString(), byName: who.name }];
    if (to) m.dueAt = to; else delete m.dueAt;
    delete m.overdueAlertedFor;
  });
}

/**
 * Alert the team about memos past their due day — once per due day each (overdueAlertedFor):
 * whoever made it and the admins. Run once a day by the first admin session (App). Call inside
 * updateDb; returns how many were alerted.
 */
export function alertOverdueMemos(d: DB, notify: (ids: (string | undefined)[], title: string, body: string) => void, now = Date.now()): number {
  let n = 0;
  for (const m of d.memos ?? []) {
    if (!m.dueAt || m.overdueAlertedFor === m.dueAt || memoState(m) === "closed") continue;
    const late = memoAge(m, now).overdue;
    if (late < 1) continue;
    const who = memoPartyName(d, m.party);
    notify([m.createdBy], `Memo ${m.no} is overdue`,
      `${m.dir === "in" ? `${who}'s goods with us` : `With ${who}`} — due back ${new Date(m.dueAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}, ${late} day${late === 1 ? "" : "s"} over. ${m.dir === "out" ? "Send them a reminder from Memo, or change the due day." : "Return or keep them, or change the due day."}`);
    m.overdueAlertedFor = m.dueAt;
    n++;
  }
  return n;
}

/** The party's phone, for a reminder on WhatsApp. */
export function memoPartyPhone(db: Pick<DB, "clients" | "suppliers" | "brokers">, p: MemoParty): string | undefined {
  const raw = p.kind === "client" ? db.clients.find(c => c.id === p.id)?.phone
    : p.kind === "supplier" ? db.suppliers.find(s => s.id === p.id)?.phone
      : (db.brokers ?? []).find(b => b.id === p.id)?.phone;
  return raw?.trim() || undefined;
}

/** The reminder sent to whoever holds our goods on a memo out. */
export function memoReminderText(memo: Memo, company: string): string {
  const open = memo.lines.filter(l => lineOpen(memo, l) > 1e-6);
  const fmt = (iso: string) => new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
  const late = memoAge(memo).overdue;
  return [
    `Reminder from ${company}: memo ${memo.no} of ${fmt(memo.at)}${memo.dueAt ? `, due back ${fmt(memo.dueAt)}${late > 0 ? ` (${late} day${late === 1 ? "" : "s"} ago)` : ""}` : ""}.`,
    `Still with you: ${open.map(l => l.label).join("; ")}.`,
    "Please return them, or tell us what you keep. Thank you.",
  ].join("\n");
}

/** Memos out that still hold goods — one party's when given. */
export function openMemos(db: Pick<DB, "memos">, party?: MemoParty): Memo[] {
  return (db.memos ?? []).filter(m => m.dir === "out" && memoState(m) !== "closed" && (!party || (m.party.kind === party.kind && m.party.id === party.id)));
}
/** The open memo a certified stone or a Ready Stock piece is out on. */
export function memoHolding(db: Pick<DB, "memos">, what: { packetId?: string; readyStockItemId?: string }): Memo | undefined {
  return (db.memos ?? []).find(m => m.dir === "out" && m.lines.some(l =>
    ((what.packetId && l.packetId === what.packetId) || (what.readyStockItemId && l.readyStockItemId === what.readyStockItemId)) && lineOpen(m, l) > 1e-6));
}

/**
 * Our goods out on memo on a day, at what they cost — still ours, though not in
 * the stock figures (which count what is available). For the Year book and the
 * Memo page. A piece's cost is admin-only and never kept on the slip, so pieces
 * are counted, not valued, here.
 */
export function memoOutAsAt(db: Pick<DB, "memos">, day?: string) {
  const by = (iso: string) => !day || iso.slice(0, 10) <= day;
  let lines = 0, costInr = 0, unpriced = 0, pieces = 0;
  for (const m of db.memos ?? []) {
    if (m.dir !== "out" || !by(m.at)) continue;
    for (const l of m.lines) {
      let out = l.qty;
      for (const e of m.events ?? []) if (by(e.at)) for (const x of e.lines) if (x.lineId === l.id) out -= x.qty;
      if (out <= 1e-6) continue;
      lines++;
      if (l.kind === "piece") { pieces += out; continue; }
      if (l.costInr == null) unpriced++; else costInr += l.costInr * (out / l.qty);
    }
  }
  return { lines, costInr: Math.round(costInr), unpriced, pieces };
}

/* ── Numbers ────────────────────────────────────────────────────────────── */

export async function reserveMemoNumber(memos: { no: string; dir: string }[], dir: "out" | "in"): Promise<string> {
  const prefix = dir === "out" ? "MO" : "MI";
  const floor = highestSuffix(memos.filter(m => m.dir === dir).map(m => m.no), 0) + 1;
  const seq = await reserveSequence(dir === "out" ? "memoOutNo" : "memoInNo", floor);
  return `${prefix}-${String(seq).padStart(4, "0")}`;
}

/* ── Memo out ───────────────────────────────────────────────────────────── */

export interface MemoOutInput {
  companyId?: string;
  party: MemoParty;
  at: string;
  dueAt?: string;
  currency: PurchaseCurrency;
  /** Lines without their id and cost — worked out here. */
  lines: Omit<MemoLine, "id" | "costInr">[];
  notes?: string;
}

/** Why a memo can't go out — or null. */
export function memoProblem(db: DB, s: MemoOutInput): string | null {
  if (!s.party.id) return "Choose who takes the goods";
  if (!s.lines.length) return "Add the goods";
  if (s.dueAt && s.dueAt.slice(0, 10) < s.at.slice(0, 10)) return "The due day is before the day it goes out";
  const closed = closedWhy(s.at, db.settings);
  if (closed) return closed;
  for (const l of s.lines) {
    if (!(l.qty > 0)) return `Enter how much — ${l.label || "a line"}`;
    if (l.kind === "certified") {
      const p = (db.diamondPackets ?? []).find(x => x.id === l.packetId);
      if (!p || p.status !== "in_stock") return "That certified diamond is not in stock any more";
    }
  }
  const pieceQty = new Map<string, number>();
  for (const l of s.lines) if (l.kind === "piece") pieceQty.set(l.readyStockItemId ?? "", (pieceQty.get(l.readyStockItemId ?? "") ?? 0) + l.qty);
  for (const [itemId, qty] of pieceQty) {
    const it = (db.readyStock ?? []).find(x => x.id === itemId);
    if (!it || it.quantity < qty) return `Only ${it?.quantity ?? 0} of ${it?.name || "that piece"} in stock`;
  }
  const want = new Map<string, { qty: number; l: MemoOutInput["lines"][number] }>();
  for (const l of s.lines.filter(pooled)) {
    const k = `${l.material}|${l.bucket ?? ""}`;
    want.set(k, { qty: (want.get(k)?.qty ?? 0) + l.qty, l });
  }
  for (const { qty, l } of want.values()) {
    const have = deriveStockBalances(db.stockMovements ?? [], l.material, s.companyId || "main")[l.bucket ?? ""] ?? 0;
    if (qty > have + 1e-6) return `Only ${r3(have)}${l.unit === "pcs" ? " pcs" : l.unit} of ${l.kind === "gold" ? `${l.bucket} gold` : l.bucket} in stock`;
  }
  const packets = s.lines.filter(l => l.kind === "certified").map(l => l.packetId);
  if (new Set(packets).size !== packets.length) return "The same certified diamond is on two lines";
  return null;
}

const lotArgs = (l: Pick<MemoLine, "kind" | "bucket">, pieces?: number) => (l.kind === "diamond" ? { lot: lotParts(l.bucket ?? ""), pieces } : {});

/**
 * Send goods out on memo. The pooled stock comes out first, line by line, each
 * in its own checked transaction; if a later line can't, the ones already taken
 * are put back and nothing is saved. Then the slip, the stones and the pieces in one save.
 */
export async function recordMemoOut(db: DB, s: MemoOutInput, user: Who): Promise<Memo> {
  assertFresh();
  const problem = memoProblem(db, s);
  if (problem) throw new Error(problem);
  const memoId = uid("memo_");
  const no = await reserveMemoNumber(db.memos ?? [], "out");
  const companyId = s.companyId && s.companyId !== "main" ? s.companyId : undefined;
  const lines: MemoLine[] = s.lines.map(l => {
    const cost = l.kind === "piece" ? undefined : lineCostInr(db, { ...l, amountInr: 0 }, s.companyId || "main", s.at);
    return { ...l, id: uid("ml_"), ...(cost != null ? { costInr: cost } : {}) };
  });
  const note = `Out on memo ${no}`;
  const taken: MemoLine[] = [];
  try {
    for (const l of lines.filter(pooled)) {
      await decreaseStockSelfHealing({
        material: l.material as MaterialKey, companyId, purityOrQuality: l.bucket ?? "", quantity: l.qty,
        type: "issuance_out", refType: "memo", refId: memoId, createdBy: user.id, note, ...lotArgs(l, l.pieces),
      }, db.stockMovements);
      taken.push(l);
    }
  } catch (e) {
    const notBack: string[] = [];
    for (const l of taken) {
      await increaseStock({
        material: l.material as MaterialKey, companyId, purityOrQuality: l.bucket ?? "", quantity: l.qty,
        refType: "memo", refId: memoId, createdBy: user.id, note: "Memo not recorded — put back", ...lotArgs(l, l.pieces),
      }).catch(() => { notBack.push(l.label); });
    }
    const why = e instanceof Error ? e.message : String(e);
    throw new Error(notBack.length ? `${why} — and ${notBack.join(", ")} could not be put back: check Stock` : why);
  }
  const memo: Memo = {
    id: memoId, no, dir: "out", ...(companyId ? { companyId } : {}), party: s.party, at: s.at,
    ...(s.dueAt ? { dueAt: s.dueAt } : {}), currency: s.currency, lines, events: [],
    ...(s.notes?.trim() ? { notes: s.notes.trim() } : {}), createdBy: user.id, createdAt: new Date().toISOString(),
  };
  updateDb(d => {
    if (!d.memos) d.memos = [];
    d.memos.unshift(JSON.parse(JSON.stringify(memo)));
    for (const l of lines) {
      if (l.kind === "certified") {
        const p = (d.diamondPackets ?? []).find(x => x.id === l.packetId);
        if (p) p.status = "memo";
      }
      if (l.kind === "piece") {
        const item = (d.readyStock ?? []).find(x => x.id === l.readyStockItemId);
        if (item) {
          const had = item.quantity;
          item.quantity = Math.max(0, item.quantity - l.qty);
          // Clients can read a piece's history: the slip's number, never who holds it.
          logItem(item, { ...whoOf(user), at: s.at, kind: "qty", text: `Out on memo ${no} · ${had} → ${item.quantity}` });
        }
      }
    }
  });
  return memo;
}

/* ── Goods back, or sold ────────────────────────────────────────────────── */

export interface MemoPick { lineId: string; qty: number; pieces?: number }

/** Why these can't come back (or be sold) — or null. */
export function picksProblem(memo: Memo, picks: MemoPick[]): string | null {
  if (!picks.length) return "Tick what came back";
  for (const p of picks) {
    const l = memo.lines.find(x => x.id === p.lineId);
    if (!l) return "That line is not on this memo";
    const open = lineOpen(memo, l);
    if (!(p.qty > 0)) return `Enter how much — ${l.label}`;
    if (p.qty > open + 1e-6) return `Only ${open} ${l.unit} of ${l.label} is still out`;
    if (l.kind === "piece" && !Number.isInteger(p.qty)) return `Whole pieces only — ${l.label}`;
    if (l.kind === "certified" && Math.abs(p.qty - l.qty) > 1e-6) return `A certified stone comes back whole — ${l.label}`;
  }
  return null;
}

/** Memos being worked on, on this device — a second click does nothing. */
const busy = new Set<string>();

/** Claimed on the record, in a transaction: two screens taking the same goods back at
 *  the same moment — only one goes on. A claim that stopped half-way lapses in 3 minutes. */
async function claim(memo: Memo): Promise<void> {
  await runTransaction(fsdb, async tx => {
    const ref = doc(fsdb, "memos", memo.id);
    const snap = await tx.get(ref);
    if (!snap.exists()) throw new Error("That memo is not there any more");
    const d = snap.data() as { deletingAt?: string; events?: unknown[] };
    if (d.deletingAt && Date.now() - +new Date(d.deletingAt) < 3 * 6e4) throw new Error("This memo is being changed — on this or another screen. Try again in a moment.");
    if ((d.events ?? []).length !== (memo.events ?? []).length) throw new Error("This memo changed on another screen — close this and open it again.");
    tx.update(ref, { deletingAt: new Date().toISOString() });
  });
}

/**
 * Goods come back from a memo: pooled lines into their bag (unpriced — the bag's
 * average cost stays as it was), stones in stock again, pieces on the shelf.
 * Returns the event's id. `forSale`: brought back to be sold in the same step.
 */
export async function returnMemoGoods(memoId: string, picks: MemoPick[], user: Who, opts: { at?: string; note?: string; forSale?: boolean } = {}): Promise<string> {
  assertFresh();
  if (busy.has(memoId)) throw new Error("Already being saved");
  const live = loadDb();
  const memo = (live.memos ?? []).find(m => m.id === memoId);
  if (!memo) throw new Error("That memo is not there any more");
  // A memo IN never moves our stock (noteMemoIn) — this is for our own goods coming back.
  if (memo.dir !== "out") throw new Error("That is a memo in — its goods were never in our stock");
  const problem = picksProblem(memo, picks);
  if (problem) throw new Error(problem);
  const at = opts.at ?? new Date().toISOString();
  const closed = closedWhy(at, live.settings);
  if (closed) throw new Error(closed);
  for (const p of picks) {
    const l = memo.lines.find(x => x.id === p.lineId)!;
    if (l.kind === "certified") {
      const pk = (live.diamondPackets ?? []).find(x => x.id === l.packetId);
      if (pk && pk.status !== "memo") throw new Error(`${l.label} is not marked as out on memo any more`);
    }
  }
  busy.add(memoId);
  const eventId = uid("me_");
  try {
    await claim(memo);
    for (const p of picks) {
      const l = memo.lines.find(x => x.id === p.lineId)!;
      if (!pooled(l)) continue;
      await increaseStock({
        material: l.material as MaterialKey, companyId: memo.companyId, purityOrQuality: l.bucket ?? "", quantity: p.qty,
        refType: "memo", refId: memo.id, createdBy: user.id, note: `Back from memo ${memo.no}`, ...lotArgs(l, p.pieces),
      });
    }
    updateDb(d => {
      const m = (d.memos ?? []).find(x => x.id === memoId);
      if (!m) return;
      for (const p of picks) {
        const l = m.lines.find(x => x.id === p.lineId);
        if (!l) continue;
        if (l.kind === "certified") {
          const pk = (d.diamondPackets ?? []).find(x => x.id === l.packetId);
          if (pk && pk.status === "memo") pk.status = "in_stock";
        }
        if (l.kind === "piece") {
          const item = (d.readyStock ?? []).find(x => x.id === l.readyStockItemId);
          if (item) {
            const had = item.quantity;
            item.quantity = item.quantity + p.qty;
            logItem(item, { ...whoOf(user), at, kind: "qty", text: `Back from memo ${m.no} · ${had} → ${item.quantity}` });
          }
        }
      }
      const ev: MemoEvent = {
        id: eventId, at, kind: "return", lines: picks.map(p => ({ lineId: p.lineId, qty: p.qty, ...(p.pieces ? { pieces: p.pieces } : {}) })),
        ...(opts.forSale ? { forSale: true } : {}), ...(opts.note?.trim() ? { note: opts.note.trim() } : {}), createdBy: user.id,
      };
      if (!m.events) m.events = [];
      m.events.push(ev);
      delete m.deletingAt;
    });
    return eventId;
  } catch (e) {
    // The claim is let go, so the memo is not left locked for 3 minutes by a refusal.
    updateDb(d => { const m = (d.memos ?? []).find(x => x.id === memoId); if (m?.deletingAt) delete m.deletingAt; });
    throw e;
  } finally {
    busy.delete(memoId);
  }
}

export interface MemoSaleInput {
  picks: (MemoPick & { /** The price for what is sold, in the memo's currency. */ amount: number })[];
  /** A broker's memo: who bought. A client's or a dealer's own memo: themselves. */
  buyer: { kind: "client" | "supplier"; id: string };
  /** A memo in dollars sold to a client: ₹ for $1. */
  exchangeRate?: number;
  at: string;
  note?: string;
}
export interface MemoSaleResult {
  /** Lines sold by a sale the app made. */
  sold: MemoLine[];
  /** Lines back in stock, to be billed on an order (a piece or other material for a client). */
  toBill: MemoLine[];
}

/** Why it can't be sold like this — or null. */
export function memoSaleProblem(db: DB, memo: Memo, s: MemoSaleInput): string | null {
  const p = picksProblem(memo, s.picks);
  if (p) return p === "Tick what came back" ? "Tick what was sold" : p;
  if (!s.buyer.id) return "Choose who bought it";
  if (s.buyer.kind === "supplier" && memo.currency !== "INR") return "A sale to a dealer is in rupees — this memo is in dollars";
  for (const x of s.picks) {
    const l = memo.lines.find(y => y.id === x.lineId)!;
    const auto = s.buyer.kind === "supplier" || l.kind === "diamond" || l.kind === "certified";
    if (auto && !(x.amount > 0)) return `Enter the price — ${l.label}`;
  }
  if (s.buyer.kind === "client" && memo.currency === "USD" && !(Number(s.exchangeRate) > 0)
    && s.picks.some(x => ["diamond", "certified"].includes(memo.lines.find(y => y.id === x.lineId)!.kind))) return "Enter the exchange rate — ₹ for $1";
  return closedWhy(s.at, db.settings);
}

/**
 * Goods on memo sold to whoever holds them (or, a broker's memo, to the buyer he
 * found). They come back and are sold in the same step, by the sale the app
 * already has: a dealer — a sale to a supplier; a client — a diamond sale on
 * credit for stones. A piece or other material for a client goes back to stock,
 * to be billed on an order (the result says which).
 */
export async function sellMemoGoods(memoId: string, s: MemoSaleInput, user: Who): Promise<MemoSaleResult> {
  assertFresh();
  const memo0 = (loadDb().memos ?? []).find(m => m.id === memoId);
  if (!memo0) throw new Error("That memo is not there any more");
  const problem = memoSaleProblem(loadDb(), memo0, s);
  if (problem) throw new Error(problem);
  const lineOf = (id: string) => memo0.lines.find(l => l.id === id)!;
  const autoPick = (x: MemoSaleInput["picks"][number]) => s.buyer.kind === "supplier" || ["diamond", "certified"].includes(lineOf(x.lineId).kind);
  const autos = s.picks.filter(autoPick), manual = s.picks.filter(x => !autoPick(x));
  const result: MemoSaleResult = { sold: [], toBill: manual.map(x => lineOf(x.lineId)) };

  // Back to stock first — as a return made to be sold.
  if (manual.length) await returnMemoGoods(memoId, manual, user, { at: s.at, note: "Back in stock, to be billed on an order" });
  if (!autos.length) return result;
  const eventId = await returnMemoGoods(memoId, autos, user, { at: s.at, note: s.note, forSale: true });

  const db = loadDb();
  const brokerId = memo0.party.kind === "broker" ? memo0.party.id : undefined;
  let sale: MemoEvent["sale"];
  try {
    if (s.buyer.kind === "supplier") {
      const made = await recordSupplierSale(db, {
        companyId: memo0.companyId, supplierId: s.buyer.id, at: s.at,
        notes: `Memo ${memo0.no}${s.note?.trim() ? ` — ${s.note.trim()}` : ""}`,
        ...(brokerId ? { brokerId, brokeragePaidBy: "us" as const } : {}),
        lines: autos.map(x => {
          const l = lineOf(x.lineId);
          const part = l.qty > 0 ? x.qty / l.qty : 1;
          const pcs = x.pieces ?? (l.pieces != null && part === 1 ? l.pieces : undefined);
          return {
            kind: l.kind, material: l.material, ...(l.bucket != null ? { bucket: l.bucket } : {}), ...(pcs ? { pieces: pcs } : {}),
            ...(l.packetId ? { packetId: l.packetId } : {}), ...(l.readyStockItemId ? { readyStockItemId: l.readyStockItemId } : {}),
            qty: x.qty, unit: l.unit, label: l.label, amountInr: r2(x.amount), ...(x.qty > 0 ? { rateInr: r2(x.amount / x.qty) } : {}),
          };
        }),
      }, user);
      sale = { type: "supplierSale", ids: [made.id] };
    } else {
      const ids: string[] = [];
      for (const x of autos) ids.push(await sellStoneToClient(memo0, lineOf(x.lineId), x, s, user));
      sale = { type: "diamondSale", ids };
    }
  } catch (e) {
    // The goods are back in stock (that is true and stays); the sale was not made.
    updateDb(d => {
      const ev = (d.memos ?? []).find(m => m.id === memoId)?.events.find(x => x.id === eventId);
      if (ev) { delete ev.forSale; ev.note = "Back in stock — the sale could not be recorded"; }
    });
    throw new Error(`${e instanceof Error ? e.message : String(e)} — the goods are back in stock; sell them from there.`);
  }
  updateDb(d => {
    const ev = (d.memos ?? []).find(m => m.id === memoId)?.events.find(x => x.id === eventId);
    if (ev) { ev.kind = "sold"; delete ev.forSale; ev.sale = sale; }
  });
  result.sold = autos.map(x => lineOf(x.lineId));
  return result;
}

/** A stone (loose from its bag, or certified) sold to a client on credit — the same
 *  record Buy & Assign → Sell a diamond makes with "Not received yet". Returns its id. */
async function sellStoneToClient(memo: Memo, l: MemoLine, x: MemoSaleInput["picks"][number], s: MemoSaleInput, user: Who): Promise<string> {
  const saleId = uid("ds_");
  const db = loadDb();
  const client = db.clients.find(c => c.id === s.buyer.id);
  if (!client) throw new Error("That client is gone");
  const certified = l.kind === "certified";
  const pcs = x.pieces && x.pieces > 0 ? Math.round(x.pieces) : undefined;
  const usd = memo.currency === "USD";
  const totalInr = Math.round(usd ? x.amount * Number(s.exchangeRate) : x.amount);
  if (!certified) {
    await decreaseStockSelfHealing({
      material: "diamond", companyId: memo.companyId, purityOrQuality: l.bucket ?? "", quantity: x.qty,
      type: "issuance_out", refType: "diamondSale", refId: saleId, createdBy: user.id,
      note: `Sold to ${client.companyName}`, lot: lotParts(l.bucket ?? ""), pieces: pcs,
    }, db.stockMovements);
  }
  const packet = certified ? (db.diamondPackets ?? []).find(p => p.id === l.packetId) : undefined;
  const rec: DiamondSale = {
    id: saleId, kind: certified ? "certified" : "loose", shape: certified ? (packet?.shape ?? "") : lotShape(l.bucket ?? ""),
    ...(certified ? { packetId: l.packetId } : { bucket: l.bucket, ...(pcs ? { pieces: pcs } : {}) }),
    ...(memo.companyId ? { companyId: memo.companyId } : {}),
    carat: x.qty, ratePerCarat: x.qty > 0 ? r2(x.amount / x.qty) : 0, currency: memo.currency,
    ...(usd ? { totalUsd: r2(x.amount), exchangeRate: Number(s.exchangeRate) } : {}),
    totalInr, clientId: client.id, unpaid: true,
    notes: `Memo ${memo.no}${s.note?.trim() ? ` — ${s.note.trim()}` : ""}`,
    soldBy: user.id, createdAt: s.at,
  };
  updateDb(d => {
    if (!d.diamondSales) d.diamondSales = [];
    d.diamondSales.unshift(JSON.parse(JSON.stringify(rec)));
    if (certified) {
      const p = (d.diamondPackets ?? []).find(y => y.id === l.packetId);
      if (p) p.status = "sold";
    }
  });
  return saleId;
}

/* ── Memo IN — a dealer's goods with us ─────────────────────────────────── */
//
// A dealer's (or a broker's) goods with us on approval ("MI-0001"). They are
// NOT ours: nothing goes into our stock, its value or the Year book. The slip
// is the whole record — shown on the Memo page and beside our stock as "on memo".
//   • kept — we buy them: the Buy form opens filled in from the slip, and the
//     purchase bill it saves (the same bill as any purchase — stock, bag, cost,
//     the supplier's account) is noted on the slip;
//   • returned — they go back: noted on the slip, nothing else changes.

export interface MemoInInput {
  companyId?: string;
  party: MemoParty;
  at: string;
  dueAt?: string;
  currency: PurchaseCurrency;
  lines: Omit<MemoLine, "id" | "costInr">[];
  notes?: string;
}

export function memoInProblem(db: DB, s: MemoInInput): string | null {
  if (s.party.kind === "client") return "Goods a client gives us are recorded on their order (client material) — a memo in is from a dealer or a broker";
  if (!s.party.id) return "Choose whose goods they are";
  if (!s.lines.length) return "Add the goods";
  if (s.dueAt && s.dueAt.slice(0, 10) < s.at.slice(0, 10)) return "The due day is before the day they came";
  for (const l of s.lines) {
    if (!(l.qty > 0)) return `Enter how much — ${l.label || "a line"}`;
    if (l.kind === "piece" && !Number.isInteger(l.qty)) return `Whole pieces only — ${l.label}`;
    if (l.kind === "certified" && !l.spec?.certNo?.trim()) return "Enter the certified stone's report number";
  }
  return closedWhy(s.at, db.settings);
}

/** Take a dealer's goods in on memo — the slip only; our stock is untouched. */
export async function recordMemoIn(db: DB, s: MemoInInput, user: Who): Promise<Memo> {
  assertFresh();
  const problem = memoInProblem(db, s);
  if (problem) throw new Error(problem);
  const no = await reserveMemoNumber(db.memos ?? [], "in");
  const companyId = s.companyId && s.companyId !== "main" ? s.companyId : undefined;
  const memo: Memo = {
    id: uid("memo_"), no, dir: "in", ...(companyId ? { companyId } : {}), party: s.party, at: s.at,
    ...(s.dueAt ? { dueAt: s.dueAt } : {}), currency: s.currency,
    lines: s.lines.map(l => ({ ...l, id: uid("ml_") })), events: [],
    ...(s.notes?.trim() ? { notes: s.notes.trim() } : {}), createdBy: user.id, createdAt: new Date().toISOString(),
  };
  updateDb(d => { if (!d.memos) d.memos = []; d.memos.unshift(JSON.parse(JSON.stringify(memo))); });
  return memo;
}

/** Goods of a memo in go back to their owner, or are kept (bought — `purchaseIds` are the bills). */
export function noteMemoIn(memoId: string, picks: MemoPick[], user: Who, o: { kind: "return" | "kept"; at?: string; note?: string; purchaseIds?: string[] }): void {
  assertFresh();
  const live = loadDb();
  const memo = (live.memos ?? []).find(m => m.id === memoId);
  if (!memo || memo.dir !== "in") throw new Error("That memo is not there any more");
  const problem = picksProblem(memo, picks.map(p => ({ ...p, qty: Math.min(p.qty, lineOpen(memo, memo.lines.find(l => l.id === p.lineId) ?? memo.lines[0])) })));
  if (problem) throw new Error(problem === "Tick what came back" ? "Tick the goods" : problem);
  const at = o.at ?? new Date().toISOString();
  const closed = closedWhy(at, live.settings);
  if (closed) throw new Error(closed);
  updateDb(d => {
    const m = (d.memos ?? []).find(x => x.id === memoId);
    if (!m) return;
    const lines = picks.map(p => {
      const l = m.lines.find(x => x.id === p.lineId);
      // Never more than is still here (the bill may have been saved for a little more).
      const qty = l ? Math.min(p.qty, lineOpen(m, l)) : 0;
      return { lineId: p.lineId, qty, ...(p.pieces ? { pieces: p.pieces } : {}) };
    }).filter(x => x.qty > 1e-6);
    if (!lines.length) return;
    if (!m.events) m.events = [];
    m.events.push({
      id: uid("me_"), at, kind: o.kind, lines,
      ...(o.purchaseIds?.length ? { purchase: { ids: o.purchaseIds } } : {}),
      ...(o.note?.trim() ? { note: o.note.trim() } : {}), createdBy: user.id,
    });
  });
}

/** A dealer's goods still with us on memo — line by line, for the stock screens. */
export function memoInOpenLines(db: Pick<DB, "memos">, companyId?: string): { memo: Memo; line: MemoLine; open: number }[] {
  const out: { memo: Memo; line: MemoLine; open: number }[] = [];
  for (const m of db.memos ?? []) {
    if (m.dir !== "in" || (companyId && (m.companyId || "main") !== companyId)) continue;
    for (const l of m.lines) { const open = lineOpen(m, l); if (open > 1e-6) out.push({ memo: m, line: l, open }); }
  }
  return out;
}

/* ── Cancel ─────────────────────────────────────────────────────────────── */

/** Why a memo can't be cancelled — or null. Only one with nothing back or sold yet. */
export function memoCancelBlocker(db: DB, memo: Memo): string | null {
  if ((memo.events ?? []).length) return memo.dir === "in" ? "Goods on it were returned or kept — return the rest instead" : "Goods have come back or been sold on it — take the rest back instead";
  const closed = closedWhy(memo.at, db.settings);
  if (closed) return closed;
  if (memo.dir === "in") return null;
  for (const l of memo.lines) {
    if (l.kind === "certified") {
      const p = (db.diamondPackets ?? []).find(x => x.id === l.packetId);
      if (p && p.status !== "memo") return `${l.label} is not marked as out on memo any more`;
    }
  }
  return null;
}

/** Cancel a memo made by mistake: every line back in stock, the slip removed. */
export async function cancelMemo(memoId: string, user: Who): Promise<void> {
  assertFresh();
  if (busy.has(memoId)) throw new Error("Already being cancelled");
  const live = loadDb();
  const memo = (live.memos ?? []).find(m => m.id === memoId);
  if (!memo) throw new Error("That memo is already gone");
  const block = memoCancelBlocker(live, memo);
  if (block) throw new Error(block);
  // A memo in never touched our stock: only the slip goes.
  if (memo.dir === "in") { updateDb(d => { d.memos = (d.memos ?? []).filter(x => x.id !== memoId); }); return; }
  busy.add(memoId);
  try {
    await claim(memo);
    // Each pooled line once: one already put back (an earlier try that stopped half-way) is not put back again.
    const key = (m: string, b: string) => `${m}|${b}`;
    const back = new Map<string, number>();
    for (const m of live.stockMovements ?? []) if (m.refType === "memo" && m.refId === memo.id && m.type === "purchase_in") back.set(key(m.material, m.purityOrQuality), (back.get(key(m.material, m.purityOrQuality)) ?? 0) + 1);
    const seen = new Map<string, number>();
    for (const l of memo.lines.filter(pooled)) {
      const k = key(l.material, l.bucket ?? "");
      const nth = (seen.get(k) ?? 0) + 1;
      seen.set(k, nth);
      if ((back.get(k) ?? 0) >= nth) continue;
      await increaseStock({
        material: l.material as MaterialKey, companyId: memo.companyId, purityOrQuality: l.bucket ?? "", quantity: l.qty,
        refType: "memo", refId: memo.id, createdBy: user.id, note: `Memo ${memo.no} cancelled — back in stock`, ...lotArgs(l, l.pieces),
      });
    }
    updateDb(d => {
      if (!(d.memos ?? []).some(x => x.id === memoId)) return;
      for (const l of memo.lines) {
        if (l.kind === "certified") {
          const p = (d.diamondPackets ?? []).find(x => x.id === l.packetId);
          if (p && p.status === "memo") p.status = "in_stock";
        }
        if (l.kind === "piece") {
          const item = (d.readyStock ?? []).find(x => x.id === l.readyStockItemId);
          if (item) {
            const had = item.quantity;
            item.quantity = item.quantity + l.qty;
            logItem(item, { ...whoOf(user), kind: "qty", text: `Memo ${memo.no} cancelled · ${had} → ${item.quantity}` });
          }
        }
      }
      d.memos = (d.memos ?? []).filter(x => x.id !== memoId);
    });
  } finally {
    busy.delete(memoId);
  }
}
