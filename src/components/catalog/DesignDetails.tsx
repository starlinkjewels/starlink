// A catalogue file's design and its details, as read off the design's sheet
// (functions-specs): gold by karat, the stones, the sizes — and for staff, a
// check of the reading (correct it, confirm it, or have it read again). Shown
// beside the picture in the Catalog viewer and in Catalog → Please check.
import { useState } from "react";
import { CheckCircle2, FileSpreadsheet, Gem, Loader2, Pencil, Plus, RefreshCw, Ruler, Trash2, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { CellTag } from "@/components/DataTable";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/lib/auth";
import { useDb } from "@/hooks/useDb";
import { timeAgo, type CatalogItem } from "@/lib/db";
import { metalLabel, rereadFiles, saveCheckedSpecs, sortMetal, SPECS_STATUS, uncheckSpecs, useDesign, useItemSpecs, type CatalogDesign, type ItemSpecs } from "@/lib/catalogSpecs";
import { isSheetFile } from "@/lib/pure/catalogMedia";
import type { StoneRow } from "@/lib/pure/specParse";

const ct = (n?: number) => (n == null || !Number.isFinite(n) ? "—" : `${+n.toFixed(3)}`);

/** The details themselves: read-only. */
export function SpecsView({ specs }: { specs: ItemSpecs }) {
  const metal = sortMetal(specs.metal);
  const stones = specs.stones ?? [];
  return (
    <div className="space-y-4">
      {metal.length > 0 && (
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">Metal weight</p>
          <div className="grid grid-cols-2 gap-1.5">
            {metal.map(([k, g]) => (
              <div key={k} className="rounded-lg border border-border/70 bg-white px-2.5 py-1.5 flex items-baseline justify-between gap-2">
                <span className="text-xs text-muted-foreground">{metalLabel(k)}</span>
                <span className="text-sm font-semibold tabular-nums">{g} g</span>
              </div>
            ))}
          </div>
          {specs.metalTone && <p className="text-[11px] text-muted-foreground mt-1">Tone: {specs.metalTone}</p>}
        </div>
      )}
      {stones.length > 0 && (
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">Stones</p>
          <div className="overflow-x-auto rounded-lg border border-border/70">
            <table className="w-full text-xs">
              <thead className="bg-secondary/50 text-muted-foreground">
                <tr><th className="text-left px-2 py-1.5 font-medium">Shape</th><th className="text-left px-2 py-1.5 font-medium">Size</th><th className="text-right px-2 py-1.5 font-medium">Pcs</th><th className="text-right px-2 py-1.5 font-medium">Ct each</th><th className="text-right px-2 py-1.5 font-medium">Ct</th></tr>
              </thead>
              <tbody>
                {stones.map((r, i) => (
                  <tr key={i} className="border-t border-border/60">
                    <td className="px-2 py-1.5">{r.shape ?? "—"}</td>
                    <td className="px-2 py-1.5 text-muted-foreground">{[r.size, r.sieve].filter(Boolean).join(" · ") || "—"}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{r.pcs}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums text-muted-foreground">{ct(r.perStone)}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums font-medium">{ct(r.total)}</td>
                  </tr>
                ))}
              </tbody>
              {specs.stoneTotals && (
                <tfoot className="bg-secondary/30 font-semibold">
                  <tr className="border-t border-border"><td className="px-2 py-1.5" colSpan={2}>Total</td><td className="px-2 py-1.5 text-right tabular-nums">{specs.stoneTotals.pcs}</td><td /><td className="px-2 py-1.5 text-right tabular-nums">{ct(specs.stoneTotals.ct)}</td></tr>
                </tfoot>
              )}
            </table>
          </div>
        </div>
      )}
      {(specs.ringSize || (specs.dimsMm?.length ?? 0) > 0 || specs.subCategory) && (
        <div className="flex flex-wrap gap-1.5 text-xs">
          {specs.ringSize && <span className="inline-flex items-center gap-1 rounded-full bg-secondary px-2 py-1"><Ruler className="h-3 w-3" />Ring size {specs.ringSize}</span>}
          {(specs.dimsMm?.length ?? 0) > 0 && <span className="inline-flex items-center gap-1 rounded-full bg-secondary px-2 py-1">Sizes {specs.dimsMm!.slice(0, 6).join(" · ")} mm</span>}
          {specs.subCategory && <span className="rounded-full bg-secondary px-2 py-1">{specs.subCategory}</span>}
        </div>
      )}
      {!metal.length && !stones.length && <p className="text-sm text-muted-foreground">Nothing was read from this sheet yet.</p>}
      {(specs.notes?.length ?? 0) > 0 && <ul className="text-[11px] text-muted-foreground list-disc pl-4 space-y-0.5">{specs.notes!.map(n => <li key={n}>{n}</li>)}</ul>}
    </div>
  );
}

const KARATS = ["SILVER", "9K", "10K", "14K", "18K", "22K", "PLT"];
type Row = { shape: string; size: string; pcs: string; per: string; total: string };
const toRow = (r: StoneRow): Row => ({ shape: r.shape ?? "", size: [r.size, r.sieve].filter(Boolean).join(" "), pcs: String(r.pcs ?? ""), per: r.perStone ? String(r.perStone) : "", total: r.total ? String(r.total) : "" });

/** Correct a reading, or enter the details by hand where nothing could be read: saved as checked, never read over. */
export function SpecsEditor({ itemId, base, onDone }: { itemId: string; base: ItemSpecs | null; onDone(): void }) {
  const { user } = useAuth();
  const [rows, setRows] = useState<Row[]>(() => (base?.stones?.length ? base.stones.map(toRow) : [{ shape: "", size: "", pcs: "", per: "", total: "" }]));
  const [metal, setMetal] = useState<{ k: string; g: string }[]>(() => { const m = sortMetal(base?.metal).map(([k, g]) => ({ k, g: String(g) })); return m.length ? m : [{ k: "14K", g: "" }]; });
  const [ring, setRing] = useState(base?.ringSize ?? "");
  const [dims, setDims] = useState((base?.dimsMm ?? []).join(", "));
  const [busy, setBusy] = useState(false);
  const num = (s: string) => { const v = Number(String(s).replace(",", ".")); return Number.isFinite(v) && v >= 0 ? v : 0; };
  const setRow = (i: number, p: Partial<Row>) => setRows(rs => rs.map((r, j) => (j === i ? { ...r, ...p } : r)));
  const totalOf = (r: Row) => (r.total.trim() ? num(r.total) : Math.round(num(r.pcs) * num(r.per) * 1000) / 1000);
  const save = async () => {
    setBusy(true);
    try {
      await saveCheckedSpecs(itemId, {
        stones: rows.filter(r => num(r.pcs) > 0 || totalOf(r) > 0).map(r => ({ shape: r.shape.trim() || undefined, size: r.size.trim() || undefined, pcs: Math.round(num(r.pcs)), perStone: num(r.per) || (num(r.pcs) ? Math.round((totalOf(r) / num(r.pcs)) * 10000) / 10000 : 0), total: totalOf(r) })),
        metal: Object.fromEntries(metal.filter(m => num(m.g) > 0).map(m => [m.k, num(m.g)])),
        dimsMm: dims.split(/[,\s]+/).map(num).filter(x => x > 0),
        ringSize: ring.trim() || undefined,
      }, user!.id, base);
      toast.success("Details saved and marked checked");
      onDone();
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <div className="space-y-4">
      <div>
        <Label className="text-xs">Metal weight (g)</Label>
        <div className="mt-1 space-y-1.5">
          {metal.map((m, i) => (
            <div key={i} className="flex gap-1.5">
              <select aria-label="Karat" className="h-9 rounded-lg border border-input bg-white px-2 text-sm" value={m.k} onChange={e => setMetal(ms => ms.map((x, j) => (j === i ? { ...x, k: e.target.value } : x)))}>
                {KARATS.map(k => <option key={k} value={k}>{metalLabel(k)}</option>)}
              </select>
              <Input type="number" inputMode="decimal" step="any" min={0} className="h-9 flex-1" value={m.g} onChange={e => setMetal(ms => ms.map((x, j) => (j === i ? { ...x, g: e.target.value } : x)))} placeholder="Grams" />
              <Button type="button" variant="ghost" size="icon" className="h-9 w-9" aria-label="Remove" onClick={() => setMetal(ms => ms.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" /></Button>
            </div>
          ))}
          <Button type="button" variant="outline" size="sm" className="gap-1" onClick={() => setMetal(ms => [...ms, { k: KARATS.find(k => !ms.some(x => x.k === k)) ?? "18K", g: "" }])}><Plus className="h-3.5 w-3.5" />Karat</Button>
        </div>
      </div>
      <div>
        <Label className="text-xs">Stones</Label>
        <div className="mt-1 space-y-2">
          {rows.map((r, i) => (
            <div key={i} className="rounded-lg border border-border/70 p-2 grid grid-cols-6 gap-1.5 items-end">
              <div className="col-span-3"><span className="text-[10px] text-muted-foreground">Shape</span><Input className="h-8" value={r.shape} onChange={e => setRow(i, { shape: e.target.value })} placeholder="Round" /></div>
              <div className="col-span-3"><span className="text-[10px] text-muted-foreground">Size / sieve</span><Input className="h-8" value={r.size} onChange={e => setRow(i, { size: e.target.value })} placeholder="1.30 mm" /></div>
              <div className="col-span-2"><span className="text-[10px] text-muted-foreground">Pcs</span><Input className="h-8" type="number" inputMode="numeric" min={0} value={r.pcs} onChange={e => setRow(i, { pcs: e.target.value })} /></div>
              <div className="col-span-2"><span className="text-[10px] text-muted-foreground">Ct each</span><Input className="h-8" type="number" inputMode="decimal" step="any" min={0} value={r.per} onChange={e => setRow(i, { per: e.target.value })} /></div>
              <div className="col-span-2 flex gap-1 items-end">
                <div className="flex-1 min-w-0"><span className="text-[10px] text-muted-foreground">Ct</span><Input className="h-8" type="number" inputMode="decimal" step="any" min={0} value={r.total} onChange={e => setRow(i, { total: e.target.value })} placeholder={totalOf(r) ? String(totalOf(r)) : ""} /></div>
                <Button type="button" variant="ghost" size="icon" className="h-8 w-8 shrink-0" aria-label="Remove stone" onClick={() => setRows(rs => rs.filter((_, j) => j !== i))}><Trash2 className="h-3.5 w-3.5" /></Button>
              </div>
            </div>
          ))}
          <div className="flex items-center justify-between gap-2">
            <Button type="button" variant="outline" size="sm" className="gap-1" onClick={() => setRows(rs => [...rs, { shape: "", size: "", pcs: "", per: "", total: "" }])}><Plus className="h-3.5 w-3.5" />Stone</Button>
            <span className="text-xs text-muted-foreground tabular-nums">Total {rows.reduce((a, r) => a + num(r.pcs), 0)} pcs · {ct(rows.reduce((a, r) => a + totalOf(r), 0))} ct</span>
          </div>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div><Label className="text-xs">Ring size</Label><Input className="h-9 mt-1" value={ring} onChange={e => setRing(e.target.value)} placeholder="6.5 US" /></div>
        <div><Label className="text-xs">Sizes (mm)</Label><Input className="h-9 mt-1" value={dims} onChange={e => setDims(e.target.value)} placeholder="22.5, 8" /></div>
      </div>
      <div className="flex gap-2 justify-end">
        <Button type="button" variant="ghost" onClick={onDone} disabled={busy}>Cancel</Button>
        <Button type="button" onClick={save} disabled={busy} className="gap-1.5">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}Save as checked</Button>
      </div>
    </div>
  );
}

/** A design's details with its status, where they came from and — for staff — the check. */
export function DesignDetailsBody({ design, sheetItem, item, staff }: { design: CatalogDesign; sheetItem?: { id: string; name: string }; item?: CatalogItem; staff: boolean }) {
  const db = useDb();
  const { user } = useAuth();
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState("");
  const specs = design.specs;
  const st = SPECS_STATUS[design.status === "none" ? "none" : design.status];
  const who = specs?.checkedBy ? db.users.find(u => u.id === specs.checkedBy)?.name ?? "staff" : "";
  // Where a check is saved: the design's sheet, else this file (a picture or Excel file) — details typed by hand make it the sheet.
  const target = design.sheetId ?? (item && (item.type === "image" || isSheetFile(item.name)) ? item.id : undefined);
  const targetName = sheetItem?.name ?? design.items[target ?? ""]?.n ?? item?.name;
  const reread = async (ids: string[]) => {
    setBusy("reread");
    try { const r = await rereadFiles(ids); toast.success(r.queued ? `Reading ${r.queued === 1 ? "it" : `${r.queued} files`} again — a few seconds` : "Nothing to read again (checked by a person, or not a picture or Excel sheet)"); }
    catch (e) { toast.error((e as Error).message); } finally { setBusy(""); }
  };
  if (editing && target) return <SpecsEditor itemId={target} base={specs} onDone={() => setEditing(false)} />;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <CellTag tone={st.tone === "neutral" ? "neutral" : st.tone}>{specs?.checkedBy ? "Checked" : st.label}</CellTag>
        <span className="text-xs text-muted-foreground">
          {design.counts.pictures} picture{design.counts.pictures === 1 ? "" : "s"}{design.counts.spin ? ` · 360° (${design.counts.spin})` : ""}{design.counts.sheets ? ` · ${design.counts.sheets} sheet${design.counts.sheets === 1 ? "" : "s"}` : ""}{design.counts.videos ? ` · ${design.counts.videos} video${design.counts.videos === 1 ? "" : "s"}` : ""}{staff && design.counts.cad ? ` · ${design.counts.cad} CAD` : ""}
        </span>
      </div>
      {design.reasons.length > 0 && !specs?.checkedBy && (
        <ul className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 space-y-0.5 list-disc pl-6">
          {design.reasons.slice(0, 6).map(r => <li key={r}>{r}</li>)}
        </ul>
      )}
      {specs ? <SpecsView specs={specs} /> : <p className="text-sm text-muted-foreground">No sheet with a table has been read for this design yet.{staff && target ? " You can enter its details by hand." : ""}</p>}
      {specs && (
        <p className="text-[11px] text-muted-foreground flex items-center gap-1">
          {specs.via === "excel" ? <FileSpreadsheet className="h-3 w-3" /> : <Gem className="h-3 w-3" />}
          {specs.checkedBy ? `Checked by ${who} ${timeAgo(specs.checkedAt).toLowerCase()}` : `Read from ${targetName ?? "its sheet"} ${timeAgo(specs.at).toLowerCase()}`}
        </p>
      )}
      {staff && target && (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant={design.status === "review" || !specs ? "default" : "outline"} className="gap-1.5" onClick={() => setEditing(true)}><Pencil className="h-3.5 w-3.5" />{specs ? "Check & correct" : "Enter details"}</Button>
          {specs && !specs.checkedBy && design.status === "review" && (
            <Button size="sm" variant="outline" className="gap-1.5" disabled={!!busy} onClick={async () => {
              setBusy("ok");
              try { await saveCheckedSpecs(target, { stones: specs.stones ?? [], metal: specs.metal ?? {}, dimsMm: specs.dimsMm ?? [], ringSize: specs.ringSize, metalTone: specs.metalTone, subCategory: specs.subCategory }, user!.id, specs); toast.success("Marked checked"); }
              catch (e) { toast.error((e as Error).message); } finally { setBusy(""); }
            }}><CheckCircle2 className="h-3.5 w-3.5" />It's right</Button>
          )}
          {specs?.checkedBy ? (
            <Button size="sm" variant="ghost" className="gap-1.5" disabled={!!busy} onClick={async () => { setBusy("un"); try { await uncheckSpecs(target); toast.success("Check removed — reading it again"); } catch (e) { toast.error((e as Error).message); } finally { setBusy(""); } }}><Undo2 className="h-3.5 w-3.5" />Remove check</Button>
          ) : (
            <Button size="sm" variant="ghost" className="gap-1.5" disabled={!!busy} onClick={() => reread(design.media.sheets.length ? design.media.sheets : [target])}><RefreshCw className={`h-3.5 w-3.5 ${busy === "reread" ? "animate-spin" : ""}`} />Read again</Button>
          )}
        </div>
      )}
    </div>
  );
}
/** For one catalogue file: its design's details, live. */
export function DesignDetails({ item, staff }: { item: CatalogItem; staff: boolean }) {
  const live = useItemSpecs(item.id);
  const key = item.design?.key;
  const design = useDesign(key);
  // A client sees clean or checked details only — never a reading still to check.
  if (!staff) {
    if (!design || design.status !== "ok" || !design.specs) return <p className="text-sm text-muted-foreground">{design === undefined && key ? "Loading…" : "Details for this design are not ready yet."}</p>;
    return <SpecsView specs={design.specs} />;
  }
  if (live?.status === "queued") return <p className="text-sm text-muted-foreground flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" />Reading this sheet… it takes a few seconds.</p>;
  const again = live?.pending ? <p className="text-xs text-muted-foreground flex items-center gap-1.5 mb-3"><Loader2 className="h-3.5 w-3.5 animate-spin" />Reading it again — the details below stay until then.</p> : null;
  if (!key) return <p className="text-sm text-muted-foreground">This file isn't filed under a design yet — that happens when it is uploaded, or when the catalogue is read (Settings → Catalogue reading).</p>;
  if (design === undefined) return <p className="text-sm text-muted-foreground flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" />Loading…</p>;
  if (!design) return <p className="text-sm text-muted-foreground">No details for this design yet.</p>;
  return <>{again}<DesignDetailsBody design={design} item={item} staff={staff} sheetItem={design.sheetId ? { id: design.sheetId, name: design.items[design.sheetId]?.n ?? "" } : undefined} /></>;
}
