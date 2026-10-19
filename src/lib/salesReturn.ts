/**
 * Sales returns — pieces a client sends back after the sale.
 *
 * The standard way, and the only way here: the sale and its invoice are never
 * edited. A credit note (CN-0001…) is raised against the invoice; its credit
 * comes off what the client owes on each order (orderTotal), so every bill,
 * statement and report follows on its own. Then:
 *
 *  • money already paid beyond the new total moves to the client's credit
 *    (usable on their next bills), exactly as a cancel does;
 *  • the pieces' share of a redeemed gift card goes back on that card;
 *  • cashback the pieces had earned is taken back off the card — and the part
 *    the client already spent stays on their bill, unless told otherwise;
 *  • the piece goes into Ready Stock when it reaches us — at once, or later
 *    with "Mark received" if it is still on its way;
 *  • its cost goes with it: the Ready Stock item costs what the order cost per
 *    piece, and the order's own profit counts only the pieces kept.
 *
 * Everything lives on the order (`returns`), the client, the gift card and the
 * Ready Stock item — no new collection, so no rules change.
 */
import { moveReadyStock, officeLabel, officeOf } from "@/lib/offices";
import { logItem } from "@/lib/readyStockHistory";
import { coField, companyOfOrder } from "./companies";
import {
  type DB, type Order, type OrderReturn, type GiftCard, type Invoice, type ReadyStockItem,
  orderGrossTotal, orderTotal, totalAdvance, balanceDue, keptQty, keptValue, capOrderAdvances,
  giftCardRemaining, findInvoiceForOrder, orderIsDispatched, uid, writeStockCost,
} from "./db";
import { pieceWeights } from "./weights";

const r2 = (n: number) => Math.round(n * 100) / 100;
const r3 = (n: number) => Math.round(n * 1000) / 1000;

// The quick-pick reasons are the business's own: Settings → Dropdown lists (lib/optionLists.ts).

/** Why pieces of this order cannot be returned; undefined when they can. */
export function returnBlocker(o: Order): string | undefined {
  if (o.forReadyStock) return "An in-house piece — it was never sold.";
  if (o.melted) return "This piece was melted.";
  if (o.status === "Rejected") return "This order is cancelled.";
  if (!orderIsDispatched(o)) return "Not dispatched yet — change or cancel the order instead.";
  if (keptQty(o) === 0) return "Every piece of this order has already come back.";
  return undefined;
}

export interface ReturnInput { orderId: string; qty: number }
export interface ReturnOptions {
  reason?: string;
  /** Give back shipping and the certificate fee on an order whose every remaining piece comes back. */
  refundShipping?: boolean;
  /** A return / restocking charge the client still pays, spread over the pieces by value. */
  feeUsd?: number;
  /** Keep cashback the client already spent on their bill (default yes). */
  chargeSpentCashback?: boolean;
  /** The pieces are already here (else they are on their way). */
  received: boolean;
  location: string;
  /** Ready Stock selling price per piece, by order; default the price it was sold at. */
  priceUsd?: Record<string, number>;
}

export interface ReturnLine {
  order: Order;
  qty: number;
  kept: number;           // pieces the client had before this return
  unitUsd: number;        // what one piece was sold for
  valueUsd: number;
  giftBackUsd: number;
  shippingBackUsd: number;
  certificateBackUsd: number;
  feeUsd: number;
  cashbackCard?: GiftCard;
  cashbackBackUsd: number;    // off the unused card
  cashbackSpentUsd: number;   // already spent by the client
  cashbackChargedUsd: number; // …of which left on their bill
  creditUsd: number;
  owedBefore: number;     // balance due before
  owedAfter: number;      // balance due after
  toCreditUsd: number;    // paid money freed into the client's credit
  priceUsd: number;       // Ready Stock price per piece
  invoice?: Invoice;
}

export interface ReturnPlan {
  lines: ReturnLine[];
  blocked?: string;
  clientId?: string;
  totals: { qty: number; valueUsd: number; creditUsd: number; toCreditUsd: number; giftBackUsd: number; cashbackBackUsd: number; cashbackChargedUsd: number; feeUsd: number; shippingBackUsd: number };
}

