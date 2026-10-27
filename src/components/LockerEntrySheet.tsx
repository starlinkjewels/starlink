import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { ArrowDownCircle, ArrowUpCircle, ArrowLeftRight, Landmark } from "lucide-react";
import {
  updateDb, fmtMoney, todayLocal, stampFor, balanceDue, invoiceOrderIds, clientAccount,
  DEFAULT_LOCKER_CATEGORIES, DEFAULT_EXPENSE_CATEGORIES, type Order,
} from "@/lib/db";
import { useDb } from "@/hooks/useDb";
import { useAuth } from "@/lib/auth";
import { useCan } from "@/hooks/useCan";
import { useLoaded } from "@/hooks/useLoaded";
import { TOTALS_COLS, type LazyCol } from "@/lib/pageData";
import { needsAccess } from "@/lib/actionHints";
import { confirmBox } from "@/lib/confirm";
import { reserveVoucherNumber } from "@/lib/counters";
import { createReceipt } from "@/lib/receipts";
import { refundable, refundProblem, writeClientRefund } from "@/lib/clientRefunds";
import { allocateOldestFirst, brokerAccount, brokerPendingBills } from "@/lib/brokers";
import {
  supplierAccount, purchasePending, factoryAccount, issuancePending, lockerBalance, fmtMoneyInr,
} from "@/lib/manufacturing";
import { materialUnit } from "@/lib/materials";
import { ccy, ccySymbol, fmtCcy, roundCcy } from "@/lib/currency";
import {
  notifyClientPayment, writeAccountEntry, writeBrokerPayment, writeBrokerReceipt, writeExpense,
  writeFactoryPayment, writeSupplierPayment, writeSupplierReceipt, writeTransfer,
} from "@/lib/partyPayments";
import { ActionSheet } from "@/components/ActionSheet";
import { ListCombo } from "@/components/ListCombo";
import { RateInput } from "@/components/CurrencyFields";
import { AsyncButton } from "@/components/AsyncButton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AddNewItem, useAddNew } from "@/components/create/QuickCreate";

type Dir = "in" | "out" | "transfer";
/**
 * Who the money is with. Each is written exactly as the Payments page writes
 * it (lib/partyPayments.ts), so it lands in that party's books: a supplier's
 * bills, a factory's making charges, an employee's salary ledger, Expenses and
 * Profit & Loss, a client's invoices (a numbered receipt) or credit (a refund),
 * a broker's account. "Other" is an entry in the account only.
 */
type Who = "client" | "supplier" | "factory" | "broker" | "employee" | "expense" | "other";
const WHO: Record<Who, { in?: string; out?: string; name: string; rupees?: boolean }> = {
  client: { in: "Client — their payment", out: "Client — refund their credit", name: "Client" },
  supplier: { in: "Supplier — money back from them", out: "Supplier — their bill, or an advance", name: "Supplier", rupees: true },
  factory: { out: "Factory — making charges", name: "Factory", rupees: true },
  broker: { in: "Broker — money he hands over", out: "Broker — pay through him", name: "Broker", rupees: true },
  employee: { out: "Employee — salary, advance, bonus", name: "Employee" },
  expense: { out: "Expense — rent, courier, office…", name: "Expense" },
  other: { in: "Other — owner's deposit, extra income", out: "Other — owner's drawing, bank charges", name: "Other" },
};
const ORDER: Record<"in" | "out", Who[]> = {
  in: ["client", "supplier", "broker", "other"],
  out: ["supplier", "factory", "employee", "expense", "broker", "client", "other"],
};
/** What each party's choices read beyond the Locker's own records. */
const NEEDS: Partial<Record<Who, readonly LazyCol[]>> = {
  client: ["clientReceipts"],
  supplier: TOTALS_COLS.supplier,
  factory: TOTALS_COLS.factory,
  broker: ["purchases", "supplierSales", "supplierReceipts"],
};
const r2 = (n: number) => Math.round(n * 100) / 100;

/**
 * The Locker's one form for every entry, in the same order every time:
 * account · in / out / transfer · who · their name · amount and date · what it
 * is against · note. Opened from the page's header on the account being
 * looked at, which can be changed here.
 */
