import type { DB, Order } from "@/lib/db";
import type { Period } from "@/lib/analytics";

/** What every tab of the Reports page works from — one range, one client filter. */
export interface ReportCtx {
  db: DB;
  /** Every order this person may report on, narrowed to the chosen client. */
  orders: Order[];
  period: Period;
  /** The same length of time just before, for ▲▼ — null when the range is open. */
  prev: Period | null;
  /** Cost, profit and margin — the admin's alone, and only once costs are loaded. */
  withProfit: boolean;
  isAdmin: boolean;
  /** Set when one client is chosen. */
  clientIds?: Set<string>;
  /** Changes whenever the data does — memo key. */
  version: number;
  /** A short name for the range, for export file names. */
  fileTag: string;
}
