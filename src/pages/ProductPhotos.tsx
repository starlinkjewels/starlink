import { brandName } from "@/lib/brand";
import { useCan } from "@/hooks/useCan";
import { WebVideo } from "@/components/ProductVideo";
import { PageHeader, TabBar } from "@/components/PageHeader";
import { exportAllowed } from "@/lib/access";
import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useAuth } from "@/lib/auth";
import { currentUserOrders, logEvent, type Order } from "@/lib/db";
import { useDb } from "@/hooks/useDb";
import { downloadAsZip } from "@/lib/zipDownload";
import { VideoPoster } from "@/components/VideoPoster";
import { toast } from "sonner";
import { Folder, ChevronRight, Image as ImageIcon, Video, Download, X, Camera, ChevronLeft, Trash2, Pencil, Package, PenTool } from "lucide-react";
import { MoreMenu, type MoreAction } from "@/components/MoreMenu";
import { CadJobsTable } from "@/components/designers/CadJobsTable";
import { isOpenJob } from "@/lib/designers";

async function downloadOne(fileUrl: string, filename: string) {
  if (!exportAllowed()) return;
  try {
    const res = await fetch(fileUrl);
    const blob = await res.blob();
    const obj = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = obj; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    logEvent("export", `Downloaded ${filename}`, { file: filename });
    setTimeout(() => URL.revokeObjectURL(obj), 4000);
  } catch { window.open(fileUrl, "_blank"); }
}

/** `thumb`: the small copy the grid shows — `src` (the original) opens and downloads. */
interface GalleryItem { id: string; type: "image" | "video"; label: string; src: string; thumb?: string; filename: string; }

function buildOrderItems(orders: Order[], design: string): GalleryItem[] {
  const items: GalleryItem[] = [];
  orders.forEach(o => {
    if (o.cadImage) items.push({ id: `${o.id}-cad`, type: "image", label: "CAD Design", src: o.cadImage, filename: `${design}-cad.jpg` });
    (o.productPhotos ?? []).forEach((p, i) => items.push({ id: `${o.id}-photo-${i}`, type: "image", label: `Photo ${i + 1}`, src: p, filename: `${design}-photo-${i + 1}.jpg` }));
    if (o.productVideo) items.push({ id: `${o.id}-video`, type: "video", label: "Video", src: o.productVideo, filename: `${design}-video.mp4` });
  });
  return items;
}

/* Folder card — category level and product-id level. */
function FolderCard({ label, sub, cover, onClick, onRename, onDelete }: {
  label: string; sub?: string; cover?: string; onClick(): void; onRename?(): void; onDelete?(): void;
}) {
  return (
    <div className="relative group">
      <motion.button whileTap={{ scale: 0.97 }} onClick={onClick}
        className="w-full flex flex-col rounded-2xl border border-border/60 active:border-primary/40 bg-white shadow-sm overflow-hidden text-left">
        <div className="aspect-video w-full bg-gradient-to-br from-fuchsia-50 to-fuchsia-100 overflow-hidden relative">
          {cover ? <img src={cover} alt="" className="w-full h-full object-cover" /> : <div className="absolute inset-0 flex items-center justify-center"><Folder className="h-10 w-10 text-fuchsia-300" /></div>}
        </div>
        <div className="px-3 pt-2.5 pb-1 flex items-center gap-2">
          {cover && <Folder className="h-3.5 w-3.5 text-fuchsia-500 shrink-0" />}
          <span className="text-sm font-medium text-foreground truncate">{label}</span>
        </div>
        {sub && <div className="px-3 pb-2.5 text-[11px] text-muted-foreground truncate">{sub}</div>}
      </motion.button>
      {(onRename || onDelete) && (
        <div className="absolute top-2 right-2 flex gap-1 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity">
          {onRename && <button onClick={e => { e.stopPropagation(); onRename(); }} className="h-7 w-7 rounded-lg bg-white/90 border border-border/60 grid place-items-center text-muted-foreground hover:text-primary shadow-sm" aria-label="Rename"><Pencil className="h-3.5 w-3.5" /></button>}
          {onDelete && <button onClick={e => { e.stopPropagation(); onDelete(); }} className="h-7 w-7 rounded-lg bg-white/90 border border-border/60 grid place-items-center text-destructive hover:bg-destructive/10 shadow-sm" aria-label="Delete"><Trash2 className="h-3.5 w-3.5" /></button>}
        </div>
      )}
    </div>
  );
}

