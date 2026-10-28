import { useState } from "react";
import { toast } from "sonner";
import { Wallet } from "lucide-react";
import { updateDbAs, todayLocal, stampFor } from "@/lib/db";
import { useDb } from "@/hooks/useDb";
import { useAuth } from "@/lib/auth";
import { useCan } from "@/hooks/useCan";
import { ccy } from "@/lib/currency";
import { fmtMoneyInr, lockerBalance } from "@/lib/manufacturing";
import { confirmBox } from "@/lib/confirm";
import { designerAccount, designerOf, jobPayState } from "@/lib/designers";
import { writeDesignerPayment } from "@/lib/partyPayments";
import { ActionSheet } from "@/components/ActionSheet";
import { AsyncButton } from "@/components/AsyncButton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

/**
 * Pay a freelance designer from a rupee account — against one approved design
 * or their oldest first. The same entry the Locker's "Record entry" makes
 * (lib/partyPayments.ts writeDesignerPayment); corrected there.
 */
export function PayDesignerSheet({ designerId, jobId, onClose }: { designerId: string; jobId?: string; onClose: () => void }) {
  const db = useDb();
  const { user } = useAuth();
  const can = useCan();
  const designer = designerOf(db, designerId);
  const [lockerId, setLockerId] = useState("");
  const [against, setAgainst] = useState(jobId ?? "__oldest");
  const states = designer ? jobPayState(db, designer) : new Map();
  const due = [...states.entries()].filter(([, v]) => v.due > 0.005)
    .map(([id, v]) => ({ job: (db.cadJobs ?? []).find(j => j.id === id), due: v.due as number })).filter(x => x.job);
  const picked = due.find(x => x.job!.id === against);
  const acc = designer ? designerAccount(db, designer) : null;
  const [amount, setAmount] = useState(() => String(picked ? picked.due : acc && acc.due > 0 ? acc.due : ""));
  const [date, setDate] = useState(todayLocal());
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const lockers = db.lockers.filter(l => l.active !== false && ccy(l.currency) === "INR");
  const locker = lockers.find(l => l.id === lockerId);
  const amt = Number(amount) || 0;
  const allowed = user?.role === "admin" || can("payments", "add");

  if (!designer) return null;
  const save = async () => {
    if (!allowed) { toast.error("You don't have access to record payments"); return; }
    if (!locker) { toast.error("Choose the account it is paid from"); return; }
    if (!(amt > 0)) { toast.error("Enter the amount"); return; }
    const bal = lockerBalance(locker, db.lockerTransactions);
    if (amt > bal && !(await confirmBox(`${fmtMoneyInr(amt)} is more than ${locker.name}'s balance of ${fmtMoneyInr(bal)}.\n\nThe balance will go negative — continue only if a deposit is still missing.`))) return;
    if (picked && amt > picked.due + 0.5 && !(await confirmBox(`${fmtMoneyInr(amt)} is more than the ${fmtMoneyInr(picked.due)} still due on ${picked.job!.orderNumber}. The rest settles their other designs, oldest first — continue?`))) return;
    setSaving(true);
    try {
      updateDbAs({ summary: `Paid ${fmtMoneyInr(amt)} to designer ${designer.name}` }, d => writeDesignerPayment(d, {
        lockerId: locker.id, amount: amt, note, userId: user!.id, at: stampFor(date), designerId: designer.id,
        cadJobId: against !== "__oldest" ? against : undefined,
      }));
      toast.success(`${fmtMoneyInr(amt)} paid to ${designer.name}`);
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't save — nothing was recorded");
    } finally { setSaving(false); }
  };

  return (
    <ActionSheet open onOpenChange={o => { if (!o) onClose(); }} size="md" icon={Wallet}
      title={`Pay ${designer.name}`} description={acc ? (acc.advance > 0.5 ? `Paid ahead ${fmtMoneyInr(acc.advance)}` : `To pay ${fmtMoneyInr(acc.due)}`) : ""}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose} className="rounded-xl h-10">Cancel</Button>
          <AsyncButton onClick={save} disabled={saving || !allowed} className="btn-hero rounded-xl h-10 px-6">{saving ? "Saving…" : "Record Payment"}</AsyncButton>
        </div>
      }>
      <div className="space-y-4">
        <div>
          <Label className="text-xs">From account</Label>
          <Select value={lockerId} onValueChange={setLockerId}>
            <SelectTrigger className="h-10 rounded-xl mt-1" aria-label="From account"><SelectValue placeholder={lockers.length ? "Choose a rupee account" : "No rupee account"} /></SelectTrigger>
            <SelectContent>{lockers.map(l => <SelectItem key={l.id} value={l.id}>{l.name} · {fmtMoneyInr(lockerBalance(l, db.lockerTransactions))}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs">Against</Label>
          <Select value={against} onValueChange={v => { setAgainst(v); const x = due.find(y => y.job!.id === v); if (x) setAmount(String(x.due)); }}>
            <SelectTrigger className="h-10 rounded-xl mt-1" aria-label="Against"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__oldest">Oldest approved designs first</SelectItem>
              {due.map(x => <SelectItem key={x.job!.id} value={x.job!.id}>{x.job!.orderNumber}{x.job!.brief.piece ? ` · ${x.job!.brief.piece}` : ""} — to pay {fmtMoneyInr(x.due)}</SelectItem>)}
            </SelectContent>
          </Select>
          {!due.length && <p className="text-[11px] text-muted-foreground mt-1">Nothing approved is waiting for payment — this is paid ahead, and settles their next approved designs.</p>}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label className="text-xs">Amount (₹)</Label>
            <Input type="number" min={0} step="0.01" inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)} className="h-10 rounded-xl mt-1" aria-label="Amount" />
          </div>
          <div>
            <Label className="text-xs">Date</Label>
            <Input type="date" value={date} onChange={e => setDate(e.target.value)} className="h-10 rounded-xl mt-1" aria-label="Date" />
          </div>
        </div>
        <div>
          <Label className="text-xs">Note</Label>
          <Input value={note} onChange={e => setNote(e.target.value)} className="h-10 rounded-xl mt-1" placeholder="Optional — UPI ref, cheque no." aria-label="Note" />
        </div>
      </div>
    </ActionSheet>
  );
}
