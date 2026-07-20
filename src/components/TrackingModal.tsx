import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { StatusBadge } from "@/components/StatusBadge";
import { fmtDate, type Order } from "@/lib/db";
import { CheckCircle2, Circle, ExternalLink, Loader2, Truck } from "lucide-react";

interface Props {
  order: Order | null;
  onClose: () => void;
}

export function TrackingModal({ order, onClose }: Props) {
  if (!order) return null;
  const progress = Math.round(order.timeline.filter(t => t.status === "done").length / order.timeline.length * 100);

  return (
    <Dialog open={!!order} onOpenChange={v => { if (!v) onClose(); }}>
      <DialogContent className="max-w-md rounded-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-display text-2xl flex items-center gap-2 flex-wrap">
            {order.orderNumber} <StatusBadge status={order.status} />
          </DialogTitle>
        </DialogHeader>

        <div>
          <div className="h-1.5 rounded-full bg-secondary overflow-hidden">
            <div className="h-full bg-gradient-to-r from-primary to-brand-light transition-all" style={{ width: `${progress}%` }} />
          </div>
          <div className="flex items-center justify-between mt-1.5 text-xs text-muted-foreground">
            <span>{progress}% complete</span>
            <span>Due {fmtDate(order.expectedDelivery)}</span>
          </div>
        </div>

        {order.courierName && (
          <div className="flex items-center gap-3 p-3 rounded-xl bg-secondary/50 border border-border/60">
            <div className="h-9 w-9 rounded-xl bg-primary/10 grid place-items-center shrink-0">
              <Truck className="h-4.5 w-4.5 text-primary" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs text-muted-foreground">Shipped via {order.courierName}</p>
              <p className="font-mono text-sm font-semibold truncate">{order.trackingNumber}</p>
              {order.trackingLink && (
                <a
                  href={order.trackingLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-xs text-primary hover:underline mt-0.5"
                >
                  <ExternalLink className="h-3 w-3" /> Track Shipment
                </a>
              )}
            </div>
          </div>
        )}

        <div className="relative pl-8 space-y-3 mt-1">
          <div className="absolute left-3 top-2 bottom-2 w-0.5 bg-border" />
          {order.timeline.map((t, idx) => {
            const isDone = t.status === "done";
            const isActive = t.status === "in_progress";
            return (
              <div key={idx} className="relative">
                <div className={`absolute -left-8 top-0.5 h-6 w-6 rounded-full grid place-items-center border-2 ${isDone ? "bg-success border-success text-white" : isActive ? "bg-primary border-primary text-white" : "bg-white border-border text-muted-foreground"}`}>
                  {isDone ? <CheckCircle2 className="h-3.5 w-3.5" /> : isActive ? <Loader2 className="h-3 w-3 animate-spin" /> : <Circle className="h-2 w-2" />}
                </div>
                <p className={`text-sm ${isDone || isActive ? "text-foreground font-medium" : "text-muted-foreground"}`}>{t.step}</p>
                {t.date && <p className="text-xs text-muted-foreground">{new Date(t.date).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</p>}
              </div>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
}
