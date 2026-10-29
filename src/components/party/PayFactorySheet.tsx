import { useEffect, useState } from "react";
import { toast } from "sonner";
import { CreditCard } from "lucide-react";
import { updateDb, todayLocal, stampFor } from "@/lib/db";
import { useDb } from "@/hooks/useDb";
import { useAuth } from "@/lib/auth";
import { useCan } from "@/hooks/useCan";
import { useLoaded } from "@/hooks/useLoaded";
import { ccy } from "@/lib/currency";
import { factoryAccount, fmtMoneyInr, lockerBalance } from "@/lib/manufacturing";
import { needsAccess } from "@/lib/actionHints";
import { confirmBox } from "@/lib/confirm";
import { writeFactoryPayment } from "@/lib/partyPayments";
import { lastPayLocker, rememberPayLocker } from "@/components/party/payLocker";
import { ActionSheet } from "@/components/ActionSheet";
import { AsyncButton } from "@/components/AsyncButton";
import { AddNewItem, useAddNew } from "@/components/create/QuickCreate";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

/**
 * Everything a payment to a factory reads: its jobs (the money settles the
 * oldest first), its advances (what is owed is net of them) and the accounts'
 * entries (a balance before the money leaves). The Factories list is light and
 * has none of them, so the panel waits for them rather than paying against an
 * empty book — oldest-first over no jobs would park the whole sum as an advance.
 */
const NEEDS = ["materialIssuances", "factoryPayments", "lockerTransactions"] as const;

/**
 * Pay a factory's labour in one go, from a rupee account, oldest jobs first.
 * The same entry the Locker's "Record entry" makes for a factory
 * (lib/partyPayments.ts writeFactoryPayment with "__fifo"), so it shows in the
 * factory's ledger and in the Locker exactly as one made there; corrected there.
 */
