import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth";
import {
  updateDb, uid, fmtMoney,
  settleClientAccount, invoiceOrderIds, balanceDue, type Order, type Expense, type Locker, type LockerTransaction,
  DEFAULT_LOCKER_CATEGORIES, todayLocal, stampFor,
} from "@/lib/db";
import { useDb } from "@/hooks/useDb";
import { createReceipt } from "@/lib/receipts";
import { reserveVoucherNumber } from "@/lib/counters";
import { ReceiptLedger } from "@/components/ReceiptLedger";
import { MoneyLedger } from "@/components/MoneyLedger";
import {
  supplierAccount, purchasePending, allocateSupplierPaymentFIFO,
  factoryAccount, issuancePending, allocateFactoryChargePaymentFIFO,
  fmtMoneyInr, lockerBalance, fmtLockerAmount,
} from "@/lib/manufacturing";
import { Button } from "@/components/ui/button";
import { AsyncButton } from "@/components/AsyncButton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CreditCard, Truck, Factory as FactoryIcon, Receipt, DollarSign, Landmark } from "lucide-react";
import { toast } from "sonner";

/** Today as yyyy-mm-dd for a date input, in LOCAL time — toISOString() would
 *  roll back a day for anyone east of UTC after midday. */
// todayLocal / stampFor now live in src/lib/db.ts, shared with Buy & Assign.


type Mode = "client" | "supplier" | "factory" | "expense" | "locker";

const DEFAULT_EXPENSE_CATEGORIES = ["Travel", "Food", "Tools", "Office", "Communication", "Other"];
// The fallback list is the one in db.ts, shared with Settings → Categories.
// This file used to keep its own copy, so a category added to the shared list
// never appeared here until someone edited the list in Settings.

/** Warn before a payment takes a locker's balance negative (money it doesn't hold).
 *  Returns true to proceed, false to cancel. `amt` is in the locker's own currency. */
