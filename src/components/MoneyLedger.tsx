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
import { toast } from "sonner";

const PAGE = 12;

const TITLES: Record<EntryKind, string> = {
  supplier: "Supplier Payments",
  factory: "Factory Payments",
  expense: "Expenses",
  locker: "Account Entries",
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
  const [editing, setEditing] = useState<MoneyEntry | null>(null);
  const [ef, setEf] = useState({ amount: "", date: "", note: "", lockerId: "" });

  const ql = q.trim().toLowerCase();
  const rows = listEntries(db, kind).filter(e =>
    !ql || e.party.toLowerCase().includes(ql)
    || (e.against ?? "").toLowerCase().includes(ql)
    || (e.note ?? "").toLowerCase().includes(ql));
  const { paged, page, setPage, totalPages, start, end } = usePagination(rows, PAGE);

  const totalOut = rows.filter(r => r.direction === "out").reduce((s, r) => s + r.amount, 0);
  const totalIn = rows.filter(r => r.direction === "in").reduce((s, r) => s + r.amount, 0);
  const anyUsd = rows.some(r => r.currency === "USD");

  const open = (e: MoneyEntry) => {
    if (e.locked) { toast.error(e.locked); return; }
    setEditing(e);
    setEf({ amount: String(e.amount), date: e.date.slice(0, 10), note: e.note ?? "", lockerId: e.lockerId ?? "" });
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
    });
    toast.success("Entry corrected");
    setEditing(null);
  };

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
      <div className="flex items-end justify-between gap-3 flex-wrap mb-3">
        <div>
          <p className="font-display text-lg text-brand-dark leading-tight">{TITLES[kind]}</p>
          <p className="text-xs text-muted-foreground">
            {rows.length} entr{rows.length !== 1 ? "ies" : "y"}
            {totalOut > 0 && <> · out {fmtLockerAmount(totalOut, anyUsd ? undefined : "INR")}</>}
            {totalIn > 0 && <> · in {fmtLockerAmount(totalIn, anyUsd ? undefined : "INR")}</>}
          </p>
        </div>
        <Input value={q} onChange={e => { setQ(e.target.value); setPage(1); }}
          placeholder="Search party, bill, remark…" className="rounded-xl h-9 w-full sm:w-64" />
      </div>

      <div className="overflow-x-auto -mx-5">
        <table className="w-full text-sm min-w-[760px]">
          <thead className="bg-secondary/50 text-[11px] uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="text-left px-5 py-2.5">Sr</th>
              <th className="text-left px-3 py-2.5">Date</th>
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
              <tr><td colSpan={9} className="px-5 py-10 text-center text-muted-foreground">
                {ql ? "Nothing matches that search." : "No entries yet."}
              </td></tr>
            ) : paged.map((e, i) => {
              const locker = db.lockers.find(l => l.id === e.lockerId);
              return (
                <tr key={e.id} className="border-t border-border/40 hover:bg-secondary/30">
                  <td className="px-5 py-2.5 text-xs text-muted-foreground">{(page - 1) * PAGE + i + 1}</td>
                  <td className="px-3 py-2.5 text-xs text-muted-foreground whitespace-nowrap">{fmtDate(e.date)}</td>
                  <td className="px-3 py-2.5 font-medium max-w-[180px] truncate">{e.party}</td>
                  <td className="px-3 py-2.5 text-xs text-muted-foreground max-w-[150px] truncate">{e.against ?? "—"}</td>
                  <td className="px-3 py-2.5 text-right font-semibold text-destructive">
                    {e.direction === "out" ? fmtLockerAmount(e.amount, e.currency) : ""}
                  </td>
                  <td className="px-3 py-2.5 text-right font-semibold text-success">
                    {e.direction === "in" ? fmtLockerAmount(e.amount, e.currency) : ""}
                  </td>
                  <td className="px-3 py-2.5 text-xs text-muted-foreground max-w-[120px] truncate">{locker?.name ?? "—"}</td>
                  <td className="px-3 py-2.5 text-xs text-muted-foreground max-w-[160px] truncate">{e.note ?? "—"}</td>
                  <td className="px-5 py-2.5 text-right whitespace-nowrap">
                    {e.locked ? (
                      <span className="text-[11px] text-muted-foreground" title={e.locked}>locked</span>
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
          <div className="grid grid-cols-2 gap-3 mt-1">
            <div>
              <Label className="text-xs">Amount ({editing?.currency === "USD" ? "$" : "₹"})</Label>
              <Input type="number" min={0} step="0.01" value={ef.amount}
                onChange={e => setEf({ ...ef, amount: e.target.value })} className="rounded-xl h-10 mt-1" />
            </div>
            <div>
              <Label className="text-xs">Date</Label>
              <Input type="date" value={ef.date}
                onChange={e => setEf({ ...ef, date: e.target.value })} className="rounded-xl h-10 mt-1" />
            </div>
          </div>
          <div>
            <Label className="text-xs">Account</Label>
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
