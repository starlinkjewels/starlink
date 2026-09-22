import { useState } from "react";
import { useAuth } from "@/lib/auth";
import { useDb } from "@/hooks/useDb";
import { fmtDate } from "@/lib/db";
import { fmtLockerAmount } from "@/lib/manufacturing";
import { listEntries, editEntry, deleteEntry, entryImpact, type EntryKind, type MoneyEntry } from "@/lib/moneyEntries";
import { usePagination } from "@/hooks/usePagination";
import { PaginationBar } from "@/components/PaginationBar";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { downloadCsv, downloadLedgerPdf } from "@/lib/ledgerExport";
import { LedgerFilters, inDateRange, rangeLabel } from "@/components/LedgerFilters";
import { toast } from "sonner";

const PAGE = 12;

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

/**
 * One table for every kind of money that isn't a client receipt. Each row can be
 * corrected or cancelled, and both sides move together — the party's books and
 * the account it came out of. What each action changes is spelled out before it
 * is confirmed; see src/lib/moneyEntries.ts.
 */
export function MoneyLedger({ kind }: { kind: EntryKind }) {
  const { user } = useAuth();
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
  const { paged, page, setPage, totalPages, start, end } = usePagination(rows, PAGE);
  const reset = () => { setQ(""); setFrom(""); setTo(""); setParty(""); setAcct(""); setDir(""); setPage(1); };

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


  const remove = (e: MoneyEntry) => {
    if (e.locked) { toast.error(e.locked); return; }
    const lockerName = db.lockers.find(l => l.id === e.lockerId)?.name;
    if (!confirm(`Cancel this entry?\n\n${entryImpact(e, lockerName).join("\n")}\n\nThis cannot be undone.`)) return;
    deleteEntry(e);
    toast.success("Entry cancelled");
    setEditing(null);
  };

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
        q={q} onQ={v => { setQ(v); setPage(1); }}
        placeholder="Search party, voucher, bill, remark…"
        from={from} to={to}
        onFrom={v => { setFrom(v); setPage(1); }} onTo={v => { setTo(v); setPage(1); }}
        selects={[
          { label: PARTY_LABEL[kind], value: party, onChange: v => { setParty(v); setPage(1); },
            options: parties.map(p => ({ value: p, label: p })) },
          { label: "Accounts", value: acct, onChange: v => { setAcct(v); setPage(1); },
            options: db.lockers.map(l => ({ value: l.id, label: l.name })) },
          { label: "Directions", value: dir, onChange: v => { setDir(v); setPage(1); },
            options: [{ value: "out", label: "Money out" }, { value: "in", label: "Money in" }] },
        ]}
        active={filtered} onReset={reset}
        onPdf={exportPdf} onCsv={exportCsv}
      />

      <div className="overflow-x-auto -mx-5">
        <table className="w-full text-sm min-w-[760px]">
          <thead className="bg-secondary/50 text-[11px] uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="text-left px-5 py-2.5">Sr</th>
              <th className="text-left px-3 py-2.5">Date</th>
              <th className="text-left px-3 py-2.5">Voucher</th>
              <th className="text-left px-3 py-2.5">{kind === "expense" ? "Expense" : "Party"}</th>
              <th className="text-left px-3 py-2.5">Against</th>
              <th className="text-right px-3 py-2.5">Out</th>
              <th className="text-right px-3 py-2.5">In</th>
              <th className="text-left px-3 py-2.5">Account</th>
              <th className="text-left px-3 py-2.5">Remarks</th>
              <th className="text-right px-5 py-2.5">Action</th>
            </tr>
          </thead>
          <tbody>
            {paged.length === 0 ? (
              <tr><td colSpan={10} className="px-5 py-10 text-center text-muted-foreground">
                {filtered ? "Nothing matches these filters." : "No entries yet."}
              </td></tr>
            ) : paged.map((e, i) => {
              const locker = db.lockers.find(l => l.id === e.lockerId);
              return (
                <tr key={e.id} className="border-t border-border/40 hover:bg-secondary/30">
                  <td className="px-5 py-2.5 text-xs text-muted-foreground">{(page - 1) * PAGE + i + 1}</td>
                  <td className="px-3 py-2.5 text-xs text-muted-foreground whitespace-nowrap">{fmtDate(e.date)}</td>
                  <td className="px-3 py-2.5 font-mono text-[11px] text-muted-foreground whitespace-nowrap">{e.voucherNo ?? "—"}</td>
                  <td className="px-3 py-2.5 font-medium max-w-[180px] truncate">{e.party}</td>
                  <td className="px-3 py-2.5 text-xs text-muted-foreground max-w-[150px] truncate" title={e.against ?? ""}>{e.against ?? "—"}</td>
                  <td className="px-3 py-2.5 text-right font-semibold text-destructive">
                    {e.direction === "out" ? fmtLockerAmount(e.amount, e.currency) : ""}
                  </td>
                  <td className="px-3 py-2.5 text-right font-semibold text-success">
                    {e.direction === "in" ? fmtLockerAmount(e.amount, e.currency) : ""}
                  </td>
                  <td className="px-3 py-2.5 text-xs text-muted-foreground max-w-[120px] truncate">{locker?.name ?? "—"}</td>
                  <td className="px-3 py-2.5 text-xs text-muted-foreground max-w-[160px] truncate" title={e.note ?? ""}>{e.note ?? "—"}</td>
                  <td className="px-5 py-2.5 text-right whitespace-nowrap">
                    {e.locked ? (
                      <span className="text-[11px] text-muted-foreground" title={e.locked}>
                        {e.lockedWhere ? `Edit in ${e.lockedWhere}` : "locked"}
                      </span>
                    ) : (
                      <>
                        <button onClick={() => open(e)} className="text-primary hover:underline text-xs mr-3">Edit</button>
                        <button onClick={() => remove(e)} className="text-destructive hover:underline text-xs">Delete</button>
                      </>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <PaginationBar page={page} totalPages={totalPages} onPageChange={setPage}
        label={rows.length ? `Showing ${start + 1}–${end} of ${rows.length}` : undefined} />

      <Dialog open={!!editing} onOpenChange={o => { if (!o) setEditing(null); }}>
        <DialogContent className="max-w-md rounded-2xl">
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
            <Button variant="outline" onClick={() => editing && remove(editing)}
              className="rounded-xl text-destructive hover:text-destructive hover:bg-destructive/10">
              Cancel entry
            </Button>
            <Button variant="outline" onClick={() => setEditing(null)} className="rounded-xl ml-auto">Close</Button>
            <Button onClick={save} className="btn-hero rounded-xl">Save</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
