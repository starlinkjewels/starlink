import type { ModuleKey } from "./modules";
import type { PermAction } from "./permissions";

/**
 * The finer switches of employee access — what the sections × actions grid is
 * too coarse to say.
 *
 * The grid answers "may they open Orders, add one, change one". These answer
 * the rest, one business action or one kind of figure at a time: may they
 * approve an order, cancel one, assign it to someone, melt a piece, see profit,
 * see what a purchase cost, see everyone's salaries…
 *
 * Each switch belongs to a section and needs an action there (cancelling an
 * order needs Orders → Edit): without it the switch does nothing, so the grid
 * stays the first word and nothing can be granted that could not be reached.
 * The figures switches belong to no section — they follow the person through
 * every page that shows such a figure.
 *
 * `std` is what every employee could do before these switches existed, so the
 * day they arrive nobody's access moves: a switch that was open to staff
 * starts on, one that was the admin's starts off. An admin changes either, per
 * person. An admin always has every switch.
 *
 * `later`: the switch is shown but cannot be given yet — what it needs is held
 * where only an admin's device may read or write it, and opening that to staff
 * comes with the database rules for access (the next phase).
 */
export interface FeatureDef {
  key: string;
  /** The section it lives in; null for the figures, which cross every page. */
  module: ModuleKey | null;
  /** The action in its section it needs. */
  needs?: PermAction;
  /** What every employee could do before (Standard staff). */
  std: boolean;
  label: string;
  help: string;
  /** Not grantable yet — why. */
  later?: string;
  /** Worth a second look before giving: money out, removing records, others' pay. */
  risky?: boolean;
}

const ADMIN_STORE = "Needs the database rules for access (next step) — admins only until then.";

