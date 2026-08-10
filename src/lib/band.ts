// Jewellery "band" / tag printing. Two styles:
//   • "tag"   — the classic dumbbell rat-tail jewellery tag: barcode in the middle,
//               G.Wt / L.Wt / N.Wt on the right (like the physical gold tags).
//   • "label" — a 50×30mm spec label (barcode + type/metal/weights + optional price).
// Each can be Printed (opens PDF + print dialog) or Downloaded. Works for both an
// Order and a Ready Stock item via a normalised BandData shape.
import { jsPDF } from "jspdf";
import JsBarcode from "jsbarcode";
import { orderTotal, fmtMoney, CARAT_TO_GRAM, type Order, type ReadyStockItem, type Settings, type LabelPreset } from "./db";

export type BandStyle = "tag" | "label";
export type BandMode = "print" | "download";
export interface BandOpts { style: BandStyle; mode: BandMode; copies?: number; width?: number; height?: number }

/** Built-in label profiles used when the admin hasn't defined any in Settings. */
export const BUILTIN_LABEL_PRESETS: LabelPreset[] = [
  { id: "tag-72x12", name: "Jewellery tag", style: "tag", widthMm: 72, heightMm: 12 },
  { id: "label-50x30", name: "Spec label", style: "label", widthMm: 50, heightMm: 30 },
];

/** The label profiles to offer — the admin's own, or the built-ins as a fallback. */
export function labelPresets(settings: Settings): LabelPreset[] {
  return settings.labelPresets && settings.labelPresets.length ? settings.labelPresets : BUILTIN_LABEL_PRESETS;
}

interface BandData {
  code: string;        // value encoded in the barcode (order no. / SKU)
  label: string;       // extra id shown beside it (design/SKU), or ""
  company: string;     // company name (from Settings) shown on the tag's left end
  jewelleryType: string;
  metalLine: string;   // metal + karat
  gross: number; net: number; less: number; diaCt: number;
  price: number;       // 0 = none
}

function barcodeDataUrl(value: string): string {
  const canvas = document.createElement("canvas");
  JsBarcode(canvas, value, { format: "CODE128", displayValue: false, margin: 0, width: 2, height: 60, background: "#ffffff", lineColor: "#000000" });
  return canvas.toDataURL("image/png");
}

const f4 = (n: number) => n.toFixed(4);
const lessWeight = (gross: number, net: number, diaCt: number) =>
  gross && net ? Math.max(0, Math.round((gross - net) * 10000) / 10000) : Math.round(diaCt * CARAT_TO_GRAM * 10000) / 10000;

// ── Dumbbell jewellery tag: 72×12mm strip ──
function drawTag(doc: jsPDF, d: BandData, img: string) {
  // Left end — company name (from Settings), up to two lines.
  doc.setFont("helvetica", "bold"); doc.setFontSize(5); doc.setTextColor(0);
  const nameLines = doc.splitTextToSize(d.company, 17).slice(0, 2);
  nameLines.forEach((ln: string, i: number) => doc.text(ln, 3, 5 + i * 3.2));
  doc.addImage(img, "PNG", 20, 1.6, 28, 7);
  doc.setFont("helvetica", "normal"); doc.setFontSize(4.6); doc.setTextColor(0);
  doc.text(d.code, 34, 11, { align: "center" });
  doc.setFontSize(5); doc.setTextColor(0);
  doc.text(`G wt- ${f4(d.gross)}`, 51, 4);
  doc.text(`L wt- ${f4(d.less)}`, 51, 7.4);
  doc.text(`N wt- ${f4(d.net)}`, 51, 10.8);
}

// ── Spec label: 50×30mm ──
function drawLabel(doc: jsPDF, d: BandData, settings: Settings, img: string) {
  const W = 50, M = 3;
  doc.addImage(img, "PNG", M, M, W - M * 2, 9);
  doc.setFont("helvetica", "bold"); doc.setFontSize(8); doc.setTextColor(0);
  doc.text(`${d.code}${d.label ? `  ${d.label}` : ""}`, W / 2, 15.5, { align: "center" });
  doc.setFont("helvetica", "normal"); doc.setFontSize(6.4); doc.setTextColor(40);
  doc.text(`${d.jewelleryType} · ${d.metalLine}`, W / 2, 19.5, { align: "center" });
  const wt: string[] = [];
  if (d.gross) wt.push(`G ${d.gross}g`);
  if (d.net) wt.push(`N ${d.net}g`);
  if (d.diaCt) wt.push(`Dia ${d.diaCt}ct`);
  if (wt.length) doc.text(wt.join(" · "), W / 2, 23, { align: "center" });
  if (settings.barcodeBandShowPrice !== false && d.price > 0) {
    doc.setFont("helvetica", "bold"); doc.setFontSize(8); doc.setTextColor(0);
    doc.text(fmtMoney(d.price), W / 2, 27.5, { align: "center" });
  }
}

function runBand(d: BandData, settings: Settings, opts: BandOpts) {
  const img = barcodeDataUrl(d.code);
  const size: [number, number] = [
    opts.width ?? (opts.style === "tag" ? 72 : 50),
    opts.height ?? (opts.style === "tag" ? 12 : 30),
  ];
  const doc = new jsPDF({ unit: "mm", format: size, orientation: "landscape" });
  const copies = Math.max(1, Math.min(100, opts.copies ?? 1));
  for (let i = 0; i < copies; i++) {
    if (i > 0) doc.addPage(size, "landscape");
    if (opts.style === "tag") drawTag(doc, d, img);
    else drawLabel(doc, d, settings, img);
  }
  if (opts.mode === "print") {
    doc.autoPrint();
    window.open(doc.output("bloburl") as unknown as string, "_blank");
  } else {
    doc.save(`Band-${d.code}-${opts.style}.pdf`);
  }
}

/** Band for an order (barcode = order number). */
export function generateBand(order: Order, settings: Settings, opts: BandOpts): void {
  const gross = order.actualGrossWeight ?? order.estimatedGrossWeight ?? 0;
  const net = order.actualNetWeight ?? order.estimatedNetWeight ?? 0;
  const diaCt = order.actualDiamondWeight ?? order.diamondWeight ?? 0;
  runBand({
    code: order.orderNumber,
    label: order.designNumber ? `#${order.designNumber}` : "",
    company: settings.companyName || "STARLINK JEWELS",
    jewelleryType: order.jewelleryType,
    metalLine: `${order.metal}${order.productKarats ? ` ${order.productKarats}` : ""}`,
    gross, net, less: lessWeight(gross, net, diaCt), diaCt, price: orderTotal(order),
  }, settings, opts);
}

/** Band for a Ready Stock item (barcode = SKU, or the item id when no SKU). */
export function generateStockBand(item: ReadyStockItem, settings: Settings, opts: BandOpts): void {
  const gross = item.grossWeight ?? 0, net = item.netWeight ?? 0, diaCt = item.diamondWeight ?? 0;
  runBand({
    code: item.sku || item.id,
    label: item.sku ? `#${item.sku}` : item.name.slice(0, 14),
    company: settings.companyName || "STARLINK JEWELS",
    jewelleryType: item.jewelleryType,
    metalLine: `${item.metal}${item.productKarats ? ` ${item.productKarats}` : ""}`,
    gross, net, less: lessWeight(gross, net, diaCt), diaCt, price: item.price,
  }, settings, opts);
}
