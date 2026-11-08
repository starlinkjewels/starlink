// The agent's Strategy tab — what a strategy team would show the owner: the
// week's top moves (each worth a figure, one tap to a task), the growth plan
// (which lever moved, what each is worth), the customer portfolio (every client
// in its segment, with the play), and how much rests on a few clients. Then
// the questions to put to the strategist. The figures: lib/aiOffice/strategy.ts.
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Compass, Crown, Flame, HandCoins, ListChecks, ShieldAlert, Sparkles, TrendingDown, TrendingUp, Users } from "lucide-react";
import { useDb } from "@/hooks/useDb";
import { SectionTitle } from "@/components/SectionTitle";
import { StatStrip } from "@/components/TableToolbar";
import { DataTable, CellTag, type DataColumn } from "@/components/DataTable";
import { Button } from "@/components/ui/button";
import { topMoves, SEGMENT, STRATEGY_QUESTIONS, type Move, type PortfolioRow, type Segment } from "@/lib/aiOffice/strategy";

const usd = (n: number | null | undefined) => (n == null ? "—" : `$${Math.round(n).toLocaleString("en-US")}`);
const sign = (n: number | null) => (n == null ? "—" : `${n >= 0 ? "+" : ""}${n}%`);
const LEVER: Record<string, string> = { customers: "Active clients", ordersPerCustomer: "Orders per client", avgOrder: "Average order" };
const KIND_ICON: Record<Move["kind"], typeof Crown> = { keep: Crown, winback: Flame, grow: TrendingUp, collect: HandCoins, risk: ShieldAlert, lever: Compass };

