import { useState } from "react";
import { Copy, Plus, X } from "lucide-react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { useDb } from "@/hooks/useDb";
import { choicesOf, listOf, noKaratMetals } from "@/lib/optionLists";
import { isNonGoldMetal, metalHasKarats } from "@/lib/metals";
import { GOLD_CARD, rateCardOf, rateIn, sameName, type RateFrom } from "@/lib/factoryRates";
import type { DB, FactoryLabour, LabourRate } from "@/lib/db";
import { cn } from "@/lib/utils";

/** One line of the rate card as the form holds it: every number still as typed. */
export interface RateCell { metal: string; item: string; perGram: string; minimum: string; minimumUnder: string }
/** A factory's rate card as a form holds it — and items and metals added here, put in the
 *  jewellery types and the metals when it is saved. */
export interface LabourDraft { cells: Record<string, RateCell>; newItems: string[]; newMetals: string[] }

const cellKey = (metal: string, item: string) => `${metal.trim().toLowerCase()}|${item.trim().toLowerCase()}`;
const str = (n?: number) => (n != null && n > 0 ? String(n) : "");
const tidy = (s: string) => s.trim().replace(/\s+/g, " ");

export const labourDraftOf = (l?: FactoryLabour): LabourDraft => ({
  cells: Object.fromEntries(rateCardOf(l).map(r => [cellKey(r.metal, r.item ?? ""),
    { metal: r.metal, item: r.item ?? "", perGram: str(r.perGram), minimum: str(r.minimum), minimumUnder: str(r.minimum ? r.minimumUnder : undefined) }])),
  newItems: [],
  newMetals: [],
});

/** The card's lines: only the ones with a figure; the under-weight only with its minimum. */
function cardOf(d: LabourDraft): LabourRate[] {
  const out: LabourRate[] = [];
  for (const c of Object.values(d.cells)) {
    const perGram = Math.round((Number(c.perGram) || 0) * 100) / 100;
    const minimum = Math.round((Number(c.minimum) || 0) * 100) / 100;
    const minimumUnder = Math.round((Number(c.minimumUnder) || 0) * 1000) / 1000;
    if (!(perGram > 0) && !(minimum > 0)) continue;
    out.push({ metal: c.metal, ...(c.item.trim() ? { item: c.item.trim() } : {}), ...(perGram > 0 ? { perGram } : {}),
      ...(minimum > 0 ? { minimum } : {}), ...(minimum > 0 && minimumUnder > 0 ? { minimumUnder } : {}) });
  }
  return out;
}

/** What is saved: the rate card alone (the old fields go — the card holds them); nothing when no rate is given. */
export function labourOf(d: LabourDraft): FactoryLabour | undefined {
  const rates = cardOf(d);
  return rates.length ? { rates } : undefined;
}

/**
 * Items and metals added on the form with a rate go into Settings → Dropdown lists — Jewellery
 * types, and Metals (a metal added here is one without karats: its own weight, its own rates) —
 * once, whatever the case. From then on they are in New Order, Order edit and Final Approval.
 */
export function rememberItems(db: DB, d: LabourDraft) {
  const card = cardOf(d);
  const items = d.newItems.filter(it => card.some(r => sameName(r.item, it)));
  const metals = d.newMetals.filter(m => card.some(r => sameName(r.metal, m)));
  if (!items.length && !metals.length) return;
  if (!db.settings.optionLists) db.settings.optionLists = {};
  const curItems = listOf("jewelleryTypes", db.settings);
  const addItems = items.filter(it => !curItems.some(x => sameName(x, it)));
  if (addItems.length) db.settings.optionLists.jewelleryTypes = [...curItems, ...addItems];
  const curMetals = listOf("metals", db.settings);
  const addMetals = metals.filter(m => !curMetals.some(x => sameName(x, m)));
  if (addMetals.length) db.settings.optionLists.metals = [...curMetals, ...addMetals];
  const noKarat = noKaratMetals(db.settings);
  const plain = metals.filter(m => !noKarat.some(x => sameName(x, m)));
  if (plain.length) db.settings.metalsWithoutKarats = [...noKarat, ...plain];
}

