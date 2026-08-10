import { useRef, useState } from "react";
import { updateDb, uid, fmtDate, fmtMoney, READY_STOCK_LOCATIONS, type ReadyStockItem, type Order } from "@/lib/db";
import { useDb } from "@/hooks/useDb";
import { useAuth } from "@/lib/auth";
import { uploadDataUrl } from "@/lib/storage";
import { Button } from "@/components/ui/button";
import { AsyncButton } from "@/components/AsyncButton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { usePagination } from "@/hooks/usePagination";
import { PaginationBar } from "@/components/PaginationBar";
import { Plus, Search, Trash2, Gem, ImagePlus, X, Minus, Pencil, MapPin, Rows3, LayoutGrid } from "lucide-react";
import { toast } from "sonner";

const JEWELLERY_TYPES: Order["jewelleryType"][] = ["Ring", "Ring + Band", "Pendant", "Necklace", "Bracelet", "Earrings", "Custom"];
const METALS: Order["metal"][] = ["Gold", "White Gold", "Rose Gold", "Platinum", "Silver", "Two Tone Casting"];
const GOLD_PURITIES = ["9K", "14K", "18K", "22K", "24K"];
const PAGE_SIZE = 12;

/** Compress a File to a base64 JPEG ≤800px — same convention as NewOrder.tsx/OrderDetail.tsx. */
async function compressImage(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = e => {
      const img = new Image();
      img.onerror = reject;
      img.onload = () => {
        const MAX = 800;
        let w = img.width, h = img.height;
        if (w > MAX || h > MAX) {
          if (w > h) { h = Math.round(h * MAX / w); w = MAX; }
          else       { w = Math.round(w * MAX / h); h = MAX; }
        }
        const canvas = document.createElement("canvas");
        canvas.width = w; canvas.height = h;
        canvas.getContext("2d")!.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL("image/jpeg", 0.75));
      };
      img.src = e.target?.result as string;
    };
    reader.readAsDataURL(file);
  });
}

type ItemForm = {
  name: string;
  jewelleryType: Order["jewelleryType"];
  metal: Order["metal"];
  productKarats: string;
  grossWeight: string;
  netWeight: string;
  diamondWeight: string;
  diamondType: "Natural" | "Lab Grown";
  price: string;
  cost: string;
  quantity: string;
  sku: string;
  location: string;
  notes: string;
};

const EMPTY_FORM: ItemForm = {
  name: "", jewelleryType: "Ring", metal: "Gold", productKarats: "22K",
  grossWeight: "", netWeight: "", diamondWeight: "", diamondType: "Natural",
  price: "", cost: "", quantity: "1", sku: "", location: "US", notes: "",
};

