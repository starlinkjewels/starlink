// An employee's advance (upad) — giving one, taking a repayment, writing what is
// left off — each in a side panel. Giving and repaying open the same panel to
// correct an entry (every field the Add has, on Edit too). The books behind
// them: lib/employeeAdvances.ts.
import { useState } from "react";
import { toast } from "sonner";
import { HandCoins, Undo2, Eraser } from "lucide-react";
import { updateDbAs, todayLocal, stampFor, dayOf, loadDb } from "@/lib/db";
import { useDb } from "@/hooks/useDb";
import { useAuth } from "@/lib/auth";
import { useCan } from "@/hooks/useCan";
import { auth, isAdminEmail, ADMIN_EMAILS } from "@/lib/firebase";
import { ccy, fmtCcy, type CurrencyCode } from "@/lib/currency";
import { fmtLockerAmount, lockerBalance } from "@/lib/manufacturing";
import { confirmBox } from "@/lib/confirm";
import { closedWhy } from "@/lib/yearLock";
import { moveToDay } from "@/lib/moneyEntries";
import { advanceOwed, advanceChangeProblem, recoveryProblem, writeAdvance, writeRepayment, writeAdvanceWriteOff } from "@/lib/employeeAdvances";
import { ActionSheet } from "@/components/ActionSheet";
import { AsyncButton } from "@/components/AsyncButton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { openMin } from "@/lib/openMin";

const owedText = (m: Map<CurrencyCode, number>) => (m.size ? [...m].map(([c, v]) => fmtCcy(v, c)).join(" · ") : "nothing");

/**
 * Give an advance ("give"), or take money they hand back ("repay"). With
 * `editId`, the same panel corrects that entry: its account, amount, date and note.
 */
