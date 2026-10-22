/**
 * Smart Pipelines — the rules, as pure functions. What counts as "an order was
 * approved", whether a pipeline's filters match, how its words are filled in,
 * how a run moves from one step to the next, and whether a pipeline is safe to
 * switch on. The app (the builder, its health check, its counts) and the server
 * (functions/, which runs the pipelines) both use this file, so what the screen
 * promises is exactly what the server does.
 *
 * A pipeline can send email, show a popup reminder, raise an app alert, create
 * a task, put a label on an order, wait, check and ask a person — and do two
 * things to an order, each exactly as the button in the app does: approve one
 * that is waiting for approval, and give an unassigned one to a salesperson.
 * It can never touch a payment, stock, a price, an invoice, a dispatch, and
 * never delete — so no pipeline, however it is built, can break the books.
 *
 * Self-contained: no Firebase, no app state, no imports — the server loads it as it is.
 */

/* ════════════════════════════ What a pipeline is ════════════════════════════ */

/** What starts a run. */
export type TriggerKind =
  // An order changed (seen the moment it is saved)
  | "order.placed" | "order.approved" | "order.stageReached" | "order.stageDone" | "order.factoryAssigned"
  | "order.materialIssued" | "order.finalApproval" | "order.dispatched" | "order.delivered" | "order.cancelled"
  | "order.paymentReceived"
  // Found by the regular check (every few minutes)
  | "order.stuck" | "order.dueSoon" | "order.overdue" | "order.unpaidAfterDispatch"
  | "invoice.raised"
  | "client.created" | "client.idle" | "client.balanceOver"
  | "stock.low"
  | "time.schedule";

export interface Trigger {
  kind: TriggerKind;
  /** order.stageReached / stageDone / stuck: the stage. */
  stage?: string;
  /** stuck, dueSoon, overdue, unpaidAfterDispatch, idle: the number of days. */
  days?: number;
  /** client.balanceOver: the amount in dollars. */
  amount?: number;
  /** stock.low: what, and below how much. */
  material?: string; bucket?: string; below?: number;
  /** time.schedule */
  every?: "day" | "weekday" | "week" | "month";
  /** "09:00", in the business's own time (IST). */
  at?: string;
  /** week: 0 = Sunday … 6; month: 1–28. */
  weekday?: number; monthDay?: number;
  /** time.schedule: run once per factory, salesperson, client or admin — each with their own list. */
  forEach?: "none" | "factory" | "salesperson" | "client" | "admin";
}

/** Who a message goes to. */
export type Recipient =
  | { kind: "client" } | { kind: "factory" } | { kind: "handler" } | { kind: "admins" } | { kind: "sales" }
  /** time.schedule with forEach: the factory, salesperson, client or admin this run is for. */
  | { kind: "each" }
  | { kind: "person"; userId: string }
  /** Every active employee of a department ("CAD", "QC", "Sales"…). */
  | { kind: "department"; name: string }
  | { kind: "address"; email: string };

/** One condition: a field, a test, a value. */
export interface Condition {
  field: FieldKey;
  op: "is" | "isNot" | "gt" | "lt" | "contains" | "isSet" | "isEmpty" | "yes" | "no";
  value?: string | number;
}

/** What an email carries below its words. */
export type EmailBlock = "order" | "jobSheet" | "money" | "list";

export type Step =
  | { id: string; kind: "email"; to: Recipient[]; subject: string; text: string; blocks?: EmailBlock[];
      /** list block: which orders (on a scheduled run, those of the factory/person it is for). */
      list?: ListSpec;
      /** "digest": held, and sent with everything else for that person in one email at the day's digest time. */
      send?: "now" | "digest" }
  | { id: string; kind: "popup"; to: Recipient[]; title: string; text: string; delayMinutes?: number }
  | { id: string; kind: "alert"; to: Recipient[]; text: string }
  | { id: string; kind: "task"; to: Recipient; title: string; dueDays: number }
  | { id: string; kind: "label"; label: string }
  | { id: string; kind: "wait"; amount: number; unit: "minutes" | "hours" | "days" }
  /** Continue only if — otherwise the run stops, quietly. */
  | { id: string; kind: "check"; all: Condition[] }
  | { id: string; kind: "split"; all: Condition[]; yes: Step[]; no: Step[] }
  /** Many ways, by one field's value. */
  | { id: string; kind: "switch"; field: FieldKey; cases: { value: string; steps: Step[] }[]; other: Step[] }
  /** Wait until it happens (yes), at most maxDays (no). */
  | { id: string; kind: "waitUntil"; all: Condition[]; maxDays: number; yes: Step[]; no: Step[] }
  /** Ask a person in the app; their answer picks the way. No answer in maxDays counts as "no". */
  | { id: string; kind: "ask"; to: Recipient; question: string; maxDays: number; yes: Step[]; no: Step[] }
  /** Approve the order — only one waiting for approval; exactly as the Approve button does (the client is told). */
  | { id: string; kind: "approve" }
  /** Give the order to a salesperson — only when nobody has it: the client's handler, or a chosen person. */
  | { id: string; kind: "assign"; who: "clientHandler" | "person"; userId?: string };

export type StepKind = Step["kind"];

export interface ListSpec {
  /** Which orders: open ones, late at the factory, due within N days, unpaid after dispatch. */
  which: "open" | "late" | "dueSoon" | "unpaid" | "newToday";
  days?: number;
}

export interface Pipeline {
  id: string;
  name: string;
  on: boolean;
  trigger: Trigger;
  /** Only if — all must hold. */
  only: Condition[];
  steps: Step[];
  /** A run for an order stops by itself when the order is cancelled or deleted (and, if set, delivered). */
  stopWhenDelivered?: boolean;
  /** When it was last switched on: the regular checks start only for what became true after it. */
  onSince?: string;
  version: number;
  updatedAt?: string;
  updatedBy?: string;
  createdAt?: string;
  /** Ready-made one it was copied from. */
  template?: string;
}

/* ════════════════════════════ The records it reads ════════════════════════════ */
// Only what the rules need — structural, so the app's records and the server's
// plain documents both fit.

