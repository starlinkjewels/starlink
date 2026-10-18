// Transactional email, sent by this project's own Cloud Function (sendMail in
// functions/src/mail.ts) from the company's Gmail account — no outside mail
// service is involved.
// Fire-and-forget: an email failure must NEVER block or fail the order action,
// so every call is wrapped and returns a boolean instead of throwing.
import { httpsCallable } from "firebase/functions";
import { functions } from "./firebase";

/** The company inbox that gets the internal alerts (new order, client login). */
export const MARKETING_EMAIL = "online@ssdiam.in";

const sendMailFn = httpsCallable<{ to: string; subject: string; html: string; onceKey?: string }, { ok: boolean; skipped?: boolean }>(functions, "sendMail");

/** `onceKey`: send this kind of email at most once per login per day — the
 *  server skips it if any of that login's devices already sent it today. */
export async function sendMail(to: string, subject: string, html: string, opts?: { onceKey?: string }): Promise<boolean> {
  if (!to || !to.includes("@")) return false;
  try {
    const res = await sendMailFn({ to, subject, html, ...(opts?.onceKey ? { onceKey: opts.onceKey } : {}) });
    return !!res.data?.ok;
  } catch {
    return false;
  }
}

/* ───────────────────────── The brand ───────────────────────── */

const BRAND_NAME = "Shree Suktam Diamond";
const BRAND_LINE = "";
const LOGO_FILE = "/brand-logo-wide.png";
const INK = "#2B2A29";       // headings and figures — the logo's charcoal
const MUTED = "#6B7280";
const LINE = "#ECEAE6";
const PAGE = "#F6F5F3";

/** Where the app lives — the logo is loaded from there (the emails are written in the browser). */
const appUrl = () => (typeof window !== "undefined" ? window.location.origin : "");

const esc = (s: unknown) => String(s ?? "").replace(/[<>&"]/g, c => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" }[c]!));

/* ───────────────────────── The shell every email shares ───────────────────────── */

type Tone = "neutral" | "success" | "info" | "gift";
const TONE: Record<Tone, { bg: string; fg: string }> = {
  neutral: { bg: "#F1EFEB", fg: "#4A4743" },
  success: { bg: "#E7F6EE", fg: "#11733F" },
  info: { bg: "#F1EFEB", fg: "#2B2A29" },
  gift: { bg: "#FBF3E2", fg: "#8A6416" },
};

/**
 * One layout for every email: the logo on white, a small status label, the
 * heading, a short paragraph, the details and a quiet footer. Information
 * only — no buttons and no links. Tables and inline styles only — what every
 * mail app reads the same way.
 */
function shell(o: { preheader: string; label: string; tone?: Tone; heading: string; intro: string; body?: string; footerNote: string }): string {
  const t = TONE[o.tone ?? "neutral"];
  const logo = appUrl()
    ? `<img src="${appUrl()}${LOGO_FILE}" alt="${BRAND_NAME}" height="40" style="display:block;height:40px;width:auto;border:0;outline:none;text-decoration:none;font-size:18px;font-weight:700;color:${INK};" />`
    : `<span style="font-size:18px;font-weight:700;color:${INK};letter-spacing:1px;">${BRAND_NAME.toUpperCase()}</span>`;
  return `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${esc(o.label)}</title></head>
<body style="margin:0;padding:0;background:${PAGE};">
  <span style="display:none!important;visibility:hidden;opacity:0;color:${PAGE};height:0;width:0;overflow:hidden;mso-hide:all;">${esc(o.preheader)}</span>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${PAGE};">
    <tr><td align="center" style="padding:28px 12px;">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background:#ffffff;border:1px solid ${LINE};border-radius:12px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
        <tr><td style="padding:24px 32px 20px;border-bottom:1px solid ${LINE};">${logo}</td></tr>
        <tr><td style="padding:28px 32px 8px;">
          <span style="display:inline-block;padding:4px 10px;border-radius:999px;background:${t.bg};color:${t.fg};font-size:12px;font-weight:600;letter-spacing:0.2px;">${esc(o.label)}</span>
          <h1 style="margin:14px 0 8px;font-size:22px;line-height:1.3;font-weight:700;color:${INK};">${o.heading}</h1>
          <p style="margin:0;font-size:15px;line-height:1.6;color:#374151;">${o.intro}</p>
        </td></tr>
        ${o.body ? `<tr><td style="padding:16px 32px 4px;">${o.body}</td></tr>` : ""}
        <tr><td style="padding:28px 32px 28px;">
          <p style="margin:0;padding-top:18px;border-top:1px solid ${LINE};font-size:12px;line-height:1.6;color:${MUTED};">${o.footerNote}</p>
          <p style="margin:6px 0 0;font-size:12px;line-height:1.6;color:${MUTED};">© ${new Date().getFullYear()} ${BRAND_NAME}${BRAND_LINE ? ` · ${BRAND_LINE}` : ""}</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

/** The details of an order, as quiet label / value rows. */
function detailRows(rows: [string, string | number | undefined | null][]): string {
  const cells = rows
    .filter(([, v]) => v != null && v !== "")
    .map(([k, v], i) =>
      `<tr>
        <td style="padding:11px 0;${i ? `border-top:1px solid ${LINE};` : ""}font-size:14px;color:${MUTED};width:42%;vertical-align:top;">${esc(k)}</td>
        <td style="padding:11px 0;${i ? `border-top:1px solid ${LINE};` : ""}font-size:14px;color:${INK};font-weight:600;text-align:right;">${esc(v)}</td>
      </tr>`)
    .join("");
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid ${LINE};border-bottom:1px solid ${LINE};">${cells}</table>`;
}

