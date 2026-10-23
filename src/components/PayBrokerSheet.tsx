import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Handshake, ListChecks } from "lucide-react";
import { updateDb, uid, todayLocal, stampFor, fmtDate } from "@/lib/db";
import { useDb } from "@/hooks/useDb";
import { useAuth } from "@/lib/auth";
import { allocateOldestFirst, brokerAccount, brokerPendingBills } from "@/lib/brokers";
import { fmtMoneyInr, lockerBalance, purchasePending } from "@/lib/manufacturing";
import { ccy } from "@/lib/currency";
import { confirmBox } from "@/lib/confirm";
import { sheetFrame, type Frame } from "@/components/SheetFrame";
import { writeBrokerPayment } from "@/lib/partyPayments";
import { AddNewItem, useAddNew } from "@/components/create/QuickCreate";
import { AsyncButton } from "@/components/AsyncButton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const r2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Pay THROUGH a broker — how a Surat broker works: you give the broker one
 * amount; he passes it to the suppliers whose bills he brought and keeps his
 * brokerage (lib/brokers.ts).
 *
 * The bills he brought that are still unpaid are listed, oldest first. Tick the
 * ones this money settles (or type an amount and let it settle the oldest
 * first), keep the brokerage in, choose the account. Saved as ONE account entry
 * to the broker, and on each bill a supplier payment "via broker" — so each
 * supplier's due comes down. Money given beyond that stays with the broker
 * (held) until it is marked against bills later; with nothing paid now, this
 * marks bills paid out of what he already holds.
 */
