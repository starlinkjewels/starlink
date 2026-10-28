import { useDb } from "@/hooks/useDb";
import { choicesOf, listOf, type ListKey } from "@/lib/optionLists";
import { knowStoneTypes, lotBalances, lotKey, lotLabel, mmChoices, normalizeMm, sieveChoices, sizeOrder, type LotBalance, type LotSpec } from "@/lib/diamondLots";
import { ListCombo } from "@/components/ListCombo";
import { bagNoOf } from "@/lib/diamondBags";
import { stockAverageRate } from "@/lib/orderCost";
import { fmtMoneyInr } from "@/lib/manufacturing";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Package } from "lucide-react";

const NONE = "__none";


/**
 * A dropdown fed by one of the business's lists (Settings → Dropdown lists) —
 * the diamond shapes, sizes, colours and clarities on every stock form. A
 * value a record already has stays offered. `optional` adds "—" (not recorded).
 */
export function ListSelect({ list, value, onChange, id, optional = true, placeholder = "—", className = "h-10 rounded-xl", choices, normalize, disabled }: {
  list: ListKey; value: string; onChange: (v: string) => void; id?: string;
  optional?: boolean; placeholder?: string; className?: string;
  /** The options, when they are not the list as it stands (the mm and sieve sizes). */
  choices?: string[];
  /** Tidies a typed word before it is used and remembered. */
  normalize?: (typed: string) => string;
  disabled?: boolean;
}) {
  // Pick, or type something new — it is used and remembered in the list (ListCombo).
  return <ListCombo list={list} value={value} onChange={onChange} id={id} optional={optional} placeholder={placeholder}
    className={className} choices={choices} normalize={normalize} disabled={disabled} />;
}

/** "2.35 ct · 120 pcs · ₹3,200/ct" — what a lot holds and what it cost. */
export function lotStockText(l: LotBalance, avg: number | null): string {
  return [`${l.ct} ct`, l.pcs != null ? `${l.pcs} pcs` : "", avg ? `${fmtMoneyInr(avg)}/ct` : ""].filter(Boolean).join(" · ");
}

/**
 * Pick a loose-diamond lot that is in stock — "Round · +6.5-7 · G-H · VS —
 * 2.35 ct · 120 pcs · ₹3,200/ct". Used wherever loose stones leave stock (an
 * order's Diamond from stock, Sell diamond), so they always come out of a lot
 * that holds them. Older stock with only a shape reads "size not recorded".
 */
export function LotPicker({ value, onChange, companyId, id, className = "h-10 rounded-xl", others, fromCompany }: {
  value: string; onChange: (key: string, lot?: LotBalance, fromCompany?: string) => void; companyId: string; id?: string; className?: string;
  /** Our other companies — their lots are offered too, and are moved across when used. */
  others?: { id: string; name: string }[];
  /** The company the chosen lot is in, when it is one of `others`. */
  fromCompany?: string;
}) {
  const db = useDb();
  // In the order a diamond office keeps them: shape, then size, then grade.
  const lotsOf = (co: string) => lotBalances(db.stockMovements ?? [], co).filter(l => l.ct > 0)
    .sort((a, b) => a.spec.shape.localeCompare(b.spec.shape) || sizeOrder(a.spec.mm, b.spec.mm) || sizeOrder(a.spec.size, b.spec.size) || a.key.localeCompare(b.key));
  const lots = lotsOf(companyId);
  const elsewhere = (others ?? []).map(o => ({ ...o, lots: lotsOf(o.id) })).filter(o => o.lots.length > 0);
  const now = new Date().toISOString();
  const avgOf = (k: string, co: string) => stockAverageRate(db, "diamond", k, now, co === "all" ? undefined : co);
  const SEP = "::";
  const cur = fromCompany && fromCompany !== companyId ? `${fromCompany}${SEP}${value}` : value;
  const row = (l: LotBalance, co: string) => (
    <>
      {bagNoOf(db, l.key) && <span className="font-semibold text-primary">{bagNoOf(db, l.key)} · </span>}
      <span className="font-medium">{lotLabel(l.key)}</span>
      <span className="text-muted-foreground"> — {lotStockText(l, avgOf(l.key, co))}</span>
    </>
  );
  return (
    <Select value={cur || ""} onValueChange={v => {
      const i = v.indexOf(SEP);
      if (i > 0 && elsewhere.some(o => o.id === v.slice(0, i))) {
        const co = v.slice(0, i), k = v.slice(i + SEP.length);
        onChange(k, elsewhere.find(o => o.id === co)!.lots.find(l => l.key === k), co);
      } else onChange(v, lots.find(l => l.key === v));
    }}>
      <SelectTrigger id={id} className={className}><SelectValue placeholder={lots.length || elsewhere.length ? "Choose a lot in stock" : "No loose diamonds in stock"} /></SelectTrigger>
      <SelectContent className="max-h-80">
        {/* A heading only inside its group — the list refuses one on its own (and the page went down). */}
        {elsewhere.length > 0 && lots.length > 0 ? (
          <SelectGroup>
            <SelectLabel className="text-[11px] uppercase tracking-wider text-muted-foreground">This company</SelectLabel>
            {lots.map(l => <SelectItem key={l.key} value={l.key}>{row(l, companyId)}</SelectItem>)}
          </SelectGroup>
        ) : lots.map(l => <SelectItem key={l.key} value={l.key}>{row(l, companyId)}</SelectItem>)}
        {elsewhere.map(o => (
          <SelectGroup key={o.id}>
            <SelectLabel className="text-[11px] uppercase tracking-wider text-muted-foreground pt-2">From {o.name} — moved across when saved</SelectLabel>
            {o.lots.map(l => <SelectItem key={o.id + l.key} value={`${o.id}${SEP}${l.key}`}>{row(l, o.id)}</SelectItem>)}
          </SelectGroup>
        ))}
        {value && !fromCompany && !lots.some(l => l.key === value) && <SelectItem value={value}>{lotLabel(value)} — none in stock</SelectItem>}
      </SelectContent>
    </Select>
  );
}

