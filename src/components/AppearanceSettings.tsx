import { useEffect, useState } from "react";
import { Palette, Check, RotateCcw, TrendingUp, Package } from "lucide-react";
import { toast } from "sonner";
import { loadDb, updateDb } from "@/lib/db";
import { useDb } from "@/hooks/useDb";
import { Button } from "@/components/ui/button";
import {
  UI_LOOKS, UI_ACCENTS, DEFAULT_APPEARANCE, appearanceOf, applyAppearance, isDefaultAppearance,
  type AppearanceUi, type UiLook,
} from "@/lib/appearance";

/** A drawn miniature of each look — so it shows before it is applied. */
function Thumb({ k }: { k: UiLook }) {
  const ground = k === "glass" ? "bg-gradient-to-br from-primary/20 via-secondary to-brand-light/25" : k === "ivory" ? "bg-[oklch(0.975_0.012_85)]" : k === "flat" ? "bg-[oklch(0.985_0.003_255)]" : "bg-background";
  const bar = k === "glass" ? "bg-white/60 border border-white/80 shadow-sm rounded-md m-1" : k === "flat" ? "bg-white border-b border-border" : k === "ivory" ? "bg-[oklch(0.985_0.01_85)] border-b border-[oklch(0.85_0.05_80)]" : "bg-white/90 border-b border-border";
  const side = k === "glass" ? "bg-white/55 border border-white/80 rounded-md m-1 mr-0" : k === "flat" ? "bg-white border-r border-border" : k === "ivory" ? "bg-[oklch(0.975_0.012_85)] border-r border-[oklch(0.85_0.05_80)]" : "bg-sidebar border-r border-border";
  const card = k === "glass" ? "bg-white rounded-md border border-border/70" : k === "flat" ? "bg-white rounded-sm border border-border" : k === "ivory" ? "bg-white rounded border border-[oklch(0.8_0.07_80)] shadow-[0_3px_8px_-5px_oklch(0.45_0.06_70/0.5)]" : "bg-white rounded-md shadow-[0_4px_10px_-5px_rgb(23_59_120/0.3)]";
  return (
    <div className={`h-20 rounded-lg overflow-hidden flex ${ground} border border-border/60`}>
      <div className={`w-6 shrink-0 ${side}`} />
      <div className="flex-1 flex flex-col min-w-0">
        <div className={`h-3.5 shrink-0 ${bar}`} />
        <div className="grid grid-cols-2 gap-1 p-1.5 flex-1">
          {[0, 1, 2, 3].map(i => <div key={i} className={card} />)}
        </div>
      </div>
    </div>
  );
}

