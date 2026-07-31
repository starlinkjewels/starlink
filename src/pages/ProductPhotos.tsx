import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useAuth } from "@/lib/auth";
import { currentUserOrders, type Order } from "@/lib/db";
import { useDb } from "@/hooks/useDb";
import { Folder, Image as ImageIcon, Video, Download, X, Camera } from "lucide-react";

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

interface DesignFolder {
  design: string;
  orders: Order[];
}

export function ProductPhotosPage() {
  const { user } = useAuth();
  const db = useDb();
  const [openDesign, setOpenDesign] = useState<string | null>(null);
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);
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

  const groups = new Map<string, Order[]>();
  for (const o of currentUserOrders(db, user!)) {
    if ((o.productPhotos?.length ?? 0) === 0 && !o.productVideo && !o.cadImage) continue;
    const design = (o.designNumber || o.orderNumber || "Unlabelled").trim();
    if (!groups.has(design)) groups.set(design, []);
    groups.get(design)!.push(o);
  }
  const folders: DesignFolder[] = [...groups.entries()]
    .map(([design, orders]) => ({ design, orders }))
    .sort((a, b) => a.design.localeCompare(b.design));

  const openFolder = folders.find(f => f.design === openDesign);

  const downloadAllInFolder = async (folder: DesignFolder) => {
    setDownloading(true);
    try {
      let i = 1;
      for (const o of folder.orders) {
        for (const p of o.productPhotos ?? []) await downloadOne(p, `${folder.design}-photo-${i++}.jpg`);
        if (o.productVideo) await downloadOne(o.productVideo, `${folder.design}-video.mp4`);
        if (o.cadImage) await downloadOne(o.cadImage, `${folder.design}-cad.jpg`);
      }
    } finally { setDownloading(false); }
  };

  return (
    <div className="max-w-6xl mx-auto space-y-5">
      <div>
        <h1 className="font-display text-2xl md:text-3xl text-brand-dark">Product Photos</h1>
        <p className="text-sm text-muted-foreground">
          {folders.length} design{folders.length !== 1 ? "s" : ""} · photos, video &amp; CAD image, grouped by design number
        </p>
      </div>

      {folders.length === 0 && (
        <div className="card-luxe p-12 text-center text-muted-foreground">
          <Camera className="h-10 w-10 mx-auto mb-3 opacity-20" />
          <p>No product photos yet.</p>
        </div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3 sm:gap-4">
        {folders.map(folder => {
          const cover = folder.orders.flatMap(o => o.productPhotos ?? [])[0] ?? folder.orders.find(o => o.cadImage)?.cadImage;
          const photoCount = folder.orders.reduce((n, o) => n + (o.productPhotos?.length ?? 0), 0);
          const hasVideo = folder.orders.some(o => o.productVideo);
          const hasCad = folder.orders.some(o => o.cadImage);
          const clientNames = [...new Set(folder.orders.map(o => db.clients.find(c => c.id === o.clientId)?.companyName).filter(Boolean))];
          return (
            <motion.button
              key={folder.design}
              whileTap={{ scale: 0.97 }}
              onClick={() => setOpenDesign(folder.design)}
              className="flex flex-col rounded-2xl border border-border/60 active:border-primary/40 bg-white shadow-sm overflow-hidden text-left"
            >
              <div className="aspect-video w-full bg-gradient-to-br from-fuchsia-50 to-fuchsia-100 overflow-hidden relative">
                {cover ? (
                  <img src={cover} alt="" className="w-full h-full object-cover" />
                ) : (
                  <div className="absolute inset-0 flex items-center justify-center"><Folder className="h-10 w-10 text-fuchsia-300" /></div>
                )}
              </div>
              <div className="px-3 pt-2.5 pb-1">
                <p className="text-sm font-medium text-foreground truncate">{folder.design}</p>
                {isStaff && clientNames.length > 0 && (
                  <p className="text-[10px] text-muted-foreground truncate mt-0.5">{clientNames.join(", ")}</p>
                )}
              </div>
              <div className="px-3 pb-2.5 flex items-center gap-2.5 text-[11px] text-muted-foreground">
                {photoCount > 0 && <span className="flex items-center gap-0.5"><ImageIcon className="h-3 w-3" />{photoCount}</span>}
                {hasVideo && <span className="flex items-center gap-0.5"><Video className="h-3 w-3" />video</span>}
                {hasCad && <span className="flex items-center gap-0.5"><Camera className="h-3 w-3" />CAD</span>}
              </div>
            </motion.button>
          );
        })}
      </div>

      {/* Folder detail modal */}
      <AnimatePresence>
        {openFolder && (
          <>
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm" onClick={() => setOpenDesign(null)}
            />
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none">
            <motion.div
              initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 24 }}
              className="pointer-events-auto bg-white rounded-2xl shadow-2xl p-6 max-w-2xl w-full max-h-[85vh] overflow-y-auto"
            >
              <div className="flex items-center justify-between gap-3 mb-4">
                <div className="min-w-0">
                  <h3 className="font-display text-lg text-brand-dark truncate">{openFolder.design}</h3>
                  {isStaff && (
                    <p className="text-xs text-muted-foreground mt-0.5 truncate">
                      {openFolder.orders.map(o => o.orderNumber).join(", ")}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={() => downloadAllInFolder(openFolder)} disabled={downloading}
                    className="flex items-center gap-1.5 h-9 px-3 rounded-xl border border-border text-xs font-medium hover:bg-secondary disabled:opacity-60"
                  >
                    <Download className="h-3.5 w-3.5" /> {downloading ? "Downloading…" : "Download All"}
                  </button>
                  <button onClick={() => setOpenDesign(null)} className="h-9 w-9 rounded-xl bg-secondary grid place-items-center shrink-0">
                    <X className="h-4 w-4" />
                  </button>
                </div>
              </div>

              <div className="space-y-5">
                {openFolder.orders.map(o => (
                  <div key={o.id} className="space-y-3">
                    {isStaff && openFolder.orders.length > 1 && (
                      <p className="text-xs font-semibold text-muted-foreground">
                        {o.orderNumber} · {db.clients.find(c => c.id === o.clientId)?.companyName ?? "—"}
                      </p>
                    )}

                    {o.cadImage && (
                      <div>
                        <p className="text-xs text-muted-foreground mb-1 flex items-center gap-1.5"><Camera className="h-3.5 w-3.5" /> CAD design</p>
                        <div className="relative group rounded-xl border border-border overflow-hidden bg-secondary/40">
                          <img
                            src={o.cadImage} alt="CAD design"
                            className="w-full max-h-72 object-contain cursor-pointer"
                            onClick={() => setLightboxSrc(o.cadImage!)}
                          />
                          <button
                            onClick={() => downloadOne(o.cadImage!, `${openFolder.design}-cad.jpg`)}
                            className="absolute bottom-2 right-2 h-8 w-8 rounded-lg bg-black/50 text-white grid place-items-center"
                            aria-label="Download CAD design"
                          >
                            <Download className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>
                    )}

                    {(o.productPhotos?.length ?? 0) > 0 && (
                      <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                        {o.productPhotos!.map((src, i) => (
                          <div key={i} className="relative group aspect-square rounded-xl border border-border bg-secondary/40 overflow-hidden">
                            <img
                              src={src} alt={`Photo ${i + 1}`}
                              className="h-full w-full object-cover cursor-pointer"
                              onClick={() => setLightboxSrc(src)}
                            />
                            <button
                              onClick={() => downloadOne(src, `${openFolder.design}-photo-${i + 1}.jpg`)}
                              className="absolute bottom-1.5 right-1.5 h-7 w-7 rounded-lg bg-black/50 text-white grid place-items-center opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity"
                              aria-label="Download photo"
                            >
                              <Download className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}

                    {o.productVideo && (
                      <div className="space-y-2">
                        <div className="rounded-xl border border-border bg-black overflow-hidden">
                          <video src={o.productVideo} controls playsInline className="w-full max-h-72 mx-auto" />
                        </div>
                        <div className="flex items-center justify-end">
                          <button
                            onClick={() => downloadOne(o.productVideo!, `${openFolder.design}-video.mp4`)}
                            className="flex items-center gap-1.5 h-8 px-3 rounded-lg border border-border text-xs font-medium hover:bg-secondary"
                          >
                            <Download className="h-3.5 w-3.5" /> Download video
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </motion.div>
            </div>
          </>
        )}
      </AnimatePresence>

      {/* Lightbox */}
      <AnimatePresence>
        {lightboxSrc && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-[60] bg-black/95 flex items-center justify-center p-6"
            onClick={() => setLightboxSrc(null)}
          >
            <img src={lightboxSrc} alt="" className="max-w-full max-h-full object-contain rounded-xl" />
            <button
              onClick={() => setLightboxSrc(null)}
              className="absolute top-4 right-4 h-10 w-10 rounded-full bg-white/10 text-white grid place-items-center"
            >
              <X className="h-5 w-5" />
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
