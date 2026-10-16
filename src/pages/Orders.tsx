import { DataTable, CellTag, CellAmount, CellDate, type DataColumn } from "@/components/DataTable";
import { companiesOf, companyIdOfClient, companyOfOrder, hasCompanies } from "@/lib/companies";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { OrderBoard } from "@/components/OrderBoard";
import { pieceWeights } from "@/lib/weights";
import { useCan } from "@/hooks/useCan";
import { useMemo, useState } from "react";
import { filled, when, userName, refLink, noteText, refNo, type Detail } from "@/components/rowDetails";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "@/lib/auth";
import { loadDb, fmtMoney, fmtDate, currentUserOrders, findInvoiceForOrder, keptValue, returnedQty, orderImage, isDiamondOnlyOrder, orderTotal, totalAdvance, balanceDue } from "@/lib/db";
import { useDb, useDbVersion } from "@/hooks/useDb";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/StatusBadge";
import { TrackingModal } from "@/components/TrackingModal";
import { Package, Plus, Search, Filter, Truck, ExternalLink, Rows3, LayoutGrid, Columns3, Download, ChevronDown, UserCog, Building2, Users, Gem, FileText, FileSpreadsheet, Check, X, PackageCheck, TrendingUp } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { usePagination } from "@/hooks/usePagination";
import { exportProductsCsv, exportProductsPdf, exportProfitCsv } from "@/lib/productExport";
import { BulkDispatchDialog, BulkDeliverDialog } from "@/components/BulkDispatchDialog";
import { BulkInvoiceDialog } from "@/components/BulkInvoiceDialog";
import { AssignOrdersDialog } from "@/components/AssignOrder";
import { reachOf } from "@/lib/permissions";
import { OrderProfitBadge } from "@/components/OrderProfitCard";
import { InvoiceBadge, needsInvoice } from "@/components/InvoiceBadge";
import { PaginationBar } from "@/components/PaginationBar";
import type { Order, MaterialIssuance } from "@/lib/db";
import { IfExport } from "@/components/IfExport";

const PAGE_SIZE = 12;

/** A tick-box riding on top of a card, which must not follow the card's link. */
function SelectBox({ checked, onToggle, className = "" }: { checked: boolean; onToggle: () => void; className?: string }) {
  return (
    <button
      type="button"
      aria-pressed={checked}
      aria-label={checked ? "Deselect this piece" : "Select this piece"}
      onClick={e => { e.preventDefault(); e.stopPropagation(); onToggle(); }}
      className={`z-30 h-[22px] w-[22px] grid place-items-center rounded-md border-[1.5px] transition-all ${checked ? "bg-primary border-primary text-white shadow-sm" : "bg-card border-border text-transparent hover:border-primary hover:text-primary/40"} ${className}`}
    >
      <Check className="h-3.5 w-3.5" strokeWidth={3} />
    </button>
  );
}

/** The factory has reported back: net weight, purity and the finished piece are
 *  recorded, so the job itself is done even if the order has not shipped. */
/** "RETURNED", or "2 OF 4 RETURNED" when the client kept some. */
function returnTag(o: Order): string {
  const back = returnedQty(o), of = o.quantity || 1;
  return back >= of ? "RETURNED" : `${back} OF ${of} RETURNED`;
}

function jobFinished(o: Order): boolean {
  return !!(o.actualNetWeight || o.actualGrossWeight || o.actualDiamondWeight);
}


function lastTrackingStep(o: Order): string {
  const inProgress = o.timeline.find(t => t.status === "in_progress");
  if (inProgress) return inProgress.step;
  const done = o.timeline.filter(t => t.status === "done");
  if (done.length) return done[done.length - 1].step;
  return o.timeline[0]?.step ?? "";
}

/** The stage an order is at — the one in progress, else the last one done — with its date and who did it. */
function stageNow(o: Order) {
  return o.timeline.find(t => t.status === "in_progress") ?? [...o.timeline].reverse().find(t => t.status === "done") ?? o.timeline[0];
}