/* ── The same diamond fields on every form ───────────────────────────────── */

/** A loose lot's parts as a form holds them (every one a string, "" = not recorded). */
export interface LooseLotDraft { shape: string; mm: string; size: string; color: string; clarity: string;
  /** Natural, CVD, HPHT… (gems: natural, lab-created, treated…). "" = not recorded. */
  type?: string;
  /** Gems: which stone — Tanzanite, Garnet… "" = not recorded. */
  variety?: string }

/** The stone types a lot can be — the business's diamond types (or gem types), without "Mount Only" and the like. */
export function stoneTypeChoices(settings: Parameters<typeof listOf>[1], gem = false): string[] {
  const list = listOf(gem ? "gemTypes" : "diamondTypes", settings).filter(t => !/mount|none|only/i.test(t));
  knowStoneTypes(list);
  return list;
}

/**
 * Shape · Type · MM · Sieve · Colour · Clarity — what a loose lot is, asked the
 * same way on every form that brings stones into stock or takes them out (a
 * purchase, opening stock, a supplier's bill, an order's purchase, a client's
 * stones). Gems are asked the same, with their own colours and a grade in place
 * of clarity. Under it: the bag the stones go into, and what that bag holds now.
 */
export function LooseLotFields({ value, onChange, idPrefix, companyId = "all", showBag = true, compact = false, gem = false, showType = true, showStone = false }: {
  value: LooseLotDraft; onChange: (patch: Partial<LooseLotDraft>) => void; idPrefix: string;
  companyId?: string; showBag?: boolean; compact?: boolean;
  /** Gems (emerald, ruby…), not diamonds: colour, type and grade in the gem trade's words. */
  gem?: boolean;
  /** Off where the form asks the type itself (a new order's Diamond Type). */
  showType?: boolean;
  /** Gems going into stock: which stone (Tanzanite, Garnet…) — first, as the trade names a gem. */
  showStone?: boolean;
}) {
  const db = useDb();
  const sizes = listOf("diamondSizes", db.settings);
  const mm = mmChoices(listOf("diamondMm", db.settings), sizes);
  const sieve = sieveChoices(sizes);
  const key = lotKey(lotFromDraft(value));
  const bag = gem ? undefined : bagNoOf(db, key);
  const lot = showBag && !gem ? lotBalances(db.stockMovements ?? [], companyId).find(l => l.key === key && l.ct > 0) : undefined;
  const lbl = compact ? "text-[11px]" : "text-xs";
  const box = compact ? "h-9 rounded-lg mt-1" : "h-10 rounded-xl mt-1";
  // Every shape takes a sieve size as well as its mm — fancy shapes and gems are sieved too.
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        {gem && showStone && (
          <div>
            <Label htmlFor={`${idPrefix}-stone`} className={lbl}>Stone</Label>
            <ListSelect id={`${idPrefix}-stone`} list="gemStones" value={value.variety ?? ""} onChange={v => onChange({ variety: v })} className={box} placeholder="e.g. Tanzanite" />
          </div>
        )}
        <div>
          <Label htmlFor={`${idPrefix}-shape`} className={lbl}>Shape</Label>
          <ListSelect id={`${idPrefix}-shape`} list="diamondShapes" value={value.shape} onChange={v => onChange({ shape: v || "Round" })} optional={false} className={box} />
        </div>
        {showType && (
          <div>
            <Label htmlFor={`${idPrefix}-type`} className={lbl}>Type</Label>
            <ListSelect id={`${idPrefix}-type`} list={gem ? "gemTypes" : "diamondTypes"} choices={stoneTypeChoices(db.settings, gem)}
              value={value.type ?? ""} onChange={v => onChange({ type: v })} className={box} />
          </div>
        )}
        <div>
          <Label htmlFor={`${idPrefix}-mm`} className={lbl}>MM</Label>
          <ListSelect id={`${idPrefix}-mm`} list="diamondMm" choices={mm} value={value.mm} onChange={v => onChange({ mm: v })} className={box} normalize={t => normalizeMm(t) ?? t} />
        </div>
        <div>
          <Label htmlFor={`${idPrefix}-sieve`} className={lbl}>Sieve</Label>
          <ListSelect id={`${idPrefix}-sieve`} list="diamondSizes" choices={sieve} value={value.size} onChange={v => onChange({ size: v })} className={box} placeholder="—" />
        </div>
        <div>
          <Label htmlFor={`${idPrefix}-color`} className={lbl}>Colour</Label>
          <ListSelect id={`${idPrefix}-color`} list={gem ? "gemColors" : "diamondColors"} value={value.color} onChange={v => onChange({ color: v })} className={box} />
        </div>
        <div>
          <Label htmlFor={`${idPrefix}-clarity`} className={lbl}>{gem ? "Grade" : "Clarity"}</Label>
          <ListSelect id={`${idPrefix}-clarity`} list={gem ? "gemQualities" : "diamondClarities"} value={value.clarity} onChange={v => onChange({ clarity: v })} className={box} />
        </div>
      </div>
      {showBag && !gem && (
        <p className="text-[11px] text-muted-foreground flex items-center gap-1.5 flex-wrap">
          <Package className="h-3.5 w-3.5 text-primary shrink-0" />
          {bag ? <span className="font-semibold text-primary">{bag}</span> : <span className="font-semibold text-foreground">New bag</span>}
          <span>· {lotLabel(key)}</span>
          {lot && <span>· now {lot.ct} ct{lot.pcs != null ? ` · ${lot.pcs} pcs` : ""}</span>}
        </p>
      )}
    </div>
  );
}

