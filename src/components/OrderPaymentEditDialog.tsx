import { useState } from "react";
import { Wallet } from "lucide-react";
import { toast } from "sonner";
import { balanceDue, fmtMoney, type AdvancePayment, type Order } from "@/lib/db";
import { useDb } from "@/hooks/useDb";
import { useAuth } from "@/lib/auth";
import { ccy, ccySymbol, roundCcy } from "@/lib/currency";
import { editOrderPayment, orderPaymentEditBlocker, paymentReceipt } from "@/lib/orderPaymentEdit";
import { ActionSheet } from "@/components/ActionSheet";
import { AsyncButton } from "@/components/AsyncButton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const NONE = "__none";

/**
 * Correct a payment taken on this order: the amount, the day, the note, and
 * which account it landed in. The payment, its receipt and its deposit are
 * corrected together (lib/orderPaymentEdit.ts); the receipt number stays.
 */
export function OrderPaymentEditDialog({ order, advance, onClose }: { order: Order; advance: AdvancePayment; onClose: () => void }) {
  const db = useDb();
  const { user } = useAuth();
  const { rec } = paymentReceipt(db, advance);
  const blocked = orderPaymentEditBlocker(db, order, advance);
  const [amount, setAmount] = useState(String(advance.amount));
  const [date, setDate] = useState(advance.createdAt.slice(0, 10));
  const [note, setNote] = useState(advance.note);
  const [lockerId, setLockerId] = useState(rec?.lockerId ?? advance.lockerId ?? "");
  const [deposited, setDeposited] = useState(String(rec?.lockerAmount ?? advance.lockerAmount ?? ""));
  const locker = db.lockers.find(l => l.id === lockerId);
  const lc = ccy(locker?.currency);
  const amt = Number(amount) || 0;
  const room = Math.round((balanceDue(order) + advance.amount) * 100) / 100;

  const pickLocker = (v: string) => {
    const id = v === NONE ? "" : v;
    const next = db.lockers.find(l => l.id === id);
    // A figure typed for an account in another currency means nothing in this one.
    if (!next || ccy(next.currency) !== lc) setDeposited(next && ccy(next.currency) === "USD" ? amount : "");
    setLockerId(id);
  };

  const save = () => {
    if (!(amt > 0)) { toast.error("Enter the amount received"); return; }
    if (!date) { toast.error("Pick the day it came in"); return; }
    if (!note.trim()) { toast.error("Say what the payment was — e.g. Cash, Bank transfer"); return; }
    const dep = locker ? (lc === "USD" ? amt : Number(deposited) || 0) : undefined;
    if (locker && !(dep! > 0)) { toast.error(`Enter what actually landed in ${locker.name}`); return; }
    try {
      const toCredit = editOrderPayment(order.id, advance.id, {
        amountUsd: amt,
        // Keep the original time of day, so the day's entries stay in order.
        date: `${date}T${advance.createdAt.slice(11) || "00:00:00.000Z"}`,
        note: note.trim(),
        lockerId: locker?.id,
        lockerAmount: locker ? roundCcy(dep!, lc) : undefined,
        exchangeRate: locker && lc !== "USD" ? Math.round((dep! / amt) * 10000) / 10000 : undefined,
        userId: user!.id,
      });
      toast.success(`Receipt ${rec?.receiptNo ?? ""} corrected${toCredit > 0 ? ` — ${fmtMoney(toCredit)} over the balance went to the client's credit` : ""}`);
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't correct this payment");
    }
  };

  return (
    <ActionSheet open onOpenChange={o => { if (!o) onClose(); }} icon={Wallet}
      title={`Correct payment${rec ? ` · receipt ${rec.receiptNo}` : ""}`}
      description="The payment on this order, its receipt and its deposit are corrected together. The receipt keeps its number."
      footer={
        <div className="flex items-center justify-end gap-2">
          <Button variant="outline" onClick={onClose} className="rounded-xl">Cancel</Button>
          <AsyncButton onClick={save} disabled={!!blocked} className="btn-hero rounded-xl px-6">Save</AsyncButton>
        </div>
      }>
      <div className="space-y-4">
        {blocked && <p className="rounded-lg bg-secondary/60 px-3 py-2 text-xs text-muted-foreground">{blocked}</p>}
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label className="text-xs" htmlFor="pay_amt">Amount received ($)</Label>
            <Input id="pay_amt" type="number" min={0} step="0.01" value={amount} onChange={e => setAmount(e.target.value)} disabled={!!blocked} className="h-10 rounded-xl" />
            {amt > room && <p className="text-[11px] text-amber-700">Only {fmtMoney(room)} is due on this order — the other {fmtMoney(Math.round((amt - room) * 100) / 100)} goes to the client's credit.</p>}
          </div>
          <div className="space-y-1">
            <Label className="text-xs" htmlFor="pay_date">Date</Label>
            <Input id="pay_date" type="date" value={date} onChange={e => setDate(e.target.value)} disabled={!!blocked} className="h-10 rounded-xl" />
          </div>
          <div className="space-y-1 col-span-2">
            <Label className="text-xs" htmlFor="pay_note">Payment note</Label>
            <Input id="pay_note" value={note} onChange={e => setNote(e.target.value)} disabled={!!blocked} placeholder="e.g. Cash, Bank transfer, Cheque #" className="h-10 rounded-xl" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Deposited to</Label>
            <Select value={lockerId || NONE} onValueChange={pickLocker} disabled={!!blocked}>
              <SelectTrigger className="h-10 rounded-xl"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>No account</SelectItem>
                {db.lockers.filter(l => l.active !== false || l.id === lockerId).map(l => <SelectItem key={l.id} value={l.id}>{l.name} ({ccy(l.currency)})</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          {locker && lc !== "USD" && (
            <div className="space-y-1">
              <Label className="text-xs" htmlFor="pay_dep">Amount deposited ({ccySymbol(lc).trim()})</Label>
              <Input id="pay_dep" type="number" min={0} step="0.01" value={deposited} onChange={e => setDeposited(e.target.value)} disabled={!!blocked} className="h-10 rounded-xl" />
            </div>
          )}
        </div>
        {!lockerId && rec?.lockerId && <p className="text-[11px] text-amber-700">Its deposit will be taken off {db.lockers.find(l => l.id === rec.lockerId)?.name ?? "the account"}.</p>}
      </div>
    </ActionSheet>
  );
}
