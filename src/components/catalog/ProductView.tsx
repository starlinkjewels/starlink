// A design's product page as people see it — in the app (pages/ProductPage.tsx)
// and on a shared link (components/catalog/DesignShareView.tsx): its pictures
// (with its 360° turn and videos), the options as dropdowns (metal, colour, ring
// size with a size chart, diamond type, quality), the price for those options and
// the details (the metal's weight for the options chosen, the stones) — one total
// price for the selection, never how it is made up. On a phone: a shorter
// picture, the dropdowns two by two, and the price kept in view at the bottom.
import { useRef, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, Gem, Loader2, Ruler, RotateCw } from "lucide-react";
import { ActionSheet } from "@/components/ActionSheet";
import { WebVideo } from "@/components/ProductVideo";
import { SpecsView } from "@/components/catalog/DesignDetails";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { money } from "@/lib/productPricing";
import type { ItemSpecs } from "@/lib/catalogSpecs";
import { METAL_LABEL, ringChart, type Ccy, type Choice, type MetalKey } from "@/lib/pure/pricing";

export interface Pic { id: string; url: string; thumb?: string; name: string }
export interface ProductOptions {
  metals: MetalKey[];
  colours: { id: string; label: string }[];
  /** Empty: not a ring. */
  ringSizes: number[];
  types: { id: string; label: string }[];
  qualities: { id: string; label: string }[];
  hasStones: boolean;
}
export interface ProductPrice {
  amount: number | null;
  ccy: Ccy;
  busy?: boolean;
  /** "Price for Acme Ltd" */
  label?: string;
  /** Under the price: when it was worked out. */
  note?: ReactNode;
  /** No price shown, by choice: what to say instead ("Ask us for the price"). */
  ask?: string;
}

/** Drag (or swipe) across to turn the piece: one frame per few pixels. */
function SpinViewer({ frames, className }: { frames: Pic[]; className: string }) {
  const [i, setI] = useState(0);
  const start = useRef<{ x: number; i: number } | null>(null);
  const step = Math.max(4, Math.round(360 / Math.max(1, frames.length)));
  return (
    <div className={`relative rounded-2xl border border-border/60 bg-white overflow-hidden select-none touch-none cursor-grab active:cursor-grabbing ${className}`}
      onPointerDown={e => { start.current = { x: e.clientX, i }; (e.target as HTMLElement).setPointerCapture?.(e.pointerId); }}
      onPointerMove={e => { if (!start.current) return; const d = Math.round((e.clientX - start.current.x) / step); setI(((start.current.i - d) % frames.length + frames.length) % frames.length); }}
      onPointerUp={() => { start.current = null; }} onPointerCancel={() => { start.current = null; }}>
      {frames.map((f, k) => <img key={f.id} src={f.thumb || f.url} alt="" draggable={false} className={`absolute inset-0 w-full h-full object-contain ${k === i ? "" : "invisible"}`} />)}
      <span className="absolute bottom-2 left-2 inline-flex items-center gap-1 rounded-full bg-black/55 text-white text-[11px] px-2 py-0.5"><RotateCw className="h-3 w-3" />Drag to turn</span>
    </div>
  );
}

