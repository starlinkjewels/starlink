import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useParams } from "react-router-dom";
import { httpsCallable } from "firebase/functions";
import { functions } from "@/lib/firebase";
import type { DocKind, DocShareOpened } from "@/lib/documentsModel";
import { BrandLogo } from "@/components/BrandLogo";
import { useBrand, brandName } from "@/lib/brand";
import {
  Lock, Eye, EyeOff, Loader2, Folder, FileText, Image as ImageIcon, File as FileIcon, Download, X,
  ChevronLeft, ChevronRight, ChevronRight as Crumb, ExternalLink, Clock, ShieldCheck, Link2Off,
} from "lucide-react";

/**
 * A Documents password link (/d/:id), opened without signing in.
 *
 * The visitor types the password; the server checks it (functions/src/docShare.ts,
 * openDocShare) and hands back only what the link shows. That answer is kept in
 * this page's memory and nowhere else — closing or reloading the tab asks for
 * the password again. The password itself is never kept once sent.
 */

type Opened = DocShareOpened;
type Item = Opened["items"][number];
type OpenedFolder = Opened["folders"][number];

type Status =
  | { kind: "locked" }                       // asking for the password
  | { kind: "open"; data: Opened }
  | { kind: "gone"; why: "missing" | "expired"; message: string };

const openDocShare = httpsCallable<{ id: string; password: string }, Opened>(functions, "openDocShare");

/** The server's answer to a refusal, in words a visitor can act on. */
function refusal(e: unknown): { final: boolean; why?: "missing" | "expired"; message: string } {
  const code = String((e as { code?: string })?.code ?? "").replace(/^functions\//, "");
  const msg = String((e as { message?: string })?.message ?? "");
  switch (code) {
    case "not-found": return { final: true, why: "missing", message: msg || "This link is not available" };
    case "failed-precondition": return { final: true, why: "expired", message: msg || "This link has expired" };
    case "permission-denied": return { final: false, message: msg || "Wrong password" };
    case "resource-exhausted": return { final: false, message: msg || "Too many tries — try again later" };
    case "invalid-argument": return { final: false, message: msg || "Type the password" };
    default: return { final: false, message: "Couldn't reach the server — check the connection and try again." };
  }
}

const IOS = typeof navigator !== "undefined"
  && (/iP(hone|od|ad)/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1));
const ANDROID = typeof navigator !== "undefined" && /Android/i.test(navigator.userAgent);