function confirmOverdraw(lockers: Locker[], transactions: LockerTransaction[], lockerId: string, amt: number): boolean {
  const locker = lockers.find(l => l.id === lockerId);
  if (!locker) return true;
  const bal = lockerBalance(locker, transactions);
  if (amt > bal) {
    return window.confirm(
      `This payment of ${fmtLockerAmount(amt, locker.currency)} is more than ${locker.name}'s balance of ${fmtLockerAmount(bal, locker.currency)}.\n\nThe locker will go negative — continue only if you're sure a deposit is still missing.`,
    );
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
  const [mode, setMode] = useState<Mode>("client");

  const activeLockers = db.lockers.filter(l => l.active !== false);

  return (
    <div className="max-w-7xl mx-auto space-y-5">
      <div>
        <h1 className="font-display text-2xl md:text-3xl text-brand-dark">Payments</h1>
        <p className="text-sm text-muted-foreground mt-0.5">Receive from a client, or pay a supplier, factory, or expense — all in one place</p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
        {([
          { m: "client", label: "Receive from Client", icon: CreditCard },
          { m: "supplier", label: "Supplier", icon: Truck },
          { m: "factory", label: "Pay Factory", icon: FactoryIcon },
          { m: "expense", label: "Pay Expense", icon: Receipt },
          { m: "locker", label: "Locker", icon: Landmark },
        ] as const).map(opt => (
          <button key={opt.m} onClick={() => setMode(opt.m)}
            className={`flex flex-col items-center gap-1.5 p-3 rounded-xl border transition-colors text-xs font-medium
              ${mode === opt.m ? "border-primary bg-primary/5 text-primary" : "border-border hover:border-primary/40 hover:bg-secondary/60"}`}>
            <opt.icon className="h-4 w-4" />
            {opt.label}
          </button>
        ))}
      </div>

      {activeLockers.length === 0 && (
        <div className="card-luxe p-4 text-sm text-amber-700 bg-amber-50 border border-amber-200">
          No lockers yet — create one on the Locker page first. Every payment here must go through a Locker.
        </div>
      )}

      {/* Form first, then the table underneath at full width — the entries are
          what people come back to read, so they get the whole page. */}
      <div className="card-luxe p-6">
        {mode === "client" && <ReceiveFromClient />}
        {mode === "supplier" && <PaySupplier />}
        {mode === "factory" && <PayFactory />}
        {mode === "expense" && <PayExpense />}
        {mode === "locker" && <LockerActions />}
      </div>

      {mode === "client" && <ReceiptLedger />}
      {mode === "supplier" && <MoneyLedger kind="supplier" />}
      {mode === "factory" && <MoneyLedger kind="factory" />}
      {mode === "expense" && <MoneyLedger kind="expense" />}
      {mode === "locker" && <MoneyLedger kind="locker" />}

    </div>
  );
}

/* ── Receive from Client — mirrors ClientHistory.tsx's recordPayment ── */
function ReceiveFromClient() {
  const { user } = useAuth();
  const db = useDb();
  const [clientId, setClientId] = useState("");
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("Cash");
  const [note, setNote] = useState("");
  const [lockerId, setLockerId] = useState("");
  const [exchangeRate, setExchangeRate] = useState("");
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
  // the bill they actually paid instead of scattering onto older orders.
  // Anything less clear-cut stays on oldest-bills-first for staff to choose.
  const openUnpaid = openInvoices.filter(x => x.bal > 0);
  useEffect(() => {
    setInvoiceId(openUnpaid.length === 1 ? openUnpaid[0].inv.id : "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId]);

  const locker = db.lockers.find(l => l.id === lockerId);
  const lockerCurrency = locker?.currency || "INR";
  // A client always pays in USD (that's what the order is billed in) — only
  // an INR locker needs converting for the deposit side.
  const needsRate = !!locker && lockerCurrency !== "USD";
  const rate = Number(exchangeRate);

  const submit = async () => {
    const c = db.clients.find(x => x.id === clientId);
    if (!c) { toast.error("Choose a client"); return; }
    const amt = parseFloat(amount);
    if (!amt || amt <= 0) { toast.error("Enter a valid amount"); return; }
    if (!lockerId) { toast.error("Choose which locker this was deposited into"); return; }
    if (needsRate && (!rate || rate <= 0)) { toast.error("Enter the exchange rate before saving this payment"); return; }
    const depositAmt = needsRate ? Math.round(amt * rate * 100) / 100 : amt;
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
        lockerCurrency: lockerCurrency as "INR" | "USD",
        exchangeRate: needsRate ? rate : undefined,
        invoiceId: invoiceId || undefined,
        userId: user!.id,
      });
      updateDb(d => {
        const clientUser = d.users.find(u => u.clientId === clientId);
        if (clientUser) d.notifications.unshift({
          id: uid("n_"), userId: clientUser.id, title: "Payment Received",
          body: `${fmtMoney(amt)} received via ${method} and applied to your pending bills.`,
          type: "info", read: false, createdAt: now,
        });
      });
      toast.success(`Receipt ${receipt.receiptNo} — ${fmtMoney(amt)} received from ${c.companyName}`);
      setClientId(""); setAmount(""); setNote(""); setLockerId(""); setExchangeRate(""); setInvoiceId(""); setDate(todayLocal());
    } finally { setSaving(false); }
  };

  const depositPreview = amount && needsRate && rate > 0 ? Number(amount) * rate : amount ? Number(amount) : null;

  return (
    <div className="space-y-3">
      {/* Fields spread across the width instead of one long column — the card is
          full-page now that the receipts table sits underneath it. */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        <div>
          <Label className="text-xs">Client</Label>
          <Select value={clientId} onValueChange={setClientId}>
            <SelectTrigger className="h-10 rounded-xl mt-1"><SelectValue placeholder="Choose client" /></SelectTrigger>
            <SelectContent>{clients.map(c => <SelectItem key={c.id} value={c.id}>{c.companyName}</SelectItem>)}</SelectContent>
          </Select>
        </div>

        {clientId && openInvoices.length > 0 && (
          <div>
            <Label className="text-xs">Against {invoiceId ? <span className="text-success">(auto-selected)</span> : ""}</Label>
            <Select value={invoiceId || "fifo"} onValueChange={v => setInvoiceId(v === "fifo" ? "" : v)}>
              <SelectTrigger className="h-10 rounded-xl mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="fifo">Oldest bills first</SelectItem>
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
          <Select value={lockerId} onValueChange={setLockerId}>
            <SelectTrigger className="h-10 rounded-xl mt-1"><SelectValue placeholder="Choose locker" /></SelectTrigger>
            <SelectContent>{db.lockers.filter(l => l.active !== false).map(l => <SelectItem key={l.id} value={l.id}>{l.name} ({l.currency || "INR"})</SelectItem>)}</SelectContent>
          </Select>
        </div>

        <div>
          <Label className="text-xs">Remark / ref</Label>
          <Input value={note} onChange={e => setNote(e.target.value)} className="rounded-xl h-10 mt-1" placeholder="optional" />
        </div>

        {needsRate && (
          <div className="sm:col-span-2 lg:col-span-3 p-3 rounded-xl bg-secondary">
            <Label className="text-xs">Exchange Rate — 1 USD = ₹ <span className="text-destructive">*</span></Label>
            <Input type="number" min={0} step="0.01" value={exchangeRate} onChange={e => setExchangeRate(e.target.value)} className="rounded-xl h-10 bg-white mt-1 max-w-xs" placeholder="e.g. 83.50" />
            <p className="text-xs text-muted-foreground mt-1">This locker holds INR, not USD — enter today's rate to convert what lands in it.</p>
          </div>
        )}
      </div>

      {clientId && openInvoices.length > 0 && (
        <p className="text-[11px] text-muted-foreground">
          {invoiceId
            ? "Clears that invoice first. Anything left over rolls on to their next invoice, then to credit."
            : "Oldest bills first — pick an invoice if the client sent this for one in particular."}
        </p>
      )}

      {amount && lockerId && (
        <div className="p-4 rounded-xl border border-border/60 bg-secondary/30 grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Received</p>
            <p className="font-medium text-foreground">{fmtMoney(Number(amount))}</p>
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Applied to their bills</p>
            <p className="font-semibold text-primary">{fmtMoney(Number(amount))}</p>
          </div>
          {depositPreview != null && locker && (
            <div>
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Deposited to {locker.name}</p>
              <p className="font-semibold text-foreground">{lockerCurrency === "USD" ? "$" : "₹"}{depositPreview.toFixed(2)}</p>
            </div>
          )}
        </div>
      )}

      <AsyncButton onClick={submit} disabled={saving} className="btn-hero rounded-xl h-10 w-full sm:w-auto sm:px-10">{saving ? "Saving…" : "Record Payment Received"}</AsyncButton>
    </div>
  );
}

/* ── Pay Supplier — mirrors SupplierHistory.tsx's recordPayment ── */
function PaySupplier() {
  const { user } = useAuth();
  const db = useDb();
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

  const submit = () => {
    const s = db.suppliers.find(x => x.id === supplierId);
    if (!s) { toast.error("Choose a supplier"); return; }
    const amt = Number(amount);
    if (!amt || amt <= 0) { toast.error("Enter a valid amount"); return; }
    if (!lockerId) { toast.error(dir === "pay" ? "Choose which locker this was paid from" : "Choose which locker the money went into"); return; }
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
          d.lockerTransactions.push({ id: uid("ltx_"), lockerId, type: "income", amountInr: amt, category: `Received from ${s.name}`, refType: "supplierReceipt", refId: supplierId, paymentId: receiptId, note: note.trim() || undefined, recordedBy: user!.id, createdAt: now });
        });
        toast.success(`${fmtMoneyInr(amt)} received from ${s.name}`);
        setSupplierId(""); setAmount(""); setTarget("__fifo"); setNote(""); setLockerId(""); setDate(todayLocal());
      } finally { setSaving(false); }
      return;
    }
    // ── Pay: money out TO the supplier. ──
    // Overpayment is allowed — the excess beyond what's owed is recorded as an
    // overpay on the newest purchase, never silently lost.
    if (!confirmOverdraw(db.lockers, db.lockerTransactions, lockerId, amt)) return;
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
          id: uid("ltx_"), lockerId, type: "expense", amountInr: amt,
          category: `Supplier Payment — ${s.name}`, refType: "purchase",
          refId: target === "__fifo" || target === "__advance" ? undefined : target,
          note: note.trim() || undefined, recordedBy: user!.id, createdAt: now,
        });
      });
      toast.success(`${fmtMoneyInr(amt)} paid to ${s.name}`);
      setSupplierId(""); setAmount(""); setTarget("__fifo"); setNote(""); setLockerId(""); setDate(todayLocal());
    } finally { setSaving(false); }
  };

  return (
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
        <Select value={supplierId} onValueChange={v => { setSupplierId(v); setTarget("__fifo"); }}>
          <SelectTrigger className="h-10 rounded-xl mt-1"><SelectValue placeholder="Choose supplier" /></SelectTrigger>
          <SelectContent>{suppliers.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}</SelectContent>
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
          <div>
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
        <Select value={lockerId} onValueChange={setLockerId}>
          <SelectTrigger className="h-10 rounded-xl mt-1"><SelectValue placeholder="Choose locker" /></SelectTrigger>
          <SelectContent>{db.lockers.filter(l => l.active !== false && (l.currency || "INR") === "INR").map(l => <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>)}</SelectContent>
        </Select>
      </div>
      <AsyncButton onClick={submit} disabled={saving} className="btn-hero rounded-xl h-10 w-full">{saving ? "Saving…" : dir === "pay" ? "Record Supplier Payment" : "Record Supplier Receipt"}</AsyncButton>
    </div>
  );
}