/** A loose lot from a form's strings. */
export function lotFromDraft(d: Partial<LooseLotDraft>): LotSpec {
  return { shape: d.shape?.trim() || "Round", variety: d.variety?.trim() || undefined, type: d.type?.trim() || undefined, size: d.size?.trim() || undefined, mm: d.mm?.trim() || undefined,
    color: d.color?.trim() || undefined, clarity: d.clarity?.trim() || undefined };
}

/** A certified stone's grading as a form holds it. */
export interface CertGradeDraft {
  /** Natural, CVD, HPHT… */
  type?: string;
  color: string; clarity: string; cut: string; polish: string; symmetry: string; fluorescence: string;
  measurement: string; lab: string; certNo: string;
}

/**
 * A certified stone's report, asked the same way everywhere: report no. and
 * lab, colour, clarity, cut, polish, symmetry, fluorescence and measurement —
 * each from the business's lists (Settings → Dropdown lists), measurement as
 * written on the report.
 */
export function CertGradeFields({ value, onChange, idPrefix, compact = false, requireReport = true }: {
  value: CertGradeDraft; onChange: (patch: Partial<CertGradeDraft>) => void; idPrefix: string; compact?: boolean; requireReport?: boolean;
}) {
  const db = useDb();
  const lbl = compact ? "text-[11px]" : "text-xs";
  const box = compact ? "h-9 rounded-lg mt-1" : "h-10 rounded-xl mt-1";
  const sel = (k: keyof CertGradeDraft, label: string, list: ListKey) => (
    <div>
      <Label htmlFor={`${idPrefix}-${k}`} className={lbl}>{label}</Label>
      <ListSelect id={`${idPrefix}-${k}`} list={list} value={value[k] ?? ""} onChange={v => onChange({ [k]: v } as Partial<CertGradeDraft>)} className={box} />
    </div>
  );
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
      <div>
        <Label htmlFor={`${idPrefix}-certNo`} className={lbl}>Report no.{requireReport ? " *" : ""}</Label>
        <Input id={`${idPrefix}-certNo`} value={value.certNo} onChange={e => onChange({ certNo: e.target.value })} className={box} placeholder="e.g. 2141438171" />
      </div>
      {sel("lab", "Lab", "diamondLabs")}
      <div>
        <Label htmlFor={`${idPrefix}-type`} className={lbl}>Type</Label>
        <ListSelect id={`${idPrefix}-type`} list="diamondTypes" choices={stoneTypeChoices(db.settings)} value={value.type ?? ""} onChange={v => onChange({ type: v })} className={box} />
      </div>
      {sel("color", "Colour", "diamondColors")}
      {sel("clarity", "Clarity", "diamondClarities")}
      {sel("cut", "Cut", "diamondFinish")}
      {sel("polish", "Polish", "diamondFinish")}
      {sel("symmetry", "Symmetry", "diamondFinish")}
      {sel("fluorescence", "Fluorescence", "diamondFluorescence")}
      <div className="col-span-2 sm:col-span-3">
        <Label htmlFor={`${idPrefix}-measurement`} className={lbl}>Measurement (mm)</Label>
        <Input id={`${idPrefix}-measurement`} value={value.measurement} onChange={e => onChange({ measurement: e.target.value })} className={box} placeholder="e.g. 6.50 x 6.48 x 4.01" />
      </div>
    </div>
  );
}

