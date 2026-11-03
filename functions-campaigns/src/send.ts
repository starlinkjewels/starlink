// One campaign email, to one person: drawn for them (their name, their own
// unsubscribe link), with the one-click unsubscribe headers mail programs show
// as "Unsubscribe" (RFC 8058 — Gmail and Yahoo ask it of bulk senders), a
// plain-text part, and sent through this app's own mailbox — one at a time.
// What Gmail answers decides what happens next: sent, try later (it asked to
// slow down, or the day's quota is spent), or this address is no good (a
// bounce — kept off every list).
import { createTransport, type Transporter } from "nodemailer";
import { defineSecret } from "firebase-functions/params";
import { fillMerge, renderCampaign, type RenderCtx } from "./shared/campaignEmail";
import { type CampaignSettings, unsubToken } from "./core";
import { APP_URL, BRAND, REGION, SMTP_USER } from "./region";

/** The mailbox's app password — the same one every email of this app uses (functions/src/mail.ts). */
export const SMTP_PASSWORD = defineSecret("SMTP_PASSWORD");

export const fnUrl = (name: string) => {
  const project = process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT || "";
  if (process.env.FUNCTIONS_EMULATOR === "true") return `http://127.0.0.1:5001/${project}/${REGION}/${name}`;
  return `https://${REGION}-${project}.cloudfunctions.net/${name}`;
};

let pooled: Transporter | null = null;
/** One connection, kept for a run of sends — never more than one email in flight. */
export function transport(): Transporter {
  return (pooled ??= createTransport({
    pool: true, maxConnections: 1, maxMessages: 100,
    host: "smtp.gmail.com", port: 465, secure: true,
    // Well inside a run's minute: a mailbox that stops answering ends the run, never the function's time limit.
    connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 20_000,
    auth: { user: SMTP_USER, pass: SMTP_PASSWORD.value().replace(/\s+/g, "") },
  }));
}
export function closeTransport(): void {
  pooled?.close();
  pooled = null;
}

export interface Person { email: string; name?: string; company?: string; kind: "client" | "employee" }

export const varsOf = (p: Pick<Person, "name" | "company">) => ({
  first_name: (p.name ?? "").trim().split(/\s+/)[0] || undefined,
  name: (p.name ?? "").trim() || undefined,
  company: (p.company ?? "").trim() || undefined,
});

/** Why this person gets it — every email says so. */
export const reasonOf = (kind: Person["kind"], fromName: string) =>
  kind === "client" ? `You're receiving this as a client of ${fromName}.` : `You're receiving this as a member of the ${fromName} team.`;

export async function draw(c: { id: string; subject: string; preheader: string; design: unknown }, s: CampaignSettings, p: Person, opts: { test?: boolean } = {}) {
  // Clients get their own unsubscribe link (a marketing email); a team email is internal.
  const unsub = p.kind === "client" && !opts.test ? `${fnUrl("campaignUnsub")}?t=${await unsubToken(c.id, p.email)}` : undefined;
  const ctx: RenderCtx = {
    brandName: s.fromName || BRAND.name, logoUrl: s.logoUrl, logoWidth: s.logoWidth, address: s.address, contact: s.contact,
    reason: opts.test ? "This is a test — the real email shows who it is for here, and a one-click unsubscribe link for clients." : reasonOf(p.kind, s.fromName || BRAND.name),
    unsubscribeUrl: unsub, vars: varsOf(p), preheader: c.preheader, subject: c.subject,
    ...(opts.test ? { banner: "TEST EMAIL — only you got this. Nothing has been sent to anyone else." } : {}),
  };
  const r = renderCampaign(c.design, ctx);
  const subject = `${opts.test ? "[TEST] " : ""}${fillMerge(c.subject, ctx.vars)}`.replace(/[\r\n]+/g, " ").slice(0, 200);
  return { ...r, subject, unsub };
}

export type SendOutcome =
  | { ok: true; messageId?: string }
  /** Gmail refused it for now — nothing was sent; try later (slow down / quota spent / connection). */
  | { ok: false; retry: true; pauseAll: boolean; why: string; quota?: boolean }
  /** This address can't take it — a bounce; kept off every list. */
  | { ok: false; retry: false; bounce: boolean; why: string }
  /** It may or may not have gone (the connection dropped mid-way) — never sent again by itself. */
  | { ok: false; retry: false; bounce: false; unsure: true; why: string };

