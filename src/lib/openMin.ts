/**
 * The earliest day an entry form's date may be set to: the day after the last
 * closed financial year (Settings → Year closing), or nothing when no year is
 * closed. Given to a date box as `min`, so its calendar greys out the closed
 * days — a save dated in them would be refused anyway (lib/yearLock.ts).
 */
import { loadDb } from "./db";
import { firstOpenDay } from "./yearLock";

export function openMin(): string | undefined {
  return firstOpenDay(loadDb().settings);
}
