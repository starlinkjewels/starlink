import { ListCombo } from "@/components/ListCombo";
import { requestPlayable } from "@/lib/webVideo";
import { ProductVideo } from "@/components/ProductVideo";
import { useRef, useState } from "react";
import { ImagePlus, X, Film, Gem } from "lucide-react";
import { toast } from "sonner";
import { updateDb, uid, fmtMoney, adminStoreReady, stockCostOf, writeStockCost, type ReadyStockItem, type Order } from "@/lib/db";
import { useDb } from "@/hooks/useDb";
import { useAuth } from "@/lib/auth";
import { metalHasKarats, metalOptions } from "@/lib/metals";
import { choicesOf, listOf } from "@/lib/optionLists";
import { uploadDataUrl, uploadFile } from "@/lib/storage";
import { imageForUpload } from "@/lib/images";
import { WeightCheck } from "@/components/WeightCheck";
import { weightProblem } from "@/lib/weights";
import { AsyncButton } from "@/components/AsyncButton";
import { ActionSheet } from "@/components/ActionSheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CompanyPicker } from "@/components/CompanyFields";
import { coField, companyById, companyOf } from "@/lib/companies";
import { officeLabel, officeOf, readyStockOffices } from "@/lib/offices";
import { describeEdit, logItem, whoOf } from "@/lib/readyStockHistory";

const GOLD_PURITIES = ["9K", "14K", "18K", "22K", "24K"];


type ItemForm = {
  name: string;
  jewelleryType: Order["jewelleryType"];
  metal: Order["metal"];
  productKarats: string;
  grossWeight: string;
  netWeight: string;
  diamondWeight: string;
  diamondType: string;
  price: string;
  cost: string;
  quantity: string;
  sku: string;
  /** The office the piece is kept at. */
  location: string;
  notes: string;
  /** Whose Ready Stock the piece is in. */
  companyId: string;
};

// A new item starts on the first of each of the business's lists.
const EMPTY_FORM = (): ItemForm => ({
  name: "", jewelleryType: listOf("jewelleryTypes")[0] ?? "Ring", metal: listOf("metals")[0] ?? "Yellow Gold", productKarats: "22K",
  grossWeight: "", netWeight: "", diamondWeight: "", diamondType: listOf("diamondTypes")[0] ?? "Natural",
  price: "", cost: "", quantity: "1", sku: "", location: "", notes: "", companyId: "main",
});

const METALS_NEED_KARAT = (metal: Order["metal"]): boolean => metalHasKarats(metal);

/**
 * Add a Ready Stock piece, or edit one — the same form on the Ready Stock
 * list and on a piece's own page. Shown while mounted; `onClose` unmounts it.
 * Every save also writes a line to the piece's history (what changed, by whom).
 * A panel from the right, so the list or the piece's page stays put behind it.
 */
