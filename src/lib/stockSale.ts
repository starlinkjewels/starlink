// Selling a piece we built ourselves: the SAME order is sold.
//
// A piece made in-house has its own order — the build (forReadyStock), with
// its number, photos, CAD, materials, factory and costs. Selling it used to
// make a second, new order for the client, with a new number and none of
// that — so every piece sold showed twice, and the sale showed no photos. Now
// the build itself becomes the client's order: same number, same photos and
// CAD, its own cost (what was spent making it) against the price — and the
// piece leaves Ready Stock. What the sale wrote over is kept on the order
// (stockSale.before), so "Undo sale" puts the build back exactly as it was.
//
// Only when the sale takes the whole build: every piece it made, none sold
// before, nothing else on it. A piece with no build behind it (bought
// ready-made, added by hand, sent back by a client), or part of a build, is
// sold on a new order as before — which now carries the piece's photos and
// design (saleLooks).
//
// Sales made as new orders before this (a bulk sale of 19 made 19 new
// orders) are found by shelfSaleDuplicates and moved onto their builds by
// mergeShelfSale — the sale's client, price, payments, invoice and dispatch go
// to the build; the separate order is closed and marked as merged.
import { findInvoiceForOrder, invoiceOrderIds, orderIsDispatched, type DB, type Order, type ReadyStockItem, type StockSaleRecord } from "./db";
import { logItem, type Who } from "./readyStockHistory";
import { closedWhy } from "./yearLock";

/** Sold as a ready-made piece — a sale order, or a build sold on itself. Its stages run Ready → Dispatched → Delivered. */
export const isShelfSale = (o: Pick<Order, "materialSourcing" | "stockSale">) => o.materialSourcing === "readyStock" || !!o.stockSale;

/** The build that made this piece, and is still the shelf's (not sold, cancelled, deleted or melted). */
export function buildOf(d: Pick<DB, "orders">, itemId: string): Order | undefined {
  return d.orders.find(o => o.readyStockCreatedId === itemId && o.forReadyStock && !o.stockSale && !o.deletedAt && !o.melted && o.status !== "Rejected");
}

/** Other live orders that sold some of this piece. */
const salesOf = (d: Pick<DB, "orders">, itemId: string, exceptId?: string) =>
  d.orders.filter(o => o.readyStockItemId === itemId && o.materialSourcing === "readyStock" && o.id !== exceptId && !o.deletedAt && o.status !== "Rejected");

/**
 * The build a sale of `qty` of this piece is made on — when the sale takes the
 * whole build (every piece it made is on the shelf, and all of them go).
 * Otherwise undefined: a new order is made, as for a bought piece.
 */
export function buildToSell(d: Pick<DB, "orders" | "readyStock">, itemId: string, qty: number): Order | undefined {
  const item = (d.readyStock ?? []).find(i => i.id === itemId);
  if (!item || item.fromReturn) return undefined;
  const b = buildOf(d, itemId);
  if (!b) return undefined;
  const made = Math.max(1, Math.round(b.quantity || 1));
  if (qty !== made || item.quantity !== made) return undefined;
  if (salesOf(d, itemId).length) return undefined;
  return b;
}

/** The fields a sale writes over on its build — and what Undo sale puts back. */
const SALE_FIELDS = ["clientId", "forReadyStock", "assignedEmployeeId", "contactPerson", "amount", "shippingCharge", "advances", "giftCardId",
  "giftCardRedeemed", "otherCharges", "certificate", "certificateFee", "certificateFeeInr", "certificateRate", "instructions", "expectedDelivery",
  "priority", "deliveryTime", "timeline", "status", "createdAt"] as const;

/** The stages after a build is made: sold (now), then dispatch and delivery. */
const saleSteps = (at: string): Order["timeline"] => [
  { step: "Sold", status: "done", date: at },
  { step: "Dispatch", status: "pending" },
  { step: "Delivered", status: "pending" },
];

/**
 * Inside a mutator: the build becomes the client's order. `sale` is the order
 * New Order would have made (its client, price, shipping, advance, charges…);
 * the build keeps its number, photos, CAD, materials, weights and costs.
 * Returns the build, now the sale — or null when it can no longer be sold so.
 */
