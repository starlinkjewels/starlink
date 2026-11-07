/**
 * A statement for a period, as books print one: the balance brought forward
 * from before the period, the period's own entries, their totals, and the
 * balance it closes on.
 *
 * Every statement in the app already works each row's balance out over the
 * whole account, oldest first — so a row shown for a period still carries its
 * true balance. What a period also needs is the line before the first of them:
 * the balance after the last entry BEFORE the period (the opening from before
 * the app included). That is this year's opening balance when the period is a
 * financial year — the closing balance of the year before.
 */
export interface PeriodRow { id: string; date: string; balance: number; pinned?: boolean }

export interface Period<T> {
  /** The balance brought forward, or null when the period has no start (all dates). */
  broughtForward: number | null;
  /** The entries inside the period, oldest first. Without a start date, the opening line is among them. */
  rows: T[];
  /** The balance the period closes on. */
  closing: number;
}

const t0 = (d: Date | string) => +(typeof d === "string" ? new Date(d) : d);

/**
 * Cut an oldest-first statement to a period. `from` / `to` are the start and the
 * end (inclusive; null = open). An opening line (pinned, the balance from before
 * the app) belongs to what is brought forward once a start date is chosen.
 */
export function cutPeriod<T extends PeriodRow>(asc: T[], from: Date | null, to: Date | null): Period<T> {
  if (!from) {
    const rows = asc.filter(r => r.pinned || !to || t0(r.date) <= t0(to));
    return { broughtForward: null, rows, closing: rows.length ? rows[rows.length - 1].balance : 0 };
  }
  let bf = 0;
  const rows: T[] = [];
  for (const r of asc) {
    if (r.pinned || t0(r.date) < t0(from)) { bf = r.balance; continue; }
    if (to && t0(r.date) > t0(to)) continue;
    rows.push(r);
  }
  return { broughtForward: bf, rows, closing: rows.length ? rows[rows.length - 1].balance : bf };
}
