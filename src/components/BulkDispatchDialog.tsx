import { useMemo, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { AsyncButton } from "@/components/AsyncButton";
import { loadDb, updateDb, todayLocal, fmtMoney, type Order } from "@/lib/db";
import { useAuth } from "@/lib/auth";
import { applyDispatch, planDispatch } from "@/lib/dispatch";
import { orderDispatchedEmail, sendMail } from "@/lib/email";
import { Truck, AlertTriangle, Ban } from "lucide-react";
import { toast } from "sonner";

/**
 * One parcel, one entry.
 *
 * Six pieces going out together share a courier and a tracking number, but each
 * had to be opened and typed separately. Here the details are entered once and
 * written to every piece selected — and the date is the day the parcel actually
 * left, so an entry caught up on two days later still reads true.
 *
 * Nothing is written until the sender can see exactly what will happen: which
 * pieces go, which are only having their tracking corrected, which are skipped
 * and why, and what money is still owed on any of them.
 */
export function BulkDispatchDialog({ orders, onClose, onDone }: {
  orders: Order[];
  onClose: () => void;
  onDone: () => void;
}) {
  const db = loadDb();
  const { user } = useAuth();
  const [courierName, setCourierName] = useState("");
  const [trackingNumber, setTrackingNumber] = useState("");
  const [trackingLink, setTrackingLink] = useState("");
  const [day, setDay] = useState(todayLocal());
  const [ackUnpaid, setAckUnpaid] = useState(false);
  const [saving, setSaving] = useState(false);

  const plan = useMemo(() => planDispatch(orders, db, user!), [orders, db, user]);
  const totalDue = plan.unpaid.reduce((s, u) => s + u.due, 0);
  const willWrite = plan.go.length + plan.update.length;

  const confirm = async () => {
    if (!courierName.trim()) { toast.error("Enter the courier name"); return; }
    if (!trackingNumber.trim()) { toast.error("Enter the tracking number"); return; }
    if (!willWrite) { toast.error("None of the selected orders can be dispatched"); return; }
    if (plan.unpaid.length && !ackUnpaid) {
      toast.error(`${fmtMoney(totalDue)} is still unpaid — tick the box to dispatch anyway`);
      return;
    }
    setSaving(true);
    try {
      const det = { courierName, trackingNumber, trackingLink, day };
      const me = { id: user!.id, role: user!.role, department: user!.department };
      // One save for the whole parcel, not one per piece.
      const sent: Order[] = [];
      updateDb(d => {
        for (const o of [...plan.go, ...plan.update]) {
          const what = applyDispatch(d, o.id, det, me);
          if (what === "dispatched") sent.push(o);
        }
      });
      // Only the pieces that actually went out are announced. Correcting a
      // tracking number must not email the client a second "on its way".
      for (const o of sent) {
        const client = db.clients.find(c => c.id === o.clientId);
        if (!client?.email) continue;
        const m = orderDispatchedEmail({
          orderNumber: o.orderNumber,
          clientName: client.companyName,
          jewelleryType: o.jewelleryType,
          metal: o.metal,
          quantity: o.quantity,
          expectedDelivery: o.expectedDelivery,
          courierName: courierName.trim(),
          trackingNumber: trackingNumber.trim(),
          trackingLink: trackingLink.trim() || undefined,
        });
        void sendMail(client.email, m.subject, m.html);
      }
      toast.success(
        [
          sent.length ? `${sent.length} order${sent.length !== 1 ? "s" : ""} dispatched` : "",
          plan.update.length ? `${plan.update.length} updated` : "",
          plan.skip.length ? `${plan.skip.length} skipped` : "",
        ].filter(Boolean).join(" · "),
      );
      onDone();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={v => { if (!v && !saving) onClose(); }}>
      <DialogContent className="max-w-lg rounded-2xl max-h-[88vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-display text-xl flex items-center gap-2">
            <Truck className="h-5 w-5 text-blue-500" /> Dispatch {orders.length} order{orders.length !== 1 ? "s" : ""}
          </DialogTitle>
        </DialogHeader>

        <p className="text-xs text-muted-foreground -mt-2">
          One courier and one tracking number written to every piece in this parcel.
          Each client is emailed and notified once.
        </p>

        <div className="space-y-3">
          <div className="grid sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Courier Company *</Label>
              <Input value={courierName} onChange={e => setCourierName(e.target.value)}
                className="rounded-xl h-10" placeholder="e.g. FedEx, DHL" autoFocus />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Dispatch Date *</Label>
              <Input type="date" value={day} max={todayLocal()} onChange={e => setDay(e.target.value)}
                className="rounded-xl h-10" />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label className="text-xs">Tracking Number *</Label>
              <Input value={trackingNumber} onChange={e => setTrackingNumber(e.target.value)}
                className="rounded-xl h-10 font-mono" placeholder="e.g. 1Z999AA10123456784" />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label className="text-xs">Tracking Link (optional)</Label>
              <Input value={trackingLink} onChange={e => setTrackingLink(e.target.value)}
                className="rounded-xl h-10" placeholder="https://..." type="url" />
            </div>
          </div>

          {/* ── Exactly what this will do, before it does it ── */}
          <div className="rounded-xl border border-border/60 divide-y divide-border/50 text-sm">
            {plan.go.length > 0 && (
              <div className="p-3">
                <p className="font-semibold text-brand-dark mb-1">{plan.go.length} will be dispatched</p>
                <p className="text-xs text-muted-foreground break-words">{plan.go.map(o => o.orderNumber).join(", ")}</p>
              </div>
            )}
            {plan.update.length > 0 && (
              <div className="p-3">
                <p className="font-semibold text-brand-dark mb-1">{plan.update.length} already dispatched — details corrected</p>
                <p className="text-xs text-muted-foreground break-words">{plan.update.map(o => o.orderNumber).join(", ")}</p>
                <p className="text-[11px] text-muted-foreground mt-1">No second email is sent for these.</p>
              </div>
            )}
            {plan.skip.length > 0 && (
              <div className="p-3">
                <p className="font-semibold text-destructive mb-1 flex items-center gap-1.5">
                  <Ban className="h-3.5 w-3.5" /> {plan.skip.length} skipped
                </p>
                <ul className="space-y-0.5">
                  {plan.skip.map(s => (
                    <li key={s.order.id} className="text-xs text-muted-foreground">
                      <span className="font-medium text-foreground">{s.order.orderNumber}</span> — {s.reason}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          {plan.unpaid.length > 0 && (
            <label className="flex items-start gap-2.5 p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 cursor-pointer">
              <input type="checkbox" checked={ackUnpaid} onChange={e => setAckUnpaid(e.target.checked)}
                className="mt-0.5 h-4 w-4 accent-amber-600 shrink-0" />
              <span className="text-xs">
                <span className="font-semibold text-amber-700 flex items-center gap-1.5 mb-1">
                  <AlertTriangle className="h-3.5 w-3.5" /> {fmtMoney(totalDue)} still unpaid — dispatch anyway
                </span>
                <span className="text-muted-foreground">
                  {plan.unpaid.map(u => `${u.order.orderNumber} ${fmtMoney(u.due)}`).join(" · ")}
                </span>
              </span>
            </label>
          )}
        </div>

        <div className="flex gap-2 pt-1">
          <Button variant="outline" onClick={onClose} disabled={saving} className="flex-1 rounded-xl">Cancel</Button>
          <AsyncButton onClick={confirm} disabled={saving || !willWrite} className="btn-hero flex-1 rounded-xl">
            {saving ? "Saving…" : `Dispatch ${willWrite}`}
          </AsyncButton>
        </div>
      </DialogContent>
    </Dialog>
  );
}