function ItemCard({ item, onOpen, onDownload, onDelete, menu }: { item: GalleryItem; onOpen(): void; onDownload(): void; onDelete?(): void; menu?: MoreAction[] }) {
  return (
    <motion.div whileTap={{ scale: 0.97 }} className="relative rounded-2xl overflow-hidden border border-border/60 bg-white shadow-sm flex flex-col group">
      <button onClick={onOpen} className="block w-full aspect-square bg-secondary/30 overflow-hidden relative">
        {item.type === "image"
          ? <img src={item.thumb || item.src} alt={item.label} loading="lazy" decoding="async" className="w-full h-full object-cover" />
          : <VideoPoster src={item.src} poster={item.thumb} alt={item.label} />}
        <div className="absolute top-2 left-2"><span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-black/50 text-white backdrop-blur-sm">{item.type === "video" ? <Video className="h-2.5 w-2.5" /> : <ImageIcon className="h-2.5 w-2.5" />}{item.type}</span></div>
        <button onClick={e => { e.stopPropagation(); onDownload(); }} className="absolute top-2 right-2 h-8 w-8 rounded-lg bg-white/90 border border-border/60 grid place-items-center text-muted-foreground hover:text-primary shadow-sm" aria-label="Download"><Download className="h-3.5 w-3.5" /></button>
        {onDelete && <button onClick={e => { e.stopPropagation(); onDelete(); }} className="absolute bottom-2 right-2 h-8 w-8 rounded-lg bg-white/90 border border-border/60 grid place-items-center text-destructive hover:bg-destructive/10 shadow-sm opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity" aria-label="Delete"><Trash2 className="h-3.5 w-3.5" /></button>}
      </button>
      <div className="px-2.5 pt-2 pb-1.5 flex items-center gap-1">
        <p className="flex-1 min-w-0 text-[11px] text-foreground font-medium truncate">{item.label}</p>
        {menu && <MoreMenu size="sm" label={`Actions for ${item.label}`} title={item.label} actions={menu} className="h-7 w-7 border-0 shadow-none" />}
      </div>
    </motion.div>
  );
}

function Lightbox({ items, startIndex, onClose }: { items: GalleryItem[]; startIndex: number; onClose(): void }) {
  const [idx, setIdx] = useState(startIndex);
  const [dir, setDir] = useState(0);
  const item = items[idx];
  const hasPrev = idx > 0, hasNext = idx < items.length - 1;
  const prev = () => { if (hasPrev) { setDir(-1); setIdx(i => i - 1); } };
  const next = () => { if (hasNext) { setDir(1); setIdx(i => i + 1); } };
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); if (e.key === "ArrowLeft") prev(); if (e.key === "ArrowRight") next(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idx]);
  if (!item) return null;
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-[60] bg-black/96 flex flex-col"
      style={{ paddingTop: "env(safe-area-inset-top)", paddingBottom: "env(safe-area-inset-bottom)" }}>
      <div className="flex items-center justify-between px-4 py-3 shrink-0 gap-3">
        <p className="text-white/80 text-sm font-medium truncate">{item.label}{items.length > 1 && <span className="ml-2 text-white/40 text-xs">{idx + 1} / {items.length}</span>}</p>
        <div className="flex items-center gap-2 shrink-0">
          <button onClick={() => downloadOne(item.src, item.filename)} className="h-10 w-10 rounded-full bg-white/10 active:bg-white/20 flex items-center justify-center text-white"><Download className="h-5 w-5" /></button>
          <button onClick={onClose} className="h-10 w-10 rounded-full bg-white/10 active:bg-white/20 flex items-center justify-center text-white"><X className="h-5 w-5" /></button>
        </div>
      </div>
      <div className="flex-1 flex items-center min-h-0 relative">
        {hasPrev && <button onClick={prev} className="absolute left-2 z-10 h-11 w-11 rounded-full bg-white/10 active:bg-white/20 flex items-center justify-center text-white"><ChevronLeft className="h-6 w-6" /></button>}
        <AnimatePresence mode="wait" custom={dir}>
          <motion.div key={item.id} custom={dir}
            initial={{ opacity: 0, x: dir * 60 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: dir * -60 }}
            transition={{ duration: 0.22, ease: "easeOut" }} className="flex-1 flex items-center justify-center px-14 h-full min-h-0">
            {item.type === "image"
              ? <img src={item.src} alt={item.label} className="max-w-full max-h-full object-contain rounded-xl select-none" style={{ maxHeight: "calc(100vh - 140px)" }} onClick={onClose} />
              : <WebVideo src={item.src} controls autoPlay muted loop playsInline preload="auto" className="max-w-full rounded-xl" style={{ maxHeight: "calc(100vh - 140px)" }} />}
          </motion.div>
        </AnimatePresence>
        {hasNext && <button onClick={next} className="absolute right-2 z-10 h-11 w-11 rounded-full bg-white/10 active:bg-white/20 flex items-center justify-center text-white"><ChevronRight className="h-6 w-6" /></button>}
      </div>
    </motion.div>
  );
}

