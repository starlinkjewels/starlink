import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, FlaskConical, History, LayoutTemplate, Mail, Plus, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { useDb } from "@/hooks/useDb";
import { useAuth } from "@/lib/auth";
import { ActionSheet } from "@/components/ActionSheet";
import { AsyncButton } from "@/components/AsyncButton";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { eachStep, type Pipeline, type StepKind } from "@/lib/pure/pipelines";
import { STEPS, stepDef, triggerText } from "@/lib/pipelines/words";
import { TEMPLATES, TEMPLATE_GROUPS, type Template } from "@/lib/pipelines/templates";
import { subscribeVersions, testPipeline, type PipelineVersion, type TestResult } from "@/lib/pipelines/client";
import { scopeOf } from "./Pickers";

const fmtWhen = (iso: string) => new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" }).replace(/\bSept\b/, "Sep");

/** Picking what to add — grouped, one tap. */
export function AddStepDialog({ open, onClose, onPick, orderRun }: { open: boolean; onClose: () => void; onPick: (k: StepKind) => void; orderRun: boolean }) {
  const groups = ["Tell", "Wait", "Decide", "Do"] as const;
  return (
    <Dialog open={open} onOpenChange={o => { if (!o) onClose(); }}>
      <DialogContent className="max-w-2xl rounded-2xl">
        <DialogHeader><DialogTitle>Add a step</DialogTitle><DialogDescription>What should happen here?</DialogDescription></DialogHeader>
        <div className="space-y-4 max-h-[65vh] overflow-y-auto -mx-1 px-1">
          {groups.map(g => (
            <div key={g}>
              <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{g}</p>
              <div className="grid gap-2 sm:grid-cols-2">
                {STEPS.filter(s => s.group === g && (orderRun || !["approve", "assign", "label"].includes(s.kind))).map(s => (
                  <button key={s.kind} type="button" onClick={() => onPick(s.kind)}
                    className="flex items-center gap-3 rounded-xl border border-border bg-white p-3 text-left hover:border-primary/50 hover:bg-primary/5 transition-colors">
                    <span className={`h-9 w-9 rounded-xl grid place-items-center ring-1 shrink-0 ${s.tone}`}><s.icon className="h-[18px] w-[18px]" /></span>
                    <span className="min-w-0"><span className="block text-[13px] font-semibold text-brand-dark">{s.label}</span><span className="block text-[11px] text-muted-foreground leading-snug">{s.hint}</span></span>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Ready-made pipelines, by who they help. Each opens switched off, to read and change first. */
export function TemplateGallery({ open, onClose, onPick }: { open: boolean; onClose: () => void; onPick: (t: Template | null) => void }) {
  return (
    <ActionSheet open={open} onOpenChange={o => { if (!o) onClose(); }} title="New pipeline" description="Start from a ready-made one, or from nothing" icon={LayoutTemplate} size="xl">
      <div className="space-y-6">
        <button type="button" onClick={() => onPick(null)}
          className="w-full flex items-center gap-3 rounded-2xl border-2 border-dashed border-border p-4 text-left hover:border-primary hover:bg-primary/5">
          <span className="h-10 w-10 rounded-xl grid place-items-center bg-primary/10 text-primary"><Plus className="h-5 w-5" /></span>
          <span><span className="block font-semibold text-brand-dark">Start blank</span><span className="block text-xs text-muted-foreground">Choose when it starts, then add steps</span></span>
        </button>
        {TEMPLATE_GROUPS.map(g => (
          <div key={g}>
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{g}</p>
            <div className="grid gap-2.5 sm:grid-cols-2">
              {TEMPLATES.filter(t => t.group === g).map(t => {
                const built = t.build();
                const kinds: StepKind[] = [];
                eachStep(built.steps, s => { if (!kinds.includes(s.kind)) kinds.push(s.kind); });
                return (
                  <button key={t.id} type="button" onClick={() => onPick(t)}
                    className="flex flex-col gap-2 rounded-2xl border border-border bg-white p-3.5 text-left hover:border-primary/50 hover:shadow-[0_6px_16px_rgb(15_23_42/0.06)] transition">
                    <span className="font-semibold text-[14px] text-brand-dark leading-snug">{t.title}</span>
                    <span className="text-xs text-muted-foreground leading-snug">{t.what}</span>
                    <span className="mt-auto pt-1 flex items-center gap-1.5 flex-wrap">
                      <span className="inline-flex items-center h-6 px-2 rounded-md bg-primary/10 text-primary text-[11px] font-medium max-w-full truncate">{triggerText(built.trigger)}</span>
                      {kinds.map(k => { const d = stepDef(k); return <span key={k} title={d.label} className={`h-6 w-6 rounded-md grid place-items-center ring-1 ${d.tone}`}><d.icon className="h-3.5 w-3.5" /></span>; })}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </ActionSheet>
  );
}

/** Send a test to me: the pipeline runs once on a real record, reaching only the admin testing it. */
export function TestSheet({ p, open, onClose }: { p: Pipeline; open: boolean; onClose: () => void }) {
  const db = useDb();
  const { user } = useAuth();
  const scope = scopeOf(p.trigger);
  const hasAsk = useMemo(() => { let a = false; eachStep(p.steps, s => { if (s.kind === "ask") a = true; }); return a; }, [p.steps]);
  const orders = useMemo(() => [...db.orders].filter(o => !o.deletedAt).sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? "")).slice(0, 200), [db.orders]);
  const [orderId, setOrderId] = useState("");
  const [clientId, setClientId] = useState("");
  const [answer, setAnswer] = useState<"yes" | "no">("yes");
  const [res, setRes] = useState<TestResult | null>(null);
  useEffect(() => { if (open) setRes(null); }, [open]);
  const clientName = (id: string) => db.clients.find(c => c.id === id)?.companyName ?? "";
  const run = async () => {
    try {
      const r = await testPipeline(p, { orderId: scope.order ? orderId || undefined : undefined, clientId: !scope.order && scope.client ? clientId || undefined : undefined, answer });
      setRes(r);
      if (!r.problems.length) toast.success("Test done — check your email and screen");
    } catch (e) {
      toast.error(e instanceof Error ? e.message.replace(/^.*?:\s*/, "") : "The test didn't run");
    }
  };
  return (
    <ActionSheet open={open} onOpenChange={o => { if (!o) onClose(); }} title="Send a test to me" description={`Runs once now. Emails and popups reach only you${user?.email ? ` (${user.email})` : ""}.`} icon={FlaskConical} size="lg"
      footer={<div className="flex justify-end gap-2"><Button variant="outline" onClick={onClose} className="rounded-xl">Close</Button><AsyncButton onClick={run} className="btn-hero rounded-xl px-6"><FlaskConical className="h-4 w-4" /> Run test</AsyncButton></div>}>
      <div className="space-y-4">
        {scope.order && (
          <div className="space-y-1.5">
            <p className="text-xs font-semibold text-brand-dark/80">On order</p>
            <Select value={orderId} onValueChange={setOrderId}>
              <SelectTrigger className="rounded-xl h-10"><SelectValue placeholder="The newest one it would start for" /></SelectTrigger>
              <SelectContent>{orders.map(o => <SelectItem key={o.id} value={o.id}>{o.orderNumber} — {clientName(o.clientId)}</SelectItem>)}</SelectContent>
            </Select>
          </div>
        )}
        {!scope.order && scope.client && (
          <div className="space-y-1.5">
            <p className="text-xs font-semibold text-brand-dark/80">On client</p>
            <Select value={clientId} onValueChange={setClientId}>
              <SelectTrigger className="rounded-xl h-10"><SelectValue placeholder="The first client" /></SelectTrigger>
              <SelectContent>{[...db.clients].sort((a, b) => a.companyName.localeCompare(b.companyName)).map(c => <SelectItem key={c.id} value={c.id}>{c.companyName}</SelectItem>)}</SelectContent>
            </Select>
          </div>
        )}
        {hasAsk && (
          <div className="space-y-1.5">
            <p className="text-xs font-semibold text-brand-dark/80">When it asks, answer</p>
            <div className="grid grid-cols-2 gap-1.5 max-w-xs">
              {(["yes", "no"] as const).map(a => (
                <button key={a} type="button" onClick={() => setAnswer(a)} className={`h-10 rounded-xl border text-[13px] font-medium ${answer === a ? "border-primary bg-primary/10 text-primary" : "border-border bg-white"}`}>{a === "yes" ? "Yes" : "No"}</button>
              ))}
            </div>
          </div>
        )}
        <div className="rounded-xl bg-secondary/40 px-3 py-2.5 text-[13px] text-brand-dark/80 leading-relaxed">
          Waits are skipped. Nothing is approved, assigned, labelled or given as a task — the test only says what would happen.
        </div>

        {res && (
          <div className="space-y-2">
            {!!res.problems.length && (
              <div className="rounded-xl border border-amber-300 bg-amber-50 px-3 py-2.5 text-[13px] text-amber-800 space-y-1">
                <p className="font-semibold">Fix these first</p>
                {res.problems.map((x, i) => <p key={i} className="flex gap-2"><AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />{x.text}</p>)}
              </div>
            )}
            {!res.problems.length && <>
              <p className="text-sm text-brand-dark">On <b>{res.about}</b>{res.onlyHolds === false && <span className="text-amber-700"> — note: this one doesn't pass “Only if”, so for real it wouldn't start</span>}</p>
              {!res.steps.length && <p className="text-sm text-muted-foreground">No step did anything — a check may have stopped it.</p>}
              {res.steps.map((s, i) => {
                const d = stepDef(s.type as StepKind);
                return (
                  <div key={i} className="flex gap-3 rounded-xl border border-border p-3 bg-white">
                    <span className={`h-8 w-8 rounded-lg grid place-items-center ring-1 shrink-0 ${d.tone}`}><d.icon className="h-4 w-4" /></span>
                    <div className="min-w-0 text-[13px] leading-snug">
                      <p className="font-semibold text-brand-dark">{d.label}</p>
                      {!!s.wouldReach.length && <p className="text-muted-foreground">For real: {s.wouldReach.join(", ")}</p>}
                      {s.type !== "approve" && s.type !== "assign" && s.type !== "task" && s.type !== "label" && s.type !== "ask" && !s.wouldReach.length && <p className="text-amber-700">For real it would reach nobody — no email address or person matches</p>}
                      {!!s.sentTo?.length && <p className="text-emerald-700 inline-flex items-center gap-1"><Mail className="h-3.5 w-3.5" /> Sent to you</p>}
                      {s.note && <p className="text-muted-foreground">{s.note}</p>}
                    </div>
                  </div>
                );
              })}
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground"><CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" /> Path: {res.trail.map(t => t.outcome === "took" || t.outcome === "answered" ? t.note : t.outcome).join(" → ") || "—"}</p>
            </>}
          </div>
        )}
      </div>
    </ActionSheet>
  );
}

/** Every saved version — bring one back as a draft. */
export function VersionsSheet({ p, open, onClose, onRestore }: { p: Pipeline; open: boolean; onClose: () => void; onRestore: (v: PipelineVersion) => void }) {
  const [list, setList] = useState<PipelineVersion[]>([]);
  useEffect(() => (open && p.version ? subscribeVersions(p.id, setList) : undefined), [open, p.id, p.version]);
  return (
    <ActionSheet open={open} onOpenChange={o => { if (!o) onClose(); }} title="Versions" description="Every save is kept" icon={History} size="md">
      <div className="space-y-2">
        {!list.length && <p className="text-sm text-muted-foreground">Nothing saved yet.</p>}
        {list.map(v => (
          <div key={v.id} className="flex items-center gap-3 rounded-xl border border-border bg-white p-3">
            <span className="h-9 w-9 rounded-xl grid place-items-center bg-secondary text-brand-dark text-xs font-bold shrink-0">v{v.version}</span>
            <div className="min-w-0 flex-1 text-[13px]">
              <p className="font-semibold text-brand-dark truncate">{v.pipeline.name}{v.version === p.version && <span className="ml-1.5 text-[11px] font-medium text-emerald-700">· in use</span>}</p>
              <p className="text-muted-foreground text-xs">{fmtWhen(v.savedAt)}{v.savedByName ? ` · ${v.savedByName}` : ""} · {v.pipeline.steps.length} step{v.pipeline.steps.length === 1 ? "" : "s"}</p>
            </div>
            {v.version !== p.version && <Button variant="outline" size="sm" className="rounded-lg shrink-0" onClick={() => onRestore(v)}><RotateCcw className="h-3.5 w-3.5" /> Bring back</Button>}
          </div>
        ))}
      </div>
    </ActionSheet>
  );
}


