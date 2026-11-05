// Design Studio → By Order as products: the pieces made on orders, by category
// (the jewellery type) and design (its design number, else its order number) —
// each with the catalogue's product page: its pictures (photos, CAD, video), its
// details read off the order (lib/pure/orderSpecs.ts) and its price for the
// options chosen. What a piece is, never what it cost or whose it was: no
// client, no labour, no margin is carried here.
import type { DB, Order, SharedOrderProduct, ShareItem } from "./db";
import { orderSpecs, specsLine, type OrderSpecs } from "./pure/orderSpecs";
import { METAL_LABEL } from "./pure/pricing";

export interface OrderProduct {
  /** Its place in the address: category and design. */
  category: string;
  design: string;
  /** The orders it was made on, the one its details come from first. */
  orders: Order[];
  main: Order;
  specs: OrderSpecs;
  /** "14K gold · 3.6 g · 1.58 ct" */
  line: string;
  photos: string[];
  cads: string[];
  videos: string[];
  cover?: string;
}

export const designOf = (o: Pick<Order, "designNumber" | "orderNumber">) => (o.designNumber || o.orderNumber || "Unlabelled").trim();
export const categoryOfOrder = (o: Pick<Order, "jewelleryType">) => (o.jewelleryType || "Other").trim() || "Other";
const hasMedia = (o: Order) => (o.productPhotos?.length ?? 0) > 0 || !!o.productVideo || !!o.cadImage;
/** Made and approved: its weights are the piece's own, not an estimate. */
const approved = (o: Order) => o.timeline?.some(t => t.step === "Final Approval" && t.status === "done");

/** The orders' pieces that have pictures, by category, each category's designs in order of their names. */
export function orderProducts(db: Pick<DB, "materialIssuances" | "diamondPackets">, orders: Order[]): Map<string, OrderProduct[]> {
  const byDesign = new Map<string, Order[]>();
  for (const o of orders.filter(hasMedia)) {
    const k = `${categoryOfOrder(o)}\u0000${designOf(o)}`;
    byDesign.set(k, [...(byDesign.get(k) ?? []), o]);
  }
  const out = new Map<string, OrderProduct[]>();
  for (const [k, list] of byDesign) {
    const [category, design] = k.split("\u0000");
    // Its details from the latest approved order (the piece as made), else the latest.
    const sorted = [...list].sort((a, b) => Number(!!approved(b)) - Number(!!approved(a)) || String(b.createdAt ?? "").localeCompare(String(a.createdAt ?? "")));
    const main = sorted[0];
    const specs = orderSpecs(main, db.materialIssuances ?? [], db.diamondPackets ?? []);
    const uniq = (xs: (string | undefined)[]) => [...new Set(xs.filter((x): x is string => !!x))];
    const photos = uniq(sorted.flatMap(o => o.productPhotos ?? []));
    const cads = uniq(sorted.map(o => o.cadImage));
    const videos = uniq(sorted.map(o => o.productVideo));
    out.set(category, [...(out.get(category) ?? []), {
      category, design, orders: sorted, main, specs, line: specsLine(specs, METAL_LABEL), photos, cads, videos, cover: photos[0] ?? cads[0],
    }]);
  }
  for (const list of out.values()) list.sort((a, b) => a.design.localeCompare(b.design, undefined, { numeric: true }));
  return new Map([...out.entries()].sort((a, b) => a[0].localeCompare(b[0])));
}

/** A piece as a link keeps it: its details and pictures — nothing else of its orders. */
export function sharedProduct(p: OrderProduct, maxPictures = 12): SharedOrderProduct {
  const pics = [...p.photos, ...p.cads].slice(0, maxPictures);
  return {
    title: p.design, category: p.category, line: p.line || undefined,
    specs: { metal: p.specs.metal, stones: p.specs.stones, ...(p.specs.stoneTotals ? { stoneTotals: p.specs.stoneTotals } : {}), ...(p.specs.ringSize ? { ringSize: p.specs.ringSize } : {}) },
    items: pics.map((url, i) => ({ type: "image", url, name: `${p.design}-${i + 1}` }) as ShareItem),
    ...(p.videos.length ? { videos: p.videos.slice(0, 3) } : {}),
  };
}
