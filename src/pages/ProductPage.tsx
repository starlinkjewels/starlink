// A catalogue design's product page (Catalog → a design → Product page): its
// pictures, the options it comes in, and its price for those options — from
// today's gold rate and the business's pricing rules (Settings → Product
// pricing): one total price for the selection, never how it is made up (no
// making, no GST, no price per material). Staff see what a price is still
// missing, and share the page as a link; a client sees their own price — or, where the
// business shows them details only, the details and "ask us for the price".
// The page itself is components/catalog/ProductView.tsx (a shared link shows the same).
import { useCan } from "@/hooks/useCan";
import { officeLabel, officeOf } from "@/lib/offices";
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { AlertTriangle, Loader2, Settings2, Share2, ShoppingBag } from "lucide-react";
import { CellTag } from "@/components/DataTable";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ProductView, type Pic, type ProductOptions } from "@/components/catalog/ProductView";
import { DesignShareSheet } from "@/components/catalog/DesignShareSheet";
import { useAuth } from "@/lib/auth";
import { useDb } from "@/hooks/useDb";
import { fetchCatalogItemsByIds } from "@/lib/catalogItems";
import { useDesign } from "@/lib/catalogSpecs";
import type { CatalogItem } from "@/lib/db";
import { clientQuote, useMetalRates, usePriceRules, type ClientQuote } from "@/lib/productPricing";
import { categoryOf, centreSizes, gramsFor, priceDesign, sheetRingUs, takesRingSize, withCentre, METAL_LABEL, type Ccy, type Choice } from "@/lib/pure/pricing";
import { PARSER_VERSION } from "@/lib/pure/specParse";

const pic = (i: CatalogItem): Pic => ({ id: i.id, url: i.data, thumb: i.thumb, name: i.name });
const NONE: ProductOptions = { metals: [], colours: [], ringSizes: [], types: [], qualities: [], hasStones: false };

