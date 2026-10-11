import { pieceWeights } from "@/lib/weights";
import {
  fmtDate, fmtMoney, orderTotal, totalAdvance, balanceDue, mainDiamondShape, costDataReady,
  CARAT_TO_GRAM, type DB, type Order, type ReadyStockItem,
} from "@/lib/db";
import { downloadCsv, downloadLedgerPdf } from "@/lib/ledgerExport";
import { toast } from "sonner";
import { orderProfit, recognisedSale, saleDate } from "@/lib/orderCost";

/**
 * The finished pieces, with the weights a sale is priced from.
 *
 * Everything needed to settle a bulk sale was on screen one order at a time and
 * nowhere together: gross, net and diamond weight live on the order, the stone
 * count comes off the factory's bill, and the money is derived. Pricing twenty
 * pieces meant opening twenty pages and copying by hand.
 *
 * Actual figures are used wherever Final Approval recorded them and the
 * estimate only where it did not — and the row says which, because a weight
 * taken at order time is not a weight to invoice on.
 */
export interface ProductRow {
  orderNumber: string;
  design: string;
  client: string;
  date: string;
  item: string;
  metal: string;
  karat: string;
  /** Gross = metal + diamond, as the piece weighs on the scale. */
  grossG: number;
  netG: number;
  otherMetal: string;
  otherMetalG: number;
  diamondCt: number;
  diamondPcs: number | "";
  shape: string;
  status: string;
  /** True when any weight on this row is still the estimate. */
  estimated: boolean;
  valueUsd: number;
  shippingUsd: number;
  totalUsd: number;
  paidUsd: number;
  dueUsd: number;
  /** The day the parcel left, where one has gone. */
  dispatchedOn: string;
}

const n3 = (x: number) => Math.round(x * 1000) / 1000;

export function buildProductRows(db: DB, orders: Order[]): ProductRow[] {
  return orders.map(o => {
    // The same reading of the weights the cards, bands and Ready Stock use.
    const pw = pieceWeights(o, db.materialIssuances ?? []);
    const dia = pw.diamondCt, net = pw.net, other = pw.other, gross = pw.gross;
    const estimated = pw.estimated || o.actualDiamondWeight == null;
    const value = orderTotal(o) - (o.shippingCharge ?? 0);
    return {
      orderNumber: o.orderNumber,
      design: o.designNumber ?? "",
      client: db.clients.find(c => c.id === o.clientId)?.companyName ?? "",
      date: o.createdAt,
      item: o.jewelleryType,
      metal: o.metal,
      karat: o.productKarats ?? "",
      grossG: n3(gross),
      netG: n3(net),
      otherMetal: o.otherMetal ?? "",
      otherMetalG: n3(other),
      diamondCt: n3(dia),
      diamondPcs: o.actualDiamondPcs ?? "",
      shape: mainDiamondShape(db, o.id) ?? "",
      status: o.status,
      estimated,
      valueUsd: value,
      shippingUsd: o.shippingCharge ?? 0,
      totalUsd: orderTotal(o),
      paidUsd: totalAdvance(o),
      dueUsd: balanceDue(o),
      dispatchedOn: o.dispatchedAt ?? "",
    };
  });
}

const HEAD = [
  "Order", "Design", "Client", "Date", "Item", "Metal", "Karat",
  "Gross wt (g)", "Net wt (g)", "Other metal", "Other wt (g)",
  "Diamond (ct)", "Diamond pcs", "Shape", "Weights",
  "Value ($)", "Shipping ($)", "Total ($)", "Paid ($)", "Due ($)", "Status", "Dispatched",
];

/** The spreadsheet a bulk sale is priced on — every figure as a number, so it
 *  can be summed and re-rated without retyping. */
export function exportProductsCsv(db: DB, orders: Order[], name: string): void {
  const rows = buildProductRows(db, orders);
  downloadCsv(name, HEAD, rows.map(r => [
    r.orderNumber, r.design, r.client, fmtDate(r.date), r.item, r.metal, r.karat,
    r.grossG, r.netG, r.otherMetal, r.otherMetalG || "",
    r.diamondCt, r.diamondPcs, r.shape, r.estimated ? "estimated" : "actual",
    r.valueUsd, r.shippingUsd, r.totalUsd, r.paidUsd, r.dueUsd, r.status,
    r.dispatchedOn ? fmtDate(r.dispatchedOn) : "",
  ]));
}

