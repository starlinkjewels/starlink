// Real Excel workbooks (.xlsx) — styled, with the photos in them — for one
// order and for the Orders list. They replace the plain CSV "Excel" files.
//
// ExcelJS is large, so it is fetched only when someone downloads (a dynamic
// import); no page gets slower for it. Photos are read the way previews are
// (lib/photoPreview.ts sheetPicture — Starlink's storage through /api/img) and
// drawn small, so a workbook stays a few MB at most.
//
// What things cost us is on the admin's copy only (withCost), as everywhere.
import { toast } from "sonner";
import type { Workbook, Worksheet, Cell, Fill, Borders } from "exceljs";
import { costDataReady, findInvoiceForOrder, fmtDate, orderTotal, totalAdvance, balanceDue, type DB, type Order } from "./db";
import { buildSheet } from "./orderExport";
import { buildProductRows } from "./productExport";
import { orderProfit, recognisedSale, saleDate } from "./orderCost";
import { orderMaterialLines, type MaterialLine } from "./orderMaterials";
import { orderPictures } from "./readyStockPhotos";
import { finishRecordOf, isReworkIssue } from "./rework";
import { sheetPicture } from "./photoPreview";
import { brandName, getBrand } from "./brand";

// ── Look ────────────────────────────────────────────────────────────────────
const hex = (c: string) => `FF${c.replace("#", "").toUpperCase()}`;
const BRAND = () => { const c = getBrand().color; return c && /^#[0-9a-f]{6}$/i.test(c) ? c : "#1E3A6E"; };
const solid = (c: string): Fill => ({ type: "pattern", pattern: "solid", fgColor: { argb: hex(c) } });
const thin: Partial<Borders> = { top: { style: "thin", color: { argb: "FFE2E8F0" } }, bottom: { style: "thin", color: { argb: "FFE2E8F0" } }, left: { style: "thin", color: { argb: "FFE2E8F0" } }, right: { style: "thin", color: { argb: "FFE2E8F0" } } };
const FMT = {
  usd: '"$"#,##0.00',
  inr: '"₹"#,##0',
  g: '0.000" g"',
  ct: '0.000" ct"',
  pct: '0.0"%"',
  date: "dd mmm yyyy",
  int: "#,##0",
};
const asDate = (iso?: string) => (iso ? new Date(iso) : null);
const r2 = (n: number) => Math.round(n * 100) / 100;

async function excel(): Promise<typeof import("exceljs")> {
  const m = await import("exceljs");
  return ((m as unknown as { default?: typeof import("exceljs") }).default ?? m) as typeof import("exceljs");
}

async function save(wb: Workbook, name: string): Promise<void> {
  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${name.replace(/[^\w.-]+/g, "_")}.xlsx`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

/** The band at the top of a sheet: the brand and what the sheet is. */
function titleBand(ws: Worksheet, cols: number, title: string, sub: string): number {
  ws.mergeCells(1, 1, 1, cols);
  const t = ws.getCell(1, 1);
  t.value = title;
  t.font = { bold: true, size: 16, color: { argb: "FFFFFFFF" } };
  t.fill = solid(BRAND());
  t.alignment = { vertical: "middle", indent: 1 };
  ws.getRow(1).height = 32;
  ws.mergeCells(2, 1, 2, cols);
  const s = ws.getCell(2, 1);
  s.value = sub;
  s.font = { size: 10, color: { argb: "FF475569" } };
  s.fill = solid("#F1F5F9");
  s.alignment = { vertical: "middle", indent: 1 };
  ws.getRow(2).height = 20;
  return 4; // the next free row, a line left blank
}

/** A section's heading across the sheet. */
function section(ws: Worksheet, row: number, cols: number, text: string): number {
  ws.mergeCells(row, 1, row, cols);
  const c = ws.getCell(row, 1);
  c.value = text.toUpperCase();
  c.font = { bold: true, size: 10, color: { argb: hex(BRAND()) } };
  c.border = { bottom: { style: "medium", color: { argb: hex(BRAND()) } } };
  ws.getRow(row).height = 20;
  return row + 1;
}

/** A table's header row: bold on the brand colour. */
function headerRow(ws: Worksheet, row: number, heads: string[]): void {
  heads.forEach((h, i) => {
    const c = ws.getCell(row, i + 1);
    c.value = h;
    c.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 10 };
    c.fill = solid(BRAND());
    c.alignment = { vertical: "middle", wrapText: true };
    c.border = thin;
  });
  ws.getRow(row).height = 22;
}

/** A label / value line in a details block (value across the rest of the row). */
function kvRow(ws: Worksheet, row: number, cols: number, label: string, value: Cell["value"], numFmt?: string, strong = false): number {
  const l = ws.getCell(row, 1);
  l.value = label;
  l.font = { bold: true, size: 10, color: { argb: "FF334155" } };
  l.fill = solid("#F8FAFC");
  l.border = thin;
  l.alignment = { vertical: "top" };
  ws.mergeCells(row, 2, row, cols);
  const v = ws.getCell(row, 2);
  v.value = value;
  if (numFmt) v.numFmt = numFmt;
  v.font = { size: 10, bold: strong };
  v.alignment = { vertical: "top", wrapText: true, horizontal: numFmt ? "left" : undefined };
  v.border = thin;
  return row + 1;
}

/** Banded rows, borders, and a figure's format per column. */
function bodyRows(ws: Worksheet, from: number, to: number, cols: number, fmts: (string | undefined)[]): void {
  for (let r = from; r <= to; r++) {
    for (let c = 1; c <= cols; c++) {
      const cell = ws.getCell(r, c);
      cell.border = thin;
      cell.font = { size: 10 };
      cell.alignment = { vertical: "middle", wrapText: c > 1 && !fmts[c - 1] };
      if (fmts[c - 1]) cell.numFmt = fmts[c - 1]!;
      if ((r - from) % 2 === 1) cell.fill = solid("#F8FAFC");
    }
  }
}

/** A totals row: bold on a pale band. */
function totalsRow(ws: Worksheet, row: number, cols: number, values: (Cell["value"] | undefined)[], fmts: (string | undefined)[]): void {
  for (let c = 1; c <= cols; c++) {
    const cell = ws.getCell(row, c);
    if (values[c - 1] !== undefined) cell.value = values[c - 1]!;
    cell.font = { bold: true, size: 10 };
    cell.fill = solid("#E2E8F0");
    cell.border = thin;
    if (fmts[c - 1]) cell.numFmt = fmts[c - 1]!;
  }
}

/** Up to `max` photos side by side on one row; returns the next free row. */
async function photoRow(wb: Workbook, ws: Worksheet, row: number, urls: string[], max = 4): Promise<number> {
  const pics = (await Promise.all(urls.slice(0, max).map(u => sheetPicture(u, 360)))).filter((p): p is NonNullable<typeof p> => !!p);
  if (!pics.length) return row;
  const H = 150;
  ws.getRow(row).height = H * 0.78; // points
  let x = 0;
  for (const p of pics) {
    const w = Math.round(p.w * (H / p.h));
    const id = wb.addImage({ base64: p.base64, extension: "jpeg" });
    ws.addImage(id, { tl: { col: x, row: row - 1 + 0.05 }, ext: { width: w, height: H } });
    x += Math.max(1.05, w / 130 + 0.15);
  }
  return row + 2;
}

// ── One order ───────────────────────────────────────────────────────────────

/** Where a line's material came from, in the words the trade uses. */
function sourceOf(l: MaterialLine): string {
  if (l.repair) return "Repair";
  if (l.purchase) return "Bought for this order";
  const mi = l.issuance;
  if (!mi) return "";
  if (mi.sourcePurchaseId || mi.source === "purchase") return "Bought for this order";
  return ({ stock: "Our stock", factoryPool: "Factory's holding", melt: "Melted piece", transfer: "Transfer", client: "Client's own", rework: "Rework" } as Record<string, string>)[mi.source ?? ""] ?? (mi.source ?? "");
}

/** A small table inside the sheet: header, rows, optional totals; returns the next free row. */
function table(ws: Worksheet, row: number, cols: number, heads: string[], rows: (Cell["value"] | null)[][], fmts: (string | undefined)[], totals?: (Cell["value"] | undefined)[]): number {
  headerRow(ws, row, [...heads, ...Array(Math.max(0, cols - heads.length)).fill("")]);
  if (heads.length < cols) ws.mergeCells(row, heads.length, row, cols);
  let r = row;
  for (const vals of rows) {
    r++;
    vals.forEach((v, i) => { ws.getCell(r, i + 1).value = v ?? null; });
    if (heads.length < cols) ws.mergeCells(r, heads.length, r, cols);
  }
  if (rows.length) bodyRows(ws, row + 1, r, cols, fmts);
  if (totals) {
    r++;
    totalsRow(ws, r, cols, totals, fmts);
    if (heads.length < cols) ws.mergeCells(r, heads.length, r, cols);
  }
  return r + 2;
}

/**
 * One order, A to Z, on ONE sheet — the order page, top to bottom: photos,
 * details, weights, the material (and where each came from: bought for the
 * order, our stock, the factory's holding, the client's own), money,
 * payments, invoice and returns, profit and loss (the admin's copy), the
 * stages and the manufacturing log. Nothing on another tab to be missed.
 */
export async function exportOrderXlsx(db: DB, order: Order, opts: { faDone: boolean; withCost: boolean }): Promise<void> {
  if (opts.withCost && !costDataReady()) { toast.error("Still loading cost data — try again in a moment."); return; }
  const t = toast.loading("Making the Excel file…");
  try {
    const ExcelJS = await excel();
    const wb = new ExcelJS.Workbook();
    wb.creator = brandName(); wb.created = new Date();
    const s = buildSheet(db, order, opts);
    const client = db.clients.find(c => c.id === order.clientId);
    const sub = [order.forReadyStock ? "In-house (Ready Stock)" : client?.companyName, order.jewelleryType, order.status, `Downloaded ${fmtDate(new Date().toISOString())}`].filter(Boolean).join("  ·  ");

    const ws = wb.addWorksheet(`Order ${order.orderNumber}`.slice(0, 31), { views: [{ showGridLines: false }], pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 } });
    const C = 9;
    ws.columns = [{ width: 24 }, { width: 34 }, { width: 8 }, { width: 16 }, { width: 20 }, { width: 34 }, { width: 14 }, { width: 14 }, { width: 14 }];
    let r = titleBand(ws, C, `${brandName()}  —  Order ${order.orderNumber}`, sub);

    // ── Photos: every picture of the piece; one that can't be read is a link instead.
    const urls = orderPictures(order).slice(0, 6);
    if (urls.length) {
      r = section(ws, r, C, `Photos · ${urls.length}`);
      const pics = await Promise.all(urls.map(u => sheetPicture(u, 360)));
      const H = 150;
      ws.getRow(r).height = H * 0.78;
      let x = 0;
      pics.forEach(p => {
        if (!p) return;
        const w = Math.round(p.w * (H / p.h));
        const id = wb.addImage({ base64: p.base64, extension: "jpeg" });
        ws.addImage(id, { tl: { col: x, row: r - 1 + 0.05 }, ext: { width: w, height: H } });
        x += Math.max(1.05, w / 150 + 0.2);
      });
      if (pics.every(p => !p)) ws.getCell(r, 1).value = "Photos could not be read here — open them with the links below";
      r++;
      // Each photo also as a link to the full-size original.
      urls.forEach((u, i) => {
        const c = ws.getCell(r, 1 + (i % 3) * 3);
        c.value = { text: `Open photo ${i + 1}`, hyperlink: u };
        c.font = { size: 10, color: { argb: hex(BRAND()) }, underline: true };
        if (i % 3 === 2 && i < urls.length - 1) r++;
      });
      r += 2;
    }

    // ── Details and weights
    r = section(ws, r, C, "Order details");
    for (const [k, v] of s.details) r = kvRow(ws, r, C, k, v);
    const inv = findInvoiceForOrder(db.invoices ?? [], order.id);
    if (inv) r = kvRow(ws, r, C, "Invoice", `${inv.number}${inv.createdAt ? ` · ${fmtDate(inv.createdAt)}` : ""}`);
    r = section(ws, r + 1, C, "Piece weights");
    for (const [k, v] of s.weights) r = kvRow(ws, r, C, k, v);

    // ── Material: each line, where it came from, and the total issued
    const lines = orderMaterialLines(db, order, opts.faDone);
    r = section(ws, r + 1, C, `Material & repairs · ${lines.length}`);
    if (lines.length) {
      const by = new Map<string, number>();
      let pcs = 0;
      for (const l of lines) if (l.amount && l.amount.n > 0) {
        const k = `${l.amount.of ? `${l.amount.of} ` : ""}${l.amount.unit}`;
        by.set(k, (by.get(k) ?? 0) + l.amount.n);
        pcs += l.pcs ?? 0;
      }
      r = table(ws, r, C,
        // Qty in the order page's own words ("1.2 ct of 1.58 ct", "Labour only").
        ["Material", "Detail", "Pcs", "Qty", "Came from", "Supplier / factory", "Status", ...(opts.withCost ? ["Cost (₹)"] : [])],
        lines.map(l => [l.title, l.detail ?? "", l.pcs ?? null, l.qty,
          sourceOf(l), [l.source, l.sourceSub].filter(Boolean).join(" · "), l.status, ...(opts.withCost ? [l.costInr ?? null] : [])]),
        [undefined, undefined, FMT.int, undefined, undefined, undefined, undefined, ...(opts.withCost ? [FMT.inr] : [])],
        ["Total issued", [...by.entries()].map(([k, n]) => `${Math.round(n * 1000) / 1000} ${k}`).join(" · ") || "—", pcs || null, undefined, undefined, undefined, undefined,
          ...(opts.withCost ? [lines.reduce((t2, l) => t2 + (l.costInr ?? 0), 0) || null] : [])]);
      // Who is still owed for it (admin): a supplier's bill or the factory's labour.
      if (opts.withCost) {
        const owed = lines.filter(l => l.dueInr > 0 || l.labourDueInr > 0);
        for (const l of owed) r = kvRow(ws, r - 1, C, `Still due · ${l.title}`, [l.dueInr > 0 ? `₹${Math.round(l.dueInr).toLocaleString("en-IN")} to the supplier` : "", l.labourDueInr > 0 ? `₹${Math.round(l.labourDueInr).toLocaleString("en-IN")} labour to the factory` : ""].filter(Boolean).join(" · ")) + 1;
      }
    } else r = kvRow(ws, r, C, "Material", "Nothing bought or issued for this order yet") + 1;

    // ── Final Approval — what the factory actually used and charged (the finish record)
    // The finish record (gold from the factory's holding), else the order's own issue that carries the labour.
    const fin = finishRecordOf(db.materialIssuances ?? [], order.id)
      ?? (db.materialIssuances ?? []).find(i => i.orderId === order.id && !isReworkIssue(i) && (!!i.labour || (i.makingCharges?.amountInr ?? 0) > 0));
    if (fin && (fin.labour || fin.makingCharges?.amountInr)) {
      const L = fin.labour ?? {};
      r = section(ws, r, C, "Final Approval — labour & actuals");
      if (fin.factoryId) r = kvRow(ws, r, C, "Factory", db.factories.find(f => f.id === fin.factoryId)?.name ?? "");
      if (L.lines?.length) for (const l of L.lines) r = kvRow(ws, r, C, `Making — ${l.metal}`, `${l.grams} g × ₹${(l.rate || 0).toLocaleString("en-IN")}/g`);
      else if (L.perGramRate) r = kvRow(ws, r, C, "Labour per gram", L.perGramRate, FMT.inr);
      if (L.minimumLabour) r = kvRow(ws, r, C, L.minimumFlat ? "Minimum labour (flat)" : "Minimum labour", `₹${L.minimumLabour.toLocaleString("en-IN")}${L.minimumUnderGrams ? ` under ${L.minimumUnderGrams} g` : ""}`);
      if (L.diamondHandlingRate) r = kvRow(ws, r, C, "Diamond handling per ct", L.diamondHandlingRate, FMT.inr);
      if (L.cadCharge) r = kvRow(ws, r, C, "CAD charge", L.cadCharge, FMT.inr);
      if (L.otherCharges) r = kvRow(ws, r, C, "Other charges", L.otherCharges, FMT.inr);
      if (L.metalByFactoryGrams) r = kvRow(ws, r, C, "Metal by factory", `${L.metalByFactoryGrams} g${L.metalByFactoryRate ? ` × ₹${L.metalByFactoryRate.toLocaleString("en-IN")}/g` : ""}`);
      if (opts.withCost || fin.makingCharges?.amountInr) r = kvRow(ws, r, C, "Labour total (factory's bill)", fin.makingCharges?.amountInr ?? null, FMT.inr, true);
      if (order.actualDiamondWeight != null) r = kvRow(ws, r, C, "Diamonds in the piece", `${order.actualDiamondWeight} ct${order.actualDiamondPcs ? ` · ${order.actualDiamondPcs} pcs` : ""}`);
      r += 1;
    }

    // ── Design (CAD)
    const cads = (db.cadJobs ?? []).filter(j => j.orderId === order.id);
    if (cads.length) {
      r = section(ws, r, C, `Design (CAD) · ${cads.length}`);
      r = table(ws, r, C, ["Designer", "Status", "Given", "Approved", ...(opts.withCost ? ["Charge (₹)"] : [])],
        cads.map(j => [(db.designers ?? []).find(x => x.id === j.designerId)?.name ?? "", String(j.status).replace(/_/g, " "), asDate(j.createdAt), asDate(j.approvedAt),
          ...(opts.withCost ? [j.chargeInr ?? j.rate ?? null] : [])]),
        [undefined, undefined, FMT.date, FMT.date, ...(opts.withCost ? [FMT.inr] : [])]);
    }

    // ── The client's own material (job work)
    const cm = (client?.materialLedger ?? []).filter(e => e.orderId === order.id);
    if (order.clientSupplied || cm.length) {
      r = section(ws, r, C, "Client's own material");
      if (order.clientSupplied) r = kvRow(ws, r, C, "They give", [order.clientSupplied.gold && `Gold${order.clientSupplied.goldLossPct ? ` (loss ${order.clientSupplied.goldLossPct}%)` : ""}`, order.clientSupplied.diamonds && "Diamonds"].filter(Boolean).join(" · "));
      if (cm.length) r = table(ws, r, C, ["Date", "What", "Material", "Grams / ct", "Fine g / pcs"],
        cm.map(e => [new Date(e.at), e.kind === "in" ? "Received" : e.kind === "out" ? "Given back" : "Used in the piece", e.material === "gold" ? "Gold" : "Diamonds",
          e.material === "gold" ? `${e.grams ?? 0} g${e.purity ? ` @ ${e.purity}‰` : ""}` : `${e.ct ?? 0} ct`, e.material === "gold" ? `${e.fine ?? ""}${e.fine != null ? " g fine" : ""}` : `${e.pcs ?? ""}${e.pcs ? " pcs" : ""}`]),
        [FMT.date]);
      else r += 1;
    }

    // ── Money and payments
    r = section(ws, r, C, "Money (US$)");
    r = kvRow(ws, r, C, "Order value", r2(orderTotal(order) - (order.shippingCharge ?? 0)), FMT.usd);
    if (order.certificateFee) r = kvRow(ws, r, C, "  of which certificate", order.certificateFee, FMT.usd);
    for (const ch of order.otherCharges ?? []) r = kvRow(ws, r, C, `  of which ${ch.name}`, ch.amountUsd, FMT.usd);
    if (order.giftCardRedeemed) r = kvRow(ws, r, C, "Gift card used", -order.giftCardRedeemed, FMT.usd);
    if (order.shippingCharge) r = kvRow(ws, r, C, "Shipping", order.shippingCharge, FMT.usd);
    r = kvRow(ws, r, C, "Total", orderTotal(order), FMT.usd, true);
    r = kvRow(ws, r, C, "Paid", totalAdvance(order), FMT.usd);
    r = kvRow(ws, r, C, "Balance due", balanceDue(order), FMT.usd, true);
    const adv = (order.advances ?? []).slice().sort((a, b) => +new Date(a.createdAt) - +new Date(b.createdAt));
    if (adv.length) {
      r = section(ws, r + 1, C, `Payments · ${adv.length}`);
      r = table(ws, r, C, ["Date", "Receipt", "Amount ($)", "Note"],
        adv.map((a, i) => [new Date(a.createdAt), s.payments[i]?.receipt ?? "", a.amount, a.note ?? ""]),
        [FMT.date, undefined, FMT.usd], ["Total paid", undefined, r2(adv.reduce((t2, a) => t2 + a.amount, 0)), undefined]);
    } else r += 1;

    // ── Returns (credit notes)
    if (order.returns?.length) {
      r = section(ws, r, C, `Returned by the client · ${order.returns.length}`);
      r = table(ws, r, C, ["Date", "Credit note", "Pcs", "Credit ($)", "Status", "Reason"],
        order.returns.map(x => [new Date(x.at), x.creditNoteNo, x.qty, x.creditUsd, x.status === "coming" ? "On its way back" : "Received", x.reason ?? ""]),
        [FMT.date, undefined, FMT.int, FMT.usd]);
    }

    // ── Profit & loss — the admin's copy only
    if (opts.withCost) {
      const p = orderProfit(db, order);
      r = section(ws, r, C, "Profit & loss (admin only — never send out)");
      if (!order.forReadyStock) r = kvRow(ws, r, C, "Selling", p.sellingUsd, FMT.usd);
      r = kvRow(ws, r, C, "Cost", p.cost.totalInr, FMT.inr);
      r = kvRow(ws, r, C, "Rate used", p.fx ? `₹${p.fx.rate} for $1 (${p.fx.basis === "dated" ? "that day's rate" : p.fx.basis === "earliest" ? "the first rate on file" : "the one flat rate"})` : "No exchange rate on file — add one in Settings → Pricing");
      r = kvRow(ws, r, C, "Cost in $", p.costUsd, FMT.usd);
      if (!order.forReadyStock) {
        const pr = r;
        r = kvRow(ws, r, C, p.profitUsd != null && p.profitUsd < 0 ? "Loss" : "Profit", p.profitUsd, FMT.usd, true);
        if (typeof p.profitUsd === "number") ws.getCell(pr, 2).font = { size: 11, bold: true, color: { argb: p.profitUsd < 0 ? "FFDC2626" : "FF15803D" } };
        r = kvRow(ws, r, C, "Margin (profit ÷ selling)", p.marginPct, FMT.pct, true);
        r = kvRow(ws, r, C, "Markup (profit ÷ cost)", p.markupPct, FMT.pct);
        r = kvRow(ws, r, C, "Sold on", recognisedSale(order) ? new Date(saleDate(order)) : "Not dispatched yet", recognisedSale(order) ? FMT.date : undefined);
      }
      r = kvRow(ws, r, C, "Cost complete", p.cost.complete ? "Yes" : "No — see 'Not counted yet'");
      const groups: [string, { label: string; amountInr: number; estimate?: boolean }[]][] = [["Gold", p.cost.gold], ["Diamonds", p.cost.diamond], ["Other materials", p.cost.materials], ["Labour", p.cost.labour], ["Other", p.cost.other]];
      const costRows = groups.flatMap(([g, ls]) => ls.map(l => [g, `${l.label}${l.estimate ? " (estimate)" : ""}`, l.amountInr] as (Cell["value"] | null)[]));
      r = table(ws, r + 1, C, ["Part", "What it cost", "Amount (₹)"], costRows, [undefined, undefined, FMT.inr], ["Total cost", undefined, p.cost.totalInr]);
      for (const m of p.cost.missing) r = kvRow(ws, r - 1, C, `Not counted yet · ${m.label}`, m.reason) + 1;
    }

    // ── Stages
    if (order.timeline?.length) {
      r = section(ws, r, C, "Stages");
      r = table(ws, r, C, ["Stage", "Status", "Date"], order.timeline.map(st => [st.step, st.status === "done" ? "Done" : st.status === "in_progress" ? "In progress" : "Waiting", asDate(st.date)]),
        [undefined, undefined, FMT.date]);
    }

    // ── Manufacturing log
    if (order.manufacturingLog?.length) {
      r = section(ws, r, C, `Manufacturing log · ${order.manufacturingLog.length}`);
      r = table(ws, r, C, ["Date", "What", "Factory", "By", "Remarks"],
        [...order.manufacturingLog].sort((a, b) => +new Date(a.at) - +new Date(b.at)).map(e => [new Date(e.at), e.type.replace(/_/g, " "),
          e.factoryId ? db.factories.find(f => f.id === e.factoryId)?.name ?? "" : "", e.employeeId ? db.users.find(u => u.id === e.employeeId)?.name ?? "" : "", e.remarks ?? ""]),
        [FMT.date]);
    }

    await save(wb, `Order-${order.orderNumber}`);
    toast.success("Excel saved", { id: t });
  } catch (e) {
    toast.error(`Couldn't make the Excel file${e instanceof Error && e.message ? ` — ${e.message}` : ""}`, { id: t });
  }
}

