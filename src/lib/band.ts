// Jewellery "band" / tag printing. Two styles:
//   • "tag"   — the classic dumbbell rat-tail jewellery tag: barcode in the middle,
//               G.Wt / L.Wt / N.Wt on the right (like the physical gold tags).
//   • "label" — a 50×30mm spec label (barcode + type/metal/weights + optional price).
// Each can be Printed (opens PDF and triggers the print dialog) or Downloaded.
import { jsPDF } from "jspdf";
import JsBarcode from "jsbarcode";
import { orderTotal, fmtMoney, CARAT_TO_GRAM, type Order, type Settings } from "./db";

export type BandStyle = "tag" | "label";
export type BandMode = "print" | "download";

/** Code128 barcode of `value` as a crisp PNG data URL. */
function barcodeDataUrl(value: string): string {
  const canvas = document.createElement("canvas");
  JsBarcode(canvas, value, { format: "CODE128", displayValue: false, margin: 0, width: 2, height: 60, background: "#ffffff", lineColor: "#000000" });
  return canvas.toDataURL("image/png");
}

/** Gross / Less (stone) / Net weights in grams for the tag. */
function weights(order: Order) {
  const gross = order.actualGrossWeight ?? order.estimatedGrossWeight ?? 0;
  const net = order.actualNetWeight ?? order.estimatedNetWeight ?? 0;
  const dia = order.actualDiamondWeight ?? order.diamondWeight ?? 0;
  const less = gross && net ? Math.max(0, Math.round((gross - net) * 10000) / 10000) : Math.round(dia * CARAT_TO_GRAM * 10000) / 10000;
  return { gross, net, less };
}

// ── Dumbbell jewellery tag: 72×12mm strip ──
function drawTag(doc: jsPDF, order: Order, img: string) {
  const { gross, net, less } = weights(order);
  const f4 = (n: number) => n.toFixed(4);
  // Left end — brand + design/order number.
  doc.setFont("helvetica", "bold"); doc.setFontSize(5); doc.setTextColor(0);
  doc.text("JEWELLERY", 3, 5); doc.text("TAG", 3, 8.4);
  doc.setFont("helvetica", "normal"); doc.setFontSize(4.6); doc.setTextColor(40);
  doc.text(order.designNumber ? `#${order.designNumber}` : order.orderNumber.slice(-10), 3, 11);
  // Middle — barcode + its number.
  doc.addImage(img, "PNG", 20, 1.6, 28, 7);
  doc.setFont("helvetica", "normal"); doc.setFontSize(4.6); doc.setTextColor(0);
  doc.text(order.orderNumber, 34, 11, { align: "center" });
  // Right end — G / L / N weights.
  doc.setFontSize(5); doc.setTextColor(0);
  doc.text(`G wt- ${f4(gross)}`, 51, 4);
  doc.text(`L wt- ${f4(less)}`, 51, 7.4);
  doc.text(`N wt- ${f4(net)}`, 51, 10.8);
}

// ── Spec label: 50×30mm ──
function drawLabel(doc: jsPDF, order: Order, settings: Settings, img: string) {
  const W = 50, M = 3;
  const { gross, net } = weights(order);
  const dia = order.actualDiamondWeight ?? (order.diamondWeight || undefined);
  doc.addImage(img, "PNG", M, M, W - M * 2, 9);
  doc.setFont("helvetica", "bold"); doc.setFontSize(8); doc.setTextColor(0);
  doc.text(`${order.orderNumber}${order.designNumber ? `  #${order.designNumber}` : ""}`, W / 2, 15.5, { align: "center" });
  doc.setFont("helvetica", "normal"); doc.setFontSize(6.4); doc.setTextColor(40);
  doc.text(`${order.jewelleryType} · ${order.metal}${order.productKarats ? ` ${order.productKarats}` : ""}`, W / 2, 19.5, { align: "center" });
  const wt: string[] = [];
  if (gross) wt.push(`G ${gross}g`);
  if (net) wt.push(`N ${net}g`);
  if (dia) wt.push(`Dia ${dia}ct`);
  if (wt.length) doc.text(wt.join(" · "), W / 2, 23, { align: "center" });
  if (settings.barcodeBandShowPrice !== false && orderTotal(order) > 0) {
    doc.setFont("helvetica", "bold"); doc.setFontSize(8); doc.setTextColor(0);
    doc.text(fmtMoney(orderTotal(order)), W / 2, 27.5, { align: "center" });
  }
}

/** Build → then Print (open + auto print dialog) or Download the chosen band style. */
export function generateBand(order: Order, settings: Settings, opts: { style: BandStyle; mode: BandMode; copies?: number }): void {
  const img = barcodeDataUrl(order.orderNumber);
  const size: [number, number] = opts.style === "tag" ? [72, 12] : [50, 30];
  const doc = new jsPDF({ unit: "mm", format: size, orientation: "landscape" });
  const copies = Math.max(1, Math.min(100, opts.copies ?? 1));
  for (let i = 0; i < copies; i++) {
    if (i > 0) doc.addPage(size, "landscape");
    if (opts.style === "tag") drawTag(doc, order, img);
    else drawLabel(doc, order, settings, img);
  }
  if (opts.mode === "print") {
    doc.autoPrint();
    const url = doc.output("bloburl");
    window.open(url as unknown as string, "_blank");
  } else {
    doc.save(`Band-${order.orderNumber}-${opts.style}.pdf`);
  }
}
