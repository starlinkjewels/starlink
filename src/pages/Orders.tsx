import { companiesOf, companyIdOfClient, hasCompanies } from "@/lib/companies";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { OrderBoard } from "@/components/OrderBoard";
import { pieceWeights } from "@/lib/weights";
import { useCan } from "@/hooks/useCan";
import { useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "@/lib/auth";
import { loadDb, fmtMoney, fmtDate, currentUserOrders, findInvoiceForOrder, orderIsDispatched } from "@/lib/db";
import { useDb, useDbVersion } from "@/hooks/useDb";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/StatusBadge";
import { TrackingModal } from "@/components/TrackingModal";
import { Package, Plus, Search, Filter, Truck, ExternalLink, Rows3, LayoutGrid, Columns3, Download, ChevronDown, UserCog, Building2, Users, Factory as FactoryIcon, Coins, Gem, FileText, FileSpreadsheet, Check, X, PackageCheck, TrendingUp } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { usePagination } from "@/hooks/usePagination";
import { exportProductsCsv, exportProductsPdf, exportProfitCsv } from "@/lib/productExport";
import { BulkDispatchDialog, BulkDeliverDialog } from "@/components/BulkDispatchDialog";
import { BulkInvoiceDialog } from "@/components/BulkInvoiceDialog";
import { AssignOrdersDialog } from "@/components/AssignOrder";
import { reachOf } from "@/lib/permissions";
import { OrderProfitBadge } from "@/components/OrderProfitCard";
import { PaginationBar } from "@/components/PaginationBar";
import type { Order } from "@/lib/db";

const PAGE_SIZE = 12;

/** A piece that ought to be on an invoice by now: it has shipped, it belongs to
 *  a client, and it was not rejected. Anything else has nothing to bill yet. */
function needsInvoice(o: Order): boolean {
  return orderIsDispatched(o) && !o.forReadyStock && o.status !== "Rejected";
}

/**
 * Whether this piece has been billed, said on the card itself.
 *
 * Billing is done a parcel at a time, and an order left out of one simply
 * stopped being mentioned — it looked exactly like an order that had been
 * invoiced, and the only way to find it was to open the Invoices page and work
 * out what was missing. A dispatched piece now either carries its invoice
 * number or says plainly that it has none.
 *
 * Only dispatched work is marked: a piece still in production has nothing to be
 * billed for yet, and flagging it would be noise on every card in the list.
 */
function InvoiceBadge({ invoice, dispatched, onOpen, className = "" }: {
  invoice?: { number: string };
  dispatched: boolean;
  onOpen: (number: string) => void;
  className?: string;
}) {
  if (!invoice && !dispatched) return null;
  if (!invoice) {
    return (
      <span className={`inline-flex items-center gap-1 h-5 px-1.5 rounded-md bg-amber-500/15 border border-amber-500/40 text-[10px] font-bold text-amber-700 ${className}`}>
        <FileText className="h-3 w-3" /> NO INVOICE
      </span>
    );
  }
  return (
    <button
      type="button"
      title={`On invoice ${invoice.number}`}
      onClick={e => { e.preventDefault(); e.stopPropagation(); onOpen(invoice.number); }}
      className={`inline-flex items-center gap-1 h-5 px-1.5 rounded-md bg-destructive border border-destructive text-[10px] font-bold text-white hover:bg-destructive/85 shadow-sm ${className}`}
    >
      <FileText className="h-3 w-3 shrink-0" /> <span className="truncate">{invoice.number}</span>
    </button>
  );
}

/** A tick-box riding on top of a card, which must not follow the card's link. */
function SelectBox({ checked, onToggle, className = "" }: { checked: boolean; onToggle: () => void; className?: string }) {
  return (
    <button
      type="button"
      aria-pressed={checked}
      aria-label={checked ? "Deselect this piece" : "Select this piece"}
      onClick={e => { e.preventDefault(); e.stopPropagation(); onToggle(); }}
      className={`z-30 h-6 w-6 grid place-items-center rounded-md border shadow-soft transition-colors ${checked ? "bg-primary border-primary text-white" : "bg-white/90 border-border text-transparent hover:border-primary"} ${className}`}
    >
      <Check className="h-4 w-4" />
    </button>
  );
}

/** The factory has reported back: net weight, purity and the finished piece are
 *  recorded, so the job itself is done even if the order has not shipped. */
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
    else if (status !== "all") list = list.filter(o => o.status === status);
    if (clientFilter !== "all") list = list.filter(o => o.clientId === clientFilter);
    if (companyFilter !== "all") list = list.filter(o => companyIdOfClient(db.clients.find(c => c.id === o.clientId)) === companyFilter);
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
      (o.designNumber ?? "").toLowerCase().includes(t)
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
            const img = o.cadImage || o.images?.[0];
            return (
              <Link key={o.id} to={`/orders/${o.id}`}
                className={`card-luxe card-hover overflow-hidden block min-w-0 ${sel.has(o.id) ? "ring-2 ring-primary" : ""}`}>
                {/* Status and the tick box sit above the photo, never on it —
                    a CAD sheet's measurements run right to its corners. */}
                <div className="flex items-center justify-between gap-2 px-2.5 py-2">
                  <StatusBadge status={o.status} />
                  {isStaff && <SelectBox checked={sel.has(o.id)} onToggle={() => toggleSel(o.id)} />}
                </div>
                <div className={`relative aspect-square overflow-hidden ${img ? "bg-secondary animate-pulse" : "bg-secondary/50"}`}>
                  {img ? (
                    <img
                      src={img}
                      alt={o.orderNumber}
                      loading="lazy"
                      decoding="async"
                      onLoad={e => e.currentTarget.parentElement?.classList.remove("animate-pulse")}
                      onError={e => { e.currentTarget.parentElement?.classList.remove("animate-pulse"); e.currentTarget.style.display = "none"; }}
                      className="relative z-10 w-full h-full object-cover"
                    />
                  ) : (
                    <div className="w-full h-full grid place-items-center"><Package className="h-8 w-8 text-primary/30" /></div>
                  )}
                </div>
                <div className="p-3">
                  <p className="font-semibold text-sm leading-tight truncate">{o.orderNumber}</p>
                  <p className="text-[11px] text-muted-foreground truncate mt-0.5">
                    {o.jewelleryType} · {o.metal}{o.productKarats ? ` ${o.productKarats}` : ""}{o.designNumber ? ` · #${o.designNumber}` : ""}
                  </p>
                  {o.melted ? (
                    <p className="text-[11px] font-bold text-destructive truncate">MELTED</p>
                  ) : jobFinished(o) && (
                    <p className="text-[11px] font-bold text-destructive truncate">JOB FINISH</p>
                  )}
                  {user!.role !== "client" && (o.forReadyStock
                    ? <p className="text-[11px] font-medium text-primary truncate">🏭 Ready Stock</p>
                    : client && <p className="text-[11px] font-medium text-muted-foreground truncate">{client.companyName}</p>)}
                  {user!.role === "admin" && <OrderProfitBadge db={db} order={o} />}
                  {isStaff && (() => {
                    const wp = pieceWeights(o, db.materialIssuances).problem;
                    return wp ? <p title={wp} className="text-[10px] font-semibold text-destructive truncate">⚠ Check weights</p> : null;
                  })()}
                  <div className="mt-2 h-1.5 rounded-full bg-secondary overflow-hidden">
                    <div className="h-full bg-gradient-to-r from-primary to-brand-light" style={{ width: `${progress}%` }} />
                  </div>
                  <div className="flex items-center justify-between gap-2 mt-1.5">
                    <span className="text-[11px] text-muted-foreground shrink-0">{progress}%</span>
                    <span className="flex flex-wrap items-center justify-end gap-x-1.5 gap-y-1 min-w-0">
                      {isStaff && <InvoiceBadge invoice={findInvoiceForOrder(db.invoices, o.id)} dispatched={needsInvoice(o)} onOpen={openInvoice} className="max-w-full" />}
                      <span className="font-semibold text-sm">{fmtMoney(o.amount)}</span>
                    </span>
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      )}

      {/* ── List view (order cards) ── */}
      {view === "list" && total > 0 && (
      <div className="grid gap-3">
        {paged.map(o => {
          const client = db.clients.find(c => c.id === o.clientId);
          const done   = o.timeline.filter(t => t.status === "done").length;
          const progress = Math.round(done / o.timeline.length * 100);
          const isActive = !["Delivered","Rejected"].includes(o.status);
          const rowImg = o.cadImage || o.images?.[0];
          // Manufacturing summary (staff only) — which factory, how much gold/diamond issued.
          const orderIssuances = user!.role !== "client" ? db.materialIssuances.filter(i => i.orderId === o.id) : [];
          const factoryNames = [...new Set(orderIssuances.map(i => db.factories.find(f => f.id === i.factoryId)?.name).filter(Boolean))] as string[];
          const goldIssued = orderIssuances.filter(i => i.material === "gold").reduce((s, i) => s + i.quantityIssued, 0);
          const diaIssued = orderIssuances.filter(i => i.material === "diamond").reduce((s, i) => s + i.quantityIssued, 0);
          // Weights — prefer actual (post-production), then estimate, then the
          // finished-piece net weight recorded on the factory issuance.
          // One reading of the piece's weights, shared with the band, the
          // exports and Ready Stock — so the card never disagrees with them.
          const pw = pieceWeights(o, orderIssuances);
          const grossWt = pw.gross || undefined;
          const netWt = pw.net || undefined;
          const diaWt = pw.diamondCt || undefined;

          return (
            <Link
              key={o.id}
              to={`/orders/${o.id}`}
              className={`card-luxe card-hover overflow-hidden flex items-stretch min-h-[128px] min-w-0 ${sel.has(o.id) ? "ring-2 ring-primary" : ""}`}
            >
              {/* ── Left: full-height product / CAD photo ── */}
              <div className="relative w-28 sm:w-36 shrink-0 bg-secondary self-stretch">
                {rowImg
                  ? <img src={rowImg} alt={o.orderNumber} loading="lazy" className="absolute inset-0 w-full h-full object-cover" />
                  : <div className="absolute inset-0 grid place-items-center text-muted-foreground/40"><Package className="h-9 w-9" /></div>}
              </div>

              {/* ── Right: order details ── */}
              <div className="flex-1 min-w-0 p-4 flex flex-col gap-2">
                {/* Header — order# + spec + status */}
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-semibold text-sm leading-tight truncate">{o.orderNumber}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {o.jewelleryType} · {o.metal}{o.productKarats ? ` ${o.productKarats}` : ""} · {o.diamondType} · {o.quantity} pc{o.quantity !== 1 ? "s" : ""}
                      {o.designNumber ? ` · #${o.designNumber}` : ""}
                    </p>
                    {o.melted ? (
                      <p className="text-xs font-bold text-destructive mt-0.5">MELTED — {o.melted.reason || "piece melted"}</p>
                    ) : jobFinished(o) && (
                      <p className="text-xs font-bold text-destructive mt-0.5">JOB FINISH — factory details recorded</p>
                    )}
                    {user!.role === "admin" && <OrderProfitBadge db={db} order={o} className="mt-0.5 text-xs" />}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <StatusBadge status={o.status} />
                    {isStaff && <SelectBox checked={sel.has(o.id)} onToggle={() => toggleSel(o.id)} />}
                  </div>
                </div>

                {/* Weights — gross / net / diamond */}
                {(grossWt || netWt || diaWt) && (
                  <div className="flex flex-wrap items-center gap-1.5">
                    {grossWt ? <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-secondary text-foreground/70">Gross {grossWt}g</span> : null}
                    {netWt ? <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-secondary text-foreground/70">Net {netWt}g</span> : null}
                    {diaWt ? <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-secondary text-foreground/70">Dia {diaWt}ct</span> : null}
                    {pw.problem && user!.role !== "client" && (
                      <span title={pw.problem} className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-destructive/10 text-destructive">⚠ Check weights</span>
                    )}
                  </div>
                )}

                {user!.role !== "client" && (o.forReadyStock
                  ? <p className="text-xs font-medium text-primary truncate">🏭 Ready Stock (in-house)</p>
                  : client && <p className="text-xs font-medium text-muted-foreground truncate">{client.companyName}</p>)}

                {/* Manufacturing chips — factory · gold used · diamond used (staff only) */}
                {(factoryNames.length > 0 || goldIssued > 0 || diaIssued > 0) && (
                  <div className="flex flex-wrap items-center gap-1.5">
                    {factoryNames.map(n => (
                      <span key={n} className="inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full bg-orange-500/10 text-orange-700">
                        <FactoryIcon className="h-2.5 w-2.5" />{n}
                      </span>
                    ))}
                    {goldIssued > 0 && (
                      <span className="inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-700">
                        <Coins className="h-2.5 w-2.5" />{goldIssued.toLocaleString()} g gold
                      </span>
                    )}
                    {diaIssued > 0 && (
                      <span className="inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full bg-sky-500/10 text-sky-700">
                        <Gem className="h-2.5 w-2.5" />{diaIssued.toLocaleString()} ct dia
                      </span>
                    )}
                  </div>
                )}

                {/* Progress + due + amount — pinned to the bottom */}
                <div className="mt-auto pt-1">
                  <div className="h-1.5 rounded-full bg-secondary overflow-hidden">
                    <div className="h-full bg-gradient-to-r from-primary to-brand-light transition-all duration-500" style={{ width: `${progress}%` }} />
                  </div>
                  <div className="mt-1.5 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-xs text-muted-foreground">{progress}% · Due {fmtDate(o.expectedDelivery)}</p>
                      {isActive && !o.courierName && (
                        <p className="text-[11px] font-medium text-primary flex items-center gap-1 mt-0.5">
                          <Truck className="h-3 w-3 shrink-0" /><span className="truncate">{lastTrackingStep(o)}</span>
                        </p>
                      )}
                    </div>
                    <span className="flex flex-wrap items-center justify-end gap-x-1.5 gap-y-1 shrink-0">
                      {isStaff && <InvoiceBadge invoice={findInvoiceForOrder(db.invoices, o.id)} dispatched={needsInvoice(o)} onOpen={openInvoice} />}
                      <span className="font-semibold text-sm">{fmtMoney(o.amount)}</span>
                    </span>
                  </div>
                </div>

                {/* Courier + tracking */}
                {o.courierName && (
                  <div className="flex items-center justify-between gap-3 rounded-xl bg-secondary/60 border border-border/60 px-3 py-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <Truck className="h-3.5 w-3.5 text-primary shrink-0" />
                      <span className="text-xs font-semibold text-foreground capitalize">{o.courierName}</span>
                      {o.trackingNumber && <span className="text-xs font-mono text-muted-foreground truncate">{o.trackingNumber}</span>}
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      {o.trackingLink ? (
                        <a href={o.trackingLink} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()}
                          className="inline-flex items-center gap-1 text-xs font-semibold text-primary bg-primary/10 hover:bg-primary/20 rounded-lg px-2.5 py-1 transition-colors">
                          <ExternalLink className="h-3 w-3" /> Track
                        </a>
                      ) : (
                        <button onClick={e => { e.preventDefault(); e.stopPropagation(); setTrackingOrder(o); }}
                          className="inline-flex items-center gap-1 text-xs font-semibold text-primary bg-primary/10 hover:bg-primary/20 rounded-lg px-2.5 py-1 transition-colors">
                          <Truck className="h-3 w-3" /> Track
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </Link>
          );
        })}
      </div>
      )}

      {/* Board: every order in its stage column — all of them, not one page. */}
      {view === "board" && total > 0 && <OrderBoard orders={orders} />}

      {view !== "board" && <PaginationBar
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
