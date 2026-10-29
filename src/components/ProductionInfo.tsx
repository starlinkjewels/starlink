import { Factory, Gem } from "lucide-react";
import { fmtDate } from "@/lib/db";
import type { ProductionTrack } from "@/lib/production";

const plural = (n: number) => `${n} day${n === 1 ? "" : "s"}`;

/**
 * A running order's production at a glance: how many days (a bar that fills
 * towards the business's limit and turns red past it), since when, and whether
 * its diamonds have gone to the factory. The same in the table, the grid, the
 * board and on the order.
 *
 * On the order itself the days and the diamond chip are taps — to the timeline
 * and to Manufacturing, where they are dealt with. In a list (no handlers) they
 * stay plain, so a tap there still opens the order.
 */
export function ProductionInfo({ t, compact = false, onDays, onDiamonds }: {
  t: ProductionTrack;
  compact?: boolean;
  onDays?: () => void;
  onDiamonds?: () => void;
}) {
  const pct = t.days == null ? 0 : Math.min(100, Math.round(t.days / t.limit * 100));
  const tone = !t.running ? "bg-success" : t.delayed ? "bg-destructive" : pct >= 70 ? "bg-destructive/55" : "bg-primary";
  const text = !t.running ? "text-muted-foreground" : t.delayed ? "text-destructive" : pct >= 70 ? "text-destructive/85" : "text-foreground/80";
  const missing = t.running && t.needsDiamonds && !t.diamondsIssuedAt;
  // Spans, not paragraphs: on the order this sits inside a button.
  const days = (
    <>
      <span className={`flex items-center gap-1 text-[11px] leading-tight font-semibold whitespace-nowrap ${text} ${onDays ? "group-hover:underline underline-offset-2" : ""}`}>
        <Factory className="h-3 w-3 shrink-0" />
        {t.days == null ? "In production" : t.running ? `${t.delayed ? "Delayed" : "In production"} · ${plural(t.days)}` : `Made in ${plural(t.days)}`}
      </span>
      {t.running && t.days != null && (
        <span className="block mt-1 h-1 rounded-full bg-secondary overflow-hidden" title={`${plural(t.days)} of ${plural(t.limit)}`}>
          <span className={`block h-full rounded-full ${tone}`} style={{ width: `${Math.max(pct, 4)}%` }} />
        </span>
      )}
      {t.startedAt && <span className="block mt-0.5 text-[10px] leading-tight text-muted-foreground whitespace-nowrap tabular-nums">Started {fmtDate(t.startedAt)}</span>}
    </>
  );
  const chip = "inline-flex items-center gap-1 rounded-full bg-destructive/10 text-destructive px-1.5 py-0.5 text-[10px] font-semibold leading-none whitespace-nowrap";
  return (
    <div className={`min-w-0 ${compact ? "space-y-1" : "space-y-1.5"}`}>
      {onDays ? (
        <button type="button" onClick={onDays} title="See the timeline"
          className="group block w-full min-w-0 text-left rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          {days}
        </button>
      ) : (
        <div className="min-w-0">{days}</div>
      )}
      {t.needsDiamonds && (missing ? (
        onDiamonds ? (
          <button type="button" onClick={onDiamonds} title="Add them under Manufacturing"
            className={`${chip} hover:bg-destructive/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring`}>
            <Gem className="h-3 w-3" /> Diamonds not issued
          </button>
        ) : (
          <span className={chip}>
            <Gem className="h-3 w-3" /> Diamonds not issued
          </span>
        )
      ) : t.diamondsIssuedAt ? (
        <p className="flex items-center gap-1 text-[10px] leading-tight text-muted-foreground whitespace-nowrap tabular-nums">
          <Gem className="h-3 w-3 shrink-0 text-sky-600" /> Diamonds issued {fmtDate(t.diamondsIssuedAt)}
        </p>
      ) : null)}
    </div>
  );
}
