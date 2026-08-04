import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useAuth } from "@/lib/auth";
import { updateDb, uid, currentUserOrders, type CatalogFolder, type ProductPhotoItem, type Order } from "@/lib/db";
import { useDb } from "@/hooks/useDb";
import { uploadDataUrl, uploadFile, deleteByUrl } from "@/lib/storage";
import { ShareFolderButton } from "@/components/ShareFolderButton";
import { toast } from "sonner";
import { Folder, ChevronRight, Image as ImageIcon, Video, Play, Download, X, Camera, ChevronLeft, FolderPlus, ImagePlus, Trash2, Pencil, Loader2, Check, Package } from "lucide-react";

const MAX_VIDEO_MB = 60;

/** Compress an image File to a base64 JPEG, capped at ~1400px. */
async function compressImage(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = e => {
      const img = new Image();
      img.onerror = reject;
      img.onload = () => {
        const MAX = 1400;
        let w = img.width, h = img.height;
        if (w > MAX || h > MAX) { if (w > h) { h = Math.round(h * MAX / w); w = MAX; } else { w = Math.round(w * MAX / h); h = MAX; } }
        const canvas = document.createElement("canvas");
        canvas.width = w; canvas.height = h;
        canvas.getContext("2d")!.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL("image/jpeg", 0.85));
      };
      img.src = e.target!.result as string;
    };
    reader.readAsDataURL(file);
  });
}

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

interface GalleryItem { id: string; type: "image" | "video"; label: string; src: string; filename: string; }

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
          <Folder className="h-3.5 w-3.5 text-fuchsia-500 shrink-0" />
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

