import { useState } from "react";
import { Gem, Package } from "lucide-react";
import { isDiamondOnlyOrder, orderImage, type Order } from "@/lib/db";

/**
 * An order's picture as every list shows it — the CAD, the finished photo or
 * the reference image the order was placed with; a gem or a box when there is
 * none. The same small square wherever an order is listed, for everyone who
 * can see the order.
 */
export function OrderThumb({ o, size = "md" }: { o: Order; size?: "sm" | "md" }) {
  const img = orderImage(o);
  // A picture that won't load (deleted, offline) shows the icon, never a broken image.
  const [broken, setBroken] = useState<string | null>(null);
  const box = size === "sm" ? "h-9 w-9" : "h-11 w-11";
  return (
    <div className={`${box} rounded-lg overflow-hidden bg-white ring-1 ring-border/60 shrink-0 grid place-items-center`}>
      {img && broken !== img ? <img src={img} alt="" loading="lazy" className="w-full h-full object-contain" onError={() => setBroken(img)} />
        : isDiamondOnlyOrder(o) ? <Gem className="h-4 w-4 text-sky-500/50" /> : <Package className="h-4 w-4 text-primary/30" />}
    </div>
  );
}