export function ReadyStockPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin"; // cost + profit/loss are admin-only
  const canManage = user?.role === "admin" || user?.role === "employee"; // clients get a read-only shop view
  const db = useDb();
  const [q, setQ] = useState("");
  const [avail, setAvail] = useState<"all" | "available" | "sold">("all"); // stock availability filter
  const [view, setView] = useState<"list" | "grid">(() => {
    try { return (localStorage.getItem("readystock-view") as "list" | "grid") || "grid"; } catch { return "grid"; }
  });
  const saveView = (v: "list" | "grid") => { setView(v); try { localStorage.setItem("readystock-view", v); } catch { /* ignore */ } };

  const items = db.readyStock
    .filter(i => i.name.toLowerCase().includes(q.toLowerCase()) || (i.sku || "").toLowerCase().includes(q.toLowerCase()))
    .filter(i => avail === "all" ? true : avail === "available" ? i.quantity > 0 : i.quantity === 0)
    .sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));
  const { paged, page, setPage, totalPages, total, start, end } = usePagination(items, PAGE_SIZE);

  // ── Add / Edit dialog ──
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [f, setF] = useState<ItemForm>(EMPTY_FORM);
  const [images, setImages] = useState<string[]>([]); // existing URLs + new data-urls, mixed until save
  const [saving, setSaving] = useState(false);
  const imgRef = useRef<HTMLInputElement>(null);

  const openAdd = () => { setEditingId(null); setF(EMPTY_FORM); setImages([]); setOpen(true); };
  const openEdit = (item: ReadyStockItem) => {
    setEditingId(item.id);
    setF({
      name: item.name, jewelleryType: item.jewelleryType, metal: item.metal,
      productKarats: item.productKarats || "22K",
      grossWeight: item.grossWeight ? String(item.grossWeight) : "",
      netWeight: item.netWeight ? String(item.netWeight) : "",
      diamondWeight: item.diamondWeight ? String(item.diamondWeight) : "",
      diamondType: item.diamondType || "Natural",
      price: String(item.price), cost: item.cost != null ? String(item.cost) : "", quantity: String(item.quantity),
      sku: item.sku || "", location: item.location || "US", notes: item.notes || "",
    });
    setImages(item.images || []);
    setOpen(true);
  };

  const handleImageFiles = async (files: FileList | null) => {
    if (!files) return;
    const remaining = 3 - images.length;
    if (remaining <= 0) { toast.error("Maximum 3 images allowed"); return; }
    const toProcess = Array.from(files).slice(0, remaining);
    try {
      const compressed = await Promise.all(toProcess.map(compressImage));
      setImages(prev => [...prev, ...compressed].slice(0, 3));
    } catch { toast.error("Failed to process image"); }
  };
  const removeImage = (idx: number) => setImages(prev => prev.filter((_, i) => i !== idx));

  const save = async () => {
    if (!f.name.trim()) { toast.error("Enter an item name"); return; }
    const price = Number(f.price);
    if (!price || price <= 0) { toast.error("Enter a valid price"); return; }
    const quantity = Math.max(0, Math.round(Number(f.quantity) || 0));
    setSaving(true);
    try {
      const itemId = editingId || uid("rs_");
      const imageUrls = await Promise.all(images.map(img => uploadDataUrl(img, `readyStock/${itemId}`)));
      updateDb(d => {
        if (!d.readyStock) d.readyStock = [];
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
          // Cost is admin-only. A non-admin edit must never wipe an existing cost.
          cost: isAdmin ? (Number(f.cost) > 0 ? Number(f.cost) : undefined) : (editingId ? d.readyStock.find(x => x.id === editingId)?.cost : undefined),
          images: imageUrls,
          sku: f.sku.trim() || undefined,
          location: f.location || undefined,
          notes: f.notes.trim() || undefined,
          createdBy: editingId ? d.readyStock.find(x => x.id === editingId)!.createdBy : user!.id,
          createdAt: editingId ? d.readyStock.find(x => x.id === editingId)!.createdAt : new Date().toISOString(),
        };
        if (editingId) {
          const idx = d.readyStock.findIndex(x => x.id === editingId);
          if (idx >= 0) d.readyStock[idx] = base;
        } else {
          d.readyStock.unshift(base);
        }
      });
      toast.success(editingId ? "Item updated" : "Item added to ready stock");
      setOpen(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to save item");
    } finally { setSaving(false); }
  };

  const adjustQty = (item: ReadyStockItem, delta: number) => {
    updateDb(d => {
      const it = d.readyStock.find(x => x.id === item.id);
      if (it) it.quantity = Math.max(0, it.quantity + delta);
    });
  };

  const del = (item: ReadyStockItem) => {
    if (!confirm(`Delete "${item.name}" from ready stock? This cannot be undone.`)) return;
    updateDb(d => { d.readyStock = d.readyStock.filter(x => x.id !== item.id); });
    toast.success("Deleted");
  };

  return (
    <div className="max-w-7xl mx-auto space-y-5">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="font-display text-2xl md:text-3xl text-brand-dark">Ready Stock</h1>
          <p className="text-sm text-muted-foreground">{canManage ? "Finished jewelry available to sell directly" : "Finished jewelry available to buy"} — {total} item{total !== 1 ? "s" : ""}</p>
        </div>
        {canManage && (
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button onClick={openAdd} className="btn-hero h-11 rounded-xl"><Plus className="h-4 w-4 mr-2" />Add Item</Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl rounded-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader><DialogTitle className="font-display text-2xl">{editingId ? "Edit Item" : "Add Ready Stock Item"}</DialogTitle></DialogHeader>
            <div className="space-y-3 mt-2">
              <div className="grid grid-cols-3 gap-3">
                {images.map((src, i) => (
                  <div key={i} className="relative group aspect-square rounded-xl overflow-hidden border border-border">
                    <img src={src} alt={`Photo ${i + 1}`} className="w-full h-full object-cover" />
                    <button type="button" onClick={() => removeImage(i)}
                      className="absolute top-1 right-1 h-7 w-7 rounded-full bg-destructive text-white grid place-items-center shadow-md opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
                {images.length < 3 && (
                  <button type="button" onClick={() => imgRef.current?.click()}
                    className="aspect-square rounded-xl border-2 border-dashed border-border hover:border-primary/50 hover:bg-primary/5 transition-colors flex flex-col items-center justify-center gap-1.5 text-muted-foreground">
                    <ImagePlus className="h-6 w-6" />
                    <span className="text-xs font-medium">{images.length === 0 ? "Add Photo" : "Add More"}</span>
                  </button>
                )}
              </div>
              <input ref={imgRef} type="file" accept="image/*" multiple className="hidden" onChange={e => handleImageFiles(e.target.files)} />

              <div>
                <Label className="text-xs">Item Name</Label>
                <Input value={f.name} onChange={e => setF({ ...f, name: e.target.value })} className="rounded-xl mt-1" placeholder="Solitaire Diamond Ring" />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">Jewellery Type</Label>
                  <Select value={f.jewelleryType} onValueChange={v => setF({ ...f, jewelleryType: v as Order["jewelleryType"] })}>
                    <SelectTrigger className="rounded-xl mt-1"><SelectValue /></SelectTrigger>
                    <SelectContent>{JEWELLERY_TYPES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs">Metal</Label>
                  <Select value={f.metal} onValueChange={v => setF({ ...f, metal: v as Order["metal"] })}>
                    <SelectTrigger className="rounded-xl mt-1"><SelectValue /></SelectTrigger>
                    <SelectContent>{METALS.map(m => <SelectItem key={m} value={m}>{m}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
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

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">Gross Weight (g)</Label>
                  <Input type="number" min={0} value={f.grossWeight} onChange={e => setF({ ...f, grossWeight: e.target.value })} className="rounded-xl mt-1" />
                </div>
                <div>
                  <Label className="text-xs">Net Weight (g)</Label>
                  <Input type="number" min={0} value={f.netWeight} onChange={e => setF({ ...f, netWeight: e.target.value })} className="rounded-xl mt-1" />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">Diamond Weight (ct, optional)</Label>
                  <Input type="number" min={0} step="0.01" value={f.diamondWeight} onChange={e => setF({ ...f, diamondWeight: e.target.value })} className="rounded-xl mt-1" />
                </div>
                {Number(f.diamondWeight) > 0 && (
                  <div>
                    <Label className="text-xs">Diamond Type</Label>
                    <Select value={f.diamondType} onValueChange={v => setF({ ...f, diamondType: v as "Natural" | "Lab Grown" })}>
                      <SelectTrigger className="rounded-xl mt-1"><SelectValue /></SelectTrigger>
                      <SelectContent><SelectItem value="Natural">Natural</SelectItem><SelectItem value="Lab Grown">Lab Grown</SelectItem></SelectContent>
                    </Select>
                  </div>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">Price ($)</Label>
                  <Input type="number" min={0} value={f.price} onChange={e => setF({ ...f, price: e.target.value })} className="rounded-xl mt-1" />
                </div>
                <div>
                  <Label className="text-xs">Quantity Available</Label>
                  <Input type="number" min={0} value={f.quantity} onChange={e => setF({ ...f, quantity: e.target.value })} className="rounded-xl mt-1" />
                </div>
              </div>

              {/* Cost — admin only, drives profit/loss; never shown to employees or clients */}
              {isAdmin && (
                <div>
                  <Label className="text-xs">Cost ($) — internal, admin only</Label>
                  <Input type="number" min={0} value={f.cost} onChange={e => setF({ ...f, cost: e.target.value })} className="rounded-xl mt-1" placeholder="Your cost — for profit/loss" />
                  {Number(f.cost) > 0 && Number(f.price) > 0 && (
                    <p className={`text-[11px] mt-1 font-medium ${Number(f.price) - Number(f.cost) >= 0 ? "text-success" : "text-destructive"}`}>
                      {Number(f.price) - Number(f.cost) >= 0 ? "Profit" : "Loss"} {fmtMoney(Math.abs(Number(f.price) - Number(f.cost)))} per piece
                    </p>
                  )}
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">SKU / Design # (optional)</Label>
                  <Input value={f.sku} onChange={e => setF({ ...f, sku: e.target.value })} className="rounded-xl mt-1" />
                </div>
                <div>
                  <Label className="text-xs">Stock Location</Label>
                  <Select value={f.location} onValueChange={v => setF({ ...f, location: v })}>
                    <SelectTrigger className="rounded-xl mt-1"><SelectValue /></SelectTrigger>
                    <SelectContent>{READY_STOCK_LOCATIONS.map(l => <SelectItem key={l} value={l}>{l}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              </div>
              <div>
                <Label className="text-xs">Notes (optional)</Label>
                <Textarea value={f.notes} onChange={e => setF({ ...f, notes: e.target.value })} className="rounded-xl mt-1" rows={2} />
              </div>

              <AsyncButton onClick={save} disabled={saving} className="btn-hero rounded-xl w-full">{saving ? "Saving…" : editingId ? "Save Changes" : "Add to Ready Stock"}</AsyncButton>
            </div>
          </DialogContent>
        </Dialog>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[160px] sm:w-64 sm:flex-none">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input value={q} onChange={e => setQ(e.target.value)} placeholder="Search by name or SKU..." className="pl-9 h-11 rounded-xl" />
        </div>
        <Select value={avail} onValueChange={v => setAvail(v as "all" | "available" | "sold")}>
          <SelectTrigger className="flex-1 sm:flex-none sm:w-44 h-11 rounded-xl"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All items</SelectItem>
            <SelectItem value="available">Available</SelectItem>
            <SelectItem value="sold">Sold out</SelectItem>
          </SelectContent>
        </Select>
        <div className="shrink-0 ml-auto inline-flex items-center gap-0.5 p-0.5 rounded-lg bg-secondary border border-border/60">
          <button onClick={() => saveView("list")} aria-label="List view"
            className={`flex items-center gap-1 h-8 px-2 rounded-md text-xs font-medium transition-colors ${view === "list" ? "bg-white text-brand-dark shadow-soft" : "text-muted-foreground hover:text-foreground"}`}>
            <Rows3 className="h-3.5 w-3.5" /><span className="hidden sm:inline">List</span>
          </button>
          <button onClick={() => saveView("grid")} aria-label="Grid view"
            className={`flex items-center gap-1 h-8 px-2 rounded-md text-xs font-medium transition-colors ${view === "grid" ? "bg-white text-brand-dark shadow-soft" : "text-muted-foreground hover:text-foreground"}`}>
            <LayoutGrid className="h-3.5 w-3.5" /><span className="hidden sm:inline">Grid</span>
          </button>
        </div>
      </div>

      {view === "grid" && (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {paged.map(item => (
          <div key={item.id} className="card-luxe card-hover overflow-hidden flex flex-col">
            <div className="aspect-square bg-secondary relative">
              {item.images?.[0] ? (
                <img src={item.images[0]} alt={item.name} className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full grid place-items-center text-muted-foreground/40"><Gem className="h-12 w-12" /></div>
              )}
              {item.quantity === 0 && (
                <div className="absolute inset-0 bg-black/50 grid place-items-center">
                  <span className="text-white font-semibold text-sm tracking-wide">SOLD OUT</span>
                </div>
              )}
              {canManage && (
                <button onClick={() => openEdit(item)} className="absolute top-2 right-2 h-8 w-8 rounded-lg bg-white/90 hover:bg-white grid place-items-center text-muted-foreground hover:text-primary transition-colors shadow-sm">
                  <Pencil className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
            <div className="p-4 flex-1 flex flex-col">
              <p className="font-display text-lg text-brand-dark truncate leading-tight">{item.name}</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {item.jewelleryType} · {item.metal}{item.productKarats ? ` ${item.productKarats}` : ""}
                {item.diamondWeight ? ` · ${item.diamondWeight}ct ${item.diamondType || "diamond"}` : ""}
              </p>
              {(item.grossWeight || item.netWeight) && (
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  {item.grossWeight ? `Gross ${item.grossWeight}g` : ""}
                  {item.grossWeight && item.netWeight ? " · " : ""}
                  {item.netWeight ? `Net ${item.netWeight}g` : ""}
                </p>
              )}
              {item.sku && <p className="text-[11px] text-muted-foreground mt-0.5 font-mono">Design #{item.sku}</p>}
              {item.location && (
                <span className="inline-flex items-center gap-1 mt-1 self-start text-[10px] font-semibold px-2 py-0.5 rounded-full bg-primary/10 text-primary">
                  <MapPin className="h-2.5 w-2.5" /> {item.location}
                </span>
              )}
              <div className="flex items-center justify-between mt-3">
                <p className="font-display text-xl font-bold text-brand-dark">{fmtMoney(item.price)}</p>
                {canManage ? (
                  <div className="flex items-center gap-1.5">
                    <button onClick={() => adjustQty(item, -1)} disabled={item.quantity === 0} className="h-7 w-7 rounded-lg border border-border grid place-items-center hover:bg-secondary disabled:opacity-30 transition-colors"><Minus className="h-3 w-3" /></button>
                    <span className="text-sm font-semibold w-6 text-center">{item.quantity}</span>
                    <button onClick={() => adjustQty(item, 1)} className="h-7 w-7 rounded-lg border border-border grid place-items-center hover:bg-secondary transition-colors"><Plus className="h-3 w-3" /></button>
                  </div>
                ) : (
                  <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${item.quantity > 0 ? "bg-success/10 text-success" : "bg-destructive/10 text-destructive"}`}>
                    {item.quantity > 0 ? "In stock" : "Sold out"}
                  </span>
                )}
              </div>
              {isAdmin && item.cost != null && (
                <p className="text-[11px] mt-1.5">
                  <span className="text-muted-foreground">Cost {fmtMoney(item.cost)}</span>
                  {" · "}
                  <span className={`font-semibold ${item.price - item.cost >= 0 ? "text-success" : "text-destructive"}`}>
                    {item.price - item.cost >= 0 ? "Profit" : "Loss"} {fmtMoney(Math.abs(item.price - item.cost))}
                  </span>
                </p>
              )}
              <p className="text-[11px] text-muted-foreground mt-2">Added {fmtDate(item.createdAt)}</p>
              {canManage && (
                <div className="mt-3 pt-3 border-t border-border/50">
                  <AsyncButton size="sm" variant="outline" onClick={() => del(item)} className="rounded-lg w-full text-destructive hover:bg-destructive/10 hover:text-destructive gap-1.5">
                    <Trash2 className="h-3.5 w-3.5" /> Delete
                  </AsyncButton>
                </div>
              )}
            </div>
          </div>
        ))}
        {total === 0 && <div className="col-span-full card-luxe p-12 text-center text-muted-foreground">No ready stock items yet — add your first finished piece.</div>}
      </div>
      )}

      {view === "list" && (
        <div className="card-luxe divide-y divide-border/50 overflow-hidden">
          {paged.map(item => (
            <div key={item.id} className="flex items-center gap-3 px-3 sm:px-4 py-3 hover:bg-secondary/50 transition-colors">
              <div className="h-16 w-16 rounded-xl bg-secondary overflow-hidden shrink-0 relative">
                {item.images?.[0]
                  ? <img src={item.images[0]} alt={item.name} className="w-full h-full object-cover" />
                  : <div className="w-full h-full grid place-items-center text-muted-foreground/40"><Gem className="h-6 w-6" /></div>}
                {item.quantity === 0 && <div className="absolute inset-0 bg-black/50 grid place-items-center"><span className="text-white font-semibold text-[9px] tracking-wide">SOLD</span></div>}
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-medium text-brand-dark truncate leading-tight">{item.name}</p>
                <p className="text-xs text-muted-foreground truncate">
                  {item.jewelleryType} · {item.metal}{item.productKarats ? ` ${item.productKarats}` : ""}
                  {item.diamondWeight ? ` · ${item.diamondWeight}ct ${item.diamondType || "diamond"}` : ""}
                </p>
                <p className="text-[11px] text-muted-foreground truncate">
                  {item.grossWeight ? `Gross ${item.grossWeight}g` : ""}
                  {item.grossWeight && item.netWeight ? " · " : ""}
                  {item.netWeight ? `Net ${item.netWeight}g` : ""}
                  {item.sku ? `${(item.grossWeight || item.netWeight) ? " · " : ""}Design #${item.sku}` : ""}
                </p>
                {item.location && (
                  <span className="inline-flex items-center gap-1 mt-1 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-primary/10 text-primary">
                    <MapPin className="h-2.5 w-2.5" /> {item.location}
                  </span>
                )}
              </div>
              <div className="text-right shrink-0">
                <p className="font-display text-lg font-bold text-brand-dark">{fmtMoney(item.price)}</p>
                {isAdmin && item.cost != null && (
                  <p className={`text-[10px] font-medium ${item.price - item.cost >= 0 ? "text-success" : "text-destructive"}`}>
                    {item.price - item.cost >= 0 ? "+" : "−"}{fmtMoney(Math.abs(item.price - item.cost))} {item.price - item.cost >= 0 ? "profit" : "loss"}
                  </p>
                )}
                {canManage ? (
                  <div className="flex items-center gap-1.5 justify-end mt-1">
                    <button onClick={() => adjustQty(item, -1)} disabled={item.quantity === 0} className="h-6 w-6 rounded-lg border border-border grid place-items-center hover:bg-secondary disabled:opacity-30 transition-colors"><Minus className="h-3 w-3" /></button>
                    <span className="text-sm font-semibold w-6 text-center">{item.quantity}</span>
                    <button onClick={() => adjustQty(item, 1)} className="h-6 w-6 rounded-lg border border-border grid place-items-center hover:bg-secondary transition-colors"><Plus className="h-3 w-3" /></button>
                  </div>
                ) : (
                  <span className={`inline-block mt-1 text-[10px] font-semibold px-2 py-0.5 rounded-full ${item.quantity > 0 ? "bg-success/10 text-success" : "bg-destructive/10 text-destructive"}`}>
                    {item.quantity > 0 ? "In stock" : "Sold out"}
                  </span>
                )}
              </div>
              {canManage && (
                <div className="flex flex-col gap-1 shrink-0">
                  <button onClick={() => openEdit(item)} className="h-8 w-8 rounded-lg border border-border grid place-items-center text-muted-foreground hover:text-primary hover:bg-secondary transition-colors"><Pencil className="h-3.5 w-3.5" /></button>
                  <button onClick={() => del(item)} className="h-8 w-8 rounded-lg border border-border grid place-items-center text-destructive hover:bg-destructive/10 transition-colors"><Trash2 className="h-3.5 w-3.5" /></button>
                </div>
              )}
            </div>
          ))}
          {total === 0 && <div className="p-12 text-center text-muted-foreground">No ready stock items yet — add your first finished piece.</div>}
        </div>
      )}

      <PaginationBar page={page} totalPages={totalPages} onPageChange={setPage} label={total > 0 ? `Showing ${start + 1}–${end} of ${total} items` : undefined} />
    </div>
  );
}

function METALS_NEED_KARAT(metal: Order["metal"]): boolean {
  return metal !== "Platinum" && metal !== "Silver";
}