/** Exactly what a return would do — nothing is changed. */
export function planReturn(db: DB, input: ReturnInput[], opt: ReturnOptions): ReturnPlan {
  const zero = { qty: 0, valueUsd: 0, creditUsd: 0, toCreditUsd: 0, giftBackUsd: 0, cashbackBackUsd: 0, cashbackChargedUsd: 0, feeUsd: 0, shippingBackUsd: 0 };
  const picked = input.filter(i => i.qty > 0);
  if (!picked.length) return { lines: [], totals: zero, blocked: "Choose the pieces that came back." };
  const lines: ReturnLine[] = [];
  let clientId: string | undefined;
  for (const it of picked) {
    const o = db.orders.find(x => x.id === it.orderId);
    if (!o) return { lines: [], totals: zero, blocked: "That order is not loaded." };
    const why = returnBlocker(o);
    if (why) return { lines: [], totals: zero, blocked: `${o.orderNumber}: ${why}` };
    if (clientId && o.clientId !== clientId) return { lines: [], totals: zero, blocked: "One credit note is for one client." };
    clientId = o.clientId;
    const kept = keptQty(o);
    if (it.qty > kept) return { lines: [], totals: zero, blocked: `${o.orderNumber}: only ${kept} piece${kept !== 1 ? "s" : ""} left with the client.` };
    const all = it.qty === kept;
    const qtyAll = o.quantity || 1;
    const unit = r2((o.amount || 0) / qtyAll);
    // The last pieces take whatever is left, so a fully returned order nets to exactly nothing.
    const valueUsd = all ? keptValue(o) : r2(unit * it.qty);
    const prior = o.returns ?? [];
    const giftLeft = r2((o.giftCardRedeemed || 0) - prior.reduce((s, r) => s + (r.giftBackUsd || 0), 0));
    const giftBackUsd = (o.amount || 0) > 0 ? Math.min(giftLeft, all ? giftLeft : r2((o.giftCardRedeemed || 0) * valueUsd / o.amount)) : 0;
    const shippingBackUsd = opt.refundShipping && all ? r2((o.shippingCharge || 0) - prior.reduce((s, r) => s + (r.shippingBackUsd || 0), 0)) : 0;
    const certificateBackUsd = opt.refundShipping && all ? r2((o.certificateFee || 0) - prior.reduce((s, r) => s + (r.certificateBackUsd || 0), 0)) : 0;
    lines.push({
      order: o, qty: it.qty, kept, unitUsd: unit, valueUsd, giftBackUsd: Math.max(0, giftBackUsd), shippingBackUsd: Math.max(0, shippingBackUsd),
      certificateBackUsd: Math.max(0, certificateBackUsd), feeUsd: 0, cashbackBackUsd: 0, cashbackSpentUsd: 0, cashbackChargedUsd: 0,
      creditUsd: 0, owedBefore: balanceDue(o), owedAfter: 0, toCreditUsd: 0,
      priceUsd: opt.priceUsd?.[o.id] ?? unit, invoice: findInvoiceForOrder(db.invoices, o.id),
    });
  }
  // The return charge, spread by value; never more than the pieces were worth.
  const totalValue = r2(lines.reduce((s, l) => s + l.valueUsd, 0));
  const feeAll = Math.min(Math.max(0, r2(opt.feeUsd || 0)), totalValue);
  let feeLeft = feeAll;
  lines.forEach((l, i) => {
    l.feeUsd = i === lines.length - 1 ? feeLeft : Math.min(feeLeft, totalValue > 0 ? r2(feeAll * l.valueUsd / totalValue) : 0);
    feeLeft = r2(feeLeft - l.feeUsd);
  });
  for (const l of lines) {
    const o = l.order;
    let credit = r2(l.valueUsd - l.giftBackUsd + l.shippingBackUsd + l.certificateBackUsd - l.feeUsd);
    // Cashback was earned on what the client paid for the order; the returned share comes back.
    const card = (db.giftCards ?? []).find(c => c.source === "cashback" && c.sourceOrderId === o.id && !c.revoked);
    if (card && credit > 0) {
      const base = r2(orderGrossTotal(o) - (o.giftCardRedeemed || 0));
      const due = base > 0 ? Math.min(r2(card.amount * credit / base), r2(card.amount - (card.takenBackUsd || 0))) : 0;
      const unused = giftCardRemaining(card, db.orders);
      l.cashbackCard = card;
      l.cashbackBackUsd = Math.max(0, Math.min(due, unused));
      l.cashbackSpentUsd = Math.max(0, r2(due - l.cashbackBackUsd));
      l.cashbackChargedUsd = opt.chargeSpentCashback === false ? 0 : Math.min(l.cashbackSpentUsd, credit);
      credit = r2(credit - l.cashbackChargedUsd);
    }
    l.creditUsd = Math.max(0, credit);
    const totalAfter = Math.max(0, r2(orderTotal(o) - l.creditUsd));
    l.owedAfter = Math.max(0, r2(totalAfter - totalAdvance(o)));
    l.toCreditUsd = Math.max(0, r2(totalAdvance(o) - totalAfter));
  }
  const sum = (k: keyof ReturnLine) => r2(lines.reduce((s, l) => s + (l[k] as number), 0));
  return {
    lines, clientId,
    totals: {
      qty: lines.reduce((s, l) => s + l.qty, 0), valueUsd: sum("valueUsd"), creditUsd: sum("creditUsd"), toCreditUsd: sum("toCreditUsd"),
      giftBackUsd: sum("giftBackUsd"), cashbackBackUsd: sum("cashbackBackUsd"), cashbackChargedUsd: sum("cashbackChargedUsd"),
      feeUsd: sum("feeUsd"), shippingBackUsd: r2(sum("shippingBackUsd") + sum("certificateBackUsd")),
    },
  };
}