export function PayBrokerSheet({ open, onOpenChange, brokerId: fixedId, lockerId: fixedLocker, frame = sheetFrame }: {
  open: boolean; onOpenChange: (v: boolean) => void;
  /** Paying this broker; absent = chosen in the form. */
  brokerId?: string;
  /** Paid from this account (the Locker's "Record transaction"); absent = chosen. */
  lockerId?: string;
  frame?: Frame;
}) {
  const db = useDb();
  const { user } = useAuth();
  const addNew = useAddNew();
  const [brokerId, setBrokerId] = useState(fixedId ?? "");
  const [amount, setAmount] = useState("");
  const [amountTyped, setAmountTyped] = useState(false);
  const [lockerPick, setLockerId] = useState("");
  const lockerId = fixedLocker ?? lockerPick;
  const [note, setNote] = useState("");
  const [date, setDate] = useState(todayLocal());
  // Bill id → the amount this payment settles on it ("" = not ticked).
  const [alloc, setAlloc] = useState<Record<string, string>>({});
  const [withBrokerage, setWithBrokerage] = useState(true);
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (open) { setBrokerId(fixedId ?? ""); setAlloc({}); setAmount(""); setAmountTyped(false); } }, [open, fixedId]);

  const brokers = (db.brokers ?? []).filter(b => b.active !== false || b.id === brokerId).sort((a, b) => a.name.localeCompare(b.name));
  const broker = (db.brokers ?? []).find(b => b.id === brokerId);
  const account = broker ? brokerAccount(db, broker) : null;
  const bills = useMemo(() => (broker ? brokerPendingBills(db, broker.id) : []), [db, broker]);
  const supplierName = (id: string) => db.suppliers.find(s => s.id === id)?.name ?? "Supplier";
  const lockers = db.lockers.filter(l => l.active !== false && ccy(l.currency) === "INR");

  const brokerageOwed = account ? Math.max(0, account.due) : 0;
  const held = account?.held ?? 0;
  const settled = r2(Object.values(alloc).reduce((s, v) => s + (Number(v) || 0), 0));
  const brokeragePart = withBrokerage ? brokerageOwed : 0;
  // What to give the broker now: the bills ticked and the brokerage, less what he already holds.
  const suggested = Math.max(0, r2(settled + brokeragePart - held));
  const amt = amountTyped ? Number(amount) || 0 : suggested;
  const leftWithBroker = r2(amt + held - settled - brokeragePart);
  // Bills ticked beyond what he has (given now + held): he would pay suppliers from his own pocket.
  const billsShort = r2(settled - amt - held);

  const toggle = (id: string, pending: number) =>
    setAlloc(a => (a[id] !== undefined ? Object.fromEntries(Object.entries(a).filter(([k]) => k !== id)) : { ...a, [id]: String(r2(pending)) }));
  const tickAll = () => setAlloc(Object.fromEntries(bills.map(p => [p.id, String(r2(purchasePending(p)))])));
  // Type the money given, and let it settle the oldest bills first (after the brokerage).
  const settleOldest = () => {
    const pool = r2((Number(amount) || 0) + held - brokeragePart);
    const { alloc: a } = allocateOldestFirst(bills, Math.max(0, pool));
    setAlloc(Object.fromEntries(Object.entries(a).map(([k, v]) => [k, String(v)])));
  };

  const reset = () => { setAmount(""); setAmountTyped(false); setLockerId(""); setNote(""); setDate(todayLocal()); setAlloc({}); if (!fixedId) setBrokerId(""); };

  const save = async () => {
    if (!broker || !account) { toast.error("Choose the broker"); return; }
    for (const p of bills) {
      const v = Number(alloc[p.id] ?? 0);
      if (v > purchasePending(p) + 0.5) { toast.error(`${supplierName(p.supplierId)}${p.invoiceNumber ? ` bill ${p.invoiceNumber}` : ""}: only ${fmtMoneyInr(purchasePending(p))} is pending`); return; }
      if (v < 0) { toast.error("An amount can't be negative"); return; }
    }
    if (amt < 0) { toast.error("Enter a valid amount"); return; }
    if (amt <= 0 && settled <= 0) { toast.error("Enter what you give the broker, or tick the bills he paid from what he holds"); return; }
    const locker = amt > 0 ? db.lockers.find(l => l.id === lockerId) : undefined;
    if (amt > 0 && !locker) { toast.error("Choose which account it was paid from"); return; }
    if (locker && ccy(locker.currency) !== "INR") { toast.error("Brokers are paid in rupees — choose an INR account"); return; }
    if (billsShort > 0.5 && !(await confirmBox(`The bills ticked come to ${fmtMoneyInr(settled)}, but ${broker.name} gets ${fmtMoneyInr(amt)}${held ? ` and holds ${fmtMoneyInr(held)}` : ""}. He would pay ${fmtMoneyInr(billsShort)} from his own pocket, and you will owe him that — continue?`))) return;
    if (locker) {
      const bal = lockerBalance(locker, db.lockerTransactions);
      if (amt > bal && !(await confirmBox(`This payment of ${fmtMoneyInr(amt)} is more than ${locker.name}'s balance of ${fmtMoneyInr(bal)}.\n\nThe account will go negative — continue only if you're sure a deposit is still missing.`))) return;
    }
    setSaving(true);
    try {
      const at = stampFor(date);
      const txnId = uid("ltx_");
      const lines = bills.filter(p => Number(alloc[p.id] ?? 0) > 0);
      updateDb(d => writeBrokerPayment(d, {
        brokerId: broker.id, lockerId: amt > 0 ? locker?.id : undefined, amount: amt, txnId, note, userId: user!.id, at,
        lines: lines.map(p => ({ purchaseId: p.id, amount: Number(alloc[p.id]) })),
      }));
      toast.success(`${amt > 0 ? `${fmtMoneyInr(amt)} to ${broker.name}` : `From what ${broker.name} holds`}${lines.length ? ` · ${lines.length} bill${lines.length === 1 ? "" : "s"} settled` : ""}`);
      reset();
      onOpenChange(false);
    } finally { setSaving(false); }
  };

  return frame({
    open, onOpenChange, size: "lg", icon: Handshake,
    title: "Pay through broker", description: "One payment to the broker — he pays the suppliers and keeps his brokerage",
    footer: (
        <div className="flex items-end justify-between gap-3 flex-wrap">
          <div className="min-w-0">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Giving the broker</p>
            <p className="font-display text-xl font-bold tabular-nums leading-tight text-destructive">{fmtMoneyInr(amt)}</p>
            {broker && (settled > 0 || brokeragePart > 0) && (
              <p className="text-[11px] text-muted-foreground">
                Bills {fmtMoneyInr(settled)}{brokeragePart ? ` + brokerage ${fmtMoneyInr(brokeragePart)}` : ""}{held ? ` − held ${fmtMoneyInr(Math.min(held, settled + brokeragePart))}` : ""}
                {leftWithBroker > 0.5 ? ` · ${fmtMoneyInr(leftWithBroker)} stays with him` : billsShort > 0.5 ? ` · short ${fmtMoneyInr(billsShort)} for the bills` : leftWithBroker < -0.5 ? ` · ${fmtMoneyInr(-leftWithBroker)} brokerage still owed` : ""}
              </p>
            )}
          </div>
          <div className="flex gap-2 ml-auto">
            <Button variant="outline" onClick={() => onOpenChange(false)} className="rounded-xl h-10">Cancel</Button>
            <AsyncButton onClick={save} disabled={saving} className="btn-hero rounded-xl h-10 px-6">{saving ? "Saving…" : "Record Payment"}</AsyncButton>
          </div>
        </div>
    ),
    children: (
      <div className="space-y-4">
        {!fixedId && (
          <div>
            <Label className="text-xs">Broker</Label>
            <Select value={brokerId} onValueChange={addNew("broker", v => { setBrokerId(v); setAlloc({}); })}>
              <SelectTrigger className="h-10 rounded-xl mt-1"><SelectValue placeholder="Choose broker" /></SelectTrigger>
              <SelectContent>{brokers.map(b => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}<AddNewItem kind="broker" /></SelectContent>
            </Select>
          </div>
        )}

        {broker && account && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {[
              ["Bills pending", fmtMoneyInr(account.billsPending), `${bills.length} bill${bills.length === 1 ? "" : "s"}`],
              ["Brokerage owed", fmtMoneyInr(brokerageOwed), account.brokerage ? `of ${fmtMoneyInr(account.brokerage)}` : "—"],
              ["Held by broker", fmtMoneyInr(held), held ? "given, not passed on" : "nothing"],
              ["To settle", fmtMoneyInr(account.toPay), "bills + brokerage − held"],
            ].map(([l, v, sub]) => (
              <div key={l} className="rounded-xl border border-border/60 bg-white px-3 py-2">
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{l}</p>
                <p className="text-sm font-semibold tabular-nums text-brand-dark">{v}</p>
                <p className="text-[10px] text-muted-foreground truncate">{sub}</p>
              </div>
            ))}
          </div>
        )}

        {broker && (
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-semibold text-brand-dark">Bills he pays with this money</p>
              {bills.length > 0 && <button type="button" onClick={tickAll} className="text-xs text-primary hover:underline inline-flex items-center gap-1"><ListChecks className="h-3.5 w-3.5" /> Tick all</button>}
            </div>
            {bills.length === 0 ? (
              <p className="text-xs text-muted-foreground rounded-xl border border-dashed border-border px-3 py-3">No unpaid bills brought by {broker.name}. A payment now is held by him, or is his brokerage.</p>
            ) : (
              <div className="rounded-xl border border-border/60 divide-y divide-border/50 max-h-72 overflow-y-auto bg-white">
                {bills.map(p => {
                  const pending = purchasePending(p);
                  const on = alloc[p.id] !== undefined;
                  return (
                    <label key={p.id} className={`flex items-center gap-3 px-3 py-2 cursor-pointer ${on ? "bg-primary/[0.04]" : ""}`}>
                      <input type="checkbox" checked={on} onChange={() => toggle(p.id, pending)} className="h-4 w-4 accent-current text-primary shrink-0" />
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-medium text-brand-dark truncate">{supplierName(p.supplierId)}{p.invoiceNumber ? ` · bill ${p.invoiceNumber}` : ""}</span>
                        <span className="block text-[11px] text-muted-foreground">{fmtDate(p.invoiceDate || p.createdAt)} · pending {fmtMoneyInr(pending)}</span>
                      </span>
                      {on && (
                        <Input type="number" min={0} value={alloc[p.id]} onClick={e => e.preventDefault()}
                          onChange={e => setAlloc(a => ({ ...a, [p.id]: e.target.value }))}
                          className="h-9 w-32 rounded-lg text-right tabular-nums" aria-label={`Amount for ${supplierName(p.supplierId)}`} />
                      )}
                    </label>
                  );
                })}
              </div>
            )}
            {brokerageOwed > 0.5 && (
              <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
                <input type="checkbox" checked={withBrokerage} onChange={e => setWithBrokerage(e.target.checked)} className="h-4 w-4" />
                Include his brokerage owed ({fmtMoneyInr(brokerageOwed)})
              </label>
            )}
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label htmlFor="pb-amount" className="text-xs">Amount given to the broker (₹)</Label>
            <div className="flex gap-2 mt-1">
              <Input id="pb-amount" type="number" min={0} value={amountTyped ? amount : (suggested ? String(suggested) : "")}
                onChange={e => { setAmount(e.target.value); setAmountTyped(e.target.value !== ""); }}
                className="rounded-xl h-10" placeholder="0" />
              {bills.length > 0 && amountTyped && (
                <Button type="button" variant="outline" onClick={settleOldest} className="rounded-xl h-10 shrink-0 text-xs" title="Spread this amount over the oldest bills first">Oldest first</Button>
              )}
            </div>
            <p className="text-[11px] text-muted-foreground mt-1">0 = he pays from money he already holds.</p>
          </div>
          <div>
            <Label htmlFor="pb-date" className="text-xs">Date</Label>
            <Input id="pb-date" type="date" value={date} onChange={e => setDate(e.target.value)} className="rounded-xl h-10 mt-1" />
          </div>
        </div>
        {amt > 0 && !fixedLocker && (
          <div>
            <Label className="text-xs">Paid from</Label>
            <Select value={lockerId} onValueChange={addNew("locker", setLockerId)}>
              <SelectTrigger className="h-10 rounded-xl mt-1"><SelectValue placeholder="Choose account" /></SelectTrigger>
              <SelectContent>{lockers.map(l => <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>)}<AddNewItem kind="locker" /></SelectContent>
            </Select>
          </div>
        )}
        <Input value={note} onChange={e => setNote(e.target.value)} className="rounded-xl h-10" placeholder="Note (optional)" />
      </div>
    ),
  });
}