function ItemCard({ item, onOpen, onDownload, onDelete }: { item: GalleryItem; onOpen(): void; onDownload(): void; onDelete?(): void }) {
  return (
    <motion.div whileTap={{ scale: 0.97 }} className="relative rounded-2xl overflow-hidden border border-border/60 bg-white shadow-sm flex flex-col group">
      <button onClick={onOpen} className="block w-full aspect-square bg-secondary/30 overflow-hidden relative">
        {item.type === "image"
          ? <img src={item.src} alt={item.label} loading="lazy" decoding="async" className="w-full h-full object-cover" />
          : <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-slate-100 to-slate-200"><Video className="h-10 w-10 text-slate-400" /></div>}
        {item.type === "video" && <div className="absolute inset-0 flex items-center justify-center"><div className="h-12 w-12 rounded-full bg-black/40 flex items-center justify-center"><Play className="h-6 w-6 text-white ml-0.5" /></div></div>}
        <div className="absolute top-2 left-2"><span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-black/50 text-white backdrop-blur-sm">{item.type === "video" ? <Video className="h-2.5 w-2.5" /> : <ImageIcon className="h-2.5 w-2.5" />}{item.type}</span></div>
        <button onClick={e => { e.stopPropagation(); onDownload(); }} className="absolute top-2 right-2 h-8 w-8 rounded-lg bg-white/90 border border-border/60 grid place-items-center text-muted-foreground hover:text-primary shadow-sm" aria-label="Download"><Download className="h-3.5 w-3.5" /></button>
        {onDelete && <button onClick={e => { e.stopPropagation(); onDelete(); }} className="absolute bottom-2 right-2 h-8 w-8 rounded-lg bg-white/90 border border-border/60 grid place-items-center text-destructive hover:bg-destructive/10 shadow-sm opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity" aria-label="Delete"><Trash2 className="h-3.5 w-3.5" /></button>}
      </button>
      <div className="px-2.5 pt-2 pb-1.5"><p className="text-[11px] text-foreground font-medium truncate">{item.label}</p></div>
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
              : <video src={item.src} controls autoPlay playsInline className="max-w-full rounded-xl" style={{ maxHeight: "calc(100vh - 140px)" }} />}
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

  const downloadAll = async () => { setDownloading(true); try { for (const it of items) await downloadOne(it.src, it.filename); } finally { setDownloading(false); } };

  return (
    <div className="space-y-4">
      <nav className="flex items-center gap-1 flex-wrap text-sm min-w-0">
        <button onClick={() => { setCategory(null); setDesign(null); }} className={`font-medium shrink-0 ${!category ? "text-brand-dark" : "text-primary hover:underline"}`}>All orders</button>
        {category && <span className="flex items-center gap-1 min-w-0"><ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" /><button onClick={() => setDesign(null)} className={`font-medium truncate ${!design ? "text-brand-dark" : "text-primary hover:underline"}`}>{category}</button></span>}
        {design && <span className="flex items-center gap-1 min-w-0"><ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" /><span className="font-medium text-brand-dark truncate">{design}</span></span>}
      </nav>

      {!category && (categories.length === 0
        ? <div className="card-luxe p-12 text-center text-muted-foreground"><Camera className="h-10 w-10 mx-auto mb-3 opacity-20" /><p>No order photos yet. Photos uploaded on a dispatched order appear here automatically.</p></div>
        : <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3 sm:gap-4">
            {categories.map(cat => {
              const designCount = new Set(cat.orders.map(o => (o.designNumber || o.orderNumber || "Unlabelled").trim())).size;
              const cover = cat.orders.flatMap(o => o.productPhotos ?? [])[0] ?? cat.orders.find(o => o.cadImage)?.cadImage;
              return <FolderCard key={cat.name} label={cat.name} sub={`${designCount} design${designCount !== 1 ? "s" : ""}`} cover={cover} onClick={() => setCategory(cat.name)} />;
            })}
          </div>)}

      {category && !design && (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3 sm:gap-4">
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
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3 sm:gap-4">
            {items.map((item, i) => <ItemCard key={item.id} item={item} onOpen={() => setLightbox(i)} onDownload={() => downloadOne(item.src, item.filename)} />)}
          </div>
        </div>
      )}

      <AnimatePresence>{lightbox !== null && <Lightbox items={items} startIndex={lightbox} onClose={() => setLightbox(null)} />}</AnimatePresence>
    </div>
  );
}

/* ══════════════════════════ MANUAL LIBRARY VIEW ══════════════════════════ */
/* Staff-built: create category folders → product folders → upload images/videos. */
function LibraryView({ isStaff }: { isStaff: boolean }) {
  const { user } = useAuth();
  const db = useDb();
  const [currentFolderId, setCurrentFolderId] = useState<string | null>(null);
  const [showNewFolder, setShowNewFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameVal, setRenameVal] = useState("");
  const [uploading, setUploading] = useState(false);
  const [videoUploading, setVideoUploading] = useState(false);
  const [lightbox, setLightbox] = useState<number | null>(null);
  const [downloading, setDownloading] = useState(false);
  const imgRef = useRef<HTMLInputElement>(null);
  const vidRef = useRef<HTMLInputElement>(null);

  const folders = db.productPhotoFolders ?? [];
  const allItems = db.productPhotoItems ?? [];
  const subfolders = folders.filter(f => (f.parentId ?? null) === currentFolderId).sort((a, b) => a.name.localeCompare(b.name));
  const folderItems = allItems.filter(i => i.folderId === currentFolderId).sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));

  const path: CatalogFolder[] = [];
  { let cur = currentFolderId; while (cur) { const f = folders.find(x => x.id === cur); if (!f) break; path.unshift(f); cur = f.parentId ?? null; } }

  const gallery: GalleryItem[] = folderItems.map(it => ({ id: it.id, type: it.type, label: it.name, src: it.url, filename: `${it.name || "media"}.${it.type === "video" ? "mp4" : "jpg"}` }));
  const coverFor = (folderId: string) => allItems.find(i => i.folderId === folderId && i.type === "image")?.url;
  const childCount = (folderId: string) => folders.filter(f => (f.parentId ?? null) === folderId).length;
  const mediaCount = (folderId: string) => allItems.filter(i => i.folderId === folderId).length;

  const createFolder = () => {
    const name = newFolderName.trim();
    if (!name) return;
    updateDb(d => { if (!d.productPhotoFolders) d.productPhotoFolders = []; d.productPhotoFolders.push({ id: uid("ppf_"), name, parentId: currentFolderId ?? null, createdBy: user!.id, createdAt: new Date().toISOString() }); });
    setNewFolderName(""); setShowNewFolder(false); toast.success("Folder created");
  };
  const renameFolder = (id: string) => { const val = renameVal.trim(); if (!val) { setRenamingId(null); return; } updateDb(d => { const f = d.productPhotoFolders.find(x => x.id === id); if (f) f.name = val; }); setRenamingId(null); };

  const descendantIds = (rootId: string): string[] => { const out = [rootId]; const stack = [rootId]; while (stack.length) { const cur = stack.pop()!; for (const f of folders) if ((f.parentId ?? null) === cur) { out.push(f.id); stack.push(f.id); } } return out; };
  const deleteFolder = async (id: string) => {
    const f = folders.find(x => x.id === id);
    if (!confirm(`Delete folder "${f?.name}" and everything inside it?`)) return;
    const ids = descendantIds(id);
    const removed = allItems.filter(i => ids.includes(i.folderId));
    updateDb(d => { d.productPhotoFolders = d.productPhotoFolders.filter(x => !ids.includes(x.id)); d.productPhotoItems = d.productPhotoItems.filter(i => !ids.includes(i.folderId)); });
    for (const it of removed) await deleteByUrl(it.url);
    toast.success("Folder deleted");
  };

  const uploadImages = async (files: FileList) => {
    if (!currentFolderId) return;
    const imgs = Array.from(files).filter(f => f.type.startsWith("image/"));
    if (!imgs.length) { toast.error("Please choose image files"); return; }
    setUploading(true);
    try {
      const urls = await Promise.all(imgs.map(async f => uploadDataUrl(await compressImage(f), `productPhotos/${currentFolderId}`)));
      updateDb(d => { urls.forEach((u, i) => d.productPhotoItems.unshift({ id: uid("ppi_"), folderId: currentFolderId, name: imgs[i].name.replace(/\.[^.]+$/, "").slice(0, 60) || "Image", type: "image", url: u, createdBy: user!.id, createdAt: new Date().toISOString() } as ProductPhotoItem)); });
      toast.success(`${urls.length} image${urls.length !== 1 ? "s" : ""} uploaded`);
    } catch { toast.error("Failed to upload images"); }
    setUploading(false);
  };
  const uploadVideo = async (file: File) => {
    if (!currentFolderId) return;
    if (!file.type.startsWith("video/")) { toast.error("Please choose a video file"); return; }
    if (file.size > MAX_VIDEO_MB * 1024 * 1024) { toast.error(`Video too large — keep it under ${MAX_VIDEO_MB} MB`); return; }
    setVideoUploading(true);
    try {
      const url = await uploadFile(file, `productPhotos/${currentFolderId}`);
      updateDb(d => d.productPhotoItems.unshift({ id: uid("ppi_"), folderId: currentFolderId, name: file.name.replace(/\.[^.]+$/, "").slice(0, 60) || "Video", type: "video", url, createdBy: user!.id, createdAt: new Date().toISOString() } as ProductPhotoItem));
      toast.success("Video uploaded");
    } catch { toast.error("Failed to upload the video"); }
    setVideoUploading(false);
  };
  const deleteItem = async (id: string) => { const it = allItems.find(x => x.id === id); updateDb(d => { d.productPhotoItems = d.productPhotoItems.filter(x => x.id !== id); }); if (it) await deleteByUrl(it.url); };
  const downloadAll = async () => { setDownloading(true); try { for (const it of gallery) await downloadOne(it.src, it.filename); } finally { setDownloading(false); } };

  const goTo = (id: string | null) => { setCurrentFolderId(id); setShowNewFolder(false); setRenamingId(null); };
  const atRoot = currentFolderId === null;

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <nav className="flex items-center gap-1 flex-wrap text-sm min-w-0">
          <button onClick={() => goTo(null)} className={`font-medium shrink-0 ${atRoot ? "text-brand-dark" : "text-primary hover:underline"}`}>Library</button>
          {path.map((f, i) => (
            <span key={f.id} className="flex items-center gap-1 min-w-0">
              <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              <button onClick={() => goTo(f.id)} className={`font-medium truncate ${i === path.length - 1 ? "text-brand-dark" : "text-primary hover:underline"}`}>{f.name}</button>
            </span>
          ))}
        </nav>

        {isStaff && (
          <div className="flex items-center gap-2 shrink-0 flex-wrap">
            <button onClick={() => { setShowNewFolder(v => !v); setNewFolderName(""); }} className="flex items-center gap-1.5 h-9 px-3 rounded-xl border border-border bg-white hover:bg-secondary text-xs font-medium text-brand-dark"><FolderPlus className="h-4 w-4" /> {atRoot ? "New Category" : "New Folder"}</button>
            {!atRoot && currentFolderId && (
              <>
                <input ref={imgRef} type="file" accept="image/*" multiple className="hidden" onChange={async e => { if (e.target.files?.length) await uploadImages(e.target.files); e.target.value = ""; }} />
                <button onClick={() => imgRef.current?.click()} disabled={uploading} className="flex items-center gap-1.5 h-9 px-3 rounded-xl btn-hero text-xs font-medium disabled:opacity-60">{uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImagePlus className="h-4 w-4" />} {uploading ? "Uploading…" : "Add Images"}</button>
                <input ref={vidRef} type="file" accept="video/*" className="hidden" onChange={async e => { const f = e.target.files?.[0]; if (f) await uploadVideo(f); e.target.value = ""; }} />
                <button onClick={() => vidRef.current?.click()} disabled={videoUploading} className="flex items-center gap-1.5 h-9 px-3 rounded-xl border border-border bg-white hover:bg-secondary text-xs font-medium text-brand-dark disabled:opacity-60">{videoUploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Video className="h-4 w-4" />} {videoUploading ? "Uploading…" : "Add Video"}</button>
                <ShareFolderButton kind="productPhotos" folderId={currentFolderId} folderName={path[path.length - 1]?.name ?? "Folder"} compact />
              </>
            )}
          </div>
        )}
      </div>

      {isStaff && showNewFolder && (
        <div className="card-luxe p-3 flex items-center gap-2">
          <FolderPlus className="h-4 w-4 text-fuchsia-500 shrink-0" />
          <input autoFocus value={newFolderName} onChange={e => setNewFolderName(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") createFolder(); if (e.key === "Escape") setShowNewFolder(false); }}
            placeholder={atRoot ? "Category name (e.g. Rings, Necklaces)" : "Folder name (e.g. product ID / design number)"}
            className="flex-1 h-10 rounded-xl border border-border bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" />
          <button onClick={createFolder} className="h-10 px-4 rounded-xl btn-hero text-sm font-medium">Create</button>
          <button onClick={() => setShowNewFolder(false)} className="h-10 w-10 rounded-xl border border-border grid place-items-center text-muted-foreground"><X className="h-4 w-4" /></button>
        </div>
      )}

      {gallery.length > 0 && (
        <div className="flex justify-end">
          <button onClick={downloadAll} disabled={downloading} className="flex items-center gap-1.5 h-9 px-3 rounded-xl border border-border text-xs font-medium hover:bg-secondary disabled:opacity-60"><Download className="h-3.5 w-3.5" /> {downloading ? "Downloading…" : "Download All"}</button>
        </div>
      )}

      {subfolders.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3 sm:gap-4">
          {subfolders.map(f => {
            const kids = childCount(f.id), media = mediaCount(f.id);
            const sub = [kids > 0 ? `${kids} folder${kids !== 1 ? "s" : ""}` : "", media > 0 ? `${media} item${media !== 1 ? "s" : ""}` : ""].filter(Boolean).join(" · ") || "Empty";
            return renamingId === f.id ? (
              <div key={f.id} className="rounded-2xl border border-primary/40 bg-white shadow-sm p-3 flex flex-col justify-center gap-2 aspect-[4/5]">
                <input autoFocus value={renameVal} onChange={e => setRenameVal(e.target.value)} onKeyDown={e => { if (e.key === "Enter") renameFolder(f.id); if (e.key === "Escape") setRenamingId(null); }} className="h-9 rounded-lg border border-border px-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" />
                <div className="flex gap-2"><button onClick={() => renameFolder(f.id)} className="flex-1 h-8 rounded-lg btn-hero text-xs font-medium flex items-center justify-center gap-1"><Check className="h-3.5 w-3.5" /> Save</button><button onClick={() => setRenamingId(null)} className="h-8 w-8 rounded-lg border border-border grid place-items-center text-muted-foreground"><X className="h-3.5 w-3.5" /></button></div>
              </div>
            ) : (
              <FolderCard key={f.id} label={f.name} sub={sub} cover={coverFor(f.id)} onClick={() => goTo(f.id)}
                onRename={isStaff ? () => { setRenamingId(f.id); setRenameVal(f.name); } : undefined}
                onDelete={isStaff ? () => deleteFolder(f.id) : undefined} />
            );
          })}
        </div>
      )}

      {gallery.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3 sm:gap-4">
          {gallery.map((item, i) => <ItemCard key={item.id} item={item} onOpen={() => setLightbox(i)} onDownload={() => downloadOne(item.src, item.filename)} onDelete={isStaff ? () => deleteItem(item.id) : undefined} />)}
        </div>
      )}

      {subfolders.length === 0 && gallery.length === 0 && (
        <div className="card-luxe p-12 text-center text-muted-foreground">
          <Camera className="h-10 w-10 mx-auto mb-3 opacity-20" />
          {isStaff
            ? atRoot
              ? <p>No categories yet. Tap <span className="font-medium text-foreground">New Category</span> to create one (e.g. Rings), then add product folders and upload photos/videos inside.</p>
              : <p>This folder is empty. Create a <span className="font-medium text-foreground">product folder</span> inside, or use <span className="font-medium text-foreground">Add Images</span> / <span className="font-medium text-foreground">Add Video</span> to upload here.</p>
            : <p>No product photos here yet.</p>}
        </div>
      )}

      <AnimatePresence>{lightbox !== null && <Lightbox items={gallery} startIndex={lightbox} onClose={() => setLightbox(null)} />}</AnimatePresence>
    </div>
  );
}

