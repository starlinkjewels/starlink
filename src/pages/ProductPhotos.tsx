import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useAuth } from "@/lib/auth";
import { currentUserOrders, type Order } from "@/lib/db";
import { useDb } from "@/hooks/useDb";
import { Folder, ChevronRight, Image as ImageIcon, Video, Play, Download, X, Camera, ChevronLeft } from "lucide-react";

// Force a real download (Storage URLs otherwise open in a tab). Fetch the blob
// and save it with a friendly filename; fall back to opening the URL on error.
async function downloadOne(fileUrl: string, filename: string) {
  try {
    const res = await fetch(fileUrl);
    const blob = await res.blob();
    const obj = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = obj; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(obj), 4000);
  } catch { window.open(fileUrl, "_blank"); }
}

interface GalleryItem {
  id: string;
  type: "image" | "video";
  label: string;
  src: string;
  filename: string;
}

function buildItems(orders: Order[], design: string): GalleryItem[] {
  const items: GalleryItem[] = [];
  orders.forEach(o => {
    if (o.cadImage) items.push({ id: `${o.id}-cad`, type: "image", label: "CAD Design", src: o.cadImage, filename: `${design}-cad.jpg` });
    (o.productPhotos ?? []).forEach((p, i) =>
      items.push({ id: `${o.id}-photo-${i}`, type: "image", label: `Photo ${i + 1}`, src: p, filename: `${design}-photo-${i + 1}.jpg` }));
    if (o.productVideo) items.push({ id: `${o.id}-video`, type: "video", label: "Video", src: o.productVideo, filename: `${design}-video.mp4` });
  });
  return items;
}

/* Folder card — used for both the category level and the design-number level. */
function FolderCard({ label, sub, cover, onClick }: { label: string; sub?: string; cover?: string; onClick(): void }) {
  return (
    <motion.button
      whileTap={{ scale: 0.97 }}
      onClick={onClick}
      className="flex flex-col rounded-2xl border border-border/60 active:border-primary/40 bg-white shadow-sm overflow-hidden text-left"
    >
      <div className="aspect-video w-full bg-gradient-to-br from-fuchsia-50 to-fuchsia-100 overflow-hidden relative">
        {cover ? (
          <img src={cover} alt="" className="w-full h-full object-cover" />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center"><Folder className="h-10 w-10 text-fuchsia-300" /></div>
        )}
      </div>
      <div className="px-3 pt-2.5 pb-1 flex items-center gap-2">
        <Folder className="h-3.5 w-3.5 text-fuchsia-500 shrink-0" />
        <span className="text-sm font-medium text-foreground truncate">{label}</span>
      </div>
      {sub && <div className="px-3 pb-2.5 text-[11px] text-muted-foreground truncate">{sub}</div>}
    </motion.button>
  );
}

/* Gallery item card — image/video thumbnail with a type badge, matching Catalog's item cards. */
function ItemCard({ item, onOpen, onDownload }: { item: GalleryItem; onOpen(): void; onDownload(): void }) {
  return (
    <motion.div whileTap={{ scale: 0.97 }} className="relative rounded-2xl overflow-hidden border border-border/60 bg-white shadow-sm flex flex-col">
      <button onClick={onOpen} className="block w-full aspect-square bg-secondary/30 overflow-hidden relative">
        {item.type === "image" ? (
          <img src={item.src} alt={item.label} loading="lazy" decoding="async" className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-slate-100 to-slate-200">
            <Video className="h-10 w-10 text-slate-400" />
          </div>
        )}
        {item.type === "video" && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="h-12 w-12 rounded-full bg-black/40 flex items-center justify-center">
              <Play className="h-6 w-6 text-white ml-0.5" />
            </div>
          </div>
        )}
        <div className="absolute top-2 left-2">
          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-black/50 text-white backdrop-blur-sm">
            {item.type === "video" ? <Video className="h-2.5 w-2.5" /> : <ImageIcon className="h-2.5 w-2.5" />}
            {item.type}
          </span>
        </div>
        <button
          onClick={e => { e.stopPropagation(); onDownload(); }}
          className="absolute top-2 right-2 h-8 w-8 rounded-lg bg-white/90 border border-border/60 grid place-items-center text-muted-foreground hover:text-primary active:text-primary shadow-sm"
          aria-label="Download"
        >
          <Download className="h-3.5 w-3.5" />
        </button>
      </button>
      <div className="px-2.5 pt-2 pb-1.5">
        <p className="text-[11px] text-foreground font-medium truncate">{item.label}</p>
      </div>
    </motion.div>
  );
}