export interface ReturnMeta { noteId: string; creditNoteNo: string; by: string; byName: string; at: string; costUsd?: Record<string, number> }

/**
 * Record the return (call inside updateDb — it plans again on the freshest
 * data). Returns the plan it applied; a blocked plan changes nothing.
 */
export function applyReturn(d: DB, input: ReturnInput[], opt: ReturnOptions, meta: ReturnMeta): ReturnPlan {
  const plan = planReturn(d, input, opt);
  if (plan.blocked) return plan;
  for (const l of plan.lines) {
    const o = d.orders.find(x => x.id === l.order.id)!;
    const ret: OrderReturn = {
      id: uid("ret_"), noteId: meta.noteId, creditNoteNo: meta.creditNoteNo,
      ...(l.invoice ? { invoiceId: l.invoice.id } : {}),
      at: meta.at, by: meta.by, byName: meta.byName, ...(opt.reason?.trim() ? { reason: opt.reason.trim() } : {}),
      qty: l.qty, valueUsd: l.valueUsd, creditUsd: l.creditUsd,
      ...(l.giftBackUsd ? { giftBackUsd: l.giftBackUsd } : {}),
      ...(l.shippingBackUsd ? { shippingBackUsd: l.shippingBackUsd } : {}),
      ...(l.certificateBackUsd ? { certificateBackUsd: l.certificateBackUsd } : {}),
      ...(l.feeUsd ? { feeUsd: l.feeUsd } : {}),
      ...(l.cashbackBackUsd ? { cashbackBackUsd: l.cashbackBackUsd } : {}),
      ...(l.cashbackChargedUsd ? { cashbackChargedUsd: l.cashbackChargedUsd } : {}),
      status: "coming", location: opt.location, priceUsd: l.priceUsd,
    };
    if (!o.returns) o.returns = [];
    o.returns.push(ret);
    // Paid beyond the new total → the client's credit, as a cancel does.
    const freed = capOrderAdvances(o);
    if (freed > 0) {
      ret.toCreditUsd = freed;
      const c = d.clients.find(x => x.id === o.clientId);
      if (c) c.creditBalance = r2((c.creditBalance || 0) + freed);
    }
    if (l.cashbackCard && l.cashbackBackUsd > 0) {
      const card = (d.giftCards ?? []).find(c => c.id === l.cashbackCard!.id);
      if (card) card.takenBackUsd = r2((card.takenBackUsd || 0) + l.cashbackBackUsd);
    }
    if (opt.received) receiveReturn(d, o.id, ret.id, { by: meta.by, byName: meta.byName, at: meta.at, location: opt.location, costUsd: meta.costUsd?.[o.id] });
  }
  return plan;
}

/**
 * The parcel reached us: the pieces go into Ready Stock. A piece first sold out
 * of Ready Stock goes back onto that same item; anything else becomes a new
 * item carrying the order's photos, weights per piece and price.
 */
