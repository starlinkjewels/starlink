// Where a Ready Stock piece physically is: one of our offices. The list is the
// admin's (settings.readyStockOffices), US / Hong Kong / India / Other until
// they change it. A piece keeps the office as text in `location`, so an office
// taken off the list still shows for the pieces that are there.
import { READY_STOCK_LOCATIONS, stockCostOf, writeStockCost, uid, type DB, type ReadyStockItem, type Settings } from "@/lib/db";

/** The offices to choose from, in the admin's order. */
export function readyStockOffices(settings?: Pick<Settings, "readyStockOffices"> | null): string[] {
  const list = [...new Set((settings?.readyStockOffices ?? []).map(s => s.trim()).filter(Boolean))];
  return list.length ? list : [...READY_STOCK_LOCATIONS];
}

/** "US" reads as "US office"; a name that already says what it is stays as it is. */
export function officeLabel(office?: string): string {
  const o = office?.trim();
  if (!o) return "No office set";
  if (o === "Other") return "Other place";
  return /\b(office|warehouse|store|shop|vault|showroom|branch|godown)\b/i.test(o) ? o : `${o} office`;
}

/** The office a piece is at — "" when none was ever set. */
export function officeOf(item: { location?: string }): string {
  return item.location?.trim() || "";
}

/**
 * Every office worth a tab: the list, then any other office a piece is still
 * at, then "" when some pieces have none. Each with its pieces in stock.
 */
export function officeTabs(settings: Settings | undefined, items: ReadyStockItem[]): { office: string; pieces: number; items: number }[] {
  const order = readyStockOffices(settings);
  const extra = [...new Set(items.map(officeOf))].filter(o => o && !order.includes(o)).sort();
  const all = [...order, ...extra, ...(items.some(i => !officeOf(i)) ? [""] : [])];
  return all.map(office => {
    const here = items.filter(i => officeOf(i) === office);
    return { office, pieces: here.reduce((s, i) => s + Math.max(0, i.quantity), 0), items: here.length };
  });
}

/** Sort key: the office's place on the list, unknown offices after, none last. */
export function officeRank(settings: Settings | undefined, office: string): number {
  if (!office) return 10_000;
  const i = readyStockOffices(settings).indexOf(office);
  return i >= 0 ? i : 5_000;
}

/** The family a lot belongs to — pieces of one item split across offices. */
const rootOf = (i: ReadyStockItem) => i.splitFrom ?? i.id;

/**
 * Send `qty` pieces of an item to another office. Call inside updateDb.
 *  - all of them: the item itself moves;
 *  - some: they join the same piece already waiting there (split off earlier),
 *    or become their own item there — a copy of this one, its cost included
 *    when `canCost` (only an admin can read and write a piece's cost).
 * Returns the item the pieces are now on, or a reason it can't be done.
 */
export function moveReadyStock(d: DB, itemId: string, qty: number, to: string, canCost: boolean): ReadyStockItem | string {
  const it = (d.readyStock ?? []).find(i => i.id === itemId);
  if (!it) return "That piece is not in Ready Stock any more.";
  const dest = to.trim();
  if (!dest) return "Choose the office.";
  if (officeOf(it) === dest) return it;
  const n = Math.round(qty);
  if (!(n > 0)) return "Enter how many pieces.";
  if (it.quantity <= 0) return "None of this piece is in stock to move.";
  if (n > it.quantity) return `Only ${it.quantity} of this piece ${it.quantity === 1 ? "is" : "are"} in stock.`;
  if (n === it.quantity) { it.location = dest; return it; }
  const sibling = d.readyStock.find(x => x.id !== it.id && rootOf(x) === rootOf(it) && officeOf(x) === dest);
  it.quantity -= n;
  if (sibling) { sibling.quantity += n; return sibling; }
  const copy: ReadyStockItem = { ...it, id: uid("rs_"), quantity: n, location: dest, splitFrom: rootOf(it) };
  // A client's return stays on the item it came back as; the copy is just stock.
  delete copy.fromReturn;
  delete copy.cost;
  d.readyStock.unshift(copy);
  if (canCost) {
    const c = stockCostOf(d, it);
    if (c != null && c > 0) writeStockCost(d, copy.id, c);
  } else if (it.cost != null) copy.cost = it.cost;
  return copy;
}
