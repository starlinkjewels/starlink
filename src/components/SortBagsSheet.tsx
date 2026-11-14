// A bag's Sort into bags: one mixed parcel into several lots in one step (the trade's assortment) —
// each target line a bag we keep or a new one, its carats and stones; what is left stays in the
// bag, or is written off as sorting loss with why. Each line is the existing one-bag move (lib/stock
// moveBetweenBags — both bags in one transaction), at the bag's average cost, so value travels with
// the stones; lines are made one by one and leave the form as they are saved, so a stop part-way
// never moves a line twice. Nothing is saved unless the carats add up.
import { useState } from "react";
import { toast } from "sonner";
import { Layers, Plus, Trash2 } from "lucide-react";
import { useDb } from "@/hooks/useDb";
import { useAuth } from "@/lib/auth";
import { ensureCollections, loadDb } from "@/lib/db";
import { bagNoOf } from "@/lib/diamondBags";
import { hasCompanies } from "@/lib/companies";
import { lotBalances, lotKey, lotLabel, lotParts } from "@/lib/diamondLots";
import { stockAverageRate } from "@/lib/orderCost";
import { decreaseStockSelfHealing, moveBetweenBags } from "@/lib/stock";
import { ActionSheet } from "@/components/ActionSheet";
import { AsyncButton } from "@/components/AsyncButton";
import { Field, Group, PanelActions, Segmented, UnitInput } from "@/components/BillLayout";
import { BagSelect, LooseLotFields, lotFromDraft, type LooseLotDraft } from "@/components/LotFields";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const r3 = (n: number) => Math.round(n * 1000) / 1000;
interface Target { key: string; into: "existing" | "new"; target: string; draft: LooseLotDraft; ct: string; pcs: string }
const blankDraft = (from: string): LooseLotDraft => { const s = lotParts(from); return { shape: s.shape, variety: s.variety ?? "", type: s.type ?? "", mm: "", size: "", color: "", clarity: "" }; };
const newTarget = (from: string): Target => ({ key: Math.random().toString(36).slice(2), into: "new", target: "", draft: blankDraft(from), ct: "", pcs: "" });

