/**
 * Moving material between our companies AT A FACTORY.
 *
 * A factory holds one lump of gold, but each company's share of it is kept
 * apart — whose gold went in, whose orders used it. When one company's orders
 * need what another company delivered, the share is moved: the sending
 * company's deliveries into the pool shrink by that much, and the receiving
 * company gets a delivery of the same material marked as moved. The factory's
 * total holding — and the server's whole-factory totals — do not change, and
 * no stock moves (it never left the factory).
 */
import { type DB, type MaterialIssuance, uid } from "./db";
import { factoryPoolBalance } from "./manufacturing";
import { companyOf, coField } from "./companies";

/** Why this move cannot be made; undefined when it can. */
export function poolTransferBlocker(db: Pick<DB, "materialIssuances">, a: { factoryId: string; material: string; bucket: string; quantity: number; from: string; to: string }): string | undefined {
  if (a.from === a.to) return "Choose two different companies.";
  if (!(a.quantity > 0)) return "Enter how much to move.";
  const have = factoryPoolBalance(db.materialIssuances ?? [], a.factoryId, a.material, a.bucket, a.from);
  if (a.quantity > have + 0.0005) return `Only ${have} of ${a.bucket} is that company's at this factory.`;
  return undefined;
}

/** Make the move (call inside updateDb). Returns the new delivery, or undefined when blocked. */
export function applyPoolTransfer(
  d: DB,
  a: { factoryId: string; material: MaterialIssuance["material"]; bucket: string; quantity: number; from: string; to: string; by: string; at: string; note?: string },
): MaterialIssuance | undefined {
  if (poolTransferBlocker(d, { ...a })) return undefined;
  let left = Math.round(a.quantity * 1000) / 1000;
  // The sender's deliveries into this pool, newest first, give up the amount.
  const deliveries = (d.materialIssuances ?? [])
    .filter(i => i.factoryId === a.factoryId && i.material === a.material && i.purityOrQuality === a.bucket && !i.orderId && companyOf(i) === a.from)
    .sort((x, y) => +new Date(y.issuedAt) - +new Date(x.issuedAt));
  for (const i of deliveries) {
    if (left <= 0.0005) break;
    const take = Math.min(i.quantityIssued, left);
    if (take <= 0) continue;
    i.quantityIssued = Math.round((i.quantityIssued - take) * 1000) / 1000;
    i.notes = `${i.notes ? `${i.notes} · ` : ""}${take} moved to another company ${a.at.slice(0, 10)}`;
    left = Math.round((left - take) * 1000) / 1000;
  }
  const mi: MaterialIssuance = {
    id: uid("mi_"), factoryId: a.factoryId, material: a.material, purityOrQuality: a.bucket, ...coField(a.to),
    quantityIssued: Math.round(a.quantity * 1000) / 1000, source: "transfer",
    issuedAt: a.at, issuedBy: a.by, status: "open", finishedPieces: [], makingCharges: { amountInr: 0, payments: [] },
    notes: a.note || "Moved from another of our companies, at the factory",
  };
  if (!d.materialIssuances) d.materialIssuances = [];
  d.materialIssuances.unshift(mi);
  return mi;
}
