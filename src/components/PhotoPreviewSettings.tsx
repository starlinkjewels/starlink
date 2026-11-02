import { useCallback, useEffect, useRef, useState } from "react";
import { Images, CheckCircle2, AlertTriangle, Loader2, Square } from "lucide-react";
import { toast } from "sonner";
import { ensureCollections, loadDb, updateDbAs } from "@/lib/db";
import { fetchAllCatalogItems } from "@/lib/catalogItems";
import { setCatalogItemThumb } from "@/lib/catalogItemEdit";
import { previewForStored, dropPreview, addPreviewsToShares } from "@/lib/photoPreview";
import { Button } from "@/components/ui/button";
import { SectionTitle } from "@/components/SectionTitle";

/** One photo or video still without its preview. */
interface Job {
  from: "catalog" | "photos";
  id: string;
  url: string;
  type: "image" | "video";
  /** Where its preview goes if the original's own folder can't be read off its address. */
  folder: string;
  label: string;
}
interface Scan { jobs: Job[]; images: number; videos: number; had: Map<string, string> }
interface Result { made: number; failed: string[]; stopped: boolean; links: number }

const AT_ONCE = 3;
/** Product Photos previews are saved this many at a time (each save writes the changed records). */
const SAVE_EVERY = 10;

/** Every Catalog and Product Photos photo/video, and which have no preview yet. */
async function scanAll(): Promise<Scan> {
  await ensureCollections(["catalogFolders", "productPhotoFolders", "productPhotoItems", "shares"]).catch(() => {});
  const d = loadDb();
  const catalog = await fetchAllCatalogItems((d.catalogFolders ?? []).map(f => f.id));
  const jobs: Job[] = [];
  const had = new Map<string, string>();
  for (const c of catalog) {
    if ((c.type !== "image" && c.type !== "video") || !c.data) continue;
    if (c.thumb) had.set(c.data, c.thumb);
    else jobs.push({ from: "catalog", id: c.id, url: c.data, type: c.type, folder: `catalog/${c.folderId}`, label: `Catalog ${c.name}` });
  }
  for (const p of d.productPhotoItems ?? []) {
    if (!p.url) continue;
    if (p.thumb) had.set(p.url, p.thumb);
    else jobs.push({ from: "photos", id: p.id, url: p.url, type: p.type, folder: `productPhotos/${p.folderId}`, label: `Product Photos ${p.name}` });
  }
  return { jobs, images: jobs.filter(j => j.type === "image").length, videos: jobs.filter(j => j.type === "video").length, had };
}

/**
 * Settings → Photo previews. Every Catalog and Product Photos photo and video
 * already in the app gets its small preview (lib/photoPreview.ts), three at a
 * time — so folders and share links open fast. One that has a preview is
 * skipped, so it can be stopped and run again. The originals are only read,
 * never changed. New uploads get theirs on their own.
 */