export function AdvanceSheet({ employeeId: fixedEmployee, mode, editId, onClose }: { employeeId?: string; mode: "give" | "repay"; editId?: string; onClose: () => void }) {
  const db = useDb();
  const { user } = useAuth();
  const can = useCan();
  // From the Payments page the person is chosen here; from their page it is them.
  const [employeeId, setEmployeeId] = useState(fixedEmployee ?? "");
  const staff = db.users.filter(u => (u.role === "employee" || u.role === "admin") && (u.status === "active" || u.id === employeeId)).sort((a, b) => a.name.localeCompare(b.name));
  const who = db.users.find(u => u.id === employeeId);
  const editing = editId ? (db.lockerTransactions ?? []).find(t => t.id === editId) : undefined;
  const [lockerId, setLockerId] = useState(editing?.lockerId ?? "");
  const [amount, setAmount] = useState(editing ? String(editing.amountInr) : "");
  const [date, setDate] = useState(editing ? dayOf(editing.createdAt) : todayLocal());
  const [note, setNote] = useState(editing?.note ?? "");
  const [saving, setSaving] = useState(false);
  const lockers = db.lockers.filter(l => l.active !== false || l.id === editing?.lockerId);
  const locker = lockers.find(l => l.id === lockerId);
  const cur = ccy(locker?.currency);
  const amt = Number(amount) || 0;
  const allowed = user?.role === "admin" || can("payments", editing ? "edit" : "add");
  const owed = who ? advanceOwed(db, who) : new Map<CurrencyCode, number>();
  const give = mode === "give";

  const save = async () => {
    if (!allowed) { toast.error("You don't have access to record this"); return; }
    if (!who) { toast.error("Choose the team member"); return; }
    if (!locker) { toast.error(give ? "Choose the account it is paid from" : "Choose the account it came into"); return; }
    if (!(amt > 0)) { toast.error("Enter the amount"); return; }
    const at = editing ? moveToDay(editing.createdAt, date) : stampFor(date);
    const closed = closedWhy(at, db.settings) ?? (editing ? closedWhy(editing.createdAt, db.settings) : null);
    if (closed) { toast.error(closed); return; }
    const live = loadDb();
    const problem = editing
      ? advanceChangeProblem(live, editing.id, { amount: amt, lockerId })
      : give ? undefined : recoveryProblem(live, who.id, cur, amt);
    if (problem) { toast.error(problem); return; }
    if (give) {
      const bal = lockerBalance(locker, db.lockerTransactions) + (editing && editing.lockerId === locker.id ? editing.amountInr : 0);
      if (amt > bal && !(await confirmBox(`${fmtLockerAmount(amt, locker.currency)} is more than ${locker.name}'s balance of ${fmtLockerAmount(bal, locker.currency)}.\n\nThe balance will go negative — continue only if a deposit is still missing.`))) return;
    }
    setSaving(true);
    try {
      const what = `${fmtCcy(amt, cur)} ${give ? "advance to" : "repaid by"} ${who.name}`;
      if (editing) {
        updateDbAs({ summary: `Corrected: ${what}` }, d => {
          const t = (d.lockerTransactions ?? []).find(x => x.id === editing.id);
          if (!t) return;
          t.lockerId = locker.id; t.currency = ccy(locker.currency); t.amountInr = Math.round(amt * 100) / 100;
          t.createdAt = at; t.note = note.trim() || undefined;
        });
      } else {
        updateDbAs({ summary: give ? `Advance given: ${what}` : `Advance repaid: ${what}` }, d => {
          (give ? writeAdvance : writeRepayment)(d, { employeeId: who.id, lockerId: locker.id, amount: amt, at, note, userId: user!.id });
        });
      }
      toast.success(editing ? "Corrected" : give ? `Advance of ${fmtCcy(amt, cur)} given to ${who.name}` : `${fmtCcy(amt, cur)} repaid by ${who.name}`);
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't save — nothing was recorded");
    } finally { setSaving(false); }
  };

  return (
    <ActionSheet open onOpenChange={o => { if (!o) onClose(); }} size="md" icon={give ? HandCoins : Undo2}
      title={`${editing ? "Edit " : ""}${give ? "Advance (upad) to" : "Repayment by"} ${who?.name ?? "an employee"}`}
      description={who ? `Advance owed now: ${owedText(owed)}` : "Choose the team member"}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose} className="rounded-xl h-10">Cancel</Button>
          <AsyncButton onClick={save} disabled={saving || !allowed} className="btn-hero rounded-xl h-10 px-6">{saving ? "Saving…" : editing ? "Save" : give ? "Give advance" : "Record repayment"}</AsyncButton>
        </div>
      }>
      <div className="space-y-4">
        {!fixedEmployee && (
          <div>
            <Label className="text-xs">Employee</Label>
            <Select value={employeeId} onValueChange={setEmployeeId}>
              <SelectTrigger className="h-10 rounded-xl mt-1" aria-label="Employee"><SelectValue placeholder="Choose team member" /></SelectTrigger>
              <SelectContent>{staff.map(u => <SelectItem key={u.id} value={u.id}>{u.name}{(() => { const t = owedText(advanceOwed(db, u)); return t === "nothing" ? "" : ` — owes ${t}`; })()}</SelectItem>)}</SelectContent>
            </Select>
          </div>
        )}
        <div>
          <Label className="text-xs">{give ? "Paid from account" : "Came into account"}</Label>
          <Select value={lockerId} onValueChange={setLockerId}>
            <SelectTrigger className="h-10 rounded-xl mt-1" aria-label="Account"><SelectValue placeholder={lockers.length ? "Choose an account" : "No account"} /></SelectTrigger>
            <SelectContent>{lockers.map(l => <SelectItem key={l.id} value={l.id}>{l.name} · {fmtLockerAmount(lockerBalance(l, db.lockerTransactions), l.currency)}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label className="text-xs">Amount ({cur})</Label>
            <Input type="number" min={0} step="0.01" inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)} className="h-10 rounded-xl mt-1" aria-label="Amount" />
            {!give && !editing && (owed.get(cur) ?? 0) > 0 && amt !== owed.get(cur) && (
              <button type="button" onClick={() => setAmount(String(owed.get(cur)))} className="mt-1 text-[11px] text-primary hover:underline">All of it — {fmtCcy(owed.get(cur)!, cur)}</button>
            )}
          </div>
          <div>
            <Label className="text-xs">Date</Label>
            <Input type="date" min={openMin()} value={date} onChange={e => setDate(e.target.value)} className="h-10 rounded-xl mt-1" aria-label="Date" />
          </div>
        </div>
        <div>
          <Label className="text-xs">Note</Label>
          <Input value={note} onChange={e => setNote(e.target.value)} className="h-10 rounded-xl mt-1" placeholder={give ? "Optional — what it is for" : "Optional — cash, UPI ref"} aria-label="Note" />
        </div>
        <p className="text-[11px] text-muted-foreground">
          {give ? "An advance is not an expense — it stays theirs to give back: repaid in cash, cut from their salary, or written off."
            : "Comes off what they owe, and into the account."}
        </p>
      </div>
    </ActionSheet>
  );
}