/* ── Pay Factory — mirrors FactoryHistory.tsx's payCharge / FIFO ── */
function PayFactory() {
  const { user } = useAuth();
  const db = useDb();
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

  const submit = () => {
    const f = db.factories.find(x => x.id === factoryId);
    if (!f) { toast.error("Choose a factory"); return; }
    const amt = Number(amount);
    if (!amt || amt <= 0) { toast.error("Enter a valid amount"); return; }
    if (!lockerId) { toast.error("Choose which locker this was paid from"); return; }
    // Overpayment is allowed (you can pay more than currently owed) — the extra
    // is recorded as an advance/overpay, never silently lost.
    if (!confirmOverdraw(db.lockers, db.lockerTransactions, lockerId, amt)) return;
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
          id: uid("ltx_"), lockerId, type: "expense", amountInr: amt,
          category: `Making Charges — ${f.name}`, refType: "materialIssuance",
          refId: target === "__fifo" ? undefined : target,
          note: note.trim() || undefined, recordedBy: user!.id, createdAt: now,
        });
      });
      toast.success(`${fmtMoneyInr(amt)} paid to ${f.name}`);
      setFactoryId(""); setAmount(""); setTarget("__fifo"); setNote(""); setLockerId(""); setDate(todayLocal());
    } finally { setSaving(false); }
  };

  return (
    <div className="space-y-3">
      <div>
        <Label className="text-xs">Factory</Label>
        <Select value={factoryId} onValueChange={v => { setFactoryId(v); setTarget("__fifo"); }}>
          <SelectTrigger className="h-10 rounded-xl mt-1"><SelectValue placeholder="Choose factory" /></SelectTrigger>
          <SelectContent>{factories.map(f => <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>)}</SelectContent>
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
        <div>
          <Label className="text-xs">Against</Label>
          <Select value={target} onValueChange={setTarget}>
            <SelectTrigger className="h-10 rounded-xl mt-1"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__fifo">Oldest issued first</SelectItem>
              <SelectItem value="__advance">Advance / loan — not against any job</SelectItem>
              {pendingIssuances.map(mi => <SelectItem key={mi.id} value={mi.id}>{mi.quantityIssued}{mi.material === "gold" ? "g" : "ct"} {mi.purityOrQuality} — pending {fmtMoneyInr(issuancePending(mi))}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>
      <Input value={note} onChange={e => setNote(e.target.value)} className="rounded-xl h-10" placeholder="Note (optional)" />
      <div>
        <Label className="text-xs">Paid from Locker *</Label>
        <Select value={lockerId} onValueChange={setLockerId}>
          <SelectTrigger className="h-10 rounded-xl mt-1"><SelectValue placeholder="Choose locker" /></SelectTrigger>
          <SelectContent>{db.lockers.filter(l => l.active !== false && (l.currency || "INR") === "INR").map(l => <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>)}</SelectContent>
        </Select>
      </div>
      <AsyncButton onClick={submit} disabled={saving} className="btn-hero rounded-xl h-10 w-full">{saving ? "Saving…" : "Record Factory Payment"}</AsyncButton>
    </div>
  );
}

/* ── Pay Expense — mirrors Expenses.tsx's handleAdd ── */
function PayExpense() {
  const { user } = useAuth();
  const db = useDb();
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
  const curr: "INR" | "USD" = (locker?.currency || "INR") === "USD" ? "USD" : "INR";
  const sym = curr === "USD" ? "$" : "₹";

  const submit = () => {
    // Account FIRST — it decides the amount's currency.
    if (!lockerId) { toast.error("Choose the account this is paid from"); return; }
    const amt = parseFloat(amount);
    if (!amt || amt <= 0) { toast.error("Enter a valid amount"); return; }
    if (!title.trim()) { toast.error("Enter a title"); return; }
    if (category === "Salary" && !paidToEmployeeId) { toast.error("Choose which team member this salary is for"); return; }
    if (!confirmOverdraw(db.lockers, db.lockerTransactions, lockerId, amt)) return;
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
            currency: l.currency || "INR", category: `Expense — ${title.trim()}`,
            refType: "expense", refId: expense.id, recordedBy: user!.id, createdAt: now,
          });
        }
      });
      toast.success("Expense recorded");
      setTitle(""); setAmount(""); setNote(""); setLockerId(""); setPaidToEmployeeId(""); setDate(todayLocal());
    } finally { setSaving(false); }
  };

  // Make sure "Salary" is always pickable even if an admin customised categories.
  const catList = categories.includes("Salary") ? categories : ["Salary", ...categories];
  return (
    <div className="space-y-3">
      {/* 1. Pay from account — first; it sets the currency (same flow as the Expenses page) */}
      <div>
        <Label className="text-xs">Pay from Account *</Label>
        <Select value={lockerId} onValueChange={setLockerId}>
          <SelectTrigger className="h-10 rounded-xl mt-1"><SelectValue placeholder="Choose account" /></SelectTrigger>
          <SelectContent>{db.lockers.filter(l => l.active !== false).map(l => <SelectItem key={l.id} value={l.id}>{l.name} ({l.currency || "INR"})</SelectItem>)}</SelectContent>
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
          <Input type="number" min={0} step="0.01" value={amount} disabled={!lockerId} onChange={e => setAmount(e.target.value)} placeholder={lockerId ? "0.00" : "Choose an account first"} className="pl-7 h-10 rounded-xl disabled:opacity-60" />
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
          <Select value={paidToEmployeeId || ""} onValueChange={setPaidToEmployeeId}>
            <SelectTrigger className="h-10 rounded-xl mt-1"><SelectValue placeholder="Choose team member" /></SelectTrigger>
            <SelectContent>{staff.map(u => <SelectItem key={u.id} value={u.id}>{u.name} ({u.role})</SelectItem>)}</SelectContent>
          </Select>
          <p className="text-[11px] text-muted-foreground mt-1">Shows on this member's salary ledger (Employees → their page).</p>
        </div>
      )}
      {/* 5. Title + note */}
      <div>
        <Label className="text-xs">Title *</Label>
        <Input value={title} onChange={e => setTitle(e.target.value)} className="rounded-xl h-10 mt-1" placeholder="e.g. August salary, Office rent" />
      </div>
      <Input value={note} onChange={e => setNote(e.target.value)} className="rounded-xl h-10" placeholder="Note (optional)" />
      <AsyncButton onClick={submit} disabled={saving} className="btn-hero rounded-xl h-10 w-full">{saving ? "Saving…" : "Record Expense"}</AsyncButton>
    </div>
  );
}

