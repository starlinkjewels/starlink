import { useState } from "react";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth";
import { useDb } from "@/hooks/useDb";
import { balanceDue, fmtDate, fmtMoney, invoiceOrderIds, type Order } from "@/lib/db";
import { ccy, fmtCcy } from "@/lib/currency";
import { applyIncomeToClient } from "@/lib/clientPayments";
import { RateInput } from "@/components/CurrencyFields";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

/**
 * Apply a loose income row to a client's bill — repairs a payment that was
 * typed in as a plain account entry and never reached their orders. The same
 * dialog on the Locker page and in the day book; the work is
 * src/lib/clientPayments.ts applyIncomeToClient, shared with Settings' sweep.
 */
export function ApplyToClientDialog({ txnId, onClose }: { txnId: string | null; onClose: () => void }) {
  if (!txnId) return null;
  // Keyed, so each entry opens with nothing chosen.
  return <ApplyDialog key={txnId} txnId={txnId} onClose={onClose} />;
}

function ApplyDialog({ txnId, onClose }: { txnId: string; onClose: () => void }) {
  const { user } = useAuth();
  const db = useDb();
  const [clientId, setClientId] = useState("");
  const [invoiceId, setInvoiceId] = useState("");
  const [rate, setRate] = useState<number | "">("");

  const clientsSorted = [...db.clients].sort((a, b) => a.companyName.localeCompare(b.companyName));
  const invLiveBalance = (ids: string[]) =>
    ids.map(oid => db.orders.find(o => o.id === oid))
      .filter((o): o is Order => !!o && o.status !== "Rejected")
      .reduce((s, o) => s + balanceDue(o), 0);

  const txn = db.lockerTransactions.find(t => t.id === txnId);

  const apply = async () => {
    const client = db.clients.find(c => c.id === clientId);
    if (!txn || !client) { toast.error("Choose the client this money came from"); return; }
    const res = await applyIncomeToClient({
      txnId: txn.id, clientId: client.id,
      invoiceId: invoiceId || undefined,
      exchangeRate: Number(rate) || undefined,
      userId: user!.id,
    });
    if (!res.ok) { toast.error(res.error); return; }
    toast.success(`${fmtMoney(res.settled)} applied to ${client.companyName}'s bills`);
    onClose();
  };

  return (
    <Dialog open onOpenChange={o => { if (!o) onClose(); }}>
      <DialogContent className="max-w-2xl rounded-2xl">
        <DialogHeader><DialogTitle className="font-display text-xl">Apply to a client&rsquo;s bill</DialogTitle></DialogHeader>
        {txn && (() => {
          // Read the same way applyIncomeToClient reads it, so this preview
          // and what it settles agree.
          const txnCcy = ccy(txn.currency);
          const isUsd = txnCcy === "USD";
          const r = Number(rate) || 0;
          const billed = isUsd ? txn.amountInr : (r > 0 ? txn.amountInr / r : 0);
          const invs = clientId
            ? (db.invoices ?? [])
                .filter(i => i.clientId === clientId)
                .map(i => ({ inv: i, bal: invLiveBalance(invoiceOrderIds(i)) }))
                .sort((a, b) => +new Date(b.inv.createdAt) - +new Date(a.inv.createdAt))
            : [];
          return (
            <>
              <p className="text-sm text-muted-foreground -mt-1">
                {fmtCcy(txn.amountInr, txn.currency)} received on {fmtDate(txn.createdAt)} is already counted in this locker.
                It was never applied to anyone&rsquo;s orders, which is why their invoice still shows as pending. No second
                entry is made here — only the missing allocation.
              </p>
              <div className="space-y-2.5 mt-1">
                <div>
                  <Label className="text-xs">Received from</Label>
                  <Select value={clientId} onValueChange={v => { setClientId(v); setInvoiceId(""); }}>
                    <SelectTrigger className="h-10 rounded-xl mt-1"><SelectValue placeholder="Choose the client" /></SelectTrigger>
                    <SelectContent>{clientsSorted.map(c => <SelectItem key={c.id} value={c.id}>{c.companyName}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                {clientId && (
                  <div>
                    <Label className="text-xs">Against</Label>
                    <Select value={invoiceId || "fifo"} onValueChange={v => setInvoiceId(v === "fifo" ? "" : v)}>
                      <SelectTrigger className="h-10 rounded-xl mt-1"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="fifo">Oldest bills first</SelectItem>
                        {invs.map(({ inv, bal }) => (
                          <SelectItem key={inv.id} value={inv.id}>
                            Invoice {inv.number} — {bal > 0 ? `${fmtMoney(bal)} pending` : "settled"}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
                {!isUsd && (
                  // Their bill is in dollars: this locker's currency for $1, on the day it came in.
                  <RateInput id="fix-rate" from="USD" to={txnCcy} value={rate} onChange={setRate} at={txn.createdAt} />
                )}
                {billed > 0 && <p className="text-[11px] text-muted-foreground">Settles {fmtMoney(billed)} of their billing.</p>}
              </div>
              <div className="flex gap-2 mt-4">
                <Button variant="outline" onClick={onClose} className="rounded-xl flex-1">Cancel</Button>
                <Button onClick={apply} disabled={!clientId} className="btn-hero rounded-xl flex-1">Apply</Button>
              </div>
            </>
          );
        })()}
      </DialogContent>
    </Dialog>
  );
}

/** Whether a row can be applied to a client's bill — and if not, why. `owner`:
 *  the tab a row belongs to when it is another record's money. */
export function applyBlock(t: { type: string; refType?: string; notClientPayment?: boolean }, owner?: string): string | undefined {
  if (owner) return `Recorded in ${owner} — it isn't a loose deposit`;
  if (t.notClientPayment) return "Marked as not a client payment";
  return undefined;
}
