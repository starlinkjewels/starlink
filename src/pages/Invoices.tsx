import { useAuth } from "@/lib/auth";
import { loadDb, fmtMoney, fmtDate, totalAdvance, balanceDue } from "@/lib/db";
import { Link } from "react-router-dom";
import { FileText, TrendingUp, CheckCircle2, AlertCircle, Clock } from "lucide-react";
import { usePagination } from "@/hooks/usePagination";
import { PaginationBar } from "@/components/PaginationBar";

export function InvoicesPage() {
  const { user } = useAuth();
  const db = loadDb();

  let list = db.invoices;
  if (user!.role === "client") list = list.filter(i => i.clientId === user!.clientId);
  list = [...list].sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));

  // Orders with advances (all roles see their own)
  let ordersWithAdvance = db.orders.filter(o => (o.advances || []).length > 0);
  if (user!.role === "client") ordersWithAdvance = ordersWithAdvance.filter(o => o.clientId === user!.clientId);
  if (user!.role === "employee") ordersWithAdvance = ordersWithAdvance.filter(o => o.assignedEmployeeId === user!.id);

  const totalPaid = list.filter(i => i.paid).reduce((s, i) => s + i.amount, 0);
  const totalPending = list.filter(i => !i.paid).reduce((s, i) => s + i.amount, 0);
  const totalAdvancePaid = ordersWithAdvance.reduce((s, o) => s + totalAdvance(o), 0);

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
          { label: "Paid", value: fmtMoney(totalPaid), icon: CheckCircle2, color: "text-success", bg: "bg-success/10" },
          { label: "Pending", value: fmtMoney(totalPending), icon: AlertCircle, color: "text-destructive", bg: "bg-destructive/10" },
          { label: "Advances Collected", value: fmtMoney(totalAdvancePaid), icon: TrendingUp, color: "text-brand-dark", bg: "bg-brand-light/10" },
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
        <div className="px-5 py-4 border-b border-border/60 flex items-center justify-between gap-2 flex-wrap">
          <h2 className="font-semibold text-brand-dark">All Invoices</h2>
          {list.length > 0 && <p className="text-xs text-muted-foreground">Showing {invStart + 1}–{invEnd} of {list.length}</p>}
        </div>

        {/* Desktop table */}
        <div className="hidden md:block">
          <table className="w-full text-sm">
            <thead className="bg-secondary/50 text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="text-left px-5 py-3">Invoice</th>
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
                const adv = o ? totalAdvance(o) : 0;
                const bal = o ? balanceDue(o) : inv.amount;
                return (
                  <tr key={inv.id} className="border-t border-border/40 hover:bg-secondary/30 transition-colors">
                    <td className="px-5 py-3.5">
                      <div className="flex items-center gap-2">
                        <FileText className="h-4 w-4 text-primary shrink-0" />
                        <span className="font-medium">{inv.number}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3.5">
                      {o && <Link to={`/orders/${o.id}`} className="text-primary hover:underline font-mono text-xs">{o.orderNumber}</Link>}
                    </td>
                    <td className="px-4 py-3.5 text-muted-foreground text-xs">{fmtDate(inv.createdAt)}</td>
                    <td className="px-4 py-3.5 text-right font-semibold">{fmtMoney(inv.amount)}</td>
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
                      {inv.paid
                        ? <span className="inline-flex items-center gap-1 text-xs font-medium text-success"><CheckCircle2 className="h-3 w-3" />Paid</span>
                        : <span className="inline-flex items-center gap-1 text-xs font-medium text-warning-foreground"><Clock className="h-3 w-3" />Pending</span>}
                    </td>
                  </tr>
                );
              })}
              {list.length === 0 && (
                <tr><td colSpan={7} className="p-12 text-center text-muted-foreground">No invoices yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Mobile cards */}
        <div className="md:hidden divide-y divide-border/40">
          {pagedInvoices.map(inv => {
            const o = db.orders.find(o => o.id === inv.orderId);
            const adv = o ? totalAdvance(o) : 0;
            const bal = o ? balanceDue(o) : inv.amount;
            return (
              <div key={inv.id} className="p-4 space-y-3">
                {/* Row 1: Invoice # + Status */}
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <FileText className="h-4 w-4 text-primary shrink-0" />
                    <span className="font-semibold text-sm">{inv.number}</span>
                  </div>
                  {inv.paid
                    ? <span className="inline-flex items-center gap-1 text-xs font-medium text-success bg-success/10 px-2 py-0.5 rounded-full"><CheckCircle2 className="h-3 w-3" />Paid</span>
                    : <span className="inline-flex items-center gap-1 text-xs font-medium text-warning-foreground bg-warning/10 px-2 py-0.5 rounded-full"><Clock className="h-3 w-3" />Pending</span>}
                </div>
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
                    <p className="text-xs font-semibold">{fmtMoney(inv.amount)}</p>
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
            <div className="p-12 text-center text-muted-foreground">No invoices yet.</div>
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
      {ordersWithAdvance.length > 0 && (
        <div className="card-luxe overflow-hidden">
          <div className="px-5 py-4 border-b border-border/60 flex items-center justify-between gap-2 flex-wrap">
            <div>
              <h2 className="font-semibold text-brand-dark">Advance Payment Ledger</h2>
              <p className="text-xs text-muted-foreground mt-0.5">All recorded advance payments per order</p>
            </div>
            {ordersWithAdvance.length > 0 && <p className="text-xs text-muted-foreground">Showing {ledStart + 1}–{ledEnd} of {ordersWithAdvance.length}</p>}
          </div>

          {/* Desktop table */}
          <div className="hidden md:block">
            <table className="w-full text-sm">
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
                      <td className="px-4 py-3.5 text-right font-semibold">{fmtMoney(o.amount)}</td>
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
              </tbody>
            </table>
          </div>

          {/* Mobile cards */}
          <div className="md:hidden divide-y divide-border/40">
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
                      <p className="text-xs font-semibold">{fmtMoney(o.amount)}</p>
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
