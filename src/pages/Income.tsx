import { useState, useMemo } from "react";
import { DataTable, CellTag, CellAmount, CellDate, type DataColumn } from "@/components/DataTable";
import { useAuth } from "@/lib/auth";
import { updateDb, fmtMoney, fmtDate, orderTotal } from "@/lib/db";
import { useDb } from "@/hooks/useDb";
import { Link } from "react-router-dom";
import {
  TrendingUp, TrendingDown, Download, Filter, X, Wallet,
  CreditCard, Receipt, Calendar, Trash2, Pencil, FileText, FileSpreadsheet,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AsyncButton } from "@/components/AsyncButton";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { usePagination } from "@/hooks/usePagination";
import { PaginationBar } from "@/components/PaginationBar";
import { fmtMoneyInr } from "@/lib/manufacturing";
import { downloadCsv, downloadLedgerPdf, fmtInrPlain } from "@/lib/ledgerExport";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { confirmBox } from "@/lib/confirm";
import { IfExport } from "@/components/IfExport";

/* ─── Types ─────────────────────────────────────────────────── */
type PassbookRowType =
  "Advance" | "Payment" | "Final Payment" | "Expense" | "Supplier Payment" | "Factory Charges" | "Locker Income" | "Locker Expense" | "Transfer";

type PassbookRow = {
  id: string;
  date: string; // ISO string
  currency: "USD" | "INR";
  direction: "in" | "out";
  type: PassbookRowType;
  clientId?: string;
  party: string; // client / locker / "Staff Expense"
  description: string;
  link?: { label: string; to: string };
  amount: number;
  editable?: { orderId: string }; // set only for Advance/Payment/Final Payment rows
};

/* ─── Helpers ────────────────────────────────────────────────── */
function toDateStr(iso: string) {
  return iso.slice(0, 10); // "YYYY-MM-DD"
}

const TYPE_TONE: Record<PassbookRowType, "neutral" | "green" | "red" | "amber" | "blue" | "violet"> = {
  "Advance": "blue",
  "Payment": "blue",
  "Final Payment": "green",
  "Expense": "red",
  "Supplier Payment": "amber",
  "Factory Charges": "violet",
  "Locker Income": "green",
  "Locker Expense": "red",
  "Transfer": "neutral",
};

