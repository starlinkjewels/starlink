// One order, downloaded: the order page in a file — what was ordered, the
// piece's weights, every material and repair (lib/orderMaterials.ts, the same
// lines the page shows), the payments, and what is still due. A PDF to keep or
// send, and the same in Excel.
//
// What things cost us (purchase cost, factory labour) is on the admin's copy
// only — like the Profit sheet, it is never meant to leave the office.
import { balanceDue, fmtDate, fmtMoney, orderTotal, totalAdvance, type DB, type Order } from "./db";
import { downloadCsv, downloadLedgerPdfMulti, type PdfSection } from "./ledgerExport";
import { orderMaterialLines } from "./orderMaterials";
import { pieceWeights } from "./weights";
import { fmtMoneyInr } from "./manufacturing";

/** The PDF's fonts have no ₹, no minus sign, no curly quotes. */
const plain = (s: string) => s.replace(/₹\s?/g, "Rs. ").replace(/−/g, "-").replace(/[’‘]/g, "'").replace(/[“”]/g, '"').replace(/→/g, "->");
const g3 = (n: number) => `${Math.round(n * 1000) / 1000} g`;
/** Cut to what a PDF column holds (about 1.3 mm a letter), so no cell runs into the next. */
const fit = (s: string, chars: number) => (s.length > chars ? `${s.slice(0, chars - 1).trimEnd()}…` : s);

interface OrderSheet {
  details: [string, string][];
  weights: [string, string][];
  materials: { material: string; detail: string; pcs: string; qty: string; from: string; status: string; cost: string; due: string; duePdf: string }[];
  payments: { date: string; receipt: string; note: string; amount: number }[];
  money: [string, string][];
}

function buildSheet(db: DB, order: Order, opts: { faDone: boolean; withCost: boolean }): OrderSheet {
  const client = db.clients.find(c => c.id === order.clientId);
  const factory = order.assignedFactoryId ? db.factories.find(f => f.id === order.assignedFactoryId) : undefined;
  const pw = pieceWeights(order, db.materialIssuances ?? []);
  const fa = order.timeline.find(t => t.step === "Final Approval");
  const details: [string, string][] = ([
    ["Order", order.orderNumber],
    ["Order date", fmtDate(order.createdAt)],
    ["Client", order.forReadyStock ? "In-house (Ready Stock)" : client?.companyName ?? ""],
    ["Contact", order.contactPerson ?? ""],
    ["Status", order.status],
    ["Due date", order.expectedDelivery ? fmtDate(order.expectedDelivery) : ""],
    ["Design no.", order.designNumber ?? ""],
    ["Item", `${order.jewelleryType}${order.quantity > 1 ? ` × ${order.quantity}` : ""}`],
    ["Metal", [order.metal, order.productKarats, order.productColor].filter(Boolean).join(" · ")],
    ["Size", order.productSize ?? ""],
    ["Diamonds", order.noDiamond ? "No diamond" : [order.diamondType, order.diamondShape].filter(Boolean).join(" · ")],
    ["Rhodium", order.rhodium ?? ""],
    ["Stamping", order.stamping ?? ""],
    ["Engraving", order.engraving?.text ?? ""],
    ["Factory", factory?.name ?? ""],
    ["Factory bill no.", order.factoryBillNo ?? ""],
    ["Final Approval", fa?.status === "done" && fa.date ? fmtDate(fa.date) : ""],
    ["Dispatched", order.dispatchedAt ? [fmtDate(order.dispatchedAt), order.courierName, order.trackingNumber].filter(Boolean).join(" · ") : ""],
    ["Instructions", order.instructions ?? ""],
  ] as [string, string][]).filter(([, v]) => !!String(v).trim());
  const weights: [string, string][] = ([
    ["Weights are", pw.estimated ? "Estimated (no Final Approval yet)" : "Actual"],
    ["Gross", g3(pw.gross)],
    ["Net metal", g3(pw.net)],
    ...(pw.other > 0 ? [[`${order.otherMetal || "Other metal"}`, g3(pw.other)]] : []),
    ...(pw.diamondCt > 0 ? [["Diamonds", `${Math.round(pw.diamondCt * 1000) / 1000} ct${order.actualDiamondPcs ? ` · ${order.actualDiamondPcs} pcs` : ""}`]] : []),
  ] as [string, string][]);
  const materials = orderMaterialLines(db, order, opts.faDone).map(l => ({
    material: l.title, detail: l.detail ?? "", pcs: l.pcs != null ? String(l.pcs) : "", qty: l.qty,
    from: [l.source, l.sourceSub].filter(Boolean).join(" · "), status: l.status,
    cost: opts.withCost && l.costInr != null ? fmtMoneyInr(l.costInr) : "",
    due: opts.withCost ? [l.dueInr > 0 ? `${fmtMoneyInr(l.dueInr)} to supplier` : "", l.labourDueInr > 0 ? `${fmtMoneyInr(l.labourDueInr)} labour` : ""].filter(Boolean).join(" · ") : "",
    duePdf: opts.withCost ? [l.dueInr > 0 ? `${fmtMoneyInr(l.dueInr)} supplier` : "", l.labourDueInr > 0 ? `${fmtMoneyInr(l.labourDueInr)} labour` : ""].filter(Boolean).join(" · ") : "",
  }));
  const receipts = db.clientReceipts ?? [];
  const payments = (order.advances ?? []).slice().sort((a, b) => +new Date(a.createdAt) - +new Date(b.createdAt)).map(a => ({
    date: fmtDate(a.createdAt), receipt: a.receiptId ? receipts.find(r => r.id === a.receiptId)?.receiptNo ?? "" : "", note: a.note ?? "", amount: a.amount,
  }));
  const money: [string, string][] = [
    ["Order value", fmtMoney(orderTotal(order) - (order.shippingCharge ?? 0))],
    ...(order.shippingCharge ? [["Shipping", fmtMoney(order.shippingCharge)] as [string, string]] : []),
    ["Total", fmtMoney(orderTotal(order))],
    ["Paid", fmtMoney(totalAdvance(order))],
    ["Balance due", fmtMoney(balanceDue(order))],
  ];
  return { details, weights, materials, payments, money };
}

