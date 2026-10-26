import { useMemo, useState } from "react";
import { Check, Clock, Copy, Download, ExternalLink, FileText, Gem, Link2, Loader2, Share2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { ActionSheet } from "@/components/ActionSheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useAuth } from "@/lib/auth";
import { useDb } from "@/hooks/useDb";
import { fmtMoney, type ReadyStockItem, type Share } from "@/lib/db";
import { buildSharePieces, createPieceShare, shareBrand, sourceOrderOf } from "@/lib/readyStockShare";
import { downloadPiecesPdf } from "@/lib/piecesPdf";
import { deleteShare, shareUrl, updateShareExpiry } from "@/lib/share";
import { confirmBox } from "@/lib/confirm";

/**
 * Share Ready Stock pieces with a client: choose what shows (price, gold,
 * diamonds, CAD), set the price for this share, then a PDF or a public link.
 * The prices typed here are for this share only — the pieces keep their own.
 */
export function ShareProductsSheet({ items, onClose }: { items: ReadyStockItem[]; onClose(): void }) {
  const { user } = useAuth();
  const db = useDb();
  const [showPrice, setShowPrice] = useState(true);
  const [gold, setGold] = useState(true);
  const [diamonds, setDiamonds] = useState(true);
  const [cad, setCad] = useState(true);
  const [prices, setPrices] = useState<Record<string, string>>(() => Object.fromEntries(items.map(i => [i.id, i.price ? String(i.price) : ""])));
  const [title, setTitle] = useState(items.length === 1 ? items[0].name : "Ready Stock");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<"" | "pdf" | "link">("");
  const [made, setMade] = useState<Share | null>(null);
  const [copied, setCopied] = useState(false);

  const anyCad = useMemo(() => items.some(i => !!sourceOrderOf(db, i)?.cadImage), [db, items]);
  const brand = useMemo(() => shareBrand(db, items), [db, items]);
  const pieces = () => buildSharePieces(db, items, {
    gold, diamonds, cad,
    prices: showPrice ? Object.fromEntries(items.map(i => [i.id, Number(prices[i.id]) || 0])) : undefined,
  });
  const priceMissing = showPrice && items.some(i => !(Number(prices[i.id]) > 0));

  const pdf = async () => {
    setBusy("pdf");
    const t = toast.loading(`Making the PDF${items.length > 1 ? ` — ${items.length} pieces` : ""}…`);
    try {
      const missing = await downloadPiecesPdf(pieces(), brand, { title: title.trim() || "Ready Stock", note, filename: title });
      if (missing) toast.warning(`PDF saved — ${missing} photo${missing !== 1 ? "s" : ""} couldn't be read and show as empty boxes`, { id: t });
      else toast.success("PDF saved", { id: t });
    } catch { toast.error("Couldn't make the PDF", { id: t }); }
    finally { setBusy(""); }
  };

  const link = async () => {
    setBusy("link");
    try {
      const s = await createPieceShare({ pieces: pieces(), brand, title, note, showPrice, createdBy: user!.id });
      setMade(s);
      toast.success("Link ready");
    } catch { toast.error("Couldn't make the link"); }
    finally { setBusy(""); }
  };

  const live = made ? (db.shares ?? []).find(s => s.id === made.id) ?? made : null;
  const url = live ? shareUrl(live.id) : "";
  const copy = async () => {
    try { await navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 2000); toast.success("Link copied"); }
    catch { toast.error("Couldn't copy — long-press the link to copy it."); }
  };
  const sendOn = async () => {
    const nav = navigator as Navigator & { share?: (d: { title?: string; url?: string }) => Promise<void> };
    if (nav.share) { try { await nav.share({ title: live?.title, url }); } catch { /* closed */ } }
    else await copy();
  };
  const stop = async () => {
    if (!live) return;
    if (!(await confirmBox("Stop sharing? The link will stop working."))) return;
    void deleteShare(live.id);
    setMade(null);
    toast.success("Sharing stopped");
  };
  const EXPIRY: [string, number][] = [["24 hours", 24], ["7 days", 168], ["30 days", 720]];

  const toggle = (label: string, on: boolean, set: (v: boolean) => void, hint?: string) => (
    <label className="flex items-center justify-between gap-3 rounded-xl border border-border/70 px-3 py-2.5 cursor-pointer">
      <span className="min-w-0">
        <span className="block text-sm font-medium text-brand-dark">{label}</span>
        {hint && <span className="block text-[11px] text-muted-foreground">{hint}</span>}
      </span>
      <Switch checked={on} onCheckedChange={set} disabled={!!made} aria-label={label} />
    </label>
  );

  return (
    <ActionSheet open onOpenChange={o => { if (!o) onClose(); }} size="lg" icon={Share2}
      title={`Share ${items.length === 1 ? items[0].name : `${items.length} pieces`}`}
      description="A PDF, or a link anyone can open without signing in. Cost is never shown."
      footer={made ? (
        <div className="flex justify-end"><Button variant="outline" onClick={onClose} className="rounded-xl">Done</Button></div>
      ) : (
        <div className="flex items-center justify-end gap-2">
          <Button variant="outline" onClick={pdf} disabled={!!busy || priceMissing} className="rounded-xl gap-1.5">
            {busy === "pdf" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />} Download PDF
          </Button>
          <Button onClick={link} disabled={!!busy || priceMissing} className="btn-hero rounded-xl gap-1.5">
            {busy === "link" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" />} Create link
          </Button>
        </div>
      )}>
      <div className="space-y-5">
        {live && (
          <section className="rounded-2xl border border-success/30 bg-success/5 p-3.5 space-y-3">
            <p className="text-sm font-semibold text-brand-dark flex items-center gap-1.5"><Link2 className="h-4 w-4 text-success" /> Link ready — {live.count} piece{live.count !== 1 ? "s" : ""}{live.showPrice ? ", with prices" : ", no prices"}</p>
            <div className="flex items-center gap-2">
              <input readOnly value={url} onFocus={e => e.currentTarget.select()} aria-label="Share link"
                className="flex-1 min-w-0 h-10 rounded-xl border border-border bg-white px-3 text-sm font-mono truncate focus:outline-none focus:ring-2 focus:ring-primary/30" />
              <Button onClick={copy} className="btn-hero rounded-xl h-10 gap-1.5 shrink-0">{copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}{copied ? "Copied" : "Copy"}</Button>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="outline" size="sm" onClick={sendOn} className="rounded-xl gap-1.5"><Share2 className="h-4 w-4" /> Send…</Button>
              <a href={url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 h-9 px-3 rounded-xl border border-border bg-white hover:bg-secondary text-sm font-medium text-brand-dark"><ExternalLink className="h-4 w-4" /> Open</a>
              <Button variant="ghost" size="sm" onClick={stop} className="rounded-xl gap-1.5 text-destructive hover:text-destructive hover:bg-destructive/10 ml-auto"><Trash2 className="h-4 w-4" /> Stop sharing</Button>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-xs text-muted-foreground flex items-center gap-1 mr-1"><Clock className="h-3.5 w-3.5" /> Expires</span>
              {EXPIRY.map(([l, h]) => (
                <button key={l} type="button" onClick={() => { updateShareExpiry(live.id, new Date(Date.now() + h * 3600e3).toISOString()); toast.success(`Expires in ${l}`); }}
                  className="h-8 px-2.5 rounded-lg border border-border bg-white hover:bg-secondary text-xs font-medium text-brand-dark">{l}</button>
              ))}
              <button type="button" onClick={() => { updateShareExpiry(live.id, null); toast.success("Never expires"); }}
                className="h-8 px-2.5 rounded-lg border border-border bg-white hover:bg-secondary text-xs font-medium text-brand-dark">Never</button>
              <span className="text-[11px] text-muted-foreground ml-1">{live.expiresAt ? `· ${new Date(live.expiresAt).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}` : "· never"}</span>
            </div>
          </section>
        )}

        <section className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Show</p>
          <div className="grid gap-2 sm:grid-cols-2">
            {toggle("Price", showPrice, setShowPrice, "Set below, for this share only")}
            {toggle("Gold details", gold, setGold, "Metal, karat, colour, weights")}
            {toggle("Diamond details", diamonds, setDiamonds, "Shape, weight, pieces, quality")}
            {anyCad && toggle("CAD photo", cad, setCad, "From the order it was made for")}
          </div>
        </section>

        <section className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{items.length === 1 ? "The piece" : `The ${items.length} pieces`}</p>
          <div className="rounded-2xl border border-border/70 divide-y divide-border/60">
            {items.map(i => (
              <div key={i.id} className="flex items-center gap-3 px-3 py-2.5">
                <div className="h-11 w-11 rounded-lg bg-white ring-1 ring-border/60 overflow-hidden shrink-0 grid place-items-center">
                  {i.images?.[0] ? <img src={i.images[0]} alt="" className="h-full w-full object-contain" /> : <Gem className="h-4 w-4 text-muted-foreground/40" />}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-brand-dark truncate">{i.name}</p>
                  <p className="text-[11px] text-muted-foreground truncate">{[i.sku, i.jewelleryType, `${i.metal}${i.productKarats ? ` ${i.productKarats}` : ""}`].filter(Boolean).join(" · ")}</p>
                </div>
                {showPrice && (
                  <div className="w-32 shrink-0">
                    <Input type="number" min={0} step="0.01" inputMode="decimal" value={prices[i.id] ?? ""} disabled={!!made}
                      onChange={e => setPrices(p => ({ ...p, [i.id]: e.target.value }))} aria-label={`Price for ${i.name} (USD)`}
                      className={`h-9 rounded-lg text-right tabular-nums ${!(Number(prices[i.id]) > 0) ? "border-destructive" : ""}`} placeholder="Price $" />
                    {i.price > 0 && Number(prices[i.id]) !== i.price && <p className="text-[10px] text-muted-foreground text-right mt-0.5">Stock price {fmtMoney(i.price)}</p>}
                  </div>
                )}
              </div>
            ))}
          </div>
          {priceMissing && <p className="text-[11px] text-destructive">Give every piece a price, or switch Price off.</p>}
        </section>

        <section className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="sp-title" className="text-xs">Title</Label>
            <Input id="sp-title" value={title} onChange={e => setTitle(e.target.value)} disabled={!!made} maxLength={80} className="h-10 rounded-xl" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="sp-note" className="text-xs">A line for the client · optional</Label>
            <Input id="sp-note" value={note} onChange={e => setNote(e.target.value)} disabled={!!made} maxLength={200} placeholder="e.g. Prices valid for 7 days" className="h-10 rounded-xl" />
          </div>
        </section>
        {made && (
          <Button variant="outline" onClick={pdf} disabled={!!busy} className="rounded-xl gap-1.5 w-full sm:w-auto">
            {busy === "pdf" ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />} Download the same as PDF
          </Button>
        )}
      </div>
    </ActionSheet>
  );
}
