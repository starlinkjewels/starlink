// A piece made on orders as a product page (Design Studio → By Order → a design):
// the catalogue's own page (components/catalog/ProductView.tsx) — its photos, CAD
// and video, the options as dropdowns, one total price for them from today's rates
// and Settings → Product pricing — with its details read off the order (the gold
// actually in it, the diamonds actually set). Nothing of the orders behind it: no
// client, no labour, no profit, no margin. Staff price it here and share it as a
// link; a client asks the server (functions-specs specsOrderPrice) for their own price.
import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Download, Settings2, Share2 } from "lucide-react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ProductView, type Pic, type ProductOptions } from "@/components/catalog/ProductView";
import { DesignShareSheet } from "@/components/catalog/DesignShareSheet";
import { useAuth } from "@/lib/auth";
import { exportAllowed } from "@/lib/access";
import { downloadAsZip } from "@/lib/zipDownload";
import { sharedProduct, type OrderProduct } from "@/lib/orderProducts";
import { findOrderShare, saveOrderShare } from "@/lib/share";
import { orderQuote, useMetalRates, usePriceRules, type ClientQuote } from "@/lib/productPricing";
import { categoryOf, centreSizes, gramsFor, priceDesign, sheetRingUs, takesRingSize, withCentre, METAL_LABEL, type Ccy, type Choice } from "@/lib/pure/pricing";

const NONE: ProductOptions = { metals: [], colours: [], ringSizes: [], types: [], qualities: [], hasStones: false };

