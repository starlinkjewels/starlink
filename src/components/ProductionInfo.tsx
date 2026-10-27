import { Factory, Gem } from "lucide-react";
import { fmtDate } from "@/lib/db";
import type { ProductionTrack } from "@/lib/production";

const plural = (n: number) => `${n} day${n === 1 ? "" : "s"}`;

/**
 * A running order's production at a glance: how many days (a bar that fills
 * towards the business's limit and turns red past it), since when, and whether
 * its diamonds have gone to the factory. The same in the table, the grid, the
 * board and on the order.
 */
export function ProductionInfo({ t, compact = false }: { t: ProductionTrack; compact?: boolean }) {
  const pct = t.days == null ? 0 : Math.min(100, Math.round(t.days / t.limit * 100));
  const tone = !t.running ? "bg-success" : t.delayed ? "bg-destructive" : pct >= 70 ? "bg-destructive/55" : "bg-primary";
  const text = !t.running ? "text-muted-foreground" : t.delayed ? "text-destructive" : pct >= 70 ? "text-destructive/85" : "text-foreground/80";
  const missing = t.running && t.needsDiamonds && !t.diamondsIssuedAt;
  return (
    <div className={`min-w-0 ${compact ? "space-y-1" : "space-y-1.5"}`}>
      <div className="min-w-0">
        <p className={`flex items-center gap-1 text-[11px] leading-tight font-semibold whitespace-nowrap ${text}`}>
          <Factory className="h-3 w-3 shrink-0" />
          {t.days == null ? "In production" : t.running ? `${t.delayed ? "Delayed" : "In production"} · ${plural(t.days)}` : `Made in ${plural(t.days)}`}
        </p>
        {t.running && t.days != null && (
          <div className="mt-1 h-1 rounded-full bg-secondary overflow-hidden" title={`${plural(t.days)} of ${plural(t.limit)}`}>
            <div className={`h-full rounded-full ${tone}`} style={{ width: `${Math.max(pct, 4)}%` }} />
          </div>
        )}
        {t.startedAt && <p className="mt-0.5 text-[10px] leading-tight text-muted-foreground whitespace-nowrap tabular-nums">Started {fmtDate(t.startedAt)}</p>}
      </div>
      {t.needsDiamonds && (missing ? (
        <span className="inline-flex items-center gap-1 rounded-full bg-destructive/10 text-destructive px-1.5 py-0.5 text-[10px] font-semibold leading-none whitespace-nowrap">
          <Gem className="h-3 w-3" /> Diamonds not issued
        </span>
      ) : t.diamondsIssuedAt ? (
        <p className="flex items-center gap-1 text-[10px] leading-tight text-muted-foreground whitespace-nowrap tabular-nums">
          <Gem className="h-3 w-3 shrink-0 text-sky-600" /> Diamonds issued {fmtDate(t.diamondsIssuedAt)}
        </p>
      ) : null)}
    </div>
  );
}
