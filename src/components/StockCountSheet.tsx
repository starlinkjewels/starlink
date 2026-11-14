import { useMemo, useState } from "react";
import { toast } from "sonner";
import { ClipboardCheck } from "lucide-react";
import { ActionSheet } from "@/components/ActionSheet";
import { Button } from "@/components/ui/button";
import { AsyncButton } from "@/components/AsyncButton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CompanyPicker, useMultiCo } from "@/components/CompanyFields";
import { useDb } from "@/hooks/useDb";
import { useAuth } from "@/lib/auth";
import { confirmBox } from "@/lib/confirm";
import { fmtDate } from "@/lib/db";
import { materialDefs, materialName, materialUnit } from "@/lib/materials";
import { lotLabel } from "@/lib/diamondLots";
import { bagNoOf } from "@/lib/diamondBags";
import { discardCount, missingReasons, postCount, postPlan, saveCount, startCount, stockCounts, type StockCount } from "@/lib/stockCount";

/**
 * Stock → ⋯ Stock count (admins): count what is really on the shelf, line by line — saving the count
 * changes nothing — then Post differences, each with a reason (lib/stockCount.ts).
 */
export function StockCountSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const db = useDb();
  const { user } = useAuth();
  const multiCo = useMultiCo();
  const [material, setMaterial] = useState("gold");
  const [co, setCo] = useState("main");
  const [count, setCount] = useState<StockCount | null>(null);
  const [posting, setPosting] = useState(false);
  const mats = [{ id: "gold", name: "Gold" }, { id: "diamond", name: "Loose diamonds" }, ...materialDefs(db.settings).map(m => ({ id: m.id, name: m.name }))];
  const unit = material === "gold" ? "g" : material === "diamond" ? "ct" : materialUnit(db.settings, material);
  const past = stockCounts(db).filter(c => c.status === "posted").slice(0, 6);
  const plan = useMemo(() => (count ? postPlan(db, count) : []), [db, count]);
  const label = (key: string) => material === "diamond" ? `${bagNoOf(db, key) ? `${bagNoOf(db, key)} · ` : ""}${lotLabel(key)}` : key;

  const begin = () => setCount(startCount(material, co, user!.name));
  const setLine = (key: string, patch: Partial<StockCount["lines"][number]>) =>
    setCount(c => (c ? { ...c, lines: c.lines.map(l => (l.key === key ? { ...l, ...patch } : l)) } : c));
  const num = (s: string) => (s.trim() === "" ? undefined : Number(s));

  const save = () => { if (!count) return; saveCount(count); toast.success(`Count ${count.no} saved — nothing in stock changed`); };
  const post = async () => {
    if (!count) return;
    saveCount(count);
    const miss = missingReasons(db, count);
    if (miss.length) { toast.error(`Give a reason for every difference first (${miss.length})`); return; }
    const moved = plan.filter(p => p.moved);
    if (!moved.length) { toast.error("Nothing differs from the book — nothing to post"); return; }
    if (!(await confirmBox([`Post ${moved.length} difference${moved.length === 1 ? "" : "s"} from count ${count.no}?`, "",
      ...moved.slice(0, 12).map(p => `• ${label(p.line.key)}: ${p.diff > 0 ? "+" : ""}${p.diff} ${unit}${p.pcsTo != null ? ` · stones → ${p.pcsTo}` : ""} — ${p.line.reason}`),
      moved.length > 12 ? `…and ${moved.length - 12} more` : "", "", "Stock changes by these amounts, against the book as it is now. Each is in Movement history."].filter(s => s !== undefined)))) return;
    setPosting(true);
    try {
      const n = await postCount(count, { id: user!.id, name: user!.name });
      toast.success(`Count ${count.no} posted — ${n} line${n === 1 ? "" : "s"} corrected`);
      setCount(null);
    } catch (e) { toast.error(e instanceof Error ? e.message : "Couldn't post it — try again; lines already posted are kept"); }
    finally { setPosting(false); }
  };
  const discard = async () => {
    if (!count) return;
    if (!(await confirmBox(`Throw away count ${count.no}?\n\nNothing was posted from it, so stock stays as it is.`))) return;
    discardCount(count.id); setCount(null);
  };

  return (
    <ActionSheet open={open} onOpenChange={onOpenChange} size="xl" icon={ClipboardCheck} title={count ? `Stock count ${count.no}` : "Stock count"}
      description={count ? `${materialName(db.settings, count.material) || mats.find(m => m.id === count.material)?.name} · started ${fmtDate(count.startedAt)} by ${count.byName} — saving changes nothing; Post differences corrects stock` : "Count what is really there; then post the differences, each with a reason"}
      footer={count ? (
        <div className="flex flex-wrap justify-between gap-2">
          <Button variant="outline" onClick={discard} className="rounded-xl">Throw away</Button>
          <div className="flex gap-2">
            <Button variant="outline" onClick={save} className="rounded-xl">Save count</Button>
            <AsyncButton onClick={post} disabled={posting} className="btn-hero rounded-xl px-6">{posting ? "Posting…" : `Post differences${plan.filter(p => p.moved).length ? ` (${plan.filter(p => p.moved).length})` : ""}`}</AsyncButton>
          </div>
        </div>
      ) : (
        <div className="flex justify-end"><Button onClick={begin} className="btn-hero rounded-xl px-6">Start counting</Button></div>
      )}>
      {!count ? (
        <div className="space-y-4">
          <div className="grid sm:grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">What to count</Label>
              <Select value={material} onValueChange={setMaterial}>
                <SelectTrigger className="h-10 rounded-xl mt-1" aria-label="What to count"><SelectValue /></SelectTrigger>
                <SelectContent>{mats.map(m => <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            {multiCo && <CompanyPicker value={co} onChange={setCo} label="Whose stock" />}
          </div>
          <p className="text-xs text-muted-foreground">A count already started for this is picked up where it was left. Certified stones and Ready Stock pieces are counted on their own pages.</p>
          {past.length > 0 && (
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">Posted counts</p>
              <ul className="text-sm divide-y divide-border/60 rounded-xl border border-border/70 px-3">
                {past.map(c => {
                  const changed = c.lines.filter(l => l.posted && (Math.abs(l.posted.diff) > 0.0005 || l.posted.pcsTo != null)).length;
                  return <li key={c.id} className="py-2 flex justify-between gap-3"><span><span className="font-mono text-xs font-semibold">{c.no}</span> · {mats.find(m => m.id === c.material)?.name ?? c.material}</span><span className="text-muted-foreground text-xs">{c.postedAt ? fmtDate(c.postedAt) : ""} · {changed} line{changed === 1 ? "" : "s"} corrected · {c.postedBy}</span></li>;
                })}
              </ul>
            </div>
          )}
        </div>
      ) : count.lines.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nothing of this is in stock on the book.</p>
      ) : (
        <div className="space-y-2">
          <div className="hidden sm:grid grid-cols-[minmax(0,1fr)_90px_110px_80px_minmax(0,1fr)] gap-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground px-1">
            <span>Item</span><span className="text-right">Book</span><span>Counted</span><span className="text-right">Difference</span><span>Reason</span>
          </div>
          {count.lines.map(l => {
            const p = plan.find(x => x.line.key === l.key);
            const diff = l.counted != null ? Math.round((l.counted - l.book) * 1000) / 1000 : null;
            return (
              <div key={l.key} className="grid grid-cols-2 sm:grid-cols-[minmax(0,1fr)_90px_110px_80px_minmax(0,1fr)] gap-2 items-center rounded-xl border border-border/60 p-2">
                <span className="col-span-2 sm:col-span-1 text-sm font-medium truncate" title={label(l.key)}>{label(l.key)}{l.posted && <span className="ml-2 text-[10px] text-success">posted</span>}</span>
                <span className="text-sm tabular-nums sm:text-right">{l.book} {unit}{material === "diamond" && l.bookPcs != null ? <span className="block text-[10px] text-muted-foreground">{l.bookPcs} pcs</span> : null}</span>
                <span className="flex gap-1">
                  <Input aria-label={`Counted ${l.key}`} type="number" step="any" min={0} value={l.counted ?? ""} disabled={!!l.posted}
                    onChange={e => setLine(l.key, { counted: num(e.target.value) })} className="h-9 rounded-lg" placeholder={String(l.book)} />
                  {material === "diamond" && <Input aria-label={`Stones ${l.key}`} type="number" step={1} min={0} value={l.countedPcs ?? ""} disabled={!!l.posted}
                    onChange={e => setLine(l.key, { countedPcs: num(e.target.value) })} className="h-9 rounded-lg w-16" placeholder="pcs" />}
                </span>
                <span className={`text-sm tabular-nums sm:text-right ${diff == null || Math.abs(diff) < 0.0005 ? "text-muted-foreground" : diff > 0 ? "text-success" : "text-destructive"}`}>
                  {diff == null ? "—" : `${diff > 0 ? "+" : ""}${diff}`}
                  {p && Math.abs(p.bookNow - l.book) > 0.0005 && <span className="block text-[10px] text-amber-700">book now {p.bookNow}</span>}
                </span>
                <Input aria-label={`Reason ${l.key}`} value={l.reason ?? ""} disabled={!!l.posted} onChange={e => setLine(l.key, { reason: e.target.value })}
                  className="h-9 rounded-lg col-span-2 sm:col-span-1" placeholder={p?.moved ? "Why — needed to post" : "—"} />
              </div>
            );
          })}
          <p className="text-[11px] text-muted-foreground">Leave Counted blank for a line not counted — it is left alone. Posting goes against the book as it is then (a line that moved since says "book now").</p>
        </div>
      )}
    </ActionSheet>
  );
}