/* Lightbox with prev/next — mirrors Catalog's Lightbox. */
function Lightbox({ items, startIndex, onClose }: { items: GalleryItem[]; startIndex: number; onClose(): void }) {
  const [idx, setIdx] = useState(startIndex);
  const [dir, setDir] = useState(0);
  const item = items[idx];
  const hasPrev = idx > 0;
  const hasNext = idx < items.length - 1;

  const prev = () => { if (hasPrev) { setDir(-1); setIdx(i => i - 1); } };
  const next = () => { if (hasNext) { setDir(1); setIdx(i => i + 1); } };

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowLeft") prev();
      if (e.key === "ArrowRight") next();
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idx]);

  if (!item) return null;

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-[60] bg-black/96 flex flex-col"
      style={{ paddingTop: "env(safe-area-inset-top)", paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <div className="flex items-center justify-between px-4 py-3 shrink-0 gap-3">
        <p className="text-white/80 text-sm font-medium truncate">
          {item.label}
          {items.length > 1 && <span className="ml-2 text-white/40 text-xs">{idx + 1} / {items.length}</span>}
        </p>
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={() => downloadOne(item.src, item.filename)}
            className="h-10 w-10 rounded-full bg-white/10 active:bg-white/20 flex items-center justify-center text-white"
          >
            <Download className="h-5 w-5" />
          </button>
          <button onClick={onClose} className="h-10 w-10 rounded-full bg-white/10 active:bg-white/20 flex items-center justify-center text-white">
            <X className="h-5 w-5" />
          </button>
        </div>
      </div>

      <div className="flex-1 flex items-center min-h-0 relative">
        {hasPrev && (
          <button onClick={prev} className="absolute left-2 z-10 h-11 w-11 rounded-full bg-white/10 active:bg-white/20 flex items-center justify-center text-white">
            <ChevronLeft className="h-6 w-6" />
          </button>
        )}
        <AnimatePresence mode="wait" custom={dir}>
          <motion.div
            key={item.id}
            custom={dir}
            initial={{ opacity: 0, x: dir * 60 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: dir * -60 }}
            transition={{ duration: 0.22, ease: "easeOut" }}
            className="flex-1 flex items-center justify-center px-14 h-full min-h-0"
          >
            {item.type === "image" ? (
              <img src={item.src} alt={item.label} className="max-w-full max-h-full object-contain rounded-xl select-none" style={{ maxHeight: "calc(100vh - 140px)" }} onClick={onClose} />
            ) : (
              <video src={item.src} controls autoPlay playsInline className="max-w-full rounded-xl" style={{ maxHeight: "calc(100vh - 140px)" }} />
            )}
          </motion.div>
        </AnimatePresence>
        {hasNext && (
          <button onClick={next} className="absolute right-2 z-10 h-11 w-11 rounded-full bg-white/10 active:bg-white/20 flex items-center justify-center text-white">
            <ChevronRight className="h-6 w-6" />
          </button>
        )}
      </div>
    </motion.div>
  );
}

