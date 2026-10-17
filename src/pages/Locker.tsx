import { LockerCreateDialog } from "@/components/create/LockerCreateDialog";
import { DataTable, CellMain, CellTag, CellAmount, CellDate, type DataColumn } from "@/components/DataTable";
import { useCan } from "@/hooks/useCan";
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { loadDb, updateDb, uid, fmtMoney, fmtDate, balanceDue, invoiceOrderIds, settleClientAccount, collectionsLoaded, DEFAULT_LOCKER_CATEGORIES, type Locker, type LockerType, type LockerTransaction, type LockerTxnType, type Order } from "@/lib/db";
import { reserveVoucherNumber } from "@/lib/counters";
import { advanceIds, receiptForAdvance } from "@/lib/receipts";
import { useDb } from "@/hooks/useDb";
import { useLoaded } from "@/hooks/useLoaded";
import { ENTRY_COLS, listEntries, type MoneyEntry } from "@/lib/moneyEntries";
import { LOCKER_DELETE_COLS, lockerDeleteBlock } from "@/lib/lockerGuards";
import { CHECKING, STILL_LOADING, needsAccess, recordsReady } from "@/lib/actionHints";
import { MoneyEntryEditor, confirmDeleteEntry, entryRowActions } from "@/components/MoneyEntryEditor";
import { ApplyToClientDialog, applyBlock } from "@/components/ApplyToClientDialog";
import { MoreMenu, type MoreAction } from "@/components/MoreMenu";
import { useAuth } from "@/lib/auth";
import { lockerBalance } from "@/lib/manufacturing";
import { ccy, ccySymbol, fmtCcy, fmtCcyNumber, fmtCcyPdf, rateFields, rateOf, rateText, roundCcy, type CurrencyCode } from "@/lib/currency";
import { CurrencySelect, RateInput } from "@/components/CurrencyFields";
import { ActionSheet } from "@/components/ActionSheet";
import { Button } from "@/components/ui/button";
import { AsyncButton } from "@/components/AsyncButton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Landmark, Wallet, ArrowDownCircle, ArrowUpCircle, ArrowLeftRight, History, Pencil, Download, HandCoins, Power, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { motion } from "framer-motion";
import { downloadCsv, downloadLedgerPdf } from "@/lib/ledgerExport";
import { ExportDialog, inDateRange } from "@/components/ExportDialog";
import { confirmBox } from "@/lib/confirm";
import { IfExport } from "@/components/IfExport";
import { lockerTxnDetails } from "@/components/rowDetails";

/** Bare, signed number for PDF cells — the statement names its currency once
 *  at the top, and jsPDF can't draw ₹ anyway. */
function pdfNum(n: number, currency?: string): string {
  return `${n < 0 ? "-" : ""}${fmtCcyNumber(n, currency)}`;
}

/** A line of the ledger table. `t: null` is the opening balance — pinned under
 *  the oldest entry, never sorted or searched with the rest. */
type LedgerRow = { id: string; t: LockerTransaction | null };

const TXN_TYPE: Record<LockerTxnType, { label: string; tone: "green" | "red" | "blue" }> = {
  income: { label: "Income", tone: "green" },
  expense: { label: "Expense", tone: "red" },
  transfer_in: { label: "Transfer in", tone: "blue" },
  transfer_out: { label: "Transfer out", tone: "blue" },
};

