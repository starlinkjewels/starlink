import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { ArrowDown, ArrowUp, Camera, ImagePlus, Loader2, RotateCw, ScanLine, Trash2 } from "lucide-react";
import { ActionSheet } from "@/components/ActionSheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { saveScan } from "@/lib/documents";

/**
 * Scan papers with the phone's or tablet's camera into ONE PDF.
 *
 * Each photo is a page: shown small, it can be turned, taken out or moved up
 * and down; "Add page" takes another. "Enhance" (on at the start) makes each
 * page grey with its contrast stretched, so the writing is crisp and the file
 * small. Save draws every page onto an A4 page of a PDF (jsPDF) and uploads it
 * like any document — its first page as the grid's small picture.
 *
 * Pages are kept at most MAX_PX on their long side: plenty for print, and a
 * ten-page scan stays a few MB.
 */
const MAX_PX = 2000;
const THUMB_PX = 360;
const JPEG_Q = 0.8;

interface Page {
  id: string;
  /** The photo, upright and at most MAX_PX — as taken, before any turn or clean-up. */
  blob: Blob;
  /** Turned clockwise by this many degrees. */
  rot: 0 | 90 | 180 | 270;
  /** A small picture of it as turned, for the list. */
  thumb: string;
}

/** "Scan 2 Nov 2026 14:05". */
function defaultName(d = new Date()): string {
  const m = d.toLocaleString("en-GB", { month: "short" }).replace(/^Sept$/, "Sep");
  const hh = String(d.getHours()).padStart(2, "0"), mm = String(d.getMinutes()).padStart(2, "0");
  return `Scan ${d.getDate()} ${m} ${d.getFullYear()} ${hh}:${mm}`;
}

function loadImage(blob: Blob): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(blob);
  return new Promise((resolve, reject) => {
    const i = new Image();
    // The browser turns a phone photo the way it was held (its own note of which way up).
    i.onload = () => { URL.revokeObjectURL(url); resolve(i); };
    i.onerror = () => { URL.revokeObjectURL(url); reject(new Error("This picture can't be opened here")); };
    i.src = url;
  });
}

/** The page drawn turned, at most `max` on its long side, on white. */
function drawPage(img: HTMLImageElement, rot: Page["rot"], max: number): HTMLCanvasElement {
  const w0 = img.naturalWidth, h0 = img.naturalHeight;
  const k = Math.min(1, max / Math.max(w0, h0));
  const w = Math.max(1, Math.round(w0 * k)), h = Math.max(1, Math.round(h0 * k));
  const side = rot === 90 || rot === 270;
  const c = document.createElement("canvas");
  c.width = side ? h : w;
  c.height = side ? w : h;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.translate(c.width / 2, c.height / 2);
  ctx.rotate((rot * Math.PI) / 180);
  ctx.drawImage(img, -w / 2, -h / 2, w, h);
  return c;
}

/**
 * Enhance a paper: grey, then its contrast stretched — the darkest
 * ink to black and the paper to white (the 2nd and 92nd brightness
 * percentiles; most of a page is paper, so the paper clears to white).
 */
function enhance(c: HTMLCanvasElement): void {
  const ctx = c.getContext("2d")!;
  const im = ctx.getImageData(0, 0, c.width, c.height);
  const p = im.data, n = p.length / 4;
  const hist = new Uint32Array(256);
  const lum = new Uint8ClampedArray(n);
  for (let i = 0, j = 0; j < n; i += 4, j++) {
    const v = (p[i] * 299 + p[i + 1] * 587 + p[i + 2] * 114) / 1000;
    lum[j] = v;
    hist[lum[j]]++;
  }
  const at = (share: number) => {
    let sum = 0;
    const want = n * share;
    for (let v = 0; v < 256; v++) { sum += hist[v]; if (sum >= want) return v; }
    return 255;
  };
  const hi = at(0.92);
  // A page with little ink (or a dark photo): never stretched harder than this.
  const lo = Math.min(at(0.02), Math.max(0, hi - 48));
  const span = Math.max(1, hi - lo);
  for (let i = 0, j = 0; j < n; i += 4, j++) {
    const v = Math.max(0, Math.min(255, ((lum[j] - lo) * 255) / span));
    p[i] = p[i + 1] = p[i + 2] = v;
  }
  ctx.putImageData(im, 0, 0);
}