export function sellOnBuild(d: DB, buildId: string, sale: Order, item: ReadyStockItem, qty: number, who: Who & { at?: string }): Order | null {
  const b = d.orders.find(o => o.id === buildId);
  if (!b || b.stockSale || !b.forReadyStock || b.readyStockCreatedId !== item.id) return null;
  const at = who.at ?? new Date().toISOString();
  const before: StockSaleRecord["before"] = {};
  for (const f of SALE_FIELDS) if (b[f] !== undefined) (before as Record<string, unknown>)[f] = structuredClone(b[f]);
  b.stockSale = { itemId: item.id, qty, soldAt: at, by: who.by, before };
  delete b.forReadyStock;
  b.clientId = sale.clientId;
  if (sale.assignedEmployeeId) b.assignedEmployeeId = sale.assignedEmployeeId; else delete b.assignedEmployeeId;
  b.contactPerson = sale.contactPerson;
  b.amount = sale.amount;
  b.shippingCharge = sale.shippingCharge || 0;
  b.advances = [...(b.advances ?? []), ...(sale.advances ?? [])];
  if (sale.giftCardId) { b.giftCardId = sale.giftCardId; b.giftCardRedeemed = sale.giftCardRedeemed; }
  // What the client is billed is the sale's — never a fee or charge the build carried for itself.
  if (sale.otherCharges?.length) b.otherCharges = sale.otherCharges; else delete b.otherCharges;
  // A certificate the sale asks for — the build's own stays when it had one.
  if (sale.certificate && !b.certificate) b.certificate = true;
  b.certificateFee = sale.certificateFee || 0;
  if (sale.certificateFeeInr) { b.certificateFeeInr = sale.certificateFeeInr; b.certificateRate = sale.certificateRate; }
  else { delete b.certificateFeeInr; delete b.certificateRate; }
  // The client reads the order's instructions: the sale's own, never the build's notes to the factory (kept in stockSale.before).
  b.instructions = sale.instructions?.trim() ?? "";
  b.expectedDelivery = sale.expectedDelivery || b.expectedDelivery;
  b.priority = sale.priority || b.priority;
  if (sale.deliveryTime) b.deliveryTime = sale.deliveryTime;
  // Pictures taken for the sale join the build's own (its CAD and product photos stay as they are).
  if (sale.images?.length) b.images = [...new Set([...(b.images ?? []), ...sale.images])];
  // The client's order is dated the day it was sold to them; the build's own date is kept in stockSale.
  b.createdAt = at;
  b.timeline = [...(b.timeline ?? []).filter(t => t.step !== "Sold" && t.step !== "Dispatch" && t.step !== "Delivered"), ...saleSteps(at)];
  b.status = "Ready";
  const had = item.quantity;
  item.quantity = Math.max(0, had - qty);
  logItem(item, { ...who, at, kind: "sold", text: `Sold on its own order ${b.orderNumber} · ${had} → ${item.quantity}`, ref: { orderId: b.id } });
  return b;
}

/** What undoing a sale or moving one reads — waited for (fresh from the server) before either is done. */
export const SALE_REPAIR_COLS = ["orders", "readyStock", "invoices", "giftCards", "clients", "lockerTransactions", "expenses", "messages"] as const;

/** Why a build sold on itself can't go back to Ready Stock — or undefined. */
export function undoSaleBlocker(d: Pick<DB, "invoices" | "readyStock">, o: Order): string | undefined {
  if (!o.stockSale) return "This order was not sold from Ready Stock";
  const closed = closedWhy(o.stockSale.soldAt, (d as { settings?: DB["settings"] }).settings);
  if (closed) return closed;
  if (o.stockSale.mergedFrom) return "Its sale was moved onto it from a separate order — return the pieces instead";
  if (o.deletedAt || o.melted) return "This order is closed";
  if (orderIsDispatched(o) || o.returns?.length) return "Already dispatched — use “Return pieces” instead (credit note, piece back into Ready Stock)";
  const inv = findInvoiceForOrder(d.invoices ?? [], o.id);
  if (inv) return `On invoice ${inv.number} — delete or credit the invoice first`;
  if (o.giftCardId) return "A gift card was used on it — take it off first";
  if (!(d.readyStock ?? []).some(i => i.id === o.stockSale!.itemId)) return "Its Ready Stock piece is no longer there";
  return undefined;
}

/**
 * Inside a mutator: the sale is undone — the build is the shelf's again, as it
 * was, and its pieces go back to Ready Stock. Money paid on it becomes the
 * client's credit (as a cancel does). Returns false when it can't be done.
 */
