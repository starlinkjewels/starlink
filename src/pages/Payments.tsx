import { useState } from "react";
import { useAuth } from "@/lib/auth";
import {
  updateDb, uid, fmtMoney,
  reconcileClientAccount, type Expense,
} from "@/lib/db";
import { useDb } from "@/hooks/useDb";
import {
  supplierAccount, purchasePending, allocateSupplierPaymentFIFO,
  factoryAccount, issuancePending, allocateFactoryChargePaymentFIFO,
  fmtMoneyInr,
} from "@/lib/manufacturing";
import { Button } from "@/components/ui/button";
import { AsyncButton } from "@/components/AsyncButton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CreditCard, Truck, Factory as FactoryIcon, Receipt, DollarSign } from "lucide-react";
import { toast } from "sonner";

type Mode = "client" | "supplier" | "factory" | "expense";

const DEFAULT_EXPENSE_CATEGORIES = ["Travel", "Food", "Tools", "Office", "Communication", "Other"];

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

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {([
          { m: "client", label: "Receive from Client", icon: CreditCard },
          { m: "supplier", label: "Pay Supplier", icon: Truck },
          { m: "factory", label: "Pay Factory", icon: FactoryIcon },
          { m: "expense", label: "Pay Expense", icon: Receipt },
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
  const [lockerAmount, setLockerAmount] = useState("");
  const [saving, setSaving] = useState(false);

  const clients = db.clients.filter(c => c.status === "active").sort((a, b) => a.companyName.localeCompare(b.companyName));
  const locker = db.lockers.find(l => l.id === lockerId);

  const submit = async () => {
    const c = db.clients.find(x => x.id === clientId);
    if (!c) { toast.error("Choose a client"); return; }
    const amt = parseFloat(amount);
    if (!amt || amt <= 0) { toast.error("Enter a valid amount"); return; }
    if (!lockerId) { toast.error("Choose which locker this was deposited into"); return; }
    if (!lockerAmount || Number(lockerAmount) <= 0) { toast.error("Enter the amount actually deposited in that locker"); return; }
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
            id: uid("ltx_"), lockerId, type: "income", amountInr: Number(lockerAmount),
            currency: locker.currency || "INR", category: `Client Payment — ${client.companyName}`,
            refType: "clientPayment", refId: client.id, note: noteText, recordedBy: user!.id, createdAt: now,
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
      setClientId(""); setAmount(""); setNote(""); setLockerId(""); setLockerAmount("");
    } finally { setSaving(false); }
  };

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
          <Label className="text-xs">Amount ($)</Label>
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
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label className="text-xs">Deposited to Locker *</Label>
          <Select value={lockerId} onValueChange={setLockerId}>
            <SelectTrigger className="h-10 rounded-xl mt-1"><SelectValue placeholder="Choose locker" /></SelectTrigger>
            <SelectContent>{db.lockers.filter(l => l.active !== false).map(l => <SelectItem key={l.id} value={l.id}>{l.name} ({l.currency || "INR"})</SelectItem>)}</SelectContent>
          </Select>
        </div>
        {lockerId && (
          <div>
            <Label className="text-xs">Amount Deposited ({locker?.currency === "USD" ? "$" : "₹"})</Label>
            <Input type="number" min={0} step="0.01" value={lockerAmount} onChange={e => setLockerAmount(e.target.value)} className="rounded-xl h-10 mt-1" />
          </div>
        )}
      </div>
      <AsyncButton onClick={submit} disabled={saving} className="btn-hero rounded-xl h-10 w-full">{saving ? "Saving…" : "Record Payment Received"}</AsyncButton>
    </div>
  );
}

