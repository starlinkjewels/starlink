import { useEffect, useState } from "react";
import { ArrowLeft, ChevronDown, Download, Gem, Link2, Loader2, Mail, MessageCircle, Play, Rows3, LayoutList, X } from "lucide-react";
import { toast } from "sonner";
import { fmtMoney, type Share, type ShareBrand, type SharePiece } from "@/lib/db";
import { diamondRows, downloadLineSheetPdf, downloadPiecesPdf, goldRows, metalLine } from "@/lib/piecesPdf";

/*
 * What a client sees from a shared link: one piece as its own page — the photo
 * (or its video) large, the name, the price, a line about it and the details
 * to open — or several pieces as a collection, each opening its own page
 * (…?p=<piece>), which can be sent on by itself.
 *
 * Its own quiet palette — ink, cream and a gold line — whatever the company's
 * app colour, so a piece reads the same in every client's hands.
 */
const INK = "#1c1917";

/** "?p=" — the piece opened from a collection. */
const pieceParam = () => new URLSearchParams(window.location.search).get("p");

/** A sentence about the piece, from what it is made of. */
function describe(p: SharePiece): string {
  const metal = metalLine(p);
  const what = `${metal ? `${metal} ` : ""}${(p.type || "piece").toLowerCase()}`;
  const stones = p.diamondCt
    ? ` set with ${p.diamondCt} ct of ${[p.diamondShape?.toLowerCase(), p.diamondType && p.diamondType.toLowerCase() !== "natural" ? p.diamondType : p.diamondType?.toLowerCase()].filter(Boolean).join(" ")} diamonds${p.diamondPcs ? ` — ${p.diamondPcs} stones` : ""}`.replace(/\s+/g, " ")
    : "";
  const quality = p.diamondQuality ? `, ${p.diamondQuality}` : "";
  const weight = p.grossG ? ` It weighs ${p.grossG} g.` : "";
  return `A${/^[aeiou]/i.test(what) ? "n" : ""} ${what}${stones}${quality}.${weight}`;
}