export function undoStockSale(d: DB, orderId: string, who: Who): boolean {
  const o = d.orders.find(x => x.id === orderId);
  if (!o?.stockSale || undoSaleBlocker(d, o)) return false;
  const rec = o.stockSale;
  const item = d.readyStock.find(i => i.id === rec.itemId)!;
  const paid = (o.advances ?? []).filter(a => !(rec.before.advances ?? []).some(x => x.id === a.id)).reduce((s, a) => s + a.amount, 0);
  if (paid > 0) {
    const c = d.clients.find(x => x.id === o.clientId);
    if (c) c.creditBalance = Math.round(((c.creditBalance || 0) + paid) * 100) / 100;
  }
  for (const f of SALE_FIELDS) {
    const v = (rec.before as Record<string, unknown>)[f];
    if (v === undefined) delete (o as unknown as Record<string, unknown>)[f];
    else (o as unknown as Record<string, unknown>)[f] = structuredClone(v);
  }
  o.forReadyStock = true;
  o.clientId = "";
  delete o.stockSale;
  const had = item.quantity;
  item.quantity = had + rec.qty;
  logItem(item, { ...who, kind: "unsold", text: `Sale on ${o.orderNumber} undone — back in stock · ${had} → ${item.quantity}`, ref: { orderId: o.id } });
  return true;
}

/* ─────────────── Sales made as separate orders, before ─────────────── */

export interface ShelfDuplicate {
  sale: Order;
  build?: Order;
  item?: ReadyStockItem;
  /** Why it can't be moved onto its build — undefined when it can. */
  reason?: string;
}

/** Every live Ready Stock sale of a piece we built ourselves, made as a separate order — with its build, or why it stays. */
export function shelfSaleDuplicates(d: Pick<DB, "orders" | "readyStock" | "invoices">): ShelfDuplicate[] {
  const out: ShelfDuplicate[] = [];
  for (const s of d.orders) {
    if (s.materialSourcing !== "readyStock" || !s.readyStockItemId || s.deletedAt || s.status === "Rejected" || s.mergedInto) continue;
    const item = (d.readyStock ?? []).find(i => i.id === s.readyStockItemId);
    const build = d.orders.find(o => o.readyStockCreatedId === s.readyStockItemId && !o.deletedAt);
    if (!build) continue; // a bought or hand-added piece: its sale is the only order there is
    const row: ShelfDuplicate = { sale: s, build, item };
    const qty = Math.max(1, Math.round(s.readyStockQty ?? s.quantity ?? 1));
    const made = Math.max(1, Math.round(build.quantity || 1));
    if (build.stockSale) row.reason = `${build.orderNumber} is already sold`;
    else if (!build.forReadyStock || build.melted || build.status === "Rejected") row.reason = `${build.orderNumber} is not a build on the shelf any more`;
    else if (qty !== made) row.reason = `It sold ${qty} of the ${made} pieces ${build.orderNumber} made — only a whole build moves`;
    else if (salesOf(d, s.readyStockItemId, s.id).length) row.reason = "The piece was sold on more than one order";
    else if (s.returns?.length) row.reason = "Pieces were returned on it — it stays as it is";
    else if (!item) row.reason = "Its Ready Stock piece is no longer there";
    out.push(row);
  }
  return out.sort((a, b) => a.sale.orderNumber.localeCompare(b.sale.orderNumber, undefined, { numeric: true }));
}

/** The sale's own fields that go to its build when merged (dispatch and delivery included). */
const MOVED = ["courierName", "trackingNumber", "trackingLink", "dispatchedAt", "deliveredAt", "cashbackIssued"] as const;

/**
 * Inside a mutator: one separate sale order moved onto its build — the build
 * becomes the client's order (as a sale on it is made now); everything that
 * names the sale (its invoice, its payment entries, expenses on it, its
 * messages) names the build instead; the sale is closed, marked deleted and
 * merged. The piece's count does not change — it was sold already.
 */
