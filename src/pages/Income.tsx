import { useState, useMemo } from "react";
import { useAuth } from "@/lib/auth";
import { loadDb, fmtMoney, fmtDate, totalAdvance, orderTotal } from "@/lib/db";
import { Link } from "react-router-dom";
import {
  TrendingUp, Download, Filter, X, DollarSign,
  CreditCard, Receipt, Calendar,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { usePagination } from "@/hooks/usePagination";
import { PaginationBar } from "@/components/PaginationBar";

/* ─── Types ─────────────────────────────────────────────────── */
type IncomeRow = {
  id: string;
  date: string;          // ISO string
  clientId: string;
  clientName: string;
  orderId: string;
  orderNumber: string;
  type: "Advance" | "Invoice";
  description: string;
  amount: number;
};

/* ─── Helpers ────────────────────────────────────────────────── */
function toDateStr(iso: string) {
  return iso.slice(0, 10); // "YYYY-MM-DD"
}

function downloadCSV(rows: IncomeRow[]) {
  const headers = [
    "Date", "Client", "Order #", "Type", "Description", "Amount (USD)"
  ];
  const lines = [
    headers.join(","),
    ...rows.map(r => [
      fmtDate(r.date),
      `"${r.clientName.replace(/"/g, '""')}"`,
      r.orderNumber,
      r.type,
      `"${r.description.replace(/"/g, '""')}"`,
      r.amount.toFixed(2),
    ].join(","))
  ];
  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `Starlink-Income-Passbook-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

/* ─── Page ───────────────────────────────────────────────────── */
export function IncomePage() {
  const { user } = useAuth();
  const db = loadDb();

  /* Filters */
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo]     = useState("");
  const [clientFilter, setClientFilter] = useState("all");

  /* Build unified income rows */
  const allRows = useMemo<IncomeRow[]>(() => {
    const rows: IncomeRow[] = [];

    /* Scope orders to the current user */
    const orders =
      user!.role === "client"
        ? db.orders.filter(o => o.clientId === user!.clientId)
        : db.orders;

    orders.forEach(order => {
      const client = db.clients.find(c => c.id === order.clientId);
      const clientName = client?.companyName ?? "Unknown Client";

      /* ── Advance payments ── */
      (order.advances ?? []).forEach(adv => {
        rows.push({
          id: adv.id,
          date: adv.createdAt,
          clientId: order.clientId,
          clientName,
          orderId: order.id,
          orderNumber: order.orderNumber,
          type: "Advance",
          description: adv.note || "Advance payment",
          amount: adv.amount,
        });
      });

      /* ── Paid invoices ── */
      db.invoices
        .filter(inv => inv.orderId === order.id && inv.paid)
        .forEach(inv => {
          rows.push({
            id: inv.id,
            date: inv.createdAt,
            clientId: inv.clientId,
            clientName,
            orderId: order.id,
            orderNumber: order.orderNumber,
            type: "Invoice",
            description: `Invoice ${inv.number}`,
            amount: inv.amount,
          });
        });
    });

    /* Sort newest first */
    return rows.sort((a, b) => +new Date(b.date) - +new Date(a.date));
  }, [db, user]);

  /* Apply filters */
  const filtered = useMemo(() => {
    return allRows.filter(r => {
      const d = toDateStr(r.date);
      if (dateFrom && d < dateFrom) return false;
      if (dateTo   && d > dateTo)   return false;
      if (clientFilter !== "all" && r.clientId !== clientFilter) return false;
      return true;
    });
  }, [allRows, dateFrom, dateTo, clientFilter]);

  /* Summary totals */
  const totalIncome    = filtered.reduce((s, r) => s + r.amount, 0);
  const advanceTotal   = filtered.filter(r => r.type === "Advance").reduce((s, r) => s + r.amount, 0);
  const invoiceTotal   = filtered.filter(r => r.type === "Invoice").reduce((s, r) => s + r.amount, 0);

  /* Clients list for filter dropdown */
  const clients = user!.role === "client"
    ? []
    : db.clients.slice().sort((a, b) => a.companyName.localeCompare(b.companyName));

  const hasActiveFilter = dateFrom || dateTo || clientFilter !== "all";

  /* Pagination */
  const PAGE_SIZE = 15;
  const { paged, page, setPage, totalPages, start, end } = usePagination(filtered, PAGE_SIZE);

  return (
    <div className="max-w-5xl mx-auto space-y-5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h1 className="font-display text-2xl md:text-3xl text-brand-dark">Income Passbook</h1>
        <Button
          onClick={() => downloadCSV(filtered)}
          disabled={filtered.length === 0}
          className="btn-hero rounded-xl gap-2"
        >
          <Download className="h-4 w-4" />
          Download Excel
        </Button>
      </div>

      {/* ── Summary Cards ── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: "Total Income",      value: fmtMoney(totalIncome),   icon: TrendingUp,  color: "text-primary",     bg: "bg-primary/10" },
          { label: "From Invoices",     value: fmtMoney(invoiceTotal),  icon: Receipt,     color: "text-success",     bg: "bg-success/10" },
          { label: "From Advances",     value: fmtMoney(advanceTotal),  icon: CreditCard,  color: "text-brand-dark",  bg: "bg-brand-light/10" },
          { label: "Transactions",      value: filtered.length,         icon: DollarSign,  color: "text-muted-foreground", bg: "bg-secondary" },
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
          {user!.role !== "client" && (
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Client</label>
              <select
                value={clientFilter}
                onChange={e => setClientFilter(e.target.value)}
                className="w-full h-9 rounded-xl border border-border/80 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
              >
                <option value="all">All Clients</option>
                {clients.map(c => (
                  <option key={c.id} value={c.id}>{c.companyName}</option>
                ))}
              </select>
            </div>
          )}
        </div>
      </div>

      {/* ── Table ── */}
      <div className="card-luxe overflow-hidden">
        <div className="px-5 py-4 border-b border-border/60 flex items-center justify-between gap-2 flex-wrap">
          <h2 className="font-semibold text-brand-dark">All Transactions</h2>
          {filtered.length > 0 && (
            <p className="text-xs text-muted-foreground">
              Showing {start + 1}–{end} of {filtered.length}
            </p>
          )}
        </div>

        {/* Desktop table */}
        <div className="hidden md:block overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-secondary/50 text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="text-left px-5 py-3">Date</th>
                <th className="text-left px-4 py-3">Client</th>
                <th className="text-left px-4 py-3">Order #</th>
                <th className="text-left px-4 py-3">Type</th>
                <th className="text-left px-4 py-3">Description</th>
                <th className="text-right px-5 py-3">Amount</th>
              </tr>
            </thead>
            <tbody>
              {paged.map(row => (
                <tr key={row.id} className="border-t border-border/40 hover:bg-secondary/30 transition-colors">
                  <td className="px-5 py-3.5 text-muted-foreground text-xs whitespace-nowrap">
                    {fmtDate(row.date)}
                  </td>
                  <td className="px-4 py-3.5 font-medium max-w-[160px] truncate">
                    {row.clientName}
                  </td>
                  <td className="px-4 py-3.5">
                    <Link
                      to={`/orders/${row.orderId}`}
                      className="text-primary hover:underline font-mono text-xs font-semibold"
                    >
                      {row.orderNumber}
                    </Link>
                  </td>
                  <td className="px-4 py-3.5">
                    <span className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full
                      ${row.type === "Invoice"
                        ? "bg-success/10 text-success"
                        : "bg-primary/10 text-primary"}`}>
                      {row.type === "Invoice" ? <Receipt className="h-3 w-3" /> : <CreditCard className="h-3 w-3" />}
                      {row.type}
                    </span>
                  </td>
                  <td className="px-4 py-3.5 text-muted-foreground text-xs max-w-[200px] truncate">
                    {row.description}
                  </td>
                  <td className="px-5 py-3.5 text-right font-semibold text-brand-dark whitespace-nowrap">
                    {fmtMoney(row.amount)}
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={6} className="p-12 text-center text-muted-foreground">
                    No income records found.
                    {hasActiveFilter && (
                      <button
                        onClick={() => { setDateFrom(""); setDateTo(""); setClientFilter("all"); }}
                        className="block mx-auto mt-2 text-xs text-primary hover:underline"
                      >
                        Clear filters
                      </button>
                    )}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Mobile cards */}
        <div className="md:hidden divide-y divide-border/40">
          {paged.map(row => (
            <div key={row.id} className="p-4 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full
                  ${row.type === "Invoice"
                    ? "bg-success/10 text-success"
                    : "bg-primary/10 text-primary"}`}>
                  {row.type === "Invoice" ? <Receipt className="h-3 w-3" /> : <CreditCard className="h-3 w-3" />}
                  {row.type}
                </span>
                <span className="font-display font-bold text-brand-dark">{fmtMoney(row.amount)}</span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-medium truncate">{row.clientName}</p>
                <p className="text-xs text-muted-foreground shrink-0">{fmtDate(row.date)}</p>
              </div>
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs text-muted-foreground truncate">{row.description}</p>
                <Link
                  to={`/orders/${row.orderId}`}
                  className="text-primary hover:underline font-mono text-xs font-semibold shrink-0"
                >
                  {row.orderNumber}
                </Link>
              </div>
            </div>
          ))}
          {filtered.length === 0 && (
            <div className="p-12 text-center text-muted-foreground">
              No income records found.
              {hasActiveFilter && (
                <button
                  onClick={() => { setDateFrom(""); setDateTo(""); setClientFilter("all"); }}
                  className="block mx-auto mt-2 text-xs text-primary hover:underline"
                >
                  Clear filters
                </button>
              )}
            </div>
          )}
        </div>

        {/* Running total row */}
        {filtered.length > 0 && (
          <div className="px-5 py-3 border-t border-border/60 bg-secondary/30 flex items-center justify-between">
            <span className="text-xs text-muted-foreground">
              Total for {filtered.length} transaction{filtered.length !== 1 ? "s" : ""}
              {hasActiveFilter ? " (filtered)" : ""}
            </span>
            <span className="font-display font-bold text-brand-dark">{fmtMoney(totalIncome)}</span>
          </div>
        )}

        {totalPages > 1 && (
          <div className="px-5 border-t border-border/60">
            <PaginationBar
              page={page}
              totalPages={totalPages}
              onPageChange={setPage}
              label={`${start + 1}–${end} of ${filtered.length} transactions`}
            />
          </div>
        )}
      </div>
    </div>
  );
}