export function ProductPhotosPage() {
  const { user } = useAuth();
  const db = useDb();
  const isStaff = user!.role !== "client";
  const [tab, setTab] = useState<"orders" | "library">("orders");

  if (user!.role === "client") {
    const client = db.clients.find(c => c.id === user!.clientId);
    if (!client?.productPhotoAccess) {
      return (
        <div className="max-w-2xl mx-auto">
          <div className="card-luxe p-10 text-center text-muted-foreground">
            <Camera className="h-10 w-10 mx-auto mb-3 opacity-30" />
            <p className="font-medium text-foreground">Product Photos isn't available for your account yet</p>
            <p className="text-sm mt-1">Contact Flenix to get access.</p>
          </div>
        </div>
      );
    }
  }

  return (
    <div className="max-w-6xl mx-auto space-y-5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h1 className="font-display text-2xl md:text-3xl text-brand-dark">Product Photos</h1>
      </div>

      {/* Tab switcher — auto order photos vs the manually-organised library */}
      <div className="inline-flex items-center gap-0.5 p-0.5 rounded-xl bg-secondary border border-border/60">
        <button onClick={() => setTab("orders")}
          className={`flex items-center gap-1.5 h-9 px-3.5 rounded-lg text-sm font-medium transition-colors ${tab === "orders" ? "bg-white text-brand-dark shadow-soft" : "text-muted-foreground hover:text-foreground"}`}>
          <Package className="h-4 w-4" /> By Order
        </button>
        <button onClick={() => setTab("library")}
          className={`flex items-center gap-1.5 h-9 px-3.5 rounded-lg text-sm font-medium transition-colors ${tab === "library" ? "bg-white text-brand-dark shadow-soft" : "text-muted-foreground hover:text-foreground"}`}>
          <Folder className="h-4 w-4" /> Library
        </button>
      </div>

      {tab === "orders" ? <OrdersView isStaff={isStaff} /> : <LibraryView isStaff={isStaff} />}
    </div>
  );
}
