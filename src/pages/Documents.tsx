import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import {
  ArrowDown, ArrowUp, ArrowUpDown, ChevronRight, Download, ExternalLink, File as FileIcon, FileText, Folder, FolderInput,
  FolderOpen, FolderPlus, Image as ImageIcon, Link2, Loader2, Pencil, RotateCcw, ScanLine, Search, Share2,
  StickyNote, Trash2, Upload, X,
} from "lucide-react";
import { PageHeader, ViewSwitch } from "@/components/PageHeader";
import { ActionSheet } from "@/components/ActionSheet";
import { DataTable, type DataColumn } from "@/components/DataTable";
import { MoreMenu, type MoreAction } from "@/components/MoreMenu";
import { SectionTitle } from "@/components/SectionTitle";
import { zoomable } from "@/components/ImageViewer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ScanSheet } from "@/components/documents/ScanSheet";
import { ShareSheet, SharedLinksSheet } from "@/components/documents/ShareSheet";
import { useAuth } from "@/lib/auth";
import { useDb } from "@/hooks/useDb";
import { useEntryState, useBackToClose } from "@/hooks/useBackNav";
import { confirmBox } from "@/lib/confirm";
import { fmtDate } from "@/lib/db";
import type { DocFolder, DocItem, DocShare } from "@/lib/documentsModel";
import {
  createFolder, deleteFolderForever, deleteItemForever, fileSize, folderAndBelow, folderLabel,
  folderTrail, folderTrashed, itemTrashed, moveFolder, moveItems, renameFolder, renameItem, reorderFolders,
  restoreFolder, restoreItem, saveDocument, setItemNotes, shareExpired, sortFolders, trashFolder, trashItem, uploadDocuments,
  useDocFolders, useDocItems, useDocShares,
} from "@/lib/documents";

/**
 * Documents — the business's own papers (agreements, licences, bills, KYC,
 * scans), in folders like the Catalog's. Admins, and the people an admin lets
 * in (Edit details → Documents access), upload files, scan papers with the
 * camera into one PDF, and share a document or a folder outside by a link that
 * always needs a password (lib/documents.ts, components/documents/).
 *
 * Nothing here ever removes a file from storage: Move to Trash can be undone,
 * and Delete forever (from the Trash) removes the record only.
 */

const VIEW_KEY = "sl-docs-view";
const norm = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "");

/** "PDF", "Photo", "XLSX"… */
function typeOf(it: DocItem): string {
  if (it.kind === "pdf") return it.source === "scan" ? "PDF · scan" : "PDF";
  if (it.kind === "image") return "Photo";
  const ext = (it.name.match(/\.([a-z0-9]{2,5})$/i) ?? it.path.match(/\.([a-z0-9]{2,5})$/i))?.[1];
  return ext ? ext.toUpperCase() : "File";
}

function KindIcon({ it, className = "h-10 w-10" }: { it: DocItem; className?: string }) {
  if (it.kind === "pdf") return <FileText className={`${className} text-rose-500`} />;
  if (it.kind === "image") return <ImageIcon className={`${className} text-sky-500`} />;
  return <FileIcon className={`${className} text-slate-400`} />;
}

