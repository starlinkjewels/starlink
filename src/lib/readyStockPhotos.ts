// A piece an order built and put into Ready Stock (order.readyStockCreatedId)
// takes its photos from the order. They were copied once, when it went in — so
// a photo changed on the order afterwards never reached the piece, and Ready
// Stock kept showing the old one. Now the piece follows the order's pictures.
import type { DB, Order, ReadyStockItem } from "./db";
import { logItem, type Who } from "./readyStockHistory";

/** A piece keeps up to this many photos (ReadyStockItem.images) — what it takes from its order too. */
export const PIECE_PHOTO_MAX = 4;

/** The pictures an order gives its piece: the CAD, the product photos, then the client's references. */
export function orderPictures(o: Pick<Order, "cadImage" | "productPhotos" | "images">): string[] {
  return [o.cadImage, ...(o.productPhotos ?? []), ...(o.images ?? [])].filter((x): x is string => !!x);
}

/** The order that built a piece (and put it into Ready Stock), if any. */
export function builtFrom(d: DB, item: ReadyStockItem): Order | undefined {
  return d.orders.find(o => o.readyStockCreatedId === item.id && !o.deletedAt);
}

/** "(2 photos taken off: <urls>)" for a history line — so a photo taken off can be found again. */
const offNote = (urls: string[]) => (urls.length ? ` (${urls.length} photo${urls.length !== 1 ? "s" : ""} taken off: ${urls.join(" ")})` : "");

/**
 * Inside the mutator that changed an order's pictures (`before` = its pictures
 * just before): a photo added to the order is added to its piece, first; one
 * taken off the order comes off the piece. Photos put on the piece itself, in
 * Ready Stock, stay — when the piece is full, the order's older photos make
 * room first.
 */
export function followOrderPictures(d: DB, orderId: string, before: string[], who: Who): void {
  const o = d.orders.find(x => x.id === orderId);
  const item = o && !o.deletedAt && o.readyStockCreatedId ? d.readyStock?.find(i => i.id === o.readyStockCreatedId) : undefined;
  if (!o || !item) return;
  const now = orderPictures(o);
  const gone = new Set(before.filter(u => !now.includes(u)));
  const added = now.filter(u => !before.includes(u));
  const kept = (item.images ?? []).filter(u => !gone.has(u));
  const next = [...added.filter(u => !kept.includes(u)), ...kept];
  // Too many: the order's photos (oldest first, from the end) go before the piece's own.
  const fromOrder = (u: string) => before.includes(u) || now.includes(u);
  for (let i = next.length - 1; next.length > PIECE_PHOTO_MAX && i >= 0; i--) {
    if (fromOrder(next[i])) next.splice(i, 1);
  }
  next.length = Math.min(next.length, PIECE_PHOTO_MAX);
  if (next.join("\n") === (item.images ?? []).join("\n")) return;
  const off = (item.images ?? []).filter(u => !next.includes(u));
  item.images = next;
  logItem(item, { ...who, kind: "edited", text: `Photos updated from order ${o.orderNumber}${offNote(off)}`, ref: { orderId: o.id } });
}

/**
 * A piece whose photos look older than its order's: it lacks a picture the
 * order shows and holds one the order no longer has (a photo replaced on the
 * order before pieces followed it).
 */
export function piecePhotosBehind(d: DB, item: ReadyStockItem): boolean {
  const o = builtFrom(d, item);
  if (!o) return false;
  const want = orderPictures(o).slice(0, PIECE_PHOTO_MAX);
  const have = item.images ?? [];
  return want.some(u => !have.includes(u)) && have.some(u => !orderPictures(o).includes(u));
}

/** What taking the order's photos would do to a piece: the photos it gets, and those that come off it. */
export function orderPicturesPlan(d: DB, item: ReadyStockItem): { order?: Order; next: string[]; off: string[] } {
  const o = builtFrom(d, item);
  if (!o) return { next: [], off: [] };
  const next = orderPictures(o).slice(0, PIECE_PHOTO_MAX);
  return { order: o, next, off: (item.images ?? []).filter(u => !next.includes(u)) };
}

/** Inside a mutator: the piece's photos made the order's (its first few). The ones taken off are written in its history. */
export function takeOrderPictures(d: DB, itemId: string, who: Who): boolean {
  const item = d.readyStock?.find(i => i.id === itemId);
  if (!item) return false;
  const { order, next, off } = orderPicturesPlan(d, item);
  if (!order || !next.length) return false;
  item.images = next;
  logItem(item, { ...who, kind: "edited", text: `Photos taken from order ${order.orderNumber}${offNote(off)}`, ref: { orderId: order.id } });
  return true;
}

/**
 * Inside the mutator that deletes a photo's file: every Ready Stock piece that
 * shows it lets go of it (copies split off to other offices, return pieces) —
 * the file is gone, so it would only show as a broken picture.
 */
export function dropDeletedPicture(d: DB, url: string, who: Who): void {
  for (const item of d.readyStock ?? []) {
    if (!(item.images ?? []).includes(url)) continue;
    item.images = item.images.filter(u => u !== url);
    logItem(item, { ...who, kind: "edited", text: `A photo was deleted${offNote([url])}` });
  }
}
