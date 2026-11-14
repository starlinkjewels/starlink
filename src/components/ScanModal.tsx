import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { BrowserMultiFormatReader, type IScannerControls } from "@zxing/browser";
import { useDb } from "@/hooks/useDb";
import { X, ScanLine, Search, ChevronRight } from "lucide-react";
import { ensureCollections } from "@/lib/db";
import { resolveCode, type ScanHit } from "@/lib/scanResolve";

/**
 * Scan (or type) a code and act on it: a piece's tag (its tag number, SKU or the ID on its card),
 * a bag (BAG-0007), a certified stone (its stock number or report number), an order, a memo, a
 * purchase order or a bill (lib/scanResolve.ts). One match shows what it is with its next steps —
 * Open, Sell…; several (a design number on many lots) are listed to pick. The camera on a phone;
 * on a computer, the box below takes a USB scanner (it types the code and Enter) or typing.
 */
export function ScanModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const db = useDb();
  const nav = useNavigate();
  const videoRef = useRef<HTMLVideoElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const controlsRef = useRef<IScannerControls | null>(null);
  const [error, setError] = useState("");
  const [manual, setManual] = useState("");
  const [hits, setHits] = useState<ScanHit[] | null>(null);
  const [code, setCode] = useState("");

  // Look a scanned/typed code up. True when anything matched.
  const resolve = (raw: string): boolean => {
    const t = raw.trim();
    if (!t) return false;
    const found = resolveCode(db, t);
    if (!found.length) return false;
    setCode(t); setHits(found); setError("");
    return true;
  };
  const go = (to: string) => { onClose(); nav(to); };

  useEffect(() => {
    if (!open) return;
    setError(""); setManual(""); setHits(null); setCode("");
    // Stones, memos, POs and bills are loaded on demand — here before a code is looked up.
    ensureCollections(["diamondPackets", "memos", "purchaseOrders", "purchases"]).catch(() => { /* orders, pieces and bags still match */ });
    setTimeout(() => inputRef.current?.focus(), 50);
    let cancelled = false;
    const reader = new BrowserMultiFormatReader();
    reader
      .decodeFromConstraints({ video: { facingMode: "environment" } }, videoRef.current!, (result, _err, controls) => {
        controlsRef.current = controls;
        if (cancelled) { controls.stop(); return; }
        if (result) {
          const text = result.getText();
          if (resolve(text)) controls.stop();
          else setError(`Nothing matches “${text}”. Keep scanning or type it below.`);
        }
      })
      .then(c => { controlsRef.current = c; if (cancelled) c.stop(); })
      .catch(() => setError("No camera here (or not allowed) — scan with a USB scanner into the box below, or type the code."));
    return () => { cancelled = true; controlsRef.current?.stop(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[70] bg-black flex flex-col" style={{ paddingTop: "env(safe-area-inset-top)", paddingBottom: "env(safe-area-inset-bottom)" }}>
      <div className="flex items-center justify-between px-4 h-14 shrink-0 text-white">
        <span className="flex items-center gap-2 font-medium"><ScanLine className="h-5 w-5" /> Scan a tag, bag or stone</span>
        <button onClick={onClose} aria-label="Close" className="h-10 w-10 rounded-full bg-white/10 active:bg-white/20 grid place-items-center"><X className="h-5 w-5" /></button>
      </div>

      <div className="relative flex-1 min-h-0 overflow-hidden">
        <video ref={videoRef} className="absolute inset-0 w-full h-full object-cover" muted playsInline />
        {!hits && (
          <>
            <div className="absolute inset-0 grid place-items-center pointer-events-none">
              <div className="w-64 max-w-[80%] h-28 rounded-2xl border-2 border-white/80 shadow-[0_0_0_9999px_rgba(0,0,0,0.35)]" />
            </div>
            <p className="absolute bottom-4 inset-x-0 text-center text-white/80 text-sm px-6">Point the camera at the barcode — a tag, a bag label or a stone's label</p>
          </>
        )}
        {hits && (
          <div className="absolute inset-0 bg-black/85 overflow-y-auto p-4">
            <div className="max-w-md mx-auto space-y-3">
              <p className="text-white/70 text-sm">{hits.length === 1 ? "Found" : `${hits.length} match`} “{code}”</p>
              {hits.map(h => (
                <div key={`${h.kind}:${h.id}`} className="rounded-2xl bg-white p-4 space-y-3">
                  <div>
                    <p className="font-semibold text-brand-dark">{h.title}</p>
                    {h.sub && <p className="text-xs text-muted-foreground">{h.sub}</p>}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {h.actions.map((a, i) => (
                      <button key={a.to} type="button" onClick={() => go(a.to)}
                        className={`h-10 px-4 rounded-xl text-sm font-medium inline-flex items-center gap-1.5 ${i === 0 ? "bg-primary text-white" : "border border-border text-brand-dark"}`}>
                        {a.label}{i === 0 && <ChevronRight className="h-4 w-4" />}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
              <button type="button" onClick={() => { setHits(null); setManual(""); setTimeout(() => inputRef.current?.focus(), 50); }}
                className="w-full h-11 rounded-xl bg-white/10 text-white text-sm font-medium">Scan another</button>
            </div>
          </div>
        )}
      </div>

      {/* Error + the box a USB scanner (or a person) types into */}
      <div className="shrink-0 bg-black px-4 py-3 space-y-2">
        {error && <p className="text-xs text-amber-300">{error}</p>}
        <form onSubmit={e => { e.preventDefault(); if (!resolve(manual)) setError(`Nothing matches “${manual.trim()}”.`); else setManual(""); }} className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-white/40" />
            <input ref={inputRef} value={manual} onChange={e => setManual(e.target.value)} placeholder="Scan or type — RS-00042, BAG-0007, DP-0007, an order…" aria-label="Code"
              className="w-full h-11 rounded-xl bg-white/10 text-white placeholder:text-white/40 pl-9 pr-3 text-sm outline-none focus:ring-2 focus:ring-white/30" autoComplete="off" />
          </div>
          <button type="submit" className="h-11 px-4 rounded-xl bg-white text-black text-sm font-semibold">Go</button>
        </form>
      </div>
    </div>
  );
}
