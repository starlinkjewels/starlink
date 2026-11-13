import { useEffect, useState } from "react";
import { toast } from "sonner";
import { CreditCard, DollarSign } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { useDb } from "@/hooks/useDb";
import { ListCombo } from "@/components/ListCombo";
import { AddNewItem, useAddNew } from "@/components/create/QuickCreate";
import { RateInput } from "@/components/CurrencyFields";
import { AsyncButton } from "@/components/AsyncButton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { sheetFrame, type Frame } from "@/components/SheetFrame";
import {
  balanceDue, fmtDate, fmtMoney, invoiceOrderIds, loadDb, stampFor, todayLocal, updateDb, worksOnClientId, type Order,
} from "@/lib/db";
import { ccy, fmtCcy, roundCcy, type CurrencyCode } from "@/lib/currency";
import { createReceipt } from "@/lib/receipts";
import { notifyClientPayment } from "@/lib/partyPayments";
import { openMin } from "@/lib/openMin";
import { confirmBox } from "@/lib/confirm";
import type { ReactNode } from "react";

const r2 = (n: number) => Math.round(n * 100) / 100;

/** What the panel hands to whoever saves it — every field already checked. */
export interface ReceiveValues {
  clientId: string;
  /** In dollars — what it settles of their billing. */
  amountUsd: number;
  /** The day it came in (YYYY-MM-DD), and as a time stamp on that day. */
  date: string;
  at: string;
  /** Cash, Bank transfer, UPI, Cheque… */
  method: string;
  /** The typed remark / reference, or "". */
  remark: string;
  lockerId: string;
  lockerCurrency: CurrencyCode;
  /** The account's currency for $1, when the account isn't in dollars. */
  exchangeRate?: number;
  /** What landed in the account, in its own currency. */
  depositAmount: number;
  /** The invoice it was sent for (a client's money, not one order's). */
  invoiceId?: string;
  /** Several invoices it pays, oldest first (the first is also `invoiceId`) — only where `extras`. */
  invoiceIds?: string[];
  /** $ the banks kept: the client is credited the whole amount, these go to Expenses — only where `extras`. */
  bankChargesUsd?: number;
}

/** The account last paid into, on this device — offered first next time. */
const lastLockerKey = (uid: string) => `pay-locker:${uid}`;

/**
 * Receive money from a client — ONE panel, wherever it is taken: Payments →
 * Receive, the client's page, an order's page, an invoice. The same fields in
 * the same order (date, amount, mode, account, rate when the account is not in
 * dollars, remark — and, for a client's money, which invoice it is for or held
 * as credit), the same checks, and the same preview of what saving will do.
 *
 * Who saves it stays as it was: each place passes its own `onSave` (an order's
 * page puts it on that order; a client's page settles their account); with
 * none, it is a client's numbered receipt (lib/receipts.ts createReceipt), as
 * Payments → Receive always recorded it.
 */
