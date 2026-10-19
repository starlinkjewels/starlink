import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Handshake } from "lucide-react";
import { updateDb, uid, todayLocal, stampFor } from "@/lib/db";
import { useDb } from "@/hooks/useDb";
import { useAuth } from "@/lib/auth";
import { brokerAccount } from "@/lib/brokers";
import { fmtMoneyInr, lockerBalance } from "@/lib/manufacturing";
import { ccy } from "@/lib/currency";
import { confirmBox } from "@/lib/confirm";
import { ActionSheet } from "@/components/ActionSheet";
import { AddNewItem, useAddNew } from "@/components/create/QuickCreate";
import { AsyncButton } from "@/components/AsyncButton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

/**
 * Pay a broker their brokerage — from Payments → Pay ▾ → Pay a broker, or a
 * broker's ⋯ on Suppliers → Brokers. One account entry (money out, tagged to
 * the broker), so it shows in the day book and the account's ledger, and the
 * broker's due comes down by it (lib/brokers.ts).
 */
export function PayBrokerSheet({ open, onOpenChange, brokerId: fixedId }: {
  open: boolean; onOpenChange: (v: boolean) => void;
  /** Paying this broker; absent = chosen in the form. */
  brokerId?: string;
}) {
  const db = useDb();
  const { user } = useAuth();
  const addNew = useAddNew();
  const [brokerId, setBrokerId] = useState(fixedId ?? "");
  const [amount, setAmount] = useState("");
  const [lockerId, setLockerId] = useState("");
  const [note, setNote] = useState("");
  const [date, setDate] = useState(todayLocal());
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (open) setBrokerId(fixedId ?? ""); }, [open, fixedId]);

  const brokers = (db.brokers ?? []).filter(b => b.active !== false || b.id === brokerId).sort((a, b) => a.name.localeCompare(b.name));
  const broker = (db.brokers ?? []).find(b => b.id === brokerId);
  const account = broker ? brokerAccount(db, broker) : null;
  // Brokerage is in rupees, like the bills it is worked out on.
  const lockers = db.lockers.filter(l => l.active !== false && ccy(l.currency) === "INR");
  const amt = Number(amount) || 0;

  const reset = () => { setAmount(""); setLockerId(""); setNote(""); setDate(todayLocal()); if (!fixedId) setBrokerId(""); };

  const save = async () => {
    if (!broker) { toast.error("Choose the broker"); return; }
    if (!(amt > 0)) { toast.error("Enter the amount paid"); return; }
    const locker = db.lockers.find(l => l.id === lockerId);
    if (!locker) { toast.error("Choose which account it was paid from"); return; }
    if (ccy(locker.currency) !== "INR") { toast.error("Brokerage is in rupees — choose an INR account"); return; }
    const bal = lockerBalance(locker, db.lockerTransactions);
    if (amt > bal && !(await confirmBox(`This payment of ${fmtMoneyInr(amt)} is more than ${locker.name}'s balance of ${fmtMoneyInr(bal)}.\n\nThe account will go negative — continue only if you're sure a deposit is still missing.`))) return;
    if (account && amt > account.due + 0.5 && !(await confirmBox(`${broker.name} is owed ${fmtMoneyInr(Math.max(0, account.due))}. Paying ${fmtMoneyInr(amt)} leaves ${fmtMoneyInr(amt - Math.max(0, account.due))} paid ahead — continue?`))) return;
    setSaving(true);
    try {
      updateDb(d => {
        if (!d.lockerTransactions) d.lockerTransactions = [];
        d.lockerTransactions.push({
          id: uid("ltx_"), lockerId: locker.id, type: "expense", amountInr: amt, currency: "INR",
          category: `Brokerage — ${broker.name}`, refType: "brokerPayment", refId: broker.id,
          note: note.trim() || undefined, recordedBy: user!.id, createdAt: stampFor(date),
        });
      });
      toast.success(`${fmtMoneyInr(amt)} brokerage paid to ${broker.name}`);
      reset();
      onOpenChange(false);
    } finally { setSaving(false); }
  };

  return (
    <ActionSheet open={open} onOpenChange={onOpenChange} size="md" icon={Handshake}
      title="Pay brokerage" description="To a broker, from one of your accounts"
      footer={
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="min-w-0">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Paying</p>
            <p className="font-display text-xl font-bold tabular-nums leading-tight text-destructive">{fmtMoneyInr(amt)}</p>
          </div>
          <div className="flex gap-2 ml-auto">
            <Button variant="outline" onClick={() => onOpenChange(false)} className="rounded-xl h-10">Cancel</Button>
            <AsyncButton onClick={save} disabled={saving} className="btn-hero rounded-xl h-10 px-6">{saving ? "Saving…" : "Record Payment"}</AsyncButton>
          </div>
        </div>
      }>
      <div className="space-y-3">
        {!fixedId && (
          <div>
            <Label className="text-xs">Broker</Label>
            <Select value={brokerId} onValueChange={addNew("broker", setBrokerId)}>
              <SelectTrigger className="h-10 rounded-xl mt-1"><SelectValue placeholder="Choose broker" /></SelectTrigger>
              <SelectContent>{brokers.map(b => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}<AddNewItem kind="broker" /></SelectContent>
            </Select>
          </div>
        )}
        {broker && account && (
          <p className="text-xs text-muted-foreground">
            {fixedId ? <span className="font-semibold text-foreground">{broker.name} · </span> : null}
            {account.due > 0.5
              ? <>Brokerage owed: <span className="font-semibold text-foreground">{fmtMoneyInr(account.due)}</span></>
              : account.due < -0.5 ? <>Paid ahead by <span className="font-semibold text-blue-600">{fmtMoneyInr(-account.due)}</span></> : "Nothing owed right now"}
          </p>
        )}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label htmlFor="pb-date" className="text-xs">Date</Label>
            <Input id="pb-date" type="date" value={date} onChange={e => setDate(e.target.value)} className="rounded-xl h-10 mt-1" />
          </div>
          <div>
            <Label htmlFor="pb-amount" className="text-xs">Amount (₹)</Label>
            <Input id="pb-amount" type="number" min={0} value={amount} onChange={e => setAmount(e.target.value)} className="rounded-xl h-10 mt-1" />
          </div>
        </div>
        <div>
          <Label className="text-xs">Paid from</Label>
          <Select value={lockerId} onValueChange={addNew("locker", setLockerId)}>
            <SelectTrigger className="h-10 rounded-xl mt-1"><SelectValue placeholder="Choose account" /></SelectTrigger>
            <SelectContent>{lockers.map(l => <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>)}<AddNewItem kind="locker" /></SelectContent>
          </Select>
        </div>
        <Input value={note} onChange={e => setNote(e.target.value)} className="rounded-xl h-10" placeholder="Note (optional)" />
      </div>
    </ActionSheet>
  );
}
