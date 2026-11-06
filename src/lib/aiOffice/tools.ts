// The AI Office's tools: what the AI may look up, and the app's own answers —
// the same calculations its screens show (lib/analytics.ts for Reports, the
// factory and stock accounts, the order's own balance), run here on the data
// this admin already has. The AI never sees the records themselves, only these
// answers, and never changes anything: propose_action only notes a suggestion
// for a person to approve (lib/aiOffice/actions.ts).
import { balanceDue, orderTotal, type DB, type Order } from "@/lib/db";
import { clientTable, factoryTable, kpis, lateOpen, pctChange, pipeline, presetPeriod, previousPeriod, receivables, payables, salesBy, teamTable, type Period, type PresetKey } from "@/lib/analytics";
import { deriveStockBalances, factoryFineGoldBalance } from "@/lib/manufacturing";
import { recognisedSale, saleDate } from "@/lib/orderCost";
import { growthSignals } from "./signals";
import { allPulses, clientPulse } from "./pulse";
import { marginGuard } from "./margin";

/** What the tools need from outside the records: today's market rate for fine gold (₹/g). Set by the AI Office page. */
const context: { fineNowInr: number | null } = { fineNowInr: null };
export function setOfficeContext(c: Partial<typeof context>): void { Object.assign(context, c); }

export interface ToolDef { type: "function"; function: { name: string; description: string; parameters: Record<string, unknown> } }
/** A suggestion the AI made, waiting for a person (lib/aiOffice/actions.ts). */
export interface ProposedAction { title: string; why: string; assignee?: string; orderNumber?: string; clientName?: string; priority: "high" | "medium" | "low"; dueInDays?: number }

const PERIODS: PresetKey[] = ["today", "yesterday", "thisWeek", "lastWeek", "last7", "last30", "thisMonth", "lastMonth", "thisQuarter", "lastQuarter", "thisFY", "lastFY", "thisYear", "last12", "all"];
const periodParam = { type: "string", enum: PERIODS, description: "The time span (default thisMonth). thisFY = India's financial year (April–March)." };
const r2 = (n: number) => Math.round(n * 100) / 100;
const r3 = (n: number) => Math.round(n * 1000) / 1000;
const day = (iso?: string) => (iso ? iso.slice(0, 10) : undefined);
const daysSince = (iso?: string, now = Date.now()) => (iso ? Math.floor((now - +new Date(iso)) / 86_400_000) : null);
const periodOf = (k: unknown): { key: PresetKey; p: Period } => {
  const key = PERIODS.includes(k as PresetKey) ? (k as PresetKey) : "thisMonth";
  return { key, p: presetPeriod(key) };
};
const like = (a: string | undefined, b: string) => !!a && a.toLowerCase().includes(b.trim().toLowerCase());