export function SortBagsSheet({ bag, companyId, onClose }: { bag: string; companyId: string; onClose: () => void }) {
  const db = useDb();
  const { user } = useAuth();
  const multiCo = hasCompanies(db.settings);
  const src = lotBalances(db.stockMovements ?? [], companyId).find(l => l.key === bag);
  const no = bagNoOf(db, bag);
  const [rows, setRows] = useState<Target[]>([newTarget(bag), newTarget(bag)]);
  const [rest, setRest] = useState<"keep" | "loss">("keep");
  const [why, setWhy] = useState("");
  const [note, setNote] = useState("");
  const set = (k: string, patch: Partial<Target>) => setRows(rs => rs.map(r => (r.key === k ? { ...r, ...patch } : r)));
  const keyOf = (r: Target) => (r.into === "existing" ? r.target : lotKey(lotFromDraft(r.draft)));
  const sorted = r3(rows.reduce((t, r) => t + (Number(r.ct) || 0), 0));
  const left = r3((src?.ct ?? 0) - sorted);
  const pcsSorted = rows.reduce((t, r) => t + Math.round(Number(r.pcs) || 0), 0);

  const save = async () => {
    if (!user || !src) return;
    const lines = rows.filter(r => Number(r.ct) > 0);
    if (!lines.length) { toast.error("Enter the carats for at least one bag"); return; }
    for (const r of lines) {
      const k = keyOf(r);
      if (!k) { toast.error(r.into === "existing" ? "Choose the bag for each line" : "Fill in each new bag's lot"); return; }
      if (k === bag) { toast.error("A line goes back into the same bag — choose another, or change its grade"); return; }
    }
    if (new Set(lines.map(keyOf)).size < lines.length) { toast.error("Two lines go into the same bag — put them on one line"); return; }
    if (left < -0.0005) { toast.error(`${no ?? "This bag"} holds ${src.ct} ct — the lines come to ${sorted} ct`); return; }
    if (src.pcs != null && pcsSorted > src.pcs) { toast.error(`${no ?? "This bag"} holds ${src.pcs} pcs — the lines come to ${pcsSorted}`); return; }
    if (rest === "loss" && left > 0.0005 && !why.trim()) { toast.error("Say why the rest is lost — e.g. sorting rejection, chipped"); return; }
    try {
      await ensureCollections(["purchases", "stockMovements"]);
      const rate = stockAverageRate(loadDb(), "diamond", bag, new Date().toISOString(), multiCo ? companyId : undefined);
      const co = companyId === "all" ? undefined : companyId;
      const tag = `Sorted from ${no ?? lotLabel(bag)}${note.trim() ? ` — ${note.trim()}` : ""}`;
      for (const r of lines) {
        const k = keyOf(r), q = r3(Number(r.ct)), p = Math.round(Number(r.pcs) || 0);
        await moveBetweenBags({
          companyId: co, from: bag, to: k, toLot: r.into === "new" ? lotFromDraft(r.draft) : undefined,
          quantity: q, pieces: p || undefined, valueInr: rate != null ? rate * q : undefined,
          fromNo: no, toNo: bagNoOf(loadDb(), k), createdBy: user.id, note: tag,
        });
        setRows(rs => rs.filter(x => x.key !== r.key));
      }
      if (rest === "loss" && left > 0.0005) {
        await decreaseStockSelfHealing({ material: "diamond", companyId: co, purityOrQuality: bag, quantity: left, type: "issuance_out", refType: "manual",
          createdBy: user.id, note: `Sorting loss — ${why.trim()}${no ? ` (${no})` : ""}`, lot: lotParts(bag) }, loadDb().stockMovements);
      }
      toast.success(`Sorted into ${lines.length} bag${lines.length === 1 ? "" : "s"}${rest === "loss" && left > 0.0005 ? ` · ${left} ct sorting loss` : left > 0.0005 ? ` · ${left} ct left in ${no ?? "the bag"}` : ""}`);
      onClose();
    } catch (e) {
      toast.error(`${e instanceof Error ? e.message : "Couldn't sort it"} — what was moved is saved; what is left is still here.`);
    }
  };

  return (
    <ActionSheet open onOpenChange={o => { if (!o) onClose(); }} size="lg" icon={Layers} title={`Sort ${no ?? "this bag"} into bags`}
      description={`${lotLabel(bag)} · ${src?.ct ?? 0} ct${src?.pcs != null ? ` · ${src.pcs} pcs` : ""} — into several lots in one step, at its average cost.`}
      footer={(
        <div className="space-y-2">
          <p className={`text-sm tabular-nums ${left < -0.0005 ? "text-destructive font-medium" : "text-muted-foreground"}`}>
            Sorted {sorted} ct{pcsSorted ? ` · ${pcsSorted} pcs` : ""} · {left < -0.0005 ? `${-left} ct more than the bag holds` : `${left} ct ${rest === "loss" ? "sorting loss" : "left in the bag"}`}
          </p>
          <PanelActions onCancel={onClose}>
            <AsyncButton onClick={save} disabled={left < -0.0005} className="btn-hero rounded-xl h-11 flex-1 sm:flex-none sm:min-w-48">Sort</AsyncButton>
          </PanelActions>
        </div>
      )}>
      <div className="@container space-y-5">
        <Group title="Into">
          <div className="space-y-3">
            {rows.map((r, i) => (
              <div key={r.key} className="rounded-xl border border-border/70 bg-white p-3 space-y-2.5">
                <div className="flex items-center gap-2">
                  <Segmented className="max-w-[18rem] flex-1" value={r.into} onChange={v => set(r.key, { into: v, target: "" })} options={[["new", "A new lot"], ["existing", "A bag we keep"]] as const} />
                  <span className="text-xs text-muted-foreground">#{i + 1}</span>
                  <button type="button" aria-label="Remove this line" onClick={() => setRows(rs => (rs.length > 1 ? rs.filter(x => x.key !== r.key) : rs))}
                    className="ml-auto h-8 w-8 grid place-items-center rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10"><Trash2 className="h-4 w-4" /></button>
                </div>
                {r.into === "existing"
                  ? <BagSelect id={`sb-to-${r.key}`} value={r.target} onChange={v => set(r.key, { target: v })} companyId={companyId} exclude={[bag]} />
                  : <LooseLotFields idPrefix={`sb-new-${r.key}`} compact companyId={companyId} bagPicker={false} value={r.draft} onChange={p => set(r.key, { draft: { ...r.draft, ...p } })} />}
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Carats">{id => <UnitInput id={id} min={0} step="0.001" unit="ct" value={r.ct} onChange={e => set(r.key, { ct: e.target.value })} aria-label={`Carats — line ${i + 1}`} />}</Field>
                  <Field label="Pcs">{id => <UnitInput id={id} min={0} step="1" value={r.pcs} onChange={e => set(r.key, { pcs: e.target.value })} placeholder="Optional" aria-label={`Pieces — line ${i + 1}`} />}</Field>
                </div>
              </div>
            ))}
            <Button type="button" variant="outline" size="sm" className="rounded-lg h-9" onClick={() => setRows(rs => [...rs, newTarget(bag)])}><Plus className="h-3.5 w-3.5" />Another bag</Button>
          </div>
        </Group>
        <Group title="What is left">
          <div className="space-y-2">
            <Segmented value={rest} onChange={setRest} options={[["keep", "Stays in the bag"], ["loss", "Sorting loss"]] as const} />
            {rest === "loss" && <Input value={why} onChange={e => setWhy(e.target.value)} className="rounded-xl h-10" placeholder="Why — e.g. rejection, chipped, lost in sorting" aria-label="Why it is lost" />}
            <Input value={note} onChange={e => setNote(e.target.value)} className="rounded-xl h-10" placeholder="Note — optional" aria-label="Note" />
          </div>
        </Group>
      </div>
    </ActionSheet>
  );
}
