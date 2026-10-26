// The client's own gold and diamonds — "job work" material. A client may give
// us their gold, their diamonds, both, or neither, order by order.
//
// It is never ours: it is not stock, carries no cost, and is not in our stock
// value. Each client has a ledger on their record (Client.materialLedger):
//   in   — they gave it to us
//   out  — we handed it back
//   use  — it went into one of their pieces (written at Final Approval, one
//          per order and material, replaced if Final Approval is re-saved)
// Held for them = in − out − use. Where it physically is: what was sent to a
// factory (MaterialIssuance source "client") and not yet used or sent back is
// at the factory; the rest is with us.
//
// Gold: the piece's fine gold plus the agreed loss % comes off the client's
// gold. If it runs short, the rest is our gold — billed on the order as
// "Gold supplied by us". Diamonds: what the piece took (issued − returned).
import { companyOfOrder } from "./companies";
import { KARAT_PURITY } from "./pure/basics";
import { factoryPoolBalance } from "./pure/accounts";
import { uid, type Client, type ClientMaterialEntry, type DB, type MaterialIssuance, type Order } from "./db";

const r3 = (n: number) => Math.round(n * 1000) / 1000;

/** The id of the bill line for gold we added to a client-gold piece. */
export const shortfallChargeId = (orderId: string) => `cs_gold_${orderId}`;

export interface ClientMaterialBalance {
  /** Fine (24K) grams held for the client, and where. */
  goldFine: number; goldAtFactory: number; goldInHand: number;
  /** Carats (and stones, where counted) held for the client, and where. */
  diaCt: number; diaPcs: number; diaAtFactory: number; diaInHand: number;
}

const clientIssuances = (d: Pick<DB, "materialIssuances">, clientId: string, material?: "gold" | "diamond") =>
  (d.materialIssuances ?? []).filter(i => i.source === "client" && i.clientId === clientId && (!material || i.material === material));

/** Fine grams a client-gold delivery to a factory carries. */
export function deliveryFine(i: Pick<MaterialIssuance, "quantityIssued" | "purityOrQuality">): number {
  const k = parseInt(String(i.purityOrQuality), 10);
  return r3(i.quantityIssued * (KARAT_PURITY[k] ?? 1));
}

/** Diamonds a client issuance has come back from the factory (unused). */
function diaBack(i: MaterialIssuance): number {
  return i.diamondKind === "certified" ? (i.finishDisposition === "returned" ? i.quantityIssued : 0) : (i.finishReturnedCt || 0);
}

export function clientMaterialBalance(d: Pick<DB, "materialIssuances">, client: Pick<Client, "id" | "materialLedger">): ClientMaterialBalance {
  const L = client.materialLedger ?? [];
  const sum = (kind: ClientMaterialEntry["kind"], material: "gold" | "diamond", f: (e: ClientMaterialEntry) => number) =>
    L.filter(e => e.kind === kind && e.material === material).reduce((s, e) => s + (f(e) || 0), 0);
  const goldFine = r3(sum("in", "gold", e => e.fine ?? 0) - sum("out", "gold", e => e.fine ?? 0) - sum("use", "gold", e => e.fine ?? 0));
  const goldSent = clientIssuances(d, client.id, "gold").reduce((s, i) => s + deliveryFine(i), 0);
  const goldAtFactory = r3(Math.max(0, goldSent - sum("use", "gold", e => e.fine ?? 0)));
  const diaCt = r3(sum("in", "diamond", e => e.ct ?? 0) - sum("out", "diamond", e => e.ct ?? 0) - sum("use", "diamond", e => e.ct ?? 0));
  const diaPcs = Math.round(sum("in", "diamond", e => e.pcs ?? 0) - sum("out", "diamond", e => e.pcs ?? 0) - sum("use", "diamond", e => e.pcs ?? 0));
  const sent = clientIssuances(d, client.id, "diamond");
  const diaAtFactory = r3(Math.max(0, sent.reduce((s, i) => s + i.quantityIssued - diaBack(i), 0) - sum("use", "diamond", e => e.ct ?? 0)));
  return {
    goldFine, goldAtFactory, goldInHand: r3(Math.max(0, goldFine - goldAtFactory)),
    diaCt, diaPcs: Math.max(0, diaPcs), diaAtFactory, diaInHand: r3(Math.max(0, diaCt - diaAtFactory)),
  };
}

/** The karat label a purity is exactly (916 → "22K"). Anything else — 999,
 *  917 — has none, and goes to the factory as its fine weight, so the
 *  factory's gold is never a touch heavier or lighter than the client's. */
export function karatForPurity(purity: number): string | undefined {
  for (const [k, p] of Object.entries(KARAT_PURITY)) if (Math.abs(p * 1000 - purity) < 0.01) return `${k}K`;
  return undefined;
}

export type Who = { id: string; name?: string };

