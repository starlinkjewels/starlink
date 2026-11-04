// Settings → Product pricing: everything a catalogue design's price is made of
// besides today's gold rate (Settings → Live gold & $ rates) — the metals offered
// and their loss, making charges, the diamond price grid (type × quality × size),
// setting, certificates, colours, ring sizes, extras, the margin and rounding,
// GST, and each client's own prices. The product page prices from these the
// moment they are saved; a price with any part missing shows "Price on request".
import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { Plus, Save, Tags, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { SectionTitle } from "@/components/SectionTitle";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useAuth } from "@/lib/auth";
import { useDb } from "@/hooks/useDb";
import { savePriceRules, usePriceRules } from "@/lib/productPricing";
import { saveBrand, useBrand } from "@/lib/brand";
import { HEADING_SERIFS, loadFontPreviews, TEXT_FONTS } from "@/lib/appearance";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { bandKey, METAL_LABEL, METALS, type Ccy, type Money, type PriceRules } from "@/lib/pure/pricing";

const num = (v: string) => (v === "" ? 0 : Number(v));
function MoneyInput({ value, onChange, label }: { value: Money; onChange(m: Money): void; label?: string }) {
  return (
    <div className="flex gap-1">
      <Input type="number" inputMode="decimal" min={0} step="any" aria-label={label} className="h-9 flex-1 min-w-0" value={value.amount || ""} placeholder="0" onChange={e => onChange({ ...value, amount: num(e.target.value) })} />
      <select aria-label={`${label ?? "Amount"} currency`} className="h-9 rounded-lg border border-input bg-white px-1.5 text-sm" value={value.ccy} onChange={e => onChange({ ...value, ccy: e.target.value as Ccy })}>
        <option value="INR">₹</option><option value="USD">$</option>
      </select>
    </div>
  );
}
function Block({ title, sub, info, children }: { title: string; sub?: string; info?: ReactNode; children: ReactNode }) {
  return <section className="space-y-3"><SectionTitle title={title} sub={sub} info={info} />{children}</section>;
}
const list = (s: string) => s.split(",").map(x => x.trim()).filter(Boolean);

/** The product page's fonts — kept with the brand (public), so a shared link shows them too. */
function ProductFonts() {
  const { user } = useAuth();
  const brand = useBrand();
  const [text, setText] = useState<string | null>(null);
  const [head, setHead] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { loadFontPreviews(); }, []);
  const t = text ?? brand.productFont ?? "", h = head ?? brand.productHeadingFont ?? "";
  const dirty = t !== (brand.productFont ?? "") || h !== (brand.productHeadingFont ?? "");
  const stack = (k: string) => [...TEXT_FONTS, ...HEADING_SERIFS].find(f => f.key === k)?.stack;
  const save = async () => {
    setBusy(true);
    try {
      const next = { ...brand, productFont: t || undefined, productHeadingFont: h || undefined };
      await saveBrand(JSON.parse(JSON.stringify(next)), user!.id);
      setText(null); setHead(null);
      toast.success("Product page fonts saved — the page and shared links use them now");
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <Block title="Product page font" sub="The product page and its shared links" info="Fonts for the product page alone — the rest of the app keeps its own (Settings → Appearance). 'As the app' uses those.">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="min-w-0"><Label className="text-xs">Text and prices</Label>
          <Select value={t || "_"} onValueChange={v => setText(v === "_" ? "" : v)}>
            <SelectTrigger aria-label="Product page text font" className="h-10 mt-1"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="_">As the app</SelectItem>{TEXT_FONTS.map(f => <SelectItem key={f.key} value={f.key}><span style={{ fontFamily: f.stack }}>{f.name}</span></SelectItem>)}</SelectContent>
          </Select></div>
        <div className="min-w-0"><Label className="text-xs">Design name (heading)</Label>
          <Select value={h || "_"} onValueChange={v => setHead(v === "_" ? "" : v)}>
            <SelectTrigger aria-label="Product page heading font" className="h-10 mt-1"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="_">As the app</SelectItem>{[...HEADING_SERIFS, ...TEXT_FONTS].map(f => <SelectItem key={f.key} value={f.key}><span style={{ fontFamily: f.stack }}>{f.name}</span></SelectItem>)}</SelectContent>
          </Select></div>
      </div>
      <div className="rounded-xl border border-border bg-white px-4 py-3" style={t ? { fontFamily: stack(t) } : undefined}>
        <p className="text-2xl text-brand-dark" style={h ? { fontFamily: stack(h) } : undefined}>LRS-1781</p>
        <p className="text-sm text-muted-foreground">14K gold · 3.6 g · 1.58 ct</p>
        <p className="text-2xl font-semibold tabular-nums mt-1">$2,450</p>
      </div>
      {dirty && <div className="flex gap-2"><Button size="sm" onClick={save} disabled={busy}>{busy ? "Saving…" : "Save fonts"}</Button><Button size="sm" variant="ghost" onClick={() => { setText(null); setHead(null); }}>Undo</Button></div>}
    </Block>
  );
}