export function LockerEntrySheet({ open, onOpenChange, lockerId: startLocker }: {
  open: boolean; onOpenChange: (v: boolean) => void; lockerId?: string;
}) {
  const db = useDb();
  const addNew = useAddNew();
  const { user } = useAuth();
  const can = useCan();
  const isAdmin = user?.role === "admin";
  const lockers = db.lockers.filter(l => l.active !== false);

  const [accountId, setAccountId] = useState("");
  const [dir, setDir] = useState<Dir>("out");
  const [who, setWho] = useState<Who | "">("");
  const [partyId, setPartyId] = useState("");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(todayLocal());
  const [against, setAgainst] = useState("");
  const [category, setCategory] = useState("");
  const [title, setTitle] = useState("");
  const [method, setMethod] = useState("");
  const [rate, setRate] = useState<number | "">("");
  const [toAccount, setToAccount] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  // A fresh form each time it opens, on the account being looked at.
  useEffect(() => {
    if (!open) return;
    setAccountId(startLocker && lockers.some(l => l.id === startLocker) ? startLocker : lockers[0]?.id ?? "");
    setWho(""); setPartyId(""); setAmount(""); setDate(todayLocal()); setAgainst(""); setCategory("");
    setTitle(""); setMethod(""); setRate(""); setToAccount(""); setNote("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const account = lockers.find(l => l.id === accountId);
  const cur = ccy(account?.currency);
  const sym = ccySymbol(cur).trim();
  const rupees = cur === "INR";
  const amt = Number(amount) || 0;
  const bal = account ? lockerBalance(account, db.lockerTransactions) : 0;
  const ready = useLoaded(open && who ? NEEDS[who] ?? [] : []);

  // Why a choice can't be made from this account, or nothing when it can.
  const whyNot = (w: Who): string | undefined => {
    if (w === "other") return can("locker", "add") ? undefined : "no access";
    if (!can("payments", "add")) return "no access to payments";
    if (WHO[w].rupees && !rupees) return "rupee accounts only";
    if (w === "broker" && dir === "in" && !isAdmin) return "admins only";
    return undefined;
  };
  const pickDir = (d: Dir) => { setDir(d); setWho(""); setPartyId(""); setAgainst(""); setCategory(""); setRate(""); };
  const pickWho = (w: Who) => {
    setWho(w); setPartyId(""); setAgainst(w === "supplier" || w === "factory" ? "__fifo" : w === "broker" ? "__oldest" : "");
    setTitle(""); setRate("");
    setCategory(w === "employee" ? "Salary" : "");
    setMethod(w === "client" ? (account?.type === "cash" ? "Cash" : "Bank Transfer") : "");
  };
  // A changed account can rule out the party picked (a rupee-only one on a dollar account).
  useEffect(() => { if (who && whyNot(who)) { setWho(""); setPartyId(""); } setRate(""); setToAccount(t => (t === accountId ? "" : t));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId]);

  /* ── The people and lists for the party picked ── */
  const expenseCats = useMemo(() => {
    const list = db.settings.expenseCategories?.length ? db.settings.expenseCategories : DEFAULT_EXPENSE_CATEGORIES;
    return list.includes("Salary") ? list : ["Salary", ...list];
  }, [db.settings.expenseCategories]);
  const lockerCats = db.settings.lockerCategories?.length ? db.settings.lockerCategories : DEFAULT_LOCKER_CATEGORIES;
  // A new one can be added right here — except a client to refund (a new client holds no credit).
  const newKind: "client" | "supplier" | "factory" | "broker" | "employee" | null =
    who === "supplier" || who === "factory" || who === "broker" || who === "employee" ? who : who === "client" && dir === "in" ? "client" : null;
  const parties: { id: string; label: string }[] = !who ? [] :
    who === "client" ? db.clients
      .filter(c => (dir === "out" ? (c.creditBalance || 0) > 0.005 : c.status === "active"))
      .sort((a, b) => a.companyName.localeCompare(b.companyName))
      .map(c => ({ id: c.id, label: dir === "out" ? `${c.companyName} — ${fmtMoney(c.creditBalance || 0)} credit` : c.companyName }))
    : who === "supplier" ? db.suppliers.filter(s => s.active !== false).sort((a, b) => a.name.localeCompare(b.name)).map(s => ({ id: s.id, label: s.name }))
    : who === "factory" ? db.factories.filter(f => f.active !== false).sort((a, b) => a.name.localeCompare(b.name)).map(f => ({ id: f.id, label: f.name }))
    : who === "broker" ? (db.brokers ?? []).filter(b => b.active !== false).sort((a, b) => a.name.localeCompare(b.name)).map(b => ({ id: b.id, label: b.name }))
    : who === "employee" ? db.users.filter(u => u.role === "admin" || u.role === "employee").sort((a, b) => a.name.localeCompare(b.name)).map(u => ({ id: u.id, label: u.name }))
    : [];

  // Where they stand, and what this money can go against.
  const client = who === "client" ? db.clients.find(c => c.id === partyId) : undefined;
  const supplier = who === "supplier" ? db.suppliers.find(s => s.id === partyId) : undefined;
  const factory = who === "factory" ? db.factories.find(f => f.id === partyId) : undefined;
  const broker = who === "broker" ? (db.brokers ?? []).find(b => b.id === partyId) : undefined;
  const supAcc = supplier ? supplierAccount(
    db.purchases.filter(p => p.supplierId === supplier.id), (db.supplierReceipts ?? []).filter(r => r.supplierId === supplier.id),
    supplier, (db.supplierPayments ?? []).filter(x => x.supplierId === supplier.id), (db.supplierSales ?? []).filter(x => x.supplierId === supplier.id),
  ) : null;
  const facAcc = factory ? factoryAccount(db.materialIssuances.filter(i => i.factoryId === factory.id), factory, (db.factoryPayments ?? []).filter(x => x.factoryId === factory.id)) : null;
  const brAcc = broker ? brokerAccount(db, broker) : null;
  const brBills = broker ? brokerPendingBills(db, broker.id) : [];
  const cliAcc = client ? clientAccount(db.orders.filter(o => o.clientId === client.id && o.status !== "Rejected"), client.creditBalance || 0, client) : null;
  const invoices = client && dir === "in" ? (db.invoices ?? []).filter(i => i.clientId === client.id).map(i => ({
    inv: i, bal: invoiceOrderIds(i).map(id => db.orders.find(o => o.id === id)).filter((o): o is Order => !!o && o.status !== "Rejected").reduce((s, o) => s + balanceDue(o), 0),
  })).sort((a, b) => +new Date(b.inv.createdAt) - +new Date(a.inv.createdAt)) : [];
  // One invoice still owing → that is what a client's money is for.
  useEffect(() => {
    if (who !== "client" || dir !== "in") return;
    const unpaid = invoices.filter(x => x.bal > 0.005);
    setAgainst(unpaid.length === 1 ? unpaid[0].inv.id : "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [partyId]);

  const standing = !partyId ? "" :
    supAcc ? (supAcc.net < 0 ? `They owe us ${fmtMoneyInr(-supAcc.net)}` : `We owe them ${fmtMoneyInr(supAcc.net)}`)
    : facAcc ? `Making charges pending ${fmtMoneyInr(facAcc.chargesPending)}`
    : brAcc ? `Bills pending ${fmtMoneyInr(brAcc.billsPending)} · brokerage owed ${fmtMoneyInr(Math.max(0, brAcc.due))} · holds ${fmtMoneyInr(brAcc.held)}`
    : cliAcc ? (dir === "out" ? `Holds ${fmtMoney(refundable(db, partyId))} of credit` : `Owes ${fmtMoney(cliAcc.outstanding)} · holds ${fmtMoney(cliAcc.credit)} credit`)
    : "";

  // A client's money is in dollars: on any other account, the rate turns the amount into their bill.
  const needsUsdRate = who === "client" && cur !== "USD";
  const usdRaw = who === "client" ? (cur === "USD" ? r2(amt) : Number(rate) > 0 ? r2(amt / Number(rate)) : 0) : 0;
  // "Refund all" typed back through a rate can land a cent either side of the credit.
  const heldCredit = who === "client" && dir === "out" && partyId ? refundable(db, partyId) : 0;
  const usd = heldCredit > 0 && Math.abs(usdRaw - heldCredit) <= 0.011 ? heldCredit : usdRaw;
  // Broker: oldest bills first after his brokerage, or simply held by him.
  const brokerage = brAcc ? Math.max(0, brAcc.due) : 0;
  const brokerAlloc = broker && against === "__oldest"
    ? allocateOldestFirst(brBills, Math.max(0, r2(amt + (brAcc?.held ?? 0) - brokerage))).alloc : {};
  const brokerSettles = r2(Object.values(brokerAlloc).reduce((s, v) => s + v, 0));
  const target = lockers.find(l => l.id === toAccount);
  const crossTransfer = dir === "transfer" && !!target && ccy(target.currency) !== cur;

  const reset = () => { setAmount(""); setNote(""); setTitle(""); setPartyId(""); setRate(""); };

  const save = async () => {
    if (!account) { toast.error("Choose the account"); return; }
    if (!(amt > 0)) { toast.error("Enter the amount"); return; }
    if (dir === "transfer") {
      if (!target) { toast.error("Choose the account it goes to"); return; }
      if (crossTransfer && !(Number(rate) > 0)) { toast.error(`Enter the rate — ${target.name} holds ${ccy(target.currency)}`); return; }
    } else {
      if (!who) { toast.error(dir === "in" ? "Choose who it is from" : "Choose who it is paid to"); return; }
      const why = whyNot(who);
      if (why) { toast.error(`${WHO[who].name}: ${why}`); return; }
      if (who !== "expense" && who !== "other" && !partyId) { toast.error(`Choose the ${WHO[who].name.toLowerCase()}`); return; }
      if ((who === "expense" || who === "other" || who === "employee") && !category) { toast.error("Choose a category"); return; }
      if (who === "expense" && !title.trim()) { toast.error("Say what it was for"); return; }
      if (needsUsdRate && !(Number(rate) > 0)) { toast.error("Enter the rate — the client's account is in USD"); return; }
      if (who === "client" && !(usd >= 0.01)) { toast.error("That comes to less than one cent — check the amount and rate"); return; }
    }
    // Money leaving that the account doesn't hold is almost always a slip.
    if (dir !== "in" && amt > bal && !(await confirmBox(`${fmtCcy(amt, cur)} is more than ${account.name}'s balance of ${fmtCcy(bal, cur)}.\n\nThe balance will go negative — continue only if a deposit is still missing.`))) return;

    setSaving(true);
    try {
      const at = stampFor(date);
      const base = { lockerId: account.id, amount: amt, note, userId: user!.id, at };
      if (dir === "transfer" || who === "other") {
        // Checked before the number is taken — a number not used is a hole in the book.
        if (dir === "transfer" && (!db.lockers.some(l => l.id === toAccount) || toAccount === account.id)) { toast.error("That account couldn't be found — pick it again"); return; }
        const voucherNo = await reserveVoucherNumber(db.lockerTransactions ?? []);
        let ok = true;
        updateDb(d => {
          if (dir === "transfer") ok = writeTransfer(d, { ...base, toLockerId: toAccount, rate: crossTransfer ? Number(rate) : undefined, voucherNo });
          else ok = writeAccountEntry(d, { ...base, type: dir === "in" ? "income" : "expense", category, voucherNo });
        });
        if (!ok) { toast.error("That account couldn't be found — pick it again"); return; }
        toast.success(dir === "transfer" ? `${fmtCcy(amt, cur)} moved to ${target?.name}` : `${fmtCcy(amt, cur)} recorded`);
      } else if (who === "client" && dir === "in") {
        const methodText = method.trim() || "Payment received";
        const r = await createReceipt({
          clientId: partyId, amountUsd: usd, date: at, method: methodText, remarks: note.trim() || undefined,
          lockerId: account.id, lockerAmount: roundCcy(amt, cur), lockerCurrency: cur,
          exchangeRate: cur === "USD" ? undefined : Number(rate), invoiceId: against || undefined, userId: user!.id,
        });
        updateDb(d => notifyClientPayment(d, partyId, usd, methodText, against || undefined, at));
        toast.success(`Receipt ${r.receiptNo} — ${fmtMoney(usd)} from ${client?.companyName}`);
      } else if (who === "client") {
        const x = { clientId: partyId, lockerId: account.id, amountUsd: usd, rate: cur === "USD" ? undefined : Number(rate), lockerAmount: roundCcy(amt, cur), note, userId: user!.id, at };
        let refused = refundProblem(db, x);
        if (!refused) updateDb(d => { refused = refundProblem(d, x); if (!refused) writeClientRefund(d, x); });
        if (refused) { toast.error(refused); return; }
        toast.success(`${fmtMoney(usd)} refunded to ${client?.companyName}`);
      } else {
        updateDb(d => {
          if (who === "supplier") {
            if (dir === "in") writeSupplierReceipt(d, { ...base, supplierId: partyId });
            else writeSupplierPayment(d, { ...base, supplierId: partyId, target: against || "__fifo" });
          } else if (who === "factory") {
            writeFactoryPayment(d, { ...base, factoryId: partyId, target: against || "__fifo" });
          } else if (who === "broker") {
            if (dir === "in") writeBrokerReceipt(d, { ...base, brokerId: partyId });
            else writeBrokerPayment(d, { ...base, brokerId: partyId,
              lines: Object.entries(brokerAlloc).map(([purchaseId, v]) => ({ purchaseId, amount: v })) });
          } else if (who === "employee") {
            const name = db.users.find(u => u.id === partyId)?.name ?? "";
            writeExpense(d, { ...base, title: title.trim() || `${category} — ${name}`, category, paidToEmployeeId: partyId });
          } else if (who === "expense") {
            writeExpense(d, { ...base, title, category });
          }
        });
        toast.success(`${fmtCcy(amt, cur)} ${dir === "in" ? "received from" : "paid to"} ${parties.find(p => p.id === partyId)?.label ?? title.trim()}`);
      }
      reset();
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't save — nothing was recorded");
    } finally { setSaving(false); }
  };

  const after = bal + (dir === "in" ? amt : -amt);
  const field = "h-10 rounded-xl mt-1";
  return (
    <ActionSheet open={open} onOpenChange={onOpenChange} size="md" icon={Landmark}
      title="Record entry" description="Money in, money out, or between our accounts"
      footer={
        <div className="space-y-3">
          {amt > 0 && account && (
            <div className="flex items-end justify-between gap-3 flex-wrap">
              <div className="min-w-0">
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{dir === "in" ? "Money in" : dir === "out" ? "Money out" : "Moving"}</p>
                <p className={`font-display text-xl font-bold tabular-nums leading-tight ${dir === "in" ? "text-success" : "text-destructive"}`}>{fmtCcy(amt, cur)}</p>
                {who === "client" && usd > 0 && cur !== "USD" && <p className="text-[11px] text-muted-foreground">= {fmtMoney(usd)} {dir === "in" ? "on their account" : "off their credit"}</p>}
              </div>
              <p className="text-xs text-muted-foreground text-right">
                {account.name}: {fmtCcy(bal, cur)} → <span className={`font-semibold ${after < 0 ? "text-destructive" : "text-foreground"}`}>{fmtCcy(after, cur)}</span>
              </p>
            </div>
          )}
          <div className="flex items-center justify-end gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)} className="rounded-xl h-10 flex-1 sm:flex-none">Cancel</Button>
            <AsyncButton onClick={save} disabled={saving || (!!who && !ready)} className="btn-hero rounded-xl h-10 flex-1 sm:flex-none sm:px-10">{saving ? "Saving…" : "Save"}</AsyncButton>
          </div>
        </div>
      }>
      <div className="space-y-4">
        {/* 1. The account */}
        <div>
          <Label className="text-xs">Account</Label>
          <Select value={accountId} onValueChange={addNew("locker", setAccountId)}>
            <SelectTrigger className={field} aria-label="Account"><SelectValue placeholder="Choose account" /></SelectTrigger>
            <SelectContent>{lockers.map(l => <SelectItem key={l.id} value={l.id}>{l.name} · {fmtCcy(lockerBalance(l, db.lockerTransactions), l.currency)}</SelectItem>)}<AddNewItem kind="locker" /></SelectContent>
          </Select>
        </div>

        {/* 2. In, out, or between our accounts */}
        <div className="grid grid-cols-3 gap-1 p-1 bg-secondary rounded-xl" role="radiogroup" aria-label="Type">
          {([["in", "Money in", ArrowDownCircle], ["out", "Money out", ArrowUpCircle], ["transfer", "Transfer", ArrowLeftRight]] as const).map(([d, label, Icon]) => (
            <button key={d} type="button" role="radio" aria-checked={dir === d} onClick={() => pickDir(d)}
              className={`h-10 rounded-lg text-sm font-medium inline-flex items-center justify-center gap-1.5 transition-colors ${dir === d ? "bg-white shadow-soft text-brand-dark" : "text-muted-foreground hover:text-foreground"}`}>
              <Icon className="h-4 w-4 shrink-0" /><span className="truncate">{label}</span>
            </button>
          ))}
        </div>

        {dir === "transfer" ? (
          <div>
            <Label className="text-xs">To account</Label>
            <Select value={toAccount} onValueChange={addNew("locker", v => { setToAccount(v); setRate(""); })}>
              <SelectTrigger className={field} aria-label="To account"><SelectValue placeholder="Choose account" /></SelectTrigger>
              <SelectContent>{lockers.filter(l => l.id !== accountId).map(l => <SelectItem key={l.id} value={l.id}>{l.name} ({ccy(l.currency)})</SelectItem>)}<AddNewItem kind="locker" /></SelectContent>
            </Select>
          </div>
        ) : (
          <>
            {/* 3. Who */}
            <div>
              <Label className="text-xs">{dir === "in" ? "Received from" : "Paid to"}</Label>
              <Select value={who} onValueChange={v => pickWho(v as Who)}>
                <SelectTrigger className={field} aria-label={dir === "in" ? "Received from" : "Paid to"}><SelectValue placeholder="Choose…" /></SelectTrigger>
                <SelectContent>
                  {ORDER[dir].map(w => {
                    const why = whyNot(w);
                    return <SelectItem key={w} value={w} disabled={!!why}>{WHO[w][dir]}{why ? ` (${why})` : ""}</SelectItem>;
                  })}
                </SelectContent>
              </Select>
              {!can("payments", "add") && <p className="text-[11px] text-muted-foreground mt-1">{needsAccess("payments", "add")}</p>}
            </div>

            {/* 4. Their name */}
            {who && who !== "expense" && who !== "other" && (
              <div>
                <Label className="text-xs">{WHO[who].name}</Label>
                <Select value={partyId} onValueChange={(() => {
                  const pick = (v: string) => { setPartyId(v); if (who !== "client") setAgainst(who === "broker" ? "__oldest" : who === "supplier" || who === "factory" ? "__fifo" : ""); };
                  return newKind ? addNew(newKind, pick) : pick;
                })()} disabled={!ready}>
                  <SelectTrigger className={field} aria-label={WHO[who].name}>
                    <SelectValue placeholder={!ready ? "Loading…" : parties.length ? `Choose ${WHO[who].name.toLowerCase()}` : who === "client" && dir === "out" ? "No client holds credit" : "None yet"} />
                  </SelectTrigger>
                  <SelectContent>{parties.map(x => <SelectItem key={x.id} value={x.id}>{x.label}</SelectItem>)}{newKind && <AddNewItem kind={newKind} />}</SelectContent>
                </Select>
                {standing && <p className="text-[11px] text-muted-foreground mt-1">{standing}</p>}
              </div>
            )}
          </>
        )}

        {/* 5. Amount and date */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label className="text-xs">Amount ({sym})</Label>
            <Input type="number" min={0} step="0.01" inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)} className={field} placeholder="0" aria-label="Amount" />
          </div>
          <div>
            <Label className="text-xs">Date</Label>
            <Input type="date" value={date} onChange={e => setDate(e.target.value)} className={field} aria-label="Date" />
          </div>
        </div>
        {who === "client" && dir === "out" && partyId && refundable(db, partyId) > 0.005 && (cur === "USD" || Number(rate) > 0) && (
          <button type="button" className="-mt-2 text-xs font-medium text-primary hover:underline"
            onClick={() => setAmount(String(cur === "USD" ? refundable(db, partyId) : roundCcy(refundable(db, partyId) * Number(rate), cur)))}>
            Refund all of it ({fmtMoney(refundable(db, partyId))})
          </button>
        )}

        {/* Rates: a client's dollars, or a transfer into another currency */}
        {needsUsdRate && (
          <div className="p-3 rounded-xl bg-secondary">
            <RateInput id="entry-usd-rate" from="USD" to={cur} value={rate} onChange={setRate} at={date} />
            <p className="text-[11px] text-muted-foreground mt-1">{usd > 0 ? `${fmtCcy(amt, cur)} = ${fmtMoney(usd)}` : "Clients are billed in USD."}</p>
          </div>
        )}
        {crossTransfer && target && (
          <div className="p-3 rounded-xl bg-secondary">
            <RateInput id="entry-xfer-rate" from={cur} to={ccy(target.currency)} value={rate} onChange={setRate} amount={amt || undefined} at={date} />
          </div>
        )}

        {/* 6. What it is against, or its category */}
        {who === "supplier" && dir === "out" && partyId && (
          <div>
            <Label className="text-xs">Against</Label>
            <Select value={against || "__fifo"} onValueChange={setAgainst}>
              <SelectTrigger className={field} aria-label="Against"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__fifo">Oldest bills first</SelectItem>
                <SelectItem value="__advance">Advance — not against a bill</SelectItem>
                {db.purchases.filter(p => p.supplierId === partyId && purchasePending(p) > 0).map(p => (
                  <SelectItem key={p.id} value={p.id}>Bill {p.invoiceNumber || p.id.slice(-6)} — pending {fmtMoneyInr(purchasePending(p))}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
        {who === "factory" && partyId && (
          <div>
            <Label className="text-xs">Against</Label>
            <Select value={against || "__fifo"} onValueChange={setAgainst}>
              <SelectTrigger className={field} aria-label="Against"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__fifo">Oldest jobs first</SelectItem>
                <SelectItem value="__advance">Advance — not against a job</SelectItem>
                {db.materialIssuances.filter(i => i.factoryId === partyId && issuancePending(i) > 0).map(mi => (
                  <SelectItem key={mi.id} value={mi.id}>{mi.quantityIssued}{materialUnit(db.settings, mi.material)} {mi.purityOrQuality} — pending {fmtMoneyInr(issuancePending(mi))}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
        {who === "broker" && dir === "out" && partyId && (
          <div>
            <Label className="text-xs">Against</Label>
            <Select value={against || "__oldest"} onValueChange={setAgainst}>
              <SelectTrigger className={field} aria-label="Against"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__oldest">His suppliers' oldest bills (after his brokerage)</SelectItem>
                <SelectItem value="__hold">Just give it to him — he holds it</SelectItem>
              </SelectContent>
            </Select>
            {against !== "__hold" && amt > 0 && (
              <p className="text-[11px] text-muted-foreground mt-1">
                {brokerSettles > 0 ? `Settles ${Object.keys(brokerAlloc).length} bill${Object.keys(brokerAlloc).length === 1 ? "" : "s"} for ${fmtMoneyInr(brokerSettles)}` : "No bills to settle"}
                {brokerage > 0.5 ? ` · his brokerage ${fmtMoneyInr(Math.min(brokerage, amt + (brAcc?.held ?? 0)))}` : ""}. To pick bills one by one, use Payments → Pay through broker.
              </p>
            )}
          </div>
        )}
        {who === "client" && dir === "in" && partyId && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Against</Label>
              <Select value={against || "__credit"} onValueChange={v => setAgainst(v === "__credit" ? "" : v)}>
                <SelectTrigger className={field} aria-label="Against"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__credit">No invoice — hold as credit</SelectItem>
                  {invoices.map(({ inv, bal: b }) => <SelectItem key={inv.id} value={inv.id}>Invoice {inv.number} — {b > 0.005 ? `${fmtMoney(b)} pending` : "settled"}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Method</Label>
              <ListCombo list="paymentMethods" value={method} onChange={setMethod} optional={false} className={field} ariaLabel="Method" />
            </div>
          </div>
        )}
        {(who === "employee" || who === "expense" || who === "other") && (
          <div className={who === "other" ? "" : "grid grid-cols-1 sm:grid-cols-2 gap-3"}>
            <div>
              <Label className="text-xs">Category</Label>
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger className={field} aria-label="Category"><SelectValue placeholder="Choose a category" /></SelectTrigger>
                <SelectContent>{(who === "other" ? lockerCats : who === "expense" ? expenseCats.filter(c => c !== "Salary") : expenseCats).map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            {who !== "other" && (
              <div>
                <Label className="text-xs">{who === "expense" ? "What for" : "What for (optional)"}</Label>
                <Input value={title} onChange={e => setTitle(e.target.value)} className={field} aria-label="What for"
                  placeholder={who === "expense" ? "e.g. Office rent, courier" : "e.g. October salary"} />
              </div>
            )}
          </div>
        )}
        {who === "other" && dir === "out" && (
          <p className="-mt-2 text-[11px] text-amber-700">This account only — not in Expenses or Profit &amp; Loss. A business cost goes under Expense.</p>
        )}

        {/* 7. Note */}
        <div>
          <Label className="text-xs">Note</Label>
          <Input value={note} onChange={e => setNote(e.target.value)} className={field} placeholder="Optional — bank ref, cheque no." aria-label="Note" />
        </div>
      </div>
    </ActionSheet>
  );
}
