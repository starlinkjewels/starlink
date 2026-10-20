import { useEffect, useState } from "react";
import { SectionTitle } from "@/components/SectionTitle";
import { Palette, Check, RotateCcw, TrendingUp, Package, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { loadDb, updateDb } from "@/lib/db";
import { useDb } from "@/hooks/useDb";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { studioOn, setStudio } from "@/lib/studio";
import { reapplyTableUi } from "@/lib/tableStyle";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectSeparator, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  UI_LOOKS, UI_ACCENTS, DEFAULT_APPEARANCE, TEXT_FONTS, HEADING_SERIFS, appearanceOf, applyAppearance, isDefaultAppearance, loadFontPreviews,
  type AppearanceUi, type UiLook, type UiFont, type UiHeadingFont, type UiFontDef,
} from "@/lib/appearance";

/** A font in the list, drawn in itself, with what it is like. */
function FontItem({ f }: { f: UiFontDef }) {
  return (
    <SelectItem value={f.key} className="py-2">
      <span className="flex flex-col">
        <span className="text-[15px] font-semibold leading-tight" style={{ fontFamily: f.stack }}>{f.name}</span>
        <span className="text-[10px] text-muted-foreground font-normal" style={{ fontFamily: "var(--font-sans)" }}>{f.hint}</span>
      </span>
    </SelectItem>
  );
}

/** The chosen font's name, drawn in it, on the closed picker. */
function FontTrigger({ label, f }: { label: string; f?: UiFontDef }) {
  return (
    <SelectTrigger className="h-11 w-full sm:w-64 rounded-xl" aria-label={label}>
      <SelectValue>{f ? <span className="font-semibold" style={{ fontFamily: f.stack }}>{f.name}</span> : null}</SelectValue>
    </SelectTrigger>
  );
}

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
 * The new look, as a preview on this device only — try it on the real app,
 * switch back any time. Nothing is saved for anyone else.
 */
function NewLookPreview({ onChange }: { onChange: () => void }) {
  const [on, setOn] = useState(studioOn);
  const flip = (v: boolean) => {
    setStudio(v);
    setOn(v);
    onChange();
    reapplyTableUi();
    toast.success(v ? "New look on — only on this device" : "Back to the current look");
  };
  return (
    <div className="card-luxe p-4 sm:p-5 flex items-start sm:items-center justify-between gap-4">
      <div className="min-w-0 flex items-start gap-3">
        <span className="ui-title-icon h-9 w-9 shrink-0 rounded-xl bg-primary/10 text-primary grid place-items-center"><Sparkles className="h-[18px] w-[18px]" /></span>
        <div className="min-w-0">
          <label htmlFor="new-look" className="text-sm font-semibold text-brand-dark cursor-pointer">New look (preview)</label>
          <p className="text-xs text-muted-foreground mt-0.5">One clean font, calm colours and flat cards. Only on this device — switch back any time. Your brand colour, light/dark and corners stay; the look and font choices below rest while it is on.</p>
        </div>
      </div>
      <Switch id="new-look" checked={on} onCheckedChange={flip} />
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
    <div className="space-y-4">
    <NewLookPreview onChange={() => applyAppearance(ui)} />
    <div className="card-luxe p-5 sm:p-6 space-y-5">
      <SectionTitle icon={Palette} title="Appearance" sub="For everyone, once saved" />

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
        {row("Text font", "Everything you read — lists, forms, tables and buttons",
          <Select value={ui.font} onValueChange={v => set("font", v as UiFont)} onOpenChange={o => o && loadFontPreviews()}>
            <FontTrigger label="Text font" f={TEXT_FONTS.find(f => f.key === ui.font)} />
            <SelectContent className="max-h-[22rem]">
              {TEXT_FONTS.map(f => <FontItem key={f.key} f={f} />)}
            </SelectContent>
          </Select>)}
        {row("Heading font", "Page titles, card titles and the big figures",
          <Select value={ui.headingFont}
            onValueChange={v => setUi(prev => ({ ...prev, headingFont: v as UiHeadingFont, headings: HEADING_SERIFS.some(f => f.key === v) ? "serif" : "sans" }))}
            onOpenChange={o => o && loadFontPreviews()}>
            <FontTrigger label="Heading font"
              f={ui.headingFont === "same"
                ? { key: "same", name: "Same as text", spec: null, stack: TEXT_FONTS.find(f => f.key === ui.font)?.stack ?? "inherit", hint: "" }
                : [...HEADING_SERIFS, ...TEXT_FONTS].find(f => f.key === ui.headingFont)} />
            <SelectContent className="max-h-[22rem]">
              <SelectItem value="same" className="py-2">
                <span className="flex flex-col">
                  <span className="text-[15px] font-semibold leading-tight">Same as text</span>
                  <span className="text-[10px] text-muted-foreground font-normal">One font everywhere — clean and modern</span>
                </span>
              </SelectItem>
              <SelectSeparator />
              <SelectGroup>
                <SelectLabel className="text-[10px] uppercase tracking-wider text-muted-foreground">Serif — elegant</SelectLabel>
                {HEADING_SERIFS.map(f => <FontItem key={f.key} f={f} />)}
              </SelectGroup>
              <SelectSeparator />
              <SelectGroup>
                <SelectLabel className="text-[10px] uppercase tracking-wider text-muted-foreground">Sans — modern</SelectLabel>
                {TEXT_FONTS.filter(f => f.key !== "system").map(f => <FontItem key={f.key} f={f} />)}
              </SelectGroup>
            </SelectContent>
          </Select>)}
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
    </div>
  );
}
