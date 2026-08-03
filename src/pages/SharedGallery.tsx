import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { doc, getDoc } from "firebase/firestore";
import { db as fsdb } from "@/lib/firebase";
import type { Share, ShareItem } from "@/lib/db";
import { motion, AnimatePresence } from "framer-motion";
import { Image as ImageIcon, Video, Play, Download, X, ChevronLeft, ChevronRight, Loader2, Camera } from "lucide-react";

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

function filenameFor(it: ShareItem, i: number) {
  return `${(it.name || "media").replace(/[^\w.-]+/g, "_")}-${i + 1}.${it.type === "video" ? "mp4" : "jpg"}`;
}

function Lightbox({ items, startIndex, onClose }: { items: ShareItem[]; startIndex: number; onClose(): void }) {
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
        <p className="text-white/80 text-sm font-medium truncate">
          {item.name}{items.length > 1 && <span className="ml-2 text-white/40 text-xs">{idx + 1} / {items.length}</span>}
        </p>
        <div className="flex items-center gap-2 shrink-0">
          <button onClick={() => downloadOne(item.url, filenameFor(item, idx))} className="h-10 w-10 rounded-full bg-white/10 active:bg-white/20 flex items-center justify-center text-white"><Download className="h-5 w-5" /></button>
          <button onClick={onClose} className="h-10 w-10 rounded-full bg-white/10 active:bg-white/20 flex items-center justify-center text-white"><X className="h-5 w-5" /></button>
        </div>
      </div>
      <div className="flex-1 flex items-center min-h-0 relative">
        {hasPrev && <button onClick={prev} className="absolute left-2 z-10 h-11 w-11 rounded-full bg-white/10 active:bg-white/20 flex items-center justify-center text-white"><ChevronLeft className="h-6 w-6" /></button>}
        <AnimatePresence mode="wait" custom={dir}>
          <motion.div key={idx} custom={dir}
            initial={{ opacity: 0, x: dir * 60 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: dir * -60 }}
            transition={{ duration: 0.22, ease: "easeOut" }}
            className="flex-1 flex items-center justify-center px-14 h-full min-h-0">
            {item.type === "image"
              ? <img src={item.url} alt={item.name} className="max-w-full max-h-full object-contain rounded-xl select-none" style={{ maxHeight: "calc(100vh - 140px)" }} onClick={onClose} />
              : <video src={item.url} controls autoPlay playsInline className="max-w-full rounded-xl" style={{ maxHeight: "calc(100vh - 140px)" }} />}
          </motion.div>
        </AnimatePresence>
        {hasNext && <button onClick={next} className="absolute right-2 z-10 h-11 w-11 rounded-full bg-white/10 active:bg-white/20 flex items-center justify-center text-white"><ChevronRight className="h-6 w-6" /></button>}
      </div>
    </motion.div>
  );
}

