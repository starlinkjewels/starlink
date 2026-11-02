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
import { costDataReady, fmtDate, orderTotal, totalAdvance, balanceDue, type DB, type Order } from "./db";
import { buildSheet } from "./orderExport";
import { buildProductRows } from "./productExport";
import { orderProfit, recognisedSale, saleDate } from "./orderCost";
import { orderMaterialLines } from "./orderMaterials";
import { orderPictures } from "./readyStockPhotos";
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

/**
 * One order, everything about it, as a workbook: the Order sheet (photos,
 * details, weights, money, the stages), Materials (with the total), Payments,
 * the Manufacturing log, and — the admin's copy only — Cost & Profit.
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

    // Sheet 1 · Order
    const ws = wb.addWorksheet("Order", { views: [{ showGridLines: false }], pageSetup: { orientation: "portrait", fitToPage: true, fitToWidth: 1, fitToHeight: 0 } });
    const C = 6;
    ws.columns = [{ width: 24 }, { width: 18 }, { width: 18 }, { width: 18 }, { width: 18 }, { width: 18 }];
    let r = titleBand(ws, C, `${brandName()}  —  Order ${order.orderNumber}`, sub);
    r = await photoRow(wb, ws, r, orderPictures(order));
    r = section(ws, r, C, "Details");
    for (const [k, v] of s.details) r = kvRow(ws, r, C, k, v);
    r = section(ws, r + 1, C, "Piece weights");
    for (const [k, v] of s.weights) r = kvRow(ws, r, C, k, v);
    r = section(ws, r + 1, C, "Money (US$)");
    const value = r2(orderTotal(order) - (order.shippingCharge ?? 0));
    r = kvRow(ws, r, C, "Order value", value, FMT.usd);
    if (order.certificateFee) r = kvRow(ws, r, C, "  of which certificate", order.certificateFee, FMT.usd);
    for (const ch of order.otherCharges ?? []) r = kvRow(ws, r, C, `  of which ${ch.name}`, ch.amountUsd, FMT.usd);
    if (order.giftCardRedeemed) r = kvRow(ws, r, C, "Gift card used", -order.giftCardRedeemed, FMT.usd);
    if (order.shippingCharge) r = kvRow(ws, r, C, "Shipping", order.shippingCharge, FMT.usd);
    r = kvRow(ws, r, C, "Total", orderTotal(order), FMT.usd, true);
    r = kvRow(ws, r, C, "Paid", totalAdvance(order), FMT.usd);
    r = kvRow(ws, r, C, "Balance due", balanceDue(order), FMT.usd, true);
    if (order.timeline?.length) {
      r = section(ws, r + 1, C, "Stages");
      headerRow(ws, r, ["Stage", "Status", "Date", "", "", ""]);
      ws.mergeCells(r, 3, r, C);
      const top = r + 1;
      for (const st of order.timeline) {
        r++;
        ws.getCell(r, 1).value = st.step;
        ws.getCell(r, 2).value = st.status === "done" ? "Done" : st.status === "in_progress" ? "In progress" : "Waiting";
        ws.getCell(r, 3).value = asDate(st.date);
        ws.mergeCells(r, 3, r, C);
      }
      bodyRows(ws, top, r, C, [undefined, undefined, FMT.date]);
      r++;
    }

    // Sheet 2 · Materials
    const lines = orderMaterialLines(db, order, opts.faDone);
    if (lines.length) {
      const wm = wb.addWorksheet("Materials", { views: [{ state: "frozen", ySplit: 4, showGridLines: false }] });
      const heads = ["Material", "Detail", "Pcs", "Qty", "Unit", "From", "Status", ...(opts.withCost ? ["Cost (₹)", "Still due"] : [])];
      wm.columns = [{ width: 22 }, { width: 38 }, { width: 8 }, { width: 11 }, { width: 7 }, { width: 32 }, { width: 14 }, ...(opts.withCost ? [{ width: 14 }, { width: 28 }] : [])];
      const top = titleBand(wm, heads.length, `Materials — ${order.orderNumber}`, "Everything bought or issued for this order, and each repair on its own line");
      headerRow(wm, top - 0, heads);
      let rr = top;
      for (const l of lines) {
        rr++;
        const row = wm.getRow(rr);
        row.values = [l.title, l.detail ?? "", l.pcs ?? null, l.amount ? Math.round(l.amount.n * 1000) / 1000 : l.qty, l.amount?.unit ?? "", [l.source, l.sourceSub].filter(Boolean).join(" · "), l.status,
          ...(opts.withCost ? [l.costInr ?? null, [l.dueInr > 0 ? `₹${Math.round(l.dueInr).toLocaleString("en-IN")} to supplier` : "", l.labourDueInr > 0 ? `₹${Math.round(l.labourDueInr).toLocaleString("en-IN")} labour` : ""].filter(Boolean).join(" · ")] : [])];
      }
      bodyRows(wm, top + 1, rr, heads.length, [undefined, undefined, FMT.int, "0.000", undefined, undefined, undefined, ...(opts.withCost ? [FMT.inr, undefined] : [])]);
      // The total: what was issued to the order (as on the page), each material on its own.
      const by = new Map<string, number>();
      let pcs = 0;
      for (const l of lines) if (l.amount && l.amount.n > 0) {
        const k = `${l.amount.of ? `${l.amount.of} ` : ""}${l.amount.unit}`;
        by.set(k, (by.get(k) ?? 0) + l.amount.n);
        pcs += l.pcs ?? 0;
      }
      totalsRow(wm, rr + 1, heads.length, ["Total issued", [...by.entries()].map(([k, n]) => `${Math.round(n * 1000) / 1000} ${k}`).join(" · "), pcs || null, undefined, undefined, undefined, undefined,
        ...(opts.withCost ? [lines.reduce((t2, l) => t2 + (l.costInr ?? 0), 0) || null, undefined] : [])], [undefined, undefined, FMT.int, undefined, undefined, undefined, undefined, ...(opts.withCost ? [FMT.inr] : [])]);
      wm.autoFilter = { from: { row: top, column: 1 }, to: { row: rr, column: heads.length } };
    }

    // Sheet 3 · Payments
    if (s.payments.length) {
      const wp = wb.addWorksheet("Payments", { views: [{ state: "frozen", ySplit: 4, showGridLines: false }] });
      wp.columns = [{ width: 14 }, { width: 16 }, { width: 46 }, { width: 14 }];
      const top = titleBand(wp, 4, `Payments — ${order.orderNumber}`, "Money received against this order (US$)");
      headerRow(wp, top, ["Date", "Receipt", "Note", "Amount"]);
      let rr = top;
      const adv = (order.advances ?? []).slice().sort((a, b) => +new Date(a.createdAt) - +new Date(b.createdAt));
      adv.forEach((a, i) => { rr++; wp.getRow(rr).values = [new Date(a.createdAt), s.payments[i]?.receipt ?? "", a.note ?? "", a.amount]; });
      bodyRows(wp, top + 1, rr, 4, [FMT.date, undefined, undefined, FMT.usd]);
      totalsRow(wp, rr + 1, 4, ["Total paid", undefined, undefined, r2(adv.reduce((t2, a) => t2 + a.amount, 0))], [undefined, undefined, undefined, FMT.usd]);
    }

    // Sheet 4 · Manufacturing log
    if (order.manufacturingLog?.length) {
      const wl = wb.addWorksheet("Manufacturing log", { views: [{ state: "frozen", ySplit: 4, showGridLines: false }] });
      wl.columns = [{ width: 14 }, { width: 22 }, { width: 22 }, { width: 22 }, { width: 60 }];
      const top = titleBand(wl, 5, `Manufacturing log — ${order.orderNumber}`, "Every step recorded on the order, oldest first");
      headerRow(wl, top, ["Date", "What", "Factory", "By", "Remarks"]);
      let rr = top;
      for (const e of [...order.manufacturingLog].sort((a, b) => +new Date(a.at) - +new Date(b.at))) {
        rr++;
        wl.getRow(rr).values = [new Date(e.at), e.type.replace(/_/g, " "), e.factoryId ? db.factories.find(f => f.id === e.factoryId)?.name ?? "" : "",
          e.employeeId ? db.users.find(u => u.id === e.employeeId)?.name ?? "" : "", e.remarks ?? ""];
      }
      bodyRows(wl, top + 1, rr, 5, [FMT.date]);
    }

    // Sheet 5 · Cost & Profit — the admin's copy only
    if (opts.withCost) {
      const p = orderProfit(db, order);
      const wc = wb.addWorksheet("Cost & Profit", { views: [{ showGridLines: false }] });
      wc.columns = [{ width: 18 }, { width: 46 }, { width: 18 }];
      let rr = titleBand(wc, 3, `Cost & Profit — ${order.orderNumber}`, "ADMIN ONLY — what this order cost us and what it made. Never send out.");
      rr = section(wc, rr, 3, "Profit");
      const kv = (label: string, v: Cell["value"], fmt?: string, strong = false) => { rr = kvRow(wc, rr, 3, label, v, fmt, strong); };
      kv("Selling", order.forReadyStock ? "In-house build — not sold" : p.sellingUsd, order.forReadyStock ? undefined : FMT.usd);
      kv("Cost", p.cost.totalInr, FMT.inr);
      kv("Rate used", p.fx ? `₹${p.fx.rate} for $1 (${p.fx.basis === "dated" ? "that day's rate" : p.fx.basis === "earliest" ? "the first rate on file" : "the one flat rate"})` : "No exchange rate on file");
      kv("Cost in $", p.costUsd, FMT.usd);
      if (!order.forReadyStock) {
        kv("Profit", p.profitUsd, FMT.usd, true);
        kv("Margin (profit ÷ selling)", p.marginPct, FMT.pct, true);
        kv("Markup (profit ÷ cost)", p.markupPct, FMT.pct);
        kv("Sold on", recognisedSale(order) ? new Date(saleDate(order)) : "Not dispatched yet", recognisedSale(order) ? FMT.date : undefined);
      }
      kv("Cost complete", p.cost.complete ? "Yes" : "No — see below");
      rr = section(wc, rr + 1, 3, "What it cost");
      headerRow(wc, rr, ["Part", "Item", "Amount (₹)"]);
      const top = rr + 1;
      const groups: [string, { label: string; amountInr: number; estimate?: boolean }[]][] = [["Gold", p.cost.gold], ["Diamonds", p.cost.diamond], ["Other materials", p.cost.materials], ["Labour", p.cost.labour], ["Other", p.cost.other]];
      for (const [g, ls] of groups) for (const l of ls) { rr++; wc.getRow(rr).values = [g, `${l.label}${l.estimate ? " (estimate)" : ""}`, l.amountInr]; }
      bodyRows(wc, top, rr, 3, [undefined, undefined, FMT.inr]);
      totalsRow(wc, rr + 1, 3, ["Total", undefined, p.cost.totalInr], [undefined, undefined, FMT.inr]);
      rr += 2;
      if (p.cost.missing.length) {
        rr = section(wc, rr + 1, 3, "Not counted yet");
        for (const m of p.cost.missing) rr = kvRow(wc, rr, 3, m.label, m.reason);
      }
    }

    await save(wb, `Order-${order.orderNumber}`);
    toast.success("Excel saved", { id: t });
  } catch (e) {
    toast.error(`Couldn't make the Excel file${e instanceof Error && e.message ? ` — ${e.message}` : ""}`, { id: t });
  }
}

// ── The Orders list ─────────────────────────────────────────────────────────

/** Past this many orders, the list sheet carries no photos (it would take minutes). */
const LIST_PHOTOS_MAX = 300;

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
      const heads = [...(withPhotos ? ["Photo"] : []), "Order", "Design", "Client", "Date", "Item", "Metal", "Karat", "Gross", "Net", "Diamond", "Pcs", "Shape", "Status", "Value ($)", "Shipping ($)", "Total ($)", "Paid ($)", "Due ($)", "Dispatched"];
      const fmts = [...(withPhotos ? [undefined] : []), undefined, undefined, undefined, FMT.date, undefined, undefined, undefined, FMT.g, FMT.g, FMT.ct, FMT.int, undefined, undefined, FMT.usd, FMT.usd, FMT.usd, FMT.usd, FMT.usd, FMT.date];
      ws.columns = [...(withPhotos ? [{ width: 13 }] : []), { width: 16 }, { width: 12 }, { width: 24 }, { width: 12 }, { width: 14 }, { width: 14 }, { width: 8 }, { width: 11 }, { width: 11 }, { width: 11 }, { width: 7 }, { width: 10 }, { width: 13 }, { width: 12 }, { width: 11 }, { width: 12 }, { width: 11 }, { width: 11 }, { width: 12 }];
      const top = titleBand(ws, heads.length, `${brandName()}  —  Orders`, [subject, `${orders.length} order${orders.length !== 1 ? "s" : ""}`, `Downloaded ${fmtDate(new Date().toISOString())}`].filter(Boolean).join("  ·  "));
      headerRow(ws, top, heads);
      let rr = top;
      rows.forEach((x, i) => {
        rr++;
        const o = orders[i];
        ws.getRow(rr).values = [...(withPhotos ? [""] : []), x.orderNumber, x.design, x.client, asDate(o.createdAt), x.item, x.metal, x.karat, x.grossG || null, x.netG || null, x.diamondCt || null, x.diamondPcs === "" ? null : x.diamondPcs,
          x.shape, `${x.status}${x.estimated ? " (est. weights)" : ""}`, x.valueUsd, x.shippingUsd || null, x.totalUsd, x.paidUsd, x.dueUsd, asDate(o.dispatchedAt)];
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
      const heads = ["Order", "Design", "Client", "Item", "Metal", "Status", "Ordered", "Sold", "Selling ($)", "Gold (₹)", "Diamonds (₹)", "Other mat. (₹)", "Labour (₹)", "Other (₹)", "Cost (₹)", "Rate", "Cost ($)", "Profit ($)", "Margin", "Markup", "Cost complete", "Not counted"];
      const fmts = [undefined, undefined, undefined, undefined, undefined, undefined, FMT.date, FMT.date, FMT.usd, FMT.inr, FMT.inr, FMT.inr, FMT.inr, FMT.inr, FMT.inr, "0.00", FMT.usd, FMT.usd, FMT.pct, FMT.pct, undefined, undefined];
      ws.columns = [{ width: 16 }, { width: 12 }, { width: 22 }, { width: 13 }, { width: 16 }, { width: 13 }, { width: 12 }, { width: 12 }, { width: 12 }, { width: 12 }, { width: 13 }, { width: 13 }, { width: 12 }, { width: 11 }, { width: 13 }, { width: 8 }, { width: 11 }, { width: 11 }, { width: 9 }, { width: 9 }, { width: 10 }, { width: 40 }];
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
          c.complete ? "Yes" : "No", c.missing.map(m => `${m.label} (${m.reason})`).join("; ")];
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
