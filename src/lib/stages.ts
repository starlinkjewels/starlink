import {
  TIMELINE_STEPS, isDiamondOnlyOrder, isProductionStep, statusFromTimeline, uid, worksOnOrder,
  type DB, type Order, type Settings, type Worker,
} from "./db";

/**
 * The production timeline: which stages an order passes through, in what
 * order, and how an order is moved from one to the next on the board.
 *
 * Four stages carry work of their own and are never just ticked:
 *   Order Approved — the client is told, and emailed;
 *   Final Approval — the actual gold, diamonds and labour are recorded;
 *   Dispatch       — courier, tracking, the day it left, freight;
 *   Delivered      — closes the order and pays the client's cashback.
 * (An in-house stock build's last stage, Ready for Stock, creates its stock
 * item, so it too is finished on the order.)
 * The rest (CAD, production, certification and any stage the admin adds) are
 * marked done and nothing else.
 *
 * The admin may put the middle of the timeline in their own order and add
 * stages of their own. The ends stay where they are: approval opens every
 * order, and dispatch then delivery close it — the order's status, invoicing
 * and shipping are worked out from those positions. Final Approval stays after
 * the piece is designed and made, since it records what making it used.
 */

export const HEAD_STAGES = ["Order Submitted", "Order Approved"] as const;
export const TAIL_STAGES = ["Dispatch", "Delivered"] as const;
/** The built-in middle stages, in their default order. */
export const BUILTIN_MIDDLE = ["CAD Designing", "In Production", "Certification", "Final Approval"] as const;
/** The board's last column: every stage done. */
export const DONE_COLUMN = "Completed";

/** Names a custom stage may not take — each already means something. */
const RESERVED = new Set<string>([
  ...TIMELINE_STEPS, "Ready for Stock", "Order Confirmed", DONE_COLUMN,
].map(s => s.toLowerCase()));

export function isBuiltinStage(step: string): boolean {
  return (TIMELINE_STEPS as readonly string[]).includes(step);
}

/** Why this middle order can't be used — or null when it can. */
export function stageOrderProblem(middle: string[]): string | null {
  const seen = new Set<string>();
  for (const s of middle) {
    const name = s.trim();
    if (!name) return "A stage needs a name.";
    if (name.length > 40) return `"${name.slice(0, 20)}…" is too long — keep a stage name under 40 letters.`;
    const key = name.toLowerCase();
    if (seen.has(key)) return `"${name}" is in the list twice.`;
    seen.add(key);
    if ((HEAD_STAGES as readonly string[]).includes(name) || (TAIL_STAGES as readonly string[]).includes(name)) {
      return `"${name}" always sits at the start or end and can't be moved.`;
    }
    if (!isBuiltinStage(name) && RESERVED.has(key)) return `"${name}" is a name the app already uses — pick another.`;
  }
  for (const b of BUILTIN_MIDDLE) if (!middle.includes(b)) return `"${b}" can't be removed.`;
  const fa = middle.indexOf("Final Approval");
  if (middle.indexOf("CAD Designing") > fa || middle.indexOf("In Production") > fa) {
    return "Final Approval records what the piece used, so it has to come after CAD Designing and In Production.";
  }
  return null;
}

/** The middle stages as the admin has set them — the default if unset or unusable. */
export function middleStages(settings?: Pick<Settings, "timelineStages"> | null): string[] {
  const set = settings?.timelineStages;
  if (set && set.length && !stageOrderProblem(set)) return set.map(s => s.trim());
  return [...BUILTIN_MIDDLE];
}

/** Every stage of a standard order, start to finish, as configured. */
export function fullStageOrder(settings?: Pick<Settings, "timelineStages"> | null): string[] {
  return [...HEAD_STAGES, ...middleStages(settings), ...TAIL_STAGES];
}

/** A stage an order of this kind skips. */
function hiddenFor(o: Order, step: string): boolean {
  return isDiamondOnlyOrder(o) && isProductionStep(step);
}

