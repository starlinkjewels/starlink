import { stageLabel } from "@/lib/stages";
import { looseLabel, pieceLine, stoneOf } from "@/lib/orderText";
import { Facets } from "@/components/Facets";
import { deleteHint, deleteOrderFlow, orderDeleteBlocker, restoreOrderFlow } from "@/lib/orderAdmin";
import { DataTable, CellTag, CellAmount, CellDate, type DataColumn } from "@/components/DataTable";
import { metalLabel } from "@/lib/metals";
import { companiesOf, companyIdOfClient, companyOfOrder, hasCompanies } from "@/lib/companies";
import { PageHeader } from "@/components/PageHeader";
import { ExportMenu, FilterChips, FiltersButton, type TableExport, type TableFilter } from "@/components/TableToolbar";
import { OrderBoard } from "@/components/OrderBoard";
import { ProductionInfo } from "@/components/ProductionInfo";
import { diamondsMissing, productionDelayDays, productionTrack, type ProductionTrack } from "@/lib/production";
import { pieceWeights } from "@/lib/weights";
import { useCan, useMayExport } from "@/hooks/useCan";
import { useMemo, useState } from "react";
import { filled, when, userName, refLink, noteText, refNo, type Detail } from "@/components/rowDetails";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "@/lib/auth";
import { loadDb, fmtMoney, fmtDate, currentUserOrders, worksOnClientId, findInvoiceForOrder, keptValue, returnedQty, orderImage, isDiamondOnlyOrder, orderTotal, totalAdvance, balanceDue } from "@/lib/db";
import { useDb, useDbVersion } from "@/hooks/useDb";
import { StatusBadge } from "@/components/StatusBadge";
import { TrackingModal } from "@/components/TrackingModal";
import { Share2, AlertTriangle, Package, Plus, Search, Truck, ExternalLink, Rows3, LayoutGrid, Columns3, UserCog, Gem, FileText, FileSpreadsheet, Check, X, PackageCheck, TrendingUp, Eye, Pencil, XCircle, Trash2, Copy, Undo2 } from "lucide-react";
import { copyBlocker, copyHref } from "@/lib/orderCopy";
import { MoreMenu, type MoreAction } from "@/components/MoreMenu";
import { OrderEditDialog } from "@/components/OrderEditDialog";
import { cancelAccess, cancelBlocker, orderEditAccess, orderSpecLocks } from "@/lib/orderGuards";
import { cancelOrder, cancelQuestion, cancelRefusal } from "@/lib/orderCancel";
import { confirmBox } from "@/lib/confirm";
import { toast } from "sonner";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { usePagination } from "@/hooks/usePagination";
import { exportProductsCsv, exportProductsPdf, exportProfitCsv } from "@/lib/productExport";
import { BulkDispatchDialog, BulkDeliverDialog } from "@/components/BulkDispatchDialog";
import { BulkInvoiceDialog } from "@/components/BulkInvoiceDialog";
import { AssignOrdersDialog } from "@/components/AssignOrder";
import { ShareProductsSheet } from "@/components/ShareProductsSheet";
import { reachOf } from "@/lib/permissions";
import { OrderProfitBadge } from "@/components/OrderProfitCard";
import { InvoiceBadge, needsInvoice } from "@/components/InvoiceBadge";
import { PaginationBar } from "@/components/PaginationBar";
import type { Order, MaterialIssuance } from "@/lib/db";
import { useUrlState } from "@/hooks/useUrlState";

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
/** "Returned", or "2 of 4 returned" when the client kept some. */
function returnTag(o: Order): string {
  const back = returnedQty(o), of = o.quantity || 1;
  return back >= of ? "Returned" : `${back} of ${of} returned`;
}

function jobFinished(o: Order): boolean {
  return !!(o.actualNetWeight || o.actualGrossWeight || o.actualDiamondWeight);
}


