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
