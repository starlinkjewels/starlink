import { useSearchParams } from "react-router-dom";

/**
 * A page's search box (or any small choice) kept in the address, so Back from
 * a record returns to the list as it was left, and a link can open it already
 * narrowed ("/orders?q=GIVARA"). The address is replaced, never added to, so
 * typing does not fill the history.
 */
export function useUrlState(key: string, fallback = ""): [string, (v: string) => void] {
  const [sp, setSp] = useSearchParams();
  const value = sp.get(key) ?? fallback;
  const set = (v: string) => setSp(prev => {
    const n = new URLSearchParams(prev);
    if (v && v !== fallback) n.set(key, v); else n.delete(key);
    return n;
  }, { replace: true });
  return [value, set];
}
