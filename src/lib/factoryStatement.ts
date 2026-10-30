// A factory's account as a STATEMENT — the way the factory's own books, and
// the client's, keep it: one line per voucher, in date order, with the gold,
// the diamonds and the money on it, and the balance carried down the page.
//
//   Gold given          — fine (24K) grams we sent; the voucher is the order (or "Bulk").
//   Diamonds given      — carats we sent.
//   Finished goods      — one line per FACTORY BILL: the fine gold and the carats the
//                         pieces on it took, and the labour billed. Dated when the
//                         pieces came back, under the factory's bill number.
//   Diamonds returned   — stones the factory sent back (their "party return").
//   Repair (rework)     — its own line, under the factory's repair bill number.
//   Payment / advance   — labour paid.
//
// Built from the same records, by the same rules, as the Factory Account card
// (lib/pure/accounts.ts: factoryFineGoldBalance, diamondFlow, factoryAccount),
// so the last line's balances are the card's figures — and `check` says so.
import type { FactoryPayment, MaterialIssuance, Order } from "./db";
import { diamondFlow, factoryAccount, factoryFineGoldBalance } from "./pure/accounts";
import { openingCreditAmt, openingDebitAmt, pureFromPurity, toPureGold } from "./pure/basics";
import type { OpeningBalanceInfo } from "./db";
import { groupPaymentsAsMade } from "./manufacturing";
import { isReworkIssue } from "./rework";

export type StatementKind = "opening" | "gold" | "diamond" | "bill" | "returned" | "repair" | "labour" | "payment" | "advance";

export interface StatementLine {
  id: string;
  date: string;
  kind: StatementKind;
  particular: string;
  /** The voucher: the factory's bill / repair bill number, else our order number. */
  voucher: string;
  /** The orders the line is for (a bill can carry several pieces). */
  orderIds: string[];
  /** Fine (24K) grams: given to the factory / taken by it (in pieces, returned). */
  goldIn: number;
  goldOut: number;
  /** Carats: given / accounted for (set in pieces, returned). */
  diaIn: number;
  diaOut: number;
  /** Rupees: labour the factory billed / we paid. */
  billed: number;
  paid: number;
  /** Carried down: fine gold at the factory, carats at the factory, rupees we owe them. */
  goldBal: number;
  diaBal: number;
  owed: number;
}

/** The fine gold a gold issue's finished piece took. */
const finishedFine = (mi: MaterialIssuance) => mi.finishedNetWeight == null ? 0
  : mi.finishedPurity != null ? pureFromPurity(mi.finishedNetWeight, mi.finishedPurity)
  : mi.finishedKarat ? toPureGold(mi.finishedNetWeight, mi.finishedKarat) : 0;


const r3 = (n: number) => Math.round(n * 1000) / 1000;
const latest = (dates: (string | undefined)[]) => dates.filter((d): d is string => !!d).sort().pop();

export interface StatementInput {
  issuances: MaterialIssuance[];
  orders: Pick<Order, "id" | "orderNumber" | "factoryBillNo" | "timeline" | "actualDiamondWeight" | "jewelleryType">[];
  /** Advances and loans — money paid against no particular job. */
  advances: FactoryPayment[];
  /** The factory's opening balances (the first company's view only, as on the card). */
  opening?: OpeningBalanceInfo & { openingFineGold?: number; openingFineGoldDate?: string; openingDate?: string; createdAt?: string };
  factoryId: string;
}

