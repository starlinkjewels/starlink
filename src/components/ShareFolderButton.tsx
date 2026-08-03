import { useState } from "react";
import { useAuth } from "@/lib/auth";
import { useDb } from "@/hooks/useDb";
import { type Share } from "@/lib/db";
import { buildCatalogItems, buildProductPhotoItems, saveShare, deleteShare, findShare, shareUrl, MAX_SHARE_ITEMS } from "@/lib/share";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Share2, Copy, Check, RefreshCw, Link2, Loader2, Trash2, ExternalLink } from "lucide-react";
import { toast } from "sonner";

/** Shares an entire folder (all its images + videos, incl. sub-folders) as a
 *  public, no-login link. Drops into the Catalog and Product Photos folder views. */
export function ShareFolderButton({ kind, folderId, folderName, compact }: {
  kind: Share["kind"]; folderId: string; folderName: string; compact?: boolean;
}) {
  const { user } = useAuth();
  const db = useDb(); // re-render when shares change
  const existing = findShare(kind, folderId);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const buildItems = async () =>
    kind === "catalog" ? await buildCatalogItems(folderId) : buildProductPhotoItems(folderId);

  const generate = async (refresh: boolean) => {
    setBusy(true);
    try {
      const items = await buildItems();
      if (items.length === 0) { toast.error("This folder has no photos or videos to share yet."); return; }
      saveShare({ kind, sourceFolderId: folderId, title: folderName, items, createdBy: user!.id });
      setOpen(true);
      if (refresh) toast.success(`Link updated · ${items.length} item${items.length !== 1 ? "s" : ""}`);
      if (items.length >= MAX_SHARE_ITEMS) toast.message(`Shared the first ${MAX_SHARE_ITEMS} items (folder is very large).`);
    } catch { toast.error("Couldn't create the share link."); }
    finally { setBusy(false); }
  };

  const onClick = () => { if (existing) setOpen(true); else generate(false); };

  const url = existing ? shareUrl(existing.id) : "";
  const copy = async () => {
    try { await navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 2000); toast.success("Link copied"); }
    catch { toast.error("Couldn't copy — long-press the link to copy it."); }
  };
  const stop = () => {
    if (!existing) return;
    if (!confirm("Stop sharing this folder? The public link will stop working.")) return;
    deleteShare(existing.id);
    setOpen(false);
    toast.success("Sharing stopped");
  };

  return (
    <>
      <button
        onClick={onClick}
        disabled={busy}
        className={compact
          ? "flex items-center gap-1.5 h-9 px-3 rounded-xl border border-border bg-white hover:bg-secondary text-xs font-medium text-brand-dark disabled:opacity-60"
          : "flex items-center gap-1.5 h-9 px-3 rounded-xl border border-border bg-white hover:bg-secondary text-sm font-medium text-brand-dark disabled:opacity-60"}
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Share2 className="h-4 w-4" />}
        {existing ? "Shared" : "Share"}
        {existing && <span className="h-1.5 w-1.5 rounded-full bg-success" />}
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md rounded-2xl">
          <DialogHeader>
            <DialogTitle className="font-display text-xl flex items-center gap-2"><Link2 className="h-5 w-5 text-primary" /> Public link</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground -mt-1">
            Anyone with this link can view <span className="font-medium text-foreground">{folderName}</span>
            {existing ? <> ({existing.count} item{existing.count !== 1 ? "s" : ""})</> : null} — no login needed. It shows a snapshot; tap <span className="font-medium text-foreground">Refresh</span> after adding more.
          </p>

          <div className="flex items-center gap-2 mt-1">
            <input readOnly value={url} onFocus={e => e.currentTarget.select()}
              className="flex-1 h-10 rounded-xl border border-border bg-secondary/40 px-3 text-sm font-mono truncate focus:outline-none focus:ring-2 focus:ring-primary/30" />
            <Button onClick={copy} className="btn-hero rounded-xl h-10 gap-1.5 shrink-0">
              {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}{copied ? "Copied" : "Copy"}
            </Button>
          </div>

          <div className="flex flex-wrap items-center gap-2 mt-2">
            <a href={url} target="_blank" rel="noopener noreferrer"
              className="flex items-center gap-1.5 h-9 px-3 rounded-xl border border-border bg-white hover:bg-secondary text-sm font-medium text-brand-dark">
              <ExternalLink className="h-4 w-4" /> Open
            </a>
            <button onClick={() => generate(true)} disabled={busy}
              className="flex items-center gap-1.5 h-9 px-3 rounded-xl border border-border bg-white hover:bg-secondary text-sm font-medium text-brand-dark disabled:opacity-60">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />} Refresh
            </button>
            <button onClick={stop}
              className="flex items-center gap-1.5 h-9 px-3 rounded-xl border border-border bg-white hover:bg-destructive/10 text-sm font-medium text-destructive ml-auto">
              <Trash2 className="h-4 w-4" /> Stop sharing
            </button>
          </div>
          {existing && <p className="text-[11px] text-muted-foreground">Last updated {new Date(existing.updatedAt).toLocaleString()}</p>}
          {/* db referenced so the button reflects share create/delete immediately */}
          <span className="hidden">{db.shares?.length}</span>
        </DialogContent>
      </Dialog>
    </>
  );
}
