// A shared design's link (/s/:id, kind "design"): the same product page the app
// shows — pictures, details, the options as dropdowns — for anyone with the link,
// signed in or not; the price only when it was shared with one, worked out on the
// server (functions-specs specsShare) for the options chosen.
import { useEffect, useMemo, useState } from "react";
import { BrandLogo } from "@/components/BrandLogo";
import { ProductView, type Pic } from "@/components/catalog/ProductView";
import { shareQuote, type DesignQuote } from "@/lib/productPricing";
import { brandName, useBrand } from "@/lib/brand";
import type { Share } from "@/lib/db";
import { METAL_LABEL, type Choice } from "@/lib/pure/pricing";

export function DesignShareView({ share }: { share: Share }) {
  const brand = useBrand();
  const [choice, setChoice] = useState<Partial<Choice>>({});
  const [q, setQ] = useState<DesignQuote | null>(null);
  const [busy, setBusy] = useState(true);
  const [failed, setFailed] = useState("");
  const pictures: Pic[] = useMemo(() => (share.items ?? []).map((it, i) => ({ id: `${i}`, url: it.url, thumb: it.thumb, name: it.name })), [share.items]);

  const key = JSON.stringify(choice);
  useEffect(() => {
    let alive = true;
    setBusy(true);
    const t = window.setTimeout(() => {
      shareQuote(share.id, choice).then(r => { if (alive) { setQ(r); setFailed(""); } })
        .catch(e => { if (alive) setFailed((e as Error).message || "This link can't be opened now."); })
        .finally(() => { if (alive) setBusy(false); });
    }, 200);
    return () => { alive = false; window.clearTimeout(t); };
  }, [key, share.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const ready = !!q?.ready;
  const pick = q?.ready && q.choice ? { ...q.choice, ...choice } as Choice : null;
  const name = brandName(brand);
  return (
    // The app shell locks html/body/#root (height 100%, overflow hidden): the page scrolls in its own box, as the gallery does.
    <div className="fixed inset-0 overflow-y-auto overscroll-contain bg-[#F7F9FC]">
      <header className="bg-white border-b border-border/60">
        <div className="max-w-6xl mx-auto px-4 h-14 flex items-center gap-2"><BrandLogo className="h-8 w-auto" /></div>
      </header>
      <main className="max-w-6xl mx-auto px-4 py-5">
        <ProductView
          title={q?.designNo || share.title}
          subtitle={[q?.ready ? q.options.category : null, share.note].filter(Boolean).join(" · ") || undefined}
          pictures={pictures} spin={[]} videos={[]}
          ready={ready}
          notReady={failed || (busy ? "Loading…" : "Ask us for this design's details and price.")}
          options={q?.ready ? q.options : { metals: [], colours: [], ringSizes: [], types: [], qualities: [], hasStones: false }}
          pick={pick} onPick={c => setChoice(x => ({ ...x, ...c }))} sheetUs={q?.ready ? q.details.sheetUs ?? undefined : undefined}
          price={{
            amount: q?.ready ? q.price : null, ccy: (q?.ready && (q.ccy ?? q.options.ccy)) || "USD", busy,
            note: pick ? <>At today's {METAL_LABEL[pick.metal].toLowerCase()} rate — it moves with the rate.</> : undefined,
            ...(share.showPrice ? {} : { ask: `Ask ${name || "us"} for the price of this piece in the options you chose.` }),
          }}
          grams={q?.ready ? q.details.grams : undefined}
          specs={q?.ready ? { stones: q.details.stones, stoneTotals: q.details.stoneTotals ?? undefined, dimsMm: q.details.dimsMm, ringSize: q.details.ringSize ?? undefined, metal: {} } : null}
        />
      </main>
    </div>
  );
}