export function ProductPricingSettings() {
  const { user } = useAuth();
  const db = useDb();
  const saved = usePriceRules();
  const [f, setF] = useState<PriceRules | null>(null);
  const [busy, setBusy] = useState(false);
  const [gridType, setGridType] = useState("");
  const [addClient, setAddClient] = useState("");
  const v = f ?? saved;
  if (!v) return <div className="card-luxe p-6"><p className="text-sm text-muted-foreground">Loading…</p></div>;
  const set = (p: Partial<PriceRules>) => setF({ ...v, ...p });
  const dirty = !!f && JSON.stringify(f) !== JSON.stringify(saved);
  const type = gridType || v.diamonds.types[0]?.id || "natural";
  const grid = v.diamonds.prices[type] ?? {};
  // Kept by the band's size: a band added or taken away never moves a price to another size.
  const setCell = (q: string, b: number, val: number) => {
    const row = { ...(grid[q] ?? {}) };
    if (val > 0) row[bandKey(v.diamonds.bands[b])] = val; else delete row[bandKey(v.diamonds.bands[b])];
    set({ diamonds: { ...v.diamonds, prices: { ...v.diamonds.prices, [type]: { ...grid, [q]: row } } } });
  };
  const clientName = (id: string) => { const c = db.clients.find(x => x.id === id); return c ? c.companyName || c.ownerName : "(client removed)"; };
  const bandLabel = (i: number) => `${i === 0 ? 0 : (v.diamonds.bands[i - 1] + 0.001).toFixed(3)}–${v.diamonds.bands[i] >= 99 ? "+" : v.diamonds.bands[i]} ct`;
  const save = async () => {
    setBusy(true);
    try { await savePriceRules(v, user!.id); setF(null); toast.success("Saved — product pages price from these now"); }
    catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  };

  return (
    <div className="card-luxe p-6 space-y-8">
      <SectionTitle icon={Tags} title="Product pricing" sub="What each catalogue design costs, in the options a buyer picks"
        info="A design's price = its metal (the grams on its sheet for the metal chosen, adjusted for ring size, plus loss, at today's live rate) + making + its diamonds (each row's carats at the grid's $/ct for the type, quality and stone size) + setting, certificates, colour and extras; then your margin, rounded up. Clients never see these rules — only their own price, or details only." />

      <Block title="Margin" sub="On everything, then rounded up">
        <div className="grid gap-3 sm:grid-cols-4">
          <div><Label className="text-xs">Margin %</Label><Input type="number" step="any" className="h-9 mt-1" value={v.marginPct} onChange={e => set({ marginPct: num(e.target.value) })} /></div>
          <div><Label className="text-xs">Round ₹ prices up to</Label><Input type="number" min={0} className="h-9 mt-1" value={v.roundTo.INR} onChange={e => set({ roundTo: { ...v.roundTo, INR: num(e.target.value) } })} /></div>
          <div><Label className="text-xs">Round $ prices up to</Label><Input type="number" min={0} className="h-9 mt-1" value={v.roundTo.USD} onChange={e => set({ roundTo: { ...v.roundTo, USD: num(e.target.value) } })} /></div>
          <div><Label className="text-xs">GST on ₹ prices %</Label><Input type="number" min={0} step="any" className="h-9 mt-1" value={v.gstPct} onChange={e => set({ gstPct: num(e.target.value) })} /></div>
        </div>
      </Block>

      <Block title="Metals" sub="Offered on the product page, at today's live rate" info="A metal the sheet doesn't give is worked out from one it does by the metals' weights (14K from 18K: × 13.1 ÷ 15.6), when that is on. Loss: metal lost in making, added to the weight charged.">
        <div className="flex flex-wrap gap-2">
          {METALS.map(m => (
            <label key={m} className={`h-9 px-3 rounded-full border text-sm inline-flex items-center gap-2 cursor-pointer ${v.metals.includes(m) ? "border-primary bg-primary/5" : "border-border"}`}>
              <input type="checkbox" className="accent-[hsl(var(--primary))]" checked={v.metals.includes(m)} onChange={e => set({ metals: e.target.checked ? METALS.filter(x => x === m || v.metals.includes(x)) : v.metals.filter(x => x !== m) })} />{METAL_LABEL[m]}
            </label>
          ))}
        </div>
        <label className="flex items-center justify-between gap-3 rounded-xl border border-border px-4 py-3">
          <span><span className="text-sm font-medium block">Work out a metal the sheet doesn't give</span><span className="text-xs text-muted-foreground">From the sheet's nearest metal, by weight</span></span>
          <Switch checked={v.deriveMissing} onCheckedChange={c => set({ deriveMissing: c })} />
        </label>
        <div className="grid gap-3 sm:grid-cols-3">
          {(["gold", "platinum", "silver"] as const).map(k => (
            <div key={k}><Label className="text-xs">{k === "gold" ? "Gold" : k === "platinum" ? "Platinum" : "Silver"} loss %</Label><Input type="number" min={0} step="any" className="h-9 mt-1" value={v.lossPct[k]} onChange={e => set({ lossPct: { ...v.lossPct, [k]: num(e.target.value) } })} /></div>
          ))}
        </div>
      </Block>

      <Block title="Making" sub="Per gram, never below the minimum">
        <div className="grid gap-4 sm:grid-cols-3">
          {(["gold", "platinum", "silver"] as const).map(k => (
            <div key={k} className="rounded-xl border border-border p-3 space-y-2">
              <p className="text-sm font-medium">{k === "gold" ? "Gold" : k === "platinum" ? "Platinum" : "Silver"}</p>
              <div><Label className="text-xs">Per gram</Label><MoneyInput label={`${k} making per gram`} value={v.labour[k].perGram} onChange={m => set({ labour: { ...v.labour, [k]: { ...v.labour[k], perGram: m } } })} /></div>
              <div><Label className="text-xs">Minimum per piece</Label><MoneyInput label={`${k} minimum making`} value={v.labour[k].minimum} onChange={m => set({ labour: { ...v.labour, [k]: { ...v.labour[k], minimum: m } } })} /></div>
            </div>
          ))}
        </div>
      </Block>

      <Block title="Diamond prices" sub="$ per carat — by type, quality and the size of each stone" info="A stone row is priced at the $/ct of its size band (carats per stone, as on the sheet) for the type and quality the buyer picks. An empty cell is no price: the design shows 'Price on request' until it is filled.">
        <div className="flex flex-wrap items-center gap-2">
          {v.diamonds.types.map(t => (
            <button key={t.id} type="button" onClick={() => setGridType(t.id)} className={`h-9 px-3 rounded-full border text-sm ${type === t.id ? "border-primary bg-primary text-primary-foreground" : "border-border"}`}>{t.label}</button>
          ))}
        </div>
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full text-sm min-w-[520px]">
            <thead className="bg-secondary/50 text-xs text-muted-foreground">
              <tr><th className="text-left px-3 py-2 font-medium">Size per stone</th>{v.diamonds.qualities.map(q => <th key={q.id} className="text-right px-2 py-2 font-medium">{q.label}</th>)}</tr>
            </thead>
            <tbody>
              {v.diamonds.bands.map((_, b) => (
                <tr key={b} className="border-t border-border/60">
                  <td className="px-3 py-1.5 text-xs text-muted-foreground whitespace-nowrap">{bandLabel(b)}</td>
                  {v.diamonds.qualities.map(q => (
                    <td key={q.id} className="px-1 py-1"><Input type="number" min={0} step="any" inputMode="decimal" aria-label={`${q.label} ${bandLabel(b)} $ per carat`} className="h-8 text-right" value={grid[q.id]?.[bandKey(v.diamonds.bands[b])] || ""} placeholder="—" onChange={e => setCell(q.id, b, num(e.target.value))} /></td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div><Label className="text-xs">Qualities (colour · clarity), comma between</Label>
            <Input className="h-9 mt-1" value={v.diamonds.qualities.map(q => q.label).join(", ")} onChange={e => set({ diamonds: { ...v.diamonds, qualities: list(e.target.value).map(l => ({ id: v.diamonds.qualities.find(q => q.label === l)?.id ?? l.replace(/[^A-Za-z0-9]+/g, "-"), label: l })) } })} /></div>
          <div><Label className="text-xs">Diamond types, comma between</Label>
            <Input className="h-9 mt-1" value={v.diamonds.types.map(q => q.label).join(", ")} onChange={e => set({ diamonds: { ...v.diamonds, types: list(e.target.value).map(l => ({ id: v.diamonds.types.find(q => q.label === l)?.id ?? l.toLowerCase().replace(/[^a-z0-9]+/g, "-"), label: l })) } })} /></div>
          <div><Label className="text-xs">Size bands (ct per stone, up to), comma between</Label>
            <Input className="h-9 mt-1" defaultValue={v.diamonds.bands.join(", ")} onBlur={e => { const b = list(e.target.value).map(Number).filter(x => x > 0).sort((x, y) => x - y); if (b.length) set({ diamonds: { ...v.diamonds, bands: b } }); }} /></div>
          <div><Label className="text-xs">Shapes other than round, % more (or less)</Label><Input type="number" step="any" className="h-9 mt-1" value={v.diamonds.fancyPct} onChange={e => set({ diamonds: { ...v.diamonds, fancyPct: num(e.target.value) } })} /></div>
        </div>
      </Block>

      <Block title="Centre stone sizes" sub="The buyer picks the main stone's size; it is priced from the grid above" info="A design's centre stone is its biggest stone — at most this many pieces, each at least this size (a 2.66 ct pear, a pair of 1 ct studs). Its size is a dropdown on the product page: the sizes here, and the size it is drawn in.">
        <div className="grid gap-3 sm:grid-cols-3">
          <div><Label className="text-xs">Sizes offered (ct), comma between</Label>
            <Input className="h-9 mt-1" defaultValue={v.centre.sizes.join(", ")} onBlur={e => set({ centre: { ...v.centre, sizes: [...new Set(list(e.target.value).map(Number).filter(x => x > 0 && x < 100))].sort((a, b) => a - b) } })} /></div>
          <div><Label className="text-xs">A centre stone is at least (ct each)</Label><Input type="number" min={0.01} step="any" className="h-9 mt-1" value={v.centre.minCt} onChange={e => set({ centre: { ...v.centre, minCt: num(e.target.value) } })} /></div>
          <div><Label className="text-xs">…and at most this many pieces</Label><Input type="number" min={1} max={10} className="h-9 mt-1" value={v.centre.maxPcs} onChange={e => set({ centre: { ...v.centre, maxPcs: num(e.target.value) } })} /></div>
        </div>
      </Block>

      <Block title="Stones: setting, gems, certificates">
        <div className="grid gap-3 sm:grid-cols-4">
          <div><Label className="text-xs">Setting, per stone</Label><MoneyInput label="Setting per stone" value={v.settingPerStone} onChange={m => set({ settingPerStone: m })} /></div>
          <div><Label className="text-xs">Gemstones, $ per carat</Label><Input type="number" min={0} step="any" className="h-9" value={v.gemPerCt || ""} onChange={e => set({ gemPerCt: num(e.target.value) })} /></div>
          <div><Label className="text-xs">Certificate for stones from (ct)</Label><Input type="number" min={0} step="any" className="h-9" value={v.certificate.minCt} onChange={e => set({ certificate: { ...v.certificate, minCt: num(e.target.value) } })} /></div>
          <div><Label className="text-xs">Certificate, per stone</Label><MoneyInput label="Certificate fee" value={v.certificate.fee} onChange={m => set({ certificate: { ...v.certificate, fee: m } })} /></div>
        </div>
      </Block>

      <Block title="Colours" sub="Offered for gold; a colour's own charge per piece (white: rhodium)">
        <div className="space-y-2">
          {v.colours.map((c, i) => (
            <div key={i} className="flex gap-2 items-center">
              <Input aria-label="Colour" className="h-9 w-40" value={c.label} onChange={e => set({ colours: v.colours.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)) })} />
              <div className="w-44"><MoneyInput label={`${c.label} charge`} value={c.charge ?? { amount: 0, ccy: "INR" }} onChange={m => set({ colours: v.colours.map((x, j) => (j === i ? { ...x, charge: m } : x)) })} /></div>
              <Button type="button" variant="ghost" size="icon" aria-label={`Remove ${c.label}`} onClick={() => set({ colours: v.colours.filter((_, j) => j !== i) })}><Trash2 className="h-4 w-4" /></Button>
            </div>
          ))}
          <Button type="button" variant="outline" size="sm" className="gap-1" onClick={() => set({ colours: [...v.colours, { id: `c${Date.now().toString(36)}`, label: "New colour" }] })}><Plus className="h-3.5 w-3.5" />Colour</Button>
        </div>
      </Block>

      <Block title="Ring sizes" sub="Rings and bands" info="A sheet's gold weight is for the size it is drawn in (its 'SIZE 6.75 US' or 'SIZ - 53'), else the size here; each US size up or down changes the metal by the % here.">
        <div className="grid gap-3 sm:grid-cols-3">
          <div><Label className="text-xs">Drawn in size (US), when the sheet doesn't say</Label><Input type="number" step="0.25" className="h-9 mt-1" value={v.ring.baseUs} onChange={e => set({ ring: { ...v.ring, baseUs: num(e.target.value) } })} /></div>
          <div><Label className="text-xs">Metal change per US size %</Label><Input type="number" step="any" className="h-9 mt-1" value={v.ring.pctPerSize} onChange={e => set({ ring: { ...v.ring, pctPerSize: num(e.target.value) } })} /></div>
          <div><Label className="text-xs">Sizes offered (US), comma between</Label><Input className="h-9 mt-1" defaultValue={v.ring.sizes.join(", ")} onBlur={e => { const s = list(e.target.value).map(Number).filter(x => x > 0 && x < 20).sort((a, b) => a - b); if (s.length) set({ ring: { ...v.ring, sizes: s } }); }} /></div>
        </div>
      </Block>

      <Block title="Extras" sub="Per piece: hallmarking, packing …">
        <div className="space-y-2">
          {v.extras.map((x, i) => (
            <div key={i} className="flex flex-wrap gap-2 items-center">
              <Input aria-label="Extra" className="h-9 w-44" value={x.label} onChange={e => set({ extras: v.extras.map((y, j) => (j === i ? { ...y, label: e.target.value } : y)) })} />
              <div className="w-44"><MoneyInput label={x.label} value={x.fee} onChange={m => set({ extras: v.extras.map((y, j) => (j === i ? { ...y, fee: m } : y)) })} /></div>
              <label className="text-xs inline-flex items-center gap-1.5"><input type="checkbox" checked={!!x.india} onChange={e => set({ extras: v.extras.map((y, j) => (j === i ? { ...y, india: e.target.checked } : y)) })} />₹ prices only</label>
              <Button type="button" variant="ghost" size="icon" aria-label={`Remove ${x.label}`} onClick={() => set({ extras: v.extras.filter((_, j) => j !== i) })}><Trash2 className="h-4 w-4" /></Button>
            </div>
          ))}
          <Button type="button" variant="outline" size="sm" className="gap-1" onClick={() => set({ extras: [...v.extras, { label: "Hallmarking", fee: { amount: 0, ccy: "INR" }, india: true }] })}><Plus className="h-3.5 w-3.5" />Extra</Button>
        </div>
      </Block>

      <Block title="Client prices" sub="What each client sees on a design's page" info="Price: their price in their currency, with their own margin when set. Details only: the design and its details, and 'Ask us for the price'. Clients never see costs or margins.">
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <span>Clients not listed below see</span>
          <select aria-label="Clients not listed see" className="h-9 rounded-lg border border-input bg-white px-2" value={v.clientDefault} onChange={e => set({ clientDefault: e.target.value as "price" | "details" })}>
            <option value="details">Details only</option><option value="price">Their price</option>
          </select>
        </div>
        {Object.keys(v.clients).length > 0 && (
          <div className="overflow-x-auto rounded-xl border border-border">
            <table className="w-full text-sm min-w-[520px]">
              <thead className="bg-secondary/50 text-xs text-muted-foreground"><tr><th className="text-left px-3 py-2 font-medium">Client</th><th className="text-left px-3 py-2 font-medium">Sees</th><th className="text-left px-3 py-2 font-medium">Margin %</th><th className="text-left px-3 py-2 font-medium">Currency</th><th /></tr></thead>
              <tbody>
                {Object.entries(v.clients).map(([id, c]) => (
                  <tr key={id} className="border-t border-border/60">
                    <td className="px-3 py-1.5">{clientName(id)}</td>
                    <td className="px-2 py-1"><select aria-label="Sees" className="h-8 rounded-lg border border-input bg-white px-2" value={c.see} onChange={e => set({ clients: { ...v.clients, [id]: { ...c, see: e.target.value as "price" | "details" } } })}><option value="price">Their price</option><option value="details">Details only</option></select></td>
                    <td className="px-2 py-1"><Input type="number" step="any" className="h-8 w-24" placeholder={String(v.marginPct)} value={c.marginPct ?? ""} onChange={e => set({ clients: { ...v.clients, [id]: { ...c, marginPct: e.target.value === "" ? undefined : num(e.target.value) } } })} /></td>
                    <td className="px-2 py-1"><select aria-label="Currency" className="h-8 rounded-lg border border-input bg-white px-2" value={c.ccy ?? "USD"} onChange={e => set({ clients: { ...v.clients, [id]: { ...c, ccy: e.target.value as Ccy } } })}><option value="USD">$</option><option value="INR">₹</option></select></td>
                    <td className="px-2 py-1 text-right"><Button type="button" variant="ghost" size="icon" aria-label={`Remove ${clientName(id)}`} onClick={() => { const n = { ...v.clients }; delete n[id]; set({ clients: n }); }}><Trash2 className="h-4 w-4" /></Button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="flex gap-2">
          <select aria-label="Add a client" className="h-9 flex-1 min-w-0 rounded-lg border border-input bg-white px-2 text-sm" value={addClient} onChange={e => setAddClient(e.target.value)}>
            <option value="">Add a client…</option>
            {db.clients.filter(c => c.status === "active" && !v.clients[c.id]).map(c => ({ id: c.id, n: c.companyName || c.ownerName })).sort((a, b) => a.n.localeCompare(b.n)).map(c => <option key={c.id} value={c.id}>{c.n}</option>)}
          </select>
          <Button type="button" variant="outline" disabled={!addClient} onClick={() => { set({ clients: { ...v.clients, [addClient]: { see: "price" } } }); setAddClient(""); }}>Add</Button>
        </div>
      </Block>

      <Block title="Kind of piece by design letters" sub="For designs whose folders don't say (Ring, Bracelet …)" info="A design in a folder named Ring, Bands, Bracelet, Earring, Pendant, Necklace … is that kind of piece by itself; for the rest, its letters here (SRG → Ring). Rings and bands get ring sizes.">
        <Input className="h-9" placeholder="SRG=Ring, SBD=Band, SBR=Bracelet" defaultValue={Object.entries(v.categoryByPrefix).map(([k, c]) => `${k}=${c}`).join(", ")}
          onBlur={e => set({ categoryByPrefix: Object.fromEntries(list(e.target.value).map(x => x.split("=").map(y => y.trim())).filter(([k, c]) => k && c).map(([k, c]) => [k.toUpperCase(), c])) })} />
      </Block>

      <ProductFonts />

      <p className="text-xs text-muted-foreground">Gold, platinum and silver are priced at today's rates — <Link to="/settings?tab=liverates" className="text-primary underline">Live gold & $ rates</Link>.</p>

      {dirty && (
        <div className="sticky bottom-3 z-10 flex justify-end gap-2 rounded-xl border border-border bg-white/95 backdrop-blur px-4 py-3 shadow-lg">
          <Button variant="ghost" onClick={() => setF(null)} disabled={busy}>Undo</Button>
          <Button onClick={save} disabled={busy} className="gap-1.5"><Save className="h-4 w-4" />{busy ? "Saving…" : "Save"}</Button>
        </div>
      )}
    </div>
  );
}