/** The client gave us material. */
export function receiveClientMaterial(d: DB, clientId: string, e: Omit<ClientMaterialEntry, "id" | "at" | "by" | "byName" | "kind">, who: Who, at = new Date().toISOString()): ClientMaterialEntry {
  const c = d.clients.find(x => x.id === clientId);
  if (!c) throw new Error("That client is not there any more");
  const entry: ClientMaterialEntry = { ...clean(e), id: uid("cm_"), at, by: who.id, byName: who.name, kind: "in" };
  if (entry.material === "gold") entry.fine = r3((entry.grams ?? 0) * (entry.purity ?? 0) / 1000);
  c.materialLedger = [...(c.materialLedger ?? []), entry];
  return entry;
}

/** We handed material back to the client — never more than is with us. */
export function returnClientMaterial(d: DB, clientId: string, e: Omit<ClientMaterialEntry, "id" | "at" | "by" | "byName" | "kind">, who: Who, at = new Date().toISOString()): ClientMaterialEntry {
  const c = d.clients.find(x => x.id === clientId);
  if (!c) throw new Error("That client is not there any more");
  const bal = clientMaterialBalance(d, c);
  const entry: ClientMaterialEntry = { ...clean(e), id: uid("cm_"), at, by: who.id, byName: who.name, kind: "out" };
  if (entry.material === "gold") {
    entry.fine = r3((entry.grams ?? 0) * (entry.purity ?? 0) / 1000);
    if ((entry.fine ?? 0) > bal.goldInHand + 0.0005) throw new Error(`Only ${bal.goldInHand} g fine of their gold is with us`);
  } else if ((entry.ct ?? 0) > bal.diaInHand + 0.0005) throw new Error(`Only ${bal.diaInHand} ct of their diamonds is with us`);
  c.materialLedger = [...(c.materialLedger ?? []), entry];
  return entry;
}

/** Their diamonds to the order's factory, for this order. */
export function sendClientDiamonds(d: DB, order: Order, s: { ct: number; pcs?: number; certified?: boolean; shape?: string; size?: string; color?: string; clarity?: string; certLab?: string; certNo?: string }, who: Who, at = new Date().toISOString()): MaterialIssuance {
  const c = d.clients.find(x => x.id === order.clientId);
  if (!c) throw new Error("This order has no client");
  if (!order.assignedFactoryId) throw new Error("Choose the factory first");
  const bal = clientMaterialBalance(d, c);
  if (s.ct > bal.diaInHand + 0.0005) throw new Error(`Only ${bal.diaInHand} ct of their diamonds is with us — receive them first`);
  const mi: MaterialIssuance = {
    id: uid("mi_"), factoryId: order.assignedFactoryId, orderId: order.id, material: "diamond",
    purityOrQuality: s.shape?.trim() || "Client's", quantityIssued: r3(s.ct), ...(s.pcs ? { piecesIssued: Math.round(s.pcs) } : {}),
    source: "client", clientId: c.id, diamondKind: s.certified ? "certified" : "loose",
    diamondSpec: clean({ mm: s.size, color: s.color, clarity: s.clarity }),
    companyId: companyOfOrder(d, order),
    issuedAt: at, issuedBy: who.id, status: "open", finishedPieces: [], makingCharges: { amountInr: 0, payments: [] },
    notes: ["Client's own diamonds", s.certLab || s.certNo ? `${s.certLab ?? "Report"} ${s.certNo ?? ""}`.trim() : ""].filter(Boolean).join(" · "),
  };
  d.materialIssuances.push(mi);
  const o = d.orders.find(x => x.id === order.id);
  if (o) o.materialIssuanceIds = [...(o.materialIssuanceIds ?? []), mi.id];
  return mi;
}

/** Their gold to the order's factory — into the factory's gold, as ours goes. */
export function sendClientGold(d: DB, order: Order, s: { grams: number; purity: number }, who: Who, at = new Date().toISOString()): MaterialIssuance {
  const c = d.clients.find(x => x.id === order.clientId);
  if (!c) throw new Error("This order has no client");
  if (!order.assignedFactoryId) throw new Error("Choose the factory first");
  const fine = r3(s.grams * s.purity / 1000);
  const bal = clientMaterialBalance(d, c);
  if (fine > bal.goldInHand + 0.0005) throw new Error(`Only ${bal.goldInHand} g fine of their gold is with us — receive it first`);
  // A standard purity keeps its karat; any other goes as its fine weight, so the factory's fine gold is exact.
  const karat = karatForPurity(s.purity);
  const mi: MaterialIssuance = {
    id: uid("mi_"), factoryId: order.assignedFactoryId, material: "gold",
    purityOrQuality: karat ?? "24K", quantityIssued: karat ? r3(s.grams) : fine,
    source: "client", clientId: c.id, forOrderId: order.id, companyId: companyOfOrder(d, order),
    issuedAt: at, issuedBy: who.id, status: "open", finishedPieces: [], makingCharges: { amountInr: 0, payments: [] },
    notes: `Client's own gold for ${order.orderNumber} — ${r3(s.grams)} g at ${s.purity}‰ (${fine} g fine)`,
  };
  d.materialIssuances.push(mi);
  return mi;
}

