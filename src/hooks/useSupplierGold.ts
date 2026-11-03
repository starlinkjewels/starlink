import { useEffect, useState } from "react";
import { collection, getDocs, query, where } from "firebase/firestore";
import { db as fsdb } from "@/lib/firebase";
import type { DB, Purchase, StockMovement, Supplier } from "@/lib/db";
import { useDb } from "@/hooks/useDb";
import { goldAccountReady, hasGoldAccount, supplierGoldOwed } from "@/lib/supplierGold";

type GoldData = Pick<DB, "stockMovements" | "purchases">;

/**
 * Fine grams owed to each supplier who has a gold account (lib/supplierGold.ts)
 * — only those; a supplier with no gold on loan is not in the map.
 *
 * The supplier list is a light page (pageData.ts): it does not download the
 * stock lines and purchases the account is worked out from. So, until those
 * are in the store anyway, only the lines that make a gold account are asked
 * for — the gold-loan stock lines and the bills made from gold on loan — and
 * the account is worked out from them exactly as the supplier's page does.
 * `null` while they are on their way (or could not be read).
 */
export function useSupplierGoldOwed(suppliers: Supplier[]): Map<string, number> | null {
  const db = useDb();
  const ready = goldAccountReady();
  const [fetched, setFetched] = useState<GoldData | null>(null);
  useEffect(() => {
    if (ready) return;
    let live = true;
    void Promise.all([
      getDocs(query(collection(fsdb, "stockMovements"), where("refType", "==", "supplierLoan"))),
      getDocs(query(collection(fsdb, "purchases"), where("fromGoldLoan", "==", true))),
    ]).then(([m, p]) => {
      if (live) setFetched({ stockMovements: m.docs.map(d => d.data() as StockMovement), purchases: p.docs.map(d => d.data() as Purchase) });
    }).catch(() => { /* not shown at all, rather than a figure short of its lines */ });
    return () => { live = false; };
  }, [ready]);
  const data: GoldData | null = ready ? db : fetched;
  if (!data) return null;
  const out = new Map<string, number>();
  for (const s of suppliers) if (hasGoldAccount(data, s)) out.set(s.id, supplierGoldOwed(data, s).owed);
  return out;
}
