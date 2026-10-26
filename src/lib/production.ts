// How long a piece has been in production, and whether its diamonds have gone
// to the factory — the two things a running order is chased on.
//
// Worked out from what the order already records: production starts when the
// stage before "In Production" is finished (for a normal order, CAD done — the
// moment its status turns In Production) and ends at Final Approval. Nothing is
// stored, so every order — old ones too — shows it.
import { isDiamondOnlyOrder, type MaterialIssuance, type Order, type Settings } from "./db";
import { orderMaterialRequirements } from "./manufacturing";

export const DEFAULT_PRODUCTION_DELAY_DAYS = 7;

/** Days in production after which a piece counts as delayed (Settings → Production Timeline). */
export function productionDelayDays(settings?: Pick<Settings, "productionDelayDays"> | null): number {
  const n = Math.floor(Number(settings?.productionDelayDays));
  return n > 0 ? n : DEFAULT_PRODUCTION_DELAY_DAYS;
}

export interface ProductionTrack {
  /** The day production started (ISO), when the order records it. */
  startedAt?: string;
  /** Final Approval's day, once the piece is finished. */
  endedAt?: string;
  /** Whole days in production — up to today while it runs. null = start not recorded. */
  days: number | null;
  /** Still being made: started, Final Approval not yet done. */
  running: boolean;
  /** Running longer than the business's limit. */
  delayed: boolean;
  limit: number;
  /** The order calls for diamonds. */
  needsDiamonds: boolean;
  /** When the first diamonds for it went to a factory. */
  diamondsIssuedAt?: string;
}

// Calendar days where the person is: a bare yyyy-mm-dd is that day, a full
// timestamp the local day it fell on.
const dayOf = (iso: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (m) return Date.UTC(+m[1], +m[2] - 1, +m[3]);
  const d = new Date(iso);
  return isNaN(+d) ? null : Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
};
const daysBetween = (fromIso: string, toIso: string) => {
  const a = dayOf(fromIso), b = dayOf(toIso);
  return a == null || b == null ? null : Math.max(0, Math.round((b - a) / 86400e3));
};

/**
 * The order's production record, or null when it has none to show: nothing is
 * made (loose stones, a Ready Stock sale), it was rejected or deleted, or
 * production has not started yet.
 */
export function productionTrack(
  o: Order,
  issuances: MaterialIssuance[],
  settings?: Pick<Settings, "productionDelayDays"> | null,
): ProductionTrack | null {
  if (o.deletedAt || o.status === "Rejected" || o.melted || isDiamondOnlyOrder(o) || o.materialSourcing === "readyStock") return null;
  const tl = o.timeline ?? [];
  const ip = tl.findIndex(t => t.step === "In Production");
  // Production begins when the stage before In Production is finished; a
  // timeline without that stage begins it where the status turns In Production.
  const startIdx = ip > 0 ? ip - 1 : 2;
  const startStep = tl[startIdx];
  if (!startStep || startStep.status !== "done") return null;
  const fa = tl.find(t => t.step === "Final Approval");
  const finished = !!fa && fa.status === "done";
  const startedAt = startStep.date || undefined;
  const endedAt = finished ? fa!.date || undefined : undefined;
  const today = new Date().toISOString();
  const days = startedAt ? daysBetween(startedAt, endedAt ?? today) : null;
  const limit = productionDelayDays(settings);
  const running = !finished && !["Ready", "Dispatched", "Delivered"].includes(o.status);
  const needsDiamonds = orderMaterialRequirements(o).needsDiamond;
  const firstDia = issuances
    .filter(i => i.orderId === o.id && i.material === "diamond" && i.issuedAt)
    .map(i => i.issuedAt)
    .sort()[0];
  return {
    startedAt, endedAt, days, running, limit,
    delayed: running && days != null && days >= limit,
    needsDiamonds,
    diamondsIssuedAt: firstDia,
  };
}

/** Still being made, its diamonds asked for and none sent to the factory yet. */
export const diamondsMissing = (t: ProductionTrack | null) => !!t && t.running && t.needsDiamonds && !t.diamondsIssuedAt;