/** A send made by mistake, before anything was done with it. */
export function undoClientSendBlocker(d: Pick<DB, "orders" | "materialIssuances">, i: MaterialIssuance): string | null {
  if (i.source !== "client") return "Not the client's material";
  if (i.status !== "open" || i.finishDisposition || (i.finishReturnedCt ?? 0) > 0 || (i.finishedPieces?.length ?? 0) > 0) return "Already settled at Final Approval";
  // Gold joins the factory's gold of its grade: if other pieces have drawn on it since, it is no longer all there.
  if (i.material === "gold" && !i.orderId) {
    const left = factoryPoolBalance(d.materialIssuances ?? [], i.factoryId, "gold", i.purityOrQuality, i.companyId);
    if (left + 0.0005 < i.quantityIssued) return "The factory has already used some of this gold for other pieces";
  }
  // Gold joins the factory's gold; once a piece has been approved against it, it can't simply go.
  const o = d.orders.find(x => x.id === (i.orderId ?? i.forOrderId));
  if (o?.timeline.some(t => t.step === "Final Approval" && t.status === "done")) return "The piece is approved — Final Approval has used it";
  return null;
}
export function undoClientSend(d: DB, issuanceId: string): void {
  const i = d.materialIssuances.find(x => x.id === issuanceId);
  if (!i) return;
  const why = undoClientSendBlocker(d, i);
  if (why) throw new Error(why);
  d.materialIssuances = d.materialIssuances.filter(x => x.id !== issuanceId);
  for (const o of d.orders) if (o.materialIssuanceIds?.includes(issuanceId)) o.materialIssuanceIds = o.materialIssuanceIds.filter(x => x !== issuanceId);
}

/** The client's material sent for this order: diamonds on it, gold for it. */
export const orderClientSends = (d: Pick<DB, "materialIssuances">, order: Pick<Order, "id">) =>
  (d.materialIssuances ?? []).filter(i => i.source === "client" && (i.orderId === order.id || i.forOrderId === order.id));

/** What this order has already taken from the client's material ("use" entries). */
export function orderUse(client: Pick<Client, "materialLedger"> | undefined, orderId: string, material: "gold" | "diamond"): ClientMaterialEntry | undefined {
  return (client?.materialLedger ?? []).find(e => e.kind === "use" && e.orderId === orderId && e.material === material);
}

/**
 * Final Approval: record what the piece took from the client's material —
 * replacing what an earlier save recorded. Gold: the fine gold plus the loss
 * %, from their balance; any shortfall is ours (returned, for the bill).
 * Diamonds: what the client's issuances lost to the piece (issued − returned).
 */
export function recordClientUse(d: DB, order: Order, gold: { fineInPiece: number; lossPct: number } | null, who: Who, at = new Date().toISOString()): { goldFromClient: number; shortfallFine: number; diaCt: number } {
  const c = d.clients.find(x => x.id === order.clientId);
  if (!c) return { goldFromClient: 0, shortfallFine: 0, diaCt: 0 };
  // Out with what this order recorded before, then work out afresh.
  c.materialLedger = (c.materialLedger ?? []).filter(e => !(e.kind === "use" && e.orderId === order.id));
  const out = { goldFromClient: 0, shortfallFine: 0, diaCt: 0 };
  if (gold && gold.fineInPiece > 0) {
    const need = r3(gold.fineInPiece * (1 + Math.max(0, gold.lossPct) / 100));
    const have = Math.max(0, clientMaterialBalance(d, c).goldFine);
    out.goldFromClient = r3(Math.min(need, have));
    out.shortfallFine = r3(need - out.goldFromClient);
    c.materialLedger.push({ id: uid("cm_"), at, by: who.id, byName: who.name, kind: "use", material: "gold", orderId: order.id,
      fine: out.goldFromClient, lossPct: gold.lossPct || undefined, shortfallFine: out.shortfallFine || undefined,
      note: `${gold.fineInPiece} g fine in the piece${gold.lossPct ? ` + ${gold.lossPct}% loss` : ""}` });
  }
  const dias = d.materialIssuances.filter(i => i.orderId === order.id && i.source === "client" && i.material === "diamond");
  if (dias.length) {
    let ct = 0, pcs = 0;
    for (const i of dias) {
      const used = Math.max(0, i.quantityIssued - diaBack(i));
      ct += used;
      if (i.piecesIssued) pcs += Math.max(0, i.piecesIssued - (i.finishReturnedPcs ?? (i.diamondKind === "certified" && i.finishDisposition === "returned" ? i.piecesIssued : 0)));
    }
    out.diaCt = r3(ct);
    if (out.diaCt > 0) c.materialLedger.push({ id: uid("cm_"), at, by: who.id, byName: who.name, kind: "use", material: "diamond", orderId: order.id, ct: out.diaCt, ...(pcs ? { pcs } : {}) });
  }
  return out;
}

/** Leave out empty fields — Firestore refuses undefined. */
function clean<T extends object>(o: T): T {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== "")) as T;
}

/** "3.1 g fine" / "1.04 ct · 42 pcs". */
export const fmtFine = (g: number) => `${r3(g)} g fine`;
export const fmtCt = (ct: number, pcs?: number) => `${r3(ct)} ct${pcs ? ` · ${pcs} pcs` : ""}`;
