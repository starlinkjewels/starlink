import { WebVideo } from "@/components/ProductVideo";
import { useCan } from "@/hooks/useCan";
import { requestPlayable } from "@/lib/webVideo";
import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  FolderOpen,
  Folder,
  FolderPlus,
  Plus,
  Trash2,
  Upload,
  X,
  Play,
  ChevronRight,
  Edit2,
  Check,
  AlertCircle,
  Image as ImageIcon,
  Video,
  Download,
  MoreHorizontal,
  ChevronLeft,
  Heart,
  ImagePlus,
  FileText,
  FolderInput,
  Share2,
  ArrowUpDown,
  ListChecks,
  ArrowUp,
  ArrowDown,
  Search,
} from "lucide-react";
import { useUrlState } from "@/hooks/useUrlState";
import { MoreMenu, type MoreAction } from "@/components/MoreMenu";
import { PageHeader } from "@/components/PageHeader";
import { ActionSheet } from "@/components/ActionSheet";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { AsyncButton } from "@/components/AsyncButton";
import { needsAccess } from "@/lib/actionHints";
import { updateCatalogItem, folderPath, folderPath as folderPathText, moveCatalogItems } from "@/lib/catalogItemEdit";
import { loadDb, updateDb, uid } from "@/lib/db";
import type { CatalogFolder, CatalogItem } from "@/lib/db";
import { ShareFolderButton } from "@/components/ShareFolderButton";
import { findShare } from "@/lib/share";
import { useDb } from "@/hooks/useDb";
import { uploadDataUrl, uploadFile } from "@/lib/storage";
import { imageForUpload, keepsOriginal } from "@/lib/images";
import { useAuth } from "@/lib/auth";
import { VirtualGrid } from "@/components/VirtualGrid";
import {
  Select, SelectContent, SelectItem,
  SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  fetchCatalogItemsPage,
  countCatalogItems,
  findFolderThumbnail,
  fetchCatalogItemsByIds,
  createCatalogItem,
  deleteCatalogItem,
  deleteCatalogItemsInFolders,
  fetchAllCatalogItems,
  CATALOG_SORT_OPTIONS,
  type CatalogSort,
} from "@/lib/catalogItems";
import { toast } from "sonner";
import { downloadAsZip, downloadFile } from "@/lib/zipDownload";
import type { QueryDocumentSnapshot, DocumentData } from "firebase/firestore";

// Rough initial row-height guess for virtualized grids — corrected
// automatically once actual rows are measured (see VirtualGrid).
const ITEM_ROW_ESTIMATE_PX = 230;

/* ─────────────────────────────────────────────────────────────── */
/*  Helpers                                                        */
/* ─────────────────────────────────────────────────────────────── */
const MAX_FILE_MB = 500; // large videos are uploaded in chunks (resumable), so a big cap is safe


/* ─────────────────────────────────────────────────────────────── */
/*  Heart button — shared by item cards & favorites section       */
/* ─────────────────────────────────────────────────────────────── */
function HeartBtn({ active, onToggle }: { active: boolean; onToggle(e: React.MouseEvent): void }) {
  return (
    <button
      onClick={onToggle}
      className={`h-8 w-8 rounded-lg border grid place-items-center shadow-sm transition-colors
        ${
          active
            ? "bg-rose-50 border-rose-200 text-rose-500"
            : "bg-white/90 border-border/60 text-muted-foreground hover:text-rose-400 active:text-rose-500"
        }`}
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
  items,
  startIndex,
  onClose,
  onDownload,
  downloadBlocked,
}: {
  items: CatalogItem[];
  startIndex: number;
  onClose: () => void;
  /** The same download as an item's ⋯ → Download: the access check, and the
   *  Activity line. It used to be a plain link here that skipped both. None
   *  (a client, who has no ⋯ either): no Download button. */
  onDownload?: (item: CatalogItem) => void;
  /** Why this person can't download (greyed, saying so), as the ⋯ does. */
  downloadBlocked?: string;
}) {
  const [idx, setIdx] = useState(startIndex);
  const [dir, setDir] = useState(0);

  const item = items[idx];
  const hasPrev = idx > 0;
  const hasNext = idx < items.length - 1;

  function prev() {
    if (hasPrev) {
      setDir(-1);
      setIdx((i) => i - 1);
    }
  }
  function next() {
    if (hasNext) {
      setDir(1);
      setIdx((i) => i + 1);
    }
  }

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
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[60] bg-black/96 flex flex-col"
      style={{
        paddingTop: "env(safe-area-inset-top)",
        paddingBottom: "env(safe-area-inset-bottom)",
      }}
    >
      {/* Top bar */}
      <div className="flex items-center justify-between px-4 py-3 shrink-0 gap-3">
        <p className="text-white/80 text-sm font-medium truncate">
          {item.name}
          {items.length > 1 && (
            <span className="ml-2 text-white/40 text-xs">
              {idx + 1} / {items.length}
            </span>
          )}
        </p>
        <div className="flex items-center gap-2 shrink-0">
          {onDownload && (
          <button
            type="button"
            // Greyed but still answers a tap with the reason — a phone shows no tooltip.
            onClick={() => (downloadBlocked ? toast.error(downloadBlocked) : onDownload(item))}
            aria-disabled={!!downloadBlocked}
            aria-label="Download"
            title={downloadBlocked ?? "Download"}
            className="h-10 w-10 rounded-full bg-white/10 active:bg-white/20 flex items-center justify-center text-white aria-disabled:opacity-35 aria-disabled:cursor-not-allowed"
          >
            <Download className="h-5 w-5" />
          </button>
          )}
          <button
            onClick={onClose}
            className="h-10 w-10 rounded-full bg-white/10 active:bg-white/20 flex items-center justify-center text-white"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
      </div>

      {/* Media + side arrows */}
      <div className="flex-1 flex items-center min-h-0 relative">
        {hasPrev && (
          <button
            onClick={prev}
            className="absolute left-2 z-10 h-11 w-11 rounded-full bg-white/10 active:bg-white/20 flex items-center justify-center text-white"
          >
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
              <img
                src={item.data}
                alt={item.name}
                className="max-w-full max-h-full object-contain rounded-xl select-none"
                style={{ maxHeight: "calc(100vh - 140px)" }}
                onClick={onClose}
              />
            ) : item.type === "file" ? (
              <div className="flex flex-col items-center gap-4 text-white">
                <FileText className="h-20 w-20 opacity-70" />
                <p className="text-sm font-medium text-center max-w-xs break-words">{item.name}</p>
                <a
                  href={item.data}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 px-4 h-10 rounded-xl bg-white text-brand-dark text-sm font-semibold"
                >
                  <Download className="h-4 w-4" /> Open / Download
                </a>
              </div>
            ) : (
              <WebVideo
                src={item.data}
                controls
                autoPlay
                muted
                loop
                preload="auto"
                playsInline
                className="max-w-full rounded-xl"
                style={{ maxHeight: "calc(100vh - 140px)" }}
              />
            )}
          </motion.div>
        </AnimatePresence>
        {hasNext && (
          <button
            onClick={next}
            className="absolute right-2 z-10 h-11 w-11 rounded-full bg-white/10 active:bg-white/20 flex items-center justify-center text-white"
          >
            <ChevronRight className="h-6 w-6" />
          </button>
        )}
      </div>

      {/* Thumbnail strip */}
      {items.length > 1 && (
        <div className="shrink-0 px-4 pb-3 pt-2 flex items-center gap-2 overflow-x-auto">
          {items.map((it, i) => (
            <button
              key={it.id}
              onClick={() => {
                setDir(i > idx ? 1 : -1);
                setIdx(i);
              }}
              className={`shrink-0 h-12 w-12 rounded-lg overflow-hidden border-2 transition-all
                ${i === idx ? "border-white scale-110" : "border-white/20 opacity-50"}`}
            >
              {it.type === "image" ? (
                <img src={it.data} alt="" className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full bg-slate-700 flex items-center justify-center">
                  {it.type === "file"
                    ? <FileText className="h-4 w-4 text-white" />
                    : <Play className="h-4 w-4 text-white" />}
                </div>
              )}
            </button>
          ))}
        </div>
      )}
    </motion.div>
  );
}

