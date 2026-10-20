import { useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { toast } from "sonner";
import { Check, ImagePlus, Loader2, Trash2, Sun, Moon, AlertTriangle, LayoutDashboard, Package, Users, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SectionTitle } from "@/components/SectionTitle";
import { useDb } from "@/hooks/useDb";
import { updateDb } from "@/lib/db";
import { useAuth } from "@/lib/auth";
import { useBrand, saveBrand, fitImage, brandName, BUILTIN, type Brand } from "@/lib/brand";
import { brandPalette, BRAND_PRESETS, hexToOklch } from "@/lib/brandColor";
import { appearanceOf, type AppearanceUi, type UiCorners, type UiTheme } from "@/lib/appearance";
import { tableUiOf, type TableUi } from "@/lib/tableStyle";

type Density = "default" | "compact";

/** One choice out of a few. */
function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: [T, string][]; onChange: (v: T) => void; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex gap-0.5 p-1 rounded-xl bg-secondary">
      {options.map(([k, l]) => (
        <button key={k} type="button" role="radio" aria-checked={value === k} onClick={() => onChange(k)}
          className={`h-8 px-3 rounded-lg text-xs font-semibold transition-colors ${value === k ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>
          {l}
        </button>
      ))}
    </div>
  );
}

/** A labelled row of the form: what it is, a short hint, then the control. */
function Row({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="py-4 border-t border-border/60 first:border-t-0 first:pt-0 space-y-2.5">
      <div className="min-w-0">
        <p className="text-sm font-medium text-foreground">{label}</p>
        {hint && <p className="text-xs text-muted-foreground mt-0.5 leading-snug max-w-prose">{hint}</p>}
      </div>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

/** Pick, show, replace or remove one picture. */
function ImagePick({ value, fallback, onPick, onClear, ground, box, label }: {
  value?: string; fallback?: string; onPick: (f: File) => Promise<void>; onClear: () => void;
  ground: "light" | "dark"; box: string; label: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const shown = value || fallback;
  return (
    <div className="flex items-center gap-3">
      <div className={`${box} shrink-0 rounded-lg border grid place-items-center overflow-hidden p-2 ${ground === "dark" ? "bg-[#16181d] border-white/10" : "bg-white border-border"}`}>
        {shown ? <img src={shown} alt="" className={`max-h-full max-w-full object-contain ${value ? "" : "opacity-40"}`} />
          : <ImagePlus className={`h-5 w-5 ${ground === "dark" ? "text-white/40" : "text-muted-foreground/60"}`} />}
      </div>
      <div className="flex flex-col gap-1.5">
        <input ref={input} type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" className="hidden" aria-label={label}
          onChange={async e => {
            const f = e.target.files?.[0]; e.target.value = "";
            if (!f) return;
            setBusy(true);
            try { await onPick(f); } catch (err) { toast.error((err as Error).message); } finally { setBusy(false); }
          }} />
        <Button type="button" variant="outline" size="sm" className="h-8 rounded-lg gap-1.5" disabled={busy} onClick={() => input.current?.click()}>
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ImagePlus className="h-3.5 w-3.5" />}{value ? "Replace" : "Upload"}
        </Button>
        {value && <Button type="button" variant="ghost" size="sm" className="h-7 rounded-lg gap-1.5 text-muted-foreground" onClick={onClear}><Trash2 className="h-3.5 w-3.5" />Remove</Button>}
      </div>
    </div>
  );
}

/** A miniature of the app in the draft brand — sidebar, header, figures, a table and the main button. */
function Preview({ brand, theme, corners, density }: { brand: Brand; theme: "light" | "dark"; corners: UiCorners; density: Density }) {
  const pal = brand.color ? brandPalette(brand.color) : null;
  const dark = theme === "dark";
  const primary = pal ? (dark ? pal.dark["--primary"] : pal.light["--primary"]) : (dark ? "oklch(0.6 0.15 262)" : "oklch(0.475 0.13 264)");
  const c = dark
    ? { bg: "#14161b", side: "#181a20", card: "#1c1f25", fg: "#eceef2", muted: "#9ea3ad", line: "rgba(255,255,255,0.09)" }
    : { bg: "#faf9f7", side: "#f5f4f1", card: "#ffffff", fg: "#1d2027", muted: "#6c707b", line: "#e8e6e2" };
  const r = corners === "sharp" ? 5 : corners === "round" ? 14 : 9;
  const row = density === "compact" ? 30 : 38;
  const logo = dark ? (brand.logoDark || brand.logo || BUILTIN.logo) : (brand.logo || BUILTIN.logo);
  const tint = `color-mix(in oklab, ${primary} 12%, transparent)`;
  const nav = [[LayoutDashboard, "Home"], [Package, "Orders"], [Users, "Clients"], [Wallet, "Payments"]] as const;
  const box: CSSProperties = { background: c.card, border: `1px solid ${c.line}`, borderRadius: r + 3 };
  return (
    <div className="rounded-2xl overflow-hidden border border-border/70 shadow-sm text-[11px] select-none" style={{ background: c.bg, color: c.fg, fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif" }} aria-hidden>
      <div className="flex min-h-[19rem]">
        <div className="w-[7.5rem] shrink-0 p-2.5 flex flex-col gap-1" style={{ background: c.side, borderRight: `1px solid ${c.line}` }}>
          <div className="h-8 mb-2 flex items-center"><img src={logo} alt="" className="max-h-7 max-w-full object-contain" /></div>
          {nav.map(([Icon, l], i) => (
            <div key={l} className="flex items-center gap-1.5 px-2 h-7 font-medium" style={{ borderRadius: r, background: i === 1 ? tint : "transparent", color: i === 1 ? primary : c.muted }}>
              <Icon className="h-3.5 w-3.5" />{l}
            </div>
          ))}
        </div>
        <div className="flex-1 min-w-0 p-3 flex flex-col gap-2.5">
          <div className="flex items-center justify-between gap-2">
            <div className="text-[15px] font-semibold tracking-tight">Orders</div>
            <div className="px-2.5 h-7 grid place-items-center text-white font-semibold" style={{ background: primary, borderRadius: r }}>+ New order</div>
          </div>
          <div className="grid grid-cols-3" style={box}>
            {[["Open", "24"], ["Due this week", "6"], ["To collect", "₹4,82,000"]].map(([l, v], i) => (
              <div key={l} className="px-2.5 py-2" style={{ borderLeft: i ? `1px solid ${c.line}` : undefined }}>
                <div style={{ color: c.muted }}>{l}</div>
                <div className="text-[13px] font-semibold mt-0.5 tabular-nums">{v}</div>
              </div>
            ))}
          </div>
          <div style={box} className="overflow-hidden">
            <div className="grid grid-cols-[1fr_1fr_auto] px-2.5 items-center font-medium" style={{ color: c.muted, height: row - 6, borderBottom: `1px solid ${c.line}` }}>
              <span>Order</span><span>Client</span><span>Amount</span>
            </div>
            {[["SLJ-1104", "Givara Jewelry", "$1,420"], ["SLJ-1103", "Aurum & Co", "$860"], ["SLJ-1102", "Noor Gems", "$2,150"]].map(([a, b, v], i) => (
              <div key={a} className="grid grid-cols-[1fr_1fr_auto] px-2.5 items-center tabular-nums" style={{ height: row, borderTop: i ? `1px solid ${c.line}` : undefined }}>
                <span style={{ color: primary }} className="font-medium">{a}</span><span>{b}</span><span>{v}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Settings → Brand Studio: the company's own logo, name, colour and feel, in
 * one place, seen in a live miniature before anything is saved. Save puts it
 * on every screen for everyone (and on the sign-in page of every device).
 */
export function BrandStudio() {
  const db = useDb();
  const { user } = useAuth();
  const saved = useBrand();
  const savedAppearance = appearanceOf(db.settings.appearance as Partial<AppearanceUi> | undefined);
  const savedTable = tableUiOf(db.settings.tableUi as Partial<TableUi> | undefined);
  const savedDensity: Density = savedTable.density === "compact" ? "compact" : "default";

  const [draft, setDraft] = useState<Brand>(saved);
  const [theme, setTheme] = useState<UiTheme>(savedAppearance.theme);
  const [corners, setCorners] = useState<UiCorners>(savedAppearance.corners);
  const [density, setDensity] = useState<Density>(savedDensity);
  const [hexText, setHexText] = useState(saved.color ?? "");
  const [previewTheme, setPreviewTheme] = useState<"light" | "dark">(savedAppearance.theme === "dark" ? "dark" : "light");
  const [saving, setSaving] = useState(false);

  const set = <K extends keyof Brand>(k: K, v: Brand[K]) => setDraft(d => { const n = { ...d }; if (v) n[k] = v; else delete n[k]; return n; });
  const pal = useMemo(() => (draft.color ? brandPalette(draft.color) : null), [draft.color]);

  const brandDirty = (["name", "logo", "logoDark", "mark", "color"] as const).some(k => (draft[k] ?? "") !== (saved[k] ?? ""));
  const lookDirty = theme !== savedAppearance.theme || corners !== savedAppearance.corners || density !== savedDensity;
  const dirty = brandDirty || lookDirty;

  const pickColor = (hex: string) => { setHexText(hex); set("color", hex.toLowerCase()); };

  const save = async () => {
    if (!user) return;
    setSaving(true);
    try {
      if (brandDirty) await saveBrand(draft, user.email || user.name);
      // Only what changed is written; every other appearance and table choice stays as it is.
      if (lookDirty) updateDb(d => {
        if (theme !== savedAppearance.theme || corners !== savedAppearance.corners) {
          d.settings.appearance = { ...appearanceOf(d.settings.appearance as Partial<AppearanceUi> | undefined), theme, corners };
        }
        if (density !== savedDensity) d.settings.tableUi = { ...tableUiOf(d.settings.tableUi as Partial<TableUi> | undefined), density };
      });
      toast.success("Brand saved — everyone now sees it");
    } catch (e) {
      toast.error(`Couldn't save the brand: ${(e as Error).message}`);
    } finally {
      setSaving(false);
    }
  };

  const discard = () => {
    setDraft(saved); setHexText(saved.color ?? "");
    setTheme(savedAppearance.theme); setCorners(savedAppearance.corners); setDensity(savedDensity);
  };

  return (
    <div className="card-luxe p-5 sm:p-6 space-y-5">
      <SectionTitle title="Brand Studio" sub="Your logo, name and colour — on every screen, for everyone" />

      <div className="grid xl:grid-cols-[minmax(0,1fr)_minmax(0,25rem)] gap-6 items-start">
        <div>
          <Row label="Logo" hint="Shown on the sign-in page, the menu, invoices and shared galleries. PNG or SVG with a clear background works best.">
            <ImagePick label="Logo" box="h-16 w-40" ground="light" value={draft.logo} fallback={BUILTIN.logo}
              onPick={async f => set("logo", await fitImage(f, 640, 200))} onClear={() => set("logo", undefined)} />
          </Row>
          <Row label="Logo on dark" hint={draft.logo && !draft.logoDark
            ? <span className="text-amber-700">Your logo shows as it is on dark backgrounds (dark mode, the loading screen) — check the dark preview, or add a light version here.</span>
            : "Optional — a light version for dark mode and the loading screen."}>
            <ImagePick label="Logo on dark" box="h-16 w-40" ground="dark" value={draft.logoDark} fallback={draft.logo || BUILTIN.logo}
              onPick={async f => set("logoDark", await fitImage(f, 640, 200))} onClear={() => set("logoDark", undefined)} />
          </Row>
          <Row label="App icon" hint="Optional — square. The browser tab and the narrow menu.">
            <ImagePick label="App icon" box="h-14 w-14" ground="light" value={draft.mark}
              onPick={async f => set("mark", await fitImage(f, 192, 192, 120_000))} onClear={() => set("mark", undefined)} />
          </Row>
          <Row label="Company name" hint="The browser tab and the sign-in page.">
            <Input value={draft.name ?? ""} onChange={e => set("name", e.target.value.slice(0, 60))} placeholder={brandName({})} className="h-10 rounded-lg sm:w-72" maxLength={60} />
          </Row>
          <Row label="Brand colour" hint="Buttons, links and the selected menu item. Any colour — every shade is worked out, for light and dark.">
            <div className="space-y-3 sm:max-w-[22rem]">
              <div className="flex flex-wrap gap-2">
                {BRAND_PRESETS.map(p => {
                  const on = draft.color?.toLowerCase() === p.hex.toLowerCase();
                  return (
                    <button key={p.name} type="button" onClick={() => pickColor(p.hex)} title={p.name} aria-label={p.name} aria-pressed={on}
                      className={`h-8 w-8 rounded-full grid place-items-center ring-offset-2 ring-offset-card transition ${on ? "ring-2 ring-foreground/50" : "hover:scale-105"}`} style={{ background: p.hex }}>
                      {on && <Check className="h-4 w-4 text-white" />}
                    </button>
                  );
                })}
              </div>
              <div className="flex items-center gap-2">
                <label className="relative h-10 w-10 shrink-0 rounded-lg border border-border overflow-hidden cursor-pointer" style={{ background: draft.color || "transparent" }} title="Choose any colour">
                  <input type="color" value={draft.color || "#2d4a9c"} onChange={e => pickColor(e.target.value)} className="absolute inset-0 opacity-0 cursor-pointer" aria-label="Choose any colour" />
                </label>
                <Input value={hexText} placeholder="#2d4a9c" className="h-10 rounded-lg w-32 font-mono" maxLength={7} aria-label="Colour code"
                  onChange={e => { const v = e.target.value.trim(); setHexText(v); if (hexToOklch(v) && /^#?[0-9a-f]{6}$/i.test(v)) set("color", (v.startsWith("#") ? v : `#${v}`).toLowerCase()); }} />
                {draft.color && <Button type="button" variant="ghost" size="sm" className="h-9 rounded-lg text-muted-foreground" onClick={() => { setHexText(""); set("color", undefined); }}>Use default</Button>}
              </div>
              {pal && (pal.adjusted
                ? <p className="text-xs text-amber-700 flex items-start gap-1.5"><AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0 text-amber-600" />Deepened a little so text on buttons stays readable ({pal.contrast.toFixed(1)} : 1).</p>
                : <p className="text-xs text-muted-foreground flex items-center gap-1.5"><Check className="h-3.5 w-3.5 text-success" />Readable — text on buttons {pal.contrast.toFixed(1)} : 1</p>)}
            </div>
          </Row>
          <Row label="Theme" hint="Match device follows each phone's and computer's own setting.">
            <Segmented label="Theme" value={theme} onChange={v => { setTheme(v); if (v !== "system") setPreviewTheme(v); }} options={[["light", "Light"], ["dark", "Dark"], ["system", "Match device"]]} />
          </Row>
          <Row label="Density" hint="Compact fits more rows on a screen.">
            <Segmented label="Density" value={density} onChange={setDensity} options={[["default", "Comfortable"], ["compact", "Compact"]]} />
          </Row>
          <Row label="Corners">
            <Segmented label="Corners" value={corners} onChange={setCorners} options={[["sharp", "Sharp"], ["default", "Normal"], ["round", "Round"]]} />
          </Row>
        </div>

        <div className="xl:sticky xl:top-4 space-y-2.5">
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium text-muted-foreground">Preview</p>
            <div className="inline-flex gap-0.5 p-0.5 rounded-lg bg-secondary">
              {(["light", "dark"] as const).map(t => (
                <button key={t} type="button" onClick={() => setPreviewTheme(t)} aria-pressed={previewTheme === t} aria-label={t === "light" ? "Light preview" : "Dark preview"}
                  className={`h-7 w-8 grid place-items-center rounded-md transition-colors ${previewTheme === t ? "bg-card text-foreground shadow-sm" : "text-muted-foreground"}`}>
                  {t === "light" ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />}
                </button>
              ))}
            </div>
          </div>
          <Preview brand={draft} theme={previewTheme} corners={corners} density={density} />
          <p className="text-[11px] text-muted-foreground">The miniature shows the new look. Nothing changes for anyone until you save.</p>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 justify-end border-t border-border/60 pt-4">
        {dirty && <Button type="button" variant="outline" onClick={discard} disabled={saving} className="rounded-lg">Discard</Button>}
        <Button type="button" onClick={save} disabled={!dirty || saving} className="btn-hero rounded-lg gap-2">
          {saving && <Loader2 className="h-4 w-4 animate-spin" />}Save for everyone
        </Button>
      </div>
    </div>
  );
}