export const TOOL_DEFS: ToolDef[] = [
  {
    type: "function", function: {
      name: "business_snapshot",
      description: "The whole business at a glance for a period: sales ($), orders received and sold, money collected, cost, profit and margin, on-time %, days to make, the same for the period before (with % change), open orders by stage, late orders, money owed to us by age, and what we owe suppliers and factories (₹).",
      parameters: { type: "object", properties: { period: periodParam } },
    },
  },
  {
    type: "function", function: {
      name: "growth_signals",
      description: "Today's signals, worked out from the records and ranked: clients going quiet or buying less, overdue money, late or stuck orders, factories slow or holding work, pieces heavier than estimated, ready stock not selling, best-selling designs. Start here for 'what should I do', 'how to grow', 'what needs attention'.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function", function: {
      name: "client_pulse",
      description: "Each client's own rhythm (Client Pulse): their usual gap between orders and when the next one is due (and how many days past it), what they usually buy (item, metal, karat, typical $), whether their orders are getting smaller, items they stopped buying, how fast they pay (lately vs before), money owed, a risk score 0–100 with the reasons in figures, and the next step. One client by name, or all (most at risk first; filter by stage: slipping, late, due, growing, steady, new).",
      parameters: { type: "object", properties: { name: { type: "string" }, stage: { type: "string", enum: ["slipping", "late", "due", "growing", "steady", "new"] }, limit: { type: "number", description: "Default 12" } } },
    },
  },
  {
    type: "function", function: {
      name: "margin_guard",
      description: "Gold-rate margin guard: each open gold order (price fixed when taken) — its fine gold, our gold cost (₹/g) the day it was taken against today's market rate, what the difference comes to (₹ and $) and as % of the order's value. Biggest hit first.",
      parameters: { type: "object", properties: { limit: { type: "number", description: "Default 15" } } },
    },
  },
  {
    type: "function", function: {
      name: "clients",
      description: "Clients with their numbers for a period: sales, profit, collected, outstanding, overdue (90+ days), last order, days since it, their usual gap between orders. Sort by sales, outstanding, quiet (longest since their usual gap), profit or orders.",
      parameters: { type: "object", properties: { period: periodParam, sort: { type: "string", enum: ["sales", "outstanding", "quiet", "profit", "orders"] }, limit: { type: "number", description: "Default 15, max 50" } } },
    },
  },
  {
    type: "function", function: {
      name: "client_detail",
      description: "One client by (part of) its company name: totals, who handles them, their recent orders (number, status, value, balance due, dates), money owed and since when.",
      parameters: { type: "object", properties: { name: { type: "string" } }, required: ["name"] },
    },
  },
  {
    type: "function", function: {
      name: "orders",
      description: "Find orders. Filters: stage (Waiting, Approved, In Production, Ready, Dispatched, Delivered, Rejected), late (past the promised date and not sent), client name, handled by (employee name), factory name, metal, item (Ring, Pendant …), received in a period, money still due. Returns number, client, stage, value $, balance $ (and whether it is owed now — shipped — or not until it ships), promised date, factory, handler, days open.",
      parameters: { type: "object", properties: {
        stage: { type: "string" }, late: { type: "boolean" }, client: { type: "string" }, employee: { type: "string" }, factory: { type: "string" },
        metal: { type: "string" }, item: { type: "string" }, period: periodParam, due_only: { type: "boolean" }, limit: { type: "number", description: "Default 20, max 60" },
      } },
    },
  },
  {
    type: "function", function: {
      name: "sales_breakdown",
      description: "Sales ($) in a period split by design number, item type, metal, client, month, or who handled it — each with its value and number of orders.",
      parameters: { type: "object", properties: { by: { type: "string", enum: ["design", "item", "metal", "client", "month", "employee"] }, period: periodParam, limit: { type: "number" } }, required: ["by"] },
    },
  },
  {
    type: "function", function: {
      name: "factories",
      description: "Each factory: pieces made in the period, fine gold used, labour billed and still unpaid (₹), open jobs, average days to make, and the fine gold it holds of ours now.",
      parameters: { type: "object", properties: { period: periodParam } },
    },
  },
  {
    type: "function", function: {
      name: "stock",
      description: "What is in stock now: gold by purity (g), loose diamonds by lot (ct), other materials, and Ready Stock pieces — how many, their value ($), and the pieces unsold longest.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function", function: {
      name: "money_due",
      description: "Money owed to us by client — shipped work not yet paid ($, the oldest unpaid shipment in days), the same rule as Reports; separately the unpaid balance on orders still being made (not owed yet); and what we owe suppliers and factories (₹).",
      parameters: { type: "object", properties: { limit: { type: "number", description: "Default 15" } } },
    },
  },
  {
    type: "function", function: {
      name: "team",
      description: "Each team member for a period: clients they handle, orders received and sold, sales, collected, open orders, on-time %, tasks open and done — and the open tasks themselves.",
      parameters: { type: "object", properties: { period: periodParam } },
    },
  },
  {
    type: "function", function: {
      name: "propose_action",
      description: "Suggest one task for the owner to approve — never done until a person approves it. Use for every concrete next step: who should do it (a team member's name or role, e.g. 'the client's handler', 'accounts'), why (with the figure), and the order or client it is about.",
      parameters: { type: "object", properties: {
        title: { type: "string", description: "Short task, starts with a verb: 'Call Givara about the $4,200 overdue'" },
        why: { type: "string", description: "One line with the figure behind it" },
        assignee: { type: "string", description: "A team member's name, or a role" },
        order_number: { type: "string" }, client_name: { type: "string" },
        priority: { type: "string", enum: ["high", "medium", "low"] },
        due_in_days: { type: "number" },
      }, required: ["title", "why", "priority"] },
    },
  },
];

/** The orders a figure is about: not deleted. */
const live = (db: DB) => db.orders.filter(o => !o.deletedAt);
const clientName = (db: DB, id?: string) => { const c = db.clients.find(x => x.id === id); return c ? c.companyName || c.ownerName || "—" : "—"; };
const userName = (db: DB, id?: string) => db.users.find(u => u.id === id)?.name;
const factoryName = (db: DB, id?: string) => db.factories.find(f => f.id === id)?.name;

/** The usual gap between a client's orders (median days), from their orders. */
export function usualGap(orders: Order[]): number | null {
  const ds = orders.map(o => +new Date(o.createdAt)).filter(Number.isFinite).sort((a, b) => a - b);
  if (ds.length < 3) return null;
  const gaps = ds.slice(1).map((d, i) => (d - ds[i]) / 86_400_000).sort((a, b) => a - b);
  return Math.round(gaps[Math.floor(gaps.length / 2)]);
}

function orderRow(db: DB, o: Order) {
  return {
    order: o.orderNumber, client: o.forReadyStock ? "Ready Stock" : clientName(db, o.clientId), stage: o.status,
    item: o.jewelleryType, metal: o.metal, design: o.designNumber || undefined,
    value_usd: r2(orderTotal(o)), balance_usd: r2(balanceDue(o)) || undefined, ...(balanceDue(o) > 0.009 ? { balance_owed_now: recognisedSale(o) } : {}),
    received: day(o.createdAt), promised: day(o.expectedDelivery), days_open: daysSince(o.createdAt) ?? undefined,
    factory: factoryName(db, o.assignedFactoryId), handled_by: userName(db, o.assignedEmployeeId),
  };
}

function snapshot(db: DB, args: Record<string, unknown>) {
  const { key, p } = periodOf(args.period);
  const orders = live(db);
  const k = kpis(db, orders, p, true);
  const prev = previousPeriod(p);
  const kp = prev ? kpis(db, orders, prev, true) : null;
  const ch = (a: number | null, b: number | null | undefined) => (a != null && b != null ? pctChange(a, b) : null);
  const late = lateOpen(orders);
  return {
    period: key, from: p.from || "start", to: p.to || "today",
    sales_usd: k.salesUsd, orders_sold: k.soldCount, avg_order_usd: k.avgOrderUsd, orders_received: k.receivedCount, received_value_usd: k.receivedUsd, rejected: k.rejectedCount,
    collected_usd: k.collectedUsd, cost_usd: k.costUsd, profit_usd: k.profitUsd, margin_pct: k.marginPct, profit_inr: k.profitInr,
    orders_without_full_cost: k.incomplete || undefined,
    avg_days_to_make: k.avgCycleDays, on_time_pct: k.onTimePct,
    vs_previous_pct: kp ? { sales: ch(k.salesUsd, kp.salesUsd), orders_received: ch(k.receivedCount, kp.receivedCount), collected: ch(k.collectedUsd, kp.collectedUsd), profit: ch(k.profitUsd, kp.profitUsd) } : undefined,
    open_orders_by_stage: pipeline(orders).map(s => ({ stage: s.key, orders: s.count, value_usd: s.value })),
    late_orders: late.length, late_examples: late.slice(0, 5).map(o => o.orderNumber),
    owed_to_us_usd: receivables(orders),
    we_owe_inr: payables(db),
  };
}

function clientsTool(db: DB, args: Record<string, unknown>) {
  const { key, p } = periodOf(args.period);
  const orders = live(db);
  const lim = Math.min(50, Math.max(1, Number(args.limit) || 15));
  const rows = clientTable(db, orders, p, true).filter(r => db.clients.find(c => c.id === r.id)?.status !== "inactive").map(r => {
    const gap = usualGap(orders.filter(o => o.clientId === r.id && !o.forReadyStock));
    return { ...r, gap, overdueBy: gap && r.daysSinceLast != null ? r.daysSinceLast - gap : null };
  });
  const sort = String(args.sort ?? "sales");
  const by: Record<string, (a: typeof rows[number], b: typeof rows[number]) => number> = {
    sales: (a, b) => b.salesUsd - a.salesUsd, outstanding: (a, b) => b.outstandingUsd - a.outstandingUsd,
    quiet: (a, b) => (b.overdueBy ?? -1e9) - (a.overdueBy ?? -1e9), profit: (a, b) => (b.profitUsd ?? 0) - (a.profitUsd ?? 0), orders: (a, b) => b.received - a.received,
  };
  return {
    period: key, sort,
    clients: rows.sort(by[sort] ?? by.sales).slice(0, lim).map(r => ({
      client: r.name, orders_received: r.received, sold: r.sold, sales_usd: r.salesUsd, profit_usd: r.profitUsd, margin_pct: r.marginPct,
      collected_usd: r.collectedUsd, outstanding_usd: r.outstandingUsd, overdue_90_usd: r.overdue90Usd || undefined,
      last_order: day(r.lastOrder ?? undefined), days_since_last: r.daysSinceLast, usual_gap_days: r.gap ?? undefined,
      handled_by: userName(db, db.clients.find(c => c.id === r.id)?.accountManagerId),
    })),
  };
}

function clientDetail(db: DB, args: Record<string, unknown>) {
  const name = String(args.name ?? "").trim();
  const c = db.clients.find(x => like(x.companyName, name)) ?? db.clients.find(x => like(x.ownerName, name));
  if (!c) return { error: `No client matches "${name}".` };
  const mine = live(db).filter(o => o.clientId === c.id).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  const due = mine.filter(o => recognisedSale(o) && balanceDue(o) > 0.009);
  const openBal = mine.filter(o => !recognisedSale(o) && o.status !== "Rejected" && balanceDue(o) > 0.009);
  return {
    client: c.companyName || c.ownerName, owner: c.ownerName, country: (c as { country?: string }).country, handled_by: userName(db, c.accountManagerId),
    orders_all_time: mine.length, sales_all_time_usd: r2(mine.filter(o => !["Rejected"].includes(o.status)).reduce((t, o) => t + orderTotal(o), 0)),
    usual_gap_days: usualGap(mine) ?? undefined, days_since_last_order: daysSince(mine[0]?.createdAt),
    owed_usd: r2(due.reduce((t, o) => t + balanceDue(o), 0)), oldest_unpaid_shipment: due.length ? day(due.map(saleDate).sort()[0]) : undefined,
    balance_on_open_orders_usd: r2(openBal.reduce((t, o) => t + balanceDue(o), 0)) || undefined,
    recent_orders: mine.slice(0, 12).map(o => orderRow(db, o)),
  };
}

function ordersTool(db: DB, args: Record<string, unknown>) {
  let list = live(db);
  if (args.stage) list = list.filter(o => o.status.toLowerCase() === String(args.stage).toLowerCase());
  if (args.late) { const late = new Set(lateOpen(list).map(o => o.id)); list = list.filter(o => late.has(o.id)); }
  if (args.client) list = list.filter(o => like(clientName(db, o.clientId), String(args.client)));
  if (args.employee) list = list.filter(o => like(userName(db, o.assignedEmployeeId), String(args.employee)));
  if (args.factory) list = list.filter(o => like(factoryName(db, o.assignedFactoryId), String(args.factory)));
  if (args.metal) list = list.filter(o => like(o.metal, String(args.metal)));
  if (args.item) list = list.filter(o => like(o.jewelleryType, String(args.item)));
  if (args.period) { const { p } = periodOf(args.period); list = list.filter(o => (!p.from || day(o.createdAt)! >= p.from) && (!p.to || day(o.createdAt)! <= p.to)); }
  if (args.due_only) list = list.filter(o => balanceDue(o) > 0.009);
  const lim = Math.min(60, Math.max(1, Number(args.limit) || 20));
  list.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  return { found: list.length, value_usd: r2(list.reduce((t, o) => t + orderTotal(o), 0)), balance_usd: r2(list.reduce((t, o) => t + balanceDue(o), 0)), owed_now_usd: r2(list.filter(recognisedSale).reduce((t, o) => t + balanceDue(o), 0)), orders: list.slice(0, lim).map(o => orderRow(db, o)) };
}

function salesTool(db: DB, args: Record<string, unknown>) {
  const { key, p } = periodOf(args.period);
  const by = String(args.by ?? "item");
  const keyOf: Record<string, (o: Order) => string> = {
    design: o => o.designNumber || "—", item: o => o.jewelleryType, metal: o => o.metal, client: o => clientName(db, o.clientId),
    month: o => String(o.createdAt).slice(0, 7), employee: o => userName(db, o.assignedEmployeeId) ?? "—",
  };
  const lim = Math.min(60, Math.max(1, Number(args.limit) || 20));
  return { period: key, by, rows: salesBy(live(db), p, keyOf[by] ?? keyOf.item).slice(0, lim).map(s => ({ [by]: s.key, sales_usd: s.value, orders: s.count })) };
}

function factoriesTool(db: DB, args: Record<string, unknown>) {
  const { key, p } = periodOf(args.period);
  return {
    period: key,
    factories: factoryTable(db, p).filter(f => db.factories.find(x => x.id === f.id)?.active !== false).map(f => {
      const fac = db.factories.find(x => x.id === f.id);
      return {
        factory: f.name, pieces: f.pieces, fine_gold_used_g: r3(f.fineGoldG), labour_billed_inr: Math.round(f.labourInr), labour_unpaid_inr: Math.round(f.labourPendingInr),
        open_jobs: f.openJobs, avg_days_to_make: f.avgDays, fine_gold_held_g: r3(factoryFineGoldBalance(db.materialIssuances ?? [], f.id, fac?.openingFineGold)),
      };
    }),
  };
}

function stockTool(db: DB) {
  const moves = db.stockMovements ?? [];
  const pos = (x: Record<string, number>) => Object.entries(x).filter(([, q]) => q > 0.0005);
  const gold = pos(deriveStockBalances(moves, "gold")).map(([k, q]) => ({ purity: k, grams: r3(q) }));
  const dia = pos(deriveStockBalances(moves, "diamond")).sort((a, b) => b[1] - a[1]);
  const rs = (db.readyStock ?? []).filter(i => (i.quantity ?? 0) > 0);
  const now = Date.now();
  return {
    gold, diamonds_total_ct: r3(dia.reduce((t, [, q]) => t + q, 0)), diamond_lots: dia.length, biggest_lots: dia.slice(0, 10).map(([k, q]) => ({ lot: k, ct: r3(q) })),
    ready_stock_pieces: rs.reduce((t, i) => t + i.quantity, 0), ready_stock_value_usd: r2(rs.reduce((t, i) => t + i.price * i.quantity, 0)),
    unsold_longest: [...rs].sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt))).slice(0, 10).map(i => ({ piece: i.name, sku: i.sku, item: i.jewelleryType, price_usd: i.price, days_in_stock: daysSince(i.createdAt, now) })),
  };
}

