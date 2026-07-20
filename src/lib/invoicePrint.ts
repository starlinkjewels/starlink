import type { Order, Client, Settings } from "./db";
import { totalAdvance, orderTotal, balanceDue } from "./db";

function dd(n: number) { return String(n).padStart(2, "0"); }
function localDate(iso: string) {
  const d = new Date(iso);
  return `${dd(d.getDate())}/${dd(d.getMonth() + 1)}/${d.getFullYear()}`;
}
function usd(n: number) {
  return "$" + n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

export function printInvoice(
  order: Order,
  client: Client | undefined,
  settings: Settings,
  invoiceNumber: string,
) {
  const adv      = totalAdvance(order);
  const total    = orderTotal(order);
  const bal      = balanceDue(order);
  const shipping = order.shippingCharge || 0;

  const description = [
    order.productKarats,
    order.jewelleryType.toUpperCase(),
    order.metal !== "Gold" ? order.metal.toUpperCase() : "",
  ].filter(Boolean).join(" ") || `${order.jewelleryType} - ${order.metal}`.toUpperCase();

  const stockId   = order.designNumber || order.orderNumber;
  const weight    = order.diamondWeight ? `${order.diamondWeight}CT` : "—";
  const itemPrice = order.amount ? usd(order.amount) : "—";
  const itemTotal = order.amount ? usd(order.amount) : "—";

  /* ── 10 item rows then totals rows embedded inside same table ── */
  const ITEM_ROWS = 10;
  const itemRows = Array.from({ length: ITEM_ROWS }, (_, i) => {
    if (i === 0) {
      return `<tr class="item-row">
        <td class="c">1</td>
        <td class="c">${stockId}</td>
        <td class="l">${description}</td>
        <td class="c">${order.quantity}</td>
        <td class="c">${weight}</td>
        <td class="c">${itemPrice}</td>
        <td class="c">${itemTotal}</td>
      </tr>`;
    }
    return `<tr class="item-row"><td class="c">&nbsp;</td><td></td><td></td><td class="c"></td><td class="c"></td><td class="c"></td><td class="c"></td></tr>`;
  }).join("\n");

  /* totals — integrated as extra tbody rows; left cols have white/no border */
  const shippingRow = shipping > 0 ? `
    <tr class="tot-row">
      <td colspan="4" class="blank"></td>
      <td colspan="2" class="tot-lbl">Shipping Charges</td>
      <td class="tot-val">${usd(shipping)}</td>
    </tr>` : "";

  const totalsRows = `
    ${shippingRow}
    <tr class="tot-row tot-bold">
      <td colspan="4" class="blank"></td>
      <td colspan="2" class="tot-lbl"><strong>Total Amount</strong></td>
      <td class="tot-val"><strong>${usd(total)}</strong></td>
    </tr>
    <tr class="tot-row">
      <td colspan="4" class="blank"></td>
      <td colspan="2" class="tot-lbl">Deposit Payment</td>
      <td class="tot-val">${adv > 0 ? usd(adv) : "—"}</td>
    </tr>
    <tr class="tot-row">
      <td colspan="4" class="blank"></td>
      <td colspan="2" class="tot-lbl"><strong>Balance Due</strong></td>
      <td class="tot-val"><strong>${bal > 0 ? usd(bal) : usd(0)}</strong></td>
    </tr>`;

  /* QR / stamp placeholders */
  const qr = (src?: string, label = "Upload QR") => src
    ? `<img src="${src}" style="width:76px;height:76px;display:block;margin:0 auto;" />`
    : `<div style="width:76px;height:76px;border:1.5px dashed #bbb;display:flex;align-items:center;justify-content:center;font-size:9px;color:#aaa;text-align:center;margin:0 auto;">${label}</div>`;

  const stampHtml = settings.invoiceStamp
    ? `<img src="${settings.invoiceStamp}" style="width:76px;height:76px;display:block;margin:4px auto;object-fit:contain;" />`
    : `<div style="width:76px;height:76px;border:1.5px dashed #bbb;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:9px;color:#aaa;text-align:center;margin:4px auto;">Upload Stamp</div>`;

  const html = `<!DOCTYPE html>
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
  .meta td { padding: 4px 8px; }
  .meta td:first-child { white-space: nowrap; border-right: 1px solid #333; }
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

  /* ── Footer three-col row ── */
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
    <img src="/starlink-logo.png" alt="Starlink Jewels" class="logo" />
    <div class="addr">
      ${settings.invoiceAddress1 || "55 JOHN ST"}<br/>
      ${settings.invoiceAddress2 || "EAST RUTHERFORD"}<br/>
      ${settings.invoiceAddress3 || "NEW JERSEY 07073"}<br/>
      ${settings.invoiceTel ? "Tel No: " + settings.invoiceTel + "<br/>" : ""}
      ${settings.invoicePrimary ? "Primary: " + settings.invoicePrimary + "<br/>" : ""}
      ${settings.invoiceEmail ? "Email: " + settings.invoiceEmail : ""}
    </div>
  </div>

  <hr class="rule"/>

  <div class="title">INVOICE</div>

  <!-- TO + Invoice meta -->
  <div class="inforow">
    <div class="to">
      <div class="name">TO: ${(client?.ownerName || client?.companyName || "").toUpperCase()}</div>
      ${client?.address ? `<div>${client.address}</div>` : ""}
      ${client?.companyName && client?.ownerName ? `<div>${client.companyName}</div>` : ""}
      ${client?.phone ? `<div>Tel: ${client.phone}</div>` : ""}
    </div>
    <div class="meta">
      <table>
        <tr><td>Invoice No:</td><td>${invoiceNumber}</td></tr>
        <tr><td>Date:</td><td>${localDate(order.createdAt)}</td></tr>
        <tr><td>Terms:</td><td>${settings.invoiceTerms || "COD"}</td></tr>
      </table>
    </div>
  </div>

  <!-- Items table + totals embedded -->
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

  <!-- Footer -->
  <div class="footer">
    <div class="f-left">
      <div style="margin-top:48px;">
        <div class="sig-line"></div>
        <div class="sig-text">Chop or signature.</div>
      </div>
    </div>

    <div class="f-mid">
      <div class="qr-block">
        <div class="qr-lbl">SCAN TO PAY</div>
        ${qr(settings.invoiceQr1)}
      </div>
      <div class="qr-block">
        <div class="qr-lbl">SCAN TO PAY</div>
        ${qr(settings.invoiceQr2)}
      </div>
    </div>

    <div class="f-right">
      <div class="for-co">For ${(settings.companyName || "STARLINK JEWELS").toUpperCase()} INC</div>
      ${stampHtml}
      <div class="auth">Chop &amp; Authorized Signature</div>
    </div>
  </div>

  <!-- Legal -->
  <div class="legal">
    This Items Here in Invoiced Has Been Purchased from Legal Sources, Not Involved in Funding Conflict and In Compliance with United Nations Resolutions.<br/>
    The Seller Here by Guaranteed This Item Are Conflict Free and Not Involved in Any Money Laundering, Based On Personal Knowledge and Written Guarantied Provided By The Supplier of This Item.
  </div>

  <div class="thankyou">THANK YOU FOR YOUR BUSINESS</div>

</div>
<script>
  window.onload = function () { window.focus(); window.print(); };
</script>
</body>
</html>`;

  const w = window.open("", "_blank", "width=860,height=1120");
  if (!w) { alert("Please allow popups to print/download the invoice."); return; }
  w.document.open();
  w.document.write(html);
  w.document.close();
}