export function ProductPage() {
  const { key = "" } = useParams();
  const { user } = useAuth();
  const staff = user?.role === "admin" || user?.role === "employee";
  const can = useCan();
  const mayOrder = staff && (user?.role === "admin" || can("orders", "add"));
  const nav = useNavigate();
  const db = useDb();
  const design = useDesign(key);
  const rules = usePriceRules(staff);
  const rates = useMetalRates();
  const [files, setFiles] = useState<Record<string, CatalogItem>>({});
  const [choice, setChoice] = useState<Partial<Choice>>({});
  const [quote, setQuote] = useState<ClientQuote | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [sharing, setSharing] = useState(false);

  const specs = design?.specs ?? null;
  const media = design?.media;
  // The folder the design sits in, up to the top: what kind of piece it is.
  const folderNames = useMemo(() => {
    const out: string[] = [];
    let id: string | null | undefined = design?.folderIds?.[0];
    for (let g = 0; id && g < 30; g++) { const f = db.catalogFolders.find(x => x.id === id); if (!f) break; out.push(f.name); id = f.parentId; }
    return out;
  }, [design?.folderIds, db.catalogFolders]);
  const category = design ? categoryOf(folderNames, design.designNo, rules ?? { categoryByPrefix: {} }) : undefined;

  // The pictures: renders, the 360° set, videos — and, for staff, the sheet.
  useEffect(() => {
    if (!media) return;
    // A design with no picture of its own but its sheet (its renders drawn on it): the sheet, for everyone.
    const sheets = staff ? media.sheets.slice(0, 3) : media.renders.length || media.spin.length ? [] : media.sheets.slice(0, 1);
    const ids = [...media.renders.slice(0, 40), ...media.spin.slice(0, 120), ...media.videos.slice(0, 6), ...sheets];
    let alive = true;
    void fetchCatalogItemsByIds(ids).then(list => { if (alive) setFiles(Object.fromEntries(list.map(i => [i.id, i]))); });
    return () => { alive = false; };
  }, [media, staff]);
  // Pictures only: an Excel sheet is a sheet, never a picture.
  const isPic = (i?: CatalogItem): i is CatalogItem => !!i && i.type === "image";
  const renders = useMemo(() => (media ? media.renders.map(id => files[id]).filter(isPic).map(pic) : []), [media, files]); // eslint-disable-line react-hooks/exhaustive-deps
  const sheetPics = useMemo(() => (media ? media.sheets.map(id => files[id]).filter(isPic).map(pic) : []), [media, files]); // eslint-disable-line react-hooks/exhaustive-deps
  const pictures = useMemo(() => (staff || !renders.length ? [...renders, ...sheetPics] : renders), [staff, renders, sheetPics]);
  const spin = useMemo(() => (media ? media.spin.map(id => files[id]).filter(isPic).map(pic) : []), [media, files]); // eslint-disable-line react-hooks/exhaustive-deps
  const videos = useMemo(() => (media ? media.videos.map(id => files[id]).filter(Boolean).map(pic) : []), [media, files]);

  // What it comes in: staff from the rules here; a client as the server says.
  const options: ProductOptions = useMemo(() => {
    if (!staff) return quote?.ready ? quote.options : NONE;
    if (!rules || !specs) return NONE;
    const ring = takesRingSize(category) || (!category && !!specs.ringSize);
    return {
      metals: rules.metals.filter(m => gramsFor(specs.metal ?? {}, m, rules).g > 0),
      colours: rules.colours, ringSizes: ring ? rules.ring.sizes : [], types: rules.diamonds.types, qualities: rules.diamonds.qualities,
      hasStones: (specs.stones?.length ?? 0) > 0,
      centre: centreSizes(specs.stones ?? [], rules),
    };
  }, [staff, quote, rules, specs, category]);
  const sheetUs = specs ? sheetRingUs(specs) : quote?.ready ? quote.details.sheetUs ?? undefined : undefined;
  const nearest = (us?: number) => (us && options.ringSizes.length ? options.ringSizes.reduce((a, b) => (Math.abs(b - us) < Math.abs(a - us) ? b : a)) : options.ringSizes[0]);
  const sheetMetal = specs?.metal ?? {};
  const pick: Choice | null = options.metals.length ? {
    metal: choice.metal && options.metals.includes(choice.metal) ? choice.metal : (options.metals.find(m => sheetMetal[m] > 0) ?? (quote?.ready ? quote.choice?.metal : undefined) ?? options.metals[0]),
    colour: choice.colour ?? options.colours[0]?.id,
    ringUs: options.ringSizes.length ? choice.ringUs ?? nearest(sheetUs ?? rules?.ring.baseUs ?? 7) : undefined,
    diamondType: choice.diamondType ?? options.types[0]?.id ?? "natural",
    quality: choice.quality ?? options.qualities[0]?.id ?? "",
    ccy: (choice.ccy || (staff ? "USD" : quote?.ready ? quote.options.ccy : undefined) || "USD") as Ccy,
    ...(choice.centreCt && options.centre?.sizes.includes(choice.centreCt) ? { centreCt: choice.centreCt } : {}),
  } : null;
  // The stones as chosen: the centre stone in its size, the totals with it.
  const shownSpecs = (sp: NonNullable<typeof specs>) => {
    if (!pick?.centreCt || !rules) return sp;
    const stones = withCentre(sp.stones ?? [], pick.centreCt, rules);
    return { ...sp, stones, stoneTotals: { pcs: stones.reduce((t, r) => t + r.pcs, 0), ct: Math.round(stones.reduce((t, r) => t + r.total, 0) * 1000) / 1000 } };
  };
  // A sheet read by an older reader is read again before it is priced (Settings → Catalogue reading).
  const current = !!specs && (!!specs.checkedBy || specs.v === PARSER_VERSION);

  // Staff: worked out here. A client: asked of the server, which answers with the price alone.
  const priced = useMemo(() => (staff && rules && specs && pick ? priceDesign(specs, pick, rules, rates ?? null) : null), [staff, rules, specs, pick, rates]); // eslint-disable-line react-hooks/exhaustive-deps
  const pickKey = JSON.stringify(pick ?? choice);
  useEffect(() => {
    if (staff || !design) return;
    let alive = true;
    setQuoting(true);
    const t = window.setTimeout(() => {
      clientQuote(key, pick ?? choice).then(q => { if (alive) setQuote(q); }).catch(() => { if (alive) setQuote(null); }).finally(() => { if (alive) setQuoting(false); });
    }, 250);
    return () => { alive = false; window.clearTimeout(t); };
  }, [pickKey, staff, design?.key]); // eslint-disable-line react-hooks/exhaustive-deps

  if (design === undefined) return <div className="p-8 text-sm text-muted-foreground flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" />Loading…</div>;
  if (!design) return <div className="p-8 text-sm text-muted-foreground">This design isn't in the catalogue (yet). <Link to="/catalog" className="text-primary underline">Catalog</Link></div>;

  const set = (c: Partial<Choice>) => setChoice(x => ({ ...x, ...c }));
  const ccy = pick?.ccy ?? "USD";
  const ready = staff ? !!specs : !!quote?.ready;
  const seesDetailsOnly = !staff && quote?.see === "details";
  const amount = staff ? (current && priced && !priced.missing.length ? priced.price : null) : quote?.ready && typeof quote.price === "number" ? quote.price : null;
  // Ready Stock of this design (its SKU is the design number): pieces on the shelf, office by office.
  const onShelf = (() => {
    const no = design.designNo.trim().toLowerCase();
    const lots = staff ? (db.readyStock ?? []).filter(i => i.quantity > 0 && (i.sku ?? "").trim().toLowerCase() === no) : [];
    const by = new Map<string, number>();
    for (const i of lots) by.set(officeLabel(officeOf(i)), (by.get(officeLabel(officeOf(i))) ?? 0) + i.quantity);
    return { pcs: lots.reduce((t, i) => t + i.quantity, 0), where: by.size > 1 ? [...by].map(([o, n]) => `${o} ${n}`).join(", ") : [...by.keys()][0] ?? "" };
  })();
  const at = rates?.at ?? (quote?.ready ? quote.asOf : null);

  return (
    <>
      <ProductView
        title={design.designNo}
        subtitle={[category, design.counts.spin ? "360° view" : null].filter(Boolean).join(" · ") || undefined}
        back={{ label: "Catalog", to: design.folderIds?.[0] ? `/catalog?f=${design.folderIds[0]}` : "/catalog" }}
        headerActions={staff ? <>
          {design.status !== "ok" && <CellTag tone="amber">{design.status === "review" ? "Please check" : "No details yet"}</CellTag>}
          {/* On the shelf now (Ready Stock's SKU is the design number), and order it — the catalogue is no dead end. */}
          {onShelf.pcs > 0 && <Link to={`/ready-stock?q=${encodeURIComponent(design.designNo)}`} className="text-xs font-medium text-primary hover:underline whitespace-nowrap">In Ready Stock: {onShelf.pcs}{onShelf.where ? ` (${onShelf.where})` : ""}</Link>}
          {mayOrder && <Button size="sm" variant="outline" className="gap-1.5" onClick={() => nav(`/orders/new?design=${encodeURIComponent(design.designNo)}`)}><ShoppingBag className="h-4 w-4" />Order this design</Button>}
          {ready && <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setSharing(true)}><Share2 className="h-4 w-4" />Share</Button>}
        </> : undefined}
        pictures={pictures} spin={spin} videos={videos}
        ready={ready}
        notReady={staff ? <>The details of this design aren't ready yet. Check its sheet in <Link to="/catalog/check" className="text-primary underline">Please check</Link>.</> : quoting && !quote ? "Loading…" : "Ask us for this design's details and price."}
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
          ...(seesDetailsOnly ? { ask: "Ask us for the price of this piece in the options you chose." } : {}),
        }}
        priceExtra={staff && specs && !current ? (
          <p className="text-xs text-amber-900 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2">This sheet was read before the reader's last update — no price until it is read again: {user?.role === "admin" ? <Link to="/settings?tab=catalogread" className="text-primary underline">Settings → Catalogue reading → Read what's not read yet</Link> : "ask an admin to tap Read what's not read yet (Settings → Catalogue reading)"}.</p>
        ) : staff && priced ? <>
          {priced.missing.length > 0 && (
            <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
              <p className="font-medium flex items-center gap-1"><AlertTriangle className="h-3.5 w-3.5" />No price until these are set:</p>
              <ul className="list-disc pl-5 mt-1 space-y-0.5">{priced.missing.slice(0, 8).map(m => <li key={m}>{m}</li>)}</ul>
              {user?.role === "admin" && <Link to="/settings?tab=productpricing" className="inline-flex items-center gap-1 mt-2 text-primary underline"><Settings2 className="h-3.5 w-3.5" />Product pricing</Link>}
            </div>
          )}
        </> : staff && specs && rules && !options.metals.length ? (
          <p className="text-xs text-amber-900 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2">None of the metals offered in Settings → Product pricing has a weight for this design (nor can be worked out).</p>
        ) : undefined}
        grams={staff ? priced?.grams : quote?.ready ? quote.details.grams : undefined}
        gramsNote={staff && priced?.gramsFrom === "worked out" ? "(worked out from the sheet's other metal)" : undefined}
        specs={staff ? (specs ? shownSpecs(specs) : null) : quote?.ready ? { stones: quote.details.stones, stoneTotals: quote.details.stoneTotals ?? undefined, dimsMm: quote.details.dimsMm, ringSize: quote.details.ringSize ?? undefined, metal: {} } : null}
        aboveTabBar
      />
      {sharing && (
        <DesignShareSheet designKey={design.key} title={design.designNo} pictures={renders.length || spin.length ? [...renders, ...spin.slice(0, 1)] : sheetPics.slice(0, 1)} onClose={() => setSharing(false)} />
      )}
    </>
  );
}
