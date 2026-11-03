// "Shopify #1001" — an order brought in from a connected Shopify store (lib/shopify.ts).
import { ShoppingBag } from "lucide-react";
import type { Order } from "@/lib/db";

export function ShopifyTag({ o, store = false }: { o: Pick<Order, "shopify">; store?: boolean }) {
  if (!o.shopify) return null;
  return (
    <span title={`From the Shopify store ${o.shopify.storeName} — order ${o.shopify.orderName}`}
      className="inline-flex items-center gap-1 rounded-full bg-[#95BF47]/15 text-[#4A7A2E] px-1.5 py-0.5 text-[10px] font-semibold whitespace-nowrap">
      <ShoppingBag className="h-3 w-3" />Shopify {o.shopify.orderName}{store ? ` · ${o.shopify.storeName}` : ""}
    </span>
  );
}