/** Where an order's material came from, in one line: "Bought for this order: 3.37 g gold · Our stock: 1.04 ct". */
function cameFrom(db: DB, o: Order): string {
  const faDone = o.timeline?.some(t => t.step === "Final Approval" && t.status === "done") ?? false;
  const by = new Map<string, Map<string, number>>();
  for (const l of orderMaterialLines(db, o, faDone, { costs: false })) {
    if (!l.amount || !(l.amount.n > 0)) continue;
    const src = sourceOf(l), k = `${l.amount.of ? `${l.amount.of} ` : ""}${l.amount.unit}`;
    const m = by.get(src) ?? new Map<string, number>();
    m.set(k, (m.get(k) ?? 0) + l.amount.n);
    by.set(src, m);
  }
  return [...by.entries()].map(([src, m]) => `${src}: ${[...m.entries()].map(([k, n]) => `${Math.round(n * 1000) / 1000} ${k}`).join(", ")}`).join(" · ");
}

// ── The Orders list ─────────────────────────────────────────────────────────

/** Past this many orders, the list sheet carries no photos (it would take minutes). */
const LIST_PHOTOS_MAX = 1000;

/**
 * The Orders list as a workbook: a photo of each piece, its details, weights
 * and money, with the totals — the product sheet that goes to customers (no
 * cost on it). `withProfit` (the admin's copy) adds a Profit sheet.
 */