export function receiveReturn(d: DB, orderId: string, returnId: string, w: { by: string; byName?: string; at: string; location?: string; priceUsd?: number; costUsd?: number }): ReadyStockItem | undefined {
  const o = d.orders.find(x => x.id === orderId);
  const r = o?.returns?.find(x => x.id === returnId);
  if (!o || !r || r.status === "received") return undefined;
  r.status = "received"; r.receivedAt = w.at; r.receivedBy = w.by;
  if (w.location) r.location = w.location;
  if (w.priceUsd != null) r.priceUsd = w.priceUsd;
  if (!d.readyStock) d.readyStock = [];
  const original = o.materialSourcing === "readyStock" && o.readyStockItemId ? d.readyStock.find(i => i.id === o.readyStockItemId) : undefined;
  // The piece's history names the order and credit note — never the client (every client can read Ready Stock).
  const who = { by: w.by, ...(w.byName ? { byName: w.byName } : {}) };
  if (original) {
    if (original.quantity === 0 && r.location) original.location = r.location;
    const had = original.quantity;
    original.quantity += r.qty;
    r.readyStockId = original.id;
    logItem(original, {
      ...who, at: w.at, kind: "returned", ref: { orderId: o.id, returnId: r.id },
      text: `${r.qty} came back — credit note ${r.creditNoteNo}, order ${o.orderNumber}${r.location ? ` · at the ${officeLabel(r.location)}` : ""} · ${had} → ${original.quantity}`,
    });
    // Back at another office than the rest of that piece: counted where it is.
    if (r.location && officeOf(original) && officeOf(original) !== r.location) {
      const canCost = (d.adminRecords ?? []).some(x => x.kind === "stockCost" && x.itemId === original.id);
      const there = moveReadyStock(d, original.id, r.qty, r.location, canCost, who);
      if (typeof there !== "string") { r.readyStockId = there.id; return there; }
    }
    return original;
  }
  const per = o.quantity || 1;
  const pw = pieceWeights(o, d.materialIssuances ?? []);
  const each = (n: number | undefined) => (n ? r3(n / per) : undefined);
  const client = d.clients.find(c => c.id === o.clientId);
  const item: ReadyStockItem = {
    id: uid("rs_"),
    name: o.designNumber ? `${o.jewelleryType} #${o.designNumber}` : `${o.jewelleryType} — ${o.orderNumber}`,
    jewelleryType: o.jewelleryType, metal: o.metal, productKarats: o.productKarats,
    grossWeight: each(pw.gross), netWeight: each(pw.net), diamondWeight: each(pw.diamondCt),
    diamondType: pw.diamondCt ? o.diamondType : undefined,
    price: r2(r.priceUsd ?? (o.amount || 0) / per), quantity: r.qty,
    images: [o.cadImage, ...(o.productPhotos || []), ...(o.images || [])].filter((x): x is string => !!x).slice(0, 4),
    ...(o.productVideo ? { video: o.productVideo } : {}),
    sku: o.designNumber || undefined, location: r.location || "US",
    notes: `Returned by ${client?.companyName ?? "the client"} — order ${o.orderNumber}, credit note ${r.creditNoteNo}${r.reason ? ` (${r.reason})` : ""}`,
    createdBy: w.by, createdAt: w.at, fromReturn: { orderId: o.id, returnId: r.id },
    // Back in the Ready Stock of the company that sold it.
    ...coField(companyOfOrder(d, o)),
  };
  for (const k of Object.keys(item) as (keyof ReadyStockItem)[]) if (item[k] === undefined) delete item[k];
  logItem(item, {
    ...who, at: w.at, kind: "returned", ref: { orderId: o.id, returnId: r.id },
    text: `Came back from order ${o.orderNumber} — credit note ${r.creditNoteNo}${r.reason ? ` (${r.reason})` : ""} · ${r.qty} piece${r.qty !== 1 ? "s" : ""} at the ${officeLabel(item.location)}`,
  });
  d.readyStock.push(item);
  r.readyStockId = item.id;
  // What it cost per piece, so the Ready Stock card shows it (an admin's figure).
  if (w.costUsd != null && w.costUsd > 0) writeStockCost(d, item.id, w.costUsd);
  return item;
}

/** Why a return cannot be cancelled; undefined when it can. */
export function cancelReturnBlocker(d: DB, orderId: string, returnId: string): string | undefined {
  const o = d.orders.find(x => x.id === orderId);
  const r = o?.returns?.find(x => x.id === returnId);
  if (!o || !r) return "That return is not there any more.";
  if (r.status === "received" && r.readyStockId) {
    const item = d.readyStock.find(i => i.id === r.readyStockId);
    if (!item || item.quantity < r.qty) return "The piece has already left Ready Stock (sold or changed) — it can't be taken back out.";
    if (item.fromReturn?.returnId === r.id && d.orders.some(x => x.readyStockItemId === item.id && x.status !== "Rejected"))
      return "The piece has already been sold again from Ready Stock.";
  }
  const c = d.clients.find(x => x.id === o.clientId);
  if ((r.toCreditUsd || 0) > 0 && (c?.creditBalance || 0) + 0.005 < (r.toCreditUsd || 0))
    return `The $${(r.toCreditUsd || 0).toFixed(2)} this return put on the client's credit has already been used.`;
  return undefined;
}