function lastTrackingStep(o: Order): string {
  const inProgress = o.timeline.find(t => t.status === "in_progress");
  if (inProgress) return stageLabel(inProgress.step);
  const done = o.timeline.filter(t => t.status === "done");
  if (done.length) return stageLabel(done[done.length - 1].step);
  return o.timeline[0] ? stageLabel(o.timeline[0].step) : "";
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
  // Kept in the address: Back from a record returns to the list as it was left.
  const [q, setQ] = useUrlState("q");
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
  // Pictures that would not load show the small icon tile instead of a blank square.
  const [brokenImg, setBrokenImg] = useState<Set<string>>(new Set());
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

  // Each running order's production: since when, how many days, its diamonds —
  // for the Delayed and Diamonds filters, the count at the top and the cards.
  const tracks = useMemo(() => {
    const m = new Map<string, ProductionTrack>();
    if (!isStaff) return m;
    const dia = new Map<string, MaterialIssuance[]>();
    for (const i of db.materialIssuances ?? []) if (i.orderId && i.material === "diamond") dia.set(i.orderId, [...(dia.get(i.orderId) ?? []), i]);
    for (const o of currentUserOrders(db, user!)) {
      const t = productionTrack(o, dia.get(o.id) ?? [], db.settings);
      if (t) m.set(o.id, t);
    }
    return m;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db, dbVersion, user, isStaff]);
  const delayLimit = productionDelayDays(db.settings);
  const delayedCount = useMemo(() => [...tracks.values()].filter(t => t.delayed).length, [tracks]);
  const noDiamondCount = useMemo(() => [...tracks.values()].filter(diamondsMissing).length, [tracks]);

  const orders = useMemo(() => {
    // Deleted orders are off every list; the admin's "Deleted" filter is the one place they show (to restore one).
    let list = status === "deleted" ? currentUserOrders(db, user!, { withDeleted: true }).filter(o => !!o.deletedAt) : currentUserOrders(db, user!);
    // Pending = waiting for approval (the Dashboard's tile counts the same).
    if (status === "Pending") list = list.filter(o => o.status === "Waiting");
    // Shipped work that nobody has billed yet — the whole point of the badge,
    // gathered into one list instead of spotted by scrolling.
    else if (status === "uninvoiced") list = list.filter(o => needsInvoice(o) && !findInvoiceForOrder(db.invoices, o.id));
    // Pieces the client sent back — whole orders or some of their pieces.
    else if (status === "returned") list = list.filter(o => !!o.returns?.length);
    // In production past the business's limit, longest first.
    else if (status === "delayed") list = list.filter(o => tracks.get(o.id)?.delayed);
    // Being made, its diamonds asked for and not yet sent to the factory.
    else if (status === "nodiamonds") list = list.filter(o => diamondsMissing(tracks.get(o.id) ?? null));
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
    // A client's name finds their orders too — as do the person who placed it,
    // the parcel's tracking no., the factory's bill no. and an earlier order no.
    const clientName = new Map(db.clients.map(c => [c.id, `${c.companyName} ${c.ownerName}`.toLowerCase()]));
    if (terms.length) list = list.filter(o => terms.some(t =>
      o.orderNumber.toLowerCase().includes(t) ||
      o.jewelleryType.toLowerCase().includes(t) ||
      (o.designNumber ?? "").toLowerCase().includes(t) ||
      (o.returns ?? []).some(r => r.creditNoteNo.toLowerCase().includes(t)) ||
      (clientName.get(o.clientId) ?? "").includes(t) ||
      (o.contactPerson ?? "").toLowerCase().includes(t) ||
      (o.trackingNumber ?? "").toLowerCase().includes(t) ||
      (o.factoryBillNo ?? "").toLowerCase().includes(t) ||
      (o.previousOrderNumber ?? "").toLowerCase().includes(t)
    ));
    // A copy: for the admin with no filter, `list` is the store's own array,
    // and sorting it in place reordered every other page's lists too.
    if (status === "delayed" || status === "nodiamonds") return [...list].sort((a, b) => (tracks.get(b.id)?.days ?? 0) - (tracks.get(a.id)?.days ?? 0));
    return [...list].sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db, dbVersion, user, q, status, clientFilter, employeeFilter, companyFilter, tracks]);

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
  // Share the pieces with a client — a product PDF or a link (what is ticked, else what is shown).
  const [sharing, setSharing] = useState<Order[] | null>(null);
  const [bulkDeliver, setBulkDeliver] = useState(false);
  const [bulkInvoice, setBulkInvoice] = useState(false);
  const [bulkAssign, setBulkAssign] = useState(false);
  // The badge is a way in as well as a marker — the invoice it names opens on
  // the Invoices page, already searched for.
  const nav = useNavigate();
  const openInvoice = (number: string) => nav(`/invoices?q=${encodeURIComponent(number)}`);

  // What can be done to one order from the list — the same actions, checks and
  // reasons as the order page's own ⋯ (lib/orderGuards.ts). Staff see every
  // action, greyed with the reason when it can't be used; a client just opens it.
  const [editing, setEditing] = useState<Order | null>(null);
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const cancel = async (o: Order) => {
    // Checked with the invoices and Ready Stock loaded — read before they
    // arrive, a billed order would look cancellable.
    const why = cancelAccess(user) ?? await cancelRefusal(o.id);
    if (why) { toast.error(why); return; }
    if (!(await confirmBox(cancelQuestion(o.orderNumber)))) return;
    setCancellingId(o.id);
    try {
      await cancelOrder(o.id, user!);
      toast.success(`${o.orderNumber} cancelled — material returned & any advance moved to client credit`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to cancel order");
    } finally { setCancellingId(null); }
  };
  const orderActions = (o: Order): MoreAction[] => {
    // A deleted order: only seen, or brought back.
    if (o.deletedAt) return [
      { label: "View", icon: Eye, onSelect: () => nav(`/orders/${o.id}`) },
      { label: "Restore", icon: Undo2, hint: "Back as a cancelled order — re-open it on its page", onSelect: () => { void restoreOrderFlow(o.id, user!); }, show: user!.role === "admin" },
    ];
    const editWhy = orderEditAccess(db, user, can, o) ?? orderSpecLocks(db, o).all;
    const cancelWhy = cancelAccess(user) ?? cancelBlocker(db, o);
    return [
      { label: "View", icon: Eye, onSelect: () => nav(`/orders/${o.id}`) },
      { label: "Edit details", icon: Pencil, hint: editWhy ?? "Type, metal, size, due date", disabled: !!editWhy, onSelect: () => setEditing(o), show: isStaff },
      { label: "Duplicate", icon: Copy, hint: copyBlocker(user, can) ?? "A new order with these details — change what's different", disabled: !!copyBlocker(user, can), onSelect: () => nav(copyHref(o)), show: isStaff },
      { label: "Cancel order", icon: XCircle, danger: true, hint: cancelWhy ?? "Closes it; can be re-opened", disabled: !!cancelWhy || cancellingId === o.id, onSelect: () => cancel(o), show: isStaff },
      { label: "Delete", icon: Trash2, danger: true, hint: orderDeleteBlocker(db, user, o) ?? deleteHint(db, o),
        disabled: !!orderDeleteBlocker(db, user, o), onSelect: () => { void deleteOrderFlow(o.id, user!); }, show: isStaff },
    ];
  };
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
                {pieceLine(o)}{isDiamondOnlyOrder(o) ? "" : ` · ${o.quantity} pc${o.quantity !== 1 ? "s" : ""}`}{o.designNumber ? ` · #${o.designNumber}` : ""}
              </p>
              {(o.melted || jobFinished(o) || !!o.returns?.length) && (
                <div className="flex flex-wrap gap-1 mt-0.5">
                  {o.melted ? <CellTag tone="red">Melted</CellTag> : jobFinished(o) && <CellTag tone="red">Job finish</CellTag>}
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
              <div className="h-1.5 flex-1 rounded-full bg-secondary overflow-hidden"><div className="h-full bg-primary" style={{ width: `${pct}%` }} /></div>
              <span className="text-[11px] tabular-nums text-muted-foreground w-8 text-right">{pct}%</span>
            </div>
            {active && !o.courierName && <p className="text-[11px] text-primary truncate max-w-[12rem] mt-0.5">{lastTrackingStep(o)}</p>}
          </div>
        );
      } },
    ...(isStaff ? [{ key: "production", header: "Production", kind: "number" as const, sortFirst: "desc" as const,
      // Sorted by days in production, the running pieces only — finished ones go last.
      sortValue: (o: Order) => { const t = tracks.get(o.id); return t?.running ? t.days ?? 0 : null; },
      cell: (o: Order) => { const t = tracks.get(o.id); return t ? <div className="min-w-[10.5rem]"><ProductionInfo t={t} compact /></div> : <span className="text-muted-foreground">—</span>; } }] : []),
    { key: "due", header: "Due", kind: "date", sortFirst: "asc", sortValue: o => o.expectedDelivery, cell: o => <CellDate>{fmtDate(o.expectedDelivery)}</CellDate> },
    { key: "weights", header: "Weights", hidden: true, sortValue: o => pieceWeights(o, issByOrder.get(o.id) ?? []).gross || null,
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
      { key: "factory", header: "Factory", hidden: true, sortValue: (o: Order) => factoriesOf(o).join(", "),
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
    // Has the client paid? — at a glance, not five sections down the order.
    { key: "balance", header: "Balance due", align: "right", kind: "number", card: "first" as const,
      sortValue: o => (o.status === "Rejected" || o.deletedAt ? null : balanceDue(o)), csv: o => (o.status === "Rejected" ? "" : balanceDue(o)),
      cell: o => {
        if (o.status === "Rejected" || o.deletedAt || !(o.amount > 0)) return <span className="text-muted-foreground/50">—</span>;
        const due = balanceDue(o);
        return due > 0.005 ? <CellAmount tone="out">{fmtMoney(due)}</CellAmount> : <span className="text-success text-xs font-semibold">Paid</span>;
      } },
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
      !!st && { label: "Stage", value: [stageLabel(st.step), st.date && when(st.date), by && `by ${by}`, st.remarks].filter(Boolean).join(" · ") },
      { label: "Placed", value: when(o.createdAt) },
      o.priority !== "Normal" && { label: "Priority", value: o.priority },
      { label: "Assigned to", value: userName(db, o.assignedEmployeeId) },
      { label: "Contact person", value: o.contactPerson },
      { label: "Company", value: company },
      (o.diamondWeight > 0 || (o.actualDiamondWeight ?? 0) > 0) && !o.noDiamond && { label: "Diamonds", value: `${[o.diamondShape, o.diamondType].filter(Boolean).join(" ")}${o.actualDiamondPcs ? ` · ${o.actualDiamondPcs} stones` : ""}` },
      { label: "Size", value: o.productSize },
      { label: "Colour", value: o.productColor },
      { label: "Rhodium", value: o.rhodium },
      { label: "Stamping", value: o.stamping },
      { label: "Engraving", value: o.engraving?.text ? `“${o.engraving.text}” (${o.engraving.font === "script" ? "script" : "block"} letters)` : undefined },
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

  // The same narrowing as ever — status, client, company, person — behind one
  // Filters button in whichever view is open. "" in a filter means "all".
  const pick = (set: (v: string) => void) => (v: string) => set(v || "all");
  const filters: TableFilter[] = [
    { kind: "select", label: "Status", value: status === "all" ? "" : status, onChange: pick(setStatus), allLabel: "All status",
      options: [
        ...(isStaff ? [{ value: "uninvoiced", label: "Not invoiced (shipped)" }] : []),
        { value: "returned", label: "Returned by client" },
        ...(isStaff ? [
          { value: "delayed", label: `Delayed — ${delayLimit}+ days in production` },
          { value: "nodiamonds", label: "In production — diamonds not issued" },
        ] : []),
        ...(user!.role === "admin" ? [{ value: "deleted", label: "Deleted (to restore)" }] : []),
        // "Waiting" is the one for approval (an old ?status=Pending link still lands there).
        ...["Waiting", "Approved", "In Production", "Ready", "Dispatched", "Delivered", "Rejected"].map(s => ({ value: s, label: s === "Waiting" ? "Waiting — for approval" : s })),
      ] },
    ...(isStaff ? [{ kind: "select" as const, label: "Client", value: clientFilter === "all" ? "" : clientFilter, onChange: pick(setClientFilter), allLabel: "All clients",
      options: db.clients.filter(c => worksOnClientId(db, user, c.id)).sort((a, b) => a.companyName.localeCompare(b.companyName)).map(c => ({ value: c.id, label: c.companyName })) }] : []),
    ...(isStaff && multiCo ? [{ kind: "select" as const, label: "Company", value: companyFilter === "all" ? "" : companyFilter, onChange: pick(setCompanyFilter), allLabel: "All companies",
      options: companiesOf(db.settings).map(c => ({ value: c.id, label: c.name })) }] : []),
    ...(user!.role === "admin" ? [{ kind: "select" as const, label: "Employee", value: employeeFilter === "all" ? "" : employeeFilter, onChange: pick(setEmployeeFilter), allLabel: "All employees",
      options: db.users.filter(u => (u.role === "employee" || u.role === "admin") && u.status !== "inactive")
        .sort((a, b) => a.name.localeCompare(b.name))
        .map(u => ({ value: u.id, label: `${u.name}${u.role === "admin" ? " (admin)" : ""}` })) }] : []),
  ];
  const clearFilters = () => { setStatus("all"); setClientFilter("all"); setCompanyFilter("all"); setEmployeeFilter("all"); };
  // The product sheet: what is ticked, else what the filters left. The profit
  // sheet says it is the admin's own — the others go to customers for a bulk
  // sale, and cost must never be one forward away from one.
  const exports: TableExport[] = isStaff && orders.length > 0 ? [
    { label: "Share — product PDF or link", icon: Share2, hint: "Photos, video, details, the price you set — a page a piece or a line sheet",
      onSelect: () => { if (exportRows.length > 150) { toast.error("Tick up to 150 pieces to share at once"); return; } setSharing(exportRows); } },
    { label: "PDF", icon: FileText, hint: "Order sheet — weights, totals, paid, due", onSelect: () => exportProductsPdf(db, exportRows, exportName(), exportSubject()) },
    { label: "Excel", icon: FileSpreadsheet, hint: "The same sheet, to edit", onSelect: () => exportProductsCsv(db, exportRows, exportName()) },
    ...(user!.role === "admin" ? [{ label: "Profit — Excel", icon: TrendingUp, hint: "Admin only — never send out", onSelect: () => exportProfitCsv(db, exportRows, exportName()) }] : []),
  ] : [];
  const mayExport = useMayExport();
  const countText = `${total} order${total !== 1 ? "s" : ""}`;
  const searchHint = "Search — or 1090, 1091, LR-528";

  // Bulk work on the ticked pieces.
  const selectionBar = isStaff && sel.size > 0 ? (
    <div className="rounded-xl border border-primary/20 bg-primary/[0.04] px-3 py-2 flex flex-wrap items-center gap-x-3 gap-y-2 text-sm">
      <span className="font-semibold text-brand-dark">
        {chosen.length} selected
      </span>
      {chosen.length !== sel.size && (
        <span className="text-xs text-muted-foreground">
          ({sel.size - chosen.length} hidden by filters, left out)
        </span>
      )}
      <span className="text-xs text-muted-foreground">Downloads hold just these.</span>
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
  ) : null;
  const emptyBody = user!.role === "employee" && currentUserOrders(db, user!).length === 0 ? (
    <>
      <span className="block font-medium text-brand-dark">No orders are yours yet.</span>
      <span className="block text-xs mt-1 max-w-md mx-auto">
        {reachOf(user, db.roles ?? []) === "all" ? "There are no orders yet." : "Ask the admin to assign you orders or clients."}
      </span>
    </>
  ) : "No orders match."

  return (
    <div className="max-w-7xl mx-auto space-y-4">

      {/* ── Page header: the view switch, and the one main button ── */}
      <PageHeader
        title="Orders"
        primary={(user!.role === "client" || user!.role === "admin" || (user!.role === "employee" && can("orders", "add")))
          ? { label: "New Order", icon: Plus, onClick: () => nav("/orders/new") } : null}
        actions={
          <Select value={view} onValueChange={v => saveView(v as "list" | "grid" | "board")}>
            <SelectTrigger className="shrink-0 w-[7.5rem] h-10 rounded-xl text-sm bg-white" aria-label="View">
              {view === "list" ? <Rows3 className="h-3.5 w-3.5 mr-1.5 shrink-0" /> : view === "grid" ? <LayoutGrid className="h-3.5 w-3.5 mr-1.5 shrink-0" /> : <Columns3 className="h-3.5 w-3.5 mr-1.5 shrink-0" />}
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="list">List</SelectItem>
              <SelectItem value="grid">Grid</SelectItem>
              {isStaff && <SelectItem value="board">Board</SelectItem>}
            </SelectContent>
          </Select>
        }
      />

      {/* ── Production to chase: pieces past the limit, and pieces being made
          without their diamonds. Each opens the list of them. ── */}
      {isStaff && (delayedCount > 0 || noDiamondCount > 0) && (
        <div className="flex flex-wrap gap-2">
          {delayedCount > 0 && (
            <button type="button" onClick={() => setStatus(status === "delayed" ? "all" : "delayed")} aria-pressed={status === "delayed"}
              className={`inline-flex items-center gap-2 h-9 px-3 rounded-xl border text-sm transition-colors ${status === "delayed" ? "bg-destructive text-white border-destructive" : "bg-destructive/5 border-destructive/25 text-destructive hover:bg-destructive/10"}`}>
              <AlertTriangle className="h-4 w-4" />
              <span className="font-semibold tabular-nums">{delayedCount}</span> delayed · {delayLimit}+ days in production
            </button>
          )}
          {noDiamondCount > 0 && (
            <button type="button" onClick={() => setStatus(status === "nodiamonds" ? "all" : "nodiamonds")} aria-pressed={status === "nodiamonds"}
              className={`inline-flex items-center gap-2 h-9 px-3 rounded-xl border text-sm transition-colors ${status === "nodiamonds" ? "bg-amber-600 text-white border-amber-600" : "bg-amber-500/10 border-amber-500/30 text-amber-800 hover:bg-amber-500/15"}`}>
              <Gem className="h-4 w-4" />
              <span className="font-semibold tabular-nums">{noDiamondCount}</span> in production · diamonds not issued
            </button>
          )}
        </div>
      )}

      {/* ── Grid and Board: the table's one toolbar row, without the table —
          search, Filters, the count and Export (the list has its own). ── */}
      {view !== "list" && (
        <div className="space-y-2.5">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative flex-1 min-w-[12rem] sm:max-w-sm max-sm:basis-full">
              <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
              <input value={q} onChange={e => setQ(e.target.value)} placeholder={searchHint} aria-label={searchHint}
                className="h-9 w-full rounded-xl border border-border bg-white pl-9 pr-8 text-sm placeholder:text-muted-foreground/80 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/40" />
              {q && (
                <button type="button" onClick={() => setQ("")} aria-label="Clear search"
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 h-6 w-6 grid place-items-center rounded-md text-muted-foreground hover:bg-secondary hover:text-foreground"><X className="h-3.5 w-3.5" /></button>
              )}
            </div>
            <FiltersButton filters={filters} onClear={clearFilters} count={countText} />
            <div className="ml-auto flex items-center gap-2">
              <span className="text-xs text-muted-foreground tabular-nums whitespace-nowrap">{countText}{chosen.length ? ` · ${chosen.length} ticked` : ""}</span>
              {mayExport && <ExportMenu exports={exports} scope={`Product sheet · ${chosen.length ? `${chosen.length} ticked` : `${orders.length} shown`}`} />}
            </div>
          </div>
          <FilterChips filters={filters} onClear={clearFilters} />
        </div>
      )}

      {/* ── What is ticked, and what the download will hold (in the list, it
          sits between the table's toolbar and its rows) ── */}
      {view !== "list" && selectionBar}

      {/* ── Empty state (the list says it in its table, under its toolbar) ── */}
      {total === 0 && view !== "list" && (
        <div className="card-luxe p-12 text-center text-muted-foreground">
          <Package className="h-10 w-10 mx-auto mb-3 opacity-20" />
          <p>{emptyBody}</p>
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
                    a CAD sheet's measurements run right to its corners. On a
                    narrow phone card the status gives way (it shortens), the
                    tick box never does. */}
                <div className="flex items-center justify-between gap-2 px-3 pt-3 pb-2 min-w-0">
                  <StatusBadge status={o.status} />
                  {isStaff && <SelectBox checked={sel.has(o.id)} onToggle={() => toggleSel(o.id)}
                    className={`shrink-0 ${sel.size ? "" : "[@media(hover:hover)]:opacity-0 group-hover:opacity-100 focus-visible:opacity-100"}`} />}
                </div>
                {/* The whole sheet, on white: shown in full, never cropped. */}
                {img && !brokenImg.has(o.id) ? (
                  <div className="relative mx-3 aspect-square rounded-xl overflow-hidden ring-1 ring-border/60 bg-secondary/60 animate-pulse">
                    <img
                      src={img}
                      alt={o.orderNumber}
                      loading="lazy"
                      decoding="async"
                      onLoad={e => { const box = e.currentTarget.parentElement; box?.classList.remove("animate-pulse", "bg-secondary/60"); box?.classList.add("bg-white"); }}
                      onError={() => setBrokenImg(prev => new Set(prev).add(o.id))}
                      className="relative z-10 w-full h-full object-contain p-1 transition-transform duration-300 ease-out group-hover:scale-[1.03]"
                    />
                  </div>
                ) : isDiamondOnlyOrder(o) ? <StoneTile o={o} /> : (
                  // No photo yet: the same square as the cards beside it, so the grid stays even.
                  <div className="mx-3 aspect-square rounded-xl bg-secondary/50 ring-1 ring-border/60 grid place-items-center text-center">
                    <div>
                      <Package className="mx-auto h-8 w-8 text-primary/35" />
                      <p className="mt-2 text-xs text-muted-foreground">No photo yet</p>
                    </div>
                  </div>
                )}
                <div className="px-3 pt-3 pb-3 flex flex-col flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-1 min-w-0 -mr-1.5">
                    <p className="font-semibold text-[15px] max-sm:text-sm leading-tight tracking-tight truncate">{o.orderNumber}</p>
                    {/* Inside the card's link: a click on the menu (or in it — React
                        events travel up from the menu's portal) must not open the order. */}
                    {isStaff && (
                      <span onClick={e => { e.preventDefault(); e.stopPropagation(); }} className="contents">
                        <MoreMenu size="xs" label={`Actions for ${o.orderNumber}`} title={o.orderNumber} actions={orderActions(o)} className="-my-1.5" />
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground truncate mt-1">
                    {isDiamondOnlyOrder(o) && !(img && !brokenImg.has(o.id)) ? looseLabel(o) : pieceLine(o)}{o.designNumber ? ` · #${o.designNumber}` : ""}
                  </p>
                  {user!.role !== "client" && (o.forReadyStock
                    ? <p className="text-xs font-medium text-primary truncate mt-1">Ready Stock</p>
                    : client && <p className="text-xs font-semibold text-foreground/70 truncate mt-1">{client.companyName}</p>)}
                  {(o.melted || jobFinished(o) || !!o.returns?.length) && (
                    <div className="flex flex-wrap gap-1 mt-1.5">
                      {(o.melted || jobFinished(o)) && <CellTag tone="red">{o.melted ? "Melted" : "Job finish"}</CellTag>}
                      {!!o.returns?.length && <CellTag tone="amber">{returnTag(o)}</CellTag>}
                    </div>
                  )}
                  {user!.role === "admin" && <OrderProfitBadge db={db} order={o} className="mt-1.5 text-xs" />}
                  {isStaff && (() => {
                    const wp = pieceWeights(o, db.materialIssuances).problem;
                    return wp ? <p title={wp} className="text-[10px] font-semibold text-destructive truncate mt-1">⚠ Check weights</p> : null;
                  })()}
                  {(() => {
                    const t = tracks.get(o.id);
                    return t?.running ? <div className="mt-2"><ProductionInfo t={t} /></div> : null;
                  })()}
                  <div className="mt-auto pt-3">
                    <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground mb-1.5">
                      <span className="truncate">{o.status === "Rejected" ? (o.melted ? "Melted" : "Rejected") : lastTrackingStep(o)}</span>
                      <span className="tabular-nums font-medium shrink-0">{progress}%</span>
                    </div>
                    <div className="h-1.5 rounded-full bg-secondary overflow-hidden">
                      <div className="h-full rounded-full bg-primary" style={{ width: `${progress}%` }} />
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

      {/* ── List view: the orders as a table — the same table as every list,
          with the search, Filters and Export in its own toolbar. Shown with no
          rows too, so the filters that emptied it can be undone right there. ── */}
      {view === "list" && (
        <div className="card-luxe p-3 sm:p-4">
          <DataTable
            id="orders-list"
            noun="order"
            rows={orders}
            search={{ value: q, onChange: setQ, placeholder: searchHint }}
            filters={filters}
            onClearFilters={clearFilters}
            exports={exports}
            summary={selectionBar}
            emptyText={emptyBody}
            resetKey={JSON.stringify([q, status, clientFilter, employeeFilter, companyFilter])}
            columns={listColumns}
            rowKey={o => o.id}
            rowHref={o => `/orders/${o.id}`}
            details={orderDetails}
            rowActions={orderActions}
            defaultSort={{ key: "placed", dir: "desc" }}
            selected={isStaff ? sel : undefined}
            onSelectedChange={isStaff ? setSel : undefined}
            totals={{ amount: rows => fmtMoney(rows.reduce((s, o) => s + (o.returns?.length ? keptValue(o) : o.amount), 0)) }}
          />
        </div>
      )}

      {/* Board: every order in its stage column — all of them, not one page. */}
      {view === "board" && total > 0 && <OrderBoard orders={orders} actions={isStaff ? orderActions : undefined} tracks={tracks} />}

      {view === "grid" && <PaginationBar
        page={page}
        totalPages={totalPages}
        onPageChange={setPage}
        label={total > 0 ? `Showing ${start + 1}–${end} of ${total} orders` : undefined}
      />}

      <TrackingModal order={trackingOrder} onClose={() => setTrackingOrder(null)} />

      {editing && <OrderEditDialog order={editing} onClose={() => setEditing(null)} />}

      {sharing && <ShareProductsSheet orders={sharing} onClose={() => setSharing(null)} />}
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

/**
 * A loose-stones order without a photo: what is being sold, at a glance — the
 * carats large, what the stones are, then shape and size, grade and pieces —
 * in the same square as the photo cards beside it.
 */
function StoneTile({ o }: { o: Order }) {
  const ct = o.actualDiamondWeight || o.diamondWeight;
  const sp = o.stoneSpec ?? {};
  const stone = stoneOf(o);
  const what = stone !== "Diamond" ? [sp.type, stone].filter(Boolean).join(" ") : o.diamondType ? `${o.diamondType} diamonds` : "Diamonds";
  const facts = [[sp.shape, sp.mm || sp.size].filter(Boolean).join(" "), [sp.color, sp.clarity].filter(Boolean).join(" "), o.quantity > 1 ? `${o.quantity} pcs` : ""].filter(Boolean);
  return (
    <div className="relative mx-3 aspect-square rounded-xl overflow-hidden ring-1 ring-border/60 bg-gradient-to-br from-primary/[0.07] via-card to-sky-500/[0.08] grid place-items-center">
      <Facets className="absolute -right-[18%] -bottom-[18%] w-[80%] h-[80%] text-primary/[0.13]" />
      <div className="relative text-center px-3 min-w-0 max-w-full">
        <Gem className="mx-auto h-6 w-6 text-primary/60" />
        <p className="mt-2 text-2xl sm:text-[1.9rem] font-semibold tracking-tight tabular-nums text-foreground leading-none">
          {ct ? ct : "—"}<span className="ml-1 text-sm sm:text-base font-medium text-muted-foreground">ct</span>
        </p>
        <p className="mt-1.5 text-sm font-medium text-foreground/80 truncate">{what}</p>
        {facts.length > 0 && (
          <div className="mt-2.5 flex flex-wrap justify-center gap-1">
            {facts.map(f => <span key={f} className="text-[11px] leading-5 px-2 rounded-full bg-card/90 ring-1 ring-border/70 text-foreground/75 whitespace-nowrap">{f}</span>)}
          </div>
        )}
      </div>
    </div>
  );
}