export interface TimelineStepLike { step: string; status: string; date?: string; remarks?: string }
export interface OrderLike {
  id: string; orderNumber: string; clientId: string; status: string;
  timeline?: TimelineStepLike[];
  jewelleryType?: string; metal?: string; productKarats?: string; productSize?: string; productColor?: string;
  designNumber?: string; quantity?: number; diamondWeight?: number; diamondType?: string;
  estimatedNetWeight?: number; estimatedGrossWeight?: number; instructions?: string;
  expectedDelivery?: string; priority?: string; certificate?: boolean;
  amount?: number; shippingCharge?: number; certificateFee?: number;
  otherCharges?: { amountUsd?: number }[]; giftCardRedeemed?: number; returns?: { creditUsd?: number }[];
  advances?: { amount?: number; createdAt?: string }[];
  assignedFactoryId?: string; assignedEmployeeId?: string; materialSourcing?: string; forReadyStock?: boolean;
  materialIssuanceIds?: string[]; companyId?: string; createdAt?: string; deletedAt?: string;
  courierName?: string; trackingNumber?: string; dispatchedAt?: string; deliveredAt?: string;
  stoneSpec?: { stone?: string; shape?: string; mm?: string; size?: string; color?: string; clarity?: string };
  images?: string[];
}
export interface ClientLike {
  id: string; companyName: string; ownerName?: string; email?: string; country?: string;
  accountManagerId?: string; companyId?: string; status?: string; createdAt?: string;
}
export interface FactoryLike { id: string; name: string; email?: string; contactPerson?: string; active?: boolean }
export interface PersonLike { id: string; name: string; email?: string; role?: string; department?: string; status?: string; authUid?: string }

/** Everything one run can see. */
export interface Ctx {
  now: string;
  order?: OrderLike;
  client?: ClientLike;
  factory?: FactoryLike;
  /** Who looks after it: the order's salesperson, else the client's handler. */
  handler?: PersonLike;
  /** time.schedule with forEach: who this run is for. */
  each?: { kind: "factory" | "salesperson" | "client" | "admin"; id: string; name: string; email?: string };
  stock?: { material: string; bucket: string; qty: number; unit: string; label: string };
  /** Orders for a list block / a scheduled run. */
  list?: OrderLike[];
  /** client.balanceOver: what they owe now. */
  clientBalance?: number;
  /** invoice.raised: the bill. */
  invoice?: { number: string; amount?: number };
  brandName: string;
  /** False while the order was saved moments ago (someone may still be saving it): approve and assign wait. */
  orderSettled?: boolean;
  /** Labels a pipeline has put on this order already (pipelineMarks). */
  labels?: string[];
}

/* ════════════════════════════ Money and stages (as the app counts them) ════════════════════════════ */

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Mirrors orderTotal() in lib/db.ts: value + shipping + certificate + named charges − gift card − returns. */
export function orderTotalOf(o: OrderLike): number {
  const gross = (o.amount || 0) + (o.shippingCharge || 0) + (o.certificateFee || 0)
    + (o.otherCharges || []).reduce((s, c) => s + (Number(c.amountUsd) || 0), 0);
  const returned = (o.returns || []).reduce((s, r) => s + (r.creditUsd || 0), 0);
  return Math.max(0, r2(gross - (o.giftCardRedeemed || 0) - returned));
}
export const paidOf = (o: OrderLike) => (o.advances || []).reduce((s, a) => s + (a.amount || 0), 0);
export const balanceOf = (o: OrderLike) => Math.max(0, r2(orderTotalOf(o) - paidOf(o)));

const done = (o: OrderLike, step: string) => (o.timeline || []).some(t => t.step === step && t.status === "done");
/** Mirrors orderIsDispatched() in lib/db.ts. */
export const isDispatched = (o: OrderLike) => o.status === "Dispatched" || o.status === "Delivered" || done(o, "Dispatch");
export const isDelivered = (o: OrderLike) => o.status === "Delivered" || done(o, "Delivered");
export const isClosed = (o: OrderLike) => o.status === "Rejected" || !!o.deletedAt;
/** The stage it is at: the first not done. */
export function currentStage(o: OrderLike): string {
  const t = (o.timeline || []).find(s => s.status !== "done");
  return t?.step ?? "Finished";
}
/** When it reached its current stage: the date the step before it was done (or it was placed). */
export function stageSince(o: OrderLike): string | undefined {
  const tl = o.timeline || [];
  const i = tl.findIndex(s => s.status !== "done");
  if (i < 0) return undefined;
  for (let j = i - 1; j >= 0; j--) if (tl[j].date) return tl[j].date;
  return o.createdAt;
}
export const isLooseOrder = (o: OrderLike) => o.metal === "None (Diamond only)";
export const orderKind = (o: OrderLike): "piece" | "loose" | "readyStock" =>
  o.materialSourcing === "readyStock" && !o.forReadyStock ? "readyStock" : isLooseOrder(o) ? "loose" : "piece";

const DAY = 864e5;
export const daysBetween = (a: string, b: string) => (+new Date(b) - +new Date(a)) / DAY;

/* ════════════════════════════ What changed on an order ════════════════════════════ */

/** One thing that happened to an order — with a key, so the same event never starts two runs. */
export interface OrderEvent { kind: TriggerKind; stage?: string; key: string }

/**
 * The events in one save of an order: before (null when just placed) → after.
 * Only real changes count: re-saving an approved order is not a new approval.
 */
