import { useCan } from "@/hooks/useCan";
import { useState } from "react";
import { Lock, Pencil, Trash2 } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { useDb } from "@/hooks/useDb";
import { fmtDate } from "@/lib/db";
import { fmtLockerAmount } from "@/lib/manufacturing";
import { listEntries, editEntry, deleteEntry, entryImpact, type EntryKind, type MoneyEntry } from "@/lib/moneyEntries";
import { DataTable, CellMain, CellAmount, CellDate, type DataColumn } from "@/components/DataTable";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { downloadCsv, downloadLedgerPdf } from "@/lib/ledgerExport";
import { LedgerFilters, inDateRange, rangeLabel } from "@/components/LedgerFilters";
import { toast } from "sonner";
import { confirmBox } from "@/lib/confirm";

const TITLES: Record<EntryKind, string> = {
  supplier: "Supplier Payments",
  factory: "Factory Payments",
  expense: "Expenses",
  locker: "Account Entries",
};

/** What the party column holds, per tab — so its filter is named for what it
 *  actually lists rather than a generic "Party". */
const PARTY_LABEL: Record<EntryKind, string> = {
  supplier: "Supplier",
  factory: "Factory",
  expense: "Expense",
  locker: "Category",
};

/** What one row is, for the table's count — "12 payments", "3 expenses". */
const NOUN: Record<EntryKind, string> = {
  supplier: "payment",
  factory: "payment",
  expense: "expense",
  locker: "transaction",
};

/**
 * One table for every kind of money that isn't a client receipt. Each row can be
 * corrected or cancelled, and both sides move together — the party's books and
 * the account it came out of. What each action changes is spelled out before it
 * is confirmed; see src/lib/moneyEntries.ts.
 */