/** Nothing here yet, and what to do about it. */
function Empty({ icon: Icon, title, text, children }: { icon: typeof Folder; title: string; text: string; children?: ReactNode }) {
  return (
    <div className="rounded-2xl border-2 border-dashed border-border bg-white/60 p-8 sm:p-10 text-center space-y-4">
      <div className="h-16 w-16 rounded-2xl bg-primary/10 grid place-items-center mx-auto"><Icon className="h-8 w-8 text-primary" /></div>
      <div>
        <p className="font-display text-lg text-brand-dark">{title}</p>
        <p className="text-sm text-muted-foreground mt-1 max-w-md mx-auto">{text}</p>
      </div>
      {children && <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-center gap-2">{children}</div>}
    </div>
  );
}

export function DocumentsPage() {
  const { user } = useAuth();
  const db = useDb();
  const F = useDocFolders();
  const I = useDocItems();
  const S = useDocShares();
  const me = user?.id ?? "";

  // Where you are, and the search — kept for this visit (Back brings them back).
  const [folderId, setFolderId] = useEntryState<string | null>("docs:folder", null);
  const [q, setQ] = useEntryState("docs:q", "");
  const [view, setViewState] = useState<"grid" | "list">(() => {
    try { return localStorage.getItem(VIEW_KEY) === "list" ? "list" : "grid"; } catch { return "grid"; }
  });
  const setView = (v: "grid" | "list") => { setViewState(v); try { localStorage.setItem(VIEW_KEY, v); } catch { /* private window */ } };

  const [upload, setUpload] = useState<null | { done: number; total: number; pct: number; name: string }>(null);
  const [scanOpen, setScanOpen] = useState(false);
  const [naming, setNaming] = useState<null | { mode: "new" } | { mode: "folder"; f: DocFolder } | { mode: "item"; it: DocItem }>(null);
  const [moving, setMoving] = useState<null | { kind: "folder"; f: DocFolder } | { kind: "item"; it: DocItem }>(null);
  const [notesFor, setNotesFor] = useState<DocItem | null>(null);
  const [sharing, setSharing] = useState<null | { target: DocShare["target"]; name: string }>(null);
  const [linksOpen, setLinksOpen] = useState(false);
  const [trashOpen, setTrashOpen] = useState(false);
  const [arranging, setArranging] = useState(false);
  const [viewing, setViewing] = useState<DocItem | null>(null);
  const [dragging, setDragging] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const dragDepth = useRef(0);

  const all = F.rows;
  const liveFolders = useMemo(() => all.filter(f => !folderTrashed(all, f.id)), [all]);
  const liveItems = useMemo(() => I.rows.filter(i => !itemTrashed(all, i)), [I.rows, all]);
  const trashCount = all.filter(f => f.deletedAt).length + I.rows.filter(i => i.deletedAt).length;

  // A folder that has gone (to the Trash, or deleted on another device) — back to the top.
  useEffect(() => {
    if (!F.loading && folderId && !liveFolders.some(f => f.id === folderId)) setFolderId(null);
  }, [F.loading, folderId, liveFolders]); // eslint-disable-line react-hooks/exhaustive-deps

  const trail = folderTrail(all, folderId);
  const current = trail[trail.length - 1] ?? null;
  const hereName = current?.name ?? "Documents";

  // How many documents each folder holds, the ones in folders under it too.
  const counts = useMemo(() => {
    const by = new Map(all.map(f => [f.id, f]));
    const n = new Map<string, number>();
    for (const it of liveItems) {
      const seen = new Set<string>();
      let f = it.folderId ? by.get(it.folderId) : undefined;
      while (f && !seen.has(f.id)) { seen.add(f.id); n.set(f.id, (n.get(f.id) ?? 0) + 1); f = f.parentId ? by.get(f.parentId) : undefined; }
    }
    return n;
  }, [all, liveItems]);
  // What has a working link, for the small "shared" mark.
  const shared = useMemo(() => new Set(S.rows.filter(s => s.active && !shareExpired(s)).map(s => `${s.target.kind}:${s.target.id}`)), [S.rows]);
  const nameOf = (id: string) => db.users.find(u => u.id === id)?.name ?? "—";

  const searching = q.trim().length > 0;
  const words = norm(q).split(/\s+/).filter(Boolean);
  const hit = (...texts: (string | undefined)[]) => { const t = norm(texts.filter(Boolean).join(" ")); return words.every(w => t.includes(w)); };
  const subfolders = searching
    ? sortFolders(liveFolders.filter(f => hit(f.name)))
    : sortFolders(liveFolders.filter(f => f.parentId === folderId));
  const docs = (searching
    ? liveItems.filter(i => hit(i.name, i.notes, typeOf(i)))
    : liveItems.filter(i => i.folderId === folderId))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  /* ─────────────── Uploads ─────────────── */

  // Leaving mid-upload loses what hasn't gone up yet — the browser asks first.
  useEffect(() => {
    if (!upload) return;
    const stop = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", stop);
    return () => window.removeEventListener("beforeunload", stop);
  }, [upload]);

  const doUpload = async (files: File[]) => {
    if (!files.length || !me) return;
    if (upload) { toast.error("Wait for the files going up now to finish"); return; }
    const into = folderId, intoName = hereName;
    setUpload({ done: 0, total: files.length, pct: 0, name: files[0].name });
    try {
      const { added, failed } = await uploadDocuments(files, into, me, p => setUpload(p));
      if (added.length) toast.success(`${added.length === 1 ? `"${added[0].name}"` : `${added.length} documents`} uploaded to ${intoName}`);
      if (failed.length) toast.error(`${failed.length} couldn't be uploaded: ${failed.slice(0, 3).join(", ")}${failed.length > 3 ? "…" : ""}`);
    } finally { setUpload(null); }
  };

  // Files dropped anywhere on the page go into the folder that is open.
  const hasFiles = (e: React.DragEvent) => [...e.dataTransfer.types].includes("Files");
  const dnd = {
    onDragEnter: (e: React.DragEvent) => { if (!hasFiles(e)) return; e.preventDefault(); dragDepth.current++; setDragging(true); },
    onDragOver: (e: React.DragEvent) => { if (!hasFiles(e)) return; e.preventDefault(); e.dataTransfer.dropEffect = "copy"; },
    onDragLeave: (e: React.DragEvent) => { if (!hasFiles(e)) return; dragDepth.current = Math.max(0, dragDepth.current - 1); if (!dragDepth.current) setDragging(false); },
    onDrop: (e: React.DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault(); dragDepth.current = 0; setDragging(false);
      doUpload([...e.dataTransfer.files]);
    },
  };

  /* ─────────────── Actions ─────────────── */

  const fail = (e: unknown, what: string) => toast.error(`${what} — ${e instanceof Error ? e.message : "try again"}`);

  const openFolder = (id: string | null) => { setQ(""); setFolderId(id); window.scrollTo({ top: 0 }); };

  const openItem = (it: DocItem) => {
    // A photo opens here, large; a PDF or any other file in its own tab (a phone's own PDF viewer).
    if (it.kind === "image") setViewing(it);
    else window.open(it.url, "_blank", "noopener");
  };

  const toTrashItem = async (it: DocItem) => {
    try {
      await trashItem(it.id);
      toast.success(`"${it.name}" moved to the Trash`, {
        action: { label: "Undo", onClick: () => { restoreItem(all, it).catch(e => fail(e, "Couldn't bring it back")); } },
      });
    } catch (e) { fail(e, "Couldn't move it to the Trash"); }
  };

  const toTrashFolder = async (f: DocFolder) => {
    const n = counts.get(f.id) ?? 0;
    const inside = liveFolders.filter(x => x.parentId === f.id).length;
    if (n || inside) {
      const what = [n && `${n} document${n === 1 ? "" : "s"}`, inside && `${inside} folder${inside === 1 ? "" : "s"}`].filter(Boolean).join(" and ");
      if (!(await confirmBox(`Move "${f.name}" to the Trash?\n\nIts ${what} go with it. You can bring it all back from the Trash.`))) return;
    }
    try {
      await trashFolder(f.id);
      toast.success(`"${f.name}" moved to the Trash`, {
        action: { label: "Undo", onClick: () => { restoreFolder(all, f.id).catch(e => fail(e, "Couldn't bring it back")); } },
      });
    } catch (e) { fail(e, "Couldn't move it to the Trash"); }
  };

  const folderMenu = (f: DocFolder): MoreAction[] => [
    { label: "Open", icon: FolderOpen, onSelect: () => openFolder(f.id) },
    { label: "Rename", icon: Pencil, onSelect: () => setNaming({ mode: "folder", f }) },
    { label: "Share…", icon: Share2, hint: "A link with a password", onSelect: () => setSharing({ target: { kind: "folder", id: f.id }, name: f.name }) },
    { label: "Move to…", icon: FolderInput, onSelect: () => setMoving({ kind: "folder", f }) },
    { label: "Move to Trash", icon: Trash2, danger: true, onSelect: () => toTrashFolder(f) },
  ];

  const itemMenu = (it: DocItem): MoreAction[] => [
    { label: "Open", icon: ExternalLink, onSelect: () => openItem(it) },
    { label: "Download", icon: Download, onSelect: () => saveDocument(it) },
    { label: "Show in its folder", icon: FolderOpen, show: searching, hint: folderLabel(all, it.folderId), onSelect: () => openFolder(it.folderId) },
    { label: "Rename", icon: Pencil, onSelect: () => setNaming({ mode: "item", it }) },
    { label: it.notes ? "Edit notes" : "Add notes", icon: StickyNote, onSelect: () => setNotesFor(it) },
    { label: "Move to…", icon: FolderInput, onSelect: () => setMoving({ kind: "item", it }) },
    { label: "Share…", icon: Share2, hint: "A link with a password", onSelect: () => setSharing({ target: { kind: "item", id: it.id }, name: it.name }) },
    { label: "Move to Trash", icon: Trash2, danger: true, onSelect: () => toTrashItem(it) },
  ];

  /* ─────────────── Pieces ─────────────── */

  const crumbs = (
    <nav aria-label="Folders" className="flex items-center gap-1 flex-wrap text-sm min-w-0">
      <button type="button" onClick={() => openFolder(null)} className="font-medium shrink-0 text-primary hover:underline">Documents</button>
      {trail.slice(0, -1).map(f => (
        <span key={f.id} className="flex items-center gap-1 min-w-0">
          <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          <button type="button" onClick={() => openFolder(f.id)} className="font-medium truncate max-w-[120px] sm:max-w-[200px] text-primary hover:underline">{f.name}</button>
        </span>
      ))}
    </nav>
  );

  const folderGrid = subfolders.length > 0 && (
    <section className="space-y-3">
      <SectionTitle title="Folders" sub={`${subfolders.length} folder${subfolders.length === 1 ? "" : "s"}`} />
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5 gap-3">
        {subfolders.map(f => {
          const n = counts.get(f.id) ?? 0;
          return (
            <div key={f.id} className="relative min-w-0">
              <button type="button" onClick={() => openFolder(f.id)}
                className="w-full flex flex-col rounded-2xl border border-border/60 bg-white shadow-sm overflow-hidden text-left hover:border-primary/40 active:border-primary/40">
                <div className="aspect-video w-full bg-gradient-to-br from-amber-50 to-amber-100 grid place-items-center relative">
                  <Folder className="h-10 w-10 text-amber-400" />
                  {shared.has(`folder:${f.id}`) && <span className="absolute bottom-2 left-2 inline-flex items-center gap-1 rounded-full bg-white/90 px-1.5 py-0.5 text-[10.5px] font-medium text-emerald-700 shadow-sm"><Link2 className="h-3 w-3" />Shared</span>}
                </div>
                <div className="px-3 pt-2.5 pb-2.5 min-w-0">
                  <p className="text-sm font-medium text-foreground truncate" title={f.name}>{f.name}</p>
                  <p className="text-[11px] text-muted-foreground truncate">
                    {searching && f.parentId ? `in ${folderLabel(all, f.parentId)} · ` : ""}{n} document{n === 1 ? "" : "s"}
                  </p>
                </div>
              </button>
              <div className="absolute top-2 right-2 rounded-lg bg-white/90 shadow-sm">
                <MoreMenu size="sm" label={`${f.name}: more actions`} actions={folderMenu(f)} />
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );

  const columns: DataColumn<DocItem>[] = [
    { key: "name", header: "Name", always: true, sortValue: r => r.name, csv: r => r.name, kind: "text",
      cell: r => (
        <span className="flex items-center gap-2.5 min-w-0">
          <span className="h-9 w-9 shrink-0 rounded-lg bg-secondary/60 grid place-items-center overflow-hidden">
            {r.thumb ? <img src={r.thumb} alt="" loading="lazy" className="h-full w-full object-cover" {...(r.kind === "image" ? zoomable(r.url) : {})} /> : <KindIcon it={r} className="h-5 w-5" />}
          </span>
          <span className="min-w-0">
            <span className="block font-medium truncate max-w-[22rem]" title={r.name}>{r.name}</span>
            {r.notes && <span className="block text-[11px] text-muted-foreground truncate max-w-[22rem]">{r.notes}</span>}
          </span>
          {shared.has(`item:${r.id}`) && <Link2 className="h-3.5 w-3.5 text-emerald-600 shrink-0" aria-label="Shared" />}
        </span>
      ) },
    { key: "type", header: "Type", sortValue: r => typeOf(r), cell: r => <span className="whitespace-nowrap">{typeOf(r)}{r.pages ? ` · ${r.pages} p` : ""}</span> },
    { key: "size", header: "Size", align: "right", kind: "number", sortValue: r => r.size ?? 0, cell: r => <span className="tabular-nums whitespace-nowrap">{fileSize(r.size)}</span> },
    { key: "folder", header: "Folder", hidden: !searching, sortValue: r => folderLabel(all, r.folderId), cell: r => <span className="truncate">{folderLabel(all, r.folderId)}</span> },
    { key: "added", header: "Added", kind: "date", sortValue: r => r.createdAt, cell: r => <span className="whitespace-nowrap">{fmtDate(r.createdAt)}</span> },
    { key: "by", header: "By", sortValue: r => nameOf(r.createdBy), cell: r => <span className="truncate">{nameOf(r.createdBy)}</span> },
  ];

  const docGrid = (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5 gap-3">
      {docs.map(it => (
        <div key={it.id} className="relative min-w-0">
          <button type="button" onClick={() => openItem(it)}
            className="w-full flex flex-col rounded-2xl border border-border/60 bg-white shadow-sm overflow-hidden text-left hover:border-primary/40 active:border-primary/40">
            <div className="aspect-[4/3] w-full bg-secondary/40 grid place-items-center overflow-hidden relative">
              {it.thumb ? <img src={it.thumb} alt="" loading="lazy" className="w-full h-full object-cover object-top" /> : <KindIcon it={it} />}
              {it.kind === "pdf" && it.thumb && <span className="absolute bottom-2 right-2 rounded-md bg-rose-600 text-white text-[10px] font-bold px-1.5 py-0.5">PDF</span>}
              {shared.has(`item:${it.id}`) && <span className="absolute bottom-2 left-2 inline-flex items-center gap-1 rounded-full bg-white/90 px-1.5 py-0.5 text-[10.5px] font-medium text-emerald-700 shadow-sm"><Link2 className="h-3 w-3" />Shared</span>}
            </div>
            <div className="px-3 pt-2 pb-2.5 min-w-0">
              <p className="text-sm font-medium text-foreground line-clamp-2 break-words" title={it.name}>{it.name}</p>
              <p className="text-[11px] text-muted-foreground truncate mt-0.5">{[typeOf(it), fileSize(it.size), fmtDate(it.createdAt)].filter(Boolean).join(" · ")}</p>
              {searching && <p className="text-[11px] text-muted-foreground truncate">in {folderLabel(all, it.folderId)}</p>}
            </div>
          </button>
          <div className="absolute top-2 right-2 rounded-lg bg-white/90 shadow-sm">
            <MoreMenu size="sm" label={`${it.name}: more actions`} actions={itemMenu(it)} />
          </div>
        </div>
      ))}
    </div>
  );

  const loading = F.loading || I.loading;
  const error = F.error || I.error;
  const emptyHere = !loading && !error && !searching && subfolders.length === 0 && docs.length === 0;

  return (
    <div className="max-w-7xl mx-auto space-y-5 relative min-h-[60vh]" {...dnd}>
      <input ref={fileRef} type="file" multiple className="hidden"
        onChange={e => { const fs = [...(e.target.files ?? [])]; e.currentTarget.value = ""; doUpload(fs); }} />

      <PageHeader
        eyebrow={trail.length ? crumbs : undefined}
        title={hereName}
        info="Only admins, and the people an admin allows, can open Documents. A shared link always needs its password."
        subtitle={loading ? "Loading…" : [
          subfolders.length > 0 && !searching && `${subfolders.length} folder${subfolders.length === 1 ? "" : "s"}`,
          !searching && `${docs.length} document${docs.length === 1 ? "" : "s"}`,
          searching && `${subfolders.length + docs.length} found`,
        ].filter(Boolean).join(" · ")}
        primary={{ label: "Upload", icon: Upload, disabled: !!upload, title: upload ? "Uploading…" : `Upload files into ${hereName}`, onClick: () => fileRef.current?.click() }}
        secondary={{ label: "Scan", icon: ScanLine, title: "Scan papers with the camera into one PDF", onClick: () => setScanOpen(true) }}
        menu={[
          { label: "New folder", icon: FolderPlus, hint: `In ${hereName}`, onSelect: () => setNaming({ mode: "new" }) },
          { label: "Arrange folders", icon: ArrowUpDown, show: !searching && subfolders.length > 1, hint: "Set the order they show in", onSelect: () => setArranging(true) },
          { label: "Shared links", icon: Link2, hint: "Every link: turn off, end date, opens", onSelect: () => setLinksOpen(true) },
          { label: "Trash", icon: Trash2, hint: trashCount ? `${trashCount} to restore or delete` : "Empty", onSelect: () => setTrashOpen(true) },
        ]}
      />

      {/* Search across every folder, and the grid / list switch. */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1 min-w-0 max-w-xl">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
          <Input value={q} onChange={e => setQ(e.target.value)} placeholder="Search all documents" aria-label="Search all documents"
            className="h-10 rounded-xl pl-9 pr-9 bg-white" />
          {q && (
            <button type="button" onClick={() => setQ("")} aria-label="Clear search"
              className="absolute right-1 top-1/2 -translate-y-1/2 h-8 w-8 grid place-items-center rounded-lg text-muted-foreground hover:text-foreground">
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
        <ViewSwitch view={view} onChange={setView} />
      </div>

      {upload && (
        <div className="sticky top-2 z-20 rounded-2xl border border-primary/25 bg-white/95 backdrop-blur px-4 py-3 shadow-md space-y-2" role="status">
          <p className="text-sm font-medium text-brand-dark flex items-center gap-2 min-w-0">
            <Loader2 className="h-4 w-4 animate-spin text-primary shrink-0" />
            <span className="truncate">Uploading {upload.total > 1 ? `${upload.done + 1} of ${upload.total} · ` : ""}{upload.name}</span>
            <span className="ml-auto tabular-nums text-xs text-muted-foreground shrink-0">{upload.pct}%</span>
          </p>
          <div className="h-1.5 rounded-full bg-secondary overflow-hidden">
            <div className="h-full bg-primary transition-[width]" style={{ width: `${Math.round(((upload.done + upload.pct / 100) / upload.total) * 100)}%` }} />
          </div>
        </div>
      )}

      {error ? (
        <Empty icon={FolderOpen} title="Documents couldn't be opened"
          text={error === "permission-denied"
            ? "This account isn't allowed into Documents yet. An admin turns it on in Employees → Edit details → Documents access."
            : `Something went wrong reading them (${error}). Check the connection and open the page again.`} />
      ) : loading ? (
        <div className="py-16 grid place-items-center text-muted-foreground"><Loader2 className="h-6 w-6 animate-spin" /></div>
      ) : emptyHere ? (
        folderId ? (
          <Empty icon={FolderOpen} title="This folder is empty" text="Drop files here, or use Upload or Scan. A folder inside it: ⋯ → New folder.">
            <Button onClick={() => fileRef.current?.click()} className="btn-hero rounded-xl h-10 gap-2"><Upload className="h-4 w-4" />Upload</Button>
            <Button variant="outline" onClick={() => setScanOpen(true)} className="rounded-xl h-10 gap-2"><ScanLine className="h-4 w-4" />Scan</Button>
          </Empty>
        ) : (
          <Empty icon={FileText} title="No documents yet" text="Keep the business's papers here: upload files, scan papers with the camera into a PDF, and make folders to sort them. Drop files anywhere on this page to upload.">
            <Button onClick={() => fileRef.current?.click()} className="btn-hero rounded-xl h-10 gap-2"><Upload className="h-4 w-4" />Upload</Button>
            <Button variant="outline" onClick={() => setScanOpen(true)} className="rounded-xl h-10 gap-2"><ScanLine className="h-4 w-4" />Scan</Button>
            <Button variant="outline" onClick={() => setNaming({ mode: "new" })} className="rounded-xl h-10 gap-2"><FolderPlus className="h-4 w-4" />New folder</Button>
          </Empty>
        )
      ) : searching && subfolders.length === 0 && docs.length === 0 ? (
        <Empty icon={Search} title={`Nothing matches "${q.trim()}"`} text="The search looks at every folder: document names, notes and folder names." />
      ) : (
        <>
          {folderGrid}
          {docs.length > 0 && (
            <section className="space-y-3">
              {view === "grid" && <SectionTitle title="Documents" sub={`${docs.length} document${docs.length === 1 ? "" : "s"}`} />}
              {view === "grid" ? docGrid : (
                <DataTable id="documents" stateKey={`documents:${searching ? "search" : folderId ?? "top"}`} rows={docs} columns={columns} rowKey={r => r.id}
                  defaultSort={{ key: "added", dir: "desc" }} noun="document" onRowClick={openItem} rowActions={itemMenu} details={false}
                  resetKey={`${folderId ?? ""}|${q}`} />
              )}
            </section>
          )}
          {!searching && docs.length === 0 && subfolders.length > 0 && (
            <p className="text-xs text-muted-foreground px-0.5">No documents loose here — they are in the folders. Drop files on the page to add them here.</p>
          )}
        </>
      )}

      {/* Files dragged over the page. */}
      {dragging && (
        <div className="pointer-events-none fixed inset-0 z-40 bg-primary/10 backdrop-blur-[1px] grid place-items-center p-6">
          <div className="rounded-2xl border-2 border-dashed border-primary bg-white px-8 py-6 text-center shadow-xl">
            <Upload className="h-8 w-8 text-primary mx-auto" />
            <p className="mt-2 font-medium text-brand-dark">Drop to upload into {hereName}</p>
          </div>
        </div>
      )}

      <ScanSheet open={scanOpen} onClose={() => setScanOpen(false)} folderId={folderId} folderName={hereName} by={me} />
      <NameSheet state={naming} onClose={() => setNaming(null)} folders={liveFolders} here={folderId} by={me} />
      <MoveSheet state={moving} onClose={() => setMoving(null)} all={all} live={liveFolders} />
      <NotesSheet item={notesFor} onClose={() => setNotesFor(null)} />
      <ShareSheet target={sharing?.target ?? null} name={sharing?.name ?? ""} onClose={() => setSharing(null)} />
      <SharedLinksSheet open={linksOpen} onClose={() => setLinksOpen(false)} folders={all} items={I.rows} />
      <TrashSheet open={trashOpen} onClose={() => setTrashOpen(false)} folders={all} items={I.rows} shares={S.rows} />
      <ArrangeSheet open={arranging} onClose={() => setArranging(false)} folders={subfolders} where={hereName} />
      <PhotoViewer item={viewing} onClose={() => setViewing(null)} />
    </div>
  );
}

/* ─────────────── Panels ─────────────── */

/** A new folder's name, or a new name for a folder or a document. */
function NameSheet({ state, onClose, folders, here, by }: {
  state: null | { mode: "new" } | { mode: "folder"; f: DocFolder } | { mode: "item"; it: DocItem };
  onClose: () => void;
  folders: DocFolder[];
  here: string | null;
  by: string;
}) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const key = !state ? "" : state.mode === "new" ? "new" : state.mode === "folder" ? state.f.id : state.it.id;
  useEffect(() => {
    if (!state) return;
    setName(state.mode === "new" ? "" : state.mode === "folder" ? state.f.name : state.it.name);
    setBusy(false);
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = async () => {
    if (!state) return;
    const n = name.trim();
    if (!n) { toast.error("Enter a name"); return; }
    // Two folders of one name side by side can't be told apart.
    const parent = state.mode === "new" ? here : state.mode === "folder" ? state.f.parentId : null;
    if (state.mode !== "item" && folders.some(f => f.parentId === parent && f.name.trim().toLowerCase() === n.toLowerCase() && (state.mode === "new" || f.id !== state.f.id))) {
      toast.error("A folder with that name is already here"); return;
    }
    setBusy(true);
    try {
      if (state.mode === "new") { await createFolder(n, here, by); toast.success(`Folder "${n}" made`); }
      else if (state.mode === "folder") { await renameFolder(state.f.id, n); toast.success("Folder renamed"); }
      else { await renameItem(state.it.id, n); toast.success("Renamed"); }
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? `Couldn't save — ${e.message}` : "Couldn't save");
      setBusy(false);
    }
  };
  const title = state?.mode === "new" ? "New folder" : state?.mode === "folder" ? "Rename folder" : "Rename document";
  return (
    <ActionSheet open={!!state} onOpenChange={o => { if (!o && !busy) onClose(); }} size="md" icon={state?.mode === "new" ? FolderPlus : Pencil}
      title={title}
      description={state?.mode === "new" ? `In ${folderLabel(folders, here)}` : undefined}
      footer={
        <div className="flex items-center justify-end gap-2">
          <Button variant="outline" onClick={onClose} disabled={busy} className="rounded-xl h-10">Cancel</Button>
          <Button onClick={save} disabled={busy} className="btn-hero rounded-xl h-10 px-8 gap-2">{busy && <Loader2 className="h-4 w-4 animate-spin" />}{state?.mode === "new" ? "Create" : "Save"}</Button>
        </div>
      }>
      <form noValidate onSubmit={e => { e.preventDefault(); save(); }}>
        <Label htmlFor="doc-name" className="text-xs">Name</Label>
        <Input id="doc-name" autoFocus value={name} onChange={e => setName(e.target.value)} className="h-10 rounded-xl mt-1" />
      </form>
    </ActionSheet>
  );
}

/** Where a folder or a document goes: the top, or any folder (never a folder into itself). */
function MoveSheet({ state, onClose, all, live }: {
  state: null | { kind: "folder"; f: DocFolder } | { kind: "item"; it: DocItem };
  onClose: () => void;
  all: DocFolder[];
  live: DocFolder[];
}) {
  const [pick, setPick] = useState<string | null | undefined>(undefined);
  const [find, setFind] = useState("");
  const [busy, setBusy] = useState(false);
  const key = !state ? "" : state.kind === "folder" ? state.f.id : state.it.id;
  useEffect(() => { setPick(undefined); setFind(""); setBusy(false); }, [key]);
  const now = !state ? null : state.kind === "folder" ? state.f.parentId : state.it.folderId;
  const blocked = state?.kind === "folder" ? folderAndBelow(all, state.f.id) : new Set<string>();
  const options = [
    { id: null as string | null, label: "Documents (the top)" },
    ...live.filter(f => !blocked.has(f.id)).map(f => ({ id: f.id as string | null, label: folderLabel(all, f.id) }))
      .sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true, sensitivity: "base" })),
  ].filter(o => !find.trim() || o.label.toLowerCase().includes(find.trim().toLowerCase()));

  const move = async () => {
    if (!state || pick === undefined) return;
    setBusy(true);
    try {
      if (state.kind === "folder") await moveFolder(all, state.f.id, pick);
      else await moveItems([state.it.id], pick);
      toast.success(`Moved to ${pick ? folderLabel(all, pick) : "Documents"}`);
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? `Couldn't move it — ${e.message}` : "Couldn't move it");
      setBusy(false);
    }
  };
  const name = !state ? "" : state.kind === "folder" ? state.f.name : state.it.name;
  return (
    <ActionSheet open={!!state} onOpenChange={o => { if (!o && !busy) onClose(); }} size="md" icon={FolderInput}
      title={`Move "${name}"`} description={`Now in ${folderLabel(all, now)}`}
      footer={
        <div className="flex items-center justify-end gap-2">
          <Button variant="outline" onClick={onClose} disabled={busy} className="rounded-xl h-10">Cancel</Button>
          <Button onClick={move} disabled={busy || pick === undefined || pick === now} className="btn-hero rounded-xl h-10 px-8 gap-2">{busy && <Loader2 className="h-4 w-4 animate-spin" />}Move here</Button>
        </div>
      }>
      <div className="space-y-3">
        <Input value={find} onChange={e => setFind(e.target.value)} placeholder="Find a folder" aria-label="Find a folder" className="h-10 rounded-xl" />
        <div className="rounded-xl border border-border/70 divide-y divide-border/60 overflow-hidden">
          {options.map(o => {
            const on = pick === o.id, here = o.id === now;
            return (
              <button key={o.id ?? "top"} type="button" disabled={here} onClick={() => setPick(o.id)} aria-pressed={on}
                className={`w-full flex items-center gap-2.5 px-3 min-h-11 py-2 text-left text-sm ${on ? "bg-primary/[0.07] text-brand-dark font-medium" : "bg-white hover:bg-secondary/50"} disabled:opacity-50`}>
                <Folder className={`h-4 w-4 shrink-0 ${on ? "text-primary" : "text-amber-500"}`} />
                <span className="min-w-0 flex-1 break-words">{o.label}</span>
                {here && <span className="text-[11px] text-muted-foreground shrink-0">Here now</span>}
              </button>
            );
          })}
          {options.length === 0 && <p className="p-4 text-sm text-muted-foreground text-center">No folder by that name.</p>}
        </div>
      </div>
    </ActionSheet>
  );
}

function NotesSheet({ item, onClose }: { item: DocItem | null; onClose: () => void }) {
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { setNotes(item?.notes ?? ""); setBusy(false); }, [item?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const save = async () => {
    if (!item) return;
    setBusy(true);
    try { await setItemNotes(item.id, notes); toast.success("Notes saved"); onClose(); }
    catch (e) { toast.error(e instanceof Error ? `Couldn't save — ${e.message}` : "Couldn't save"); setBusy(false); }
  };
  return (
    <ActionSheet open={!!item} onOpenChange={o => { if (!o && !busy) onClose(); }} size="md" icon={StickyNote}
      title="Notes" description={item?.name}
      footer={
        <div className="flex items-center justify-end gap-2">
          <Button variant="outline" onClick={onClose} disabled={busy} className="rounded-xl h-10">Cancel</Button>
          <Button onClick={save} disabled={busy} className="btn-hero rounded-xl h-10 px-8">Save</Button>
        </div>
      }>
      <Label htmlFor="doc-notes" className="text-xs">What it is, its number, when it runs out… (found by the search)</Label>
      <Textarea id="doc-notes" value={notes} onChange={e => setNotes(e.target.value)} rows={6} className="rounded-xl mt-1" />
    </ActionSheet>
  );
}

/** The Trash: bring things back, or delete their record for good (the file stays in storage). */
function TrashSheet({ open, onClose, folders, items, shares }: {
  open: boolean;
  onClose: () => void;
  folders: DocFolder[];
  items: DocItem[];
  shares: DocShare[];
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const tf = folders.filter(f => f.deletedAt);
  const ti = items.filter(i => i.deletedAt);
  type Row = { key: string; name: string; at: string; sub: string; folder?: DocFolder; item?: DocItem };
  const rows: Row[] = [
    ...tf.map(f => {
      const ids = folderAndBelow(folders, f.id);
      const n = items.filter(i => i.folderId && ids.has(i.folderId)).length;
      return { key: `f:${f.id}`, name: f.name, at: f.deletedAt!, sub: `Folder · ${n} document${n === 1 ? "" : "s"} · was in ${folderLabel(folders, f.parentId)}`, folder: f };
    }),
    ...ti.map(i => ({ key: `i:${i.id}`, name: i.name, at: i.deletedAt!, sub: `${typeOf(i)}${i.size ? ` · ${fileSize(i.size)}` : ""} · was in ${folderLabel(folders, i.folderId)}`, item: i })),
  ].sort((a, b) => b.at.localeCompare(a.at));

  const restore = async (r: Row) => {
    setBusy(r.key);
    try {
      if (r.folder) await restoreFolder(folders, r.folder.id);
      else if (r.item) await restoreItem(folders, r.item);
      toast.success(`"${r.name}" is back`);
    } catch (e) { toast.error(e instanceof Error ? `Couldn't bring it back — ${e.message}` : "Couldn't bring it back"); }
    finally { setBusy(null); }
  };
  const forever = async (r: Row) => {
    const links = shares.filter(s => r.item ? s.target.kind === "item" && s.target.id === r.item.id : false).length;
    const what = r.folder ? "The folder, the folders and documents in it, and their share links go for good."
      : links ? "The document and its share links go for good." : "The document goes for good.";
    if (!(await confirmBox(`Delete "${r.name}" forever?\n\n${what} This can't be undone. (The file itself is kept in storage.)`, { danger: true, confirmText: "Delete forever" }))) return;
    setBusy(r.key);
    try {
      if (r.folder) { const n = await deleteFolderForever(folders, items, shares, r.folder.id); toast.success(`Deleted "${r.name}"${n ? ` and ${n} document${n === 1 ? "" : "s"}` : ""}`); }
      else if (r.item) { await deleteItemForever(shares, r.item.id); toast.success(`Deleted "${r.name}"`); }
    } catch (e) { toast.error(e instanceof Error ? `Couldn't delete it — ${e.message}` : "Couldn't delete it"); }
    finally { setBusy(null); }
  };
  return (
    <ActionSheet open={open} onOpenChange={o => { if (!o) onClose(); }} size="md" icon={Trash2}
      title="Trash" description={rows.length ? `${rows.length} thing${rows.length === 1 ? "" : "s"} · nothing is deleted until you say so` : "Empty"}>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground py-8 text-center">The Trash is empty. Documents and folders moved here can be brought back.</p>
      ) : (
        <div className="space-y-2">
          {rows.map(r => (
            <div key={r.key} className="rounded-xl border border-border/70 bg-white p-3 flex items-start gap-3 min-w-0">
              <span className="h-9 w-9 shrink-0 rounded-lg bg-secondary/60 grid place-items-center">
                {r.folder ? <Folder className="h-5 w-5 text-amber-500" /> : <KindIcon it={r.item!} className="h-5 w-5" />}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium truncate" title={r.name}>{r.name}</p>
                <p className="text-[11px] text-muted-foreground leading-snug">{r.sub}</p>
                <p className="text-[11px] text-muted-foreground">Trashed {fmtDate(r.at)}</p>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <Button variant="outline" size="sm" className="rounded-lg h-9 gap-1.5" disabled={!!busy} onClick={() => restore(r)}>
                  {busy === r.key ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}<span className="max-sm:hidden">Restore</span>
                </Button>
                <Button variant="ghost" size="sm" className="rounded-lg h-9 w-9 p-0 text-destructive hover:text-destructive" disabled={!!busy} onClick={() => forever(r)} aria-label={`Delete ${r.name} forever`} title="Delete forever">
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </ActionSheet>
  );
}

/** The folders here, in the order they show — moved up and down, then saved. */
function ArrangeSheet({ open, onClose, folders, where }: { open: boolean; onClose: () => void; folders: DocFolder[]; where: string }) {
  const [list, setList] = useState<DocFolder[]>([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) { setList(folders); setBusy(false); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const shift = (i: number, d: -1 | 1) => setList(l => {
    const j = i + d;
    if (j < 0 || j >= l.length) return l;
    const n = [...l];
    [n[i], n[j]] = [n[j], n[i]];
    return n;
  });
  const save = async () => {
    setBusy(true);
    try { await reorderFolders(list.map(f => f.id)); toast.success("Folder order saved"); onClose(); }
    catch (e) { toast.error(e instanceof Error ? `Couldn't save — ${e.message}` : "Couldn't save"); setBusy(false); }
  };
  return (
    <ActionSheet open={open} onOpenChange={o => { if (!o && !busy) onClose(); }} size="md" icon={ArrowUpDown}
      title="Arrange folders" description={`In ${where}`}
      footer={
        <div className="flex items-center justify-end gap-2">
          <Button variant="outline" onClick={onClose} disabled={busy} className="rounded-xl h-10">Cancel</Button>
          <Button onClick={save} disabled={busy} className="btn-hero rounded-xl h-10 px-8">Save</Button>
        </div>
      }>
      <div className="rounded-xl border border-border/70 divide-y divide-border/60 overflow-hidden">
        {list.map((f, i) => (
          <div key={f.id} className="flex items-center gap-2 px-3 py-1.5 bg-white min-w-0">
            <span className="w-6 text-xs text-muted-foreground tabular-nums">{i + 1}</span>
            <Folder className="h-4 w-4 text-amber-500 shrink-0" />
            <span className="text-sm min-w-0 flex-1 truncate">{f.name}</span>
            <Button variant="ghost" size="icon" className="h-9 w-9 rounded-lg" disabled={i === 0} onClick={() => shift(i, -1)} aria-label={`Move ${f.name} up`}><ArrowUp className="h-4 w-4" /></Button>
            <Button variant="ghost" size="icon" className="h-9 w-9 rounded-lg" disabled={i === list.length - 1} onClick={() => shift(i, 1)} aria-label={`Move ${f.name} down`}><ArrowDown className="h-4 w-4" /></Button>
          </div>
        ))}
      </div>
    </ActionSheet>
  );
}

/** A photo opened large, with Download and the original in its own tab. */
function PhotoViewer({ item, onClose }: { item: DocItem | null; onClose: () => void }) {
  useBackToClose(!!item, onClose);
  useEffect(() => {
    if (!item) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [item, onClose]);
  if (!item) return null;
  return (
    <div role="dialog" aria-modal="true" aria-label={item.name} className="fixed inset-0 z-[100] bg-black/90 flex flex-col" onClick={onClose}>
      <div className="flex items-center gap-2 px-3 pt-[calc(env(safe-area-inset-top)+0.5rem)] pb-2 text-white/90 shrink-0" onClick={e => e.stopPropagation()}>
        <div className="min-w-0 flex-1 px-1">
          <p className="text-sm font-medium truncate">{item.name}</p>
          {item.notes && <p className="text-[11px] text-white/60 truncate">{item.notes}</p>}
        </div>
        <button type="button" onClick={() => saveDocument(item)} aria-label="Download"
          className="h-10 px-3 rounded-full inline-flex items-center gap-1.5 text-sm hover:bg-white/15"><Download className="h-4 w-4" /><span className="max-sm:hidden">Download</span></button>
        <a href={item.url} target="_blank" rel="noreferrer" aria-label="Open the original"
          className="h-10 px-3 rounded-full inline-flex items-center gap-1.5 text-sm hover:bg-white/15"><ExternalLink className="h-4 w-4" /><span className="max-sm:hidden">Original</span></a>
        <button type="button" onClick={onClose} aria-label="Close" className="h-10 w-10 rounded-full grid place-items-center hover:bg-white/15"><X className="h-5 w-5" /></button>
      </div>
      <div className="relative flex-1 min-h-0 flex items-center justify-center px-2 pb-[calc(env(safe-area-inset-bottom)+0.75rem)]">
        <img src={item.url} alt={item.name} decoding="async" onClick={e => e.stopPropagation()}
          className="max-w-full max-h-full object-contain select-none" style={{ touchAction: "pinch-zoom" }} />
      </div>
    </div>
  );
}