export const EMPTY_LOOSE: LooseLotDraft = { shape: "Round", type: "", mm: "", size: "", color: "", clarity: "" };
export const EMPTY_CERT: CertGradeDraft = { type: "", color: "", clarity: "", cut: "", polish: "", symmetry: "", fluorescence: "", measurement: "", lab: "", certNo: "" };

/**
 * Which bag stones go back into — a return from a factory or a piece. Offers the
 * bags this job's stones came from first (`prefer`), then every other bag the
 * business has kept, each with its number and what it holds now.
 */
export function BagSelect({ value, onChange, prefer = [], companyId = "all", id, className = "h-10 rounded-xl" }: {
  value: string; onChange: (key: string) => void; prefer?: string[]; companyId?: string; id?: string; className?: string;
}) {
  const db = useDb();
  const now = lotBalances(db.stockMovements ?? [], companyId);
  const known = new Set<string>();
  for (const m of db.stockMovements ?? []) if (m.material === "diamond" && m.purityOrQuality !== "Certified") known.add(m.purityOrQuality);
  const first = [...new Set(prefer.filter(Boolean))];
  const rest = [...known].filter(k => !first.includes(k)).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const label = (k: string) => {
    const bag = bagNoOf(db, k);
    const l = now.find(x => x.key === k);
    return <><span className="font-semibold text-primary">{bag ? `${bag} · ` : ""}</span>{lotLabel(k)}<span className="text-muted-foreground">{l ? ` — ${l.ct} ct${l.pcs != null ? ` · ${l.pcs} pcs` : ""}` : " — empty"}</span></>;
  };
  return (
    <Select value={value || ""} onValueChange={onChange}>
      <SelectTrigger id={id} className={className}><SelectValue placeholder="Choose the bag" /></SelectTrigger>
      <SelectContent className="max-h-80">
        {first.length > 0 && <div className="px-2 pt-1.5 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">This job's bags</div>}
        {first.map(k => <SelectItem key={`p-${k}`} value={k}>{label(k)}</SelectItem>)}
        {rest.length > 0 && <div className="px-2 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Other bags</div>}
        {rest.map(k => <SelectItem key={k} value={k}>{label(k)}</SelectItem>)}
        {value && !first.includes(value) && !known.has(value) && <SelectItem value={value}>{lotLabel(value)}</SelectItem>}
      </SelectContent>
    </Select>
  );
}