/** One option as a dropdown: label above, the choice in a full-width box. */
function Pick({ label, value, options, onPick, wide, right }: { label: string; value: string; options: { value: string; label: string }[]; onPick(v: string): void; wide?: boolean; right?: ReactNode }) {
  return (
    <div className={`min-w-0 ${wide ? "col-span-2" : ""}`}>
      <div className="flex items-center justify-between gap-2 mb-1"><span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">{label}</span>{right}</div>
      <Select value={value} onValueChange={onPick}>
        <SelectTrigger aria-label={label} className="h-11 rounded-xl bg-white"><SelectValue /></SelectTrigger>
        <SelectContent>{options.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
      </Select>
    </div>
  );
}

export function ProductView(p: {
  title: string;
  subtitle?: string;
  back?: { label: string; to: string };
  headerActions?: ReactNode;
  pictures: Pic[];
  spin: Pic[];
  videos: Pic[];
  ready: boolean;
  notReady?: ReactNode;
  options: ProductOptions;
  pick: Choice | null;
  onPick(c: Partial<Choice>): void;
  sheetUs?: number;
  /** Staff: currency, price as a client. */
  extraControls?: ReactNode;
  price: ProductPrice;
  /** Staff: how the price is made up, what is missing. */
  priceExtra?: ReactNode;
  grams?: number;
  gramsNote?: string;
  specs?: Pick<ItemSpecs, "stones" | "stoneTotals" | "dimsMm" | "ringSize" | "metal"> | null;
  /** The phone's price bar sits above the app's tab bar (in the app), or at the very bottom (a shared link). */
  aboveTabBar?: boolean;
}) {
  const [shown, setShown] = useState<string | undefined>(undefined);
  const [chart, setChart] = useState(false);
  const main = shown === "spin" ? undefined : p.pictures.find(x => x.id === shown) ?? p.pictures[0];
  const { options: o, pick } = p;
  const ring = o.ringSizes.length > 0;
  const showColour = o.colours.length > 0 && pick && pick.metal !== "PLT" && pick.metal !== "SILVER";
  const pr = p.price;
  const priceLine = pr.amount != null ? money(pr.amount, pr.ccy) : pr.ask ? null : pr.busy ? "…" : "Price on request";

  return (
    <div className="space-y-4 pb-24 lg:pb-0">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          {p.back && <Link to={p.back.to} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-1"><ArrowLeft className="h-4 w-4" />{p.back.label}</Link>}
          <h1 className="font-display text-2xl md:text-3xl text-brand-dark truncate">{p.title}</h1>
          {p.subtitle && <p className="text-sm text-muted-foreground">{p.subtitle}</p>}
        </div>
        {p.headerActions && <div className="shrink-0 flex items-center gap-2 pt-1">{p.headerActions}</div>}
      </div>

      <div className="grid gap-5 lg:gap-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] items-start">
        {/* Pictures */}
        <section className="space-y-2.5 lg:sticky lg:top-20 min-w-0">
          {shown === "spin" && p.spin.length ? <SpinViewer frames={p.spin} className="aspect-[4/3] lg:aspect-square" /> : main ? (
            <a href={main.url} target="_blank" rel="noopener noreferrer" className="block rounded-2xl border border-border/60 bg-white overflow-hidden aspect-[4/3] lg:aspect-square" title="Open full size">
              <img src={main.url} alt={p.title} className="w-full h-full object-contain" />
            </a>
          ) : <div className="rounded-2xl border border-border/60 bg-secondary/30 aspect-[4/3] lg:aspect-square grid place-items-center text-sm text-muted-foreground">No picture yet</div>}
          {(p.pictures.length + (p.spin.length ? 1 : 0)) > 1 && (
            <div className="flex gap-2 overflow-x-auto pb-1">
              {p.spin.length > 0 && (
                <button type="button" onClick={() => setShown("spin")} aria-pressed={shown === "spin"} className={`shrink-0 h-14 w-14 lg:h-16 lg:w-16 rounded-xl border-2 overflow-hidden relative ${shown === "spin" ? "border-primary" : "border-border/60"}`}>
                  <img src={p.spin[0].thumb || p.spin[0].url} alt="360° view" className="w-full h-full object-cover" />
                  <span className="absolute inset-0 grid place-items-center bg-black/30 text-white text-[11px] font-semibold">360°</span>
                </button>
              )}
              {p.pictures.map(x => (
                <button key={x.id} type="button" onClick={() => setShown(x.id)} aria-pressed={main?.id === x.id && shown !== "spin"} className={`shrink-0 h-14 w-14 lg:h-16 lg:w-16 rounded-xl border-2 overflow-hidden ${main?.id === x.id && shown !== "spin" ? "border-primary" : "border-border/60"}`}>
                  <img src={x.thumb || x.url} alt={x.name} className="w-full h-full object-cover" />
                </button>
              ))}
            </div>
          )}
          {p.videos.map(v => <WebVideo key={v.id} src={v.url} controls muted playsInline preload="metadata" className="w-full rounded-2xl border border-border/60" />)}
        </section>

        {/* Options, price, details */}
        <section className="space-y-4 min-w-0">
          {!p.ready ? <div className="card-luxe p-5 text-sm text-muted-foreground">{p.notReady}</div> : (
            <>
              <div className="card-luxe p-4 sm:p-5">
                <div className="grid grid-cols-2 gap-3">
                  {o.metals.length > 0 && pick && <Pick label="Metal" value={pick.metal} options={o.metals.map(m => ({ value: m, label: METAL_LABEL[m] }))} onPick={v => p.onPick({ metal: v as MetalKey })} wide={!showColour} />}
                  {showColour && <Pick label="Colour" value={pick!.colour ?? o.colours[0].id} options={o.colours.map(c => ({ value: c.id, label: c.label }))} onPick={v => p.onPick({ colour: v })} />}
                  {ring && pick && (
                    <Pick label="Ring size" wide value={String(pick.ringUs ?? o.ringSizes[0])}
                      options={o.ringSizes.map(s => { const r = ringChart(s); return { value: String(s), label: `US ${s} · UK ${r.uk} · EU ${r.eu}${p.sheetUs === s ? " · as drawn" : ""}` }; })}
                      onPick={v => p.onPick({ ringUs: Number(v) })}
                      right={<button type="button" onClick={() => setChart(true)} className="text-xs text-primary inline-flex items-center gap-1"><Ruler className="h-3.5 w-3.5" />Size chart</button>} />
                  )}
                  {o.hasStones && o.types.length > 0 && pick && <Pick label="Diamonds" value={pick.diamondType} options={o.types.map(t => ({ value: t.id, label: t.label }))} onPick={v => p.onPick({ diamondType: v })} />}
                  {o.hasStones && o.qualities.length > 0 && pick && <Pick label="Quality" value={pick.quality} options={o.qualities.map(q => ({ value: q.id, label: q.label }))} onPick={v => p.onPick({ quality: v })} />}
                </div>
                {p.extraControls && <div className="mt-3 pt-3 border-t border-border/60">{p.extraControls}</div>}
              </div>

              {/* The price — a card on a laptop; on a phone, also the bar at the bottom. */}
              <div className="card-luxe p-4 sm:p-5 space-y-3">
                {pr.ask && pr.amount == null ? <p className="text-sm">{pr.ask}</p> : (
                  <div>
                    <p className="text-xs text-muted-foreground">{pr.label ?? "Price"}</p>
                    <p className="text-3xl font-semibold tabular-nums flex items-center gap-2">{priceLine}{pr.busy && pr.amount != null && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}</p>
                    {pr.amount != null && pr.note && <p className="text-[11px] text-muted-foreground mt-1">{pr.note}</p>}
                  </div>
                )}
                {p.priceExtra}
              </div>

              {p.specs && (
                <div className="card-luxe p-4 sm:p-5 space-y-3">
                  <p className="text-sm font-semibold flex items-center gap-1.5"><Gem className="h-4 w-4 text-primary" />Details</p>
                  {pick && (p.grams ?? 0) > 0 && (
                    <p className="text-sm">{METAL_LABEL[pick.metal]}: <b className="tabular-nums">{p.grams} g</b>
                      {p.gramsNote && <span className="text-xs text-muted-foreground"> {p.gramsNote}</span>}
                      {pick.ringUs ? <span className="text-xs text-muted-foreground"> · for size {pick.ringUs}{p.sheetUs && pick.ringUs !== p.sheetUs ? ` (drawn in ${p.sheetUs})` : ""}</span> : null}</p>
                  )}
                  <SpecsView specs={{ v: 0, status: "ok", at: "", stones: p.specs.stones ?? [], stoneTotals: p.specs.stoneTotals, dimsMm: p.specs.dimsMm ?? [], ringSize: p.specs.ringSize, metal: p.specs.metal ?? {} }} />
                </div>
              )}
            </>
          )}
        </section>
      </div>

      {/* Phone: the price in view while choosing. */}
      {p.ready && (
        <div className={`lg:hidden fixed inset-x-0 z-30 px-3 ${p.aboveTabBar ? "bottom-[calc(env(safe-area-inset-bottom)+4.4rem)] md:bottom-3" : "bottom-[calc(env(safe-area-inset-bottom)+0.75rem)]"}`}>
          <div className="mx-auto max-w-xl rounded-2xl border border-border bg-white/95 backdrop-blur shadow-lg px-4 py-2.5 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[11px] text-muted-foreground truncate">{pick ? [METAL_LABEL[pick.metal], ring && pick.ringUs ? `size ${pick.ringUs}` : null, o.hasStones ? o.qualities.find(q => q.id === pick.quality)?.label : null].filter(Boolean).join(" · ") : p.title}</p>
              <p className="text-lg font-semibold tabular-nums leading-tight flex items-center gap-1.5">{pr.ask && pr.amount == null ? <span className="text-sm font-medium">{pr.ask}</span> : priceLine}{pr.busy && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}</p>
            </div>
          </div>
        </div>
      )}

      <ActionSheet open={chart} onOpenChange={setChart} icon={Ruler} title="Ring size chart" description="Measure the inside of a ring that fits, or the finger.">
        <table className="w-full text-sm">
          <thead className="text-xs text-muted-foreground"><tr><th className="text-left py-1.5">US</th><th className="text-left py-1.5">UK</th><th className="text-right py-1.5">EU · around (mm)</th><th className="text-right py-1.5">Across (mm)</th></tr></thead>
          <tbody>{o.ringSizes.map(s => { const r = ringChart(s); return (
            <tr key={s} className={`border-t border-border/50 ${pick?.ringUs === s ? "bg-primary/5 font-medium" : ""}`}><td className="py-1.5">{s}</td><td className="py-1.5">{r.uk}</td><td className="py-1.5 text-right tabular-nums">{r.eu}</td><td className="py-1.5 text-right tabular-nums">{r.diameterMm}</td></tr>
          ); })}</tbody>
        </table>
      </ActionSheet>
    </div>
  );
}
