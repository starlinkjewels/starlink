// The builder's words: every trigger, step and recipient said the way a person
// would say it, and the choices each one offers. Nothing here runs a pipeline.
import type { LucideIcon } from "lucide-react";
import {
  AlarmClock, Bell, BadgeCheck, CalendarClock, CheckCircle2, CircleHelp, Clock, Filter, GitBranch, GitFork, Hourglass, ListTodo,
  Mail, Tag, UserCheck, Zap,
} from "lucide-react";
import type { Condition, FieldKey, Recipient, Step, StepKind, Trigger, TriggerKind } from "@/lib/pure/pipelines";
import { fieldDef, stepId } from "@/lib/pure/pipelines";

/* ── When ── */

export interface TriggerDef { kind: TriggerKind; group: string; label: string; needs?: ("stage" | "days" | "amount" | "stock" | "schedule")[] }
export const TRIGGERS: TriggerDef[] = [
  { kind: "order.placed", group: "An order", label: "is placed" },
  { kind: "order.approved", group: "An order", label: "is approved" },
  { kind: "order.stageReached", group: "An order", label: "reaches a stage", needs: ["stage"] },
  { kind: "order.stageDone", group: "An order", label: "finishes a stage", needs: ["stage"] },
  { kind: "order.factoryAssigned", group: "An order", label: "is given to a factory" },
  { kind: "order.materialIssued", group: "An order", label: "gets material issued" },
  { kind: "order.finalApproval", group: "An order", label: "passes Final Approval" },
  { kind: "order.dispatched", group: "An order", label: "is dispatched" },
  { kind: "order.delivered", group: "An order", label: "is delivered" },
  { kind: "order.cancelled", group: "An order", label: "is cancelled" },
  { kind: "order.paymentReceived", group: "An order", label: "gets a payment" },
  { kind: "order.stuck", group: "With time", label: "Order stuck in a stage", needs: ["stage", "days"] },
  { kind: "order.dueSoon", group: "With time", label: "Order due soon", needs: ["days"] },
  { kind: "order.overdue", group: "With time", label: "Order late", needs: ["days"] },
  { kind: "order.unpaidAfterDispatch", group: "With time", label: "Unpaid after dispatch", needs: ["days"] },
  { kind: "client.idle", group: "With time", label: "Client quiet for a while", needs: ["days"] },
  { kind: "client.balanceOver", group: "With time", label: "Client owes more than", needs: ["amount"] },
  { kind: "stock.low", group: "With time", label: "Stock runs low", needs: ["stock"] },
  { kind: "invoice.raised", group: "Other", label: "A bill is raised" },
  { kind: "client.created", group: "Other", label: "A new client is added" },
  { kind: "time.schedule", group: "Other", label: "On a schedule", needs: ["schedule"] },
];
export const triggerDef = (k: TriggerKind) => TRIGGERS.find(t => t.kind === k)!;

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
export { WEEKDAYS };
const hm12 = (hm?: string) => {
  if (!hm) return "";
  const [h, m] = hm.split(":").map(Number);
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${h < 12 ? "am" : "pm"}`;
};
const days = (n?: number) => `${n ?? 0} day${n === 1 ? "" : "s"}`;
const EACH: Record<string, string> = { factory: "each factory", salesperson: "each salesperson", client: "each client", admin: "each admin" };

/** "When an order reaches CAD Designing". */
export function triggerText(t: Trigger): string {
  switch (t.kind) {
    case "order.stageReached": return `An order reaches ${t.stage || "a stage"}`;
    case "order.stageDone": return `An order finishes ${t.stage || "a stage"}`;
    case "order.stuck": return `An order is in ${t.stage || "a stage"} for ${days(t.days)}`;
    case "order.dueSoon": return `${days(t.days)} before an order is due`;
    case "order.overdue": return `An order is ${days(t.days)} late`;
    case "order.unpaidAfterDispatch": return `Unpaid ${days(t.days)} after dispatch`;
    case "client.idle": return `A client hasn't ordered for ${days(t.days)}`;
    case "client.balanceOver": return `A client owes more than $${(t.amount ?? 0).toLocaleString("en-US")}`;
    case "stock.low": return `${t.bucket || (t.material === "gold" ? "Gold" : t.material === "diamond" ? "Diamonds" : "Stock")} below ${t.below ?? 0} ${t.material === "gold" ? "g" : t.material === "diamond" ? "ct" : ""}`.trim();
    case "time.schedule": {
      const when = t.every === "weekday" ? "Mon–Sat" : t.every === "week" ? `Every ${WEEKDAYS[t.weekday ?? 1]}` : t.every === "month" ? `Monthly on the ${t.monthDay ?? 1}` : "Every day";
      return `${when} at ${hm12(t.at)}${t.forEach && t.forEach !== "none" ? `, for ${EACH[t.forEach]}` : ""}`;
    }
  }
  const d = triggerDef(t.kind);
  return d.group === "An order" ? `An order ${d.label}` : d.label;
}

