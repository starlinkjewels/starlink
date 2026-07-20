import { useState, useRef, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  FolderOpen, Folder, Plus, Trash2, Upload, X, Play,
  ChevronRight, Edit2, Check, AlertCircle, Image as ImageIcon,
  Video, Download, MoreVertical, ChevronLeft, Heart,
} from "lucide-react";
import { loadDb, updateDb, uid } from "@/lib/db";
import type { CatalogFolder, CatalogItem } from "@/lib/db";
import { useAuth } from "@/lib/auth";

/* ─────────────────────────────────────────────────────────────── */
/*  Helpers                                                        */
/* ─────────────────────────────────────────────────────────────── */
const MAX_IMAGE_PX = 1200;
const MAX_FILE_MB  = 15;

function compressImage(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img  = new window.Image();
    img.onload = () => {
      const scale = Math.min(1, MAX_IMAGE_PX / Math.max(img.width, img.height));
      const w = Math.round(img.width  * scale);
      const h = Math.round(img.height * scale);
      const canvas = document.createElement("canvas");
      canvas.width = w; canvas.height = h;
      canvas.getContext("2d")!.drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL("image/jpeg", 0.82));
    };
    img.onerror = reject;
    img.src = url;
  });
}

function readAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload  = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/* ─────────────────────────────────────────────────────────────── */
/*  Heart button — shared by item cards & favorites section       */
/* ─────────────────────────────────────────────────────────────── */
function HeartBtn({ active, onToggle }: { active: boolean; onToggle(e: React.MouseEvent): void }) {
  return (
    <button
      onClick={onToggle}
      className={`h-8 w-8 rounded-lg border grid place-items-center shadow-sm transition-colors
        ${active
          ? "bg-rose-50 border-rose-200 text-rose-500"
          : "bg-white/90 border-border/60 text-muted-foreground hover:text-rose-400 active:text-rose-500"}`}
      title={active ? "Remove from favorites" : "Add to favorites"}
    >
      <Heart className={`h-3.5 w-3.5 ${active ? "fill-rose-500" : ""}`} />
    </button>
  );
}

/* ─────────────────────────────────────────────────────────────── */
/*  Lightbox  (with prev / next)                                   */
/* ─────────────────────────────────────────────────────────────── */
function Lightbox({
  items, startIndex, onClose,
}: {
  items: CatalogItem[];
  startIndex: number;
  onClose: () => void;
}) {
  const [idx, setIdx] = useState(startIndex);
  const [dir, setDir] = useState(0);

  const item    = items[idx];
  const hasPrev = idx > 0;
  const hasNext = idx < items.length - 1;

  function prev() { if (hasPrev) { setDir(-1); setIdx(i => i - 1); } }
  function next() { if (hasNext) { setDir(1);  setIdx(i => i + 1); } }

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === "Escape")     onClose();
      if (e.key === "ArrowLeft")  prev();
      if (e.key === "ArrowRight") next();
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idx]);

  if (!item) return null;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[60] bg-black/96 flex flex-col"
      style={{ paddingTop: "env(safe-area-inset-top)", paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      {/* Top bar */}
      <div className="flex items-center justify-between px-4 py-3 shrink-0 gap-3">
        <p className="text-white/80 text-sm font-medium truncate">
          {item.name}
          {items.length > 1 && <span className="ml-2 text-white/40 text-xs">{idx + 1} / {items.length}</span>}
        </p>
        <div className="flex items-center gap-2 shrink-0">
          <a href={item.data} download={item.name}
            className="h-10 w-10 rounded-full bg-white/10 active:bg-white/20 flex items-center justify-center text-white">
            <Download className="h-5 w-5" />
          </a>
          <button onClick={onClose}
            className="h-10 w-10 rounded-full bg-white/10 active:bg-white/20 flex items-center justify-center text-white">
            <X className="h-5 w-5" />
          </button>
        </div>
      </div>

      {/* Media + side arrows */}
      <div className="flex-1 flex items-center min-h-0 relative">
        {hasPrev && (
          <button onClick={prev}
            className="absolute left-2 z-10 h-11 w-11 rounded-full bg-white/10 active:bg-white/20 flex items-center justify-center text-white">
            <ChevronLeft className="h-6 w-6" />
          </button>
        )}
        <AnimatePresence mode="wait" custom={dir}>
          <motion.div
            key={item.id}
            custom={dir}
            initial={{ opacity: 0, x: dir * 60 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: dir * -60 }}
            transition={{ duration: 0.22, ease: "easeOut" }}
            className="flex-1 flex items-center justify-center px-14 h-full min-h-0"
          >
            {item.type === "image" ? (
              <img src={item.data} alt={item.name}
                className="max-w-full max-h-full object-contain rounded-xl select-none"
                style={{ maxHeight: "calc(100vh - 140px)" }}
                onClick={onClose}
              />
            ) : (
              <video src={item.data} controls autoPlay playsInline
                className="max-w-full rounded-xl"
                style={{ maxHeight: "calc(100vh - 140px)" }}
              />
            )}
          </motion.div>
        </AnimatePresence>
        {hasNext && (
          <button onClick={next}
            className="absolute right-2 z-10 h-11 w-11 rounded-full bg-white/10 active:bg-white/20 flex items-center justify-center text-white">
            <ChevronRight className="h-6 w-6" />
          </button>
        )}
      </div>

      {/* Thumbnail strip */}
      {items.length > 1 && (
        <div className="shrink-0 px-4 pb-3 pt-2 flex items-center gap-2 overflow-x-auto">
          {items.map((it, i) => (
            <button key={it.id}
              onClick={() => { setDir(i > idx ? 1 : -1); setIdx(i); }}
              className={`shrink-0 h-12 w-12 rounded-lg overflow-hidden border-2 transition-all
                ${i === idx ? "border-white scale-110" : "border-white/20 opacity-50"}`}>
              {it.type === "image"
                ? <img src={it.data} alt="" className="w-full h-full object-cover" />
                : <div className="w-full h-full bg-slate-700 flex items-center justify-center">
                    <Play className="h-4 w-4 text-white" />
                  </div>
              }
            </button>
          ))}
        </div>
      )}
    </motion.div>
  );
}