/** Write what is left of their advance off — the main admin, with a reason. It becomes a cost. */
export function WriteOffSheet({ employeeId, onClose }: { employeeId: string; onClose: () => void }) {
  const db = useDb();
  const { user } = useAuth();
  const who = db.users.find(u => u.id === employeeId);
  const owed = who ? [...advanceOwed(db, who)].filter(([, v]) => v > 0.005) : [];
  const [currency, setCurrency] = useState<CurrencyCode>(owed[0]?.[0] ?? "INR");
  const left = owed.find(([c]) => c === currency)?.[1] ?? 0;
  const [amount, setAmount] = useState(left ? String(left) : "");
  const [date, setDate] = useState(todayLocal());
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const mainAdmin = isAdminEmail(auth.currentUser?.email) || isAdminEmail(user?.email);
  if (!who) return null;
  const amt = Number(amount) || 0;

  const save = async () => {
    if (!mainAdmin) { toast.error(`Only the main admin (${ADMIN_EMAILS[0]}) can write an advance off`); return; }
    if (reason.trim().length < 4) { toast.error("Say why it is being written off"); return; }
    const at = stampFor(date);
    const closed = closedWhy(at, db.settings);
    if (closed) { toast.error(closed); return; }
    const problem = recoveryProblem(loadDb(), who.id, currency, amt);
    if (problem) { toast.error(problem); return; }
    if (!(await confirmBox(`Write off ${fmtCcy(amt, currency)} of ${who.name}'s advance?\n\nIt becomes a cost in Expenses and Profit & Loss, and comes off what they owe.`))) return;
    setSaving(true);
    try {
      updateDbAs({ summary: `Advance written off: ${fmtCcy(amt, currency)} — ${who.name} — ${reason.trim()}` }, d =>
        writeAdvanceWriteOff(d, { employeeId: who.id, currency, amount: amt, at, reason, userId: user!.id }));
      toast.success(`${fmtCcy(amt, currency)} written off`);
      onClose();
    } finally { setSaving(false); }
  };

  return (
    <ActionSheet open onOpenChange={o => { if (!o) onClose(); }} size="md" icon={Eraser} title={`Write off ${who.name}'s advance`}
      description={owed.length ? `Owed now: ${owed.map(([c, v]) => fmtCcy(v, c)).join(" · ")}` : "Nothing owed"}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose} className="rounded-xl h-10">Cancel</Button>
          <AsyncButton onClick={save} disabled={saving || !mainAdmin || !owed.length} className="btn-hero rounded-xl h-10 px-6">{saving ? "Saving…" : "Write off"}</AsyncButton>
        </div>
      }>
      <div className="space-y-4">
        {!mainAdmin && <p className="text-sm text-muted-foreground">Only the main admin ({ADMIN_EMAILS[0]}) can write an advance off.</p>}
        {owed.length > 1 && (
          <div>
            <Label className="text-xs">Currency</Label>
            <Select value={currency} onValueChange={v => { setCurrency(v as CurrencyCode); const x = owed.find(([c]) => c === v); setAmount(x ? String(x[1]) : ""); }}>
              <SelectTrigger className="h-10 rounded-xl mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>{owed.map(([c, v]) => <SelectItem key={c} value={c}>{c} — {fmtCcy(v, c)} owed</SelectItem>)}</SelectContent>
            </Select>
          </div>
        )}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label className="text-xs">Amount ({currency})</Label>
            <Input type="number" min={0} step="0.01" inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)} className="h-10 rounded-xl mt-1" aria-label="Amount" />
          </div>
          <div>
            <Label className="text-xs">Date</Label>
            <Input type="date" min={openMin()} value={date} onChange={e => setDate(e.target.value)} className="h-10 rounded-xl mt-1" aria-label="Date" />
          </div>
        </div>
        <div>
          <Label htmlFor="wo-reason" className="text-xs">Why it won't come back</Label>
          <Textarea id="wo-reason" value={reason} onChange={e => setReason(e.target.value)} rows={2} className="rounded-xl mt-1" placeholder="e.g. Left in October, could not repay" />
        </div>
        <p className="text-[11px] text-muted-foreground">No money moves. It becomes a cost (in Expenses and Profit &amp; Loss) and their advance is cleared by this much. Deleting it later puts it back on what they owe.</p>
      </div>
    </ActionSheet>
  );
}
