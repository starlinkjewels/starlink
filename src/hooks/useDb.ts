import { useEffect, useReducer } from "react";
import { loadDb, type DB } from "@/lib/db";

/**
 * Live view of the store. Re-renders the component whenever the data changes
 * (create / update / delete / realtime sync), so lists and detail pages update
 * immediately instead of only after a manual refresh.
 *
 * Use this instead of `loadDb()` for data read during render.
 */
export function useDb(): DB {
  const [, bump] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    const onChange = () => bump();
    window.addEventListener("starlink-db-updated", onChange);
    return () => window.removeEventListener("starlink-db-updated", onChange);
  }, []);
  return loadDb();
}

/**
 * A number that changes every time the data does.
 *
 * The store is edited in place: adding an expense pushes onto the same array,
 * so a useMemo keyed on `db.expenses` never sees a change and serves the old
 * answer. Key a memo on this instead and it recomputes exactly when the data
 * has moved, and not on every unrelated render.
 */
export function useDbVersion(): number {
  const [v, bump] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    const onChange = () => bump();
    window.addEventListener("starlink-db-updated", onChange);
    return () => window.removeEventListener("starlink-db-updated", onChange);
  }, []);
  return v;
}