export function exportProductsPdf(db: DB, orders: Order[], name: string, subject: string): void {
  const rows = buildProductRows(db, orders);
  const sum = (f: (r: ProductRow) => number) => Math.round(rows.reduce((s, r) => s + f(r), 0) * 1000) / 1000;
  downloadLedgerPdf({
    title: "Product Details",
    subjectLines: [
      subject,
      `${rows.length} piece${rows.length !== 1 ? "s" : ""}`,
      `Report Generated: ${new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}`,
    ],
    summary: [
      { label: "Gross weight", value: `${sum(r => r.grossG)} g` },
      { label: "Diamond", value: `${sum(r => r.diamondCt)} ct` },
      { label: "Total", value: fmtMoney(sum(r => r.totalUsd)) },
      { label: "Due", value: fmtMoney(sum(r => r.dueUsd)) },
    ],
    landscape: true,
    columns: [
      { header: "Order", x: 14 }, { header: "Design", x: 48 }, { header: "Item", x: 74 },
      { header: "Metal", x: 104 }, { header: "Gross", x: 140 }, { header: "Net", x: 162 },
      { header: "Dia ct", x: 182 }, { header: "Pcs", x: 202 },
      { header: "Total", x: 222 }, { header: "Paid", x: 248 }, { header: "Due", x: 272 },
    ],
    align: ["left", "left", "left", "left", "right", "right", "right", "right", "right", "right", "right"],
    rows: rows.map(r => [
      r.orderNumber, r.design.slice(0, 14), r.item.slice(0, 16),
      `${r.metal}${r.karat ? ` ${r.karat}` : ""}`.slice(0, 18),
      // An estimate is marked, never quietly passed off as a weighed figure.
      `${r.grossG}${r.estimated ? "~" : ""}`, String(r.netG),
      String(r.diamondCt), String(r.diamondPcs),
      fmtMoney(r.totalUsd), fmtMoney(r.paidUsd), fmtMoney(r.dueUsd),
    ]),
    filename: name,
  });
}

/* ────────────────────────────────────────────────────────────────────────────
 * Ready stock — pieces already made and sitting on the shelf.
 *
 * The same sheet, from the other end: these never passed through an order, so
 * their weights are the ones entered when the piece was taken into stock. Sold
 * in bulk they are priced the same way, off GW / NW / DW and the quantity.
 * ──────────────────────────────────────────────────────────────────────────── */

const STOCK_HEAD = [
  "SKU", "Name", "Item", "Metal", "Karat",
  "Gross wt (g)", "Net wt (g)", "Diamond (ct)", "Diamond type",
  "Qty", "Price ($)", "Line total ($)", "Location", "Status", "Added",
];

/** Cost is admin-only everywhere else in the app, so it is only appended for an
 *  admin — an employee's sheet must not be able to leak the margin. */
export function exportReadyStockCsv(
  items: ReadyStockItem[], name: string, withCost: boolean,
  /** Where each piece's cost is read from — the admin-only record once moved. */
  costOf: (i: ReadyStockItem) => number | undefined = i => i.cost,
): void {
  const head = withCost ? [...STOCK_HEAD, "Cost ($)", "Profit ($)"] : STOCK_HEAD;
  downloadCsv(name, head, items.map(i => {
    const row: (string | number)[] = [
      i.sku ?? "", i.name, i.jewelleryType, i.metal, i.productKarats ?? "",
      i.grossWeight ?? "", i.netWeight ?? "", i.diamondWeight ?? "", i.diamondType ?? "",
      i.quantity, i.price, n3(i.price * i.quantity), i.location ?? "",
      i.quantity > 0 ? "Available" : "Sold out", fmtDate(i.createdAt),
    ];
    const cost = withCost ? costOf(i) : undefined;
    if (withCost) row.push(cost ?? "", cost != null ? n3((i.price - cost) * i.quantity) : "");
    return row;
  }));
}

