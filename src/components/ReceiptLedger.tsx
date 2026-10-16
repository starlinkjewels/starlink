import { useCan } from "@/hooks/useCan";
import { useState } from "react";
import { Pencil, Trash2 } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { useDb } from "@/hooks/useDb";
import { fmtMoney, fmtDate, type ClientReceipt } from "@/lib/db";
import { fmtLockerAmount } from "@/lib/manufacturing";
import { editReceipt, deleteReceipt, deleteImpact, listReceipts, receiptApplied } from "@/lib/receipts";
import { DataTable, CellAmount, CellDate, type DataColumn } from "@/components/DataTable";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { downloadCsv, downloadLedgerPdf } from "@/lib/ledgerExport";
import { LedgerFilters, inDateRange, rangeLabel } from "@/components/LedgerFilters";
import { toast } from "sonner";
import { confirmBox } from "@/lib/confirm";

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
  const can = useCan();
  const db = useDb();
  const [q, setQ] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [clientId, setClientId] = useState("");
  const [acct, setAcct] = useState("");
  const [mode, setMode] = useState("");
  const [editId, setEditId] = useState<string | null>(null);
  const [ef, setEf] = useState({ amount: "", date: "", method: "Cash", remarks: "", lockerId: "", rate: "" });

  const allReceipts = listReceipts(db);
  const ql = q.trim().toLowerCase();
  const rows = allReceipts.filter(r => {
    if (!inDateRange(r.date, from, to)) return false;
    if (clientId && r.clientId !== clientId) return false;
    if (acct && (r.lockerId ?? "") !== acct) return false;
    if (mode && r.method !== mode) return false;
    if (!ql) return true;
    const client = db.clients.find(c => c.id === r.clientId)?.companyName ?? "";
    return r.receiptNo.includes(ql)
      || client.toLowerCase().includes(ql)
      || (r.remarks ?? "").toLowerCase().includes(ql)
      || r.method.toLowerCase().includes(ql);
  });
  const filtered = !!(ql || from || to || clientId || acct || mode);
  const reset = () => { setQ(""); setFrom(""); setTo(""); setClientId(""); setAcct(""); setMode(""); };
  const totalReceived = rows.reduce((s, r) => s + r.amountUsd, 0);
  // Only clients who actually have a receipt — a list of every client would be
  // mostly dead options.
  const payers = [...new Set(allReceipts.map(r => r.clientId))]
    .map(id => ({ value: id, label: db.clients.find(c => c.id === id)?.companyName ?? "Client" }))
    .sort((a, b) => a.label.localeCompare(b.label));

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
      `${rows.length} receipt${rows.length !== 1 ? "s" : ""} · ${rangeLabel(from, to)}`,
      [clientId && `Client: ${db.clients.find(c => c.id === clientId)?.companyName ?? ""}`,
        acct && `Account: ${db.lockers.find(l => l.id === acct)?.name ?? acct}`,
        mode && `Mode: ${mode}`,
        ql && `Search: "${q.trim()}"`].filter(Boolean).join(" · ") || "All receipts",
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


  const remove = async (id: string) => {
    const rec = db.clientReceipts?.find(x => x.id === id);
    if (!rec) return;
    if (!(await confirmBox(
      `Cancel receipt ${rec.receiptNo}?\n\n${deleteImpact(db, id).join("\n")}\n\nThis cannot be undone.`
    ))) return;
    deleteReceipt(id, user!.id);
    toast.success(`Receipt ${rec.receiptNo} cancelled`);
    setEditId(null);
  };

  const clientName = (id: string) => db.clients.find(c => c.id === id)?.companyName ?? "";
  const lockerName = (id?: string) => (id ? db.lockers.find(l => l.id === id)?.name : undefined) ?? "";
  const columns: DataColumn<ClientReceipt>[] = [
    { key: "receipt", header: "Receipt", always: true, sortValue: r => r.receiptNo,
      cell: r => <span className="font-mono font-medium whitespace-nowrap">{r.receiptNo}</span> },
    { key: "date", header: "Date", kind: "date", sortValue: r => +new Date(r.date), csv: r => fmtDate(r.date),
      cell: r => <CellDate>{fmtDate(r.date)}</CellDate> },
    { key: "client", header: "Client", sortValue: r => clientName(r.clientId),
      cell: r => <span className="block font-medium max-w-[160px] truncate">{clientName(r.clientId) || "—"}</span> },
    { key: "amount", header: "Amount", align: "right", kind: "number", sortValue: r => r.amountUsd,
      cell: r => <CellAmount tone="in">{fmtMoney(r.amountUsd)}</CellAmount> },
    { key: "rate", header: "Rate", align: "right", kind: "number", sortValue: r => r.exchangeRate,
      cell: r => <span className="text-xs text-muted-foreground tabular-nums">{r.exchangeRate ?? "—"}</span> },
    { key: "deposited", header: "Deposited", align: "right", kind: "number", sortValue: r => (r.lockerId ? r.lockerAmount ?? r.amountUsd : null),
      cell: r => <span className="text-xs tabular-nums whitespace-nowrap">{r.lockerId ? fmtLockerAmount(r.lockerAmount ?? r.amountUsd, r.lockerCurrency) : "—"}</span> },
    { key: "account", header: "Account", sortValue: r => lockerName(r.lockerId),
      cell: r => <span className="block text-xs text-muted-foreground max-w-[120px] truncate">{lockerName(r.lockerId) || "—"}</span> },
    { key: "mode", header: "Mode", sortValue: r => r.method, cell: r => <span className="text-xs whitespace-nowrap">{r.method}</span> },
    { key: "remarks", header: "Remarks", sortValue: r => r.remarks ?? "",
      cell: r => {
        const asCredit = Math.round((r.amountUsd - receiptApplied(db, r.id)) * 100) / 100;
        return (
          <span className="block text-xs text-muted-foreground max-w-[170px] truncate">
            {r.remarks ?? "—"}
            {asCredit > 0.009 && <span className="ml-1 text-warning">· {fmtMoney(asCredit)} held as credit</span>}
          </span>
        );
      } },
  ];

  return (
    <div className="card-luxe p-5">
      <div className="mb-3">
        <p className="font-display text-lg text-brand-dark leading-tight">Payments Received</p>
        <p className="text-xs text-muted-foreground">
          {rows.length} receipt{rows.length !== 1 ? "s" : ""}{filtered ? ` of ${allReceipts.length}` : ""} · total {fmtMoney(totalReceived)}
          {(from || to) && <> · {rangeLabel(from, to)}</>}
        </p>
      </div>

      <LedgerFilters
        q={q} onQ={setQ}
        placeholder="Search receipt #, client, remark…"
        from={from} to={to}
        onFrom={setFrom} onTo={setTo}
        selects={[
          { label: "Clients", value: clientId, onChange: setClientId, options: payers },
          { label: "Accounts", value: acct, onChange: setAcct,
            options: db.lockers.map(l => ({ value: l.id, label: l.name })) },
          { label: "Modes", value: mode, onChange: setMode,
            options: METHODS.map(m => ({ value: m, label: m })) },
        ]}
        active={filtered} onReset={reset}
        onPdf={exportPdf} onCsv={exportCsv}
      />

      {/* The filters, search and downloads live in the bar above, so the table
          brings no search or Excel of its own. A new filter (resetKey)
          starts it again from the first page. */}
      <DataTable
        resetKey={JSON.stringify([ql, from, to, clientId, acct, mode])}
        id="receipt-ledger"
        noun="receipt"
        rows={rows}
        columns={columns}
        rowKey={r => r.id}
        defaultSort={{ key: "date", dir: "desc" }}
        emptyText={filtered ? "Nothing matches these filters." : "No payments recorded yet."}
        rowActions={r => [
          { label: "Edit", icon: Pencil, onSelect: () => open(r.id), show: can("payments", "edit") },
          { label: "Delete", icon: Trash2, danger: true, onSelect: () => remove(r.id), show: can("payments", "delete") },
        ]}
      />

      <Dialog open={!!editing} onOpenChange={o => { if (!o) setEditId(null); }}>
        <DialogContent className="max-w-xl rounded-2xl">
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
            {can("payments", "delete") && (
              <Button variant="outline" onClick={() => editing && remove(editing.id)}
                className="rounded-xl text-destructive hover:text-destructive hover:bg-destructive/10">
                Cancel receipt
              </Button>
            )}
            <Button variant="outline" onClick={() => setEditId(null)} className="rounded-xl ml-auto">Close</Button>
            <Button onClick={save} className="btn-hero rounded-xl">Save</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
