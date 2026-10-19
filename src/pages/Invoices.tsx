import { DataTable, CellAmount, type DataColumn } from "@/components/DataTable";
import { metalLabel } from "@/lib/metals";
import { AddNewItem, useAddNew } from "@/components/create/QuickCreate";
import { companiesOf, companyIdOfInvoice, hasCompanies } from "@/lib/companies";
import { companyIdOfClient } from "@/lib/companies";
import { useCan, useMayExport } from "@/hooks/useCan";
import { useState } from "react";
import { receiptForAdvance } from "@/lib/receipts";
import { useAuth } from "@/lib/auth";
import {
  fmtMoney, fmtDate, totalAdvance, balanceDue, orderTotal, updateDb, uid,
  invoiceOrderIds, createInvoiceFromOrders, recordOrderPayment,
  mainDiamondShape, applyCreditToBills,
  findInvoiceForOrder, worksOnClient, worksOnOrder, currentUserClients, keptQty,
} from "@/lib/db";
import { reachOf } from "@/lib/permissions";
import type { Order, Invoice } from "@/lib/db";
import { useDb } from "@/hooks/useDb";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { FileText, CheckCircle2, Clock, Plus, DollarSign, Printer, Gift, Undo2, Eye, Pencil, Trash2, XCircle } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { ActionSheet } from "@/components/ActionSheet";
import { SectionTitle } from "@/components/SectionTitle";
import { StatStrip, type TableFilter } from "@/components/TableToolbar";
import { MoreMenu, type MoreAction } from "@/components/MoreMenu";
import { buildInvoiceBlocks, type InvoicePayment } from "@/components/ClientInvoiceLedger";
import { ReceiptEditSheet, cancelReceiptFlow, loadReceipts, paymentLockReason } from "@/components/ReceiptEditSheet";
import { cancelCreditNoteFlow, creditNoteCancelBlocker } from "@/components/creditNoteCancel";
import { deleteInvoiceFlow, invoiceDeleteAccess, invoiceDeleteBlocker } from "@/lib/invoiceDelete";
import { needsAccess } from "@/lib/actionHints";
import { ReturnDialog, useMayReturn, printNote } from "@/components/SalesReturn";
import { invoiceCreditNotes, returnBlocker } from "@/lib/salesReturn";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { AsyncButton } from "@/components/AsyncButton";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { RateInput } from "@/components/CurrencyFields";
import { ccy, roundCcy } from "@/lib/currency";
import { printInvoice, printBatchInvoice } from "@/lib/invoicePrint";
import { reserveInvoiceNumber, releaseInvoiceNumber } from "@/lib/counters";
// The same rule the Orders page bills by, so the two lists can never disagree
// about what is ready to invoice.
import { invoiceBlocker } from "@/lib/invoiceBatch";
import { confirmBox } from "@/lib/confirm";
import { IfExport } from "@/components/IfExport";
import { companyById } from "@/lib/companies";
import { filled, lockerLabel, recorded, refLink, refNo, when, type Detail } from "@/components/rowDetails";
import { oneLine } from "@/components/MoneyEntryEditor";

/** Whether an order has been dispatched, and when (local "Dispatch" step). */
function dispatchInfo(o: Order): { dispatched: boolean; date?: string } {
  const step = o.timeline.find(t => t.step === "Dispatch" && t.status === "done");
  return { dispatched: !!step || o.status === "Dispatched" || o.status === "Delivered", date: step?.date };
}

