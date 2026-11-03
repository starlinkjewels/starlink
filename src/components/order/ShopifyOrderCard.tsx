// On an order brought in from Shopify: what Shopify says about it (kept up to
// date by the server — shopifyOrders), where it ships, what to check before
// approving, anything changed on Shopify since, and what we sent back.
import { AlertTriangle, CheckCircle2, Clock, Copy, ExternalLink, ShoppingBag } from "lucide-react";
import { toast } from "sonner";
import type { Order } from "@/lib/db";
import { timeAgo } from "@/lib/db";
import { shipLine, shopifyAdminUrl, useShopifyJobs, useShopifyMirror } from "@/lib/shopify";

const REVIEW_WORDS: Record<string, string> = { type: "jewellery type", metal: "metal", karat: "karat", price: "price" };
const words = (s?: string | null) => (s ?? "").toLowerCase().replace(/_/g, " ");

export function ShopifyOrderCard({ order, admin }: { order: Order; admin: boolean }) {
  const s = order.shopify!;
  // What Shopify says now: admins (it holds the customer's details); everyone else sees the order as it came in.
  const m = useShopifyMirror(admin ? s.storeId : undefined, admin ? s.orderId : undefined);
  const jobs = useShopifyJobs(order.id, admin);
  const line = m?.lines.find(l => l.id === s.lineGid);
  const ship = shipLine(m?.shipTo ?? s.shipTo ?? null);
  const fulfil = jobs.find(j => j.kind === "fulfil");
  const tag = jobs.find(j => j.kind === "tag");
  const review = (s.review ?? []).filter(r => r !== "price" || !order.amount);
  const open = order.status === "Waiting" || order.status === "Approved";
  return (
    <div className="mb-4 rounded-xl border border-[#95BF47]/40 bg-[#95BF47]/5 px-4 py-3 text-sm space-y-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <ShoppingBag className="h-4 w-4 text-[#5E8E3E] shrink-0" />
        <p className="font-semibold">Shopify {s.orderName} <span className="font-normal text-muted-foreground">· {s.storeName}</span></p>
        {m && <span className="text-xs text-muted-foreground">{words(m.financialStatus)}{m.fulfillmentStatus ? ` · ${words(m.fulfillmentStatus)}` : ""}{m.test ? " · test order" : ""}</span>}
        <a href={shopifyAdminUrl(s.shop, s.orderId)} target="_blank" rel="noreferrer" className="ml-auto inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">
          Open in Shopify <ExternalLink className="h-3 w-3" /></a>
      </div>
      <p className="text-xs text-muted-foreground">
        {s.title}{s.variant ? ` · ${s.variant}` : ""}{s.sku ? ` · SKU ${s.sku}` : ""}
        {typeof s.unitPrice === "number" ? ` · customer paid ${s.currency} ${s.unitPrice.toLocaleString("en-US", { maximumFractionDigits: 2 })} each` : ""}
        {line && line.currentQuantity !== line.quantity ? ` · quantity now ${line.currentQuantity}` : ""}
      </p>
      {ship && (
        <div className="flex items-start gap-2">
          <p className="flex-1 min-w-0"><span className="text-muted-foreground text-xs">Ships to</span><br />{ship}</p>
          <button type="button" className="shrink-0 text-xs text-primary inline-flex items-center gap-1 hover:underline"
            onClick={() => { void navigator.clipboard?.writeText(ship).then(() => toast.success("Address copied"), () => undefined); }}><Copy className="h-3 w-3" />Copy</button>
        </div>
      )}
      {!ship && <p className="text-xs text-muted-foreground">No ship-to address from Shopify (none given, or the store's app may not read names and addresses — Settings → Shopify).</p>}
      {open && review.length > 0 && (
        <p className="text-xs rounded-lg bg-amber-50 border border-amber-200 text-amber-900 px-2.5 py-1.5">
          <AlertTriangle className="h-3.5 w-3.5 inline mr-1" />Check before approving: {review.map(r => REVIEW_WORDS[r] ?? r).join(", ")} — read from the product as best it could be.
        </p>
      )}
      {(m?.issues ?? []).map(i => (
        <p key={i} className="text-xs rounded-lg bg-destructive/5 border border-destructive/30 text-destructive px-2.5 py-1.5"><AlertTriangle className="h-3.5 w-3.5 inline mr-1" />{i}</p>
      ))}
      {admin && (fulfil || tag) && (
        <p className="text-xs text-muted-foreground flex flex-wrap gap-x-4 gap-y-1">
          {fulfil && <span className="inline-flex items-center gap-1">{fulfil.status === "done" ? <CheckCircle2 className="h-3.5 w-3.5 text-success" /> : <Clock className="h-3.5 w-3.5" />}
            Fulfilled on Shopify: {fulfil.status === "done" ? `yes${fulfil.doneAt ? `, ${timeAgo(fulfil.doneAt).toLowerCase()}` : ""}` : fulfil.status === "failed" ? `no — gave up: ${fulfil.error}` : fulfil.status === "retry" ? `not yet — trying again (${fulfil.error})` : "on its way"}</span>}
          {tag && <span>Stage tag: {tag.status === "done" ? `“${tag.stage}”` : tag.status === "skipped" ? "off for this store" : tag.status === "retry" || tag.status === "failed" ? `not sent (${tag.error})` : "on its way"}</span>}
        </p>
      )}
    </div>
  );
}
