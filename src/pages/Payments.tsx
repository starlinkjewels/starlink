import { materialUnit } from "@/lib/materials";
import { AddNewItem, useAddNew } from "@/components/create/QuickCreate";
import { useCan } from "@/hooks/useCan";
import { useEffect, useLayoutEffect, useState, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import { useAuth } from "@/lib/auth";
import {
  updateDb, uid, fmtMoney,
  invoiceOrderIds, balanceDue, type Order, type Expense, type Locker, type LockerTransaction,
  DEFAULT_LOCKER_CATEGORIES, todayLocal, stampFor, dayOf,
} from "@/lib/db";
import { useDb } from "@/hooks/useDb";
import { createReceipt } from "@/lib/receipts";
import { reserveVoucherNumber } from "@/lib/counters";
import { ReceiptLedger } from "@/components/ReceiptLedger";
import { MoneyLedger } from "@/components/MoneyLedger";
import { DayBook } from "@/components/DayBook";
import { ActionSheet } from "@/components/ActionSheet";
import { PageHeader, ScrollRow, TabBar } from "@/components/PageHeader";
import {
  supplierAccount, purchasePending, allocateSupplierPaymentFIFO,
  factoryAccount, issuancePending, allocateFactoryChargePaymentFIFO,
  fmtMoneyInr, lockerBalance,
} from "@/lib/manufacturing";
import { lockerFigure } from "@/lib/partyTotals";
import { ccy, ccySymbol, fmtCcy, fmtCcyMix, rateFields, roundCcy, sumByCcy } from "@/lib/currency";
import { RateInput } from "@/components/CurrencyFields";
import { Button } from "@/components/ui/button";
import { AsyncButton } from "@/components/AsyncButton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  CreditCard, Truck, Factory as FactoryIcon, Receipt, DollarSign, Landmark, BookOpen, Wallet,
  ArrowLeftRight, ArrowDownCircle, ArrowUpCircle, ListOrdered,
} from "lucide-react";
import { toast } from "sonner";
import { confirmBox } from "@/lib/confirm";

/** Today as yyyy-mm-dd for a date input, in LOCAL time — toISOString() would
 *  roll back a day for anyone east of UTC after midday. */
// todayLocal / stampFor now live in src/lib/db.ts, shared with Buy & Assign.


/** The ledgers the page reads — one at a time, under the tab bar. */
type Book = "daybook" | "received" | "supplier" | "factory" | "expense" | "locker";
/** The forms that slide in over it. */
type Task = "client" | "supplier" | "factory" | "expense" | "locker";

const BOOKS = [
  { key: "daybook", label: "Day book", icon: BookOpen },
  { key: "received", label: "Received", icon: CreditCard },
  { key: "supplier", label: "Supplier payments", icon: Truck },
  { key: "factory", label: "Factory payments", icon: FactoryIcon },
  { key: "expense", label: "Expenses", icon: Receipt },
  { key: "locker", label: "Account entries", icon: ListOrdered },
] as const;

/** What a form's panel is given: whether it is open, and how to close it. */
type SheetProps = { open: boolean; onOpenChange: (open: boolean) => void };

const DEFAULT_EXPENSE_CATEGORIES = ["Travel", "Food", "Tools", "Office", "Communication", "Other"];
// The fallback list is the one in db.ts, shared with Settings → Categories.
// This file used to keep its own copy, so a category added to the shared list
// never appeared here until someone edited the list in Settings.

/** Warn before a payment takes a locker's balance negative (money it doesn't hold).
 *  Returns true to proceed, false to cancel. `amt` is in the locker's own currency. */
async function confirmOverdraw(lockers: Locker[], transactions: LockerTransaction[], lockerId: string, amt: number): Promise<boolean> {
  const locker = lockers.find(l => l.id === lockerId);
  if (!locker) return true;
  const bal = lockerBalance(locker, transactions);
  if (amt > bal) {
    return (await confirmBox(
      `This payment of ${fmtCcy(amt, locker.currency)} is more than ${locker.name}'s balance of ${fmtCcy(bal, locker.currency)}.\n\nThe locker will go negative — continue only if you're sure a deposit is still missing.`,
    ));
  }
  return true;
}

/**
 * One place to move money in or out, no matter who's on the other end —
 * every path here mirrors the recording logic already on ClientHistory.tsx /
 * SupplierHistory.tsx / FactoryHistory.tsx / Expenses.tsx rather than
 * centralizing it, so this page is purely additive and can't destabilize
 * those four already-working flows. Every path requires a Locker.
 */