export function MoneyLedger({ kind }: { kind: EntryKind }) {
  const { user } = useAuth();
  const can = useCan();
  const db = useDb();
  const [q, setQ] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [party, setParty] = useState("");
  const [acct, setAcct] = useState("");
  const [dir, setDir] = useState("");
  const [editing, setEditing] = useState<MoneyEntry | null>(null);
  const [ef, setEf] = useState({ amount: "", date: "", note: "", lockerId: "", toLockerId: "", rate: "" });

  const all = listEntries(db, kind);
  // The party list is built from the entries themselves, so it only ever offers
  // names that will actually match something.
  const parties = [...new Set(all.map(e => e.party).filter(Boolean))].sort();

  const ql = q.trim().toLowerCase();
  const rows = all.filter(e => {
    if (!inDateRange(e.date, from, to)) return false;
    if (party && e.party !== party) return false;
    if (acct && (e.lockerId ?? "") !== acct) return false;
    if (dir && e.direction !== dir) return false;
    return !ql || e.party.toLowerCase().includes(ql)
      || (e.against ?? "").toLowerCase().includes(ql)
      || (e.voucherNo ?? "").toLowerCase().includes(ql)
      || (e.note ?? "").toLowerCase().includes(ql);
  });
  const filtered = !!(ql || from || to || party || acct || dir);
  const reset = () => { setQ(""); setFrom(""); setTo(""); setParty(""); setAcct(""); setDir(""); };

  const totalOut = rows.filter(r => r.direction === "out").reduce((s, r) => s + r.amount, 0);
  const totalIn = rows.filter(r => r.direction === "in").reduce((s, r) => s + r.amount, 0);
  const anyUsd = rows.some(r => r.currency === "USD");

  const open = (e: MoneyEntry) => {
    if (e.locked) { toast.error(e.locked); return; }
    setEditing(e);
    // A transfer opens with both sides, so the destination can be corrected —
    // sending money to the wrong account is the single most common slip.
    const pair = e.transfer ? db.lockerTransactions.find(t => t.id === e.id) : undefined;
    setEf({
      amount: String(e.amount), date: e.date.slice(0, 10), note: e.note ?? "",
      lockerId: e.lockerId ?? "",
      toLockerId: pair?.pairedLockerId ?? "",
      rate: pair?.exchangeRate ? String(pair.exchangeRate) : "",
    });
  };

  const save = () => {
    if (!editing) return;
    const amt = Number(ef.amount);
    if (!amt || amt <= 0) { toast.error("Enter a valid amount"); return; }
    editEntry(editing, {
      amount: amt,
      date: `${ef.date}T${editing.date.slice(11) || "00:00:00.000Z"}`,
      note: ef.note,
      lockerId: ef.lockerId || undefined,
      userId: user!.id,
      toLockerId: ef.toLockerId || undefined,
      exchangeRate: Number(ef.rate) || undefined,
    });
    toast.success("Entry corrected");
    setEditing(null);
  };

  // Both downloads carry exactly what is on screen — the same filter, the same
  // order — so a printed copy can be checked against the page it came from.
  const exportRows = () => rows.map((e, i) => [
    i + 1,
    e.voucherNo ?? "",
    fmtDate(e.date),
    e.party,
    e.against ?? "",
    e.direction === "out" ? e.amount : "",
    e.direction === "in" ? e.amount : "",
    e.currency,
    db.lockers.find(l => l.id === e.lockerId)?.name ?? "",
    e.note ?? "",
  ]);
  const HEAD = ["Sr", "Voucher", "Date", kind === "expense" ? "Expense" : "Party", "Against", "Out", "In", "Currency", "Account", "Remarks"];

  const exportCsv = () => downloadCsv(`${TITLES[kind].replace(/\s+/g, "-")}`, HEAD, exportRows());

  const exportPdf = () => downloadLedgerPdf({
    title: TITLES[kind],
    subjectLines: [
      `${rows.length} entr${rows.length !== 1 ? "ies" : "y"} · ${rangeLabel(from, to)}`,
      [party && `${PARTY_LABEL[kind]}: ${party}`,
        acct && `Account: ${db.lockers.find(l => l.id === acct)?.name ?? acct}`,
        dir && (dir === "out" ? "Money out only" : "Money in only"),
        ql && `Search: "${q.trim()}"`].filter(Boolean).join(" · ") || "All entries",
      `Report Generated: ${new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}`,
    ],
    summary: [
      { label: "Total out", value: fmtLockerAmount(totalOut, anyUsd ? undefined : "INR") },
      { label: "Total in", value: fmtLockerAmount(totalIn, anyUsd ? undefined : "INR") },
    ],
    landscape: true,
    columns: [
      { header: "Sr", x: 14 }, { header: "Voucher", x: 26 }, { header: "Date", x: 52 },
      { header: kind === "expense" ? "Expense" : "Party", x: 80 }, { header: "Against", x: 130 },
      { header: "Out", x: 186 }, { header: "In", x: 214 }, { header: "Account", x: 238 },
      { header: "Remarks", x: 268 },
    ],
    align: ["left", "left", "left", "left", "left", "right", "right", "left", "left"],
    rows: rows.map((e, i) => [
      String(i + 1), e.voucherNo ?? "", fmtDate(e.date),
      (e.party || "").slice(0, 30), (e.against ?? "").slice(0, 32),
      e.direction === "out" ? fmtLockerAmount(e.amount, e.currency) : "",
      e.direction === "in" ? fmtLockerAmount(e.amount, e.currency) : "",
      (db.lockers.find(l => l.id === e.lockerId)?.name ?? "").slice(0, 16),
      (e.note ?? "").slice(0, 16),
    ]),
    filename: TITLES[kind].replace(/\s+/g, "-"),
  });


  const remove = async (e: MoneyEntry) => {
    if (e.locked) { toast.error(e.locked); return; }
    const lockerName = db.lockers.find(l => l.id === e.lockerId)?.name;
    if (!(await confirmBox(`Cancel this entry?\n\n${entryImpact(e, lockerName).join("\n")}\n\nThis cannot be undone.`))) return;
    deleteEntry(e);
    toast.success("Entry cancelled");
    setEditing(null);
  };

  const lockerName = (id?: string) => (id ? db.lockers.find(l => l.id === id)?.name : undefined) ?? "";
  const columns: DataColumn<MoneyEntry>[] = [
    { key: "party", header: kind === "expense" ? "Expense" : "Party", always: true, sortValue: e => e.party,
      cell: e => <CellMain title={e.party || "—"} className="max-w-[180px]" /> },
    { key: "date", header: "Date", kind: "date", sortValue: e => +new Date(e.date), csv: e => fmtDate(e.date),
      cell: e => <CellDate>{fmtDate(e.date)}</CellDate> },
    { key: "voucher", header: "Voucher", sortValue: e => e.voucherNo ?? "",
      cell: e => <span className="font-mono text-[11px] text-muted-foreground whitespace-nowrap">{e.voucherNo ?? "—"}</span> },
    { key: "against", header: "Against", sortValue: e => e.against ?? "",
      cell: e => <span className="block text-xs text-muted-foreground max-w-[150px] truncate" title={e.against ?? ""}>{e.against ?? "—"}</span> },
    { key: "out", header: "Out", align: "right", kind: "number", sortValue: e => (e.direction === "out" ? e.amount : null),
      cell: e => (e.direction === "out" ? <CellAmount tone="out">{fmtLockerAmount(e.amount, e.currency)}</CellAmount> : null) },
    { key: "in", header: "In", align: "right", kind: "number", sortValue: e => (e.direction === "in" ? e.amount : null),
      cell: e => (e.direction === "in" ? <CellAmount tone="in">{fmtLockerAmount(e.amount, e.currency)}</CellAmount> : null) },
    { key: "account", header: "Account", sortValue: e => lockerName(e.lockerId),
      cell: e => <span className="block text-xs text-muted-foreground max-w-[120px] truncate">{lockerName(e.lockerId) || "—"}</span> },
    { key: "remarks", header: "Remarks", sortValue: e => e.note ?? "",
      cell: e => <span className="block text-xs text-muted-foreground max-w-[160px] truncate" title={e.note ?? ""}>{e.note ?? "—"}</span> },
  ];

  return (
    <div className="card-luxe p-5">
      <div className="mb-3">
        <p className="font-display text-lg text-brand-dark leading-tight">{TITLES[kind]}</p>
        <p className="text-xs text-muted-foreground">
          {rows.length} entr{rows.length !== 1 ? "ies" : "y"}{filtered ? ` of ${all.length}` : ""}
          {totalOut > 0 && <> · out {fmtLockerAmount(totalOut, anyUsd ? undefined : "INR")}</>}
          {totalIn > 0 && <> · in {fmtLockerAmount(totalIn, anyUsd ? undefined : "INR")}</>}
          {(from || to) && <> · {rangeLabel(from, to)}</>}
        </p>
      </div>

      <LedgerFilters
        q={q} onQ={setQ}
        placeholder="Search party, voucher, bill, remark…"
        from={from} to={to}
        onFrom={setFrom} onTo={setTo}
        selects={[
          { label: PARTY_LABEL[kind], value: party, onChange: setParty,
            options: parties.map(p => ({ value: p, label: p })) },
          { label: "Accounts", value: acct, onChange: setAcct,
            options: db.lockers.map(l => ({ value: l.id, label: l.name })) },
          { label: "Directions", value: dir, onChange: setDir,
            options: [{ value: "out", label: "Money out" }, { value: "in", label: "Money in" }] },
        ]}
        active={filtered} onReset={reset}
        onPdf={exportPdf} onCsv={exportCsv}
      />

      {/* The filters, search and downloads live in the bar above, so the table
          brings no search or Excel of its own. A new filter (resetKey)
          starts it again from the first page. */}
      <DataTable
        resetKey={JSON.stringify([kind, ql, from, to, party, acct, dir])}
        id={`money-ledger-${kind}`}
        noun={NOUN[kind]}
        rows={rows}
        columns={columns}
        rowKey={e => e.id}
        defaultSort={{ key: "date", dir: "desc" }}
        emptyText={filtered ? "Nothing matches these filters." : "No entries yet."}
        rowActions={e => e.locked
          // Owned by another tab: say where it is corrected instead.
          ? [{ label: e.lockedWhere ? `Edit in ${e.lockedWhere}` : "Locked", hint: e.locked, icon: Lock, disabled: true, onSelect: () => {} }]
          : [
            { label: "Edit", icon: Pencil, onSelect: () => open(e), show: can("payments", "edit") },
            { label: "Delete", icon: Trash2, danger: true, onSelect: () => remove(e), show: can("payments", "delete") },
          ]}
      />

      <Dialog open={!!editing} onOpenChange={o => { if (!o) setEditing(null); }}>
        <DialogContent className="max-w-xl rounded-2xl">
          <DialogHeader><DialogTitle className="font-display text-xl">Correct this entry</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground -mt-1">
            {editing?.party}{editing?.against ? ` · ${editing.against}` : ""}. The account it came from moves with it,
            so the balance and what is owed stay in step.
          </p>
          {editing?.legIds && (
            <p className="text-[11px] text-muted-foreground rounded-xl bg-secondary/60 p-2.5">
              This one payment settled {editing.legLabels?.length} bills — {editing.legLabels?.join(", ")}.
              The date, account and remarks can be corrected and all of them move together.
              <span className="font-medium text-foreground"> The total cannot be changed here</span>, because there
              is no saying which bill should get more or less — cancel it and enter it again instead.
            </p>
          )}
          <div className="grid grid-cols-2 gap-3 mt-1">
            <div>
              <Label className="text-xs">Amount ({editing?.currency === "USD" ? "$" : "₹"})</Label>
              <Input type="number" min={0} step="0.01" value={ef.amount} disabled={!!editing?.legIds}
                onChange={e => setEf({ ...ef, amount: e.target.value })}
                className="rounded-xl h-10 mt-1 disabled:opacity-60" />
            </div>
            <div>
              <Label className="text-xs">Date</Label>
              <Input type="date" value={ef.date}
                onChange={e => setEf({ ...ef, date: e.target.value })} className="rounded-xl h-10 mt-1" />
            </div>
          </div>
          <div>
            <Label className="text-xs">{editing?.transfer ? "From account" : "Account"}</Label>
            <Select value={ef.lockerId || "none"} onValueChange={v => setEf({ ...ef, lockerId: v === "none" ? "" : v })}>
              <SelectTrigger className="h-10 rounded-xl mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">No account</SelectItem>
                {db.lockers.filter(l => l.active !== false).map(l => (
                  <SelectItem key={l.id} value={l.id}>{l.name} ({l.currency || "INR"})</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {editing?.transfer && (
            <>
              <div>
                <Label className="text-xs">To account</Label>
                <Select value={ef.toLockerId} onValueChange={v => setEf({ ...ef, toLockerId: v })}>
                  <SelectTrigger className="h-10 rounded-xl mt-1"><SelectValue placeholder="Choose the destination" /></SelectTrigger>
                  <SelectContent>
                    {db.lockers.filter(l => l.active !== false && l.id !== ef.lockerId).map(l => (
                      <SelectItem key={l.id} value={l.id}>{l.name} ({l.currency || "INR"})</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {(() => {
                const from = db.lockers.find(l => l.id === ef.lockerId);
                const to = db.lockers.find(l => l.id === ef.toLockerId);
                if (!from || !to || (from.currency || "INR") === (to.currency || "INR")) return null;
                return (
                  <div>
                    <Label className="text-xs">Exchange rate — 1 USD = ₹ <span className="text-destructive">*</span></Label>
                    <Input type="number" min={0} step="0.01" value={ef.rate}
                      onChange={e => setEf({ ...ef, rate: e.target.value })}
                      className="rounded-xl h-10 mt-1" placeholder="e.g. 101.15" />
                  </div>
                );
              })()}
              <p className="text-[11px] text-muted-foreground">
                Both sides move together — the money leaves the first account and arrives in the second, converted at
                this rate when the two are in different currencies.
              </p>
            </>
          )}

          <div>
            <Label className="text-xs">Remarks</Label>
            <Input value={ef.note} onChange={e => setEf({ ...ef, note: e.target.value })} className="rounded-xl h-10 mt-1" />
          </div>
          <div className="flex gap-2 mt-3 flex-wrap">
            {can("payments", "delete") && (
              <Button variant="outline" onClick={() => editing && remove(editing)}
                className="rounded-xl text-destructive hover:text-destructive hover:bg-destructive/10">
                Cancel entry
              </Button>
            )}
            <Button variant="outline" onClick={() => setEditing(null)} className="rounded-xl ml-auto">Close</Button>
            <Button onClick={save} className="btn-hero rounded-xl">Save</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
