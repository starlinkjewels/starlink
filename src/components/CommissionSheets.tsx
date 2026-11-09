// Sales commission — the side panels: the rules (the company's % for its
// salespeople, each person's own), one order changed, and paying it. ADMIN ONLY:
// the rules and every figure behind them sit in the admin store.
// The books: lib/commission.ts (rules, arithmetic) and lib/commissionLedger.ts.
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Percent, Wallet, X, Plus } from "lucide-react";
import { updateDbAs, todayLocal, stampFor, fmtDate, loadDb, costDataReady, ensureCollections, type Order, type User } from "@/lib/db";
import { COST } from "@/lib/pageData";
import { useDb } from "@/hooks/useDb";
import { useAuth } from "@/lib/auth";
import { fmtCcy } from "@/lib/currency";
import { fmtMoneyInr, fmtLockerAmount, lockerBalance } from "@/lib/manufacturing";
import { useRupeePay } from "@/components/RupeePay";
import { confirmBox } from "@/lib/confirm";
import { closedTo, closedWhy } from "@/lib/yearLock";
import { recognisedSale, saleDate } from "@/lib/orderCost";
import {
  commissionPlan, orderCommissionSet, payeeOf, personRate, planProblem, writePlan, writeOrderCommission, onCompanyRate, stepOn,
  type CommissionPlan, type CommissionStep, type OrderCommissionSet,
} from "@/lib/commission";
import { commissionAccount, commissionPayProblem, writeCommissionPayment } from "@/lib/commissionLedger";
import { ActionSheet } from "@/components/ActionSheet";
import { AsyncButton } from "@/components/AsyncButton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { openMin } from "@/lib/openMin";

const pctOf = (v: string): number | null => {
  const n = Number(v);
  return v.trim() === "" || !Number.isFinite(n) ? null : Math.round(n * 100) / 100;
};

/** Until every cost behind the margins has arrived, a commission worked out now would be wrong. */
export function useCommissionData(enabled = true): boolean {
  const db = useDb();
  useEffect(() => { if (enabled) void ensureCollections(COST); }, [enabled]);
  void db; // re-render as the records arrive
  return costDataReady();
}

/** The people who can earn commission: the team (admins and employees), active or with a % of their own. */
export function commissionPeople(db: { users: User[] }, plan: CommissionPlan): User[] {
  return db.users
    .filter(u => (u.role === "employee" || u.role === "admin") && (u.status === "active" || plan.staff[u.id]?.length))
    .sort((a, b) => Number(onCompanyRate(db, b)) - Number(onCompanyRate(db, a)) || a.name.localeCompare(b.name));
}

/* ── The rules ──────────────────────────────────────────────────────────── */

/**
 * The company's % of margin for its salespeople, and anyone's own % (or none) —
 * each from a day, so nothing already sold changes. A % from a closed year stays.
 */
