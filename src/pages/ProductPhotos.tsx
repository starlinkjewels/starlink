import { brandName } from "@/lib/brand";
import { useCan } from "@/hooks/useCan";
import { PageHeader, TabBar } from "@/components/PageHeader";
import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { motion } from "framer-motion";
import { useAuth } from "@/lib/auth";
import { currentUserOrders } from "@/lib/db";
import { useDb } from "@/hooks/useDb";
import { VideoPoster } from "@/components/VideoPoster";
import { Folder, ChevronRight, Image as ImageIcon, Video, Camera, Trash2, Pencil, Package, PenTool, Share2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CadJobsTable } from "@/components/designers/CadJobsTable";
import { OrderProductPage } from "@/components/designs/OrderProductPage";
import { DesignShareSheet } from "@/components/catalog/DesignShareSheet";
import { isOpenJob } from "@/lib/designers";
import { orderProducts, sharedProduct } from "@/lib/orderProducts";
import { findOrderShare, saveOrderShare } from "@/lib/share";

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

/* ══════════════════════════ BY ORDER — PRODUCTS ══════════════════════════ */
/* The pieces made on orders, as the catalogue shows its designs: jewellery
   category → design → its product page (photos, CAD and video; the options and
   price; the details read off the order). What a piece is — never its client,
   labour, profit or margin. Where you are is in the address (?c=, ?d=), so Back
   steps out one level. Staff share a piece, or a whole category, as a link. */
