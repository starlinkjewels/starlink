import { useState } from "react";
import { useAuth } from "@/lib/auth";
import {
  fmtMoney, fmtDate, totalAdvance, balanceDue, orderTotal, updateDb,
  invoiceOrderIds, orderInvoiced, createInvoiceFromOrders, recordOrderPayment,
} from "@/lib/db";
import type { Order, Invoice } from "@/lib/db";
import { useDb } from "@/hooks/useDb";
import { Link } from "react-router-dom";
import { FileText, CheckCircle2, AlertCircle, Clock, Search, Plus, DollarSign, Printer, Gift } from "lucide-react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { usePagination } from "@/hooks/usePagination";
import { PaginationBar } from "@/components/PaginationBar";
import { printInvoice, printBatchInvoice } from "@/lib/invoicePrint";

/** Whether an order has been dispatched, and when (local "Dispatch" step). */
function dispatchInfo(o: Order): { dispatched: boolean; date?: string } {
  const step = o.timeline.find(t => t.step === "Dispatch" && t.status === "done");
  return { dispatched: !!step || o.status === "Dispatched" || o.status === "Delivered", date: step?.date };
}

export function InvoicesPage() {
  const { user } = useAuth();
  const db = useDb();
  const isStaff = user!.role !== "client";
  const [q, setQ] = useState("");
  const [clientFilter, setClientFilter] = useState("all");
  const [ledgerQ, setLedgerQ] = useState("");
  const [ledgerClientFilter, setLedgerClientFilter] = useState("all");

  // Create-invoice selection (staff): which of the client's un-invoiced orders to bill.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // Invoice detail modal + inline per-order payment form.
  const [detailInvId, setDetailInvId] = useState<string | null>(null);
  const [payOrderId, setPayOrderId] = useState<string | null>(null);
  const [payAmount, setPayAmount] = useState("");
  const [payLockerId, setPayLockerId] = useState("");
  const [payRate, setPayRate] = useState("");
  const [payNote, setPayNote] = useState("");

  // ── Invoice list (filtered) ──
  let list = db.invoices;
  if (user!.role === "client") list = list.filter(i => i.clientId === user!.clientId);
  if (isStaff && clientFilter !== "all") list = list.filter(i => i.clientId === clientFilter);

  const ql = q.trim().toLowerCase();
  if (ql) {
    list = list.filter(inv => {
      const orders = invoiceOrderIds(inv).map(id => db.orders.find(o => o.id === id)).filter((o): o is Order => !!o);
      const client = db.clients.find(c => c.id === inv.clientId);
      const statusText = inv.paid ? "paid" : "pending";
      return inv.number.toLowerCase().includes(ql)
        || orders.some(o => o.orderNumber.toLowerCase().includes(ql))
        || (client?.companyName ?? "").toLowerCase().includes(ql)
        || statusText.includes(ql);
    });
  }
  list = [...list].sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));

  const clientOptions = user!.role === "client"
    ? []
    : db.clients.slice().sort((a, b) => a.companyName.localeCompare(b.companyName));

  // Live figures for an invoice, summed across ALL its orders (never the stale snapshot).
  const invLive = (inv: Invoice) => {
    const orders = invoiceOrderIds(inv).map(id => db.orders.find(o => o.id === id)).filter((o): o is Order => !!o);
    const amount = orders.length ? orders.reduce((s, o) => s + orderTotal(o), 0) : inv.amount;
    const adv = orders.reduce((s, o) => s + totalAdvance(o), 0);
    const bal = orders.reduce((s, o) => s + balanceDue(o), 0);
    const gift = orders.reduce((s, o) => s + (o.giftCardRedeemed || 0), 0);
    const paid = orders.length ? bal <= 0 : inv.paid;
    return { orders, amount, adv, bal, gift, paid };
  };

  // ── Create invoice: this client's priced, non-rejected, not-yet-invoiced orders. ──
  const eligible = clientFilter === "all" || !isStaff ? [] : db.orders
    .filter(o => o.clientId === clientFilter && o.amount > 0 && o.status !== "Rejected" && !orderInvoiced(db.invoices, o.id))
    .map(o => ({ o, disp: dispatchInfo(o) }))
    .sort((a, b) => {
      if (a.disp.dispatched !== b.disp.dispatched) return a.disp.dispatched ? -1 : 1;
      const ad = a.disp.date || a.o.createdAt, bd = b.disp.date || b.o.createdAt;
      return +new Date(bd) - +new Date(ad);
    });
  const eligibleIds = eligible.map(e => e.o.id);
  const selectedTotal = eligible.filter(e => selected.has(e.o.id)).reduce((s, e) => s + orderTotal(e.o), 0);

  const toggle = (id: string) => setSelected(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const toggleAll = () => setSelected(prev => prev.size === eligibleIds.length ? new Set() : new Set(eligibleIds));

  const generateInvoice = () => {
    if (clientFilter === "all") { toast.error("Select a client first"); return; }
    const ids = eligibleIds.filter(id => selected.has(id));
    if (!ids.length) { toast.error("Select at least one order"); return; }
    let created: Invoice | null = null;
    updateDb(d => { created = createInvoiceFromOrders(d, clientFilter, ids, new Date().toISOString()); });
    if (created) {
      toast.success(`Invoice ${(created as Invoice).number} created — ${ids.length} order${ids.length > 1 ? "s" : ""}`);
      setSelected(new Set());
    } else {
      toast.error("Those orders are already invoiced");
    }
  };

  // ── Per-order payment (order-wise collection from the invoice detail). ──
  const startPay = (orderId: string) => { setPayOrderId(orderId); setPayAmount(""); setPayLockerId(""); setPayRate(""); setPayNote(""); };
  const payLocker = db.lockers.find(l => l.id === payLockerId);
  const payNeedsRate = !!payLocker && (payLocker.currency || "INR") !== "USD";

  const submitPayment = (orderId: string) => {
    const o = db.orders.find(x => x.id === orderId);
    if (!o) return;
    const amt = parseFloat(payAmount);
    if (!amt || amt <= 0) { toast.error("Enter a valid amount"); return; }
    if (!payLockerId) { toast.error("Choose which locker this was deposited into"); return; }
    const rate = Number(payRate);
    if (payNeedsRate && (!rate || rate <= 0)) { toast.error("Enter the exchange rate"); return; }
    const depositAmt = payNeedsRate ? Math.round(amt * rate * 100) / 100 : amt;
    updateDb(d => {
      recordOrderPayment(d, orderId, {
        amount: amt, recordedBy: user!.id, at: new Date().toISOString(),
        note: payNote.trim() || undefined, lockerId: payLockerId, lockerAmount: depositAmt,
        exchangeRate: payNeedsRate ? rate : undefined,
      });
      const inv = d.invoices.find(i => i.id === detailInvId);
      if (inv) inv.paid = invoiceOrderIds(inv).every(oid => { const oo = d.orders.find(x => x.id === oid); return !oo || balanceDue(oo) <= 0; });
    });
    toast.success(`${fmtMoney(amt)} received for ${o.orderNumber}`);
    setPayOrderId(null); setPayAmount(""); setPayLockerId(""); setPayRate(""); setPayNote("");
  };

  const printInv = (inv: Invoice) => {
    const { orders } = invLive(inv);
    const client = db.clients.find(c => c.id === inv.clientId);
    if (orders.length <= 1 && orders[0]) printInvoice(orders[0], client, db.settings, inv.number);
    else if (orders.length) printBatchInvoice(orders, client, db.settings, inv.number, inv.createdAt.slice(0, 10));
    else toast.error("This invoice has no orders to print.");
  };

  // Orders with advances — the Advance Payment Ledger below.
  let ordersWithAdvanceBase = db.orders.filter(o => (o.advances || []).length > 0);
  if (user!.role === "client") ordersWithAdvanceBase = ordersWithAdvanceBase.filter(o => o.clientId === user!.clientId);
  if (user!.role === "employee") ordersWithAdvanceBase = ordersWithAdvanceBase.filter(o => o.assignedEmployeeId === user!.id);
  let ordersWithAdvance = ordersWithAdvanceBase;
  if (isStaff && ledgerClientFilter !== "all") ordersWithAdvance = ordersWithAdvance.filter(o => o.clientId === ledgerClientFilter);
  const lq = ledgerQ.trim().toLowerCase();
  if (lq) {
    ordersWithAdvance = ordersWithAdvance.filter(o => {
      const client = db.clients.find(c => c.id === o.clientId);
      return o.orderNumber.toLowerCase().includes(lq) || (client?.companyName ?? "").toLowerCase().includes(lq);
    });
  }

  // Summary — from live order data across all listed invoices.
  const invOrders = list.flatMap(inv => invoiceOrderIds(inv).map(id => db.orders.find(o => o.id === id)).filter((o): o is Order => !!o));
  const totalBilled      = invOrders.reduce((s, o) => s + orderTotal(o), 0);
  const totalReceived    = invOrders.reduce((s, o) => s + totalAdvance(o), 0);
  const totalOutstanding = invOrders.reduce((s, o) => s + balanceDue(o), 0);

  const PAGE_SIZE = 10;
  const { paged: pagedInvoices, page: invPage, setPage: setInvPage, totalPages: invTotalPages, start: invStart, end: invEnd } = usePagination(list, PAGE_SIZE);
  const { paged: pagedLedger, page: ledPage, setPage: setLedPage, totalPages: ledTotalPages, start: ledStart, end: ledEnd } = usePagination(ordersWithAdvance, PAGE_SIZE);

  const detailInv = detailInvId ? db.invoices.find(i => i.id === detailInvId) : undefined;

  return (
    <div className="max-w-7xl mx-auto space-y-5">
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
            <Input value={q} onChange={e => setQ(e.target.value)} placeholder="Search invoice, order, client…" className="pl-9 h-9 rounded-xl text-sm" />
          </div>
          {isStaff && (
            <Select value={clientFilter} onValueChange={v => { setClientFilter(v); setSelected(new Set()); }}>
              <SelectTrigger className="h-9 w-[160px] rounded-xl"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Clients</SelectItem>
                {clientOptions.map(c => <SelectItem key={c.id} value={c.id}>{c.companyName}</SelectItem>)}
              </SelectContent>
            </Select>
          )}
          {list.length > 0 && <p className="text-xs text-muted-foreground shrink-0">Showing {invStart + 1}–{invEnd} of {list.length}</p>}
        </div>

        {/* ── Create invoice from dispatched orders (staff) ── */}
        {isStaff && (
          <div className="px-5 py-3 border-b border-border/60 bg-secondary/20">
            <div className="flex items-center gap-2 flex-wrap">
              <Plus className="h-3.5 w-3.5 text-primary shrink-0" />
              <span className="text-xs font-medium text-brand-dark">Create invoice from dispatched orders</span>
              {clientFilter === "all" && <span className="text-xs text-muted-foreground">— pick a client above first</span>}
            </div>

            {clientFilter !== "all" && (
              eligible.length === 0 ? (
                <p className="text-xs text-muted-foreground mt-2">No un-invoiced orders for this client — every priced order is already on an invoice.</p>
              ) : (
                <div className="mt-3 space-y-2">
                  <label className="flex items-center gap-2 text-xs font-medium text-muted-foreground cursor-pointer">
                    <Checkbox checked={selected.size === eligibleIds.length && eligibleIds.length > 0} onCheckedChange={toggleAll} />
                    Select all ({eligible.length})
                  </label>
                  <div className="grid gap-1.5 max-h-64 overflow-y-auto pr-1">
                    {eligible.map(({ o, disp }) => (
                      <label key={o.id} className={`flex items-center gap-3 p-2 rounded-lg border cursor-pointer transition-colors ${selected.has(o.id) ? "border-primary bg-primary/5" : "border-border/70 hover:bg-secondary/50"}`}>
                        <Checkbox checked={selected.has(o.id)} onCheckedChange={() => toggle(o.id)} />
                        <span className="font-mono text-xs font-semibold">{o.orderNumber}</span>
                        <span className="text-xs text-muted-foreground truncate hidden sm:inline">{o.jewelleryType} · {o.metal}</span>
                        {disp.dispatched
                          ? <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-success/10 text-success">Dispatched{disp.date ? ` ${fmtDate(disp.date)}` : ""}</span>
                          : <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-secondary text-muted-foreground">{o.status}</span>}
                        <span className="ml-auto font-semibold text-sm shrink-0">{fmtMoney(orderTotal(o))}</span>
                      </label>
                    ))}
                  </div>
                  <div className="flex items-center justify-between gap-3 pt-1">
                    <span className="text-xs text-muted-foreground">{selected.size} selected · <span className="font-semibold text-foreground">{fmtMoney(selectedTotal)}</span></span>
                    <Button size="sm" onClick={generateInvoice} disabled={selected.size === 0} className="btn-hero rounded-xl gap-2 h-9">
                      <FileText className="h-3.5 w-3.5" /> Generate Invoice
                    </Button>
                  </div>
                </div>
              )
            )}
          </div>
        )}

        {/* Desktop table */}
        <div className="hidden md:block">
          <table className="table-luxe w-full text-sm">
            <thead className="bg-secondary/50 text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="text-left px-5 py-3">Invoice</th>
                <th className="text-left px-4 py-3">Client</th>
                <th className="text-left px-4 py-3">Orders</th>
                <th className="text-left px-4 py-3">Date</th>
                <th className="text-center px-4 py-3">Amount</th>
                <th className="text-center px-4 py-3">Received</th>
                <th className="text-center px-4 py-3">Balance</th>
                <th className="text-center px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {pagedInvoices.map(inv => {
                const { orders, amount, adv, bal, paid } = invLive(inv);
                const client = db.clients.find(c => c.id === inv.clientId);
                return (
                  <tr key={inv.id} onClick={() => { setDetailInvId(inv.id); setPayOrderId(null); }} className="border-t border-border/40 hover:bg-secondary/30 transition-colors cursor-pointer">
                    <td className="px-5 py-3.5">
                      <div className="flex items-center gap-2">
                        <FileText className="h-4 w-4 text-primary shrink-0" />
                        <span className="font-medium">{inv.number}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3.5 font-medium max-w-[160px] truncate">{client?.companyName || "—"}</td>
                    <td className="px-4 py-3.5">
                      {orders.length === 1
                        ? <Link to={`/orders/${orders[0].id}`} onClick={e => e.stopPropagation()} className="text-primary hover:underline font-mono text-xs">{orders[0].orderNumber}</Link>
                        : <span className="text-xs text-muted-foreground">{orders.length} orders</span>}
                    </td>
                    <td className="px-4 py-3.5 text-muted-foreground text-xs">{fmtDate(inv.createdAt)}</td>
                    <td className="px-4 py-3.5 text-center font-semibold">{fmtMoney(amount)}</td>
                    <td className="px-4 py-3.5 text-center">{adv > 0 ? <span className="text-success font-medium text-xs">{fmtMoney(adv)}</span> : <span className="text-muted-foreground text-xs">—</span>}</td>
                    <td className="px-4 py-3.5 text-center"><span className={`text-xs font-medium ${bal > 0 ? "text-destructive" : "text-success"}`}>{bal > 0 ? fmtMoney(bal) : "Cleared"}</span></td>
                    <td className="px-4 py-3.5 text-center">
                      {paid
                        ? <span className="inline-flex items-center gap-1 text-xs font-medium text-success"><CheckCircle2 className="h-3 w-3" />Paid</span>
                        : <span className="inline-flex items-center gap-1 text-xs font-medium text-warning-foreground"><Clock className="h-3 w-3" />Pending</span>}
                    </td>
                  </tr>
                );
              })}
              {list.length === 0 && (
                <tr><td colSpan={8} className="p-12 text-center text-muted-foreground">{ql ? "No invoices match your search." : "No invoices yet — select dispatched orders above to create one."}</td></tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Mobile cards */}
        <div className="md:hidden divide-y divide-border/40">
          {pagedInvoices.map(inv => {
            const { orders, amount, adv, bal, paid } = invLive(inv);
            const client = db.clients.find(c => c.id === inv.clientId);
            return (
              <div key={inv.id} onClick={() => { setDetailInvId(inv.id); setPayOrderId(null); }} className="p-4 space-y-3 cursor-pointer active:bg-secondary/30">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <FileText className="h-4 w-4 text-primary shrink-0" />
                    <span className="font-semibold text-sm">{inv.number}</span>
                    <span className="text-[11px] text-muted-foreground">· {orders.length} order{orders.length !== 1 ? "s" : ""}</span>
                  </div>
                  {paid
                    ? <span className="inline-flex items-center gap-1 text-xs font-medium text-success bg-success/10 px-2 py-0.5 rounded-full"><CheckCircle2 className="h-3 w-3" />Paid</span>
                    : <span className="inline-flex items-center gap-1 text-xs font-medium text-warning-foreground bg-warning/10 px-2 py-0.5 rounded-full"><Clock className="h-3 w-3" />Pending</span>}
                </div>
                <div className="flex items-center justify-between gap-2 text-xs">
                  <p className="font-medium truncate">{client?.companyName || "—"}</p>
                  <span className="text-muted-foreground">{fmtDate(inv.createdAt)}</span>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <div className="bg-secondary rounded-xl p-2.5 text-center">
                    <p className="text-[10px] text-muted-foreground mb-0.5">Amount</p>
                    <p className="text-xs font-semibold">{fmtMoney(amount)}</p>
                  </div>
                  <div className="bg-secondary rounded-xl p-2.5 text-center">
                    <p className="text-[10px] text-muted-foreground mb-0.5">Received</p>
                    <p className={`text-xs font-semibold ${adv > 0 ? "text-success" : "text-muted-foreground"}`}>{adv > 0 ? fmtMoney(adv) : "—"}</p>
                  </div>
                  <div className={`rounded-xl p-2.5 text-center ${bal > 0 ? "bg-destructive/10" : "bg-success/10"}`}>
                    <p className="text-[10px] text-muted-foreground mb-0.5">Balance</p>
                    <p className={`text-xs font-semibold ${bal > 0 ? "text-destructive" : "text-success"}`}>{bal > 0 ? fmtMoney(bal) : "✓"}</p>
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
            <PaginationBar page={invPage} totalPages={invTotalPages} onPageChange={setInvPage} label={`${invStart + 1}–${invEnd} of ${list.length} invoices`} />
          </div>
        )}
      </div>

      {/* Advance Payment Ledger section — staff only. Clients see ONLY the invoices
          that were generated for them, never their un-invoiced orders. */}
      {isStaff && ordersWithAdvanceBase.length > 0 && (
        <div className="card-luxe overflow-hidden">
          <div className="px-5 py-4 border-b border-border/60 flex items-center justify-between gap-3 flex-wrap">
            <div className="shrink-0">
              <h2 className="font-semibold text-brand-dark">Advance Payment Ledger</h2>
              <p className="text-xs text-muted-foreground mt-0.5">All recorded advance payments per order</p>
            </div>
            <div className="relative flex-1 min-w-[180px] sm:max-w-xs sm:ml-auto">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input value={ledgerQ} onChange={e => setLedgerQ(e.target.value)} placeholder="Search order, client…" className="pl-9 h-9 rounded-xl text-sm" />
            </div>
            {isStaff && (
              <Select value={ledgerClientFilter} onValueChange={setLedgerClientFilter}>
                <SelectTrigger className="h-9 w-[160px] rounded-xl"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Clients</SelectItem>
                  {clientOptions.map(c => <SelectItem key={c.id} value={c.id}>{c.companyName}</SelectItem>)}
                </SelectContent>
              </Select>
            )}
            {ordersWithAdvance.length > 0 && <p className="text-xs text-muted-foreground shrink-0">Showing {ledStart + 1}–{ledEnd} of {ordersWithAdvance.length}</p>}
          </div>

          <div className="hidden md:block">
            <table className="table-luxe w-full text-sm">
              <thead className="bg-secondary/50 text-xs uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="text-left px-5 py-3">Order</th>
                  <th className="text-left px-4 py-3">Client</th>
                  <th className="text-center px-4 py-3">Order Total</th>
                  <th className="text-center px-4 py-3">Advance Paid</th>
                  <th className="text-center px-4 py-3">Balance Due</th>
                </tr>
              </thead>
              <tbody>
                {pagedLedger.map(o => {
                  const client = db.clients.find(c => c.id === o.clientId);
                  const adv = totalAdvance(o);
                  const bal = balanceDue(o);
                  return (
                    <tr key={o.id} className="border-t border-border/40 hover:bg-secondary/30 transition-colors">
                      <td className="px-5 py-3.5"><Link to={`/orders/${o.id}`} className="text-primary hover:underline font-mono text-xs font-semibold">{o.orderNumber}</Link></td>
                      <td className="px-4 py-3.5 text-muted-foreground text-xs">{client?.companyName || "—"}</td>
                      <td className="px-4 py-3.5 text-center font-semibold">{fmtMoney(orderTotal(o))}</td>
                      <td className="px-4 py-3.5 text-center"><span className="text-success font-semibold">{fmtMoney(adv)}</span></td>
                      <td className="px-4 py-3.5 text-center"><span className={`font-semibold ${bal > 0 ? "text-destructive" : "text-success"}`}>{bal > 0 ? fmtMoney(bal) : "✓ Cleared"}</span></td>
                    </tr>
                  );
                })}
                {ordersWithAdvance.length === 0 && (
                  <tr><td colSpan={5} className="p-12 text-center text-muted-foreground">No orders match your search.</td></tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="md:hidden divide-y divide-border/40">
            {ordersWithAdvance.length === 0 && <div className="p-12 text-center text-muted-foreground">No orders match your search.</div>}
            {pagedLedger.map(o => {
              const client = db.clients.find(c => c.id === o.clientId);
              const adv = totalAdvance(o);
              const bal = balanceDue(o);
              return (
                <div key={o.id} className="p-4 space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <Link to={`/orders/${o.id}`} className="text-primary hover:underline font-mono font-semibold text-sm">{o.orderNumber}</Link>
                    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${bal > 0 ? "bg-destructive/10 text-destructive" : "bg-success/10 text-success"}`}>{bal > 0 ? "Outstanding" : "✓ Cleared"}</span>
                  </div>
                  {client && <p className="text-xs text-muted-foreground">{client.companyName}</p>}
                  <div className="grid grid-cols-3 gap-2">
                    <div className="bg-secondary rounded-xl p-2.5 text-center"><p className="text-[10px] text-muted-foreground mb-0.5">Total</p><p className="text-xs font-semibold">{fmtMoney(orderTotal(o))}</p></div>
                    <div className="bg-success/10 rounded-xl p-2.5 text-center"><p className="text-[10px] text-muted-foreground mb-0.5">Advance</p><p className="text-xs font-semibold text-success">{fmtMoney(adv)}</p></div>
                    <div className={`rounded-xl p-2.5 text-center ${bal > 0 ? "bg-destructive/10" : "bg-success/10"}`}><p className="text-[10px] text-muted-foreground mb-0.5">Balance</p><p className={`text-xs font-semibold ${bal > 0 ? "text-destructive" : "text-success"}`}>{bal > 0 ? fmtMoney(bal) : "✓"}</p></div>
                  </div>
                </div>
              );
            })}
          </div>

          {ledTotalPages > 1 && (
            <div className="px-5 border-t border-border/60">
              <PaginationBar page={ledPage} totalPages={ledTotalPages} onPageChange={setLedPage} label={`${ledStart + 1}–${ledEnd} of ${ordersWithAdvance.length} entries`} />
            </div>
          )}
        </div>
      )}

      {/* ── Invoice detail modal — orders + order-wise payment ── */}
      <Dialog open={!!detailInv} onOpenChange={o => { if (!o) { setDetailInvId(null); setPayOrderId(null); } }}>
        <DialogContent className="max-w-2xl rounded-2xl max-h-[90vh] overflow-y-auto">
          {detailInv && (() => {
            const { orders, amount, adv, bal, gift } = invLive(detailInv);
            const client = db.clients.find(c => c.id === detailInv.clientId);
            return (
              <>
                <DialogHeader>
                  <DialogTitle className="font-display text-2xl flex items-center gap-2">
                    <FileText className="h-5 w-5 text-primary" /> Invoice {detailInv.number}
                  </DialogTitle>
                </DialogHeader>
                <div className="space-y-4 mt-1">
                  <div className="flex items-center justify-between gap-3 text-sm flex-wrap">
                    <div>
                      <p className="font-medium">{client?.companyName || "—"}</p>
                      <p className="text-xs text-muted-foreground">{fmtDate(detailInv.createdAt)} · {orders.length} order{orders.length !== 1 ? "s" : ""}</p>
                    </div>
                    <Button size="sm" variant="outline" onClick={() => printInv(detailInv)} className="rounded-xl gap-2"><Printer className="h-3.5 w-3.5" /> Print Invoice</Button>
                  </div>

                  <div className="grid grid-cols-3 gap-2">
                    <div className="bg-secondary rounded-xl p-3 text-center"><p className="text-[10px] text-muted-foreground mb-0.5">Amount</p><p className="text-sm font-semibold">{fmtMoney(amount)}</p></div>
                    <div className="bg-success/10 rounded-xl p-3 text-center"><p className="text-[10px] text-muted-foreground mb-0.5">Received</p><p className="text-sm font-semibold text-success">{fmtMoney(adv)}</p></div>
                    <div className={`rounded-xl p-3 text-center ${bal > 0 ? "bg-destructive/10" : "bg-success/10"}`}><p className="text-[10px] text-muted-foreground mb-0.5">Balance</p><p className={`text-sm font-semibold ${bal > 0 ? "text-destructive" : "text-success"}`}>{bal > 0 ? fmtMoney(bal) : "✓ Cleared"}</p></div>
                  </div>

                  {gift > 0 && (
                    <div className="flex items-center justify-between rounded-xl bg-primary/5 border border-primary/20 px-3 py-2 text-sm">
                      <span className="flex items-center gap-1.5 text-muted-foreground"><Gift className="h-3.5 w-3.5 text-primary" /> Gift card redeemed</span>
                      <span className="font-semibold text-primary">−{fmtMoney(gift)}</span>
                    </div>
                  )}

                  <div className="space-y-2">
                    <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Orders on this invoice</p>
                    {orders.map(o => {
                      const oBal = balanceDue(o);
                      const oAdv = totalAdvance(o);
                      return (
                        <div key={o.id} className="rounded-xl border border-border/70 p-3">
                          <div className="flex items-center justify-between gap-3 flex-wrap">
                            <div className="min-w-0">
                              <Link to={`/orders/${o.id}`} className="text-primary hover:underline font-mono text-sm font-semibold">{o.orderNumber}</Link>
                              <p className="text-[11px] text-muted-foreground">{o.jewelleryType} · {fmtMoney(orderTotal(o))} · paid {fmtMoney(oAdv)}{o.giftCardRedeemed ? ` · gift −${fmtMoney(o.giftCardRedeemed)}` : ""}</p>
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                              <span className={`text-xs font-semibold ${oBal > 0 ? "text-destructive" : "text-success"}`}>{oBal > 0 ? `${fmtMoney(oBal)} due` : "✓ Cleared"}</span>
                              {isStaff && oBal > 0 && payOrderId !== o.id && (
                                <Button size="sm" variant="outline" onClick={() => startPay(o.id)} className="rounded-lg h-8 gap-1.5"><DollarSign className="h-3.5 w-3.5" /> Receive</Button>
                              )}
                            </div>
                          </div>

                          {/* Inline per-order payment form */}
                          {isStaff && payOrderId === o.id && (
                            <div className="mt-3 pt-3 border-t border-border/60 space-y-2.5">
                              <div className="grid grid-cols-2 gap-2.5">
                                <div>
                                  <Label className="text-xs">Amount Received ($)</Label>
                                  <div className="relative mt-1">
                                    <DollarSign className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                                    <Input type="number" min={0} step="0.01" value={payAmount} onChange={e => setPayAmount(e.target.value)} className="pl-8 h-9 rounded-xl" placeholder={String(oBal)} />
                                  </div>
                                </div>
                                <div>
                                  <Label className="text-xs">Deposited to locker</Label>
                                  <Select value={payLockerId} onValueChange={setPayLockerId}>
                                    <SelectTrigger className="h-9 rounded-xl mt-1"><SelectValue placeholder="Choose locker" /></SelectTrigger>
                                    <SelectContent>{db.lockers.map(l => <SelectItem key={l.id} value={l.id}>{l.name} ({l.currency || "INR"})</SelectItem>)}</SelectContent>
                                  </Select>
                                </div>
                              </div>
                              {payNeedsRate && (
                                <div>
                                  <Label className="text-xs">Exchange rate ($1 → {payLocker?.currency})</Label>
                                  <Input type="number" min={0} step="0.01" value={payRate} onChange={e => setPayRate(e.target.value)} className="h-9 rounded-xl mt-1" placeholder="e.g. 83.5" />
                                  {payAmount && Number(payRate) > 0 && <p className="text-[11px] text-muted-foreground mt-1">Deposit: {(Number(payAmount) * Number(payRate)).toLocaleString("en-IN")} {payLocker?.currency}</p>}
                                </div>
                              )}
                              <div>
                                <Label className="text-xs">Note (optional)</Label>
                                <Input value={payNote} onChange={e => setPayNote(e.target.value)} className="h-9 rounded-xl mt-1" placeholder="e.g. Bank transfer" />
                              </div>
                              <div className="flex items-center gap-2 justify-end">
                                <Button size="sm" variant="ghost" onClick={() => setPayOrderId(null)} className="rounded-lg h-8">Cancel</Button>
                                <Button size="sm" onClick={() => submitPayment(o.id)} className="btn-hero rounded-lg h-8">Save Payment</Button>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </>
            );
          })()}
        </DialogContent>
      </Dialog>
    </div>
  );
}