function sizeText(n?: number): string {
  if (n == null) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(n < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

function KindIcon({ kind, className }: { kind: DocKind; className?: string }) {
  if (kind === "pdf") return <FileText className={className} />;
  if (kind === "image") return <ImageIcon className={className} />;
  return <FileIcon className={className} />;
}

/** A name safe to save under, with the file's own extension when the name has none. */
function fileNameFor(it: Item): string {
  const base = [...(it.name || "document")].filter(ch => ch.charCodeAt(0) >= 32).join("")
    .replace(/[\\/:*?"<>|]+/g, "_").trim() || "document";
  if (/\.[a-z0-9]{2,5}$/i.test(base)) return base;
  let ext = it.kind === "pdf" ? "pdf" : "";
  if (!ext) {
    try {
      const last = decodeURIComponent(new URL(it.url).pathname.split("/").pop() || "");
      ext = /\.([a-z0-9]{2,5})$/i.exec(last)?.[1] ?? (it.kind === "image" ? "jpg" : "");
    } catch { ext = it.kind === "image" ? "jpg" : ""; }
  }
  return ext ? `${base}.${ext}` : base;
}

function saveBlob(blob: Blob, filename: string) {
  const obj = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = obj; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(obj), 10000);
}

/** Save one file under its own name; if it can't be fetched, it opens instead. */
async function downloadOne(it: Item) {
  try {
    const res = await fetch(it.url);
    if (!res.ok) throw new Error(String(res.status));
    saveBlob(await res.blob(), fileNameFor(it));
  } catch { window.open(it.url, "_blank", "noopener"); }
}

/** A history entry's state with its depth in the link (the router's own keys kept alongside). */
const withDepth = (dv: number) => ({ ...((window.history.state as object | null) ?? {}), dv });

export function DocShareViewPage() {
  const { id = "" } = useParams();
  const brand = useBrand();
  const [status, setStatus] = useState<Status>({ kind: "locked" });

  return (
    // The app shell locks html/body/#root to height:100% overflow:hidden, so this
    // public page is its own full-viewport scroll container.
    <div className="fixed inset-0 overflow-y-auto overscroll-contain bg-[#F7F9FC]">
      <header className="sticky top-0 z-20 bg-white/90 backdrop-blur border-b border-border/60">
        <div className="max-w-6xl mx-auto px-4 h-14 flex items-center gap-2 min-w-0">
          <BrandLogo wide className="h-7 w-auto max-w-[8rem] object-contain" />
          <span className="font-display text-brand-dark text-lg truncate">{brandName(brand)}</span>
        </div>
      </header>

      {status.kind === "locked" && (
        <PasswordScreen id={id} onOpened={data => setStatus({ kind: "open", data })}
          onGone={(why, message) => setStatus({ kind: "gone", why, message })} />
      )}

      {status.kind === "gone" && (
        <main className="max-w-md mx-auto px-4 py-24 text-center text-muted-foreground">
          {status.why === "expired"
            ? <Clock className="h-12 w-12 mx-auto mb-3 opacity-25" />
            : <Link2Off className="h-12 w-12 mx-auto mb-3 opacity-25" />}
          <p className="font-semibold text-brand-dark">{status.message}</p>
          <p className="text-sm mt-1">Please ask {brandName(brand)} for a new link.</p>
        </main>
      )}

      {status.kind === "open" && <OpenedView data={status.data} />}
    </div>
  );
}

function PasswordScreen({ id, onOpened, onGone }: {
  id: string;
  onOpened(data: Opened): void;
  onGone(why: "missing" | "expired", message: string): void;
}) {
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (!password) { setError("Type the password"); inputRef.current?.focus(); return; }
    setBusy(true); setError("");
    try {
      const res = await openDocShare({ id, password });
      setPassword(""); // not kept once it has done its job
      onOpened(res.data);
    } catch (err) {
      const r = refusal(err);
      if (r.final && r.why) { setPassword(""); onGone(r.why, r.message); return; }
      setError(r.message);
      inputRef.current?.select();
    } finally { setBusy(false); }
  };

  return (
    <main className="max-w-sm mx-auto px-4 pt-16 pb-10">
      <form onSubmit={submit} noValidate className="rounded-2xl border border-border/60 bg-white shadow-sm p-5 sm:p-6">
        <div className="h-12 w-12 rounded-2xl bg-secondary grid place-items-center mb-4">
          <Lock className="h-6 w-6 text-brand-dark" />
        </div>
        <h1 className="font-display text-2xl text-brand-dark">Protected document</h1>
        <p className="text-sm text-muted-foreground mt-1">Type the password you were given to open it.</p>
        <label htmlFor="doc-pw" className="block text-xs font-medium text-muted-foreground mt-5 mb-1.5">Password</label>
        <div className="relative">
          <input id="doc-pw" ref={inputRef} type={show ? "text" : "password"} value={password} autoFocus
            autoComplete="off" autoCapitalize="none" autoCorrect="off" spellCheck={false} maxLength={200}
            onChange={e => { setPassword(e.target.value); if (error) setError(""); }}
            aria-invalid={!!error} aria-describedby={error ? "doc-pw-error" : undefined}
            className="w-full h-11 rounded-xl border border-border bg-white pl-3 pr-11 text-base outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary" />
          <button type="button" onClick={() => setShow(s => !s)} aria-label={show ? "Hide password" : "Show password"}
            className="absolute right-1 top-1 h-9 w-9 grid place-items-center rounded-lg text-muted-foreground hover:text-brand-dark">
            {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </div>
        {error && <p id="doc-pw-error" role="alert" className="text-sm text-red-600 mt-2">{error}</p>}
        <button type="submit" disabled={busy}
          className="mt-5 w-full h-11 rounded-xl bg-brand-dark text-white text-sm font-medium flex items-center justify-center gap-2 disabled:opacity-60">
          {busy ? <><Loader2 className="h-4 w-4 animate-spin" /> Opening…</> : "Open"}
        </button>
      </form>
    </main>
  );
}

function OpenedView({ data }: { data: Opened }) {
  const { folders, items, allowDownload } = data;
  const [path, setPath] = useState<OpenedFolder[]>([]);
  // What is open over the list: a document, or an image (with its neighbours) in the lightbox.
  const [viewing, setViewing] = useState<Item | null>(null);
  const [zipping, setZipping] = useState<string | null>(null);

  const hereId = path.length ? path[path.length - 1].id : null;
  const subFolders = folders.filter(f => (f.parentId ?? null) === hereId);
  const here = items.filter(it => (it.folderId ?? null) === hereId);
  const images = here.filter(it => it.kind === "image");
  const single = items.length === 1 && folders.length === 0 ? items[0] : null;

  /** Everything under a folder, however deep — what its card shows. */
  const countIn = useCallback((folderId: string): number => {
    const ids = new Set([folderId]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const f of folders) if (f.parentId && ids.has(f.parentId) && !ids.has(f.id)) { ids.add(f.id); grew = true; }
    }
    return items.filter(it => it.folderId && ids.has(it.folderId)).length;
  }, [folders, items]);

  /** A folder's path inside the share ("Bills/2026/"), for the zip. */
  const folderPath = useMemo(() => {
    const byId = new Map(folders.map(f => [f.id, f]));
    return (folderId: string | null): string => {
      const parts: string[] = [];
      const seen = new Set<string>();
      let f = folderId ? byId.get(folderId) : undefined;
      while (f && !seen.has(f.id)) { seen.add(f.id); parts.unshift(f.name.replace(/[\\/:*?"<>|]+/g, "_")); f = f.parentId ? byId.get(f.parentId) : undefined; }
      return parts.length ? parts.join("/") + "/" : "";
    };
  }, [folders]);

  // Phone/browser Back: closes what is open, then goes up a folder — never off
  // the page by surprise (that would ask for the password again). Each step in
  // carries its depth; Back lands on a smaller one.
  const depth = path.length + (viewing ? 1 : 0);
  useEffect(() => { window.history.replaceState(withDepth(0), ""); }, []);
  useEffect(() => {
    const onPop = (e: PopStateEvent) => {
      const d = typeof (e.state as { dv?: unknown } | null)?.dv === "number" ? (e.state as { dv: number }).dv : 0;
      setViewing(null);
      setPath(p => (d < p.length ? p.slice(0, d) : p));
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  const step = (nextDepth: number) => window.history.pushState(withDepth(nextDepth), "");
  const openFolder = (f: OpenedFolder) => { step(path.length + 1); setPath([...path, f]); };
  const goTo = (level: number) => { if (level < path.length) window.history.go(level - path.length); };
  const open = (it: Item) => { step(depth + 1); setViewing(it); };
  const close = () => window.history.back();

  const downloadAll = async () => {
    if (zipping) return;
    const JSZip = (await import("jszip")).default;
    const zip = new JSZip();
    const used = new Set<string>();
    let added = 0;
    try {
      for (let i = 0; i < items.length; i++) {
        setZipping(`${i + 1} / ${items.length}`);
        const it = items[i];
        try {
          const res = await fetch(it.url);
          if (!res.ok) continue;
          let name = folderPath(it.folderId) + fileNameFor(it);
          for (let n = 2; used.has(name); n++) name = name.replace(/( \(\d+\))?(\.[^./]+)?$/, ` (${n})$2`);
          used.add(name);
          zip.file(name, await res.blob());
          added++;
        } catch { /* skipped — counted below */ }
      }
      if (!added) { window.alert("The files couldn't be downloaded here — open each one to save it."); return; }
      setZipping("Saving…");
      const blob = await zip.generateAsync({ type: "blob", compression: "STORE" });
      saveBlob(blob, `${(data.title || "Documents").replace(/[\\/:*?"<>|]+/g, "_")}.zip`);
      if (added < items.length) window.alert(`${items.length - added} of ${items.length} files couldn't be added to the zip.`);
    } finally { setZipping(null); }
  };

  const expires = data.expiresAt ? new Date(data.expiresAt) : null;
  const title = path.length ? path[path.length - 1].name : data.title;

  return (
    <main className="max-w-6xl mx-auto px-4 py-6">
      <div className="mb-5">
        {path.length > 0 && (
          <nav className="flex items-center gap-1 flex-wrap text-sm mb-1" aria-label="Folders">
            <button onClick={() => goTo(0)} className="font-medium text-primary hover:underline">{data.title}</button>
            {path.map((f, i) => (
              <span key={f.id} className="flex items-center gap-1 min-w-0">
                <Crumb className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                <button onClick={() => goTo(i + 1)}
                  className={`font-medium truncate ${i === path.length - 1 ? "text-brand-dark" : "text-primary hover:underline"}`}>
                  {f.name}
                </button>
              </span>
            ))}
          </nav>
        )}
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="font-display text-2xl md:text-3xl text-brand-dark break-words">{title}</h1>
            <p className="text-sm text-muted-foreground mt-0.5 flex items-center gap-x-2 gap-y-0.5 flex-wrap">
              {!single && <span>
                {subFolders.length > 0 && `${subFolders.length} folder${subFolders.length !== 1 ? "s" : ""} · `}
                {here.length} document{here.length !== 1 ? "s" : ""}
              </span>}
              {!allowDownload && <span className="inline-flex items-center gap-1"><ShieldCheck className="h-3.5 w-3.5" /> View only</span>}
              {expires && !Number.isNaN(expires.getTime()) && <span>Open until {expires.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}</span>}
            </p>
          </div>
          {allowDownload && items.length > 1 && (
            <button onClick={downloadAll} disabled={!!zipping}
              className="flex items-center gap-1.5 h-9 px-3 rounded-xl border border-border bg-white hover:bg-secondary text-xs font-medium text-brand-dark disabled:opacity-60 shrink-0">
              {zipping ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
              {zipping ? zipping : "Download all"}
            </button>
          )}
        </div>
      </div>

      {subFolders.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3 sm:gap-4 mb-6">
          {subFolders.map(f => (
            <button key={f.id} onClick={() => openFolder(f)}
              className="rounded-2xl border border-border/60 bg-white shadow-sm text-left p-3 hover:shadow-md transition-shadow flex items-center gap-3 min-w-0">
              <div className="h-10 w-10 rounded-xl bg-amber-50 grid place-items-center shrink-0"><Folder className="h-5 w-5 text-amber-500" /></div>
              <div className="min-w-0">
                <p className="text-sm font-medium text-brand-dark truncate">{f.name}</p>
                <p className="text-[11px] text-muted-foreground">{countIn(f.id)} document{countIn(f.id) !== 1 ? "s" : ""}</p>
              </div>
            </button>
          ))}
        </div>
      )}

      {here.length === 0 && subFolders.length === 0 ? (
        <div className="py-20 text-center text-muted-foreground">This folder is empty.</div>
      ) : here.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3 sm:gap-4">
          {here.map(it => (
            <div key={it.id} className="relative rounded-2xl overflow-hidden border border-border/60 bg-white shadow-sm flex flex-col">
              <button onClick={() => open(it)} className="block w-full aspect-[4/3] bg-secondary/30 overflow-hidden relative" aria-label={`Open ${it.name}`}>
                {it.thumb || it.kind === "image"
                  ? <img src={it.thumb || it.url} alt="" loading="lazy" decoding="async" draggable={false} className="w-full h-full object-cover" />
                  : <div className="w-full h-full grid place-items-center bg-gradient-to-br from-slate-100 to-slate-200"><KindIcon kind={it.kind} className="h-10 w-10 text-slate-400" /></div>}
                <span className="absolute top-2 left-2 inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-medium uppercase bg-black/50 text-white backdrop-blur-sm">
                  <KindIcon kind={it.kind} className="h-2.5 w-2.5" />{it.kind === "file" ? "file" : it.kind}
                </span>
              </button>
              {allowDownload && (
                <button onClick={() => void downloadOne(it)} aria-label={`Download ${it.name}`}
                  className="absolute top-2 right-2 h-8 w-8 rounded-lg bg-white/90 border border-border/60 grid place-items-center text-muted-foreground hover:text-primary shadow-sm">
                  <Download className="h-3.5 w-3.5" />
                </button>
              )}
              <button onClick={() => open(it)} className="px-2.5 pt-2 pb-2 text-left">
                <p className="text-xs text-foreground font-medium line-clamp-2 break-words">{it.name}</p>
                {it.size != null && <p className="text-[10px] text-muted-foreground mt-0.5">{sizeText(it.size)}</p>}
              </button>
            </div>
          ))}
        </div>
      )}

      {viewing && viewing.kind === "image" && (
        <Lightbox images={images.length ? images : [viewing]} start={Math.max(0, images.findIndex(i => i.id === viewing.id))}
          allowDownload={allowDownload} onClose={close} />
      )}
      {viewing && viewing.kind !== "image" && <DocViewer item={viewing} allowDownload={allowDownload} onClose={close} />}
    </main>
  );
}

/** Esc closes. */
function useEscape(onClose: () => void) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);
}

const iconBtn = "h-10 w-10 rounded-full bg-white/10 active:bg-white/20 hover:bg-white/20 grid place-items-center text-white shrink-0";

/** A PDF (or another file) over the page: the browser's own viewer where it has one. */
function DocViewer({ item, allowDownload, onClose }: { item: Item; allowDownload: boolean; onClose(): void }) {
  useEscape(onClose);
  const pdf = item.kind === "pdf";
  // Android's browser has no PDF viewer inside a page, and an iPhone shows only
  // the first page there — both get a button that opens it on its own.
  const inPage = pdf && !ANDROID;
  // View only: ask the browser's viewer to hide its own save/print bar (Chrome honours it).
  const src = allowDownload ? item.url : `${item.url}#toolbar=0&navpanes=0`;
  return (
    <div className="fixed inset-0 z-[60] bg-black/95 flex flex-col"
      style={{ paddingTop: "env(safe-area-inset-top)", paddingBottom: "env(safe-area-inset-bottom)" }}>
      <div className="flex items-center justify-between px-3 py-2.5 gap-2 shrink-0">
        <p className="text-white/85 text-sm font-medium truncate min-w-0">{item.name}</p>
        <div className="flex items-center gap-2 shrink-0">
          {pdf && (
            <a href={item.url} target="_blank" rel="noopener noreferrer" aria-label="Open on its own" title="Open"
              className="h-10 px-3 rounded-full bg-white/10 hover:bg-white/20 active:bg-white/20 text-white text-sm font-medium flex items-center gap-1.5">
              <ExternalLink className="h-4 w-4" /> Open
            </a>
          )}
          {allowDownload && <button onClick={() => void downloadOne(item)} className={iconBtn} aria-label="Download"><Download className="h-5 w-5" /></button>}
          <button onClick={onClose} className={iconBtn} aria-label="Close"><X className="h-5 w-5" /></button>
        </div>
      </div>
      {inPage ? (
        <div className="flex-1 min-h-0 bg-white flex flex-col">
          {IOS && <p className="text-xs text-center text-muted-foreground bg-secondary/60 py-1.5 px-3 shrink-0">Only the first page may show here — tap Open to read all of it.</p>}
          <iframe src={src} title={item.name} className="flex-1 w-full border-0 bg-white" />
        </div>
      ) : (
        <div className="flex-1 min-h-0 grid place-items-center px-6 text-center">
          <div className="max-w-xs">
            {item.thumb
              ? <img src={item.thumb} alt="" draggable={false} className="mx-auto max-h-[45vh] rounded-xl mb-5 object-contain bg-white" />
              : <KindIcon kind={item.kind} className="h-16 w-16 mx-auto mb-5 text-white/40" />}
            <p className="text-white font-medium break-words">{item.name}</p>
            {item.size != null && <p className="text-white/50 text-xs mt-1">{sizeText(item.size)}</p>}
            <div className="mt-5 flex flex-col gap-2">
              {pdf && (
                <a href={item.url} target="_blank" rel="noopener noreferrer"
                  className="h-11 rounded-xl bg-white text-brand-dark text-sm font-medium flex items-center justify-center gap-2">
                  <ExternalLink className="h-4 w-4" /> Open
                </a>
              )}
              {allowDownload
                ? <button onClick={() => void downloadOne(item)}
                    className={`h-11 rounded-xl text-sm font-medium flex items-center justify-center gap-2 ${pdf ? "bg-white/10 text-white" : "bg-white text-brand-dark"}`}>
                    <Download className="h-4 w-4" /> Download
                  </button>
                : !pdf && <p className="text-white/60 text-sm">This file can't be shown here, and this link is view only.</p>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Lightbox({ images, start, allowDownload, onClose }: { images: Item[]; start: number; allowDownload: boolean; onClose(): void }) {
  const [idx, setIdx] = useState(start);
  const item = images[idx];
  const hasPrev = idx > 0, hasNext = idx < images.length - 1;
  useEscape(onClose);
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") setIdx(i => Math.max(0, i - 1));
      if (e.key === "ArrowRight") setIdx(i => Math.min(images.length - 1, i + 1));
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [images.length]);
  // A swipe left or right moves between the pictures.
  const touchX = useRef<number | null>(null);
  if (!item) return null;
  return (
    <div className="fixed inset-0 z-[60] bg-black/95 flex flex-col"
      style={{ paddingTop: "env(safe-area-inset-top)", paddingBottom: "env(safe-area-inset-bottom)" }}>
      <div className="flex items-center justify-between px-3 py-2.5 gap-2 shrink-0">
        <p className="text-white/85 text-sm font-medium truncate min-w-0">
          {item.name}{images.length > 1 && <span className="ml-2 text-white/45 text-xs">{idx + 1} / {images.length}</span>}
        </p>
        <div className="flex items-center gap-2 shrink-0">
          {allowDownload && <button onClick={() => void downloadOne(item)} className={iconBtn} aria-label="Download"><Download className="h-5 w-5" /></button>}
          <button onClick={onClose} className={iconBtn} aria-label="Close"><X className="h-5 w-5" /></button>
        </div>
      </div>
      <div className="flex-1 flex items-center min-h-0 relative"
        onTouchStart={e => { touchX.current = e.touches[0]?.clientX ?? null; }}
        onTouchEnd={e => {
          const x0 = touchX.current; touchX.current = null;
          const x1 = e.changedTouches[0]?.clientX;
          if (x0 == null || x1 == null || Math.abs(x1 - x0) < 50) return;
          setIdx(i => (x1 < x0 ? Math.min(images.length - 1, i + 1) : Math.max(0, i - 1)));
        }}>
        {hasPrev && <button onClick={() => setIdx(i => i - 1)} className={`absolute left-2 z-10 ${iconBtn}`} aria-label="Previous"><ChevronLeft className="h-6 w-6" /></button>}
        <div className="flex-1 h-full min-h-0 flex items-center justify-center px-3 sm:px-14">
          <img key={item.id} src={item.url} alt={item.name} draggable={false}
            onContextMenu={allowDownload ? undefined : e => e.preventDefault()}
            className="max-w-full max-h-full object-contain rounded-xl select-none" style={{ maxHeight: "calc(100dvh - 120px)" }} />
        </div>
        {hasNext && <button onClick={() => setIdx(i => i + 1)} className={`absolute right-2 z-10 ${iconBtn}`} aria-label="Next"><ChevronRight className="h-6 w-6" /></button>}
      </div>
    </div>
  );
}