export function ReceiveFromClient({
  open, onOpenChange, lockerId: fixedLocker, frame = sheetFrame,
  clientId: fixedClient, orderId, invoiceId: presetInvoice, amount: presetAmount, onSave, title, description, forNewOrder, initial, extras,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Opened from an account (the Locker): that account, no picker. */
  lockerId?: string;
  frame?: Frame;
  /** The client, already known (their page, an order, an invoice). */
  clientId?: string;
  /** Money for this one order: it goes on the order (up to its balance), the rest to their credit. */
  orderId?: string;
  /** The invoice it is for, already known. */
  invoiceId?: string;
  /** Filled in to start with (an order's balance). */
  amount?: number;
  /** Saves it. Returns false when it was not saved (the reason already said). */
  onSave?: (v: ReceiveValues) => Promise<boolean | void>;
  title?: string;
  description?: ReactNode;
  /** The advance on an order not placed yet (New order): no invoice to pick — the
   *  values go back to the form, and are saved with the order. */
  forNewOrder?: boolean;
  /** What it starts with when changing one already taken down (New order's advance). */
  initial?: { amount?: number; method?: string; remark?: string; lockerId?: string; rate?: number; date?: string };
  /** The saver takes several invoices and bank charges too (ReceiveValues.invoiceIds / bankChargesUsd).
   *  Unset: only the panel's own saving (a numbered receipt) does. */
  extras?: boolean;
}) {
  const { user } = useAuth();
  const db = useDb();
  const addNew = useAddNew();
  const order: Order | undefined = orderId ? db.orders.find(o => o.id === orderId) : undefined;
  const [clientPick, setClientId] = useState("");
  const clientId = order?.clientId ?? fixedClient ?? clientPick;
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("Cash");
  const [note, setNote] = useState("");
  const [lockerPick, setLockerId] = useState("");
  const lockerId = fixedLocker ?? lockerPick;
  // 1 USD in the account's currency. Cleared when the account changes, so a rate
  // typed for one currency is never saved against another.
  const [exchangeRate, setExchangeRate] = useState<number | "">("");
  const [invoiceId, setInvoiceId] = useState("");
  // Several invoices: ticked by hand (the oldest pre-ticked to cover the amount), paid oldest first.
  const [several, setSeveral] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  // What the banks kept on the way ($).
  const [fee, setFee] = useState("");
  const [saving, setSaving] = useState(false);
  // Entries are often written up a day or two later, so the date is chosen
  // rather than assumed to be today.
  const [date, setDate] = useState(todayLocal());

  // Each time it opens: fresh, with what is already known filled in.
  useEffect(() => {
    if (!open) return;
    setClientId("");
    const start = initial?.amount ?? presetAmount;
    setAmount(start && start > 0 ? String(r2(start)) : "");
    setMethod(initial?.method || "Cash"); setNote(initial?.remark ?? ""); setExchangeRate(initial?.rate ?? ""); setDate(initial?.date || todayLocal());
    setSeveral(false); setPicked([]); setFee("");
    let last = initial?.lockerId ?? "";
    if (!last) { try { last = localStorage.getItem(lastLockerKey(user?.id ?? "")) ?? ""; } catch { /* private window */ } }
    setLockerId(loadDb().lockers.some(l => l.id === last && l.active !== false) ? last : "");
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const clients = db.clients.filter(c => c.status === "active" && worksOnClientId(db, user, c.id)).sort((a, b) => a.companyName.localeCompare(b.companyName));
  // A client's money (not one order's): which invoice it is for.
  const openInvoices = clientId && !order && !forNewOrder
    ? (db.invoices ?? [])
        .filter(i => i.clientId === clientId)
        .map(i => ({
          inv: i,
          bal: invoiceOrderIds(i)
            .map(oid => db.orders.find(o => o.id === oid))
            .filter((o): o is Order => !!o && o.status !== "Rejected")
            .reduce((s, o) => s + balanceDue(o), 0),
        }))
        .sort((a, b) => +new Date(b.inv.createdAt) - +new Date(a.inv.createdAt))
    : [];
  // When the client has exactly ONE invoice still outstanding, a transfer from
  // them is almost always for that invoice — preselect it so the money settles
  // the bill they actually paid. With more than one open, nothing is guessed:
  // the money is held as credit until somebody names the invoice.
  const openUnpaid = openInvoices.filter(x => x.bal > 0);
  useEffect(() => {
    if (!open) return;
    setInvoiceId(presetInvoice ?? (openUnpaid.length === 1 ? openUnpaid[0].inv.id : ""));
    setSeveral(false); setPicked([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId, open]);
  // Where the saver takes them (or the panel saves itself): several invoices and bank charges.
  const withExtras = (extras ?? !onSave) && !order && !forNewOrder;
  const canSeveral = withExtras && !presetInvoice && openUnpaid.length >= 2;
  // Oldest first — the order a payment for several bills pays them in.
  const oldestFirst = [...openUnpaid].sort((a, b) => +new Date(a.inv.createdAt) - +new Date(b.inv.createdAt));
  /** Tick the oldest bills until `amt` is covered (all of them when no amount yet). */
  const tickToCover = (amt: number) => {
    const out: string[] = [];
    let left = amt;
    for (const x of oldestFirst) {
      if (amt > 0 && left <= 0.005) break;
      out.push(x.inv.id);
      left -= x.bal;
    }
    setPicked(out);
  };

  const locker = db.lockers.find(l => l.id === lockerId);
  const lockerCurrency = ccy(locker?.currency);
  // A client always pays in USD (that's what the order is billed in) — any
  // other account (rupees, dirhams, euros…) needs converting for the deposit side.
  const needsRate = !!locker && lockerCurrency !== "USD";
  const rate = Number(exchangeRate);

  /** Payments from this client of about this amount within 7 days of `at` — receipts, and
   *  money put straight on an order (not from a receipt, not credit moved onto a bill). */
  const sameMoneyNearby = (cid: string, amt: number, at: string): string[] => {
    const live = loadDb();
    const near = (x: number) => Math.abs(x - amt) <= amt * 0.01;
    const week = (iso?: string) => !!iso && Math.abs(+new Date(iso) - +new Date(at)) <= 7 * 86_400_000;
    return [
      ...(live.clientReceipts ?? []).filter(r => r.clientId === cid && near(r.amountUsd) && week(r.date))
        .map(r => `Receipt ${r.receiptNo} · ${fmtMoney(r.amountUsd)} · ${fmtDate(r.date)}`),
      ...live.orders.filter(o => o.clientId === cid && !o.deletedAt).flatMap(o => (o.advances ?? [])
        .filter(a => !a.receiptId && !a.fromCredit && near(a.amount) && week(a.createdAt))
        .map(a => `On ${o.orderNumber} · ${fmtMoney(a.amount)} · ${fmtDate(a.createdAt)}`)),
    ];
  };

  const submit = async () => {
    const c = db.clients.find(x => x.id === clientId);
    if (!c) { toast.error("Choose a client"); return; }
    const amt = parseFloat(amount);
    if (!amt || amt <= 0) { toast.error("Enter a valid amount"); return; }
    if (!lockerId) { toast.error("Choose which account this was deposited into"); return; }
    if (needsRate && (!rate || rate <= 0)) { toast.error("Enter the exchange rate before saving this payment"); return; }
    if (order && order.status === "Rejected") { toast.error("This order is cancelled — take it as the client's money instead"); return; }
    // Several invoices: the ticked ones, oldest first.
    const ids = several ? oldestFirst.map(x => x.inv.id).filter(i => picked.includes(i)) : [];
    if (several && !ids.length) { toast.error("Tick the invoices it pays — or choose No invoice to hold it as credit"); return; }
    const feeUsd = withExtras && fee.trim() !== "" ? Number(fee) : 0;
    if (!(feeUsd >= 0) || !Number.isFinite(feeUsd)) { toast.error("Bank charges: an amount of 0 or more"); return; }
    if (feeUsd >= amt) { toast.error("Bank charges can't be the whole payment — check the amounts"); return; }
    // The rate is "1 USD = rate of the account's currency".
    const depositAmount = needsRate ? roundCcy(amt * rate, lockerCurrency) : amt;
    const v: ReceiveValues = {
      clientId, amountUsd: amt, date, at: stampFor(date), method, remark: note.trim(),
      lockerId, lockerCurrency, ...(needsRate ? { exchangeRate: rate } : {}), depositAmount,
      ...(!order && several ? { invoiceId: ids[0], ...(ids.length > 1 ? { invoiceIds: ids } : {}) } : !order && invoiceId ? { invoiceId } : {}),
      ...(feeUsd > 0 ? { bankChargesUsd: Math.round(feeUsd * 100) / 100 } : {}),
    };
    // The same money entered twice is the commonest slip: the same client, the same amount
    // (within 1%), within a week of this date — asked, never refused (two equal payments happen).
    const seen = sameMoneyNearby(clientId, amt, v.at);
    if (seen.length && !(await confirmBox(`${c.companyName} already has ${seen.length === 1 ? "a payment" : "payments"} like this:\n${seen.slice(0, 4).join("\n")}\n\nRecord ${fmtMoney(amt)} again? Cancel if it is the same payment.`))) return;
    setSaving(true);
    try {
      if (onSave) {
        if ((await onSave(v)) === false) return;
      } else {
        // A client's money, as a numbered receipt (as Payments → Receive always recorded it).
        const receipt = await createReceipt({
          clientId, amountUsd: amt, date: v.at, method,
          remarks: v.remark || undefined,
          lockerId, lockerAmount: depositAmount, lockerCurrency,
          exchangeRate: v.exchangeRate,
          invoiceId: v.invoiceId,
          invoiceIds: v.invoiceIds,
          bankChargesUsd: v.bankChargesUsd,
          userId: user!.id,
        });
        updateDb(d => notifyClientPayment(d, clientId, amt, method, v.invoiceIds ?? v.invoiceId, v.at));
        toast.success(`Receipt ${receipt.receiptNo} — ${fmtMoney(amt)} received from ${c.companyName}`);
      }
      try { localStorage.setItem(lastLockerKey(user!.id), lockerId); } catch { /* private window */ }
      onOpenChange(false);
    } finally { setSaving(false); }
  };

  // What saving will do. One order: on it up to its balance, the rest their credit.
  // A client's money: with an invoice named, it (and credit they hold) goes onto
  // that invoice up to what it owes, the rest is their credit; with none, all credit.
  const amt0 = Number(amount) || 0;
  const heldCredit = db.clients.find(x => x.id === clientId)?.creditBalance || 0;
  const orderBal = order ? balanceDue(order) : 0;
  const onOrder = order ? r2(Math.min(amt0, orderBal)) : 0;
  // The bills it goes on: the one named, or the ticked ones.
  const named = several ? picked : invoiceId ? [invoiceId] : [];
  const invoiceDue = named.reduce((t, iid) => t + (openInvoices.find(x => x.inv.id === iid)?.bal ?? 0), 0);
  const onInvoice = named.length ? r2(Math.min(amt0 + heldCredit, invoiceDue)) : 0;
  const creditAfter = order ? r2(heldCredit + amt0 - onOrder) : r2(amt0 + heldCredit - onInvoice);
  const fee0 = withExtras ? Number(fee) || 0 : 0;
  // Unknown until there is a rate — never shown as if the dollars landed unconverted.
  const depositPreview = !amount ? null : needsRate ? (rate > 0 ? roundCcy(Number(amount) * rate, lockerCurrency) : null) : Number(amount);
  const clientName = db.clients.find(c => c.id === clientId)?.companyName;

  return frame({
    open, onOpenChange, size: "md", icon: CreditCard,
    title: title ?? "Receive payment",
    description: description ?? (forNewOrder ? `The advance on this new order${clientName ? ` from ${clientName}` : ""} — saved with the order when it is placed` : order ? `${order.orderNumber}${clientName ? ` · ${clientName}` : ""} — ${fmtMoney(orderBal)} still to pay` : clientName ? `From ${clientName}, as a numbered receipt` : "From a client, as a numbered receipt"),
    footer: (
      <div className="space-y-3">
        {amount && lockerId && (
          <div className="grid grid-cols-3 gap-3">
            <div className="min-w-0">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Received</p>
              <p className="font-medium text-foreground tabular-nums break-words">{fmtMoney(amt0)}</p>
            </div>
            <div className="min-w-0">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{forNewOrder ? "Advance on the new order" : order ? "On this order" : named.length > 1 ? `On ${named.length} invoices` : named.length ? "On the invoice" : "Held as credit"}</p>
              <p className="font-semibold text-primary tabular-nums break-words">{fmtMoney(order ? onOrder : named.length ? onInvoice : amt0)}</p>
              {!forNewOrder && (order ? amt0 - onOrder > 0.005 : named.length ? creditAfter > 0.005 || heldCredit > 0.005 : heldCredit > 0.005) && (
                <p className="text-[11px] text-muted-foreground tabular-nums">Credit after: {fmtMoney(creditAfter)}</p>
              )}
            </div>
            {depositPreview != null && locker && (
              <div className="min-w-0">
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground break-words">Deposited to {locker.name}</p>
                <p className="font-semibold text-foreground tabular-nums break-words">{fmtCcy(depositPreview, lockerCurrency)}</p>
                {fee0 > 0 && <p className="text-[11px] text-muted-foreground tabular-nums">Bank charges −{fmtMoney(fee0)} (Expenses)</p>}
              </div>
            )}
          </div>
        )}
        <div className="flex items-center justify-end gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} className="rounded-xl h-10 flex-1 sm:flex-none">Cancel</Button>
          <AsyncButton onClick={submit} disabled={saving} className="btn-hero rounded-xl h-10 flex-1 sm:flex-none sm:px-8">{saving ? "Saving…" : forNewOrder ? "Add to the order" : "Record Payment Received"}</AsyncButton>
        </div>
      </div>
    ),
    children: (
      <div className="space-y-3">
        {/* Two columns from a small tablet up; one on a phone, where the panel is the whole screen. */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {!order && !fixedClient && (
            <div>
              <Label className="text-xs">Client</Label>
              <Select value={clientPick} onValueChange={addNew("client", setClientId)}>
                <SelectTrigger className="h-10 rounded-xl mt-1"><SelectValue placeholder="Choose client" /></SelectTrigger>
                <SelectContent>{clients.map(c => <SelectItem key={c.id} value={c.id}>{c.companyName}</SelectItem>)}<AddNewItem kind="client" /></SelectContent>
              </Select>
            </div>
          )}

          {clientId && openInvoices.length > 0 && (
            <div>
              <Label className="text-xs">Against {invoiceId && !presetInvoice ? <span className="text-success">(auto-selected)</span> : ""}</Label>
              <Select value={several ? "__several" : invoiceId || "fifo"}
                onValueChange={v => {
                  if (v === "__several") { setSeveral(true); setInvoiceId(""); tickToCover(Number(amount) || 0); return; }
                  setSeveral(false); setInvoiceId(v === "fifo" ? "" : v);
                }}>
                <SelectTrigger className="h-10 rounded-xl mt-1" aria-label="Against"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {/* No invoice named means the money is simply held on the client's account. */}
                  <SelectItem value="fifo">No invoice — hold as credit</SelectItem>
                  {canSeveral && <SelectItem value="__several">Several invoices — oldest first ({openUnpaid.length} open)</SelectItem>}
                  {openInvoices.map(({ inv, bal }) => (
                    <SelectItem key={inv.id} value={inv.id}>
                      Invoice {inv.number} — {bal > 0 ? `${fmtMoney(bal)} pending` : "settled"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div>
            <Label htmlFor="rcv-date" className="text-xs">Date</Label>
            <Input id="rcv-date" type="date" min={openMin()} value={date} onChange={e => setDate(e.target.value)} className="rounded-xl h-10 mt-1" />
          </div>
          <div>
            <Label htmlFor="rcv-amount" className="text-xs">Amount Received ($)</Label>
            <div className="relative mt-1">
              <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input id="rcv-amount" type="number" min={0} step="0.01" value={amount} onChange={e => setAmount(e.target.value)} className="pl-9 h-10 rounded-xl" />
            </div>
          </div>

          <div>
            <Label className="text-xs">Method</Label>
            <ListCombo list="paymentMethods" value={method} onChange={setMethod} optional={false} className="h-10 rounded-xl mt-1" ariaLabel="Method" />
          </div>

          {!fixedLocker && (
            <div>
              <Label className="text-xs">Deposited to account *</Label>
              <Select value={lockerPick} onValueChange={addNew("locker", v => { setLockerId(v); setExchangeRate(""); })}>
                <SelectTrigger className="h-10 rounded-xl mt-1" aria-label="Deposited to account"><SelectValue placeholder="Choose account" /></SelectTrigger>
                <SelectContent>{db.lockers.filter(l => l.active !== false).map(l => <SelectItem key={l.id} value={l.id}>{l.name} ({ccy(l.currency)})</SelectItem>)}<AddNewItem kind="locker" /></SelectContent>
              </Select>
            </div>
          )}

          <div className={fixedLocker ? "" : "sm:col-span-2"}>
            <Label htmlFor="rcv-note" className="text-xs">Remark / ref</Label>
            <Input id="rcv-note" value={note} onChange={e => setNote(e.target.value)} className="rounded-xl h-10 mt-1" placeholder="optional" />
          </div>

          {/* The invoices it pays — ticked; the oldest first are pre-ticked to cover the amount. */}
          {several && (
            <div className="sm:col-span-2 rounded-xl border border-border/70 p-3 space-y-1.5" role="group" aria-label="Invoices it pays">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-medium text-brand-dark">Invoices it pays — oldest first</p>
                <button type="button" className="text-[11px] text-primary hover:underline" onClick={() => tickToCover(Number(amount) || 0)}>Tick to cover the amount</button>
              </div>
              {oldestFirst.map(({ inv, bal }) => (
                <label key={inv.id} className="flex items-center gap-2.5 text-sm cursor-pointer">
                  <input type="checkbox" className="h-4 w-4 accent-primary" checked={picked.includes(inv.id)}
                    onChange={e => setPicked(p => (e.target.checked ? [...p, inv.id] : p.filter(x => x !== inv.id)))} />
                  <span className="flex-1 min-w-0 truncate">Invoice {inv.number} <span className="text-muted-foreground text-xs">· {fmtDate(inv.createdAt)}</span></span>
                  <span className="tabular-nums text-xs font-medium">{fmtMoney(bal)}</span>
                </label>
              ))}
              <p className="text-[11px] text-muted-foreground">Ticked: {fmtMoney(invoiceDue)} owed. Paid in this order; anything over is held as credit.</p>
            </div>
          )}

          {/* What the banks kept on the way: the client is credited the whole payment. */}
          {withExtras && (
            <div>
              <Label htmlFor="rcv-fee" className="text-xs">Bank charges kept ($) <span className="font-normal text-muted-foreground">· optional</span></Label>
              <Input id="rcv-fee" type="number" min={0} step="0.01" value={fee} onChange={e => setFee(e.target.value)} className="rounded-xl h-10 mt-1" placeholder="0" />
              {fee0 > 0 && <p className="text-[11px] text-muted-foreground mt-1">They are credited {fmtMoney(amt0)}; {fmtMoney(fee0)} goes to Expenses as Bank Charges, so the account shows what arrived.</p>}
            </div>
          )}

          {needsRate && (
            <div className="sm:col-span-2 p-3 rounded-xl bg-secondary">
              <RateInput id="rcv-rate" from="USD" to={lockerCurrency} value={exchangeRate} onChange={setExchangeRate}
                amount={Number(amount) || undefined} at={date} />
              <p className="text-xs text-muted-foreground mt-1">This account holds {lockerCurrency} — enter the USD rate.</p>
            </div>
          )}
        </div>

        {clientId && openInvoices.length > 0 && (
          <p className="text-[11px] text-muted-foreground">
            {several ? `Pays ${picked.length} invoice${picked.length === 1 ? "" : "s"}, oldest first; anything over is held as credit.`
              : invoiceId ? "Settles that invoice; anything over is held as credit." : "Held as credit — pick an invoice to settle one."}
          </p>
        )}
        {order && (
          <p className="text-[11px] text-muted-foreground">On this order up to what it still owes ({fmtMoney(orderBal)}); anything over is held as the client's credit.</p>
        )}
      </div>
    ),
  });
}