export function buildFactoryStatement(inp: StatementInput): { lines: StatementLine[]; check: { ok: boolean; gold: number; dia: number; owed: number; cardGold: number; cardDia: number; cardOwed: number } } {
  const { issuances, orders, advances, opening, factoryId } = inp;
  const order = (id?: string) => (id ? orders.find(o => o.id === id) : undefined);
  const raw: Omit<StatementLine, "goldBal" | "diaBal" | "owed">[] = [];
  const blank = { goldIn: 0, goldOut: 0, diaIn: 0, diaOut: 0, billed: 0, paid: 0 };

  // ── Opening balances brought forward ──
  const oGold = opening?.openingFineGold || 0, oCr = openingCreditAmt(opening), oDr = openingDebitAmt(opening);
  if (oGold || oCr || oDr) {
    raw.push({ ...blank, id: "opening", kind: "opening", date: opening?.openingDate || opening?.openingFineGoldDate || opening?.createdAt || "",
      particular: "Opening balance", voucher: "", orderIds: [], goldIn: oGold, billed: oCr, paid: oDr });
  }

  // ── What we gave: gold and diamonds, as they went ──
  for (const mi of issuances) {
    if (isReworkIssue(mi)) continue; // on its repair's own line, below
    const o = order(mi.orderId);
    const voucher = o?.orderNumber || (mi.orderId ? "" : "Bulk");
    if (mi.material === "gold" && mi.source !== "factoryPool" && mi.quantityIssued > 0) {
      const what = `${mi.quantityIssued} g ${mi.purityOrQuality}`;
      raw.push({ ...blank, id: `${mi.id}-g`, kind: "gold", date: mi.issuedAt, voucher, orderIds: mi.orderId ? [mi.orderId] : [],
        particular: mi.source === "melt" ? `Melted piece back to the factory — ${what}`
          : mi.source === "client" ? `Client's gold — ${what}`
          : mi.source === "transfer" ? `Gold moved from another company's share — ${what}`
          : `Gold given${mi.orderId ? "" : " (bulk)"} — ${what}`,
        goldIn: toPureGold(mi.quantityIssued, mi.purityOrQuality) });
    }
    if (mi.material === "diamond") {
      const f = diamondFlow(mi);
      if (f.out > 0) raw.push({ ...blank, id: `${mi.id}-d`, kind: "diamond", date: mi.issuedAt, voucher, orderIds: mi.orderId ? [mi.orderId] : [],
        particular: `Diamonds given${mi.orderId ? "" : " (bulk)"} — ${mi.diamondKind === "certified" ? "certified" : mi.purityOrQuality}${mi.piecesIssued ? ` · ${mi.piecesIssued} pcs` : ""}`,
        diaIn: f.out });
    }
  }

  // ── What the factory billed: one line per bill (its number), else per order ──
  type Acc = { orderIds: Set<string>; date?: string; goldOut: number; diaUsed: number; diaRet: number; billed: number; voucher: string; facCt: number; ourCt: number; items: string[] };
  const bills = new Map<string, Acc>();
  const looseLabour: MaterialIssuance[] = [];
  for (const mi of issuances) {
    if (isReworkIssue(mi)) continue;
    const o = order(mi.orderId);
    const fine = mi.material === "gold" ? finishedFine(mi) : 0;
    let used = 0, ret = 0;
    if (mi.material === "diamond") {
      const f = diamondFlow(mi);
      const returned = mi.diamondKind === "certified" ? (mi.finishDisposition === "returned" ? mi.quantityIssued : 0) : (mi.finishReturnedCt || 0);
      // A pool draw's returned stones stay in the pool — only what was set counts (diamondFlow).
      ret = mi.source === "factoryPool" ? 0 : Math.min(returned, f.in);
      used = r3(f.in - ret);
    }
    const charge = mi.makingCharges?.amountInr || 0;
    if (!fine && !used && !ret && !charge) continue;
    // No order behind it: a bulk delivery closed off (what it says was used or came
    // back), or a melting charge — each on its own line, never left out.
    if (!o) {
      if (fine || used || ret) raw.push({ ...blank, id: `${mi.id}-closed`, kind: ret && !used && !fine ? "returned" : "bill", date: mi.finishedPieces?.map(p => p.recordedAt).sort().pop() ?? mi.issuedAt,
        voucher: "Bulk", orderIds: [], particular: `Bulk delivery closed — ${mi.purityOrQuality}${ret ? " (some returned)" : ""}`,
        goldOut: r3(fine), diaOut: r3(used + ret) });
      if (charge) looseLabour.push(mi);
      continue;
    }
    // When the pieces came back: Final Approval's date (an edit of the details later
    // does not move it), else when their finish was recorded, else the issue.
    const fa = o.timeline?.find(t => t.step === "Final Approval" && t.status === "done")?.date;
    const when = fa ?? latest((mi.finishedPieces ?? []).map(p => p.recordedAt)) ?? mi.issuedAt;
    // One line per bill — its number and its day, so a number a factory uses again
    // later never folds a different bill into this one.
    const key = o.factoryBillNo?.trim() ? `bill:${o.factoryBillNo.trim().toLowerCase()}|${(fa ?? when).slice(0, 10)}` : `order:${o.id}`;
    const acc = bills.get(key) ?? { orderIds: new Set(), goldOut: 0, diaUsed: 0, diaRet: 0, billed: 0, voucher: o.factoryBillNo?.trim() || o.orderNumber, facCt: 0, ourCt: 0, items: [] };
    if (!acc.orderIds.has(o.id)) {
      acc.orderIds.add(o.id);
      acc.items.push(`${o.orderNumber}${o.jewelleryType ? ` ${o.jewelleryType}` : ""}`);
    }
    acc.goldOut += fine; acc.diaUsed += used; acc.diaRet += ret; acc.billed += charge;
    acc.date = latest([acc.date, when]) ?? when;
    bills.set(key, acc);
  }
  for (const [key, a] of bills) {
    // The factory's own carats for the bill, when its scale read differently from ours.
    for (const id of a.orderIds) { const o = order(id); if (o?.actualDiamondWeight) a.facCt += o.actualDiamondWeight; }
    const facNote = a.facCt && Math.abs(a.facCt - (a.diaUsed + a.diaRet)) > 0.005 ? ` · factory's scale ${r3(a.facCt)} ct` : "";
    if (a.goldOut || a.diaUsed || a.billed) {
      raw.push({ ...blank, id: `${key}-bill`, kind: "bill", date: a.date ?? "", voucher: a.voucher, orderIds: [...a.orderIds],
        particular: `Finished goods — ${a.items.join(", ")}${facNote}`, goldOut: r3(a.goldOut), diaOut: r3(a.diaUsed), billed: a.billed });
    }
    if (a.diaRet > 0.0005) {
      raw.push({ ...blank, id: `${key}-ret`, kind: "returned", date: a.date ?? "", voucher: a.voucher, orderIds: [...a.orderIds],
        particular: "Diamonds returned", diaOut: r3(a.diaRet) });
    }
  }
  for (const mi of looseLabour) {
    raw.push({ ...blank, id: `${mi.id}-l`, kind: "labour", date: mi.issuedAt, voucher: mi.source === "melt" ? "Melt" : "",
      orderIds: [], particular: mi.source === "melt" ? "Melting / refining charge" : "Labour billed", billed: mi.makingCharges.amountInr });
  }

  // ── Repairs: each on its own line, under its repair bill number ──
  const repairs = new Map<string, { mi: MaterialIssuance[]; at: string; billNo?: string; orderId?: string }>();
  for (const mi of issuances) {
    if (!isReworkIssue(mi)) continue;
    const oid = mi.rework?.orderId ?? mi.orderId;
    const key = mi.rework?.key ?? `${oid}|${mi.issuedAt}`;
    const r = repairs.get(key) ?? { mi: [], at: mi.rework?.at ?? mi.issuedAt, billNo: mi.rework?.billNo, orderId: oid };
    r.mi.push(mi);
    if (!r.billNo && mi.rework?.billNo) r.billNo = mi.rework.billNo;
    if (!r.orderId && oid) r.orderId = oid;
    repairs.set(key, r);
  }
  for (const [key, r] of repairs) {
    const o = order(r.orderId);
    let goldIn = 0, goldOut = 0, diaIn = 0, diaOut = 0, billed = 0;
    const parts: string[] = [];
    for (const mi of r.mi) {
      billed += mi.makingCharges?.amountInr || 0;
      if (mi.material === "gold") {
        const given = mi.source !== "factoryPool" ? toPureGold(mi.quantityIssued, mi.purityOrQuality) : 0;
        const took = finishedFine(mi);
        goldIn += given; goldOut += took;
        if (mi.source === "rework") parts.push(`${mi.quantityIssued} g ${mi.purityOrQuality} taken out — kept at the factory`);
        else if (took && given) parts.push(`${mi.quantityIssued} g ${mi.purityOrQuality} added (ours)`);
        else if (took) parts.push(`${mi.finishedNetWeight} g ${mi.finishedKarat ?? mi.purityOrQuality} added (the factory's holding)`);
      }
      if (mi.material === "diamond") {
        const f = diamondFlow(mi);
        diaIn += f.out; diaOut += f.in;
        parts.push(`${mi.quantityIssued} ct ${mi.purityOrQuality} added`);
      }
    }
    raw.push({ ...blank, id: `${key}-repair`, kind: "repair", date: r.at, voucher: r.billNo || (o ? `${o.orderNumber} repair` : "Repair"),
      orderIds: r.orderId ? [r.orderId] : [], particular: `Repair — ${o?.orderNumber ?? ""}${parts.length ? `: ${parts.join(", ")}` : ""}`.replace(/ — :/, ":"),
      goldIn: r3(goldIn), goldOut: r3(goldOut), diaIn: r3(diaIn), diaOut: r3(diaOut), billed });
  }

  // ── Money paid: each payment as it was made (one line, however it was split) ──
  for (const g of groupPaymentsAsMade(issuances.flatMap(mi => (mi.makingCharges?.payments ?? []).map(pay => ({ pay, label: order(mi.orderId)?.orderNumber }))))) {
    raw.push({ ...blank, id: g.ids[0], kind: "payment", date: g.at, voucher: g.labels.join(", "), orderIds: [],
      particular: `Labour paid${g.note ? ` — ${g.note}` : ""}`, paid: g.amountInr });
  }
  for (const a of advances) {
    raw.push({ ...blank, id: a.id, kind: "advance", date: a.createdAt, voucher: "", orderIds: [], particular: `Advance / loan paid${a.note ? ` — ${a.note}` : ""}`, paid: a.amountInr });
  }

  // ── In date order, the balance carried down ──
  const ORDER: Record<StatementKind, number> = { opening: 0, gold: 1, diamond: 2, repair: 3, bill: 4, returned: 5, labour: 6, payment: 7, advance: 8 };
  raw.sort((a, b) => (a.kind === "opening" ? -1 : b.kind === "opening" ? 1 : a.date.localeCompare(b.date) || ORDER[a.kind] - ORDER[b.kind]));
  let goldBal = 0, diaBal = 0, owed = 0;
  const lines = raw.map(l => {
    goldBal = r3(goldBal + l.goldIn - l.goldOut);
    diaBal = r3(diaBal + l.diaIn - l.diaOut);
    owed = Math.round((owed + l.billed - l.paid) * 100) / 100;
    return { ...l, goldIn: r3(l.goldIn), goldOut: r3(l.goldOut), diaIn: r3(l.diaIn), diaOut: r3(l.diaOut), goldBal, diaBal, owed };
  });

  // ── Does the last line say what the Factory Account card says? ──
  const acct = factoryAccount(issuances, opening, advances);
  const cardGold = factoryFineGoldBalance(issuances, factoryId, oGold);
  const cardDia = acct.diamondOutstanding;
  const cardOwed = acct.chargesPending - acct.chargesOverpaid;
  const ok = Math.abs(cardGold - goldBal) < 0.0015 && Math.abs(cardDia - diaBal) < 0.0015 && Math.abs(cardOwed - owed) < 1;
  return { lines, check: { ok, gold: goldBal, dia: diaBal, owed, cardGold, cardDia, cardOwed } };
}