export function OrdersPage() {
  const { user } = useAuth();
  const db = useDb();
  // The store is edited in place; this changes whenever the data does, so the
  // filtered list follows an order that moves stage or status.
  const dbVersion = useDbVersion();
  const [sp] = useSearchParams();
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<string>(sp.get("status") ?? "all");
  const [clientFilter, setClientFilter] = useState<string>("all");
  // The admin can look at one person's orders: assigned to them, or for a
  // client they manage — the same rule as their own Orders page.
  const [employeeFilter, setEmployeeFilter] = useState<string>("all");
  // Which of our companies — shown once there is more than one.
  const [companyFilter, setCompanyFilter] = useState<string>("all");
  const multiCo = hasCompanies(db.settings);
  const isStaff = user!.role !== "client";
  const can = useCan();
  const [trackingOrder, setTrackingOrder] = useState<Order | null>(null);
  // List, Grid (image) or Board (stage columns) — remembered per device. The
  // board moves orders between stages, so it is for staff; a client who had it
  // remembered on a shared device sees the grid.
  const [viewPref, setView] = useState<"list" | "grid" | "board">(() => {
    try { return (localStorage.getItem("orders-view") as "list" | "grid" | "board") || "grid"; } catch { return "grid"; }
  });
  const view = viewPref === "board" && !isStaff ? "grid" : viewPref;
  const saveView = (v: "list" | "grid" | "board") => {
    setView(v);
    try { localStorage.setItem("orders-view", v); } catch { /* ignore */ }
  };

  const orders = useMemo(() => {
    let list = currentUserOrders(db, user!);
    if (status === "Pending") list = list.filter(o => o.status === "Waiting" || o.status === "Approved");
    // Shipped work that nobody has billed yet — the whole point of the badge,
    // gathered into one list instead of spotted by scrolling.
    else if (status === "uninvoiced") list = list.filter(o => needsInvoice(o) && !findInvoiceForOrder(db.invoices, o.id));
    // Pieces the client sent back — whole orders or some of their pieces.
    else if (status === "returned") list = list.filter(o => !!o.returns?.length);
    else if (status !== "all") list = list.filter(o => o.status === status);
    if (clientFilter !== "all") list = list.filter(o => o.clientId === clientFilter);
    if (companyFilter !== "all") list = list.filter(o => companyOfOrder(db, o) === companyFilter);
    if (employeeFilter !== "all" && user!.role === "admin") {
      const managed = new Set(db.clients.filter(c => c.accountManagerId === employeeFilter).map(c => c.id));
      list = list.filter(o => o.assignedEmployeeId === employeeFilter || managed.has(o.clientId));
    }
    // Commas separate alternatives: "1090, 1091" means either, not both. A
    // handful of order or design numbers read off a list can be pasted in as
    // they were written — trailing comma and all — and the ledger drawn from
    // exactly those pieces. Without a comma this is the single term it always
    // was, so "white gold" still matches as one phrase.
    const terms = q.split(",").map(t => t.trim().toLowerCase()).filter(Boolean);
    if (terms.length) list = list.filter(o => terms.some(t =>
      o.orderNumber.toLowerCase().includes(t) ||
      o.jewelleryType.toLowerCase().includes(t) ||
      (o.designNumber ?? "").toLowerCase().includes(t) ||
      (o.returns ?? []).some(r => r.creditNoteNo.toLowerCase().includes(t))
    ));
    // A copy: for the admin with no filter, `list` is the store's own array,
    // and sorting it in place reordered every other page's lists too.
    return [...list].sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db, dbVersion, user, q, status, clientFilter, employeeFilter, companyFilter]);

  const { paged, page, setPage, totalPages, total, start, end } = usePagination(orders, PAGE_SIZE);

  /**
   * The pieces on screen, with the weights a sale is priced from.
   *
   * Filter to one client and the ready work, and this is the sheet a bulk sale
   * is settled on: gross, net and diamond weight, the stone count, and what is
   * already paid — figures that were only ever visible one order at a time.
   *
   * A sale is rarely a whole filter, though, so pieces can be ticked one by
   * one: tick any and the download narrows to those; tick none and it is
   * whatever the filters left, as everywhere else.
   */
  const [sel, setSel] = useState<Set<string>>(new Set());
  // Several pieces leave in one parcel under one tracking number, so dispatch
  // is entered once for the whole selection rather than order by order.
  const [bulkDispatch, setBulkDispatch] = useState(false);
  const [bulkDeliver, setBulkDeliver] = useState(false);
  const [bulkInvoice, setBulkInvoice] = useState(false);
  const [bulkAssign, setBulkAssign] = useState(false);
  // The badge is a way in as well as a marker — the invoice it names opens on
  // the Invoices page, already searched for.
  const nav = useNavigate();
  const openInvoice = (number: string) => nav(`/invoices?q=${encodeURIComponent(number)}`);
  const toggleSel = (id: string) => setSel(prev => {
    const next = new Set(prev);
    if (!next.delete(id)) next.add(id);
    return next;
  });
  // Only what is still on screen counts. Narrow the filters after ticking and
  // the hidden pieces drop out of the download too, rather than riding along
  // invisibly into the sheet.
  const chosen = orders.filter(o => sel.has(o.id));
  // One client, so one invoice can cover the lot.
  const oneClient = chosen.length > 0 && new Set(chosen.map(o => o.clientId)).size === 1;
  const exportRows = chosen.length ? chosen : orders;
  const allShown = orders.length > 0 && orders.every(o => sel.has(o.id));

  // The list view's table. What a card showed, as columns: the less used
  // ones start hidden and can be shown from Columns.
  const issByOrder = useMemo(() => {
    const m = new Map<string, MaterialIssuance[]>();
    if (isStaff) for (const i of db.materialIssuances) if (i.orderId) m.set(i.orderId, [...(m.get(i.orderId) ?? []), i]);
    return m;
  }, [db.materialIssuances, isStaff, dbVersion]); // eslint-disable-line react-hooks/exhaustive-deps
  const progressOf = (o: Order) => o.timeline.length ? Math.round(o.timeline.filter(t => t.status === "done").length / o.timeline.length * 100) : 0;
  const factoriesOf = (o: Order) => [...new Set((issByOrder.get(o.id) ?? []).map(i => db.factories.find(f => f.id === i.factoryId)?.name).filter(Boolean))] as string[];
  const listColumns: DataColumn<Order>[] = [
    { key: "order", header: "Order", always: true, sortValue: o => o.orderNumber,
      cell: o => {
        const img = orderImage(o);
        return (
          <div className="flex items-center gap-3 min-w-0">
            <div className="h-11 w-11 rounded-lg overflow-hidden bg-white ring-1 ring-border/60 shrink-0 grid place-items-center">
              {img ? <img src={img} alt="" loading="lazy" className="w-full h-full object-contain" />
                : isDiamondOnlyOrder(o) ? <Gem className="h-4 w-4 text-sky-500/50" /> : <Package className="h-4 w-4 text-primary/30" />}
            </div>
            <div className="min-w-0">
              <p className="font-semibold text-brand-dark leading-snug whitespace-nowrap">{o.orderNumber}</p>
              <p className="text-[11px] text-muted-foreground leading-snug truncate max-w-[13rem]">
                {o.jewelleryType} · {o.metal}{o.productKarats ? ` ${o.productKarats}` : ""} · {o.quantity} pc{o.quantity !== 1 ? "s" : ""}{o.designNumber ? ` · #${o.designNumber}` : ""}
              </p>
              {(o.melted || jobFinished(o) || !!o.returns?.length) && (
                <div className="flex flex-wrap gap-1 mt-0.5">
                  {o.melted ? <CellTag tone="red">MELTED</CellTag> : jobFinished(o) && <CellTag tone="red">JOB FINISH</CellTag>}
                  {!!o.returns?.length && <CellTag tone="amber">{returnTag(o)}</CellTag>}
                </div>
              )}
            </div>
          </div>
        );
      } },
    ...(isStaff ? [{ key: "client", header: "Client", sortValue: (o: Order) => o.forReadyStock ? "Ready Stock" : db.clients.find(c => c.id === o.clientId)?.companyName ?? "",
      cell: (o: Order) => o.forReadyStock ? <span className="text-primary font-medium whitespace-nowrap">Ready Stock (in-house)</span>
        : <span className="whitespace-nowrap">{db.clients.find(c => c.id === o.clientId)?.companyName ?? "—"}</span> }] : []),
    { key: "status", header: "Status", sortValue: o => o.status, cell: o => <StatusBadge status={o.status} /> },
    { key: "progress", header: "Progress", kind: "number", sortValue: progressOf,
      cell: o => {
        const pct = progressOf(o), active = !["Delivered", "Rejected"].includes(o.status);
        return (
          <div className="min-w-[7rem]">
            <div className="flex items-center gap-2">
              <div className="h-1.5 flex-1 rounded-full bg-secondary overflow-hidden"><div className="h-full bg-gradient-to-r from-primary to-brand-light" style={{ width: `${pct}%` }} /></div>
              <span className="text-[11px] tabular-nums text-muted-foreground w-8 text-right">{pct}%</span>
            </div>
            {active && !o.courierName && <p className="text-[11px] text-primary truncate max-w-[12rem] mt-0.5">{lastTrackingStep(o)}</p>}
          </div>
        );
      } },
    { key: "due", header: "Due", kind: "date", sortFirst: "asc", sortValue: o => o.expectedDelivery, cell: o => <CellDate>{fmtDate(o.expectedDelivery)}</CellDate> },
    { key: "weights", header: "Weights", sortValue: o => pieceWeights(o, issByOrder.get(o.id) ?? []).gross || null,
      cell: o => {
        const pw = pieceWeights(o, issByOrder.get(o.id) ?? []);
        if (!pw.gross && !pw.net && !pw.diamondCt) return <span className="text-muted-foreground/50">—</span>;
        return (
          <span className="whitespace-nowrap text-xs tabular-nums">
            {[pw.gross ? `G ${pw.gross}g` : "", pw.net ? `N ${pw.net}g` : "", pw.diamondCt ? `${pw.diamondCt}ct` : ""].filter(Boolean).join(" · ")}
            {pw.problem && isStaff && <span title={pw.problem} className="ml-1 text-destructive font-semibold">⚠</span>}
          </span>
        );
      } },
    ...(isStaff ? [
      { key: "factory", header: "Factory", sortValue: (o: Order) => factoriesOf(o).join(", "),
        cell: (o: Order) => factoriesOf(o).length ? <span className="whitespace-nowrap">{factoriesOf(o).join(", ")}</span> : <span className="text-muted-foreground/50">—</span> },
      { key: "issued", header: "Issued", hidden: true, sortValue: (o: Order) => (issByOrder.get(o.id) ?? []).filter(i => i.material === "gold").reduce((s, i) => s + i.quantityIssued, 0) || null,
        cell: (o: Order) => {
          const iss = issByOrder.get(o.id) ?? [];
          const g = iss.filter(i => i.material === "gold").reduce((s, i) => s + i.quantityIssued, 0), d = iss.filter(i => i.material === "diamond").reduce((s, i) => s + i.quantityIssued, 0);
          return g || d ? <span className="whitespace-nowrap text-xs tabular-nums">{g ? `${g.toLocaleString()} g gold` : ""}{g && d ? " · " : ""}{d ? `${d.toLocaleString()} ct` : ""}</span> : <span className="text-muted-foreground/50">—</span>;
        } },
    ] : []),
    { key: "courier", header: "Courier", hidden: true, sortValue: o => o.courierName ?? null,
      cell: o => o.courierName ? (
        <div className="flex items-center gap-2 whitespace-nowrap">
          <span className="text-xs"><span className="font-medium capitalize">{o.courierName}</span>{o.trackingNumber && <span className="font-mono text-muted-foreground"> {o.trackingNumber}</span>}</span>
          {o.trackingLink
            ? <a href={o.trackingLink} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[11px] font-semibold text-primary bg-primary/10 hover:bg-primary/20 rounded-md px-2 py-0.5"><ExternalLink className="h-3 w-3" />Track</a>
            : <button type="button" onClick={() => setTrackingOrder(o)} className="inline-flex items-center gap-1 text-[11px] font-semibold text-primary bg-primary/10 hover:bg-primary/20 rounded-md px-2 py-0.5"><Truck className="h-3 w-3" />Track</button>}
        </div>
      ) : <span className="text-muted-foreground/50">—</span> },
    ...(isStaff ? [{ key: "invoice", header: "Invoice", sortValue: (o: Order) => findInvoiceForOrder(db.invoices, o.id)?.number ?? (needsInvoice(o) ? "" : null),
      cell: (o: Order) => <InvoiceBadge invoice={findInvoiceForOrder(db.invoices, o.id)} dispatched={needsInvoice(o)} onOpen={openInvoice} /> }] : []),
    ...(user!.role === "admin" ? [{ key: "profit", header: "Profit", cell: (o: Order) => <OrderProfitBadge db={db} order={o} className="text-xs whitespace-nowrap" /> }] : []),
    { key: "placed", header: "Placed", kind: "date", hidden: true, sortValue: o => o.createdAt, cell: o => <CellDate>{fmtDate(o.createdAt)}</CellDate> },
    { key: "amount", header: "Amount", align: "right", kind: "number", sortValue: o => o.returns?.length ? keptValue(o) : o.amount,
      cell: o => (
        <span className="whitespace-nowrap">
          {!!o.returns?.length && <span className="text-[11px] tabular-nums text-muted-foreground line-through mr-1.5">{fmtMoney(o.amount)}</span>}
          <CellAmount>{fmtMoney(o.returns?.length ? keptValue(o) : o.amount)}</CellAmount>
        </span>
      ) },
  ];

  // What an opened row adds to its columns: the order page's own facts —
  // never cost or profit, and for a client only what their order page shows.
  const orderDetails = (o: Order): Detail[] => {
    const st = stageNow(o);
    const by = userName(db, st?.employeeId);
    const total = orderTotal(o), shown = o.returns?.length ? keptValue(o) : o.amount;
    const billed = !o.forReadyStock && total > 0;
    const due = balanceDue(o);
    const fromStock = o.materialSourcing === "readyStock" && o.readyStockItemId ? db.readyStock.find(i => i.id === o.readyStockItemId) : undefined;
    const built = isStaff && o.readyStockCreatedId ? db.readyStock.find(i => i.id === o.readyStockCreatedId) : undefined;
    const weightProblem = isStaff ? pieceWeights(o, issByOrder.get(o.id) ?? []).problem : null;
    const company = isStaff && multiCo ? companiesOf(db.settings).find(c => c.id === companyOfOrder(db, o))?.name : undefined;
    return filled([
      !!st && { label: "Stage", value: [st.step, st.date && when(st.date), by && `by ${by}`, st.remarks].filter(Boolean).join(" · ") },
      { label: "Placed", value: when(o.createdAt) },
      o.priority !== "Normal" && { label: "Priority", value: o.priority },
      { label: "Assigned to", value: userName(db, o.assignedEmployeeId) },
      { label: "Contact person", value: o.contactPerson },
      { label: "Company", value: company },
      (o.diamondWeight > 0 || (o.actualDiamondWeight ?? 0) > 0) && !o.noDiamond && { label: "Diamonds", value: `${o.diamondType}${o.actualDiamondPcs ? ` · ${o.actualDiamondPcs} stones` : ""}` },
      { label: "Size", value: o.productSize },
      { label: "Colour", value: o.productColor },
      { label: "Rhodium", value: o.rhodium },
      { label: "Stamping", value: o.stamping },
      !!o.otherMetal && { label: "Second metal", value: `${o.otherMetal}${o.otherMetalWeight ? ` · ${o.otherMetalWeight} g` : ""}${o.otherMetalPurity ? ` · ${o.otherMetalPurity}‰` : ""}` },
      !!o.certificate && { label: "Certificate", value: o.certificateFee ? `Yes · ${fmtMoney(o.certificateFee)}` : "Yes" },
      { label: "Delivery time", value: o.deliveryTime },
      !!o.dispatchedAt && { label: "Dispatched", value: fmtDate(o.dispatchedAt) },
      !!o.deliveredAt && { label: "Delivered", value: fmtDate(o.deliveredAt) },
      (o.shippingCharge || 0) > 0 && { label: "Shipping", value: fmtMoney(o.shippingCharge) },
      (o.giftCardRedeemed || 0) > 0 && { label: "Gift card used", value: `−${fmtMoney(o.giftCardRedeemed || 0)}` },
      billed && Math.abs(total - shown) > 0.005 && { label: "Order total", value: fmtMoney(total) },
      billed && { label: "Paid", value: fmtMoney(totalAdvance(o)) },
      billed && { label: "Balance due", value: due > 0 ? <span className="font-semibold text-destructive">{fmtMoney(due)}</span> : <span className="font-semibold text-success">Cleared</span> },
      !!fromStock && { label: "From Ready Stock", value: refLink(`/ready-stock/${fromStock.id}`, fromStock.name) },
      !!built && { label: "In Ready Stock", value: refLink(`/ready-stock/${built.id}`, built.name) },
      isStaff && { label: "Factory bill no.", value: refNo(o.factoryBillNo) },
      isStaff && { label: "Earlier order no.", value: o.previousOrderNumber },
      !!weightProblem && { label: "Check weights", value: <span className="text-destructive">{weightProblem}</span> },
      !!o.returns?.length && { label: "Returns", value: (
        <ul className="space-y-0.5">
          {(o.returns ?? []).map(r => (
            <li key={r.id}>{r.creditNoteNo} · {fmtDate(r.at)} · {r.qty} pc{r.qty !== 1 ? "s" : ""} · −{fmtMoney(r.creditUsd)} · {r.status === "coming" ? "on its way back" : "received"}{r.reason ? ` — ${r.reason}` : ""}</li>
          ))}
        </ul>
      ) },
      isStaff && !!o.melted && { label: "Melted", value: `${fmtDate(o.melted.at)} by ${o.melted.byName}${o.melted.reason ? ` — ${o.melted.reason}` : ""}` },
      { label: "Instructions", value: noteText(o.instructions) },
    ]);
  };

  const exportName = () => {
    if (chosen.length) return `Products-Selected-${chosen.length}`;
    // The product sheet goes to customers, so it never names who handled the work.
    const who = clientFilter === "all" ? "" : `-${(db.clients.find(c => c.id === clientFilter)?.companyName ?? "").replace(/\s+/g, "_")}`;
    return `Products${who}${status === "all" ? "" : `-${status.replace(/\s+/g, "_")}`}`;
  };
  const exportSubject = () => (chosen.length
    ? [`${chosen.length} selected piece${chosen.length !== 1 ? "s" : ""}`]
    : [
        clientFilter === "all" ? "All clients" : db.clients.find(c => c.id === clientFilter)?.companyName,
        status === "all" ? "All status" : status === "uninvoiced" ? "Shipped, not invoiced" : status,
        q.trim() ? `Search: "${q.trim()}"` : "",
      ]).filter(Boolean).join(" · ");

  return (
    <div className="max-w-7xl mx-auto space-y-4">

      {/* ── Page header ── */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="font-display text-2xl md:text-3xl text-brand-dark">Orders</h1>
          <p className="text-sm text-muted-foreground">{total} order{total !== 1 ? "s" : ""}</p>
        </div>
        {(user!.role === "client" || user!.role === "admin" || (user!.role === "employee" && can("orders", "add"))) && (
          <Button asChild className="btn-hero h-10 rounded-xl px-4 text-sm">
            <Link to="/orders/new"><Plus className="h-4 w-4 mr-1.5" />New Order</Link>
          </Button>
        )}
      </div>

      {/* ── Toolbar — one tidy row on desktop, wraps neatly on phone ── */}
      <div className="card-luxe p-2 flex flex-wrap items-center gap-2">
        {/* Search grows to fill whatever space is left (own full row on mobile) */}
        <div className="relative flex-1 basis-full sm:basis-0 min-w-[180px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input value={q} onChange={e => setQ(e.target.value)} placeholder="Search — or 1090, 1091, LR-528" className="pl-9 h-10 rounded-lg text-sm" />
        </div>

        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="flex-1 sm:flex-none sm:w-40 h-10 rounded-lg text-sm">
            <Filter className="h-3.5 w-3.5 mr-1.5 shrink-0" /><SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All status</SelectItem>
            <SelectItem value="Pending">Pending (Waiting + Approved)</SelectItem>
            {isStaff && <SelectItem value="uninvoiced">Not invoiced (shipped)</SelectItem>}
            <SelectItem value="returned">Returned by client</SelectItem>
            {["Waiting","Approved","In Production","Ready","Dispatched","Delivered","Rejected"].map(s =>
              <SelectItem key={s} value={s}>{s}</SelectItem>)}
          </SelectContent>
        </Select>

        {isStaff && (
          <Select value={clientFilter} onValueChange={setClientFilter}>
            <SelectTrigger className="flex-1 sm:flex-none sm:w-52 h-10 rounded-lg text-sm">
              <Users className="h-3.5 w-3.5 mr-1.5 shrink-0" /><SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All clients</SelectItem>
              {[...db.clients].sort((a, b) => a.companyName.localeCompare(b.companyName)).map(c =>
                <SelectItem key={c.id} value={c.id}>{c.companyName}</SelectItem>)}
            </SelectContent>
          </Select>
        )}

        {isStaff && multiCo && (
          <Select value={companyFilter} onValueChange={setCompanyFilter}>
            <SelectTrigger className="flex-1 sm:flex-none sm:w-48 h-10 rounded-lg text-sm" aria-label="Company">
              <Building2 className="h-3.5 w-3.5 mr-1.5 shrink-0" /><SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All companies</SelectItem>
              {companiesOf(db.settings).map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
            </SelectContent>
          </Select>
        )}

        {user!.role === "admin" && (
          <Select value={employeeFilter} onValueChange={setEmployeeFilter}>
            <SelectTrigger className="flex-1 sm:flex-none sm:w-48 h-10 rounded-lg text-sm" aria-label="Employee">
              <UserCog className="h-3.5 w-3.5 mr-1.5 shrink-0" /><SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All employees</SelectItem>
              {db.users.filter(u => (u.role === "employee" || u.role === "admin") && u.status !== "inactive")
                .sort((a, b) => a.name.localeCompare(b.name))
                .map(u => <SelectItem key={u.id} value={u.id}>{u.name}{u.role === "admin" ? " (admin)" : ""}</SelectItem>)}
            </SelectContent>
          </Select>
        )}

        {isStaff && orders.length > 0 && (
          <IfExport>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button type="button" aria-label="Export"
                className="shrink-0 flex items-center gap-1.5 h-10 px-3 rounded-lg border border-border bg-white hover:bg-secondary text-xs font-medium text-brand-dark data-[state=open]:border-primary/50 data-[state=open]:text-primary">
                <Download className="h-4 w-4" /> Export{chosen.length ? ` (${chosen.length})` : ""} <ChevronDown className="h-3.5 w-3.5" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-64 rounded-xl p-1.5">
              <DropdownMenuLabel className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold px-2 py-1">
                Product sheet · {chosen.length ? `${chosen.length} selected` : `${orders.length} shown`}
              </DropdownMenuLabel>
              <DropdownMenuItem onSelect={() => exportProductsPdf(db, exportRows, exportName(), exportSubject())} className="rounded-lg px-2 py-2 cursor-pointer gap-2">
                <FileText className="h-4 w-4 text-primary" />
                <span><span className="block text-xs font-medium">PDF</span><span className="block text-[10px] text-muted-foreground">Weights, diamonds and value — for a customer</span></span>
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => exportProductsCsv(db, exportRows, exportName())} className="rounded-lg px-2 py-2 cursor-pointer gap-2">
                <FileSpreadsheet className="h-4 w-4 text-primary" />
                <span><span className="block text-xs font-medium">Excel</span><span className="block text-[10px] text-muted-foreground">The same sheet, to edit or send</span></span>
              </DropdownMenuItem>
              {/* Kept apart and marked: the sheets above go to customers for a
                  bulk sale, and cost must never be one forward away from one. */}
              {user!.role === "admin" && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuLabel className="text-[10px] uppercase tracking-wider text-amber-700 font-semibold px-2 py-1">Admin only — never send to a customer</DropdownMenuLabel>
                  <DropdownMenuItem onSelect={() => exportProfitCsv(db, exportRows, exportName())} className="rounded-lg px-2 py-2 cursor-pointer gap-2 bg-amber-500/5 focus:bg-amber-500/15">
                    <TrendingUp className="h-4 w-4 text-amber-700" />
                    <span><span className="block text-xs font-semibold text-amber-800">Profit — Excel</span><span className="block text-[10px] text-muted-foreground">Cost and profit per order</span></span>
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
          </IfExport>
        )}

        <Select value={view} onValueChange={v => saveView(v as "list" | "grid" | "board")}>
          <SelectTrigger className="shrink-0 w-[7.5rem] h-10 rounded-lg text-sm" aria-label="View">
            {view === "list" ? <Rows3 className="h-3.5 w-3.5 mr-1.5 shrink-0" /> : view === "grid" ? <LayoutGrid className="h-3.5 w-3.5 mr-1.5 shrink-0" /> : <Columns3 className="h-3.5 w-3.5 mr-1.5 shrink-0" />}
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="list">List</SelectItem>
            <SelectItem value="grid">Grid</SelectItem>
            {isStaff && <SelectItem value="board">Board</SelectItem>}
          </SelectContent>
        </Select>
      </div>

      {/* ── What is ticked, and what the download will hold ── */}
      {isStaff && sel.size > 0 && (
        <div className="card-luxe px-3 py-2 flex flex-wrap items-center gap-x-3 gap-y-2 text-sm">
          <span className="font-semibold text-brand-dark">
            {chosen.length} selected
          </span>
          {chosen.length !== sel.size && (
            <span className="text-xs text-muted-foreground">
              ({sel.size - chosen.length} more hidden by the filters — not included)
            </span>
          )}
          <span className="text-xs text-muted-foreground">PDF and Excel will hold just these.</span>
          <div className="ml-auto flex items-center gap-2">
            {chosen.length > 0 && (
              <>
                {can("orders", "edit") && (<>
                <button onClick={() => setBulkDispatch(true)}
                  className="flex items-center gap-1.5 h-8 px-3 rounded-lg bg-blue-500/10 border border-blue-500/30 text-xs font-semibold text-blue-700 hover:bg-blue-500/20">
                  <Truck className="h-3.5 w-3.5" /> Dispatch
                </button>
                <button onClick={() => setBulkDeliver(true)}
                  className="flex items-center gap-1.5 h-8 px-3 rounded-lg bg-success/10 border border-success/30 text-xs font-semibold text-success hover:bg-success/20">
                  <PackageCheck className="h-3.5 w-3.5" /> Delivered
                </button>
                </>)}
                {user!.role === "admin" && (
                  <button onClick={() => setBulkAssign(true)}
                    className="flex items-center gap-1.5 h-8 px-3 rounded-lg bg-violet-500/10 border border-violet-500/30 text-xs font-semibold text-violet-700 hover:bg-violet-500/20">
                    <UserCog className="h-3.5 w-3.5" /> Assign
                  </button>
                )}
                {/* An invoice covers one client, so this stays out of reach until
                    the selection is down to one — with the reason said, not just
                    a dead button. */}
                {can("invoices", "add") && <button onClick={() => setBulkInvoice(true)} disabled={!oneClient}
                  title={oneClient ? "Bill these orders on one invoice" : "Select orders from a single client"}
                  className="flex items-center gap-1.5 h-8 px-3 rounded-lg bg-primary/10 border border-primary/30 text-xs font-semibold text-primary hover:bg-primary/20 disabled:opacity-40 disabled:cursor-not-allowed">
                  <FileText className="h-3.5 w-3.5" /> Invoice
                </button>}
              </>
            )}
            {!allShown && (
              <button onClick={() => setSel(new Set(orders.map(o => o.id)))}
                className="text-xs font-medium text-primary hover:underline">
                Select all {orders.length}
              </button>
            )}
            <button onClick={() => setSel(new Set())}
              className="flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground">
              <X className="h-3.5 w-3.5" /> Clear
            </button>
          </div>
        </div>
      )}

      {/* ── Empty state ── */}
      {total === 0 && (
        <div className="card-luxe p-12 text-center text-muted-foreground">
          <Package className="h-10 w-10 mx-auto mb-3 opacity-20" />
          {user!.role === "employee" && currentUserOrders(db, user!).length === 0 ? (
            <>
              <p className="font-medium text-brand-dark">No orders are yours yet.</p>
              <p className="text-xs mt-1 max-w-md mx-auto">
                {reachOf(user, db.roles ?? []) === "all" ? "There are no orders yet." : "You see the orders assigned to you and the orders of clients you manage. Ask the admin to assign orders to you, make you a client's account manager, or give you a role that sees every order."}
              </p>
            </>
          ) : <p>No orders match your filters.</p>}
        </div>
      )}

      {/* ── Grid (image) view ── */}
      {view === "grid" && total > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-auto-tiles gap-3">
          {paged.map(o => {
            const client = db.clients.find(c => c.id === o.clientId);
            const done = o.timeline.filter(t => t.status === "done").length;
            const progress = Math.round(done / o.timeline.length * 100);
            const img = orderImage(o);
            return (
              <Link key={o.id} to={`/orders/${o.id}`}
                className={`group card-luxe card-hover overflow-hidden flex flex-col min-w-0 ${sel.has(o.id) ? "ring-2 ring-primary" : ""}`}>
                {/* Status and the tick box sit above the photo, never on it —
                    a CAD sheet's measurements run right to its corners. */}
                <div className="flex items-center justify-between gap-2 px-3 pt-3 pb-2">
                  <StatusBadge status={o.status} />
                  {isStaff && <SelectBox checked={sel.has(o.id)} onToggle={() => toggleSel(o.id)} />}
                </div>
                {/* The whole sheet, on white: shown in full, never cropped. */}
                <div className={`relative mx-3 aspect-square rounded-xl overflow-hidden ring-1 ring-border/60 ${img ? "bg-secondary/60 animate-pulse" : "bg-secondary/50"}`}>
                  {img ? (
                    <img
                      src={img}
                      alt={o.orderNumber}
                      loading="lazy"
                      decoding="async"
                      onLoad={e => { const box = e.currentTarget.parentElement; box?.classList.remove("animate-pulse", "bg-secondary/60"); box?.classList.add("bg-white"); }}
                      onError={e => { e.currentTarget.parentElement?.classList.remove("animate-pulse"); e.currentTarget.style.display = "none"; }}
                      className="relative z-10 w-full h-full object-contain p-1 transition-transform duration-300 ease-out group-hover:scale-[1.03]"
                    />
                  ) : (
                    <div className="w-full h-full grid place-items-center">{isDiamondOnlyOrder(o) ? <Gem className="h-8 w-8 text-sky-500/40" /> : <Package className="h-8 w-8 text-primary/30" />}</div>
                  )}
                </div>
                <div className="px-3 pt-3 pb-3 flex flex-col flex-1 min-w-0">
                  <p className="font-semibold text-[15px] leading-tight tracking-tight truncate">{o.orderNumber}</p>
                  <p className="text-xs text-muted-foreground truncate mt-1">
                    {o.jewelleryType} · {o.metal}{o.productKarats ? ` ${o.productKarats}` : ""}{o.designNumber ? ` · #${o.designNumber}` : ""}
                  </p>
                  {user!.role !== "client" && (o.forReadyStock
                    ? <p className="text-xs font-medium text-primary truncate mt-1">🏭 Ready Stock</p>
                    : client && <p className="text-xs font-semibold text-foreground/70 truncate mt-1">{client.companyName}</p>)}
                  {(o.melted || jobFinished(o)) && (
                    <span className="self-start mt-1.5 text-[10px] font-bold tracking-wide px-1.5 py-0.5 rounded-md bg-destructive/10 text-destructive">
                      {o.melted ? "MELTED" : "JOB FINISH"}
                    </span>
                  )}
                  {!!o.returns?.length && (
                    <span className="self-start mt-1.5 text-[10px] font-bold tracking-wide px-1.5 py-0.5 rounded-md bg-amber-500/10 text-amber-800">{returnTag(o)}</span>
                  )}
                  {user!.role === "admin" && <OrderProfitBadge db={db} order={o} className="mt-1.5 text-xs" />}
                  {isStaff && (() => {
                    const wp = pieceWeights(o, db.materialIssuances).problem;
                    return wp ? <p title={wp} className="text-[10px] font-semibold text-destructive truncate mt-1">⚠ Check weights</p> : null;
                  })()}
                  <div className="mt-auto pt-3">
                    <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground mb-1.5">
                      <span className="truncate">{o.status === "Rejected" ? (o.melted ? "Melted" : "Rejected") : lastTrackingStep(o)}</span>
                      <span className="tabular-nums font-medium shrink-0">{progress}%</span>
                    </div>
                    <div className="h-1.5 rounded-full bg-secondary overflow-hidden">
                      <div className="h-full rounded-full bg-gradient-to-r from-primary to-brand-light" style={{ width: `${progress}%` }} />
                    </div>
                    {/* The price, with its invoice number in red right before it. */}
                    <div className="flex flex-wrap items-center justify-end gap-x-2 gap-y-1 mt-3 pt-2.5 border-t border-border/60">
                      {isStaff && <InvoiceBadge invoice={findInvoiceForOrder(db.invoices, o.id)} dispatched={needsInvoice(o)} onOpen={openInvoice} className="max-w-full" />}
                      {!!o.returns?.length && <span className="text-xs tabular-nums text-muted-foreground line-through">{fmtMoney(o.amount)}</span>}
                      <span className="font-bold text-base tabular-nums text-brand-dark">{fmtMoney(o.returns?.length ? keptValue(o) : o.amount)}</span>
                    </div>
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      )}

      {/* ── List view: the orders as a table — the same table as every list ── */}
      {view === "list" && total > 0 && (
        <div className="card-luxe p-3 sm:p-4">
          <DataTable
            id="orders-list"
            noun="order"
            rows={orders}
            columns={listColumns}
            rowKey={o => o.id}
            rowHref={o => `/orders/${o.id}`}
            details={orderDetails}
            defaultSort={{ key: "placed", dir: "desc" }}
            selected={isStaff ? sel : undefined}
            onSelectedChange={isStaff ? setSel : undefined}
            totals={{ amount: rows => fmtMoney(rows.reduce((s, o) => s + (o.returns?.length ? keptValue(o) : o.amount), 0)) }}
          />
        </div>
      )}

      {/* Board: every order in its stage column — all of them, not one page. */}
      {view === "board" && total > 0 && <OrderBoard orders={orders} />}

      {view === "grid" && <PaginationBar
        page={page}
        totalPages={totalPages}
        onPageChange={setPage}
        label={total > 0 ? `Showing ${start + 1}–${end} of ${total} orders` : undefined}
      />}

      <TrackingModal order={trackingOrder} onClose={() => setTrackingOrder(null)} />

      {bulkDispatch && chosen.length > 0 && (
        <BulkDispatchDialog
          orders={chosen}
          onClose={() => setBulkDispatch(false)}
          onDone={() => { setBulkDispatch(false); setSel(new Set()); }}
        />
      )}

      {bulkDeliver && chosen.length > 0 && (
        <BulkDeliverDialog
          orders={chosen}
          onClose={() => setBulkDeliver(false)}
          onDone={() => { setBulkDeliver(false); setSel(new Set()); }}
        />
      )}

      {bulkAssign && chosen.length > 0 && (
        <AssignOrdersDialog orders={chosen} onClose={() => { setBulkAssign(false); setSel(new Set()); }} />
      )}

      {bulkInvoice && chosen.length > 0 && (
        <BulkInvoiceDialog
          orders={chosen}
          onClose={() => setBulkInvoice(false)}
          onDone={() => { setBulkInvoice(false); setSel(new Set()); }}
        />
      )}
    </div>
  );
}