function OrdersView() {
  const { user } = useAuth();
  const db = useDb();
  const staff = user!.role === "admin" || user!.role === "employee";
  const [sp, setSp] = useSearchParams();
  const category = sp.get("c");
  const design = sp.get("d");
  const [sharing, setSharing] = useState(false);
  const go = (c: string | null, d: string | null) => setSp(prev => {
    const n = new URLSearchParams(prev);
    n.set("tab", "orders");
    if (c) n.set("c", c); else n.delete("c");
    if (d) n.set("d", d); else n.delete("d");
    return n;
  });
  const byCategory = useMemo(() => orderProducts(db, currentUserOrders(db, user!)), [db, user]);
  const products = category ? byCategory.get(category) ?? [] : [];
  const product = design ? products.find(p => p.design === design) : undefined;
  const here = (c?: string | null) => `?${new URLSearchParams({ tab: "orders", ...(c ? { c } : {}) }).toString()}`;

  if (category && design && product) return <OrderProductPage product={product} back={{ label: category, to: here(category) }} />;

  const shareKey = `category:${category}`;
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <nav className="flex items-center gap-1 flex-wrap text-sm min-w-0">
          <button onClick={() => go(null, null)} className={`font-medium shrink-0 ${!category ? "text-brand-dark" : "text-primary hover:underline"}`}>All orders</button>
          {category && <span className="flex items-center gap-1 min-w-0"><ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" /><span className="font-medium text-brand-dark truncate">{category}</span></span>}
        </nav>
        {staff && category && products.length > 0 && (
          <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setSharing(true)}><Share2 className="h-4 w-4" />Share {category}</Button>
        )}
      </div>

      {!category && (byCategory.size === 0
        ? <div className="card-luxe p-12 text-center text-muted-foreground"><Camera className="h-10 w-10 mx-auto mb-3 opacity-20" /><p>No order photos yet.</p></div>
        : <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-auto-photos gap-3 sm:gap-4">
            {[...byCategory.entries()].map(([name, list]) => (
              <FolderCard key={name} label={name} sub={`${list.length} design${list.length !== 1 ? "s" : ""}`} cover={list.find(p => p.cover)?.cover} onClick={() => go(name, null)} />
            ))}
          </div>)}

      {category && (products.length === 0
        ? <div className="card-luxe p-8 text-center text-sm text-muted-foreground">Nothing here any more. <button className="text-primary underline" onClick={() => go(null, null)}>All orders</button></div>
        : <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-auto-photos gap-3 sm:gap-4">
            {products.map(p => (
              <motion.button key={p.design} whileTap={{ scale: 0.97 }} onClick={() => go(category, p.design)} aria-label={`Open ${p.design}`}
                className="w-full flex flex-col rounded-2xl border border-border/60 active:border-primary/40 bg-white shadow-sm overflow-hidden text-left">
                <div className="aspect-square w-full bg-secondary/30 overflow-hidden relative">
                  {p.cover ? <img src={p.cover} alt="" loading="lazy" decoding="async" className="w-full h-full object-cover" />
                    : p.videos[0] ? <VideoPoster src={p.videos[0]} alt={p.design} />
                    : <div className="absolute inset-0 grid place-items-center"><ImageIcon className="h-8 w-8 text-muted-foreground/40" /></div>}
                  {p.videos.length > 0 && p.cover && <span className="absolute top-2 left-2 inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-black/50 text-white"><Video className="h-2.5 w-2.5" />video</span>}
                </div>
                <div className="px-3 pt-2 pb-2.5 min-w-0">
                  <p className="text-sm font-medium text-foreground truncate">{p.design}</p>
                  {p.line && <p className="text-[11px] text-muted-foreground truncate">{p.line}</p>}
                </div>
              </motion.button>
            ))}
          </div>)}

      {category && design && !product && products.length > 0 && <p className="text-xs text-muted-foreground">{design} isn&rsquo;t in {category} any more.</p>}

      {sharing && category && (
        <DesignShareSheet title={category} onClose={() => setSharing(false)}
          description={`Every ${category} piece — each opens as its own product page, with its options and, if you choose, its price. Never its orders, client, labour or costs.`}
          existing={findOrderShare("orderCategory", shareKey)}
          onSave={c => {
            const list = products.slice(0, 150).map(p => sharedProduct(p, 8));
            // The link's preview and first view: a picture of each piece.
            const items = list.map(p => p.items[0]).filter(Boolean);
            return saveOrderShare({ kind: "orderCategory", key: shareKey, title: category, items, products: list, ...c });
          }} />
      )}
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
  const seeDesigns = user!.role === "admin" || (user!.role === "employee" && can("designers"));
  // By Order opened by its address (a piece, a category, Back from one): that tab.
  const [sp, setSp] = useSearchParams();
  const [tab, setTabState] = useState<"designs" | "orders">(seeDesigns && sp.get("tab") !== "orders" && !sp.get("c") ? "designs" : "orders");
  const setTab = (t: "designs" | "orders") => { setTabState(t); if (t === "designs" && (sp.get("c") || sp.get("d") || sp.get("tab"))) setSp({}, { replace: true }); };
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

  // A piece open: its product page alone, as a catalogue design's (its Back goes to its category).
  const pieceOpen = tab === "orders" && !!sp.get("c") && !!sp.get("d");
  return (
    <div className="max-w-6xl mx-auto space-y-5">
      {!pieceOpen && <>
      <PageHeader title="Design Studio" subtitle={seeDesigns ? "CAD designs and products made on orders" : "Products made on your orders"} />

      {/* Designs given to designers (staff) · the pieces made on orders */}
      <TabBar label="Design Studio" value={tab} onChange={setTab} className="w-fit max-w-full"
        tabs={[
          ...(seeDesigns ? [{ key: "designs" as const, label: "Designs", icon: PenTool, count: jobs.filter(isOpenJob).length || undefined }] : []),
          { key: "orders", label: "By Order", icon: Package },
        ]} />
      </>}

      {tab === "designs" && seeDesigns ? (
        <div className="card-luxe p-3 sm:p-4">
          <CadJobsTable id="design-studio-jobs" jobs={jobs} showDesigner exportName="Designs"
            emptyText="No designs given yet — give an order's design to a designer from its CAD Design card." />
        </div>
      ) : <OrdersView />}
    </div>
  );
}