/* ─────────────────────────────────────────────────────────────── */
/*  Upload zone                                                    */
/* ─────────────────────────────────────────────────────────────── */
function UploadZone({ onFiles, uploading }: { onFiles(f: FileList): void; uploading?: boolean }) {
  const [dragging, setDragging] = useState(false);
  const ref = useRef<HTMLInputElement>(null);

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    if (e.dataTransfer.files.length) onFiles(e.dataTransfer.files);
  };

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
      onClick={() => !uploading && ref.current?.click()}
      className={`flex flex-col items-center justify-center gap-3 p-8 rounded-2xl border-2 border-dashed cursor-pointer transition-colors select-none
        ${dragging ? "border-primary bg-primary/5" : "border-border/60 hover:border-primary/50 hover:bg-secondary/30"}
        ${uploading ? "opacity-60 cursor-not-allowed" : ""}`}
    >
      <div
        className={`h-14 w-14 rounded-2xl grid place-items-center transition-colors ${dragging ? "bg-primary/10" : "bg-secondary"}`}
      >
        {uploading ? (
          <span className="h-7 w-7 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
        ) : (
          <Upload className={`h-7 w-7 ${dragging ? "text-primary" : "text-muted-foreground"}`} />
        )}
      </div>
      <div className="text-center">
        <p className="text-sm font-semibold text-foreground">
          {uploading ? "Uploading…" : dragging ? "Drop to upload" : "Tap or drop to upload"}
        </p>
        <p className="text-xs text-muted-foreground mt-0.5">
          Any file — images, videos, PDF, Excel · max {MAX_FILE_MB} MB each
        </p>
      </div>
      <input
        ref={ref}
        type="file"
        accept="*/*"
        multiple
        className="hidden"
        onChange={(e) => {
          if (e.target.files) onFiles(e.target.files);
          e.target.value = "";
        }}
      />
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────── */
/*  Reusable item card                                             */
/* ─────────────────────────────────────────────────────────────── */
function ItemCard({
  item,
  isFav,
  canEdit,
  folderName,
  isBanner,
  onOpen,
  onToggleFav,
  onDelete,
  onSetBanner,
  menu,
  picking,
  picked,
  onPick,
}: {
  item: CatalogItem;
  isFav: boolean;
  canEdit: boolean;
  folderName?: string;
  isBanner?: boolean;
  onOpen(): void;
  onToggleFav(): void;
  onDelete?(): void;
  onSetBanner?(): void;
  /** Staff: rename, move, delete — greyed with the reason when not theirs to do. */
  menu?: MoreAction[];
  /** Picking several to move: a tap ticks the item instead of opening it. */
  picking?: boolean;
  picked?: boolean;
  onPick?(): void;
}) {
  return (
    <motion.div
      whileTap={{ scale: 0.97 }}
      className={`relative rounded-2xl overflow-hidden border bg-white shadow-sm flex flex-col ${picked ? "border-primary ring-2 ring-primary" : "border-border/60"}`}
    >
      {/* Thumbnail */}
      <button
        onClick={picking ? onPick : onOpen}
        aria-pressed={picking ? !!picked : undefined}
        aria-label={picking ? `${picked ? "Untick" : "Tick"} ${item.name}` : undefined}
        className="block w-full aspect-square bg-secondary/30 overflow-hidden relative"
      >
        {item.type === "image" ? (
          <img
            src={item.data}
            alt={item.name}
            loading="lazy"
            decoding="async"
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-slate-100 to-slate-200">
            {item.type === "file"
              ? <FileText className="h-10 w-10 text-slate-400" />
              : <Video className="h-10 w-10 text-slate-400" />}
          </div>
        )}
        {item.type === "video" && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="h-12 w-12 rounded-full bg-black/40 flex items-center justify-center">
              <Play className="h-6 w-6 text-white ml-0.5" />
            </div>
          </div>
        )}
        {picking && <div className="absolute top-2 left-2 z-10"><PickTick on={!!picked} /></div>}
        {/* Type badge */}
        <div className={`absolute top-2 left-2 ${picking ? "hidden" : ""}`}>
          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-black/50 text-white backdrop-blur-sm">
            {item.type === "video" ? (
              <Video className="h-2.5 w-2.5" />
            ) : item.type === "file" ? (
              <FileText className="h-2.5 w-2.5" />
            ) : (
              <ImageIcon className="h-2.5 w-2.5" />
            )}
            {item.type}
          </span>
        </div>
        {/* Delete (admin/employee) */}
        {canEdit && onDelete && !picking && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
            className="absolute top-2 right-2 h-8 w-8 rounded-lg bg-white/90 border border-border/60 grid place-items-center text-muted-foreground hover:text-destructive active:text-destructive shadow-sm"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        )}
        {/* Set as folder banner (admin/employee, images only) */}
        {canEdit && onSetBanner && item.type === "image" && !picking && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onSetBanner();
            }}
            title={isBanner ? "Remove as folder banner" : "Set as folder banner"}
            className={`absolute bottom-2 right-2 h-8 w-8 rounded-lg border grid place-items-center shadow-sm transition-colors
              ${
                isBanner
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-white/90 border-border/60 text-muted-foreground hover:text-primary active:text-primary"
              }`}
          >
            <ImagePlus className="h-3.5 w-3.5" />
          </button>
        )}
        {isBanner && (
          <div className="absolute bottom-2 left-2">
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-primary text-primary-foreground">
              Banner
            </span>
          </div>
        )}
      </button>

      {/* Bottom row: name + folder tag + heart */}
      <div className="flex items-center gap-1 px-2.5 pt-2 pb-1.5">
        <div className="flex-1 min-w-0">
          <p className="text-[11px] text-foreground font-medium truncate" title={item.name}>
            {item.name}
          </p>
          {folderName && (
            <p className="text-[10px] text-muted-foreground truncate flex items-center gap-0.5 mt-0.5" title={folderName}>
              <Folder className="h-2.5 w-2.5 shrink-0 text-amber-500" />
              {folderName}
            </p>
          )}
        </div>
        {menu && !picking && <MoreMenu size="sm" label={`Actions for ${item.name}`} title={item.name} actions={menu} className="h-7 w-7 border-0 shadow-none" />}
        <HeartBtn
          active={isFav}
          onToggle={(e) => {
            e.stopPropagation();
            onToggleFav();
          }}
        />
      </div>
    </motion.div>
  );
}