export function orderEvents(before: OrderLike | null, after: OrderLike | null): OrderEvent[] {
  if (!after) return [];
  const out: OrderEvent[] = [];
  const add = (kind: TriggerKind, key: string, stage?: string) => out.push({ kind, key, ...(stage ? { stage } : {}) });
  // Each key carries when it happened, so an order approved again after being
  // re-opened is news again — while the same save seen twice is still one event.
  const when = (t: TimelineStepLike) => t.date ?? "";
  // A stage the app fills in on an old order when it loads it is not news.
  const real = (t: TimelineStepLike) => t.status === "done" && t.remarks !== "Backfilled";
  if (!before) {
    add("order.placed", "placed");
    // A sale straight from stock can arrive already past some stages.
    for (const t of after.timeline || []) if (real(t) && t.step !== "Order Submitted") add("order.stageDone", `done:${t.step}:${when(t)}`, t.step);
    return out;
  }
  const wasDone = new Set((before.timeline || []).filter(t => t.status === "done").map(t => t.step));
  for (const t of after.timeline || []) {
    if (real(t) && !wasDone.has(t.step)) {
      add("order.stageDone", `done:${t.step}:${when(t)}`, t.step);
      if (t.step === "Order Approved") add("order.approved", `approved:${when(t)}`);
      if (t.step === "Final Approval") add("order.finalApproval", `finalApproval:${when(t)}`);
    }
  }
  // Reaching a stage: it became the current one.
  const cb = currentStage(before), ca = currentStage(after);
  if (ca !== cb && ca !== "Finished") add("order.stageReached", `reached:${ca}:${stageSince(after) ?? ""}`, ca);
  if (after.assignedFactoryId && before.assignedFactoryId !== after.assignedFactoryId) add("order.factoryAssigned", `factory:${after.assignedFactoryId}`);
  const ib = before.materialIssuanceIds || [], ia = after.materialIssuanceIds || [];
  if (ia.length > ib.length) add("order.materialIssued", `issued:${ia[ia.length - 1]}`);
  if (!isDispatched(before) && isDispatched(after)) add("order.dispatched", `dispatched:${after.dispatchedAt ?? ""}`);
  if (!isDelivered(before) && isDelivered(after)) add("order.delivered", `delivered:${after.deliveredAt ?? ""}`);
  if (before.status !== "Rejected" && after.status === "Rejected") add("order.cancelled", "cancelled");
  const pb = (before.advances || []).length, pa = (after.advances || []).length;
  if (pa > pb) add("order.paymentReceived", `paid:${pa}:${after.advances![pa - 1]?.createdAt ?? ""}`);
  return out;
}

/** Whether an event starts this trigger. */
export function eventMatches(t: Trigger, e: OrderEvent): boolean {
  if (t.kind !== e.kind) return false;
  if ((t.kind === "order.stageReached" || t.kind === "order.stageDone") && t.stage) return t.stage === e.stage;
  return true;
}

/* ════════════════════════════ Fields a condition can test ════════════════════════════ */

export type FieldKey =
  | "client" | "company" | "kind" | "jewelleryType" | "metal" | "karats" | "value" | "balance" | "paid"
  | "factory" | "handler" | "priority" | "certificate" | "country" | "stage" | "status"
  | "dispatched" | "delivered" | "fullyPaid" | "clientHasEmail" | "factoryHasEmail" | "handlerHasEmail"
  | "daysToDue" | "daysInStage" | "daysSinceDispatch" | "label" | "quantity" | "stone";

export interface FieldDef { key: FieldKey; label: string; type: "text" | "number" | "yesno" | "pick"; pick?: "client" | "company" | "factory" | "person" | "stage" | "kind" | "priority" | "status" | "jewelleryType" | "metal" }

/** The fields, in the words the builder shows. */
export const FIELDS: FieldDef[] = [
  { key: "client", label: "Client", type: "pick", pick: "client" },
  { key: "company", label: "Our company", type: "pick", pick: "company" },
  { key: "kind", label: "Kind of order", type: "pick", pick: "kind" },
  { key: "jewelleryType", label: "Jewellery type", type: "pick", pick: "jewelleryType" },
  { key: "metal", label: "Metal", type: "pick", pick: "metal" },
  { key: "karats", label: "Karat", type: "text" },
  { key: "stone", label: "Stone (loose orders)", type: "text" },
  { key: "quantity", label: "Pieces", type: "number" },
  { key: "value", label: "Order value ($)", type: "number" },
  { key: "paid", label: "Paid so far ($)", type: "number" },
  { key: "balance", label: "Still to pay ($)", type: "number" },
  { key: "fullyPaid", label: "Fully paid", type: "yesno" },
  { key: "factory", label: "Factory", type: "pick", pick: "factory" },
  { key: "handler", label: "Handled by", type: "pick", pick: "person" },
  { key: "priority", label: "Priority", type: "pick", pick: "priority" },
  { key: "certificate", label: "Needs a certificate", type: "yesno" },
  { key: "country", label: "Client's country", type: "text" },
  { key: "stage", label: "Stage it is at", type: "pick", pick: "stage" },
  { key: "status", label: "Status", type: "pick", pick: "status" },
  { key: "dispatched", label: "Dispatched", type: "yesno" },
  { key: "delivered", label: "Delivered", type: "yesno" },
  { key: "daysToDue", label: "Days to the due date", type: "number" },
  { key: "daysInStage", label: "Days in its stage", type: "number" },
  { key: "daysSinceDispatch", label: "Days since dispatch", type: "number" },
  { key: "clientHasEmail", label: "Client has an email", type: "yesno" },
  { key: "factoryHasEmail", label: "Factory has an email", type: "yesno" },
  { key: "handlerHasEmail", label: "Handler has an email", type: "yesno" },
  { key: "label", label: "Has the label", type: "text" },
];
export const fieldDef = (k: FieldKey) => FIELDS.find(f => f.key === k);