export function PayFactorySheet({ factoryId, open, onOpenChange }: {
  factoryId: string; open: boolean; onOpenChange: (open: boolean) => void;
}) {
  const db = useDb();
  const { user } = useAuth();
  const can = useCan();
  const addNew = useAddNew();
  const ready = useLoaded(open ? NEEDS : []);
  const factory = db.factories.find(f => f.id === factoryId);
  const lockers = db.lockers.filter(l => l.active !== false && ccy(l.currency) === "INR");

  const [lockerId, setLockerId] = useState("");
  const [amount, setAmount] = useState("");
  const [typed, setTyped] = useState(false);
  const [date, setDate] = useState(todayLocal());
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  // The whole factory's labour — every company's jobs, its opening balance and
  // advances — as the Locker's form reads it.
  const acc = factory && ready
    ? factoryAccount(db.materialIssuances.filter(i => i.factoryId === factory.id), factory, (db.factoryPayments ?? []).filter(x => x.factoryId === factory.id))
    : null;
  const owed = acc?.chargesPending ?? 0;

  // A fresh form each time it opens, on the account last paid from.
  useEffect(() => {
    if (!open) return;
    const last = lastPayLocker(user?.id);
    setLockerId(lockers.some(l => l.id === last) ? last : "");
    setAmount(""); setTyped(false); setDate(todayLocal()); setNote("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  // What is owed, once the books are here — unless something was typed first.
  useEffect(() => {
    if (open && ready && !typed) setAmount(owed > 0 ? String(owed) : "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, ready, owed]);

  if (!factory) return null;
  const locker = lockers.find(l => l.id === lockerId);
  const amt = Number(amount) || 0;
  const allowed = user?.role === "admin" || can("payments", "add");

  const save = async () => {
    if (!allowed) { toast.error(needsAccess("payments", "add")); return; }
    if (!ready) { toast.error("Still loading the factory's jobs — try again in a moment"); return; }
    if (!locker) { toast.error("Choose the account it is paid from"); return; }
    if (!(amt > 0)) { toast.error("Enter the amount"); return; }
    if (!date) { toast.error("Choose the date"); return; }
    if (date > todayLocal()) { toast.error("A payment can't be dated after today"); return; }
    const bal = lockerBalance(locker, db.lockerTransactions);
    if (amt > bal && !(await confirmBox(`${fmtMoneyInr(amt)} is more than ${locker.name}'s balance of ${fmtMoneyInr(bal)}.\n\nThe balance will go negative — continue only if a deposit is still missing.`))) return;
    if (amt > owed + 0.5 && !(await confirmBox(`${fmtMoneyInr(amt)} is more than the ${fmtMoneyInr(owed)} owed to ${factory.name}.\n\nThe rest stays with them as money paid ahead — continue?`))) return;
    setSaving(true);
    try {
      let found = false;
      updateDb(d => {
        // Looked up again on the live records: the factory may have gone while the panel was open.
        if (!d.factories.some(f => f.id === factory.id) || !d.lockers.some(l => l.id === locker.id)) return;
        found = true;
        writeFactoryPayment(d, { lockerId: locker.id, amount: amt, note, userId: user!.id, at: stampFor(date), factoryId: factory.id, target: "__fifo" });
      });
      if (!found) { toast.error("That factory or account couldn't be found — nothing was recorded"); return; }
      rememberPayLocker(user?.id, locker.id);
      toast.success(`${fmtMoneyInr(amt)} paid to ${factory.name}`);
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't save — nothing was recorded");
    } finally { setSaving(false); }
  };

  const field = "h-10 rounded-xl mt-1";
  return (
    <ActionSheet open={open} onOpenChange={onOpenChange} size="md" icon={CreditCard}
      title={`Pay ${factory.name}`}
      description={!ready ? "Loading…" : owed > 0 ? `Labour owed ${fmtMoneyInr(owed)} · oldest jobs first` : acc && acc.chargesOverpaid > 0 ? `Nothing owed · ${fmtMoneyInr(acc.chargesOverpaid)} paid ahead` : "Nothing owed"}
      footer={
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground">Paying</p>
            <p className="text-lg font-semibold text-foreground tabular-nums leading-tight whitespace-nowrap">{fmtMoneyInr(amt)}</p>
            {locker && <p className="text-[11px] text-muted-foreground truncate">{locker.name} holds {fmtMoneyInr(lockerBalance(locker, db.lockerTransactions))}</p>}
          </div>
          <div className="flex gap-2.5 ml-auto">
            <Button variant="outline" onClick={() => onOpenChange(false)} className="rounded-xl h-10">Cancel</Button>
            <AsyncButton onClick={save} disabled={saving || !ready || !allowed} className="btn-hero rounded-xl h-10 px-6">{saving ? "Saving…" : "Save"}</AsyncButton>
          </div>
        </div>
      }>
      <div className="space-y-4">
        <div>
          <Label className="text-xs">From account</Label>
          <Select value={lockerId} onValueChange={addNew("locker", setLockerId)}>
            <SelectTrigger className={field} aria-label="From account"><SelectValue placeholder={lockers.length ? "Choose a rupee account" : "No rupee account"} /></SelectTrigger>
            <SelectContent>{lockers.map(l => <SelectItem key={l.id} value={l.id}>{l.name} · {fmtMoneyInr(lockerBalance(l, db.lockerTransactions))}</SelectItem>)}<AddNewItem kind="locker" /></SelectContent>
          </Select>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label className="text-xs">Amount (₹)</Label>
            <Input type="number" min={0} step="0.01" inputMode="decimal" value={amount} onChange={e => { setAmount(e.target.value); setTyped(true); }}
              className={field} placeholder="0" aria-label="Amount" />
          </div>
          <div>
            <Label className="text-xs">Date</Label>
            <Input type="date" value={date} max={todayLocal()} onChange={e => setDate(e.target.value)} className={field} aria-label="Date" />
          </div>
        </div>
        {owed > 0 && amt !== owed && (
          <button type="button" onClick={() => { setAmount(String(owed)); setTyped(true); }}
            className="-mt-2 inline-flex items-center h-7 px-2.5 rounded-full border border-primary/30 bg-primary/5 text-xs font-medium text-primary hover:bg-primary/10">
            Full amount · {fmtMoneyInr(owed)}
          </button>
        )}
        <div>
          <Label className="text-xs">Note</Label>
          <Input value={note} onChange={e => setNote(e.target.value)} className={field} placeholder="Optional — bank ref, cheque no." aria-label="Note" />
        </div>
        <p className="text-[11px] text-muted-foreground">Settles their oldest unpaid jobs first; anything over what is owed stays with them as paid ahead. To pay one job, use its Pay on the factory's page.</p>
        {!allowed && <p className="text-[11px] text-muted-foreground">{needsAccess("payments", "add")}</p>}
      </div>
    </ActionSheet>
  );
}
