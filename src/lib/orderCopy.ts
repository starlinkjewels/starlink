// Duplicate an order: the same client asks for the same thing again, with a
// change or two. New Order opens with the order's details filled in — the piece,
// the stones, the price, the charges, its photos — to be checked and placed as a
// new order. What belonged to the first order alone is never copied: its stock
// taken, its purchases, its payments, its dates and its number.
import { isDiamondOnlyOrder, type Order, type User } from "./db";
import { needsAccess } from "./actionHints";

export const COPY_PARAM = "copy";

/** Where Duplicate goes. */
export const copyHref = (o: Pick<Order, "id">) => `/orders/new?${COPY_PARAM}=${encodeURIComponent(o.id)}`;

/** Why this person can't duplicate an order, or undefined when they can. */
export function copyBlocker(user: Pick<User, "role"> | null | undefined, can: (module: "orders", action: "add") => boolean): string | undefined {
  if (!user || user.role === "client") return "Only the team can duplicate an order";
  if (user.role === "employee" && !can("orders", "add")) return needsAccess("orders", "add");
  return undefined;
}

/** What kind of order it was, for New Order's first question. */
export function copyKind(o: Order): "piece" | "loose" | "readyStock" {
  if (o.materialSourcing === "readyStock" && !o.forReadyStock) return "readyStock";
  return isDiamondOnlyOrder(o) ? "loose" : "piece";
}

const SPECIAL = "Special Stamp: ";

/** The order's own details, as New Order's form holds them. */
export function copyFields(o: Order) {
  const special = (o.stamping ?? "").startsWith(SPECIAL);
  const sp = o.stoneSpec ?? {};
  return {
    jewelleryType: o.jewelleryType as string,
    metal: o.metal as string,
    diamondType: (o.diamondType as string) || "",
    diamondShape: o.diamondShape || "",
    quantity: o.quantity || 1,
    diamondWeight: o.diamondWeight || 0,
    estimatedGrossWeight: o.estimatedGrossWeight || 0,
    estimatedNetWeight: o.estimatedNetWeight || 0,
    instructions: o.instructions ?? "",
    priority: o.priority || "Normal",
    designNumber: o.designNumber ?? "",
    productSize: o.productSize ?? "",
    productColor: o.productColor ?? "",
    productKarats: o.productKarats ?? "",
    deliveryTime: o.deliveryTime ?? "",
    rhodium: o.rhodium ?? "",
    stamping: special ? "Special Stamp" : o.stamping ?? "",
    stampingNote: special ? o.stamping!.slice(SPECIAL.length) : "",
    orderValue: o.amount || 0,
    shippingCharge: o.shippingCharge || 0,
    certificate: (o.certificate ? "yes" : "no") as "yes" | "no",
    certificateFee: o.certificate ? o.certificateFee || 0 : 0,
    stoneSpec: { shape: sp.shape || "Round", mm: sp.mm ?? "", size: sp.size ?? "", color: sp.color ?? "", clarity: sp.clarity ?? "" },
    // Whose material: a repeat of the client's piece is usually made the same way.
    csGold: !!o.clientSupplied?.gold,
    csDiamonds: !!o.clientSupplied?.diamonds,
    csLoss: o.clientSupplied?.goldLossPct != null ? String(o.clientSupplied.goldLossPct) : "",
    // An engraving is that client's own words — the copy starts without one.
    engraving: { on: false, text: "", font: o.engraving?.font ?? "block" } as { on: boolean; text: string; font: "block" | "script" },
  };
}