/** A fresh trigger of a kind, with sensible numbers. */
export function newTrigger(kind: TriggerKind, old?: Trigger): Trigger {
  const t: Trigger = { kind };
  const d = triggerDef(kind);
  if (d.needs?.includes("stage")) t.stage = old?.stage ?? "CAD Designing";
  if (d.needs?.includes("days")) t.days = old?.days ?? (kind === "order.dueSoon" ? 3 : kind === "client.idle" ? 60 : 5);
  if (d.needs?.includes("amount")) t.amount = old?.amount ?? 10000;
  if (d.needs?.includes("stock")) { t.material = "diamond"; t.below = 5; }
  if (d.needs?.includes("schedule")) { t.every = "weekday"; t.at = "09:00"; t.forEach = "none"; }
  return t;
}

export const isOrderTrigger = (k: TriggerKind) => k.startsWith("order.") || k === "invoice.raised";
export const isClientTrigger = (k: TriggerKind) => k.startsWith("client.");

/* ── Steps ── */

export interface StepDef { kind: StepKind; group: "Tell" | "Wait" | "Decide" | "Do"; label: string; hint: string; icon: LucideIcon; tone: string }
export const STEPS: StepDef[] = [
  { kind: "email", group: "Tell", label: "Email", hint: "To the client, factory, team or any address", icon: Mail, tone: "bg-sky-50 text-sky-600 ring-sky-200" },
  { kind: "popup", group: "Tell", label: "Popup reminder", hint: "Pops up on someone's screen", icon: AlarmClock, tone: "bg-violet-50 text-violet-600 ring-violet-200" },
  { kind: "alert", group: "Tell", label: "App alert", hint: "In their Alerts, and a phone push", icon: Bell, tone: "bg-amber-50 text-amber-600 ring-amber-200" },
  { kind: "task", group: "Tell", label: "Task", hint: "A to-do on their task list", icon: ListTodo, tone: "bg-emerald-50 text-emerald-600 ring-emerald-200" },
  { kind: "wait", group: "Wait", label: "Wait", hint: "Minutes, hours or days", icon: Clock, tone: "bg-slate-100 text-slate-600 ring-slate-200" },
  { kind: "waitUntil", group: "Wait", label: "Wait until", hint: "Until something happens — or time runs out", icon: Hourglass, tone: "bg-slate-100 text-slate-600 ring-slate-200" },
  { kind: "check", group: "Decide", label: "Continue only if", hint: "Stops here unless it holds", icon: Filter, tone: "bg-orange-50 text-orange-600 ring-orange-200" },
  { kind: "split", group: "Decide", label: "Yes / No", hint: "Two ways, by a check", icon: GitBranch, tone: "bg-orange-50 text-orange-600 ring-orange-200" },
  { kind: "switch", group: "Decide", label: "Many ways", hint: "One way for each value", icon: GitFork, tone: "bg-orange-50 text-orange-600 ring-orange-200" },
  { kind: "ask", group: "Decide", label: "Ask a person", hint: "Their Yes or No picks the way", icon: CircleHelp, tone: "bg-pink-50 text-pink-600 ring-pink-200" },
  { kind: "approve", group: "Do", label: "Approve the order", hint: "Only one waiting for approval", icon: BadgeCheck, tone: "bg-green-50 text-green-700 ring-green-200" },
  { kind: "assign", group: "Do", label: "Give to a salesperson", hint: "Only one nobody has", icon: UserCheck, tone: "bg-green-50 text-green-700 ring-green-200" },
  { kind: "label", group: "Do", label: "Label", hint: "A tag on the order", icon: Tag, tone: "bg-teal-50 text-teal-700 ring-teal-200" },
];
export const stepDef = (k: StepKind) => STEPS.find(s => s.kind === k)!;
export const TRIGGER_ICON = Zap, FILTER_ICON = Filter, SCHEDULE_ICON = CalendarClock, DONE_ICON = CheckCircle2;

/** A new step of a kind, ready to fill in. */
export function newStep(kind: StepKind, orderRun: boolean): Step {
  const id = stepId();
  switch (kind) {
    case "email": return { id, kind, to: [orderRun ? { kind: "client" } : { kind: "admins" }], subject: orderRun ? "About your order {order}" : "", text: orderRun ? "Dear {clientOwner},\n" : "", blocks: orderRun ? ["order"] : [] };
    case "popup": return { id, kind, to: [{ kind: "handler" }], title: orderRun ? "{order} — " : "", text: "" };
    case "alert": return { id, kind, to: [{ kind: "admins" }], text: orderRun ? "{order}: " : "" };
    case "task": return { id, kind, to: { kind: "handler" }, title: orderRun ? "Follow up {order}" : "", dueDays: 1 };
    case "label": return { id, kind, label: "" };
    case "wait": return { id, kind, amount: 1, unit: "days" };
    case "check": return { id, kind, all: [] };
    case "split": return { id, kind, all: [], yes: [], no: [] };
    case "switch": return { id, kind, field: "kind", cases: [{ value: "piece", steps: [] }, { value: "loose", steps: [] }], other: [] };
    case "waitUntil": return { id, kind, all: [], maxDays: 3, yes: [], no: [] };
    case "ask": return { id, kind, to: { kind: "admins" }, question: orderRun ? "Go ahead with {order}?" : "", maxDays: 2, yes: [], no: [] };
    case "approve": return { id, kind };
    case "assign": return { id, kind, who: "clientHandler" };
  }
}

