// "Shopify #1001" / "Etsy #3456789012" — an order brought in from a connected
// Shopify store (lib/shopify.ts) or Etsy shop (lib/etsy.ts).
import { ShoppingBag, Store } from "lucide-react";
import type { Order } from "@/lib/db";

export function ShopifyTag({ o, store = false }: { o: Pick<Order, "shopify" | "etsy">; store?: boolean }) {
  if (o.etsy) return (
    <span title={`From the Etsy shop ${o.etsy.storeName} — order ${o.etsy.receiptName}`}
      className="inline-flex items-center gap-1 rounded-full bg-[#F1641E]/12 text-[#B5410F] px-1.5 py-0.5 text-[10px] font-semibold whitespace-nowrap">
      <Store className="h-3 w-3" />Etsy {o.etsy.receiptName}{store ? ` · ${o.etsy.storeName}` : ""}
    </span>
  );
  if (!o.shopify) return null;
  return (
    <span title={`From the Shopify store ${o.shopify.storeName} — order ${o.shopify.orderName}`}
      className="inline-flex items-center gap-1 rounded-full bg-[#95BF47]/15 text-[#4A7A2E] px-1.5 py-0.5 text-[10px] font-semibold whitespace-nowrap">
      <ShoppingBag className="h-3 w-3" />Shopify {o.shopify.orderName}{store ? ` · ${o.shopify.storeName}` : ""}
    </span>
  );
}
