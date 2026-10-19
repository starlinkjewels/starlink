import { useState, type ReactNode } from "react";
import { metalLabel } from "@/lib/metals";
import { SectionTitle } from "@/components/SectionTitle";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  ArrowRightLeft, CircleX, Gem, History, Layers, Lock, Maximize2, Minus, PackagePlus, Pencil, Play, Plus,
  RotateCcw, ShoppingBag, Split, Tag, Trash2, Undo2, type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";
import {
  collectionLoaded, fmtDate, fmtMoney, keptValue, loadDb, stockCostOf, updateDb, worksOnOrder,
  type Order, type ReadyStockEventKind, type ReadyStockItem,
} from "@/lib/db";
import { useDb } from "@/hooks/useDb";
import { useAuth } from "@/lib/auth";
import { useCan, useMayExport } from "@/hooks/useCan";
import { DataTable, CellMain, CellTag, CellAmount, CellDate, type DataColumn } from "@/components/DataTable";
import type { MoreAction } from "@/components/MoreMenu";
import { PageHeader, TabBar } from "@/components/PageHeader";
import { StatusBadge } from "@/components/StatusBadge";
import { CompanyBadge, useMultiCo } from "@/components/CompanyFields";
import { MoveOfficeDialog, OfficeChip } from "@/components/ReadyStockOffices";
import { ReadyStockItemDialog } from "@/components/ReadyStockItemDialog";
import { BandDialog } from "@/components/BandDialog";
import { generateStockBand, labelPresets } from "@/lib/band";
import { confirmBox } from "@/lib/confirm";
import { companyIdOfClient, companyOf } from "@/lib/companies";
import { officeLabel, officeOf, officeRank, otherLots } from "@/lib/offices";
import { pieceTimeline, stepQty, whoOf, type TimelineEntry } from "@/lib/readyStockHistory";
import { readyStockDeleteBlocker } from "@/lib/readyStockGuards";
import { needsAccess } from "@/lib/actionHints";

/** How each kind of history line looks. */
const KIND: Record<ReadyStockEventKind, { icon: LucideIcon; tone: string; label: string }> = {
  added: { icon: PackagePlus, tone: "bg-success/10 text-success", label: "Added" },
  edited: { icon: Pencil, tone: "bg-secondary text-brand-dark", label: "Edited" },
  price: { icon: Tag, tone: "bg-primary/10 text-primary", label: "Price" },
  qty: { icon: Layers, tone: "bg-secondary text-brand-dark", label: "Quantity" },
  moved: { icon: ArrowRightLeft, tone: "bg-primary/10 text-primary", label: "Moved" },
  split: { icon: Split, tone: "bg-violet-500/10 text-violet-700", label: "New lot" },
  sold: { icon: ShoppingBag, tone: "bg-success/10 text-success", label: "Sold" },
  unsold: { icon: Undo2, tone: "bg-amber-500/10 text-amber-800", label: "Sale cancelled" },
  returned: { icon: RotateCcw, tone: "bg-amber-500/10 text-amber-800", label: "Came back" },
  returnCancelled: { icon: CircleX, tone: "bg-destructive/10 text-destructive", label: "Return cancelled" },
  cost: { icon: Lock, tone: "bg-secondary text-muted-foreground", label: "Cost" },
};

const when = (iso: string) => `${fmtDate(iso)}, ${new Date(iso).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" })}`;

/** One label + value in a facts grid. */
function Fact({ label, children, className = "" }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className={`min-w-0 ${className}`}>
      <dt className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 text-sm font-medium text-brand-dark break-words">{children}</dd>
    </div>
  );
}

const stockPill = (q: number, big = false) => (
  <span className={`inline-flex items-center font-semibold rounded-full whitespace-nowrap ${big ? "text-[11px] px-2.5 py-1" : "text-xs px-2 py-0.5"} ${q > 0 ? "bg-success/10 text-success" : "bg-destructive/10 text-destructive"}`}>
    {q > 0 ? `In stock · ${q}` : "Sold out"}
  </span>
);