export function ProductPhotosPage() {
  const { user } = useAuth();
  const db = useDb();
  const [category, setCategory] = useState<string | null>(null);
  const [design, setDesign] = useState<string | null>(null);
  const [lightbox, setLightbox] = useState<{ idx: number } | null>(null);
  const [downloading, setDownloading] = useState(false);

  if (user!.role === "client") {
    const client = db.clients.find(c => c.id === user!.clientId);
    if (!client?.productPhotoAccess) {
      return (
        <div className="max-w-2xl mx-auto">
          <div className="card-luxe p-10 text-center text-muted-foreground">
            <Camera className="h-10 w-10 mx-auto mb-3 opacity-30" />
            <p className="font-medium text-foreground">Product Photos isn't available for your account yet</p>
            <p className="text-sm mt-1">Contact Starlink to get access.</p>
          </div>
        </div>
      );
    }
  }

  const isStaff = user!.role !== "client";

  const mediaOrders = currentUserOrders(db, user!).filter(
    o => (o.productPhotos?.length ?? 0) > 0 || !!o.productVideo || !!o.cadImage,
  );

  // Level 1 — one folder per jewellery category the client picked at order time.
  const categoryMap = new Map<string, Order[]>();
  mediaOrders.forEach(o => {
    const cat = o.jewelleryType || "Other";
    if (!categoryMap.has(cat)) categoryMap.set(cat, []);
    categoryMap.get(cat)!.push(o);
  });
  const categories = [...categoryMap.entries()]
    .map(([name, orders]) => ({ name, orders }))
    .sort((a, b) => a.name.localeCompare(b.name));

  // Level 2 — one folder per design number within the selected category.
  const designMap = new Map<string, Order[]>();
  if (category) {
    (categoryMap.get(category) ?? []).forEach(o => {
      const d = (o.designNumber || o.orderNumber || "Unlabelled").trim();
      if (!designMap.has(d)) designMap.set(d, []);
      designMap.get(d)!.push(o);
    });
  }
  const designs = [...designMap.entries()]
    .map(([name, orders]) => ({ name, orders }))
    .sort((a, b) => a.name.localeCompare(b.name));

  // Level 3 — the gallery inside a design folder.
  const designOrders = design ? (designMap.get(design) ?? []) : [];
  const items = design ? buildItems(designOrders, design) : [];

  const goRoot = () => { setCategory(null); setDesign(null); };
  const goCategory = () => setDesign(null);

  const downloadAll = async (list: GalleryItem[]) => {
    setDownloading(true);
    try { for (const it of list) await downloadOne(it.src, it.filename); } finally { setDownloading(false); }
  };

  return (
    <div className="max-w-6xl mx-auto space-y-5">
      <div>
        <h1 className="font-display text-2xl md:text-3xl text-brand-dark">Product Photos</h1>
        <nav className="flex items-center gap-1 flex-wrap text-sm mt-1 min-w-0">
          <button onClick={goRoot} className={`font-medium shrink-0 ${!category ? "text-brand-dark" : "text-primary hover:underline"}`}>
            Product Photos
          </button>
          {category && (
            <span className="flex items-center gap-1 min-w-0">
              <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              <button onClick={goCategory} className={`font-medium truncate ${!design ? "text-brand-dark" : "text-primary hover:underline"}`}>
                {category}
              </button>
            </span>
          )}
          {design && (
            <span className="flex items-center gap-1 min-w-0">
              <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              <span className="font-medium text-brand-dark truncate">{design}</span>
            </span>
          )}
        </nav>
      </div>

      {/* Root — category folders */}
      {!category && (
        categories.length === 0 ? (
          <div className="card-luxe p-12 text-center text-muted-foreground">
            <Camera className="h-10 w-10 mx-auto mb-3 opacity-20" />
            <p>No product photos yet.</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3 sm:gap-4">
            {categories.map(cat => {
              const designCount = new Set(cat.orders.map(o => (o.designNumber || o.orderNumber || "Unlabelled").trim())).size;
              const cover = cat.orders.flatMap(o => o.productPhotos ?? [])[0] ?? cat.orders.find(o => o.cadImage)?.cadImage;
              return (
                <FolderCard
                  key={cat.name}
                  label={cat.name}
                  sub={`${designCount} design${designCount !== 1 ? "s" : ""}`}
                  cover={cover}
                  onClick={() => setCategory(cat.name)}
                />
              );
            })}
          </div>
        )
      )}

      {/* Category level — design-number folders */}
      {category && !design && (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3 sm:gap-4">
          {designs.map(d => {
            const cover = d.orders.flatMap(o => o.productPhotos ?? [])[0] ?? d.orders.find(o => o.cadImage)?.cadImage;
            const clientNames = isStaff
              ? [...new Set(d.orders.map(o => db.clients.find(c => c.id === o.clientId)?.companyName).filter(Boolean))]
              : [];
            return (
              <FolderCard
                key={d.name}
                label={d.name}
                sub={clientNames.length > 0 ? clientNames.join(", ") : undefined}
                cover={cover}
                onClick={() => setDesign(d.name)}
              />
            );
          })}
        </div>
      )}

      {/* Design level — item gallery */}
      {category && design && (
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="min-w-0">
              {isStaff && (
                <p className="text-xs text-muted-foreground truncate">
                  {designOrders.map(o => o.orderNumber).join(", ")}
                  {" · "}
                  {[...new Set(designOrders.map(o => db.clients.find(c => c.id === o.clientId)?.companyName).filter(Boolean))].join(", ")}
                </p>
              )}
            </div>
            {items.length > 0 && (
              <button
                onClick={() => downloadAll(items)} disabled={downloading}
                className="flex items-center gap-1.5 h-9 px-3 rounded-xl border border-border text-xs font-medium hover:bg-secondary disabled:opacity-60 shrink-0"
              >
                <Download className="h-3.5 w-3.5" /> {downloading ? "Downloading…" : "Download All"}
              </button>
            )}
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3 sm:gap-4">
            {items.map((item, i) => (
              <ItemCard key={item.id} item={item} onOpen={() => setLightbox({ idx: i })} onDownload={() => downloadOne(item.src, item.filename)} />
            ))}
          </div>
        </div>
      )}

      <AnimatePresence>
        {lightbox && <Lightbox items={items} startIndex={lightbox.idx} onClose={() => setLightbox(null)} />}
      </AnimatePresence>
    </div>
  );
}
