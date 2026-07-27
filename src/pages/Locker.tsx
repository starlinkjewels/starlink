import { useState } from "react";
import { updateDb, uid, type LockerType } from "@/lib/db";
import { useDb } from "@/hooks/useDb";
import { useAuth } from "@/lib/auth";
import { fmtMoneyInr, lockerBalance } from "@/lib/manufacturing";
import { fmtDate } from "@/lib/db";
import { Button } from "@/components/ui/button";
import { AsyncButton } from "@/components/AsyncButton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { usePagination } from "@/hooks/usePagination";
import { PaginationBar } from "@/components/PaginationBar";
import { Plus, Landmark, Wallet, ArrowDownCircle, ArrowUpCircle, ArrowLeftRight, History } from "lucide-react";
import { toast } from "sonner";
import { motion } from "framer-motion";

const PAGE_SIZE = 10;

export function LockerPage() {
  const { user } = useAuth();
  const db = useDb();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [f, setF] = useState<{ name: string; type: LockerType; accountNumberLast4: string; openingBalance: string }>({
    name: "", type: "bank", accountNumberLast4: "", openingBalance: "0",
  });

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [txnMode, setTxnMode] = useState(false);
  const [txnType, setTxnType] = useState<"income" | "expense" | "transfer_out">("expense");
  const [txnAmount, setTxnAmount] = useState("");
  const [txnCategory, setTxnCategory] = useState("");
  const [txnNote, setTxnNote] = useState("");
  const [txnTargetLocker, setTxnTargetLocker] = useState("");

  const lockers = db.lockers.filter(l => l.active !== false);
  const selected = lockers.find(l => l.id === selectedId) ?? null;

  const createLocker = () => {
    if (!f.name.trim()) { toast.error("Enter an account name"); return; }
    setSaving(true);
    try {
      updateDb(d => {
        if (!d.lockers) d.lockers = [];
        d.lockers.unshift({
          id: uid("lk_"), name: f.name.trim(), type: f.type,
          accountNumberLast4: f.accountNumberLast4.trim() || undefined,
          openingBalance: Math.max(0, Number(f.openingBalance) || 0),
          createdAt: new Date().toISOString(), active: true,
        });
      });
      toast.success("Locker created");
      setOpen(false);
      setF({ name: "", type: "bank", accountNumberLast4: "", openingBalance: "0" });
    } finally { setSaving(false); }
  };

  const recordTxn = () => {
    if (!selected) return;
    const amt = Number(txnAmount);
    if (!amt || amt <= 0) { toast.error("Enter a valid amount"); return; }
    if (txnType === "transfer_out" && !txnTargetLocker) { toast.error("Choose a destination locker"); return; }
    const now = new Date().toISOString();
    updateDb(d => {
      if (!d.lockerTransactions) d.lockerTransactions = [];
      if (txnType === "transfer_out") {
        const target = d.lockers.find(l => l.id === txnTargetLocker);
        if (!target) return;
        d.lockerTransactions.push({
          id: uid("ltx_"), lockerId: selected.id, type: "transfer_out", amountInr: amt,
          category: "Transfer", pairedLockerId: target.id, note: txnNote.trim() || undefined,
          recordedBy: user!.id, createdAt: now,
        });
        d.lockerTransactions.push({
          id: uid("ltx_"), lockerId: target.id, type: "transfer_in", amountInr: amt,
          category: "Transfer", pairedLockerId: selected.id, note: txnNote.trim() || undefined,
          recordedBy: user!.id, createdAt: now,
        });
      } else {
        d.lockerTransactions.push({
          id: uid("ltx_"), lockerId: selected.id, type: txnType, amountInr: amt,
          category: txnCategory.trim() || undefined, refType: "manual",
          note: txnNote.trim() || undefined, recordedBy: user!.id, createdAt: now,
        });
      }
    });
    toast.success("Transaction recorded");
    setTxnAmount(""); setTxnCategory(""); setTxnNote(""); setTxnTargetLocker(""); setTxnMode(false);
  };

  const txns = selected
    ? db.lockerTransactions.filter(t => t.lockerId === selected.id).sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt))
    : [];
  const { paged, page, setPage, totalPages, start, end } = usePagination(txns, PAGE_SIZE);

  const totalIn = txns.filter(t => t.type === "income" || t.type === "transfer_in").reduce((s, t) => s + t.amountInr, 0);
  const totalOut = txns.filter(t => t.type === "expense" || t.type === "transfer_out").reduce((s, t) => s + t.amountInr, 0);

  return (
    <div className="max-w-6xl mx-auto space-y-5">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="font-display text-2xl md:text-3xl text-brand-dark">Locker</h1>
          <p className="text-sm text-muted-foreground">Bank &amp; cash accounts — {lockers.length} locker{lockers.length !== 1 ? "s" : ""}</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button className="btn-hero h-11 rounded-xl"><Plus className="h-4 w-4 mr-2" />New Locker</Button>
          </DialogTrigger>
          <DialogContent className="max-w-md rounded-2xl">
            <DialogHeader><DialogTitle className="font-display text-2xl">Add Locker</DialogTitle></DialogHeader>
            <div className="space-y-3 mt-2">
              <div>
                <Label className="text-xs">Account Name</Label>
                <Input value={f.name} onChange={e => setF({ ...f, name: e.target.value })} className="rounded-xl mt-1" placeholder="HDFC Current A/c" />
              </div>
              <div>
                <Label className="text-xs">Type</Label>
                <Select value={f.type} onValueChange={v => setF({ ...f, type: v as LockerType })}>
                  <SelectTrigger className="rounded-xl mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="bank">Bank</SelectItem>
                    <SelectItem value="cash">Cash</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {f.type === "bank" && (
                <div>
                  <Label className="text-xs">Account Number (last 4, optional)</Label>
                  <Input value={f.accountNumberLast4} onChange={e => setF({ ...f, accountNumberLast4: e.target.value })} maxLength={4} className="rounded-xl mt-1" />
                </div>
              )}
              <div>
                <Label className="text-xs">Opening Balance (₹)</Label>
                <Input type="number" min={0} value={f.openingBalance} onChange={e => setF({ ...f, openingBalance: e.target.value })} className="rounded-xl mt-1" />
              </div>
              <Button onClick={createLocker} disabled={saving} className="btn-hero rounded-xl w-full">{saving ? "Creating…" : "Create Locker"}</Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
        {lockers.map(l => {
          const bal = lockerBalance(l, db.lockerTransactions);
          const isSelected = selectedId === l.id;
          return (
            <button
              key={l.id}
              onClick={() => { setSelectedId(isSelected ? null : l.id); setTxnMode(false); }}
              className={`card-luxe p-5 text-left transition-all ${isSelected ? "ring-2 ring-primary" : "hover:shadow-md"}`}
            >
              <div className="flex items-center gap-3">
                <div className="h-11 w-11 rounded-2xl bg-gradient-to-br from-primary/15 to-brand-light/20 grid place-items-center shrink-0">
                  {l.type === "bank" ? <Landmark className="h-5 w-5 text-primary" /> : <Wallet className="h-5 w-5 text-primary" />}
                </div>
                <div className="min-w-0">
                  <p className="font-display text-lg text-brand-dark truncate leading-tight">{l.name}</p>
                  <p className="text-xs text-muted-foreground">{l.type === "bank" ? `Bank${l.accountNumberLast4 ? ` ····${l.accountNumberLast4}` : ""}` : "Cash"}</p>
                </div>
              </div>
              <p className="mt-4 text-2xl font-display font-bold text-brand-dark">{fmtMoneyInr(bal)}</p>
              <p className="text-xs text-muted-foreground mt-0.5">Current balance</p>
            </button>
          );
        })}
        {lockers.length === 0 && (
          <div className="col-span-full card-luxe p-12 text-center text-muted-foreground">No lockers yet — add your first bank/cash account.</div>
        )}
      </div>

      {selected && (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="card-luxe p-5 space-y-4">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-xl bg-success/10 grid place-items-center shrink-0">
                <History className="h-5 w-5 text-success" />
              </div>
              <div>
                <h3 className="font-display text-lg text-brand-dark">{selected.name} — Ledger</h3>
                <p className="text-xs text-muted-foreground">{txns.length} transaction{txns.length !== 1 ? "s" : ""}</p>
              </div>
            </div>
            <Button onClick={() => setTxnMode(v => !v)} className="btn-hero rounded-xl gap-2">
              <Plus className="h-4 w-4" /> Record Transaction
            </Button>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="p-3 rounded-xl bg-secondary text-center">
              <p className="text-xs text-muted-foreground mb-1">Balance</p>
              <p className="font-semibold text-sm">{fmtMoneyInr(lockerBalance(selected, db.lockerTransactions))}</p>
            </div>
            <div className="p-3 rounded-xl bg-success/8 border border-success/20 text-center">
              <p className="text-xs text-muted-foreground mb-1">Total In</p>
              <p className="font-semibold text-sm text-success">{fmtMoneyInr(totalIn)}</p>
            </div>
            <div className="p-3 rounded-xl bg-destructive/5 border border-destructive/20 text-center">
              <p className="text-xs text-muted-foreground mb-1">Total Out</p>
              <p className="font-semibold text-sm text-destructive">{fmtMoneyInr(totalOut)}</p>
            </div>
          </div>

          {txnMode && (
            <div className="pt-2 border-t border-border/60 space-y-2.5">
              <p className="text-sm font-medium text-brand-dark">Record Transaction</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <Select value={txnType} onValueChange={v => setTxnType(v as typeof txnType)}>
                  <SelectTrigger className="h-10 rounded-xl"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="income">Income (money in)</SelectItem>
                    <SelectItem value="expense">Expense (money out)</SelectItem>
                    <SelectItem value="transfer_out">Transfer to another locker</SelectItem>
                  </SelectContent>
                </Select>
                <Input type="number" min={1} value={txnAmount} onChange={e => setTxnAmount(e.target.value)} className="rounded-xl h-10" placeholder="Amount (₹)" />
                {txnType === "transfer_out" ? (
                  <Select value={txnTargetLocker} onValueChange={setTxnTargetLocker}>
                    <SelectTrigger className="h-10 rounded-xl"><SelectValue placeholder="Destination locker" /></SelectTrigger>
                    <SelectContent>
                      {lockers.filter(l => l.id !== selected.id).map(l => <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                ) : (
                  <Input value={txnCategory} onChange={e => setTxnCategory(e.target.value)} className="rounded-xl h-10" placeholder="Category (optional)" />
                )}
                <Input value={txnNote} onChange={e => setTxnNote(e.target.value)} className="rounded-xl h-10" placeholder="Note (optional)" />
              </div>
              <div className="flex gap-2.5">
                <AsyncButton onClick={recordTxn} className="btn-hero rounded-xl h-10">Save</AsyncButton>
                <Button variant="outline" onClick={() => setTxnMode(false)} className="rounded-xl h-10">Cancel</Button>
              </div>
            </div>
          )}

          <div className="divide-y divide-border/40 -mx-5">
            {paged.map(t => (
              <div key={t.id} className="flex items-center gap-3 px-5 py-3">
                <div className={`h-8 w-8 rounded-lg grid place-items-center shrink-0 ${
                  t.type === "income" || t.type === "transfer_in" ? "bg-success/10 text-success" : "bg-destructive/10 text-destructive"
                }`}>
                  {t.type === "transfer_in" || t.type === "transfer_out"
                    ? <ArrowLeftRight className="h-4 w-4" />
                    : t.type === "income" ? <ArrowDownCircle className="h-4 w-4" /> : <ArrowUpCircle className="h-4 w-4" />}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{t.category || t.note || (t.type === "transfer_in" ? "Transfer in" : t.type === "transfer_out" ? "Transfer out" : t.type)}</p>
                  <p className="text-xs text-muted-foreground">{fmtDate(t.createdAt)}</p>
                </div>
                <p className={`text-sm font-semibold shrink-0 ${t.type === "income" || t.type === "transfer_in" ? "text-success" : "text-destructive"}`}>
                  {t.type === "income" || t.type === "transfer_in" ? "+" : "−"}{fmtMoneyInr(t.amountInr)}
                </p>
              </div>
            ))}
            {txns.length === 0 && <div className="px-5 py-8 text-center text-sm text-muted-foreground">No transactions yet.</div>}
          </div>

          {totalPages > 1 && (
            <PaginationBar page={page} totalPages={totalPages} onPageChange={setPage} label={`Showing ${start + 1}–${end} of ${txns.length}`} />
          )}
        </motion.div>
      )}
    </div>
  );
}