export function PaymentsPage() {
  const db = useDb();
  const can = useCan();
  const mayAdd = can("payments", "add");
  // The day book opens first: it is the one view that shows the whole day, and
  // it is what gets checked against the written rojmel.
  const [book, setBook] = useState<Book>("daybook");
  // "Open in Expenses →" on a row corrected elsewhere lands here with
  // ?book=expense: that tab opens, and the address is tidied so the same
  // link works again later.
  const [params, setParams] = useSearchParams();
  const wantBook = params.get("book");
  useEffect(() => {
    if (!wantBook) return;
    if (BOOKS.some(b => b.key === wantBook)) setBook(wantBook as Book);
    setParams(p => { p.delete("book"); return p; }, { replace: true });
  }, [wantBook, setParams]);
  // Every payment is a panel over the page, so the ledger being read stays put
  // underneath it and shows the new entry the moment it is saved.
  const [task, setTask] = useState<Task | null>(null);
  const [lockerAction, setLockerAction] = useState<LockerAction>("transfer_out");
  // The day book's account, chosen from the balances strip. Resolved on every
  // render, the way the day book itself does, so it never sits on "no account"
  // when the accounts arrive a moment after the page.
  const [bookPick, setBookPick] = useState("");

  const activeLockers = db.lockers.filter(l => l.active !== false);
  const bookLockerId = activeLockers.some(l => l.id === bookPick) ? bookPick : (activeLockers[0]?.id ?? "");

  // Today's money in and out across the accounts, each currency kept apart.
  // Transfers are left out: money moved between two of our own accounts
  // neither came in nor went out.
  const today = todayLocal();
  const activeIds = new Set(activeLockers.map(l => l.id));
  const todays = (db.lockerTransactions ?? []).filter(t => activeIds.has(t.lockerId) && dayOf(t.createdAt) === today);
  const todayIn = sumByCcy(todays.filter(t => t.type === "income"), t => t.amountInr, t => t.currency ?? db.lockers.find(l => l.id === t.lockerId)?.currency);
  const todayOut = sumByCcy(todays.filter(t => t.type === "expense"), t => t.amountInr, t => t.currency ?? db.lockers.find(l => l.id === t.lockerId)?.currency);
  const moved = (m: Map<string, number>) => [...m.values()].some(v => Math.abs(v) > 0.0001);

  const sheet = (t: Task): SheetProps => ({ open: task === t, onOpenChange: o => { if (!o) setTask(null); } });
  const openLocker = (a: LockerAction) => { setLockerAction(a); setTask("locker"); };

  return (
    <div className="max-w-7xl mx-auto space-y-5">
      {/* One main button (money in), one group for money out, the account
          moves in the ⋯ — three controls, one row, on every screen. */}
      <PageHeader
        title="Payments"
        subtitle="Every payment in or out"
        primary={mayAdd ? { label: "Receive from Client", icon: CreditCard, onClick: () => setTask("client") } : null}
        secondary={mayAdd ? { label: "Pay", icon: Wallet, items: [
          { label: "Pay a supplier", icon: Truck, hint: "A bill, or an advance", onSelect: () => setTask("supplier") },
          { label: "Pay a factory", icon: FactoryIcon, hint: "Making charges, or an advance", onSelect: () => setTask("factory") },
          { label: "Pay an expense", icon: Receipt, hint: "Rent, salary, courier…", onSelect: () => setTask("expense") },
        ] } : null}
        menuTitle="Accounts"
        menu={mayAdd ? [
          { label: "Transfer between accounts", icon: ArrowLeftRight, hint: "Any two accounts, any currencies", onSelect: () => openLocker("transfer_out") },
          { label: "Deposit to an account", icon: ArrowDownCircle, hint: "Not a client's receipt", onSelect: () => openLocker("income") },
          { label: "Withdraw from an account", icon: ArrowUpCircle, hint: "Not a bill or an expense", onSelect: () => openLocker("expense") },
        ] : undefined}
      >
        {!mayAdd && <p className="text-xs text-muted-foreground mt-1">View only — your role can't record entries.</p>}
      </PageHeader>

      {activeLockers.length === 0 && (
        <div className="card-luxe p-4 text-sm text-amber-700 bg-amber-50 border border-amber-200">
          No accounts yet — add one on the Locker page first. Every payment goes through one.
        </div>
      )}

      {/* Balances, one tile per account in its own currency. A tile opens that
          account's day book. On a phone the row scrolls sideways inside itself. */}
      {activeLockers.length > 0 && (
        <ScrollRow className="flex gap-2 p-0.5 sm:p-0 sm:grid sm:grid-cols-[repeat(auto-fit,minmax(11rem,1fr))] sm:overflow-visible">
          <div className="card-luxe snap-start shrink-0 flex-1 min-w-[11.5rem] sm:min-w-0 px-4 py-3">
            <p className="text-[11px] uppercase tracking-wider text-muted-foreground">Today</p>
            {/* Nothing yet today reads grey, not as money in or out. */}
            <p className={`mt-1 text-sm font-semibold tabular-nums break-words ${moved(todayIn) ? "text-success" : "text-muted-foreground"}`}><span className="text-[11px] font-medium text-muted-foreground">In </span>{fmtCcyMix(todayIn)}</p>
            <p className={`text-sm font-semibold tabular-nums break-words ${moved(todayOut) ? "text-destructive" : "text-muted-foreground"}`}><span className="text-[11px] font-medium text-muted-foreground">Out </span>{fmtCcyMix(todayOut)}</p>
            <p className="text-[10px] text-muted-foreground mt-0.5">Transfers left out</p>
          </div>
          {activeLockers.map(l => {
            const bal = lockerFigure(db, l);
            const on = book === "daybook" && l.id === bookLockerId;
            const Icon = l.type === "bank" ? Landmark : Wallet;
            return (
              <button key={l.id} type="button" aria-pressed={on} title={`${l.name} — open its day book`}
                onClick={() => { setBookPick(l.id); setBook("daybook"); }}
                className={`card-luxe snap-start shrink-0 flex-1 min-w-[11.5rem] sm:min-w-0 px-4 py-3 text-left transition-shadow ${on ? "ring-2 ring-primary" : "hover:shadow-md"}`}>
                <span className="flex items-start gap-1.5 text-[11px] text-muted-foreground leading-snug">
                  <Icon className="h-3.5 w-3.5 mt-px shrink-0" /><span className="line-clamp-2 break-words">{l.name}</span>
                </span>
                <span className={`block mt-1 font-display text-xl font-bold tabular-nums leading-tight ${bal < 0 ? "text-destructive" : "text-brand-dark"}`}>{fmtCcy(bal, l.currency)}</span>
                <span className="block text-[11px] text-muted-foreground mt-0.5">{ccy(l.currency)}{l.type === "bank" && l.accountNumberLast4 ? ` · ····${l.accountNumberLast4}` : ""}</span>
              </button>
            );
          })}
        </ScrollRow>
      )}

      <div className="space-y-3">
        <TabBar label="Ledgers" tabs={BOOKS} value={book} onChange={setBook} />
        <div role="tabpanel">
          {book === "daybook" && <DayBook lockerId={bookLockerId} />}
          {book === "received" && <ReceiptLedger />}
          {book === "supplier" && <MoneyLedger kind="supplier" />}
          {book === "factory" && <MoneyLedger kind="factory" />}
          {book === "expense" && <MoneyLedger kind="expense" />}
          {book === "locker" && <MoneyLedger kind="locker" />}
        </div>
      </div>

      {/* Mounted for as long as the page is, so a panel closed by mistake opens
          again with what was typed. Saving clears the form and closes it. */}
      {mayAdd && (
        <>
          <ReceiveFromClient {...sheet("client")} />
          <PaySupplier {...sheet("supplier")} />
          <PayFactory {...sheet("factory")} />
          <PayExpense {...sheet("expense")} />
          <LockerActions {...sheet("locker")} preset={lockerAction} />
        </>
      )}
    </div>
  );
}

/** The bottom of every payment panel: what it adds up to, then Cancel and the
 *  button that saves it. */
function PanelFooter({ summary, onCancel, children }: { summary?: ReactNode; onCancel: () => void; children: ReactNode }) {
  return (
    <div className="space-y-3">
      {summary}
      <div className="flex items-center justify-end gap-2">
        <Button variant="outline" onClick={onCancel} className="rounded-xl h-10 flex-1 sm:flex-none">Cancel</Button>
        {children}
      </div>
    </div>
  );
}

/** The amount being moved, and what the account holds once it is saved — the
 *  overdraw question answered before the button rather than after it. */
function MoveSummary({ label, value, tone, lockerId, change }: {
  label: string; value: string; tone: "in" | "out"; lockerId: string; change: number;
}) {
  const db = useDb();
  const l = db.lockers.find(x => x.id === lockerId);
  const bal = l ? lockerBalance(l, db.lockerTransactions) : 0;
  const after = bal + change;
  return (
    <div className="flex items-end justify-between gap-3 flex-wrap">
      <div className="min-w-0">
        <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
        <p className={`font-display text-xl font-bold tabular-nums leading-tight ${tone === "in" ? "text-success" : "text-destructive"}`}>{value}</p>
      </div>
      {l && (
        <p className="text-xs text-muted-foreground text-right">
          {l.name}: {fmtCcy(bal, l.currency)} → <span className={`font-semibold ${after < 0 ? "text-destructive" : "text-foreground"}`}>{fmtCcy(after, l.currency)}</span>
        </p>
      )}
    </div>
  );
}

/** The main button's look in a panel footer — full width beside Cancel on a phone. */
const SAVE_BTN = "btn-hero rounded-xl h-10 flex-1 sm:flex-none sm:px-8";

/* ── Receive from Client — mirrors ClientHistory.tsx's recordPayment ── */
function ReceiveFromClient({ open, onOpenChange }: SheetProps) {
  const { user } = useAuth();
  const db = useDb();
  const addNew = useAddNew();
  const [clientId, setClientId] = useState("");
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("Cash");
  const [note, setNote] = useState("");
  const [lockerId, setLockerId] = useState("");
  // 1 USD in the locker's currency. Cleared when the locker changes, so a rate
  // typed for one currency is never saved against another.
  const [exchangeRate, setExchangeRate] = useState<number | "">("");
  // Money sent to settle ONE invoice should clear THAT invoice. Without this the
  // payment went oldest-bill-first and the invoice the client just paid for could
  // still read as pending.
  const [invoiceId, setInvoiceId] = useState("");
  const [saving, setSaving] = useState(false);
  // Entries are often written up a day or two later, so the date is chosen
  // rather than assumed to be today.
  const [date, setDate] = useState(todayLocal());

  const clients = db.clients.filter(c => c.status === "active").sort((a, b) => a.companyName.localeCompare(b.companyName));
  const openInvoices = clientId
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
    setInvoiceId(openUnpaid.length === 1 ? openUnpaid[0].inv.id : "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId]);

  const locker = db.lockers.find(l => l.id === lockerId);
  const lockerCurrency = ccy(locker?.currency);
  // A client always pays in USD (that's what the order is billed in) — any
  // other locker (rupees, dirhams, euros…) needs converting for the deposit side.
  const needsRate = !!locker && lockerCurrency !== "USD";
  const rate = Number(exchangeRate);

  const submit = async () => {
    const c = db.clients.find(x => x.id === clientId);
    if (!c) { toast.error("Choose a client"); return; }
    const amt = parseFloat(amount);
    if (!amt || amt <= 0) { toast.error("Enter a valid amount"); return; }
    if (!lockerId) { toast.error("Choose which locker this was deposited into"); return; }
    if (needsRate && (!rate || rate <= 0)) { toast.error("Enter the exchange rate before saving this payment"); return; }
    // The rate is "1 USD = rate of the locker's currency".
    const depositAmt = needsRate ? roundCcy(amt * rate, lockerCurrency) : amt;
    setSaving(true);
    try {
      const noteText = note.trim() ? `${method} · ${note.trim()}` : method;
      const now = stampFor(date);
      // Recorded as a numbered receipt, so this payment can be looked up,
      // corrected or cancelled later as one entry.
      const receipt = await createReceipt({
        clientId, amountUsd: amt, date: now, method,
        remarks: note.trim() || undefined,
        lockerId, lockerAmount: depositAmt,
        lockerCurrency,
        exchangeRate: needsRate ? rate : undefined,
        invoiceId: invoiceId || undefined,
        userId: user!.id,
      });
      updateDb(d => {
        const clientUser = d.users.find(u => u.clientId === clientId);
        if (clientUser) d.notifications.unshift({
          id: uid("n_"), userId: clientUser.id, title: "Payment Received",
          // Says what happened: against the invoice named, or held as their credit.
          body: invoiceId
            ? `${fmtMoney(amt)} received via ${method} against invoice ${d.invoices.find(i => i.id === invoiceId)?.number ?? ""}.`.replace(" .", ".")
            : `${fmtMoney(amt)} received via ${method} — held as credit on your account.`,
          type: "info", read: false, createdAt: now,
        });
      });
      toast.success(`Receipt ${receipt.receiptNo} — ${fmtMoney(amt)} received from ${c.companyName}`);
      setClientId(""); setAmount(""); setNote(""); setLockerId(""); setExchangeRate(""); setInvoiceId(""); setDate(todayLocal());
      onOpenChange(false);
    } finally { setSaving(false); }
  };

  // Unknown until there is a rate — never shown as if the dollars landed unconverted.
  const depositPreview = !amount ? null : needsRate ? (rate > 0 ? roundCcy(Number(amount) * rate, lockerCurrency) : null) : Number(amount);

  return (
    <ActionSheet open={open} onOpenChange={onOpenChange} size="md" icon={CreditCard}
      title="Receive payment"
      description="From a client, as a numbered receipt"
      footer={
        <PanelFooter onCancel={() => onOpenChange(false)} summary={amount && lockerId ? (
          <div className="grid grid-cols-3 gap-3">
            <div className="min-w-0">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Received</p>
              <p className="font-medium text-foreground tabular-nums break-words">{fmtMoney(Number(amount))}</p>
            </div>
            <div className="min-w-0">
              {/* No invoice named: settleClientAccount holds it all as credit. */}
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{invoiceId ? "Against the invoice" : "Held as credit"}</p>
              <p className="font-semibold text-primary tabular-nums break-words">{fmtMoney(Number(amount))}</p>
            </div>
            {depositPreview != null && locker && (
              <div className="min-w-0">
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground break-words">Deposited to {locker.name}</p>
                <p className="font-semibold text-foreground tabular-nums break-words">{fmtCcy(depositPreview, lockerCurrency)}</p>
              </div>
            )}
          </div>
        ) : undefined}>
          <AsyncButton onClick={submit} disabled={saving} className={SAVE_BTN}>{saving ? "Saving…" : "Record Payment Received"}</AsyncButton>
        </PanelFooter>
      }>
    <div className="space-y-3">
      {/* Two columns from a small tablet up; one on a phone, where the panel is
          the whole screen. */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <Label className="text-xs">Client</Label>
          <Select value={clientId} onValueChange={addNew("client", setClientId)}>
            <SelectTrigger className="h-10 rounded-xl mt-1"><SelectValue placeholder="Choose client" /></SelectTrigger>
            <SelectContent>{clients.map(c => <SelectItem key={c.id} value={c.id}>{c.companyName}</SelectItem>)}<AddNewItem kind="client" /></SelectContent>
          </Select>
        </div>

        {clientId && openInvoices.length > 0 && (
          <div>
            <Label className="text-xs">Against {invoiceId ? <span className="text-success">(auto-selected)</span> : ""}</Label>
            <Select value={invoiceId || "fifo"} onValueChange={v => setInvoiceId(v === "fifo" ? "" : v)}>
              <SelectTrigger className="h-10 rounded-xl mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                {/* No invoice named means the money is simply held on the
                    client's account. It used to be spread over their oldest
                    bills, which moved payments they had already been shown. */}
                <SelectItem value="fifo">No invoice — hold as credit</SelectItem>
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
          <Label className="text-xs">Date</Label>
          <Input type="date" value={date} onChange={e => setDate(e.target.value)} className="rounded-xl h-10 mt-1" />
        </div>
        <div>
          <Label className="text-xs">Amount Received ($)</Label>
          <div className="relative mt-1">
            <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input type="number" min={0} step="0.01" value={amount} onChange={e => setAmount(e.target.value)} className="pl-9 h-10 rounded-xl" />
          </div>
        </div>

        <div>
          <Label className="text-xs">Method</Label>
          <Select value={method} onValueChange={setMethod}>
            <SelectTrigger className="h-10 rounded-xl mt-1"><SelectValue /></SelectTrigger>
            <SelectContent>{["Cash", "Bank Transfer", "Venmo", "Zelle", "Cheque", "Card", "Other"].map(m => <SelectItem key={m} value={m}>{m}</SelectItem>)}</SelectContent>
          </Select>
        </div>

        <div>
          <Label className="text-xs">Deposited to Locker *</Label>
          <Select value={lockerId} onValueChange={addNew("locker", v => { setLockerId(v); setExchangeRate(""); })}>
            <SelectTrigger className="h-10 rounded-xl mt-1"><SelectValue placeholder="Choose locker" /></SelectTrigger>
            <SelectContent>{db.lockers.filter(l => l.active !== false).map(l => <SelectItem key={l.id} value={l.id}>{l.name} ({ccy(l.currency)})</SelectItem>)}<AddNewItem kind="locker" /></SelectContent>
          </Select>
        </div>

        <div>
          <Label className="text-xs">Remark / ref</Label>
          <Input value={note} onChange={e => setNote(e.target.value)} className="rounded-xl h-10 mt-1" placeholder="optional" />
        </div>

        {needsRate && (
          <div className="sm:col-span-2 p-3 rounded-xl bg-secondary">
            <RateInput id="rcv-rate" from="USD" to={lockerCurrency} value={exchangeRate} onChange={setExchangeRate}
              amount={Number(amount) || undefined} at={date} />
            <p className="text-xs text-muted-foreground mt-1">This locker holds {lockerCurrency} — enter the USD rate.</p>
          </div>
        )}
      </div>

      {clientId && openInvoices.length > 0 && (
        <p className="text-[11px] text-muted-foreground">
          {/* What settleClientAccount does: the named invoice, the rest as credit. */}
          {invoiceId
            ? "Settles that invoice; anything over is held as credit."
            : "Held as credit — pick an invoice to settle one."}
        </p>
      )}
    </div>
    </ActionSheet>
  );
}

/* ── Pay Supplier — mirrors SupplierHistory.tsx's recordPayment ── */
function PaySupplier({ open, onOpenChange }: SheetProps) {
  const { user } = useAuth();
  const db = useDb();
  const addNew = useAddNew();
  const [dir, setDir] = useState<"pay" | "receive">("pay");
  const [supplierId, setSupplierId] = useState("");
  const [amount, setAmount] = useState("");
  const [target, setTarget] = useState("__fifo");
  const [note, setNote] = useState("");
  const [lockerId, setLockerId] = useState("");
  const [saving, setSaving] = useState(false);
  // Entries are often written up a day or two later, so the date is chosen
  // rather than assumed to be today.
  const [date, setDate] = useState(todayLocal());

  const suppliers = db.suppliers.filter(s => s.active !== false).sort((a, b) => a.name.localeCompare(b.name));
  const purchases = db.purchases.filter(p => p.supplierId === supplierId);
  const account = supplierAccount(
    purchases,
    (db.supplierReceipts ?? []).filter(r => r.supplierId === supplierId),
    db.suppliers.find(s => s.id === supplierId),
    (db.supplierPayments ?? []).filter(x => x.supplierId === supplierId),
  );
  const pendingPurchases = purchases.filter(p => purchasePending(p) > 0);

  const submit = async () => {
    const s = db.suppliers.find(x => x.id === supplierId);
    if (!s) { toast.error("Choose a supplier"); return; }
    const amt = Number(amount);
    if (!amt || amt <= 0) { toast.error("Enter a valid amount"); return; }
    if (!lockerId) { toast.error(dir === "pay" ? "Choose which locker this was paid from" : "Choose which locker the money went into"); return; }
    // Supplier bills are in rupees, so only a rupee locker can carry them (one
    // made from "+ Add new" in another currency would otherwise slip through).
    if (ccy(db.lockers.find(l => l.id === lockerId)?.currency) !== "INR") { toast.error("Supplier payments are in rupees — choose an INR locker"); return; }
    // ── Receive: money back FROM the supplier (refund / return credit). ──
    if (dir === "receive") {
      setSaving(true);
      try {
        const now = stampFor(date);
        updateDb(d => {
          if (!d.supplierReceipts) d.supplierReceipts = [];
          // The account movement is tagged with the receipt it belongs to, so
          // correcting it from the supplier tab moves both and the Locker tab
          // sends you there rather than letting the two drift apart.
          const receiptId = uid("srcpt_");
          d.supplierReceipts.push({ id: receiptId, supplierId, amountInr: amt, lockerId, recordedBy: user!.id, createdAt: now, note: note.trim() || undefined });
          if (!d.lockerTransactions) d.lockerTransactions = [];
          d.lockerTransactions.push({ id: uid("ltx_"), lockerId, type: "income", amountInr: amt, currency: "INR", category: `Received from ${s.name}`, refType: "supplierReceipt", refId: supplierId, paymentId: receiptId, note: note.trim() || undefined, recordedBy: user!.id, createdAt: now });
        });
        toast.success(`${fmtMoneyInr(amt)} received from ${s.name}`);
        setSupplierId(""); setAmount(""); setTarget("__fifo"); setNote(""); setLockerId(""); setDate(todayLocal());
        onOpenChange(false);
      } finally { setSaving(false); }
      return;
    }
    // ── Pay: money out TO the supplier. ──
    // Overpayment is allowed — the excess beyond what's owed is recorded as an
    // overpay on the newest purchase, never silently lost.
    if (!(await confirmOverdraw(db.lockers, db.lockerTransactions, lockerId, amt))) return;
    setSaving(true);
    try {
      const now = stampFor(date);
      updateDb(d => {
        const supplierPurchases = d.purchases.filter(p => p.supplierId === supplierId);
        const asAdvance = (sum: number) => {
          if (!d.supplierPayments) d.supplierPayments = [];
          d.supplierPayments.push({ id: uid("spay_"), supplierId, amountInr: sum, lockerId, recordedBy: user!.id, createdAt: now, note: note.trim() || undefined });
        };
        if (target === "__advance") {
          asAdvance(amt);
        } else if (target === "__fifo") {
          const leftover = allocateSupplierPaymentFIFO(supplierPurchases, amt, lockerId, user!.id, now, note.trim() || undefined);
          if (leftover > 0) {
            const newest = [...supplierPurchases].sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt))[0];
            if (newest) {
              if (!newest.payments) newest.payments = [];
              newest.payments.push({ id: uid("ppay_"), amountInr: leftover, lockerId, recordedBy: user!.id, createdAt: now, note: note.trim() || undefined });
            } else {
              // Nothing to settle — a supplier with no bills at all. Standing on
              // its own is the only place this money can go; it used to vanish.
              asAdvance(leftover);
            }
          }
        } else {
          const p = d.purchases.find(p => p.id === target);
          if (p) {
            if (!p.payments) p.payments = [];
            p.payments.push({ id: uid("ppay_"), amountInr: amt, lockerId, recordedBy: user!.id, createdAt: now, note: note.trim() || undefined });
          } else {
            // The bill went while the form was open. The money still left the
            // account, so it is booked as an advance rather than discarded.
            asAdvance(amt);
          }
        }
        if (!d.lockerTransactions) d.lockerTransactions = [];
        d.lockerTransactions.push({
          id: uid("ltx_"), lockerId, type: "expense", amountInr: amt, currency: "INR",
          category: `Supplier Payment — ${s.name}`, refType: "purchase",
          refId: target === "__fifo" || target === "__advance" ? undefined : target,
          note: note.trim() || undefined, recordedBy: user!.id, createdAt: now,
        });
      });
      toast.success(`${fmtMoneyInr(amt)} paid to ${s.name}`);
      setSupplierId(""); setAmount(""); setTarget("__fifo"); setNote(""); setLockerId(""); setDate(todayLocal());
      onOpenChange(false);
    } finally { setSaving(false); }
  };

  const typed = Number(amount) || 0;
  return (
    <ActionSheet open={open} onOpenChange={onOpenChange} size="md" icon={Truck}
      title="Supplier payment"
      description="Bills or refunds, in rupees"
      footer={
        <PanelFooter onCancel={() => onOpenChange(false)} summary={typed > 0 ? (
          <MoveSummary label={dir === "pay" ? "Paying" : "Receiving"} value={fmtMoneyInr(typed)} tone={dir === "pay" ? "out" : "in"}
            lockerId={lockerId} change={dir === "pay" ? -typed : typed} />
        ) : undefined}>
          <AsyncButton onClick={submit} disabled={saving} className={SAVE_BTN}>{saving ? "Saving…" : dir === "pay" ? "Record Supplier Payment" : "Record Supplier Receipt"}</AsyncButton>
        </PanelFooter>
      }>
    <div className="space-y-3">
      {/* Direction — pay the supplier, or receive money back (refund/return). */}
      <div className="grid grid-cols-2 gap-1 p-1 bg-secondary rounded-xl">
        {(["pay", "receive"] as const).map(d => (
          <button key={d} type="button" onClick={() => setDir(d)}
            className={`h-9 rounded-lg text-sm font-medium transition-colors ${dir === d ? "bg-white shadow-soft text-brand-dark" : "text-muted-foreground"}`}>
            {d === "pay" ? "Pay supplier" : "Receive from supplier"}
          </button>
        ))}
      </div>

      <div>
        <Label className="text-xs">Supplier</Label>
        <Select value={supplierId} onValueChange={addNew("supplier", v => { setSupplierId(v); setTarget("__fifo"); })}>
          <SelectTrigger className="h-10 rounded-xl mt-1"><SelectValue placeholder="Choose supplier" /></SelectTrigger>
          <SelectContent>{suppliers.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}<AddNewItem kind="supplier" /></SelectContent>
        </Select>
      </div>
      {supplierId && (
        <p className="text-xs text-muted-foreground">
          {account.net < 0
            ? <>Supplier owes you: <span className="font-semibold text-blue-600">{fmtMoneyInr(-account.net)}</span></>
            : <>Balance owed: <span className="font-semibold text-foreground">{fmtMoneyInr(account.net)}</span></>}
        </p>
      )}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label className="text-xs">Date</Label>
          <Input type="date" value={date} onChange={e => setDate(e.target.value)} className="rounded-xl h-10 mt-1" />
        </div>
        <div>
          <Label className="text-xs">Amount (₹)</Label>
          <Input type="number" min={1} value={amount} onChange={e => setAmount(e.target.value)} className="rounded-xl h-10 mt-1" />
        </div>
        {dir === "pay" && (
          // Full width: "Advance / loan — not against any bill" has to be readable.
          <div className="col-span-2">
            <Label className="text-xs">Against</Label>
            <Select value={target} onValueChange={setTarget}>
              <SelectTrigger className="h-10 rounded-xl mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__fifo">Oldest pending first</SelectItem>
                <SelectItem value="__advance">Advance / loan — not against any bill</SelectItem>
                {pendingPurchases.map(p => <SelectItem key={p.id} value={p.id}>{p.invoiceNumber || p.id.slice(-6)} — pending {fmtMoneyInr(purchasePending(p))}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        )}
      </div>
      <Input value={note} onChange={e => setNote(e.target.value)} className="rounded-xl h-10" placeholder={dir === "pay" ? "Note (optional)" : "Note (e.g. refund for returned goods)"} />
      <div>
        <Label className="text-xs">{dir === "pay" ? "Paid from Locker *" : "Received into Locker *"}</Label>
        <Select value={lockerId} onValueChange={addNew("locker", setLockerId)}>
          <SelectTrigger className="h-10 rounded-xl mt-1"><SelectValue placeholder="Choose locker" /></SelectTrigger>
          <SelectContent>{db.lockers.filter(l => l.active !== false && (l.currency || "INR") === "INR").map(l => <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>)}<AddNewItem kind="locker" /></SelectContent>
        </Select>
      </div>
    </div>
    </ActionSheet>
  );
}

/* ── Pay Factory — mirrors FactoryHistory.tsx's payCharge / FIFO ── */
function PayFactory({ open, onOpenChange }: SheetProps) {
  const { user } = useAuth();
  const db = useDb();
  const addNew = useAddNew();
  const [factoryId, setFactoryId] = useState("");
  const [amount, setAmount] = useState("");
  const [target, setTarget] = useState("__fifo");
  const [note, setNote] = useState("");
  const [lockerId, setLockerId] = useState("");
  const [saving, setSaving] = useState(false);
  // Entries are often written up a day or two later, so the date is chosen
  // rather than assumed to be today.
  const [date, setDate] = useState(todayLocal());

  const factories = db.factories.filter(f => f.active !== false).sort((a, b) => a.name.localeCompare(b.name));
  const issuances = db.materialIssuances.filter(i => i.factoryId === factoryId);
  const account = factoryAccount(
    issuances,
    db.factories.find(f => f.id === factoryId),
    (db.factoryPayments ?? []).filter(x => x.factoryId === factoryId),
  );
  const pendingIssuances = issuances.filter(i => issuancePending(i) > 0);

  const submit = async () => {
    const f = db.factories.find(x => x.id === factoryId);
    if (!f) { toast.error("Choose a factory"); return; }
    const amt = Number(amount);
    if (!amt || amt <= 0) { toast.error("Enter a valid amount"); return; }
    if (!lockerId) { toast.error("Choose which locker this was paid from"); return; }
    // Making charges are in rupees, so only a rupee locker can pay them.
    if (ccy(db.lockers.find(l => l.id === lockerId)?.currency) !== "INR") { toast.error("Factory payments are in rupees — choose an INR locker"); return; }
    // Overpayment is allowed (you can pay more than currently owed) — the extra
    // is recorded as an advance/overpay, never silently lost.
    if (!(await confirmOverdraw(db.lockers, db.lockerTransactions, lockerId, amt))) return;
    setSaving(true);
    try {
      const now = stampFor(date);
      updateDb(d => {
        const factoryIssuances = d.materialIssuances.filter(i => i.factoryId === factoryId);
        const asAdvance = (sum: number) => {
          if (!d.factoryPayments) d.factoryPayments = [];
          d.factoryPayments.push({ id: uid("fadv_"), factoryId, amountInr: sum, lockerId, recordedBy: user!.id, createdAt: now, note: note.trim() || undefined });
        };
        if (target === "__advance") {
          asAdvance(amt);
        } else if (target === "__fifo") {
          const leftover = allocateFactoryChargePaymentFIFO(factoryIssuances, amt, lockerId, user!.id, now, note.trim() || undefined);
          if (leftover > 0) {
            // Park the excess on the newest issuance so Total Paid / Overpaid reflect it.
            const newest = [...factoryIssuances].sort((a, b) => +new Date(b.issuedAt) - +new Date(a.issuedAt))[0];
            if (newest) {
              if (!newest.makingCharges.payments) newest.makingCharges.payments = [];
              newest.makingCharges.payments.push({ id: uid("fpay_"), amountInr: leftover, lockerId, recordedBy: user!.id, createdAt: now, note: note.trim() || undefined });
            } else {
              // No job to settle at all — an advance to a factory that has not
              // started anything yet. It used to be discarded.
              asAdvance(leftover);
            }
          }
        } else {
          const mi = d.materialIssuances.find(x => x.id === target);
          if (mi) {
            if (!mi.makingCharges.payments) mi.makingCharges.payments = [];
            mi.makingCharges.payments.push({ id: uid("fpay_"), amountInr: amt, lockerId, recordedBy: user!.id, createdAt: now, note: note.trim() || undefined });
          } else {
            asAdvance(amt);
          }
        }
        if (!d.lockerTransactions) d.lockerTransactions = [];
        d.lockerTransactions.push({
          id: uid("ltx_"), lockerId, type: "expense", amountInr: amt, currency: "INR",
          category: `Making Charges — ${f.name}`, refType: "materialIssuance",
          refId: target === "__fifo" ? undefined : target,
          note: note.trim() || undefined, recordedBy: user!.id, createdAt: now,
        });
      });
      toast.success(`${fmtMoneyInr(amt)} paid to ${f.name}`);
      setFactoryId(""); setAmount(""); setTarget("__fifo"); setNote(""); setLockerId(""); setDate(todayLocal());
      onOpenChange(false);
    } finally { setSaving(false); }
  };

  const typed = Number(amount) || 0;
  return (
    <ActionSheet open={open} onOpenChange={onOpenChange} size="md" icon={FactoryIcon}
      title="Factory payment"
      description="Making charges, in rupees"
      footer={
        <PanelFooter onCancel={() => onOpenChange(false)} summary={typed > 0 ? (
          <MoveSummary label="Paying" value={fmtMoneyInr(typed)} tone="out" lockerId={lockerId} change={-typed} />
        ) : undefined}>
          <AsyncButton onClick={submit} disabled={saving} className={SAVE_BTN}>{saving ? "Saving…" : "Record Factory Payment"}</AsyncButton>
        </PanelFooter>
      }>
    <div className="space-y-3">
      <div>
        <Label className="text-xs">Factory</Label>
        <Select value={factoryId} onValueChange={addNew("factory", v => { setFactoryId(v); setTarget("__fifo"); })}>
          <SelectTrigger className="h-10 rounded-xl mt-1"><SelectValue placeholder="Choose factory" /></SelectTrigger>
          <SelectContent>{factories.map(f => <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>)}<AddNewItem kind="factory" /></SelectContent>
        </Select>
      </div>
      {factoryId && (
        <p className="text-xs text-muted-foreground">Charges pending: <span className="font-semibold text-foreground">{fmtMoneyInr(account.chargesPending)}</span></p>
      )}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label className="text-xs">Date</Label>
          <Input type="date" value={date} onChange={e => setDate(e.target.value)} className="rounded-xl h-10 mt-1" />
        </div>
        <div>
          <Label className="text-xs">Amount (₹)</Label>
          <Input type="number" min={1} value={amount} onChange={e => setAmount(e.target.value)} className="rounded-xl h-10 mt-1" />
        </div>
        {/* Full width: a job reads "12g 18K — pending ₹4,500". */}
        <div className="col-span-2">
          <Label className="text-xs">Against</Label>
          <Select value={target} onValueChange={setTarget}>
            <SelectTrigger className="h-10 rounded-xl mt-1"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__fifo">Oldest issued first</SelectItem>
              <SelectItem value="__advance">Advance / loan — not against any job</SelectItem>
              {pendingIssuances.map(mi => <SelectItem key={mi.id} value={mi.id}>{mi.quantityIssued}{materialUnit(db.settings, mi.material)} {mi.purityOrQuality} — pending {fmtMoneyInr(issuancePending(mi))}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>
      <Input value={note} onChange={e => setNote(e.target.value)} className="rounded-xl h-10" placeholder="Note (optional)" />
      <div>
        <Label className="text-xs">Paid from Locker *</Label>
        <Select value={lockerId} onValueChange={addNew("locker", setLockerId)}>
          <SelectTrigger className="h-10 rounded-xl mt-1"><SelectValue placeholder="Choose locker" /></SelectTrigger>
          <SelectContent>{db.lockers.filter(l => l.active !== false && (l.currency || "INR") === "INR").map(l => <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>)}<AddNewItem kind="locker" /></SelectContent>
        </Select>
      </div>
    </div>
    </ActionSheet>
  );
}

/* ── Pay Expense — mirrors Expenses.tsx's handleAdd ── */
function PayExpense({ open, onOpenChange }: SheetProps) {
  const { user } = useAuth();
  const db = useDb();
  const addNew = useAddNew();
  const [title, setTitle] = useState("");
  const [amount, setAmount] = useState("");
  const [category, setCategory] = useState((db.settings.expenseCategories?.[0]) || DEFAULT_EXPENSE_CATEGORIES[0]);
  const [note, setNote] = useState("");
  const [lockerId, setLockerId] = useState("");
  const [paidToEmployeeId, setPaidToEmployeeId] = useState("");
  const [saving, setSaving] = useState(false);
  // Entries are often written up a day or two later, so the date is chosen
  // rather than assumed to be today.
  const [date, setDate] = useState(todayLocal());

  const staff = db.users.filter(u => u.role === "admin" || u.role === "employee");
  const categories = db.settings.expenseCategories?.length ? db.settings.expenseCategories : DEFAULT_EXPENSE_CATEGORIES;
  const locker = db.lockers.find(l => l.id === lockerId);
  // The expense is in the account's own currency — never turned into rupees
  // just because it isn't dollars.
  const curr = ccy(locker?.currency);
  const sym = ccySymbol(curr).trim();

  const submit = async () => {
    // Account FIRST — it decides the amount's currency.
    if (!lockerId) { toast.error("Choose the account this is paid from"); return; }
    const amt = parseFloat(amount);
    if (!amt || amt <= 0) { toast.error("Enter a valid amount"); return; }
    if (!title.trim()) { toast.error("Enter a title"); return; }
    if (category === "Salary" && !paidToEmployeeId) { toast.error("Choose which team member this salary is for"); return; }
    if (!(await confirmOverdraw(db.lockers, db.lockerTransactions, lockerId, amt))) return;
    setSaving(true);
    try {
      const now = stampFor(date);
      const expense: Expense = {
        id: uid("exp_"), title: title.trim(), amount: amt, category,
        note: note.trim() || undefined, employeeId: user!.id,
        paidToEmployeeId: category === "Salary" ? (paidToEmployeeId || undefined) : undefined,
        currency: curr, createdAt: now, lockerId,
      };
      updateDb(d => {
        d.expenses.push(expense);
        const l = d.lockers.find(x => x.id === lockerId);
        if (l) {
          if (!d.lockerTransactions) d.lockerTransactions = [];
          d.lockerTransactions.push({
            id: uid("ltx_"), lockerId, type: "expense", amountInr: amt,
            currency: ccy(l.currency), category: `Expense — ${title.trim()}`,
            refType: "expense", refId: expense.id, recordedBy: user!.id, createdAt: now,
          });
        }
      });
      toast.success("Expense recorded");
      setTitle(""); setAmount(""); setNote(""); setLockerId(""); setPaidToEmployeeId(""); setDate(todayLocal());
      onOpenChange(false);
    } finally { setSaving(false); }
  };

  // Make sure "Salary" is always pickable even if an admin customised categories.
  const catList = categories.includes("Salary") ? categories : ["Salary", ...categories];
  const typed = Number(amount) || 0;
  return (
    <ActionSheet open={open} onOpenChange={onOpenChange} size="md" icon={Receipt}
      title="Pay expense"
      description="From any account, in its currency"
      footer={
        <PanelFooter onCancel={() => onOpenChange(false)} summary={typed > 0 && lockerId ? (
          <MoveSummary label={category === "Salary" ? "Salary" : "Expense"} value={fmtCcy(typed, curr)} tone="out" lockerId={lockerId} change={-typed} />
        ) : undefined}>
          <AsyncButton onClick={submit} disabled={saving} className={SAVE_BTN}>{saving ? "Saving…" : "Record Expense"}</AsyncButton>
        </PanelFooter>
      }>
    <div className="space-y-3">
      {/* 1. Pay from account — first; it sets the currency (same flow as the Expenses page) */}
      <div>
        <Label className="text-xs">Pay from Account *</Label>
        <Select value={lockerId} onValueChange={addNew("locker", setLockerId)}>
          <SelectTrigger className="h-10 rounded-xl mt-1"><SelectValue placeholder="Choose account" /></SelectTrigger>
          <SelectContent>{db.lockers.filter(l => l.active !== false).map(l => <SelectItem key={l.id} value={l.id}>{l.name} ({ccy(l.currency)})</SelectItem>)}<AddNewItem kind="locker" /></SelectContent>
        </Select>
      </div>
      {/* Date first: an expense is often written up after the fact. */}
      <div>
        <Label className="text-xs">Date</Label>
        <Input type="date" value={date} onChange={e => setDate(e.target.value)} className="rounded-xl h-10 mt-1" />
      </div>
      {/* 2. Amount — in the selected account's currency */}
      <div>
        <Label className="text-xs">Amount ({curr})</Label>
        <div className="relative mt-1">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">{sym}</span>
          {/* Room for a longer symbol (A$, AED) than ₹ or $. */}
          <Input type="number" min={0} step="0.01" value={amount} disabled={!lockerId} onChange={e => setAmount(e.target.value)} placeholder={lockerId ? "0.00" : "Choose an account first"}
            className="h-10 rounded-xl disabled:opacity-60" style={{ paddingLeft: `${Math.max(1.75, sym.length * 0.55 + 1.1)}rem` }} />
        </div>
      </div>
      {/* 3. Category */}
      <div>
        <Label className="text-xs">Category</Label>
        <Select value={category} onValueChange={v => { setCategory(v); if (v !== "Salary") setPaidToEmployeeId(""); }}>
          <SelectTrigger className="h-10 rounded-xl mt-1"><SelectValue /></SelectTrigger>
          <SelectContent>{catList.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
        </Select>
      </div>
      {/* 4. Salary → team member — shown & COMPULSORY only for a Salary expense */}
      {category === "Salary" && (
        <div>
          <Label className="text-xs">Paid to Team Member *</Label>
          <Select value={paidToEmployeeId || ""} onValueChange={addNew("employee", setPaidToEmployeeId)}>
            <SelectTrigger className="h-10 rounded-xl mt-1"><SelectValue placeholder="Choose team member" /></SelectTrigger>
            <SelectContent>{staff.map(u => <SelectItem key={u.id} value={u.id}>{u.name} ({u.role})</SelectItem>)}<AddNewItem kind="employee" /></SelectContent>
          </Select>
          <p className="text-[11px] text-muted-foreground mt-1">Shows on their salary ledger.</p>
        </div>
      )}
      {/* 5. Title + note */}
      <div>
        <Label className="text-xs">Title *</Label>
        <Input value={title} onChange={e => setTitle(e.target.value)} className="rounded-xl h-10 mt-1" placeholder="e.g. August salary, Office rent" />
      </div>
      <Input value={note} onChange={e => setNote(e.target.value)} className="rounded-xl h-10" placeholder="Note (optional)" />
    </div>
    </ActionSheet>
  );
}

/* ── Locker — deposit, withdraw, or transfer between lockers.
   Mirrors Locker.tsx's recordTxn exactly (overdraw warning + cross-currency
   transfer rate) so the two entry points behave identically. ── */
type LockerAction = "income" | "expense" | "transfer_out";
function LockerActions({ open, onOpenChange, preset }: SheetProps & { preset: LockerAction }) {
  const { user } = useAuth();
  const db = useDb();
  const addNew = useAddNew();
  const [action, setAction] = useState<LockerAction>(preset);
  const [lockerId, setLockerId] = useState("");
  const [amount, setAmount] = useState("");
  const [category, setCategory] = useState("");
  const lockerCats = db.settings.lockerCategories?.length
    ? db.settings.lockerCategories
    : DEFAULT_LOCKER_CATEGORIES;
  const [note, setNote] = useState("");
  const [targetLocker, setTargetLocker] = useState("");
  // "1 of the source's currency = rate of the destination's". Cleared whenever
  // either locker changes, so a rate typed for one pair is never saved for another.
  const [exchangeRate, setExchangeRate] = useState<number | "">("");
  const [saving, setSaving] = useState(false);
  // Entries are often written up a day or two later, so the date is chosen
  // rather than assumed to be today.
  const [date, setDate] = useState(todayLocal());

  // The ⋯ item it was opened from decides what it is — a transfer, a deposit
  // or a withdrawal; the Action select inside can still change it. Switching
  // clears the rate, exactly as picking another action in the select does.
  // Before paint, so the panel never opens showing the previous title.
  useLayoutEffect(() => {
    if (open && action !== preset) { setAction(preset); setExchangeRate(""); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, preset]);

  const lockers = db.lockers.filter(l => l.active !== false);
  const selected = lockers.find(l => l.id === lockerId) ?? null;
  const target = action === "transfer_out" ? lockers.find(l => l.id === targetLocker) : undefined;
  const cur = ccy(selected?.currency);
  const targetCcy = target ? ccy(target.currency) : cur;
  // Any two currencies — not only rupees and dollars.
  const crossCurrency = !!selected && !!target && targetCcy !== cur;

  const submit = async () => {
    if (!selected) { toast.error("Choose a locker"); return; }
    const amt = Number(amount);
    if (!amt || amt <= 0) { toast.error("Enter a valid amount"); return; }
    // Every entry has to be filed under a category, so the account ledger can be
    // grouped and totalled instead of holding free text nobody can report on.
    if (action !== "transfer_out" && !category) { toast.error("Choose a category"); return; }
    if (action === "transfer_out" && !targetLocker) { toast.error("Choose a destination locker"); return; }
    if (action === "transfer_out" && targetLocker === lockerId) { toast.error("Choose a different destination locker"); return; }
    const rate = Number(exchangeRate);
    if (crossCurrency && (!rate || rate <= 0)) { toast.error("Enter the exchange rate before saving this transfer"); return; }
    if (action === "transfer_out" && !db.lockers.find(l => l.id === targetLocker)) {
      toast.error("That destination locker couldn't be found — pick it again and retry.");
      return;
    }
    // Overdraw warning on money leaving the source locker — identical to Locker.tsx.
    if (action === "expense" || action === "transfer_out") {
      const bal = lockerBalance(selected, db.lockerTransactions);
      if (amt > bal) {
        const ok = (await confirmBox(
          `This ${action === "expense" ? "withdrawal" : "transfer"} of ${fmtCcy(amt, cur)} is more than ${selected.name}'s balance of ${fmtCcy(bal, cur)} ${cur}.\n\nThe balance will go negative. Continue only if you're sure a deposit is still missing.`,
        ));
        if (!ok) return;
      }
    }
    setSaving(true);
    try {
      const now = stampFor(date);
      const voucher = await reserveVoucherNumber(db.lockerTransactions ?? []);
      const xferId = uid("xfer_");
      updateDb(d => {
        if (!d.lockerTransactions) d.lockerTransactions = [];
        if (action === "transfer_out") {
          const dest = d.lockers.find(l => l.id === targetLocker);
          if (!dest) return;
          // What arrives is amount × rate, in the destination's currency.
          const destAmount = crossCurrency ? roundCcy(amt * rate, targetCcy) : amt;
          // The same rate on both legs ({fx}, plus the old ₹-per-$ figure for a
          // rupee/dollar pair); nothing at all on a same-currency transfer.
          const fx = crossCurrency ? rateFields(cur, targetCcy, rate) : {};
          d.lockerTransactions.push({
            id: uid("ltx_"), lockerId: selected.id, type: "transfer_out", amountInr: amt, currency: cur,
            category: "Transfer", refType: "transfer", transferId: xferId, voucherNo: voucher, pairedLockerId: dest.id, note: note.trim() || undefined,
            ...fx,
            recordedBy: user!.id, createdAt: now,
          });
          d.lockerTransactions.push({
            id: uid("ltx_"), lockerId: dest.id, type: "transfer_in", amountInr: destAmount, currency: ccy(dest.currency),
            category: "Transfer", refType: "transfer", transferId: xferId, voucherNo: voucher, pairedLockerId: selected.id, note: note.trim() || undefined,
            ...fx,
            recordedBy: user!.id, createdAt: now,
          });
        } else {
          d.lockerTransactions.push({
            id: uid("ltx_"), lockerId: selected.id, type: action, amountInr: amt, currency: cur,
            category: category || undefined, refType: "manual", voucherNo: voucher,
            note: note.trim() || undefined, recordedBy: user!.id, createdAt: now,
          });
        }
      });
      toast.success(
        action === "income" ? `${fmtCcy(amt, cur)} deposited to ${selected.name}`
          : action === "expense" ? `${fmtCcy(amt, cur)} withdrawn from ${selected.name}`
          : `${fmtCcy(amt, cur)} transferred to ${target?.name}`,
      );
      setAmount(""); setCategory(""); setNote(""); setTargetLocker(""); setExchangeRate(""); setDate(todayLocal());
      onOpenChange(false);
    } finally { setSaving(false); }
  };

  const typed = Number(amount) || 0;
  const xferRate = Number(exchangeRate);
  return (
    <ActionSheet open={open} onOpenChange={onOpenChange} size="md"
      icon={action === "transfer_out" ? ArrowLeftRight : action === "income" ? ArrowDownCircle : ArrowUpCircle}
      title={action === "transfer_out" ? "Transfer between accounts" : action === "income" ? "Deposit to an account" : "Withdraw from an account"}
      description={action === "transfer_out"
        ? "Any two accounts, any currencies"
        : "One account, under a category"}
      footer={
        <PanelFooter onCancel={() => onOpenChange(false)} summary={typed > 0 && selected ? (
          <div className="space-y-1">
            <MoveSummary label={action === "income" ? "Deposit" : action === "expense" ? "Withdrawal" : "Transfer"} value={fmtCcy(typed, cur)}
              tone={action === "income" ? "in" : "out"} lockerId={selected.id} change={action === "income" ? typed : -typed} />
            {/* What lands on the other side: the same amount, or amount × rate once there is one. */}
            {target && (!crossCurrency || xferRate > 0) && (
              <p className="text-xs text-muted-foreground text-right">
                {target.name} receives <span className="font-semibold text-foreground">{fmtCcy(crossCurrency ? roundCcy(typed * xferRate, targetCcy) : typed, targetCcy)}</span>
              </p>
            )}
          </div>
        ) : undefined}>
          <AsyncButton onClick={submit} disabled={saving || lockers.length === 0} className={SAVE_BTN}>
            {saving ? "Saving…" : action === "income" ? "Record Deposit" : action === "expense" ? "Record Withdrawal" : "Record Transfer"}
          </AsyncButton>
        </PanelFooter>
      }>
    <div className="space-y-3">
      {/* Current balances — so staff pick the right locker at a glance */}
      {lockers.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {lockers.map(l => (
            <div key={l.id} className="p-2.5 rounded-xl bg-secondary/60 border border-border/40">
              <p className="text-xs text-muted-foreground truncate">{l.name}</p>
              <p className="text-sm font-semibold text-brand-dark">{fmtCcy(lockerBalance(l, db.lockerTransactions), l.currency)}</p>
            </div>
          ))}
        </div>
      )}

      <div>
        <Label className="text-xs">Action</Label>
        <Select value={action} onValueChange={v => { setAction(v as LockerAction); setExchangeRate(""); }}>
          <SelectTrigger className="h-10 rounded-xl mt-1"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="income">Deposit (money in)</SelectItem>
            <SelectItem value="expense">Withdraw (money out)</SelectItem>
            <SelectItem value="transfer_out">Transfer to another locker</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div>
        <Label className="text-xs">{action === "transfer_out" ? "From Locker *" : "Locker *"}</Label>
        <Select value={lockerId} onValueChange={addNew("locker", v => { setLockerId(v); setExchangeRate(""); })}>
          <SelectTrigger className="h-10 rounded-xl mt-1"><SelectValue placeholder="Choose locker" /></SelectTrigger>
          <SelectContent>{lockers.map(l => <SelectItem key={l.id} value={l.id}>{l.name} ({ccy(l.currency)})</SelectItem>)}<AddNewItem kind="locker" /></SelectContent>
        </Select>
        {selected && (
          <p className="text-xs text-muted-foreground mt-1">Current balance: <span className="font-semibold text-foreground">{fmtCcy(lockerBalance(selected, db.lockerTransactions), cur)}</span></p>
        )}
      </div>

      {action === "transfer_out" && (
        <div>
          <Label className="text-xs">To Locker *</Label>
          <Select value={targetLocker} onValueChange={addNew("locker", v => { setTargetLocker(v); setExchangeRate(""); })}>
            <SelectTrigger className="h-10 rounded-xl mt-1"><SelectValue placeholder="Choose destination" /></SelectTrigger>
            <SelectContent>{lockers.filter(l => l.id !== lockerId).map(l => <SelectItem key={l.id} value={l.id}>{l.name} ({ccy(l.currency)})</SelectItem>)}<AddNewItem kind="locker" /></SelectContent>
          </Select>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label className="text-xs">Date</Label>
          <Input type="date" value={date} onChange={e => setDate(e.target.value)} className="rounded-xl h-10 mt-1" />
        </div>
        <div>
          <Label className="text-xs">Amount ({ccySymbol(cur).trim()})</Label>
          <Input type="number" min={0} step="0.01" value={amount} onChange={e => setAmount(e.target.value)} className="rounded-xl h-10 mt-1" />
        </div>
        {crossCurrency ? (
          // Full width: the rate, its "Today's rate" button and what the amount becomes.
          <RateInput id="locker-xfer-rate" from={cur} to={targetCcy} value={exchangeRate} onChange={setExchangeRate}
            amount={Number(amount) || undefined} at={date} className="col-span-2" />
        ) : action !== "transfer_out" ? (
          <div>
            <Label className="text-xs">Category <span className="text-destructive">*</span></Label>
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger className="h-10 rounded-xl mt-1"><SelectValue placeholder="Choose a category" /></SelectTrigger>
              <SelectContent>{lockerCats.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
            </Select>
          </div>
        ) : <div />}
      </div>

      {crossCurrency && !(Number(exchangeRate) > 0) && (
        <p className="text-xs text-muted-foreground">
          {target?.name} holds {targetCcy} — enter the rate to save.
        </p>
      )}

      <Input value={note} onChange={e => setNote(e.target.value)} className="rounded-xl h-10" placeholder="Note (optional)" />
    </div>
    </ActionSheet>
  );
}
