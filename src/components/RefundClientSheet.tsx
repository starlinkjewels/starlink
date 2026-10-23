import { useEffect, useState } from "react";
import { Undo2 } from "lucide-react";
import { toast } from "sonner";
import { updateDb, uid, fmtMoney, todayLocal, stampFor } from "@/lib/db";
import { useDb } from "@/hooks/useDb";
import { useAuth } from "@/lib/auth";
import { refundable, refundProblem, writeClientRefund, type RefundInput } from "@/lib/clientRefunds";
import { lockerBalance } from "@/lib/manufacturing";
import { ccy, fmtCcy, roundCcy } from "@/lib/currency";
import { confirmBox } from "@/lib/confirm";
import { RateInput } from "@/components/CurrencyFields";
import { AsyncButton } from "@/components/AsyncButton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { sheetFrame, type Frame } from "@/components/SheetFrame";

/**
 * Pay a client's held credit back to them (lib/clientRefunds.ts): their credit
 * comes down and the account pays it out, in one save. Opened from Payments,
 * the client's page (the client fixed) or the Locker (the account fixed).
 */
export function RefundClientSheet({ open, onOpenChange, clientId: fixedClient, lockerId: fixedLocker, frame = sheetFrame }: {
  open: boolean; onOpenChange: (v: boolean) => void;
  clientId?: string;
  lockerId?: string;
  frame?: Frame;
}) {
  const db = useDb();
  const { user } = useAuth();
  const [clientPick, setClientId] = useState("");
  const [lockerPick, setLockerId] = useState("");
  const [amount, setAmount] = useState("");
  // The account's currency for $1 — cleared when the account changes.
  const [rate, setRate] = useState<number | "">("");
  const [date, setDate] = useState(todayLocal());
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const clientId = fixedClient ?? clientPick;
  const lockerId = fixedLocker ?? lockerPick;
  useEffect(() => { if (open && !fixedClient) setClientId(""); }, [open, fixedClient]);

  const client = db.clients.find(c => c.id === clientId);
  const held = clientId ? refundable(db, clientId) : 0;
  // Every client holding credit; with a client fixed, that one whatever it holds.
  const clients = db.clients.filter(c => (c.creditBalance || 0) > 0.005 || c.id === clientId)
    .sort((a, b) => a.companyName.localeCompare(b.companyName));
  const locker = db.lockers.find(l => l.id === lockerId);
  const cur = ccy(locker?.currency);
  const needsRate = !!locker && cur !== "USD";
  const usd = Number(amount) || 0;
  const paidOut = !locker || !usd ? null : !needsRate ? usd : Number(rate) > 0 ? roundCcy(usd * Number(rate), cur) : null;

  const save = async () => {
    const x: RefundInput = {
      clientId, lockerId, amountUsd: Math.round(usd * 100) / 100, rate: needsRate ? Number(rate) : undefined,
      note, userId: user!.id, at: stampFor(date), txnId: uid("ltx_"),
    };
    const problem = refundProblem(db, x);
    if (problem) { toast.error(problem); return; }
    if (locker && paidOut != null) {
      const bal = lockerBalance(locker, db.lockerTransactions);
      if (paidOut > bal && !(await confirmBox(`This refund of ${fmtCcy(paidOut, cur)} is more than ${locker.name}'s balance of ${fmtCcy(bal, cur)}.\n\nThe account will go negative — continue only if you're sure a deposit is still missing.`))) return;
    }
    setSaving(true);
    try {
      // Checked again on the records it is saved on: their credit may have
      // been used while the form was open.
      let refused: string | undefined;
      updateDb(d => {
        refused = refundProblem(d, x);
        if (!refused) writeClientRefund(d, x);
      });
      if (refused) { toast.error(refused); return; }
      toast.success(`${fmtMoney(x.amountUsd)} refunded to ${client?.companyName ?? "the client"}`);
      setAmount(""); setNote(""); setRate(""); setDate(todayLocal()); if (!fixedLocker) setLockerId("");
      onOpenChange(false);
    } finally { setSaving(false); }
  };

  return frame({
    open, onOpenChange, size: "md", icon: Undo2,
    title: "Refund to client",
    description: client ? `${client.companyName} holds ${fmtMoney(held)} of credit` : "Pay a client's held credit back to them",
    footer: (
      <div className="space-y-3">
        {usd > 0 && (
          <div className="flex items-end justify-between gap-3 flex-wrap">
            <div className="min-w-0">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Refunding</p>
              <p className="font-display text-xl font-bold tabular-nums leading-tight text-destructive">{fmtMoney(usd)}</p>
            </div>
            <p className="text-xs text-muted-foreground text-right">
              {paidOut != null && locker && <>Paid from {locker.name}: <span className="font-semibold text-foreground">{fmtCcy(paidOut, cur)}</span><br /></>}
              {client && <>Credit after: <span className={`font-semibold ${held - usd < -0.005 ? "text-destructive" : "text-foreground"}`}>{fmtMoney(Math.max(0, held - usd))}</span></>}
            </p>
          </div>
        )}
        <div className="flex items-center justify-end gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} className="rounded-xl h-10 flex-1 sm:flex-none">Cancel</Button>
          <AsyncButton onClick={save} disabled={saving} className="btn-hero rounded-xl h-10 flex-1 sm:flex-none sm:px-8">{saving ? "Saving…" : "Record Refund"}</AsyncButton>
        </div>
      </div>
    ),
    children: (
      <div className="space-y-3">
        {!fixedClient && (
          <div>
            <Label className="text-xs">Client</Label>
            <Select value={clientId} onValueChange={v => { setClientId(v); setAmount(""); }}>
              <SelectTrigger className="h-10 rounded-xl mt-1"><SelectValue placeholder={clients.length ? "Choose client" : "No client holds credit"} /></SelectTrigger>
              <SelectContent>{clients.map(c => <SelectItem key={c.id} value={c.id}>{c.companyName} — {fmtMoney(c.creditBalance || 0)} credit</SelectItem>)}</SelectContent>
            </Select>
          </div>
        )}
        {client && held <= 0.005 && (
          <p className="text-xs rounded-xl border border-dashed border-border px-3 py-2.5 text-muted-foreground">
            {client.companyName} holds no credit right now, so there is nothing to refund.
          </p>
        )}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label className="text-xs">Amount ($)</Label>
            <div className="flex gap-2 mt-1">
              <Input type="number" min={0} step="0.01" value={amount} onChange={e => setAmount(e.target.value)} className="rounded-xl h-10" placeholder={held > 0 ? String(held) : "0"} />
              {held > 0.005 && <Button type="button" variant="outline" onClick={() => setAmount(String(held))} className="rounded-xl h-10 shrink-0 text-xs">All</Button>}
            </div>
          </div>
          <div>
            <Label className="text-xs">Date</Label>
            <Input type="date" value={date} onChange={e => setDate(e.target.value)} className="rounded-xl h-10 mt-1" />
          </div>
        </div>
        {!fixedLocker && (
          <div>
            <Label className="text-xs">Paid from account *</Label>
            <Select value={lockerId} onValueChange={v => { setLockerId(v); setRate(""); }}>
              <SelectTrigger className="h-10 rounded-xl mt-1"><SelectValue placeholder="Choose account" /></SelectTrigger>
              <SelectContent>{db.lockers.filter(l => l.active !== false).map(l => <SelectItem key={l.id} value={l.id}>{l.name} ({ccy(l.currency)})</SelectItem>)}</SelectContent>
            </Select>
          </div>
        )}
        {needsRate && (
          <div className="p-3 rounded-xl bg-secondary">
            <RateInput id="refund-rate" from="USD" to={cur} value={rate} onChange={setRate} amount={usd || undefined} at={date} />
            <p className="text-xs text-muted-foreground mt-1">The credit is in USD; this account holds {cur}.</p>
          </div>
        )}
        <Input value={note} onChange={e => setNote(e.target.value)} className="rounded-xl h-10" placeholder="Note (optional) — e.g. order cancelled, bank ref" />
        <p className="text-[11px] text-muted-foreground">Only credit held on their account can be refunded. Deleting the refund later puts the credit back.</p>
      </div>
    ),
  });
}