function moneyDue(db: DB, args: Record<string, unknown>) {
  const lim = Math.min(50, Math.max(1, Number(args.limit) || 15));
  // Owed: shipped and unpaid (Reports' rule); the rest of an order's balance is not owed until it ships.
  const by = new Map<string, { due: number; oldest: string; open: number }>();
  for (const o of live(db)) {
    const d = balanceDue(o);
    if (d <= 0.009 || o.forReadyStock || o.status === "Rejected") continue;
    const cur = by.get(o.clientId) ?? { due: 0, oldest: "", open: 0 };
    if (recognisedSale(o)) { cur.due += d; const at = saleDate(o); if (!cur.oldest || at < cur.oldest) cur.oldest = at; }
    else cur.open += d;
    by.set(o.clientId, cur);
  }
  const rows = [...by.entries()].filter(([, v]) => v.due > 0.009);
  return {
    owed_to_us_usd: receivables(live(db)),
    by_client: rows.sort((a, b) => b[1].due - a[1].due).slice(0, lim).map(([id, v]) => ({
      client: clientName(db, id), owed_usd: r2(v.due), oldest_unpaid_shipment_days: daysSince(v.oldest),
      balance_on_open_orders_usd: r2(v.open) || undefined, handled_by: userName(db, db.clients.find(c => c.id === id)?.accountManagerId),
    })),
    balance_on_open_orders_usd: r2([...by.values()].reduce((t, v) => t + v.open, 0)),
    we_owe_inr: payables(db),
  };
}