export const FEATURES: FeatureDef[] = [
  // ── Orders ───────────────────────────────────────────────────────────────
  { key: "orders.approve", module: "orders", needs: "edit", std: true, label: "Approve or reject new orders", help: "Approve an order waiting for approval, or reject it (rejecting returns any material given out)." },
  { key: "orders.stages", module: "orders", needs: "edit", std: true, label: "Move orders through the steps", help: "Mark a step done, undo it, drag on the board." },
  { key: "orders.finalApproval", module: "orders", needs: "edit", std: true, label: "Final Approval", help: "Enter the finished weights and the factory's labour, and close manufacturing." },
  { key: "orders.dispatch", module: "orders", needs: "edit", std: true, label: "Dispatch and delivery", help: "Courier details, dispatch, mark delivered — one order or many." },
  { key: "orders.pricing", module: "orders", needs: "edit", std: true, label: "Set the price", help: "The order's value, shipping, certificate fee and other charges." },
  { key: "orders.production", module: "orders", needs: "edit", std: true, label: "Plan production", help: "Choose the factory, give material from stock, buy new, estimates, rework." },
  { key: "orders.design", module: "orders", needs: "edit", std: true, label: "CAD, photos and designer", help: "Upload CAD and product photos, give the design to a designer." },
  { key: "orders.share", module: "orders", std: true, label: "Share pieces", help: "Share a piece or the order list as a link or PDF." },
  { key: "orders.assign", module: "orders", needs: "edit", std: false, label: "Assign orders to people", help: "Choose or change who handles an order (one or many); see orders by employee." },
  { key: "orders.cancel", module: "orders", needs: "edit", std: false, risky: true, label: "Cancel an order", help: "Cancel an order or undo a sale — material given out comes back." },
  { key: "orders.delete", module: "orders", needs: "edit", std: false, risky: true, label: "Delete and restore orders", help: "Delete an order (kept, marked deleted) and bring one back." },
  { key: "orders.melt", module: "orders", needs: "edit", std: false, risky: true, label: "Melt a piece", help: "Melt a finished piece back into gold and stones." },
  { key: "orders.forceComplete", module: "orders", needs: "edit", std: false, label: "Force a step done", help: "Complete a step even when its checks are not met." },
  { key: "orders.fixPurchase", module: "orders", needs: "edit", std: false, risky: true, label: "Correct a purchase from the order", help: "Edit or remove a purchase made for the order." },
  { key: "orders.toReadyStock", module: "orders", needs: "edit", std: false, label: "Put a finished piece into Ready Stock", help: "Moves the piece to Ready Stock with its cost.", later: ADMIN_STORE },

  // ── Clients ──────────────────────────────────────────────────────────────
  { key: "clients.handler", module: "clients", needs: "edit", std: false, label: "Choose who handles a client", help: "Set or change a client's account manager; see clients by employee." },
  { key: "clients.login", module: "clients", needs: "edit", std: false, label: "Client logins", help: "Give a client a login, change it, or send a password reset.", later: "The server lets only an admin change a login — opened in the next step." },
  { key: "clients.giftCards", module: "clients", needs: "edit", std: false, risky: true, label: "Gift cards and cashback", help: "Issue gift cards and set a client's cashback." },

  // ── Invoices ─────────────────────────────────────────────────────────────
  { key: "invoices.returns", module: "invoices", needs: "edit", std: true, label: "Sales returns", help: "Take pieces back on a credit note, or cancel a return." },
  { key: "invoices.delete", module: "invoices", needs: "edit", std: false, risky: true, label: "Delete an invoice", help: "Remove an invoice (its orders go back to not invoiced)." },

  // ── Suppliers & brokers ──────────────────────────────────────────────────
  { key: "suppliers.purchase", module: "suppliers", needs: "view", std: false, label: "Purchases on a supplier's page", help: "Record a purchase from the supplier's page; edit or void one." },
  { key: "suppliers.sell", module: "suppliers", needs: "view", std: false, risky: true, label: "Sell to a supplier", help: "Sell stock to a supplier and take their money." },
  { key: "suppliers.gold", module: "suppliers", needs: "view", std: false, label: "Gold on loan", help: "Gold a supplier lends us, returns, and turns into a bill." },

  // ── Factories ────────────────────────────────────────────────────────────
  { key: "factories.issue", module: "factories", needs: "view", std: false, label: "Give and take back material", help: "Issue material to a factory, return or close an issue, set the charge, finished piece." },
  { key: "factories.companies", module: "factories", needs: "view", std: false, label: "Move a factory's gold between companies", help: "Only when there is more than one company." },

  // ── Stock, Buy & Assign ──────────────────────────────────────────────────
  { key: "stock.companies", module: "stock", needs: "edit", std: false, label: "Move stock between companies", help: "Only when there is more than one company." },
  { key: "stock.memo", module: "stock", needs: "view", std: false, risky: true, label: "Memo (goods on approval)", help: "Send stock out on memo, take it back, or sell it to whoever holds it." },
  { key: "buyAssign.sell", module: "buyAssign", needs: "add", std: true, risky: true, label: "Sell stock", help: "Sell a diamond, or sell stock to a supplier, from Buy & Assign." },
  { key: "buyAssign.assign", module: "buyAssign", needs: "add", std: true, label: "Assign to a factory", help: "Give material to a factory from Buy & Assign." },
  { key: "buyAssign.changeAssign", module: "buyAssign", needs: "edit", std: false, label: "Change or cancel an assignment", help: "Edit or cancel material already given to a factory." },

  // ── Ready Stock ──────────────────────────────────────────────────────────
  { key: "readyStock.offices", module: "readyStock", needs: "edit", std: false, label: "Offices", help: "Add, rename or reorder the Ready Stock offices." },

  // ── Gift cards ───────────────────────────────────────────────────────────
  { key: "giftCards.cancel", module: "giftCards", needs: "view", std: false, risky: true, label: "Cancel a gift card", help: "Stop a card so it can no longer be used." },

  // ── Catalog ──────────────────────────────────────────────────────────────
  { key: "catalog.move", module: "catalog", needs: "edit", std: false, label: "Move files and folders", help: "Move designs and folders around the catalog." },
  { key: "catalog.check", module: "catalog", needs: "view", std: true, label: "Check catalogue readings", help: "Correct or confirm what was read from a design sheet." },

  // ── Money ────────────────────────────────────────────────────────────────
  // Paying anyone — a supplier, a factory, a designer, through a broker — is
  // Payments → Add, from whichever page it is started.
  { key: "payments.broker", module: "payments", needs: "add", std: false, label: "Money from a broker", help: "Receive money a broker collected for us." },
  { key: "expenses.everyone", module: "expenses", needs: "view", std: false, label: "Everyone's expenses", help: "See and filter every person's expenses, not just their own." },

  // ── Reports, home ────────────────────────────────────────────────────────
  { key: "reports.team", module: "reports", needs: "view", std: false, label: "Team report", help: "Sales and money by person, and the report for any one employee." },
  { key: "dashboard.business", module: "dashboard", needs: "view", std: false, label: "The business on Home", help: "Home's business totals — sales, collected, owed, cash, staff spending, production overview." },

  // ── Figures — across every page ──────────────────────────────────────────
  { key: "fig.costs", module: null, std: true, label: "Costs and rates", help: "What things cost us: purchase rates, stock value at cost, labour charges, the materials on an order." },
  { key: "fig.balances", module: null, std: true, label: "Account balances", help: "How much is in each account (cash, bank) — on Payments, the Day book and the Locker." },
  { key: "fig.salaries", module: null, std: true, risky: true, label: "Other people's salaries and expenses", help: "Salaries and expenses of the rest of the team, wherever money is listed." },
  { key: "fig.payables", module: null, std: true, label: "What we owe", help: "Balances owed to suppliers, factories and designers." },
  { key: "fig.profit", module: null, std: false, risky: true, label: "Profit and margin", help: "Profit, margin and cost of sales — on orders, Ready Stock, reports, exports.", later: ADMIN_STORE },
];

export const FEATURE_BY_KEY: Record<string, FeatureDef> = Object.fromEntries(FEATURES.map(f => [f.key, f]));
export const featuresOf = (m: ModuleKey | null) => FEATURES.filter(f => f.module === m);
export const FIGURES = featuresOf(null);
/** Every switch an employee had before — on for Standard staff. */
export const STD_FEATURES: string[] = FEATURES.filter(f => f.std).map(f => f.key);

/**
 * The limits on a person's access — the "where and how much" on top of the
 * "what". Unset means no limit, which is how everyone starts.
 */
export interface AccessLimits {
  /** The order steps they may move (stage names). Unset: every step their access allows. */
  stages?: string[];
  /** The Ready Stock offices they may work in. Unset: every office. */
  offices?: string[];
  /** How many days back they may enter or change a record. Unset: no limit (the year lock still applies). */
  backDays?: number;
  /** The largest single money entry they may record, in USD. Unset: no limit. */
  maxAmountUsd?: number;
}
export const hasLimits = (l?: AccessLimits) =>
  !!l && (!!l.stages?.length || !!l.offices?.length || l.backDays != null || l.maxAmountUsd != null);