/** An item's download name, with its file extension — from its name, else its type or its stored file. */
function downloadName(item: CatalogItem): string {
  const name = (item.name || "file").replace(/[\\/:*?"<>|]+/g, "-").trim() || "file";
  if (/\.[a-z0-9]{2,5}$/i.test(name)) return name;
  const fromUrl = decodeURIComponent(item.data.split("?")[0]).match(/\.([a-z0-9]{2,5})$/i)?.[1];
  const fromMime = item.mime?.split("/")[1]?.replace("jpeg", "jpg").replace(/[^a-z0-9].*$/i, "");
  const ext = fromUrl || fromMime || (item.type === "image" ? "jpg" : item.type === "video" ? "mp4" : "");
  return ext ? `${name}.${ext}` : name;
}

/**
 * "Share link" on the Catalog's main page: the folders there, each with
 * whether it already has a public link — one tap opens it (or makes it).
 */
function ShareFoldersSheet({ open, onClose, folders, counts, onPick }: {
  open: boolean; onClose(): void; folders: CatalogFolder[]; counts: Record<string, number>; onPick(f: CatalogFolder): void;
}) {
  useDb(); // re-read when a link is made or stopped
  return (
    <ActionSheet open={open} onOpenChange={(v) => { if (!v) onClose(); }} size="md" icon={Share2}
      title="Share link" description="Pick a folder — anyone with its link can view it, no login needed">
      <ul className="rounded-xl border border-border/60 divide-y divide-border/50 bg-white">
        {folders.map((f) => {
          const shared = !!findShare("catalog", f.id);
          return (
            <li key={f.id}>
              <button type="button" onClick={() => onPick(f)}
                className="w-full flex items-center gap-3 px-3 py-3 text-left hover:bg-secondary/60 active:bg-secondary">
                <Folder className="h-4 w-4 text-amber-500 shrink-0" />
                <span className="flex-1 min-w-0">
                  <span className="block truncate text-sm font-medium text-brand-dark">{f.name}</span>
                  {counts[f.id] != null && <span className="block text-[11px] text-muted-foreground">{counts[f.id]} item{counts[f.id] !== 1 ? "s" : ""}</span>}
                </span>
                <span className={`inline-flex items-center gap-1.5 h-8 px-3 rounded-lg border text-xs font-medium shrink-0 ${shared ? "border-success/40 text-success bg-success/5" : "border-border text-brand-dark bg-white"}`}>
                  <Share2 className="h-3.5 w-3.5" />{shared ? "Shared" : "Share"}
                  {shared && <span className="h-1.5 w-1.5 rounded-full bg-success" />}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </ActionSheet>
  );
}

/** A position typed in: moved when it is done (Enter, or leaving the box), so
 *  typing "12" doesn't first jump the folder to 1. */
function PositionInput({ value, max, label, onCommit }: { value: number; max: number; label: string; onCommit(n: number): void }) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  const commit = () => {
    const n = Math.round(Number(draft));
    if (n >= 1 && n <= max && n !== value) onCommit(n); else setDraft(String(value));
  };
  return (
    <input type="number" inputMode="numeric" min={1} max={max} value={draft} aria-label={label}
      onChange={(e) => setDraft(e.target.value)} onBlur={commit}
      onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); commit(); } }}
      className="h-9 w-14 rounded-lg border border-border bg-secondary/40 text-center text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-primary/30" />
  );
}

/**
 * The folders at one level, in the order everyone sees them — clients too.
 * Moved with ↑ ↓ or by typing a position, saved together as each folder's
 * `order`. Folders made later go after these until arranged again.
 */
function ArrangeFoldersSheet({ open, onClose, onSaved, folders, title }: {
  open: boolean; onClose(): void; onSaved(): void; folders: CatalogFolder[]; title: string;
}) {
  const [ids, setIds] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  // Taken once as it opens: a folder arriving meanwhile doesn't reshuffle the list being arranged.
  useEffect(() => {
    if (open) { setIds(folders.map((f) => f.id)); setSortedBy(""); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const nameOf = (id: string) => folders.find((f) => f.id === id)?.name ?? "Folder";
  const moveTo = (from: number, to: number) => setIds((cur) => {
    const t = Math.max(0, Math.min(cur.length - 1, to));
    if (t === from) return cur;
    const next = [...cur];
    const [x] = next.splice(from, 1);
    next.splice(t, 0, x);
    return next;
  });
  const changed = ids.some((id, i) => folders[i]?.id !== id);
  // The whole list at once, then fine-tuned with the arrows. Names compare the
  // way a person reads them: SBR0009 before SBR0089, SBR2 before SBR10.
  const [sortedBy, setSortedBy] = useState("");
  const SORTS: Record<string, { label: string; cmp: (a: CatalogFolder, b: CatalogFolder) => number }> = {
    nameAsc: { label: "Name A → Z", cmp: (a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }) },
    nameDesc: { label: "Name Z → A", cmp: (a, b) => b.name.localeCompare(a.name, undefined, { numeric: true, sensitivity: "base" }) },
    newest: { label: "Newest first", cmp: (a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? "") },
    oldest: { label: "Oldest first", cmp: (a, b) => (a.createdAt ?? "").localeCompare(b.createdAt ?? "") },
  };
  const sortAll = (key: string) => {
    const s = SORTS[key];
    if (!s) return;
    const byId = new Map(folders.map((f) => [f.id, f]));
    setIds((cur) => [...cur].sort((a, b) => s.cmp(byId.get(a)!, byId.get(b)!)));
    setSortedBy(key);
  };
  const save = () => {
    setSaving(true);
    try {
      updateDb((db) => {
        ids.forEach((id, i) => {
          const f = db.catalogFolders.find((x) => x.id === id);
          if (f) f.order = i;
        });
      });
      toast.success("Folder order saved");
      onSaved(); // the grid shows the new order at once
      onClose();
    } finally { setSaving(false); }
  };
  return (
    <ActionSheet open={open} onOpenChange={(v) => { if (!v) onClose(); }} size="md" icon={ArrowUpDown}
      title="Arrange folders" description={`${title} · the order everyone sees them in`}
      footer={
        <div className="flex items-center justify-end gap-2">
          <Button variant="outline" onClick={onClose} className="rounded-xl h-10 flex-1 sm:flex-none">Cancel</Button>
          <AsyncButton onClick={save} disabled={saving || !changed} className="btn-hero rounded-xl h-10 flex-1 sm:flex-none sm:px-8">Save order</AsyncButton>
        </div>
      }>
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <Select value={sortedBy} onValueChange={sortAll}>
          <SelectTrigger className="h-10 rounded-xl w-full sm:w-56" aria-label="Sort all by"><ArrowUpDown className="h-4 w-4 mr-2 shrink-0 text-muted-foreground" /><SelectValue placeholder="Sort all by…" /></SelectTrigger>
          <SelectContent>
            {Object.entries(SORTS).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">{sortedBy ? `Sorted: ${SORTS[sortedBy].label} — fine-tune with the arrows, then Save order.` : `${ids.length} folders · sort them all, or move one at a time.`}</p>
      </div>
      <ol className="rounded-xl border border-border/60 divide-y divide-border/50 bg-white">
        {ids.map((id, i) => (
          <li key={id} className="flex items-center gap-2 px-2.5 py-2">
            <PositionInput value={i + 1} max={ids.length} label={`Position of ${nameOf(id)}`} onCommit={(n) => moveTo(i, n - 1)} />
            <Folder className="h-4 w-4 text-amber-500 shrink-0" />
            <span className="flex-1 min-w-0 truncate text-sm font-medium text-brand-dark">{nameOf(id)}</span>
            <button type="button" onClick={() => moveTo(i, i - 1)} disabled={i === 0} aria-label={`Move ${nameOf(id)} up`}
              className="h-9 w-9 grid place-items-center rounded-lg border border-border bg-white hover:bg-secondary disabled:opacity-30"><ArrowUp className="h-4 w-4" /></button>
            <button type="button" onClick={() => moveTo(i, i + 1)} disabled={i === ids.length - 1} aria-label={`Move ${nameOf(id)} down`}
              className="h-9 w-9 grid place-items-center rounded-lg border border-border bg-white hover:bg-secondary disabled:opacity-30"><ArrowDown className="h-4 w-4" /></button>
          </li>
        ))}
      </ol>
    </ActionSheet>
  );
}

/**
 * Move a folder, with everything in it, under another folder or to the top of
 * the Catalog — one field on the folder; its items and subfolders go with it.
 * Admin only. A folder can't go inside itself or one of its own subfolders.
 */
function FolderMoveSheet({ folder, folders, blocked, onClose }: {
  folder: CatalogFolder;
  folders: CatalogFolder[];
  /** The folder and its subfolders — not places it can go. */
  blocked: string[];
  onClose(): void;
}) {
  const ROOT = "__root__";
  const [target, setTarget] = useState(folder.parentId ?? ROOT);
  const options = [
    { id: ROOT, label: "Catalog (top level)" },
    ...folders.filter((f) => !blocked.includes(f.id)).map((f) => ({ id: f.id, label: folderPath(folders, f.id) })).sort((a, b) => a.label.localeCompare(b.label)),
  ];
  const here = folder.parentId ?? ROOT;
  const save = async () => {
    if (target === here) { onClose(); return; }
    if (target !== ROOT && blocked.includes(target)) { toast.error("A folder can't go inside itself"); return; }
    updateDb((db) => {
      const f = db.catalogFolders.find((x) => x.id === folder.id);
      if (f) f.parentId = target === ROOT ? null : target;
    });
    toast.success(`${folder.name} moved to ${target === ROOT ? "the top of the Catalog" : folderPath(folders, target)}`);
    onClose();
  };
  return (
    <ActionSheet open onOpenChange={(o) => { if (!o) onClose(); }} icon={FolderInput}
      title={`Move ${folder.name}`}
      description={`Now in ${here === ROOT ? "the top of the Catalog" : folderPath(folders, here)}. Everything inside it moves with it.`}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose} className="rounded-xl">Cancel</Button>
          <AsyncButton onClick={save} className="btn-hero rounded-xl px-6">Move</AsyncButton>
        </div>
      }>
      <div className="space-y-1.5">
        <Label className="text-xs">Move into</Label>
        <Select value={target} onValueChange={setTarget}>
          <SelectTrigger className="h-10 rounded-xl" aria-label="Move into"><SelectValue /></SelectTrigger>
          <SelectContent>
            {options.map((o) => <SelectItem key={o.id} value={o.id}>{o.label}{o.id === here ? " (here now)" : ""}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
    </ActionSheet>
  );
}

/** The round tick on a card while picking several to move. */
function PickTick({ on }: { on: boolean }) {
  return (
    <span aria-hidden className={`h-6 w-6 rounded-full grid place-items-center border-2 shadow-sm transition-colors ${on ? "bg-primary border-primary text-primary-foreground" : "bg-white/95 border-white text-transparent ring-1 ring-black/10"}`}>
      <Check className="h-3.5 w-3.5" />
    </span>
  );
}

/**
 * Several folders and items at once, into one folder (or, folders only, the
 * top of the Catalog). Folders take everything inside them; a folder can't go
 * inside itself or one of its own subfolders. Admin only, like a single move.
 */
function BulkMoveSheet({ folderIds, itemIds, folders, blocked, here, onClose, onMoved }: {
  folderIds: string[];
  itemIds: string[];
  folders: CatalogFolder[];
  /** The picked folders and all their subfolders — not places they can go. */
  blocked: string[];
  /** The folder on screen (null = top of the Catalog). */
  here: string | null;
  onClose(): void;
  onMoved(target: string | null): void;
}) {
  const ROOT = "__root__";
  const [target, setTarget] = useState("");
  // Items always live in a folder, so the top level is only for folders.
  const options = [
    ...(itemIds.length ? [] : [{ id: ROOT, label: "Catalog (top level)" }]),
    ...folders.filter((f) => !blocked.includes(f.id)).map((f) => ({ id: f.id, label: folderPath(folders, f.id) })).sort((a, b) => a.label.localeCompare(b.label)),
  ];
  const what = [folderIds.length && `${folderIds.length} folder${folderIds.length !== 1 ? "s" : ""}`, itemIds.length && `${itemIds.length} file${itemIds.length !== 1 ? "s" : ""}`].filter(Boolean).join(" and ");
  const save = async () => {
    if (!target) { toast.error("Choose where they go"); return; }
    const to = target === ROOT ? null : target;
    if (to && blocked.includes(to)) { toast.error("A folder can't go inside itself"); return; }
    if (to === here) { toast.info("They're already here"); return; }
    if (itemIds.length && !to) { toast.error("Files go into a folder"); return; }
    if (folderIds.length) {
      updateDb((db) => {
        for (const id of folderIds) {
          const f = db.catalogFolders.find((x) => x.id === id);
          if (f && (f.parentId ?? null) !== to) f.parentId = to;
        }
      });
    }
    if (itemIds.length && to) await moveCatalogItems(itemIds, to);
    toast.success(`${what} moved to ${to ? folderPath(folders, to) : "the top of the Catalog"}`);
    onMoved(to);
  };
  return (
    <ActionSheet open onOpenChange={(o) => { if (!o) onClose(); }} icon={FolderInput}
      title={`Move ${what}`}
      description="Folders move with everything inside them. Links already sent keep the old place."
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose} className="rounded-xl">Cancel</Button>
          <AsyncButton onClick={save} disabled={!target} className="btn-hero rounded-xl px-6">Move</AsyncButton>
        </div>
      }>
      <div className="space-y-1.5">
        <Label className="text-xs">Move into</Label>
        <Select value={target} onValueChange={setTarget}>
          <SelectTrigger className="h-10 rounded-xl" aria-label="Move into"><SelectValue placeholder="Choose a folder…" /></SelectTrigger>
          <SelectContent>
            {options.map((o) => <SelectItem key={o.id} value={o.id}>{o.label}{(o.id === ROOT ? null : o.id) === here ? " (here now)" : ""}</SelectItem>)}
          </SelectContent>
        </Select>
        {folderIds.length > 0 && blocked.length > folderIds.length && (
          <p className="text-[11px] text-muted-foreground">The picked folders' own subfolders aren't listed — a folder can't go inside itself.</p>
        )}
      </div>
    </ActionSheet>
  );
}

/**
 * Rename an item, or move it to another folder — one field on the item, in
 * the side panel. Moving leaves favourites alone (they follow the item).
 */
function CatalogItemSheet({ item, mode, folders, onClose, onSaved }: {
  item: CatalogItem;
  mode: "rename" | "move";
  folders: CatalogFolder[];
  onClose(): void;
  onSaved(next: CatalogItem): void;
}) {
  const [name, setName] = useState(item.name);
  const [folderId, setFolderId] = useState(item.folderId);
  const options = folders.map((f) => ({ id: f.id, label: folderPath(folders, f.id) })).sort((a, b) => a.label.localeCompare(b.label));
  const save = async () => {
    if (mode === "rename") {
      const v = name.trim();
      if (!v) { toast.error("Enter a name"); return; }
      if (v === item.name) { onClose(); return; }
      await updateCatalogItem(item.id, { name: v });
      toast.success(`Renamed to ${v}`);
      onSaved({ ...item, name: v });
    } else {
      if (folderId === item.folderId) { onClose(); return; }
      await updateCatalogItem(item.id, { folderId });
      toast.success(`Moved to ${folderPath(folders, folderId)}`);
      onSaved({ ...item, folderId });
    }
    onClose();
  };
  return (
    <ActionSheet open onOpenChange={(o) => { if (!o) onClose(); }} icon={mode === "rename" ? Edit2 : FolderInput}
      title={mode === "rename" ? "Rename item" : "Move to another folder"}
      description={mode === "rename" ? "Also its download file name." : `Now in ${folderPath(folders, item.folderId) || "a folder"}. Links already sent keep the old place.`}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose} className="rounded-xl">Cancel</Button>
          <AsyncButton onClick={save} className="btn-hero rounded-xl px-6">{mode === "rename" ? "Save" : "Move"}</AsyncButton>
        </div>
      }>
      {mode === "rename" ? (
        <div className="space-y-1.5">
          <Label htmlFor="cat_item_name" className="text-xs">Name</Label>
          <Input id="cat_item_name" value={name} autoFocus onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") void save(); }} className="h-10 rounded-xl" />
        </div>
      ) : (
        <div className="space-y-1.5">
          <Label className="text-xs">Folder</Label>
          <Select value={folderId} onValueChange={setFolderId}>
            <SelectTrigger className="h-10 rounded-xl" aria-label="Folder"><SelectValue /></SelectTrigger>
            <SelectContent>
              {options.map((o) => <SelectItem key={o.id} value={o.id}>{o.label}{o.id === item.folderId ? " (here now)" : ""}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      )}
    </ActionSheet>
  );
}

/* ─────────────────────────────────────────────────────────────── */
/*  Favourites gallery — a real top-level component (not a nested   */
/*  render helper) since it wraps VirtualGrid, which has its own    */
/*  hook state that must not be torn down on every parent re-render */
/* ─────────────────────────────────────────────────────────────── */
function FavoritesGallery({
  favoriteItems,
  folders,
  canEdit,
  canDelete = canEdit,
  onOpen,
  onToggleFav,
  onDelete,
  itemMenu,
}: {
  favoriteItems: CatalogItem[];
  folders: CatalogFolder[];
  canEdit: boolean;
  /** Whether the delete button shows; follows canEdit unless a role says otherwise. */
  canDelete?: boolean;
  onOpen(items: CatalogItem[], idx: number): void;
  onToggleFav(id: string): void;
  onDelete(id: string): void;
  itemMenu?(item: CatalogItem): MoreAction[];
}) {
  if (favoriteItems.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center gap-4">
        <div className="h-20 w-20 rounded-3xl bg-rose-50 grid place-items-center">
          <Heart className="h-10 w-10 text-rose-200" />
        </div>
        <div>
          <p className="font-semibold text-brand-dark">No favourites yet</p>
          <p className="text-sm text-muted-foreground mt-1 max-w-xs mx-auto">
            Tap ♥ on any image to keep it here.
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
      <VirtualGrid
        items={favoriteItems}
        estimateRowHeight={ITEM_ROW_ESTIMATE_PX}
        getKey={(item) => item.id}
        renderItem={(item, i) => {
          const folder = folders.find((f) => f.id === item.folderId);
          return (
            <ItemCard
              item={item}
              isFav={true}
              canEdit={canEdit || canDelete}
              folderName={folder?.name}
              onOpen={() => onOpen(favoriteItems, i)}
              onToggleFav={() => onToggleFav(item.id)}
              onDelete={canDelete ? () => onDelete(item.id) : undefined}
              menu={itemMenu?.(item)}
            />
          );
        }}
      />
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────── */
/*  Item gallery (inside a folder) — same reasoning as              */
/*  FavoritesGallery above: a stable top-level component so the     */
/*  virtualized grid survives item-list updates (e.g. "load more")  */
/*  instead of remounting and losing scroll position/measurements.  */
/* ─────────────────────────────────────────────────────────────── */
function ItemGallery({
  items,
  itemsLoading,
  itemsHasMore,
  canEdit,
  canDelete = canEdit,
  favIds,
  bannerItemId,
  sort,
  sentinelRef,
  onOpen,
  onToggleFav,
  onDelete,
  onSetBanner,
  onSortChange,
  itemMenu,
  picking,
  pickedIds,
  onPick,
}: {
  items: CatalogItem[];
  itemsLoading: boolean;
  itemsHasMore: boolean;
  canEdit: boolean;
  /** Whether the delete button shows; follows canEdit unless a role says otherwise. */
  canDelete?: boolean;
  favIds: Set<string>;
  bannerItemId?: string;
  sort: CatalogSort;
  sentinelRef: React.RefObject<HTMLDivElement | null>;
  onOpen(items: CatalogItem[], idx: number): void;
  onToggleFav(id: string): void;
  onDelete(id: string): void;
  onSetBanner(item: CatalogItem): void;
  onSortChange(sort: CatalogSort): void;
  itemMenu?(item: CatalogItem): MoreAction[];
  picking?: boolean;
  pickedIds?: Set<string>;
  onPick?(id: string): void;
}) {
  if (items.length === 0 && !itemsLoading && !canEdit) return null;
  return (
    <div className="space-y-3">
      {(items.length > 0 || itemsLoading) && (
        <>
          <div className="flex items-center justify-between gap-3 px-0.5">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              Files · {items.length}
              {itemsHasMore ? "+" : ""}
            </p>
            <Select value={sort} onValueChange={(v) => onSortChange(v as CatalogSort)}>
              <SelectTrigger className="rounded-lg h-8 w-auto gap-1.5 text-xs px-2.5">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CATALOG_SORT_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value} className="text-xs">
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <VirtualGrid
            items={items}
            estimateRowHeight={ITEM_ROW_ESTIMATE_PX}
            getKey={(item) => item.id}
            renderItem={(item, i) => (
              <ItemCard
                item={item}
                isFav={favIds.has(item.id)}
                canEdit={canEdit || canDelete}
                isBanner={bannerItemId === item.id}
                onOpen={() => onOpen(items, i)}
                onToggleFav={() => onToggleFav(item.id)}
                onDelete={canDelete ? () => onDelete(item.id) : undefined}
                onSetBanner={canEdit ? () => onSetBanner(item) : undefined}
                menu={itemMenu?.(item)}
                picking={picking}
                picked={pickedIds?.has(item.id)}
                onPick={() => onPick?.(item.id)}
              />
            )}
          />
          {/* Infinite-scroll trigger + loading indicator */}
          <div ref={sentinelRef} className="h-1" />
          {itemsLoading && (
            <div className="flex justify-center py-4">
              <span className="h-6 w-6 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
            </div>
          )}
        </>
      )}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────── */
/*  Main page                                                      */
/* ─────────────────────────────────────────────────────────────── */
export function CatalogPage() {
  const { user } = useAuth();
  const can = useCan();
  const isStaff = user?.role === "admin" || user?.role === "employee";
  // Upload and new folders; rename and banner; delete — each as the role allows.
  const canAdd = isStaff && can("catalog", "add");
  const canEdit = isStaff && can("catalog", "edit");
  const canDelete = isStaff && can("catalog", "delete");
  const canShare = isStaff && can("catalog", "export");
  // Moving items and folders changes where everyone finds them — admin only.
  const isAdmin = user?.role === "admin";
  const ADMIN_MOVE = "Only an admin can move";

  const [folders, setFolders] = useState<CatalogFolder[]>([]);
  const [favIds, setFavIds] = useState<Set<string>>(new Set());

  // Current folder's items — paginated directly from Firestore (NOT the
  // shared cache, which can't hold thousands of items per folder safely —
  // see src/lib/catalogItems.ts). `items` only ever holds the pages loaded
  // so far for `currentFolderId`.
  const [items, setItems] = useState<CatalogItem[]>([]);
  const [itemsCursor, setItemsCursor] = useState<QueryDocumentSnapshot<DocumentData> | null>(null);
  const [itemsHasMore, setItemsHasMore] = useState(false);
  const [itemsLoading, setItemsLoading] = useState(false);
  const [itemsSort, setItemsSort] = useState<CatalogSort>("date_desc");

  // Async-fetched per-folder item counts/thumbnails (folder cards no longer
  // have the full item list in memory to derive these from locally).
  const [folderCounts, setFolderCounts] = useState<Record<string, number>>({});
  const [folderThumbs, setFolderThumbs] = useState<Record<string, CatalogItem | null>>({});
  const [favoriteItems, setFavoriteItems] = useState<CatalogItem[]>([]);

  // Navigation stack (empty = root)
  const [folderPath, setFolderPath] = useState<string[]>([]);
  const currentFolderId = folderPath.length > 0 ? folderPath[folderPath.length - 1] : null;

  const [viewingFavorites, setViewingFavorites] = useState(false);

  const [showNewFolder, setShowNewFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameVal, setRenameVal] = useState("");
  const [lightbox, setLightbox] = useState<{ items: CatalogItem[]; idx: number } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<{ done: number; total: number; pct: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [itemSheet, setItemSheet] = useState<{ item: CatalogItem; mode: "rename" | "move" } | null>(null);
  const [movingFolder, setMovingFolder] = useState<CatalogFolder | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  // "Share link" from a folder's ⋯, and "Arrange folders".
  const [sharingFolder, setSharingFolder] = useState<CatalogFolder | null>(null);
  const [arranging, setArranging] = useState(false);
  const [sharePicker, setSharePicker] = useState(false);
  // Picking several folders and files to move together (admin).
  const [picking, setPicking] = useState(false);
  const [pickedFolders, setPickedFolders] = useState<Set<string>>(new Set());
  const [pickedItems, setPickedItems] = useState<Set<string>>(new Set());
  const [bulkMoving, setBulkMoving] = useState(false);
  const stopPicking = () => { setPicking(false); setPickedFolders(new Set()); setPickedItems(new Set()); setBulkMoving(false); };
  const flip = (set: Set<string>, id: string) => { const n = new Set(set); if (n.has(id)) n.delete(id); else n.add(id); return n; };

  /* ── Load folders + favourite ids (small, bounded collections — still the shared cache) ── */
  const reload = useCallback(() => {
    const db = loadDb();
    // A new array each time: a change made in place (a new order, a new
    // name) would otherwise look like the same list and not redraw.
    setFolders([...(db.catalogFolders ?? [])]);
    const myFavs = (db.catalogFavorites ?? [])
      .filter((f) => f.userId === user!.id)
      .map((f) => f.itemId);
    setFavIds(new Set(myFavs));
  }, [user]);

  useEffect(() => {
    reload();
    window.addEventListener("starlink-db-updated", reload);
    return () => window.removeEventListener("starlink-db-updated", reload);
  }, [reload]);

  /* ── Derived ── */
  // In the order set in "Arrange folders"; folders never arranged keep the
  // order they arrive in, after the arranged ones.
  const subfolders = useMemo(
    () => folders
      .map((f, i) => ({ f, i }))
      .filter(({ f }) => (f.parentId ?? null) === currentFolderId)
      .sort((a, b) => (a.f.order ?? Infinity) - (b.f.order ?? Infinity) || a.i - b.i)
      .map(({ f }) => f),
    [folders, currentFolderId],
  );
  const breadcrumb = folderPath
    .map((id) => folders.find((f) => f.id === id))
    .filter(Boolean) as CatalogFolder[];
  const isRoot = folderPath.length === 0 && !viewingFavorites;

  // Picks belong to the folder on screen.
  useEffect(() => { stopPicking(); }, [currentFolderId, viewingFavorites]);

  /* ── Load current folder's first page of items whenever it changes ── */
  useEffect(() => {
    if (!currentFolderId) {
      setItems([]);
      setItemsCursor(null);
      setItemsHasMore(false);
      return;
    }
    let cancelled = false;
    setItems([]);
    setItemsCursor(null);
    setItemsHasMore(false);
    setItemsLoading(true);
    fetchCatalogItemsPage(currentFolderId, null, itemsSort)
      .then((page) => {
        if (cancelled) return;
        setItems(page.items);
        setItemsCursor(page.cursor);
        setItemsHasMore(page.hasMore);
      })
      .finally(() => {
        if (!cancelled) setItemsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [currentFolderId, itemsSort]);

  const loadMoreItems = useCallback(async () => {
    if (!currentFolderId || !itemsHasMore || itemsLoading) return;
    setItemsLoading(true);
    try {
      const page = await fetchCatalogItemsPage(currentFolderId, itemsCursor, itemsSort);
      setItems((prev) => [...prev, ...page.items]);
      setItemsCursor(page.cursor);
      setItemsHasMore(page.hasMore);
    } finally {
      setItemsLoading(false);
    }
  }, [currentFolderId, itemsCursor, itemsHasMore, itemsLoading, itemsSort]);

  // Infinite-scroll trigger for the item gallery — declared here (not inside
  // the nested ItemGallery() render helper below) so the ref/effect belong to
  // this component's stable identity, not to a function re-created every render.
  const itemsSentinelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!itemsHasMore) return;
    const el = itemsSentinelRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) loadMoreItems();
      },
      { rootMargin: "600px" },
    );
    obs.observe(el);
    return () => obs.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemsHasMore, currentFolderId, itemsCursor]);

  /* ── Folder counts/thumbnails for whichever folders are currently on screen ── */
  useEffect(() => {
    if (subfolders.length === 0) return;
    let cancelled = false;
    (async () => {
      const counts: Record<string, number> = {};
      const thumbs: Record<string, CatalogItem | null> = {};
      await Promise.all(
        subfolders.map(async (folder) => {
          const ids = [folder.id, ...descendantIds(folder.id)];
          // Skip the thumbnail lookup entirely when an explicit banner is
          // set — folder.bannerUrl already covers rendering, no extra read needed.
          const [count, thumb] = await Promise.all([
            countCatalogItems(ids),
            folder.bannerUrl ? Promise.resolve(null) : findFolderThumbnail(ids),
          ]);
          counts[folder.id] = count;
          thumbs[folder.id] = thumb;
        }),
      );
      if (!cancelled) {
        setFolderCounts((prev) => ({ ...prev, ...counts }));
        setFolderThumbs((prev) => ({ ...prev, ...thumbs }));
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subfolders]);

  /* ── Favourited items (across all folders) ── */
  useEffect(() => {
    let cancelled = false;
    fetchCatalogItemsByIds([...favIds]).then((list) => {
      if (!cancelled) setFavoriteItems(list);
    });
    return () => {
      cancelled = true;
    };
  }, [favIds]);

  /* ── Search across the whole catalog ── */
  // Kept in the address (?q=), so Back from a photo or a link keeps the search.
  const [findQ, setFindQ] = useUrlState("q");
  const findWords = findQ.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const searching = findWords.length > 0;
  const nameHas = (name: string) => { const n = (name || "").toLowerCase(); return findWords.every((w) => n.includes(w)); };
  // Folders are already here; items are read only once something is typed,
  // the way a folder's Download reads them — every folder's, once per visit
  // (then searched in memory as you type). Forgotten after an upload, move or
  // delete, so the next search reads them fresh.
  const [allItems, setAllItems] = useState<CatalogItem[] | null>(null);
  const [allLoading, setAllLoading] = useState(false);
  const allFailed = useRef(false);
  useEffect(() => {
    if (!searching || allItems || allLoading || allFailed.current || folders.length === 0) return;
    setAllLoading(true);
    fetchAllCatalogItems(folders.map((f) => f.id))
      .then((list) => setAllItems(list))
      .catch(() => { allFailed.current = true; toast.error("Couldn't search the files — folders only"); })
      .finally(() => setAllLoading(false));
  }, [searching, allItems, allLoading, folders]);
  const foundFolders = useMemo(
    () => (searching ? folders.filter((f) => nameHas(f.name)).sort((a, b) => a.name.localeCompare(b.name)) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [searching, findQ, folders],
  );
  const foundItems = useMemo(
    () => (searching && allItems
      ? allItems.filter((it) => nameHas(it.name)).sort((a, b) => a.name.localeCompare(b.name))
      : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [searching, findQ, allItems],
  );
  // Files still being read (or about to be — the read starts just after this draw).
  const filesPending = searching && !allItems && !allFailed.current && folders.length > 0;
  /** Open a folder found by the search: the way down to it, as if walked. */
  function openFound(id: string) {
    const chain: string[] = [];
    let cur: string | null | undefined = id;
    for (let guard = 0; cur && guard < 50; guard++) {
      chain.unshift(cur);
      cur = folders.find((f) => f.id === cur)?.parentId;
    }
    setFolderPath(chain);
    setShowNewFolder(false);
    setViewingFavorites(false);
    setFindQ("");
  }

  /* ── Navigation ── */
  // Going anywhere ends a search — the folder is what is shown then.
  function enterFolder(id: string) {
    setFolderPath((p) => [...p, id]);
    setShowNewFolder(false);
    setViewingFavorites(false);
    if (searching) setFindQ("");
  }
  function navigateTo(idx: number) {
    setFolderPath((p) => (idx < 0 ? [] : p.slice(0, idx + 1)));
    setShowNewFolder(false);
    setViewingFavorites(false);
    if (searching) setFindQ("");
  }
  function goToRoot() {
    setFolderPath([]);
    setShowNewFolder(false);
    setViewingFavorites(false);
    if (searching) setFindQ("");
  }

  /* ── Favorites ── */
  function toggleFavorite(itemId: string) {
    updateDb((db) => {
      if (!db.catalogFavorites) db.catalogFavorites = [];
      const idx = db.catalogFavorites.findIndex(
        (f) => f.userId === user!.id && f.itemId === itemId,
      );
      if (idx >= 0) db.catalogFavorites.splice(idx, 1);
      else db.catalogFavorites.push({ userId: user!.id, itemId });
    });
    reload();
  }

  /* ── Folder CRUD ── */
  function createFolder() {
    const name = newFolderName.trim();
    if (!name) return;
    updateDb((db) => {
      db.catalogFolders.push({
        id: uid("cf_"),
        name,
        parentId: currentFolderId ?? null,
        createdBy: user!.id,
        createdAt: new Date().toISOString(),
      });
    });
    setNewFolderName("");
    setShowNewFolder(false);
  }

  function renameFolder(id: string) {
    const val = renameVal.trim();
    if (!val) return;
    updateDb((db) => {
      const f = db.catalogFolders.find((f) => f.id === id);
      if (f) f.name = val;
    });
    setRenamingId(null);
  }

  /** Toggle an image as the current folder's explicit cover — clicking the
   *  already-set banner again clears it, reverting to the automatic
   *  first-image thumbnail. */
  function setFolderBanner(folderId: string, item: CatalogItem) {
    updateDb((db) => {
      const f = db.catalogFolders.find((f) => f.id === folderId);
      if (!f) return;
      if (f.bannerItemId === item.id) {
        delete f.bannerItemId;
        delete f.bannerUrl;
      } else {
        f.bannerItemId = item.id;
        f.bannerUrl = item.data;
      }
    });
  }

  function descendantIds(id: string): string[] {
    const children = folders.filter((f) => f.parentId === id).map((f) => f.id);
    return [...children, ...children.flatMap(descendantIds)];
  }

  async function deleteFolder(id: string) {
    const ids = [id, ...descendantIds(id)];
    const deletedItemIds = await deleteCatalogItemsInFolders(ids);
    updateDb((db) => {
      db.catalogFolders = db.catalogFolders.filter((f) => !ids.includes(f.id));
      db.catalogFavorites = db.catalogFavorites.filter((f) => !deletedItemIds.includes(f.itemId));
    });
    setDeleteConfirm(null);
    setAllItems((prev) => prev && prev.filter((it) => !ids.includes(it.folderId)));
    setFolderPath((p) => {
      const cut = p.findIndex((x) => ids.includes(x));
      return cut < 0 ? p : p.slice(0, cut);
    });
  }

  /* ── Upload ── */

  /**
   * Recreate the picked folder's structure as catalog folders and return a map
   * of "Rings/Bands" -> folder id, so every file lands where it sat on the PC.
   * A folder that already exists under the same parent is reused, so uploading
   * the same folder twice tops it up instead of duplicating the tree.
   *
   * The "" key is the home for anything the browser hands over without a
   * relative path. A folder upload must NEVER spill files into the folder you
   * were looking at - that is what made an upload look like it had landed in
   * the folder above - so those files go to the picked folder itself.
   */
  function buildFolderTree(files: File[]): Map<string, string> {
    const relOf = (f: File) => (f as File & { webkitRelativePath?: string }).webkitRelativePath || "";
    // The name of the folder the user actually picked, taken from the first file
    // that carries a path. A browser that reports no paths at all still gets a
    // folder of its own rather than spilling into the current one.
    const firstRel = files.map(relOf).find((r) => r.includes("/")) || "";
    const rootName = firstRel.split("/")[0] || `Uploaded ${new Date().toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }).replace(/\bSept\b/, "Sep")}`;

    const byPath = new Map<string, string>();
    updateDb((db) => {
      const folderFor = (name: string, parent: string | null): string => {
        const existing = db.catalogFolders.find(
          (x) => x.name === name && (x.parentId ?? null) === parent,
        );
        if (existing) return existing.id;
        const id = uid("cf_");
        db.catalogFolders.push({
          id,
          name,
          parentId: parent,
          createdBy: user!.id,
          createdAt: new Date().toISOString(),
        });
        return id;
      };

      const home = currentFolderId ?? null;
      byPath.set("", folderFor(rootName, home));

      for (const f of files) {
        const parts = relOf(f).split("/").filter(Boolean).slice(0, -1); // drop the file name
        let parent: string | null = home;
        let acc = "";
        for (const seg of parts) {
          acc = acc ? `${acc}/${seg}` : seg;
          let id = byPath.get(acc);
          if (!id) {
            id = folderFor(seg, parent);
            byPath.set(acc, id);
          }
          parent = id;
        }
      }
    });
    return byPath;
  }

  async function handleFiles(files: FileList, keepStructure = false) {
    const all = Array.from(files);
    if (!all.length) return;
    // A plain pick drops everything into the folder you're looking at. A folder
    // pick rebuilds the tree first — that's the whole point of "Upload Folder",
    // and it's why it also works from the top level, where there is no current
    // folder to drop into.
    if (!keepStructure && !currentFolderId) return;
    const tree = keepStructure ? buildFolderTree(all) : new Map<string, string>();
    const destOf = (f: File) => {
      if (!keepStructure) return currentFolderId;
      const rel = (f as File & { webkitRelativePath?: string }).webkitRelativePath || "";
      const dir = rel.split("/").filter(Boolean).slice(0, -1).join("/");
      return tree.get(dir) ?? tree.get("") ?? currentFolderId;
    };

    // Oversized files are SKIPPED on purpose; anything else that fails is a real
    // error, and we keep its reason so the summary says what actually went wrong
    // instead of guessing.
    const tooBig: string[] = [];
    const failed: string[] = [];
    let firstReason = "";
    let done = 0;
    setUploading(true);
    setUploadProgress({ done: 0, total: all.length, pct: 0 });
    setError(null);

    const uploadOne = async (file: File) => {
      const mb = file.size / 1024 / 1024;
      if (mb > MAX_FILE_MB) { tooBig.push(file.name); return; }
      const folderId = destOf(file);
      if (!folderId) { failed.push(file.name); if (!firstReason) firstReason = "no destination folder"; return; }
      const isImage = file.type.startsWith("image/");
      const isVideo = file.type.startsWith("video/");
      // Anything else (PDF, Excel, Word, ZIP, CAD…) is kept as a plain file
      // attachment — uploaded as-is, listed in the folder, downloadable.
      try {
        // A photo goes up as it was picked (full size); only a huge one or a HEIC is re-encoded.
        const data = isImage && !keepsOriginal(file)
          ? await uploadDataUrl(await imageForUpload(file), `catalog/${folderId}`)
          : await uploadFile(file, `catalog/${folderId}`, pct =>
              setUploadProgress({ done, total: all.length, pct }));
        // A copy every browser and device plays — made on the server (lib/webVideo.ts).
        if (isVideo) requestPlayable(data);
        const newItem: CatalogItem = {
          id: uid("ci_"),
          folderId,
          name: file.name,
          type: isImage ? "image" : isVideo ? "video" : "file",
          data,
          mime: isImage || isVideo ? undefined : (file.type || undefined),
          createdBy: user!.id,
          createdAt: new Date().toISOString(),
        };
        await createCatalogItem(newItem);
        // Only the folder on screen is showing its items — a file that landed in
        // a freshly created sub-folder is loaded when you open it.
        if (folderId === currentFolderId) setItems((prev) => [newItem, ...prev]);
      } catch (e) {
        // One bad file must not abandon the rest of a big folder upload.
        failed.push(file.name);
        if (!firstReason) firstReason = e instanceof Error ? e.message : String(e);
      }
    };

    try {
      // Four at a time: a 600-file folder one-by-one takes forever, and more
      // than a handful of parallel uploads just starves each other's bandwidth.
      let next = 0;
      const worker = async () => {
        while (next < all.length) {
          const file = all[next++];
          await uploadOne(file);
          setUploadProgress({ done: ++done, total: all.length, pct: 0 });
        }
      };
      await Promise.all(Array.from({ length: Math.min(4, all.length) }, worker));

      const bad = tooBig.length + failed.length;
      if (bad) {
        const parts: string[] = [];
        if (tooBig.length) parts.push(`${tooBig.length} over ${MAX_FILE_MB} MB`);
        if (failed.length) parts.push(`${failed.length} failed${firstReason ? ` — ${firstReason}` : ""}`);
        setError(
          bad === 1
            ? `"${(tooBig[0] ?? failed[0])}" couldn't be uploaded (${parts.join("")}).`
            : `${bad} of ${all.length} files couldn't be uploaded (${parts.join("; ")}). The other ${all.length - bad} went up.`,
        );
      }
      if (bad < all.length) {
        // Distinct ids: the "" key points at the picked folder, so counting keys
        // would report it twice.
        const folderCount = new Set(tree.values()).size || 1;
        toast.success(
          keepStructure
            ? `${all.length - bad} file${all.length - bad !== 1 ? "s" : ""} uploaded into ${folderCount} folder${folderCount !== 1 ? "s" : ""}`
            : `${all.length - bad} file${all.length - bad !== 1 ? "s" : ""} uploaded`,
        );
      }
    } finally {
      setUploading(false);
      setUploadProgress(null);
      // The search's copy of every file doesn't have these; read again when next searched.
      setAllItems(null);
    }
  }

  // Staff: what can be done to one item — each greyed with the reason when
  // this person's access doesn't reach it.
  const itemMenu = (item: CatalogItem): MoreAction[] => [
    { label: "Download", icon: Download, hint: canShare ? undefined : needsAccess("catalog", "export"), disabled: !canShare,
      onSelect: () => downloadFile(item.data, downloadName(item), !isAdmin) },
    { label: "Rename", icon: Edit2, hint: canEdit ? undefined : needsAccess("catalog", "edit"), disabled: !canEdit, onSelect: () => setItemSheet({ item, mode: "rename" }) },
    { label: "Move to another folder", icon: FolderInput, hint: !isAdmin ? ADMIN_MOVE : folders.length > 1 ? undefined : "There is no other folder yet",
      disabled: !isAdmin || folders.length < 2, onSelect: () => setItemSheet({ item, mode: "move" }) },
    { label: "Delete", icon: Trash2, danger: true, hint: canDelete ? undefined : needsAccess("catalog", "delete"), disabled: !canDelete, onSelect: () => setDeleteConfirm(item.id) },
  ];
  /** A folder and everything under it, as one zip — its subfolders kept as folders inside. */
  async function downloadFolder(folder: CatalogFolder) {
    const ids = [folder.id, ...descendantIds(folder.id)];
    setDownloadingId(folder.id);
    const t = toast.loading(`Getting ${folder.name} ready…`);
    try {
      const all = await fetchAllCatalogItems(ids);
      if (!all.length) { toast.info(`${folder.name} is empty — nothing to download`, { id: t }); return; }
      // Where each item sits under the folder: "Bands/2026/ring.jpg".
      const sub = (id: string): string => {
        const names: string[] = [];
        let cur: string | null | undefined = id;
        for (let guard = 0; cur && cur !== folder.id && guard < 50; guard++) {
          const f = folders.find((x) => x.id === cur);
          if (!f) break;
          names.unshift(f.name.replace(/[\\/:*?"<>|]+/g, "-"));
          cur = f.parentId;
        }
        return names.length ? `${names.join("/")}/` : "";
      };
      const files = all
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
        .map((it) => ({ url: it.data, filename: `${sub(it.folderId)}${downloadName(it)}` }));
      const { added, failed, parts } = await downloadAsZip(files, folder.name, (done, total) =>
        toast.loading(`Downloading ${folder.name} — ${done} of ${total}`, { id: t }), !isAdmin);
      // A big folder comes as several zips — say so, so none is missed (the browser may ask to allow them).
      const inParts = parts > 1 ? ` in ${parts} zips (part 1, part 2…)` : "";
      if (!added) toast.error(`Couldn't download ${folder.name}`, { id: t });
      else if (failed.length) toast.warning(`${added} of ${files.length} downloaded${inParts} — ${failed.length} couldn't be fetched`, { id: t });
      else toast.success(`${folder.name} downloaded — ${added} file${added !== 1 ? "s" : ""}${inParts}`, { id: t, duration: parts > 1 ? 10000 : undefined });
    } catch (e) {
      // Out of the browser's memory even for one part: say what to do rather than its own words.
      const msg = e instanceof Error ? e.message : "";
      toast.error(/blob|memory|allocation|quota/i.test(msg)
        ? `${folder.name} is too big to download in one go here — download its sub-folders one by one`
        : `Couldn't download ${folder.name}${msg ? ` — ${msg}` : ""}`, { id: t });
    } finally { setDownloadingId(null); }
  }
  // Staff: what can be done to one folder — each greyed with the reason when
  // this person's access doesn't reach it.
  const folderMenu = (folder: CatalogFolder): MoreAction[] => [
    { label: downloadingId === folder.id ? "Downloading…" : "Download", icon: Download,
      hint: !canShare ? needsAccess("catalog", "export") : "Everything in it, as one zip",
      disabled: !canShare || downloadingId !== null, onSelect: () => downloadFolder(folder) },
    { label: "Share link", icon: Share2, hint: !canShare ? needsAccess("catalog", "export") : "A public link — no login needed",
      disabled: !canShare, onSelect: () => setSharingFolder(folder) },
    { label: "Rename", icon: Edit2, hint: canEdit ? undefined : needsAccess("catalog", "edit"), disabled: !canEdit,
      onSelect: () => { setRenamingId(folder.id); setRenameVal(folder.name); } },
    { label: "Move", icon: FolderInput, hint: isAdmin ? "With everything inside it" : ADMIN_MOVE, disabled: !isAdmin,
      onSelect: () => setMovingFolder(folder) },
    { label: "Delete", icon: Trash2, danger: true, hint: canDelete ? undefined : needsAccess("catalog", "delete"), disabled: !canDelete,
      onSelect: () => setDeleteConfirm(folder.id) },
  ];
  // A renamed or moved item, as the screen holds it: moved out of the folder
  // on screen, it leaves the grid; and a folder's banner doesn't stay pointing
  // at a picture that is no longer in it.
  function itemSaved(next: CatalogItem, before: CatalogItem) {
    setItems((prev) => (next.folderId !== before.folderId && before.folderId === currentFolderId
      ? prev.filter((it) => it.id !== next.id)
      : prev.map((it) => (it.id === next.id ? next : it))));
    setFavoriteItems((prev) => prev.map((it) => (it.id === next.id ? next : it)));
    setAllItems((prev) => prev && prev.map((it) => (it.id === next.id ? next : it)));
    if (next.folderId !== before.folderId) {
      updateDb((db) => {
        const f = db.catalogFolders.find((x) => x.id === before.folderId);
        if (f?.bannerItemId === next.id) { delete f.bannerItemId; delete f.bannerUrl; }
      });
    }
  }

  async function deleteItem(id: string) {
    await deleteCatalogItem(id);
    setItems((prev) => prev.filter((it) => it.id !== id));
    setAllItems((prev) => prev && prev.filter((it) => it.id !== id));
    updateDb((db) => {
      db.catalogFavorites = db.catalogFavorites.filter((f) => f.itemId !== id);
    });
    setDeleteConfirm(null);
  }

  /* ─────────────── Breadcrumb ─────────────── */
  /** The way up from here — the folder itself is the page's title. */
  function Breadcrumb() {
    return (
      <nav aria-label="Folders" className="flex items-center gap-1 flex-wrap text-sm min-w-0">
        <button
          onClick={goToRoot}
          className="font-medium shrink-0 text-primary active:underline"
        >
          Catalog
        </button>
        {breadcrumb.slice(0, -1).map((f, i) => (
          <span key={f.id} className="flex items-center gap-1 min-w-0">
            <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            <button
              onClick={() => navigateTo(i)}
              className="font-medium truncate max-w-[120px] sm:max-w-[200px] text-primary active:underline"
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
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-auto-photos gap-3 sm:gap-4">
          {subfolders.map((folder) => {
            const count = folderCounts[folder.id] ?? null;
            const coverUrl = folder.bannerUrl ?? folderThumbs[folder.id]?.data;
            const isRenaming = renamingId === folder.id;
            return (
              <motion.div key={folder.id} whileTap={{ scale: 0.97 }} className="relative">
                <button
                  onClick={() => {
                    if (picking) setPickedFolders((prev) => flip(prev, folder.id));
                    else if (!isRenaming) enterFolder(folder.id);
                  }}
                  aria-pressed={picking ? pickedFolders.has(folder.id) : undefined}
                  className={`w-full flex flex-col rounded-2xl border bg-white shadow-sm overflow-hidden text-left ${picking && pickedFolders.has(folder.id) ? "border-primary ring-2 ring-primary" : "border-border/60 active:border-primary/40"}`}
                >
                  <div className="aspect-video w-full bg-gradient-to-br from-amber-50 to-amber-100 overflow-hidden relative">
                    {coverUrl ? (
                      <img src={coverUrl} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <div className="absolute inset-0 flex items-center justify-center">
                        <Folder className="h-10 w-10 text-amber-400" />
                      </div>
                    )}
                  </div>
                  <div className="px-3 pt-2.5 pb-1 flex items-center gap-2">
                    {coverUrl && <Folder className="h-3.5 w-3.5 text-amber-500 shrink-0" />}
                    {isRenaming ? (
                      <input
                        autoFocus
                        className="flex-1 text-sm font-medium bg-transparent outline-none border-b border-primary min-w-0"
                        value={renameVal}
                        onChange={(e) => setRenameVal(e.target.value)}
                        onClick={(e) => e.stopPropagation()}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.stopPropagation();
                            renameFolder(folder.id);
                          }
                          if (e.key === "Escape") {
                            e.stopPropagation();
                            setRenamingId(null);
                          }
                        }}
                      />
                    ) : (
                      <span className="text-sm font-medium text-foreground truncate">
                        {folder.name}
                      </span>
                    )}
                  </div>
                  <div className="px-3 pb-2.5 text-[11px] text-muted-foreground">
                    {count === null ? "…" : `${count} item${count !== 1 ? "s" : ""}`}
                  </div>
                </button>
                {picking && <div className="absolute top-2 left-2 pointer-events-none"><PickTick on={pickedFolders.has(folder.id)} /></div>}
                {isStaff && !isRenaming && !picking && (
                  <div className="absolute top-2 right-2" onClick={(e) => e.stopPropagation()}>
                    <MoreMenu size="sm" label={`${folder.name}: more actions`} actions={folderMenu(folder)} />
                  </div>
                )}
                {isRenaming && (
                  <div className="absolute top-2 right-2 flex gap-1">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        renameFolder(folder.id);
                      }}
                      className="h-8 w-8 rounded-xl bg-primary text-primary-foreground grid place-items-center shadow-sm"
                    >
                      <Check className="h-4 w-4" />
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setRenamingId(null);
                      }}
                      className="h-8 w-8 rounded-xl bg-secondary grid place-items-center shadow-sm"
                    >
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
    const thumbs = favoriteItems.filter((it) => it.type === "image").slice(0, 4);
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
              <div
                className={`w-full h-full grid gap-0.5 ${thumbs.length >= 4 ? "grid-cols-2 grid-rows-2" : "grid-cols-2"}`}
              >
                {thumbs.map((it) => (
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
  /* ─────────────── Delete modal ─────────────── */
  function DeleteModal() {
    const isFolder = folders.some((f) => f.id === deleteConfirm);
    const folder = folders.find((f) => f.id === deleteConfirm);
    const item = items.find((it) => it.id === deleteConfirm) ?? favoriteItems.find((it) => it.id === deleteConfirm)
      ?? allItems?.find((it) => it.id === deleteConfirm);
    const childCnt = folder ? (folderCounts[folder.id] ?? 0) : 0;

    return (
      <AnimatePresence>
        {deleteConfirm && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm"
              onClick={() => setDeleteConfirm(null)}
            />
            <motion.div
              initial={{ opacity: 0, y: 32 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 32 }}
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
                {isFolder ? (
                  <>
                    Delete <strong>{folder?.name}</strong>
                    {childCnt > 0
                      ? ` and all ${childCnt} item${childCnt !== 1 ? "s" : ""} inside`
                      : ""}
                    ? This cannot be undone.
                  </>
                ) : (
                  <>
                    Delete <strong>{item?.name}</strong>? This cannot be undone.
                  </>
                )}
              </p>
              <div className="flex gap-3">
                <button
                  onClick={() => setDeleteConfirm(null)}
                  className="flex-1 h-11 rounded-xl border border-border text-sm font-medium hover:bg-secondary active:bg-secondary"
                >
                  Cancel
                </button>
                <button
                  onClick={() =>
                    isFolder ? deleteFolder(deleteConfirm!) : deleteItem(deleteConfirm!)
                  }
                  className="flex-1 h-11 rounded-xl bg-destructive text-destructive-foreground text-sm font-medium active:opacity-90"
                >
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
      {/* Header: where you are, the way up, and what can be done here. The two
          uploads stay in view (icons only on a phone); New Folder is the main button. */}
      <PageHeader
        eyebrow={isRoot ? undefined : <Breadcrumb />}
        title={viewingFavorites && folderPath.length === 0
          ? <span className="inline-flex items-center gap-2"><Heart className="h-6 w-6 fill-rose-500 text-rose-500" />Favourites</span>
          : breadcrumb.length ? breadcrumb[breadcrumb.length - 1].name : "Catalog"}
        subtitle={viewingFavorites
          ? `${favoriteItems.length} favourited item${favoriteItems.length !== 1 ? "s" : ""}`
          : [
              subfolders.length > 0 &&
                `${subfolders.length} folder${subfolders.length !== 1 ? "s" : ""}`,
              items.length > 0 &&
                `${items.length}${itemsHasMore ? "+" : ""} file${items.length !== 1 ? "s" : ""}`,
              isRoot &&
                favoriteItems.length > 0 &&
                `${favoriteItems.length} favourite${favoriteItems.length !== 1 ? "s" : ""}`,
            ]
              .filter(Boolean)
              .join(" · ") || "Empty"}
        primary={canAdd ? { label: "New Folder", icon: Plus, onClick: () => { setShowNewFolder((v) => !v); setNewFolderName(""); } } : null}
        menu={!viewingFavorites && ((canEdit && subfolders.length > 1) || (isStaff && (subfolders.length > 0 || items.length > 0))) ? [
          { label: "Select to move", icon: ListChecks, show: isStaff && (subfolders.length > 0 || items.length > 0),
            hint: isAdmin ? "Several folders and files at once" : ADMIN_MOVE, disabled: !isAdmin, onSelect: () => { setFindQ(""); setPicking(true); } },
          { label: "Arrange folders", icon: ArrowUpDown, show: canEdit && subfolders.length > 1, hint: "Set the order they show in", onSelect: () => setArranging(true) },
        ] : undefined}
        actions={(canAdd || canShare) ? (
          <>
            {/* Upload — only shown when inside a folder */}
            {canAdd && currentFolderId && (
              <>
                <input
                  id="catalog-upload-input"
                  type="file"
                  accept="*/*"
                  multiple
                  className="hidden"
                  onChange={(e) => {
                    if (e.target.files) handleFiles(e.target.files);
                    e.currentTarget.value = "";
                  }}
                />
                <button
                  onClick={() => document.getElementById("catalog-upload-input")?.click()}
                  disabled={uploading}
                  aria-label={uploading ? undefined : "Upload"}
                  className="flex items-center gap-2 px-3 sm:px-3.5 h-10 shrink-0 rounded-xl border border-border bg-white text-sm font-medium text-foreground hover:bg-secondary active:bg-secondary disabled:opacity-60 transition-colors"
                >
                  {uploading ? (
                    <span className="h-4 w-4 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
                  ) : (
                    <Upload className="h-4 w-4" />
                  )}
                  {uploading
                    ? (uploadProgress
                        ? <>
                            <span className="sm:hidden tabular-nums">{uploadProgress.done + 1}/{uploadProgress.total}</span>
                            <span className="max-sm:hidden">{`Uploading ${uploadProgress.done + 1}/${uploadProgress.total}${uploadProgress.pct ? ` · ${uploadProgress.pct}%` : ""}…`}</span>
                          </>
                        : <span className="max-sm:hidden">Uploading…</span>)
                    : <span className="max-sm:hidden">Upload</span>}
                </button>
              </>
            )}
            {/* Upload Folder works at the top level too — the picked folder and
                everything under it is recreated here as catalog folders. */}
            {canAdd && (<>
            <input
              id="catalog-upload-folder-input"
              type="file"
              // @ts-expect-error — non-standard but supported by Chrome/Edge/Safari
              webkitdirectory=""
              directory=""
              multiple
              className="hidden"
              onChange={(e) => {
                if (e.target.files) handleFiles(e.target.files, true);
                e.currentTarget.value = "";
              }}
            />
            <button
              onClick={() => document.getElementById("catalog-upload-folder-input")?.click()}
              disabled={uploading}
              aria-label="Upload Folder"
              title="Pick a folder on your computer — the folder and everything inside it is uploaded in one go, keeping its sub-folders"
              className="flex items-center gap-2 px-3 sm:px-3.5 h-10 shrink-0 rounded-xl border border-border bg-white text-sm font-medium text-foreground hover:bg-secondary active:bg-secondary disabled:opacity-60 transition-colors"
            >
              <FolderPlus className="h-4 w-4" />
              <span className="max-sm:hidden">Upload Folder</span>
            </button>
            </>)}
            {canShare && isRoot && subfolders.length > 0 && (
              <button
                onClick={() => setSharePicker(true)}
                aria-label="Share link"
                className="flex items-center gap-2 px-3 sm:px-3.5 h-10 shrink-0 rounded-xl border border-border bg-white text-sm font-medium text-foreground hover:bg-secondary active:bg-secondary transition-colors"
              >
                <Share2 className="h-4 w-4" />
                <span className="max-sm:hidden">Share link</span>
              </button>
            )}
            {canShare && currentFolderId && (
              <ShareFolderButton
                kind="catalog"
                folderId={currentFolderId}
                folderName={folders.find((f) => f.id === currentFolderId)?.name ?? "Folder"}
              />
            )}
          </>
        ) : undefined}
      />

      {/* Picking several to move: what is ticked, and Move. */}
      {picking && (() => {
        const n = pickedFolders.size + pickedItems.size;
        const all = subfolders.length + items.length;
        return (
          <div className="sticky top-2 z-20 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-2xl border border-primary/25 bg-white/95 backdrop-blur px-3 py-2.5 shadow-md">
            <span className="text-sm font-semibold text-brand-dark tabular-nums">{n ? `${n} selected` : "Tap folders and files to select"}</span>
            {n < all && (
              <button type="button" onClick={() => { setPickedFolders(new Set(subfolders.map((f) => f.id))); setPickedItems(new Set(items.map((i) => i.id))); }}
                className="text-xs font-medium text-primary hover:underline">Select all {all}{itemsHasMore ? " shown" : ""}</button>
            )}
            <div className="ml-auto flex items-center gap-2">
              <Button size="sm" variant="ghost" onClick={stopPicking} className="rounded-xl h-9">Cancel</Button>
              <Button size="sm" disabled={!n} onClick={() => setBulkMoving(true)} className="btn-hero rounded-xl h-9 gap-1.5"><FolderInput className="h-4 w-4" /> Move{n ? ` ${n}` : ""}</Button>
            </div>
          </div>
        );
      })()}

      {/* New folder input (no height animation — avoids full-screen bug) */}
      {showNewFolder && (
        <div className="flex items-center gap-3 p-4 rounded-2xl border border-primary/30 bg-primary/5">
          <Folder className="h-5 w-5 text-primary shrink-0" />
          <input
            autoFocus
            className="flex-1 bg-transparent text-sm font-medium outline-none placeholder:text-muted-foreground min-w-0"
            placeholder="Folder name…"
            value={newFolderName}
            onChange={(e) => setNewFolderName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") createFolder();
              if (e.key === "Escape") setShowNewFolder(false);
            }}
          />
          <button
            onClick={createFolder}
            className="h-9 w-9 rounded-xl bg-primary text-primary-foreground grid place-items-center shrink-0"
          >
            <Check className="h-4 w-4" />
          </button>
          <button
            onClick={() => setShowNewFolder(false)}
            className="h-9 w-9 rounded-xl bg-secondary grid place-items-center shrink-0"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Error banner */}
      <AnimatePresence>
        {error && (
          <motion.div
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="flex items-center gap-3 p-3 rounded-xl bg-destructive/10 text-destructive text-sm"
          >
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span className="flex-1">{error}</span>
            <button onClick={() => setError(null)} className="shrink-0 p-1">
              <X className="h-4 w-4" />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Search: every folder and file in the catalog by name, wherever it is. */}
      {!picking && (
        <div className="relative max-w-md">
          <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
          <Input
            type="search"
            value={findQ}
            onChange={(e) => setFindQ(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Escape") setFindQ(""); }}
            placeholder="Search the whole catalog…"
            aria-label="Search the catalog"
            className="h-10 pl-9 pr-9 rounded-xl bg-white [&::-webkit-search-cancel-button]:hidden"
          />
          {findQ && (
            <button type="button" onClick={() => setFindQ("")} aria-label="Clear the search"
              className="absolute right-1.5 top-1/2 -translate-y-1/2 h-7 w-7 grid place-items-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary">
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      )}

      {/* ── Search results: folders (each with where it sits), then files ── */}
      {searching && (
        <div className="space-y-5">
          {foundFolders.length > 0 && (
            <div className="space-y-3">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider px-0.5">
                Folders · {foundFolders.length}
              </p>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-auto-photos gap-3 sm:gap-4">
                {foundFolders.map((folder) => {
                  const up = folder.parentId ? folderPathText(folders, folder.parentId) : "";
                  return (
                    <button key={folder.id} type="button" onClick={() => openFound(folder.id)}
                      className="flex items-start gap-2.5 rounded-2xl border border-border/60 bg-white shadow-sm p-3 text-left active:border-primary/40 hover:border-primary/40 min-w-0">
                      <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-amber-50 to-amber-100 overflow-hidden grid place-items-center shrink-0">
                        {folder.bannerUrl
                          ? <img src={folder.bannerUrl} alt="" className="w-full h-full object-cover" />
                          : <Folder className="h-5 w-5 text-amber-500" />}
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-foreground truncate" title={folder.name}>{folder.name}</p>
                        <p className="text-[11px] text-muted-foreground truncate" title={up || "Catalog"}>{up ? `in ${up}` : "In Catalog"}</p>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {(foundItems.length > 0 || filesPending) && (
            <div className="space-y-3">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider px-0.5">
                Files · {filesPending ? "…" : foundItems.length}
              </p>
              {foundItems.length > 0 && (
                <VirtualGrid
                  items={foundItems}
                  estimateRowHeight={ITEM_ROW_ESTIMATE_PX}
                  getKey={(item) => item.id}
                  renderItem={(item, i) => (
                    <ItemCard
                      item={item}
                      isFav={favIds.has(item.id)}
                      canEdit={canEdit || canDelete}
                      // Where it is: the whole way down, not just its folder.
                      folderName={folderPathText(folders, item.folderId) || undefined}
                      onOpen={() => setLightbox({ items: foundItems, idx: i })}
                      onToggleFav={() => toggleFavorite(item.id)}
                      onDelete={canDelete ? () => setDeleteConfirm(item.id) : undefined}
                      menu={isStaff ? itemMenu(item) : undefined}
                    />
                  )}
                />
              )}
              {filesPending && (
                <div className="flex items-center gap-2 py-3 text-xs text-muted-foreground">
                  <span className="h-4 w-4 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
                  Looking through every folder…
                </div>
              )}
            </div>
          )}

          {!filesPending && foundFolders.length === 0 && foundItems.length === 0 && (
            <div className="flex flex-col items-center justify-center py-12 text-center gap-3">
              <div className="h-16 w-16 rounded-2xl bg-primary/10 grid place-items-center">
                <Search className="h-8 w-8 text-primary/40" />
              </div>
              <p className="font-semibold text-brand-dark">Nothing named “{findQ.trim()}”</p>
            </div>
          )}
        </div>
      )}

      {/* ── Favourites folder view ── */}
      {!searching && viewingFavorites && (
        <FavoritesGallery
          favoriteItems={favoriteItems}
          folders={folders}
          canEdit={canEdit}
          canDelete={canDelete}
          onOpen={(its, idx) => setLightbox({ items: its, idx })}
          onToggleFav={toggleFavorite}
          onDelete={(id) => setDeleteConfirm(id)}
          itemMenu={isStaff ? itemMenu : undefined}
        />
      )}

      {/* ── Normal folder/gallery view ── */}
      {!searching && !viewingFavorites && (
        <>
          {/* Root: Favourites virtual card + real folders in one grid */}
          {isRoot && (subfolders.length > 0 || favoriteItems.length > 0) && (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-auto-photos gap-3 sm:gap-4">
              <FavoritesFolderCard />
              {subfolders.map((folder) => {
                const count = folderCounts[folder.id] ?? null;
                const coverUrl = folder.bannerUrl ?? folderThumbs[folder.id]?.data;
                const isRenaming = renamingId === folder.id;
                return (
                  <motion.div key={folder.id} whileTap={{ scale: 0.97 }} className="relative">
                    <button
                      onClick={() => {
                        if (picking) setPickedFolders((prev) => flip(prev, folder.id));
                    else if (!isRenaming) enterFolder(folder.id);
                      }}
                      aria-pressed={picking ? pickedFolders.has(folder.id) : undefined}
                  className={`w-full flex flex-col rounded-2xl border bg-white shadow-sm overflow-hidden text-left ${picking && pickedFolders.has(folder.id) ? "border-primary ring-2 ring-primary" : "border-border/60 active:border-primary/40"}`}
                    >
                      <div className="aspect-video w-full bg-gradient-to-br from-amber-50 to-amber-100 overflow-hidden relative">
                        {coverUrl ? (
                          <img src={coverUrl} alt="" className="w-full h-full object-cover" />
                        ) : (
                          <div className="absolute inset-0 flex items-center justify-center">
                            <Folder className="h-10 w-10 text-amber-400" />
                          </div>
                        )}
                      </div>
                      <div className="px-3 pt-2.5 pb-1 flex items-center gap-2">
                        <Folder className="h-3.5 w-3.5 text-amber-500 shrink-0" />
                        {isRenaming ? (
                          <input
                            autoFocus
                            className="flex-1 text-sm font-medium bg-transparent outline-none border-b border-primary min-w-0"
                            value={renameVal}
                            onChange={(e) => setRenameVal(e.target.value)}
                            onClick={(e) => e.stopPropagation()}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                e.stopPropagation();
                                renameFolder(folder.id);
                              }
                              if (e.key === "Escape") {
                                e.stopPropagation();
                                setRenamingId(null);
                              }
                            }}
                          />
                        ) : (
                          <span className="text-sm font-medium text-foreground truncate">
                            {folder.name}
                          </span>
                        )}
                      </div>
                      <div className="px-3 pb-2.5 text-[11px] text-muted-foreground">
                        {count === null ? "…" : `${count} item${count !== 1 ? "s" : ""}`}
                      </div>
                    </button>
                    {picking && <div className="absolute top-2 left-2 pointer-events-none"><PickTick on={pickedFolders.has(folder.id)} /></div>}
                {isStaff && !isRenaming && !picking && (
                      <div className="absolute top-2 right-2" onClick={(e) => e.stopPropagation()}>
                        <MoreMenu size="sm" label={`${folder.name}: more actions`} actions={folderMenu(folder)} />
                      </div>
                    )}
                    {isRenaming && (
                      <div className="absolute top-2 right-2 flex gap-1">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            renameFolder(folder.id);
                          }}
                          className="h-8 w-8 rounded-xl bg-primary text-primary-foreground grid place-items-center shadow-sm"
                        >
                          <Check className="h-4 w-4" />
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setRenamingId(null);
                          }}
                          className="h-8 w-8 rounded-xl bg-secondary grid place-items-center shadow-sm"
                        >
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
              </div>
            </div>
          )}

          {/* Sub-folder empty state */}
          {!isRoot &&
            subfolders.length === 0 &&
            items.length === 0 &&
            !itemsLoading &&
            !showNewFolder && (
              <div className="flex flex-col items-center justify-center py-12 text-center gap-3">
                <div className="h-16 w-16 rounded-2xl bg-primary/10 grid place-items-center">
                  <ImageIcon className="h-8 w-8 text-primary/40" />
                </div>
                <div>
                  <p className="font-semibold text-brand-dark">This folder is empty</p>
                  {canAdd && <p className="text-sm text-muted-foreground mt-0.5">Add a subfolder or upload below.</p>}
                </div>
              </div>
            )}

          {/* Item gallery */}
          <ItemGallery
            picking={picking}
            pickedIds={pickedItems}
            onPick={(id) => setPickedItems((prev) => flip(prev, id))}
            items={items}
            itemsLoading={itemsLoading}
            itemsHasMore={itemsHasMore}
            canEdit={canEdit}
            canDelete={canDelete}
            favIds={favIds}
            bannerItemId={folders.find((f) => f.id === currentFolderId)?.bannerItemId}
            sort={itemsSort}
            sentinelRef={itemsSentinelRef}
            onOpen={(its, idx) => setLightbox({ items: its, idx })}
            onToggleFav={toggleFavorite}
            onDelete={(id) => setDeleteConfirm(id)}
            onSetBanner={(item) => currentFolderId && setFolderBanner(currentFolderId, item)}
            onSortChange={setItemsSort}
            itemMenu={isStaff ? itemMenu : undefined}
          />
        </>
      )}

      {/* ── Modals ── */}
      <DeleteModal />
      <ArrangeFoldersSheet open={arranging} onClose={() => setArranging(false)} onSaved={reload} folders={subfolders}
        title={breadcrumb.length ? breadcrumb[breadcrumb.length - 1].name : "Catalog"} />
      <ShareFoldersSheet open={sharePicker} onClose={() => setSharePicker(false)} folders={subfolders} counts={folderCounts}
        onPick={(f) => { setSharePicker(false); setSharingFolder(f); }} />
      {sharingFolder && (
        <ShareFolderButton key={sharingFolder.id} kind="catalog" folderId={sharingFolder.id} folderName={sharingFolder.name}
          autoOpen onClose={() => setSharingFolder(null)} />
      )}
      {movingFolder && (
        <FolderMoveSheet folder={movingFolder} folders={folders}
          blocked={[movingFolder.id, ...descendantIds(movingFolder.id)]} onClose={() => setMovingFolder(null)} />
      )}
      {itemSheet && (
        <CatalogItemSheet item={itemSheet.item} mode={itemSheet.mode} folders={folders}
          onClose={() => setItemSheet(null)} onSaved={(next) => itemSaved(next, itemSheet.item)} />
      )}
      {bulkMoving && (
        <BulkMoveSheet folderIds={[...pickedFolders]} itemIds={[...pickedItems]} folders={folders} here={currentFolderId}
          blocked={[...pickedFolders].flatMap((id) => [id, ...descendantIds(id)])}
          onClose={() => setBulkMoving(false)}
          onMoved={(to) => {
            // Moved files leave the grid on screen; a banner that went with them is dropped.
            const moved = new Set(pickedItems);
            if (moved.size && to) {
              setItems((prev) => prev.filter((it) => !moved.has(it.id)));
              setFavoriteItems((prev) => prev.map((it) => (moved.has(it.id) ? { ...it, folderId: to } : it)));
              setAllItems((prev) => prev && prev.map((it) => (moved.has(it.id) ? { ...it, folderId: to } : it)));
              const banner = folders.find((f) => f.id === currentFolderId)?.bannerItemId;
              if (banner && moved.has(banner)) {
                updateDb((db) => {
                  const f = db.catalogFolders.find((x) => x.id === currentFolderId);
                  if (f?.bannerItemId === banner) { delete f.bannerItemId; delete f.bannerUrl; }
                });
              }
            }
            stopPicking();
          }} />
      )}
      <AnimatePresence>
        {lightbox && (
          <Lightbox
            items={lightbox.items}
            startIndex={lightbox.idx}
            onClose={() => setLightbox(null)}
            // As the item's ⋯ → Download, and logged: a staff member needs export access;
            // a client downloads what they can see, as they always could from here.
            onDownload={(item) => downloadFile(item.data, downloadName(item), !isAdmin)}
            downloadBlocked={isStaff && !canShare ? needsAccess("catalog", "export") : undefined}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
