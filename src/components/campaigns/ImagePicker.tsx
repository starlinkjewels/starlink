// A picture for a campaign email: one uploaded (made smaller first — 1200 px,
// as email programs show it), or pieces from Ready Stock (their own photos,
// already stored). Uploads only ADD a file under campaigns/ — nothing is ever
// replaced or removed. An email shows pictures from https addresses only;
// a stored photo's address is one.
import { useMemo, useRef, useState } from "react";
import { Check, ImagePlus, Search, Upload } from "lucide-react";
import { toast } from "sonner";
import { ActionSheet } from "@/components/ActionSheet";
import { TabBar } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useDb } from "@/hooks/useDb";
import { compressImage } from "@/lib/images";
import { uploadDataUrl } from "@/lib/storage";
import type { ReadyStockItem } from "@/lib/db";

export interface PickedPiece { title: string; sub?: string; src?: string; alt?: string }

/** "14K Rose Gold · 5.2 g · 1.10 ct Lab Grown" — what a card says under a piece's name. */
export function pieceLine(i: ReadyStockItem, withPrice = false): string {
  return [
    [i.productKarats, i.metal].filter(Boolean).join(" "),
    i.grossWeight ? `${Math.round(i.grossWeight * 100) / 100} g` : "",
    i.diamondWeight ? `${Math.round(i.diamondWeight * 100) / 100} ct${i.diamondType ? ` ${i.diamondType}` : ""}` : "",
    withPrice && i.price ? `$${i.price.toLocaleString("en-US")}` : "",
  ].filter(Boolean).join(" · ");
}
const httpsOnly = (u?: string) => (u && /^https:\/\//.test(u) ? u : undefined);

export function ImagePicker({ open, onClose, multi = false, onPick }: {
  open: boolean; onClose: () => void; multi?: boolean;
  onPick: (picked: PickedPiece[]) => void;
}) {
  const db = useDb();
  const [tab, setTab] = useState<"upload" | "stock">("stock");
  const [q, setQ] = useState("");
  const [sel, setSel] = useState<string[]>([]);
  const [price, setPrice] = useState(false);
  const [busy, setBusy] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const items = useMemo(() => {
    const t = q.trim().toLowerCase();
    return (db.readyStock ?? [])
      .filter(i => i.quantity > 0 && httpsOnly(i.images?.[0]))
      .filter(i => !t || `${i.name} ${i.sku ?? ""} ${i.jewelleryType} ${i.metal} ${i.productKarats ?? ""}`.toLowerCase().includes(t))
      .slice(0, 120);
  }, [db.readyStock, q]);

  const upload = async (f: File) => {
    if (!/^image\/(jpeg|png|webp)$/.test(f.type)) { toast.error("A JPG, PNG or WebP picture"); return; }
    setBusy(true);
    try {
      const small = await compressImage(f, 1200, 0.85);
      const url = await uploadDataUrl(small, "campaigns/images");
      onPick([{ title: "", src: url, alt: f.name.replace(/\.[a-z0-9]+$/i, "").replace(/[-_]+/g, " ") }]);
      onClose();
    } catch (e) { toast.error(`Couldn't upload: ${(e as Error).message}`); } finally { setBusy(false); }
  };
  const done = () => {
    const picked = sel.map(id => db.readyStock.find(i => i.id === id)).filter((i): i is ReadyStockItem => !!i)
      .map(i => ({ title: i.name, sub: pieceLine(i, price) || undefined, src: httpsOnly(i.images[0]), alt: i.name }));
    if (!picked.length) { toast.error("Tick a piece"); return; }
    onPick(picked); setSel([]); onClose();
  };

  return (
    <ActionSheet open={open} onOpenChange={o => { if (!o) { setSel([]); onClose(); } }} icon={ImagePlus} size="lg" title={multi ? "Pieces to show" : "Choose a picture"}
      description={multi ? "Pieces from Ready Stock — their photo, name and details" : "From Ready Stock, or upload one"}
      footer={tab === "stock" ? <div className="flex items-center justify-between gap-2">
        <label className="text-xs text-muted-foreground inline-flex items-center gap-2"><input type="checkbox" checked={price} onChange={e => setPrice(e.target.checked)} />Show the price</label>
        <div className="flex gap-2"><Button variant="outline" onClick={onClose}>Cancel</Button><Button onClick={done} disabled={!sel.length}>Use {sel.length || ""}{sel.length === 1 ? " piece" : sel.length ? " pieces" : ""}</Button></div>
      </div> : undefined}>
      <TabBar label="Picture from" value={tab} onChange={setTab} tabs={[{ key: "stock", label: "Ready Stock" }, ...(multi ? [] : [{ key: "upload" as const, label: "Upload" }])]} />
      {tab === "upload" ? (
        <div className="mt-5 rounded-2xl border-2 border-dashed border-border p-10 text-center space-y-3">
          <Upload className="h-8 w-8 mx-auto text-muted-foreground" />
          <p className="text-sm">A JPG or PNG — made 1200 px wide for email, kept as a new file.</p>
          <input ref={file} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={e => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void upload(f); }} />
          <Button onClick={() => file.current?.click()} disabled={busy}>{busy ? "Uploading…" : "Choose a file"}</Button>
        </div>
      ) : (
        <div className="mt-4 space-y-3">
          <div className="relative"><Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input className="pl-9 rounded-xl" placeholder="Search Ready Stock" value={q} onChange={e => setQ(e.target.value)} /></div>
          {!items.length && <p className="text-sm text-muted-foreground py-8 text-center">No pieces in stock with a photo{q ? " match" : ""}.</p>}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
            {items.map(i => {
              const on = sel.includes(i.id);
              return (
                <button key={i.id} type="button" onClick={() => { if (!multi) { setSel([i.id]); return; } setSel(on ? sel.filter(x => x !== i.id) : sel.length >= 12 ? sel : [...sel, i.id]); }}
                  className={`relative text-left rounded-xl border bg-white overflow-hidden transition ${on ? "border-primary ring-2 ring-primary/30" : "border-border hover:border-primary/40"}`}>
                  <img src={i.images[0]} alt={i.name} loading="lazy" className="w-full aspect-square object-cover bg-secondary" />
                  <div className="p-2"><p className="text-xs font-semibold truncate">{i.name}</p><p className="text-[11px] text-muted-foreground truncate">{pieceLine(i, price)}</p></div>
                  {on && <span className="absolute top-2 right-2 h-6 w-6 rounded-full bg-primary text-primary-foreground grid place-items-center"><Check className="h-3.5 w-3.5" /></span>}
                </button>
              );
            })}
          </div>
          {multi && <p className="text-[11px] text-muted-foreground">Up to 12 pieces.</p>}
        </div>
      )}
    </ActionSheet>
  );
}