/** Where the order is now: its first stage not yet done (timeline.length when all are). */
export function currentStageIndex(o: Order): number {
  const i = o.timeline.findIndex(t => t.status !== "done" && !hiddenFor(o, t.step));
  return i < 0 ? o.timeline.length : i;
}

/** The board column the order sits in: the stage being worked on now. */
export function boardColumnOf(o: Order): string {
  const i = currentStageIndex(o);
  return i >= o.timeline.length ? DONE_COLUMN : o.timeline[i].step;
}

/**
 * The board's columns: the configured stages, any older stage names still on
 * orders (each placed after the stage that comes before it on that order), and
 * Completed last.
 */
export function boardColumns(settings: Pick<Settings, "timelineStages"> | null | undefined, orders: Order[]): string[] {
  const cols = fullStageOrder(settings);
  for (const o of orders) {
    o.timeline.forEach((t, i) => {
      if (cols.includes(t.step) || hiddenFor(o, t.step)) return;
      const before = o.timeline.slice(0, i).reverse().find(x => cols.includes(x.step))?.step;
      const at = before ? cols.indexOf(before) + 1 : cols.indexOf("Dispatch");
      cols.splice(at < 0 ? cols.length : at, 0, t.step);
    });
  }
  return [...cols, DONE_COLUMN];
}

export type StageKind = "approve" | "finalApproval" | "dispatch" | "deliver" | "readyStock" | "plain";
export function stageKind(step: string): StageKind {
  if (step === "Order Approved") return "approve";
  if (step === "Final Approval") return "finalApproval";
  if (step === "Dispatch") return "dispatch";
  if (step === "Delivered") return "deliver";
  // Closing an in-house build creates its Ready Stock item — done on the order.
  if (step === "Ready for Stock") return "readyStock";
  return "plain";
}

export interface MovePlan {
  /** Nothing to do (dropped where it already was). */
  none?: boolean;
  /** Refused, with the reason to show. */
  blocked?: string;
  /** Approve the order on the way (it was waiting for approval). */
  approve?: boolean;
  /** Plain stages to mark done, by timeline index. */
  complete: number[];
  /** A stage with work of its own was reached — hand over to its own screen. */
  then?: "finalApproval" | "dispatch" | "deliver" | "readyStock";
  /** Moving back: every stage from this index on is opened again. */
  revertFrom?: number;
  /** For the confirmation: the stage names involved. */
  names: string[];
}

/** What dropping this order on that column would do — worked out before anything changes. */
export function planMove(o: Order, target: string): MovePlan {
  const plan: MovePlan = { complete: [], names: [] };
  if (o.status === "Rejected") return { ...plan, blocked: `${o.orderNumber} is rejected — re-open it first.` };
  const cur = currentStageIndex(o);
  const to = target === DONE_COLUMN ? o.timeline.length : o.timeline.findIndex(t => t.step === target);
  if (to < 0) return { ...plan, blocked: `${o.orderNumber} has no "${target}" stage.` };
  if (to === cur) return { ...plan, none: true };

  if (to > cur) {
    for (let i = cur; i < to; i++) {
      const step = o.timeline[i].step;
      if (o.timeline[i].status === "done" || hiddenFor(o, step)) continue;
      const kind = stageKind(step);
      if (kind === "approve") {
        if (o.status !== "Waiting") { plan.complete.push(i); plan.names.push(step); continue; }
        plan.approve = true; plan.names.push(step); continue;
      }
      if (kind === "plain") { plan.complete.push(i); plan.names.push(step); continue; }
      // Final Approval, Dispatch or Delivered: stop here and let its own screen finish it.
      plan.then = kind;
      plan.names.push(step);
      break;
    }
    return plan;
  }

  // Back: re-opening stages. Only plain ones — undoing an approval, a final
  // approval, a dispatch or a delivery unwinds records of its own, and that is
  // done on the order where those records are shown.
  if (to < HEAD_STAGES.length) return { ...plan, blocked: "An approved order can't be moved back to waiting from the board. Open the order to reject or re-open it." };
  for (let i = to; i < cur; i++) {
    const step = o.timeline[i].step;
    if (hiddenFor(o, step)) continue;
    if (stageKind(step) !== "plain") {
      return { ...plan, blocked: `${step} is already recorded on ${o.orderNumber}. Open the order to undo it — it carries details of its own.` };
    }
    plan.names.push(step);
  }
  return { ...plan, revertFrom: to };
}

