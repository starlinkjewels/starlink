// Transactional email via the marketing send-mail API.
// Fire-and-forget: an email failure must NEVER block or fail the order action,
// so every call is wrapped and returns a boolean instead of throwing.

const ENDPOINT = "https://emailmarketing-iota.vercel.app/send-mail";
export const MARKETING_EMAIL = "marketing.starlinkjewels@gmail.com";

export async function sendMail(to: string, subject: string, html: string): Promise<boolean> {
  if (!to || !to.includes("@")) return false;
  try {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ to, subject, html }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/* ───────────────────────── Branded template shell ───────────────────────── */

const BRAND = "#B0755C";
const GOLD = "#C8A24B";
const INK = "#1B2A4A";
const MUTED = "#6b7280";
const BG = "#F4F6FB";

/** Wrap body content in a consistent, email-client-safe branded layout. */
function shell(opts: { preheader: string; accent?: string; heading: string; intro: string; body: string; cta?: { label: string; url: string } }): string {
  const accent = opts.accent || BRAND;
  return `
  <div style="margin:0;padding:0;background:${BG};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
    <span style="display:none!important;opacity:0;color:${BG};height:0;width:0;overflow:hidden;">${opts.preheader}</span>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${BG};padding:24px 12px;">
      <tr><td align="center">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 1px 3px rgba(16,24,40,.08);">
          <!-- Header -->
          <tr><td style="background:${INK};padding:22px 28px;">
            <div style="font-size:20px;font-weight:800;letter-spacing:3px;color:#ffffff;">STARLINK <span style="color:${GOLD};">JEWELS</span></div>
            <div style="font-size:11px;letter-spacing:2px;color:#9fb0d0;margin-top:2px;">FINE DIAMOND JEWELRY</div>
          </td></tr>
          <!-- Accent bar -->
          <tr><td style="height:4px;background:${accent};font-size:0;line-height:0;">&nbsp;</td></tr>
          <!-- Body -->
          <tr><td style="padding:32px 28px;">
            <h1 style="margin:0 0 8px;font-size:22px;line-height:1.3;color:${INK};font-weight:700;">${opts.heading}</h1>
            <p style="margin:0 0 20px;font-size:15px;line-height:1.6;color:${MUTED};">${opts.intro}</p>
            ${opts.body}
            ${opts.cta ? `
            <div style="margin:26px 0 4px;">
              <a href="${opts.cta.url}" style="display:inline-block;background:${accent};color:#ffffff;text-decoration:none;font-size:14px;font-weight:600;padding:12px 26px;border-radius:10px;">${opts.cta.label}</a>
            </div>` : ""}
          </td></tr>
          <!-- Footer -->
          <tr><td style="padding:20px 28px;border-top:1px solid #eef1f6;">
            <p style="margin:0;font-size:12px;line-height:1.6;color:#9aa3b2;">This is an automated message from Flenix Jewels. Please do not reply directly to this email.</p>
            <p style="margin:6px 0 0;font-size:12px;color:#9aa3b2;">© ${brandYear()} Flenix Jewels · Fine Diamond Jewelry</p>
          </td></tr>
        </table>
      </td></tr>
    </table>
  </div>`;
}

// Year without relying on side-effectful Date at module scope elsewhere.
function brandYear(): number {
  return new Date().getFullYear();
}

/** A clean key/value detail table for order info. */
function detailRows(rows: [string, string][]): string {
  const cells = rows
    .filter(([, v]) => v != null && v !== "")
    .map(
      ([k, v]) =>
        `<tr>
          <td style="padding:9px 0;font-size:13px;color:${MUTED};width:42%;vertical-align:top;">${k}</td>
          <td style="padding:9px 0;font-size:14px;color:${INK};font-weight:600;">${v}</td>
        </tr>`,
    )
    .join("");
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #eef1f6;border-radius:12px;padding:6px 16px;background:#fbfcfe;">${cells}</table>`;
}

const esc = (s: unknown) => String(s ?? "").replace(/[<>&]/g, c => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c]!));

