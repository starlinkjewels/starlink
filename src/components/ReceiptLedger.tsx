import { useState } from "react";
import { useAuth } from "@/lib/auth";
import { useDb } from "@/hooks/useDb";
import { fmtMoney, fmtDate } from "@/lib/db";
import { fmtLockerAmount } from "@/lib/manufacturing";
import { editReceipt, deleteReceipt, deleteImpact, listReceipts, receiptApplied } from "@/lib/receipts";
import { usePagination } from "@/hooks/usePagination";
import { PaginationBar } from "@/components/PaginationBar";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FileText, FileSpreadsheet } from "lucide-react";
import { downloadCsv, downloadLedgerPdf } from "@/lib/ledgerExport";
import { toast } from "sonner";

const PAGE = 12;
const METHODS = ["Cash", "Bank Transfer", "UPI", "Cheque", "Other"];

/**
 * Every payment received, as a numbered receipt book: what came in, from whom,
 * into which account, and what it was. Each row can be corrected or cancelled —
 * a payment entered wrong used to be permanent, because the money it turned
 * into (advances on several orders, a locker deposit, leftover credit) had to
 * be hunted down by hand. See src/lib/receipts.ts for what each action moves.
 */
export function ReceiptLedger() {
  const { user } = useAuth();
  const db = useDb();
  const [q, setQ] = useState("");
  const [editId, setEditId] = useState<string | null>(null);
  const [ef, setEf] = useState({ amount: "", date: "", method: "Cash", remarks: "", lockerId: "", rate: "" });

  const ql = q.trim().toLowerCase();
  const rows = listReceipts(db).filter(r => {
    if (!ql) return true;
    const client = db.clients.find(c => c.id === r.clientId)?.companyName ?? "";
    return r.receiptNo.includes(ql)
      || client.toLowerCase().includes(ql)
      || (r.remarks ?? "").toLowerCase().includes(ql)
      || r.method.toLowerCase().includes(ql);
  });
  const { paged, page, setPage, totalPages, start, end } = usePagination(rows, PAGE);
  const totalReceived = rows.reduce((s, r) => s + r.amountUsd, 0);

  const editing = editId ? db.clientReceipts?.find(x => x.id === editId) : undefined;
  const editLocker = db.lockers.find(l => l.id === ef.lockerId);
  const editLockerCcy = (editLocker?.currency || "INR") as "INR" | "USD";

  const open = (id: string) => {
    const r = db.clientReceipts?.find(x => x.id === id);
    if (!r) return;
    setEditId(id);
    setEf({
      amount: String(r.amountUsd),
      date: r.date.slice(0, 10),
      method: r.method,
      remarks: r.remarks ?? "",
      lockerId: r.lockerId ?? "",
      rate: r.exchangeRate ? String(r.exchangeRate) : "",
    });
  };

  const save = () => {
    if (!editing) return;
    const amt = Number(ef.amount);
    if (!amt || amt <= 0) { toast.error("Enter a valid amount"); return; }
    const rate = Number(ef.rate) || 0;
    if (editLocker && editLockerCcy !== "USD" && rate <= 0) {
      toast.error("Enter the exchange rate for that account"); return;
    }
    // Keep the original time of day so the day's entries stay in the same order.
    const date = `${ef.date}T${editing.date.slice(11) || "00:00:00.000Z"}`;
    editReceipt(editing.id, {
      amountUsd: amt,
      date,
      method: ef.method,
      remarks: ef.remarks,
      lockerId: ef.lockerId || undefined,
      lockerAmount: editLocker
        ? (editLockerCcy === "USD" ? amt : Math.round(amt * rate * 100) / 100)
        : undefined,
      lockerCurrency: editLocker ? editLockerCcy : undefined,
      exchangeRate: editLocker && editLockerCcy !== "USD" ? rate : undefined,
      userId: user!.id,
    });
    toast.success(`Receipt ${editing.receiptNo} corrected`);
    setEditId(null);
  };

  // What is on screen is what downloads — same search, same order.
  const exportCsv = () => downloadCsv(
    "Payments-Received",
    ["Sr", "Receipt", "Date", "Client", "Amount (USD)", "Rate", "Deposited", "Currency", "Account", "Mode", "Remarks", "Held as credit"],
    rows.map((r, i) => {
      const client = db.clients.find(c => c.id === r.clientId)?.companyName ?? "";
      const locker = db.lockers.find(l => l.id === r.lockerId)?.name ?? "";
      const asCredit = Math.round((r.amountUsd - receiptApplied(db, r.id)) * 100) / 100;
      return [i + 1, r.receiptNo, fmtDate(r.date), client, r.amountUsd, r.exchangeRate ?? "",
        r.lockerAmount ?? r.amountUsd, r.lockerCurrency ?? "", locker, r.method, r.remarks ?? "",
        asCredit > 0.009 ? asCredit : ""];
    }),
  );

  const exportPdf = () => downloadLedgerPdf({
    title: "Payments Received",
    subjectLines: [
      `${rows.length} receipt${rows.length !== 1 ? "s" : ""}${ql ? " (filtered)" : ""}`,
      `Report Generated: ${new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}`,
    ],
    summary: [{ label: "Total received", value: fmtMoney(totalReceived) }],
    landscape: true,
    columns: [
      { header: "Sr", x: 14 }, { header: "Receipt", x: 26 }, { header: "Date", x: 52 },
      { header: "Client", x: 82 }, { header: "Amount", x: 150 }, { header: "Rate", x: 176 },
      { header: "Deposited", x: 200 }, { header: "Account", x: 230 }, { header: "Mode", x: 258 },
    ],
    align: ["left", "left", "left", "left", "right", "right", "right", "left", "left"],
    rows: rows.map((r, i) => [
      String(i + 1), r.receiptNo, fmtDate(r.date),
      (db.clients.find(c => c.id === r.clientId)?.companyName ?? "").slice(0, 40),
      fmtMoney(r.amountUsd), r.exchangeRate ? String(r.exchangeRate) : "",
      r.lockerId ? fmtLockerAmount(r.lockerAmount ?? r.amountUsd, r.lockerCurrency) : "",
      (db.lockers.find(l => l.id === r.lockerId)?.name ?? "").slice(0, 16),
      r.method.slice(0, 14),
    ]),
    filename: "Payments-Received",
  });


  const remove = (id: string) => {
    const rec = db.clientReceipts?.find(x => x.id === id);
    if (!rec) return;
    if (!confirm(
      `Cancel receipt ${rec.receiptNo}?\n\n${deleteImpact(db, id).join("\n")}\n\nThis cannot be undone.`
    )) return;
    deleteReceipt(id, user!.id);
    toast.success(`Receipt ${rec.receiptNo} cancelled`);
    setEditId(null);
  };

  return (
    <div className="card-luxe p-5">
      <div className="flex items-end justify-between gap-3 flex-wrap mb-3">
        <div>
          <p className="font-display text-lg text-brand-dark leading-tight">Payments Received</p>
          <p className="text-xs text-muted-foreground">
            {rows.length} receipt{rows.length !== 1 ? "s" : ""} · total {fmtMoney(totalReceived)}
          </p>
        </div>
        <Input
          value={q}
          onChange={e => { setQ(e.target.value); setPage(1); }}
          placeholder="Search receipt #, client, remark…"
          className="rounded-xl h-9 w-full sm:w-64"
        />
        <div className="flex items-center gap-2 shrink-0">
          <button onClick={exportPdf}
            className="flex items-center gap-1.5 h-9 px-3 rounded-xl border border-border bg-white hover:bg-secondary text-xs font-medium text-brand-dark">
            <FileText className="h-4 w-4" /> PDF
          </button>
          <button onClick={exportCsv}
            className="flex items-center gap-1.5 h-9 px-3 rounded-xl border border-border bg-white hover:bg-secondary text-xs font-medium text-brand-dark">
            <FileSpreadsheet className="h-4 w-4" /> Excel
          </button>
        </div>
      </div>

      <div className="overflow-x-auto -mx-5">
        <table className="w-full text-sm min-w-[860px]">
          <thead className="bg-secondary/50 text-[11px] uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="text-left px-5 py-2.5">Sr</th>
              <th className="text-left px-3 py-2.5">Receipt</th>
              <th className="text-left px-3 py-2.5">Date</th>
              <th className="text-left px-3 py-2.5">Client</th>
              <th className="text-right px-3 py-2.5">Amount</th>
              <th className="text-right px-3 py-2.5">Rate</th>
              <th className="text-right px-3 py-2.5">Deposited</th>
              <th className="text-left px-3 py-2.5">Account</th>
              <th className="text-left px-3 py-2.5">Mode</th>
              <th className="text-left px-3 py-2.5">Remarks</th>
              <th className="text-right px-5 py-2.5">Action</th>
            </tr>
          </thead>
          <tbody>
            {paged.length === 0 ? (
              <tr>
                <td colSpan={11} className="px-5 py-10 text-center text-muted-foreground">
                  {ql ? "No receipt matches that search." : "No payments recorded yet."}
                </td>
              </tr>
            ) : paged.map((r, i) => {
              const client = db.clients.find(c => c.id === r.clientId);
              const locker = db.lockers.find(l => l.id === r.lockerId);
              const applied = receiptApplied(db, r.id);
              const asCredit = Math.round((r.amountUsd - applied) * 100) / 100;
              return (
                <tr key={r.id} className="border-t border-border/40 hover:bg-secondary/30">
                  <td className="px-5 py-2.5 text-xs text-muted-foreground">{(page - 1) * PAGE + i + 1}</td>
                  <td className="px-3 py-2.5 font-mono font-medium">{r.receiptNo}</td>
                  <td className="px-3 py-2.5 text-xs text-muted-foreground whitespace-nowrap">{fmtDate(r.date)}</td>
                  <td className="px-3 py-2.5 font-medium max-w-[160px] truncate">{client?.companyName ?? "—"}</td>
                  <td className="px-3 py-2.5 text-right font-semibold text-success">{fmtMoney(r.amountUsd)}</td>
                  <td className="px-3 py-2.5 text-right text-xs text-muted-foreground">{r.exchangeRate ?? "—"}</td>
                  <td className="px-3 py-2.5 text-right text-xs">
                    {r.lockerId ? fmtLockerAmount(r.lockerAmount ?? r.amountUsd, r.lockerCurrency) : "—"}
                  </td>
                  <td className="px-3 py-2.5 text-xs text-muted-foreground max-w-[120px] truncate">{locker?.name ?? "—"}</td>
                  <td className="px-3 py-2.5 text-xs">{r.method}</td>
                  <td className="px-3 py-2.5 text-xs text-muted-foreground max-w-[170px] truncate">
                    {r.remarks ?? "—"}
                    {asCredit > 0.009 && (
                      <span className="ml-1 text-warning">· {fmtMoney(asCredit)} held as credit</span>
                    )}
                  </td>
                  <td className="px-5 py-2.5 text-right whitespace-nowrap">
                    <button onClick={() => open(r.id)} className="text-primary hover:underline text-xs mr-3">Edit</button>
                    <button onClick={() => remove(r.id)} className="text-destructive hover:underline text-xs">Delete</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <PaginationBar page={page} totalPages={totalPages} onPageChange={setPage}
        label={rows.length ? `Showing ${start + 1}–${end} of ${rows.length}` : undefined} />

      <Dialog open={!!editing} onOpenChange={o => { if (!o) setEditId(null); }}>
        <DialogContent className="max-w-md rounded-2xl">
          <DialogHeader>
            <DialogTitle className="font-display text-xl">Correct receipt {editing?.receiptNo}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground -mt-1">
            The old allocation and deposit are taken back out and the corrected figures applied fresh, so the
            client&rsquo;s bills, their credit and the account balance all end up right. The receipt number never changes.
          </p>
          <div className="grid grid-cols-2 gap-3 mt-1">
            <div>
              <Label className="text-xs">Amount received ($)</Label>
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
            <Label className="text-xs">Deposited to account</Label>
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
          {editLocker && editLockerCcy !== "USD" && (
            <div>
              <Label className="text-xs">Exchange rate — 1 USD = ₹ <span className="text-destructive">*</span></Label>
              <Input type="number" min={0} step="0.01" value={ef.rate}
                onChange={e => setEf({ ...ef, rate: e.target.value })} className="rounded-xl h-10 mt-1" placeholder="e.g. 83.50" />
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Mode</Label>
              <Select value={ef.method} onValueChange={v => setEf({ ...ef, method: v })}>
                <SelectTrigger className="h-10 rounded-xl mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>{METHODS.map(m => <SelectItem key={m} value={m}>{m}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Remarks</Label>
              <Input value={ef.remarks} onChange={e => setEf({ ...ef, remarks: e.target.value })} className="rounded-xl h-10 mt-1" />
            </div>
          </div>
          <div className="flex gap-2 mt-3 flex-wrap">
            <Button variant="outline" onClick={() => editing && remove(editing.id)}
              className="rounded-xl text-destructive hover:text-destructive hover:bg-destructive/10">
              Cancel receipt
            </Button>
            <Button variant="outline" onClick={() => setEditId(null)} className="rounded-xl ml-auto">Close</Button>
            <Button onClick={save} className="btn-hero rounded-xl">Save</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