export function LockerPage() {
  const { user } = useAuth();
  const db = useDb();
  const can = useCan();
  const [open, setOpen] = useState(false);

  // "View account" elsewhere opens this page on that account (?account=id).
  const [params] = useSearchParams();
  const [selectedId, setSelectedId] = useState<string | null>(() => params.get("account"));
  // Deactivated accounts stay on record; shown on request, so one can be
  // looked at or switched back on. Opened straight onto one, they show.
  const [showInactive, setShowInactive] = useState(() => {
    const want = params.get("account");
    return !!want && db.lockers.some(l => l.id === want && l.active === false);
  });
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
  // The fallback is db.ts's list, shared with Payments and Settings → Categories.
  const lockerCats = db.settings.lockerCategories?.length
    ? db.settings.lockerCategories
    : DEFAULT_LOCKER_CATEGORIES;
  const [txnNote, setTxnNote] = useState("");
  const [txnTargetLocker, setTxnTargetLocker] = useState("");
  // "1 from = rate to": for a transfer, this locker → the destination; for a
  // client's payment, 1 USD in this locker's currency. Cleared whenever the
  // pair changes, so a rate typed for one pair is never saved for another.
  const [txnExchangeRate, setTxnExchangeRate] = useState<number | "">("");
  // Income can be a REAL client payment rather than a loose cash entry: pick the
  // client (and the invoice it settles) and the money is allocated to their
  // orders, instead of sitting in the locker while the invoice still reads unpaid.
  const [txnClientId, setTxnClientId] = useState("");
  const [txnInvoiceId, setTxnInvoiceId] = useState("");
  // Repairing an income row that was typed in as a loose entry when it was
  // really a client payment — the cash is already in the locker, only the
  // allocation to their orders is missing. (src/components/ApplyToClientDialog.tsx)
  const [fixTxnId, setFixTxnId] = useState<string | null>(null);
  // Correcting a row of the ledger — the panel Payments' ledgers use.
  const [editingEntry, setEditingEntry] = useState<MoneyEntry | null>(null);

  const lockers = db.lockers.filter(l => l.active !== false);
  const inactiveLockers = db.lockers.filter(l => l.active === false);
  const shownLockers = showInactive ? [...lockers, ...inactiveLockers] : lockers;
  // The ledger is the page, so one locker is always open: the one picked, or
  // the first. Resolved on every render, so it still lands on an account when
  // the lockers arrive a moment after the page.
  const selected = shownLockers.find(l => l.id === selectedId) ?? lockers[0] ?? shownLockers[0] ?? null;
  const selectedInactive = selected?.active === false;

  // What each ledger row belongs to — a supplier's payment, an expense, a
  // diamond sale — decides whether it is corrected here or where it was made.
  // Those books are not this page's (pageData.ts): they are asked for only
  // once a row's ⋯ is opened, and until they are here its items are greyed
  // "Checking…" — never loaded on every visit to the Locker.
  const [wantEntries, setWantEntries] = useState(false);
  useLoaded(wantEntries ? ENTRY_COLS.locker : []);
  const entriesReady = collectionsLoaded(ENTRY_COLS.locker);
  const entryById = new Map(entriesReady ? listEntries(db, "locker").map(e => [e.id, e] as const) : []);

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




  // ── Edit locker ──
  const [editId, setEditId] = useState<string | null>(null);
  const [ef, setEf] = useState<{ name: string; type: LockerType; currency: CurrencyCode; accountNumberLast4: string; openingBalance: string }>({
    name: "", type: "bank", currency: "INR", accountNumberLast4: "", openingBalance: "0",
  });
  const [editSaving, setEditSaving] = useState(false);
  // Every entry on a locker is in its currency, so once it has any the
  // currency is fixed — changing it would re-read all of them as another money.
  const editHasEntries = !!editId && (db.lockerTransactions ?? []).some(t => t.lockerId === editId);

  const openEditLocker = (l: typeof lockers[number]) => {
    setEditId(l.id);
    setEf({ name: l.name, type: l.type, currency: ccy(l.currency), accountNumberLast4: l.accountNumberLast4 || "", openingBalance: String(l.openingBalance) });
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
        if (!(d.lockerTransactions ?? []).some(t => t.lockerId === l.id)) l.currency = ef.currency;
        l.accountNumberLast4 = ef.accountNumberLast4.trim() || undefined;
        l.openingBalance = Math.max(0, Number(ef.openingBalance) || 0);
      });
      toast.success("Locker updated");
      setEditId(null);
    } finally { setEditSaving(false); }
  };

  // ── Deactivate / activate / delete a locker ──
  // `active` is read everywhere (every account picker leaves an inactive one
  // out) but nothing ever set it. Deactivating is how an account with history
  // is retired: its entries and balance stay in the books.
  const setActive = async (l: Locker, active: boolean) => {
    if (!active) {
      const bal = lockerBalance(l, db.lockerTransactions);
      const ok = await confirmBox([
        `Deactivate ${l.name}?`, "",
        "• it is no longer offered when money is paid, received or transferred",
        "• its entries stay on record, and every report still counts them",
        ...(Math.abs(bal) > 0.005 ? [`• it still holds ${fmtCcy(bal, l.currency)} — move that out first if the money is elsewhere now`] : []),
        "• you can activate it again any time",
      ], { confirmText: "Deactivate" });
      if (!ok) return;
    }
    updateDb(d => { const x = d.lockers.find(y => y.id === l.id); if (x) x.active = active; });
    toast.success(active ? `${l.name} is active again` : `${l.name} deactivated`);
    if (!active && selected?.id === l.id && !showInactive) setSelectedId(null);
  };

  const deleteLocker = async (l: Locker) => {
    // Everything that could name the account is loaded and counted first —
    // the card's menu only knew what this page had.
    if (!(await recordsReady(LOCKER_DELETE_COLS))) { toast.error(STILL_LOADING); return; }
    const fresh = loadDb();
    const block = lockerDeleteBlock(fresh, l.id);
    if (block) { toast.error(`${l.name}: ${block}`); return; }
    const ok = await confirmBox([
      `Delete ${l.name}?`, "",
      "• the account is removed for good",
      ...(l.openingBalance ? [`• its opening balance of ${fmtCcy(l.openingBalance, l.currency)} goes with it`] : []),
      "• nothing has ever gone through it, so no balance, payment or report changes",
    ]);
    if (!ok) return;
    let gone = false;
    updateDb(d => {
      // Counted again on the live records: money may have gone through it
      // while the question was open.
      if (lockerDeleteBlock(d, l.id)) return;
      d.lockers = d.lockers.filter(x => x.id !== l.id);
      gone = true;
    });
    if (!gone) { toast.error(`Could not delete ${l.name} — something went through it meanwhile`); return; }
    toast.success(`${l.name} deleted`);
    if (selected?.id === l.id) setSelectedId(null);
  };

  /** A card's ⋯ — what can be done to the account, each greyed with the reason when it can't. */
  const lockerActions = (l: Locker): MoreAction[] => {
    const mayEdit = can("locker", "edit"), mayDelete = can("locker", "delete");
    const block = lockerDeleteBlock(db, l.id);
    return [
      { label: "Edit", icon: Pencil, onSelect: () => openEditLocker(l), disabled: !mayEdit, hint: mayEdit ? "Name, type, number, opening balance" : needsAccess("locker", "edit") },
      l.active === false
        ? { label: "Activate", icon: Power, onSelect: () => setActive(l, true), disabled: !mayEdit, hint: mayEdit ? "Offer it for payments again" : needsAccess("locker", "edit") }
        : { label: "Deactivate", icon: Power, onSelect: () => setActive(l, false), disabled: !mayEdit, hint: mayEdit ? "Hide it from every account picker — asks first" : needsAccess("locker", "edit") },
      { label: "Delete", icon: Trash2, danger: true, onSelect: () => deleteLocker(l),
        disabled: !mayDelete || !!block, hint: !mayDelete ? needsAccess("locker", "delete") : block ?? "Only an account nothing has gone through — asks first" },
    ];
  };

  /** A client payment entered here, waiting for its receipt number. */
  type ClientReceiptDraft = { clientId: string; amountUsd: number; method: string; advanceIds: string[] };

  const recordTxn = async () => {
    if (!selected) return;
    const amt = Number(txnAmount);
    if (!amt || amt <= 0) { toast.error("Enter a valid amount"); return; }
    if (txnType !== "transfer_out" && !txnCategory) { toast.error("Choose a category"); return; }
    if (txnType === "transfer_out" && !txnTargetLocker) { toast.error("Choose a destination locker"); return; }
    const target = txnType === "transfer_out" ? lockers.find(l => l.id === txnTargetLocker) : undefined;
    const currency = ccy(selected.currency);
    const targetCcy = target ? ccy(target.currency) : currency;
    const crossCurrency = !!target && targetCcy !== currency;
    const rate = Number(txnExchangeRate);
    if (crossCurrency && (!rate || rate <= 0)) { toast.error("Enter a valid exchange rate"); return; }
    // A non-dollar locker taking a USD-billed client payment needs the rate to
    // know how much of their bill this actually settles.
    if (txnType === "income" && txnClientId && currency !== "USD" && (!rate || rate <= 0)) {
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
        const ok = (await confirmBox(
          `This ${txnType === "expense" ? "expense" : "transfer"} of ${fmtCcy(amt, currency)} is more than ${selected.name}'s balance of ${fmtCcy(bal, currency)} ${currency}.\n\nThe balance will go negative. Continue only if you're sure a deposit is still missing.`,
        ));
        if (!ok) return;
      }
    }
    const now = new Date().toISOString();
    // Everything that can refuse this entry is checked BEFORE the voucher
    // number is claimed. A number taken and then not used leaves a hole in the
    // book that nothing closes — which is exactly how the invoice sequence
    // ended up missing five numbers.
    if (txnType === "transfer_out" && !db.lockers.find(l => l.id === txnTargetLocker)) {
      toast.error("That destination locker couldn't be found — pick it again and retry.");
      return;
    }

    // A voucher number is what a person quotes when they refer to a cash entry.
    // Reserved in the database, so two people banking at once cannot share one.
    const voucher = await reserveVoucherNumber(db.lockerTransactions ?? []);
    const clientTxnId = uid("ltx_");
    // A holder rather than a plain variable: it is filled inside updateDb's
    // callback, which TypeScript's flow analysis cannot follow.
    const receiptFor: { draft: ClientReceiptDraft | null } = { draft: null };
    const xferId = uid("xfer_");
    updateDb(d => {
      if (!d.lockerTransactions) d.lockerTransactions = [];
      if (txnType === "transfer_out") {
        const target = d.lockers.find(l => l.id === txnTargetLocker);
        if (!target) return;
        // Any two currencies: the rate is "1 of this locker's = rate of the
        // destination's", so what arrives is simply amount × rate.
        const destAmount = crossCurrency ? roundCcy(amt * rate, targetCcy) : amt;
        // The same rate on both legs ({fx}, plus the old ₹-per-$ figure for a
        // rupee/dollar pair); nothing at all on a same-currency transfer.
        const fx = crossCurrency ? rateFields(currency, targetCcy, rate) : {};
        d.lockerTransactions.push({
          id: uid("ltx_"), lockerId: selected.id, type: "transfer_out", amountInr: amt, currency,
          category: "Transfer", refType: "transfer", transferId: xferId, voucherNo: voucher, pairedLockerId: target.id, note: txnNote.trim() || undefined,
          ...fx,
          recordedBy: user!.id, createdAt: now,
        });
        d.lockerTransactions.push({
          id: uid("ltx_"), lockerId: target.id, type: "transfer_in", amountInr: destAmount, currency: targetCcy,
          category: "Transfer", refType: "transfer", transferId: xferId, voucherNo: voucher, pairedLockerId: selected.id, note: txnNote.trim() || undefined,
          ...fx,
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
          // currency, so any other locker converts back through the entered
          // rate (this locker's currency for $1 — what exchangeRate means here).
          const billed = currency === "USD" ? amt : (rate > 0 ? Math.round((amt / rate) * 100) / 100 : 0);
          const noteText = txnNote.trim() || undefined;
          const beforeIds = advanceIds(d, payClient.id);
          const leftover = settleClientAccount(d, payClient.id, billed, user!.id, now, noteText, txnInvoiceId || undefined);
          // A client payment is a numbered receipt wherever it is entered.
          receiptFor.draft = {
            clientId: payClient.id, amountUsd: billed, method: noteText || "Payment received",
            advanceIds: [...advanceIds(d, payClient.id)].filter(x => !beforeIds.has(x)),
          };
          d.lockerTransactions.push({
            id: clientTxnId, lockerId: selected.id, type: "income", amountInr: amt, currency,
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
    let receiptNo = "";
    const rf = receiptFor.draft;
    if (rf) {
      try {
        const r = await receiptForAdvance({
          clientId: rf.clientId, advanceIds: rf.advanceIds,
          amountUsd: rf.amountUsd, date: now, method: rf.method,
          lockerTxnId: clientTxnId, userId: user!.id,
        });
        receiptNo = ` · ${r.receiptNo}`;
      } catch {
        toast.error("Entry saved, but its receipt number could not be reserved");
      }
    }
    toast.success(`Transaction recorded${receiptNo}`);
    setTxnAmount(""); setTxnCategory(""); setTxnNote(""); setTxnTargetLocker(""); setTxnExchangeRate(""); setTxnClientId(""); setTxnInvoiceId(""); setTxnMode(false);
  };

  /** A ledger row's ⋯: apply loose money to a client's bill, correct or cancel
   *  it — or, for a row made by another record, where that is done. */
  const rowActionsFor = (t: LockerTransaction): MoreAction[] => {
    const e = entryById.get(t.id);
    // Applying loose money to a bill is the Locker's own action, as it always
    // was. Correcting or cancelling the entry is the same act as in Payments →
    // Account entries and the day book, so it asks the same access — the same
    // row is never editable by one role on one page and not on another.
    const mayApply = can("locker", "edit");
    const mayEdit = can("payments", "edit"), mayDelete = can("payments", "delete");
    const owned = e?.locked ? (e.lockedWhere ?? "another tab") : undefined;
    const notYet = !e ? CHECKING : undefined;
    const why = !mayApply ? needsAccess("locker", "edit") : notYet ?? applyBlock(t, owned);
    return [
      { label: "Apply to a client’s bill", icon: HandCoins, hint: why ?? "Money a client sent — settle their bill with it",
        disabled: !!why, show: t.type === "income" && t.refType !== "clientPayment",
        onSelect: () => setFixTxnId(t.id) },
      ...entryRowActions(e, {
        mayEdit, mayDelete,
        editNeeds: needsAccess("payments", "edit"), deleteNeeds: needsAccess("payments", "delete"),
        onEdit: setEditingEntry,
        onDelete: x => { void confirmDeleteEntry(db, x); },
      }),
    ];
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

  const totalIn = txns.filter(t => t.type === "income" || t.type === "transfer_in").reduce((s, t) => s + t.amountInr, 0);
  const totalOut = txns.filter(t => t.type === "expense" || t.type === "transfer_out").reduce((s, t) => s + t.amountInr, 0);

  const txnLabel = (t: (typeof txns)[number]) =>
    t.category || t.note || (t.type === "transfer_in" ? "Transfer in" : t.type === "transfer_out" ? "Transfer out" : t.type);
  const txnSigned = (t: (typeof txns)[number]) => (t.type === "income" || t.type === "transfer_in" ? t.amountInr : -t.amountInr);

  // The rate an entry moved money at, the way people say it ("1 AUD = ₹55.2"),
  // or "" when no currency changed hands. Older rows carry only exchangeRate
  // (₹ per $); rateOf reads either.
  const rateLabel = (t: LockerTransaction): string => {
    const own = ccy(t.currency ?? selected?.currency);
    let from: CurrencyCode, to: CurrencyCode, r: number | undefined;
    if (t.type === "transfer_in" || t.type === "transfer_out") {
      // The other leg's currency is its locker's; failing that, whatever the
      // recorded rate names (an older rupee/dollar row: the other of the two).
      const paired = db.lockers.find(l => l.id === t.pairedLockerId);
      const other = paired ? ccy(paired.currency)
        : t.fx ? (ccy(t.fx.from) === own ? ccy(t.fx.to) : ccy(t.fx.from))
        : t.exchangeRate ? (own === "USD" ? "INR" : "USD") : own;
      [from, to] = t.type === "transfer_out" ? [own, other] : [other, own];
      r = rateOf(t, from, to);
    } else if (t.refType === "clientPayment") {
      // A client's dollars landing here: exchangeRate is this locker's currency for $1.
      [from, to] = ["USD", own];
      r = rateOf(t, from, to) ?? t.exchangeRate;
    } else if (t.fx) {
      [from, to, r] = [t.fx.from, t.fx.to, t.fx.rate];
    } else if (t.exchangeRate) {
      [from, to, r] = ["USD", "INR", t.exchangeRate];
    } else return "";
    return r && ccy(from) !== ccy(to) ? rateText(from, to, r) : "";
  };

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

  // ── The ledger table ──
  const isIn = (t: LockerTransaction) => t.type === "income" || t.type === "transfer_in";
  const typeOf = (t: LockerTransaction) => TXN_TYPE[t.type] ?? { label: t.type, tone: "neutral" as const };
  const ledgerRows: LedgerRow[] = filteredTxns.map(t => ({ id: t.id, t }));
  const openingRow: LedgerRow = { id: "__opening", t: null };
  const ledgerSum = (rows: LedgerRow[], credit: boolean) => rows.reduce((s, r) => s + (r.t && isIn(r.t) === credit ? r.t.amountInr : 0), 0);
  const ledgerColumns: DataColumn<LedgerRow>[] = [
    { key: "date", header: "Date", always: true, kind: "date", sortValue: r => r.t?.createdAt,
      cell: r => (r.t ? <CellDate>{fmtDate(r.t.createdAt)}</CellDate> : null) },
    { key: "particulars", header: "Particulars", always: true, sortValue: r => (r.t ? txnLabel(r.t) : ""),
      cell: r => {
        const t = r.t;
        if (!t) return (
          <div className="flex items-center gap-2.5">
            <div className="h-8 w-8 rounded-lg grid place-items-center shrink-0 bg-primary/10 text-primary"><History className="h-4 w-4" /></div>
            <CellMain title="Opening balance" sub="Starting cash when this locker was created" />
            {/* A pinned row has no ⋯ of its own, so its one action sits here:
                the opening balance is the locker's, corrected in its editor. */}
            {selected && (
              <button type="button" data-no-row onClick={e => { e.stopPropagation(); openEditLocker(selected); }}
                disabled={!can("locker", "edit")}
                title={can("locker", "edit") ? "Edit opening balance" : needsAccess("locker", "edit")}
                aria-label="Edit opening balance"
                className="not-italic ml-1 inline-flex items-center gap-1 h-7 px-2 rounded-lg text-[11px] font-medium text-primary hover:bg-primary/10 disabled:text-muted-foreground disabled:hover:bg-transparent disabled:cursor-not-allowed shrink-0">
                <Pencil className="h-3 w-3" /> Edit
              </button>
            )}
          </div>
        );
        return (
          <div className="flex items-center gap-2.5">
            <div className={`h-8 w-8 rounded-lg grid place-items-center shrink-0 ${isIn(t) ? "bg-success/10 text-success" : "bg-destructive/10 text-destructive"}`}>
              {t.type === "transfer_in" || t.type === "transfer_out"
                ? <ArrowLeftRight className="h-4 w-4" />
                : t.type === "income" ? <ArrowDownCircle className="h-4 w-4" /> : <ArrowUpCircle className="h-4 w-4" />}
            </div>
            {/* The note goes underneath only when the category already titles the line. */}
            <CellMain title={`${txnLabel(t)}${rateLabel(t) ? ` (@ ${rateLabel(t)})` : ""}`}
              sub={[t.voucherNo, t.category ? t.note : ""].filter(Boolean).join(" · ") || undefined} />
          </div>
        );
      } },
    { key: "type", header: "Type", sortValue: r => (r.t ? typeOf(r.t).label : ""),
      cell: r => (r.t ? <CellTag tone={typeOf(r.t).tone}>{typeOf(r.t).label}</CellTag> : null) },
    { key: "debit", header: "Debit", align: "right", kind: "number", sortValue: r => (r.t && !isIn(r.t) ? r.t.amountInr : null),
      cell: r => (r.t && !isIn(r.t) ? <CellAmount tone="out">{fmtCcy(r.t.amountInr, r.t.currency ?? selected?.currency)}</CellAmount> : null) },
    { key: "credit", header: "Credit", align: "right", kind: "number", sortValue: r => (r.t && isIn(r.t) ? r.t.amountInr : null),
      cell: r => (r.t && isIn(r.t) ? <CellAmount tone="in">{fmtCcy(r.t.amountInr, r.t.currency ?? selected?.currency)}</CellAmount> : null) },
    // Each entry's balance at the time, from the full history — a filter never changes it.
    { key: "balance", header: "Balance", align: "right", kind: "number", sortValue: r => (r.t ? txnBalances.get(r.t.id) ?? 0 : null),
      cell: r => <CellAmount>{fmtCcy(r.t ? txnBalances.get(r.t.id) ?? 0 : selected?.openingBalance || 0, selected?.currency)}</CellAmount> },
  ];

  const exportCsv = (from: Date | null, to: Date | null) => {
    if (!selected) return;
    const cur = ccy(selected.currency);
    downloadCsv(
      `Locker-${selected.name.replace(/\s+/g, "_")}`,
      ["Date", "Description", `Money In (${cur})`, `Money Out (${cur})`, `Balance (${cur})`],
      txns.filter(t => inDateRange(t.createdAt, from, to)).map(t => {
        const signed = txnSigned(t);
        // Rounded to the currency's cents: adding up dollar or euro amounts
        // leaves float noise (…0000000004) on a running total.
        return [fmtDate(t.createdAt), txnLabel(t), signed > 0 ? signed : "", signed < 0 ? -signed : "", roundCcy(txnBalances.get(t.id) ?? 0, cur)];
      }),
    );
  };

  const exportPdf = (from: Date | null, to: Date | null) => {
    if (!selected) return;
    const cur = ccy(selected.currency);
    downloadLedgerPdf({
      title: "Locker Account Statement",
      subjectLines: [
        `Account: ${selected.name}${selected.type === "bank" && selected.accountNumberLast4 ? ` (····${selected.accountNumberLast4})` : ""}`,
        `Type: ${selected.type === "bank" ? "Bank" : "Cash"} · Currency: ${cur}`,
        `Opening Balance: ${fmtCcyPdf(selected.openingBalance || 0, cur)}`,
        `Report Generated: ${new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}`,
      ],
      summary: [
        { label: "Current Balance", value: fmtCcyPdf(lockerBalance(selected, db.lockerTransactions), cur) },
        { label: "Total In", value: fmtCcyPdf(totalIn, cur) },
        { label: "Total Out", value: fmtCcyPdf(totalOut, cur) },
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
          signed > 0 ? pdfNum(signed, cur) : "—",
          signed < 0 ? pdfNum(-signed, cur) : "—",
          pdfNum(txnBalances.get(t.id) ?? 0, cur),
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
        {can("locker", "add") && (
          <>
            <Button onClick={() => setOpen(true)} className="btn-hero h-10 rounded-xl"><Plus className="h-4 w-4 mr-2" />New Locker</Button>
            <LockerCreateDialog open={open} onOpenChange={setOpen} />
          </>
        )}
      </div>

      {/* The accounts, compact: picking one opens its ledger below. On a phone
          they scroll sideways inside their own row, so the ledger stays near the top. */}
      <div className="flex gap-3 overflow-x-auto no-scrollbar p-0.5 sm:p-0 sm:grid sm:grid-cols-2 lg:grid-auto-tiles sm:overflow-visible">
        {shownLockers.map(l => {
          const bal = lockerBalance(l, db.lockerTransactions);
          const isSelected = selected?.id === l.id;
          const off = l.active === false;
          return (
            <div
              key={l.id}
              role="button"
              tabIndex={0}
              aria-pressed={isSelected}
              onClick={() => { setSelectedId(l.id); setTxnMode(false); setTxnExchangeRate(""); }}
              onKeyDown={e => { if (e.key === "Enter" && e.target === e.currentTarget) { setSelectedId(l.id); setTxnMode(false); setTxnExchangeRate(""); } }}
              className={`card-luxe shrink-0 flex-1 min-w-[15rem] sm:min-w-0 px-4 py-3.5 text-left transition-all cursor-pointer relative ${isSelected ? "ring-2 ring-primary" : "hover:shadow-md"} ${off ? "opacity-70" : ""}`}
            >
              {/* The account's own menu. Its clicks (portalled, but still bubbling
                  through React) must not also pick the card. */}
              <div className="absolute top-2.5 right-2.5" onClick={e => e.stopPropagation()} onKeyDown={e => e.stopPropagation()}>
                <MoreMenu size="sm" label={`Actions for ${l.name}`} actions={lockerActions(l)} />
              </div>
              <div className="flex items-center gap-2.5 pr-9">
                <div className="h-9 w-9 rounded-xl bg-gradient-to-br from-primary/15 to-brand-light/20 grid place-items-center shrink-0">
                  {l.type === "bank" ? <Landmark className="h-4 w-4 text-primary" /> : <Wallet className="h-4 w-4 text-primary" />}
                </div>
                <div className="min-w-0">
                  <p className="font-medium text-brand-dark truncate leading-tight">{l.name}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {l.type === "bank" ? `Bank${l.accountNumberLast4 ? ` ····${l.accountNumberLast4}` : ""}` : "Cash"} · {ccy(l.currency)}{off ? " · Inactive" : ""}
                  </p>
                </div>
              </div>
              <p className={`mt-2.5 text-xl font-display font-bold tabular-nums leading-tight ${bal < 0 ? "text-destructive" : "text-brand-dark"}`}>{fmtCcy(bal, l.currency)}</p>
            </div>
          );
        })}
        {shownLockers.length === 0 && (
          <div className="w-full sm:col-span-full card-luxe p-12 text-center text-muted-foreground">
            {inactiveLockers.length ? "Every account is deactivated — show them below to switch one back on." : "No lockers yet — add your first bank/cash account."}
          </div>
        )}
      </div>
      {inactiveLockers.length > 0 && (
        <button type="button" onClick={() => setShowInactive(v => !v)} aria-pressed={showInactive}
          className="-mt-2 text-xs font-medium text-primary hover:underline">
          {showInactive ? "Hide inactive accounts" : `Show inactive accounts (${inactiveLockers.length})`}
        </button>
      )}

      {selected && (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="card-luxe p-4 sm:p-5 space-y-4">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-xl bg-success/10 grid place-items-center shrink-0">
                <History className="h-5 w-5 text-success" />
              </div>
              <div>
                <h3 className="font-display text-lg text-brand-dark">{selected.name} — Ledger</h3>
                <p className="text-xs text-muted-foreground">
                  {filtersActive ? `${filteredTxns.length} of ${txns.length} transactions` : `${txns.length} transaction${txns.length !== 1 ? "s" : ""}`}
                  {selectedInactive ? " · inactive — activate it to record entries" : ""}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <IfExport>
              <Button variant="outline" onClick={() => setShowExport(true)} className="rounded-xl gap-2"><Download className="h-4 w-4" /> Export</Button>
              </IfExport>
              <ExportDialog open={showExport} onClose={() => setShowExport(false)} title={selected ? `${selected.name} ledger` : "locker"} options={[
                { label: "Ledger — PDF", sublabel: "Transactions with running balance", kind: "pdf", run: exportPdf },
                { label: "Ledger — Excel", sublabel: "Transactions with running balance", kind: "excel", run: exportCsv },
              ]} />
              {can("locker", "add") && (
                // A deactivated account takes no new money — greyed, saying why.
                <Button onClick={() => setTxnMode(true)} disabled={selectedInactive}
                  title={selectedInactive ? "Inactive — activate it from its card's ⋯ to record entries" : undefined}
                  className="btn-hero rounded-xl gap-2">
                  <Plus className="h-4 w-4" /> Record Transaction
                </Button>
              )}
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="p-3 rounded-xl bg-secondary text-center">
              <p className="text-xs text-muted-foreground mb-1">Balance</p>
              <p className="font-semibold text-sm">{fmtCcy(lockerBalance(selected, db.lockerTransactions), selected.currency)}</p>
            </div>
            <div className="p-3 rounded-xl bg-success/8 border border-success/20 text-center">
              <p className="text-xs text-muted-foreground mb-1">Total In</p>
              <p className="font-semibold text-sm text-success">{fmtCcy(totalIn, selected.currency)}</p>
            </div>
            <div className="p-3 rounded-xl bg-destructive/5 border border-destructive/20 text-center">
              <p className="text-xs text-muted-foreground mb-1">Total Out</p>
              <p className="font-semibold text-sm text-destructive">{fmtCcy(totalOut, selected.currency)}</p>
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

          {/* Opening balance — the starting point every running balance builds on —
              pinned at the very bottom (after the oldest entry) so the numbers make sense.
              A new locker or filter starts the table again from its newest entry. */}
          <DataTable
            resetKey={`${selected.id}|${filterFrom}|${filterTo}|${filterType}`}
            id="locker-ledger"
            noun="transaction"
            rows={ledgerRows}
            columns={ledgerColumns}
            rowKey={r => r.id}
            defaultSort={{ key: "date", dir: "desc" }}
            pinnedRows={[openingRow]}
            searchText={r => (r.t ? [txnLabel(r.t), r.t.note, r.t.voucherNo, typeOf(r.t).label].filter(Boolean).join(" ") : "")}
            searchPlaceholder="Search this ledger"
            totals={{
              debit: rows => <span className="text-destructive">{fmtCcy(ledgerSum(rows, false), selected.currency)}</span>,
              credit: rows => <span className="text-success">{fmtCcy(ledgerSum(rows, true), selected.currency)}</span>,
            }}
            // Every row: correct or cancel it here, or — made by another record —
            // where that is done, greyed with the reason. The opening row is the
            // locker's own (its Edit sits in the row).
            rowActions={r => (r.t ? rowActionsFor(r.t) : [])}
            onRowActionsOpen={() => setWantEntries(true)}
            // Opened: the voucher and note on their own lines, who recorded it and
            // when, the other account of a transfer and its rate, and whatever it
            // settled — a client's receipt, supplier bills, factory jobs, an expense.
            // The category already titles the line; with none, the note does.
            details={r => (r.t ? lockerTxnDetails(db, r.t, m => can(m), { voucher: true, note: !!r.t.category }) : [])}
            emptyText={txns.length === 0 ? "No transactions yet — opening balance only." : "No transactions match this filter."}
          />
        </motion.div>
      )}

      {/* Record Transaction slides in over the ledger instead of pushing it down,
          so the entry being matched stays in view. Closing it keeps what was
          typed (as Cancel always did); saving clears it. */}
      {selected && (() => {
        const sym = ccySymbol(selected.currency).trim();
        const amt = Number(txnAmount) || 0;
        const bal = lockerBalance(selected, db.lockerTransactions);
        const after = bal + (txnType === "income" ? amt : -amt);
        return (
          <ActionSheet open={txnMode} onOpenChange={setTxnMode} size="md"
            icon={selected.type === "bank" ? Landmark : Wallet}
            title="Record Transaction"
            description={<>{selected.name} · {ccy(selected.currency)} · balance {fmtCcy(bal, selected.currency)}</>}
            footer={
              <div className="space-y-3">
                {amt > 0 && (
                  <div className="flex items-end justify-between gap-3 flex-wrap">
                    <div className="min-w-0">
                      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                        {txnType === "income" ? "Money in" : txnType === "expense" ? "Money out" : "Transfer out"}
                      </p>
                      <p className={`font-display text-xl font-bold tabular-nums leading-tight ${txnType === "income" ? "text-success" : "text-destructive"}`}>{fmtCcy(amt, selected.currency)}</p>
                    </div>
                    <p className="text-xs text-muted-foreground text-right">
                      Balance after <span className={`font-semibold ${after < 0 ? "text-destructive" : "text-foreground"}`}>{fmtCcy(after, selected.currency)}</span>
                    </p>
                  </div>
                )}
                <div className="flex items-center justify-end gap-2">
                  <Button variant="outline" onClick={() => setTxnMode(false)} className="rounded-xl h-10 flex-1 sm:flex-none">Cancel</Button>
                  <AsyncButton onClick={recordTxn} className="btn-hero rounded-xl h-10 flex-1 sm:flex-none sm:px-8">Save</AsyncButton>
                </div>
              </div>
            }>
            <div className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">Type</Label>
                  <Select value={txnType} onValueChange={v => { setTxnType(v as typeof txnType); setTxnExchangeRate(""); }}>
                    <SelectTrigger className="h-10 rounded-xl mt-1"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="income">Income (money in)</SelectItem>
                      <SelectItem value="expense">Expense (money out)</SelectItem>
                      <SelectItem value="transfer_out">Transfer to another locker</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs">Amount ({sym})</Label>
                  <Input type="number" min={1} value={txnAmount} onChange={e => setTxnAmount(e.target.value)} className="rounded-xl h-10 mt-1" placeholder={`Amount (${sym})`} />
                </div>
                {txnType === "transfer_out" ? (
                  <div>
                    <Label className="text-xs">To locker *</Label>
                    <Select value={txnTargetLocker} onValueChange={v => { setTxnTargetLocker(v); setTxnExchangeRate(""); }}>
                      <SelectTrigger className="h-10 rounded-xl mt-1"><SelectValue placeholder="Destination locker" /></SelectTrigger>
                      <SelectContent>
                        {lockers.filter(l => l.id !== selected.id).map(l => {
                          const sameCcy = ccy(l.currency) === ccy(selected.currency);
                          return <SelectItem key={l.id} value={l.id}>{l.name} {sameCcy ? "(same currency)" : `(${ccy(l.currency)})`}</SelectItem>;
                        })}
                      </SelectContent>
                    </Select>
                  </div>
                ) : (
                  <div>
                    <Label className="text-xs">Category <span className="text-destructive">*</span></Label>
                    <Select value={txnCategory} onValueChange={setTxnCategory}>
                      <SelectTrigger className="h-10 rounded-xl mt-1"><SelectValue placeholder="Category *" /></SelectTrigger>
                      <SelectContent>{lockerCats.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                )}
                <div>
                  <Label className="text-xs">Note</Label>
                  <Input value={txnNote} onChange={e => setTxnNote(e.target.value)} className="rounded-xl h-10 mt-1" placeholder="Note (optional)" />
                </div>
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
                  {txnClientId && ccy(selected.currency) !== "USD" && (
                    // The client is billed in dollars: how many of this locker's
                    // currency one dollar was — what turns the amount into their bill.
                    <RateInput id="txn-client-rate" from="USD" to={ccy(selected.currency)}
                      value={txnExchangeRate} onChange={setTxnExchangeRate} />
                  )}
                  {txnClientId && (
                    <p className="text-[11px] text-muted-foreground">
                      {(() => {
                        const amt = Number(txnAmount) || 0;
                        const r = Number(txnExchangeRate) || 0;
                        const billed = ccy(selected.currency) === "USD" ? amt : (r > 0 ? amt / r : 0);
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
                const fromCcy = ccy(selected.currency), toCcy = ccy(target.currency);
                if (fromCcy === toCcy) return null;
                return (
                  <div className="p-3 rounded-xl bg-secondary space-y-2">
                    {/* Shows what the amount becomes in the destination's currency. */}
                    <RateInput id="txn-transfer-rate" from={fromCcy} to={toCcy}
                      value={txnExchangeRate} onChange={setTxnExchangeRate} amount={amt || undefined} />
                    {!(Number(txnExchangeRate) > 0) && (
                      <p className="text-xs text-muted-foreground">
                        {target.name} holds {toCcy}, this locker {fromCcy} — enter the rate; it is required before you can save this transfer.
                      </p>
                    )}
                  </div>
                );
              })()}
            </div>
          </ActionSheet>
        );
      })()}

      <Dialog open={!!editId} onOpenChange={open => !open && setEditId(null)}>
        <DialogContent className="max-w-2xl rounded-2xl">
          <DialogHeader><DialogTitle className="font-display text-2xl">Edit Locker</DialogTitle></DialogHeader>
          <div className="dlg-cols mt-2">
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
                <CurrencySelect value={ef.currency} onChange={v => setEf({ ...ef, currency: v })} disabled={editHasEntries} className="rounded-xl mt-1" />
                {editHasEntries && (
                  <p className="text-[11px] text-muted-foreground mt-1">Fixed — this locker&rsquo;s entries are all in {ef.currency}.</p>
                )}
              </div>
            </div>
            {ef.type === "bank" && (
              <div>
                <Label className="text-xs">Account Number (last 4, optional)</Label>
                <Input value={ef.accountNumberLast4} onChange={e => setEf({ ...ef, accountNumberLast4: e.target.value })} maxLength={4} className="rounded-xl mt-1" />
              </div>
            )}
            <div>
              <Label className="text-xs">Opening Balance ({ccySymbol(ef.currency).trim()})</Label>
              <Input type="number" min={0} value={ef.openingBalance} onChange={e => setEf({ ...ef, openingBalance: e.target.value })} className="rounded-xl mt-1" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditId(null)} className="rounded-xl">Cancel</Button>
            <AsyncButton onClick={saveEditLocker} disabled={editSaving} className="btn-hero rounded-xl px-6">{editSaving ? "Saving…" : "Save Changes"}</AsyncButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Apply a loose income row to a client's bill (repairs a payment that was
          typed in as a plain locker entry and never reached their orders). */}
      <ApplyToClientDialog txnId={fixTxnId} onClose={() => setFixTxnId(null)} />

      {/* Correcting a ledger row — the same panel as Payments' ledgers. */}
      <MoneyEntryEditor entry={editingEntry} onClose={() => setEditingEntry(null)} mayDelete={can("payments", "delete")} />

    </div>
  );
}
