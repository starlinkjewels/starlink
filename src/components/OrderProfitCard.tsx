import { useState } from "react";
import { Link } from "react-router-dom";
import { fmtMoney, type DB, type Order } from "@/lib/db";
import { fmtMoneyInr } from "@/lib/manufacturing";
import { orderProfit, type CostLine } from "@/lib/orderCost";
import { TrendingUp, TrendingDown, Lock, AlertTriangle, ChevronDown } from "lucide-react";

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
  const p = orderProfit(db, order);
  const { cost } = p;
  const rateSet = p.costUsd !== null;
  const stockBuild = !!order.forReadyStock;
  const losing = p.profitUsd !== null && p.profitUsd < 0;

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
          {stockBuild && <p className="text-[11px] text-muted-foreground">stock build — not sold yet</p>}
        </div>
        <div className={`rounded-xl p-3 ${losing ? "bg-destructive/10" : "bg-success/10"}`}>
          <p className="text-[10px] text-muted-foreground mb-0.5">Profit</p>
          <p className={`font-semibold ${losing ? "text-destructive" : "text-success"}`}>
            {stockBuild || p.profitUsd === null ? "—" : `${!cost.complete ? "≤ " : ""}${fmtMoney(p.profitUsd)}`}
          </p>
        </div>
        <div className={`rounded-xl p-3 ${losing ? "bg-destructive/10" : "bg-success/10"}`}>
          <p className="text-[10px] text-muted-foreground mb-0.5">Margin</p>
          <p className={`font-semibold ${losing ? "text-destructive" : "text-success"}`}>
            {stockBuild || p.marginPct === null ? "—" : `${!cost.complete ? "≤ " : ""}${p.marginPct}%`}
          </p>
        </div>
      </div>

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
              {section("Factory", cost.labour)}
              {section("Other", cost.other)}
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