export function mergeShelfSale(d: DB, saleId: string, who: Who): Order | null {
  const row = shelfSaleDuplicates(d).find(r => r.sale.id === saleId);
  if (!row || row.reason || !row.build || !row.item) return null;
  const s = d.orders.find(o => o.id === saleId)!;
  const b = d.orders.find(o => o.id === row.build!.id)!;
  const qty = Math.max(1, Math.round(s.readyStockQty ?? s.quantity ?? 1));
  // As a sale on the build — with the piece's count put back for the moment so the sale takes it again.
  const item = d.readyStock.find(i => i.id === row.item!.id)!;
  const shelf = item.quantity;
  item.quantity = shelf + qty;
  const histLen = item.history?.length ?? 0;
  const done = sellOnBuild(d, b.id, s, item, qty, { ...who, at: s.createdAt });
  if (!done) { item.quantity = shelf; return null; }
  // Its sold line names the merge, not a new sale.
  if (item.history && item.history.length > histLen) {
    const ev = item.history[item.history.length - 1];
    ev.text = `Sale ${s.orderNumber} moved onto its own order ${b.orderNumber}`;
  }
  b.stockSale!.mergedFrom = s.id;
  // Its stages as far as they went: dispatched / delivered stay so.
  const st = (name: string) => s.timeline?.find(t => t.step === name);
  for (const name of ["Dispatch", "Delivered"]) {
    const from = st(name), to = b.timeline.find(t => t.step === name);
    if (from && to && from.status === "done") { to.status = "done"; to.date = from.date; }
  }
  for (const f of MOVED) if (s[f] !== undefined) (b as unknown as Record<string, unknown>)[f] = s[f];
  if (s.manufacturingLog?.length) b.manufacturingLog = [...(b.manufacturingLog ?? []), ...s.manufacturingLog];
  b.status = s.status;
  if (s.previousOrderNumber) b.previousOrderNumber = b.previousOrderNumber ?? s.previousOrderNumber;
  // Everything that named the sale names the build.
  for (const inv of d.invoices ?? []) {
    const ids = invoiceOrderIds(inv);
    if (!ids.includes(s.id)) continue;
    const next = [...new Set(ids.map(x => (x === s.id ? b.id : x)))];
    inv.orderIds = next;
    inv.orderId = next[0];
  }
  for (const t of d.lockerTransactions ?? []) if (t.refId === s.id) t.refId = b.id;
  for (const e of d.expenses ?? []) if (e.orderIds?.includes(s.id)) e.orderIds = [...new Set(e.orderIds.map(x => (x === s.id ? b.id : x)))];
  for (const m of d.messages ?? []) {
    if (m.orderId === s.id) m.orderId = b.id;
    if (m.orderCard?.orderId === s.id) m.orderCard = { ...m.orderCard, orderId: b.id, orderNumber: b.orderNumber };
  }
  // Cashback given for the sale: its card now comes from the build (a return takes it back from there).
  for (const g of d.giftCards ?? []) if (g.sourceOrderId === s.id) g.sourceOrderId = b.id;
  // An invoice's stone lines, kept per order.
  for (const inv of d.invoices ?? []) {
    if (inv.stones?.[s.id] && !inv.stones[b.id]) { inv.stones[b.id] = inv.stones[s.id]; delete inv.stones[s.id]; }
  }
  // The separate order: closed, marked merged and deleted — off every list and total, never back on the shelf.
  s.advances = [];
  delete s.giftCardId; delete s.giftCardRedeemed;
  s.amount = 0;
  s.status = "Rejected";
  s.readyStockBackAt = s.readyStockBackAt ?? new Date().toISOString();
  s.mergedInto = b.id;
  s.deletedAt = new Date().toISOString();
  s.deletedBy = who.by;
  return b;
}

/** For a confirmation: what merging these will do. */
export function mergeSummary(rows: ShelfDuplicate[], invoices: DB["invoices"]): string[] {
  return rows.map(r => {
    const inv = findInvoiceForOrder(invoices ?? [], r.sale.id);
    return `${r.sale.orderNumber} → ${r.build!.orderNumber}${inv ? ` (invoice ${inv.number})` : ""}`;
  });
}

/**
 * What a NEW sale order shows of the piece it sells (a bought piece, part of a
 * build, a returned one): its photos, and from the order it was made on (or
 * came back from) its CAD, product photos, video and design — so a sale never
 * shows up bare.
 */
export function saleLooks(d: Pick<DB, "orders" | "readyStock">, itemId: string): Pick<Order, "images" | "cadImage" | "productPhotos" | "productVideo" | "cad3dmUrl" | "designNumber" | "productSize" | "rhodium" | "stamping"> {
  const item = (d.readyStock ?? []).find(i => i.id === itemId);
  if (!item) return { images: [] };
  const from = d.orders.find(o => o.readyStockCreatedId === itemId && !o.deletedAt)
    ?? (item.fromReturn ? d.orders.find(o => o.id === item.fromReturn!.orderId) : undefined);
  const out: ReturnType<typeof saleLooks> = { images: (item.images ?? []).slice(0, 3) };
  if (from?.cadImage) out.cadImage = from.cadImage;
  if (from?.productPhotos?.length) out.productPhotos = [...from.productPhotos];
  const video = item.video || from?.productVideo;
  if (video) out.productVideo = video;
  if (from?.cad3dmUrl) out.cad3dmUrl = from.cad3dmUrl;
  if (from?.designNumber) out.designNumber = from.designNumber;
  if (from?.productSize) out.productSize = from.productSize;
  if (from?.rhodium) out.rhodium = from.rhodium;
  if (from?.stamping) out.stamping = from.stamping;
  return out;
}
