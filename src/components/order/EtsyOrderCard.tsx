// On an order brought in from Etsy: what Etsy says about it (kept up to date by
// the server — etsyOrders), where it ships, what to check before approving,
// anything changed on Etsy since, and the shipment we sent back.
import { AlertTriangle, CheckCircle2, Clock, Copy, ExternalLink, Store } from "lucide-react";
import { toast } from "sonner";
import type { Order } from "@/lib/db";
import { timeAgo } from "@/lib/db";
import { etsyOrderUrl, useEtsyMirror, useEtsyShipJob } from "@/lib/etsy";
import { shipLine } from "@/lib/shopify";

const REVIEW_WORDS: Record<string, string> = { type: "jewellery type", metal: "metal", karat: "karat", price: "price" };

export function EtsyOrderCard({ order, admin }: { order: Order; admin: boolean }) {
  const s = order.etsy!;
  // What Etsy says now: admins (it holds the buyer's details); everyone else sees the order as it came in.
  const m = useEtsyMirror(admin ? s.storeId : undefined, admin ? s.receiptId : undefined);
  const job = useEtsyShipJob(s.storeId, s.receiptId, admin);
  const ship = shipLine(m?.shipTo ?? s.shipTo ?? null);
  const pieces = m?.lines.filter(l => l.orderId).length ?? 0;
  const review = (s.review ?? []).filter(r => r !== "price" || !order.amount);
  const open = order.status === "Waiting" || order.status === "Approved";
  return (
    <div className="mb-4 rounded-xl border border-[#F1641E]/35 bg-[#F1641E]/5 px-4 py-3 text-sm space-y-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <Store className="h-4 w-4 text-[#D5581A] shrink-0" />
        <p className="font-semibold">Etsy {s.receiptName} <span className="font-normal text-muted-foreground">· {s.storeName}</span></p>
        {m && <span className="text-xs text-muted-foreground">{(m.status ?? "").toLowerCase()}{m.shipped ? " · shipped" : ""}</span>}
        <a href={etsyOrderUrl(s.receiptId)} target="_blank" rel="noreferrer" className="ml-auto inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">
          Open in Etsy <ExternalLink className="h-3 w-3" /></a>
      </div>
      <p className="text-xs text-muted-foreground">
        {s.title}{s.variant ? ` · ${s.variant}` : ""}{s.sku ? ` · SKU ${s.sku}` : ""}
        {typeof s.unitPrice === "number" ? ` · buyer paid ${s.currency} ${s.unitPrice.toLocaleString("en-US", { maximumFractionDigits: 2 })} each` : ""}
        {pieces > 1 ? ` · one of ${pieces} pieces in this Etsy order` : ""}
      </p>
      {ship && (
        <div className="flex items-start gap-2">
          <p className="flex-1 min-w-0"><span className="text-muted-foreground text-xs">Ships to</span><br />{ship}</p>
          <button type="button" className="shrink-0 text-xs text-primary inline-flex items-center gap-1 hover:underline"
            onClick={() => { void navigator.clipboard?.writeText(ship).then(() => toast.success("Address copied"), () => undefined); }}><Copy className="h-3 w-3" />Copy</button>
        </div>
      )}
      {open && review.length > 0 && (
        <p className="text-xs rounded-lg bg-amber-50 border border-amber-200 text-amber-900 px-2.5 py-1.5">
          <AlertTriangle className="h-3.5 w-3.5 inline mr-1" />Check before approving: {review.map(r => REVIEW_WORDS[r] ?? r).join(", ")} — read from the listing as best it could be.
        </p>
      )}
      {(m?.issues ?? []).map(i => (
        <p key={i} className="text-xs rounded-lg bg-destructive/5 border border-destructive/30 text-destructive px-2.5 py-1.5"><AlertTriangle className="h-3.5 w-3.5 inline mr-1" />{i}</p>
      ))}
      {admin && job && (
        <p className="text-xs text-muted-foreground inline-flex items-center gap-1">
          {job.status === "done" ? <CheckCircle2 className="h-3.5 w-3.5 text-success" /> : <Clock className="h-3.5 w-3.5" />}
          Shipped on Etsy: {job.status === "done" ? `${job.result === "already" ? "already marked on Etsy" : "yes, with the tracking"}${job.doneAt ? `, ${timeAgo(job.doneAt).toLowerCase()}` : ""}`
            : job.status === "waiting" ? "waiting — sent once every piece of this Etsy order is dispatched"
            : job.status === "failed" ? `no — ${job.error}` : job.status === "retry" ? `not yet — trying again (${job.error})` : job.status === "skipped" ? `not sent (${job.result})` : "on its way"}
        </p>
      )}
    </div>
  );
}
