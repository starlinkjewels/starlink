import { useState } from "react";
import { useAuth } from "@/lib/auth";
import {
  updateDb, uid, fmtMoney,
  reconcileClientAccount, type Expense, type Locker, type LockerTransaction,
} from "@/lib/db";
import { useDb } from "@/hooks/useDb";
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

type Mode = "client" | "supplier" | "factory" | "expense" | "locker";

const DEFAULT_EXPENSE_CATEGORIES = ["Travel", "Food", "Tools", "Office", "Communication", "Other"];

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
    <div className="max-w-3xl mx-auto space-y-5">
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

      <div className="card-luxe p-6">
        {mode === "client" && <ReceiveFromClient />}
        {mode === "supplier" && <PaySupplier />}
        {mode === "factory" && <PayFactory />}
        {mode === "expense" && <PayExpense />}
        {mode === "locker" && <LockerActions />}
      </div>
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
  const [saving, setSaving] = useState(false);

  const clients = db.clients.filter(c => c.status === "active").sort((a, b) => a.companyName.localeCompare(b.companyName));
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
      const now = new Date().toISOString();
      updateDb(d => {
        const client = d.clients.find(x => x.id === clientId);
        if (!client) return;
        const clientOrders = d.orders.filter(o => o.clientId === clientId && o.status !== "Rejected");
        const leftover = reconcileClientAccount(clientOrders, amt, client.creditBalance || 0, user!.id, now, noteText);
        client.creditBalance = leftover > 0 ? leftover : undefined;
        const locker = d.lockers.find(l => l.id === lockerId);
        if (locker) {
          if (!d.lockerTransactions) d.lockerTransactions = [];
          d.lockerTransactions.push({
            id: uid("ltx_"), lockerId, type: "income", amountInr: depositAmt,
            currency: locker.currency || "INR", category: `Client Payment — ${client.companyName}`,
            refType: "clientPayment", refId: client.id, note: noteText, recordedBy: user!.id, createdAt: now,
            exchangeRate: needsRate ? rate : undefined,
          });
        }
        const clientUser = d.users.find(u => u.clientId === clientId);
        if (clientUser) d.notifications.unshift({
          id: uid("n_"), userId: clientUser.id, title: "Payment Received",
          body: `${fmtMoney(amt)} received via ${method} and applied to your oldest pending orders.`,
          type: "info", read: false, createdAt: now,
        });
      });
      toast.success(`${fmtMoney(amt)} received from ${c.companyName}`);
      setClientId(""); setAmount(""); setNote(""); setLockerId(""); setExchangeRate("");
    } finally { setSaving(false); }
  };

  const depositPreview = amount && needsRate && rate > 0 ? Number(amount) * rate : amount ? Number(amount) : null;

  return (
    <div className="space-y-3">
      <div>
        <Label className="text-xs">Client</Label>
        <Select value={clientId} onValueChange={setClientId}>
          <SelectTrigger className="h-10 rounded-xl mt-1"><SelectValue placeholder="Choose client" /></SelectTrigger>
          <SelectContent>{clients.map(c => <SelectItem key={c.id} value={c.id}>{c.companyName}</SelectItem>)}</SelectContent>
        </Select>
      </div>
      <div className="grid grid-cols-2 gap-3">
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
      </div>
      <Input value={note} onChange={e => setNote(e.target.value)} className="rounded-xl h-10" placeholder="Remark / ref (optional)" />
      <div>
        <Label className="text-xs">Deposited to Locker *</Label>
        <Select value={lockerId} onValueChange={setLockerId}>
          <SelectTrigger className="h-10 rounded-xl mt-1"><SelectValue placeholder="Choose locker" /></SelectTrigger>
          <SelectContent>{db.lockers.filter(l => l.active !== false).map(l => <SelectItem key={l.id} value={l.id}>{l.name} ({l.currency || "INR"})</SelectItem>)}</SelectContent>
        </Select>
      </div>
      {needsRate && (
        <div className="p-3 rounded-xl bg-secondary space-y-2">
          <Label className="text-xs">Exchange Rate — 1 USD = ₹ <span className="text-destructive">*</span></Label>
          <Input type="number" min={0} step="0.01" value={exchangeRate} onChange={e => setExchangeRate(e.target.value)} className="rounded-xl h-10 bg-white" placeholder="e.g. 83.50" />
          <p className="text-xs text-muted-foreground">This locker holds INR, not USD — enter today's rate to convert what lands in it.</p>
        </div>
      )}
      {amount && lockerId && (
        <div className="p-4 rounded-xl border border-border/60 bg-secondary/30 space-y-1.5">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Summary</p>
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Received</span>
            <span className="font-medium text-foreground">{fmtMoney(Number(amount))}</span>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Applied to client's order</span>
            <span className="font-semibold text-primary">{fmtMoney(Number(amount))}</span>
          </div>
          {depositPreview != null && locker && (
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Deposited to {locker.name}</span>
              <span className="font-semibold text-foreground">{lockerCurrency === "USD" ? "$" : "₹"}{depositPreview.toFixed(2)}</span>
            </div>
          )}
        </div>
      )}
      <AsyncButton onClick={submit} disabled={saving} className="btn-hero rounded-xl h-10 w-full">{saving ? "Saving…" : "Record Payment Received"}</AsyncButton>
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

  const suppliers = db.suppliers.filter(s => s.active !== false).sort((a, b) => a.name.localeCompare(b.name));
  const purchases = db.purchases.filter(p => p.supplierId === supplierId);
  const account = supplierAccount(purchases, (db.supplierReceipts ?? []).filter(r => r.supplierId === supplierId), db.suppliers.find(s => s.id === supplierId));
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
        const now = new Date().toISOString();
        updateDb(d => {
          if (!d.supplierReceipts) d.supplierReceipts = [];
          d.supplierReceipts.push({ id: uid("srcpt_"), supplierId, amountInr: amt, lockerId, recordedBy: user!.id, createdAt: now, note: note.trim() || undefined });
          if (!d.lockerTransactions) d.lockerTransactions = [];
          d.lockerTransactions.push({ id: uid("ltx_"), lockerId, type: "income", amountInr: amt, category: `Received from ${s.name}`, refType: "manual", note: note.trim() || undefined, recordedBy: user!.id, createdAt: now });
        });
        toast.success(`${fmtMoneyInr(amt)} received from ${s.name}`);
        setSupplierId(""); setAmount(""); setTarget("__fifo"); setNote(""); setLockerId("");
      } finally { setSaving(false); }
      return;
    }
    // ── Pay: money out TO the supplier. ──
    // Overpayment is allowed — the excess beyond what's owed is recorded as an
    // overpay on the newest purchase, never silently lost.
    if (!confirmOverdraw(db.lockers, db.lockerTransactions, lockerId, amt)) return;
    setSaving(true);
    try {
      const now = new Date().toISOString();
      updateDb(d => {
        const supplierPurchases = d.purchases.filter(p => p.supplierId === supplierId);
        if (target === "__fifo") {
          const leftover = allocateSupplierPaymentFIFO(supplierPurchases, amt, lockerId, user!.id, now, note.trim() || undefined);
          if (leftover > 0) {
            const newest = [...supplierPurchases].sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt))[0];
            if (newest) {
              if (!newest.payments) newest.payments = [];
              newest.payments.push({ id: uid("ppay_"), amountInr: leftover, lockerId, recordedBy: user!.id, createdAt: now, note: note.trim() || undefined });
            }
          }
        } else {
          const p = d.purchases.find(p => p.id === target);
          if (p) {
            if (!p.payments) p.payments = [];
            p.payments.push({ id: uid("ppay_"), amountInr: amt, lockerId, recordedBy: user!.id, createdAt: now, note: note.trim() || undefined });
          }
        }
        if (!d.lockerTransactions) d.lockerTransactions = [];
        d.lockerTransactions.push({
          id: uid("ltx_"), lockerId, type: "expense", amountInr: amt,
          category: `Supplier Payment — ${s.name}`, refType: "purchase",
          refId: target === "__fifo" ? undefined : target,
          note: note.trim() || undefined, recordedBy: user!.id, createdAt: now,
        });
      });
      toast.success(`${fmtMoneyInr(amt)} paid to ${s.name}`);
      setSupplierId(""); setAmount(""); setTarget("__fifo"); setNote(""); setLockerId("");
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
      <div className={`grid gap-3 ${dir === "pay" ? "grid-cols-2" : "grid-cols-1"}`}>
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

  const factories = db.factories.filter(f => f.active !== false).sort((a, b) => a.name.localeCompare(b.name));
  const issuances = db.materialIssuances.filter(i => i.factoryId === factoryId);
  const account = factoryAccount(issuances, db.factories.find(f => f.id === factoryId));
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
      const now = new Date().toISOString();
      updateDb(d => {
        const factoryIssuances = d.materialIssuances.filter(i => i.factoryId === factoryId);
        if (target === "__fifo") {
          const leftover = allocateFactoryChargePaymentFIFO(factoryIssuances, amt, lockerId, user!.id, now, note.trim() || undefined);
          if (leftover > 0) {
            // Park the excess on the newest issuance so Total Paid / Overpaid reflect it.
            const newest = [...factoryIssuances].sort((a, b) => +new Date(b.issuedAt) - +new Date(a.issuedAt))[0];
            if (newest) {
              if (!newest.makingCharges.payments) newest.makingCharges.payments = [];
              newest.makingCharges.payments.push({ id: uid("fpay_"), amountInr: leftover, lockerId, recordedBy: user!.id, createdAt: now, note: note.trim() || undefined });
            }
          }
        } else {
          const mi = d.materialIssuances.find(x => x.id === target);
          if (mi) {
            if (!mi.makingCharges.payments) mi.makingCharges.payments = [];
            mi.makingCharges.payments.push({ id: uid("fpay_"), amountInr: amt, lockerId, recordedBy: user!.id, createdAt: now, note: note.trim() || undefined });
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
      setFactoryId(""); setAmount(""); setTarget("__fifo"); setNote(""); setLockerId("");
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
          <Label className="text-xs">Amount (₹)</Label>
          <Input type="number" min={1} value={amount} onChange={e => setAmount(e.target.value)} className="rounded-xl h-10 mt-1" />
        </div>
        <div>
          <Label className="text-xs">Against</Label>
          <Select value={target} onValueChange={setTarget}>
            <SelectTrigger className="h-10 rounded-xl mt-1"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__fifo">Oldest issued first</SelectItem>
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
  const [lockerAmount, setLockerAmount] = useState("");
  const [paidToEmployeeId, setPaidToEmployeeId] = useState("");
  const [saving, setSaving] = useState(false);

  const staff = db.users.filter(u => u.role === "admin" || u.role === "employee");
  const categories = db.settings.expenseCategories?.length ? db.settings.expenseCategories : DEFAULT_EXPENSE_CATEGORIES;
  const locker = db.lockers.find(l => l.id === lockerId);
  const isUsdLocker = (locker?.currency || "INR") === "USD";

  const submit = () => {
    if (!title.trim()) { toast.error("Enter a title"); return; }
    const amt = parseFloat(amount);
    if (!amt || amt <= 0) { toast.error("Enter a valid amount"); return; }
    if (!lockerId) { toast.error("Choose which locker this was paid from"); return; }
    const paidAmt = isUsdLocker ? amt : Number(lockerAmount);
    if (!paidAmt || paidAmt <= 0) { toast.error("Enter the amount actually paid from that locker"); return; }
    if (!confirmOverdraw(db.lockers, db.lockerTransactions, lockerId, paidAmt)) return;
    setSaving(true);
    try {
      const now = new Date().toISOString();
      const expense: Expense = {
        id: uid("exp_"), title: title.trim(), amount: amt, category,
        note: note.trim() || undefined, employeeId: user!.id,
        paidToEmployeeId: paidToEmployeeId || undefined, createdAt: now, lockerId,
      };
      updateDb(d => {
        d.expenses.push(expense);
        const l = d.lockers.find(x => x.id === lockerId);
        if (l) {
          if (!d.lockerTransactions) d.lockerTransactions = [];
          d.lockerTransactions.push({
            id: uid("ltx_"), lockerId, type: "expense", amountInr: paidAmt,
            currency: l.currency || "INR", category: `Expense — ${title.trim()}`,
            refType: "expense", refId: expense.id, recordedBy: user!.id, createdAt: now,
          });
        }
      });
      toast.success("Expense recorded");
      setTitle(""); setAmount(""); setNote(""); setLockerId(""); setLockerAmount(""); setPaidToEmployeeId("");
    } finally { setSaving(false); }
  };

  return (
    <div className="space-y-3">
      <div>
        <Label className="text-xs">Title</Label>
        <Input value={title} onChange={e => setTitle(e.target.value)} className="rounded-xl h-10 mt-1" placeholder="e.g. Office supplies" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label className="text-xs">Amount ($)</Label>
          <div className="relative mt-1">
            <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input type="number" min={0} step="0.01" value={amount} onChange={e => setAmount(e.target.value)} className="pl-9 h-10 rounded-xl" />
          </div>
        </div>
        <div>
          <Label className="text-xs">Category</Label>
          <Select value={category} onValueChange={setCategory}>
            <SelectTrigger className="h-10 rounded-xl mt-1"><SelectValue /></SelectTrigger>
            <SelectContent>{categories.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
          </Select>
        </div>
      </div>
      <Input value={note} onChange={e => setNote(e.target.value)} className="rounded-xl h-10" placeholder="Note (optional)" />
      <div>
        <Label className="text-xs">Salary / Paid to Team Member (optional)</Label>
        <Select value={paidToEmployeeId || "__none"} onValueChange={v => {
          setPaidToEmployeeId(v === "__none" ? "" : v);
          if (v !== "__none" && category === "Other") setCategory("Salary");
        }}>
          <SelectTrigger className="h-10 rounded-xl mt-1"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__none">Not a staff payment</SelectItem>
            {staff.map(u => <SelectItem key={u.id} value={u.id}>{u.name} ({u.role})</SelectItem>)}
          </SelectContent>
        </Select>
        {paidToEmployeeId && <p className="text-[11px] text-muted-foreground mt-1">Shows on this member's payment ledger.</p>}
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label className="text-xs">Paid from Locker *</Label>
          <Select value={lockerId} onValueChange={setLockerId}>
            <SelectTrigger className="h-10 rounded-xl mt-1"><SelectValue placeholder="Choose locker" /></SelectTrigger>
            <SelectContent>{db.lockers.filter(l => l.active !== false).map(l => <SelectItem key={l.id} value={l.id}>{l.name} ({l.currency || "INR"})</SelectItem>)}</SelectContent>
          </Select>
        </div>
        {lockerId && !isUsdLocker && (
          <div>
            <Label className="text-xs">Amount Paid (₹)</Label>
            <Input type="number" min={0} step="0.01" value={lockerAmount} onChange={e => setLockerAmount(e.target.value)} className="rounded-xl h-10 mt-1" />
          </div>
        )}
      </div>
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
  const [note, setNote] = useState("");
  const [targetLocker, setTargetLocker] = useState("");
  const [exchangeRate, setExchangeRate] = useState("");
  const [saving, setSaving] = useState(false);

  const lockers = db.lockers.filter(l => l.active !== false);
  const selected = lockers.find(l => l.id === lockerId) ?? null;
  const target = action === "transfer_out" ? lockers.find(l => l.id === targetLocker) : undefined;
  const crossCurrency = !!selected && !!target && (target.currency || "INR") !== (selected.currency || "INR");
  const cur = selected?.currency || "INR";

  const submit = () => {
    if (!selected) { toast.error("Choose a locker"); return; }
    const amt = Number(amount);
    if (!amt || amt <= 0) { toast.error("Enter a valid amount"); return; }
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
      const now = new Date().toISOString();
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
            category: "Transfer", pairedLockerId: dest.id, note: note.trim() || undefined,
            exchangeRate: crossCurrency ? rate : undefined,
            recordedBy: user!.id, createdAt: now,
          });
          d.lockerTransactions.push({
            id: uid("ltx_"), lockerId: dest.id, type: "transfer_in", amountInr: destAmount, currency: dest.currency || "INR",
            category: "Transfer", pairedLockerId: selected.id, note: note.trim() || undefined,
            exchangeRate: crossCurrency ? rate : undefined,
            recordedBy: user!.id, createdAt: now,
          });
        } else {
          d.lockerTransactions.push({
            id: uid("ltx_"), lockerId: selected.id, type: action, amountInr: amt, currency: cur,
            category: category.trim() || undefined, refType: "manual",
            note: note.trim() || undefined, recordedBy: user!.id, createdAt: now,
          });
        }
      });
      toast.success(
        action === "income" ? `${fmtLockerAmount(amt, selected.currency)} deposited to ${selected.name}`
          : action === "expense" ? `${fmtLockerAmount(amt, selected.currency)} withdrawn from ${selected.name}`
          : `${fmtLockerAmount(amt, selected.currency)} transferred to ${target?.name}`,
      );
      setAmount(""); setCategory(""); setNote(""); setTargetLocker(""); setExchangeRate("");
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
            <Label className="text-xs">Category (optional)</Label>
            <Input value={category} onChange={e => setCategory(e.target.value)} className="rounded-xl h-10 mt-1" placeholder="e.g. Owner deposit" />
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