export function exportReadyStockPdf(items: ReadyStockItem[], name: string, subject: string): void {
  const sum = (f: (i: ReadyStockItem) => number) =>
    Math.round(items.reduce((s, i) => s + f(i), 0) * 1000) / 1000;
  downloadLedgerPdf({
    title: "Ready Stock",
    subjectLines: [
      subject,
      `${items.length} item${items.length !== 1 ? "s" : ""}`,
      `Report Generated: ${new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}`,
    ],
    summary: [
      { label: "Pieces", value: String(sum(i => i.quantity)) },
      { label: "Gross weight", value: `${sum(i => (i.grossWeight ?? 0) * i.quantity)} g` },
      { label: "Diamond", value: `${sum(i => (i.diamondWeight ?? 0) * i.quantity)} ct` },
      { label: "Value", value: fmtMoney(sum(i => i.price * i.quantity)) },
    ],
    landscape: true,
    columns: [
      { header: "SKU", x: 14 }, { header: "Name", x: 42 }, { header: "Item", x: 92 },
      { header: "Metal", x: 122 }, { header: "Gross", x: 158 }, { header: "Net", x: 180 },
      { header: "Dia ct", x: 200 }, { header: "Qty", x: 218 },
      { header: "Price", x: 244 }, { header: "Total", x: 272 },
    ],
    align: ["left", "left", "left", "left", "right", "right", "right", "right", "right", "right"],
    rows: items.map(i => [
      (i.sku ?? "").slice(0, 12), i.name.slice(0, 24), i.jewelleryType.slice(0, 14),
      `${i.metal}${i.productKarats ? ` ${i.productKarats}` : ""}`.slice(0, 18),
      String(i.grossWeight ?? ""), String(i.netWeight ?? ""), String(i.diamondWeight ?? ""),
      String(i.quantity), fmtMoney(i.price), fmtMoney(n3(i.price * i.quantity)),
    ]),
    filename: name,
  });
}

/* ────────────────────────────────────────────────────────────────────────────
 * Profit — ADMIN ONLY.
 *
 * Kept apart from the product sheet above on purpose. That one is sent to
 * customers to price a bulk sale; a cost column added to it would go out to a
 * customer the first time somebody forwarded it without looking. This sheet
 * has its own button, shown to the admin alone, and its name says what it is.
 * ──────────────────────────────────────────────────────────────────────────── */

const PROFIT_HEAD = [
  "Order", "Design", "Client", "Item", "Metal", "Status", "Ordered", "Sold (dispatched)",
  "Selling ($)", "Gold cost (₹)", "Diamond cost (₹)", "Factory (₹)", "Freight & other (₹)", "Total cost (₹)",
  "Rate (₹/$)", "Rate basis", "Cost ($)", "Profit ($)", "Margin %", "Cost complete", "Not yet valued",
];

const BASIS: Record<string, string> = {
  dated: "rate on the sale day",
  earliest: "earliest rate on file (none that far back)",
  single: "one flat rate (no dated rates)",
};

export function exportProfitCsv(db: DB, orders: Order[], name: string): void {
  // A sheet saved now would carry costs missing whatever has not loaded yet,
  // and nothing on it would say so.
  if (!costDataReady()) {
    toast.error("Still loading cost data — try again in a moment.");
    return;
  }
  const sum = (ls: { amountInr: number }[]) => Math.round(ls.reduce((s, l) => s + l.amountInr, 0) * 100) / 100;
  downloadCsv(`${name}-PROFIT-ADMIN`, PROFIT_HEAD, orders.map(o => {
    const p = orderProfit(db, o);
    const c = p.cost;
    return [
      o.orderNumber, o.designNumber ?? "", db.clients.find(x => x.id === o.clientId)?.companyName ?? (o.forReadyStock ? "Ready stock" : ""),
      o.jewelleryType, `${o.metal}${o.productKarats ? ` ${o.productKarats}` : ""}`, o.status, fmtDate(o.createdAt),
      recognisedSale(o) ? fmtDate(saleDate(o)) : "",
      o.forReadyStock ? "" : p.sellingUsd, sum(c.gold), sum(c.diamond), sum(c.labour), sum(c.other), c.totalInr,
      p.fx?.rate ?? "", p.fx ? BASIS[p.fx.basis] : "no rate",
      p.costUsd ?? "", o.forReadyStock ? "" : p.profitUsd ?? "", o.forReadyStock ? "" : p.marginPct ?? "",
      c.complete ? "yes" : "NO", c.missing.map(m => `${m.label} (${m.reason})`).join("; "),
    ];
  }));
}
