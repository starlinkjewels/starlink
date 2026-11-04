// Catalog → Please check: the designs whose sheet reading didn't add up (rows
// that don't make the total, a gold weight out of order, two sheets that
// disagree…), newest first, a page at a time. Each opens beside its sheet, to
// correct or confirm — then it is checked, and never read over.
import { useCallback, useEffect, useState } from "react";
import { ClipboardCheck, ExternalLink, Loader2 } from "lucide-react";
import { Link } from "react-router-dom";
import { PageHeader } from "@/components/PageHeader";
import { ActionSheet } from "@/components/ActionSheet";
import { Button } from "@/components/ui/button";
import { DesignDetailsBody } from "@/components/catalog/DesignDetails";
import { fetchCatalogItemsByIds } from "@/lib/catalogItems";
import { fetchDesignsToCheck, useDesign, type CatalogDesign } from "@/lib/catalogSpecs";
import { useAuth } from "@/lib/auth";
import { timeAgo, type CatalogItem } from "@/lib/db";
import { doc, getDoc, type DocumentData, type QueryDocumentSnapshot } from "firebase/firestore";
import { db as fsdb } from "@/lib/firebase";

function CheckSheet({ designKey, onClose }: { designKey: string; onClose(): void }) {
  const design = useDesign(designKey);
  const [sheet, setSheet] = useState<CatalogItem | null>(null);
  const sheetId = design?.sheetId ?? design?.media.sheets[0];
  useEffect(() => { if (sheetId) void fetchCatalogItemsByIds([sheetId]).then(r => setSheet(r[0] ?? null)); }, [sheetId]);
  return (
    <ActionSheet open onOpenChange={o => { if (!o) onClose(); }} size="xl" icon={ClipboardCheck} title={design?.designNo ?? "Design"} description={design?.reasons[0]}>
      {!design ? <p className="text-sm text-muted-foreground flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" />Loading…</p> : (
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_380px]">
          <div className="min-w-0">
            {sheet?.type === "image" ? (
              <a href={sheet.data} target="_blank" rel="noopener noreferrer" className="block rounded-xl border border-border overflow-hidden bg-secondary/20" title="Open full size">
                <img src={sheet.data} alt={sheet.name} className="w-full h-auto" />
              </a>
            ) : sheet ? (
              <a href={sheet.data} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-sm text-primary underline">{sheet.name}<ExternalLink className="h-3.5 w-3.5" /></a>
            ) : <p className="text-sm text-muted-foreground">Loading the sheet…</p>}
            {sheet && <p className="text-[11px] text-muted-foreground mt-1.5">{sheet.name} — tap it to open full size</p>}
          </div>
          <DesignDetailsBody design={design} staff sheetItem={sheet ? { id: sheet.id, name: sheet.name } : undefined} />
        </div>
      )}
    </ActionSheet>
  );
}

export function CatalogCheckPage() {
  const { user } = useAuth();
  const staff = user?.role === "admin" || user?.role === "employee";
  const [rows, setRows] = useState<CatalogDesign[]>([]);
  const [cursor, setCursor] = useState<QueryDocumentSnapshot<DocumentData> | null>(null);
  const [more, setMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState<string | null>(null);
  const [thumbs, setThumbs] = useState<Record<string, CatalogItem>>({});

  const load = useCallback(async (from: QueryDocumentSnapshot<DocumentData> | null) => {
    setLoading(true);
    try {
      const p = await fetchDesignsToCheck(from);
      setRows(r => (from ? [...r, ...p.rows] : p.rows));
      setCursor(p.cursor); setMore(p.more);
      const ids = p.rows.map(d => d.sheetId ?? d.media.sheets[0]).filter(Boolean) as string[];
      const got = await fetchCatalogItemsByIds(ids);
      setThumbs(t => ({ ...t, ...Object.fromEntries(got.map(i => [i.id, i])) }));
    } finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(null); }, [load]);
  // Checked (or no longer needing it): off the list.
  const closed = async (key: string) => {
    setOpen(null);
    const d = await getDoc(doc(fsdb, "catalogDesigns", key)).catch(() => null);
    if (d && (!d.exists() || d.get("status") !== "review")) setRows(r => r.filter(x => x.key !== key));
  };

  if (!staff) return <div className="p-6 text-sm text-muted-foreground">Only staff can check the catalogue's readings.</div>;
  return (
    <div className="space-y-4">
      <PageHeader title="Please check" subtitle="Sheets whose reading didn't add up — correct or confirm each one" back={{ label: "Catalog", to: "/catalog" }} />
      {rows.length === 0 && !loading && (
        <div className="card-luxe p-8 text-center text-sm text-muted-foreground">Nothing to check. <Link to="/settings?tab=catalogread" className="text-primary underline">Catalogue reading</Link></div>
      )}
      <div className="grid gap-3 grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
        {rows.map(d => {
          const t = thumbs[d.sheetId ?? d.media.sheets[0] ?? ""];
          return (
            <button key={d.key} type="button" onClick={() => setOpen(d.key)} className="text-left rounded-2xl border border-border/60 bg-white shadow-sm overflow-hidden hover:shadow-md transition-shadow">
              <div className="aspect-[4/3] bg-secondary/30 overflow-hidden">{t?.type === "image" && <img src={t.thumb || t.data} alt={d.designNo} loading="lazy" className="w-full h-full object-cover" />}</div>
              <div className="p-2.5 space-y-1">
                <p className="text-sm font-semibold truncate">{d.designNo}</p>
                <p className="text-[11px] text-muted-foreground line-clamp-2">{d.reasons[0] ?? "Please check"}</p>
                <p className="text-[10px] text-muted-foreground">{timeAgo(d.updatedAt)}</p>
              </div>
            </button>
          );
        })}
      </div>
      {(more || loading) && (
        <div className="flex justify-center">
          <Button variant="outline" disabled={loading} onClick={() => load(cursor)}>{loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Show more"}</Button>
        </div>
      )}
      {open && <CheckSheet designKey={open} onClose={() => void closed(open)} />}
    </div>
  );
}
