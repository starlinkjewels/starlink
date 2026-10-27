// Ready Stock pieces, shared with a client: a public link (/s/:id) and a PDF.
//
// The link holds a snapshot of only what was chosen — photos, the CAD, gold
// and diamond details, and the price if it is shown (at the price typed for
// this share, which never changes the piece's own). A cost is never in it.
//
// A piece made from an order carries that order's CAD, colour and diamonds;
// the order is found from the piece (made for stock, split off, or returned).
import { doc, setDoc } from "firebase/firestore";
import { db as fsdb } from "./firebase";
import { brandFor, companyOf, companyOfOrder } from "./companies";
import { mainDiamondShape, uid, updateDb, type DB, type Order, type ReadyStockItem, type Share, type ShareBrand, type SharePiece } from "./db";
import { pieceWeights } from "./weights";

/** The order a piece was made from (or came back from), when there is one. */
export function sourceOrderOf(d: DB, item: ReadyStockItem): Order | undefined {
  const seen = new Set<string>();
  let cur: ReadyStockItem | undefined = item;
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    const id = cur.id;
    const made = d.orders.find(o => o.readyStockCreatedId === id);
    if (made) return made;
    if (cur.fromReturn) return d.orders.find(o => o.id === cur!.fromReturn!.orderId);
    cur = cur.splitFrom ? d.readyStock.find(r => r.id === cur!.splitFrom) : undefined;
  }
  return undefined;
}

/** "G-H · VS" — the colour and clarity of the stones that went into the order. */
function diamondQuality(d: DB, orderId: string): string | undefined {
  const packets = (d.diamondPackets ?? []).filter(p => p.orderId === orderId && p.status !== "in_stock");
  const fromPk = packets.map(p => [p.color, p.clarity].filter(Boolean).join(" ")).filter(Boolean);
  const fromIss = (d.materialIssuances ?? [])
    .filter(i => i.orderId === orderId && i.material === "diamond" && i.diamondSpec)
    .map(i => [i.diamondSpec!.color, i.diamondSpec!.clarity].filter(Boolean).join(" ")).filter(Boolean);
  const all = [...new Set([...fromPk, ...fromIss])];
  return all.length ? all.slice(0, 3).join(" · ") : undefined;
}

/** The size of the stones that went into the order — "5.30 x 3.30", "1.5 mm". */
function diamondSize(d: DB, orderId: string): string | undefined {
  const mm = (d.materialIssuances ?? [])
    .filter(i => i.orderId === orderId && i.material === "diamond" && i.diamondSpec?.mm?.trim())
    .map(i => i.diamondSpec!.mm!.trim());
  const all = [...new Set(mm)];
  return all.length ? all.slice(0, 2).join(", ") : undefined;
}

export interface PieceShareChoice {
  /** USD per piece id — the price for this share; undefined = hidden. */
  prices?: Record<string, number>;
  gold: boolean;
  diamonds: boolean;
  cad: boolean;
  /** The piece's video, as a link. */
  video?: boolean;
  /** An order's reference pictures as well (the client's own — off unless asked). */
  refs?: boolean;
}

/** The pieces as the client will see them. */
export function buildSharePieces(d: DB, items: ReadyStockItem[], c: PieceShareChoice): SharePiece[] {
  return items.map(item => {
    const o = sourceOrderOf(d, item);
    const ct = item.diamondWeight || o?.actualDiamondWeight || 0;
    const piece: SharePiece = {
      id: item.id,
      name: item.name,
      sku: item.sku || undefined,
      type: item.jewelleryType,
      photos: (item.images ?? []).filter(Boolean),
    };
    if (c.gold) {
      piece.metal = item.metal || undefined;
      piece.karat = item.productKarats || undefined;
      piece.colour = o?.productColor || undefined;
      piece.grossG = item.grossWeight || undefined;
      piece.netG = item.netWeight || undefined;
    }
    if (c.diamonds && ct > 0) {
      piece.diamondCt = ct;
      piece.diamondPcs = o?.actualDiamondPcs || undefined;
      piece.diamondShape = (o && (mainDiamondShape(d, o.id) || o.diamondShape)) || undefined;
      piece.diamondType = item.diamondType || o?.diamondType || undefined;
      piece.diamondQuality = o ? diamondQuality(d, o.id) : undefined;
      piece.diamondSize = o ? diamondSize(d, o.id) : undefined;
    }
    if (c.cad && o?.cadImage) piece.cad = o.cadImage;
    const video = item.video || o?.productVideo;
    if (c.video && video) piece.video = video;
    const price = c.prices?.[item.id];
    if (price != null && price > 0) piece.price = Math.round(price * 100) / 100;
    return piece;
  });
}