export function ReadyStockItemDialog({ item, defaults, onClose, onSaved }: {
  /** The piece being edited; none = adding a new one. */
  item?: ReadyStockItem;
  /** A new piece's office and company — where it is being looked at. */
  defaults?: { location?: string; companyId?: string };
  onClose: () => void;
  onSaved?: (itemId: string) => void;
}) {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin"; // cost is admin-only
  const db = useDb();
  const editingId = item?.id ?? null;
  const [f, setF] = useState<ItemForm>(() => item ? {
    name: item.name, jewelleryType: item.jewelleryType, metal: item.metal,
    productKarats: item.productKarats || "22K",
    grossWeight: item.grossWeight ? String(item.grossWeight) : "",
    netWeight: item.netWeight ? String(item.netWeight) : "",
    diamondWeight: item.diamondWeight ? String(item.diamondWeight) : "",
    diamondType: item.diamondType || (listOf("diamondTypes")[0] ?? "Natural"),
    price: String(item.price), cost: stockCostOf(db, item) != null ? String(stockCostOf(db, item)) : "", quantity: String(item.quantity),
    sku: item.sku || "", location: officeOf(item), notes: item.notes || "", companyId: companyOf(item),
  } : { ...EMPTY_FORM(), location: defaults?.location ?? "", companyId: defaults?.companyId ?? "main" });
  const [images, setImages] = useState<string[]>(() => item?.images || []); // existing URLs + new data-urls, mixed until save
  // Video: `video` holds either the existing https URL or a blob: preview URL;
  // `videoFile` holds a freshly-picked File (uploaded raw on save).
  const [video, setVideo] = useState<string>(() => item?.video || "");
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const imgRef = useRef<HTMLInputElement>(null);
  const vidRef = useRef<HTMLInputElement>(null);
  const offices = readyStockOffices(db.settings);

  const handleImageFiles = async (files: FileList | null) => {
    if (!files) return;
    const remaining = 4 - images.length;
    if (remaining <= 0) { toast.error("Maximum 4 images allowed"); return; }
    const toProcess = Array.from(files).slice(0, remaining);
    try {
      // As picked — full size and sharpness (lib/images.ts).
      const compressed = await Promise.all(toProcess.map(imageForUpload));
      setImages(prev => [...prev, ...compressed].slice(0, 4));
    } catch { toast.error("Failed to process image"); }
  };
  const removeImage = (idx: number) => setImages(prev => prev.filter((_, i) => i !== idx));

  const handleVideoFile = async (files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;
    if (!file.type.startsWith("video/")) { toast.error("Please choose a video file"); return; }
    if (file.size > 500 * 1024 * 1024) { toast.error("Video is too large — keep it under 500 MB"); return; }
    if (video.startsWith("blob:")) URL.revokeObjectURL(video);
    setVideoFile(file);
    setVideo(URL.createObjectURL(file));
  };
  const removeVideo = () => {
    if (video.startsWith("blob:")) URL.revokeObjectURL(video);
    setVideo(""); setVideoFile(null);
  };

  const save = async () => {
    if (!f.name.trim()) { toast.error("Enter an item name"); return; }
    const price = Number(f.price);
    if (!price || price <= 0) { toast.error("Enter a valid price"); return; }
    if (!f.location) { toast.error("Choose the office the piece is kept at"); return; }
    const quantity = Math.max(0, Math.round(Number(f.quantity) || 0));
    const wp = weightProblem({ gross: Number(f.grossWeight), net: Number(f.netWeight), diamondCt: Number(f.diamondWeight) });
    if (wp) { toast.error(wp); return; }
    setSaving(true);
    try {
      const itemId = editingId || uid("rs_");
      const imageUrls = await Promise.all(images.map(img => uploadDataUrl(img, `readyStock/${itemId}`)));
      // Upload a freshly-picked video (raw file); keep an existing URL as-is; else none.
      const videoUrl = videoFile
        ? await uploadFile(videoFile, `readyStock/${itemId}`)
        : (/^https?:\/\//i.test(video) ? video : undefined);
      // A copy every browser and device plays — made on the server (lib/webVideo.ts).
      if (videoFile && videoUrl) requestPlayable(videoUrl);
      updateDb(d => {
        if (!d.readyStock) d.readyStock = [];
        const prev = editingId ? d.readyStock.find(x => x.id === editingId) : undefined;
        // What it cost before this save — read before it is written, for the history line.
        const costBefore = prev && isAdmin ? stockCostOf(d, prev) : undefined;
        const base: ReadyStockItem = {
          id: itemId,
          name: f.name.trim(),
          jewelleryType: f.jewelleryType,
          metal: f.metal,
          productKarats: METALS_NEED_KARAT(f.metal) ? f.productKarats : undefined,
          grossWeight: Number(f.grossWeight) || undefined,
          netWeight: Number(f.netWeight) || undefined,
          diamondWeight: Number(f.diamondWeight) || undefined,
          diamondType: Number(f.diamondWeight) > 0 ? f.diamondType : undefined,
          price, quantity,
          // Cost is admin-only, and once moved it is not on the item at all —
          // it is written below, where only the admin can read it. Until then
          // it stays here, and a non-admin edit must never wipe it.
          cost: adminStoreReady() ? undefined : prev?.cost,
          images: imageUrls,
          video: videoUrl,
          sku: f.sku.trim() || undefined,
          location: f.location || undefined,
          notes: f.notes.trim() || undefined,
          ...coField(f.companyId),
          // A piece sent back by a client keeps its link to that order — its cost comes from it.
          ...(prev?.fromReturn ? { fromReturn: prev.fromReturn } : {}),
          // …and a lot split off at another office keeps its family.
          ...(prev?.splitFrom ? { splitFrom: prev.splitFrom } : {}),
          // …and its history, which this save adds a line to.
          ...(prev?.history ? { history: [...prev.history] } : {}),
          createdBy: prev ? prev.createdBy : user!.id,
          createdAt: prev ? prev.createdAt : new Date().toISOString(),
        };
        const who = whoOf(user);
        if (!prev) {
          logItem(base, { ...who, at: base.createdAt, kind: "added", text: `Added to Ready Stock at the ${officeLabel(f.location)} — ${quantity} piece${quantity !== 1 ? "s" : ""} at ${fmtMoney(price)}` });
        } else {
          const change = describeEdit(prev, base, { companyName: id => companyById(d.settings, id).name });
          if (change) logItem(base, { ...who, ...change });
          // Only that it changed — the figure stays where only the admin can read it.
          const costAfter = Number(f.cost) > 0 ? Number(f.cost) : undefined;
          if (isAdmin && (costBefore ?? 0) !== (costAfter ?? 0)) logItem(base, { ...who, kind: "cost", text: "Cost changed" });
        }
        if (editingId) {
          const idx = d.readyStock.findIndex(x => x.id === editingId);
          if (idx >= 0) d.readyStock[idx] = base;
        } else {
          d.readyStock.unshift(base);
        }
        if (isAdmin) writeStockCost(d, base.id, Number(f.cost) > 0 ? Number(f.cost) : undefined);
      });
      toast.success(editingId ? "Item updated" : `Added to Ready Stock at the ${officeLabel(f.location)}`);
      onSaved?.(itemId);
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to save item");
    } finally { setSaving(false); }
  };

  const qty = Math.max(0, Math.round(Number(f.quantity) || 0));
  const sectionHead = "col-span-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground";

  return (
    <ActionSheet
      open
      onOpenChange={o => { if (!o) onClose(); }}
      title={editingId ? "Edit Item" : "Add Ready Stock Item"}
      description={editingId ? "Every change is written to this piece's history." : "A finished piece, ready to sell from one of the offices."}
      icon={Gem}
      size="lg"
      footer={
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          {/* What the save puts on the shelf — the same figures it writes. */}
          <div className="min-w-0">
            <p className="text-sm font-semibold text-brand-dark tabular-nums truncate">
              {qty} piece{qty !== 1 ? "s" : ""}{Number(f.price) > 0 ? ` · ${fmtMoney(Number(f.price))} each` : ""}
            </p>
            <p className="text-[11px] text-muted-foreground truncate">{f.location ? `At the ${officeLabel(f.location)}` : "Choose the office it is kept at"}</p>
          </div>
          <div className="flex gap-2 sm:shrink-0">
            <Button variant="outline" onClick={onClose} className="rounded-xl flex-1 sm:flex-none">Cancel</Button>
            <AsyncButton onClick={save} disabled={saving} className="btn-hero rounded-xl px-6 flex-1 sm:flex-none">{saving ? "Saving…" : editingId ? "Save Changes" : "Add to Ready Stock"}</AsyncButton>
          </div>
        </div>
      }
    >
      <div className="space-y-6">
        {/* Photos and video first — they are what a piece is recognised by. */}
        <section className="space-y-3">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Photos & video</p>
            <p className="text-[11px] text-muted-foreground">Up to 4 photos and 1 short video.</p>
          </div>
          <div className="grid grid-cols-4 gap-2 sm:gap-3">
            {images.map((src, i) => (
              <div key={i} className="relative group aspect-square rounded-xl overflow-hidden border border-border">
                <img src={src} alt={`Photo ${i + 1}`} className="w-full h-full object-cover" />
                <button type="button" onClick={() => removeImage(i)}
                  className="absolute top-1 right-1 h-7 w-7 rounded-full bg-destructive text-white grid place-items-center shadow-md opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
            {images.length < 4 && (
              <button type="button" onClick={() => imgRef.current?.click()}
                className="aspect-square rounded-xl border-2 border-dashed border-border hover:border-primary/50 hover:bg-primary/5 transition-colors flex flex-col items-center justify-center gap-1.5 text-muted-foreground">
                <ImagePlus className="h-6 w-6" />
                <span className="text-xs font-medium">{images.length === 0 ? "Add Photo" : "Add More"}</span>
              </button>
            )}
          </div>
          <input ref={imgRef} type="file" accept="image/*" multiple className="hidden" onChange={e => handleImageFiles(e.target.files)} />

          {/* Product video (optional, 1) */}
          <div>
            {video ? (
              <div className="relative rounded-xl overflow-hidden border border-border bg-black">
                <ProductVideo src={video} maxH="max-h-56" className="rounded-none" />
                <button type="button" onClick={removeVideo}
                  className="absolute top-2 right-2 h-7 w-7 rounded-full bg-destructive text-white grid place-items-center shadow-md">
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ) : (
              <button type="button" onClick={() => vidRef.current?.click()}
                className="w-full h-14 rounded-xl border-2 border-dashed border-border hover:border-primary/50 hover:bg-primary/5 transition-colors flex items-center justify-center gap-2 text-muted-foreground">
                <Film className="h-5 w-5" />
                <span className="text-xs font-medium">Add Video (optional)</span>
              </button>
            )}
            <input ref={vidRef} type="file" accept="video/*" className="hidden" onChange={e => handleVideoFile(e.target.files)} />
          </div>
        </section>

        {/* Two columns at every width — the pairs are short, and a phone had them side by side before too.
            items-end keeps the boxes level when one label wraps onto a second line. */}
        <section className="grid grid-cols-2 gap-x-3 gap-y-4 items-end">
          <p className={sectionHead}>The piece</p>
          <div className="col-span-2">
            <Label className="text-xs">Item Name</Label>
            <Input value={f.name} onChange={e => setF({ ...f, name: e.target.value })} className="rounded-xl mt-1" placeholder="Solitaire Diamond Ring" />
          </div>
          <div>
            <Label className="text-xs">Jewellery Type</Label>
            <ListCombo list="jewelleryTypes" value={f.jewelleryType} onChange={v => setF({ ...f, jewelleryType: v as Order["jewelleryType"] })}
              choices={choicesOf("jewelleryTypes", undefined, db.settings, { builtIn: false })} optional={false} className="rounded-xl mt-1 h-9" ariaLabel="Jewellery Type" />
          </div>
          <div>
            <Label className="text-xs">Metal</Label>
            <Select value={f.metal} onValueChange={v => setF({ ...f, metal: v as Order["metal"] })}>
              <SelectTrigger className="rounded-xl mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>{metalOptions(f.metal, db.settings).map(m => <SelectItem key={m} value={m}>{m}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          {METALS_NEED_KARAT(f.metal) && (
            <div>
              <Label className="text-xs">Karats</Label>
              <Select value={f.productKarats} onValueChange={v => setF({ ...f, productKarats: v })}>
                <SelectTrigger className="rounded-xl mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>{GOLD_PURITIES.map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          )}
          <div>
            <Label className="text-xs">SKU / Design # (optional)</Label>
            <Input value={f.sku} onChange={e => setF({ ...f, sku: e.target.value })} className="rounded-xl mt-1" />
          </div>
        </section>

        <section className="grid grid-cols-2 gap-x-3 gap-y-4 items-end">
          <p className={sectionHead}>Weight</p>
          <div>
            <Label className="text-xs">Gross Weight (g)</Label>
            <Input type="number" min={0} step="0.001" value={f.grossWeight} onChange={e => setF({ ...f, grossWeight: e.target.value })} className="rounded-xl mt-1" />
          </div>
          <div>
            <Label className="text-xs">Net Weight (g)</Label>
            <Input type="number" min={0} step="0.001" value={f.netWeight} onChange={e => setF({ ...f, netWeight: e.target.value })} className="rounded-xl mt-1" />
          </div>
          <div>
            <Label className="text-xs">Diamond Weight (ct, optional)</Label>
            <Input type="number" min={0} step="0.01" value={f.diamondWeight} onChange={e => setF({ ...f, diamondWeight: e.target.value })} className="rounded-xl mt-1" />
          </div>
          {Number(f.diamondWeight) > 0 && (
            <div>
              <Label className="text-xs">Diamond Type</Label>
              <ListCombo list="diamondTypes" value={f.diamondType} onChange={v => setF({ ...f, diamondType: v })} optional={false} className="rounded-xl mt-1 h-9" ariaLabel="Diamond Type" />
            </div>
          )}
          <WeightCheck className="col-span-2" gross={Number(f.grossWeight)} net={Number(f.netWeight)} diamondCt={Number(f.diamondWeight)} />
        </section>

        <section className="grid grid-cols-2 gap-x-3 gap-y-4 items-start">
          <p className={sectionHead}>Price & stock</p>
          <div>
            <Label className="text-xs">Price ($)</Label>
            <Input type="number" min={0} value={f.price} onChange={e => setF({ ...f, price: e.target.value })} className="rounded-xl mt-1" />
          </div>
          <div>
            <Label className="text-xs">Quantity Available</Label>
            <Input type="number" min={0} value={f.quantity} onChange={e => setF({ ...f, quantity: e.target.value })} className="rounded-xl mt-1" />
          </div>
          {/* Cost — admin only, drives profit/loss; never shown to employees or clients */}
          {isAdmin && (
            <div className="col-span-2 sm:col-span-1">
              <Label className="text-xs">Cost ($) — internal, admin only</Label>
              <Input type="number" min={0} value={f.cost} onChange={e => setF({ ...f, cost: e.target.value })} className="rounded-xl mt-1" placeholder="Your cost — for profit/loss" />
              {Number(f.cost) > 0 && Number(f.price) > 0 && (
                <p className={`text-[11px] mt-1 font-medium ${Number(f.price) - Number(f.cost) >= 0 ? "text-success" : "text-destructive"}`}>
                  {Number(f.price) - Number(f.cost) >= 0 ? "Profit" : "Loss"} {fmtMoney(Math.abs(Number(f.price) - Number(f.cost)))} per piece
                </p>
              )}
            </div>
          )}
        </section>

        <section className="grid grid-cols-2 gap-x-3 gap-y-4 items-start">
          <p className={sectionHead}>Where it is kept</p>
          <div className="col-span-2 sm:col-span-1">
            <Label className="text-xs">Office — where it is kept</Label>
            <Select value={f.location} onValueChange={v => setF({ ...f, location: v })}>
              <SelectTrigger aria-label="Office" className="rounded-xl mt-1"><SelectValue placeholder="Choose the office" /></SelectTrigger>
              <SelectContent>{[...offices, ...(f.location && !offices.includes(f.location) ? [f.location] : [])].map(l => <SelectItem key={l} value={l}>{officeLabel(l)}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          {/* Empty (and hidden) while there is only the one company. */}
          <div className="col-span-2 sm:col-span-1 empty:hidden">
            <CompanyPicker value={f.companyId} onChange={v => setF({ ...f, companyId: v })} label="Company — whose Ready Stock it is" className="rounded-xl" />
          </div>
          <div className="col-span-2">
            <Label className="text-xs">Notes (optional)</Label>
            <Textarea value={f.notes} onChange={e => setF({ ...f, notes: e.target.value })} className="rounded-xl mt-1" rows={2} />
          </div>
        </section>
      </div>
    </ActionSheet>
  );
}