const toBlob = (c: HTMLCanvasElement, q: number) => new Promise<Blob>((resolve, reject) =>
  c.toBlob(b => (b ? resolve(b) : reject(new Error("Couldn't keep this page"))), "image/jpeg", q));

let seq = 0;

export function ScanSheet({ open, onClose, folderId, folderName, by, onSaved }: {
  open: boolean;
  onClose: () => void;
  /** Where the scan is saved (null = the top of Documents). */
  folderId: string | null;
  folderName: string;
  by: string;
  onSaved?: (name: string) => void;
}) {
  const [pages, setPages] = useState<Page[]>([]);
  const [clean, setClean] = useState(true);
  const [name, setName] = useState(defaultName);
  const [adding, setAdding] = useState(0);
  const [busy, setBusy] = useState<null | { step: "pdf" | "upload"; pct: number }>(null);
  const camRef = useRef<HTMLInputElement>(null);
  const galRef = useRef<HTMLInputElement>(null);
  // The small pictures' addresses, let go when the panel is done with them.
  const thumbs = useRef(new Set<string>());

  const reset = () => {
    thumbs.current.forEach(u => URL.revokeObjectURL(u));
    thumbs.current.clear();
    setPages([]); setClean(true); setName(defaultName()); setBusy(null); setAdding(0);
  };
  // A fresh scan each time it opens.
  useEffect(() => { if (open) reset(); }, [open]);
  useEffect(() => () => { thumbs.current.forEach(u => URL.revokeObjectURL(u)); }, []);

  const thumbOf = async (blob: Blob, rot: Page["rot"]) => {
    const c = drawPage(await loadImage(blob), rot, THUMB_PX);
    const u = URL.createObjectURL(await toBlob(c, 0.7));
    thumbs.current.add(u);
    return u;
  };
  const dropThumb = (u: string) => { URL.revokeObjectURL(u); thumbs.current.delete(u); };

  const addFiles = async (list: FileList | null) => {
    const files = [...(list ?? [])].filter(f => f.type.startsWith("image/") || /\.(jpe?g|png|webp|heic|heif)$/i.test(f.name));
    if (!files.length) return;
    setAdding(n => n + files.length);
    for (const f of files) {
      try {
        const img = await loadImage(f);
        const blob = await toBlob(drawPage(img, 0, MAX_PX), 0.92);
        const thumb = await thumbOf(blob, 0);
        setPages(ps => [...ps, { id: `p${++seq}`, blob, rot: 0, thumb }]);
      } catch (e) {
        toast.error(`${f.name}: ${e instanceof Error ? e.message : "couldn't be added"}`);
      } finally {
        setAdding(n => n - 1);
      }
    }
  };

  const turn = async (id: string) => {
    const pg = pages.find(p => p.id === id);
    if (!pg) return;
    const rot = ((pg.rot + 90) % 360) as Page["rot"];
    try {
      const thumb = await thumbOf(pg.blob, rot);
      setPages(ps => ps.map(p => { if (p.id !== id) return p; dropThumb(p.thumb); return { ...p, rot, thumb }; }));
    } catch (e) { toast.error(e instanceof Error ? e.message : "Couldn't turn it"); }
  };
  const remove = (id: string) => setPages(ps => ps.filter(p => { if (p.id === id) { dropThumb(p.thumb); return false; } return true; }));
  const shift = (i: number, d: -1 | 1) => setPages(ps => {
    const j = i + d;
    if (j < 0 || j >= ps.length) return ps;
    const next = [...ps];
    [next[i], next[j]] = [next[j], next[i]];
    return next;
  });

  const save = async () => {
    if (!pages.length) { toast.error("Take a photo of the first page"); return; }
    const title = name.trim() || defaultName();
    setBusy({ step: "pdf", pct: 0 });
    try {
      const { jsPDF } = await import("jspdf");
      let pdf: InstanceType<typeof jsPDF> | null = null;
      let first: string | undefined;
      for (let i = 0; i < pages.length; i++) {
        const pg = pages[i];
        const c = drawPage(await loadImage(pg.blob), pg.rot, MAX_PX);
        if (clean) enhance(c);
        const data = c.toDataURL("image/jpeg", JPEG_Q);
        if (i === 0) {
          // The grid's small picture: the first page, as saved.
          const s = document.createElement("canvas");
          const k = Math.min(1, 480 / Math.max(c.width, c.height));
          s.width = Math.round(c.width * k); s.height = Math.round(c.height * k);
          s.getContext("2d")!.drawImage(c, 0, 0, s.width, s.height);
          first = s.toDataURL("image/jpeg", 0.75);
        }
        // A4, turned the way the page is; the photo fitted inside and centred.
        const orientation = c.width > c.height ? "landscape" : "portrait";
        if (!pdf) pdf = new jsPDF({ unit: "mm", format: "a4", orientation, compress: true });
        else pdf.addPage("a4", orientation);
        const pw = pdf.internal.pageSize.getWidth(), ph = pdf.internal.pageSize.getHeight();
        const k = Math.min(pw / c.width, ph / c.height);
        const iw = c.width * k, ih = c.height * k;
        pdf.addImage(data, "JPEG", (pw - iw) / 2, (ph - ih) / 2, iw, ih, undefined, "FAST");
        setBusy({ step: "pdf", pct: Math.round(((i + 1) / pages.length) * 100) });
      }
      pdf!.setProperties({ title });
      const blob = pdf!.output("blob");
      setBusy({ step: "upload", pct: 0 });
      const item = await saveScan(blob, title, pages.length, first, folderId, by, pct => setBusy({ step: "upload", pct }));
      toast.success(`Saved "${item.name}" · ${pages.length} page${pages.length === 1 ? "" : "s"}`);
      onSaved?.(item.name);
      onClose();
    } catch (e) {
      console.warn("[scan] not saved:", e);
      toast.error(e instanceof Error ? `Couldn't save the scan — ${e.message}` : "Couldn't save the scan");
      setBusy(null);
    }
  };

  const working = !!busy;
  return (
    <ActionSheet open={open} onOpenChange={o => { if (!o && !working) onClose(); }} size="lg" icon={ScanLine}
      title="Scan papers"
      description={`One PDF, saved in ${folderName}`}
      footer={
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground tabular-nums min-w-0 truncate">
            {busy
              ? busy.step === "pdf" ? `Making the PDF… ${busy.pct}%` : `Uploading… ${busy.pct}%`
              : pages.length ? `${pages.length} page${pages.length === 1 ? "" : "s"}` : "No pages yet"}
          </p>
          <div className="flex items-center gap-2 shrink-0">
            <Button variant="outline" onClick={onClose} disabled={working} className="rounded-xl h-10">Cancel</Button>
            <Button onClick={save} disabled={working || adding > 0 || !pages.length} className="btn-hero rounded-xl h-10 px-6 gap-2">
              {working && <Loader2 className="h-4 w-4 animate-spin" />}Save PDF
            </Button>
          </div>
        </div>
      }>
      <div className="space-y-5">
        {/* The camera (the back one, on a phone), and the gallery for photos already taken. */}
        <input ref={camRef} type="file" accept="image/*" capture="environment" className="hidden"
          onChange={e => { addFiles(e.target.files); e.currentTarget.value = ""; }} />
        <input ref={galRef} type="file" accept="image/*" multiple className="hidden"
          onChange={e => { addFiles(e.target.files); e.currentTarget.value = ""; }} />

        {pages.length === 0 ? (
          <div className="rounded-2xl border-2 border-dashed border-border p-6 sm:p-8 text-center space-y-4">
            <div className="h-14 w-14 rounded-2xl bg-primary/10 grid place-items-center mx-auto"><Camera className="h-7 w-7 text-primary" /></div>
            <div>
              <p className="font-medium text-brand-dark">Take a photo of the first page</p>
              <p className="text-xs text-muted-foreground mt-1">Lay the paper flat in good light, fill the frame with it. Add more pages after.</p>
            </div>
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-center gap-2">
              <Button onClick={() => camRef.current?.click()} disabled={working} className="btn-hero rounded-xl h-11 gap-2"><Camera className="h-4 w-4" />Take photo</Button>
              <Button variant="outline" onClick={() => galRef.current?.click()} disabled={working} className="rounded-xl h-11 gap-2"><ImagePlus className="h-4 w-4" />From gallery</Button>
            </div>
            {adding > 0 && <p className="text-xs text-muted-foreground inline-flex items-center gap-1.5"><Loader2 className="h-3.5 w-3.5 animate-spin" />Adding…</p>}
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {pages.map((p, i) => (
                <div key={p.id} className="rounded-xl border border-border/70 bg-white overflow-hidden flex flex-col min-w-0">
                  <div className="relative aspect-[3/4] bg-secondary/40 grid place-items-center">
                    <img src={p.thumb} alt={`Page ${i + 1}`} className="max-w-full max-h-full object-contain"
                      style={clean ? { filter: "grayscale(1) contrast(1.35) brightness(1.08)" } : undefined} />
                    <span className="absolute top-1.5 left-1.5 h-6 min-w-6 px-1.5 rounded-full bg-black/60 text-white text-[11px] font-semibold grid place-items-center tabular-nums">{i + 1}</span>
                  </div>
                  <div className="flex items-center justify-between gap-0.5 p-1">
                    <Button type="button" variant="ghost" size="icon" className="h-9 w-9 rounded-lg" disabled={working || i === 0} onClick={() => shift(i, -1)} aria-label={`Move page ${i + 1} up`} title="Earlier"><ArrowUp className="h-4 w-4" /></Button>
                    <Button type="button" variant="ghost" size="icon" className="h-9 w-9 rounded-lg" disabled={working || i === pages.length - 1} onClick={() => shift(i, 1)} aria-label={`Move page ${i + 1} down`} title="Later"><ArrowDown className="h-4 w-4" /></Button>
                    <Button type="button" variant="ghost" size="icon" className="h-9 w-9 rounded-lg" disabled={working} onClick={() => turn(p.id)} aria-label={`Turn page ${i + 1}`} title="Turn"><RotateCw className="h-4 w-4" /></Button>
                    <Button type="button" variant="ghost" size="icon" className="h-9 w-9 rounded-lg text-destructive hover:text-destructive" disabled={working} onClick={() => remove(p.id)} aria-label={`Take out page ${i + 1}`} title="Take out"><Trash2 className="h-4 w-4" /></Button>
                  </div>
                </div>
              ))}
              {/* The next page. */}
              <button type="button" onClick={() => camRef.current?.click()} disabled={working}
                className="rounded-xl border-2 border-dashed border-border hover:border-primary/50 bg-secondary/20 aspect-[3/4] flex flex-col items-center justify-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground disabled:opacity-50">
                {adding > 0 ? <Loader2 className="h-6 w-6 animate-spin" /> : <Camera className="h-6 w-6" />}
                Add page
              </button>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" variant="outline" onClick={() => galRef.current?.click()} disabled={working} className="rounded-xl h-10 gap-2"><ImagePlus className="h-4 w-4" />Add from gallery</Button>
            </div>
          </>
        )}

        <div className="rounded-xl border border-border/70 p-3.5 flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <Label htmlFor="scan-clean" className="text-sm font-semibold text-brand-dark">Enhance</Label>
            <p className="text-[11px] text-muted-foreground mt-0.5">Grey with sharper contrast: writing crisp, paper white, file smaller. Off for a colour photo.</p>
          </div>
          <Switch id="scan-clean" checked={clean} onCheckedChange={setClean} disabled={working} className="mt-0.5" />
        </div>

        <div>
          <Label htmlFor="scan-name" className="text-xs">Name</Label>
          <Input id="scan-name" value={name} onChange={e => setName(e.target.value)} disabled={working} className="h-10 rounded-xl mt-1" />
        </div>
      </div>
    </ActionSheet>
  );
}
