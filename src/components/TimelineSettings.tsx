import { useEffect, useState } from "react";
import { SectionTitle } from "@/components/SectionTitle";
import { ArrowDown, ArrowUp, ListOrdered, Lock, Plus, RotateCcw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { updateDb } from "@/lib/db";
import { useDb } from "@/hooks/useDb";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  BUILTIN_MIDDLE, HEAD_STAGES, TAIL_STAGES, isBuiltinStage, middleStages, stageKind, stageOrderProblem,
} from "@/lib/stages";

const NOTE: Record<string, string> = {
  "Order Submitted": "The order is placed",
  "Order Approved": "Approved — the client is told",
  "CAD Designing": "Design drawn",
  "In Production": "Being made at the factory",
  "Certification": "Only on orders that need a certificate",
  "Final Approval": "Actual gold, diamonds and labour recorded",
  "Dispatch": "Courier, tracking and the day it left",
  "Delivered": "Closes the order; cashback is paid",
};

/**
 * Settings → Production timeline. The admin puts the middle stages in their
 * own order and adds stages of their own; the start and the end stay fixed.
 * Saved once and fixed onto each order as it is created — an order already
 * running keeps the stages it began with.
 */
export function TimelineSettings() {
  const db = useDb();
  const saved = middleStages(db.settings);
  const [list, setList] = useState<string[]>(saved);
  const [name, setName] = useState("");
  const savedKey = saved.join("|");
  useEffect(() => { setList(saved); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [savedKey]);

  const dirty = list.join("|") !== savedKey;
  const isDefault = list.join("|") === BUILTIN_MIDDLE.join("|");

  const moved = (i: number, dir: -1 | 1) => {
    const next = [...list];
    [next[i], next[i + dir]] = [next[i + dir], next[i]];
    return next;
  };
  const canMove = (i: number, dir: -1 | 1) => i + dir >= 0 && i + dir < list.length && !stageOrderProblem(moved(i, dir));
  const why = (i: number, dir: -1 | 1) => (i + dir < 0 || i + dir >= list.length) ? "" : stageOrderProblem(moved(i, dir)) ?? "";

  const add = () => {
    const n = name.trim().replace(/\s+/g, " ");
    if (!n) return;
    // A new stage goes in just before Final Approval — usually where finishing work happens.
    const at = list.indexOf("Final Approval");
    const next = [...list.slice(0, at), n, ...list.slice(at)];
    const problem = stageOrderProblem(next);
    if (problem) { toast.error(problem); return; }
    setList(next); setName("");
  };

  const save = () => {
    const problem = stageOrderProblem(list);
    if (problem) { toast.error(problem); return; }
    updateDb(d => { d.settings.timelineStages = isDefault ? undefined : list; });
    toast.success("Production timeline saved — new orders will follow it");
  };

  const row = (step: string, locked: boolean, i?: number) => {
    const custom = !isBuiltinStage(step);
    const special = stageKind(step) !== "plain";
    return (
      <div key={step} className={`flex items-center gap-2 rounded-xl border px-3 py-2 ${locked ? "bg-secondary/40 border-border/50" : "bg-white border-border/70"}`}>
        <span className="text-xs text-muted-foreground w-5 text-right shrink-0">
          {locked ? <Lock className="h-3 w-3 inline" /> : (i! + 1 + HEAD_STAGES.length)}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-brand-dark truncate">
            {step}
            {custom && <span className="ml-1.5 text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-primary/10 text-primary align-middle">your stage</span>}
          </p>
          <p className="text-[11px] text-muted-foreground truncate">
            {NOTE[step] ?? "Ticked off when done"}{special && !locked ? " · has its own screen" : ""}
          </p>
        </div>
        {!locked && i != null && (
          <div className="flex items-center gap-1 shrink-0">
            <button type="button" onClick={() => setList(moved(i, -1))} disabled={!canMove(i, -1)} title={why(i, -1) || "Move up"}
              className="h-7 w-7 grid place-items-center rounded-lg hover:bg-secondary disabled:opacity-30 disabled:cursor-not-allowed">
              <ArrowUp className="h-3.5 w-3.5" />
            </button>
            <button type="button" onClick={() => setList(moved(i, 1))} disabled={!canMove(i, 1)} title={why(i, 1) || "Move down"}
              className="h-7 w-7 grid place-items-center rounded-lg hover:bg-secondary disabled:opacity-30 disabled:cursor-not-allowed">
              <ArrowDown className="h-3.5 w-3.5" />
            </button>
            {custom ? (
              <button type="button" onClick={() => setList(list.filter((_, j) => j !== i))} title="Remove this stage"
                className="h-7 w-7 grid place-items-center rounded-lg text-destructive hover:bg-destructive/10">
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            ) : <span className="w-7" />}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="card-luxe p-6 space-y-4">
      <SectionTitle icon={ListOrdered} title="Production Timeline" sub="Order stages and board columns"
        info="Reorder the middle stages with the arrows, or add your own (e.g. Hallmarking, Polishing)." />

      <div className="space-y-1.5">
        {HEAD_STAGES.map(s => row(s, true))}
        {list.map((s, i) => row(s, false, i))}
        {TAIL_STAGES.map(s => row(s, true))}
      </div>

      <div className="flex gap-2">
        <Input value={name} onChange={e => setName(e.target.value)} onKeyDown={e => e.key === "Enter" && add()}
          placeholder="New stage, e.g. Hallmarking" className="rounded-xl h-10" maxLength={40} />
        <Button type="button" variant="outline" onClick={add} className="rounded-xl h-10 gap-1.5 shrink-0"><Plus className="h-4 w-4" /> Add stage</Button>
      </div>

      <ul className="text-[11px] text-muted-foreground space-y-0.5 list-disc pl-4">
        <li>Applies to orders created after you save. An order already running keeps its own stages.</li>
        <li>The first two and last two stages stay where they are — approval, dispatch and delivery hang on them.</li>
        <li>Final Approval stays after CAD Designing and In Production, since it records what making the piece used.</li>
        <li>Your own stages are ticked off like CAD Designing. Loose-diamond orders skip them, as nothing is made.</li>
      </ul>

      <div className="flex gap-2 justify-end">
        {!isDefault && (
          <Button type="button" variant="ghost" onClick={() => setList([...BUILTIN_MIDDLE])} className="rounded-xl gap-1.5 text-muted-foreground">
            <RotateCcw className="h-4 w-4" /> Back to default
          </Button>
        )}
        {dirty && <Button type="button" variant="outline" onClick={() => setList(saved)} className="rounded-xl">Discard</Button>}
        <Button type="button" onClick={save} disabled={!dirty} className="btn-hero rounded-xl">Save timeline</Button>
      </div>
    </div>
  );
}
