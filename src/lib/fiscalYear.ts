/**
 * Financial years — India's, 1 April to 31 March, unless a business set another
 * start month (Settings → Year closing, only before its first close). Pure —
 * nothing but dates in, dates out.
 *
 * Dates are compared as local calendar days ("2026-03-31"): an entry made at
 * 11 pm on 31 March belongs to that year wherever the clock's time zone is.
 */

export interface FiscalYear {
  /** "2025-26" — how the year is named everywhere. */
  key: string;
  /** First and last day, "YYYY-MM-DD". */
  from: string;
  to: string;
  /** The calendar year it starts in. */
  startYear: number;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** A date (ISO string or Date) as its local calendar day, "YYYY-MM-DD". "" when not a date. */
export function dayOf(v: string | Date | undefined | null): string {
  if (!v) return "";
  // A bare day is already a day — never shift it through a time zone.
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  const d = typeof v === "string" ? new Date(v) : v;
  if (Number.isNaN(+d)) return "";
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** The year that starts in `startYear`. `startMonth` 1–12 (4 = April). */
export function fiscalYear(startYear: number, startMonth = 4): FiscalYear {
  const sm = startMonth >= 1 && startMonth <= 12 ? startMonth : 4;
  const end = new Date(startYear + 1, sm - 1, 0); // the day before the next year starts
  const endYear = end.getFullYear();
  const key = sm === 1 ? String(startYear) : `${startYear}-${String(endYear).slice(-2)}`;
  return { key, from: `${startYear}-${pad(sm)}-01`, to: dayOf(end), startYear };
}

/** The year a date falls in. */
export function fiscalYearOf(v: string | Date, startMonth = 4): FiscalYear {
  const day = dayOf(v) || dayOf(new Date());
  const y = Number(day.slice(0, 4)), m = Number(day.slice(5, 7));
  const sm = startMonth >= 1 && startMonth <= 12 ? startMonth : 4;
  return fiscalYear(m >= sm ? y : y - 1, sm);
}

/** The year after this one. */
export function nextFiscalYear(fy: FiscalYear, startMonth = 4): FiscalYear {
  return fiscalYear(fy.startYear + 1, startMonth);
}

/** Every year from the one holding `firstDay` to the one holding `lastDay`, oldest first. */
export function fiscalYearsBetween(firstDay: string, lastDay: string, startMonth = 4): FiscalYear[] {
  const a = fiscalYearOf(firstDay, startMonth), b = fiscalYearOf(lastDay, startMonth);
  const out: FiscalYear[] = [];
  for (let y = a.startYear; y <= b.startYear && out.length < 100; y++) out.push(fiscalYear(y, startMonth));
  return out;
}

/** "1 Apr 2025 – 31 Mar 2026". */
export function fiscalYearSpan(fy: FiscalYear): string {
  const f = (s: string) => new Date(`${s}T00:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  return `${f(fy.from)} – ${f(fy.to)}`;
}

/** True when the day is on or before `until` (both "YYYY-MM-DD"). An empty day is never locked. */
export function onOrBefore(day: string, until: string | undefined): boolean {
  return !!day && !!until && day <= until;
}

/* ── Years on the business's own dates (Diwali to Diwali, say) ─────────────
 * Some businesses close their books on a day of their own choosing — the eve
 * of Diwali, which falls on a different date every year. Their years are not
 * worked out from a month: each runs from the day after the last close to the
 * last day chosen when it is closed (Settings → Year closing). */

/** The day `n` days after a "YYYY-MM-DD" day. */
export function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00`);
  d.setDate(d.getDate() + n);
  return dayOf(d);
}

/** A year on its own dates, named by the calendar years it spans ("2025-26",
 *  or "2025" inside one calendar year). A name already taken gets " (2)". */
export function customYear(from: string, to: string, taken: string[] = []): FiscalYear {
  const a = Number(from.slice(0, 4)), b = Number(to.slice(0, 4));
  let key = a === b ? String(a) : `${a}-${String(b).slice(-2)}`;
  for (let i = 2; taken.includes(key) && i < 20; i++) key = `${a === b ? a : `${a}-${String(b).slice(-2)}`} (${i})`;
  return { key, from, to, startYear: a };
}

/** The settings a year's dates are read from. */
export interface YearSettings {
  fyStartMonth?: number;
  fyCustomDates?: boolean;
  fyOwnStart?: string;
  fyOwnEnd?: string;
  booksClosedTo?: string;
  yearCloses?: { key: string; from: string; to: string; status: "closed" | "reopened" }[];
}

/** Ranges to offer in a date filter: this year (to today), then the years before
 *  it — the business's own closed years when it keeps its own dates. */
export function yearRanges(s: YearSettings | undefined | null, today = dayOf(new Date())): { key: string; label: string; from: string; to: string }[] {
  const sm = s?.fyStartMonth || 4;
  if (s?.fyCustomDates) {
    const closed = (s.yearCloses ?? []).filter(e => e.status === "closed").sort((x, y) => y.to.localeCompare(x.to));
    const start = ownYear(s, today).from;
    return [
      ...(start && start <= today ? [{ key: "fy", label: `This year (from ${fiscalDay(start)})`, from: start, to: today }] : []),
      ...closed.slice(0, 4).map((e, i) => ({ key: `fyc${i}`, label: `Year ${e.key} (${fiscalDay(e.from)} – ${fiscalDay(e.to)})`, from: e.from, to: e.to })),
    ];
  }
  const cur = fiscalYearOf(today, sm);
  const out = [{ key: "fy", label: `This financial year (${cur.key})`, from: cur.from, to: today }];
  for (let i = 1; i <= 3; i++) {
    const fy = fiscalYear(cur.startYear - i, sm);
    out.push({ key: i === 1 ? "lastfy" : `fy${i}`, label: i === 1 ? `Last financial year (${fy.key})` : `Financial year ${fy.key}`, from: fy.from, to: fy.to });
  }
  return out;
}

/** "21 Oct 2025". */
export function fiscalDay(day: string): string {
  return new Date(`${day}T00:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

/** Lakshmi Puja — the main day of Diwali; the usual close for a Diwali year. */
export const DIWALI: string[] = ["2024-11-01", "2025-10-20", "2026-11-08", "2027-10-29", "2028-10-17", "2029-11-05", "2030-10-26"];

/** The first Diwali at least a month after a day — the natural end of a Diwali year starting then. */
export function nextDiwali(after: string): string | undefined {
  const min = addDays(after, 30);
  return DIWALI.find(d => d >= min);
}

/**
 * The year running now for a business on its own dates (Diwali to Diwali, or any
 * day it closes its books). One rule for every screen — Year closing, Targets,
 * the date filters:
 *   starts  "This year started on" (Settings → Year closing; set before the first
 *           close — a business that began using the app mid-year), else the day
 *           after the last close, else the day after the last Diwali;
 *   ends    "This year ends on" (any day), else `plannedTo` (a target's year end),
 *           else the next Diwali, else a year later.
 */
export function ownYear(s: YearSettings | undefined | null, today = dayOf(new Date()), plannedTo?: string): { from: string; to: string } {
  const closed = s?.booksClosedTo;
  let from: string;
  if (s?.fyOwnStart && (!closed || s.fyOwnStart > closed)) from = s.fyOwnStart;
  else if (closed) from = addDays(closed, 1);
  else {
    const last = [...DIWALI].reverse().find(d => d < today);
    from = last ? addDays(last, 1) : `${today.slice(0, 4)}-01-01`;
  }
  const to = (s?.fyOwnEnd && s.fyOwnEnd > from ? s.fyOwnEnd : undefined)
    ?? (plannedTo && plannedTo > from ? plannedTo : undefined)
    ?? nextDiwali(from)
    ?? addDays(`${Number(from.slice(0, 4)) + 1}${from.slice(4)}`, -1);
  return { from, to };
}