export function StrategyTab({ onAsk, onTask, busy }: { onAsk: (q: string) => void; onTask: (m: Move) => Promise<void> | void; busy?: boolean }) {
  const db = useDb();
  const t = useMemo(() => topMoves(db), [db]);
  const [seg, setSeg] = useState<Segment | "">("");
  const [added, setAdded] = useState<Set<string>>(new Set());
  const g = t.growth;
  const c = t.concentration;
  const segs = (Object.keys(SEGMENT) as Segment[]).map(s => {
    const rows = t.portfolio.filter(p => p.segment === s);
    return { s, n: rows.length, sales: rows.reduce((a, p) => a + p.sales12, 0) };
  });
  const shown = seg ? t.portfolio.filter(p => p.segment === seg) : t.portfolio;

  const cols: DataColumn<PortfolioRow>[] = [
    { key: "name", header: "Client", always: true, sortValue: r => r.name, csv: r => r.name, cell: r => <span className="font-medium text-brand-dark">{r.name}</span> },
    { key: "seg", header: "Segment", sortValue: r => r.segment, csv: r => SEGMENT[r.segment].label, cell: r => <CellTag tone={SEGMENT[r.segment].tone}>{SEGMENT[r.segment].label}</CellTag> },
    { key: "s12", header: "Last 12 months", align: "right", kind: "number", sortValue: r => r.sales12, csv: r => r.sales12, cell: r => usd(r.sales12) },
    { key: "s24", header: "Year before", align: "right", kind: "number", sortValue: r => r.yearBefore, csv: r => r.yearBefore, cell: r => usd(r.yearBefore) },
    { key: "o12", header: "Orders (12m)", align: "right", kind: "number", sortValue: r => r.orders12, csv: r => r.orders12, cell: r => r.orders12 },
    { key: "since", header: "Days since last", align: "right", kind: "number", sortValue: r => r.daysSinceLast, csv: r => r.daysSinceLast ?? "",
      cell: r => (r.daysSinceLast == null ? "—" : <span className={r.daysPastDue != null && r.daysPastDue > 0 ? "text-rose-700 font-medium" : ""}>{r.daysSinceLast}{r.usualGap ? <span className="text-muted-foreground font-normal"> / usual {r.usualGap}</span> : null}</span>) },
    { key: "step", header: "Next step", sortValue: r => r.nextStep, csv: r => r.nextStep, cell: r => <span className="text-xs text-muted-foreground line-clamp-2 max-w-[22rem]">{r.nextStep}</span> },
  ];

  return (
    <div className="space-y-5">
      {/* The week's moves — biggest money first. */}
      <section className="card-luxe p-5 sm:p-6 space-y-4">
        <SectionTitle icon={ListChecks} title="Top moves this week" sub="Every finding below, as a step — the biggest money first" />
        {t.moves.length === 0 ? <p className="text-sm text-muted-foreground">Nothing urgent — every client is buying on their rhythm.</p> : (
          <ol className="space-y-2">
            {t.moves.slice(0, 8).map((m, i) => {
              const Icon = KIND_ICON[m.kind];
              return (
                <li key={m.key} className="flex items-start gap-3 rounded-xl border border-border/70 p-3">
                  <span className="text-xs font-semibold text-muted-foreground w-4 pt-0.5 tabular-nums">{i + 1}</span>
                  <Icon className="h-4 w-4 mt-0.5 shrink-0 text-primary" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-brand-dark">{m.clientId ? <Link to={`/clients/${m.clientId}`} className="hover:underline">{m.title}</Link> : m.title}</p>
                    <p className="text-xs text-muted-foreground">{m.why}</p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-sm font-semibold tabular-nums text-brand-dark">{usd(m.usd)}</p>
                    <button type="button" disabled={added.has(m.key) || busy} onClick={async () => { await onTask(m); setAdded(new Set([...added, m.key])); }}
                      className="text-[11px] text-primary hover:underline disabled:text-muted-foreground disabled:no-underline">{added.has(m.key) ? "In Actions" : "Make a task"}</button>
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </section>

      {/* Growth plan: where the sales came from, and what each lever is worth. */}
      <section className="card-luxe p-5 sm:p-6 space-y-4">
        <SectionTitle icon={TrendingUp} title="Growth plan" sub="Sales = active clients × orders per client × average order — the last 12 months against the 12 before" />
        <StatStrip items={[
          { label: "Sales (12 months)", value: usd(g.now.sales), sub: `${sign(g.change.sales)} · before ${usd(g.before.sales)}`, tone: "in", icon: g.change.sales != null && g.change.sales < 0 ? TrendingDown : TrendingUp },
          { label: "Active clients", value: String(g.now.customers), sub: `${sign(g.change.customers)} · before ${g.before.customers}`, icon: Users },
          { label: "Orders per client", value: String(g.now.ordersPerCustomer), sub: `${sign(g.change.ordersPerCustomer)} · before ${g.before.ordersPerCustomer}` },
          { label: "Average order", value: usd(g.now.avgOrder), sub: `${sign(g.change.avgOrder)} · before ${usd(g.before.avgOrder)}` },
        ]} note={g.weakest ? `The weakest lever is ${LEVER[g.weakest].toLowerCase()}${g.explains ? ` (it explains ${Math.abs(g.explains[g.weakest])}% of the change)` : ""} — the plays below aim at it first.` : undefined} />
        {g.whatIf.length > 0 && (
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">What each lever is worth, a year</p>
            <div className="grid sm:grid-cols-2 gap-2">
              {g.whatIf.map(w => (
                <div key={w.label} className="rounded-xl border border-border/70 p-3 flex items-start justify-between gap-3">
                  <div className="min-w-0"><p className="text-sm text-brand-dark">{w.label}</p><p className="text-[11px] text-muted-foreground">{w.how}</p></div>
                  <p className="text-sm font-semibold tabular-nums text-emerald-700 shrink-0">+{usd(w.usd)}</p>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>

      {/* Customer portfolio: every client in its place, with the play. */}
      <section className="card-luxe p-5 sm:p-6 space-y-4">
        <SectionTitle icon={Users} title="Client portfolio" sub="Each client judged by value and by their own buying rhythm" />
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
          {segs.map(x => (
            <button key={x.s} type="button" onClick={() => setSeg(seg === x.s ? "" : x.s)} aria-pressed={seg === x.s}
              className={`text-left rounded-xl border p-3 transition-colors ${seg === x.s ? "border-primary bg-primary/[0.05]" : "border-border/70 hover:bg-secondary/50"}`}>
              <div className="flex items-center justify-between gap-2"><CellTag tone={SEGMENT[x.s].tone}>{SEGMENT[x.s].label}</CellTag><span className="text-lg font-semibold tabular-nums text-brand-dark">{x.n}</span></div>
              <p className="text-[11px] text-muted-foreground mt-1 line-clamp-2">{SEGMENT[x.s].meaning}</p>
              <p className="text-[11px] font-medium mt-0.5">{usd(x.sales)} in 12 months</p>
            </button>
          ))}
        </div>
        {seg && <p className="text-sm rounded-xl bg-secondary/50 p-3"><b>The play for {SEGMENT[seg].label}:</b> {SEGMENT[seg].play}.</p>}
        <DataTable id="strategy-portfolio" noun="client" rows={shown} columns={cols} rowKey={r => r.id} rowHref={r => `/clients/${r.id}`} pageSizes={[10, 25, 50]}
          defaultSort={{ key: "s12", dir: "desc" }} searchText={r => r.name} exportName="Client-portfolio" emptyText="No clients in this segment." />
      </section>

      {/* Concentration. */}
      <section className="card-luxe p-5 sm:p-6 space-y-3">
        <SectionTitle icon={ShieldAlert} title="How much rests on a few clients" sub="Share of the last 12 months' sales" />
        <StatStrip items={[
          { label: "Biggest client", value: `${c.top1}%`, sub: c.biggest ?? "—" },
          { label: "Top 3", value: `${c.top3}%`, tone: c.top3 >= 50 ? "out" : undefined, sub: c.top3 >= 50 ? "High — losing one would hurt" : "Spread well" },
          { label: "Top 10", value: `${c.top10}%` },
          { label: "Make 80% of sales", value: `${c.clientsFor80} of ${c.buying}`, sub: "clients" },
        ]} />
      </section>

      {/* Ask the strategist. */}
      <section className="card-luxe p-5 sm:p-6 space-y-3">
        <SectionTitle icon={Sparkles} title="Ask the strategist" sub="Answered from these figures — every number checked" />
        <div className="flex flex-wrap gap-2">
          {STRATEGY_QUESTIONS.map(q => (
            <Button key={q.label} type="button" variant="outline" size="sm" className="rounded-xl" disabled={busy} onClick={() => onAsk(q.q)}>{q.label}</Button>
          ))}
        </div>
      </section>
      <p className="text-[11px] text-muted-foreground">Sales are dispatched sales, as in Reports → Profit &amp; Loss. A client&rsquo;s rhythm is their usual gap between orders (Clients tab).</p>
    </div>
  );
}

/** Home, for admins: the week's three biggest moves, from the Strategy tab. */
export function TopMovesCard() {
  const db = useDb();
  const t = useMemo(() => topMoves(db), [db]);
  const top = t.moves.slice(0, 3);
  if (!top.length) return null;
  return (
    <section className="card-luxe p-4 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-2 text-sm font-semibold text-brand-dark"><Compass className="h-4 w-4 text-primary" />Top moves this week</span>
        <Link to="/ai?t=strategy" className="text-xs text-primary hover:underline">All moves →</Link>
      </div>
      <ol className="space-y-1.5">
        {top.map((m, i) => (
          <li key={m.key} className="flex items-start gap-2 text-sm">
            <span className="text-xs text-muted-foreground w-3 pt-0.5 tabular-nums">{i + 1}</span>
            <span className="min-w-0 flex-1"><span className="text-brand-dark">{m.title}</span><span className="block text-[11px] text-muted-foreground line-clamp-1">{m.why}</span></span>
            <span className="text-xs font-semibold tabular-nums shrink-0">{usd(m.usd)}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}