/** Gmail's answer, sorted. Only answers that say "not sent" are ever tried again. */
export function classify(err: unknown): SendOutcome {
  const e = err as { responseCode?: number; response?: string; code?: string; command?: string; message?: string };
  const text = `${e.response ?? ""} ${e.message ?? ""}`.slice(0, 300);
  const code = e.responseCode ?? 0;
  // A reply code from Gmail means it answered — the email was NOT taken (it is only taken on 250).
  if (code >= 500 && /5\.4\.5|quota|limit exceeded/i.test(text)) return { ok: false, retry: true, pauseAll: true, quota: true, why: "The mailbox's daily sending limit is reached — it carries on tomorrow" };
  if (e.code === "EAUTH" || code === 535 || code === 534) return { ok: false, retry: true, pauseAll: true, why: "The mailbox refused the password — check the app password" };
  if (code >= 400 && code < 500) return { ok: false, retry: true, pauseAll: true, why: `Gmail asked to slow down (${code})` };
  // 5.7.x from Gmail is about the sender (policy, a blocked or suspended account) — not this address: everything waits.
  if (code >= 500 && /\b5\.7\.\d+\b/.test(text)) return { ok: false, retry: true, pauseAll: true, why: `Gmail refused to send it (${code} ${(/\b5\.7\.\d+\b/.exec(text) ?? [""])[0]}) — check the mailbox` };
  if (code >= 550 && code < 560) return { ok: false, retry: false, bounce: /\b5\.1\.\d+\b|user unknown|does not exist|no such user|invalid recipient|mailbox unavailable/i.test(text), why: `Refused for this address (${code})` };
  if (code >= 500) return { ok: false, retry: false, bounce: false, why: `Refused (${code})` };
  // Couldn't even reach it (no address, refused at the door): nothing was sent.
  if (["ECONNREFUSED", "ENOTFOUND", "EDNS"].includes(e.code ?? "")) return { ok: false, retry: true, pauseAll: true, why: "Couldn't reach the mailbox — everything waits a few minutes" };
  // The connection broke (reset, timed out) — that can happen after the email was handed over:
  // "unsure", never sent again by itself (the mailbox was checked just before the run).
  return { ok: false, retry: false, bounce: false, unsure: true, why: `The connection broke while sending — it may have arrived: ${text.trim() || e.code || "unknown"}`.slice(0, 200) };
}

export async function sendTo(c: { id: string; subject: string; preheader: string; design: unknown }, s: CampaignSettings, p: Person, opts: { test?: boolean } = {}): Promise<SendOutcome> {
  const m = await draw(c, s, p, opts);
  const headers: Record<string, string> = {
    // Gmail Postmaster Tools groups mail by this: the campaign, its kind, the sender.
    "Feedback-ID": `${c.id.slice(0, 30)}:${opts.test ? "test" : p.kind}:campaign:${(new URL(APP_URL).hostname).slice(0, 40)}`,
  };
  if (m.unsub) {
    headers["List-Unsubscribe"] = `<${m.unsub}>, <mailto:${SMTP_USER}?subject=unsubscribe>`;
    headers["List-Unsubscribe-Post"] = "List-Unsubscribe=One-Click";
  }
  if (process.env.FUNCTIONS_EMULATOR === "true") {
    // Local tests: written to the outbox instead of sent (as functions/src/mail.ts does).
    const { db } = await import("./core");
    await db.collection("outbox").add({ to: p.email, subject: m.subject, html: m.html, text: m.text, headers, campaignId: c.id, at: new Date().toISOString() });
    if (/^bounce\+/.test(p.email)) return classify({ responseCode: 550, response: "550 5.1.1 The email account that you tried to reach does not exist" });
    if (/^slow\+/.test(p.email)) return classify({ responseCode: 421, response: "421 4.7.28 rate limited" });
    return { ok: true, messageId: `local-${Date.now()}` };
  }
  try {
    const info = await transport().sendMail({
      from: { name: s.fromName || BRAND.name, address: SMTP_USER }, to: p.name ? { name: p.name.replace(/["\r\n<>]/g, "").slice(0, 80), address: p.email } : p.email,
      ...(s.replyTo ? { replyTo: s.replyTo } : {}), subject: m.subject, html: m.html, text: m.text, headers,
    });
    // Accepted for some addresses but not this one: the address was refused.
    if (info.rejected?.length) return { ok: false, retry: false, bounce: false, why: "Refused for this address" };
    return { ok: true, messageId: info.messageId };
  } catch (e) {
    return classify(e);
  }
}
