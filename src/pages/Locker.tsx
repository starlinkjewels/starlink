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
import { Plus, Landmark, Wallet, ArrowDownCircle, ArrowUpCircle, ArrowLeftRight, History, Pencil, Download, FileText, FileSpreadsheet } from "lucide-react";
import { toast } from "sonner";
import { motion } from "framer-motion";
import { downloadCsv, downloadLedgerPdf, fmtInrPlain } from "@/lib/ledgerExport";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

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

  // ── Edit locker ──
  const [editId, setEditId] = useState<string | null>(null);
  const [ef, setEf] = useState<{ name: string; type: LockerType; accountNumberLast4: string; openingBalance: string }>({
    name: "", type: "bank", accountNumberLast4: "", openingBalance: "0",
  });
  const [editSaving, setEditSaving] = useState(false);

  const openEditLocker = (l: typeof lockers[number]) => {
    setEditId(l.id);
    setEf({ name: l.name, type: l.type, accountNumberLast4: l.accountNumberLast4 || "", openingBalance: String(l.openingBalance) });
  };

  const saveEditLocker = () => {
    if (!editId) return;
    if (!ef.name.trim()) { toast.error("Enter an account name"); return; }
    setEditSaving(true);
    try {
      updateDb(d => {
        const l = d.lockers.find(x => x.id === editId);
        if (!l) return;
        l.name = ef.name.trim();
        l.type = ef.type;
        l.accountNumberLast4 = ef.accountNumberLast4.trim() || undefined;
        l.openingBalance = Math.max(0, Number(ef.openingBalance) || 0);
      });
      toast.success("Locker updated");
      setEditId(null);
    } finally { setEditSaving(false); }
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

  const txnLabel = (t: (typeof txns)[number]) =>
    t.category || t.note || (t.type === "transfer_in" ? "Transfer in" : t.type === "transfer_out" ? "Transfer out" : t.type);
  const txnSigned = (t: (typeof txns)[number]) => (t.type === "income" || t.type === "transfer_in" ? t.amountInr : -t.amountInr);

  const exportCsv = () => {
    if (!selected) return;
    downloadCsv(
      `Locker-${selected.name.replace(/\s+/g, "_")}`,
      ["Date", "Description", "Type", "Amount (INR)"],
      txns.map(t => [fmtDate(t.createdAt), txnLabel(t), t.type, txnSigned(t)]),
    );
  };

  const exportPdf = () => {
    if (!selected) return;
    downloadLedgerPdf({
      title: "Locker Ledger Report",
      subjectLines: [
        `Account: ${selected.name}${selected.type === "bank" && selected.accountNumberLast4 ? ` (····${selected.accountNumberLast4})` : ""}`,
        `Type: ${selected.type === "bank" ? "Bank" : "Cash"}`,
        `Report Generated: ${new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}`,
      ],
      summary: [
        { label: "Current Balance", value: fmtInrPlain(lockerBalance(selected, db.lockerTransactions)) },
        { label: "Total In", value: fmtInrPlain(totalIn) },
        { label: "Total Out", value: fmtInrPlain(totalOut) },
      ],
      columns: [
        { header: "Date", x: 20 },
        { header: "Description", x: 55 },
        { header: "Type", x: 130 },
        { header: "Amount (INR)", x: 158 },
      ],
      rows: txns.map(t => [fmtDate(t.createdAt), txnLabel(t).slice(0, 32), t.type, (txnSigned(t) >= 0 ? "+" : "-") + fmtInrPlain(Math.abs(txnSigned(t))).replace("Rs. ", "")]),
      filename: `Locker-${selected.name.replace(/\s+/g, "_")}`,
    });
  };

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
            <div
              key={l.id}
              role="button"
              tabIndex={0}
              onClick={() => { setSelectedId(isSelected ? null : l.id); setTxnMode(false); }}
              onKeyDown={e => { if (e.key === "Enter") { setSelectedId(isSelected ? null : l.id); setTxnMode(false); } }}
              className={`card-luxe p-5 text-left transition-all cursor-pointer relative ${isSelected ? "ring-2 ring-primary" : "hover:shadow-md"}`}
            >
              <button
                onClick={e => { e.stopPropagation(); openEditLocker(l); }}
                className="absolute top-4 right-4 h-7 w-7 rounded-lg grid place-items-center text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors"
                title="Edit locker"
              >
                <Pencil className="h-3.5 w-3.5" />
              </button>
              <div className="flex items-center gap-3 pr-8">
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
            </div>
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
            <div className="flex items-center gap-2 flex-wrap">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" className="rounded-xl gap-2"><Download className="h-4 w-4" /> Export</Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={exportPdf}><FileText className="h-4 w-4 mr-2" /> Download PDF</DropdownMenuItem>
                  <DropdownMenuItem onClick={exportCsv}><FileSpreadsheet className="h-4 w-4 mr-2" /> Download Excel (CSV)</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              <Button onClick={() => setTxnMode(v => !v)} className="btn-hero rounded-xl gap-2">
                <Plus className="h-4 w-4" /> Record Transaction
              </Button>
            </div>
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

      <Dialog open={!!editId} onOpenChange={open => !open && setEditId(null)}>
        <DialogContent className="max-w-md rounded-2xl">
          <DialogHeader><DialogTitle className="font-display text-2xl">Edit Locker</DialogTitle></DialogHeader>
          <div className="space-y-3 mt-2">
            <div>
              <Label className="text-xs">Account Name</Label>
              <Input value={ef.name} onChange={e => setEf({ ...ef, name: e.target.value })} className="rounded-xl mt-1" />
            </div>
            <div>
              <Label className="text-xs">Type</Label>
              <Select value={ef.type} onValueChange={v => setEf({ ...ef, type: v as LockerType })}>
                <SelectTrigger className="rounded-xl mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="bank">Bank</SelectItem>
                  <SelectItem value="cash">Cash</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {ef.type === "bank" && (
              <div>
                <Label className="text-xs">Account Number (last 4, optional)</Label>
                <Input value={ef.accountNumberLast4} onChange={e => setEf({ ...ef, accountNumberLast4: e.target.value })} maxLength={4} className="rounded-xl mt-1" />
              </div>
            )}
            <div>
              <Label className="text-xs">Opening Balance (₹)</Label>
              <Input type="number" min={0} value={ef.openingBalance} onChange={e => setEf({ ...ef, openingBalance: e.target.value })} className="rounded-xl mt-1" />
            </div>
            <div className="flex gap-2">
              <AsyncButton onClick={saveEditLocker} disabled={editSaving} className="btn-hero rounded-xl flex-1">{editSaving ? "Saving…" : "Save Changes"}</AsyncButton>
              <Button variant="outline" onClick={() => setEditId(null)} className="rounded-xl">Cancel</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