export function OrderProductPage({ product, back }: { product: OrderProduct; back: { label: string; to: string } }) {
  const { user } = useAuth();
  const staff = user?.role === "admin" || user?.role === "employee";
  const rules = usePriceRules(staff);
  const rates = useMetalRates();
  const [choice, setChoice] = useState<Partial<Choice>>({});
  const [quote, setQuote] = useState<ClientQuote | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const specs = product.specs;
  const category = rules ? categoryOf([product.category], product.design, rules) : undefined;

  const pictures: Pic[] = useMemo(() => [
    ...product.photos.map((url, i) => ({ id: `p${i}`, url, name: `${product.design} photo ${i + 1}` })),
    ...product.cads.map((url, i) => ({ id: `c${i}`, url, name: `${product.design} CAD${product.cads.length > 1 ? ` ${i + 1}` : ""}` })),
  ], [product]);
  const videos: Pic[] = useMemo(() => product.videos.map((url, i) => ({ id: `v${i}`, url, name: `${product.design} video` })), [product]);

  // What it comes in: staff from the rules here; a client as the server says.
  const options: ProductOptions = useMemo(() => {
    if (!staff) return quote?.ready ? quote.options : NONE;
    if (!rules) return NONE;
    const ring = takesRingSize(category) || (!category && !!specs.ringSize);
    return {
      metals: rules.metals.filter(m => gramsFor(specs.metal ?? {}, m, rules).g > 0),
      colours: rules.colours, ringSizes: ring ? rules.ring.sizes : [], types: rules.diamonds.types, qualities: rules.diamonds.qualities,
      hasStones: (specs.stones?.length ?? 0) > 0, centre: centreSizes(specs.stones ?? [], rules),
    };
  }, [staff, quote, rules, specs, category]);
  const sheetUs = staff ? sheetRingUs(specs) : quote?.ready ? quote.details.sheetUs ?? undefined : undefined;
  const nearest = (us?: number) => (us && options.ringSizes.length ? options.ringSizes.reduce((a, b) => (Math.abs(b - us) < Math.abs(a - us) ? b : a)) : options.ringSizes[0]);
  const pick: Choice | null = options.metals.length ? {
    metal: choice.metal && options.metals.includes(choice.metal) ? choice.metal : (options.metals.find(m => (specs.metal ?? {})[m] > 0) ?? (quote?.ready ? quote.choice?.metal : undefined) ?? options.metals[0]),
    colour: choice.colour ?? options.colours[0]?.id,
    ringUs: options.ringSizes.length ? choice.ringUs ?? nearest(sheetUs ?? rules?.ring.baseUs ?? 7) : undefined,
    diamondType: choice.diamondType ?? options.types[0]?.id ?? "natural",
    quality: choice.quality ?? options.qualities[0]?.id ?? "",
    ccy: (choice.ccy || (staff ? "USD" : quote?.ready ? quote.options.ccy : undefined) || "USD") as Ccy,
    ...(choice.centreCt && options.centre?.sizes.includes(choice.centreCt) ? { centreCt: choice.centreCt } : {}),
  } : null;

  const priced = useMemo(() => (staff && rules && pick ? priceDesign(specs, pick, rules, rates ?? null) : null), [staff, rules, specs, pick, rates]); // eslint-disable-line react-hooks/exhaustive-deps
  const pickKey = JSON.stringify(pick ?? choice);
  useEffect(() => {
    if (staff) return;
    let alive = true;
    setQuoting(true);
    const t = window.setTimeout(() => {
      orderQuote(product.main.id, pick ?? choice).then(q => { if (alive) setQuote(q); }).catch(() => { if (alive) setQuote(null); }).finally(() => { if (alive) setQuoting(false); });
    }, 250);
    return () => { alive = false; window.clearTimeout(t); };
  }, [pickKey, staff, product.main.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = (c: Partial<Choice>) => setChoice(x => ({ ...x, ...c }));
  const ccy = pick?.ccy ?? "USD";
  const ready = staff ? true : !!quote?.ready;
  const amount = staff ? (priced && !priced.missing.length ? priced.price : null) : quote?.ready && typeof quote.price === "number" ? quote.price : null;
  const at = rates?.at ?? (quote?.ready ? quote.asOf : null);
  const shownSpecs = () => {
    if (!pick?.centreCt || !rules) return specs;
    const stones = withCentre(specs.stones ?? [], pick.centreCt, rules);
    return { ...specs, stones, stoneTotals: { pcs: stones.reduce((t, r) => t + r.pcs, 0), ct: Math.round(stones.reduce((t, r) => t + r.total, 0) * 1000) / 1000 } };
  };

  const downloadAll = async () => {
    if (!exportAllowed()) return;
    setDownloading(true);
    try {
      const files = [...pictures, ...videos].map((p, i) => ({ url: p.url, filename: `${product.design}-${i + 1}${videos.includes(p) ? ".mp4" : ".jpg"}` }));
      const r = await downloadAsZip(files, product.design);
      if (!r.added) toast.error("Nothing could be downloaded — check the connection and try again");
      else if (r.failed.length) toast.warning(`${r.added} downloaded, ${r.failed.length} could not be fetched`);
      else toast.success(`${r.added} file${r.added !== 1 ? "s" : ""} downloaded as ${product.design}.zip`);
    } finally { setDownloading(false); }
  };
  const shareKey = `design:${product.category}/${product.design}`;

  return (
    <>
      <ProductView
        title={product.design}
        subtitle={product.category}
        back={back}
        headerActions={<>
          {pictures.length + videos.length > 0 && <Button size="sm" variant="outline" className="gap-1.5" disabled={downloading} onClick={downloadAll}><Download className="h-4 w-4" />{downloading ? "Downloading…" : "Download"}</Button>}
          {staff && <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setSharing(true)}><Share2 className="h-4 w-4" />Share</Button>}
        </>}
        pictures={pictures} spin={[]} videos={videos}
        ready={ready}
        notReady={quoting && !quote ? "Loading…" : "Ask us for this piece's details and price."}
        options={options} pick={pick} onPick={set} sheetUs={sheetUs}
        extraControls={staff ? (
          <div className="grid grid-cols-2 gap-3">
            <div className="min-w-0"><p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide mb-1">Currency</p>
              <Select value={ccy} onValueChange={v => set({ ccy: v as Ccy })}>
                <SelectTrigger aria-label="Currency" className="h-11 rounded-xl bg-white"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="USD">$ Export</SelectItem><SelectItem value="INR">₹ India</SelectItem></SelectContent>
              </Select></div>
          </div>
        ) : undefined}
        price={{
          amount, ccy: staff ? ccy : (quote?.ready && quote.ccy) || ccy, busy: !staff && quoting,
          note: <>At today's {pick ? METAL_LABEL[pick.metal].toLowerCase() : "metal"} rate{at ? ` (${new Date(at).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })})` : ""} — it moves with the rate.</>,
          ...(!staff && quote?.see === "details" ? { ask: "Ask us for the price of this piece in the options you chose." } : {}),
        }}
        priceExtra={staff && priced?.missing.length ? (
          <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            <p className="font-medium flex items-center gap-1"><AlertTriangle className="h-3.5 w-3.5" />No price until these are set:</p>
            <ul className="list-disc pl-5 mt-1 space-y-0.5">{priced.missing.slice(0, 8).map(m => <li key={m}>{m}</li>)}</ul>
            {user?.role === "admin" && <Link to="/settings?tab=productpricing" className="inline-flex items-center gap-1 mt-2 text-primary underline"><Settings2 className="h-3.5 w-3.5" />Product pricing</Link>}
          </div>
        ) : staff && rules && !options.metals.length ? (
          <p className="text-xs text-amber-900 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2">
            {Object.keys(specs.metal ?? {}).length ? "None of the metals offered in Settings → Product pricing can be worked out from this piece's metal." : "No gold, platinum or silver weight on its order yet — the price comes once the piece's metal is weighed (Final Approval)."}
          </p>
        ) : undefined}
        grams={staff ? priced?.grams : quote?.ready ? quote.details.grams : undefined}
        gramsNote={staff && priced?.gramsFrom === "worked out" ? "(worked out from the piece's own metal)" : undefined}
        specs={staff ? shownSpecs() : quote?.ready ? { stones: quote.details.stones, stoneTotals: quote.details.stoneTotals ?? undefined, dimsMm: quote.details.dimsMm, ringSize: quote.details.ringSize ?? undefined, metal: {} } : null}
        aboveTabBar
      />
      {sharing && (
        <DesignShareSheet title={product.design} onClose={() => setSharing(false)}
          description="Its pictures, details and options — and its price, if you choose. Never its orders, client, labour or costs."
          existing={findOrderShare("orderDesign", shareKey)}
          onSave={c => {
            const sp = sharedProduct(product);
            return saveOrderShare({ kind: "orderDesign", key: shareKey, title: product.design, items: sp.items, product: sp, ...c });
          }} />
      )}
    </>
  );
}
