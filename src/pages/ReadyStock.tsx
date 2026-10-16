import { DataTable, CellTag, CellAmount, CellDate, type DataColumn } from "@/components/DataTable";
import { useCan, useMayExport } from "@/hooks/useCan";
import { Fragment, useState, type MouseEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { updateDb, fmtDate, fmtMoney, stockCostOf, type ReadyStockItem } from "@/lib/db";
import { useDb } from "@/hooks/useDb";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { usePagination } from "@/hooks/usePagination";
import { PaginationBar } from "@/components/PaginationBar";
import { Plus, Search, Trash2, Gem, X, Minus, Pencil, MapPin, Rows3, LayoutGrid, Tag, Play, FileText, FileSpreadsheet, Check, ArrowRightLeft, Building2 } from "lucide-react";
import { exportReadyStockCsv, exportReadyStockPdf } from "@/lib/productExport";
import { BandDialog } from "@/components/BandDialog";
import { generateStockBand, labelPresets } from "@/lib/band";
import { toast } from "sonner";
import { confirmBox } from "@/lib/confirm";
import { ReturnsComingPanel } from "@/components/SalesReturn";
import { CompanyFilter, CompanyBadge, useMultiCo, useDefaultCompany } from "@/components/CompanyFields";
import { companyOf, companyIdOfClient } from "@/lib/companies";
import { MoreMenu, type MoreAction } from "@/components/MoreMenu";
import { MoveOfficeDialog, OfficesDialog, OfficeChip } from "@/components/ReadyStockOffices";
import { ReadyStockItemDialog } from "@/components/ReadyStockItemDialog";
import { officeLabel, officeOf, officeRank, officeTabs, readyStockOffices } from "@/lib/offices";
import { stepQty, whoOf } from "@/lib/readyStockHistory";

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

  const del = async (item: ReadyStockItem) => {
    if (!(await confirmBox(`Delete "${item.name}" from ready stock? This cannot be undone.`))) return;
    updateDb(d => { d.readyStock = d.readyStock.filter(x => x.id !== item.id); });
    toast.success("Deleted");
  };

  const bandOn = db.settings.barcodeBandEnabled !== false && mayExport;
  const itemActions = (item: ReadyStockItem): MoreAction[] => [
    { label: "Edit", icon: Pencil, onSelect: () => openEdit(item), show: can("readyStock", "edit") },
    { label: "Move to another office", icon: ArrowRightLeft, hint: `Now at the ${officeLabel(officeOf(item))}`, onSelect: () => setMoving([item]), show: can("readyStock", "edit") && item.quantity > 0 },
    { label: "Print band", icon: Tag, onSelect: () => setBandItem(item), show: bandOn },
    { label: "Delete", icon: Trash2, danger: true, onSelect: () => del(item), show: can("readyStock", "delete") },
  ];

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
              {item.jewelleryType} · {item.metal}{item.productKarats ? ` ${item.productKarats}` : ""}{item.diamondWeight ? ` · ${item.diamondWeight}ct ${item.diamondType || "diamond"}` : ""}
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

  return (
    <div className="max-w-7xl mx-auto space-y-5">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          <h1 className="font-display text-2xl md:text-3xl text-brand-dark">Ready Stock</h1>
          <p className="text-sm text-muted-foreground">{canManage ? "Finished jewelry available to sell directly, office by office" : "Finished jewelry available to buy"}</p>
        </div>
        {canManage && (
          <div className="flex items-center gap-2">
            {can("readyStock", "add") && (
              <Button onClick={openAdd} className="btn-hero h-10 rounded-xl"><Plus className="h-4 w-4 mr-2" />Add Item</Button>
            )}
            <MoreMenu actions={[
              { label: "Download PDF", icon: FileText, hint: chosen.length ? `The ${chosen.length} selected` : `The ${items.length} shown`, onSelect: () => exportReadyStockPdf(exportItems, exportName(), exportSubject()), show: mayExport, disabled: !items.length },
              { label: "Download Excel", icon: FileSpreadsheet, hint: chosen.length ? `The ${chosen.length} selected` : `The ${items.length} shown`, onSelect: () => exportReadyStockCsv(exportItems, exportName(), isAdmin, i => stockCostOf(db, i)), show: mayExport, disabled: !items.length },
              { label: "Our offices", icon: Building2, hint: "Add an office, or change their order", onSelect: () => setOfficesOpen(true), show: isAdmin },
            ]} />
          </div>
        )}
      </div>

      {canManage && <ReturnsComingPanel />}

      {/* Office tabs: where the pieces are. */}
      <div className="card-luxe p-2 sm:p-3 space-y-2">
        <div role="tablist" aria-label="Office" className="flex gap-1.5 overflow-x-auto no-scrollbar">
          {[{ key: "all", label: "All offices", pieces: tabs.reduce((s, t) => s + t.pieces, 0), warn: false },
            ...tabs.map(t => ({ key: tabKey(t.office), label: officeLabel(t.office), pieces: t.pieces, warn: !t.office }))].map(t => (
            <button key={t.key} type="button" role="tab" aria-selected={officeSel === t.key} onClick={() => setOffice(t.key)}
              className={`shrink-0 inline-flex items-center gap-2 h-9 px-3 rounded-lg text-sm font-medium transition-colors ${officeSel === t.key ? "bg-primary text-primary-foreground shadow-soft" : t.warn ? "text-amber-800 hover:bg-amber-500/10" : "text-muted-foreground hover:bg-secondary hover:text-foreground"}`}>
              {t.key !== "all" && <MapPin className="h-3.5 w-3.5" />}
              {t.label}
              <span className={`min-w-5 h-5 px-1.5 rounded-full text-[11px] font-semibold grid place-items-center tabular-nums ${officeSel === t.key ? "bg-white/20" : "bg-secondary"}`}>{t.pieces}</span>
            </button>
          ))}
        </div>
        <p className="px-1 text-xs text-muted-foreground">
          <span className="font-semibold text-brand-dark">{piecesInStock} piece{piecesInStock !== 1 ? "s" : ""} in stock</span>
          {officeName ? ` at the ${officeName}` : " across all offices"}
          {piecesInStock > 0 && <> · worth <span className="font-semibold text-brand-dark">{fmtMoney(worth)}</span></>}
          {isAdmin && costed.length > 0 && <> · cost {fmtMoney(costWorth)}{costed.length < inStock.length ? ` (${inStock.length - costed.length} without a cost)` : ""}</>}
          {soldOut > 0 && ` · ${soldOut} sold out`}
          {officeSel === NO_OFFICE && canManage && <span className="text-amber-700"> — give each an office: ⋯ → Move to another office</span>}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[160px] sm:w-64 sm:flex-none">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input value={q} onChange={e => { setQ(e.target.value); setPage(1); }} placeholder="Search name or SKU — SKU-1, SKU-2" className="pl-9 h-10 rounded-xl" />
        </div>
        {canManage && <CompanyFilter value={coSel} onChange={v => { setCoSel(v); setPage(1); }} className="flex-1 sm:flex-none sm:w-52 h-10 rounded-xl" />}
        <Select value={avail} onValueChange={v => { setAvail(v as "all" | "available" | "sold"); setPage(1); }}>
          <SelectTrigger aria-label="Availability" className="flex-1 sm:flex-none sm:w-40 h-10 rounded-xl"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All items</SelectItem>
            <SelectItem value="available">Available</SelectItem>
            <SelectItem value="sold">Sold out</SelectItem>
          </SelectContent>
        </Select>
        <div className="shrink-0 ml-auto inline-flex items-center gap-0.5 p-0.5 rounded-lg bg-secondary border border-border/60">
          <button onClick={() => saveView("list")} aria-label="List view"
            className={`flex items-center gap-1 h-8 px-2 rounded-md text-xs font-medium transition-colors ${view === "list" ? "bg-white text-brand-dark shadow-soft" : "text-muted-foreground hover:text-foreground"}`}>
            <Rows3 className="h-3.5 w-3.5" /><span className="hidden sm:inline">List</span>
          </button>
          <button onClick={() => saveView("grid")} aria-label="Grid view"
            className={`flex items-center gap-1 h-8 px-2 rounded-md text-xs font-medium transition-colors ${view === "grid" ? "bg-white text-brand-dark shadow-soft" : "text-muted-foreground hover:text-foreground"}`}>
            <LayoutGrid className="h-3.5 w-3.5" /><span className="hidden sm:inline">Grid</span>
          </button>
        </div>
      </div>

      {canManage && sel.size > 0 && (
        <div className="card-luxe px-3 py-2 flex flex-wrap items-center gap-x-3 gap-y-2 text-sm">
          <span className="font-semibold text-brand-dark">{chosen.length} selected</span>
          {chosen.length !== sel.size && (
            <span className="text-xs text-muted-foreground">
              ({sel.size - chosen.length} more hidden by the filters — not included)
            </span>
          )}
          {mayExport && <span className="text-xs text-muted-foreground">PDF and Excel will hold just these.</span>}
          <div className="ml-auto flex items-center gap-2">
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
      )}

      {view === "grid" && (
      <div className="grid gap-3 sm:gap-4 grid-cols-2 md:grid-cols-3 xl:grid-cols-4">
        {paged.map((item, idx) => (
          <Fragment key={item.id}>
          {groupHead(item, idx)}
          <div onClick={openCard(item)} className={`card-luxe card-hover overflow-hidden flex flex-col min-w-0 cursor-pointer ${sel.has(item.id) ? "ring-2 ring-primary" : ""}`}>
            {/* Tick box, office and menu sit above the photo, never on it. */}
            <div className="flex items-center gap-1.5 px-2.5 sm:px-3 pt-2.5 sm:pt-3 pb-2 min-w-0">
              {canManage && <SelectBox checked={sel.has(item.id)} onToggle={() => toggleSel(item.id)} />}
              <OfficeChip office={officeOf(item)} className="min-w-0" />
              {canManage && <div className="ml-auto"><MoreMenu size="sm" label={`Actions for ${item.name}`} actions={itemActions(item)} /></div>}
            </div>
            <div className="relative mx-2.5 sm:mx-3 aspect-square rounded-xl overflow-hidden ring-1 ring-border/60 bg-white">
              {item.images?.[0] ? (
                <img src={item.images[0]} alt={item.name} loading="lazy" className="w-full h-full object-contain p-1" />
              ) : (
                <div className="w-full h-full grid place-items-center bg-secondary/50 text-muted-foreground/40"><Gem className="h-10 w-10" /></div>
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
                {item.jewelleryType} · {item.metal}{item.productKarats ? ` ${item.productKarats}` : ""}
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
        {total === 0 && <div className="col-span-full card-luxe p-12 text-center text-muted-foreground">{shelf.length ? "Nothing here matches — try another office or filter." : "No ready stock items yet — add your first finished piece."}</div>}
      </div>
      )}

      {/* List: the same table as every list — the office a column to sort by. */}
      {view === "list" && (
        <div className="card-luxe p-3 sm:p-4">
          <DataTable
            id="ready-stock"
            noun="piece"
            rows={items}
            columns={listColumns}
            rowKey={i => i.id}
            rowHref={pieceHref}
            defaultSort={{ key: "office", dir: "asc" }}
            selected={canManage ? sel : undefined}
            onSelectedChange={canManage ? setSel : undefined}
            rowActions={canManage ? itemActions : undefined}
            totals={{ qty: rows => rows.reduce((s, i) => s + Math.max(0, i.quantity), 0), price: rows => fmtMoney(rows.reduce((s, i) => s + i.price * Math.max(0, i.quantity), 0)) }}
            totalsLabel="In stock"
            emptyText={shelf.length ? "Nothing here matches — try another office or filter." : "No ready stock items yet — add your first finished piece."}
          />
        </div>
      )}

      {view === "grid" && <PaginationBar page={page} totalPages={totalPages} onPageChange={setPage} label={total > 0 ? `Showing ${start + 1}–${end} of ${total} items` : undefined} />}

      {/* Add / Edit a piece */}
      {dlg && <ReadyStockItemDialog item={dlg.item} defaults={dlg.defaults} onClose={() => setDlg(null)} />}

      {moving && <MoveOfficeDialog items={moving} onClose={() => setMoving(null)} onDone={() => setSel(new Set())} />}
      {officesOpen && <OfficesDialog onClose={() => setOfficesOpen(false)} />}

      {/* Barcode band for a ready-stock piece (barcode = SKU) */}
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
          {videoView && <video src={videoView} controls autoPlay muted playsInline preload="metadata" className="w-full max-h-[70vh] rounded-xl bg-black" />}
        </DialogContent>
      </Dialog>
    </div>
  );
}