/** Undo a return recorded by mistake (the piece never came back). Call inside updateDb. */
export function cancelReturn(d: DB, orderId: string, returnId: string, w: { by: string; at: string }): boolean {
  if (cancelReturnBlocker(d, orderId, returnId)) return false;
  const o = d.orders.find(x => x.id === orderId)!;
  const r = o.returns!.find(x => x.id === returnId)!;
  if (r.status === "received" && r.readyStockId) {
    const item = d.readyStock.find(i => i.id === r.readyStockId)!;
    if (item.fromReturn?.returnId === r.id && item.quantity === r.qty) d.readyStock = d.readyStock.filter(i => i.id !== item.id);
    else {
      const had = item.quantity;
      item.quantity -= r.qty;
      // A lot made only to hold the returned pieces at their office goes with them.
      if (item.quantity <= 0 && item.splitFrom && !d.orders.some(x => x.readyStockItemId === item.id)) d.readyStock = d.readyStock.filter(i => i.id !== item.id);
      else logItem(item, { by: w.by, at: w.at, kind: "returnCancelled", ref: { orderId: o.id, returnId: r.id }, text: `Return ${r.creditNoteNo} cancelled (order ${o.orderNumber}) — ${r.qty} taken back out · ${had} → ${item.quantity}` });
    }
  }
  if ((r.toCreditUsd || 0) > 0) {
    const c = d.clients.find(x => x.id === o.clientId);
    if (c) { const left = r2((c.creditBalance || 0) - (r.toCreditUsd || 0)); c.creditBalance = left > 0 ? left : undefined; }
    if (!o.advances) o.advances = [];
    o.advances.push({ id: uid("adv_"), amount: r.toCreditUsd!, note: `Back on the order — return ${r.creditNoteNo} cancelled`, recordedBy: w.by, createdAt: w.at, fromCredit: true });
  }
  if (r.cashbackBackUsd) {
    const card = (d.giftCards ?? []).find(c => c.source === "cashback" && c.sourceOrderId === o.id);
    if (card) { const t = r2((card.takenBackUsd || 0) - r.cashbackBackUsd); card.takenBackUsd = t > 0 ? t : undefined; }
  }
  o.returns = o.returns!.filter(x => x.id !== returnId);
  if (!o.returns.length) delete o.returns;
  return true;
}

/** Every line of one credit note, across its orders. */
export function creditNoteLines(db: DB, noteId: string): { order: Order; ret: OrderReturn }[] {
  const out: { order: Order; ret: OrderReturn }[] = [];
  for (const o of db.orders) for (const r of o.returns ?? []) if (r.noteId === noteId) out.push({ order: o, ret: r });
  return out;
}

/** All returns on an invoice's orders, grouped by credit note. */
export function invoiceCreditNotes(db: DB, orderIds: string[]): { noteId: string; no: string; at: string; creditUsd: number; qty: number }[] {
  const by = new Map<string, { noteId: string; no: string; at: string; creditUsd: number; qty: number }>();
  for (const id of orderIds) {
    const o = db.orders.find(x => x.id === id);
    for (const r of o?.returns ?? []) {
      const n = by.get(r.noteId) ?? { noteId: r.noteId, no: r.creditNoteNo, at: r.at, creditUsd: 0, qty: 0 };
      n.creditUsd = r2(n.creditUsd + r.creditUsd); n.qty += r.qty;
      by.set(r.noteId, n);
    }
  }
  return [...by.values()].sort((a, b) => a.no.localeCompare(b.no));
}

/** Pieces still on their way back to us. */
export function returnsComing(db: DB): { order: Order; ret: OrderReturn }[] {
  const out: { order: Order; ret: OrderReturn }[] = [];
  for (const o of db.orders) for (const r of o.returns ?? []) if (r.status === "coming") out.push({ order: o, ret: r });
  return out.sort((a, b) => a.ret.at.localeCompare(b.ret.at));
}
