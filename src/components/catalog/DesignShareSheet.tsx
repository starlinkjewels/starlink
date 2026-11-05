// Share a design's product page as a link (Catalog → a design → Share): anyone
// with the link sees its pictures, details and options — and its price, only when
// shared with one (as everyone's standard price or a chosen client's, in ₹ or $),
// worked out on the server each time it is opened; never the costs behind it.
import { useState } from "react";
import { Copy, ExternalLink, Link2, MessageCircle, Share2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { ActionSheet } from "@/components/ActionSheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAuth } from "@/lib/auth";
import { useDb } from "@/hooks/useDb";
import { deleteShare, findDesignShare, saveDesignShare, shareUrl } from "@/lib/share";
import type { Share } from "@/lib/db";
import type { Ccy } from "@/lib/pure/pricing";
import type { Pic } from "./ProductView";

/** Price and line as chosen here: what a link is made with. */
export type ShareChoice = { showPrice: boolean; priceFor?: string; ccy: Ccy; note?: string; createdBy: string };

/** A catalogue design's link — or, given `existing` and `onSave`, another product page's (a piece made on orders, a category). */
export function DesignShareSheet({ designKey, title, pictures, onClose, existing: given, onSave, description }: {
  designKey?: string; title: string; pictures?: Pic[]; onClose(): void;
  existing?: Share; onSave?(c: ShareChoice): Share; description?: string;
}) {
  const { user } = useAuth();
  const db = useDb();
  const existing = onSave ? given : designKey ? findDesignShare(designKey) : undefined;
  const [showPrice, setShowPrice] = useState(existing?.showPrice ?? false);
  const [priceFor, setPriceFor] = useState(existing?.priceFor ?? "");
  const [ccy, setCcy] = useState<Ccy>(existing?.ccy ?? "USD");
  const [note, setNote] = useState(existing?.note ?? "");
  const [link, setLink] = useState(existing ? shareUrl(existing.id) : "");

  const save = () => {
    const c: ShareChoice = { showPrice, ccy, createdBy: user!.id, note: note.trim() || undefined, ...(showPrice && priceFor ? { priceFor } : {}) };
    const s = onSave ? onSave(c) : saveDesignShare({
      designKey: designKey!, title, ...c,
      items: (pictures ?? []).slice(0, 40).map(p => ({ type: "image" as const, url: p.url, ...(p.thumb ? { thumb: p.thumb } : {}), name: p.name })),
    });
    const url = shareUrl(s.id);
    setLink(url);
    void navigator.clipboard?.writeText(url).then(() => toast.success("Link ready — copied")).catch(() => toast.success("Link ready"));
  };
  const stop = () => {
    if (!existing) return;
    void deleteShare(existing.id).then(() => { toast.success("Link stopped — it no longer opens"); onClose(); });
  };

  return (
    <ActionSheet open onOpenChange={o => { if (!o) onClose(); }} icon={Share2} title={`Share ${title}`} description={description ?? "Its pictures, details and options — and its price, if you choose."}>
      <div className="space-y-4">
        <label className="flex items-start justify-between gap-3 rounded-xl border border-border px-4 py-3">
          <span><span className="text-sm font-medium block">Show the price</span><span className="text-xs text-muted-foreground">Worked out live for the options they choose — never the costs or margin</span></span>
          <Switch checked={showPrice} onCheckedChange={setShowPrice} />
        </label>
        {showPrice && (
          <div className="grid grid-cols-2 gap-3">
            <div className="min-w-0"><Label className="text-xs">Price as</Label>
              <Select value={priceFor || "_"} onValueChange={v => setPriceFor(v === "_" ? "" : v)}>
                <SelectTrigger aria-label="Price as" className="h-10 mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="_">Standard price</SelectItem>
                  {db.clients.filter(c => c.status === "active").map(c => ({ id: c.id, n: c.companyName || c.ownerName })).sort((a, b) => a.n.localeCompare(b.n)).map(c => <SelectItem key={c.id} value={c.id}>{c.n}'s price</SelectItem>)}
                </SelectContent>
              </Select></div>
            <div className="min-w-0"><Label className="text-xs">Currency</Label>
              <Select value={ccy} onValueChange={v => setCcy(v as Ccy)}>
                <SelectTrigger aria-label="Currency" className="h-10 mt-1"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="USD">$ Export</SelectItem><SelectItem value="INR">₹ India</SelectItem></SelectContent>
              </Select></div>
          </div>
        )}
        <div><Label className="text-xs">A line for them (optional)</Label><Input className="h-10 mt-1" value={note} onChange={e => setNote(e.target.value)} placeholder="Available in 10K, 14K and 18K" /></div>
        <div className="flex flex-wrap gap-2">
          <Button onClick={save} className="gap-1.5"><Link2 className="h-4 w-4" />{existing ? "Update the link" : "Make the link"}</Button>
          {existing && <Button variant="ghost" className="gap-1.5 text-destructive" onClick={stop}><Trash2 className="h-4 w-4" />Stop sharing</Button>}
        </div>
        {link && (
          <div className="rounded-xl border border-border bg-secondary/30 p-3 space-y-2">
            <p className="text-xs break-all font-mono">{link}</p>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" className="gap-1.5" onClick={() => void navigator.clipboard?.writeText(link).then(() => toast.success("Copied"))}><Copy className="h-3.5 w-3.5" />Copy</Button>
              <Button size="sm" variant="outline" className="gap-1.5" asChild><a href={`https://wa.me/?text=${encodeURIComponent(`${title}${note.trim() ? ` — ${note.trim()}` : ""}\n${link}`)}`} target="_blank" rel="noopener noreferrer"><MessageCircle className="h-3.5 w-3.5" />WhatsApp</a></Button>
              <Button size="sm" variant="ghost" className="gap-1.5" asChild><a href={link} target="_blank" rel="noopener noreferrer"><ExternalLink className="h-3.5 w-3.5" />Open</a></Button>
            </div>
          </div>
        )}
      </div>
    </ActionSheet>
  );
}