/* ───────────────────────── The three emails ───────────────────────── */

export interface OrderEmailInfo {
  orderNumber: string;
  clientName: string;
  jewelleryType?: string;
  metal?: string;
  quantity?: number;
  expectedDelivery?: string;
}

/** 1 — a new order was received → to the marketing inbox. */
export function orderReceivedEmail(o: OrderEmailInfo): { subject: string; html: string } {
  return {
    subject: `New Order Received — ${o.orderNumber}`,
    html: shell({
      preheader: `New order ${o.orderNumber} from ${o.clientName}`,
      heading: "New Order Received",
      intro: `A new order has just been placed and is waiting for your review and approval.`,
      body: detailRows([
        ["Order Number", esc(o.orderNumber)],
        ["Client", esc(o.clientName)],
        ["Jewellery Type", esc(o.jewelleryType)],
        ["Metal", esc(o.metal)],
        ["Quantity", o.quantity ? esc(o.quantity) : ""],
        ["Expected Delivery", esc(o.expectedDelivery)],
      ]),
    }),
  };
}

/** 2 — the order was approved → to the client. */
export function orderApprovedEmail(o: OrderEmailInfo): { subject: string; html: string } {
  return {
    subject: `Your Order ${o.orderNumber} is Approved`,
    html: shell({
      accent: "#1f9d55",
      preheader: `Good news — order ${o.orderNumber} is approved and in production`,
      heading: "Your Order is Approved ✓",
      intro: `Dear ${esc(o.clientName)},<br/>Thank you for your order. We're pleased to let you know it has been <b>approved</b> and is now moving into production. We'll keep you updated at each step.`,
      body: detailRows([
        ["Order Number", esc(o.orderNumber)],
        ["Jewellery Type", esc(o.jewelleryType)],
        ["Metal", esc(o.metal)],
        ["Quantity", o.quantity ? esc(o.quantity) : ""],
        ["Expected Delivery", esc(o.expectedDelivery)],
      ]),
    }),
  };
}

export interface DispatchEmailInfo extends OrderEmailInfo {
  courierName?: string;
  trackingNumber?: string;
  trackingLink?: string;
}

export interface ClientLoginEmailInfo {
  companyName: string;
  email: string;
  at: string; // ISO
}

/** 3.5 — a client just signed into the portal → to the marketing inbox, so
 *  staff notice engagement (or the lack of it) without watching the app. */
export function clientLoginEmail(o: ClientLoginEmailInfo): { subject: string; html: string } {
  const when = new Date(o.at).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });
  return {
    subject: `Client Login — ${o.companyName}`,
    html: shell({
      preheader: `${o.companyName} just logged into the portal`,
      heading: "Client Logged In",
      intro: `${esc(o.companyName)} just signed into the Flenix Jewels portal.`,
      body: detailRows([
        ["Client", esc(o.companyName)],
        ["Login Email", esc(o.email)],
        ["Time", esc(when)],
      ]),
    }),
  };
}

/** 3 — the order was dispatched → to the client, with courier/tracking. */
export function orderDispatchedEmail(o: DispatchEmailInfo): { subject: string; html: string } {
  return {
    subject: `Your Order ${o.orderNumber} has been Dispatched`,
    html: shell({
      accent: "#B0755C",
      preheader: `Order ${o.orderNumber} is on its way`,
      heading: "Your Order is on its Way 🚚",
      intro: `Dear ${esc(o.clientName)},<br/>Your order has been <b>dispatched</b> and is on its way to you. Use the details below to track your shipment.`,
      body: detailRows([
        ["Order Number", esc(o.orderNumber)],
        ["Courier", esc(o.courierName)],
        ["Tracking Number", esc(o.trackingNumber)],
      ]),
      cta: o.trackingLink ? { label: "Track Your Shipment", url: o.trackingLink } : undefined,
    }),
  };
}
