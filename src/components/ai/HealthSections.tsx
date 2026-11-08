// The Strategy tab's second half — the money machine behind the sales: the cash
// cycle, stock health, the product mix and the season playbook. The figures:
// lib/aiOffice/health.ts. The books parts wait for the books (loaded when the tab
// opens); Ready Stock and the seasons draw at once.
import { CalendarDays, Clock, Gem, Loader2, PieChart, Wallet } from "lucide-react";
import { SectionTitle } from "@/components/SectionTitle";
import { StatStrip } from "@/components/TableToolbar";
import { DataTable, CellTag, type DataColumn } from "@/components/DataTable";
import { MIX, type Books, type MixRow, type Season, type SeasonEvent, type Shelf, type ShelfPiece } from "@/lib/aiOffice/health";

const usd = (n: number | null | undefined) => (n == null ? "—" : `$${Math.round(n).toLocaleString("en-US")}`);
const days = (n: number | null) => (n == null ? "—" : `${n} days`);
const fmtDay = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function Waiting() {
  return <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Reading the books…</p>;
}

/* ── Cash cycle ── */
export function CashSection({ books }: { books: Books | null }) {
  const c = books?.cash;
  return (
    <section className="card-luxe p-5 sm:p-6 space-y-4">
      <SectionTitle icon={Wallet} title="Cash cycle" sub="How many days a dollar is tied up — from buying gold to the client paying" />
      {!c ? <Waiting /> : (
        <>
          <StatStrip items={[
            { label: "Days to get paid", value: days(c.dso), sub: `${usd(c.receivables.total)} owed by clients` },
            { label: "Days stock waits", value: days(c.dio), op: "+", sub: `${usd(c.stock.totalUsd)} in stock and at factories` },
            { label: "Days we take to pay", value: days(c.dpo), op: "−", sub: `${usd(c.payables.totalUsd)} we owe` },
            { label: "Cash cycle", value: days(c.ccc), op: "=", tone: "strong", sub: c.tiedUpUsd != null ? `${usd(c.tiedUpUsd)} of our cash tied up` : "needs an exchange rate" },
          ]} note={c.fx == null ? "Add a dollar rate in Settings → Pricing to value the stock and what we owe in dollars." : c.stock.unpriced ? `${c.stock.unpriced} stock line${c.stock.unpriced === 1 ? "" : "s"} or piece${c.stock.unpriced === 1 ? "" : "s"} with no cost on file — not counted.` : undefined} />
          <div className="grid sm:grid-cols-3 gap-2">
            {[
              { label: "Collect 10 days faster", v: c.per10.collect, how: "less owed by clients" },
              { label: "Hold 10 days less stock", v: c.per10.stock, how: "less in gold, stones and pieces" },
              { label: "Pay suppliers 10 days later", v: c.per10.pay, how: "on agreed credit terms" },
            ].map(x => (
              <div key={x.label} className="rounded-xl border border-border/70 p-3">
                <p className="text-sm text-brand-dark">{x.label}</p>
                <p className="text-sm font-semibold tabular-nums text-emerald-700">frees {usd(x.v)}</p>
                <p className="text-[11px] text-muted-foreground">{x.how}</p>
              </div>
            ))}
          </div>
          <div className="grid sm:grid-cols-2 gap-3 text-sm">
            <div className="rounded-xl bg-secondary/40 p-3 space-y-1">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Owed by clients, by age</p>
              {([["Up to 30 days", c.receivables.current], ["31–60 days", c.receivables.d30], ["61–90 days", c.receivables.d60], ["Over 90 days", c.receivables.d90]] as const).map(([l, v]) => (
                <p key={l} className="flex justify-between"><span>{l}</span><span className={`tabular-nums ${l === "Over 90 days" && v > 0 ? "text-rose-700 font-medium" : ""}`}>{usd(v)}</span></p>
              ))}
            </div>
            <div className="rounded-xl bg-secondary/40 p-3 space-y-1">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Where the stock money is</p>
              <p className="flex justify-between"><span>Gold, diamonds and other material</span><span className="tabular-nums">{usd(c.stock.materialsUsd)}</span></p>
              <p className="flex justify-between"><span>Certified stones</span><span className="tabular-nums">{usd(c.stock.certifiedUsd)}</span></p>
              <p className="flex justify-between"><span>Our gold at factories</span><span className="tabular-nums">{usd(c.stock.goldAtFactoriesUsd)}</span></p>
              <p className="flex justify-between"><span>Ready Stock, at cost</span><span className="tabular-nums">{usd(c.stock.readyStockUsd)}</span></p>
            </div>
          </div>
        </>
      )}
    </section>
  );
}