export function PieceShareView({ share }: { share: Share }) {
  const pieces = share.pieces ?? [];
  const brand = share.brand ?? { name: share.title };
  const [openId, setOpenId] = useState<string | null>(() => pieceParam());
  // Back and forward move between the collection and a piece.
  useEffect(() => {
    const onPop = () => setOpenId(pieceParam());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  const open = (id: string | null) => {
    const u = new URL(window.location.href);
    if (id) u.searchParams.set("p", id); else u.searchParams.delete("p");
    window.history.pushState({}, "", u);
    setOpenId(id);
    document.getElementById("share-scroll")?.scrollTo({ top: 0 });
  };
  const single = pieces.length === 1 ? pieces[0] : pieces.find(p => p.id === openId);
  const base = `${window.location.origin}${window.location.pathname}`;
  const linkOf = (p: SharePiece) => (pieces.length > 1 ? `${base}?p=${encodeURIComponent(p.id)}` : base);

  return (
    // The app shell locks the page from scrolling; this page scrolls itself.
    <div id="share-scroll" className="fixed inset-0 overflow-y-auto overscroll-contain bg-[#faf8f4] text-stone-900">
      <header className="sticky top-0 z-20 bg-[#faf8f4]/90 backdrop-blur border-b border-stone-200/70">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            {single && pieces.length > 1 && (
              <button type="button" onClick={() => open(null)} aria-label="All pieces" className="h-9 w-9 -ml-1 rounded-full grid place-items-center hover:bg-stone-200/60 shrink-0"><ArrowLeft className="h-4.5 w-4.5 h-[18px] w-[18px]" /></button>
            )}
            {brand.logo && <img src={brand.logo} alt="" className="h-9 w-auto max-w-[8rem] object-contain" />}
            <span className="font-display text-lg sm:text-xl tracking-wide truncate">{brand.name}</span>
          </div>
          <PdfButton pieces={single ? [single] : pieces} brand={brand} title={single ? single.name : share.title} note={share.note} links={Object.fromEntries((single ? [single] : pieces).map(p => [p.id, linkOf(p)]))} many={!single && pieces.length > 1} />
        </div>
      </header>

      {single
        ? <PieceView p={single} brand={brand} link={linkOf(single)} note={share.note} />
        : <Collection share={share} pieces={pieces} onOpen={open} />}

      <footer className="border-t border-stone-200/70 py-6 text-center text-xs text-stone-500">
        {[brand.website, brand.email, brand.phone].filter(Boolean).join("   ·   ")}
      </footer>
    </div>
  );
}

/** The PDF button — a collection asks which kind. */
function PdfButton({ pieces, brand, title, note, links, many }: { pieces: SharePiece[]; brand: ShareBrand; title: string; note?: string; links: Record<string, string>; many: boolean }) {
  const [busy, setBusy] = useState(false);
  const [menu, setMenu] = useState(false);
  const go = async (kind: "pages" | "sheet") => {
    setMenu(false); setBusy(true);
    try {
      const opts = { title, note, filename: title, links };
      if (kind === "sheet") await downloadLineSheetPdf(pieces, brand, opts); else await downloadPiecesPdf(pieces, brand, opts);
    } catch { toast.error("Couldn't make the PDF"); }
    finally { setBusy(false); }
  };
  return (
    <div className="relative shrink-0">
      <button type="button" onClick={() => (many ? setMenu(v => !v) : go("pages"))} disabled={busy}
        className="flex items-center gap-1.5 h-10 px-4 rounded-full text-white text-sm font-medium disabled:opacity-60" style={{ background: INK }}>
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
        <span>Download PDF</span>{many && <ChevronDown className="h-3.5 w-3.5 opacity-70" />}
      </button>
      {menu && (
        <div className="absolute right-0 mt-2 w-60 rounded-2xl bg-white shadow-xl ring-1 ring-stone-200 p-1.5 z-30">
          <button type="button" onClick={() => go("sheet")} className="w-full flex items-start gap-2.5 rounded-xl px-3 py-2 text-left hover:bg-stone-100">
            <Rows3 className="h-4 w-4 mt-0.5 text-stone-500" /><span><span className="block text-sm font-medium">Line sheet</span><span className="block text-xs text-stone-500">Every piece in a table</span></span>
          </button>
          <button type="button" onClick={() => go("pages")} className="w-full flex items-start gap-2.5 rounded-xl px-3 py-2 text-left hover:bg-stone-100">
            <LayoutList className="h-4 w-4 mt-0.5 text-stone-500" /><span><span className="block text-sm font-medium">Product pages</span><span className="block text-xs text-stone-500">A page a piece, large photos</span></span>
          </button>
        </div>
      )}
    </div>
  );
}

/** Several pieces: the collection, each opening its own page. */
function Collection({ share, pieces, onOpen }: { share: Share; pieces: SharePiece[]; onOpen(id: string): void }) {
  return (
    <main className="max-w-6xl mx-auto px-4 sm:px-6 py-8 sm:py-12">
      <div className="text-center max-w-2xl mx-auto mb-8 sm:mb-12">
        <p className="text-[11px] tracking-[0.3em] uppercase text-stone-500">{pieces.length} pieces</p>
        <h1 className="font-display italic text-4xl sm:text-5xl mt-2 leading-tight">{share.title}</h1>
        {share.note && <p className="text-stone-600 mt-3">{share.note}</p>}
        <div className="mx-auto mt-5 h-px w-16 bg-[#a67c3e]" />
      </div>
      <div className="grid gap-5 sm:gap-6 grid-cols-2 lg:grid-cols-3">
        {pieces.map(p => (
          <button key={p.id} type="button" onClick={() => onOpen(p.id)} className="group text-left">
            <div className="relative aspect-square rounded-2xl overflow-hidden bg-white ring-1 ring-stone-200/80 grid place-items-center">
              {p.photos[0] || p.cad
                ? <img src={p.photos[0] || p.cad} alt={p.name} loading="lazy" className="h-full w-full object-contain p-4 transition-transform duration-500 group-hover:scale-[1.04]" />
                : <Gem className="h-10 w-10 text-stone-300" />}
              {p.video && <span className="absolute bottom-3 left-3 h-8 w-8 rounded-full bg-black/60 text-white grid place-items-center"><Play className="h-3.5 w-3.5 ml-0.5" /></span>}
            </div>
            <div className="pt-3 px-0.5">
              <p className="font-display text-lg sm:text-xl leading-snug line-clamp-2 group-hover:underline underline-offset-4 decoration-stone-300">{p.name}</p>
              <p className="text-xs text-stone-500 mt-0.5">{[p.sku && `Design ${p.sku}`, p.diamondCt && `${p.diamondCt} ct`].filter(Boolean).join(" · ")}</p>
              {p.price != null && <p className="text-sm font-semibold mt-1">{fmtMoney(p.price)}</p>}
            </div>
          </button>
        ))}
      </div>
    </main>
  );
}

/** One piece, as its own page. */
function PieceView({ p, brand, link, note }: { p: SharePiece; brand: ShareBrand; link: string; note?: string }) {
  type Shot = { url: string; kind: "photo" | "cad" | "video" };
  const shots: Shot[] = [
    ...(p.video ? [{ url: p.video, kind: "video" as const }] : []),
    ...p.photos.map(url => ({ url, kind: "photo" as const })),
    ...(p.cad ? [{ url: p.cad, kind: "cad" as const }] : []),
  ];
  const [cur, setCur] = useState(0);
  const [zoom, setZoom] = useState<string | null>(null);
  const shown = shots[cur];
  const gold = goldRows(p), dia = diamondRows(p);
  const phone = (brand.phone ?? "").replace(/[^\d]/g, "");
  const ask = `Hello, I am interested in ${p.name}${p.sku ? ` (design ${p.sku})` : ""}. ${link}`;
  const contact = phone.length >= 8
    ? { href: `https://wa.me/${phone}?text=${encodeURIComponent(ask)}`, label: "Contact the seller", Icon: MessageCircle }
    : brand.email ? { href: `mailto:${brand.email}?subject=${encodeURIComponent(p.name)}&body=${encodeURIComponent(ask)}`, label: "Contact the seller", Icon: Mail } : null;
  const copy = async () => {
    try { await navigator.clipboard.writeText(link); toast.success("Link copied"); } catch { toast.error("Couldn't copy the link"); }
  };

  return (
    <main className="max-w-6xl mx-auto lg:px-6 lg:py-8">
      <div className="grid lg:grid-cols-[1.15fr_1fr] lg:gap-10 items-start">
        {/* The piece — its video or photos, large, on black */}
        <div className="lg:sticky lg:top-24">
          <div className={`relative aspect-square ${shown ? "bg-black" : "bg-[#f1ede4]"} lg:rounded-3xl overflow-hidden grid place-items-center`}>
            {!shown ? <Gem className="h-14 w-14 text-stone-300" />
              : shown.kind === "video"
                ? <video key={shown.url} src={shown.url} autoPlay muted loop playsInline controls className="h-full w-full object-contain" />
                : <button type="button" onClick={() => setZoom(shown.url)} className="h-full w-full grid place-items-center bg-white" aria-label="Enlarge">
                    <img src={shown.url} alt={p.name} className="h-full w-full object-contain p-4" />
                  </button>}
            {shown?.kind === "cad" && <span className="absolute top-4 left-4 rounded-full bg-black/75 text-white text-[11px] font-semibold tracking-wider px-3 py-1">CAD</span>}
          </div>
          {shots.length > 1 && (
            <div className="flex gap-2.5 px-4 lg:px-0 pt-3 overflow-x-auto">
              {shots.map((s, i) => (
                <button key={s.url + i} type="button" onClick={() => setCur(i)} aria-label={s.kind === "video" ? "Video" : s.kind === "cad" ? "CAD" : `Photo ${i + 1}`}
                  className={`relative h-16 w-16 shrink-0 rounded-xl overflow-hidden ring-1 transition ${i === cur ? "ring-2 ring-stone-900" : "ring-stone-200 opacity-80 hover:opacity-100"} ${s.kind === "video" ? "bg-black" : "bg-white"}`}>
                  {s.kind === "video"
                    ? <span className="absolute inset-0 grid place-items-center text-white"><Play className="h-5 w-5 ml-0.5" /></span>
                    : <img src={s.url} alt="" className="h-full w-full object-contain" />}
                  {s.kind === "cad" && <span className="absolute bottom-0 inset-x-0 bg-black/70 text-white text-[9px] font-semibold text-center">CAD</span>}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* What it is */}
        <div className="px-5 sm:px-8 lg:px-0 py-8 lg:py-4">
          <p className="text-[11px] tracking-[0.3em] uppercase text-stone-500">{[p.type, p.sku && `Design ${p.sku}`].filter(Boolean).join("  ·  ")}</p>
          <h1 className="font-display italic text-4xl sm:text-5xl leading-[1.08] mt-3">{p.name}</h1>
          {p.price != null && <p className="font-display text-3xl mt-4">{fmtMoney(p.price)}</p>}
          <p className="text-stone-700 text-[17px] leading-relaxed mt-5">{describe(p)}</p>
          {note && <p className="text-stone-500 text-sm mt-3 italic">{note}</p>}

          <div className="mt-7 space-y-3">
            {contact && (
              <a href={contact.href} target="_blank" rel="noopener noreferrer"
                className="flex items-center justify-center gap-2.5 h-14 rounded-full text-white text-[15px] font-semibold tracking-[0.12em] uppercase hover:opacity-90 transition" style={{ background: INK }}>
                <contact.Icon className="h-5 w-5" /> {contact.label}
              </a>
            )}
            <button type="button" onClick={copy} className="w-full flex items-center justify-center gap-2 h-11 rounded-full border border-stone-300 text-sm font-medium hover:bg-white">
              <Link2 className="h-4 w-4" /> Copy the link to this piece
            </button>
          </div>

          <div className="mt-8 border-t border-stone-200">
            {gold.length > 0 && <Fold title="Materials" rows={gold} open />}
            {dia.length > 0 && <Fold title="Diamonds" rows={dia} open={!gold.length} />}
          </div>
        </div>
      </div>

      {zoom && (
        <div className="fixed inset-0 z-50 bg-black/95 grid place-items-center p-4" onClick={() => setZoom(null)}>
          <img src={zoom} alt="" className="max-h-full max-w-full object-contain" />
          <button aria-label="Close" className="absolute top-4 right-4 h-11 w-11 rounded-full bg-white/15 text-white grid place-items-center"><X className="h-5 w-5" /></button>
        </div>
      )}
    </main>
  );
}

/** A heading that opens to its details. */
function Fold({ title, rows, open }: { title: string; rows: [string, string][]; open?: boolean }) {
  return (
    <details open={open} className="group border-b border-stone-200">
      <summary className="flex items-center justify-between cursor-pointer list-none py-5">
        <span className="font-display italic text-2xl">{title}</span>
        <ChevronDown className="h-5 w-5 text-stone-500 transition-transform group-open:rotate-180" />
      </summary>
      <dl className="pb-5 space-y-2.5">
        {rows.map(([k, v]) => (
          <div key={k} className="flex items-baseline justify-between gap-4 text-[15px]">
            <dt className="text-stone-500">{k}</dt>
            <dd className="font-medium text-right">{v}</dd>
          </div>
        ))}
      </dl>
    </details>
  );
}
