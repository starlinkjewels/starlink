// A shared link to pieces made on orders (Design Studio → By Order → Share):
// kind "orderDesign" — one piece's product page; kind "orderCategory" — every
// piece of a category as cards, each opening its own product page (?p=). The
// same page as a catalogue design's link: pictures, details, the options as
// dropdowns, and the price only when shared with one — worked out on the server
// (functions-specs specsShare) from the details kept on the link. Nothing of the
// orders behind them: no client, no labour, no costs.
import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Image as ImageIcon } from "lucide-react";
import { BrandLogo } from "@/components/BrandLogo";
import { ProductView, type Pic } from "@/components/catalog/ProductView";
import { shareQuote, type DesignQuote } from "@/lib/productPricing";
import { brandName, useBrand } from "@/lib/brand";
import type { Share, SharedOrderProduct } from "@/lib/db";
import { METAL_LABEL, type Choice } from "@/lib/pure/pricing";

const EMPTY = { metals: [], colours: [], ringSizes: [], types: [], qualities: [], hasStones: false };

/** One piece's product page, priced on the server for the options chosen. */
function SharedPiece({ share, product, index, back }: { share: Share; product: SharedOrderProduct; index?: number; back?: { label: string; to: string } }) {
  const brand = useBrand();
  const [choice, setChoice] = useState<Partial<Choice>>({});
  const [q, setQ] = useState<DesignQuote | null>(null);
  const [busy, setBusy] = useState(true);
  const [failed, setFailed] = useState("");
  const pictures: Pic[] = useMemo(() => product.items.map((it, i) => ({ id: `${i}`, url: it.url, thumb: it.thumb, name: it.name })), [product]);
  const videos: Pic[] = useMemo(() => (product.videos ?? []).map((url, i) => ({ id: `v${i}`, url, name: `${product.title} video` })), [product]);
  const key = JSON.stringify(choice);
  useEffect(() => {
    let alive = true;
    setBusy(true);
    const t = window.setTimeout(() => {
      shareQuote(share.id, choice, index).then(r => { if (alive) { setQ(r); setFailed(""); } })
        .catch(e => { if (alive) setFailed((e as Error).message || "This link can't be opened now."); })
        .finally(() => { if (alive) setBusy(false); });
    }, 200);
    return () => { alive = false; window.clearTimeout(t); };
  }, [key, share.id, index]); // eslint-disable-line react-hooks/exhaustive-deps
  const ready = !!q?.ready;
  const pick = q?.ready && q.choice ? { ...q.choice, ...choice } as Choice : null;
  return (
    <ProductView
      title={product.title}
      subtitle={[product.category, share.kind === "orderDesign" ? share.note : null].filter(Boolean).join(" · ") || undefined}
      back={back}
      pictures={pictures} spin={[]} videos={videos}
      ready={ready}
      notReady={failed || (busy ? "Loading…" : "Ask us for this piece's details and price.")}
      options={q?.ready ? q.options : EMPTY}
      pick={pick} onPick={c => setChoice(x => ({ ...x, ...c }))} sheetUs={q?.ready ? q.details.sheetUs ?? undefined : undefined}
      price={{
        amount: q?.ready ? q.price : null, ccy: (q?.ready && (q.ccy ?? q.options.ccy)) || "USD", busy,
        note: pick ? <>At today's {METAL_LABEL[pick.metal].toLowerCase()} rate — it moves with the rate.</> : undefined,
        ...(share.showPrice ? {} : { ask: `Ask ${brandName(brand) || "us"} for the price of this piece in the options you chose.` }),
      }}
      grams={q?.ready ? q.details.grams : undefined}
      specs={q?.ready ? { stones: q.details.stones, stoneTotals: q.details.stoneTotals ?? undefined, dimsMm: q.details.dimsMm, ringSize: q.details.ringSize ?? undefined, metal: {} } : null}
    />
  );
}

export function OrderShareView({ share }: { share: Share }) {
  const [sp] = useSearchParams();
  const list = share.products ?? [];
  const n = Number(sp.get("p"));
  const open = share.kind === "orderCategory" && sp.get("p") != null && Number.isInteger(n) && list[n] ? n : null;
  return (
    // The app shell locks html/body/#root (height 100%, overflow hidden): the page scrolls in its own box, as the gallery does.
    <div className="fixed inset-0 overflow-y-auto overscroll-contain bg-[#F7F9FC]">
      <header className="bg-white border-b border-border/60">
        <div className="max-w-6xl mx-auto px-4 h-14 flex items-center gap-2"><BrandLogo className="h-8 w-auto" /></div>
      </header>
      <main className="max-w-6xl mx-auto px-4 py-5">
        {share.kind === "orderDesign" && share.product ? <SharedPiece share={share} product={share.product} />
          : open != null ? <SharedPiece key={open} share={share} product={list[open]} index={open} back={{ label: share.title, to: "?" }} />
          : (
            <div className="space-y-4">
              <div>
                <h1 className="font-display text-2xl md:text-3xl text-brand-dark">{share.title}</h1>
                <p className="text-sm text-muted-foreground">{list.length} design{list.length !== 1 ? "s" : ""}{share.note ? ` · ${share.note}` : ""}</p>
              </div>
              {list.length === 0 ? <div className="card-luxe p-8 text-center text-sm text-muted-foreground">Nothing on this link yet.</div> : (
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 sm:gap-4">
                  {list.map((p, i) => (
                    <Link key={i} to={`?p=${i}`} aria-label={`Open ${p.title}`}
                      className="flex flex-col rounded-2xl border border-border/60 bg-white shadow-sm overflow-hidden">
                      <div className="aspect-square w-full bg-secondary/30 overflow-hidden relative">
                        {p.items[0] ? <img src={p.items[0].thumb || p.items[0].url} alt="" loading="lazy" decoding="async" className="w-full h-full object-cover" />
                          : <div className="absolute inset-0 grid place-items-center"><ImageIcon className="h-8 w-8 text-muted-foreground/40" /></div>}
                      </div>
                      <div className="px-3 pt-2 pb-2.5 min-w-0">
                        <p className="text-sm font-medium text-foreground truncate">{p.title}</p>
                        {p.line && <p className="text-[11px] text-muted-foreground truncate">{p.line}</p>}
                      </div>
                    </Link>
                  ))}
                </div>
              )}
            </div>
          )}
      </main>
    </div>
  );
}