/* ══════════════════════════ ORDER-WISE VIEW ══════════════════════════ */
/* Auto-organised from orders: jewellery category → design number → the CAD,
   product photos and video captured on each order. Read-only. */
function OrdersView({ isStaff }: { isStaff: boolean }) {
  const { user } = useAuth();
  const db = useDb();
  const [category, setCategory] = useState<string | null>(null);
  const [design, setDesign] = useState<string | null>(null);
  const [lightbox, setLightbox] = useState<number | null>(null);
  const [downloading, setDownloading] = useState(false);

  const mediaOrders = currentUserOrders(db, user!).filter(o => (o.productPhotos?.length ?? 0) > 0 || !!o.productVideo || !!o.cadImage);

  const categoryMap = new Map<string, Order[]>();
  mediaOrders.forEach(o => { const c = o.jewelleryType || "Other"; if (!categoryMap.has(c)) categoryMap.set(c, []); categoryMap.get(c)!.push(o); });
  const categories = [...categoryMap.entries()].map(([name, orders]) => ({ name, orders })).sort((a, b) => a.name.localeCompare(b.name));

  const designMap = new Map<string, Order[]>();
  if (category) (categoryMap.get(category) ?? []).forEach(o => { const d = (o.designNumber || o.orderNumber || "Unlabelled").trim(); if (!designMap.has(d)) designMap.set(d, []); designMap.get(d)!.push(o); });
  const designs = [...designMap.entries()].map(([name, orders]) => ({ name, orders })).sort((a, b) => a.name.localeCompare(b.name));

  const designOrders = design ? (designMap.get(design) ?? []) : [];
  const items = design ? buildOrderItems(designOrders, design) : [];

  const downloadAll = async () => {
    setDownloading(true);
    try {
      const r = await downloadAsZip(items.map(it => ({ url: it.src, filename: it.filename })), `${design || "photos"}`);
      if (!r.added) toast.error("Nothing could be downloaded — check the connection and try again");
      else if (r.failed.length) toast.warning(`${r.added} downloaded, ${r.failed.length} could not be fetched`);
      else toast.success(`${r.added} file${r.added !== 1 ? "s" : ""} downloaded as ${design || "photos"}.zip`);
    } finally { setDownloading(false); }
  };

  return (
    <div className="space-y-4">
      <nav className="flex items-center gap-1 flex-wrap text-sm min-w-0">
        <button onClick={() => { setCategory(null); setDesign(null); }} className={`font-medium shrink-0 ${!category ? "text-brand-dark" : "text-primary hover:underline"}`}>All orders</button>
        {category && <span className="flex items-center gap-1 min-w-0"><ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" /><button onClick={() => setDesign(null)} className={`font-medium truncate ${!design ? "text-brand-dark" : "text-primary hover:underline"}`}>{category}</button></span>}
        {design && <span className="flex items-center gap-1 min-w-0"><ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" /><span className="font-medium text-brand-dark truncate">{design}</span></span>}
      </nav>

      {!category && (categories.length === 0
        ? <div className="card-luxe p-12 text-center text-muted-foreground"><Camera className="h-10 w-10 mx-auto mb-3 opacity-20" /><p>No order photos yet.</p></div>
        : <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-auto-photos gap-3 sm:gap-4">
            {categories.map(cat => {
              const designCount = new Set(cat.orders.map(o => (o.designNumber || o.orderNumber || "Unlabelled").trim())).size;
              const cover = cat.orders.flatMap(o => o.productPhotos ?? [])[0] ?? cat.orders.find(o => o.cadImage)?.cadImage;
              return <FolderCard key={cat.name} label={cat.name} sub={`${designCount} design${designCount !== 1 ? "s" : ""}`} cover={cover} onClick={() => setCategory(cat.name)} />;
            })}
          </div>)}

      {category && !design && (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-auto-photos gap-3 sm:gap-4">
          {designs.map(d => {
            const cover = d.orders.flatMap(o => o.productPhotos ?? [])[0] ?? d.orders.find(o => o.cadImage)?.cadImage;
            const clientNames = isStaff ? [...new Set(d.orders.map(o => db.clients.find(c => c.id === o.clientId)?.companyName).filter(Boolean))] : [];
            return <FolderCard key={d.name} label={d.name} sub={clientNames.length > 0 ? clientNames.join(", ") : undefined} cover={cover} onClick={() => setDesign(d.name)} />;
          })}
        </div>
      )}

      {category && design && (
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            {isStaff && <p className="text-xs text-muted-foreground truncate min-w-0">{designOrders.map(o => o.orderNumber).join(", ")} · {[...new Set(designOrders.map(o => db.clients.find(c => c.id === o.clientId)?.companyName).filter(Boolean))].join(", ")}</p>}
            {items.length > 0 && <button onClick={downloadAll} disabled={downloading} className="flex items-center gap-1.5 h-9 px-3 rounded-xl border border-border text-xs font-medium hover:bg-secondary disabled:opacity-60 shrink-0"><Download className="h-3.5 w-3.5" /> {downloading ? "Downloading…" : "Download All"}</button>}
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-auto-photos gap-3 sm:gap-4">
            {items.map((item, i) => <ItemCard key={item.id} item={item} onOpen={() => setLightbox(i)} onDownload={() => downloadOne(item.src, item.filename)} />)}
          </div>
        </div>
      )}

      <AnimatePresence>{lightbox !== null && <Lightbox items={items} startIndex={lightbox} onClose={() => setLightbox(null)} />}</AnimatePresence>
    </div>
  );
}

/**
 * Design Studio — the CAD designs given to designers (staff), and the product
 * photos by order (clients with access see those).
 */
export function ProductPhotosPage() {
  const { user } = useAuth();
  const db = useDb();
  const can = useCan();
  const isStaff = user!.role !== "client";
  const seeDesigns = user!.role === "admin" || (user!.role === "employee" && can("designers"));
  const [tab, setTab] = useState<"designs" | "orders">(seeDesigns ? "designs" : "orders");
  // An employee sees the designs of the orders within their work, as on Orders.
  const mine = user!.role === "employee" ? new Set(currentUserOrders(db, user!).map(o => o.id)) : null;
  const jobs = seeDesigns ? (db.cadJobs ?? []).filter(j => !mine || mine.has(j.orderId)) : [];

  if (user!.role === "client") {
    const client = db.clients.find(c => c.id === user!.clientId);
    if (!client?.productPhotoAccess) {
      return (
        <div className="max-w-2xl mx-auto">
          <div className="card-luxe p-10 text-center text-muted-foreground">
            <Camera className="h-10 w-10 mx-auto mb-3 opacity-30" />
            <p className="font-medium text-foreground">Design Studio isn't available for your account yet</p>
            <p className="text-sm mt-1">Contact {brandName()} to get access.</p>
          </div>
        </div>
      );
    }
  }

  return (
    <div className="max-w-6xl mx-auto space-y-5">
      <PageHeader title="Design Studio" subtitle={seeDesigns ? "CAD designs and product photos" : "Product photos"} />

      {/* Designs given to designers (staff) · photos by order */}
      <TabBar label="Design Studio" value={tab} onChange={setTab} className="w-fit max-w-full"
        tabs={[
          ...(seeDesigns ? [{ key: "designs" as const, label: "Designs", icon: PenTool, count: jobs.filter(isOpenJob).length || undefined }] : []),
          { key: "orders", label: "By Order", icon: Package },
        ]} />

      {tab === "designs" && seeDesigns ? (
        <div className="card-luxe p-3 sm:p-4">
          <CadJobsTable id="design-studio-jobs" jobs={jobs} showDesigner exportName="Designs"
            emptyText="No designs given yet — give an order's design to a designer from its CAD Design card." />
        </div>
      ) : <OrdersView isStaff={isStaff} />}
    </div>
  );
}
