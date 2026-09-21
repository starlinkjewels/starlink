import { useEffect, useState } from "react";
import { updateDb, uid, fmtMoney, fmtDate, balanceDue, invoiceOrderIds, settleClientAccount, type LockerType, type Order } from "@/lib/db";
import { reserveVoucherNumber } from "@/lib/counters";
import { applyIncomeToClient } from "@/lib/clientPayments";
import { useDb } from "@/hooks/useDb";
import { useAuth } from "@/lib/auth";
import { fmtLockerAmount, lockerBalance } from "@/lib/manufacturing";
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
import { ExportDialog, inDateRange } from "@/components/ExportDialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const PAGE_SIZE = 10;

/** Bare number for CSV/PDF cells (no currency symbol) — jsPDF can't render ₹. */
function plainAmt(n: number, currency?: "INR" | "USD"): string {
  return currency === "USD" ? fmtMoney(n).replace("$", "") : fmtInrPlain(n).replace("Rs. ", "");
}

export function LockerPage() {
  const { user } = useAuth();
  const db = useDb();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [f, setF] = useState<{ name: string; type: LockerType; currency: "INR" | "USD"; accountNumberLast4: string; openingBalance: string }>({
    name: "", type: "bank", currency: "INR", accountNumberLast4: "", openingBalance: "0",
  });

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showExport, setShowExport] = useState(false);
  const [filterFrom, setFilterFrom] = useState("");
  const [filterTo, setFilterTo] = useState("");
  const [filterType, setFilterType] = useState<"all" | "income" | "expense" | "transfer_in" | "transfer_out">("all");
  const [txnMode, setTxnMode] = useState(false);
  const [txnType, setTxnType] = useState<"income" | "expense" | "transfer_out">("expense");
  const [txnAmount, setTxnAmount] = useState("");
  const [txnCategory, setTxnCategory] = useState("");
  // Managed in Settings → Categories, and required on every entry so the ledger
  // can be grouped and totalled rather than holding free text.
  const lockerCats = db.settings.lockerCategories?.length
    ? db.settings.lockerCategories
    : ["Client Payment", "Supplier Payment", "Factory Making Charges", "Owner Deposit",
       "Owner Withdrawal", "Bank Charges", "Local Expense", "Transfer", "Other"];
  const [txnNote, setTxnNote] = useState("");
  const [txnTargetLocker, setTxnTargetLocker] = useState("");
  const [txnExchangeRate, setTxnExchangeRate] = useState("");
  // Income can be a REAL client payment rather than a loose cash entry: pick the
  // client (and the invoice it settles) and the money is allocated to their
  // orders, instead of sitting in the locker while the invoice still reads unpaid.
  const [txnClientId, setTxnClientId] = useState("");
  const [txnInvoiceId, setTxnInvoiceId] = useState("");
  // Repairing an income row that was typed in as a loose entry when it was
  // really a client payment — the cash is already in the locker, only the
  // allocation to their orders is missing.
  const [fixTxnId, setFixTxnId] = useState<string | null>(null);
  const [fixClientId, setFixClientId] = useState("");
  const [fixInvoiceId, setFixInvoiceId] = useState("");
  const [fixRate, setFixRate] = useState("");

  const lockers = db.lockers.filter(l => l.active !== false);
  const selected = lockers.find(l => l.id === selectedId) ?? null;

  // ── Client payments recorded straight from the locker ──────────────────────
  const clientsSorted = [...db.clients].sort((a, b) => a.companyName.localeCompare(b.companyName));
  const invLiveBalance = (ids: string[]) =>
    ids.map(oid => db.orders.find(o => o.id === oid))
      .filter((o): o is Order => !!o && o.status !== "Rejected")
      .reduce((s, o) => s + balanceDue(o), 0);
  const clientInvoices = txnClientId
    ? (db.invoices ?? [])
        .filter(i => i.clientId === txnClientId)
        .map(i => ({ inv: i, bal: invLiveBalance(invoiceOrderIds(i)) }))
        .sort((a, b) => +new Date(b.inv.createdAt) - +new Date(a.inv.createdAt))
    : [];

  // One outstanding invoice for that client → that is what the money is for.
  // Preselect it so a deposit settles the bill they actually paid.
  const clientOpenUnpaid = clientInvoices.filter(x => x.bal > 0);
  useEffect(() => {
    setTxnInvoiceId(clientOpenUnpaid.length === 1 ? clientOpenUnpaid[0].inv.id : "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [txnClientId]);



  const createLocker = () => {
    if (!f.name.trim()) { toast.error("Enter an account name"); return; }
    setSaving(true);
    try {
      updateDb(d => {
        if (!d.lockers) d.lockers = [];
        d.lockers.unshift({
          id: uid("lk_"), name: f.name.trim(), type: f.type, currency: f.currency,
          accountNumberLast4: f.accountNumberLast4.trim() || undefined,
          openingBalance: Math.max(0, Number(f.openingBalance) || 0),
          createdAt: new Date().toISOString(), active: true,
        });
      });
      toast.success("Locker created");
      setOpen(false);
      setF({ name: "", type: "bank", currency: "INR", accountNumberLast4: "", openingBalance: "0" });
    } finally { setSaving(false); }
  };

  // ── Edit locker ──
  const [editId, setEditId] = useState<string | null>(null);
  const [ef, setEf] = useState<{ name: string; type: LockerType; currency: "INR" | "USD"; accountNumberLast4: string; openingBalance: string }>({
    name: "", type: "bank", currency: "INR", accountNumberLast4: "", openingBalance: "0",
  });
  const [editSaving, setEditSaving] = useState(false);

  const openEditLocker = (l: typeof lockers[number]) => {
    setEditId(l.id);
    setEf({ name: l.name, type: l.type, currency: l.currency || "INR", accountNumberLast4: l.accountNumberLast4 || "", openingBalance: String(l.openingBalance) });
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
        l.currency = ef.currency;
        l.accountNumberLast4 = ef.accountNumberLast4.trim() || undefined;
        l.openingBalance = Math.max(0, Number(ef.openingBalance) || 0);
      });
      toast.success("Locker updated");
      setEditId(null);
    } finally { setEditSaving(false); }
  };

  const recordTxn = async () => {
    if (!selected) return;
    const amt = Number(txnAmount);
    if (!amt || amt <= 0) { toast.error("Enter a valid amount"); return; }
    if (txnType !== "transfer_out" && !txnCategory) { toast.error("Choose a category"); return; }
    if (txnType === "transfer_out" && !txnTargetLocker) { toast.error("Choose a destination locker"); return; }
    const target = txnType === "transfer_out" ? lockers.find(l => l.id === txnTargetLocker) : undefined;
    const crossCurrency = !!target && (target.currency || "INR") !== (selected.currency || "INR");
    const rate = Number(txnExchangeRate);
    if (crossCurrency && (!rate || rate <= 0)) { toast.error("Enter a valid exchange rate"); return; }
    // An INR locker taking a USD-billed client payment needs the rate to know
    // how much of their bill this actually settles.
    if (txnType === "income" && txnClientId && (selected.currency || "INR") !== "USD" && (!rate || rate <= 0)) {
      toast.error("Enter the exchange rate — the client is billed in USD"); return;
    }
    // Overdraw warning — money leaving the locker (expense / transfer out) that
    // would take it below zero is almost always a mistake (wrong locker, or a
    // deposit that was never recorded). Warn, but let them proceed knowingly.
    // Reads only the SOURCE locker's own balance/currency, and the raw,
    // unconverted amount leaving it — correct as-is for cross-currency transfers too.
    if (txnType === "expense" || txnType === "transfer_out") {
      const bal = lockerBalance(selected, db.lockerTransactions);
      if (amt > bal) {
        const cur = selected.currency || "INR";
        const ok = window.confirm(
          `This ${txnType === "expense" ? "expense" : "transfer"} of ${fmtLockerAmount(amt, selected.currency)} is more than ${selected.name}'s balance of ${fmtLockerAmount(bal, selected.currency)} ${cur}.\n\nThe balance will go negative. Continue only if you're sure a deposit is still missing.`,
        );
        if (!ok) return;
      }
    }
    const now = new Date().toISOString();
    // A voucher number is what a person quotes when they refer to a cash entry.
    // Reserved in the database, so two people banking at once cannot share one.
    const voucher = await reserveVoucherNumber(db.lockerTransactions ?? []);
    const xferId = uid("xfer_");
    const currency = selected.currency || "INR";
    if (txnType === "transfer_out" && !db.lockers.find(l => l.id === txnTargetLocker)) {
      toast.error("That destination locker couldn't be found — pick it again and retry.");
      return;
    }
    updateDb(d => {
      if (!d.lockerTransactions) d.lockerTransactions = [];
      if (txnType === "transfer_out") {
        const target = d.lockers.find(l => l.id === txnTargetLocker);
        if (!target) return;
        const destAmount = crossCurrency
          ? Math.round((currency === "USD" ? amt * rate : amt / rate) * 100) / 100
          : amt;
        d.lockerTransactions.push({
          id: uid("ltx_"), lockerId: selected.id, type: "transfer_out", amountInr: amt, currency,
          category: "Transfer", refType: "transfer", transferId: xferId, voucherNo: voucher, pairedLockerId: target.id, note: txnNote.trim() || undefined,
          exchangeRate: crossCurrency ? rate : undefined,
          recordedBy: user!.id, createdAt: now,
        });
        d.lockerTransactions.push({
          id: uid("ltx_"), lockerId: target.id, type: "transfer_in", amountInr: destAmount, currency: target.currency || "INR",
          category: "Transfer", refType: "transfer", transferId: xferId, voucherNo: voucher, pairedLockerId: selected.id, note: txnNote.trim() || undefined,
          exchangeRate: crossCurrency ? rate : undefined,
          recordedBy: user!.id, createdAt: now,
        });
      } else {
        // Income the client sent us is a PAYMENT, not a loose cash entry: put it
        // through the same allocation the Payments screen uses, or the money sits
        // in the locker while their invoice still reads unpaid (exactly what
        // happened to invoice 0001).
        const payClient = txnType === "income" && txnClientId
          ? d.clients.find(c => c.id === txnClientId)
          : undefined;
        if (payClient) {
          // Orders are billed in USD; the amount typed here is in the LOCKER's
          // currency, so an INR locker converts back through the entered rate.
          const billed = currency === "USD" ? amt : (rate > 0 ? Math.round((amt / rate) * 100) / 100 : 0);
          const noteText = txnNote.trim() || undefined;
          const leftover = settleClientAccount(d, payClient.id, billed, user!.id, now, noteText, txnInvoiceId || undefined);
          d.lockerTransactions.push({
            id: uid("ltx_"), lockerId: selected.id, type: "income", amountInr: amt, currency,
            category: `Client Payment — ${payClient.companyName}`,
            refType: "clientPayment", refId: payClient.id,
            note: noteText, recordedBy: user!.id, createdAt: now,
            exchangeRate: currency === "USD" ? undefined : (rate || undefined),
          });
        } else {
          d.lockerTransactions.push({
            id: uid("ltx_"), lockerId: selected.id, type: txnType, amountInr: amt, currency,
            category: txnCategory || undefined, refType: "manual", voucherNo: voucher,
            note: txnNote.trim() || undefined, recordedBy: user!.id, createdAt: now,
          });
        }
      }
    });
    toast.success("Transaction recorded");
    setTxnAmount(""); setTxnCategory(""); setTxnNote(""); setTxnTargetLocker(""); setTxnExchangeRate(""); setTxnClientId(""); setTxnInvoiceId(""); setTxnMode(false);
  };

  // Shared with Settings' sweep of old entries — see src/lib/clientPayments.ts.
  const applyIncome = async () => {
    const txn = db.lockerTransactions.find(t => t.id === fixTxnId);
    const client = db.clients.find(c => c.id === fixClientId);
    if (!txn || !client) { toast.error("Choose the client this money came from"); return; }
    const res = await applyIncomeToClient({
      txnId: txn.id, clientId: client.id,
      invoiceId: fixInvoiceId || undefined,
      exchangeRate: Number(fixRate) || undefined,
      userId: user!.id,
    });
    if (!res.ok) { toast.error(res.error); return; }
    toast.success(`${fmtMoney(res.settled)} applied to ${client.companyName}'s bills`);
    setFixTxnId(null);
  };


  const txns = selected
    ? db.lockerTransactions.filter(t => t.lockerId === selected.id).sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt))
    : [];

  const filterFromDate = filterFrom ? new Date(filterFrom + "T00:00:00") : null;
  const filterToDate = filterTo ? new Date(filterTo + "T23:59:59.999") : null;
  const filtersActive = !!filterFrom || !!filterTo || filterType !== "all";
  // Filters narrow what's SHOWN — the running balance below is always computed
  // from the full, unfiltered history, so a filtered view still shows each
  // entry's true balance-at-the-time, like a bank statement search does.
  const filteredTxns = txns.filter(t => inDateRange(t.createdAt, filterFromDate, filterToDate) && (filterType === "all" || t.type === filterType));
  const { paged, page, setPage, totalPages, start, end } = usePagination(filteredTxns, PAGE_SIZE);

  const totalIn = txns.filter(t => t.type === "income" || t.type === "transfer_in").reduce((s, t) => s + t.amountInr, 0);
  const totalOut = txns.filter(t => t.type === "expense" || t.type === "transfer_out").reduce((s, t) => s + t.amountInr, 0);

  const txnLabel = (t: (typeof txns)[number]) =>
    t.category || t.note || (t.type === "transfer_in" ? "Transfer in" : t.type === "transfer_out" ? "Transfer out" : t.type);
  const txnSigned = (t: (typeof txns)[number]) => (t.type === "income" || t.type === "transfer_in" ? t.amountInr : -t.amountInr);

  // Running balance, computed oldest-first from the account's opening balance —
  // a proper statement, not just a flat list of unrelated amounts.
  const txnBalances = new Map<string, number>();
  if (selected) {
    let running = selected.openingBalance || 0;
    for (const t of [...txns].sort((a, b) => +new Date(a.createdAt) - +new Date(b.createdAt))) {
      running += txnSigned(t);
      txnBalances.set(t.id, running);
    }
  }

  const exportCsv = (from: Date | null, to: Date | null) => {
    if (!selected) return;
    const cur = selected.currency || "INR";
    downloadCsv(
      `Locker-${selected.name.replace(/\s+/g, "_")}`,
      ["Date", "Description", `Money In (${cur})`, `Money Out (${cur})`, `Balance (${cur})`],
      txns.filter(t => inDateRange(t.createdAt, from, to)).map(t => {
        const signed = txnSigned(t);
        return [fmtDate(t.createdAt), txnLabel(t), signed > 0 ? signed : "", signed < 0 ? -signed : "", txnBalances.get(t.id) ?? 0];
      }),
    );
  };

  const exportPdf = (from: Date | null, to: Date | null) => {
    if (!selected) return;
    const cur = selected.currency || "INR";
    downloadLedgerPdf({
      title: "Locker Account Statement",
      subjectLines: [
        `Account: ${selected.name}${selected.type === "bank" && selected.accountNumberLast4 ? ` (····${selected.accountNumberLast4})` : ""}`,
        `Type: ${selected.type === "bank" ? "Bank" : "Cash"} · Currency: ${cur}`,
        `Opening Balance: ${plainAmt(selected.openingBalance || 0, cur)} ${cur}`,
        `Report Generated: ${new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}`,
      ],
      summary: [
        { label: "Current Balance", value: `${plainAmt(lockerBalance(selected, db.lockerTransactions), cur)} ${cur}` },
        { label: "Total In", value: `${plainAmt(totalIn, cur)} ${cur}` },
        { label: "Total Out", value: `${plainAmt(totalOut, cur)} ${cur}` },
      ],
      columns: [
        { header: "Date", x: 20 },
        { header: "Description", x: 50 },
        { header: "In", x: 118 },
        { header: "Out", x: 140 },
        { header: "Balance", x: 165 },
      ],
      rows: txns.filter(t => inDateRange(t.createdAt, from, to)).map(t => {
        const signed = txnSigned(t);
        return [
          fmtDate(t.createdAt), txnLabel(t).slice(0, 26),
          signed > 0 ? plainAmt(signed, cur) : "—",
          signed < 0 ? plainAmt(-signed, cur) : "—",
          plainAmt(txnBalances.get(t.id) ?? 0, cur),
        ];
      }),
      filename: `Locker-${selected.name.replace(/\s+/g, "_")}`,
    });
  };

  return (
    <div className="max-w-7xl mx-auto space-y-5">
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
              <div className="grid grid-cols-2 gap-3">
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
                <div>
                  <Label className="text-xs">Currency</Label>
                  <Select value={f.currency} onValueChange={v => setF({ ...f, currency: v as "INR" | "USD" })}>
                    <SelectTrigger className="rounded-xl mt-1"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="INR">INR (₹)</SelectItem>
                      <SelectItem value="USD">USD ($)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              {f.type === "bank" && (
                <div>
                  <Label className="text-xs">Account Number (last 4, optional)</Label>
                  <Input value={f.accountNumberLast4} onChange={e => setF({ ...f, accountNumberLast4: e.target.value })} maxLength={4} className="rounded-xl mt-1" />
                </div>
              )}
              <div>
                <Label className="text-xs">Opening Balance ({f.currency === "USD" ? "$" : "₹"})</Label>
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
                  <p className="text-xs text-muted-foreground">
                    {l.type === "bank" ? `Bank${l.accountNumberLast4 ? ` ····${l.accountNumberLast4}` : ""}` : "Cash"} · {l.currency || "INR"}
                  </p>
                </div>
              </div>
              <p className="mt-4 text-2xl font-display font-bold text-brand-dark">{fmtLockerAmount(bal, l.currency)}</p>
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
                <p className="text-xs text-muted-foreground">
                  {filtersActive ? `${filteredTxns.length} of ${txns.length} transactions` : `${txns.length} transaction${txns.length !== 1 ? "s" : ""}`}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <Button variant="outline" onClick={() => setShowExport(true)} className="rounded-xl gap-2"><Download className="h-4 w-4" /> Export</Button>
              <ExportDialog open={showExport} onClose={() => setShowExport(false)} title={selected ? `${selected.name} ledger` : "locker"} options={[
                { label: "Ledger — PDF", sublabel: "Transactions with running balance", kind: "pdf", run: exportPdf },
                { label: "Ledger — Excel", sublabel: "Transactions with running balance", kind: "excel", run: exportCsv },
              ]} />
              <Button onClick={() => setTxnMode(v => !v)} className="btn-hero rounded-xl gap-2">
                <Plus className="h-4 w-4" /> Record Transaction
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="p-3 rounded-xl bg-secondary text-center">
              <p className="text-xs text-muted-foreground mb-1">Balance</p>
              <p className="font-semibold text-sm">{fmtLockerAmount(lockerBalance(selected, db.lockerTransactions), selected.currency)}</p>
            </div>
            <div className="p-3 rounded-xl bg-success/8 border border-success/20 text-center">
              <p className="text-xs text-muted-foreground mb-1">Total In</p>
              <p className="font-semibold text-sm text-success">{fmtLockerAmount(totalIn, selected.currency)}</p>
            </div>
            <div className="p-3 rounded-xl bg-destructive/5 border border-destructive/20 text-center">
              <p className="text-xs text-muted-foreground mb-1">Total Out</p>
              <p className="font-semibold text-sm text-destructive">{fmtLockerAmount(totalOut, selected.currency)}</p>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <Input type="date" value={filterFrom} onChange={e => setFilterFrom(e.target.value)} className="rounded-xl h-9 w-[9.5rem]" />
            <span className="text-xs text-muted-foreground">to</span>
            <Input type="date" value={filterTo} onChange={e => setFilterTo(e.target.value)} className="rounded-xl h-9 w-[9.5rem]" />
            <Select value={filterType} onValueChange={v => setFilterType(v as typeof filterType)}>
              <SelectTrigger className="h-9 rounded-xl w-40"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All types</SelectItem>
                <SelectItem value="income">Income</SelectItem>
                <SelectItem value="expense">Expense</SelectItem>
                <SelectItem value="transfer_in">Transfer in</SelectItem>
                <SelectItem value="transfer_out">Transfer out</SelectItem>
              </SelectContent>
            </Select>
            {filtersActive && (
              <button onClick={() => { setFilterFrom(""); setFilterTo(""); setFilterType("all"); }} className="text-xs text-primary hover:underline">
                Reset
              </button>
            )}
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
                <Input type="number" min={1} value={txnAmount} onChange={e => setTxnAmount(e.target.value)} className="rounded-xl h-10" placeholder={`Amount (${selected.currency === "USD" ? "$" : "₹"})`} />
                {txnType === "transfer_out" ? (
                  <Select value={txnTargetLocker} onValueChange={setTxnTargetLocker}>
                    <SelectTrigger className="h-10 rounded-xl"><SelectValue placeholder="Destination locker" /></SelectTrigger>
                    <SelectContent>
                      {lockers.filter(l => l.id !== selected.id).map(l => {
                        const sameCcy = (l.currency || "INR") === (selected.currency || "INR");
                        return <SelectItem key={l.id} value={l.id}>{l.name} {sameCcy ? "(same currency)" : `(${l.currency || "INR"})`}</SelectItem>;
                      })}
                    </SelectContent>
                  </Select>
                ) : (
                  <Select value={txnCategory} onValueChange={setTxnCategory}>
                    <SelectTrigger className="h-10 rounded-xl"><SelectValue placeholder="Category *" /></SelectTrigger>
                    <SelectContent>{lockerCats.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                  </Select>
                )}
                <Input value={txnNote} onChange={e => setTxnNote(e.target.value)} className="rounded-xl h-10" placeholder="Note (optional)" />
              </div>

              {txnType === "income" && (
                <div className="p-3 rounded-xl bg-secondary space-y-2.5">
                  <Label className="text-xs">Money received from a client? Pick them and it settles their bill.</Label>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    <Select value={txnClientId || "none"} onValueChange={v => { setTxnClientId(v === "none" ? "" : v); setTxnInvoiceId(""); }}>
                      <SelectTrigger className="h-10 rounded-xl bg-white"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">Not a client payment</SelectItem>
                        {clientsSorted.map(c => <SelectItem key={c.id} value={c.id}>{c.companyName}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    {txnClientId && (
                      <Select value={txnInvoiceId || "fifo"} onValueChange={v => setTxnInvoiceId(v === "fifo" ? "" : v)}>
                        <SelectTrigger className="h-10 rounded-xl bg-white"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="fifo">Oldest bills first</SelectItem>
                          {clientInvoices.map(({ inv, bal }) => (
                            <SelectItem key={inv.id} value={inv.id}>
                              Invoice {inv.number} — {bal > 0 ? `${fmtMoney(bal)} pending` : "settled"}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  </div>
                  {txnClientId && (selected.currency || "INR") !== "USD" && (
                    <>
                      <Label className="text-xs">Exchange rate — 1 USD = ₹ <span className="text-destructive">*</span></Label>
                      <Input type="number" min={0} step="0.01" value={txnExchangeRate} onChange={e => setTxnExchangeRate(e.target.value)}
                        className="rounded-xl h-10 bg-white" placeholder="e.g. 83.50" />
                    </>
                  )}
                  {txnClientId && (
                    <p className="text-[11px] text-muted-foreground">
                      {(() => {
                        const amt = Number(txnAmount) || 0;
                        const r = Number(txnExchangeRate) || 0;
                        const billed = (selected.currency || "INR") === "USD" ? amt : (r > 0 ? amt / r : 0);
                        const chosen = clientInvoices.find(x => x.inv.id === txnInvoiceId);
                        if (!billed) return "Enter the amount to see what it settles.";
                        return chosen
                          ? `${fmtMoney(billed)} goes against invoice ${chosen.inv.number} (${fmtMoney(chosen.bal)} pending); anything left over moves to their other bills, then to credit.`
                          : `${fmtMoney(billed)} is applied to their oldest unpaid orders first; anything left over becomes client credit.`;
                      })()}
                    </p>
                  )}
                </div>
              )}


              {txnType === "transfer_out" && txnTargetLocker && (() => {
                const target = lockers.find(l => l.id === txnTargetLocker);
                if (!target) return null;
                const crossCurrency = (target.currency || "INR") !== (selected.currency || "INR");
                if (!crossCurrency) return null;
                const rate = Number(txnExchangeRate) || 0;
                const amt = Number(txnAmount) || 0;
                const destAmount = rate > 0 ? (selected.currency === "USD" ? amt * rate : amt / rate) : null;
                return (
                  <div className="p-3 rounded-xl bg-secondary space-y-2">
                    <Label className="text-xs">Exchange rate — 1 USD = ₹ <span className="text-destructive">*</span></Label>
                    <Input
                      type="number" min={0} step="0.01" value={txnExchangeRate}
                      onChange={e => setTxnExchangeRate(e.target.value)}
                      className="rounded-xl h-10 bg-white" placeholder="e.g. 83.50"
                    />
                    <p className="text-xs text-muted-foreground">
                      {destAmount != null
                        ? `${fmtLockerAmount(amt, selected.currency)} → ${fmtLockerAmount(Math.round(destAmount * 100) / 100, target.currency)}`
                        : "Enter the rate above to see the converted amount — required before you can save this transfer."}
                    </p>
                  </div>
                );
              })()}

              <div className="flex gap-2.5">
                <AsyncButton onClick={recordTxn} className="btn-hero rounded-xl h-10">Save</AsyncButton>
                <Button variant="outline" onClick={() => setTxnMode(false)} className="rounded-xl h-10">Cancel</Button>
              </div>
            </div>
          )}

          {paged.length > 0 && (
            <div className="flex items-center gap-3 px-1 pb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              <div className="h-8 w-8 shrink-0" />
              <div className="flex-1 min-w-0">Particulars</div>
              <div className="w-20 sm:w-24 text-right shrink-0">Debit</div>
              <div className="w-20 sm:w-24 text-right shrink-0">Credit</div>
              <div className="w-20 sm:w-24 text-right shrink-0">Balance</div>
            </div>
          )}
          <div className="divide-y divide-border/40 -mx-5">
            {paged.map(t => {
              const isCredit = t.type === "income" || t.type === "transfer_in";
              return (
              <div key={t.id} className="flex items-center gap-3 px-5 py-3">
                <div className={`h-8 w-8 rounded-lg grid place-items-center shrink-0 ${
                  isCredit ? "bg-success/10 text-success" : "bg-destructive/10 text-destructive"
                }`}>
                  {t.type === "transfer_in" || t.type === "transfer_out"
                    ? <ArrowLeftRight className="h-4 w-4" />
                    : t.type === "income" ? <ArrowDownCircle className="h-4 w-4" /> : <ArrowUpCircle className="h-4 w-4" />}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">
                    {t.category || t.note || (t.type === "transfer_in" ? "Transfer in" : t.type === "transfer_out" ? "Transfer out" : t.type)}
                    {t.exchangeRate ? ` (@ ₹${t.exchangeRate}/$)` : ""}
                  </p>
                  <p className="text-xs text-muted-foreground">{fmtDate(t.createdAt)}</p>
                  {t.type === "income" && t.refType !== "clientPayment" && (
                    <button onClick={() => { setFixTxnId(t.id); setFixClientId(""); setFixInvoiceId(""); setFixRate(""); }}
                      className="text-[11px] text-primary hover:underline mt-0.5">
                      Apply to a client’s bill
                    </button>
                  )}
                </div>
                <div className="w-20 sm:w-24 text-right shrink-0">
                  {!isCredit && <p className="text-sm font-semibold text-destructive">{fmtLockerAmount(t.amountInr, t.currency ?? selected.currency)}</p>}
                </div>
                <div className="w-20 sm:w-24 text-right shrink-0">
                  {isCredit && <p className="text-sm font-semibold text-success">{fmtLockerAmount(t.amountInr, t.currency ?? selected.currency)}</p>}
                </div>
                <div className="w-20 sm:w-24 text-right shrink-0">
                  <p className="text-sm font-medium text-foreground">{fmtLockerAmount(txnBalances.get(t.id) ?? 0, selected.currency)}</p>
                </div>
              </div>
              );
            })}
            {/* Opening balance — the starting point every running balance builds on,
                shown at the very bottom (after the oldest entry) so the numbers make sense. */}
            {page === totalPages && (
              <div className="flex items-center gap-3 px-5 py-3 bg-secondary/40">
                <div className="h-8 w-8 rounded-lg grid place-items-center shrink-0 bg-primary/10 text-primary">
                  <History className="h-4 w-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium">Opening balance</p>
                  <p className="text-xs text-muted-foreground">Starting cash when this locker was created</p>
                </div>
                <p className="text-sm font-semibold text-right shrink-0">{fmtLockerAmount(selected.openingBalance || 0, selected.currency)}</p>
              </div>
            )}
            {filteredTxns.length === 0 && (
              <div className="px-5 py-8 text-center text-sm text-muted-foreground">
                {txns.length === 0 ? "No transactions yet — opening balance only." : "No transactions match this filter."}
              </div>
            )}
          </div>

          {totalPages > 1 && (
            <PaginationBar page={page} totalPages={totalPages} onPageChange={setPage} label={`Showing ${start + 1}–${end} of ${filteredTxns.length}`} />
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
            <div className="grid grid-cols-2 gap-3">
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
              <div>
                <Label className="text-xs">Currency</Label>
                <Select value={ef.currency} onValueChange={v => setEf({ ...ef, currency: v as "INR" | "USD" })}>
                  <SelectTrigger className="rounded-xl mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="INR">INR (₹)</SelectItem>
                    <SelectItem value="USD">USD ($)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            {ef.type === "bank" && (
              <div>
                <Label className="text-xs">Account Number (last 4, optional)</Label>
                <Input value={ef.accountNumberLast4} onChange={e => setEf({ ...ef, accountNumberLast4: e.target.value })} maxLength={4} className="rounded-xl mt-1" />
              </div>
            )}
            <div>
              <Label className="text-xs">Opening Balance ({ef.currency === "USD" ? "$" : "₹"})</Label>
              <Input type="number" min={0} value={ef.openingBalance} onChange={e => setEf({ ...ef, openingBalance: e.target.value })} className="rounded-xl mt-1" />
            </div>
            <div className="flex gap-2">
              <AsyncButton onClick={saveEditLocker} disabled={editSaving} className="btn-hero rounded-xl flex-1">{editSaving ? "Saving…" : "Save Changes"}</AsyncButton>
              <Button variant="outline" onClick={() => setEditId(null)} className="rounded-xl">Cancel</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Apply a loose income row to a client's bill (repairs a payment that was
          typed in as a plain locker entry and never reached their orders). */}
      <Dialog open={!!fixTxnId} onOpenChange={o => { if (!o) setFixTxnId(null); }}>
        <DialogContent className="max-w-md rounded-2xl">
          <DialogHeader><DialogTitle className="font-display text-xl">Apply to a client&rsquo;s bill</DialogTitle></DialogHeader>
          {(() => {
            const txn = db.lockerTransactions.find(t => t.id === fixTxnId);
            if (!txn) return null;
            const isUsd = (txn.currency ?? "INR") === "USD";
            const rate = Number(fixRate) || 0;
            const billed = isUsd ? txn.amountInr : (rate > 0 ? txn.amountInr / rate : 0);
            const invs = fixClientId
              ? (db.invoices ?? [])
                  .filter(i => i.clientId === fixClientId)
                  .map(i => ({ inv: i, bal: invLiveBalance(invoiceOrderIds(i)) }))
                  .sort((a, b) => +new Date(b.inv.createdAt) - +new Date(a.inv.createdAt))
              : [];
            return (
              <>
                <p className="text-sm text-muted-foreground -mt-1">
                  {fmtLockerAmount(txn.amountInr, txn.currency)} received on {fmtDate(txn.createdAt)} is already counted in this locker.
                  It was never applied to anyone&rsquo;s orders, which is why their invoice still shows as pending. No second
                  entry is made here — only the missing allocation.
                </p>
                <div className="space-y-2.5 mt-1">
                  <div>
                    <Label className="text-xs">Received from</Label>
                    <Select value={fixClientId} onValueChange={v => { setFixClientId(v); setFixInvoiceId(""); }}>
                      <SelectTrigger className="h-10 rounded-xl mt-1"><SelectValue placeholder="Choose the client" /></SelectTrigger>
                      <SelectContent>{clientsSorted.map(c => <SelectItem key={c.id} value={c.id}>{c.companyName}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  {fixClientId && (
                    <div>
                      <Label className="text-xs">Against</Label>
                      <Select value={fixInvoiceId || "fifo"} onValueChange={v => setFixInvoiceId(v === "fifo" ? "" : v)}>
                        <SelectTrigger className="h-10 rounded-xl mt-1"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="fifo">Oldest bills first</SelectItem>
                          {invs.map(({ inv, bal }) => (
                            <SelectItem key={inv.id} value={inv.id}>
                              Invoice {inv.number} — {bal > 0 ? `${fmtMoney(bal)} pending` : "settled"}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                  {!isUsd && (
                    <div>
                      <Label className="text-xs">Exchange rate — 1 USD = ₹ <span className="text-destructive">*</span></Label>
                      <Input type="number" min={0} step="0.01" value={fixRate} onChange={e => setFixRate(e.target.value)} className="rounded-xl h-10 mt-1" placeholder="e.g. 83.50" />
                    </div>
                  )}
                  {billed > 0 && <p className="text-[11px] text-muted-foreground">Settles {fmtMoney(billed)} of their billing.</p>}
                </div>
                <div className="flex gap-2 mt-4">
                  <Button variant="outline" onClick={() => setFixTxnId(null)} className="rounded-xl flex-1">Cancel</Button>
                  <Button onClick={applyIncome} disabled={!fixClientId} className="btn-hero rounded-xl flex-1">Apply</Button>
                </div>
              </>
            );
          })()}
        </DialogContent>
      </Dialog>

    </div>
  );
}