/* ── Pay Supplier — mirrors SupplierHistory.tsx's recordPayment ── */
function PaySupplier() {
  const { user } = useAuth();
  const db = useDb();
  const [supplierId, setSupplierId] = useState("");
  const [amount, setAmount] = useState("");
  const [target, setTarget] = useState("__fifo");
  const [note, setNote] = useState("");
  const [lockerId, setLockerId] = useState("");
  const [saving, setSaving] = useState(false);

  const suppliers = db.suppliers.filter(s => s.active !== false).sort((a, b) => a.name.localeCompare(b.name));
  const purchases = db.purchases.filter(p => p.supplierId === supplierId);
  const account = supplierAccount(purchases);
  const pendingPurchases = purchases.filter(p => purchasePending(p) > 0);

  const submit = () => {
    const s = db.suppliers.find(x => x.id === supplierId);
    if (!s) { toast.error("Choose a supplier"); return; }
    const amt = Number(amount);
    if (!amt || amt <= 0) { toast.error("Enter a valid amount"); return; }
    if (!lockerId) { toast.error("Choose which locker this was paid from"); return; }
    // FIFO only applies up to what's actually pending — anything beyond that
    // would leave the locker but never land on any purchase, silently
    // vanishing from Total Paid. Target a specific purchase to overpay instead.
    if (target === "__fifo" && amt > account.balanceOwed + 0.01) {
      toast.error(`That's ${fmtMoneyInr(amt - account.balanceOwed)} more than this supplier is currently owed (${fmtMoneyInr(account.balanceOwed)}). Enter a smaller amount, or choose a specific purchase to overpay.`);
      return;
    }
    setSaving(true);
    try {
      const now = new Date().toISOString();
      updateDb(d => {
        const supplierPurchases = d.purchases.filter(p => p.supplierId === supplierId);
        if (target === "__fifo") {
          allocateSupplierPaymentFIFO(supplierPurchases, amt, lockerId, user!.id, now, note.trim() || undefined);
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
      <div>
        <Label className="text-xs">Supplier</Label>
        <Select value={supplierId} onValueChange={v => { setSupplierId(v); setTarget("__fifo"); }}>
          <SelectTrigger className="h-10 rounded-xl mt-1"><SelectValue placeholder="Choose supplier" /></SelectTrigger>
          <SelectContent>{suppliers.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}</SelectContent>
        </Select>
      </div>
      {supplierId && (
        <p className="text-xs text-muted-foreground">Balance owed: <span className="font-semibold text-foreground">{fmtMoneyInr(account.balanceOwed)}</span></p>
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
              <SelectItem value="__fifo">Oldest pending first</SelectItem>
              {pendingPurchases.map(p => <SelectItem key={p.id} value={p.id}>{p.invoiceNumber || p.id.slice(-6)} — pending {fmtMoneyInr(purchasePending(p))}</SelectItem>)}
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
      <AsyncButton onClick={submit} disabled={saving} className="btn-hero rounded-xl h-10 w-full">{saving ? "Saving…" : "Record Supplier Payment"}</AsyncButton>
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
  const account = factoryAccount(issuances);
  const pendingIssuances = issuances.filter(i => issuancePending(i) > 0);

  const submit = () => {
    const f = db.factories.find(x => x.id === factoryId);
    if (!f) { toast.error("Choose a factory"); return; }
    const amt = Number(amount);
    if (!amt || amt <= 0) { toast.error("Enter a valid amount"); return; }
    if (!lockerId) { toast.error("Choose which locker this was paid from"); return; }
    // Same reasoning as PaySupplier — FIFO can't silently swallow an amount
    // beyond what's actually pending.
    if (target === "__fifo" && amt > account.chargesPending + 0.01) {
      toast.error(`That's ${fmtMoneyInr(amt - account.chargesPending)} more than this factory is currently owed (${fmtMoneyInr(account.chargesPending)}). Enter a smaller amount, or choose a specific issuance to overpay.`);
      return;
    }
    setSaving(true);
    try {
      const now = new Date().toISOString();
      updateDb(d => {
        const factoryIssuances = d.materialIssuances.filter(i => i.factoryId === factoryId);
        if (target === "__fifo") {
          allocateFactoryChargePaymentFIFO(factoryIssuances, amt, lockerId, user!.id, now, note.trim() || undefined);
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
  const [saving, setSaving] = useState(false);

  const categories = db.settings.expenseCategories?.length ? db.settings.expenseCategories : DEFAULT_EXPENSE_CATEGORIES;
  const locker = db.lockers.find(l => l.id === lockerId);

  const submit = () => {
    if (!title.trim()) { toast.error("Enter a title"); return; }
    const amt = parseFloat(amount);
    if (!amt || amt <= 0) { toast.error("Enter a valid amount"); return; }
    if (!lockerId) { toast.error("Choose which locker this was paid from"); return; }
    if (!lockerAmount || Number(lockerAmount) <= 0) { toast.error("Enter the amount actually paid from that locker"); return; }
    setSaving(true);
    try {
      const now = new Date().toISOString();
      const expense: Expense = {
        id: uid("exp_"), title: title.trim(), amount: amt, category,
        note: note.trim() || undefined, employeeId: user!.id, createdAt: now, lockerId,
      };
      updateDb(d => {
        d.expenses.push(expense);
        const l = d.lockers.find(x => x.id === lockerId);
        if (l) {
          if (!d.lockerTransactions) d.lockerTransactions = [];
          d.lockerTransactions.push({
            id: uid("ltx_"), lockerId, type: "expense", amountInr: Number(lockerAmount),
            currency: l.currency || "INR", category: `Expense — ${title.trim()}`,
            refType: "expense", refId: expense.id, recordedBy: user!.id, createdAt: now,
          });
        }
      });
      toast.success("Expense recorded");
      setTitle(""); setAmount(""); setNote(""); setLockerId(""); setLockerAmount("");
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
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label className="text-xs">Paid from Locker *</Label>
          <Select value={lockerId} onValueChange={v => { setLockerId(v); const l = db.lockers.find(x => x.id === v); setLockerAmount(l?.currency === "USD" ? amount : ""); }}>
            <SelectTrigger className="h-10 rounded-xl mt-1"><SelectValue placeholder="Choose locker" /></SelectTrigger>
            <SelectContent>{db.lockers.filter(l => l.active !== false).map(l => <SelectItem key={l.id} value={l.id}>{l.name} ({l.currency || "INR"})</SelectItem>)}</SelectContent>
          </Select>
        </div>
        {lockerId && (
          <div>
            <Label className="text-xs">Amount Paid ({locker?.currency === "USD" ? "$" : "₹"})</Label>
            <Input type="number" min={0} step="0.01" value={lockerAmount} onChange={e => setLockerAmount(e.target.value)} className="rounded-xl h-10 mt-1" />
          </div>
        )}
      </div>
      <AsyncButton onClick={submit} disabled={saving} className="btn-hero rounded-xl h-10 w-full">{saving ? "Saving…" : "Record Expense"}</AsyncButton>
    </div>
  );
}