function teamTool(db: DB, args: Record<string, unknown>) {
  const { key, p } = periodOf(args.period);
  const open = (db.tasks ?? []).filter(t => !t.completed);
  return {
    period: key,
    team: teamTable(db, live(db), p, true).map(t => ({
      name: t.name, role: t.role, clients: t.clients, orders_received: t.received, sold: t.sold, sales_usd: t.salesUsd, collected_usd: t.collectedUsd,
      open_orders: t.open, on_time_pct: t.onTimePct, tasks_open: t.tasksOpen, tasks_done: t.tasksDone,
      open_tasks: open.filter(x => x.assignedTo === t.id).slice(0, 8).map(x => x.title),
    })),
  };
}

function pulseOut(db: DB, x: ReturnType<typeof allPulses>[number]) {
  return {
    client: x.name, stage: x.stage, risk: x.risk, reasons: x.reasons, next_step: x.nextStep, handled_by: userName(db, x.handlerId),
    orders: x.orders, usual_gap_days: x.usualGapDays, days_since_last: x.daysSinceLast, next_due: x.nextDue, days_past_due: x.daysPastDue,
    usually_buys: x.usual, order_size_change_pct: x.sizeChangePct, stopped_buying: x.dropped.length ? x.dropped : undefined,
    pay_days_recent: x.payDaysRecent, pay_days_before: x.payDaysBefore, owed_usd: x.owedUsd || undefined, overdue_60_usd: x.overdue60Usd || undefined,
  };
}

