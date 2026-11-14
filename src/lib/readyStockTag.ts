// A Ready Stock lot's own tag number — "RS-00042" — the barcode on its tag. The SKU is the
// design number, shared by every lot of that design and by a lot's office splits, so a scan
// of it can't say which lot is in hand; the tag number can. Given once, when the lot's tag is
// first opened to print (reserved from the counter, so two people never get the same one),
// and kept for good. The SKU stays on the tag as its label.
import { assertFresh, loadDb, updateDb, type ReadyStockItem } from "./db";
import { highestSuffix, reserveSequence } from "./counters";

/** The code a lot's barcode carries: its tag number, else (not given yet) its SKU, else its id. */
export const tagCode = (i: Pick<ReadyStockItem, "tagNo" | "sku" | "id">) => i.tagNo || i.sku || i.id;
/** What a lot is called on its card: its tag number, else the end of its id. */
export const tagShown = (i: Pick<ReadyStockItem, "tagNo" | "id">) => i.tagNo || `ID ${i.id.slice(-6).toUpperCase()}`;

/** Give a lot its tag number if it has none; returns it. Needs the server's answer (not a saved copy). */
export async function ensureTagNo(itemId: string): Promise<string | null> {
  const it = (loadDb().readyStock ?? []).find(x => x.id === itemId);
  if (!it) return null;
  if (it.tagNo) return it.tagNo;
  assertFresh();
  const floor = highestSuffix((loadDb().readyStock ?? []).map(x => x.tagNo), 0) + 1;
  const n = await reserveSequence("rsTagNo", floor);
  const tag = `RS-${String(n).padStart(5, "0")}`;
  updateDb(d => {
    const x = d.readyStock.find(y => y.id === itemId);
    if (x && !x.tagNo) x.tagNo = tag;
  });
  return (loadDb().readyStock ?? []).find(x => x.id === itemId)?.tagNo ?? tag;
}
