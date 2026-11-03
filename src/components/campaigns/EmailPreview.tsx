// The email as it arrives — drawn by the same code the server sends with
// (lib/pure/campaignEmail.ts) — on a laptop or a phone, with how it shows in
// an inbox and what a careful sender would fix first.
import { useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Laptop, OctagonX, Smartphone } from "lucide-react";
import { designProblems, fillMerge, renderCampaign, cleanDesign, type CampaignDesign, type RenderCtx } from "@/lib/pure/campaignEmail";

export interface PreviewPerson { name?: string; company?: string; kind: "client" | "employee" }

export function EmailPreview({ design, subject, preheader, ctx, person, fromName, compact = false }: {
  design: CampaignDesign; subject: string; preheader?: string;
  ctx: Omit<RenderCtx, "subject" | "preheader" | "vars" | "reason">;
  person: PreviewPerson; fromName: string; compact?: boolean;
}) {
  const [view, setView] = useState<"laptop" | "phone">("laptop");
  const vars = { first_name: (person.name ?? "").trim().split(/\s+/)[0] || undefined, name: person.name, company: person.company };
  const r = useMemo(() => renderCampaign(design, {
    ...ctx, subject, preheader, vars,
    reason: person.kind === "client" ? `You're receiving this as a client of ${fromName}.` : `You're receiving this as a member of the ${fromName} team.`,
    // The real link is made on the server, for each person; here it shows where it will be.
    unsubscribeUrl: person.kind === "client" ? "https://example.com/unsubscribe" : undefined,
  }), [design, subject, preheader, ctx, person.name, person.company, person.kind, fromName]); // eslint-disable-line react-hooks/exhaustive-deps
  const problems = useMemo(() => designProblems(cleanDesign(design), subject, r), [design, subject, r]);
  const fill = (s: string) => fillMerge(s, vars);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="inline-flex rounded-xl border border-border bg-white p-0.5" role="tablist" aria-label="Preview on">
          {([["laptop", "Laptop", Laptop], ["phone", "Phone", Smartphone]] as const).map(([k, l, I]) => (
            <button key={k} type="button" role="tab" aria-selected={view === k} onClick={() => setView(k)}
              className={`inline-flex items-center gap-1.5 h-8 px-3 rounded-lg text-xs font-medium ${view === k ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}>
              <I className="h-3.5 w-3.5" />{l}</button>
          ))}
        </div>
        <span className={`text-[11px] tabular-nums ${r.clipped ? "text-destructive font-semibold" : "text-muted-foreground"}`} title="Gmail cuts off emails past 102 KB">{Math.max(1, Math.round(r.bytes / 1024))} KB of 102</span>
      </div>

      {/* How it shows in the inbox: who, the subject, the preview line. */}
      <div className="rounded-xl border border-border bg-white px-3.5 py-2.5">
        <div className="flex items-baseline justify-between gap-2"><p className="text-sm font-semibold truncate">{fromName}</p><span className="text-[11px] text-muted-foreground shrink-0">now</span></div>
        <p className="text-sm truncate">{fill(subject) || <span className="text-muted-foreground">No subject yet</span>}</p>
        <p className="text-xs text-muted-foreground truncate">{fill(preheader ?? "") || "— no preview line: the inbox shows the email's first words"}</p>
      </div>

      <div className={`rounded-2xl border border-border bg-secondary/40 ${view === "phone" ? "p-3 grid place-items-center" : "p-2"}`}>
        {view === "phone" ? (
          <div className="rounded-[2.2rem] border-[10px] border-neutral-800 bg-neutral-800 shadow-xl overflow-hidden" style={{ width: 375 + 20 }}>
            <div className="h-5 bg-neutral-800 grid place-items-center"><span className="h-1.5 w-16 rounded-full bg-neutral-600" /></div>
            <iframe title="Email on a phone" sandbox="" srcDoc={r.html} className="block bg-white" style={{ width: 375, height: compact ? 560 : 680, border: 0 }} />
          </div>
        ) : (
          <iframe title="Email on a laptop" sandbox="" srcDoc={r.html} className="block w-full rounded-xl bg-white" style={{ height: compact ? 560 : 720, border: 0 }} />
        )}
      </div>

      <div className="space-y-1.5">
        {problems.length === 0
          ? <p className="text-xs text-success inline-flex items-center gap-1.5"><CheckCircle2 className="h-3.5 w-3.5" />Ready — nothing to fix</p>
          : problems.map(p => (
            <p key={p.text} className={`text-xs flex items-start gap-1.5 ${p.level === "stop" ? "text-destructive" : "text-amber-800"}`}>
              {p.level === "stop" ? <OctagonX className="h-3.5 w-3.5 shrink-0 mt-px" /> : <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-px" />}{p.text}</p>
          ))}
      </div>
    </div>
  );
}