/* ── Locker — deposit, withdraw, or transfer between lockers.
   Mirrors Locker.tsx's recordTxn exactly (overdraw warning + cross-currency
   transfer rate) so the two entry points behave identically. ── */
type LockerAction = "income" | "expense" | "transfer_out";
function LockerActions() {
  const { user } = useAuth();
  const db = useDb();
  const [action, setAction] = useState<LockerAction>("income");
  const [lockerId, setLockerId] = useState("");
  const [amount, setAmount] = useState("");
  const [category, setCategory] = useState("");
  const lockerCats = db.settings.lockerCategories?.length
    ? db.settings.lockerCategories
    : DEFAULT_LOCKER_CATEGORIES;
  const [note, setNote] = useState("");
  const [targetLocker, setTargetLocker] = useState("");
  const [exchangeRate, setExchangeRate] = useState("");
  const [saving, setSaving] = useState(false);
  // Entries are often written up a day or two later, so the date is chosen
  // rather than assumed to be today.
  const [date, setDate] = useState(todayLocal());

  const lockers = db.lockers.filter(l => l.active !== false);
  const selected = lockers.find(l => l.id === lockerId) ?? null;
  const target = action === "transfer_out" ? lockers.find(l => l.id === targetLocker) : undefined;
  const crossCurrency = !!selected && !!target && (target.currency || "INR") !== (selected.currency || "INR");
  const cur = selected?.currency || "INR";

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
        const ok = window.confirm(
          `This ${action === "expense" ? "withdrawal" : "transfer"} of ${fmtLockerAmount(amt, selected.currency)} is more than ${selected.name}'s balance of ${fmtLockerAmount(bal, selected.currency)} ${cur}.\n\nThe balance will go negative. Continue only if you're sure a deposit is still missing.`,
        );
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
          const destAmount = crossCurrency
            ? Math.round((cur === "USD" ? amt * rate : amt / rate) * 100) / 100
            : amt;
          d.lockerTransactions.push({
            id: uid("ltx_"), lockerId: selected.id, type: "transfer_out", amountInr: amt, currency: cur,
            category: "Transfer", refType: "transfer", transferId: xferId, voucherNo: voucher, pairedLockerId: dest.id, note: note.trim() || undefined,
            exchangeRate: crossCurrency ? rate : undefined,
            recordedBy: user!.id, createdAt: now,
          });
          d.lockerTransactions.push({
            id: uid("ltx_"), lockerId: dest.id, type: "transfer_in", amountInr: destAmount, currency: dest.currency || "INR",
            category: "Transfer", refType: "transfer", transferId: xferId, voucherNo: voucher, pairedLockerId: selected.id, note: note.trim() || undefined,
            exchangeRate: crossCurrency ? rate : undefined,
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
        action === "income" ? `${fmtLockerAmount(amt, selected.currency)} deposited to ${selected.name}`
          : action === "expense" ? `${fmtLockerAmount(amt, selected.currency)} withdrawn from ${selected.name}`
          : `${fmtLockerAmount(amt, selected.currency)} transferred to ${target?.name}`,
      );
      setAmount(""); setCategory(""); setNote(""); setTargetLocker(""); setExchangeRate(""); setDate(todayLocal());
    } finally { setSaving(false); }
  };

  return (
    <div className="space-y-3">
      {/* Current balances — so staff pick the right locker at a glance */}
      {lockers.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {lockers.map(l => (
            <div key={l.id} className="p-2.5 rounded-xl bg-secondary/60 border border-border/40">
              <p className="text-xs text-muted-foreground truncate">{l.name}</p>
              <p className="text-sm font-semibold text-brand-dark">{fmtLockerAmount(lockerBalance(l, db.lockerTransactions), l.currency)}</p>
            </div>
          ))}
        </div>
      )}

      <div>
        <Label className="text-xs">Action</Label>
        <Select value={action} onValueChange={v => setAction(v as LockerAction)}>
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
        <Select value={lockerId} onValueChange={setLockerId}>
          <SelectTrigger className="h-10 rounded-xl mt-1"><SelectValue placeholder="Choose locker" /></SelectTrigger>
          <SelectContent>{lockers.map(l => <SelectItem key={l.id} value={l.id}>{l.name} ({l.currency || "INR"})</SelectItem>)}</SelectContent>
        </Select>
        {selected && (
          <p className="text-xs text-muted-foreground mt-1">Current balance: <span className="font-semibold text-foreground">{fmtLockerAmount(lockerBalance(selected, db.lockerTransactions), selected.currency)}</span></p>
        )}
      </div>

      {action === "transfer_out" && (
        <div>
          <Label className="text-xs">To Locker *</Label>
          <Select value={targetLocker} onValueChange={setTargetLocker}>
            <SelectTrigger className="h-10 rounded-xl mt-1"><SelectValue placeholder="Choose destination" /></SelectTrigger>
            <SelectContent>{lockers.filter(l => l.id !== lockerId).map(l => <SelectItem key={l.id} value={l.id}>{l.name} ({l.currency || "INR"})</SelectItem>)}</SelectContent>
          </Select>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label className="text-xs">Date</Label>
          <Input type="date" value={date} onChange={e => setDate(e.target.value)} className="rounded-xl h-10 mt-1" />
        </div>
        <div>
          <Label className="text-xs">Amount ({cur === "USD" ? "$" : "₹"})</Label>
          <Input type="number" min={0} step="0.01" value={amount} onChange={e => setAmount(e.target.value)} className="rounded-xl h-10 mt-1" />
        </div>
        {crossCurrency ? (
          <div>
            <Label className="text-xs">Exchange Rate (₹ per $) <span className="text-destructive">*</span></Label>
            <Input type="number" min={0} step="0.01" value={exchangeRate} onChange={e => setExchangeRate(e.target.value)} className="rounded-xl h-10 mt-1" placeholder="e.g. 83" />
          </div>
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

      {crossCurrency && (
        <p className="text-xs text-muted-foreground">
          {amount && Number(exchangeRate) > 0 ? (
            <>{target?.name} will receive{" "}
              <span className="font-semibold text-foreground">
                {fmtLockerAmount(cur === "USD" ? Number(amount) * Number(exchangeRate) : Number(amount) / Number(exchangeRate), target?.currency)}
              </span>
            </>
          ) : "Enter the amount and exchange rate above to see the converted amount — the exchange rate is required before you can save this transfer."}
        </p>
      )}

      <Input value={note} onChange={e => setNote(e.target.value)} className="rounded-xl h-10" placeholder="Note (optional)" />

      <AsyncButton onClick={submit} disabled={saving || lockers.length === 0} className="btn-hero rounded-xl h-10 w-full">
        {saving ? "Saving…" : action === "income" ? "Record Deposit" : action === "expense" ? "Record Withdrawal" : "Record Transfer"}
      </AsyncButton>
    </div>
  );
}
