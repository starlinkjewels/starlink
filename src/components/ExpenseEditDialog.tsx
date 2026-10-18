import { useState } from "react";
import { Receipt, X } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth";
import { useDb } from "@/hooks/useDb";
import { useCan } from "@/hooks/useCan";
import { useLoaded } from "@/hooks/useLoaded";
import { DEFAULT_EXPENSE_CATEGORIES, dayOf, ensureCollections, fmtExpenseAmount, loadDb, type Expense } from "@/lib/db";
import { ccy, ccySymbol } from "@/lib/currency";
import { deleteExpense, editExpense, expenseImpact, expenseMoneyLock, moveToDay } from "@/lib/moneyEntries";
import { expenseBlock } from "@/lib/expenseRights";
import { confirmBox } from "@/lib/confirm";
import { ActionSheet } from "@/components/ActionSheet";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

/** Whether the signed-in person may edit / delete an expense — and why not.
 *  The one rule (src/lib/expenseRights.ts) for every list of expenses. */
export function useExpenseRights(): (e: Pick<Expense, "employeeId">, action: "edit" | "delete") => string | undefined {
  const { user } = useAuth();
  const can = useCan();
  const db = useDb();
  return (e, action) => expenseBlock(db, user, can, e, action);
}

/** Ask, with what it changes, then delete the expense and its account entry. */
export async function confirmDeleteExpense(e: Expense): Promise<boolean> {
  // Its account entry is part of what the question says — have it first
  // (a page like an employee's loads no account entries of its own).
  await ensureCollections(["lockerTransactions"]);
  const live = loadDb();
  const x = live.expenses.find(y => y.id === e.id) ?? e;
  if (!(await confirmBox(`Delete this expense?\n\n${x.title} · ${fmtExpenseAmount(x.amount, x.currency)}\n${expenseImpact(live, x).join("\n")}\n\nThis cannot be undone.`))) return false;
  await deleteExpense(e.id);
  toast.success("Expense deleted");
  return true;
}

/**
 * Correcting an expense: everything the Add Expense form asks, the orders and
 * shipment it is a cost of, and the account it was paid from — in a side
 * panel, saved together with its entry in that account (src/lib/moneyEntries.ts
 * editExpense), so the expense and the account's balance never disagree.
 */
export function ExpenseEditDialog({ expenseId, onClose }: { expenseId: string | null; onClose: () => void }) {
  const db = useDb();
  const e = expenseId ? db.expenses.find(x => x.id === expenseId) : undefined;
  if (!e) return null;
  return <ExpenseSheet key={e.id} e={e} onClose={onClose} />;
}