/** A field's value for this run (undefined: not known here, e.g. an order field on a stock run). */
export function fieldValue(k: FieldKey, c: Ctx): string | number | boolean | undefined {
  const o = c.order;
  switch (k) {
    case "client": return o?.clientId ?? c.client?.id;
    case "company": return o?.companyId ?? c.client?.companyId ?? "main";
    case "country": return c.client?.country;
    case "clientHasEmail": return !!c.client?.email;
    case "factoryHasEmail": return !!c.factory?.email;
    case "handlerHasEmail": return !!c.handler?.email;
    case "handler": return c.handler?.id;
    case "label": return (c.labels || []).join("\n");
  }
  if (!o) return undefined;
  switch (k) {
    case "kind": return orderKind(o);
    case "jewelleryType": return o.jewelleryType;
    case "metal": return o.metal;
    case "karats": return o.productKarats;
    case "stone": return o.stoneSpec?.stone || (isLooseOrder(o) ? "Diamond" : undefined);
    case "quantity": return o.quantity || 1;
    case "value": return orderTotalOf(o);
    case "paid": return r2(paidOf(o));
    case "balance": return balanceOf(o);
    case "fullyPaid": return balanceOf(o) <= 0 && orderTotalOf(o) > 0;
    case "factory": return o.assignedFactoryId;
    case "priority": return o.priority || "Normal";
    case "certificate": return !!o.certificate;
    case "stage": return currentStage(o);
    case "status": return o.status;
    case "dispatched": return isDispatched(o);
    case "delivered": return isDelivered(o);
    case "daysToDue": return o.expectedDelivery ? Math.floor(daysBetween(c.now, `${o.expectedDelivery.slice(0, 10)}T23:59:59`)) : undefined;
    case "daysInStage": { const s = stageSince(o); return s ? Math.floor(daysBetween(s, c.now)) : undefined; }
    case "daysSinceDispatch": return o.dispatchedAt ? Math.floor(daysBetween(o.dispatchedAt, c.now)) : undefined;
  }
  return undefined;
}

/** Whether one condition holds. A field that can't be known here never matches (except "is empty"). */
export function holds(cond: Condition, c: Ctx): boolean {
  const v = fieldValue(cond.field, c);
  const want = cond.value;
  const s = (x: unknown) => String(x ?? "").trim().toLowerCase();
  switch (cond.op) {
    case "yes": return v === true;
    case "no": return v === false;
    case "isSet": return v !== undefined && v !== "" && v !== false;
    case "isEmpty": return v === undefined || v === "" || v === false;
  }
  if (v === undefined) return false;
  switch (cond.op) {
    case "is": return cond.field === "label" ? s(v).split("\n").includes(s(want)) : s(v) === s(want);
    case "isNot": return cond.field === "label" ? !s(v).split("\n").includes(s(want)) : s(v) !== s(want);
    case "contains": return s(v).includes(s(want));
    case "gt": return Number(v) > Number(want);
    case "lt": return Number(v) < Number(want);
  }
  return false;
}
export const allHold = (all: Condition[], c: Ctx) => all.every(x => holds(x, c));

/* ════════════════════════════ Words with {placeholders} ════════════════════════════ */

export interface Placeholder { key: string; label: string }
/** The words a message can carry, filled in for each run. */
export const PLACEHOLDERS: Placeholder[] = [
  { key: "order", label: "Order number" }, { key: "client", label: "Client" }, { key: "clientOwner", label: "Client's contact" },
  { key: "piece", label: "The piece" }, { key: "design", label: "Design number" }, { key: "stage", label: "Stage" },
  { key: "daysInStage", label: "Days in stage" }, { key: "due", label: "Due date" }, { key: "value", label: "Order value" },
  { key: "paid", label: "Paid" }, { key: "balance", label: "Still to pay" }, { key: "factory", label: "Factory" },
  { key: "handler", label: "Handled by" }, { key: "courier", label: "Courier" }, { key: "tracking", label: "Tracking number" },
  { key: "name", label: "Who it's for" }, { key: "count", label: "How many in the list" },
  { key: "stock", label: "Stock item" }, { key: "stockLeft", label: "Stock left" },
  { key: "company", label: "Our company" }, { key: "today", label: "Today's date" },
  { key: "invoice", label: "Invoice number" },
];