/** Whether this person may move this order's stages — the same rule as the order screen. */
export function stagePermission(db: DB, user: Worker, o: Order, mayEditOrders: boolean): string | null {
  if (user.role === "admin") return null;
  if (user.role !== "employee") return "Only staff move orders.";
  if (!mayEditOrders) return "Your role does not let you change orders.";
  if (worksOnOrder(db, user, o)) return null;
  return "Not assigned to you — ask the admin or the account manager.";
}

/** Approve a waiting order — the board's twin of the order screen's Approve. */
export function applyApprove(d: DB, orderId: string, at: string): void {
  const o = d.orders.find(x => x.id === orderId);
  if (!o || o.status !== "Waiting") return;
  o.status = "Approved";
  if (o.timeline[0]) { o.timeline[0].status = "done"; o.timeline[0].date = o.timeline[0].date ?? at; }
  if (o.timeline[1]) { o.timeline[1].status = "done"; o.timeline[1].date = at; }
  if (o.timeline[2] && o.timeline[2].status === "pending") o.timeline[2].status = "in_progress";
  const clientUser = d.users.find(u => u.clientId === o.clientId);
  if (clientUser) d.notifications.unshift({
    id: uid("n_"), userId: clientUser.id, title: "Order Approved",
    body: `${o.orderNumber} has been approved and is now in production.`,
    type: "order", read: false, createdAt: at,
  });
}

/** Mark plain stages done — the board's twin of the order screen's "Mark complete". */
export function applyComplete(
  d: DB, orderId: string, indices: number[], by: { id: string; department?: string }, at: string,
): void {
  const o = d.orders.find(x => x.id === orderId);
  if (!o || !indices.length) return;
  const last = Math.max(...indices);
  // A diamond-only order's hidden production stages close along with it.
  if (isDiamondOnlyOrder(o)) {
    for (let i = 0; i < last; i++) {
      if (o.timeline[i].status !== "done" && isProductionStep(o.timeline[i].step)) {
        o.timeline[i] = { ...o.timeline[i], status: "done", date: at, remarks: "Not applicable — diamond only" };
      }
    }
  }
  for (const i of indices) {
    if (o.timeline[i].status === "done") continue;
    o.timeline[i] = { ...o.timeline[i], status: "done", date: at, employeeId: by.id, department: by.department, remarks: "Completed" };
  }
  if (last + 1 < o.timeline.length && o.timeline[last + 1].status === "pending") o.timeline[last + 1].status = "in_progress";
  o.status = statusFromTimeline(o.timeline, o.forReadyStock, o.materialSourcing === "readyStock");
  const clientUser = d.users.find(u => u.clientId === o.clientId);
  if (clientUser) d.notifications.unshift({
    id: uid("n_"), userId: clientUser.id, title: "Timeline updated",
    body: `${o.orderNumber}: ${o.timeline[last].step}`, type: "info", read: false, createdAt: at,
  });
}

/** Re-open stages from `from` on — the board's twin of the order screen's undo. */
export function applyRevert(d: DB, orderId: string, from: number): void {
  const o = d.orders.find(x => x.id === orderId);
  if (!o) return;
  for (let i = from; i < o.timeline.length; i++) {
    if (hiddenFor(o, o.timeline[i].step)) continue;
    o.timeline[i] = { ...o.timeline[i], status: "pending", date: undefined, employeeId: undefined, department: undefined, remarks: undefined };
  }
  o.timeline[from].status = "in_progress";
  o.status = statusFromTimeline(o.timeline, o.forReadyStock, o.materialSourcing === "readyStock");
}
