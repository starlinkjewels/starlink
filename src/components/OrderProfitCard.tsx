import { useState } from "react";
import { Link } from "react-router-dom";
import { fmtMoney, costDataReady, type DB, type Order } from "@/lib/db";
import { fmtMoneyInr } from "@/lib/manufacturing";
import { orderProfit, inProfitReport, exchangeDifference, type CostLine } from "@/lib/orderCost";
import { TrendingUp, TrendingDown, Lock, AlertTriangle, ChevronDown, Loader2 } from "lucide-react";

/**
 * Cost, selling price and profit for one order. ADMIN ONLY — the caller must
 * gate it; this card never checks the role itself.
 *
 * Shows its working: every rupee of cost is a line that can be traced to a
 * bill or the factory's charge, and anything that could not be valued is
 * listed as missing rather than quietly counted as nothing.
 */
export function OrderProfitCard({ db, order }: { db: DB; order: Order }) {
  const [open, setOpen] = useState(false);
  // Until the purchases, issuances and the rest have arrived, a cost worked out
  // now would be too low and the profit too high. Say it is coming instead.
  if (!costDataReady()) {
    return (
      <div className="card-luxe p-6 border-amber-500/30">
        <h3 className="font-display text-lg text-brand-dark">Cost &amp; Profit</h3>
        <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1.5">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Working out the cost…
        </p>
      </div>
    );
  }
  const p = orderProfit(db, order);
  const { cost } = p;
  const rateSet = p.costUsd !== null;
  const stockBuild = !!order.forReadyStock;
  const losing = p.profitUsd !== null && p.profitUsd < 0;
  // The same figures in rupees, at the rate the sale is booked at.
  const inr = (usd: number | null | undefined) => (p.fx && usd != null ? fmtMoneyInr(Math.round(usd * p.fx.rate)) : null);

  const section = (title: string, lines: CostLine[]) =>
    lines.length > 0 && (
      <div className="space-y-1">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{title}</p>
        {lines.map((l, i) => (
          <div key={i} className="flex items-baseline justify-between gap-3 text-xs">
            <span className="text-foreground/80 min-w-0 break-words">{l.label}</span>
            <span className="font-medium tabular-nums shrink-0">{fmtMoneyInr(l.amountInr)}</span>
          </div>
        ))}
      </div>
    );

  return (
    <div className="card-luxe p-6 space-y-4 border-amber-500/30">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <div className={`h-10 w-10 rounded-xl grid place-items-center ${losing ? "bg-destructive/10" : "bg-success/10"}`}>
            {losing ? <TrendingDown className="h-5 w-5 text-destructive" /> : <TrendingUp className="h-5 w-5 text-success" />}
          </div>
          <div>
            <h3 className="font-display text-lg text-brand-dark">Cost &amp; Profit</h3>
            <p className="text-xs text-muted-foreground flex items-center gap-1">
              <Lock className="h-3 w-3" /> Admin only — not shown to staff or the client
            </p>
          </div>
        </div>
      </div>

      {/* ── The four numbers ── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="rounded-xl bg-secondary p-3">
          <p className="text-[10px] text-muted-foreground mb-0.5">Cost</p>
          <p className="font-semibold">{fmtMoneyInr(cost.totalInr)}</p>
          {rateSet && <p className="text-[11px] text-muted-foreground">{fmtMoney(p.costUsd!)}</p>}
        </div>
        <div className="rounded-xl bg-secondary p-3">
          <p className="text-[10px] text-muted-foreground mb-0.5">Selling price</p>
          <p className="font-semibold">{stockBuild ? "—" : fmtMoney(p.sellingUsd)}</p>
          {stockBuild ? <p className="text-[11px] text-muted-foreground">stock build — not sold yet</p>
            : inr(p.sellingUsd) && <p className="text-[11px] text-muted-foreground">{inr(p.sellingUsd)}</p>}
        </div>
        <div className={`rounded-xl p-3 ${losing ? "bg-destructive/10" : "bg-success/10"}`}>
          <p className="text-[10px] text-muted-foreground mb-0.5">Profit</p>
          <p className={`font-semibold ${losing ? "text-destructive" : "text-success"}`}>
            {stockBuild || p.profitUsd === null ? "—" : `${!cost.complete ? "≤ " : ""}${fmtMoney(p.profitUsd)}`}
          </p>
          {!stockBuild && inr(p.profitUsd) && <p className={`text-[11px] font-medium ${losing ? "text-destructive/80" : "text-success/80"}`}>{!cost.complete ? "≤ " : ""}{inr(p.profitUsd)}</p>}
        </div>
        <div className={`rounded-xl p-3 ${losing ? "bg-destructive/10" : "bg-success/10"}`}>
          <p className="text-[10px] text-muted-foreground mb-0.5">Margin</p>
          <p className={`font-semibold ${losing ? "text-destructive" : "text-success"}`}>
            {stockBuild || p.marginPct === null ? "—" : `${!cost.complete ? "≤ " : ""}${p.marginPct}%`}
          </p>
        </div>
      </div>

      {/* ── What converting the payments gained or lost ── */}
      {(() => {
        const x = exchangeDifference(db, order);
        if (!x || (x.convertedUsd === 0 && x.heldUsd === 0)) return null;
        const loss = (x.usd ?? 0) < 0;
        return (
          <div className={`rounded-xl p-3 text-xs border ${loss ? "border-destructive/30 bg-destructive/5" : "border-success/30 bg-success/5"}`}>
            {x.convertedUsd > 0 && (
              <p>
                <span className={`font-semibold ${loss ? "text-destructive" : "text-success"}`}>
                  Exchange {loss ? "loss" : "gain"} {fmtMoneyInr(Math.abs(x.inr))}
                  {x.usd !== null && ` (${fmtMoney(Math.abs(x.usd))})`}
                </span>
                <span className="text-muted-foreground">
                  {" "}— the rupees actually received for {fmtMoney(x.convertedUsd)} against the rate the sale was booked at.
                  Not part of the piece&rsquo;s margin; it shows in the P&amp;L below gross profit.
                </span>
              </p>
            )}
            {x.heldUsd > 0 && (
              <p className="text-muted-foreground mt-1">
                {fmtMoney(x.heldUsd)} is still held in a foreign account — its gain or loss is realised when it is converted.
              </p>
            )}
          </div>
        );
      })()}

      {/* ── Which rate, and why that one ── */}
      {p.fx && (
        <p className="text-[11px] text-muted-foreground">
          Converted at <span className="font-medium text-foreground">₹{p.fx.rate}</span> to the dollar{" — "}
          {p.fx.basis === "dated"
            ? <>the rate in force on the {order.status === "Dispatched" || order.status === "Delivered" ? "day it was sold" : "day it was ordered (not sold yet)"}</>
            : p.fx.basis === "earliest"
              ? <span className="text-amber-700">no rate on file that far back, so the earliest one stands in</span>
              : <span className="text-amber-700">one flat rate for every order; add dated rates in Settings to book each at its own day&rsquo;s rate</span>}
        </p>
      )}

      {/* ── Why a figure is missing or only an upper bound ── */}
      {!rateSet && (
        <p className="text-xs text-muted-foreground">
          Profit needs the rupee-to-dollar rate. Set it once in{" "}
          <Link to="/settings" className="text-primary hover:underline">Settings → Pricing</Link>.
        </p>
      )}
      {!cost.complete && (
        <div className="rounded-xl bg-amber-500/10 border border-amber-500/30 p-3 text-xs">
          <p className="font-semibold text-amber-700 flex items-center gap-1.5 mb-1">
            <AlertTriangle className="h-3.5 w-3.5" /> Part of the cost is not known yet
          </p>
          <ul className="space-y-0.5 text-muted-foreground">
            {cost.missing.map((m, i) => (
              <li key={i}><span className="font-medium text-foreground">{m.label}</span> — {m.reason}</li>
            ))}
          </ul>
          <p className="text-muted-foreground mt-1.5">
            So the real cost is higher than shown, and the real profit is at most the figure above (marked ≤).
          </p>
        </div>
      )}

      {/* ── The working ── */}
      {cost.totalInr > 0 && (
        <div>
          <button onClick={() => setOpen(v => !v)}
            className="flex items-center gap-1 text-xs font-medium text-primary hover:underline">
            <ChevronDown className={`h-3.5 w-3.5 transition-transform ${open ? "rotate-180" : ""}`} />
            {open ? "Hide" : "Show"} how the cost is made up
          </button>
          {open && (
            <div className="mt-3 space-y-3 rounded-xl border border-border/60 p-3">
              {section("Gold", cost.gold)}
              {section("Diamonds", cost.diamond)}
              {section("Other materials", cost.materials)}
              {section("Factory", cost.labour)}
              {section("Shipping & other", cost.other)}
              <div className="flex items-baseline justify-between gap-3 pt-2 border-t border-border/60 text-sm">
                <span className="font-semibold text-brand-dark">Total cost</span>
                <span className="font-semibold tabular-nums">{fmtMoneyInr(cost.totalInr)}</span>
              </div>
            </div>
          )}
        </div>
      )}
      {cost.totalInr === 0 && cost.complete && (
        <p className="text-xs text-muted-foreground">
          No cost recorded against this order yet — it appears once material is bought or issued for it and the
          factory's charge is entered at Final Approval.
        </p>
      )}
    </div>
  );
}