export const fmtUsd = (n: number) => `$${(Math.round(n * 100) / 100).toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
export function fmtDay(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso.length === 10 ? `${iso}T12:00:00` : iso);
  return isNaN(+d) ? iso : d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" });
}
export function pieceText(o: OrderLike): string {
  if (isLooseOrder(o)) {
    const s = o.stoneSpec ?? {};
    const stone = s.stone || "Diamond";
    return [o.diamondWeight ? `${o.diamondWeight} ct` : "", stone === "Diamond" ? (o.diamondType ? `${o.diamondType} diamonds` : "Loose diamonds") : stone, [s.shape, s.mm || s.size].filter(Boolean).join(" ")].filter(Boolean).join(" · ");
  }
  return [o.jewelleryType, [o.productKarats, o.metal].filter(Boolean).join(" ")].filter(Boolean).join(" · ");
}

/** A placeholder's value for this run ("" when not known here). */
export function placeholderValue(key: string, c: Ctx): string {
  const o = c.order;
  switch (key) {
    case "client": return c.client?.companyName ?? "";
    case "clientOwner": return c.client?.ownerName || c.client?.companyName || "";
    case "factory": return c.factory?.name ?? "";
    case "handler": return c.handler?.name ?? "";
    case "name": return c.each?.name ?? c.client?.ownerName ?? c.client?.companyName ?? "";
    case "count": return String((c.list || []).length);
    case "stock": return c.stock?.label ?? "";
    case "stockLeft": return c.stock ? `${r2(c.stock.qty)} ${c.stock.unit}` : "";
    case "company": return c.brandName;
    case "today": return fmtDay(c.now);
    case "invoice": return c.invoice?.number ?? "";
  }
  if (!o) return "";
  switch (key) {
    case "order": return o.orderNumber;
    case "piece": return pieceText(o);
    case "design": return o.designNumber ?? "";
    case "stage": return currentStage(o);
    case "daysInStage": { const v = fieldValue("daysInStage", c); return v == null ? "" : String(v); }
    case "due": return fmtDay(o.expectedDelivery);
    case "value": return fmtUsd(orderTotalOf(o));
    case "paid": return fmtUsd(paidOf(o));
    case "balance": return fmtUsd(balanceOf(o));
    case "courier": return o.courierName ?? "";
    case "tracking": return o.trackingNumber ?? "";
  }
  return "";
}

/** Fill in "{order}" and friends. An unknown word is left as typed, so a typo shows rather than vanishing. */
export function fill(text: string, c: Ctx): string {
  return (text || "").replace(/\{(\w+)\}/g, (m, k: string) => (PLACEHOLDERS.some(p => p.key === k) ? placeholderValue(k, c) : m));
}

/* ════════════════════════════ A run: where it is, and what to do next ════════════════════════════ */

/**
 * Where a run is: a path of step positions through the pipeline's steps and its
 * branches — ["2"] is the third step; ["3", "yes", "0"] the first step on the
 * "yes" way of the fourth; a switch's ways are "c0", "c1" … and "other".
 */
export type Cursor = string[];

export type RunStatus = "running" | "waiting" | "asking" | "done" | "stopped" | "failed";

export interface TrailEntry { stepId: string; at: string; outcome: "done" | "skipped" | "waiting" | "asked" | "answered" | "failed" | "stopped" | "took"; note?: string }

export interface Run {
  id: string;
  pipelineId: string;
  version: number;
  /** What the run is about. */
  subject: { kind: "order" | "client" | "stock" | "each" | "none"; id?: string; label?: string };
  /** Never two runs for the same key (pipeline + subject + the event). */
  key: string;
  status: RunStatus;
  cursor: Cursor;
  /** waiting: when to look again. */
  wakeAt?: string;
  /** waitUntil / ask: when it gives up and takes the "no" way. */
  giveUpAt?: string;
  startedAt: string;
  updatedAt: string;
  trail: TrailEntry[];
  /** Why it stopped / failed, in words. */
  reason?: string;
  /** Approve / assign asked for, not yet seen on the order: the run waits for it (until then). */
  pending?: { stepId: string; until: string };
  /** Set on a test run: nothing it does reaches anyone but the tester. */
  test?: boolean;
}

/** Something the server must do for a run — the only things a pipeline can do. */
export type Effect =
  | { type: "email"; stepId: string; to: Recipient[]; subject: string; text: string; blocks: EmailBlock[]; list?: ListSpec; send: "now" | "digest" }
  | { type: "popup"; stepId: string; to: Recipient[]; title: string; text: string; showAt: string }
  | { type: "alert"; stepId: string; to: Recipient[]; text: string }
  | { type: "task"; stepId: string; to: Recipient; title: string; dueAt: string }
  | { type: "label"; stepId: string; label: string }
  | { type: "ask"; stepId: string; to: Recipient; question: string; giveUpAt: string }
  | { type: "approve"; stepId: string }
  | { type: "assign"; stepId: string; who: "clientHandler" | "person"; userId?: string };

/** The steps a cursor points into, and the position there. */
function locate(steps: Step[], cursor: Cursor): { list: Step[]; index: number } | null {
  let list = steps;
  for (let i = 0; i < cursor.length - 1; i += 2) {
    const s = list[Number(cursor[i])];
    const way = cursor[i + 1];
    if (!s) return null;
    const next = wayOf(s, way);
    if (!next) return null;
    list = next;
  }
  return { list, index: Number(cursor[cursor.length - 1]) };
}

/** A branching step's way, by name. */
export function wayOf(s: Step, way: string): Step[] | null {
  if (s.kind === "split" || s.kind === "waitUntil" || s.kind === "ask") return way === "yes" ? s.yes : way === "no" ? s.no : null;
  if (s.kind === "switch") {
    if (way === "other") return s.other;
    const m = /^c(\d+)$/.exec(way);
    return m ? s.cases[Number(m[1])]?.steps ?? null : null;
  }
  return null;
}

/** The step a cursor points at (null past the end). */
export function stepAt(steps: Step[], cursor: Cursor): Step | null {
  const l = locate(steps, cursor);
  return l ? l.list[l.index] ?? null : null;
}

/** The cursor after this step: the next one in its list, or — at the end of a branch — the step after the branch. */
export function nextCursor(steps: Step[], cursor: Cursor): Cursor | null {
  const c = [...cursor];
  for (;;) {
    const l = locate(steps, c);
    if (!l) return null;
    if (l.index + 1 < l.list.length) { c[c.length - 1] = String(l.index + 1); return c; }
    // End of this list: climb out of the branch to the step after it.
    if (c.length < 3) return null; // the end of the pipeline
    c.splice(c.length - 2, 2); // drop [way, index] → cursor at the branching step
  }
}

const addTime = (iso: string, ms: number) => new Date(+new Date(iso) + ms).toISOString();
const waitMs = (s: { amount: number; unit: "minutes" | "hours" | "days" }) =>
  Math.max(1, s.amount) * (s.unit === "minutes" ? 6e4 : s.unit === "hours" ? 36e5 : DAY);

/** The most steps one move may take — a guard; a pipeline is far shorter. */
const MAX_STEPS_PER_MOVE = 200;

/**
 * Move a run as far as it can go now: do each step, and stop at a wait, a
 * question, or the end. Pure — it says what to do (effects) and where the run
 * is now; the server does the effects and saves the run.
 *
 * `answer`: an ask step's reply ("yes" / "no"), when resuming after one.
 */
export function advance(p: Pipeline, run: Run, c: Ctx, answer?: "yes" | "no"): { run: Run; effects: Effect[] } {
  const r: Run = { ...run, trail: [...run.trail], cursor: [...run.cursor] };
  const effects: Effect[] = [];
  const at = c.now;
  const log = (stepId: string, outcome: TrailEntry["outcome"], note?: string) => r.trail.push({ stepId, at, outcome, ...(note ? { note } : {}) });
  const finish = (status: RunStatus, reason?: string) => { r.status = status; r.reason = reason; delete r.wakeAt; delete r.giveUpAt; delete r.pending; };
  r.updatedAt = at;

  // A closed order ends its run, whatever step it is at — except the run that
  // the cancelling (or the delivery) itself started: telling the factory is its job.
  if (c.order && isClosed(c.order) && !(p.trigger.kind === "order.cancelled" && !c.order.deletedAt)) { finish("stopped", c.order.deletedAt ? "The order was deleted" : "The order was cancelled"); return { run: r, effects }; }
  if (c.order && p.stopWhenDelivered && isDelivered(c.order) && p.trigger.kind !== "order.delivered") { finish("stopped", "The order was delivered"); return { run: r, effects }; }

  const go = (cur: Cursor | null) => {
    if (!cur) { finish("done"); return false; }
    r.cursor = cur; return true;
  };

  for (let guard = 0; guard < MAX_STEPS_PER_MOVE; guard++) {
    const s = stepAt(p.steps, r.cursor);
    if (!s) { finish("done"); break; }
    switch (s.kind) {
      case "email":
        effects.push({ type: "email", stepId: s.id, to: s.to, subject: fill(s.subject, c), text: fill(s.text, c), blocks: s.blocks ?? [], list: s.list, send: s.send ?? "now" });
        log(s.id, "done"); if (!go(nextCursor(p.steps, r.cursor))) return { run: r, effects }; continue;
      case "popup":
        effects.push({ type: "popup", stepId: s.id, to: s.to, title: fill(s.title, c), text: fill(s.text, c), showAt: addTime(at, (s.delayMinutes ?? 0) * 6e4) });
        log(s.id, "done"); if (!go(nextCursor(p.steps, r.cursor))) return { run: r, effects }; continue;
      case "alert":
        effects.push({ type: "alert", stepId: s.id, to: s.to, text: fill(s.text, c) });
        log(s.id, "done"); if (!go(nextCursor(p.steps, r.cursor))) return { run: r, effects }; continue;
      case "task":
        effects.push({ type: "task", stepId: s.id, to: s.to, title: fill(s.title, c), dueAt: addTime(at, Math.max(0, s.dueDays) * DAY) });
        log(s.id, "done"); if (!go(nextCursor(p.steps, r.cursor))) return { run: r, effects }; continue;
      case "label":
        effects.push({ type: "label", stepId: s.id, label: s.label });
        log(s.id, "done"); if (!go(nextCursor(p.steps, r.cursor))) return { run: r, effects }; continue;
      case "approve":
      case "assign": {
        // On the order now — whoever did it.
        const shows = s.kind === "approve" ? !!c.order && c.order.status !== "Waiting" : !!c.order?.assignedEmployeeId;
        // Asked for already: go on only once the order really shows it, so the
        // "approved" email never goes for an approval that did not happen.
        if (r.pending?.stepId === s.id) {
          if (shows) { delete r.pending; delete r.wakeAt; r.status = "running"; log(s.id, "done"); if (!go(nextCursor(p.steps, r.cursor))) return { run: r, effects }; continue; }
          if (+new Date(r.pending.until) <= +new Date(at)) {
            delete r.pending; log(s.id, "stopped", s.kind === "approve" ? "It was not approved" : "It was not assigned");
            finish("stopped", s.kind === "approve" ? "The order could not be approved — nothing after it was done" : "The order could not be assigned — nothing after it was done");
            return { run: r, effects };
          }
          r.status = "waiting"; r.wakeAt = addTime(at, 10 * 6e4);
          return { run: r, effects };
        }
        // A screen saves an order whole, from its own copy: changing it while
        // someone is still saving it could be undone by their next save. So
        // wait until nobody has saved it for a while, then act — and only then
        // go on (the "approved" email after it goes once it is really approved).
        if (c.order && c.orderSettled === false) {
          if (r.status !== "waiting") log(s.id, "waiting", "until nobody is saving the order");
          r.status = "waiting"; r.wakeAt = addTime(at, 3 * 6e4);
          return { run: r, effects };
        }
        if (r.status === "waiting") { r.status = "running"; delete r.wakeAt; }
        const can = s.kind === "approve" ? c.order?.status === "Waiting" : !!c.order && !c.order.assignedEmployeeId;
        if (!can) {
          log(s.id, "skipped", s.kind === "approve" ? "It was not waiting for approval" : "Someone already has it");
          if (!go(nextCursor(p.steps, r.cursor))) return { run: r, effects }; continue;
        }
        effects.push(s.kind === "approve" ? { type: "approve", stepId: s.id } : { type: "assign", stepId: s.id, who: s.who, userId: s.userId });
        r.pending = { stepId: s.id, until: addTime(at, 2 * 36e5) };
        r.status = "waiting"; r.wakeAt = addTime(at, 5 * 6e4);
        log(s.id, "waiting", s.kind === "approve" ? "approving" : "assigning");
        return { run: r, effects };
      }
      case "wait": {
        // Arriving: set the alarm. Woken (its time has come): move on.
        if (r.status === "waiting" && r.wakeAt && +new Date(r.wakeAt) <= +new Date(at)) {
          delete r.wakeAt; r.status = "running"; log(s.id, "done");
          if (!go(nextCursor(p.steps, r.cursor))) return { run: r, effects }; continue;
        }
        if (r.status !== "waiting") { r.status = "waiting"; r.wakeAt = addTime(at, waitMs(s)); log(s.id, "waiting", `until ${r.wakeAt}`); }
        return { run: r, effects };
      }
      case "check":
        if (allHold(s.all, c)) { log(s.id, "done"); if (!go(nextCursor(p.steps, r.cursor))) return { run: r, effects }; continue; }
        log(s.id, "stopped", "The check did not hold"); finish("done", "Stopped at a check — it did not hold"); return { run: r, effects };
      case "split": {
        const way = allHold(s.all, c) ? "yes" : "no";
        log(s.id, "took", way);
        const branch = s[way];
        if (branch.length) { r.cursor = [...r.cursor, way, "0"]; continue; }
        if (!go(nextCursor(p.steps, r.cursor))) return { run: r, effects }; continue;
      }
      case "switch": {
        const v = String(fieldValue(s.field, c) ?? "").trim().toLowerCase();
        const i = s.cases.findIndex(k => k.value.trim().toLowerCase() === v);
        const way = i >= 0 ? `c${i}` : "other";
        log(s.id, "took", i >= 0 ? s.cases[i].value : "other");
        const branch = wayOf(s, way)!;
        if (branch.length) { r.cursor = [...r.cursor, way, "0"]; continue; }
        if (!go(nextCursor(p.steps, r.cursor))) return { run: r, effects }; continue;
      }
      case "waitUntil": {
        const happened = allHold(s.all, c);
        const gaveUp = !happened && r.giveUpAt && +new Date(r.giveUpAt) <= +new Date(at);
        if (happened || gaveUp) {
          const way = happened ? "yes" : "no";
          delete r.giveUpAt; delete r.wakeAt; r.status = "running"; log(s.id, "took", happened ? "it happened" : "time ran out");
          if (s[way].length) { r.cursor = [...r.cursor, way, "0"]; continue; }
          if (!go(nextCursor(p.steps, r.cursor))) return { run: r, effects }; continue;
        }
        if (r.status !== "waiting") { r.giveUpAt = addTime(at, Math.max(0, s.maxDays) * DAY); log(s.id, "waiting", `until it happens, at most ${s.maxDays} days`); }
        r.status = "waiting";
        // Looked at again on every change of the order, and at least hourly.
        r.wakeAt = addTime(at, 36e5);
        return { run: r, effects };
      }
      case "ask": {
        if (r.status === "asking") {
          const gaveUp = !answer && r.giveUpAt && +new Date(r.giveUpAt) <= +new Date(at);
          if (!answer && !gaveUp) return { run: r, effects };
          const way = answer ?? "no";
          delete r.giveUpAt; delete r.wakeAt; r.status = "running"; log(s.id, "answered", answer ? `answered ${answer}` : "no answer in time");
          if (s[way].length) { r.cursor = [...r.cursor, way, "0"]; continue; }
          if (!go(nextCursor(p.steps, r.cursor))) return { run: r, effects }; continue;
        }
        const giveUpAt = addTime(at, Math.max(0, s.maxDays) * DAY);
        effects.push({ type: "ask", stepId: s.id, to: s.to, question: fill(s.question, c), giveUpAt });
        r.status = "asking"; r.giveUpAt = giveUpAt; r.wakeAt = giveUpAt; log(s.id, "asked");
        return { run: r, effects };
      }
    }
  }
  if (r.status === "running") finish("failed", "The pipeline went round too many times — check its steps");
  return { run: r, effects };
}

/* ════════════════════════════ Is it safe to switch on? ════════════════════════════ */

export interface Problem { stepId?: string; text: string }

/** Runs about one order: its events and checks — and a bill, which is raised for one. */
const triggerForOrders = (k: TriggerKind) => k.startsWith("order.") || k === "invoice.raised";
const NEEDS_ORDER_FIELDS: FieldKey[] = ["kind", "jewelleryType", "metal", "karats", "stone", "quantity", "value", "paid", "balance", "fullyPaid", "factory", "priority", "certificate", "stage", "status", "dispatched", "delivered", "daysToDue", "daysInStage", "daysSinceDispatch"];

/** Every step, with the branch it is on — for counting and checking. */
export function eachStep(steps: Step[], fn: (s: Step, depth: number) => void, depth = 0): void {
  for (const s of steps) {
    fn(s, depth);
    if (s.kind === "split" || s.kind === "waitUntil" || s.kind === "ask") { eachStep(s.yes, fn, depth + 1); eachStep(s.no, fn, depth + 1); }
    if (s.kind === "switch") { for (const k of s.cases) eachStep(k.steps, fn, depth + 1); eachStep(s.other, fn, depth + 1); }
  }
}

/** The health check: what must be put right before this pipeline can be switched on. Empty = ready. */
export function checkPipeline(p: Pipeline): Problem[] {
  const out: Problem[] = [];
  const t = p.trigger;
  if (!p.name.trim()) out.push({ text: "Give it a name" });
  if ((t.kind === "order.stageReached" || t.kind === "order.stageDone" || t.kind === "order.stuck") && !t.stage) out.push({ text: "Choose the stage it starts at" });
  if (["order.stuck", "order.dueSoon", "order.overdue", "order.unpaidAfterDispatch", "client.idle"].includes(t.kind) && !(Number(t.days) > 0)) out.push({ text: "Say after how many days" });
  if (t.kind === "client.balanceOver" && !(Number(t.amount) > 0)) out.push({ text: "Say the amount" });
  if (t.kind === "stock.low" && (!t.material || !(Number(t.below) > 0))) out.push({ text: "Choose the stock and the level" });
  if (t.kind === "time.schedule" && !/^\d{2}:\d{2}$/.test(t.at ?? "")) out.push({ text: "Choose the time it runs" });
  if (!p.steps.length) out.push({ text: "Add at least one step" });
  let doesSomething = false;
  const orderRun = triggerForOrders(t.kind);
  const each = t.kind === "time.schedule" && t.forEach && t.forEach !== "none";
  eachStep(p.steps, (s, depth) => {
    if (depth > 6) out.push({ stepId: s.id, text: "Too many branches inside one another (at most 6)" });
    const recips = s.kind === "email" || s.kind === "popup" || s.kind === "alert" ? s.to : s.kind === "task" || s.kind === "ask" ? [s.to] : [];
    if ((s.kind === "email" || s.kind === "popup" || s.kind === "alert") && !s.to.length) out.push({ stepId: s.id, text: "Choose who it goes to" });
    for (const r of recips) {
      if ((r.kind === "client" || r.kind === "factory") && !orderRun && !(r.kind === "client" && t.kind.startsWith("client."))) out.push({ stepId: s.id, text: `"The ${r.kind}" only works when the pipeline starts from an order` });
      if (r.kind === "each" && !each) out.push({ stepId: s.id, text: `"The one it's for" only works on a schedule that runs for each factory, salesperson, client or admin` });
      if (r.kind === "address" && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(r.email)) out.push({ stepId: s.id, text: `"${r.email}" is not an email address` });
      if (r.kind === "person" && !r.userId) out.push({ stepId: s.id, text: "Choose the person" });
      if (r.kind === "department" && !r.name.trim()) out.push({ stepId: s.id, text: "Choose the department" });
      if ((s.kind === "popup" || s.kind === "alert" || s.kind === "task" || s.kind === "ask") && (r.kind === "client" || r.kind === "factory" || r.kind === "address"))
        out.push({ stepId: s.id, text: "Popups, alerts, tasks and questions go to our own people — not to a client, a factory or an address" });
    }
    if (s.kind === "email") { doesSomething = true; if (!s.subject.trim()) out.push({ stepId: s.id, text: "The email needs a subject" }); if (!s.text.trim() && !(s.blocks ?? []).length) out.push({ stepId: s.id, text: "The email needs some words" }); }
    if (s.kind === "popup" || s.kind === "alert" || s.kind === "task" || s.kind === "label" || s.kind === "ask" || s.kind === "approve" || s.kind === "assign") doesSomething = true;
    if ((s.kind === "approve" || s.kind === "assign") && !orderRun) out.push({ stepId: s.id, text: s.kind === "approve" ? "Approving needs an order — this pipeline doesn't start from one" : "Assigning needs an order — this pipeline doesn't start from one" });
    if (s.kind === "assign" && s.who === "person" && !s.userId) out.push({ stepId: s.id, text: "Choose the salesperson" });
    if (s.kind === "popup" && !s.title.trim()) out.push({ stepId: s.id, text: "The popup needs a title" });
    if (s.kind === "task" && !s.title.trim()) out.push({ stepId: s.id, text: "The task needs a title" });
    if (s.kind === "label" && !s.label.trim()) out.push({ stepId: s.id, text: "Write the label" });
    if (s.kind === "ask" && !s.question.trim()) out.push({ stepId: s.id, text: "Write the question" });
    if (s.kind === "wait" && !(s.amount > 0)) out.push({ stepId: s.id, text: "Say how long to wait" });
    if (s.kind === "wait" && s.unit === "days" && s.amount > 365) out.push({ stepId: s.id, text: "Wait at most a year" });
    if ((s.kind === "waitUntil" || s.kind === "ask") && !(s.maxDays > 0)) out.push({ stepId: s.id, text: "Say the most days to wait" });
    if ((s.kind === "check" || s.kind === "split" || s.kind === "waitUntil") && !s.all.length) out.push({ stepId: s.id, text: "Add what to check" });
    if (s.kind === "switch" && !s.cases.length) out.push({ stepId: s.id, text: "Add at least one way" });
    const conds = s.kind === "check" || s.kind === "split" || s.kind === "waitUntil" ? s.all : [];
    for (const k of conds) if (!orderRun && NEEDS_ORDER_FIELDS.includes(k.field)) out.push({ stepId: s.id, text: `"${fieldDef(k.field)?.label}" only works when the pipeline starts from an order` });
    if (s.kind === "label" && !orderRun) out.push({ stepId: s.id, text: "A label goes on an order — this pipeline doesn't start from one" });
  });
  for (const k of p.only) if (!orderRun && NEEDS_ORDER_FIELDS.includes(k.field)) out.push({ text: `"${fieldDef(k.field)?.label}" only works when the pipeline starts from an order` });
  if (p.steps.length && !doesSomething) out.push({ text: "It never does anything — add an email, popup, alert, task, label or question" });
  return out;
}

/** A new id for a step. */
export const stepId = () => `s_${Math.random().toString(36).slice(2, 9)}`;

/* ════════════════════════════ The schedule ════════════════════════════ */

/** The business's own time: the date and "HH:MM" in India. */
export function localParts(iso: string): { date: string; hm: string; weekday: number; monthDay: number } {
  const d = new Date(+new Date(iso) + 5.5 * 36e5); // IST, no daylight saving
  const date = d.toISOString().slice(0, 10);
  return { date, hm: d.toISOString().slice(11, 16), weekday: d.getUTCDay(), monthDay: d.getUTCDate() };
}

/** Whether a scheduled pipeline is due between two checks (last → now), and the day it is for. */
export function scheduleDue(t: Trigger, lastIso: string, nowIso: string): string | null {
  if (t.kind !== "time.schedule" || !t.at) return null;
  const now = localParts(nowIso);
  const okDay = t.every === "day" ? true
    : t.every === "weekday" ? now.weekday >= 1 && now.weekday <= 6
    : t.every === "week" ? now.weekday === (t.weekday ?? 1)
    : t.every === "month" ? now.monthDay === (t.monthDay ?? 1) : false;
  if (!okDay) return null;
  // Due when its time has come today and the last check was before it.
  const last = localParts(lastIso);
  const passedNow = now.hm >= t.at;
  const passedBefore = last.date === now.date && last.hm >= t.at;
  return passedNow && !passedBefore ? now.date : null;
}

/** Quiet hours: an email due in them waits until they end. */
export function afterQuiet(iso: string, quiet: { from: string; to: string } | undefined): string {
  if (!quiet) return iso;
  const p = localParts(iso);
  const inQuiet = quiet.from > quiet.to ? p.hm >= quiet.from || p.hm < quiet.to : p.hm >= quiet.from && p.hm < quiet.to;
  if (!inQuiet) return iso;
  // To the end of the quiet hours, today or tomorrow (IST).
  const [h, m] = quiet.to.split(":").map(Number);
  const base = new Date(`${p.date}T00:00:00+05:30`);
  let end = +base + (h * 60 + m) * 6e4;
  if (end <= +new Date(iso)) end += DAY;
  return new Date(end).toISOString();
}

/* ════════════════════════════ The time it saves ════════════════════════════ */

/** Minutes a person would spend doing this step by hand — for the "time saved" figure. */
export const MINUTES_SAVED: Partial<Record<StepKind, number>> = { email: 4, popup: 1, alert: 1, task: 2, label: 1, ask: 2, approve: 2, assign: 1 };

/**
 * Approve a waiting order — the server's copy of the Approve button
 * (applyApprove in lib/stages.ts): status Approved, Submitted and Approved
 * done, the next stage under way. Returns false when it was not waiting.
 */
export function approveOrderTimeline(o: { status: string; timeline: TimelineStepLike[] }, at: string): boolean {
  if (o.status !== "Waiting") return false;
  o.status = "Approved";
  if (o.timeline[0]) { o.timeline[0].status = "done"; o.timeline[0].date = o.timeline[0].date ?? at; }
  if (o.timeline[1]) { o.timeline[1].status = "done"; o.timeline[1].date = at; }
  if (o.timeline[2] && o.timeline[2].status === "pending") o.timeline[2].status = "in_progress";
  return true;
}