/* ── Who ── */

export interface Names { person: (id: string) => string | undefined }
export function recipientText(r: Recipient, n: Names): string {
  switch (r.kind) {
    case "client": return "The client";
    case "factory": return "The factory";
    case "handler": return "Who handles it";
    case "admins": return "All admins";
    case "sales": return "Sales team";
    case "each": return "The one it's for";
    case "person": return n.person(r.userId) ?? "A person";
    case "department": return `${r.name} team`;
    case "address": return r.email;
  }
}
export const recipientsText = (to: Recipient[], n: Names) => to.length ? to.map(r => recipientText(r, n)).join(", ") : "Nobody yet";

/* ── Conditions ── */

export const OPS: Record<"text" | "number" | "yesno" | "pick", { op: Condition["op"]; label: string }[]> = {
  number: [{ op: "gt", label: "more than" }, { op: "lt", label: "less than" }, { op: "is", label: "is" }, { op: "isSet", label: "is known" }],
  text: [{ op: "is", label: "is" }, { op: "isNot", label: "is not" }, { op: "contains", label: "has" }, { op: "isSet", label: "is filled" }, { op: "isEmpty", label: "is empty" }],
  pick: [{ op: "is", label: "is" }, { op: "isNot", label: "is not" }, { op: "isSet", label: "is set" }, { op: "isEmpty", label: "is not set" }],
  yesno: [{ op: "yes", label: "yes" }, { op: "no", label: "no" }],
};
export const opNeedsValue = (op: Condition["op"]) => !["isSet", "isEmpty", "yes", "no"].includes(op);

export function conditionText(c: Condition, valueName: (field: FieldKey, v: string) => string): string {
  const d = fieldDef(c.field);
  if (!d) return "?";
  const op = OPS[d.type].find(o => o.op === c.op)?.label ?? c.op;
  if (d.type === "yesno") return `${d.label}: ${op}`;
  const v = c.value === undefined ? "" : d.type === "pick" ? valueName(c.field, String(c.value)) : d.key === "value" || d.key === "balance" || d.key === "paid" ? `$${Number(c.value).toLocaleString("en-US")}` : String(c.value);
  return `${d.label} ${op}${opNeedsValue(c.op) ? ` ${v || "…"}` : ""}`;
}

export const KIND_NAMES: Record<string, string> = { piece: "Jewellery piece", loose: "Loose stones", readyStock: "From ready stock" };
export const PRIORITIES = ["Normal", "Urgent", "High Priority"];
export const STATUSES = ["Waiting", "Approved", "In Production", "Ready", "Dispatched", "Delivered", "Rejected"];

/** One line under a step's name on the canvas. */
export function stepText(s: Step, n: Names, valueName: (field: FieldKey, v: string) => string): string {
  switch (s.kind) {
    case "email": return `${recipientsText(s.to, n)} · ${s.subject || "No subject yet"}${s.send === "digest" ? " · in the digest" : ""}`;
    case "popup": return `${recipientsText(s.to, n)} · ${s.title || "No title yet"}${s.delayMinutes ? ` · after ${s.delayMinutes >= 1440 ? `${Math.round(s.delayMinutes / 1440)}d` : s.delayMinutes >= 60 ? `${Math.round(s.delayMinutes / 60)}h` : `${s.delayMinutes}m`}` : ""}`;
    case "alert": return `${recipientsText(s.to, n)} · ${s.text || "No words yet"}`;
    case "task": return `${recipientText(s.to, n)} · ${s.title || "No title yet"} · due in ${days(s.dueDays)}`;
    case "label": return s.label ? `"${s.label}"` : "No label yet";
    case "wait": return `${s.amount} ${s.amount === 1 ? s.unit.replace(/s$/, "") : s.unit}`;
    case "check": case "split": return s.all.length ? s.all.map(c => conditionText(c, valueName)).join(" and ") : "Nothing to check yet";
    case "waitUntil": return `${s.all.length ? s.all.map(c => conditionText(c, valueName)).join(" and ") : "Nothing yet"} · at most ${days(s.maxDays)}`;
    case "switch": return `By ${fieldDef(s.field)?.label ?? s.field} · ${s.cases.length} way${s.cases.length === 1 ? "" : "s"} + other`;
    case "ask": return `${recipientText(s.to, n)} · ${s.question || "No question yet"}`;
    case "approve": return "If it's waiting for approval";
    case "assign": return s.who === "person" ? `To ${s.userId ? n.person(s.userId) ?? "a person" : "…"}, if nobody has it` : "To the client's handler, if nobody has it";
  }
}