/**
 * The same figures, one line, for an order's card in the list. ADMIN ONLY —
 * the caller gates it.
 *
 * Profit is only stated for finished work. Before the factory reports back
 * its charge is not in yet, and a profit worked out without it would read
 * high on every card in production — so those show what has been spent so far.
 */
export function OrderProfitBadge({ db, order, className = "" }: { db: DB; order: Order; className?: string }) {
  if (order.status === "Rejected") return null;
  // A badge worked out before the cost data has landed would claim a profit
  // the order never made. Nothing is better than that.
  if (!costDataReady()) return null;
  const p = orderProfit(db, order);
  const finished = inProfitReport(order);
  const le = p.cost.complete ? "" : "≤ ";

  // Stock builds and unfinished work: what has gone into it so far.
  if (!finished) {
    if (p.cost.totalInr <= 0) return null;
    return (
      <p className={`text-[11px] font-medium text-amber-700 truncate ${className}`} title="Admin only — cost recorded so far">
        <Lock className="inline h-2.5 w-2.5 -mt-0.5 mr-0.5" />Cost so far {fmtMoneyInr(p.cost.totalInr)}
      </p>
    );
  }
  if (p.profitUsd === null) {
    return (
      <p className={`text-[11px] font-medium text-amber-700 truncate ${className}`} title="Admin only — set the exchange rate in Settings to see profit">
        <Lock className="inline h-2.5 w-2.5 -mt-0.5 mr-0.5" />Cost {fmtMoneyInr(p.cost.totalInr)}
      </p>
    );
  }
  const neg = p.profitUsd < 0;
  return (
    <p className={`text-[11px] font-bold truncate ${neg ? "text-destructive" : "text-success"} ${className}`}
      title={`Admin only — cost ${fmtMoneyInr(p.cost.totalInr)}${p.cost.complete ? "" : " (part not valued yet)"}`}>
      <Lock className="inline h-2.5 w-2.5 -mt-0.5 mr-0.5" />
      {/* A loss reads as a size, not a negative profit. And when part of the
          cost is still unknown the bound flips: profit is AT MOST the figure,
          so a loss is AT LEAST its size — "≤ −$234" would point the wrong way. */}
      {neg
        ? <>Loss {le ? "≥ " : ""}{fmtMoney(Math.abs(p.profitUsd))}{p.marginPct !== null ? ` · ${le ? "≥ " : ""}${Math.abs(p.marginPct)}%` : ""}</>
        : <>Profit {le}{fmtMoney(p.profitUsd)}{p.marginPct !== null ? ` · ${le}${p.marginPct}%` : ""}</>}
    </p>
  );
}
