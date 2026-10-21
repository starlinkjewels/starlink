import type { Order, Client, Settings, DB } from "./db";
import { totalAdvance, orderTotal, balanceDue, returnedCredit, returnedQty, logEvent, loadDb, isDiamondOnlyOrder, certStoneLines } from "./db";
import { hasDiamonds, stoneOf } from "./orderText";
import { brandForDocument, MAIN_COMPANY_ID, type BrandSettings } from "./companies";
import { exportAllowed } from "./access";
import { getBrand, brandName, BUILTIN } from "./brand";

function dd(n: number) { return String(n).padStart(2, "0"); }
function localDate(iso: string) {
  const d = new Date(iso);
  return `${dd(d.getDate())}/${dd(d.getMonth() + 1)}/${d.getFullYear()}`;
}
/** Format a "YYYY-MM-DD" date-only string (no Date/timezone conversion needed). */
function localDateStr(dateStr: string) {
  const [y, m, day] = dateStr.split("-");
  return `${day}/${m}/${y}`;
}
function usd(n: number) {
  return "$" + n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

/**
 * Invoice line description, in the exact order the client asked for:
 *   gold karat · gold colour · main diamond shape · item · size
 *   e.g. "14KT WG Round Ring US-7"
 * Anything unknown is simply left out, so a silver or diamond-only piece still
 * reads cleanly. `mainShape` comes from mainDiamondShape() at the call site.
 */
function itemDescription(order: Order, mainShape?: string): string {
  // A loose sale is described by its stones — there is no metal or size. Gems
  // by their own name: an emerald sale never prints as "loose diamonds".
  if (isDiamondOnlyOrder(order)) {
    const sp = order.stoneSpec ?? {};
    const stone = stoneOf(order);
    const what = stone === "Diamond" ? [order.diamondType, "loose diamonds"] : [hasDiamonds(stone) ? order.diamondType : "", "loose", stone];
    return [...what, sp.shape || mainShape, sp.mm || sp.size, sp.color, sp.clarity]
      .filter(Boolean).join(" ").toUpperCase();
  }
  // 14K -> 14KT
  const karat = order.productKarats ? order.productKarats.trim().toUpperCase().replace(/K$/, "KT") : "";

  // WG / YG / RG — from the chosen colour, else inferred from the metal.
  const colourSrc = order.productColor || order.metal || "";
  const colour = /white/i.test(colourSrc) ? "WG"
    : /rose|pink/i.test(colourSrc) ? "RG"
    : /yellow/i.test(colourSrc) ? "YG"
    : "";

  // Non-gold metals are named outright instead of a karat/colour pair.
  const otherMetal = /platinum/i.test(order.metal) ? "PT" : /silver/i.test(order.metal) ? "SILVER" : "";

  // Ring sizes are quoted US-x unless the size already says so.
  const rawSize = (order.productSize ?? "").trim();
  const size = !rawSize ? ""
    : /^(us|uk|eu)\b|-/i.test(rawSize) ? rawSize.toUpperCase()
    : /ring/i.test(order.jewelleryType) ? `US-${rawSize}`
    : rawSize;

  const line = [karat || otherMetal, karat ? colour : "", mainShape, order.jewelleryType, size]
    .filter(Boolean)
    .join(" ");
  return line || `${order.jewelleryType} - ${order.metal}`.toUpperCase();
}

/** Each certified stone of the order on its own small line under the item — lab, report number, grading. */
function stonesHtml(stones: string[]): string {
  return stones.map(t => `<div style="font-size:9px;color:#333;margin-top:1px;">${esc(t)}</div>`).join("");
}

/**
 * An order's certified stones for its bill: read from the stone records when
 * this person can (staff), else as they were kept on the invoice when it was
 * raised (a client's own copy).
 */
function orderStones(orderId: string, invoiceNumber?: string): string[] {
  const d = loadDb();
  const live = certStoneLines(d, orderId);
  if (live.length) return live;
  const inv = invoiceNumber ? d.invoices.find(i => i.number === invoiceNumber) : undefined;
  return inv?.stones?.[orderId] ?? [];
}

function itemRowHtml(sr: number, order: Order, mainShape?: string, stones: string[] = []): string {
  const stockId = order.designNumber || order.orderNumber;
  const weight = order.diamondWeight ? `${order.diamondWeight}CT` : "—";
  const itemPrice = order.amount ? usd(order.amount) : "—";
  const itemTotal = order.amount ? usd(order.amount) : "—";
  return `<tr class="item-row">
        <td class="c">${sr}</td>
        <td class="c">${stockId}</td>
        <td class="l">${itemDescription(order, mainShape)}${stonesHtml(stones)}${returnedQty(order) > 0
          ? `<div style="font-size:9px;color:#b91c1c;margin-top:1px;">${returnedQty(order)} of ${order.quantity} returned — ${[...new Set((order.returns ?? []).map(r => r.creditNoteNo))].join(", ")}</div>` : ""}</td>
        <td class="c">${order.quantity}</td>
        <td class="c">${weight}</td>
        <td class="c">${itemPrice}</td>
        <td class="c">${itemTotal}</td>
      </tr>`;
}

const esc = (t: string) => t.replace(/[&<>"]/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch]!));

const BLANK_ROW = `<tr class="item-row"><td class="c">&nbsp;</td><td></td><td></td><td class="c"></td><td class="c"></td><td class="c"></td><td class="c"></td></tr>`;

/** Client-provided bank/wire details tables, uploaded as images (Settings → Invoice /
 *  Bill Settings) so they print pixel-exact instead of being recreated with HTML/CSS.
 *  Positioned with position:absolute (bottom-left of a wrapper around the items
 *  table — see buildInvoiceDoc) so it visually sits beside the totals box, in the
 *  blank space that's already there, WITHOUT being part of the table itself — it
 *  can never change a single row's height, no matter how tall the image is. */
function bankImagesHtml(settings: Settings): string {
  const imgs = [settings.bankDetailsImage1, settings.bankDetailsImage2].filter((s): s is string => !!s);
  if (!imgs.length && settings.invoiceBankText) {
    // A company with its wire details typed in rather than uploaded as a picture.
    return `<div style="position:absolute;left:0;bottom:0;max-width:260px;font-size:9.5px;line-height:1.45;white-space:pre-line;border:1px solid #ccc;padding:6px 8px;background:#fff;">${esc(settings.invoiceBankText)}</div>`;
  }
  if (!imgs.length) return "";
  return `<div style="position:absolute;left:0;bottom:0;display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end;">
    ${imgs.map(src => `<img src="${src}" style="max-width:190px;max-height:130px;object-fit:contain;" />`).join("\n    ")}
  </div>`;
}

/* Deposit/Balance rows only appear when they add information: a $0 balance or a
   deposit that equals the total is redundant with "Total Amount" above, so a
   fully-settled invoice just ends with Total Amount as the final line. */
function totalsRowsHtml(total: number, adv: number, bal: number, shipping: number, gift = 0, more: { certificate?: number; returned?: number; notes?: string[]; charges?: { name: string; amountUsd: number }[] } = {}): string {
  const shippingRow = shipping > 0 ? `
    <tr class="tot-row">
      <td colspan="4" class="blank"></td>
      <td colspan="2" class="tot-lbl">Shipping Charges</td>
      <td class="tot-val">${usd(shipping)}</td>
    </tr>` : "";

  const certificateRow = (more.certificate ?? 0) > 0 ? `
    <tr class="tot-row">
      <td colspan="4" class="blank"></td>
      <td colspan="2" class="tot-lbl">Certificate</td>
      <td class="tot-val">${usd(more.certificate!)}</td>
    </tr>` : "";

  // Named extra charges, each on its own line ("Setting charge", "Engraving"…).
  const chargeRows = (more.charges ?? []).filter(c => c.amountUsd > 0).map(c => `
    <tr class="tot-row">
      <td colspan="4" class="blank"></td>
      <td colspan="2" class="tot-lbl">${esc(c.name)}</td>
      <td class="tot-val">${usd(c.amountUsd)}</td>
    </tr>`).join("");

  // Pieces the client sent back — the credit note(s) that took them off.
  const returnedRow = (more.returned ?? 0) > 0 ? `
    <tr class="tot-row">
      <td colspan="4" class="blank"></td>
      <td colspan="2" class="tot-lbl">Less: Returned goods${more.notes?.length ? `<br/><span style="font-size:9px;">${more.notes.join(", ")}</span>` : ""}</td>
      <td class="tot-val">-${usd(more.returned!)}</td>
    </tr>` : "";

  const giftRow = gift > 0 ? `
    <tr class="tot-row">
      <td colspan="4" class="blank"></td>
      <td colspan="2" class="tot-lbl">Gift Card Redeemed</td>
      <td class="tot-val">-${usd(gift)}</td>
    </tr>` : "";

  const depositRow = adv > 0 && bal > 0 ? `
    <tr class="tot-row">
      <td colspan="4" class="blank"></td>
      <td colspan="2" class="tot-lbl">Deposit Payment</td>
      <td class="tot-val">${usd(adv)}</td>
    </tr>` : "";

  const balanceRow = bal > 0 ? `
    <tr class="tot-row">
      <td colspan="4" class="blank"></td>
      <td colspan="2" class="tot-lbl"><strong>Balance Due</strong></td>
      <td class="tot-val"><strong>${usd(bal)}</strong></td>
    </tr>` : "";

  return `
    ${shippingRow}
    ${certificateRow}${chargeRows}
    ${giftRow}
    ${returnedRow}
    <tr class="tot-row tot-bold">
      <td colspan="4" class="blank"></td>
      <td colspan="2" class="tot-lbl"><strong>Total Amount</strong></td>
      <td class="tot-val"><strong>${usd(total)}</strong></td>
    </tr>
    ${depositRow}
    ${balanceRow}`;
}

/** Shared invoice document shell — header, TO block, items table, footer, legal text. */
function buildInvoiceDoc(opts: {
  client: Client | undefined;
  settings: Settings;
  invoiceNumber: string;
  dateLabel: string;
  itemRows: string;
  totalsRows: string;
  /** Preview for an order that isn't billed yet — no invoice number is issued. */
  draft?: boolean;
  /** A credit note for returned goods, against `againstInvoice`. */
  credit?: { againstInvoice?: string };
}): string {
  const { client, settings, invoiceNumber, dateLabel, itemRows, totalsRows, draft, credit } = opts;
  // The first company prints as it always has, defaults and all; another
  // company prints only what it has been given.
  const isMain = ((settings as Partial<BrandSettings>).brandCompanyId ?? MAIN_COMPANY_ID) === MAIN_COMPANY_ID;

  /* QR / stamp placeholders — vertical rectangle so a QR-code-plus-logo image
     (Venmo, Zelle, etc.) scales proportionally instead of being squashed into a square. */
  const qr = (src?: string, label = "Upload QR") => src
    ? `<img src="${src}" style="width:88px;height:112px;display:block;margin:0 auto;object-fit:contain;" />`
    : `<div style="width:88px;height:112px;border:1.5px dashed #bbb;display:flex;align-items:center;justify-content:center;font-size:9px;color:#aaa;text-align:center;margin:0 auto;">${label}</div>`;

  const stampHtml = settings.invoiceStamp
    ? `<img src="${settings.invoiceStamp}" style="width:76px;height:76px;display:block;margin:4px auto;object-fit:contain;" />`
    : `<div style="width:76px;height:76px;border:1.5px dashed #bbb;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:9px;color:#aaa;text-align:center;margin:4px auto;">Upload Stamp</div>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<title></title>
<style>
  /* ── Reset ── */
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  /* ── Page: zero margins so browser adds NO header/footer text ── */
  @page {
    size: A4 portrait;
    margin: 0;
  }

  html, body {
    width: 210mm;
    min-height: 297mm;
    font-family: Arial, Helvetica, sans-serif;
    font-size: 11px;
    color: #111;
    background: #fff;
  }

  /* ── Content wrapper — provides the visual margins ── */
  .page {
    width: 210mm;
    min-height: 297mm;
    padding: 18mm 18mm 14mm 18mm;
  }

  /* ── Header ── */
  .hdr { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 12px; }
  .logo { height: 54px; width: auto; }
  .addr { text-align: right; font-size: 10px; line-height: 1.7; color: #222; }

  /* ── Dashed rule ── */
  .rule { border: none; border-top: 2px dashed #c0c0c0; margin: 8px 0 12px; }

  /* ── INVOICE title ── */
  .title { text-align: center; font-size: 17px; font-weight: bold; letter-spacing: 4px; margin-bottom: 14px; }

  /* ── TO / meta row ── */
  .inforow { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 14px; gap: 20px; }
  .to { font-size: 11px; line-height: 1.75; flex: 1; }
  .to .name { font-weight: bold; font-size: 11.5px; text-transform: uppercase; }
  .meta { border: 1px solid #333; font-size: 10.5px; min-width: 200px; }
  .meta table { width: 100%; border-collapse: collapse; }
  .meta td { padding: 5px 10px; }
  .meta td:first-child { white-space: nowrap; border-right: 1px solid #333; font-weight: bold; }
  .meta tr:not(:last-child) td { border-bottom: 1px solid #333; }
  .meta td:last-child { text-align: right; font-weight: bold; }

  /* ── Items + totals table ── */
  .items {
    width: 100%;
    border-collapse: collapse;
    margin-bottom: 0;
  }
  /* Header row */
  .items thead th {
    background: #b8cce4;
    border: 1px solid #7a9abf;
    padding: 6px 5px;
    text-align: center;
    font-size: 9.5px;
    font-weight: bold;
    text-transform: uppercase;
    letter-spacing: 0.4px;
    line-height: 1.3;
  }
  .items thead th.l { text-align: left; }

  /* Item rows */
  .items .item-row td {
    border: 1px solid #b0b0b0;
    padding: 4px 5px;
    font-size: 10.5px;
    height: 21px;
    vertical-align: middle;
  }
  .items .item-row td.c { text-align: center; }
  .items .item-row td.l { text-align: left; }

  /* Totals rows embedded inside items table */
  .items .tot-row td.blank {
    border: none;
    background: transparent;
  }
  .items .tot-row td.tot-lbl {
    border: 1px solid #b0b0b0;
    border-left: 1px solid #333;
    text-align: right;
    padding: 5px 10px;
    font-size: 10.5px;
    background: #fff;
  }
  .items .tot-row td.tot-val {
    border: 1px solid #b0b0b0;
    border-right: 1px solid #333;
    text-align: right;
    padding: 5px 10px;
    font-size: 10.5px;
    background: #fff;
    min-width: 72px;
  }
  .items .tot-bold td.tot-lbl,
  .items .tot-bold td.tot-val {
    font-size: 11px;
  }
  /* last totals row — strong bottom border */
  .items .tot-row:last-child td.tot-lbl,
  .items .tot-row:last-child td.tot-val {
    border-bottom: 1px solid #333;
  }
  /* first totals row — strong top border */
  .items .tot-row:first-child td.tot-lbl,
  .items .tot-row:first-child td.tot-val {
    border-top: 1px solid #333;
  }

  /* ── Footer three-col row — bottom-aligned so "Chop or signature." and
     "Chop & Authorized Signature" sit on the same line regardless of the
     taller QR/stamp column above them. ── */
  .footer {
    display: flex;
    justify-content: space-between;
    align-items: flex-end;
    margin-top: 20px;
    gap: 10px;
  }
  .f-left { flex: 1; }
  .f-mid { flex: 1; display: flex; gap: 12px; justify-content: center; align-items: flex-end; }
  .f-right { flex: 1; text-align: center; }

  .sig-line { border-top: 1px solid #333; width: 110px; margin-bottom: 4px; }
  .sig-text { font-size: 9.5px; }
  .qr-block { text-align: center; }
  .qr-lbl { font-size: 9px; font-weight: bold; letter-spacing: 0.5px; margin-bottom: 4px; }
  .qr-brand { font-size: 9px; font-style: italic; margin-top: 3px; color: #444; }
  .for-co { font-size: 10px; font-weight: bold; margin-bottom: 4px; }
  .auth { font-size: 9.5px; margin-top: 4px; }

  /* ── Legal ── */
  .legal {
    margin-top: 14px;
    font-size: 8.5px;
    color: #444;
    line-height: 1.65;
    font-style: italic;
  }

  /* ── Thank you ── */
  .thankyou {
    text-align: center;
    font-weight: bold;
    font-size: 13px;
    letter-spacing: 1px;
    margin-top: 12px;
    padding-top: 10px;
    border-top: 1px solid #ccc;
  }

  /* ── Print overrides ── */
  @media print {
    html, body { width: 210mm; }
    .page { padding: 14mm 16mm 12mm 16mm; }
  }
</style>
</head>
<body>
<div class="page">

  <!-- Header -->
  <div class="hdr">
    ${settings.companyLogoUrl || isMain
      ? `<img src="${esc(settings.companyLogoUrl || getBrand().logo || BUILTIN.wide || BUILTIN.logo)}" alt="${esc(settings.companyName || brandName())}" class="logo" />`
      // Another company with no logo yet prints its name — never the first company's logo.
      : `<div style="font-size:22px;font-weight:800;letter-spacing:1.5px;color:#2B2A29;line-height:1.1;max-width:60%;">${esc((settings.companyName || "").toUpperCase())}</div>`}
    <div class="addr">
      ${isMain
        ? `${settings.invoiceAddress1 || "55 JOHN ST"}<br/>${settings.invoiceAddress2 || "EAST RUTHERFORD"}<br/>${settings.invoiceAddress3 || "NEW JERSEY 07073"}<br/>`
        : [settings.invoiceAddress1, settings.invoiceAddress2, settings.invoiceAddress3].filter(Boolean).map(l => `${esc(l!)}<br/>`).join("")}
      ${settings.invoiceTel ? "Tel No: " + settings.invoiceTel + "<br/>" : ""}
      ${settings.invoicePrimary ? "Primary: " + settings.invoicePrimary + "<br/>" : ""}
      ${settings.invoiceEmail ? "Email: " + settings.invoiceEmail + (settings.invoiceWebsite || settings.invoiceTaxId ? "<br/>" : "") : ""}
      ${settings.invoiceWebsite ? esc(settings.invoiceWebsite) + (settings.invoiceTaxId ? "<br/>" : "") : ""}
      ${settings.invoiceTaxId ? `${esc(settings.invoiceTaxLabel || "Tax ID")}: ${esc(settings.invoiceTaxId)}` : ""}
    </div>
  </div>

  <hr class="rule"/>

  <div class="title">${credit ? "CREDIT NOTE" : draft ? "PROFORMA INVOICE" : "INVOICE"}</div>

  <!-- TO + Invoice meta -->
  <div class="inforow">
    <div class="to">
      <div class="name">TO: ${(client?.companyName || client?.ownerName || "").toUpperCase()}</div>
      ${client?.ownerName ? `<div>${client.ownerName}</div>` : ""}
      ${[client?.address, client?.zip, client?.country].filter(Boolean).length
        ? `<div>${[client?.address, client?.zip, client?.country].filter(Boolean).join(", ")}</div>`
        : ""}
      ${client?.phone || client?.email
        ? `<div>${[client?.phone ? `Tel: ${client.phone}` : "", client?.email ? `Email: ${client.email}` : ""].filter(Boolean).join("&nbsp;&nbsp;&nbsp;")}</div>`
        : ""}
    </div>
    <div class="meta">
      <table>
        <tr><td>${credit ? "Credit Note No:" : draft ? "Proforma" : "Invoice No:"}</td><td>${draft ? "NOT BILLED" : invoiceNumber}</td></tr>
        <tr><td>Date:</td><td>${dateLabel}</td></tr>
        ${credit
          ? `<tr><td>Against Invoice:</td><td>${credit.againstInvoice ? esc(credit.againstInvoice) : "—"}</td></tr>`
          : `<tr><td>Terms:</td><td>${settings.invoiceTerms || "COD"}</td></tr>`}
      </table>
    </div>
  </div>

  <!-- Items table + totals embedded. Wrapped in position:relative purely so the bank
       images (position:absolute, bottom-left) can anchor to this box's bottom-left
       corner — they are NOT part of the table and cannot change its row heights. -->
  <div style="position:relative;">
    <table class="items">
      <thead>
        <tr>
          <th style="width:42px">SR<br/>NO</th>
          <th style="width:64px">STOCK ID</th>
          <th class="l">DESCRIPTION</th>
          <th style="width:42px">PCS</th>
          <th style="width:64px">WEIGHT</th>
          <th style="width:88px">PRICE<br/>USD</th>
          <th style="width:70px">TOTAL</th>
        </tr>
      </thead>
      <tbody>
        ${itemRows}
        ${totalsRows}
      </tbody>
    </table>

    <!-- Bank / wire details (uploaded images, if set) — nothing to pay on a credit note -->
    ${credit ? "" : bankImagesHtml(settings)}
  </div>

  <!-- Footer -->
  <div class="footer">
    <div class="f-left">
      <div style="margin-top:48px;">
        <div class="sig-line"></div>
        <div class="sig-text">Chop or signature.</div>
      </div>
    </div>

    <div class="f-mid">
      ${credit ? "" : `<div class="qr-block">
        <div class="qr-lbl">SCAN TO PAY</div>
        ${qr(settings.invoiceQr1)}
      </div>
      <div class="qr-block">
        <div class="qr-lbl">SCAN TO PAY</div>
        ${qr(settings.invoiceQr2)}
      </div>`}
    </div>

    <div class="f-right">
      <div class="for-co">${esc(`${(settings.companyName || "SHREE SUKTAM DIAMOND").toUpperCase()} ${(settings.companyLegalSuffix ?? "").toUpperCase()}`.trim())}</div>
      ${stampHtml}
      <div class="auth">Chop &amp; Authorized Signature</div>
    </div>
  </div>

  <!-- Legal -->
  ${credit ? `<div class="legal">The goods listed above were returned to us. The credit amount comes off what is due on the invoice named above; anything already paid beyond it is held as your credit for future bills.</div>` : `<div class="legal">
    This Items Here in Invoiced Has Been Purchased from Legal Sources, Not Involved in Funding Conflict and In Compliance with United Nations Resolutions.<br/>
    The Seller Here by Guaranteed This Item Are Conflict Free and Not Involved in Any Money Laundering, Based On Personal Knowledge and Written Guarantied Provided By The Supplier of This Item.
  </div>`}

  <div class="thankyou">THANK YOU FOR YOUR BUSINESS</div>

</div>
<script>
  window.onload = function () { window.focus(); window.print(); };
</script>
</body>
</html>`;
}

function openAndPrint(html: string) {
  const w = window.open("", "_blank", "width=860,height=1120");
  if (!w) { alert("Please allow popups to print/download the invoice."); return; }
  w.document.open();
  w.document.write(html);
  w.document.close();
}

export function printInvoice(
  order: Order,
  client: Client | undefined,
  settings: Settings,
  invoiceNumber: string,
  mainShape?: string,
  draft?: boolean,
) {
  if (!exportAllowed()) return;
  logEvent("print", draft
    ? `Printed a proforma for ${order.orderNumber} — ${client?.companyName ?? "client"}`
    : `Printed invoice ${invoiceNumber} — ${order.orderNumber}, ${client?.companyName ?? "client"}`,
    { invoice: invoiceNumber, order: order.orderNumber });
  const adv = totalAdvance(order);
  const total = orderTotal(order);
  const bal = balanceDue(order);
  const shipping = order.shippingCharge || 0;
  const gift = order.giftCardRedeemed || 0;
  const more = { certificate: order.certificateFee || 0, returned: returnedCredit(order), notes: [...new Set((order.returns ?? []).map(r => r.creditNoteNo))], charges: order.otherCharges ?? [] };

  /* ── 10 item rows then totals rows embedded inside same table ── */
  const ITEM_ROWS = 10;
  const itemRows = Array.from({ length: ITEM_ROWS }, (_, i) => i === 0 ? itemRowHtml(1, order, mainShape, orderStones(order.id, invoiceNumber)) : BLANK_ROW).join("\n");

  // A raised invoice prints as the company that issued it; a proforma as the
  // company the client buys from.
  const brand = brandForDocument(loadDb(), { clientId: client?.id ?? order.clientId, invoiceNumber: draft ? undefined : invoiceNumber });
  const html = buildInvoiceDoc({
    client, settings: brand, invoiceNumber, draft,
    dateLabel: localDate(order.createdAt),
    itemRows,
    totalsRows: totalsRowsHtml(total, adv, bal, shipping, gift, more),
  });
  openAndPrint(html);
}

/**
 * Combined invoice for every order dispatched on one day, for one client —
 * one line item per order, totals summed across all of them. Used for the
 * "Download Invoice" button on the Invoices page (date + client filter).
 */
export function printBatchInvoice(
  orders: Order[],
  client: Client | undefined,
  settings: Settings,
  invoiceNumber: string,
  dateStr: string, // "YYYY-MM-DD"
  mainShapes?: Record<string, string>, // orderId -> main diamond shape
) {
  if (!exportAllowed()) return;
  logEvent("print", `Printed invoice ${invoiceNumber} — ${client?.companyName ?? "client"}, ${orders.length} order${orders.length !== 1 ? "s" : ""}`, { invoice: invoiceNumber });
  const adv = orders.reduce((s, o) => s + totalAdvance(o), 0);
  const total = orders.reduce((s, o) => s + orderTotal(o), 0);
  const bal = orders.reduce((s, o) => s + balanceDue(o), 0);
  const shipping = orders.reduce((s, o) => s + (o.shippingCharge || 0), 0);
  const gift = orders.reduce((s, o) => s + (o.giftCardRedeemed || 0), 0);
  const more = {
    certificate: orders.reduce((s, o) => s + (o.certificateFee || 0), 0),
    // The same charge on several orders is one line, added up.
    charges: [...orders.flatMap(o => o.otherCharges ?? []).reduce((m, c) => m.set(c.name, Math.round(((m.get(c.name) ?? 0) + c.amountUsd) * 100) / 100), new Map<string, number>())]
      .map(([name, amountUsd]) => ({ name, amountUsd })),
    returned: Math.round(orders.reduce((s, o) => s + returnedCredit(o), 0) * 100) / 100,
    notes: [...new Set(orders.flatMap(o => (o.returns ?? []).map(r => r.creditNoteNo)))].sort(),
  };

  // Always keep a few blank rows after the real ones — the bank-detail images are
  // absolutely positioned over this space (see bankImagesHtml), so with too many
  // orders and zero blank rows left, the images would overlap real item rows.
  const ITEM_ROWS = Math.max(10, orders.length + 4);
  const itemRows = Array.from({ length: ITEM_ROWS }, (_, i) =>
    i < orders.length ? itemRowHtml(i + 1, orders[i], mainShapes?.[orders[i].id], orderStones(orders[i].id, invoiceNumber)) : BLANK_ROW
  ).join("\n");

  const brand = brandForDocument(loadDb(), { clientId: client?.id ?? orders[0]?.clientId, invoiceNumber });
  const html = buildInvoiceDoc({
    client, settings: brand, invoiceNumber,
    dateLabel: localDateStr(dateStr),
    itemRows,
    totalsRows: totalsRowsHtml(total, adv, bal, shipping, gift, more),
  });
  openAndPrint(html);
}

/**
 * The credit note for a sales return — every returned piece on it (one note
 * can cover several orders of one client), and what it does to the bill.
 */
export function printCreditNote(db: DB, noteId: string, mainShapes?: Record<string, string>) {
  if (!exportAllowed()) return;
  const lines: { order: Order; ret: NonNullable<Order["returns"]>[number] }[] = [];
  for (const o of db.orders) for (const r of o.returns ?? []) if (r.noteId === noteId) lines.push({ order: o, ret: r });
  if (!lines.length) return;
  const first = lines[0];
  const client = db.clients.find(c => c.id === first.order.clientId);
  const inv = first.ret.invoiceId ? db.invoices.find(i => i.id === first.ret.invoiceId) : undefined;
  const no = first.ret.creditNoteNo;
  logEvent("print", `Printed credit note ${no} — ${client?.companyName ?? "client"}`, { creditNote: no });
  const r2 = (n: number) => Math.round(n * 100) / 100;
  const sum = (f: (r: typeof first.ret) => number) => r2(lines.reduce((s, l) => s + f(l.ret), 0));
  const rows = lines.map((l, i) => {
    const o = l.order, r = l.ret;
    const per = o.quantity || 1;
    const ct = o.diamondWeight ? Math.round(o.diamondWeight * r.qty / per * 1000) / 1000 : 0;
    return `<tr class="item-row">
        <td class="c">${i + 1}</td>
        <td class="c">${o.designNumber || o.orderNumber}</td>
        <td class="l">${itemDescription(o, mainShapes?.[o.id])}<div style="font-size:9px;color:#555;margin-top:1px;">Order ${o.orderNumber}${r.reason ? ` — ${esc(r.reason)}` : ""}</div></td>
        <td class="c">${r.qty}</td>
        <td class="c">${ct ? `${ct}CT` : "—"}</td>
        <td class="c">${usd(r2(r.valueUsd / r.qty))}</td>
        <td class="c">${usd(r.valueUsd)}</td>
      </tr>`;
  });
  const ITEM_ROWS = Math.max(8, lines.length + 3);
  const itemRows = Array.from({ length: ITEM_ROWS }, (_, i) => rows[i] ?? BLANK_ROW).join("\n");
  const row = (label: string, value: string, bold = false) => `
    <tr class="tot-row${bold ? " tot-bold" : ""}">
      <td colspan="4" class="blank"></td>
      <td colspan="2" class="tot-lbl">${bold ? `<strong>${label}</strong>` : label}</td>
      <td class="tot-val">${bold ? `<strong>${value}</strong>` : value}</td>
    </tr>`;
  const value = sum(r => r.valueUsd), gift = sum(r => r.giftBackUsd || 0), ship = sum(r => (r.shippingBackUsd || 0) + (r.certificateBackUsd || 0));
  const fee = sum(r => r.feeUsd || 0), cb = sum(r => r.cashbackChargedUsd || 0), creditTotal = sum(r => r.creditUsd), toCredit = sum(r => r.toCreditUsd || 0);
  const totalsRows = [
    row("Goods returned", usd(value)),
    gift > 0 ? row("Gift card share (back on the card)", `-${usd(gift)}`) : "",
    ship > 0 ? row("Shipping &amp; certificate refunded", usd(ship)) : "",
    fee > 0 ? row("Return charge", `-${usd(fee)}`) : "",
    cb > 0 ? row("Cashback already used", `-${usd(cb)}`) : "",
    row("Credit Amount", usd(creditTotal), true),
    toCredit > 0 ? row("Already paid — held as your credit", usd(toCredit)) : "",
  ].join("");
  const brand = brandForDocument(db, { clientId: client?.id ?? first.order.clientId, invoiceId: inv?.id });
  const html = buildInvoiceDoc({
    client, settings: brand, invoiceNumber: no,
    dateLabel: localDate(first.ret.at),
    itemRows, totalsRows,
    credit: { againstInvoice: inv?.number },
  });
  openAndPrint(html);
}