export async function exportOrdersXlsx(db: DB, orders: Order[], name: string, subject: string, opts: { withProfit?: boolean } = {}): Promise<void> {
  if (opts.withProfit && !costDataReady()) { toast.error("Still loading cost data — try again in a moment."); return; }
  const t = toast.loading(`Making the Excel file — ${orders.length} order${orders.length !== 1 ? "s" : ""}…`);
  try {
    const ExcelJS = await excel();
    const wb = new ExcelJS.Workbook();
    wb.creator = brandName(); wb.created = new Date();
    const rows = buildProductRows(db, orders);
    const withPhotos = orders.length <= LIST_PHOTOS_MAX;

    if (!opts.withProfit) {
      const ws = wb.addWorksheet("Orders", { views: [{ state: "frozen", ySplit: 4, xSplit: withPhotos ? 2 : 1, showGridLines: false }], pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 } });
      const heads = [...(withPhotos ? ["Photo"] : []), "Order", "Design", "Client", "Date", "Item", "Metal", "Karat", "Gross", "Net", "Diamond", "Pcs", "Shape", "Status", "Value ($)", "Shipping ($)", "Total ($)", "Paid ($)", "Due ($)", "Dispatched", "Photo link"];
      const fmts = [...(withPhotos ? [undefined] : []), undefined, undefined, undefined, FMT.date, undefined, undefined, undefined, FMT.g, FMT.g, FMT.ct, FMT.int, undefined, undefined, FMT.usd, FMT.usd, FMT.usd, FMT.usd, FMT.usd, FMT.date, undefined];
      ws.columns = [...(withPhotos ? [{ width: 13 }] : []), { width: 16 }, { width: 12 }, { width: 24 }, { width: 12 }, { width: 14 }, { width: 14 }, { width: 8 }, { width: 11 }, { width: 11 }, { width: 11 }, { width: 7 }, { width: 10 }, { width: 13 }, { width: 12 }, { width: 11 }, { width: 12 }, { width: 11 }, { width: 11 }, { width: 12 }, { width: 12 }];
      const top = titleBand(ws, heads.length, `${brandName()}  —  Orders`, [subject, `${orders.length} order${orders.length !== 1 ? "s" : ""}`, `Downloaded ${fmtDate(new Date().toISOString())}`].filter(Boolean).join("  ·  "));
      headerRow(ws, top, heads);
      let rr = top;
      rows.forEach((x, i) => {
        rr++;
        const o = orders[i];
        ws.getRow(rr).values = [...(withPhotos ? [""] : []), x.orderNumber, x.design, x.client, asDate(o.createdAt), x.item, x.metal, x.karat, x.grossG || null, x.netG || null, x.diamondCt || null, x.diamondPcs === "" ? null : x.diamondPcs,
          x.shape, `${x.status}${x.estimated ? " (est. weights)" : ""}`, x.valueUsd, x.shippingUsd || null, x.totalUsd, x.paidUsd, x.dueUsd, asDate(o.dispatchedAt), null];
        // The full-size photo, one click away — whether or not a picture could be drawn in.
        const u = orderPictures(o)[0];
        if (u) { const c = ws.getCell(rr, heads.length); c.value = { text: "Open photo", hyperlink: u }; }
      });
      bodyRows(ws, top + 1, rr, heads.length, fmts);
      const off = withPhotos ? 1 : 0;
      const sum = (f: (x: (typeof rows)[number]) => number) => r2(rows.reduce((s2, x) => s2 + (f(x) || 0), 0));
      const tv: (Cell["value"] | undefined)[] = Array(heads.length).fill(undefined);
      tv[off] = `Total · ${rows.length}`;
      tv[off + 7] = sum(x => x.grossG); tv[off + 8] = sum(x => x.netG); tv[off + 9] = sum(x => x.diamondCt); tv[off + 10] = sum(x => Number(x.diamondPcs) || 0) || null;
      tv[off + 13] = sum(x => x.valueUsd); tv[off + 14] = sum(x => x.shippingUsd); tv[off + 15] = sum(x => x.totalUsd); tv[off + 16] = sum(x => x.paidUsd); tv[off + 17] = sum(x => x.dueUsd);
      totalsRow(ws, rr + 1, heads.length, tv, fmts);
      ws.autoFilter = { from: { row: top, column: 1 }, to: { row: rr, column: heads.length } };
      if (withPhotos) {
        // A photo in each row's first cell, 4 at a time.
        const pics: (Awaited<ReturnType<typeof sheetPicture>>)[] = [];
        for (let i = 0; i < orders.length; i += 4) {
          pics.push(...await Promise.all(orders.slice(i, i + 4).map(o => { const u = orderPictures(o)[0]; return u ? sheetPicture(u, 160) : Promise.resolve(undefined); })));
          toast.loading(`Making the Excel file — photos ${Math.min(i + 4, orders.length)} of ${orders.length}…`, { id: t });
        }
        pics.forEach((p, i) => {
          const row = top + 1 + i;
          ws.getRow(row).height = 60;
          if (!p) return;
          const H = 72, w = Math.min(86, Math.round(p.w * (H / p.h)));
          const id = wb.addImage({ base64: p.base64, extension: "jpeg" });
          ws.addImage(id, { tl: { col: 0.05, row: row - 1 + 0.05 }, ext: { width: w, height: Math.round(p.h * (w / p.w)) } });
        });
      }
    } else {
      // The admin's Profit sheet: selling, every part of the cost, profit and margin.
      const ws = wb.addWorksheet("Profit", { views: [{ state: "frozen", ySplit: 4, xSplit: 1, showGridLines: false }], pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 } });
      const heads = ["Order", "Design", "Client", "Item", "Metal", "Status", "Ordered", "Sold", "Selling ($)", "Gold (₹)", "Diamonds (₹)", "Other mat. (₹)", "Labour (₹)", "Other (₹)", "Cost (₹)", "Rate", "Cost ($)", "Profit ($)", "Margin", "Markup", "Cost complete", "Material came from", "Not counted"];
      const fmts = [undefined, undefined, undefined, undefined, undefined, undefined, FMT.date, FMT.date, FMT.usd, FMT.inr, FMT.inr, FMT.inr, FMT.inr, FMT.inr, FMT.inr, "0.00", FMT.usd, FMT.usd, FMT.pct, FMT.pct, undefined, undefined, undefined];
      ws.columns = [{ width: 16 }, { width: 12 }, { width: 22 }, { width: 13 }, { width: 16 }, { width: 13 }, { width: 12 }, { width: 12 }, { width: 12 }, { width: 12 }, { width: 13 }, { width: 13 }, { width: 12 }, { width: 11 }, { width: 13 }, { width: 8 }, { width: 11 }, { width: 11 }, { width: 9 }, { width: 9 }, { width: 10 }, { width: 44 }, { width: 40 }];
      const top = titleBand(ws, heads.length, `${brandName()}  —  Profit (ADMIN ONLY)`, [subject, `${orders.length} order${orders.length !== 1 ? "s" : ""}`, "Never send out", `Downloaded ${fmtDate(new Date().toISOString())}`].filter(Boolean).join("  ·  "));
      headerRow(ws, top, heads);
      const sumLines = (ls: { amountInr: number }[]) => r2(ls.reduce((s2, l) => s2 + l.amountInr, 0));
      let rr = top;
      let selling = 0, cost = 0, costUsd = 0, profit = 0;
      for (const o of orders) {
        rr++;
        const p = orderProfit(db, o);
        const c = p.cost;
        const sold = recognisedSale(o);
        if (!o.forReadyStock) { selling += p.sellingUsd; if (p.profitUsd != null) profit += p.profitUsd; }
        cost += c.totalInr; if (p.costUsd != null) costUsd += p.costUsd;
        ws.getRow(rr).values = [o.orderNumber, o.designNumber ?? "", db.clients.find(x => x.id === o.clientId)?.companyName ?? (o.forReadyStock ? "Ready stock" : ""),
          o.jewelleryType, `${o.metal}${o.productKarats ? ` ${o.productKarats}` : ""}`, o.status, asDate(o.createdAt), sold ? asDate(saleDate(o)) : null,
          o.forReadyStock ? null : p.sellingUsd, sumLines(c.gold), sumLines(c.diamond), sumLines(c.materials), sumLines(c.labour), sumLines(c.other), c.totalInr,
          p.fx?.rate ?? null, p.costUsd, o.forReadyStock ? null : p.profitUsd, o.forReadyStock ? null : p.marginPct, o.forReadyStock ? null : p.markupPct,
          c.complete ? "Yes" : "No", cameFrom(db, o), c.missing.map(m => `${m.label} (${m.reason})`).join("; ")];
        // Loss in red, profit in green.
        const pc = ws.getCell(rr, 18);
        if (typeof p.profitUsd === "number" && !o.forReadyStock) pc.font = { size: 10, bold: true, color: { argb: p.profitUsd < 0 ? "FFDC2626" : "FF15803D" } };
      }
      bodyRows(ws, top + 1, rr, heads.length, fmts);
      // bodyRows set every font; the profit colours go back on.
      for (let i = top + 1; i <= rr; i++) {
        const c = ws.getCell(i, 18);
        if (typeof c.value === "number") c.font = { size: 10, bold: true, color: { argb: c.value < 0 ? "FFDC2626" : "FF15803D" } };
      }
      const margin = selling > 0 ? Math.round((profit / selling) * 1000) / 10 : null;
      const tv: (Cell["value"] | undefined)[] = Array(heads.length).fill(undefined);
      tv[0] = `Total · ${orders.length}`; tv[8] = r2(selling); tv[14] = r2(cost); tv[16] = r2(costUsd); tv[17] = r2(profit); tv[18] = margin;
      totalsRow(ws, rr + 1, heads.length, tv, fmts);
      ws.autoFilter = { from: { row: top, column: 1 }, to: { row: rr, column: heads.length } };
    }

    await save(wb, opts.withProfit ? `${name}-PROFIT-ADMIN` : name);
    toast.success(withPhotos || opts.withProfit ? "Excel saved" : `Excel saved — no photos for more than ${LIST_PHOTOS_MAX} orders`, { id: t });
  } catch (e) {
    toast.error(`Couldn't make the Excel file${e instanceof Error && e.message ? ` — ${e.message}` : ""}`, { id: t });
  }
}
