import { useState } from "react";
import { useAuth } from "@/lib/auth";
import { fmtMoney, fmtDate, totalAdvance, balanceDue, orderTotal } from "@/lib/db";
import type { Order } from "@/lib/db";
import { useDb } from "@/hooks/useDb";
import { Link } from "react-router-dom";
import { FileText, TrendingUp, CheckCircle2, AlertCircle, Clock, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { usePagination } from "@/hooks/usePagination";
import { PaginationBar } from "@/components/PaginationBar";

export function InvoicesPage() {
  const { user } = useAuth();
  const db = useDb();
  const [q, setQ] = useState("");
  const [clientFilter, setClientFilter] = useState("all");
  const [ledgerQ, setLedgerQ] = useState("");
  const [ledgerClientFilter, setLedgerClientFilter] = useState("all");

  let list = db.invoices;
  if (user!.role === "client") list = list.filter(i => i.clientId === user!.clientId);
  if (user!.role !== "client" && clientFilter !== "all") list = list.filter(i => i.clientId === clientFilter);

  // Search by invoice #, linked order #, client name, or status.
  const ql = q.trim().toLowerCase();
  if (ql) {
    list = list.filter(inv => {
      const o = db.orders.find(x => x.id === inv.orderId);
      const client = o ? db.clients.find(c => c.id === o.clientId) : undefined;
      const statusText = inv.paid ? "paid" : "pending";
      return inv.number.toLowerCase().includes(ql)
        || (o?.orderNumber ?? "").toLowerCase().includes(ql)
        || (client?.companyName ?? "").toLowerCase().includes(ql)
        || statusText.includes(ql);
    });
  }
  list = [...list].sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));

  const clientOptions = user!.role === "client"
    ? []
    : db.clients.slice().sort((a, b) => a.companyName.localeCompare(b.companyName));

  // Orders with advances (all roles see their own)
  let ordersWithAdvanceBase = db.orders.filter(o => (o.advances || []).length > 0);
  if (user!.role === "client") ordersWithAdvanceBase = ordersWithAdvanceBase.filter(o => o.clientId === user!.clientId);
  if (user!.role === "employee") ordersWithAdvanceBase = ordersWithAdvanceBase.filter(o => o.assignedEmployeeId === user!.id);

  let ordersWithAdvance = ordersWithAdvanceBase;
  if (user!.role !== "client" && ledgerClientFilter !== "all") ordersWithAdvance = ordersWithAdvance.filter(o => o.clientId === ledgerClientFilter);

  const lq = ledgerQ.trim().toLowerCase();
  if (lq) {
    ordersWithAdvance = ordersWithAdvance.filter(o => {
      const client = db.clients.find(c => c.id === o.clientId);
      return o.orderNumber.toLowerCase().includes(lq) || (client?.companyName ?? "").toLowerCase().includes(lq);
    });
  }

  // Summary from LIVE order data (not the invoice's stale amount/paid snapshot),
  // so these tie exactly with the client Account Ledger: Billed = Received + Outstanding.
  const invOrders = list
    .map(inv => db.orders.find(o => o.id === inv.orderId))
    .filter((o): o is Order => !!o);
  const totalBilled      = invOrders.reduce((s, o) => s + orderTotal(o), 0);
  const totalReceived    = invOrders.reduce((s, o) => s + totalAdvance(o), 0);
  const totalOutstanding = invOrders.reduce((s, o) => s + balanceDue(o), 0);

  const PAGE_SIZE = 10;
  const { paged: pagedInvoices, page: invPage, setPage: setInvPage, totalPages: invTotalPages, start: invStart, end: invEnd } = usePagination(list, PAGE_SIZE);
  const { paged: pagedLedger, page: ledPage, setPage: setLedPage, totalPages: ledTotalPages, start: ledStart, end: ledEnd } = usePagination(ordersWithAdvance, PAGE_SIZE);

  return (
    <div className="max-w-5xl mx-auto space-y-5">
      <h1 className="font-display text-2xl md:text-3xl text-brand-dark">Invoices</h1>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: "Total Invoices", value: list.length, icon: FileText, color: "text-primary", bg: "bg-primary/10" },
          { label: "Billed", value: fmtMoney(totalBilled), icon: FileText, color: "text-brand-dark", bg: "bg-brand-light/10" },
          { label: "Received", value: fmtMoney(totalReceived), icon: CheckCircle2, color: "text-success", bg: "bg-success/10" },
          { label: "Outstanding", value: fmtMoney(totalOutstanding), icon: AlertCircle, color: "text-destructive", bg: "bg-destructive/10" },
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

      {/* Invoices section */}
      <div className="card-luxe overflow-hidden">
        <div className="px-5 py-4 border-b border-border/60 flex items-center justify-between gap-3 flex-wrap">
          <h2 className="font-semibold text-brand-dark shrink-0">All Invoices</h2>
          <div className="relative flex-1 min-w-[180px] sm:max-w-xs sm:ml-auto">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              value={q}
              onChange={e => setQ(e.target.value)}
              placeholder="Search invoice, order, client…"
              className="pl-9 h-9 rounded-xl text-sm"
            />
          </div>
          {user!.role !== "client" && (
            <select
              value={clientFilter}
              onChange={e => setClientFilter(e.target.value)}
              className="h-9 rounded-xl border border-border/80 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
            >
              <option value="all">All Clients</option>
              {clientOptions.map(c => (
                <option key={c.id} value={c.id}>{c.companyName}</option>
              ))}
            </select>
          )}
          {list.length > 0 && <p className="text-xs text-muted-foreground shrink-0">Showing {invStart + 1}–{invEnd} of {list.length}</p>}
        </div>

        {/* Desktop table */}
        <div className="hidden md:block">
          <table className="table-luxe w-full text-sm">
            <thead className="bg-secondary/50 text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="text-left px-5 py-3">Invoice</th>
                <th className="text-left px-4 py-3">Client</th>
                <th className="text-left px-4 py-3">Order</th>
                <th className="text-left px-4 py-3">Date</th>
                <th className="text-right px-4 py-3">Amount</th>
                <th className="text-right px-4 py-3">Advance</th>
                <th className="text-right px-4 py-3">Balance</th>
                <th className="text-left px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {pagedInvoices.map(inv => {
                const o = db.orders.find(o => o.id === inv.orderId);
                const client = db.clients.find(c => c.id === inv.clientId);
                const amount = o ? orderTotal(o) : inv.amount;
                const adv = o ? totalAdvance(o) : 0;
                const bal = o ? balanceDue(o) : inv.amount;
                const paid = o ? bal <= 0 : inv.paid;
                return (
                  <tr key={inv.id} className="border-t border-border/40 hover:bg-secondary/30 transition-colors">
                    <td className="px-5 py-3.5">
                      <div className="flex items-center gap-2">
                        <FileText className="h-4 w-4 text-primary shrink-0" />
                        <span className="font-medium">{inv.number}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3.5 font-medium max-w-[160px] truncate">{client?.companyName || "—"}</td>
                    <td className="px-4 py-3.5">
                      {o && <Link to={`/orders/${o.id}`} className="text-primary hover:underline font-mono text-xs">{o.orderNumber}</Link>}
                    </td>
                    <td className="px-4 py-3.5 text-muted-foreground text-xs">{fmtDate(inv.createdAt)}</td>
                    <td className="px-4 py-3.5 text-right font-semibold">{fmtMoney(amount)}</td>
                    <td className="px-4 py-3.5 text-right">
                      {adv > 0
                        ? <span className="text-success font-medium text-xs">{fmtMoney(adv)}</span>
                        : <span className="text-muted-foreground text-xs">—</span>}
                    </td>
                    <td className="px-4 py-3.5 text-right">
                      <span className={`text-xs font-medium ${bal > 0 ? "text-destructive" : "text-success"}`}>
                        {bal > 0 ? fmtMoney(bal) : "Cleared"}
                      </span>
                    </td>
                    <td className="px-4 py-3.5">
                      {paid
                        ? <span className="inline-flex items-center gap-1 text-xs font-medium text-success"><CheckCircle2 className="h-3 w-3" />Paid</span>
                        : <span className="inline-flex items-center gap-1 text-xs font-medium text-warning-foreground"><Clock className="h-3 w-3" />Pending</span>}
                    </td>
                  </tr>
                );
              })}
              {list.length === 0 && (
                <tr><td colSpan={8} className="p-12 text-center text-muted-foreground">{ql ? "No invoices match your search." : "No invoices yet."}</td></tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Mobile cards */}
        <div className="md:hidden divide-y divide-border/40">
          {pagedInvoices.map(inv => {
            const o = db.orders.find(o => o.id === inv.orderId);
            const client = db.clients.find(c => c.id === inv.clientId);
            const amount = o ? orderTotal(o) : inv.amount;
            const adv = o ? totalAdvance(o) : 0;
            const bal = o ? balanceDue(o) : inv.amount;
            const paid = o ? bal <= 0 : inv.paid;
            return (
              <div key={inv.id} className="p-4 space-y-3">
                {/* Row 1: Invoice # + Status */}
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <FileText className="h-4 w-4 text-primary shrink-0" />
                    <span className="font-semibold text-sm">{inv.number}</span>
                  </div>
                  {paid
                    ? <span className="inline-flex items-center gap-1 text-xs font-medium text-success bg-success/10 px-2 py-0.5 rounded-full"><CheckCircle2 className="h-3 w-3" />Paid</span>
                    : <span className="inline-flex items-center gap-1 text-xs font-medium text-warning-foreground bg-warning/10 px-2 py-0.5 rounded-full"><Clock className="h-3 w-3" />Pending</span>}
                </div>
                {/* Client name */}
                <p className="text-sm font-medium truncate">{client?.companyName || "—"}</p>
                {/* Row 2: Order link + Date */}
                <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                  {o
                    ? <Link to={`/orders/${o.id}`} className="text-primary hover:underline font-mono font-semibold">{o.orderNumber}</Link>
                    : <span>—</span>}
                  <span>{fmtDate(inv.createdAt)}</span>
                </div>
                {/* Row 3: Amount / Advance / Balance */}
                <div className="grid grid-cols-3 gap-2">
                  <div className="bg-secondary rounded-xl p-2.5 text-center">
                    <p className="text-[10px] text-muted-foreground mb-0.5">Amount</p>
                    <p className="text-xs font-semibold">{fmtMoney(amount)}</p>
                  </div>
                  <div className="bg-secondary rounded-xl p-2.5 text-center">
                    <p className="text-[10px] text-muted-foreground mb-0.5">Advance</p>
                    <p className={`text-xs font-semibold ${adv > 0 ? "text-success" : "text-muted-foreground"}`}>
                      {adv > 0 ? fmtMoney(adv) : "—"}
                    </p>
                  </div>
                  <div className={`rounded-xl p-2.5 text-center ${bal > 0 ? "bg-destructive/10" : "bg-success/10"}`}>
                    <p className="text-[10px] text-muted-foreground mb-0.5">Balance</p>
                    <p className={`text-xs font-semibold ${bal > 0 ? "text-destructive" : "text-success"}`}>
                      {bal > 0 ? fmtMoney(bal) : "✓"}
                    </p>
                  </div>
                </div>
              </div>
            );
          })}
          {list.length === 0 && (
            <div className="p-12 text-center text-muted-foreground">{ql ? "No invoices match your search." : "No invoices yet."}</div>
          )}
        </div>

        {invTotalPages > 1 && (
          <div className="px-5 border-t border-border/60">
            <PaginationBar
              page={invPage}
              totalPages={invTotalPages}
              onPageChange={setInvPage}
              label={`${invStart + 1}–${invEnd} of ${list.length} invoices`}
            />
          </div>
        )}
      </div>

      {/* Advance Payments section */}
      {ordersWithAdvanceBase.length > 0 && (
        <div className="card-luxe overflow-hidden">
          <div className="px-5 py-4 border-b border-border/60 flex items-center justify-between gap-3 flex-wrap">
            <div className="shrink-0">
              <h2 className="font-semibold text-brand-dark">Advance Payment Ledger</h2>
              <p className="text-xs text-muted-foreground mt-0.5">All recorded advance payments per order</p>
            </div>
            <div className="relative flex-1 min-w-[180px] sm:max-w-xs sm:ml-auto">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                value={ledgerQ}
                onChange={e => setLedgerQ(e.target.value)}
                placeholder="Search order, client…"
                className="pl-9 h-9 rounded-xl text-sm"
              />
            </div>
            {user!.role !== "client" && (
              <select
                value={ledgerClientFilter}
                onChange={e => setLedgerClientFilter(e.target.value)}
                className="h-9 rounded-xl border border-border/80 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
              >
                <option value="all">All Clients</option>
                {clientOptions.map(c => (
                  <option key={c.id} value={c.id}>{c.companyName}</option>
                ))}
              </select>
            )}
            {ordersWithAdvance.length > 0 && <p className="text-xs text-muted-foreground shrink-0">Showing {ledStart + 1}–{ledEnd} of {ordersWithAdvance.length}</p>}
          </div>

          {/* Desktop table */}
          <div className="hidden md:block">
            <table className="table-luxe w-full text-sm">
              <thead className="bg-secondary/50 text-xs uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="text-left px-5 py-3">Order</th>
                  <th className="text-left px-4 py-3">Client</th>
                  <th className="text-right px-4 py-3">Order Total</th>
                  <th className="text-right px-4 py-3">Advance Paid</th>
                  <th className="text-right px-4 py-3">Balance Due</th>
                </tr>
              </thead>
              <tbody>
                {pagedLedger.map(o => {
                  const client = db.clients.find(c => c.id === o.clientId);
                  const adv = totalAdvance(o);
                  const bal = balanceDue(o);
                  return (
                    <tr key={o.id} className="border-t border-border/40 hover:bg-secondary/30 transition-colors">
                      <td className="px-5 py-3.5">
                        <Link to={`/orders/${o.id}`} className="text-primary hover:underline font-mono text-xs font-semibold">{o.orderNumber}</Link>
                      </td>
                      <td className="px-4 py-3.5 text-muted-foreground text-xs">{client?.companyName || "—"}</td>
                      <td className="px-4 py-3.5 text-right font-semibold">{fmtMoney(orderTotal(o))}</td>
                      <td className="px-4 py-3.5 text-right">
                        <span className="text-success font-semibold">{fmtMoney(adv)}</span>
                      </td>
                      <td className="px-4 py-3.5 text-right">
                        <span className={`font-semibold ${bal > 0 ? "text-destructive" : "text-success"}`}>
                          {bal > 0 ? fmtMoney(bal) : "✓ Cleared"}
                        </span>
                      </td>
                    </tr>
                  );
                })}
                {ordersWithAdvance.length === 0 && (
                  <tr><td colSpan={5} className="p-12 text-center text-muted-foreground">No orders match your search.</td></tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Mobile cards */}
          <div className="md:hidden divide-y divide-border/40">
            {ordersWithAdvance.length === 0 && (
              <div className="p-12 text-center text-muted-foreground">No orders match your search.</div>
            )}
            {pagedLedger.map(o => {
              const client = db.clients.find(c => c.id === o.clientId);
              const adv = totalAdvance(o);
              const bal = balanceDue(o);
              return (
                <div key={o.id} className="p-4 space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <Link to={`/orders/${o.id}`} className="text-primary hover:underline font-mono font-semibold text-sm">{o.orderNumber}</Link>
                    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${bal > 0 ? "bg-destructive/10 text-destructive" : "bg-success/10 text-success"}`}>
                      {bal > 0 ? "Outstanding" : "✓ Cleared"}
                    </span>
                  </div>
                  {client && <p className="text-xs text-muted-foreground">{client.companyName}</p>}
                  <div className="grid grid-cols-3 gap-2">
                    <div className="bg-secondary rounded-xl p-2.5 text-center">
                      <p className="text-[10px] text-muted-foreground mb-0.5">Total</p>
                      <p className="text-xs font-semibold">{fmtMoney(orderTotal(o))}</p>
                    </div>
                    <div className="bg-success/10 rounded-xl p-2.5 text-center">
                      <p className="text-[10px] text-muted-foreground mb-0.5">Advance</p>
                      <p className="text-xs font-semibold text-success">{fmtMoney(adv)}</p>
                    </div>
                    <div className={`rounded-xl p-2.5 text-center ${bal > 0 ? "bg-destructive/10" : "bg-success/10"}`}>
                      <p className="text-[10px] text-muted-foreground mb-0.5">Balance</p>
                      <p className={`text-xs font-semibold ${bal > 0 ? "text-destructive" : "text-success"}`}>
                        {bal > 0 ? fmtMoney(bal) : "✓"}
                      </p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {ledTotalPages > 1 && (
            <div className="px-5 border-t border-border/60">
              <PaginationBar
                page={ledPage}
                totalPages={ledTotalPages}
                onPageChange={setLedPage}
                label={`${ledStart + 1}–${ledEnd} of ${ordersWithAdvance.length} entries`}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