/**
 * The factory's making charge, set once: for each metal and each kind of piece,
 * ₹ a gram and the least it charges for a light one. An order's Final Approval
 * starts from these — the order's factory, metals and jewellery type — and can
 * be changed there for that one piece.
 */
export function FactoryLabourFields({ value, onChange, idPrefix }: { value: LabourDraft; onChange: (v: LabourDraft) => void; idPrefix: string }) {
  const db = useDb();
  const card = cardOf(value);
  const listed = choicesOf("jewelleryTypes", undefined, db.settings).filter(t => t !== "Diamond Only");
  const nonGold = choicesOf("metals", undefined, db.settings, { builtIn: false }).filter(m => isNonGoldMetal(m, db.settings));
  // Every metal and item with a line, even one no longer in the lists — never hidden, never lost.
  const metals = [GOLD_CARD, ...nonGold];
  for (const m of [...value.newMetals, ...Object.values(value.cells).map(c => c.metal)]) if (!metals.some(x => sameName(x, m))) metals.push(m);
  const items = [...listed];
  for (const it of [...value.newItems, ...Object.values(value.cells).map(c => c.item)]) if (it.trim() && !items.some(x => sameName(x, it))) items.push(it);
  const [tab, setTab] = useState(GOLD_CARD);
  const metal = metals.find(m => sameName(m, tab)) ?? GOLD_CARD;
  const isGold = sameName(metal, GOLD_CARD);
  const [typed, setTyped] = useState("");
  const [typedMetal, setTypedMetal] = useState<string | null>(null); // null: the box is closed

  const cell = (item: string): RateCell => value.cells[cellKey(metal, item)] ?? { metal, item, perGram: "", minimum: "", minimumUnder: "" };
  const set = (item: string, field: "perGram" | "minimum" | "minimumUnder", v: string) =>
    onChange({ ...value, cells: { ...value.cells, [cellKey(metal, item)]: { ...cell(item), [field]: v } } });
  const setCount = (m: string) => card.filter(r => sameName(r.metal, m)).length;

  const addItem = () => {
    const it = tidy(typed);
    if (!it) return;
    const known = items.find(x => sameName(x, it)) ?? (sameName(it, "Diamond Only") ? "Diamond Only" : undefined);
    if (known) { toast.info(`"${known}" is already in the list`, { description: "Its rates are on the line below." }); setTyped(""); return; }
    onChange({ ...value, newItems: [...value.newItems, it] });
    setTyped("");
  };
  const dropItem = (it: string) => onChange({ ...value,
    cells: Object.fromEntries(Object.entries(value.cells).filter(([, c]) => !sameName(c.item, it))),
    newItems: value.newItems.filter(x => !sameName(x, it)),
  });
  const addMetal = () => {
    const m = tidy(typedMetal ?? "");
    if (!m) return;
    const known = metals.find(x => sameName(x, m));
    if (known) { setTab(known); setTypedMetal(null); toast.info(`${known} is already here`); return; }
    // Gold of any colour is charged on the gold card — not a metal of its own here.
    const listedGold = choicesOf("metals", undefined, db.settings, { builtIn: false }).find(x => sameName(x, m) && metalHasKarats(x, db.settings));
    if (listedGold || (/gold/i.test(m) && metalHasKarats(m, db.settings))) {
      toast.info(`${listedGold ?? m} is gold — its rates are on the Gold card`, { description: "Every gold, any colour or karat, is charged at gold's rates." });
      setTab(GOLD_CARD); setTypedMetal(null); return;
    }
    onChange({ ...value, newMetals: [...value.newMetals, m] });
    setTab(m); setTypedMetal(null);
  };
  const dropMetal = (m: string) => {
    onChange({ ...value,
      cells: Object.fromEntries(Object.entries(value.cells).filter(([, c]) => !sameName(c.metal, m))),
      newMetals: value.newMetals.filter(x => !sameName(x, m)),
    });
    setTab(GOLD_CARD);
  };
  // Gold's lines into this metal, where this metal has none of its own.
  const copyGold = () => {
    const cells = { ...value.cells };
    let n = 0;
    for (const g of Object.values(value.cells).filter(c => sameName(c.metal, GOLD_CARD))) {
      const k = cellKey(metal, g.item);
      const cur = cells[k];
      if (cur && (cur.perGram || cur.minimum)) continue;
      if (!g.perGram && !g.minimum) continue;
      cells[k] = { ...g, metal };
      n++;
    }
    onChange({ ...value, cells });
    toast.success(n ? `Gold's rates copied to ${metal} — change any of them` : `${metal} already has its own rates`);
  };

  const money = (n: number) => `₹${n.toLocaleString("en-IN")}`;
  const via = (f: RateFrom | undefined) => !f ? "" : sameName(f.metal, metal) ? `${metal} · all items` : `Gold · ${f.item ?? "all items"}`;
  const row = (item: string, label: string, opts: { all?: boolean; removable?: boolean; note?: string } = {}) => {
    const c = cell(item);
    const up = rateIn(card, metal, item, 1); // what this line takes when left blank
    const id = `${idPrefix}-${metal}-${item || "all"}`.replace(/\s+/g, "_");
    const hasMin = Number(c.minimum) > 0;
    return (
      <div key={item || "__all"} className={cn("grid grid-cols-3 gap-2 items-end sm:items-center sm:grid-cols-[minmax(0,1.3fr)_repeat(3,minmax(0,1fr))] py-2 border-t border-border/50",
        opts.all && "bg-secondary/40 -mx-2 px-2 rounded-lg border-t-0")}>
        <div className="col-span-3 sm:col-span-1 flex items-center gap-1.5 min-w-0">
          <span className={cn("text-sm truncate", opts.all ? "font-semibold" : "text-foreground")}>{label}</span>
          {opts.note && <span className="text-[10px] text-muted-foreground shrink-0">{opts.note}</span>}
          {opts.removable && (
            <button type="button" onClick={() => dropItem(item)} aria-label={`Remove ${item}`} className="ml-auto sm:ml-0 rounded p-0.5 text-muted-foreground hover:text-destructive">
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
        <div>
          <Label htmlFor={`${id}-r`} className="text-[10px] text-muted-foreground sm:hidden">₹ / g</Label>
          <Input id={`${id}-r`} type="number" min={0} step="0.01" inputMode="decimal" value={c.perGram} onChange={e => set(item, "perGram", e.target.value)}
            className="rounded-lg h-9" aria-label={`${metal} ${label} labour per gram`}
            placeholder={up.perGram ? money(up.perGram) : opts.all ? "₹ /g" : "on the order"}
            title={up.perGram && !c.perGram ? `Blank: ${money(up.perGram)} a gram — from ${via(up.perGramFrom)}` : undefined} />
        </div>
        <div>
          <Label htmlFor={`${id}-m`} className="text-[10px] text-muted-foreground sm:hidden">Minimum ₹</Label>
          <Input id={`${id}-m`} type="number" min={0} step="0.01" inputMode="decimal" value={c.minimum} onChange={e => set(item, "minimum", e.target.value)}
            className="rounded-lg h-9" aria-label={`${metal} ${label} minimum labour`}
            placeholder={up.minimum ? money(up.minimum) : "none"}
            title={up.minimum && !c.minimum ? `Blank: ${money(up.minimum)} minimum — from ${via(up.minimumFrom)}` : undefined} />
        </div>
        <div>
          <Label htmlFor={`${id}-u`} className="text-[10px] text-muted-foreground sm:hidden">Under (g)</Label>
          <Input id={`${id}-u`} type="number" min={0} step="0.001" inputMode="decimal" value={hasMin ? c.minimumUnder : ""} onChange={e => set(item, "minimumUnder", e.target.value)}
            disabled={!hasMin} className="rounded-lg h-9" aria-label={`${metal} ${label} minimum for pieces under (g)`}
            placeholder={hasMin ? "any weight" : up.minimum && up.minimumUnder ? `${up.minimumUnder.toFixed(3)} g` : "—"} />
        </div>
      </div>
    );
  };

  return (
    <div className="rounded-xl border border-border/70 p-4 space-y-3">
      <div>
        <p className="text-sm font-semibold text-foreground">Labour rates</p>
        <p className="text-xs text-muted-foreground mt-0.5">For each metal and each item: ₹ a gram, and the minimum for a light piece. Filled in on each order's Final Approval for this factory — still changeable there.</p>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <div className="contents" role="tablist" aria-label="Metal">
        {metals.map(m => {
          const n = setCount(m), on = sameName(m, metal);
          return (
            <button key={m} type="button" role="tab" aria-selected={on} onClick={() => setTab(m)}
              className={cn("rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                on ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background text-foreground hover:bg-secondary")}>
              {m}{n > 0 && <span className={cn("ml-1.5 tabular-nums", on ? "opacity-80" : "text-muted-foreground")}>{n}</span>}
            </button>
          );
        })}
        </div>
        {typedMetal == null ? (
          <button type="button" onClick={() => setTypedMetal("")}
            className="inline-flex items-center rounded-full border border-dashed border-border px-3 py-1 text-xs font-medium text-muted-foreground hover:bg-secondary hover:text-foreground">
            <Plus className="h-3 w-3 mr-1" /> Add metal
          </button>
        ) : (
          <span className="inline-flex items-center gap-1.5">
            <Input autoFocus value={typedMetal} onChange={e => setTypedMetal(e.target.value)} aria-label="New metal" placeholder="e.g. Palladium"
              onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); addMetal(); } }}
              className="h-8 w-36 rounded-full text-xs" />
            <Button type="button" size="sm" className="h-8 rounded-full px-3 text-xs" onClick={addMetal} disabled={!tidy(typedMetal)}>Add</Button>
            <button type="button" onClick={() => setTypedMetal(null)} aria-label="Close" className="rounded p-1 text-muted-foreground hover:text-foreground"><X className="h-3.5 w-3.5" /></button>
          </span>
        )}
      </div>
      {(() => {
        const isNew = value.newMetals.some(m => sameName(m, metal));
        const orphan = !isNew && !isGold && !nonGold.some(m => sameName(m, metal));
        if (!isNew && !orphan) return null;
        return (
          <p className="text-[11px] text-muted-foreground -mt-1">
            <span className="font-medium text-foreground">{metal}</span>{isNew
              ? " is new — it goes into the metals (without karats) when the factory is saved, for every order from then on."
              : " is not in the metals list any more (Settings → Dropdown lists) — its rates are kept for orders in it."}
            {" "}<button type="button" onClick={() => dropMetal(metal)} className="underline hover:text-destructive">{isNew ? "Remove it" : "Remove its rates"}</button>
          </p>
        );
      })()}

      <div>
        <div className="hidden sm:grid sm:grid-cols-[minmax(0,1.3fr)_repeat(3,minmax(0,1fr))] gap-2 pb-1.5 text-[11px] font-medium text-muted-foreground">
          <span>{isGold ? "Gold (every colour, every karat)" : metal}</span><span>₹ / g</span><span>Minimum ₹</span><span>Minimum under (g)</span>
        </div>
        {row("", "All items", { all: true })}
        {items.map(it => {
          const isNew = value.newItems.some(x => sameName(x, it));
          const orphan = !isNew && !listed.some(x => sameName(x, it));
          return row(it, it, { removable: isNew || orphan, note: isNew ? "new" : orphan ? "not in the list" : undefined });
        })}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Input value={typed} onChange={e => setTyped(e.target.value)} onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); addItem(); } }}
          placeholder="New item, e.g. Bangle" className="rounded-lg h-9 w-full sm:w-56" aria-label="New item" />
        <Button type="button" variant="outline" size="sm" className="rounded-lg h-9" onClick={addItem} disabled={!tidy(typed)}>
          <Plus className="h-3.5 w-3.5 mr-1" /> Add item
        </Button>
        {!isGold && (
          <Button type="button" variant="ghost" size="sm" className="rounded-lg h-9 sm:ml-auto" onClick={copyGold}>
            <Copy className="h-3.5 w-3.5 mr-1" /> Copy gold's rates
          </Button>
        )}
      </div>

      <p className="text-[11px] text-muted-foreground leading-relaxed">
        A blank box takes the figure shown greyed in it: the item → All items{isGold ? "" : " → gold's"}. Each metal in a piece is charged its own rate;
        the minimum is the piece's own metal's (a platinum ring: Platinum · Ring). Leave the weight blank to charge the minimum whenever gram × rate comes to less.
        A new item or metal goes into Settings → Dropdown lists when the factory is saved — then New Order, Order edit and Final Approval offer it.
      </p>
    </div>
  );
}