/** One choice out of a few, shown with a sliding-pill look. */
function Segmented<T extends string>({ value, options, onChange }: { value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return (
    <div role="radiogroup" className="inline-flex gap-0.5 p-1 rounded-2xl bg-secondary">
      {options.map(([k, l]) => (
        <button key={k} type="button" role="radio" aria-checked={value === k} onClick={() => onChange(k)}
          className={`h-9 px-3.5 rounded-xl text-xs font-semibold transition-all ${value === k ? "bg-primary text-primary-foreground shadow-soft" : "text-muted-foreground hover:text-foreground"}`}>
          {l}
        </button>
      ))}
    </div>
  );
}

/**
 * Settings → Appearance. A choice shows at once on the whole app; Save keeps
 * it for everyone. Leaving without saving puts back what was saved.
 */
export function AppearanceSettings() {
  const db = useDb();
  const saved = appearanceOf(db.settings.appearance as Partial<AppearanceUi> | undefined);
  const savedKey = JSON.stringify(saved);
  const [ui, setUi] = useState<AppearanceUi>(saved);
  const dirty = JSON.stringify(ui) !== savedKey;
  const set = <K extends keyof AppearanceUi>(k: K, v: AppearanceUi[K]) => setUi(prev => ({ ...prev, [k]: v }));

  // Live preview on the whole app while choosing; the saved look again on the way out.
  useEffect(() => { applyAppearance(ui); }, [ui]);
  // Read live — after a Save this is the new look, not the one the page opened with.
  useEffect(() => () => applyAppearance(appearanceOf(loadDb().settings.appearance as Partial<AppearanceUi> | undefined)), []);

  const save = () => {
    updateDb(d => { d.settings.appearance = isDefaultAppearance(ui) ? undefined : ui; });
    toast.success("Appearance saved — everyone now sees this look");
  };

  const row = (label: string, hint: string, control: React.ReactNode) => (
    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 sm:gap-4 py-3 border-t border-border/60 first:border-t-0">
      <div className="min-w-0">
        <p className="text-sm font-medium text-brand-dark">{label}</p>
        <p className="text-[11px] text-muted-foreground">{hint}</p>
      </div>
      <div className="shrink-0">{control}</div>
    </div>
  );

  return (
    <div className="card-luxe p-5 sm:p-6 space-y-5">
      <div className="flex items-start gap-2">
        <Palette className="h-4 w-4 text-primary mt-0.5" />
        <div>
          <h3 className="font-semibold">Appearance</h3>
          <p className="text-xs text-muted-foreground mt-0.5">The look of the whole software — on phones and computers. Every choice shows at once; Save keeps it for everyone.</p>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {UI_LOOKS.map(l => {
          const on = ui.look === l.key;
          return (
            <button key={l.key} type="button" onClick={() => set("look", l.key)} aria-pressed={on}
              className={`text-left rounded-2xl border p-2.5 sm:p-3 space-y-2 transition-all ${on ? "border-primary ring-2 ring-primary/30 bg-primary/5" : "border-border/70 hover:border-primary/40 bg-white"}`}>
              <Thumb k={l.key} />
              <div className="flex items-center justify-between gap-1">
                <span className="text-sm font-semibold text-brand-dark">{l.name}</span>
                {on && <Check className="h-4 w-4 text-primary shrink-0" />}
              </div>
              <p className="text-[11px] text-muted-foreground leading-snug">{l.hint}</p>
            </button>
          );
        })}
      </div>

      <div>
        {row("Theme", "Light, dark, or whatever each phone and computer is set to",
          <Segmented value={ui.theme} onChange={v => set("theme", v)} options={[["light", "Light"], ["dark", "Dark"], ["system", "Match device"]]} />)}
        {row("Accent colour", "Buttons, links, the selected menu item and highlights",
          <div className="flex flex-wrap gap-2">
            {UI_ACCENTS.map(a => (
              <button key={a.key} type="button" onClick={() => set("accent", a.key)} title={a.name} aria-label={a.name} aria-pressed={ui.accent === a.key}
                className={`h-9 w-9 rounded-full grid place-items-center ring-offset-2 transition ${ui.accent === a.key ? "ring-2 ring-foreground/60" : "hover:scale-105"}`}
                style={{ background: a.swatch }}>
                {ui.accent === a.key && <Check className="h-4 w-4 text-white" />}
              </button>
            ))}
          </div>)}
        {row("Corners", "How round cards, buttons and boxes are",
          <Segmented value={ui.corners} onChange={v => set("corners", v)} options={[["sharp", "Sharp"], ["default", "Normal"], ["round", "Round"]]} />)}
        {row("Headings", "Elegant serif, or a clean modern sans",
          <Segmented value={ui.headings} onChange={v => set("headings", v)} options={[["serif", "Elegant"], ["sans", "Modern"]]} />)}
        {row("Page width", "Fit screen uses all of a big monitor; Centred keeps pages at a reading width",
          <Segmented value={ui.width} onChange={v => set("width", v)} options={[["fit", "Fit screen"], ["centered", "Centred"]]} />)}
        {row("Animation", "Calm makes everything appear in place — kinder on slow phones",
          <Segmented value={ui.motion} onChange={v => set("motion", v)} options={[["full", "Smooth"], ["calm", "Calm"]]} />)}
      </div>

      <div>
        <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">Preview</p>
        <div className="rounded-2xl border border-border/60 bg-background p-3 sm:p-4 grid sm:grid-cols-2 gap-3">
          <div className="card-luxe card-hover p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Revenue this month</p>
                <p className="font-display text-2xl text-brand-dark mt-1.5">$12,500</p>
              </div>
              <div className="h-10 w-10 rounded-2xl bg-primary/10 text-primary grid place-items-center"><TrendingUp className="h-5 w-5" /></div>
            </div>
            <p className="text-xs text-success font-medium mt-2">+18% on last month</p>
          </div>
          <div className="card-luxe p-4 space-y-3">
            <div className="flex items-center gap-2">
              <Package className="h-4 w-4 text-primary" />
              <span className="font-mono text-xs font-semibold text-brand-dark">SLJ-2026-1104</span>
              <span className="ml-auto text-[10px] font-semibold px-2 py-0.5 rounded-full bg-primary/10 text-primary">In Production</span>
            </div>
            <div className="h-1.5 rounded-full bg-secondary overflow-hidden"><div className="h-full w-2/3 rounded-full bg-primary" /></div>
            <div className="flex gap-2">
              <button type="button" className="btn-hero h-9 px-4 rounded-xl text-sm font-semibold">Primary action</button>
              <button type="button" className="h-9 px-4 rounded-xl text-sm font-medium border border-border bg-white hover:bg-secondary">Other</button>
            </div>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 justify-end">
        {!isDefaultAppearance(ui) && (
          <Button type="button" variant="ghost" onClick={() => setUi(DEFAULT_APPEARANCE)} className="rounded-xl gap-1.5 text-muted-foreground">
            <RotateCcw className="h-4 w-4" /> Back to Classic
          </Button>
        )}
        {dirty && <Button type="button" variant="outline" onClick={() => setUi(saved)} className="rounded-xl">Discard</Button>}
        <Button type="button" onClick={save} disabled={!dirty} className="btn-hero rounded-xl">Save for everyone</Button>
      </div>
    </div>
  );
}
