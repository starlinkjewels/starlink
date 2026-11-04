// The email, block by block: add, move, copy, remove and change each one —
// and the email's colours and font. Every change is drawn at once in the
// preview beside it (the same drawing the email is sent with).
import { useRef, useState, type ReactNode } from "react";
import { ArrowDown, ArrowUp, Bold, Copy, Gift, Heading, Image as ImageIcon, Italic, LayoutGrid, Link2, Minus, MousePointerClick, MoveVertical, Plus, Trash2, Type, UserRound } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { MoreMenu } from "@/components/MoreMenu";
import type { CampaignBlock, CampaignDesign, CampaignTheme } from "@/lib/pure/campaignEmail";
import { ImagePicker, type PickedPiece } from "./ImagePicker";

const KINDS: { type: CampaignBlock["type"]; label: string; icon: LucideIcon; hint: string }[] = [
  { type: "heading", label: "Heading", icon: Heading, hint: "A title" },
  { type: "text", label: "Text", icon: Type, hint: "Words, with bold, links and the person's name" },
  { type: "image", label: "Picture", icon: ImageIcon, hint: "A photo, from Ready Stock or uploaded" },
  { type: "products", label: "Pieces", icon: LayoutGrid, hint: "Cards from Ready Stock, 2 or 3 to a row" },
  { type: "button", label: "Button", icon: MousePointerClick, hint: "A link people tap" },
  { type: "offer", label: "Offer", icon: Gift, hint: "A highlighted offer, with a code" },
  { type: "divider", label: "Line", icon: Minus, hint: "A thin line between parts" },
  { type: "spacer", label: "Gap", icon: MoveVertical, hint: "Some space" },
];
const kindOf = (t: CampaignBlock["type"]) => KINDS.find(k => k.type === t)!;
const id = () => `b${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export function newBlock(type: CampaignBlock["type"]): CampaignBlock {
  switch (type) {
    case "heading": return { id: id(), type, text: "A new heading", size: "lg", align: "center" };
    case "text": return { id: id(), type, text: "Dear {{first_name|there}},\n\n", align: "left" };
    case "image": return { id: id(), type, src: "", alt: "", width: 100 };
    case "products": return { id: id(), type, columns: 2, items: [] };
    case "button": return { id: id(), type, label: "See the collection", href: "", align: "center" };
    case "offer": return { id: id(), type, title: "10% off this month", text: "On every ready piece.", code: "" };
    case "divider": return { id: id(), type };
    case "spacer": return { id: id(), type, size: 24 };
  }
}

function Field({ label, children, className = "" }: { label: string; children: ReactNode; className?: string }) {
  return <div className={className}><Label className="text-xs">{label}</Label><div className="mt-1">{children}</div></div>;
}
function AlignPick({ value, onChange }: { value?: string; onChange: (v: "left" | "center") => void }) {
  return (
    <Select value={value === "left" ? "left" : "center"} onValueChange={v => onChange(v as "left" | "center")}>
      <SelectTrigger className="h-9 rounded-lg w-28"><SelectValue /></SelectTrigger>
      <SelectContent><SelectItem value="center">Centre</SelectItem><SelectItem value="left">Left</SelectItem></SelectContent>
    </Select>
  );
}

/** Words with a few marks: buttons that wrap the selection in **bold**, *italic* or a [link](…), or add the person's name. */
function RichText({ value, onChange, rows = 5 }: { value: string; onChange: (v: string) => void; rows?: number }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const wrap = (before: string, after: string, fallback: string) => {
    const t = ref.current; if (!t) return;
    const s = t.selectionStart, e = t.selectionEnd, mid = value.slice(s, e) || fallback;
    const next = value.slice(0, s) + before + mid + after + value.slice(e);
    onChange(next);
    requestAnimationFrame(() => { t.focus(); t.setSelectionRange(s + before.length, s + before.length + mid.length); });
  };
  const btn = (I: LucideIcon, label: string, f: () => void) => (
    <button type="button" onClick={f} title={label} aria-label={label} className="h-7 w-7 grid place-items-center rounded-md text-muted-foreground hover:bg-secondary hover:text-foreground"><I className="h-3.5 w-3.5" /></button>
  );
  return (
    <div className="rounded-lg border border-input bg-white focus-within:ring-2 focus-within:ring-primary/20">
      <div className="flex items-center gap-0.5 border-b border-border/70 px-1.5 py-1">
        {btn(Bold, "Bold", () => wrap("**", "**", "bold words"))}
        {btn(Italic, "Italic", () => wrap("*", "*", "words"))}
        {btn(Link2, "Link", () => { const u = window.prompt("The web address (https://…)", "https://"); if (u && /^https?:\/\/\S+$/.test(u)) wrap("[", `](${u})`, "the words"); })}
        <span className="mx-1 h-4 w-px bg-border" />
        <button type="button" onClick={() => wrap("{{first_name|there}}", "", "")} className="h-7 px-2 rounded-md text-[11px] font-medium text-muted-foreground hover:bg-secondary hover:text-foreground inline-flex items-center gap-1"><UserRound className="h-3 w-3" />First name</button>
        <button type="button" onClick={() => wrap("{{company}}", "", "")} className="h-7 px-2 rounded-md text-[11px] font-medium text-muted-foreground hover:bg-secondary hover:text-foreground">Company</button>
      </div>
      <Textarea ref={ref} rows={rows} value={value} onChange={e => onChange(e.target.value)} className="border-0 shadow-none focus-visible:ring-0 rounded-t-none text-sm" />
    </div>
  );
}

function BlockBody({ b, set }: { b: CampaignBlock; set: (b: CampaignBlock) => void }) {
  const [pick, setPick] = useState<"one" | "many" | null>(null);
  const onPick = (p: PickedPiece[]) => {
    if (b.type === "image") set({ ...b, src: p[0]?.src ?? "", alt: b.alt || p[0]?.alt || p[0]?.title || "" });
    if (b.type === "products") set({ ...b, items: [...b.items, ...p.map(x => ({ src: x.src, alt: x.alt, title: x.title, sub: x.sub }))].slice(0, 12) });
  };
  switch (b.type) {
    case "heading":
      return <div className="grid gap-3 sm:grid-cols-[1fr_auto_auto]">
        <Field label="Heading"><Input className="h-9 rounded-lg" value={b.text} maxLength={200} onChange={e => set({ ...b, text: e.target.value })} /></Field>
        <Field label="Size"><Select value={b.size ?? "lg"} onValueChange={v => set({ ...b, size: v as "lg" | "md" })}><SelectTrigger className="h-9 rounded-lg w-28"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="lg">Large</SelectItem><SelectItem value="md">Medium</SelectItem></SelectContent></Select></Field>
        <Field label="Align"><AlignPick value={b.align} onChange={align => set({ ...b, align })} /></Field>
      </div>;
    case "text":
      return <div className="space-y-2"><RichText value={b.text} onChange={text => set({ ...b, text })} />
        <div className="flex items-center justify-between gap-2"><p className="text-[11px] text-muted-foreground">{"{{first_name|there}}"} becomes each person's first name ("there" when it isn't known).</p><AlignPick value={b.align} onChange={align => set({ ...b, align })} /></div></div>;
    case "image":
      return <div className="grid gap-3 sm:grid-cols-[120px_1fr]">
        <button type="button" onClick={() => setPick("one")} className="h-28 rounded-lg border border-dashed border-border bg-secondary/40 overflow-hidden grid place-items-center text-xs text-muted-foreground hover:border-primary/50">
          {b.src ? <img src={b.src} alt="" className="h-full w-full object-cover" /> : <span className="inline-flex flex-col items-center gap-1"><ImageIcon className="h-5 w-5" />Choose</span>}
        </button>
        <div className="grid gap-2.5">
          <Field label="What it shows (read when pictures are off)"><Input className="h-9 rounded-lg" value={b.alt ?? ""} maxLength={200} onChange={e => set({ ...b, alt: e.target.value })} /></Field>
          <div className="grid gap-2.5 sm:grid-cols-[1fr_auto]">
            <Field label="Opens (optional)"><Input className="h-9 rounded-lg" placeholder="https://…" value={b.href ?? ""} onChange={e => set({ ...b, href: e.target.value })} /></Field>
            <Field label="Width"><Select value={String(b.width ?? 100)} onValueChange={v => set({ ...b, width: Number(v) })}><SelectTrigger className="h-9 rounded-lg w-24"><SelectValue /></SelectTrigger><SelectContent>{[100, 80, 60, 40].map(w => <SelectItem key={w} value={String(w)}>{w}%</SelectItem>)}</SelectContent></Select></Field>
          </div>
        </div>
        <ImagePicker open={pick === "one"} onClose={() => setPick(null)} onPick={onPick} />
      </div>;
    case "products":
      return <div className="space-y-2.5">
        {b.items.map((it, i) => (
          <div key={i} className="grid gap-2 grid-cols-[56px_1fr_auto] items-start rounded-lg border border-border/70 p-2">
            {it.src ? <img src={it.src} alt="" className="h-14 w-14 rounded-md object-cover" /> : <div className="h-14 w-14 rounded-md bg-secondary" />}
            <div className="grid gap-1.5 min-w-0">
              <Input className="h-8 rounded-md text-sm" value={it.title} maxLength={80} placeholder="Name" onChange={e => set({ ...b, items: b.items.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)) })} />
              <Input className="h-8 rounded-md text-xs" value={it.sub ?? ""} maxLength={120} placeholder="Details (metal, weight, price…)" onChange={e => set({ ...b, items: b.items.map((x, j) => (j === i ? { ...x, sub: e.target.value } : x)) })} />
              <Input className="h-8 rounded-md text-xs" value={it.href ?? ""} placeholder="Opens (optional) https://…" onChange={e => set({ ...b, items: b.items.map((x, j) => (j === i ? { ...x, href: e.target.value } : x)) })} />
            </div>
            <Button size="icon" variant="ghost" className="h-8 w-8" aria-label="Remove piece" onClick={() => set({ ...b, items: b.items.filter((_, j) => j !== i) })}><Trash2 className="h-4 w-4" /></Button>
          </div>
        ))}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Button size="sm" variant="outline" className="h-8 gap-1.5" onClick={() => setPick("many")}><Plus className="h-3.5 w-3.5" />Add pieces from Ready Stock</Button>
          <Select value={String(b.columns ?? 2)} onValueChange={v => set({ ...b, columns: Number(v) as 2 | 3 })}><SelectTrigger className="h-8 rounded-lg w-32"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="2">2 to a row</SelectItem><SelectItem value="3">3 to a row</SelectItem></SelectContent></Select>
        </div>
        <p className="text-[11px] text-muted-foreground">On a phone they show one under the other.</p>
        <ImagePicker open={pick === "many"} multi onClose={() => setPick(null)} onPick={onPick} />
      </div>;
    case "button":
      return <div className="grid gap-3 sm:grid-cols-[1fr_1.4fr_auto]">
        <Field label="Words on it"><Input className="h-9 rounded-lg" value={b.label} maxLength={60} onChange={e => set({ ...b, label: e.target.value })} /></Field>
        <Field label="Opens"><Input className="h-9 rounded-lg" placeholder="https://… or mailto:…" value={b.href} onChange={e => set({ ...b, href: e.target.value })} /></Field>
        <Field label="Align"><AlignPick value={b.align} onChange={align => set({ ...b, align })} /></Field>
      </div>;
    case "offer":
      return <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Offer"><Input className="h-9 rounded-lg" value={b.title} maxLength={80} onChange={e => set({ ...b, title: e.target.value })} /></Field>
        <Field label="Code (optional)"><Input className="h-9 rounded-lg font-mono uppercase" value={b.code ?? ""} maxLength={30} onChange={e => set({ ...b, code: e.target.value.toUpperCase() })} /></Field>
        <Field label="Details (optional)" className="sm:col-span-2"><Input className="h-9 rounded-lg" value={b.text ?? ""} maxLength={300} onChange={e => set({ ...b, text: e.target.value })} /></Field>
      </div>;
    case "spacer":
      return <Field label="Space"><Select value={String(b.size ?? 24)} onValueChange={v => set({ ...b, size: Number(v) })}><SelectTrigger className="h-9 rounded-lg w-32"><SelectValue /></SelectTrigger><SelectContent>{[12, 24, 40, 64].map(n => <SelectItem key={n} value={String(n)}>{n === 12 ? "Small" : n === 24 ? "Medium" : n === 40 ? "Large" : "Extra large"}</SelectItem>)}</SelectContent></Select></Field>;
    case "divider":
      return <p className="text-xs text-muted-foreground">A thin line across the email.</p>;
  }
}

function Colour({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <Field label={label} className="min-w-0">
      <div className="flex items-center gap-2 min-w-0">
        <input type="color" value={value} onChange={e => onChange(e.target.value)} className="h-9 w-10 shrink-0 rounded-lg border border-input bg-white p-1 cursor-pointer" aria-label={label} />
        <Input className="h-9 min-w-0 w-[6.75rem] rounded-lg font-mono text-xs px-2.5" maxLength={7} aria-label={`${label} (hex)`} value={value} onChange={e => { if (/^#[0-9a-f]{0,6}$/i.test(e.target.value)) onChange(e.target.value); }} />
      </div>
    </Field>
  );
}

export function BlockEditor({ design, onChange }: { design: CampaignDesign; onChange: (d: CampaignDesign) => void }) {
  const [open, setOpen] = useState<string | null>(design.blocks[0]?.id ?? null);
  const blocks = design.blocks;
  const setBlocks = (b: CampaignBlock[]) => onChange({ ...design, blocks: b });
  const setTheme = (t: Partial<CampaignTheme>) => onChange({ ...design, theme: { ...design.theme, ...t } });
  const move = (i: number, d: -1 | 1) => { const j = i + d; if (j < 0 || j >= blocks.length) return; const n = [...blocks]; [n[i], n[j]] = [n[j], n[i]]; setBlocks(n); };
  const add = (t: CampaignBlock["type"], at = blocks.length) => { const b = newBlock(t); const n = [...blocks]; n.splice(at, 0, b); setBlocks(n); setOpen(b.id); };
  const summary = (b: CampaignBlock) => b.type === "heading" || b.type === "text" ? b.text.replace(/\s+/g, " ").slice(0, 70)
    : b.type === "image" ? (b.alt || (b.src ? "Picture" : "No picture yet")) : b.type === "products" ? `${b.items.length} piece${b.items.length === 1 ? "" : "s"}`
    : b.type === "button" ? `${b.label}${b.href ? "" : " — no link yet"}` : b.type === "offer" ? b.title : "";

  return (
    <div className="space-y-4">
      {/* Wraps onto the next line where the column is narrow — never past its edge. */}
      <div className="rounded-xl border border-border bg-white p-3.5 flex flex-wrap items-end gap-x-5 gap-y-3">
        <Colour label="Brand colour" value={design.theme.brand} onChange={brand => setTheme({ brand })} />
        <Colour label="Background" value={design.theme.page} onChange={page => setTheme({ page })} />
        <Colour label="Words" value={design.theme.ink} onChange={ink => setTheme({ ink })} />
        <Field label="Letters" className="w-44"><Select value={design.theme.font} onValueChange={v => setTheme({ font: v as "sans" | "serif" })}><SelectTrigger className="h-9 rounded-lg"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="sans">Clean (Arial)</SelectItem><SelectItem value="serif">Classic (Georgia)</SelectItem></SelectContent></Select></Field>
        <Field label="Logo"><AlignPick value={design.theme.header} onChange={header => setTheme({ header })} /></Field>
      </div>

      {!blocks.length && <div className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">No blocks yet — write it with AI above, or add blocks below.</div>}
      <ol className="space-y-2">
        {blocks.map((b, i) => {
          const k = kindOf(b.type);
          const isOpen = open === b.id;
          return (
            <li key={b.id} className={`rounded-xl border bg-white ${isOpen ? "border-primary/40 shadow-sm" : "border-border"}`}>
              <div className="flex items-center gap-2 px-3 py-2">
                <button type="button" onClick={() => setOpen(isOpen ? null : b.id)} className="flex-1 min-w-0 flex items-center gap-2.5 text-left">
                  <span className="h-7 w-7 rounded-lg bg-primary/10 text-primary grid place-items-center shrink-0"><k.icon className="h-3.5 w-3.5" /></span>
                  <span className="min-w-0"><span className="block text-sm font-medium">{k.label}</span><span className="block text-xs text-muted-foreground truncate">{summary(b)}</span></span>
                </button>
                <Button size="icon" variant="ghost" className="h-8 w-8" aria-label="Move up" disabled={i === 0} onClick={() => move(i, -1)}><ArrowUp className="h-4 w-4" /></Button>
                <Button size="icon" variant="ghost" className="h-8 w-8" aria-label="Move down" disabled={i === blocks.length - 1} onClick={() => move(i, 1)}><ArrowDown className="h-4 w-4" /></Button>
                <MoreMenu size="sm" label="Block actions" actions={[
                  { label: "Copy this block", icon: Copy, onSelect: () => { const n = [...blocks]; const c = { ...structuredClone(b), id: id() }; n.splice(i + 1, 0, c); setBlocks(n); setOpen(c.id); } },
                  ...KINDS.map(x => ({ label: `Add ${x.label.toLowerCase()} below`, icon: x.icon, onSelect: () => add(x.type, i + 1) })),
                  { label: "Remove", icon: Trash2, danger: true, onSelect: () => setBlocks(blocks.filter(x => x.id !== b.id)) },
                ]} />
              </div>
              {isOpen && <div className="border-t border-border/70 px-3 py-3"><BlockBody b={b} set={nb => setBlocks(blocks.map(x => (x.id === b.id ? nb : x)))} /></div>}
            </li>
          );
        })}
      </ol>
      <div className="flex flex-wrap gap-1.5">
        {KINDS.map(k => (
          <Button key={k.type} size="sm" variant="outline" className="h-8 gap-1.5 rounded-lg" title={k.hint} onClick={() => add(k.type)}><k.icon className="h-3.5 w-3.5" />{k.label}</Button>
        ))}
      </div>
    </div>
  );
}
