import { useState } from "react";
import { Download, Gem, Loader2, X } from "lucide-react";
import { fmtMoney, type Share, type SharePiece } from "@/lib/db";
import { diamondRows, downloadPiecesPdf, goldRows } from "@/lib/piecesPdf";

/** What a client sees from a Ready Stock share link: the pieces, as chosen. */
export function PieceShareView({ share }: { share: Share }) {
  const pieces = share.pieces ?? [];
  const brand = share.brand ?? { name: share.title };
  const [busy, setBusy] = useState<string | null>(null);
  const [zoom, setZoom] = useState<string | null>(null);
  const pdf = async (list: SharePiece[], key: string, name: string) => {
    setBusy(key);
    try { await downloadPiecesPdf(list, brand, { title: share.title, note: share.note, filename: name }); }
    finally { setBusy(null); }
  };

  return (
    // The app shell locks the page from scrolling; this page scrolls itself.
    <div className="fixed inset-0 overflow-y-auto overscroll-contain bg-[#F7F9FC]">
      <header className="sticky top-0 z-20 bg-white/90 backdrop-blur border-b border-border/60">
        <div className="max-w-6xl mx-auto px-4 h-16 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            {brand.logo && <img src={brand.logo} alt="" className="h-9 w-auto max-w-[8rem] object-contain" />}
            <span className="font-display text-brand-dark text-lg truncate">{brand.name}</span>
          </div>
          <button onClick={() => pdf(pieces, "all", share.title)} disabled={!!busy}
            className="flex items-center gap-1.5 h-10 px-3.5 rounded-xl bg-brand-dark text-white text-sm font-medium disabled:opacity-60 shrink-0">
            {busy === "all" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            <span>Download PDF</span>
          </button>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-6 space-y-5">
        <div>
          <h1 className="font-display text-2xl sm:text-3xl text-brand-dark">{share.title}</h1>
          <p className="text-sm text-muted-foreground mt-1">{pieces.length} piece{pieces.length !== 1 ? "s" : ""}{share.note ? ` · ${share.note}` : ""}</p>
        </div>

        {/* One piece: photos beside its details. Several: two to a row. */}
        <div className={`grid gap-5 ${pieces.length > 1 ? "md:grid-cols-2" : ""}`}>
          {pieces.map(p => <PieceCard key={p.id} p={p} wide={pieces.length === 1} busy={busy === p.id} onPdf={() => pdf([p], p.id, p.name)} onZoom={setZoom} />)}
        </div>

        <footer className="pt-4 pb-8 text-center text-xs text-muted-foreground">
          {[brand.website, brand.email, brand.phone].filter(Boolean).join("  ·  ")}
        </footer>
      </main>

      {zoom && (
        <div className="fixed inset-0 z-50 bg-black/90 grid place-items-center p-4" onClick={() => setZoom(null)}>
          <img src={zoom} alt="" className="max-h-full max-w-full object-contain rounded-xl" />
          <button aria-label="Close" className="absolute top-4 right-4 h-10 w-10 rounded-full bg-white/15 text-white grid place-items-center"><X className="h-5 w-5" /></button>
        </div>
      )}
    </div>
  );
}

function PieceCard({ p, wide, busy, onPdf, onZoom }: { p: SharePiece; wide?: boolean; busy: boolean; onPdf(): void; onZoom(url: string): void }) {
  const shots = [...p.photos.map(url => ({ url, cad: false })), ...(p.cad ? [{ url: p.cad, cad: true }] : [])];
  const [cur, setCur] = useState(0);
  const shown = shots[cur];
  const gold = goldRows(p), dia = diamondRows(p);
  return (
    <article className={`rounded-2xl bg-white border border-border/60 shadow-sm overflow-hidden flex flex-col ${wide ? "md:flex-row" : ""}`}>
      <div className={wide ? "md:w-1/2 md:border-r md:border-border/60 shrink-0" : ""}>
      <button type="button" onClick={() => shown && onZoom(shown.url)} className="relative w-full aspect-square bg-white grid place-items-center">
        {shown ? <img src={shown.url} alt={p.name} className="h-full w-full object-contain p-3" /> : <Gem className="h-12 w-12 text-muted-foreground/30" />}
        {shown?.cad && <span className="absolute top-3 left-3 rounded-md bg-brand-dark text-white text-[11px] font-semibold px-2 py-0.5">CAD</span>}
      </button>
      {shots.length > 1 && (
        <div className="flex gap-2 px-3 pb-3 overflow-x-auto">
          {shots.map((s, i) => (
            <button key={s.url + i} type="button" onClick={() => setCur(i)} aria-label={s.cad ? "CAD" : `Photo ${i + 1}`}
              className={`relative h-14 w-14 shrink-0 rounded-lg overflow-hidden bg-white ring-1 ${i === cur ? "ring-2 ring-brand-dark" : "ring-border/60"}`}>
              <img src={s.url} alt="" className="h-full w-full object-contain" />
              {s.cad && <span className="absolute bottom-0 inset-x-0 bg-brand-dark/85 text-white text-[9px] font-semibold text-center">CAD</span>}
            </button>
          ))}
        </div>
      )}
      </div>
      <div className={`px-4 pb-4 pt-1 flex-1 flex flex-col gap-3 ${wide ? "md:p-6" : ""}`}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className={`font-display text-brand-dark leading-tight ${wide ? "text-xl md:text-2xl" : "text-xl"}`}>{p.name}</h2>
            <p className="text-xs text-muted-foreground mt-0.5">{[p.type, p.sku && `SKU ${p.sku}`].filter(Boolean).join(" · ")}</p>
          </div>
          {p.price != null && <p className="text-xl font-bold text-brand-dark tabular-nums shrink-0">{fmtMoney(p.price)}</p>}
        </div>
        {(gold.length > 0 || dia.length > 0) && (
          <div className={`grid gap-3 ${wide ? "" : "sm:grid-cols-2"}`}>
            {gold.length > 0 && <Facts title="Gold" rows={gold} />}
            {dia.length > 0 && <Facts title="Diamonds" rows={dia} />}
          </div>
        )}
        <button onClick={onPdf} disabled={busy}
          className="mt-auto self-start flex items-center gap-1.5 h-9 px-3 rounded-xl border border-border bg-white hover:bg-secondary text-xs font-medium text-brand-dark disabled:opacity-60">
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />} PDF of this piece
        </button>
      </div>
    </article>
  );
}

function Facts({ title, rows }: { title: string; rows: [string, string][] }) {
  return (
    <div className="rounded-xl bg-secondary/40 border border-border/50 p-3">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-amber-700/80 mb-1.5">{title}</p>
      <dl className="space-y-1">
        {rows.map(([k, v]) => (
          <div key={k} className="flex items-baseline justify-between gap-3 text-sm">
            <dt className="text-muted-foreground">{k}</dt>
            <dd className="font-medium text-brand-dark text-right">{v}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