export function CommissionRulesSheet({ focusUserId, onClose }: { focusUserId?: string; onClose: () => void }) {
  const db = useDb();
  const { user } = useAuth();
  const saved = useMemo(() => commissionPlan(db), [db]);
  const [plan, setPlan] = useState<CommissionPlan>(() => JSON.parse(JSON.stringify(saved)));
  const [coPct, setCoPct] = useState("");
  const [coFrom, setCoFrom] = useState(todayLocal());
  const [editing, setEditing] = useState<string | null>(focusUserId ?? null);
  // Opened from someone's page, their row starts on what they have now.
  const focusNow = focusUserId ? stepOn(saved.staff[focusUserId], todayLocal()) : undefined;
  const focusUser = focusUserId ? db.users.find(u => u.id === focusUserId) : undefined;
  const [mode, setMode] = useState<"company" | "own" | "none">(() => focusNow
    ? (focusNow.pct === null ? "company" : focusNow.pct > 0 ? "own" : "none")
    : focusUser && onCompanyRate(db, focusUser) ? "company" : "own");
  const [ownPct, setOwnPct] = useState(focusNow?.pct ? String(focusNow.pct) : "");
  const [ownFrom, setOwnFrom] = useState(todayLocal());
  const [saving, setSaving] = useState(false);
  const lockTo = closedTo(db.settings);
  const isOpen = (s: CommissionStep) => !lockTo || s.from > lockTo;
  const admin = user?.role === "admin";
  const people = commissionPeople(db, plan);
  const today = todayLocal();
  const dirty = JSON.stringify(plan) !== JSON.stringify(saved);

  const addStep = (steps: CommissionStep[], s: CommissionStep): CommissionStep[] =>
    [...steps.filter(x => x.from !== s.from), s].sort((a, b) => a.from.localeCompare(b.from));

  const addCompany = () => {
    const pct = pctOf(coPct);
    if (pct === null || pct < 0 || pct > 100) { toast.error("Enter the % of margin — 0 to 100"); return; }
    if (!coFrom) { toast.error("Choose the day it starts"); return; }
    if (lockTo && coFrom <= lockTo) { toast.error(`That day is in a closed year (closed up to ${lockTo}) — choose a later day`); return; }
    setPlan(p => ({ ...p, company: addStep(p.company, { from: coFrom, pct }) }));
    setCoPct("");
  };
  const openPerson = (u: User) => {
    const now = stepOn(plan.staff[u.id], today);
    setMode(now ? (now.pct === null ? "company" : now.pct > 0 ? "own" : "none") : onCompanyRate(db, u) ? "company" : "own");
    setOwnPct(now?.pct ? String(now.pct) : "");
    setOwnFrom(todayLocal());
    setEditing(u.id);
  };
  const addPerson = (u: User) => {
    const pct = mode === "company" ? null : mode === "none" ? 0 : pctOf(ownPct);
    if (mode === "own" && (pct === null || pct <= 0 || pct > 100)) { toast.error("Enter their % of margin — above 0, up to 100"); return; }
    if (!ownFrom) { toast.error("Choose the day it starts"); return; }
    if (lockTo && ownFrom <= lockTo) { toast.error(`That day is in a closed year (closed up to ${lockTo}) — choose a later day`); return; }
    setPlan(p => ({ ...p, staff: { ...p.staff, [u.id]: addStep(p.staff[u.id] ?? [], { from: ownFrom, pct }) } }));
    setEditing(null);
  };
  const dropStep = (who: "company" | string, from: string) => setPlan(p => who === "company"
    ? { ...p, company: p.company.filter(s => s.from !== from) }
    : { ...p, staff: { ...p.staff, [who]: (p.staff[who] ?? []).filter(s => s.from !== from) } });

  const save = async () => {
    if (!admin) { toast.error("Only an admin can set commission"); return; }
    const live = commissionPlan(loadDb());
    const problem = planProblem(live, plan, closedTo(loadDb().settings));
    if (problem) { toast.error(problem); return; }
    setSaving(true);
    try {
      updateDbAs({ summary: "Sales commission rules changed" }, d => writePlan(d, plan, user!.name));
      toast.success("Commission rules saved");
      onClose();
    } finally { setSaving(false); }
  };
  const close = async () => {
    if (dirty && !(await confirmBox("Leave without saving the commission changes?"))) return;
    onClose();
  };

  const stepText = (s: CommissionStep, own: boolean) => s.pct === null ? "company %" : s.pct > 0 ? `${s.pct}%` : own ? "no commission" : "none";
  const history = (who: "company" | string, steps: CommissionStep[] | undefined) => (steps ?? []).length > 0 && (
    <div className="flex flex-wrap gap-1.5 mt-1.5">
      {(steps ?? []).map(s => (
        <span key={s.from} className="inline-flex items-center gap-1 rounded-lg bg-secondary px-2 py-0.5 text-[11px]">
          from {fmtDate(s.from)}: <span className="font-semibold">{stepText(s, who !== "company")}</span>
          {isOpen(s)
            ? <button type="button" onClick={() => dropStep(who, s.from)} aria-label={`Remove the change from ${fmtDate(s.from)}`} className="ml-0.5 text-muted-foreground hover:text-destructive"><X className="h-3 w-3" /></button>
            : <span className="text-muted-foreground" title="In a closed year">· closed</span>}
        </span>
      ))}
    </div>
  );
  const coNow = stepOn(plan.company, today);

  return (
    <ActionSheet open onOpenChange={o => { if (!o) void close(); }} size="lg" icon={Percent}
      title="Sales commission"
      description="A share of each sale's margin — selling price less its whole cost — paid to whoever took the order (else the client's handler). Never on a loss. Each % runs from a day, so what was already sold keeps its %."
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => void close()} className="rounded-xl h-10">Cancel</Button>
          <AsyncButton onClick={save} disabled={saving || !admin || !dirty} className="btn-hero rounded-xl h-10 px-6">{saving ? "Saving…" : "Save"}</AsyncButton>
        </div>
      }>
      <div className="space-y-5">
        <section className="rounded-2xl border border-border/70 p-4">
          <p className="font-semibold text-brand-dark text-sm">Company % — every salesperson</p>
          <p className="text-[11px] text-muted-foreground mt-0.5">For employees in a Sales department (or every employee, while nobody is marked Sales). Anyone can be given their own % below.</p>
          <p className="text-sm mt-2">Now: <span className="font-semibold">{coNow && coNow.pct ? `${coNow.pct}% of margin` : "no company commission"}</span></p>
          {history("company", plan.company)}
          <div className="grid grid-cols-[1fr_1fr_auto] gap-2 mt-3 items-end">
            <div>
              <Label className="text-xs">% of margin</Label>
              <Input type="number" min={0} max={100} step="0.1" inputMode="decimal" value={coPct} onChange={e => setCoPct(e.target.value)} className="h-10 rounded-xl mt-1" aria-label="Company % of margin" placeholder="e.g. 10" />
            </div>
            <div>
              <Label className="text-xs">From</Label>
              <Input type="date" min={openMin()} value={coFrom} onChange={e => setCoFrom(e.target.value)} className="h-10 rounded-xl mt-1" aria-label="Company % from" />
            </div>
            <Button type="button" variant="outline" onClick={addCompany} className="rounded-xl h-10 gap-1"><Plus className="h-4 w-4" />Set</Button>
          </div>
          <p className="text-[11px] text-muted-foreground mt-1.5">0% stops the company commission from that day.</p>
        </section>

        <section className="space-y-2">
          <p className="font-semibold text-brand-dark text-sm">Each person</p>
          {people.map(u => {
            const r = personRate({ users: db.users, adminRecords: [{ id: "commission", kind: "commission", plan } as never] }, u.id, today);
            const sales = onCompanyRate(db, u);
            return (
              <div key={u.id} className={`rounded-2xl border p-3 ${editing === u.id ? "border-primary/50 bg-primary/5" : "border-border/70"}`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{u.name}</p>
                    <p className="text-[11px] text-muted-foreground">{u.role === "admin" ? "Admin" : u.department || "Employee"}{sales ? " · salesperson" : ""}{u.status !== "active" ? " · inactive" : ""}</p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className={`text-sm font-semibold ${r ? "text-success" : "text-muted-foreground"}`}>{r ? `${r.pct}%${r.source === "company" ? " · company" : " · own"}` : "None"}</p>
                    {editing !== u.id && <button type="button" onClick={() => openPerson(u)} className="text-xs text-primary hover:underline font-medium">Change</button>}
                  </div>
                </div>
                {history(u.id, plan.staff[u.id])}
                {editing === u.id && (
                  <div className="grid grid-cols-1 sm:grid-cols-[1.3fr_1fr_1fr_auto] gap-2 mt-3 items-end">
                    <div>
                      <Label className="text-xs">Commission</Label>
                      <Select value={mode} onValueChange={v => setMode(v as typeof mode)}>
                        <SelectTrigger className="h-10 rounded-xl mt-1" aria-label="Their commission"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="company">{sales ? "The company %" : "The company % (salespeople only — none)"}</SelectItem>
                          <SelectItem value="own">Their own %</SelectItem>
                          <SelectItem value="none">No commission</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label className="text-xs">% of margin</Label>
                      <Input type="number" min={0} max={100} step="0.1" inputMode="decimal" disabled={mode !== "own"} value={mode === "own" ? ownPct : ""} onChange={e => setOwnPct(e.target.value)} className="h-10 rounded-xl mt-1" aria-label="Their % of margin" />
                    </div>
                    <div>
                      <Label className="text-xs">From</Label>
                      <Input type="date" min={openMin()} value={ownFrom} onChange={e => setOwnFrom(e.target.value)} className="h-10 rounded-xl mt-1" aria-label="Their % from" />
                    </div>
                    <div className="flex gap-1">
                      <Button type="button" onClick={() => addPerson(u)} className="rounded-xl h-10">Set</Button>
                      <Button type="button" variant="ghost" onClick={() => setEditing(null)} className="rounded-xl h-10 px-2" aria-label="Close">✕</Button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </section>
        {lockTo && <p className="text-[11px] text-muted-foreground">A % from a closed year (up to {fmtDate(lockTo)}) stays as it was — the sales it paid are in that year's books.</p>}
      </div>
    </ActionSheet>
  );
}

/* ── One order ──────────────────────────────────────────────────────────── */

/** Someone else earns this order's commission, another %, or none — or back to the rules. */
export function OrderCommissionSheet({ order, onClose }: { order: Order; onClose: () => void }) {
  const db = useDb();
  const { user } = useAuth();
  const set = orderCommissionSet(db, order.id);
  const usual = payeeOf(db, { ...order, id: "__usual__" });
  const usualName = usual.userId ? db.users.find(u => u.id === usual.userId)?.name : undefined;
  const [payee, setPayee] = useState<string>(set?.payeeId === null ? "__none" : set?.payeeId ?? "__usual");
  const [pct, setPct] = useState(set?.pct != null ? String(set.pct) : "");
  const [note, setNote] = useState(set?.note ?? "");
  const [saving, setSaving] = useState(false);
  const plan = commissionPlan(db);
  const people = commissionPeople(db, plan);
  const who = payee === "__none" ? undefined : payee === "__usual" ? usual.userId : payee;
  const rate = who ? personRate(db, who, saleDate(order)) : null;
  const closed = recognisedSale(order) ? closedWhy(saleDate(order), db.settings) : null;

  const save = async (reset = false) => {
    if (user?.role !== "admin") { toast.error("Only an admin can change commission"); return; }
    if (closed) { toast.error(`${order.orderNumber} was sold in a closed year — its commission stays as it was. ${closed}`); return; }
    const p = pctOf(pct);
    if (!reset && p !== null && (p < 0 || p > 100)) { toast.error("A commission is a % of the margin — 0 to 100"); return; }
    const next: OrderCommissionSet | null = reset ? null : {
      ...(payee === "__none" ? { payeeId: null } : payee === "__usual" ? {} : { payeeId: payee }),
      ...(p !== null && payee !== "__none" ? { pct: p } : {}),
      ...(note.trim() ? { note: note.trim() } : {}),
      at: new Date().toISOString(), by: user.name,
    };
    // Nothing different from the rules: no record at all.
    const empty = next && next.payeeId === undefined && next.pct === undefined;
    setSaving(true);
    try {
      updateDbAs({ summary: `Commission on ${order.orderNumber}: ${reset || empty ? "as the rules say" : payee === "__none" ? "none" : `${db.users.find(u => u.id === who)?.name ?? ""}${p !== null ? ` at ${p}%` : ""}`}` },
        d => writeOrderCommission(d, order.id, reset || empty ? null : next));
      toast.success("Commission saved");
      onClose();
    } finally { setSaving(false); }
  };

  return (
    <ActionSheet open onOpenChange={o => { if (!o) onClose(); }} size="md" icon={Percent}
      title={`Commission on ${order.orderNumber}`}
      description={`As the rules say: ${usualName ? `${usualName}${usual.how === "handler" ? " (handles the client)" : " (took the order)"}` : "nobody"}. Change it for this order only.`}
      footer={
        <div className="flex justify-between gap-2 flex-wrap">
          {set ? <Button variant="ghost" onClick={() => void save(true)} disabled={saving || !!closed} className="rounded-xl h-10">Back to the rules</Button> : <span />}
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose} className="rounded-xl h-10">Cancel</Button>
            <AsyncButton onClick={() => save(false)} disabled={saving || !!closed} className="btn-hero rounded-xl h-10 px-6">{saving ? "Saving…" : "Save"}</AsyncButton>
          </div>
        </div>
      }>
      <div className="space-y-4">
        {closed && <p className="text-xs rounded-xl bg-amber-500/10 border border-amber-500/30 p-3 text-amber-800">Sold in a closed year — its commission stays as it was.</p>}
        <div>
          <Label className="text-xs">Who earns it</Label>
          <Select value={payee} onValueChange={setPayee}>
            <SelectTrigger className="h-10 rounded-xl mt-1" aria-label="Who earns it"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__usual">As the rules say — {usualName ?? "nobody"}</SelectItem>
              {people.map(u => <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>)}
              <SelectItem value="__none">Nobody — no commission on this order</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {payee !== "__none" && (
          <div>
            <Label className="text-xs">% of margin</Label>
            <Input type="number" min={0} max={100} step="0.1" inputMode="decimal" value={pct} onChange={e => setPct(e.target.value)} className="h-10 rounded-xl mt-1" aria-label="% of margin for this order"
              placeholder={rate ? `Their rate — ${rate.pct}%` : "Their rate — none"} />
            <p className="text-[11px] text-muted-foreground mt-1">Blank: their own rate on the day it was sold{rate ? ` (${rate.pct}%)` : ""}.</p>
          </div>
        )}
        <div>
          <Label className="text-xs">Note</Label>
          <Input value={note} onChange={e => setNote(e.target.value)} className="h-10 rounded-xl mt-1" placeholder="Optional — why" aria-label="Note" />
        </div>
      </div>
    </ActionSheet>
  );
}

/* ── Paying it ──────────────────────────────────────────────────────────── */

/** Pay a salesperson's commission — from a rupee account, or another currency's at a rate. */
export function PayCommissionSheet({ employeeId, onClose }: { employeeId: string; onClose: () => void }) {
  const db = useDb();
  const { user } = useAuth();
  const ready = useCommissionData();
  const who = db.users.find(u => u.id === employeeId);
  const acc = useMemo(() => (ready && who ? commissionAccount(db, who.id) : null), [db, ready, who]);
  const [lockerId, setLockerId] = useState("");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(todayLocal());
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const lockers = db.lockers.filter(l => l.active !== false);
  const locker = lockers.find(l => l.id === lockerId);
  const amt = Number(amount) || 0;
  const fx = useRupeePay(lockerId, amt, who ? `${who.name}'s` : "their", () => setAmount(""));
  const owed = acc?.owedInr ?? 0;
  const inCur = (inr: number) => (fx.foreign ? (fx.rate > 0 ? Math.round(inr / fx.rate * 100) / 100 : 0) : inr);
  useEffect(() => { if (!amount && owed > 0 && !fx.foreign && lockerId) setAmount(String(owed)); }, [owed, lockerId]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!who) return null;
  const save = async () => {
    if (user?.role !== "admin") { toast.error("Only an admin can pay commission"); return; }
    const at = stampFor(date);
    const problem = commissionPayProblem(loadDb(), { lockerId, amount: amt, at, ...fx.args }) ?? fx.problem;
    if (problem) { toast.error(problem); return; }
    if (!locker) return;
    const bal = lockerBalance(locker, db.lockerTransactions);
    if (amt > bal && !(await confirmBox(`${fmtLockerAmount(amt, locker.currency)} is more than ${locker.name}'s balance of ${fmtLockerAmount(bal, locker.currency)}.\n\nThe balance will go negative — continue only if a deposit is still missing.`))) return;
    if (fx.inr > owed + 0.5 && !(await confirmBox(`${fx.text} is more than the ${fmtMoneyInr(Math.max(0, owed))} of commission they have earned and not been paid.\n\nThe extra is paid ahead — it comes off what they earn next. Continue?`))) return;
    setSaving(true);
    try {
      updateDbAs({ summary: `Sales commission paid: ${fx.text} to ${who.name}` }, d => {
        writeCommissionPayment(d, { lockerId: locker.id, amount: amt, note, userId: user!.id, at, payeeId: who.id, payeeName: who.name, ...fx.args });
      });
      toast.success(`${fx.text} commission paid to ${who.name}`);
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't save — nothing was recorded");
    } finally { setSaving(false); }
  };

  return (
    <ActionSheet open onOpenChange={o => { if (!o) onClose(); }} size="md" icon={Wallet}
      title={`Pay commission to ${who.name}`}
      description={!acc ? "Working out what they have earned…" : owed > 0.005 ? `Earned and not paid: ${fmtMoneyInr(owed)}` : owed < -0.005 ? `Paid ahead ${fmtMoneyInr(-owed)} — nothing owed now` : "Nothing owed now"}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose} className="rounded-xl h-10">Cancel</Button>
          <AsyncButton onClick={save} disabled={saving || user?.role !== "admin" || !acc} className="btn-hero rounded-xl h-10 px-6">{saving ? "Saving…" : "Pay commission"}</AsyncButton>
        </div>
      }>
      <div className="space-y-4">
        <div>
          <Label className="text-xs">From account</Label>
          <Select value={lockerId} onValueChange={setLockerId}>
            <SelectTrigger className="h-10 rounded-xl mt-1" aria-label="From account"><SelectValue placeholder={lockers.length ? "Choose an account" : "No account"} /></SelectTrigger>
            <SelectContent>{lockers.map(l => <SelectItem key={l.id} value={l.id}>{l.name} · {fmtLockerAmount(lockerBalance(l, db.lockerTransactions), l.currency)}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        {fx.box}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label className="text-xs">Amount ({fx.foreign ? fx.cur : "₹"})</Label>
            <Input type="number" min={0} step="0.01" inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)} className="h-10 rounded-xl mt-1" aria-label="Amount" />
            {owed > 0.005 && (!fx.foreign || fx.rate > 0) && amt !== inCur(owed) && (
              <button type="button" onClick={() => setAmount(String(inCur(owed)))} className="mt-1 text-[11px] text-primary hover:underline">
                All earned — {fmtMoneyInr(owed)}{fx.foreign ? ` = ${fmtCcy(inCur(owed), fx.cur)}` : ""}
              </button>
            )}
          </div>
          <div>
            <Label className="text-xs">Date</Label>
            <Input type="date" min={openMin()} value={date} onChange={e => setDate(e.target.value)} className="h-10 rounded-xl mt-1" aria-label="Date" />
          </div>
        </div>
        <div>
          <Label className="text-xs">Note</Label>
          <Input value={note} onChange={e => setNote(e.target.value)} className="h-10 rounded-xl mt-1" placeholder="Optional — which month, UPI ref" aria-label="Note" />
        </div>
        <p className="text-[11px] text-muted-foreground">
          Shows on their pay ledger. Not a running cost in Profit &amp; Loss — the commission is already in the cost of the orders it was earned on.
        </p>
      </div>
    </ActionSheet>
  );
}
