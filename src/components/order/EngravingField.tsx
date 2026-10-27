import { useId } from "react";
import { Info, Plus, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

/** Letters an engraving can hold — what fits inside a ring band. */
export const ENGRAVING_MAX = 20;
export type EngravingFont = "block" | "script";
export const ENGRAVING_FONTS: { key: EngravingFont; label: string; css: string }[] = [
  { key: "block", label: "Block", css: "'Inter', 'Helvetica Neue', Arial, sans-serif" },
  { key: "script", label: "Script", css: "'Great Vibes', 'Brush Script MT', cursive" },
];
export const engravingFontCss = (f?: EngravingFont) => (ENGRAVING_FONTS.find(x => x.key === f) ?? ENGRAVING_FONTS[0]).css;
export const engravingFontLabel = (f?: EngravingFont) => (ENGRAVING_FONTS.find(x => x.key === f) ?? ENGRAVING_FONTS[0]).label;

export interface EngravingDraft { on: boolean; text: string; font: EngravingFont }
export const emptyEngraving = (): EngravingDraft => ({ on: false, text: "", font: "block" });

const FINAL_SALE = "Engraved or personalised pieces can't be returned — they are made for the client alone, so once engraved the piece is a final sale.";

/** The words on the inside of a ring band, in the chosen letters. */
export function EngravingPreview({ text, font, className = "" }: { text: string; font: EngravingFont; className?: string }) {
  const id = useId().replace(/:/g, "");
  return (
    <svg viewBox="0 0 400 130" className={`w-full rounded-xl ${className}`} role="img" aria-label={`Engraving preview: ${text}`}>
      <defs>
        <linearGradient id={`bg${id}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#f4f4f5" /><stop offset="1" stopColor="#d4d4d8" /></linearGradient>
        <linearGradient id={`band${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fafafa" /><stop offset="0.35" stopColor="#d6d6d9" /><stop offset="0.55" stopColor="#f2f2f3" /><stop offset="1" stopColor="#a1a1aa" />
        </linearGradient>
        <path id={`arc${id}`} d="M 30 92 Q 200 40 370 92" />
      </defs>
      <rect width="400" height="130" fill={`url(#bg${id})`} />
      {/* The band: a wide arc of polished metal, the words along its middle. */}
      <path d="M -10 78 Q 200 18 410 78 L 410 112 Q 200 54 -10 112 Z" fill={`url(#band${id})`} />
      <path d="M -10 78 Q 200 18 410 78" fill="none" stroke="#ffffff" strokeOpacity="0.8" strokeWidth="1.5" />
      <path d="M -10 112 Q 200 54 410 112" fill="none" stroke="#71717a" strokeOpacity="0.5" strokeWidth="1.2" />
      <text fontFamily={engravingFontCss(font)} fontSize={font === "script" ? 26 : 19} fill="#27272a" fillOpacity="0.85" letterSpacing={font === "script" ? 0.5 : 1.2}>
        <textPath href={`#arc${id}`} startOffset="50%" textAnchor="middle">{text || "Your words"}</textPath>
      </text>
    </svg>
  );
}

/** "+ Add engraving" — the words, the letters, a preview, and the final-sale note. */
export function EngravingField({ value: v, onChange, disabled }: { value: EngravingDraft; onChange(next: EngravingDraft): void; disabled?: boolean }) {
  const set = (p: Partial<EngravingDraft>) => onChange({ ...v, ...p });
  const info = (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" aria-label="About engraving" className="h-6 w-6 rounded-full grid place-items-center text-muted-foreground hover:text-foreground"><Info className="h-4 w-4" /></button>
      </PopoverTrigger>
      <PopoverContent side="top" className="w-72 rounded-xl p-4">
        <p className="font-display text-lg text-brand-dark">Not eligible for return</p>
        <p className="text-sm text-muted-foreground mt-1">{FINAL_SALE}</p>
      </PopoverContent>
    </Popover>
  );
  if (!v.on) {
    return (
      <div className="flex items-center gap-1 mt-3">
        <button type="button" disabled={disabled} onClick={() => set({ on: true })}
          className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline disabled:opacity-50">
          <Plus className="h-4 w-4" /> Add engraving
        </button>
        {info}
      </div>
    );
  }
  const left = ENGRAVING_MAX - v.text.length;
  return (
    <div className="mt-3 rounded-2xl border border-border/80 bg-secondary/30 p-4 space-y-3.5">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-brand-dark flex items-center gap-1">Engraving {info}</p>
        <button type="button" disabled={disabled} onClick={() => onChange({ on: false, text: "", font: "block" })} className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-destructive">
          <X className="h-3.5 w-3.5" /> Remove
        </button>
      </div>
      <div>
        <Input value={v.text} maxLength={ENGRAVING_MAX} disabled={disabled} onChange={e => set({ text: e.target.value.slice(0, ENGRAVING_MAX) })}
          placeholder="e.g. Forever · 12.06.2026" aria-label="Engraving text" className="h-11 rounded-xl bg-white" />
        <p className={`text-[11px] text-right mt-1 ${left === 0 ? "text-destructive" : "text-muted-foreground"}`}>Characters left: {left}</p>
      </div>
      <div>
        <p className="text-xs text-muted-foreground mb-1.5">Letters</p>
        <div className="flex gap-2" role="radiogroup" aria-label="Engraving letters">
          {ENGRAVING_FONTS.map(fo => (
            <button key={fo.key} type="button" role="radio" aria-checked={v.font === fo.key} disabled={disabled} onClick={() => set({ font: fo.key })} title={fo.label}
              className={`h-14 w-16 rounded-xl border bg-white grid place-items-center text-2xl transition-colors ${v.font === fo.key ? "border-brand-dark ring-1 ring-brand-dark" : "border-border hover:border-primary/40"}`}
              style={{ fontFamily: fo.css }}>Aa</button>
          ))}
        </div>
      </div>
      <div>
        <p className="text-xs text-muted-foreground mb-1.5">Preview</p>
        <EngravingPreview text={v.text} font={v.font} />
        <p className="text-[11px] text-muted-foreground mt-1.5">A 10× loupe may be needed to read engraving on jewellery.</p>
      </div>
      <div className="rounded-xl bg-white border border-border/70 px-3 py-2.5">
        <p className="text-sm font-semibold text-brand-dark">Final sale — not eligible for return</p>
        <p className="text-xs text-muted-foreground mt-0.5">{FINAL_SALE}</p>
      </div>
    </div>
  );
}
