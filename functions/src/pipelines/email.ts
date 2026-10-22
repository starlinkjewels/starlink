// The email a pipeline sends — the same information-only layout as the app's
// own emails (src/lib/email.ts): logo on white, a label, the heading, the words,
// the details, a quiet footer. No buttons, no links.
import { BRAND, APP_URL } from "./config";
import { balanceOf, fmtDay, fmtUsd, orderTotalOf, paidOf, pieceText, currentStage, type Ctx, type EmailBlock, type OrderLike } from "../shared/pipelines";

export const esc = (s: unknown) => String(s ?? "").replace(/[<>&"]/g, c => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" }[c]!));
/** The words as typed, safe, with their line breaks. */
const para = (t: string) => esc(t).replace(/\r?\n/g, "<br>");

function rows(list: [string, string | number | undefined | null][]): string {
  const cells = list.filter(([, v]) => v != null && v !== "").map(([k, v], i) =>
    `<tr><td style="padding:10px 0;${i ? `border-top:1px solid ${BRAND.line_};` : ""}font-size:14px;color:${BRAND.muted};width:42%;vertical-align:top;">${esc(k)}</td>
     <td style="padding:10px 0;${i ? `border-top:1px solid ${BRAND.line_};` : ""}font-size:14px;color:${BRAND.ink};font-weight:600;text-align:right;">${esc(v)}</td></tr>`).join("");
  return cells ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid ${BRAND.line_};border-bottom:1px solid ${BRAND.line_};margin:10px 0;">${cells}</table>` : "";
}

const orderRows = (o: OrderLike): [string, string | number | undefined][] => [
  ["Order", o.orderNumber], ["Piece", pieceText(o)], ["Design", o.designNumber],
  ["Pieces", o.quantity ? `${o.quantity}` : undefined], ["Stage", currentStage(o)], ["Due", fmtDay(o.expectedDelivery)],
];

function jobSheet(o: OrderLike): string {
  const st = o.stoneSpec;
  return rows([
    ["Order", o.orderNumber], ["Design", o.designNumber], ["Jewellery", o.jewelleryType], ["Metal", [o.productKarats, o.metal].filter(Boolean).join(" ")],
    ["Colour", o.productColor], ["Size", o.productSize], ["Pieces", o.quantity],
    ["Diamonds (est.)", o.diamondWeight ? `${o.diamondWeight} ct${o.diamondType ? ` · ${o.diamondType}` : ""}` : undefined],
    ["Stones", st ? [st.stone, st.shape, st.mm || st.size, st.color, st.clarity].filter(Boolean).join(" · ") : undefined],
    ["Net weight (est.)", o.estimatedNetWeight ? `${o.estimatedNetWeight} g` : undefined],
    ["Due", fmtDay(o.expectedDelivery)], ["Instructions", o.instructions],
  ]) + ((o.images ?? []).length
    ? `<p style="margin:12px 0 6px;font-size:13px;color:${BRAND.muted};">Reference images</p>${(o.images ?? []).slice(0, 3).map(u => `<img src="${esc(u)}" alt="" width="160" style="width:160px;max-width:31%;border:1px solid ${BRAND.line_};border-radius:8px;margin:0 6px 6px 0;" />`).join("")}`
    : "");
}

function listTable(list: OrderLike[], c: Ctx, hideMoney: boolean): string {
  if (!list.length) return `<p style="font-size:14px;color:${BRAND.muted};">Nothing in the list today.</p>`;
  const head = ["Order", "Piece", "Stage", "Due", ...(hideMoney ? [] : ["To pay"])].map(h => `<th align="left" style="padding:8px 6px;font-size:12px;color:${BRAND.muted};border-bottom:1px solid ${BRAND.line_};">${h}</th>`).join("");
  const body = list.slice(0, 80).map(o => {
    const late = o.expectedDelivery && +new Date(`${o.expectedDelivery.slice(0, 10)}T23:59:59+05:30`) < +new Date(c.now);
    return `<tr>${[o.orderNumber, pieceText(o), currentStage(o), `${fmtDay(o.expectedDelivery)}${late ? " (late)" : ""}`, ...(hideMoney ? [] : [balanceOf(o) ? fmtUsd(balanceOf(o)) : "—"])]
      .map(v => `<td style="padding:8px 6px;font-size:13px;color:${BRAND.ink};border-bottom:1px solid ${BRAND.line_};">${esc(v)}</td>`).join("")}</tr>`;
  }).join("");
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:10px 0;"><tr>${head}</tr>${body}</table>${list.length > 80 ? `<p style="font-size:12px;color:${BRAND.muted};">and ${list.length - 80} more</p>` : ""}`;
}

/**
 * The body blocks an email step asked for. `hideMoney`: it goes to a factory —
 * what clients pay and owe is never shown to them.
 */
export function blocksHtml(blocks: EmailBlock[], c: Ctx, hideMoney = false): string {
  const o = c.order;
  return blocks.map(b => {
    if (b === "order" && o) return rows(orderRows(o));
    if (b === "jobSheet" && o) return jobSheet(o);
    if (b === "money" && o && !hideMoney) return rows([["Order", o.orderNumber], ["Order total", fmtUsd(orderTotalOf(o))], ["Paid", fmtUsd(paidOf(o))], ["Still to pay", fmtUsd(balanceOf(o))]]);
    if (b === "list") return listTable(c.list ?? [], c, hideMoney);
    return "";
  }).join("");
}

/** The whole email. */
export function emailHtml(o: { subject: string; text: string; body: string; label?: string; test?: boolean }): string {
  const logo = `<img src="${APP_URL}${BRAND.logo}" alt="${esc(BRAND.name)}" height="40" style="display:block;height:40px;width:auto;border:0;font-size:18px;font-weight:700;color:${BRAND.ink};" />`;
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(o.subject)}</title></head>
<body style="margin:0;padding:0;background:${BRAND.page};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${BRAND.page};"><tr><td align="center" style="padding:28px 12px;">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background:#ffffff;border:1px solid ${BRAND.line_};border-radius:12px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
<tr><td style="padding:24px 32px 20px;border-bottom:1px solid ${BRAND.line_};">${logo}</td></tr>
<tr><td style="padding:24px 32px 8px;">
${o.test ? `<p style="margin:0 0 12px;padding:8px 12px;border-radius:8px;background:#FEF3C7;color:#92400E;font-size:13px;font-weight:600;">TEST — sent only to you, to check this pipeline. Nobody else received it.</p>` : ""}
<h1 style="margin:0 0 10px;font-size:20px;line-height:1.35;font-weight:700;color:${BRAND.ink};">${esc(o.subject)}</h1>
<p style="margin:0;font-size:15px;line-height:1.65;color:#374151;">${para(o.text)}</p>
${o.body}
</td></tr>
<tr><td style="padding:20px 32px 26px;"><p style="margin:0;padding-top:16px;border-top:1px solid ${BRAND.line_};font-size:12px;line-height:1.6;color:${BRAND.muted};">${esc(BRAND.name)}${BRAND.line ? ` · ${esc(BRAND.line)}` : ""}</p></td></tr>
</table></td></tr></table></body></html>`;
}