/**
 * A Ready Stock piece's own page — like a shop's product page: its photos and
 * video, every detail, the actions on it, and (for staff) its whole story:
 * who added it, each change, the orders it was sold on, what came back, and
 * the same piece's lots at other offices. A client sees the shop view only —
 * no cost, notes, history or actions — as on the Ready Stock list.
 */
export function ReadyStockDetailPage() {
  const { id } = useParams();
  const db = useDb();
  const { user } = useAuth();
  const multiCo = useMultiCo();
  const item = db.readyStock.find(i => i.id === id);
  // A client sees the Ready Stock of the company they buy from — as on the list.
  const clientCo = user?.role === "client" && multiCo ? companyIdOfClient(db.clients.find(c => c.id === user.clientId)) : null;
  if (!item || (clientCo && companyOf(item) !== clientCo)) {
    return (
      <div className="text-center py-20 text-muted-foreground">
        {collectionLoaded("readyStock") ? "This piece is not in Ready Stock any more." : "Loading…"}{" "}
        <Link to="/ready-stock" className="text-primary underline">Back to Ready Stock</Link>
      </div>
    );
  }
  // Keyed by the piece, so going to another lot starts afresh.
  return <PieceBody key={item.id} item={item} />;
}

function PieceBody({ item }: { item: ReadyStockItem }) {
  const db = useDb();
  const { user } = useAuth();
  const can = useCan();
  const mayExport = useMayExport();
  const multiCo = useMultiCo();
  const nav = useNavigate();
  const isAdmin = user?.role === "admin"; // cost + profit/loss are admin-only
  const canManage = isAdmin || user?.role === "employee"; // clients get the shop view
  const canEdit = canManage && can("readyStock", "edit");
  const [editing, setEditing] = useState(false);
  const [moving, setMoving] = useState(false);
  const [bandOpen, setBandOpen] = useState(false);
  const [tab, setTab] = useState<"history" | "sales" | "lots">("history");
  const [shown, setShown] = useState(0);

  const office = officeOf(item);
  const cost = isAdmin ? stockCostOf(db, item) : undefined;
  const profit = cost != null ? item.price - cost : undefined;
  const nameOfUser = (id?: string) => (id ? db.users.find(u => u.id === id)?.name : undefined);

  // ── Media: the photos, then the video ──
  const media = [
    ...(item.images ?? []).map(src => ({ kind: "image" as const, src })),
    ...(item.video ? [{ kind: "video" as const, src: item.video }] : []),
  ];
  // An edit can take photos away — stay on one that is still there.
  const at = Math.max(0, Math.min(shown, media.length - 1));
  const cur = media[at];

  // ── Orders: an employee whose work doesn't take in an order sees that it was sold, not to whom ──
  const mine = (o: Order) => !!user && (isAdmin || worksOnOrder(db, user, o));
  const clientName = (o: Order) => (mine(o) ? db.clients.find(c => c.id === o.clientId)?.companyName : undefined);
  const sales = canManage
    ? db.orders.filter(o => o.materialSourcing === "readyStock" && o.readyStockItemId === item.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    : [];
  const lots = otherLots(db.readyStock, item)
    .filter(l => canManage || l.quantity > 0)
    .sort((a, b) => officeRank(db.settings, officeOf(a)) - officeRank(db.settings, officeOf(b)) || officeOf(a).localeCompare(officeOf(b)));
  const familyPieces = [item, ...lots].reduce((s, l) => s + Math.max(0, l.quantity), 0);

  // Newest first; a cost line only for the admin (it never holds the figure anyway).
  const timeline = canManage ? pieceTimeline(db, item).filter(e => isAdmin || e.kind !== "cost").reverse() : [];

  // ── Actions — the same checks and confirms as on the Ready Stock list ──
  const adjustQty = (delta: number) => updateDb(d => stepQty(d, item.id, delta, whoOf(user)));
  // A lot an order, a return or a build points at is never deleted — it is
  // emptied instead (lib/readyStockGuards.ts). Checked again as it runs.
  const del = async () => {
    const why = readyStockDeleteBlocker(loadDb(), item);
    if (why) { toast.error(why); return; }
    const worth = item.quantity > 0 && item.price > 0 ? ` — worth ${fmtMoney(item.price * item.quantity)}` : "";
    if (!(await confirmBox(`Delete "${item.name}" from Ready Stock?\n\n${item.quantity > 0 ? `${item.quantity} piece${item.quantity !== 1 ? "s" : ""} at the ${officeLabel(office)}${worth} come off the shelf` : "The sold-out lot is removed"}, with its photos and its history. This cannot be undone.`))) return;
    updateDb(d => { d.readyStock = d.readyStock.filter(x => x.id !== item.id); });
    toast.success("Deleted");
    nav("/ready-stock");
  };
  // Selling makes an order, so it asks what New Order asks.
  const mayOrder = isAdmin || (user?.role === "employee" && can("orders", "add"));
  const sellHref = `/orders/new?readyStock=${encodeURIComponent(item.id)}`;
  const editWhy = canEdit ? undefined : needsAccess("readyStock", "edit");
  const delWhy = !can("readyStock", "delete") ? needsAccess("readyStock", "delete") : readyStockDeleteBlocker(db, item);
  // Every action is listed; one this person or this piece can't take is greyed with why.
  const actions: MoreAction[] = [
    // Edit is the button beside this menu; without the access it shows here, greyed.
    { label: "Edit", icon: Pencil, hint: editWhy, disabled: true, onSelect: () => undefined, show: !canEdit },
    { label: "Move to another office", icon: ArrowRightLeft, hint: editWhy ?? (item.quantity > 0 ? `Now at the ${officeLabel(office)}` : "Sold out — nothing to move"),
      disabled: !canEdit || item.quantity <= 0, onSelect: () => setMoving(true) },
    { label: "Print band", icon: Tag, hint: mayExport ? undefined : needsAccess("readyStock", "export"), disabled: !mayExport, onSelect: () => setBandOpen(true), show: db.settings.barcodeBandEnabled !== false },
    { label: "Sell this piece", icon: ShoppingBag, hint: !mayOrder ? needsAccess("orders", "add") : item.quantity > 0 ? "A new order with this piece" : "Sold out — nothing left to sell",
      disabled: !mayOrder || item.quantity <= 0, onSelect: () => nav(sellHref) },
    { label: "Delete", icon: Trash2, danger: true, hint: delWhy, disabled: !!delWhy, onSelect: del },
  ];

  const stepper = (
    <div className="flex items-center gap-1.5">
      <button onClick={() => adjustQty(-1)} disabled={item.quantity === 0} aria-label="One less" className="h-8 w-8 rounded-lg border border-border bg-white grid place-items-center hover:bg-secondary disabled:opacity-30 transition-colors"><Minus className="h-3.5 w-3.5" /></button>
      <span className="text-base font-semibold w-8 text-center tabular-nums">{item.quantity}</span>
      <button onClick={() => adjustQty(1)} aria-label="One more" className="h-8 w-8 rounded-lg border border-border bg-white grid place-items-center hover:bg-secondary transition-colors"><Plus className="h-3.5 w-3.5" /></button>
    </div>
  );

  /** The order or lot a history line is about, as links. */
  const refOf = (e: TimelineEntry) => {
    const o = e.ref?.orderId ? db.orders.find(x => x.id === e.ref!.orderId) : undefined;
    const lot = e.ref?.itemId ? db.readyStock.find(x => x.id === e.ref!.itemId) : undefined;
    if (!o && !lot) return null;
    const client = o ? clientName(o) : undefined;
    return (
      <div className="flex flex-wrap items-center gap-1.5 mt-1">
        {o && (mine(o)
          ? <Link to={`/orders/${o.id}`} className="text-xs font-semibold text-primary hover:underline">{o.orderNumber}</Link>
          : <span className="text-xs font-semibold text-brand-dark">{o.orderNumber}</span>)}
        {client && <span className="text-xs text-muted-foreground">· {client}</span>}
        {o?.status === "Rejected" && e.kind === "sold" && <CellTag tone="red">Cancelled since</CellTag>}
        {lot && <Link to={`/ready-stock/${lot.id}`} className="text-xs font-semibold text-primary hover:underline">{officeLabel(officeOf(lot))} lot</Link>}
      </div>
    );
  };

  const salesCols: DataColumn<Order>[] = [
    { key: "order", header: "Order", always: true, sortValue: o => o.orderNumber,
      cell: o => <CellMain title={o.orderNumber} sub={o.returns?.length ? `${o.returns.reduce((s, r) => s + r.qty, 0)} came back` : undefined} /> },
    { key: "client", header: "Client", sortValue: o => clientName(o) ?? null,
      cell: o => clientName(o) ? <span className="whitespace-nowrap">{clientName(o)}</span> : <span className="text-muted-foreground/50">—</span> },
    { key: "qty", header: "Qty", align: "center", kind: "number", sortValue: o => o.quantity, cell: o => <span className="tabular-nums">{o.quantity}</span> },
    { key: "date", header: "Date", kind: "date", sortValue: o => o.createdAt, cell: o => <CellDate>{fmtDate(o.createdAt)}</CellDate> },
    { key: "status", header: "Status", sortValue: o => o.status, cell: o => <StatusBadge status={o.status} /> },
    { key: "amount", header: "Amount", align: "right", kind: "number", sortValue: o => (o.returns?.length ? keptValue(o) : o.amount),
      cell: o => (
        <span className="whitespace-nowrap">
          {!!o.returns?.length && <span className="text-[11px] tabular-nums text-muted-foreground line-through mr-1.5">{fmtMoney(o.amount)}</span>}
          <CellAmount>{fmtMoney(o.returns?.length ? keptValue(o) : o.amount)}</CellAmount>
        </span>
      ) },
  ];

  const lotCols: DataColumn<ReadyStockItem>[] = [
    { key: "lot", header: "Lot", always: true, sortValue: l => l.name,
      cell: l => (
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="h-10 w-10 rounded-lg bg-white ring-1 ring-border/60 overflow-hidden grid place-items-center shrink-0">
            {l.images?.[0] ? <img src={l.images[0]} alt="" loading="lazy" className="w-full h-full object-contain" /> : <Gem className="h-4 w-4 text-muted-foreground/40" />}
          </div>
          <CellMain title={l.name} sub={`ID ${l.id.slice(-6).toUpperCase()} · ${l.splitFrom ? "split off" : "the first lot"}`} />
        </div>
      ) },
    { key: "office", header: "Office", sortValue: l => `${String(officeRank(db.settings, officeOf(l))).padStart(5, "0")} ${officeOf(l)}`, cell: l => <OfficeChip office={officeOf(l)} /> },
    { key: "qty", header: "In stock", align: "center", kind: "number", sortValue: l => l.quantity, cell: l => stockPill(l.quantity) },
    { key: "price", header: "Price", align: "right", kind: "number", sortValue: l => l.price, cell: l => <CellAmount>{fmtMoney(l.price)}</CellAmount> },
  ];

  const tabs = [
    { key: "history" as const, label: "History", icon: History, n: timeline.length },
    { key: "sales" as const, label: "Sales", icon: ShoppingBag, n: sales.length },
    { key: "lots" as const, label: "Other lots", icon: Split, n: lots.length },
  ];

  return (
    <div className="max-w-6xl mx-auto space-y-5 min-w-0">
      {/* ── Header: what it is, where it is, what can be done. The ⋯ is named
          for the piece, as on its card in the list. ── */}
      <PageHeader
        back={{ label: "Back to Ready Stock", to: "/ready-stock" }}
        title={item.name}
        primary={canManage
          ? (canEdit ? { label: "Edit", icon: Pencil, onClick: () => setEditing(true) } : null)
          : (item.quantity > 0 ? { label: "Order this piece", icon: ShoppingBag, onClick: () => nav(sellHref) } : null)}
        menu={canManage ? actions : undefined}
        menuLabel={`Actions for ${item.name}`}
      >
        <div className="flex flex-wrap items-center gap-1.5 mt-2">
          {stockPill(item.quantity, true)}
          <OfficeChip office={office} />
          {canManage && <CompanyBadge id={companyOf(item)} />}
          {canManage && item.fromReturn && <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-800">Returned by a client</span>}
        </div>
      </PageHeader>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] items-start">
        {/* ── Gallery ── */}
        <div className="space-y-3 min-w-0">
          {/* No photo yet: a small tile, so the price is not pushed off the screen. */}
          <div className={`relative w-full rounded-2xl bg-white ring-1 ring-border/60 overflow-hidden grid place-items-center shadow-soft ${cur ? "aspect-square" : "h-32 sm:h-40"}`}>
            {!cur ? (
              <div className="w-full h-full grid place-items-center bg-secondary/50 text-muted-foreground/40"><Gem className="h-10 w-10" /></div>
            ) : cur.kind === "video" ? (
              <video key={cur.src} src={cur.src} controls playsInline preload="metadata" className="w-full h-full object-contain bg-black" />
            ) : (
              <>
                <img src={cur.src} alt={item.name} className="w-full h-full object-contain p-2 sm:p-4" />
                <a href={cur.src} target="_blank" rel="noopener noreferrer" title="Open full size" aria-label="Open full size"
                  className="absolute bottom-3 right-3 h-8 w-8 rounded-full bg-white/90 ring-1 ring-border/60 text-brand-dark grid place-items-center hover:bg-white shadow-soft">
                  <Maximize2 className="h-3.5 w-3.5" />
                </a>
              </>
            )}
            {item.quantity === 0 && <span className="absolute top-3 left-3 rounded-full bg-black/70 text-white text-[11px] font-semibold tracking-wide px-2.5 py-1">SOLD OUT</span>}
            {media.length > 1 && <span className="absolute top-3 right-3 rounded-full bg-black/50 text-white text-[11px] tabular-nums px-2 py-0.5">{at + 1} / {media.length}</span>}
          </div>
          {media.length > 1 && (
            <div className="flex gap-2 overflow-x-auto no-scrollbar pb-1">
              {media.map((m, i) => (
                <button key={`${m.kind}-${i}`} type="button" onClick={() => setShown(i)} aria-label={m.kind === "video" ? "Show the video" : `Show photo ${i + 1}`} aria-pressed={i === at}
                  className={`relative h-16 w-16 sm:h-20 sm:w-20 shrink-0 rounded-xl overflow-hidden bg-white grid place-items-center transition-shadow ${i === at ? "ring-2 ring-primary" : "ring-1 ring-border/60 hover:ring-primary/50"}`}>
                  {m.kind === "image"
                    ? <img src={m.src} alt="" loading="lazy" className="w-full h-full object-contain" />
                    : <span className="w-full h-full bg-black/80 text-white grid place-items-center"><Play className="h-5 w-5 fill-current" /></span>}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* ── Facts ── */}
        <div className="space-y-4 min-w-0">
          <div className="card-luxe p-4 sm:p-5">
            <p className="text-[11px] uppercase tracking-wider text-muted-foreground">Price</p>
            <p className="font-display text-3xl sm:text-4xl font-bold text-brand-dark leading-tight">{fmtMoney(item.price)}</p>
            {canManage && !(item.price > 0) && <p className="text-xs text-amber-700 mt-1">No selling price yet{canEdit ? " — Edit to set it" : ""}.</p>}

            <div className="mt-4 flex items-center justify-between gap-3 rounded-xl bg-secondary/40 px-3 py-2.5">
              <div className="min-w-0">
                <p className="text-[11px] uppercase tracking-wider text-muted-foreground">Quantity</p>
                <p className="text-sm font-semibold text-brand-dark">
                  {item.quantity > 0 ? `${item.quantity} piece${item.quantity !== 1 ? "s" : ""} in stock` : "Sold out"}
                  {canManage && item.quantity > 1 && item.price > 0 && <span className="font-normal text-muted-foreground"> · worth {fmtMoney(item.price * item.quantity)}</span>}
                </p>
              </div>
              {canEdit ? stepper : stockPill(item.quantity)}
            </div>

            {isAdmin && (
              <div className="mt-3 grid grid-cols-2 gap-3">
                <div className="rounded-xl border border-border/60 px-3 py-2.5">
                  <p className="text-[11px] uppercase tracking-wider text-muted-foreground flex items-center gap-1"><Lock className="h-3 w-3" />Cost</p>
                  <p className="text-sm font-semibold text-brand-dark tabular-nums">{cost != null ? fmtMoney(cost) : <span className="font-normal text-muted-foreground">Not recorded</span>}</p>
                </div>
                <div className="rounded-xl border border-border/60 px-3 py-2.5">
                  <p className="text-[11px] uppercase tracking-wider text-muted-foreground">{profit == null || profit >= 0 ? "Profit" : "Loss"} per piece</p>
                  <p className={`text-sm font-semibold tabular-nums ${profit == null ? "text-muted-foreground font-normal" : profit >= 0 ? "text-success" : "text-destructive"}`}>
                    {profit == null ? "—" : `${profit >= 0 ? "+" : "−"}${fmtMoney(Math.abs(profit))}`}
                  </p>
                </div>
              </div>
            )}

            <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3">
              <Fact label="Office"><OfficeChip office={office} /></Fact>
              {canManage && multiCo && <Fact label="Company"><CompanyBadge id={companyOf(item)} /></Fact>}
              <Fact label="SKU / Design #">{item.sku ? <span className="font-mono">{item.sku}</span> : <span className="text-muted-foreground/60 font-normal">—</span>}</Fact>
              <Fact label="Product ID"><span className="font-mono">{item.id.slice(-6).toUpperCase()}</span></Fact>
              {canManage && <Fact label="Added">{fmtDate(item.createdAt)}{nameOfUser(item.createdBy) ? <span className="font-normal text-muted-foreground"> · {nameOfUser(item.createdBy)}</span> : null}</Fact>}
            </dl>
          </div>

          <div className="card-luxe p-4 sm:p-5">
            <SectionTitle title="Specifications" />
            <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3">
              <Fact label="Type">{item.jewelleryType}</Fact>
              <Fact label="Metal">{metalLabel(item.metal)}</Fact>
              {item.productKarats && <Fact label="Karat">{item.productKarats}</Fact>}
              <Fact label="Gross weight">{item.grossWeight ? `${item.grossWeight} g` : <span className="text-muted-foreground/60 font-normal">—</span>}</Fact>
              <Fact label="Net weight">{item.netWeight ? `${item.netWeight} g` : <span className="text-muted-foreground/60 font-normal">—</span>}</Fact>
              <Fact label="Diamond">{item.diamondWeight ? `${item.diamondWeight} ct${item.diamondType ? ` · ${item.diamondType}` : ""}` : <span className="text-muted-foreground/60 font-normal">None</span>}</Fact>
            </dl>
          </div>

          {/* Notes can name the client a piece came back from — staff only, as on the list. */}
          {canManage && item.notes && (
            <div className="card-luxe p-4 sm:p-5">
              <SectionTitle title="Notes" />
              <p className="mt-2 text-sm text-foreground/80 whitespace-pre-wrap break-words">{item.notes}</p>
            </div>
          )}

          {/* A client: where else the same piece can be had. */}
          {!canManage && lots.length > 0 && (
            <div className="card-luxe p-4 sm:p-5">
              <SectionTitle title="Also at" />
              <div className="mt-2 flex flex-wrap gap-2">
                {lots.map(l => (
                  <Link key={l.id} to={`/ready-stock/${l.id}`} className="inline-flex items-center gap-2 rounded-xl border border-border/60 px-3 py-2 text-sm hover:bg-secondary/50">
                    <OfficeChip office={officeOf(l)} />{stockPill(l.quantity)}
                  </Link>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── History, sales, other lots — staff only ── */}
      {canManage && (
        <div className="space-y-3 min-w-0">
          <TabBar label="About this piece" tabs={tabs.map(t => ({ key: t.key, label: t.label, icon: t.icon, count: t.n }))} value={tab} onChange={setTab} />
          <div role="tabpanel" className="card-luxe p-3 sm:p-4 min-w-0">
            {tab === "history" && (
              timeline.length ? (
                <ol className="px-1 sm:px-2">
                  {timeline.map((e, i) => {
                    const k = KIND[e.kind] ?? KIND.edited;
                    const who = nameOfUser(e.by) || e.byName;
                    return (
                      <li key={`${e.at}-${i}`} className="relative flex gap-3 pb-5 last:pb-0">
                        {/* The line joining one event to the next. */}
                        {i < timeline.length - 1 && <span aria-hidden className="absolute left-4 top-9 bottom-0 w-px -translate-x-1/2 bg-border" />}
                        <span className={`relative h-8 w-8 shrink-0 rounded-full grid place-items-center ${k.tone}`}><k.icon className="h-4 w-4" /></span>
                        <div className="min-w-0 flex-1 pt-0.5">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{k.label}</span>
                            {e.kind === "cost" && <CellTag>Admin only</CellTag>}
                          </div>
                          <p className="text-sm text-brand-dark break-words">{e.text}</p>
                          {refOf(e)}
                          <p className="text-[11px] text-muted-foreground mt-0.5">{who ? `${who} · ` : ""}{when(e.at)}</p>
                        </div>
                      </li>
                    );
                  })}
                </ol>
              ) : <p className="py-10 text-center text-sm text-muted-foreground">Nothing recorded for this piece yet.</p>
            )}

            {tab === "sales" && (
              <DataTable
                id="ready-stock-sales"
                controls="none"
                noun="sale"
                rows={sales}
                columns={salesCols}
                rowKey={o => o.id}
                rowHref={o => `/orders/${o.id}`}
                canClickRow={mine}
                defaultSort={{ key: "date", dir: "desc" }}
                emptyText="Not sold on any order yet."
              />
            )}

            {tab === "lots" && (
              <div className="space-y-2">
                {lots.length > 0 && <p className="text-xs text-muted-foreground px-1"><span className="font-semibold text-brand-dark">{familyPieces} piece{familyPieces !== 1 ? "s" : ""}</span> in all offices · {item.quantity} here</p>}
                <DataTable
                  id="ready-stock-lots"
                  controls="none"
                  noun="lot"
                  rows={lots}
                  columns={lotCols}
                  rowKey={l => l.id}
                  rowHref={l => `/ready-stock/${l.id}`}
                  emptyText="All in one place."
                />
              </div>
            )}
          </div>
        </div>
      )}

      {editing && <ReadyStockItemDialog item={item} onClose={() => setEditing(false)} />}
      {moving && <MoveOfficeDialog items={[item]} onClose={() => setMoving(false)} />}
      <BandDialog
        open={bandOpen}
        onOpenChange={setBandOpen}
        presets={labelPresets(db.settings)}
        showPrice={db.settings.barcodeBandShowPrice !== false}
        onGenerate={(preset, mode, copies) => generateStockBand(item, db.settings, { style: preset.style, width: preset.widthMm, height: preset.heightMm, mode, copies })}
      />
    </div>
  );
}
