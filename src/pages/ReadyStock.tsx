import { DataTable, CellTag, CellAmount, CellDate, type DataColumn } from "@/components/DataTable";
import { WebVideo } from "@/components/ProductVideo";
import { metalLabel } from "@/lib/metals";
import { useCan, useMayExport } from "@/hooks/useCan";
import { Fragment, useState, type MouseEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { loadDb, updateDb, fmtDate, fmtMoney, stockCostOf, worksOnOrder, type Order, type ReadyStockItem } from "@/lib/db";
import { readyStockDeleteBlocker } from "@/lib/readyStockGuards";
import { needsAccess } from "@/lib/actionHints";
import { filled, when, userName, refLink, linkList, noteText, type Detail } from "@/components/rowDetails";
import { useDb } from "@/hooks/useDb";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { usePagination } from "@/hooks/usePagination";
import { PaginationBar } from "@/components/PaginationBar";
import { Plus, Search, Trash2, Gem, X, Minus, Pencil, MapPin, Tag, Play, FileText, FileSpreadsheet, Check, ArrowRightLeft, Building2, Eye, Wallet, Lock, PackageX, Share2 } from "lucide-react";
import { ShareProductsSheet } from "@/components/ShareProductsSheet";
import { exportReadyStockCsv } from "@/lib/productExport";
import { downloadStockListPdf } from "@/lib/piecesPdf";
import { shareBrand } from "@/lib/readyStockShare";
import { BandDialog } from "@/components/BandDialog";
import { generateStockBand, labelPresets } from "@/lib/band";
import { toast } from "sonner";
import { confirmBox } from "@/lib/confirm";
import { ReturnsComingPanel } from "@/components/SalesReturn";
import { CompanyBadge, useMultiCo, useDefaultCompany } from "@/components/CompanyFields";
import { companiesOf, companyOf, companyIdOfClient } from "@/lib/companies";
import { MoreMenu, type MoreAction } from "@/components/MoreMenu";
import { PageHeader, TabBar, ViewSwitch } from "@/components/PageHeader";
import { ExportMenu, FilterChips, FiltersButton, StatStrip, type TableExport, type TableFilter } from "@/components/TableToolbar";
import { MoveOfficeDialog, OfficesDialog, OfficeChip } from "@/components/ReadyStockOffices";
import { ReadyStockItemDialog } from "@/components/ReadyStockItemDialog";
import { officeLabel, officeOf, officeRank, officeTabs, otherLots, readyStockOffices } from "@/lib/offices";
import { pieceTimeline, stepQty, whoOf } from "@/lib/readyStockHistory";

const PAGE_SIZE = 24;
/** The office tab for pieces that were never given one. */
const NO_OFFICE = "__none";

/** A tick-box riding on top of a card, which must not trigger the card itself. */
function SelectBox({ checked, onToggle, className = "" }: { checked: boolean; onToggle: () => void; className?: string }) {
  return (
    <button
      type="button"
      aria-pressed={checked}
      aria-label={checked ? "Deselect this piece" : "Select this piece"}
      onClick={e => { e.preventDefault(); e.stopPropagation(); onToggle(); }}
      className={`z-30 h-6 w-6 shrink-0 grid place-items-center rounded-md border shadow-soft transition-colors ${checked ? "bg-primary border-primary text-white" : "bg-white/90 border-border text-transparent hover:border-primary"} ${className}`}
    >
      <Check className="h-4 w-4" />
    </button>
  );
}

/** A click inside a card that does its own thing — the tick box, ⋯, stepper, video, a link. */
const OWN_CLICK = "button,a,input,select,textarea,label,[role=menuitem],[data-no-row]";

export function ReadyStockPage() {
  const { user } = useAuth();
  const nav = useNavigate();
  const isAdmin = user?.role === "admin"; // cost + profit/loss are admin-only
  const canManage = user?.role === "admin" || user?.role === "employee"; // clients get a read-only shop view
  const can = useCan();
  const mayExport = useMayExport();
  const db = useDb();
  const [q, setQ] = useState("");
  const [avail, setAvail] = useState<"all" | "available" | "sold">("all"); // stock availability filter
  // Each company has its own Ready Stock. Staff choose whose; a client sees the
  // company they buy from.
  const multiCo = useMultiCo();
  const defaultCompany = useDefaultCompany();
  const [coSel, setCoSel] = useState("all");
  const coView = !multiCo ? "all" : user?.role === "client" ? companyIdOfClient(db.clients.find(c => c.id === user.clientId)) : coSel;
  const [bandItem, setBandItem] = useState<ReadyStockItem | null>(null); // item whose barcode band modal is open
  // Pieces being shared with a client (a PDF or a link).
  const [sharing, setSharing] = useState<ReadyStockItem[] | null>(null);
  const [view, setView] = useState<"list" | "grid">(() => {
    try { return (localStorage.getItem("readystock-view") as "list" | "grid") || "grid"; } catch { return "grid"; }
  });
  const saveView = (v: "list" | "grid") => { setView(v); try { localStorage.setItem("readystock-view", v); } catch { /* ignore */ } };
  // The office being looked at — remembered, as each office mostly works its own shelf.
  const [office, setOfficeState] = useState<string>(() => {
    try { return localStorage.getItem("readystock-office") || "all"; } catch { return "all"; }
  });
  const [moving, setMoving] = useState<ReadyStockItem[] | null>(null);
  const [officesOpen, setOfficesOpen] = useState(false);

  // This company's shelf; then the office tab, the search and availability.
  const shelf = db.readyStock.filter(i => coView === "all" || companyOf(i) === coView);
  const tabs = officeTabs(db.settings, shelf).filter(t => canManage || t.items > 0);
  const tabKey = (o: string) => o || NO_OFFICE;
  // A remembered office that has since gone (or holds nothing for a client) falls back to all.
  const officeSel = office === "all" || tabs.some(t => tabKey(t.office) === office) ? office : "all";
  const setOffice = (o: string) => {
    setOfficeState(o); setPage(1);
    try { localStorage.setItem("readystock-office", o); } catch { /* ignore */ }
  };
  const inOffice = (i: ReadyStockItem) => officeSel === "all" || tabKey(officeOf(i)) === officeSel;

  // Commas separate alternatives — a few SKUs read off a list can be pasted in
  // as written and the sheet drawn from exactly those pieces.
  const terms = q.split(",").map(t => t.trim().toLowerCase()).filter(Boolean);
  const items = shelf
    .filter(inOffice)
    .filter(i => !terms.length || terms.some(t =>
      i.name.toLowerCase().includes(t) || (i.sku || "").toLowerCase().includes(t)))
    .filter(i => avail === "all" ? true : avail === "available" ? i.quantity > 0 : i.quantity === 0)
    // Office by office (in the admin's order), newest first within each.
    .sort((a, b) => officeRank(db.settings, officeOf(a)) - officeRank(db.settings, officeOf(b))
      || officeOf(a).localeCompare(officeOf(b))
      || +new Date(b.createdAt) - +new Date(a.createdAt));
  const { paged, page, setPage, totalPages, total, start, end } = usePagination(items, PAGE_SIZE);

  // What the office (or all of them) holds: pieces in stock, and what they are worth.
  const scope = shelf.filter(inOffice);
  const inStock = scope.filter(i => i.quantity > 0);
  const piecesInStock = inStock.reduce((s, i) => s + i.quantity, 0);
  const worth = inStock.reduce((s, i) => s + i.price * i.quantity, 0);
  const costed = isAdmin ? inStock.filter(i => stockCostOf(db, i) != null) : [];
  const costWorth = costed.reduce((s, i) => s + stockCostOf(db, i)! * i.quantity, 0);
  const soldOut = scope.filter(i => i.quantity === 0).length;

  /**
   * The shelf, as a sheet. A sale is rarely a whole filter, so pieces can be
   * ticked one by one: tick any and the download narrows to those; tick none
   * and it is whatever the search and the availability filter left on screen.
   * Only what is still visible counts, so narrowing the filters after ticking
   * drops the hidden pieces rather than letting them ride along unseen.
   */
  const [sel, setSel] = useState<Set<string>>(new Set());
  const toggleSel = (id: string) => setSel(prev => {
    const next = new Set(prev);
    if (!next.delete(id)) next.add(id);
    return next;
  });
  const chosen = items.filter(i => sel.has(i.id));
  const exportItems = chosen.length ? chosen : items;
  const allShown = items.length > 0 && items.every(i => sel.has(i.id));

  const officeName = officeSel === "all" ? "" : officeLabel(officeSel === NO_OFFICE ? "" : officeSel);
  const exportName = () => chosen.length
    ? `Ready_Stock-Selected-${chosen.length}`
    : `Ready_Stock${officeName ? `-${officeName.replace(/\s+/g, "_")}` : ""}${avail === "all" ? "" : `-${avail}`}`;
  const exportSubject = () => (chosen.length
    ? [`${chosen.length} selected piece${chosen.length !== 1 ? "s" : ""}`]
    : [
        officeName,
        avail === "all" ? "All items" : avail === "available" ? "Available only" : "Sold out only",
        q.trim() ? `Search: "${q.trim()}"` : "",
      ]).filter(Boolean).join(" · ");

  // ── Add / Edit dialog (shared with the piece's own page) ──
  const [dlg, setDlg] = useState<{ item?: ReadyStockItem; defaults?: { location: string; companyId: string } } | null>(null);
  const [videoView, setVideoView] = useState<string | null>(null); // URL open in the viewer modal
  const offices = readyStockOffices(db.settings);

  const openAdd = () => {
    // Added where it is being looked at: the office tab, else the first office.
    const here = officeSel !== "all" && officeSel !== NO_OFFICE ? officeSel : offices[0] ?? "";
    setDlg({ defaults: { location: here, companyId: coSel !== "all" ? coSel : defaultCompany } });
  };
  const openEdit = (item: ReadyStockItem) => setDlg({ item });

  // The − / + stepper — each change goes on the piece's history.
  const adjustQty = (item: ReadyStockItem, delta: number) => {
    updateDb(d => stepQty(d, item.id, delta, whoOf(user)));
  };

  /** A click on a grid card opens the piece's own page; Ctrl/⌘-click, in a new tab. */
  const pieceHref = (item: ReadyStockItem) => `/ready-stock/${item.id}`;
  const openCard = (item: ReadyStockItem) => (e: MouseEvent<HTMLDivElement>) => {
    // The ⋯ menu is drawn outside the card but its clicks still bubble here — ignore those,
    // and anything inside the card that does its own thing.
    if (!e.currentTarget.contains(e.target as Node) || (e.target as HTMLElement).closest(OWN_CLICK)) return;
    if (e.ctrlKey || e.metaKey) window.open(pieceHref(item), "_blank", "noopener");
    else nav(pieceHref(item));
  };

  // A lot an order, a return or a build points at is never deleted — it is
  // emptied instead (lib/readyStockGuards.ts). Checked again as it runs.
  const del = async (item: ReadyStockItem) => {
    const why = readyStockDeleteBlocker(loadDb(), item);
    if (why) { toast.error(why); return; }
    const worth = item.quantity > 0 && item.price > 0 ? ` — worth ${fmtMoney(item.price * item.quantity)}` : "";
    if (!(await confirmBox(`Delete "${item.name}" from Ready Stock?\n\n${item.quantity > 0 ? `${item.quantity} piece${item.quantity !== 1 ? "s" : ""} at the ${officeLabel(officeOf(item))}${worth} come off the shelf` : "The sold-out lot is removed"}, with its photos and its history. This cannot be undone.`))) return;
    updateDb(d => { d.readyStock = d.readyStock.filter(x => x.id !== item.id); });
    toast.success("Deleted");
  };

  // Every action is listed; one this person or this piece can't take is greyed with why.
  const itemActions = (item: ReadyStockItem): MoreAction[] => {
    const editWhy = can("readyStock", "edit") ? undefined : needsAccess("readyStock", "edit");
    const delWhy = !can("readyStock", "delete") ? needsAccess("readyStock", "delete") : readyStockDeleteBlocker(db, item);
    return [
      { label: "View", icon: Eye, onSelect: () => nav(pieceHref(item)) },
      { label: "Edit", icon: Pencil, hint: editWhy, disabled: !!editWhy, onSelect: () => openEdit(item) },
      { label: "Move to another office", icon: ArrowRightLeft, hint: editWhy ?? (item.quantity > 0 ? `Now at the ${officeLabel(officeOf(item))}` : "Sold out — nothing to move"),
        disabled: !!editWhy || item.quantity <= 0, onSelect: () => setMoving([item]) },
      { label: "Share / PDF", icon: Share2, hint: mayExport ? "Photos, CAD, gold, diamonds, price" : needsAccess("readyStock", "export"), disabled: !mayExport, onSelect: () => setSharing([item]) },
      { label: "Print band", icon: Tag, hint: mayExport ? undefined : needsAccess("readyStock", "export"), disabled: !mayExport, onSelect: () => setBandItem(item), show: db.settings.barcodeBandEnabled !== false },
      { label: "Delete", icon: Trash2, danger: true, hint: delWhy, disabled: !!delWhy, onSelect: () => del(item) },
    ];
  };

  const costOf = (i: ReadyStockItem) => (isAdmin ? stockCostOf(db, i) : undefined);
  const listColumns: DataColumn<ReadyStockItem>[] = [
    { key: "piece", header: "Piece", always: true, sortValue: i => i.name,
      cell: item => (
        <div className="flex items-center gap-3 min-w-0">
          <div className="h-12 w-12 rounded-lg bg-white ring-1 ring-border/60 overflow-hidden shrink-0 relative grid place-items-center">
            {item.images?.[0] ? <img src={item.images[0]} alt="" loading="lazy" className="w-full h-full object-contain" /> : <Gem className="h-5 w-5 text-muted-foreground/40" />}
            {item.quantity === 0 && <div className="absolute inset-0 bg-black/50 grid place-items-center"><span className="text-white font-semibold text-[8px] tracking-wide">SOLD</span></div>}
            {item.video && item.quantity !== 0 && (
              <button onClick={() => setVideoView(item.video!)} title="Play video" className="absolute bottom-0.5 right-0.5 h-5 w-5 rounded-full bg-black/60 hover:bg-black/80 text-white grid place-items-center"><Play className="h-2.5 w-2.5 fill-current" /></button>
            )}
          </div>
          <div className="min-w-0">
            <p className="font-medium text-brand-dark leading-snug truncate max-w-[16rem]">{item.name}</p>
            <p className="text-[11px] text-muted-foreground leading-snug truncate max-w-[16rem]">
              {item.jewelleryType} · {metalLabel(item.metal)}{item.productKarats ? ` ${item.productKarats}` : ""}{item.diamondWeight ? ` · ${item.diamondWeight}ct ${item.diamondType || "diamond"}` : ""}
            </p>
            {canManage && item.fromReturn && <div className="mt-0.5"><CellTag tone="amber">Returned by a client</CellTag></div>}
          </div>
        </div>
      ) },
    { key: "office", header: "Office", sortValue: i => `${String(officeRank(db.settings, officeOf(i))).padStart(5, "0")} ${officeOf(i)}`, csv: i => officeLabel(officeOf(i)),
      cell: i => <OfficeChip office={officeOf(i)} /> },
    ...(canManage && multiCo ? [{ key: "company", header: "Company", sortValue: (i: ReadyStockItem) => companyOf(i), cell: (i: ReadyStockItem) => <CompanyBadge id={companyOf(i)} /> }] : []),
    { key: "weights", header: "Weights", sortValue: i => i.grossWeight ?? null,
      cell: i => i.grossWeight || i.netWeight ? <span className="whitespace-nowrap text-xs tabular-nums">{i.grossWeight ? `G ${i.grossWeight}g` : ""}{i.grossWeight && i.netWeight ? " · " : ""}{i.netWeight ? `N ${i.netWeight}g` : ""}</span> : <span className="text-muted-foreground/50">—</span> },
    { key: "sku", header: "Design #", sortValue: i => i.sku ?? null, cell: i => i.sku ? <span className="font-mono text-xs">{i.sku}</span> : <span className="text-muted-foreground/50">—</span> },
    { key: "id", header: "Product ID", hidden: true, sortValue: i => i.id.slice(-6).toUpperCase(), cell: i => <span className="font-mono text-xs">{i.id.slice(-6).toUpperCase()}</span> },
    { key: "qty", header: "Qty", align: "center", kind: "number", sortValue: i => i.quantity,
      cell: item => canManage && can("readyStock", "edit") ? <div className="inline-flex">{qtyStepper(item, true)}</div> : stockPill(item) },
    { key: "price", header: "Price", align: "right", kind: "number", sortValue: i => i.price, cell: i => <CellAmount>{fmtMoney(i.price)}</CellAmount> },
    ...(isAdmin ? [
      { key: "cost", header: "Cost", align: "right" as const, kind: "number" as const, sortValue: (i: ReadyStockItem) => costOf(i) ?? null,
        cell: (i: ReadyStockItem) => costOf(i) != null ? <span className="tabular-nums whitespace-nowrap text-muted-foreground">{fmtMoney(costOf(i)!)}</span> : <span className="text-muted-foreground/50">—</span> },
      { key: "profit", header: "Profit", align: "right" as const, kind: "number" as const, sortValue: (i: ReadyStockItem) => costOf(i) != null ? i.price - costOf(i)! : null,
        cell: (i: ReadyStockItem) => costOf(i) != null ? <CellAmount tone={i.price - costOf(i)! >= 0 ? "in" : "out"}>{i.price - costOf(i)! >= 0 ? "+" : "−"}{fmtMoney(Math.abs(i.price - costOf(i)!))}</CellAmount> : <span className="text-muted-foreground/50">—</span> },
    ] : []),
    { key: "added", header: "Added", kind: "date", hidden: true, sortValue: i => i.createdAt, cell: i => <CellDate>{fmtDate(i.createdAt)}</CellDate> },
  ];

  // What an opened row adds — the piece page's facts. A client sees the shop
  // view only (where else it can be had); staff see who added it, where it came
  // from, what it was sold on and its last change — never a cost, as on the page.
  const mine = (o: Order) => !!user && (isAdmin || worksOnOrder(db, user, o));
  const orderRef = (o: Order) => refLink(`/orders/${o.id}`, o.orderNumber, mine(o));
  const pieceDetails = (item: ReadyStockItem): Detail[] => {
    const lots = otherLots(db.readyStock, item).filter(l => canManage || l.quantity > 0);
    const lotLinks = linkList(lots.map(l => ({ key: l.id, node: refLink(`/ready-stock/${l.id}`, `${officeLabel(officeOf(l))} · ${l.quantity > 0 ? `${l.quantity} in stock` : "sold out"}`) })));
    if (!canManage) return filled([{ label: "Also at", value: lotLinks }]);
    const fr = item.fromReturn;
    const retOrder = fr ? db.orders.find(o => o.id === fr.orderId) : undefined;
    const ret = fr ? retOrder?.returns?.find(r => r.id === fr.returnId) : undefined;
    const built = fr ? undefined : db.orders.find(o => o.readyStockCreatedId === item.id);
    const sales = db.orders.filter(o => o.materialSourcing === "readyStock" && o.readyStockItemId === item.id && !o.deletedAt)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    // A cost line is the admin's alone, as on the piece's page.
    const last = pieceTimeline(db, item).filter(e => isAdmin || e.kind !== "cost").pop();
    const lastWho = last ? userName(db, last.by) || last.byName : "";
    const addedBy = userName(db, item.createdBy);
    return filled([
      { label: "Added", value: `${when(item.createdAt)}${addedBy ? ` by ${addedBy}` : ""}` },
      item.quantity > 1 && item.price > 0 && { label: "Stock value", value: `${fmtMoney(item.price * item.quantity)} (${item.quantity} × ${fmtMoney(item.price)})` },
      !!retOrder && { label: "Came back from", value: <>{orderRef(retOrder)}{ret ? ` · credit note ${ret.creditNoteNo}` : ""}</> },
      !!built && { label: "Built on", value: orderRef(built) },
      sales.length > 0 && { label: sales.length > 1 ? `Sold on (${sales.length})` : "Sold on", value: linkList(sales.map(o => ({ key: o.id, node: orderRef(o) }))) },
      { label: "Other lots", value: lotLinks },
      !!last && { label: "Last change", value: `${last.text} — ${[lastWho, when(last.at)].filter(Boolean).join(" · ")}` },
      { label: "Notes", value: noteText(item.notes) },
    ]);
  };

  /** Office by office, when all are shown: a heading where the office changes. */
  const groupHead = (item: ReadyStockItem, idx: number) => {
    if (officeSel !== "all" || (idx > 0 && officeOf(paged[idx - 1]) === officeOf(item))) return null;
    const o = officeOf(item);
    const t = tabs.find(x => x.office === o);
    return (
      <div className="col-span-full flex items-center gap-2 pt-2 first:pt-0">
        <MapPin className={`h-4 w-4 ${o ? "text-primary" : "text-amber-600"}`} />
        <h2 className="font-display text-lg text-brand-dark">{officeLabel(o)}</h2>
        <span className="text-xs text-muted-foreground">{t?.pieces ?? 0} in stock</span>
        <button type="button" onClick={() => setOffice(tabKey(o))} className="ml-auto text-xs font-medium text-primary hover:underline">Only this office</button>
      </div>
    );
  };

  const qtyStepper = (item: ReadyStockItem, small = false) => (
    <div className={`flex items-center gap-1.5 ${small ? "justify-end mt-1" : ""}`}>
      <button onClick={() => adjustQty(item, -1)} disabled={item.quantity === 0} aria-label="One less" className={`${small ? "h-6 w-6" : "h-7 w-7"} rounded-lg border border-border grid place-items-center hover:bg-secondary disabled:opacity-30 transition-colors`}><Minus className="h-3 w-3" /></button>
      <span className="text-sm font-semibold w-6 text-center tabular-nums">{item.quantity}</span>
      <button onClick={() => adjustQty(item, 1)} aria-label="One more" className={`${small ? "h-6 w-6" : "h-7 w-7"} rounded-lg border border-border grid place-items-center hover:bg-secondary transition-colors`}><Plus className="h-3 w-3" /></button>
    </div>
  );
  const stockPill = (item: ReadyStockItem) => (
    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${item.quantity > 0 ? "bg-success/10 text-success" : "bg-destructive/10 text-destructive"}`}>
      {item.quantity > 0 ? "In stock" : "Sold out"}
    </span>
  );

  // Company and availability narrow the shelf behind one Filters button; the
  // downloads hold what is ticked, else what the filters left.
  const filters: TableFilter[] = [
    ...(canManage && multiCo ? [{ kind: "select" as const, label: "Company", value: coSel === "all" ? "" : coSel, onChange: (v: string) => { setCoSel(v || "all"); setPage(1); },
      allLabel: "All companies", options: companiesOf(db.settings).map(c => ({ value: c.id, label: c.name })) }] : []),
    { kind: "select", label: "Availability", value: avail === "all" ? "" : avail, onChange: v => { setAvail((v || "all") as "all" | "available" | "sold"); setPage(1); },
      allLabel: "All items", options: [{ value: "available", label: "Available" }, { value: "sold", label: "Sold out" }] },
  ];
  const clearFilters = () => { setCoSel("all"); setAvail("all"); setPage(1); };
  const onSearch = (v: string) => { setQ(v); setPage(1); };
  const searchHint = "Search name or SKU — SKU-1, SKU-2";
  const which = chosen.length ? `The ${chosen.length} selected` : `The ${items.length} shown`;
  const listPdf = async () => {
    const t = toast.loading(`Making the PDF — ${exportItems.length} item${exportItems.length !== 1 ? "s" : ""} with photos…`);
    try {
      const missing = await downloadStockListPdf(exportItems.map(i => ({
        photo: i.images?.[0], name: i.name, sku: i.sku, type: i.jewelleryType, metal: `${i.metal}${i.productKarats ? ` ${i.productKarats}` : ""}`,
        grossG: i.grossWeight, netG: i.netWeight, diamondCt: i.diamondWeight, qty: i.quantity, price: i.price,
      })), shareBrand(db, exportItems), { title: "Ready Stock", subject: exportSubject(), filename: exportName() });
      if (missing) toast.warning(`PDF saved — ${missing} photo${missing !== 1 ? "s" : ""} couldn't be read`, { id: t });
      else toast.success("PDF saved", { id: t });
    } catch { toast.error("Couldn't make the PDF", { id: t }); }
  };
  const exports: TableExport[] = canManage && items.length ? [
    // With a photo on every row; "Product sheets" is a page a piece, as a client gets it.
    { label: "Share — product PDF or link", icon: Share2, hint: `${which} · photos, video, details, the price you set`, onSelect: () => setSharing(exportItems) },
    { label: "Stock list — PDF", icon: FileText, hint: `${which} · with photos, quantities and totals`, onSelect: () => void listPdf() },
    { label: "Excel", icon: FileSpreadsheet, hint: which, onSelect: () => exportReadyStockCsv(exportItems, exportName(), isAdmin, i => stockCostOf(db, i)) },
  ] : [];
  // Lots on the shelf ("items", as the pages count them) — the pieces in them are the figures below.
  const countText = `${total} item${total !== 1 ? "s" : ""}`;

  // What the office (or all of them) holds — over the pieces, in either view.
  const summary = (
    <>
      <StatStrip
        items={[
          { label: "In stock", value: `${piecesInStock} piece${piecesInStock !== 1 ? "s" : ""}`, tone: "strong" as const, icon: Gem,
            sub: officeName ? `At the ${officeName}` : "All offices" },
          ...(piecesInStock > 0 ? [{ label: "Worth", value: fmtMoney(worth), icon: Wallet, sub: "At selling price" }] : []),
          ...(isAdmin && costed.length > 0 ? [{ label: "Cost", value: fmtMoney(costWorth), icon: Lock,
            sub: costed.length < inStock.length ? `${inStock.length - costed.length} without a cost` : "Admin only" }] : []),
          ...(soldOut > 0 ? [{ label: "Sold out", value: soldOut, icon: PackageX, sub: `item${soldOut !== 1 ? "s" : ""}` }] : []),
        ]} />
      {officeSel === NO_OFFICE && canManage && <p className="px-1 text-xs text-amber-700">Give each an office: ⋯ → Move to another office</p>}
    </>
  );

  const selectionBar = canManage && sel.size > 0 ? (
    <div className="rounded-xl border border-primary/20 bg-primary/[0.04] px-3 py-2 flex flex-wrap items-center gap-x-3 gap-y-2 text-sm">
      <span className="font-semibold text-brand-dark">{chosen.length} selected</span>
      {chosen.length !== sel.size && (
        <span className="text-xs text-muted-foreground">
          ({sel.size - chosen.length} hidden by filters, left out)
        </span>
      )}
      {mayExport && <span className="text-xs text-muted-foreground">Downloads hold just these.</span>}
      <div className="ml-auto flex items-center gap-2">
        {mayExport && chosen.length > 0 && (
          <Button size="sm" onClick={() => setSharing(chosen)} className="h-8 rounded-lg gap-1.5 btn-hero"><Share2 className="h-3.5 w-3.5" />Share / PDF</Button>
        )}
        {can("readyStock", "edit") && chosen.length > 0 && (
          <Button size="sm" variant="outline" onClick={() => setMoving(chosen)} className="h-8 rounded-lg gap-1.5"><ArrowRightLeft className="h-3.5 w-3.5" />Move to office</Button>
        )}
        {!allShown && (
          <button onClick={() => setSel(new Set(items.map(i => i.id)))}
            className="text-xs font-medium text-primary hover:underline">
            Select all {items.length}
          </button>
        )}
        <button onClick={() => setSel(new Set())}
          className="flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground">
          <X className="h-3.5 w-3.5" /> Clear
        </button>
      </div>
    </div>
  ) : null;

  return (
    <div className="max-w-7xl mx-auto space-y-5">
      <PageHeader
        title="Ready Stock"
        subtitle={canManage ? "Finished pieces, by office" : "Finished pieces to buy"}
        primary={canManage && can("readyStock", "add") ? { label: "Add Item", icon: Plus, onClick: openAdd } : null}
        menu={canManage ? [
          { label: "Our offices", icon: Building2, hint: "Add or reorder offices", onSelect: () => setOfficesOpen(true), show: isAdmin },
        ] : undefined}
        actions={<ViewSwitch view={view} onChange={saveView} />}
      />

      {canManage && <ReturnsComingPanel />}

      {/* Office tabs: where the pieces are. */}
      <TabBar label="Office" value={officeSel} onChange={setOffice}
        tabs={[{ key: "all", label: "All offices", count: tabs.reduce((s, t) => s + t.pieces, 0) },
          ...tabs.map(t => ({ key: tabKey(t.office), label: officeLabel(t.office), icon: MapPin, count: t.pieces }))]} />

      {/* Grid: the table's one toolbar row, without the table (the list has its own). */}
      {view === "grid" && (
        <div className="space-y-2.5">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative flex-1 min-w-[12rem] sm:max-w-sm max-sm:basis-full">
              <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
              <input value={q} onChange={e => onSearch(e.target.value)} placeholder={searchHint} aria-label={searchHint}
                className="h-9 w-full rounded-xl border border-border bg-white pl-9 pr-8 text-sm placeholder:text-muted-foreground/80 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/40" />
              {q && (
                <button type="button" onClick={() => onSearch("")} aria-label="Clear search"
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 h-6 w-6 grid place-items-center rounded-md text-muted-foreground hover:bg-secondary hover:text-foreground"><X className="h-3.5 w-3.5" /></button>
              )}
            </div>
            <FiltersButton filters={filters} onClear={clearFilters} count={countText} />
            <div className="ml-auto flex items-center gap-2">
              <span className="text-xs text-muted-foreground tabular-nums whitespace-nowrap">{countText}{chosen.length ? ` · ${chosen.length} ticked` : ""}</span>
              {mayExport && <ExportMenu exports={exports} scope={`${which}${chosen.length ? "" : (q || coSel !== "all" || avail !== "all" ? ", as filtered" : "")}`} />}
            </div>
          </div>
          <FilterChips filters={filters} onClear={clearFilters} />
          {summary}
          {selectionBar}
        </div>
      )}

      {view === "grid" && (
      <div className="grid gap-3 sm:gap-4 grid-cols-2 md:grid-cols-3 xl:grid-cols-4">
        {paged.map((item, idx) => (
          <Fragment key={item.id}>
          {groupHead(item, idx)}
          <div onClick={openCard(item)} className={`group card-luxe card-hover overflow-hidden flex flex-col min-w-0 cursor-pointer ${sel.has(item.id) ? "ring-2 ring-primary" : ""}`}>
            {/* Tick box and menu sit above the photo, never on it. The office is
                the heading over its group or the tab, so the card doesn't repeat it. */}
            <div className="flex items-center gap-1.5 px-2.5 sm:px-3 pt-2.5 sm:pt-3 pb-2 min-w-0">
              {canManage && <SelectBox checked={sel.has(item.id)} onToggle={() => toggleSel(item.id)}
                className={sel.size ? "" : "[@media(hover:hover)]:opacity-0 group-hover:opacity-100 focus-visible:opacity-100"} />}
              {canManage && <div className="ml-auto"><MoreMenu size="sm" label={`Actions for ${item.name}`} actions={itemActions(item)} /></div>}
            </div>
            {/* No photo: a small tile rather than an empty square half the card high. */}
            <div className={`relative mx-2.5 sm:mx-3 rounded-xl overflow-hidden ring-1 ring-border/60 ${item.images?.[0] ? "aspect-square bg-white" : "h-24 bg-secondary/50"}`}>
              {item.images?.[0] ? (
                <img src={item.images[0]} alt={item.name} loading="lazy" className="w-full h-full object-contain p-1" />
              ) : (
                <div className="w-full h-full grid place-items-center text-muted-foreground/40"><Gem className="h-7 w-7" /></div>
              )}
              {item.quantity === 0 && (
                <div className="absolute inset-0 bg-black/50 grid place-items-center">
                  <span className="text-white font-semibold text-sm tracking-wide">SOLD OUT</span>
                </div>
              )}
              {item.video && (
                <button onClick={() => setVideoView(item.video!)} title="Play video"
                  className="absolute bottom-2 left-2 inline-flex items-center gap-1 h-7 pl-1.5 pr-2 rounded-full bg-black/60 hover:bg-black/80 text-white text-[11px] font-medium transition-colors">
                  <Play className="h-3.5 w-3.5 fill-current" /> Video
                </button>
              )}
            </div>
            <div className="p-2.5 sm:p-3 flex-1 flex flex-col min-w-0">
              <p className="font-display text-base sm:text-lg text-brand-dark truncate leading-tight"><Link to={pieceHref(item)} className="hover:underline">{item.name}</Link></p>
              <p className="text-xs text-muted-foreground mt-0.5 truncate">
                {item.jewelleryType} · {metalLabel(item.metal)}{item.productKarats ? ` ${item.productKarats}` : ""}
                {item.diamondWeight ? ` · ${item.diamondWeight}ct ${item.diamondType || "diamond"}` : ""}
              </p>
              {(item.grossWeight || item.netWeight) && (
                <p className="text-[11px] text-muted-foreground mt-0.5 truncate">
                  {item.grossWeight ? `Gross ${item.grossWeight}g` : ""}
                  {item.grossWeight && item.netWeight ? " · " : ""}
                  {item.netWeight ? `Net ${item.netWeight}g` : ""}
                </p>
              )}
              <p className="text-[11px] text-muted-foreground mt-0.5 font-mono truncate">
                ID {item.id.slice(-6).toUpperCase()}{item.sku ? ` · #${item.sku}` : ""}
              </p>
              {canManage && (item.fromReturn || coSel === "all") && (
                <div className="flex flex-wrap gap-1 mt-1">
                  {item.fromReturn && <span title={item.notes} className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-800">Returned by a client</span>}
                  {coSel === "all" && <CompanyBadge id={companyOf(item)} />}
                </div>
              )}
              <div className="flex items-center justify-between gap-2 mt-auto pt-3">
                <p className="font-display text-lg sm:text-xl font-bold text-brand-dark">{fmtMoney(item.price)}</p>
                {canManage && can("readyStock", "edit") ? qtyStepper(item) : stockPill(item)}
              </div>
              {isAdmin && stockCostOf(db, item) != null && (
                <p className="text-[11px] mt-1">
                  <span className="text-muted-foreground">Cost {fmtMoney(stockCostOf(db, item)!)}</span>
                  {" · "}
                  <span className={`font-semibold ${item.price - stockCostOf(db, item)! >= 0 ? "text-success" : "text-destructive"}`}>
                    {item.price - stockCostOf(db, item)! >= 0 ? "Profit" : "Loss"} {fmtMoney(Math.abs(item.price - stockCostOf(db, item)!))}
                  </span>
                </p>
              )}
              <p className="text-[10px] text-muted-foreground mt-1">Added {fmtDate(item.createdAt)}</p>
            </div>
          </div>
          </Fragment>
        ))}
        {total === 0 && <div className="col-span-full card-luxe p-12 text-center text-muted-foreground">{shelf.length ? "Nothing matches." : "No ready stock yet."}</div>}
      </div>
      )}

      {/* List: the same table as every list — the office a column to sort by. */}
      {view === "list" && (
        <div className="card-luxe p-3 sm:p-4">
          <DataTable
            id="ready-stock"
            noun="item"
            rows={items}
            search={{ value: q, onChange: onSearch, placeholder: searchHint }}
            filters={filters}
            onClearFilters={clearFilters}
            exports={exports}
            summary={<>{summary}{selectionBar}</>}
            resetKey={JSON.stringify([officeSel, q, coSel, avail])}
            columns={listColumns}
            rowKey={i => i.id}
            rowHref={pieceHref}
            details={pieceDetails}
            defaultSort={{ key: "office", dir: "asc" }}
            selected={canManage ? sel : undefined}
            onSelectedChange={canManage ? setSel : undefined}
            rowActions={canManage ? itemActions : undefined}
            totals={{ qty: rows => rows.reduce((s, i) => s + Math.max(0, i.quantity), 0), price: rows => fmtMoney(rows.reduce((s, i) => s + i.price * Math.max(0, i.quantity), 0)) }}
            totalsLabel="In stock"
            emptyText={shelf.length ? "Nothing matches." : "No ready stock yet."}
            emptyAction={!shelf.length && canManage && can("readyStock", "add") ? { label: "Add a piece", onClick: openAdd } : undefined}
          />
        </div>
      )}

      {view === "grid" && <PaginationBar page={page} totalPages={totalPages} onPageChange={setPage} label={total > 0 ? `Showing ${start + 1}–${end} of ${total} items` : undefined} />}

      {/* Add / Edit a piece */}
      {dlg && <ReadyStockItemDialog item={dlg.item} defaults={dlg.defaults} onClose={() => setDlg(null)} />}

      {moving && <MoveOfficeDialog items={moving} onClose={() => setMoving(null)} onDone={() => setSel(new Set())} />}
      {officesOpen && <OfficesDialog onClose={() => setOfficesOpen(false)} />}

      {/* Barcode band for a ready-stock piece (barcode = SKU) */}
      {sharing && <ShareProductsSheet items={sharing} onClose={() => setSharing(null)} />}
      <BandDialog
        open={!!bandItem}
        onOpenChange={o => { if (!o) setBandItem(null); }}
        presets={labelPresets(db.settings)}
        showPrice={db.settings.barcodeBandShowPrice !== false}
        onGenerate={(preset, mode, copies) => { if (bandItem) generateStockBand(bandItem, db.settings, { style: preset.style, width: preset.widthMm, height: preset.heightMm, mode, copies }); }}
      />

      {/* Product video viewer */}
      <Dialog open={!!videoView} onOpenChange={o => { if (!o) setVideoView(null); }}>
        <DialogContent className="max-w-4xl rounded-2xl p-2 sm:p-3">
          <DialogHeader className="px-2 pt-1"><DialogTitle className="font-display text-lg">Product Video</DialogTitle></DialogHeader>
          {videoView && <WebVideo src={videoView} controls autoPlay muted loop playsInline preload="auto" className="w-full max-h-[70vh] rounded-xl bg-black" />}
        </DialogContent>
      </Dialog>
    </div>
  );
}