export function PhotoPreviewSettings() {
  const [scan, setScan] = useState<Scan | null>(null);
  const [checking, setChecking] = useState(false);
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(0);
  const [total, setTotal] = useState(0);
  const [result, setResult] = useState<Result | null>(null);
  const stop = useRef(false);
  const [stopping, setStopping] = useState(false);

  const check = useCallback(async () => {
    setChecking(true);
    try { const s = await scanAll(); setScan(s); return s; }
    catch (e) { toast.error(`Couldn't count the photos — ${e instanceof Error ? e.message : String(e)}`); return null; }
    finally { setChecking(false); }
  }, []);
  useEffect(() => { void check(); }, [check]);

  const run = async () => {
    setRunning(true); setResult(null); stop.current = false; setStopping(false);
    try {
      const s = await scanAll();
      setScan(s);
      const list = s.jobs;
      setTotal(list.length); setDone(0);
      const made = new Map<string, string>(); // original's address → its preview
      const failed: string[] = [];
      let pending: { id: string; thumb: string }[] = [];

      // Product Photos: a few at a time into one save; a photo deleted meanwhile
      // doesn't keep the preview just made for it.
      const savePending = () => {
        if (!pending.length) return;
        const batch = pending; pending = [];
        const live = new Set((loadDb().productPhotoItems ?? []).map(p => p.id));
        for (const b of batch) if (!live.has(b.id)) dropPreview(b.thumb);
        const keep = batch.filter(b => live.has(b.id));
        if (!keep.length) return;
        updateDbAs({ summary: `Previews made for ${keep.length} product photo${keep.length !== 1 ? "s" : ""}` }, d => {
          for (const b of keep) { const x = (d.productPhotoItems ?? []).find(p => p.id === b.id); if (x && !x.thumb) x.thumb = b.thumb; }
        });
      };

      const one = async (j: Job) => {
        try {
          const thumb = await previewForStored(j.url, j.type, j.folder);
          if (j.from === "catalog") {
            try { await setCatalogItemThumb(j.id, thumb); }
            catch (e) { dropPreview(thumb); throw e; } // the item went meanwhile
          } else {
            pending.push({ id: j.id, thumb });
            if (pending.length >= SAVE_EVERY) savePending();
          }
          made.set(j.url, thumb);
        } catch (e) {
          failed.push(j.label);
          console.warn("[preview]", j.label, e instanceof Error ? e.message : e);
        }
        setDone(n => n + 1);
      };

      let next = 0;
      const worker = async () => {
        while (next < list.length && !stop.current) await one(list[next++]);
      };
      try {
        await Promise.all(Array.from({ length: Math.min(AT_ONCE, list.length) }, worker));
      } finally { savePending(); }

      // A folder's chosen cover shows its small copy too (only the card shows it).
      const coverOf = new Map(list.filter(j => j.from === "catalog" && made.has(j.url)).map(j => [j.id, made.get(j.url)!]));
      const covers = (loadDb().catalogFolders ?? []).filter(f => f.bannerItemId && coverOf.has(f.bannerItemId)).map(f => f.id);
      if (covers.length) {
        updateDbAs({ summary: "Folder covers use their small previews" }, d => {
          for (const f of d.catalogFolders ?? []) if (covers.includes(f.id) && f.bannerItemId) f.bannerUrl = coverOf.get(f.bannerItemId) ?? f.bannerUrl;
        });
      }

      // Links already shared show the previews too.
      let links = 0;
      try { links = await addPreviewsToShares(new Map([...s.had, ...made])); }
      catch (e) { toast.error(`Previews made, but shared links weren't updated — ${e instanceof Error ? e.message : String(e)}`); }

      const stopped = stop.current && next < list.length;
      setResult({ made: made.size, failed, stopped, links });
      if (stopped) toast.info(`Stopped — ${made.size} preview${made.size !== 1 ? "s" : ""} made. Run it again to go on.`);
      else if (failed.length) toast.warning(`${made.size} of ${list.length} previews made — ${failed.length} couldn't be made`);
      else toast.success(list.length ? `All ${list.length} previews made` : "Every photo and video has its preview");
    } catch (e) {
      toast.error(`Previews stopped — ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setRunning(false);
      void check();
    }
  };

  const left = scan ? scan.jobs.length : 0;
  const count = (n: number, one: string) => `${n} ${one}${n !== 1 ? "s" : ""}`;

  return (
    <div className="card-luxe p-6 space-y-4">
      <SectionTitle icon={Images} title="Photo previews" sub="Folders and share links open fast"
        info="Catalog photos are kept full size — several MB each — so a folder or a share link was slow to open. A small copy (about 50 KB) beside each one is what the grid shows; tapping still opens the original." />
      <ul className="text-[11px] text-muted-foreground space-y-0.5 list-disc pl-4">
        <li>New photos and videos in Catalog and Product Photos get their preview on their own. A video's is a still from it.</li>
        <li>This makes previews for the ones already there, three at a time. Ones that have a preview are skipped — stop any time and run it again.</li>
        <li>The original is never changed or removed; opening, Download, PDFs and share links still give the original.</li>
      </ul>
      <p className="text-sm text-foreground flex items-center gap-2">
        {checking && !running ? <><Loader2 className="h-4 w-4 animate-spin text-primary" /> Counting…</>
          : !scan ? null
          : left ? <>{[scan.images ? count(scan.images, "photo") : "", scan.videos ? count(scan.videos, "video") : ""].filter(Boolean).join(" and ")} without a preview</>
          : <><CheckCircle2 className="h-4 w-4 text-success" /> Every photo and video has its preview</>}
      </p>
      {running && (
        <p className="text-sm text-foreground flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin text-primary" /> {stopping ? "Stopping…" : `Making ${Math.min(done + 1, total)} of ${total}… keep this page open.`}</p>
      )}
      {result && !running && (
        <div className={`rounded-xl border px-3 py-2.5 text-sm ${result.failed.length ? "border-warning/40 bg-warning/5" : "border-success/30 bg-success/5"}`}>
          <p className="flex items-center gap-2 font-medium">
            {result.failed.length ? <AlertTriangle className="h-4 w-4 text-warning" /> : <CheckCircle2 className="h-4 w-4 text-success" />}
            {result.made} made{result.failed.length ? ` · ${result.failed.length} couldn't be made` : ""}{result.links ? ` · ${count(result.links, "shared link")} updated` : ""}{result.stopped ? " · stopped" : ""}
          </p>
          {result.failed.length > 0 && <p className="text-[11px] text-muted-foreground mt-1">{result.failed.slice(0, 12).join(" · ")}{result.failed.length > 12 ? " …" : ""}</p>}
        </div>
      )}
      <div className="flex justify-end gap-2">
        {running && (
          <Button type="button" variant="outline" onClick={() => { stop.current = true; setStopping(true); }} disabled={stopping} className="rounded-xl gap-1.5">
            <Square className="h-3.5 w-3.5" /> Stop
          </Button>
        )}
        <Button type="button" onClick={run} disabled={running || checking || !left} className="btn-hero rounded-xl gap-1.5">
          {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Images className="h-4 w-4" />} Make previews
        </Button>
      </div>
    </div>
  );
}