function ExpenseSheet({ e, onClose }: { e: Expense; onClose: () => void }) {
  const db = useDb();
  // Its account entry moves with it — wait for the account entries before saving.
  const ready = useLoaded(["lockerTransactions"]);
  const [f, setF] = useState({
    title: e.title, category: e.category, amount: String(e.amount), date: dayOf(e.createdAt), note: e.note ?? "",
    paidTo: e.paidToEmployeeId ?? "", clientId: e.clientId ?? "", orderIds: e.orderIds ?? [], shipmentRef: e.shipmentRef ?? "",
    lockerId: e.lockerId ?? "",
  });
  const [saving, setSaving] = useState(false);

  const configured = db.settings.expenseCategories?.length ? db.settings.expenseCategories : DEFAULT_EXPENSE_CATEGORIES;
  // Salary is always pickable, and so is whatever the expense already says.
  const categories = [...new Set(["Salary", ...configured, e.category])];
  const staff = db.users.filter(u => u.role === "admin" || u.role === "employee");
  const clients = [...db.clients].sort((a, b) => a.companyName.localeCompare(b.companyName));
  const own = ccy(e.currency);
  const sym = ccySymbol(own).trim();
  // Only accounts in the expense's own currency — the amount would otherwise be
  // read as another currency's money. Its current one is always listed.
  const accounts = db.lockers.filter(l => (l.active !== false || l.id === e.lockerId) && ccy(l.currency) === own);
  const otherCcy = db.lockers.some(l => l.active !== false && ccy(l.currency) !== own);
  // Orders it could be a cost of: the client's, when one is chosen; newest first.
  const orderChoices = [...db.orders]
    .filter(o => !f.orderIds.includes(o.id) && (!f.clientId || o.clientId === f.clientId))
    .sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt))
    .slice(0, 200);

  const save = () => {
    setSaving(true);
    try {
      const refused = editExpense(e.id, {
        title: f.title, category: f.category, amount: Number(f.amount),
        date: moveToDay(e.createdAt, f.date), note: f.note,
        paidToEmployeeId: f.paidTo || undefined, clientId: f.clientId || undefined,
        orderIds: f.orderIds, shipmentRef: f.shipmentRef, lockerId: f.lockerId || undefined,
      });
      // Nothing was written — say why and leave the panel open to fix it.
      if (refused) { toast.error(refused); return; }
      toast.success("Expense updated");
      onClose();
    } finally { setSaving(false); }
  };

  const acct = db.lockers.find(l => l.id === f.lockerId);
  // Paid from an account whose entry for it isn't found (older data): the
  // amount, date and account would change on the expense alone, so they are
  // fixed here and the account side is corrected in Account entries. Known
  // only once the account entries are in; saving waits for them anyway.
  const moneyLock = ready ? expenseMoneyLock(db, e) : undefined;
  return (
    <ActionSheet open onOpenChange={o => { if (!o) onClose(); }} size="md" icon={Receipt}
      title="Edit expense"
      description={!e.lockerId ? "Not paid from an account"
        : moneyLock ? `${moneyLock} Other fields can still change.`
        : ready ? "Its account entry moves with it"
        : "Checking its account entry…"}
      footer={
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Expense</p>
            <p className="font-display text-2xl font-bold text-destructive tabular-nums leading-tight truncate">
              {fmtExpenseAmount(Number(f.amount) || 0, own)}
            </p>
            <p className="text-[11px] text-muted-foreground truncate">{acct ? `from ${acct.name}` : "Not paid from an account"}</p>
          </div>
          <div className="flex gap-2 sm:shrink-0">
            <Button variant="outline" onClick={onClose} className="flex-1 sm:flex-none rounded-xl h-10">Cancel</Button>
            <Button onClick={save} disabled={saving || !ready} className="btn-hero flex-1 sm:flex-none rounded-xl h-10 px-6">
              {!ready ? "Loading…" : saving ? "Saving…" : "Save"}
            </Button>
          </div>
        </div>
      }>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-3 gap-y-4">
        <div className="sm:col-span-2">
          <Label className="text-xs">Paid from account</Label>
          {e.lockerId ? (
            <>
              <Select value={f.lockerId} onValueChange={v => setF({ ...f, lockerId: v })} disabled={!!moneyLock}>
                <SelectTrigger className="h-10 rounded-xl mt-1 disabled:opacity-60"><SelectValue placeholder="Choose account" /></SelectTrigger>
                <SelectContent>{accounts.map(l => <SelectItem key={l.id} value={l.id}>{l.name} ({ccy(l.currency)})</SelectItem>)}</SelectContent>
              </Select>
              {otherCcy && (
                <p className="text-[11px] text-muted-foreground mt-1">
                  Only {own} accounts — this expense is in {own}. Money that changed currency is a transfer.
                </p>
              )}
            </>
          ) : (
            <p className="text-sm text-muted-foreground mt-1 rounded-xl bg-secondary/60 px-3 py-2">
              Not paid from an account. If it was, delete it and record it again from that account — adding one
              here could count the same money twice.
            </p>
          )}
        </div>

        <div>
          <Label className="text-xs">Amount ({own})</Label>
          <div className="relative mt-1">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">{sym}</span>
            <Input type="number" min={0} step="0.01" value={f.amount} onChange={x => setF({ ...f, amount: x.target.value })}
              disabled={!!moneyLock} className="h-10 rounded-xl disabled:opacity-60" style={{ paddingLeft: `${Math.max(1.75, sym.length * 0.55 + 1.1)}rem` }} />
          </div>
        </div>
        <div>
          <Label className="text-xs">Date</Label>
          <Input type="date" value={f.date} onChange={x => setF({ ...f, date: x.target.value })} disabled={!!moneyLock}
            className="rounded-xl h-10 mt-1 disabled:opacity-60" />
        </div>

        <div>
          <Label className="text-xs">Category</Label>
          <Select value={f.category} onValueChange={v => setF({ ...f, category: v })}>
            <SelectTrigger className="h-10 rounded-xl mt-1"><SelectValue /></SelectTrigger>
            <SelectContent>{categories.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div>
          {/* Kept for any category: wages and advances paid to someone sit on
              their salary ledger too. Required for Salary. */}
          <Label className="text-xs">Paid to team member{f.category === "Salary" ? " *" : ""}</Label>
          <Select value={f.paidTo || "__none"} onValueChange={v => setF({ ...f, paidTo: v === "__none" ? "" : v })}>
            <SelectTrigger className="h-10 rounded-xl mt-1"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__none">Nobody</SelectItem>
              {staff.map(u => <SelectItem key={u.id} value={u.id}>{u.name} ({u.role})</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        <div className="sm:col-span-2">
          <Label className="text-xs">Title *</Label>
          <Input value={f.title} onChange={x => setF({ ...f, title: x.target.value })} className="rounded-xl h-10 mt-1" placeholder="e.g. August salary, Office rent" />
        </div>

        <div className="sm:col-span-2">
          <Label className="text-xs">Related client</Label>
          <Select value={f.clientId || "__none"} onValueChange={v => setF({ ...f, clientId: v === "__none" ? "" : v })}>
            <SelectTrigger className="h-10 rounded-xl mt-1"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__none">No client</SelectItem>
              {clients.map(c => <SelectItem key={c.id} value={c.id}>{c.companyName}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        <div className="sm:col-span-2">
          <Label className="text-xs">Note</Label>
          <textarea value={f.note} onChange={x => setF({ ...f, note: x.target.value })} rows={2}
            className="w-full mt-1 px-3 py-2 rounded-xl border border-input bg-background text-sm outline-none focus:ring-2 focus:ring-ring resize-none" />
        </div>

        {/* A direct cost of particular orders (freight, insurance, a lab fee)
            rather than an overhead — split across them by value. */}
        <div className="sm:col-span-2 rounded-xl border border-border/70 p-3 space-y-2.5">
          <div>
            <p className="text-xs font-medium">For orders <span className="font-normal text-muted-foreground">— optional</span></p>
            <p className="text-[11px] text-muted-foreground">Set, it counts in those orders&rsquo; cost instead of the running costs.</p>
          </div>
          {f.orderIds.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {f.orderIds.map(id => (
                <span key={id} className="inline-flex items-center gap-1 h-7 pl-2.5 pr-1 rounded-lg bg-secondary text-xs font-mono">
                  {db.orders.find(o => o.id === id)?.orderNumber ?? "Order"}
                  <button type="button" aria-label="Remove this order" onClick={() => setF({ ...f, orderIds: f.orderIds.filter(x => x !== id) })}
                    className="h-5 w-5 grid place-items-center rounded hover:bg-background"><X className="h-3 w-3" /></button>
                </span>
              ))}
            </div>
          )}
          <Select value="" onValueChange={v => setF({ ...f, orderIds: [...f.orderIds, v] })}>
            <SelectTrigger className="h-9 rounded-xl"><SelectValue placeholder={orderChoices.length ? "Add an order…" : "No more orders to add"} /></SelectTrigger>
            <SelectContent>{orderChoices.map(o => <SelectItem key={o.id} value={o.id}>{o.orderNumber}{o.jewelleryType ? ` · ${o.jewelleryType}` : ""}</SelectItem>)}</SelectContent>
          </Select>
          <div>
            <Label className="text-xs">Shipment (courier and tracking no.)</Label>
            <Input value={f.shipmentRef} onChange={x => setF({ ...f, shipmentRef: x.target.value })} className="rounded-xl h-9 mt-1" placeholder="e.g. FedEx 7723 1180 2231" />
          </div>
        </div>
      </div>
    </ActionSheet>
  );
}
