import { DEFAULT_PRODUCTION_DELAY_DAYS, productionDelayDays } from "@/lib/production";
import { useEffect, useState } from "react";
import { SectionTitle } from "@/components/SectionTitle";
import { ArrowDown, ArrowUp, Check, Factory, ListOrdered, Lock, Pencil, Plus, RotateCcw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { updateDb } from "@/lib/db";
import { useDb } from "@/hooks/useDb";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  BUILTIN_MIDDLE, HEAD_STAGES, TAIL_STAGES, isBuiltinStage, looseStageProblem, looseStages, middleStages, stageKind, stageLabel, stageOrderProblem,
} from "@/lib/stages";
import { buildReadyStockSaleTimelineSteps, buildReadyStockTimelineSteps } from "@/lib/db";

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
  // Each stage's own name for this business — shown everywhere, the stage
  // itself unchanged underneath (stages.ts stageLabel).
  const savedLabels = db.settings.stageLabels ?? {};
  const [labels, setLabels] = useState<Record<string, string>>(savedLabels);
  const [renaming, setRenaming] = useState<string | null>(null);
  const savedKey = saved.join("|");
  const labelsKey = JSON.stringify(savedLabels);
  useEffect(() => { setList(saved); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [savedKey]);
  useEffect(() => { setLabels(savedLabels); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [labelsKey]);
  /** Only real renames are kept: blank, or the stage's own name, is no rename. */
  const cleanLabels = (l: Record<string, string>) =>
    Object.fromEntries(Object.entries(l).map(([k, v]) => [k, v.trim().replace(/\s+/g, " ")]).filter(([k, v]) => v && v !== k));
  const labelsDirty = JSON.stringify(cleanLabels(labels)) !== JSON.stringify(cleanLabels(savedLabels));

  // When a piece in production counts as delayed (lib/production.ts).
  const savedDelay = productionDelayDays(db.settings);
  const [delay, setDelay] = useState(String(savedDelay));
  useEffect(() => { setDelay(String(savedDelay)); }, [savedDelay]);
  const delayN = Number(delay);
  const delayOk = Number.isInteger(delayN) && delayN >= 1 && delayN <= 365;
  const delayDirty = delay.trim() !== "" && delayN !== savedDelay;

  const dirty = list.join("|") !== savedKey || labelsDirty || delayDirty;
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
    if (delayDirty && !delayOk) { toast.error("Delayed after: a whole number of days, 1 to 365."); return; }
    const clean = cleanLabels(labels);
    updateDb(d => {
      d.settings.timelineStages = isDefault ? undefined : list;
      d.settings.stageLabels = Object.keys(clean).length ? clean : undefined;
      if (delayDirty) d.settings.productionDelayDays = delayN === DEFAULT_PRODUCTION_DELAY_DAYS ? undefined : delayN;
    });
    setRenaming(null);
    toast.success(labelsDirty ? "Timeline saved — the new names show on every order" : "Production timeline saved — new orders will follow it");
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
          {renaming === step ? (
            <div className="flex items-center gap-1.5">
              <Input autoFocus value={labels[step] ?? ""} placeholder={step} maxLength={40} aria-label={`New name for ${step}`}
                onChange={e => setLabels(l => ({ ...l, [step]: e.target.value }))}
                onKeyDown={e => { if (e.key === "Enter" || e.key === "Escape") setRenaming(null); }}
                className="h-8 rounded-lg text-sm" />
              <button type="button" onClick={() => setRenaming(null)} aria-label="Done renaming" title="Done"
                className="h-8 w-8 shrink-0 grid place-items-center rounded-lg text-primary hover:bg-primary/10"><Check className="h-4 w-4" /></button>
            </div>
          ) : (
            <p className="text-sm font-medium text-brand-dark truncate">
              {labels[step]?.trim() || step}
              {labels[step]?.trim() && labels[step].trim() !== step && <span className="ml-1.5 text-[11px] font-normal text-muted-foreground">({step})</span>}
              {custom && <span className="ml-1.5 text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-primary/10 text-primary align-middle">your stage</span>}
            </p>
          )}
          <p className="text-[11px] text-muted-foreground truncate">
            {NOTE[step] ?? "Ticked off when done"}{special && !locked ? " · has its own screen" : ""}
          </p>
        </div>
        {/* Any stage can be renamed — the fixed ones too; only its name changes. */}
        {renaming !== step && (
          <button type="button" onClick={() => setRenaming(step)} aria-label={`Rename ${step}`} title="Rename"
            className="h-7 w-7 shrink-0 grid place-items-center rounded-lg text-muted-foreground hover:text-primary hover:bg-primary/10"><Pencil className="h-3.5 w-3.5" /></button>
        )}
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
      <SectionTitle icon={ListOrdered} title="Production Timeline" sub="The stages of each kind of order — and the board's columns"
        info="Reorder the middle stages with the arrows, or add your own (e.g. Hallmarking, Polishing)." />
      <p className="text-sm font-semibold text-foreground">Make a piece</p>

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

      <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 rounded-xl border border-border/70 bg-secondary/30 px-3 py-2">
        <Factory className="h-4 w-4 text-muted-foreground shrink-0" />
        <span className="text-sm text-foreground">A piece is delayed after</span>
        <Input type="number" inputMode="numeric" min={1} max={365} step={1} value={delay} onChange={e => setDelay(e.target.value)}
          aria-label="Days in production before a piece is delayed" className={`h-8 w-20 rounded-lg text-sm ${delayDirty && !delayOk ? "border-destructive" : ""}`} />
        <span className="text-sm text-foreground">days in production</span>
        <span className="basis-full text-[11px] text-muted-foreground">Counted from the day it went into production. Past it the order turns red on the list, the cards and the board, and shows under Orders → Delayed.</span>
      </div>

      <ul className="text-[11px] text-muted-foreground space-y-0.5 list-disc pl-4">
        <li>Applies to orders created after you save. An order already running keeps its own stages.</li>
        <li>The first two and last two stages stay where they are — approval, dispatch and delivery hang on them.</li>
        <li>Rename any stage with the pencil: the new name shows on every order — running ones too — on the board and to clients. What the stage does stays the same.</li>
        <li>Final Approval stays after CAD Designing and In Production, since it records what making the piece used.</li>
        <li>Your own stages are ticked off like CAD Designing. Loose-diamond orders skip them, as nothing is made.</li>
      </ul>

      <div className="flex gap-2 justify-end">
        {!isDefault && (
          <Button type="button" variant="ghost" onClick={() => setList([...BUILTIN_MIDDLE])} className="rounded-xl gap-1.5 text-muted-foreground">
            <RotateCcw className="h-4 w-4" /> Back to default
          </Button>
        )}
        {dirty && <Button type="button" variant="outline" onClick={() => { setList(saved); setLabels(savedLabels); setRenaming(null); setDelay(String(savedDelay)); }} className="rounded-xl">Discard</Button>}
        <Button type="button" onClick={save} disabled={!dirty} className="btn-hero rounded-xl">Save timeline</Button>
      </div>

      <LooseStagesEditor />

      {/* The two kinds whose stages are fixed — shown so every kind's journey is in one place. */}
      <div className="border-t border-border/60 pt-4 space-y-3">
        {([
          ["From Ready Stock", "A finished piece sold — nothing is made", buildReadyStockSaleTimelineSteps()],
          ["Build for our stock", "Made for Ready Stock — your stages, without Certification", buildReadyStockTimelineSteps(saved)],
        ] as const).map(([title, sub, steps]) => (
          <div key={title} className="space-y-1.5">
            <p className="text-sm font-semibold text-foreground">{title} <span className="text-xs font-normal text-muted-foreground">· {sub}</span></p>
            <div className="flex flex-wrap items-center gap-1.5 text-xs">
              {steps.map((st, i) => (
                <span key={st} className="inline-flex items-center gap-1.5">
                  {i > 0 && <span className="text-muted-foreground">→</span>}
                  {renaming === `${title}:${st}` ? (
                    <Input autoFocus value={labels[st] ?? ""} placeholder={st} maxLength={40} aria-label={`New name for ${st}`}
                      onChange={e => setLabels(l => ({ ...l, [st]: e.target.value }))}
                      onBlur={() => setRenaming(null)}
                      onKeyDown={e => { if (e.key === "Enter" || e.key === "Escape") setRenaming(null); }}
                      className="h-7 w-36 rounded-lg text-xs" />
                  ) : (
                    <button type="button" onClick={() => setRenaming(`${title}:${st}`)} title="Rename" aria-label={`Rename ${st}`}
                      className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-secondary text-foreground hover:bg-primary/10">
                      {labels[st]?.trim() || st}<Pencil className="h-3 w-3 text-muted-foreground" />
                    </button>
                  )}
                </span>
              ))}
            </div>
          </div>
        ))}
        {labelsDirty && (
          <div className="flex justify-end">
            <Button type="button" onClick={save} className="btn-hero rounded-xl">Save timeline</Button>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * A loose-diamond order's own stages — between approval and dispatch (e.g.
 * Matching, Sorting, Quality check). Nothing is made, so a piece's stages
 * never apply; Certification is added on its own when the order needs one.
 */
function LooseStagesEditor() {
  const db = useDb();
  const saved = looseStages(db.settings);
  const savedKey = saved.join("|");
  const [list, setList] = useState<string[]>(saved);
  const [name, setName] = useState("");
  useEffect(() => { setList(saved); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [savedKey]);
  const dirty = list.join("|") !== savedKey;
  const swap = (i: number, j: number) => { const n = [...list]; [n[i], n[j]] = [n[j], n[i]]; setList(n); };
  const add = () => {
    const n = name.trim().replace(/\s+/g, " ");
    if (!n) return;
    const problem = looseStageProblem([...list, n]);
    if (problem) { toast.error(problem); return; }
    setList([...list, n]); setName("");
  };
  const save = () => {
    const problem = looseStageProblem(list);
    if (problem) { toast.error(problem); return; }
    updateDb(d => { d.settings.looseStages = list.length ? list : undefined; });
    toast.success("Loose-diamond stages saved — new orders will follow them");
  };
  const fixed = (st: string, note: string) => (
    <div key={st} className="flex items-center gap-2 rounded-xl border px-3 py-2 bg-secondary/40 border-border/50">
      <Lock className="h-3 w-3 text-muted-foreground shrink-0" />
      <p className="text-sm font-medium text-foreground flex-1 truncate">{stageLabel(st, db.settings)}</p>
      <p className="text-[11px] text-muted-foreground shrink-0">{note}</p>
    </div>
  );
  return (
    <div className="border-t border-border/60 pt-4 space-y-3">
      <p className="text-sm font-semibold text-foreground">Loose stones <span className="text-xs font-normal text-muted-foreground">· stones sold as they are — nothing is made</span></p>
      <div className="space-y-1.5">
        {fixed("Order Submitted", "The order is placed")}
        {fixed("Order Approved", "The client is told")}
        {list.map((st, i) => (
          <div key={st} className="flex items-center gap-2 rounded-xl border px-3 py-2 bg-card border-border/70">
            <span className="text-xs text-muted-foreground w-5 text-right shrink-0">{i + 3}</span>
            <p className="text-sm font-medium text-foreground flex-1 truncate">{st} <span className="ml-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-primary/10 text-primary align-middle">your stage</span></p>
            <button type="button" onClick={() => swap(i, i - 1)} disabled={i === 0} aria-label={`Move ${st} up`} className="h-7 w-7 grid place-items-center rounded-lg hover:bg-secondary disabled:opacity-30"><ArrowUp className="h-3.5 w-3.5" /></button>
            <button type="button" onClick={() => swap(i, i + 1)} disabled={i === list.length - 1} aria-label={`Move ${st} down`} className="h-7 w-7 grid place-items-center rounded-lg hover:bg-secondary disabled:opacity-30"><ArrowDown className="h-3.5 w-3.5" /></button>
            <button type="button" onClick={() => setList(list.filter((_, j) => j !== i))} aria-label={`Remove ${st}`} className="h-7 w-7 grid place-items-center rounded-lg text-destructive hover:bg-destructive/10"><Trash2 className="h-3.5 w-3.5" /></button>
          </div>
        ))}
        {fixed("Certification", "Only when it needs a certificate")}
        {fixed("Dispatch", "Courier and tracking")}
        {fixed("Delivered", "Closes the order")}
      </div>
      <div className="flex gap-2">
        <Input value={name} onChange={e => setName(e.target.value)} onKeyDown={e => e.key === "Enter" && add()}
          placeholder="New stage, e.g. Matching" className="rounded-xl h-10" maxLength={40} aria-label="New loose-diamond stage" />
        <Button type="button" variant="outline" onClick={add} className="rounded-xl h-10 gap-1.5 shrink-0"><Plus className="h-4 w-4" /> Add stage</Button>
      </div>
      <div className="flex gap-2 justify-end">
        {dirty && <Button type="button" variant="outline" onClick={() => setList(saved)} className="rounded-xl">Discard</Button>}
        <Button type="button" onClick={save} disabled={!dirty} className="btn-hero rounded-xl">Save loose-diamond stages</Button>
      </div>
    </div>
  );
}
