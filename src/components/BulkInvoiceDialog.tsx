import { useMemo, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { AsyncButton } from "@/components/AsyncButton";
import { loadDb, updateDb, fmtMoney, orderTotal, balanceDue, createInvoiceFromOrders, type Invoice, type Order } from "@/lib/db";
import { reserveInvoiceNumber } from "@/lib/counters";
import { planInvoice } from "@/lib/invoiceBatch";
import { FileText, Ban, AlertTriangle } from "lucide-react";
import { toast } from "sonner";

/**
 * One invoice for the pieces just ticked.
 *
 * The orders a client is billed for are the orders that went out together, and
 * those have already been picked once on this screen. Billing them meant going
 * to the Invoices page, choosing the client, and finding the same orders again
 * in a second list.
 *
 * An invoice covers one client, so a selection spanning several is refused
 * rather than split — which of the clients it belonged to would be a guess.
 */
export function BulkInvoiceDialog({ orders, onClose, onDone }: {
  orders: Order[];
  onClose: () => void;
  onDone: () => void;
}) {
  const db = loadDb();
  const [saving, setSaving] = useState(false);

  const plan = useMemo(() => planInvoice(orders, db), [orders, db]);
  const client = plan.clientId ? db.clients.find(c => c.id === plan.clientId) : undefined;
  const unpaid = plan.go.reduce((s, o) => s + balanceDue(o), 0);

  const confirm = async () => {
    if (!plan.clientId) { toast.error("An invoice covers one client — select orders from a single client"); return; }
    if (!plan.go.length) { toast.error("None of the selected orders can be invoiced"); return; }
    setSaving(true);
    try {
      // Claim the number in the database first, so two people invoicing at the
      // same moment can never be handed the same one.
      const number = await reserveInvoiceNumber(db.invoices || []);
      let created: Invoice | null = null;
      updateDb(d => {
        created = createInvoiceFromOrders(
          d, plan.clientId!, plan.go.map(o => o.id), new Date().toISOString(), number,
        );
      });
      if (created) {
        toast.success(`Invoice ${(created as Invoice).number} created — ${plan.go.length} order${plan.go.length !== 1 ? "s" : ""} · ${fmtMoney(plan.total)}`);
        onDone();
      } else {
        toast.error("Those orders are already invoiced");
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={v => { if (!v && !saving) onClose(); }}>
      <DialogContent className="max-w-lg rounded-2xl max-h-[88vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-display text-xl flex items-center gap-2">
            <FileText className="h-5 w-5 text-primary" /> Create invoice
          </DialogTitle>
        </DialogHeader>

        {plan.go.length > 0 && !plan.clientId ? (
          <div className="p-4 rounded-xl bg-destructive/5 border border-destructive/20 text-sm">
            <p className="font-semibold text-destructive mb-1">These orders belong to different clients</p>
            <p className="text-xs text-muted-foreground">
              An invoice covers one client. Narrow the selection to a single client — the
              client filter above does it in one step.
            </p>
          </div>
        ) : (
          <>
            <p className="text-xs text-muted-foreground -mt-2">
              Billing <span className="font-semibold text-foreground">{client?.companyName ?? "this client"}</span> for
              the pieces ticked. One invoice number, covering all of them.
            </p>

            <div className="rounded-xl border border-border/60 divide-y divide-border/50 text-sm">
              {plan.go.length > 0 && (
                <div className="p-3">
                  <p className="font-semibold text-brand-dark mb-1.5">{plan.go.length} order{plan.go.length !== 1 ? "s" : ""} on this invoice</p>
                  <ul className="space-y-0.5">
                    {plan.go.map(o => (
                      <li key={o.id} className="flex items-baseline justify-between gap-3 text-xs">
                        <span className="font-medium text-foreground">{o.orderNumber}</span>
                        <span className="text-muted-foreground truncate flex-1">{o.jewelleryType}{o.designNumber ? ` · #${o.designNumber}` : ""}</span>
                        <span className="font-semibold tabular-nums">{fmtMoney(orderTotal(o))}</span>
                      </li>
                    ))}
                  </ul>
                  <div className="flex items-baseline justify-between gap-3 mt-2 pt-2 border-t border-border/60">
                    <span className="text-xs font-semibold text-brand-dark">Invoice total</span>
                    <span className="font-display text-lg text-brand-dark">{fmtMoney(plan.total)}</span>
                  </div>
                </div>
              )}
              {plan.skip.length > 0 && (
                <div className="p-3">
                  <p className="font-semibold text-destructive mb-1 flex items-center gap-1.5">
                    <Ban className="h-3.5 w-3.5" /> {plan.skip.length} left off
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

            {unpaid > 0 && (
              <p className="text-xs text-muted-foreground flex items-start gap-1.5">
                <AlertTriangle className="h-3.5 w-3.5 text-amber-600 shrink-0 mt-0.5" />
                {fmtMoney(unpaid)} of this is still outstanding. The invoice is raised either
                way and marks itself paid once the orders on it are cleared.
              </p>
            )}
          </>
        )}

        <div className="flex gap-2 pt-1">
          <Button variant="outline" onClick={onClose} disabled={saving} className="flex-1 rounded-xl">Cancel</Button>
          <AsyncButton onClick={confirm} disabled={saving || !plan.clientId || !plan.go.length}
            className="btn-hero flex-1 rounded-xl">
            {saving ? "Creating…" : `Invoice ${plan.go.length || ""}`.trim()}
          </AsyncButton>
        </div>
      </DialogContent>
    </Dialog>
  );
}