/* ─── Page ───────────────────────────────────────────────────── */
export function IncomePage() {
  const { user } = useAuth();
  const db = useDb();
  const canEdit = user!.role !== "client";
  const isClient = user!.role === "client";

  /* Filters */
  const [curTab, setCurTab] = useState<"USD" | "INR">("USD");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo]     = useState("");
  const [clientFilter, setClientFilter] = useState("all");

  /* Edit/delete a transaction — corrects mistakes (wrong amount, typo, etc.).
     Only Advance/Payment/Final Payment rows are editable here — supplier/
     factory/locker/expense entries are managed on their own pages. */
  const [editing, setEditing] = useState<PassbookRow | null>(null);
  const [editAmount, setEditAmount] = useState("");
  const [editNote, setEditNote] = useState("");

  const openEdit = (row: PassbookRow) => {
    if (!canEdit || !row.editable) return;
    setEditing(row);
    setEditAmount(String(row.amount));
    setEditNote("");
  };

  const saveEdit = () => {
    if (!editing?.editable) return;
    const amt = parseFloat(editAmount);
    if (!amt || amt <= 0) { toast.error("Enter a valid amount"); return; }
    updateDb(d => {
      const o = d.orders.find(x => x.id === editing.editable!.orderId);
      const adv = o?.advances.find(a => a.id === editing.id);
      if (adv) { adv.amount = amt; if (editNote.trim()) adv.note = editNote.trim(); }
    });
    toast.success("Transaction updated");
    setEditing(null);
  };

  const deleteEdit = async () => {
    if (!editing?.editable) return;
    if (!(await confirmBox("Delete this transaction? This cannot be undone."))) return;
    updateDb(d => {
      const o = d.orders.find(x => x.id === editing.editable!.orderId);
      if (o) o.advances = o.advances.filter(a => a.id !== editing.id);
    });
    toast.success("Transaction deleted");
    setEditing(null);
  };

  /* Build the unified passbook — every payment in or out, anywhere in the
     app, so a real cash-basis view (and exact profit) is possible. */
  const allRows = useMemo<PassbookRow[]>(() => {
    const rows: PassbookRow[] = [];

    const orders = isClient ? db.orders.filter(o => o.clientId === user!.clientId) : db.orders;

    orders.forEach(order => {
      const client = db.clients.find(c => c.id === order.clientId);
      const clientName = client?.companyName ?? "Unknown Client";
      const total = orderTotal(order);
      const sorted = [...(order.advances ?? [])].sort((a, b) => +new Date(a.createdAt) - +new Date(b.createdAt));
      let cumulative = 0;
      sorted.forEach((adv, i) => {
        cumulative += adv.amount;
        const isFinal = cumulative >= total - 0.01;
        const type: PassbookRowType = isFinal ? "Final Payment" : i === 0 ? "Advance" : "Payment";
        rows.push({
          id: adv.id, date: adv.createdAt, currency: "USD", direction: "in", type,
          clientId: order.clientId, party: clientName,
          description: adv.note || "Payment received",
          link: { label: order.orderNumber, to: `/orders/${order.id}` },
          amount: adv.amount,
          editable: { orderId: order.id },
        });
      });
    });

    // Expenses and Locker transactions are internal business data — never
    // shown to a client viewing their own order/payment history.
    if (!isClient) {
      db.expenses.forEach(exp => {
        rows.push({
          id: exp.id, date: exp.createdAt, currency: exp.currency ?? "INR", direction: "out", type: "Expense",
          party: "Staff Expense", description: exp.title + (exp.note ? ` — ${exp.note}` : ""),
          link: { label: "Expenses", to: "/expenses" },
          amount: exp.amount,
        });
      });

      // Skip refType "clientPayment"/"expense" — those are just the Locker
      // mirror of the rows already added above; counting both would double them.
      (db.lockerTransactions ?? [])
        .filter(t => t.refType !== "clientPayment" && t.refType !== "expense")
        .forEach(t => {
          const locker = db.lockers.find(l => l.id === t.lockerId);
          const currency = t.currency || "INR";
          const direction: "in" | "out" = (t.type === "income" || t.type === "transfer_in") ? "in" : "out";
          const type: PassbookRowType =
            t.refType === "purchase" ? "Supplier Payment"
            : t.refType === "materialIssuance" ? "Factory Charges"
            : (t.type === "transfer_in" || t.type === "transfer_out") ? "Transfer"
            : direction === "in" ? "Locker Income" : "Locker Expense";
          rows.push({
            id: t.id, date: t.createdAt, currency, direction, type,
            party: locker?.name || "Locker", description: t.category || t.note || type,
            link: { label: "Locker", to: "/locker" },
            amount: t.amountInr,
          });
        });
    }

    return rows.sort((a, b) => +new Date(b.date) - +new Date(a.date));
  }, [db, user, isClient]);

  const tabRows = useMemo(() => allRows.filter(r => r.currency === curTab), [allRows, curTab]);

  /* Apply filters */
  const filtered = useMemo(() => {
    return tabRows.filter(r => {
      const d = toDateStr(r.date);
      if (dateFrom && d < dateFrom) return false;
      if (dateTo   && d > dateTo)   return false;
      if (clientFilter !== "all" && r.clientId !== clientFilter) return false;
      return true;
    });
  }, [tabRows, dateFrom, dateTo, clientFilter]);

  const fmt = curTab === "USD" ? fmtMoney : fmtMoneyInr;

  /* Summary totals */
  const totalIn = filtered.filter(r => r.direction === "in").reduce((s, r) => s + r.amount, 0);
  const totalOut = filtered.filter(r => r.direction === "out").reduce((s, r) => s + r.amount, 0);
  const net = totalIn - totalOut;

  /* Clients list for filter dropdown */
  const clients = isClient
    ? []
    : db.clients.slice().sort((a, b) => a.companyName.localeCompare(b.companyName));

  const hasActiveFilter = dateFrom || dateTo || clientFilter !== "all";

  /* The table — every filtered row, paged by the table itself; totals count them all. */
  const signed = (r: PassbookRow) => (r.direction === "in" ? r.amount : -r.amount);
  const columns: DataColumn<PassbookRow>[] = [
    { key: "date", header: "Date", always: true, kind: "date", sortValue: r => r.date,
      cell: r => <CellDate>{fmtDate(r.date)}</CellDate> },
    { key: "party", header: "Party", sortValue: r => r.party,
      cell: r => <span className="font-medium max-w-[160px] truncate block">{r.party}</span> },
    { key: "reference", header: "Reference", sortValue: r => r.link?.label ?? "",
      cell: r => (r.link ? <Link to={r.link.to} className="text-primary hover:underline font-mono text-xs font-semibold whitespace-nowrap">{r.link.label}</Link> : null) },
    { key: "type", header: "Type", sortValue: r => r.type,
      cell: r => (
        <CellTag tone={TYPE_TONE[r.type]}>
          <span className="inline-flex items-center gap-1">{r.direction === "in" ? <CreditCard className="h-3 w-3" /> : <Receipt className="h-3 w-3" />}{r.type}</span>
        </CellTag>
      ) },
    { key: "description", header: "Description", sortValue: r => r.description,
      cell: r => <span title={r.description} className="text-muted-foreground text-xs max-w-[200px] truncate block">{r.description}</span> },
    // Signed, so "high to low" puts the biggest money in first and the biggest out last.
    { key: "amount", header: "Amount", align: "right", kind: "number", sortValue: signed,
      cell: r => <CellAmount tone={r.direction}>{r.direction === "in" ? "+" : "−"}{fmt(r.amount)}</CellAmount> },
  ];

  const exportCsv = () => {
    downloadCsv(
      `Passbook-${curTab}`,
      ["Date", "Party", "Reference", "Type", "Description", `Money In (${curTab})`, `Money Out (${curTab})`],
      filtered.map(r => [
        fmtDate(r.date), r.party, r.link?.label || "", r.type, r.description,
        r.direction === "in" ? r.amount : "", r.direction === "out" ? r.amount : "",
      ]),
    );
  };

  const exportPdf = () => {
    downloadLedgerPdf({
      title: `Passbook (${curTab})`,
      subjectLines: [
        `Currency: ${curTab}`,
        hasActiveFilter ? "Filters applied — see on-screen view for details" : "All entries",
        `Report Generated: ${new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}`,
      ],
      summary: [
        { label: "Money In", value: curTab === "USD" ? fmtMoney(totalIn) : fmtInrPlain(totalIn) + " " + curTab },
        { label: "Money Out", value: curTab === "USD" ? fmtMoney(totalOut) : fmtInrPlain(totalOut) + " " + curTab },
        { label: "Net", value: curTab === "USD" ? fmtMoney(net) : fmtInrPlain(net) + " " + curTab },
      ],
      columns: [
        { header: "Date", x: 20 },
        { header: "Party", x: 45 },
        { header: "Type", x: 90 },
        { header: "In", x: 135 },
        { header: "Out", x: 160 },
      ],
      rows: filtered.map(r => [
        fmtDate(r.date), r.party.slice(0, 20), r.type,
        r.direction === "in" ? (curTab === "USD" ? fmtMoney(r.amount).replace("$", "") : fmtInrPlain(r.amount).replace("Rs. ", "")) : "—",
        r.direction === "out" ? (curTab === "USD" ? fmtMoney(r.amount).replace("$", "") : fmtInrPlain(r.amount).replace("Rs. ", "")) : "—",
      ]),
      filename: `Passbook-${curTab}`,
    });
  };

  return (
    <div className="max-w-7xl mx-auto space-y-5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h1 className="font-display text-2xl md:text-3xl text-brand-dark">Passbook</h1>
        <IfExport>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button disabled={filtered.length === 0} className="btn-hero rounded-xl gap-2">
              <Download className="h-4 w-4" /> Export
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={exportPdf}><FileText className="h-4 w-4 mr-2" /> Download PDF</DropdownMenuItem>
            <DropdownMenuItem onClick={exportCsv}><FileSpreadsheet className="h-4 w-4 mr-2" /> Download Excel (CSV)</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        </IfExport>
      </div>

      {/* ── Currency tabs — never blend USD client billing with INR sourcing/cost ── */}
      {!isClient && (
        <div className="flex gap-1 p-1 bg-secondary rounded-xl w-fit">
          {(["USD", "INR"] as const).map(c => (
            <button
              key={c}
              onClick={() => setCurTab(c)}
              className={`px-5 py-2 rounded-lg text-sm font-medium transition-all ${
                curTab === c ? "bg-white shadow-soft text-brand-dark" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {c === "USD" ? "Client Billing (USD)" : "Sourcing & Costs (INR)"}
            </button>
          ))}
        </div>
      )}

      {/* ── Summary Cards ── */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: "Money In",  value: fmt(totalIn),  icon: TrendingUp,  color: "text-success",    bg: "bg-success/10" },
          { label: "Money Out", value: fmt(totalOut), icon: TrendingDown, color: "text-destructive", bg: "bg-destructive/10" },
          { label: "Net",       value: fmt(net),      icon: Wallet,      color: net >= 0 ? "text-success" : "text-destructive", bg: "bg-primary/10" },
        ].map(s => (
          <div key={s.label} className="card-luxe p-4">
            <div className={`h-8 w-8 rounded-lg ${s.bg} grid place-items-center mb-3`}>
              <s.icon className={`h-4 w-4 ${s.color}`} />
            </div>
            <p className="text-lg font-display font-bold text-brand-dark truncate">{s.value}</p>
            <p className="text-xs text-muted-foreground mt-0.5">{s.label}</p>
          </div>
        ))}
      </div>

      {/* ── Filters ── */}
      <div className="card-luxe p-4">
        <div className="flex items-center gap-2 mb-3">
          <Filter className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-medium text-brand-dark">Filter</span>
          {hasActiveFilter && (
            <button
              onClick={() => { setDateFrom(""); setDateTo(""); setClientFilter("all"); }}
              className="ml-auto flex items-center gap-1 text-xs text-muted-foreground hover:text-destructive transition-colors"
            >
              <X className="h-3 w-3" /> Clear
            </button>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {/* Date From */}
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground flex items-center gap-1">
              <Calendar className="h-3 w-3" /> From Date
            </label>
            <input
              type="date"
              value={dateFrom}
              onChange={e => setDateFrom(e.target.value)}
              max={dateTo || undefined}
              className="w-full h-9 rounded-xl border border-border/80 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
            />
          </div>

          {/* Date To */}
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground flex items-center gap-1">
              <Calendar className="h-3 w-3" /> To Date
            </label>
            <input
              type="date"
              value={dateTo}
              onChange={e => setDateTo(e.target.value)}
              min={dateFrom || undefined}
              className="w-full h-9 rounded-xl border border-border/80 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
            />
          </div>

          {/* Client Filter — hidden for client role */}
          {!isClient && (
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Client</label>
              <Select value={clientFilter} onValueChange={setClientFilter}>
                <SelectTrigger className="h-9 rounded-xl"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Clients</SelectItem>
                  {clients.map(c => <SelectItem key={c.id} value={c.id}>{c.companyName}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>
      </div>

      {/* ── Table ── */}
      <div className="card-luxe overflow-hidden">
        <div className="px-5 py-4 border-b border-border/60 flex items-center justify-between gap-2 flex-wrap">
          <h2 className="font-semibold text-brand-dark">All Transactions</h2>
        </div>

        {/* Client payments open the edit dialog on a click; the rest are managed
            on their own pages, so their rows don't look clickable. Keyed on the
            tab and filters so a new view starts from its newest entry. */}
        <div className="p-3 sm:p-4">
          <DataTable
            resetKey={`${curTab}|${dateFrom}|${dateTo}|${clientFilter}`}
            id="passbook"
            noun="transaction"
            rows={filtered}
            columns={columns}
            rowKey={r => r.id}
            defaultSort={{ key: "date", dir: "desc" }}
            searchText={r => [r.party, r.link?.label, r.type, r.description].filter(Boolean).join(" ")}
            searchPlaceholder="Search party, reference, description"
            totalsLabel="Net"
            totals={{ amount: rows => { const n = rows.reduce((s, r) => s + signed(r), 0); return <span className={n >= 0 ? "text-success" : "text-destructive"}>{fmt(n)}</span>; } }}
            onRowClick={canEdit ? openEdit : undefined}
            canClickRow={r => !!r.editable}
            rowActions={canEdit ? r => [
              { label: "Edit", icon: Pencil, hint: "Correct the amount or note, or delete it", onSelect: () => openEdit(r), show: !!r.editable },
            ] : undefined}
            emptyText={
              <span className="inline-flex flex-col items-center gap-2">
                No transactions found.
                {hasActiveFilter && (
                  <button
                    onClick={() => { setDateFrom(""); setDateTo(""); setClientFilter("all"); }}
                    className="text-xs text-primary hover:underline"
                  >
                    Clear filters
                  </button>
                )}
              </span>
            }
          />
        </div>
      </div>

      {/* ── Edit / delete transaction dialog ── */}
      <Dialog open={!!editing} onOpenChange={open => !open && setEditing(null)}>
        <DialogContent className="max-w-2xl rounded-2xl">
          <DialogHeader><DialogTitle className="font-display text-2xl">Edit Transaction</DialogTitle></DialogHeader>
          {editing && (
            <div className="space-y-4">
              <div className="text-xs text-muted-foreground">
                {editing.party} · {editing.link?.label} · {fmtDate(editing.date)}
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Amount ($)</Label>
                <Input
                  type="number" min="0.01" step="0.01" autoFocus
                  value={editAmount}
                  onChange={e => setEditAmount(e.target.value)}
                  className="rounded-xl h-10"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Note</Label>
                <Input
                  value={editNote}
                  onChange={e => setEditNote(e.target.value)}
                  className="rounded-xl h-10"
                  placeholder={editing.description}
                />
              </div>
              <div className="flex items-center justify-between gap-2 pt-1">
                <Button
                  variant="outline" size="sm"
                  onClick={deleteEdit}
                  className="rounded-xl gap-2 text-destructive hover:text-destructive"
                >
                  <Trash2 className="h-3.5 w-3.5" /> Delete
                </Button>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => setEditing(null)} className="rounded-xl">Cancel</Button>
                  <AsyncButton size="sm" onClick={saveEdit} className="btn-hero rounded-xl">Save</AsyncButton>
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
