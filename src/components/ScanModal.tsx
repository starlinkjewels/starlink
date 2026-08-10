import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { BrowserMultiFormatReader, type IScannerControls } from "@zxing/browser";
import { useDb } from "@/hooks/useDb";
import { X, ScanLine, Search } from "lucide-react";
import { toast } from "sonner";

/** Full-screen barcode scanner (mobile). Opens the rear camera, reads a Code128
 *  tag we printed, and jumps to that order (or ready-stock item). Falls back to a
 *  manual code box if the camera isn't available/allowed. */
export function ScanModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const db = useDb();
  const nav = useNavigate();
  const videoRef = useRef<HTMLVideoElement>(null);
  const controlsRef = useRef<IScannerControls | null>(null);
  const [error, setError] = useState("");
  const [manual, setManual] = useState("");

  // Look up a scanned/typed code → navigate. Returns true if something matched.
  const resolve = (raw: string): boolean => {
    const t = raw.trim();
    if (!t) return false;
    const order = db.orders.find(o => o.orderNumber.toLowerCase() === t.toLowerCase());
    if (order) { onClose(); nav(`/orders/${order.id}`); return true; }
    const item = db.readyStock.find(i => (i.sku && i.sku.toLowerCase() === t.toLowerCase()) || i.id === t);
    if (item) { onClose(); nav("/ready-stock"); toast.success(`Ready Stock: ${item.name}`); return true; }
    return false;
  };

  useEffect(() => {
    if (!open) return;
    setError(""); setManual("");
    let cancelled = false;
    const reader = new BrowserMultiFormatReader();
    reader
      .decodeFromConstraints({ video: { facingMode: "environment" } }, videoRef.current!, (result, _err, controls) => {
        controlsRef.current = controls;
        if (cancelled) { controls.stop(); return; }
        if (result) {
          const text = result.getText();
          if (resolve(text)) controls.stop();
          else setError(`No order or item matches “${text}”. Keep scanning or type it below.`);
        }
      })
      .then(c => { controlsRef.current = c; if (cancelled) c.stop(); })
      .catch(() => setError("Couldn't open the camera. Allow camera access, or type the code below."));
    return () => { cancelled = true; controlsRef.current?.stop(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[70] bg-black flex flex-col" style={{ paddingTop: "env(safe-area-inset-top)", paddingBottom: "env(safe-area-inset-bottom)" }}>
      <div className="flex items-center justify-between px-4 h-14 shrink-0 text-white">
        <span className="flex items-center gap-2 font-medium"><ScanLine className="h-5 w-5" /> Scan barcode</span>
        <button onClick={onClose} className="h-10 w-10 rounded-full bg-white/10 active:bg-white/20 grid place-items-center"><X className="h-5 w-5" /></button>
      </div>

      <div className="relative flex-1 min-h-0 overflow-hidden">
        <video ref={videoRef} className="absolute inset-0 w-full h-full object-cover" muted playsInline />
        {/* Aiming frame */}
        <div className="absolute inset-0 grid place-items-center pointer-events-none">
          <div className="w-64 max-w-[80%] h-28 rounded-2xl border-2 border-white/80 shadow-[0_0_0_9999px_rgba(0,0,0,0.35)]" />
        </div>
        <p className="absolute bottom-4 inset-x-0 text-center text-white/80 text-sm px-6">Point the camera at the tag's barcode</p>
      </div>

      {/* Error + manual fallback */}
      <div className="shrink-0 bg-black px-4 py-3 space-y-2">
        {error && <p className="text-xs text-amber-300">{error}</p>}
        <form onSubmit={e => { e.preventDefault(); if (!resolve(manual)) setError(`No match for “${manual.trim()}”.`); }} className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-white/40" />
            <input value={manual} onChange={e => setManual(e.target.value)} placeholder="Or type / scan the order number…"
              className="w-full h-11 rounded-xl bg-white/10 text-white placeholder:text-white/40 pl-9 pr-3 text-sm outline-none focus:ring-2 focus:ring-white/30" autoComplete="off" />
          </div>
          <button type="submit" className="h-11 px-4 rounded-xl bg-white text-black text-sm font-semibold">Go</button>
        </form>
      </div>
    </div>
  );
}
