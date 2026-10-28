import { useState } from "react";
import { Film, CheckCircle2, AlertTriangle, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { ensureCollections } from "@/lib/db";
import { useDb } from "@/hooks/useDb";
import { Button } from "@/components/ui/button";
import { SectionTitle } from "@/components/SectionTitle";
import { makeVideoPlayable, webVideoUrl } from "@/lib/webVideo";

/**
 * Settings → Videos. Every video already in the app — orders, Ready Stock,
 * Catalog, Product Photos — gets its copy that plays on every browser and
 * device (lib/webVideo.ts), one after another. A video that has one already is
 * skipped; the originals are never changed. New uploads get theirs on their own.
 */
export function VideoFixSettings() {
  const db = useDb();
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(0);
  const [total, setTotal] = useState(0);
  const [result, setResult] = useState<{ made: number; had: number; failed: string[] } | null>(null);

  const collect = () => {
    const out = new Map<string, string>();
    const add = (url: string | undefined, label: string) => { if (url && webVideoUrl(url) && !out.has(url)) out.set(url, label); };
    for (const o of db.orders) add(o.productVideo, `Order ${o.orderNumber}`);
    for (const r of db.readyStock ?? []) add(r.video, `Ready Stock ${r.sku || r.name}`);
    for (const c of db.catalogItems ?? []) if (c.type === "video") add(c.data, `Catalog ${c.name}`);
    for (const p of db.productPhotoItems ?? []) if (p.type === "video") add(p.url, `Product Photos ${p.name}`);
    return [...out.entries()];
  };

  const run = async () => {
    setRunning(true); setResult(null);
    try {
      await ensureCollections(["productPhotoItems"]).catch(() => {});
      const list = collect();
      setTotal(list.length); setDone(0);
      let made = 0, had = 0;
      const failed: string[] = [];
      for (const [url, label] of list) {
        try { (await makeVideoPlayable(url)) === "made" ? made++ : had++; }
        catch { failed.push(label); }
        setDone(n => n + 1);
      }
      setResult({ made, had, failed });
      if (failed.length) toast.warning(`${made + had} of ${list.length} videos play everywhere — ${failed.length} couldn't be converted`);
      else toast.success(list.length ? `All ${list.length} videos play on every browser and device` : "No videos yet");
    } finally { setRunning(false); }
  };

  return (
    <div className="card-luxe p-6 space-y-4">
      <SectionTitle icon={Film} title="Videos" sub="Every video plays on every browser and device"
        info="An iPhone video often doesn't play in Firefox or in Chrome on some computers. The app makes a copy every browser plays, next to the original." />
      <ul className="text-[11px] text-muted-foreground space-y-0.5 list-disc pl-4">
        <li>New videos — orders, Ready Stock, Catalog, Product Photos — get their copy on their own after uploading (it takes a minute).</li>
        <li>This converts the videos already in the app, one after another. Ones that have their copy are skipped.</li>
        <li>The original is never changed or removed; Download still gives the original.</li>
      </ul>
      {running && (
        <p className="text-sm text-foreground flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin text-primary" /> Converting {Math.min(done + 1, total)} of {total}… keep this page open.</p>
      )}
      {result && !running && (
        <div className={`rounded-xl border px-3 py-2.5 text-sm ${result.failed.length ? "border-warning/40 bg-warning/5" : "border-success/30 bg-success/5"}`}>
          <p className="flex items-center gap-2 font-medium">
            {result.failed.length ? <AlertTriangle className="h-4 w-4 text-warning" /> : <CheckCircle2 className="h-4 w-4 text-success" />}
            {result.made} converted · {result.had} already played everywhere{result.failed.length ? ` · ${result.failed.length} couldn't be converted` : ""}
          </p>
          {result.failed.length > 0 && <p className="text-[11px] text-muted-foreground mt-1">{result.failed.slice(0, 12).join(" · ")}{result.failed.length > 12 ? " …" : ""}</p>}
        </div>
      )}
      <div className="flex justify-end">
        <Button type="button" onClick={run} disabled={running} className="btn-hero rounded-xl gap-1.5">
          {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Film className="h-4 w-4" />} Make every video play everywhere
        </Button>
      </div>
    </div>
  );
}
