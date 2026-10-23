import { useEffect, useState } from "react";
import { ArrowDownCircle } from "lucide-react";
import { toast } from "sonner";
import { todayLocal, stampFor, updateDb } from "@/lib/db";
import { useDb } from "@/hooks/useDb";
import { useAuth } from "@/lib/auth";
import { brokerAccount } from "@/lib/brokers";
import { fmtMoneyInr } from "@/lib/manufacturing";
import { ccy } from "@/lib/currency";
import { AsyncButton } from "@/components/AsyncButton";
import { Field, PanelActions } from "@/components/BillLayout";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { sheetFrame, type Frame } from "@/components/SheetFrame";
import { writeBrokerReceipt } from "@/lib/partyPayments";

/**
 * Money a broker hands over to us — what they collected from suppliers for us
 * (or simply gives back). One account entry from them (refType "brokerReceipt");
 * the broker's account reads it (lib/brokers.ts), and it is corrected or deleted
 * in Payments → Account entries like any entry of our own.
 *
 * Opened from a broker's page (the broker fixed), from Payments, or from the
 * Locker's "Record transaction" (the account fixed).
 */
export function ReceiveFromBrokerSheet({ open, onOpenChange, brokerId: fixedBroker, lockerId: fixedLocker, frame = sheetFrame }: {
  open: boolean; onOpenChange: (v: boolean) => void;
  brokerId?: string;
  lockerId?: string;
  frame?: Frame;
}) {
  const db = useDb();
  const { user } = useAuth();
  const [brokerPick, setBrokerId] = useState("");
  const [amount, setAmount] = useState("");
  const [lockerPick, setLockerId] = useState("");
  const [date, setDate] = useState(todayLocal());
  const [note, setNote] = useState("");
  useEffect(() => { if (open && !fixedBroker) setBrokerId(""); }, [open, fixedBroker]);
  const brokerId = fixedBroker ?? brokerPick;
  const lockerId = fixedLocker ?? lockerPick;
  const broker = (db.brokers ?? []).find(b => b.id === brokerId);
  const held = broker ? brokerAccount(db, broker).held : 0;
  const brokers = (db.brokers ?? []).filter(b => b.active !== false || b.id === brokerId).sort((a, b) => a.name.localeCompare(b.name));
  // Inactive accounts are marked active === false; older ones carry no flag at all.
  const lockers = db.lockers.filter(l => l.active !== false && ccy(l.currency) === "INR");

  const save = () => {
    const amt = Math.round((Number(amount) || 0) * 100) / 100;
    if (!broker) { toast.error("Choose the broker"); return; }
    if (!(amt > 0)) { toast.error("Enter the amount"); return; }
    if (!lockerId) { toast.error("Choose the account it went into"); return; }
    if (ccy(db.lockers.find(l => l.id === lockerId)?.currency) !== "INR") { toast.error("Brokers deal in rupees — choose an INR account"); return; }
    updateDb(d => writeBrokerReceipt(d, { brokerId: broker.id, lockerId, amount: amt, note, userId: user!.id, at: stampFor(date) }));
    toast.success(`${fmtMoneyInr(amt)} received from ${broker.name}`);
    setAmount(""); setNote(""); setLockerId(""); setDate(todayLocal()); onOpenChange(false);
  };

  return frame({
    open, onOpenChange, size: "md", icon: ArrowDownCircle, title: "Receive from broker",
    description: broker ? (held > 0.5 ? `${broker.name} holds ${fmtMoneyInr(held)} of ours` : `Money ${broker.name} hands over to us`) : "Money a broker collected for us, or gives back",
    footer: <PanelActions onCancel={() => onOpenChange(false)}><AsyncButton onClick={save} className="btn-hero rounded-xl h-11 flex-1 sm:flex-none sm:min-w-48">Record</AsyncButton></PanelActions>,
    children: (
      <div className="grid grid-cols-2 gap-3">
        {!fixedBroker && (
          <Field label="Broker" className="col-span-2">{id => (
            <Select value={brokerId} onValueChange={setBrokerId}>
              <SelectTrigger id={id} className="h-10 rounded-xl"><SelectValue placeholder="Choose broker" /></SelectTrigger>
              <SelectContent>{brokers.map(b => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}</SelectContent>
            </Select>
          )}</Field>
        )}
        {!fixedBroker && broker && (
          <p className="col-span-2 -mt-1 text-xs text-muted-foreground">
            {held > 0.5 ? <>Holds <span className="font-semibold text-foreground">{fmtMoneyInr(held)}</span> of ours</> : "Holds nothing of ours right now"}
          </p>
        )}
        <Field label="Amount (₹)">{id => <Input id={id} type="number" min={0} step="0.01" value={amount} placeholder={held > 0.5 ? String(held) : "0"} onChange={e => setAmount(e.target.value)} className="rounded-xl h-10" />}</Field>
        <Field label="Date">{id => <Input id={id} type="date" value={date} onChange={e => setDate(e.target.value)} className="rounded-xl h-10" />}</Field>
        {!fixedLocker && (
          <Field label="Into account" className="col-span-2">{id => (
            <Select value={lockerId} onValueChange={setLockerId}>
              <SelectTrigger id={id} className="h-10 rounded-xl"><SelectValue placeholder="Choose account" /></SelectTrigger>
              <SelectContent>{lockers.map(l => <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>)}</SelectContent>
            </Select>
          )}</Field>
        )}
        <Field label="Note" className="col-span-2">{id => <Input id={id} value={note} onChange={e => setNote(e.target.value)} className="rounded-xl h-10" placeholder="Optional" />}</Field>
      </div>
    ),
  });
}