export function SharedGalleryPage() {
  const { id } = useParams();
  const [share, setShare] = useState<Share | null>(null);
  const [status, setStatus] = useState<"loading" | "ok" | "missing">("loading");
  const [lightbox, setLightbox] = useState<number | null>(null);
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const snap = await getDoc(doc(fsdb, "shares", id!));
        if (!alive) return;
        if (snap.exists()) { setShare(snap.data() as Share); setStatus("ok"); }
        else setStatus("missing");
      } catch { if (alive) setStatus("missing"); }
    })();
    return () => { alive = false; };
  }, [id]);

  const items = share?.items ?? [];
  const downloadAll = async () => {
    setDownloading(true);
    try { for (let i = 0; i < items.length; i++) await downloadOne(items[i].url, filenameFor(items[i], i)); }
    finally { setDownloading(false); }
  };

  return (
    <div className="min-h-screen bg-[#F7F9FC]">
      {/* Branded header */}
      <header className="sticky top-0 z-20 bg-white/90 backdrop-blur border-b border-border/60">
        <div className="max-w-6xl mx-auto px-4 h-14 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <img src="/starlink-logo.png" alt="Starlink Jewels" className="h-7 w-auto object-contain" onError={e => { (e.currentTarget as HTMLImageElement).style.display = "none"; }} />
            <span className="font-display text-brand-dark text-lg truncate">Starlink Jewels</span>
          </div>
          {status === "ok" && items.length > 0 && (
            <button onClick={downloadAll} disabled={downloading}
              className="flex items-center gap-1.5 h-9 px-3 rounded-xl border border-border bg-white hover:bg-secondary text-xs font-medium text-brand-dark disabled:opacity-60 shrink-0">
              {downloading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />} {downloading ? "Downloading…" : "Download All"}
            </button>
          )}
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-6">
        {status === "loading" && (
          <div className="py-24 grid place-items-center text-muted-foreground"><Loader2 className="h-7 w-7 animate-spin" /></div>
        )}

        {status === "missing" && (
          <div className="py-24 text-center text-muted-foreground max-w-md mx-auto">
            <Camera className="h-12 w-12 mx-auto mb-3 opacity-20" />
            <p className="font-semibold text-brand-dark">Link not available</p>
            <p className="text-sm mt-1">This shared link has expired or was removed. Please ask Starlink for a new one.</p>
          </div>
        )}

        {status === "ok" && share && (
          <>
            <div className="mb-5">
              <h1 className="font-display text-2xl md:text-3xl text-brand-dark">{share.title}</h1>
              <p className="text-sm text-muted-foreground mt-0.5">{items.length} item{items.length !== 1 ? "s" : ""} · shared by Starlink Jewels</p>
            </div>

            {items.length === 0 ? (
              <div className="py-20 text-center text-muted-foreground">This folder is empty.</div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3 sm:gap-4">
                {items.map((it, i) => (
                  <motion.div key={i} whileTap={{ scale: 0.97 }} className="relative rounded-2xl overflow-hidden border border-border/60 bg-white shadow-sm flex flex-col">
                    <button onClick={() => setLightbox(i)} className="block w-full aspect-square bg-secondary/30 overflow-hidden relative">
                      {it.type === "image"
                        ? <img src={it.url} alt={it.name} loading="lazy" decoding="async" className="w-full h-full object-cover" />
                        : <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-slate-100 to-slate-200"><Video className="h-10 w-10 text-slate-400" /></div>}
                      {it.type === "video" && (
                        <div className="absolute inset-0 flex items-center justify-center">
                          <div className="h-12 w-12 rounded-full bg-black/40 flex items-center justify-center"><Play className="h-6 w-6 text-white ml-0.5" /></div>
                        </div>
                      )}
                      <div className="absolute top-2 left-2">
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-black/50 text-white backdrop-blur-sm">
                          {it.type === "video" ? <Video className="h-2.5 w-2.5" /> : <ImageIcon className="h-2.5 w-2.5" />}{it.type}
                        </span>
                      </div>
                      <button onClick={e => { e.stopPropagation(); downloadOne(it.url, filenameFor(it, i)); }}
                        className="absolute top-2 right-2 h-8 w-8 rounded-lg bg-white/90 border border-border/60 grid place-items-center text-muted-foreground hover:text-primary shadow-sm" aria-label="Download">
                        <Download className="h-3.5 w-3.5" />
                      </button>
                    </button>
                    {(it.name || it.folder) && (
                      <div className="px-2.5 pt-2 pb-1.5">
                        <p className="text-[11px] text-foreground font-medium truncate">{it.name}</p>
                        {it.folder && <p className="text-[10px] text-muted-foreground truncate">{it.folder}</p>}
                      </div>
                    )}
                  </motion.div>
                ))}
              </div>
            )}
          </>
        )}
      </main>

      <AnimatePresence>
        {lightbox !== null && <Lightbox items={items} startIndex={lightbox} onClose={() => setLightbox(null)} />}
      </AnimatePresence>
    </div>
  );
}