/** One tool, run here. `proposed` collects propose_action calls for the page to show. Never throws: an error is an answer. */
export function runTool(db: DB, name: string, rawArgs: string, proposed: ProposedAction[]): unknown {
  let args: Record<string, unknown> = {};
  try { args = rawArgs ? JSON.parse(rawArgs) : {}; } catch { return { error: "The arguments weren't valid JSON." }; }
  try {
    switch (name) {
      case "business_snapshot": return snapshot(db, args);
      case "growth_signals": return { signals: growthSignals(db, new Date(), context.fineNowInr).slice(0, 25) };
      case "client_pulse": {
        const lim = Math.min(40, Math.max(1, Number(args.limit) || 12));
        const name = String(args.name ?? "").trim().toLowerCase();
        if (name) {
          const c = db.clients.find(x => (x.companyName || "").toLowerCase().includes(name)) ?? db.clients.find(x => (x.ownerName || "").toLowerCase().includes(name));
          const one = c ? clientPulse(db, c.id) : null;
          return one ? { ...pulseOut(db, one) } : { error: `No client matches "${args.name}".` };
        }
        const all = allPulses(db).filter(x => !args.stage || x.stage === args.stage);
        return { clients: all.length, by_stage: Object.fromEntries(["slipping", "late", "due", "growing", "steady", "new"].map(k => [k, all.filter(x => x.stage === k).length])), list: all.slice(0, lim).map(x => pulseOut(db, x)) };
      }
      case "margin_guard": {
        const g = marginGuard(db, context.fineNowInr);
        const lim = Math.min(40, Math.max(1, Number(args.limit) || 15));
        return {
          ...(g.note ? { note: g.note } : {}), basis: "Our gold cost on the day each order was taken (the stock's average, ₹/g fine) against today's market rate for fine gold.",
          open_gold_orders: g.hits.length, total_change_usd: Math.round(g.hits.reduce((t, h) => t + h.changeUsd, 0)),
          orders: g.hits.slice(0, lim).map(h => ({ order: h.orderNumber, client: clientName(db, h.clientId), stage: h.stage, fine_gold_g: h.fineG, rate_then_inr_per_g: h.rateThenInr, rate_now_inr_per_g: h.rateNowInr, change_inr: h.changeInr, change_usd: h.changeUsd, order_value_usd: h.valueUsd, pct_of_value: h.pctOfValue })),
        };
      }
      case "clients": return clientsTool(db, args);
      case "client_detail": return clientDetail(db, args);
      case "orders": return ordersTool(db, args);
      case "sales_breakdown": return salesTool(db, args);
      case "factories": return factoriesTool(db, args);
      case "stock": return stockTool(db);
      case "money_due": return moneyDue(db, args);
      case "team": return teamTool(db, args);
      case "propose_action": {
        const pr = ["high", "medium", "low"].includes(String(args.priority)) ? (args.priority as ProposedAction["priority"]) : "medium";
        const a: ProposedAction = {
          title: String(args.title ?? "").slice(0, 160).trim(), why: String(args.why ?? "").slice(0, 300).trim(), priority: pr,
          ...(args.assignee ? { assignee: String(args.assignee).slice(0, 80) } : {}),
          ...(args.order_number ? { orderNumber: String(args.order_number).slice(0, 40) } : {}),
          ...(args.client_name ? { clientName: String(args.client_name).slice(0, 120) } : {}),
          ...(Number(args.due_in_days) > 0 ? { dueInDays: Math.min(90, Math.round(Number(args.due_in_days))) } : {}),
        };
        if (!a.title) return { error: "A task needs a title." };
        proposed.push(a);
        return { ok: true, note: "Noted for the owner to approve." };
      }
      default: return { error: `There is no tool called ${name}.` };
    }
  } catch (e) {
    return { error: `That couldn't be worked out: ${(e as Error).message}` };
  }
}
