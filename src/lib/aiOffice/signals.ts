// What needs attention, worked out from the records — no AI in it: the same
// rules every time, each signal with its figures and the orders or clients it is
// about. The AI Office's Signals tab lists them; the AI reads them for the
// morning brief (tool growth_signals) and turns them into proposed tasks.
import { balanceDue, orderTotal, type DB, type Order } from "@/lib/db";
import { factoryTable, lateOpen, presetPeriod, salesBy, type Period } from "@/lib/analytics";
import { factoryFineGoldBalance } from "@/lib/manufacturing";
import { purchaseBucket, purchaseUnitInr } from "@/lib/materials";
import { allPulses } from "./pulse";
import { marginGuard } from "./margin";

export type SignalKind = "quiet_client" | "buying_less" | "overdue_money" | "late_orders" | "stuck_waiting" | "no_factory" | "factory_slow" | "heavier_than_estimate" | "stock_not_selling" | "top_design" | "growing_client"
  | "margin_squeeze" | "paying_slower" | "priced_low" | "cost_spike";
export interface Signal {
  kind: SignalKind;
  /** high: money or a promise at risk now; medium: this week; low: an opportunity. */
  level: "high" | "medium" | "low";
  title: string;
  detail: string;
  /** What it is worth, to rank by ($ unless said). */
  value?: number;
  orderIds?: string[];
  clientId?: string;
  factoryId?: string;
  /** Who would act: the order's or client's handler. */
  ownerId?: string;
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const usd = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
const days = (iso?: string, now = Date.now()) => (iso ? Math.floor((now - +new Date(iso)) / 86_400_000) : 0);
const range = (fromDaysAgo: number, toDaysAgo: number, now = new Date()): Period => {
  const d = (n: number) => { const x = new Date(now); x.setDate(x.getDate() - n); return x.toISOString().slice(0, 10); };
  return { from: d(fromDaysAgo), to: d(toDaysAgo) };
};

/** `fineNowInr`: today's market rate for fine gold (Rs/g) - for the margin guard; without it, that check is left out. */
export function growthSignals(db: DB, now = new Date(), fineNowInr: number | null = null): Signal[] {
  const orders = db.orders.filter(o => !o.deletedAt);
  const clientOrders = orders.filter(o => !o.forReadyStock);
  const name = (id?: string) => { const c = db.clients.find(x => x.id === id); return c ? c.companyName || c.ownerName : "a client"; };
  const handler = (o?: Order) => o?.assignedEmployeeId || db.clients.find(c => c.id === o?.clientId)?.accountManagerId;
  const out: Signal[] = [];

  // Overdue money: shipped work unpaid for 45 days or more, by client.
  const owed = new Map<string, { due: number; oldest: number; ids: string[] }>();
  for (const o of clientOrders) {
    const d = balanceDue(o);
    if (d <= 0.009 || !["Dispatched", "Delivered"].includes(o.status)) continue;
    const age = days(o.dispatchedAt ?? o.createdAt, +now);
    if (age < 45) continue;
    const cur = owed.get(o.clientId) ?? { due: 0, oldest: 0, ids: [] };
    cur.due += d; cur.oldest = Math.max(cur.oldest, age); cur.ids.push(o.id);
    owed.set(o.clientId, cur);
  }
  for (const [cid, v] of owed) out.push({
    kind: "overdue_money", level: v.oldest >= 90 || v.due >= 5000 ? "high" : "medium", clientId: cid, orderIds: v.ids, value: r2(v.due),
    ownerId: db.clients.find(c => c.id === cid)?.accountManagerId,
    title: `${name(cid)} owes ${usd(v.due)}`, detail: `${v.ids.length} shipped order${v.ids.length > 1 ? "s" : ""} unpaid, the oldest ${v.oldest} days.`,
  });

  // Late: open orders past the promised date.
  for (const o of lateOpen(orders).slice(0, 12)) out.push({
    kind: "late_orders", level: "high", orderIds: [o.id], clientId: o.clientId, value: r2(orderTotal(o)), ownerId: handler(o),
    title: `${o.orderNumber} is late`, detail: `Promised ${String(o.expectedDelivery).slice(0, 10)} to ${name(o.clientId)}, still ${o.status} (${days(o.expectedDelivery, +now)} days over).`,
  });

  // Waiting for approval for more than 3 days; approved with no factory for more than 2.
  for (const o of orders) {
    if (o.status === "Waiting" && days(o.createdAt, +now) > 3) out.push({
      kind: "stuck_waiting", level: "medium", orderIds: [o.id], clientId: o.clientId, value: r2(orderTotal(o)), ownerId: handler(o),
      title: `${o.orderNumber} waiting ${days(o.createdAt, +now)} days`, detail: `${name(o.clientId)} · ${o.jewelleryType} · ${usd(orderTotal(o))} — not approved yet.`,
    });
    if (["Approved", "In Production"].includes(o.status) && !o.assignedFactoryId && o.jewelleryType !== "Diamond Only" && days(o.createdAt, +now) > 2) out.push({
      kind: "no_factory", level: "medium", orderIds: [o.id], clientId: o.clientId, value: r2(orderTotal(o)), ownerId: handler(o),
      title: `${o.orderNumber} has no factory`, detail: `${o.status} for ${days(o.createdAt, +now)} days with no factory assigned.`,
    });
  }

  // Clients, each against their own rhythm (Client Pulse): slipping, overdue for their next order, paying slower, growing.
  for (const p of allPulses(db, now)) {
    if (p.stage === "slipping") out.push({
      kind: "buying_less", level: p.risk >= 65 ? "high" : "medium", clientId: p.clientId, value: p.usual.typicalUsd ?? undefined, ownerId: p.handlerId,
      title: `${p.name} is slipping away (risk ${p.risk})`, detail: `${p.reasons.join("; ")}. Next: ${p.nextStep}.`,
    });
    else if (p.stage === "late") out.push({
      kind: "quiet_client", level: (p.usual.typicalUsd ?? 0) >= 2000 ? "medium" : "low", clientId: p.clientId, value: p.usual.typicalUsd ?? undefined, ownerId: p.handlerId,
      title: `${p.name}'s next order is ${p.daysPastDue} days overdue`, detail: `They order every ${p.usualGapDays} days (last ${p.daysSinceLast} days ago), usually ${[p.usual.karat, p.usual.item].filter(Boolean).join(" ") || "—"} around ${p.usual.typicalUsd ? usd(p.usual.typicalUsd) : "—"}.`,
    });
    else if (p.stage === "growing") out.push({
      kind: "growing_client", level: "low", clientId: p.clientId, value: p.usual.typicalUsd ?? undefined, ownerId: p.handlerId,
      title: `${p.name} is growing`, detail: `Orders up ${p.sizeChangePct}% (last 3 against the ones before) — worth a new collection or better terms.`,
    });
    if (p.payDaysRecent != null && p.payDaysBefore != null && p.payDaysRecent > p.payDaysBefore + 10) out.push({
      kind: "paying_slower", level: "medium", clientId: p.clientId, value: p.owedUsd, ownerId: p.handlerId,
      title: `${p.name} is paying slower`, detail: `${p.payDaysRecent} days from shipping to paid lately, ${p.payDaysBefore} before${p.owedUsd ? `; ${usd(p.owedUsd)} owed now` : ""}.`,
    });
  }

  // Gold-rate margin guard: open orders whose gold now costs 3% or more of their value above what it did when taken.
  for (const h of marginGuard(db, fineNowInr, now).hits.filter(x => x.pctOfValue >= 3).slice(0, 10)) out.push({
    kind: "margin_squeeze", level: h.pctOfValue >= 8 ? "high" : "medium", orderIds: [h.orderId], clientId: h.clientId, value: h.changeUsd,
    ownerId: handler(orders.find(o => o.id === h.orderId)),
    title: `${h.orderNumber}: gold up ${usd(h.changeUsd)} since it was taken`, detail: `${h.fineG} g fine at ₹${h.rateThenInr.toLocaleString("en-IN")}/g then, ₹${h.rateNowInr.toLocaleString("en-IN")} now — ${h.pctOfValue}% of its ${usd(h.valueUsd)} value. Make it sooner, or agree the price again.`,
  });

  // Priced low: a recent order's $ per gram well under its own kind's (same item and karat, last 12 months, 5 or more).
  const perG = (o: Order) => { const g = o.estimatedNetWeight || o.estimatedGrossWeight || 0; return g > 0 && o.amount > 0 ? orderTotal(o) / g : null; };
  const yearAgo = +now - 365 * 86_400_000;
  for (const o of clientOrders.filter(x => days(x.createdAt, +now) <= 30 && perG(x) && x.productKarats)) {
    const peers = clientOrders.filter(x => x.id !== o.id && x.jewelleryType === o.jewelleryType && x.productKarats === o.productKarats && +new Date(x.createdAt) >= yearAgo).map(perG).filter((v): v is number => !!v).sort((a, b) => a - b);
    if (peers.length < 5) continue;
    const med = peers[Math.floor(peers.length / 2)], mine = perG(o)!;
    if (mine < med * 0.7) out.push({
      kind: "priced_low", level: "medium", orderIds: [o.id], clientId: o.clientId, value: r2((med - mine) * (o.estimatedNetWeight || o.estimatedGrossWeight || 0)), ownerId: handler(o),
      title: `${o.orderNumber} priced ${Math.round((1 - mine / med) * 100)}% below similar`, detail: `$${mine.toFixed(0)}/g against $${med.toFixed(0)}/g for ${o.productKarats} ${o.jewelleryType} (${peers.length} orders in 12 months) — check the price before it goes further.`,
    });
  }

  // Cost spike: a purchase in the last 30 days at 25% or more over the same material's average of the 6 months before.
  const purchases = (db.purchases ?? []).filter(p => p.material !== "readyPiece");
  const when = (p: (typeof purchases)[number]) => +new Date(p.invoiceDate || p.createdAt);
  for (const p of purchases.filter(x => +now - when(x) <= 30 * 86_400_000)) {
    const unit = purchaseUnitInr(p), key = purchaseBucket(p);
    if (!unit) continue;
    const prior = purchases.filter(x => x.id !== p.id && x.material === p.material && purchaseBucket(x) === key && when(x) < when(p) && when(p) - when(x) <= 183 * 86_400_000).map(x => purchaseUnitInr(x)).filter((v): v is number => !!v);
    if (prior.length < 2) continue;
    const avg = prior.reduce((t, v) => t + v, 0) / prior.length;
    if (unit > avg * 1.25) out.push({
      kind: "cost_spike", level: "medium",
      title: `Bought ${key} at ${Math.round((unit / avg - 1) * 100)}% over usual`, detail: `₹${Math.round(unit).toLocaleString("en-IN")} a unit on ${String(p.invoiceDate || p.createdAt).slice(0, 10)} against ₹${Math.round(avg).toLocaleString("en-IN")} on average over 6 months (${prior.length} bills) — check the bill or the supplier.`,
    });
  }

  // Factories: slow (average days over 30 with open work), and the fine gold each holds.
  for (const f of factoryTable(db, range(179, 0, now))) {
    const fac = db.factories.find(x => x.id === f.id);
    if (fac?.active === false) continue;
    const held = factoryFineGoldBalance(db.materialIssuances ?? [], f.id, fac?.openingFineGold);
    const open = orders.filter(o => o.assignedFactoryId === f.id && ["Approved", "In Production"].includes(o.status));
    const oldest = open.reduce((m, o) => Math.max(m, days(o.createdAt, +now)), 0);
    if (open.length && (oldest > 45 || (f.avgDays ?? 0) > 30)) out.push({
      kind: "factory_slow", level: oldest > 60 ? "high" : "medium", factoryId: f.id, orderIds: open.slice(0, 10).map(o => o.id), value: r2(open.reduce((t, o) => t + orderTotal(o), 0)),
      title: `${f.name}: ${open.length} job${open.length > 1 ? "s" : ""} open`, detail: `Oldest ${oldest} days; ${f.avgDays ?? "?"} days on average to make; holds ${held.toFixed(3)} g fine gold of ours.`,
    });
  }

  // Pieces that came out heavier than estimated (15% or more) in the last 90 days — the next estimate, or the price.
  const heavy = orders.filter(o => o.actualNetWeight && o.estimatedNetWeight && o.actualNetWeight > o.estimatedNetWeight * 1.15 && days(o.timeline?.find(t => t.step === "Final Approval" && t.status === "done")?.date ?? o.createdAt, +now) <= 90);
  if (heavy.length) out.push({
    kind: "heavier_than_estimate", level: heavy.length >= 3 ? "medium" : "low", orderIds: heavy.slice(0, 10).map(o => o.id),
    title: `${heavy.length} piece${heavy.length > 1 ? "s" : ""} heavier than estimated`, detail: heavy.slice(0, 4).map(o => `${o.orderNumber} ${o.estimatedNetWeight} → ${o.actualNetWeight} g`).join(", ") + " — check the estimates (and the price on such designs).",
  });

  // Ready Stock unsold for 120 days or more.
  const stale = (db.readyStock ?? []).filter(i => (i.quantity ?? 0) > 0 && days(i.createdAt, +now) >= 120);
  if (stale.length) out.push({
    kind: "stock_not_selling", level: "low", value: r2(stale.reduce((t, i) => t + i.price * i.quantity, 0)),
    title: `${stale.length} Ready Stock piece${stale.length > 1 ? "s" : ""} unsold 120+ days`, detail: `Worth ${usd(stale.reduce((t, i) => t + i.price * i.quantity, 0))} at their prices — offer them to the clients who buy that item, or rework.`,
  });

  // Best-selling designs of the last 6 months — to show clients who haven't bought them.
  const top = salesBy(clientOrders, presetPeriod("last12", now), o => o.designNumber || "").filter(s => s.key !== "—" && s.count >= 2).slice(0, 3);
  for (const s of top) out.push({
    kind: "top_design", level: "low", value: s.value,
    title: `Design ${s.key} sells`, detail: `${s.count} orders, ${usd(s.value)} in the last 12 months — offer it to clients who haven't bought it.`,
  });

  const rank = { high: 0, medium: 1, low: 2 };
  return out.sort((a, b) => rank[a.level] - rank[b.level] || (b.value ?? 0) - (a.value ?? 0));
}