const fmtDay = (iso?: string) => {
  if (!iso) return undefined;
  const d = new Date(iso);
  return isNaN(+d) ? iso : d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }).replace(/\bSept\b/, "Sep");
};

const TO_CLIENT = `You're receiving this because you have an account with ${BRAND_NAME}.`;
const TO_TEAM = `An automatic note from your ${BRAND_NAME} portal.`;

/* ───────────────────────── The emails ───────────────────────── */

export interface OrderEmailInfo {
  orderNumber: string;
  clientName: string;
  jewelleryType?: string;
  metal?: string;
  quantity?: number;
  expectedDelivery?: string;
}

const pieceRows = (o: OrderEmailInfo): [string, string | number | undefined][] => [
  ["Order", o.orderNumber],
  ["Piece", [o.jewelleryType, o.metal].filter(Boolean).join(" · ") || undefined],
  ["Quantity", o.quantity ? `${o.quantity} pc${o.quantity === 1 ? "" : "s"}` : undefined],
  ["Expected delivery", fmtDay(o.expectedDelivery)],
];

/** A new order was placed → the team's inbox. */
export function orderReceivedEmail(o: OrderEmailInfo): { subject: string; html: string } {
  return {
    subject: `New order ${o.orderNumber} — ${o.clientName}`,
    html: shell({
      preheader: `${o.clientName} placed order ${o.orderNumber}.`,
      label: "New order", tone: "info",
      heading: `New order from ${esc(o.clientName)}`,
      intro: "A new order has been placed and is waiting for review and approval.",
      body: detailRows([["Client", o.clientName], ...pieceRows(o)]),
      footerNote: TO_TEAM,
    }),
  };
}

/** The order was approved → the client. */
export function orderApprovedEmail(o: OrderEmailInfo): { subject: string; html: string } {
  return {
    subject: `Your order ${o.orderNumber} is approved`,
    html: shell({
      preheader: `Good news — order ${o.orderNumber} is approved and moving into production.`,
      label: "Order approved", tone: "success",
      heading: "Your order is approved",
      intro: `Dear ${esc(o.clientName)},<br>Thank you for your order. It has been approved and is now moving into production. We'll keep you posted at each step.`,
      body: detailRows(pieceRows(o)),
      footerNote: TO_CLIENT,
    }),
  };
}

export interface DispatchEmailInfo extends OrderEmailInfo {
  courierName?: string;
  trackingNumber?: string;
  /** Accepted but not shown: the emails carry information only, no links. */
  trackingLink?: string;
}

/** The order was dispatched → the client, with courier and tracking. */
export function orderDispatchedEmail(o: DispatchEmailInfo): { subject: string; html: string } {
  return {
    subject: `Your order ${o.orderNumber} is on its way`,
    html: shell({
      preheader: `Order ${o.orderNumber} has been dispatched${o.courierName ? ` with ${o.courierName}` : ""}.`,
      label: "Dispatched", tone: "info",
      heading: "Your order is on its way",
      intro: `Dear ${esc(o.clientName)},<br>Your order has been dispatched. The shipment details are below.`,
      body: detailRows([
        ["Order", o.orderNumber],
        ["Piece", [o.jewelleryType, o.metal].filter(Boolean).join(" · ") || undefined],
        ["Courier", o.courierName],
        ["Tracking number", o.trackingNumber],
      ]),
      footerNote: TO_CLIENT,
    }),
  };
}

export interface ClientLoginEmailInfo {
  companyName: string;
  email: string;
  at: string; // ISO
  /** Typed their password, or opened the app already signed in. */
  how?: "signed in" | "opened the app";
}

/** A client is using the portal (the first time today) → the team's inbox,
 *  so staff notice engagement. */
export function clientLoginEmail(o: ClientLoginEmailInfo): { subject: string; html: string } {
  const when = new Date(o.at).toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" }).replace(/\bSept\b/, "Sep");
  const typed = o.how !== "opened the app";
  return {
    subject: typed ? `${o.companyName} signed in` : `${o.companyName} opened the portal`,
    html: shell({
      preheader: `${o.companyName} ${typed ? "just signed in to" : "opened"} the portal.`,
      label: typed ? "Client sign-in" : "Client active", tone: "neutral",
      heading: `${esc(o.companyName)} ${typed ? "signed in" : "opened the portal"}`,
      intro: typed
        ? `${esc(o.companyName)} just signed in to the ${BRAND_NAME} portal.`
        : `${esc(o.companyName)} opened the ${BRAND_NAME} portal, already signed in on their device. This is their first visit today.`,
      body: detailRows([["Client", o.companyName], ["Login", o.email], ["Time", when]]),
      footerNote: TO_TEAM,
    }),
  };
}

export interface GiftCardEmailInfo {
  clientName: string;
  /** Already formatted, e.g. "$500". */
  amount: string;
  /** e.g. "17 Nov 2026" — when it can last be used. */
  validUntil?: string;
  note?: string;
}

/** A gift card was issued → the client. */
export function giftCardEmail(o: GiftCardEmailInfo): { subject: string; html: string } {
  return {
    subject: `You've received a ${o.amount} gift card`,
    html: shell({
      preheader: `A ${o.amount} gift card from ${BRAND_NAME}, ready for your next order.`,
      label: "Gift card", tone: "gift",
      heading: `A ${esc(o.amount)} gift card for you`,
      intro: `Dear ${esc(o.clientName)},<br>You've received a gift card to use on your next order.${o.note ? `<br><br>${esc(o.note)}` : ""}`,
      body: detailRows([["Value", o.amount], ["Valid until", o.validUntil]]),
      footerNote: TO_CLIENT,
    }),
  };
}
