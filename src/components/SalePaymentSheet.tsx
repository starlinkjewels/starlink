import { useEffect, useState } from "react";
import { HandCoins } from "lucide-react";
import { toast } from "sonner";
import { todayLocal, stampFor, type DiamondSale } from "@/lib/db";
import { useDb } from "@/hooks/useDb";
import { useAuth } from "@/lib/auth";
import { lockerBalance } from "@/lib/manufacturing";
import { fmtCcy } from "@/lib/currency";
import { receiveSalePayment, removeSalePayment, saleBuyer, saleCcy, saleOwed, salePaymentRows, saleTotal } from "@/lib/diamondSalePay";
import { useCan } from "@/hooks/useCan";
import { needsAccess } from "@/lib/actionHints";
import { ccy } from "@/lib/currency";
import { confirmBox } from "@/lib/confirm";
import { fmtDate } from "@/lib/db";
import { Trash2 } from "lucide-react";
import { ActionSheet } from "@/components/ActionSheet";
import { AsyncButton } from "@/components/AsyncButton";
import { Field, PanelActions, Stat, Stats, UnitInput } from "@/components/BillLayout";
import { AddNewItem, useAddNew } from "@/components/create/QuickCreate";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

/**
 * Money received for a diamond sold on credit ("Not received yet"): all of
 * what is owed or a part, into an account in the sale's currency. It shows on
 * the sale, in that account's history, and on the client's page.
 */
export function SalePaymentSheet({ sale, onClose }: { sale: DiamondSale | null; onClose: () => void }) {
  const db = useDb();
  const { user } = useAuth();
  const addNew = useAddNew();
  const can = useCan();
  // Taking money back out of an account is a delete.
  const mayRemove = can("payments", "delete");
  const [amount, setAmount] = useState("");
  const [lockerId, setLockerId] = useState("");
  const [date, setDate] = useState(todayLocal());
  const [note, setNote] = useState("");
  useEffect(() => { if (sale) { setAmount(""); setLockerId(""); setDate(todayLocal()); setNote(""); } }, [sale?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const live = sale ? (db.diamondSales ?? []).find(s => s.id === sale.id) ?? sale : null;
  const cur = live ? saleCcy(live) : "INR";
  const owed = live ? saleOwed(db.lockerTransactions, live) : 0;
  const rows = live ? salePaymentRows(db.lockerTransactions, live) : [];
  const lockers = db.lockers.filter(l => l.active !== false && ccy(l.currency) === cur);
  const typed = amount.trim() === "" ? owed : Number(amount) || 0;

  const save = () => {
    if (!live) return;
    if (!lockerId) { toast.error("Choose the account the money went into"); return; }
    const problem = receiveSalePayment({ saleId: live.id, amount: typed, lockerId, at: stampFor(date), note, userId: user!.id });
    if (problem) { toast.error(problem); return; }
    toast.success(`${fmtCcy(typed, cur)} received from ${saleBuyer(db, live)}`);
    onClose();
  };

  return (
    <ActionSheet open={!!sale} onOpenChange={o => { if (!o) onClose(); }} size="md" icon={HandCoins} title="Receive payment"
      description={live ? `${live.carat}ct ${live.kind === "certified" ? "certified " : ""}${live.shape} sold to ${saleBuyer(db, live)}` : ""}
      footer={(
        <div className="space-y-3">
          <Stats>
            <Stat label="Sale" value={live ? fmtCcy(saleTotal(live), cur) : "—"} />
            <Stat big label="Receiving" value={typed > 0 ? fmtCcy(typed, cur) : "—"} />
            <Stat label="Still owed after" value={fmtCcy(Math.max(0, owed - typed), cur)} />
          </Stats>
          <PanelActions onCancel={onClose}>
            <AsyncButton onClick={save} className="btn-hero rounded-xl h-11 flex-1 sm:flex-none sm:min-w-48">Record payment</AsyncButton>
          </PanelActions>
        </div>
      )}>
      <div className="grid grid-cols-2 gap-3">
        <p className="col-span-2 text-sm text-muted-foreground">Owed now: <span className="font-semibold text-foreground">{fmtCcy(owed, cur)}</span></p>
        <Field label={`Amount (${cur})`} hint="Blank = all of it">{id => (
          <UnitInput id={id} min={0} unit={cur === "USD" ? "$" : "₹"} value={amount} placeholder={String(owed)} onChange={e => setAmount(e.target.value)} />
        )}</Field>
        <Field label="Date">{id => <Input id={id} type="date" value={date} onChange={e => setDate(e.target.value)} className="rounded-xl h-10" />}</Field>
        <Field label="Into account *" className="col-span-2">{id => (
          <Select value={lockerId} onValueChange={addNew("locker", setLockerId)}>
            <SelectTrigger id={id} className="h-10 rounded-xl"><SelectValue placeholder={`Choose the ${cur} account`} /></SelectTrigger>
            <SelectContent>
              {lockers.map(l => <SelectItem key={l.id} value={l.id}>{l.name}{l.type === "bank" && l.accountNumberLast4 ? ` ····${l.accountNumberLast4}` : ""} · {fmtCcy(lockerBalance(l, db.lockerTransactions), l.currency)}</SelectItem>)}
              <AddNewItem kind="locker" />
            </SelectContent>
          </Select>
        )}</Field>
        <Field label="Note" className="col-span-2">{id => <Input id={id} value={note} onChange={e => setNote(e.target.value)} className="rounded-xl h-10" placeholder="Optional — bank ref, cheque no." />}</Field>
        {/* What has come in so far — one taken by mistake comes back off here, out of its account too. */}
        {rows.length > 0 && live && (
          <div className="col-span-2">
            <p className="text-xs font-semibold text-brand-dark mb-1.5">Received so far</p>
            <ul className="rounded-xl border border-border/60 divide-y divide-border/50 bg-white">
              {rows.map(pay => (
                <li key={pay.id} className="flex items-center gap-3 px-3 py-2 text-sm">
                  <span className="tabular-nums text-muted-foreground shrink-0">{fmtDate(pay.createdAt)}</span>
                  <span className="flex-1 min-w-0 truncate">{db.lockers.find(l => l.id === pay.lockerId)?.name ?? "Account"}</span>
                  <span className="font-semibold tabular-nums shrink-0">{fmtCcy(pay.amountInr, cur)}</span>
                  <button type="button" aria-label="Remove this payment" title={mayRemove ? "Remove this payment" : needsAccess("payments", "delete")} disabled={!mayRemove}
                    onClick={async () => {
                      const acct = db.lockers.find(l => l.id === pay.lockerId)?.name ?? "its account";
                      if (!(await confirmBox(`Remove this payment of ${fmtCcy(pay.amountInr, cur)}?

• it comes out of ${acct}
• the buyer owes it again`))) return;
                      if (removeSalePayment(live.id, pay.id)) toast.success("Payment removed"); else toast.error("That payment is no longer there");
                    }}
                    className="h-8 w-8 grid place-items-center rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 shrink-0 disabled:opacity-40 disabled:pointer-events-none"><Trash2 className="h-4 w-4" /></button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </ActionSheet>
  );
}