/* ─────────────────────────────────────────────────────────────── */
/*  Folder action menu                                             */
/* ─────────────────────────────────────────────────────────────── */
function FolderMenu({ onRename, onDelete }: { onRename(): void; onDelete(): void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [open]);

  return (
    <div className="relative" ref={ref} onClick={e => e.stopPropagation()}>
      <button onClick={e => { e.stopPropagation(); setOpen(v => !v); }}
        className="h-8 w-8 rounded-xl bg-white/90 border border-border/60 grid place-items-center shadow-sm text-muted-foreground hover:text-foreground active:bg-secondary transition-colors">
        <MoreVertical className="h-4 w-4" />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, scale: 0.92, y: -4 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.92, y: -4 }}
            transition={{ duration: 0.12 }}
            className="absolute right-0 top-9 z-30 w-36 bg-white rounded-xl border border-border/60 shadow-lg overflow-hidden"
          >
            <button onClick={() => { setOpen(false); onRename(); }}
              className="w-full flex items-center gap-2 px-3 py-2.5 text-sm text-foreground hover:bg-secondary active:bg-secondary">
              <Edit2 className="h-3.5 w-3.5 text-muted-foreground" /> Rename
            </button>
            <button onClick={() => { setOpen(false); onDelete(); }}
              className="w-full flex items-center gap-2 px-3 py-2.5 text-sm text-destructive hover:bg-destructive/10 active:bg-destructive/10">
              <Trash2 className="h-3.5 w-3.5" /> Delete
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────── */
/*  Upload zone                                                    */
/* ─────────────────────────────────────────────────────────────── */
function UploadZone({ onFiles, uploading }: { onFiles(f: FileList): void; uploading?: boolean }) {
  const [dragging, setDragging] = useState(false);
  const ref = useRef<HTMLInputElement>(null);

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault(); setDragging(false);
    if (e.dataTransfer.files.length) onFiles(e.dataTransfer.files);
  };

  return (
    <div
      onDragOver={e => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
      onClick={() => !uploading && ref.current?.click()}
      className={`flex flex-col items-center justify-center gap-3 p-8 rounded-2xl border-2 border-dashed cursor-pointer transition-colors select-none
        ${dragging ? "border-primary bg-primary/5" : "border-border/60 hover:border-primary/50 hover:bg-secondary/30"}
        ${uploading ? "opacity-60 cursor-not-allowed" : ""}`}
    >
      <div className={`h-14 w-14 rounded-2xl grid place-items-center transition-colors ${dragging ? "bg-primary/10" : "bg-secondary"}`}>
        {uploading
          ? <span className="h-7 w-7 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
          : <Upload className={`h-7 w-7 ${dragging ? "text-primary" : "text-muted-foreground"}`} />}
      </div>
      <div className="text-center">
        <p className="text-sm font-semibold text-foreground">
          {uploading ? "Uploading…" : dragging ? "Drop to upload" : "Tap or drop to upload"}
        </p>
        <p className="text-xs text-muted-foreground mt-0.5">Images &amp; videos · max {MAX_FILE_MB} MB each</p>
      </div>
      <input ref={ref} type="file" accept="image/*,video/*" multiple className="hidden"
        onChange={e => { if (e.target.files) onFiles(e.target.files); e.target.value = ""; }} />
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────── */
/*  Reusable item card                                             */
/* ─────────────────────────────────────────────────────────────── */
function ItemCard({
  item, isFav, canEdit, folderName, onOpen, onToggleFav, onDelete,
}: {
  item: CatalogItem;
  isFav: boolean;
  canEdit: boolean;
  folderName?: string;
  onOpen(): void;
  onToggleFav(): void;
  onDelete?(): void;
}) {
  return (
    <motion.div whileTap={{ scale: 0.97 }}
      className="relative rounded-2xl overflow-hidden border border-border/60 bg-white shadow-sm flex flex-col">
      {/* Thumbnail */}
      <button onClick={onOpen} className="block w-full aspect-square bg-secondary/30 overflow-hidden relative">
        {item.type === "image"
          ? <img src={item.data} alt={item.name} className="w-full h-full object-cover" />
          : <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-slate-100 to-slate-200">
              <Video className="h-10 w-10 text-slate-400" />
            </div>
        }
        {item.type === "video" && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="h-12 w-12 rounded-full bg-black/40 flex items-center justify-center">
              <Play className="h-6 w-6 text-white ml-0.5" />
            </div>
          </div>
        )}
        {/* Type badge */}
        <div className="absolute top-2 left-2">
          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-black/50 text-white backdrop-blur-sm">
            {item.type === "video" ? <Video className="h-2.5 w-2.5" /> : <ImageIcon className="h-2.5 w-2.5" />}
            {item.type}
          </span>
        </div>
        {/* Delete (admin/employee) */}
        {canEdit && onDelete && (
          <button onClick={e => { e.stopPropagation(); onDelete(); }}
            className="absolute top-2 right-2 h-8 w-8 rounded-lg bg-white/90 border border-border/60 grid place-items-center text-muted-foreground hover:text-destructive active:text-destructive shadow-sm">
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        )}
      </button>

      {/* Bottom row: name + folder tag + heart */}
      <div className="flex items-center gap-1 px-2.5 pt-2 pb-1.5">
        <div className="flex-1 min-w-0">
          <p className="text-[11px] text-foreground font-medium truncate" title={item.name}>
            {item.name}
          </p>
          {folderName && (
            <p className="text-[10px] text-muted-foreground truncate flex items-center gap-0.5 mt-0.5">
              <Folder className="h-2.5 w-2.5 shrink-0 text-amber-500" />
              {folderName}
            </p>
          )}
        </div>
        <HeartBtn active={isFav} onToggle={e => { e.stopPropagation(); onToggleFav(); }} />
      </div>
    </motion.div>
  );
}

/* ─────────────────────────────────────────────────────────────── */
/*  Main page                                                      */
/* ─────────────────────────────────────────────────────────────── */
export function CatalogPage() {
  const { user } = useAuth();
  const canEdit = user?.role === "admin" || user?.role === "employee";

  const [folders,   setFolders]   = useState<CatalogFolder[]>([]);
  const [items,     setItems]     = useState<CatalogItem[]>([]);
  const [favIds,    setFavIds]    = useState<Set<string>>(new Set());

  // Navigation stack (empty = root)
  const [folderPath, setFolderPath] = useState<string[]>([]);
  const currentFolderId = folderPath.length > 0 ? folderPath[folderPath.length - 1] : null;

  const [viewingFavorites, setViewingFavorites] = useState(false);

  const [showNewFolder, setShowNewFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [renamingId,    setRenamingId]    = useState<string | null>(null);
  const [renameVal,     setRenameVal]     = useState("");
  const [lightbox,      setLightbox]      = useState<{ items: CatalogItem[]; idx: number } | null>(null);
  const [uploading,     setUploading]     = useState(false);
  const [error,         setError]         = useState<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  /* ── Load ── */
  const reload = useCallback(() => {
    const db = loadDb();
    setFolders(db.catalogFolders ?? []);
    setItems(db.catalogItems ?? []);
    const myFavs = (db.catalogFavorites ?? [])
      .filter(f => f.userId === user!.id)
      .map(f => f.itemId);
    setFavIds(new Set(myFavs));
  }, [user]);

  useEffect(() => {
    reload();
    window.addEventListener("starlink-db-updated", reload);
    return () => window.removeEventListener("starlink-db-updated", reload);
  }, [reload]);

  /* ── Derived ── */
  const subfolders    = folders.filter(f => (f.parentId ?? null) === currentFolderId);
  const currentItems  = currentFolderId ? items.filter(it => it.folderId === currentFolderId) : [];
  const breadcrumb    = folderPath.map(id => folders.find(f => f.id === id)).filter(Boolean) as CatalogFolder[];
  const favoriteItems = items.filter(it => favIds.has(it.id));
  const isRoot        = folderPath.length === 0 && !viewingFavorites;

  /* ── Navigation ── */
  function enterFolder(id: string) {
    setFolderPath(p => [...p, id]);
    setShowNewFolder(false);
    setViewingFavorites(false);
  }
  function navigateTo(idx: number) {
    setFolderPath(p => idx < 0 ? [] : p.slice(0, idx + 1));
    setShowNewFolder(false);
    setViewingFavorites(false);
  }
  function goToRoot() {
    setFolderPath([]);
    setShowNewFolder(false);
    setViewingFavorites(false);
  }

  /* ── Favorites ── */
  function toggleFavorite(itemId: string) {
    updateDb(db => {
      if (!db.catalogFavorites) db.catalogFavorites = [];
      const idx = db.catalogFavorites.findIndex(f => f.userId === user!.id && f.itemId === itemId);
      if (idx >= 0) db.catalogFavorites.splice(idx, 1);
      else          db.catalogFavorites.push({ userId: user!.id, itemId });
    });
    reload();
  }

  /* ── Folder CRUD ── */
  function createFolder() {
    const name = newFolderName.trim();
    if (!name) return;
    updateDb(db => {
      db.catalogFolders.push({
        id: uid("cf_"), name,
        parentId: currentFolderId ?? null,
        createdBy: user!.id,
        createdAt: new Date().toISOString(),
      });
    });
    setNewFolderName(""); setShowNewFolder(false);
  }

  function renameFolder(id: string) {
    const val = renameVal.trim();
    if (!val) return;
    updateDb(db => { const f = db.catalogFolders.find(f => f.id === id); if (f) f.name = val; });
    setRenamingId(null);
  }

  function descendantIds(id: string): string[] {
    const children = folders.filter(f => f.parentId === id).map(f => f.id);
    return [...children, ...children.flatMap(descendantIds)];
  }

  function deleteFolder(id: string) {
    const ids = [id, ...descendantIds(id)];
    updateDb(db => {
      db.catalogFolders   = db.catalogFolders.filter(f => !ids.includes(f.id));
      db.catalogItems     = db.catalogItems.filter(it => !ids.includes(it.folderId));
      db.catalogFavorites = db.catalogFavorites.filter(f => {
        const item = db.catalogItems.find(it => it.id === f.itemId);
        return item && !ids.includes(item.folderId);
      });
    });
    setDeleteConfirm(null);
    setFolderPath(p => {
      const cut = p.findIndex(x => ids.includes(x));
      return cut < 0 ? p : p.slice(0, cut);
    });
  }

  /* ── Upload ── */
  async function handleFiles(files: FileList) {
    if (!currentFolderId) return;
    setUploading(true); setError(null);
    try {
      for (const file of Array.from(files)) {
        const mb = file.size / 1024 / 1024;
        if (mb > MAX_FILE_MB) { setError(`"${file.name}" exceeds ${MAX_FILE_MB} MB — skipped.`); continue; }
        const isImage = file.type.startsWith("image/");
        const isVideo = file.type.startsWith("video/");
        if (!isImage && !isVideo) { setError(`"${file.name}" not supported — skipped.`); continue; }
        const data = isImage ? await compressImage(file) : await readAsBase64(file);
        updateDb(db => {
          db.catalogItems.push({
            id: uid("ci_"), folderId: currentFolderId,
            name: file.name, type: isImage ? "image" : "video",
            data, createdBy: user!.id, createdAt: new Date().toISOString(),
          });
        });
      }
    } catch { setError("Upload failed. Try a smaller file."); }
    finally { setUploading(false); reload(); }
  }

  function deleteItem(id: string) {
    updateDb(db => {
      db.catalogItems     = db.catalogItems.filter(it => it.id !== id);
      db.catalogFavorites = db.catalogFavorites.filter(f => f.itemId !== id);
    });
    setDeleteConfirm(null);
  }

  function totalItemCount(folderId: string): number {
    const ids = [folderId, ...descendantIds(folderId)];
    return items.filter(it => ids.includes(it.folderId)).length;
  }

  /* ─────────────── Breadcrumb ─────────────── */
  function Breadcrumb() {
    const atRoot = folderPath.length === 0 && !viewingFavorites;
    return (
      <nav className="flex items-center gap-1 flex-wrap text-sm min-w-0">
        <button
          onClick={goToRoot}
          className={`font-medium shrink-0 ${atRoot ? "text-brand-dark" : "text-primary active:underline"}`}
        >
          Catalog
        </button>
        {viewingFavorites && folderPath.length === 0 && (
          <span className="flex items-center gap-1 min-w-0">
            <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            <span className="font-medium text-brand-dark flex items-center gap-1">
              <Heart className="h-3.5 w-3.5 fill-rose-500 text-rose-500" /> Favourites
            </span>
          </span>
        )}
        {breadcrumb.map((f, i) => (
          <span key={f.id} className="flex items-center gap-1 min-w-0">
            <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            <button
              onClick={() => navigateTo(i)}
              className={`font-medium truncate max-w-[120px] sm:max-w-[200px]
                ${i === breadcrumb.length - 1 ? "text-brand-dark" : "text-primary active:underline"}`}
            >
              {f.name}
            </button>
          </span>
        ))}
      </nav>
    );
  }

  /* ─────────────── Folder grid ─────────────── */
  function FolderGrid() {
    if (subfolders.length === 0) return null;
    return (
      <div className="space-y-3">
        {!isRoot && (
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider px-0.5">
            Folders · {subfolders.length}
          </p>
        )}
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3 sm:gap-4">
          {subfolders.map(folder => {
            const count      = totalItemCount(folder.id);
            const thumb      = items.find(it => [folder.id, ...descendantIds(folder.id)].includes(it.folderId) && it.type === "image");
            const isRenaming = renamingId === folder.id;
            return (
              <motion.div key={folder.id} whileTap={{ scale: 0.97 }} className="relative">
                <button
                  onClick={() => { if (!isRenaming) enterFolder(folder.id); }}
                  className="w-full flex flex-col rounded-2xl border border-border/60 active:border-primary/40 bg-white shadow-sm overflow-hidden text-left"
                >
                  <div className="aspect-video w-full bg-gradient-to-br from-amber-50 to-amber-100 overflow-hidden relative">
                    {thumb
                      ? <img src={thumb.data} alt="" className="w-full h-full object-cover" />
                      : <div className="absolute inset-0 flex items-center justify-center"><Folder className="h-10 w-10 text-amber-400" /></div>}
                  </div>
                  <div className="px-3 pt-2.5 pb-1 flex items-center gap-2">
                    <Folder className="h-3.5 w-3.5 text-amber-500 shrink-0" />
                    {isRenaming ? (
                      <input autoFocus
                        className="flex-1 text-sm font-medium bg-transparent outline-none border-b border-primary min-w-0"
                        value={renameVal}
                        onChange={e => setRenameVal(e.target.value)}
                        onClick={e => e.stopPropagation()}
                        onKeyDown={e => {
                          if (e.key === "Enter")  { e.stopPropagation(); renameFolder(folder.id); }
                          if (e.key === "Escape") { e.stopPropagation(); setRenamingId(null); }
                        }}
                      />
                    ) : (
                      <span className="text-sm font-medium text-foreground truncate">{folder.name}</span>
                    )}
                  </div>
                  <div className="px-3 pb-2.5 text-[11px] text-muted-foreground">
                    {count} item{count !== 1 ? "s" : ""}
                  </div>
                </button>
                {canEdit && !isRenaming && (
                  <div className="absolute top-2 right-2">
                    <FolderMenu
                      onRename={() => { setRenamingId(folder.id); setRenameVal(folder.name); }}
                      onDelete={() => setDeleteConfirm(folder.id)}
                    />
                  </div>
                )}
                {isRenaming && (
                  <div className="absolute top-2 right-2 flex gap-1">
                    <button onClick={e => { e.stopPropagation(); renameFolder(folder.id); }}
                      className="h-8 w-8 rounded-xl bg-primary text-primary-foreground grid place-items-center shadow-sm">
                      <Check className="h-4 w-4" />
                    </button>
                    <button onClick={e => { e.stopPropagation(); setRenamingId(null); }}
                      className="h-8 w-8 rounded-xl bg-secondary grid place-items-center shadow-sm">
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                )}
              </motion.div>
            );
          })}
        </div>
      </div>
    );
  }

  /* ─────────────── Favorites virtual folder card ─────────────── */
  function FavoritesFolderCard() {
    if (favoriteItems.length === 0 || !isRoot) return null;
    const thumbs = favoriteItems.filter(it => it.type === "image").slice(0, 4);
    return (
      <motion.div whileTap={{ scale: 0.97 }} className="relative">
        <button
          onClick={() => setViewingFavorites(true)}
          className="w-full flex flex-col rounded-2xl border-2 border-rose-200 active:border-rose-400 bg-white shadow-sm overflow-hidden text-left"
        >
          {/* Mosaic thumbnail or solid colour */}
          <div className="aspect-video w-full bg-gradient-to-br from-rose-50 to-rose-100 overflow-hidden relative">
            {thumbs.length === 0 && (
              <div className="absolute inset-0 flex items-center justify-center">
                <Heart className="h-12 w-12 text-rose-300 fill-rose-200" />
              </div>
            )}
            {thumbs.length === 1 && (
              <img src={thumbs[0].data} alt="" className="w-full h-full object-cover" />
            )}
            {thumbs.length >= 2 && (
              <div className={`w-full h-full grid gap-0.5 ${thumbs.length >= 4 ? "grid-cols-2 grid-rows-2" : "grid-cols-2"}`}>
                {thumbs.map(it => (
                  <img key={it.id} src={it.data} alt="" className="w-full h-full object-cover" />
                ))}
              </div>
            )}
            {/* Heart badge */}
            <div className="absolute top-2 left-2">
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-rose-500 text-white shadow-sm">
                <Heart className="h-2.5 w-2.5 fill-white" /> Favourites
              </span>
            </div>
          </div>
          {/* Label */}
          <div className="px-3 pt-2.5 pb-1 flex items-center gap-2">
            <Heart className="h-3.5 w-3.5 text-rose-500 fill-rose-400 shrink-0" />
            <span className="text-sm font-semibold text-foreground truncate">Favourites</span>
          </div>
          <div className="px-3 pb-2.5 text-[11px] text-muted-foreground">
            {favoriteItems.length} item{favoriteItems.length !== 1 ? "s" : ""}
          </div>
        </button>
      </motion.div>
    );
  }

  /* ─────────────── Favorites gallery view ─────────────── */
  function FavoritesGallery() {
    if (favoriteItems.length === 0) {
      return (
        <div className="flex flex-col items-center justify-center py-16 text-center gap-4">
          <div className="h-20 w-20 rounded-3xl bg-rose-50 grid place-items-center">
            <Heart className="h-10 w-10 text-rose-200" />
          </div>
          <div>
            <p className="font-semibold text-brand-dark">No favourites yet</p>
            <p className="text-sm text-muted-foreground mt-1 max-w-xs mx-auto">
              Tap the ♥ on any image or video to save it here.
            </p>
          </div>
        </div>
      );
    }
    return (
      <div className="space-y-3">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider px-0.5">
          {favoriteItems.length} item{favoriteItems.length !== 1 ? "s" : ""}
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3 sm:gap-4">
          {favoriteItems.map((item, i) => {
            const folder = folders.find(f => f.id === item.folderId);
            return (
              <ItemCard
                key={item.id}
                item={item}
                isFav={true}
                canEdit={canEdit}
                folderName={folder?.name}
                onOpen={() => setLightbox({ items: favoriteItems, idx: i })}
                onToggleFav={() => toggleFavorite(item.id)}
                onDelete={canEdit ? () => setDeleteConfirm(item.id) : undefined}
              />
            );
          })}
        </div>
      </div>
    );
  }

  /* ─────────────── Item gallery (inside a folder) ─────────────── */
  function ItemGallery() {
    if (currentItems.length === 0 && !canEdit) return null;
    return (
      <div className="space-y-3">
        {currentItems.length > 0 && (
          <>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider px-0.5">
              Files · {currentItems.length}
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3 sm:gap-4">
              {currentItems.map((item, i) => (
                <ItemCard
                  key={item.id}
                  item={item}
                  isFav={favIds.has(item.id)}
                  canEdit={canEdit}
                  onOpen={() => setLightbox({ items: currentItems, idx: i })}
                  onToggleFav={() => toggleFavorite(item.id)}
                  onDelete={canEdit ? () => setDeleteConfirm(item.id) : undefined}
                />
              ))}
            </div>
          </>
        )}
      </div>
    );
  }

  /* ─────────────── Delete modal ─────────────── */
  function DeleteModal() {
    const isFolder = folders.some(f => f.id === deleteConfirm);
    const folder   = folders.find(f => f.id === deleteConfirm);
    const item     = items.find(it => it.id === deleteConfirm);
    const ids      = folder ? [folder.id, ...descendantIds(folder.id)] : [];
    const childCnt = ids.length > 0 ? items.filter(it => ids.includes(it.folderId)).length : 0;

    return (
      <AnimatePresence>
        {deleteConfirm && (
          <>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm"
              onClick={() => setDeleteConfirm(null)} />
            <motion.div
              initial={{ opacity: 0, y: 32 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 32 }}
              className="fixed inset-x-4 bottom-0 sm:inset-auto sm:top-1/2 sm:left-1/2 sm:-translate-x-1/2 sm:-translate-y-1/2 z-50 bg-white rounded-t-3xl sm:rounded-2xl shadow-2xl p-6 max-w-sm sm:w-full"
              style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 1.5rem)" }}
            >
              <div className="w-10 h-1 rounded-full bg-border mx-auto mb-5 sm:hidden" />
              <div className="h-12 w-12 rounded-2xl bg-destructive/10 grid place-items-center mb-4">
                <Trash2 className="h-6 w-6 text-destructive" />
              </div>
              <h3 className="font-semibold text-brand-dark text-lg mb-1">
                {isFolder ? "Delete Folder?" : "Delete Item?"}
              </h3>
              <p className="text-sm text-muted-foreground mb-6">
                {isFolder
                  ? <>Delete <strong>{folder?.name}</strong>{childCnt > 0 ? ` and all ${childCnt} item${childCnt !== 1 ? "s" : ""} inside` : ""}? This cannot be undone.</>
                  : <>Delete <strong>{item?.name}</strong>? This cannot be undone.</>}
              </p>
              <div className="flex gap-3">
                <button onClick={() => setDeleteConfirm(null)}
                  className="flex-1 h-11 rounded-xl border border-border text-sm font-medium hover:bg-secondary active:bg-secondary">
                  Cancel
                </button>
                <button
                  onClick={() => isFolder ? deleteFolder(deleteConfirm!) : deleteItem(deleteConfirm!)}
                  className="flex-1 h-11 rounded-xl bg-destructive text-destructive-foreground text-sm font-medium active:opacity-90">
                  Delete
                </button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    );
  }

  /* ─────────────── Render ─────────────── */
  return (
    <div className="max-w-7xl mx-auto space-y-5">

      {/* Header */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <Breadcrumb />
          <p className="text-xs text-muted-foreground mt-1">
            {viewingFavorites
              ? `${favoriteItems.length} favourited item${favoriteItems.length !== 1 ? "s" : ""}`
              : [
                  subfolders.length > 0 && `${subfolders.length} folder${subfolders.length !== 1 ? "s" : ""}`,
                  currentItems.length > 0 && `${currentItems.length} file${currentItems.length !== 1 ? "s" : ""}`,
                  isRoot && favoriteItems.length > 0 && `${favoriteItems.length} favourite${favoriteItems.length !== 1 ? "s" : ""}`,
                ].filter(Boolean).join(" · ") || "Empty"
            }
          </p>
        </div>
        {canEdit && (
          <div className="flex items-center gap-2 shrink-0">
            {/* Upload — only shown when inside a folder */}
            {currentFolderId && (
              <>
                <input
                  id="catalog-upload-input"
                  type="file"
                  accept="image/*,video/*"
                  multiple
                  className="hidden"
                  onChange={e => { if (e.target.files) handleFiles(e.target.files); e.currentTarget.value = ""; }}
                />
                <button
                  onClick={() => document.getElementById("catalog-upload-input")?.click()}
                  disabled={uploading}
                  className="flex items-center gap-2 px-4 h-10 rounded-xl border border-border bg-white text-sm font-medium text-foreground hover:bg-secondary active:bg-secondary disabled:opacity-60 transition-colors"
                >
                  {uploading
                    ? <span className="h-4 w-4 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
                    : <Upload className="h-4 w-4" />}
                  {uploading ? "Uploading…" : "Upload"}
                </button>
              </>
            )}
            <button
              onClick={() => { setShowNewFolder(v => !v); setNewFolderName(""); }}
              className="flex items-center gap-2 px-4 h-10 rounded-xl btn-hero text-sm font-medium"
            >
              <Plus className="h-4 w-4" /> New Folder
            </button>
          </div>
        )}
      </div>

      {/* New folder input (no height animation — avoids full-screen bug) */}
      {showNewFolder && (
        <div className="flex items-center gap-3 p-4 rounded-2xl border border-primary/30 bg-primary/5">
          <Folder className="h-5 w-5 text-primary shrink-0" />
          <input
            autoFocus
            className="flex-1 bg-transparent text-sm font-medium outline-none placeholder:text-muted-foreground min-w-0"
            placeholder="Folder name…"
            value={newFolderName}
            onChange={e => setNewFolderName(e.target.value)}
            onKeyDown={e => {
              if (e.key === "Enter")  createFolder();
              if (e.key === "Escape") setShowNewFolder(false);
            }}
          />
          <button onClick={createFolder}
            className="h-9 w-9 rounded-xl bg-primary text-primary-foreground grid place-items-center shrink-0">
            <Check className="h-4 w-4" />
          </button>
          <button onClick={() => setShowNewFolder(false)}
            className="h-9 w-9 rounded-xl bg-secondary grid place-items-center shrink-0">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Error banner */}
      <AnimatePresence>
        {error && (
          <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
            className="flex items-center gap-3 p-3 rounded-xl bg-destructive/10 text-destructive text-sm">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span className="flex-1">{error}</span>
            <button onClick={() => setError(null)} className="shrink-0 p-1"><X className="h-4 w-4" /></button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Favourites folder view ── */}
      {viewingFavorites && <FavoritesGallery />}

      {/* ── Normal folder/gallery view ── */}
      {!viewingFavorites && (
        <>
          {/* Root: Favourites virtual card + real folders in one grid */}
          {isRoot && (subfolders.length > 0 || favoriteItems.length > 0) && (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3 sm:gap-4">
              <FavoritesFolderCard />
              {subfolders.map(folder => {
                const count      = totalItemCount(folder.id);
                const thumb      = items.find(it => [folder.id, ...descendantIds(folder.id)].includes(it.folderId) && it.type === "image");
                const isRenaming = renamingId === folder.id;
                return (
                  <motion.div key={folder.id} whileTap={{ scale: 0.97 }} className="relative">
                    <button
                      onClick={() => { if (!isRenaming) enterFolder(folder.id); }}
                      className="w-full flex flex-col rounded-2xl border border-border/60 active:border-primary/40 bg-white shadow-sm overflow-hidden text-left"
                    >
                      <div className="aspect-video w-full bg-gradient-to-br from-amber-50 to-amber-100 overflow-hidden relative">
                        {thumb
                          ? <img src={thumb.data} alt="" className="w-full h-full object-cover" />
                          : <div className="absolute inset-0 flex items-center justify-center"><Folder className="h-10 w-10 text-amber-400" /></div>}
                      </div>
                      <div className="px-3 pt-2.5 pb-1 flex items-center gap-2">
                        <Folder className="h-3.5 w-3.5 text-amber-500 shrink-0" />
                        {isRenaming ? (
                          <input autoFocus
                            className="flex-1 text-sm font-medium bg-transparent outline-none border-b border-primary min-w-0"
                            value={renameVal}
                            onChange={e => setRenameVal(e.target.value)}
                            onClick={e => e.stopPropagation()}
                            onKeyDown={e => {
                              if (e.key === "Enter")  { e.stopPropagation(); renameFolder(folder.id); }
                              if (e.key === "Escape") { e.stopPropagation(); setRenamingId(null); }
                            }}
                          />
                        ) : (
                          <span className="text-sm font-medium text-foreground truncate">{folder.name}</span>
                        )}
                      </div>
                      <div className="px-3 pb-2.5 text-[11px] text-muted-foreground">
                        {count} item{count !== 1 ? "s" : ""}
                      </div>
                    </button>
                    {canEdit && !isRenaming && (
                      <div className="absolute top-2 right-2">
                        <FolderMenu
                          onRename={() => { setRenamingId(folder.id); setRenameVal(folder.name); }}
                          onDelete={() => setDeleteConfirm(folder.id)}
                        />
                      </div>
                    )}
                    {isRenaming && (
                      <div className="absolute top-2 right-2 flex gap-1">
                        <button onClick={e => { e.stopPropagation(); renameFolder(folder.id); }}
                          className="h-8 w-8 rounded-xl bg-primary text-primary-foreground grid place-items-center shadow-sm">
                          <Check className="h-4 w-4" />
                        </button>
                        <button onClick={e => { e.stopPropagation(); setRenamingId(null); }}
                          className="h-8 w-8 rounded-xl bg-secondary grid place-items-center shadow-sm">
                          <X className="h-4 w-4" />
                        </button>
                      </div>
                    )}
                  </motion.div>
                );
              })}
            </div>
          )}

          {/* Sub-level: subfolders grid (separate from items) */}
          {!isRoot && <FolderGrid />}

          {/* Root empty state */}
          {isRoot && subfolders.length === 0 && favoriteItems.length === 0 && !showNewFolder && (
            <div className="flex flex-col items-center justify-center py-16 text-center gap-4">
              <div className="h-20 w-20 rounded-3xl bg-primary/10 grid place-items-center">
                <FolderOpen className="h-10 w-10 text-primary/40" />
              </div>
              <div>
                <p className="font-semibold text-brand-dark">No folders yet</p>
                <p className="text-sm text-muted-foreground mt-1 max-w-xs mx-auto">
                  {canEdit ? "Create a folder to start organising your product catalog." : "No catalog folders have been created yet."}
                </p>
              </div>
              {canEdit && (
                <button onClick={() => setShowNewFolder(true)}
                  className="flex items-center gap-2 px-5 h-11 rounded-xl btn-hero text-sm font-medium">
                  <Plus className="h-4 w-4" /> New Folder
                </button>
              )}
            </div>
          )}

          {/* Sub-folder empty state */}
          {!isRoot && subfolders.length === 0 && currentItems.length === 0 && !showNewFolder && (
            <div className="flex flex-col items-center justify-center py-12 text-center gap-3">
              <div className="h-16 w-16 rounded-2xl bg-primary/10 grid place-items-center">
                <ImageIcon className="h-8 w-8 text-primary/40" />
              </div>
              <div>
                <p className="font-semibold text-brand-dark">This folder is empty</p>
                <p className="text-sm text-muted-foreground mt-0.5">
                  {canEdit ? "Create a subfolder or upload files below." : "No items here yet."}
                </p>
              </div>
            </div>
          )}

          {/* Item gallery */}
          <ItemGallery />
        </>
      )}

      {/* ── Modals ── */}
      <DeleteModal />
      <AnimatePresence>
        {lightbox && (
          <Lightbox items={lightbox.items} startIndex={lightbox.idx} onClose={() => setLightbox(null)} />
        )}
      </AnimatePresence>
    </div>
  );
}