const fileName = (order: Order) => `Order-${order.orderNumber.replace(/[^\w.-]+/g, "_")}`;

/** The order as a PDF: details, weights, materials and repairs, payments, and what is due. */
export function exportOrderPdf(db: DB, order: Order, opts: { faDone: boolean; withCost: boolean }): void {
  const s = buildSheet(db, order, opts);
  const kv = (heading: string, list: [string, string][]): PdfSection => ({
    heading, columns: [{ header: "Detail", x: 14 }, { header: "As recorded", x: 62 }], rows: list.map(([k, v]) => [plain(k), fit(plain(v), 160)]),
  });
  const sections: PdfSection[] = [
    kv("Order", s.details),
    kv("Piece weights", s.weights),
  ];
  if (s.materials.length) sections.push({
    heading: "Material and repairs",
    // Landscape A4: 14–283 mm. With costs: Material · Qty · From · Status · Cost · Due.
    columns: opts.withCost
      ? [{ header: "Material", x: 14 }, { header: "Qty", x: 100 }, { header: "From", x: 122 }, { header: "Status", x: 182 }, { header: "Cost", x: 210 }, { header: "Due", x: 234 }]
      : [{ header: "Material", x: 14 }, { header: "Qty", x: 130 }, { header: "From", x: 156 }, { header: "Status", x: 240 }],
    rows: s.materials.map(m => {
      const what = plain([m.material, m.detail, m.pcs ? `${m.pcs} pcs` : ""].filter(Boolean).join(" · "));
      return opts.withCost
        ? [fit(what, 64), fit(plain(m.qty), 16), fit(plain(m.from), 38), fit(plain(m.status), 20), fit(plain(m.cost), 17), fit(plain(m.duePdf), 38)]
        : [fit(what, 88), fit(plain(m.qty), 19), fit(plain(m.from), 54), fit(plain(m.status), 32)];
    }),
  });
  if (s.payments.length) sections.push({
    heading: "Payments",
    columns: [{ header: "Date", x: 14 }, { header: "Receipt", x: 50 }, { header: "Note", x: 85 }, { header: "Amount", x: 270 }],
    align: ["left", "left", "left", "right"],
    rows: s.payments.map(p => [p.date, p.receipt, fit(plain(p.note), 130), fmtMoney(p.amount)]),
    totalsRow: ["Total paid", "", "", fmtMoney(s.payments.reduce((t, p) => t + p.amount, 0))],
  });
  downloadLedgerPdfMulti({
    title: `Order ${order.orderNumber}`,
    subjectLines: [
      [s.details.find(([k]) => k === "Client")?.[1], order.jewelleryType, order.status].filter(Boolean).join(" · "),
      `Report Generated: ${new Date().toLocaleDateString("en-IN", { month: "long", day: "numeric", year: "numeric" })}`,
    ],
    summary: s.money.map(([label, value]) => ({ label, value })),
    sections,
    filename: fileName(order),
    landscape: true,
  });
}

/** The same as a spreadsheet: one block under another, each figure in its own cell. */
export function exportOrderCsv(db: DB, order: Order, opts: { faDone: boolean; withCost: boolean }): void {
  const s = buildSheet(db, order, opts);
  const rows: (string | number)[][] = [];
  const block = (title: string, list: [string, string][]) => { rows.push([title], ...list.map(([k, v]) => [k, v]), []); };
  block("ORDER", s.details);
  block("PIECE WEIGHTS", s.weights);
  if (s.materials.length) {
    rows.push(["MATERIAL AND REPAIRS"], ["Material", "Detail", "Pcs", "Qty", "From", "Status", ...(opts.withCost ? ["Cost (Rs)", "Due"] : [])]);
    for (const m of s.materials) rows.push([m.material, m.detail, m.pcs, m.qty, m.from, m.status, ...(opts.withCost ? [m.cost.replace(/₹/g, "Rs. "), m.due.replace(/₹/g, "Rs. ")] : [])]);
    rows.push([]);
  }
  if (s.payments.length) {
    rows.push(["PAYMENTS"], ["Date", "Receipt", "Note", "Amount ($)"]);
    for (const p of s.payments) rows.push([p.date, p.receipt, p.note, p.amount]);
    rows.push(["Total paid", "", "", Math.round(s.payments.reduce((t, p) => t + p.amount, 0) * 100) / 100], []);
  }
  block("MONEY", s.money);
  downloadCsv(fileName(order), [`Order ${order.orderNumber}`, ""], rows);
}

