// Ready-made pipelines — the everyday chases of a jewellery business, built
// once. Each opens in the builder switched OFF, to be read, changed (a client,
// a value, a stage, a day count) and switched on.
import { stepId, type Pipeline, type Step, type Condition } from "@/lib/pure/pipelines";

export type TemplateGroup = "Orders" | "CAD & factory" | "Money" | "Stock" | "Clients" | "Team";
export interface Template {
  id: string;
  group: TemplateGroup;
  title: string;
  /** One line: what it does. */
  what: string;
  build: () => Omit<Pipeline, "id" | "version">;
}

const s = <T extends Omit<Step, "id">>(x: T): T & { id: string } => ({ id: stepId(), ...x });
const when = (field: Condition["field"], op: Condition["op"], value?: string | number): Condition => ({ field, op, ...(value !== undefined ? { value } : {}) });
const base = (name: string, template: string, rest: Partial<Pipeline>): Omit<Pipeline, "id" | "version"> =>
  ({ name, on: false, only: [], steps: [], template, trigger: { kind: "order.placed" }, ...rest });

const JOB_SHEET = "Please make the piece below for order {order}.\nDue: {due}.\n\nThank you.";

export const TEMPLATES: Template[] = [
  /* ── Orders ── */
  { id: "auto-approve", group: "Orders", title: "Approve small orders by itself",
    what: "Orders under $2,000 are approved at once and the client is told — change the amount or add a client",
    build: () => base("Approve small orders by itself", "auto-approve", {
      trigger: { kind: "order.placed" }, only: [when("value", "lt", 2000), when("value", "gt", 0)],
      steps: [s({ kind: "approve" }), s({ kind: "email", to: [{ kind: "client" }], subject: "Your order {order} is approved", text: "Dear {clientOwner},\nThank you — your order {order} ({piece}) is approved and moving into production. Due: {due}." })],
    }) },
  { id: "ask-owner-big", group: "Orders", title: "Big order? Ask the owner first",
    what: "An order over $5,000 waits for the owner's yes in the app; then it is approved and the client told",
    build: () => base("Big order — ask the owner", "ask-owner-big", {
      trigger: { kind: "order.placed" }, only: [when("value", "gt", 5000)],
      steps: [s({ kind: "ask", to: { kind: "admins" }, question: "Approve {order} for {client} — {value}?", maxDays: 2,
        yes: [s({ kind: "approve" }), s({ kind: "email", to: [{ kind: "client" }], subject: "Your order {order} is approved", text: "Dear {clientOwner},\nYour order {order} is approved and moving into production." })],
        no: [s({ kind: "popup", to: [{ kind: "handler" }], title: "{order} was not approved", text: "The owner said no (or didn't answer in 2 days). Talk to {client}." })] })],
    }) },
  { id: "new-order-team", group: "Orders", title: "New order → tell the team",
    what: "Email the admins and pop up on the handler's screen the moment an order comes in",
    build: () => base("New order — tell the team", "new-order-team", {
      trigger: { kind: "order.placed" },
      steps: [s({ kind: "email", to: [{ kind: "admins" }], subject: "New order {order} — {client}", text: "{client} placed {order}: {piece}. Value {value}. Due {due}.", blocks: ["order"] }),
        s({ kind: "popup", to: [{ kind: "handler" }], title: "New order {order}", text: "{client} — {piece}" })],
    }) },
  { id: "urgent-alert", group: "Orders", title: "Urgent order alert",
    what: "An order marked Urgent pops up on every admin's screen and is emailed to them",
    build: () => base("Urgent order alert", "urgent-alert", {
      trigger: { kind: "order.placed" }, only: [when("priority", "is", "Urgent")],
      steps: [s({ kind: "popup", to: [{ kind: "admins" }], title: "Urgent: {order}", text: "{client} — {piece}, due {due}" }),
        s({ kind: "email", to: [{ kind: "admins" }], subject: "URGENT order {order} — {client}", text: "{order} is marked urgent. Due {due}.", blocks: ["order"] })],
    }) },
  { id: "approved-client", group: "Orders", title: "Approved → email the client",
    what: "The client hears the moment their order is approved",
    build: () => base("Approved — tell the client", "approved-client", {
      trigger: { kind: "order.approved" }, only: [when("clientHasEmail", "yes")],
      steps: [s({ kind: "email", to: [{ kind: "client" }], subject: "Your order {order} is approved", text: "Dear {clientOwner},\nYour order {order} ({piece}) is approved and moving into production. Expected: {due}.", blocks: ["order"] })],
    }) },
  { id: "due-soon", group: "Orders", title: "Due in 3 days, not dispatched",
    what: "A popup for the handler and an email to the admins three days before an order is due",
    build: () => base("Due in 3 days — not dispatched", "due-soon", {
      trigger: { kind: "order.dueSoon", days: 3 }, only: [when("dispatched", "no")],
      steps: [s({ kind: "popup", to: [{ kind: "handler" }], title: "{order} is due {due}", text: "{client} — it is at {stage}." }),
        s({ kind: "email", to: [{ kind: "admins" }], subject: "{order} due in 3 days — at {stage}", text: "{order} for {client} is due {due} and is at {stage}." })],
    }) },
  { id: "overdue", group: "Orders", title: "Overdue — chase, then escalate",
    what: "Past its due date: the handler is reminded; two days on, still not out, the admins are told",
    build: () => base("Overdue — chase and escalate", "overdue", {
      trigger: { kind: "order.overdue", days: 1 },
      steps: [s({ kind: "popup", to: [{ kind: "handler" }], title: "{order} is overdue", text: "Due {due} — it is at {stage}." }),
        s({ kind: "wait", amount: 2, unit: "days" }), s({ kind: "check", all: [when("dispatched", "no")] }),
        s({ kind: "email", to: [{ kind: "admins" }], subject: "Still overdue: {order} ({client})", text: "{order} was due {due}. It is at {stage}, handled by {handler}." })],
    }) },

  /* ── CAD & factory ── */
  { id: "cad-start", group: "CAD & factory", title: "Approved → the CAD team starts",
    what: "Email and pop up for everyone in the CAD department with the design to make",
    build: () => base("Approved — CAD team starts", "cad-start", {
      trigger: { kind: "order.approved" }, only: [when("kind", "is", "piece")],
      steps: [s({ kind: "email", to: [{ kind: "department", name: "CAD" }], subject: "New CAD: {order} — {piece}", text: "Please start the CAD for {order} ({client}). Due {due}.", blocks: ["jobSheet"] }),
        s({ kind: "popup", to: [{ kind: "department", name: "CAD" }], title: "New CAD: {order}", text: "{piece} for {client}" })],
    }) },
  { id: "cad-slow", group: "CAD & factory", title: "CAD taking long",
    what: "Three days in CAD Designing: the CAD team and the handler get a popup",
    build: () => base("CAD taking long", "cad-slow", {
      trigger: { kind: "order.stuck", stage: "CAD Designing", days: 3 },
      steps: [s({ kind: "popup", to: [{ kind: "department", name: "CAD" }, { kind: "handler" }], title: "{order}: {daysInStage} days in CAD", text: "{client} — due {due}" })],
    }) },
  { id: "factory-job-sheet", group: "CAD & factory", title: "Factory job sheet",
    what: "The factory gets the full job sheet by email the moment it is given an order",
    build: () => base("Factory job sheet", "factory-job-sheet", {
      trigger: { kind: "order.factoryAssigned" }, only: [when("factoryHasEmail", "yes")],
      steps: [s({ kind: "email", to: [{ kind: "factory" }], subject: "Job {order} — {piece}", text: JOB_SHEET, blocks: ["jobSheet"] })],
    }) },
  { id: "factory-late", group: "CAD & factory", title: "Late at the factory",
    what: "Seven days in production: a polite email to the factory; three more days, the admins are told",
    build: () => base("Late at the factory", "factory-late", {
      trigger: { kind: "order.stuck", stage: "In Production", days: 7 },
      steps: [s({ kind: "email", to: [{ kind: "factory" }], subject: "When will {order} be ready?", text: "Dear {factory},\n{order} ({piece}) has been in production for {daysInStage} days. It is due {due}. Please let us know when it will be ready." }),
        s({ kind: "popup", to: [{ kind: "handler" }], title: "{order} late at {factory}", text: "{daysInStage} days in production — we emailed them." }),
        s({ kind: "wait", amount: 3, unit: "days" }), s({ kind: "check", all: [when("stage", "is", "In Production")] }),
        s({ kind: "email", to: [{ kind: "admins" }], subject: "{order} still at {factory} — {daysInStage} days", text: "{order} for {client} is still in production at {factory}. Due {due}." })],
    }) },
  { id: "final-approval-bill", group: "CAD & factory", title: "Final Approval done → time to bill",
    what: "The admins get a popup and a task to raise the invoice once the factory's actuals are in",
    build: () => base("Final Approval — time to bill", "final-approval-bill", {
      trigger: { kind: "order.finalApproval" },
      steps: [s({ kind: "popup", to: [{ kind: "admins" }], title: "{order} is ready to bill", text: "Final Approval is done — {client}, {value}." }),
        s({ kind: "task", to: { kind: "admins" }, title: "Invoice {order} for {client}", dueDays: 1 })],
    }) },
  { id: "cancelled-factory", group: "CAD & factory", title: "Cancelled → tell the factory to stop",
    what: "If the order was with a factory, it is told by email to stop work",
    build: () => base("Cancelled — tell the factory", "cancelled-factory", {
      trigger: { kind: "order.cancelled" }, only: [when("factory", "isSet"), when("factoryHasEmail", "yes")],
      steps: [s({ kind: "email", to: [{ kind: "factory" }], subject: "Please stop work on {order}", text: "Dear {factory},\nOrder {order} ({piece}) has been cancelled. Please stop any work on it and keep the material ready to return." })],
    }) },
  { id: "factory-morning", group: "CAD & factory", title: "Morning list for each factory",
    what: "Every working day at 9:00, each factory gets one email with all its open jobs and due dates",
    build: () => base("Morning list for each factory", "factory-morning", {
      trigger: { kind: "time.schedule", every: "weekday", at: "09:00", forEach: "factory" },
      steps: [s({ kind: "email", to: [{ kind: "each" }], subject: "Your open jobs — {today}", text: "Dear {name},\nHere are the {count} jobs you have open with us.", blocks: ["list"], list: { which: "open" } })],
    }) },

  /* ── Money ── */
  { id: "payment-thanks", group: "Money", title: "Payment received → thank you",
    what: "The client gets a thank-you with what is still to pay",
    build: () => base("Payment received — thank you", "payment-thanks", {
      trigger: { kind: "order.paymentReceived" }, only: [when("clientHasEmail", "yes")],
      steps: [s({ kind: "email", to: [{ kind: "client" }], subject: "Thank you — payment for {order}", text: "Dear {clientOwner},\nThank you for your payment on {order}. Paid so far {paid}; still to pay {balance}.", blocks: ["money"] })],
    }) },
  { id: "payment-ladder", group: "Money", title: "Payment reminders 7 · 15 · 30 days",
    what: "Polite, then firmer reminders after dispatch — each only if still unpaid; at 30 days the team is told",
    build: () => base("Payment reminders", "payment-ladder", {
      trigger: { kind: "order.unpaidAfterDispatch", days: 7 }, only: [when("clientHasEmail", "yes")],
      steps: [s({ kind: "email", to: [{ kind: "client" }], subject: "A gentle reminder — {order}", text: "Dear {clientOwner},\nA gentle reminder that {balance} is still due on {order}.", blocks: ["money"] }),
        s({ kind: "wait", amount: 8, unit: "days" }), s({ kind: "check", all: [when("fullyPaid", "no")] }),
        s({ kind: "email", to: [{ kind: "client" }], subject: "Payment due — {order}", text: "Dear {clientOwner},\n{balance} on {order} is now overdue. Please arrange payment.", blocks: ["money"] }),
        s({ kind: "wait", amount: 15, unit: "days" }), s({ kind: "check", all: [when("fullyPaid", "no")] }),
        s({ kind: "popup", to: [{ kind: "handler" }], title: "{client} still owes {balance}", text: "{order} — 30 days since dispatch. Please call them." }),
        s({ kind: "email", to: [{ kind: "admins" }], subject: "30 days unpaid: {order} — {client}", text: "{client} still owes {balance} on {order}." })],
    }) },
  { id: "balance-over", group: "Money", title: "Big balance alert",
    what: "When a client owes more than $5,000 in all, the admins are told",
    build: () => base("Big balance alert", "balance-over", {
      trigger: { kind: "client.balanceOver", amount: 5000 },
      steps: [s({ kind: "popup", to: [{ kind: "admins" }], title: "{client} owes over $5,000", text: "Look before taking their next order." }),
        s({ kind: "email", to: [{ kind: "admins" }], subject: "{client} owes over $5,000", text: "{client}'s unpaid balance has gone over $5,000." })],
    }) },
  { id: "dispatched-client", group: "Money", title: "Dispatched → courier and tracking",
    what: "The client gets the courier and tracking number; a week later, not delivered, the handler checks",
    build: () => base("Dispatched — tell the client", "dispatched-client", {
      trigger: { kind: "order.dispatched" }, only: [when("clientHasEmail", "yes")],
      steps: [s({ kind: "email", to: [{ kind: "client" }], subject: "Your order {order} is on its way", text: "Dear {clientOwner},\nYour order {order} has been dispatched.\nCourier: {courier}\nTracking: {tracking}" }),
        s({ kind: "wait", amount: 7, unit: "days" }), s({ kind: "check", all: [when("delivered", "no")] }),
        s({ kind: "popup", to: [{ kind: "handler" }], title: "Has {order} arrived?", text: "Dispatched a week ago with {courier} ({tracking})." })],
    }) },
  { id: "delivered-thanks", group: "Money", title: "Delivered → thank you, then feedback",
    what: "A thank-you on delivery, and a short 'how do you like it?' a month later",
    build: () => base("Delivered — thank you", "delivered-thanks", {
      trigger: { kind: "order.delivered" }, only: [when("clientHasEmail", "yes")],
      steps: [s({ kind: "email", to: [{ kind: "client" }], subject: "Thank you for your order {order}", text: "Dear {clientOwner},\nYour order {order} has been delivered. Thank you for choosing {company}." }),
        s({ kind: "wait", amount: 30, unit: "days" }),
        s({ kind: "email", to: [{ kind: "client" }], subject: "How do you like your {piece}?", text: "Dear {clientOwner},\nIt has been a month since {order} reached you. We'd love to hear how you like it." })],
    }) },

  /* ── Stock ── */
  { id: "low-diamonds", group: "Stock", title: "Low diamond stock",
    what: "A bag below 2 ct: the admins get an email and a popup",
    build: () => base("Low diamond stock", "low-diamonds", {
      trigger: { kind: "stock.low", material: "diamond", below: 2 },
      steps: [s({ kind: "email", to: [{ kind: "admins" }], subject: "Low stock: {stock}", text: "{stock} is down to {stockLeft}." }), s({ kind: "popup", to: [{ kind: "admins" }], title: "Low stock: {stock}", text: "{stockLeft} left" })],
    }) },
  { id: "low-gold", group: "Stock", title: "Low gold stock",
    what: "A gold purity below 50 g: the admins are emailed",
    build: () => base("Low gold stock", "low-gold", {
      trigger: { kind: "stock.low", material: "gold", below: 50 },
      steps: [s({ kind: "email", to: [{ kind: "admins" }], subject: "Low gold: {stock}", text: "{stock} is down to {stockLeft}." })],
    }) },
  { id: "certificate-slow", group: "Stock", title: "Certificate taking long",
    what: "Seven days in Certification: the handler gets a popup",
    build: () => base("Certificate taking long", "certificate-slow", {
      trigger: { kind: "order.stuck", stage: "Certification", days: 7 },
      steps: [s({ kind: "popup", to: [{ kind: "handler" }], title: "{order}: {daysInStage} days at the lab", text: "{client} — due {due}" })],
    }) },

  /* ── Clients ── */
  { id: "new-client", group: "Clients", title: "New client → welcome and a call",
    what: "A welcome email, and a task for the handler to call them tomorrow",
    build: () => base("New client — welcome", "new-client", {
      trigger: { kind: "client.created" },
      steps: [s({ kind: "email", to: [{ kind: "client" }], subject: "Welcome to {company}", text: "Dear {clientOwner},\nWelcome to {company}. We look forward to working with you." }),
        s({ kind: "task", to: { kind: "handler" }, title: "Call {client} — new client", dueDays: 1 })],
    }) },
  { id: "quiet-client", group: "Clients", title: "Quiet client (60 days)",
    what: "No order for 60 days: the handler gets a popup and a task to call them",
    build: () => base("Quiet client", "quiet-client", {
      trigger: { kind: "client.idle", days: 60 },
      steps: [s({ kind: "popup", to: [{ kind: "handler" }], title: "{client}: no order in 60 days", text: "A good time to call them with new designs." }),
        s({ kind: "task", to: { kind: "handler" }, title: "Call {client} — 60 days quiet", dueDays: 2 })],
    }) },

  /* ── Team ── */
  { id: "sales-morning", group: "Team", title: "Morning briefing for each salesperson",
    what: "Every working day at 9:00, each salesperson gets their orders due in the next 7 days",
    build: () => base("Morning briefing — sales", "sales-morning", {
      trigger: { kind: "time.schedule", every: "weekday", at: "09:00", forEach: "salesperson" },
      steps: [s({ kind: "email", to: [{ kind: "each" }], subject: "Your orders due this week — {today}", text: "Good morning {name},\nHere are your {count} orders due in the next 7 days.", blocks: ["list"], list: { which: "dueSoon", days: 7 } })],
    }) },
  { id: "owner-evening", group: "Team", title: "Owner's evening summary",
    what: "Every evening at 8:00, each admin gets today's new orders",
    build: () => base("Evening summary — owner", "owner-evening", {
      trigger: { kind: "time.schedule", every: "day", at: "20:00", forEach: "admin" },
      steps: [s({ kind: "email", to: [{ kind: "each" }], subject: "Today at {company} — {today}", text: "Good evening {name},\nHere are today's {count} new orders.", blocks: ["list"], list: { which: "newToday" } })],
    }) },
];

export const TEMPLATE_GROUPS: TemplateGroup[] = ["Orders", "CAD & factory", "Money", "Stock", "Clients", "Team"];