export function InvoicesPage() {
  const { user } = useAuth();
  const can = useCan();
  const db = useDb();
  const addNew = useAddNew();
  const navigate = useNavigate();
  const mayExport = useMayExport();
  const isStaff = user!.role !== "client";
  // Arriving from an order's invoice badge: open with that invoice already
  // searched for, rather than landing on the whole list to hunt for it.
  const [sp] = useSearchParams();
  const [q, setQ] = useState(sp.get("q") ?? "");
  const [clientFilter, setClientFilter] = useState("all");
  // Each company bills on its own; shown once there is more than one.
  const [companyFilter, setCompanyFilter] = useState("all");
  const multiCo = hasCompanies(db.settings);
  const [ledgerQ, setLedgerQ] = useState("");
  const [ledgerClientFilter, setLedgerClientFilter] = useState("all");

  // Create-invoice selection (staff): which of the client's un-invoiced orders to bill.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // The create-invoice panel, opened from the page's main button.
  const [creating, setCreating] = useState(false);
  // Invoice detail modal + inline per-order payment form.
  const [detailInvId, setDetailInvId] = useState<string | null>(null);
  // Pieces sent back from an invoice — which orders, and how many of each to start with.
  const [returning, setReturning] = useState<{ inv: Invoice; start?: Record<string, number> } | null>(null);
  const mayReturn = useMayReturn();
  const [payOrderId, setPayOrderId] = useState<string | null>(null);
  const [payAmount, setPayAmount] = useState("");
  const [payLockerId, setPayLockerId] = useState("");
  // The locker's currency for $1 (₹ per $, A$ per $…).
  const [payRate, setPayRate] = useState<number | "">("");
  const [payNote, setPayNote] = useState("");

  // ── Invoice list (filtered) ──
  let list = db.invoices;
  if (user!.role === "client") list = list.filter(i => i.clientId === user!.clientId);
  // An employee who reaches only their own work: their clients' bills, and any
  // bill carrying an order of theirs.
  const ownReach = user!.role === "employee" && reachOf(user, db.roles ?? []) !== "all";
  if (ownReach) list = list.filter(i => {
    const c = db.clients.find(x => x.id === i.clientId);
    return (!!c && worksOnClient(db, user!, c)) || invoiceOrderIds(i).some(oid => { const o = db.orders.find(x => x.id === oid); return !!o && worksOnOrder(db, user!, o); });
  });
  if (isStaff && clientFilter !== "all") list = list.filter(i => i.clientId === clientFilter);
  if (isStaff && companyFilter !== "all") list = list.filter(i => companyIdOfInvoice(i) === companyFilter);

  const ql = q.trim().toLowerCase();
  if (ql) {
    list = list.filter(inv => {
      const orders = invoiceOrderIds(inv).map(id => db.orders.find(o => o.id === id)).filter((o): o is Order => !!o);
      const client = db.clients.find(c => c.id === inv.clientId);
      const statusText = inv.paid ? "paid" : "pending";
      // The number it used to carry counts too — a client ringing up about the
      // copy they hold quotes the old one.
      return inv.number.toLowerCase().includes(ql)
        || (inv.previousNumber ?? "").toLowerCase().includes(ql)
        || orders.some(o => o.orderNumber.toLowerCase().includes(ql))
        || (client?.companyName ?? "").toLowerCase().includes(ql)
        || statusText.includes(ql);
    });
  }
  list = [...list].sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));

  const clientOptions = user!.role === "client"
    ? []
    : (ownReach ? currentUserClients(db, user!) : db.clients).slice().sort((a, b) => a.companyName.localeCompare(b.companyName));

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

  // ── Create invoice: DISPATCHED, priced, not-yet-invoiced orders only. ──
  // Undispatched work used to be listed here too, just sorted lower, so it could
  // be ticked by mistake — which is how a bill went out for a piece that had not
  // shipped. createInvoiceFromOrders() refuses them now as well; this keeps them
  // off the screen so the refusal never has to fire.
  const eligible = clientFilter === "all" || !isStaff ? [] : db.orders
    .filter(o => o.clientId === clientFilter && invoiceBlocker(db, o) === null)
    .map(o => ({ o, disp: dispatchInfo(o) }))
    .sort((a, b) => {
      const ad = a.disp.date || a.o.createdAt, bd = b.disp.date || b.o.createdAt;
      return +new Date(bd) - +new Date(ad);
    });
  const eligibleIds = eligible.map(e => e.o.id);
  // The client's orders that are not on an invoice and cannot be yet — shown
  // with the reason, so an empty list never reads as "nothing to do".
  const notYet = clientFilter === "all" || !isStaff ? [] : db.orders
    .filter(o => o.clientId === clientFilter && !o.forReadyStock && o.status !== "Rejected" && !findInvoiceForOrder(db.invoices ?? [], o.id))
    .map(o => ({ o, blocker: invoiceBlocker(db, o) }))
    .filter(x => x.blocker !== null)
    .map(({ o, blocker }) => ({
      o,
      why: blocker === "Not dispatched yet." ? (o.status === "Ready" ? "Ready — dispatch it to bill it" : `${o.status} — not dispatched yet`)
        : blocker === "No price set on this order." ? "No price set" : blocker!.replace(/\.$/, ""),
    }))
    .sort((a, b) => +new Date(b.o.createdAt) - +new Date(a.o.createdAt));
  const selectedTotal = eligible.filter(e => selected.has(e.o.id)).reduce((s, e) => s + orderTotal(e.o), 0);

  const toggle = (id: string) => setSelected(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const toggleAll = () => setSelected(prev => prev.size === eligibleIds.length ? new Set() : new Set(eligibleIds));

  const generateInvoice = async () => {
    if (clientFilter === "all") { toast.error("Select a client first"); return; }
    const ids = eligibleIds.filter(id => selected.has(id));
    if (!ids.length) { toast.error("Select at least one order"); return; }
    let created: Invoice | null = null;
    // Claim the number in the database first, so two people invoicing at the same
    // moment can never be handed the same invoice number.
    // Each company numbers its own invoices; the client's decides which series.
    const companyId = companyIdOfClient(db.clients.find(c => c.id === clientFilter));
    const number = await reserveInvoiceNumber(db.invoices || [], db.settings, companyId);
    try {
      updateDb(d => { created = createInvoiceFromOrders(d, clientFilter, ids, new Date().toISOString(), number); });
    } catch (e) {
      // The write blew up, so the number was never used. Give it back before
      // the error goes up, or the sequence skips one for good.
      await releaseInvoiceNumber(number, companyId);
      throw e;
    }
    if (created) {
      toast.success(`Invoice ${(created as Invoice).number} created — ${ids.length} order${ids.length > 1 ? "s" : ""}`);
      setSelected(new Set());
    } else {
      // Nothing was written, so the number was never used — give it back
      // rather than leave a hole in the sequence.
      await releaseInvoiceNumber(number, companyId);
      toast.error("Those orders are already invoiced");
    }
  };

  // ── Per-order payment (order-wise collection from the invoice detail). ──
  const startPay = (orderId: string) => { setPayOrderId(orderId); setPayAmount(""); setPayLockerId(""); setPayRate(""); setPayNote(""); };
  const payLocker = db.lockers.find(l => l.id === payLockerId);
  const payLockerCcy = ccy(payLocker?.currency);
  // Billed in USD: a locker in any other currency needs the rate.
  const payNeedsRate = !!payLocker && payLockerCcy !== "USD";
  // A rate belongs to one currency: picking a locker in another starts it
  // afresh (from Settings) instead of carrying ₹83 into an AUD locker.
  const pickPayLocker = (v: string) => {
    const next = db.lockers.find(l => l.id === v);
    if (!next || ccy(next.currency) !== payLockerCcy) setPayRate("");
    setPayLockerId(v);
  };

  const submitPayment = async (orderId: string) => {
    const o = db.orders.find(x => x.id === orderId);
    if (!o) return;
    const amt = parseFloat(payAmount);
    if (!amt || amt <= 0) { toast.error("Enter a valid amount"); return; }
    if (!payLockerId) { toast.error("Choose which locker this was deposited into"); return; }
    const rate = Number(payRate);
    if (payNeedsRate && (!rate || rate <= 0)) { toast.error("Enter the exchange rate"); return; }
    const depositAmt = payNeedsRate ? roundCcy(amt * rate, payLockerCcy) : amt;
    // Minted here so the payment can be given its receipt number afterwards.
    const advanceId = uid("adv_");
    const txnId = uid("ltx_");
    const at = new Date().toISOString();
    let applied = 0;
    updateDb(d => {
      applied = recordOrderPayment(d, orderId, {
        amount: amt, recordedBy: user!.id, at,
        note: payNote.trim() || undefined, lockerId: payLockerId, lockerAmount: depositAmt,
        exchangeRate: payNeedsRate ? rate : undefined,
        advanceId, lockerTxnId: txnId,
      }).applied;
      const inv = d.invoices.find(i => i.id === detailInvId);
      if (inv) inv.paid = invoiceOrderIds(inv).every(oid => { const oo = d.orders.find(x => x.id === oid); return !oo || balanceDue(oo) <= 0; });
    });
    let receiptNo = "";
    if (applied > 0) {
      try {
        const r = await receiptForAdvance({
          // The whole amount received: what went past this order's balance
          // is credit this receipt left, and comes back off if it is cancelled.
          clientId: o.clientId, advanceIds: [advanceId], amountUsd: amt,
          date: at, method: payNote.trim() || "Payment received",
          lockerTxnId: payLockerId ? txnId : undefined, userId: user!.id,
        });
        receiptNo = ` · ${r.receiptNo}`;
      } catch {
        toast.error("Payment saved, but its receipt number could not be reserved");
      }
    }
    toast.success(`${fmtMoney(amt)} received for ${o.orderNumber}${receiptNo}`);
    setPayOrderId(null); setPayAmount(""); setPayLockerId(""); setPayRate(""); setPayNote("");
  };

  const printInv = (inv: Invoice) => {
    const { orders } = invLive(inv);
    const client = db.clients.find(c => c.id === inv.clientId);
    if (orders.length <= 1 && orders[0]) printInvoice(orders[0], client, db.settings, inv.number, mainDiamondShape(db, orders[0].id));
    else if (orders.length) printBatchInvoice(orders, client, db.settings, inv.number, inv.createdAt.slice(0, 10), Object.fromEntries(orders.map(o => [o.id, mainDiamondShape(db, o.id) ?? ""])));
    else toast.error("This invoice has no orders to print.");
  };

  // Orders with advances — the Advance Payment Ledger below.
  let ordersWithAdvanceBase = db.orders.filter(o => (o.advances || []).length > 0);
  if (user!.role === "client") ordersWithAdvanceBase = ordersWithAdvanceBase.filter(o => o.clientId === user!.clientId);
  if (ownReach) ordersWithAdvanceBase = ordersWithAdvanceBase.filter(o => worksOnOrder(db, user!, o));
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

  // Each invoice's live figures, worked out once for the table.
  const invRows = list.map(inv => ({ inv, client: db.clients.find(c => c.id === inv.clientId), ...invLive(inv) }));

  // The client filter is also the client being invoiced: a new pick starts
  // the order ticks afresh, wherever it is made.
  const pickClient = (v: string) => { setClientFilter(v); setSelected(new Set()); };
  // Staff narrow the list by client (and company, once there are several),
  // behind the table's one Filters button.
  const invoiceFilters: TableFilter[] = [];
  if (isStaff) invoiceFilters.push({
    kind: "select", label: "Client", allLabel: "All Clients", value: clientFilter === "all" ? "" : clientFilter,
    onChange: v => pickClient(v || "all"),
    options: clientOptions.map(c => ({ value: c.id, label: c.companyName })),
  });
  if (isStaff && multiCo) invoiceFilters.push({
    kind: "select", label: "Company", allLabel: "All companies", value: companyFilter === "all" ? "" : companyFilter,
    onChange: v => setCompanyFilter(v || "all"),
    options: companiesOf(db.settings).map(c => ({ value: c.id, label: c.name })),
  });

  // The Advance Payment Ledger, one order a row, live from the order's payments.
  const ledgerClient = (o: Order) => db.clients.find(c => c.id === o.clientId)?.companyName ?? "";
  const ledgerColumns: DataColumn<Order>[] = [
    { key: "order", header: "Order", always: true, sortValue: o => o.orderNumber,
      cell: o => <Link to={`/orders/${o.id}`} className="text-primary hover:underline font-mono text-xs font-semibold whitespace-nowrap">{o.orderNumber}</Link> },
    { key: "client", header: "Client", sortValue: ledgerClient,
      cell: o => <span className="text-muted-foreground text-xs max-w-[180px] truncate block">{ledgerClient(o) || "—"}</span> },
    { key: "total", header: "Order total", align: "right", kind: "number", sortValue: o => orderTotal(o),
      cell: o => <CellAmount>{fmtMoney(orderTotal(o))}</CellAmount> },
    { key: "advance", header: "Advance paid", align: "right", kind: "number", sortValue: o => totalAdvance(o),
      cell: o => <CellAmount tone="in">{fmtMoney(totalAdvance(o))}</CellAmount> },
    { key: "balance", header: "Balance due", align: "right", kind: "number", sortValue: o => balanceDue(o),
      cell: o => { const bal = balanceDue(o); return bal > 0 ? <CellAmount tone="out">{fmtMoney(bal)}</CellAmount> : <span className="text-muted-foreground font-medium whitespace-nowrap">✓ Cleared</span>; } },
  ];
  const ledgerSum = (rows: Order[], f: (o: Order) => number) => rows.reduce((s, o) => s + f(o), 0);

  // An opened ledger row (staff only, as the ledger is): every payment on the
  // order — amount, when, the receipt, the account it went into, who took it —
  // the invoice it is billed on, the client's page and any gift card used.
  const ledgerDetails = (o: Order): Detail[] => {
    const inv = findInvoiceForOrder(db.invoices ?? [], o.id);
    const pays = [...(o.advances ?? [])].sort((a, b) => +new Date(a.createdAt) - +new Date(b.createdAt));
    return filled([
      { label: pays.length > 1 ? `Payments (${pays.length})` : "Payment", value: (
        <ul className="space-y-0.5">
          {pays.map(a => {
            const rcpt = a.receiptId ? (db.clientReceipts ?? []).find(r => r.id === a.receiptId) : undefined;
            const bits = [when(a.createdAt), rcpt && `Receipt ${rcpt.receiptNo}`, a.fromCredit && "from credit", lockerLabel(db, a.lockerId), a.note, recorded(db, undefined, a.recordedBy)].filter(Boolean);
            return (
              <li key={a.id}>
                <span className="font-medium tabular-nums">{fmtMoney(a.amount)}</span>
                <span className="text-muted-foreground"> · {bits.join(" · ")}</span>
              </li>
            );
          })}
        </ul>
      ) },
      !!inv && { label: "Invoice", value: (
        <button type="button" onClick={() => { setDetailInvId(inv.id); setPayOrderId(null); }} className="text-primary hover:underline font-medium">{inv.number}</button>
      ) },
      can("clients") && { label: "Client page", value: refLink(`/clients/${o.clientId}`, ledgerClient(o) || "Client") },
      !!o.giftCardRedeemed && { label: "Gift card used", value: fmtMoney(o.giftCardRedeemed) },
      { label: "Status", value: o.status },
    ]);
  };

  // An invoice opened under its row — a quick look; a click on the row still
  // opens the whole invoice. When it was raised, each order on it with what is
  // still due, credit notes against it, gift cards used, and (staff) the
  // receipts sent for it and the company that issued it.
  const invoiceDetails = (r: (typeof invRows)[number]): Detail[] => {
    const notes = invoiceCreditNotes(db, r.orders.map(o => o.id));
    const receipts = isStaff ? (db.clientReceipts ?? []).filter(x => x.invoiceId === r.inv.id) : [];
    return filled([
      { label: "Raised", value: when(r.inv.createdAt) },
      { label: "Previous number", value: r.inv.previousNumber },
      r.orders.length > 0 && { label: r.orders.length > 1 ? `Orders (${r.orders.length})` : "Order", value: (
        <ul className="space-y-0.5">
          {r.orders.map(o => {
            const due = balanceDue(o);
            return (
              <li key={o.id}>
                {/* A client opens their own orders, as the Orders column lets them. */}
                {refLink(`/orders/${o.id}`, o.orderNumber, !isStaff || can("orders"))}
                <span className="text-muted-foreground"> · {fmtMoney(orderTotal(o))} · {due > 0 ? `${fmtMoney(due)} due` : "paid"}</span>
              </li>
            );
          })}
        </ul>
      ) },
      notes.length > 0 && { label: notes.length > 1 ? "Credit notes" : "Credit note", value: notes.map(n => `${n.no} · ${n.qty} pc${n.qty !== 1 ? "s" : ""} · −${fmtMoney(n.creditUsd)}`).join(", ") },
      r.gift > 0 && { label: "Gift card used", value: fmtMoney(r.gift) },
      receipts.length > 0 && { label: receipts.length > 1 ? "Receipts" : "Receipt", value: refNo(receipts.map(x => x.receiptNo).join(", ")) },
      isStaff && can("clients") && !!r.client && { label: "Client page", value: refLink(`/clients/${r.client.id}`, r.client.companyName) },
      isStaff && multiCo && { label: "Company", value: companyById(db.settings, r.inv.companyId).name },
    ]);
  };


  /**
   * Put the client's held credit against this invoice.
   *
   * Only credit moves — money already sitting on another invoice stays where it
   * was put. This used to pool everything the client had ever paid and lay it
   * down again with this invoice first, which settled this one by un-settling
   * others.
   */
  const applyCreditHere = async (invoiceId: string, number: string, clientId: string) => {
    const credit = db.clients.find(c => c.id === clientId)?.creditBalance || 0;
    if (credit <= 0) { toast.error("This client has no credit to apply"); return; }
    if (!(await confirmBox(`Put ${fmtMoney(credit)} of credit against invoice ${number}?\n\nOnly their unapplied credit moves. Money already on another invoice stays where it is.`))) return;
    let applied = 0;
    updateDb(d => { applied = applyCreditToBills(d, clientId, user!.id, new Date().toISOString(), "Credit applied", invoiceId); });
    if (applied > 0) toast.success(`${fmtMoney(applied)} applied to invoice ${number}`);
    else toast.error("Nothing left to settle on this invoice");
  };

  const detailInv = detailInvId ? db.invoices.find(i => i.id === detailInvId) : undefined;

  // ── Managing the record ──
  // An invoice follows its orders, so it is never edited; it is deleted only
  // while nothing has happened on it (lib/invoiceDelete.ts). Payments on it are
  // corrected or cancelled through their receipts; a credit note by cancelling
  // the return. Anything that can't be done is greyed with the reason.
  const [editReceiptId, setEditReceiptId] = useState<string | null>(null);
  const openInvoice = (id: string) => { setDetailInvId(id); setPayOrderId(null); };
  // An admin only, as when Settings was the one place to do it — the rules
  // let any staff member write invoices, so this is the guard.
  const invDeleteDenied = invoiceDeleteAccess(user);
  const invDeleteWhy = (inv: Invoice) => invDeleteDenied ?? invoiceDeleteBlocker(db, inv);
  const removeInvoice = async (inv: Invoice) => {
    if (await deleteInvoiceFlow(inv.id, user) && detailInvId === inv.id) { setDetailInvId(null); setPayOrderId(null); }
  };
  const NO_EDIT = "Edit the order's price instead";
  const invoiceActions = (inv: Invoice, opened = false): MoreAction[] => {
    const delWhy = invDeleteWhy(inv);
    return [
      { label: "View", icon: Eye, onSelect: () => openInvoice(inv.id), show: !opened },
      { label: "Edit", icon: Pencil, onSelect: () => {}, disabled: true, hint: NO_EDIT, show: isStaff },
      { label: "Print", icon: Printer, onSelect: () => printInv(inv), show: mayExport && !opened },
      { label: "Delete", icon: Trash2, danger: true, onSelect: () => removeInvoice(inv), show: isStaff, disabled: !!delWhy,
        hint: oneLine(delWhy) ?? "Orders and payments stay" },
    ];
  };
  const mayPayEdit = isStaff && can("payments", "edit");
  const mayPayDelete = isStaff && can("payments", "delete");
  const paymentActions = (p: InvoicePayment): MoreAction[] => {
    const lock = paymentLockReason(db, p);
    return [
      { label: "Edit", icon: Pencil, disabled: !!lock || !mayPayEdit,
        hint: oneLine(lock) ?? (mayPayEdit ? "Amount, date, account, mode" : needsAccess("payments", "edit")),
        onSelect: async () => { await loadReceipts(); setEditReceiptId(p.receiptId!); } },
      { label: "Delete", icon: Trash2, danger: true, disabled: !!lock || !mayPayDelete,
        hint: oneLine(lock) ?? (mayPayDelete ? "Off the bills, account and credit" : needsAccess("payments", "delete")),
        onSelect: () => cancelReceiptFlow(p.receiptId!, user!.id) },
    ];
  };
  const creditActions = (noteId: string): MoreAction[] => {
    const why = !mayReturn ? needsAccess("invoices", "edit") : creditNoteCancelBlocker(db, noteId);
    return [
      { label: "Cancel return", icon: XCircle, danger: true, disabled: !!why,
        hint: oneLine(why) ?? "Undoes the return and its credit", onSelect: () => cancelCreditNoteFlow(noteId, user!) },
    ];
  };

  return (
    <div className="max-w-7xl mx-auto space-y-5">
      <PageHeader title="Invoices"
        primary={isStaff && can("invoices", "add") ? { label: "Create Invoice", icon: Plus, onClick: () => setCreating(true) } : null} />

      {/* Invoices section — the page title already names it. */}
      <div className="card-luxe overflow-hidden">
        {/* One table at every size: click any heading to sort (amounts and dates
            high → low first); on a phone the invoice number stays in view. Its
            search and filters are the page's (the figures follow them); the
            count is the table's own. */}
        <div className="p-3 sm:p-4">
          <DataTable
            search={{ value: q, onChange: setQ, placeholder: "Search invoice, order, client…" }}
            filters={invoiceFilters}
            onClearFilters={() => { pickClient("all"); setCompanyFilter("all"); }}
            summary={
              <StatStrip items={[
                { label: "Billed", value: fmtMoney(totalBilled), tone: "strong", icon: FileText },
                { label: "Received", value: fmtMoney(totalReceived), tone: "in" },
                { label: "Outstanding", value: fmtMoney(totalOutstanding), tone: "out" },
              ]} />
            }
            resetKey={JSON.stringify([ql, clientFilter, companyFilter])}
            id="invoices"
            noun="invoice"
            rows={invRows}
            rowKey={r => r.inv.id}
            onRowClick={r => openInvoice(r.inv.id)}
            details={invoiceDetails}
            rowActions={r => invoiceActions(r.inv)}
            defaultSort={{ key: "date", dir: "desc" }}
            pageSizes={[25, 50, 100]}
            emptyText={ql ? "No invoices match your search." : "No invoices yet."}
            columns={[
              { key: "number", header: "Invoice", always: true, kind: "number", sortFirst: "desc",
                sortValue: r => { const parts = r.inv.number.split("-"); const n = parseInt(parts[parts.length - 1], 10); return isNaN(n) ? r.inv.number : n; },
                cell: r => <span className="inline-flex items-center gap-2"><FileText className="h-4 w-4 text-primary shrink-0" /><span className="font-semibold">{r.inv.number}</span></span> },
              { key: "client", header: "Client", sortValue: r => r.client?.companyName ?? "", cell: r => <span className="font-medium max-w-[180px] truncate block">{r.client?.companyName || "—"}</span> },
              { key: "orders", header: "Orders", kind: "number", sortValue: r => r.orders.length,
                cell: r => r.orders.length === 1
                  ? <Link to={`/orders/${r.orders[0].id}`} onClick={e => e.stopPropagation()} className="text-primary hover:underline font-mono text-xs">{r.orders[0].orderNumber}</Link>
                  : <span className="text-xs text-muted-foreground">{r.orders.length} orders</span> },
              { key: "date", header: "Date", kind: "date", sortValue: r => r.inv.createdAt, cell: r => <span className="font-semibold text-brand-dark text-xs whitespace-nowrap">{fmtDate(r.inv.createdAt)}</span> },
              { key: "amount", header: "Amount", align: "right", sortValue: r => r.amount, cell: r => <span className="font-semibold">{fmtMoney(r.amount)}</span> },
              { key: "received", header: "Received", align: "right", sortValue: r => r.adv, cell: r => (r.adv > 0 ? <span className="text-success font-medium text-xs">{fmtMoney(r.adv)}</span> : <span className="text-muted-foreground text-xs">—</span>) },
              { key: "balance", header: "Balance", align: "right", sortValue: r => r.bal, cell: r => <span className={`text-xs ${r.bal > 0 ? "font-semibold text-destructive" : "text-muted-foreground"}`}>{r.bal > 0 ? fmtMoney(r.bal) : "Cleared"}</span> },
              { key: "status", header: "Status", align: "center", sortValue: r => (r.paid ? "Paid" : "Pending"),
                cell: r => r.paid
                  ? <span className="inline-flex items-center gap-1 text-xs font-medium text-success"><CheckCircle2 className="h-3 w-3" />Paid</span>
                  : <span className="inline-flex items-center gap-1 text-xs font-medium text-warning-foreground"><Clock className="h-3 w-3" />Pending</span> },
            ]}
          />
        </div>
      </div>

      {/* Advance Payment Ledger section — staff only. Clients see ONLY the invoices
          that were generated for them, never their un-invoiced orders. */}
      {isStaff && ordersWithAdvanceBase.length > 0 && (
        <div className="card-luxe overflow-hidden">
          <div className="px-5 py-4 border-b border-border/60">
            <SectionTitle title="Advance Payment Ledger" />
          </div>

          {/* Its search and client filter sit in the table's toolbar. Keyed on
              them so a new view starts on page 1. */}
          <div className="p-3 sm:p-4">
            <DataTable
              search={{ value: ledgerQ, onChange: setLedgerQ, placeholder: "Search order, client…" }}
              filters={[{
                kind: "select", label: "Client", allLabel: "All Clients", value: ledgerClientFilter === "all" ? "" : ledgerClientFilter,
                onChange: v => setLedgerClientFilter(v || "all"),
                options: clientOptions.map(c => ({ value: c.id, label: c.companyName })),
              }]}
              onClearFilters={() => setLedgerClientFilter("all")}
              resetKey={`${ledgerQ}|${ledgerClientFilter}`}
              id="invoice-advances"
              noun="order"
              rows={ordersWithAdvance}
              columns={ledgerColumns}
              rowKey={o => o.id}
              pageSizes={[10, 25, 50]}
              emptyText="No orders match your search."
              details={ledgerDetails}
              rowActions={o => {
                const inv = findInvoiceForOrder(db.invoices ?? [], o.id);
                return [
                  { label: "View order", icon: Eye, onSelect: () => navigate(`/orders/${o.id}`),
                    disabled: !can("orders"), hint: can("orders") ? undefined : needsAccess("orders", "view") },
                  { label: "View invoice", icon: FileText, onSelect: () => inv && openInvoice(inv.id),
                    disabled: !inv, hint: inv ? inv.number : "Not invoiced yet" },
                ];
              }}
              totals={{
                total: rows => fmtMoney(ledgerSum(rows, orderTotal)),
                advance: rows => <span className="text-success">{fmtMoney(ledgerSum(rows, totalAdvance))}</span>,
                balance: rows => { const due = ledgerSum(rows, balanceDue); return <span className={due > 0 ? "text-destructive" : "text-muted-foreground"}>{fmtMoney(due)}</span>; },
              }}
            />
          </div>
        </div>
      )}

      {/* ── Invoice detail modal — orders + order-wise payment ── */}
      <Dialog open={!!detailInv} onOpenChange={o => { if (!o) { setDetailInvId(null); setPayOrderId(null); } }}>
        <DialogContent className="max-w-4xl rounded-2xl">
          {detailInv && (() => {
            const { orders, amount, adv, bal, gift } = invLive(detailInv);
            const client = db.clients.find(c => c.id === detailInv.clientId);
            return (
              <>
                <DialogHeader>
                  <DialogTitle className="font-display text-2xl flex items-center gap-2">
                    <FileText className="h-5 w-5 text-primary" /> Invoice {detailInv.number}
                    {/* What a client holding the earlier copy would quote. */}
                    {detailInv.previousNumber && (
                      <span className="text-xs font-normal text-muted-foreground">(was {detailInv.previousNumber})</span>
                    )}
                  </DialogTitle>
                </DialogHeader>
                <div className="space-y-4 mt-1">
                  <div className="flex items-center justify-between gap-3 text-sm flex-wrap">
                    <div>
                      <p className="font-medium">{client?.companyName || "—"}</p>
                      <p className="text-xs text-muted-foreground">{fmtDate(detailInv.createdAt)} · {orders.length} order{orders.length !== 1 ? "s" : ""}</p>
                    </div>
                    <div className="flex items-center gap-2 flex-wrap">
                      {mayReturn && orders.some(o => !returnBlocker(o)) && (
                        <Button size="sm" variant="outline" onClick={() => setReturning({ inv: detailInv })} className="rounded-xl gap-2"><Undo2 className="h-3.5 w-3.5" /> Record return</Button>
                      )}
                      <IfExport>
                      <Button size="sm" variant="outline" onClick={() => printInv(detailInv)} className="rounded-xl gap-2"><Printer className="h-3.5 w-3.5" /> Print Invoice</Button>
                      </IfExport>
                      {isStaff && <MoreMenu size="sm" title={`Invoice ${detailInv.number}`} actions={invoiceActions(detailInv, true)} />}
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-2">
                    <div className="bg-secondary rounded-xl p-3 text-center"><p className="text-[10px] text-muted-foreground mb-0.5">Amount</p><p className="text-sm font-semibold">{fmtMoney(amount)}</p></div>
                    <div className={`rounded-xl p-3 text-center ${adv > 0 ? "bg-success/10" : "bg-secondary"}`}><p className="text-[10px] text-muted-foreground mb-0.5">Received</p><p className={`text-sm font-semibold ${adv > 0 ? "text-success" : "text-muted-foreground"}`}>{fmtMoney(adv)}</p></div>
                    <div className={`rounded-xl p-3 text-center ${bal > 0 ? "bg-destructive/10" : "bg-secondary"}`}><p className="text-[10px] text-muted-foreground mb-0.5">Balance</p><p className={`text-sm font-semibold ${bal > 0 ? "text-destructive" : "text-muted-foreground"}`}>{bal > 0 ? fmtMoney(bal) : "✓ Cleared"}</p></div>
                  </div>

                  {gift > 0 && (
                    <div className="flex items-center justify-between rounded-xl bg-primary/5 border border-primary/20 px-3 py-2 text-sm">
                      <span className="flex items-center gap-1.5 text-muted-foreground"><Gift className="h-3.5 w-3.5 text-primary" /> Gift card redeemed</span>
                      <span className="font-semibold text-primary">−{fmtMoney(gift)}</span>
                    </div>
                  )}

                  {/* Pieces the client sent back: each credit note, and what it took off. */}
                  {invoiceCreditNotes(db, orders.map(o => o.id)).map(n => (
                    <div key={n.noteId} className="flex items-center justify-between gap-3 rounded-xl bg-amber-500/5 border border-amber-500/30 px-3 py-2 text-sm flex-wrap">
                      <span className="flex items-center gap-1.5 text-muted-foreground"><Undo2 className="h-3.5 w-3.5 text-amber-700" /> Returned — credit note <span className="font-semibold text-brand-dark">{n.no}</span> · {n.qty} pc{n.qty !== 1 ? "s" : ""} · {fmtDate(n.at)}</span>
                      <span className="flex items-center gap-2">
                        <span className="font-semibold text-amber-800">−{fmtMoney(n.creditUsd)}</span>
                        <IfExport><Button size="sm" variant="ghost" onClick={() => printNote(n.noteId)} className="rounded-lg h-7 px-2 gap-1 text-xs"><Printer className="h-3.5 w-3.5" /> Print</Button></IfExport>
                        {isStaff && <MoreMenu size="sm" label="Credit note actions" title={`Credit note ${n.no}`} actions={creditActions(n.noteId)} className="h-7 w-7" />}
                      </span>
                    </div>
                  ))}

                  {/* Credit is money the client has sent that no invoice has
                      claimed yet. It sits on their account until somebody puts
                      it somewhere — nothing is allocated on its own. */}
                  {isStaff && can("payments", "edit") && bal > 0 && (db.clients.find(c => c.id === detailInv.clientId)?.creditBalance || 0) > 0 && (
                    <div className="rounded-xl border border-primary/30 bg-primary/5 p-3">
                      <p className="text-xs font-semibold text-brand-dark">
                        {fmtMoney(db.clients.find(c => c.id === detailInv.clientId)?.creditBalance || 0)} of unapplied credit on this client&rsquo;s account
                      </p>
                      <p className="text-[11px] text-muted-foreground mt-0.5">
                        Settles this invoice by that much; any extra stays as credit.
                      </p>
                      <AsyncButton
                        size="sm" variant="outline"
                        onClick={() => applyCreditHere(detailInv.id, detailInv.number, detailInv.clientId)}
                        className="rounded-xl h-8 mt-2"
                      >
                        Apply credit to this invoice
                      </AsyncButton>
                    </div>
                  )}


                  {/* Each payment against this invoice's orders, one line a receipt
                      (staff) — corrected or cancelled through that receipt. */}
                  {isStaff && (() => {
                    const pays = buildInvoiceBlocks([detailInv], db.orders, detailInv.clientId)[0]?.payments ?? [];
                    if (!pays.length) return null;
                    return (
                      <div className="space-y-1.5">
                        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Payments received</p>
                        {pays.map(p => {
                          const no = p.receiptId ? (db.clientReceipts ?? []).find(r => r.id === p.receiptId)?.receiptNo : undefined;
                          return (
                            <div key={p.id} className="flex items-center justify-between gap-3 rounded-xl bg-success/5 border border-success/20 px-3 py-2 text-sm">
                              <span className="min-w-0 text-muted-foreground text-xs">
                                {fmtDate(p.date)}{no && <> · <span className="font-mono font-semibold text-brand-dark">Receipt {no}</span></>} · {p.note}{p.fromCredit ? " · from credit" : ""}
                              </span>
                              <span className="flex items-center gap-2 shrink-0">
                                <span className="font-semibold text-success">{fmtMoney(p.amount)}</span>
                                <MoreMenu size="sm" label="Payment actions" title="Payment" actions={paymentActions(p)} className="h-7 w-7" />
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    );
                  })()}

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
                              {!!o.returns?.length && (
                                <p className="text-[11px] text-amber-700 font-medium">{o.returns.reduce((s, r) => s + r.qty, 0)} of {o.quantity || 1} pc{(o.quantity || 1) !== 1 ? "s" : ""} returned · {[...new Set(o.returns.map(r => r.creditNoteNo))].join(", ")}{o.returns.some(r => r.status === "coming") ? " · on its way back" : ""}</p>
                              )}
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                              <span className={`text-xs ${oBal > 0 ? "font-semibold text-destructive" : "text-muted-foreground"}`}>{oBal > 0 ? `${fmtMoney(oBal)} due` : "✓ Cleared"}</span>
                              {isStaff && can("payments", "add") && oBal > 0 && payOrderId !== o.id && (
                                <Button size="sm" variant="outline" onClick={() => startPay(o.id)} className="rounded-lg h-8 gap-1.5"><DollarSign className="h-3.5 w-3.5" /> Receive</Button>
                              )}
                              {mayReturn && !returnBlocker(o) && (
                                <Button size="sm" variant="ghost" onClick={() => setReturning({ inv: detailInv, start: { [o.id]: keptQty(o) } })} className="rounded-lg h-8 gap-1.5 text-amber-800 hover:text-amber-900 hover:bg-amber-500/10"><Undo2 className="h-3.5 w-3.5" /> Return</Button>
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
                                  <Select value={payLockerId} onValueChange={addNew("locker", pickPayLocker)}>
                                    <SelectTrigger className="h-9 rounded-xl mt-1"><SelectValue placeholder="Choose locker" /></SelectTrigger>
                                    <SelectContent>{db.lockers.filter(l => l.active !== false).map(l => <SelectItem key={l.id} value={l.id}>{l.name} ({ccy(l.currency)})</SelectItem>)}<AddNewItem kind="locker" /></SelectContent>
                                  </Select>
                                </div>
                              </div>
                              {payNeedsRate && (
                                <RateInput id={`inv-pay-rate-${o.id}`} from="USD" to={payLockerCcy} value={payRate}
                                  onChange={setPayRate} amount={Number(payAmount) || undefined} />
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
      {/* ── Create invoice — the page's main button opens it. The client to
          bill is the list's own Client filter, as it always was: picked here
          or in the table's Filters, one choice either way. ── */}
      {isStaff && can("invoices", "add") && (
        <ActionSheet open={creating} onOpenChange={setCreating} size="md" icon={FileText}
          title="Create invoice" description="From priced, dispatched orders"
          footer={
            <div className="flex items-center justify-between gap-3 flex-wrap">
              {clientFilter !== "all" && eligible.length > 0
                ? <span className="text-xs text-muted-foreground">{selected.size} selected · <span className="font-semibold text-foreground">{fmtMoney(selectedTotal)}</span></span>
                : <span />}
              <div className="flex items-center gap-2 max-sm:w-full">
                <Button variant="outline" onClick={() => setCreating(false)} className="rounded-xl h-10 max-sm:flex-1">Close</Button>
                {clientFilter !== "all" && eligible.length > 0 && (
                  <Button onClick={generateInvoice} disabled={selected.size === 0} className="btn-hero rounded-xl gap-2 h-10 max-sm:flex-1">
                    <FileText className="h-4 w-4" /> Generate Invoice
                  </Button>
                )}
              </div>
            </div>
          }>
          <div className="space-y-4">
            <div>
              <Label className="text-xs">Client</Label>
              <Select value={clientFilter} onValueChange={pickClient}>
                <SelectTrigger aria-label="Client to invoice" className="h-10 rounded-xl mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Choose a client…</SelectItem>
                  {clientOptions.map(c => <SelectItem key={c.id} value={c.id}>{c.companyName}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            {clientFilter !== "all" && (
              eligible.length === 0 ? (
                notYet.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Nothing left to bill.</p>
                ) : (
                  <div className="space-y-1.5">
                    <p className="text-xs text-muted-foreground">
                      Only <span className="font-semibold text-brand-dark">priced, dispatched</span> orders can be billed — {notYet.length} still on the way:
                    </p>
                    <div className="grid gap-1">
                      {notYet.map(({ o, why }) => (
                        <Link key={o.id} to={`/orders/${o.id}`} className="flex items-center gap-3 p-2 rounded-lg border border-border/70 bg-white hover:bg-secondary/50 transition-colors">
                          <span className="font-mono text-xs font-semibold text-primary">{o.orderNumber}</span>
                          <span className="text-xs text-muted-foreground truncate hidden sm:inline">{o.jewelleryType} · {o.status}</span>
                          <span className="ml-auto text-[11px] font-medium text-amber-700 shrink-0">{why}</span>
                        </Link>
                      ))}
                    </div>
                  </div>
                )
              ) : (
                <div className="space-y-2">
                  <label className="flex items-center gap-2 text-xs font-medium text-muted-foreground cursor-pointer">
                    <Checkbox checked={selected.size === eligibleIds.length && eligibleIds.length > 0} onCheckedChange={toggleAll} />
                    Select all ({eligible.length})
                  </label>
                  <div className="grid gap-1.5">
                    {eligible.map(({ o, disp }) => (
                      <label key={o.id} className={`flex items-center gap-3 p-2 rounded-lg border cursor-pointer transition-colors ${selected.has(o.id) ? "border-primary bg-primary/5" : "border-border/70 hover:bg-secondary/50"}`}>
                        <Checkbox checked={selected.has(o.id)} onCheckedChange={() => toggle(o.id)} />
                        <span className="font-mono text-xs font-semibold">{o.orderNumber}</span>
                        <span className="text-xs text-muted-foreground truncate hidden sm:inline">{o.jewelleryType} · {metalLabel(o.metal)}</span>
                        {disp.dispatched
                          ? <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-success/10 text-success">Dispatched{disp.date ? ` ${fmtDate(disp.date)}` : ""}</span>
                          : <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-secondary text-muted-foreground">{o.status}</span>}
                        <span className="ml-auto font-semibold text-sm shrink-0">{fmtMoney(orderTotal(o))}</span>
                      </label>
                    ))}
                  </div>
                </div>
              )
            )}
          </div>
        </ActionSheet>
      )}

      <ReceiptEditSheet receiptId={editReceiptId} onClose={() => setEditReceiptId(null)} />
      {returning && (
        <ReturnDialog
          orders={invoiceOrderIds(returning.inv).map(id => db.orders.find(o => o.id === id)).filter((o): o is Order => !!o)}
          invoice={returning.inv} start={returning.start} onClose={() => setReturning(null)} />
      )}
    </div>
  );
}