/** "18K Yellow Gold Ring" — an order's piece, named for a client. */
export function orderPieceName(o: Order): string {
  return [o.productKarats, o.metal, o.jewelleryType].filter(Boolean).join(" ") || o.jewelleryType || "Piece";
}

/** The pieces made on orders, as a client will see them — never the client, the cost or the payments. */
export function buildOrderSharePieces(d: DB, orders: Order[], c: PieceShareChoice): SharePiece[] {
  return orders.map(o => {
    const w = pieceWeights(o, d.materialIssuances ?? []);
    const piece: SharePiece = {
      id: o.id,
      name: orderPieceName(o),
      sku: o.designNumber || undefined,
      type: o.jewelleryType,
      // The piece's own photos — never the client's reference pictures unless asked for.
      photos: [...(o.productPhotos ?? []), ...(c.refs ? o.images ?? [] : [])].filter(Boolean),
    };
    if (c.gold) {
      piece.metal = o.metal || undefined;
      piece.karat = o.productKarats || undefined;
      piece.colour = o.productColor || undefined;
      piece.grossG = w.gross || undefined;
      piece.netG = w.net || undefined;
      if (w.estimated && (w.gross || w.net)) piece.weightsEstimated = true;
    }
    if (c.diamonds && w.diamondCt > 0) {
      piece.diamondCt = w.diamondCt;
      piece.diamondPcs = o.actualDiamondPcs || undefined;
      piece.diamondShape = mainDiamondShape(d, o.id) || o.diamondShape || undefined;
      piece.diamondType = o.diamondType || undefined;
      piece.diamondQuality = diamondQuality(d, o.id);
      piece.diamondSize = diamondSize(d, o.id);
    }
    if (c.cad && o.cadImage) piece.cad = o.cadImage;
    if (c.video && o.productVideo) piece.video = o.productVideo;
    const price = c.prices?.[o.id];
    if (price != null && price > 0) piece.price = Math.round(price * 100) / 100;
    return piece;
  });
}

/** Who the pieces are from — the company of the first piece. */
export function shareBrand(d: DB, items: ReadyStockItem[]): ShareBrand {
  return shareBrandOf(d, companyOf(items[0]));
}

/** Who the pieces made on orders are from — the company of the first order. */
export function shareBrandForOrders(d: DB, orders: Order[]): ShareBrand {
  return shareBrandOf(d, companyOfOrder(d, orders[0]));
}

function shareBrandOf(d: DB, companyId: string): ShareBrand {
  const b = brandFor(d.settings, companyId);
  return {
    name: [b.companyName, b.companyLegalSuffix].filter(Boolean).join(" ") || "Ready Stock",
    logo: b.companyLogoUrl || undefined,
    website: b.invoiceWebsite || undefined,
    email: b.invoiceEmail || undefined,
    phone: b.invoiceTel || undefined,
  };
}

/** A new public link for these pieces — saved before it is handed out, so the
 *  client never opens a link that isn't there yet. */
export async function createPieceShare(args: {
  pieces: SharePiece[]; brand: ShareBrand; title: string; note?: string; showPrice: boolean; createdBy: string;
}): Promise<Share> {
  const now = new Date().toISOString();
  const share: Share = {
    id: uid("shr_"), kind: "readyStock", sourceFolderId: "", title: args.title.trim() || "Ready Stock",
    items: [], count: args.pieces.length, pieces: args.pieces, brand: args.brand,
    note: args.note?.trim() || undefined, showPrice: args.showPrice,
    createdBy: args.createdBy, createdAt: now, updatedAt: now,
  };
  // Firestore refuses undefined fields; the JSON round trip leaves them out.
  await setDoc(doc(fsdb, "shares", share.id), JSON.parse(JSON.stringify(share)));
  updateDb(d => { if (!d.shares) d.shares = []; if (!d.shares.some(x => x.id === share.id)) d.shares.push(share); });
  return share;
}