/* ── Stock health ── */
export function StockSection({ shelf, books }: { shelf: Shelf; books: Books | null }) {
  const max = Math.max(1, ...shelf.buckets.map(b => b.pieces));
  const cols: DataColumn<ShelfPiece>[] = [
    { key: "name", header: "Piece", always: true, sortValue: r => r.name, csv: r => r.name, cell: r => <span className="font-medium text-brand-dark">{r.name}{r.sku ? <span className="text-muted-foreground font-normal"> · {r.sku}</span> : null}</span> },
    { key: "item", header: "Item", sortValue: r => r.item, csv: r => r.item, cell: r => r.item },
    { key: "qty", header: "Pcs", align: "right", kind: "number", sortValue: r => r.qty, csv: r => r.qty, cell: r => r.qty },
    { key: "days", header: "Days on shelf", align: "right", kind: "number", sortValue: r => r.days, csv: r => r.days, cell: r => <span className={r.days > 365 ? "text-rose-700 font-medium" : ""}>{r.days}</span> },
    { key: "cost", header: "Cost", align: "right", kind: "number", sortValue: r => r.costUsd ?? -1, csv: r => r.costUsd ?? "", cell: r => usd(r.costUsd) },
    { key: "price", header: "Price", align: "right", kind: "number", sortValue: r => r.priceUsd, csv: r => r.priceUsd, cell: r => usd(r.priceUsd) },
    { key: "loc", header: "Where", sortValue: r => r.location ?? "", csv: r => r.location ?? "", cell: r => r.location ?? "—" },
  ];
  const m = books?.materials;
  return (
    <section className="card-luxe p-5 sm:p-6 space-y-4">
      <SectionTitle icon={Clock} title="Stock health" sub="How long Ready Stock has waited, and how many months the gold and diamonds last" />
      <StatStrip items={[
        { label: "Ready Stock pieces", value: String(shelf.pieces), sub: `${usd(shelf.costUsd)} at cost` },
        { label: "Sold in 12 months", value: String(shelf.sold12), sub: shelf.monthsOfShelf != null ? `the shelf lasts ${shelf.monthsOfShelf} months at this pace` : "no Ready Stock sales yet" },
        { label: "Over a year on the shelf", value: String(shelf.dead.pieces), tone: shelf.dead.pieces ? "out" : undefined, sub: `${usd(shelf.dead.costUsd)} at cost` },
      ]} note={shelf.unpriced ? `${shelf.unpriced} piece${shelf.unpriced === 1 ? "" : "s"} with no cost on file.` : undefined} />
      <div className="space-y-1.5" role="list" aria-label="Ready Stock by days on the shelf">
        {shelf.buckets.map(b => (
          <div key={b.key} role="listitem" className="grid grid-cols-[7.5rem_1fr_auto] items-center gap-3 text-sm">
            <span className="text-muted-foreground">{b.label}</span>
            <span className="h-2.5 rounded-full bg-secondary overflow-hidden"><span className={`block h-full rounded-full ${b.key === "dead" ? "bg-rose-500" : b.key === "old" ? "bg-amber-500" : "bg-primary"}`} style={{ width: `${(b.pieces / max) * 100}%` }} /></span>
            <span className="tabular-nums text-right text-xs">{b.pieces} pcs · {usd(b.costUsd)}</span>
          </div>
        ))}
      </div>
      {shelf.oldest.length > 0 && (
        <DataTable id="strategy-shelf" noun="piece" rows={shelf.oldest} columns={cols} rowKey={r => r.id} rowHref={r => `/ready-stock/${r.id}`} pageSizes={[6, 12]}
          defaultSort={{ key: "days", dir: "desc" }} searchText={r => `${r.name} ${r.sku ?? ""}`} exportName="Ready-stock-oldest" emptyText="Nothing on the shelf." />
      )}
      <div className="pt-1">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2 flex items-center gap-1.5"><Gem className="h-3.5 w-3.5" />Gold and diamonds</p>
        {!m ? <Waiting /> : (
          <div className="space-y-3">
            <StatStrip items={[
              { label: "Gold in stock (fine)", value: `${m.gold.fineG} g`, sub: m.gold.monthsCover != null ? `${m.gold.monthsCover} months at ${m.gold.perMonthG} g a month` : "none used in 12 months" },
              { label: "Diamonds in stock", value: `${m.diamonds.ct} ct`, sub: m.diamonds.monthsCover != null ? `${m.diamonds.monthsCover} months at ${m.diamonds.perMonthCt} ct a month` : "none used in 12 months" },
              { label: "Untouched for a year", value: usd(m.slowUsd), tone: m.slowUsd > 0 ? "out" : undefined, sub: `${m.slow.length} lot${m.slow.length === 1 ? "" : "s"}` },
            ]} />
            {m.slow.length > 0 && (
              <ul className="text-sm divide-y divide-border/60 rounded-xl border border-border/70">
                {m.slow.slice(0, 8).map(x => (
                  <li key={`${x.material}-${x.bucket}`} className="flex items-center justify-between gap-3 px-3 py-2">
                    <span className="min-w-0 truncate">{x.bucket} <span className="text-muted-foreground">· {x.qty} {x.unit}</span></span>
                    <span className="text-xs text-muted-foreground shrink-0">{x.lastUsed ? `last used ${fmtDay(x.lastUsed)}` : "never used"}</span>
                    <span className="tabular-nums font-medium shrink-0">{usd(x.valueUsd)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

/* ── Product mix ── */
export function MixSection({ books }: { books: Books | null }) {
  const mix = books?.mix;
  const cols: DataColumn<MixRow>[] = [
    { key: "item", header: "Item", always: true, sortValue: r => r.item, csv: r => r.item, cell: r => <span className="font-medium text-brand-dark">{r.item}</span> },
    { key: "place", header: "Where it stands", sortValue: r => r.place, csv: r => MIX[r.place].label, cell: r => <CellTag tone={MIX[r.place].tone}>{MIX[r.place].label}</CellTag> },
    { key: "s12", header: "Last 12 months", align: "right", kind: "number", sortValue: r => r.sales12, csv: r => r.sales12, cell: r => usd(r.sales12) },
    { key: "share", header: "Share", align: "right", kind: "number", sortValue: r => r.share, csv: r => r.share, cell: r => `${r.share}%` },
    { key: "growth", header: "Against the year before", align: "right", kind: "number", sortValue: r => r.growth ?? 999, csv: r => r.growth ?? "",
      cell: r => (r.growth == null ? <span className="text-muted-foreground">new</span> : <span className={r.growth < 0 ? "text-rose-700" : "text-emerald-700"}>{r.growth >= 0 ? "+" : ""}{r.growth}%</span>) },
    { key: "margin", header: "Margin", align: "right", kind: "number", sortValue: r => r.marginPct ?? -999, csv: r => r.marginPct ?? "", cell: r => (r.marginPct == null ? "—" : `${r.marginPct}%`) },
  ];
  const places = (["grow", "protect", "fix", "rethink"] as const).map(p => ({ p, rows: mix?.rows.filter(r => r.place === p) ?? [] }));
  return (
    <section className="card-luxe p-5 sm:p-6 space-y-4">
      <SectionTitle icon={PieChart} title="Product mix" sub={`Each kind of piece by growth and margin${mix?.avgMargin != null ? ` — your average margin is ${mix.avgMargin}%` : ""}`} />
      {!mix ? <Waiting /> : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
            {places.map(({ p, rows }) => (
              <div key={p} className="rounded-xl border border-border/70 p-3">
                <CellTag tone={MIX[p].tone}>{MIX[p].label}</CellTag>
                <p className="text-[11px] text-muted-foreground mt-1">{MIX[p].meaning}</p>
                <p className="text-sm font-medium text-brand-dark mt-1 line-clamp-2">{rows.length ? rows.map(r => r.item).join(", ") : "—"}</p>
                <p className="text-[11px] text-muted-foreground mt-1">{MIX[p].play}</p>
              </div>
            ))}
          </div>
          <DataTable id="strategy-mix" noun="item" rows={mix.rows} columns={cols} rowKey={r => r.item} pageSizes={[10, 25]}
            defaultSort={{ key: "s12", dir: "desc" }} searchText={r => r.item} exportName="Product-mix" emptyText="No sales yet." />
        </>
      )}
    </section>
  );
}

/* ── Season playbook ── */
const STATUS: Record<SeasonEvent["status"], { label: string; tone: "green" | "blue" | "amber" | "red" | "neutral" }> = {
  on: { label: "On now", tone: "green" }, now: { label: "Show designs now", tone: "amber" }, soon: { label: "Within 30 days", tone: "blue" },
  later: { label: "Later", tone: "neutral" }, late: { label: "Too late to make for", tone: "red" },
};
const MARKET = { india: "India", export: "Export", china: "HK / China" } as const;

export function SeasonSection({ season }: { season: Season }) {
  const s = season;
  const thisMonth = new Date().getMonth();
  const hasIndex = s.salesIndex.some(v => v != null);
  const top = Math.max(150, ...s.salesIndex.map(v => v ?? 0));
  return (
    <section className="card-luxe p-5 sm:p-6 space-y-4">
      <SectionTitle icon={CalendarDays} title="Season playbook" sub={`Your own busy months, the festivals ahead, and when to act — your pieces take about ${s.leadDays} days to make`} />
      {hasIndex ? (
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Your year — each month&rsquo;s sales against an average month (100), from {s.months} months of sales</p>
          <div className="grid grid-cols-12 gap-1 sm:gap-2 items-end h-32" role="img" aria-label={`Sales by month: ${s.salesIndex.map((v, i) => `${MONTHS[i]} ${v ?? "—"}`).join(", ")}`}>
            {s.salesIndex.map((v, i) => (
              <div key={i} className="flex flex-col items-center justify-end h-full gap-1" title={`${MONTHS[i]}: ${v ?? "—"}`}>
                <span className="text-[10px] tabular-nums text-muted-foreground">{v ?? "—"}</span>
                <span className={`w-full max-w-[1.75rem] rounded-t ${v != null && v >= 115 ? "bg-primary" : v != null && v <= 85 ? "bg-primary/30" : "bg-primary/60"} ${i === thisMonth ? "ring-2 ring-offset-1 ring-brand-dark/40" : ""}`} style={{ height: `${((v ?? 0) / top) * 82}%` }} />
                <span className={`text-[10px] ${i === thisMonth ? "font-semibold text-brand-dark" : "text-muted-foreground"}`}>{MONTHS[i]}</span>
              </div>
            ))}
          </div>
          <p className="text-xs text-muted-foreground mt-2">{s.peaks.length ? <>Busiest: <b>{s.peaks.join(", ")}</b>. </> : null}{s.quiet.length ? <>Quietest: <b>{s.quiet.join(", ")}</b> — the time to make Ready Stock and clear old pieces.</> : null}</p>
        </div>
      ) : <p className="text-sm text-muted-foreground">Your own busy and quiet months show here once there is a year of sales ({s.months} month{s.months === 1 ? "" : "s"} so far). The festivals below are ready now.</p>}

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
        {s.ahead.map(m => (
          <div key={m.key} className="rounded-xl border border-border/70 p-2.5">
            <p className="text-sm font-medium text-brand-dark">{m.label}</p>
            <p className="text-[11px] text-muted-foreground">{m.mood === "busy" ? "Busy" : m.mood === "quiet" ? "Quiet" : m.mood === "normal" ? "Normal" : "—"}{m.salesIndex != null ? ` · ${m.salesIndex}` : ""}</p>
            <p className="text-[11px] tabular-nums">Last year {usd(m.lastYearUsd)}</p>
            {m.events.length > 0 && <p className="text-[11px] text-primary line-clamp-2 mt-0.5">{m.events.join(" · ")}</p>}
          </div>
        ))}
      </div>

      <div>
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Festivals and seasons ahead</p>
        <ul className="space-y-2">
          {s.events.map(e => (
            <li key={e.key} className="rounded-xl border border-border/70 p-3 flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-brand-dark">{e.name} <span className="text-xs text-muted-foreground font-normal">· {fmtDay(e.date)}{e.until && e.until !== e.date ? ` – ${fmtDay(e.until)}` : ""} · {MARKET[e.market]}{e.share != null ? ` · ${e.share}% of sales` : ""}</span></p>
                <p className="text-[11px] text-muted-foreground">{e.why}</p>
              </div>
              {e.status !== "on" && e.status !== "late" && (
                <div className="text-[11px] tabular-nums text-muted-foreground shrink-0 sm:text-right">
                  <p>{e.daysToShow <= 0 ? <>Show designs <b className="text-brand-dark">today</b></> : <>Show designs by <b className="text-brand-dark">{fmtDay(e.showBy)}</b></>}</p>
                  <p>Orders in by <b className="text-brand-dark">{fmtDay(e.ordersBy)}</b> · in shops {fmtDay(e.inShopsBy)}</p>
                </div>
              )}
              <span className="shrink-0"><CellTag tone={STATUS[e.status].tone}>{STATUS[e.status].label}</CellTag></span>
            </li>
          ))}
        </ul>
        <p className="text-[11px] text-muted-foreground mt-2">
          {s.marketShare.unknown < 50 ? <>Shown for where your clients are: India {s.marketShare.india}%, export {s.marketShare.export}%, HK / China {s.marketShare.china}% of the last 12 months&rsquo; sales. </> : <>Add each client&rsquo;s country to show only the festivals your clients buy for. </>}
          Festival dates follow the Indian calendar and can move by a day; wedding seasons follow the muhurats.
        </p>
      </div>
    </section>
  );
}
